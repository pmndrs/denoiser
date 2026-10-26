#!/usr/bin/env node
// T3 light-change scorer (results/T3-light-changes.md, review target 3). Scores replay outputs of the lc540-* captures
// (fixed camera and geometry, examples/realtime-denoiser/src/paths-light.ts): the camera never moves, so pixel i is the
// same surface point in every frame and no reprojection is needed. Our tool; conventions as compare.mjs / t1-score.mjs:
//
//   value     diffuse / specular: Reinhard x/(1+x) per channel; visibility: clamp [0, 1]
//   events    onset / onsetEnd / ret / retEnd (frames; step paths onset = onsetEnd); windows
//             pre [8, onset), in [onset, onsetEnd + 8), held [onsetEnd + 8, ret), out [ret, retEnd + 8), after [retEnd + 8, F)
//   regions   change c_i = max_t max_c |ref_t - ref_0| (tonemapped) over the capture; dynamic c > 0.02, static c < 0.002
//             (static pixels' references are bit-identical every frame here: per-pixel reference seeds are fixed)
//   PSNR      pooled over the region and the window's frames (-10 log10 mean squared error per channel)
//   FLIP      LDR-FLIP (examples/realtime-denoiser/src/flip.ts) on the tonemapped image every --flip-every frames,
//             mean over the region's pixels, at the test bed's ppd (46.4 deg across)
//   old       old-appearance fraction over the dynamic region, r_t = sum (o - n)(b - n) / sum (b - n)^2 (tonemapped,
//             all channels), b = the reference before the event (frame onset - 1 for the onset, ret - 1 for the
//             return), n = the settled reference after it (ret - 1 / F - 1). 1 = still the old image, 0 = the new one;
//             a filter's own steady-state bias shows as r != 0 before the event. Colour-only changes count too.
//             t10 / t25 = frames after the event's end (onsetEnd / retEnd) until r stays below 0.1 / 0.25 for the rest
//             of the window (0 = already on the event's last frame). Ramp paths also get lag = argmin_k
//             sum_dyn (o_t - ref_{t-k})^2 (k = 0..8, parabolic sub-frame) averaged over the ramp frames.
//   settle    tBand = frames after the event's end until the dynamic-region MSE stays within 1.25x the output's own
//             settled MSE (last 8 frames before the next event / the end)
//   boil      RMS of the output's second temporal difference / sqrt(6) (compare.mjs), per region and window; frames
//             whose 3-frame stencil touches an event frame are left out of the dynamic region (legitimate change)
//
//   node t3-score.mjs <capture> --den a,b,c [--signals diffuse,specular,visibility] [--outputs <root>] [--flip-every 2]
//        [--events 24,24,56,56] [--json out.json]
import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const REPO = new URL('../../../../../', import.meta.url).pathname.replace(/\/$/, '');
const cap = await import(`${REPO}/tools/rt-capture/lib/capture.mjs`);
const flip = await import(`${REPO}/examples/realtime-denoiser/src/flip.ts`);

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i < 0 ? d : args[i + 1]; };
const capDir = cap.resolveCapture(args[0]);
const capName = path.basename(capDir);
const outRoot = path.join(path.resolve(opt('outputs', cap.OUTPUTS_DIR)), capName);
const dens = opt('den', '').split(',').filter(Boolean);
const m = cap.readManifest(capDir);
const W = m.width, H = m.height, N = W * H, F = m.frames.length;
const chOf = Object.fromEntries(m.buffers.map((b) => [b.name, b.channels]));
const signals = opt('signals', 'diffuse,specular,visibility').split(',').filter((s) => chOf[s] && chOf[`${s}_ref`]);
const FLIP_EVERY = Number(opt('flip-every', 2));
const PPD = W / 46.4;
const RAMP = /fade|emitter/.test(capName);
const [onset, onsetEnd, ret, retEnd] = (opt('events', RAMP ? '24,39,56,71' : '24,24,56,56')).split(',').map(Number);
const WIN = { pre: [8, onset], in: [onset, onsetEnd + 8], held: [onsetEnd + 8, ret], out: [ret, retEnd + 8], after: [retEnd + 8, F] };
const EVENT_FRAMES = new Set(RAMP ? [...Array(onsetEnd - onset + 1).keys()].map((k) => onset + k).concat([...Array(retEnd - ret + 1).keys()].map((k) => ret + k)) : [onset, ret]);
const DYN = 0.02, STAT = Number(opt('stat', 0.002)), KMAX = 8;   // --stat 0: only pixels whose reference never changes (bit-identical)

const tm = (x, ch) => (ch === 1 ? Math.min(Math.max(x, 0), 1) : x > 0 ? x / (1 + x) : 0);
const finite = (x) => (Number.isFinite(x) ? x : 0);
const winOf = (f) => Object.keys(WIN).find((k) => f >= WIN[k][0] && f < WIN[k][1]);
const psnr = (sse, n) => (n > 0 ? -10 * Math.log10(Math.max(sse / n, 1e-12)) : null);

