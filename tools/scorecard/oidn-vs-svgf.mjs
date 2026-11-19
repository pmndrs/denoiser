#!/usr/bin/env node
// E-2b: OIDN 2 single-frame (fast / balanced / high) vs our real-time filters on the same captures and references
// (docs/research/rt-denoiser/results/E2b-oidn-vs-svgf.md). Replays every arm through tools/rt-capture (the only page
// that registers the OIDN entries, src/oidn-entries.ts), scores them with the scorecard's metrics (lib/metrics.mjs:
// pooled / settled / frame-0 / per-region PSNR, FLIP, boil per region at stride 1 and 8, flicker, bias) and writes one
// JSON. Raw outputs are deleted after each capture is scored (--keep keeps them).
//
//   node tools/scorecard/oidn-vs-svgf.mjs --work <dir with captures/> [--captures a,b] [--arms id,id] [--skip-replay]
//        [--keep] [--port 5398] [--out <json>] [--who "<agent> e2b"]
//
// The work dir holds captures/ (folders or symlinks; read only) and outputs/ (written). Replays of one capture run as
// one batch under tools/gpu-lock.sh (TASKS rule 11); scoring never holds the lock.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ensureVite, REPO_ROOT } from '../rt-capture/lib/headless.mjs';
import { readManifest } from '../rt-capture/lib/capture.mjs';
import { captureInfo, hasSignal, noisySource, outputSource, scoreSignal } from './lib/metrics.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i < 0 ? d : args[i + 1]; };
const WORK = path.resolve(opt('work', ''));
if (!WORK || !existsSync(path.join(WORK, 'captures'))) { console.error('--work <dir with captures/> required'); process.exit(2); }
process.env.RT_CAPTURE_DIR = WORK;
const PORT = Number(opt('port', 5398));
const BASE = `http://127.0.0.1:${PORT}/`;
const OUT = path.resolve(opt('out', path.join(REPO_ROOT, 'docs/research/rt-denoiser/results/data/e2b-oidn-vs-svgf.json')));
const WHO = opt('who', 'e2b oidn-vs-svgf');
const KEEP = args.includes('--keep'), SKIP_REPLAY = args.includes('--skip-replay');

export const CAPTURES = [
  // E-2's analytic test bed (examples/realtime-denoiser capture set `standard`, 256-spp references)
  'std540-orbit', 'std540-pan', 'std540-light', 'std540-thin', 'std540-glossy', 'std540-cut', 'std540-object',
  // E-2's real three.js corner scene (1024-ray references, SSR specular)
  'three-orbit', 'three-pan',
  // moving occluders (scorecard G2 / G3 / G4 provisional scenes)
  'three-knot-static', 'three-knot-orbit', 'sponza-move', 'bistro-move',
  // golden scenes (T0-scenes, 4096-spp references)
  'golden-G3-orbit', 'golden-G4-pan-light-on',
];
/** output folder -> replay registry id and the signals it runs */
export const ARMS = {
  svgf: { id: 'svgf', signals: ['diffuse', 'specular'], label: 'SVGF (paper, pinned M1)' },
  'svgf-auto': { id: 'svgf-auto', signals: ['diffuse', 'specular'], label: 'A-SVGF (shipped defaults)' },
  shadows: { id: 'shadows', signals: ['visibility'], label: 'ShadowDenoiser (shipped)' },
  'occlusion-svgf': { id: 'occlusion-svgf', signals: ['ao'], label: 'occlusion SVGF (pinned)' },
  'occlusion-svgf-auto': { id: 'occlusion-svgf-auto', signals: ['ao'], label: 'occlusion A-SVGF (shipped)' },
  'oidn-fast': { id: 'oidn-default', signals: ['diffuse', 'specular', 'visibility', 'ao'], label: 'OIDN fast (*_small)' },
  'oidn-balanced': { id: 'oidn-balanced', signals: ['diffuse', 'specular', 'visibility', 'ao'], label: 'OIDN balanced (base)' },
  'oidn-high': { id: 'oidn', signals: ['diffuse', 'specular', 'visibility', 'ao'], label: 'OIDN high (*_large)' },
};
const SIGNALS = ['diffuse', 'specular', 'visibility', 'ao'];
// golden scenes are displayed through ACES (scorecard scenes.json); boil / FLIP / bias use it, PSNR stays scoreFrame's
const TONEMAP = { 'golden-G3-orbit': 'aces', 'golden-G4-pan-light-on': 'aces' };

