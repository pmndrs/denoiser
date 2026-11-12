#!/usr/bin/env node
// Cost summary for GOLDEN-BRIEF step 4 from time-golden.ps1's output folder (harness builder's tool, outside the repo).
//   node cost.mjs <timingDir>     -> markdown tables on stdout, cost.json next to the inputs
// native: harness timings-loops.csv, steady frames (frame >= 1 of every loop), median per round, then median of rounds
// golden: driver `time` JSON (n = 120 after 10 warm-up), median per round, then median of rounds (min / max of rounds shown)
// bench:  bench-win.mjs JSONL (track D's test-bed solo bench, 1080p orbit, n = 200), median of rounds
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const T = process.argv[2];
const med = (v) => { const s = [...v].sort((a, b) => a - b); const n = s.length; return n ? (n % 2 ? s[n >> 1] : (s[n / 2 - 1] + s[n / 2]) / 2) : NaN; };
const q = (v, p) => { const s = [...v].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const f = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '–');
const rng = (v, d = 2) => (v.length > 1 ? ` (${f(Math.min(...v), d)}–${f(Math.max(...v), d)})` : '');
const out = { native: {}, golden: {}, bench: {} };

// ---- native
const rounds = readdirSync(T).filter((d) => /^native-r\d+$/.test(d)).sort();
const nat = {};
for (const r of rounds) for (const cap of readdirSync(path.join(T, r))) for (const den of readdirSync(path.join(T, r, cap))) {
  const file = path.join(T, r, cap, den, 'timings-loops.csv');
  if (!existsSync(file)) continue;
  const rows = readFileSync(file, 'utf8').trim().split(/\r?\n/).slice(1).map((l) => l.split(','));
  const g = { total: [], wall: [], resetTotal: [] };
  for (const [, fr, pass, ms] of rows) {
    if (pass !== 'total' && pass !== 'wall') continue;
    if (Number(fr) === 0) { if (pass === 'total') g.resetTotal.push(+ms); continue; }
    g[pass].push(+ms);
  }
  const k = `${cap}|${den}`;
  (nat[k] ??= []).push({ round: r, gpu: med(g.total), p10: q(g.total, 0.1), p90: q(g.total, 0.9), wall: med(g.wall), reset: med(g.resetTotal), n: g.total.length });
}
console.log('### Native (harness, `--loops 8`, steady frames 1–7 of each loop = 56 per round)\n');
console.log('| capture | denoiser | GPU ms median (range of rounds) | p10 / p90 (all rounds) | reset frame GPU | wall ms (fence) | wall − GPU |');
console.log('|---|---|---|---|---|---|---|');
for (const [k, rs] of Object.entries(nat).sort()) {
  const [cap, den] = k.split('|');
  const gpu = rs.map((r) => r.gpu), wall = rs.map((r) => r.wall);
  out.native[k] = { gpu: med(gpu), gpuRounds: gpu, wall: med(wall), wallRounds: wall, reset: med(rs.map((r) => r.reset)), p10: med(rs.map((r) => r.p10)), p90: med(rs.map((r) => r.p90)) };
  const o = out.native[k];
  console.log(`| ${cap.replace('golden-', '')} | ${den} | **${f(o.gpu)}**${rng(gpu)} | ${f(o.p10)} / ${f(o.p90)} | ${f(o.reset)} | ${f(o.wall)}${rng(wall)} | ${f(o.wall - o.gpu)} |`);
}

