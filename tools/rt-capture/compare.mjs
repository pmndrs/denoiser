#!/usr/bin/env node
// Score replay outputs (ours or native, same layout) against the capture's *_ref buffers
// with the metric definitions in CAPTURE-FORMAT.md ("Metrics for replay outputs").
// Writes outputs/<capture>/compare.md + compare.json and prints the table.
//
//   node tools/rt-capture/compare.mjs <capture name | dir> [denoiser ...]
//        [--outputs <root containing <capture>/<denoiser>/>] [--settle 8] [--dyn-k 4] [--dyn-delta 0.05]
//        [--sh-k 1] [--sh-s 0] [--quiet]
//
// Defaults: every denoiser folder under outputs/<capture>/. Native results: point
// --outputs at the native outputs root (e.g. C:\dev\nrd-reference\outputs).
//
// Visibility also gets a dynamic / static split (moving shadows; results/M4.md "Moving shadows"):
// a pixel is *dynamic* in frame t when its reference visibility changed by more than DYN_DELTA (0.05)
// within the last DYN_K (4) frames: the range (max - min) of its reference over frames t-4..t exceeds
// DYN_DELTA, the older values carried along the history (reprojected each frame through the valid tap
// of the bilinear footprint whose previous reference is closest, so sub-pixel camera motion across a
// hard edge is not a change; static camera: the same pixel). Fields (additive): psnrDynamicPooled,
// psnrStaticPooled, psnrStaticPenumbraPooled, flickerDynamic / flickerStatic (mean |e_t - e_t-1|,
// e = signed error, previous error at the reprojected pixel, valid history only) and
// tpsnrDynamic / tpsnrStatic (-10 log10 mean (e_t - e_t-1)^2), dynamicPixelsPerFrame.
// Flicker and tPSNR include the reference's own frame-to-frame noise, which on slowly moving soft shadows
// is as large as a good output's change; so also *boil* (reference-free temporal noise): the RMS of the
// output's second temporal difference x_t - 2 x_t-1 + x_t-2 along the reprojected history, / sqrt(6)
// (= the per-frame noise sigma of a temporally white signal; a linear change over 3 frames adds 0):
// boilDynamic, boilStaticPenumbra (static region, 0.02 < ref < 0.98); the noisy baseline also carries
// refBoilDynamic / refBoilStaticPenumbra, the same measure on the reference (its noise floor).
// Visibility also gets edgeSharpness (results/SHADOWS-LOOK.md, SHADOWS-MOTION.md): sum |∇out| / sum |∇ref| over the
// pixels where |∇ref| > 0.1 (forward differences, lib/capture.mjs gradMag), all frames: 1 = as crisp as the reference,
// < 1 softer (PSNR and boil barely see a resampling veil), noisy input > 1.
//
// CAPTURE-FORMAT v1 signals (outputs `<signal>.f32`, 3 ch; CAPTURE-FORMAT v1 "Outputs and scoring"):
//   sh-diffuse / sh-specular  scored like rgb signals against diffuse_ref / specular_ref (noisy baseline = the
//     plain diffuse / specular sample), plus, in the bump mask (angle(normal, normal_geom) > 5 deg):
//     psnrBumpPooled; the detail band (x - G(x), G = masked Gaussian sigma 2 px on the Reinhard values):
//     bandPsnrPooled and bandEnergyRatio = sum band(out)^2 / sum band(ref)^2; floorFrac = fraction of scored
//     pixels whose output is exactly 0 (ringing at the resolve's max(0, .) floor). sh-diffuse with
//     diffuse_sh_ref also `vsShRef` (psnr / psnrPooled / psnrSettledPooled against diffuse_sh_ref resolved
//     with SPEC M7-8 / M7-9 at `normal`, guard --sh-k, sharpening --sh-s: the denoising error alone); the
//     noisy baseline carries refGuardFrac / refFloorFrac of that resolve.
//   shadow-rgb  rgb clamped to [0, 1] per channel against shadow_rgb_ref (noisy = visibility x transmittance),
//     penumbra = any reference channel in (0.02, 0.98), tint region (reference max_c - min_c > 0.02):
//     psnrTintPooled and chromaErr (mean |S/sum S - R/sum R| over channels and tint pixels), and the dynamic /
//     static / boil fields above on the per-pixel mean of the clamped channels.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  BUMP_COS, OUTPUTS_DIR, PSNR_CAP_DB, SIGNALS, V1_SIGNALS, edgeGradSums, frameDir, gradMag, listDirs, maskedBlur3, mean, readBuffer, readF32, readManifest, reinhard,
  resolveCapture, scoreFrame, settledMask, shResolve,
} from './lib/capture.mjs';

