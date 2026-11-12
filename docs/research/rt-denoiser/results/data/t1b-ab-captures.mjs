#!/usr/bin/env node
// T1b capture A/B (results/T1b-spatial-repair.md) from t1-score.mjs JSON: per capture and signal, every arm's all /
// young (age < 8) / settled (age >= 17) PSNR, young FLIP, young and settled boil with the reference's own boil, and
// the rule-9 boil reading (Dennis q20 (a)): a boil increase of the candidate over the base counts only where the
// candidate ends above BOTH the reference's own boil and the shipped default's boil in that region.
//   node t1b-ab-captures.mjs --base a-sp --cand a-cand --default a-svgf16 [--also a-mips,a-svgf] scores/*.json
import { readFileSync } from 'node:fs';
import { summarize } from './t1-summary.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i < 0 ? d : args[i + 1]; };
const base = opt('base', 'a-sp'), cand = opt('cand', 'a-cand'), dflt = opt('default', 'a-svgf16');
const also = opt('also', 'a-mips').split(',').filter(Boolean);
const files = args.filter((a) => a.endsWith('.json'));
const f2 = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '–');
const sg = (x, d = 2) => (Number.isFinite(x) ? (x >= 0 ? '+' : '') + x.toFixed(d) : '–');
const pc = (a, b) => (Number.isFinite(a) && Number.isFinite(b) && b ? sg((a / b - 1) * 100, 0) + ' %' : '–');
const refOld = (r, sig, den) => { const a = r.acc[`${sig}|${den}`]; return a ? Math.sqrt(a.refBoil[17] / Math.max(a.boilN[17], 1)) / Math.sqrt(6) : NaN; };
const verdict = (c, b, ref, d) => (!(c > b * 1.05) ? 'ok' : c > ref && c > d ? '**FAIL**' : 'ok (under ref or default)');

const pooled = {};
for (const sig of ['diffuse', 'specular']) {
  console.log(`\n### ${sig}: \`${cand}\` vs \`${base}\` (default for boil: \`${dflt}\`; also ${also.join(', ')})\n`);
  console.log('| capture | Δ all | Δ young | Δ settled | FLIP young Δ | boil young base → cand (ref / default) | rule 9 young | boil settled base → cand (ref / default) | rule 9 settled | ' + also.map((a) => `${a} all / young`).join(' | ') + ' |');
  console.log('|---|---|---|---|---|---|---|---|---|' + also.map(() => '---|').join(''));
  for (const f of files) {
    const r = JSON.parse(readFileSync(f, 'utf8'));
    if (!r.signals.includes(sig)) continue;
    const b = summarize(r, sig, base), c = summarize(r, sig, cand), d = summarize(r, sig, dflt);
    if (!b || !c) continue;
    const ro = refOld(r, sig, base);
    const P = (pooled[sig] ??= { n: 0, b: 0, c: 0, by: 0, cy: 0, nyo: 0 });
    // pooled over captures: mean MSE (from PSNR, all pixels)
    P.n++; P.b += 10 ** (-b.all / 10); P.c += 10 ** (-c.all / 10);
    if (Number.isFinite(b.young)) { P.nyo++; P.by += 10 ** (-b.young / 10); P.cy += 10 ** (-c.young / 10); }
    const ex = also.map((a) => { const s = summarize(r, sig, a); return s ? `${f2(s.all)} / ${f2(s.young)}` : '–'; });
    console.log(`| ${r.capture} | ${sg(c.all - b.all)} (${f2(c.all)}) | ${sg(c.young - b.young)} | ${sg(c.old - b.old)} | ${pc(c.flipY, b.flipY)} | ${f2(b.boil, 4)} → ${f2(c.boil, 4)} (${f2(b.refBoil, 4)} / ${d ? f2(d.boil, 4) : '–'}) | ${verdict(c.boil, b.boil, b.refBoil, d?.boil)} | ${f2(b.boilOld, 4)} → ${f2(c.boilOld, 4)} (${f2(ro, 4)} / ${d ? f2(d.boilOld, 4) : '–'}) | ${verdict(c.boilOld, b.boilOld, ro, d?.boilOld)} | ${ex.join(' | ')} |`);
  }
  const P = pooled[sig];
  if (P) console.log(`\nPooled over ${P.n} captures (mean MSE): all ${f2(-10 * Math.log10(P.b / P.n))} → ${f2(-10 * Math.log10(P.c / P.n))} (${sg(-10 * Math.log10(P.c / P.b))}); young ${f2(-10 * Math.log10(P.by / P.nyo))} → ${f2(-10 * Math.log10(P.cy / P.nyo))} (${sg(-10 * Math.log10(P.cy / P.by))})`);
}
