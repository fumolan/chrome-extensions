import {
  ITER_DEFAULT,
  bufToB64,
  b64ToBuf,
  deriveKey,
  exportKeyB64,
  importKeyB64,
  encryptJSON,
  decryptJSON,
  loadVault,
  saveVault,
  getSessionKey,
  setSessionKey,
  clearSessionKey,
  touch,
} from '../vault.js';

const $ = (id) => document.getElementById(id);
const views = {
  setup: $('setupView'),
  lock: $('lockView'),
  main: $('mainView'),
  detail: $('detailView'),
  edit: $('editView'),
};

let key = null; // 解锁后的 CryptoKey
let entries = []; // 解密后的条目
let detailId = null;
let editingId = null; // null = 新增
let pwVisible = false;
let delTimer = null;

function show(name) {
  for (const [n, el] of Object.entries(views)) el.classList.toggle('hidden', n !== name);
}

function errMsg(el, text) {
  el.textContent = text;
  el.classList.remove('hidden');
}
function clearMsg(el) {
  el.classList.add('hidden');
}

// 按钮短暂反馈：变绿显示文字后还原
function flashBtn(btn, text, ms = 1400) {
  const old = btn.textContent;
  btn.textContent = text;
  btn.classList.add('flash');
  setTimeout(() => {
    btn.textContent = old;
    btn.classList.remove('flash');
  }, ms);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
}

// ---------- 初始化 / 解锁 / 设置 ----------

async function init() {
  const meta = await loadVault();
  if (!meta) {
    show('setup');
    $('setupPw1').focus();
    return;
  }
  const sk = await getSessionKey();
  if (sk) {
    try {
      key = await importKeyB64(sk);
      entries = await decryptJSON(key, meta.iv, meta.data);
      await touch();
      showMain();
      return;
    } catch {
      key = null;
      await clearSessionKey();
    }
  }
  show('lock');
  $('unlockPw').focus();
}

async function doSetup() {
  const m = $('setupMsg');
  clearMsg(m);
  const p1 = $('setupPw1').value;
  const p2 = $('setupPw2').value;
  if (p1.length < 8) return errMsg(m, '主密码至少 8 个字符');
  if (p1 !== p2) return errMsg(m, '两次输入不一致');
  const btn = $('setupBtn');
  btn.disabled = true;
  btn.textContent = '创建中…';
  try {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    key = await deriveKey(p1, salt, ITER_DEFAULT);
    entries = [];
    const { iv, data } = await encryptJSON(key, entries);
    await saveVault({ v: 1, salt: bufToB64(salt), iter: ITER_DEFAULT, iv, data });
    await setSessionKey(await exportKeyB64(key));
    await touch();
    $('setupPw1').value = $('setupPw2').value = '';
    showMain();
  } catch (e) {
    errMsg(m, '创建失败：' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '创建密码库';
  }
}

async function doUnlock() {
  const m = $('unlockMsg');
  clearMsg(m);
  const pw = $('unlockPw').value;
  if (!pw) return;
  const btn = $('unlockBtn');
  btn.disabled = true;
  btn.textContent = '解密中…';
  try {
    const meta = await loadVault();
    if (!meta) {
      show('setup');
      return;
    }
    const k = await deriveKey(pw, b64ToBuf(meta.salt), meta.iter);
    entries = await decryptJSON(k, meta.iv, meta.data); // 密码错误时此处抛异常
    key = k;
    await setSessionKey(await exportKeyB64(k));
    await touch();
    $('unlockPw').value = '';
    showMain();
  } catch {
    errMsg(m, '主密码错误');
  } finally {
    btn.disabled = false;
    btn.textContent = '解锁';
  }
}

// ---------- 主列表 ----------

function showMain() {
  $('search').value = '';
  show('main');
  renderList();
}

function renderList() {
  const q = $('search').value.trim().toLowerCase();
  const list = $('entryList');
  list.innerHTML = '';
  const items = entries.filter(
    (e) =>
      !q ||
      [e.title, e.url, e.username, e.notes].some((v) => (v || '').toLowerCase().includes(q))
  );
  for (const e of items) {
    const li = document.createElement('li');
    li.className = 'entry-row';
    const main = document.createElement('div');
    main.className = 'entry-main';
    const t = document.createElement('div');
    t.className = 'entry-title';
    t.textContent = e.title;
    const s = document.createElement('div');
    s.className = 'entry-sub';
    s.textContent = e.username || '';
    main.append(t, s);
    main.addEventListener('click', () => openDetail(e.id));
    const cp = document.createElement('button');
    cp.className = 'btn sm';
    cp.textContent = '复制密码';
    cp.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      await copyText(e.password);
      flashBtn(cp, '已复制');
    });
    li.append(main, cp);
    list.appendChild(li);
  }
  const hint = $('emptyHint');
  if (entries.length === 0) {
    hint.textContent = '暂无条目，点右上角 ＋ 添加';
    hint.classList.remove('hidden');
  } else if (items.length === 0) {
    hint.textContent = '无匹配结果';
    hint.classList.remove('hidden');
  } else {
    hint.classList.add('hidden');
  }
  $('vaultCount').textContent = entries.length ? `共 ${entries.length} 条` : '';
}

