// Deterministic analytic scene ray traced in WGSL: spheres, boxes, a thin fence
// and one movable sphere on a glossy checker floor, lit by a sphere light and a
// sky with a bright "window" band. Every frame it writes the CAPTURE-FORMAT
// buffers (docs/research/rt-denoiser/CAPTURE-FORMAT.md):
//
//   guides    depth, viewz, normal, roughness, motion, motion_z   (entry `guides`)
//             albedo, f0                                          (entry `material`)
//   signals   diffuse + diffuse_hitt, specular + specular_hitt,
//             visibility + occluder_dist                          (entry `signals`, 1 spp each)
//   refs      diffuse_ref, specular_ref, visibility_ref            (entries `ref_*`, many spp,
//             SAME estimator, accumulated over several dispatches so no single
//             command buffer runs long enough to trip a GPU watchdog)
//
// Conventions (CAPTURE-FORMAT v0 + LESSONS.md):
//   - signals are demodulated, linear HDR, not pre-exposed, finite everywhere;
//   - viewz is three.js view space (in front of the camera is NEGATIVE), sky = -far;
//   - motion = NDC(current) - NDC(previous), +y up; motion_z = viewZprev - viewZ;
//   - roughness is perceptual r, GGX alpha = r^2; sky normal = 0, sky depth = 1;
//   - hit distances are world units, primary segment excluded, 0 = miss.
//
// Sampling of the 1-spp signals: u.sampling = 1 (default, `sampling=blue`) draws every
// sample dimension from spatiotemporal blue noise (src/bluenoise.ts: void-and-cluster
// mask, per-dimension shift + Cranley-Patterson rotation, R_n per-frame offsets);
// 0 (`sampling=white`) uses independent PCG streams per pixel, frame and signal.
// References always use their own stratified grid + white noise.
//
// Estimators (all public, textbook):
//   diffuse   cosine-weighted hemisphere ray (pdf = cos/pi). With a Lambertian
//             BRDF albedo/pi, f*cos/pdf = albedo, so the DEMODULATED sample is
//             just the incoming radiance Li(dir). Remodulate: albedo * diffuse.
//             Li at a hit = that surface's outgoing radiance from the sphere light
//             (one shadow ray, NEE) + a sky ambient term; Li on a miss = sky(dir).
//             The sphere light is not intersectable by secondary rays (direct
//             light is the shadow signal's job), for diffuse and specular alike.
//   specular  GGX VNDF sampling (Heitz 2018, "Sampling the GGX distribution of
//             visible normals", JCGT 7(4)). With separable Smith G2 = G1(V)G1(L),
//             f*cos/pdf = F(V.H) * G1(L). Schlick Fresnel with the pixel's f0.
//             Demodulated sample = Li * F * G1(L) / envBRDF(f0, r, N.V), where
//             envBRDF is Karis 2014's analytic approximation ("Physically Based
//             Shading on Mobile", Unreal Engine blog, 2014):
//                 c0 = (-1, -0.0275, -0.572, 0.022), c1 = (1, 0.0425, 1.04, -0.04)
//                 q = r * c0 + c1                       (r = perceptual roughness)
//                 a004 = min(q.x * q.x, exp2(-9.28 * NdotV)) * q.x + q.y
//                 (A, B) = (-1.04, 1.04) * a004 + q.zw
//                 envBRDF = f0 * A + B                  (NdotV clamped to >= 1e-4)
//             Remodulate: specular * envBRDF(f0, r, N.V). Below-horizon VNDF
//             samples are mirrored about the tangent plane (not zeroed), in the
//             noisy signal and the reference alike (FFX reflections reads ~0
//             radiance as "no reflection here").
//   shadows   one ray toward a point uniformly sampled in the sphere light's
//             solid-angle cone: visibility in {0,1}, occluder_dist = blocker
//             distance (0 = unoccluded). A cone direction under the receiver's
//             horizon counts as occluded with occluder_dist 0 (self-shadow).
//             Reference visibility = unoccluded fraction of the cone (fractional).
//   ao / so   (T5, occlusion) the normalized hit distance of the diffuse / specular 1-spp
//             ray, SPEC F-3: h_n = h / (h + OCC_A + OCC_B * d), d = -viewz, miss -> 1
//             (entry `occlusion` in OCC_WGSL, from diffuse_hitt / specular_hitt). The curve is
//             nonlinear, so the references (`ref_ao`, `ref_so`) normalize EACH sample's hit
//             distance and average those (same direction distributions as the 1-spp rays:
//             cosine hemisphere / GGX VNDF with the below-horizon mirror), not the average
//             hit distance.
//
// CAPTURE-FORMAT v1 signals (SPEC v0.3 M7 / M8; testbed-v1). Three scene builds, compiled from one
// template (sceneWgsl(kind)): 'standard' (the seven original paths: its existing entries are the
// original code, so their signals and references stay bit-identical), 'bumpy' (paths bumpy, bounce)
// and 'glass' (paths glass, glass-moving, glass-still). Every build also has the v1 entries:
//   dirs          diffuse_dir / specular_dir: world unit direction of this frame's 1-spp diffuse /
//                 specular ray (recomputed from the same random numbers as entry signals), and
//                 normal_geom (the smooth geometric normal; = normal outside the bumpy build)
//   translucency  transmittance T (rgb) and translucent_dist of the 1-ray shadow sample, plus two
//                 derived conveniences: the noisy v*T (shadow-rgb input baseline) and v*lum709(T)
//   ref_sh_diffuse / ref_sh_specular   the converged M7-2 payload (a, b.xyz | Co, Cg) of the SAME
//                 samples as ref_diffuse / ref_specular (same seeds): Y(n_s) = a + b.n_s reproduces
//                 YCoCg-Y of diffuse_ref / specular_ref up to f32 rounding
//   ref_shadow_rgb mean of v*T over the shadow reference's samples (same seeds as ref_shadows)
// M7-2 payload of one sample (radiance L, ray direction w, sampling normal n_s; YCoCg after Malvar &
// Sullivan 2003): c = n_s.w, beta = 2 / (1 + 2 max(c, 0)), a = Y (1 - beta c), b = beta Y w, Co, Cg.
// For c >= 0 that is SPEC's a = Y / (1 + 2c), b = 2 Y w / (1 + 2c); for c < 0 (only possible for
// specular, whose n_s is the dominant direction D_s) beta stays 2, which keeps a + b.n_s = Y exact and
// the weights bounded. Specular n_s = D_s = normalize(mix(n, reflect(-v, n), F)), F = (1 - a)(sqrt(1 - a)
// + a), a = r^2 (SPEC R-2, Frostbite's fit), with n the shading (detail) normal.
//
// bumpy build: a normal-mapped floor (domes in a 0.5 m grid, max tilt 10..40 deg varying along x) and a
// rippled wall (behind the big sphere, +-25 deg), a cyan area light (emissive box, reached by secondary
// rays only as emission), and a red and a green wall flanking a corridor of bumpy floor (coloured bounce).
// The detail normal is analytic (bumpNormal), bent toward the viewer where it would face away (n.v >=
// 0.05), and is what `normal` holds and what the rays are sampled around; normal_geom is the flat
// normal. Rays below the GEOMETRIC surface return L = 0 and hit distance 0 (SPEC M7-4). Shadow rays use
// the geometric normal; secondary hits shade with their geometric normal.
// glass build: thin translucent panels seen by SHADOW rays only (primary and secondary rays pass
// through them untinted): panel 1, kappa (0.9, 0.35, 0.2), alpha 0.8 / 0.4 in 15 cm stripes, with an
// opaque frame (visible, casts an opaque shadow), its pose (position + rotation about y) per frame from
// the path (glass-moving slides and turns it; the frame's motion vectors follow it); panel 2,
// blue-green kappa (0.15, 0.7, 0.75), alpha 0.7, static, lower, overlapping panel 1's shadow (the
// overlap shows the product colour). Per layer t = (1 - alpha) + alpha kappa; layers multiply (order
// independent). SPEC M8-1: visibility = opaque visibility; once max_c T < 0.01 the ray counts as opaque
// (v = 0, occluder_dist = that layer's distance). Where v = 0, transmittance = 1 and translucent_dist =
// 0. translucent_dist = distance to the nearest layer with min_c t < 1. Secondary-hit lighting is
// multiplied by T as well (coloured light in the GI).
import { bnWgsl } from './bluenoise';

/** Scene builds (sceneWgsl): which geometry and which signal variants are compiled in. */
export type SceneKind = 'standard' | 'bumpy' | 'glass' | 'reflect';

/** SPEC F-3 curve constants used for the test bed's ao / so signals (the denoisers' defaults). */
export const OCC_A = 1.0;
export const OCC_B = 0.05;