const wanted = opt('captures') ? opt('captures').split(',') : CAPTURES;
const arms = opt('arms') ? opt('arms').split(',') : Object.keys(ARMS);
const log = (s) => console.log(`[e2b ${new Date().toTimeString().slice(0, 8)}] ${s}`);
const load = () => os.loadavg().map((x) => x.toFixed(1)).join(' ');

const prev = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : null;
const R = { generated: new Date().toISOString(), host: `${os.cpus()[0]?.model ?? ''}`.trim(), arms: ARMS, captures: { ...(prev?.captures ?? {}) } };

const server = SKIP_REPLAY ? null : await ensureVite({ root: path.join(REPO_ROOT, 'tools', 'rt-capture'), base: BASE, log });
try {
  for (const cap of wanted) {
    const capDir = path.join(WORK, 'captures', cap);
    if (!existsSync(path.join(capDir, 'capture.json'))) { log(`skip ${cap}: no capture`); continue; }
    const m = readManifest(capDir);
    const sigs = SIGNALS.filter((s) => hasSignal(m, s));
    const runs = arms.map((a) => ({ a, ...ARMS[a], use: ARMS[a].signals.filter((s) => sigs.includes(s)) })).filter((r) => r.use.length);
    const replayInfo = {};
    if (!SKIP_REPLAY) {
      const queries = runs.map((r) => `capture=${cap}&denoiser=${r.id}&signals=${r.use.join(',')}&output=${r.a}`);
      log(`${cap}: replaying ${runs.map((r) => r.a).join(', ')} (load ${load()})`);
      const t0 = Date.now();
      const p = spawnSync(path.join(REPO_ROOT, 'tools', 'gpu-lock.sh'), [`${WHO} ${cap}`, process.execPath, path.join(REPO_ROOT, 'tools', 'rt-capture', 'run-headless.mjs'), ...queries],
        { encoding: 'utf8', maxBuffer: 1 << 28, env: { ...process.env, BASE } });
      const lines = (p.stdout ?? '').split('\n');
      runs.forEach((r) => {
        const i = lines.findIndex((l) => l.startsWith(`=== capture=${cap}&denoiser=${r.id}&`) && l.includes(`output=${r.a}`));
        const res = i >= 0 ? lines[i + 1] : '';
        try { replayInfo[r.a] = JSON.parse(res); } catch { replayInfo[r.a] = { error: res.slice(0, 400) }; }
      });
      const failed = Object.entries(replayInfo).filter(([, v]) => v.error);
      log(`${cap}: replays done in ${((Date.now() - t0) / 1000).toFixed(0)} s, exit ${p.status}${failed.length ? `, FAILED ${failed.map(([k, v]) => `${k}: ${v.error}`).join(' | ')}` : ''} (load ${load()})`);
    }
    // OIDN models / precision from run.json
    for (const r of runs) {
      try { replayInfo[r.a] = { ...replayInfo[r.a], denoiserInfo: JSON.parse(readFileSync(path.join(WORK, 'outputs', cap, r.a, 'run.json'), 'utf8')).denoiserInfo ?? null }; } catch { /* not written */ }
    }
    const info = captureInfo(m);
    const outRoot = path.join(WORK, 'outputs', cap);
    const capRes = { width: m.width, height: m.height, frames: m.frames.length, referenceSpp: m.referenceSpp, resets: info.resets.flatMap((r, f) => (r ? [f] : [])), staticCamera: info.staticCamera, tonemap: TONEMAP[cap] ?? 'reinhard', replay: replayInfo, signals: {} };
    for (const s of sigs) {
      const sources = [noisySource(capDir, m, s), ...runs.filter((r) => r.use.includes(s)).map((r) => outputSource(outRoot, r.a, s))];
      const t0 = Date.now();
      const sc = scoreSignal({ capDir, m, info, signal: s, sources, opts: { tonemap: TONEMAP[cap] ?? 'reinhard' } });
      capRes.signals[s] = sc;
      log(`${cap} ${s}: scored ${sources.length} sources in ${((Date.now() - t0) / 1000).toFixed(0)} s: ` +
        Object.entries(sc.rows).map(([k, v]) => `${k} ${v.detail.psnrPooled.toFixed(2)}`).join(', '));
    }
    R.captures[cap] = capRes;
    mkdirSync(path.dirname(OUT), { recursive: true });
    writeFileSync(OUT, JSON.stringify(R, (k, v) => (typeof v === 'number' && !Number.isInteger(v) ? +v.toPrecision(6) : v)));
    if (!KEEP) for (const r of runs) rmSync(path.join(outRoot, r.a), { recursive: true, force: true });
  }
} finally {
  await server?.stop();
}
log(`wrote ${OUT}`);
