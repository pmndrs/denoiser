// LDR-FLIP, CPU side, for sampled frames.
//
// Implements the LDR variant of ꟻLIP: Andersson, Nilsson, Akenine-Möller, Oskarsson,
// Åström, Fairchild, "FLIP: A Difference Evaluator for Alternating Images", Proc. ACM
// Comput. Graph. Interact. Tech. 3(2), HPG 2020. Written after NVIDIA's reference
// implementation (github.com/NVlabs/flip, BSD-3-Clause, Copyright (c) 2020-2024,
// NVIDIA CORPORATION & AFFILIATES), following its Python version's structure and
// constants:
//
//   color pipeline   linear RGB -> XYZ -> YCxCz; per-channel CSF filtering (sums of
//                    Gaussians, A / RG / BY parameters), back to linear RGB clamped
//                    to [0,1]; -> L*a*b* -> Hunt adjustment (a, b *= 0.01 L);
//                    HyAB distance ^ qc (0.7), redistributed with pc = 0.4,
//                    pt = 0.95 against cmax = HyAB(green, blue)^qc.
//   feature pipeline normalized achromatic Y (y / y_white); edge (1st derivative)
//                    and point (2nd derivative) Gaussian detectors with
//                    w = 0.082 deg, positive / negative weights normalized to +-1;
//                    dF = max(| |edge_r| - |edge_t| |, | |point_r| - |point_t| |),
//                    raised: (dF / sqrt 2) ^ qf (0.5).
//   final            FLIP = dE_c ^ (1 - dE_f), per pixel; we report the mean over
//                    receiver pixels.
//
// Deviations: the inputs here are already linear (the test bed's tonemapped
// x / (1 + x) values, or shadow visibility), so the sRGB decode step is skipped;
// borders are clamp-to-edge; separable convolutions (every kernel is a sum of
// separable Gaussians). Pixels per degree default to FLIP's standard viewing
// condition (0.7 m from a 0.7 m wide 3840-px monitor: ~67 ppd).
//
//   prepareFlip(rgb)          per-image work (filters, features), cacheable
//   flipMean(ref, test, mask) per-pair work

export const DEFAULT_PPD = (0.7 * 3840 / 0.7) * Math.PI / 180;

// sRGB primaries / D65 (linear RGB -> XYZ), as in the FLIP reference
const M = [
  [10135552 / 24577794, 8788810 / 24577794, 4435075 / 24577794],
  [2613072 / 12288897, 8788810 / 12288897, 887015 / 12288897],
  [1425312 / 73733382, 8788810 / 73733382, 70074185 / 73733382],
];
const MI = invert3(M);
const WHITE = [M[0][0] + M[0][1] + M[0][2], M[1][0] + M[1][1] + M[1][2], M[2][0] + M[2][1] + M[2][2]];

function invert3(m: number[][]): number[][] {
  const [a, b, c] = m[0], [d, e, f] = m[1], [g, h, i] = m[2];
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [
    [A / det, -(b * i - c * h) / det, (b * f - c * e) / det],
    [B / det, (a * i - c * g) / det, -(a * f - c * d) / det],
    [C / det, -(a * h - b * g) / det, (a * e - b * d) / det],
  ];
}

const labF = (t: number) => { const d = 6 / 29; return t > d * d * d ? Math.cbrt(t) : t / (3 * d * d) + 4 / 29; };

function linrgbToLab(r: number, g: number, b: number, out: Float32Array, o: number) {
  const x = (M[0][0] * r + M[0][1] * g + M[0][2] * b) / WHITE[0];
  const y = (M[1][0] * r + M[1][1] * g + M[1][2] * b) / WHITE[1];
  const z = (M[2][0] * r + M[2][1] * g + M[2][2] * b) / WHITE[2];
  const fx = labF(x), fy = labF(y), fz = labF(z);
  const L = 116 * fy - 16;
  out[o] = L;
  // Hunt adjustment
  out[o + 1] = 0.01 * L * 500 * (fx - fy);
  out[o + 2] = 0.01 * L * 200 * (fy - fz);
}

/** 1D Gaussian taps exp(-pi^2 x^2 / b) * sqrt(pi / b) on [-r, r] (deltaX = 1/ppd) */
function csfTaps(b: number, r: number, ppd: number) {
  const t = new Float32Array(2 * r + 1);
  for (let i = -r; i <= r; i++) { const x = i / ppd; t[i + r] = Math.exp(-Math.PI * Math.PI * x * x / b); }
  return t;
}

