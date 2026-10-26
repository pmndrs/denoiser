#!/usr/bin/env node
// Capture scorer for review target 8 (results/T8-jitter.md): camera jitter on / off, each configuration scored against
// references matched to ITS OWN camera sample sequence (never jittered pixels against unjittered ones).
//
// Inputs: a test-bed capture of a `*-jit` path (hold 0-31, sub-pixel pan 32-63, hold 64-95) and the replay outputs of
// some denoisers on it. Per (signal, denoiser, window) it reports, all on the test bed's scoring values (rgb: x / (1 + x)
// per channel; scalar: clamped to [0, 1]) over receivers (0 < depth < 1):
//
//   R1 = the capture's per-frame reference (same sample positions as the 1-spp input; jittered when the input is)
//   psnr / psnrB       pooled PSNR vs R1, all receivers / the boundary region (T6 definition: <= 2 px from a silhouette,
//                      crease or contact of the exact G-buffer, recomputed per frame from the capture's guides)
//   flip / flipB       mean LDR-FLIP vs R1 (every 4th window frame), all receivers / boundary pixels only
//   boil / boilB       motion-compensated second difference (score-captures.mjs / T6 definition: b = v_t - 2 v_t-1 +
//                      v_t-2 along the max-weight valid history tap, counted only where the reference's own b is < 0.02 in
//                      every channel), all / boundary; refBoil / refBoilB = the reference's own boil on the same pixels
//                      rule (q20 (a) floor)
//   bright             settled brightness: sum lum(out) / sum lum(R1) - 1 (linear values; lum709 for rgb), receivers
//   sharp              edge sharpness (capture.mjs edgeGradSums): sum |grad out| / sum |grad R1| where |grad R1| > thr, on
//                      the scoring value's luminance (thr 0.1 scalar, 0.05 rgb); 1 = as crisp as the reference
//   Hold windows only, R2 = the mean of R1 over the window (static view: the pixel-area average the jitter sequence
//   integrates; for jitter off R2 == R1, the references use fixed seeds):
//   r2psnr / r2psnrB / r2flip / r2flipB / r2sharp / r2bright / r2biasB (mean signed error at the boundary vs R2)
//   tstd / tstdB       per-pixel temporal standard deviation over the window (scoring values), RMS over the pixels that are
//                      receivers in every window frame / those of them in the boundary region; refTstd / refTstdB = the same for R1 (for jitter on: the reference's own aliasing flips)
//
//   node score.mjs <capture> [...] --outputs <root> --denoisers a,b [--windows holdA:16-31,pan:40-63,holdB:80-95] [--json f]
import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const REPO = new URL('../../../../../../', import.meta.url).pathname.replace(/\/$/, '');
const { OUTPUTS_DIR, frameDir, readBuffer, readF32, readManifest, resolveCapture, isScored, gradMag } = await import(`${REPO}/tools/rt-capture/lib/capture.mjs`);
const { prepareFlip, flipMean } = await import(`${REPO}/examples/realtime-denoiser/src/flip.ts`);

const args = process.argv.slice(2);
const VALUE_OPTS = new Set(['denoisers', 'json', 'outputs', 'windows', 'signals']);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i < 0 ? d : args[i + 1]; };
const caps = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && VALUE_OPTS.has(args[i - 1].slice(2))));
const WINDOWS = (opt('windows', 'holdA:16-31,pan:40-63,holdB:80-95')).split(',').map((w) => {
  const [name, r] = w.split(':'); const [a, b] = r.split('-').map(Number); return { name, a, b, hold: name.startsWith('hold') };
});
const SIG_CH = { diffuse: 3, specular: 3, visibility: 1, ao: 1, so: 1 };
const REF = { diffuse: 'diffuse_ref', specular: 'specular_ref', visibility: 'visibility_ref', ao: 'ao_ref', so: 'so_ref' };
const FLIP_EVERY = 4;
const BOIL_SMOOTH = 0.02;
const pooledDb = (e, k) => (k ? 10 * Math.log10(1 / Math.max(e / k, 1e-12)) : NaN);
const tmap = (x, ch) => (!Number.isFinite(x) ? 0 : ch === 1 ? Math.min(Math.max(x, 0), 1) : (x > 0 ? x / (1 + x) : 0));
const winOf = (f) => WINDOWS.find((w) => f >= w.a && f <= w.b);

