// Shared Node helpers for capture format v0 (docs/research/rt-denoiser/CAPTURE-FORMAT.md):
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
};
/** Noisy signals a denoiser replaces (output name = input name). */
export const SIGNALS = ['diffuse', 'specular', 'visibility'];

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
 * Returns the per-frame numbers plus `s` (this frame's signed error) for the next call.
 */
export function scoreFrame(out, ref, depth, ch, prevS) {
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

export const mean = (xs) => {
  const v = xs.filter((x) => Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN;
};

/** Frames that count as "settled": at least `k` frames after the latest reset. */
export function settledMask(frames, k = 8) {
  let last = 0;
  return frames.map((f, i) => { if (f.reset || i === 0) last = i; return i - last >= k; });
}
