// node sum.mjs <jsonl> [filter regex on label]: per label, median of run medians, min, spread, per-pass medians
import { readFileSync } from 'node:fs';
const rows = readFileSync(process.argv[2], 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.gpuMs && (process.env.ALLOW_VIDEO || !r.video) && r.round >= Number(process.env.MINROUND ?? 0));
const med = (a) => { const s = [...a].sort((x, y) => x - y); const n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };
const by = new Map(); for (const r of rows) { if (!by.has(r.label)) by.set(r.label, []); by.get(r.label).push(r); }
for (const [l, rs] of by) {
  const m = rs.map((r) => r.gpuMs.median), mins = rs.map((r) => r.gpuMs.min);
  const passes = Object.keys(rs[0].passesMs ?? {});
  const pm = Object.fromEntries(passes.map((p) => [p, med(rs.map((r) => r.passesMs[p]))]));
  const at = ['atrous_0', 'atrous_1', 'atrous_2', 'atrous_3', 'atrous_4'].map((p) => pm[p]?.toFixed(3)).join(' ');
  const atSum = ['atrous_0', 'atrous_1', 'atrous_2', 'atrous_3', 'atrous_4'].reduce((a, p) => a + (pm[p] ?? 0), 0);
  console.log(`${l.padEnd(44)} n=${rs.length} median ${med(m).toFixed(3)} min ${Math.min(...mins).toFixed(3)} runs ${[...m].sort((a, b) => a - b).map((x) => x.toFixed(2)).join(' ')}`);
  console.log(`${''.padEnd(44)} atrous ${at} = ${atSum.toFixed(3)} | prepass ${pm.prepass?.toFixed(3)} gcreate ${pm.gradient_create?.toFixed(3)} temporal ${pm.temporal?.toFixed(3)} variance ${pm.variance?.toFixed(3)}`);
}