/** boundary mask, the T6 / live test bed definition (results/data/t6-boundaries/score.mjs) */
function boundaryMask(depth, vz, nrm, W, H) {
  const N = W * H, z = new Float32Array(N); for (let i = 0; i < N; i++) z[i] = Math.abs(vz[i]);
  const out = new Uint8Array(N), R = 2;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (!isScored(depth[i])) continue;
    const zl = z[y * W + Math.max(x - 1, 0)], zr = z[y * W + Math.min(x + 1, W - 1)], zu = z[Math.max(y - 1, 0) * W + x], zd = z[Math.min(y + 1, H - 1) * W + x];
    const sl = Math.max(Math.min(Math.abs(zr - z[i]), Math.abs(z[i] - zl)), Math.min(Math.abs(zd - z[i]), Math.abs(z[i] - zu)));
    const nl = Math.hypot(nrm[3 * i], nrm[3 * i + 1], nrm[3 * i + 2]) || 1;
    let b = 0;
    for (let dy = -R; dy <= R && !b; dy++) for (let dx = -R; dx <= R; dx++) {
      const qx = x + dx, qy = y + dy;
      if (qx < 0 || qy < 0 || qx >= W || qy >= H) continue;
      const q = qy * W + qx;
      if (!isScored(depth[q])) { b = 1; break; }
      const ring = Math.max(Math.abs(dx), Math.abs(dy));
      if (Math.abs(z[q] - z[i]) > 0.02 * z[i] + 2 * ring * sl) { b = 1; break; }
      const ql = Math.hypot(nrm[3 * q], nrm[3 * q + 1], nrm[3 * q + 2]) || 1;
      if ((nrm[3 * i] * nrm[3 * q] + nrm[3 * i + 1] * nrm[3 * q + 1] + nrm[3 * i + 2] * nrm[3 * q + 2]) / (nl * ql) < 0.8) { b = 1; break; }
    }
    out[i] = b;
  }
  return out;
}
/** previous-frame pixel of each pixel's history (-1 = none): max-weight valid bilinear tap at the motion-reprojected
 * pixel centre (jitter ignored, as the denoisers and a TAA resolve treat it) */
function historyTaps(dir, m, f, mz) {
  const W = m.width, H = m.height, N = W * H, tap = new Int32Array(N).fill(-1);
  const depth = readBuffer(dir, f, 'depth'), pdepth = readBuffer(dir, f - 1, 'depth');
  const mo = readBuffer(dir, f, 'motion'), vz = readBuffer(dir, f, 'viewz'), pvz = readBuffer(dir, f - 1, 'viewz');
  const mzb = mz ? readBuffer(dir, f, 'motion_z') : null;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (!isScored(depth[i])) continue;
    const px = x - 0.5 * mo[2 * i] * W, py = y + 0.5 * mo[2 * i + 1] * H;
    const bx = Math.floor(px), by = Math.floor(py), fx = px - bx, fy = py - by;
    const zExp = vz[i] + (mzb ? mzb[i] : 0), tol = 0.02 * Math.abs(vz[i]);
    let bestW = -1, best = -1;
    for (let k = 0; k < 4; k++) {
      const qx = bx + (k & 1), qy = by + (k >> 1), w = ((k & 1) ? fx : 1 - fx) * ((k >> 1) ? fy : 1 - fy);
      if (w <= 1e-3 || qx < 0 || qy < 0 || qx >= W || qy >= H) continue;
      const q = qy * W + qx;
      if (!isScored(pdepth[q]) || Math.abs(pvz[q] - zExp) > tol) continue;
      if (w > bestW) { bestW = w; best = q; }
    }
    tap[i] = best;
  }
  return tap;
}
const lumOf = (d, ch, i) => (ch === 1 ? d[i] : 0.2126 * d[3 * i] + 0.7152 * d[3 * i + 1] + 0.0722 * d[3 * i + 2]);
/** scoring-value luminance image (for sharpness) */
function tlum(d, ch, N) {
  const o = new Float32Array(N);
  for (let i = 0; i < N; i++) o[i] = ch === 1 ? tmap(d[i], 1) : 0.2126 * tmap(d[3 * i], 3) + 0.7152 * tmap(d[3 * i + 1], 3) + 0.0722 * tmap(d[3 * i + 2], 3);
  return o;
}
function flipRgb(d, ch, N) {
  const g = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) for (let c = 0; c < 3; c++) g[3 * i + c] = tmap(d[i * ch + (ch === 3 ? c : 0)], ch);
  return g;
}

