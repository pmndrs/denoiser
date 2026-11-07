#!/usr/bin/env node
// Track D: anti-lag mechanism statistics from a dbg-n replay (tools/wrap.ts: rgb = history length n, lambda, output luma)
// per calm.mjs-style region on still captures or for all scored pixels: fraction of pixels with lambda > 0 per frame,
// mean lambda, and the distribution of n (frames >= 8).
//   node lambda.mjs <capture> [--out dbg] [--from 8]
import path from 'node:path';
const REPO = new URL('../../../../../../', import.meta.url).pathname.replace(/\/$/, '');
const cap = await import(`${REPO}/tools/rt-capture/lib/capture.mjs`);
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i < 0 ? d : args[i + 1]; };
const capDir = cap.resolveCapture(args[0]);
const m = cap.readManifest(capDir);
const N = m.width * m.height, F = m.frames.length, FROM = Number(opt('from', 8));
const out = path.join(cap.OUTPUTS_DIR, path.basename(capDir), opt('out', 'dbg'));
let px = 0, lamPos = 0, lamSum = 0; const nh = new Float64Array(8); // n buckets: 1,2-3,4-7,8-15,16-31,32-63,64+
const edges = [1, 2, 4, 8, 16, 32, 64, 1e9];
for (let f = FROM; f < F; f++) {
  const d = cap.readBuffer(capDir, f, 'depth');
  const o = cap.readF32(path.join(out, cap.frameDir(f), 'diffuse.f32'));
  const ch = o.length / N;
  for (let i = 0; i < N; i++) {
    if (!(d[i] > 0 && d[i] < 1)) continue;
    const n = o[i * ch], l = o[i * ch + 1];
    px++; if (l > 0) lamPos++; lamSum += l;
    let b = 0; while (n >= edges[b + 1]) b++; nh[b]++;
  }
}
console.log(`${path.basename(capDir)}: lambda > 0 on ${(100 * lamPos / px).toFixed(1)} % of pixel-frames, mean lambda ${(lamSum / px).toFixed(4)}; n: ` +
  ['1', '2-3', '4-7', '8-15', '16-31', '32-63', '64'].map((k, b) => `${k} ${(100 * nh[b] / px).toFixed(1)}%`).join(', '));
