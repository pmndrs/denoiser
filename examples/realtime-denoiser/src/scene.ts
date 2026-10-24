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
import { bnWgsl } from './bluenoise';

/** SPEC F-3 curve constants used for the test bed's ao / so signals (the denoisers' defaults). */
export const OCC_A = 1.0;
export const OCC_B = 0.05;

export const SCENE_WGSL = /* wgsl */ `
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
  objPrevPos: vec3f, _pad1: f32,
};
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

fn trace(ro: vec3f, rd: vec3f, tmax: f32) -> Hit {
  var h = Hit(tmax, vec3f(0.0), vec3f(0.0), vec3f(0.04), 1.0, 0u);
  var found = false;
  if (rd.y < 0.0) {
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
  if (!found) { h.t = -1.0; }
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
  return pcg(pix.x * 7919u + pcg(pix.y + 0x9e3779b9u + salt * 0x2c1b3c6du));
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
  return base + band * vec3f(6.0, 5.5, 5.0);
}

// ---- sphere light: uniform cone sampling of its solid angle -> (visibility, occluder distance)
fn lightSample(p: vec3f, n: vec3f, xi: vec2f) -> vec2f {
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
}

// outgoing radiance of a secondary hit (Lambertian; metals use f0 as their colour):
// sphere light with one shadow ray + a crude sky ambient (stands in for more bounces)
fn hitRadiance(p: vec3f, h: Hit, xi: vec2f) -> vec3f {
  let s = lightSample(p, h.n, xi);
  let toL = u.lightPos - p;
  let d2 = dot(toL, toL);
  let ndl = max(dot(h.n, normalize(toL)), 0.0);
  let solid = PI * u.lightRadius * u.lightRadius / d2;
  let direct = u.lightRadiance * ndl * solid * s.x / PI;
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
  return incoming(p, n, dir, xi2);
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
  ndl = max(ndl, 1e-4);
  let vdh = clamp(dot(v, H), 0.0, 1.0);
  let F = f0 + (1.0 - f0) * pow(1.0 - vdh, 5.0);
  let w = F * smithG1(ndl, alpha * alpha) / envBRDF(f0, rough, dot(n, v));
  let li = incoming(p, n, L, xi2);
  return vec4f(li.rgb * w, li.w);
}

// ---- primary visibility + guides
struct Primary {
  hit: bool, p: vec3f, n: vec3f, rough: f32, albedo: vec3f, f0: vec3f,
  depth: f32, viewz: f32, motion: vec2f, motionz: f32, rd: vec3f,
};

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
  o.rough = h.rough;
  o.albedo = h.albedo;
  o.f0 = h.f0;
  // the movable sphere translates: its previous position is p - (objPos - objPrevPos)
  var pPrev = o.p;
  if (h.id == MOVING_ID) { pPrev = o.p - (u.objPos - u.objPrevPos); }
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
    v = lightSample(pr.p, pr.n, bn2(id.xy, fr, 8u));
  } else if (pr.hit) {
    var sd = noisySeed(id.xy, 1u);
    d = diffuseSample(pr.p, pr.n, rand2(&sd), rand2(&sd));
    var ss = noisySeed(id.xy, 2u);
    s = specularSample(pr.p, pr.n, -pr.rd, pr.rough, pr.f0, rand2(&ss), rand2(&ss));
    var sv = noisySeed(id.xy, 3u);
    v = lightSample(pr.p, pr.n, rand2(&sv));
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
  return trace(p + n * 1e-3, dir, 1e4).t;
}
// hit distance of a specular ray (same direction as specularSample), -1 = miss
fn specularHitT(p: vec3f, n: vec3f, v: vec3f, rough: f32, xi: vec2f) -> f32 {
  let alpha = max(rough * rough, 1e-3);
  let tbn = basis(n);
  let H = tbn * sampleGGXVNDF(transpose(tbn) * v, alpha, xi);
  var L = reflect(-v, H);
  let ndl = dot(n, L);
  if (ndl <= 0.0) { L = L - 2.0 * ndl * n; }
  return trace(p + n * 1e-3, L, 1e4).t;
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
      sum.x += lightSample(pr.p, pr.n, gridXi(i, rot)).x;
    }
  } else {
    sum.x = f32(rp.count); // sky: lit
  }
  let m = accumulate(id.xy, sum);
  if (rp.last != 0u) { textureStore(o_refScalar, id.xy, vec4f(m.x)); }
}
`;

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