function scoreCapture(capName) {
  const dir = resolveCapture(capName);
  const m = readManifest(dir);
  const W = m.width, H = m.height, N = W * H, F = m.frames.length, ppd = W / 46.4;
  const has = new Set(m.buffers.map((b) => b.name));
  const sigWanted = opt('signals') ? opt('signals').split(',') : Object.keys(SIG_CH);
  const signals = sigWanted.filter((s) => has.has(REF[s]));
  const mz = has.has('motion_z');
  const outRoot = path.join(opt('outputs') ? path.resolve(opt('outputs')) : OUTPUTS_DIR, path.basename(dir));
  const denoisers = (opt('denoisers') ?? '').split(',').filter(Boolean);
  const jit = m.frames.map((fr) => fr.camera.jitter ?? [0, 0]);
  const jittered = jit.some((j) => j[0] !== 0 || j[1] !== 0);
  // motion speed per window (median |motion| in px over receivers, sampled)
  const speed = {};
  for (const w of WINDOWS) {
    const f = Math.floor((w.a + w.b) / 2), mo = readBuffer(dir, f, 'motion'), depth = readBuffer(dir, f, 'depth'), v = [];
    for (let i = 0; i < N; i += 7) if (isScored(depth[i])) v.push(Math.hypot(0.5 * mo[2 * i] * W, 0.5 * mo[2 * i + 1] * H));
    v.sort((a, b) => a - b); speed[w.name] = { medianPx: +v[v.length >> 1].toFixed(4), p95Px: +v[Math.floor(v.length * 0.95)].toFixed(4) };
  }
  // R2 per hold window and signal: mean of R1 over the window
  const r2 = {};
  for (const w of WINDOWS.filter((x) => x.hold)) for (const s of signals) {
    const ch = SIG_CH[s], acc = new Float64Array(N * ch);
    for (let f = w.a; f <= w.b; f++) { const r = readBuffer(dir, f, REF[s]); for (let i = 0; i < N * ch; i++) acc[i] += r[i]; }
    const o = new Float32Array(N * ch); for (let i = 0; i < N * ch; i++) o[i] = acc[i] / (w.b - w.a + 1);
    r2[`${w.name}/${s}`] = o;
  }
  const sources = (s) => [{ id: 'reference', get: (f) => readBuffer(dir, f, REF[s]) }, ...denoisers.map((d) => ({
    id: d, get: (f) => { const p = path.join(outRoot, d, frameDir(f), `${s}.f32`); return existsSync(p) ? readF32(p) : null; },
  }))];
  const newAcc = () => ({ e: 0, k: 0, eB: 0, kB: 0, flip: [], flipB: [], boil: 0, boilK: 0, boilB: 0, boilBK: 0, lo: 0, lr: 0, so: 0, sr: 0,
    r2e: 0, r2k: 0, r2eB: 0, r2kB: 0, r2flip: [], r2flipB: [], r2so: 0, r2sr: 0, r2lo: 0, r2lr: 0, r2bias: 0, r2biasK: 0,
    t1: null, t2: null, tn: 0 });
  const rows = [];
  let tapsPrev = null, taps = null;
  const tapCache = new Map();
  const tapsOf = (f) => { if (!tapCache.has(f)) { tapCache.set(f, f === 0 ? null : historyTaps(dir, m, f, mz)); if (tapCache.size > 3) tapCache.delete(tapCache.keys().next().value); } return tapCache.get(f); };
  for (const s of signals) {
    const ch = SIG_CH[s], thr = ch === 1 ? 0.1 : 0.05;
    const src = sources(s);
    const acc = {}; // acc[window][source]
    for (const w of WINDOWS) { acc[w.name] = {}; for (const x of src) acc[w.name][x.id] = newAcc(); }
    const hist = Object.fromEntries(src.map((x) => [x.id, { h1: null, h2: null }]));
    for (let f = 0; f < F; f++) {
      const w = winOf(f);
      const needBoil = w && f >= w.a; // boil needs the two previous frames in any case: keep the history every frame
      const depth = readBuffer(dir, f, 'depth');
      taps = tapsOf(f); tapsPrev = f > 0 ? tapsOf(f - 1) : null;
      const bnd = w ? boundaryMask(depth, readBuffer(dir, f, 'viewz'), readBuffer(dir, f, 'normal'), W, H) : null;
      const doFlip = w && (f - w.a) % FLIP_EVERY === FLIP_EVERY - 1;
      const ref = readBuffer(dir, f, REF[s]);
      const recv = new Uint8Array(N), recvB = new Uint8Array(N);
      for (let i = 0; i < N; i++) { recv[i] = isScored(depth[i]) ? 1 : 0; recvB[i] = recv[i] && bnd && bnd[i] ? 1 : 0; }
      const refFlip = doFlip ? prepareFlip(flipRgb(ref, ch, N), W, H, ppd) : null;
      const R2 = w && w.hold ? r2[`${w.name}/${s}`] : null;
      const r2Flip = doFlip && R2 ? prepareFlip(flipRgb(R2, ch, N), W, H, ppd) : null;
      const gRef = w ? gradMag(tlum(ref, ch, N), depth, W, H) : null;
      const gR2 = R2 ? gradMag(tlum(R2, ch, N), depth, W, H) : null;
      let smooth = null; // reference-smooth mask of this frame (from the reference's own b)
      for (const x of src) {
        const out = x.get(f);
        const h = hist[x.id];
        if (!out) { h.h1 = null; h.h2 = null; continue; }
        const v = new Float32Array(N * ch); for (let i = 0; i < N * ch; i++) v[i] = tmap(out[i], ch);
        const a = w ? acc[w.name][x.id] : null;
        // boil (motion-compensated second difference)
        if (needBoil && h.h1 && h.h2 && taps && tapsPrev) {
          const isRef = x.id === 'reference';
          if (isRef) smooth = new Uint8Array(N);
          for (let i = 0; i < N; i++) {
            if (!recv[i]) continue;
            const t1 = taps[i]; if (t1 < 0) continue;
            const t2 = tapsPrev[t1]; if (t2 < 0) continue;
            let s2 = 0, sm = 1;
            for (let c = 0; c < ch; c++) { const d = v[i * ch + c] - 2 * h.h1[t1 * ch + c] + h.h2[t2 * ch + c]; s2 += d * d; if (Math.abs(d) >= BOIL_SMOOTH) sm = 0; }
            if (isRef) smooth[i] = sm;
            if (!smooth || !smooth[i]) continue;
            a.boil += s2; a.boilK += ch;
            if (recvB[i]) { a.boilB += s2; a.boilBK += ch; }
          }
        }
        h.h2 = h.h1; h.h1 = v;
        if (!a) continue;
        // R1 errors, brightness
        for (let i = 0; i < N; i++) {
          if (!recv[i]) continue;
          let e2 = 0;
          for (let c = 0; c < ch; c++) { const d = v[i * ch + c] - tmap(ref[i * ch + c], ch); e2 += d * d; }
          a.e += e2; a.k += ch;
          if (recvB[i]) { a.eB += e2; a.kB += ch; }
          a.lo += lumOf(out, ch, i); a.lr += lumOf(ref, ch, i);
        }
        { const go = gradMag(tlum(out, ch, N), depth, W, H); for (let i = 0; i < N; i++) if (gRef[i] > thr) { a.so += go[i]; a.sr += gRef[i]; }
          if (R2) for (let i = 0; i < N; i++) if (gR2[i] > thr) { a.r2so += go[i]; a.r2sr += gR2[i]; } }
        if (doFlip) {
          const of = prepareFlip(flipRgb(out, ch, N), W, H, ppd);
          a.flip.push(flipMean(refFlip, of, recv)); a.flipB.push(flipMean(refFlip, of, recvB));
          if (r2Flip) { a.r2flip.push(flipMean(r2Flip, of, recv)); a.r2flipB.push(flipMean(r2Flip, of, recvB)); }
        }
        if (R2) {
          for (let i = 0; i < N; i++) {
            if (!recv[i]) continue;
            let e2 = 0, es = 0;
            for (let c = 0; c < ch; c++) { const d = v[i * ch + c] - tmap(R2[i * ch + c], ch); e2 += d * d; es += d; }
            a.r2e += e2; a.r2k += ch;
            if (recvB[i]) { a.r2eB += e2; a.r2kB += ch; a.r2bias += es / ch; a.r2biasK++; }
            a.r2lo += lumOf(out, ch, i); a.r2lr += lumOf(R2, ch, i);
          }
          // temporal std over the window
          if (!a.t1) { a.t1 = new Float64Array(N * ch); a.t2 = new Float64Array(N * ch); a.tc = new Uint8Array(N); }
          for (let i = 0; i < N; i++) {
            if (!recv[i]) continue;
            a.tc[i]++;
            for (let c = 0; c < ch; c++) { const x = v[i * ch + c]; a.t1[i * ch + c] += x; a.t2[i * ch + c] += x * x; }
          }
          a.tn++;
        }
      }
      // finalize the temporal std at the end of a hold window (receivers / boundary of the window's last frame)
      if (w && w.hold && f === w.b) for (const x of src) {
        const a = acc[w.name][x.id];
        if (!a.tn) continue;
        let s = 0, k = 0, sB = 0, kB = 0;
        for (let i = 0; i < N; i++) {
          if (!recv[i] || a.tc[i] !== a.tn) continue; // receiver in every window frame (a pixel that flips to sky is not a value change)
          for (let c = 0; c < ch; c++) { const mu = a.t1[i * ch + c] / a.tn; const va = Math.max(a.t2[i * ch + c] / a.tn - mu * mu, 0); s += va; k++; if (recvB[i]) { sB += va; kB++; } }
        }
        a.tstd = Math.sqrt(s / k); a.tstdB = Math.sqrt(sB / kB); a.t1 = null; a.t2 = null; a.tc = null;
      }
    }
    for (const w of WINDOWS) {
      const refA = acc[w.name].reference;
      for (const x of src) {
        const a = acc[w.name][x.id];
        const mean = (xs) => (xs.length ? xs.reduce((p, q) => p + q, 0) / xs.length : NaN);
        rows.push({
          capture: path.basename(dir), jittered, window: w.name, signal: s, denoiser: x.id,
          psnr: pooledDb(a.e, a.k), psnrB: pooledDb(a.eB, a.kB), flip: mean(a.flip), flipB: mean(a.flipB),
          boil: a.boilK ? Math.sqrt(a.boil / a.boilK / 6) : NaN, boilB: a.boilBK ? Math.sqrt(a.boilB / a.boilBK / 6) : NaN,
          refBoil: refA.boilK ? Math.sqrt(refA.boil / refA.boilK / 6) : NaN, refBoilB: refA.boilBK ? Math.sqrt(refA.boilB / refA.boilBK / 6) : NaN,
          bright: a.lr ? a.lo / a.lr - 1 : NaN, sharp: a.sr ? a.so / a.sr : NaN,
          ...(w.hold ? {
            r2psnr: pooledDb(a.r2e, a.r2k), r2psnrB: pooledDb(a.r2eB, a.r2kB), r2flip: mean(a.r2flip), r2flipB: mean(a.r2flipB),
            r2sharp: a.r2sr ? a.r2so / a.r2sr : NaN, r2bright: a.r2lr ? a.r2lo / a.r2lr - 1 : NaN, r2biasB: a.r2biasK ? a.r2bias / a.r2biasK : NaN,
            tstd: a.tstd, tstdB: a.tstdB, refTstd: refA.tstd, refTstdB: refA.tstdB,
          } : {}),
        });
      }
    }
  }
  return { capture: path.basename(dir), width: W, height: H, frames: F, jittered, jitter: jit.slice(0, 8), windows: WINDOWS, speed, rows };
}

const all = [];
for (const c of caps) {
  const t0 = Date.now();
  const r = scoreCapture(c);
  all.push(r);
  console.error(`${r.capture}: ${r.rows.length} rows, ${((Date.now() - t0) / 1000).toFixed(0)} s, speed ${JSON.stringify(r.speed)}`);
}
if (opt('json')) writeFileSync(opt('json'), JSON.stringify(all, null, 1));
