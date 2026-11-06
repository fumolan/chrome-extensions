// JSON 格式化工具：纯本地解析/序列化，不发起网络请求、不外发数据
const $ = (id) => document.getElementById(id);
const input = $('input');
const statusEl = $('status');
const outCard = $('outCard');
const outputEl = $('output');
const metaEl = $('meta');
const indentEl = $('indent');
const sortEl = $('sortKeys');
const copyBtnEl = $('copyBtn');
const viewSel = $('viewMode');
const treeEl = $('tree');
const expandAllBtn = $('expandAllBtn');
const collapseAllBtn = $('collapseAllBtn');
const errCard = $('errCard');
const errMsgEl = $('errMsg');
const errPosEl = $('errPos');
const errHintsEl = $('errHints');
const errEmptyEl = $('errEmpty');

let lastText = ''; // 最近一次格式化结果，供复制

/* ---------- 带行列定位的 JSON 解析器 ----------
   新版 V8 对「意外 token」类错误不再给出 position/line，报错难以定位；
   这里自带一个轻量递归下降解析器，失败时给出精确行列 + 中文原因。 */

function parseJsonWithPos(text) {
  let i = 0;
  let line = 1;
  let col = 1;
  const err = (msg) => { const e = new Error(msg); e.line = line; e.col = col; throw e; };
  const adv = (n = 1) => { while (n--) { if (text[i] === '\n') { line++; col = 1; } else col++; i++; } };
  const skipWs = () => { while (i < text.length && /\s/.test(text[i])) adv(); };

  function kw(word, val) {
    if (text.startsWith(word, i)) { adv(word.length); return val; }
    throw err(`无效字面量（应为 ${word}）`);
  }

  function parseNum() {
    const m = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(i));
    if (!m) throw err('无效的数字');
    adv(m[0].length);
    return +m[0];
  }

  function parseStr() {
    adv(); // 开引号
    let out = '';
    const escMap = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
    while (true) {
      const c = text[i];
      if (c === undefined) throw err('字符串未闭合（缺右引号）');
      if (c === '"') { adv(); return out; }
      if (c === '\\') {
        const n = text[i + 1];
        adv(2);
        if (n in escMap) { out += escMap[n]; continue; }
        if (n === 'u') {
          const hex = text.substr(i, 4);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw err('无效的 \\u 转义（需要 4 位十六进制）');
          out += String.fromCharCode(parseInt(hex, 16));
          adv(4);
          continue;
        }
        throw err(`无效的转义符 \\${n ?? ''}`);
      }
      if (c.charCodeAt(0) < 0x20) throw err('字符串内含未转义的控制字符');
      out += c;
      adv();
    }
  }

  function parseObj() {
    adv(); // {
    skipWs();
    const o = {};
    if (text[i] === '}') { adv(); return o; }
    while (true) {
      skipWs();
      if (text[i] !== '"') throw err(text[i] === undefined ? '对象不完整（缺 }）' : '对象键必须是双引号字符串');
      const k = parseStr();
      skipWs();
      if (text[i] !== ':') throw err(`键后面应为冒号「:」，实际是「${text[i] ?? '末尾'}」`);
      adv();
      o[k] = parseValue();
      skipWs();
      if (text[i] === ',') {
        adv();
        skipWs();
        if (text[i] === '}') throw err('尾逗号：JSON 不允许「,}」');
        continue;
      }
      if (text[i] !== '}') throw err(`应为逗号「,」或右花括号「}」，实际是「${text[i] ?? '末尾'}」`);
      adv();
      return o;
    }
  }

  function parseArr() {
    adv(); // [
    skipWs();
    const a = [];
    if (text[i] === ']') { adv(); return a; }
    while (true) {
      a.push(parseValue());
      skipWs();
      if (text[i] === ',') {
        adv();
        skipWs();
        if (text[i] === ']') throw err('尾逗号：JSON 不允许「,]」');
        continue;
      }
      if (text[i] !== ']') throw err(`应为逗号「,」或右方括号「]」，实际是「${text[i] ?? '末尾'}」`);
      adv();
      return a;
    }
  }

  function parseValue() {
    skipWs();
    const c = text[i];
    if (c === '{') return parseObj();
    if (c === '[') return parseArr();
    if (c === '"') return parseStr();
    if (c === 't') return kw('true', true);
    if (c === 'f') return kw('false', false);
    if (c === 'n') return kw('null', null);
    if (c === '-' || /\d/.test(c)) return parseNum();
    throw err(c === undefined ? '数据不完整（意外到末尾）' : `意外字符「${c}」`);
  }

  const value = parseValue();
  skipWs();
  if (i < text.length) throw err('JSON 已结束，但后面还有多余内容');
  return value;
}

