// 生成扩展图标（纯 Node.js，零依赖）：node gen_icons.js
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const OUT = path.join(__dirname, 'extension', 'icons');
fs.mkdirSync(OUT, { recursive: true });

function crc32(buf) {
  let c;
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = (crc ^ buf[i]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(tag, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(tag, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size, pixelAt) {
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4);
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixelAt(x, y, size);
      row[1 + x * 4] = r;
      row[2 + x * 4] = g;
      row[3 + x * 4] = b;
      row[4 + x * 4] = a;
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // 位深
  ihdr[9] = 6;  // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// 图标：紫色圆角方块 + 白色“便签”图形（左竖线 + 三条横线）
// 注意：颜色必须带第 4 个 alpha 分量（255），否则 Buffer 赋值会把 undefined 转成 0，整图透明
const R = [124, 77, 255, 255];
const W = [255, 255, 255, 255];

for (const size of [16, 48, 128]) {
  const rad = size * 0.22;
  const lw = Math.max(2, Math.round(size * 0.075)); // 线宽
  const seg = (x, y, x1, y1, x2, y2) => {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
  };
  const pixel = (x, y, s) => {
    // 圆角判断：到最近角圆心的距离
    const cx = Math.min(Math.max(x, rad), s - 1 - rad);
    const cy = Math.min(Math.max(y, rad), s - 1 - rad);
    if (Math.hypot(x - cx, y - cy) > rad) return [0, 0, 0, 0];
    const x0 = s * 0.30;
    const x1 = s * 0.72;
    const near = (d) => d <= lw / 2;
    if (near(seg(x, y, x0, s * 0.24, x0, s * 0.76))) return W; // 左侧竖线
    for (const f of [0.30, 0.50, 0.70]) {
      if (near(seg(x, y, x0 + s * 0.10, s * f, x1, s * f))) return W; // 三条横线
    }
    return R;
  };
  fs.writeFileSync(path.join(OUT, 'icon' + size + '.png'), png(size, pixel));
}
console.log('图标已生成: ' + OUT);
