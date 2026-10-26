// SVGF passes (temporal accumulation, variance estimation, edge-avoiding
// a-trous) for one or two signals per dispatch (SPEC §4.1: diffuse + specular
// share dispatches, so geometry loads and the reprojection are done once).
// Ported from Dennis Smolek's own SVGF in the ssgiDev bench (demo 14, written
// from the SVGF paper; see docs/research/rt-denoiser/sources/ssgi-svgf-review.md)
// with the review's upgrades. Sources (public; full table in
// docs/research/rt-denoiser/PROVENANCE.md):
//
// - Schied et al. 2017, "Spatiotemporal Variance-Guided Filtering", HPG:
//   sec. 4.1 temporal accumulation (2x2 per-tap validity, 3x3 fallback, EMA
//   alpha = 0.2), sec. 4.2 moments + variance (spatial 7x7 bilateral estimate
//   while history < 4 frames), sec. 4.3 a-trous with B3 5x5 kernel, feedback of
//   iteration 0 as color history, variance propagated as sum(w^2 var)/sum(w)^2,
//   sec. 4.4 edge-stopping functions eq. 3-5 (sigma_z = 1, sigma_n = 128,
//   sigma_l = 4, 3x3 Gaussian variance prefilter).
// - Schied et al. 2018, A-SVGF (PACMCGIT 1(2) art. 24) and its BSD-3 reference
//   code (a_svgf.zip, Copyright (c) 2018 Christoph Schied, see NOTICE):
//   alpha = max(alpha, 1/(n+1)) start-up, history cap 64, 3x3 box kernel
//   (sec. 4), spatial-variance boost 1 + 3 (1 - n/4) and filtered color for
//   young history, 5x5 footprint once n > 1.
// - SPEC v0 (docs/research/rt-denoiser/SPEC.md): S-2a (standard deviation
//   stored instead of variance), S-3 (depth weight on q = 1/d), R-1 (GGX lobe
//   half-angle theta_L, our derivation), R-7/R-8 (specular surface-motion
//   history cap from lobe angle, N.V and parallax: our design from RTG II
//   sec. 49.8.1 prose; the chapter's listings are not used).
// - Specular weights: Ray Tracing Gems ch. 32 (Hirvonen et al. 2019) sec.
//   32.4.1 eq. 14 (roughness similarity) and eq. 15 (roughness radius); normal
//   cutoff at theta_L with a linear falloff (shape: Zhdan, GTC 2020, slide 46).
// - Our design: smooth temporal->spatial variance ramp (ssgiDev demo 14);
//   variance prefilter from the inner taps at stride > 1; depth slope from the
//   prepass; per-tap angle ratio in cosine space.
import { Bindings, type PassDef } from './bindings';
import { FRAME_WGSL, REPROJECT_WGSL } from './common';

export type SignalKind = 'diffuse' | 'specular';

/** Params.flags */
export const P_CATMULL = 1;
export const P_ANTILAG = 2;
export const P_REMODULATE = 4;
export const P_GRADIENT_INPUT = 8;
export const P_KERNEL_BOX3 = 16;
export const P_VAR_OF_MEAN = 32;
export const P_SPEC_NORMAL_POWER = 64;

export const PARAMS_SIZE = 256;

export const PARAMS_STRUCT = /* wgsl */ `
struct Params {
  alpha: f32, momentsAlpha: f32, maxHistory: f32, planeTol: f32,
  normalTol: f32, sigmaZ: f32, sigmaN: f32, sigmaL: f32,
  rampFrames: f32, varBoost: f32, specScale: f32, specKappa: f32,
  lobeFraction: f32, gradNoiseK: f32, radiusScale: f32, flags: u32,
  gradRadius: i32, gradDown: i32, gradDims: vec2i,
  varRadius: i32, pad0: i32, pad1: i32, pad2: i32,
}
const P_CATMULL = ${P_CATMULL}u;
const P_ANTILAG = ${P_ANTILAG}u;
const P_REMODULATE = ${P_REMODULATE}u;
const P_GRADIENT_INPUT = ${P_GRADIENT_INPUT}u;
const P_KERNEL_BOX3 = ${P_KERNEL_BOX3}u;
const P_VAR_OF_MEAN = ${P_VAR_OF_MEAN}u;
const P_SPEC_NORMAL_POWER = ${P_SPEC_NORMAL_POWER}u;
fn finite3(c: vec3f) -> vec3f {
  let b = bitcast<vec3u>(c) & vec3u(0x7f800000u);
  return select(c, vec3f(0.0), b == vec3u(0x7f800000u));
}
`;

