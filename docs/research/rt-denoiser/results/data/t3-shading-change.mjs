#!/usr/bin/env node
// T3: the upscaler's `shadingChange` guide measured as a possible input for antiLag 'gradient' (results/T3-light-changes.md
// §"shadingChange"). A CPU port of @pmndrs/upscaler's src/shaders/shadingChange.ts (MIT, (c) 2026 Dennis Smolek; read from
// /Users/dex/Developer/fsr3 at 57eac72, not modified): per 2x2 render block (one half-res texel), the relative difference
// 1 - min / max of current vs previous block-mean luma (Rec. 709) over the 4x4 and 8x8 render blocks of its 16x16 tile,
// each gated by smoothstep(f, 3 f, .) with f = base (0.08 / 0.04) + 0.35 x the block's coefficient of variation; the
// response is the max of the two. The lc540-* captures have a fixed camera, no jitter and no disocclusion, so the
// reprojection is the identity, the exposure terms are 1 and the disocclusion neutralization never applies.
//
// The upscaler runs after the denoiser, so the response computed from frames t - 1 and t (its input image = the
// denoised frame) reaches the denoiser at frame t + 1 ("late"). Fed here: the denoised output of an arm (what the
// upscaler would see), the noisy input (an upscaler without a denoiser), or the reference (an ideal denoiser).
// Diffuse is remodulated with the capture's albedo (the upscaler sees colour, not demodulated irradiance).
//
//   node t3-shading-change.mjs <capture> --src t3-svgf-auto,noisy,ref [--signal diffuse] [--json out.json]
import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const REPO = new URL('../../../../../', import.meta.url).pathname.replace(/\/$/, '');
const cap = await import(`${REPO}/tools/rt-capture/lib/capture.mjs`);
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i < 0 ? d : args[i + 1]; };
const capDir = cap.resolveCapture(args[0]);
const capName = path.basename(capDir);
const m = cap.readManifest(capDir);
const W = m.width, H = m.height, N = W * H, F = m.frames.length;
const sig = opt('signal', 'diffuse');
const srcs = opt('src', 'ref').split(',');
const RAMP = /fade|emitter/.test(capName);
const [onset, onsetEnd, ret, retEnd] = (opt('events', RAMP ? '24,39,56,71' : '24,24,56,56')).split(',').map(Number);
const HW = Math.ceil(W / 2), HH = Math.ceil(H / 2);
const FLOOR_MID = 0.08, FLOOR_COARSE = 0.04, FLOOR_CV = 0.35;
const smooth = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };
const lum = (a, i, ch) => (ch === 1 ? a[i] : 0.2126 * a[i * ch] + 0.7152 * a[i * ch + 1] + 0.0722 * a[i * ch + 2]);

const depth0 = cap.readBuffer(capDir, 0, 'depth');
const albedo = sig === 'diffuse' ? cap.readBuffer(capDir, 0, 'albedo') : null;
const ach = albedo ? albedo.length / N : 0;
// reference change mask (any channel, linear-relative > 5 % or tonemapped > 0.02 over the capture), per half-res texel
const refs = []; for (let f = 0; f < F; f++) refs.push(cap.readBuffer(capDir, f, `${sig}_ref`));
const rch = refs[0].length / N;
const tm = (x) => (x > 0 ? x / (1 + x) : 0);
const dynPx = new Uint8Array(N), statPx = new Uint8Array(N);
for (let i = 0; i < N; i++) {
  if (!(depth0[i] > 0 && depth0[i] < 1)) continue;
  let c = 0; for (let f = 1; f < F; f++) for (let k = 0; k < Math.min(rch, 3); k++) c = Math.max(c, Math.abs(tm(refs[f][i * rch + k]) - tm(refs[0][i * rch + k])));
  if (c > 0.02) dynPx[i] = 1; else if (c < 0.002) statPx[i] = 1;
}
const dynH = new Uint8Array(HW * HH), statH = new Uint8Array(HW * HH);
for (let y = 0; y < HH; y++) for (let x = 0; x < HW; x++) {
  let d = 0, s = 0, n = 0;
  for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) { const px = Math.min(2 * x + dx, W - 1), py = Math.min(2 * y + dy, H - 1), i = py * W + px; d |= dynPx[i]; s += statPx[i]; n++; }
  dynH[y * HW + x] = d; statH[y * HW + x] = s === n ? 1 : 0;
}