const args = process.argv.slice(2);
const VALUE_OPTS = new Set(['outputs', 'settle', 'dyn-k', 'dyn-delta', 'sh-k', 'sh-s']);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i < 0 ? d : args[i + 1]; };
const pos = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && VALUE_OPTS.has(args[i - 1].slice(2))));
const capDir = resolveCapture(pos[0]);
const capName = path.basename(capDir);
const outRoot = path.join(path.resolve(opt('outputs', OUTPUTS_DIR)), capName);
const SETTLE = Number(opt('settle', 8));
const DYN_DELTA = Number(opt('dyn-delta', 0.05)), DYN_K = Number(opt('dyn-k', 4));   // --dyn-delta / --dyn-k: other windows (default 0.05 / 4)
const SH_K = Number(opt('sh-k', 1)), SH_S = Number(opt('sh-s', 0));   // v1: resolve of diffuse_sh_ref (vsShRef)
const m = readManifest(capDir);
const N = m.width * m.height;
const denoisers = pos.length > 1 ? pos.slice(1) : listDirs(outRoot);
if (!denoisers.length) { console.error(`no outputs under ${outRoot}`); process.exit(1); }
const chOf = Object.fromEntries(m.buffers.map((b) => [b.name, b.channels]));
const settled = settledMask(m.frames, SETTLE);
/** v1 signals this capture can score */
const V1 = Object.keys(V1_SIGNALS).filter((s) => V1_SIGNALS[s].needs.every((b) => chOf[b]) && chOf[V1_SIGNALS[s].reference]);
const ALL = [...SIGNALS.filter((s) => chOf[s] && chOf[`${s}_ref`]), ...V1];
const refKeyOf = (s) => (V1_SIGNALS[s] ? V1_SIGNALS[s].reference : `${s}_ref`);
const chOfSignal = (s) => (V1_SIGNALS[s] ? 3 : chOf[s]);

// noisy baseline + reference + depth, cached per frame
const capCache = new Map();
const capFrame = (f) => {
  if (!capCache.has(f)) {
    const o = { depth: readBuffer(capDir, f, 'depth') };
    for (const s of SIGNALS) if (chOf[s] && chOf[`${s}_ref`]) { o[s] = readBuffer(capDir, f, s); o[`${s}_ref`] = readBuffer(capDir, f, `${s}_ref`); }
    // v1: noisy inputs, references, normals
    for (const s of V1) {
      const ref = V1_SIGNALS[s].reference;
      o[ref] ??= readBuffer(capDir, f, ref);
      if (s === 'shadow-rgb') {
        const v = o.visibility ?? readBuffer(capDir, f, 'visibility'), t = readBuffer(capDir, f, 'transmittance');
        const x = new Float32Array(N * 3);
        for (let i = 0; i < N * 3; i++) x[i] = v[Math.floor(i / 3)] * t[i];
        o[s] = x;
      } else o[s] = o[V1_SIGNALS[s].needs[0]] ?? readBuffer(capDir, f, V1_SIGNALS[s].needs[0]);
    }
    if (V1.some((s) => s.startsWith('sh-'))) {
      o.normal = readBuffer(capDir, f, 'normal');
      o.normal_geom = chOf.normal_geom ? readBuffer(capDir, f, 'normal_geom') : o.normal;
    }
    capCache.set(f, o);
    if (capCache.size > 3) capCache.delete(capCache.keys().next().value);
  }
  return capCache.get(f);
};

