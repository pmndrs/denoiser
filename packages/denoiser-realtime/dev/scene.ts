// Synthetic test scene for the dev page: an analytic ray-traced G-buffer
// (plane, wall, spheres, boxes, thin pillars, one moving sphere) and an EXACT
// converged signal per frame, then noise injected on top (the ssgiDev
// `svgf-noiseinject` trick: ground truth is known exactly, so PSNR measures the
// denoiser, not the reference).
//
// Diffuse ground truth: demodulated irradiance E(x, n, frame) = point lights with
// hard analytic shadows + sky term with analytic sphere occlusion. View
// independent, so it reprojects exactly; moving / switching lights change it
// over time (lag test).
// Specular ground truth: demodulated env radiance in the reflected direction,
// pre-convolved with a GGX-sized spherical Gaussian (view dependent: surface
// reprojection is wrong on smooth surfaces, as in real reflections).
// Noise: multiplicative, Exp(1)-distributed (relative std 1, like a 1-spp
// estimator), plus rare fireflies; renormalized to stay unbiased.

export const SCENE_PARAMS_SIZE = 4 * 96;

export const SCENE_OUTPUTS: [string, GPUTextureFormat][][] = [
  [['Depth', 'r32float'], ['ViewZ', 'r32float'], ['Normal', 'rgba16float'], ['Motion', 'rgba16float']],
  [['Mat', 'rgba16float'], ['Diff', 'rgba16float'], ['DiffRef', 'rgba32float'], ['Spec', 'rgba16float']],
  [['SpecRef', 'rgba32float'], ['Grad', 'rgba32float'], ['DiffHit', 'r32float'], ['SpecHit', 'r32float']],
  [['DiffDir', 'rgba16float'], ['DetailN', 'rgba16float']],
];
const ALL = ['Depth', 'ViewZ', 'Normal', 'Motion', 'Mat', 'Diff', 'DiffRef', 'Spec', 'SpecRef', 'Grad', 'DiffHit', 'SpecHit', 'DiffDir', 'DetailN'];

// The scene writes 10 outputs; the default limit is 4 storage textures per
// stage, so it runs as 3 dispatches of the same code with different store stubs.
function outputDecls(part: number): string {
  const mine = SCENE_OUTPUTS[part];
  const decl = mine.map(([n, f], i) => `@group(0) @binding(${i + 1}) var o${n}: texture_storage_2d<${f}, write>;`);
  const fns = ALL.map((n) => mine.some(([m]) => m === n)
    ? `fn st${n}(p: vec2i, v: vec4f) { textureStore(o${n}, p, v); }`
    : `fn st${n}(p: vec2i, v: vec4f) { }`);
  return [...decl, ...fns].join('\n');
}

