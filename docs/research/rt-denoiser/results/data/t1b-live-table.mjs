#!/usr/bin/env node
// T1b live A/B table (results/T1b-spatial-repair.md) from run-headless.mjs --json pages: per path, three arms of one
// signal (e.g. mips / spatial default / candidate) at the page's main reference (4096 spp on E-1-style pages, else
// 256) and, where present, the second reference (`vsRef2`, 256 spp). Columns: pooled PSNR, disoccluded (age < 8)
// PSNR, the frame after the cut (cut path), post-cut window (PSNR of the mean MSE over the cut and the next 7
// frames), FLIP, fixed-pixel and motion-compensated flicker.
//   node t1b-live-table.mjs --signal diffuse --arms a,b,c [--ref2] pages-*.json
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i < 0 ? d : args[i + 1]; };
const sig = opt('signal', 'diffuse');
const arms = opt('arms', '').split(',');
const useRef2 = args.includes('--ref2');
const files = args.filter((a) => a.endsWith('.json'));
const num = (x) => (typeof x === 'number' ? x : NaN);
const f3 = (x) => (Number.isFinite(x) ? x.toFixed(3) : '–');
const f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : '–');
const sg = (x, d = 2) => (Number.isFinite(x) ? (x >= 0 ? '+' : '') + x.toFixed(d) : '–');
const pc = (a, b) => (Number.isFinite(a) && Number.isFinite(b) && b ? sg((a / b - 1) * 100, 1) + ' %' : '–');
const mean = (xs) => { const v = xs.filter(Number.isFinite); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN; };

const rows = [];
for (const f of files) {
  const j = JSON.parse(readFileSync(f, 'utf8'));
  for (const r of (Array.isArray(j) ? j : [j]).filter((x) => x.results?.results)) {
    const P = r.results;
    const cut = (P.resets ?? []).find((x) => x > 0);
    const m = arms.map((a) => {
      let rec = P.results[sig]?.[a];
      if (!rec) return null;
      const idx = useRef2 ? 1 : 0;
      const den = rec.perFrameDb ? rec.perFrameDb.map((x) => num(x[idx])) : (rec.perFrame ?? []).map((x) => num(x[1]));
      if (useRef2) rec = rec.vsRef2;
      if (!rec) return null;
      const win = cut !== undefined ? den.slice(cut, cut + 8) : [];
      return {
        pooled: num(rec.psnrDenPooled), disocc: num(rec.regions?.disoccluded?.psnrDenPooled ?? rec.regions?.disoccluded?.psnrDen),
        cut: cut !== undefined ? den[cut] : NaN,
        win: win.length ? -10 * Math.log10(mean(win.map((d) => 10 ** (-d / 10)))) : NaN,
        flip: num(rec.flipDen), flicker: num(rec.flickerDen), flickerMc: num(rec.flickerMcDen),
      };
    });
    if (m.some((x) => !x)) continue;
    rows.push({ path: P.path, refspp: useRef2 ? 'ref2' : (P.refSpp ?? P.refspp ?? '?'), m });
  }
}
rows.sort((a, b) => a.path.localeCompare(b.path));
console.log(`${sig}${useRef2 ? ' (second reference)' : ''}: arms ${arms.join(' | ')}; Δ = arm - first arm`);
console.log('| path | ' + arms.map((a, i) => (i ? `${a} Δpooled / Δdisocc / Δcut / Δwin / FLIP / flicker / flicker mc` : `${a} pooled / disocc / cut / win`)).join(' | ') + ' |');
for (const r of rows) {
  const b = r.m[0];
  console.log(`| ${r.path} | ${f3(b.pooled)} / ${f2(b.disocc)} / ${f2(b.cut)} / ${f2(b.win)} | ` + r.m.slice(1).map((c) =>
    `${sg(c.pooled - b.pooled, 3)} / ${sg(c.disocc - b.disocc)} / ${sg(c.cut - b.cut)} / ${sg(c.win - b.win)} / ${pc(c.flip, b.flip)} / ${pc(c.flicker, b.flicker)} / ${pc(c.flickerMc, b.flickerMc)}`).join(' | ') + ' |');
}
const M = (i, k) => mean(rows.map((r) => r.m[i][k]));
console.log(`| mean of ${rows.length} | ${f3(M(0, 'pooled'))} / ${f2(M(0, 'disocc'))} | ` + arms.slice(1).map((_, j) => {
  const i = j + 1;
  return `${sg(M(i, 'pooled') - M(0, 'pooled'), 3)} / ${sg(M(i, 'disocc') - M(0, 'disocc'))} / – / – / ${pc(M(i, 'flip'), M(0, 'flip'))} / ${pc(M(i, 'flicker'), M(0, 'flicker'))} / ${pc(M(i, 'flickerMc'), M(0, 'flickerMc'))}`;
}).join(' | ') + ' |');
