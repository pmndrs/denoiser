#!/usr/bin/env node
// Review target 5 scorer (results/T5-normal-detail.md): normal-mapped detail in replay outputs of the sh-diffuse /
// sh-specular signals, against the capture's diffuse_ref / specular_ref (4096 spp for the t5-* captures).
//
//   node score.mjs <capture dir> --outputs <outputs root> --arms a,b,c [--mask-from <capture dir>]
//        [--windows settled:16-63 | pre:8-15,move:16-47,hold:48-79] [--flipEvery 4] [--json out.json]
//
// Values: Reinhard x / (1 + x) per channel (the test bed's metric). Regions: `all` scored pixels (depth in (0, 1)),
// `bump` = angle(normal, normal_geom) > 5 deg of the mask capture (default: this capture; the smooth control takes the
// mask of its bumpy twin, same camera and geometry), `flat` = the rest. Per window x region: pooled PSNR, mean FLIP
// (every --flipEvery-th frame of the window; the test bed's viewing condition, ppd = W / 46.4), motion-compensated
// flicker (mean |e_t - e_{t-1}|, e the signed error, previous error at the max-weight valid bilinear history tap) and
// boil (RMS of the output's second temporal difference along the history / sqrt(6), only where the reference's own
// second difference is < 0.02 in every channel; `refBoil` is the same on the reference: its floor).
// Detail band (bump region): band = x - G(x), G = masked Gaussian sigma 2 px over scored pixels (lib/capture.mjs, as
// compare.mjs and the live test bed). Besides compare.mjs's band PSNR and energy ratio (sum bo^2 / sum br^2, which
// noise inflates), the band's regression on the reference band:
//   gain  k = sum bo br / sum br^2   detail contrast kept (1 = the reference's bumps, 0 = washed out; noise, being
//                                     uncorrelated with br, does not raise it)
//   noise   sum (bo - k br)^2 / sum br^2   the band energy that is not the reference's detail (residual noise, ringing)
//   corr  sum bo br / sqrt(sum bo^2 sum br^2)
// Per-frame bump PSNR and gain go to `perFrame` (recovery curves for the light paths).
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { BUMP_COS, isScored, maskedBlur3, readBuffer, readF32, readManifest, frameDir } from '../../../../../../tools/rt-capture/lib/capture.mjs';
import { prepareFlip, flipMean } from '../../../../../../examples/realtime-denoiser/src/flip.ts';

const args = process.argv.slice(2);
const VALUE_OPTS = new Set(['outputs', 'arms', 'mask-from', 'windows', 'flipEvery', 'json', 'signals']);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i < 0 ? d : args[i + 1]; };
const pos = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && VALUE_OPTS.has(args[i - 1].slice(2))));
const capDir = path.resolve(pos[0]);
const capName = path.basename(capDir);
const maskDir = path.resolve(opt('mask-from', capDir));
const outRoot = path.join(path.resolve(opt('outputs')), capName);
const arms = opt('arms').split(',');
const SIGNALS = (opt('signals', 'sh-diffuse,sh-specular')).split(',');
const REF = { 'sh-diffuse': 'diffuse_ref', 'sh-specular': 'specular_ref' };
const NOISY = { 'sh-diffuse': 'diffuse', 'sh-specular': 'specular' };
const FLIP_EVERY = Number(opt('flipEvery', 4));
const m = readManifest(capDir);
const W = m.width, H = m.height, N = W * H, NF = m.frames.length;
const ppd = W / 46.4;
// presets: 'light' (= the dt-light* event windows: paths-detail.ts DT_ONSET 16, DT_STOP 48)
const PRESETS = { light: 'pre:8-15,move:16-47,stop:48-55,hold:48-79', pre: 'pre:8-15,move:16-47,stop:48-55,hold:48-79' };
const winArg = opt('windows', `settled:16-${NF - 1}`);
const windows = (PRESETS[winArg] ?? winArg).split(',').map((s) => { const [n, r] = s.split(':'); const [a, b] = r.split('-').map(Number); return { n, a, b }; });
const REGIONS = ['all', 'bump', 'flat'];
const BOIL_SMOOTH = 0.02;
const tm = (v) => (Number.isFinite(v) && v > 0 ? v / (1 + v) : 0);
const tmArr = (x) => { const o = new Float32Array(x.length); for (let i = 0; i < x.length; i++) o[i] = tm(x[i]); return o; };
const db = (sse, n) => (n ? 10 * Math.log10(1 / Math.max(sse / n, 1e-12)) : NaN);

