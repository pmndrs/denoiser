// Directional (SH) payload helpers for the SVGF family (SPEC v0.3 §8.5, M7).
//
// Payload per pixel: L1 spherical harmonics of the luma (YCoCg Y) in the
// evaluation-ready form Y(w) = a + b.w, chroma Co / Cg as L0 (no direction),
// world space. Stored as 8 x f16 in one rgba32uint: (a, b.x, b.y, b.z, Co, Cg,
// s0, s1); s0 / s1 carry what the plain buffers kept in alpha (history length,
// standard deviation, Y at the guide normal).
//
// Sources (public; see docs/research/rt-denoiser/PROVENANCE.md, M7 rows):
// - L1 luma + L0 chroma in YCoCg as a denoiser payload: Kuenlin, "Raytracing in
//   Snowdrop", GDC 2024, p.30; Leblanc & Conte, "Ray Tracing the World of
//   Assassin's Creed Shadows", SIGGRAPH 2025 Advances, s.57-59 (descriptions only;
//   no code from either deck is used). YCoCg: Malvar & Sullivan 2003.
// - Clamped-cosine band factors (1/4 and 1/2 in this evaluation-ready form):
//   Ramamoorthi & Hanrahan, SIGGRAPH 2001.
// - Our design (SPEC M7-2, M7-5, M7-8, M7-9): the per-sample encoding renormalized
//   to be exact at the sampling normal, the guide luminance at the filter's normal,
//   the value-preserving ringing guard, chroma as a ratio to Y at the guide normal,
//   the sharpening by ambient + one extracted light renormalized at the guide normal
//   (light extraction from L1 luma: idea of Snowdrop GDC 2024 p.37, description only).

/** shPack as written below (pack2x16float rounds to nearest). */
export const SH_PACK_NEAREST = 'return vec4u(pack2x16float(y.xy), pack2x16float(y.zw), pack2x16float(c.xy), pack2x16float(c.zw));';
/**
 * Test-only replacement (`shPackTruncate`): rounds toward zero like this GPU's rgba16float storage
 * writes (Metal in Chrome truncates; measured), so SH and plain SVGF can be compared at equal precision.
 */
export const SH_PACK_TRUNCATE = /* wgsl */ `return vec4u(shTr(y.xy), shTr(y.zw), shTr(c.xy), shTr(c.zw));
}
fn shTr(v: vec2f) -> u32 {
  var u = pack2x16float(v);
  let r = unpack2x16float(u);
  if (abs(r.x) > abs(v.x) && (u & 0x7fffu) != 0u) { u = u - 1u; }
  if (abs(r.y) > abs(v.y) && (u & 0x7fff0000u) != 0u) { u = u - 0x10000u; }
  return u;`;

/**
 * 64-bit packing of a filtered payload + standard deviation (SPEC M7-3 tune, for the non-accumulating
 * a-trous ping-pong only): the six coefficients as 8-bit snorm of a shared scale S (an 8-bit exponent in
 * quarter stops, S >= max |coefficient| and >= sigma / 128), sigma as an 8-bit log of sigma / S
 * (1/16-stop steps). Layout: x = (a, b.x, b.y, b.z), y = Co | Cg << 8 | exponent << 16 | sigma << 24.
 * Idea of the 6 x 8-bit + shared magnitude layout: SD24 p.30 / ACS25 s.57 (descriptions); this
 * exponent / sigma layout is ours. Needs SH_CORE_WGSL.
 */