/* ---------- 输入容错 ---------- */

// 截取 {…} / […] 片段（忽略首尾杂文）；无明显杂文时返回 null
function clipJson(raw) {
  const start = raw.search(/[{[]/);
  const end = Math.max(raw.lastIndexOf('}'), raw.lastIndexOf(']'));
  const hasJunk = start > 0 || end < raw.length - 1;
  return start >= 0 && end > start && hasJunk ? raw.slice(start, end + 1) : null;
}

// Python dict / JS 对象字面量 → 标准 JSON 的尽力转换：
// 单引号字符串转双引号（串内双引号补转义）、True/False/None 转小写、未加引号的键名补引号。
// 用状态机跳过字符串内容再做替换，避免误伤串内的 None/False 等词。
function repairLooseJson(src) {
  const fixes = new Set();
  let out = '';
  let i = 0;
  let inStr = null; // 进入字符串前为 null；值为进入时的引号 "'" 或 '"'
  while (i < src.length) {
    const c = src[i];
    if (!inStr && (c === '"' || c === "'")) {
      if (c === "'") fixes.add('单引号→双引号');
      inStr = c;
      out += '"';
      i++;
      continue;
    }
    if (inStr) {
      if (c === '\\') {
        const next = src[i + 1];
        if (inStr === "'" && next === "'") { out += "'"; i += 2; continue; } // \' 在双引号串中无需转义
        if (inStr === "'" && next === '"') { out += '\\"'; i += 2; continue; }
        out += c + (next ?? '');
        i += next === undefined ? 1 : 2;
        continue;
      }
      if (c === inStr) { out += '"'; inStr = null; i++; continue; }
      if (inStr === "'" && c === '"') { out += '\\"'; i++; continue; }
      out += c;
      i++;
      continue;
    }
    // 字符串外：字面量与键名
    if (/[\p{L}_]/u.test(c)) {
      let j = i;
      while (j < src.length && /[\p{L}\p{N}_$]/u.test(src[j])) j++;
      const word = src.slice(i, j);
      let k = j;
      while (k < src.length && /\s/.test(src[k])) k++;
      if (src[k] === ':') {
        out += `"${word}"`;
        fixes.add('键名补引号');
      } else if (word === 'True') { out += 'true'; fixes.add('True→true'); }
      else if (word === 'False') { out += 'false'; fixes.add('False→false'); }
      else if (word === 'None') { out += 'null'; fixes.add('None→null'); }
      else out += word;
      i = j;
      continue;
    }
    out += c;
    i++;
  }
  return { text: out, fixes: [...fixes] };
}

// 疑似格式问题的启发式提示
function buildHints(text) {
  const hints = [];
  if (/'[^']*'\s*:/.test(text) || /:\s*'[^']*'/.test(text)) hints.push('含单引号字符串 —— JSON 只认双引号。数据可能是 Python dict / JS 对象字面量（print 或控制台复制出来的）');
  if (/\b(True|False|None)\b/.test(text)) hints.push('含 True / False / None —— 标准 JSON 是 true / false / null（Python 风格）');
  if (/[{,]\s*[\p{L}_][\p{L}\p{N}_$]*\s*:/u.test(text)) hints.push('存在未加引号的键名 —— JSON 的键必须用双引号包裹');
  if (/[“”‘’]/.test(text)) hints.push('含全角引号 “”‘’ —— JSON 只认半角引号');
  return hints;
}

/* ---------- 展示工具 ---------- */

// 递归按键名排序（数组保序，仅重排对象键）
function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.keys(v).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).map(k => [k, sortKeys(v[k])])
    );
  }
  return v;
}