/** previous-frame pixel of each pixel's history (-1 = none): max-weight valid bilinear tap, viewz within 2 % */
function historyTaps(f) {
  const tap = new Int32Array(N).fill(-1);
  const depth = readBuffer(capDir, f, 'depth'), pdepth = readBuffer(capDir, f - 1, 'depth');
  const mo = readBuffer(capDir, f, 'motion'), vz = readBuffer(capDir, f, 'viewz'), pvz = readBuffer(capDir, f - 1, 'viewz');
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (!isScored(depth[i])) continue;
    const px = x + 0.5 - 0.5 * mo[2 * i] * W - 0.5, py = y + 0.5 + 0.5 * mo[2 * i + 1] * H - 0.5;
    const bx = Math.floor(px), by = Math.floor(py), fx = px - bx, fy = py - by;
    const tol = 0.02 * Math.abs(vz[i]);
    let bestW = -1, best = -1;
    for (let k = 0; k < 4; k++) {
      const qx = bx + (k & 1), qy = by + (k >> 1);
      const w = ((k & 1) ? fx : 1 - fx) * ((k >> 1) ? fy : 1 - fy);
      if (w <= 1e-3 || qx < 0 || qy < 0 || qx >= W || qy >= H) continue;
      const q = qy * W + qx;
      if (!isScored(pdepth[q]) || Math.abs(pvz[q] - vz[i]) > tol) continue;
      if (w > bestW) { bestW = w; best = q; }
    }
    tap[i] = best;
  }
  return tap;
}

