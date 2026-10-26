// A-SVGF temporal gradients (anti-lag) for one or two signals per dispatch:
// per-stratum gradient samples, then an edge-aware a-trous reconstruction at
// stratum resolution; the temporal pass turns the result into a per-pixel
// alpha boost (svgf.ts `antilagLambda`).
//
// Sources (public; see docs/research/rt-denoiser/PROVENANCE.md):
// - Schied, Peters, Dachsbacher 2018, "Gradient Estimation for Real-Time
//   Adaptive Temporal Filtering" (A-SVGF), PACMCGIT 1(2) art. 24: sec. 3.1-3.3
//   gradient samples on 3x3 strata, delta = f_i(fwd) - f_{i-1}(old), luminance
//   only; sec. 3.4 reconstruction with a 5-level joint-bilateral a-trous at
//   stratum resolution (3x3 box), normalizer Delta = max(f_i, f_{i-1}) filtered
//   like delta; sec. 3.5 lambda = min(1, |delta| / Delta).
// - A-SVGF reference code (a_svgf.zip, BSD-3, Copyright (c) 2018 Christoph
//   Schied; see NOTICE): CreateGradientSamples.frag (per-stratum luminance
//   moments, (Delta, delta) layout), AtrousGradient.frag (weights: Gaussian
//   luminance term with sigma = 3 sqrt(g3x3(var)), depth term with the stored
//   depth derivative x offset; no normal term).
//
// Two sources for the gradient sample (option `antiLag`):
// - 'gradient': the renderer supplies forward-projected, re-shaded samples
//   (A-SVGF proper, needs RNG-seed reuse; see README for the texture layout).
// - 'auto' (our design, since most renderers can't re-shade old samples): the
//   stratum's mean noisy luminance this frame vs the mean of the reprojected
//   *temporally accumulated* luminance (pre-spatial-filter history). The noise
//   of the current mean is carried as var(delta) through the reconstruction and
//   subtracted (k sigma) before the ratio, so static noise doesn't read as change.
import { Bindings, type PassDef } from './bindings';
import { FRAME_WGSL, REPROJECT_WGSL } from './common';
import { PARAMS_STRUCT } from './svgf';


/**
 * v2 storage: one rgba32uint per stratum, 8 halves (f16 storage, f32 math):
 * x = (delta, Delta), y = (sigma(delta), 1 + kernel variance), z = (mean l, sigma l),
 * w = (z, |dz|). Standard deviations, not variances, so HDR luminance can't overflow
 * f16 (as SPEC S-2a). Halves the bandwidth of the two rgba32float textures of v1.
 */
export const PACK_WGSL = /* wgsl */ `
fn packG(g0: vec4f, g1: vec4f) -> vec4u {
  return vec4u(pack2x16float(g0.xy), pack2x16float(vec2f(sqrt(max(g0.z, 0.0)), g0.w)),
               pack2x16float(vec2f(g1.x, sqrt(max(g1.y, 0.0)))), pack2x16float(g1.zw));
}
// returns g0 = (delta, Delta, var(delta), 1 + v), g1 = (mean l, var l, z, |dz|)
fn unpackG0(u: vec4u) -> vec4f { let a = unpack2x16float(u.x); let b = unpack2x16float(u.y); return vec4f(a, b.x * b.x, b.y); }
fn unpackG1(u: vec4u) -> vec4f { let a = unpack2x16float(u.z); let b = unpack2x16float(u.w); return vec4f(a.x, a.y * a.y, b); }
`;

/** GradientVariant.chroma storage: rg32uint = (delta Co, delta Cg | var Co, var Cg as standard deviations). */
const PACK_C_WGSL = /* wgsl */ `
fn unpackC(u: vec4u) -> vec4f { let d = unpack2x16float(u.x); let sd = unpack2x16float(u.y); return vec4f(d, sd * sd); }
fn packC(c: vec4f) -> vec4u { return vec4u(pack2x16float(c.xy), pack2x16float(sqrt(max(c.zw, vec2f(0.0)))), 0u, 0u); }
`;

