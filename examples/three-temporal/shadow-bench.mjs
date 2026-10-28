#!/usr/bin/env node
// Headless shadow bench (shadow-bench.html in headless Chrome + WebGPU over CDP). How-to:
// docs/research/rt-denoiser/results/SHADOW-BENCH.md. Starts the bench's dev server (vite.bench.config.ts, port 5266)
// unless one answers.
//
//   node examples/three-temporal/shadow-bench.mjs [run] [config flags] [--variant=id:{json}]... [--only=ffx,ours]
//        [--label=name] [--refresh-gt] [--json=file] [--port=5266]
//        one run: ground truths (cached), then the timeline; prints the summary, writes report.md next to run.json
//   node examples/three-temporal/shadow-bench.mjs gt [config flags]       fill the ground-truth cache for the run's frames
//   node examples/three-temporal/shadow-bench.mjs list [--last=20]        saved runs, headline numbers
//   node examples/three-temporal/shadow-bench.mjs compare <run A> <run B>  summary of B minus A, per variant present in both
//
// Config flags: any BenchConfig key (src/shadow-bench/config.ts), --warmup=300 --step=1 --count=5 --burst=3
// --camera=wall|knot|wide --knotRate=0.0058 --knotStart=0 --lightHalf=0.3 --gtGrid=64 --images=checkpoints|all|none
// --raw=true --blurSigma=3, or --cfg='{"count":10}'. --w / --h / --sampler reload the page at that size / noise.
// Variants: ffx and ours (package defaults) unless --only; each --variant adds ours with those options, e.g.
//   --variant='rot0:{"rotationStep":0}' --variant='nostab:{"stabilize":0}'
// (kind ffx: --variant='ffx2:ffx:{...}').
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureVite, openPage, sleep } from '../../tools/rt-capture/lib/headless.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.SHADOW_BENCH_DIR ?? path.join(HERE, 'out', 'shadow-bench');
const args = process.argv.slice(2);
const opts = Object.fromEntries(args.filter((a) => a.startsWith('--') && a.includes('=')).map((a) => { const i = a.indexOf('='); return [a.slice(2, i), a.slice(i + 1)]; }));
const flags = new Set(args.filter((a) => a.startsWith('--') && !a.includes('=')).map((a) => a.slice(2)));
const multi = (k) => args.filter((a) => a.startsWith(`--${k}=`)).map((a) => a.slice(k.length + 3));
const pos = args.filter((a) => !a.startsWith('--'));
const cmd = ['run', 'gt', 'list', 'compare'].includes(pos[0]) ? pos.shift() : 'run';
const PORT = Number(opts.port ?? 5266);
const BASE = `http://127.0.0.1:${PORT}/`;

const NUM_KEYS = new Set(['knotStart', 'knotRate', 'knotTilt', 'lightHalf', 'warmup', 'step', 'count', 'burst', 'gtGrid', 'gtRows', 'blurSigma', 'movingRate']);
const STR_KEYS = new Set(['camera', 'images', 'label']);
const JSON_KEYS = new Set(['position', 'target']);
function configFromArgs() {
  const c = opts.cfg ? JSON.parse(opts.cfg) : {};
  for (const [k, v] of Object.entries(opts)) {
    if (NUM_KEYS.has(k)) { c[k] = Number(v); if (!Number.isFinite(c[k])) throw new Error(`--${k}=${v}: not a number`); }
    else if (STR_KEYS.has(k)) c[k] = v;
    else if (JSON_KEYS.has(k)) c[k] = JSON.parse(v);
    else if (k === 'raw') c.raw = v === 'true' || v === '1';
  }
  if (c.position && !c.camera) c.camera = 'custom';
  return c;
}
function variantsFromArgs(defaults) {
  let vs = defaults;
  if (opts.only) { const keep = opts.only.split(','); vs = vs.filter((v) => keep.includes(v.id)); }
  for (const s of multi('variant')) {
    const m = s.match(/^([a-z0-9-]+):(?:(ffx|ours):)?(\{.*\})$/i);
    if (!m) throw new Error(`--variant=${s}: expected id:{json} or id:ffx:{json}`);
    vs = [...vs.filter((v) => v.id !== m[1]), { id: m[1], kind: m[2] ?? 'ours', options: JSON.parse(m[3]), label: m[3] }];
  }
  return vs;
}

