// Scripted camera path (column-major matrices, WebGPU [0,1] depth, right-handed,
// -Z forward like three.js). 120 frames: an orbit + dolly, a hard cut at frame
// CUT to the other side of the scene, then a lateral truck/pan.
export type V3 = [number, number, number];

export const NEAR = 0.1;
export const FAR = 100;
export const FOVY = (50 * Math.PI) / 180;

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => { const l = Math.hypot(...a); return [a[0] / l, a[1] / l, a[2] / l]; };
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export function lookAt(eye: V3, target: V3, up: V3 = [0, 1, 0]): Float32Array {
  const z = norm(sub(eye, target));
  const x = norm(cross(up, z));
  const y = cross(z, x);
  return new Float32Array([
    x[0], y[0], z[0], 0,
    x[1], y[1], z[1], 0,
    x[2], y[2], z[2], 0,
    -dot(x, eye), -dot(y, eye), -dot(z, eye), 1,
  ]);
}

export function perspective(fovy: number, aspect: number, near: number, far: number): Float32Array {
  const f = 1 / Math.tan(fovy / 2);
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, far / (near - far), -1,
    0, 0, (near * far) / (near - far), 0,
  ]);
}

export function mul(a: Float32Array, b: Float32Array): Float32Array {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
    o[c * 4 + r] = s;
  }
  return o;
}

export function invert(m: Float32Array): Float32Array {
  // Gauss-Jordan in float64
  const a = Array.from({ length: 4 }, (_, r) => Array.from({ length: 8 }, (_, c) => (c < 4 ? m[c * 4 + r] : c - 4 === r ? 1 : 0)));
  for (let c = 0; c < 4; c++) {
    let p = c;
    for (let r = c + 1; r < 4; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
    [a[c], a[p]] = [a[p], a[c]];
    const d = a[c][c];
    for (let k = 0; k < 8; k++) a[c][k] /= d;
    for (let r = 0; r < 4; r++) if (r !== c) {
      const f = a[r][c];
      for (let k = 0; k < 8; k++) a[r][k] -= f * a[c][k];
    }
  }
  const o = new Float32Array(16);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) o[c * 4 + r] = a[r][c + 4];
  return o;
}

export const CUT = 60;

export function cameraAt(frame: number): { eye: V3; target: V3 } {
  if (frame < CUT) {
    const a = 0.35 + frame * 0.009;
    const r = 9.0 - frame * 0.02;
    return { eye: [Math.sin(a) * r, 3.2 + 0.4 * Math.sin(frame * 0.05), Math.cos(a) * r], target: [0, 0.8, 0] };
  }
  const t = frame - CUT;
  return { eye: [-6.8 + t * 0.045, 2.1, -5.2 + t * 0.03], target: [0.4 + t * 0.02, 0.6, 0.6] };
}

export interface CamState { view: Float32Array; proj: Float32Array; eye: V3 }

export function camState(frame: number, aspect: number): CamState {
  const { eye, target } = cameraAt(frame);
  return { view: lookAt(eye, target), proj: perspective(FOVY, aspect, NEAR, FAR), eye };
}
