#!/usr/bin/env node
// E-1b A/B tables (results/E1b-high-reference.md) from run-headless.mjs --json pages with a second
// reference set (&refspp=4096&ref2spp=256&ref2salt=0): every arm scored against the 4096-spp reference
// (main fields) and the 256-spp reference (`vsRef2`) on the same denoised frames.
//   node e1b-ab-table.mjs --pair=<signal>:<base>:<candidate> [--pair=...] pages-*.json
// Per path and mean over paths: pooled PSNR, disoccluded (age < 8) PSNR, the frame after the cut and
// the post-cut window (frames cut..cut+7, PSNR of the mean per-frame MSE), FLIP, fixed-pixel flicker,
// motion-compensated flicker (all at both references), and the candidate - base deltas.
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const pairs = args.filter((a) => a.startsWith('--pair=')).map((a) => a.slice(7).split(':'));
const files = args.filter((a) => !a.startsWith('--'));
// run-headless.mjs --json files, or the compact data file (data/e1b-highref-1080p.json: { pages: [...] })
const pages = files.flatMap((f) => {
  const j = JSON.parse(readFileSync(f, 'utf8'));
  return Array.isArray(j) ? j.filter((r) => r.results?.results).map((r) => r.results) : j.pages.filter((p) => Object.keys(p.results ?? {}).length);
});

const f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : '–');
const f3 = (x) => (Number.isFinite(x) ? x.toFixed(3) : '–');
const f4 = (x) => (Number.isFinite(x) ? x.toFixed(4) : '–');
const sg = (x, d = 2) => (Number.isFinite(x) ? (x >= 0 ? '+' : '') + x.toFixed(d) : '–');
const pc = (a, b) => (Number.isFinite(a) && Number.isFinite(b) && b ? sg((a / b - 1) * 100, 1) + ' %' : '–');
const mean = (xs) => { const v = xs.filter(Number.isFinite); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN; };
const num = (x) => (typeof x === 'number' ? x : NaN);

function metrics(rec, page, perFrameDb) {
  if (!rec) return null;
  const cut = (page.resets ?? []).find((r) => r > 0);
  const den = rec.perFrame?.map((p) => num(p[1])) ?? perFrameDb ?? [];
  const win = cut !== undefined ? den.slice(cut, cut + 8) : [];
  const winDb = win.length ? -10 * Math.log10(mean(win.map((d) => 10 ** (-d / 10)))) : NaN;
  return {
    pooled: num(rec.psnrDenPooled), disocc: num(rec.regions?.disoccluded?.psnrDenPooled ?? rec.regions?.disoccluded?.psnrDen),
    afterCut: cut !== undefined ? num(den[cut]) : NaN, win: winDb,
    flip: num(rec.flipDen), flicker: num(rec.flickerDen), flickerMc: num(rec.flickerMcDen),
  };
}

for (const [sig, base, cand] of pairs) {
  const rows = [];
  for (const P of pages) {
    const b = P.results[sig]?.[base], c = P.results[sig]?.[cand];
    if (!b || !c) continue;
    const db = (r, i) => r.perFrameDb?.map((x) => num(x[i]));
    rows.push({ path: P.path, hi: [metrics(b, P, db(b, 0)), metrics(c, P, db(c, 0))], lo: [metrics(b.vsRef2, P, db(b, 1)), metrics(c.vsRef2, P, db(c, 1))] });
  }
  if (!rows.length) continue;
  rows.sort((a, b) => a.path.localeCompare(b.path));
  console.log(`### ${sig}: \`${cand}\` vs \`${base}\`\n`);
  console.log('Per path, 256 → 4096-spp reference (base / candidate / Δ):\n');
  console.log('| path | pooled base | pooled cand | Δ pooled | disocc. base | disocc. cand | Δ disocc. | frame after cut Δ | post-cut window Δ | FLIP Δ (4096) | flicker Δ (4096) | flicker mc Δ (4096) |');
  console.log('|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of rows) {
    const d = (w, k) => r[w][1][k] - r[w][0][k];
    console.log(`| ${r.path} | ${f3(r.lo[0].pooled)} → ${f3(r.hi[0].pooled)} | ${f3(r.lo[1].pooled)} → ${f3(r.hi[1].pooled)} | ${sg(d('lo', 'pooled'), 3)} → ${sg(d('hi', 'pooled'), 3)} | ${f2(r.lo[0].disocc)} → ${f2(r.hi[0].disocc)} | ${f2(r.lo[1].disocc)} → ${f2(r.hi[1].disocc)} | ${sg(d('lo', 'disocc'))} → ${sg(d('hi', 'disocc'))} | ${sg(d('lo', 'afterCut'))} → ${sg(d('hi', 'afterCut'))} | ${sg(d('lo', 'win'))} → ${sg(d('hi', 'win'))} | ${pc(r.hi[1].flip, r.hi[0].flip)} | ${pc(r.hi[1].flicker, r.hi[0].flicker)} | ${pc(r.hi[1].flickerMc, r.hi[0].flickerMc)} |`);
  }
  const m = (w, i, k) => mean(rows.map((r) => r[w][i][k]));
  console.log('');
  console.log(`Mean over ${rows.length} paths (${rows.map((r) => r.path).join(', ')}):\n`);
  console.log('| ref | arm | pooled | disocc. | frame after cut | post-cut window | FLIP | flicker | flicker mc |');
  console.log('|---|---|---|---|---|---|---|---|---|');
  for (const w of ['lo', 'hi']) for (const i of [0, 1]) {
    console.log(`| ${w === 'lo' ? 256 : 4096} | \`${i ? cand : base}\` | ${f3(m(w, i, 'pooled'))} | ${f3(m(w, i, 'disocc'))} | ${f2(m(w, i, 'afterCut'))} | ${f2(m(w, i, 'win'))} | ${f4(m(w, i, 'flip'))} | ${f4(m(w, i, 'flicker'))} | ${f4(m(w, i, 'flickerMc'))} |`);
  }
  for (const w of ['lo', 'hi']) {
    console.log(`| ${w === 'lo' ? 256 : 4096} | Δ | ${sg(m(w, 1, 'pooled') - m(w, 0, 'pooled'), 3)} | ${sg(m(w, 1, 'disocc') - m(w, 0, 'disocc'), 3)} | ${sg(m(w, 1, 'afterCut') - m(w, 0, 'afterCut'))} | ${sg(m(w, 1, 'win') - m(w, 0, 'win'))} | ${pc(m(w, 1, 'flip'), m(w, 0, 'flip'))} | ${pc(m(w, 1, 'flicker'), m(w, 0, 'flicker'))} | ${pc(m(w, 1, 'flickerMc'), m(w, 0, 'flickerMc'))} |`);
  }
  console.log('');
}