// ---------- 详情 ----------

function findEntry(id) {
  return entries.find((e) => e.id === id) || null;
}

function openDetail(id) {
  const e = findEntry(id);
  if (!e) return showMain();
  detailId = id;
  pwVisible = false;
  $('dTitle').textContent = e.title;
  $('dUrl').textContent = e.url || '—';
  $('dUser').textContent = e.username || '—';
  $('dPass').textContent = e.password ? '••••••••' : '—';
  $('dShow').textContent = '显示';
  $('dNotes').textContent = e.notes || '—';
  $('delBtn').textContent = '删除';
  $('delBtn').dataset.armed = '';
  show('detail');
}

$('dBack').addEventListener('click', showMain);

$('dShow').addEventListener('click', () => {
  const e = findEntry(detailId);
  if (!e || !e.password) return;
  pwVisible = !pwVisible;
  $('dPass').textContent = pwVisible ? e.password : '••••••••';
  $('dShow').textContent = pwVisible ? '隐藏' : '显示';
});

$('dCopyUrl').addEventListener('click', async () => {
  const e = findEntry(detailId);
  if (e && e.url) {
    await copyText(e.url);
    flashBtn($('dCopyUrl'), '已复制');
  }
});
$('dCopyUser').addEventListener('click', async () => {
  const e = findEntry(detailId);
  if (e && e.username) {
    await copyText(e.username);
    flashBtn($('dCopyUser'), '已复制');
  }
});
$('dCopyPass').addEventListener('click', async () => {
  const e = findEntry(detailId);
  if (e && e.password) {
    await copyText(e.password);
    flashBtn($('dCopyPass'), '已复制');
  }
});

$('dOpen').addEventListener('click', () => {
  const e = findEntry(detailId);
  let u = (e && e.url && e.url.trim()) || '';
  if (!u) return;
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  try {
    chrome.tabs.create({ url: new URL(u).href });
  } catch {
    /* 非法 URL 忽略 */
  }
});

// 注入到当前页面的填充函数（必须独立、不引用闭包）
function fillPage(username, password) {
  const vis = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  const fire = (el) => {
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const setVal = (el, v) => {
    if (!el) return;
    el.focus();
    el.value = v;
    fire(el);
  };
  const pws = [...document.querySelectorAll('input[type=password]')].filter(vis);
  if (!pws.length) return 0;
  const pw = pws[0];
  const scope = pw.form || pw.closest('form') || document;
  const textLike = (i) =>
    vis(i) && ['text', 'email', 'tel'].includes((i.getAttribute('type') || 'text').toLowerCase());
  let cands = [...scope.querySelectorAll('input')].filter(textLike);
  if (!cands.length) {
    const all = [...document.querySelectorAll('input')];
    cands = all.slice(0, all.indexOf(pw)).filter(textLike);
  }
  const user =
    cands.find((i) => (i.getAttribute('type') || '').toLowerCase() === 'email') ||
    cands[cands.length - 1] ||
    null;
  setVal(user, username);
  setVal(pw, password);
  return user ? 2 : 1;
}

$('fillBtn').addEventListener('click', async () => {
  const e = findEntry(detailId);
  if (!e) return;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || tab.id === undefined) throw new Error('no-tab');
    const [res] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: fillPage,
      args: [e.username || '', e.password],
    });
    if (res == null || res.result === 0) flashBtn($('fillBtn'), '未找到登录框', 1800);
    else flashBtn($('fillBtn'), '已填充', 1800);
  } catch {
    flashBtn($('fillBtn'), '此页面不支持填充', 1800);
  }
});

$('editBtn').addEventListener('click', () => openEdit(detailId));

$('delBtn').addEventListener('click', async () => {
  const btn = $('delBtn');
  if (!btn.dataset.armed) {
    btn.dataset.armed = '1';
    btn.textContent = '确认删除？';
    clearTimeout(delTimer);
    delTimer = setTimeout(() => {
      btn.dataset.armed = '';
      btn.textContent = '删除';
    }, 3000);
    return;
  }
  clearTimeout(delTimer);
  btn.dataset.armed = '';
  entries = entries.filter((x) => x.id !== detailId);
  await persist();
  showMain();
});

// ---------- 编辑 / 新增 ----------

