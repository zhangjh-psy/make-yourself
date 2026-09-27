/**
 * 图标生成器（不依赖任何第三方库）
 *
 * 产物：
 *   build/icon.ico        给窗口/快捷方式/任务栏用（多尺寸）
 *   build/icon.32.png     托盘小图标
 *   build/icon.256.png    预览 & extraResources
 *   build/candidates.png  候选方案对比图（256 / 64 / 32 三种尺寸并排）
 *
 * 设计方向：Make yourself = 自我塑造。用「不断长进」的意象，
 * 避开任务管理类图标用滥的对勾/日历/清单。
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'build');
fs.mkdirSync(outDir, { recursive: true });

/* ---------------------------- PNG 编码 ---------------------------- */

function crc32(buf) {
  let c;
  const table =
    crc32.table ||
    (crc32.table = (() => {
      const t = new Int32Array(256);
      for (let n = 0; n < 256; n++) {
        c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c;
      }
      return t;
    })());
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

/** rgba: Buffer，长度 size*size*4 */
function encodePng(size, rgba) {
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------------------------- 绘图基元 ---------------------------- */

const INK = [26, 26, 28]; // 底色 #1A1A1C
const PAPER = [255, 255, 255];
const ACCENT = [126, 150, 255]; // 柔和蓝紫 #7E96FF

function blend(dst, i, color, alpha, size) {
  if (alpha <= 0) return;
  const a = Math.min(1, alpha);
  dst[i] = Math.round(dst[i] * (1 - a) + color[0] * a);
  dst[i + 1] = Math.round(dst[i + 1] * (1 - a) + color[1] * a);
  dst[i + 2] = Math.round(dst[i + 2] * (1 - a) + color[2] * a);
  const prevA = dst[i + 3] / 255;
  dst[i + 3] = Math.round((a + prevA * (1 - a)) * 255);
  void size;
}

/** 通用形状填充：传入"点在不在形状里(x,y)"的函数，4x4 超采样抗锯齿 */
function fillShape(buf, size, inside, color, alpha = 1) {
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let hit = 0;
      for (let sy = 0; sy < 4; sy++) {
        for (let sx = 0; sx < 4; sx++) {
          if (inside(x + (sx + 0.5) / 4, y + (sy + 0.5) / 4)) hit++;
        }
      }
      if (hit) blend(buf, (y * size + x) * 4, color, (hit / 16) * alpha, size);
    }
  }
}

/** 圆角矩形 */
function roundRect(buf, size, x0, y0, x1, y1, r, color, alpha = 1) {
  fillShape(
    buf,
    size,
    (x, y) => {
      if (x < x0 || x > x1 || y < y0 || y > y1) return false;
      const cx = Math.min(Math.max(x, x0 + r), x1 - r);
      const cy = Math.min(Math.max(y, y0 + r), y1 - r);
      const dx = x - cx;
      const dy = y - cy;
      return dx * dx + dy * dy <= r * r;
    },
    color,
    alpha,
  );
}

/** 圆 / 半圆（下边被切掉的那种，用于"日出"） */
function circle(buf, size, cx0, cy0, r, color, alpha = 1, clipBelowY = Infinity) {
  fillShape(
    buf,
    size,
    (x, y) => {
      if (y > clipBelowY) return false;
      const dx = x - cx0;
      const dy = y - cy0;
      return dx * dx + dy * dy <= r * r;
    },
    color,
    alpha,
  );
}

/** 细长矩形（射线、茎） */
function bar(buf, size, cx, cy, w, h, angleDeg, color, alpha = 1, round = true) {
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const hw = w / 2;
  const hh = h / 2;
  const rr = round ? Math.min(hw, hh) : 0;
  fillShape(
    buf,
    size,
    (x, y) => {
      const dx = x - cx;
      const dy = y - cy;
      // 转到局部坐标
      const lx = dx * cos + dy * sin;
      const ly = -dx * sin + dy * cos;
      if (Math.abs(lx) > hw || Math.abs(ly) > hh) return false;
      if (rr === 0) return true;
      const px = Math.max(-hw + rr, Math.min(hw - rr, lx));
      const py = Math.max(-hh + rr, Math.min(hh - rr, ly));
      const ddx = lx - px;
      const ddy = ly - py;
      return ddx * ddx + ddy * ddy <= rr * rr;
    },
    color,
    alpha,
  );
}

