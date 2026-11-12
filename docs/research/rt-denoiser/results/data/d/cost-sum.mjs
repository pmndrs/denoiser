#!/usr/bin/env node
// Track D: summary of tools/bench.mjs JSONL (tracks/d.md §6). Per label: median over runs of each run's median frame
// (GPU total = sum of pass timestamps, span = first pass begin -> last pass end, wall = dispatch() call -> onSubmittedWorkDone,
// cpu = the dispatch() call itself), the run spread, and the per-pass medians of --passes <label>.
//   node cost-sum.mjs <bench.jsonl> [--from-round 1] [--passes "default (timestamps)"]
import { readFileSync } from 'node:fs';
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i < 0 ? d : args[i + 1]; };
const rows = readFileSync(args[0], 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.res && r.round >= Number(opt('from-round', 0)));
const med = (xs) => { const s = xs.filter((x) => x != null && Number.isFinite(x)).sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
const f3 = (x) => (x == null ? '–' : x.toFixed(3));
const labels = [...new Set(rows.map((r) => r.label))];
console.log('| configuration | runs | GPU sum of passes | GPU span | wall | CPU (dispatch call) | wall − span | wall run range |');
console.log('|---|---|---|---|---|---|---|---|');
for (const l of labels) {
  const rs = rows.filter((r) => r.label === l);
  const g = med(rs.map((r) => r.res.gpuMs?.median)), sp = med(rs.map((r) => r.res.passesMs?.span)), w = med(rs.map((r) => r.res.wallMs?.median)), c = med(rs.map((r) => r.res.passesMs?.cpu));
  const ws = rs.map((r) => r.res.wallMs?.median).filter(Number.isFinite);
  console.log(`| ${l} | ${rs.length} | ${f3(g)} | ${f3(sp)} | ${f3(w)} | ${f3(c)} | ${sp != null && w != null ? f3(w - sp) : '–'} | ${f3(Math.min(...ws))}–${f3(Math.max(...ws))} |`);
}
const pl = opt('passes', 'default (timestamps)');
const pr = rows.filter((r) => r.label === pl);
if (pr.length) {
  const names = Object.keys(pr[0].res.passesMs).filter((k) => !['cpu', 'span'].includes(k));
  console.log(`\nper pass, ${pl} (median over ${pr.length} runs of each run's median):\n`);
  console.log('| pass | ms |');
  console.log('|---|---|');
  let sum = 0;
  for (const n of names) { const v = med(pr.map((r) => r.res.passesMs[n])); sum += v; console.log(`| ${n} | ${f3(v)} |`); }
  console.log(`| sum | ${f3(sum)} |`);
}
