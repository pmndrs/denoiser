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
  return vec4u(pack2x16float(y.xy), pack2x16float(y.zw), pack2x16float(c.xy), pack2x16float(c.zw));
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
 * A zero direction encodes an isotropic sample (a = Y, b = 0).
 */
export function shEncodeWgsl(enc: ShEncoding): string {
  const body = enc === 'textbook'
    ? /* wgsl */ `
  let cf = max(c, 0.1);
  let s = select(1.0, 0.25 / cf, dl > 1e-6);
  return SH(vec4f(ycc.x * s, w * (2.0 * ycc.x * s)), vec4f(ycc.yz, 0.0, 0.0));`
    : /* wgsl */ `
  let s = 1.0 / (1.0 + 2.0 * c);
  return SH(vec4f(ycc.x * s, w * (2.0 * ycc.x * s)), vec4f(ycc.yz, 0.0, 0.0));`;
  return /* wgsl */ `
// rgb: the plain (demodulated) sample, dir: world direction of its ray (any length;
// 0 = no direction), ns: the normal the ray was sampled around.
fn shEncode(rgb: vec3f, dir: vec3f, ns: vec3f) -> SH {
  let ycc = rgbToYCoCg(rgb);
  let dl = length(dir);
  let w = select(vec3f(0.0), dir / max(dl, 1e-20), dl > 1e-6);
  let c = clamp(dot(ns, w), 0.0, 1.0);${body}
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
`;

/**
 * The public WGSL resolve source (`SH_RESOLVE_WGSL`): paste into a material / compute
 * shader, then `shResolveDiffuse(shUnpack(textureLoad(payload, p, 0)), nDetail, 0.0, nDetail)`.
 * The payload is what `DiffuseDenoiser({ payload: 'sh' })` returns (rgba32uint).
 */
export const SH_RESOLVE_WGSL = SH_CORE_WGSL + SH_RESOLVE_CORE_WGSL;
