// Shadow denoiser passes (SPEC v0 §7, M4; provisional until SPEC review). Clean room:
// written from the papers below; no NRD code, README or port was read.
//
//   temporal  (8x8 tiles) pack geometry, reproject + accumulate RAW visibility, clamp the
//             history to the 5x5 neighbourhood of raw visibility, accumulate the penumbra
//             scale, per-tile stats (nearest occluder, penumbra present)
//   tiles     (one thread per tile) 3x3 tile neighbourhood: nearest-occluder scale for
//             pixels without their own, and the list of tiles that need filtering
//   spatial   (x2, indirect over the tile list) 8-tap rotated disk on the receiver's
//             tangent plane, radius from the penumbra width; output never re-enters history
//
// Sources (public; rows in docs/research/rt-denoiser/PROVENANCE.md "Shadows (M4)"):
// - Penumbra width from occluder distance and light size: Mehta, Wang, Ramamoorthi 2012,
//   "Axis-Aligned Filtering for Interactive Sampled Soft Shadows", ACM TOG 31(6) 163,
//   Eq. 4/13 (filter width sigma*(d1/d2 - 1) with d2 the occluder closest to the receiver,
//   floored near one pixel footprint: M12's floor is 1/(k*mu*Omega_x^max); ours is a plain
//   `minRadius` = 1 px, our value). Rewritten for a hit distance h and receiver-light distance D:
//   d1/d2 - 1 = h/(D - h), so W = R*h/(D - h) for a sphere light of radius R and
//   W = h*tan(theta) for a directional light (our algebra).
// - Filter distances measured in the plane parallel to the light (M12 Eq. 11-12): on a
//   receiver lit at an angle this stretches the kernel along the projected light direction
//   by 1/(n.l) (our reading of Eq. 12; option `anisotropy`).
// - Unoccluded pixels take the occluder estimate of their neighbourhood (M12 Sec. 6 uses
//   d1, d2 averaged over a 5-px radius for unoccluded pixels); we take the minimum scale over
//   the 3x3 tiles around the pixel ("nearest occluder wins", M12's d2_max), our design.
// - Penumbra mask / tile skip: Gruen, Story, Roza, "'Shadows' of the Tomb Raider: Ray
//   Tracing Deep Dive", GTC 2019 s9984, slide 72; Heitz, Hill, McGuire 2018, "Combining
//   Analytic Direct Illumination and Stochastic Shadows", I3D, Sec. 4.1 (no work outside
//   penumbrae).
// - Temporal accumulation with a neighbourhood clamp against moving shadows (motion vectors
//   don't see them): Barre-Brisebois et al., "Hybrid Rendering for Real-Time Ray Tracing",
//   Ray Tracing Gems ch. 25, Sec. 25.2.1 p.443 (5x5 window, scalar visibility). History =
//   raw visibility only (no spatial output fed back): our design, against the FFX port's
//   measured blur drift (docs/specs/temporal.md).
// - Noise-driven radius when there is no hit distance / light: Heitz et al. 2018 Sec. 4.2,
//   Eq. 29 (total variation of the second derivative along 4 lines; here on the 5x5 shared
//   tile, no random offset), accumulated over time instead of the paper's 3x3 box; kernel
//   size proportional to E as in H18 Sec. 4.1. v2: with a hit distance too, the radius is the
//   mean of the occluder-sized and the E-sized radius (`noiseBlend` 0.5; E rides in the
//   geometry texture's roughness byte, accumulated like g): our combination, measured.
// - v2 young history (our design; idea from the history fix of Zhdan, RTG II ch. 49
//   Sec. 49.5.4 prose: where history was discarded, stand in a pre-averaged neighbourhood for
//   the 1-spp input): on fresh pixels the spatial passes' input is mixed with a 5x5 mean of
//   raw visibility over taps on the receiver's plane, gated by the penumbra width; the
//   history stays raw.
// - v2.1 (our design, results/M4.md "v2.1"): the clamp window counts only the 5x5 taps whose
//   normal is within normalAngle of the receiver's (a shared normal tile, loaded only in tiles
//   whose raw samples disagree), window x sqrt(25/n); it widens toward no clamp where the own
//   penumbra is narrower than clampEdgePx; and the young mean keeps a tapering share for
//   youngFrames frames after a reset / disocclusion (counter in the history's A channel). They
//   fix "frame 2 worse than frame 1": from the second frame on the plain window clamped thin
//   occluders and creases toward the surface next to them (and hard edges toward their 5x5
//   mean), and the young mean switched off abruptly. Geometry-aware neighbourhood statistics as
//   such are common in temporal filters (e.g. the joint bilateral weights of SVGF, Schied et
//   al. 2017); the binary normal test on the clamp window is ours.
// - Our designs (tuned on the test bed, docs/research/rt-denoiser/results/M4.md §3): clamp
//   window 0.4 sigma (about 2 standard errors of the 5x5 mean; SPEC's 1 sigma never fires on
//   binary samples), anti-lag restart at the current frame when the clamp moves the history,
//   exact value when all 25 samples agree, history cap ~ (penumbra width in px)^2 against
//   reprojection blur, analytic terminator radius (light partly below the horizon), affine
//   reprojection taps (plane distance linear in the tap pixel).
// - v2.2 output stabilization (results/M4.md "Moving shadows"): a short history of the final output,
//   clamped to the 3x3 range of this frame's output, gated to narrow ranges, anti-lag on the clamp
//   distance; source RTG II ch. 49 Sec. 49.5.7 prose (stabilization pass with its own history,
//   outside the feedback loop, TAA-like clamping); the gate and the anti-lag gain are ours.
// - Options from results/SHADOWS-LOOK.md (our design, default off): `snapHardPx` ('change' also snaps
//   uniform windows where the own penumbra is sub-2-px), `noiseCap` / `noiseCapSettled` (the H18 radius
//   capped by the M12 occluder-sized one), `backfacePass` (whole light below the horizon: input kept).
// - Disk taps and rotation: SPEC R-3 / D3b (golden-angle spiral, Vogel 1979; animated 4x4
//   Bayer rotation, Zhdan, Ray Tracing Gems II ch. 49 Sec. 49.5.5 prose; golden-ratio
//   animation, Wolfe, RTG II ch. 24 Sec. 24.7.2).
// - Reprojection / per-tap plane-distance disocclusion: the shared temporal core
//   (shaders/common.ts).
import { FRAME_WGSL, REPROJECT_WGSL } from './common';

/** ShadowParams.flags */
export const SF_SPHERE = 1;
export const SF_NOISE = 2;        // no hit distance or no light: noise-driven radius (H18)
export const SF_ANISO = 4;
export const SF_NO_SKIP = 8;      // filter every tile
export const SF_MERGE_MIN = 16;   // W_eff = min(own, neighbourhood) instead of own-first
export const SF_HAS_HIT = 32;
export const SF_CATMULL = 64;     // Catmull-Rom history for visibility when the 2x2 footprint is valid
export const SF_SNAP = 128;       // uniform 5x5 neighbourhood: history := its value
export const SF_SNAP_CHANGE = 256; // ... only where the history sits outside the clamp window (a change)

/** ShadowParams.trFlags (translucency variants only) */
export const TR_HAS_T = 1;        // a translucency texture is bound (else T = 1)
export const TR_HAS_HIT = 2;      // a translucency hit-distance texture is bound
export const TR_OWN_GATE = 4;     // stabilize: S also gets its own box-width gate
export const TR_OWN_ANTILAG = 8;  // stabilize: S also gets its own clamp-distance anti-lag

/** Size of ShadowParams in bytes (the translucency variants read 8 more floats). */
export const SP_SIZE = 108 * 4;

/**
 * Translucency pipeline variant (SPEC v0.3 §7.10, M8): `packed` = the 4-storage-texture path (v's and
 * tau's histories packed as 8 f16 in one rgba32uint, the final output doubles as v's unfiltered copy
 * and stabilization history); otherwise the wide path (a separate tau history, 6 storage textures in
 * the temporal pass). `compose`: no stabilization history (option stabilize = 0), the last pass only
 * multiplies.
 */
export interface TrVariant { packed: boolean; compose?: boolean }

const PARAMS_TR_FIELDS = /* wgsl */ `  trEps: f32, trMaxN: f32, trFlags: u32, trClampSigma: f32,
  trClampFloor: f32, q7: f32, q8: f32, q9: f32,
`;

const PARAMS_WGSL = /* wgsl */ `
struct ShadowParams {
  proj: mat4x4f,         // current unjittered projection (view -> clip)
  A0: vec3f, lightSize: f32,      // view-space point of pixel q at linear depth z:
  Ax: vec3f, maxHistory: f32,     //   X(q, z) = A0 + Ax*q.x + Ay*q.y + z*(B0 + Bx*q.x + By*q.y)
  Ay: vec3f, clampSigma: f32,     //   (q in pixels, centre = p + 0.5)
  B0: vec3f, clampFloor: f32,
  Bx: vec3f, planeTol: f32,
  By: vec3f, radiusScale: f32,
  light: vec3f, antiLag: f32,     // world position (sphere) or unit direction toward the light
  pixScale: f32, pixOrtho: f32, minRadiusPx: f32, maxRadiusPx: f32,
  flags: u32, maxWHistory: f32, geoTol: f32, normalCos: f32,
  noiseScale: f32, anisoMax: f32, tilesX: u32, tilesY: u32,
  antiLagHistory: f32, freshBoost: f32, youngMean: f32, youngMinPx: f32,
  terminatorPx: f32, historyScale: f32, minHistory: f32, historyShrink: f32,
  PA0: vec3f, youngFrames: f32,   // the same affine form for the previous frame's projection
  PAx: vec3f, noiseBlend: f32,
  PAy: vec3f, noiseYoung: f32,
  PB0: vec3f, youngTaper: f32,
  PBx: vec3f, pass1Phase: f32,
  PBy: vec3f, youngBase: f32,   // history A channel = A + youngBase x (young frames left), see temporal
  clampMinTaps: f32, clampEdgePx: f32, rotationStep: f32, stabilize: f32,
  stabilizeBox: f32, stabilizeAntiLag: f32, stabilizeYoung: f32, noiseCap: f32,
  snapHardPx: f32, q4: f32, q5: f32, q6: f32,
}
// history length A from the history's A channel (strips the young-frames counter)
fn histA(z: f32) -> f32 { return z - SP.youngBase * floor(z / SP.youngBase); }
fn spFlag(f: u32) -> bool { return (SP.flags & f) != 0u; }
const SF_SPHERE = ${SF_SPHERE}u;
const SF_NOISE = ${SF_NOISE}u;
const SF_ANISO = ${SF_ANISO}u;
const SF_NO_SKIP = ${SF_NO_SKIP}u;
const SF_MERGE_MIN = ${SF_MERGE_MIN}u;
const SF_HAS_HIT = ${SF_HAS_HIT}u;
const SF_CATMULL = ${SF_CATMULL}u;
const SF_SNAP = ${SF_SNAP}u;
const SF_SNAP_CHANGE = ${SF_SNAP_CHANGE}u;
const G_INF = 0x7f800000u;   // +inf bits: "no occluder estimate"
`;