// dynamic-region map per frame (visibility): tap[i] = previous-frame pixel of i's history (max-weight valid
// footprint tap, -1 = none), dyn[i] = 1 if the reference range over the last DYN_K frames exceeds DYN_DELTA;
// lag holds the reprojected references of frames t, t-1, .. t-DYN_K+1 (NaN = none) for the next frame
const dynCaches = {};
/** per-pixel scalar reference of a dynamic-region signal: visibility_ref, or the mean of shadow_rgb_ref's clamped channels */
const scalarRefCache = new Map();
function dynRef(f, key) {
  if (key === 'visibility') return capFrame(f).visibility_ref;
  const k = `${key}:${f}`;
  if (!scalarRefCache.has(k)) {
    const r = capFrame(f).shadow_rgb_ref, x = new Float32Array(N);
    const cl = (v) => Math.min(Math.max(v, 0), 1);
    for (let i = 0; i < N; i++) x[i] = (cl(r[3 * i]) + cl(r[3 * i + 1]) + cl(r[3 * i + 2])) / 3;
    scalarRefCache.set(k, x);
    if (scalarRefCache.size > 4) scalarRefCache.delete(scalarRefCache.keys().next().value);
  }
  return scalarRefCache.get(k);
}
function dynFrame(f, key = 'visibility') {
  const dynCache = (dynCaches[key] ??= []);
  if (dynCache[f]) return dynCache[f];
  const W = m.width, H = m.height;
  const ref = dynRef(f, key), depth = capFrame(f).depth;
  const tap = new Int32Array(N).fill(-1), dyn = new Uint8Array(N), lag = new Float32Array(N * DYN_K).fill(NaN);
  for (let i = 0; i < N; i++) lag[i * DYN_K] = ref[i];
  if (f > 0 && !m.frames[f].reset) {
    const prev = dynFrame(f - 1, key);
    const pref = dynRef(f - 1, key), pdepth = capFrame(f - 1).depth;
    const mo = readBuffer(capDir, f, 'motion');
    const vz = readBuffer(capDir, f, 'viewz'), pvz = readBuffer(capDir, f - 1, 'viewz');
    const mz = chOf.motion_z ? readBuffer(capDir, f, 'motion_z') : null;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!(depth[i] > 0 && depth[i] < 1)) continue;
      const px = x + 0.5 - 0.5 * mo[2 * i] * W - 0.5, py = y + 0.5 + 0.5 * mo[2 * i + 1] * H - 0.5;
      const bx = Math.floor(px), by = Math.floor(py), fx = px - bx, fy = py - by;
      const zExp = vz[i] + (mz ? mz[i] : 0), tol = 0.02 * Math.abs(vz[i]);
      let dmin = Infinity, near = -1, bestW = -1, best = -1;
      for (let k = 0; k < 4; k++) {
        const qx = bx + (k & 1), qy = by + (k >> 1);
        const w = ((k & 1) ? fx : 1 - fx) * ((k >> 1) ? fy : 1 - fy);
        if (w <= 1e-3 || qx < 0 || qy < 0 || qx >= W || qy >= H) continue;
        const q = qy * W + qx;
        if (!(pdepth[q] > 0 && pdepth[q] < 1) || Math.abs(pvz[q] - zExp) > tol) continue;
        const d = Math.abs(ref[i] - pref[q]);
        if (d < dmin) { dmin = d; near = q; }
        if (w > bestW) { bestW = w; best = q; }
      }
      if (best < 0) continue;
      tap[i] = best;
      let lo = ref[i], hi = ref[i];
      for (let k = 1; k < DYN_K; k++) lag[i * DYN_K + k] = prev.lag[near * DYN_K + k - 1];
      for (let k = 0; k < DYN_K; k++) { const v = prev.lag[near * DYN_K + k]; if (v === v) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }
      dyn[i] = hi - lo > DYN_DELTA ? 1 : 0;
    }
  }
  dynCache[f] = { tap, dyn, lag };
  if (f > 1 && dynCache[f - 2]) delete dynCache[f - 2].lag;   // only the previous frame's lags are needed
  return dynCache[f];
}

// dynamic / static sums of one frame: [sse, count] per region, temporal [sum |de|, sum de^2, count] per region.
// `out`: per-pixel scalar output (visibility, or shadow-rgb's mean of clamped channels); `pen`: per-pixel
// penumbra flag (null = 0.02 < ref < 0.98 on the scalar reference); `e3` / `prevE3` (rgb, shadow-rgb): per-channel
// signed errors of this / the previous frame, so the region MSE and the temporal sums are per channel (as the
// pooled PSNR and the live test bed), not of the channel mean
function dynScore(f, out, s, prevS, hist, key = 'visibility', pen = null, e3 = null, prevE3 = null) {
  const { tap, dyn } = dynFrame(f, key);
  const tap1 = f > 0 && !m.frames[f].reset ? dynFrame(f - 1, key).tap : null;
  const ref = dynRef(f, key), depth = capFrame(f).depth;
  const r = { dSse: 0, dN: 0, sSse: 0, sN: 0, spSse: 0, spN: 0, dT: [0, 0, 0], sT: [0, 0, 0], dB: [0, 0], spB: [0, 0] };
  const cl = (v) => Math.min(Math.max(v, 0), 1);
  // boil: second temporal difference along the history (hist = [out_t-1, out_t-2] clamped, or nulls)
  for (let i = 0; i < N; i++) {
    if (!(depth[i] > 0 && depth[i] < 1)) continue;
    const e = s[i], e2 = e3 ? (e3[3 * i] ** 2 + e3[3 * i + 1] ** 2 + e3[3 * i + 2] ** 2) / 3 : e * e;
    const isPen = pen ? pen[i] === 1 : ref[i] > 0.02 && ref[i] < 0.98;
    if (dyn[i]) { r.dSse += e2; r.dN++; } else { r.sSse += e2; r.sN++; if (isPen) { r.spSse += e2; r.spN++; } }
    if (prevS && tap[i] >= 0 && !Number.isNaN(prevS[tap[i]])) {
      const t = dyn[i] ? r.dT : r.sT;
      if (e3 && prevE3) {
        let a = 0, q = 0;
        for (let k = 0; k < 3; k++) { const d = e3[3 * i + k] - prevE3[3 * tap[i] + k]; a += Math.abs(d); q += d * d; }
        t[0] += a / 3; t[1] += q / 3; t[2]++;
      } else {
        const d = e - prevS[tap[i]];
        t[0] += Math.abs(d); t[1] += d * d; t[2]++;
      }
    }
    if (hist?.[1] && tap1 && tap[i] >= 0 && tap1[tap[i]] >= 0) {
      const b = cl(out[i]) - 2 * hist[0][tap[i]] + hist[1][tap1[tap[i]]];
      const t = dyn[i] ? r.dB : (isPen ? r.spB : null);
      if (t) { t[0] += b * b; t[1]++; }
    }
  }
  return r;
}

