#!/usr/bin/env node
// Rule-9 A/B tables for review target 6 (results/T6-boundaries.md) from run-headless.mjs --json outputs of live test-bed
// eval pages that hold a baseline id and its variants `<id>@<key>=<v>[@...]` (same page = same inputs and references).
//
//   node ab.mjs <live-*.json ...> [--md]       per (signal, variant): pooled over the files' paths, plus per path
//
// Columns: Δ pooled PSNR, worst path, Δ boundary / boundary-young / disoccluded / penumbra-or-contact (pooled PSNR over
// paths), Δ FLIP, Δ flicker (fixed-pixel), Δ boundary flicker (motion-compensated, 'boundary-temporal'), Δ static /
// dynamic mc flicker. Region pooling: PSNR of the mean MSE of the per-path pooled values (equal path weights).
import { readFileSync } from 'node:fs';

const files = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const perPath = process.argv.includes('--per-path');
const dbOf = (mse) => -10 * Math.log10(mse);
const mseOf = (db) => 10 ** (-db / 10);
const f = (x, d = 3) => (Number.isFinite(x) ? (x >= 0 ? '+' : '') + x.toFixed(d) : '–');
const pc = (a, b) => (Number.isFinite(a) && Number.isFinite(b) && a !== 0 ? f(((b - a) / Math.abs(a)) * 100, 1) + ' %' : '–');
const rows = [];
for (const file of files) {
  for (const run of JSON.parse(readFileSync(file, 'utf8'))) {
    const R = run.results;
    if (!R?.results) { console.error(`skip ${file}: ${run.error ?? 'no results'}`); continue; }
    for (const [signal, dens] of Object.entries(R.results)) {
      if (typeof dens !== 'object' || !dens) continue;
      for (const [id, b] of Object.entries(dens)) {
        if (!id.includes('@')) continue;
        const base = id.split('@')[0];
        if (!dens[base]) continue;
        rows.push({ path: R.path, signal, base, id, a: dens[base], b });
      }
    }
  }
}
const reg = (x, k) => x.regions?.[k]?.psnrDen;
const regB = (x, k) => x.regions?.[k]?.biasDen;
const groups = new Map();
for (const r of rows) {
  const k = `${r.signal}|${r.id}`;
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k).push(r);
}
const penOf = (x) => (x.regions?.penumbra ? 'penumbra' : 'contact');
if (perPath) {
  console.log('| signal | variant | path | Δ pooled | Δ boundary | Δ boundary-young | Δ disoccluded | Δ pen/contact | Δ FLIP | Δ flicker | Δ boundary flicker |');
  console.log('|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of rows) {
    const { a, b } = r; const pk = penOf(a);
    console.log(`| ${r.signal} | ${r.id} | ${r.path} | ${f(b.psnrDenPooled - a.psnrDenPooled)} | ${f(reg(b, 'boundary') - reg(a, 'boundary'))} | ${f(reg(b, 'boundary-young') - reg(a, 'boundary-young'))} | ${f(reg(b, 'disoccluded') - reg(a, 'disoccluded'))} | ${f(reg(b, pk) - reg(a, pk))} | ${pc(a.flipDen, b.flipDen)} | ${pc(a.flickerDen, b.flickerDen)} | ${pc(regB(a, 'boundary-temporal'), regB(b, 'boundary-temporal'))} |`);
  }
  console.log('');
}
console.log('| signal | variant | paths | baseline pooled | Δ pooled | worst path | Δ boundary | Δ boundary-young | Δ disoccluded | Δ pen/contact | Δ FLIP | Δ flicker | Δ boundary flicker | Δ static flicker | Δ dynamic flicker |');
console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const [k, rs] of groups) {
  const [signal, id] = k.split('|');
  const pool = (sel) => { const v = rs.map(sel).filter(Number.isFinite); return v.length ? dbOf(v.reduce((s, x) => s + mseOf(x), 0) / v.length) : NaN; };
  const m = (sel) => { const v = rs.map(sel).filter(Number.isFinite); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : NaN; };
  const pa = pool((r) => r.a.psnrDenPooled), pb = pool((r) => r.b.psnrDenPooled);
  const worst = rs.reduce((w, r) => { const d = r.b.psnrDenPooled - r.a.psnrDenPooled; return d < w.d ? { d, p: r.path } : w; }, { d: Infinity, p: '' });
  const rd = (name) => pool((r) => reg(r.b, name)) - pool((r) => reg(r.a, name));
  const pk = penOf(rs[0].a);
  console.log(`| ${signal} | ${id} | ${rs.length} | ${pa.toFixed(3)} | ${f(pb - pa)} | ${f(worst.d)} (${worst.p}) | ${f(rd('boundary'))} | ${f(rd('boundary-young'))} | ${f(rd('disoccluded'))} | ${f(rd(pk))} | ${pc(m((r) => r.a.flipDen), m((r) => r.b.flipDen))} | ${pc(m((r) => r.a.flickerDen), m((r) => r.b.flickerDen))} | ${pc(m((r) => regB(r.a, 'boundary-temporal')), m((r) => regB(r.b, 'boundary-temporal')))} | ${pc(m((r) => regB(r.a, 'static-temporal')), m((r) => regB(r.b, 'static-temporal')))} | ${pc(m((r) => regB(r.a, 'dynamic-temporal')), m((r) => regB(r.b, 'dynamic-temporal')))} |`);
}
