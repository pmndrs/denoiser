// Recurrent blur passes (`filter: 'recurrent'`), one or two signals per
// dispatch (diffuse + specular share every pass, SPEC §5.1). Provisional: built
// against SPEC v0, which Dennis has not reviewed yet.
//
//   R1 pre_blur     raw radiance + hit distance -> pre (rgb, raw normalized hit distance)
//   R2 temporal     pre + reprojected history -> acc (rgb, ĥ), fast history F, data (A)
//   R3 mips         acc -> 3-level mip atlases (signals, depth)
//   R4 history_fix  mip repair, anti-firefly, fast-history clamp + anti-lag (data in place)
//   R5 blur         rotated 8-tap disk, radius ∝ 1/(1+A)
//   R6 post_blur    unrotated, radius scaled by how much the blur changed things -> next history
//   R7 stabilize    own history, neighbourhood clamp, never fed back -> output
//
// Design: docs/research/rt-denoiser/SPEC.md §2 (front end F-1/F-3), §3 (shared
// temporal core C-6..C-10), §5 (recurrent pipeline R-1..R-6, D1..D15), §10.1
// (formats, buffer rotation). Public sources behind it (full table in
// docs/research/rt-denoiser/PROVENANCE.md):
// - Zhdan, "ReBLUR: A Hierarchical Recurrent Denoiser", Ray Tracing Gems II
//   ch. 49 (2021), prose and equations only (its numbered listings are not a
//   source for this project): §49.3 recurrent loop (post-blur output is next
//   frame's history), §49.5.1 pre-blur, §49.5.2 accumulation, Eq. 49.1 running
//   mean 1/(1+A), §49.5.3 mips in one pass, §49.5.4 p.829 history fix (3x3,
//   viewZ-only weights), p.830 anti-firefly / faster-history clamp, §49.5.5
//   8-tap Poisson disk with animated 4x4 Bayer rotation, §49.5.6 post-blur,
//   §49.5.7 stabilization with its own history, §49.6 plane-distance
//   disocclusion, §49.7 Catmull-Rom history, §49.9 world-space kernel plane,
//   Eq. 49.2/49.3 weights w = Π smoothstep(0, 1, 1 − x).
// - Zhdan, "Fast Denoising with Self-Stabilizing Recurrent Blurs", GTC 2020
//   (s22699): s.9 normalized hit distance = AO/SO, s.20-22 radius 1/(1+A),
//   s.27-30 custom-weighted bilinear, s.35 history-fix start level, s.38-40
//   kernel plane, s.60 hit distance not filtered in the pre-blur.
// - Vogel 1979 (golden-angle spiral, our 4+4 antipodal disk); Duff et al.,
//   JCGT 6(1) 2017 (orthonormal basis); Lagarde & de Rousiers 2014 (Frostbite)
//   Listing 22 (dominant direction, specular kernel plane only).
// - Our design (SPEC): rational hit-distance curve ĥ = h/(h + a + b·d), pre-blur
//   clamp by last frame's denoised hit distance, fast-history anti-lag with
//   min-combined luminance / ĥ detectors in history fix, rank-based firefly
//   clamp, A packed as fixed point in an r32uint, mip atlas, stabilization
//   clamp widening with A, post-blur radius function.
// - Our measured deviations from SPEC v0 (TASKS "Found along the way"): fast-history
//   clamp window from the standard error of the 3x3 mean; a current-frame anti-lag
//   detector in the temporal pass; affine (screen-Jacobian) tap placement and plane
//   distance linear in the tap pixel; stabilization reuses the temporal pass's 2x2
//   validity (stored in data); branchless taps and neighbourhoods.
// - Specular (M3): virtual (reflected-image) motion R-9..R-12 from RTG2 §49.8.2 prose
//   (virtual image: RTG1 ch. 25 p.451, Stachowiak 2015 slide 67), curvature-corrected
//   virtual distance with the mirror equation (RTG1 ch. 32 §32.4.3, D12c); confidence,
//   clamp and alpha-space blend are our designs. Measured M3 changes: virtual clamp
//   always on (window widening with confidence); specular anti-lag / detector mean
//   centred on the pixel as roughness -> 0 and detector floor A_fast f_r (clean mirror
//   input); f_r-scaled minimum radius; no virtual candidate in stabilization; 4-tap
//   post-blur (both) and pre-blur (specular); 10x10 shared tiles for the 3x3
//   neighbourhoods; cheaper recurrent-only reprojection (REPROJECT_R).
import { Bindings, type PassDef } from './bindings';
import { FRAME_WGSL, HISTORY_SAMPLE_WGSL, REPROJECT_WGSL } from './common';

/**
 * Signal kinds. `ao` / `so` are the occlusion-only mode (SPEC §8 O-2, M5): the same passes
 * with the radiance channels dropped, one r32float channel per signal (the normalized hit
 * distance ĥ of diffuse / specular rays). `ao` takes the diffuse kernel, `so` the
 * specular one (roughness, lobe plane, virtual motion).
 */
export type RecurrentKind = 'diffuse' | 'specular' | 'ao' | 'so';
/** Specular kernel / temporal logic (radiance or occlusion). */
export const isSpecKind = (k: RecurrentKind) => k === 'specular' || k === 'so';
/** Occlusion-only signal: buffers hold ĥ alone (r32float), no radiance. */
export const isOccKind = (k: RecurrentKind) => k === 'ao' || k === 'so';
/** Storage format of a signal's rotation buffers. */
export const formatOf = (k: RecurrentKind): GPUTextureFormat => (isOccKind(k) ? 'r32float' : 'rgba16float');
// WGSL snippets per kind: value type, ĥ of a value, a buffer load, a computed value's store
// argument, the zero value. Radiance kinds emit exactly the code they did before M5.
const VT = (k: RecurrentKind) => (isOccKind(k) ? 'f32' : 'vec4f');
const hOf = (k: RecurrentKind, x: string) => (isOccKind(k) ? x : `${x}.a`);
const LD = (k: RecurrentKind, tex: string, q: string) => (isOccKind(k) ? `textureLoad(${tex}, ${q}, 0).r` : `textureLoad(${tex}, ${q}, 0)`);
const ST = (k: RecurrentKind, v: string) => (isOccKind(k) ? `vec4f(${v})` : v);
const ZERO = (k: RecurrentKind) => (isOccKind(k) ? '0.0' : 'vec4f(0.0)');
const BIG = (k: RecurrentKind, x: string) => (isOccKind(k) ? x : `vec4f(${x})`);

/** RParams.flags */
export const RP_HAS_HIT = 1;
export const RP_REMODULATE = 2;
export const RP_NO_ANTILAG = 4;
export const RP_NO_FIREFLY = 8;
export const RP_NO_HISTORY_FIX = 16;
export const RP_NO_STABILIZE = 32;
export const RP_NO_VIRTUAL = 64;

/** Uniform sizes in bytes. */
export const RP_SIZE = 48 * 4;
export const RF_SIZE = 48 * 4;

/** Disk taps used for a kernel with n taps (R-3 table indices; 4 = two antipodal pairs ~90° apart). */
export const tapSet = (n: number) => (n <= 4 ? [0, 2, 4, 6] : [0, 1, 2, 3, 4, 5, 6, 7]);

/** Slot in the packed data / fast-history channels: diffuse 0, specular 1. */
export const slotOf = (k: RecurrentKind) => (isSpecKind(k) ? 1 : 0);

const RSTRUCTS = /* wgsl */ `
struct RFrame {
  proj: mat4x4f,     // current projection (unjittered), view -> clip
  unp: vec4f,        // 1/P0, 1/P5, P8, P9   (view position from linear depth)
  unp2: vec4f,       // P12, P13, ortho (0/1), 2/(P5 H) (world size of a pixel per unit depth)
  rot: f32,          // golden-ratio rotation offset of this frame (SPEC D3b)
  pad0: f32, pad1: f32, pad2: f32,
  prevProj: mat4x4f, // previous projection (unjittered), previous view -> clip (virtual motion, R-9)
  prevUnp: vec4f,    // 1/P0, 1/P5, P8, P9 of the previous projection
}
struct RParams {
  hitA: f32, hitB: f32, maxRadiance: f32, preRadius: f32,
  maxRadius: f32, minRadius: f32, aCap: f32, aFast: f32,
  aFix: f32, fixTol: f32, fixMinWeight: f32, fireflyK: f32,
  lagGamma: f32, lagEMax: f32, lagHitTol: f32, stabFrames: f32,
  stabGammaLo: f32, stabGammaHi: f32, stabBeta: f32, planeTol: f32,
  geoTolLo: f32, geoTolHi: f32, normalTight: f32, lobeFraction: f32,
  postLo: f32, postHi: f32, postDelta: f32, hitTolLo: f32,
  hitTolHi: f32, hitTolTight: f32, specScale: f32, flags: u32,
  lagCurSigma: f32, lagCurHitTol: f32, lagStdErr: f32, virtGamma: f32,
  virtAngle: f32, virtHitLo: f32, virtHitHi: f32, specMinRadius: f32,
  virtCurv: f32, virtWiden: f32, detRough: f32, specCentre: f32,
  elong: f32, occClamp: f32, pad7: f32, pad8: f32,
}
const RP_HAS_HIT = ${RP_HAS_HIT}u;
const RP_REMODULATE = ${RP_REMODULATE}u;
const RP_NO_ANTILAG = ${RP_NO_ANTILAG}u;
const RP_NO_FIREFLY = ${RP_NO_FIREFLY}u;
const RP_NO_HISTORY_FIX = ${RP_NO_HISTORY_FIX}u;
const RP_NO_STABILIZE = ${RP_NO_STABILIZE}u;
const RP_NO_VIRTUAL = ${RP_NO_VIRTUAL}u;
`;