// v1 per-frame extras (see the header): bump / band / floor (sh-*), tint / chroma (shadow-rgb), vsShRef (sh-diffuse)
const bandRefCache = new Map();
function v1Frame(f, out, signal, isBaseline) {
  const c = capFrame(f), depth = c.depth, ref = c[refKeyOf(signal)];
  const r = {};
  if (signal === 'shadow-rgb') {
    let tSse = 0, tN = 0, ce = 0;
    const cl = (v) => Math.min(Math.max(v, 0), 1);
    for (let i = 0; i < N; i++) {
      if (!(depth[i] > 0 && depth[i] < 1)) continue;
      const rr = [cl(ref[3 * i]), cl(ref[3 * i + 1]), cl(ref[3 * i + 2])];
      if (Math.max(...rr) - Math.min(...rr) <= 0.02) continue;
      const oo = [0, 1, 2].map((k) => (Number.isFinite(out[3 * i + k]) ? cl(out[3 * i + k]) : 0));
      const so = Math.max(oo[0] + oo[1] + oo[2], 1e-4), sr = Math.max(rr[0] + rr[1] + rr[2], 1e-4);
      let e = 0;
      for (let k = 0; k < 3; k++) { const d = oo[k] - rr[k]; tSse += d * d; e += Math.abs(oo[k] / so - rr[k] / sr); }
      tN += 3; ce += e / 3;
    }
    Object.assign(r, { tSse, tN, ce, tPix: tN / 3 });
    return r;
  }
  // sh-*: bump mask, floor, detail band
  const n = c.normal, ng = c.normal_geom;
  const scored = new Uint8Array(N), bump = new Uint8Array(N);
  let floor = 0, nScored = 0, bSse = 0, bN = 0;
  for (let i = 0; i < N; i++) {
    if (!(depth[i] > 0 && depth[i] < 1)) continue;
    scored[i] = 1; nScored++;
    if (out[3 * i] === 0 && out[3 * i + 1] === 0 && out[3 * i + 2] === 0) floor++;
    if (n[3 * i] * ng[3 * i] + n[3 * i + 1] * ng[3 * i + 1] + n[3 * i + 2] * ng[3 * i + 2] < BUMP_COS) {
      bump[i] = 1;
      for (let k = 0; k < 3; k++) { const d = (Number.isFinite(out[3 * i + k]) ? reinhard(out[3 * i + k]) : 0) - reinhard(ref[3 * i + k]); bSse += d * d; }
      bN += 3;
    }
  }
  const tmOf = (x) => Float32Array.from(x, (v) => (Number.isFinite(v) ? reinhard(v) : 0));
  const key = `${signal}:${f}`;
  if (!bandRefCache.has(key)) {
    const tr = tmOf(ref);
    bandRefCache.set(key, { tr, gr: maskedBlur3(tr, scored, m.width, m.height) });
    if (bandRefCache.size > 2) bandRefCache.delete(bandRefCache.keys().next().value);
  }
  const { tr, gr } = bandRefCache.get(key);
  const to = tmOf(out), go = maskedBlur3(to, scored, m.width, m.height);
  let eb = 0, eo = 0, er = 0;
  for (let i = 0; i < N; i++) {
    if (!bump[i]) continue;
    for (let k = 0; k < 3; k++) {
      const bo = to[3 * i + k] - go[3 * i + k], br = tr[3 * i + k] - gr[3 * i + k];
      eb += (bo - br) ** 2; eo += bo * bo; er += br * br;
    }
  }
  Object.assign(r, { floor, nScored, bSse, bN, eb, eo, er, bPix: bN / 3 });
  // reference-side ringing of the diffuse_sh_ref resolve (baseline only)
  if (isBaseline && signal === 'sh-diffuse' && chOf.diffuse_sh_ref) {
    const sh = shRefResolved(f);
    r.refGuard = sh.trimmed; r.refFloor = sh.floored;
  }
  return r;
}

