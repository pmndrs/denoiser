// Wrong-surface misses: node hard.mjs <dir> -> per run, per detector: missed / hard GT pixels (live runs only)
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
const [dir, ...chs] = process.argv.slice(2);
const CH = chs.length ? chs : ['svgf-off', 'recurrent', 'shadows', 'svgf-off-nomz', 'fsr3>=any', 'fsr3>=0.5', 'fsr3>=0.75', 'svgf-off|fsr3>=0.5', 'shadows|fsr3>=0.5'];
const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
console.log(`| run | hard GT px | ${CH.join(' | ')} |`);
console.log(`|---|---|${CH.map(() => '---').join('|')}|`);
const pool = { hard: 0 }; const pm = {};
for (const f of files) {
  const d = JSON.parse(readFileSync(path.join(dir, f)));
  const name = d.query.replace(/&?(w|h)=\d+/g, '').replace('path=', '');
  const hard = d.channels[CH[0]].hard;
  if (!hard) continue;
  pool.hard += hard;
  console.log(`| ${name} | ${hard} | ${CH.map((c) => { const v = d.channels[c].FNhard; pm[c] = (pm[c] ?? 0) + v; return `${v} (${(100 * v / hard).toFixed(1)} %)`; }).join(' | ')} |`);
}
console.log(`| pooled | ${pool.hard} | ${CH.map((c) => `${pm[c]} (${(100 * pm[c] / pool.hard).toFixed(2)} %)`).join(' | ')} |`);
