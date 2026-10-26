// SVGF cost bench (svgf-cost evaluator, 2026-10-26): the REMEASURE-2026-10-26 bench.mjs with one server per code
// variant. node bench.mjs <pagesfile.json> <rounds> [n]. pages: [[label, port, signal, id, extra, path?], ...]
// Each page: one (variant, signal, denoiser [+ settings]), test bed mode=bench, 1080p, orbit, n frames after 20 warm-up.
// Busy = any other headless Chrome tree / runner > 3 % CPU, or a desktop video call (Video Wake Lock / camera).
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync, unlinkSync, existsSync } from 'node:fs';
const S = '/private/tmp/claude-502/-Users-dex-Developer-Denoiser-nrd-cleanroom/e9f5ef6a-5b0b-422e-b903-b6fd737cf629/scratchpad/svgfcost';
const TB = '/Users/dex/Developer/Denoiser-nrd-cleanroom/examples/realtime-denoiser';
const PAGES = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const rounds = Number(process.argv[3] ?? 3), N = Number(process.argv[4] ?? 200);
const IGNORE_VIDEO = !!process.env.IGNORE_VIDEO;
function procs() {
  const out = execFileSync('ps', ['-axo', 'pid=,ppid=,pcpu=,command='], { encoding: 'utf8', maxBuffer: 1 << 26 });
  return out.split('\n').filter(Boolean).map((l) => { const m = l.trim().match(/^(\d+)\s+(\d+)\s+([\d.]+)\s+(.*)$/); return m && { pid: +m[1], ppid: +m[2], cpu: +m[3], cmd: m[4] }; }).filter(Boolean);
}
function busy() {
  const ps = procs();
  const kids = new Map(); for (const p of ps) { if (!kids.has(p.ppid)) kids.set(p.ppid, []); kids.get(p.ppid).push(p); }
  const tree = (p) => [p, ...(kids.get(p.pid) ?? []).flatMap(tree)];
  const roots = ps.filter((p) => (/Google Chrome/.test(p.cmd) && /--headless/.test(p.cmd) && !/Helper/.test(p.cmd))
    || /run-headless|run-realtime|dev\/run-headless/.test(p.cmd) && /node/.test(p.cmd));
  let cpu = 0; const who = [];
  for (const r of roots) { const c = tree(r).reduce((a, x) => a + x.cpu, 0); if (c > 3) { cpu += c; who.push(`${r.pid}:${c.toFixed(0)}%`); } }
  const asr = execFileSync('pmset', ['-g', 'assertions'], { encoding: 'utf8' });
  if (/Video Wake Lock/.test(asr)) who.push('video-wake-lock');
  for (const p of ps) if (/UVCAssistant/.test(p.cmd) && p.cpu > 3) who.push(`camera:${p.cpu}%`);
  const video = who.some((w) => /video|camera/.test(w));
  return { busy: cpu > 3 || (video && !IGNORE_VIDEO), video, who };
}
async function waitQuiet() {
  let waited = 0;
  for (;;) {
    const b = busy();
    if (!b.busy) { await new Promise((r) => setTimeout(r, 1500)); if (!busy().busy) return waited; }
    if (waited % 300 === 0) console.log(`  waiting for quiet GPU (${b.who.join(' ')})`);
    await new Promise((r) => setTimeout(r, 5000)); waited += 5;
    if (waited > Number(process.env.MAXWAIT_S ?? Infinity)) { console.log(`gave up waiting after ${waited}s`); process.exit(3); }
  }
}
function page(port, signal, id, extra, path = 'orbit', warm = false) {
  const q = `signal=${signal}&mode=bench&preset=full&path=${path}&n=${warm ? 40 : N}&denoiser=${id}${extra ? '&' + extra : ''}`;
  const json = `${S}/out/bench-tmp.json`;
  if (existsSync(json)) unlinkSync(json);
  spawnSync(process.execPath, ['run-headless.mjs', `--json=${json}`, q], { cwd: TB, env: { ...process.env, BASE: `http://127.0.0.1:${port}/` }, encoding: 'utf8' });
  if (warm) return { q };
  let res, query; try { const j = JSON.parse(readFileSync(json, 'utf8'))[0].results; res = j.results[signal][id]; query = j.query; } catch { res = null; }
  return { q, res, query };
}
for (let k = 0; k < rounds; k++) {
  const order = k % 2 ? [...PAGES].reverse() : PAGES;
  await waitQuiet(); page(PAGES[0][1], 'diffuse', 'j-svgf', '', 'orbit', true);   // throwaway warm-up page
  for (const [label, port, s, id, extra, path] of order) {
    const w = await waitQuiet();
    const t0 = Date.now();
    const { q, res, query } = page(port, s, id, extra, path);
    const after = busy();
    const rec = { round: k + 1 + Number(process.env.ROUND0 ?? 0), label, port, signal: s, id, extra, path: path ?? 'orbit', n: N, q, pageQuery: query ?? null, waitedS: w, pageS: Math.round((Date.now() - t0) / 1000), video: after.video, contendedAfter: after.busy ? after.who : null, gpuMs: res?.gpuMs ?? null, passesMs: res?.passesMs ?? null, at: new Date().toISOString() };
    appendFileSync(process.env.OUT ?? `${S}/out/bench.jsonl`, JSON.stringify(rec) + '\n');
    console.log(`r${rec.round} ${label}: median ${res?.gpuMs?.median} min ${res?.gpuMs?.min} (${rec.pageS}s)${after.busy || after.video ? ' LOAD ' + after.who.join(' ') : ''}`);
  }
}
