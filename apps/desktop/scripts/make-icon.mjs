// Writes the placeholder app icon build/icon.png (1024×1024 RGBA) without image libraries:
// a dark green rounded square with three stylised trees. electron-builder derives the macOS
// .icns, the Windows .ico and the Linux icon sizes from it. Replace it with a real icon later.
// Run: node scripts/make-icon.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const size = 1024;
const out = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'build', 'icon.png');

const background = [0x1f, 0x4d, 0x3a];
const trees = [
  // [centre x, top y, half width at the base, base y, colour]
  [330, 300, 170, 760, [0x5f, 0xa8, 0x6b]],
  [700, 340, 160, 780, [0x7f, 0xc2, 0x7a]],
  [512, 200, 210, 840, [0xa8, 0xd8, 0x8c]],
];
const radius = 180;
const margin = 32;

function insideRoundedSquare(x, y) {
  const lo = margin + radius;
  const hi = size - margin - radius;
  const cx = Math.min(Math.max(x, lo), hi);
  const cy = Math.min(Math.max(y, lo), hi);
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
}

function pixel(x, y) {
  if (!insideRoundedSquare(x, y)) return [0, 0, 0, 0];
  let colour = background;
  for (const [cx, top, half, base, fill] of trees) {
    if (y >= top && y <= base && Math.abs(x - cx) <= (half * (y - top)) / (base - top)) {
      colour = fill;
    }
    // trunk
    if (y > base && y <= base + 70 && Math.abs(x - cx) <= 22) colour = [0x6b, 0x4a, 0x2b];
  }
  return [...colour, 255];
}

const raw = Buffer.alloc((size * 4 + 1) * size);
for (let y = 0; y < size; y++) {
  const row = y * (size * 4 + 1);
  raw[row] = 0; // filter: none
  for (let x = 0; x < size; x++) raw.set(pixel(x, y), row + 1 + x * 4);
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

const header = Buffer.alloc(13);
header.writeUInt32BE(size, 0);
header.writeUInt32BE(size, 4);
header[8] = 8; // bit depth
header[9] = 6; // RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', header),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, png);
console.log(`wrote ${out} (${png.length} bytes)`);
