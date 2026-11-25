// The World in One Day — Wednesday, 25 November 2026.
// A one-page newspaper front page summing up the verified world news of
// Wednesday 25 November 2026, drawn as a single 1024x1024 PNG.
//
// Node 22+, standard library only, no network, fully deterministic:
// the same bytes come out on every run. The PNG encoder is written by
// hand (raw RGB scanlines -> zlib deflate -> IHDR/IDAT/IEND with CRC32).
//
// Run:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
// Without MAKEFUN_OUTPUT_DIR it writes /output/entry.png.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

// ---------------------------------------------------------------------------
// Framebuffer and drawing primitives
// ---------------------------------------------------------------------------

const W = 1024;
const H = 1024;
const px = new Uint8Array(W * H * 3);

type RGB = [number, number, number];

const PAPER: RGB = [247, 242, 230];
const INK: RGB = [22, 20, 17];
const RED: RGB = [178, 34, 42];
const NAVY: RGB = [28, 54, 92];
const TEAL: RGB = [14, 90, 76];
const GOLD: RGB = [203, 164, 40];
const ORANGE: RGB = [216, 104, 28];
const CREAM: RGB = [247, 242, 230];
const GREY: RGB = [122, 118, 110];
const PALE: RGB = [233, 227, 211];
const BODY: RGB = [60, 56, 50];

function put(x: number, y: number, c: RGB): void {
  if (x < 0 || x >= W || y < 0 || y >= H) return;
  const i = (y * W + x) * 3;
  px[i] = c[0];
  px[i + 1] = c[1];
  px[i + 2] = c[2];
}

function rect(x: number, y: number, w: number, h: number, c: RGB): void {
  const x0 = Math.max(0, x);
  const y0 = Math.max(0, y);
  const x1 = Math.min(W, x + w);
  const y1 = Math.min(H, y + h);
  for (let yy = y0; yy < y1; yy++) {
    let i = (yy * W + x0) * 3;
    for (let xx = x0; xx < x1; xx++) {
      px[i] = c[0];
      px[i + 1] = c[1];
      px[i + 2] = c[2];
      i += 3;
    }
  }
}

function frame(x: number, y: number, w: number, h: number, t: number, c: RGB): void {
  rect(x, y, w, t, c);
  rect(x, y + h - t, w, t, c);
  rect(x, y, t, h, c);
  rect(x + w - t, y, t, h, c);
}

function hline(x: number, y: number, w: number, t: number, c: RGB): void {
  rect(x, y, w, t, c);
}

// Bresenham line.
function seg(x0: number, y0: number, x1: number, y1: number, c: RGB): void {
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0;
  let y = y0;
  for (;;) {
    put(x, y, c);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

function thickSeg(x0: number, y0: number, x1: number, y1: number, t: number, c: RGB): void {
  const r = Math.floor(t / 2);
  for (let a = -r; a <= r; a++) {
    for (let b = -r; b <= r; b++) seg(x0 + a, y0 + b, x1 + a, y1 + b, c);
  }
}

function path(points: Array<[number, number]>, c: RGB): void {
  for (let i = 0; i + 1 < points.length; i++) seg(points[i][0], points[i][1], points[i + 1][0], points[i + 1][1], c);
}

function thickPath(points: Array<[number, number]>, t: number, c: RGB): void {
  for (let i = 0; i + 1 < points.length; i++) thickSeg(points[i][0], points[i][1], points[i + 1][0], points[i + 1][1], t, c);
}

function disc(cx: number, cy: number, r: number, c: RGB): void {
  for (let y = -r; y <= r; y++) {
    const half = Math.floor(Math.sqrt(Math.max(0, r * r - y * y)));
    for (let x = -half; x <= half; x++) put(cx + x, cy + y, c);
  }
}

function ring(cx: number, cy: number, r: number, t: number, c: RGB): void {
  const steps = Math.max(24, Math.floor(2 * Math.PI * r));
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * 2 * Math.PI;
    disc(Math.round(cx + r * Math.cos(a)), Math.round(cy + r * Math.sin(a)), Math.max(1, Math.floor(t / 2)), c);
  }
}

function tri(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, c: RGB): void {
  const minX = Math.max(0, Math.min(ax, bx, cx));
  const maxX = Math.min(W - 1, Math.max(ax, bx, cx));
  const minY = Math.max(0, Math.min(ay, by, cy));
  const maxY = Math.min(H - 1, Math.max(ay, by, cy));
  const d = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  if (d === 0) return;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const s = ((bx - ax) * (y - ay) - (by - ay) * (x - ax)) / d;
      const t = ((cx - ax) * (y - ay) - (cy - ay) * (x - ax)) / -d;
      if (s >= 0 && t >= 0 && s + t <= 1) put(x, y, c);
    }
  }
}