/** Per-signal edge-stopping functions, suffixed with the signal index. */
export function weightsWgsl(kind: SignalKind, i: number, youngRelax = false): string {
  const P = `P${i}`;
  // youngRelax (target 1 candidate youngNormalPower): the power form's exponent is a per-centre private
  const sN = youngRelax ? `sigmaNEff${i}` : `${P}.sigmaN`;
  const decl = youngRelax ? `var<private> sigmaNEff${i}: f32 = 128.0;\n` : '';
  const normal = kind === 'diffuse'
    ? /* wgsl */ `
${decl}fn setCenter${i}(g: Geo) { }
fn wNormal${i}(g: Geo, gq: Geo) -> f32 { return pow(max(0.0, dot(g.n, gq.n)), ${sN}); }`
    : /* wgsl */ `
// Specular normal edge-stop: cutoff at the GGX lobe half-angle theta_L + 1 deg,
// linear in the angle; per tap the angle ratio is sqrt((1 - cos)/(1 - cos0)),
// = theta/theta0 to second order (no acos per tap). Or SVGF's power form.
var<private> cosLimit${i}: f32 = 0.0;
${decl}fn setCenter${i}(g: Geo) {
  let a = g.rough * g.rough;
  cosLimit${i} = cos(atan(a * sqrt(${P}.lobeFraction / (1.0 - ${P}.lobeFraction))) + 0.0174533);
}
fn wNormal${i}(g: Geo, gq: Geo) -> f32 {
  let d = dot(g.n, gq.n);
  if ((${P}.flags & P_SPEC_NORMAL_POWER) != 0u) { return pow(max(0.0, d), ${sN}); }
  return clamp(1.0 - sqrt(max(0.0, 1.0 - d) / max(1.0 - cosLimit${i}, 1e-7)), 0.0, 1.0);
}
// RTG ch. 32 eq. 14-15: f_w(a, b, x) = 1 - smoothstep(a, b, x)
fn wSpec${i}(g: Geo, gq: Geo, dist: f32) -> f32 {
  var w = 1.0 - smoothstep(0.01, 0.1, abs(g.rough - gq.rough));
  if (${P}.radiusScale > 0.0) {
    let r = max(g.rough, 1e-3) * ${P}.radiusScale;
    w *= 1.0 - smoothstep(10.0 * r, 70.0 * r, dist);
  }
  return w;
}`;
  return /* wgsl */ `
// SVGF eq. 3 on q = 1/d (affine in screen space on planes, like the paper's
// clip depth): difference relative to the local plane (SPEC S-3).
fn wDepth${i}(g: Geo, gq: Geo, off: vec2f) -> f32 {
  let q = 1.0 / g.z;
  let s = ${P}.sigmaZ * abs(dot(-g.grad * (q * q), off)) + 1e-3 * q;
  return exp(-abs(1.0 / gq.z - q) / s);
}
${normal}
fn wGeo${i}(g: Geo, gq: Geo, off: vec2f) -> f32 {
  return wDepth${i}(g, gq, off) * wNormal${i}(g, gq)${kind === 'specular' ? ` * wSpec${i}(g, gq, length(off))` : ''};
}
`;
}

export const header = (b: Bindings) => /* wgsl */ `
${FRAME_WGSL}
${PARAMS_STRUCT}
${b.wgsl}
fn geoCenter(p: vec2i) -> Geo {
  var g = geoTap(geoCur, p);
  g.grad = unpack2x16float(textureLoad(geoGrad, p, 0).r);
  return g;
}
`;

export function baseBindings(kinds: SignalKind[]) {
  const b = new Bindings();
  b.uniform('F', 'Frame');
  kinds.forEach((_, i) => b.uniform(`P${i}`, 'Params'));
  b.add('geoCur', 'texture_2d<u32>', 'i');
  b.add('geoGrad', 'texture_2d<u32>', 'i');
  return b;
}

// ---- temporal accumulation ------------------------------------------------------

export function capWgsl(kind: SignalKind, i: number): string {
  const P = `P${i}`;
  if (kind === 'diffuse') return `fn historyCap${i}(g: Geo, world: vec3f, expPrev: vec3f) -> f32 { return ${P}.maxHistory; }`;
  return /* wgsl */ `
// Surface-motion history cap for specular (SPEC R-7/R-8, our design): the
// reflection slides by about the parallax angle per frame; history stays sharp
// while the accumulated slide stays inside the lobe half-angle theta_L.
// Returns frames incl. the current one.
fn historyCap${i}(g: Geo, world: vec3f, expPrev: vec3f) -> f32 {
  let vCur = normalize(world - F.camPos);
  let prevWorld = (F.prevViewInv * vec4f(expPrev, 1.0)).xyz;
  let vPrev = normalize(prevWorld - F.prevCamPos);
  let c = clamp(dot(vCur, vPrev), -1.0, 1.0);
  let parallax = sqrt(max(0.0, 1.0 - c * c)) / max(c, 1e-4);
  let NoV = max(dot(g.n, -vCur), 1e-4);
  let a = g.rough * g.rough;
  let thetaL = atan(a * sqrt(${P}.lobeFraction / (1.0 - ${P}.lobeFraction)));
  let aSpec = ${P}.specScale * thetaL * pow(NoV, ${P}.specKappa) / max(parallax, 1e-4);
  return clamp(aSpec + 1.0, 1.0, ${P}.maxHistory);
}`;
}

export function antilagWgsl(i: number): string {
  // lambda per stratum, already max-filtered (gradient.ts gradientLambdaPass)
  return `fn antilagLambda${i}(p: vec2i) -> f32 {
  return textureLoad(grad${i}, min(p / P${i}.gradDown, P${i}.gradDims - 1), 0).r;
}`;
}

/**
 * Reflection reprojection of a specular signal's history (option `reflectionReprojection`, review target 2,
 * docs/research/rt-denoiser/results/REFLECTION-MOTION.md). 'virtual': fetch the history where the reflected image was
 * (X + v d_v F_dom, d_v = h / (1 + 2 kappa h)): Stachowiak 2015 (SIGGRAPH Advances, "Stochastic Screen-Space
 * Reflections": reproject reflections with the depth of the reflected objects, not the surface's), curvature from the
 * neighbouring normals and F_dom as SPEC R-9 / R-2; the surface history where the virtual footprint fails (our design).
 * 'dual': both candidates, weighted by how far each one's luminance is from this frame's 3x3 input mean (Eto et al.
 * 2023, SIGGRAPH Asia Tech. Comm., §2.4.2, after Stachowiak 2018: two reprojection points, blended by brightness
 * difference to the current colour). Compiled in only when on (default path unchanged).
 */
