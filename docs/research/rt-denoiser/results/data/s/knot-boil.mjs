#!/usr/bin/env node
// Track S (shadows) phase-1 scorer: motion-compensated boil per region on the moving-occluder captures, for each
// denoiser output, next to the clean reference's own boil (docs/research/rt-denoiser/tracks/s.md).
//
//   node docs/research/rt-denoiser/results/data/s/knot-boil.mjs <capture> <denoiser,...> [--json out.json] [--from 8]
//        [--rect x,y,w,h] [--dynK 8] [--dynDelta 0.06]
//
// History: per frame, every pixel's history tap is the max-weight valid tap of its bilinear reprojection footprint
// (capture motion; viewz within 2 %, as shadow-regions.mjs / compare.mjs), chained back over frames. Static camera:
// the same pixel; the knot's pixels follow its object motion.
// Regions (per frame, receivers = scored depth; reference R smoothed 3x3 for the region tests only):
//   object   pixels with object motion (|motion - camera-only motion| > 0.1 px): the knot itself
//   moving   moving shadow on static receivers: not object, R's range over the last dynK frames along the history > dynDelta
//   penumbra static penumbra: not object / moving, 0.02 < R < 0.98, history >= dynK frames
//   disocc   history younger than 8 frames (disocclusions, the knot's silhouette, frame-edge reveals; after frame 8)
//   rect     the knot's wall shadow rect of results/M4.md §12.1 (x 380, y 170, 200 x 190), not object (static captures)
// --interp bilinear (default): the history value is the bilinear resample over the valid taps (H below), so a smooth
// penumbra under sub-pixel camera motion has no resampling curvature; --interp nearest: the max-weight tap (the old
// compare.mjs / score-captures definition, which reads a gradient x the tap switch as "boil" on moving cameras).
// Metrics per region over frames >= --from (default 8, so every history is >= 8 frames except disocc):
//   boil     RMS of x_t - 2 x_t-1 + x_t-2 along the history / sqrt 6 (compare.mjs's definition), all pixels with a
//            2-frame history; boilG the same counted only where R's own second difference is < 0.02 (score-captures)
//   blob5 / blob15  boil of the output box-filtered over 5x5 / 15x15 receivers first (the low-frequency undulation the
//            eye sees as "boil"; pixel-scale noise averages out); refX = the reference's own on the same pixels
//   errBoil  RMS of (b_out - b_ref) / sqrt 6 (how far the output's frame-to-frame curvature is from the reference's)
//   d1       mean |x_t - x_t-1| along the history (how much the output moves per frame)
//   psnr     pooled PSNR vs R (values clamped to [0, 1]); bias = mean (out - R)
//   p99 / p999  99th / 99.9th percentile of |second difference| / sqrt 6 (pops: isolated jumps RMS averages away)
//   trail    moving region: (arrive - leave) / 2, arrive = mean (out - R) where R_t - R_t-2 < -0.02 (shadow arriving),
//            leave where > +0.02; > 0 = the output lags the moving shadow
import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { OUTPUTS_DIR, frameDir, invert, isScored, readBuffer, readF32, readManifest, resolveCapture, xform } from '../../../../../../tools/rt-capture/lib/capture.mjs';

const args = process.argv.slice(2);
const VALUE_OPTS = new Set(['json', 'from', 'rect', 'dynK', 'dynDelta', 'outputs', 'interp', 'debug', 'popmap', 'popThr']);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i < 0 ? d : args[i + 1]; };
const pos = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && VALUE_OPTS.has(args[i - 1].slice(2))));
const capDir = resolveCapture(pos[0]);
const capName = path.basename(capDir);
const dens = pos[1].split(',');
const outRoot = path.join(path.resolve(opt('outputs', OUTPUTS_DIR)), capName);
const FROM = Number(opt('from', 8)), DYN_K = Number(opt('dynK', 8)), DYN_D = Number(opt('dynDelta', 0.06));
const m = readManifest(capDir);
const W = m.width, H = m.height, N = W * H, F = m.frames.length;
const rectArg = opt('rect', capName.includes('knot-static') || capName.includes('knot-still') ? '380,170,200,190' : '');
const RECT = rectArg ? rectArg.split(',').map(Number) : null;
const hasMz = m.buffers.some((b) => b.name === 'motion_z');
const cl = (v) => (Number.isFinite(v) ? Math.min(Math.max(v, 0), 1) : 0);