// ---------------------------------------------------------------------------
// PNG encoder (deterministic: fixed deflate level, no timestamps)
// ---------------------------------------------------------------------------

const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  const crcInput = new Uint8Array(4 + data.length);
  crcInput.set(out.subarray(4, 8 + data.length));
  view.setUint32(8 + data.length, crc32(crcInput));
  return out;
}

function encodePNG(): Uint8Array {
  const raw = new Uint8Array(H * (1 + W * 3));
  for (let y = 0; y < H; y++) {
    raw[y * (1 + W * 3)] = 0;
    raw.set(px.subarray(y * W * 3, (y + 1) * W * 3), y * (1 + W * 3) + 1);
  }
  const idat = deflateSync(raw, { level: 9 });
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, W);
  v.setUint32(4, H);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type 2 = RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const parts = [sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', new Uint8Array(idat)), pngChunk('IEND', new Uint8Array(0))];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

// ---------------------------------------------------------------------------
// 5x7 bitmap font (capitals, digits, punctuation). '#' = ink, '.' = empty.
// ---------------------------------------------------------------------------

const FONT: Record<string, string[]> = {
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  C: ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  G: ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.####'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  I: ['.###.', '..#..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  J: ['..###', '...#.', '...#.', '...#.', '...#.', '#..#.', '.##..'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  N: ['#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  Q: ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '#.#.#', '.#.#.'],
  X: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
  Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
  Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
  '0': ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
  '1': ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  '2': ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  '3': ['#####', '...#.', '..#..', '...#.', '....#', '#...#', '.###.'],
  '4': ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  '5': ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  '6': ['..##.', '.#...', '#....', '####.', '#...#', '#...#', '.###.'],
  '7': ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  '8': ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  '9': ['.###.', '#...#', '#...#', '.####', '....#', '...#.', '.##..'],
  ' ': ['.....', '.....', '.....', '.....', '.....', '.....', '.....'],
  '.': ['.....', '.....', '.....', '.....', '.....', '.##..', '.##..'],
  ',': ['.....', '.....', '.....', '.....', '.##..', '..#..', '.#...'],
  ':': ['.....', '.##..', '.##..', '.....', '.##..', '.##..', '.....'],
  ';': ['.....', '.##..', '.##..', '.....', '.##..', '..#..', '.#...'],
  '!': ['..#..', '..#..', '..#..', '..#..', '..#..', '.....', '..#..'],
  '?': ['.###.', '#...#', '....#', '...#.', '..#..', '.....', '..#..'],
  '-': ['.....', '.....', '.....', '.###.', '.....', '.....', '.....'],
  "'": ['..#..', '..#..', '.#...', '.....', '.....', '.....', '.....'],
  '"': ['.#.#.', '.#.#.', '.....', '.....', '.....', '.....', '.....'],
  '(': ['...#.', '..#..', '.#...', '.#...', '.#...', '..#..', '...#.'],
  ')': ['.#...', '..#..', '...#.', '...#.', '...#.', '..#..', '.#...'],
  '/': ['....#', '...#.', '...#.', '..#..', '.#...', '.#...', '#....'],
  '%': ['##..#', '##.#.', '...#.', '..#..', '.#...', '#.##.', '#..##'],
  '&': ['.##..', '#..#.', '#.#..', '.#...', '#.#.#', '#..#.', '.##.#'],
  '+': ['.....', '..#..', '..#..', '#####', '..#..', '..#..', '.....'],
  '=': ['.....', '.....', '#####', '.....', '#####', '.....', '.....'],
  $: ['..#..', '.####', '#.#..', '.###.', '..#.#', '####.', '..#..'],
  '\u2022': ['.....', '.....', '..#..', '.###.', '.###.', '..#..', '.....'],
  '\u2014': ['.....', '.....', '.....', '#####', '.....', '.....', '.....'],
};

function glyph(x: number, y: number, ch: string, s: number, c: RGB): void {
  const g = FONT[ch] ?? FONT['?'];
  for (let r = 0; r < 7; r++) {
    for (let col = 0; col < 5; col++) {
      if (g[r][col] === '#') rect(x + col * s, y + r * s, s, s, c);
    }
  }
}

function cw(s: number): number {
  return 6 * s;
}

function textW(t: string, s: number): number {
  return t.length * cw(s) - s;
}

function text(x: number, y: number, t: string, s: number, c: RGB): void {
  for (let i = 0; i < t.length; i++) glyph(x + i * cw(s), y, t[i], s, c);
}

function textCentred(cx: number, y: number, t: string, s: number, c: RGB): void {
  text(cx - Math.floor(textW(t, s) / 2), y, t, s, c);
}

function wrap(t: string, maxChars: number): string[] {
  const words = t.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if (cur === '') cur = w;
    else if (cur.length + 1 + w.length <= maxChars) cur += ' ' + w;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur !== '') lines.push(cur);
  return lines;
}