// Helpers shared by every recurrent pass (need F, RF in scope).
const RCOMMON = /* wgsl */ `
fn finiteR(c: vec3f) -> vec3f {
  let b = bitcast<vec3u>(c) & vec3u(0x7f800000u);
  return select(c, vec3f(0.0), b == vec3u(0x7f800000u));
}
// F-1: non-finite / negative -> 0, safety clamp (not the firefly filter).
fn sanitize(c: vec3f, maxR: f32) -> vec3f { return min(max(finiteR(c), vec3f(0.0)), vec3f(maxR)); }
// SPEC R-6 / RTG II Eq. 49.3: W(x) = smoothstep(0, 1, saturate(1 - x)).
fn Wt(x: f32) -> f32 { return smoothstep(0.0, 1.0, clamp(1.0 - x, 0.0, 1.0)); }
fn isOrtho() -> bool { return RF.unp2.z > 0.5; }
// SPEC C-1 (pixel centre; jitter ignored like the shared core).
fn viewPosAt(uv: vec2f, d: f32) -> vec3f {
  let ndc = ndcOf(uv);
  if (isOrtho()) { return vec3f((ndc.x - RF.unp2.x) * RF.unp.x, (ndc.y - RF.unp2.y) * RF.unp.y, -d); }
  return vec3f(d * (ndc.x + RF.unp.z) * RF.unp.x, d * (ndc.y + RF.unp.w) * RF.unp.y, -d);
}
// World size of one pixel at depth d (SPEC §5.2 pixSize).
fn pixSize(d: f32) -> f32 { return select(d, 1.0, isOrtho()) * RF.unp2.w; }
// GGX lobe half-angle containing fraction E of the projected microfacet area (SPEC R-1, our derivation).
fn thetaL(alpha: f32, E: f32) -> f32 { return atan(alpha * sqrt(E / (1.0 - E))); }
// Dominant-direction factor (SPEC R-2, Lagarde & de Rousiers 2014 Listing 22, fed with GGX alpha).
fn domFactor(alpha: f32) -> f32 { return (1.0 - alpha) * (sqrt(1.0 - alpha) + alpha); }
// R-9: uv in the previous frame of the virtual (reflected) image of a surface point:
// X_virt = X + normalize(X - camPos) * h * F_dom (world space; static reflected world).
// Returns (-1, -1) behind the previous camera.
fn virtualPrevUV(world: vec3f, hDist: f32, fdom: f32) -> vec2f {
  let wv = world + normalize(world - F.camPos) * (hDist * fdom);
  let clip = RF.prevProj * (F.prevView * vec4f(wv, 1.0));
  if (!(clip.w > 1e-6)) { return vec2f(-1.0); }
  let ndc = clip.xy / clip.w;
  return vec2f(0.5 + 0.5 * ndc.x, 0.5 - 0.5 * ndc.y);
}
fn onScreen(uv: vec2f) -> bool { return all(uv >= vec2f(0.0)) && all(uv <= vec2f(1.0)); }
fn viewNormal(n: vec3f) -> vec3f { return normalize((F.view * vec4f(n, 0.0)).xyz); }
// Orthonormal basis (Duff et al. 2017).
fn onbT(n: vec3f) -> vec3f {
  let s = select(-1.0, 1.0, n.z >= 0.0);
  let a = -1.0 / (s + n.z);
  return vec3f(1.0 + s * n.x * n.x * a, s * n.x * n.y * a, -s * n.x);
}
fn onbB(n: vec3f) -> vec3f {
  let s = select(-1.0, 1.0, n.z >= 0.0);
  let a = -1.0 / (s + n.z);
  return vec3f(n.x * n.y * a, s + n.y * n.y * a, -n.y);
}
// data texture (SPEC §5.12, D14): A_d, A_s as 10-bit fixed point A*16, m 8-bit unorm,
// and the temporal pass's 2x2 history validity mask (4 bits, reused by stabilization).
fn unpackA(v: u32, slot: u32) -> f32 { return f32((v >> (10u * slot)) & 1023u) / 16.0; }
fn unpackM(v: u32) -> f32 { return f32((v >> 20u) & 255u) / 255.0; }
fn packData(ad: f32, as_: f32, m: f32, mask: u32) -> u32 {
  let a = u32(round(clamp(ad, 0.0, 63.9375) * 16.0));
  let b = u32(round(clamp(as_, 0.0, 63.9375) * 16.0));
  let c = u32(round(clamp(m, 0.0, 1.0) * 255.0));
  return a | (b << 10u) | (c << 20u) | ((mask & 15u) << 28u);
}

// Plane distance of a tap (pixel q, depth z) from the centre's plane {X, n}, relative
// to the view distance: dot(n, X_q) is linear in q for a fixed depth, so the per-tap
// cost is a few FMAs (perspective: X_q = z (lin(q), -1); orthographic: X_q = (lin(q), -z)).
struct Plane { a: vec3f, b: vec3f, c0: f32, invLen: f32 }
fn makePlaneU(X: vec3f, nv: vec3f, unp: vec4f) -> Plane {
  var pl: Plane;
  let kx = 2.0 * F.invDims.x;
  let cx = F.invDims.x - 1.0;
  let ky = -2.0 * F.invDims.y;
  let cy = 1.0 - F.invDims.y;
  let ex = nv.x * unp.x;
  let ey = nv.y * unp.y;
  if (isOrtho()) {
    pl.a = vec3f(-nv.z, 0.0, 0.0);
    pl.b = vec3f(ex * (cx - RF.unp2.x) + ey * (cy - RF.unp2.y), ex * kx, ey * ky);
  } else {
    pl.a = vec3f(ex * (cx + unp.z) + ey * (cy + unp.w) - nv.z, ex * kx, ey * ky);
    pl.b = vec3f(0.0);
  }
  pl.c0 = dot(nv, X);
  pl.invLen = 1.0 / length(X);
  return pl;
}
fn makePlane(X: vec3f, nv: vec3f) -> Plane { return makePlaneU(X, nv, RF.unp); }
fn planeDist(pl: Plane, q: vec2i, z: f32) -> f32 {
  let qf = vec2f(q);
  return abs(z * (pl.a.x + pl.a.y * qf.x + pl.a.z * qf.y) + pl.b.x + pl.b.y * qf.x + pl.b.z * qf.y - pl.c0) * pl.invLen;
}

// ---- spatial kernel (SPEC §5.9)
struct Kern {
  jx: vec2f, jy: vec2f,   // screen-space (pixel) images of the kernel axes T*R, B*R at the centre
  pl: Plane,
  invGeoTol: f32, invOneMinusCos: f32, invHitTol: f32, invRoughTol: f32,
  hh: f32, rough: f32,
}
// R-3: 8 taps in 4 antipodal pairs (golden-angle spiral, radii sqrt((i + 0.5)/4)).
const DISK = array<vec2f, 8>(
  vec2f(0.3536, 0.0), vec2f(-0.4515, 0.4137), vec2f(0.0691, -0.7875), vec2f(0.5691, 0.7423),
  vec2f(-0.3536, 0.0), vec2f(0.4515, -0.4137), vec2f(-0.0691, 0.7875), vec2f(-0.5691, -0.7423));
// D3b: animated 4x4 Bayer rotation (blur only).
const BAYER4 = array<f32, 16>(0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
fn blurRotation(p: vec2i) -> mat2x2f {
  let phi = 6.2831853 * fract(BAYER4[(p.y & 3) * 4 + (p.x & 3)] / 16.0 + RF.rot);
  let c = cos(phi);
  let s = sin(phi);
  return mat2x2f(c, s, -s, c);
}
// Pixel a kernel offset o (unit disk) lands in; x = -1 when rejected (off-screen,
// centre pixel). Affine: the projected kernel axes at the centre (our approximation
// of projecting each world-space tap, SPEC R-4).
fn tapPixel(p: vec2i, k: Kern, o: vec2f) -> vec2i {
  let q = vec2i(floor(vec2f(p) + 0.5 + k.jx * o.x + k.jy * o.y));
  if (all(q == p) || !inside(q)) { return vec2i(-1); }
  return q;
}
// Geometry (plane distance relative to view distance) x normal (lobe angle) weights.
fn tapGeoW(k: Kern, n: vec3f, gq: Geo, q: vec2i) -> f32 {
  let xg = planeDist(k.pl, q, gq.z) * k.invGeoTol;
  // angle ratio theta/theta0 in cosine space: sqrt((1 - cos)/(1 - cos0)) (no acos per tap)
  let xn = sqrt(max(0.0, 1.0 - dot(n, gq.n)) * k.invOneMinusCos);
  return Wt(xg) * Wt(xn);
}
`;

