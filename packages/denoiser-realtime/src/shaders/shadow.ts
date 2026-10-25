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

/** Size of ShadowParams in bytes. */
export const SP_SIZE = 96 * 4;

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
  stabilizeBox: f32, stabilizeAntiLag: f32, stabilizeYoung: f32, q3: f32,
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

const TILE = 8;

// ---------------------------------------------------------------------------- temporal

/**
 * `young`: the young-history pipeline variant (option youngMean > 0: geometry-weighted mean
 * over (2 youngRadius + 1)^2 pixels, depths loaded per young pixel; the shared visibility
 * tile's halo grows to max(2, youngRadius)).
 */
export function shadowTemporalWgsl(depthIsDepthFormat: boolean, young = false, youngRadius = 2, withE = false, clampGeo = false): string {
  const HB = young ? Math.max(2, youngRadius) : 2;   // halo
  const SW = TILE + 2 * HB;                            // shared tile width
  const YR = young ? youngRadius : 2;
  const depthDecl = depthIsDepthFormat ? 'texture_depth_2d' : 'texture_2d<f32>';
  const depthLoad = depthIsDepthFormat ? 'textureLoad(depthTex, p, 0)' : 'textureLoad(depthTex, p, 0).r';
  // 5x5 neighbourhood of raw visibility from the shared tile (unrolled)
  const nb: string[] = [];
  const nbG: string[] = [];
  for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) {
    const idx = `(l.y + ${y + HB - 2}u) * ${SW}u + l.x + ${x + HB - 2}u`;
    nb.push(`  { let s = sV[${idx}]; m1 += s; m2 += s * s; }`);
    if (!clampGeo) continue;
    // taps whose normal is within normalAngle of the receiver's vote (sky: normal 0, never)
    // (unpack + dot beat dot4I8Packed on the M5 Pro: no native 4x8 dot there)
    nbG.push(`        { let s = sV[${idx}]; let w = select(0.0, 1.0, dot(cN, unpack4x8snorm(sN[${idx}])) >= cCos); m0 += w; m1 += w * s; m2 += w * s * s; }`);
  }
  return /* wgsl */ `
${FRAME_WGSL}
${PARAMS_WGSL}
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
@group(0) @binding(10) var histPrev: texture_2d<f32>;
@group(0) @binding(11) var outGeo: texture_storage_2d<rg32uint, write>;
@group(0) @binding(12) var outHist: texture_storage_2d<rgba16float, write>;
@group(0) @binding(13) var outT: texture_storage_2d<r32float, write>;
@group(0) @binding(14) var outV: texture_storage_2d<r32float, write>;
@group(0) @binding(15) var<storage, read_write> tileStats: array<vec2u>;
@group(0) @binding(16) var smp: sampler;

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
fn reprojFast(p: vec2i, g: Geo) -> Reproj {
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
    valid[k] = select(0.0, 1.0, inside(q) && dt > 0.0 && dot(g.n, nqf) > 0.0 && abs(pd) <= tol);
  }
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
      e += abs(sV[c - st] - 2.0 * sV[c] + sV[c + st]);
    }
  }
  return e / 24.0;
}

fn rawVis(p: vec2i) -> f32 { return clamp(textureLoad(visTex, clampPix(p), 0).r, 0.0, 1.0); }

var<workgroup> sV: array<f32, ${SW * SW}>;     // raw visibility, ${SW}x${SW} = tile + ${HB}-px halo
${clampGeo ? `var<workgroup> sN: array<u32, ${SW * SW}>;     // unit world normal, pack4x8snorm (0 = sky / none), same tile` : ''}
var<workgroup> wgMinG: atomic<u32>;     // min penumbra scale over the tile (f32 bits, >= 0)
var<workgroup> wgFlags: atomic<u32>;    // 1 fractional history, 2 raw < 1, 4 raw > 0
${clampGeo ? `var<workgroup> wgHi: atomic<u32>;       // max raw visibility over the shared tile (f32 bits; zero-initialized)
var<workgroup> wgLoInv: atomic<u32>;    // max of 1 - raw visibility
var<workgroup> wgMixed: u32;            // the shared tile's raw samples disagree (normal tile loaded)` : ''}

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
${clampGeo ? `  atomicMax(&wgHi, bitcast<u32>(tHi));
  atomicMax(&wgLoInv, bitcast<u32>(1.0 - tLo));
  workgroupBarrier();
  if (li == 0u) { wgMixed = select(0u, 1u, bitcast<f32>(atomicLoad(&wgHi)) > 1.0 - bitcast<f32>(atomicLoad(&wgLoInv))); }
  // normal tile only where the raw samples disagree somewhere in it (elsewhere every
  // 5x5 subset agrees and the geometry test can't change anything)
  let mixedTile = workgroupUniformLoad(&wgMixed) != 0u;
  if (mixedTile) {
    for (var i = li; i < ${SW * SW}u; i += 64u) {
      let q = clampPix(base + vec2i(i32(i % ${SW}u), i32(i / ${SW}u)));
      let nq = textureLoad(normalTex, q, 0).xyz;
      sN[i] = pack4x8snorm(vec4f(nq * inverseSqrt(max(dot(nq, nq), 1e-12)), 0.0));
    }
  }` : ''}
  workgroupBarrier();

  let p = vec2i(gid.xy);
  let l = vec2u(lid.xy);
  var vAcc = 0.0;
  var yW = 0.0;        // young-history weight of the 5x5 mean (0 = not young / off)
  var gOwn = -1.0;     // own penumbra-scale estimate (-1 = none)
  var pixW = 1.0;      // world size of one pixel at this depth
  if (inside(p)) {
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
      var vH = 0.0;
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
        for (var k = 0; k < 4; k++) {
          var hk = textureLoad(histPrev, clampPix(r.base + TAP_OFFS[k]), 0);
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
          vH = clamp(sampleCatmullRom(histPrev, smp, r.prevUV).x, lo, hi);
        }
        A = acc.z;
        nW = acc.w;
        gH = select(0.0, gs.x / gs.y, gs.y > 0.0);
      }
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
      }
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
      if (A >= 0.0) {
        // anti-lag (our design): a history the clamp had to move is short-lived
        let c = saturate(abs(vC - vH) * SP.antiLag);
        A = mix(A, min(A, SP.antiLagHistory), c);
      }
      // all 25 samples agree: take their value exactly, keep the history length (the floor
      // above only decides whether this is a change worth restarting for)
      // (SF_SNAP_CHANGE: only where the clamp fired, i.e. after a change such as a light flip;
      // a steady outer penumbra keeps its fractional history)
      if (sigma == 0.0 && spFlag(SF_SNAP) && (!spFlag(SF_SNAP_CHANGE) || abs(vH - mu) > win)) { vC = mu; }
      let An = min(A, cap) + 1.0;   // 0 after a disocclusion
      vAcc = mix(vC, vRaw, 1.0 / (1.0 + An));
      // young-frames counter (v2.1, our design): youngFrames on a fresh pixel (no valid history),
      // one less per frame, carried in the A channel above youngBase; unlike A it is not shortened
      // by the history cap or by anti-lag, so it marks "recently new", not "short history"
      let yN = select(max(round(yPrev) - 1.0, 0.0), SP.youngFrames, An == 0.0);
      hist = vec4f(vAcc, gAcc, An + SP.youngBase * yN, nWn);
