#!/usr/bin/env node
// Rule-9 capture A/B table from t1-score.mjs JSON (results/T3-light-changes.md): per capture and signal, each arm vs the
// first (--base): pooled PSNR, young (age < 8) PSNR, FLIP (all receivers), motion-compensated boil in all / young /
// settled (age >= 17) pixels with the reference's own boil, and a q20 (a) boil flag: an increase over +5 % counts only
// when the arm's boil is also above the reference's boil in that region.
//   node t3-ab-table.mjs <score.json>... [--base ab-base] [--signals diffuse,specular]
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i < 0 ? d : args[i + 1]; };
const files = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
const BASE = opt('base', 'ab-base');
const sigs = opt('signals', 'diffuse,specular').split(',');
const f = (x, d = 2) => (x === null || x === undefined || !Number.isFinite(x) ? '–' : x.toFixed(d));
const sum = (a, lo, hi) => a.slice(lo, hi).reduce((u, v) => u + v, 0);
const YOUNG = 8, OLD = 17;

function metrics(a) {
  const psnr = (lo, hi) => { const n = sum(a.cnt, lo, hi); return n ? -10 * Math.log10(Math.max(sum(a.sse, lo, hi) / n, 1e-12)) : null; };
  const boil = (lo, hi) => { const n = sum(a.boilN, lo, hi); return n ? Math.sqrt(sum(a.boil, lo, hi) / n / 6) : null; };
  const rboil = (lo, hi) => { const n = sum(a.boilN, lo, hi); return n ? Math.sqrt(sum(a.refBoil, lo, hi) / n / 6) : null; };
  const fl = a.frames.map((x) => x.flipAll).filter((x) => x !== undefined && x !== null);
  return {
    mse: sum(a.sse, 0, 18) / sum(a.cnt, 0, 18), all: psnr(0, 18), young: psnr(0, YOUNG), flip: fl.length ? fl.reduce((u, v) => u + v, 0) / fl.length : null,
    boil: { all: boil(0, 18), young: boil(0, YOUNG), old: boil(OLD, 18) }, ref: { all: rboil(0, 18), young: rboil(0, YOUNG), old: rboil(OLD, 18) },
  };
}

const pooled = {};
for (const s of sigs) {
  console.log(`\n**${s}**\n`);
  console.log('| capture | arm | PSNR (Δ) | young (Δ) | FLIP Δ % | boil all / young / settled Δ % | ref boil all / settled | q20 boil flags |');
  console.log('|---|---|---|---|---|---|---|---|');
  for (const file of files) {
    const j = JSON.parse(readFileSync(file, 'utf8'));
    const b = j.acc[`${s}|${BASE}`];
    if (!b) continue;
    const mb = metrics(b);
    for (const d of j.denoisers) {
      const a = j.acc[`${s}|${d}`];
      if (!a) continue;
      const m = metrics(a);
      ((pooled[s] ??= {})[d] ??= []).push({ mse: m.mse, flip: m.flip, base: mb });
      const pct = (x, y) => (x !== null && y ? 100 * (x / y - 1) : null);
      const flags = ['all', 'young', 'old'].filter((r) => m.boil[r] !== null && mb.boil[r] && m.boil[r] > 1.05 * mb.boil[r] && m.boil[r] > (m.ref[r] ?? 0)).join(',');
      console.log(`| ${j.capture} | ${d} | ${f(m.all)} (${d === BASE ? '' : f(m.all - mb.all, 3)}) | ${f(m.young)} (${d === BASE ? '' : f(m.young - mb.young, 3)}) | ${d === BASE ? f(m.flip, 4) : f(pct(m.flip, mb.flip), 1)} | ` +
        `${d === BASE ? `${f(m.boil.all, 4)} / ${f(m.boil.young, 4)} / ${f(m.boil.old, 4)}` : `${f(pct(m.boil.all, mb.boil.all), 1)} / ${f(pct(m.boil.young, mb.boil.young), 1)} / ${f(pct(m.boil.old, mb.boil.old), 1)}`} | ` +
        `${f(m.ref.all, 4)} / ${f(m.ref.old, 4)} | ${d === BASE ? '' : flags || '—'} |`);
    }
  }
  console.log(`\npooled over ${files.length} captures (mean MSE):\n`);
  console.log('| arm | PSNR | Δ | mean FLIP Δ % |');
  console.log('|---|---|---|---|');
  const base = pooled[s]?.[BASE];
  for (const [d, xs] of Object.entries(pooled[s] ?? {})) {
    const db = -10 * Math.log10(xs.reduce((u, v) => u + v.mse, 0) / xs.length);
    const db0 = -10 * Math.log10(base.reduce((u, v) => u + v.mse, 0) / base.length);
    const fl = xs.reduce((u, v) => u + v.flip, 0) / base.reduce((u, v) => u + v.flip, 0);
    console.log(`| ${d} | ${f(db, 3)} | ${f(db - db0, 3)} | ${f(100 * (fl - 1), 2)} |`);
  }
}