export type ReflectionReprojection = 'surface' | 'virtual' | 'dual';
/**
 * Per signal: `reflection` = reprojection mode; `hitTest` = also drop surface-history taps whose stored hit distance
 * disagrees with this frame's (option `reflectionHitTest`; the virtual candidate always has the test). Our design:
 * a reflected-world disocclusion test, the reflection analogue of SVGF's depth test (S1 sec. 4.1).
 */
export interface TemporalVariant { reflection?: ReflectionReprojection[]; hitTest?: boolean[] }

/** WGSL shared by every signal with a reflection reprojection variant (needs F, geoCur, geoPrev, REPROJECT_WGSL). */
const VIRTUAL_WGSL = /* wgsl */ `
// previous-frame uv of a world point (affine inversion of prevProjInv at the point's view depth; any projection
// the unprojectZ() pair handles); (-1, -1) behind the previous camera
fn prevUVOfWorld(w: vec3f) -> vec2f {
  let pv = (F.prevView * vec4f(w, 1.0)).xyz;
  if (!(pv.z < -1e-5)) { return vec2f(-1.0); }
  let a = unprojectZ(F.prevProjInv, vec2f(0.0), pv.z);
  let bx = unprojectZ(F.prevProjInv, vec2f(1.0, 0.0), pv.z) - a;
  let by = unprojectZ(F.prevProjInv, vec2f(0.0, 1.0), pv.z) - a;
  let d = pv - a;
  let det = bx.x * by.y - by.x * bx.y;
  if (abs(det) < 1e-20) { return vec2f(-1.0); }
  let ndc = vec2f(d.x * by.y - by.x * d.y, bx.x * d.y - d.x * bx.y) / det;
  return vec2f(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5);
}
// the shared reprojection's footprint tests at another previous uv (the virtual image's), against the surface's
// expected previous position: on a flat reflector the previous texels there lie on the same plane (SPEC R-10)
fn reprojectAtUV(prevUV: vec2f, g: Geo, expPrev: vec3f, planeTol: f32, normalTol: f32) -> Reproj {
  var r: Reproj;
  r.prevUV = prevUV;
  r.expPrev = expPrev;
  let pp = prevUV * F.dims - 0.5;
  r.base = vec2i(floor(pp));
  let f = pp - floor(pp);
  let bil = vec4f((1.0 - f.x) * (1.0 - f.y), f.x * (1.0 - f.y), (1.0 - f.x) * f.y, f.x * f.y);
  var valid = vec4f(0.0);
  if (tapValid(r.base, g, expPrev, planeTol, normalTol)) { valid.x = 1.0; }
  if (tapValid(r.base + vec2i(1, 0), g, expPrev, planeTol, normalTol)) { valid.y = 1.0; }
  if (tapValid(r.base + vec2i(0, 1), g, expPrev, planeTol, normalTol)) { valid.z = 1.0; }
  if (tapValid(r.base + vec2i(1, 1), g, expPrev, planeTol, normalTol)) { valid.w = 1.0; }
  r.w = bil * valid;
  r.bil = bil;
  r.valid = valid;
  r.sumW = r.w.x + r.w.y + r.w.z + r.w.w;
  r.allValid = all(valid > vec4f(0.5));
  return r;
}
fn worldAt(q: vec2i, z: f32) -> vec3f { return (F.viewInv * vec4f(unprojectZ(F.projInv, ndcOf(uvOf(q)), -z), 1.0)).xyz; }
fn geoWorld(p: vec2i, g: Geo) -> vec3f { return worldAt(p, g.z); }
// mean curvature along the 4 axis neighbours on the same surface: dot(n_q - n, X_q - X) / |X_q - X|^2 (convex > 0)
fn surfaceCurvature(p: vec2i, g: Geo, X: vec3f) -> f32 {
  var s = 0.0;
  var c = 0.0;
  for (var k = 0; k < 4; k++) {
    let q = p + select(select(vec2i(0, 1), vec2i(0, -1), k == 2), select(vec2i(1, 0), vec2i(-1, 0), k == 0), k < 2);
    if (!inside(q)) { continue; }
    let gq = geoTap(geoCur, q);
    if (gq.z <= 0.0 || abs(gq.z - g.z) > 0.05 * g.z || dot(gq.n, g.n) < 0.5) { continue; }
    let dX = worldAt(q, gq.z) - X;
    s += dot(gq.n - g.n, dX) / max(dot(dX, dX), 1e-12);
    c += 1.0;
  }
  return s / max(c, 1.0);
}
`;

/**
 * per-signal virtual uv (xy; (-1, -1) = none) and this frame's 3x3 mean hit distance (z; hits only, mostly misses =
 * F.far), SPEC R-9 distance with curvature
 */
