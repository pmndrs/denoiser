#!/usr/bin/env node
// Scores replay outputs of the three-temporal moving-camera captures (CAPTURES.md here):
// tools/rt-capture/compare.mjs's metric definitions (CAPTURE-FORMAT "Metrics for replay outputs",
// via lib/capture.mjs scoreFrame) plus two things compare.mjs doesn't do:
//   - AO: the derived `ao` output (normalized hit distance ĥ) against the capture's extra `ao_ref`
//     buffer (compare.mjs only scores signals with a v0 `<signal>_ref`); the noisy baseline is the
//     1-ray ĥ = h / (h + 1 + 0.05·(−viewz)), miss = 1, the OcclusionDenoiser default curve;
//   - LDR-FLIP (examples/realtime-denoiser/src/flip.ts, the test bed's viewing condition: the image
//     spans 46.4°, ppd = W / 46.4) on every --flipEvery-th frame (default 4), mean over receivers.
//
//   node examples/three-temporal/score-captures.mjs <capture> [<capture> ...] [--denoisers a,b]
//        [--flipEvery 4] [--settle 8] [--json out.json]
//
// Per (capture, denoiser, signal): pooled PSNR (rank on this), settled pooled (≥ settle frames
// after the reset), penumbra pooled (visibility), flicker, bias, FLIP, non-finite count.
import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  OUTPUTS_DIR, frameDir, listDirs, readBuffer, readF32, readManifest, resolveCapture, scoreFrame, settledMask, isScored,
} from '../../tools/rt-capture/lib/capture.mjs';
import { prepareFlip, flipMean } from '../realtime-denoiser/src/flip.ts';

const args = process.argv.slice(2);
const VALUE_OPTS = new Set(['denoisers', 'flipEvery', 'settle', 'json']);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i < 0 ? d : args[i + 1]; };
const caps = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && VALUE_OPTS.has(args[i - 1].slice(2))));
const FLIP_EVERY = Number(opt('flipEvery', 4));
const SETTLE = Number(opt('settle', 8));
const AO_A = 1, AO_B = 0.05;
const SIG_CH = { diffuse: 3, specular: 3, visibility: 1, ao: 1 };
const REF = { diffuse: 'diffuse_ref', specular: 'specular_ref', visibility: 'visibility_ref', ao: 'ao_ref' };

const pooledDb = (e, k) => (k ? 10 * Math.log10(1 / Math.max(e / k, 1e-12)) : NaN);
const mean = (xs) => { const v = xs.filter(Number.isFinite); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN; };