/** ShadowParams WGSL; the translucency variants add four fields (trEps, trMaxN, trFlags). */
function paramsWgsl(tr: boolean): string {
  if (!tr) return PARAMS_WGSL;
  return PARAMS_WGSL.replace('q6: f32,\n}', `q6: f32,\n${PARAMS_TR_FIELDS}}`) + /* wgsl */ `fn trFlag(f: u32) -> bool { return (SP.trFlags & f) != 0u; }
const TR_HAS_T = ${TR_HAS_T}u;
const TR_HAS_HIT = ${TR_HAS_HIT}u;
const TR_OWN_GATE = ${TR_OWN_GATE}u;
const TR_OWN_ANTILAG = ${TR_OWN_ANTILAG}u;
fn min3(v: vec3f) -> f32 { return min(v.x, min(v.y, v.z)); }
fn max3(v: vec3f) -> f32 { return max(v.x, max(v.y, v.z)); }
`;
}

const TILE = 8;

// ---------------------------------------------------------------------------- temporal

/**
 * `young`: the young-history pipeline variant (option youngMean > 0: geometry-weighted mean
 * over (2 youngRadius + 1)^2 pixels, depths loaded per young pixel; the shared visibility
 * tile's halo grows to max(2, youngRadius)).
 */
export function shadowTemporalWgsl(depthIsDepthFormat: boolean, young = false, youngRadius = 2, withE = false, clampGeo = false, tr?: TrVariant, stepTest = false, edgeBox = false, normalCos = 0, normalRelative = false): string {
  const HB = young ? Math.max(2, youngRadius) : 2;   // halo
  const SW = TILE + 2 * HB;                            // shared tile width
  const YR = young ? youngRadius : 2;
  const depthDecl = depthIsDepthFormat ? 'texture_depth_2d' : 'texture_2d<f32>';
  const depthLoad = depthIsDepthFormat ? 'textureLoad(depthTex, p, 0)' : 'textureLoad(depthTex, p, 0).r';
  const packed = !!tr?.packed;
  // 5x5 neighbourhood of raw visibility from the shared tile (unrolled)
  const nb: string[] = [];
  const nbG: string[] = [];
  const tb: string[] = [];    // translucency: per-channel stats of raw T over lit taps
  const tbG: string[] = [];
  for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) {
    const idx = `(l.y + ${y + HB - 2}u) * ${SW}u + l.x + ${x + HB - 2}u`;
    nb.push(`  { let s = sV[${idx}]; m1 += s; m2 += s * s; }`);
    tb.push(`          { let w = sV[${idx}]; let t = sT[${idx}]; t0 += w; t1 += w * t; t2 += w * t * t; }`);
    if (!clampGeo) continue;
    // taps whose normal is within normalAngle of the receiver's vote (sky: normal 0, never)
    // (unpack + dot beat dot4I8Packed on the M5 Pro: no native 4x8 dot there)
    nbG.push(`        { let s = sV[${idx}]; let w = select(0.0, 1.0, dot(cN, unpack4x8snorm(sN[${idx}])) >= cCos); m0 += w; m1 += w * s; m2 += w * s * s; }`);
    tbG.push(`          { let w = sV[${idx}] * select(0.0, 1.0, dot(tN, unpack4x8snorm(sN[${idx}])) >= tCos); let t = sT[${idx}]; t0 += w; t1 += w * t; t2 += w * t * t; }`);
  }
  // stepTest: the 5x5 window as 25 bits (opaque raw visibility > 0.5), unrolled
  const stepBits: string[] = [];
  for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) {
    stepBits.push(`  if (sV[(l.y + ${y + HB - 2}u) * ${SW}u + l.x + ${x + HB - 2}u] > 0.5) { m |= ${1 << (y * 5 + x)}u; }`);
  }
  // translucency: history taps (wide: own tau history; packed: z / w of the packed history)
  const histDecl = packed ? 'texture_2d<u32>' : 'texture_2d<f32>';
  const histOutFmt = packed ? 'rgba32uint' : 'rgba16float';
  const eArr = tr ? 'sE' : 'sV';
  return /* wgsl */ `
${FRAME_WGSL}
${paramsWgsl(!!tr)}
@group(0) @binding(0) var<uniform> F: Frame;
@group(0) @binding(1) var<uniform> SP: ShadowParams;
@group(0) @binding(2) var depthTex: ${depthDecl};
@group(0) @binding(3) var viewZTex: texture_2d<f32>;
@group(0) @binding(4) var normalTex: texture_2d<f32>;
@group(0) @binding(5) var motionTex: texture_2d<f32>;
@group(0) @binding(6) var motionZTex: texture_2d<f32>;
@group(0) @binding(7) var visTex: texture_2d<f32>;
@group(0) @binding(8) var hitTex: texture_2d<f32>;
@group(0) @binding(9) var geoPrev: texture_2d<u32>;
@group(0) @binding(10) var histPrev: ${histDecl};
@group(0) @binding(11) var outGeo: texture_storage_2d<rg32uint, write>;
@group(0) @binding(12) var outHist: texture_storage_2d<${histOutFmt}, write>;
@group(0) @binding(13) var outT: texture_storage_2d<r32float, write>;
${packed ? `@group(0) @binding(14) var outF: texture_storage_2d<rgba16float, write>;   // final output (v tau, v); doubles as v's unfiltered copy`
    : `@group(0) @binding(14) var outV: texture_storage_2d<r32float, write>;`}
@group(0) @binding(15) var<storage, read_write> tileStats: array<vec2u>;
@group(0) @binding(16) var smp: sampler;
${tr ? `@group(0) @binding(17) var trTex: texture_2d<f32>;      // translucency T (rgb), ignored where v = 0
@group(0) @binding(18) var trHitTex: texture_2d<f32>;   // distance to the nearest translucent layer (0 = none)
${packed ? '' : `@group(0) @binding(19) var trPrev: texture_2d<f32>;     // tau history (tau rgb, n_tau)
@group(0) @binding(20) var outTr: texture_storage_2d<rgba16float, write>;
@group(0) @binding(21) var outF: texture_storage_2d<rgba16float, write>;   // final output (v tau, v) outside the filtered tiles
`}` : ''}
${REPROJECT_WGSL}

// Linear depth (> 0) at p, 0 for sky / no surface (same rules as the shared prepass).
fn linZ(p: vec2i) -> f32 {
  var z: f32;
  if (hasFlag(FRAME_HAS_VIEWZ)) {
    z = -textureLoad(viewZTex, p, 0).r;
  } else {
    let d = ${depthLoad};
    let c = F.projInv * vec4f(ndcOf(uvOf(p)), d, 1.0);
    z = -c.z / c.w;
  }
  if (!(z > 0.0) || z >= F.far * 0.9999) { return 0.0; }
  return z;
}

// Reprojection with the shared core's rules (SPEC C-6/C-7: bilinear footprint, per-tap
// plane distance relative to view distance, backfacing taps rejected), made cheaper: tap
// positions from the affine form X(q, z) = A(q) + z B(q) of the previous projection, so the
// plane distance is linear in the tap pixel; the plane is the current normal (not the
// pairwise-averaged one).
var<private> ePrev: f32;   // previous frame's noise estimate E (geometry tap byte), bilinear over the valid taps
${normalRelative ? `// normalTest 'relative' (T6, our design; as common.ts REL_NORMAL_WGSL, from this pass's own inputs): the normal
// threshold relaxes to the lowest normal cosine between p and its 3x3 neighbours on the same surface, minus 0.02
fn relNormalTolS(p: vec2i, g: Geo, tol: f32) -> f32 {
  let z0 = g.z;
  let zl = linZ(clampPix(p - vec2i(1, 0)));
  let zr = linZ(clampPix(p + vec2i(1, 0)));
  let zu = linZ(clampPix(p - vec2i(0, 1)));
  let zd = linZ(clampPix(p + vec2i(0, 1)));
  let sl = max(min(abs(zr - z0), abs(z0 - zl)), min(abs(zd - z0), abs(z0 - zu)));
  var c = 1.0;
  for (var k = 0; k < 9; k++) {
    if (k == 4) { continue; }
    let q = p + vec2i(k % 3 - 1, k / 3 - 1);
    if (!inside(q)) { continue; }
    let zq = linZ(q);
    let nq = textureLoad(normalTex, q, 0).xyz;
    if (zq > 0.0 && dot(nq, nq) >= 0.01 && abs(zq - z0) <= 0.02 * z0 + 2.0 * sl) { c = min(c, dot(g.n, normalize(nq))); }
  }
  return min(tol, c - 0.02);
}
` : ''}fn reprojFast(p: vec2i, g: Geo) -> Reproj {
  var r: Reproj;
  let mv = textureLoad(motionTex, p, 0).xy;
  r.prevUV = uvOf(p) - vec2f(mv.x, -mv.y) * 0.5;
  let pc = vec2f(p) + 0.5;
  let Xv = SP.A0 + SP.Ax * pc.x + SP.Ay * pc.y + g.z * (SP.B0 + SP.Bx * pc.x + SP.By * pc.y);
  r.world = (F.viewInv * vec4f(Xv, 1.0)).xyz;
  var dPrev: f32;
  if (hasFlag(FRAME_HAS_MOTIONZ)) {
    dPrev = g.z - textureLoad(motionZTex, p, 0).r;
  } else {
    dPrev = -(F.prevView * vec4f(r.world, 1.0)).z;
  }
  let qp = r.prevUV * F.dims;
  let Xp = SP.PA0 + SP.PAx * qp.x + SP.PAy * qp.y + dPrev * (SP.PB0 + SP.PBx * qp.x + SP.PBy * qp.y);
  r.expPrev = Xp;
  let np = (F.prevView * vec4f(g.n, 0.0)).xyz;
  let a = vec3f(dot(np, SP.PA0), dot(np, SP.PAx), dot(np, SP.PAy));
  let b = vec3f(dot(np, SP.PB0), dot(np, SP.PBx), dot(np, SP.PBy));
  let c = dot(np, Xp);
  let tol = SP.planeTol * length(Xp);
  let pp = qp - 0.5;
  r.base = vec2i(floor(pp));
  let f = pp - floor(pp);
  r.bil = vec4f((1.0 - f.x) * (1.0 - f.y), f.x * (1.0 - f.y), (1.0 - f.x) * f.y, f.x * f.y);
  var valid = vec4f(0.0);
  var eTap = vec4f(0.0);
  for (var k = 0; k < 4; k++) {
    let q = r.base + TAP_OFFS[k];
    let gt = textureLoad(geoPrev, clampPix(q), 0).xy;
    eTap[k] = f32(gt.y >> 24u) / 255.0;
    let dt = bitcast<f32>(gt.x);
    let e = vec2f(f32(gt.y & 4095u), f32((gt.y >> 12u) & 4095u)) / 4095.0 * 2.0 - 1.0;
    let nq = vec3f(e, 1.0 - abs(e.x) - abs(e.y));   // octahedral, unnormalized: sign test only
    let nqf = vec3f(nq.xy + select(vec2f(max(-nq.z, 0.0)), vec2f(-max(-nq.z, 0.0)), nq.xy >= vec2f(0.0)), nq.z);
    let qc = vec2f(q) + 0.5;
    let pd = a.x + a.y * qc.x + a.z * qc.y + dt * (b.x + b.y * qc.x + b.z * qc.y) - c;
    valid[k] = select(0.0, 1.0, inside(q) && dt > 0.0 && dot(g.n, nqf) > ${normalCos > 0 ? `${normalCos.toFixed(6)} * length(nqf)` : '0.0'} && abs(pd) <= tol);
  }${normalRelative ? `
  // normalTest 'relative' (T6): where a tap failed, retest with the threshold relaxed to this pixel's neighbourhood
  // (a relaxed threshold keeps every tap the full one passed: equal to testing with it everywhere)
  if (any(valid < vec4f(0.5))) {
    let nTolS = max(relNormalTolS(p, g, ${normalCos.toFixed(6)}), 0.0);
    for (var k = 0; k < 4; k++) {
      let q = r.base + TAP_OFFS[k];
      let gt = textureLoad(geoPrev, clampPix(q), 0).xy;
      let dt = bitcast<f32>(gt.x);
      let e = vec2f(f32(gt.y & 4095u), f32((gt.y >> 12u) & 4095u)) / 4095.0 * 2.0 - 1.0;
      let nq = vec3f(e, 1.0 - abs(e.x) - abs(e.y));
      let nqf = vec3f(nq.xy + select(vec2f(max(-nq.z, 0.0)), vec2f(-max(-nq.z, 0.0)), nq.xy >= vec2f(0.0)), nq.z);
      let qc = vec2f(q) + 0.5;
      let pd = a.x + a.y * qc.x + a.z * qc.y + dt * (b.x + b.y * qc.x + b.z * qc.y) - c;
      valid[k] = select(0.0, 1.0, inside(q) && dt > 0.0 && dot(g.n, nqf) > nTolS * length(nqf) && abs(pd) <= tol);
    }
  }` : ''}
  r.valid = valid;
  r.w = r.bil * valid;
  r.sumW = r.w.x + r.w.y + r.w.z + r.w.w;
  ePrev = dot(r.w, eTap) / max(r.sumW, 1e-6);
  r.allValid = all(valid > vec4f(0.5));
  return r;
}