function wrapped(x: number, y: number, t: string, s: number, maxChars: number, lh: number, c: RGB): number {
  const lines = wrap(t, maxChars);
  for (let i = 0; i < lines.length; i++) text(x, y + i * lh, lines[i], s, c);
  return lines.length;
}

// ---------------------------------------------------------------------------
// Illustrations — one flat vector scene per story, drawn in (x, y, w, h).
// ---------------------------------------------------------------------------

// LEAD A — COP31 deadlock: factory under a hazy sun, smoke, cracked earth.
function illoClimate(x: number, y: number, w: number, h: number): void {
  rect(x, y, w, h, TEAL);
  disc(x + w - 54, y + 32, 24, GOLD);
  disc(x + w - 54, y + 32, 16, [224, 186, 74]);
  rect(x + 14, y + h - 44, 118, 44, INK);
  rect(x + 34, y + h - 74, 14, 30, INK);
  rect(x + 64, y + h - 80, 14, 36, INK);
  rect(x + 96, y + h - 66, 58, 66, INK);
  rect(x + 104, y + h - 54, 10, 10, GOLD);
  rect(x + 122, y + h - 54, 10, 10, GOLD);
  rect(x + 140, y + h - 54, 10, 10, GOLD);
  disc(x + 41, y + 12, 7, GREY);
  disc(x + 52, y + 8, 5, CREAM);
  disc(x + 71, y + 10, 7, GREY);
  disc(x + 82, y + 6, 5, CREAM);
  rect(x, y + h - 12, w, 12, [219, 197, 156]);
  path(
    [
      [x + 8, y + h - 12],
      [x + 40, y + h - 4],
      [x + 70, y + h - 11],
      [x + 110, y + h - 3],
      [x + 150, y + h - 10],
      [x + w - 8, y + h - 4],
    ],
    INK,
  );
}

// LEAD B — China purges Shanghai chief: prison bars, handcuffs, star badge.
function illoPurge(x: number, y: number, w: number, h: number): void {
  rect(x, y, w, h, NAVY);
  // Prison bars across the top half.
  for (let i = 0; i < 12; i++) rect(x + 10 + i * 36, y + 6, 8, Math.floor(h * 0.62), [150, 160, 178]);
  rect(x, y + 6, w, 6, CREAM);
  rect(x, y + Math.floor(h * 0.62), w, 6, CREAM);
  // Handcuffs: two rings joined by a chain.
  const cy = y + h - 26;
  ring(x + 150, cy, 18, 5, GOLD);
  ring(x + 250, cy, 18, 5, GOLD);
  disc(x + 150, cy, 6, GOLD);
  disc(x + 250, cy, 6, GOLD);
  thickSeg(x + 168, cy - 8, x + 232, cy - 8, 4, GOLD);
  // Sheriff star, right side.
  const sx = x + w - 52;
  const sy = y + h - 30;
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i / 5) * 2 * Math.PI;
    const b = a + Math.PI / 5;
    tri(
      Math.round(sx + 20 * Math.cos(a)),
      Math.round(sy + 20 * Math.sin(a)),
      Math.round(sx + 8 * Math.cos(b)),
      Math.round(sy + 8 * Math.sin(b)),
      Math.round(sx + 20 * Math.cos(a + (2 * Math.PI) / 5)),
      Math.round(sy + 20 * Math.sin(a + (2 * Math.PI) / 5)),
      GOLD,
    );
  }
  disc(sx, sy, 7, RED);
}

// MID A — Iran hits Bahrain / tankers near Hormuz: tanker, missile, waves.
function illoGulf(x: number, y: number, w: number, h: number): void {
  rect(x, y, w, h, [16, 42, 68]);
  // Missile streaking down from the sky.
  thickSeg(x + 40, y + 6, x + 130, y + 44, 4, GOLD);
  tri(x + 130, y + 44, x + 122, y + 40, x + 146, y + 52, GOLD);
  disc(x + 34, y + 4, 5, ORANGE);
  // Oil tanker.
  const hy = y + h - 34;
  rect(x + 30, hy, 200, 22, [120, 30, 30]);
  rect(x + 30, hy, 200, 6, RED);
  rect(x + 46, hy - 22, 34, 22, GOLD);
  rect(x + 88, hy - 22, 34, 22, CREAM);
  rect(x + 130, hy - 22, 34, 22, TEAL);
  rect(x + 196, hy - 34, 26, 34, CREAM);
  rect(x + 204, hy - 42, 10, 10, INK);
  // Explosion burst on the far tanker.
  const ex = x + w - 44;
  const ey = y + 34;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * 2 * Math.PI;
    tri(ex - 5, ey - 5, ex + 5, ey + 5, Math.round(ex + 26 * Math.cos(a)), Math.round(ey + 26 * Math.sin(a)), i % 2 === 0 ? GOLD : ORANGE);
  }
  disc(ex, ey, 9, RED);
  // Waves.
  thickPath(
    [
      [x + 4, y + h - 6],
      [x + 40, y + h - 12],
      [x + 80, y + h - 6],
      [x + 120, y + h - 12],
      [x + 160, y + h - 6],
      [x + 200, y + h - 12],
      [x + 240, y + h - 6],
      [x + w - 4, y + h - 12],
    ],
    3,
    CREAM,
  );
}