export const SH_PACK64_WGSL = /* wgsl */ `
fn shPack64(p: SH) -> vec2u {
  let m = max(max(max(abs(p.y.x), abs(p.y.y)), max(abs(p.y.z), abs(p.y.w))), max(max(abs(p.c.x), abs(p.c.y)), p.c.z * (1.0 / 128.0)));
  if (!(m > 1e-30)) { return vec2u(0u); }
  let e = u32(clamp(i32(ceil(4.0 * log2(m))) + 128, 0, 255));
  let sq = exp2((f32(e) - 128.0) * 0.25);
  let inv = 1.0 / sq;
  let k = select(0u, u32(clamp(round(16.0 * log2(p.c.z * inv) + 128.0), 1.0, 255.0)), p.c.z > 0.0);
  return vec2u(pack4x8snorm(p.y * inv), (pack4x8snorm(vec4f(p.c.xy * inv, 0.0, 0.0)) & 0xffffu) | (e << 16u) | (k << 24u));
}
fn shUnpack64(u: vec2u) -> SH {
  let e = (u.y >> 16u) & 0xffu;
  let k = u.y >> 24u;
  let sq = select(0.0, exp2((f32(e) - 128.0) * 0.25), (u.x | u.y) != 0u);
  let sd = select(0.0, sq * exp2((f32(k) - 128.0) * 0.0625), k != 0u);
  return SH(unpack4x8snorm(u.x) * sq, vec4f(unpack4x8snorm(u.y & 0xffffu).xy * sq, sd, 0.0));
}
`;

/** Payload struct, YCoCg conversions, pack / unpack, evaluation, luminance. No bindings. */
export const SH_CORE_WGSL = /* wgsl */ `
// y = (a, b.x, b.y, b.z) of the luma, c = (Co, Cg, s0, s1)
struct SH { y: vec4f, c: vec4f }
fn shUnpack(u: vec4u) -> SH {
  return SH(vec4f(unpack2x16float(u.x), unpack2x16float(u.y)), vec4f(unpack2x16float(u.z), unpack2x16float(u.w)));
}
fn shClampH(v: vec4f) -> vec4f { return clamp(v, vec4f(-65504.0), vec4f(65504.0)); }
fn shPack(p: SH) -> vec4u {
  let y = shClampH(p.y);
  let c = shClampH(p.c);
  ${SH_PACK_NEAREST}
}
fn shFinite4(v: vec4f) -> vec4f {
  let b = bitcast<vec4u>(v) & vec4u(0x7f800000u);
  return select(v, vec4f(0.0), b == vec4u(0x7f800000u));
}
// Malvar & Sullivan 2003
fn rgbToYCoCg(c: vec3f) -> vec3f {
  return vec3f(0.25 * c.r + 0.5 * c.g + 0.25 * c.b, 0.5 * c.r - 0.5 * c.b, -0.25 * c.r + 0.5 * c.g - 0.25 * c.b);
}
fn yCoCgToRgb(y: f32, co: f32, cg: f32) -> vec3f { return vec3f(y + co - cg, y + cg, y - co - cg); }
// Y(n) = a + b.n
fn shEval(y: vec4f, n: vec3f) -> f32 { return y.x + dot(y.yzw, n); }
// Rec. 709 luminance of RGB(Y(n), Co, Cg), clamped at 0 (SPEC M7-5):
// 0.2126 R + 0.7152 G + 0.0722 B = Y + 0.1404 Co + 0.4304 Cg
fn shLum(p: SH, n: vec3f) -> f32 { return max(shEval(p.y, n) + 0.1404 * p.c.x + 0.4304 * p.c.y, 0.0); }
`;

export type ShEncoding = 'normal-exact' | 'textbook';

/**
 * Per-sample encoding (SPEC M7-2). 'normal-exact' (default, our design): the L1 band of
 * the sample's clamped-cosine lobe, rescaled to be exact at the sampling normal n_s:
 * a = Y/(1+2c), b = 2Y w/(1+2c), c = n_s.w (bounded weights). 'textbook': the cosine-
 * sampled projection a = Y/(4c'), b = Y w/(2c'), c' = max(c, 0.1) (the tune alternative).
 * For c < 0 (specular only) 'normal-exact' keeps beta = 2: a = Y (1 - 2c), b = 2 Y w, exact
 * at n_s (the CAPTURE-FORMAT v1 rule, so payloads match the test bed's *_sh_ref).
 * A zero direction encodes an isotropic sample (a = Y, b = 0).
 */