function virtualUvWgsl(i: number, needUV = true): string {
  return /* wgsl */ `
fn virtualUV${i}(p: vec2i, g: Geo, X: vec3f) -> vec4f {
  var hs = 0.0;
  var nh = 0.0;
  var nv = 0.0;
  var lo = 1e30;
  var hi = 0.0;
  for (var dy = -1; dy <= 1; dy++) {
    for (var dx = -1; dx <= 1; dx++) {
      let q = p + vec2i(dx, dy);
      if (!inside(q)) { continue; }
      let gq = geoTap(geoCur, q);
      if (gq.z <= 0.0 || abs(gq.z - g.z) > 0.05 * g.z) { continue; }
      nv += 1.0;
      let h = textureLoad(hit${i}, q, 0).r;
      let ok = h > 0.0 && h < 1e30;
      if (ok) { hs += h; nh += 1.0; }
      let hq = select(F.far, h, ok);
      lo = min(lo, hq);
      hi = max(hi, hq);
    }
  }
  let h = select(F.far, hs / max(nh, 1.0), 2.0 * nh >= nv);
  // the hit-distance test's tolerance: (0.1 + 0.4 r) of the larger distance plus max(this frame's 3x3 spread, half the
  // tap's stored spread): a reflected edge, a grazing floor or a glossy lobe makes the per-frame 3x3 mean itself
  // unstable there; this frame's spread alone rejected static glossy pixels whenever their 9 samples clustered
  // (test bed light path, mirror bin -0.5 dB); the full stored spread kept trail pixels at a moving object's old edge
  let spread = max(hi - lo, 0.0);${needUV ? `
  let k = surfaceCurvature(p, g, X);
  let den = 1.0 + 2.0 * k * h;
  // past a concave mirror's focal point the image is real (inverted, in front): no virtual candidate there
  if (den < 0.05) { return vec4f(-1.0, -1.0, h, spread); }
  let a = g.rough * g.rough;
  let fdom = (1.0 - a) * (sqrt(1.0 - a) + a);
  let uv = prevUVOfWorld(X + normalize(X - F.camPos) * (h / den * fdom));
  return vec4f(select(vec2f(-1.0), uv, all(uv >= vec2f(0.0)) && all(uv <= vec2f(1.0))), h, spread);` : `
  return vec4f(-1.0, -1.0, h, spread);   // reflectionHitTest alone: no virtual candidate, only the statistics`}
}`;
}

export function temporalPass(kinds: SignalKind[], tv: TemporalVariant = {}): PassDef {
  const refl = (i: number) => (kinds[i] === 'specular' ? tv.reflection?.[i] ?? 'surface' : 'surface');
  const hitT = (i: number) => kinds[i] === 'specular' && !!tv.hitTest?.[i];
  /** this signal runs the reflection variant body (reads the hit distance, rgba32float moments) */
  const rv = (i: number) => refl(i) !== 'surface' || hitT(i);
  const anyVirt = kinds.some((_, i) => rv(i));
  const b = new Bindings();
  b.uniform('F', 'Frame');
  kinds.forEach((_, i) => b.uniform(`P${i}`, 'Params'));
  b.add('geoCur', 'texture_2d<u32>', 'i');
  b.add('geoPrev', 'texture_2d<u32>', 'i');
  b.add('motionTex', 'texture_2d<f32>', 'f');
  b.add('motionZTex', 'texture_2d<f32>', 'f');
  b.add('smp', 'sampler', 's');
  kinds.forEach((_, i) => {
    b.add(`input${i}`, 'texture_2d<f32>', 'f');
    b.add(`colorHist${i}`, 'texture_2d<f32>', 'F');
    b.add(`momentsPrev${i}`, 'texture_2d<f32>', 'f');
    b.add(`grad${i}`, 'texture_2d<f32>', 'f');
    b.add(`outAccum${i}`, 'texture_storage_2d<rgba16float, write>', 'rgba16float');
    // reflection variant: moments carry this frame's hit distance and its 3x3 spread in .b / .a (rgba32float) for the tap test
    if (rv(i)) b.add(`outMoments${i}`, 'texture_storage_2d<rgba32float, write>', 'rgba32float');
    else b.add(`outMoments${i}`, 'texture_storage_2d<rg32float, write>', 'rg32float');
    if (rv(i)) b.add(`hit${i}`, 'texture_2d<f32>', 'f');
  });
  // reflection reprojection variant of one signal (TemporalVariant): surface candidate as today (incl. the
  // 3x3 fallback and the R-8 cap), virtual candidate at virtualUV, then 'virtual' takes the virtual one where
  // its footprint is valid and 'dual' blends both by luminance distance to this frame's 3x3 input mean
  const perSignalVirt = (i: number, mode: ReflectionReprojection, hitTest: boolean) => {
    const P = `P${i}`;
    // surface taps: optional hit-distance agreement (same tolerance as the virtual taps)
    const hitOk = (m: string) => (hitTest ? `abs(${m}.b - hitCur) <= (0.1 + 0.4 * g.rough) * max(${m}.b, hitCur) + max(vv.w, 0.5 * ${m}.a)` : 'true');
    return /* wgsl */ `
  {
    let cur = finite3(max(textureLoad(input${i}, p, 0).rgb, vec3f(0.0)));
    let l = luma(cur);
    let mCur = vec2f(l, l * l);
    var n = 1.0;
    var col = cur;
    var mom = mCur;
    let vv = virtualUV${i}(p, g, geoWorld(p, g));
    let hitCur = vv.z;
    if (!reset) {
      var hist = vec3f(0.0);
      var mHist = vec2f(0.0);
      var nPrev = 0.0;
      var sumW = 0.0;
      if (r.sumW > 0.01) {
        for (var k = 0; k < 4; k++) {
          let w = r.w[k];
          if (w <= 0.0) { continue; }
          let q = r.base + TAP_OFFS[k];
          let m4 = textureLoad(momentsPrev${i}, q, 0);
          if (!(${hitOk('m4')})) { continue; }
          let c4 = textureLoad(colorHist${i}, q, 0);
          hist += c4.rgb * w;
          nPrev += c4.a * w;
          mHist += m4.rg * w;
          sumW += w;
        }
        if (sumW > 0.0) { hist /= sumW; }
      } else if (fbMask != 0u) {
        for (var k = 0u; k < 9u; k++) {
          if ((fbMask & (1u << k)) == 0u) { continue; }
          let q = fb0 + vec2i(i32(k % 3u) - 1, i32(k / 3u) - 1);
          let m4 = textureLoad(momentsPrev${i}, q, 0);
          if (!(${hitOk('m4')})) { continue; }
          let c4 = textureLoad(colorHist${i}, q, 0);
          hist += c4.rgb;
          nPrev += c4.a;
          mHist += m4.rg;
          sumW += 1.0;
        }
        if (sumW > 0.0) { hist /= sumW; }
      }
      let cap = historyCap${i}(g, r.world, r.expPrev);
      var nS = 0.0;
      if (sumW > 0.0) {
        nPrev /= sumW;
        mHist /= sumW;
        nS = min(nPrev + 1.0, cap);
      }
      // virtual candidate: footprint taps on the same surface plane whose stored hit distance agrees with this
      // frame's (a reflected-world disocclusion, e.g. sky uncovered behind a reflected object, fails it)
      var histV = vec3f(0.0);
      var mV = vec2f(0.0);
      var nV = 0.0;
      var okV = false;
      if (${mode === 'surface' ? 'false' : 'vv.x >= 0.0'}) {
        let rv = reprojectAtUV(vv.xy, g, r.expPrev, P0.planeTol, P0.normalTol);
        var sw = 0.0;
        for (var k = 0; k < 4; k++) {
          var w = rv.w[k];
          if (w <= 0.0) { continue; }
          let q = rv.base + TAP_OFFS[k];
          let m4 = textureLoad(momentsPrev${i}, q, 0);
          if (abs(m4.b - vv.z) > (0.1 + 0.4 * g.rough) * max(m4.b, vv.z) + max(vv.w, 0.5 * m4.a)) { continue; }
          let c4 = textureLoad(colorHist${i}, q, 0);
          histV += c4.rgb * w;
          nV += c4.a * w;
          mV += m4.rg * w;
          sw += w;
        }
        if (sw > 0.01) {
          okV = true;
          histV /= sw;
          mV /= sw;
          nV = min(nV / sw + 1.0, cap);
        }
      }
      ${mode !== 'dual' ? /* wgsl */ `
      if (okV) {
        hist = histV;
        mHist = mV;
        n = nV;
      } else if (sumW > 0.0) {
        n = nS;
      }` : /* wgsl */ `
      if (okV && sumW > 0.0) {
        // brightness distance of each candidate to this frame's 3x3 input mean, in units of its spread
        var s1 = 0.0;
        var s2 = 0.0;
        for (var dy = -1; dy <= 1; dy++) {
          for (var dx = -1; dx <= 1; dx++) {
            let lq = luma(finite3(max(textureLoad(input${i}, clampPix(p + vec2i(dx, dy)), 0).rgb, vec3f(0.0))));
            s1 += lq;
            s2 += lq * lq;
          }
        }
        let mu = s1 / 9.0;
        let sd = sqrt(max(s2 / 9.0 - mu * mu, 0.0)) + 0.05 * mu + 1e-4;
        let dS = (luma(hist) - mu) / sd;
        let dV = (luma(histV) - mu) / sd;
        let wS = 1.0 / (1.0 + dS * dS);
        let wV = 1.0 / (1.0 + dV * dV);
        // glossy and rough surfaces: the noisy 3x3 mean cannot tell the candidates apart, and a blend of two
        // histories blurs (measured: rm-cam-plane-r20..r50 and the r 0.9 floor lost up to 5 dB): fade out by r 0.2
        let t = wV / (wS + wV) * (1.0 - smoothstep(0.1, 0.2, g.rough));
        hist = mix(hist, histV, t);
        mHist = mix(mHist, mV, t);
        n = mix(nS, nV, t);
      } else if (okV) {
        hist = histV;
        mHist = mV;
        n = nV;
      } else if (sumW > 0.0) {
        n = nS;
      }`}
      if (sumW > 0.0 || okV) {
        var a = max(${P}.alpha, 1.0 / n);
        var am = max(${P}.momentsAlpha, 1.0 / n);
        if ((${P}.flags & P_ANTILAG) != 0u) {
          let lam = antilagLambda${i}(p);
          a = mix(a, 1.0, lam);
          am = mix(am, 1.0, lam);
          n = min(n, 1.0 / mix(1.0 / n, 1.0, lam));
        }
        col = mix(finite3(hist), cur, a);
        mom = mix(mHist, mCur, am);
      }
    }
    textureStore(outAccum${i}, p, vec4f(col, n));
    textureStore(outMoments${i}, p, vec4f(mom, hitCur, vv.w));
  }`;
  };
  const perSignal = (i: number) => {
    const P = `P${i}`;
    return /* wgsl */ `
  {
    let cur = finite3(max(textureLoad(input${i}, p, 0).rgb, vec3f(0.0)));
    let l = luma(cur);
    let mCur = vec2f(l, l * l);
    var n = 1.0;
    var col = cur;
    var mom = mCur;
    if (!reset) {
      var hist = vec3f(0.0);
      var mHist = vec2f(0.0);
      var nPrev = 0.0;
      var sumW = 0.0;
      if (r.sumW > 0.01) {
        var lo = vec3f(1e30);
        var hi = vec3f(-1e30);
        for (var k = 0; k < 4; k++) {
          let w = r.w[k];
          if (w <= 0.0) { continue; }
          let q = r.base + TAP_OFFS[k];
          // alpha = history length n in both history layouts (accum, and the
          // feedback history that a-trous iteration 0 writes)
          let c4 = textureLoad(colorHist${i}, q, 0);
          let c = c4.rgb;
          lo = min(lo, c);
          hi = max(hi, c);
          hist += c * w;
          nPrev += c4.a * w;
          mHist += textureLoad(momentsPrev${i}, q, 0).rg * w;
        }
        sumW = r.sumW;
        hist /= sumW;
        if ((${P}.flags & P_CATMULL) != 0u && r.allValid) {
          hist = clamp(sampleCatmullRom(colorHist${i}, smp, r.prevUV).rgb, lo, hi);
        }
      } else if (fbMask != 0u) {
        for (var k = 0u; k < 9u; k++) {
          if ((fbMask & (1u << k)) == 0u) { continue; }
          let q = fb0 + vec2i(i32(k % 3u) - 1, i32(k / 3u) - 1);
          let c4 = textureLoad(colorHist${i}, q, 0);
          hist += c4.rgb;
          nPrev += c4.a;
          mHist += textureLoad(momentsPrev${i}, q, 0).rg;
          sumW += 1.0;
        }
        hist /= sumW;
      }
      if (sumW > 0.0) {
        nPrev /= sumW;
        mHist /= sumW;
        n = min(nPrev + 1.0, historyCap${i}(g, r.world, r.expPrev));
        var a = max(${P}.alpha, 1.0 / n);
        var am = max(${P}.momentsAlpha, 1.0 / n);
        if ((${P}.flags & P_ANTILAG) != 0u) {
          let lam = antilagLambda${i}(p);
          a = mix(a, 1.0, lam);
          am = mix(am, 1.0, lam);
          // A-SVGF code: n = 1/alpha. Compounded every frame, a persistent lambda settles at
          // n ~ 1/sqrt(lambda), so it only stays long where lambda is exactly 0 (v2's noise
          // floor); a residual lambda of a real drift (view-dependent specular) keeps
          // shortening it, which the test bed rewards (results/M1.md §12).
          n = min(n, 1.0 / mix(1.0 / n, 1.0, lam));
        }
        col = mix(finite3(hist), cur, a);
        mom = mix(mHist, mCur, am);
      }
    }
    textureStore(outAccum${i}, p, vec4f(col, n));
    textureStore(outMoments${i}, p, vec4f(mom, 0.0, 0.0));
  }`;
  };
  const code = /* wgsl */ `