export const sceneWgsl = (part: number) => /* wgsl */ `
struct SP {
  invViewProj: mat4x4f,
  viewProj: mat4x4f,
  prevViewProj: mat4x4f,
  view: mat4x4f,
  camPos: vec3f, frame: f32,
  dims: vec2f, prevFrame: f32, noise: f32,
  fireflyRate: f32, switchFrame: f32, seed: u32, flags: u32,  // flags: 1 = gradient output, 2 = lights don't move, 4 = directional diffuse samples (SH tests)
  near: f32, far: f32, bumpAmp: f32, pad1: f32,               // bumpAmp: detail-normal bump slope (tan of the max tilt) on floor + wall
}
@group(0) @binding(0) var<uniform> S: SP;
${outputDecls(part)}
struct Hit { t: f32, n: vec3f, id: i32 }

fn movingCenter(frame: f32) -> vec3f { return vec3f(0.5 + 1.5 * sin(frame * 0.03), 0.35, 2.0); }

fn sphereC(i: i32, frame: f32) -> vec4f {
  switch (i) {
    case 0: { return vec4f(0.0, 1.0, 0.0, 1.0); }
    case 1: { return vec4f(-2.5, 0.6, 1.0, 0.6); }
    case 2: { return vec4f(2.2, 0.8, -1.0, 0.8); }
    default: { return vec4f(movingCenter(frame), 0.35); }
  }
}
fn boxB(i: i32) -> array<vec3f, 2> {
  switch (i) {
    case 0: { return array<vec3f, 2>(vec3f(1.0, 0.0, 1.5), vec3f(1.8, 0.6, 2.3)); }
    case 1: { return array<vec3f, 2>(vec3f(-1.25, 0.0, -2.5), vec3f(-1.15, 2.5, -2.4)); }
    default: { return array<vec3f, 2>(vec3f(0.6, 0.0, -3.2), vec3f(0.68, 2.5, -3.12)); }
  }
}

fn hitSphere(o: vec3f, d: vec3f, c: vec4f) -> f32 {
  let oc = o - c.xyz;
  let b = dot(oc, d);
  let h = b * b - (dot(oc, oc) - c.w * c.w);
  if (h < 0.0) { return -1.0; }
  let s = sqrt(h);
  let t0 = -b - s;
  if (t0 > 1e-4) { return t0; }
  let t1 = -b + s;
  return select(-1.0, t1, t1 > 1e-4);
}
fn hitBox(o: vec3f, d: vec3f, b: array<vec3f, 2>, n: ptr<function, vec3f>) -> f32 {
  let inv = 1.0 / d;
  let t0 = (b[0] - o) * inv;
  let t1 = (b[1] - o) * inv;
  let tmin = min(t0, t1);
  let tmax = max(t0, t1);
  let tn = max(max(tmin.x, tmin.y), tmin.z);
  let tf = min(min(tmax.x, tmax.y), tmax.z);
  if (tn > tf || tf < 1e-4 || tn < 1e-4) { return -1.0; }
  if (tn == tmin.x) { *n = vec3f(-sign(d.x), 0.0, 0.0); }
  else if (tn == tmin.y) { *n = vec3f(0.0, -sign(d.y), 0.0); }
  else { *n = vec3f(0.0, 0.0, -sign(d.z)); }
  return tn;
}

fn trace(o: vec3f, d: vec3f, frame: f32) -> Hit {
  var h: Hit;
  h.t = 1e30; h.id = -1;
  if (d.y < 0.0) {           // ground y = 0
    let t = -o.y / d.y;
    if (t > 1e-4 && t < h.t) { h.t = t; h.n = vec3f(0.0, 1.0, 0.0); h.id = 0; }
  }
  if (d.z < 0.0) {           // back wall z = -6
    let t = (-6.0 - o.z) / d.z;
    if (t > 1e-4 && t < h.t) { h.t = t; h.n = vec3f(0.0, 0.0, 1.0); h.id = 1; }
  }
  for (var i = 0; i < 4; i++) {
    let c = sphereC(i, frame);
    let t = hitSphere(o, d, c);
    if (t > 0.0 && t < h.t) { h.t = t; h.n = normalize(o + d * t - c.xyz); h.id = 2 + i; }
  }
  for (var i = 0; i < 3; i++) {
    var n: vec3f;
    let t = hitBox(o, d, boxB(i), &n);
    if (t > 0.0 && t < h.t) { h.t = t; h.n = n; h.id = 6 + i; }
  }
  return h;
}

fn occluded(o: vec3f, d: vec3f, maxT: f32, frame: f32) -> bool {
  for (var i = 0; i < 4; i++) {
    let t = hitSphere(o, d, sphereC(i, frame));
    if (t > 0.0 && t < maxT) { return true; }
  }
  for (var i = 0; i < 3; i++) {
    var n: vec3f;
    let t = hitBox(o, d, boxB(i), &n);
    if (t > 0.0 && t < maxT) { return true; }
  }
  return false;
}

fn material(id: i32, x: vec3f) -> vec4f {
  switch (id) {
    case 0: {
      let c = (i32(floor(x.x)) + i32(floor(x.z))) & 1;
      let rough = clamp(0.05 + (x.x + 4.0) / 8.0 * 0.85, 0.05, 0.9);   // roughness bands across x
      return vec4f(select(vec3f(0.75, 0.72, 0.68), vec3f(0.45, 0.43, 0.40), c == 1), rough);
    }
    case 1: { return vec4f(0.6, 0.62, 0.7, 0.6); }
    case 2: { return vec4f(0.8, 0.3, 0.25, 0.3); }
    case 3: { return vec4f(0.3, 0.7, 0.35, 0.12); }
    case 4: { return vec4f(0.85, 0.85, 0.85, 0.5); }
    case 5: { return vec4f(0.9, 0.75, 0.2, 0.2); }
    default: { return vec4f(0.5, 0.5, 0.75, 0.7); }
  }
}

fn lightPos(i: i32, frame0: f32) -> vec3f {
  let frame = select(frame0, 0.0, (S.flags & 2u) != 0u);   // flags 2: lights don't move
  switch (i) {
    case 0: { return vec3f(3.0, 5.0, 4.0); }
    case 1: { return vec3f(cos(frame * 0.02) * 4.0, 3.0, sin(frame * 0.02) * 4.0); }
    default: { return vec3f(-3.0, 2.5, 2.0); }
  }
}
fn lightCol(i: i32, frame: f32) -> vec3f {
  switch (i) {
    case 0: { return vec3f(2.6, 2.4, 2.1); }
    case 1: { return vec3f(0.7, 0.9, 1.6); }
    default: { return select(vec3f(0.0), vec3f(3.0, 1.3, 0.5), S.switchFrame >= 0.0 && frame >= S.switchFrame); }
  }
}

// Exact demodulated diffuse irradiance at (x, n) for a given frame.
fn irradiance(x: vec3f, n: vec3f, frame: f32) -> vec3f {
  var e = vec3f(0.0);
  let o = x + n * 1e-3;
  for (var i = 0; i < 3; i++) {
    let lp = lightPos(i, frame) - x;
    let d2 = dot(lp, lp);
    let d = sqrt(d2);
    let l = lp / d;
    let ndl = dot(n, l);
    if (ndl <= 0.0) { continue; }
    let col = lightCol(i, frame);
    if (dot(col, col) == 0.0) { continue; }
    if (occluded(o, l, d, frame)) { continue; }
    e += col * ndl * 8.0 / (4.0 + d2);
  }
  // sky with analytic sphere occlusion
  var ao = 1.0;
  for (var i = 0; i < 4; i++) {
    let c = sphereC(i, frame);
    let v = c.xyz - x;
    let d2 = dot(v, v);
    ao *= 1.0 - clamp(dot(n, v / sqrt(d2)) * c.w * c.w / d2, 0.0, 1.0);
  }
  let sky = mix(vec3f(0.12, 0.1, 0.08), vec3f(0.3, 0.4, 0.55), 0.5 + 0.5 * n.y);
  return e + sky * ao;
}

const SUN = vec3f(0.1, 0.35, -0.93);
// Demodulated specular: env convolved with a GGX-sized spherical Gaussian.
fn specularEnv(r: vec3f, rough: f32) -> vec3f {
  let a = max(rough * rough, 0.02);
  let lb = 2.0 / (a * a);
  let ls = 400.0;
  let lc = ls * lb / (ls + lb);
  let sun = vec3f(40.0, 36.0, 30.0) * (lc / ls) * exp(lc * (dot(r, normalize(SUN)) - 1.0));
  let sky = mix(vec3f(0.25, 0.22, 0.2), vec3f(0.35, 0.5, 0.8), clamp(r.y * 1.5 + 0.3, 0.0, 1.0));
  return sky + sun;
}

fn hash(x: u32) -> u32 {
  var v = x;
  v = v ^ (v >> 16u); v = v * 0x7feb352du;
  v = v ^ (v >> 15u); v = v * 0x846ca68bu;
  v = v ^ (v >> 16u);
  return v;
}
fn rnd(p: vec2u, salt: u32) -> f32 {
  return (f32(hash(p.x * 1973u + p.y * 9277u + S.seed * 26699u + salt * 104729u) >> 8u) + 0.5) / 16777216.0;
}
// Multiplicative noise factor with mean 1: Exp(1) mixed in by s, plus fireflies.
fn noiseFactor(p: vec2u, salt: u32, s: f32) -> f32 {
  let ex = -log(rnd(p, salt));
  var x = mix(1.0, ex, s * S.noise);
  // fireflies scale with the noise level (a mirror's 1-spp sample is exact)
  let amp = 23.0 * s * S.noise;
  let ff = select(1.0, 1.0 + amp, rnd(p, salt + 7u) < S.fireflyRate);
  return x * ff / (1.0 + amp * S.fireflyRate);
}

// Detail normal (SH tests): procedural bumps on the floor and the back wall, two
// octaves of sin(ku) sin(kv) height; slope scaled by S.bumpAmp. Smooth elsewhere.
fn detailNormal(id: i32, x: vec3f, n: vec3f) -> vec3f {
  if (S.bumpAmp <= 0.0 || id > 1) { return n; }
  var u = x.x; var v = x.z; var T = vec3f(1.0, 0.0, 0.0); var B = vec3f(0.0, 0.0, 1.0);
  if (id == 1) { v = x.y; B = vec3f(0.0, 1.0, 0.0); }
  let k1 = 15.7; let k2 = 41.0;   // periods 0.4 and ~0.15 world units
  let gu = cos(k1 * u) * sin(k1 * v) + 0.5 * cos(k2 * u + 1.3) * sin(k2 * v + 0.7);
  let gv = sin(k1 * u) * cos(k1 * v) + 0.5 * sin(k2 * u + 1.3) * cos(k2 * v + 0.7);
  return normalize(n - S.bumpAmp * 0.67 * (gu * T + gv * B));
}

fn skyCols() -> array<vec3f, 2> { return array<vec3f, 2>(vec3f(0.12, 0.1, 0.08), vec3f(0.3, 0.4, 0.55)); }

// One directional 1-sample estimate of irradiance(x, ns, frame) (SH tests): pick a light
// (next-event estimate toward it) or the sky (a cosine-distributed direction; the sky
// is the L1 field L(w) = (c0 + c1)/(2 pi) + 3 (c1 - c0) w.y / (4 pi), so its cosine
// estimate pi L(w) has expectation exactly sky(ns)), with probabilities half by
// luminance, half uniform; times the sphere AO at ns (as irradiance()). Unbiased for
// irradiance(x, ns) exactly; returns (value, direction).
fn dirSample(x: vec3f, ns: vec3f, frame: f32, up: vec2u) -> array<vec3f, 2> {
  let o = x + ns * 1e-3;
  var c: array<vec3f, 4>;
  var dirs: array<vec3f, 4>;
  for (var i = 0; i < 3; i++) {
    let lp = lightPos(i, frame) - x;
    let d2 = dot(lp, lp);
    let d = sqrt(d2);
    let l = lp / d;
    dirs[i] = l;
    c[i] = vec3f(0.0);
    let ndl = dot(ns, l);
    let col = lightCol(i, frame);
    if (ndl > 0.0 && dot(col, col) > 0.0 && !occluded(o, l, d, frame)) { c[i] = col * ndl * 8.0 / (4.0 + d2); }
  }
  var ao = 1.0;
  for (var i = 0; i < 4; i++) {
    let cs = sphereC(i, frame);
    let v = cs.xyz - x;
    let d2 = dot(v, v);
    ao *= 1.0 - clamp(dot(ns, v / sqrt(d2)) * cs.w * cs.w / d2, 0.0, 1.0);
  }
  let sk = skyCols();
  c[3] = mix(sk[0], sk[1], 0.5 + 0.5 * ns.y) * ao;
  let wl = vec3f(0.2126, 0.7152, 0.0722);
  var tot = 0.0;
  for (var i = 0; i < 4; i++) { tot += dot(c[i], wl); }
  var pk: array<f32, 4>;
  for (var i = 0; i < 4; i++) { pk[i] = select(0.25, 0.5 * dot(c[i], wl) / tot + 0.125, tot > 0.0); }
  let u0 = rnd(up, 51u);
  var k = 3;
  var acc = 0.0;
  for (var i = 0; i < 3; i++) { acc += pk[i]; if (u0 < acc) { k = i; break; } }
  if (k < 3) { return array<vec3f, 2>(c[k] / pk[k], dirs[k]); }
  // sky: cosine-distributed direction around ns
  let u1 = rnd(up, 53u);
  let u2 = rnd(up, 57u);
  let s = select(-1.0, 1.0, ns.z >= 0.0);
  let ca = -1.0 / (s + ns.z);
  let tb = vec3f(1.0 + s * ns.x * ns.x * ca, s * ns.x * ns.y * ca, -s * ns.x);
  let bb = vec3f(ns.x * ns.y * ca, s + ns.y * ns.y * ca, -ns.y);
  let rr = sqrt(u1);
  let ph = 6.2831853 * u2;
  let w = normalize(tb * (rr * cos(ph)) + bb * (rr * sin(ph)) + ns * sqrt(max(0.0, 1.0 - u1)));
  let xs = (0.5 * (sk[0] + sk[1]) + 0.75 * (sk[1] - sk[0]) * w.y) * ao;
  return array<vec3f, 2>(xs / pk[3], w);
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let p = vec2i(gid.xy);
  if (f32(p.x) >= S.dims.x || f32(p.y) >= S.dims.y) { return; }
  let uv = (vec2f(p) + 0.5) / S.dims;
  let ndc = vec2f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);
  let a = S.invViewProj * vec4f(ndc, 0.2, 1.0);
  let b = S.invViewProj * vec4f(ndc, 0.8, 1.0);
  let o = S.camPos;
  let d = normalize(b.xyz / b.w - a.xyz / a.w);
  var h = trace(o, d, S.frame);
  if (h.id >= 0 && -(S.view * vec4f(o + d * h.t, 1.0)).z > S.far * 0.99) { h.id = -1; }   // beyond the far plane = sky
  if (h.id < 0) {
    stDepth(p, vec4f(1.0));
    stViewZ(p, vec4f(-S.far));
    stNormal(p, vec4f(0.0));
    stMotion(p, vec4f(0.0));
    stMat(p, vec4f(0.0));
    stDiff(p, vec4f(0.0));
    stDiffRef(p, vec4f(0.0));
    stSpec(p, vec4f(0.0));
    stSpecRef(p, vec4f(0.0));
    stDiffHit(p, vec4f(0.0));
    stSpecHit(p, vec4f(0.0));
    stDiffDir(p, vec4f(0.0));
    stDetailN(p, vec4f(0.0));
    return;
  }
  let x = o + d * h.t;
  let clip = S.viewProj * vec4f(x, 1.0);
  stDepth(p, vec4f(clip.z / clip.w));
  let vz = (S.view * vec4f(x, 1.0)).z;
  stViewZ(p, vec4f(vz));
  stNormal(p, vec4f(h.n, 0.0));
  // motion: the moving sphere's points moved with its center
  var xPrev = x;
  if (h.id == 5) { xPrev = x - movingCenter(S.frame) + movingCenter(S.prevFrame); }
  let pc = S.prevViewProj * vec4f(xPrev, 1.0);
  let ndcPrev = pc.xy / pc.w;
  // motionZ = viewZprev - viewZ needs the previous view; prevViewProj's w = -viewZprev for a perspective camera
  stMotion(p, vec4f(clip.xy / clip.w - ndcPrev, -pc.w - vz, 0.0));
  let m = material(h.id, x);
  stMat(p, m);
  let up = vec2u(gid.xy);
  let ndet = detailNormal(h.id, x, h.n);
  stDetailN(p, vec4f(ndet, 0.0));
  let e = irradiance(x, ndet, S.frame);
  let nd = noiseFactor(up, 0u, 1.0);
  stDiffRef(p, vec4f(e, 1.0));
  if ((S.flags & 4u) != 0u) {
    let ds = dirSample(x, ndet, S.frame, up);
    stDiff(p, vec4f(ds[0] * nd, 1.0));
    stDiffDir(p, vec4f(ds[1], 0.0));
  } else {
    stDiff(p, vec4f(e * nd, 1.0));
    stDiffDir(p, vec4f(0.0));
  }
  let r = reflect(d, h.n);
  let sr = specularEnv(r, m.a);
  stSpecRef(p, vec4f(sr, 1.0));
  let ns = noiseFactor(up, 11u, clamp(m.a * 2.5, 0.0, 1.0));
  stSpec(p, vec4f(sr * ns, 0.0));
  // 1-spp hit distances (0 = miss): a cosine-distributed ray for diffuse, the
  // mirror direction for specular (the recurrent filter's radius / AO input).
  {
    let u1 = rnd(up, 31u);
    let u2 = rnd(up, 37u);
    let s = select(-1.0, 1.0, h.n.z >= 0.0);
    let ca = -1.0 / (s + h.n.z);
    let tb = vec3f(1.0 + s * h.n.x * h.n.x * ca, s * h.n.x * h.n.y * ca, -s * h.n.x);
    let bb = vec3f(h.n.x * h.n.y * ca, s + h.n.y * h.n.y * ca, -h.n.y);
    let rr = sqrt(u1);
    let ph = 6.2831853 * u2;
    let dd = normalize(tb * (rr * cos(ph)) + bb * (rr * sin(ph)) + h.n * sqrt(max(0.0, 1.0 - u1)));
    let hd = trace(x + h.n * 1e-3, dd, S.frame);
    stDiffHit(p, vec4f(select(0.0, hd.t, hd.id >= 0 && hd.t < 50.0)));
    let hs = trace(x + h.n * 1e-3, r, S.frame);
    stSpecHit(p, vec4f(select(0.0, hs.t, hs.id >= 0 && hs.t < 50.0)));
  }

  // A-SVGF gradient sample: one random pixel per 3x3 stratum is "re-shaded"
  // with last frame's lighting and the same noise (same random numbers).
  if ((S.flags & 1u) != 0u) {
    let s = up / 3u;
    let pick = vec2u(u32(rnd(s, 101u) * 3.0), u32(rnd(s, 202u) * 3.0));
    if (all(up % 3u == min(pick, vec2u(2u)))) {
      let ePrev = irradiance(x, ndet, S.prevFrame);
      let w = vec3f(0.2126, 0.7152, 0.0722);
      stGrad(vec2i(s), vec4f(dot(ePrev * nd, w), dot(e * nd, w), 1.0, 0.0));
    }
  }
}
`;

// Strata with no gradient sample must read as invalid: cleared before the scene pass.