// Heitz 2018 Eq. 29 on the 5x5 tile: |d2v/dt2| along 4 lines through the centre, in [0, 1]
fn noiseE(l: vec2u) -> f32 {
  let c0 = i32((l.y + ${HB}u) * ${SW}u + l.x + ${HB}u);
  var e = 0.0;
  for (var d = 0; d < 4; d++) {
    let st = array<i32, 4>(1, ${SW}, ${SW + 1}, ${SW - 1})[d];   // -, |, \\, / through the centre
    for (var k = -1; k <= 1; k++) {
      let c = c0 + k * st;
      e += abs(${eArr}[c - st] - 2.0 * ${eArr}[c] + ${eArr}[c + st]);
    }
  }
  return e / 24.0;
}

${stepTest ? `// (stepTest, our design, results/SHADOWS-MOTION.md) the raw 5x5 window is a clean step: both values present and no
// sample disagrees with all of its in-window 4-neighbours (inner samples: with 3 of 4); 1-spp noise in a penumbra
// leaves isolated samples, a hard edge (straight, curved or a thin line >= 1 px) leaves none. Bit-sliced on the
// window's samples thresholded at 0.5 (exact for 1-ray visibility): bit y*5 + x, a / b / c / d = disagrees with the
// right / left / lower / upper neighbour (missing neighbours agree)
fn cleanStep(l: vec2u) -> bool {
  var m = 0u;
${stepBits.join('\n')}
  if (m == 0u || m == 0x1FFFFFFu) { return false; }
  let a = (m ^ (m >> 1u)) & 0xF7BDEFu;       // x < 4
  let b = (m ^ (m << 1u)) & 0x1EF7BDEu;      // x > 0
  let c = (m ^ (m >> 5u)) & 0xFFFFFu;        // y < 4
  let d = (m ^ (m << 5u)) & 0x1FFFFE0u;      // y > 0
  let three = (a & b & (c | d)) | (c & d & (a | b));
  let two = (a & b) | (a & c) | (a & d) | (b & c) | (b & d) | (c & d);
  return (three | (two & 0x1100011u)) == 0u;   // corners (2 neighbours) are isolated with both
}
// E of this frame: 0 at a clean step (E = 0 already in uniform windows: no test there)
fn stepE(e: f32, l: vec2u) -> f32 { if (e > 0.0 && cleanStep(l)) { return 0.0; } return e; }
` : ''}fn rawVis(p: vec2i) -> f32 { return clamp(textureLoad(visTex, clampPix(p), 0).r, 0.0, 1.0); }
${packed ? `
// packed history (rgba32uint, 8 f16): v from .x; Catmull-Rom from 16 loads (not filterable)
fn histV(q: vec2i) -> f32 { return unpack2x16float(textureLoad(histPrev, clampPix(q), 0).x).x; }
fn catmullRom16V(uv: vec2f) -> f32 {
  let pos = uv * F.dims;
  let t1 = floor(pos - 0.5) + 0.5;
  let f = pos - t1;
  let w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
  let w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
  let w2 = f * (0.5 + f * (2.0 - 1.5 * f));
  let w3 = f * f * (-0.5 + 0.5 * f);
  let b = vec2i(floor(pos - 0.5)) - 1;
  var c = 0.0;
  for (var j = 0; j < 4; j++) {
    let wy = array<f32, 4>(w0.y, w1.y, w2.y, w3.y)[j];
    let row = w0.x * histV(b + vec2i(0, j)) + w1.x * histV(b + vec2i(1, j)) + w2.x * histV(b + vec2i(2, j)) + w3.x * histV(b + vec2i(3, j));
    c += wy * row;
  }
  return c;
}
` : ''}
var<workgroup> sV: array<f32, ${SW * SW}>;     // raw visibility, ${SW}x${SW} = tile + ${HB}-px halo
${clampGeo ? `var<workgroup> sN: array<u32, ${SW * SW}>;     // unit world normal, pack4x8snorm (0 = sky / none), same tile` : ''}
var<workgroup> wgMinG: atomic<u32>;     // min penumbra scale over the tile (f32 bits, >= 0)
var<workgroup> wgFlags: atomic<u32>;    // 1 fractional history, 2 raw < 1, 4 raw > 0
${clampGeo ? `var<workgroup> wgHi: atomic<u32>;       // max raw visibility over the shared tile (f32 bits; zero-initialized)
var<workgroup> wgLoInv: atomic<u32>;    // max of 1 - raw visibility
var<workgroup> wgMixed: u32;            // the shared tile's raw samples disagree (normal tile loaded)` : ''}
${tr ? `var<workgroup> sT: array<vec3f, ${SW * SW}>;   // raw translucency T, same tile
var<workgroup> sE: array<f32, ${SW * SW}>;     // v x mean(T): the noise estimate's input (= v where T = 1)
var<workgroup> wgTr: atomic<u32>;       // some lit sample of the shared tile is attenuated (T < 1)
` : ''}
@compute @workgroup_size(${TILE}, ${TILE})
fn main(@builtin(global_invocation_id) gid: vec3u, @builtin(local_invocation_id) lid: vec3u,
        @builtin(local_invocation_index) li: u32, @builtin(workgroup_id) wid: vec3u) {
  let base = vec2i(wid.xy) * ${TILE} - ${HB};
  var tHi = 0.0;
  var tLo = 1.0;
  for (var i = li; i < ${SW * SW}u; i += 64u) {
    let v = rawVis(base + vec2i(i32(i % ${SW}u), i32(i / ${SW}u)));
    sV[i] = v;
    tHi = max(tHi, v);
    tLo = min(tLo, v);
  }
  if (li == 0u) { atomicStore(&wgMinG, G_INF); atomicStore(&wgFlags, 0u); }
${tr ? `  // translucency (M8): raw T of the shared tile (each thread its own texels of sV, no barrier needed)
  var trAny = false;
  for (var i = li; i < ${SW * SW}u; i += 64u) {
    var t = vec3f(1.0);
    if (trFlag(TR_HAS_T)) { t = clamp(textureLoad(trTex, clampPix(base + vec2i(i32(i % ${SW}u), i32(i / ${SW}u))), 0).rgb, vec3f(0.0), vec3f(1.0)); }
    sT[i] = t;
    sE[i] = sV[i] * ((t.x + t.y + t.z) / 3.0);
    trAny = trAny || (sV[i] > 0.0 && min3(t) < 1.0);
  }
  if (trAny) { atomicOr(&wgTr, 1u); }
` : ''}${clampGeo ? `  atomicMax(&wgHi, bitcast<u32>(tHi));
  atomicMax(&wgLoInv, bitcast<u32>(1.0 - tLo));
  workgroupBarrier();
  if (li == 0u) { wgMixed = select(0u, 1u, bitcast<f32>(atomicLoad(&wgHi)) > 1.0 - bitcast<f32>(atomicLoad(&wgLoInv))); }
  // normal tile only where the raw samples disagree somewhere in it (elsewhere every
  // 5x5 subset agrees and the geometry test can't change anything)
  let mixedTile = workgroupUniformLoad(&wgMixed) != 0u;
${tr ? `  let trTile = atomicLoad(&wgTr) != 0u;   // (translucency: the tau clamp's normal test needs the normal tile too)
` : ''}  if (mixedTile${tr ? ' || trTile' : ''}) {
    for (var i = li; i < ${SW * SW}u; i += 64u) {
      let q = clampPix(base + vec2i(i32(i % ${SW}u), i32(i / ${SW}u)));
      let nq = textureLoad(normalTex, q, 0).xyz;
      sN[i] = pack4x8snorm(vec4f(nq * inverseSqrt(max(dot(nq, nq), 1e-12)), 0.0));
    }
  }` : ''}
  workgroupBarrier();
${tr && !clampGeo ? `  let trTile = atomicLoad(&wgTr) != 0u;
` : ''}
  let p = vec2i(gid.xy);
  let l = vec2u(lid.xy);
  var vAcc = 0.0;
  var yW = 0.0;        // young-history weight of the 5x5 mean (0 = not young / off)
  var gOwn = -1.0;     // own penumbra-scale estimate (-1 = none)
  var pixW = 1.0;      // world size of one pixel at this depth
${tr ? `  var tau = vec3f(1.0); // translucency: conditional transmittance E[T | v = 1] (M8-2)
  var nT = 0.0;        // its sample count n_tau
  var trFl = 0u;       // tau tile bits (8 lit sample attenuated, 16 lit sample clear, 32 tau differs from raw T)
` : ''}  if (inside(p)) {
    var g: Geo;
    g.z = linZ(p);
    g.n = vec3f(0.0, 0.0, 1.0);
    g.grad = vec2f(0.0);
    g.rough = 0.0;
    let nIn = textureLoad(normalTex, p, 0).xyz;
    if (dot(nIn, nIn) < 0.01) { g.z = 0.0; }
    let vRaw = sV[(l.y + ${HB}u) * ${SW}u + l.x + ${HB}u];
    vAcc = vRaw;
    var hist = vec4f(vRaw, 0.0, 0.0, 0.0);
    if (g.z > 0.0) {
      g.n = normalize(nIn);
      // ---- reproject (shared core rules, affine form)
      let r = reprojFast(p, g);
      var A = -1.0;
      var yPrev = 0.0;
${packed ? `      var trH = vec4f(1.0, 1.0, 1.0, 0.0);   // reprojected tau history (tau rgb, n_tau)
` : ''}      var vH = 0.0;
      var gH = 0.0;
      var nW = 0.0;
      if (!hasFlag(FRAME_RESET) && r.sumW > 0.0) {
        let w = max(r.bil, vec4f(1e-3)) * r.valid;
        let ws = 1.0 / (w.x + w.y + w.z + w.w);
        var acc = vec4f(0.0);
        var gs = vec2f(0.0);
        var lo = 1.0;
        var hi = 0.0;
        var yAcc = 0.0;
${packed ? `        var trAcc = vec4f(0.0);
` : ''}        for (var k = 0; k < 4; k++) {
${packed ? `          let hu = textureLoad(histPrev, clampPix(r.base + TAP_OFFS[k]), 0);
          var hk = vec4f(unpack2x16float(hu.x), unpack2x16float(hu.y));
          let tk = vec4f(unpack2x16float(hu.z), unpack2x16float(hu.w));
          if (k == 0) { trH = tk; }
          trAcc += (tk - trH) * w[k];`
    : `          var hk = textureLoad(histPrev, clampPix(r.base + TAP_OFFS[k]), 0);`}
          let yk = floor(hk.z / SP.youngBase);   // young frames left (0 once settled)
          hk.z -= yk * SP.youngBase;
          yAcc += yk * w[k];
          acc += hk * w[k];
          lo = min(lo, hk.x);
          hi = max(hi, hk.x);
          let hasG = select(0.0, w[k], hk.w > 0.0);
          gs += vec2f(hk.y * hasG, hasG);
        }
        acc *= ws;
        yPrev = yAcc * ws;
        vH = acc.x;
        if (spFlag(SF_CATMULL) && r.allValid) {
          // sharper resampling: repeated bilinear reprojection blurs narrow penumbrae
          vH = clamp(${packed ? 'catmullRom16V(r.prevUV)' : 'sampleCatmullRom(histPrev, smp, r.prevUV).x'}, lo, hi);
        }
        A = acc.z;
        nW = acc.w;
        gH = select(0.0, gs.x / gs.y, gs.y > 0.0);
${packed ? `        trH += trAcc * ws;
` : ''}      }
      // ---- penumbra scale sample: W = lightSize * gS (M12 Eq. 13 rewritten for h)
      var gS = -1.0;
      if (spFlag(SF_NOISE)) {
        gS = noiseE(l);
      } else if (vRaw < 0.999) {
        let h = textureLoad(hitTex, p, 0).r;
        if (h > 0.0) {
          if (spFlag(SF_SPHERE)) {
            let D = length(SP.light - r.world);
            gS = h / max(D - h, 1e-3 * D);
          } else {
            gS = h;
          }
        }
      }${tr ? ` else if (trFlag(TR_HAS_HIT) && 1.0 - min3(sT[(l.y + ${HB}u) * ${SW}u + l.x + ${HB}u]) > SP.trEps) {
        // translucency (M8-3): a lit sample through a translucent layer sizes the footprint by the
        // distance to the nearest such layer, like an occluded one by h (nearest blocker of either kind)
        let h = textureLoad(trHitTex, p, 0).r;
        if (h > 0.0) {
          if (spFlag(SF_SPHERE)) {
            let D = length(SP.light - r.world);
            gS = h / max(D - h, 1e-3 * D);
          } else {
            gS = h;
          }
        }
      }` : ''}
      var nWn = select(0.0, nW, A >= 0.0);
      var gAcc = select(0.0, gH, A >= 0.0);
      if (gS >= 0.0) {
        nWn = min(nWn, SP.maxWHistory) + 1.0;
        gAcc = mix(gAcc, gS, 1.0 / nWn);
      }
      // history cap from the penumbra width in pixels (our design): every reprojection
      // resamples the history, so a long history blurs a narrow penumbra by ~sqrt(A) px;
      // wide penumbrae keep the full cap, near-hard edges stay short (their 1-spp noise is
      // confined to a band about as wide as the penumbra)
      var cap = SP.maxHistory;
      var wPx = 1e30;   // penumbra width in pixels (unknown: no occluded sample yet)
      if (nWn > 0.0 && !spFlag(SF_NOISE)) {
        wPx = SP.lightSize * gAcc / (g.z * SP.pixScale + SP.pixOrtho);
        if (SP.historyScale > 0.0) { cap = clamp(SP.historyScale * wPx * wPx, SP.minHistory, SP.maxHistory); }
      }
      // ---- neighbourhood clamp on raw visibility (5x5 mean +- gamma sigma)
      var m1 = 0.0;
      var m2 = 0.0;
      var nS = 25.0;
${clampGeo ? `      if (mixedTile) {
        // v2.1 (our design): only taps whose normal is within normalAngle of the receiver's count
        // (binary), so a thin occluder or a crease isn't clamped toward the surface behind / next
        // to it (that pulled dark legs on a lit floor up by ~0.1 from the second frame on); the
        // window widens as sqrt(25 / n), ~2 standard errors of the n-sample mean. Tiles whose raw
        // samples all agree skip this (every subset agrees too). A plane-distance test on top was
        // worth 0 dB on the test bed, +0.06..0.28 on the real scene, for a depth tile and ~0.1 ms
        // more (results/M4.md v2.1).
        let cN = unpack4x8snorm(pack4x8snorm(vec4f(g.n, 0.0)));
        let cCos = (SP.normalCos - 0.02) * dot(cN, cN);   // 8-bit normals: a little slack
        var m0 = 0.0;
${nbG.join('\n')}
        // too few taps on the receiver's surface (silhouette slivers): the plain window
        if (m0 >= SP.clampMinTaps) {
          nS = m0;
        } else {
          m1 = 0.0;
          m2 = 0.0;
${nb.map((t) => '    ' + t).join('\n')}
        }
      } else {` : '      {'}
${nb.join('\n')}
      }
      let mu = m1 / nS;
      let sigma = sqrt(max(m2 / nS - mu * mu, 0.0));
      // near-hard edges (v2.1, our design): a 5x5 mean is a biased estimate of a pixel next to a
      // step (up to ~0.4 off), so the window grows by up to 1 (no clamp) as the penumbra width
      // falls below clampEdgePx; such pixels keep a short history anyway (cap ~ W_px^2)
      let win = SP.clampSigma * sigma${clampGeo ? ' * sqrt(25.0 / nS)' : ''} + SP.clampFloor
        + select(0.0, saturate(1.0 - wPx / SP.clampEdgePx), SP.clampEdgePx > 0.0);
      var vC = clamp(vH, mu - win, mu + win);
${edgeBox ? `      // (edgeBox, results/SHADOWS-MOTION.md) at hard edges the window above opens toward no clamp; there clamp to the
      // 3x3 raw min / max instead (TAA neighbourhood clamping): a pixel the edge has left sees one value only
      if (SP.clampEdgePx > 0.0 && wPx < SP.clampEdgePx) {
        var lo3 = 1.0;
        var hi3 = 0.0;
        for (var dy = 0u; dy < 3u; dy++) {
          for (var dx = 0u; dx < 3u; dx++) {
            let s3 = sV[(l.y + dy + ${HB - 1}u) * ${SW}u + l.x + dx + ${HB - 1}u];
            lo3 = min(lo3, s3);
            hi3 = max(hi3, s3);
          }
        }
        vC = mix(vC, clamp(vC, lo3, hi3), saturate(1.0 - wPx / SP.clampEdgePx));
      }
` : ''}      if (A >= 0.0) {
        // anti-lag (our design): a history the clamp had to move is short-lived
        let c = saturate(abs(vC - vH) * SP.antiLag);
        A = mix(A, min(A, SP.antiLagHistory), c);
      }
      // all 25 samples agree: take their value exactly, keep the history length (the floor
      // above only decides whether this is a change worth restarting for)
      // (SF_SNAP_CHANGE: only where the clamp fired, i.e. after a change such as a light flip;
      // a steady outer penumbra keeps its fractional history)
      // (snapHardPx, our design: 'change' also snaps where the own penumbra is narrower than snapHardPx px;
      // there a uniform 5x5 window means the pixel is outside the penumbra, and a kept fractional history is
      // only resampling blur of the nearby edge)
      if (sigma == 0.0 && spFlag(SF_SNAP) && (!spFlag(SF_SNAP_CHANGE) || abs(vH - mu) > win || wPx < SP.snapHardPx)) { vC = mu; }
      let An = min(A, cap) + 1.0;   // 0 after a disocclusion
      vAcc = mix(vC, vRaw, 1.0 / (1.0 + An));
      // young-frames counter (v2.1, our design): youngFrames on a fresh pixel (no valid history),
      // one less per frame, carried in the A channel above youngBase; unlike A it is not shortened
      // by the history cap or by anti-lag, so it marks "recently new", not "short history"
      let yN = select(max(round(yPrev) - 1.0, 0.0), SP.youngFrames, An == 0.0);
      hist = vec4f(vAcc, gAcc, An + SP.youngBase * yN, nWn);
${tr ? `      // ---- translucency (M8-4, our design): tau = E[T | v = 1], accumulated only over samples that
      // reached the light (weight v), clamped per channel to the 5x5 mean +- window of raw T over the
      // lit taps (the normal-tested taps of v's window, >= clampMinTaps of them, else no clamp), with
      // v's window form and restart gain, capped at trMaxN samples
      {
        ${packed ? `var tH = trH.xyz;
        var nH = trH.w;` : `var tH = vec3f(1.0);
        var nH = 0.0;
        if (!hasFlag(FRAME_RESET) && r.sumW > 0.0) {
          let w = max(r.bil, vec4f(1e-3)) * r.valid;
          // relative to the first tap: a uniform history (e.g. tau = 1) comes back exactly, no f16 drift
          let h0 = textureLoad(trPrev, clampPix(r.base), 0);
          var acc = vec4f(0.0);
          for (var k = 1; k < 4; k++) { acc += (textureLoad(trPrev, clampPix(r.base + TAP_OFFS[k]), 0) - h0) * w[k]; }
          acc = h0 + acc / (w.x + w.y + w.z + w.w);
          tH = acc.xyz;
          nH = acc.w;
        }`}
        let tRaw = sT[(l.y + ${HB}u) * ${SW}u + l.x + ${HB}u];
        var muT = vec3f(1.0);    // no attenuated lit sample in the shared tile: every lit tap has T = 1
        var sgT = vec3f(0.0);
        var tn = m1;             // lit taps of v's window (binary v)
        if (trTile) {
          var t0 = 0.0;
          var t1 = vec3f(0.0);
          var t2 = vec3f(0.0);
${clampGeo ? `          let tN = unpack4x8snorm(pack4x8snorm(vec4f(g.n, 0.0)));
          let tCos = (SP.normalCos - 0.02) * dot(tN, tN);
${tbG.join('\n')}
          if (t0 < SP.clampMinTaps) {
            t0 = 0.0;
            t1 = vec3f(0.0);
            t2 = vec3f(0.0);
  ${tb.join('\n  ')}
          }` : tb.join('\n')}
          tn = t0;
          muT = t1 / max(t0, 1e-6);
          sgT = sqrt(max(t2 / max(t0, 1e-6) - muT * muT, vec3f(0.0)));
        }
        var tC = tH;
        if (tn >= SP.clampMinTaps) {
          let winT = SP.trClampSigma * sgT * sqrt(25.0 / tn) + SP.trClampFloor;
          tC = clamp(tH, muT - winT, muT + winT);
          // every lit tap sees the same T (clear, or one uniform layer): take it exactly (v's uniform
          // snap, SH-4); otherwise the f16 history's rounding drifts tau below 1 where nothing is in the way
          if (all(sgT == vec3f(0.0))) { tC = muT; }
        }
        nH = mix(nH, 0.0, saturate(SP.antiLag * max3(abs(tC - tH))));
        if (vRaw > 0.0) {
          // (as a step from tC: exact when the sample agrees with the history, whatever the division's accuracy)
          tau = tC + (vRaw / (nH + vRaw)) * (tRaw - tC);
          nT = min(nH + vRaw, SP.trMaxN);
          trFl = select(16u, 8u, 1.0 - min3(tRaw) > SP.trEps);
          if (max3(abs(tau - tRaw)) > SP.trEps) { trFl |= 32u; }
        } else {
          tau = tC;
          nT = nH;
        }
      }
` : ''}${withE ? `      // H18 noise estimate E for the radius blend (noiseBlend / noiseYoung), accumulated like g
      // over at most maxWHistory + 1 frames and stored in the geometry's 8-bit roughness slot
      let eCur = ${stepTest ? 'stepE(noiseE(l), l)' : 'noiseE(l)'};
      g.rough = select(eCur, mix(ePrev, eCur, 1.0 / (min(An, SP.maxWHistory) + 1.0)), An > 0.0);` : ''}
${young ? `      // young history (our design): on a fresh pixel the 1-spp sample is the noisiest input; a 5x5
      // mean of it (accurate for blue-noise samples, the same property the clamp relies on) is
      // mixed into the spatial passes' input (the history stays raw). v2.1: for youngFrames
      // frames after a reset / disocclusion it keeps standing in for part of the temporal
      // estimate, weight youngMean x (frames left / youngFrames) / (1 + youngTaper x A) (about the
      // inverse-variance share of a biased 25-sample mean against an A + 1-sample mean), instead of
      // dropping to 0 on the second frame (which made frame 2 worse than frame 1).
      // After the barrier: gated by the penumbra width (hard edges keep the raw sample) and
      // restricted to taps on the receiver's plane.
      yW = saturate(SP.youngMean * select(yN / max(SP.youngFrames, 1.0), 1.0, An == 0.0) / (1.0 + SP.youngTaper * An));
      gOwn = select(-1.0, gAcc, nWn > 0.0);
      pixW = g.z * SP.pixScale + SP.pixOrtho;` : ''}

      // ---- tile stats
      if (nWn > 0.0) { atomicMin(&wgMinG, bitcast<u32>(max(gAcc, 0.0))); }
      var fl = 0u;
      if (vAcc > 1e-3 && vAcc < 0.999) { fl |= 1u; }
      if (vRaw < 0.999) { fl |= 2u; }
      if (vRaw > 1e-3) { fl |= 4u; }
${tr ? `      fl |= trFl;
` : ''}      if (fl != 0u) { atomicOr(&wgFlags, fl); }
    }
    textureStore(outGeo, p, vec4u(packGeoTap(g), 0u, 0u));
    textureStore(outHist, p, ${packed ? 'vec4u(pack2x16float(hist.xy), pack2x16float(hist.zw), pack2x16float(tau.xy), pack2x16float(vec2f(tau.z, nT)))' : 'hist'});${tr && !packed ? `
    textureStore(outTr, p, vec4f(tau, nT));` : ''}
  }
  workgroupBarrier();
  if (inside(p)) {
    // unfiltered output copies (inputs of the spatial passes; final output of inactive tiles)
    var vOut = vAcc;
${young ? `    if (yW > 0.0) {
      // pass-0 kernel radius in px at A = 0 from the nearest occluder of this tile (own first)
      let gT = bitcast<f32>(atomicLoad(&wgMinG));
      var rPx = 0.0;
      if (spFlag(SF_NOISE)) {
        rPx = max(gOwn, 0.0) * SP.noiseScale;
      } else {
        var gE = gT;
        if (gOwn >= 0.0) { gE = min(gOwn, gT); }
        if (gE < 1e30) { rPx = SP.radiusScale * SP.lightSize * gE / pixW; }
      }
      let sY = saturate((rPx - SP.youngMinPx) * 0.5);
      // (clampGeometry: in a tile whose raw samples all agree the mean equals this pixel's own
      // sample, and so does vAcc after the snap: nothing to mix)
      if (sY > 0.0${clampGeo ? ' && mixedTile' : ''}) {
        // 5x5 mean over taps within planeTol of the receiver's tangent plane (affine form,
        // as in the spatial passes)
        let nv = (F.view * vec4f(normalize(textureLoad(normalTex, p, 0).xyz), 0.0)).xyz;
        let pc = vec2f(p) + 0.5;
        let zc = linZ(p);
        let X = SP.A0 + SP.Ax * pc.x + SP.Ay * pc.y + zc * (SP.B0 + SP.Bx * pc.x + SP.By * pc.y);
        let na = vec3f(dot(nv, SP.A0), dot(nv, SP.Ax), dot(nv, SP.Ay));
        let nb = vec3f(dot(nv, SP.B0), dot(nv, SP.Bx), dot(nv, SP.By));
        let dC = dot(nv, X);
        let tol = SP.geoTol * length(X);
        var sw = 0.0;
        var sv = 0.0;
        for (var dy = 0u; dy < ${2 * YR + 1}u; dy++) {
          for (var dx = 0u; dx < ${2 * YR + 1}u; dx++) {
            let i = (l.y + dy + ${HB - YR}u) * ${SW}u + l.x + dx + ${HB - YR}u;
            let zt = linZ(clampPix(p + vec2i(i32(dx) - ${YR}, i32(dy) - ${YR})));   // young pixels only
            let qc = pc + vec2f(f32(dx) - ${YR}.0, f32(dy) - ${YR}.0);
            let pd = na.x + na.y * qc.x + na.z * qc.y + zt * (nb.x + nb.y * qc.x + nb.z * qc.y) - dC;
            let w = select(0.0, 1.0, zt > 0.0 && abs(pd) <= tol${clampGeo ? ` && dot(unpack4x8snorm(sN[(l.y + ${HB}u) * ${SW}u + l.x + ${HB}u]), unpack4x8snorm(sN[i])) >= SP.normalCos - 0.02` : ''});
            sw += w;
            sv += w * sV[i];
          }
        }
        let muG = sv / max(sw, 1.0);
        vOut = mix(vAcc, muG, yW * sY);
      }
    }` : ''}
    textureStore(outT, p, vec4f(vOut, 0.0, 0.0, 0.0));
${packed ? '' : `    textureStore(outV, p, vec4f(vOut, 0.0, 0.0, 0.0));`}${tr ? `
    textureStore(outF, p, vec4f(vOut * tau, vOut));` : ''}
  }
  if (li == 0u) {
    tileStats[wid.y * SP.tilesX + wid.x] = vec2u(atomicLoad(&wgMinG), atomicLoad(&wgFlags));
  }
}
`;
}

// ---------------------------------------------------------------------------- tiles

/** Tiles pass; `tr`: tau tiles too (activeTile bit 2, M8-5). */
export function shadowTilesWgsl(tr = false): string {
  return /* wgsl */ `