${FRAME_WGSL}
${PARAMS_STRUCT}
${b.wgsl}
${REPROJECT_WGSL}
${kinds.map((k, i) => capWgsl(k, i) + antilagWgsl(i)).join('\n')}${anyVirt ? '\n' + VIRTUAL_WGSL + kinds.map((_, i) => (rv(i) ? virtualUvWgsl(i, refl(i) !== 'surface') : '')).join('\n') : ''}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let p = vec2i(gid.xy);
  if (!inside(p)) { return; }
  let g = geoTap(geoCur, p);
  if (g.z <= 0.0) {   // sky / no surface: output 0 (SPEC 1.1)
    ${kinds.map((_, i) => `textureStore(outAccum${i}, p, vec4f(0.0, 0.0, 0.0, 1.0));
    textureStore(outMoments${i}, p, vec4f(0.0));`).join('\n    ')}
    return;
  }
  // Shared reprojection (geometry tolerances of the first signal).
  let reset = hasFlag(FRAME_RESET);
  var r: Reproj;
  var fbMask = 0u;
  var fb0 = vec2i(0);
  if (!reset) {
    r = reproject(p, g, P0.planeTol, P0.normalTol);
    if (r.sumW <= 0.01) {
      // SVGF sec. 4.1: 3x3 fallback (thin geometry), equal weights.
      fb0 = vec2i(floor(r.prevUV * F.dims));
      for (var k = 0u; k < 9u; k++) {
        if (tapValid(fb0 + vec2i(i32(k % 3u) - 1, i32(k / 3u) - 1), g, r.expPrev, P0.planeTol, P0.normalTol)) {
          fbMask |= 1u << k;
        }
      }
    }
  }