/**
 * reflect build (reflection-motion tests, docs/research/rt-denoiser/results/REFLECTION-MOTION.md; paths in
 * src/paths-reflect.ts, CPU oracle in src/reflect-oracle.ts): a dark checker floor, a dim sky without the window
 * band, two emissive marker spheres (marker 1 = the movable-sphere slot objPos / objPrevPos, marker 2 = m2Pos) and
 * one metal reflector (f0 0.95, roughness reflRough) with its own pose (reflPos, rotation reflAngle about +y) and
 * previous pose (motion vectors follow it). Reflector kinds (local frame, the mirror faces local +z):
 *   0 plane   quad z = 0, |x| <= reflHalf.x, |y| <= reflHalf.y (back face: dark diffuse, id REFL_BACK_ID);
 *             reflBump > 0 adds normal-mapped ripples (slope tan(reflBump) sin(2 pi x / 0.25 m) along local x; the
 *             geometry, positions and hit distances stay flat; `normal` holds the detail normal, normal_geom the flat one)
 *   1 convex  sphere of radius reflRadius around reflPos
 *   2 concave the inside of a sphere of radius reflRadius centred at local (0, 0, R): the cap with local
 *             z <= R (1 - cos t), sin t = reflHalf.x / R, vertex at reflPos (focal length R / 2)
 */
const REFLECT_HELPERS_WGSL = (hasRotY: boolean) => /* wgsl */ `// ---- reflect build: ids, marker radiance, the reflector
const MARKER1_ID: u32 = 60u;
const MARKER2_ID: u32 = 61u;
const REFL_ID: u32 = 62u;
const REFL_BACK_ID: u32 = 63u;
const MARKER1_RADIANCE: vec3f = vec3f(1.0, 0.8, 0.55);
const MARKER2_RADIANCE: vec3f = vec3f(0.45, 0.85, 1.0);
const REFL_F0: vec3f = vec3f(0.95, 0.95, 0.95);
const BUMP_PERIOD: f32 = 0.25;
// the geometric normal of the current primary hit (set by primary(); the below-surface test)
var<private> g_ng: vec3f;
${hasRotY ? '' : 'fn rotY(v: vec3f, a: f32) -> vec3f { let c = cos(a); let s = sin(a); return vec3f(c * v.x + s * v.z, v.y, -s * v.x + c * v.z); }\n'}fn reflHit(ro: vec3f, rd: vec3f, tmax: f32) -> Hit {
  var h = Hit(-1.0, vec3f(0.0), vec3f(0.0), REFL_F0, u.reflRough, REFL_ID);
  let lo = rotY(ro - u.reflPos, -u.reflAngle);
  let ld = rotY(rd, -u.reflAngle);
  if (u.reflKind == 0u) {
    if (abs(ld.z) < 1e-8) { return h; }
    let t = -lo.z / ld.z;
    let q = lo + ld * t;
    if (t > 1e-4 && t < tmax && abs(q.x) <= u.reflHalf.x && abs(q.y) <= u.reflHalf.y) {
      h.t = t;
      if (ld.z < 0.0) { h.n = rotY(vec3f(0.0, 0.0, 1.0), u.reflAngle); }
      else { h = Hit(t, rotY(vec3f(0.0, 0.0, -1.0), u.reflAngle), vec3f(0.2), vec3f(0.04), 1.0, REFL_BACK_ID); }
    }
    return h;
  }
  let R = u.reflRadius;
  let c = select(vec3f(0.0), vec3f(0.0, 0.0, R), u.reflKind == 2u);
  let oc = lo - c;
  let b = dot(oc, ld);
  let disc = b * b - (dot(oc, oc) - R * R);
  if (disc < 0.0) { return h; }
  let sq = sqrt(disc);
  if (u.reflKind == 1u) {
    var t = -b - sq;
    if (t < 1e-4) { t = -b + sq; }
    if (t >= 1e-4 && t < tmax) { h.t = t; h.n = rotY(normalize(oc + ld * t), u.reflAngle); }
    return h;
  }
  // concave cap: the nearer root that lies on the cap
  let sn = u.reflHalf.x / R;
  let zMax = R * (1.0 - sqrt(max(1.0 - sn * sn, 0.0)));
  for (var k = 0; k < 2; k++) {
    let t = select(-b + sq, -b - sq, k == 0);
    if (t < 1e-4 || t >= tmax) { continue; }
    let q = lo + ld * t;
    if (q.z > zMax) { continue; }
    let nIn = normalize(c - q);
    h.t = t;
    if (dot(ld, nIn) < 0.0) { h.n = rotY(nIn, u.reflAngle); }
    else { h = Hit(t, rotY(-nIn, u.reflAngle), vec3f(0.2), vec3f(0.04), 1.0, REFL_BACK_ID); }
    return h;
  }
  return h;
}
// detail (shading) normal of a primary hit: ripples on the plane mirror (reflBump > 0); else the geometric normal
fn reflDetailNormal(p: vec3f, h: Hit) -> vec3f {
  if (h.id != REFL_ID || u.reflKind != 0u || u.reflBump <= 0.0) { return h.n; }
  let q = rotY(p - u.reflPos, -u.reflAngle);
  let s = tan(radians(u.reflBump)) * sin(6.28318530718 * q.x / BUMP_PERIOD);
  return rotY(normalize(vec3f(-s, 0.0, 1.0)), u.reflAngle);
}

`;
/** reflect build: trace()'s geometry (replaces the standard floor, spheres, boxes and fence) */
const REFLECT_TRACE_WGSL = /* wgsl */ `  if (rd.y < 0.0) {
    let t = -ro.y / rd.y;
    if (t > 1e-4 && t < h.t) {
      let p = ro + rd * t;
      let checker = (i32(floor(p.x)) + i32(floor(p.z))) & 1;
      h = Hit(t, vec3f(0.0, 1.0, 0.0), select(vec3f(0.3), vec3f(0.12), checker == 1) * u.floorDim, vec3f(0.04), 0.9, 1u);
      found = true;
    }
  }
  {
    let t = sphereT(ro, rd, vec4f(u.objPos, u.markerRadius));
    if (t > 0.0 && t < h.t) { h = Hit(t, normalize(ro + rd * t - u.objPos), vec3f(0.0), vec3f(0.04), 1.0, MARKER1_ID); found = true; }
  }
  if (u.m2Radius > 0.0) {
    let t = sphereT(ro, rd, vec4f(u.m2Pos, u.m2Radius));
    if (t > 0.0 && t < h.t) { h = Hit(t, normalize(ro + rd * t - u.m2Pos), vec3f(0.0), vec3f(0.04), 1.0, MARKER2_ID); found = true; }
  }
  {
    let r = reflHit(ro, rd, h.t);
    if (r.t > 0.0) { h = r; found = true; }
  }
`;

