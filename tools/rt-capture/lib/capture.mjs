// Shared Node helpers for capture format v0 / v1 (docs/research/rt-denoiser/CAPTURE-FORMAT.md):
// paths, manifest + raw f32 I/O, column-major mat4 math, the pixel <-> NDC convention
// and the replay metrics. No dependencies.
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const TOOL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = process.env.RT_CAPTURE_DIR ? path.resolve(process.env.RT_CAPTURE_DIR) : TOOL_DIR;
export const CAPTURES_DIR = path.join(DATA_DIR, 'captures');
export const OUTPUTS_DIR = path.join(DATA_DIR, 'outputs');

/** Known v0 buffers and their channel counts. */
export const BUFFER_CHANNELS = {
  depth: 1, viewz: 1, normal: 3, roughness: 1, motion: 2, motion_z: 1,
  albedo: 3, f0: 3,
  diffuse: 3, diffuse_hitt: 1, diffuse_ref: 3,
  specular: 3, specular_hitt: 1, specular_ref: 3,
  visibility: 1, occluder_dist: 1, visibility_ref: 1,
  // v1 (SPEC v0.3 M7-4, §7.10.4)
  normal_geom: 3, diffuse_dir: 3, specular_dir: 3, diffuse_sh_ref: 6, specular_sh_ref: 6,
  transmittance: 3, translucent_dist: 1, shadow_rgb_ref: 3,
};
/** Buffers that make a capture version 1. */
export const V1_BUFFERS = ['normal_geom', 'diffuse_dir', 'specular_dir', 'diffuse_sh_ref', 'specular_sh_ref', 'transmittance', 'translucent_dist', 'shadow_rgb_ref'];
/** Noisy signals a denoiser replaces (output name = input name). */
export const SIGNALS = ['diffuse', 'specular', 'visibility'];
/** v1 signals (output `<name>.f32`, 3 ch): the buffers they need and the reference they are scored against. */
export const V1_SIGNALS = {
  'sh-diffuse': { needs: ['diffuse', 'diffuse_dir'], reference: 'diffuse_ref' },
  'sh-specular': { needs: ['specular', 'specular_dir'], reference: 'specular_ref' },
  'shadow-rgb': { needs: ['visibility', 'transmittance'], reference: 'shadow_rgb_ref' },
};

export const frameDir = (i) => `frame_${String(i).padStart(4, '0')}`;

/** Resolve a capture argument: a path to a directory, or a name under captures/. */
export function resolveCapture(arg, root = CAPTURES_DIR) {
  if (!arg) throw new Error('missing capture name or path');
  if (existsSync(path.join(arg, 'capture.json'))) return path.resolve(arg);
  const p = path.join(root, arg);
  if (existsSync(path.join(p, 'capture.json'))) return p;
  throw new Error(`no capture.json in ${arg} or ${p}`);
}

export function readManifest(dir) {
  return JSON.parse(readFileSync(path.join(dir, 'capture.json'), 'utf8'));
}

export function readF32(file) {
  const b = readFileSync(file);
  if (b.byteLength % 4) throw new Error(`${file}: size ${b.byteLength} is not a multiple of 4`);
  // copy into an aligned buffer (Buffer slices from the pool may be unaligned)
  const out = new Float32Array(b.byteLength / 4);
  new Uint8Array(out.buffer).set(b);
  return out;
}

export function writeF32(file, data) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, Buffer.from(data.buffer, data.byteOffset, data.byteLength));
}

export function readBuffer(dir, frame, name) {
  return readF32(path.join(dir, frameDir(frame), `${name}.f32`));
}

export const listDirs = (dir) => (existsSync(dir) ? readdirSync(dir).filter((n) => statSync(path.join(dir, n)).isDirectory()).sort() : []);

// ---- mat4 (column-major, float64 math) ----------------------------------------

export function mul(a, b) {
  const o = new Float64Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
    o[c * 4 + r] = s;
  }
  return o;
}

