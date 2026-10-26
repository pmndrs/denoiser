// SVGF 3x3-fallback A/B summary: node ab.mjs <dir with A-<path>.json, B-<path>.json>
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
const dir = process.argv[2];
const load = (f) => { const j = JSON.parse(readFileSync(path.join(dir, f))); return (Array.isArray(j) ? j[0] : j).results.results; };
console.log('| path | signal | all A | all B | Δ | disoccluded A | disoccluded B | Δ | flicker (mc) A | B |');
console.log('|---|---|---|---|---|---|---|---|---|---|');
for (const f of readdirSync(dir).filter((x) => x.startsWith('A-')).sort()) {
  const p = f.slice(2, -5);
  const A = load(f), B = load(`B-${p}.json`);
  for (const s of ['diffuse', 'specular']) {
    const a = A[s]['svgf-auto'], b = B[s]['svgf-auto'];
    const ra = a.regions, rb = b.regions;
    const d = (x, y) => (y - x >= 0 ? '+' : '') + (y - x).toFixed(3);
    console.log(`| ${p} | ${s} | ${ra.all.psnrDen.toFixed(3)} | ${rb.all.psnrDen.toFixed(3)} | ${d(ra.all.psnrDen, rb.all.psnrDen)} | ${ra.disoccluded.psnrDen.toFixed(3)} | ${rb.disoccluded.psnrDen.toFixed(3)} | ${d(ra.disoccluded.psnrDen, rb.disoccluded.psnrDen)} | ${a.flickerMcDen} | ${b.flickerMcDen} |`);
  }
}
