#!/usr/bin/env node
// Compact tables for results/T8-jitter.md §3, §4.1, §4.2, §6 from score.mjs JSON (raw/t8-*.json).
//   node summary.mjs <raw dir>
import { readFileSync } from 'node:fs';
import path from 'node:path';

const dir = process.argv[2];
const load = (n) => JSON.parse(readFileSync(path.join(dir, `${n}.json`), 'utf8'))[0];
const ROWS = [['diffuse', 'svgf-auto'], ['diffuse', 'recurrent'], ['specular', 'svgf-auto'], ['specular', 'recurrent'],
  ['visibility', 'shadows'], ['ao', 'occlusion-svgf-auto'], ['so', 'occlusion-svgf-auto']];
const f = (x, k = 2) => (Number.isFinite(x) ? x.toFixed(k) : '–');
const dB = (a, b) => `${a - b >= 0 ? '+' : ''}${(a - b).toFixed(2)}`;
const pct = (a, b) => `${a / b - 1 >= 0 ? '+' : ''}${(100 * (a / b - 1)).toFixed(0)} %`;
const get = (cap, w, s, d) => cap.rows.find((r) => r.window === w && r.signal === s && r.denoiser === d);
const out = {};

out.r1 = ['| scene, window | signal | denoiser | PSNR Δ | boundary PSNR Δ | FLIP Δ | boundary FLIP Δ | boil off → on [ref on] | sharpness off / on |', '|---|---|---|---|---|---|---|---|---|'];
for (const sc of ['thin', 'glossy']) {
  const off = load(`t8-${sc}-off`), on = load(`t8-${sc}-h8`);
  for (const w of ['holdA', 'pan']) for (const [s, d] of ROWS) {
    const a = get(off, w, s, d), b = get(on, w, s, d), rb = get(on, w, s, 'reference');
    out.r1.push(`| ${sc}, ${w} | ${s} | ${d} | ${dB(b.psnr, a.psnr)} | ${dB(b.psnrB, a.psnrB)} | ${pct(b.flip, a.flip)} | ${pct(b.flipB, a.flipB)} | ${f(a.boil, 4)} → ${f(b.boil, 4)} [${f(rb.boil, 4)}] | ${f(a.sharp, 3)} / ${f(b.sharp, 3)} |`);
  }
}
out.tstd = ['| scene | signal | denoiser | all: output / reference (ratio) | boundary: output / reference (ratio) | jitter off, boundary output |', '|---|---|---|---|---|---|'];
let lo = Infinity, hi = -Infinity;
for (const sc of ['thin', 'glossy']) {
  const off = load(`t8-${sc}-off`), on = load(`t8-${sc}-h8`);
  for (const [s, d] of ROWS) {
    const b = get(on, 'holdA', s, d), a = get(off, 'holdA', s, d);
    const r = b.tstdB / b.refTstdB; lo = Math.min(lo, r); hi = Math.max(hi, r);
    out.tstd.push(`| ${sc} | ${s} | ${d} | ${f(b.tstd, 4)} / ${f(b.refTstd, 4)} (${f(b.tstd / b.refTstd, 2)}) | ${f(b.tstdB, 4)} / ${f(b.refTstdB, 4)} (${f(r, 2)}) | ${f(a.tstdB, 4)} |`);
  }
}
out.tstdRange = `${lo.toFixed(2)}–${hi.toFixed(2)}`;
out.r2 = ['| scene | signal | denoiser | output vs R2 | reference R1 vs R2 | Δ | output vs R1 (jitter on) | jitter off: output vs its reference |', '|---|---|---|---|---|---|---|---|'];
for (const sc of ['thin', 'glossy']) {
  const off = load(`t8-${sc}-off`), on = load(`t8-${sc}-h8`);
  for (const [s, d] of ROWS) {
    const b = get(on, 'holdA', s, d), rb = get(on, 'holdA', s, 'reference'), a = get(off, 'holdA', s, d);
    out.r2.push(`| ${sc} | ${s} | ${d} | ${f(b.r2psnrB)} | ${f(rb.r2psnrB)} | ${dB(b.r2psnrB, rb.r2psnrB)} | ${f(b.psnrB)} | ${f(a.psnrB)} |`);
  }
}
out.raw = ['| scene, window | signal | denoiser | boundary PSNR ok / raw | boil ok / raw [ref] | sharpness vs R1 ok / raw | sharpness vs R2 ok / raw |', '|---|---|---|---|---|---|---|'];
for (const sc of ['thin', 'glossy']) {
  const on = load(`t8-${sc}-h8`), raw = load(`t8-${sc}-h8-raw`);
  for (const w of ['holdA', 'pan']) for (const [s, d] of ROWS) {
    const a = get(on, w, s, d), b = get(raw, w, s, d), rb = get(on, w, s, 'reference');
    out.raw.push(`| ${sc}, ${w} | ${s} | ${d} | ${f(a.psnrB)} / ${f(b.psnrB)} | ${f(a.boil, 4)} / ${f(b.boil, 4)} (${pct(b.boil, a.boil)}) [${f(rb.boil, 4)}] | ${f(a.sharp, 3)} / ${f(b.sharp, 3)} | ${w === 'pan' ? '–' : `${f(a.r2sharp, 3)} / ${f(b.r2sharp, 3)}`} |`);
  }
}
console.log(JSON.stringify({ r1: out.r1.join('\n'), tstd: out.tstd.join('\n'), tstdRange: out.tstdRange, r2: out.r2.join('\n'), raw: out.raw.join('\n') }));
