// JWT 解析工具：纯本地 base64url 解码，不做签名验证（验签需服务端公钥）
const $ = (id) => document.getElementById(id);
const input = $('input');
const statusEl = $('status');
const resultEl = $('result');

/* ---------- 解码 ---------- */

function b64urlDecode(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - b64.length % 4) % 4));
  return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
}

function parseToken(raw) {
  // 容忍粘贴整行：剥 Bearer 前缀、取第一段无空白串、去掉包裹引号
  const cleaned = raw.trim().replace(/^bearer[\s:]+/i, '');
  const m = cleaned.match(/[^\s"'"]+/);
  if (!m) throw new Error('未识别到 token 内容');
  const parts = m[0].split('.');
  if (parts.length < 2) throw new Error('不是 JWT：至少需要 header.payload 两段（用 . 分隔）');
  let header, payload;
  try {
    header = JSON.parse(b64urlDecode(parts[0]));
    payload = JSON.parse(b64urlDecode(parts[1]));
  } catch (e) {
    throw new Error('解码失败：payload 不是合法的 base64url JSON（' + e.message + '）');
  }
  if (typeof header !== 'object' || typeof payload !== 'object') throw new Error('解码结果不是 JSON 对象');
  return { header, payload, hasSig: parts.length >= 3 };
}

/* ---------- 展示工具 ---------- */