// MID B — Indonesian factory fire: burning plant, flames, smoke.
function illoFire(x: number, y: number, w: number, h: number): void {
  rect(x, y, w, h, [58, 24, 16]);
  rect(x + 20, y + h - 36, 110, 36, INK);
  rect(x + 150, y + h - 48, 90, 48, INK);
  rect(x + 170, y + h - 70, 12, 24, INK);
  rect(x + 200, y + h - 78, 12, 32, INK);
  // Flames licking the roofline.
  tri(x + 30, y + h - 36, x + 90, y + h - 36, x + 60, y + h - 60, ORANGE);
  tri(x + 70, y + h - 36, x + 130, y + h - 36, x + 100, y + h - 56, GOLD);
  tri(x + 160, y + h - 48, x + 220, y + h - 48, x + 190, y + h - 62, ORANGE);
  tri(x + 175, y + h - 48, x + 210, y + h - 48, x + 192, y + h - 58, GOLD);
  tri(x + 52, y + h - 36, x + 82, y + h - 36, x + 67, y + h - 44, RED);
  // Smoke.
  disc(x + 60, y + 8, 8, GREY);
  disc(x + 74, y + 7, 6, CREAM);
  disc(x + 190, y + 8, 7, GREY);
  disc(x + 204, y + 7, 5, CREAM);
  // Windows glowing.
  rect(x + 156, y + h - 36, 10, 10, GOLD);
  rect(x + 174, y + h - 36, 10, 10, GOLD);
  rect(x + 192, y + h - 36, 10, 10, GOLD);
}

// MID C — FBI probes NCIC hack: laptop, padlock, warning.
function illoHack(x: number, y: number, w: number, h: number): void {
  rect(x, y, w, h, [18, 52, 36]);
  // Laptop.
  const lx = x + 30;
  const ly = y + 10;
  rect(lx, ly, 170, 46, INK);
  frame(lx, ly, 170, 46, 3, CREAM);
  rect(lx + 8, ly + 8, 154, 30, [30, 90, 60]);
  // Binary rain on the screen.
  for (let i = 0; i < 5; i++) {
    text(lx + 14 + i * 30, ly + 12, i % 2 === 0 ? '1010' : '0101', 1, CREAM);
  }
  rect(lx - 12, ly + 46, 194, 8, GREY);
  // Padlock in front.
  const px0 = x + w - 84;
  const py0 = y + h - 44;
  ring(px0 + 14, py0 + 2, 12, 4, GOLD);
  rect(px0, py0, 28, 24, GOLD);
  disc(px0 + 14, py0 + 12, 4, INK);
  rect(px0 + 12, py0 + 12, 4, 8, INK);
  // Warning triangle, top right.
  tri(x + w - 40, y + 8, x + w - 14, y + 8, x + w - 27, y + 30, GOLD);
  text(x + w - 31, y + 12, '!', 1, INK);
}

// LOW A — Nigeria boat capsizes: overturned hull, waves, life ring.
function illoBoat(x: number, y: number, w: number, h: number): void {
  rect(x, y, w, h, [24, 72, 110]);
  // Overturned hull.
  tri(x + 40, y + 26, x + 220, y + 26, x + 130, y + 8, [139, 90, 43]);
  rect(x + 40, y + 26, 180, 8, [139, 90, 43]);
  rect(x + 120, y + 34, 20, 10, CREAM);
  // Life ring floating.
  ring(x + w - 48, y + h - 26, 14, 6, ORANGE);
  disc(x + w - 48, y + h - 26, 5, CREAM);
  // Waves.
  thickPath(
    [
      [x + 4, y + h - 12],
      [x + 50, y + h - 18],
      [x + 100, y + h - 12],
      [x + 150, y + h - 18],
      [x + 200, y + h - 12],
      [x + w - 4, y + h - 18],
    ],
    3,
    CREAM,
  );
  thickPath(
    [
      [x + 4, y + h - 26],
      [x + 60, y + h - 31],
      [x + 120, y + h - 26],
      [x + 180, y + h - 31],
      [x + w - 4, y + h - 26],
    ],
    2,
    [140, 180, 210],
  );
}