/** 椭圆（叶子） */
function ellipse(buf, size, cx0, cy0, rx, ry, angleDeg, color, alpha = 1) {
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  fillShape(
    buf,
    size,
    (x, y) => {
      const dx = x - cx0;
      const dy = y - cy0;
      const lx = dx * cos + dy * sin;
      const ly = -dx * sin + dy * cos;
      return (lx * lx) / (rx * rx) + (ly * ly) / (ry * ry) <= 1;
    },
    color,
    alpha,
  );
}

function newCanvas(size) {
  return Buffer.alloc(size * size * 4);
}

/** 统一的圆角方形底板 */
function plate(buf, size, fill = INK) {
  const pad = size * 0.06;
  roundRect(buf, size, pad, pad, size - pad, size - pad, size * 0.23, fill);
}

/* ---------------------------- 候选方案 ---------------------------- */

/** A. 日出：圆从地平线升起 + 三道光线。寓意"每天重新开始" */
function drawSunrise(size) {
  const buf = newCanvas(size);
  plate(buf, size);
  const s = size;
  const cx = s * 0.5;
  const horizon = s * 0.66;
  // 太阳（半圆，坐在地平线上）
  circle(buf, s, cx, horizon, s * 0.21, PAPER, 1, horizon);
  // 三道光线
  const rays = [
    { a: -90, len: 0.16, w: 0.05 },
    { a: -135, len: 0.13, w: 0.045 },
    { a: -45, len: 0.13, w: 0.045 },
  ];
  for (const r of rays) {
    const rad = (r.a * Math.PI) / 180;
    const dist = s * 0.27 + (s * r.len) / 2;
    bar(buf, s, cx + Math.cos(rad) * dist, horizon + Math.sin(rad) * dist, s * r.len, s * r.w, r.a + 90, ACCENT, 1);
  }
  // 地平线
  roundRect(buf, s, s * 0.24, horizon - s * 0.022, s * 0.76, horizon + s * 0.022, s * 0.022, PAPER);
  return buf;
}

/** B. 新芽：一茎两叶。寓意"成长、慎独" */
function drawSprout(size) {
  const buf = newCanvas(size);
  plate(buf, size);
  const s = size;
  // 茎（细一点）
  bar(buf, s, s * 0.5, s * 0.625, s * 0.042, s * 0.40, 0, PAPER, 1);
  // 两片叶子：从茎的中上部往外斜着长，靠内的一端压住茎
  ellipse(buf, s, s * 0.355, s * 0.455, s * 0.135, s * 0.082, -30, ACCENT, 1);
  ellipse(buf, s, s * 0.645, s * 0.365, s * 0.135, s * 0.082, 30, PAPER, 1);
  return buf;
}

/** C. 三步台阶 + 上扬箭头：最直白的"一步步变好" */
function drawSteps(size) {
  const buf = newCanvas(size);
  plate(buf, size);
  const s = size;
  const base = s * 0.74;
  const x0 = s * 0.225;
  const w = s * 0.165;
  const heights = [0.15, 0.28, 0.41];
  heights.forEach((h, i) => {
    const color = i === heights.length - 1 ? ACCENT : PAPER;
    roundRect(buf, s, x0 + i * w, base - s * h, x0 + i * w + w * 0.76, base, s * 0.032, color);
  });
  // 上扬箭头：一条斜线 + 一个"人"字形箭头
  bar(buf, s, s * 0.655, s * 0.355, s * 0.17, s * 0.048, -48, PAPER, 1);
  bar(buf, s, s * 0.695, s * 0.335, s * 0.115, s * 0.046, -48, PAPER, 1);
  bar(buf, s, s * 0.745, s * 0.255, s * 0.10, s * 0.046, 40, PAPER, 1);
  return buf;
}

/** D. 由小到大的三点：极简，"自己在长" */
function drawDots(size) {
  const buf = newCanvas(size);
  plate(buf, size);
  const s = size;
  const dots = [
    { r: 0.068, x: 0.33, y: 0.705, c: PAPER },
    { r: 0.105, x: 0.5, y: 0.575, c: ACCENT },
    { r: 0.145, x: 0.665, y: 0.405, c: PAPER },
  ];
  for (const d of dots) circle(buf, s, s * d.x, s * d.y, s * d.r, d.c, 1);
  return buf;
}

const CANDIDATES = [
  { id: 'A', name: '日出', draw: drawSunrise },
  { id: 'B', name: '新芽', draw: drawSprout },
  { id: 'C', name: '台阶上扬', draw: drawSteps },
  { id: 'D', name: '渐长三点', draw: drawDots },
];

/* ---------------------------- 对比图 ---------------------------- */

