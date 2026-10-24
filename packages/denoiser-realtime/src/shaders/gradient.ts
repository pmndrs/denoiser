// A-SVGF temporal gradients (anti-lag): per-stratum gradient samples, then an
// edge-aware a-trous reconstruction at stratum resolution; the temporal pass
// turns the result into a per-pixel alpha boost.
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
import { FRAME_WGSL, REPROJECT_WGSL } from './common';

/** Stratum size (A-SVGF: 3x3 strata, <= 11 % of samples recycled). */
export const GRADIENT_DOWNSAMPLE = 3;

const GPARAMS_WGSL = /* wgsl */ `
struct Params {
  alpha: f32, momentsAlpha: f32, maxHistory: f32, planeTol: f32,
  normalTol: f32, sigmaZ: f32, sigmaN: f32, sigmaL: f32,
  rampFrames: f32, varBoost: f32, specScale: f32, specKappa: f32,
  lobeFraction: f32, gradNoiseK: f32, radiusScale: f32, flags: u32,
  gradRadius: i32, gradDown: i32, gradDims: vec2i,
}
`;

export function gradientCreateWgsl(fromInput: boolean): string {
  return /* wgsl */ `
${FRAME_WGSL}
${GPARAMS_WGSL}
@group(0) @binding(0) var<uniform> F: Frame;
@group(0) @binding(1) var<uniform> P: Params;
@group(0) @binding(2) var inputTex: texture_2d<f32>;
@group(0) @binding(3) var geoCur: texture_2d<u32>;
@group(0) @binding(4) var geoPrev: texture_2d<u32>;
@group(0) @binding(5) var motionTex: texture_2d<f32>;
@group(0) @binding(6) var motionZTex: texture_2d<f32>;
@group(0) @binding(7) var accumPrev: texture_2d<f32>;
@group(0) @binding(8) var gradInput: texture_2d<f32>;
@group(0) @binding(9) var outG0: texture_storage_2d<rgba32float, write>;  // delta, Delta, var(delta), valid
@group(0) @binding(10) var outG1: texture_storage_2d<rgba32float, write>; // mean l, var l, z, |dz|
@group(0) @binding(11) var geoGrad: texture_2d<u32>;
${REPROJECT_WGSL}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let s = vec2i(gid.xy);
  if (s.x >= P.gradDims.x || s.y >= P.gradDims.y) { return; }
  var sumL = 0.0; var sumL2 = 0.0; var cnt = 0.0;
  var sumC = 0.0; var sumH = 0.0; var cntH = 0.0;
  var zc = 0.0; var dzc = 0.0;
  for (var yy = 0; yy < P.gradDown; yy++) {
    for (var xx = 0; xx < P.gradDown; xx++) {
      let p = s * P.gradDown + vec2i(xx, yy);
      if (!inside(p)) { continue; }
      var g = geoTap(geoCur, p);
      g.grad = unpack2x16float(textureLoad(geoGrad, p, 0).r);
      if (g.z <= 0.0) { continue; }
      let l = luma(max(textureLoad(inputTex, p, 0).rgb, vec3f(0.0)));
      sumL += l; sumL2 += l * l; cnt += 1.0;
      if (zc == 0.0 || (xx == 1 && yy == 1)) { zc = g.z; dzc = max(abs(g.grad.x), abs(g.grad.y)); }
      ${fromInput ? '' : /* wgsl */ `
      if (!hasFlag(FRAME_RESET)) {
        let r = reproject(p, g, P.planeTol, P.normalTol);
        if (r.sumW > 0.01) {
          var h = 0.0;
          for (var i = 0; i < 4; i++) {
            if (r.w[i] > 0.0) { h += luma(textureLoad(accumPrev, r.base + TAP_OFFS[i], 0).rgb) * r.w[i]; }
          }
          sumH += h / r.sumW; sumC += l; cntH += 1.0;
        }
      }`}
    }
  }
  var g1 = vec4f(0.0);
  var g0 = vec4f(0.0);
  if (cnt > 0.0) {
    let m = sumL / cnt;
    let v = max(0.0, sumL2 / cnt - m * m);
    g1 = vec4f(m, v, zc, dzc);
    ${fromInput ? /* wgsl */ `
    let gi = textureLoad(gradInput, s, 0);   // (l_prev, l_curr, valid)
    if (gi.z > 0.0 && !hasFlag(FRAME_RESET)) {
      g0 = vec4f(gi.y - gi.x, max(gi.x, gi.y), 0.0, 1.0);
    }` : /* wgsl */ `
    if (cntH > 0.0) {
      let mc = sumC / cntH;
      let mh = sumH / cntH;
      g0 = vec4f(mc - mh, max(mc, mh), v / cntH, 1.0);
    }`}
  }
  textureStore(outG0, s, g0);
  textureStore(outG1, s, g1);
}
`;
}

export function gradientAtrousWgsl(): string {
  return /* wgsl */ `
${GPARAMS_WGSL}
struct Iter { stride: i32, iteration: i32, pad0: i32, pad1: i32 }
@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<uniform> I: Iter;
@group(0) @binding(2) var inG0: texture_2d<f32>;
@group(0) @binding(3) var inG1: texture_2d<f32>;
@group(0) @binding(4) var outG0: texture_storage_2d<rgba32float, write>;
@group(0) @binding(5) var outG1: texture_storage_2d<rgba32float, write>;

fn sigmaL(s: vec2i) -> f32 {
  var sum = 0.0;
  for (var dy = -1; dy <= 1; dy++) {
    for (var dx = -1; dx <= 1; dx++) {
      let k = (2.0 - f32(abs(dx))) * (2.0 - f32(abs(dy))) / 16.0;
      sum += textureLoad(inG1, clamp(s + vec2i(dx, dy), vec2i(0), P.gradDims - 1), 0).g * k;
    }
  }
  return 3.0 * sqrt(max(sum, 0.0));
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let s = vec2i(gid.xy);
  if (s.x >= P.gradDims.x || s.y >= P.gradDims.y) { return; }
  let c0 = textureLoad(inG0, s, 0);
  let c1 = textureLoad(inG1, s, 0);
  if (c1.z <= 0.0) { textureStore(outG0, s, c0); textureStore(outG1, s, c1); return; }
  let sl = sigmaL(s) + 1e-10;
  var s0 = c0; var sL = c1.x; var sV = c1.y; var sw = 1.0;
  var sVarD = c0.z;
  for (var dy = -1; dy <= 1; dy++) {
    for (var dx = -1; dx <= 1; dx++) {
      if (dx == 0 && dy == 0) { continue; }
      let off = vec2i(dx, dy) * I.stride;
      let q = s + off;
      if (q.x < 0 || q.y < 0 || q.x >= P.gradDims.x || q.y >= P.gradDims.y) { continue; }
      let q1 = textureLoad(inG1, q, 0);
      if (q1.z <= 0.0) { continue; }
      let q0 = textureLoad(inG0, q, 0);
      let wl = abs(q1.x - c1.x) / sl;
      let wz = abs(q1.z - c1.z) / (c1.w * length(vec2f(off)) * f32(P.gradDown) + 1e-2 * c1.z);
      let w = exp(-wl * wl - wz);
      s0 += q0 * w; sVarD += q0.z * w * w;
      sL += q1.x * w; sV += q1.y * w * w; sw += w;
    }
  }
  var o0 = s0 / sw;
  o0.z = sVarD / (sw * sw);
  textureStore(outG0, s, o0);
  textureStore(outG1, s, vec4f(sL / sw, sV / (sw * sw), c1.z, c1.w));
}
`;
}