function boxBlur(x, mask, r) {
  // masked box filter (receivers only), separable sums
  const t = new Float32Array(N), tw = new Float32Array(N), o = new Float32Array(N);
  for (let y = 0; y < H; y++) {
    let s = 0, sw = 0;
    const row = y * W;
    for (let k = -r; k <= r; k++) { const xx = Math.min(Math.max(k, 0), W - 1); if (k >= 0 && mask[row + xx]) { s += x[row + xx]; sw++; } }
    for (let xx = 0; xx < W; xx++) {
      t[row + xx] = s; tw[row + xx] = sw;
      const a = xx - r, b = xx + r + 1;
      if (a >= 0 && mask[row + a]) { s -= x[row + a]; sw--; }
      if (b < W && mask[row + b]) { s += x[row + b]; sw++; }
    }
  }
  for (let xx = 0; xx < W; xx++) {
    let s = 0, sw = 0;
    for (let k = 0; k <= r && k < H; k++) { s += t[k * W + xx]; sw += tw[k * W + xx]; }
    for (let y = 0; y < H; y++) {
      const i = y * W + xx;
      o[i] = mask[i] && sw > 0 ? s / sw : x[i];
      const a = y - r, b = y + r + 1;
      if (a >= 0) { s -= t[a * W + xx]; sw -= tw[a * W + xx]; }
      if (b < H) { s += t[b * W + xx]; sw += tw[b * W + xx]; }
    }
  }
  return o;
}

// ---- per-frame guides: history taps, receivers, object mask
const tapsOf = [], recv = [], objOf = [], bilQ = [], bilW = [];
const INTERP = opt('interp', 'bilinear');
for (let f = 0; f < F; f++) {
  const depth = readBuffer(capDir, f, 'depth');
  const mask = new Uint8Array(N);
  for (let i = 0; i < N; i++) mask[i] = isScored(depth[i]) ? 1 : 0;
  recv.push(mask);
  const best = new Int32Array(N).fill(-1), obj = new Uint8Array(N);
  const bq = new Int32Array(4 * N).fill(-1), bw = new Float32Array(4 * N);
  if (f > 0 && !m.frames[f].reset) {
    const fr = m.frames[f], cam = fr.camera;
    const pdepth = readBuffer(capDir, f - 1, 'depth');
    const mo = readBuffer(capDir, f, 'motion'), vz = readBuffer(capDir, f, 'viewz'), pvz = readBuffer(capDir, f - 1, 'viewz');
    const mz = hasMz ? readBuffer(capDir, f, 'motion_z') : null;
    const viewInv = invert(cam.view);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!mask[i]) continue;
      // camera-only motion (NDC delta cur - prev) from the matrices
      const nx = ((x + 0.5) / W) * 2 - 1, ny = 1 - ((y + 0.5) / H) * 2;
      const z = vz[i];
      const Xv = [-z * (nx + cam.projection[8]) / cam.projection[0], -z * (ny + cam.projection[9]) / cam.projection[5], z];
      const Wp = xform(viewInv, Xv[0], Xv[1], Xv[2]);
      const Pv = xform(cam.prevView, Wp[0], Wp[1], Wp[2]);
      const Pc = xform(cam.prevProjection, Pv[0], Pv[1], Pv[2], 1);
      const cmx = nx - Pc[0] / Pc[3], cmy = ny - Pc[1] / Pc[3];
      const dpx = Math.hypot((mo[2 * i] - cmx) * W * 0.5, (mo[2 * i + 1] - cmy) * H * 0.5);
      if (dpx > 0.1) obj[i] = 1;
      const px = x - 0.5 * mo[2 * i] * W, py = y + 0.5 * mo[2 * i + 1] * H;
      const bx = Math.floor(px), by = Math.floor(py), fx = px - bx, fy = py - by;
      const zExp = vz[i] + (mz ? mz[i] : 0), tol = 0.02 * Math.abs(vz[i]);
      let bestW = -1;
      for (let k = 0; k < 4; k++) {
        const qx = bx + (k & 1), qy = by + (k >> 1);
        const w = ((k & 1) ? fx : 1 - fx) * ((k >> 1) ? fy : 1 - fy);
        if (w <= 1e-3 || qx < 0 || qy < 0 || qx >= W || qy >= H) continue;
        const q = qy * W + qx;
        if (!isScored(pdepth[q]) || Math.abs(pvz[q] - zExp) > tol) continue;
        if (w > bestW) { bestW = w; best[i] = q; }
        bq[4 * i + k] = q; bw[4 * i + k] = w;
      }
      let sw = bw[4 * i] + bw[4 * i + 1] + bw[4 * i + 2] + bw[4 * i + 3];
      if (sw > 0) for (let k = 0; k < 4; k++) bw[4 * i + k] /= sw;
    }
  }
  tapsOf.push(best); bilQ.push(bq); bilW.push(bw);
  objOf.push(obj);
}
/** x (frame f-1 grid) resampled at frame f's pixels along the history (bilinear over valid taps, or the max-weight
 * tap with --interp nearest); NaN where there is no valid tap */
