#!/usr/bin/env node
// compare.mjs-style dynamic-region boil decomposition on a STATIC-camera capture (history taps = same pixel).
//   node diag-boil.mjs <capture> <base> <variant> [--png out.png --frame f --rect x,y,w,h]
// dynamic: reference range over frames t-3..t > 0.05 (compare.mjs DYN_K 4 / DYN_DELTA 0.05). boil term b = o_t - 2 o_t-1 + o_t-2
// (clamped outputs) over dynamic pixels; boil = sqrt(mean b^2 / 6). Splits the variant-minus-base boil energy by:
//   diff   pixels where variant and base differ (> 1e-4) in frame t, t-1 or t-2 (the variant acted there)
//   refbig pixels where the reference's own |b| >= 0.02 (legitimate change, what shadow-regions masks out)
// and reports the "error boil" sqrt(mean (b_out - b_ref)^2 / 6) (temporal change that the reference does not have).
import path from 'node:path';
import { OUTPUTS_DIR, frameDir, isScored, readBuffer, readF32, readManifest, resolveCapture } from '../../../../../tools/rt-capture/lib/capture.mjs';

const args = process.argv.slice(2);
const capDir = resolveCapture(args[0]);
const cap = path.basename(capDir);
const [A, B] = [args[1], args[2]];
const m = readManifest(capDir);
const W = m.width, H = m.height, N = W * H, F = m.frames.length;
const cl = (v) => (Number.isFinite(v) ? Math.min(Math.max(v, 0), 1) : 0);
const ld = (n, f) => Float32Array.from(readF32(path.join(OUTPUTS_DIR, cap, n, frameDir(f), 'visibility.f32')), cl);
const acc = {};
const add = (k, ba, bb, br, n = 1) => {
  const a = (acc[k] ??= { a: 0, b: 0, r: 0, ea: 0, eb: 0, n: 0 });
  a.a += ba * ba; a.b += bb * bb; a.r += br * br; a.ea += (ba - br) ** 2; a.eb += (bb - br) ** 2; a.n += n;
};
const hist = { a: [], b: [], r: [] };
const refs = [];
const pixA = new Float64Array(N), pixB = new Float64Array(N);
for (let f = 0; f < F; f++) {
  const depth = readBuffer(capDir, f, 'depth'), ref = readBuffer(capDir, f, 'visibility_ref');
  const a = ld(A, f), b = ld(B, f), r = Float32Array.from(ref, cl);
  refs.push(r); if (refs.length > 4) refs.shift();
  hist.a.unshift(a); hist.b.unshift(b); hist.r.unshift(r);
  if (hist.a.length > 3) { hist.a.pop(); hist.b.pop(); hist.r.pop(); }
  if (f < 3 || m.frames[f].reset || m.frames[f - 1].reset || m.frames[f - 2].reset) continue;
  for (let i = 0; i < N; i++) {
    if (!isScored(depth[i])) continue;
    let lo = 1, hi = 0;
    for (const rr of refs) { lo = Math.min(lo, rr[i]); hi = Math.max(hi, rr[i]); }
    if (hi - lo <= 0.05) continue;
    const ba = hist.a[0][i] - 2 * hist.a[1][i] + hist.a[2][i];
    const bb = hist.b[0][i] - 2 * hist.b[1][i] + hist.b[2][i];
    const br = hist.r[0][i] - 2 * hist.r[1][i] + hist.r[2][i];
    let diff = false;
    for (let k = 0; k < 3; k++) if (Math.abs(hist.a[k][i] - hist.b[k][i]) > 1e-4) diff = true;
    const big = Math.abs(br) >= 0.02;
    add('all', ba, bb, br);
    add(diff ? 'diff' : 'same', ba, bb, br);
    add(big ? 'refbig' : 'refsmall', ba, bb, br);
    add(`${diff ? 'diff' : 'same'}/${big ? 'refbig' : 'refsmall'}`, ba, bb, br);
    pixA[i] += ba * ba; pixB[i] += bb * bb;
  }
}
const s = (x, n) => Math.sqrt(x / Math.max(n, 1) / 6);
const tot = acc.all;
console.log(`${cap}: ${A} vs ${B}, dynamic-region boil (compare.mjs form, static camera)`);
console.log('subset              share px   boil base  boil var   ref boil   d energy share   err-boil base  err-boil var');
for (const [k, v] of Object.entries(acc)) {
  console.log(k.padEnd(20), (v.n / tot.n).toFixed(3).padStart(8), s(v.a, v.n).toFixed(4).padStart(10), s(v.b, v.n).toFixed(4).padStart(10), s(v.r, v.n).toFixed(4).padStart(10),
    ((v.b - v.a) / (tot.b - tot.a)).toFixed(3).padStart(14), s(v.ea, v.n).toFixed(4).padStart(14), s(v.eb, v.n).toFixed(4).padStart(13));
}
// top 64x64 windows of boil-energy increase
const wins = [];
for (let y = 0; y + 64 <= H; y += 32) for (let x = 0; x + 64 <= W; x += 32) {
  let d = 0;
  for (let yy = y; yy < y + 64; yy++) for (let xx = x; xx < x + 64; xx++) d += pixB[yy * W + xx] - pixA[yy * W + xx];
  wins.push([d, x, y]);
}
wins.sort((p, q) => q[0] - p[0]);
console.log('top windows of boil-energy increase (share of total increase, x, y):', wins.slice(0, 6).map(([d, x, y]) => `${(d / (tot.b - tot.a)).toFixed(3)}@${x},${y}`).join(' '));
