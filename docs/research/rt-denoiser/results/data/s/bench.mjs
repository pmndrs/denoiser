// Track S cost bench (TASKS rule 11 protocol, after results/data/remeasure-2026-10-26/bench.mjs): test bed
// mode=bench, 1080p, one (denoiser + settings) per page, N frames after 20 warm-up, a throwaway warm-up page per
// round, rounds alternate order. Holds the GPU lock for the whole run; skips nothing, but records whether another
// headless Chrome was busy after each page ("contended").
//   node bench.mjs <rounds> [n]     env: BASE (test bed dev server, default :5304), OUT (jsonl), PAGES_FILTER (regex)
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync, unlinkSync, existsSync, mkdirSync } from 'node:fs';
const TB = '/Users/dex/Developer/Denoiser-track-s/examples/realtime-denoiser';
const S = '/tmp/s-bench';
mkdirSync(S, { recursive: true });
const rounds = Number(process.argv[2] ?? 3), N = Number(process.argv[3] ?? 200);
// [label, extra settings, path]
const PAGES = [
  ['default', '', 'orbit'],
  ['default', '', 'thin'],
  ['catmullRom off', 'sh.catmullRom=false', 'orbit'],
  ['clampGeometry off', 'sh.clampGeometry=false', 'orbit'],
  ['youngMean 0', 'sh.youngMean=0', 'orbit'],
  ['stepTest+edgeBox off', 'sh.stepTest=false&sh.edgeBox=false', 'orbit'],
  ['stabilize 0', 'sh.stabilize=0', 'orbit'],
  ['spatialPasses 1', 'sh.spatialPasses=1', 'orbit'],
  ['tileSkip off', 'sh.tileSkip=false', 'orbit'],
  ['noiseBlend 0', 'sh.noiseBlend=0', 'orbit'],
  ...(process.env.EXTRA_PAGES ? JSON.parse(process.env.EXTRA_PAGES) : []),
];
function busy() {
  const out = execFileSync('ps', ['-axo', 'pid=,pcpu=,command='], { encoding: 'utf8', maxBuffer: 1 << 26 });
  let cpu = 0;
  for (const l of out.split('\n')) {
    const m = l.trim().match(/^(\d+)\s+([\d.]+)\s+(.*)$/);
    if (m && /Google Chrome/.test(m[3]) && /--headless/.test(m[3]) && !/s-bench/.test(m[3])) cpu += Number(m[2]);
  }
  return cpu > 3;
}
function page(extra, path, warm = false) {
  const q = `signal=shadows&mode=bench&preset=full&path=${path}&n=${warm ? 40 : N}&denoiser=shadows${extra ? '&' + extra : ''}`;
  const json = `${S}/bench-tmp.json`;
  if (existsSync(json)) unlinkSync(json);
  spawnSync(process.execPath, ['run-headless.mjs', `--json=${json}`, q], { cwd: TB, env: { ...process.env, BASE: process.env.BASE ?? 'http://127.0.0.1:5304/' }, encoding: 'utf8' });
  if (warm) return {};
  try { const j = JSON.parse(readFileSync(json, 'utf8'))[0].results; return { res: j.results.shadows.shadows }; } catch (e) { return { res: null }; }
}
const PF = process.env.PAGES_FILTER ? new RegExp(process.env.PAGES_FILTER) : null;
const pages = PF ? PAGES.filter(([l]) => PF.test(l)) : PAGES;
for (let k = 0; k < rounds; k++) {
  const order = k % 2 ? [...pages].reverse() : pages;
  page('', 'orbit', true);
  for (const [label, extra, path] of order) {
    const { res } = page(extra, path);
    const rec = { round: k + 1, label, extra, path, n: N, contended: busy(), gpuMs: res?.gpuMs ?? null, passesMs: res?.passesMs ?? null, wallMs: res?.wallMs ?? null, at: new Date().toISOString() };
    appendFileSync(process.env.OUT ?? `${S}/bench.jsonl`, JSON.stringify(rec) + '\n');
    console.log(`r${k + 1} ${label} (${path}): median ${res?.gpuMs?.median} min ${res?.gpuMs?.min} ${JSON.stringify(res?.passesMs)}${rec.contended ? ' CONTENDED' : ''}`);
  }
}