function esc(v) {
  return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// 先转义再正则包 span 高亮，不引第三方库（同 jwt-decoder 的轻量方案）
function highlight(text) {
  return esc(text).replace(
    /("(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*")(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g,
    (m, str, colon) => {
      if (str) return colon ? `<span class="j-key">${str}</span>${colon}` : `<span class="j-str">${str}</span>`;
      if (m === 'true' || m === 'false' || m === 'null') return `<span class="j-bool">${m}</span>`;
      return `<span class="j-num">${m}</span>`;
    }
  );
}

function fmtBytes(n) {
  return n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`;
}

function typeName(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return `数组 · ${v.length} 项`;
  if (typeof v === 'object') return `对象 · ${Object.keys(v).length} 个键`;
  return { string: '字符串', number: '数字', boolean: '布尔值' }[typeof v] || typeof v;
}

// 出错行预览：行号前缀 + ^ 指示列，长行围绕出错位置截窗
function errPreview(raw, lineNo, colNo) {
  const line = raw.split('\n')[lineNo - 1] ?? '';
  const WIDTH = 96;
  let start = 0;
  let text = line;
  if (line.length > WIDTH) {
    start = Math.max(0, Math.min(colNo - 31, line.length - WIDTH));
    text = (start > 0 ? '…' : '') + line.slice(start, start + WIDTH) + (start + WIDTH < line.length ? '…' : '');
  }
  const pad = Math.max(0, colNo - 1 - start) + (start > 0 ? 1 : 0);
  return `${lineNo} | ${text}\n${' '.repeat(String(lineNo).length + 3 + pad)}^`;
}

/* ---------- 树形折叠视图 ---------- */

const COLLAPSE_LINES = 16; // 格式化行数超过该值的节点默认折叠（根节点除外）

// 该节点格式化后占多少行
function fmtLines(v) {
  if (v && typeof v === 'object') {
    let n = 2;
    for (const k of Array.isArray(v) ? v : Object.values(v)) n += fmtLines(k);
    return n;
  }
  return 1;
}

function dEl(cls) {
  const d = document.createElement('div');
  d.className = cls;
  return d;
}

function sEl(cls, text) {
  const s = document.createElement('span');
  if (cls) s.className = cls;
  s.textContent = text; // 全程 textContent，天然免转义
  return s;
}

function appendKey(container, k) {
  if (k !== undefined) {
    container.appendChild(sEl('j-key', JSON.stringify(k)));
    container.appendChild(sEl('colon', ': '));
  }
}

function appendComma(container, isLast) {
  if (!isLast) container.appendChild(sEl('comma', ','));
}

function valueSpan(v) {
  if (typeof v === 'string') return sEl('j-str', JSON.stringify(v));
  if (typeof v === 'number') return sEl('j-num', String(v));
  return sEl('j-bool', String(v)); // boolean / null
}

function containerNode(value, depth, isLast, key) {
  const isArr = Array.isArray(value);
  const entries = isArr ? value.map((v, i) => [undefined, v]) : Object.entries(value);
  const node = dEl('tn');
  if (depth === 0) node.classList.add('tn-root');
  const head = dEl('tn-head');
  appendKey(head, key);
  const count = entries.length;

  if (count === 0) { // 空容器：无折叠态
    head.appendChild(sEl('brace', isArr ? '[]' : '{}'));
    appendComma(head, isLast);
    node.appendChild(head);
    return node;
  }

  const collapsed = depth > 0 && fmtLines(value) > COLLAPSE_LINES;
  head.appendChild(sEl('tg', collapsed ? '▸' : '▾'));
  head.appendChild(sEl('brace', isArr ? '[' : '{'));
  head.appendChild(sEl('sum', `${isArr ? '[…]' : '{…}'} ${count} ${isArr ? '项' : '键'}${isLast ? '' : ','}`));
  node.appendChild(head);

  const kids = dEl('tn-kids');
  entries.forEach(([, v], idx) => {
    const last = idx === count - 1;
    const k = isArr ? undefined : entries[idx][0];
    if (v && typeof v === 'object') kids.appendChild(containerNode(v, depth + 1, last, k));
    else {
      const line = dEl('tn-leaf');
      appendKey(line, k);
      line.appendChild(valueSpan(v));
      appendComma(line, last);
      kids.appendChild(line);
    }
  });
  node.appendChild(kids);

  const end = dEl('tn-end');
  end.appendChild(sEl('brace', isArr ? ']' : '}'));
  appendComma(end, isLast);
  node.appendChild(end);

  if (collapsed) node.classList.add('collapsed');
  return node;
}

function buildTree(data) {
  treeEl.innerHTML = '';
  treeEl.appendChild(containerNode(data, 0, true, undefined));
}

function setAllCollapsed(collapse) {
  treeEl.querySelectorAll('.tn').forEach((node) => {
    if (collapse && node.classList.contains('tn-root')) return; // 根节点保持展开
    if (!node.querySelector(':scope > .tn-kids')) return; // 叶子/空容器无折叠态
    node.classList.toggle('collapsed', collapse);
    const tg = node.querySelector(':scope > .tn-head .tg');
    if (tg) tg.textContent = collapse ? '▸' : '▾';
  });
}

/* ---------- 渲染 ---------- */

function show(msg, cls) {
  statusEl.textContent = msg;
  statusEl.className = 'status ' + cls;
}

function renderView(data) {
  const treeMode = viewSel.value === 'tree';
  expandAllBtn.hidden = !treeMode;
  collapseAllBtn.hidden = !treeMode;
  outputEl.hidden = treeMode;
  treeEl.hidden = !treeMode;
  if (treeMode) buildTree(data);
  else outputEl.innerHTML = highlight(lastText);
}

function render(obj, note) {
  const data = sortEl.checked ? sortKeys(obj) : obj;
  const indentSel = indentEl.value;
  const indent = indentSel === '0' ? 0 : indentSel === 'tab' ? '\t' : Number(indentSel);
  lastText = JSON.stringify(data, null, indent);
  const bytes = new TextEncoder().encode(lastText).length;
  metaEl.textContent = `${typeName(obj)} · UTF-8 ${fmtBytes(bytes)} · ${lastText.split('\n').length} 行`;
  renderView(data);
  errCard.hidden = true;
  outCard.hidden = false;
  if (note) show(note, 'ok');
  else statusEl.className = 'status';
}

function renderError(raw) {
  // 自带解析器给精确行列与中文原因；引擎原始报错放 title 备查
  let pErr = null;
  try { parseJsonWithPos(raw); } catch (e) { pErr = e; }
  let nativeMsg = '';
  try { JSON.parse(raw); } catch (e) { nativeMsg = e.message; }

  outCard.hidden = true;
  lastText = '';
  errMsgEl.textContent = pErr ? pErr.message : nativeMsg;
  if (nativeMsg && nativeMsg !== errMsgEl.textContent) errMsgEl.title = `浏览器原始报错：${nativeMsg}`;
  errPosEl.textContent = pErr && pErr.line ? errPreview(raw, pErr.line, pErr.col) : '';
  const hints = buildHints(raw);
  errHintsEl.innerHTML = '';
  for (const h of hints) {
    const li = document.createElement('li');
    li.textContent = h;
    errHintsEl.appendChild(li);
  }
  errEmptyEl.hidden = hints.length > 0;
  show(pErr && pErr.line ? `解析失败：第 ${pErr.line} 行 第 ${pErr.col} 列` : '解析失败', 'error');
}

function run() {
  const raw = input.value.trim();
  if (!raw) {
    statusEl.className = 'status';
    errCard.hidden = true;
    outCard.hidden = true;
    lastText = '';
    return;
  }

  // 依次尝试：原文 → 截取片段 → 修复后原文 → 修复后片段，第一个成功者胜出
  const clip = clipJson(raw);
  const candidates = [{ text: raw, note: '' }];
  if (clip) candidates.push({ text: clip, note: '已自动截取 JSON 片段（忽略首尾杂文）' });
  const attempts = [...candidates];
  for (const c of candidates) {
    const { text: repaired, fixes } = repairLooseJson(c.text);
    if (fixes.length) {
      attempts.push({ text: repaired, note: [c.note, `已自动修复：${fixes.join('、')}`].filter(Boolean).join('；') });
    }
  }

  for (const a of attempts) {
    try {
      const obj = JSON.parse(a.text);
      if (a.text !== input.value) input.value = a.text; // 展示实际参与解析的文本
      render(obj, a.note);
      return;
    } catch (_) { /* 试下一个候选 */ }
  }
  renderError(raw);
}

/* ---------- 入口与事件 ---------- */

let timer;
input.addEventListener('input', () => {
  clearTimeout(timer);
  timer = setTimeout(run, 200);
});

indentEl.onchange = run;
sortEl.onchange = run;
viewSel.onchange = run;

// 点击折叠/展开（事件委托，空容器无 tg 不响应）
treeEl.addEventListener('click', (e) => {
  const head = e.target.closest('.tn-head');
  if (!head) return;
  const tg = head.querySelector('.tg');
  if (!tg) return;
  const on = head.parentElement.classList.toggle('collapsed');
  tg.textContent = on ? '▸' : '▾';
});

expandAllBtn.onclick = () => setAllCollapsed(false);
collapseAllBtn.onclick = () => setAllCollapsed(true);

copyBtnEl.onclick = async () => {
  if (!lastText) return;
  await navigator.clipboard.writeText(lastText);
  copyBtnEl.textContent = '已复制 ✓';
  setTimeout(() => (copyBtnEl.textContent = '复制'), 1200);
};

$('clearBtn').onclick = () => { input.value = ''; run(); input.focus(); };

$('demoBtn').onclick = () => {
  const demo = {
    code: 0,
    msg: '成功',
    data: {
      total: 2,
      list: [
        { id: 1, name: '张三', roles: ['admin', 'user'], active: true, score: 98.5, extra: null },
        { id: 2, name: '李四', roles: [], active: false, score: 66, extra: { city: '杭州' } }
      ],
      updated_at: '2026-11-05T10:00:00Z'
    },
    trace_id: 'a1b2c3d4-e5f6-7890'
  };
  input.value = JSON.stringify(demo);
  run();
};

// 右键菜单「格式化选中的 JSON」带入的文本
chrome.storage.session.get('jsonSelection').then(({ jsonSelection }) => {
  if (jsonSelection) {
    input.value = jsonSelection;
    run();
    chrome.storage.session.remove('jsonSelection');
  }
});