/** Per-signal helpers: hit-distance curve, kernel construction, radius factors. */
function signalWgsl(kind: RecurrentKind, i: number): string {
  const P = `P${i}`;
  const spec = isSpecKind(kind);
  return /* wgsl */ `
// F-3: ĥ = h / (h + a + b d); miss (0 or non-finite) -> 1.
fn hNorm${i}(h: f32, d: f32) -> f32 {
  if (!(h > 0.0) || h > 1e30) { return 1.0; }
  return h / (h + ${P}.hitA + ${P}.hitB * d);
}
fn hDenorm${i}(x: f32, d: f32) -> f32 {
  let c = clamp(x, 0.0, 0.999);
  return (${P}.hitA + ${P}.hitB * d) * c / (1.0 - c);
}
fn alpha${i}(g: Geo) -> f32 { return ${spec ? 'g.rough * g.rough' : '1.0'}; }
// R-5 factors: f_r (radius vs roughness) and c_h (hit-distance clamp scale).
fn radiusRough${i}(g: Geo) -> f32 { return ${spec ? 'sqrt(clamp(alpha' + i + '(g) / 0.25, 0.0, 1.0))' : '1.0'}; }
fn hitClamp${i}(g: Geo) -> f32 { return ${spec ? `tan(thetaL(alpha${i}(g), ${P}.lobeFraction))` : '1.0'}; }
fn kern${i}(g: Geo, X: vec3f, nv: vec3f, R: f32, An: f32, hh: f32) -> Kern {
  var k: Kern;
  let alpha = alpha${i}(g);
  var T: vec3f;
  var B: vec3f;
  ${spec ? /* wgsl */ `
  // R-4: kernel plane around a = reflect(-D, n), D the dominant direction (R-2);
  // T shrunk perpendicular to the plane of incidence at mid roughness / grazing view.
  let v = -normalize(X);
  let NoV = max(dot(nv, v), 1e-4);
  let fd = (1.0 - alpha) * (sqrt(1.0 - alpha) + alpha);
  let D = normalize(mix(nv, reflect(-v, nv), fd));
  let a = reflect(-D, nv);
  if (abs(dot(a, nv)) > 0.999) { T = onbT(nv); B = onbB(nv); }
  else { T = normalize(cross(nv, a)); B = cross(a, T); }
  T *= 1.0 - ${P}.elong * (1.0 - NoV) * 4.0 * g.rough * (1.0 - g.rough);` : /* wgsl */ `
  T = onbT(nv);   // diffuse: tangent plane (a = n)
  B = onbB(nv);`}
  // screen-space Jacobian of the kernel plane at the centre, offsets capped at 2 R_max
  let c = RF.proj * vec4f(X, 1.0);
  let t = RF.proj * vec4f(T * R, 0.0);
  let b = RF.proj * vec4f(B * R, 0.0);
  let sc = vec2f(0.5, -0.5) * F.dims / (c.w * c.w);
  k.jx = (t.xy * c.w - c.xy * t.w) * sc;
  k.jy = (b.xy * c.w - c.xy * b.w) * sc;
  let mx = max(length(k.jx), length(k.jy));
  let maxPx = 2.0 * max(${P}.maxRadius, ${P}.preRadius);
  if (mx > maxPx) { k.jx *= maxPx / mx; k.jy *= maxPx / mx; }
  k.pl = makePlane(X, nv);
  k.invGeoTol = 1.0 / mix(${P}.geoTolLo, ${P}.geoTolHi, An);
  let thN = min(thetaL(alpha, ${P}.lobeFraction) * mix(1.0, ${P}.normalTight, An) + 0.0174533, 1.5);
  k.invOneMinusCos = 1.0 / max(1.0 - cos(thN), 1e-6);
  k.invHitTol = 1.0 / (mix(${P}.hitTolLo, ${P}.hitTolHi, ${spec ? 'g.rough' : '1.0'}) * mix(1.0, ${P}.hitTolTight, An));
  k.invRoughTol = 1.0 / (0.05 + 0.25 * g.rough);
  k.hh = hh;
  k.rough = g.rough;
  return k;
}
`;
}

/** One unrolled kernel tap for signal i. */
function tapWgsl(kind: RecurrentKind, i: number, t: number, o: { rotate: boolean; hitWeight: boolean; load: (q: string) => string; rgbOnly: boolean }) {
  const off = o.rotate ? `rot * DISK[${t}]` : `DISK[${t}]`;
  const acc = o.rgbOnly ? '.rgb' : '';
  // Branchless: both loads issue together (latency-bound otherwise); rejected taps get w = 0.
  return /* wgsl */ `
    {
      let q0 = tapPixel(p, k${i}, ${off});
      let q = select(p, q0, q0.x >= 0);
      let gq = geoTap(geoCur, q);
      let s = ${o.load('q')};
      var w = select(0.0, tapGeoW(k${i}, g.n, gq, q), q0.x >= 0 && gq.z > 0.0);${o.hitWeight ? `
      w *= Wt(abs(${hOf(kind, 's')} - k${i}.hh) * k${i}.invHitTol);` : ''}${isSpecKind(kind) ? `
      w *= Wt(abs(gq.rough - k${i}.rough) * k${i}.invRoughTol);` : ''}
      sum${i} += s${acc} * w;
      sw${i} += w;
    }`;
}

const head = (b: Bindings, extra = '') => /* wgsl */ `
${FRAME_WGSL}
${RSTRUCTS}
${b.wgsl}
${extra}
${RCOMMON}
`;

/**
 * Workgroup-shared 10x10 tile (8x8 workgroup + 1-pixel halo) for 3x3 neighbourhoods:
 * each texel is loaded (and decoded) once per workgroup instead of once per
 * neighbouring thread. loadTile() must be called from uniform control flow.
 */
interface TileField { name: string; type: string; load: (q: string) => string }
function tileWgsl(fields: TileField[]): string {
  return /* wgsl */ `
${fields.map((f) => `var<workgroup> tile_${f.name}: array<${f.type}, 100>;`).join('\n')}
fn loadTile(lid: vec3u, wid: vec3u) {
  let origin = vec2i(wid.xy) * 8 - 1;
  for (var k = lid.y * 8u + lid.x; k < 100u; k += 64u) {
    let q = clampPix(origin + vec2i(i32(k % 10u), i32(k / 10u)));
    ${fields.map((f) => `tile_${f.name}[k] = ${f.load('q')};`).join('\n    ')}
  }
  workgroupBarrier();
}
fn tidx(lid: vec3u, dx: i32, dy: i32) -> u32 { return u32(i32(lid.y) + 1 + dy) * 10u + u32(i32(lid.x) + 1 + dx); }
`;
}
const TILE_MAIN = '@builtin(global_invocation_id) gid: vec3u, @builtin(local_invocation_id) lid: vec3u, @builtin(workgroup_id) wid: vec3u';

function base(kinds: RecurrentKind[]) {
  const b = new Bindings();
  b.uniform('F', 'Frame');
  b.uniform('RF', 'RFrame');
  kinds.forEach((_, i) => b.uniform(`P${i}`, 'RParams'));
  b.add('geoCur', 'texture_2d<u32>', 'i');
  return b;
}
function addReproj(b: Bindings) {
  b.add('geoPrev', 'texture_2d<u32>', 'i');
  b.add('motionTex', 'texture_2d<f32>', 'f');
  b.add('motionZTex', 'texture_2d<f32>', 'f');
}

// ---- R1 pre-blur (SPEC §5.4, D1) ------------------------------------------------

export function preBlurPass(kinds: RecurrentKind[], taps: number[] = kinds.map(() => 8)): PassDef {
  const b = base(kinds);
  addReproj(b);
  kinds.forEach((_, i) => {
    b.add(`input${i}`, 'texture_2d<f32>', 'f');
    b.add(`hit${i}`, 'texture_2d<f32>', 'f');
    b.add(`histPrev${i}`, 'texture_2d<f32>', 'f');
    b.add(`outPre${i}`, 'texture_storage_2d<rgba16float, write>', 'rgba16float');
  });
  const I = kinds.map((_, i) => i);
  const code = /* wgsl */ `
${head(b)}
${kinds.map((k, i) => signalWgsl(k, i)).join('\n')}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let p = vec2i(gid.xy);
  if (!inside(p)) { return; }
  let g = geoTap(geoCur, p);
  if (g.z <= 0.0) {
    ${I.map((i) => `textureStore(outPre${i}, p, vec4f(0.0));`).join(' ')}
    return;
  }
  let uv = uvOf(p);
  let X = viewPosAt(uv, g.z);
  let nv = viewNormal(g.n);
  let ps = pixSize(g.z);
  // D1b: last frame's denoised hit distance at the nearest reprojected texel, if
  // that texel's depth matches (raw hitT is too noisy to size kernels). A 5 %
  // relative-depth check instead of the plane test (only sizes a kernel; keeps the
  // loads parallel).
  let mv = textureLoad(motionTex, p, 0).xy;
  let prevUV = uv - vec2f(mv.x, -mv.y) * 0.5;
  let gq0 = vec2i(floor(prevUV * F.dims));
  let guideQ = clampPix(gq0);
  let zPrevTap = bitcast<f32>(textureLoad(geoPrev, guideQ, 0).x);
  var zPrev: f32;
  if (hasFlag(FRAME_HAS_MOTIONZ)) { zPrev = g.z - textureLoad(motionZTex, p, 0).r; }
  else { zPrev = -(F.prevView * (F.viewInv * vec4f(X, 1.0))).z; }
  let guideOk = !hasFlag(FRAME_RESET) && all(gq0 == guideQ) && zPrevTap > 0.0 && abs(zPrevTap - zPrev) < 0.05 * zPrev;
  ${I.map((i) => /* wgsl */ `
  {
    let c = sanitize(textureLoad(input${i}, p, 0).rgb, P${i}.maxRadiance);
    var hh = 1.0;
    if ((P${i}.flags & RP_HAS_HIT) != 0u) { hh = hNorm${i}(textureLoad(hit${i}, p, 0).r, g.z); }
    var R = P${i}.preRadius * radiusRough${i}(g) * ps;
    let hPrev${i} = textureLoad(histPrev${i}, guideQ, 0).a;
    if (guideOk) { R = min(R, hitClamp${i}(g) * hDenorm${i}(hPrev${i}, g.z)); }
    var sum${i} = c;
    var sw${i} = 1.0;
    if (R > 0.5 * ps) {   // smaller kernels land on the centre pixel
      let k${i} = kern${i}(g, X, nv, R, 0.0, hh);
      ${tapSet(taps[i]).map((t) => tapWgsl(kinds[i], i, t, {
        rotate: false, hitWeight: false, rgbOnly: true,
        load: (q) => `vec4f(sanitize(textureLoad(input${i}, ${q}, 0).rgb, P${i}.maxRadiance), 0.0)`,
      })).join('')}
    }
    // ĥ passes through unfiltered (GTC20 s.60)
    textureStore(outPre${i}, p, vec4f(sum${i} / sw${i}, hh));
  }`).join('')}
}
`;
  return { code, entries: b.entries };
}

// ---- R2 temporal accumulation (SPEC §5.5, C-6..C-10) ----------------------------


// (luminance, ĥ) of a value: the moments the anti-lag detectors and the fast history use.
const mvec = (k: RecurrentKind, x: string) => (isOccKind(k) ? `vec2f(0.0, ${x})` : `vec2f(luma(${x}.rgb), ${x}.a)`);

