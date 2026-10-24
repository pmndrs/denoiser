#!/usr/bin/env node
// Score replay outputs (ours or native, same layout) against the capture's *_ref buffers
// with the metric definitions in CAPTURE-FORMAT.md ("Metrics for replay outputs").
// Writes outputs/<capture>/compare.md + compare.json and prints the table.
//
//   node tools/rt-capture/compare.mjs <capture name | dir> [denoiser ...]
//        [--outputs <root containing <capture>/<denoiser>/>] [--settle 8] [--quiet]
//
// Defaults: every denoiser folder under outputs/<capture>/. Native results: point
// --outputs at the native outputs root (e.g. C:\dev\nrd-reference\outputs).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  OUTPUTS_DIR, PSNR_CAP_DB, SIGNALS, frameDir, listDirs, mean, readBuffer, readF32, readManifest, resolveCapture, scoreFrame, settledMask,
} from './lib/capture.mjs';

const args = process.argv.slice(2);
const VALUE_OPTS = new Set(['outputs', 'settle']);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i < 0 ? d : args[i + 1]; };
const pos = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && VALUE_OPTS.has(args[i - 1].slice(2))));
const capDir = resolveCapture(pos[0]);
const capName = path.basename(capDir);
const outRoot = path.join(path.resolve(opt('outputs', OUTPUTS_DIR)), capName);
const SETTLE = Number(opt('settle', 8));
const m = readManifest(capDir);
const N = m.width * m.height;
const denoisers = pos.length > 1 ? pos.slice(1) : listDirs(outRoot);
if (!denoisers.length) { console.error(`no outputs under ${outRoot}`); process.exit(1); }
const chOf = Object.fromEntries(m.buffers.map((b) => [b.name, b.channels]));
const settled = settledMask(m.frames, SETTLE);

// noisy baseline + reference + depth, cached per frame
const capCache = new Map();
const capFrame = (f) => {
  if (!capCache.has(f)) {
    const o = { depth: readBuffer(capDir, f, 'depth') };
    for (const s of SIGNALS) if (chOf[s] && chOf[`${s}_ref`]) { o[s] = readBuffer(capDir, f, s); o[`${s}_ref`] = readBuffer(capDir, f, `${s}_ref`); }
    capCache.set(f, o);
  }
  return capCache.get(f);
};

function scoreSequence(getOut, signal) {
  const ch = chOf[signal];
  const per = [];
  let prevS = null;
  for (let f = 0; f < m.frames.length; f++) {
    const c = capFrame(f);
    const out = getOut(f);
    if (!out) { per.push(null); prevS = null; continue; }
    if (out.length !== N * ch) throw new Error(`${signal} frame ${f}: ${out.length} floats, expected ${N * ch}`);
    const r = scoreFrame(out, c[`${signal}_ref`], c.depth, ch, m.frames[f].reset ? null : prevS);
    prevS = r.s;
    delete r.s;
    per.push(r);
  }
  const ok = per.filter(Boolean);
  const pick = (k, mask) => per.map((r, i) => (r && (!mask || mask[i]) ? r[k] : NaN));
  const last = [...per].reverse().find(Boolean);
  // pooled: PSNR of the mean squared error over all (masked) frames and pixels
  const pooled = (sseKey, cntKey, mask) => {
    let e = 0, k = 0;
    per.forEach((r, i) => { if (r && (!mask || mask[i])) { e += r[sseKey]; k += r[cntKey]; } });
    return k ? 10 * Math.log10(1 / Math.max(e / k, 1e-12)) : NaN;
  };
  const capped = (xs) => xs.map((x) => (Number.isFinite(x) ? Math.min(x, PSNR_CAP_DB) : x));
  return {
    frames: ok.length,
    psnr: mean(pick('psnr')),
    psnrSettled: mean(pick('psnr', settled)),
    psnrLast: last?.psnr ?? NaN,
    psnrPenumbra: ch === 1 ? mean(pick('psnrPenumbra')) : NaN,
    // pooled = PSNR of the mean MSE; capped = mean of per-frame dB clipped at PSNR_CAP_DB
    // (psnr / psnrSettled / psnrPenumbra above: plain mean of per-frame dB, unchanged)
    psnrPooled: pooled('sse', 'sseCount'),
    psnrSettledPooled: pooled('sse', 'sseCount', settled),
    psnrPenumbraPooled: ch === 1 ? pooled('ssePenumbra', 'ssePenumbraCount') : NaN,
    psnrCapped: mean(capped(pick('psnr'))),
    psnrSettledCapped: mean(capped(pick('psnr', settled))),
    psnrPenumbraCapped: ch === 1 ? mean(capped(pick('psnrPenumbra'))) : NaN,
    flicker: mean(pick('flicker')),
    bias: mean(pick('bias')),
    nonFinite: ok.reduce((a, r) => a + r.nonFinite, 0),
    perFramePsnr: per.map((r) => (r ? +r.psnr.toFixed(3) : null)),
  };
}