// ---- ours through the test-bed replay of the same 1080p timing captures (time-replay.ps1): frames 1-7 of each run
const rep = {};
for (const r of readdirSync(T).filter((d) => /^replay-r\d+$/.test(d)).sort()) for (const cap of readdirSync(path.join(T, r))) for (const tag of readdirSync(path.join(T, r, cap))) {
  const file = path.join(T, r, cap, tag, 'timings.csv');
  if (!existsSync(file)) continue;
  const rows = readFileSync(file, 'utf8').trim().split(/\r?\n/).slice(1).map((l) => l.split(','));
  const g = { total: [], wall: [], resetTotal: [], resetWall: [], passes: {} };
  for (const [fr, pass, ms] of rows) {
    if (Number(fr) === 0) { if (pass === 'total') g.resetTotal.push(+ms); if (pass === 'wall') g.resetWall.push(+ms); continue; }
    if (pass === 'total' || pass === 'wall') g[pass].push(+ms); else (g.passes[pass] ??= []).push(+ms);
  }
  (rep[`${cap}|${tag}`] ??= []).push({ gpu: med(g.total), wall: med(g.wall), p90: q(g.wall, 0.9), all: g });
}
console.log('### Ours, test-bed replay of the same 1080p timing captures (frames 1–7 of each run, 7 per round; median of round medians)\n');
console.log('| capture | arm | rounds | GPU ms (sum of passes) | wall ms dispatch→fence (range of rounds) | wall − GPU | first frame (reset) wall |');
console.log('|---|---|---|---|---|---|---|');
out.replay = {};
for (const [k, rs] of Object.entries(rep).sort()) {
  const [cap, tag] = k.split('|');
  const gpu = med(rs.map((r) => r.gpu)), wall = med(rs.map((r) => r.wall));
  const resetWall = med(rs.flatMap((r) => r.all.resetWall));
  const passes = {};
  for (const r of rs) for (const [p, v] of Object.entries(r.all.passes)) (passes[p] ??= []).push(...v);
  out.replay[k] = { rounds: rs.length, gpu, gpuRounds: rs.map((r) => r.gpu), wall, wallRounds: rs.map((r) => r.wall), resetWall, passes: Object.fromEntries(Object.entries(passes).map(([p, v]) => [p, med(v)])) };
  console.log(`| ${cap.replace('golden-', '')} | ${tag.replace('time-', '')} | ${rs.length} | **${f(gpu)}**${rng(rs.map((r) => r.gpu))} | **${f(wall, 1)}**${rng(rs.map((r) => r.wall), 1)} | ${f(wall - gpu, 1)} | ${f(resetWall, 1)} |`);
}
console.log('');

// ---- golden driver `time`
const gold = {};
for (const file of readdirSync(T).filter((x) => /^golden-.*-r\d+\.json$/.test(x))) {
  const [, scene, den, r] = file.match(/^golden-(\w+)-(\w+)-r(\d+)\.json$/);
  let j; try { j = JSON.parse(readFileSync(path.join(T, file), 'utf8')); } catch { console.error(`unreadable ${file}`); continue; }
  const g = j.time.gpu, groups = {};
  for (const [name, s] of Object.entries(g)) { const m = name.match(/^(.+)\.total$/); if (m) groups[m[1]] = s.median; }
  ((gold[scene] ??= {})[den] ??= []).push({ round: +r, wall: j.time.wall.median, wallMin: j.time.wall.min, total: g.total?.median ?? 0, groups, passes: Object.fromEntries(Object.entries(g).map(([n, s]) => [n, s.median])) });
}
console.log('\n### Golden driver `time` (1080p, lean, whole frame: rays + denoisers; n = 120 per round, median of rounds)\n');
console.log('| scene | denoiser | wall ms median (range of rounds) | denoiser GPU ms total | per group GPU ms | wall − raw wall | (wall − raw) − GPU |');
console.log('|---|---|---|---|---|---|---|');
for (const [scene, dens] of Object.entries(gold).sort()) {
  const rawWall = med((dens.raw ?? []).map((r) => r.wall));
  for (const den of ['raw', 'ffx', 'ours']) {
    const rs = dens[den]; if (!rs) continue;
    const wall = med(rs.map((r) => r.wall)), total = med(rs.map((r) => r.total));
    const groups = {};
    for (const r of rs) for (const [n, v] of Object.entries(r.groups)) (groups[n] ??= []).push(v);
    const gm = Object.fromEntries(Object.entries(groups).map(([n, v]) => [n, med(v)]));
    const d = wall - rawWall;
    out.golden[`${scene}|${den}`] = { wall, wallRounds: rs.map((r) => r.wall), total, groups: gm, overRaw: d };
    console.log(`| ${scene} | ${den} | **${f(wall, 1)}**${rng(rs.map((r) => r.wall), 1)} | ${den === 'raw' ? '–' : f(total)} | ${Object.entries(gm).map(([n, v]) => `${n} ${f(v)}`).join(', ') || '–'} | ${den === 'raw' ? '–' : f(d, 1)} | ${den === 'raw' ? '–' : f(d - total, 1)} |`);
  }
}
// ours per pass (median of rounds), G3 and G4
for (const [scene, dens] of Object.entries(gold).sort()) {
  const rs = dens.ours; if (!rs) continue;
  const names = Object.keys(rs[0].passes).filter((n) => n !== 'total');
  out.golden[`${scene}|ours`].passes = Object.fromEntries(names.map((n) => [n, med(rs.map((r) => r.passes[n]))]));
}