${paramsWgsl(tr)}
@group(0) @binding(0) var<uniform> SP: ShadowParams;
@group(0) @binding(1) var<storage, read> tileStats: array<vec2u>;
@group(0) @binding(2) var<storage, read_write> tileMinG: array<u32>;
@group(0) @binding(3) var<storage, read_write> args: array<atomic<u32>>;   // [count, 1, 1]
@group(0) @binding(4) var<storage, read_write> list: array<u32>;
@group(0) @binding(5) var<storage, read_write> activeTile: array<u32>;   // 1 = in the list (stabilize's box source)
${tr ? `@group(0) @binding(6) var<storage, read_write> listTau: array<u32>;   // tau tiles (args[4..7]); list = v-only tiles
` : ''}
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= SP.tilesX || gid.y >= SP.tilesY) { return; }
  var minG = G_INF;
  var fl = 0u;
  for (var dy = -1; dy <= 1; dy++) {
    for (var dx = -1; dx <= 1; dx++) {
      let t = vec2i(gid.xy) + vec2i(dx, dy);
      if (t.x < 0 || t.y < 0 || u32(t.x) >= SP.tilesX || u32(t.y) >= SP.tilesY) { continue; }
      let s = tileStats[u32(t.y) * SP.tilesX + u32(t.x)];
      minG = min(minG, s.x);
      fl |= s.y;
    }
  }
  let idx = gid.y * SP.tilesX + gid.x;
  tileMinG[idx] = minG;
  // penumbra in the 3x3 tiles: a fractional history, or raw samples that disagree
  let isActive = (fl & 1u) != 0u || (fl & 6u) == 6u || spFlag(SF_NO_SKIP);