function convolveSep(src: Float32Array, W: number, H: number, kx: Float32Array, ky: Float32Array, tmp: Float32Array, dst: Float32Array) {
  const rx = (kx.length - 1) >> 1, ry = (ky.length - 1) >> 1;
  for (let y = 0; y < H; y++) {
    const row = y * W;
    for (let x = 0; x < W; x++) {
      let s = 0;
      for (let k = -rx; k <= rx; k++) {
        let xx = x + k; xx = xx < 0 ? 0 : xx >= W ? W - 1 : xx;
        s += kx[k + rx] * src[row + xx];
      }
      tmp[row + x] = s;
    }
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let s = 0;
      for (let k = -ry; k <= ry; k++) {
        let yy = y + k; yy = yy < 0 ? 0 : yy >= H ? H - 1 : yy;
        s += ky[k + ry] * tmp[yy * W + x];
      }
      dst[y * W + x] = s;
    }
  }
}

interface Kernels {
  csf: { a: Float32Array; rg: Float32Array; by1: Float32Array; by2: Float32Array; wA: number; wRG: number; wBY1: number; wBY2: number };
  /** raw Gaussian factor and the derivative factors, normalized so that the 2D kernel
   * h(x) g(y)'s positive weights sum to 1 and its negative weights to -1 */
  gauss: Float32Array; edge: Float32Array; point: Float32Array;
}
const kernelCache = new Map<number, Kernels>();

function kernels(ppd: number): Kernels {
  const hit = kernelCache.get(ppd);
  if (hit) return hit;
  // CSF parameters (a1, b1, a2, b2) per channel; radius from the widest one
  const P = { A: [1, 0.0047, 0, 1e-5], RG: [1, 0.0053, 0, 1e-5], BY: [34.1, 0.04, 13.5, 0.025] };
  const maxB = Math.max(0.0047, 1e-5, 0.0053, 1e-5, 0.04, 0.025);
  const r = Math.ceil(3 * Math.sqrt(maxB / (2 * Math.PI * Math.PI)) * ppd);
  // 2D kernel = sum_k a_k sqrt(pi/b_k) g_k(x) g_k(y), normalized to sum 1 over the grid
  const term = (a: number, b: number) => {
    const t = csfTaps(b, r, ppd);
    const s = t.reduce((p, v) => p + v, 0);
    return { t, w2d: a * Math.sqrt(Math.PI / b) * s * s, c: a * Math.sqrt(Math.PI / b) };
  };
  const tA = term(P.A[0], P.A[1]);
  const tRG = term(P.RG[0], P.RG[1]);
  const tB1 = term(P.BY[0], P.BY[1]), tB2 = term(P.BY[2], P.BY[3]);
  const sumBY = tB1.w2d + tB2.w2d;
  // A and RG have a2 = 0 (their second term vanishes): one normalized Gaussian each
  const normalize1 = (t: Float32Array) => { const s = t.reduce((p, v) => p + v, 0); return t.map((v) => v / s); };

  // feature detectors
  const w = 0.082;
  const sd = 0.5 * w * ppd;
  const rf = Math.ceil(3 * sd);
  const gauss = new Float32Array(2 * rf + 1), edge = new Float32Array(2 * rf + 1), point = new Float32Array(2 * rf + 1);
  for (let i = -rf; i <= rf; i++) {
    const g = Math.exp(-(i * i) / (2 * sd * sd));
    gauss[i + rf] = g;
    edge[i + rf] = -i * g;
    point[i + rf] = (i * i / (sd * sd) - 1) * g;
  }
  const gs = gauss.reduce((p, v) => p + v, 0);
  // 2D sums of positive / negative weights: (sum over x of the positive part) * (sum of g over y)
  // (the sign of a 2D weight h(x) g(y) is the sign of h(x), so normalizing h's
  // positive / negative taps by the 2D sums is exact and keeps the kernel separable)
  const pos = (k: Float32Array) => k.reduce((p, v) => p + (v > 0 ? v : 0), 0) * gs;
  const neg = (k: Float32Array) => -k.reduce((p, v) => p + (v < 0 ? v : 0), 0) * gs;
  const norm2d = (k: Float32Array) => { const P = pos(k), Nn = neg(k); return k.map((v) => (v > 0 ? v / P : v / Nn)); };
  const K: Kernels = {
    csf: {
      a: normalize1(tA.t), rg: normalize1(tRG.t), by1: tB1.t, by2: tB2.t,
      wA: 1, wRG: 1, wBY1: tB1.c / sumBY, wBY2: tB2.c / sumBY,
    },
    gauss, edge: norm2d(edge), point: norm2d(point),
  };
  kernelCache.set(ppd, K);
  return K;
}

export interface FlipPrepared {
  W: number; H: number;
  /** Hunt-adjusted L*a*b* of the CSF-filtered image, 3 floats / px */
  lab: Float32Array;
  /** |edge| and |point| feature magnitudes */
  edge: Float32Array;
  point: Float32Array;
}

/** unpack the GPU LDR buffer (3 x 10 bit sqrt-encoded + receiver bit) */
export function unpackLdr(p: Uint32Array, W: number, H: number) {
  const rgb = new Float32Array(W * H * 3);
  const mask = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const v = p[i];
    for (let c = 0; c < 3; c++) { const q = ((v >>> (10 * c)) & 1023) / 1023; rgb[3 * i + c] = q * q; }
    mask[i] = (v >>> 30) & 1;
  }
  return { rgb, mask };
}

