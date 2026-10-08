// Deterministic analytic scene (spheres + boxes on a plane) ray traced in WGSL.
// Produces, per frame: G-buffer guides (depth, world normal, NDC motion,
// roughness), a 1-sample noisy signal and a many-sample converged reference of
// the same signal at the same frame — so the denoiser can be scored exactly.
//
// Signals:
//   shadows      spherical area light, 1 cone-sampled shadow ray/pixel/frame
//                -> visibility {0,1} + occluder hit distance; reference = N rays
//   reflections  GGX (VNDF) glossy reflection, 1 ray/pixel/frame -> radiance +
//                hit distance; reference = N samples (same estimator)

export const SCENE_WGSL = /* wgsl */ `
struct U {
  invViewProj: mat4x4f,
  viewProj: mat4x4f,
  prevViewProj: mat4x4f,
  camPos: vec3f,
  frame: u32,
  dims: vec2u,
  spp: u32,
  seedOffset: u32,
};
@group(0) @binding(0) var<uniform> u: U;

const PI: f32 = 3.14159265359;
const LIGHT_POS: vec3f = vec3f(4.0, 7.0, 3.0);
const LIGHT_RADIUS: f32 = 1.2;
const LIGHT_RADIANCE: vec3f = vec3f(18.0, 16.5, 14.0);
const SUN_DIR: vec3f = vec3f(0.4319, 0.7559, 0.3239); // normalize(4,7,3)

struct Hit { t: f32, n: vec3f, albedo: vec3f, rough: f32, emissive: f32 };

const NUM_SPHERES: u32 = 6u;
const SPHERES = array<vec4f, 6>(
  vec4f(0.0, 1.0, 0.0, 1.0),
  vec4f(-2.5, 0.7, 1.2, 0.7),
  vec4f(2.3, 0.9, -0.8, 0.9),
  vec4f(1.0, 0.4, 2.2, 0.4),
  vec4f(-1.2, 0.5, -2.4, 0.5),
  vec4f(-0.3, 0.25, 2.9, 0.25),
);
const SPHERE_ALBEDO = array<vec3f, 6>(
  vec3f(0.9, 0.9, 0.9), vec3f(0.85, 0.2, 0.15), vec3f(0.95, 0.8, 0.3),
  vec3f(0.2, 0.5, 0.9), vec3f(0.3, 0.85, 0.35), vec3f(0.9, 0.5, 0.9),
);
const SPHERE_ROUGH = array<f32, 6>(0.05, 0.3, 0.15, 0.5, 0.22, 0.1);

const NUM_BOXES: u32 = 4u;
const BOX_MIN = array<vec3f, 4>(
  vec3f(-4.0, 0.0, -1.0), vec3f(3.0, 0.0, 1.5), vec3f(-1.0, 0.0, -4.5), vec3f(-3.6, 0.0, 2.6));
const BOX_MAX = array<vec3f, 4>(
  vec3f(-3.2, 2.2, -0.2), vec3f(4.0, 1.0, 2.5), vec3f(2.5, 1.6, -4.2), vec3f(-2.6, 0.35, 3.6));
const BOX_ALBEDO = array<vec3f, 4>(
  vec3f(0.8, 0.75, 0.7), vec3f(0.3, 0.3, 0.35), vec3f(0.7, 0.4, 0.25), vec3f(0.9, 0.9, 0.95));
const BOX_ROUGH = array<f32, 4>(0.4, 0.08, 0.6, 0.2);

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

// returns (t, axis-signed normal index encoded) ; t < 0 = miss
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

fn groundRough(p: vec3f) -> f32 {
  // smoothly varying roughness bands across the floor: 0.04 .. 0.5
  return mix(0.04, 0.5, 0.5 + 0.5 * sin(p.x * 0.55 + 0.3 * p.z));
}

fn trace(ro: vec3f, rd: vec3f, tmax: f32) -> Hit {
  var h = Hit(tmax, vec3f(0.0), vec3f(0.0), 1.0, 0.0);
  var found = false;
  // ground plane y = 0
  if (rd.y < 0.0) {
    let t = -ro.y / rd.y;
    if (t > 1e-4 && t < h.t) {
      let p = ro + rd * t;
      let checker = (i32(floor(p.x)) + i32(floor(p.z))) & 1;
      h = Hit(t, vec3f(0.0, 1.0, 0.0), select(vec3f(0.55), vec3f(0.35), checker == 1), groundRough(p), 0.0);
      found = true;
    }
  }
  for (var i = 0u; i < NUM_SPHERES; i++) {
    let t = sphereT(ro, rd, SPHERES[i]);
    if (t > 0.0 && t < h.t) {
      h = Hit(t, normalize(ro + rd * t - SPHERES[i].xyz), SPHERE_ALBEDO[i], SPHERE_ROUGH[i], 0.0);
      found = true;
    }
  }
  for (var i = 0u; i < NUM_BOXES; i++) {
    var n = vec3f(0.0);
    let t = boxT(ro, rd, BOX_MIN[i], BOX_MAX[i], &n);
    if (t > 0.0 && t < h.t) {
      h = Hit(t, n, BOX_ALBEDO[i], BOX_ROUGH[i], 0.0);
      found = true;
    }
  }
  if (!found) { h.t = -1.0; }
  return h;
}

// any-hit occlusion test, returns occluder distance or -1
fn occluded(ro: vec3f, rd: vec3f, tmax: f32) -> f32 {
  let h = trace(ro, rd, tmax);
  return h.t;
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

fn basis(n: vec3f) -> mat3x3f {
  let s = select(-1.0, 1.0, n.z >= 0.0);
  let a = -1.0 / (s + n.z);
  let b = n.x * n.y * a;
  let t = vec3f(1.0 + s * n.x * n.x * a, s * b, -s * n.x);
  let bt = vec3f(b, s + n.y * n.y * a, -n.y);
  return mat3x3f(t, bt, n);
}

fn primaryRay(pix: vec2u) -> array<vec3f, 2> {
  let uv = (vec2f(pix) + 0.5) / vec2f(u.dims);
  let ndc = vec2f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);
  let pn = u.invViewProj * vec4f(ndc, 0.0, 1.0);
  let pf = u.invViewProj * vec4f(ndc, 1.0, 1.0);
  let a = pn.xyz / pn.w;
  let b = pf.xyz / pf.w;
  return array<vec3f, 2>(u.camPos, normalize(b - a));
}

fn ndcOf(m: mat4x4f, p: vec3f) -> vec3f {
  let c = m * vec4f(p, 1.0);
  return c.xyz / c.w;
}

// ---- shadows: cone-sample the spherical light
fn shadowSample(p: vec3f, n: vec3f, xi: vec2f) -> vec2f {
  let toL = LIGHT_POS - p;
  let dist = length(toL);
  let w = toL / dist;
  let sinMax = LIGHT_RADIUS / dist;
  let cosMax = sqrt(max(1.0 - sinMax * sinMax, 0.0));
  let cosT = 1.0 - xi.x * (1.0 - cosMax);
  let sinT = sqrt(max(1.0 - cosT * cosT, 0.0));
  let phi = 2.0 * PI * xi.y;
  let dir = basis(w) * vec3f(cos(phi) * sinT, sin(phi) * sinT, cosT);
  if (dot(dir, n) <= 0.0) { return vec2f(0.0, 0.0); }
  let tLight = dist - LIGHT_RADIUS;
  let t = occluded(p + n * 1e-3, dir, tLight);
  if (t > 0.0) { return vec2f(0.0, t); }
  return vec2f(1.0, 0.0);
}

// ---- reflections: GGX VNDF sampling (Heitz 2018), shading at the hit point
fn sky(d: vec3f) -> vec3f {
  let t = clamp(d.y * 0.5 + 0.5, 0.0, 1.0);
  let base = mix(vec3f(0.45, 0.42, 0.4), vec3f(0.35, 0.55, 0.95), t);
  // a bright soft "window" band to make glossy lobes visible
  let band = smoothstep(0.85, 0.97, dot(d, normalize(vec3f(-0.6, 0.35, -0.7))));
  return base + band * vec3f(6.0, 5.5, 5.0);
}

fn shadeHit(p: vec3f, h: Hit, xi: vec2f) -> vec3f {
  // diffuse from the sphere light (one shadow ray) + sky ambient
  let s = shadowSample(p, h.n, xi);
  let toL = LIGHT_POS - p;
  let d2 = dot(toL, toL);
  let ndl = max(dot(h.n, normalize(toL)), 0.0);
  let solid = PI * LIGHT_RADIUS * LIGHT_RADIUS / d2;
  let direct = LIGHT_RADIANCE * ndl * solid * s.x / PI;
  let amb = sky(h.n) * 0.25;
  return h.albedo * (direct + amb);
}

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

// one reflection sample: (radiance * weight, hit distance in .w)
fn reflectionSample(p: vec3f, n: vec3f, v: vec3f, rough: f32, xi: vec2f, xi2: vec2f) -> vec4f {
  let alpha = max(rough * rough, 1e-3);
  let tbn = basis(n);
  let Ve = transpose(tbn) * v;
  let H = tbn * sampleGGXVNDF(Ve, alpha, xi);
  var L = reflect(-v, H);
  var ndl = dot(n, L);
  // Fold below-horizon directions back into the hemisphere instead of returning a
  // 0 sample: FFX's resolve treats radiance ~0 as "no reflection here" (its SSSR
  // tracer never emits 0 for a valid pixel). Same estimator for the reference.
  if (ndl <= 0.0) { L = L - 2.0 * ndl * n; ndl = -ndl; }
  ndl = max(ndl, 1e-4);
  // VNDF estimator weight = G2/G1(V) (white furnace, F = 1: demodulated specular)
  let a2 = alpha * alpha;
  let w = smithG1(ndl, a2);
  let h = trace(p + n * 1e-3, L, 1e4);
  if (h.t < 0.0) { return vec4f(sky(L) * w, 0.0); }
  let hp = p + n * 1e-3 + L * h.t;
  return vec4f(shadeHit(hp, h, xi2) * w, h.t);
}

struct Primary { hit: bool, p: vec3f, n: vec3f, rough: f32, depth: f32, motion: vec2f, rd: vec3f };

fn primary(pix: vec2u) -> Primary {
  let r = primaryRay(pix);
  let h = trace(r[0], r[1], 1e4);
  var o: Primary;
  o.rd = r[1];
  if (h.t < 0.0) {
    let far = r[0] + r[1] * 1000.0;
    o.hit = false;
    o.depth = 1.0;
    o.n = -r[1];
    o.rough = 1.0;
    o.motion = ndcOf(u.viewProj, far).xy - ndcOf(u.prevViewProj, far).xy;
    return o;
  }
  o.hit = true;
  o.p = r[0] + r[1] * h.t;
  o.n = h.n;
  o.rough = h.rough;
  let c = ndcOf(u.viewProj, o.p);
  o.depth = c.z;
  o.motion = c.xy - ndcOf(u.prevViewProj, o.p).xy;
  return o;
}
`;

