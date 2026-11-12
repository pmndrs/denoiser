#!/usr/bin/env node
// Track S: frame strips of a crop for Dennis (docs/research/rt-denoiser/tracks/s.md). Rows = denoisers (+ ref, raw),
// columns = frames; top block the visibility (contrast-stretched lo..hi), bottom block |x_t - x_t-1| x gain along the
// motion-compensated history (max-weight valid tap, as knot-boil.mjs), so boil shows as speckle / blotches that change.
//
//   node strip.mjs <capture> <den,...> --rect x,y,w,h --frames 30,31,32,33 --out file.png [--lo 0.15 --hi 0.95]
//        [--gain 25] [--scale 2] [--labels a,b]
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { OUTPUTS_DIR, frameDir, isScored, readBuffer, readF32, readManifest, resolveCapture } from '../../../../../../tools/rt-capture/lib/capture.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i < 0 ? d : args[i + 1]; };
const capDir = resolveCapture(args[0]);
const capName = path.basename(capDir);
const dens = args[1].split(',');
const [rx, ry, rw, rh] = opt('rect').split(',').map(Number);
const frames = opt('frames').split(',').map(Number);
const LO = Number(opt('lo', 0.15)), HI = Number(opt('hi', 0.95)), GAIN = Number(opt('gain', 25)), S = Number(opt('scale', 2));
const m = readManifest(capDir);
const W = m.width, H = m.height;
const load = (d, f) => (d === 'ref' ? readBuffer(capDir, f, 'visibility_ref') : readF32(path.join(OUTPUTS_DIR, capName, d, frameDir(f), 'visibility.f32')));
function prevIdx(f) {
  // max-weight valid tap of each pixel's reprojection footprint (static pixels: itself)
  const depth = readBuffer(capDir, f, 'depth'), pdepth = readBuffer(capDir, f - 1, 'depth');
  const mo = readBuffer(capDir, f, 'motion'), vz = readBuffer(capDir, f, 'viewz'), pvz = readBuffer(capDir, f - 1, 'viewz');
  const mz = m.buffers.some((b) => b.name === 'motion_z') ? readBuffer(capDir, f, 'motion_z') : null;
  const out = new Int32Array(W * H).fill(-1);
  for (let y = ry; y < ry + rh; y++) for (let x = rx; x < rx + rw; x++) {
    const i = y * W + x;
    if (!isScored(depth[i])) continue;
    const px = x - 0.5 * mo[2 * i] * W, py = y + 0.5 * mo[2 * i + 1] * H;
    const bx = Math.floor(px), by = Math.floor(py), fx = px - bx, fy = py - by;
    const zExp = vz[i] + (mz ? mz[i] : 0), tol = 0.02 * Math.abs(vz[i]);
    let bw = -1;
    for (let k = 0; k < 4; k++) {
      const qx = bx + (k & 1), qy = by + (k >> 1), w = ((k & 1) ? fx : 1 - fx) * ((k >> 1) ? fy : 1 - fy);
      if (w <= 1e-3 || qx < 0 || qy < 0 || qx >= W || qy >= H) continue;
      const q = qy * W + qx;
      if (!isScored(pdepth[q]) || Math.abs(pvz[q] - zExp) > tol) continue;
      if (w > bw) { bw = w; out[i] = q; }
    }
  }
  return out;
}
const rows = [...dens, 'ref'];
const gap = 4;
const cw = rw * S, ch = rh * S;
const OW = frames.length * (cw + gap) + gap, OH = 2 * rows.length * (ch + gap) + gap * 3;
const img = new Uint8Array(OW * OH * 3).fill(255);
const put = (X, Y, g) => { const o = (Y * OW + X) * 3; img[o] = img[o + 1] = img[o + 2] = g; };
const prevs = frames.map((f) => prevIdx(f));
rows.forEach((d, r) => {
  frames.forEach((f, c) => {
    const cur = load(d, f), prv = load(d, f - 1), pi = prevs[c];
    for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) {
      const i = (ry + y) * W + rx + x;
      const v = Math.min(Math.max(cur[i], 0), 1);
      const g1 = Math.round(255 * Math.min(Math.max((v - LO) / (HI - LO), 0), 1));
      const dq = pi[i] >= 0 ? Math.abs(v - Math.min(Math.max(prv[pi[i]], 0), 1)) : 0;
      const g2 = 255 - Math.round(255 * Math.min(dq * GAIN, 1));
      for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
        const X = gap + c * (cw + gap) + x * S + sx;
        put(X, gap + r * (ch + gap) + y * S + sy, g1);
        put(X, 2 * gap + rows.length * (ch + gap) + r * (ch + gap) + y * S + sy, g2);
      }
    }
  });
});
// PNG (RGB8)
const raw = Buffer.alloc((OW * 3 + 1) * OH);
for (let y = 0; y < OH; y++) { raw[y * (OW * 3 + 1)] = 0; Buffer.from(img.buffer, y * OW * 3, OW * 3).copy(raw, y * (OW * 3 + 1) + 1); }
const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc = (b) => { let c = -1; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
const ih = Buffer.alloc(13); ih.writeUInt32BE(OW, 0); ih.writeUInt32BE(OH, 4); ih[8] = 8; ih[9] = 2;
writeFileSync(opt('out'), Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
console.log(`${opt('out')}: rows ${rows.join(' / ')} (values ${LO}..${HI}, then |x_t - x_t-1| x ${GAIN}); frames ${frames.join(',')}; ${OW}x${OH}`);
