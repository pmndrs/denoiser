#!/usr/bin/env node
// Track D calm / lag scorer (tracks/d.md; our tool). Scores replay outputs of a capture per region, motion-compensated:
//
//   chain    per pixel, the previous-frame tap = the highest-bilinear-weight texel of the 2x2 motion footprint whose viewZ
//            passes the plane test (|z_prev - (z + motion_z)| <= 1 % |z| + 2 x local slope), as results/data/t1-score.mjs;
//            age = frames of valid chain (0 at a reset / disocclusion), tap of the tap = the t-2 sample
//   value    channel mean of Reinhard x/(1+x) (radiance) or clamp [0,1] (ao), as compare.mjs / t1-score
//   regions  (pixels with a 2-step chain; ages < 2 have none)
//            disocc   age 2..7 (history younger than 8 frames: disocclusions, reset ramps)
//            edge     age >= 8 within 2 px of a depth edge (resampling at silhouettes)
//            dynamic  age >= 8, not edge, the 3x3-median reference changes along the chain by > --tau (0.02) in either step
//                     (moving shadows / lighting: the legitimate change)
//            static   the rest
//   boil     RMS of the second temporal difference along the chain / sqrt(6): out (`boil`), reference (`refBoil`, its
//            noise floor) and error out - ref (`errBoil`: undulation that is not in the reference; the dynamic region's
//            number, where the reference's own boil is legitimate change)
//   flicker  mean |e_t - e_{t-1}| along the chain (motion-compensated)
//   per frame  MSE over all scored pixels (for lag: frames after a reset until the error stays within 10 % of the settled
//            level, see lag.mjs) and per region
//   stillSigma  still camera only (every frame's view matrix equal): per-pixel temporal standard deviation of the value over frames
//            >= --still-from (8), mean over pixels, x 255 (8-bit levels after the tonemap), out and reference
//
//   node calm.mjs <capture> --den a,b [--signals diffuse,ao,specular] [--outputs <root>] [--tau 0.02] [--json out.json]
//   noisy input is scored as 'noisy' for signals that have an input buffer (diffuse, specular)
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const REPO = new URL('../../../../../../', import.meta.url).pathname.replace(/\/$/, '');
const cap = await import(`${REPO}/tools/rt-capture/lib/capture.mjs`);

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i < 0 ? d : args[i + 1]; };
const capName = args[0];
const capDir = cap.resolveCapture(capName);
const outRoot = path.join(path.resolve(opt('outputs', cap.OUTPUTS_DIR)), path.basename(capDir));
const dens = opt('den', '').split(',').filter(Boolean);
const m = cap.readManifest(capDir);
const W = m.width, H = m.height, N = W * H, F = m.frames.length;
const chOf = Object.fromEntries(m.buffers.map((b) => [b.name, b.channels]));
const TAU = Number(opt('tau', 0.02));
const STILL_FROM = Number(opt('still-from', 8));
const YOUNG = 8;
const REG = ['static', 'dynamic', 'edge', 'disocc'];
const signals = opt('signals', 'diffuse,ao').split(',').filter((s) => chOf[`${s}_ref`]);
// still camera (manifest.static means a static scene, not a still camera): every frame's view equals frame 0's
const isStatic = m.frames.every((fr) => fr.camera.view.every((v, k) => Math.abs(v - m.frames[0].camera.view[k]) < 1e-9));

const tm = (x, ch) => (ch === 1 ? Math.min(Math.max(x, 0), 1) : x > 0 ? x / (1 + x) : 0);
const finite = (x) => (Number.isFinite(x) ? x : 0);
const newReg = () => ({ n: 0, sse: 0, sseN: 0, boil: 0, refBoil: 0, errBoil: 0, flk: 0 });

const densOf = {}, acc = {}, hist = {}, refHist = {}, still = {};
for (const s of signals) {
  densOf[s] = dens.filter((d) => existsSync(path.join(outRoot, d, cap.frameDir(0), `${s}.f32`)));
  const missing = dens.filter((d) => !densOf[s].includes(d));
  if (missing.length) console.error(`${capName} ${s}: no outputs for ${missing.join(', ')}`);
  for (const d of [...(chOf[s] ? ['noisy'] : []), ...densOf[s], 'ref']) {
    acc[`${s}|${d}`] = { reg: Object.fromEntries(REG.map((r) => [r, newReg()])), frames: [] };
    if (isStatic) still[`${s}|${d}`] = { s1: new Float64Array(N), s2: new Float64Array(N), n: 0 };
  }
}