export function shEncodeWgsl(enc: ShEncoding): string {
  const body = enc === 'textbook'
    ? /* wgsl */ `
  let cf = max(c, 0.1);   // (c < 0 floors at 0.1 too)
  let s = select(1.0, 0.25 / cf, dl > 1e-6);
  return SH(vec4f(ycc.x * s, w * (2.0 * ycc.x * s)), vec4f(ycc.yz, 0.0, 0.0));`
    : /* wgsl */ `
  // c < 0 (specular lobes reaching behind D_s): beta stays 2, exact at n_s and bounded (CAPTURE-FORMAT v1)
  let beta = 2.0 / (1.0 + 2.0 * max(c, 0.0));
  return SH(vec4f(ycc.x * (1.0 - beta * c), w * (beta * ycc.x)), vec4f(ycc.yz, 0.0, 0.0));`;
  return /* wgsl */ `
// rgb: the plain (demodulated) sample, dir: world direction of its ray (any length;
// 0 = no direction), ns: the normal the ray was sampled around.
fn shEncode(rgb: vec3f, dir: vec3f, ns: vec3f) -> SH {
  let ycc = rgbToYCoCg(rgb);
  let dl = length(dir);
  let w = select(vec3f(0.0), dir / max(dl, 1e-20), dl > 1e-6);
  let c = clamp(dot(ns, w), -1.0, 1.0);${body}
}`;
}

/**
 * Resolve-side WGSL, also exported for renderers that resolve in their own shaders
 * (SPEC M7-8, M7-9, M7-11). Needs SH_CORE_WGSL.
 *
 * - `shOutputPayload(p, nGuide, guardK)`: the resolve-ready output (a', b', rho_Co,
 *   rho_Cg, Y_g) from a filtered payload: ringing guard on b keeping Y(n_g) exact,
 *   chroma as a ratio to Y_g.
 * - `shResolveDiffuse(p, nDetail, sharpen, nGuide)`: demodulated rgb at the detail
 *   normal; `sharpen` in [0, 1] replaces the L1 lobe by ambient + one clamped-cosine
 *   light (renormalized to stay exact at n_g); with sharpen = 0, nGuide is unused.
 * - `shResolveSpecular(p, nDetail, nGuide, view, roughness, lightSharp, rhoMax, fadeR)`:
 *   specular payloads (encoded around the lobe's dominant direction): the plain value
 *   times the detail / guide ratio of SG lobe responses (defaults 8, 4, 0.2);
 *   lightSharp <= 0 takes the ratio of the L1 payload at the two dominant directions instead.
 */
