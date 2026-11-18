// 二维码生成工具：内嵌 qrcode-generator（MIT, Kazuhiko Arase）纯本地编码，不上传任何内容
const $ = (id) => document.getElementById(id);
const input = $('input');
const statusEl = $('status');
const HIST_KEY = 'qrHistory';
const CELL = 8, MARGIN = 4; // PNG 像素/模块 与 四周留白模块数

// 默认编码是 latin 单字节，切到 UTF-8 才能编中文
qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];

/* ---------- 生成 ---------- */

function buildQr(text, ecc) {
  const qr = qrcode(0, ecc); // typeNumber 0 = 自动选最小可用版本
  qr.addData(text, 'Byte');
  qr.make();
  return qr;
}

function qrToSvg(qr) {
  const n = qr.getModuleCount();
  const dim = (n + MARGIN * 2) * CELL;
  let d = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.isDark(r, c)) d += `M${(c + MARGIN) * CELL} ${(r + MARGIN) * CELL}h${CELL}v${CELL}h-${CELL}z`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${dim}" height="${dim}" viewBox="0 0 ${dim} ${dim}" shape-rendering="crispEdges"><rect width="${dim}" height="${dim}" fill="#ffffff"/><path d="${d}" fill="#000000"/></svg>`;
}

function qrToCanvas(qr) {
  const n = qr.getModuleCount();
  const dim = (n + MARGIN * 2) * CELL;
  const cv = document.createElement('canvas');
  cv.width = dim;
  cv.height = dim;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, dim, dim);
  ctx.fillStyle = '#000000';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.isDark(r, c)) ctx.fillRect((c + MARGIN) * CELL, (r + MARGIN) * CELL, CELL, CELL);
    }
  }
  return cv;
}

/* ---------- 渲染 ---------- */

let current = null; // { qr, text }

function esc(v) {
  return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function show(msg, cls) {
  statusEl.textContent = msg;
  statusEl.className = 'status ' + cls;
}

function render() {
  const text = input.value.trim();
  if (!text) {
    $('outCard').hidden = true;
    statusEl.className = 'status';
    current = null;
    return;
  }
  try {
    const qr = buildQr(text, $('ecc').value);
    current = { qr, text };
    $('qrCard').innerHTML = qrToSvg(qr);
    const bytes = new TextEncoder().encode(text).length;
    const n = qr.getModuleCount();
    $('meta').textContent =
      `版本 ${(n - 17) / 4} · ${n}×${n} 模块 · ${bytes} 字节`;
    // 「关于二维码」折叠区：随输入实时更新的编码参数
    const eccPct = { L: 'L · 约可恢复 7%', M: 'M · 约可恢复 15%', Q: 'Q · 约可恢复 25%', H: 'H · 约可恢复 30%' }[$('ecc').value];
    $('abInfo').textContent = `Byte + UTF-8 · ${bytes} 字节 · 版本 ${(n - 17) / 4}（${n}×${n} 模块）`;
    $('abEcc').textContent = eccPct;
    $('outCard').hidden = false;
    statusEl.className = 'status';
    saveHistory(text);
  } catch (e) {
    $('outCard').hidden = true;
    current = null;
    show(`生成失败：内容太长或含不可编码字符（${e.message}）`, 'error');
  }
}

let timer;
input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(render, 300); });
$('ecc').addEventListener('change', render);

/* ---------- 历史（本机 storage，最近 8 条） ---------- */

async function getHistory() {
  const got = await chrome.storage.local.get(HIST_KEY);
  return got[HIST_KEY] || [];
}

async function saveHistory(text) {
  const list = (await getHistory()).filter(x => x !== text);
  list.unshift(text);
  const trimmed = list.slice(0, 8);
  await chrome.storage.local.set({ [HIST_KEY]: trimmed });
  renderHistory(trimmed);
}

function renderHistory(list) {
  const box = $('historyBox');
  box.innerHTML = '';
  if (!list || !list.length) {
    box.innerHTML = '<div class="muted">还没有生成记录。</div>';
    return;
  }
  for (const text of list) {
    const b = document.createElement('button');
    b.className = 'hist-chip';
    b.textContent = text;
    b.title = text;
    b.onclick = () => {
      input.value = text;
      render();
      input.focus();
    };
    box.appendChild(b);
  }
}

/* ---------- 导出按钮 ---------- */

$('downloadPngBtn').onclick = function () {
  if (!current) { show('先输入内容生成二维码', 'error'); return; }
  qrToCanvas(current.qr).toBlob(blob => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'qrcode.png';
    a.click();
    URL.revokeObjectURL(a.href);
    this.textContent = '已下载 ✓';
    setTimeout(() => (this.textContent = '下载 PNG'), 1200);
  });
};

$('copyImgBtn').onclick = async function () {
  if (!current) { show('先输入内容生成二维码', 'error'); return; }
  try {
    const blob = await new Promise(r => qrToCanvas(current.qr).toBlob(r));
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    this.textContent = '已复制 ✓';
    setTimeout(() => (this.textContent = '复制图片'), 1200);
  } catch (e) {
    show(`复制图片失败（${e.message}），可用「下载 PNG」代替`, 'error');
  }
};

$('copyTextBtn').onclick = async function () {
  if (!current) { show('先输入内容生成二维码', 'error'); return; }
  await navigator.clipboard.writeText(current.text);
  this.textContent = '已复制 ✓';
  setTimeout(() => (this.textContent = '复制文本'), 1200);
};

/* ---------- 右键菜单「生成二维码」带入 + 初始化 ---------- */

(async () => {
  try {
    const got = await chrome.storage.session.get('qrSelection');
    if (got.qrSelection) {
      input.value = got.qrSelection;
      chrome.storage.session.remove('qrSelection');
    }
  } catch (e) { /* 无 session 权限环境忽略 */ }
  renderHistory(await getHistory());
  render();
})();
