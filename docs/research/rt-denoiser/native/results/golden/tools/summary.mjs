#!/usr/bin/env node
// Cross-capture summary tables from calm.json (track D's calm.mjs): per signal, per capture, per denoiser:
// all-pixel PSNR, static PSNR, static boil, edge boil, disocc boil, dynamic error boil (x1e3), plus the reference's own boil.
//   node summary.mjs <outputsRoot> <capture,...> [--signals diffuse,specular] [--den a,b]
import { readFileSync, existsSync } from 'node:fs';
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i < 0 ? d : args[i + 1]; };
const [root, capsArg] = args;
const sigs = opt('signals', 'diffuse,specular').split(',');
const dens = opt('den', 'nrd-reblur,nrd-reblur-tunedD,nrd-reblur-tunedS,nrd-relax,ours-auto,ref').split(',');
const label = { 'nrd-reblur': 'REBLUR defaults', 'nrd-reblur-tunedD': 'REBLUR tuned D (A=0.01)', 'nrd-reblur-tunedS': 'REBLUR tuned S (0.1,0.1,1)', 'nrd-relax': 'RELAX defaults', 'ours-auto': 'ours (svgf-auto)', 'ours-occ': 'ours (occlusion-svgf-auto)', ref: 'reference (own boil)' };
const f = (x, d = 2) => (x == null || !Number.isFinite(x) ? '' : x.toFixed(d));
const pooled = (mse) => -10 * Math.log10(mse.reduce((a, b) => a + b, 0) / mse.length);
for (const s of sigs) {
  console.log(`\n### ${s}\n`);
  console.log('| capture | denoiser | all PSNR | static PSNR | static boil | edge boil | disocc boil | dynamic err-boil |');
  console.log('|---|---|---|---|---|---|---|---|');
  for (const c of capsArg.split(',')) {
    const file = `${root}/${c}/${s === 'ao' ? 'calm-ao' : s === 'visibility' ? 'calm-vis' : 'calm'}.json`;
    if (!existsSync(file)) continue;
    const j = JSON.parse(readFileSync(file, 'utf8'));
    for (const d of dens) {
      const r = j.rows[`${s}|${d}`]; if (!r) continue;
      const g = r.reg, k = 1e3;
      const isRef = d === 'ref';
      console.log(`| ${c.replace('golden-', '')} | ${label[d] ?? d} | ${isRef ? '' : f(pooled(r.perFrameMse))} | ${isRef ? '' : f(g.static.psnr)} | ${f(g.static.boil * k)} | ${f(g.edge.boil * k)} | ${f(g.disocc.boil * k)} | ${f((isRef ? g.dynamic.boil : g.dynamic.errBoil) * k)} |`);
    }
  }
}
