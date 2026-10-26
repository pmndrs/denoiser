import { readdirSync, readFileSync } from 'node:fs';
const dir = process.argv[2], base = process.argv[3] ?? 'svgf-auto';
const f = (x, d = 2) => (x == null || Number.isNaN(+x) ? '–' : (+x).toFixed(d));
const runs = readdirSync(dir).filter((x) => x.endsWith('.json')).map((x) => { const j = JSON.parse(readFileSync(`${dir}/${x}`)); return Array.isArray(j) ? j[0] : j; });
const order = ['rm-cam-plane', 'rm-cam-plane-r10', 'rm-cam-plane-r20', 'rm-cam-plane-r35', 'rm-cam-plane-r50', 'rm-bump-plane', 'rm-graze-plane', 'rm-obj-plane', 'rm-obj-exit', 'rm-refl-slide', 'rm-refl-turn', 'rm-cam-convex', 'rm-obj-convex', 'rm-refl-ball', 'rm-cam-concave', 'rm-cut-plane'];
runs.sort((a, b) => order.indexOf(a.results.path) - order.indexOf(b.results.path));
const keys = Object.keys(runs[0].results.results.specular).filter((k) => k !== base);
const sh = (k) => k.replace(/svgf-auto@|svgf@/, (m) => (m === 'svgf@' ? 'off+' : '')).replace('reflectionReprojection=', '').replace('reflectionHitTest=1', 'hit').replace(/@/g, '+');
console.log(`| path | m | ${base}: ROI mov / hold, trail | ${keys.map((k) => `${sh(k)}: Δmov / Δhold, trail`).join(' | ')} |`);
console.log(`|---|---|---|${keys.map(() => '---').join('|')}|`);
for (const r of runs) for (const m of r.results.reflect.markers) {
  if (!m) continue;
  const b = m.results[base];
  console.log(`| ${r.results.path} | ${m.marker} | ${f(b.roiPsnrMoving)} / ${f(b.roiPsnrHold)}, ${f(b.trailMoving, 1)} | ${keys.map((k) => { const v = m.results[k]; return `${f(v.roiPsnrMoving - b.roiPsnrMoving)} / ${f(v.roiPsnrHold - b.roiPsnrHold)}, ${f(v.trailMoving, 1)}`; }).join(' | ')} |`);
}
console.log();
console.log(`| path | ${base}: pooled / refl. bin / dynamic / FLIP | ${keys.map((k) => `${sh(k)}: Δpooled / Δbin / Δdyn / FLIP %`).join(' | ')} |`);
console.log(`|---|---|${keys.map(() => '---').join('|')}|`);
for (const r of runs) {
  const R = r.results, rough = R.path.match(/-r(\d+)$/) ? +R.path.match(/-r(\d+)$/)[1] / 100 : 0.02;
  const bin = rough < 0.15 ? 'rough<0.15' : rough < 0.35 ? 'rough<0.35' : 'rough<0.6';
  const b = R.results.specular[base];
  console.log(`| ${R.path} | ${f(b.psnrDenPooled)} / ${f(b.regions[bin].psnrDen)} / ${f(b.regions.dynamic.psnrDen)} / ${f(b.flipDen, 4)} | ${keys.map((k) => { const v = R.results.specular[k]; return `${f(v.psnrDenPooled - b.psnrDenPooled)} / ${f(v.regions[bin].psnrDen - b.regions[bin].psnrDen)} / ${f(v.regions.dynamic.psnrDen - b.regions.dynamic.psnrDen)} / ${f(100 * (v.flipDen / b.flipDen - 1), 1)}`; }).join(' | ')} |`);
}
