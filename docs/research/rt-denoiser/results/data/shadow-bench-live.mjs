#!/usr/bin/env node
// Live 1080p test-bed A/B for results/SHADOW-BENCH.md: one run-headless --json file per path (signal=shadows, several
// denoiser ids), each variant against the first one (shipped defaults). Pooled PSNR (all / penumbra / disoccluded),
// FLIP, motion-compensated flicker, GPU ms.
//
//   node shadow-bench-live.mjs <dir with <path>.json> [--json out.json]
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const dir = process.argv[2];
const jsonOut = process.argv.includes('--json') ? process.argv[process.argv.indexOf('--json') + 1] : null;
const PATHS = ['orbit', 'pan', 'light', 'thin', 'glossy', 'cut', 'object'];
const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
const runs = Object.fromEntries(PATHS.filter((p) => files.includes(`${p}.json`)).map((p) => {
  const j = JSON.parse(readFileSync(path.join(dir, `${p}.json`), 'utf8'));
  return [p, (Array.isArray(j) ? j[0] : j).results.results.shadows];
}));
const ids = Object.keys(Object.values(runs)[0] ?? {});
const base = ids[0];
const f2 = (x, k = 2) => (Number.isFinite(x) ? x.toFixed(k) : '–');
const sg = (x, k = 2) => (Number.isFinite(x) ? `${x >= 0 ? '+' : ''}${x.toFixed(k)}` : '–');
const pct = (x) => (Number.isFinite(x) ? `${x >= 0 ? '+' : ''}${(100 * x).toFixed(0)} %` : '–');
const row = (r) => ({
  pooled: r.psnrDenPooled, pen: r.regions?.penumbra?.psnrDenPooled, dis: r.regions?.disoccluded?.psnrDenPooled,
  flip: r.flipDen, flick: r.flickerMcDen ?? r.flickerDen, gpu: r.gpuMs?.total,
});
const out = {};
const lines = [`| variant | ${Object.keys(runs).map((p) => `${p} Δ dB`).join(' | ')} | mean Δ | worst Δ | penumbra Δ (mean) | disoccluded Δ | FLIP Δ | flicker Δ | GPU Δ |`,
  `|---|${Object.keys(runs).map(() => '---').join('|')}|---|---|---|---|---|---|---|`];
for (const id of ids) {
  const per = Object.entries(runs).map(([p, r]) => ({ p, v: row(r[id]), b: row(r[base]) }));
  const d = per.map((x) => x.v.pooled - x.b.pooled);
  const m = (f) => per.reduce((a, x) => a + f(x), 0) / per.length;
  const o = {
    perPath: Object.fromEntries(per.map((x, i) => [x.p, { ...x.v, dPooled: d[i] }])),
    dMean: m((x) => x.v.pooled - x.b.pooled), dWorst: Math.min(...d), dPen: m((x) => x.v.pen - x.b.pen), dDis: m((x) => x.v.dis - x.b.dis),
    flipR: m((x) => x.v.flip / x.b.flip - 1), flickR: m((x) => x.v.flick / x.b.flick - 1), gpuR: m((x) => x.v.gpu / x.b.gpu - 1),
  };
  out[id] = o;
  lines.push(`| ${id} | ${d.map((x) => sg(x)).join(' | ')} | ${sg(o.dMean, 3)} | ${sg(o.dWorst, 3)} | ${sg(o.dPen, 3)} | ${sg(o.dDis, 3)} | ${pct(o.flipR)} | ${pct(o.flickR)} | ${pct(o.gpuR)} |`);
}
lines.push('', `Base \`${base}\` pooled dB per path: ${Object.entries(runs).map(([p, r]) => `${p} ${f2(r[base].psnrDenPooled)}`).join(', ')}.`);
console.log(lines.join('\n'));
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(out, null, 1));
