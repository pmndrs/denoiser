// SVGF passes (temporal accumulation, variance estimation, edge-avoiding
// a-trous), for diffuse and specular signals. Ported from Dennis Smolek's own
// SVGF in the ssgiDev bench (demo 14, written from the SVGF paper; see
// docs/research/rt-denoiser/sources/ssgi-svgf-review.md) with the review's
// upgrades. Sources (public; full table in docs/research/rt-denoiser/PROVENANCE.md):
//
// - Schied et al. 2017, "Spatiotemporal Variance-Guided Filtering", HPG:
//   sec. 4.1 temporal accumulation (2x2 per-tap validity, EMA alpha = 0.2),
//   sec. 4.2 moments + variance (spatial 7x7 bilateral estimate while history
//   < 4 frames), sec. 4.3 a-trous with B3 5x5 kernel, feedback of iteration 0
//   as color history, variance propagated as sum(w^2 var)/sum(w)^2, sec. 4.4
//   edge-stopping functions eq. 3-5 (sigma_z = 1, sigma_n = 128, sigma_l = 4,
//   3x3 Gaussian variance prefilter).
// - Schied et al. 2018, A-SVGF (PACMCGIT 1(2) art. 24) and its BSD-3 reference
//   code (a_svgf.zip, Copyright (c) 2018 Christoph Schied, see NOTICE):
//   alpha = max(alpha, 1/(n+1)) start-up, history cap, 3x3 box kernel option,
//   spatial-variance boost 1 + 3 (1 - n/4) and filtered color for young
//   history, short-footprint 5x5 when n > 1.
// - Specular weights: Ray Tracing Gems ch. 32 (Hirvonen et al. 2019), sec.
//   32.4.1 eq. 14 (roughness similarity) and eq. 15 (roughness radius);
//   lobe half-angle normal cutoff 90deg * a/(1+a), a = r^2 (Zhdan, GTC 2020
//   ReBLUR talk, slides 46-47, via sources/reblur.md sec. 4.4); surface-motion
//   history cap from roughness, N.V and parallax (RTG II ch. 49 sec. 49.8.1
//   p.833-834, via sources/reblur.md sec. 4.2).
// - Our design: smooth temporal->spatial variance ramp over the first frames
//   (ssgiDev demo 14) instead of a hard switch; history Catmull-Rom clamped to
//   the 2x2 range (common.ts); epsilon of the depth weight relative to depth.
import { FRAME_WGSL, REPROJECT_WGSL } from './common';

export type SignalKind = 'diffuse' | 'specular';

/** Params.flags */
export const P_CATMULL = 1;
export const P_ANTILAG = 2;
export const P_REMODULATE = 4;
export const P_GRADIENT_INPUT = 8;
export const P_KERNEL_BOX3 = 16;
export const P_VAR_OF_MEAN = 32;

export const PARAMS_SIZE = 256;

const PARAMS_WGSL = /* wgsl */ `
struct Params {
  alpha: f32,
  momentsAlpha: f32,
  maxHistory: f32,
  planeTol: f32,
  normalTol: f32,
  sigmaZ: f32,
  sigmaN: f32,
  sigmaL: f32,
  rampFrames: f32,
  varBoost: f32,
  specPower: f32,
  specKappa: f32,
  parallaxScale: f32,
  gradNoiseK: f32,
  radiusScale: f32,
  flags: u32,
  gradRadius: i32,
  gradDown: i32,
  gradDims: vec2i,
}
const P_CATMULL = ${P_CATMULL}u;
const P_ANTILAG = ${P_ANTILAG}u;
const P_REMODULATE = ${P_REMODULATE}u;
const P_GRADIENT_INPUT = ${P_GRADIENT_INPUT}u;
const P_KERNEL_BOX3 = ${P_KERNEL_BOX3}u;
const P_VAR_OF_MEAN = ${P_VAR_OF_MEAN}u;
fn pflag(f: u32) -> bool { return (P.flags & f) != 0u; }

fn finite3(c: vec3f) -> vec3f {
  let b = bitcast<vec3u>(c) & vec3u(0x7f800000u);
  return select(c, vec3f(0.0), b == vec3u(0x7f800000u));
}
`;

