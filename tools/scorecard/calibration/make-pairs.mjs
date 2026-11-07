#!/usr/bin/env node
// Build the blind A/B calibration set for the review bench (examples/three-temporal/src/review/calibration.ts).
//
//   node tools/scorecard/calibration/make-pairs.mjs [--work <dir>] [--port 5302] [--captures <dir>] [--skip-replay] [--seed 7]
//
// 1. replays every variant of calibration/sources.json over its capture (GPU lock, rule 11),
// 2. scores each variant in several crop windows (tools/scorecard/lib/metrics.mjs, windowed) on the exact frames the
//    clip shows: calm = 12 consecutive frames after the settle window; detail = one settled frame (FLIP + PSNR vs the
//    reference); lag = the cold start (frames 0..15) with the lag of the windowed error series,
// 3. keeps, per metric, perMetric pairs whose primary metric differs by a small-to-moderate amount
//    (calm / detail: 10-60 % relative; lag: 1-6 frames), spread over sources and windows,
// 4. writes sprite sheets (row 0 = option A, row 1 = option B, detail also row 2 = reference) and
//    examples/three-temporal/src/review/calibration/{pairs.json (labels-free, for the page), sheets/*.png}
//    plus tools/scorecard/calibration/key.json (labels, windows and every metric value; read by analyze.mjs only).
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBuffer, readManifest } from '../../rt-capture/lib/capture.mjs';
import { captureInfo, noisySource, outputSource, scoreSignal, SIG_CH, REF_BUFFER } from '../lib/metrics.mjs';
import { encodePng, pickWindow, renderTile } from '../lib/crops.mjs';
import { replayQueries, startServer } from '../lib/replay.mjs';
import { acquireGpu } from '../lib/gpu-lock.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i < 0 ? d : args[i + 1]; };
const WORK = path.resolve(opt('work', path.join(REPO, '..', `scorecard-work-${path.basename(REPO).replace(/^Denoiser-?/, '') || 'main'}`)));
const SRC_CAPTURES = path.resolve(opt('captures', process.env.SCORECARD_CAPTURES ?? '/Users/dex/Developer/Denoiser-nrd-cleanroom/tools/rt-capture/captures'));
const BASE = `http://127.0.0.1:${opt('port', '5302')}/`;
const SEED = Number(opt('seed', 7));
const cfg = JSON.parse(readFileSync(path.join(HERE, 'sources.json'), 'utf8'));
const SIZE = cfg.size ?? 80, PER = cfg.perMetric ?? 12;
const SHEETS = path.join(REPO, 'examples', 'three-temporal', 'src', 'review', 'calibration', 'sheets');
const PAIRS_JSON = path.join(REPO, 'examples', 'three-temporal', 'src', 'review', 'calibration', 'pairs.json');
const KEY_JSON = path.join(HERE, 'key.json');
const CLIP = 12, LAG_FRAMES = 16, SETTLE = 8;
const log = (...a) => console.log(...a);