// Current-frame anti-lag detector (our addition to C-10, measured: the fast history
// alone reacts at its own EMA speed): 3x3 mean of this frame's pre-blurred luminance
// and ĥ vs the reprojected history Hd, in units of the mean's standard error.
// Reduces the variable `a` in place (SPEC C-10 reduction form).
// Occlusion kinds (ao / so) have no luminance: the ĥ detector alone (SPEC O-2).
const detector = (i: number, a: string, Hd: string, floor = `P${i}.aFast`, meanW = '', kind: RecurrentKind = 'diffuse') => /* wgsl */ `
      if ((P${i}.flags & RP_NO_ANTILAG) == 0u && P${i}.lagCurSigma > 0.0 && nn >= 4.0) {
        let m3 = m1_${i} / nn;
        let se = sqrt(max(m2_${i} / nn - m3 * m3, vec2f(0.0)) / nn);
        let mu = ${meanW ? `mix(${mvec(kind, `pc${i}`)}, m3, ${meanW})` : 'm3'};${isOccKind(kind) ? `
        let rI = 0.0;` : `
        let lh = luma(${Hd}.rgb);
        let rI = abs(mu.x - lh) / (P${i}.lagCurSigma * se.x + 0.02 * max(lh, mu.x) + 1e-4);`}
        let rH = abs(mu.y - ${hOf(kind, Hd)}) / (P${i}.lagCurSigma * se.y + P${i}.lagCurHitTol);
        ${a} = mix(min(${a}, ${floor}), ${a}, clamp(2.0 - max(rI, rH), 0.0, 1.0));
      }`;

// R2 per-signal body, diffuse (SPEC §5.5).
const temporalDiffuse = (i: number, sl: number, kind: RecurrentKind = 'diffuse') => /* wgsl */ `
  {
    let pre = pc${i};
    var a = 0.0;
    if (hasHist) {
      a = min(Ahist[${sl}] + 1.0, P${i}.aCap);   // C-9: A = frames in the output - 1
      ${detector(i, 'a', `H${i}`, `P${i}.aFast`, '', kind)}
    }
    let acc = mix(H${i}, pre, 1.0 / (1.0 + a));     // RTG2 Eq. 49.1, rgb and ĥ
    textureStore(outAcc${i}, p, ${ST(kind, 'acc')});
    A[${sl}] = a;
    // C-10 fast history: luminance and ĥ of the pre-blurred input, short cap.
    let fw = 1.0 / (1.0 + min(a, P${i}.aFast));
    let fPrev = vec2f(Fh[${2 * sl}], Fh[${2 * sl + 1}]);
    let fNew = mix(fPrev, ${mvec(kind, 'pre')}, fw);
    fastOut[${2 * sl}] = fNew.x;
    fastOut[${2 * sl + 1}] = fNew.y;
  }`;

// R2 per-signal body, specular (SPEC §5.6, R-7..R-12): surface and virtual history
// candidates, virtual confidence and clamp, blended in alpha space by the amount of
// virtual motion m = F_dom(alpha).
const temporalSpecular = (i: number, sl: number, kind: RecurrentKind = 'specular') => /* wgsl */ `
  {
    let pre = pc${i};
    var a = 0.0;
    var acc = pre;
    var fPrev = vec2f(Fh[${2 * sl}], Fh[${2 * sl + 1}]);
    if (hasHist) {
      let aS = min(Ahist[${sl}] + 1.0, P${i}.aCap);   // A_s after the +1 of C-9 (D12d)
      let alpha = g.rough * g.rough;
      let fdom = domFactor(alpha);
      var Hv = H${i};
      var cv = 0.0;
      var m = 0.0;
      if ((P${i}.flags & RP_NO_VIRTUAL) == 0u) {
        // R-9: this frame's fast hit distance (surface-reprojected fast history + this frame's ĥ)
        let hF = mix(fPrev.y, ${hOf(kind, "pre")}, 1.0 / (1.0 + min(aS, P${i}.aFast)));
        var hV = hDenorm${i}(hF, g.z);
        // D12c: curved reflector, mirror equation 1/d_o + 1/d_i = 2 kappa (thin lens, RTG1 ch. 32 §32.4.3):
        // the virtual image of a point at distance h lies at h / (1 + 2 kappa h) (convex: closer)
        let kappa = curvSum / max(curvN, 1.0) * P${i}.virtCurv;
        hV = hV / max(1.0 + 2.0 * kappa * hV, 0.05);
        let uvV = virtualPrevUV(r.world, hV, fdom);
        if (onScreen(uvV)) {
          let v = virt${i}(g, r.expPrev, uvV);
          if (v.vg > 0.0) {
            m = fdom;   // R-12: amount of virtual motion
            Hv = v.H;
            // virtual-reprojected fast luminance; fast ĥ stays surface-reprojected (it sizes R-9)
            fPrev.x = mix(fPrev.x, v.Fv[${2 * sl}], m);
            // R-10 confidence: footprint validity x normal x roughness x fast-ĥ agreement
            let nb = select(g.n, normalize(v.n), dot(v.n, v.n) > 1e-8);
            let angN = acos(clamp(dot(g.n, nb), -1.0, 1.0));
            let thL = thetaL(alpha, P${i}.lobeFraction);
            cv = v.vg * Wt(angN / (P${i}.virtAngle * thL + 0.0174533))
               * Wt(abs(v.r - g.rough) / (0.05 + 0.25 * g.rough))
               * Wt(abs(v.Fv[${2 * sl + 1}] - hF) / (P${i}.virtHitLo + P${i}.virtHitHi * g.rough));
            // R-11: clamp to this frame's 3x3 mean +- gamma sigma, the harder the lower the confidence
            ${isOccKind(kind) ? `let mu = m1_${i}.y / nn;
            let sd = sqrt(max(m2_${i}.y / nn - mu * mu, 0.0));` : `let mu = vec4f(c1_${i}, m1_${i}.y) / nn;
            let sd = sqrt(max(vec4f(c2_${i}, m2_${i}.y) / nn - mu * mu, vec4f(0.0)));`}
            // our variant: always clamped, window widening with confidence (mirror input is clean, so a tight clamp is free there)
            let gv = P${i}.virtGamma * (1.0 + P${i}.virtWiden * cv);
            Hv = mix(clamp(Hv, mu - gv * sd, mu + gv * sd), Hv, cv * step(P${i}.virtWiden, 0.0));
          }
        }
      }
      var aD = aS;
      let Hb = mix(H${i}, Hv, m);
      // low-roughness input is nearly noise-free: on a mismatch drop history further (our addition)
      // and compare against the pixel's own value rather than the 3x3 mean as roughness -> 0
      // (a clean mirror's 3x3 mean is a blur of its reflected edges; our addition)
      let fr = sqrt(clamp(alpha / 0.25, 0.0, 1.0));
      ${detector(i, 'aD', 'Hb', `P${i}.aFast * mix(1.0, fr, P${i}.detRough)`, `mix(1.0, fr, P${i}.specCentre)`, kind)}
      // R-8 surface cap (parallax), R-12 blend in alpha space
      let aSurf = min(aD, specCap${i}(g, r.world, r.expPrev));
      let alphaSurf = 1.0 / (1.0 + aSurf);
      let alphaVirt = mix(1.0 / (1.0 + min(aD, P${i}.aFast)), 1.0 / (1.0 + aD), cv);
      acc = mix(mix(H${i}, pre, alphaSurf), mix(Hv, pre, alphaVirt), m);
      a = 1.0 / mix(alphaSurf, alphaVirt, m) - 1.0;
      mVirt = m * cv;   // stabilization's virtual candidate is trusted as far as R-10 trusts it
    }
    textureStore(outAcc${i}, p, ${ST(kind, 'acc')});
    A[${sl}] = a;
    let fw = 1.0 / (1.0 + min(a, P${i}.aFast));
    let fNew = mix(fPrev, ${mvec(kind, 'pre')}, fw);
    fastOut[${2 * sl}] = fNew.x;
    fastOut[${2 * sl + 1}] = fNew.y;
  }`;


// SPEC C-6/C-7 for the recurrent filter (our cheaper variant of the shared core's
// reproject()): previous view-space positions from the linear unprojection with the
// previous projection, and the plane test against the plane {Xp, np} of this pixel
// (current normal only; SPEC averages it pairwise with each tap's normal), its
// distance linear in the tap pixel (as the kernels). Backfacing taps rejected.
const REPROJECT_R = /* wgsl */ `
fn viewPosPrevAt(uv: vec2f, d: f32) -> vec3f {
  let ndc = ndcOf(uv);
  if (isOrtho()) { return vec3f((ndc.x - RF.unp2.x) * RF.prevUnp.x, (ndc.y - RF.unp2.y) * RF.prevUnp.y, -d); }
  return vec3f(d * (ndc.x + RF.prevUnp.z) * RF.prevUnp.x, d * (ndc.y + RF.prevUnp.w) * RF.prevUnp.y, -d);
}
fn reprojectR(p: vec2i, g: Geo, tol: f32) -> Reproj {
  var r: Reproj;
  let uv = uvOf(p);
  let mv = textureLoad(motionTex, p, 0).xy;   // NDC delta, current - previous, +y up
  r.prevUV = uv - vec2f(mv.x, -mv.y) * 0.5;
  r.world = (F.viewInv * vec4f(viewPosAt(uv, g.z), 1.0)).xyz;
  var dPrev: f32;
  if (hasFlag(FRAME_HAS_MOTIONZ)) { dPrev = g.z - textureLoad(motionZTex, p, 0).r; }
  else { dPrev = -(F.prevView * vec4f(r.world, 1.0)).z; }
  r.expPrev = viewPosPrevAt(r.prevUV, dPrev);
  let pp = r.prevUV * F.dims - 0.5;
  r.base = vec2i(floor(pp));
  let f = pp - floor(pp);
  r.bil = vec4f((1.0 - f.x) * (1.0 - f.y), f.x * (1.0 - f.y), (1.0 - f.x) * f.y, f.x * f.y);
  let pl = makePlaneU(r.expPrev, (F.prevView * vec4f(g.n, 0.0)).xyz, RF.prevUnp);
  ${[0, 1, 2, 3].map((k) => `{
    let q0 = r.base + TAP_OFFS[${k}];
    let q = clampPix(q0);
    let gq = geoTap(geoPrev, q);
    r.valid[${k}] = select(0.0, 1.0, all(q0 == q) && gq.z > 0.0 && dot(g.n, gq.n) > 0.0 && planeDist(pl, q, gq.z) <= tol);
  }`).join('\n  ')}
  r.w = r.bil * r.valid;
  r.sumW = r.w.x + r.w.y + r.w.z + r.w.w;
  r.allValid = all(r.valid > vec4f(0.5));
  return r;
}
`;

