#!/usr/bin/env node
// T1 recovery scorer (results/T1-recovery.md): scores replay outputs of a capture by pixel *age*
// (frames of valid history, ground truth), so recovery after a reset / disocclusion can be read as a
// curve. Our tool (target 1 evaluator); same conventions as tools/rt-capture/compare.mjs and the test
// bed's metrics.ts:
//
//   age      0 on a reset frame and where no previous texel of the 2x2 footprint has viewZ within
//            1 % |z| + 2 x the robust local z slope of the expected previous viewZ (viewz + motion_z),
//            else age(best-weight valid tap) + 1 (metrics.ts AGE_WGSL on the CPU)
//   value    diffuse / specular: Reinhard x/(1+x) per channel; visibility: clamp [0, 1] (compare.mjs)
//   regions  per age bucket 0..16 and 17 = "old" (>= 17); young = age < 8 (the test bed's "disoccluded");
//            edge = pixels within 2 px of a depth edge (4-neighbour |dz| > 5 % |z| and > 4x the robust
//            slope), reported for young and for all ages
//   energy   sum of linear luminance (visibility: value) of output / reference per region
//   flicker  mean |e_t - e_{t-1}| (signed error, channel mean), previous error at the age tap
//   boil     RMS of the output's second temporal difference along the age taps / sqrt(6) (compare.mjs);
//            the reference's own boil in the same pixels as `refBoil` (its noise floor)
//   FLIP     LDR-FLIP (examples/realtime-denoiser/src/flip.ts) every --flip-every frames, mean over young
//            pixels and over all receivers, at the test bed's ppd (46.4 deg across the image)
//
//   node t1-score.mjs <capture> --den a,b,c [--signals diffuse,specular,visibility] [--outputs <root>]
//        [--flip-every 2] [--json out.json]
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const REPO = new URL('../../../../../', import.meta.url).pathname.replace(/\/$/, ''); // repo root (this file: docs/research/rt-denoiser/results/data/)
const cap = await import(`${REPO}/tools/rt-capture/lib/capture.mjs`);
const flip = await import(`${REPO}/examples/realtime-denoiser/src/flip.ts`);

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i < 0 ? d : args[i + 1]; };
const capName = args[0];
const capDir = cap.resolveCapture(capName);
const outRoot = path.join(path.resolve(opt('outputs', cap.OUTPUTS_DIR)), path.basename(capDir));
const dens = opt('den', '').split(',').filter(Boolean);
const m = cap.readManifest(capDir);
const W = m.width, H = m.height, N = W * H, F = m.frames.length;
const chOf = Object.fromEntries(m.buffers.map((b) => [b.name, b.channels]));
const signals = opt('signals', 'diffuse,specular,visibility').split(',').filter((s) => chOf[s] && chOf[`${s}_ref`]);
const FLIP_EVERY = Number(opt('flip-every', 2));
const PPD = W / 46.4;
const NA = 18; // age buckets 0..16, 17 = old
const YOUNG = 8;

const tm = (x, ch) => (ch === 1 ? Math.min(Math.max(x, 0), 1) : x > 0 ? x / (1 + x) : 0);
const lumOf = (a, i, ch) => (ch === 1 ? a[i] : 0.2126 * a[3 * i] + 0.7152 * a[3 * i + 1] + 0.0722 * a[3 * i + 2]);
const finite = (x) => (Number.isFinite(x) ? x : 0);

function newAcc() {
  const z = () => new Float64Array(NA);
  return {
    sse: z(), cnt: z(), lpSse: z(), lpCnt: z(), midSse: z(), lumO: z(), lumR: z(), flk: z(), flkN: z(), boil: z(), boilN: z(), refBoil: z(),
    edgeYoungSse: 0, edgeYoungCnt: 0, edgeSse: 0, edgeCnt: 0,
    frames: [], // per frame: { f, rel, allSse, allCnt, youngSse, youngCnt, youngPx, flipAll, flipYoung, youngLumO, youngLumR }
  };
}

let prevAge = null, prevVz = null, tapPrev = null;
let resetFrame = 0;
const acc = {};
const hist = {}; // key -> [out_t-1 scalar, out_t-2 scalar, err_t-1]
const densOf = {};
for (const s of signals) {
  densOf[s] = dens.filter((d) => existsSync(path.join(outRoot, d, cap.frameDir(0), `${s}.f32`)));
  for (const d of ['noisy', ...densOf[s]]) acc[`${s}|${d}`] = newAcc();
}
const refHist = {};

