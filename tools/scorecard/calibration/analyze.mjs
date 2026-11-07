#!/usr/bin/env node
// Agreement between Dennis's blind answers and the scorecard metrics (TRACKS.md gate: each metric used by a gate must
// agree with him on >= 8 of 10 blind pairs, or it gets fixed before it gates anything).
//
//   node tools/scorecard/calibration/analyze.mjs <results.json> [more results.json ...] [--key key.json] [--json out.json]
//
// results.json = the text the bench's "Copy results" button produced ({ answers: [{ pair, metric, leftIs, pick }] }).
// Several files are merged (a later answer for the same pair wins). For every metric and every candidate definition
// of it, a pair "agrees" when the definition prefers the option Dennis picked; a "can't tell" counts as no agreement in
// `agree / answered` and is left out of `agree / decided`. PASS = agree / answered >= 0.8 (so 8 of 10).
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i < 0 ? d : args[i + 1]; };
const files = args.filter((a, i) => !a.startsWith('--') && !['--key', '--json'].includes(args[i - 1]));
if (!files.length) { console.error('usage: analyze.mjs <results.json> [...] [--key key.json] [--json out.json]'); process.exit(2); }
const key = JSON.parse(readFileSync(path.resolve(opt('key', path.join(HERE, 'key.json'))), 'utf8'));
const byId = new Map(key.pairs.map((p) => [p.id, p]));
const answers = new Map();
for (const f of files) for (const a of JSON.parse(readFileSync(f, 'utf8')).answers ?? []) answers.set(a.pair, a);

