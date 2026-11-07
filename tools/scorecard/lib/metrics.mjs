// Scorecard metrics (TRACKS.md "The five numbers"): calm, detail, lag, bias; cost is lib/cost.mjs.
//
// One pass over a capture's frames scores every source (the noisy input, replay outputs of ours / FFX /
// baselines) of one signal against the capture's `<signal>_ref` buffer. Pure Node, no GPU.
// Lineage (reused definitions, not new maths where one existed):
//   - tonemap: Reinhard x/(1+x) per channel for rgb, clamp [0,1] for visibility / AO
//     (tools/rt-capture/lib/capture.mjs, CAPTURE-FORMAT "Metrics for replay outputs"); PSNR via scoreFrame().
//   - history taps / smooth-mask boil: examples/three-temporal/score-captures.mjs (the "legacy" boil here, kept so
//     the imported native rows, scored with that script, compare 1:1).
//   - dynamic-region test (reference changed by > 0.05 within 4 frames along the history): tools/rt-capture/compare.mjs.
//   - FLIP: examples/realtime-denoiser/src/flip.ts (test-bed viewing condition: image spans 46.4 deg).
// New here (STOCKTAKE §5.2 / TRACKS.md): boil per region (static / moving / disoccluded) relative to the clean
// reference's own boil in the same pixels, still-camera sigma, lag after events, bias in 8-bit display levels.
import path from 'node:path';
import {
  frameDir, isScored, readBuffer, readF32, scoreFrame,
} from '../../rt-capture/lib/capture.mjs';
import { prepareFlip, flipMean } from '../../../examples/realtime-denoiser/src/flip.ts';

export const SIG_CH = { diffuse: 3, specular: 3, visibility: 1, ao: 1 };
export const REF_BUFFER = { diffuse: 'diffuse_ref', specular: 'specular_ref', visibility: 'visibility_ref', ao: 'ao_ref' };
const AO_A = 1, AO_B = 0.05;          // OcclusionDenoiser default hit-distance curve (score-captures.mjs)
const K_DYN = 4, DYN_DELTA = 0.05;    // compare.mjs
const LEGACY_SMOOTH = 0.02;           // score-captures.mjs BOIL_SMOOTH
export const DEFAULTS = {
  settle: 8,          // frames after a reset before boil / sigma / bias count
  youngMax: 6,        // history age (frames) up to which a pixel counts as disoccluded
  flipEvery: 4,       // FLIP on frames f % flipEvery == flipEvery - 1 (as score-captures)
  lagTolerance: 0.10, // TRACKS.md: within 10 % of the settled level
  sigmaStaticMax: 0.01, // pixels whose reference sigma is below this are "static content" for the still-camera sigma
  tonemap: 'reinhard',
};

const tm = (x, ch, mode = 'reinhard') => {
  if (ch === 1) return x < 0 ? 0 : x > 1 ? 1 : x;
  if (!(x > 0)) return 0;
  if (mode === 'aces') { // Narkowicz fit; maps HDR to [0,1]
    const y = (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14);
    return y < 0 ? 0 : y > 1 ? 1 : y;
  }
  return x / (1 + x);
};
// sRGB OETF lookup: tonemapped value in [0,1] -> display level 0..255
const OETF = new Float32Array(4097);
for (let i = 0; i <= 4096; i++) { const c = i / 4096; OETF[i] = 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055); }
const level = (t) => OETF[Math.round(Math.min(Math.max(t, 0), 1) * 4096)];

const pooledDb = (e, k) => (k ? 10 * Math.log10(1 / Math.max(e / k, 1e-12)) : NaN);
const meanOf = (xs) => { const v = xs.filter(Number.isFinite); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN; };

