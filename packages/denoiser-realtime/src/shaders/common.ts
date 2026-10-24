// Shared WGSL for every real-time filter in this package: the per-frame camera
// uniform, G-buffer packing, and the shared temporal core (reprojection with
// per-tap plane-distance / normal disocclusion, bilinear-with-validity and
// Catmull-Rom history reads).
//
// Sources (public; see docs/research/rt-denoiser/PROVENANCE.md):
// - Per-tap consistency tests on a 2x2 bilinear footprint, rejected taps
//   dropped and the rest renormalized; 3x3 fallback: Schied et al. 2017, SVGF,
//   HPG, sec. 4.1 p.5.
// - Plane-distance disocclusion (distance of the reprojected point to the
//   previous surface plane {X_prev, n}, relative to camera distance, ~1 %):
//   Zhdan, "ReBLUR", Ray Tracing Gems II ch. 49, sec. 49.6 p.831 (prose).
// - Catmull-Rom history only when the footprint is valid: RTG II ch. 49
//   sec. 49.7 p.831 (prose). The 5-fetch Catmull-Rom built from bilinear taps
//   is the standard separable trick (Jimenez, "Filmic SMAA", SIGGRAPH 2016
//   course); our own code. Instead of testing all 16 taps we clamp the result
//   to the 2x2 taps' range when those 4 are valid (our design: cheaper, and no
//   ringing from an invalid outer ring).
// - 2.5D motion (z = viewZprev - viewZ) is NRD's documented interface
//   convention (sources/nrd-provenance.md sec. 3); the math here is ours.
// - Octahedral normal encoding: Cigolle et al. 2014, "A Survey of Efficient
//   Representations for Independent Unit Vectors", JCGT 3(2).

/** Frame flags (Frame.flags). */
export const FRAME_RESET = 1;
export const FRAME_HAS_VIEWZ = 2;
export const FRAME_HAS_MOTIONZ = 4;
export const FRAME_HAS_ROUGHNESS = 8;

/** Size of the Frame uniform in bytes (see FRAME_WGSL). */
export const FRAME_SIZE = 112 * 4;

