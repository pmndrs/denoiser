#!/usr/bin/env node
// One markdown table per signal from the compare.json files of a capture set (after
// `run-headless.mjs --set=<set> --replay=...`): rows = captures, columns = denoisers,
// cells = sequence PSNR / settled PSNR / flicker, then a second table with the PSNR variants
// (per-frame mean / pooled / capped). Native NRD folders (nrd-*) in the same
// outputs show up as extra columns.
//
//   node replay-table.mjs [--set=standard] [--denoisers=passthrough,accumulate-32,svgf] [--outputs=<root>]
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { OUTPUTS_DIR } from '../../tools/rt-capture/lib/capture.mjs';
import { CAPTURE_SETS } from './capture-sets.mjs';

const flag = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const set = CAPTURE_SETS[flag('set') ?? 'standard'];
const root = path.resolve(flag('outputs') ?? OUTPUTS_DIR);
const only = flag('denoisers')?.split(',');
const f2 = (x) => (typeof x === 'number' && Number.isFinite(x) ? x.toFixed(2) : '–');
const f4 = (x) => (typeof x === 'number' && Number.isFinite(x) ? x.toFixed(4) : '–');

const rows = [];
for (const c of set) {
  const f = path.join(root, c.name, 'compare.json');
  if (!existsSync(f)) { console.error(`no ${f}`); continue; }
  for (const r of JSON.parse(readFileSync(f, 'utf8')).results) rows.push({ capture: c.name, ...r });
}
for (const signal of ['diffuse', 'specular', 'visibility']) {
  const rs = rows.filter((r) => r.signal === signal && (!only || only.includes(r.denoiser)));
  const dens = [...new Set(rs.map((r) => r.denoiser))];
  if (!dens.length) continue;
  console.log(`\n#### ${signal} (PSNR / settled / flicker${signal === 'visibility' ? ' / penumbra' : ''})\n`);
  console.log(`| capture | ${dens.join(' | ')} |`);
  console.log(`|---|${dens.map(() => '---').join('|')}|`);
  for (const c of set) {
    const cells = dens.map((d) => {
      const r = rs.find((x) => x.capture === c.name && x.denoiser === d);
      if (!r) return '–';
      return `${f2(r.psnr)} / ${f2(r.psnrSettled)} / ${f4(r.flicker)}${signal === 'visibility' ? ` / ${f2(r.psnrPenumbra)}` : ''}${r.nonFinite ? ` (${r.nonFinite} NaN)` : ''}`;
    });
    console.log(`| ${c.name} | ${cells.join(' | ')} |`);
  }
  // PSNR variants (CAPTURE-FORMAT "Metrics for replay outputs"): per-frame mean (as above),
  // pooled = PSNR of the mean MSE over frames and pixels, capped = per-frame dB clipped at
  // 60 dB before the mean. compare.json files written before these fields existed show '–'.
  console.log(`\n#### ${signal} (PSNR mean / pooled / capped · settled pooled${signal === 'visibility' ? ' · penumbra pooled' : ''})\n`);
  console.log(`| capture | ${dens.join(' | ')} |`);
  console.log(`|---|${dens.map(() => '---').join('|')}|`);
  for (const c of set) {
    const cells = dens.map((d) => {
      const r = rs.find((x) => x.capture === c.name && x.denoiser === d);
      if (!r) return '–';
      return `${f2(r.psnr)} / ${f2(r.psnrPooled)} / ${f2(r.psnrCapped)} · ${f2(r.psnrSettledPooled)}${signal === 'visibility' ? ` · ${f2(r.psnrPenumbraPooled)}` : ''}`;
    });
    console.log(`| ${c.name} | ${cells.join(' | ')} |`);
  }
}
