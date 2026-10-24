#!/usr/bin/env node
// Validate a capture against CAPTURE-FORMAT v0: manifest vs files and sizes, finiteness,
// ranges and conventions, and reprojection consistency (the guard against sign / flip /
// unit mistakes on both sides):
//   - depth <-> viewz through the projection
//   - normals face the camera
//   - motion (and motion_z) vs reprojecting P with the manifest's matrices (static scenes)
//   - prevView/prevProjection == previous frame's view/projection
//   - history consistency: following `motion` back into the previous frame's viewz lands
//     on the expected previous view z (works for dynamic scenes too, given motion_z)
//
//   node tools/rt-capture/validate.mjs <capture name | dir> [--json out.json] [--stride N] [--quiet]
// Exit code 1 if any check fails.
import { existsSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  BUFFER_CHANNELS, frameDir, invert, isScored, mul, ndcToPixels, project, readBuffer, readManifest, resolveCapture, sampleNdc, xform,
} from './lib/capture.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i < 0 ? d : args[i + 1]; };
const dir = resolveCapture(args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--') && ['json', 'stride'].includes(args[i - 1].slice(2)))));
const QUIET = args.includes('--quiet');

const report = { capture: dir, errors: [], warnings: [], checks: {} };
const err = (m) => report.errors.push(m);
const warn = (m) => report.warnings.push(m);
const check = (name, ok, detail, level = 'error') => {
  report.checks[name] = { ok, ...detail };
  if (!ok) (level === 'error' ? err : warn)(`${name}: ${JSON.stringify(detail)}`);
};

// ---- manifest -------------------------------------------------------------------------
const m = readManifest(dir);
const W = m.width, H = m.height, N = W * H;
const STRIDE = Number(opt('stride', Math.max(1, Math.floor(Math.sqrt(N / 65536)))));
if (m.version !== 0) err(`version is ${m.version}, expected 0`);
if (!Number.isInteger(W) || !Number.isInteger(H) || W <= 0 || H <= 0) err(`bad size ${W}x${H}`);
if (!Array.isArray(m.buffers) || !m.buffers.length) err('no buffers listed');
if (!Array.isArray(m.frames) || !m.frames.length) err('no frames');
const bufs = new Map((m.buffers ?? []).map((b) => [b.name, b.channels]));
for (const [name, ch] of bufs) {
  if (!(name in BUFFER_CHANNELS)) warn(`unknown buffer "${name}" (${ch} ch): ignored by v0 readers`);
  else if (BUFFER_CHANNELS[name] !== ch) err(`buffer ${name}: ${ch} channels, v0 says ${BUFFER_CHANNELS[name]}`);
}
for (const req of ['depth', 'viewz', 'normal', 'motion']) if (!bufs.has(req)) err(`required guide "${req}" missing`);
for (const s of ['diffuse', 'specular', 'visibility']) if (bufs.has(s) && !bufs.has(`${s}_ref`)) warn(`${s} has no ${s}_ref: cannot be scored`);
if (bufs.has('visibility')) {
  const sh = (m.lights ?? []).filter((l) => l.shadow);
  if (sh.length !== 1) err(`visibility present but ${sh.length} lights have "shadow": true (v0: exactly one)`);
}
for (const l of m.lights ?? []) {
  if (l.type === 'sphere' && !(Array.isArray(l.position) && l.radius >= 0)) err(`light ${l.id}: sphere needs position + radius`);
  if (l.type === 'directional' && !(Array.isArray(l.direction) && l.angularRadius >= 0)) err(`light ${l.id}: directional needs direction + angularRadius`);
}
if (m.demodulation?.specular && m.demodulation.specular !== 'karis2014-envbrdf-approx') warn(`unknown specular demodulation "${m.demodulation.specular}"`);
(m.frames ?? []).forEach((f, i) => {
  if (f.index !== i) err(`frames[${i}].index = ${f.index}`);
  if (i === 0 && !f.reset) err('frame 0 must have reset: true');
  const c = f.camera ?? {};
  for (const k of ['view', 'projection', 'prevView', 'prevProjection']) {
    if (!Array.isArray(c[k]) || c[k].length !== 16 || !c[k].every(Number.isFinite)) err(`frame ${i}: camera.${k} is not 16 finite numbers`);
  }
  if (!(c.near > 0 && c.far > c.near)) err(`frame ${i}: near/far ${c.near}/${c.far}`);
});
if (report.errors.length) finish();

// ---- files ----------------------------------------------------------------------------
let missing = 0, badSize = 0;
for (let f = 0; f < m.frames.length; f++) {
  const fd = path.join(dir, frameDir(f));
  if (!existsSync(fd)) { err(`missing ${frameDir(f)}/`); missing++; continue; }
  for (const [name, ch] of bufs) {
    const p = path.join(fd, `${name}.f32`);
    if (!existsSync(p)) { err(`missing ${frameDir(f)}/${name}.f32`); missing++; continue; }
    const sz = statSync(p).size;
    if (sz !== N * ch * 4) { err(`${frameDir(f)}/${name}.f32: ${sz} bytes, expected ${N * ch * 4}`); badSize++; }
  }
  for (const file of readdirSync(fd)) if (file.endsWith('.f32') && !bufs.has(file.slice(0, -4))) warn(`${frameDir(f)}/${file} not listed in the manifest`);
}
const extra = readdirSync(dir).filter((n) => /^frame_\d+$/.test(n) && Number(n.slice(6)) >= m.frames.length);
if (extra.length) warn(`frame folders beyond the manifest: ${extra.join(', ')}`);
check('files', !missing && !badSize, { frames: m.frames.length, buffers: bufs.size, missing, badSize });
if (report.errors.length) finish();

// ---- per-frame checks -------------------------------------------------------------------
const acc = {
  nonFinite: {}, viewzPositive: 0, viewzBeyondFar: 0, scored: 0, sky: 0, normalNotUnit: 0, skyNormalNonZero: 0,
  normalBackfacing: 0, depthViewzRelErrMax: 0, rangeViolations: {},
  motionErrPx: [], motionZErr: [], motionZRel: [], camMismatch: [], hist: { tested: 0, ok: 0 },
};
const rangeBad = (name, n) => { acc.rangeViolations[name] = (acc.rangeViolations[name] ?? 0) + n; };
const RANGE = {
  depth: [0, 1], roughness: [0, 1], albedo: [0, 1], f0: [0, 1], visibility: [0, 1], visibility_ref: [0, 1],
  diffuse: [0, Infinity], specular: [0, Infinity], diffuse_ref: [0, Infinity], specular_ref: [0, Infinity],
  diffuse_hitt: [0, Infinity], specular_hitt: [0, Infinity], occluder_dist: [0, Infinity],
};
const hasMZ = bufs.has('motion_z');
let prev = null;

for (let f = 0; f < m.frames.length; f++) {
  const fr = m.frames[f];
  const cam = fr.camera;
  const jit = cam.jitter ?? [0, 0];
  const B = {};
  for (const [name] of bufs) B[name] = readBuffer(dir, f, name);
  // finiteness + ranges
  for (const [name, ch] of bufs) {
    const a = B[name];
    let bad = 0, out = 0;
    const r = RANGE[name];
    for (let i = 0; i < a.length; i++) {
      const v = a[i];
      if (!Number.isFinite(v)) bad++;
      else if (r && (v < r[0] - 1e-6 || v > r[1] + 1e-6)) out++;
    }
    if (bad) acc.nonFinite[name] = (acc.nonFinite[name] ?? 0) + bad;
    if (out) rangeBad(name, out);
    void ch;
  }
  // camera continuity
  if (f > 0 && !fr.reset) {
    const p = m.frames[f - 1].camera;
    const d = Math.max(...cam.prevView.map((v, k) => Math.abs(v - p.view[k])), ...cam.prevProjection.map((v, k) => Math.abs(v - p.projection[k])));
    if (d > 1e-4) acc.camMismatch.push({ frame: f, maxAbsDiff: +d.toExponential(2) });
  }
  const vp = mul(cam.projection, cam.view);
  const ivp = invert(vp);
  const pvp = mul(cam.prevProjection, cam.prevView);
  const eye = cam.position ?? (() => { const iv = invert(cam.view); return [iv[12], iv[13], iv[14]]; })();
  const rev = !!m.reversedDepth;
  for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) {
    const i = py * W + px;
    const d = B.depth[i];
    const sky = rev ? d <= 0 : d >= 1;
    if (sky) {
      acc.sky++;
      if (B.normal[3 * i] || B.normal[3 * i + 1] || B.normal[3 * i + 2]) acc.skyNormalNonZero++;
      continue;
    }
    acc.scored++;
    const vz = B.viewz[i];
    if (vz >= 0) acc.viewzPositive++;
    if (vz < -cam.far * 1.0001) acc.viewzBeyondFar++;
    const n = [B.normal[3 * i], B.normal[3 * i + 1], B.normal[3 * i + 2]];
    if (Math.abs(Math.hypot(...n) - 1) > 1e-2) acc.normalNotUnit++;
    if ((px % STRIDE) || (py % STRIDE)) continue;
    const [nx, ny] = sampleNdc(px, py, W, H, jit);
    const P = project(ivp, nx, ny, d);
    // depth <-> viewz
    const vzP = xform(cam.view, P[0], P[1], P[2])[2];
    const rel = Math.abs(vzP - vz) / Math.max(Math.abs(vz), 1e-6);
    if (rel > acc.depthViewzRelErrMax) acc.depthViewzRelErrMax = rel;
    // normal faces the camera
    if (n[0] * (eye[0] - P[0]) + n[1] * (eye[1] - P[1]) + n[2] * (eye[2] - P[2]) <= 0) acc.normalBackfacing++;
    // motion vs reprojection (static scene)
    const q = project(pvp, P[0], P[1], P[2]);
    const [ex, ey] = ndcToPixels(B.motion[2 * i] - (nx - q[0]), B.motion[2 * i + 1] - (ny - q[1]), W, H);
    acc.motionErrPx.push(Math.hypot(ex, ey));
    const pvz = xform(cam.prevView, P[0], P[1], P[2])[2];
    if (hasMZ) {
      const e = Math.abs(B.motion_z[i] - (pvz - vzP));
      acc.motionZErr.push(e);
      acc.motionZRel.push(e / Math.max(Math.abs(vzP), 1e-6));
    }
    // history consistency: follow motion back into the previous frame's viewz
    if (prev && !fr.reset) {
      const [mx, my] = ndcToPixels(B.motion[2 * i], B.motion[2 * i + 1], W, H);
      const pjit = m.frames[f - 1].camera.jitter ?? [0, 0];
      // previous sample position in pixels -> previous texel space (centres at +0.5, minus prev jitter)
      const sx = px + 0.5 + jit[0] - mx - 0.5 - pjit[0];
      const sy = py + 0.5 + jit[1] - my - 0.5 - pjit[1];
      const x0 = Math.floor(sx), y0 = Math.floor(sy);
      if (x0 >= 0 && y0 >= 0 && x0 + 1 < W && y0 + 1 < H) {
        const fx = sx - x0, fy = sy - y0;
        const taps = [[x0, y0, (1 - fx) * (1 - fy)], [x0 + 1, y0, fx * (1 - fy)], [x0, y0 + 1, (1 - fx) * fy], [x0 + 1, y0 + 1, fx * fy]];
        let z = 0, okTaps = true;
        for (const [tx, ty, w] of taps) {
          const k = ty * W + tx;
          const pd = prev.depth[k];
          if (rev ? pd <= 0 : pd >= 1) { okTaps = false; break; }
          z += w * prev.viewz[k];
        }
        if (okTaps) {
          const expected = hasMZ ? vz + B.motion_z[i] : pvz;
          acc.hist.tested++;
          if (Math.abs(z - expected) <= 0.01 * Math.abs(expected)) acc.hist.ok++;
        }
      }
    }
  }
  prev = { depth: B.depth, viewz: B.viewz };
}

