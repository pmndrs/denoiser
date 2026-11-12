#!/usr/bin/env node
// Frame strips for results/T1-recovery.md: rows = frames, columns = outputs (+ ref, + age map), each tile a
// crop; optional error rows (|out - ref| x gain, tonemapped). Age = frames of valid history (t1-score.mjs
// definition), shown as grey: black = 0, white = >= 16.
//   node t1-strip.mjs <capture> --signal diffuse --frames 32,33,34 --rect x,y,w,h --cols svgf-auto,recurrent,ref
//        [--age] [--err 6] [--scale 2] --out x.png
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { deflateSync } from 'node:zlib';

const REPO = new URL('../../../../../', import.meta.url).pathname.replace(/\/$/, ''); // repo root (this file: docs/research/rt-denoiser/results/data/)
const cap = await import(`${REPO}/tools/rt-capture/lib/capture.mjs`);
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i < 0 ? d : args[i + 1]; };
const capDir = cap.resolveCapture(args[0]);
const capName = path.basename(capDir);
const m = cap.readManifest(capDir);
const W = m.width, H = m.height, N = W * H;
const sig = opt('signal', 'diffuse');
const ch = sig === 'visibility' ? 1 : 3;
const frames = opt('frames', '0').split(',').map(Number);
const [rx, ry, rw, rh] = opt('rect', `0,0,${W},${H}`).split(',').map(Number);
const cols = opt('cols', 'ref').split(',');
const showAge = args.includes('--age');
const errG = Number(opt('err', 0));
const scale = Number(opt('scale', 1));
const outRoot = path.join(cap.OUTPUTS_DIR, capName);
const tm = (v) => (ch === 1 ? Math.min(Math.max(v, 0), 1) : Math.max(v, 0) / (1 + Math.max(v, 0)));
const g22 = (v) => Math.round(255 * Math.pow(Math.min(Math.max(v, 0), 1), 1 / 2.2));

// ages up to the last requested frame
const ages = {};
let prevAge = null, prevVz = null;
const maxF = Math.max(...frames);
if (showAge) for (let f = 0; f <= maxF; f++) {
  const vz = cap.readBuffer(capDir, f, 'viewz'), depth = cap.readBuffer(capDir, f, 'depth');
  const age = new Float32Array(N);
  if (!(f === 0 || m.frames[f].reset)) {
    const mo = cap.readBuffer(capDir, f, 'motion'), mz = cap.readBuffer(capDir, f, 'motion_z');
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!(depth[i] > 0 && depth[i] < 1)) continue;
      const z = vz[i];
      const zl = vz[y * W + Math.max(x - 1, 0)], zr = vz[y * W + Math.min(x + 1, W - 1)];
      const zu = vz[Math.max(y - 1, 0) * W + x], zd = vz[Math.min(y + 1, H - 1) * W + x];
      const sl = Math.max(Math.min(Math.abs(zr - z), Math.abs(z - zl)), Math.min(Math.abs(zd - z), Math.abs(z - zu)));
      const px = x + 0.5 - 0.5 * mo[2 * i] * W - 0.5, py = y + 0.5 + 0.5 * mo[2 * i + 1] * H - 0.5;
      const bx = Math.floor(px), by = Math.floor(py), fx = px - bx, fy = py - by;
      const exp = z + mz[i], tol = 0.01 * Math.abs(z) + 2 * sl + 1e-4;
      let bw = -1;
      for (let k = 0; k < 4; k++) {
        const qx = bx + (k & 1), qy = by + (k >> 1);
        if (qx < 0 || qy < 0 || qx >= W || qy >= H) continue;
        const w = ((k & 1) ? fx : 1 - fx) * ((k >> 1) ? fy : 1 - fy), q = qy * W + qx;
        if (Math.abs(prevVz[q] - exp) <= tol && w > bw) { bw = w; age[i] = prevAge[q] + 1; }
      }
    }
  }
  ages[f] = age; prevAge = age; prevVz = vz;
}

const tw = rw * scale, th = rh * scale, gap = 2;
const ncol = cols.length + (showAge ? 1 : 0);
const rowsPerFrame = errG ? 2 : 1;
const IW = ncol * tw + (ncol - 1) * gap, IH = frames.length * rowsPerFrame * th + (frames.length * rowsPerFrame - 1) * gap;
const img = new Uint8Array(IW * IH * 3).fill(255);
const put = (X, Y, r, g, b) => { const o = (Y * IW + X) * 3; img[o] = r; img[o + 1] = g; img[o + 2] = b; };
frames.forEach((f, fi) => {
  const ref = cap.readBuffer(capDir, f, `${sig}_ref`);
  const load = (c) => (c === 'ref' ? ref : c === 'noisy' ? cap.readBuffer(capDir, f, sig) : cap.readF32(path.join(outRoot, c, cap.frameDir(f), `${sig}.f32`)));
  const tiles = cols.map(load);
  for (let ci = 0; ci < ncol; ci++) {
    const isAge = showAge && ci === cols.length;
    const a = isAge ? null : tiles[ci];
    const ach = a ? a.length / N : 1;
    for (let rr = 0; rr < rowsPerFrame; rr++) {
      const Y0 = (fi * rowsPerFrame + rr) * (th + gap), X0 = ci * (tw + gap);
      for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
        const sx = rx + Math.floor(x / scale), sy = ry + Math.floor(y / scale), i = sy * W + sx;
        if (isAge) { const v = rr === 0 ? g22(Math.min(ages[f][i], 16) / 16) : 255; put(X0 + x, Y0 + y, v, v, rr === 0 ? v : 255); continue; }
        const px = [0, 1, 2].map((c) => tm(a[i * ach + Math.min(c, ach - 1)]));
        if (rr === 0) put(X0 + x, Y0 + y, g22(px[0]), g22(px[1]), g22(px[2]));
        else {
          const rv = [0, 1, 2].map((c) => tm(ref[i * ch + Math.min(c, ch - 1)]));
          const e = Math.sqrt(((px[0] - rv[0]) ** 2 + (px[1] - rv[1]) ** 2 + (px[2] - rv[2]) ** 2) / 3) * errG;
          const v = g22(e); put(X0 + x, Y0 + y, v, v, v);
        }
      }
    }
  }
});
// PNG
const crc = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return (b) => { let c = -1; for (const x of b) c = t[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; }; })();
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
const raw = Buffer.alloc((IW * 3 + 1) * IH);
for (let y = 0; y < IH; y++) { raw[y * (IW * 3 + 1)] = 0; Buffer.from(img.buffer, y * IW * 3, IW * 3).copy(raw, y * (IW * 3 + 1) + 1); }
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(IW, 0); ihdr.writeUInt32BE(IH, 4); ihdr[8] = 8; ihdr[9] = 2;
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
const out = opt('out', 'strip.png');
writeFileSync(out, png);
console.log(`wrote ${out} (${IW}x${IH}, ${Math.round(png.length / 1024)} KB)`);