${withE ? `      // H18 noise estimate E for the radius blend (noiseBlend / noiseYoung), accumulated like g
      // over at most maxWHistory + 1 frames and stored in the geometry's 8-bit roughness slot
      let eCur = noiseE(l);
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
      if (fl != 0u) { atomicOr(&wgFlags, fl); }
    }
    textureStore(outGeo, p, vec4u(packGeoTap(g), 0u, 0u));
    textureStore(outHist, p, hist);
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
    textureStore(outV, p, vec4f(vOut, 0.0, 0.0, 0.0));
  }
  if (li == 0u) {
    tileStats[wid.y * SP.tilesX + wid.x] = vec2u(atomicLoad(&wgMinG), atomicLoad(&wgFlags));
  }
}
`;
}

// ---------------------------------------------------------------------------- tiles

export const SHADOW_TILES_WGSL = /* wgsl */ `
${PARAMS_WGSL}
@group(0) @binding(0) var<uniform> SP: ShadowParams;
@group(0) @binding(1) var<storage, read> tileStats: array<vec2u>;
@group(0) @binding(2) var<storage, read_write> tileMinG: array<u32>;
@group(0) @binding(3) var<storage, read_write> args: array<atomic<u32>>;   // [count, 1, 1]
@group(0) @binding(4) var<storage, read_write> list: array<u32>;
@group(0) @binding(5) var<storage, read_write> activeTile: array<u32>;   // 1 = in the list (stabilize's box source)

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
  activeTile[idx] = select(0u, 1u, isActive);
  if (isActive) {
    let k = atomicAdd(&args[0], 1u);
    list[k] = idx;
  }
}
`;