/** Edge-stopping functions shared by the variance and a-trous passes. */
function weightsWgsl(kind: SignalKind): string {
  const normal = kind === 'diffuse'
    ? /* wgsl */ `
fn wNormal(g: Geo, gq: Geo) -> f32 { return pow(max(0.0, dot(g.n, gq.n)), P.sigmaN); }`
    : /* wgsl */ `
// Specular: reject beyond the lobe half-angle (+0.5 deg), linear falloff.
fn wNormal(g: Geo, gq: Geo) -> f32 {
  let a = g.rough * g.rough;
  let theta0 = 1.5707963 * a / (1.0 + a) + 0.0087266;
  let ang = acos(clamp(dot(g.n, gq.n), -1.0, 1.0));
  return clamp(1.0 - ang / theta0, 0.0, 1.0);
}`;
  const spec = kind === 'specular' ? /* wgsl */ `
// RTG ch. 32 eq. 14-15: f_w(a, b, x) = 1 - smoothstep(a, b, x)
fn wRough(g: Geo, gq: Geo) -> f32 { return 1.0 - smoothstep(0.01, 0.1, abs(g.rough - gq.rough)); }
fn wRadius(g: Geo, dist: f32) -> f32 {
  let r = max(g.rough, 1e-3) * P.radiusScale;
  return 1.0 - smoothstep(10.0 * r, 70.0 * r, dist);
}` : '';
  return /* wgsl */ `
// SVGF eq. 3: depth difference relative to the local depth plane.
fn wDepth(g: Geo, gq: Geo, off: vec2f) -> f32 {
  let s = P.sigmaZ * abs(dot(g.grad, off)) + 1e-3 * g.z;
  return exp(-abs(gq.z - g.z) / s);
}
${normal}
${spec}
fn wGeo(g: Geo, gq: Geo, off: vec2f) -> f32 {
  var w = wDepth(g, gq, off) * wNormal(g, gq);
  ${kind === 'specular' ? 'w *= wRough(g, gq) * wRadius(g, length(off));' : ''}
  return w;
}
`;
}

// ---- temporal accumulation ------------------------------------------------------

