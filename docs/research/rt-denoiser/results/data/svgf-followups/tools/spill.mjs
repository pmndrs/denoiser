#!/usr/bin/env node
// Spill scorer (svgf-followups item 1): where does constant-light boil come from during a light event?
// Static pixels = reference bit-identical over the whole capture (t3-score --stat 0). Each static pixel's
// Chebyshev distance (px) to the nearest non-static receiver -> buckets. Per bucket and window (pre [8,24),
// in [24,32), held [32,56), out [56,64)): boil = RMS second temporal difference (tonemapped x/(1+x)) / sqrt 6.
// With --dbg <output>: that output holds (n, lambda, lum) (scratch dbg-n entry): mean n, mean lambda, fraction lambda > 0.
//   node spill.mjs <capture> --den a,b --signals diffuse,specular [--dbg dbg-out] [--json f]
const REPO = '/Users/dex/Developer/Denoiser-nrd-cleanroom';
const cap = await import(`${REPO}/tools/rt-capture/lib/capture.mjs`);
import path from 'node:path';
import { writeFileSync, existsSync } from 'node:fs';
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i < 0 ? d : args[i + 1]; };
const capDir = cap.resolveCapture(args[0]);
const capName = path.basename(capDir);
const m = cap.readManifest(capDir);
const W = m.width, H = m.height, N = W * H, F = m.frames.length;
const dens = opt('den', '').split(',').filter(Boolean);
const sigs = opt('signals', 'diffuse,specular').split(',');
const dbg = opt('dbg', null);
const WIN = { pre: [8, 24], in: [24, 32], held: [32, 56], out: [56, 64] };
const EDGES = [0, 3, 6, 12, 24, 48, 1e9];
const bucketName = (b) => (EDGES[b + 1] >= 1e9 ? `>=${EDGES[b]}` : `${EDGES[b]}-${EDGES[b + 1] - 1}`);
const tm = (x) => (x > 0 ? x / (1 + x) : 0);
const depth0 = cap.readBuffer(capDir, 0, 'depth');
const outRoot = path.join(cap.OUTPUTS_DIR, capName);
const result = { capture: capName, signals: {} };
for (const s of sigs) {
  // static mask: ref bit-identical
  const ref0 = cap.readBuffer(capDir, 0, `${s}_ref`);
  const isStat = new Uint8Array(N); for (let i = 0; i < N; i++) isStat[i] = depth0[i] > 0 && depth0[i] < 1 ? 1 : 0;
  for (let f = 1; f < F; f++) {
    const r = cap.readBuffer(capDir, f, `${s}_ref`);
    for (let i = 0; i < N; i++) if (isStat[i] && (r[3 * i] !== ref0[3 * i] || r[3 * i + 1] !== ref0[3 * i + 1] || r[3 * i + 2] !== ref0[3 * i + 2])) isStat[i] = 0;
  }
  // distance to nearest non-static receiver (Chebyshev, two-pass)
  const INF = 1e6, dist = new Float32Array(N);
  for (let i = 0; i < N; i++) dist[i] = depth0[i] > 0 && depth0[i] < 1 && !isStat[i] ? 0 : INF;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x; let d = dist[i];
    if (x > 0) d = Math.min(d, dist[i - 1] + 1); if (y > 0) { d = Math.min(d, dist[i - W] + 1); if (x > 0) d = Math.min(d, dist[i - W - 1] + 1); if (x < W - 1) d = Math.min(d, dist[i - W + 1] + 1); } dist[i] = d; }
  for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) { const i = y * W + x; let d = dist[i];
    if (x < W - 1) d = Math.min(d, dist[i + 1] + 1); if (y < H - 1) { d = Math.min(d, dist[i + W] + 1); if (x < W - 1) d = Math.min(d, dist[i + W + 1] + 1); if (x > 0) d = Math.min(d, dist[i + W - 1] + 1); } dist[i] = d; }
  const bucket = new Int8Array(N).fill(-1);
  const cnt = new Array(EDGES.length - 1).fill(0);
  for (let i = 0; i < N; i++) if (isStat[i]) { let b = 0; while (dist[i] >= EDGES[b + 1]) b++; bucket[i] = b; cnt[b]++; }
  const sres = { static: cnt.reduce((a, b) => a + b, 0), buckets: Object.fromEntries(cnt.map((c, b) => [bucketName(b), c])), arms: {} };
  const winOf = (f) => Object.keys(WIN).find((k) => f >= WIN[k][0] && f < WIN[k][1]);
  for (const d of [...dens, ...(dbg ? [dbg] : [])]) {
    const dir = path.join(outRoot, d);
    if (!existsSync(dir)) { console.error('missing', dir); continue; }
    const isDbg = d === dbg;
    const acc = {}; for (const w of Object.keys(WIN)) acc[w] = cnt.map(() => ({ b: 0, n: 0, nSum: 0, lSum: 0, lPos: 0, k: 0 }));
    let p2 = null, p1 = null;
    for (let f = 0; f < F; f++) {
      const o = cap.readF32(path.join(dir, cap.frameDir(f), `${s}.f32`));
      const w = winOf(f);
      if (isDbg) {
        if (w) for (let i = 0; i < N; i++) { const b = bucket[i]; if (b < 0) continue; const a = acc[w][b]; a.nSum += o[3 * i]; a.lSum += o[3 * i + 1]; a.lPos += o[3 * i + 1] > 0 ? 1 : 0; a.k++; }
      } else {
        const t = new Float32Array(N * 3); for (let j = 0; j < N * 3; j++) t[j] = tm(o[j]);
        if (w && p2 && winOf(f - 2) === w) for (let i = 0; i < N; i++) { const b = bucket[i]; if (b < 0) continue; const a = acc[w][b];
          for (let c = 0; c < 3; c++) { const dd = t[3 * i + c] - 2 * p1[3 * i + c] + p2[3 * i + c]; a.b += dd * dd; } a.n += 3; }
        p2 = p1; p1 = t;
      }
    }
    sres.arms[d] = Object.fromEntries(Object.entries(acc).map(([w, arr]) => [w, arr.map((a, b) => (isDbg
      ? { bucket: bucketName(b), n: a.k ? a.nSum / a.k : null, lambda: a.k ? a.lSum / a.k : null, lambdaPos: a.k ? a.lPos / a.k : null }
      : { bucket: bucketName(b), boil: a.n ? Math.sqrt(a.b / a.n / 6) : null }))]));
  }
  result.signals[s] = sres;
  // print
  console.log(`\n${capName} ${s}: static ${sres.static} px; buckets ${JSON.stringify(sres.buckets)}`);
  for (const [d, wins] of Object.entries(sres.arms)) {
    if (d === dbg) {
      for (const w of ['pre', 'in', 'out']) console.log(`  ${d} ${w}: ` + wins[w].map((x) => `${x.bucket}: n ${x.n?.toFixed(1)} λ ${x.lambda?.toFixed(4)} λ>0 ${(100 * x.lambdaPos).toFixed(0)}%`).join(' | '));
    } else {
      const pre = wins.pre, inn = wins.in, out = wins.out;
      console.log(`  ${d.padEnd(10)} boil×1e4 pre/in/out (in Δ%): ` + pre.map((x, b) => `${x.bucket}: ${(x.boil * 1e4).toFixed(1)}/${(inn[b].boil * 1e4).toFixed(1)}/${(out[b].boil * 1e4).toFixed(1)} (${(100 * (inn[b].boil / x.boil - 1)).toFixed(0)}%)`).join(' | '));
    }
  }
}
if (opt('json')) writeFileSync(opt('json'), JSON.stringify(result, null, 1));