/** Stratum size (A-SVGF: 3x3 strata, <= 11 % of samples recycled). */
export const GRADIENT_DOWNSAMPLE = 3;

/** YCoCg chroma (Malvar & Sullivan 2003): Co = (R - B) / 2, Cg = (2G - R - B) / 4 (GradientVariant.chroma). */
const COCG_WGSL = /* wgsl */ `
fn cocg(c: vec3f) -> vec2f { return vec2f(0.5 * (c.r - c.b), 0.25 * (2.0 * c.g - c.r - c.b)); }
`;

/**
 * Optional 'auto' anti-lag variants (review target 3, docs/research/rt-denoiser/results/T3-light-changes.md; our design).
 * Every field at its default compiles exactly today's passes.
 * - chroma: A-SVGF works with "only the luminance of the temporal gradient" (S2 sec. 3.1, Eq. 2), so a light that changes
 *   colour at constant luminance never registers. With chroma, gradient_create also writes the stratum's YCoCg chroma
 *   change (delta Co, delta Cg) and the standard deviation of the current means (one rg32uint per stratum, 4 halves);
 *   the reconstruction filters them with the luminance weights (linear, like var(delta) in v2), and gradient_lambda
 *   adds max over Co, Cg of max(0, |delta_c| - k sigma_c) / Delta (Delta = the luminance normalizer of S2 Eq. 13-14).
 * - gain: lambda = min(1, gain x the v2 lambda) (S2 Eq. 14 is gain 1): a relative change of 1 / gain drops the history.
 *   One value per signal of the pass (baked into the code, so signals with different gains still share a pipeline).
 */
export interface GradientVariant { chroma?: boolean; gain?: number[] }

/**
 * v2 gradient samples (our design): one thread per 3x3 stratum and ONE reprojection,
 * at the stratum centre. The history mean over the stratum is the mean of the 9
 * bilinear history samples at the centre's reprojected position + (dx, dy): per axis
 * that is weights (1 - f, 1, 1, f) / 3 over 4 texels, i.e. exactly 2 bilinear taps
 * per axis (4 hardware-filtered samples in 2D). Assumes uniform motion inside the
 * stratum; strata whose centre reprojection is not fully valid or that touch sky get
 * no history (they are fresh history anyway). ~4x fewer loads than v1.
 */