let prevAge = null, prevVz = null, tapPrev = null, resetFrame = 0;
for (let f = 0; f < F; f++) {
  const reset = f === 0 || !!m.frames[f].reset;
  if (reset) resetFrame = f;
  const depth = cap.readBuffer(capDir, f, 'depth');
  const vz = cap.readBuffer(capDir, f, 'viewz');
  const scored = new Uint8Array(N);
  for (let i = 0; i < N; i++) scored[i] = depth[i] > 0 && depth[i] < 1 ? 1 : 0;
  const slope = new Float32Array(N), edge = new Uint8Array(N);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, z = vz[i];
    const zl = vz[y * W + Math.max(x - 1, 0)], zr = vz[y * W + Math.min(x + 1, W - 1)];
    const zu = vz[Math.max(y - 1, 0) * W + x], zd = vz[Math.min(y + 1, H - 1) * W + x];
    slope[i] = Math.max(Math.min(Math.abs(zr - z), Math.abs(z - zl)), Math.min(Math.abs(zd - z), Math.abs(z - zu)));
    const jump = Math.max(Math.abs(zr - z), Math.abs(z - zl), Math.abs(zd - z), Math.abs(z - zu));
    if (scored[i] && jump > 0.05 * Math.abs(z) && jump > 4 * slope[i] + 1e-4) edge[i] = 1;
  }
  const band = new Uint8Array(N);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!edge[y * W + x]) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const qx = x + dx, qy = y + dy;
      if (qx >= 0 && qy >= 0 && qx < W && qy < H) band[qy * W + qx] = 1;
    }
  }
  const age = new Float32Array(N), tap = new Int32Array(N).fill(-1);
  if (!reset) {
    const mo = cap.readBuffer(capDir, f, 'motion');
    const mz = chOf.motion_z ? cap.readBuffer(capDir, f, 'motion_z') : null;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!scored[i]) continue;
      const px = x + 0.5 - 0.5 * mo[2 * i] * W - 0.5, py = y + 0.5 + 0.5 * mo[2 * i + 1] * H - 0.5;
      const bx = Math.floor(px), by = Math.floor(py), fx = px - bx, fy = py - by;
      const exp = vz[i] + (mz ? mz[i] : 0), tol = 0.01 * Math.abs(vz[i]) + 2 * slope[i] + 1e-4;
      let bestW = -1;
      for (let k = 0; k < 4; k++) {
        const qx = bx + (k & 1), qy = by + (k >> 1);
        if (qx < 0 || qy < 0 || qx >= W || qy >= H) continue;
        const w = ((k & 1) ? fx : 1 - fx) * ((k >> 1) ? fy : 1 - fy);
        const q = qy * W + qx;
        if (Math.abs(prevVz[q] - exp) <= tol && w > bestW) { bestW = w; tap[i] = q; age[i] = Math.min(prevAge[q] + 1, 65535); }
      }
    }
  }
  for (const s of signals) {
    const rch = chOf[`${s}_ref`];
    const ref = cap.readBuffer(capDir, f, `${s}_ref`);
    const refS = new Float32Array(N);
    for (let i = 0; i < N; i++) { let v = 0; for (let c = 0; c < rch; c++) v += tm(ref[i * rch + c], rch); refS[i] = v / rch; }
    // 3x3 median of the reference value over scored pixels (classification only: robust to the reference's own
    // heavy-tailed noise, e.g. sun paths through gaps)
    const box = new Float32Array(N), nb = new Float32Array(9);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!scored[i]) continue;
      let c = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const qx = x + dx, qy = y + dy;
        if (qx < 0 || qy < 0 || qx >= W || qy >= H) continue;
        const q = qy * W + qx;
        if (scored[q]) nb[c++] = refS[q];
      }
      const v = nb.subarray(0, c).sort();
      box[i] = c & 1 ? v[c >> 1] : 0.5 * (v[(c >> 1) - 1] + v[c >> 1]);
    }
    const rh = refHist[s];
    // region per pixel (-1 = no 2-step chain)
    const region = new Int8Array(N).fill(-1);
    for (let i = 0; i < N; i++) {
      if (!scored[i]) continue;
      const q = tap[i];
      if (q < 0 || !rh || !rh.box1) continue;
      const q2 = tapPrev ? tapPrev[q] : -1;
      if (q2 < 0 || !rh.box2) continue;
      if (age[i] < YOUNG) region[i] = 3;
      else if (band[i]) region[i] = 2;
      else if (Math.abs(box[i] - rh.box1[q]) > TAU || Math.abs(rh.box1[q] - rh.box2[q2]) > TAU) region[i] = 1;
      else region[i] = 0;
    }
    for (const d of [...(chOf[s] ? ['noisy'] : []), ...densOf[s], 'ref']) {
      const key = `${s}|${d}`;
      const a = acc[key];
      let o3, och;
      if (d === 'ref') { o3 = ref; och = rch; }
      else if (d === 'noisy') { o3 = cap.readBuffer(capDir, f, s); och = chOf[s]; }
      else { o3 = cap.readF32(path.join(outRoot, d, cap.frameDir(f), `${s}.f32`)); och = o3.length / N; }
      const outS = new Float32Array(N), err = new Float32Array(N);
      const h = hist[key];
      const fr = { f, rel: f - resetFrame, sse: 0, n: 0, reg: REG.map(() => [0, 0]) };
      for (let i = 0; i < N; i++) {
        if (!scored[i]) continue;
        let e2 = 0, es = 0, os = 0;
        for (let c = 0; c < rch; c++) {
          const ov = tm(finite(o3[i * och + Math.min(c, och - 1)]), rch), e = ov - tm(ref[i * rch + c], rch);
          e2 += e * e; es += e; os += ov;
        }
        es /= rch; os /= rch;
        outS[i] = os; err[i] = es;
        fr.sse += e2; fr.n += rch;
        const r = region[i];
        if (r < 0) continue;
        fr.reg[r][0] += e2; fr.reg[r][1] += rch;
        const R = a.reg[REG[r]];
        const q = tap[i], q2 = tapPrev[q];
        R.n++; R.sse += e2; R.sseN += rch;
        const bo = os - 2 * h.o1[q] + h.o2[q2];
        const br = refS[i] - 2 * rh.r1[q] + rh.r2[q2];
        const be = es - 2 * h.e1[q] + h.e2[q2];
        R.boil += bo * bo; R.refBoil += br * br; R.errBoil += be * be; R.flk += Math.abs(es - h.e1[q]);
      }
      a.frames.push(fr);
      hist[key] = reset ? { o1: outS, e1: err } : { o1: outS, e1: err, o2: h?.o1, e2: h?.e1 };
      if (isStatic && f >= STILL_FROM) { const st = still[key]; for (let i = 0; i < N; i++) { st.s1[i] += outS[i]; st.s2[i] += outS[i] * outS[i]; } st.n++; }
    }
    refHist[s] = reset ? { r1: refS, box1: box } : { r1: refS, box1: box, r2: rh?.r1, box2: rh?.box1 };
    if (isStatic && f === F - 1) refHist[s].scored = scored;
  }
  tapPrev = tap; prevAge = age; prevVz = vz;
  process.stderr.write(`\r${capName} frame ${f + 1}/${F}`);
}
process.stderr.write('\n');