/** Scene-level facts: resets, events, static camera. */
export function captureInfo(m) {
  const frames = m.frames;
  const resets = frames.map((fr, f) => f === 0 || !!fr.reset);
  const lightSig = (fr) => JSON.stringify((fr.lights ?? []).map((l) => [l.id, l.intensity, l.color]));
  const events = [];
  frames.forEach((fr, f) => {
    if (f === 0) events.push({ frame: 0, kind: 'start' });
    else if (resets[f]) events.push({ frame: f, kind: 'cut' });
    else if (frames[f - 1].lights && lightSig(fr) !== lightSig(frames[f - 1])) events.push({ frame: f, kind: 'light' });
  });
  const v0 = JSON.stringify([frames[0].camera.view, frames[0].camera.projection]);
  const staticCamera = frames.every((fr) => JSON.stringify([fr.camera.view, fr.camera.projection]) === v0);
  return { resets, events, staticCamera };
}

/** previous-frame pixel of each pixel's history: max-weight valid bilinear tap (tapW, boil), and the tap whose
 * reference value is closest to this pixel's (tapN, dynamic-region test; sub-pixel motion across an edge is no change). */
function historyTaps(m, mo, vz, pvz, mz, depth, pdepth, refL, prefL) {
  const W = m.width, H = m.height, N = W * H;
  const tapW = new Int32Array(N).fill(-1), tapN = new Int32Array(N).fill(-1);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (!isScored(depth[i])) continue;
    const px = x + 0.5 - 0.5 * mo[2 * i] * W - 0.5, py = y + 0.5 + 0.5 * mo[2 * i + 1] * H - 0.5;
    const bx = Math.floor(px), by = Math.floor(py), fx = px - bx, fy = py - by;
    const zExp = vz[i] + (mz ? mz[i] : 0), tol = 0.02 * Math.abs(vz[i]);
    let bestW = -1, best = -1, dmin = Infinity, near = -1;
    for (let k = 0; k < 4; k++) {
      const qx = bx + (k & 1), qy = by + (k >> 1);
      const w = ((k & 1) ? fx : 1 - fx) * ((k >> 1) ? fy : 1 - fy);
      if (w <= 1e-3 || qx < 0 || qy < 0 || qx >= W || qy >= H) continue;
      const q = qy * W + qx;
      if (!isScored(pdepth[q]) || Math.abs(pvz[q] - zExp) > tol) continue;
      if (w > bestW) { bestW = w; best = q; }
      const d = Math.abs(refL[i] - prefL[q]);
      if (d < dmin) { dmin = d; near = q; }
    }
    tapW[i] = best; tapN[i] = near;
  }
  return { tapW, tapN };
}

const REGIONS = ['static', 'moving', 'disocc'];
const newAcc = () => ({ s: 0, e: 0, n: 0, px: 0 });

/**
 * Score every source of one signal.
 * sources: [{ id, get(f) -> Float32Array | null }]; `noisy` should be sources[0] (its numbers are the floor).
 * Returns { signal, refStats, rows: { [id]: {...} }, flipFrames }.
 */