/** diffuse_sh_ref resolved at `normal` (SPEC M7-8 / M7-9, --sh-k / --sh-s) */
const shResolvedCache = new Map();
function shRefResolved(f) {
  if (!shResolvedCache.has(f)) {
    const c = capFrame(f), p6 = readBuffer(capDir, f, 'diffuse_sh_ref');
    const rgb = new Float32Array(N * 3);
    let trimmed = 0, floored = 0;
    for (let i = 0; i < N; i++) {
      if (!(c.depth[i] > 0 && c.depth[i] < 1)) continue;
      const nd = [c.normal[3 * i], c.normal[3 * i + 1], c.normal[3 * i + 2]], ng = [c.normal_geom[3 * i], c.normal_geom[3 * i + 1], c.normal_geom[3 * i + 2]];
      const x = shResolve(p6, 6 * i, nd, ng, SH_K, SH_S);
      rgb[3 * i] = x[0]; rgb[3 * i + 1] = x[1]; rgb[3 * i + 2] = x[2]; trimmed += x[3]; floored += x[4];
    }
    shResolvedCache.set(f, { rgb, trimmed, floored });
    if (shResolvedCache.size > 2) shResolvedCache.delete(shResolvedCache.keys().next().value);
  }
  return shResolvedCache.get(f);
}

