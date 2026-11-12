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
  strides: [8],       // extra boil / sigma strides k (k = 1 is always computed): x_t - 2 x_(t-k) + x_(t-2k) along the chained reprojection
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
  const fpI = new Int32Array(N * 4).fill(-1), fpW = new Float32Array(N * 4);
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
      fpI[i * 4 + k] = q; fpW[i * 4 + k] = w;
      if (w > bestW) { bestW = w; best = q; }
      const d = Math.abs(refL[i] - prefL[q]);
      if (d < dmin) { dmin = d; near = q; }
    }
    tapW[i] = best; tapN[i] = near;
  }
  return { tapW, tapN, fpI, fpW };
}

const REGIONS = ['static', 'moving', 'disocc', 'dense'];
/** dense geometry: creases (normal angle > 10 deg to a neighbour within 2 px) and silhouettes (view-z jump > 2 %), dilated by 1 px */
function edgeMask(normal, vz, depth, W, H) {
  const e = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (!isScored(depth[i])) continue;
    for (const [dx, dy] of [[1, 0], [0, 1], [2, 0], [0, 2]]) {
      const qx = x + dx, qy = y + dy; if (qx >= W || qy >= H) continue;
      const q = qy * W + qx; if (!isScored(depth[q])) { e[i] = 1; continue; }
      const dot = normal[3 * i] * normal[3 * q] + normal[3 * i + 1] * normal[3 * q + 1] + normal[3 * i + 2] * normal[3 * q + 2];
      if (dot < 0.985 || Math.abs(vz[i] - vz[q]) > 0.02 * Math.abs(vz[i])) { e[i] = 1; e[q] = 1; }
    }
  }
  const o = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (e[y * W + x]) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const qx = x + dx, qy = y + dy; if (qx >= 0 && qy >= 0 && qx < W && qy < H) o[qy * W + qx] = 1; }
  return o;
}
const HB = 512, HSTEP = 0.001, POP = 0.03;   // per-pixel boil histogram (tail numbers); pop = per-pixel boil above the reference's by POP
const newAcc = () => ({ s: 0, e: 0, n: 0, px: 0, pop: 0, hist: new Uint32Array(HB) });
const addPx = (acc, s2, ch, e2, mRefPx, m) => { acc.s += s2; acc.e += e2; acc.n += ch; acc.px++; acc.hist[Math.min(HB - 1, Math.floor(m / HSTEP))]++; if (m > mRefPx + POP) acc.pop++; };
const pctl = (hist, px, q) => { if (!px) return NaN; let c = 0; const t = q * px; for (let b = 0; b < HB; b++) { c += hist[b]; if (c >= t) return (b + 1) * HSTEP; } return HB * HSTEP; };
/** bilinear sample of arr (ch values per pixel) at each pixel's reprojected footprint (valid taps only, weights renormalised); NaN where the footprint is < 50 % valid or a tap is NaN */
function warp(arr, ch, fpI, fpW, N) {
  const out = new Float32Array(N * ch).fill(NaN);
  for (let i = 0; i < N; i++) {
    let sw = 0;
    for (let k = 0; k < 4; k++) if (fpI[i * 4 + k] >= 0) sw += fpW[i * 4 + k];
    if (sw < 0.5) continue;
    for (let c = 0; c < ch; c++) {
      let v = 0;
      for (let k = 0; k < 4; k++) { const q = fpI[i * 4 + k]; if (q >= 0) v += fpW[i * 4 + k] * arr[q * ch + c]; }
      out[i * ch + c] = v / sw;   // NaN taps propagate
    }
  }
  return out;
}

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
  // strided calm: per-pixel chained reprojection over k and 2k frames (every hop must be valid), bilinear sample at the end
  const KS = o.strides ?? [], KMAX = Math.max(1, ...KS), SK = [...new Set([1, ...KS])];
  const FR = new Map(), refRing = new Map();
  const mkSA = () => Object.fromEntries(REGIONS.map((r) => [r, { s: 0, n: 0, px: 0, tot: 0 }]));
  for (const x of [...S, R]) { x.sk = {}; x.sq = {}; x.nsq = {}; x.ring = new Map(); for (const k of KS) x.sk[k] = mkSA(); if (doSigma) for (const k of SK) { x.sq[k] = new Float64Array(N); x.nsq[k] = 0; } }
  const bl = (arr, u, v, out) => {
    const x0 = Math.floor(u), y0 = Math.floor(v);
    if (x0 < 0 || y0 < 0 || x0 + 1 >= W || y0 + 1 >= H) return false;
    const fx = u - x0, fy = v - y0, i00 = y0 * W + x0;
    for (let c = 0; c < ch; c++) out[c] = (1 - fy) * ((1 - fx) * arr[i00 * ch + c] + fx * arr[(i00 + 1) * ch + c]) + fy * ((1 - fx) * arr[(i00 + W) * ch + c] + fx * arr[(i00 + W + 1) * ch + c]);
    return true;
  };
  const chainsFor = (f, k, region) => {
    const valid = new Uint8Array(N), U1 = new Float32Array(N), V1 = new Float32Array(N), U2 = new Float32Array(N), V2 = new Float32Array(N);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x; if (!region[i]) continue;
      let u = x, v = y, ok = true;
      for (let h = 1; h <= 2 * k && ok; h++) {
        const g = f - h + 1, fg = FR.get(g), fq = FR.get(g - 1);
        if (g < 1 || info.resets[g] || !fg || !fq) { ok = false; break; }
        const ui = Math.round(u), vi = Math.round(v);
        if (ui < 0 || vi < 0 || ui >= W || vi >= H) { ok = false; break; }
        const j = vi * W + ui;
        if (!isScored(fg.depth[j])) { ok = false; break; }
        const zExp = fg.vz[j] + (fg.mz ? fg.mz[j] : 0);
        u -= 0.5 * fg.mo[2 * j] * W; v += 0.5 * fg.mo[2 * j + 1] * H;
        const un = Math.round(u), vn = Math.round(v);
        if (un < 0 || vn < 0 || un >= W || vn >= H) { ok = false; break; }
        const q = vn * W + un;
        if (!isScored(fq.depth[q]) || Math.abs(fq.vz[q] - zExp) > 0.02 * Math.abs(fg.vz[j])) { ok = false; break; }
        if (h === k) { U1[i] = u; V1[i] = v; }
      }
      if (ok) { valid[i] = 1; U2[i] = u; V2[i] = v; }
    }
    return { valid, U1, V1, U2, V2 };
  };
  const strideFeed = (x, ring, cur, f, region, chains) => {
    const ta = new Float32Array(ch), tb = new Float32Array(ch);
    for (const k of KS) {
      const A = ring.get(f - k), B = ring.get(f - 2 * k), c = chains[k];
      if (!c || !A || !B) continue;
      for (let i = 0; i < N; i++) {
        const r = region[i]; if (!r) continue;
        const acc = x.sk[k][REGIONS[r - 1]]; acc.tot++;
        if (!c.valid[i] || !bl(A, c.U1[i], c.V1[i], ta) || !bl(B, c.U2[i], c.V2[i], tb)) continue;
        let s2 = 0; for (let cc = 0; cc < ch; cc++) { const d = cur[i * ch + cc] - 2 * ta[cc] + tb[cc]; s2 += d * d; }
        acc.s += s2; acc.n += ch; acc.px++;
      }
    }
  };
  const sigmaFeed = (x, ring, cur, f, sinceReset, lastReset, inRange) => {
    if (!doSigma || sinceReset < o.settle || !inRange) return;
    for (const k of SK) {
      const A = ring.get(f - k); if (!A || f - k < lastReset) continue;
      for (let i = 0; i < N; i++) { const d = lumaOf(cur, i) - lumaOf(A, i); x.sq[k][i] += d * d; }
      x.nsq[k]++;
    }
  };
  if (doSigma) for (const x of [...S, R]) { x.mean = new Float64Array(N); x.m2 = new Float64Array(N); }

  let prev = null; // previous frame's {tapW, age, lag, refL, depth, vz}
  let lastReset = 0;
  let lastDepth = null;
  const regionPx = { static: 0, moving: 0, disocc: 0, dense: 0 };
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
    let tapW = null, tapPrevForT2 = null, fp = null;
    const age = new Uint8Array(N), lag = new Float32Array(N * K_DYN).fill(NaN);
    const region = new Uint8Array(N); // 0 = not scored for boil, 1 static (smooth), 2 moving, 3 disoccluded, 4 dense geometry (static but creases / silhouettes)
    for (let i = 0; i < N; i++) lag[i * K_DYN] = refL[i];
    if (!reset && prev) {
      const mo = readBuffer(capDir, f, 'motion');
      const vz = readBuffer(capDir, f, 'viewz');
      const mz = hasMz ? readBuffer(capDir, f, 'motion_z') : null;
      const t = historyTaps(m, mo, vz, prev.vz, mz, depth, prev.depth, refL, prev.refL);
      tapW = t.tapW; fp = t;
      const edge = edgeMask(readBuffer(capDir, f, 'normal'), vz, depth, W, H);
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
        region[i] = age[i] <= o.youngMax ? 3 : dyn ? 2 : edge[i] ? 4 : 1;
      }
      tapPrevForT2 = prev.tapW;
    }
    if (sinceReset >= o.settle && !reset && inRange) { regionFrames++; for (let i = 0; i < N; i++) if (region[i]) regionPx[REGIONS[region[i] - 1]]++; }

    FR.set(f, { mo: readBuffer(capDir, f, 'motion'), vz: readBuffer(capDir, f, 'viewz'), mz: hasMz ? readBuffer(capDir, f, 'motion_z') : null, depth });
    FR.delete(f - 2 * KMAX - 2);
    const dropOld = (ring) => ring.delete(f - 2 * KMAX - 1);
    refRing.set(f, refT); dropOld(refRing);
    const chains = {};
    if (!reset && inRange) for (const k of KS) chains[k] = chainsFor(f, k, region);
    strideFeed(R, refRing, refT, f, region, chains);
    sigmaFeed(R, refRing, refT, f, sinceReset, lastReset, inRange);
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
      }
    }
    // bilinear history (two hops): a = x_(t-1), b = x_(t-2) sampled at this frame's reprojected footprint
    const Ra = fp && R.h1 ? warp(R.h1, ch, fp.fpI, fp.fpW, N) : null, Rb = Ra && R.w1 ? warp(R.w1, ch, fp.fpI, fp.fpW, N) : null;
    const mRef = new Float32Array(N);
    if (inRange && Ra && Rb) {
      for (let i = 0; i < N; i++) {
        const r = region[i]; if (!r) continue;
        let s2 = 0, bad = false;
        for (let c = 0; c < ch; c++) { const d = refT[i * ch + c] - 2 * Ra[i * ch + c] + Rb[i * ch + c]; if (d !== d) { bad = true; break; } s2 += d * d; }
        if (bad) { region[i] = 0; continue; }
        const m = Math.sqrt(s2 / ch / 6); mRef[i] = m;
        addPx(R.boil[REGIONS[r - 1]], s2, ch, 0, 0, m);
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
      // legacy smooth-mask boil (nearest tap, two hops: score-captures.mjs, for the imported native rows)
      if (inRange && tapW && tapPrevForT2 && src.h1 && src.h2 && R.h1 && R.h2) {
        for (let i = 0; i < N; i++) {
          if (!isScored(depth[i]) || (winMask && !winMask[i])) continue;
          const a = tapW[i]; if (a < 0) continue;
          const b = tapPrevForT2[a]; if (b < 0) continue;
          let s2 = 0, smooth = true;
          for (let c = 0; c < ch; c++) {
            const d = outT[i * ch + c] - 2 * src.h1[a * ch + c] + src.h2[b * ch + c];
            const dr = refT[i * ch + c] - 2 * R.h1[a * ch + c] + R.h2[b * ch + c];
            s2 += d * d;
            if (Math.abs(dr) >= LEGACY_SMOOTH) smooth = false;
          }
          if (smooth) { src.legacy.s += s2; src.legacy.n += ch; }
        }
      }
      // boil per region on the bilinear two-hop history, error boil, tail histogram
      const sa = fp && src.h1 ? warp(src.h1, ch, fp.fpI, fp.fpW, N) : null, sb = sa && src.w1 ? warp(src.w1, ch, fp.fpI, fp.fpW, N) : null;
      if (inRange && sa && sb && Ra && Rb) {
        for (let i = 0; i < N; i++) {
          const rg = region[i]; if (!rg) continue;
          let s2 = 0, e2 = 0, bad = false;
          for (let c = 0; c < ch; c++) {
            const d = outT[i * ch + c] - 2 * sa[i * ch + c] + sb[i * ch + c];
            const dr = refT[i * ch + c] - 2 * Ra[i * ch + c] + Rb[i * ch + c];
            if (d !== d || dr !== dr) { bad = true; break; }
            s2 += d * d; e2 += (d - dr) * (d - dr);
          }
          if (bad) continue;
          addPx(src.boil[REGIONS[rg - 1]], s2, ch, e2, mRef[i], Math.sqrt(s2 / ch / 6));
        }
      }
      src.ring.set(f, outT); dropOld(src.ring);
      strideFeed(src, src.ring, outT, f, region, chains);
      sigmaFeed(src, src.ring, outT, f, sinceReset, lastReset, inRange);
      src.w1 = reset ? null : sa;
      if (doSigma && sinceReset >= o.settle && inRange) {
        src.nSig++;
        for (let i = 0; i < N; i++) { const x = lumaOf(outT, i), dlt = x - src.mean[i]; src.mean[i] += dlt / src.nSig; src.m2[i] += dlt * (x - src.mean[i]); }
      }
      if (doFlip) src.flip.push(flipMean(refFlip, prepareFlip(flipRgb(outT, ch, N), W, H, ppd), flipMask));
      if (reset) { src.h1 = outT; src.h2 = null; } else { src.h2 = src.h1; src.h1 = outT; }
    }
    // shift the reference's history after the sources used it
    R.w1 = reset ? null : Ra;
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
    return { boil: v, refBoil: rv, ratio: rv > 1e-4 ? v / rv : null, errBoil: acc.n ? Math.sqrt(acc.e / acc.n / 6) : NaN, n: acc.n,
      p99: pctl(acc.hist, acc.px, 0.99), refP99: pctl(refAcc.hist, refAcc.px, 0.99), popFrac: acc.px ? acc.pop / acc.px : NaN };
  };
  const sumAcc = (g) => REGIONS.reduce((t, r) => { const h = new Uint32Array(HB); for (let b = 0; b < HB; b++) h[b] = t.hist[b] + g[r].hist[b]; return { s: t.s + g[r].s, e: t.e + g[r].e, n: t.n + g[r].n, px: t.px + g[r].px, pop: t.pop + g[r].pop, hist: h }; }, newAcc());
  const sigmaOfK = (x, k) => { if (!doSigma || !x.nsq[k] || x.nsq[k] < 4) return null; const o2 = new Float32Array(N); for (let i = 0; i < N; i++) o2[i] = Math.sqrt(x.sq[k][i] / (2 * x.nsq[k])); return o2; };
  const refSk = Object.fromEntries(SK.map((k) => [k, sigmaOfK(R, k)]));
  const stridedOf = (x) => Object.fromEntries(KS.map((k) => {
    const res = (a, ra) => ({ boil: a.n ? Math.sqrt(a.s / a.n / 6) : NaN, refBoil: ra.n ? Math.sqrt(ra.s / ra.n / 6) : NaN, n: a.px, validFrac: a.tot ? a.px / a.tot : NaN });
    const sum = (g) => REGIONS.reduce((t, r) => ({ s: t.s + g[r].s, n: t.n + g[r].n, px: t.px + g[r].px, tot: t.tot + g[r].tot }), { s: 0, n: 0, px: 0, tot: 0 });
    const o3 = Object.fromEntries(REGIONS.map((r) => [r, res(x.sk[k][r], R.sk[k][r])]));
    o3.all = res(sum(x.sk[k]), sum(R.sk[k]));
    return [k, o3];
  }));
  const sigmaKOf = (x) => (sigmaMask ? Object.fromEntries(SK.map((k) => { const sg = sigmaOfK(x, k); return [k, sg && refSk[k] ? { sigma: meanMasked(sg, sigmaMask), refSigma: meanMasked(refSk[k], sigmaMask) } : null]; })) : null);
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
        dense: regionRes(s.boil.dense, R.boil.dense),
        moving: regionRes(s.boil.moving, R.boil.moving),
        disocc: regionRes(s.boil.disocc, R.boil.disocc),
        all: regionRes(sumAcc(s.boil), sumAcc(R.boil)),
        k1: { static: regionRes(s.boil.static, R.boil.static), dense: regionRes(s.boil.dense, R.boil.dense), moving: regionRes(s.boil.moving, R.boil.moving), disocc: regionRes(s.boil.disocc, R.boil.disocc), all: regionRes(sumAcc(s.boil), sumAcc(R.boil)) },
        strided: stridedOf(s),
        sigmaK: sigmaKOf(s),
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
      strided: Object.fromEntries(KS.map((k) => [k, Object.fromEntries(REGIONS.map((r) => [r, R.sk[k][r].n ? Math.sqrt(R.sk[k][r].s / R.sk[k][r].n / 6) : NaN]))])),
      sigmaK: sigmaMask ? Object.fromEntries(SK.map((k) => [k, refSk[k] ? meanMasked(refSk[k], sigmaMask) : null])) : null,
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
