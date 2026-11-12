#!/usr/bin/env node
// Track S: where the pops are. Static-camera captures only (history = same pixel): per pixel, the number of frames
// >= 8 whose |x_t - 2 x_t-1 + x_t-2| exceeds --thr (default 0.1, i.e. ~0.04 after / sqrt 6), side by side for each
// denoiser and the reference (white = none, black = >= --max frames). Prints the pop count per denoiser.
//   node popmap.mjs <capture> <den,...> --out file.png [--thr 0.1] [--max 4]
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { OUTPUTS_DIR, frameDir, isScored, readBuffer, readF32, readManifest, resolveCapture } from '../../../../../../tools/rt-capture/lib/capture.mjs';
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i < 0 ? d : args[i + 1]; };
const capDir = resolveCapture(args[0]), cap = path.basename(capDir), m = readManifest(capDir), W = m.width, H = m.height, N = W * H, F = m.frames.length;
const dens = [...args[1].split(','), 'ref'], THR = Number(opt('thr', 0.1)), MAX = Number(opt('max', 4));
const depth = readBuffer(capDir, 0, 'depth');
const load = (d, f) => (d === 'ref' ? readBuffer(capDir, f, 'visibility_ref') : readF32(path.join(OUTPUTS_DIR, cap, d, frameDir(f), 'visibility.f32')));
const maps = dens.map((d) => {
  const c = new Uint8Array(N); let total = 0;
  let x2 = load(d, 6), x1 = load(d, 7);
  for (let f = 8; f < F; f++) {
    const x = load(d, f);
    for (let i = 0; i < N; i++) if (isScored(depth[i]) && Math.abs(x[i] - 2 * x1[i] + x2[i]) > THR) { c[i]++; total++; }
    x2 = x1; x1 = x;
  }
  console.log(`${cap} ${d}: ${total} pops (|second difference| > ${THR}), ${(total / (F - 8)).toFixed(0)} per frame`);
  return c;
});
const OW = dens.length * W, img = Buffer.alloc((OW * 3 + 1) * H);
for (let y = 0; y < H; y++) for (let k = 0; k < dens.length; k++) for (let x = 0; x < W; x++) {
  const i = y * W + x, o = y * (OW * 3 + 1) + 1 + (k * W + x) * 3;
  const g = isScored(depth[i]) ? 255 - Math.round(255 * Math.min(maps[k][i] / MAX, 1)) : 200;
  img[o] = maps[k][i] ? g : 255; img[o + 1] = g; img[o + 2] = g;
}
const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc = (b) => { let c = -1; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
const ih = Buffer.alloc(13); ih.writeUInt32BE(OW, 0); ih.writeUInt32BE(H, 4); ih[8] = 8; ih[9] = 2;
writeFileSync(opt('out'), Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(img)), chunk('IEND', Buffer.alloc(0))]));