function esc(v) {
  return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function highlightJson(obj) {
  const text = JSON.stringify(obj, null, 2).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return text.replace(
    /("(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*")(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g,
    (m, str, colon) => {
      if (str) return colon ? `<span class="j-key">${str}</span>${colon}` : `<span class="j-str">${str}</span>`;
      if (m === 'true' || m === 'false' || m === 'null') return `<span class="j-bool">${m}</span>`;
      return `<span class="j-num">${m}</span>`;
    }
  );
}

function fmtAbs(ts) {
  return new Date(ts * 1000).toLocaleString('zh-CN', { hour12: false });
}

function fmtRel(ts) {
  let diff = ts * 1000 - Date.now();
  const past = diff < 0;
  diff = Math.abs(diff);
  const units = [['天', 86400000], ['小时', 3600000], ['分钟', 60000], ['秒', 1000]];
  const [name, ms] = units.find(([, v]) => diff >= v) || ['秒', 1];
  const n = Math.round(diff / ms);
  return past ? `${n} ${name}前` : `${n} ${name}后`;
}

function toList(v) {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === 'string' && v.trim()) return v.trim().split(/\s+/);
  return [];
}

function copyBtn(obj) {
  const btn = document.createElement('button');
  btn.textContent = '复制';
  btn.onclick = async () => {
    await navigator.clipboard.writeText(JSON.stringify(obj, null, 2));
    btn.textContent = '已复制 ✓';
    setTimeout(() => (btn.textContent = '复制'), 1200);
  };
  return btn;
}

/* ---------- 渲染 ---------- */

function render(header, payload, hasSig) {
  statusEl.className = 'status';
  resultEl.innerHTML = '';

  /* 摘要卡 */
  const sum = document.createElement('div');
  sum.className = 'card';
  const chips = document.createElement('div');
  chips.className = 'chips';
  const chipData = [
    ['用户', payload.user_name || payload.preferred_username || payload.sub],
    ['系统', payload.sys], ['来源', payload.clientSource], ['客户端', payload.client_id],
    ['受众', toList(payload.aud).join(', ')], ['scope', toList(payload.scope).join(' ')],
  ].filter(([, v]) => v != null && v !== '');
  chips.innerHTML = chipData.map(([k, v]) =>
    `<span class="chip" title="${esc(k)}">${esc(v)}</span>`).join('');
  sum.appendChild(chips);

  // 过期状态行
  const expLine = document.createElement('div');
  expLine.style.marginTop = chips.childNodes.length ? '10px' : '0';
  if (typeof payload.exp === 'number') {
    const valid = payload.exp * 1000 > Date.now();
    expLine.style.color = valid ? 'var(--ok)' : 'var(--danger)';
    expLine.textContent = `${valid ? '● 有效' : '● 已过期'}：${fmtAbs(payload.exp)}（${fmtRel(payload.exp)}）`;
  } else {
    expLine.className = 'muted';
    expLine.textContent = '无 exp 字段（长效 token）';
  }
  sum.appendChild(expLine);

  // 其他声明 kv 行
  for (const [k, v] of Object.entries(payload)) {
    if (['exp', 'user_name', 'preferred_username', 'sub', 'sys', 'clientSource', 'client_id', 'aud', 'scope', 'authorities', 'roles'].includes(k)) continue;
    if (v == null || v === '') continue;
    const row = document.createElement('div');
    row.className = 'kv';
    row.innerHTML = `<span class="k">${esc(k)}</span><span class="v">${esc(typeof v === 'object' ? JSON.stringify(v) : v)}</span>`;
    sum.appendChild(row);
  }
  resultEl.appendChild(sum);

  /* 角色卡 */
  const roles = toList(payload.authorities).concat(
    toList(payload.roles).filter(r => !toList(payload.authorities).includes(r))
  );
  if (roles.length) {
    const rc = document.createElement('div');
    rc.className = 'card';
    rc.innerHTML = `<div class="card-head"><h2>角色 / 权限（${roles.length}）</h2></div>
      <div class="chips">${roles.map(r => `<span class="chip">${esc(r)}</span>`).join('')}</div>`;
    resultEl.appendChild(rc);
  }

  /* Header / Payload 卡 */
  for (const [name, obj] of [['Header', header], ['Payload', payload]]) {
    const card = document.createElement('div');
    card.className = 'card';
    const head = document.createElement('div');
    head.className = 'card-head';
    const h2 = document.createElement('h2');
    h2.textContent = name;
    head.appendChild(h2);
    head.appendChild(copyBtn(obj));
    card.appendChild(head);
    const pre = document.createElement('pre');
    pre.className = 'json';
    pre.innerHTML = highlightJson(obj);
    card.appendChild(pre);
    resultEl.appendChild(card);
  }

  /* 签名说明 */
  const sig = document.createElement('div');
  sig.className = 'muted';
  sig.textContent = hasSig
    ? `签名段：${header.alg || '?'} 签名，仅校验数据完整性，无法在浏览器解码；验签需服务端公钥，本工具不验证签名是否有效。`
    : '该 token 无签名段（两段式），未通过签名保护。';
  resultEl.appendChild(sig);
}

/* ---------- 入口与事件 ---------- */

function show(msg, cls) {
  statusEl.textContent = msg;
  statusEl.className = 'status ' + cls;
}

function run() {
  const raw = input.value.trim();
  if (!raw) { statusEl.className = 'status'; resultEl.innerHTML = ''; return; }
  try {
    const { header, payload, hasSig } = parseToken(raw);
    render(header, payload, hasSig);
    show('解析成功', 'ok');
  } catch (e) {
    resultEl.innerHTML = '';
    show(e.message, 'error');
  }
}

let timer;
input.addEventListener('input', () => {
  clearTimeout(timer);
  timer = setTimeout(run, 200);
});

$('clearBtn').onclick = () => { input.value = ''; run(); input.focus(); };

$('demoBtn').onclick = () => {
  const b64 = o => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const payload = {
    clientSource: 'pc', aud: ['mobile-resource'], user_name: 'demo', scope: ['read'], sys: 'eb',
    exp: Math.floor(Date.now() / 1000) + 7 * 86400,
    authorities: ['ROLE_Normal', 'ROLE_admin'], jti: '6a45d73e-c2d9-4874-aeae-6616bf31f4cd', client_id: 'm1'
  };
  input.value = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64(payload)}.demo_signature_not_verified`;
  run();
};

// 右键菜单「解析选中的 JWT」带入的文本
chrome.storage.session.get('jwtSelection').then(({ jwtSelection }) => {
  if (jwtSelection) {
    input.value = jwtSelection;
    run();
    chrome.storage.session.remove('jwtSelection');
  }
});
