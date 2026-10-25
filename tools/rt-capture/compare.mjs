#!/usr/bin/env node
// Score replay outputs (ours or native, same layout) against the capture's *_ref buffers
// with the metric definitions in CAPTURE-FORMAT.md ("Metrics for replay outputs").
// Writes outputs/<capture>/compare.md + compare.json and prints the table.
//
//   node tools/rt-capture/compare.mjs <capture name | dir> [denoiser ...]
//        [--outputs <root containing <capture>/<denoiser>/>] [--settle 8] [--dyn-k 4] [--dyn-delta 0.05] [--quiet]
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
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  OUTPUTS_DIR, PSNR_CAP_DB, SIGNALS, frameDir, listDirs, mean, readBuffer, readF32, readManifest, resolveCapture, scoreFrame, settledMask,
} from './lib/capture.mjs';

const args = process.argv.slice(2);
const VALUE_OPTS = new Set(['outputs', 'settle', 'dyn-k', 'dyn-delta']);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i < 0 ? d : args[i + 1]; };
const pos = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && VALUE_OPTS.has(args[i - 1].slice(2))));
const capDir = resolveCapture(pos[0]);
const capName = path.basename(capDir);
const outRoot = path.join(path.resolve(opt('outputs', OUTPUTS_DIR)), capName);
const SETTLE = Number(opt('settle', 8));
const DYN_DELTA = Number(opt('dyn-delta', 0.05)), DYN_K = Number(opt('dyn-k', 4));   // --dyn-delta / --dyn-k: other windows (default 0.05 / 4)
const m = readManifest(capDir);
const N = m.width * m.height;
const denoisers = pos.length > 1 ? pos.slice(1) : listDirs(outRoot);
if (!denoisers.length) { console.error(`no outputs under ${outRoot}`); process.exit(1); }
const chOf = Object.fromEntries(m.buffers.map((b) => [b.name, b.channels]));
const settled = settledMask(m.frames, SETTLE);

// noisy baseline + reference + depth, cached per frame
const capCache = new Map();
const capFrame = (f) => {
  if (!capCache.has(f)) {
    const o = { depth: readBuffer(capDir, f, 'depth') };
    for (const s of SIGNALS) if (chOf[s] && chOf[`${s}_ref`]) { o[s] = readBuffer(capDir, f, s); o[`${s}_ref`] = readBuffer(capDir, f, `${s}_ref`); }
    capCache.set(f, o);
  }
  return capCache.get(f);
};

