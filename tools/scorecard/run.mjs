#!/usr/bin/env node
// Scorecard runner: replays the registry denoisers over each scene's capture, scores the five numbers
// (calm, detail, lag, bias, cost), imports native NRD rows, and writes the dashboard.
//
//   node tools/scorecard/run.mjs                         # every scene in scenes.json; cost reused from latest.json
//   node tools/scorecard/run.mjs --scenes G2-knot-static,corner-pan
//   node tools/scorecard/run.mjs --cost                  # also (re-)measure cost at 1080p (GPU lock + idle GPU, rule 11)
//   node tools/scorecard/run.mjs --cost-only             # only the cost; scenes and gates are taken from latest.json
//   node tools/scorecard/run.mjs --replay-only           # only the replays (run it under tools/gpu-lock.sh with SCORECARD_LOCK_HELD=1)
//   node tools/scorecard/run.mjs --skip-replay           # score existing outputs in the work dir (CPU only, no lock)
//   node tools/scorecard/run.mjs --keep                  # keep the raw outputs (default: deleted after scoring)
//   node tools/scorecard/run.mjs --report-only           # rebuild latest.md / index.html from latest.json
//
// Options: --captures <dir> (default $SCORECARD_CAPTURES or the kept captures of the cleanroom worktree; read only),
//   --work <dir> (raw outputs, outside git; default ../scorecard-work-<worktree>), --port 5302, --out <dir>,
//   --scenes-file <json> (default scenes.json next to this file), --settle 8, --flip-every 4.
// Env: RT_GPU_LOCK (rule 11), RT_NATIVE_OUTPUTS (native output f32 root laid out outputs/<capture>/<row>/...).
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readManifest } from '../rt-capture/lib/capture.mjs';
import { captureInfo, hasSignal, noisySource, outputSource, scoreSignal } from './lib/metrics.mjs';
import { loadNative, loadNativeCost } from './lib/native.mjs';
import { measureCost } from './lib/cost.mjs';
import { replayQueries, startServer } from './lib/replay.mjs';
import { acquireGpu, waitForQuietGpu } from './lib/gpu-lock.mjs';
import { cropStrip } from './lib/crops.mjs';
import { readBuffer } from '../rt-capture/lib/capture.mjs';
import { evaluateGates, writeReports } from './lib/report.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i < 0 ? d : args[i + 1]; };
const flag = (k) => args.includes(`--${k}`);
const log = (...a) => console.log(...a);

const OUT = path.resolve(opt('out', path.join(REPO, 'docs', 'research', 'rt-denoiser', 'scorecard')));
const WORK = path.resolve(opt('work', path.join(REPO, '..', `scorecard-work-${path.basename(REPO).replace(/^Denoiser-?/, '') || 'main'}`)));
const SRC_CAPTURES = path.resolve(opt('captures', process.env.SCORECARD_CAPTURES ?? '/Users/dex/Developer/Denoiser-nrd-cleanroom/tools/rt-capture/captures'));
const PORT = opt('port', '5302');
const BASE = `http://127.0.0.1:${PORT}/`;
const SETTLE = Number(opt('settle', 8)), FLIP_EVERY = Number(opt('flip-every', 4));
const cfg = JSON.parse(readFileSync(path.resolve(opt('scenes-file', path.join(HERE, 'scenes.json'))), 'utf8'));
const wanted = flag('cost-only') ? [] : opt('scenes') ? opt('scenes').split(',') : null;
const scenes = cfg.scenes.filter((s) => (!wanted || wanted.includes(s.id)) && !(s.optional && !existsSync(path.join(s.capturesDir ?? SRC_CAPTURES, s.capture, 'capture.json')) && (log(`skipping ${s.id}: capture not complete yet`), true)));
const prev = existsSync(path.join(OUT, 'latest.json')) ? JSON.parse(readFileSync(path.join(OUT, 'latest.json'), 'utf8')) : null;

if (flag('report-only')) {
  if (!prev) { console.error('no latest.json to build from'); process.exit(1); }
  writeReports(OUT, prev);
  log(`rebuilt ${OUT}/latest.md and index.html`);
  process.exit(0);
}

// ---- work dir: captures/ (symlinks to the read-only source) + outputs/
mkdirSync(path.join(WORK, 'captures'), { recursive: true });
mkdirSync(path.join(WORK, 'outputs'), { recursive: true });
for (const s of scenes) {
  const dst = path.join(WORK, 'captures', s.capture);
  const srcDir = path.join(s.capturesDir ?? SRC_CAPTURES, s.capture);
  if (!existsSync(dst)) {
    if (!existsSync(path.join(srcDir, 'capture.json'))) { console.error(`capture ${s.capture} (scene ${s.id}) not found under ${srcDir}`); process.exit(2); }
    symlinkSync(srcDir, dst);
  }
}
process.env.RT_CAPTURE_DIR = WORK;