for (let f = 0; f < F; f++) {
  const reset = f === 0 || !!m.frames[f].reset;
  if (reset) resetFrame = f;
  const depth = cap.readBuffer(capDir, f, 'depth');
  const vz = cap.readBuffer(capDir, f, 'viewz');
  const age = new Float32Array(N);
  const tap = new Int32Array(N).fill(-1);
  const scored = new Uint8Array(N);
  for (let i = 0; i < N; i++) scored[i] = depth[i] > 0 && depth[i] < 1 ? 1 : 0;
  // robust slope + depth-edge mask
  const slope = new Float32Array(N);
  const edge = new Uint8Array(N);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, z = vz[i];
    const zl = vz[y * W + Math.max(x - 1, 0)], zr = vz[y * W + Math.min(x + 1, W - 1)];
    const zu = vz[Math.max(y - 1, 0) * W + x], zd = vz[Math.min(y + 1, H - 1) * W + x];
    const sx = Math.min(Math.abs(zr - z), Math.abs(z - zl)), sy = Math.min(Math.abs(zd - z), Math.abs(z - zu));
    slope[i] = Math.max(sx, sy);
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
  const bucket = (i) => Math.min(age[i], NA - 1);
  for (const s of signals) {
    const ch = chOf[s];
    const ref = cap.readBuffer(capDir, f, `${s}_ref`);
    const refS = new Float32Array(N);
    for (let i = 0; i < N; i++) { let v = 0; for (let c = 0; c < ch; c++) v += tm(ref[i * ch + c], ch); refS[i] = v / ch; }
    const doFlip = f % FLIP_EVERY === 0;
    const toRgb = (a) => {
      const o = new Float32Array(N * 3);
      for (let i = 0; i < N; i++) for (let c = 0; c < 3; c++) o[3 * i + c] = scored[i] ? tm(finite(a[i * ch + (ch === 1 ? 0 : c)]), ch) : 0;
      return o;
    };
    const refPrep = doFlip ? flip.prepareFlip(toRgb(ref), W, H, PPD) : null;
    const youngMask = new Uint8Array(N);
    let youngPx = 0;
    for (let i = 0; i < N; i++) if (scored[i] && age[i] < YOUNG) { youngMask[i] = 1; youngPx++; }
    // reference boil chain
    const rh = refHist[s];
    for (const d of ['noisy', ...densOf[s]]) {
      const key = `${s}|${d}`;
      const a = acc[key];
      const out = d === 'noisy' ? cap.readBuffer(capDir, f, s) : cap.readF32(path.join(outRoot, d, cap.frameDir(f), `${s}.f32`));
      const och = out.length / N;
      const o3 = och === ch ? out : (() => { const t = new Float32Array(N * ch); for (let i = 0; i < N; i++) for (let c = 0; c < ch; c++) t[i * ch + c] = out[i * och + Math.min(c, och - 1)]; return t; })();
      const outS = new Float32Array(N), err = new Float32Array(N).fill(NaN);
      const h = hist[key];
      const fr = { f, rel: f - resetFrame, allSse: 0, allCnt: 0, youngSse: 0, youngCnt: 0, youngPx, youngLumO: 0, youngLumR: 0 };
      for (let i = 0; i < N; i++) {
        if (!scored[i]) continue;
        let e2 = 0, es = 0, os = 0;
        for (let c = 0; c < ch; c++) {
          const ov = tm(finite(o3[i * ch + c]), ch), e = ov - tm(ref[i * ch + c], ch);
          e2 += e * e; es += e; os += ov;
        }
        es /= ch; os /= ch;
        outS[i] = os; err[i] = es;
        const b = bucket(i);
        a.sse[b] += e2; a.cnt[b] += ch;
        const lo = Math.max(finite(lumOf(o3, i, ch)), 0), lr = lumOf(ref, i, ch);
        a.lumO[b] += lo; a.lumR[b] += lr;
        fr.allSse += e2; fr.allCnt += ch;
        if (age[i] < YOUNG) { fr.youngSse += e2; fr.youngCnt += ch; fr.youngLumO += lo; fr.youngLumR += lr; }
        if (band[i]) { a.edgeSse += e2; a.edgeCnt += ch; if (age[i] < YOUNG) { a.edgeYoungSse += e2; a.edgeYoungCnt += ch; } }
        const q = tap[i];
        if (h && q >= 0) {
          a.flk[b] += Math.abs(es - h[2][q]); a.flkN[b]++;
          const q2 = tapPrev ? tapPrev[q] : -1;
          if (q2 >= 0 && h[1]) {
            const bo = os - 2 * h[0][q] + h[1][q2];
            a.boil[b] += bo * bo; a.boilN[b]++;
            if (rh && rh[1]) { const br = refS[i] - 2 * rh[0][q] + rh[1][q2]; a.refBoil[b] += br * br; }
          }
        }
      }
      // low-pass error (blotches / bias): signed channel-mean error box-filtered over 9x9 receiver pixels
      {
        const R = 4, IW = W + 1;
        const si = new Float64Array(IW * (H + 1)), ci = new Float64Array(IW * (H + 1));
        for (let y = 0; y < H; y++) {
          let rs = 0, rc = 0;
          for (let x = 0; x < W; x++) {
            const i = y * W + x;
            if (scored[i]) { rs += err[i]; rc++; }
            si[(y + 1) * IW + x + 1] = si[y * IW + x + 1] + rs;
            ci[(y + 1) * IW + x + 1] = ci[y * IW + x + 1] + rc;
          }
        }
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          const i = y * W + x;
          if (!scored[i]) continue;
          const x0 = Math.max(x - R, 0), x1 = Math.min(x + R + 1, W), y0 = Math.max(y - R, 0), y1 = Math.min(y + R + 1, H);
          const sum = si[y1 * IW + x1] - si[y0 * IW + x1] - si[y1 * IW + x0] + si[y0 * IW + x0];
          const c = ci[y1 * IW + x1] - ci[y0 * IW + x1] - ci[y1 * IW + x0] + ci[y0 * IW + x0];
          const e = sum / c, b = bucket(i);
          a.lpSse[b] += e * e; a.lpCnt[b]++;
          // mid band (blotches): 9x9 mean minus 33x33 mean of the signed error (removes smooth bias)
          const X0 = Math.max(x - 16, 0), X1 = Math.min(x + 17, W), Y0 = Math.max(y - 16, 0), Y1 = Math.min(y + 17, H);
          const sum2 = si[Y1 * IW + X1] - si[Y0 * IW + X1] - si[Y1 * IW + X0] + si[Y0 * IW + X0];
          const c2 = ci[Y1 * IW + X1] - ci[Y0 * IW + X1] - ci[Y1 * IW + X0] + ci[Y0 * IW + X0];
          const mid = e - sum2 / c2;
          a.midSse[b] += mid * mid;
          fr.midSse = (fr.midSse ?? 0) + mid * mid;
          fr.lpSse = (fr.lpSse ?? 0) + e * e; fr.lpCnt = (fr.lpCnt ?? 0) + 1;
        }
      }
      if (doFlip) {
        const tp = flip.prepareFlip(toRgb(o3), W, H, PPD);
        fr.flipAll = flip.flipMean(refPrep, tp, scored);
        fr.flipYoung = youngPx > 0 ? flip.flipMean(refPrep, tp, youngMask) : null;
      }
      a.frames.push(fr);
      hist[key] = reset ? [outS, null, err] : [outS, h ? h[0] : null, err];
    }
    refHist[s] = reset ? [refS, null] : [refS, rh ? rh[0] : null];
  }
  tapPrev = tap; prevAge = age; prevVz = vz;
  process.stderr.write(`\r${capName} frame ${f + 1}/${F}`);
}
process.stderr.write('\n');

const res = { capture: capName, width: W, height: H, frames: F, resets: m.frames.map((x, i) => (i === 0 || x.reset ? i : -1)).filter((i) => i >= 0), signals, denoisers: dens, flipEvery: FLIP_EVERY, ppd: PPD, acc: {} };
for (const [k, a] of Object.entries(acc)) {
  res.acc[k] = Object.fromEntries(Object.entries(a).map(([kk, v]) => [kk, v instanceof Float64Array ? Array.from(v) : v]));
}
const jout = opt('json', path.join(path.dirname(new URL(import.meta.url).pathname), 'scores', `${capName}.json`));
writeFileSync(jout, JSON.stringify(res));
console.log(`wrote ${jout}`);