function scoreSequence(getOut, signal, isBaseline = false) {
  const ch = chOfSignal(signal);
  const v1 = !!V1_SIGNALS[signal];
  const clamp = signal === 'shadow-rgb';
  const dynKey = signal === 'visibility' || signal === 'shadow-rgb' ? signal : null;
  const vsSh = signal === 'sh-diffuse' && chOf.diffuse_sh_ref;
  const per = [];
  let prevS = null, prevSh = null, prevE3 = null;
  let hist = [null, null];   // clamped outputs of frames t-1, t-2 (boil)
  for (let f = 0; f < m.frames.length; f++) {
    const c = capFrame(f);
    const out = getOut(f);
    if (!out) { per.push(null); prevS = null; prevSh = null; prevE3 = null; hist = [null, null]; continue; }
    if (m.frames[f].reset) hist = [null, null];
    if (out.length !== N * ch) throw new Error(`${signal} frame ${f}: ${out.length} floats, expected ${N * ch}`);
    const r = scoreFrame(out, c[refKeyOf(signal)], c.depth, ch, m.frames[f].reset ? null : prevS, clamp ? { clamp: true } : undefined);
    if (dynKey) {
      // per-pixel scalar output and (shadow-rgb) the any-channel penumbra mask
      const cl = (v) => Math.min(Math.max(v, 0), 1);
      let outS = out, pen = null, e3 = null;
      if (clamp) {
        outS = new Float32Array(N); pen = new Uint8Array(N); e3 = new Float32Array(N * 3);
        const rr = c.shadow_rgb_ref;
        for (let i = 0; i < N; i++) {
          outS[i] = (cl(out[3 * i]) + cl(out[3 * i + 1]) + cl(out[3 * i + 2])) / 3;
          for (let k = 0; k < 3; k++) {
            if (rr[3 * i + k] > 0.02 && rr[3 * i + k] < 0.98) pen[i] = 1;
            e3[3 * i + k] = (Number.isFinite(out[3 * i + k]) ? cl(out[3 * i + k]) : 0) - cl(rr[3 * i + k]);
          }
        }
      }
      r.dyn = dynScore(f, outS, r.s, m.frames[f].reset ? null : prevS, hist, dynKey, pen, e3, m.frames[f].reset ? null : prevE3);
      prevE3 = e3;
      hist = [Float32Array.from(outS, (v) => Math.min(Math.max(v, 0), 1)), hist[0]];
    }
    if (signal === 'visibility') {
      const c0 = capFrame(f);
      c0.gRef ??= gradMag(c0.visibility_ref, c0.depth, m.width, m.height);
      r.edge = edgeGradSums(out, c0.visibility_ref, c0.depth, m.width, m.height, 0.1, null, c0.gRef);
    }
    if (v1) r.v1 = v1Frame(f, out, signal, isBaseline);
    if (vsSh) {
      const rs = scoreFrame(out, shRefResolved(f).rgb, c.depth, 3, m.frames[f].reset ? null : prevSh);
      prevSh = rs.s; delete rs.s;
      r.sh = rs;
    }
    prevS = r.s;
    delete r.s;
    per.push(r);
  }
  const ok = per.filter(Boolean);
  const pick = (k, mask) => per.map((r, i) => (r && (!mask || mask[i]) ? r[k] : NaN));
  const last = [...per].reverse().find(Boolean);
  // pooled: PSNR of the mean squared error over all (masked) frames and pixels
  const pooled = (sseKey, cntKey, mask) => {
    let e = 0, k = 0;
    per.forEach((r, i) => { if (r && (!mask || mask[i])) { e += r[sseKey]; k += r[cntKey]; } });
    return k ? 10 * Math.log10(1 / Math.max(e / k, 1e-12)) : NaN;
  };
  const capped = (xs) => xs.map((x) => (Number.isFinite(x) ? Math.min(x, PSNR_CAP_DB) : x));
  // dynamic / static split (visibility; see the header)
  const dsum = (k) => per.reduce((a, r) => a + (r?.dyn ? r.dyn[k] : 0), 0);
  const tsum = (k, j) => per.reduce((a, r) => a + (r?.dyn ? r.dyn[k][j] : 0), 0);
  const db = (e, n) => (n ? 10 * Math.log10(1 / Math.max(e / n, 1e-12)) : NaN);
  const dynFields = !dynKey ? {} : {
    dynamicPixelsPerFrame: Math.round(dsum('dN') / Math.max(ok.length, 1)),
    psnrDynamicPooled: db(dsum('dSse'), dsum('dN')),
    psnrStaticPooled: db(dsum('sSse'), dsum('sN')),
    psnrStaticPenumbraPooled: db(dsum('spSse'), dsum('spN')),
    flickerDynamic: tsum('dT', 2) ? tsum('dT', 0) / tsum('dT', 2) : NaN,
    tpsnrDynamic: db(tsum('dT', 1), tsum('dT', 2)),
    flickerStatic: tsum('sT', 2) ? tsum('sT', 0) / tsum('sT', 2) : NaN,
    tpsnrStatic: db(tsum('sT', 1), tsum('sT', 2)),
    boilDynamic: tsum('dB', 1) ? Math.sqrt(tsum('dB', 0) / tsum('dB', 1) / 6) : NaN,
    boilStaticPenumbra: tsum('spB', 1) ? Math.sqrt(tsum('spB', 0) / tsum('spB', 1) / 6) : NaN,
  };
  return {
    frames: ok.length,
    psnr: mean(pick('psnr')),
    psnrSettled: mean(pick('psnr', settled)),
    psnrLast: last?.psnr ?? NaN,
    psnrPenumbra: ch === 1 || clamp ? mean(pick('psnrPenumbra')) : NaN,
    // pooled = PSNR of the mean MSE; capped = mean of per-frame dB clipped at PSNR_CAP_DB
    // (psnr / psnrSettled / psnrPenumbra above: plain mean of per-frame dB, unchanged)
    psnrPooled: pooled('sse', 'sseCount'),
    psnrSettledPooled: pooled('sse', 'sseCount', settled),
    psnrPenumbraPooled: ch === 1 || clamp ? pooled('ssePenumbra', 'ssePenumbraCount') : NaN,
    psnrCapped: mean(capped(pick('psnr'))),
    psnrSettledCapped: mean(capped(pick('psnr', settled))),
    psnrPenumbraCapped: ch === 1 || clamp ? mean(capped(pick('psnrPenumbra'))) : NaN,
    flicker: mean(pick('flicker')),
    bias: mean(pick('bias')),
    nonFinite: ok.reduce((a, r) => a + r.nonFinite, 0),
    perFramePsnr: per.map((r) => (r ? +r.psnr.toFixed(3) : null)),
    ...dynFields,
    ...(signal === 'visibility' ? { edgeSharpness: (() => { let a = 0, b = 0; for (const r of ok) { a += r.edge.sumOut; b += r.edge.sumRef; } return b ? a / b : NaN; })() } : {}),
    ...(v1 ? v1Fields(per, ok) : {}),
    ...(vsSh ? { vsShRef: vsShFields(per), shRefResolve: { k: SH_K, s: SH_S } } : {}),
  };
}

function v1Fields(per, ok) {
  const sum = (k) => per.reduce((a, r) => a + (r?.v1?.[k] ?? 0), 0);
  const db = (e, n) => (n ? 10 * Math.log10(1 / Math.max(e / n, 1e-12)) : NaN);
  const frames = Math.max(ok.length, 1);
  if (per.find((r) => r?.v1)?.v1.tN !== undefined) {
    return { tintPixelsPerFrame: Math.round(sum('tPix') / frames), psnrTintPooled: db(sum('tSse'), sum('tN')), chromaErr: sum('tPix') ? sum('ce') / sum('tPix') : NaN };
  }
  const out = {
    bumpPixelsPerFrame: Math.round(sum('bPix') / frames), psnrBumpPooled: db(sum('bSse'), sum('bN')),
    bandPsnrPooled: db(sum('eb'), sum('bN')), bandEnergyRatio: sum('er') ? sum('eo') / sum('er') : NaN,
    floorFrac: sum('nScored') ? sum('floor') / sum('nScored') : NaN,
  };
  if (per.some((r) => r?.v1?.refGuard !== undefined)) Object.assign(out, { refGuardFrac: sum('refGuard') / sum('nScored'), refFloorFrac: sum('refFloor') / sum('nScored') });
  return out;
}

