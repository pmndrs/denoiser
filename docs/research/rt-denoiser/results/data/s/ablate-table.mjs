#!/usr/bin/env node
// Track S: compact ablation table from knot-boil.mjs JSON: per denoiser, static penumbra (boilG, blob5, p99, p999, PSNR),
// moving-region (boilG, p99), whole frame (p999, PSNR), relative to s-def and s-ffx.   node ablate-table.mjs <json>
import { readFileSync } from 'node:fs';
const j = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const D = j.denoisers, base = D['s-def'], ffx = D['s-ffx'];
const cols = [['penumbra', 'boilG'], ['penumbra', 'blob5'], ['penumbra', 'p99'], ['penumbra', 'p999'], ['penumbra', 'psnr'], ['moving', 'boilG'], ['moving', 'p99'], ['all', 'p999'], ['all', 'psnr']];
console.log(`| ${j.capture} | ${cols.map(([r, k]) => `${r} ${k}`).join(' | ')} |`);
console.log(`|---|${cols.map(() => '---').join('|')}|`);
for (const [d, s] of Object.entries(D)) {
  const cells = cols.map(([r, k]) => {
    const v = s[r]?.[k];
    if (!Number.isFinite(v)) return '–';
    if (k === 'psnr') return v.toFixed(2);
    const rel = d === 's-def' || d === 'ref' ? '' : ` (${((v / base[r][k] - 1) * 100).toFixed(0)} %)`;
    return v.toFixed(4) + rel;
  });
  console.log(`| ${d} | ${cells.join(' | ')} |`);
}
