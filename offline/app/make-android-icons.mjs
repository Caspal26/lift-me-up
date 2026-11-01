#!/usr/bin/env node
// Android launcher icons and splash for the offline app, drawn with the same
// sun-over-the-horizon mark and colours as scripts/make-icons.js (the PWA's
// icons), at Android's densities. Usage: node offline/app/make-android-icons.mjs
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const RES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'android', 'app', 'src', 'main', 'res');
const TERRACOTTA = [168, 74, 36];
const CREAM = [251, 241, 228];

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePng(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
function capsule(u, v, x1, y1, x2, y2, r) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const t = Math.max(0, Math.min(1, ((u - x1) * dx + (v - y1) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(u - (x1 + t * dx), v - (y1 + t * dy)) <= r;
}
function roundedSquare(u, v, radius) {
  const qx = Math.max(Math.abs(u - 0.5) - (0.5 - radius), 0);
  const qy = Math.max(Math.abs(v - 0.5) - (0.5 - radius), 0);
  return Math.hypot(qx, qy) <= radius;
}
function sun(u, v) {
  const cx = 0.5;
  const cy = 0.6;
  if (v <= cy && Math.hypot(u - cx, v - cy) <= 0.2) return true;
  for (const deg of [-90, -50, -130, -12, -168]) {
    const a = (deg * Math.PI) / 180;
    if (capsule(u, v, cx + 0.27 * Math.cos(a), cy + 0.27 * Math.sin(a), cx + 0.35 * Math.cos(a), cy + 0.35 * Math.sin(a), 0.024)) return true;
  }
  if (capsule(u, v, 0.2, 0.67, 0.8, 0.67, 0.024)) return true;
  return capsule(u, v, 0.35, 0.755, 0.65, 0.755, 0.022);
}
function draw(size, { background, shape, foreground, scale }) {
  const S = 4;
  const px = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let fg = 0;
      let bg = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const u = (x + (sx + 0.5) / S) / size;
          const v = (y + (sy + 0.5) / S) / size;
          const inside = shape === 'full' || (shape === 'rounded' && roundedSquare(u, v, 0.22)) || (shape === 'circle' && Math.hypot(u - 0.5, v - 0.5) <= 0.5);
          const inMark = sun(0.5 + (u - 0.5) / scale, 0.5 + (v - 0.5) / scale);
          if (inMark && (inside || !background)) fg++;
          else if (inside && background) bg++;
        }
      }
      const i = (y * size + x) * 4;
      if (fg + bg === 0) continue;
      for (let c = 0; c < 3; c++) px[i + c] = Math.round(((foreground[c] * fg) + ((background?.[c] ?? 0) * bg)) / (fg + bg));
      px[i + 3] = Math.round(((fg + bg) / (S * S)) * 255);
    }
  }
  return encodePng(size, px);
}

const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
for (const [d, k] of Object.entries(DENSITIES)) {
  const dir = path.join(RES, `mipmap-${d}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'ic_launcher.png'), draw(Math.round(48 * k), { background: TERRACOTTA, shape: 'rounded', foreground: CREAM, scale: 1 }));
  fs.writeFileSync(path.join(dir, 'ic_launcher_round.png'), draw(Math.round(48 * k), { background: TERRACOTTA, shape: 'circle', foreground: CREAM, scale: 0.85 }));
  // Adaptive foreground: 108dp canvas, mark kept inside the 66dp safe zone.
  fs.writeFileSync(path.join(dir, 'ic_launcher_foreground.png'), draw(Math.round(108 * k), { background: null, shape: 'none', foreground: CREAM, scale: 0.62 }));
}
// Splash mark for Android 11 and earlier (Android 12+ draws its own from the launcher icon).
fs.writeFileSync(path.join(RES, 'drawable', 'splash_mark.png'), draw(288, { background: TERRACOTTA, shape: 'rounded', foreground: CREAM, scale: 1 }));
console.log('Android icons written');
