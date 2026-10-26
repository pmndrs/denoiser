#!/usr/bin/env node
// Shadow (visibility) scores by region and motion phase, plus a trailing measure
// (docs/research/rt-denoiser/results/SHADOWS-MOTION.md). Replay outputs as compare.mjs reads them.
//
//   node tools/rt-capture/shadow-regions.mjs <capture> [--denoisers a,b] [--outputs <root>] [--json out.json]
//        [--contact 0.25] [--edge 0.2] [--quiet]
//
// Regions, per frame, from the reference R and the capture's guides (scored pixels only):
//   edge     hard edge: R's gradient magnitude (forward differences, lib/capture.mjs gradMag) >= --edge (0.2 per
//            px, a transition narrower than ~5 px), dilated by 1 px
//   soft     wide penumbra: 0.02 < R < 0.98 outside `edge`
//   umbra    R <= 0.02 outside `edge`;  lit  R >= 0.98 outside `edge`
//   contact  edge or penumbra pixels whose 5x5 mean occluder distance (1-ray samples that hit an occluder,
//            occluder_dist > 0) is below --contact (0.25 world units, needs >= 2 such samples)
//   changing R's range over frames t-4..t along the reprojected history exceeds 0.05 (compare.mjs's dynamic region:
//            on a moving camera it still holds some edge resampling); static = the rest
// Metrics per region: pooled PSNR (clamped values, compare.mjs), bias (mean out - R), boil (RMS second temporal
// difference along the history / sqrt 6, counted only where R's own second difference is < 0.02, so real changes of
// the truth stay out; the reference's boil on the same pixels is its noise floor), edge sharpness (sum |grad out| /
// sum |grad R| where |grad R| > 0.1), split static / changing.
// Trailing (changing pixels with 8 frames of reprojected reference history): lag = the k in 0..7 minimizing
// sum (out_t - R_t-k)^2 (parabolic refinement; 0 = on time, 1 = one frame behind), and arrive / leave bias: mean
// (out - R) where R darkened (shadow arriving, R_t - R_t-2 < -0.05) / brightened (leaving, > 0.05); a lagging
// output is too bright where the shadow arrives (+) and too dark where it leaves (-): trail = (arrive - leave) / 2.
// Edge speed: median |R_t - R_t-1| / |grad R| over changing edge pixels (px per frame).
// Phases (captures sm-*: test bed paths, examples/realtime-denoiser/src/paths.ts): 0 = frame 0, 1 = move 1-24,
// 2 = hold 25-40, 3 = reverse 41-64, 4 = hold 65-79; other captures: phase 0 = resets, 1 = the rest.
import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { OUTPUTS_DIR, frameDir, gradMag, isScored, listDirs, readBuffer, readF32, readManifest, resolveCapture } from './lib/capture.mjs';

const args = process.argv.slice(2);
const VALUE_OPTS = new Set(['denoisers', 'outputs', 'json', 'contact', 'edge']);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i < 0 ? d : args[i + 1]; };
const pos = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && VALUE_OPTS.has(args[i - 1].slice(2))));
const capDir = resolveCapture(pos[0]);
const capName = path.basename(capDir);
const outRoot = path.join(path.resolve(opt('outputs', OUTPUTS_DIR)), capName);
const CONTACT = Number(opt('contact', 0.25)), EDGE = Number(opt('edge', 0.2));
const DYN_K = 4, DYN_DELTA = 0.05, LAG_K = 8, BOIL_REF_MAX = 0.02;
const m = readManifest(capDir);
const W = m.width, H = m.height, N = W * H, F = m.frames.length;
const hasMz = m.buffers.some((b) => b.name === 'motion_z');
const hasOcc = m.buffers.some((b) => b.name === 'occluder_dist');
const denoisers = opt('denoisers') ? opt('denoisers').split(',') : listDirs(outRoot);
const SM = capName.startsWith('sm-');
const phaseOf = (f) => (m.frames[f].reset ? 0 : !SM ? 1 : f <= 24 ? 1 : f <= 40 ? 2 : f <= 64 ? 3 : 4);
const NPH = SM ? 5 : 2;
const REGIONS = ['all', 'edge', 'soft', 'contact', 'umbra', 'lit', 'changing', 'static'];
const R_ALL = 0, R_EDGE = 1, R_SOFT = 2, R_CONTACT = 3, R_UMBRA = 4, R_LIT = 5, R_CHG = 6, R_STATIC = 7;
const cl = (v) => (Number.isFinite(v) ? Math.min(Math.max(v, 0), 1) : 0);

/** history taps of frame f (compare.mjs dynFrame): best = max-weight valid bilinear tap, near = the valid tap whose
 * previous reference is closest (carries the reference history without counting sub-pixel resampling as change) */