/** 把一张小图贴到大图上（最近邻缩放） */
function paste(dst, dstSize, src, srcSize, ox, oy, scale) {
  for (let y = 0; y < srcSize * scale; y++) {
    for (let x = 0; x < srcSize * scale; x++) {
      const sx = Math.floor(x / scale);
      const sy = Math.floor(y / scale);
      const si = (sy * srcSize + sx) * 4;
      const dx = ox + x;
      const dy = oy + y;
      if (dx < 0 || dy < 0 || dx >= dstSize || dy >= dstSize) continue;
      const di = (dy * dstSize + dx) * 4;
      const a = src[si + 3] / 255;
      if (a <= 0) continue;
      for (let c = 0; c < 3; c++) {
        dst[di + c] = Math.round(dst[di + c] * (1 - a) + src[si + c] * a);
      }
      dst[di + 3] = Math.max(dst[di + 3], src[si + 3]);
    }
  }
}

function buildSheet() {
  const sizes = [200, 80, 40, 24];
  const gap = 22;
  const rowH = 210;
  const sheetW = gap + sizes.reduce((sum, s) => sum + s + gap, 0);
  const sheetH = gap + CANDIDATES.length * (rowH + gap);
  // 注意：这里是非正方形画布，要按 w*h 分配，不能用 newCanvas（那是正方形）
  const sheet = Buffer.alloc(sheetW * sheetH * 4);
  // 浅灰底，方便看白图标
  for (let i = 0; i < sheetW * sheetH; i++) {
    sheet[i * 4] = 240;
    sheet[i * 4 + 1] = 240;
    sheet[i * 4 + 2] = 242;
    sheet[i * 4 + 3] = 255;
  }
  CANDIDATES.forEach((c, row) => {
    const big = c.draw(256);
    let x = gap;
    const y = gap + row * (rowH + gap);
    sizes.forEach((s) => {
      const img = s === 200 ? c.draw(200) : c.draw(s);
      paste(sheet, sheetW, img, s, x, y + (rowH - s), 1);
      x += s + gap;
    });
    // 顺便把 256 的单独存一份，方便单看
    fs.writeFileSync(path.join(outDir, `candidate-${c.id}.png`), encodePng(256, big));
  });
  fs.writeFileSync(path.join(outDir, 'candidates.png'), encodePng2(sheetW, sheetH, sheet));
  return { sheetW, sheetH };
}

/** 非正方形画布的 PNG 编码 */
function encodePng2(w, h, rgba) {
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------------------------- 输出 ---------------------------- */

const which = (process.argv[2] || 'A').toUpperCase();
const chosen = CANDIDATES.find((c) => c.id === which) || CANDIDATES[0];

const sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256];
const images = sizes.map((size) => ({ size, png: encodePng(size, chosen.draw(size)) }));

// ICO 容器
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 2);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(images.length, 4);
const dir = Buffer.alloc(16 * images.length);
let offset = 6 + dir.length;
images.forEach((img, i) => {
  const p = i * 16;
  dir[p] = img.size >= 256 ? 0 : img.size;
  dir[p + 1] = img.size >= 256 ? 0 : img.size;
  dir.writeUInt16LE(1, p + 4);
  dir.writeUInt16LE(32, p + 6);
  dir.writeUInt32LE(img.png.length, p + 8);
  dir.writeUInt32LE(offset, p + 12);
  offset += img.png.length;
});
const ico = Buffer.concat([header, dir, ...images.map((i) => i.png)]);
fs.writeFileSync(path.join(outDir, 'icon.ico'), ico);

const big = images.find((i) => i.size === 256).png;
fs.writeFileSync(path.join(outDir, 'icon.256.png'), big);
fs.writeFileSync(path.join(outDir, 'icon.32.png'), images.find((i) => i.size === 32).png);

// 内嵌给界面的小图标（托盘兜底用）
fs.writeFileSync(
  path.join(root, 'src', 'icon-data.ts'),
  `// 由 scripts/make-icon.mjs 自动生成，请勿手改\n` +
    `export const ICON_PNG_BASE64 =\n  '${big.toString('base64')}';\n`,
  'utf8',
);

const sheet = buildSheet();
console.log(`已生成 build/icon.ico（用方案 ${chosen.id} · ${chosen.name}，${sizes.length} 个尺寸）`);
console.log(`候选对比图：build/candidates.png（${sheet.sheetW}x${sheet.sheetH}）`);
console.log('单张候选：build/candidate-A.png / B / C / D.png');
