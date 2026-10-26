#!/usr/bin/env node
// E-1b boil / young-pixel table (results/E1b-high-reference.md) from t1-score.mjs JSON of replays of the SAME
// noisy frames captured twice, once with 256-spp and once with 4096-spp references (identical inputs, so the
// denoised outputs and their boil are identical; only the reference-dependent numbers move).
//   node e1b-boil.mjs --pairs=<base>:<cand>[,<base>:<cand>] scores/e1b256-*.json scores/e1b4k-*.json   (or data/e1b-boil-scores.json)
// young = age < 8, settled = age >= 17; boil = RMS second temporal difference along the age taps / sqrt(6)
// (ages 2-7 for young, 17+ for settled); refBoil = the same statistic of that capture's reference.
import { readFileSync } from 'node:fs';
import { summarize } from './t1-summary.mjs';

const args = process.argv.slice(2);
const files = args.filter((a) => a.endsWith('.json'));
const pairs = (args.find((a) => a.startsWith('--pairs='))?.slice(8) ?? '').split(',').filter(Boolean).map((p) => p.split(':'));
const f2 = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '–');
const sg = (x, d = 2) => (Number.isFinite(x) ? (x >= 0 ? '+' : '') + x.toFixed(d) : '–');
const pc = (a, b) => (Number.isFinite(a) && Number.isFinite(b) && b ? sg((a / b - 1) * 100, 0) + ' %' : '–');

const byCap = {}; // window -> { 256: r, 4096: r }
// t1-score.mjs JSON files, or the compact data file (data/e1b-boil-scores.json: { scores: { <capture>: ... } })
const all = files.flatMap((f) => { const j = JSON.parse(readFileSync(f, 'utf8')); return j.scores ? Object.values(j.scores) : [j]; });
for (const r of all) {
  const spp = r.capture.startsWith('e1b4k-') ? 4096 : 256;
  const win = r.capture.replace(/^e1b(4k|256)-/, '');
  (byCap[win] ??= {})[spp] = r;
}
const refBoilOld = (r, sig, den) => { const a = r.acc[`${sig}|${den}`]; return a ? Math.sqrt(a.refBoil[17] / Math.max(a.boilN[17], 1)) / Math.sqrt(6) : NaN; };

for (const sig of ['diffuse', 'specular']) {
  console.log(`### ${sig}\n`);
  console.log('| window | denoiser | young 256 → 4096 | settled 256 → 4096 | all 256 → 4096 | FLIP young 256 → 4096 | boil young | ref boil young 256 / 4096 | boil settled | ref boil settled 256 / 4096 |');
  console.log('|---|---|---|---|---|---|---|---|---|---|');
  for (const [win, R] of Object.entries(byCap)) {
    const lo = R[256], hi = R[4096];
    if (!lo || !hi) continue;
    for (const den of hi.denoisers) {
      const a = summarize(lo, sig, den), b = summarize(hi, sig, den);
      if (!a || !b) continue;
      console.log(`| ${win} | ${den} | ${f2(a.young)} → ${f2(b.young)} | ${f2(a.old)} → ${f2(b.old)} | ${f2(a.all)} → ${f2(b.all)} | ${f2(a.flipY, 4)} → ${f2(b.flipY, 4)} | ${f2(b.boil, 4)} | ${f2(a.refBoil, 4)} / ${f2(b.refBoil, 4)} | ${f2(b.boilOld, 4)} | ${f2(refBoilOld(lo, sig, den), 4)} / ${f2(refBoilOld(hi, sig, den), 4)} |`);
    }
  }
  console.log('');
  if (!pairs.length) continue;
  console.log(`Candidate − base (${sig}), per window: Δ young / Δ settled / Δ all PSNR at 256 → 4096, FLIP young Δ at 4096, boil Δ (output-only, same at both):\n`);
  console.log('| window | pair | Δ young | Δ settled | Δ all | FLIP young (4096) | boil young | boil settled | flicker young (4096) |');
  console.log('|---|---|---|---|---|---|---|---|---|');
  for (const [win, R] of Object.entries(byCap)) {
    const lo = R[256], hi = R[4096];
    if (!lo || !hi) continue;
    for (const [bse, cnd] of pairs) {
      const a0 = summarize(lo, sig, bse), a1 = summarize(lo, sig, cnd), b0 = summarize(hi, sig, bse), b1 = summarize(hi, sig, cnd);
      if (!a0 || !a1 || !b0 || !b1) continue;
      console.log(`| ${win} | ${cnd} vs ${bse} | ${sg(a1.young - a0.young)} → ${sg(b1.young - b0.young)} | ${sg(a1.old - a0.old)} → ${sg(b1.old - b0.old)} | ${sg(a1.all - a0.all)} → ${sg(b1.all - b0.all)} | ${pc(b1.flipY, b0.flipY)} | ${pc(b1.boil, b0.boil)} | ${pc(b1.boilOld, b0.boilOld)} | ${pc(b1.flk, b0.flk)} |`);
    }
  }
  console.log('');
}