export function invert(m) {
  const a = Array.from({ length: 4 }, (_, r) => Array.from({ length: 8 }, (_, c) => (c < 4 ? m[c * 4 + r] : c - 4 === r ? 1 : 0)));
  for (let c = 0; c < 4; c++) {
    let p = c;
    for (let r = c + 1; r < 4; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
    [a[c], a[p]] = [a[p], a[c]];
    const d = a[c][c];
    if (d === 0) throw new Error('singular matrix');
    for (let k = 0; k < 8; k++) a[c][k] /= d;
    for (let r = 0; r < 4; r++) if (r !== c) {
      const f = a[r][c];
      for (let k = 0; k < 8; k++) a[r][k] -= f * a[c][k];
    }
  }
  const o = new Float64Array(16);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) o[c * 4 + r] = a[r][c + 4];
  return o;
}

/** m · (x, y, z, w) -> [x, y, z, w] */
export function xform(m, x, y, z, w = 1) {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12] * w,
    m[1] * x + m[5] * y + m[9] * z + m[13] * w,
    m[2] * x + m[6] * y + m[10] * z + m[14] * w,
    m[3] * x + m[7] * y + m[11] * z + m[15] * w,
  ];
}

/** Homogeneous transform with divide -> [x, y, z]. */
export function project(m, x, y, z) {
  const v = xform(m, x, y, z, 1);
  return [v[0] / v[3], v[1] / v[3], v[2] / v[3]];
}

export function lookAt(eye, target, up = [0, 1, 0]) {
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = (a) => { const l = Math.hypot(...a); return [a[0] / l, a[1] / l, a[2] / l]; };
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const zA = norm(sub(eye, target));
  const xA = norm(cross(up, zA));
  const yA = cross(zA, xA);
  return [
    xA[0], yA[0], zA[0], 0,
    xA[1], yA[1], zA[1], 0,
    xA[2], yA[2], zA[2], 0,
    -dot(xA, eye), -dot(yA, eye), -dot(zA, eye), 1,
  ];
}

/** WebGPU perspective (NDC z in [0,1], 0 = near), three.js view space (-z forward). */
export function perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2);
  return [
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, far / (near - far), -1,
    0, 0, (near * far) / (near - far), 0,
  ];
}

// ---- pixel <-> NDC (CAPTURE-FORMAT "Coordinate conventions") ---------------------

/** NDC of the pixel's sample position (centre + jitter in pixels, x right / y down). */
export function sampleNdc(px, py, W, H, jitter = [0, 0]) {
  return [((px + 0.5 + jitter[0]) / W) * 2 - 1, 1 - ((py + 0.5 + jitter[1]) / H) * 2];
}

/** NDC delta -> pixel delta (x right, y down). */
export const ndcToPixels = (dx, dy, W, H) => [dx * W * 0.5, -dy * H * 0.5];

export const isScored = (d) => d > 0 && d < 1;

// ---- metrics (CAPTURE-FORMAT "Metrics for replay outputs") ------------------------

const tonemap = (x, ch) => (ch === 1 ? Math.min(Math.max(x, 0), 1) : (x > 0 ? x / (1 + x) : 0));

/** Ceiling for the "capped" PSNR variants: per-frame dB clipped here before averaging
 * (CAPTURE-FORMAT.md "Metrics for replay outputs"). */
export const PSNR_CAP_DB = 60;

/**
 * Score one frame. `out`, `ref`: Float32Array with `ch` channels; `depth`: 1 ch.
 * `prevS`: Float32Array of the previous frame's signed error (NaN = not scored) or null.
 * `opts.clamp` (v1 shadow-rgb): rgb clamped to [0, 1] instead of Reinhard, penumbra = any channel of
 * the reference in (0.02, 0.98), bias over penumbra pixels (as for scalar shadows).
 * Returns the per-frame numbers plus `s` (this frame's signed error) for the next call.
 */
