#!/usr/bin/env node
// Capture A/B tables (results/SVGF-FOLLOWUPS.md; a copy of t6-boundaries/scenes.mjs with the arm prefix as a flag) from
// t6-boundaries/score.mjs --json files. Arms <prefix><base>[-<variant>] are compared with <prefix><base> on the same
// capture and signal.
//   node scenes.mjs <score-*.json ...> [--per-capture] [--prefix n-]
import { readFileSync } from 'node:fs';
const args = process.argv.slice(2);
const files = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--prefix');
const perCap = args.includes('--per-capture');
const PREFIX = (() => { const i = args.indexOf('--prefix'); return i < 0 ? 'n-' : args[i + 1]; })();
const dbOf = (mse) => -10 * Math.log10(mse);
const mseOf = (db) => 10 ** (-db / 10);
const f = (x, d = 3) => (Number.isFinite(x) ? (x >= 0 ? '+' : '') + x.toFixed(d) : '–');
const pc = (a, b) => (Number.isFinite(a) && Number.isFinite(b) && a !== 0 ? f(((b - a) / Math.abs(a)) * 100, 1) + ' %' : '–');
const rows = files.flatMap((fl) => JSON.parse(readFileSync(fl, 'utf8')).flatMap((c) => c.rows));
const key = (r) => `${r.capture}|${r.signal}|${r.denoiser}`;
const by = new Map(rows.map((r) => [key(r), r]));
const baseOf = (d) => d.split('-').slice(0, 2).join('-');
const groups = new Map();
for (const r of rows) {
  if (!r.denoiser.startsWith(PREFIX) || baseOf(r.denoiser) === r.denoiser) continue;
  const a = by.get(`${r.capture}|${r.signal}|${baseOf(r.denoiser)}`);
  const n = by.get(`${r.capture}|${r.signal}|noisy`);
  if (!a) continue;
  const g = `${r.signal}|${r.denoiser}`;
  if (!groups.has(g)) groups.set(g, []);
  groups.get(g).push({ cap: r.capture, a, b: r, refBoil: n?.refBoil });
}
const hdr = '| signal | arm | captures | Δ pooled | worst capture | Δ boundary | Δ boundary-young | Δ FLIP | Δ boil | Δ boundary boil | boil: baseline / arm / reference (worst capture by Δ boil) |';
if (perCap) {
  console.log('| signal | arm | capture | Δ pooled | Δ boundary | Δ boundary-young | Δ FLIP | Δ boil | Δ boundary boil | boil base / arm / ref |');
  console.log('|---|---|---|---|---|---|---|---|---|---|');
  for (const [g, ps] of groups) for (const p of ps) {
    const [s, d] = g.split('|');
    console.log(`| ${s} | ${d} | ${p.cap} | ${f(p.b.psnrPooled - p.a.psnrPooled)} | ${f(p.b.psnrBoundaryPooled - p.a.psnrBoundaryPooled)} | ${f(p.b.psnrBoundaryYoungPooled - p.a.psnrBoundaryYoungPooled)} | ${pc(p.a.flip, p.b.flip)} | ${pc(p.a.boil, p.b.boil)} | ${pc(p.a.boilBoundary, p.b.boilBoundary)} | ${p.a.boil.toFixed(4)} / ${p.b.boil.toFixed(4)} / ${Number.isFinite(p.refBoil) ? p.refBoil.toFixed(4) : '–'} |`);
  }
  console.log('');
}
console.log(hdr);
console.log('|---|---|---|---|---|---|---|---|---|---|---|');
for (const [g, ps] of groups) {
  const [s, d] = g.split('|');
  const pool = (sel) => { const v = ps.map(sel).filter(Number.isFinite); return v.length ? dbOf(v.reduce((t, x) => t + mseOf(x), 0) / v.length) : NaN; };
  const m = (sel) => { const v = ps.map(sel).filter(Number.isFinite); return v.length ? v.reduce((t, x) => t + x, 0) / v.length : NaN; };
  const worst = ps.reduce((w, p) => { const x = p.b.psnrPooled - p.a.psnrPooled; return x < w.x ? { x, c: p.cap } : w; }, { x: Infinity, c: '' });
  const wb = ps.reduce((w, p) => { const x = (p.b.boil - p.a.boil) / p.a.boil; return x > w.x ? { x, p } : w; }, { x: -Infinity, p: null });
  console.log(`| ${s} | ${d} | ${ps.length} | ${f(pool((p) => p.b.psnrPooled) - pool((p) => p.a.psnrPooled))} | ${f(worst.x)} (${worst.c}) | ${f(pool((p) => p.b.psnrBoundaryPooled) - pool((p) => p.a.psnrBoundaryPooled))} | ${f(pool((p) => p.b.psnrBoundaryYoungPooled) - pool((p) => p.a.psnrBoundaryYoungPooled))} | ${pc(m((p) => p.a.flip), m((p) => p.b.flip))} | ${pc(m((p) => p.a.boil), m((p) => p.b.boil))} | ${pc(m((p) => p.a.boilBoundary), m((p) => p.b.boilBoundary))} | ${wb.p ? `${wb.p.a.boil.toFixed(4)} / ${wb.p.b.boil.toFixed(4)} / ${Number.isFinite(wb.p.refBoil) ? wb.p.refBoil.toFixed(4) : '–'} (${wb.p.cap}, ${f(wb.x * 100, 1)} %)` : ''} |`);
}