export const FRAME_WGSL = /* wgsl */ `
struct Frame {
  projInv: mat4x4f,      // current clip -> view (unjittered)
  viewInv: mat4x4f,      // current view -> world
  view: mat4x4f,         // world -> current view
  prevView: mat4x4f,     // world -> previous view
  prevProjInv: mat4x4f,  // previous clip -> previous view
  prevViewInv: mat4x4f,  // previous view -> world
  dims: vec2f,
  invDims: vec2f,
  camPos: vec3f,
  near: f32,
  prevCamPos: vec3f,
  far: f32,
  flags: u32,
  frameIndex: u32,
  pad0: f32,
  pad1: f32,
}

const FRAME_RESET = ${FRAME_RESET}u;
const FRAME_HAS_VIEWZ = ${FRAME_HAS_VIEWZ}u;
const FRAME_HAS_MOTIONZ = ${FRAME_HAS_MOTIONZ}u;
const FRAME_HAS_ROUGHNESS = ${FRAME_HAS_ROUGHNESS}u;

fn hasFlag(f: u32) -> bool { return (F.flags & f) != 0u; }

fn uvOf(p: vec2i) -> vec2f { return (vec2f(p) + 0.5) * F.invDims; }
// uv (row 0 = top) -> NDC (+y up)
fn ndcOf(uv: vec2f) -> vec2f { return vec2f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0); }

// View-space point on the pixel ray through ndc whose view z is vz (negative in
// front). Two finite points on the ray, so it works for perspective,
// orthographic, reversed-Z and infinite-far projections alike.
fn unprojectZ(projInv: mat4x4f, ndc: vec2f, vz: f32) -> vec3f {
  let a = projInv * vec4f(ndc, 0.3, 1.0);
  let b = projInv * vec4f(ndc, 0.6, 1.0);
  let pa = a.xyz / a.w;
  let pb = b.xyz / b.w;
  let t = (vz - pa.z) / (pb.z - pa.z);
  return pa + (pb - pa) * t;
}

fn luma(c: vec3f) -> f32 { return dot(c, vec3f(0.2126, 0.7152, 0.0722)); }

fn inside(p: vec2i) -> bool {
  return p.x >= 0 && p.y >= 0 && f32(p.x) < F.dims.x && f32(p.y) < F.dims.y;
}
fn clampPix(p: vec2i) -> vec2i { return clamp(p, vec2i(0), vec2i(F.dims) - 1); }

// ---- packed geometry: linear depth, depth slope, normal, roughness
struct Geo {
  z: f32,        // linear depth = -viewZ (> 0); 0 = sky / no surface
  grad: vec2f,   // dz/dpixel (x right, y down), from the prepass
  n: vec3f,      // world-space unit normal
  rough: f32,    // perceptual roughness
}

fn octWrap(v: vec2f) -> vec2f {
  return (1.0 - abs(v.yx)) * select(vec2f(-1.0), vec2f(1.0), v >= vec2f(0.0));
}
fn octEncode(n: vec3f) -> vec2f {
  var p = n.xy / (abs(n.x) + abs(n.y) + abs(n.z));
  if (n.z < 0.0) { p = octWrap(p); }
  return p;
}
fn octDecode(e: vec2f) -> vec3f {
  var n = vec3f(e, 1.0 - abs(e.x) - abs(e.y));
  let t = max(-n.z, 0.0);
  n = vec3f(n.xy + select(vec2f(t), vec2f(-t), n.xy >= vec2f(0.0)), n.z);
  return normalize(n);
}
// Tap texture (rg32uint, ping-pong): x = linear depth bits, y = octahedral
// normal 12+12 bits | roughness 8 bits. The depth slope is only needed at the
// center pixel, so it lives in its own r32uint (pack2x16float), current frame only.
fn packGeoTap(g: Geo) -> vec2u {
  let e = vec2u(round(clamp(octEncode(g.n) * 0.5 + 0.5, vec2f(0.0), vec2f(1.0)) * 4095.0));
  let r = u32(round(clamp(g.rough, 0.0, 1.0) * 255.0));
  return vec2u(bitcast<u32>(g.z), e.x | (e.y << 12u) | (r << 24u));
}
fn packGrad(g: Geo) -> u32 { return pack2x16float(clamp(g.grad, vec2f(-60000.0), vec2f(60000.0))); }
fn geoTap(t: texture_2d<u32>, p: vec2i) -> Geo {
  let v = textureLoad(t, p, 0).xy;
  var g: Geo;
  g.z = bitcast<f32>(v.x);
  g.n = octDecode(vec2f(f32(v.y & 4095u), f32((v.y >> 12u) & 4095u)) / 4095.0 * 2.0 - 1.0);
  g.rough = f32(v.y >> 24u) / 255.0;
  g.grad = vec2f(0.0);
  return g;
}
`;

/**
 * Shared temporal core. Expects in scope: `F: Frame`, `geoPrev:
 * texture_2d<u32>`, `motionTex`, `motionZTex: texture_2d<f32>`, and the tolerances
 * passed as arguments.
 */