// ---- tables (the report's summary columns, src/shadow-bench/report.ts) -------------------------------------------------
const COLS = [
  ['umbra RMSE', (s) => s.umbra?.rmse], ['umbra bias', (s) => s.umbra?.bias], ['umbra off', (s) => s.umbra?.bad, 'pct'],
  ['pen. RMSE', (s) => s.penumbra?.rmse], ['all RMSE', (s) => s.all?.rmse],
  ['boil umbra', (s) => s.umbra?.boil], ['boil pen.', (s) => s.penumbra?.boil],
  ['blotch umbra', (s) => s.umbra?.boilLow], ['blotch pen.', (s) => s.penumbra?.boilLow], ['blotch moving', (s) => s['penumbra.moving']?.boilLow],
  ['tErr', (s) => s.all?.tErr], ['flicker ≥2', (s) => s.all?.flick2, 'pct2'], ['flicker ≥4', (s) => s.all?.flick4, 'pct3'], ['knot RMSE', (s) => s.object?.rmse],
];
const fmt = (v, kind) => (v === undefined || v === null || !Number.isFinite(v) ? '–' : kind === 'pct' ? `${(v * 100).toFixed(1)} %` : kind === 'pct2' ? `${(v * 100).toFixed(2)} %` : kind === 'pct3' ? `${(v * 100).toFixed(3)} %` : v.toFixed(4));
function summaryMd(run) {
  const rows = [...run.images, 'gt'];
  const head = `| | ${COLS.map((c) => c[0]).join(' | ')} | GPU ms |\n|---|${COLS.map(() => '---:').join('|')}|---:|`;
  const body = rows.map((k) => `| ${k === 'gt' ? 'ground truth (floor)' : k} | ${COLS.map(([, g, kind]) => fmt(g(run.summary[k] ?? {}), kind)).join(' | ')} | ${run.gpuMs[k] != null ? run.gpuMs[k].toFixed(3) : ''} |`).join('\n');
  return `${head}\n${body}`;
}
function configLine(run) {
  const c = run.config;
  return `${c.w}×${c.h}, camera ${c.camera}, knot ${c.knotStart} + ${c.knotRate.toFixed(5)} rad/frame, light half ${c.lightHalf}, ${c.sampler} noise, warmup ${c.warmup}, step ${c.step}, ${c.count} checkpoints, burst ${c.burst}, ground truth ${c.gtGrid ** 2} rays/px, blotch σ ${c.blurSigma} px`;
}
function reportMd(run, url) {
  return [
    `# Shadow bench run ${run.id}`, '',
    configLine(run), '',
    `${run.git ? `commit ${run.git.commit}${run.git.dirty ? ' (dirty)' : ''}; ` : ''}ground truths ${run.gtStats.computed} computed / ${run.gtStats.cached} cached; run ${(run.wallMs / 1000).toFixed(1)} s; ${run.created}`, '',
    'Variants:', ...run.variants.map((v) => `- \`${v.id}\` (${v.kind}): \`${JSON.stringify(v.options ?? {})}\``), '',
    'Means over the checkpoints. umbra = ground truth <= 0.02, penumbra 0.02-0.98; bias > 0 = greyer than the truth; off = |error| > 0.05;',
    'boil = RMS 2nd temporal difference / sqrt 6; blotch = the same after a Gaussian blur (the low-frequency boil); tErr = change not explained by the true motion.', '',
    summaryMd(run), '',
    `Report: ${url}`, '',
  ].join('\n');
}
const readRun = (id) => JSON.parse(fs.readFileSync(path.join(ROOT, 'outputs', id, 'run.json'), 'utf8'));
const runIds = () => (fs.existsSync(path.join(ROOT, 'outputs')) ? fs.readdirSync(path.join(ROOT, 'outputs')).filter((d) => fs.existsSync(path.join(ROOT, 'outputs', d, 'run.json'))).sort() : []);

if (cmd === 'list') {
  for (const id of runIds().slice(-Number(opts.last ?? 20))) {
    const r = readRun(id);
    console.log(`\n## ${id}\n${configLine(r)}\n`);
    console.log(summaryMd(r));
  }
  process.exit(0);
}
if (cmd === 'compare') {
  const [a, b] = pos.map(readRun);
  if (!a || !b) { console.error('compare <run A> <run B>'); process.exit(2); }
  console.log(`B (${b.id}) minus A (${a.id}); negative = B lower (better for every column but |bias|)\nA: ${configLine(a)}\nB: ${configLine(b)}\n`);
  const keys = b.images.filter((k) => a.images.includes(k));
  console.log(`| | ${COLS.map((c) => c[0]).join(' | ')} |\n|---|${COLS.map(() => '---:').join('|')}|`);
  for (const k of keys) {
    console.log(`| ${k} | ${COLS.map(([, g, kind]) => {
      const va = g(a.summary[k] ?? {}), vb = g(b.summary[k] ?? {});
      if (!Number.isFinite(va) || !Number.isFinite(vb)) return '–';
      const d = vb - va, rel = va !== 0 ? ` (${d >= 0 ? '+' : ''}${((d / Math.abs(va)) * 100).toFixed(0)} %)` : '';
      return kind?.startsWith('pct') ? `${d >= 0 ? '+' : ''}${(d * 100).toFixed(3)} pt` : `${d >= 0 ? '+' : ''}${d.toFixed(4)}${rel}`;
    }).join(' | ')} |`);
  }
  process.exit(0);
}