// tiny seeded PRNG (mulberry32) so reruns pick the same pairs
let seed = SEED >>> 0;
const rnd = () => { seed += 0x6d2b79f5; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

mkdirSync(path.join(WORK, 'captures'), { recursive: true });
mkdirSync(path.join(WORK, 'outputs'), { recursive: true });
for (const s of cfg.sources) {
  const dst = path.join(WORK, 'captures', s.capture);
  if (!existsSync(dst)) symlinkSync(path.join(SRC_CAPTURES, s.capture), dst);
}
process.env.RT_CAPTURE_DIR = WORK;
const outName = (v) => `cal-${v.id}`;

// ---- 1. replays
if (!process.argv.includes('--skip-replay')) {
  {
    const byCap = new Map();
    for (const s of cfg.sources) {
      const set = byCap.get(s.capture) ?? new Map(); byCap.set(s.capture, set);
      for (const v of s.variants) { const key = outName(v) + '|' + s.signal; set.set(key, { v, signal: s.signal }); }
    }
    const release = await acquireGpu('calibration replays', { log });
    const server = await startServer(BASE, log);
    try {
      for (const [cap, set] of byCap) {
        // one output folder per variant id; a variant used for two signals of one capture shares the folder, so group by (variant, signals)
        const q = new Map();
        for (const { v, signal } of set.values()) { const k = outName(v) + (v.query ?? ''); const e = q.get(k) ?? { v, signals: new Set() }; e.signals.add(signal); q.set(k, e); }
        const queries = [...q.values()].map(({ v, signals }) => `mode=replay&capture=${cap}&denoiser=${v.denoiser ?? v.id}&signals=${[...signals].join(',')}&output=${outName(v)}${v.query ? '&' + v.query : ''}`);
        log(`replaying ${queries.length} variants over ${cap}`);
        replayQueries(queries, { base: BASE, captureDir: WORK, log });
      }
    } finally { await server.stop(); release(); }
  }
}

if (process.argv.includes('--replay-only')) { log('replays done (--replay-only)'); process.exit(0); }

// ---- 2. windowed metrics
const candidates = { calm: [], detail: [], lag: [] };
const rel = (x, y) => Math.abs(x - y) / Math.max(x, y, 1e-9);
const sourceMeta = [];
for (const s of cfg.sources) {
  const capDir = path.join(WORK, 'captures', s.capture);
  const m = readManifest(capDir), info = captureInfo(m);
  const W = m.width, H = m.height, ch = SIG_CH[s.signal];
  const outRoot = path.join(WORK, 'outputs', s.capture);
  const have = s.variants.filter((v) => existsSync(path.join(outRoot, outName(v), 'frame_0000', `${s.signal}.f32`)));
  if (have.length < 2) { log(`skip ${s.capture}/${s.signal}: ${have.length} variants with outputs`); continue; }
  const f0 = Math.min(m.frames.length - CLIP, SETTLE + 4), fDetail = Math.min(m.frames.length - 1, Math.floor(m.frames.length * 0.7));
  // windows: top reference-gradient windows (spread out) + a calmer one
  const fRef = fDetail;
  const ref = readBuffer(capDir, fRef, REF_BUFFER[s.signal]), depth = readBuffer(capDir, fRef, 'depth');
  const wins = [];
  const grid = [];
  for (let y = 0; y + SIZE <= H; y += 16) for (let x = 0; x + SIZE <= W; x += 16) grid.push({ x, y });
  const energy = (w) => { // gradient energy + fraction of valid pixels
    let e = 0, v = 0;
    for (let yy = 0; yy < SIZE; yy += 2) for (let xx = 0; xx < SIZE; xx += 2) {
      const i = (w.y + yy) * W + w.x + xx;
      if (depth[i] > 0 && depth[i] < 1) { v++; const a = ch === 3 ? ref[3 * i + 1] / (1 + ref[3 * i + 1]) : ref[i], b = ch === 3 ? ref[3 * (i + 1) + 1] / (1 + ref[3 * (i + 1) + 1]) : ref[i + 1], c = ch === 3 ? ref[3 * (i + W) + 1] / (1 + ref[3 * (i + W) + 1]) : ref[i + W]; e += Math.abs(a - b) + Math.abs(a - c); }
    }
    return v < (SIZE * SIZE) / 4 * 0.95 ? -1 : e;
  };
  const scored = grid.map((w) => ({ ...w, e: energy(w) })).filter((w) => w.e >= 0).sort((a, b) => b.e - a.e);
  const apart = (w) => wins.every((q) => Math.abs(q.x - w.x) >= SIZE + 20 || Math.abs(q.y - w.y) >= SIZE + 20);
  for (const w of scored) { if (wins.length >= 3) break; if (apart(w)) wins.push({ x: w.x, y: w.y, kind: 'edges' }); }
  const mid = scored[Math.floor(scored.length * 0.4)]; if (mid && apart(mid)) wins.push({ x: mid.x, y: mid.y, kind: 'smooth' });
  sourceMeta.push({ capture: s.capture, signal: s.signal, windows: wins, f0, fDetail });
  log(`scoring ${s.capture}/${s.signal}: ${have.length} variants x ${wins.length} windows`);
  const srcList = () => have.map((v) => outputSource(outRoot, outName(v), s.signal)).map((x, k) => ({ ...x, id: have[k].id }));
  for (const win of wins) {
    const window = { x: win.x, y: win.y, w: SIZE, h: SIZE };
    // calm clip + detail frame in one pass; lag from the same pass's windowed error series
    const sc = scoreSignal({ capDir, m, info, signal: s.signal, sources: srcList(), opts: { window, countFrames: [f0, f0 + CLIP - 1], flipFrames: [fDetail], settle: SETTLE }, log: () => {} });
    for (const v of have) {
      const r = sc.rows[v.id];
      const lagEv = r.lag[0];
      const entry = { source: `${s.capture}/${s.signal}`, capture: s.capture, signal: s.signal, window: win, variant: v.id,
        calm: { boil: r.calm.all.boil, refBoil: r.calm.all.refBoil, errBoil: r.calm.all.errBoil, legacyBoil: r.calm.legacyBoil, sigma: r.calm.sigma?.sigma ?? null, n: r.calm.all.n },
        detail: { flip: r.detail.flip, psnr: r.detail.psnrSettledPooled },
        lag: { lag: lagEv?.lag ?? null, settled: lagEv?.settled ?? null, start: lagEv?.start ?? null } };
      (candidates._v ??= []).push(entry);
    }
  }
}

// ---- 3. choose pairs
const all = candidates._v ?? [];
const groups = new Map();
for (const e of all) { const k = `${e.source}|${e.window.x},${e.window.y}`; (groups.get(k) ?? groups.set(k, []).get(k)).push(e); }
const metricsOf = { calm: (e) => e.calm.boil, detail: (e) => e.detail.flip, lag: (e) => e.lag.lag };
const picks = { calm: [], detail: [], lag: [], tradeoff: [] };
const srcMetrics = Object.fromEntries(cfg.sources.map((s) => [`${s.capture}/${s.signal}`, s.metrics]));
for (const metric of ['calm', 'detail', 'lag', 'tradeoff']) {
  const cands = [];
  for (const [k, list] of groups) {
    if (!srcMetrics[list[0].source].includes(metric === 'tradeoff' ? 'calm' : metric)) continue;
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      if (metric === 'tradeoff') {
        // calmer-but-blurrier vs sharper-but-boils: one option has >= 12 % lower boil, the other >= 12 % lower FLIP
        const ok2 = Number.isFinite(a.calm.boil) && Number.isFinite(b.calm.boil) && Number.isFinite(a.detail.flip) && Number.isFinite(b.detail.flip) && a.calm.n >= 2000
          && rel(a.calm.boil, b.calm.boil) >= 0.12 && rel(a.detail.flip, b.detail.flip) >= 0.12 && (a.calm.boil < b.calm.boil) !== (a.detail.flip < b.detail.flip);
        if (ok2) cands.push({ key: k, a, b, r: rnd() });
        continue;
      }
      const va = metricsOf[metric](a), vb = metricsOf[metric](b);
      if (!Number.isFinite(va) || !Number.isFinite(vb)) continue;
      let ok;
      if (metric === 'lag') ok = Math.abs(va - vb) >= 1 && Math.abs(va - vb) <= 6 && Math.max(va, vb) >= 2;
      else { const rel = Math.abs(va - vb) / Math.max(va, vb, 1e-9); ok = rel >= 0.10 && rel <= 0.60; }
      // calm needs a window with real pixels counted; detail needs distinct images
      if (metric === 'calm' && (a.calm.n < 2000 || a.calm.refBoil === undefined)) continue;
      if (ok) cands.push({ key: k, a, b, r: rnd() });
    }
  }
  cands.sort((x, y) => x.r - y.r);
  const perSource = new Map(), perWin = new Map(), used = new Set();
  const seenPair = new Set();
  for (const pass of [0, 1]) for (const c of cands) {
    if (picks[metric].length >= (metric === 'tradeoff' ? 10 : PER)) break;
    const src = c.a.source, ps = perSource.get(src) ?? 0, pw = perWin.get(c.key) ?? 0;
    const id = `${c.key}|${[c.a.variant, c.b.variant].sort().join(',')}`;
    if (seenPair.has(id)) continue;
    if (pass === 0 && (ps >= 3 || pw >= 1)) continue;
    if (pass === 1 && (ps >= 4 || pw >= 2)) continue;
    seenPair.add(id); perSource.set(src, ps + 1); perWin.set(c.key, pw + 1); picks[metric].push(c); used.add(id);
  }
  log(`${metric}: ${cands.length} candidate pairs, ${picks[metric].length} picked from ${new Set(picks[metric].map((c) => c.a.source)).size} sources`);
}