export function gradientCreatePassV2(count: number, fromInput: boolean, gv: GradientVariant = {}): PassDef {
  const I = [...Array(count).keys()];
  const C = !!gv.chroma && !fromInput;
  const b = new Bindings();
  b.uniform('F', 'Frame');
  I.forEach((i) => b.uniform(`P${i}`, 'Params'));
  b.add('geoCur', 'texture_2d<u32>', 'i');
  b.add('geoPrev', 'texture_2d<u32>', 'i');
  b.add('geoGrad', 'texture_2d<u32>', 'i');
  b.add('motionTex', 'texture_2d<f32>', 'f');
  b.add('motionZTex', 'texture_2d<f32>', 'f');
  b.add('smp', 'sampler', 's');
  I.forEach((i) => {
    b.add(`input${i}`, 'texture_2d<f32>', 'f');
    b.add(`accumPrev${i}`, 'texture_2d<f32>', 'F');
    b.add(`gradInput${i}`, 'texture_2d<f32>', 'f');
    b.add(`outG${i}`, 'texture_storage_2d<rgba32uint, write>', 'rgba32uint');   // packG()
    if (C) b.add(`outC${i}`, 'texture_storage_2d<rg32uint, write>', 'rg32uint');   // (delta Co, delta Cg | sigma Co, sigma Cg)
  });
  const taps = [...Array(9).keys()].map((k) => [k % 3, Math.floor(k / 3)]);
  const code = /* wgsl */ `
${FRAME_WGSL}
${PARAMS_STRUCT}
${b.wgsl}
${REPROJECT_WGSL}
${PACK_WGSL}${C ? COCG_WGSL : ''}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let s = vec2i(gid.xy);
  if (s.x >= P0.gradDims.x || s.y >= P0.gradDims.y) { return; }
  let p0 = s * 3;
  ${I.map((i) => `var sL${i} = 0.0; var sL2${i} = 0.0;`).join(' ')}${C ? `
  ${I.map((i) => `var sC${i} = vec2f(0.0); var sC2${i} = vec2f(0.0);`).join(' ')}` : ''}
  var cnt = 0.0;
  var zAny = 0.0; var pAny = p0;
  ${taps.map(([x, y]) => /* wgsl */ `
  {
    let q = p0 + vec2i(${x}, ${y});
    let qc = clampPix(q);
    let z = geoTap(geoCur, qc).z;
    let ok = inside(q) && z > 0.0;
    let w = select(0.0, 1.0, ok);
    cnt += w;
    if (ok && (zAny == 0.0 || ${x === 1 && y === 1 ? 'true' : 'false'})) { zAny = z; pAny = qc; }
    ${I.map((i) => (C ? `{ let c = max(textureLoad(input${i}, qc, 0).rgb, vec3f(0.0)); let l = luma(c) * w; sL${i} += l; sL2${i} += l * l;
      let co = cocg(c) * w; sC${i} += co; sC2${i} += co * co; }` : `{ let l = luma(max(textureLoad(input${i}, qc, 0).rgb, vec3f(0.0))) * w; sL${i} += l; sL2${i} += l * l; }`)).join('\n    ')}
  }`).join('')}
  if (cnt <= 0.0) {
    ${I.map((i) => `textureStore(outG${i}, s, vec4u(0u));${C ? ` textureStore(outC${i}, s, vec4u(0u));` : ''}`).join('\n    ')}
    return;
  }
  var g = geoTap(geoCur, pAny);
  g.grad = unpack2x16float(textureLoad(geoGrad, pAny, 0).r);
  let dz = max(abs(g.grad.x), abs(g.grad.y));
  ${fromInput ? '' : /* wgsl */ `
  // history mean over the stratum (needs the centre, all 9 pixels on surfaces)
  var hasHist = false;
  var uA = vec2f(0.0); var uB = vec2f(0.0); var wA = vec2f(0.0); var wB = vec2f(0.0);   // per axis: tap uv, weight
  if (!hasFlag(FRAME_RESET) && cnt == 9.0 && pAny.x == p0.x + 1 && pAny.y == p0.y + 1) {
    let r = reproject(pAny, g, P0.planeTol, P0.normalTol);
    if (r.allValid) {
      hasHist = true;
      let pp = r.prevUV * F.dims - 0.5;
      let bse = floor(pp);
      let f = pp - bse;
      // texel-centre coordinates of the two taps per axis, then uv
      let posA = bse - 1.0 + 1.0 / (2.0 - f);
      let posB = bse + 1.0 + f / (1.0 + f);
      uA = (posA + 0.5) * F.invDims; uB = (posB + 0.5) * F.invDims;
      wA = 2.0 - f; wB = 1.0 + f;
    }
  }`}
  ${I.map((i) => /* wgsl */ `
  {
    let m = sL${i} / cnt;
    let v = max(0.0, sL2${i} / cnt - m * m);
    var g0 = vec4f(0.0, 0.0, 0.0, 1.0);${C ? `
    var gc = vec4f(0.0);   // (delta Co, delta Cg, sigma Co, sigma Cg) of the current means` : ''}
    ${fromInput ? /* wgsl */ `
    let gi = textureLoad(gradInput${i}, s, 0);   // (l_prev, l_curr, valid)
    if (gi.z > 0.0 && !hasFlag(FRAME_RESET)) {
      g0 = vec4f(gi.y - gi.x, max(gi.x, gi.y), 0.0, 1.0);
    }` : /* wgsl */ `
    if (hasHist) {${C ? /* wgsl */ `
      let ch = (textureSampleLevel(accumPrev${i}, smp, vec2f(uA.x, uA.y), 0.0).rgb * wA.x * wA.y
              + textureSampleLevel(accumPrev${i}, smp, vec2f(uB.x, uA.y), 0.0).rgb * wB.x * wA.y
              + textureSampleLevel(accumPrev${i}, smp, vec2f(uA.x, uB.y), 0.0).rgb * wA.x * wB.y
              + textureSampleLevel(accumPrev${i}, smp, vec2f(uB.x, uB.y), 0.0).rgb * wB.x * wB.y) / 9.0;
      let mh = luma(ch);
      let mc = sC${i} / cnt;
      gc = vec4f(mc - cocg(ch), sqrt(max(sC2${i} / cnt - mc * mc, vec2f(0.0)) / cnt));` : /* wgsl */ `
      let mh = (luma(textureSampleLevel(accumPrev${i}, smp, vec2f(uA.x, uA.y), 0.0).rgb) * wA.x * wA.y
              + luma(textureSampleLevel(accumPrev${i}, smp, vec2f(uB.x, uA.y), 0.0).rgb) * wB.x * wA.y
              + luma(textureSampleLevel(accumPrev${i}, smp, vec2f(uA.x, uB.y), 0.0).rgb) * wA.x * wB.y
              + luma(textureSampleLevel(accumPrev${i}, smp, vec2f(uB.x, uB.y), 0.0).rgb) * wB.x * wB.y) / 9.0;`}
      g0 = vec4f(m - mh, max(m, mh), v / cnt, 1.0);
    }`}
    textureStore(outG${i}, s, packG(g0, vec4f(m, v, zAny, dz)));${C ? `
    textureStore(outC${i}, s, vec4u(pack2x16float(gc.xy), pack2x16float(gc.zw), 0u, 0u));` : ''}
  }`).join('')}
}
`;
  return { code, entries: b.entries };
}