// Occlusion histories are r32float, which core WebGPU cannot filter: the same Catmull-Rom
// (RTG2 §49.7) as sampleCatmullRom, from 16 textureLoads of one channel (our code).
const CATMULL_ROM_LOAD = /* wgsl */ `
fn catmullRomLoad1(tex: texture_2d<f32>, uv: vec2f) -> f32 {
  let pos = uv * F.dims - 0.5;
  let t1 = floor(pos);
  let f = pos - t1;
  let w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
  let w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
  let w2 = f * (0.5 + f * (2.0 - 1.5 * f));
  let w3 = f * f * (-0.5 + 0.5 * f);
  let b = vec2i(t1) - 1;
  ${[0, 1, 2, 3].map((y) => `let r${y} = ${[0, 1, 2, 3].map((x) => `textureLoad(tex, clampPix(b + vec2i(${x}, ${y})), 0).r * w${x}.x`).join(' + ')};`).join('\n  ')}
  return r0 * w0.y + r1 * w1.y + r2 * w2.y + r3 * w3.y;
}
`;

export function temporalPass(kinds: RecurrentKind[]): PassDef {
  const b = base(kinds);
  addReproj(b);
  b.add('smp', 'sampler', 's');
  b.add('fastPrev', 'texture_2d<f32>', 'f');
  b.add('dataPrev', 'texture_2d<u32>', 'i');
  b.add('outFast', 'texture_storage_2d<rgba16float, write>', 'rgba16float');
  b.add('outData', 'texture_storage_2d<r32uint, write>', 'r32uint');
  // occlusion kinds: `pre` is the raw hit distance (no pre-blur pass; normalized on load),
  // histories are r32float (unfilterable: Catmull-Rom from textureLoad)
  kinds.forEach((k, i) => {
    b.add(`pre${i}`, 'texture_2d<f32>', 'f');
    b.add(`histPrev${i}`, 'texture_2d<f32>', isOccKind(k) ? 'f' : 'F');
    b.add(`outAcc${i}`, `texture_storage_2d<${formatOf(k)}, write>`, formatOf(k));
  });
  const I = kinds.map((_, i) => i);
  const slot = (i: number) => slotOf(kinds[i]);
  const hasSpec = kinds.some(isSpecKind);
  const hasOcc = kinds.some(isOccKind);
  const nb: [number, number][] = [];
  for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) if (x || y) nb.push([x, y]);
  const specCap = (i: number, V = isOccKind(kinds[i]) ? `Virt${i}` : 'Virt') => /* wgsl */ `
// Specular surface-motion cap (SPEC R-7/R-8, our design): the reflection slides by
// about the parallax angle per frame; history stays sharp while the accumulated
// slide stays inside the lobe half-angle (applies to the surface candidate only).
fn specCap${i}(g: Geo, world: vec3f, expPrev: vec3f) -> f32 {
  let vCur = normalize(world - F.camPos);
  let prevWorld = (F.prevViewInv * vec4f(expPrev, 1.0)).xyz;
  let vPrev = normalize(prevWorld - F.prevCamPos);
  let c = clamp(dot(vCur, vPrev), -1.0, 1.0);
  let parallax = sqrt(max(0.0, 1.0 - c * c)) / max(c, 1e-4);
  let NoV = max(dot(g.n, -vCur), 1e-4);
  let aSpec = P${i}.specScale * thetaL(g.rough * g.rough, P${i}.lobeFraction) * sqrt(NoV) / max(parallax, 1e-4);
  return min(aSpec, P${i}.aCap);
}
// R-10 virtual history: custom-weighted bilinear at the virtual uv, tap validity
// against the current surface plane {Xp, np} (a flat reflector's previous texels
// lie on it); bilinear only (Catmull-Rom here: +0.04 dB for 0.13 ms). Also returns
// the valid-weighted previous normal, roughness and fast history there.
struct ${V} { H: ${VT(kinds[i])}, Fv: vec4f, n: vec3f, r: f32, vg: f32 }
fn virt${i}(g: Geo, expPrev: vec3f, uv: vec2f) -> ${V} {
  var o: ${V};
  let pp = uv * F.dims - 0.5;
  let base = vec2i(floor(pp));
  let f = pp - floor(pp);
  let bil = vec4f((1.0 - f.x) * (1.0 - f.y), f.x * (1.0 - f.y), (1.0 - f.x) * f.y, f.x * f.y);
  // plane {Xp, np} in previous view space; distance linear in the tap pixel (as the kernels)
  let pl = makePlaneU(expPrev, (F.prevView * vec4f(g.n, 0.0)).xyz, RF.prevUnp);
  var sw = 0.0;
  ${[0, 1, 2, 3].map((k) => `{
    let q0 = base + TAP_OFFS[${k}];
    let q = clampPix(q0);
    let gq = geoTap(geoPrev, q);
    let h = ${LD(kinds[i], `histPrev${i}`, 'q')};
    let fq = textureLoad(fastPrev, q, 0);
    let ok = all(q0 == q) && gq.z > 0.0 && dot(g.n, gq.n) > 0.0 && planeDist(pl, q, gq.z) <= P0.planeTol;
    let w = select(0.0, max(bil[${k}], 1e-3), ok);
    o.vg += select(0.0, bil[${k}], ok);
    o.H += h * w;
    o.Fv += fq * w;
    o.n += gq.n * w;
    o.r += gq.rough * w;
    sw += w;
  }`).join('\n  ')}
  if (sw > 0.0) { o.H /= sw; o.Fv /= sw; o.n /= sw; o.r /= sw; }
  return o;
}`;
  const code = /* wgsl */ `
${head(b, REPROJECT_WGSL)}
${REPROJECT_R}${hasOcc ? CATMULL_ROM_LOAD : ''}
${kinds.map((k, i) => (isSpecKind(k) || isOccKind(k) ? signalWgsl(k, i) + (isSpecKind(k) ? specCap(i) : '') : '')).join('\n')}
${tileWgsl([
  { name: 'z', type: 'f32', load: (q) => `bitcast<f32>(textureLoad(geoCur, ${q}, 0).x)` },
  ...(hasSpec ? [{ name: 'nv', type: 'vec3f', load: (q: string) => `viewNormal(geoTap(geoCur, ${q}).n)` }] : []),
  // occlusion: F-3 normalization of the raw hit distance on load (tile_z[k] is this texel's depth)
  ...I.map((i) => ({ name: `pre${i}`, type: VT(kinds[i]), load: (q: string) => (isOccKind(kinds[i])
    ? `hNorm${i}(textureLoad(pre${i}, ${q}, 0).r, tile_z[k])` : `textureLoad(pre${i}, ${q}, 0)`) })),
])}

@compute @workgroup_size(8, 8)
fn main(${TILE_MAIN}) {
  loadTile(lid, wid);
  let p = vec2i(gid.xy);
  if (!inside(p)) { return; }
  let g = geoTap(geoCur, p);
  if (g.z <= 0.0) {
    ${I.map((i) => `textureStore(outAcc${i}, p, vec4f(0.0));`).join(' ')}
    textureStore(outFast, p, vec4f(0.0));
    textureStore(outData, p, vec4u(0u));
    return;
  }
  var hasHist = false;
  var r: Reproj;
  if (!hasFlag(FRAME_RESET)) {
    r = reprojectR(p, g, P0.planeTol);   // C-7: plane distance + backface only (no SVGF normal test)
    hasHist = r.sumW > 0.0 || any(r.valid > vec4f(0.5));
  }
  // C-8: custom-weighted bilinear; valid taps with tiny bilinear weight still count.
  var Ahist = vec2f(0.0);
  var Fh = vec4f(0.0);
  ${I.map((i) => `var H${i} = ${ZERO(kinds[i])};\n  var lo${i} = ${BIG(kinds[i], '1e30')};\n  var hi${i} = ${BIG(kinds[i], '-1e30')};`).join('\n  ')}
  if (hasHist) {
    let wts = max(r.bil, vec4f(1e-3)) * r.valid;
    let sw = wts.x + wts.y + wts.z + wts.w;
    // branchless (all loads in flight; LESSONS): invalid taps get weight 0, clamped coordinates
    ${[0, 1, 2, 3].map((k) => `{
      let wk = wts[${k}];
      let ok = wk > 0.0;
      let q = clampPix(r.base + TAP_OFFS[${k}]);
      let dv = textureLoad(dataPrev, q, 0).r;
      Ahist += vec2f(unpackA(dv, 0u), unpackA(dv, 1u)) * wk;
      Fh += textureLoad(fastPrev, q, 0) * wk;
      ${I.map((i) => `{
        let h = ${LD(kinds[i], `histPrev${i}`, 'q')};
        H${i} += h * wk;
        lo${i} = select(lo${i}, min(lo${i}, h), ok);
        hi${i} = select(hi${i}, max(hi${i}, h), ok);
      }`).join('\n      ')}
    }`).join('\n    ')}
    Ahist /= sw;
    Fh /= sw;
    ${I.map((i) => `H${i} /= sw;`).join(' ')}
    if (r.allValid) {   // RTG2 §49.7: Catmull-Rom when the footprint is valid, clamped (no ringing)
      ${I.map((i) => `H${i} = clamp(${isOccKind(kinds[i]) ? `catmullRomLoad1(histPrev${i}, r.prevUV)` : `sampleCatmullRom(histPrev${i}, smp, r.prevUV)`}, lo${i}, hi${i});`).join('\n      ')}
    }
  }
  var A = vec2f(0.0);
  var fastOut = vec4f(0.0);
  var mVirt = 0.0;   // amount of virtual motion (specular), for stabilization
  // Current-frame anti-lag detector (our addition to C-10, measured: the fast
  // history alone reacts at its own EMA speed): 3x3 mean of this frame's
  // pre-blurred luminance and ĥ vs the reprojected history, in units of the
  // mean's standard error. Geometry-valid neighbours only.
  let X = viewPosAt(uvOf(p), g.z);
  let nv = viewNormal(g.n);
  let pl = makePlane(X, nv);
  ${I.map((i) => `let pc${i} = tile_pre${i}[tidx(lid, 0, 0)];
  var m1_${i} = ${mvec(kinds[i], `pc${i}`)};
  var m2_${i} = m1_${i} * m1_${i};${kinds[i] === 'specular' ? `
  var c1_${i} = pc${i}.rgb;
  var c2_${i} = pc${i}.rgb * pc${i}.rgb;` : ''}`).join('\n  ')}
  var nn = 1.0;
  var curvSum = 0.0;
  var curvN = 0.0;
  if (hasHist) {
    ${nb.map(([x, y]) => /* wgsl */ `
    {
      let qq = p + vec2i(${x}, ${y});
      let q = clampPix(qq);
      let ti = tidx(lid, ${x}, ${y});
      let zq = tile_z[ti];
      let ok = select(0.0, 1.0, inside(qq) && zq > 0.0 && planeDist(pl, q, zq) < P0.geoTolLo);
      nn += ok;
      ${I.map((i) => `{ let s = tile_pre${i}[ti]; let v = ${mvec(kinds[i], 's')} * ok; m1_${i} += v; m2_${i} += v * v;${kinds[i] === 'specular' ? ` let sc = s.rgb * ok; c1_${i} += sc; c2_${i} += sc * sc;` : ''} }`).join('\n      ')}${hasSpec && (x === 0 || y === 0) ? `
      { // curvature along this axis neighbour: dot(n_q - n, dX) / |dX|^2 (positive = convex)
        let dX = viewPosAt(uvOf(q), zq) - X;
        curvSum += dot(tile_nv[ti] - nv, dX) / max(dot(dX, dX), 1e-12) * ok;
        curvN += ok;
      }` : ''}
    }`).join('')}
  }
  ${I.map((i) => (isSpecKind(kinds[i]) ? temporalSpecular(i, slot(i), kinds[i]) : temporalDiffuse(i, slot(i), kinds[i]))).join('')}
  textureStore(outFast, p, fastOut);
  var mask = 0u;
  if (hasHist) { mask = select(0u, 1u, r.valid.x > 0.5) | select(0u, 2u, r.valid.y > 0.5) | select(0u, 4u, r.valid.z > 0.5) | select(0u, 8u, r.valid.w > 0.5); }
  textureStore(outData, p, vec4u(packData(A.x, A.y, mVirt, mask), 0u, 0u, 0u));
}
`;
  return { code, entries: b.entries };
}