/** The scene module for one build. 'standard' compiles the original entries unchanged. */
export function sceneWgsl(kind: SceneKind = 'standard'): string {
  const B = kind === 'bumpy', G = kind === 'glass', R = kind === 'reflect';
  /** builds with a separate geometric normal (bumpy; reflect: the normal-mapped mirror) */
  const NG = B || R;
  /** the normal shadow rays use: the geometric one in the bumpy / reflect builds */
  const NS = NG ? 'pr.ng' : 'pr.n';
  return /* wgsl */ `
struct U {
  invViewProj: mat4x4f,
  viewProj: mat4x4f,
  prevViewProj: mat4x4f,
  view: mat4x4f,
  prevView: mat4x4f,
  camPos: vec3f, frame: u32,
  dims: vec2u, seedOffset: u32, sampling: u32, // sampling: 0 white, 1 blue
  lightPos: vec3f, lightRadius: f32,
  lightRadiance: vec3f, far: f32,
  objPos: vec3f, objRadius: f32,
  objPrevPos: vec3f, refSalt: u32, // refSalt: reference seed salt (0 = the standard references; E-1)
${G ? `  glassPos: vec3f, glassAngle: f32,
  glassPrevPos: vec3f, glassPrevAngle: f32,
` : ''}${R ? `  reflPos: vec3f, reflAngle: f32,
  reflPrevPos: vec3f, reflPrevAngle: f32,
  reflKind: u32, reflRough: f32, reflRadius: f32, reflBump: f32,
  reflHalf: vec2f, markerRadius: f32, markerGain: f32,
  m2Pos: vec3f, m2Radius: f32,
  m2PrevPos: vec3f, floorDim: f32,
` : ''}};
// reference accumulation chunk: samples [start, start + count) of a g x g grid
struct R { start: u32, count: u32, grid: u32, last: u32 };

@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var o_depth: texture_storage_2d<r32float, write>;
@group(0) @binding(2) var o_viewz: texture_storage_2d<r32float, write>;
@group(0) @binding(3) var o_normal: texture_storage_2d<rgba16float, write>;
@group(0) @binding(4) var o_rough: texture_storage_2d<r32float, write>;
@group(0) @binding(5) var o_motion: texture_storage_2d<rg32float, write>;
@group(0) @binding(6) var o_motionz: texture_storage_2d<r32float, write>;
@group(0) @binding(7) var o_albedo: texture_storage_2d<rgba16float, write>;
@group(0) @binding(8) var o_f0: texture_storage_2d<rgba16float, write>;
@group(0) @binding(9) var o_diff: texture_storage_2d<rgba16float, write>;
@group(0) @binding(10) var o_diffHit: texture_storage_2d<r32float, write>;
@group(0) @binding(11) var o_spec: texture_storage_2d<rgba16float, write>;
@group(0) @binding(12) var o_specHit: texture_storage_2d<r32float, write>;
@group(0) @binding(13) var o_vis: texture_storage_2d<r32float, write>;
@group(0) @binding(14) var o_occ: texture_storage_2d<r32float, write>;
@group(0) @binding(15) var o_refRgb: texture_storage_2d<rgba32float, write>;
@group(0) @binding(16) var o_refScalar: texture_storage_2d<r32float, write>;
@group(0) @binding(17) var<uniform> rp: R;
@group(0) @binding(18) var<storage, read_write> acc: array<vec4f>;
${bnWgsl(19)}
// v1 outputs (testbed-v1)
@group(0) @binding(20) var o_diffDir: texture_storage_2d<rgba16float, write>;
@group(0) @binding(21) var o_specDir: texture_storage_2d<rgba16float, write>;
@group(0) @binding(22) var o_normalGeom: texture_storage_2d<rgba16float, write>;
@group(0) @binding(23) var o_trans: texture_storage_2d<rgba16float, write>;
@group(0) @binding(24) var o_transDist: texture_storage_2d<r32float, write>;
@group(0) @binding(25) var o_shadowRgb: texture_storage_2d<rgba16float, write>;
@group(0) @binding(26) var o_visLumT: texture_storage_2d<r32float, write>;
@group(0) @binding(27) var o_refRgb2: texture_storage_2d<rgba32float, write>;
@group(0) @binding(28) var<storage, read_write> acc2: array<vec4f>;

const PI: f32 = 3.14159265359;
const MOVING_ID: u32 = 100u;

struct Hit { t: f32, n: vec3f, albedo: vec3f, f0: vec3f, rough: f32, id: u32 };

const NUM_SPHERES: u32 = 6u;
const SPHERES = array<vec4f, 6>(
  vec4f(0.0, 1.0, 0.0, 1.0),
  vec4f(-2.5, 0.7, 1.2, 0.7),
  vec4f(2.3, 0.9, -0.8, 0.9),
  vec4f(1.0, 0.4, 2.2, 0.4),
  vec4f(-1.2, 0.5, -2.4, 0.5),
  vec4f(-0.3, 0.25, 2.9, 0.25),
);
// metals have albedo 0 and a coloured f0; dielectrics f0 = 0.04
const SPHERE_ALBEDO = array<vec3f, 6>(
  vec3f(0.0), vec3f(0.85, 0.2, 0.15), vec3f(0.0),
  vec3f(0.2, 0.5, 0.9), vec3f(0.3, 0.85, 0.35), vec3f(0.9, 0.5, 0.9),
);
const SPHERE_F0 = array<vec3f, 6>(
  vec3f(0.95, 0.93, 0.88), vec3f(0.04), vec3f(1.0, 0.78, 0.34),
  vec3f(0.04), vec3f(0.04), vec3f(0.04),
);
// perceptual roughness spans ~0.05 .. 0.8
const SPHERE_ROUGH = array<f32, 6>(0.06, 0.3, 0.2, 0.5, 0.65, 0.8);

const NUM_BOXES: u32 = 4u;
const BOX_MIN = array<vec3f, 4>(
  vec3f(-4.0, 0.0, -1.0), vec3f(3.0, 0.0, 1.5), vec3f(-1.0, 0.0, -4.5), vec3f(-3.6, 0.0, 2.6));
const BOX_MAX = array<vec3f, 4>(
  vec3f(-3.2, 2.2, -0.2), vec3f(4.0, 1.0, 2.5), vec3f(2.5, 1.6, -4.2), vec3f(-2.6, 0.35, 3.6));
const BOX_ALBEDO = array<vec3f, 4>(
  vec3f(0.8, 0.75, 0.7), vec3f(0.3, 0.3, 0.35), vec3f(0.7, 0.4, 0.25), vec3f(0.9, 0.9, 0.95));
const BOX_ROUGH = array<f32, 4>(0.4, 0.08, 0.6, 0.75);

// thin geometry: a fence of 10 slats (4 cm square) plus two rails, at z ~ 3.9
const FENCE_MIN: vec3f = vec3f(1.38, 0.0, 3.86);
const FENCE_MAX: vec3f = vec3f(4.32, 1.6, 3.94);
const SLATS: u32 = 10u;
const FENCE_ALBEDO: vec3f = vec3f(0.85, 0.82, 0.78);
${B ? `
// bumpy build: rippled wall, red / green corridor walls, cyan emitter (ids 40 + i)
const NUM_BW: u32 = 4u;
const BW_MIN = array<vec3f, 4>(vec3f(-3.5, 0.0, -3.25), vec3f(-2.2, 0.0, 5.6), vec3f(1.0, 0.0, 5.6), vec3f(-3.0, 1.5, -3.05));
const BW_MAX = array<vec3f, 4>(vec3f(3.5, 2.4, -3.05), vec3f(-2.0, 2.0, 9.5), vec3f(1.2, 2.0, 9.5), vec3f(-1.8, 2.3, -3.0));
const BW_ALBEDO = array<vec3f, 4>(vec3f(0.75, 0.72, 0.68), vec3f(0.8, 0.12, 0.1), vec3f(0.12, 0.7, 0.18), vec3f(0.05));
const BW_ROUGH = array<f32, 4>(0.5, 0.6, 0.6, 0.9);
const RIPPLE_ID: u32 = 40u;
const EMIT_ID: u32 = 43u;
const EMIT_RADIANCE: vec3f = vec3f(0.4, 1.8, 4.0);
// the geometric normal of the current primary hit (set by primary(); the below-surface test)
var<private> g_ng: vec3f;
` : ''}${G ? `
// glass build: panel 1 (moving, framed) in its local frame: |x| <= 0.8, |z| <= 0.6 at y = 0
const P1_HALF: vec2f = vec2f(0.8, 0.6);
const P1_KAPPA: vec3f = vec3f(0.9, 0.35, 0.2);
const P2_POS: vec3f = vec3f(-1.2, 0.7, 6.3);
const P2_HALF: vec2f = vec2f(0.5, 0.4);
const P2_KAPPA: vec3f = vec3f(0.15, 0.7, 0.75);
const FRAME_ID: u32 = 50u;
const FRAME_MIN = array<vec3f, 4>(vec3f(-0.86, -0.02, 0.6), vec3f(-0.86, -0.02, -0.66), vec3f(0.8, -0.02, -0.6), vec3f(-0.86, -0.02, -0.6));
const FRAME_MAX = array<vec3f, 4>(vec3f(0.86, 0.02, 0.66), vec3f(0.86, 0.02, -0.6), vec3f(0.86, 0.02, 0.6), vec3f(-0.8, 0.02, 0.6));
// rotation about +y: local -> world and back
fn rotY(v: vec3f, a: f32) -> vec3f { let c = cos(a); let s = sin(a); return vec3f(c * v.x + s * v.z, v.y, -s * v.x + c * v.z); }
` : ''}
fn sphereT(ro: vec3f, rd: vec3f, s: vec4f) -> f32 {
  let oc = ro - s.xyz;
  let b = dot(oc, rd);
  let c = dot(oc, oc) - s.w * s.w;
  let h = b * b - c;
  if (h < 0.0) { return -1.0; }
  let sq = sqrt(h);
  var t = -b - sq;
  if (t < 1e-4) { t = -b + sq; }
  return select(-1.0, t, t >= 1e-4);
}

fn boxT(ro: vec3f, rd: vec3f, bmin: vec3f, bmax: vec3f, n: ptr<function, vec3f>) -> f32 {
  let inv = 1.0 / rd;
  let t0 = (bmin - ro) * inv;
  let t1 = (bmax - ro) * inv;
  let tmin = min(t0, t1);
  let tmax = max(t0, t1);
  let tn = max(max(tmin.x, tmin.y), tmin.z);
  let tf = min(min(tmax.x, tmax.y), tmax.z);
  if (tn > tf || tf < 1e-4) { return -1.0; }
  var t = tn;
  if (t < 1e-4) { t = tf; }
  let p = ro + rd * t;
  let c = (bmin + bmax) * 0.5;
  let d = (p - c) / ((bmax - bmin) * 0.5);
  let a = abs(d);
  if (a.x > a.y && a.x > a.z) { *n = vec3f(sign(d.x), 0.0, 0.0); }
  else if (a.y > a.z) { *n = vec3f(0.0, sign(d.y), 0.0); }
  else { *n = vec3f(0.0, 0.0, sign(d.z)); }
  return t;
}

fn boxHit(ro: vec3f, rd: vec3f, tmax: f32) -> bool {
  let inv = 1.0 / rd;
  let t0 = (FENCE_MIN - ro) * inv;
  let t1 = (FENCE_MAX - ro) * inv;
  let tn = max(max(min(t0.x, t1.x), min(t0.y, t1.y)), min(t0.z, t1.z));
  let tf = min(min(max(t0.x, t1.x), max(t0.y, t1.y)), max(t0.z, t1.z));
  return tn <= tf && tf > 1e-4 && tn < tmax;
}

fn groundRough(p: vec3f) -> f32 {
  // smoothly varying roughness bands across the floor: 0.05 (near-mirror) .. 0.45
  return mix(0.05, 0.45, 0.5 + 0.5 * sin(p.x * 0.55 + 0.3 * p.z));
}

${R ? REFLECT_HELPERS_WGSL(G) : ''}fn trace(ro: vec3f, rd: vec3f, tmax: f32) -> Hit {
  var h = Hit(tmax, vec3f(0.0), vec3f(0.0), vec3f(0.04), 1.0, 0u);
  var found = false;
${R ? REFLECT_TRACE_WGSL : `  if (rd.y < 0.0) {
    let t = -ro.y / rd.y;
    if (t > 1e-4 && t < h.t) {
      let p = ro + rd * t;
      let checker = (i32(floor(p.x)) + i32(floor(p.z))) & 1;
      h = Hit(t, vec3f(0.0, 1.0, 0.0), select(vec3f(0.55), vec3f(0.35), checker == 1), vec3f(0.04), groundRough(p), 1u);
      found = true;
    }
  }
  for (var i = 0u; i < NUM_SPHERES; i++) {
    let t = sphereT(ro, rd, SPHERES[i]);
    if (t > 0.0 && t < h.t) {
      h = Hit(t, normalize(ro + rd * t - SPHERES[i].xyz), SPHERE_ALBEDO[i], SPHERE_F0[i], SPHERE_ROUGH[i], 10u + i);
      found = true;
    }
  }
  {
    let s = vec4f(u.objPos, u.objRadius);
    let t = sphereT(ro, rd, s);
    if (t > 0.0 && t < h.t) {
      h = Hit(t, normalize(ro + rd * t - s.xyz), vec3f(0.95, 0.45, 0.1), vec3f(0.04), 0.35, MOVING_ID);
      found = true;
    }
  }
  for (var i = 0u; i < NUM_BOXES; i++) {
    var n = vec3f(0.0);
    let t = boxT(ro, rd, BOX_MIN[i], BOX_MAX[i], &n);
    if (t > 0.0 && t < h.t) {
      h = Hit(t, n, BOX_ALBEDO[i], vec3f(0.04), BOX_ROUGH[i], 20u + i);
      found = true;
    }
  }
  if (boxHit(ro, rd, h.t)) {
    for (var i = 0u; i < SLATS + 2u; i++) {
      var bmin: vec3f; var bmax: vec3f;
      if (i < SLATS) {
        let x = 1.5 + f32(i) * 0.3;
        bmin = vec3f(x - 0.02, 0.0, 3.88); bmax = vec3f(x + 0.02, 1.6, 3.92);
      } else {
        let y = select(1.36, 0.3, i == SLATS);
        bmin = vec3f(1.38, y, 3.86); bmax = vec3f(4.32, y + 0.04, 3.88);
      }
      var n = vec3f(0.0);
      let t = boxT(ro, rd, bmin, bmax, &n);
      if (t > 0.0 && t < h.t) {
        h = Hit(t, n, FENCE_ALBEDO, vec3f(0.04), 0.5, 30u);
        found = true;
      }
    }
  }
`}${B ? `  for (var i = 0u; i < NUM_BW; i++) {
    var n = vec3f(0.0);
    let t = boxT(ro, rd, BW_MIN[i], BW_MAX[i], &n);
    if (t > 0.0 && t < h.t) {
      h = Hit(t, n, BW_ALBEDO[i], vec3f(0.04), BW_ROUGH[i], 40u + i);
      found = true;
    }
  }
` : ''}${G ? `  {
    // panel 1's opaque frame, in the panel's local frame (rigid: distances are kept)
    let lo = rotY(ro - u.glassPos, -u.glassAngle);
    let ld = rotY(rd, -u.glassAngle);
    for (var i = 0u; i < 4u; i++) {
      var n = vec3f(0.0);
      let t = boxT(lo, ld, FRAME_MIN[i], FRAME_MAX[i], &n);
      if (t > 0.0 && t < h.t) {
        h = Hit(t, rotY(n, u.glassAngle), vec3f(0.2), vec3f(0.04), 0.5, FRAME_ID);
        found = true;
      }
    }
  }
` : ''}  if (!found) { h.t = -1.0; }
  return h;
}

// ---- rng
fn pcg(v: u32) -> u32 {
  let state = v * 747796405u + 2891336453u;
  let word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return (word >> 22u) ^ word;
}
fn rand2(seed: ptr<function, u32>) -> vec2f {
  *seed = pcg(*seed);
  let a = f32(*seed) / 4294967296.0;
  *seed = pcg(*seed);
  let b = f32(*seed) / 4294967296.0;
  return vec2f(a, b);
}
fn noisySeed(pix: vec2u, salt: u32) -> u32 {
  return pcg(pix.x + pcg(pix.y + pcg(u.frame * 9781u + u.seedOffset + salt * 0x68bc21ebu)));
}
fn refSeed(pix: vec2u, salt: u32) -> u32 {
  // u.refSalt = 0 gives the standard references bit for bit; any other value an independent set
  return pcg(pix.x * 7919u + pcg(pix.y + 0x9e3779b9u + salt * 0x2c1b3c6du + u.refSalt * 0x85ebca6bu));
}

fn basis(n: vec3f) -> mat3x3f {
  let s = select(-1.0, 1.0, n.z >= 0.0);
  let a = -1.0 / (s + n.z);
  let b = n.x * n.y * a;
  let t = vec3f(1.0 + s * n.x * n.x * a, s * b, -s * n.x);
  let bt = vec3f(b, s + n.y * n.y * a, -n.y);
  return mat3x3f(t, bt, n);
}

fn ndcOf(m: mat4x4f, p: vec3f) -> vec3f {
  let c = m * vec4f(p, 1.0);
  return c.xyz / c.w;
}

// ---- sky with a bright soft window band (makes glossy lobes visible)
fn sky(d: vec3f) -> vec3f {
  let t = clamp(d.y * 0.5 + 0.5, 0.0, 1.0);
  let base = mix(vec3f(0.45, 0.42, 0.4), vec3f(0.35, 0.55, 0.95), t);
  let band = smoothstep(0.85, 0.97, dot(d, normalize(vec3f(-0.6, 0.35, -0.7))));
  ${R ? 'return base * 0.25;   // reflect build: dim sky, no band (the markers carry the contrast)' : 'return base + band * vec3f(6.0, 5.5, 5.0);'}
}

// ---- sphere light: uniform cone sampling of its solid angle -> (visibility, occluder distance)
${G ? `struct SR { v: f32, h: f32, T: vec3f, hTau: f32 };
// one translucent panel crossed by the segment (o, o + d * tmax): (t_i rgb, distance), distance < 0 = none
fn glassLayer(o: vec3f, d: vec3f, tmax: f32, k: u32) -> vec4f {
  var c = P2_POS; var a = 0.0; var half = P2_HALF;
  if (k == 0u) { c = u.glassPos; a = u.glassAngle; half = P1_HALF; }
  let lo = rotY(o - c, -a);
  let ld = rotY(d, -a);
  if (abs(ld.y) < 1e-7) { return vec4f(1.0, 1.0, 1.0, -1.0); }
  let t = -lo.y / ld.y;
  if (!(t > 1e-4 && t < tmax)) { return vec4f(1.0, 1.0, 1.0, -1.0); }
  let q = lo.xz + ld.xz * t;
  if (any(abs(q) > half)) { return vec4f(1.0, 1.0, 1.0, -1.0); }
  var alpha = 0.7;
  var kappa = P2_KAPPA;
  if (k == 0u) { alpha = select(0.4, 0.8, fract(q.x / 0.3) < 0.5); kappa = P1_KAPPA; }
  return vec4f((1.0 - alpha) + alpha * kappa, t);
}
// shadow ray toward the sphere light through the translucent layers (SPEC M8-1)
fn shadowRay(p: vec3f, n: vec3f, xi: vec2f) -> SR {
  let toL = u.lightPos - p;
  let dist = length(toL);
  let w = toL / dist;
  let sinMax = min(u.lightRadius / dist, 1.0);
  let cosMax = sqrt(max(1.0 - sinMax * sinMax, 0.0));
  let cosT = 1.0 - xi.x * (1.0 - cosMax);
  let sinT = sqrt(max(1.0 - cosT * cosT, 0.0));
  let phi = 2.0 * PI * xi.y;
  let dir = basis(w) * vec3f(cos(phi) * sinT, sin(phi) * sinT, cosT);
  if (dot(dir, n) <= 0.0) { return SR(0.0, 0.0, vec3f(1.0), 0.0); }
  let tLight = dist - u.lightRadius;
  let o = p + n * 1e-3;
  let h = trace(o, dir, tLight);
  if (h.t > 0.0) { return SR(0.0, h.t, vec3f(1.0), 0.0); }
  // the layers, nearest first
  var l0 = glassLayer(o, dir, tLight, 0u);
  var l1 = glassLayer(o, dir, tLight, 1u);
  if (l1.w >= 0.0 && (l0.w < 0.0 || l1.w < l0.w)) { let tmp = l0; l0 = l1; l1 = tmp; }
  var T = vec3f(1.0);
  var hTau = 0.0;
  for (var k = 0u; k < 2u; k++) {
    let l = select(l1, l0, k == 0u);
    if (l.w < 0.0) { continue; }
    T *= l.rgb;
    if (hTau == 0.0 && min(min(l.r, l.g), l.b) < 1.0) { hTau = l.w; }
    if (max(max(T.r, T.g), T.b) < 0.01) { return SR(0.0, l.w, vec3f(1.0), 0.0); }
  }
  return SR(1.0, 0.0, T, hTau);
}
fn lightSample(p: vec3f, n: vec3f, xi: vec2f) -> vec2f {
  let s = shadowRay(p, n, xi);
  return vec2f(s.v, s.h);
}` : `fn lightSample(p: vec3f, n: vec3f, xi: vec2f) -> vec2f {
  let toL = u.lightPos - p;
  let dist = length(toL);
  let w = toL / dist;
  let sinMax = min(u.lightRadius / dist, 1.0);
  let cosMax = sqrt(max(1.0 - sinMax * sinMax, 0.0));
  let cosT = 1.0 - xi.x * (1.0 - cosMax);
  let sinT = sqrt(max(1.0 - cosT * cosT, 0.0));
  let phi = 2.0 * PI * xi.y;
  let dir = basis(w) * vec3f(cos(phi) * sinT, sin(phi) * sinT, cosT);
  if (dot(dir, n) <= 0.0) { return vec2f(0.0, 0.0); }
  let tLight = dist - u.lightRadius;
  let h = trace(p + n * 1e-3, dir, tLight);
  if (h.t > 0.0) { return vec2f(0.0, h.t); }
  return vec2f(1.0, 0.0);
}`}

// outgoing radiance of a secondary hit (Lambertian; metals use f0 as their colour):
// sphere light with one shadow ray + a crude sky ambient (stands in for more bounces)
fn hitRadiance(p: vec3f, h: Hit, xi: vec2f) -> vec3f {
${B ? `  if (h.id == EMIT_ID) { return EMIT_RADIANCE; }
` : ''}${R ? `  if (h.id == MARKER1_ID) { return MARKER1_RADIANCE * u.markerGain; }
  if (h.id == MARKER2_ID) { return MARKER2_RADIANCE * u.markerGain; }
` : ''}${G ? `  let sr = shadowRay(p, h.n, xi);
  let s = vec2f(sr.v, sr.h);` : `  let s = lightSample(p, h.n, xi);`}
  let toL = u.lightPos - p;
  let d2 = dot(toL, toL);
  let ndl = max(dot(h.n, normalize(toL)), 0.0);
  let solid = PI * u.lightRadius * u.lightRadius / d2;
  let direct = u.lightRadiance * ndl * solid * s.x / PI${G ? ' * sr.T' : ''};
  let amb = sky(h.n) * 0.25;
  let refl = h.albedo + select(vec3f(0.0), h.f0, h.albedo.x + h.albedo.y + h.albedo.z == 0.0);
  return refl * (direct + amb);
}

// incoming radiance along a secondary ray: (Li, hit distance; 0 = miss)
fn incoming(p: vec3f, n: vec3f, dir: vec3f, xi: vec2f) -> vec4f {
  let o = p + n * 1e-3;
  let h = trace(o, dir, 1e4);
  if (h.t < 0.0) { return vec4f(sky(dir), 0.0); }
  return vec4f(hitRadiance(o + dir * h.t, h, xi), h.t);
}

// ---- diffuse: cosine-weighted hemisphere sample; demodulated value = Li
fn diffuseSample(p: vec3f, n: vec3f, xi: vec2f, xi2: vec2f) -> vec4f {
  let r = sqrt(xi.x);
  let phi = 2.0 * PI * xi.y;
  let dir = basis(n) * vec3f(r * cos(phi), r * sin(phi), sqrt(max(1.0 - xi.x, 0.0)));
${NG ? `  if (dot(dir, g_ng) <= 0.0) { return vec4f(0.0); }
` : ''}  return incoming(p, n, dir, xi2);
}

// ---- specular: GGX VNDF (Heitz 2018)
fn sampleGGXVNDF(Ve: vec3f, alpha: f32, xi: vec2f) -> vec3f {
  let Vh = normalize(vec3f(alpha * Ve.x, alpha * Ve.y, Ve.z));
  let lensq = Vh.x * Vh.x + Vh.y * Vh.y;
  let T1 = select(vec3f(1.0, 0.0, 0.0), vec3f(-Vh.y, Vh.x, 0.0) / sqrt(lensq), lensq > 0.0);
  let T2 = cross(Vh, T1);
  let r = sqrt(xi.x);
  let phi = 2.0 * PI * xi.y;
  let t1 = r * cos(phi);
  var t2 = r * sin(phi);
  let s = 0.5 * (1.0 + Vh.z);
  t2 = (1.0 - s) * sqrt(max(1.0 - t1 * t1, 0.0)) + s * t2;
  let Nh = t1 * T1 + t2 * T2 + sqrt(max(0.0, 1.0 - t1 * t1 - t2 * t2)) * Vh;
  return normalize(vec3f(alpha * Nh.x, alpha * Nh.y, max(0.0, Nh.z)));
}

fn smithG1(ndv: f32, a2: f32) -> f32 {
  return 2.0 * ndv / (ndv + sqrt(a2 + (1.0 - a2) * ndv * ndv));
}

// Karis 2014 analytic environment BRDF (see the header comment for the exact formula)
fn envBRDF(f0: vec3f, rough: f32, ndv: f32) -> vec3f {
  let c0 = vec4f(-1.0, -0.0275, -0.572, 0.022);
  let c1 = vec4f(1.0, 0.0425, 1.04, -0.04);
  let q = rough * c0 + c1;
  let a004 = min(q.x * q.x, exp2(-9.28 * max(ndv, 1e-4))) * q.x + q.y;
  let ab = vec2f(-1.04, 1.04) * a004 + q.zw;
  return max(f0 * ab.x + ab.y, vec3f(1e-3));
}

fn specularSample(p: vec3f, n: vec3f, v: vec3f, rough: f32, f0: vec3f, xi: vec2f, xi2: vec2f) -> vec4f {
  let alpha = max(rough * rough, 1e-3);
  let tbn = basis(n);
  let Ve = transpose(tbn) * v;
  let H = tbn * sampleGGXVNDF(Ve, alpha, xi);
  var L = reflect(-v, H);
  var ndl = dot(n, L);
  if (ndl <= 0.0) { L = L - 2.0 * ndl * n; ndl = -ndl; }
${NG ? `  if (dot(L, g_ng) <= 0.0) { return vec4f(0.0); }
` : ''}  ndl = max(ndl, 1e-4);
  let vdh = clamp(dot(v, H), 0.0, 1.0);
  let F = f0 + (1.0 - f0) * pow(1.0 - vdh, 5.0);
  let w = F * smithG1(ndl, alpha * alpha) / envBRDF(f0, rough, dot(n, v));
  let li = incoming(p, n, L, xi2);
  return vec4f(li.rgb * w, li.w);
}

${B ? `// ---- bumpy build: analytic detail normals (geometry stays flat)
fn bumpNormal(p: vec3f, h: Hit) -> vec3f {
  if (h.id == 1u) {
    // floor: domes of radius R in a 0.5 m grid, height H (1 - r^2/R^2)^2, max tilt 10..40 deg along x
    let q = (fract(p.xz / 0.5) - 0.5) * 0.5;
    let R = 0.17;
    let r2 = dot(q, q) / (R * R);
    if (r2 >= 1.0) { return h.n; }
    let tanMax = tan(radians(mix(10.0, 40.0, 0.5 + 0.5 * sin(p.x * 0.45 + 0.2 * p.z))));
    let H = tanMax * R / 1.5396;          // max slope of the profile = 1.5396 H / R
    let g = -4.0 * H * (1.0 - r2) * q / (R * R);
    return normalize(vec3f(-g.x, 1.0, -g.y));
  }
  if (h.id == RIPPLE_ID && h.n.z > 0.5) {
    // rippled wall front: height A sin(k y) (0.6 + 0.4 sin(1.3 x)) along +z, max tilt ~25 deg
    let k = 2.0 * PI / 0.35;
    let A = tan(radians(25.0)) / k;
    let m = 0.6 + 0.4 * sin(1.3 * p.x);
    let gx = A * sin(k * p.y) * 0.52 * cos(1.3 * p.x);
    let gy = A * k * cos(k * p.y) * m;
    return normalize(vec3f(-gx, -gy, 1.0));
  }
  return h.n;
}

` : ''}// ---- primary visibility + guides
struct Primary {
  hit: bool, p: vec3f, n: vec3f, rough: f32, albedo: vec3f, f0: vec3f,
  depth: f32, viewz: f32, motion: vec2f, motionz: f32, rd: vec3f,
${NG ? `  ng: vec3f,
` : ''}};

fn primary(pix: vec2u) -> Primary {
  let uv = (vec2f(pix) + 0.5) / vec2f(u.dims);
  let ndc = vec2f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);
  let pn = u.invViewProj * vec4f(ndc, 0.0, 1.0);
  let pf = u.invViewProj * vec4f(ndc, 1.0, 1.0);
  let rd = normalize(pf.xyz / pf.w - pn.xyz / pn.w);
  let h = trace(u.camPos, rd, 1e4);
  var o: Primary;
  o.rd = rd;
  if (h.t < 0.0) {
    let farP = u.camPos + rd * 1000.0;
    o.hit = false;
    o.depth = 1.0;
    o.viewz = -u.far;
    o.n = vec3f(0.0);
    o.rough = 1.0;
    o.albedo = vec3f(0.0);
    o.f0 = vec3f(0.0);
    o.motion = ndcOf(u.viewProj, farP).xy - ndcOf(u.prevViewProj, farP).xy;
    o.motionz = 0.0;
    return o;
  }
  o.hit = true;
  o.p = u.camPos + rd * h.t;
  o.n = h.n;
${B ? `  // detail (shading) normal, bent toward the viewer where it would face away; ng = geometric normal
  o.ng = h.n;
  g_ng = h.n;
  var nd = bumpNormal(o.p, h);
  let cv = dot(nd, -rd);
  if (cv < 0.05) { nd = normalize(nd - (0.05 - cv) * rd); }
  o.n = nd;
` : ''}${R ? `  // reflect build: the mirror's detail normal (ripples, reflBump > 0), bent toward the viewer like the bumpy build's
  o.ng = h.n;
  g_ng = h.n;
  var nd = reflDetailNormal(o.p, h);
  let cv = dot(nd, -rd);
  if (cv < 0.05) { nd = normalize(nd - (0.05 - cv) * rd); }
  o.n = nd;
` : ''}
  o.rough = h.rough;
  o.albedo = h.albedo;
  o.f0 = h.f0;
  // the movable sphere translates: its previous position is p - (objPos - objPrevPos)
  var pPrev = o.p;
  if (h.id == MOVING_ID) { pPrev = o.p - (u.objPos - u.objPrevPos); }
${G ? `  if (h.id == FRAME_ID) { pPrev = u.glassPrevPos + rotY(rotY(o.p - u.glassPos, -u.glassAngle), u.glassPrevAngle); }
` : ''}${R ? `  if (h.id == MARKER1_ID) { pPrev = o.p - (u.objPos - u.objPrevPos); }
  if (h.id == MARKER2_ID) { pPrev = o.p - (u.m2Pos - u.m2PrevPos); }
  if (h.id == REFL_ID || h.id == REFL_BACK_ID) { pPrev = u.reflPrevPos + rotY(rotY(o.p - u.reflPos, -u.reflAngle), u.reflPrevAngle); }
` : ''}
  let c = ndcOf(u.viewProj, o.p);
  o.depth = c.z;
  o.motion = c.xy - ndcOf(u.prevViewProj, pPrev).xy;
  o.viewz = (u.view * vec4f(o.p, 1.0)).z;
  o.motionz = (u.prevView * vec4f(pPrev, 1.0)).z - o.viewz;
  return o;
}

@compute @workgroup_size(8, 8)
fn guides(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= u.dims)) { return; }
  let pr = primary(id.xy);
  // geometry beyond the far plane (the ground near the horizon) is sky to a denoiser
  // (CAPTURE-FORMAT: depth 1, viewz -far, normal 0); signals there are left as traced
  let beyond = pr.hit && pr.depth >= 1.0;
  textureStore(o_depth, id.xy, vec4f(select(pr.depth, 1.0, beyond)));
  textureStore(o_viewz, id.xy, vec4f(select(pr.viewz, -u.far, beyond)));
  textureStore(o_normal, id.xy, vec4f(select(pr.n, vec3f(0.0), beyond), 0.0));
  textureStore(o_rough, id.xy, vec4f(pr.rough));
  textureStore(o_motion, id.xy, vec4f(pr.motion, 0.0, 0.0));
  textureStore(o_motionz, id.xy, vec4f(pr.motionz));
}

@compute @workgroup_size(8, 8)
fn material(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= u.dims)) { return; }
  let pr = primary(id.xy);
  textureStore(o_albedo, id.xy, vec4f(pr.albedo, 1.0));
  textureStore(o_f0, id.xy, vec4f(pr.f0, 1.0));
}

// 1-spp noisy signals (blue noise or independent white-noise streams per signal)
@compute @workgroup_size(8, 8)
fn signals(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= u.dims)) { return; }
  let pr = primary(id.xy);
  var d = vec4f(0.0);
  var s = vec4f(0.0);
  var v = vec2f(1.0, 0.0);
  if (pr.hit && u.sampling == 1u) {
    // blue noise: dims 0-3 diffuse, 4-7 specular, 8-9 shadows (src/bluenoise.ts)
    let fr = u.frame + u.seedOffset;
    d = diffuseSample(pr.p, pr.n, bn2(id.xy, fr, 0u), bn2(id.xy, fr, 2u));
    s = specularSample(pr.p, pr.n, -pr.rd, pr.rough, pr.f0, bn2(id.xy, fr, 4u), bn2(id.xy, fr, 6u));
    v = lightSample(pr.p, ${NS}, bn2(id.xy, fr, 8u));
  } else if (pr.hit) {
    var sd = noisySeed(id.xy, 1u);
    d = diffuseSample(pr.p, pr.n, rand2(&sd), rand2(&sd));
    var ss = noisySeed(id.xy, 2u);
    s = specularSample(pr.p, pr.n, -pr.rd, pr.rough, pr.f0, rand2(&ss), rand2(&ss));
    var sv = noisySeed(id.xy, 3u);
    v = lightSample(pr.p, ${NS}, rand2(&sv));
  }
  textureStore(o_diff, id.xy, vec4f(d.rgb, 1.0));
  textureStore(o_diffHit, id.xy, vec4f(d.w));
  textureStore(o_spec, id.xy, vec4f(s.rgb, 1.0));
  textureStore(o_specHit, id.xy, vec4f(s.w));
  textureStore(o_vis, id.xy, vec4f(v.x));
  textureStore(o_occ, id.xy, vec4f(v.y));
}

// ---- references: stratified g x g grid (Cranley-Patterson rotated per pixel) for the
// primary 2D sample, independent random numbers for the secondary (hit-shading) sample.
// Seeds don't depend on the frame, so a static view has a temporally stable reference.
fn gridXi(i: u32, rot: vec2f) -> vec2f {
  let g = rp.grid;
  return fract((vec2f(f32(i % g), f32(i / g)) + 0.5) / f32(g) + rot);
}

fn accumulate(id: vec2u, v: vec4f) -> vec4f {
  let k = id.y * u.dims.x + id.x;
  var a = v;
  if (rp.start != 0u) { a += acc[k]; }
  acc[k] = a;
  return a / f32(rp.grid * rp.grid);
}

@compute @workgroup_size(8, 8)
fn ref_diffuse(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= u.dims)) { return; }
  let pr = primary(id.xy);
  var sum = vec4f(0.0);
  if (pr.hit) {
    var seed = refSeed(id.xy, 1u);
    let rot = rand2(&seed);
    seed = pcg(seed + rp.start * 0x9e3779b9u);
    for (var i = rp.start; i < rp.start + rp.count; i++) {
      sum += vec4f(diffuseSample(pr.p, pr.n, gridXi(i, rot), rand2(&seed)).rgb, 0.0);
    }
  }
  let m = accumulate(id.xy, sum);
  if (rp.last != 0u) { textureStore(o_refRgb, id.xy, vec4f(m.rgb, 1.0)); }
}

@compute @workgroup_size(8, 8)
fn ref_specular(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= u.dims)) { return; }
  let pr = primary(id.xy);
  var sum = vec4f(0.0);
  if (pr.hit) {
    var seed = refSeed(id.xy, 2u);
    let rot = rand2(&seed);
    seed = pcg(seed + rp.start * 0x9e3779b9u);
    for (var i = rp.start; i < rp.start + rp.count; i++) {
      sum += vec4f(specularSample(pr.p, pr.n, -pr.rd, pr.rough, pr.f0, gridXi(i, rot), rand2(&seed)).rgb, 0.0);
    }
  }
  let m = accumulate(id.xy, sum);
  if (rp.last != 0u) { textureStore(o_refRgb, id.xy, vec4f(m.rgb, 1.0)); }
}

// ---- occlusion references (T5): mean over samples of the NORMALIZED hit distance
const OCC_A: f32 = ${OCC_A.toFixed(4)};
const OCC_B: f32 = ${OCC_B.toFixed(4)};
fn occNorm(t: f32, d: f32) -> f32 {
  if (!(t > 0.0)) { return 1.0; }
  return t / (t + OCC_A + OCC_B * d);
}
// hit distance of a diffuse ray (same direction as diffuseSample), -1 = miss
fn diffuseHitT(p: vec3f, n: vec3f, xi: vec2f) -> f32 {
  let r = sqrt(xi.x);
  let phi = 2.0 * PI * xi.y;
  let dir = basis(n) * vec3f(r * cos(phi), r * sin(phi), sqrt(max(1.0 - xi.x, 0.0)));
${NG ? `  if (dot(dir, g_ng) <= 0.0) { return -1.0; }
` : ''}  return trace(p + n * 1e-3, dir, 1e4).t;
}
// hit distance of a specular ray (same direction as specularSample), -1 = miss
fn specularHitT(p: vec3f, n: vec3f, v: vec3f, rough: f32, xi: vec2f) -> f32 {
  let alpha = max(rough * rough, 1e-3);
  let tbn = basis(n);
  let H = tbn * sampleGGXVNDF(transpose(tbn) * v, alpha, xi);
  var L = reflect(-v, H);
  let ndl = dot(n, L);
  if (ndl <= 0.0) { L = L - 2.0 * ndl * n; }
${NG ? `  if (dot(L, g_ng) <= 0.0) { return -1.0; }
` : ''}  return trace(p + n * 1e-3, L, 1e4).t;
}

@compute @workgroup_size(8, 8)
fn ref_ao(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= u.dims)) { return; }
  let pr = primary(id.xy);
  var sum = vec4f(0.0);
  if (pr.hit) {
    var seed = refSeed(id.xy, 4u);
    let rot = rand2(&seed);
    for (var i = rp.start; i < rp.start + rp.count; i++) {
      sum.x += occNorm(diffuseHitT(pr.p, pr.n, gridXi(i, rot)), -pr.viewz);
    }
  } else {
    sum.x = f32(rp.count);
  }
  let m = accumulate(id.xy, sum);
  if (rp.last != 0u) { textureStore(o_refScalar, id.xy, vec4f(m.x)); }
}

@compute @workgroup_size(8, 8)
fn ref_so(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= u.dims)) { return; }
  let pr = primary(id.xy);
  var sum = vec4f(0.0);
  if (pr.hit) {
    var seed = refSeed(id.xy, 5u);
    let rot = rand2(&seed);
    for (var i = rp.start; i < rp.start + rp.count; i++) {
      sum.x += occNorm(specularHitT(pr.p, pr.n, -pr.rd, pr.rough, gridXi(i, rot)), -pr.viewz);
    }
  } else {
    sum.x = f32(rp.count);
  }
  let m = accumulate(id.xy, sum);
  if (rp.last != 0u) { textureStore(o_refScalar, id.xy, vec4f(m.x)); }
}

@compute @workgroup_size(8, 8)
fn ref_shadows(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= u.dims)) { return; }
  let pr = primary(id.xy);
  var sum = vec4f(0.0);
  if (pr.hit) {
    var seed = refSeed(id.xy, 3u);
    let rot = rand2(&seed);
    for (var i = rp.start; i < rp.start + rp.count; i++) {
      sum.x += lightSample(pr.p, ${NS}, gridXi(i, rot)).x;
    }
  } else {
    sum.x = f32(rp.count); // sky: lit
  }
  let m = accumulate(id.xy, sum);
  if (rp.last != 0u) { textureStore(o_refScalar, id.xy, vec4f(m.x)); }
}

// ==== v1 entries (testbed-v1; CAPTURE-FORMAT v1) ====
// sample directions, recomputed from the same random numbers as entry signals
fn diffuseDirOf(n: vec3f, xi: vec2f) -> vec3f {
  let r = sqrt(xi.x);
  let phi = 2.0 * PI * xi.y;
  return basis(n) * vec3f(r * cos(phi), r * sin(phi), sqrt(max(1.0 - xi.x, 0.0)));
}
fn specularDirOf(n: vec3f, v: vec3f, rough: f32, xi: vec2f) -> vec3f {
  let alpha = max(rough * rough, 1e-3);
  let tbn = basis(n);
  let H = tbn * sampleGGXVNDF(transpose(tbn) * v, alpha, xi);
  var L = reflect(-v, H);
  let ndl = dot(n, L);
  if (ndl <= 0.0) { L = L - 2.0 * ndl * n; }
  return L;
}
// SPEC R-2 dominant direction (Frostbite's simple fit with GGX alpha)
fn dominantDir(n: vec3f, v: vec3f, rough: f32) -> vec3f {
  let a = rough * rough;
  let f = (1.0 - a) * (sqrt(1.0 - a) + a);
  return normalize(mix(n, reflect(-v, n), f));
}
// M7-2 payload of one sample (see the header): a = (a, b.xyz), c = (Co, Cg, 0, 0)
struct SH { a: vec4f, c: vec4f };
fn shEncode(L: vec3f, w: vec3f, ns: vec3f) -> SH {
  let y = 0.25 * L.r + 0.5 * L.g + 0.25 * L.b;
  let co = 0.5 * L.r - 0.5 * L.b;
  let cg = -0.25 * L.r + 0.5 * L.g - 0.25 * L.b;
  let c = dot(ns, w);
  let beta = 2.0 / (1.0 + 2.0 * max(c, 0.0));
  return SH(vec4f(y * (1.0 - beta * c), y * beta * w), vec4f(co, cg, 0.0, 0.0));
}
fn accumulate2(id: vec2u, v: vec4f) -> vec4f {
  let k = id.y * u.dims.x + id.x;
  var a = v;
  if (rp.start != 0u) { a += acc2[k]; }
  acc2[k] = a;
  return a / f32(rp.grid * rp.grid);
}

@compute @workgroup_size(8, 8)
fn dirs(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= u.dims)) { return; }
  let pr = primary(id.xy);
  var dd = vec3f(0.0);
  var sd = vec3f(0.0);
  if (pr.hit && u.sampling == 1u) {
    let fr = u.frame + u.seedOffset;
    dd = diffuseDirOf(pr.n, bn2(id.xy, fr, 0u));
    sd = specularDirOf(pr.n, -pr.rd, pr.rough, bn2(id.xy, fr, 4u));
  } else if (pr.hit) {
    var s1 = noisySeed(id.xy, 1u);
    dd = diffuseDirOf(pr.n, rand2(&s1));
    var s2 = noisySeed(id.xy, 2u);
    sd = specularDirOf(pr.n, -pr.rd, pr.rough, rand2(&s2));
  }
  let beyond = pr.hit && pr.depth >= 1.0;
  textureStore(o_diffDir, id.xy, vec4f(dd, 0.0));
  textureStore(o_specDir, id.xy, vec4f(sd, 0.0));
  textureStore(o_normalGeom, id.xy, vec4f(select(${NS}, vec3f(0.0), beyond), 0.0));
}

@compute @workgroup_size(8, 8)
fn translucency(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= u.dims)) { return; }
  let pr = primary(id.xy);
  var T = vec3f(1.0);
  var ht = 0.0;
  var v = 1.0;
  if (pr.hit) {
    var xi: vec2f;
    if (u.sampling == 1u) { xi = bn2(id.xy, u.frame + u.seedOffset, 8u); }
    else { var sv = noisySeed(id.xy, 3u); xi = rand2(&sv); }
${G ? `    let sr = shadowRay(pr.p, ${NS}, xi);
    v = sr.v;
    if (sr.v > 0.0) { T = sr.T; ht = sr.hTau; }` : `    v = lightSample(pr.p, ${NS}, xi).x;`}
  }
  textureStore(o_trans, id.xy, vec4f(T, 1.0));
  textureStore(o_transDist, id.xy, vec4f(ht));
  textureStore(o_shadowRgb, id.xy, vec4f(v * T, 1.0));
  textureStore(o_visLumT, id.xy, vec4f(v * dot(T, vec3f(0.2126, 0.7152, 0.0722))));
}

@compute @workgroup_size(8, 8)
fn ref_sh_diffuse(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= u.dims)) { return; }
  let pr = primary(id.xy);
  var sa = vec4f(0.0);
  var sc = vec4f(0.0);
  if (pr.hit) {
    var seed = refSeed(id.xy, 1u);
    let rot = rand2(&seed);
    seed = pcg(seed + rp.start * 0x9e3779b9u);
    for (var i = rp.start; i < rp.start + rp.count; i++) {
      let xi = gridXi(i, rot);
      let L = diffuseSample(pr.p, pr.n, xi, rand2(&seed)).rgb;
      let e = shEncode(L, diffuseDirOf(pr.n, xi), pr.n);
      sa += e.a;
      sc += e.c;
    }
  }
  let ma = accumulate(id.xy, sa);
  let mc = accumulate2(id.xy, sc);
  if (rp.last != 0u) { textureStore(o_refRgb, id.xy, ma); textureStore(o_refRgb2, id.xy, mc); }
}

@compute @workgroup_size(8, 8)
fn ref_sh_specular(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= u.dims)) { return; }
  let pr = primary(id.xy);
  var sa = vec4f(0.0);
  var sc = vec4f(0.0);
  if (pr.hit) {
    var seed = refSeed(id.xy, 2u);
    let rot = rand2(&seed);
    seed = pcg(seed + rp.start * 0x9e3779b9u);
    let v = -pr.rd;
    let ds = dominantDir(pr.n, v, pr.rough);
    for (var i = rp.start; i < rp.start + rp.count; i++) {
      let xi = gridXi(i, rot);
      let L = specularSample(pr.p, pr.n, v, pr.rough, pr.f0, xi, rand2(&seed)).rgb;
      let e = shEncode(L, specularDirOf(pr.n, v, pr.rough, xi), ds);
      sa += e.a;
      sc += e.c;
    }
  }
  let ma = accumulate(id.xy, sa);
  let mc = accumulate2(id.xy, sc);
  if (rp.last != 0u) { textureStore(o_refRgb, id.xy, ma); textureStore(o_refRgb2, id.xy, mc); }
}

@compute @workgroup_size(8, 8)
fn ref_shadow_rgb(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= u.dims)) { return; }
  let pr = primary(id.xy);
  var sum = vec4f(0.0);
  if (pr.hit) {
    var seed = refSeed(id.xy, 3u);
    let rot = rand2(&seed);
    for (var i = rp.start; i < rp.start + rp.count; i++) {
${G ? `      let sr = shadowRay(pr.p, ${NS}, gridXi(i, rot));
      sum += vec4f(sr.v * sr.T, 0.0);` : `      sum += vec4f(vec3f(lightSample(pr.p, ${NS}, gridXi(i, rot)).x), 0.0);`}
    }
  } else {
    sum = vec4f(vec3f(f32(rp.count)), 0.0); // sky: lit
  }
  let m = accumulate(id.xy, sum);
  if (rp.last != 0u) { textureStore(o_refRgb, id.xy, vec4f(m.rgb, 1.0)); }
}
`;
}