${tr ? `  // tau tiles (M8-5): lit samples both attenuated and clear in the 3x3 tiles, or tau differs from raw T
  let isTr = (fl & 24u) == 24u || (fl & 32u) != 0u;
  activeTile[idx] = select(0u, 1u, isActive) | select(0u, 2u, isTr);
  // two indirect lists: v-only tiles run the opaque passes as they are, tau tiles the colour variants
  if (isTr) {
    let k = atomicAdd(&args[4], 1u);
    listTau[k] = idx;
  } else if (isActive) {` : `  activeTile[idx] = select(0u, 1u, isActive);
  if (isActive) {`}
    let k = atomicAdd(&args[0], 1u);
    list[k] = idx;
  }
}
`;
}

export const SHADOW_TILES_WGSL = shadowTilesWgsl(false);

// ---------------------------------------------------------------------------- spatial

/**
 * Spatial-pass variants (options; each off by default, and off it leaves the WGSL text unchanged):
 * `noiseCap` (option noiseCap > 0): the H18 noise-driven radius is capped at noiseCap x the occluder-sized
 * radius before the blend (hard shadows: E is large at a clean step, the occluder says the penumbra is
 * sub-pixel); `backface` (option backfacePass): pixels with the whole light below their horizon and no own
 * occluder estimate pass their input through (nothing reaches them; filtering only pulls light in);
 * `noiseCapSettled` (option noiseCapSettled): the cap only on pixels past their young frames (youngFrames).
 */
export interface SpatialVariant { noiseCap?: boolean; noiseCapSettled?: boolean; backface?: boolean; terminatorAnalytic?: boolean }

/**
 * pass 0 reads the temporal pass's unfiltered copy (`out`), pass 1 the previous pass's output (T).
 * Variant `withE`: radius blended toward the H18 noise radius.
 */
export function shadowSpatialWgsl(pass: 0 | 1, normalWeight = true, withE = false, tr?: TrVariant, tauTiles = true, sv: SpatialVariant = {}): string {
  const packed = !!tr?.packed;
  // pass-through store (input unchanged; translucency: tau too)
  const passStore = tr ? `
    textureStore(outTex, p, vec4f(vin, 0.0, 0.0, 0.0));
    if (tAct) { textureStore(outTr, p, vec4f(tauC, 1.0)); }
    return;
  ` : ` textureStore(outTex, p, vec4f(vin, 0.0, 0.0, 0.0)); return; `;
  const vch = packed && pass === 0 ? 'a' : 'r';   // packed: pass 0 reads v from the final output's alpha
  const taps: string[] = [];
  const tap = (i: number, r: string) => taps.push(/* wgsl */ `
  {
    let o = ${r} * DISK[${i}];
    let qf = pc + o.x * jT + o.y * jB;
    let q = vec2i(floor(qf));
    let qc = clampPix(q);
    let gt = textureLoad(geoCur, qc, 0).xy;
    let vt = textureLoad(srcTex, qc, 0).${vch};
    let zt = bitcast<f32>(gt.x);
${normalWeight ? `    let nt = octDecode(vec2f(f32(gt.y & 4095u), f32((gt.y >> 12u) & 4095u)) / 4095.0 * 2.0 - 1.0);` : ''}
    let qp = vec2f(qc) + 0.5;
    let pd = abs(na.x + na.y * qp.x + na.z * qp.y + zt * (nb.x + nb.y * qp.x + nb.z * qp.y) - dC);
    let wg = W1(pd * invGeoTol);
    let wn = ${normalWeight ? 'W1((1.0 - dot(n, nt)) * invNormTol)' : '1.0'};
    let w = select(0.0, wg * wn, inside(q) && zt > 0.0);
    sum += w * vt;
    wsum += w;
${tr ? `    // (fused multiply-adds, no separate w x v product: sharing one with v's sum changes how v's sum
    // compiles and v would no longer be bit-identical to the opaque denoiser)
    if (tAct) { tsum = fma(vec3f(w), vt * (tauTap(qc) - tauC), tsum); twsum = fma(w, vt, twsum); }
` : ''}  }`);
  for (let i = 0; i < 8; i++) tap(i, 'rot');
  return /* wgsl */ `
