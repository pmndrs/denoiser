#!/usr/bin/env node
// Track D bench (tracks/d.md): the SVGF-COST / REMEASURE bench loop (test bed solo bench, 1080p orbit, n frames after 20
// warm-up, one configuration per page, alternating round order, each round led by a throwaway page, quiet check before
// every page) against one server. Appends one JSON line per page to <out.jsonl>.
//   BASE=http://127.0.0.1:5305/ node bench.mjs <pages.json> <rounds> <out.jsonl> [n]
//   pages: [[label, signal, denoiser id, extra query], ...]
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync, unlinkSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const TB = '/Users/dex/Developer/Denoiser-track-d/examples/realtime-denoiser';
const PAGES = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const rounds = Number(process.argv[3] ?? 3), OUT = process.argv[4], N = Number(process.argv[5] ?? 200);
const tmp = path.join(os.tmpdir(), `d-bench-${process.pid}.json`);
function busy() {
  const out = execFileSync('ps', ['-axo', 'pid=,ppid=,pcpu=,command='], { encoding: 'utf8', maxBuffer: 1 << 26 });
  const ps = out.split('\n').filter(Boolean).map((l) => { const m = l.trim().match(/^(\d+)\s+(\d+)\s+([\d.]+)\s+(.*)$/); return m && { pid: +m[1], ppid: +m[2], cpu: +m[3], cmd: m[4] }; }).filter(Boolean);
  const kids = new Map(); for (const p of ps) { if (!kids.has(p.ppid)) kids.set(p.ppid, []); kids.get(p.ppid).push(p); }
  const tree = (p) => [p, ...(kids.get(p.pid) ?? []).flatMap(tree)];
  const roots = ps.filter((p) => (/Google Chrome/.test(p.cmd) && /--headless/.test(p.cmd) && !/Helper/.test(p.cmd))
    || (/run-headless|run-realtime/.test(p.cmd) && /node/.test(p.cmd)));
  const who = [];
  for (const r of roots) { const c = tree(r).reduce((a, x) => a + x.cpu, 0); if (c > 3) who.push(`${r.pid}:${c.toFixed(0)}%`); }
  const asr = execFileSync('pmset', ['-g', 'assertions'], { encoding: 'utf8' });
  if (/Video Wake Lock/.test(asr)) who.push('video-wake-lock');
  return who;
}
async function waitQuiet() {
  for (let w = 0; ; w += 5) {
    const b = busy();
    if (!b.length) { await new Promise((r) => setTimeout(r, 1500)); if (!busy().length) return w; }
    if (w % 300 === 0) console.log(`  waiting for quiet (${b.join(' ')})`);
    await new Promise((r) => setTimeout(r, 5000));
  }
}
function page(signal, id, extra, warm) {
  const q = `signal=${signal}&mode=bench&preset=full&path=orbit&n=${warm ? 40 : N}&denoiser=${id}${extra ? '&' + extra : ''}`;
  if (existsSync(tmp)) unlinkSync(tmp);
  spawnSync(process.execPath, ['run-headless.mjs', `--json=${tmp}`, q], { cwd: TB, env: process.env, encoding: 'utf8' });
  if (warm) return {};
  try { const j = JSON.parse(readFileSync(tmp, 'utf8'))[0].results; return { q, res: j.results[signal][id] }; } catch { return { q, res: null }; }
}
for (let k = 0; k < rounds; k++) {
  const order = k % 2 ? [...PAGES].reverse() : PAGES;
  await waitQuiet();
  page(order[0][1], order[0][2], order[0][3], true);
  for (const [label, signal, id, extra] of order) {
    const waited = await waitQuiet();
    const t = new Date().toISOString();
    const { q, res } = page(signal, id, extra, false);
    appendFileSync(OUT, JSON.stringify({ round: k, label, q, t, waited, res }) + '\n');
    console.log(`round ${k} ${label}: gpu ${res?.gpuMs?.median ?? '-'} wall ${res?.wallMs?.median ?? '-'} cpu ${res?.passesMs?.cpu ?? '-'} span ${res?.passesMs?.span ?? '-'}`);
  }
}