// dynamic-region map per frame (visibility): tap[i] = previous-frame pixel of i's history (max-weight valid
// footprint tap, -1 = none), dyn[i] = 1 if the reference range over the last DYN_K frames exceeds DYN_DELTA;
// lag holds the reprojected references of frames t, t-1, .. t-DYN_K+1 (NaN = none) for the next frame
const dynCache = [];
function dynFrame(f) {
  if (dynCache[f]) return dynCache[f];
  const W = m.width, H = m.height;
  const ref = capFrame(f).visibility_ref, depth = capFrame(f).depth;
  const tap = new Int32Array(N).fill(-1), dyn = new Uint8Array(N), lag = new Float32Array(N * DYN_K).fill(NaN);
  for (let i = 0; i < N; i++) lag[i * DYN_K] = ref[i];
  if (f > 0 && !m.frames[f].reset) {
    const prev = dynFrame(f - 1);
    const pref = capFrame(f - 1).visibility_ref, pdepth = capFrame(f - 1).depth;
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

// dynamic / static sums of one frame: [sse, count] per region, temporal [sum |de|, sum de^2, count] per region
function dynScore(f, out, s, prevS, hist) {
  const { tap, dyn } = dynFrame(f);
  const tap1 = f > 0 && !m.frames[f].reset ? dynFrame(f - 1).tap : null;
  const ref = capFrame(f).visibility_ref, depth = capFrame(f).depth;
  const r = { dSse: 0, dN: 0, sSse: 0, sN: 0, spSse: 0, spN: 0, dT: [0, 0, 0], sT: [0, 0, 0], dB: [0, 0], spB: [0, 0] };
  const cl = (v) => Math.min(Math.max(v, 0), 1);
  // boil: second temporal difference along the history (hist = [out_t-1, out_t-2] clamped, or nulls)
  for (let i = 0; i < N; i++) {
    if (!(depth[i] > 0 && depth[i] < 1)) continue;
    const e = s[i], e2 = e * e;
    if (dyn[i]) { r.dSse += e2; r.dN++; } else { r.sSse += e2; r.sN++; if (ref[i] > 0.02 && ref[i] < 0.98) { r.spSse += e2; r.spN++; } }
    if (prevS && tap[i] >= 0 && !Number.isNaN(prevS[tap[i]])) {
      const d = e - prevS[tap[i]], t = dyn[i] ? r.dT : r.sT;
      t[0] += Math.abs(d); t[1] += d * d; t[2]++;
    }
    if (hist?.[1] && tap1 && tap[i] >= 0 && tap1[tap[i]] >= 0) {
      const b = cl(out[i]) - 2 * hist[0][tap[i]] + hist[1][tap1[tap[i]]];
      const t = dyn[i] ? r.dB : (ref[i] > 0.02 && ref[i] < 0.98 ? r.spB : null);
      if (t) { t[0] += b * b; t[1]++; }
    }
  }
  return r;
}

function scoreSequence(getOut, signal) {
  const ch = chOf[signal];
  const per = [];
  let prevS = null;
  let hist = [null, null];   // clamped outputs of frames t-1, t-2 (boil)
  for (let f = 0; f < m.frames.length; f++) {
    const c = capFrame(f);
    const out = getOut(f);
    if (!out) { per.push(null); prevS = null; hist = [null, null]; continue; }
    if (m.frames[f].reset) hist = [null, null];
    if (out.length !== N * ch) throw new Error(`${signal} frame ${f}: ${out.length} floats, expected ${N * ch}`);
    const r = scoreFrame(out, c[`${signal}_ref`], c.depth, ch, m.frames[f].reset ? null : prevS);
    if (signal === 'visibility') {
      r.dyn = dynScore(f, out, r.s, m.frames[f].reset ? null : prevS, hist);
      hist = [Float32Array.from(out, (v) => Math.min(Math.max(v, 0), 1)), hist[0]];
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
  const dynFields = signal !== 'visibility' ? {} : {
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
    psnrPenumbra: ch === 1 ? mean(pick('psnrPenumbra')) : NaN,
    // pooled = PSNR of the mean MSE; capped = mean of per-frame dB clipped at PSNR_CAP_DB
    // (psnr / psnrSettled / psnrPenumbra above: plain mean of per-frame dB, unchanged)
    psnrPooled: pooled('sse', 'sseCount'),
    psnrSettledPooled: pooled('sse', 'sseCount', settled),
    psnrPenumbraPooled: ch === 1 ? pooled('ssePenumbra', 'ssePenumbraCount') : NaN,
    psnrCapped: mean(capped(pick('psnr'))),
    psnrSettledCapped: mean(capped(pick('psnr', settled))),
    psnrPenumbraCapped: ch === 1 ? mean(capped(pick('psnrPenumbra'))) : NaN,
    flicker: mean(pick('flicker')),
    bias: mean(pick('bias')),
    nonFinite: ok.reduce((a, r) => a + r.nonFinite, 0),
    perFramePsnr: per.map((r) => (r ? +r.psnr.toFixed(3) : null)),
    ...dynFields,
  };
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
for (const s of SIGNALS) {
  if (!chOf[s] || !chOf[`${s}_ref`]) continue;
  baselines[s] = scoreSequence((f) => capFrame(f)[s], s);
  if (s === 'visibility') {
    const rb = scoreSequence((f) => capFrame(f).visibility_ref, s);
    Object.assign(baselines[s], { refBoilDynamic: rb.boilDynamic, refBoilStaticPenumbra: rb.boilStaticPenumbra });
  }
}
for (const d of denoisers) {
  const dir = path.join(outRoot, d);
  const run = existsSync(path.join(dir, 'run.json')) ? JSON.parse(readFileSync(path.join(dir, 'run.json'), 'utf8')) : {};
  const t = timingSummary(dir);
  for (const s of SIGNALS) {
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
  '| denoiser | dynamic PSNR | dynamic flicker | dynamic tPSNR | dynamic boil | static PSNR | static penumbra | static flicker | static tPSNR | static penumbra boil |', '|---|---|---|---|---|---|---|---|---|---|');
  for (const r of [{ denoiser: 'noisy', ...b }, ...vis]) {
    lines.push(`| ${r.denoiser} | ${f2(r.psnrDynamicPooled)} | ${f2(r.flickerDynamic, 4)} | ${f2(r.tpsnrDynamic)} | ${f2(r.boilDynamic, 4)} | ${f2(r.psnrStaticPooled)} | ${f2(r.psnrStaticPenumbraPooled)} | ${f2(r.flickerStatic, 4)} | ${f2(r.tpsnrStatic)} | ${f2(r.boilStaticPenumbra, 4)} |`);
  }
  lines.push(`| reference (its own boil) | | | | ${f2(b.refBoilDynamic, 4)} | | | | | ${f2(b.refBoilStaticPenumbra, 4)} |`);
}
const md = lines.join('\n') + '\n';
writeFileSync(path.join(outRoot, 'compare.md'), md);
writeFileSync(path.join(outRoot, 'compare.json'), JSON.stringify({ capture: capName, settle: SETTLE, baselines, results }, null, 1));
if (!args.includes('--quiet')) {
  console.log(md);
  for (const r of results) console.log(`${r.denoiser}/${r.signal} per-frame PSNR: ${r.perFramePsnr.join(' ')}`);
  console.log(`\nwrote ${path.join(outRoot, 'compare.md')}`);
}
