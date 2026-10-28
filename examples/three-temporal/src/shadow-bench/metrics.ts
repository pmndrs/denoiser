// Shadow bench metrics (pure, single-channel float images of w x h, row 0 = top). All values are clamped to [0, 1]
// first, as tools/rt-capture/compare.mjs does for its boil.
//
// Regions come from the ground truth g of the frame, over the static receivers (sky and the moving object excluded):
//   umbra     g <= 0.02       "is the shadow solid?": the region compare.mjs' boil never scores (it takes the static
//                             penumbra 0.02 < ref < 0.98 and the dynamic pixels only)
//   penumbra  0.02 < g < 0.98
//   lit       g >= 0.98
//   all       every static receiver
//   object    the moving object's own pixels (non-zero velocity in the frame, or in any frame of the burst: the
//             surface under the pixel changed), scored apart: its ground truth changes with the motion itself
// and, per checkpoint, each of umbra / penumbra split into .moving (the ground truth changed faster than movingRate per
// frame over the burst: the shadow moves over it; the knot's wall shadow at the default speed changes ~0.0005 / frame)
// and .static (the ground truth's samples repeat every frame, so a static pixel's ground truth is exactly constant).
//
// Per frame: rmse, bias (mean signed error; > 0 in the umbra = a grey, not solid, shadow), psnr, bad (fraction of
// pixels off by more than 0.05).
// Per checkpoint (burst x_c-2, x_c-1, x_c and the same frames of g):
//   boil     RMS of the second temporal difference x_c - 2 x_c-1 + x_c-2, / sqrt(6) (= per-frame noise sigma of a
//            temporally white signal; a linear change adds 0). compare.mjs' definition, static camera (no reprojection).
//   boilLow  the same after a masked Gaussian blur (blurSigma px): the low-frequency, blotchy part the eye reads as
//            "boiling" (per-pixel boil is dominated by fine grain, which the eye averages away).
//   tErr     RMS of (x_c - x_c-1) - (g_c - g_c-1): the frame-to-frame change that the true shadow motion does not
//            explain (includes lag: a shadow that trails its true motion).
//   flick2 / flick4  fraction of pixels whose DISPLAYED brightness (lit composite, ACES, sRGB, 0..255) changes by >= 2 / >= 4
//            levels between consecutive frames, mean over the burst's pairs. The sparse, strong flicker the eye catches:
//            the RMS measures above dilute it over every calm pixel (realtime-shadows' paused wide shot, 2026-10-28: ours
//            per-pixel boil +9 % over FFX, but >= 4-level flicker 9x FFX's).
// The ground truth's own boil / boilLow is reported as the noise floor (its samples are the same per pixel in every
// frame, so on static pixels it is ~0 and on moving ones it is the true motion's curvature).

export const UMBRA = 0.02, LIT = 0.98, BAD = 0.05;
export const REGIONS = ['all', 'umbra', 'penumbra', 'lit', 'object'] as const;
export const SPLIT_REGIONS = ['umbra.static', 'umbra.moving', 'penumbra.static', 'penumbra.moving'] as const;
export type RegionId = (typeof REGIONS)[number] | (typeof SPLIT_REGIONS)[number];

export interface FrameStats { n: number; rmse: number; bias: number; psnr: number; bad: number }
export interface TemporalStats { n: number; boil: number; boilLow: number; tErr: number; flick2?: number; flick4?: number }

const cl = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const clamp01 = (x: Float32Array) => { const o = new Float32Array(x.length); for (let i = 0; i < x.length; i++) o[i] = cl(x[i]); return o; };

/**
 * Region masks of one frame from its ground truth. `object`: 1 on the moving object's pixels (else none); with
 * `burst` (ground truths of the burst, oldest first), the moving / static split too (`movingRate`: per frame).
 */
export function regionMasks(g: Float32Array, recv: Uint8Array, object?: Uint8Array | null, burst?: Float32Array[], movingRate = 0.0005): Record<RegionId, Uint8Array> {
  const span = Math.max(1, (burst?.length ?? 1) - 1);
  const n = g.length;
  const m = Object.fromEntries([...REGIONS, ...SPLIT_REGIONS].map((k) => [k, new Uint8Array(n)])) as Record<RegionId, Uint8Array>;
  for (let i = 0; i < n; i++) {
    if (!recv[i]) continue;
    if (object?.[i]) { m.object[i] = 1; continue; }
    m.all[i] = 1;
    const v = g[i];
    const r = v <= UMBRA ? 'umbra' : v >= LIT ? 'lit' : 'penumbra';
    m[r][i] = 1;
    if (burst && r !== 'lit') {
      let lo = v, hi = v;
      for (const b of burst) { lo = Math.min(lo, b[i]); hi = Math.max(hi, b[i]); }
      m[`${r}.${(hi - lo) / span > movingRate ? 'moving' : 'static'}`][i] = 1;
    }
  }
  return m;
}

export function frameStats(x: Float32Array, g: Float32Array, mask: Uint8Array): FrameStats {
  let n = 0, se = 0, s = 0, bad = 0;
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    const e = cl(x[i]) - g[i];
    n++; se += e * e; s += e; if (Math.abs(e) > BAD) bad++;
  }
  const mse = n ? se / n : NaN;
  return { n, rmse: Math.sqrt(mse), bias: n ? s / n : NaN, psnr: n ? 10 * Math.log10(1 / Math.max(mse, 1e-12)) : NaN, bad: n ? bad / n : NaN };
}