function histOp(f, x) {
  const o = new Float32Array(N).fill(NaN), bq = bilQ[f], bw = bilW[f], best = tapsOf[f];
  if (INTERP === 'nearest') { for (let i = 0; i < N; i++) if (best[i] >= 0) o[i] = x[best[i]]; return o; }
  for (let i = 0; i < N; i++) {
    if (best[i] < 0) continue;
    let v = 0;
    for (let k = 0; k < 4; k++) { const q = bq[4 * i + k]; if (q >= 0 && bw[4 * i + k] > 0) v += bw[4 * i + k] * x[q]; }
    o[i] = v;
  }
  return o;
}
// history age along the chain
const ageOf = [];
for (let f = 0; f < F; f++) {
  const a = new Int16Array(N);
  for (let i = 0; i < N; i++) { const q = tapsOf[f][i]; a[i] = q < 0 ? 0 : Math.min(ageOf[f - 1][q] + 1, 999); }
  ageOf.push(a);
}

// ---- reference and regions
const ref = [], refS = [];
for (let f = 0; f < F; f++) {
  ref.push(readBuffer(capDir, f, 'visibility_ref').map(cl));
  refS.push(boxBlur(ref[f], recv[f], 1));
}
const REG = ['all', 'moving', 'penumbra', 'disocc', 'object', ...(RECT ? ['rect'] : [])];
const regionOf = [];
for (let f = 0; f < F; f++) {
  const rg = new Uint8Array(N); // bit per region
  for (let i = 0; i < N; i++) {
    if (!recv[f][i]) continue;
    let b = 1;
    const age = ageOf[f][i];
    if (objOf[f][i]) b |= 16;
    else {
      // range of the smoothed reference along the history
      let lo = refS[f][i], hi = lo, q = i, k = 0;
      for (let g = f; g > 0 && k < DYN_K; g--, k++) { q = tapsOf[g][q]; if (q < 0) break; const v = refS[g - 1][q]; lo = Math.min(lo, v); hi = Math.max(hi, v); }
      if (hi - lo > DYN_D) b |= 2;
      else if (age >= DYN_K && refS[f][i] > 0.02 && refS[f][i] < 0.98) b |= 4;
      if (RECT) { const x = i % W, y = (i / W) | 0; if (x >= RECT[0] && x < RECT[0] + RECT[2] && y >= RECT[1] && y < RECT[1] + RECT[3]) b |= 32; }
    }
    if (age < 8 && f >= 8) b |= 8;
    rg[i] = b;
  }
  regionOf.push(rg);
}