function taps(f, ref, pref) {
  const best = new Int32Array(N).fill(-1), near = new Int32Array(N).fill(-1);
  if (f === 0 || m.frames[f].reset) return { best, near };
  const depth = readBuffer(capDir, f, 'depth'), pdepth = readBuffer(capDir, f - 1, 'depth');
  const mo = readBuffer(capDir, f, 'motion'), vz = readBuffer(capDir, f, 'viewz'), pvz = readBuffer(capDir, f - 1, 'viewz');
  const mz = hasMz ? readBuffer(capDir, f, 'motion_z') : null;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (!isScored(depth[i])) continue;
    const px = x - 0.5 * mo[2 * i] * W, py = y + 0.5 * mo[2 * i + 1] * H;
    const bx = Math.floor(px), by = Math.floor(py), fx = px - bx, fy = py - by;
    const zExp = vz[i] + (mz ? mz[i] : 0), tol = 0.02 * Math.abs(vz[i]);
    let dmin = Infinity, bestW = -1;
    for (let k = 0; k < 4; k++) {
      const qx = bx + (k & 1), qy = by + (k >> 1);
      const w = ((k & 1) ? fx : 1 - fx) * ((k >> 1) ? fy : 1 - fy);
      if (w <= 1e-3 || qx < 0 || qy < 0 || qx >= W || qy >= H) continue;
      const q = qy * W + qx;
      if (!isScored(pdepth[q]) || Math.abs(pvz[q] - zExp) > tol) continue;
      const d = Math.abs(ref[i] - pref[q]);
      if (d < dmin) { dmin = d; near[i] = q; }
      if (w > bestW) { bestW = w; best[i] = q; }
    }
  }
  return { best, near };
}

/** 5x5 mean occluder distance of the 1-ray samples that hit something (NaN with < 2 such samples) */
function occMean(f) {
  const out = new Float32Array(N).fill(NaN);
  if (!hasOcc) return out;
  const d = readBuffer(capDir, f, 'occluder_dist'), v = readBuffer(capDir, f, 'visibility');
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let s = 0, n = 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
      const j = yy * W + xx;
      if (v[j] < 0.5 && d[j] > 0) { s += d[j]; n++; }
    }
    if (n >= 2) out[y * W + x] = s / n;
  }
  return out;
}

const newAcc = () => ({
  sse: new Float64Array(NPH * REGIONS.length), n: new Float64Array(NPH * REGIONS.length), bias: new Float64Array(NPH * REGIONS.length),
  boil: new Float64Array(NPH * REGIONS.length), boilN: new Float64Array(NPH * REGIONS.length),
  sharp: new Float64Array(6), // [static out, static ref, changing out, changing ref, all out, all ref]
  lagE: new Float64Array(LAG_K), lagN: 0, arrive: [0, 0], leave: [0, 0],
  perFrame: [], perFrameChg: [], perFrameEdge: [],
  hist: [null, null], prevTapBest: null,
});

const sources = [{ name: 'noisy', get: (f) => readBuffer(capDir, f, 'visibility') }, { name: 'reference', get: (f) => readBuffer(capDir, f, 'visibility_ref') }];
for (const d of denoisers) {
  if (!existsSync(path.join(outRoot, d, frameDir(0), 'visibility.f32'))) { console.error(`skip ${d}: no visibility outputs`); continue; }
  sources.push({ name: d, get: (f) => readF32(path.join(outRoot, d, frameDir(f), 'visibility.f32')) });
}
const acc = Object.fromEntries(sources.map((s) => [s.name, newAcc()]));