/** Masked, normalized separable Gaussian (only receivers contribute and receive). */
export function blur(x: Float32Array, recv: Uint8Array, w: number, h: number, sigma: number): Float32Array {
  if (sigma <= 0) return clamp01(x);
  const r = Math.ceil(sigma * 3);
  const k = Array.from({ length: 2 * r + 1 }, (_, i) => Math.exp(-((i - r) ** 2) / (2 * sigma * sigma)));
  const tmpV = new Float32Array(x.length), tmpW = new Float32Array(x.length), out = new Float32Array(x.length);
  for (let y = 0; y < h; y++) {
    for (let px = 0; px < w; px++) {
      let sv = 0, sw = 0;
      for (let d = -r; d <= r; d++) {
        const xx = px + d;
        if (xx < 0 || xx >= w) continue;
        const j = y * w + xx;
        if (!recv[j]) continue;
        sv += k[d + r] * cl(x[j]); sw += k[d + r];
      }
      tmpV[y * w + px] = sv; tmpW[y * w + px] = sw;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let px = 0; px < w; px++) {
      const i = y * w + px;
      if (!recv[i]) continue;
      let sv = 0, sw = 0;
      for (let d = -r; d <= r; d++) {
        const yy = y + d;
        if (yy < 0 || yy >= h) continue;
        const j = yy * w + px;
        sv += k[d + r] * tmpV[j]; sw += k[d + r] * tmpW[j];
      }
      out[i] = sw > 0 ? sv / sw : 0;
    }
  }
  return out;
}

/** RMS second temporal difference / sqrt(6) over the mask (frames oldest first). */
function boilOf(x0: Float32Array, x1: Float32Array, x2: Float32Array, mask: Uint8Array): number {
  let n = 0, s = 0;
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    const b = cl(x2[i]) - 2 * cl(x1[i]) + cl(x0[i]);
    s += b * b; n++;
  }
  return n ? Math.sqrt(s / n / 6) : NaN;
}

function tErrOf(x1: Float32Array, x2: Float32Array, g1: Float32Array, g2: Float32Array, mask: Uint8Array): number {
  let n = 0, s = 0;
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    const d = (cl(x2[i]) - cl(x1[i])) - (g2[i] - g1[i]);
    s += d * d; n++;
  }
  return n ? Math.sqrt(s / n) : NaN;
}

/**
 * Temporal stats of one checkpoint per region. `xs` / `gs`: the burst, oldest first (the checkpoint last); `xsLow`:
 * the blurred burst (computed once per image by the caller, blur is the expensive part).
 */
export function temporalStats(xs: Float32Array[], xsLow: Float32Array[], gs: Float32Array[], masks: Record<RegionId, Uint8Array>): Record<RegionId, TemporalStats> {
  const L = xs.length;
  const out = {} as Record<RegionId, TemporalStats>;
  for (const [k, m] of Object.entries(masks) as [RegionId, Uint8Array][]) {
    let n = 0; for (let i = 0; i < m.length; i++) n += m[i];
    out[k] = {
      n,
      boil: L >= 3 ? boilOf(xs[L - 3], xs[L - 2], xs[L - 1], m) : NaN,
      boilLow: L >= 3 ? boilOf(xsLow[L - 3], xsLow[L - 2], xsLow[L - 1], m) : NaN,
      tErr: L >= 2 ? tErrOf(xs[L - 2], xs[L - 1], gs[L - 2], gs[L - 1], m) : NaN,
    };
  }
  return out;
}

/** flick2 / flick4 of a burst of displayed-brightness images (oldest first) per region. */
export function flickerStats(L: Float32Array[], masks: Record<RegionId, Uint8Array>): Record<RegionId, { flick2: number; flick4: number }> {
  const out = {} as Record<RegionId, { flick2: number; flick4: number }>;
  for (const [k, m] of Object.entries(masks) as [RegionId, Uint8Array][]) {
    let n = 0, a = 0, b = 0;
    for (let t = 1; t < L.length; t++) {
      const p = L[t - 1], c = L[t];
      for (let i = 0; i < m.length; i++) {
        if (!m[i]) continue;
        const d = Math.abs(c[i] - p[i]);
        n++; if (d >= 2) a++; if (d >= 4) b++;
      }
    }
    out[k] = { flick2: n ? a / n : NaN, flick4: n ? b / n : NaN };
  }
  return out;
}

/** Per-pixel standard deviation over time of the error x_t - g_t (the "boil map"): where the output wobbles around the truth. Running sums. */
export class ErrStd {
  private readonly s: Float64Array;
  private readonly s2: Float64Array;
  private t = 0;
  constructor(n: number) { this.s = new Float64Array(n); this.s2 = new Float64Array(n); }
  add(x: Float32Array, g: Float32Array) {
    for (let i = 0; i < x.length; i++) { const e = cl(x[i]) - g[i]; this.s[i] += e; this.s2[i] += e * e; }
    this.t++;
  }
  map(recv: Uint8Array): Float32Array {
    const o = new Float32Array(this.s.length);
    if (this.t < 2) return o;
    for (let i = 0; i < o.length; i++) {
      if (!recv[i]) continue;
      const m = this.s[i] / this.t;
      o[i] = Math.sqrt(Math.max(0, this.s2[i] / this.t - m * m));
    }
    return o;
  }
}

/** Mean of each numeric field over a list of records (NaN entries skipped). */
export function meanOf<T extends Record<string, number>>(rows: T[]): T {
  const out: Record<string, number> = {};
  const keys = rows.length ? Object.keys(rows[0]) : [];
  for (const k of keys) {
    const v = rows.map((r) => r[k]).filter((x) => Number.isFinite(x));
    out[k] = v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN;
  }
  return out as T;
}