function score(name) {
  const isRef = name === 'ref';
  const dir = path.join(outRoot, name);
  const load = (f) => (isRef ? ref[f] : readF32(path.join(dir, frameDir(f), 'visibility.f32')).map(cl));
  if (!isRef && !existsSync(path.join(dir, frameDir(0), 'visibility.f32'))) throw new Error(`no outputs in ${dir}`);
  const X = [], B5 = [], B15 = [];
  const R5 = [], R15 = [];
  for (let f = 0; f < F; f++) {
    X.push(load(f));
    B5.push(boxBlur(X[f], recv[f], 2)); B15.push(boxBlur(X[f], recv[f], 7));
    R5.push(boxBlur(ref[f], recv[f], 2)); R15.push(boxBlur(ref[f], recv[f], 7));
  }
  // second difference along the history: x_f - 2 H_f(x_f-1) + H_f(H_f-1(x_f-2))
  const sd = (A, f) => { const h1 = histOp(f, A[f - 1]), h2 = histOp(f, histOp(f - 1, A[f - 2])); const o = new Float32Array(N); for (let i = 0; i < N; i++) o[i] = A[f][i] - 2 * h1[i] + h2[i]; return [o, h1]; };
  const pops = new Uint16Array(N);
  const acc = REG.map(() => ({ n: 0, b2: 0, nG: 0, bG2: 0, r2: 0, rG2: 0, e2: 0, bl5: 0, rl5: 0, bl15: 0, rl15: 0, d1: 0, nd: 0, se: 0, bias: 0, ne: 0, arr: 0, na: 0, lea: 0, nl: 0, abs: [] }));
  for (let f = FROM; f < F; f++) {
    const x = X[f], r = ref[f], rg = regionOf[f], t1 = tapsOf[f];
    const [SX, HX] = sd(X, f), [SR] = sd(ref, f), [S5] = sd(B5, f), [SR5] = sd(R5, f), [S15] = sd(B15, f), [SR15] = sd(R15, f);
    for (let i = 0; i < N; i++) {
      const b = rg[i];
      if (!b) continue;
      const e = x[i] - r[i];
      const q1 = t1[i];
      let bo = NaN, br = NaN, b5 = NaN, r5 = NaN, b15 = NaN, r15 = NaN, d1 = NaN, dr2 = NaN;
      if (q1 >= 0) {
        d1 = Math.abs(x[i] - HX[i]);
        const q2 = tapsOf[f - 1][q1];
        if (q2 >= 0 && Number.isFinite(SX[i])) {
          bo = SX[i]; br = SR[i]; b5 = S5[i]; r5 = SR5[i]; b15 = S15[i]; r15 = SR15[i];
          dr2 = refS[f][i] - refS[f - 2][q2];
        }
      }
      if (Number.isFinite(bo) && Math.abs(bo) > POP_THR && !(b & 16)) pops[i]++;
      for (let k = 0; k < REG.length; k++) {
        if (!(b & (1 << k))) continue;
        const a = acc[k];
        a.se += e * e; a.bias += e; a.ne++;
        if (Number.isFinite(d1)) { a.d1 += d1; a.nd++; }
        if (Number.isFinite(bo)) {
          a.n++; a.b2 += bo * bo; a.abs.push(Math.abs(bo)); a.r2 += br * br; a.e2 += (bo - br) ** 2;
          a.bl5 += b5 * b5; a.rl5 += r5 * r5; a.bl15 += b15 * b15; a.rl15 += r15 * r15;
          if (Math.abs(br) < 0.02) { a.nG++; a.bG2 += bo * bo; a.rG2 += br * br; }
          if (dr2 < -0.02) { a.arr += e; a.na++; } else if (dr2 > 0.02) { a.lea += e; a.nl++; }
        }
      }
    }
  }
  const s6 = (v, n) => (n ? Math.sqrt(v / n / 6) : NaN);
  const out = {};
  REG.forEach((rn, k) => {
    const a = acc[k];
    const sorted = Float32Array.from(a.abs).sort();
    const pct = (q) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] / Math.sqrt(6) : NaN);
    out[rn] = {
      p99: pct(0.99), p999: pct(0.999),
      px: Math.round(a.ne / Math.max(F - FROM, 1)),
      psnr: a.ne ? 10 * Math.log10(1 / Math.max(a.se / a.ne, 1e-12)) : NaN,
      bias: a.ne ? a.bias / a.ne : NaN,
      boil: s6(a.b2, a.n), refBoil: s6(a.r2, a.n),
      boilG: s6(a.bG2, a.nG), refBoilG: s6(a.rG2, a.nG),
      blob5: s6(a.bl5, a.n), refBlob5: s6(a.rl5, a.n),
      blob15: s6(a.bl15, a.n), refBlob15: s6(a.rl15, a.n),
      errBoil: s6(a.e2, a.n),
      d1: a.nd ? a.d1 / a.nd : NaN,
      trail: a.na && a.nl ? (a.arr / a.na - a.lea / a.nl) / 2 : NaN,
    };
  });
  popMaps.push(pops);
  return out;
}

/** --debug a,b: outputs of debugStabilize runs (2 + value in the penumbra tiles, 0 elsewhere): per region the share of
 * pixels covered, the mean value, and the shares >= 0.99 (weight: not stabilized) and < 0.25 (age: A < 4 of 15) */