// ---- 4. sheets + manifests
rmSync(SHEETS, { recursive: true, force: true });
mkdirSync(SHEETS, { recursive: true });
const pairsOut = [], key = [];
const TITLES = {
  tradeoff: { title: 'Calm vs sharp', question: 'Which would you rather ship?', hint: 'One is calmer but softer, the other sharper but boils. Compare each with the reference on the right and pick the one you would accept in a real scene.' },
  calm: { title: 'Calmer', question: 'Which one is calmer?', hint: 'Look for flicker, boiling, crawling or shimmer over time. A steady image counts as calm even when it is a bit soft or lags the motion. Noise and speckle count against it.' },
  detail: { title: 'More detail', question: 'Which one is closer to the reference?', hint: 'Compare each with the reference on the right: edges, texture and small shapes kept, and no noise or blotches. Not a time question: these are still frames.' },
  lag: { title: 'Settles faster', question: 'Which one settles faster?', hint: 'Each clip starts cold, from a noisy first frame. Which one reaches its final, clean look sooner? (Use the speed menu to slow it down.)' },
};
for (const metric of ['calm', 'detail', 'lag', 'tradeoff']) {
  picks[metric].forEach((c, n) => {
    const id = `${metric}-${String(n + 1).padStart(2, '0')}`;
    const sc = cfg.sources.find((s) => `${s.capture}/${s.signal}` === c.a.source);
    const capDir = path.join(WORK, 'captures', sc.capture), m = readManifest(capDir);
    const W = m.width, ch = SIG_CH[sc.signal];
    const outRoot = path.join(WORK, 'outputs', sc.capture);
    const meta = sourceMeta.find((x) => x.capture === sc.capture && x.signal === sc.signal);
    const still = metric === 'detail', clip = metric === 'calm' || metric === 'tradeoff';
    const frames = still ? [meta.fDetail] : clip ? Array.from({ length: CLIP }, (_, k) => meta.f0 + k) : Array.from({ length: LAG_FRAMES }, (_, k) => k);
    const flip = rnd() < 0.5; // which variant is row 0 ("a")
    const [va, vb] = flip ? [c.b, c.a] : [c.a, c.b];
    const rows = still || metric === 'tradeoff' ? 3 : 2;
    const W2 = frames.length * SIZE, H2 = rows * SIZE;
    const rgb = Buffer.alloc(W2 * H2 * 3);
    frames.forEach((f, k) => {
      const tiles = [outputSource(outRoot, outName({ id: va.variant }), sc.signal).get(f), outputSource(outRoot, outName({ id: vb.variant }), sc.signal).get(f)];
      if (rows === 3) tiles.push(readBuffer(capDir, f, REF_BUFFER[sc.signal]));
      tiles.forEach((data, r) => {
        const t = renderTile(data, ch, W, c.a.window, SIZE);
        for (let y = 0; y < SIZE; y++) t.copy(rgb, ((r * SIZE + y) * W2 + k * SIZE) * 3, y * SIZE * 3, (y + 1) * SIZE * 3);
      });
    });
    const sheet = `${id}.png`;
    writeFileSync(path.join(SHEETS, sheet), encodePng(rgb, W2, H2));
    pairsOut.push({ id, metric, sheet, frames: frames.length, size: SIZE, rows, fps: metric === 'lag' ? 12 : 24, ...(still ? { still: true } : {}) });
    key.push({ id, metric, capture: sc.capture, signal: sc.signal, window: c.a.window, frames: [frames[0], frames[frames.length - 1]],
      a: { variant: va.variant, calm: va.calm, detail: va.detail, lag: va.lag }, b: { variant: vb.variant, calm: vb.calm, detail: vb.detail, lag: vb.lag } });
  });
}
mkdirSync(path.dirname(PAIRS_JSON), { recursive: true });
const generated = new Date().toISOString();
writeFileSync(PAIRS_JSON, JSON.stringify({ version: 1, generated, metrics: TITLES, pairs: pairsOut }, null, 1));
writeFileSync(KEY_JSON, JSON.stringify({ version: 1, generated, note: 'Private key for analyze.mjs: which option is which and every metric value. Do not show it while judging.', seed: SEED, size: SIZE, pairs: key }, null, 1));
const bytes = readdirSync(SHEETS).reduce((a, f) => a + readFileSync(path.join(SHEETS, f)).length, 0);
log(`wrote ${pairsOut.length} pairs (${pairsOut.filter((p) => p.metric === 'calm').length} calm, ${pairsOut.filter((p) => p.metric === 'detail').length} detail, ${pairsOut.filter((p) => p.metric === 'lag').length} lag, ${pairsOut.filter((p) => p.metric === 'tradeoff').length} tradeoff), sheets ${(bytes / 1e6).toFixed(1)} MB`);