const res = { capture: capName, width: W, height: H, frames: F, static: isStatic, tau: TAU, resets: m.frames.map((x, i) => (i === 0 || x.reset ? i : -1)).filter((i) => i >= 0), signals, rows: {} };
for (const [key, a] of Object.entries(acc)) {
  const reg = {};
  for (const r of REG) {
    const R = a.reg[r];
    reg[r] = {
      pxPerFrame: R.n / Math.max(1, F - 2),
      psnr: R.sseN ? 10 * Math.log10(R.sseN / Math.max(R.sse, 1e-12)) : null,
      boil: R.n ? Math.sqrt(R.boil / R.n / 6) : null,
      refBoil: R.n ? Math.sqrt(R.refBoil / R.n / 6) : null,
      errBoil: R.n ? Math.sqrt(R.errBoil / R.n / 6) : null,
      flicker: R.n ? R.flk / R.n : null,
    };
  }
  const row = { reg, perFrameMse: a.frames.map((x) => x.sse / x.n), perFrameRegMse: a.frames.map((x) => x.reg.map(([e, n]) => (n ? e / n : null))) };
  if (isStatic) {
    const st = still[key];
    let sum = 0, c = 0;
    const sc = refHist[key.split('|')[0]].scored;
    for (let i = 0; i < N; i++) {
      if (!sc[i]) continue;
      const mu = st.s1[i] / st.n;
      sum += Math.sqrt(Math.max(0, st.s2[i] / st.n - mu * mu)); c++;
    }
    row.stillSigma255 = (255 * sum) / c;
  }
  res.rows[key] = row;
}
const jout = opt('json', path.join(path.dirname(new URL(import.meta.url).pathname), 'scores', `${capName}.json`));
mkdirSync(path.dirname(jout), { recursive: true });
writeFileSync(jout, JSON.stringify(res));
console.log(`wrote ${jout}`);
