#!/usr/bin/env node
// PNG crops of scalar test-bed signals (T5 occlusion: ao / so; also shadows) from an eval run
// with `&dump=F&dumpRect=x,y,w,h` (main.ts): one row of tiles (noisy, the denoisers, ref),
// optionally a second row of |tile - ref| * gain. Display: clamp to [0, 1], gamma 1/2.2 (as the
// view panels); errors linear. 2 px white gaps, nearest-neighbour upscale.
//
//   node run-headless.mjs --json=out.json "signal=ao&mode=eval&preset=full&path=glossy&frames=41&flip=0\
//     &denoiser=occlusion-recurrent,occlusion-svgf&dump=40&dumpRect=900,600,240,160"
//   node occlusion-crops.mjs out.json --signal ao --cols noisy,occlusion-recurrent,occlusion-svgf,ref \
//     [--scale 2] [--err 4] --out ../../docs/research/rt-denoiser/results/img/m5-x.png
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { deflateSync } from 'node:zlib';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i < 0 ? d : args[i + 1]; };
let r = JSON.parse(readFileSync(args[0], 'utf8'));
r = Array.isArray(r) ? r[0] : r;
r = r.results?.dumps ? r.results : r;
const dumps = r.dumps;
if (!dumps) throw new Error('no dumps in the JSON (run the eval with &dump=F&dumpRect=...)');
const signal = opt('signal', Object.keys(dumps.data)[0]);
const [, , w, h] = dumps.rect;
const d = dumps.data[signal];
const cols = opt('cols', Object.keys(d).join(',')).split(',');
const scale = Number(opt('scale', 1));
const gain = Number(opt('err', 0));
const gap = 2;
const ch = d.ref.length / (w * h);
const lum = (a, i) => (ch === 1 ? a[i] : (a[3 * i] + a[3 * i + 1] + a[3 * i + 2]) / 3);
const rows = gain > 0 ? 2 : 1;
const TW = w * scale, TH = h * scale;
const OW = cols.length * TW + (cols.length - 1) * gap, OH = rows * TH + (rows - 1) * gap;
const img = new Uint8Array(OW * OH).fill(255);
cols.forEach((c, k) => {
  const a = d[c];
  if (!a) throw new Error(`no dump '${c}' (have ${Object.keys(d).join(', ')})`);
  for (let y = 0; y < TH; y++) for (let x = 0; x < TW; x++) {
    const i = Math.floor(y / scale) * w + Math.floor(x / scale);
    const v = Math.min(Math.max(lum(a, i), 0), 1);
    img[y * OW + k * (TW + gap) + x] = Math.round(255 * v ** (1 / 2.2));
    if (rows > 1) {
      const e = Math.min(Math.abs(v - Math.min(Math.max(lum(d.ref, i), 0), 1)) * gain, 1);
      img[(TH + gap + y) * OW + k * (TW + gap) + x] = Math.round(255 * e);
    }
  }
});
// minimal 8-bit grayscale PNG
const crcTable = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0); out.write(type, 4, 'ascii'); Buffer.from(data).copy(out, 8);
  out.writeUInt32BE(crc(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(OW, 0); ihdr.writeUInt32BE(OH, 4); ihdr[8] = 8; ihdr[9] = 0;
const raw = Buffer.alloc((OW + 1) * OH);
for (let y = 0; y < OH; y++) { raw[y * (OW + 1)] = 0; Buffer.from(img.subarray(y * OW, (y + 1) * OW)).copy(raw, y * (OW + 1) + 1); }
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
const out = opt('out', 'crop.png');
mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
writeFileSync(out, png);
console.log(`${out}: ${OW}x${OH}, ${(png.length / 1024).toFixed(1)} KB, cols ${cols.join(' | ')}${rows > 1 ? `, |err| x ${gain}` : ''}`);