function scoreCapture(capName) {
  const dir = resolveCapture(capName);
  const m = readManifest(dir);
  const W = m.width, H = m.height, N = W * H;
  const ppd = W / 46.4;
  const has = new Set(m.buffers.map((b) => b.name));
  const signals = Object.keys(SIG_CH).filter((s) => has.has(REF[s]) && (s === 'ao' ? has.has('diffuse_hitt') : has.has(s)));
  const settled = settledMask(m.frames, SETTLE);
  const outRoot = path.join(OUTPUTS_DIR, path.basename(dir));
  const wanted = opt('denoisers') ? opt('denoisers').split(',') : listDirs(outRoot);
  const noisyOf = (f, s) => {
    if (s !== 'ao') return readBuffer(dir, f, s);
    const h = readBuffer(dir, f, 'diffuse_hitt'), vz = readBuffer(dir, f, 'viewz');
    const o = new Float32Array(N);
    for (let i = 0; i < N; i++) o[i] = h[i] > 0 ? h[i] / (h[i] + AO_A + AO_B * Math.max(0, -vz[i])) : 1;
    return o;
  };
  // FLIP inputs: tonemapped rgb (x / (1 + x)) or gray (clamped), as the test bed
  const flipRgb = (d, ch) => {
    const g = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) for (let c = 0; c < 3; c++) {
      const v = d[i * ch + (ch === 3 ? c : 0)];
      g[3 * i + c] = ch === 3 ? (v > 0 ? v / (1 + v) : 0) : Math.min(1, Math.max(0, v));
    }
    return g;
  };
  const rows = [];
  for (const s of signals) {
    const ch = SIG_CH[s];
    const sources = [{ id: 'noisy', get: (f) => noisyOf(f, s) }];
    for (const d of wanted) {
      const p0 = path.join(outRoot, d, frameDir(0), `${s}.f32`);
      if (existsSync(p0)) sources.push({ id: d, get: (f) => { const p = path.join(outRoot, d, frameDir(f), `${s}.f32`); return existsSync(p) ? readF32(p) : null; } });
    }
    const acc = sources.map(() => ({ e: 0, k: 0, eS: 0, kS: 0, eP: 0, kP: 0, flick: [], bias: [], flip: [], perFrame: [], nonFinite: 0, prevS: null, frames: 0 }));
    for (let f = 0; f < m.frames.length; f++) {
      const ref = readBuffer(dir, f, REF[s]);
      const depth = readBuffer(dir, f, 'depth');
      const doFlip = FLIP_EVERY > 0 && f % FLIP_EVERY === FLIP_EVERY - 1;
      let refFlip = null, mask = null;
      if (doFlip) {
        refFlip = prepareFlip(flipRgb(ref, ch), W, H, ppd);
        mask = new Uint8Array(N); for (let i = 0; i < N; i++) mask[i] = isScored(depth[i]) ? 1 : 0;
      }
      sources.forEach((src, j) => {
        const a = acc[j];
        const out = src.get(f);
        if (!out) { a.prevS = null; return; }
        const r = scoreFrame(out, ref, depth, ch, m.frames[f].reset ? null : a.prevS);
        a.prevS = r.s;
        a.e += r.sse; a.k += r.sseCount;
        if (settled[f]) { a.eS += r.sse; a.kS += r.sseCount; }
        a.eP += r.ssePenumbra; a.kP += r.ssePenumbraCount;
        a.flick.push(r.flicker); a.bias.push(r.bias); a.perFrame.push(+r.psnr.toFixed(3)); a.nonFinite += r.nonFinite; a.frames++;
        if (doFlip) a.flip.push(flipMean(refFlip, prepareFlip(flipRgb(out, ch), W, H, ppd), mask));
      });
    }
    sources.forEach((src, j) => {
      const a = acc[j];
      rows.push({
        capture: path.basename(dir), signal: s, denoiser: src.id, frames: a.frames,
        psnrPooled: pooledDb(a.e, a.k), psnrSettledPooled: pooledDb(a.eS, a.kS),
        psnrPenumbraPooled: s === 'visibility' ? pooledDb(a.eP, a.kP) : NaN,
        flicker: mean(a.flick), bias: s === 'ao' ? NaN : mean(a.bias), flip: mean(a.flip), flipFrames: a.flip.length,
        nonFinite: a.nonFinite, perFramePsnr: a.perFrame,
      });
    });
  }
  return { capture: path.basename(dir), width: W, height: H, frames: m.frames.length, settle: SETTLE, flipEvery: FLIP_EVERY, ppd: +ppd.toFixed(2), rows };
}

const f2 = (x, k = 2) => (Number.isFinite(x) ? x.toFixed(k) : '–');
const all = [];
for (const c of caps) {
  const r = scoreCapture(c);
  all.push(r);
  console.log(`\n## ${r.capture} (${r.width}x${r.height}, ${r.frames} frames; settled = frames ≥ ${r.settle}; FLIP every ${r.flipEvery}th frame, ${r.ppd} ppd)\n`);
  console.log('| signal | denoiser | pooled PSNR | settled pooled | penumbra pooled | FLIP | flicker | bias | non-finite |');
  console.log('|---|---|---|---|---|---|---|---|---|');
  for (const x of r.rows) console.log(`| ${x.signal} | ${x.denoiser} | ${f2(x.psnrPooled)} | ${f2(x.psnrSettledPooled)} | ${f2(x.psnrPenumbraPooled)} | ${f2(x.flip, 4)} | ${f2(x.flicker, 4)} | ${f2(x.bias, 4)} | ${x.nonFinite} |`);
}
if (opt('json')) writeFileSync(opt('json'), JSON.stringify(all, null, 1));