export function temporalWgsl(kind: SignalKind): string {
  const cap = kind === 'diffuse'
    ? /* wgsl */ `fn historyCap(g: Geo, world: vec3f) -> f32 { return P.maxHistory; }`
    : /* wgsl */ `
// Surface-motion history cap for specular (RTG II sec. 49.8.1): fewer frames
// for low roughness, grazing angles and high parallax. Returns frames incl. the
// current one.
fn historyCap(g: Geo, world: vec3f) -> f32 {
  let V = normalize(F.camPos - world);
  let Vp = normalize(F.prevCamPos - world);
  let NoV = clamp(dot(g.n, V), 0.0, 1.0);
  let c = clamp(dot(V, Vp), -1.0, 1.0);
  let parallax = sqrt(max(0.0, 1.0 - c * c)) / max(c, 1e-4) * P.parallaxScale;
  let r = g.rough;
  let cc = pow(1.0 - NoV, P.specKappa);
  let b = 1.1 + r * r;
  let S = (b + cc) / (b - cc);
  let a = P.maxHistory * (1.0 - exp2(-200.0 * r * r)) * pow(max(r, 1e-4), P.specPower * (1.0 + parallax * S));
  return clamp(a + 1.0, 1.0, P.maxHistory);
}`;
  return /* wgsl */ `
${FRAME_WGSL}
${PARAMS_WGSL}
@group(0) @binding(0) var<uniform> F: Frame;
@group(0) @binding(1) var<uniform> P: Params;
@group(0) @binding(2) var inputTex: texture_2d<f32>;
@group(0) @binding(3) var geoCur: texture_2d<u32>;
@group(0) @binding(4) var geoPrev: texture_2d<u32>;
@group(0) @binding(5) var motionTex: texture_2d<f32>;
@group(0) @binding(6) var motionZTex: texture_2d<f32>;
@group(0) @binding(7) var colorHist: texture_2d<f32>;
@group(0) @binding(8) var accumPrev: texture_2d<f32>;
@group(0) @binding(9) var momentsPrev: texture_2d<f32>;
@group(0) @binding(10) var smp: sampler;
@group(0) @binding(11) var gradTex: texture_2d<f32>;
@group(0) @binding(12) var outAccum: texture_storage_2d<rgba16float, write>;
@group(0) @binding(13) var outMoments: texture_storage_2d<rg32float, write>;
${REPROJECT_WGSL}
${cap}

// A-SVGF sec. 3.5: lambda = min(1, |delta| / Delta) from the reconstructed
// gradient, max over a neighbourhood of strata (safety margin, p.9). Without a
// renderer-supplied gradient the delta has a noise floor (our design):
// |delta| - k * sigma_delta.
fn antilagLambda(p: vec2i) -> f32 {
  let gp = p / P.gradDown;
  var lam = 0.0;
  for (var dy = -P.gradRadius; dy <= P.gradRadius; dy++) {
    for (var dx = -P.gradRadius; dx <= P.gradRadius; dx++) {
      let q = clamp(gp + vec2i(dx, dy), vec2i(0), P.gradDims - 1);
      let v = textureLoad(gradTex, q, 0);   // (delta, Delta, var(delta), valid)
      if (v.w <= 0.0 || v.y <= 1e-6) { continue; }
      var d = abs(v.x);
      if (!pflag(P_GRADIENT_INPUT)) { d = max(0.0, d - P.gradNoiseK * sqrt(max(v.z, 0.0))); }
      lam = max(lam, d / v.y);
    }
  }
  return clamp(lam, 0.0, 1.0);
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let p = vec2i(gid.xy);
  if (!inside(p)) { return; }
  let cur = finite3(max(textureLoad(inputTex, p, 0).rgb, vec3f(0.0)));
  let l = luma(cur);
  let mCur = vec2f(l, l * l);
  let g = geoTap(geoCur, p);
  if (g.z <= 0.0) {
    textureStore(outAccum, p, vec4f(cur, 1.0));
    textureStore(outMoments, p, vec4f(mCur, 0.0, 0.0));
    return;
  }

  var n = 1.0;
  var col = cur;
  var mom = mCur;
  if (!hasFlag(FRAME_RESET)) {
    let r = reproject(p, g, P.planeTol, P.normalTol);
    var hist = vec3f(0.0);
    var mHist = vec2f(0.0);
    var nPrev = 0.0;
    var sumW = 0.0;
    if (r.sumW > 0.01) {
      var lo = vec3f(1e30);
      var hi = vec3f(-1e30);
      for (var i = 0; i < 4; i++) {
        let q = r.base + TAP_OFFS[i];
        let w = r.w[i];
        if (w <= 0.0) { continue; }
        let c = textureLoad(colorHist, q, 0).rgb;
        lo = min(lo, c);
        hi = max(hi, c);
        hist += c * w;
        nPrev += textureLoad(accumPrev, q, 0).a * w;
        mHist += textureLoad(momentsPrev, q, 0).rg * w;
      }
      sumW = r.sumW;
      hist /= sumW;
      if (pflag(P_CATMULL) && r.allValid) {
        hist = clamp(sampleCatmullRom(colorHist, smp, r.prevUV).rgb, lo, hi);
      }
    } else {
      // SVGF sec. 4.1: 3x3 fallback (thin geometry), equal weights.
      let c0 = vec2i(floor(r.prevUV * F.dims));
      for (var dy = -1; dy <= 1; dy++) {
        for (var dx = -1; dx <= 1; dx++) {
          let q = c0 + vec2i(dx, dy);
          if (!tapValid(q, g, r.expPrev, P.planeTol, P.normalTol)) { continue; }
          hist += textureLoad(colorHist, q, 0).rgb;
          nPrev += textureLoad(accumPrev, q, 0).a;
          mHist += textureLoad(momentsPrev, q, 0).rg;
          sumW += 1.0;
        }
      }
      if (sumW > 0.0) { hist /= sumW; }
    }
    if (sumW > 0.0) {
      nPrev /= sumW;
      mHist /= sumW;
      n = min(nPrev + 1.0, historyCap(g, r.world));
      var a = max(P.alpha, 1.0 / n);
      var am = max(P.momentsAlpha, 1.0 / n);
      if (pflag(P_ANTILAG)) {
        let lam = antilagLambda(p);
        a = mix(a, 1.0, lam);
        am = mix(am, 1.0, lam);
        n = min(n, 1.0 / mix(1.0 / n, 1.0, lam));
      }
      col = mix(finite3(hist), cur, a);
      mom = mix(mHist, mCur, am);
    }
  }
  textureStore(outAccum, p, vec4f(col, n));
  textureStore(outMoments, p, vec4f(mom, 0.0, 0.0));
}
`;
}

