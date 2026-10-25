#!/usr/bin/env node
// Summarize t1-score.mjs JSON: per capture / signal / denoiser
//   young   pooled PSNR over age < 8 (the test bed's "disoccluded"), FLIP (young-pixel mean over scored frames),
//           energy (sum lum out / sum lum ref - 1, linear), flicker (ages 1-7), boil (ages 2-7) and the reference's boil
//   old     pooled PSNR over age >= 17 (settled level; '-' if the capture has none)
//   edge    pooled PSNR of young pixels within 2 px of a depth edge
//   curve   pooled PSNR per age 0..16
//   conv    frames to converge: first age a from which every age bucket a..maxAge (with >= 2000 values) stays at
//           or above the band; band = the BASELINE denoiser's own settled level - 0.5 dB (old bucket, else its mean
//           over the last 4 populated age buckets), fixed per capture / signal before comparing
//   node t1-summary.mjs scores/*.json [--base diffuse=svgf-auto,specular=svgf-auto,visibility=shadows] [--md] [--curve]
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const files = args.filter((a) => a.endsWith('.json'));
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i < 0 ? d : args[i + 1]; };
const base = Object.fromEntries(opt('base', 'diffuse=svgf-auto,specular=svgf-auto,visibility=shadows').split(',').map((x) => x.split('=')));
const only = opt('only', '') ? opt('only', '').split(',') : null;
const psnr = (sse, n) => (n > 0 ? 10 * Math.log10(1 / Math.max(sse / n, 1e-12)) : NaN);
const f2 = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '–');
const MIN = 2000;

export function summarize(r, sig, den, band) {
  const a = r.acc[`${sig}|${den}`];
  if (!a) return null;
  const sum = (arr, lo, hi) => arr.slice(lo, hi).reduce((x, y) => x + y, 0);
  const young = psnr(sum(a.sse, 0, 8), sum(a.cnt, 0, 8));
  const lpYoung = a.lpSse ? psnr(sum(a.lpSse, 0, 8), sum(a.lpCnt, 0, 8)) : NaN;
  const midYoung = a.midSse ? psnr(sum(a.midSse, 0, 8), sum(a.lpCnt, 0, 8)) : NaN;
  const midOld = a.midSse && a.lpCnt[17] > 0 ? psnr(a.midSse[17], a.lpCnt[17]) : NaN;
  const lpOld = a.lpSse && a.lpCnt[17] > 0 ? psnr(a.lpSse[17], a.lpCnt[17]) : NaN;
  const old = a.cnt[17] >= MIN ? psnr(a.sse[17], a.cnt[17]) : NaN;
  const all = psnr(sum(a.sse, 0, 18), sum(a.cnt, 0, 18));
  const curve = a.sse.slice(0, 17).map((s, i) => (a.cnt[i] >= MIN ? psnr(s, a.cnt[i]) : NaN));
  const energy = sum(a.lumO, 0, 8) / Math.max(sum(a.lumR, 0, 8), 1e-9) - 1;
  const energyOld = a.lumR[17] > 0 ? a.lumO[17] / a.lumR[17] - 1 : NaN;
  const flk = sum(a.flk, 1, 8) / Math.max(sum(a.flkN, 1, 8), 1);
  const boil = Math.sqrt(sum(a.boil, 2, 8) / Math.max(sum(a.boilN, 2, 8), 1)) / Math.sqrt(6);
  const refBoil = Math.sqrt(sum(a.refBoil, 2, 8) / Math.max(sum(a.boilN, 2, 8), 1)) / Math.sqrt(6);
  const boilOld = Math.sqrt(a.boil[17] / Math.max(a.boilN[17], 1)) / Math.sqrt(6);
  const flips = a.frames.filter((x) => x.flipYoung != null && x.youngPx >= 500);
  const flipY = flips.length ? flips.reduce((x, y) => x + y.flipYoung * y.youngPx, 0) / flips.reduce((x, y) => x + y.youngPx, 0) : NaN;
  const flipsA = a.frames.filter((x) => x.flipAll != null);
  const flipAll = flipsA.length ? flipsA.reduce((x, y) => x + y.flipAll, 0) / flipsA.length : NaN;
  const edge = psnr(a.edgeYoungSse, a.edgeYoungCnt);
  const edgeAll = psnr(a.edgeSse, a.edgeCnt);
  // settled level for the band
  const pop = curve.map((v, i) => [i, v]).filter(([, v]) => Number.isFinite(v));
  const settled = Number.isFinite(old) ? old : pop.slice(-4).reduce((x, [, v]) => x + v, 0) / Math.max(pop.slice(-4).length, 1);
  let conv = NaN;
  if (band !== undefined) {
    const maxA = pop.length ? pop[pop.length - 1][0] : -1;
    for (let s = 0; s <= maxA; s++) {
      if (pop.filter(([i]) => i >= s).every(([, v]) => v >= band)) { conv = s; break; }
    }
    if (!Number.isFinite(conv) && Number.isFinite(old) && old >= band) conv = maxA + 1; // only the old bucket is in the band
  }
  return { young, lpYoung, lpOld, midYoung, midOld, old, all, curve, energy, energyOld, flk, boil, refBoil, boilOld, flipY, flipAll, edge, edgeAll, settled, conv, frames: a.frames };
}

if ((process.argv[1] ?? '').endsWith('t1-summary.mjs')) {
  const md = args.includes('--md');
  for (const file of files) {
    const r = JSON.parse(readFileSync(file, 'utf8'));
    for (const sig of r.signals) {
      const b = summarize(r, sig, base[sig]);
      const band = b ? b.settled - 0.5 : undefined;
      console.log(`\n### ${r.capture} — ${sig} (band ${f2(band)} dB = ${base[sig]} settled − 0.5)`);
      console.log('| denoiser | young PSNR | edge (young) | old | all | FLIP young | energy young | flicker young | boil young (ref) | conv. frames |');
      console.log('|---|---|---|---|---|---|---|---|---|---|');
      for (const den of ['noisy', ...r.denoisers]) {
        if (only && !only.includes(den)) continue;
        const s = summarize(r, sig, den, band);
        if (!s) continue;
        console.log(`| ${den} | ${f2(s.young)} | ${f2(s.edge)} | ${f2(s.old)} | ${f2(s.all)} | ${f2(s.flipY, 4)} | ${f2(100 * s.energy, 1)} % | ${f2(s.flk, 4)} | ${f2(s.boil, 4)} (${f2(s.refBoil, 4)}) | ${Number.isFinite(s.conv) ? s.conv : '>'} |`);
      }
      if (args.includes('--curve')) {
        console.log(`\n| age | ${Array.from({ length: 17 }, (_, i) => i).join(' | ')} |`);
        console.log(`|---|${'---|'.repeat(17)}`);
        for (const den of ['noisy', ...r.denoisers]) {
          if (only && !only.includes(den)) continue;
          const s = summarize(r, sig, den, band);
          if (s) console.log(`| ${den} | ${s.curve.map((v) => f2(v, 1)).join(' | ')} |`);
        }
      }
    }
  }
}