// ---- verdicts ---------------------------------------------------------------------------
const q = (xs, p) => { if (!xs.length) return NaN; const s = Float64Array.from(xs).sort(); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const r4 = (x) => +x.toPrecision(4);

check('finite', !Object.keys(acc.nonFinite).length, { nonFinite: acc.nonFinite });
check('ranges', !Object.keys(acc.rangeViolations).length, { violations: acc.rangeViolations }, 'warn');
check('viewzNegativeInFront', acc.viewzPositive === 0, { scored: acc.scored, positive: acc.viewzPositive, beyondFar: acc.viewzBeyondFar });
check('normalsUnit', acc.normalNotUnit <= 0.001 * acc.scored, { notUnit: acc.normalNotUnit, skyNonZero: acc.skyNormalNonZero });
check('normalsFaceCamera', acc.normalBackfacing <= 0.01 * acc.motionErrPx.length, { backfacing: acc.normalBackfacing, tested: acc.motionErrPx.length });
check('depthMatchesViewz', acc.depthViewzRelErrMax < 1e-2, { maxRelErr: r4(acc.depthViewzRelErrMax) });
check('cameraContinuity', !acc.camMismatch.length, { mismatches: acc.camMismatch.slice(0, 5) });
const me = acc.motionErrPx;
const motionDetail = { meanPx: r4(avg(me)), p99Px: r4(q(me, 0.99)), maxPx: r4(q(me, 1)), over0_1px: me.filter((e) => e > 0.1).length, tested: me.length };
check('motionReprojection', m.static ? motionDetail.p99Px < 0.05 : true, { static: !!m.static, ...motionDetail }, m.static ? 'error' : 'warn');
if (hasMZ) {
  const zd = { meanAbs: r4(avg(acc.motionZErr)), maxAbs: r4(q(acc.motionZErr, 1)), p99Rel: r4(q(acc.motionZRel, 0.99)) };
  check('motionZReprojection', m.static ? zd.p99Rel < 1e-3 : true, { static: !!m.static, ...zd }, m.static ? 'error' : 'warn');
}
const hf = acc.hist.tested ? acc.hist.ok / acc.hist.tested : NaN;
if (acc.hist.tested) {
  const det = { consistentFraction: r4(hf), tested: acc.hist.tested, usedMotionZ: hasMZ };
  if (hf < 0.5) check('historyConsistency', false, det);
  else check('historyConsistency', hf >= 0.9, det, 'warn');
}
report.stats = { width: W, height: H, frames: m.frames.length, stride: STRIDE, scoredPixels: acc.scored, skyPixels: acc.sky };
finish();

function finish() {
  const ok = !report.errors.length;
  report.ok = ok;
  if (opt('json')) writeFileSync(opt('json'), JSON.stringify(report, null, 1));
  if (!QUIET) {
    console.log(`capture ${dir}`);
    for (const [k, v] of Object.entries(report.checks)) {
      const { ok: c, ...rest } = v;
      console.log(`  ${c ? 'ok  ' : 'FAIL'} ${k.padEnd(22)} ${JSON.stringify(rest)}`);
    }
    for (const w of report.warnings) console.log(`  warn ${w}`);
    for (const e of report.errors) console.log(`  ERROR ${e}`);
    console.log(ok ? 'VALID' : `INVALID (${report.errors.length} errors)`);
  }
  process.exit(ok ? 0 : 1);
}