${kinds.map((_, i) => (rv(i) ? perSignalVirt(i, refl(i), hitT(i)) : perSignal(i))).join('\n')}
}
`;
  return { code, entries: b.entries };
}

// ---- variance estimation --------------------------------------------------------

/**
 * Options of the variance pass. `historyWeight[i]` (target 1 candidate `spatialHistoryWeight`, our design;
 * results/T1-recovery.md): in the young-history spatial estimate, weight each neighbour also by its own
 * history length n_q, capped at bitcast<f32>(Params.pad0) (inverse-variance weighting of neighbours that
 * average n_q samples), so a young pixel next to valid history takes its colour and moments mostly from
 * there. Compiled in only when on (default path unchanged).
 */
export interface VarianceVariant { historyWeight?: boolean[] }

export function variancePass(kinds: SignalKind[], vv: VarianceVariant = {}): PassDef {
  const b = baseBindings(kinds);
  kinds.forEach((_, i) => {
    b.add(`accumCur${i}`, 'texture_2d<f32>', 'f');
    b.add(`momentsCur${i}`, 'texture_2d<f32>', 'f');
    b.add(`outPing${i}`, 'texture_storage_2d<rgba16float, write>', 'rgba16float');
  });
  const I = kinds.map((_, i) => i);
  const code = /* wgsl */ `
