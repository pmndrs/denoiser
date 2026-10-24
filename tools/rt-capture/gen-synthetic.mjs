#!/usr/bin/env node
// Write a synthetic capture in CAPTURE-FORMAT v0 with analytic, *known* guides and exact
// references: an infinite textured ground plane (y = 0, cut off at 40 units: beyond is
// sky) under a moving camera. Everything is computed in float64 from the ray/plane hit:
// depth, viewz, normal, motion, motion_z are exact (to float32 rounding).
//
// Signals (all demodulated, references analytic, referenceSpp = 0):
//   diffuse     constant reference (0.7, 0.55, 0.4); noisy = ref · 2u (uniform, mean ref)
//   specular    smooth world-space pattern (catches reprojection mistakes in replay);
//               noisy = ref · Exp(1) (heavier tail, mean ref)
//   visibility  world-space soft stripes in [0,1] (lit, shadowed and penumbra regions);
//               noisy = Bernoulli(ref); occluder_dist > 0 where the sample is occluded
//
//   node tools/rt-capture/gen-synthetic.mjs [--name synthetic-plane] [--size 256 | --w 256 --h 256]
//        [--frames 8] [--seed 1] [--cut N] [--static-camera] [--jitter] [--no-motion-z]
//        [--break motion-y|motion-sign|viewz-sign|prev-view] [--out <captures dir>]
//
// --cut N: camera jumps at frame N (reset: true there). --jitter: Halton(2,3) sub-pixel
// jitter. --break: write a deliberately wrong capture (the validator must flag it).
import path from 'node:path';
import { rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { CAPTURES_DIR, frameDir, invert, lookAt, mul, perspective, project, sampleNdc, writeF32, xform } from './lib/capture.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i < 0 ? d : args[i + 1]; };
const flag = (k) => args.includes(`--${k}`);
const size = Number(opt('size', 256));
const W = Number(opt('w', size)), H = Number(opt('h', size));
const FRAMES = Number(opt('frames', 8));
const SEED = Number(opt('seed', 1)) >>> 0;
const CUT = opt('cut') !== undefined ? Number(opt('cut')) : -1;
const BREAK = opt('break');
const NAME = opt('name', BREAK ? `synthetic-broken-${BREAK}` : 'synthetic-plane');
const OUT = path.resolve(opt('out', CAPTURES_DIR));
const STATIC_CAM = flag('static-camera');
const JITTER = flag('jitter');
const MOTION_Z = !flag('no-motion-z');

const NEAR = 0.1, FAR = 100, FOVY = (50 * Math.PI) / 180, MAX_DIST = 40;

// ---- deterministic noise (integer hash; lowbias32 by C. Wellons, public domain) ---------
function hash(x) {
  x ^= x >>> 16; x = Math.imul(x, 0x7feb352d); x ^= x >>> 15; x = Math.imul(x, 0x846ca68b); x ^= x >>> 16;
  return x >>> 0;
}
const rand = (px, py, f, k) => (hash(hash(hash(hash(px + 0x9e37 * SEED) ^ py * 0x85ebca6b) ^ f * 0xc2b2ae35) ^ k * 0x27d4eb2f) + 0.5) / 4294967296; // (0,1)

// ---- camera path -----------------------------------------------------------------------
function cameraAt(f) {
  if (STATIC_CAM) f = 0;
  if (CUT >= 0 && f >= CUT) { // the other side, panning
    const t = f - CUT;
    return { eye: [3 - 0.12 * t, 1.6, -4 + 0.05 * t], target: [0.5 - 0.1 * t, 0, 1.5] };
  }
  // forward dolly + truck + slow yaw and a little rise: parallax, expansion, rotation
  return { eye: [-1 + 0.15 * f, 2 + 0.03 * f, 4 - 0.2 * f], target: [0.1 * f, 0, -2 - 0.1 * f] };
}
const halton = (i, b) => { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; };
const jitterAt = (f) => (JITTER ? [halton(f + 1, 2) - 0.5, halton(f + 1, 3) - 0.5] : [0, 0]);

function camera(f, reset) {
  const c = cameraAt(f);
  const p = reset ? c : cameraAt(f - 1);
  const proj = perspective(FOVY, W / H, NEAR, FAR);
  const view = lookAt(c.eye, c.target);
  let prevView = lookAt(p.eye, p.target);
  if (BREAK === 'prev-view') prevView = view;
  return { view, projection: proj, prevView, prevProjection: proj, jitter: jitterAt(f), near: NEAR, far: FAR, position: c.eye };
}

// ---- analytic plane textures (world x, z) ------------------------------------------------
const DIFF_REF = [0.7, 0.55, 0.4];
const specRef = (x, z) => {
  const b = (ph) => 0.9 + 0.75 * Math.sin(1.3 * x + 0.4 + ph) * Math.sin(1.1 * z + 0.7 * ph);
  return [b(0), b(0.8), b(1.6)]; // in [0.15, 1.65]
};
const visRef = (x, z) => Math.min(1, Math.max(0, 0.5 + 1.5 * Math.sin(0.9 * x + 0.6 * z)));
const roughAt = (x, z) => 0.5 + 0.4 * Math.sin(0.7 * x) * Math.cos(0.5 * z);
const albedoAt = (x, z) => ((Math.floor(x) + Math.floor(z)) & 1 ? [0.75, 0.7, 0.6] : [0.25, 0.3, 0.35]);

// ---- generate --------------------------------------------------------------------------
const dir = path.join(OUT, NAME);
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });

const bufNames = ['depth', 'viewz', 'normal', 'roughness', 'motion', ...(MOTION_Z ? ['motion_z'] : []), 'albedo', 'f0',
  'diffuse', 'diffuse_hitt', 'diffuse_ref', 'specular', 'specular_hitt', 'specular_ref',
  'visibility', 'occluder_dist', 'visibility_ref'];
const CH = { depth: 1, viewz: 1, normal: 3, roughness: 1, motion: 2, motion_z: 1, albedo: 3, f0: 3, diffuse: 3, diffuse_hitt: 1, diffuse_ref: 3, specular: 3, specular_hitt: 1, specular_ref: 3, visibility: 1, occluder_dist: 1, visibility_ref: 1 };

const frames = [];
const t0 = Date.now();
for (let f = 0; f < FRAMES; f++) {
  const reset = f === 0 || f === CUT;
  const cam = camera(f, reset);
  const vp = mul(cam.projection, cam.view);
  const ivp = invert(vp);
  const pvp = mul(cam.prevProjection, cam.prevView);
  const b = Object.fromEntries(bufNames.map((n) => [n, new Float32Array(W * H * CH[n])]));
  const eye = cam.position;
  for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) {
    const i = py * W + px;
    const [nx, ny] = sampleNdc(px, py, W, H, cam.jitter);
    // primary ray through the sample position
    const pf = project(ivp, nx, ny, 1);
    const pn = project(ivp, nx, ny, 0);
    const d = [pf[0] - pn[0], pf[1] - pn[1], pf[2] - pn[2]];
    const t = d[1] < 0 ? -eye[1] / d[1] : -1; // eye + t·d hits y = 0 (d not normalized)
    const len = Math.hypot(...d);
    const hit = t > 0 && t * len < MAX_DIST;
    if (!hit) {
      // sky: depth = far value, viewz = -far, motion = far-plane point reprojected, rest 0
      b.depth[i] = 1;
      b.viewz[i] = -FAR;
      const q = project(pvp, pf[0], pf[1], pf[2]);
      b.motion[2 * i] = nx - q[0];
      b.motion[2 * i + 1] = ny - q[1];
      continue;
    }
    const P = [eye[0] + t * d[0], 0, eye[2] + t * d[2]];
    const clip = project(vp, P[0], P[1], P[2]);
    const vz = xform(cam.view, P[0], P[1], P[2])[2];
    const pvz = xform(cam.prevView, P[0], P[1], P[2])[2];
    const q = project(pvp, P[0], P[1], P[2]);
    b.depth[i] = clip[2];
    b.viewz[i] = BREAK === 'viewz-sign' ? -vz : vz;
    b.normal[3 * i + 1] = 1;
    let mx = nx - q[0], my = ny - q[1];
    if (BREAK === 'motion-y') my = -my;
    if (BREAK === 'motion-sign') { mx = -mx; my = -my; }
    b.motion[2 * i] = mx;
    b.motion[2 * i + 1] = my;
    if (MOTION_Z) b.motion_z[i] = pvz - vz;
    b.roughness[i] = roughAt(P[0], P[2]);
    b.albedo.set(albedoAt(P[0], P[2]), 3 * i);
    b.f0.set([0.04, 0.04, 0.04], 3 * i);
    // diffuse: constant reference, uniform noise
    const u0 = rand(px, py, f, 0);
    for (let c = 0; c < 3; c++) { b.diffuse_ref[3 * i + c] = DIFF_REF[c]; b.diffuse[3 * i + c] = DIFF_REF[c] * 2 * u0; }
    b.diffuse_hitt[i] = 0.5 + 2 * rand(px, py, f, 1);
    // specular: world-space pattern, exponential noise
    const sr = specRef(P[0], P[2]);
    const e = -Math.log(rand(px, py, f, 2));
    for (let c = 0; c < 3; c++) { b.specular_ref[3 * i + c] = sr[c]; b.specular[3 * i + c] = sr[c] * e; }
    b.specular_hitt[i] = 1 + rand(px, py, f, 3);
    // shadow: Bernoulli visibility around a soft-stripe reference
    const vr = visRef(P[0], P[2]);
    const lit = rand(px, py, f, 4) < vr;
    b.visibility_ref[i] = vr;
    b.visibility[i] = lit ? 1 : 0;
    b.occluder_dist[i] = lit ? 0 : 0.2 + 2 * rand(px, py, f, 5);
  }
  for (const n of bufNames) writeF32(path.join(dir, frameDir(f), `${n}.f32`), b[n]);
  frames.push({ index: f, reset, camera: cam });
}

const manifest = {
  version: 0,
  scene: 'synthetic-plane',
  generator: `tools/rt-capture/gen-synthetic.mjs ${args.join(' ')}`.trim(),
  width: W, height: H,
  reversedDepth: false,
  static: true,
  demodulation: { diffuse: 'albedo', specular: 'karis2014-envbrdf-approx' },
  lights: [{ id: 'key', type: 'sphere', position: [2, 6, 1], radius: 0.5, shadow: true }],
  buffers: bufNames.map((name) => ({ name, channels: CH[name] })),
  referenceSpp: 0,
  frames: frames.map((fr) => ({
    index: fr.index, reset: fr.reset,
    camera: Object.fromEntries(Object.entries(fr.camera).map(([k, v]) => [k, Array.isArray(v) ? v.map(Number) : v])),
  })),
};
writeFileSync(path.join(dir, 'capture.json'), JSON.stringify(manifest, null, 1));
console.log(`wrote ${dir} (${W}x${H}, ${FRAMES} frames, ${bufNames.length} buffers${BREAK ? `, BROKEN: ${BREAK}` : ''}) in ${Date.now() - t0} ms`);