export const SH_RESOLVE_CORE_WGSL = /* wgsl */ `
fn shOutputPayload(p: SH, ng: vec3f, guardK: f32) -> SH {
  let yg = shEval(p.y, ng);
  let bl = length(p.y.yzw);
  let b = p.y.yzw * min(1.0, guardK * max(yg, 0.0) / max(bl, 1e-6));
  let a = yg - dot(b, ng);
  let inv = 1.0 / max(yg, 1e-4);
  return SH(vec4f(a, b), vec4f(clamp(p.c.x * inv, -2.0, 2.0), clamp(p.c.y * inv, -2.0, 2.0), yg, 0.0));
}
// Y of the ambient + one light model: A + I max(0, n.d); I = 2|b|, A = max(a - |b|/2, 0)
fn shSharpY(y: vec4f, n: vec3f) -> f32 {
  let bl = length(y.yzw);
  let d = y.yzw / max(bl, 1e-12);
  return max(y.x - 0.5 * bl, 0.0) + 2.0 * bl * max(dot(n, d), 0.0);
}
fn shResolveY(p: SH, nd: vec3f, sharpen: f32, ng: vec3f) -> f32 {
  var y = max(shEval(p.y, nd), 0.0);
  if (sharpen > 0.0) {
    let yg = max(p.c.z, 0.0);
    let ys = shSharpY(p.y, nd) * yg / max(shSharpY(p.y, ng), 1e-4);
    y = mix(y, ys, sharpen);
  }
  return y;
}
fn shResolveDiffuse(p: SH, nd: vec3f, sharpen: f32, ng: vec3f) -> vec3f {
  let y = shResolveY(p, nd, sharpen, ng);
  return max(yCoCgToRgb(y, y * p.c.x, y * p.c.y), vec3f(0.0));
}

// Specular dominant direction (SPEC R-2: Lagarde & de Rousiers 2014, simple fit, with GGX alpha = r^2).
fn shDominantDir(n: vec3f, v: vec3f, rough: f32) -> vec3f {
  let a = rough * rough;
  let f = (1.0 - a) * (sqrt(1.0 - a) + a);
  return normalize(mix(n, reflect(-v, n), f));
}
// Integral over the sphere of the product of two spherical Gaussians mu exp(lambda (w.p - 1)).
fn shSgInner(p1: vec3f, l1: f32, m1: f32, p2: vec3f, l2: f32, m2: f32) -> f32 {
  let lm = length(l1 * p1 + l2 * p2);
  return 6.2831853 * m1 * m2 * exp(lm - l1 - l2) * (1.0 - exp(-2.0 * lm)) / max(lm, 1e-4);
}
// Amplitude of a unit-integral SG of sharpness lambda.
fn shSgNorm(l: f32) -> f32 { return l / (6.2831853 * (1.0 - exp(-2.0 * l))); }
// Response of the specular lobe of normal n to the payload's lighting model (ambient + one SG light of
// sharpness lightSharp carrying the clamped-cosine light's power I = 2|b|): the GGX NDF as an SG of
// sharpness 2/alpha^2 warped to the reflection direction (sharpness / (4 |n.v|); Pettineo's SG series
// part 4, after Wang et al. 2009), normalized to unit integral (the ratio only needs the shape).
fn shSpecResponse(y: vec4f, n: vec3f, v: vec3f, alpha: f32, lightSharp: f32) -> f32 {
  let bl = length(y.yzw);
  let d = y.yzw / max(bl, 1e-12);
  let amb = max(y.x - 0.5 * bl, 0.0);
  let ml = 2.0 * bl * shSgNorm(lightSharp);
  let r = reflect(-v, n);
  let lw = clamp(2.0 / max(alpha * alpha, 1e-6) / (4.0 * max(abs(dot(n, v)), 1e-3)), 1e-3, 1e5);
  return amb + shSgInner(r, lw, shSgNorm(lw), d, lightSharp, ml);
}
// Specular ratio resolve (SPEC M7-10, our design): the plain value at the guide normal (Y_g, from the
// output payload) times the detail / guide ratio of the lobe responses, clamped to [0, rhoMax] and
// faded to 1 below roughness fadeR (L1 carries nothing at mirror scales).
fn shResolveSpecular(p: SH, nd: vec3f, ng: vec3f, v: vec3f, rough: f32, lightSharp: f32, rhoMax: f32, fadeR: f32) -> vec3f {
  let alpha = max(rough * rough, 1e-3);
  let rd = shSpecResponse(p.y, nd, v, alpha, lightSharp);
  let rg = shSpecResponse(p.y, ng, v, alpha, lightSharp);
  var ratio = clamp(rd / max(rg, 1e-8), 0.0, rhoMax);
  if (lightSharp <= 0.0) {   // 'l1' variant: the payload itself at the two dominant directions
    ratio = clamp(max(shEval(p.y, shDominantDir(nd, v, rough)), 0.0) / max(shEval(p.y, shDominantDir(ng, v, rough)), 1e-6), 0.0, rhoMax);
  }
  ratio = mix(1.0, ratio, smoothstep(0.5 * fadeR, fadeR, rough));
  let y = max(p.c.z, 0.0) * ratio;
  return max(yCoCgToRgb(y, y * p.c.x, y * p.c.y), vec3f(0.0));
}
`;

/**
 * The public WGSL resolve source (`SH_RESOLVE_WGSL`): paste into a material / compute
 * shader, then `shResolveDiffuse(shUnpack(textureLoad(payload, p, 0)), nDetail, 0.0, nDetail)`.
 * The payload is what `DiffuseDenoiser({ payload: 'sh' })` returns (rgba32uint).
 */
export const SH_RESOLVE_WGSL = SH_CORE_WGSL + SH_RESOLVE_CORE_WGSL;