${header(b)}
${kinds.map((k, i) => weightsWgsl(k, i)).join('\n')}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let p = vec2i(gid.xy);
  if (!inside(p)) { return; }
  let g = geoCenter(p);
  if (g.z <= 0.0) {
    ${I.map((i) => `textureStore(outPing${i}, p, vec4f(0.0));`).join(' ')}
    return;
  }
  ${I.map((i) => /* wgsl */ `
  setCenter${i}(g);
  let a${i} = textureLoad(accumCur${i}, p, 0);
  let m${i} = textureLoad(momentsCur${i}, p, 0).rg;
  var varT${i} = max(0.0, m${i}.y - m${i}.x * m${i}.x);
  // Optional (our variant): variance of the accumulated mean.
  if ((P${i}.flags & P_VAR_OF_MEAN) != 0u) { varT${i} *= max(P${i}.alpha / (2.0 - P${i}.alpha), 1.0 / max(a${i}.a, 1.0)); }
  let t${i} = clamp((a${i}.a - 1.0) / max(P${i}.rampFrames - 1.0, 1e-3), 0.0, 1.0);
  let rad${i} = min(select(select(2, 3, a${i}.a < 2.0), 0, t${i} >= 1.0), P${i}.varRadius);
  var sc${i} = a${i}.rgb;
  var sm${i} = m${i};
  var sw${i} = 1.0;`).join('')}
  // Young history: bilateral spatial estimate of color and moments (SVGF sec.
  // 4.2: 7x7; A-SVGF code: 5x5 once n > 1), blended in smoothly. One loop for
  // all signals, each masked to its own radius.
  let r = max(${I.map((i) => `rad${i}`).join(', ')}${kinds.length === 1 ? ', 0' : ''});
  for (var dy = -r; dy <= r; dy++) {
    for (var dx = -r; dx <= r; dx++) {
      if (dx == 0 && dy == 0) { continue; }
      let q = p + vec2i(dx, dy);
      if (!inside(q)) { continue; }
      let gq = geoTap(geoCur, q);
      if (gq.z <= 0.0) { continue; }
      let off = vec2f(f32(dx), f32(dy));
      let ring = max(abs(dx), abs(dy));
      ${I.map((i) => /* wgsl */ `
      if (ring <= rad${i}) {${vv.historyWeight?.[i] ? `
        let aq${i} = textureLoad(accumCur${i}, q, 0);
        let w = wGeo${i}(g, gq, off) * min(aq${i}.a, bitcast<f32>(P${i}.pad0));
        sc${i} += aq${i}.rgb * w;` : `
        let w = wGeo${i}(g, gq, off);
        sc${i} += textureLoad(accumCur${i}, q, 0).rgb * w;`}
        sm${i} += textureLoad(momentsCur${i}, q, 0).rg * w;
        sw${i} += w;
      }`).join('')}
    }
  }
  ${I.map((i) => /* wgsl */ `
  {
    // alpha holds the standard deviation (SPEC S-2a: sigma^2 overflows fp16 on HDR).
    if (t${i} >= 1.0) {
      textureStore(outPing${i}, p, vec4f(a${i}.rgb, sqrt(varT${i})));
    } else {
      let c = sc${i} / sw${i};
      let m = sm${i} / sw${i};
      let varS = (1.0 + P${i}.varBoost * max(0.0, 1.0 - a${i}.a / P${i}.rampFrames)) * max(0.0, m.y - m.x * m.x);
      textureStore(outPing${i}, p, vec4f(mix(c, a${i}.rgb, t${i}), sqrt(mix(varS, varT${i}, t${i}))));
    }
  }`).join('')}
}
`;
  return { code, entries: b.entries };
}

// ---- a-trous ----------------------------------------------------------------------

export interface AtrousVariant {
  /** Write the result as next frame's color history (feedback, iteration 0). */
  writeHist: boolean;
  /** Last iteration: write the output texture (optionally remodulated). */
  last: boolean;
  /** 3x3 box (A-SVGF) instead of the 5x5 B3 spline. */
  box: boolean;
  /**
   * Per signal (target 1 candidates `youngLuminanceWeight` / `youngNormalPower`, our design;
   * results/T1-recovery.md): relax the edge-stopping of young pixels. t = (n - 1) / (rampFrames - 1) clamped,
   * n the centre's history length; the luminance exponent is scaled by mix(k, 1, t), k = bitcast<f32>(pad1);
   * the normal power form's exponent is exp2(mix(log2 s, log2 sigmaN, t)), s = bitcast<f32>(pad2) when > 0.
   * Compiled in only when on (default path unchanged).
   */
  youngLum?: boolean[];
}

export const B3 = [0.0625, 0.25, 0.375, 0.25, 0.0625];
export const f32s = (x: number) => (Number.isInteger(x) ? x.toFixed(1) : String(x));

export function atrousPass(kinds: SignalKind[], v: AtrousVariant): PassDef {
  const b = baseBindings(kinds);
  b.uniform('I', 'Iter');
  kinds.forEach((_, i) => {
    b.add(`src${i}`, 'texture_2d<f32>', 'f');
    b.add(`accumCur${i}`, 'texture_2d<f32>', 'f');
    b.add(`demod${i}`, 'texture_2d<f32>', 'f');
    b.add(`dst${i}`, 'texture_storage_2d<rgba16float, write>', 'rgba16float');
    if (v.writeHist) b.add(`hist${i}`, 'texture_storage_2d<rgba16float, write>', 'rgba16float');
  });
  const I = kinds.map((_, i) => i);
  const inner: [number, number][] = [];
  for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) inner.push([x, y]);
  const outer: [number, number][] = [];
  if (!v.box) for (let y = -2; y <= 2; y++) for (let x = -2; x <= 2; x++) if (Math.abs(x) > 1 || Math.abs(y) > 1) outer.push([x, y]);
  const h = (x: number, y: number) => (v.box ? 1 : B3[x + 2] * B3[y + 2]);
  const store = (i: number, c: string, sd: string) => v.last
    ? `textureStore(dst${i}, p, vec4f(${c} * select(vec3f(1.0), textureLoad(demod${i}, p, 0).rgb, (P${i}.flags & P_REMODULATE) != 0u), 1.0));`
    : `textureStore(dst${i}, p, vec4f(${c}, ${sd}));`;
  const hist = (i: number, c: string) => v.writeHist ? `textureStore(hist${i}, p, vec4f(${c}, textureLoad(accumCur${i}, p, 0).a));` : '';
  // one tap: geometry once, then per signal
  const tap = (x: number, y: number, sample: (i: number) => string) => /* wgsl */ `
  {
    let off = vec2i(${x}, ${y}) * I.stride;
    let q = p + off;
    if (inside(q)) {
      let gq = geoTap(geoCur, q);
      if (gq.z > 0.0) {
        ${I.map((i) => /* wgsl */ `{
          let s = ${sample(i)};
          let w = ${f32s(h(x, y))} * wGeo${i}(g, gq, vec2f(off)) * exp(-abs(luma(s.rgb) - lc${i}) ${v.youngLum?.[i] ? `* lumK${i} ` : ''}/ lumDenom${i});
          sumC${i} += s.rgb * w;
          sumV${i} += s.a * s.a * w * w;
          sumW${i} += w;
        }`).join('\n        ')}
      }
    }
  }`;
  const code = /* wgsl */ `