export function scoreSignal({ capDir, m, info, signal, sources, opts = {}, log = () => {} }) {
  const o = { ...DEFAULTS, ...opts };
  const W = m.width, H = m.height, N = W * H, ch = SIG_CH[signal];
  const ppd = W / 46.4;
  const refName = REF_BUFFER[signal];
  const hasMz = m.buffers.some((b) => b.name === 'motion_z');
  const tmode = o.tonemap;
  const lumaOf = (t, i) => (ch === 3 ? 0.2126 * t[3 * i] + 0.7152 * t[3 * i + 1] + 0.0722 * t[3 * i + 2] : t[i]);

  const mkSrc = (s) => ({
    id: s.id, get: s.get,
    h1: null, h2: null,                       // tonemapped history (t-1, t-2)
    eh1: null, eh2: null,                     // tonemapped error history, same indexing
    boil: Object.fromEntries(REGIONS.map((r) => [r, newAcc()])),
    legacy: { s: 0, n: 0 },
    sse: 0, cnt: 0, sseS: 0, cntS: 0,
    rmse: [],                                  // per-frame RMSE on tonemapped values (lag series)
    biasSum: 0, biasN: 0, biasRaw: 0,
    flip: [], nonFinite: 0, frames: 0,
    mean: null, m2: null, nSig: 0,
  });
  const S = sources.map(mkSrc);
  const R = { boil: Object.fromEntries(REGIONS.map((r) => [r, newAcc()])), legacy: { s: 0, n: 0 }, h1: null, h2: null, mean: null, m2: null, nSig: 0 };
  // opts.window = { x, y, w, h }: only these pixels count (taps and history still use the whole frame)
  let winMask = null;
  if (o.window) { winMask = new Uint8Array(N); for (let y = o.window.y; y < o.window.y + o.window.h; y++) for (let x = o.window.x; x < o.window.x + o.window.w; x++) winMask[y * W + x] = 1; }
  const doSigma = info.staticCamera;
  if (doSigma) for (const x of [...S, R]) { x.mean = new Float64Array(N); x.m2 = new Float64Array(N); }

  let prev = null; // previous frame's {tapW, age, lag, refL, depth, vz}
  let lastReset = 0;
  let lastDepth = null;
  const regionPx = { static: 0, moving: 0, disocc: 0 };
  let regionFrames = 0;

  for (let f = 0; f < m.frames.length; f++) {
    const ref = readBuffer(capDir, f, refName);
    const depth = readBuffer(capDir, f, 'depth');
    lastDepth = depth;
    let depthW = depth;
    if (winMask) { depthW = new Float32Array(N); for (let i = 0; i < N; i++) depthW[i] = winMask[i] ? depth[i] : 0; }
    const reset = info.resets[f];
    const inRange = !o.countFrames || (f >= o.countFrames[0] && f <= o.countFrames[1]);
    if (reset) lastReset = f;
    const sinceReset = f - lastReset;
    const refT = new Float32Array(N * ch);
    for (let i = 0; i < N * ch; i++) refT[i] = tm(ref[i], ch, tmode);
    const refL = new Float32Array(N);
    for (let i = 0; i < N; i++) refL[i] = lumaOf(refT, i);

    // ---- history, age, dynamic flag, regions
    let tapW = null, tapPrevForT2 = null;
    const age = new Uint8Array(N), lag = new Float32Array(N * K_DYN).fill(NaN);
    const region = new Uint8Array(N); // 0 = not scored for boil, 1 static, 2 moving, 3 disoccluded
    for (let i = 0; i < N; i++) lag[i * K_DYN] = refL[i];
    if (!reset && prev) {
      const mo = readBuffer(capDir, f, 'motion');
      const vz = readBuffer(capDir, f, 'viewz');
      const mz = hasMz ? readBuffer(capDir, f, 'motion_z') : null;
      const t = historyTaps(m, mo, vz, prev.vz, mz, depth, prev.depth, refL, prev.refL);
      tapW = t.tapW;
      for (let i = 0; i < N; i++) {
        const a = tapW[i];
        if (a >= 0) age[i] = Math.min(255, prev.age[a] + 1);
        const nr = t.tapN[i];
        let dyn = false;
        if (nr >= 0) {
          let lo = refL[i], hi = refL[i];
          for (let k = 1; k < K_DYN; k++) lag[i * K_DYN + k] = prev.lag[nr * K_DYN + k - 1];
          for (let k = 0; k < K_DYN; k++) { const v = prev.lag[nr * K_DYN + k]; if (v === v) { if (v < lo) lo = v; if (v > hi) hi = v; } }
          dyn = hi - lo > DYN_DELTA;
        }
        if (!isScored(depth[i]) || (winMask && !winMask[i]) || age[i] < 2 || sinceReset < o.settle || !inRange) continue;
        region[i] = age[i] <= o.youngMax ? 3 : dyn ? 2 : 1;
      }
      tapPrevForT2 = prev.tapW;
    }
    if (sinceReset >= o.settle && !reset && inRange) { regionFrames++; for (let i = 0; i < N; i++) if (region[i]) regionPx[REGIONS[region[i] - 1]]++; }

    // ---- reference's own stats (boil per region, legacy boil, sigma)
    const have3 = inRange && tapW && tapPrevForT2 && R.h1 && R.h2;
    if (have3) {
      for (let i = 0; i < N; i++) {
        if (!isScored(depth[i]) || (winMask && !winMask[i])) continue;
        const a = tapW[i]; if (a < 0) continue;
        const b = tapPrevForT2[a]; if (b < 0) continue;
        let smooth = true, s2 = 0;
        for (let c = 0; c < ch; c++) {
          const d = refT[i * ch + c] - 2 * R.h1[a * ch + c] + R.h2[b * ch + c];
          s2 += d * d; if (Math.abs(d) >= LEGACY_SMOOTH) smooth = false;
        }
        if (smooth) { R.legacy.s += s2; R.legacy.n += ch; }
        const r = region[i];
        if (r) { const acc = R.boil[REGIONS[r - 1]]; acc.s += s2; acc.n += ch; }
      }
    }
    if (doSigma && sinceReset >= o.settle && inRange) {
      R.nSig++;
      for (let i = 0; i < N; i++) { const x = refL[i], dlt = x - R.mean[i]; R.mean[i] += dlt / R.nSig; R.m2[i] += dlt * (x - R.mean[i]); }
    }

    // ---- sources
    const doFlip = o.flipFrames ? o.flipFrames.includes(f) : (o.flipEvery > 0 && f % o.flipEvery === o.flipEvery - 1);
    let refFlip = null, flipMask = null;
    if (doFlip) {
      refFlip = prepareFlip(flipRgb(refT, ch, N), W, H, ppd);
      flipMask = new Uint8Array(N); for (let i = 0; i < N; i++) flipMask[i] = isScored(depth[i]) && (!winMask || winMask[i]) ? 1 : 0;
    }
    for (const src of S) {
      const out = src.get(f);
      if (!out) { src.h1 = src.h2 = src.eh1 = src.eh2 = null; src.rmse.push(NaN); continue; }
      src.frames++;
      const outT = new Float32Array(N * ch);
      for (let i = 0; i < N * ch; i++) outT[i] = Number.isFinite(out[i]) ? tm(out[i], ch, tmode) : 0;
      const r = scoreFrame(out, ref, depthW, ch, null);
      src.sse += r.sse; src.cnt += r.sseCount; src.nonFinite += r.nonFinite;
      if (sinceReset >= o.settle) { src.sseS += r.sse; src.cntS += r.sseCount; }
      src.rmse.push(r.sseCount ? Math.sqrt(r.sse / r.sseCount) : NaN);
      // bias in display levels (settled frames only)
      if (sinceReset >= o.settle && inRange) {
        let bs = 0, bn = 0, braw = 0;
        for (let i = 0; i < N; i++) {
          if (!isScored(depth[i]) || (winMask && !winMask[i])) continue;
          let lo = 0, lr = 0;
          if (ch === 3) {
            lo = 0.2126 * level(outT[3 * i]) + 0.7152 * level(outT[3 * i + 1]) + 0.0722 * level(outT[3 * i + 2]);
            lr = 0.2126 * level(refT[3 * i]) + 0.7152 * level(refT[3 * i + 1]) + 0.0722 * level(refT[3 * i + 2]);
          } else { lo = level(outT[i]); lr = level(refT[i]); }
          bs += lo - lr; bn++; braw += outT[i * ch] - refT[i * ch];
        }
        src.biasSum += bs; src.biasN += bn; src.biasRaw += braw;
      }
      // boil (new regions + legacy), error boil
      if (inRange && tapW && tapPrevForT2 && src.h1 && src.h2 && R.h1 && R.h2) {
        for (let i = 0; i < N; i++) {
          if (!isScored(depth[i]) || (winMask && !winMask[i])) continue;
          const a = tapW[i]; if (a < 0) continue;
          const b = tapPrevForT2[a]; if (b < 0) continue;
          let s2 = 0, smooth = true, e2 = 0;
          for (let c = 0; c < ch; c++) {
            const d = outT[i * ch + c] - 2 * src.h1[a * ch + c] + src.h2[b * ch + c];
            const dr = refT[i * ch + c] - 2 * R.h1[a * ch + c] + R.h2[b * ch + c];
            s2 += d * d; e2 += (d - dr) * (d - dr);
            if (Math.abs(dr) >= LEGACY_SMOOTH) smooth = false;
          }
          if (smooth) { src.legacy.s += s2; src.legacy.n += ch; }
          const rg = region[i];
          if (rg) { const acc = src.boil[REGIONS[rg - 1]]; acc.s += s2; acc.e += e2; acc.n += ch; }
        }
      }
      if (doSigma && sinceReset >= o.settle && inRange) {
        src.nSig++;
        for (let i = 0; i < N; i++) { const x = lumaOf(outT, i), dlt = x - src.mean[i]; src.mean[i] += dlt / src.nSig; src.m2[i] += dlt * (x - src.mean[i]); }
      }
      if (doFlip) src.flip.push(flipMean(refFlip, prepareFlip(flipRgb(outT, ch, N), W, H, ppd), flipMask));
      if (reset) { src.h1 = outT; src.h2 = null; } else { src.h2 = src.h1; src.h1 = outT; }
    }
    // shift the reference's history after the sources used it
    if (reset) { R.h1 = refT; R.h2 = null; } else { R.h2 = R.h1; R.h1 = refT; }
    prev = { tapW: tapW ?? new Int32Array(N).fill(-1), age, lag, refL, depth, vz: readBuffer(capDir, f, 'viewz') };
    if (f % 8 === 0) log(`  ${signal} frame ${f}/${m.frames.length}`);
  }

  // ---- sigma finalize
  const sigmaOf = (x) => {
    if (!doSigma || x.nSig < 4) return null;
    const out = new Float32Array(N);
    for (let i = 0; i < N; i++) out[i] = Math.sqrt(x.m2[i] / (x.nSig - 1));
    return out;
  };
  const refSig = sigmaOf(R);
  let sigmaMask = null;
  if (refSig) { sigmaMask = new Uint8Array(N); for (let i = 0; i < N; i++) sigmaMask[i] = isScored(lastDepth[i]) && (!winMask || winMask[i]) && refSig[i] < o.sigmaStaticMax ? 1 : 0; }
  const meanMasked = (arr, mask) => { let s = 0, n = 0; for (let i = 0; i < N; i++) if (mask[i]) { s += arr[i]; n++; } return n ? s / n : NaN; };

  // ---- lag
  const lagOf = (series) => info.events.map((ev, k) => {
    const end = k + 1 < info.events.length ? info.events[k + 1].frame : m.frames.length;
    const win = series.slice(ev.frame, end);
    if (win.length < 12 || win.some((x) => !Number.isFinite(x))) return { ...ev, lag: null, settled: null, note: 'window too short' };
    const q = Math.max(3, Math.floor(win.length / 4));
    const settled = meanOf(win.slice(-q));
    const lim = settled * (1 + o.lagTolerance);
    let t = win.length;
    while (t > 0 && win[t - 1] <= lim) t--;
    return { ...ev, lag: t >= win.length ? null : t, settled, start: win[0], note: t >= win.length ? 'never within tolerance' : undefined };
  });

  const regionRes = (acc, refAcc) => {
    const v = acc.n ? Math.sqrt(acc.s / acc.n / 6) : NaN;
    const rv = refAcc.n ? Math.sqrt(refAcc.s / refAcc.n / 6) : NaN;
    return { boil: v, refBoil: rv, ratio: rv > 1e-4 ? v / rv : null, errBoil: acc.n ? Math.sqrt(acc.e / acc.n / 6) : NaN, n: acc.n };
  };
  const sumAcc = (g) => REGIONS.reduce((t, r) => ({ s: t.s + g[r].s, e: t.e + g[r].e, n: t.n + g[r].n }), { s: 0, e: 0, n: 0 });
  const rows = {};
  for (const s of S) {
    const sig = sigmaOf(s);
    rows[s.id] = {
      frames: s.frames,
      detail: {
        flip: meanOf(s.flip), flipFrames: s.flip.length,
        psnrPooled: pooledDb(s.sse, s.cnt), psnrSettledPooled: pooledDb(s.sseS, s.cntS),
      },
      calm: {
        static: regionRes(s.boil.static, R.boil.static),
        moving: regionRes(s.boil.moving, R.boil.moving),
        disocc: regionRes(s.boil.disocc, R.boil.disocc),
        all: regionRes(sumAcc(s.boil), sumAcc(R.boil)),
        legacyBoil: s.legacy.n ? Math.sqrt(s.legacy.s / s.legacy.n / 6) : NaN,
        sigma: sig && sigmaMask ? { sigma: meanMasked(sig, sigmaMask), refSigma: meanMasked(refSig, sigmaMask), pixels: sigmaMask.reduce((a, b) => a + b, 0) } : null,
      },
      lag: lagOf(s.rmse),
      bias: { levels: s.biasN ? s.biasSum / s.biasN : NaN, rawTonemapped: s.biasN ? s.biasRaw / s.biasN : NaN },
      nonFinite: s.nonFinite,
      rmseSeries: s.rmse.map((x) => (Number.isFinite(x) ? +x.toFixed(5) : null)),
    };
  }
  return {
    signal,
    reference: {
      legacyBoil: R.legacy.n ? Math.sqrt(R.legacy.s / R.legacy.n / 6) : NaN,
      regions: Object.fromEntries(REGIONS.map((r) => [r, { boil: R.boil[r].n ? Math.sqrt(R.boil[r].s / R.boil[r].n / 6) : NaN, n: R.boil[r].n }])),
      regionPixelsPerFrame: Object.fromEntries(REGIONS.map((r) => [r, regionFrames ? Math.round(regionPx[r] / regionFrames) : 0])),
      sigma: sigmaMask ? meanMasked(refSig, sigmaMask) : null,
    },
    rows,
  };
}

