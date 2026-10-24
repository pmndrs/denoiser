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
//   floored at one pixel). Rewritten for a hit distance h and receiver-light distance D:
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
//   tile, no random offset), accumulated over time instead of the paper's 3x3 box.
// - Our designs (tuned on the test bed, docs/research/rt-denoiser/results/M4.md §3): clamp
//   window 0.4 sigma (about 2 standard errors of the 5x5 mean; SPEC's 1 sigma never fires on
//   binary samples), anti-lag restart at the current frame when the clamp moves the history,
//   exact value when all 25 samples agree, history cap ~ (penumbra width in px)^2 against
//   reprojection blur, analytic terminator radius (light partly below the horizon), affine
//   reprojection taps (plane distance linear in the tap pixel).
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
export const SF_CATMULL = 64;
export const SF_SNAP = 128;      // uniform 5x5 neighbourhood: history := its value    // Catmull-Rom history for visibility when the 2x2 footprint is valid

/** Size of ShadowParams in bytes. */
export const SP_SIZE = 88 * 4;

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
  antiLagHistory: f32, freshBoost: f32, q1: f32, q2: f32,
  terminatorPx: f32, historyScale: f32, minHistory: f32, historyShrink: f32,
  PA0: vec3f, r0: f32,   // the same affine form for the previous frame's projection
  PAx: vec3f, r1: f32,
  PAy: vec3f, r2: f32,
  PB0: vec3f, r3: f32,
  PBx: vec3f, r4: f32,
  PBy: vec3f, r5: f32,
}
fn spFlag(f: u32) -> bool { return (SP.flags & f) != 0u; }
const SF_SPHERE = ${SF_SPHERE}u;
const SF_NOISE = ${SF_NOISE}u;
const SF_ANISO = ${SF_ANISO}u;
const SF_NO_SKIP = ${SF_NO_SKIP}u;
const SF_MERGE_MIN = ${SF_MERGE_MIN}u;
const SF_HAS_HIT = ${SF_HAS_HIT}u;
const SF_CATMULL = ${SF_CATMULL}u;
const SF_SNAP = ${SF_SNAP}u;
const G_INF = 0x7f800000u;   // +inf bits: "no occluder estimate"
`;

const TILE = 8;

// ---------------------------------------------------------------------------- temporal

export function shadowTemporalWgsl(depthIsDepthFormat: boolean): string {
  const depthDecl = depthIsDepthFormat ? 'texture_depth_2d' : 'texture_2d<f32>';
  const depthLoad = depthIsDepthFormat ? 'textureLoad(depthTex, p, 0)' : 'textureLoad(depthTex, p, 0).r';
  // 5x5 neighbourhood of raw visibility from the shared 12x12 tile (unrolled)
  const nb: string[] = [];
  for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) {
    nb.push(`  { let s = sV[(l.y + ${y}) * 12 + l.x + ${x}]; m1 += s; m2 += s * s; }`);
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
  for (var k = 0; k < 4; k++) {
    let q = r.base + TAP_OFFS[k];
    let gt = textureLoad(geoPrev, clampPix(q), 0).xy;
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
  r.allValid = all(valid > vec4f(0.5));
  return r;
}

fn rawVis(p: vec2i) -> f32 { return clamp(textureLoad(visTex, clampPix(p), 0).r, 0.0, 1.0); }

var<workgroup> sV: array<f32, 144>;     // raw visibility, 12x12 = tile + 2-px halo
var<workgroup> wgMinG: atomic<u32>;     // min penumbra scale over the tile (f32 bits, >= 0)
var<workgroup> wgFlags: atomic<u32>;    // 1 fractional history, 2 raw < 1, 4 raw > 0

@compute @workgroup_size(${TILE}, ${TILE})
fn main(@builtin(global_invocation_id) gid: vec3u, @builtin(local_invocation_id) lid: vec3u,
        @builtin(local_invocation_index) li: u32, @builtin(workgroup_id) wid: vec3u) {
  let base = vec2i(wid.xy) * ${TILE} - 2;
  for (var i = li; i < 144u; i += 64u) {
    sV[i] = rawVis(base + vec2i(i32(i % 12u), i32(i / 12u)));
  }
  if (li == 0u) { atomicStore(&wgMinG, G_INF); atomicStore(&wgFlags, 0u); }
  workgroupBarrier();

  let p = vec2i(gid.xy);
  let l = vec2u(lid.xy);
  if (inside(p)) {
    var g: Geo;
    g.z = linZ(p);
    g.n = vec3f(0.0, 0.0, 1.0);
    g.grad = vec2f(0.0);
    g.rough = 0.0;
    let nIn = textureLoad(normalTex, p, 0).xyz;
    if (dot(nIn, nIn) < 0.01) { g.z = 0.0; }
    let vRaw = sV[(l.y + 2u) * 12u + l.x + 2u];
    var vAcc = vRaw;
    var hist = vec4f(vRaw, 0.0, 0.0, 0.0);
    if (g.z > 0.0) {
      g.n = normalize(nIn);
      // ---- reproject (shared core rules, affine form)
      let r = reprojFast(p, g);
      var A = -1.0;
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
        for (var k = 0; k < 4; k++) {
          let hk = textureLoad(histPrev, clampPix(r.base + TAP_OFFS[k]), 0);
          acc += hk * w[k];
          lo = min(lo, hk.x);
          hi = max(hi, hk.x);
          let hasG = select(0.0, w[k], hk.w > 0.0);
          gs += vec2f(hk.y * hasG, hasG);
        }
        acc *= ws;
        vH = acc.x;
        if (spFlag(SF_CATMULL) && r.allValid) {
          // sharper resampling: repeated bilinear reprojection blurs narrow penumbrae
          vH = clamp(sampleCatmullRom(histPrev, smp, r.prevUV).x, lo, hi);
        }
        A = acc.z;
        nW = acc.w;
        gH = select(0.0, gs.x / gs.y, gs.y > 0.0);
      }
      // ---- neighbourhood clamp on raw visibility (5x5 mean +- gamma sigma)
      var m1 = 0.0;
      var m2 = 0.0;
${nb.join('\n')}
      let mu = m1 / 25.0;
      let sigma = sqrt(max(m2 / 25.0 - mu * mu, 0.0));
      let win = SP.clampSigma * sigma + SP.clampFloor;
      var vC = clamp(vH, mu - win, mu + win);
      if (A >= 0.0) {
        // anti-lag (our design): a history the clamp had to move is short-lived
        let c = saturate(abs(vC - vH) * SP.antiLag);
        A = mix(A, min(A, SP.antiLagHistory), c);
      }
      // all 25 samples agree: take their value exactly, keep the history length (the floor
      // above only decides whether this is a change worth restarting for)
      if (sigma == 0.0 && spFlag(SF_SNAP)) { vC = mu; }
      // ---- penumbra scale sample: W = lightSize * gS (M12 Eq. 13 rewritten for h)
      var gS = -1.0;
      if (spFlag(SF_NOISE)) {
        // Heitz 2018 Eq. 29 on the 5x5 tile: |d2v/dt2| along 4 lines through the centre
        let c0 = i32((l.y + 2u) * 12u + l.x + 2u);
        var e = 0.0;
        for (var d = 0; d < 4; d++) {
          let st = array<i32, 4>(1, 12, 13, 11)[d];   // -, |, \\, / through the centre
          for (var k = -1; k <= 1; k++) {
            let c = c0 + k * st;
            e += abs(sV[c - st] - 2.0 * sV[c] + sV[c + st]);
          }
        }
        gS = e / 24.0;   // [0, 1]
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
      if (nWn > 0.0 && !spFlag(SF_NOISE) && SP.historyScale > 0.0) {
        let wPx = SP.lightSize * gAcc / (g.z * SP.pixScale + SP.pixOrtho);
        cap = clamp(SP.historyScale * wPx * wPx, SP.minHistory, SP.maxHistory);
      }
      let An = min(A, cap) + 1.0;   // 0 after a disocclusion
      vAcc = mix(vC, vRaw, 1.0 / (1.0 + An));
      hist = vec4f(vAcc, gAcc, An, nWn);

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
    textureStore(outT, p, vec4f(vAcc, 0.0, 0.0, 0.0));
    textureStore(outV, p, vec4f(vAcc, 0.0, 0.0, 0.0));
  }
  workgroupBarrier();
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
  if (isActive) {
    let k = atomicAdd(&args[0], 1u);
    list[k] = idx;
  }
}
`;

// ---------------------------------------------------------------------------- spatial

/** pass 0 reads the accumulated history (.x), pass 1 the previous pass's output. */
export function shadowSpatialWgsl(pass: 0 | 1, normalWeight = true): string {
  const taps: string[] = [];
  for (let i = 0; i < 8; i++) {
    taps.push(/* wgsl */ `
  {
    let o = rot * DISK[${i}];
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
  }
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
  let h = textureLoad(histCur, p, 0);

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
  let phi = 6.2831853 * fract(BAYER4[(p.y & 3) * 4 + (p.x & 3)] / 16.0 + f32(F.frameIndex) * 0.6180339887
    + f32(PASS) * 0.3819660113);
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