${header(b)}
struct Iter { stride: i32, iteration: i32, pad0: i32, pad1: i32 }
${kinds.map((k, i) => weightsWgsl(k, i, !!v.youngLum?.[i])).join('\n')}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let p = vec2i(gid.xy);
  if (!inside(p)) { return; }
  let g = geoCenter(p);
  ${I.map((i) => `let c${i} = textureLoad(src${i}, p, 0);`).join('\n  ')}
  if (g.z <= 0.0) {
    ${I.map((i) => `${store(i, `c${i}.rgb`, `c${i}.a`)} ${hist(i, `c${i}.rgb`)}`).join('\n    ')}
    return;
  }
  // SVGF sec. 4.4: a 3x3 Gaussian of the variance drives the luminance weight
  // only. The 3x3 taps are the inner taps of this iteration's kernel, loaded once
  // and reused (exactly the paper's prefilter at stride 1; wider at larger
  // strides: our approximation).
  ${I.map((i) => /* wgsl */ `
  setCenter${i}(g);
  ${inner.map(([x, y], k) => `let s${i}_${k} = ${x === 0 && y === 0 ? `c${i}` : `textureLoad(src${i}, clampPix(p + vec2i(${x}, ${y}) * I.stride), 0)`};`).join('\n  ')}
  let gVar${i} = (${inner.map(([x, y], k) => `${(2 - Math.abs(x)) * (2 - Math.abs(y))}.0 * s${i}_${k}.a * s${i}_${k}.a`).join(' + ')}) / 16.0;
  let lc${i} = luma(c${i}.rgb);
  let lumDenom${i} = P${i}.sigmaL * sqrt(max(gVar${i}, 0.0)) + 1e-10;${v.youngLum?.[i] ? `
  let tY${i} = clamp((textureLoad(accumCur${i}, p, 0).a - 1.0) / max(P${i}.rampFrames - 1.0, 1e-3), 0.0, 1.0);
  let lumK${i} = mix(bitcast<f32>(P${i}.pad1), 1.0, tY${i});
  let sY${i} = bitcast<f32>(P${i}.pad2);
  sigmaNEff${i} = select(P${i}.sigmaN, exp2(mix(log2(max(sY${i}, 1e-3)), log2(P${i}.sigmaN), tY${i})), sY${i} > 0.0);` : ''}
  let hc${i} = ${f32s(h(0, 0))};
  var sumC${i} = c${i}.rgb * hc${i};
  var sumV${i} = c${i}.a * c${i}.a * hc${i} * hc${i};
  var sumW${i} = hc${i};`).join('')}
  ${inner.map(([x, y], k) => (x === 0 && y === 0 ? '' : tap(x, y, (i) => `s${i}_${k}`))).join('')}
  ${outer.map(([x, y]) => tap(x, y, (i) => `textureLoad(src${i}, q, 0)`)).join('')}
  ${I.map((i) => /* wgsl */ `
  {
    let outC = sumC${i} / sumW${i};
    let outS = sqrt(sumV${i}) / sumW${i};   // standard deviation
    ${store(i, 'outC', 'outS')}
    ${hist(i, 'outC')}
  }`).join('')}
}
`;
  return { code, entries: b.entries };
}
