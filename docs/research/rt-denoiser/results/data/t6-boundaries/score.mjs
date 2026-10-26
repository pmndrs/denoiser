#!/usr/bin/env node
// Capture scorer for review target 6 (results/T6-boundaries.md): examples/three-temporal/score-captures.mjs (pooled /
// settled / penumbra PSNR, FLIP, flicker, boil with the reference-smooth mask; AO against ao_ref) plus a
// reference-labelled BOUNDARY region, the same definition as the live test bed's (examples/realtime-denoiser/src/
// metrics.ts BOUNDARY_WGSL): receivers within 2 px of a discontinuity of the capture's exact primary G-buffer (a 5x5
// neighbour that is sky, or whose view depth differs by more than 2 % |z| + 2 x ring x the robust local z slope, or whose
// normal differs by more than acos 0.8 = 37 deg). Per (capture, denoiser, signal): boundary pooled PSNR, boundary boil
// (boil restricted to boundary pixels), and the young boundary (pixels within 2 px whose history tap chain broke this
// frame or the last 7, frames >= 8 after a reset only, as the live 'boundary-young').
//
//   node score.mjs <capture> [<capture> ...] [--denoisers a,b] [--outputs <root>] [--flipEvery 4] [--settle 8] [--json out.json]
import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const REPO = new URL('../../../../../../', import.meta.url).pathname.replace(/\/$/, '');
const {
  OUTPUTS_DIR, frameDir, listDirs, readBuffer, readF32, readManifest, resolveCapture, scoreFrame, settledMask, isScored,
} = await import(`${REPO}/tools/rt-capture/lib/capture.mjs`);
const { prepareFlip, flipMean } = await import(`${REPO}/examples/realtime-denoiser/src/flip.ts`);

const args = process.argv.slice(2);
const VALUE_OPTS = new Set(['denoisers', 'flipEvery', 'settle', 'json', 'outputs']);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i < 0 ? d : args[i + 1]; };
const caps = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && VALUE_OPTS.has(args[i - 1].slice(2))));
const FLIP_EVERY = Number(opt('flipEvery', 4));
const SETTLE = Number(opt('settle', 8));
const AO_A = 1, AO_B = 0.05;
const SIG_CH = { diffuse: 3, specular: 3, visibility: 1, ao: 1 };
const REF = { diffuse: 'diffuse_ref', specular: 'specular_ref', visibility: 'visibility_ref', ao: 'ao_ref' };

const pooledDb = (e, k) => (k ? 10 * Math.log10(1 / Math.max(e / k, 1e-12)) : NaN);
const mean = (xs) => { const v = xs.filter(Number.isFinite); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN; };

/** boundary mask (see the header) */
function boundaryMask(dir, f, W, H) {
  const N = W * H, depth = readBuffer(dir, f, 'depth'), vz = readBuffer(dir, f, 'viewz'), nrm = readBuffer(dir, f, 'normal');
  const z = new Float32Array(N); for (let i = 0; i < N; i++) z[i] = Math.abs(vz[i]);
  const out = new Uint8Array(N);
  const R = 2;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (!isScored(depth[i])) continue;
    const zl = z[y * W + Math.max(x - 1, 0)], zr = z[y * W + Math.min(x + 1, W - 1)], zu = z[Math.max(y - 1, 0) * W + x], zd = z[Math.min(y + 1, H - 1) * W + x];
    const sl = Math.max(Math.min(Math.abs(zr - z[i]), Math.abs(z[i] - zl)), Math.min(Math.abs(zd - z[i]), Math.abs(z[i] - zu)));
    const nl = Math.hypot(nrm[3 * i], nrm[3 * i + 1], nrm[3 * i + 2]) || 1;
    let b = 0;
    for (let dy = -R; dy <= R && !b; dy++) for (let dx = -R; dx <= R; dx++) {
      const qx = x + dx, qy = y + dy;
      if (qx < 0 || qy < 0 || qx >= W || qy >= H) continue;
      const q = qy * W + qx;
      if (!isScored(depth[q])) { b = 1; break; }
      const ring = Math.max(Math.abs(dx), Math.abs(dy));
      if (Math.abs(z[q] - z[i]) > 0.02 * z[i] + 2 * ring * sl) { b = 1; break; }
      const ql = Math.hypot(nrm[3 * q], nrm[3 * q + 1], nrm[3 * q + 2]) || 1;
      if ((nrm[3 * i] * nrm[3 * q] + nrm[3 * i + 1] * nrm[3 * q + 1] + nrm[3 * i + 2] * nrm[3 * q + 2]) / (nl * ql) < 0.8) { b = 1; break; }
    }
    out[i] = b;
  }
  return out;
}
const tmap = (x, ch) => (ch === 1 ? Math.min(Math.max(x, 0), 1) : (x > 0 ? x / (1 + x) : 0));
/** previous-frame pixel of each pixel's history (-1 = none): compare.mjs's max-weight valid bilinear tap */
function historyTaps(dir, m, f) {
  const W = m.width, H = m.height, N = W * H;
  const tap = new Int32Array(N).fill(-1);
  const depth = readBuffer(dir, f, 'depth'), pdepth = readBuffer(dir, f - 1, 'depth');
  const mo = readBuffer(dir, f, 'motion'), vz = readBuffer(dir, f, 'viewz'), pvz = readBuffer(dir, f - 1, 'viewz');
  const mz = m.buffers.some((b) => b.name === 'motion_z') ? readBuffer(dir, f, 'motion_z') : null;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (!isScored(depth[i])) continue;
    const px = x + 0.5 - 0.5 * mo[2 * i] * W - 0.5, py = y + 0.5 + 0.5 * mo[2 * i + 1] * H - 0.5;
    const bx = Math.floor(px), by = Math.floor(py), fx = px - bx, fy = py - by;
    const zExp = vz[i] + (mz ? mz[i] : 0), tol = 0.02 * Math.abs(vz[i]);
    let bestW = -1, best = -1;
    for (let k = 0; k < 4; k++) {
      const qx = bx + (k & 1), qy = by + (k >> 1);
      const w = ((k & 1) ? fx : 1 - fx) * ((k >> 1) ? fy : 1 - fy);
      if (w <= 1e-3 || qx < 0 || qy < 0 || qx >= W || qy >= H) continue;
      const q = qy * W + qx;
      if (!isScored(pdepth[q]) || Math.abs(pvz[q] - zExp) > tol) continue;
      if (w > bestW) { bestW = w; best = q; }
    }
    tap[i] = best;
  }
  return tap;
}
/**
 * boil accumulator: feed(f, values) per frame in order; result() = sqrt(mean b^2 / 6). With `maskOut` (the
 * reference's accumulator) it records which pixels have a smooth reference history (|b_ref| < BOIL_SMOOTH in every
 * channel); with `maskIn` (the outputs') only those pixels count, so resampling at moving edges and real changes of
 * the truth stay out and what is left is the output's own temporal noise.
 */
