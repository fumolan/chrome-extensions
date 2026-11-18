// 当前时间工具：读本机系统时钟，纯本地展示；世界城市时间用浏览器时区库换算；农历为经典 1900–2049 数据表算法
const $ = (id) => document.getElementById(id);
const pad2 = (n, w = 2) => String(n).padStart(w, '0');

/* ---------- 农历（1900–2049 经典数据表） ---------- */
// 每年一个十六进制数：低 4 位 = 闰月月份（0 为无闰月），
// 中间 12 位 = 十二个月大小（1 为 30 天），最高位 = 闰月大小
const LUNAR_INFO = [
  0x04bd8, 0x04ae0, 0x0a570, 0x054d5, 0x0d260, 0x0d950, 0x16554, 0x056a0, 0x09ad0, 0x055d2, // 1900-1909
  0x04ae0, 0x0a5b6, 0x0a4d0, 0x0d250, 0x1d255, 0x0b540, 0x0d6a0, 0x0ada2, 0x095b0, 0x14977, // 1910-1919
  0x04970, 0x0a4b0, 0x0b4b5, 0x06a50, 0x06d40, 0x1ab54, 0x02b60, 0x09570, 0x052f2, 0x04970, // 1920-1929
  0x06566, 0x0d4a0, 0x0ea50, 0x06e95, 0x05ad0, 0x02b60, 0x186e3, 0x092e0, 0x1c8d7, 0x0c950, // 1930-1939
  0x0d4a0, 0x1d8a6, 0x0b550, 0x056a0, 0x1a5b4, 0x025d0, 0x092d0, 0x0d2b2, 0x0a950, 0x0b557, // 1940-1949
  0x06ca0, 0x0b550, 0x15355, 0x04da0, 0x0a5b0, 0x14573, 0x052b0, 0x0a9a8, 0x0e950, 0x06aa0, // 1950-1959
  0x0aea6, 0x0ab50, 0x04b60, 0x0aae4, 0x0a570, 0x05260, 0x0f263, 0x0d950, 0x05b57, 0x056a0, // 1960-1969
  0x096d0, 0x04dd5, 0x04ad0, 0x0a4d0, 0x0d4d4, 0x0d250, 0x0d558, 0x0b540, 0x0b6a0, 0x195a6, // 1970-1979
  0x095b0, 0x049b0, 0x0a974, 0x0a4b0, 0x0b27a, 0x06a50, 0x06d40, 0x0af46, 0x0ab60, 0x09570, // 1980-1989
  0x04af5, 0x04970, 0x064b0, 0x074a3, 0x0ea50, 0x06b58, 0x05ac0, 0x0ab60, 0x096d5, 0x092e0, // 1990-1999
  0x0c960, 0x0d954, 0x0d4a0, 0x0da50, 0x07552, 0x056a0, 0x0abb7, 0x025d0, 0x092d0, 0x0cab5, // 2000-2009
  0x0a950, 0x0b4a0, 0x0baa4, 0x0ad50, 0x055d9, 0x04ba0, 0x0a5b0, 0x15176, 0x052b0, 0x0a930, // 2010-2019
  0x07954, 0x06aa0, 0x0ad50, 0x05b52, 0x04b60, 0x0a6e6, 0x0a4e0, 0x0d260, 0x0ea65, 0x0d520, // 2020-2029
  0x0daa0, 0x076a3, 0x096d0, 0x04afb, 0x04ad0, 0x0a4d0, 0x1d0b6, 0x0d250, 0x0d520, 0x0dd45, // 2030-2039
  0x0b5a0, 0x056d0, 0x055b2, 0x049b0, 0x0a577, 0x0a4b0, 0x0aa50, 0x1b255, 0x06d20, 0x0ada0  // 2040-2049
];
const LUNAR_MONTHS = ['正', '二', '三', '四', '五', '六', '七', '八', '九', '十', '冬', '腊'];
const LUNAR_DAYS = [
  '初一', '初二', '初三', '初四', '初五', '初六', '初七', '初八', '初九', '初十',
  '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十',
  '廿一', '廿二', '廿三', '廿四', '廿五', '廿六', '廿七', '廿八', '廿九', '三十'
];
const GAN = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'];
const ZHI = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];
const ANIMALS = ['鼠', '牛', '虎', '兔', '龙', '蛇', '马', '羊', '猴', '鸡', '狗', '猪'];
const WEEKS = ['日', '一', '二', '三', '四', '五', '六'];