function openEdit(id) {
  editingId = id || null;
  clearMsg($('editMsg'));
  const e = id ? findEntry(id) : null;
  $('editHeading').textContent = e ? '编辑条目' : '新增条目';
  $('fTitle').value = e ? e.title : '';
  $('fUrl').value = e ? e.url || '' : '';
  $('fUser').value = e ? e.username || '' : '';
  $('fPass').value = e ? e.password || '' : '';
  $('fPass').type = 'password';
  $('fShow').textContent = '显示';
  $('fNotes').value = e ? e.notes || '' : '';
  show('edit');
  $('fTitle').focus();
}

$('eBack').addEventListener('click', () => {
  if (editingId) openDetail(editingId);
  else showMain();
});

$('fShow').addEventListener('click', () => {
  const showPw = $('fPass').type === 'password';
  $('fPass').type = showPw ? 'text' : 'password';
  $('fShow').textContent = showPw ? '隐藏' : '显示';
});

function rndInt(max) {
  const limit = 0x100000000 - (0x100000000 % max);
  const u = new Uint32Array(1);
  do {
    crypto.getRandomValues(u);
  } while (u[0] >= limit);
  return u[0] % max;
}

function genPassword(len, useSym) {
  const lower = 'abcdefghijkmnpqrstuvwxyz';
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const digits = '23456789';
  const syms = '!@#$%^&*-_=+';
  const all = lower + upper + digits + (useSym ? syms : '');
  const chars = [lower, upper, digits, ...(useSym ? [syms] : [])].map((set) => set[rndInt(set.length)]);
  while (chars.length < len) chars.push(all[rndInt(all.length)]);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = rndInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

$('fGen').addEventListener('click', () => {
  const len = Math.min(64, Math.max(8, parseInt($('fLen').value, 10) || 16));
  $('fLen').value = len;
  $('fPass').value = genPassword(len, $('fSym').checked);
  $('fPass').type = 'text';
  $('fShow').textContent = '隐藏';
});

$('saveBtn').addEventListener('click', async () => {
  const m = $('editMsg');
  clearMsg(m);
  const title = $('fTitle').value.trim();
  if (!title) return errMsg(m, '名称不能为空');
  const now = Date.now();
  const fields = {
    title,
    url: $('fUrl').value.trim(),
    username: $('fUser').value.trim(),
    password: $('fPass').value,
    notes: $('fNotes').value.trim(),
  };
  if (editingId) {
    const e = findEntry(editingId);
    Object.assign(e, fields, { updatedAt: now });
  } else {
    entries.push({ id: crypto.randomUUID(), createdAt: now, updatedAt: now, ...fields });
  }
  await persist();
  if (editingId) openDetail(editingId);
  else showMain();
});

async function persist() {
  const meta = await loadVault();
  const { iv, data } = await encryptJSON(key, entries);
  await saveVault({ ...meta, iv, data });
  await touch();
}

// ---------- 锁定 / 备份 ----------

$('lockNowBtn').addEventListener('click', async () => {
  await clearSessionKey();
  key = null;
  entries = [];
  clearMsg($('unlockMsg'));
  show('lock');
  $('unlockPw').value = '';
  $('unlockPw').focus();
});

$('exportBtn').addEventListener('click', async () => {
  const meta = await loadVault();
  if (!meta) return;
  const blob = new Blob([JSON.stringify(meta, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  try {
    await chrome.downloads.download({
      url,
      filename: `password-vault-backup-${stamp}.json`,
      saveAs: true,
    });
    flashBtn($('exportBtn'), '已导出', 1800);
  } catch {
    errMsg($('mainMsg'), '导出失败');
  }
  setTimeout(() => URL.revokeObjectURL(url), 60000);
});

$('importBtn').addEventListener('click', () => $('importFile').click());
$('importFile').addEventListener('change', async (ev) => {
  const f = ev.target.files[0];
  ev.target.value = '';
  if (!f) return;
  clearMsg($('mainMsg'));
  try {
    const obj = JSON.parse(await f.text());
    if (!obj || obj.v !== 1 || !obj.salt || !obj.iter || !obj.iv || !obj.data) throw new Error('bad');
    await saveVault(obj);
    await clearSessionKey();
    key = null;
    entries = [];
    clearMsg($('unlockMsg'));
    show('lock');
    $('unlockPw').focus();
  } catch {
    errMsg($('mainMsg'), '备份文件无效');
  }
});

// ---------- 事件绑定：初始化视图 ----------

$('setupBtn').addEventListener('click', doSetup);
$('setupPw2').addEventListener('keydown', (ev) => ev.key === 'Enter' && doSetup());
$('unlockBtn').addEventListener('click', doUnlock);
$('unlockPw').addEventListener('keydown', (ev) => ev.key === 'Enter' && doUnlock());
$('search').addEventListener('input', renderList);
$('addBtn').addEventListener('click', () => openEdit(null));
$('fTitle').addEventListener('keydown', (ev) => ev.key === 'Enter' && $('saveBtn').click());
$('fPass').addEventListener('keydown', (ev) => ev.key === 'Enter' && $('saveBtn').click());

init();
