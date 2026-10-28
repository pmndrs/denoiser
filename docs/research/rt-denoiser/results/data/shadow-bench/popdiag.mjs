// Pop diagnosis on the shadow bench (results/SHADOW-BENCH.md, "The mechanism"): the history state (A, from
// ShadowDenoiser.debugTexture('history') via the bench engine's readHistory) of the pixels whose output moves by > 0.04
// in a frame, on a still view: capped (A never above 4 in the window), restarting (A dropped at least once), steady.
//   node popdiag.mjs '<bench cfg json>' '<ours options json>' [frames]     e.g. '{"camera":"demo","knotRate":0}' '{}' 48
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../..');
const { ensureVite, openPage, sleep } = await import(path.join(ROOT, 'tools/rt-capture/lib/headless.mjs'));
const HERE = path.join(ROOT, 'examples/three-temporal');
const BASE = 'http://127.0.0.1:5266/';
const cfg = process.argv[2] ?? '{"camera":"demo","knotRate":0}';
const vopt = process.argv[3] ?? '{}';
const T = Number(process.argv[4] ?? 48);
const vite = await ensureVite({ root: HERE, base: BASE, args: ['--config', `${HERE}/vite.bench.config.ts`] });
const { cdp, close } = await openPage(`${BASE}shadow-bench.html?manual&shell=0&cfg=${encodeURIComponent(cfg)}`, { windowSize: '1400,1000' });
try {
  for (let i = 0; i < 400; i++) { if (await cdp.evalJs('!!window.__bench?.ready').catch(() => false)) break; await sleep(300); }
  const res = await cdp.evalJs(`(async () => {
    const e = window.__bench.engine, W = e.W, H = e.H, N = W * H;
    e.setVariants([{ id: 'ours', kind: 'ours', options: ${vopt} }]);
    e.reset(); await e.advanceTo(300);
    const G = await e.groundTruth(300), gt = Float32Array.from(G.gt, (v, i) => (G.recv[i] ? v : -1));
    let prev = null, prevA = null, r0obj = null;
    const T = ${T}, popCount = new Uint16Array(N), aMax = new Float32Array(N), restarts = new Uint16Array(N), popsAt = [];
    const hAll = new Float64Array(34), hPop = new Float64Array(34), hPrevPop = new Float64Array(34);
    let pops = 0, popsRestart = 0, pen = 0, popsRaw = 0, corr = [0, 0];
    let sumK = 0, nK = 0;
    for (let t = 0; t < T; t++) {
      e.step();
      const r = await e.readFrame(), out = r.outputs.ours, raw = r.noisy, h = await e.readHistory('ours');
      const A = new Float32Array(N);
      for (let i = 0; i < N; i++) A[i] = h[4 * i + 2] % 32;
      if (t === 0) { let a = 0, b = 0; for (let i = 0; i < N; i++) { const g = gt[i]; if (g < 0) continue; a += Math.abs(h[4 * i] - out[i]); const y = Math.floor(i / W), x = i % W; b += Math.abs(h[4 * ((H - 1 - y) * W + x)] - out[i]); } corr = [a, b]; }
      for (let i = 0; i < N; i++) { if (A[i] > aMax[i]) aMax[i] = A[i]; if (prevA && A[i] < prevA[i] - 1.5) restarts[i]++; }
      if (prev) for (let i = 0; i < N; i++) {
        const g = gt[i]; if (g < 0 || r.object[i] || !(g > 0.02 && g < 0.98)) continue;
        pen++; const a = Math.min(33, Math.round(A[i])); hAll[a]++;
        const d = out[i] - prev[i];
        if (Math.abs(d) > 0.04) {
          pops++; popCount[i]++; popsAt.push(i); hPop[a]++; hPrevPop[Math.min(33, Math.round(prevA[i]))]++;
          if (A[i] < prevA[i] - 1.5) popsRestart++;
          if (Math.sign(d) === Math.sign(raw[i] - prev[i])) popsRaw++;
          sumK += d / (raw[i] - prev[i] || 1e-9); nK++;
        }
      }
      prev = out; prevA = A; r0obj = r.object;
    }
    // classes: capped (A never above 4 in the window), restarting (A reached > 4 and dropped >= 1 time), steady (rest)
    const cls = (i) => (aMax[i] <= 4 ? 'capped' : restarts[i] ? 'restarting' : 'steady');
    const popBy = { capped: 0, restarting: 0, steady: 0 }, pixBy = { capped: 0, restarting: 0, steady: 0 };
    for (const i of popsAt) popBy[cls(i)]++;
    for (let i = 0; i < N; i++) { const g = gt[i]; if (g < 0 || r0obj[i] || !(g > 0.02 && g < 0.98)) continue; pixBy[cls(i)]++; }
    let rs = 0, rsPix = 0; for (let i = 0; i < N; i++) { const g = gt[i]; if (g < 0 || r0obj[i] || !(g > 0.02 && g < 0.98)) continue; if (restarts[i]) { rsPix++; rs += restarts[i]; } }
    let px = 0, px3 = 0; for (let i = 0; i < N; i++) { if (popCount[i]) px++; if (popCount[i] >= 3) px3++; }
    return JSON.stringify({ popBy, pixBy, restartsPerRestartingPixel: rs / rsPix, orientDiff: corr, pen, pops, popShare: pops / pen, restartShare: popsRestart / pops, sameSignAsRaw: popsRaw / pops, meanK: sumK / nK,
      popPixels: px, popPixels3plus: px3, hAll: Array.from(hAll, (x) => +(x / pen).toFixed(4)), hPop: Array.from(hPop, (x) => +(x / pops).toFixed(4)), hPrevPop: Array.from(hPrevPop, (x) => +(x / pops).toFixed(4)) });
  })()`, true);
  console.log(res);
} finally { await close(); if (vite.stop) vite.stop(); }