/** The standard build (the seven original paths). */
export const SCENE_WGSL = sceneWgsl('standard');

// Noise injection (quick checks with EXACT ground truth): replace a noisy signal by
// noise drawn around the converged reference, so the reference is the exact
// expectation of the input (idea: ssgiDev demo 14 "noiseinject"; the noise model
// here is our own and unbiased by construction):
//   shadows   Bernoulli(ref): 1 with probability ref, else 0 (exactly the 1-ray model)
//   rgb       ref * g * m, per pixel scalar g ~ Gamma(k, 1) / k (mean 1, var 1/k,
//             k = INJECT_K), and a firefly multiplier m = A with probability p,
//             else (1 - p A) / (1 - p) (mean 1). Non-negative, chroma-preserving.
export const INJECT_WGSL = /* wgsl */ `
struct P { dims: vec2u, frame: u32, salt: u32, k: f32, fireflyRate: f32, fireflyGain: f32, _p: f32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var t_ref: texture_2d<f32>;
@group(0) @binding(2) var o_rgb: texture_storage_2d<rgba16float, write>;
@group(0) @binding(3) var o_scalar: texture_storage_2d<r32float, write>;

fn pcg(v: u32) -> u32 {
  let state = v * 747796405u + 2891336453u;
  let word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return (word >> 22u) ^ word;
}
fn rnd(seed: ptr<function, u32>) -> f32 {
  *seed = pcg(*seed);
  return (f32(*seed >> 8u) + 0.5) / 16777216.0;
}

@compute @workgroup_size(8, 8)
fn inject_rgb(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= p.dims)) { return; }
  var seed = pcg(id.x + pcg(id.y + pcg(p.frame * 7333u + p.salt * 0x51ed27u)));
  let r = textureLoad(t_ref, id.xy, 0).rgb;
  // Gamma(k) for integer k = sum of k exponentials
  let k = max(u32(p.k), 1u);
  var g = 0.0;
  for (var i = 0u; i < k; i++) { g -= log(rnd(&seed)); }
  g /= f32(k);
  let pr = clamp(p.fireflyRate, 0.0, 0.5);
  var m = 1.0;
  if (pr > 0.0) {
    let A = max(p.fireflyGain, 1.0);
    m = select((1.0 - pr * A) / (1.0 - pr), A, rnd(&seed) < pr);
  }
  textureStore(o_rgb, id.xy, vec4f(max(r * g * m, vec3f(0.0)), 1.0));
}

@compute @workgroup_size(8, 8)
fn inject_scalar(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= p.dims)) { return; }
  var seed = pcg(id.x + pcg(id.y + pcg(p.frame * 7333u + p.salt * 0x51ed27u)));
  let r = textureLoad(t_ref, id.xy, 0).r;
  textureStore(o_scalar, id.xy, vec4f(select(0.0, 1.0, rnd(&seed) < r)));
}
`;