// LOW B — N. Korea expels Swiss envoy: Swiss flag, departing plane.
function illoExpel(x: number, y: number, w: number, h: number): void {
  // Swiss flag: red field, white cross.
  rect(x, y, w, h, [200, 16, 46]);
  rect(x, y + Math.floor(h / 2) - 6, w, 12, CREAM);
  rect(x + Math.floor(w / 2) - 6, y, 12, h, CREAM);
  // Departing plane, top right.
  const px0 = x + w - 110;
  const py0 = y + 10;
  tri(px0, py0 + 6, px0 + 60, py0, px0 + 60, py0 + 12, INK);
  tri(px0 + 60, py0, px0 + 60, py0 + 12, px0 + 84, py0 + 6, INK);
  tri(px0 + 16, py0 + 6, px0 + 16, py0 + 12, px0 - 6, py0 + 16, INK);
  tri(px0 + 34, py0 + 6, px0 + 34, py0 + 12, px0 + 22, py0 + 18, INK);
  // Motion lines behind the plane.
  hline(x + 30, y + 14, 90, 3, CREAM);
  hline(x + 50, y + 24, 70, 3, CREAM);
  // Door shutting, bottom left.
  rect(x + 18, y + h - 34, 34, 34, INK);
  frame(x + 18, y + h - 34, 34, 34, 3, CREAM);
  disc(x + 42, y + h - 17, 3, GOLD);
}

// LOW C — Drones hit Russian ship in the Gulf of Finland: ship, drones, fire.
function illoShip(x: number, y: number, w: number, h: number): void {
  rect(x, y, w, h, [58, 74, 92]);
  // Cargo ship.
  const hy = y + h - 24;
  rect(x + 30, hy, 190, 12, INK);
  rect(x + 46, hy - 14, 40, 14, [150, 40, 40]);
  rect(x + 94, hy - 14, 40, 14, [40, 90, 60]);
  rect(x + 142, hy - 14, 40, 14, [150, 110, 30]);
  rect(x + 196, hy - 24, 22, 24, CREAM);
  // Fire on deck.
  tri(x + 100, hy - 14, x + 140, hy - 14, x + 120, hy - 26, ORANGE);
  tri(x + 112, hy - 14, x + 132, hy - 14, x + 122, hy - 22, GOLD);
  disc(x + 132, y + 4, 3, CREAM);
  // Two drones overhead.
  for (const [dx, dy] of [
    [x + 60, y + 12],
    [x + w - 70, y + 16],
  ] as Array<[number, number]>) {
    rect(dx - 10, dy, 20, 6, INK);
    rect(dx - 2, dy + 6, 4, 8, INK);
    hline(dx - 16, dy - 4, 14, 2, CREAM);
    hline(dx + 2, dy - 4, 14, 2, CREAM);
    disc(dx, dy + 16, 3, RED);
  }
  // Sea.
  thickPath(
    [
      [x + 4, y + h - 6],
      [x + 60, y + h - 11],
      [x + 120, y + h - 6],
      [x + 180, y + h - 11],
      [x + w - 4, y + h - 6],
    ],
    3,
    CREAM,
  );
}

// LEAD A — Houthi strike on Saudi refinery: towers, flare stack, blast, drones.
function illoRefinery(x: number, y: number, w: number, h: number): void {
  rect(x, y, w, h, [16, 42, 68]);
  // Distillation towers.
  rect(x + 24, y + h - 62, 34, 62, [120, 124, 132]);
  rect(x + 24, y + h - 62, 34, 4, CREAM);
  rect(x + 66, y + h - 52, 30, 52, [120, 124, 132]);
  rect(x + 66, y + h - 52, 30, 4, CREAM);
  // Flare stack with flame.
  rect(x + 122, y + 10, 10, h - 10, [150, 160, 178]);
  tri(x + 116, y + 12, x + 138, y + 12, x + 127, y - 2, ORANGE);
  tri(x + 120, y + 12, x + 134, y + 12, x + 127, y + 2, GOLD);
  // Storage tanks.
  rect(x + 170, y + h - 34, 62, 34, CREAM);
  rect(x + 170, y + h - 34, 62, 6, [120, 124, 132]);
  rect(x + 244, y + h - 28, 52, 28, [150, 160, 178]);
  // Explosion burst on the far tank.
  const ex = x + w - 52;
  const ey = y + 30;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * 2 * Math.PI;
    tri(ex - 5, ey - 5, ex + 5, ey + 5, Math.round(ex + 24 * Math.cos(a)), Math.round(ey + 24 * Math.sin(a)), i % 2 === 0 ? GOLD : ORANGE);
  }
  disc(ex, ey, 8, RED);
  // Two drones overhead.
  for (const [dx, dy] of [
    [x + 60, y + 12],
    [x + w - 120, y + 10],
  ] as Array<[number, number]>) {
    rect(dx - 10, dy, 20, 6, INK);
    rect(dx - 2, dy + 6, 4, 8, INK);
    hline(dx - 16, dy - 4, 14, 2, CREAM);
    hline(dx + 2, dy - 4, 14, 2, CREAM);
    disc(dx, dy + 16, 3, RED);
  }
  // Ground.
  rect(x, y + h - 8, w, 8, [219, 197, 156]);
}