export function scoreFrame(out, ref, depth, ch, prevS, opts = {}) {
  if (opts.clamp) return scoreFrameClamp(out, ref, depth, ch, prevS);
  const n = depth.length;
  const s = new Float32Array(n).fill(NaN);
  let sse = 0, cnt = 0, bias = 0, biasCnt = 0, sseP = 0, cntP = 0, flick = 0, flickCnt = 0, nonFinite = 0;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < ch; c++) if (!Number.isFinite(out[i * ch + c])) nonFinite++;
    if (!isScored(depth[i])) continue;
    let e2 = 0, es = 0;
    for (let c = 0; c < ch; c++) {
      const o = out[i * ch + c];
      const e = (Number.isFinite(o) ? tonemap(o, ch) : 0) - tonemap(ref[i * ch + c], ch);
      e2 += e * e; es += e;
    }
    es /= ch;
    s[i] = es;
    sse += e2; cnt += ch;
    const pen = ch === 1 && ref[i] > 0.02 && ref[i] < 0.98;
    if (ch !== 1 || pen) { bias += es; biasCnt++; }
    if (pen) { sseP += e2; cntP++; }
    if (prevS && !Number.isNaN(prevS[i])) { flick += Math.abs(es - prevS[i]); flickCnt++; }
  }
  const psnr = (e, k) => (k ? 10 * Math.log10(1 / Math.max(e / k, 1e-12)) : NaN);
  return {
    psnr: psnr(sse, cnt),
    psnrPenumbra: ch === 1 ? psnr(sseP, cntP) : NaN,
    penumbraPixels: cntP,
    // raw sums for pooled PSNR (compare.mjs): squared error and value count (pixels x channels)
    sse, sseCount: cnt, ssePenumbra: sseP, ssePenumbraCount: cntP,
    bias: biasCnt ? bias / biasCnt : NaN,
    flicker: prevS && flickCnt ? flick / flickCnt : NaN,
    pixels: cnt / ch,
    nonFinite,
    s,
  };
}

function scoreFrameClamp(out, ref, depth, ch, prevS) {
  const n = depth.length;
  const s = new Float32Array(n).fill(NaN);
  const cl = (x) => Math.min(Math.max(x, 0), 1);
  let sse = 0, cnt = 0, bias = 0, biasCnt = 0, sseP = 0, cntP = 0, flick = 0, flickCnt = 0, nonFinite = 0;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < ch; c++) if (!Number.isFinite(out[i * ch + c])) nonFinite++;
    if (!isScored(depth[i])) continue;
    let e2 = 0, es = 0, pen = false;
    for (let c = 0; c < ch; c++) {
      const o = out[i * ch + c], r = ref[i * ch + c];
      const e = (Number.isFinite(o) ? cl(o) : 0) - cl(r);
      e2 += e * e; es += e;
      if (r > 0.02 && r < 0.98) pen = true;
    }
    es /= ch;
    s[i] = es;
    sse += e2; cnt += ch;
    if (pen) { bias += es; biasCnt++; sseP += e2; cntP += ch; }
    if (prevS && !Number.isNaN(prevS[i])) { flick += Math.abs(es - prevS[i]); flickCnt++; }
  }
  const psnr = (e, k) => (k ? 10 * Math.log10(1 / Math.max(e / k, 1e-12)) : NaN);
  return {
    psnr: psnr(sse, cnt), psnrPenumbra: psnr(sseP, cntP), penumbraPixels: cntP / ch,
    sse, sseCount: cnt, ssePenumbra: sseP, ssePenumbraCount: cntP,
    bias: biasCnt ? bias / biasCnt : NaN, flicker: prevS && flickCnt ? flick / flickCnt : NaN,
    pixels: cnt / ch, nonFinite, s,
  };
}

// ---- v1 helpers (CAPTURE-FORMAT v1 "Outputs and scoring") ------------------------------------

export const reinhard = (x) => (x > 0 ? x / (1 + x) : 0);
/** cos(5 deg): the bump mask is angle(normal, normal_geom) > 5 deg. */
export const BUMP_COS = Math.cos((5 * Math.PI) / 180);

/**
 * SPEC M7-8 guard + M7-9 diffuse resolve of one payload p6 = (a, b.x, b.y, b.z, Co, Cg) at the detail
 * normal nd, guide normal ng, guard k, sharpening s. Returns [r, g, b, trimmed (0/1), floored (0/1)].
 */
