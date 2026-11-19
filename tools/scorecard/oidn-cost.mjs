#!/usr/bin/env node
// E-2b cost at 1920x1080 (docs/research/rt-denoiser/results/E2b-oidn-vs-svgf.md "Cost"): OIDN fast / balanced / high
// (fp32, and fp16 for fast / high) vs our shipped filters, replayed on std1080-orbit (8 frames) through tools/rt-capture,
// ROUNDS interleaved rounds, each round one batch under tools/gpu-lock.sh (TASKS rule 11). Frame 0 is dropped (it
// compiles). Reported per configuration: the fastest frame and the best round's median.
//   OIDN: `<signal>/total` = wall ms of one awaited denoiseTextures() call on its own max-limits device (extract + network +
//         resolve), without the cross-device copies (src/oidn-entries.ts), per signal.
//   ours: the per-frame GPU total (timestamp queries, sum of the signals' 'total' passes) and the wall ms (dispatch to
//         queue idle) of the replay.
// The Mac is shared: every round records the load average and how many other headless Chromes ran. Read the numbers
// as best-effort; the fastest frame is the least contended one.
//
//   node tools/scorecard/oidn-cost.mjs --work <dir with captures/std1080-orbit> [--rounds 3] [--port 5399] [--out <json>]
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ensureVite, REPO_ROOT } from '../rt-capture/lib/headless.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i < 0 ? d : args[i + 1]; };
const WORK = path.resolve(opt('work', ''));
const CAP = opt('capture', 'std1080-orbit');
if (!existsSync(path.join(WORK, 'captures', CAP, 'capture.json'))) { console.error(`--work <dir> with captures/${CAP} required`); process.exit(2); }
process.env.RT_CAPTURE_DIR = WORK;
const ROUNDS = Number(opt('rounds', 3));
const BASE = `http://127.0.0.1:${Number(opt('port', 5399))}/`;
const OUT = path.resolve(opt('out', path.join(REPO_ROOT, 'docs/research/rt-denoiser/results/data/e2b-cost.json')));

const CONFIGS = [
  { id: 'oidn-high', q: 'denoiser=oidn&signals=diffuse', kind: 'oidn', label: 'OIDN high, fp32 (large weights)' },
  { id: 'oidn-balanced', q: 'denoiser=oidn-balanced&signals=diffuse', kind: 'oidn', label: 'OIDN balanced, fp32 (base weights)' },
  { id: 'oidn-fast', q: 'denoiser=oidn-default&signals=diffuse', kind: 'oidn', label: 'OIDN fast, fp32 (small weights)' },
  { id: 'oidn-high-fp16', q: 'denoiser=oidn&signals=diffuse&oidn.precision=fp16', kind: 'oidn', label: 'OIDN high, fp16' },
  { id: 'oidn-fast-fp16', q: 'denoiser=oidn-default&signals=diffuse&oidn.precision=fp16', kind: 'oidn', label: 'OIDN fast, fp16' },
  { id: 'svgf-auto', q: 'denoiser=svgf-auto&signals=diffuse,specular', kind: 'ours', label: 'ours: A-SVGF diffuse + specular (both signals, shipped)' },
  { id: 'shadows', q: 'denoiser=shadows&signals=visibility', kind: 'ours', label: 'ours: shadows (shipped)' },
  { id: 'occlusion-svgf-auto', q: 'denoiser=occlusion-svgf-auto&signals=ao', kind: 'ours', label: 'ours: AO (occlusion A-SVGF, shipped)' },
];
const headless = () => { const r = spawnSync('pgrep', ['-f', 'Chrome.*--headless'], { encoding: 'utf8' }); return (r.stdout ?? '').split('\n').filter(Boolean).length; };
const median = (v) => { const s = [...v].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : NaN; };

const server = await ensureVite({ root: path.join(REPO_ROOT, 'tools', 'rt-capture'), base: BASE });
const rounds = [];
try {
  for (let r = 0; r < ROUNDS; r++) {
    const before = { load: os.loadavg(), otherHeadless: headless(), at: new Date().toISOString() };
    const queries = CONFIGS.map((c) => `capture=${CAP}&${c.q}&output=cost-${c.id}`);
    const p = spawnSync(path.join(REPO_ROOT, 'tools', 'gpu-lock.sh'), [`e2b cost round ${r + 1}`, process.execPath, path.join(REPO_ROOT, 'tools', 'rt-capture', 'run-headless.mjs'), ...queries],
      { encoding: 'utf8', maxBuffer: 1 << 26, env: { ...process.env, BASE } });
    const round = { ...before, loadAfter: os.loadavg(), exit: p.status, configs: {} };
    for (const c of CONFIGS) {
      const dir = path.join(WORK, 'outputs', CAP, `cost-${c.id}`);
      try {
        const rows = readFileSync(path.join(dir, 'timings.csv'), 'utf8').trim().split('\n').slice(1).map((l) => { const [f, pass, ms] = l.split(','); return { f: +f, pass, ms: +ms }; });
        const per = new Map();
        for (const t of rows) {
          if (t.f === 0) continue;
          const key = c.kind === 'oidn' ? (t.pass.endsWith('/total') ? 'oidnMs' : t.pass === 'wall' ? 'wall' : null) : (t.pass === 'wall' ? 'wall' : (t.pass === 'total' || t.pass.endsWith('/total')) ? 'gpu' : null);
          if (!key) continue;
          const m = per.get(key) ?? new Map(); m.set(t.f, (m.get(t.f) ?? 0) + t.ms); per.set(key, m);
        }
        round.configs[c.id] = Object.fromEntries([...per].map(([k, m]) => { const v = [...m.values()]; return [k, { min: Math.min(...v), median: median(v), n: v.length }]; }));
        try { round.configs[c.id].info = JSON.parse(readFileSync(path.join(dir, 'run.json'), 'utf8')).denoiserInfo ?? null; } catch { /* ours */ }
      } catch (e) { round.configs[c.id] = { error: String(e).slice(0, 200) }; }
      rmSync(dir, { recursive: true, force: true });
    }
    rounds.push(round);
    console.log(`round ${r + 1}: load ${before.load.map((x) => x.toFixed(1)).join(' ')}, other headless chromes ${before.otherHeadless}, exit ${p.status}`);
    for (const c of CONFIGS) console.log(`  ${c.id.padEnd(22)} ${JSON.stringify(Object.fromEntries(Object.entries(round.configs[c.id]).filter(([k]) => k !== 'info')))}`);
  }
} finally {
  await server.stop();
}
const summary = Object.fromEntries(CONFIGS.map((c) => {
  const key = c.kind === 'oidn' ? 'oidnMs' : 'gpu';
  const ok = rounds.map((r) => r.configs[c.id]?.[key]).filter(Boolean);
  const wall = rounds.map((r) => r.configs[c.id]?.wall).filter(Boolean);
  return [c.id, { label: c.label, kind: c.kind, metric: key, fastest: Math.min(...ok.map((x) => x.min)), bestMedian: Math.min(...ok.map((x) => x.median)),
    wallFastest: Math.min(...wall.map((x) => x.min)), wallBestMedian: Math.min(...wall.map((x) => x.median)) }];
}));
mkdirSync(path.dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({ capture: CAP, generated: new Date().toISOString(), host: os.cpus()[0]?.model, summary, rounds }, null, 1));
console.log(JSON.stringify(summary, null, 1));
