#!/usr/bin/env node
// PNG montages of the reflect-build ROI crops (results.reflect.crops, src/reflect-eval.ts) from run-headless JSON.
//
//   node rm-crops.mjs <results.json> --out img/rm-cam-plane.png [--cols ref,noisy,svgf-auto,...] [--marker 1] [--frames 24,41]
//
// One row per (frame, marker) crop, columns left to right (default: ref, noisy, then every denoiser in the JSON);
// a 1-px dot marks the oracle position of the mirror image (red; grey when the image is not visible), 2 px gaps.
// Pixels are the page's 8-bit Reinhard x/(1+x) + gamma 2.2 encoding, scaled 2x (nearest).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { deflateSync } from 'node:zlib';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i < 0 ? d : args[i + 1]; };
const j = JSON.parse(readFileSync(args[0], 'utf8'));
const run = Array.isArray(j) ? j[0] : j;
const crops = (run.results?.reflect ?? run.reflect).crops.filter((c) =>
  (!opt('marker') || c.marker === Number(opt('marker'))) && (!opt('frames') || opt('frames').split(',').map(Number).includes(c.frame)));
if (!crops.length) { console.error('no crops'); process.exit(1); }
const cols = opt('cols')?.split(',') ?? Object.keys(crops[0].images);
const SC = Number(opt('scale', 2)), GAP = 2, S = crops[0].size;
const tw = S * SC, W = cols.length * (tw + GAP) - GAP, H = crops.length * (tw + GAP) - GAP;
const rgb = new Uint8Array(W * H * 3).fill(255);
crops.forEach((c, r) => cols.forEach((name, k) => {
  const b = Buffer.from(c.images[name] ?? '', 'base64');
  if (!b.length) return;
  const x0 = k * (tw + GAP), y0 = r * (tw + GAP);
  for (let y = 0; y < tw; y++) for (let x = 0; x < tw; x++) {
    const s = ((y / SC) | 0) * S + ((x / SC) | 0), d = ((y0 + y) * W + x0 + x) * 3;
    rgb[d] = b[s * 3]; rgb[d + 1] = b[s * 3 + 1]; rgb[d + 2] = b[s * 3 + 2];
  }
  const ox = Math.round((c.oracle[0] - c.ox) * SC), oy = Math.round((c.oracle[1] - c.oy) * SC);
  if (ox >= 0 && oy >= 0 && ox < tw && oy < tw) {
    const d = ((y0 + oy) * W + x0 + ox) * 3;
    rgb.set(c.present ? [255, 0, 0] : [128, 128, 128], d);
  }
}));
function png(px, w, h) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; Buffer.from(px.buffer, px.byteOffset + y * w * 3, w * 3).copy(raw, y * (w * 3 + 1) + 1); }
  const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
  const crc = (b) => { let c = -1; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
const out = opt('out', 'rm-crops.png');
mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
writeFileSync(out, png(rgb, W, H));
console.log(`${out}: ${crops.length} rows (${crops.map((c) => `f${c.frame} m${c.marker}`).join(', ')}) x ${cols.join(', ')}`);
