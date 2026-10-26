#!/usr/bin/env node
// Markdown tables from t3-score.mjs JSON (results/T3-light-changes.md).
//   node t3-table.mjs <score.json>... [--arms a,b,c] [--names a=A,b=B] [--signals diffuse,specular]
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i < 0 ? d : args[i + 1]; };
const files = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
const arms = opt('arms', '').split(',').filter(Boolean);
const names = Object.fromEntries(opt('names', '').split(',').filter(Boolean).map((p) => p.split('=')));
const sigs = opt('signals', 'diffuse,specular,visibility').split(',');
const f2 = (x, d = 2) => (x === null || x === undefined || Number.isNaN(x) ? '–' : x.toFixed(d));

const rows = [];
for (const file of files) {
  const j = JSON.parse(readFileSync(file, 'utf8'));
  for (const s of sigs) {
    const sr = j.signals[s];
    if (!sr) continue;
    for (const [d, o] of Object.entries(sr.outputs)) {
      if (arms.length && !arms.includes(d)) continue;
      const w = o.windows;
      rows.push(`| ${j.capture.replace('lc540-', '')} | ${s} | ${names[d] ?? d} | ${f2(w.in.psnrDyn)} | ${f2(w.held.psnrDyn)} | ${f2(w.out.psnrDyn)} | ${f2(w.after.psnrDyn)} | ` +
        `${f2(w.in.flipDyn, 4)} / ${f2(w.out.flipDyn, 4)} | ${o.onset.t10} / ${o.return.t10} | ${f2(o.onset.oldAt[1])} / ${f2(o.return.oldAt[1])} | ` +
        `${o.onset.lag === null ? '–' : `${f2(o.onset.lag, 1)} / ${f2(o.return.lag, 1)}`} | ${f2(w.pre.boilStat * 1e4, 1)} / ${f2(w.in.boilStat * 1e4, 1)} / ${f2(w.out.boilStat * 1e4, 1)} | ${f2(w.held.psnrStat)} |`);
    }
  }
}
console.log('| path | signal | arm | dyn PSNR in | held | out | after | dyn FLIP in / out | t10 on / ret | old@1 on / ret | lag on / ret | static boil ×1e4 pre / in / out | static PSNR held |');
console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const r of rows) console.log(r);