const BOIL_SMOOTH = 0.02;
function boilAcc(ch, taps, depthOf, resets, maskOut = null, maskIn = null, region = null) {
  let h1 = null, h2 = null, sum = 0, cnt = 0;
  return {
    feed(f, out) {
      if (maskOut) { maskOut.f = f; maskOut.m = null; }
      const N = out.length / ch;
      const v = new Float32Array(N * ch);
      for (let i = 0; i < N * ch; i++) v[i] = Number.isFinite(out[i]) ? tmap(out[i], ch) : 0;
      if (resets[f]) { h1 = v; h2 = null; return; }
      const t = taps[f], t1 = taps[f - 1];
      if (h1 && h2 && t && t1) {
        const depth = depthOf(f);
        const mask = maskOut ? (maskOut.m = new Uint8Array(N)) : null;
        const use = maskIn && maskIn.f === f ? maskIn.m : null;
        if (maskIn && !use) { h2 = h1; h1 = v; return; }
        for (let i = 0; i < N; i++) {
          if (!isScored(depth[i])) continue;
          if (use && !use[i]) continue;
          if (region && !region(f)[i]) continue;
          const a = t[i]; if (a < 0) continue;
          const b = t1[a]; if (b < 0) continue;
          let smooth = 1, s2 = 0;
          for (let c = 0; c < ch; c++) { const d = v[i * ch + c] - 2 * h1[a * ch + c] + h2[b * ch + c]; s2 += d * d; if (Math.abs(d) >= BOIL_SMOOTH) smooth = 0; }
          if (mask) { mask[i] = smooth; if (!smooth) continue; }
          sum += s2; cnt += ch;
        }
      }
      h2 = h1; h1 = v;
    },
    skip() { h1 = null; h2 = null; },
    result: () => (cnt ? Math.sqrt(sum / cnt / 6) : NaN),
  };
}