// ---- variance estimation --------------------------------------------------------

export function varianceWgsl(kind: SignalKind): string {
  return /* wgsl */ `
${FRAME_WGSL}
${PARAMS_WGSL}
@group(0) @binding(0) var<uniform> F: Frame;
@group(0) @binding(1) var<uniform> P: Params;
@group(0) @binding(2) var accumCur: texture_2d<f32>;
@group(0) @binding(3) var momentsCur: texture_2d<f32>;
@group(0) @binding(4) var geoCur: texture_2d<u32>;
@group(0) @binding(5) var outPing: texture_storage_2d<rgba16float, write>;
@group(0) @binding(6) var geoGrad: texture_2d<u32>;
fn geoCenter(p: vec2i) -> Geo {
  var g = geoTap(geoCur, p);
  g.grad = unpack2x16float(textureLoad(geoGrad, p, 0).r);
  return g;
}
${weightsWgsl(kind)}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let p = vec2i(gid.xy);
  if (!inside(p)) { return; }
  let a = textureLoad(accumCur, p, 0);
  let m = textureLoad(momentsCur, p, 0).rg;
  let g = geoCenter(p);
  if (g.z <= 0.0) { textureStore(outPing, p, vec4f(a.rgb, 0.0)); return; }
  var varT = max(0.0, m.y - m.x * m.x);
  // Optional (our variant): variance of the accumulated mean instead of the
  // per-sample variance: EMA with weight a leaves a / (2 - a) of it, a
  // cumulative average over n frames 1 / n.
  if (pflag(P_VAR_OF_MEAN)) { varT *= max(P.alpha / (2.0 - P.alpha), 1.0 / max(a.a, 1.0)); }
  let t = clamp((a.a - 1.0) / max(P.rampFrames - 1.0, 1e-3), 0.0, 1.0);
  if (t >= 1.0) { textureStore(outPing, p, vec4f(a.rgb, varT)); return; }

  // Young history: bilateral spatial estimate of color and moments
  // (SVGF sec. 4.2: 7x7; A-SVGF code: 5x5 once n > 1), blended in smoothly.
  let r = select(2, 3, a.a < 2.0);
  var sc = a.rgb;
  var sm = m;
  var sw = 1.0;
  for (var dy = -r; dy <= r; dy++) {
    for (var dx = -r; dx <= r; dx++) {
      if (dx == 0 && dy == 0) { continue; }
      let q = p + vec2i(dx, dy);
      if (!inside(q)) { continue; }
      let gq = geoTap(geoCur, q);
      if (gq.z <= 0.0) { continue; }
      let w = wGeo(g, gq, vec2f(f32(dx), f32(dy)));
      sc += textureLoad(accumCur, q, 0).rgb * w;
      sm += textureLoad(momentsCur, q, 0).rg * w;
      sw += w;
    }
  }
  sc /= sw;
  sm /= sw;
  let varS = (1.0 + P.varBoost * (1.0 - t)) * max(0.0, sm.y - sm.x * sm.x);
  textureStore(outPing, p, vec4f(mix(sc, a.rgb, t), mix(varS, varT, t)));
}
`;
}

// ---- a-trous ----------------------------------------------------------------------

export interface AtrousVariant {
  /** Write the result as next frame's color history (feedback, iteration 0). */
  writeHist: boolean;
  /** Last iteration: write the output texture (optionally remodulated). */
  last: boolean;
}