function vsShFields(per) {
  const pooled = (mask) => {
    let e = 0, k = 0;
    per.forEach((r, i) => { if (r?.sh && (!mask || mask[i])) { e += r.sh.sse; k += r.sh.sseCount; } });
    return k ? 10 * Math.log10(1 / Math.max(e / k, 1e-12)) : NaN;
  };
  return { psnr: mean(per.map((r) => (r?.sh ? r.sh.psnr : NaN))), psnrPooled: pooled(), psnrSettledPooled: pooled(settled) };
}

function timingSummary(dir) {
  const p = path.join(dir, 'timings.csv');
  if (!existsSync(p)) return {};
  const rows = readFileSync(p, 'utf8').trim().split('\n').slice(1).map((l) => l.split(','));
  const byFrame = (pred) => {
    const mm = new Map();
    for (const [f, pass, ms] of rows) if (pred(pass)) mm.set(f, (mm.get(f) ?? 0) + Number(ms));
    const v = [...mm.values()].sort((a, b) => a - b);
    // skip the first frame (pipeline compilation) when there are others
    const w = v.length > 1 ? [...mm.entries()].filter(([f]) => f !== rows[0][0]).map(([, x]) => x).sort((a, b) => a - b) : v;
    return w.length ? w[Math.floor(w.length / 2)] : NaN;
  };
  return { medianGpuMs: byFrame((p) => p === 'total' || p.endsWith('/total')), medianWallMs: byFrame((p) => p === 'wall') };
}

const results = [];
const baselines = {};
for (const s of ALL) {
  baselines[s] = scoreSequence((f) => capFrame(f)[s], s, true);
  if (s === 'visibility' || s === 'shadow-rgb') {
    const rb = scoreSequence((f) => capFrame(f)[refKeyOf(s)], s);
    Object.assign(baselines[s], { refBoilDynamic: rb.boilDynamic, refBoilStaticPenumbra: rb.boilStaticPenumbra });
  }
}
for (const d of denoisers) {
  const dir = path.join(outRoot, d);
  const run = existsSync(path.join(dir, 'run.json')) ? JSON.parse(readFileSync(path.join(dir, 'run.json'), 'utf8')) : {};
  const t = timingSummary(dir);
  for (const s of ALL) {
    if (!baselines[s]) continue;
    if (!existsSync(path.join(dir, frameDir(0), `${s}.f32`))) continue;
    const r = scoreSequence((f) => {
      const p = path.join(dir, frameDir(f), `${s}.f32`);
      return existsSync(p) ? readF32(p) : null;
    }, s);
    results.push({ denoiser: d, signal: s, ...r, ...t, commit: run.commit ?? run.version ?? null, gpu: run.gpu?.description || run.gpu?.architecture || run.gpu || null });
  }
}