function lunarLeapMonth(y) { return LUNAR_INFO[y - 1900] & 0xf; }
function lunarLeapDays(y) { return lunarLeapMonth(y) ? ((LUNAR_INFO[y - 1900] & 0x10000) ? 30 : 29) : 0; }
function lunarMonthDays(y, m) { return (LUNAR_INFO[y - 1900] & (0x10000 >> m)) ? 30 : 29; }
function lunarYearDays(y) {
  let sum = 348;
  for (let i = 0x8000; i > 0x8; i >>= 1) sum += (LUNAR_INFO[y - 1900] & i) ? 1 : 0;
  return sum + lunarLeapDays(y);
}

// 返回 {year, month, day, isLeap}；超出支持范围返回 null
function solarToLunar(date) {
  // 与 1900-01-31（农历 1900 年正月初一）的日历日差，走 UTC 避开夏令时干扰
  let offset = Math.floor(
    (Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - Date.UTC(1900, 0, 31)) / 86400000
  );
  if (offset < 0) return null;
  let i, temp = 0;
  for (i = 1900; i <= 2049 && offset > 0; i++) { temp = lunarYearDays(i); offset -= temp; }
  if (offset < 0) { offset += temp; i--; }
  if (i > 2049) return null;
  const year = i;
  const leap = lunarLeapMonth(year);
  let isLeap = false;
  for (i = 1; i < 13 && offset > 0; i++) {
    if (leap > 0 && i === leap + 1 && !isLeap) { --i; isLeap = true; temp = lunarLeapDays(year); }
    else temp = lunarMonthDays(year, i);
    if (isLeap && i === leap + 1) isLeap = false; // 闰月已消费，解除标记
    offset -= temp;
  }
  if (offset === 0 && leap > 0 && i === leap + 1) {
    if (isLeap) isLeap = false;
    else { isLeap = true; --i; }
  }
  if (offset < 0) { offset += temp; --i; }
  return { year, month: i, day: offset + 1, isLeap };
}

function lunarText(date) {
  const r = solarToLunar(date);
  if (!r) return null;
  const gz = GAN[(r.year - 4) % 10] + ZHI[(r.year - 4) % 12];
  const animal = ANIMALS[(r.year - 4) % 12];
  const monthName = (r.isLeap ? '闰' : '') + LUNAR_MONTHS[r.month - 1] + '月';
  return `${gz}${animal}年 ${monthName}${LUNAR_DAYS[r.day - 1]}`;
}

/* ---------- 历法计算 ---------- */

function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = (t.getUTCDay() + 6) % 7; // 周一=0 … 周日=6
  t.setUTCDate(t.getUTCDate() - dayNum + 3); // 移到本周的周四
  const first = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  const fDayNum = (first.getUTCDay() + 6) % 7;
  first.setUTCDate(first.getUTCDate() - fDayNum + 3); // 第一周的周四
  return { year: t.getUTCFullYear(), week: 1 + Math.round((t - first) / (7 * 86400000)) };
}

function dayOfYear(d) {
  return Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())
    - Date.UTC(d.getFullYear(), 0, 1)) / 86400000) + 1;
}

function isLeapYear(y) { return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0; }

function utcOffsetMin(d) { return -d.getTimezoneOffset(); }

function fmtOffset(min) {
  const sign = min >= 0 ? '+' : '-';
  const h = String(Math.floor(Math.abs(min) / 60)).padStart(2, '0');
  const m = String(Math.abs(min) % 60).padStart(2, '0');
  return `UTC${sign}${h}:${m}`;
}