const rowDenoiser = (rowId, signal) => cfg.rows[rowId].denoiser?.[signal] ?? null;
const sh = (c) => { try { return execSync(c, { cwd: REPO, encoding: 'utf8' }).trim(); } catch { return null; } };
const t0 = Date.now();
const results = { generated: new Date().toISOString(), repoCommit: sh('git rev-parse --short HEAD'), packageCommit: sh('git log -1 --format=%h -- packages/denoiser-realtime/src packages/denoiser-ffx/src'),
  params: { settle: SETTLE, flipEvery: FLIP_EVERY, captures: SRC_CAPTURES }, gpu: null, cost: prev?.cost ?? null, scenes: [] };

try {
  // ---- replays: all of them under one GPU lock (a few minutes of short jobs, rule 11), released before scoring
  if (!flag('skip-replay')) {
    const batches = scenes.map((s) => {
      const needs = new Map(); // denoiser id -> Set(signals)
      for (const signal of s.signals) for (const rowId of Object.keys(cfg.rows)) {
        const d = rowDenoiser(rowId, signal); if (!d) continue;
        if (!needs.has(d)) needs.set(d, new Set());
        needs.get(d).add(signal);
      }
      const man = readManifest(path.join(WORK, 'captures', s.capture));
      return { s, queries: [...needs].map(([d, sigs]) => `mode=replay&capture=${s.capture}&denoiser=${d}&signals=${[...sigs].filter((x) => hasSignal(man, x)).join(',')}`) };
    });
    const release = await acquireGpu(`replays for ${scenes.length} scenes`, { log });
    const server = await startServer(BASE, log);
    try {
      for (const { s, queries } of batches) {
        log(`[${s.id}] replaying ${queries.length} denoisers over ${s.capture}`);
        replayQueries(queries, { base: BASE, captureDir: WORK, log });
      }
    } finally { await server.stop(); release(); }
  }
  if (flag('replay-only')) { log('replays done (--replay-only); score with --skip-replay'); process.exit(0); }

  // ---- scoring (CPU)
  for (const s of scenes) {
    const capDir = path.join(WORK, 'captures', s.capture);
    const m = readManifest(capDir), info = captureInfo(m);
    const outRoot = path.join(WORK, 'outputs', s.capture);
    const nativeOut = process.env.RT_NATIVE_OUTPUTS ? path.join(process.env.RT_NATIVE_OUTPUTS, 'outputs', s.capture) : null;
    const scene = { id: s.id, golden: s.golden, title: s.title, status: s.status, capture: s.capture, width: m.width, height: m.height, frames: m.frames.length,
      referenceSpp: m.referenceSpp, events: info.events, staticCamera: info.staticCamera, signals: {}, gates: [], crops: [] };
    for (const signal of s.signals) {
      if (!hasSignal(m, signal)) { log(`[${s.id}] capture has no ${signal}: skipped`); continue; }
      const defs = [{ id: 'raw', rowKey: 'raw' }];
      for (const rowKey of ['accumulate', 'ours', 'ffx']) { const d = rowDenoiser(rowKey, signal); if (d) defs.push({ id: d, rowKey }); }
      const sources = defs.map((d) => (d.rowKey === 'raw' ? noisySource(capDir, m, signal) : outputSource(outRoot, d.id, signal)));
      const nativeIds = (cfg.native[signal] ?? []);
      const nativeScored = [];
      if (nativeOut) for (const nid of nativeIds) if (existsSync(path.join(nativeOut, nid))) { sources.push(outputSource(nativeOut, nid, signal)); nativeScored.push(nid); }
      log(`[${s.id}] scoring ${signal}: ${sources.map((x) => x.id).join(', ')}`);
      const ts = Date.now();
      const sc = scoreSignal({ capDir, m, info, signal, sources, opts: { settle: SETTLE, flipEvery: FLIP_EVERY, ...(s.tonemap ? { tonemap: s.tonemap } : {}) }, log: () => {} });
      log(`[${s.id}] ${signal} scored in ${((Date.now() - ts) / 1000).toFixed(0)} s`);
      const rows = defs.map((d) => ({ ...sc.rows[d.id === 'raw' ? 'raw' : d.id], id: d.id, rowKey: d.rowKey, kind: cfg.rows[d.rowKey].kind, label: cfg.rows[d.rowKey].label, missing: d.rowKey !== 'raw' && !sc.rows[d.id]?.frames }));
      for (const nid of nativeScored) rows.push({ ...sc.rows[nid], id: nid, rowKey: 'native', kind: 'native', label: `native ${nid}` });
      if (s.native) for (const nr of loadNative(s.native, signal, info.events, m.frames.length)) if (!nativeScored.includes(nr.id)) rows.push({ ...nr, rowKey: 'native', label: `native ${nr.id.replace('nrd-', '')} (imported)` });
      scene.signals[signal] = { reference: sc.reference, rows };
      // crop strip at a frame well after the start
      try {
        const frame = Math.min(m.frames.length - 1, Math.max(SETTLE + 2, Math.floor(m.frames.length * 0.6)));
        const panels = defs.map((d, k) => ({ label: d.rowKey === 'raw' ? 'raw' : d.rowKey, data: sources[k].get(frame) })).filter((p) => p.data);
        panels.push({ label: 'reference', data: readBuffer(capDir, frame, signal === 'ao' ? 'ao_ref' : `${signal}_ref`) });
        const cs = cropStrip({ capDir, m, frame, signal, panels });
        const rel = `crops/${s.id}-${signal}.png`;
        mkdirSync(path.join(OUT, 'crops'), { recursive: true });
        writeFileSync(path.join(OUT, rel), cs.png);
        scene.crops.push({ signal, file: rel, frame, window: cs.window, labels: cs.labels });
      } catch (e) { log(`[${s.id}] crop failed for ${signal}: ${e.message}`); }
      if (!results.gpu) {
        const rj = path.join(outRoot, rowDenoiser('ours', signal) ?? '', 'run.json');
        if (existsSync(rj)) { const j = JSON.parse(readFileSync(rj, 'utf8')); results.gpu = j.gpu?.description || j.gpu?.architecture || j.gpu || null; }
      }
    }
    results.scenes.push(scene);
    if (!flag('keep')) {
      for (const d of existsSync(outRoot) ? readdirSync(outRoot) : []) rmSync(path.join(outRoot, d), { recursive: true, force: true });
    }
  }

  // ---- cost at 1080p (rule 11: lock + idle GPU)
  if (flag('cost')) {
    const capName = cfg.captureTimingScene;
    const src = path.join(SRC_CAPTURES, capName), dst = path.join(WORK, 'captures', capName);
    if (!existsSync(path.join(dst, 'capture.json')) && !existsSync(path.join(src, 'capture.json'))) {
      log('generating the 1080p timing capture (tools/rt-capture/gen-synthetic.mjs)');
      execSync(`node ${path.join(REPO, 'tools/rt-capture/gen-synthetic.mjs')} --name ${capName} --w 1920 --h 1080 --frames 10`, { env: process.env, stdio: 'inherit' });
    } else if (!existsSync(dst)) symlinkSync(src, dst);
    const release = await acquireGpu('cost 1080p', { log });
    const server = await startServer(BASE, log);
    try {
      await waitForQuietGpu({ log });
      log('timing at 1080p (3 rounds per row)');
      const cost = measureCost({ costRows: cfg.cost, capture: capName, base: BASE, captureDir: WORK, log });
      results.cost = { measuredAt: new Date().toISOString(), gpu: results.gpu, capture: capName, protocol: 'rule 11: GPU lock, no other headless Chrome, 50 ms warm-up before each timed dispatch, first frame dropped, median of 3 rounds', rows: cost };
    } finally { await server.stop(); release(); }
  }
  // native cost (RTX, imported)
  results.nativeCost = Object.fromEntries(Object.entries(cfg.nativeCost).map(([g, id]) => [g, { id, ...loadNativeCost(id) }]));
  results.config = { rows: cfg.rows, cost: cfg.cost, nativeCost: cfg.nativeCost };

  // ---- merge scenes not re-run this time, then gates (they depend on cost), reports
  if (prev && wanted) for (const ps of prev.scenes) if (!results.scenes.some((x) => x.id === ps.id)) results.scenes.push(ps);
  results.scenes = results.scenes.filter((x) => cfg.scenes.some((c) => c.id === x.id));
  results.scenes.sort((a, b) => cfg.scenes.findIndex((x) => x.id === a.id) - cfg.scenes.findIndex((x) => x.id === b.id));
  for (const sc of results.scenes) sc.gates = evaluateGates(cfg.scenes.find((x) => x.id === sc.id).gates ?? [], sc, results);
  mkdirSync(OUT, { recursive: true });
  writeReports(OUT, results);
  log(`done in ${((Date.now() - t0) / 60000).toFixed(1)} min -> ${OUT}/latest.{json,md} + index.html`);
} finally {
  // servers are started and stopped inside the lock sections above
}