export const REPROJECT_WGSL = /* wgsl */ `
struct Reproj {
  prevUV: vec2f,
  base: vec2i,       // top-left texel of the 2x2 footprint
  w: vec4f,          // bilinear x validity, taps (0,0) (1,0) (0,1) (1,1); not normalized
  sumW: f32,
  allValid: bool,    // all four taps valid (Catmull-Rom allowed)
  expPrev: vec3f,    // expected previous view-space position of this surface point
  world: vec3f,      // current world position
}

// Expected position of pixel p's surface point in the previous frame's view
// space, from NDC motion (+ optional 2.5D motion z).
fn expectedPrev(p: vec2i, g: Geo, prevUV: vec2f, world: vec3f) -> vec3f {
  var prevVz: f32;
  if (hasFlag(FRAME_HAS_MOTIONZ)) {
    prevVz = -g.z + textureLoad(motionZTex, p, 0).r;
  } else {
    prevVz = (F.prevView * vec4f(world, 1.0)).z;
  }
  return unprojectZ(F.prevProjInv, ndcOf(prevUV), prevVz);
}

// Per-tap test (SPEC C-7): distance of the expected point to the previous
// surface plane at tap q, with the pairwise-averaged normal, relative to the
// view distance; backfacing taps rejected; plus SVGF's normal-agreement test.
fn tapValid(q: vec2i, g: Geo, expPrev: vec3f, planeTol: f32, normalTol: f32) -> bool {
  if (!inside(q)) { return false; }
  let gq = geoTap(geoPrev, q);
  if (gq.z <= 0.0) { return false; }
  let ndn = dot(g.n, gq.n);
  if (ndn <= 0.0 || ndn < normalTol) { return false; }
  let Q = unprojectZ(F.prevProjInv, ndcOf(uvOf(q)), -gq.z);
  let nAvg = normalize((F.prevView * vec4f(g.n + gq.n, 0.0)).xyz);
  return abs(dot(nAvg, Q - expPrev)) <= planeTol * length(expPrev);
}

fn reproject(p: vec2i, g: Geo, planeTol: f32, normalTol: f32) -> Reproj {
  var r: Reproj;
  let uv = uvOf(p);
  let mv = textureLoad(motionTex, p, 0).xy;   // NDC delta, current - previous, +y up
  r.prevUV = uv - vec2f(mv.x, -mv.y) * 0.5;
  let viewPos = unprojectZ(F.projInv, ndcOf(uv), -g.z);
  r.world = (F.viewInv * vec4f(viewPos, 1.0)).xyz;
  r.expPrev = expectedPrev(p, g, r.prevUV, r.world);
  let pp = r.prevUV * F.dims - 0.5;
  r.base = vec2i(floor(pp));
  let f = pp - floor(pp);
  let bil = vec4f((1.0 - f.x) * (1.0 - f.y), f.x * (1.0 - f.y), (1.0 - f.x) * f.y, f.x * f.y);
  var valid = vec4f(0.0);
  if (tapValid(r.base, g, r.expPrev, planeTol, normalTol)) { valid.x = 1.0; }
  if (tapValid(r.base + vec2i(1, 0), g, r.expPrev, planeTol, normalTol)) { valid.y = 1.0; }
  if (tapValid(r.base + vec2i(0, 1), g, r.expPrev, planeTol, normalTol)) { valid.z = 1.0; }
  if (tapValid(r.base + vec2i(1, 1), g, r.expPrev, planeTol, normalTol)) { valid.w = 1.0; }
  r.w = bil * valid;
  r.sumW = r.w.x + r.w.y + r.w.z + r.w.w;
  r.allValid = all(valid > vec4f(0.5));
  return r;
}

const TAP_OFFS = array<vec2i, 4>(vec2i(0, 0), vec2i(1, 0), vec2i(0, 1), vec2i(1, 1));

// 5-fetch Catmull-Rom on a filterable texture (bilinear taps), uv in [0, 1].
fn sampleCatmullRom(tex: texture_2d<f32>, smp: sampler, uv: vec2f) -> vec4f {
  let pos = uv * F.dims;
  let t1 = floor(pos - 0.5) + 0.5;
  let f = pos - t1;
  let w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
  let w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
  let w2 = f * (0.5 + f * (2.0 - 1.5 * f));
  let w3 = f * f * (-0.5 + 0.5 * f);
  let w12 = w1 + w2;
  let t0 = (t1 - 1.0) * F.invDims;
  let t3 = (t1 + 2.0) * F.invDims;
  let t12 = (t1 + w2 / w12) * F.invDims;
  var c = textureSampleLevel(tex, smp, vec2f(t12.x, t0.y), 0.0) * (w12.x * w0.y);
  c += textureSampleLevel(tex, smp, vec2f(t0.x, t12.y), 0.0) * (w0.x * w12.y);
  c += textureSampleLevel(tex, smp, t12, 0.0) * (w12.x * w12.y);
  c += textureSampleLevel(tex, smp, vec2f(t3.x, t12.y), 0.0) * (w3.x * w12.y);
  c += textureSampleLevel(tex, smp, vec2f(t12.x, t3.y), 0.0) * (w12.x * w3.y);
  let wsum = w12.x * w0.y + w0.x * w12.y + w12.x * w12.y + w3.x * w12.y + w12.x * w3.y;
  return c / wsum;
}
`;
