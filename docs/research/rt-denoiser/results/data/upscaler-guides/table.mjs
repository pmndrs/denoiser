// Markdown tables from run.mjs JSON outputs: node table.mjs <dir> [channels...]
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
const [dir, ...chs] = process.argv.slice(2);
const CH = chs.length ? chs : ['svgf-off', 'recurrent', 'shadows', 'svgf-off-nomz', 'fsr3>=any', 'fsr3>=0.5', 'fsr3>=0.99', 'svgf-off|fsr3>=0.5', 'shadows|fsr3>=0.5'];
const pct = (a, b) => (b ? (100 * a / b).toFixed(1) : '–');
const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
console.log('| run | GT px (int.) | detector | recall | precision | FN int. | FP int. | recall band | precision band |');
console.log('|---|---|---|---|---|---|---|---|---|');
const pooled = {};
for (const f of files) {
  const d = JSON.parse(readFileSync(path.join(dir, f)));
  const name = d.query.replace(/&?(w|h)=\d+/g, '').replace('mode=capture&capture=', '').replace('path=', '').replace(/&frames=\d+/, '');
  for (const c of CH) {
    const v = d.channels[c]; if (!v) continue;
    const P = v.TP + v.FN, Pi = v.TPi + v.FNi;
    const bTP = v.TP - v.TPi, bFN = v.FN - v.FNi, bFP = v.FP - v.FPi;
    const p = (pooled[c] ??= { TP: 0, FN: 0, FP: 0, TPi: 0, FNi: 0, FPi: 0 });
    for (const k of Object.keys(p)) p[k] += v[k];
    console.log(`| ${name} | ${P} (${Pi}) | ${c} | ${pct(v.TP, P)} | ${pct(v.TP, v.TP + v.FP)} | ${v.FNi} | ${v.FPi} | ${pct(bTP, bTP + bFN)} | ${pct(bTP, bTP + bFP)} |`);
  }
}
console.log('\npooled:');
for (const [c, v] of Object.entries(pooled)) {
  const bTP = v.TP - v.TPi, bFN = v.FN - v.FNi, bFP = v.FP - v.FPi;
  console.log(`| pooled | ${v.TP + v.FN} (${v.TPi + v.FNi}) | ${c} | ${pct(v.TP, v.TP + v.FN)} | ${pct(v.TP, v.TP + v.FP)} | ${v.FNi} | ${v.FPi} | ${pct(bTP, bTP + bFN)} | ${pct(bTP, bTP + bFP)} |`);
}