${FRAME_WGSL}
${paramsWgsl(!!tr)}
@group(0) @binding(0) var<uniform> F: Frame;
@group(0) @binding(1) var<uniform> SP: ShadowParams;
@group(0) @binding(2) var geoCur: texture_2d<u32>;
@group(0) @binding(3) var histCur: ${packed ? 'texture_2d<u32>' : 'texture_2d<f32>'};
@group(0) @binding(4) var srcTex: texture_2d<f32>;
@group(0) @binding(5) var<storage, read> tileMinG: array<u32>;
@group(0) @binding(6) var<storage, read> list: array<u32>;
@group(0) @binding(7) var outTex: texture_storage_2d<r32float, write>;
${tr ? `@group(0) @binding(8) var<storage, read> activeTile: array<u32>;   // 1 v filtered, 2 tau filtered
@group(0) @binding(9) var trSrc: texture_2d<f32>;    // pass 1: pass 0's tau (tau-filtered tiles)
${packed ? '' : `@group(0) @binding(10) var trHist: texture_2d<f32>;   // tau history (unfiltered tau)
`}@group(0) @binding(${packed ? 10 : 11}) var outTr: texture_storage_2d<rgba16float, write>;

// unfiltered tau (the history), and the tau a tap of this pass sees
fn tauHist(q: vec2i) -> vec3f {
${packed ? `  let hu = textureLoad(histCur, q, 0);
  return vec3f(unpack2x16float(hu.z), unpack2x16float(hu.w).x);` : `  return textureLoad(trHist, q, 0).rgb;`}
}
fn tauTap(q: vec2i) -> vec3f {
${pass === 0 ? '  return tauHist(q);' : `  // pass 0 filtered tau only in tau tiles; elsewhere the history is this pass's input
  let ft = (activeTile[u32(q.y / ${TILE}) * SP.tilesX + u32(q.x / ${TILE})] & 2u) != 0u;
  return select(tauHist(q), textureLoad(trSrc, q, 0).rgb, ft);`}
}
` : ''}
const PASS = ${pass};
// R-3: 8 taps in 4 antipodal pairs (golden-angle spiral, radii sqrt((i + 0.5)/4)).
const DISK = array<vec2f, 8>(
  vec2f(0.3536, 0.0), vec2f(-0.4515, 0.4137), vec2f(0.0691, -0.7875), vec2f(0.5691, 0.7423),
  vec2f(-0.3536, 0.0), vec2f(0.4515, -0.4137), vec2f(-0.0691, 0.7875), vec2f(-0.5691, -0.7423));
const BAYER4 = array<f32, 16>(0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);

// SPEC weight shape W(x) = smoothstep(0, 1, 1 - x)
fn W1(x: f32) -> f32 { return smoothstep(0.0, 1.0, saturate(1.0 - x)); }

// screen pixel (continuous, centre of pixel p = p + 0.5) of a view-space point
fn toPixel(v: vec3f) -> vec2f {
  let c = SP.proj * vec4f(v, 1.0);
  let ndc = c.xy / c.w;
  return vec2f((ndc.x + 1.0) * 0.5, (1.0 - ndc.y) * 0.5) * F.dims;
}

// orthonormal basis around n (Duff et al. 2017, JCGT 6(1))
fn basisOf(n: vec3f) -> mat2x3f {
  let s = select(-1.0, 1.0, n.z >= 0.0);
  let a = -1.0 / (s + n.z);
  let b = n.x * n.y * a;
  return mat2x3f(vec3f(1.0 + s * n.x * n.x * a, s * b, -s * n.x), vec3f(b, s + n.y * n.y * a, -n.y));
}