// accumulators: acc[arm][signal][window][region] = sums
const newSums = () => ({ sse: 0, n: 0, flip: 0, flipN: 0, fl: 0, flN: 0, boil: 0, boilN: 0, rboil: 0, rboilN: 0, bo2: 0, br2: 0, bobr: 0, bd2: 0, bN: 0 });
const rows = [...arms, 'noisy'];
const acc = {}, perFrame = {};
for (const a of rows) {
  acc[a] = {}; perFrame[a] = {};
  for (const s of SIGNALS) {
    acc[a][s] = Object.fromEntries(windows.map((w) => [w.n, Object.fromEntries(REGIONS.map((r) => [r, newSums()]))]));
    perFrame[a][s] = [];
  }
}
const state = {};   // per arm/signal: previous error e, previous outputs h1, h2
let tapPrev = null;
for (let f = 0; f < NF; f++) {
  const inWin = windows.filter((w) => f >= w.a && f <= w.b);
  const reset = f === 0 || !!m.frames[f].reset;
  const tap = reset ? null : historyTaps(f);
  const depth = readBuffer(capDir, f, 'depth');
  const n = readBuffer(maskDir, f, 'normal'), ng = readBuffer(maskDir, f, 'normal_geom');
  const scored = new Uint8Array(N), region = new Uint8Array(N);   // region: 1 bump, 2 flat
  for (let i = 0; i < N; i++) {
    if (!isScored(depth[i])) continue;
    scored[i] = 1;
    region[i] = n[3 * i] * ng[3 * i] + n[3 * i + 1] * ng[3 * i + 1] + n[3 * i + 2] * ng[3 * i + 2] < BUMP_COS ? 1 : 2;
  }
  const doFlip = inWin.length && (f % FLIP_EVERY === 0);
  for (const s of SIGNALS) {
    const ref = tmArr(readBuffer(capDir, f, REF[s]));
    const gr = maskedBlur3(ref, scored, W, H);
    const fRef = doFlip ? prepareFlip(ref, W, H, ppd) : null;
    const rk = `ref:${s}`;
    const rs = (state[rk] ??= {});
    // reference second difference (boil floor and the smooth-history mask)
    let smooth = null;
    if (!reset && rs.h1 && rs.h2 && tap && tapPrev) {
      smooth = new Uint8Array(N);
      for (let i = 0; i < N; i++) {
        if (!scored[i]) continue;
        const a = tap[i]; if (a < 0) continue;
        const b = tapPrev[a]; if (b < 0) continue;
        let ok = 1, s2 = 0;
        for (let c = 0; c < 3; c++) { const d = ref[3 * i + c] - 2 * rs.h1[3 * a + c] + rs.h2[3 * b + c]; s2 += d * d; if (Math.abs(d) >= BOIL_SMOOTH) ok = 0; }
        if (ok) { smooth[i] = 1; for (const w of inWin) for (const r of ['all', REGIONS[region[i]]]) { const t = acc.noisy[s][w.n][r]; t.rboil += s2; t.rboilN += 3; } }
      }
    }
    rs.h2 = reset ? null : rs.h1; rs.h1 = ref;
    for (const a of rows) {
      const raw = a === 'noisy' ? readBuffer(capDir, f, NOISY[s]) : readF32(path.join(outRoot, a, frameDir(f), `${s}.f32`));
      const out = tmArr(raw);
      const st = (state[`${a}:${s}`] ??= {});
      const e = new Float32Array(N * 3);
      for (let i = 0; i < 3 * N; i++) e[i] = out[i] - ref[i];
      const go = maskedBlur3(out, scored, W, H);
      const fOut = doFlip ? prepareFlip(out, W, H, ppd) : null;
      const flipAll = fOut ? flipMean(fRef, fOut, scored) : NaN;
      const bumpMask = fOut ? Uint8Array.from(region, (v) => (v === 1 ? 1 : 0)) : null;
      const flatMask = fOut ? Uint8Array.from(region, (v) => (v === 2 ? 1 : 0)) : null;
      const flipR = fOut ? { all: flipAll, bump: flipMean(fRef, fOut, bumpMask), flat: flipMean(fRef, fOut, flatMask) } : null;
      // per-frame bump sums (for curves) and window sums
      let fSse = 0, fN = 0, fbobr = 0, fbr2 = 0;
      const W0 = inWin.map((w) => acc[a][s][w.n]);
      for (let i = 0; i < N; i++) {
        const r = region[i];
        if (!r) continue;
        const rn = REGIONS[r];
        let se = 0;
        for (let c = 0; c < 3; c++) se += e[3 * i + c] ** 2;
        // temporal: flicker and boil along the history
        let fl = -1, bo = -1;
        if (tap && tap[i] >= 0 && st.e) {
          const q = tap[i];
          fl = (Math.abs(e[3 * i] - st.e[3 * q]) + Math.abs(e[3 * i + 1] - st.e[3 * q + 1]) + Math.abs(e[3 * i + 2] - st.e[3 * q + 2])) / 3;
          if (smooth && smooth[i] && st.h2) {
            const b = tapPrev[q];
            bo = 0;
            for (let c = 0; c < 3; c++) bo += (out[3 * i + c] - 2 * st.h1[3 * q + c] + st.h2[3 * b + c]) ** 2;
          }
        }
        let bo2 = 0, br2 = 0, bobr = 0, bd2 = 0;
        if (r === 1) {
          for (let c = 0; c < 3; c++) {
            const x = out[3 * i + c] - go[3 * i + c], y = ref[3 * i + c] - gr[3 * i + c];
            bo2 += x * x; br2 += y * y; bobr += x * y; bd2 += (x - y) ** 2;
          }
          fSse += se; fN += 3; fbobr += bobr; fbr2 += br2;
        }
        for (const t0 of W0) {
          for (const t of [t0.all, t0[rn]]) {
            t.sse += se; t.n += 3;
            if (fl >= 0) { t.fl += fl; t.flN++; }
            if (bo >= 0) { t.boil += bo; t.boilN += 3; }
          }
          if (r === 1) { const t = t0.bump; t.bo2 += bo2; t.br2 += br2; t.bobr += bobr; t.bd2 += bd2; t.bN += 3; }
        }
      }
      if (flipR) for (const t0 of W0) for (const rn of REGIONS) if (Number.isFinite(flipR[rn])) { t0[rn].flip += flipR[rn]; t0[rn].flipN++; }
      perFrame[a][s].push({ f, bumpPsnr: +db(fSse, fN).toFixed(3), gain: fbr2 ? +(fbobr / fbr2).toFixed(4) : null });
      st.e = e; st.h2 = reset ? null : st.h1; st.h1 = out;
    }
  }
  tapPrev = tap ?? null;
  if (f % 8 === 7) process.stderr.write(`${capName}: frame ${f + 1}/${NF}\n`);
}