// Noisy ao / so (T5): the normalized hit distance of this frame's 1-spp diffuse / specular
// ray (SPEC F-3), per pixel; d = -viewz (sky: viewz = -far, not scored).
export const OCC_WGSL = /* wgsl */ `
@group(0) @binding(0) var t_diffHit: texture_2d<f32>;
@group(0) @binding(1) var t_specHit: texture_2d<f32>;
@group(0) @binding(2) var t_viewz: texture_2d<f32>;
@group(0) @binding(3) var o_ao: texture_storage_2d<r32float, write>;
@group(0) @binding(4) var o_so: texture_storage_2d<r32float, write>;
fn occNorm(t: f32, d: f32) -> f32 {
  if (!(t > 0.0)) { return 1.0; }
  return t / (t + ${OCC_A.toFixed(4)} + ${OCC_B.toFixed(4)} * d);
}
@compute @workgroup_size(8, 8)
fn occlusion(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= textureDimensions(o_ao))) { return; }
  let d = -textureLoad(t_viewz, id.xy, 0).r;
  textureStore(o_ao, id.xy, vec4f(occNorm(textureLoad(t_diffHit, id.xy, 0).r, d)));
  textureStore(o_so, id.xy, vec4f(occNorm(textureLoad(t_specHit, id.xy, 0).r, d)));
}
`;
