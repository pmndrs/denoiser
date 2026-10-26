#!/usr/bin/env node
// Contact / edge error decomposition (shadows follow-ups, scratch).
//   node diag.mjs <capture> <out1,out2,...> [--from 1] [--to 79] [--region contact|edge|all] [--json x]
// Region masks as tools/rt-capture/shadow-regions.mjs (edge: |grad R| >= 0.2 dilated 1 px; contact: edge or penumbra with
// 5x5 mean occluder distance < 0.25). Per output: pooled PSNR in the region, split by reference class (R <= 0.02 dark,
// R >= 0.98 lit, mid), by "ever occluded" (the pixel's own 1-ray sample hit an occluder in some frame = it has an own
// penumbra-scale estimate), the mean bias per class, and the worst 32x32 window of the first output (for crops).
import path from 'node:path';
import { writeFileSync, existsSync } from 'node:fs';
import { OUTPUTS_DIR, frameDir, gradMag, isScored, readBuffer, readF32, readManifest, resolveCapture } from '../../../../../tools/rt-capture/lib/capture.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i < 0 ? d : args[i + 1]; };
const capDir = resolveCapture(args[0]);
const cap = path.basename(capDir);
const outs = args[1].split(',');
const m = readManifest(capDir);
const W = m.width, H = m.height, N = W * H;
const from = Number(opt('from', 1)), to = Math.min(Number(opt('to', m.frames.length - 1)), m.frames.length - 1);
const region = opt('region', 'contact');

const load = (name, f) => name === 'noisy' ? readBuffer(capDir, f, 'visibility') : readF32(path.join(OUTPUTS_DIR, cap, name, frameDir(f), 'visibility.f32'));
const cl = (v) => (Number.isFinite(v) ? Math.min(Math.max(v, 0), 1) : 0);
const sse = outs.map(() => new Float64Array(N));
const bias = outs.map(() => new Float64Array(N));
const cnt = new Float64Array(N);
const everOcc = new Uint8Array(N);
const refMean = new Float64Array(N);
for (let f = from; f <= to; f++) {
  const depth = readBuffer(capDir, f, 'depth'), ref = readBuffer(capDir, f, 'visibility_ref');
  const v = readBuffer(capDir, f, 'visibility'), d = readBuffer(capDir, f, 'occluder_dist');
  for (let i = 0; i < N; i++) if (v[i] < 0.5 && d[i] > 0) everOcc[i] = 1;
  const g = gradMag(ref, depth, W, H);
  const core = new Uint8Array(N);
  for (let i = 0; i < N; i++) core[i] = isScored(depth[i]) && g[i] >= 0.2 ? 1 : 0;
  const mask = new Uint8Array(N);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (!isScored(depth[i])) continue;
    let e = 0;
    for (let dy = -1; dy <= 1 && !e; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < W && yy < H && core[yy * W + xx]) { e = 1; break; }
    }
    const r = ref[i];
    const pen = e || (r > 0.02 && r < 0.98);
    if (region === 'all') { mask[i] = 1; continue; }
    if (region === 'edge') { mask[i] = e; continue; }
    if (!pen) continue;
    let s = 0, n = 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
      const j = yy * W + xx;
      if (v[j] < 0.5 && d[j] > 0) { s += d[j]; n++; }
    }
    if (n >= 2 && s / n < 0.25) mask[i] = 1;
  }
  const o = outs.map((n) => load(n, f));
  for (let i = 0; i < N; i++) {
    if (!mask[i]) continue;
    cnt[i]++; refMean[i] += ref[i];
    for (let k = 0; k < outs.length; k++) { const e = cl(o[k][i]) - ref[i]; sse[k][i] += e * e; bias[k][i] += e; }
  }
}
const cls = (i) => { const r = refMean[i] / cnt[i]; return r <= 0.02 ? 'dark' : r >= 0.98 ? 'lit' : 'mid'; };
const res = {};
for (let k = 0; k < outs.length; k++) {
  const acc = {};
  const add = (key, i) => { const a = (acc[key] ??= { s: 0, n: 0, b: 0 }); a.s += sse[k][i]; a.n += cnt[i]; a.b += bias[k][i]; };
  for (let i = 0; i < N; i++) {
    if (!cnt[i]) continue;
    add('all', i); add(cls(i), i); add(everOcc[i] ? 'ownG' : 'noOwnG', i); add(`${cls(i)}/${everOcc[i] ? 'ownG' : 'noOwnG'}`, i);
  }
  const tot = acc.all.s;
  res[outs[k]] = Object.fromEntries(Object.entries(acc).map(([key, a]) => [key, { psnr: +(10 * Math.log10(a.n / Math.max(a.s, 1e-12))).toFixed(2), share: +(a.s / tot).toFixed(3), bias: +(a.b / a.n).toFixed(4), pxFrames: a.n }]));
}
// worst 32x32 window of the first output
let best = -1, bx = 0, by = 0;
for (let y = 0; y + 32 <= H; y += 8) for (let x = 0; x + 32 <= W; x += 8) {
  let s = 0;
  for (let yy = y; yy < y + 32; yy++) for (let xx = x; xx < x + 32; xx++) s += sse[0][yy * W + xx];
  if (s > best) { best = s; bx = x; by = y; }
}
const out = { cap, region, from, to, worst32: [bx, by, 32, 32], res };
console.log(JSON.stringify(out, null, 1));
if (opt('json')) writeFileSync(opt('json'), JSON.stringify(out, null, 1));
