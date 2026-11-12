#!/usr/bin/env node
// Scores replay outputs of the three-temporal moving-camera captures (CAPTURES.md here):
// tools/rt-capture/compare.mjs's metric definitions (CAPTURE-FORMAT "Metrics for replay outputs",
// via lib/capture.mjs scoreFrame) plus two things compare.mjs doesn't do:
//   - AO: the derived `ao` output (normalized hit distance ĥ) against the capture's extra `ao_ref`
//     buffer (compare.mjs only scores signals with a v0 `<signal>_ref`); the noisy baseline is the
//     1-ray ĥ = h / (h + 1 + 0.05·(−viewz)), miss = 1, the OcclusionDenoiser default curve;
//   - LDR-FLIP (examples/realtime-denoiser/src/flip.ts, the test bed's viewing condition: the image
//     spans 46.4°, ppd = W / 46.4) on every --flipEvery-th frame (default 4), mean over receivers.
//
//   node examples/three-temporal/score-captures.mjs <capture> [<capture> ...] [--denoisers a,b]
//        [--flipEvery 4] [--settle 8] [--json out.json]
//
// Per (capture, denoiser, signal): pooled PSNR (rank on this), settled pooled (≥ settle frames
// after the reset), penumbra pooled (visibility), flicker, bias, FLIP, non-finite count, and boil: the RMS of the
// output's second temporal difference x_t − 2 x_t−1 + x_t−2 along the reprojected history, / √6 (compare.mjs's
// definition, there for visibility only; here for every signal, on the metric's tonemapped values: x/(1+x) per
// channel for rgb, clamp for visibility / AO; history taps = the max-weight valid tap of the bilinear footprint,
// viewz within 2 %), counted only where the reference's own second difference is < 0.02 in every channel (so
// resampling at moving edges and real changes of the truth stay out). The noisy row carries refBoil, the same measure
// on the reference over the same pixels (its noise floor).
import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  OUTPUTS_DIR, frameDir, listDirs, readBuffer, readF32, readManifest, resolveCapture, scoreFrame, settledMask, isScored,
} from '../../tools/rt-capture/lib/capture.mjs';
import { prepareFlip, flipMean } from '../realtime-denoiser/src/flip.ts';

const args = process.argv.slice(2);
const VALUE_OPTS = new Set(['denoisers', 'flipEvery', 'settle', 'json']);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i < 0 ? d : args[i + 1]; };
const caps = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && VALUE_OPTS.has(args[i - 1].slice(2))));
const FLIP_EVERY = Number(opt('flipEvery', 4));
const SETTLE = Number(opt('settle', 8));
const AO_A = 1, AO_B = 0.05;
const SIG_CH = { diffuse: 3, specular: 3, visibility: 1, ao: 1 };
const REF = { diffuse: 'diffuse_ref', specular: 'specular_ref', visibility: 'visibility_ref', ao: 'ao_ref' };

const pooledDb = (e, k) => (k ? 10 * Math.log10(1 / Math.max(e / k, 1e-12)) : NaN);
const mean = (xs) => { const v = xs.filter(Number.isFinite); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN; };

const tmap = (x, ch) => (ch === 1 ? Math.min(Math.max(x, 0), 1) : (x > 0 ? x / (1 + x) : 0));
/** previous-frame pixel of each pixel's history (-1 = none): compare.mjs's max-weight valid bilinear tap */
function historyTaps(dir, m, f) {
  const W = m.width, H = m.height, N = W * H;
  const tap = new Int32Array(N).fill(-1);
  const depth = readBuffer(dir, f, 'depth'), pdepth = readBuffer(dir, f - 1, 'depth');
  const mo = readBuffer(dir, f, 'motion'), vz = readBuffer(dir, f, 'viewz'), pvz = readBuffer(dir, f - 1, 'viewz');
  const mz = m.buffers.some((b) => b.name === 'motion_z') ? readBuffer(dir, f, 'motion_z') : null;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (!isScored(depth[i])) continue;
    const px = x + 0.5 - 0.5 * mo[2 * i] * W - 0.5, py = y + 0.5 + 0.5 * mo[2 * i + 1] * H - 0.5;
    const bx = Math.floor(px), by = Math.floor(py), fx = px - bx, fy = py - by;
    const zExp = vz[i] + (mz ? mz[i] : 0), tol = 0.02 * Math.abs(vz[i]);
    let bestW = -1, best = -1;
    for (let k = 0; k < 4; k++) {
      const qx = bx + (k & 1), qy = by + (k >> 1);
      const w = ((k & 1) ? fx : 1 - fx) * ((k >> 1) ? fy : 1 - fy);
      if (w <= 1e-3 || qx < 0 || qy < 0 || qx >= W || qy >= H) continue;
      const q = qy * W + qx;
      if (!isScored(pdepth[q]) || Math.abs(pvz[q] - zExp) > tol) continue;
      if (w > bestW) { bestW = w; best = q; }
    }
    tap[i] = best;
  }
  return tap;
}
/**
 * boil accumulator: feed(f, values) per frame in order; result() = sqrt(mean b^2 / 6). With `maskOut` (the
 * reference's accumulator) it records which pixels have a smooth reference history (|b_ref| < BOIL_SMOOTH in every
 * channel); with `maskIn` (the outputs') only those pixels count, so resampling at moving edges and real changes of
 * the truth stay out and what is left is the output's own temporal noise.
 */
