#!/usr/bin/env node
// Tables for results/T8-jitter.md from score.mjs JSON (one file per capture: t8-<scene>-off, -h8, -h8-raw).
//   node table.mjs <scores dir>
// Every comparison is configuration against its OWN reference: "off" vs the unjittered per-frame reference, "h8" vs the
// jittered one (R1), and on holds also vs R2 (the window mean of R1). Deltas are h8 - off (dB) or h8 / off - 1 (%).
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const dir = process.argv[2];
const load = (n) => { try { return JSON.parse(readFileSync(path.join(dir, `${n}.json`), 'utf8'))[0]; } catch { return null; } };
const SCENES = ['thin', 'glossy'];
const SIGS = ['diffuse', 'specular', 'visibility', 'ao', 'so'];
const DEN = { diffuse: ['svgf-auto', 'recurrent'], specular: ['svgf-auto', 'recurrent'], visibility: ['shadows'], ao: ['occlusion-svgf-auto'], so: ['occlusion-svgf-auto'] };
const f = (x, k = 2) => (Number.isFinite(x) ? x.toFixed(k) : '–');
const pct = (a, b) => (Number.isFinite(a) && Number.isFinite(b) && b ? `${(100 * (a / b - 1)).toFixed(1)} %` : '–');
const dB = (a, b) => (Number.isFinite(a) && Number.isFinite(b) ? `${a - b >= 0 ? '+' : ''}${(a - b).toFixed(2)}` : '–');
const row = (cap, w, s, d) => cap?.rows.find((r) => r.window === w && r.signal === s && r.denoiser === d);

for (const scene of SCENES) {
  const off = load(`t8-${scene}-off`), on = load(`t8-${scene}-h8`), raw = load(`t8-${scene}-h8-raw`);
  if (!off || !on) continue;
  console.log(`\n### ${scene}: motion ${JSON.stringify(on.speed)}\n`);
  for (const w of ['holdA', 'pan', 'holdB']) {
    console.log(`\n#### ${scene}, ${w}: jitter off vs on, each against its own per-frame reference (R1)\n`);
    console.log('| signal | denoiser | PSNR off / on (Δ) | boundary PSNR off / on (Δ) | FLIP off / on (Δ) | boundary FLIP off / on (Δ) | boil off / on (Δ) [ref off / on] | boundary boil off / on [ref] | brightness off / on | sharpness off / on |');
    console.log('|---|---|---|---|---|---|---|---|---|---|');
    for (const s of SIGS) for (const d of DEN[s]) {
      const a = row(off, w, s, d), b = row(on, w, s, d), ra = row(off, w, s, 'reference'), rb = row(on, w, s, 'reference');
      if (!a || !b) continue;
      console.log(`| ${s} | ${d} | ${f(a.psnr)} / ${f(b.psnr)} (${dB(b.psnr, a.psnr)}) | ${f(a.psnrB)} / ${f(b.psnrB)} (${dB(b.psnrB, a.psnrB)}) | ${f(a.flip, 4)} / ${f(b.flip, 4)} (${pct(b.flip, a.flip)}) | ${f(a.flipB, 4)} / ${f(b.flipB, 4)} (${pct(b.flipB, a.flipB)}) | ${f(a.boil, 4)} / ${f(b.boil, 4)} (${pct(b.boil, a.boil)}) [${f(ra.boil, 4)} / ${f(rb.boil, 4)}] | ${f(a.boilB, 4)} / ${f(b.boilB, 4)} [${f(ra.boilB, 4)} / ${f(rb.boilB, 4)}] | ${f(100 * a.bright, 2)} % / ${f(100 * b.bright, 2)} % | ${f(a.sharp, 3)} / ${f(b.sharp, 3)} |`);
    }
    if (!w.startsWith('hold')) continue;
    console.log(`\n#### ${scene}, ${w}: against R2 (window mean of the reference; off: R2 = R1)\n`);
    console.log('| signal | denoiser | PSNR vs R2 off / on (Δ) | boundary PSNR vs R2 off / on (Δ) | FLIP vs R2 off / on | boundary FLIP vs R2 off / on | sharpness vs R2 off / on | brightness vs R2 off / on | boundary bias vs R2 off / on | temporal std off / on [ref off / on] | boundary temporal std off / on [ref off / on] |');
    console.log('|---|---|---|---|---|---|---|---|---|---|---|');
    for (const s of SIGS) for (const d of [...DEN[s], 'reference']) {
      if (d === 'reference' && s !== 'visibility' && s !== 'diffuse' && s !== 'specular') continue;
      const a = row(off, w, s, d), b = row(on, w, s, d), ra = row(off, w, s, 'reference'), rb = row(on, w, s, 'reference');
      if (!a || !b) continue;
      console.log(`| ${s} | ${d} | ${f(a.r2psnr)} / ${f(b.r2psnr)} (${dB(b.r2psnr, a.r2psnr)}) | ${f(a.r2psnrB)} / ${f(b.r2psnrB)} (${dB(b.r2psnrB, a.r2psnrB)}) | ${f(a.r2flip, 4)} / ${f(b.r2flip, 4)} | ${f(a.r2flipB, 4)} / ${f(b.r2flipB, 4)} | ${f(a.r2sharp, 3)} / ${f(b.r2sharp, 3)} | ${f(100 * a.r2bright, 2)} % / ${f(100 * b.r2bright, 2)} % | ${f(a.r2biasB, 4)} / ${f(b.r2biasB, 4)} | ${f(a.tstd, 4)} / ${f(b.tstd, 4)} [${f(ra.tstd, 4)} / ${f(rb.tstd, 4)}] | ${f(a.tstdB, 4)} / ${f(b.tstdB, 4)} [${f(ra.tstdB, 4)} / ${f(rb.tstdB, 4)}] |`);
    }
  }
  if (!raw) continue;
  console.log(`\n#### ${scene}: integration error (motion with the jitter delta, "raw") vs correct jitter-free motion (both jittered, same R1 / R2)\n`);
  console.log('| window | signal | denoiser | PSNR ok / raw (Δ) | boundary PSNR ok / raw (Δ) | FLIP ok / raw (Δ) | boil ok / raw (Δ) | sharpness ok / raw | holds: PSNR vs R2 ok / raw | holds: sharpness vs R2 ok / raw |');
  console.log('|---|---|---|---|---|---|---|---|---|---|');
  for (const w of ['holdA', 'pan', 'holdB']) for (const s of SIGS) for (const d of DEN[s]) {
    const a = row(on, w, s, d), b = row(raw, w, s, d);
    if (!a || !b) continue;
    console.log(`| ${w} | ${s} | ${d} | ${f(a.psnr)} / ${f(b.psnr)} (${dB(b.psnr, a.psnr)}) | ${f(a.psnrB)} / ${f(b.psnrB)} (${dB(b.psnrB, a.psnrB)}) | ${f(a.flip, 4)} / ${f(b.flip, 4)} (${pct(b.flip, a.flip)}) | ${f(a.boil, 4)} / ${f(b.boil, 4)} (${pct(b.boil, a.boil)}) | ${f(a.sharp, 3)} / ${f(b.sharp, 3)} | ${w === 'pan' ? '–' : `${f(a.r2psnr)} / ${f(b.r2psnr)}`} | ${w === 'pan' ? '–' : `${f(a.r2sharp, 3)} / ${f(b.r2sharp, 3)}`} |`);
  }
}
