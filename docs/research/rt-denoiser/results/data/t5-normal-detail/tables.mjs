#!/usr/bin/env node
// Markdown tables from score.mjs JSON files (results/T5-normal-detail.md).
//   node tables.mjs <window> <score.json> [...] [--arms a,b] [--signals sh-diffuse,sh-specular]
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i < 0 ? d : args[i + 1]; };
const pos = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
const [win, ...files] = pos;
const f2 = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '–');
for (const s of opt('signals', 'sh-diffuse,sh-specular').split(',')) {
  for (const file of files) {
    const j = JSON.parse(readFileSync(file, 'utf8'));
    const arms = opt('arms') ? opt('arms').split(',') : j.arms;
    if (!j.scores[arms[0]]?.[s]?.[win]) continue;
    console.log(`\n**${j.capture}**, ${s}, window ${win} (mask ${j.mask})\n`);
    console.log('| arm | PSNR | bump | flat | gain | noise | band PSNR | FLIP | FLIP bump | flicker bump | boil bump | boil flat |');
    console.log('|---|---|---|---|---|---|---|---|---|---|---|---|');
    for (const a of arms) {
      const o = j.scores[a]?.[s]?.[win];
      if (!o) continue;
      console.log(`| ${a} | ${f2(o.all.psnr)} | ${f2(o.bump.psnr)} | ${f2(o.flat.psnr)} | ${f2(o.bump.gain, 3)} | ${f2(o.bump.noise, 3)} | ${f2(o.bump.bandPsnr)} | ${f2(o.all.flip, 4)} | ${f2(o.bump.flip, 4)} | ${f2(o.bump.flicker, 4)} | ${f2(o.bump.boil, 4)} | ${f2(o.flat.boil, 4)} |`);
    }
    const n = j.scores.noisy[s][win];
    console.log(`| reference (own boil) | | | | | | | | | | ${f2(n.bump.refBoil, 4)} | ${f2(n.flat.refBoil, 4)} |`);
  }
}