export const SHADOW_SCENE_WGSL = /* wgsl */ `
${SCENE_WGSL}
@group(0) @binding(1) var o_depth: texture_storage_2d<r32float, write>;
@group(0) @binding(2) var o_normal: texture_storage_2d<rgba16float, write>;
@group(0) @binding(3) var o_motion: texture_storage_2d<rg32float, write>;
@group(0) @binding(4) var o_rough: texture_storage_2d<r32float, write>;
@group(0) @binding(5) var o_vis: texture_storage_2d<r32float, write>;
@group(0) @binding(6) var o_hitdist: texture_storage_2d<r32float, write>;
@group(0) @binding(7) var o_ref: texture_storage_2d<r32float, write>;

@compute @workgroup_size(8, 8)
fn noisy(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= u.dims)) { return; }
  let pr = primary(id.xy);
  textureStore(o_depth, id.xy, vec4f(pr.depth));
  textureStore(o_normal, id.xy, vec4f(pr.n, 0.0));
  textureStore(o_motion, id.xy, vec4f(pr.motion, 0.0, 0.0));
  textureStore(o_rough, id.xy, vec4f(pr.rough));
  var vis = vec2f(1.0, 0.0);
  if (pr.hit) {
    var seed = pcg(id.x + pcg(id.y + pcg(u.frame * 9781u + u.seedOffset)));
    vis = shadowSample(pr.p, pr.n, rand2(&seed));
  }
  textureStore(o_vis, id.xy, vec4f(vis.x));
  textureStore(o_hitdist, id.xy, vec4f(vis.y));
}

@compute @workgroup_size(8, 8)
fn reference(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= u.dims)) { return; }
  let pr = primary(id.xy);
  var acc = 1.0;
  if (pr.hit) {
    // stratified sqrt(spp)^2 grid, Cranley-Patterson rotated per pixel
    let g = u32(round(sqrt(f32(u.spp))));
    var seed = pcg(id.x * 7919u + pcg(id.y + 0x9e3779b9u));
    let rot = rand2(&seed);
    acc = 0.0;
    for (var j = 0u; j < g; j++) {
      for (var i = 0u; i < g; i++) {
        let xi = fract((vec2f(f32(i), f32(j)) + 0.5) / f32(g) + rot);
        acc += shadowSample(pr.p, pr.n, xi).x;
      }
    }
    acc /= f32(g * g);
  }
  textureStore(o_ref, id.xy, vec4f(acc));
}
`;