const BOIL_SMOOTH = 0.02;
function boilAcc(ch, taps, depthOf, resets, maskOut = null, maskIn = null) {
  let h1 = null, h2 = null, sum = 0, cnt = 0;
  return {
    feed(f, out) {
      if (maskOut) { maskOut.f = f; maskOut.m = null; }
      const N = out.length / ch;
      const v = new Float32Array(N * ch);
      for (let i = 0; i < N * ch; i++) v[i] = Number.isFinite(out[i]) ? tmap(out[i], ch) : 0;
      if (resets[f]) { h1 = v; h2 = null; return; }
      const t = taps[f], t1 = taps[f - 1];
      if (h1 && h2 && t && t1) {
        const depth = depthOf(f);
        const mask = maskOut ? (maskOut.m = new Uint8Array(N)) : null;
        const use = maskIn && maskIn.f === f ? maskIn.m : null;
        if (maskIn && !use) { h2 = h1; h1 = v; return; }
        for (let i = 0; i < N; i++) {
          if (!isScored(depth[i])) continue;
          if (use && !use[i]) continue;
          const a = t[i]; if (a < 0) continue;
          const b = t1[a]; if (b < 0) continue;
          let smooth = 1, s2 = 0;
          for (let c = 0; c < ch; c++) { const d = v[i * ch + c] - 2 * h1[a * ch + c] + h2[b * ch + c]; s2 += d * d; if (Math.abs(d) >= BOIL_SMOOTH) smooth = 0; }
          if (mask) { mask[i] = smooth; if (!smooth) continue; }
          sum += s2; cnt += ch;
        }
      }
      h2 = h1; h1 = v;
    },
    skip() { h1 = null; h2 = null; },
    result: () => (cnt ? Math.sqrt(sum / cnt / 6) : NaN),
  };
}

