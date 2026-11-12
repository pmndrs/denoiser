// T5 cost bench (results/T5-normal-detail.md): solo pages of the test bed's mode=bench, 1080p, path dt-bumpy, signal
// sh-diffuse (one DiffuseDenoiser per page), alternating order per round, a throwaway warm-up page first, each page only
// when no other headless Chrome / runner uses CPU and no desktop video call runs (remeasure-2026-10-26/bench.mjs's check).
//   BASE=http://127.0.0.1:<port>/ OUT=<file.jsonl> node bench.mjs <rounds> [n]
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync, unlinkSync, existsSync } from 'node:fs';
const TB = process.env.TB ?? '/Users/dex/Developer/Denoiser-nrd-cleanroom/examples/realtime-denoiser';
const rounds = Number(process.argv[2] ?? 5), N = Number(process.argv[3] ?? 200);
const PAGES = [
  ['plain default (A-SVGF, shading normal)', 'svgf-plain-default', ''],
  ['sh (svgf-sh-auto)', 'svgf-sh-auto', ''],
  ['sh + youngNormalPower 16', 'svgf-sh-auto', 'youngNormalPower=16'],
  ['sh + shDetailNormalPower 8', 'svgf-sh-auto', 'm7.detailPow=8'],
  ['sh + shDetailNormalPower 16', 'svgf-sh-auto', 'm7.detailPow=16'],
  ['sh + shSharpen 1', 'svgf-sh-auto', 'm7.sharpen=1'],
];
function procs() {
  const out = execFileSync('ps', ['-axo', 'pid=,ppid=,pcpu=,command='], { encoding: 'utf8', maxBuffer: 1 << 26 });
  return out.split('\n').filter(Boolean).map((l) => { const m = l.trim().match(/^(\d+)\s+(\d+)\s+([\d.]+)\s+(.*)$/); return m && { pid: +m[1], ppid: +m[2], cpu: +m[3], cmd: m[4] }; }).filter(Boolean);
}
function busy() {
  const ps = procs();
  const kids = new Map(); for (const p of ps) { if (!kids.has(p.ppid)) kids.set(p.ppid, []); kids.get(p.ppid).push(p); }
  const tree = (p) => [p, ...(kids.get(p.pid) ?? []).flatMap(tree)];
  const roots = ps.filter((p) => (/Google Chrome/.test(p.cmd) && /--headless/.test(p.cmd) && !/Helper/.test(p.cmd))
    || /run-headless|run-realtime/.test(p.cmd) && /node/.test(p.cmd));
  let cpu = 0; const who = [];
  for (const r of roots) { const c = tree(r).reduce((a, x) => a + x.cpu, 0); if (c > 3) { cpu += c; who.push(`${r.pid}:${c.toFixed(0)}%`); } }
  const asr = execFileSync('pmset', ['-g', 'assertions'], { encoding: 'utf8' });
  if (/Video Wake Lock/.test(asr)) who.push('video-wake-lock');
  for (const p of ps) if (/UVCAssistant/.test(p.cmd) && p.cpu > 3) who.push(`camera:${p.cpu}%`);
  // IGNORE_VIDEO=1: run anyway during a desktop video call (results labelled; compare the fastest frames only)
  return { busy: cpu > 3 || (!process.env.IGNORE_VIDEO && who.some((w) => /video|camera/.test(w))), who };
}
async function waitQuiet() {
  for (let waited = 0; ; waited += 5) {
    const b = busy();
    if (!b.busy) { await new Promise((r) => setTimeout(r, 1500)); if (!busy().busy) return waited; }
    if (waited % 300 === 0) console.log(`  waiting for quiet GPU (${b.who.join(' ')})`);
    await new Promise((r) => setTimeout(r, 5000));
  }
}
function page(id, extra, warm = false) {
  const q = `signal=sh-diffuse&mode=bench&preset=full&path=dt-bumpy&n=${warm ? 40 : N}&denoiser=${id}${extra ? '&' + extra : ''}`;
  const json = `${process.env.OUT}.tmp.json`;
  if (existsSync(json)) unlinkSync(json);
  spawnSync(process.execPath, ['run-headless.mjs', `--json=${json}`, q], { cwd: TB, env: process.env, encoding: 'utf8' });
  if (warm) return {};
  try { return { res: JSON.parse(readFileSync(json, 'utf8'))[0].results.results['sh-diffuse'][id] }; } catch { return {}; }
}
for (let k = 0; k < rounds; k++) {
  const order = k % 2 ? [...PAGES].reverse() : PAGES;
  await waitQuiet(); page('svgf-sh-auto', '', true);
  for (const [label, id, extra] of order) {
    await waitQuiet();
    const { res } = page(id, extra);
    const after = busy();
    const rec = { round: k + 1, label, id, extra, n: N, gpuMs: res?.gpuMs ?? null, passesMs: res?.passesMs ?? null, contendedAfter: after.busy ? after.who : null, at: new Date().toISOString() };
    appendFileSync(process.env.OUT, JSON.stringify(rec) + '\n');
    console.log(`r${k + 1} ${label}: median ${res?.gpuMs?.median} min ${res?.gpuMs?.min}${after.busy ? ' CONTENDED ' + after.who.join(' ') : ''}`);
  }
}