export function atrousWgsl(kind: SignalKind, v: AtrousVariant, box: boolean): string {
  const histDecl = v.writeHist
    ? '@group(0) @binding(9) var outHist: texture_storage_2d<rgba16float, write>;' : '';
  const store = (val: string, varExpr: string) => v.last
    ? `textureStore(outDst, p, vec4f(${val} * select(vec3f(1.0), textureLoad(demodTex, p, 0).rgb, pflag(P_REMODULATE)), 1.0));`
    : `textureStore(outDst, p, vec4f(${val}, ${varExpr}));`;
  const hist = (val: string) => v.writeHist
    ? `textureStore(outHist, p, vec4f(${val}, textureLoad(accumCur, p, 0).a));` : '';
  return /* wgsl */ `
${FRAME_WGSL}
${PARAMS_WGSL}
struct Iter { stride: i32, iteration: i32, pad0: i32, pad1: i32 }
@group(0) @binding(0) var<uniform> F: Frame;
@group(0) @binding(1) var<uniform> P: Params;
@group(0) @binding(2) var<uniform> I: Iter;
@group(0) @binding(3) var srcTex: texture_2d<f32>;
@group(0) @binding(4) var geoCur: texture_2d<u32>;
@group(0) @binding(5) var accumCur: texture_2d<f32>;
@group(0) @binding(6) var demodTex: texture_2d<f32>;
@group(0) @binding(7) var outDst: texture_storage_2d<rgba16float, write>;
@group(0) @binding(8) var geoGrad: texture_2d<u32>;
${histDecl}
fn geoCenter(p: vec2i) -> Geo {
  var g = geoTap(geoCur, p);
  g.grad = unpack2x16float(textureLoad(geoGrad, p, 0).r);
  return g;
}
${weightsWgsl(kind)}

const B3 = array<f32, 5>(0.0625, 0.25, 0.375, 0.25, 0.0625);

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let p = vec2i(gid.xy);
  if (!inside(p)) { return; }
  let c = textureLoad(srcTex, p, 0);
  let g = geoCenter(p);
  if (g.z <= 0.0) {
    ${store('c.rgb', 'c.a')}
    ${hist('c.rgb')}
    return;
  }
  // SVGF sec. 4.4: a 3x3 Gaussian of the variance drives the luminance weight
  // (only). The 3x3 taps are the inner taps of this iteration's kernel, loaded
  // once and reused (exactly the paper's prefilter at stride 1; at larger
  // strides a wider one: our approximation, saves 8 loads per pixel).
  var inner: array<vec4f, 9>;
  var gVar = 0.0;
  for (var i = 0; i < 9; i++) {
    let o = vec2i(i % 3 - 1, i / 3 - 1);
    let s = textureLoad(srcTex, clampPix(p + o * I.stride), 0);
    inner[i] = s;
    gVar += s.a * f32((2 - abs(o.x)) * (2 - abs(o.y))) / 16.0;
  }
  let lc = luma(c.rgb);
  let lumDenom = P.sigmaL * sqrt(max(gVar, 0.0)) + 1e-10;
  let hc = ${box ? '1.0' : 'B3[2] * B3[2]'};
  var sumC = c.rgb * hc;
  var sumV = c.a * hc * hc;
  var sumW = hc;
  for (var i = 0; i < 9; i++) {
    if (i == 4) { continue; }
    let o = vec2i(i % 3 - 1, i / 3 - 1);
    let off = o * I.stride;
    let q = p + off;
    if (!inside(q)) { continue; }
    let gq = geoTap(geoCur, q);
    if (gq.z <= 0.0) { continue; }
    let s = inner[i];
    let h = ${box ? '1.0' : 'B3[o.x + 2] * B3[o.y + 2]'};
    let w = h * wGeo(g, gq, vec2f(off)) * exp(-abs(luma(s.rgb) - lc) / lumDenom);
    sumC += s.rgb * w;
    sumV += s.a * w * w;
    sumW += w;
  }
  ${box ? '' : `
  for (var dy = -2; dy <= 2; dy++) {
    for (var dx = -2; dx <= 2; dx++) {
      if (abs(dx) <= 1 && abs(dy) <= 1) { continue; }
      let off = vec2i(dx, dy) * I.stride;
      let q = p + off;
      if (!inside(q)) { continue; }
      let gq = geoTap(geoCur, q);
      if (gq.z <= 0.0) { continue; }
      let s = textureLoad(srcTex, q, 0);
      let w = B3[dx + 2] * B3[dy + 2] * wGeo(g, gq, vec2f(off)) * exp(-abs(luma(s.rgb) - lc) / lumDenom);
      sumC += s.rgb * w;
      sumV += s.a * w * w;
      sumW += w;
    }
  }`}
  let outC = sumC / sumW;
  let outV = sumV / (sumW * sumW);
  ${store('outC', 'outV')}
  ${hist('outC')}
}
`;
}