/**
 * v2 reconstruction (packed): S2 sec. 3.4 / S3 AtrousGradient weights as v1, but one
 * 16-byte load per tap, taps unrolled with clamped coordinates and select()ed weights,
 * the luminance-variance prefilter from this iteration's taps (exact at stride 1).
 * var(delta) is filtered with linear weights (local mean of the per-stratum variance;
 * strata without history count as 0, matching their 0 in delta) and w carries
 * 1 + the spatial variance (strata^2 per axis) of the composite kernel so far: the
 * weighted mixture of the taps' kernels plus this iteration's offset spread. v1's
 * sum w^2 var / (sum w)^2 treats taps as independent although after the first
 * iteration neighbours share inputs: 5 iterations shrank the estimate ~20x too far.
 */
export function gradientAtrousPassV2(count: number, gv: GradientVariant = {}): PassDef {
  const I = [...Array(count).keys()];
  const C = !!gv.chroma;
  const b = new Bindings();
  I.forEach((i) => b.uniform(`P${i}`, 'Params'));
  b.uniform('It', 'Iter');
  I.forEach((i) => {
    b.add(`inG${i}`, 'texture_2d<u32>', 'i');
    b.add(`outG${i}`, 'texture_storage_2d<rgba32uint, write>', 'rgba32uint');
    if (C) {
      b.add(`inC${i}`, 'texture_2d<u32>', 'i');
      b.add(`outC${i}`, 'texture_storage_2d<rg32uint, write>', 'rg32uint');
    }
  });
  const taps: [number, number][] = [];
  for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) if (x || y) taps.push([x, y]);
  const code = /* wgsl */ `
${PARAMS_STRUCT}
struct Iter { stride: i32, iteration: i32, pad0: i32, pad1: i32 }
${b.wgsl}
${PACK_WGSL}${C ? PACK_C_WGSL : ''}

fn inStrata(q: vec2i) -> bool { return q.x >= 0 && q.y >= 0 && q.x < P0.gradDims.x && q.y < P0.gradDims.y; }

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let s = vec2i(gid.xy);
  if (!inStrata(s)) { return; }
  ${I.map((i) => /* wgsl */ `
  {
    let cu = textureLoad(inG${i}, s, 0);
    let c0 = unpackG0(cu);
    let c1 = unpackG1(cu);
    if (c1.z <= 0.0) {
      textureStore(outG${i}, s, cu);${C ? `
      textureStore(outC${i}, s, textureLoad(inC${i}, s, 0));` : ''}
    } else {
      ${taps.map(([x, y], k) => `let q${k} = s + vec2i(${x}, ${y}) * It.stride;
      let u${k} = textureLoad(inG${i}, clamp(q${k}, vec2i(0), P0.gradDims - 1), 0);
      let a${k} = unpackG0(u${k}); let b${k} = unpackG1(u${k});${C ? `
      let e${k} = unpackC(textureLoad(inC${i}, clamp(q${k}, vec2i(0), P0.gradDims - 1), 0));` : ''}`).join('\n      ')}
      let gv = (4.0 * c1.y + ${taps.map(([x, y], k) => `${(2 - Math.abs(x)) * (2 - Math.abs(y))}.0 * b${k}.y`).join(' + ')}) / 16.0;
      let sl = 3.0 * sqrt(max(gv, 0.0)) + 1e-10;
      let dzs = c1.w * f32(It.stride) * f32(P0.gradDown);
      var s0 = c0; var sL = c1.x; var sV = c1.y; var sw = 1.0;${C ? `
      var sC = unpackC(textureLoad(inC${i}, s, 0));` : ''}
      var sR = vec2f(0.0); var sR2 = 0.0;
      ${taps.map(([x, y], k) => `{
        let wl = abs(b${k}.x - c1.x) / sl;
        let wz = abs(b${k}.z - c1.z) / (dzs * ${Math.hypot(x, y).toFixed(6)} + 1e-2 * c1.z);
        let w = select(0.0, exp(-wl * wl - wz), inStrata(q${k}) && b${k}.z > 0.0);
        s0 += a${k} * w; sL += b${k}.x * w; sV += b${k}.y * w * w; sw += w;${C ? ` sC += e${k} * w;` : ''}
        let fo = vec2f(${x}.0, ${y}.0) * f32(It.stride);
        sR += fo * w; sR2 += dot(fo, fo) * w;
      }`).join('\n      ')}
      var o0 = s0 / sw;
      let m = sR / sw;
      o0.w = 1.0 + max(0.0, o0.w - 1.0) + 0.5 * max(0.0, sR2 / sw - dot(m, m));
      textureStore(outG${i}, s, packG(o0, vec4f(sL / sw, sV / (sw * sw), c1.z, c1.w)));${C ? `
      textureStore(outC${i}, s, packC(sC / sw));` : ''}
    }
  }`).join('')}
}
`;
  return { code, entries: b.entries };
}