/** tonemapped rgb (or gray for scalars) for FLIP */
function flipRgb(t, ch, N) {
  if (ch === 3) return t;
  const g = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) { g[3 * i] = g[3 * i + 1] = g[3 * i + 2] = t[i]; }
  return g;
}

/** A source reading replay outputs: outputs/<capture>/<row>/frame_XXXX/<signal>.f32 */
export function outputSource(outRoot, row, signal) {
  return { id: row, get: (f) => { const p = path.join(outRoot, row, frameDir(f), `${signal}.f32`); try { return readF32(p); } catch { return null; } } };
}

/** The noisy input as a source (AO: normalized hit distance of the 1-ray sample, as score-captures.mjs). */
export function noisySource(capDir, m, signal) {
  const N = m.width * m.height;
  return {
    id: 'raw',
    get: (f) => {
      if (signal !== 'ao') return readBuffer(capDir, f, signal);
      const h = readBuffer(capDir, f, 'diffuse_hitt'), vz = readBuffer(capDir, f, 'viewz');
      const o = new Float32Array(N);
      for (let i = 0; i < N; i++) o[i] = h[i] > 0 ? h[i] / (h[i] + AO_A + AO_B * Math.max(0, -vz[i])) : 1;
      return o;
    },
  };
}

/** Does the capture carry this signal (and its reference)? */
export function hasSignal(m, signal) {
  const names = new Set(m.buffers.map((b) => b.name));
  if (!names.has(REF_BUFFER[signal])) return false;
  return signal === 'ao' ? names.has('diffuse_hitt') : names.has(signal);
}
