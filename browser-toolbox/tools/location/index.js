// 位置 / GPS 工具：定位与坐标转换纯本地；「外卖/收件地址」按需调用高德逆地理接口（唯一联网功能）
const $ = (id) => document.getElementById(id);
const statusEl = $('status');
const resultEl = $('result');

let lastFix = null; // { coords: GeolocationCoordinates, timestamp, srcIsGcj }

/* ---------- 坐标转换（纯本地） ---------- */

const PI = Math.PI, A = 6378245.0, EE = 0.00669342162296594323;

// 中国大陆及邻区才有 GCJ-02 偏移，境外原样返回
function outOfChina(lng, lat) {
  return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271;
}

function transformLat(x, y) {
  let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  ret += (20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0 / 3.0;
  ret += (20.0 * Math.sin(y * PI) + 40.0 * Math.sin(y / 3.0 * PI)) * 2.0 / 3.0;
  ret += (160.0 * Math.sin(y / 12.0 * PI) + 320.0 * Math.sin(y * PI / 30.0)) * 2.0 / 3.0;
  return ret;
}

function transformLng(x, y) {
  let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  ret += (20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0 / 3.0;
  ret += (20.0 * Math.sin(x * PI) + 40.0 * Math.sin(x / 3.0 * PI)) * 2.0 / 3.0;
  ret += (150.0 * Math.sin(x / 12.0 * PI) + 300.0 * Math.sin(x / 30.0 * PI)) * 2.0 / 3.0;
  return ret;
}

// WGS-84 → GCJ-02（国测局偏移）
function wgs84ToGcj02(lng, lat) {
  if (outOfChina(lng, lat)) return [lng, lat];
  let dLat = transformLat(lng - 105.0, lat - 35.0);
  let dLng = transformLng(lng - 105.0, lat - 35.0);
  const radLat = lat / 180.0 * PI;
  let magic = Math.sin(radLat);
  magic = 1 - EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180.0) / ((A * (1 - EE)) / (magic * sqrtMagic) * PI);
  dLng = (dLng * 180.0) / (A / sqrtMagic * Math.cos(radLat) * PI);
  return [lng + dLng, lat + dLat];
}

// GCJ-02 → WGS-84（近似反推，误差约 1–2 米）
function gcj02ToWgs84(lng, lat) {
  const [gLng, gLat] = wgs84ToGcj02(lng, lat);
  return [lng * 2 - gLng, lat * 2 - gLat];
}

// GCJ-02 → BD-09（百度坐标）
function gcj02ToBd09(lng, lat) {
  const z = Math.sqrt(lng * lng + lat * lat) + 0.00002 * Math.sin(lat * 3000 * PI / 180);
  const theta = Math.atan2(lat, lng) + 0.000003 * Math.cos(lng * 3000 * PI / 180);
  return [z * Math.cos(theta) + 0.0065, z * Math.sin(theta) + 0.006];
}

// 三套坐标系一次算齐，src 指定定位结果的解读方式
function toAllSystems(lng, lat, src) {
  if (src === 'gcj02') {
    return { wgs: gcj02ToWgs84(lng, lat), gcj: [lng, lat], bd: gcj02ToBd09(lng, lat) };
  }
  const gcj = wgs84ToGcj02(lng, lat);
  return { wgs: [lng, lat], gcj, bd: gcj02ToBd09(gcj[0], gcj[1]) };
}

/* ---------- 格式化 ---------- */

function esc(v) {
  return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// 十进制经纬度 → 度分秒，如 39°54′22.4″N
function toDms(v, isLat) {
  const dir = isLat ? (v >= 0 ? 'N' : 'S') : (v >= 0 ? 'E' : 'W');
  const a = Math.abs(v);
  const d = Math.floor(a);
  const mFull = (a - d) * 60;
  const m = Math.floor(mFull);
  const s = ((mFull - m) * 60).toFixed(1);
  return `${d}°${String(m).padStart(2, '0')}′${String(s).padStart(4, '0')}″${dir}`;
}

// 距离格式化：<1km 用米，≥1km 用公里一位小数
function formatDist(m) {
  return m < 1000 ? `${Math.round(m)}米` : `${(m / 1000).toFixed(1)}公里`;
}

function copyBtn(text) {
  const btn = document.createElement('button');
  btn.className = 'btn-sm';
  btn.textContent = '复制';
  btn.onclick = async function () {
    await navigator.clipboard.writeText(typeof text === 'function' ? text() : text);
    this.textContent = '已复制 ✓';
    setTimeout(() => (this.textContent = '复制'), 1200);
  };
  return btn;
}

function kvRow(k, vEl, copyText) {
  const row = document.createElement('div');
  row.className = 'kv';
  const kEl = document.createElement('span');
  kEl.className = 'k';
  kEl.textContent = k;
  row.append(kEl, vEl);
  if (copyText != null) row.appendChild(copyBtn(copyText));
  return row;
}

function vSpan(text, muted) {
  const v = document.createElement('span');
  v.className = 'v';
  if (muted) v.style.color = 'var(--muted)';
  v.textContent = text;
  return v;
}

/* ---------- 定位渲染 ---------- */

function coordCard(systems) {
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `<div class="card-head"><h2>坐标系统</h2>
    <span class="muted">定位结果按
      <label style="margin-left:2px"><input type="radio" name="coordSrc" value="wgs84"> WGS-84</label>
      <label style="margin-left:6px"><input type="radio" name="coordSrc" value="gcj02"> GCJ-02</label>
    </span></div>`;

  const wgs = systems.wgs, gcj = systems.gcj, bd = systems.bd;
  card.append(
    kvRow('WGS-84', vSpan(`${wgs[1].toFixed(6)}, ${wgs[0].toFixed(6)}（Google / OSM / GPS 原始）`), () => `${wgs[1]},${wgs[0]}`),
    kvRow('GCJ-02 火星', vSpan(`${gcj[1].toFixed(6)}, ${gcj[0].toFixed(6)}（高德 / 腾讯）`), () => `${gcj[1]},${gcj[0]}`),
    kvRow('BD-09', vSpan(`${bd[1].toFixed(6)}, ${bd[0].toFixed(6)}（百度）`), () => `${bd[1]},${bd[0]}`),
    kvRow('度分秒', vSpan(`${toDms(wgs[1], true)} ${toDms(wgs[0], false)}`), () => `${toDms(wgs[1], true)} ${toDms(wgs[0], false)}`)
  );

  const src = card.querySelector('input[value="wgs84"]');
  src.checked = !lastFix.srcIsGcj;
  card.querySelector('input[value="gcj02"]').checked = lastFix.srcIsGcj;
  card.querySelectorAll('input[name="coordSrc"]').forEach(r =>
    r.addEventListener('change', () => {
      lastFix.srcIsGcj = r.value === 'gcj02' && r.checked;
      render(lastFix);
    }));
  return card;
}

function render(fix) {
  const c = fix.coords;
  resultEl.innerHTML = '';

  /* 摘要 chips */
  const sum = document.createElement('div');
  sum.className = 'card';
  const acc = c.accuracy;
  const accColor = acc <= 30 ? 'var(--ok)' : acc <= 200 ? 'var(--accent)' : 'var(--danger)';
  sum.innerHTML = `<div class="chips">
    <span class="chip">纬度 ${esc(c.latitude.toFixed(6))}</span>
    <span class="chip">经度 ${esc(c.longitude.toFixed(6))}</span>
    <span class="chip" style="color:${accColor}">精度 ±${esc(acc.toFixed(0))} 米</span>
  </div>`;
  sum.appendChild(kvRow('「纬度,经度」', vSpan(`${c.latitude.toFixed(6)},${c.longitude.toFixed(6)}`), () => `${c.latitude},${c.longitude}`));
  resultEl.appendChild(sum);

  /* GPS 详情 */
  const detail = document.createElement('div');
  detail.className = 'card';
  detail.innerHTML = '<div class="card-head"><h2>定位详情</h2></div>';
  const p = (v, unit) => (v == null || Number.isNaN(v) ? vSpan('不可用', true) : vSpan(`${v}${unit}`));
  const fixTime = new Date(fix.timestamp);
  detail.append(
    kvRow('海拔', p(c.altitude, c.altitude != null ? ' 米' : '')),
    kvRow('海拔精度', p(c.altitudeAccuracy, c.altitudeAccuracy != null ? ' 米' : '')),
    kvRow('航向', p(c.heading, c.heading != null ? '°（正北=0）' : '')),
    kvRow('速度', p(c.speed, c.speed != null ? ' 米/秒' : '')),
    kvRow('定位时刻', vSpan(fixTime.toLocaleString('zh-CN', { hour12: false })))
  );
  resultEl.appendChild(detail);

  /* 坐标系统 */
  const systems = toAllSystems(c.longitude, c.latitude, lastFix.srcIsGcj ? 'gcj02' : 'wgs84');
  resultEl.appendChild(coordCard(systems));

  /* 地图链接 */
  const mapsCard = document.createElement('div');
  mapsCard.className = 'card';
  mapsCard.innerHTML = '<div class="card-head"><h2>在地图中查看</h2><span class="muted">点击后于新标签页打开</span></div>';
  const wrap = document.createElement('div');
  wrap.className = 'maps';
  const wgs = systems.wgs, gcj = systems.gcj, bd = systems.bd;
  const links = [
    ['高德地图', `https://uri.amap.com/marker?position=${gcj[0]},${gcj[1]}&name=当前位置`],
    ['百度地图', `https://api.map.baidu.com/marker?location=${bd[1]},${bd[0]}&coord_type=bd09ll&title=当前位置&content=当前位置&output=html&src=browser-toolbox`],
    ['Google 地图', `https://www.google.com/maps?q=${wgs[1]},${wgs[0]}`],
    ['OpenStreetMap', `https://www.openstreetmap.org/?mlat=${wgs[1]}&mlon=${wgs[0]}#map=17/${wgs[1]}/${wgs[0]}`],
  ];
  for (const [name, url] of links) {
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noreferrer';
    a.textContent = name;
    wrap.appendChild(a);
  }
  mapsCard.appendChild(wrap);
  resultEl.appendChild(mapsCard);
}

/* ---------- 定位入口 ---------- */

function show(msg, cls) {
  statusEl.textContent = msg;
  statusEl.className = 'status ' + cls;
}

const ERROR_TEXT = {
  1: '定位授权被拒绝：检查浏览器地址栏的定位权限，以及系统设置里是否允许浏览器获取位置。',
  2: '无法获取位置：设备没有可用的定位来源（无 GPS/Wi-Fi 信息），或系统定位服务未开启。',
  3: '定位超时：信号太弱，可勾选「高精度」后重试，或到窗口开阔处再试。',
};

$('locBtn').onclick = function () {
  if (!('geolocation' in navigator)) {
    show('当前浏览器不支持 Geolocation API', 'error');
    return;
  }
  const btn = this;
  btn.disabled = true;
  btn.textContent = '定位中…';
  show('正在获取位置…', 'ok');
  navigator.geolocation.getCurrentPosition(pos => {
    btn.disabled = false;
    btn.textContent = '重新获取';
    lastFix = { coords: pos.coords, timestamp: pos.timestamp, srcIsGcj: lastFix?.srcIsGcj || false };
    statusEl.className = 'status';
    render(lastFix);
    if (amapKey) queryRegeo(); // 配置了 Key 就自动查附近地址
  }, err => {
    btn.disabled = false;
    btn.textContent = '重新获取';
    show(ERROR_TEXT[err.code] || `定位失败（${err.message}）`, 'error');
  }, {
    enableHighAccuracy: $('highAcc').checked,
    timeout: 15000,
    maximumAge: 0
  });
};

/* =========================================================
   外卖 / 收件地址：高德逆地理 + 编辑器 + 本地保存
   ========================================================= */

const KEY_STORAGE = 'amapKey';
const LIST_STORAGE = 'deliveryAddrs';

let amapKey = '';
let regeoResult = null; // 高德逆地理原始结果
let editingId = null;   // 正在编辑的保存条目 id

const frm = {
  label: $('daLabel'), addr: $('daAddr'), building: $('daBuilding'),
  floor: $('daFloor'), room: $('daRoom'), note: $('daNote'),
};

// 把地址字段拼成一行外卖常用格式；纯数字的楼层/房号自动补「层/室」
function buildAddrLine(a) {
  const seg = [];
  if (a.addr) seg.push(a.addr);
  if (a.building) seg.push(a.building);
  const floor = a.floor ? (/^\d+$/.test(a.floor.trim()) ? a.floor.trim() + '层' : a.floor.trim()) : '';
  const room = a.room ? (/^\d+$/.test(a.room.trim()) ? a.room.trim() + '室' : a.room.trim()) : '';
  const mid = [floor, room].filter(Boolean).join('');
  if (mid) seg.push(mid);
  return seg.join('，');
}

/* ---------- Key 配置 ---------- */

// Key 框防窥防复制：密文显示，禁止复制/剪切/右键菜单（粘贴仍允许，便于更换 Key）
for (const evt of ['copy', 'cut', 'contextmenu']) {
  $('keyInput').addEventListener(evt, e => e.preventDefault());
}

function keyConfigured() {
  $('keyHint').textContent = amapKey
    ? '已配置 Key：定位成功后自动查询附近地址，地址搜索与路径规划也可用。'
    : '未配置 Key：到 lbs.amap.com 免费注册，创建应用 → 添加 Key → 服务平台选「Web服务」，粘贴到上面保存。';
  updateKeyBadge();
}

/* ---------- 视图页签（记住上次停留）+ Key 徽章 ---------- */

const VIEW_KEY = 'locationTab';

function switchView(name) {
  document.querySelectorAll('section.view').forEach(v => { v.hidden = v.id !== 'view-' + name; });
  document.querySelectorAll('.view-tabs button').forEach(b => b.classList.toggle('active', b.dataset.view === name));
  chrome.storage.local.set({ [VIEW_KEY]: name }).catch(() => {});
}

document.querySelectorAll('.view-tabs button').forEach(b => {
  b.addEventListener('click', () => switchView(b.dataset.view));
});

function updateKeyBadge() {
  const b = $('keyBadge');
  b.textContent = amapKey ? 'Key 已配置 ✓' : 'Key 未配置';
  b.classList.toggle('ok', !!amapKey);
  b.classList.toggle('unset', !amapKey);
}

$('keyBadge').addEventListener('click', () => {
  $('keyPanel').hidden = !$('keyPanel').hidden;
});

$('saveKeyBtn').onclick = async () => {
  amapKey = $('keyInput').value.trim();
  await chrome.storage.local.set({ [KEY_STORAGE]: amapKey });
  keyConfigured();
  show(amapKey ? 'Key 已保存（仅存本机）' : 'Key 已清空', 'ok');
};

/* ---------- 逆地理查询 ---------- */

async function queryRegeo() {
  if (!lastFix) { show('请先点上方「获取当前位置」', 'error'); return; }
  if (!amapKey) { show('请先配置高德「Web服务」Key', 'error'); $('keyInput').focus(); return; }
  const btn = $('regeoBtn');
  btn.disabled = true;
  btn.textContent = '查询中…';
  try {
    // 高德用 GCJ-02，无论定位结果按哪种解读都取 gcj 分量
    const { gcj } = toAllSystems(lastFix.coords.longitude, lastFix.coords.latitude, lastFix.srcIsGcj ? 'gcj02' : 'wgs84');
    const url = `https://restapi.amap.com/v3/geocode/regeo?key=${encodeURIComponent(amapKey)}` +
      `&location=${gcj[0].toFixed(6)},${gcj[1].toFixed(6)}&radius=300&extensions=all`;
    const resp = await fetch(url);
    const data = await resp.json();
    if (data.status !== '1') {
      let hint = '';
      if (data.infocode === '10009') hint = '（Key 平台类型不匹配：添加 Key 时服务平台必须选「Web服务」，「Web端(JS API)」等其他类型调不了 REST 接口，需新建一个 Web服务 类型的 Key）';
      else if (data.infocode === '10001' || data.infocode === '10008') hint = '（Key 无效：确认是「Web服务」类型 Key）';
      else if (data.infocode === '10003') hint = '（今日配额已用完或并发超限）';
      show(`高德接口返回失败：${data.info || '未知错误'} ${hint}`, 'error');
    } else {
      regeoResult = data.regeocode || {};
      renderRegeo();
      show('附近地址已更新', 'ok');
    }
  } catch (e) {
    show(`查询失败：网络错误或接口不可达（${e.message}）`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '查询附近地址';
  }
}

$('regeoBtn').onclick = () => queryRegeo();

function renderRegeo() {
  const r = regeoResult;
  const ac = r.addressComponent || {};
  const city = Array.isArray(ac.city) ? '' : (ac.city || ''); // 直辖市 city 为空数组
  const sn = ac.streetNumber || {};
  const doorplate = [sn.street, sn.number].filter(Boolean).join('');
  const box = $('regeoBox');
  box.innerHTML = '';

  // 标准地址
  const line = document.createElement('div');
  line.className = 'kv';
  line.innerHTML = `<span class="k">标准地址</span><span class="v grow">${esc(r.formatted_address || '—')}</span>`;
  line.appendChild(copyBtn(r.formatted_address || ''));
  box.appendChild(line);

  // 省市区 + 门牌 chips
  const meta = document.createElement('div');
  meta.className = 'chips';
  meta.style.marginTop = '6px';
  meta.innerHTML = [[ac.province, ''], [city, ''], [ac.district, ''], [doorplate, '门牌 ']]
    .filter(([v]) => v)
    .map(([v, pre]) => `<span class="chip">${esc(pre + v)}</span>`)
    .join('');
  if (meta.innerHTML) box.appendChild(meta);

  // 精度不足提醒
  if (lastFix && lastFix.coords.accuracy > 200) {
    const warn = document.createElement('div');
    warn.className = 'muted';
    warn.style.color = 'var(--danger)';
    warn.style.marginTop = '6px';
    warn.textContent = `定位精度 ±${lastFix.coords.accuracy.toFixed(0)} 米，偏弱：以下候选请人工核对门牌。`;
    box.appendChild(warn);
  }

  // 附近 POI 候选（按距离排序，点选填入地址框 —— 容错：多个候选挑最对的）
  const pois = (r.pois || []).slice()
    .sort((a, b) => (parseFloat(a.distance) || Infinity) - (parseFloat(b.distance) || Infinity))
    .slice(0, 8);
  const title = document.createElement('div');
  title.className = 'muted';
  title.style.margin = '10px 0 6px';
  title.textContent = pois.length
    ? `附近候选（${pois.length} 个，按距离排序，点击填入地址框）`
    : '附近没有可识别的建筑/POI，请在下方手动填写地址。';
  box.appendChild(title);
  const cand = document.createElement('div');
  cand.className = 'cand';
  for (const p of pois) {
    const b = document.createElement('button');
    const dist = parseFloat(p.distance);
    b.textContent = `${p.name || '未知名'}${Number.isFinite(dist) ? ' · ' + formatDist(dist) : ''}`;
    b.title = p.address && p.address !== '[]' ? p.address : p.name || '';
    b.onclick = () => {
      frm.addr.value = p.address && p.address !== '[]' ? `${p.name} ${p.address}` : (p.name || '');
      onEditorInput();
      frm.addr.focus();
    };
    cand.appendChild(b);
  }
  box.appendChild(cand);
}

/* ---------- 编辑器 ---------- */

function onEditorInput() {
  $('addrPreview').textContent = buildAddrLine(currentEditor());
}

function currentEditor() {
  return {
    label: frm.label.value.trim(),
    addr: frm.addr.value.trim(),
    building: frm.building.value.trim(),
    floor: frm.floor.value.trim(),
    room: frm.room.value.trim(),
    note: frm.note.value.trim(),
  };
}

let debTimer;
for (const el of Object.values(frm)) {
  el.addEventListener('input', () => {
    clearTimeout(debTimer);
    debTimer = setTimeout(onEditorInput, 200);
  });
}

function updateSaveBtn() {
  $('saveAddrBtn').textContent = editingId ? '更新该地址' : '保存地址';
  $('cancelEditBtn').hidden = !editingId;
}

$('cancelEditBtn').onclick = () => {
  editingId = null;
  for (const el of Object.values(frm)) el.value = '';
  onEditorInput();
  updateSaveBtn();
};

$('copyPreviewBtn').onclick = async function () {
  const line = buildAddrLine(currentEditor());
  if (!line) { show('地址为空，先选候选或手动填写', 'error'); return; }
  await navigator.clipboard.writeText(line);
  this.textContent = '已复制 ✓';
  setTimeout(() => (this.textContent = '复制'), 1200);
};

/* ---------- 保存列表（本机 storage，多候选容错） ---------- */

async function getAddrList() {
  const got = await chrome.storage.local.get(LIST_STORAGE);
  return got[LIST_STORAGE] || [];
}

$('saveAddrBtn').onclick = async () => {
  const entry = currentEditor();
  if (!entry.addr) { show('地址为空：点上方候选填入，或手动填写', 'error'); frm.addr.focus(); return; }
  const list = await getAddrList();
  const now = Date.now();
  if (editingId) {
    const i = list.findIndex(x => x.id === editingId);
    if (i >= 0) list[i] = { ...entry, id: editingId, updatedAt: now };
    else list.unshift({ ...entry, id: editingId, updatedAt: now });
    editingId = null;
  } else {
    list.unshift({ ...entry, id: now, updatedAt: now });
  }
  await chrome.storage.local.set({ deliveryAddrs: list });
  updateSaveBtn();
  renderSavedList(list);
  show('已保存到本机', 'ok');
};

function renderSavedList(list) {
  const box = $('savedBox');
  box.innerHTML = '';
  if (!list.length) {
    box.innerHTML = '<div class="muted">还没有保存的地址：查询附近点候选填入，补上楼层房号后保存。多处住址可存多条，随取随用。</div>';
    return;
  }
  for (const e of list) {
    const row = document.createElement('div');
    row.className = 'saved-row';
    const main = document.createElement('div');
    main.className = 'saved-main';
    main.innerHTML = `<span class="chip">${esc(e.label || '未命名')}</span>
      <span class="v grow">${esc(buildAddrLine(e))}${e.note ? ` <span style="color:var(--muted)">（${esc(e.note)}）</span>` : ''}</span>`;
    row.appendChild(main);
    const ops = document.createElement('div');
    ops.className = 'saved-ops';
    ops.appendChild(copyBtn(() => buildAddrLine(e)));
    const editBtn = document.createElement('button');
    editBtn.className = 'btn-sm';
    editBtn.textContent = '编辑';
    editBtn.onclick = () => {
      editingId = e.id;
      frm.label.value = e.label || '';
      frm.addr.value = e.addr || '';
      frm.building.value = e.building || '';
      frm.floor.value = e.floor || '';
      frm.room.value = e.room || '';
      frm.note.value = e.note || '';
      onEditorInput();
      updateSaveBtn();
      window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    };
    ops.appendChild(editBtn);
    const delBtn = document.createElement('button');
    delBtn.className = 'btn-sm';
    delBtn.textContent = '删除';
    delBtn.onclick = async () => {
      await chrome.storage.local.set({ deliveryAddrs: (await getAddrList()).filter(x => x.id !== e.id) });
      renderSavedList(await getAddrList());
    };
    ops.appendChild(delBtn);
    row.appendChild(ops);
    box.appendChild(row);
  }
}

/* =========================================================
   地址搜索 / 路径规划：高德地理编码 + 出行路线（与收件地址共用 Key）
   ========================================================= */

// 高德接口统一 GET；URLSearchParams 负责地址文本编码
async function amapGet(path, params) {
  const q = new URLSearchParams({ key: amapKey, ...params });
  const resp = await fetch(`https://restapi.amap.com${path}?${q}`);
  return resp.json();
}

function amapFailHint(data) {
  const bad = data.infocode === '10001' || data.infocode === '10008';
  return `高德接口返回失败：${data.info || '未知错误'}${bad ? '（Key 无效：确认是「Web服务」类型 Key）' : ''}`;
}

// 时长（秒）→「1小时23分」；剥掉高德步骤文本里的 HTML 标签
function fmtDur(s) {
  const m = Math.round(s / 60);
  const h = Math.floor(m / 60);
  return h ? `${h}小时${m % 60}分` : `${m}分钟`;
}

function stripHtml(s) { return String(s || '').replace(/<[^>]*>/g, ''); }

function cityOfComponent(ac) {
  return ac && Array.isArray(ac.city) ? '' : ((ac && ac.city) || ''); // 直辖市 city 为空数组
}

/* ---------- 起点 / 终点：输入 → 地理编码 → 点候选 ---------- */

const routeSel = { origin: null, dest: null }; // { name, loc:'lng,lat', city }
let stopPoints = []; // 途经点数组，元素同上或 null（未设置）

function renderChips() {
  for (const [kind, chipId] of [['origin', 'originChip'], ['dest', 'destChip']]) {
    const sel = routeSel[kind];
    const chip = $(chipId);
    chip.hidden = false;
    if (sel) {
      chip.textContent = sel.name;
      chip.classList.remove('unset');
    } else {
      chip.textContent = '未设置';
      chip.classList.add('unset');
    }
  }
}

function setRoutePoint(kind, entry) {
  routeSel[kind] = entry;
  renderChips();
  show(`已设为${kind === 'origin' ? '起点' : '终点'}：${entry.name}`, 'ok');
}

/* ---------- 候选搜索引擎：POI 关键词 + 地理编码双通道，出口号自动放宽 ----------
   「凌空路地铁站2号口」这类输入：地理编码不认、POI 库多不收录出入口，
   所以原样搜不到时自动去掉「N号口」→「地铁站」逐级放宽重搜 */

// 高德 POI 库基本不收录「N号口」，剥掉出口后缀再试
const EXIT_SUFFIX = /(?:\s*\d+|\s*[一二三四五六七八九十]+)?\s*号口\s*$|\s*[A-Za-z]\s*口\s*$/;

function relaxQuery(kw) {
  const steps = [kw];
  const noExit = kw.replace(EXIT_SUFFIX, '').trim();
  if (noExit && noExit !== kw) steps.push(noExit);
  const noStation = noExit.replace(/地铁站?$/, '').replace(/站$/, '').trim();
  if (noStation && !steps.includes(noStation)) steps.push(noStation);
  return steps;
}

async function poiSearch(keywords, city) {
  const params = { keywords, offset: 6, page: 1 };
  if (city) { params.city = city; params.citylimit = false; }
  const data = await amapGet('/v3/place/text', params);
  if (data.status !== '1') throw new Error(amapFailHint(data));
  return (data.pois || []).filter(p => p.location).map(p => ({
    kind: 'poi',
    name: p.name,
    address: p.address && p.address !== '[]' ? p.address : '',
    loc: p.location,
    city: p.adcode || '', // adcode 可直接当公交查询的 city 参数
  }));
}

async function geoSearch(address, city) {
  const params = { address };
  if (city) params.city = city;
  const data = await amapGet('/v3/geocode/geo', params);
  if (data.status !== '1') throw new Error(amapFailHint(data));
  return (data.geocodes || []).filter(g => g.location).map(g => ({
    kind: 'addr',
    name: g.formatted_address,
    address: '',
    loc: g.location,
    city: cityOfComponent(g),
  }));
}

function dedupe(list) {
  const seen = new Set();
  return list.filter(x => {
    const k = x.loc + '|' + x.name;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

async function searchCandidates(address, city) {
  const kw = address.trim();
  const errors = [];
  const steps = relaxQuery(kw);
  for (let i = 0; i < steps.length; i++) {
    let pois = [], geos = [];
    let keyBad = false;
    try { pois = await poiSearch(steps[i], city); }
    catch (e) { errors.push(e.message); if (e.message.includes('Key 无效')) keyBad = true; }
    try { geos = await geoSearch(steps[i], city); }
    catch (e) { errors.push(e.message); if (e.message.includes('Key 无效')) keyBad = true; }
    if (keyBad) break; // Key 无效就不用再放宽重试了
    const list = dedupe([...pois, ...geos]).slice(0, 5);
    if (list.length) return { list, relaxed: i > 0 ? steps[i] : null };
  }
  return { list: [], errors };
}

function routeError(msg) {
  const box = $('routeBox');
  box.innerHTML = '';
  const d = document.createElement('div');
  d.className = 'route-err';
  d.textContent = msg;
  box.appendChild(d);
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/* ---------- 候选下拉浮层 ---------- */

function closeDrop(box) {
  box.classList.remove('open');
  box.innerHTML = '';
}

function closeAllDrops() {
  document.querySelectorAll('.search-drop.open').forEach(closeDrop);
}
document.addEventListener('click', (e) => {
  if (!e.target.closest('.search-field')) closeAllDrops();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeAllDrops();
});

function attachSearch(input, box, onPick) {
  let timer;
  const search = async () => {
    const address = input.value.trim();
    if (!address) { closeDrop(box); return; }
    if (!amapKey) {
      box.innerHTML = '<div class="muted" style="padding:2px 8px">请先在顶栏配置高德「Web服务」Key</div>';
      box.classList.add('open');
      return;
    }
    const { list, relaxed, errors } = await searchCandidates(address, $('routeCity').value.trim());
    box.innerHTML = '';
    if (!list.length) {
      box.innerHTML = `<div class="muted" style="padding:2px 8px">${esc(errors && errors.length ? errors[0] : '没搜到「' + address + '」：试试补全省市名，或换个说法（如去掉“2号口”）')}</div>`;
      box.classList.add('open');
      return;
    }
    if (relaxed) {
      const note = document.createElement('div');
      note.className = 'relaxed-note';
      note.textContent = `没直接命中原输入，已放宽为「${relaxed}」搜索`;
      box.appendChild(note);
    }
    for (const c of list.slice(0, 4)) {
      const b = document.createElement('button');
      const tag = document.createElement('span');
      tag.className = 'kind-tag';
      tag.textContent = c.kind === 'poi' ? '地标' : '地址';
      b.appendChild(tag);
      b.appendChild(document.createTextNode(c.name + (c.address ? `（${c.address}）` : '')));
      b.title = `坐标 ${c.loc}`;
      b.onclick = () => { closeDrop(box); onPick({ name: c.name, loc: c.loc, city: c.city }); };
      box.appendChild(b);
    }
    box.classList.add('open');
  };
  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(search, 400); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { clearTimeout(timer); search(); } });
}

attachSearch($('originInput'), $('originCand'), (e) => setRoutePoint('origin', e));
attachSearch($('destInput'), $('destCand'), (e) => setRoutePoint('dest', e));

/* ---------- 途经点管理 ---------- */

function renderStops() {
  const box = $('stopsBox');
  box.innerHTML = '';
  stopPoints.forEach((sp, i) => {
    const row = document.createElement('div');
    row.className = 'pt-row';
    const rail = document.createElement('div');
    rail.className = 'pt-rail';
    const dot = document.createElement('span');
    dot.className = 'pt-dot';
    rail.appendChild(dot);
    const main = document.createElement('div');
    main.className = 'pt-main';
    const label = document.createElement('div');
    label.className = 'pt-label';
    const nameEl = document.createElement('span');
    nameEl.className = 'pt-name';
    nameEl.textContent = `途经点 ${i + 1}`;
    const chip = document.createElement('span');
    chip.className = 'side-chip' + (sp ? '' : ' unset');
    chip.textContent = sp ? sp.name : '未设置';
    const ops = document.createElement('span');
    ops.className = 'stop-ops';
    const mkOp = (text, fn, disabled) => {
      const b = document.createElement('button');
      b.className = 'btn-sm';
      b.textContent = text;
      b.disabled = !!disabled;
      b.onclick = fn;
      return b;
    };
    if (i > 0) ops.appendChild(mkOp('↑', () => {
      [stopPoints[i - 1], stopPoints[i]] = [stopPoints[i], stopPoints[i - 1]];
      renderStops();
    }));
    if (i < stopPoints.length - 1) ops.appendChild(mkOp('↓', () => {
      [stopPoints[i + 1], stopPoints[i]] = [stopPoints[i], stopPoints[i + 1]];
      renderStops();
    }));
    ops.appendChild(mkOp('移除', () => {
      stopPoints.splice(i, 1);
      renderStops();
    }));
    label.append(nameEl, chip, ops);
    const field = document.createElement('div');
    field.className = 'search-field';
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = '支持地名 / 地铁站出口 / 标准地址';
    const drop = document.createElement('div');
    drop.className = 'search-drop';
    field.append(input, drop);
    main.append(label, field);
    row.append(rail, main);
    box.appendChild(row);
    attachSearch(input, drop, (e) => {
      stopPoints[i] = { name: e.name, loc: e.loc, city: e.city };
      renderStops();
      show(`已设为途经点 ${i + 1}：${e.name}`, 'ok');
    });
  });
}

$('addStopBtn').onclick = () => {
  if (stopPoints.length >= 10) { show('途经点最多 10 个（再多单次查询要发太多请求了）', 'error'); return; }
  stopPoints.push(null);
  renderStops();
};

// A→B→C→D 拆成相邻两两一段
function buildLegs(pts) {
  const legs = [];
  for (let i = 0; i < pts.length - 1; i++) legs.push([pts[i], pts[i + 1]]);
  return legs;
}

function originFromFix() {
  const { gcj } = toAllSystems(lastFix.coords.longitude, lastFix.coords.latitude, lastFix.srcIsGcj ? 'gcj02' : 'wgs84');
  setRoutePoint('origin', {
    name: (regeoResult && regeoResult.formatted_address) || `当前定位（${gcj[1].toFixed(4)},${gcj[0].toFixed(4)}）`,
    loc: `${gcj[0].toFixed(6)},${gcj[1].toFixed(6)}`,
    city: cityOfComponent(regeoResult && regeoResult.addressComponent),
  });
}

// 有 1 分钟内的缓存直接用；没有就现场请求一次，不再要求先去定位页
$('originCurBtn').onclick = function () {
  const btn = this;
  if (lastFix && Date.now() - lastFix.timestamp < 60000) { originFromFix(); return; }
  if (!('geolocation' in navigator)) { show('当前浏览器不支持 Geolocation API', 'error'); return; }
  btn.disabled = true;
  btn.textContent = '定位中…';
  show('正在获取当前位置…', 'ok');
  navigator.geolocation.getCurrentPosition(pos => {
    btn.disabled = false;
    btn.textContent = '用当前定位';
    lastFix = { coords: pos.coords, timestamp: pos.timestamp, srcIsGcj: lastFix?.srcIsGcj || false };
    show('已获取当前位置', 'ok');
    originFromFix();
  }, err => {
    btn.disabled = false;
    btn.textContent = '用当前定位';
    show(ERROR_TEXT[err.code] || `定位失败（${err.message}）`, 'error');
  }, { enableHighAccuracy: $('highAcc').checked, timeout: 15000, maximumAge: 0 });
};

// 页面打开就自动取一次位置（manifest 已声明 geolocation 权限，不会弹框）：
// 「用当前定位」随点随用；出行规划的起点还没设时顺手填上
function autoAcquire() {
  if (!('geolocation' in navigator)) return;
  navigator.geolocation.getCurrentPosition(pos => {
    lastFix = { coords: pos.coords, timestamp: pos.timestamp, srcIsGcj: lastFix?.srcIsGcj || false };
    if (!routeSel.origin) originFromFix();
    show('已自动获取当前位置：出行规划里「用当前定位」可直接用', 'ok');
  }, () => { /* 静默失败不打扰：用户仍可手动定位 */ }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 });
}

/* ---------- 路径规划：驾车（v3）/ 步行（v3）/ 骑行（v4）/ 公交（v3 integrated） ---------- */

function appendSteps(box, steps) {
  const det = document.createElement('details');
  const sum = document.createElement('summary');
  sum.textContent = `路线步骤（${(steps || []).length} 段）`;
  det.appendChild(sum);
  const ol = document.createElement('ol');
  ol.className = 'steps';
  for (const st of steps || []) {
    const li = document.createElement('li');
    li.textContent = stripHtml(st.instruction) + (st.road ? `（${st.road}）` : '');
    ol.appendChild(li);
  }
  det.appendChild(ol);
  box.appendChild(det);
}

function appendNavLinks(box, from, to) {
  const mode = $('routeMode').value;
  const wrap = document.createElement('div');
  wrap.className = 'maps';
  wrap.style.marginTop = '10px';
  const a = document.createElement('a');
  a.href = `https://uri.amap.com/navigation?from=${from.loc},${encodeURIComponent(from.name)}` +
    `&to=${to.loc},${encodeURIComponent(to.name)}&mode=${NAV_MODE[mode]}` +
    `&policy=1&src=browser-toolbox&coordinate=gaode&callnative=0`;
  a.target = '_blank';
  a.rel = 'noreferrer';
  a.textContent = '在高德地图网页版打开导航';
  wrap.appendChild(a);
  box.appendChild(wrap);
}

function sumLine(path, taxiCost) {
  const line = document.createElement('div');
  line.className = 'chips';
  line.innerHTML = `<span class="chip">总距离 ${esc(formatDist(+path.distance))}</span>
    <span class="chip">预计 ${esc(fmtDur(+path.duration))}</span>
    ${taxiCost ? `<span class="chip">打车约 ${esc(String(taxiCost))} 元</span>` : ''}`;
  return line;
}

// 一程的结果渲染：先清空容器，再写「第 N 程」标题与内容（否则页签每点一次追加一份）
function showLeg(i) {
  const box = $('routeBox');
  box.innerHTML = '';
  const [from, to] = legFromTos[i];
  const head = document.createElement('div');
  head.className = 'leg-head';
  head.textContent = `第 ${i + 1} 程：${from.name} → ${to.name}`;
  box.appendChild(head);
  const r = legResults[i];
  if (!r) { box.appendChild(vSpan('尚未查询', true)); return; }
  if (r.error) {
    const d = document.createElement('div');
    d.className = 'route-err';
    d.textContent = '本程查询失败：' + r.error;
    box.appendChild(d);
    return;
  }
  if (r.type === 'path') {
    if (!r.path) {
      const m = document.createElement('div');
      m.className = 'muted';
      m.textContent = '没有可用路线（起终点过远或接口无解）';
      box.appendChild(m);
      return;
    }
    box.appendChild(sumLine(r.path, r.taxiCost));
    appendSteps(box, r.path.steps);
    appendNavLinks(box, from, to);
    return;
  }
  // 公交
  if (!r.transits.length) {
    const m = document.createElement('div');
    m.className = 'muted';
    m.textContent = '没有找到公交方案（起终点太远或跨市无方案）';
    box.appendChild(m);
    appendNavLinks(box, from, to);
    return;
  }
  r.transits.slice(0, 3).forEach((t, i2) => {
    const card = document.createElement('div');
    card.className = 'saved-row';
    const headEl = document.createElement('div');
    headEl.className = 'saved-main';
    headEl.innerHTML = `<span class="chip">方案 ${i2 + 1}</span>
      <span class="v grow">约 ${esc(fmtDur(+t.duration))} · 步行 ${esc(formatDist(+t.walking_distance || 0))}</span>`;
    card.appendChild(headEl);
    const ol = document.createElement('ol');
    ol.className = 'steps';
    for (const seg of t.segments || []) {
      if (seg.walking && +seg.walking.distance > 0) {
        const li = document.createElement('li');
        li.textContent = `步行 ${formatDist(+seg.walking.distance)}`;
        ol.appendChild(li);
      }
      for (const bl of (seg.bus && seg.bus.buslines) || []) {
        const li = document.createElement('li');
        li.textContent = `乘 ${stripHtml(bl.name)}：${stripHtml(bl.departure_stop && bl.departure_stop.name)} → ${stripHtml(bl.arrival_stop && bl.arrival_stop.name)}${bl.via_num ? `（途经 ${bl.via_num} 站）` : ''}`;
        ol.appendChild(li);
      }
    }
    card.appendChild(ol);
    box.appendChild(card);
  });
  appendNavLinks(box, from, to);
}

/* ---------- 分程查询：每段一次接口调用，页签切换查看 ---------- */

let legFromTos = []; // [[from, to], ...]
let legResults = []; // {type:'path'|'transit', ...} 或 {error}
let activeLeg = 0;

const NAV_MODE = { driving: 'car', transit: 'bus', walking: 'walk', bicycling: 'ride' };

async function fetchLeg(mode, from, to) {
  if (mode === 'bicycling') {
    const data = await amapGet('/v4/direction/bicycling', { origin: from.loc, destination: to.loc });
    if (data.errcode !== 0) throw new Error(`${data.errmsg || '骑行接口失败'}（errcode ${data.errcode}）`);
    return { type: 'path', path: data.data && data.data.paths && data.data.paths[0], taxiCost: null };
  }
  if (mode === 'transit') {
    const city = from.city || $('routeCity').value.trim();
    if (!city) throw new Error('公交换乘需要知道本段起点所在城市：用地址搜索设置，或在「城市」框里填一下。');
    const data = await amapGet('/v3/direction/transit/integrated', {
      origin: from.loc, destination: to.loc, city, strategy: 0
    });
    if (data.status !== '1') throw new Error(amapFailHint(data));
    return { type: 'transit', transits: (data.route && data.route.transits) || [] };
  }
  const data = await amapGet(`/v3/direction/${mode}`, {
    origin: from.loc, destination: to.loc, extensions: 'base'
  });
  if (data.status !== '1') throw new Error(amapFailHint(data));
  return { type: 'path', path: data.route && data.route.paths && data.route.paths[0], taxiCost: data.route && data.route.taxi_cost };
}

function renderTabs() {
  const tabs = $('routeTabs');
  tabs.innerHTML = '';
  if (legResults.length <= 1) { tabs.hidden = true; return; }
  tabs.hidden = false;
  legResults.forEach((r, i) => {
    const b = document.createElement('button');
    b.textContent = `第 ${i + 1} 程` + (r && r.error ? ' ⚠' : '');
    if (r && r.error) b.classList.add('leg-fail');
    if (i === activeLeg) b.classList.add('active');
    b.title = `${legFromTos[i][0].name} → ${legFromTos[i][1].name}`;
    b.onclick = () => { activeLeg = i; renderTabs(); showLeg(i); };
    tabs.appendChild(b);
  });
  // 全程累计（只统计成功的程）
  const ok = legResults.filter(r => r && !r.error);
  const total = document.createElement('span');
  total.className = 'leg-total';
  if (ok.length === legResults.length) {
    let dist = 0, dur = 0;
    for (const r of ok) {
      if (r.type === 'path' && r.path) { dist += +r.path.distance || 0; dur += +r.path.duration || 0; }
      else if (r.type === 'transit' && r.transits[0]) {
        dist += +r.transits[0].walking_distance || 0;
        dur += +r.transits[0].duration || 0;
      }
    }
    total.textContent = `全程累计：${formatDist(dist)} · 约 ${fmtDur(dur)}`;
  } else {
    total.textContent = `成功 ${ok.length}/${legResults.length} 段（⚠ 页签内看失败原因）`;
  }
  tabs.appendChild(total);
}

$('routeBtn').onclick = async function () {
  const btn = this;
  const mode = $('routeMode').value;
  const box = $('routeBox');
  // 校验：列出所有未设置的点（就地显示在按钮下方）
  const missing = [];
  if (!routeSel.origin) missing.push('起点');
  stopPoints.forEach((sp, i) => { if (!sp) missing.push(`途经点 ${i + 1}`); });
  if (!routeSel.dest) missing.push('终点');
  if (missing.length) {
    routeError(`${missing.join('、')}还没设置：输入地址后点候选即设定；起点也可用「用当前定位」。`);
    return;
  }

  const pts = [routeSel.origin, ...stopPoints, routeSel.dest];
  legFromTos = buildLegs(pts);
  legResults = legFromTos.map(() => null);
  activeLeg = 0;
  renderTabs();

  btn.disabled = true;
  btn.textContent = '规划中…';
  const totalLegs = legFromTos.length;
  box.innerHTML = totalLegs > 1 ? `<div class="muted">共 ${totalLegs} 程，正在逐段查询…</div>` : '<div class="muted">正在查询路线…</div>';
  for (let i = 0; i < totalLegs; i++) {
    const [from, to] = legFromTos[i];
    box.innerHTML = totalLegs > 1
      ? `<div class="muted">共 ${totalLegs} 程，正在查询第 ${i + 1} 程：${esc(from.name)} → ${esc(to.name)} …</div>`
      : '<div class="muted">正在查询路线…</div>';
    try {
      legResults[i] = await fetchLeg(mode, from, to);
    } catch (e) {
      legResults[i] = { error: e.message };
    }
  }
  activeLeg = Math.max(0, legResults.findIndex(r => !r.error));
  renderTabs();
  showLeg(activeLeg);
  const okCount = legResults.filter(r => !r.error).length;
  if (okCount < totalLegs) show(`全程 ${totalLegs} 程中有 ${totalLegs - okCount} 程查询失败，失败原因在对应页签里`, 'error');
  btn.disabled = false;
  btn.textContent = '查询路径';
};

/* ---------- 初始化 ---------- */

(async () => {
  const got = await chrome.storage.local.get([KEY_STORAGE, VIEW_KEY]);
  amapKey = got[KEY_STORAGE] || '';
  $('keyInput').value = amapKey;
  keyConfigured();
  renderChips();
  renderSavedList(await getAddrList());
  onEditorInput();
  switchView(['locate', 'address', 'plan'].includes(got[VIEW_KEY]) ? got[VIEW_KEY] : 'locate');
  autoAcquire();
})();
