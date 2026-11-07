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
    ['boil (second difference, all regions)', (o) => o.calm.boil, 'low'],
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
      detail.push({ pair: a.pair, chosen, metricPrefers: pref, agree: ok, a: va, b: vb, capture: p.capture, signal: p.signal, variants: [p.a.variant, p.b.variant] });
    }
    const rate = scored ? agree / scored : NaN;
    const verdict = !scored ? 'no pairs' : rate >= 0.8 ? 'PASS' : 'FAIL (fix this metric before it gates anything)';
    out[metric][name] = { scored, decided, agree, rateAnswered: rate, rateDecided: decided ? agree / decided : NaN, verdict, pairs: detail };
    lines.push(`| ${name} | ${scored} | ${agree} / ${scored} (${Number.isFinite(rate) ? (rate * 100).toFixed(0) : '–'} %) | ${agree} / ${decided} | ${verdict} |`);
  }
  // disagreements, for fixing the metric
  const worst = DEFS[metric][0][0];
  const bad = out[metric][worst].pairs.filter((x) => !x.agree);
  if (bad.length) { lines.push('', `Pairs where "${worst}" and Dennis differ (${bad.length}): ${bad.map((x) => `${x.pair} (${x.capture}/${x.signal}: ${x.variants.join(' vs ')}; he chose ${x.chosen ?? "can't tell"})`).join('; ')}`); }
  lines.push('');
}
const unanswered = key.pairs.filter((p) => !answers.has(p.id)).length;
lines.push(`${answers.size} answers merged from ${files.length} file(s); ${unanswered} of ${key.pairs.length} pairs unanswered.`);
console.log(lines.join('\n'));
if (opt('json')) writeFileSync(opt('json'), JSON.stringify(out, null, 1));
