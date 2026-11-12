// Doc table: node doc-table.mjs <dir> [channels...]. Recall / precision over all receivers, the interior (1-px silhouette
// band removed) misses and false alarms in ‰ of the interior positives / negatives, the band's recall / precision,
// and the wrong-surface misses (live runs: GT-disoccluded pixels with no same-object texel in the 3x3 around the
// true reprojection, i.e. any kept history is another surface).
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
const [dir, ...chs] = process.argv.slice(2);
const CH = chs.length ? chs : ['svgf-off', 'recurrent', 'shadows', 'fsr3>=0.5', 'shadows|fsr3>=0.5'];
const NAME = { 'svgf-off': 'ours, SVGF', recurrent: 'ours, recurrent', shadows: 'ours, shadows', 'svgf-off-nomz': 'ours, SVGF without motion_z', 'fsr3>=any': 'fsr3 > 0', 'fsr3>=0.5': 'fsr3 ≥ 0.5', 'fsr3>=0.75': 'fsr3 ≥ 0.75', 'fsr3>=0.99': 'fsr3 ≥ 0.99', 'shadows|fsr3>=0.5': 'shadows ∪ fsr3 ≥ 0.5', 'svgf-off|fsr3>=0.5': 'SVGF ∪ fsr3 ≥ 0.5' };
const f1 = (a, b) => (b ? (100 * a / b).toFixed(1) : '–');
const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
console.log('| run | detector | recall % | precision % | wrong-surface missed | interior missed ‰ | interior false ‰ | band recall % | band precision % |');
console.log('|---|---|---|---|---|---|---|---|---|');
const pool = {};
const row = (name, c, v) => {
  const P = v.TP + v.FN, Pi = v.TPi + v.FNi, Ni = v.FPi + v.TNi;
  const bTP = v.TP - v.TPi, bFN = v.FN - v.FNi, bFP = v.FP - v.FPi;
  const hard = v.hard ? `${f1(v.FNhard, v.hard)} % (${v.FNhard})` : '–';
  console.log(`| ${name} | ${NAME[c] ?? c} | ${f1(v.TP, P)} | ${f1(v.TP, v.TP + v.FP)} | ${hard} | ${(1000 * v.FNi / Math.max(Pi, 1)).toFixed(2)} | ${(1000 * v.FPi / Math.max(Ni, 1)).toFixed(2)} | ${f1(bTP, bTP + bFN)} | ${f1(bTP, bTP + bFP)} |`);
};
for (const f of files) {
  const d = JSON.parse(readFileSync(path.join(dir, f)));
  const name = d.query.replace(/&?(w|h)=\d+/g, '').replace('mode=capture&capture=', '').replace('path=', '').replace(/&frames=\d+/, '');
  if (name === 'light') continue;
  for (const c of CH) {
    const v = d.channels[c];
    const p = (pool[c] ??= {});
    for (const [k, x] of Object.entries(v)) p[k] = (p[k] ?? 0) + (x ?? 0);
    row(`${name} (${v.TP + v.FN} px)`, c, v);
  }
}
for (const c of CH) row('**pooled**', c, pool[c]);