/**
 * v2 lambda: max(0, |delta| - k sigma) / Delta, max over (2r+1)^2 strata, with
 * sigma^2 = var(delta) x sum K^2 of the composite kernel, sum K^2 ~ 1/(4 pi v)
 * (2-D Gaussian of per-axis variance v; clamped to <= 1).
 */
export function gradientLambdaPassV2(count: number, gv: GradientVariant = {}): PassDef {
  const I = [...Array(count).keys()];
  const C = !!gv.chroma;
  const gain = (i: number) => gv.gain?.[i] ?? 1;
  const b = new Bindings();
  I.forEach((i) => b.uniform(`P${i}`, 'Params'));
  I.forEach((i) => {
    b.add(`inG${i}`, 'texture_2d<u32>', 'i');
    if (C) b.add(`inC${i}`, 'texture_2d<u32>', 'i');
    b.add(`outL${i}`, 'texture_storage_2d<r32float, write>', 'r32float');
  });
  const code = /* wgsl */ `
${PARAMS_STRUCT}
${b.wgsl}
${PACK_WGSL}${C ? PACK_C_WGSL : ''}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let s = vec2i(gid.xy);
  if (s.x >= P0.gradDims.x || s.y >= P0.gradDims.y) { return; }
  ${I.map((i) => /* wgsl */ `
  {
    var lam = 0.0;
    for (var dy = -P${i}.gradRadius; dy <= P${i}.gradRadius; dy++) {
      for (var dx = -P${i}.gradRadius; dx <= P${i}.gradRadius; dx++) {
        let v = unpackG0(textureLoad(inG${i}, clamp(s + vec2i(dx, dy), vec2i(0), P${i}.gradDims - 1), 0));
        if (v.y <= 1e-6) { continue; }
        var d = abs(v.x);
        if ((P${i}.flags & P_GRADIENT_INPUT) == 0u) {
          d = max(0.0, d - P${i}.gradNoiseK * sqrt(v.z * min(1.0, 1.0 / (12.566371 * max(v.w - 1.0, 1e-6)))));
        }${C ? `
        {
          // chroma (GradientVariant.chroma): same composite-kernel noise floor, normalized by the luminance Delta
          let cv = unpackC(textureLoad(inC${i}, clamp(s + vec2i(dx, dy), vec2i(0), P${i}.gradDims - 1), 0));
          let sk = min(1.0, 1.0 / (12.566371 * max(v.w - 1.0, 1e-6)));
          let dc = max(vec2f(0.0), abs(cv.xy) - P${i}.gradNoiseK * sqrt(cv.zw * sk));
          d = max(d, max(dc.x, dc.y));
        }` : ''}
        lam = max(lam, ${gain(i) !== 1 ? `${gain(i).toFixed(6)} * d / v.y` : 'd / v.y'});
      }
    }
    textureStore(outL${i}, s, vec4f(clamp(lam, 0.0, 1.0)));
  }`).join('')}
}
`;
  return { code, entries: b.entries };
}