function debugStats(name) {
  const pops = new Uint16Array(N);
  const acc = REG.map(() => ({ n: 0, c: 0, s: 0, hi: 0, lo: 0 }));
  for (let f = FROM; f < F; f++) {
    const x = readF32(path.join(outRoot, name, frameDir(f), 'visibility.f32')), rg = regionOf[f];
    for (let i = 0; i < N; i++) {
      const b = rg[i];
      if (!b) continue;
      for (let k = 0; k < REG.length; k++) {
        if (!(b & (1 << k))) continue;
        const a = acc[k];
        a.n++;
        if (x[i] >= 1.999) { const v = x[i] - 2; a.c++; a.s += v; if (v >= 0.99) a.hi++; if (v < 0.25) a.lo++; }
      }
    }
  }
  return Object.fromEntries(REG.map((rn, k) => { const a = acc[k]; return [rn, { covered: a.c / Math.max(a.n, 1), mean: a.s / Math.max(a.c, 1), hi: a.hi / Math.max(a.c, 1), lo: a.lo / Math.max(a.c, 1) }]; }));
}
const POP_THR = Number(opt('popThr', 0.1));
const popMaps = [];
const dbgList = opt('debug') ? opt('debug').split(',') : [];
if (dbgList.length) {
  for (const d of dbgList) {
    const st = debugStats(d);
    for (const rn of REG) console.log(`${capName} debug ${d} / ${rn}: covered ${st[rn].covered.toFixed(3)} mean ${st[rn].mean.toFixed(3)} >=0.99 ${st[rn].hi.toFixed(3)} <0.25 ${st[rn].lo.toFixed(3)}`);
  }
  process.exit(0);
}
const res = { capture: capName, interp: INTERP, from: FROM, dynK: DYN_K, dynDelta: DYN_D, rect: RECT, denoisers: {} };
for (const d of ['ref', ...dens]) res.denoisers[d] = score(d);
const f4 = (v) => (Number.isFinite(v) ? v.toFixed(4) : '–');
const f2 = (v) => (Number.isFinite(v) ? v.toFixed(2) : '–');
for (const rn of REG) {
  console.log(`\n${capName} / ${rn} (${res.denoisers.ref[rn].px} px/frame)`);
  console.log('denoiser'.padEnd(14), 'psnr   bias     boil    boilG   blob5   blob15  errBoil d1      trail   p99     p999');
  for (const [d, s] of Object.entries(res.denoisers)) {
    const r = s[rn];
    console.log(d.padEnd(14), f2(r.psnr).padEnd(6), f4(r.bias).padStart(7), f4(r.boil), f4(r.boilG), f4(r.blob5), f4(r.blob15), f4(r.errBoil), f4(r.d1), f4(r.trail), f4(r.p99), f4(r.p999));
  }
}
if (opt('json')) writeFileSync(opt('json'), JSON.stringify(res, null, 1));
if (opt('popmap')) {
  // per screen pixel, frames >= --from with |second difference along the history| > --popThr (not on the knot);
  // panels: ref, then each denoiser; white = none, black = >= 6
  const K = popMaps.length, OW = K * W, img = Buffer.alloc((OW * 3 + 1) * H), d0 = readBuffer(capDir, F - 1, 'depth');
  for (let y = 0; y < H; y++) for (let k = 0; k < K; k++) for (let x = 0; x < W; x++) {
    const i = y * W + x, o = y * (OW * 3 + 1) + 1 + (k * W + x) * 3, c = popMaps[k][i];
    const g = isScored(d0[i]) ? 255 - Math.round(255 * Math.min(c / 6, 1)) : 215;
    img[o] = c ? g : (isScored(d0[i]) ? 255 : 215); img[o + 1] = g; img[o + 2] = g;
  }
  const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
  const crc = (b) => { let c = -1; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(OW, 0); ih.writeUInt32BE(H, 4); ih[8] = 8; ih[9] = 2;
  writeFileSync(opt('popmap'), Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(img)), chunk('IEND', Buffer.alloc(0))]));
  console.log('pop counts (|b| > ' + POP_THR + ', not on the knot):', Object.keys(res.denoisers).map((d, k) => d + ' ' + popMaps[k].reduce((a, b) => a + b, 0)).join(', '));
}