export function shResolve(p6, o, nd, ng, k = 1, s = 0) {
  const a = p6[o], bx = p6[o + 1], by = p6[o + 2], bz = p6[o + 3], co = p6[o + 4], cg = p6[o + 5];
  const yg = a + bx * ng[0] + by * ng[1] + bz * ng[2];
  const bl = Math.hypot(bx, by, bz);
  const f = Math.min(1, (k * Math.max(yg, 0)) / Math.max(bl, 1e-6));
  const px = bx * f, py = by * f, pz = bz * f;
  const ap = yg - (px * ng[0] + py * ng[1] + pz * ng[2]);
  const rco = Math.min(Math.max(co / Math.max(yg, 1e-4), -2), 2), rcg = Math.min(Math.max(cg / Math.max(yg, 1e-4), -2), 2);
  const yd = ap + px * nd[0] + py * nd[1] + pz * nd[2];
  let y = Math.max(0, yd);
  const pl = bl * f;
  if (s > 0 && pl > 1e-8) {
    const I = 2 * pl, dx = px / pl, dy = py / pl, dz = pz / pl, am = Math.max(ap - 0.5 * pl, 0);
    const ysd = am + I * Math.max(0, nd[0] * dx + nd[1] * dy + nd[2] * dz);
    const ysg = am + I * Math.max(0, ng[0] * dx + ng[1] * dy + ng[2] * dz);
    y = y + (ysd * yg / Math.max(ysg, 1e-4) - y) * s;
  }
  const c1 = y * rco, c2 = y * rcg;
  return [Math.max(y + c1 - c2, 0), Math.max(y + c2, 0), Math.max(y - c1 - c2, 0), f < 1 ? 1 : 0, yd < 0 ? 1 : 0];
}

/** Gaussian sigma = 2 px, radius 6: the M7-13 detail-band low-pass (same taps as the live test bed). */
const BAND_W = Array.from({ length: 13 }, (_, i) => Math.exp(-((i - 6) ** 2) / 8));
/**
 * Masked, normalized separable Gaussian of a 3-channel image over the pixels with mask[i] = 1:
 * G(x) = sum w m x / sum w m (the mask is folded into the inner sums, so it is exact in 2D).
 */
export function maskedBlur3(x, mask, W, H) {
  const tmp = new Float64Array(W * H * 4), out = new Float32Array(W * H * 3);
  for (let y = 0; y < H; y++) for (let px = 0; px < W; px++) {
    let s0 = 0, s1 = 0, s2 = 0, sw = 0;
    for (let k = -6; k <= 6; k++) {
      const q = px + k;
      if (q < 0 || q >= W) continue;
      const j = y * W + q;
      if (!mask[j]) continue;
      const w = BAND_W[k + 6];
      s0 += w * x[3 * j]; s1 += w * x[3 * j + 1]; s2 += w * x[3 * j + 2]; sw += w;
    }
    const i = y * W + px;
    tmp[4 * i] = s0; tmp[4 * i + 1] = s1; tmp[4 * i + 2] = s2; tmp[4 * i + 3] = sw;
  }
  for (let y = 0; y < H; y++) for (let px = 0; px < W; px++) {
    let s0 = 0, s1 = 0, s2 = 0, sw = 0;
    for (let k = -6; k <= 6; k++) {
      const q = y + k;
      if (q < 0 || q >= H) continue;
      const j = q * W + px, w = BAND_W[k + 6];
      s0 += w * tmp[4 * j]; s1 += w * tmp[4 * j + 1]; s2 += w * tmp[4 * j + 2]; sw += w * tmp[4 * j + 3];
    }
    const i = y * W + px, d = Math.max(sw, 1e-8);
    out[3 * i] = s0 / d; out[3 * i + 1] = s1 / d; out[3 * i + 2] = s2 / d;
  }
  return out;
}

export const mean = (xs) => {
  const v = xs.filter((x) => Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN;
};

/** Frames that count as "settled": at least `k` frames after the latest reset. */
export function settledMask(frames, k = 8) {
  let last = 0;
  return frames.map((f, i) => { if (f.reset || i === 0) last = i; return i - last >= k; });
}