/** v1 gradient samples (antiLagVersion 1, M1): one thread per pixel, 9x9 workgroups, per-pixel reprojection. */
export function gradientCreatePass(count: number, fromInput: boolean): PassDef {
  const I = [...Array(count).keys()];
  const b = new Bindings();
  b.uniform('F', 'Frame');
  I.forEach((i) => b.uniform(`P${i}`, 'Params'));
  b.add('geoCur', 'texture_2d<u32>', 'i');
  b.add('geoPrev', 'texture_2d<u32>', 'i');
  b.add('geoGrad', 'texture_2d<u32>', 'i');
  b.add('motionTex', 'texture_2d<f32>', 'f');
  b.add('motionZTex', 'texture_2d<f32>', 'f');
  I.forEach((i) => {
    b.add(`input${i}`, 'texture_2d<f32>', 'f');
    b.add(`accumPrev${i}`, 'texture_2d<f32>', 'f');
    b.add(`gradInput${i}`, 'texture_2d<f32>', 'f');
    b.add(`outG0${i}`, 'texture_storage_2d<rgba32float, write>', 'rgba32float');   // delta, Delta, var(delta), valid
    b.add(`outG1${i}`, 'texture_storage_2d<rgba32float, write>', 'rgba32float');   // mean l, var l, z, |dz|
  });
  const code = /* wgsl */ `
${FRAME_WGSL}
${PARAMS_STRUCT}
${b.wgsl}
${REPROJECT_WGSL}

// One thread per pixel in 9x9 workgroups (3x3 strata each); every pixel does
// its own reprojection, then one thread per stratum reduces its 9 pixels from
// workgroup memory (9x more parallel than a thread per stratum).
${I.map((i) => `var<workgroup> wL${i}: array<vec4f, 81>;   // l, l^2, valid, l_hist`).join('\n')}
var<workgroup> wH: array<vec4f, 81>;   // history valid, z, |dz|, 0

@compute @workgroup_size(9, 9)
fn main(@builtin(global_invocation_id) gid: vec3u, @builtin(local_invocation_id) lid: vec3u) {
  let p = vec2i(gid.xy);
  let li = lid.y * 9u + lid.x;
  ${I.map((i) => `var a${i} = vec4f(0.0);`).join(' ')}
  var hb = vec4f(0.0);
  if (inside(p)) {
    let g0 = geoTap(geoCur, p);
    if (g0.z > 0.0) {
      var g = g0;
      g.grad = unpack2x16float(textureLoad(geoGrad, p, 0).r);
      hb = vec4f(0.0, g.z, max(abs(g.grad.x), abs(g.grad.y)), 0.0);
      ${I.map((i) => `{ let l = luma(max(textureLoad(input${i}, p, 0).rgb, vec3f(0.0))); a${i} = vec4f(l, l * l, 1.0, 0.0); }`).join('\n      ')}
      ${fromInput ? '' : /* wgsl */ `
      if (!hasFlag(FRAME_RESET)) {
        let r = reproject(p, g, P0.planeTol, P0.normalTol);
        if (r.sumW > 0.01) {
          hb.x = 1.0;
          for (var k = 0; k < 4; k++) {
            if (r.w[k] <= 0.0) { continue; }
            let q = r.base + TAP_OFFS[k];
            ${I.map((i) => `a${i}.w += luma(textureLoad(accumPrev${i}, q, 0).rgb) * r.w[k];`).join('\n            ')}
          }
          ${I.map((i) => `a${i}.w /= r.sumW;`).join(' ')}
        }
      }`}
    }
  }
  ${I.map((i) => `wL${i}[li] = a${i};`).join(' ')}
  wH[li] = hb;
  workgroupBarrier();
  if (lid.x % 3u != 0u || lid.y % 3u != 0u) { return; }
  let s = p / 3;
  if (s.x >= P0.gradDims.x || s.y >= P0.gradDims.y) { return; }
  ${I.map((i) => /* wgsl */ `
  {
    var sumL = 0.0; var sumL2 = 0.0; var cnt = 0.0;
    var sumC = 0.0; var sumH = 0.0; var cntH = 0.0;
    var zc = 0.0; var dzc = 0.0;
    for (var yy = 0u; yy < 3u; yy++) {
      for (var xx = 0u; xx < 3u; xx++) {
        let j = (lid.y + yy) * 9u + lid.x + xx;
        let va = wL${i}[j];
        let vb = wH[j];
        if (va.z <= 0.0) { continue; }
        sumL += va.x; sumL2 += va.y; cnt += 1.0;
        if (zc == 0.0 || (xx == 1u && yy == 1u)) { zc = vb.y; dzc = vb.z; }
        if (vb.x > 0.0) { sumH += va.w; sumC += va.x; cntH += 1.0; }
      }
    }
    var g1 = vec4f(0.0);
    var g0 = vec4f(0.0);
    if (cnt > 0.0) {
      let m = sumL / cnt;
      let v = max(0.0, sumL2 / cnt - m * m);
      g1 = vec4f(m, v, zc, dzc);
      ${fromInput ? /* wgsl */ `
      let gi = textureLoad(gradInput${i}, s, 0);   // (l_prev, l_curr, valid)
      if (gi.z > 0.0 && !hasFlag(FRAME_RESET)) {
        g0 = vec4f(gi.y - gi.x, max(gi.x, gi.y), 0.0, 1.0);
      }` : /* wgsl */ `
      if (cntH > 0.0) {
        let mc = sumC / cntH;
        let mh = sumH / cntH;
        g0 = vec4f(mc - mh, max(mc, mh), v / cntH, 1.0);
      }`}
    }
    textureStore(outG0${i}, s, g0);
    textureStore(outG1${i}, s, g1);
  }`).join('')}
}
`;
  return { code, entries: b.entries };
}

/** v1 reconstruction (rgba32float pair, naive variance propagation). */
export function gradientAtrousPass(count: number): PassDef {
  const I = [...Array(count).keys()];
  const b = new Bindings();
  I.forEach((i) => b.uniform(`P${i}`, 'Params'));
  b.uniform('It', 'Iter');
  I.forEach((i) => {
    b.add(`inG0${i}`, 'texture_2d<f32>', 'f');
    b.add(`inG1${i}`, 'texture_2d<f32>', 'f');
    b.add(`outG0${i}`, 'texture_storage_2d<rgba32float, write>', 'rgba32float');
    b.add(`outG1${i}`, 'texture_storage_2d<rgba32float, write>', 'rgba32float');
  });
  const code = /* wgsl */ `
${PARAMS_STRUCT}
struct Iter { stride: i32, iteration: i32, pad0: i32, pad1: i32 }
${b.wgsl}

fn inStrata(q: vec2i) -> bool { return q.x >= 0 && q.y >= 0 && q.x < P0.gradDims.x && q.y < P0.gradDims.y; }

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let s = vec2i(gid.xy);
  if (!inStrata(s)) { return; }
  ${I.map((i) => /* wgsl */ `
  {
    let c0 = textureLoad(inG0${i}, s, 0);
    let c1 = textureLoad(inG1${i}, s, 0);
    if (c1.z <= 0.0) {
      textureStore(outG0${i}, s, c0);
      textureStore(outG1${i}, s, c1);
    } else {
      var gv = 0.0;
      for (var dy = -1; dy <= 1; dy++) {
        for (var dx = -1; dx <= 1; dx++) {
          let k = (2.0 - f32(abs(dx))) * (2.0 - f32(abs(dy))) / 16.0;
          gv += textureLoad(inG1${i}, clamp(s + vec2i(dx, dy), vec2i(0), P0.gradDims - 1), 0).g * k;
        }
      }
      let sl = 3.0 * sqrt(max(gv, 0.0)) + 1e-10;
      var s0 = c0; var sL = c1.x; var sV = c1.y; var sw = 1.0; var sVarD = c0.z;
      for (var dy = -1; dy <= 1; dy++) {
        for (var dx = -1; dx <= 1; dx++) {
          if (dx == 0 && dy == 0) { continue; }
          let off = vec2i(dx, dy) * It.stride;
          let q = s + off;
          if (!inStrata(q)) { continue; }
          let q1 = textureLoad(inG1${i}, q, 0);
          if (q1.z <= 0.0) { continue; }
          let q0 = textureLoad(inG0${i}, q, 0);
          let wl = abs(q1.x - c1.x) / sl;
          let wz = abs(q1.z - c1.z) / (c1.w * length(vec2f(off)) * f32(P0.gradDown) + 1e-2 * c1.z);
          let w = exp(-wl * wl - wz);
          s0 += q0 * w; sVarD += q0.z * w * w;
          sL += q1.x * w; sV += q1.y * w * w; sw += w;
        }
      }
      var o0 = s0 / sw;
      o0.z = sVarD / (sw * sw);
      textureStore(outG0${i}, s, o0);
      textureStore(outG1${i}, s, vec4f(sL / sw, sV / (sw * sw), c1.z, c1.w));
    }
  }`).join('')}
}
`;
  return { code, entries: b.entries };
}

/**
 * v1 lambda = min(1, |delta| / Delta) per stratum, max over a (2r+1)^2
 * neighbourhood of strata (A-SVGF sec. 3.5, p.9 safety margin), written once
 * at stratum resolution so the temporal pass reads one texel. 'auto' subtracts
 * a noise floor k sigma_delta first (our design).
 */
export function gradientLambdaPass(count: number): PassDef {
  const I = [...Array(count).keys()];
  const b = new Bindings();
  I.forEach((i) => b.uniform(`P${i}`, 'Params'));
  I.forEach((i) => {
    b.add(`inG0${i}`, 'texture_2d<f32>', 'f');
    b.add(`outL${i}`, 'texture_storage_2d<r32float, write>', 'r32float');
  });
  const code = /* wgsl */ `
${PARAMS_STRUCT}
${b.wgsl}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let s = vec2i(gid.xy);
  if (s.x >= P0.gradDims.x || s.y >= P0.gradDims.y) { return; }
  ${I.map((i) => /* wgsl */ `
  {
    var lam = 0.0;
    for (var dy = -P${i}.gradRadius; dy <= P${i}.gradRadius; dy++) {
      for (var dx = -P${i}.gradRadius; dx <= P${i}.gradRadius; dx++) {
        let q = clamp(s + vec2i(dx, dy), vec2i(0), P${i}.gradDims - 1);
        let v = textureLoad(inG0${i}, q, 0);   // (delta, Delta, var(delta), valid)
        if (v.w <= 0.0 || v.y <= 1e-6) { continue; }
        var d = abs(v.x);
        if ((P${i}.flags & P_GRADIENT_INPUT) == 0u) { d = max(0.0, d - P${i}.gradNoiseK * sqrt(max(v.z, 0.0))); }
        lam = max(lam, d / v.y);
      }
    }
    textureStore(outL${i}, s, vec4f(clamp(lam, 0.0, 1.0)));
  }`).join('')}
}
`;
  return { code, entries: b.entries };
}