// MID A — First foreign astronaut: rocket, station, Pakistani flag.
function illoSpace(x: number, y: number, w: number, h: number): void {
  rect(x, y, w, h, [10, 16, 40]);
  // Stars.
  for (const [sx, sy] of [
    [x + 20, y + 10],
    [x + 70, y + 22],
    [x + 130, y + 8],
    [x + 200, y + 16],
    [x + 250, y + 30],
    [x + 40, y + 40],
    [x + 230, y + 52],
  ] as Array<[number, number]>) disc(sx, sy, 2, CREAM);
  // Space station, top right.
  rect(x + w - 110, y + 12, 70, 10, CREAM);
  rect(x + w - 92, y + 8, 34, 18, GOLD);
  rect(x + w - 116, y + 14, 12, 6, GOLD);
  rect(x + w - 34, y + 14, 12, 6, GOLD);
  // Rocket ascending, centre left.
  const rx = x + 96;
  const ry = y + 8;
  tri(rx, ry, rx + 16, ry, rx + 8, ry - 6, RED);
  rect(rx, ry, 16, 30, CREAM);
  tri(rx - 8, ry + 30, rx, ry + 30, rx, ry + 18, RED);
  tri(rx + 16, ry + 30, rx + 24, ry + 30, rx + 16, ry + 18, RED);
  tri(rx + 2, ry + 30, rx + 14, ry + 30, rx + 8, ry + 46, ORANGE);
  tri(rx + 5, ry + 30, rx + 11, ry + 30, rx + 8, ry + 40, GOLD);
  // Pakistani flag, bottom right.
  const fx = x + w - 78;
  const fy = y + h - 30;
  rect(fx, fy, 58, 24, [20, 90, 50]);
  rect(fx, fy, 12, 24, CREAM);
  disc(fx + 34, fy + 12, 7, CREAM);
  disc(fx + 37, fy + 12, 6, [20, 90, 50]);
  disc(fx + 40, fy + 8, 2, CREAM);
  // Ground line.
  hline(x, y + h - 4, w, 2, GREY);
}

// MID B — Colombia frees hostages: supermarket, open door, freed figures, shield.
function illoHostage(x: number, y: number, w: number, h: number): void {
  rect(x, y, w, h, NAVY);
  // Shopfront.
  rect(x + 16, y + 12, w - 32, h - 24, CREAM);
  // Striped awning.
  for (let i = 0; i < 8; i++) rect(x + 16 + i * 32, y + 12, 16, 12, i % 2 === 0 ? RED : CREAM);
  // Sign.
  text(x + 30, y + 28, 'MARKET', 2, INK);
  // Open door, light spilling out.
  rect(x + 30, y + 44, 34, h - 56, GOLD);
  frame(x + 30, y + 44, 34, h - 56, 2, INK);
  // Two freed figures walking out.
  for (const fx of [x + 110, x + 150] as number[]) {
    disc(fx, y + h - 44, 7, INK);
    rect(fx - 6, y + h - 36, 12, 20, INK);
    rect(fx - 6, y + h - 16, 4, 12, INK);
    rect(fx + 2, y + h - 16, 4, 12, INK);
  }
  // Shield with a check, right side.
  const sx = x + w - 52;
  const sy = y + h - 30;
  ring(sx, sy, 16, 4, GOLD);
  thickSeg(sx - 8, sy, sx - 2, sy + 6, 3, GOLD);
  thickSeg(sx - 2, sy + 6, sx + 9, sy - 7, 3, GOLD);
}

