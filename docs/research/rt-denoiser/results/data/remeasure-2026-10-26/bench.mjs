// Solo bench rounds with a quiet-GPU check (timing evaluator 2026-10-26; the 2026-10-25 remeasure's bench.mjs with
// labelled option variants). node bench.mjs <rounds> [n]
// Each page: one (signal, denoiser [+ settings]), test bed mode=bench, 1080p, orbit (unless the config says), n frames
// after 20 warm-up. Busy = any other headless Chrome tree or headless runner using CPU (> 3 % summed).
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync, unlinkSync, existsSync } from 'node:fs';
const S = '/private/tmp/claude-502/-Users-dex-Developer-Denoiser-nrd-cleanroom/e9f5ef6a-5b0b-422e-b903-b6fd737cf629/scratchpad/remeasure26';
const TB = '/Users/dex/Developer/Denoiser-nrd-cleanroom/examples/realtime-denoiser';
const rounds = Number(process.argv[2] ?? 3), N = Number(process.argv[3] ?? 200);
const T6OFF = 'r.normalThreshold=0&r.normalTest=center&r.virtualHitTest=false';
const Q23 = 'sh.stepTest=true&sh.edgeBox=true&sh.rotationStep=0';
// [label, signal, id, extra settings]
const PAGES = [
  ['ds/svgf-auto (default, ynp 16)', 'diffuse', 'j-svgf-auto', ''],
  ['ds/svgf-auto ynp 0 (10-25 default)', 'diffuse', 'j-svgf-auto', 'youngNormalPower=0'],
  ['ds/svgf off (ynp 0)', 'diffuse', 'j-svgf', ''],
  ['ds/recurrent (default)', 'diffuse', 'j-recurrent', ''],
  ['ds/recurrent historyFix mips', 'diffuse', 'j-recurrent', 'r.historyFix=mips'],
  ['ds/recurrent spatial, no T6', 'diffuse', 'j-recurrent', T6OFF],
  ['ds/recurrent mips, no T6 (10-25 config)', 'diffuse', 'j-recurrent', 'r.historyFix=mips&' + T6OFF],
  ['sh/shadows (default, q21)', 'shadows', 'shadows', ''],
  ['sh/shadows pre-q21', 'shadows', 'shadows', 'sh.backfacePass=false&sh.snapHardPx=0'],
  ['sh/shadows + q23', 'shadows', 'shadows', Q23],
  ['sh/shadows + q24', 'shadows', 'shadows', 'sh.terminatorAnalytic=true'],
  ['sh-thin/shadows (default, q21)', 'shadows', 'shadows', '', 'thin'],
  ['sh-thin/shadows + q23', 'shadows', 'shadows', Q23, 'thin'],
  ['occ/occlusion-svgf-auto (default)', 'ao', 'j-occlusion-svgf-auto', ''],
  ['occ/occlusion-recurrent (default)', 'ao', 'j-occlusion-recurrent', ''],
  ['ds/svgf-auto + f16 nearest (q25)', 'diffuse', 'j-svgf-auto', 'f16Rounding=nearest'],
  ['ds/svgf-auto + antiLagChroma (q26)', 'diffuse', 'j-svgf-auto', 'antiLagChroma=true'],
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
    || /run-headless|run-realtime|dev\/run-headless/.test(p.cmd) && /node/.test(p.cmd));
  let cpu = 0; const who = [];
  for (const r of roots) { const c = tree(r).reduce((a, x) => a + x.cpu, 0); if (c > 3) { cpu += c; who.push(`${r.pid}:${c.toFixed(0)}%`); } }
  // 2026-10-26: also busy while a desktop video call runs (Slack 'Video Wake Lock' / camera UVCAssistant > 3 % CPU):
  // it took the M5 Pro's GPU into the slow state for every page (rounds 4-9 of the first set)
  const asr = execFileSync('pmset', ['-g', 'assertions'], { encoding: 'utf8' });
  if (/Video Wake Lock/.test(asr)) who.push('video-wake-lock');
  for (const p of ps) if (/UVCAssistant/.test(p.cmd) && p.cpu > 3) who.push(`camera:${p.cpu}%`);
  return { busy: cpu > 3 || who.some((w) => /video|camera/.test(w)), who };
}
let first = true;
async function waitQuiet() {
  let waited = 0;
  for (;;) {
    const b = busy();
    if (!b.busy) { await new Promise((r) => setTimeout(r, 1500)); if (!busy().busy) { first = false; return waited; } }
    if (waited % 300 === 0) console.log(`  waiting for quiet GPU (${b.who.join(' ')})`);
    await new Promise((r) => setTimeout(r, 5000)); waited += 5;
    const cap = Number(process.env[first ? 'START_MAXWAIT_S' : 'MAXWAIT_S'] ?? Infinity);
    if (waited > cap) { console.log(`gave up waiting for quiet GPU after ${waited}s (${b.who.join(' ')})`); process.exit(3); }
  }
}
function page(signal, id, extra, path = 'orbit', warm = false) {
  const q = `signal=${signal}&mode=bench&preset=full&path=${path}&n=${warm ? 40 : N}&denoiser=${id}${extra ? '&' + extra : ''}`;
  const json = `${S}/out/bench-tmp.json`;
  if (existsSync(json)) unlinkSync(json);
  spawnSync(process.execPath, ['run-headless.mjs', `--json=${json}`, q], { cwd: TB, env: { ...process.env, BASE: 'http://127.0.0.1:5340/' }, encoding: 'utf8' });
  if (warm) return { q };
  let res, query; try { const j = JSON.parse(readFileSync(json, 'utf8'))[0].results; res = j.results[signal][id]; query = j.query; } catch { res = null; }
  return { q, res, query };
}
const PF = process.env.PAGES_FILTER ? new RegExp(process.env.PAGES_FILTER) : null;
if (PF) PAGES.splice(0, PAGES.length, ...PAGES.filter(([l]) => PF.test(l)));
for (let k = 0; k < rounds; k++) {
  const order = k % 2 ? [...PAGES].reverse() : PAGES;
  await waitQuiet(); page('diffuse', 'j-svgf', '', 'orbit', true);   // throwaway warm-up page
  for (const [label, s, id, extra, path] of order) {
    const w = await waitQuiet();
    const t0 = Date.now();
    const { q, res, query } = page(s, id, extra, path);
    const after = busy();
    const rec = { round: k + 1 + Number(process.env.ROUND0 ?? 0), label, signal: s, id, extra, path: path ?? 'orbit', n: N, q, pageQuery: query ?? null, waitedS: w, pageS: Math.round((Date.now() - t0) / 1000), contendedAfter: after.busy ? after.who : null, gpuMs: res?.gpuMs ?? null, passesMs: res?.passesMs ?? null, wallMs: res?.wallMs ?? null, at: new Date().toISOString() };
    appendFileSync(process.env.OUT ?? `${S}/out/bench.jsonl`, JSON.stringify(rec) + '\n');
    console.log(`r${rec.round} ${label}: median ${res?.gpuMs?.median} min ${res?.gpuMs?.min} (${rec.pageS}s)${after.busy ? ' CONTENDED ' + after.who.join(' ') : ''}`);
  }
}