// ---- bench pages
const bl = existsSync(path.join(T, 'bench-1080p.jsonl')) ? readFileSync(path.join(T, 'bench-1080p.jsonl'), 'utf8').trim().split(/\r?\n/).map((l) => JSON.parse(l)) : [];
const by = {};
for (const b of bl) (by[b.label] ??= []).push(b);
console.log('\n### Track D bench pages (test bed solo, 1080p orbit, diffuse only, n = 200 per page, median of rounds)\n');
console.log('| page | rounds | GPU ms (timestamps) | wall ms median (range of rounds) | wall p90 | CPU encode ms | wall − GPU |');
console.log('|---|---|---|---|---|---|---|');
for (const [label, rs] of Object.entries(by)) {
  const ok = rs.filter((r) => r.res);
  const gpu = med(ok.map((r) => r.res.gpuMs?.median).filter(Number.isFinite));
  const wall = med(ok.map((r) => r.res.wallMs.median)), p90 = med(ok.map((r) => r.res.wallMs.p90));
  const cpu = med(ok.map((r) => r.res.passesMs?.cpu).filter(Number.isFinite));
  out.bench[label] = { rounds: ok.length, gpu, wall, wallRounds: ok.map((r) => r.res.wallMs.median), p90, cpu, temps: rs.map((r) => r.gpuBefore.temp), clocks: [...new Set(rs.map((r) => `${r.gpuBefore.gr}/${r.gpuBefore.mem}`))] };
  console.log(`| ${label} | ${ok.length}/${rs.length} | ${f(gpu)} | **${f(wall, 1)}**${rng(ok.map((r) => r.res.wallMs.median), 1)} | ${f(p90, 1)} | ${f(cpu, 1)} | ${Number.isFinite(gpu) ? f(wall - gpu, 1) : '–'} |`);
}
// ---- clocks: nvidia-smi logs (200 ms) per run family, busy samples only (utilization > 20 %)
console.log('\n### Clocks while busy (nvidia-smi every 200 ms, utilization > 20 %)\n');
console.log('| runs | busy samples | below 1190 MHz | min graphics MHz | max °C | throttle reasons (count) |');
console.log('|---|---|---|---|---|---|');
const fam = (fn) => fn.replace(/^smi-/, '').replace(/-r\d+\.csv$/, '').replace(/\.csv$/, '').replace(/^(golden)-(G\d)-\w+$/, '$1 `time` $2').replace(/^replay-golden-(G\d)-.*$/, 'replay $1').replace(/^native-golden-(G\d)-.*$/, 'native $1');
const fams = {};
for (const fn of readdirSync(T).filter((x) => /^smi-.*\.csv$/.test(x))) {
  const rows = readFileSync(path.join(T, fn), 'utf8').trim().split(/\r?\n/).map((l) => l.split(/,\s*/)).filter((c) => c.length >= 7 && parseInt(c[4]) > 20);
  const a = (fams[fam(fn)] ??= { n: 0, low: 0, min: Infinity, maxT: 0, thr: {} });
  for (const c of rows) { const g = parseInt(c[2]); a.n++; if (g < 1190) a.low++; a.min = Math.min(a.min, g); a.maxT = Math.max(a.maxT, parseInt(c[1])); a.thr[c[6]] = (a.thr[c[6]] ?? 0) + 1; }
}
const thrName = { '0x0000000000000001': 'idle/none', '0x0000000000000004': 'SW power cap', '0x0000000000000020': 'SW thermal slowdown', '0x0000000000000024': 'power + thermal' };
out.clocks = fams;
for (const [k, a] of Object.entries(fams).sort()) console.log(`| ${k} | ${a.n} | ${a.low} (${f((100 * a.low) / a.n, 0)} %) | ${a.min} | ${a.maxT} | ${Object.entries(a.thr).map(([t, n]) => `${thrName[t] ?? t} ${n}`).join(', ')} |`);
writeFileSync(path.join(T, 'cost.json'), JSON.stringify(out, null, 1));
