// summarize detection JSONs: node sum.mjs <files...>
import { readFileSync } from 'node:fs';
const files = process.argv.slice(2);
const tot = {};
for (const f of files) {
  const j = JSON.parse(readFileSync(f, 'utf8'));
  console.log(`\n${j.query} (${j.W}x${j.H}, ${j.frames} frames)`);
  console.log('| detector | recall % | precision % | wrong-surface missed | interior missed ‰ | interior false ‰ | band recall % | band precision % | resets/frame |');
  console.log('|---|---|---|---|---|---|---|---|---|');
  for (const [k, c] of Object.entries(j.channels)) {
    (tot[k] ??= { TP: 0, FP: 0, FN: 0, TN: 0, TPi: 0, FPi: 0, FNi: 0, TNi: 0, hard: 0, FNhard: 0, frames: 0 });
    for (const x of Object.keys(c)) tot[k][x] += c[x];
    tot[k].frames += j.frames;
    row(k, c, j.frames);
  }
}
function row(k, c, frames) {
  const bTP = c.TP - c.TPi, bFP = c.FP - c.FPi, bFN = c.FN - c.FNi;
  const p = (a, b) => (b ? (100 * a / b).toFixed(1) : '–');
  const pm = (a, b) => (b ? (1000 * a / b).toFixed(2) : '–');
  console.log(`| ${k} | ${p(c.TP, c.TP + c.FN)} | ${p(c.TP, c.TP + c.FP)} | ${c.hard ? (100 * c.FNhard / c.hard).toFixed(2) + ' % (' + c.FNhard + ')' : '–'} | ${pm(c.FNi, c.TPi + c.FNi)} | ${pm(c.FPi, c.FPi + c.TNi)} | ${p(bTP, bTP + bFN)} | ${p(bTP, bTP + bFP)} | ${Math.round((c.TP + c.FP) / Math.max(1, frames))} |`);
}
if (files.length > 1) {
  console.log('\npooled');
  console.log('| detector | recall % | precision % | wrong-surface missed | interior missed ‰ | interior false ‰ | band recall % | band precision % | resets/frame |');
  console.log('|---|---|---|---|---|---|---|---|---|');
  for (const [k, c] of Object.entries(tot)) row(k, c, c.frames);
}