export const REFLECTION_SCENE_WGSL = /* wgsl */ `
${SCENE_WGSL}
@group(0) @binding(1) var o_depth: texture_storage_2d<r32float, write>;
@group(0) @binding(2) var o_normal: texture_storage_2d<rgba16float, write>;
@group(0) @binding(3) var o_motion: texture_storage_2d<rg32float, write>;
@group(0) @binding(4) var o_rough: texture_storage_2d<r32float, write>;
@group(0) @binding(5) var o_radiance: texture_storage_2d<rgba16float, write>;
@group(0) @binding(6) var o_hitdist: texture_storage_2d<r32float, write>;
@group(0) @binding(7) var o_ref: texture_storage_2d<rgba16float, write>;

@compute @workgroup_size(8, 8)
fn noisy(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= u.dims)) { return; }
  let pr = primary(id.xy);
  textureStore(o_depth, id.xy, vec4f(pr.depth));
  textureStore(o_normal, id.xy, vec4f(pr.n, 0.0));
  textureStore(o_motion, id.xy, vec4f(pr.motion, 0.0, 0.0));
  textureStore(o_rough, id.xy, vec4f(pr.rough));
  var s = vec4f(0.0);
  if (pr.hit) {
    var seed = pcg(id.x + pcg(id.y + pcg(u.frame * 9781u + u.seedOffset)));
    let xi = rand2(&seed);
    let xi2 = rand2(&seed);
    s = reflectionSample(pr.p, pr.n, -pr.rd, pr.rough, xi, xi2);
  }
  textureStore(o_radiance, id.xy, vec4f(s.rgb, 1.0));
  textureStore(o_hitdist, id.xy, vec4f(s.w));
}

@compute @workgroup_size(8, 8)
fn reference(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= u.dims)) { return; }
  let pr = primary(id.xy);
  var acc = vec3f(0.0);
  if (pr.hit) {
    let g = u32(round(sqrt(f32(u.spp))));
    var seed = pcg(id.x * 7919u + pcg(id.y + 0x9e3779b9u));
    let rot = rand2(&seed);
    let rot2 = rand2(&seed);
    for (var j = 0u; j < g; j++) {
      for (var i = 0u; i < g; i++) {
        let xi = fract((vec2f(f32(i), f32(j)) + 0.5) / f32(g) + rot);
        let xi2 = fract(rand2(&seed) + rot2);
        acc += reflectionSample(pr.p, pr.n, -pr.rd, pr.rough, xi, xi2).rgb;
      }
    }
    acc /= f32(g * g);
  }
  textureStore(o_ref, id.xy, vec4f(acc, 1.0));
}
`;
