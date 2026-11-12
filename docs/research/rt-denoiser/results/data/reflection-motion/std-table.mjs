#!/usr/bin/env node
// Rule-9 table of the reflection options on the 7 standard paths (results/REFLECTION-MOTION.md §6): specular, 1080p,
// test-bed eval JSON (one file per path, every arm in one page). orbit / light / glossy pages ran with
// refspp=4096&ref2spp=256&ref2salt=0: the main scores are against 4096 spp, `vsRef2` against the standard 256-spp set.
//   node std-table.mjs <dir with std-<path>.json> [base id]
import { readdirSync, readFileSync } from 'node:fs';

const dir = process.argv[2], base = process.argv[3] ?? 'svgf-auto';
const f = (x, d = 2) => (x == null || Number.isNaN(+x) ? '–' : (+x).toFixed(d));
const sg = (x, d = 2) => (x == null || Number.isNaN(+x) ? '–' : `${x >= 0 ? '+' : ''}${(+x).toFixed(d)}`);
const pct = (a, b) => sg(100 * (a / b - 1), 1);
const order = ['orbit', 'light', 'glossy', 'pan', 'thin', 'cut', 'object'];
const runs = readdirSync(dir).filter((x) => /^std-.*\.json$/.test(x)).map((x) => { const j = JSON.parse(readFileSync(`${dir}/${x}`)); return Array.isArray(j) ? j[0] : j; })
  .filter((r) => r?.results?.results).sort((a, b) => order.indexOf(a.results.path) - order.indexOf(b.results.path));
const keys = Object.keys(runs[0].results.results.specular).filter((k) => k !== base);
const regs = ['disoccluded', 'dynamic', 'rough<0.15', 'rough<0.35', 'rough<0.6', 'rough>=0.6'];
for (const k of keys) {
  console.log(`\n**${k}** vs ${base} (Δ dB; FLIP / flicker in %)\n`);
  console.log(`| path | ref spp | ${base} pooled | Δ pooled | ${regs.map((r) => `Δ ${r}`).join(' | ')} | FLIP | flicker (mc) | Δ pooled @256 |`);
  console.log(`|---|---|---|---|${regs.map(() => '---').join('|')}|---|---|---|`);
  const pool = { b: [0, 0], c: [0, 0] };
  for (const r of runs) {
    const R = r.results, b = R.results.specular[base], c = R.results.specular[k];
    const spp = R.refSpp;
    const d256 = b.vsRef2 && c.vsRef2 ? sg(c.vsRef2.psnrDenPooled - b.vsRef2.psnrDenPooled) : '(=)';
    console.log(`| ${R.path} | ${spp} | ${f(b.psnrDenPooled)} | ${sg(c.psnrDenPooled - b.psnrDenPooled)} | ${regs.map((g) => sg(c.regions[g].psnrDen - b.regions[g].psnrDen)).join(' | ')} | ${pct(c.flipDen, b.flipDen)} | ${pct(c.flickerMcDen, b.flickerMcDen)} | ${d256} |`);
    // pool the MSE over paths for a 7-path pooled number (equal pixel weights per frame)
    for (const [o, x] of [[pool.b, b], [pool.c, c]]) { o[0] += 10 ** (-x.psnrDenPooled / 10); o[1] += 1; }
  }
  const pdb = (o) => -10 * Math.log10(o[0] / o[1]);
  console.log(`| **7 paths (mean MSE)** | | ${f(pdb(pool.b))} | ${sg(pdb(pool.c) - pdb(pool.b))} | | | | | | | | | |`);
}