// ---- run / gt -----------------------------------------------------------------------------------------------------------
const vite = await ensureVite({ root: HERE, base: BASE, args: ['--config', path.join(HERE, 'vite.bench.config.ts')] });
const page = new URLSearchParams({ manual: '', shell: '0' });
for (const k of ['w', 'h', 'sampler']) if (opts[k]) page.set(k, opts[k]);
const url = `${BASE}shadow-bench.html?${page}`;
const { cdp, close } = await openPage(url, { windowSize: '1400,1000' });
let exit = 0;
try {
  const deadline = Date.now() + 120_000;
  let info = null;
  while (Date.now() < deadline) {
    info = await cdp.evalJs('JSON.stringify(window.__bench?.ready ? window.__bench.info : (window.__error ? { error: window.__error } : null))').then(JSON.parse).catch(() => null);
    if (info) break;
    await sleep(300);
  }
  if (!info || info.error) throw new Error(`page did not start: ${info?.error ?? 'timeout'}`);
  if (!info.cache) throw new Error(`the page at ${BASE} has no ground-truth cache endpoint: is port ${PORT} serving vite.bench.config.ts?`);
  const cfg = configFromArgs();
  if (flags.has('label') || opts.label) cfg.label = opts.label;
  const defaults = await cdp.evalJs('JSON.stringify(window.__bench.defaultVariants)').then(JSON.parse);
  const variants = variantsFromArgs(defaults);
  console.log(`shadow bench: ${info.w}×${info.h}, three r${info.three}; variants ${variants.map((v) => v.id).join(', ')}`);

  if (cmd === 'gt') {
    const frames = await cdp.evalJs(`JSON.stringify(window.__bench.keptFrames(${JSON.stringify(cfg)}))`).then(JSON.parse);
    const t0 = Date.now();
    const r = await cdp.evalJs(`window.__bench.groundTruths(${JSON.stringify(cfg)}, ${JSON.stringify(frames)}, { refresh: ${flags.has('refresh-gt')} }).then(JSON.stringify)`, true).then(JSON.parse);
    console.log(`${r.length} ground truths (${r.filter((x) => !x.cached).length} computed) in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  } else {
    await cdp.evalJs(`window.__bench.start(${JSON.stringify(cfg)}, ${JSON.stringify(variants)}, { refreshGt: ${flags.has('refresh-gt')} })`);
    let last = '', state;
    for (;;) {
      state = await cdp.evalJs('JSON.stringify(window.__benchState)').then(JSON.parse).catch(() => null);
      if (state?.error || state?.ready) break;
      if (state?.progress && state.progress !== last && !flags.has('quiet')) {
        last = state.progress;
        if (process.stdout.isTTY) process.stdout.write(`\r  ${last.padEnd(110).slice(0, 110)}`);
        else if (!/: pass \d|^timeline|writing images/.test(last)) console.log(`  ${last}`);
      }
      await sleep(400);
    }
    if (process.stdout.isTTY) process.stdout.write('\n');
    if (state.error) throw new Error(state.error);
    const run = readRun(state.id);
    const reportUrl = `${BASE}shadow-bench.html?report=${encodeURIComponent(run.id)}`;
    const md = reportMd(run, reportUrl);
    fs.writeFileSync(path.join(ROOT, 'outputs', run.id, 'report.md'), md);
    console.log(`\n${md}`);
    console.log(`files: ${path.relative(process.cwd(), path.join(ROOT, 'outputs', run.id))}/`);
    if (opts.json) fs.writeFileSync(opts.json, JSON.stringify(run, null, 1));
  }
  const errs = await cdp.evalJs('JSON.stringify(window.__bench.gpuErrors)').then(JSON.parse);
  if (errs.length) { console.error(`WebGPU errors (${errs.length}):\n  ${errs.slice(0, 5).join('\n  ')}`); exit = 1; }
} catch (e) {
  console.error(`shadow bench: ${e.message ?? e}`);
  exit = 1;
} finally {
  await close();
  if (!flags.has('keep-server')) await vite.stop();
}
process.exit(exit);