function scoreCapture(capName) {
  const dir = resolveCapture(capName);
  const m = readManifest(dir);
  const W = m.width, H = m.height, N = W * H;
  const ppd = W / 46.4;
  const has = new Set(m.buffers.map((b) => b.name));
  const signals = Object.keys(SIG_CH).filter((s) => has.has(REF[s]) && (s === 'ao' ? has.has('diffuse_hitt') : has.has(s)));
  const settled = settledMask(m.frames, SETTLE);
  const outRoot = path.join(OUTPUTS_DIR, path.basename(dir));
  const wanted = opt('denoisers') ? opt('denoisers').split(',') : listDirs(outRoot);
  const noisyOf = (f, s) => {
    if (s !== 'ao') return readBuffer(dir, f, s);
    const h = readBuffer(dir, f, 'diffuse_hitt'), vz = readBuffer(dir, f, 'viewz');
    const o = new Float32Array(N);
    for (let i = 0; i < N; i++) o[i] = h[i] > 0 ? h[i] / (h[i] + AO_A + AO_B * Math.max(0, -vz[i])) : 1;
    return o;
  };
  // FLIP inputs: tonemapped rgb (x / (1 + x)) or gray (clamped), as the test bed
  const flipRgb = (d, ch) => {
    const g = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) for (let c = 0; c < 3; c++) {
      const v = d[i * ch + (ch === 3 ? c : 0)];
      g[3 * i + c] = ch === 3 ? (v > 0 ? v / (1 + v) : 0) : Math.min(1, Math.max(0, v));
    }
    return g;
  };
  const resets = m.frames.map((fr, f) => f === 0 || !!fr.reset);
  const taps = m.frames.map((_, f) => (resets[f] ? null : historyTaps(dir, m, f)));
  const depthCache = new Map();
  const depthOf = (f) => { if (!depthCache.has(f)) { depthCache.set(f, readBuffer(dir, f, 'depth')); if (depthCache.size > 3) depthCache.delete(depthCache.keys().next().value); } return depthCache.get(f); };
  const rows = [];
  for (const s of signals) {
    const ch = SIG_CH[s];
    const sources = [{ id: 'noisy', get: (f) => noisyOf(f, s) }];
    for (const d of wanted) {
      const p0 = path.join(outRoot, d, frameDir(0), `${s}.f32`);
      if (existsSync(p0)) sources.push({ id: d, get: (f) => { const p = path.join(outRoot, d, frameDir(f), `${s}.f32`); return existsSync(p) ? readF32(p) : null; } });
    }
    const smoothMask = { f: -1, m: null };
    const refBoil = boilAcc(ch, taps, depthOf, resets, smoothMask);
    const acc = sources.map(() => ({ e: 0, k: 0, eS: 0, kS: 0, eP: 0, kP: 0, flick: [], bias: [], flip: [], perFrame: [], nonFinite: 0, prevS: null, frames: 0, boil: boilAcc(ch, taps, depthOf, resets, null, smoothMask) }));
    for (let f = 0; f < m.frames.length; f++) {
      const ref = readBuffer(dir, f, REF[s]);
      const depth = readBuffer(dir, f, 'depth');
      refBoil.feed(f, ref);
      const doFlip = FLIP_EVERY > 0 && f % FLIP_EVERY === FLIP_EVERY - 1;
      let refFlip = null, mask = null;
      if (doFlip) {
        refFlip = prepareFlip(flipRgb(ref, ch), W, H, ppd);
        mask = new Uint8Array(N); for (let i = 0; i < N; i++) mask[i] = isScored(depth[i]) ? 1 : 0;
      }
      sources.forEach((src, j) => {
        const a = acc[j];
        const out = src.get(f);
        if (!out) { a.prevS = null; a.boil.skip(); return; }
        a.boil.feed(f, out);
        const r = scoreFrame(out, ref, depth, ch, m.frames[f].reset ? null : a.prevS);
        a.prevS = r.s;
        a.e += r.sse; a.k += r.sseCount;
        if (settled[f]) { a.eS += r.sse; a.kS += r.sseCount; }
        a.eP += r.ssePenumbra; a.kP += r.ssePenumbraCount;
        a.flick.push(r.flicker); a.bias.push(r.bias); a.perFrame.push(+r.psnr.toFixed(3)); a.nonFinite += r.nonFinite; a.frames++;
        if (doFlip) a.flip.push(flipMean(refFlip, prepareFlip(flipRgb(out, ch), W, H, ppd), mask));
      });
    }
    sources.forEach((src, j) => {
      const a = acc[j];
      rows.push({
        capture: path.basename(dir), signal: s, denoiser: src.id, frames: a.frames,
        psnrPooled: pooledDb(a.e, a.k), psnrSettledPooled: pooledDb(a.eS, a.kS),
        psnrPenumbraPooled: s === 'visibility' ? pooledDb(a.eP, a.kP) : NaN,
        flicker: mean(a.flick), bias: s === 'ao' ? NaN : mean(a.bias), flip: mean(a.flip), flipFrames: a.flip.length,
        boil: a.boil.result(), ...(src.id === 'noisy' ? { refBoil: refBoil.result() } : {}),
        nonFinite: a.nonFinite, perFramePsnr: a.perFrame,
      });
    });
  }
  return { capture: path.basename(dir), width: W, height: H, frames: m.frames.length, settle: SETTLE, flipEvery: FLIP_EVERY, ppd: +ppd.toFixed(2), rows };
}

const f2 = (x, k = 2) => (Number.isFinite(x) ? x.toFixed(k) : '–');
const all = [];
for (const c of caps) {
  const r = scoreCapture(c);
  all.push(r);
  console.log(`\n## ${r.capture} (${r.width}x${r.height}, ${r.frames} frames; settled = frames ≥ ${r.settle}; FLIP every ${r.flipEvery}th frame, ${r.ppd} ppd)\n`);
  console.log('| signal | denoiser | pooled PSNR | settled pooled | penumbra pooled | FLIP | flicker | boil | bias | non-finite |');
  console.log('|---|---|---|---|---|---|---|---|---|---|');
  for (const x of r.rows) {
    console.log(`| ${x.signal} | ${x.denoiser} | ${f2(x.psnrPooled)} | ${f2(x.psnrSettledPooled)} | ${f2(x.psnrPenumbraPooled)} | ${f2(x.flip, 4)} | ${f2(x.flicker, 4)} | ${f2(x.boil, 4)} | ${f2(x.bias, 4)} | ${x.nonFinite} |`);
    if (x.refBoil !== undefined) console.log(`| ${x.signal} | reference (its own boil) | | | | | | ${f2(x.refBoil, 4)} | | |`);
  }
}
if (opt('json')) writeFileSync(opt('json'), JSON.stringify(all, null, 1));