const depth0 = cap.readBuffer(capDir, 0, 'depth');
const scored = new Uint8Array(N);
for (let i = 0; i < N; i++) scored[i] = depth0[i] > 0 && depth0[i] < 1 ? 1 : 0;

/** tonemapped copy (ch channels) of a buffer with any channel count */
function tmOf(a, ch) {
  const ach = a.length / N, o = new Float32Array(N * ch);
  for (let i = 0; i < N; i++) for (let c = 0; c < ch; c++) o[i * ch + c] = tm(finite(a[i * ach + Math.min(c, ach - 1)]), ch);
  return o;
}
const rgbOf = (t, ch) => { const o = new Float32Array(N * 3); for (let i = 0; i < N; i++) for (let c = 0; c < 3; c++) o[3 * i + c] = scored[i] ? t[i * ch + (ch === 1 ? 0 : c)] : 0; return o; };

const result = { capture: capName, events: { onset, onsetEnd, ret, retEnd }, windows: WIN, signals: {} };
for (const s of signals) {
  const ch = chOf[s];
  // references: tonemapped per frame (kept: lag search and the change map need them)
  const refs = [];
  for (let f = 0; f < F; f++) refs.push(tmOf(cap.readBuffer(capDir, f, `${s}_ref`), ch));
  const change = new Float32Array(N);
  for (let f = 1; f < F; f++) { const r = refs[f], r0 = refs[0]; for (let i = 0; i < N; i++) for (let c = 0; c < ch; c++) change[i] = Math.max(change[i], Math.abs(r[i * ch + c] - r0[i * ch + c])); }
  const dyn = new Uint8Array(N), stat = new Uint8Array(N);
  let nDyn = 0, nStat = 0, nScored = 0;
  for (let i = 0; i < N; i++) { if (!scored[i]) continue; nScored++; if (change[i] > DYN) { dyn[i] = 1; nDyn++; } else if (STAT > 0 ? change[i] < STAT : change[i] === 0) { stat[i] = 1; nStat++; } }
  const bOn = refs[onset - 1], nOn = refs[ret - 1], bRet = refs[ret - 1], nRet = refs[F - 1];
  const den = (b, n) => { let d = 0; for (let i = 0; i < N; i++) if (dyn[i]) for (let c = 0; c < ch; c++) { const x = b[i * ch + c] - n[i * ch + c]; d += x * x; } return d; };
  const dOn = den(bOn, nOn), dRet = den(bRet, nRet);
  // reference boil in the static region (should be 0) and reference FLIP preps
  const refPrep = [];
  for (let f = 0; f < F; f++) refPrep.push(f % FLIP_EVERY === 0 ? flip.prepareFlip(rgbOf(refs[f], ch), W, H, PPD) : null);
  const sres = { channels: ch, pixels: { scored: nScored, dynamic: nDyn, static: nStat }, outputs: {} };

  for (const d of ['noisy', ...dens]) {
    const file = (f) => path.join(outRoot, d, cap.frameDir(f), `${s}.f32`);
    if (d !== 'noisy' && !existsSync(file(F - 1))) { console.error(`skip ${d}/${s}: missing frames`); continue; }
    const per = [];
    let o1 = null, o2 = null;
    const wsum = Object.fromEntries(Object.keys(WIN).map((k) => [k, { dSse: 0, dN: 0, sSse: 0, sN: 0, dFl: 0, sFl: 0, flN: 0, sB: 0, sBN: 0, dB: 0, dBN: 0 }]));
    for (let f = 0; f < F; f++) {
      const o = tmOf(d === 'noisy' ? cap.readBuffer(capDir, f, s) : cap.readF32(file(f)), ch);
      const r = refs[f];
      let dSse = 0, dN = 0, sSse = 0, sN = 0, num = 0, sB = 0, sBN = 0, dB = 0, dBN = 0;
      const [b, n, dd] = f < ret ? [bOn, nOn, dOn] : [bRet, nRet, dRet];
      const stencilClean = ![f, f - 1, f - 2].some((k) => EVENT_FRAMES.has(k)) && !(RAMP && f > onset && f <= onsetEnd + 2) && !(RAMP && f > ret && f <= retEnd + 2);
      for (let i = 0; i < N; i++) {
        if (!scored[i]) continue;
        for (let c = 0; c < ch; c++) {
          const k = i * ch + c, e = o[k] - r[k];
          if (dyn[i]) { dSse += e * e; dN++; num += (o[k] - n[k]) * (b[k] - n[k]); }
          else if (stat[i]) { sSse += e * e; sN++; }
          if (o2) {
            const d2 = o[k] - 2 * o1[k] + o2[k];
            if (stat[i]) { sB += d2 * d2; sBN++; } else if (dyn[i] && stencilClean) { dB += d2 * d2; dBN++; }
          }
        }
      }
      let fl = null, fls = null;
      if (refPrep[f]) {
        const tp = flip.prepareFlip(rgbOf(o, ch), W, H, PPD);
        fl = flip.flipMean(refPrep[f], tp, dyn); fls = flip.flipMean(refPrep[f], tp, stat);
      }
      // lag (ramp paths): k minimizing the dynamic-region error against ref_{t-k}
      let lag = null;
      if (RAMP && ((f >= onset && f <= onsetEnd) || (f >= ret && f <= retEnd))) {
        const e = [];
        for (let k = 0; k <= KMAX && f - k >= 0; k++) {
          const rk = refs[f - k]; let sse = 0;
          for (let i = 0; i < N; i++) if (dyn[i]) for (let c = 0; c < ch; c++) { const x = o[i * ch + c] - rk[i * ch + c]; sse += x * x; }
          e.push(sse);
        }
        let k0 = e.indexOf(Math.min(...e));
        lag = k0;
        if (k0 > 0 && k0 < e.length - 1) { const den2 = e[k0 - 1] - 2 * e[k0] + e[k0 + 1]; if (den2 > 0) lag = k0 + 0.5 * (e[k0 - 1] - e[k0 + 1]) / den2; }
      }
      const w = winOf(f);
      if (w) {
        const a = wsum[w];
        a.dSse += dSse; a.dN += dN; a.sSse += sSse; a.sN += sN; a.sB += sB; a.sBN += sBN; a.dB += dB; a.dBN += dBN;
        if (fl !== null) { a.dFl += fl; a.sFl += fls; a.flN++; }
      }
      per.push({ f, mseDyn: dN ? dSse / dN : null, mseStat: sN ? sSse / sN : null, old: dd > 0 ? num / dd : null, flipDyn: fl, lag });
      o2 = o1; o1 = o;
    }
    // event metrics
    const tUntil = (from, to, key, thr) => { let last = -1; for (let f = from; f < to; f++) if (per[f][key] > thr) last = f; return last < 0 ? 0 : last - from + 1; };
    const settledMse = (to) => { const xs = per.slice(to - 8, to).map((p) => p.mseDyn); return xs.reduce((u, v) => u + v, 0) / xs.length; };
    const band = (from, to) => { const lim = 1.25 * settledMse(to); let last = -1; for (let f = from; f < to; f++) if (per[f].mseDyn > lim) last = f; return last < 0 ? 0 : last - from + 1; };
    const ev = (start, end, next) => ({
      oldAt: Object.fromEntries([0, 1, 2, 4, 8].map((k) => [k, per[end + k]?.old ?? null])),
      oldBefore: per[start - 1].old,
      t10: tUntil(end, next, 'old', 0.1), t25: tUntil(end, next, 'old', 0.25), tBand: band(end, next),
      lag: RAMP ? (() => { const xs = per.slice(start, end + 1).map((p) => p.lag); return xs.reduce((u, v) => u + v, 0) / xs.length; })() : null,
    });
    const windows = Object.fromEntries(Object.entries(wsum).map(([k, a]) => [k, {
      psnrDyn: psnr(a.dSse, a.dN), psnrStat: psnr(a.sSse, a.sN), flipDyn: a.flN ? a.dFl / a.flN : null, flipStat: a.flN ? a.sFl / a.flN : null,
      boilStat: a.sBN ? Math.sqrt(a.sB / a.sBN / 6) : null, boilDyn: a.dBN ? Math.sqrt(a.dB / a.dBN / 6) : null,
    }]));
    sres.outputs[d] = { windows, onset: ev(onset, onsetEnd, ret), return: ev(ret, retEnd, F), perFrame: per };
    const wv = windows;
    console.log(`${capName} ${s.padEnd(10)} ${d.padEnd(28)} in ${wv.in.psnrDyn?.toFixed(2)} held ${wv.held.psnrDyn?.toFixed(2)} out ${wv.out.psnrDyn?.toFixed(2)} after ${wv.after.psnrDyn?.toFixed(2)} | ` +
      `t10 on ${sres.outputs[d].onset.t10} ret ${sres.outputs[d].return.t10} old@1 ${sres.outputs[d].onset.oldAt[1]?.toFixed(3)} / ${sres.outputs[d].return.oldAt[1]?.toFixed(3)} | ` +
      `boilStat pre ${wv.pre.boilStat?.toFixed(5)} in ${wv.in.boilStat?.toFixed(5)} out ${wv.out.boilStat?.toFixed(5)}${RAMP ? ` | lag ${sres.outputs[d].onset.lag?.toFixed(2)} / ${sres.outputs[d].return.lag?.toFixed(2)}` : ''}`);
  }
  result.signals[s] = sres;
}
if (opt('json')) writeFileSync(opt('json'), JSON.stringify(result));