let prevRef = null, prevTaps = null, lagHist = null;   // lagHist: N x LAG_K reprojected references (k = 0 is this frame)
let refHist = [null, null];
const speeds = [];
const regionPixels = new Float64Array(REGIONS.length);
for (let f = 0; f < F; f++) {
  const depth = readBuffer(capDir, f, 'depth'), ref = readBuffer(capDir, f, 'visibility_ref');
  const reset = f === 0 || m.frames[f].reset;
  const tp = reset ? taps(0, ref, ref) : taps(f, ref, prevRef);
  // reprojected reference history (along `near`)
  const lag = new Float32Array(N * LAG_K).fill(NaN);
  for (let i = 0; i < N; i++) {
    lag[i * LAG_K] = ref[i];
    const q = tp.near[i];
    if (q >= 0 && lagHist) for (let k = 1; k < LAG_K; k++) lag[i * LAG_K + k] = lagHist[q * LAG_K + k - 1];
  }
  // regions
  const g = gradMag(ref, depth, W, H);
  const core = new Uint8Array(N);
  for (let i = 0; i < N; i++) core[i] = isScored(depth[i]) && g[i] >= EDGE ? 1 : 0;
  const occ = occMean(f);
  const reg = new Uint16Array(N);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (!isScored(depth[i])) continue;
    let e = 0;
    for (let dy = -1; dy <= 1 && !e; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < W && yy < H && core[yy * W + xx]) { e = 1; break; }
    }
    const r = ref[i];
    let b = 1 << R_ALL;
    if (e) b |= 1 << R_EDGE; else if (r > 0.02 && r < 0.98) b |= 1 << R_SOFT; else if (r <= 0.02) b |= 1 << R_UMBRA; else b |= 1 << R_LIT;
    if ((e || (r > 0.02 && r < 0.98)) && occ[i] < CONTACT) b |= 1 << R_CONTACT;
    let lo = r, hi = r;
    for (let k = 1; k < DYN_K; k++) { const v = lag[i * LAG_K + k]; if (v === v) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }
    b |= hi - lo > DYN_DELTA ? 1 << R_CHG : 1 << R_STATIC;
    reg[i] = b;
    for (let k = 0; k < REGIONS.length; k++) if (b & (1 << k)) regionPixels[k]++;
    // edge speed (normal flow) on changing edge pixels
    if ((b & (1 << R_CHG)) && g[i] > 0.1 && lag[i * LAG_K + 1] === lag[i * LAG_K + 1] && speeds.length < 2e6 && (i % 7 === 0)) speeds.push(Math.abs(r - lag[i * LAG_K + 1]) / g[i]);
  }
  // reference second difference along the history (boil mask)
  const tap1 = prevTaps ? prevTaps.best : null;
  const ph = phaseOf(f);
  for (const s of sources) {
    const a = acc[s.name];
    const out = s.get(f);
    const go = gradMag(out, depth, W, H);
    if (reset) a.hist = [null, null];
    let fs = 0, fn = 0, cs = 0, cn = 0, es = 0, en = 0;
    for (let i = 0; i < N; i++) {
      const b = reg[i];
      if (!b) continue;
      const o = cl(out[i]), e = o - ref[i], e2 = e * e;
      const t = tp.best[i], t1 = t >= 0 && tap1 ? tap1[t] : -1;
      let boil = NaN;
      if (a.hist[1] && t >= 0 && t1 >= 0) {
        const rb = ref[i] - 2 * refHist[0][t] + refHist[1][t1];
        if (Math.abs(rb) < BOIL_REF_MAX) boil = o - 2 * a.hist[0][t] + a.hist[1][t1];
      }
      for (let k = 0; k < REGIONS.length; k++) {
        if (!(b & (1 << k))) continue;
        const j = ph * REGIONS.length + k;
        a.sse[j] += e2; a.n[j]++; a.bias[j] += e;
        if (boil === boil) { a.boil[j] += boil * boil; a.boilN[j]++; }
      }
      fs += e2; fn++;
      if (b & (1 << R_CHG)) { cs += e2; cn++; }
      if (b & (1 << R_EDGE)) { es += e2; en++; }
      if (g[i] > 0.1) {
        const c = b & (1 << R_CHG) ? 2 : 0;
        a.sharp[c] += go[i]; a.sharp[c + 1] += g[i]; a.sharp[4] += go[i]; a.sharp[5] += g[i];
      }
      // trailing
      if (b & (1 << R_CHG)) {
        let full = true;
        for (let k = 1; k < LAG_K; k++) if (!(lag[i * LAG_K + k] === lag[i * LAG_K + k])) { full = false; break; }
        if (full && (ph === 1 || ph === 3)) {
          for (let k = 0; k < LAG_K; k++) { const d = o - lag[i * LAG_K + k]; a.lagE[k] += d * d; }
          a.lagN++;
        }
        const r2 = lag[i * LAG_K + 2];
        if (r2 === r2) {
          const dr = ref[i] - r2;
          if (dr < -DYN_DELTA) { a.arrive[0] += e; a.arrive[1]++; } else if (dr > DYN_DELTA) { a.leave[0] += e; a.leave[1]++; }
        }
      }
    }
    const db = (x, n) => (n ? +(10 * Math.log10(1 / Math.max(x / n, 1e-12))).toFixed(3) : null);
    a.perFrame.push(db(fs, fn)); a.perFrameChg.push(db(cs, cn)); a.perFrameEdge.push(db(es, en));
    a.hist = [Float32Array.from(out, cl), a.hist[0]];
  }
  refHist = reset ? [Float32Array.from(ref), null] : [Float32Array.from(ref), refHist[0]];
  prevRef = ref; prevTaps = tp; lagHist = lag;
  if (!args.includes('--quiet') && f % 10 === 0) process.stderr.write(`${capName} frame ${f}/${F}\r`);
}