// ---- R3 mips (SPEC §5.7, R-13 atlas) ----------------------------------------------

const ATLAS = /* wgsl */ `
// R-13: level 1 at (0, 0), level 2 at (ceil(W/2), 0), level 3 at (ceil(W/2), ceil(H/4)).
fn atlasCoord(L: i32, t: vec2i) -> vec2i {
  let d = vec2i(F.dims);
  let w1 = (d.x + 1) / 2;
  let h2 = (d.y + 3) / 4;
  if (L == 1) { return t; }
  if (L == 2) { return vec2i(w1 + t.x, t.y); }
  return vec2i(w1 + t.x, h2 + t.y);
}
fn levelDims(L: i32) -> vec2i { return (vec2i(F.dims) + (1 << u32(L)) - 1) >> vec2u(u32(L)); }
`;

export function mipsPass(kinds: RecurrentKind[]): PassDef {
  const b = new Bindings();
  b.uniform('F', 'Frame');
  b.add('geoCur', 'texture_2d<u32>', 'i');
  b.add('outMipZ', 'texture_storage_2d<r32float, write>', 'r32float');
  kinds.forEach((k, i) => {
    b.add(`acc${i}`, 'texture_2d<f32>', 'f');
    b.add(`outMip${i}`, `texture_storage_2d<${formatOf(k)}, write>`, formatOf(k));
  });
  const I = kinds.map((_, i) => i);
  const level = (L: number) => {
    const n = 16 >> L, s = 1 << (L - 1);
    return /* wgsl */ `
  if (lid.x < ${n}u && lid.y < ${n}u) {
    let idx = (lid.y << ${L}u) * 16u + (lid.x << ${L}u);
    let zz = sz[idx] + sz[idx + ${s}u] + sz[idx + ${16 * s}u] + sz[idx + ${17 * s}u];
    sz[idx] = zz;
    ${I.map((i) => `let c${i} = sc${i}[idx] + sc${i}[idx + ${s}u] + sc${i}[idx + ${16 * s}u] + sc${i}[idx + ${17 * s}u];
    sc${i}[idx] = c${i};`).join('\n    ')}
    let t = vec2i(wid.xy) * ${n} + vec2i(lid.xy);
    if (all(t < levelDims(${L}))) {
      let a = atlasCoord(${L}, t);
      let inv = select(0.0, 1.0 / zz.y, zz.y > 0.0);
      textureStore(outMipZ, a, vec4f(zz.x * inv));
      ${I.map((i) => `textureStore(outMip${i}, a, ${ST(kinds[i], `c${i} * inv`)});`).join('\n      ')}
    }
  }
  workgroupBarrier();`;
  };
  const code = /* wgsl */ `
${FRAME_WGSL}
${b.wgsl}
${ATLAS}
var<workgroup> sz: array<vec2f, 256>;   // (sum depth, count of non-sky pixels)
${I.map((i) => `var<workgroup> sc${i}: array<${VT(kinds[i])}, 256>;`).join('\n')}

// One dispatch, 16x16 workgroups, shared-memory reduction 16 -> 8 -> 4 -> 2
// (RTG2 §49.5.3), averaging non-sky pixels only.
@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) gid: vec3u, @builtin(local_invocation_id) lid: vec3u,
        @builtin(workgroup_id) wid: vec3u) {
  let p = vec2i(gid.xy);
  let li = lid.y * 16u + lid.x;
  var w = 0.0;
  var z = 0.0;
  if (inside(p)) {
    let gz = bitcast<f32>(textureLoad(geoCur, p, 0).x);
    if (gz > 0.0) { w = 1.0; z = gz; }
  }
  sz[li] = vec2f(z, w);
  ${I.map((i) => `sc${i}[li] = select(${ZERO(kinds[i])}, ${LD(kinds[i], `acc${i}`, 'p')}, w > 0.0);`).join('\n  ')}
  workgroupBarrier();
  ${[1, 2, 3].map(level).join('\n')}
}
`;
  return { code, entries: b.entries };
}

// ---- R4 history fix (SPEC §5.8: mip repair D7, anti-firefly D9, anti-lag C-10/D11) --

// R4 per-signal body, occlusion kinds (ĥ only): (a) mip repair as radiance, no
// anti-firefly, (c) the fast-history window on ĥ itself (O-2: ĥ detector only); the slow
// ĥ is clamped into it when occClamp > 0 (our design, as the radiance luminance clamp).
const histFixOcc = (i: number, kind: RecurrentKind, sl: number) => /* wgsl */ `
  {
    var c = textureLoad(acc${i}, p, 0).r;
    var a = A[${sl}];
    if ((P${i}.flags & RP_NO_HISTORY_FIX) == 0u && a < P${i}.aFix) {
      let m = mipRepair${i}(p, g.z, a, ${isSpecKind(kind) ? 'g.rough' : '1.0'});
      if (m >= 0.0) { c = m; }
    }
    if ((P${i}.flags & RP_NO_ANTILAG) == 0u && a > P${i}.aFast) {
      ${isSpecKind(kind) ? `let cw = mix(1.0, sqrt(clamp(g.rough * g.rough / 0.25, 0.0, 1.0)), P${i}.specCentre);
      let muH = mix(fc[${2 * sl + 1}], fMean[${2 * sl + 1}], cw);` : `let muH = fMean[${2 * sl + 1}];`}
      let sdH = fStd[${2 * sl + 1}];
      let Lc = clamp(c, muH - P${i}.lagGamma * sdH, muH + P${i}.lagGamma * sdH);
      let e = abs(c - Lc) / (max(c, Lc) + 1e-3);
      let cI = clamp(1.0 - e / P${i}.lagEMax, 0.0, 1.0);
      let cH = clamp(1.0 - abs(c - Lc) / P${i}.lagHitTol, 0.0, 1.0);
      c = mix(c, Lc, P${i}.occClamp);
      a = mix(min(a, P${i}.aFast), a, min(cI, cH));
    }
    A[${sl}] = a;
    textureStore(outFix${i}, p, vec4f(c));
  }`;