const f2 = (x, k = 2) => (Number.isFinite(x) ? x.toFixed(k) : '–');
const lines = [
  `# ${capName}: replay scores`,
  '',
  `${m.width}×${m.height}, ${m.frames.length} frames, resets at [${m.frames.filter((f) => f.reset).map((f) => f.index).join(', ')}], referenceSpp ${m.referenceSpp}. ` +
  `Metrics: CAPTURE-FORMAT.md; settled = ≥ ${SETTLE} frames after a reset. PSNR, settled, last frame and penumbra are means of per-frame dB; ` +
  `pooled = PSNR of the mean MSE over all frames and pixels; capped = mean of per-frame dB clipped at ${PSNR_CAP_DB} dB.`,
  '',
  '| denoiser | signal | PSNR dB (noisy → out) | pooled | capped | settled | settled pooled | last frame | penumbra | penumbra pooled | flicker (noisy → out) | bias | non-finite | GPU ms | wall ms |',
  '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
];
for (const r of results) {
  const b = baselines[r.signal];
  lines.push(`| ${r.denoiser} | ${r.signal} | ${f2(b.psnr)} → **${f2(r.psnr)}** | ${f2(r.psnrPooled)} | ${f2(r.psnrCapped)} | ${f2(r.psnrSettled)} | ${f2(r.psnrSettledPooled)} | ${f2(r.psnrLast)} | ${f2(r.psnrPenumbra)} | ${f2(r.psnrPenumbraPooled)} | ${f2(b.flicker, 4)} → ${f2(r.flicker, 4)} | ${f2(r.bias, 4)} | ${r.nonFinite} | ${f2(r.medianGpuMs, 3)} | ${f2(r.medianWallMs, 2)} |`);
}
const vis = results.filter((r) => r.signal === 'visibility' && r.dynamicPixelsPerFrame > 0);
if (vis.length) {
  const b = baselines.visibility;
  lines.push('', `Visibility, dynamic vs static region (dynamic: reference range over frames t-${DYN_K}..t > ${DYN_DELTA}, reprojected; ` +
    `${b.dynamicPixelsPerFrame} px per frame). Pooled PSNR; flicker = mean |e_t − e_t−1| and tPSNR, motion-compensated, valid history.`, '',
  '| denoiser | dynamic PSNR | dynamic flicker | dynamic tPSNR | dynamic boil | static PSNR | static penumbra | static flicker | static tPSNR | static penumbra boil | edge sharpness |', '|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of [{ denoiser: 'noisy', ...b }, ...vis]) {
    lines.push(`| ${r.denoiser} | ${f2(r.psnrDynamicPooled)} | ${f2(r.flickerDynamic, 4)} | ${f2(r.tpsnrDynamic)} | ${f2(r.boilDynamic, 4)} | ${f2(r.psnrStaticPooled)} | ${f2(r.psnrStaticPenumbraPooled)} | ${f2(r.flickerStatic, 4)} | ${f2(r.tpsnrStatic)} | ${f2(r.boilStaticPenumbra, 4)} | ${f2(r.edgeSharpness, 3)} |`);
  }
  lines.push(`| reference (its own boil) | | | | ${f2(b.refBoilDynamic, 4)} | | | | | ${f2(b.refBoilStaticPenumbra, 4)} | 1 |`);
}
// ---- v1 tables
const shRows = results.filter((r) => r.signal.startsWith('sh-'));
if (shRows.length) {
  lines.push('', `SH signals (v1): bump mask = angle(normal, normal_geom) > 5 deg; detail band = x − G(x), G = masked Gaussian σ 2 px, energy ratio Σband(out)² / Σband(ref)² ` +
    `(1 = detail kept, < 1 smoothed, > 1 noise); floor = output exactly 0; vs SH ref = against diffuse_sh_ref resolved (M7-8 / M7-9, k ${SH_K}, s ${SH_S}).`, '',
  '| denoiser | signal | pooled | bump PSNR | band PSNR | band energy | floor | vs SH ref pooled |', '|---|---|---|---|---|---|---|---|');
  for (const r of [...V1.filter((s) => s.startsWith('sh-')).map((s) => ({ denoiser: 'noisy', signal: s, ...baselines[s] })), ...shRows]) {
    lines.push(`| ${r.denoiser} | ${r.signal} | ${f2(r.psnrPooled)} | ${f2(r.psnrBumpPooled)} | ${f2(r.bandPsnrPooled)} | ${f2(r.bandEnergyRatio, 3)} | ${f2(r.floorFrac, 4)} | ${f2(r.vsShRef?.psnrPooled)} |`);
  }
}
const rgbRows = results.filter((r) => r.signal === 'shadow-rgb');
if (rgbRows.length) {
  const b = baselines['shadow-rgb'];
  lines.push('', `shadow-rgb (v1): rgb clamped to [0, 1]; penumbra = any reference channel in (0.02, 0.98); tint = reference chroma > 0.02 (${b.tintPixelsPerFrame} px per frame); ` +
    'chroma error = mean |S/ΣS − R/ΣR|; dynamic / boil on the mean of the clamped channels.', '',
  '| denoiser | pooled | penumbra pooled | tint PSNR | chroma err | dynamic PSNR | dynamic boil | static penumbra | static penumbra boil |', '|---|---|---|---|---|---|---|---|---|');
  for (const r of [{ denoiser: 'noisy', ...b }, ...rgbRows]) {
    lines.push(`| ${r.denoiser} | ${f2(r.psnrPooled)} | ${f2(r.psnrPenumbraPooled)} | ${f2(r.psnrTintPooled)} | ${f2(r.chromaErr, 4)} | ${f2(r.psnrDynamicPooled)} | ${f2(r.boilDynamic, 4)} | ${f2(r.psnrStaticPenumbraPooled)} | ${f2(r.boilStaticPenumbra, 4)} |`);
  }
  lines.push(`| reference (its own boil) | | | | | | ${f2(b.refBoilDynamic, 4)} | | ${f2(b.refBoilStaticPenumbra, 4)} |`);
}
const md = lines.join('\n') + '\n';
writeFileSync(path.join(outRoot, 'compare.md'), md);
writeFileSync(path.join(outRoot, 'compare.json'), JSON.stringify({ capture: capName, settle: SETTLE, baselines, results }, null, 1));
if (!args.includes('--quiet')) {
  console.log(md);
  for (const r of results) console.log(`${r.denoiser}/${r.signal} per-frame PSNR: ${r.perFramePsnr.join(' ')}`);
  console.log(`\nwrote ${path.join(outRoot, 'compare.md')}`);
}
