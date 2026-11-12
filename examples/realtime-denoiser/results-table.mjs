#!/usr/bin/env node
// Markdown tables from run-headless.mjs --json output (eval runs).
//   node results-table.mjs out/baseline-full.json [more.json ...] > tables.md
import { readFileSync } from 'node:fs';

const runs = process.argv.slice(2).flatMap((f) => JSON.parse(readFileSync(f, 'utf8')));
const f2 = (x) => (typeof x === 'number' && Number.isFinite(x) ? x.toFixed(2) : '–');
const f3 = (x) => (typeof x === 'number' && Number.isFinite(x) ? x.toFixed(3) : '–');
const f4 = (x) => (typeof x === 'number' && Number.isFinite(x) ? x.toFixed(4) : '–');
const pct = (x) => (typeof x === 'number' && Number.isFinite(x) ? `${(x * 100).toFixed(1)}%` : '–');

const bySignal = new Map();
for (const r of runs) {
  if (r.error || !r.results?.results) { console.error(`skip ${r.query}: ${r.error ?? 'no results'}`); continue; }
  const R = r.results;
  for (const [signal, dens] of Object.entries(R.results)) {
    if (!bySignal.has(signal)) bySignal.set(signal, []);
    for (const [id, x] of Object.entries(dens)) bySignal.get(signal).push({ path: R.path, id, x, R });
  }
}

const first = runs.find((r) => r.results)?.results;
if (first) {
  console.log(`_${first.width}x${first.height}, ${first.frames} frames/path, reference ${first.refSpp} spp, FLIP every ${first.flipEvery} frames at ${first.flipPpd} ppd, disoccluded = < ${first.ageK} frames of valid history._\n`);
}

for (const [signal, rows] of bySignal) {
  const scalar = signal === 'shadows';
  console.log(`### ${signal}\n`);
  console.log(`| path | denoiser | PSNR | settled | ${scalar ? 'penumbra' : 'disocc.'} | ${scalar ? 'disocc.' : 'after cut'} | FLIP | flicker | tPSNR | bias | energy | GPU ms |`);
  console.log('|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const { path, id, x } of rows) {
    const reg2 = scalar ? x.regions.penumbra.psnrDen : x.regions.disoccluded.psnrDen;
    const reg3 = scalar ? x.regions.disoccluded.psnrDen : x.psnrDenAfterCut;
    console.log(`| ${path} | ${id} | ${f2(x.psnrDen)} | ${f2(x.psnrDenSettled)} | ${f2(reg2)} | ${f2(reg3)} | ${f3(x.flipDen)} | ${f4(x.flickerDen)} | ${f2(x.tpsnrDen)} | ${f4(scalar ? x.regions.penumbra.biasDen : x.biasDen)} | ${pct(x.energyDen)} | ${f2(x.gpuMs?.total)} |`);
  }
  console.log('');
  // PSNR variants (RESULTS.md "What is measured"): mean of per-frame dB (the PSNR / settled
  // columns above), pooled = PSNR of the mean MSE over frames and pixels, capped = mean of
  // per-frame dB clipped at psnrCapDb. Regions in the table above were always pooled.
  // Runs from before these fields existed show '–'.
  const regName = scalar ? 'penumbra' : 'disocc.';
  const cap = rows.find((r) => r.x.psnrCapDb)?.x.psnrCapDb ?? 60;
  console.log(`PSNR: per-frame mean / pooled (PSNR of the mean MSE) / capped (per-frame dB ≤ ${cap}):\n`);
  console.log(`| path | denoiser | PSNR mean | pooled | capped | settled mean | settled pooled | settled capped | ${regName} mean | ${regName} pooled | ${regName} capped |`);
  console.log('|---|---|---|---|---|---|---|---|---|---|---|');
  for (const { path, id, x } of rows) {
    const g = scalar ? x.regions.penumbra : x.regions.disoccluded;
    console.log(`| ${path} | ${id} | ${f2(x.psnrDen)} | ${f2(x.psnrDenPooled)} | ${f2(x.psnrDenCapped)} | ${f2(x.psnrDenSettled)} | ${f2(x.psnrDenSettledPooled)} | ${f2(x.psnrDenSettledCapped)} | ${f2(g.psnrDenMean)} | ${f2(g.psnrDen)} | ${f2(g.psnrDenCapped)} |`);
  }
  console.log('');
  if (signal === 'specular') {
    console.log('Specular PSNR by roughness bin (pooled over the path):\n');
    console.log('| path | denoiser | r<0.15 | r<0.35 | r<0.6 | r≥0.6 |');
    console.log('|---|---|---|---|---|---|');
    for (const { path, id, x } of rows) {
      const g = x.regions;
      console.log(`| ${path} | ${id} | ${f2(g['rough<0.15'].psnrDen)} | ${f2(g['rough<0.35'].psnrDen)} | ${f2(g['rough<0.6'].psnrDen)} | ${f2(g['rough>=0.6'].psnrDen)} |`);
    }
    console.log('');
  }
}