function scoreCapture(capName) {
  const dir = resolveCapture(capName);
  const m = readManifest(dir);
  const W = m.width, H = m.height, N = W * H;
  const ppd = W / 46.4;
  const has = new Set(m.buffers.map((b) => b.name));
  const signals = Object.keys(SIG_CH).filter((s) => has.has(REF[s]) && (s === 'ao' ? has.has('diffuse_hitt') : has.has(s)));
  const settled = settledMask(m.frames, SETTLE);
  const outRoot = path.join(opt('outputs') ? path.resolve(opt('outputs')) : OUTPUTS_DIR, path.basename(dir));
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
  const resets = m.frames.map((fr, f) => f === 0 || !!fr.reset);
  const taps = m.frames.map((_, f) => (resets[f] ? null : historyTaps(dir, m, f)));
  const depthCache = new Map();
  const bndCache = new Map();
  const bndOf = (f) => { if (!bndCache.has(f)) bndCache.set(f, boundaryMask(dir, f, W, H)); return bndCache.get(f); };
  // young: frames since the tap chain last broke (0 on resets / no history tap), capped at 8
  const age = []; { let prev = null; for (let f = 0; f < m.frames.length; f++) { const a = new Uint8Array(N); if (!resets[f] && prev) { const t = taps[f]; for (let i = 0; i < N; i++) a[i] = t[i] < 0 ? 0 : Math.min(prev[t[i]] + 1, 8); } age.push(a); prev = a; } }
  const since = []; { let r = 0; for (let f = 0; f < m.frames.length; f++) { if (resets[f]) r = f; since.push(f - r); } }
  const depthOf = (f) => { if (!depthCache.has(f)) { depthCache.set(f, readBuffer(dir, f, 'depth')); if (depthCache.size > 3) depthCache.delete(depthCache.keys().next().value); } return depthCache.get(f); };
  const rows = [];
  for (const s of signals) {
    const ch = SIG_CH[s];
    const sources = [{ id: 'noisy', get: (f) => noisyOf(f, s) }];
    for (const d of wanted) {
      const p0 = path.join(outRoot, d, frameDir(0), `${s}.f32`);
      if (existsSync(p0)) sources.push({ id: d, get: (f) => { const p = path.join(outRoot, d, frameDir(f), `${s}.f32`); return existsSync(p) ? readF32(p) : null; } });
    }
    const smoothMask = { f: -1, m: null };
    const refBoil = boilAcc(ch, taps, depthOf, resets, smoothMask);
    const acc = sources.map(() => ({ e: 0, k: 0, eS: 0, kS: 0, eP: 0, kP: 0, eB: 0, kB: 0, eBY: 0, kBY: 0, flick: [], bias: [], flip: [], perFrame: [], nonFinite: 0, prevS: null, frames: 0,
      boil: boilAcc(ch, taps, depthOf, resets, null, smoothMask), boilB: boilAcc(ch, taps, depthOf, resets, null, smoothMask, bndOf) }));
    for (let f = 0; f < m.frames.length; f++) {
      const ref = readBuffer(dir, f, REF[s]);
      const depth = readBuffer(dir, f, 'depth');
      refBoil.feed(f, ref);
      const doFlip = FLIP_EVERY > 0 && f % FLIP_EVERY === FLIP_EVERY - 1;
      let refFlip = null, mask = null;
      if (doFlip) {
        refFlip = prepareFlip(flipRgb(ref, ch), W, H, ppd);
        mask = new Uint8Array(N); for (let i = 0; i < N; i++) mask[i] = isScored(depth[i]) ? 1 : 0;
      }
      sources.forEach((src, j) => {
        const a = acc[j];
        const out = src.get(f);
        if (!out) { a.prevS = null; a.boil.skip(); a.boilB.skip(); return; }
        a.boil.feed(f, out);
        a.boilB.feed(f, out);
        { // boundary region (all ages / young)
          const bm = bndOf(f), ag = age[f];
          for (let i = 0; i < N; i++) {
            if (!bm[i] || !isScored(depth[i])) continue;
            let e2 = 0;
            for (let c = 0; c < ch; c++) { const o = out[i * ch + c]; const d = (Number.isFinite(o) ? tmap(o, ch) : 0) - tmap(ref[i * ch + c], ch); e2 += d * d; }
            a.eB += e2; a.kB += ch;
            if (ag[i] < 8 && since[f] >= 8) { a.eBY += e2; a.kBY += ch; }
          }
        }
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
        boil: a.boil.result(), ...(src.id === 'noisy' ? { refBoil: refBoil.result() } : {}),
        psnrBoundaryPooled: pooledDb(a.eB, a.kB), psnrBoundaryYoungPooled: pooledDb(a.eBY, a.kBY), boilBoundary: a.boilB.result(),
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
  console.log('| signal | denoiser | pooled PSNR | settled pooled | penumbra pooled | boundary pooled | boundary young | FLIP | flicker | boil | boundary boil | bias | non-finite |');
  console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const x of r.rows) {
    console.log(`| ${x.signal} | ${x.denoiser} | ${f2(x.psnrPooled)} | ${f2(x.psnrSettledPooled)} | ${f2(x.psnrPenumbraPooled)} | ${f2(x.psnrBoundaryPooled)} | ${f2(x.psnrBoundaryYoungPooled)} | ${f2(x.flip, 4)} | ${f2(x.flicker, 4)} | ${f2(x.boil, 4)} | ${f2(x.boilBoundary, 4)} | ${f2(x.bias, 4)} | ${x.nonFinite} |`);
    if (x.refBoil !== undefined) console.log(`| ${x.signal} | reference (its own boil) | | | | | | | | ${f2(x.refBoil, 4)} | | | |`);
  }
}
if (opt('json')) writeFileSync(opt('json'), JSON.stringify(all, null, 1));