const PH_NAMES = SM ? ['frame0', 'move', 'hold', 'reverse', 'hold2'] : ['resets', 'rest'];
const dbOf = (e, n) => (n ? 10 * Math.log10(1 / Math.max(e / n, 1e-12)) : NaN);
function summarize(a) {
  const sumPh = (arr, k, phs) => phs.reduce((s, p) => s + arr[p * REGIONS.length + k], 0);
  const allPh = [...Array(NPH).keys()];
  const noReset = allPh.slice(1);
  const reg = {};
  REGIONS.forEach((r, k) => {
    reg[r] = {
      psnr: dbOf(sumPh(a.sse, k, allPh), sumPh(a.n, k, allPh)),
      bias: sumPh(a.bias, k, allPh) / Math.max(sumPh(a.n, k, allPh), 1),
      boil: Math.sqrt(sumPh(a.boil, k, noReset) / Math.max(sumPh(a.boilN, k, noReset), 1) / 6),
      pixelsPerFrame: Math.round(regionPixels[k] / F),
    };
  });
  const phases = {};
  PH_NAMES.forEach((p, ph) => {
    phases[p] = {};
    REGIONS.forEach((r, k) => {
      const j = ph * REGIONS.length + k;
      phases[p][r] = { psnr: dbOf(a.sse[j], a.n[j]), bias: a.n[j] ? a.bias[j] / a.n[j] : NaN, boil: a.boilN[j] ? Math.sqrt(a.boil[j] / a.boilN[j] / 6) : NaN, n: a.n[j] };
    });
  });
  // lag: argmin with parabolic refinement
  let lag = NaN;
  if (a.lagN) {
    let k = 0;
    for (let j = 1; j < LAG_K; j++) if (a.lagE[j] < a.lagE[k]) k = j;
    lag = k;
    if (k > 0 && k < LAG_K - 1) { const [y0, y1, y2] = [a.lagE[k - 1], a.lagE[k], a.lagE[k + 1]]; const den = y0 - 2 * y1 + y2; if (den > 0) lag = k + 0.5 * (y0 - y2) / den; }
  }
  const arrive = a.arrive[1] ? a.arrive[0] / a.arrive[1] : NaN, leave = a.leave[1] ? a.leave[0] / a.leave[1] : NaN;
  return {
    regions: reg, phases,
    sharpness: { all: a.sharp[4] / a.sharp[5], static: a.sharp[0] / a.sharp[1], changing: a.sharp[3] ? a.sharp[2] / a.sharp[3] : NaN },
    trailing: { lagFrames: lag, lagCurve: a.lagN ? Array.from(a.lagE, (x) => +(x / a.lagE[0]).toFixed(4)) : null, lagPixels: a.lagN / Math.max(F, 1), arrive, leave, trail: (arrive - leave) / 2 },
    perFrame: a.perFrame, perFrameChanging: a.perFrameChg, perFrameEdge: a.perFrameEdge,
  };
}
speeds.sort((x, y) => x - y);
const edgeSpeed = speeds.length ? speeds[Math.floor(speeds.length / 2)] : NaN;
const results = Object.fromEntries(sources.map((s) => [s.name, summarize(acc[s.name])]));
const outJson = { capture: capName, frames: F, width: W, height: H, contact: CONTACT, edge: EDGE, phases: PH_NAMES, edgeSpeedPxPerFrame: edgeSpeed, results };
const jsonPath = opt('json', path.join(outRoot, 'shadow-regions.json'));
writeFileSync(jsonPath, JSON.stringify(outJson, null, 1));

if (!args.includes('--quiet')) {
  const f2 = (x, k = 2) => (Number.isFinite(x) ? x.toFixed(k) : '–');
  const rows = [`# ${capName}: shadow regions (${W}x${H}, ${F} frames; edge speed ${f2(edgeSpeed, 2)} px/frame)`, '',
    `px/frame: ${REGIONS.map((r) => `${r} ${results.noisy.regions[r].pixelsPerFrame}`).join(', ')}`, '',
    '| source | all | edge | soft | contact | umbra bias | lit bias | changing | static | boil edge | boil soft | boil static | sharp static | sharp chg | lag f | trail |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|'];
  for (const [n, r] of Object.entries(results)) {
    const R = r.regions;
    rows.push(`| ${n} | ${f2(R.all.psnr)} | ${f2(R.edge.psnr)} | ${f2(R.soft.psnr)} | ${f2(R.contact.psnr)} | ${f2(R.umbra.bias, 4)} | ${f2(R.lit.bias, 4)} | ${f2(R.changing.psnr)} | ${f2(R.static.psnr)} | ${f2(R.edge.boil, 4)} | ${f2(R.soft.boil, 4)} | ${f2(R.static.boil, 4)} | ${f2(r.sharpness.static, 3)} | ${f2(r.sharpness.changing, 3)} | ${f2(r.trailing.lagFrames, 2)} | ${f2(r.trailing.trail, 4)} |`);
  }
  console.log(rows.join('\n'));
  console.log(`\nwrote ${jsonPath}`);
}