export function historyFixPass(kinds: RecurrentKind[]): PassDef {
  const b = base(kinds);
  b.add('fastCur', 'texture_2d<f32>', 'f');
  b.add('mipZ', 'texture_2d<f32>', 'f');
  b.add('dataRW', 'texture_storage_2d<r32uint, read_write>', 'rw-r32uint');
  kinds.forEach((k, i) => {
    b.add(`acc${i}`, 'texture_2d<f32>', 'f');
    b.add(`mip${i}`, 'texture_2d<f32>', 'f');
    b.add(`outFix${i}`, `texture_storage_2d<${formatOf(k)}, write>`, formatOf(k));
  });
  const I = kinds.map((_, i) => i);
  const slot = (i: number) => slotOf(kinds[i]);
  const nb: [number, number][] = [];
  for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) if (x || y) nb.push([x, y]);
  const code = /* wgsl */ `
${head(b, ATLAS)}

// D7 mip repair: start level L = floor(3 (1 - A/A_fix) rho + 0.5) (GTC20 s.35),
// 3x3 tent at level L with viewZ-only weights (RTG2 p.829), finer level if the
// normalized weight sum is below the threshold. Returns (value, 1) or (_, 0).
${I.map((i) => /* wgsl */ `
fn mipRepair${i}(p: vec2i, d: f32, A: f32, rho: f32) -> ${VT(kinds[i])} {
  var L = i32(floor(3.0 * clamp(1.0 - A / P${i}.aFix, 0.0, 1.0) * rho + 0.5));
  loop {
    if (L < 1) { break; }
    let scale = f32(1 << u32(L));
    let f = (vec2f(p) + 0.5) / scale - 0.5;
    let c = vec2i(round(f));
    let dims = levelDims(L);
    let tol = 1.0 / (P${i}.fixTol * scale * d);
    var sumB = 0.0;
    var sumW = 0.0;
    var sumC = ${ZERO(kinds[i])};
    // unrolled, branchless 3x3 (all loads in flight together)
    ${[...Array(9).keys()].map((k) => `{
      let t = c + vec2i(${(k % 3) - 1}, ${Math.floor(k / 3) - 1});
      let dt = abs(f - vec2f(t));
      let wb = max(0.0, 1.0 - dt.x / 1.5) * max(0.0, 1.0 - dt.y / 1.5);
      let a = atlasCoord(L, clamp(t, vec2i(0), dims - 1));
      let dm = textureLoad(mipZ, a, 0).r;
      let v = ${LD(kinds[i], `mip${i}`, 'a')};
      let w = select(0.0, wb * Wt(abs(dm - d) * tol), all(t >= vec2i(0)) && all(t < dims) && dm > 0.0);
      sumB += wb;
      sumW += w;
      sumC += v * w;
    }`).join('\n    ')}
    if (sumW >= P${i}.fixMinWeight * sumB && sumW > 0.0) { return ${isOccKind(kinds[i]) ? 'sumC / sumW' : 'vec4f(sumC / sumW)'}; }
    L -= 1;
  }
  return ${BIG(kinds[i], '-1.0')};
}`).join('\n')}

${tileWgsl([
  { name: 'z', type: 'f32', load: (q) => `bitcast<f32>(textureLoad(geoCur, ${q}, 0).x)` },
  { name: 'f', type: 'vec4f', load: (q) => `textureLoad(fastCur, ${q}, 0)` },
  // anti-firefly luminance (radiance kinds only; ĥ in [0, 1] has no fireflies)
  ...I.filter((i) => !isOccKind(kinds[i])).map((i) => ({ name: `l${i}`, type: 'f32', load: (q: string) => `luma(textureLoad(acc${i}, ${q}, 0).rgb)` })),
])}

@compute @workgroup_size(8, 8)
fn main(${TILE_MAIN}) {
  loadTile(lid, wid);
  let p = vec2i(gid.xy);
  if (!inside(p)) { return; }
  let g = geoTap(geoCur, p);
  if (g.z <= 0.0) {
    ${I.map((i) => `textureStore(outFix${i}, p, vec4f(0.0));`).join(' ')}
    return;
  }
  let X = viewPosAt(uvOf(p), g.z);
  let nv = viewNormal(g.n);
  let pl = makePlane(X, nv);
  let dv = textureLoad(dataRW, p).r;
  var A = vec2f(unpackA(dv, 0u), unpackA(dv, 1u));
  // 3x3 neighbourhood, geometry-valid at the A = 0 plane tolerance:
  // top-2 luminance of acc (anti-firefly) and fast-history moments (anti-lag).
  let fc = tile_f[tidx(lid, 0, 0)];
  var fSum = fc;
  var fSq = fc * fc;
  var nValid = 1.0;
  ${I.filter((i) => !isOccKind(kinds[i])).map((i) => `var l1_${i} = 0.0;\n  var l2_${i} = 0.0;`).join('\n  ')}
  ${nb.map(([x, y]) => /* wgsl */ `
  {
    let qq = p + vec2i(${x}, ${y});
    let q = clampPix(qq);
    let ti = tidx(lid, ${x}, ${y});
    let zq = tile_z[ti];
    let ok = select(0.0, 1.0, inside(qq) && zq > 0.0 && planeDist(pl, q, zq) < P0.geoTolLo);
    let f = tile_f[ti] * ok;
    fSum += f;
    fSq += f * f;
    nValid += ok;
    ${I.filter((i) => !isOccKind(kinds[i])).map((i) => `{
      let l = tile_l${i}[ti] * ok;
      l2_${i} = max(l2_${i}, min(l1_${i}, l));
      l1_${i} = max(l1_${i}, l);
    }`).join('\n    ')}
  }`).join('')}
  let fMean = fSum / nValid;
  // window from the spread of the fast history; optionally its standard error (our variant)
  let fStd = sqrt(max(fSq / nValid - fMean * fMean, vec4f(0.0))) / mix(1.0, sqrt(nValid), P0.lagStdErr);
  ${I.map((i) => (isOccKind(kinds[i]) ? histFixOcc(i, kinds[i], slot(i)) : /* wgsl */ `
  {
    var c = textureLoad(acc${i}, p, 0);
    var a = A[${slot(i)}];
    // (a) mip repair where history is young (replaces rgb and ĥ)
    if ((P${i}.flags & RP_NO_HISTORY_FIX) == 0u && a < P${i}.aFix) {
      let m = mipRepair${i}(p, g.z, a, ${kinds[i] === 'specular' ? 'g.rough' : '1.0'});
      if (m.a >= 0.0) { c = m; }
    }
    // (b) anti-firefly: centre luminance <= k * second-largest of >= 4 valid neighbours
    if ((P${i}.flags & RP_NO_FIREFLY) == 0u && nValid >= 5.0${kinds[i] === 'specular' ? ' && g.rough >= 0.25' : ''}) {
      let l = luma(c.rgb);
      let lim = P${i}.fireflyK * l2_${i};
      if (l > lim) { c = vec4f(c.rgb * (lim / l), c.a); }
    }
    // (c) C-10: clamp slow luminance to the fast history's mean +- gamma sigma; the
    // relative excess and the ĥ excess (min-combined) shorten the history.
    if ((P${i}.flags & RP_NO_ANTILAG) == 0u && a > P${i}.aFast) {
      ${kinds[i] === 'specular' ? `// window centred on the pixel's own fast value as roughness -> 0 (clean mirror input:
      // the 3x3 mean would blur reflected edges; our addition)
      let cw = mix(1.0, sqrt(clamp(g.rough * g.rough / 0.25, 0.0, 1.0)), P${i}.specCentre);
      let mu = mix(fc[${2 * slot(i)}], fMean[${2 * slot(i)}], cw);
      let muH = mix(fc[${2 * slot(i) + 1}], fMean[${2 * slot(i) + 1}], cw);` : `let mu = fMean[${2 * slot(i)}];
      let muH = fMean[${2 * slot(i) + 1}];`}
      let sd = fStd[${2 * slot(i)}];
      let Ls = luma(c.rgb);
      let Lc = clamp(Ls, mu - P${i}.lagGamma * sd, mu + P${i}.lagGamma * sd);
      if (Ls > 1e-6) { c = vec4f(c.rgb * (Lc / Ls), c.a); } else { c = vec4f(vec3f(Lc), c.a); }
      let e = abs(Ls - Lc) / (max(Ls, Lc) + 1e-3);
      let cI = clamp(1.0 - e / P${i}.lagEMax, 0.0, 1.0);
      let sdH = fStd[${2 * slot(i) + 1}];
      let eh = abs(c.a - clamp(c.a, muH - P${i}.lagGamma * sdH, muH + P${i}.lagGamma * sdH));
      let cH = clamp(1.0 - eh / P${i}.lagHitTol, 0.0, 1.0);
      a = mix(min(a, P${i}.aFast), a, min(cI, cH));
    }
    A[${slot(i)}] = a;
    textureStore(outFix${i}, p, c);
  }`)).join('')}
  textureStore(dataRW, p, vec4u(packData(A.x, A.y, unpackM(dv), dv >> 28u), 0u, 0u, 0u));
}
`;
  return { code, entries: b.entries };
}

// ---- R5 blur / R6 post-blur (SPEC §5.10, R-5, R-6) --------------------------------

