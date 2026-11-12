#!/usr/bin/env node
// Summarize t1b-reveal.mjs JSON (results/T1b-spatial-repair.md).
//   node t1b-reveal-summary.mjs <json...> [--signal diffuse] [--base svgf-auto] [--ref rec] [--md]
// Per capture and denoiser:
//   E set (fixed revealed surfaces, revealed in [from, to], uncovered to the end):
//     e+k      PSNR on frame to + k (k = 0, 1, 2, 4, 8, 16; for one-frame reveals to = the reveal frame)
//     band     frames after `to` until the E-set PSNR stays >= band to the end; band = the --base denoiser's mean
//              E-set PSNR over the last 16 frames - 0.5 dB (fixed per capture / signal before comparing)
//     edge8    boundary pixels of E (2 px of a depth edge), PSNR over frames to .. to + 7
//     mid8     mid-band (blotch) PSNR of E over frames to .. to + 7 (higher = fewer blotches)
//     bias8    mean signed error of E over frames to .. to + 7 (x 1e3, Reinhard units)
//     flip     E-set FLIP, mean over FLIP frames >= to
//     boilH    E-set boil over frames >= to + 2 (static camera: second temporal difference at the pixel / sqrt 6)
//   j curve (every revealed pixel by time since its reveal): young PSNR (j 0..7), boil j 2..7; static control boil
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const files = args.filter((a) => a.endsWith('.json'));
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i < 0 ? d : args[i + 1]; };
const sig = opt('signal', 'diffuse');
const base = opt('base', 'svgf-auto');
const refDen = opt('ref', 'rec');
const db = (sse, n) => (n > 0 ? 10 * Math.log10(n / Math.max(sse, 1e-30)) : NaN);
const f2 = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '–');
const KS = [0, 1, 2, 4, 8, 16];

for (const file of files) {
  const r = JSON.parse(readFileSync(file, 'utf8'));
  const to = r.to, F = r.frames;
  const rows = {};
  for (const [k, a] of Object.entries(r.acc)) {
    const [s, d] = k.split('|');
    if (s !== sig) continue;
    const fr = a.frames;
    const e = (f) => db(fr[f].E.sse, fr[f].E.cnt);
    const sumE = (lo, hi, key, n) => { let x = 0, c = 0; for (let f = lo; f <= Math.min(hi, F - 1); f++) { x += fr[f].E[key]; c += fr[f].E[n]; } return [x, c]; };
    const tail = fr.slice(F - 16).reduce((x, f) => x + f.E.sse / f.E.cnt, 0) / 16;
    const [bS, bC] = sumE(to, to + 7, 'bSse', 'bCnt');
    const [mS, mC] = sumE(to, to + 7, 'mid', 'midN');
    const [bi, biC] = sumE(to, to + 7, 'bias', 'cnt');
    const [boS, boN] = sumE(to + 2, F - 1, 'boil', 'boilN');
    const [rbS] = sumE(to + 2, F - 1, 'refBoil', 'boilN');
    const flips = fr.filter((f) => f.f >= to && f.E.flip != null).map((f) => f.E.flip);
    const j = a.j;
    const young = db(j.sse.slice(0, 8).reduce((x, y) => x + y, 0), j.cnt.slice(0, 8).reduce((x, y) => x + y, 0));
    const jb = Math.sqrt(j.boil.slice(2, 8).reduce((x, y) => x + y, 0) / Math.max(j.boilN.slice(2, 8).reduce((x, y) => x + y, 0), 1) / 6);
    const sb = (() => { let x = 0, n = 0; for (const f of fr) { x += f.S.boil; n += f.S.boilN; } return Math.sqrt(x / Math.max(n, 1) / 6); })();
    rows[d] = {
      ek: KS.map((k) => (to + k < F ? e(to + k) : NaN)), curve: fr.map((_, f) => e(f)), tailDb: db(tail, 1),
      edge8: db(bS, bC), mid8: db(mS, mC), bias8: (bi / Math.max(biC, 1)) * 3 * 1e3,   // cnt counts channels: x3 back to per-pixel mean
      flip: flips.length ? flips.reduce((x, y) => x + y, 0) / flips.length : NaN,
      boilH: Math.sqrt(boS / Math.max(boN, 1) / 6), refBoilH: Math.sqrt(rbS / Math.max(boN, 1) / 6), young, jb, sb,
      jCurve: j.sse.slice(0, 9).map((s, i) => db(s, j.cnt[i])),
    };
  }
  const b = rows[base];
  const band = b ? b.tailDb - 0.5 : NaN;
  for (const x of Object.values(rows)) {
    let k = NaN;
    for (let f = to; f < F; f++) { if (x.curve.slice(f).every((c) => c >= band)) { k = f - to; break; } }
    x.band = k;
  }
  const R = rows[refDen];
  console.log(`\n${r.capture} ${sig}: E set ${r.eventPx} px revealed in [${r.from}, ${to}]; band ${f2(band)} dB (${base} tail - 0.5)`);
  console.log(`${'den'.padEnd(14)} ${KS.map((k) => `e+${k}`.padStart(6)).join(' ')}  band  edge8  mid8  bias8   flip   boilH (ref)   young  jboil  sboil`);
  for (const [d, x] of Object.entries(rows)) {
    console.log(`${d.padEnd(14)} ${x.ek.map((v) => f2(v).padStart(6)).join(' ')}  ${String(Number.isFinite(x.band) ? x.band : '–').padStart(4)}  ${f2(x.edge8)} ${f2(x.mid8)} ${f2(x.bias8, 2).padStart(6)} ${f2(x.flip, 4)} ${f2(x.boilH, 5)} (${f2(x.refBoilH, 5)})  ${f2(x.young)} ${f2(x.jb, 5)} ${f2(x.sb, 5)}${R && x !== R ? `  | Δboil ${f2((x.boilH / R.boilH - 1) * 100, 0)} % Δjboil ${f2((x.jb / R.jb - 1) * 100, 0)} %` : ''}`);
  }
  if (args.includes('--j')) for (const [d, x] of Object.entries(rows)) console.log(`j ${d.padEnd(12)} ${x.jCurve.map((v) => f2(v)).join(' ')}`);
}