// ---------------------------------------------------------------------------- spatial

/**
 * pass 0 reads the temporal pass's unfiltered copy (`out`), pass 1 the previous pass's output (T).
 * Variant `withE`: radius blended toward the H18 noise radius.
 */
export function shadowSpatialWgsl(pass: 0 | 1, normalWeight = true, withE = false): string {
  const taps: string[] = [];
  const tap = (i: number, r: string) => taps.push(/* wgsl */ `
  {
    let o = ${r} * DISK[${i}];
    let qf = pc + o.x * jT + o.y * jB;
    let q = vec2i(floor(qf));
    let qc = clampPix(q);
    let gt = textureLoad(geoCur, qc, 0).xy;
    let vt = textureLoad(srcTex, qc, 0).r;
    let zt = bitcast<f32>(gt.x);
${normalWeight ? `    let nt = octDecode(vec2f(f32(gt.y & 4095u), f32((gt.y >> 12u) & 4095u)) / 4095.0 * 2.0 - 1.0);` : ''}
    let qp = vec2f(qc) + 0.5;
    let pd = abs(na.x + na.y * qp.x + na.z * qp.y + zt * (nb.x + nb.y * qp.x + nb.z * qp.y) - dC);
    let wg = W1(pd * invGeoTol);
    let wn = ${normalWeight ? 'W1((1.0 - dot(n, nt)) * invNormTol)' : '1.0'};
    let w = select(0.0, wg * wn, inside(q) && zt > 0.0);
    sum += w * vt;
    wsum += w;
  }`);
  for (let i = 0; i < 8; i++) tap(i, 'rot');
  return /* wgsl */ `
${FRAME_WGSL}
${PARAMS_WGSL}
@group(0) @binding(0) var<uniform> F: Frame;
@group(0) @binding(1) var<uniform> SP: ShadowParams;
@group(0) @binding(2) var geoCur: texture_2d<u32>;
@group(0) @binding(3) var histCur: texture_2d<f32>;
@group(0) @binding(4) var srcTex: texture_2d<f32>;
@group(0) @binding(5) var<storage, read> tileMinG: array<u32>;
@group(0) @binding(6) var<storage, read> list: array<u32>;
@group(0) @binding(7) var outTex: texture_storage_2d<r32float, write>;

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
  let vin = textureLoad(srcTex, p, 0).r;
  if (z <= 0.0) { textureStore(outTex, p, vec4f(vin, 0.0, 0.0, 0.0)); return; }
  var h = textureLoad(histCur, p, 0);
  h.z = histA(h.z);

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
    Rw = mix(Rw, f32(gc.y >> 24u) / 255.0 * SP.noiseScale * pix, bE);` : ''}
    // self-shadowing terminator (part of the light below the horizon, occluder distance 0):
    // visibility follows n.l, smooth on a flat receiver; the normal weight limits curved ones
    if (h.w <= 0.0 && nl < sinL) { Rw = SP.terminatorPx * pix; }
  }
  let An = saturate(h.z / SP.maxHistory);
  Rw *= SP.radiusScale * mix(1.0, SP.historyShrink, An) * select(1.0, 0.5, PASS == 1) * (1.0 + SP.freshBoost / (1.0 + h.z));
  Rw = max(Rw, SP.minRadiusPx * pix);
  if (Rw < 0.5 * pix) { textureStore(outTex, p, vec4f(vin, 0.0, 0.0, 0.0)); return; }

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
${taps.join('')}
  textureStore(outTex, p, vec4f(sum / wsum, 0.0, 0.0, 0.0));
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
