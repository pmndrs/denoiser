#!/usr/bin/env node
// Rule-9 style A/B of candidate arms against a baseline arm over score.mjs JSON files (results/T5-normal-detail.md):
//   node ab.mjs --base sh --cands sh-dp8,sh-dp16 <score.json> [...]
// Files of the same capture are merged (arms from several batches). Per capture, signal and window: dPSNR (all /
// bump / flat), FLIP and bump FLIP change (%), flicker and boil change (%) per region, and the q20 (a) boil clause:
// a boil rise counts only if the candidate ends above both the reference's own boil and the baseline's.
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i < 0 ? d : args[i + 1]; };
const files = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
const base = opt('base', 'sh');
const cands = opt('cands').split(',');
const sigs = opt('signals', 'sh-diffuse,sh-specular').split(',');
const caps = new Map();
for (const f of files) {
  const j = JSON.parse(readFileSync(f, 'utf8'));
  const c = caps.get(j.capture) ?? { scores: {}, windows: [] };
  for (const w of j.windows) if (!c.windows.some((x) => x.n === w.n)) c.windows.push(w);
  for (const [arm, sigs] of Object.entries(j.scores)) for (const [s, ws] of Object.entries(sigs)) Object.assign(((c.scores[arm] ??= {})[s] ??= {}), ws);
  caps.set(j.capture, c);
}
const pct = (a, b) => (Number.isFinite(a) && Number.isFinite(b) && b > 0 ? (100 * (a - b)) / b : NaN);
const f = (x, d = 2, s = true) => (Number.isFinite(x) ? `${s && x >= 0 ? '+' : ''}${x.toFixed(d)}` : '–');
for (const cand of cands) {
  console.log(`\n### ${cand} vs ${base}\n`);
  console.log('| capture | signal | window | dPSNR | d bump | d flat | gain | FLIP % | FLIP bump % | flicker bump % | flicker flat % | boil bump % | boil flat % | boil clause |');
  console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const [cap, c] of caps) {
    const A = c.scores[cand], B = c.scores[base], N = c.scores.noisy;
    if (!A || !B) continue;
    for (const s of sigs) for (const w of c.windows) {
      const a = A[s]?.[w.n], b = B[s]?.[w.n], n = N[s]?.[w.n];
      if (!a || !b) continue;
      const fails = [];
      for (const r of ['all', 'bump', 'flat']) {
        const ab = a[r].boil, bb = b[r].boil, rb = n[r].refBoil;
        if (ab > bb * 1.05 && ab > rb) fails.push(`${r} ${f(pct(ab, bb), 0)} %`);
      }
      console.log(`| ${cap} | ${s} | ${w.n} | ${f(a.all.psnr - b.all.psnr)} | ${f(a.bump.psnr - b.bump.psnr)} | ${f(a.flat.psnr - b.flat.psnr)} | ${b.bump.gain?.toFixed(2) ?? '–'} → ${a.bump.gain?.toFixed(2) ?? '–'} | ${f(pct(a.all.flip, b.all.flip), 1)} | ${f(pct(a.bump.flip, b.bump.flip), 1)} | ${f(pct(a.bump.flicker, b.bump.flicker), 1)} | ${f(pct(a.flat.flicker, b.flat.flicker), 1)} | ${f(pct(a.bump.boil, b.bump.boil), 0)} | ${f(pct(a.flat.boil, b.flat.boil), 0)} | ${fails.length ? `**fails** (${fails.join(', ')})` : 'ok'} |`);
    }
  }
}
