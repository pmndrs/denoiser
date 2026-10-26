#!/usr/bin/env node
// Live 1080p A/B table of the SH options on the 7 standard paths (results/T5-normal-detail.md §5):
//   node live-table.mjs <dir with <path>-<refspp>.json> [base id]
import { existsSync, readFileSync } from 'node:fs';
const dir = process.argv[2], base = process.argv[3] ?? 'svgf-sh-auto';
const runs = ['orbit-256', 'pan-256', 'light-256', 'thin-256', 'glossy-256', 'cut-256', 'object-256', 'orbit-4096', 'light-4096', 'glossy-4096'];
const f = (x, d = 3) => (Number.isFinite(x) ? `${x >= 0 ? '+' : ''}${x.toFixed(d)}` : '–');
const pct = (a, b) => (b ? (100 * (a - b)) / b : NaN);
for (const s of ['sh-diffuse', 'sh-specular']) {
  const pooled = {};
  console.log(`\n${s}: candidate − ${base} (pooled dB, disoccluded dB, FLIP %, flicker % (motion-compensated), tPSNR dB)\n`);
  let ids = null;
  for (const r of runs) {
    const file = `${dir}/${r}.json`;
    if (!existsSync(file)) continue;
    const R = JSON.parse(readFileSync(file, 'utf8'))[0].results.results[s];
    ids ??= Object.keys(R).filter((k) => k !== base);
    if (r === runs[0] || !pooled.hdr) { console.log(`| run | ${base} pooled | ${ids.join(' | ')} |`); console.log(`|---|---|${ids.map(() => '---').join('|')}|`); pooled.hdr = 1; }
    const b = R[base];
    const cells = ids.map((k) => { const x = R[k]; return `${f(x.psnrDenPooled - b.psnrDenPooled)} / ${f(x.regions.disoccluded.psnrDenPooled - b.regions.disoccluded.psnrDenPooled, 2)} / ${f(pct(x.flipDen, b.flipDen), 1)} % / ${f(pct(x.flickerMcDen, b.flickerMcDen), 1)} % / ${f(x.tpsnrDen - b.tpsnrDen, 2)}`; });
    console.log(`| ${r} | ${b.psnrDenPooled.toFixed(3)} | ${cells.join(' | ')} |`);
  }
}
