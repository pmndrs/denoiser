#!/usr/bin/env node
// Summary matrix of results/T5-normal-detail.md §3: per capture (window) and arm, "PSNR / bump gain / FLIP / bump boil",
// from the score.mjs JSONs in <dir> (files <capture>.arms-*.json are merged).   node summary.mjs <dir> [arms]
import { readdirSync, readFileSync } from 'node:fs';
const dir = process.argv[2];
const arms = (process.argv[3] ?? 'def,def-y0,smooth,rec,sh,sh-y16,sh-s1,sh-dp8,sh-dp16,sh-dp32').split(',');
const caps = [['t5-bumpy', 'settled'], ['t5-grooves', 'settled'], ['t5-fine', 'settled'], ['t5-bounce', 'settled'], ['t5-light', 'hold'], ['t5-light', 'move'],
  ['t5-light-grooves', 'hold'], ['t5-light-grooves', 'move'], ['t5-smooth', 'settled'], ['t5-light-smooth', 'hold']];
for (const s of ['sh-diffuse', 'sh-specular']) {
  console.log(`\n${s}: PSNR / bump gain / FLIP / bump boil\n`);
  console.log(`| capture (window) | ${arms.join(' | ')} | reference boil |`);
  console.log(`|---|${arms.map(() => '---').join('|')}|---|`);
  for (const [c, w] of caps) {
    const sc = {};
    for (const f of readdirSync(dir).filter((f) => f.startsWith(`${c}.arms`) && f.endsWith('.json'))) Object.assign(sc, JSON.parse(readFileSync(`${dir}/${f}`, 'utf8')).scores);
    if (!sc.noisy) continue;
    const row = arms.map((a) => { const o = sc[a]?.[s]?.[w]; return o ? `${o.all.psnr.toFixed(2)} / ${o.bump.gain?.toFixed(2)} / ${o.all.flip.toFixed(4)} / ${o.bump.boil.toFixed(4)}` : '–'; });
    console.log(`| ${c} (${w}) | ${row.join(' | ')} | ${sc.noisy[s][w].bump.refBoil.toFixed(4)} |`);
  }
}
