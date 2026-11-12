#!/usr/bin/env node
// Track D: tables from calm.mjs JSON files (tracks/d.md). Lag = frames after the reset until the per-frame MSE stays
// within 10 % of its settled level (mean of the last --settle frames, default 16), TRACKS.md "the five numbers" 3.
//   node calm-table.mjs <scores.json>... [--signal diffuse] [--den a,b] [--names a=label,b=label] [--mean]
//   --mean: one table of means over the given captures (boil as RMS over captures)
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i < 0 ? d : args[i + 1]; };
const files = args.filter((a, i) => a.endsWith('.json') && !(i > 0 && args[i - 1].startsWith('--')));
const sig = opt('signal', 'diffuse');
const SETTLE = Number(opt('settle', 16));
const denFilter = opt('den', '')?.split(',').filter(Boolean);
const names = Object.fromEntries((opt('names', '') ?? '').split(',').filter(Boolean).map((x) => x.split('=')));
const f4 = (x, d = 4) => (x == null || !Number.isFinite(x) ? '–' : x.toFixed(d));

export function lagOf(mse, settle = SETTLE, tol = 0.1) {
  const n = mse.length;
  const tail = mse.slice(n - settle);
  const s = tail.reduce((a, b) => a + b, 0) / tail.length;
  let t = n;
  for (let k = n - 1; k >= 0; k--) { if (mse[k] <= (1 + tol) * s) t = k; else break; }
  return t;
}

const rows = [];
for (const f of files) {
  const r = JSON.parse(readFileSync(f, 'utf8'));
  for (const [key, v] of Object.entries(r.rows)) {
    const [s, d] = key.split('|');
    if (s !== sig || (denFilter.length && !denFilter.includes(d) && d !== 'ref')) continue;
    rows.push({ cap: r.capture, d, v, lag: d === 'ref' ? null : lagOf(v.perFrameMse) });
  }
}
const order = [...new Set(rows.map((x) => x.d))];
if (denFilter.length) order.sort((a, b) => (a === 'ref' ? 1 : b === 'ref' ? -1 : denFilter.indexOf(a) - denFilter.indexOf(b)));
const label = (d) => names[d] ?? d;
if (args.includes('--mean')) {
  const caps = [...new Set(rows.map((x) => x.cap))];
  console.log(`\n**${sig}, mean over ${caps.join(', ')}** (boil = RMS over captures; PSNR = mean of pooled per capture)\n`);
  console.log('| denoiser | static boil | dynamic err-boil | edge boil | disocc boil | static PSNR | all-region PSNR | lag (frames) |');
  console.log('|---|---|---|---|---|---|---|---|');
  for (const d of order) {
    const rs = rows.filter((x) => x.d === d);
    const rms = (g) => Math.sqrt(rs.reduce((a, x) => a + (g(x) ?? 0) ** 2, 0) / rs.length);
    const mean = (g) => rs.reduce((a, x) => a + (g(x) ?? 0), 0) / rs.length;
    const allPsnr = (x) => { const m = x.v.perFrameMse; return 10 * Math.log10(m.length / m.reduce((a, b) => a + b, 0)); };
    console.log(`| ${label(d)} | ${f4(rms((x) => x.v.reg.static.boil))} | ${f4(rms((x) => x.v.reg.dynamic.errBoil))} | ${f4(rms((x) => x.v.reg.edge.boil))} | ${f4(rms((x) => x.v.reg.disocc.boil))} | ${d === 'ref' ? '' : f4(mean((x) => x.v.reg.static.psnr), 2)} | ${d === 'ref' ? '' : f4(mean(allPsnr), 2)} | ${d === 'ref' ? '' : f4(mean((x) => x.lag), 1)} |`);
  }
} else {
  console.log(`\n**${sig}** (boil x1e3; static / edge / disocc: boil of the output, its reference's in the ref row; dynamic: boil of the error; px = pixels per frame)\n`);
  console.log('| capture | denoiser | static boil | dynamic err-boil (px) | edge boil | disocc boil (px) | static PSNR | dynamic PSNR | all PSNR | lag | still σ (8-bit) |');
  console.log('|---|---|---|---|---|---|---|---|---|---|---|');
  for (const cap of [...new Set(rows.map((x) => x.cap))]) for (const d of order) {
    const x = rows.find((y) => y.cap === cap && y.d === d);
    if (!x) continue;
    const g = x.v.reg, k = (v) => f4(v == null ? null : v * 1e3, 2);
    const allPsnr = 10 * Math.log10(x.v.perFrameMse.length / x.v.perFrameMse.reduce((a, b) => a + b, 0));
    console.log(`| ${cap} | ${label(d)} | ${k(g.static.boil)} | ${k(d === 'ref' ? g.dynamic.boil : g.dynamic.errBoil)} (${Math.round(g.dynamic.pxPerFrame)}) | ${k(g.edge.boil)} | ${k(g.disocc.boil)} (${Math.round(g.disocc.pxPerFrame)}) | ${d === 'ref' ? '' : f4(g.static.psnr, 2)} | ${d === 'ref' ? '' : f4(g.dynamic.psnr, 2)} | ${d === 'ref' ? '' : f4(allPsnr, 2)} | ${x.lag ?? ''} | ${x.v.stillSigma255 != null ? f4(x.v.stillSigma255, 2) : ''} |`);
  }
}