// definitions: [name, extractor(optionEntry), better = 'low' | 'high']
const DEFS = {
  calm: [
    ['boil stride 8 (second difference over 8 frames, chained reprojection)', (o) => o.calm.k8, 'low'],
    ['boil stride 1 (frame to frame)', (o) => o.calm.k1 ?? o.calm.boil, 'low'],
    ['boil stride 8 / reference boil stride 8', (o) => (o.calm.refK8 > 1e-4 ? o.calm.k8 / o.calm.refK8 : null), 'low'],
    ['still sigma at stride 8 (static cameras only)', (o) => o.calm.sigK8, 'low'],
    ['still sigma at stride 1 (static cameras only)', (o) => o.calm.sigK1, 'low'],
    ['error boil (second difference of out - ref)', (o) => o.calm.errBoil, 'low'],
    ['boil / reference boil', (o) => (o.calm.refBoil > 1e-4 ? o.calm.boil / o.calm.refBoil : null), 'low'],
    ['legacy boil (smooth-reference mask)', (o) => o.calm.legacyBoil, 'low'],
    ['still-camera sigma of luma (static cameras only)', (o) => o.calm.sigma, 'low'],
  ],
  detail: [
    ['FLIP', (o) => o.detail.flip, 'low'],
    ['PSNR', (o) => o.detail.psnr, 'high'],
  ],
  lag: [
    ['lag frames (within 10 % of settled)', (o) => o.lag.lag, 'low'],
  ],
};
const out = {};
const lines = ['# Calibration agreement', ''];
for (const metric of ['calm', 'detail', 'lag']) {
  const mine = [...answers.values()].filter((a) => a.metric === metric && byId.has(a.pair));
  lines.push(`## ${metric}: ${mine.length} answered, ${mine.filter((a) => a.pick === 'tie').length} "can't tell"`, '', '| definition | pairs scored | agree / answered | agree / decided | verdict |', '|---|---|---|---|---|');
  out[metric] = {};
  for (const [name, get, better] of DEFS[metric]) {
    let agree = 0, decided = 0, scored = 0;
    const detail = [];
    for (const a of mine) {
      const p = byId.get(a.pair);
      const left = a.leftIs === 'a' ? 'a' : 'b';
      const chosen = a.pick === 'tie' ? null : a.pick === 'left' ? left : left === 'a' ? 'b' : 'a';
      const va = get(p.a), vb = get(p.b);
      if (!Number.isFinite(va) || !Number.isFinite(vb)) continue;
      scored++;
      const pref = va === vb ? null : (better === 'low' ? (va < vb ? 'a' : 'b') : (va > vb ? 'a' : 'b'));
      if (chosen) decided++;
      const ok = chosen !== null && pref === chosen;
      if (ok) agree++;
      detail.push({ dis: !!p.dis, pair: a.pair, chosen, metricPrefers: pref, agree: ok, a: va, b: vb, capture: p.capture, signal: p.signal, variants: [p.a.variant, p.b.variant] });
    }
    const rate = scored ? agree / scored : NaN;
    const verdict = !scored ? 'no pairs' : rate >= 0.8 ? 'PASS' : 'FAIL (fix this metric before it gates anything)';
    const dd = detail.filter((x) => x.dis);
    out[metric][name] = { disagreePairs: dd.length, disAgree: dd.filter((x) => x.agree).length, scored, decided, agree, rateAnswered: rate, rateDecided: decided ? agree / decided : NaN, verdict, pairs: detail };
    lines.push(`| ${name} | ${scored} | ${agree} / ${scored} (${Number.isFinite(rate) ? (rate * 100).toFixed(0) : '–'} %) | ${agree} / ${decided} | ${verdict}${dd.length ? ` (on the ${dd.length} stride-disagreement pairs: ${dd.filter((x) => x.agree).length})` : ''} |`);
  }
  // disagreements, for fixing the metric
  const worst = DEFS[metric][0][0];
  if (metric === 'calm') { const dis = mine.filter((a) => byId.get(a.pair).dis); lines.push(`Of these, ${dis.length} are pairs where stride 1 and stride 8 disagree on the winner: agree-with-Dennis there is the direct test of which stride matches his eye (see the two stride rows; their counts on those pairs are in the last column).`, ''); }
  const bad = out[metric][worst].pairs.filter((x) => !x.agree);
  if (bad.length) { lines.push('', `Pairs where "${worst}" and Dennis differ (${bad.length}): ${bad.map((x) => `${x.pair} (${x.capture}/${x.signal}: ${x.variants.join(' vs ')}; he chose ${x.chosen ?? "can't tell"})`).join('; ')}`); }
  lines.push('');
}
// trade-off: which side does he weigh more? (option with the lower boil vs the option with the lower FLIP)
{
  const mine = [...answers.values()].filter((a) => a.metric === 'tradeoff' && byId.has(a.pair));
  let calmer = 0, sharper = 0, tie = 0; const det = [];
  for (const a of mine) {
    const p = byId.get(a.pair), left = a.leftIs, chosen = a.pick === 'tie' ? null : a.pick === 'left' ? left : left === 'a' ? 'b' : 'a';
    if (!chosen) { tie++; continue; }
    const calmSide = p.a.calm.boil < p.b.calm.boil ? 'a' : 'b';
    if (chosen === calmSide) calmer++; else sharper++;
    det.push({ pair: a.pair, chose: chosen === calmSide ? 'calmer' : 'sharper', capture: p.capture, signal: p.signal, variants: [p.a.variant, p.b.variant] });
  }
  out.tradeoff = { calmer, sharper, tie, pairs: det };
  lines.push(`## trade-off (calmer but blurrier vs sharper but boils): ${mine.length} answered`, '', `He picked the calmer option ${calmer}x, the sharper option ${sharper}x, "can't tell" ${tie}x. This is the weight to give calm vs detail when a change trades one for the other.`, '');
}
const unanswered = key.pairs.filter((p) => !answers.has(p.id)).length;
lines.push(`${answers.size} answers merged from ${files.length} file(s); ${unanswered} of ${key.pairs.length} pairs unanswered.`);
console.log(lines.join('\n'));
if (opt('json')) writeFileSync(opt('json'), JSON.stringify(out, null, 1));