// MID C — Tariff fears slam markets: falling chart, red arrows, ticker bars.
function illoMarkets(x: number, y: number, w: number, h: number): void {
  rect(x, y, w, h, [18, 28, 40]);
  text(x + 10, y + 6, 'NASDAQ -2%', 2, RED);
  // Grid.
  for (let i = 1; i < 4; i++) hline(x + 8, y + 8 + i * 14, w - 16, 1, [60, 66, 76]);
  // Falling chart line.
  thickPath(
    [
      [x + 10, y + 14],
      [x + 60, y + 20],
      [x + 110, y + 18],
      [x + 160, y + 34],
      [x + 210, y + 44],
      [x + w - 14, y + 58],
    ],
    3,
    RED,
  );
  // Down arrows.
  for (const ax of [x + 120, x + 200] as number[]) {
    tri(ax - 8, y + 22, ax + 8, y + 22, ax, y + 36, RED);
    rect(ax - 2, y + 10, 4, 14, RED);
  }
  // Ticker bars shrinking at the bottom.
  const bars = [30, 24, 18, 12, 8];
  for (let i = 0; i < bars.length; i++) rect(x + 16 + i * 50, y + h - 6 - bars[i], 34, bars[i], i % 2 === 0 ? RED : ORANGE);
}

// LOW A — Bangladesh wage up 36%: factory, shirt, rising arrow.
function illoWage(x: number, y: number, w: number, h: number): void {
  rect(x, y, w, h, TEAL);
  // Factory.
  rect(x + 14, y + h - 26, 90, 26, INK);
  rect(x + 24, y + h - 40, 10, 14, INK);
  rect(x + 44, y + h - 44, 10, 18, INK);
  // T-shirt.
  rect(x + 130, y + 10, 46, 30, CREAM);
  tri(x + 130, y + 10, x + 118, y + 20, x + 130, y + 22, CREAM);
  tri(x + 176, y + 10, x + 188, y + 20, x + 176, y + 22, CREAM);
  // Rising arrow.
  thickSeg(x + 206, y + h - 8, x + w - 16, y + 8, 4, GOLD);
  tri(x + w - 16, y + 8, x + w - 30, y + 10, x + w - 18, y + 22, GOLD);
}

// LOW C — Indonesia mine floods: shaft, rising water, rescue helmet.
function illoMine(x: number, y: number, w: number, h: number): void {
  rect(x, y, w, h, [58, 40, 20]);
  // Timber-framed shaft entrance.
  rect(x + 20, y + 10, 90, h - 20, INK);
  frame(x + 20, y + 10, 90, h - 20, 4, [139, 90, 43]);
  // Flood water rising inside the shaft.
  rect(x + 24, y + h - 22, 82, 18, [24, 72, 110]);
  thickPath(
    [
      [x + 24, y + h - 22],
      [x + 50, y + h - 26],
      [x + 76, y + h - 22],
      [x + 102, y + h - 26],
    ],
    2,
    CREAM,
  );
  // Rescue helmet with headlamp, right side.
  disc(x + w - 60, y + h - 18, 12, GOLD);
  rect(x + w - 76, y + h - 18, 32, 5, GOLD);
  disc(x + w - 60, y + h - 26, 4, CREAM);
  // Rope down into the shaft.
  seg(x + w - 60, y + 6, x + w - 60, y + h - 30, CREAM);
}

// ---------------------------------------------------------------------------
// Story panel: kicker + illustration + headline + deck.
// ---------------------------------------------------------------------------

interface Story {
  kicker: string;
  headline: string;
  deck: string;
  draw: (x: number, y: number, w: number, h: number) => void;
}

function drawPanel(s: Story, x: number, y: number, w: number, h: number, lead: boolean, illoH: number, hh: number, lh: number): void {
  frame(x, y, w, h, 2, INK);
  const pad = 12;
  const ix = x + pad;
  const iw = w - pad * 2;
  text(ix, y + 9, s.kicker, 2, RED);
  const iy = y + 29;
  s.draw(ix, iy, iw, illoH);
  frame(ix, iy, iw, illoH, 2, INK);
  const hs = lead ? 4 : 3;
  const hy = iy + illoH + 11;
  const lines = wrap(s.headline, Math.floor(iw / cw(hs)));
  for (let i = 0; i < lines.length; i++) text(ix, hy + i * hh, lines[i], hs, INK);
  const dy = hy + lines.length * hh + 7;
  wrapped(ix, dy, s.deck, 2, Math.floor(iw / cw(2)), lh, BODY);
}

// ---------------------------------------------------------------------------
// The stories — every one first reported on Wednesday 25 November 2026
// (Reuters, Daily Summary of World, WireMinute, OneTurn).
// ---------------------------------------------------------------------------

const LEAD_A: Story = {
  kicker: 'CONFLICT — SAUDI ARABIA',
  headline: 'HOUTHI STRIKE SAUDI REFINERY',
  deck: 'HOUTHIS CLAIM STRIKES ON RAS TANURA AND RIYADH. FOUR DRONES DOWNED.',
  draw: illoRefinery,
};

