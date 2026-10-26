// Merge both bench sets, tag pages run during the desktop video call, summarize clean runs.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
const S = '/private/tmp/claude-502/-Users-dex-Developer-Denoiser-nrd-cleanroom/e9f5ef6a-5b0b-422e-b903-b6fd737cf629/scratchpad/remeasure26';
const load = (f) => existsSync(f) ? readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
const set1 = load(`${S}/out/bench.jsonl`), set2 = load(`${S}/out/bench2.jsonl`);
const CALL0 = Date.parse('2026-10-26T19:57:16+09:00');   // first slow page (round 3, q25) finished 19:57:21
for (const r of set1) r.externalLoad = Date.parse(r.at) >= CALL0 ? 'desktop video call (Slack, camera on)' : null;
for (const r of set2) r.externalLoad ??= null;
const all = [...set1, ...set2];
if (process.argv[2]) writeFileSync(process.argv[2], all.map((r) => JSON.stringify(r)).join('\n') + '\n');
const med = (xs) => { const s = [...xs].sort((a, b) => a - b); const n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };
const show = (title, recs) => {
  const g = {}; for (const r of recs) (g[r.label] ??= []).push(r);
  console.log(`\n### ${title}\n| config | runs | median | min frame | fastest run | run medians (sorted) | passes |`);
  for (const [k, rs] of Object.entries(g)) {
    const meds = rs.map((r) => r.gpuMs.median), mins = rs.map((r) => r.gpuMs.min);
    const passes = {}; for (const r of rs) for (const [p, v] of Object.entries(r.passesMs)) (passes[p] ??= []).push(v);
    const ps = Object.entries(passes).map(([p, v]) => `${p} ${med(v).toFixed(3)}`).join(', ');
    console.log(`| ${k} | ${rs.length} | ${med(meds).toFixed(2)} | ${Math.min(...mins).toFixed(2)} | ${Math.min(...meds).toFixed(2)} | ${[...meds].sort((a, b) => a - b).map((x) => x.toFixed(2)).join(' ')} | ${process.env.P ? ps : ''} |`);
  }
};
const ok = all.filter((r) => r.gpuMs && !r.contendedAfter);
console.log(`pages ${all.length}; failed ${all.filter((r) => !r.gpuMs).length}; headless-contended ${all.filter((r) => r.contendedAfter).length}; during call ${all.filter((r) => r.externalLoad).length}`);
show('clean (no headless contention, no video call)', ok.filter((r) => !r.externalLoad));
if (process.env.ALL) show('during the video call', ok.filter((r) => r.externalLoad));