function isoLocal(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}.${pad2(d.getMilliseconds(), 3)}${fmtOffset(utcOffsetMin(d)).slice(3)}`;
}

function dstText(d) {
  const y = d.getFullYear();
  const jan = utcOffsetMin(new Date(y, 0, 1));
  const jul = utcOffsetMin(new Date(y, 6, 1));
  if (jan === jul) return '该时区不使用夏令时';
  const dst = Math.max(jan, jul);
  return utcOffsetMin(d) === dst
    ? '当前处于夏令时'
    : '当前为标准时间（该时区每年会切换夏令时）';
}

/* ---------- 世界时钟 ---------- */

const SVG_NS = 'http://www.w3.org/2000/svg';
const MAP_W = 1000, MAP_H = 403, LAT_TOP = 85, LAT_SPAN = 145; // 与 world-map.svg 投影一致

// 1.6.x 旧版默认（tz 字符串）迁移时取中文名用
const CITY_POOL = [
  ['北京', 'Asia/Shanghai'], ['上海', 'Asia/Shanghai'], ['香港', 'Asia/Hong_Kong'],
  ['台北', 'Asia/Taipei'], ['新加坡', 'Asia/Singapore'], ['东京', 'Asia/Tokyo'],
  ['首尔', 'Asia/Seoul'], ['曼谷', 'Asia/Bangkok'], ['孟买', 'Asia/Kolkata'],
  ['迪拜', 'Asia/Dubai'], ['莫斯科', 'Europe/Moscow'], ['柏林', 'Europe/Berlin'],
  ['巴黎', 'Europe/Paris'], ['伦敦', 'Europe/London'], ['开罗', 'Africa/Cairo'],
  ['纽约', 'America/New_York'], ['多伦多', 'America/Toronto'], ['洛杉矶', 'America/Los_Angeles'],
  ['圣保罗', 'America/Sao_Paulo'], ['悉尼', 'Australia/Sydney'], ['奥克兰', 'Pacific/Auckland'],
];
const DEFAULT_CITIES = [
  { id: 'America/Los_Angeles/洛杉矶', tz: 'America/Los_Angeles', n: '洛杉矶' },
  { id: 'America/New_York/纽约', tz: 'America/New_York', n: '纽约' },
  { id: 'Europe/London/伦敦', tz: 'Europe/London', n: '伦敦' },
  { id: 'Europe/Paris/巴黎', tz: 'Europe/Paris', n: '巴黎' },
  { id: 'Asia/Shanghai/北京', tz: 'Asia/Shanghai', n: '北京' },
  { id: 'Asia/Tokyo/东京', tz: 'Asia/Tokyo', n: '东京' },
];
const CITIES_KEY = 'worldCities';

function cityName(tz) {
  const hit = CITY_POOL.find(([, t]) => t === tz);
  return hit ? hit[0] : tz.split('/').pop().replace(/_/g, ' ');
}

// 旧版存的是 tz 字符串，新版存 {id, tz, n}；统一归一化
function normalizeCityEntry(v) {
  if (typeof v === 'string') return { id: v, tz: v, n: cityName(v) };
  return { id: v.id || `${v.tz}/${v.n}`, tz: v.tz, n: v.n || cityName(v.tz) };
}

// 某时区的当前 {y, mo, d, h, m, s}（h23 避免 0 点显示成 24）
const cityFmtCache = {};
function cityParts(tz, date) {
  let f = cityFmtCache[tz];
  if (!f) {
    f = cityFmtCache[tz] = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23',
      year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', second: 'numeric'
    });
  }
  const p = {};
  for (const { type, value } of f.formatToParts(date)) p[type] = value;
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour, m: +p.minute, s: +p.second };
}

// 城市日期相对本机的天数差（-1 昨天 / +1 明天）
function cityDayDiff(p, date) {
  const cityDay = Math.floor(Date.UTC(p.y, p.mo - 1, p.d) / 86400000);
  const localDay = Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000);
  return cityDay - localDay;
}

// 表针角度（度）：秒针连续扫动
function hourAngle(h, m, s) { return ((h % 12) + m / 60 + s / 3600) * 30; }
function minAngle(m, s) { return (m + s / 60) * 6; }
function secAngle(s, ms) { return (s + ms / 1000) * 6; }

/* ---------- 地图投影与最近城市（与 world-map.svg 同一投影） ---------- */

function cityToVb(lon, lat) {
  return { x: (lon + 180) / 360 * MAP_W, y: (LAT_TOP - lat) / LAT_SPAN * MAP_H };
}

function vbToLonLat(x, y) {
  return { lon: x / MAP_W * 360 - 180, lat: LAT_TOP - y / MAP_H * LAT_SPAN };
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const rad = (d) => d * Math.PI / 180, R = 6371;
  const dLat = rad(lat2 - lat1), dLon = rad(lon2 - lon1);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function nearestCity(lon, lat) {
  let best = null, bestD = Infinity;
  for (const c of CITY_POINTS) {
    const d = haversineKm(lat, lon, c.lat, c.lon);
    if (d < bestD) { bestD = d; best = c; }
  }
  return { city: best, dist: bestD };
}

function dotKeyOf(p) { return `${p.tz}/${p.n}`; }

const cityCards = []; // { tz, clock:{svg,hour,min,sec}, timeEl, subEl, parts }
const dotEls = new Map(); // dotKey -> circle
let nearDot = null;
let worldCities = [];

function setHand(hand, deg) { hand.setAttribute('transform', `rotate(${deg}, 50, 50)`); }

function makeClockSvg() {
  const mk = (tag, attrs) => {
    const e = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    return e;
  };
  const svg = mk('svg', { viewBox: '0 0 100 100' });
  svg.classList.add('analog');
  svg.appendChild(mk('circle', { cx: 50, cy: 50, r: 46, class: 'face' }));
  for (let i = 0; i < 12; i++) {
    const major = i % 3 === 0;
    const a = i * 30 * Math.PI / 180;
    const r1 = major ? 35.5 : 38.5;
    svg.appendChild(mk('line', {
      x1: (50 + r1 * Math.sin(a)).toFixed(2), y1: (50 - r1 * Math.cos(a)).toFixed(2),
      x2: (50 + 43 * Math.sin(a)).toFixed(2), y2: (50 - 43 * Math.cos(a)).toFixed(2),
      class: major ? 'tick major' : 'tick',
    }));
  }
  const hour = mk('line', { x1: 50, y1: 50, x2: 50, y2: 29, class: 'h' });
  const min = mk('line', { x1: 50, y1: 50, x2: 50, y2: 19, class: 'm' });
  const sec = mk('line', { x1: 50, y1: 50, x2: 50, y2: 15, class: 's' });
  svg.append(hour, min, sec);
  svg.appendChild(mk('circle', { cx: 50, cy: 50, r: 2.6, class: 'pin' }));
  return { svg, hour, min, sec };
}

function buildMapLayer() {
  const svg = $('cityMap');
  for (const p of CITY_POINTS) {
    const { x, y } = cityToVb(p.lon, p.lat);
    if (x < 0 || x > MAP_W || y < 0 || y > MAP_H) continue;
    const c = document.createElementNS(SVG_NS, 'circle');
    c.setAttribute('cx', x.toFixed(1));
    c.setAttribute('cy', y.toFixed(1));
    c.setAttribute('r', '1.8');
    c.setAttribute('class', 'pt');
    svg.appendChild(c);
    dotEls.set(dotKeyOf(p), c);
  }
}

function paintAdded() {
  const ids = new Set(worldCities.map(c => c.id));
  for (const [key, el] of dotEls) el.setAttribute('class', ids.has(key) ? 'pt added' : 'pt');
}

function renderCities() {
  const grid = $('cityGrid');
  grid.innerHTML = '';
  cityCards.length = 0;
  for (const city of worldCities) {
    const card = document.createElement('div');
    card.className = 'city-card';
    const rm = document.createElement('button');
    rm.className = 'rm';
    rm.textContent = '×';
    rm.title = `移除${city.n}`;
    rm.onclick = () => {
      worldCities = worldCities.filter(c => c.id !== city.id);
      saveCities();
      renderCities();
    };
    const clock = makeClockSvg();
    const nameEl = document.createElement('div');
    nameEl.className = 'city-name';
    nameEl.textContent = city.n;
    const timeEl = document.createElement('div');
    timeEl.className = 'city-time';
    timeEl.textContent = '--:--';
    const subEl = document.createElement('div');
    subEl.className = 'city-sub';
    card.append(rm, clock.svg, nameEl, timeEl, subEl);
    grid.appendChild(card);
    cityCards.push({ tz: city.tz, clock, timeEl, subEl, parts: null });
  }
  paintAdded();
}

function vbPoint(e) {
  const m = $('cityMap').getScreenCTM().inverse();
  const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m);
  return { x: p.x, y: p.y };
}

let msgTimer;
function mapMsg(text) {
  $('mapMsg').textContent = text;
  clearTimeout(msgTimer);
  msgTimer = setTimeout(() => {
    $('mapMsg').textContent = '点地图：加入离点击点最近的城市';
  }, 3500);
}

function addCityEntry(entry, dist) {
  if (worldCities.some(c => c.id === entry.id)) { mapMsg(`${entry.n} 已在列表中`); return; }
  worldCities.push(entry);
  saveCities();
  renderCities();
  mapMsg(`已添加 ${entry.n}${dist != null ? `（距点击约 ${Math.max(1, Math.round(dist))} 公里）` : ''}`);
}

function updateCities(now, ms) {
  for (const c of cityCards) {
    if (!c.parts) c.parts = cityParts(c.tz, now);
    const p = c.parts;
    setHand(c.clock.sec, secAngle(p.s, ms));
    setHand(c.clock.min, minAngle(p.m, p.s + ms / 1000));
    setHand(c.clock.hour, hourAngle(p.h, p.m, p.s));
  }
}

function updateCityTexts(now) {
  for (const c of cityCards) {
    const p = c.parts = cityParts(c.tz, now);
    c.timeEl.textContent = `${pad2(p.h)}:${pad2(p.m)}`;
    const sun = p.h >= 6 && p.h < 18 ? '☀' : '🌙';
    const diff = cityDayDiff(p, now);
    const badge = diff === 1 ? '+1 天' : diff === -1 ? '-1 天' : '';
    c.subEl.innerHTML = `${sun}${badge ? `<span class="badge">${badge}</span>` : ''}`;
  }
}

async function saveCities() {
  await chrome.storage.local.set({ [CITIES_KEY]: worldCities.map(c => ({ id: c.id, tz: c.tz, n: c.n })) });
}

async function loadCities() {
  const got = await chrome.storage.local.get(CITIES_KEY);
  const saved = got[CITIES_KEY];
  const list = (Array.isArray(saved) && saved.length ? saved : [...DEFAULT_CITIES]).map(normalizeCityEntry);
  const seen = new Set();
  worldCities = list.filter(c => !seen.has(c.id) && seen.add(c.id));
  renderCities();
  updateCityTexts(new Date());
}

$('cityMap').addEventListener('mousemove', (e) => {
  const { x, y } = vbPoint(e);
  const { lon, lat } = vbToLonLat(x, y);
  const { city, dist } = nearestCity(lon, lat);
  const tip = $('mapTip');
  if (nearDot) { nearDot.classList.remove('near'); nearDot = null; }
  if (!city || dist > 500) { tip.hidden = true; return; }
  nearDot = dotEls.get(dotKeyOf(city));
  if (nearDot) nearDot.classList.add('near');
  const t = cityParts(city.tz, new Date());
  tip.hidden = false;
  tip.textContent = `${city.n}  ${pad2(t.h)}:${pad2(t.m)}  距 ${Math.max(1, Math.round(dist))} 公里`;
  const br = $('cityMap').getBoundingClientRect();
  tip.style.left = `${e.clientX - br.left}px`;
  tip.style.top = `${e.clientY - br.top}px`;
});

$('cityMap').addEventListener('mouseleave', () => {
  if (nearDot) { nearDot.classList.remove('near'); nearDot = null; }
  $('mapTip').hidden = true;
});

$('cityMap').addEventListener('click', (e) => {
  const { x, y } = vbPoint(e);
  const { lon, lat } = vbToLonLat(x, y);
  const { city, dist } = nearestCity(lon, lat);
  if (!city) return;
  addCityEntry({ id: dotKeyOf(city), tz: city.tz, n: city.n }, dist);
});

/* ---------- 展示：行只建一次，之后每秒只改文本 ---------- */

function copyBtn(getText) {
  const btn = document.createElement('button');
  btn.className = 'btn-sm';
  btn.textContent = '复制';
  btn.onclick = async function () {
    await navigator.clipboard.writeText(getText());
    this.textContent = '已复制 ✓';
    setTimeout(() => (this.textContent = '复制'), 1200);
  };
  return btn;
}

// 建 kv 行，返回值单元格引用供每秒更新
function makeRow(parent, label, copyText) {
  const row = document.createElement('div');
  row.className = 'kv';
  const kEl = document.createElement('span');
  kEl.className = 'k';
  kEl.textContent = label;
  const vEl = document.createElement('span');
  vEl.className = 'v grow';
  row.append(kEl, vEl);
  if (copyText) row.appendChild(copyBtn(copyText));
  parent.appendChild(row);
  return vEl;
}

const V = {}; // 各行值单元格引用

function buildRows() {
  const tz = $('tzCard');
  V.iana = makeRow(tz, 'IANA 时区', () => Intl.DateTimeFormat().resolvedOptions().timeZone);
  V.tzOff = makeRow(tz, 'UTC 偏移');
  V.tzDst = makeRow(tz, '夏令时');

  const ts = $('tsCard');
  V.tsSec = makeRow(ts, '秒（10 位）', () => String(Math.floor(Date.now() / 1000)));
  V.tsMs = makeRow(ts, '毫秒（13 位）', () => String(Date.now()));

  const fmt = $('fmtCard');
  V.fLocal = makeRow(fmt, '本地 ISO 8601', () => isoLocal(new Date()));
  V.fUtcIso = makeRow(fmt, 'UTC ISO 8601', () => new Date().toISOString());
  V.fUtcStr = makeRow(fmt, 'UTC 字符串', () => new Date().toUTCString());
  V.fCn = makeRow(fmt, '中文长格式', () => new Date().toLocaleString('zh-CN', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  }));

  const cal = $('calCard');
  V.week = makeRow(cal, 'ISO 周数');
  V.doy = makeRow(cal, '年内第几天');
  V.quarter = makeRow(cal, '季度');
  V.leap = makeRow(cal, '闰年');
  V.lunar = makeRow(cal, '农历');
}

function refresh(d) {
  const y = d.getFullYear();

  $('dateLine').textContent =
    `${y} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日 星期${WEEKS[d.getDay()]}`;
  const lunar = lunarText(d);
  $('lunarLine').textContent = lunar ? `农历 ${lunar}` : '农历：超出 1900–2049 年支持范围';

  V.iana.textContent = Intl.DateTimeFormat().resolvedOptions().timeZone;
  V.tzOff.textContent = fmtOffset(utcOffsetMin(d));
  V.tzDst.textContent = dstText(d);

  V.tsSec.textContent = String(Math.floor(d.getTime() / 1000));
  V.tsMs.textContent = String(d.getTime());

  V.fLocal.textContent = isoLocal(d);
  V.fUtcIso.textContent = d.toISOString();
  V.fUtcStr.textContent = d.toUTCString();
  V.fCn.textContent = d.toLocaleString('zh-CN', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  });

  const wk = isoWeek(d);
  V.week.textContent = `${wk.year} 年第 ${wk.week} 周（ISO-8601）`;
  V.doy.textContent = `第 ${dayOfYear(d)} 天 / 共 ${isLeapYear(y) ? 366 : 365} 天`;
  V.quarter.textContent = `Q${Math.floor(d.getMonth() / 3) + 1}`;
  V.leap.textContent = isLeapYear(y) ? '是（366 天）' : '否（365 天）';
  V.lunar.textContent = lunar ? lunar : '超出支持范围';
}

/* ---------- 时钟循环 ---------- */

let lastSec = -1;

function tick() {
  const now = new Date();
  const ms = now.getMilliseconds();
  const sec = Math.floor(now.getTime() / 1000);
  const changed = sec !== lastSec;
  if (changed) {
    lastSec = sec;
    const use12 = $('ampmToggle').checked;
    const h24 = now.getHours();
    $('hh').textContent = pad2(use12 ? ((h24 + 11) % 12) + 1 : h24);
    $('ampm').textContent = use12 ? (h24 < 12 ? '上午' : '下午') : '';
    $('mi').textContent = pad2(now.getMinutes());
    $('ss').textContent = pad2(now.getSeconds());
    refresh(now);
    if (cityCards.length) updateCityTexts(now);
  }
  if (cityCards.length) updateCities(now, ms);
  requestAnimationFrame(tick);
}

$('ampmToggle').addEventListener('change', () => { lastSec = -1; });

$('copyIsoBtn').onclick = async function () {
  await navigator.clipboard.writeText(isoLocal(new Date()));
  this.textContent = '已复制 ✓';
  setTimeout(() => (this.textContent = '复制 ISO 时间'), 1200);
};

buildRows();
buildMapLayer();
loadCities();
requestAnimationFrame(tick);