const LEAD_B: Story = {
  kicker: 'POLITICS — CHINA',
  headline: 'CHINA PURGES SHANGHAI CHIEF',
  deck: 'SHANGHAI CHIEF CHEN JINING PROBED. FOURTH POLITBURO PURGE SINCE 2025.',
  draw: illoPurge,
};

const MID_A: Story = {
  kicker: 'SPACE — CHINA',
  headline: 'FIRST FOREIGN ASTRONAUT',
  deck: "PAKISTAN'S ZEESHAN ALI RIDES SHENZHOU-24 TO THE TIANGONG STATION.",
  draw: illoSpace,
};

const MID_B: Story = {
  kicker: 'CRIME — COLOMBIA',
  headline: 'COLOMBIA FREES HOSTAGES',
  deck: 'TROOPS STORM CARTAGENA MARKET. ALL HOSTAGES FREED.',
  draw: illoHostage,
};

const MID_C: Story = {
  kicker: 'MARKETS — USA',
  headline: 'TARIFF FEARS SLAM MARKETS',
  deck: 'NASDAQ FUTURES -2%. NIKKEI -2.76%. TARIFF PROBE SPOOKS INVESTORS.',
  draw: illoMarkets,
};

const LOW_A: Story = {
  kicker: 'LABOUR — BANGLADESH',
  headline: 'BANGLADESH WAGE UP 36%',
  deck: 'GARMENT PAY RISES 36% TO 17,000 TAKA AFTER WEEKS OF PROTESTS.',
  draw: illoWage,
};

const LOW_B: Story = {
  kicker: 'DIPLOMACY — N. KOREA',
  headline: 'N. KOREA EXPELS SWISS ENVOY',
  deck: 'PYONGYANG ORDERS SWISS OFFICE SHUT. ENVOY GIVEN 48 HOURS TO LEAVE.',
  draw: illoExpel,
};

const LOW_C: Story = {
  kicker: 'DISASTER — INDONESIA',
  headline: 'INDONESIA MINE FLOODS',
  deck: 'RESCUERS HUNT FOR DOZENS TRAPPED IN A FLOODED GOLD MINE IN WEST JAVA.',
  draw: illoMine,
};

const BRIEFS =
  'UK WARNS FIRMS OF RUSSIAN SABOTAGE \u2022 SAUDI COALITION HITS HODEIDAH PORT \u2022 SOLOMON ISLANDS SIGN AUSTRALIA TREATY \u2022 SENEGAL REGAIN AFCON TITLE \u2022 SIX DEAD IN MISSISSIPPI PLANE CRASH \u2022 UKRAINE SEEKS EU115BN FOR 2027';

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

function render(): void {
  rect(0, 0, W, H, PAPER);

  // Masthead.
  textCentred(512, 22, 'THE WORLD IN ONE DAY', 6, INK);
  textCentred(512, 74, 'WEDNESDAY, 25 NOVEMBER 2026', 2, INK);
  hline(28, 98, 968, 3, INK);
  hline(28, 104, 968, 1, INK);

  // Lead row: the two biggest stories.
  drawPanel(LEAD_A, 28, 118, 472, 280, true, 92, 30, 16);
  drawPanel(LEAD_B, 524, 118, 472, 280, true, 92, 30, 16);
  hline(28, 410, 968, 2, INK);

  // Middle row: Gulf, Indonesia fire, FBI hack.
  drawPanel(MID_A, 28, 422, 312, 240, false, 76, 23, 16);
  drawPanel(MID_B, 356, 422, 312, 240, false, 76, 23, 16);
  drawPanel(MID_C, 684, 422, 312, 240, false, 76, 23, 16);
  hline(28, 674, 968, 2, INK);

  // Bottom row: Nigeria boat, Denmark, Baltic ship.
  drawPanel(LOW_A, 28, 686, 312, 204, false, 52, 22, 15);
  drawPanel(LOW_B, 356, 686, 312, 204, false, 52, 22, 15);
  drawPanel(LOW_C, 684, 686, 312, 204, false, 52, 22, 15);
  hline(28, 902, 968, 2, INK);

  // Footer: the rest of the day in brief.
  text(28, 914, 'ALSO TODAY', 2, RED);
  wrapped(28, 934, BRIEFS, 2, 80, 17, INK);
  textCentred(512, 994, 'SOURCES: REUTERS \u2022 DAILY SUMMARY OF WORLD \u2022 WIREMINUTE \u2014 25 NOVEMBER 2026', 2, GREY);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function main(): void {
  render();
  const png = encodePNG();
  const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, 'entry.png');
  writeFileSync(outPath, png);
  console.log(`wrote ${outPath} (${png.length} bytes, ${W}x${H})`);
}

main();
