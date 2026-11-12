#!/usr/bin/env node
// Track S: does the 1-ray input stay temporally stratified (blue-noise R_n sequence per pixel) when the camera moves?
// Per penumbra pixel (0.05 < ref < 0.95, receivers, not the knot), the mean of the raw samples over the last K frames
// carried along the nearest-tap history, against the mean reference over the same taps: variance ratio
// var(err) / mean(v(1 - v) / K) (1 = independent samples, < 1 = stratified).   node strat.mjs <capture> [K=16]
import { isScored, readBuffer, readManifest, resolveCapture } from '../../../../../../tools/rt-capture/lib/capture.mjs';
const capDir = resolveCapture(process.argv[2]), K = Number(process.argv[3] ?? 16);
const m = readManifest(capDir), W = m.width, H = m.height, N = W * H, F = m.frames.length;
const hasMz = m.buffers.some((b) => b.name === 'motion_z');
const best = [], raw = [], ref = [];
for (let f = 0; f < F; f++) {
  raw.push(readBuffer(capDir, f, 'visibility')); ref.push(readBuffer(capDir, f, 'visibility_ref'));
  const b = new Int32Array(N).fill(-1);
  if (f > 0) {
    const depth = readBuffer(capDir, f, 'depth'), pdepth = readBuffer(capDir, f - 1, 'depth'), mo = readBuffer(capDir, f, 'motion');
    const vz = readBuffer(capDir, f, 'viewz'), pvz = readBuffer(capDir, f - 1, 'viewz'), mz = hasMz ? readBuffer(capDir, f, 'motion_z') : null;
    for (let i = 0; i < N; i++) {
      if (!isScored(depth[i])) continue;
      if (Math.hypot(mo[2 * i] * W, mo[2 * i + 1] * H) * 0.5 > 3) continue;   // skip fast pixels (the knot)
      const x = i % W, y = (i / W) | 0;
      const qx = Math.round(x - 0.5 * mo[2 * i] * W), qy = Math.round(y + 0.5 * mo[2 * i + 1] * H);
      if (qx < 0 || qy < 0 || qx >= W || qy >= H) continue;
      const q = qy * W + qx;
      if (!isScored(pdepth[q]) || Math.abs(pvz[q] - vz[i] - (mz ? mz[i] : 0)) > 0.02 * Math.abs(vz[i])) continue;
      b[i] = q;
    }
  }
  best.push(b);
}
let se = 0, ev = 0, n = 0, shift = 0, nsh = 0;
for (let f = K; f < F; f++) {
  for (let i = 0; i < N; i++) {
    const r0 = ref[f][i];
    if (!(r0 > 0.05 && r0 < 0.95)) continue;
    let q = i, sr = 0, sv = 0, ok = true;
    for (let k = 0; k < K; k++) {
      const g = f - k;
      sr += raw[g][q]; sv += ref[g][q];
      if (k < K - 1) { const p = best[g][q]; if (p < 0) { ok = false; break; } if (p !== q) { shift++; } nsh++; q = p; }
    }
    if (!ok) continue;
    const mr = sr / K, mv = Math.min(Math.max(sv / K, 0), 1);
    se += (mr - mv) ** 2; ev += mv * (1 - mv) / K; n++;
  }
}
console.log(`${m.frames.length} frames, K ${K}: ${n} pixel-windows, variance ratio ${(se / ev).toFixed(3)} (1 = white), tap moved on ${(100 * shift / Math.max(nsh, 1)).toFixed(1)} % of steps`);
