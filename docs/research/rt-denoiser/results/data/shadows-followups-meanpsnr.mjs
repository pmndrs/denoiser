// node meanpsnr.mjs <capture> <from> <to> <out1,out2,...>: PSNR of the window-mean output vs the window-mean reference
// (DISTANCE-LONG's "PSNR of mean"), per class (lit >= 0.98 / dark <= 0.02 / penumbra), plus edge sharpness of the mean.
import path from 'node:path';
import { OUTPUTS_DIR, frameDir, gradMag, isScored, readBuffer, readF32, readManifest, resolveCapture } from '../../../../../tools/rt-capture/lib/capture.mjs';
const [capA, from, to, outsA] = process.argv.slice(2);
const capDir = resolveCapture(capA); const cap = path.basename(capDir); const m = readManifest(capDir);
const W = m.width, H = m.height, N = W * H;
const outs = outsA.split(',');
const cl = (v) => (Number.isFinite(v) ? Math.min(Math.max(v, 0), 1) : 0);
const ref = new Float64Array(N), sums = outs.map(() => new Float64Array(N));
let depth; let n = 0;
for (let f = +from; f <= +to; f++) {
  depth = readBuffer(capDir, f, 'depth');
  const r = readBuffer(capDir, f, 'visibility_ref');
  for (let i = 0; i < N; i++) ref[i] += cl(r[i]);
  outs.forEach((o, k) => { const v = readF32(path.join(OUTPUTS_DIR, cap, o, frameDir(f), 'visibility.f32')); for (let i = 0; i < N; i++) sums[k][i] += cl(v[i]); });
  n++;
}
const R = Float32Array.from(ref, (x) => x / n);
const gR = gradMag(R, depth, W, H);
for (let k = 0; k < outs.length; k++) {
  const O = Float32Array.from(sums[k], (x) => x / n);
  const gO = gradMag(O, depth, W, H);
  const acc = { all: [0, 0], lit: [0, 0], dark: [0, 0], pen: [0, 0] };
  let so = 0, sr = 0;
  for (let i = 0; i < N; i++) {
    if (!isScored(depth[i])) continue;
    const e = (O[i] - R[i]) ** 2;
    const c = R[i] >= 0.98 ? 'lit' : R[i] <= 0.02 ? 'dark' : 'pen';
    acc.all[0] += e; acc.all[1]++; acc[c][0] += e; acc[c][1]++;
    if (gR[i] > 0.1) { so += gO[i]; sr += gR[i]; }
  }
  const db = ([s, c]) => (10 * Math.log10(c / Math.max(s, 1e-12))).toFixed(3);
  console.log(`${cap} ${outs[k]} frames ${from}-${to}: mean-PSNR all ${db(acc.all)} lit ${db(acc.lit)} dark ${db(acc.dark)} pen ${db(acc.pen)} sharpness ${(so / sr).toFixed(3)}`);
}