/** scene-colour luma of one frame of a source */
function lumaFrame(src, f) {
  let a;
  if (src === 'noisy') a = cap.readBuffer(capDir, f, sig);
  else if (src === 'ref') a = refs[f];
  else a = cap.readF32(path.join(cap.OUTPUTS_DIR, capName, src, cap.frameDir(f), `${sig}.f32`));
  const ch = a.length / N, out = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    if (albedo && ch >= 3) out[i] = 0.2126 * a[i * ch] * albedo[i * ach] + 0.7152 * a[i * ch + 1] * albedo[i * ach + 1] + 0.0722 * a[i * ch + 2] * albedo[i * ach + 2];
    else out[i] = Math.max(lum(a, i, ch), 0);
    if (!Number.isFinite(out[i]) || out[i] < 0) out[i] = 0;
  }
  return out;
}
/** the upscaler's response (half res) from the current and previous luma */
function response(cur, prev) {
  const r = new Float32Array(HW * HH);
  const at = (a, x, y) => a[Math.min(y, H - 1) * W + Math.min(x, W - 1)];
  // per half-res texel: its 2x2 block sums (x = cur, y = prev, z = cur^2)
  const bs = new Float64Array(HW * HH * 3);
  for (let y = 0; y < HH; y++) for (let x = 0; x < HW; x++) {
    let sx = 0, sy = 0, sz = 0;
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) { const c = at(cur, 2 * x + dx, 2 * y + dy), p = at(prev, 2 * x + dx, 2 * y + dy); sx += c; sy += p; sz += c * c; }
    const k = (y * HW + x) * 3; bs[k] = sx; bs[k + 1] = sy; bs[k + 2] = sz;
  }
  const scale = (x0, y0, n, cnt, floorBase) => {
    let sx = 0, sy = 0, sz = 0;
    for (let y = y0; y < y0 + n; y++) for (let x = x0; x < x0 + n; x++) { const k = (Math.min(y, HH - 1) * HW + Math.min(x, HW - 1)) * 3; sx += bs[k]; sy += bs[k + 1]; sz += bs[k + 2]; }
    const mx = Math.max(sx, sy); if (mx <= 1e-5) return 0;
    const mean = sx / cnt, v = Math.max(sz / cnt - mean * mean, 0), cv = Math.sqrt(v) / Math.max(mean, 1e-4);
    const fl = floorBase + FLOOR_CV * cv;
    return smooth(fl, 3 * fl, 1 - Math.min(sx, sy) / mx);
  };
  for (let y = 0; y < HH; y++) for (let x = 0; x < HW; x++) {
    // workgroup-local blocks: mid = the 2x2 threads containing (x, y), coarse = the 4x4 threads (within the 8x8 group)
    const mx = x - (x % 2), my = y - (y % 2), cx = x - (x % 4), cy = y - (y % 4);
    r[y * HW + x] = Math.max(scale(mx, my, 2, 16, FLOOR_MID), scale(cx, cy, 4, 64, FLOOR_COARSE));
  }
  return r;
}

const out = { capture: capName, signal: sig, events: { onset, onsetEnd, ret, retEnd }, sources: {} };
const nd = dynH.reduce((u, v) => u + v, 0), ns = statH.reduce((u, v) => u + v, 0);
for (const src of srcs) {
  if (!['noisy', 'ref'].includes(src) && !existsSync(path.join(cap.OUTPUTS_DIR, capName, src, cap.frameDir(F - 1)))) { console.error(`skip ${src}`); continue; }
  let prev = lumaFrame(src, 0);
  const per = [{ f: 0 }];
  for (let f = 1; f < F; f++) {
    const cur = lumaFrame(src, f);
    const r = response(cur, prev);
    let dS = 0, dHit = 0, sS = 0, sHit = 0;
    for (let k = 0; k < HW * HH; k++) { if (dynH[k]) { dS += r[k]; if (r[k] > 0.5) dHit++; } else if (statH[k]) { sS += r[k]; if (r[k] > 0.5) sHit++; } }
    // computed from frames f - 1, f; usable by the denoiser at frame f + 1
    per.push({ f, usableAt: f + 1, dynMean: dS / nd, dynFrac: dHit / nd, statMean: sS / ns, statFrac: sHit / ns });
    prev = cur;
  }
  const win = (a, b) => { const xs = per.slice(a, b); const mean = (k) => xs.reduce((u, p) => u + p[k], 0) / xs.length; return { dynMean: mean('dynMean'), dynFrac: mean('dynFrac'), statMean: mean('statMean'), statFrac: mean('statFrac') }; };
  out.sources[src] = { perFrame: per, quiet: win(8, onset), held: win(onsetEnd + 9, ret) };
  const show = [onset - 1, onset, onset + 1, onset + 2, onset + 4, ret, ret + 1].map((f) => `${f}:${per[f].dynFrac.toFixed(2)}/${per[f].statFrac.toFixed(3)}`).join(' ');
  console.log(`${capName} ${sig} ${src.padEnd(14)} dynFrac/statFrac (r>0.5) at frame [computed]: ${show} | quiet stat ${out.sources[src].quiet.statFrac.toFixed(4)} dyn ${out.sources[src].quiet.dynFrac.toFixed(4)}`);
}
console.log(`texels: dynamic ${nd}, static ${ns} (half res)`);
if (opt('json')) writeFileSync(opt('json'), JSON.stringify(out));
