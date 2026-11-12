#!/usr/bin/env node
// Windows port of track D's tools/bench.mjs (track/d-diffuse, results/data/d/tools/bench.mjs): test-bed solo bench, 1080p
// orbit, n frames, one configuration per page, alternating round order, each round led by a throwaway page, quiet check
// before every page. Quiet = GPU utilization <= 5 % on 3 nvidia-smi samples and no other headless Chrome.
// Appends one JSON line per page (plus the GPU clocks/temperature sampled just before) to <out.jsonl>.
//   BASE=http://127.0.0.1:5305/ node bench-win.mjs <pages.json> <rounds> <out.jsonl> [n]
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync, unlinkSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const TB = process.env.TB ?? 'C:/dev/nrd-reference/golden/wt-d/examples/realtime-denoiser';
const PAGES = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const rounds = Number(process.argv[3] ?? 3), OUT = process.argv[4], N = Number(process.argv[5] ?? 200);
const tmp = path.join(os.tmpdir(), `d-bench-${process.pid}.json`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const smi = () => execFileSync('nvidia-smi', ['--query-gpu=utilization.gpu,temperature.gpu,clocks.gr,clocks.mem,clocks_throttle_reasons.active', '--format=csv,noheader,nounits'], { encoding: 'utf8' }).trim().split(/,\s*/);
function busy() {
  const who = [];
  const u = Number(smi()[0]);
  if (u > 5) who.push(`gpu ${u}%`);
  const ps = execFileSync('powershell', ['-NoProfile', '-Command', "(Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | Where-Object { $_.CommandLine -match '--headless' }).Count"], { encoding: 'utf8' }).trim();
  if (Number(ps) > 0) who.push(`headless chrome x${ps}`);
  return who;
}
async function waitQuiet() {
  for (let w = 0; ; w += 5) {
    const b = busy();
    if (!b.length) { await sleep(1500); if (!busy().length) return w; }
    if (w % 300 === 0) console.log(`  waiting for quiet (${b.join(' ')})`);
    await sleep(5000);
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
    const [, temp, gr, mem, thr] = smi();
    const t = new Date().toISOString();
    const { q, res } = page(signal, id, extra, false);
    appendFileSync(OUT, JSON.stringify({ round: k, label, q, t, waited, gpuBefore: { temp: +temp, gr: +gr, mem: +mem, thr }, res }) + '\n');
    console.log(`round ${k} ${label}: gpu ${res?.gpuMs?.median ?? '-'} wall ${res?.wallMs?.median ?? '-'} cpu ${res?.passesMs?.cpu ?? '-'}`);
  }
}