/** per-image FLIP work: CSF-filtered Hunt-adjusted Lab and feature magnitudes */
export function prepareFlip(rgb: Float32Array, W: number, H: number, ppd = DEFAULT_PPD): FlipPrepared {
  const K = kernels(ppd);
  const N = W * H;
  // linear RGB -> YCxCz
  const Y = new Float32Array(N), Cx = new Float32Array(N), Cz = new Float32Array(N), yN = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const r = rgb[3 * i], g = rgb[3 * i + 1], b = rgb[3 * i + 2];
    const x = (M[0][0] * r + M[0][1] * g + M[0][2] * b) / WHITE[0];
    const y = (M[1][0] * r + M[1][1] * g + M[1][2] * b) / WHITE[1];
    const z = (M[2][0] * r + M[2][1] * g + M[2][2] * b) / WHITE[2];
    Y[i] = 116 * y - 16; Cx[i] = 500 * (x - y); Cz[i] = 200 * (y - z);
    yN[i] = y; // = (Y + 16) / 116
  }
  const tmp = new Float32Array(N);
  const fY = new Float32Array(N), fCx = new Float32Array(N), fCz = new Float32Array(N), t2 = new Float32Array(N);
  convolveSep(Y, W, H, K.csf.a, K.csf.a, tmp, fY);
  convolveSep(Cx, W, H, K.csf.rg, K.csf.rg, tmp, fCx);
  convolveSep(Cz, W, H, K.csf.by1, K.csf.by1, tmp, fCz);
  convolveSep(Cz, W, H, K.csf.by2, K.csf.by2, tmp, t2);
  const lab = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const cz = K.csf.wBY1 * fCz[i] + K.csf.wBY2 * t2[i];
    // YCxCz -> XYZ -> linear RGB, clamp to [0,1]
    const y = (fY[i] + 16) / 116;
    const x = fCx[i] / 500 + y;
    const z = y - cz / 200;
    const X = x * WHITE[0], Yv = y * WHITE[1], Z = z * WHITE[2];
    const cl = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
    const r = cl(MI[0][0] * X + MI[0][1] * Yv + MI[0][2] * Z);
    const g = cl(MI[1][0] * X + MI[1][1] * Yv + MI[1][2] * Z);
    const b = cl(MI[2][0] * X + MI[2][1] * Yv + MI[2][2] * Z);
    linrgbToLab(r, g, b, lab, 3 * i);
  }
  // features on normalized achromatic y
  const ex = new Float32Array(N), ey = new Float32Array(N), px = new Float32Array(N), py = new Float32Array(N);
  convolveSep(yN, W, H, K.edge, K.gauss, tmp, ex);
  convolveSep(yN, W, H, K.gauss, K.edge, tmp, ey);
  convolveSep(yN, W, H, K.point, K.gauss, tmp, px);
  convolveSep(yN, W, H, K.gauss, K.point, tmp, py);
  const edge = new Float32Array(N), point = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    edge[i] = Math.hypot(ex[i], ey[i]);
    point[i] = Math.hypot(px[i], py[i]);
  }
  return { W, H, lab, edge, point };
}

const QC = 0.7, QF = 0.5, PC = 0.4, PT = 0.95;
let CMAX = -1;
function cmax() {
  if (CMAX < 0) {
    const g = new Float32Array(3), b = new Float32Array(3);
    linrgbToLab(0, 1, 0, g, 0);
    linrgbToLab(0, 0, 1, b, 0);
    CMAX = Math.pow(Math.abs(g[0] - b[0]) + Math.hypot(g[1] - b[1], g[2] - b[2]), QC);
  }
  return CMAX;
}

/** mean LDR-FLIP over pixels where mask != 0 (all pixels if no mask) */
export function flipMean(ref: FlipPrepared, test: FlipPrepared, mask?: Uint8Array): number {
  const N = ref.W * ref.H;
  const cm = cmax(), pccmax = PC * cm;
  let sum = 0, n = 0;
  for (let i = 0; i < N; i++) {
    if (mask && !mask[i]) continue;
    const dL = ref.lab[3 * i] - test.lab[3 * i];
    const da = ref.lab[3 * i + 1] - test.lab[3 * i + 1];
    const db = ref.lab[3 * i + 2] - test.lab[3 * i + 2];
    const hy = Math.pow(Math.abs(dL) + Math.sqrt(da * da + db * db), QC);
    const dc = hy < pccmax ? (PT / pccmax) * hy : PT + ((hy - pccmax) / (cm - pccmax)) * (1 - PT);
    const df = Math.pow(Math.max(Math.abs(ref.edge[i] - test.edge[i]), Math.abs(ref.point[i] - test.point[i])) / Math.SQRT2, QF);
    sum += Math.pow(dc, 1 - df);
    n++;
  }
  return n ? sum / n : NaN;
}