@compute @workgroup_size(${TILE}, ${TILE})
fn main(@builtin(local_invocation_id) lid: vec3u, @builtin(workgroup_id) wid: vec3u) {
  let tile = list[wid.x];
  let p = vec2i(i32((tile % SP.tilesX) * ${TILE}u + lid.x), i32((tile / SP.tilesX) * ${TILE}u + lid.y));
  if (!inside(p)) { return; }
  let gc = textureLoad(geoCur, p, 0).xy;
  let z = bitcast<f32>(gc.x);
  let vin = textureLoad(srcTex, p, 0).${vch};
${tr ? `  // translucency (M8-5/6): tile mode (v-only tiles skip tau, tau-only tiles pass v through)
  let mode = activeTile[tile];
  let vAct = (mode & 1u) != 0u;
  let tAct = ${tauTiles ? 'true' : 'false'};   // dispatched over the tau tiles (true) or the v-only tiles (false)
  var tauC = vec3f(1.0);
  if (tAct) { tauC = tauTap(p); }
  if (z <= 0.0) {
    textureStore(outTex, p, vec4f(vin, 0.0, 0.0, 0.0));
    if (tAct) { textureStore(outTr, p, vec4f(tauC, 1.0)); }
    return;
  }
` : `  if (z <= 0.0) { textureStore(outTex, p, vec4f(vin, 0.0, 0.0, 0.0)); return; }
`}${packed ? `  let hu0 = textureLoad(histCur, p, 0);
  var h = vec4f(unpack2x16float(hu0.x), unpack2x16float(hu0.y));` : `  var h = textureLoad(histCur, p, 0);`}
${sv.noiseCapSettled ? `  let settled = h.z < SP.youngBase;   // (noiseCapSettled) no young frames left: >= youngFrames since new
` : ''}  h.z = histA(h.z);

  // receiver frame in view space
  let pc = vec2f(p) + 0.5;
  let X = SP.A0 + SP.Ax * pc.x + SP.Ay * pc.y + z * (SP.B0 + SP.Bx * pc.x + SP.By * pc.y);
  let n = octDecode(vec2f(f32(gc.y & 4095u), f32((gc.y >> 12u) & 4095u)) / 4095.0 * 2.0 - 1.0);
  let nv = normalize((F.view * vec4f(n, 0.0)).xyz);
  var lv: vec3f;
  var sinL: f32;   // sine of the light's angular radius seen from X
  if (spFlag(SF_SPHERE)) {
    let tl = (F.view * vec4f(SP.light, 1.0)).xyz - X;
    let dl = length(tl);
    lv = tl / dl;
    sinL = min(SP.lightSize / dl, 1.0);
  } else {
    lv = normalize((F.view * vec4f(SP.light, 0.0)).xyz);
    sinL = SP.lightSize * inverseSqrt(1.0 + SP.lightSize * SP.lightSize);
  }
  let nl = dot(nv, lv);

  // penumbra scale: own estimate first, else the nearest occluder of the 3x3 tiles
  let gTile = tileMinG[u32(p.y / ${TILE}) * SP.tilesX + u32(p.x / ${TILE})];
  let hasTile = gTile != G_INF;
  var gEff = bitcast<f32>(gTile);
  if (h.w > 0.0) {
    gEff = select(h.y, min(h.y, gEff), spFlag(SF_MERGE_MIN) && hasTile && !spFlag(SF_NOISE));
  } else if (!hasTile) {
    gEff = 0.0;
  }
  let pix = z * SP.pixScale + SP.pixOrtho;   // world size of one pixel at this depth
  var Rw: f32;
  if (spFlag(SF_NOISE)) {
    Rw = gEff * SP.noiseScale * pix;
  } else {
    Rw = gEff * SP.lightSize;
${withE ? `    // blend toward the H18 noise-driven radius (E in the geometry's roughness byte), more for young histories
    let bE = saturate(SP.noiseBlend + SP.noiseYoung / (1.0 + h.z));
${sv.noiseCap ? `    // (noiseCap: at most noiseCap x the occluder-sized radius; near-hard shadows keep a near-hard kernel)
    Rw = mix(Rw, min(f32(gc.y >> 24u) / 255.0 * SP.noiseScale * pix, ${sv.noiseCapSettled ? 'select(3.0e38, SP.noiseCap * Rw, settled)' : 'SP.noiseCap * Rw'}), bE);`
    : `    Rw = mix(Rw, f32(gc.y >> 24u) / 255.0 * SP.noiseScale * pix, bE);`}` : ''}${sv.backface ? `
    // (backfacePass: the whole light below the horizon, no occluded sample of its own: exact 0, keep it)
    if (h.w <= 0.0 && nl <= -sinL) {${passStore}}` : ''}
${sv.terminatorAnalytic ? `    // (terminatorAnalytic: Heitz et al. 2018 Eq. 4 / 12, the horizon-clipped light belongs to the analytic term) no occluded
    // sample of its own and the light partly below the horizon: the visible fraction of the light's disk above the
    // tangent plane, t = elevation / angular radius in [-1, 1]: 1 - (acos t - t sqrt(1 - t^2)) / pi
    if (h.w <= 0.0 && nl < sinL) {
      let tA = clamp(asin(clamp(nl, -1.0, 1.0)) / asin(clamp(sinL, 1e-6, 1.0)), -1.0, 1.0);
      textureStore(outTex, p, vec4f(1.0 - (acos(tA) - tA * sqrt(max(1.0 - tA * tA, 0.0))) * 0.31830989, 0.0, 0.0, 0.0));
      return;
    }
` : ''}    // self-shadowing terminator (part of the light below the horizon, occluder distance 0):
    // visibility follows n.l, smooth on a flat receiver; the normal weight limits curved ones
    if (h.w <= 0.0 && nl < sinL) { Rw = SP.terminatorPx * pix; }
  }
  let An = saturate(h.z / SP.maxHistory);
  Rw *= SP.radiusScale * mix(1.0, SP.historyShrink, An) * select(1.0, 0.5, PASS == 1) * (1.0 + SP.freshBoost / (1.0 + h.z));
  Rw = max(Rw, SP.minRadiusPx * pix);
  if (Rw < 0.5 * pix) {${tr ? `
    textureStore(outTex, p, vec4f(vin, 0.0, 0.0, 0.0));
    if (tAct) { textureStore(outTr, p, vec4f(tauC, 1.0)); }
    return;
  }` : ` textureStore(outTex, p, vec4f(vin, 0.0, 0.0, 0.0)); return; }`}

  // kernel axes on the tangent plane: T along the light direction projected on the plane
  var T: vec3f;
  var B: vec3f;
  var stretch = 1.0;
  let tl = lv - nv * nl;
  if (dot(tl, tl) > 1e-6 && !spFlag(SF_NOISE)) {
    T = normalize(tl);
    B = cross(nv, T);
    if (spFlag(SF_ANISO)) { stretch = min(1.0 / max(nl, 1e-3), SP.anisoMax); }
  } else {
    let bs = basisOf(nv);
    T = bs[0];
    B = bs[1];
  }
  let c0 = toPixel(X);
  var jT = toPixel(X + T * (Rw * stretch)) - c0;
  var jB = toPixel(X + B * Rw) - c0;
  let maxPx = SP.maxRadiusPx;
  let lT = length(jT);
  let lB = length(jB);
  if (lT > maxPx) { jT *= maxPx / lT; }
  if (lB > maxPx) { jB *= maxPx / lB; }

  // per-pixel rotation: animated 4x4 Bayer (SPEC D3b), a different angle per pass
  // pass offset pass1Phase (default 2 - phi = 0.382 turn, the golden angle): our choice, see the option
  let phi = 6.2831853 * fract(BAYER4[(p.y & 3) * 4 + (p.x & 3)] / 16.0 + f32(F.frameIndex) * SP.rotationStep
    + f32(PASS) * SP.pass1Phase);
  let cs = cos(phi);
  let sn = sin(phi);
  let rot = mat2x2f(cs, sn, -sn, cs);

  // plane distance of a tap (pixel q, depth zt) to the receiver plane, linear in q
  let na = vec3f(dot(nv, SP.A0), dot(nv, SP.Ax), dot(nv, SP.Ay));
  let nb = vec3f(dot(nv, SP.B0), dot(nv, SP.Bx), dot(nv, SP.By));
  let dC = dot(nv, X);
  let invGeoTol = 1.0 / (SP.geoTol * length(X));
  let invNormTol = 1.0 / max(1.0 - SP.normalCos, 1e-4);

  var sum = vin;
  var wsum = 1.0;
${tr ? `  // tau weighted by visibility (M8-6): the ratio of the filtered v tau to the filtered v under the same
  // weights, so v-hat tau-hat is the filtered product; blocked taps carry no colour
  var tsum = vec3f(0.0);   // sum of w v (tau - tau_centre): exact where tau is uniform
  var twsum = vin;
` : ''}${taps.join('')}
${tr ? `  textureStore(outTex, p, vec4f(select(vin, sum / wsum, vAct), 0.0, 0.0, 0.0));
  if (tAct) { textureStore(outTr, p, vec4f(select(tauC, tauC + tsum / twsum, twsum >= 1e-4), 1.0)); }`
    : `  textureStore(outTex, p, vec4f(sum / wsum, 0.0, 0.0, 0.0));`}
}
`;
}

// ---------------------------------------------------------------------------- stabilize

/**
 * Optional output stabilization (option `stabilize` > 0; our design, results/M4.md "Moving shadows"):
 * a short history of the FINAL output, reprojected with the motion vectors, clamped to the 3x3
 * min / max of this frame's spatial output and blended with it by `stabilize`; indirect over the
 * penumbra tiles. It averages the
 * frame-to-frame noise the spatial passes leave in wide penumbrae (each frame's raw sample enters the
 * temporal history with weight 1/(A+1), and the kernel sees it); the box keeps it from lagging a
 * moving shadow by more than the local spread; it fades out where that range exceeds stabilizeBox
 * (full blend below it, none above twice it), so sharp edges keep this frame's value. The temporal history stays raw visibility (no
 * spatial output feeds back into it). Source: the temporal stabilization pass of Zhdan, RTG II
 * ch. 49 Sec. 49.5.7 (prose): an output history of its own that never enters the temporal feedback
 * loop, "logically very close to temporal supersampling with variance color clamping", with anti-lag.
 * Ours (our design, measured): 3x3 min / max box of the current output instead of a variance box, the
 * box-width gate (stabilizeBox) and the clamp-distance anti-lag (stabilizeAntiLag).
 */
export const SHADOW_STABILIZE_WGSL = /* wgsl */ `
${FRAME_WGSL}
${PARAMS_WGSL}
@group(0) @binding(0) var<uniform> F: Frame;
@group(0) @binding(1) var<uniform> SP: ShadowParams;
@group(0) @binding(2) var curTex: texture_2d<f32>;     // this frame's spatial output (penumbra tiles)
@group(0) @binding(3) var boxTex: texture_2d<f32>;     // T: the unfiltered copy in tiles the spatial passes skipped
@group(0) @binding(4) var prevTex: texture_2d<f32>;    // last frame's final output
@group(0) @binding(5) var motionTex: texture_2d<f32>;
@group(0) @binding(6) var histCur: texture_2d<f32>;    // this frame's temporal history (A: 0 = no valid history)
@group(0) @binding(7) var<storage, read> list: array<u32>;
@group(0) @binding(8) var<storage, read> activeTile: array<u32>;
@group(0) @binding(9) var outTex: texture_storage_2d<r32float, write>;   // final output (other tiles: the unfiltered copy)

var<workgroup> sC: array<f32, 100>;   // 10x10: 8x8 tile + 1-px halo of the spatial output

@compute @workgroup_size(8, 8)
fn main(@builtin(local_invocation_id) lid: vec3u, @builtin(local_invocation_index) li: u32, @builtin(workgroup_id) wid: vec3u) {
  // indirect over the penumbra tiles (as the spatial passes); elsewhere the final output already holds
  // the temporal pass's unfiltered copy, which the box clamp would pass through unchanged
  let tile = list[wid.x];
  let t0 = vec2i(i32((tile % SP.tilesX) * 8u), i32((tile / SP.tilesX) * 8u));
  let base = t0 - 1;
  for (var i = li; i < 100u; i += 64u) {
    let q = clampPix(base + vec2i(i32(i % 10u), i32(i / 10u)));
    // halo pixels in tiles the spatial passes skipped: T holds their (exact) unfiltered value there
    if (activeTile[u32(q.y / 8) * SP.tilesX + u32(q.x / 8)] != 0u) { sC[i] = textureLoad(curTex, q, 0).r; }
    else { sC[i] = textureLoad(boxTex, q, 0).r; }
  }
  workgroupBarrier();
  let p = t0 + vec2i(lid.xy);
  if (!inside(p)) { return; }
  let cur = textureLoad(curTex, p, 0).r;
  var lo = cur;
  var hi = cur;
  for (var dy = 0u; dy < 3u; dy++) {
    for (var dx = 0u; dx < 3u; dx++) {
      let v = sC[(lid.y + dy) * 10u + lid.x + dx];
      lo = min(lo, v);
      hi = max(hi, v);
    }
  }
  var v = cur;
  let A = histA(textureLoad(histCur, p, 0).z);
  if (!hasFlag(FRAME_RESET) && A > 0.5) {
    let mv = textureLoad(motionTex, p, 0).xy;
    let pp = (uvOf(p) - vec2f(mv.x, -mv.y) * 0.5) * F.dims - 0.5;
    let b = vec2i(floor(pp));
    let f = pp - floor(pp);
    let h = mix(mix(textureLoad(prevTex, clampPix(b), 0).r, textureLoad(prevTex, clampPix(b + vec2i(1, 0)), 0).r, f.x),
                mix(textureLoad(prevTex, clampPix(b + vec2i(0, 1)), 0).r, textureLoad(prevTex, clampPix(b + vec2i(1, 1)), 0).r, f.x), f.y);
    // only where the 3x3 range is narrow (wide, smooth penumbrae, where the boil is): at sharp edges
    // the range spans the step, the clamp holds nothing back and resampling would blur the edge
    var a = mix(SP.stabilize, 1.0, saturate((hi - lo - SP.stabilizeBox) / max(SP.stabilizeBox, 1e-4)));
    let hc = clamp(h, lo, hi);
    // anti-lag: a history the box had to move (stabilizeAntiLag), or a short temporal history (anti-lag
    // restarts of the temporal pass mark changing penumbrae; stabilizeYoung), takes more of this frame
    a = max(a, saturate(abs(hc - h) * SP.stabilizeAntiLag));
    if (SP.stabilizeYoung > 0.0) { a = max(a, saturate(1.0 - A / SP.stabilizeYoung)); }
    v = mix(hc, cur, a);
  }
  textureStore(outTex, p, vec4f(v, 0.0, 0.0, 0.0));
}
`;

/**
 * The last pass of the translucency variants (SPEC v0.3 §7.10, M8-7; indirect over the filtered tiles):
 * v exactly as SHADOW_STABILIZE_WGSL (same expressions, so with T = 1 the visibility is bit-identical),
 * plus the colour S = v-hat tau-hat: a stabilization history of S (the final output's rgb), clamped per
 * channel to the 3x3 min / max of this frame's S, blended with v's weight (`TR_OWN_GATE`: raised by S's
 * own box-width gate and clamp-distance anti-lag, so a sharp coloured edge over uniform v isn't
 * TAA-blurred). Tau-only tiles pass v through (its stabilization history keeps the unfiltered copy);
 * v-only tiles take S = v tau with tau unfiltered. `compose`: no history, S = v-hat tau-hat only.
 * Writes the final output (rgba16float: S rgb, v) and, wide path, v's own r32float history.
 */
export function shadowStabilizeTrWgsl(tr: TrVariant, tauTiles = true): string {
  const packed = tr.packed;
  const compose = !!tr.compose;
  const vp = packed ? 'a' : 'r';   // channel of v in the previous final output / history
  const bind: string[] = [
    '@group(0) @binding(0) var<uniform> F: Frame;',
    '@group(0) @binding(1) var<uniform> SP: ShadowParams;',
    '@group(0) @binding(2) var curTex: texture_2d<f32>;     // this frame\'s spatial output (v filtered tiles)',
    '@group(0) @binding(3) var boxTex: texture_2d<f32>;     // T: the unfiltered copy elsewhere',
    `@group(0) @binding(4) var prevTex: texture_2d<f32>;    // last frame's ${packed ? 'final output (S rgb, v)' : 'v (stabilized)'}`,
    '@group(0) @binding(5) var motionTex: texture_2d<f32>;',
    `@group(0) @binding(6) var histCur: ${packed ? 'texture_2d<u32>' : 'texture_2d<f32>'};`,
    '@group(0) @binding(7) var<storage, read> list: array<u32>;',
    '@group(0) @binding(8) var<storage, read> activeTile: array<u32>;',
  ];
  if (packed) {
    bind.push('@group(0) @binding(9) var outF: texture_storage_2d<rgba16float, write>;   // final output (S rgb, v)');
    bind.push('@group(0) @binding(10) var trCur: texture_2d<f32>;   // filtered tau (tau tiles)');
  } else {
    if (!compose) bind.push('@group(0) @binding(9) var outTex: texture_storage_2d<r32float, write>;   // v (stabilized; its history)');
    bind.push('@group(0) @binding(10) var trHist: texture_2d<f32>;   // tau history (unfiltered tau)');
    bind.push('@group(0) @binding(11) var trCur: texture_2d<f32>;    // filtered tau (tau tiles)');
    if (!compose) bind.push('@group(0) @binding(12) var prevF: texture_2d<f32>;    // last frame\'s final output (S rgb, v)');
    bind.push('@group(0) @binding(13) var outF: texture_storage_2d<rgba16float, write>;   // final output (S rgb, v)');
  }
  const prevS = packed ? 'prevTex' : 'prevF';
  const tauHist = packed
    ? `fn tauHist(q: vec2i) -> vec3f {
  let hu = textureLoad(histCur, q, 0);
  return vec3f(unpack2x16float(hu.z), unpack2x16float(hu.w).x);
}
fn histAt(q: vec2i) -> f32 { return histA(unpack2x16float(textureLoad(histCur, q, 0).y).x); }`
    : `fn tauHist(q: vec2i) -> vec3f { return textureLoad(trHist, q, 0).rgb; }
fn histAt(q: vec2i) -> f32 { return histA(textureLoad(histCur, q, 0).z); }`;
  const tileOf = (q: string) => `activeTile[u32(${q}.y / 8) * SP.tilesX + u32(${q}.x / 8)]`;
  if (compose) {
    return /* wgsl */ `
${FRAME_WGSL}
${paramsWgsl(true)}
${bind.join('\n')}
${tauHist}

@compute @workgroup_size(8, 8)
fn main(@builtin(local_invocation_id) lid: vec3u, @builtin(workgroup_id) wid: vec3u) {
  let tile = list[wid.x];
  let p = vec2i(i32((tile % SP.tilesX) * 8u + lid.x), i32((tile / SP.tilesX) * 8u + lid.y));
  if (!inside(p)) { return; }
  let mode = activeTile[tile];
  let v = textureLoad(curTex, p, 0).r;
  var t = tauHist(p);
  if ((mode & 2u) != 0u) { t = textureLoad(trCur, p, 0).rgb; }
  textureStore(outF, p, vec4f(v * t, v));
}
`;
  }
  return /* wgsl */ `
${FRAME_WGSL}
${paramsWgsl(true)}
${bind.join('\n')}
${tauHist}

var<workgroup> sC: array<f32, 100>;     // 10x10: 8x8 tile + 1-px halo of the spatial output (v)
var<workgroup> sS: array<vec3f, 100>;   // the same for S = v-hat tau-hat

@compute @workgroup_size(8, 8)
fn main(@builtin(local_invocation_id) lid: vec3u, @builtin(local_invocation_index) li: u32, @builtin(workgroup_id) wid: vec3u) {
  let tile = list[wid.x];
  let mode = activeTile[tile];
  let t0 = vec2i(i32((tile % SP.tilesX) * 8u), i32((tile / SP.tilesX) * 8u));
  let base = t0 - 1;
  for (var i = li; i < 100u; i += 64u) {
    let q = clampPix(base + vec2i(i32(i % 10u), i32(i / 10u)));
    let at = ${tileOf('q')};
    // halo pixels in tiles the spatial passes didn't filter: T / the tau history hold their unfiltered value
    var vq: f32;
    if ((at & 1u) != 0u) { vq = textureLoad(curTex, q, 0).r; }
    else { vq = textureLoad(boxTex, q, 0).r; }
    sC[i] = vq;
    // the colour's box only in tau tiles (v-only tiles take S = v tau below)
    if (${tauTiles ? 'true' : 'false'}) {
      var tq: vec3f;
      if ((at & 2u) != 0u) { tq = textureLoad(trCur, q, 0).rgb; }
      else { tq = tauHist(q); }
      sS[i] = vq * tq;
    }
  }
  workgroupBarrier();
  let p = t0 + vec2i(lid.xy);
  if (!inside(p)) { return; }
  let vAct = (mode & 1u) != 0u;
  let tAct = ${tauTiles ? 'true' : 'false'};   // dispatched over the tau tiles or the v-only tiles
  let cur = textureLoad(curTex, p, 0).r;
  var lo = cur;
  var hi = cur;
  let sCur = sS[(lid.y + 1u) * 10u + lid.x + 1u];
  var sLo = sCur;
  var sHi = sCur;
  for (var dy = 0u; dy < 3u; dy++) {
    for (var dx = 0u; dx < 3u; dx++) {
      let v = sC[(lid.y + dy) * 10u + lid.x + dx];
      lo = min(lo, v);
      hi = max(hi, v);
      let s = sS[(lid.y + dy) * 10u + lid.x + dx];
      sLo = min(sLo, s);
      sHi = max(sHi, s);
    }
  }
  var v = cur;
  var S = sCur;
  let A = histAt(p);
  if (!hasFlag(FRAME_RESET) && A > 0.5) {
    let mv = textureLoad(motionTex, p, 0).xy;
    let pp = (uvOf(p) - vec2f(mv.x, -mv.y) * 0.5) * F.dims - 0.5;
    let b = vec2i(floor(pp));
    let f = pp - floor(pp);
    let h = mix(mix(textureLoad(prevTex, clampPix(b), 0).${vp}, textureLoad(prevTex, clampPix(b + vec2i(1, 0)), 0).${vp}, f.x),
                mix(textureLoad(prevTex, clampPix(b + vec2i(0, 1)), 0).${vp}, textureLoad(prevTex, clampPix(b + vec2i(1, 1)), 0).${vp}, f.x), f.y);
    var a = mix(SP.stabilize, 1.0, saturate((hi - lo - SP.stabilizeBox) / max(SP.stabilizeBox, 1e-4)));
    let hc = clamp(h, lo, hi);
    a = max(a, saturate(abs(hc - h) * SP.stabilizeAntiLag));
    if (SP.stabilizeYoung > 0.0) { a = max(a, saturate(1.0 - A / SP.stabilizeYoung)); }
    v = mix(hc, cur, a);
    if (tAct) {
      let sh = mix(mix(textureLoad(${prevS}, clampPix(b), 0).rgb, textureLoad(${prevS}, clampPix(b + vec2i(1, 0)), 0).rgb, f.x),
                   mix(textureLoad(${prevS}, clampPix(b + vec2i(0, 1)), 0).rgb, textureLoad(${prevS}, clampPix(b + vec2i(1, 1)), 0).rgb, f.x), f.y);
      let shc = clamp(sh, sLo, sHi);
      var aS = a;
      if (trFlag(TR_OWN_GATE)) { aS = max(aS, mix(SP.stabilize, 1.0, saturate((max3(sHi - sLo) - SP.stabilizeBox) / max(SP.stabilizeBox, 1e-4)))); }
      if (trFlag(TR_OWN_ANTILAG)) { aS = max(aS, saturate(max3(abs(shc - sh)) * SP.stabilizeAntiLag)); }
      S = shc + aS * (sCur - shc);
    }
  }
  // tau-only tiles: v passes through (as in the opaque denoiser, which doesn't filter there)
  let vOut = select(cur, v, vAct);
  if (!tAct) { S = vOut * tauHist(p); }
${packed ? '' : `  if (vAct) { textureStore(outTex, p, vec4f(v, 0.0, 0.0, 0.0)); }
`}  textureStore(outF, p, vec4f(S, vOut));
}
`;
}