export function blurPass(kinds: RecurrentKind[], post: boolean, taps: number[] = kinds.map(() => 8)): PassDef {
  const b = base(kinds);
  b.add('dataTex', 'texture_2d<u32>', 'i');
  kinds.forEach((k, i) => {
    b.add(`src${i}`, 'texture_2d<f32>', 'f');
    if (post) b.add(`acc${i}`, 'texture_2d<f32>', 'f');
    b.add(`outBlur${i}`, `texture_storage_2d<${formatOf(k)}, write>`, formatOf(k));
  });
  const I = kinds.map((_, i) => i);
  const code = /* wgsl */ `
${head(b)}
${kinds.map((k, i) => signalWgsl(k, i)).join('\n')}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let p = vec2i(gid.xy);
  if (!inside(p)) { return; }
  let g = geoTap(geoCur, p);
  if (g.z <= 0.0) {
    ${I.map((i) => `textureStore(outBlur${i}, p, vec4f(0.0));`).join(' ')}
    return;
  }
  let X = viewPosAt(uvOf(p), g.z);
  let nv = viewNormal(g.n);
  let ps = pixSize(g.z);
  let dv = textureLoad(dataTex, p, 0).r;
  ${post ? '' : 'let rot = blurRotation(p);'}
  ${I.map((i) => /* wgsl */ `
  {
    let A = unpackA(dv, ${slotOf(kinds[i])}u);
    let An = clamp(A / P${i}.aCap, 0.0, 1.0);
    let c = ${LD(kinds[i], `src${i}`, 'p')};
    // R-5: R = max(min(R_max f_A f_r pixSize, c_h h~), R_min pixSize), f_A = 1/(1 + A)
    var R = max(min(P${i}.maxRadius * radiusRough${i}(g) / (1.0 + A) * ps, hitClamp${i}(g) * hDenorm${i}(${hOf(kinds[i], 'c')}, g.z)),
                P${i}.minRadius * ${isSpecKind(kinds[i]) ? `mix(1.0, radiusRough${i}(g), P${i}.specMinRadius)` : '1.0'} * ps);
    ${post ? `// D2c: post-blur radius grows where the blur still changed the signal (RTG2 §49.5.6)
    ${isOccKind(kinds[i]) ? `let la = textureLoad(acc${i}, p, 0).r;   // occlusion: how much the blur changed ĥ
    let lb = c;` : `let la = luma(textureLoad(acc${i}, p, 0).rgb);
    let lb = luma(c.rgb);`}
    R *= mix(P${i}.postLo, P${i}.postHi, clamp(abs(lb - la) / (max(lb, la) + 1e-3) / P${i}.postDelta, 0.0, 1.0));` : ''}
    let k${i} = kern${i}(g, X, nv, R, An, ${hOf(kinds[i], 'c')});
    var sum${i} = c;
    var sw${i} = 1.0;
    ${tapSet(taps[i]).map((t) => tapWgsl(kinds[i], i, t, {
      rotate: !post, hitWeight: true, rgbOnly: false, load: (q) => LD(kinds[i], `src${i}`, q),
    })).join('')}
    textureStore(outBlur${i}, p, ${ST(kinds[i], `sum${i} / sw${i}`)});
  }`).join('')}
}
`;
  return { code, entries: b.entries };
}

// ---- R7 temporal stabilization (SPEC §5.11, D10) ------------------------------------

export function stabilizePass(kinds: RecurrentKind[], remodulate: boolean): PassDef {
  const b = base(kinds);
  b.add('motionTex', 'texture_2d<f32>', 'f');
  b.add('smp', 'sampler', 's');
  b.add('dataTex', 'texture_2d<u32>', 'i');
  kinds.forEach((k, i) => {
    b.add(`hCur${i}`, 'texture_2d<f32>', 'f');
    b.add(`sPrev${i}`, 'texture_2d<f32>', isOccKind(k) ? 'f' : 'F');
    b.add(`outS${i}`, `texture_storage_2d<${formatOf(k)}, write>`, formatOf(k));
    if (remodulate) {
      b.add(`demod${i}`, 'texture_2d<f32>', 'f');
      b.add(`outRemod${i}`, 'texture_storage_2d<rgba16float, write>', 'rgba16float');
    }
  });
  const I = kinds.map((_, i) => i);
  const nb: [number, number][] = [];
  for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) if (x || y) nb.push([x, y]);
  const store = (i: number, v: string, raw = false) => `textureStore(outS${i}, p, ${raw ? v : ST(kinds[i], v)});${remodulate ? `
    textureStore(outRemod${i}, p, vec4f(${v}.rgb * select(vec3f(1.0), textureLoad(demod${i}, p, 0).rgb, (P${i}.flags & RP_REMODULATE) != 0u), ${v}.a));` : ''}`;
  const code = /* wgsl */ `
${head(b, HISTORY_SAMPLE_WGSL)}

${tileWgsl([
  { name: 'z', type: 'f32', load: (q) => `bitcast<f32>(textureLoad(geoCur, ${q}, 0).x)` },
  ...I.map((i) => ({ name: `h${i}`, type: VT(kinds[i]), load: (q: string) => LD(kinds[i], `hCur${i}`, q) })),
])}

@compute @workgroup_size(8, 8)
fn main(${TILE_MAIN}) {
  loadTile(lid, wid);
  let p = vec2i(gid.xy);
  if (!inside(p)) { return; }
  let g = geoTap(geoCur, p);
  if (g.z <= 0.0) {
    ${I.map((i) => store(i, 'vec4f(0.0)', true)).join('\n    ')}
    return;
  }
  let X = viewPosAt(uvOf(p), g.z);
  let nv = viewNormal(g.n);
  let pl = makePlane(X, nv);
  let dv = textureLoad(dataTex, p, 0).r;
  ${I.map((i) => `let h${i} = tile_h${i}[tidx(lid, 0, 0)];\n  var m1_${i} = h${i};\n  var m2_${i} = h${i} * h${i};`).join('\n  ')}
  var n = 1.0;
  ${nb.map(([x, y]) => /* wgsl */ `
  {
    let qq = p + vec2i(${x}, ${y});
    let q = clampPix(qq);
    let ti = tidx(lid, ${x}, ${y});
    let zq = tile_z[ti];
    let ok = select(0.0, 1.0, inside(qq) && zq > 0.0 && planeDist(pl, q, zq) < P0.geoTolLo);
    n += ok;
    ${I.map((i) => `{ let s = tile_h${i}[ti] * ok; m1_${i} += s; m2_${i} += s * s; }`).join('\n    ')}
  }`).join('')}
  // The temporal pass's 2x2 validity (same reprojection, stored in data): no second
  // set of plane tests here.
  let mask = dv >> 28u;
  let hasHist = !hasFlag(FRAME_RESET) && mask != 0u;
  let mv = textureLoad(motionTex, p, 0).xy;
  let prevUV = uvOf(p) - vec2f(mv.x, -mv.y) * 0.5;
  let pp = prevUV * F.dims - 0.5;
  let base = vec2i(floor(pp));
  let fr = pp - floor(pp);
  let bil = vec4f((1.0 - fr.x) * (1.0 - fr.y), fr.x * (1.0 - fr.y), (1.0 - fr.x) * fr.y, fr.x * fr.y);
  let valid = vec4f(f32(mask & 1u), f32((mask >> 1u) & 1u), f32((mask >> 2u) & 1u), f32((mask >> 3u) & 1u));
  ${I.map((i) => /* wgsl */ `
  {
    var s = h${i};
    if (hasHist && (P${i}.flags & RP_NO_STABILIZE) == 0u) {
      let wts = max(bil, vec4f(1e-3)) * valid;
      var sp = ${ZERO(kinds[i])};
      var lo = ${BIG(kinds[i], '1e30')};
      var hi = ${BIG(kinds[i], '-1e30')};
      ${[0, 1, 2, 3].map((k) => `{
        let v = ${LD(kinds[i], `sPrev${i}`, `clampPix(base + TAP_OFFS[${k}])`)};
        let ok = wts[${k}] > 0.0;
        sp += v * wts[${k}];
        lo = select(lo, min(lo, v), ok);
        hi = select(hi, max(hi, v), ok);
      }`).join('\n      ')}
      sp /= wts.x + wts.y + wts.z + wts.w;
      ${kinds[i] === 'specular' ? 'if (mask == 15u) { sp = clamp(sampleCatmullRom(sPrev' + i + ', smp, prevUV), lo, hi); }' : (isOccKind(kinds[i]) ? '// occlusion: bilinear' : '// diffuse: bilinear (Catmull-Rom here: identical PSNR on the test bed, +0.07 ms)')}
      let A = unpackA(dv, ${slotOf(kinds[i])}u);
      let An = clamp(A / P${i}.aCap, 0.0, 1.0);
      let mu = m1_${i} / n;
      let sd = sqrt(max(m2_${i} / n - mu * mu, ${ZERO(kinds[i])}));
      // window gamma_s sigma + beta_s mu, wider once the pixel has a long, trusted history
      let wnd = mix(P${i}.stabGammaLo, P${i}.stabGammaHi, An) * sd + P${i}.stabBeta * An * abs(mu);
      let spc = clamp(sp, mu - wnd, mu + wnd);
      let a = max(1.0 / (1.0 + A), 1.0 / (1.0 + P${i}.stabFrames));
      s = mix(spc, h${i}, a);
    }
    ${store(i, 's')}
  }`).join('')}
}
`;
  return { code, entries: b.entries };
}

// ---- skeleton: same bindings, centre loads + stores only (SPEC §10.3 timing) ---------

/** A trivial kernel with exactly `def`'s bindings: loads each input at p, writes every output. */
export function trivialPass(def: PassDef, workgroup = 8): PassDef {
  const decls = def.code.split('\n').filter((l) => l.startsWith('@group(0)')).join('\n');
  const body: string[] = [];
  const stores: string[] = [];
  for (const e of def.entries) {
    if (e.kind === 'f' || e.kind === 'F') body.push(`v += textureLoad(${e.name}, p, 0);`);
    else if (e.kind === 'i') body.push(`v += vec4f(textureLoad(${e.name}, p, 0));`);
    else if (e.kind === 'rw-r32uint') stores.push(`textureStore(${e.name}, p, textureLoad(${e.name}, p) + vec4u(u32(v.x)));`);
    else if (e.kind === 'r32uint') stores.push(`textureStore(${e.name}, p, vec4u(u32(v.x)));`);
    else if (e.kind !== 'u' && e.kind !== 's' && e.kind !== 'd') stores.push(`textureStore(${e.name}, p, v);`);
  }
  const code = /* wgsl */ `
${FRAME_WGSL}
${RSTRUCTS}
${decls}
@compute @workgroup_size(${workgroup}, ${workgroup})
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let p = vec2i(gid.xy);
  if (f32(p.x) >= F.dims.x || f32(p.y) >= F.dims.y) { return; }
  var v = vec4f(0.0);
  ${body.join('\n  ')}
  ${stores.join('\n  ')}
}
`;
  return { code, entries: def.entries };
}