function timingSummary(dir) {
  const p = path.join(dir, 'timings.csv');
  if (!existsSync(p)) return {};
  const rows = readFileSync(p, 'utf8').trim().split('\n').slice(1).map((l) => l.split(','));
  const byFrame = (pred) => {
    const mm = new Map();
    for (const [f, pass, ms] of rows) if (pred(pass)) mm.set(f, (mm.get(f) ?? 0) + Number(ms));
    const v = [...mm.values()].sort((a, b) => a - b);
    // skip the first frame (pipeline compilation) when there are others
    const w = v.length > 1 ? [...mm.entries()].filter(([f]) => f !== rows[0][0]).map(([, x]) => x).sort((a, b) => a - b) : v;
    return w.length ? w[Math.floor(w.length / 2)] : NaN;
  };
  return { medianGpuMs: byFrame((p) => p === 'total' || p.endsWith('/total')), medianWallMs: byFrame((p) => p === 'wall') };
}

const results = [];
const baselines = {};
for (const s of SIGNALS) {
  if (!chOf[s] || !chOf[`${s}_ref`]) continue;
  baselines[s] = scoreSequence((f) => capFrame(f)[s], s);
}
for (const d of denoisers) {
  const dir = path.join(outRoot, d);
  const run = existsSync(path.join(dir, 'run.json')) ? JSON.parse(readFileSync(path.join(dir, 'run.json'), 'utf8')) : {};
  const t = timingSummary(dir);
  for (const s of SIGNALS) {
    if (!baselines[s]) continue;
    if (!existsSync(path.join(dir, frameDir(0), `${s}.f32`))) continue;
    const r = scoreSequence((f) => {
      const p = path.join(dir, frameDir(f), `${s}.f32`);
      return existsSync(p) ? readF32(p) : null;
    }, s);
    results.push({ denoiser: d, signal: s, ...r, ...t, commit: run.commit ?? run.version ?? null, gpu: run.gpu?.description || run.gpu?.architecture || run.gpu || null });
  }
}

const f2 = (x, k = 2) => (Number.isFinite(x) ? x.toFixed(k) : '–');
const lines = [
  `# ${capName}: replay scores`,
  '',
  `${m.width}×${m.height}, ${m.frames.length} frames, resets at [${m.frames.filter((f) => f.reset).map((f) => f.index).join(', ')}], referenceSpp ${m.referenceSpp}. ` +
  `Metrics: CAPTURE-FORMAT.md; settled = ≥ ${SETTLE} frames after a reset. PSNR, settled, last frame and penumbra are means of per-frame dB; ` +
  `pooled = PSNR of the mean MSE over all frames and pixels; capped = mean of per-frame dB clipped at ${PSNR_CAP_DB} dB.`,
  '',
  '| denoiser | signal | PSNR dB (noisy → out) | pooled | capped | settled | settled pooled | last frame | penumbra | penumbra pooled | flicker (noisy → out) | bias | non-finite | GPU ms | wall ms |',
  '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
];
for (const r of results) {
  const b = baselines[r.signal];
  lines.push(`| ${r.denoiser} | ${r.signal} | ${f2(b.psnr)} → **${f2(r.psnr)}** | ${f2(r.psnrPooled)} | ${f2(r.psnrCapped)} | ${f2(r.psnrSettled)} | ${f2(r.psnrSettledPooled)} | ${f2(r.psnrLast)} | ${f2(r.psnrPenumbra)} | ${f2(r.psnrPenumbraPooled)} | ${f2(b.flicker, 4)} → ${f2(r.flicker, 4)} | ${f2(r.bias, 4)} | ${r.nonFinite} | ${f2(r.medianGpuMs, 3)} | ${f2(r.medianWallMs, 2)} |`);
}
const md = lines.join('\n') + '\n';
writeFileSync(path.join(outRoot, 'compare.md'), md);
writeFileSync(path.join(outRoot, 'compare.json'), JSON.stringify({ capture: capName, settle: SETTLE, baselines, results }, null, 1));
if (!args.includes('--quiet')) {
  console.log(md);
  for (const r of results) console.log(`${r.denoiser}/${r.signal} per-frame PSNR: ${r.perFramePsnr.join(' ')}`);
  console.log(`\nwrote ${path.join(outRoot, 'compare.md')}`);
}