const result = { capture: capName, mask: path.basename(maskDir), width: W, height: H, frames: NF, windows, arms: rows, scores: {}, perFrame };
for (const a of rows) {
  result.scores[a] = {};
  for (const s of SIGNALS) {
    result.scores[a][s] = {};
    for (const w of windows) {
      const o = {};
      for (const r of REGIONS) {
        const t = acc[a][s][w.n][r], tn = acc.noisy[s][w.n][r];
        o[r] = {
          psnr: db(t.sse, t.n), flip: t.flipN ? t.flip / t.flipN : NaN, flicker: t.flN ? t.fl / t.flN : NaN,
          boil: t.boilN ? Math.sqrt(t.boil / t.boilN / 6) : NaN, refBoil: tn.rboilN ? Math.sqrt(tn.rboil / tn.rboilN / 6) : NaN,
        };
        if (r === 'bump' && t.br2) {
          const k = t.bobr / t.br2;
          Object.assign(o[r], {
            bandPsnr: db(t.bd2, t.bN), energy: t.bo2 / t.br2, gain: k,
            noise: (t.bo2 - 2 * k * t.bobr + k * k * t.br2) / t.br2, corr: t.bobr / Math.sqrt(t.bo2 * t.br2),
          });
        }
      }
      result.scores[a][s][w.n] = o;
    }
  }
}
const j = opt('json');
if (j) writeFileSync(j, JSON.stringify(result, null, 1));
const f2 = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '–');
for (const s of SIGNALS) for (const w of windows) {
  console.log(`\n${capName} ${s} window ${w.n} (${w.a}-${w.b}), mask ${path.basename(maskDir)}`);
  console.log('| arm | PSNR | bump | flat | gain | noise | energy | band PSNR | FLIP | FLIP bump | flicker bump | boil bump | boil flat |');
  for (const a of rows) {
    const o = result.scores[a][s][w.n];
    console.log(`| ${a} | ${f2(o.all.psnr)} | ${f2(o.bump.psnr)} | ${f2(o.flat.psnr)} | ${f2(o.bump.gain, 3)} | ${f2(o.bump.noise, 3)} | ${f2(o.bump.energy, 3)} | ${f2(o.bump.bandPsnr)} | ${f2(o.all.flip, 4)} | ${f2(o.bump.flip, 4)} | ${f2(o.bump.flicker, 4)} | ${f2(o.bump.boil, 4)} | ${f2(o.flat.boil, 4)} |`);
  }
  const o = result.scores.noisy[s][w.n];
  console.log(`| reference boil | | | | | | | | | | | ${f2(o.bump.refBoil, 4)} | ${f2(o.flat.refBoil, 4)} |`);
}
