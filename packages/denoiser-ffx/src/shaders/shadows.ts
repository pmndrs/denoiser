// WGSL port of the AMD FidelityFX Denoiser — shadows (FidelityFX SDK v1.1.4):
//   sdk/include/FidelityFX/gpu/denoiser/ffx_denoiser_shadows_prepare.h
//   sdk/include/FidelityFX/gpu/denoiser/ffx_denoiser_shadows_tileclassification.h
//   sdk/include/FidelityFX/gpu/denoiser/ffx_denoiser_shadows_filter.h
//   sdk/include/FidelityFX/gpu/denoiser/ffx_denoiser_shadows_util.h
//   sdk/include/FidelityFX/gpu/denoiser/ffx_denoiser_shadows_callbacks_glsl.h
//   sdk/src/backends/vk/shaders/denoiser/ffx_denoiser_*shadow*_pass.glsl
//
// This file is part of the FidelityFX SDK.
//
// Copyright (C) 2024 Advanced Micro Devices, Inc.
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files(the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and /or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions :
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
// THE SOFTWARE.
//
// Port notes (deviations from the HLSL/GLSL source, all behavior-preserving
// unless stated):
// - Wave intrinsics: ffxWaveOr (prepare) -> workgroup atomicOr; ffxWaveAllTrue
//   (tile classification) -> the source's own LDS fallback path, made uniform
//   with workgroupUniformLoad; ffxQuadReadX/Y (closest velocity) -> workgroup
//   memory exchange with the x^1 / y^1 neighbor (ffxRemapForWaveReduction only
//   exists to make quads out of wave lanes, so lanes map 1:1 to the 8x8 tile).
// - FFX_HALF: the source's filter only has an fp16 path (the fp32 path is a
//   stub). Here everything is fp32 (no shader-f16 requirement); LDS holds
//   f32 instead of packed half2.
// - Prepare: the source packs a per-8x4-tile *ray hit* bitmask written by the
//   ray tracer. Our input is per-pixel visibility, so prepare thresholds it
//   (visibility >= threshold -> lit bit) and also copies depth into an r32float
//   ping-pong pair (replacing the host-side "copy depth -> previous depth" job,
//   and letting every later pass read a plain float texture whatever the
//   caller's depth format).
// - Uniformity: tile metadata is broadcast through workgroupUniformLoad so the
//   filter's LDS barrier stays in uniform control flow.

export const PARAMS_WGSL = /* wgsl */ `
struct Params {
  projInv: mat4x4f,
  reproj: mat4x4f,
  viewProjInv: mat4x4f,
  eye: vec3f,
  firstFrame: i32,
  dims: vec2i,
  invDims: vec2f,
  mvScale: vec2f,
  normUnpack: vec2f,
  depthSigma: f32,
  invertedDepth: u32,
  visThreshold: f32,
  _pad: f32,
};
@group(0) @binding(0) var<uniform> P: Params;

fn tileCountX() -> u32 { return (u32(P.dims.x) + 7u) / 8u; }
fn roundedDivide(v: u32, d: u32) -> u32 { return (v + d - 1u) / d; }
fn tileIndexFromPixel(p: vec2u) -> vec2u { return vec2u(p.x / 8u, p.y / 4u); }
fn linearTileIndex(t: vec2u) -> u32 { return t.y * tileCountX() + t.x; }
fn bitMaskFromPixel(p: vec2u) -> u32 { return 1u << ((p.y % 4u) * 8u + (p.x % 8u)); }

const TILE_META_DATA_CLEAR_MASK: u32 = 1u;
const TILE_META_DATA_LIGHT_MASK: u32 = 2u;

// Port addition: sky / unwritten normals (0,0,0) must not become NaN filter weights.
fn safeNormalize(n: vec3f) -> vec3f {
  let l2 = dot(n, n);
  return select(vec3f(0.0, 0.0, 1.0), n * inverseSqrt(l2), l2 > 1e-12);
}

fn linearDepth(did: vec2f, depth: f32) -> f32 {
  let uv = (did + 0.5) * P.invDims;
  let ndc = 2.0 * vec2f(uv.x, 1.0 - uv.y) - 1.0;
  let projected = P.projInv * vec4f(ndc, depth, 1.0);
  return abs(projected.z / projected.w);
}
`;

/** Prepare: per-pixel visibility -> 8x4 tile bitmask (bit = lit) + depth copy. */
export function prepareWgsl(depthIsDepthFormat: boolean) {
  return /* wgsl */ `
${PARAMS_WGSL}
@group(0) @binding(1) var t_vis: texture_2d<f32>;
@group(0) @binding(2) var t_depth: ${depthIsDepthFormat ? 'texture_depth_2d' : 'texture_2d<f32>'};
@group(0) @binding(3) var o_depth: texture_storage_2d<r32float, write>;
@group(0) @binding(4) var<storage, read_write> shadow_mask: array<u32>;

var<workgroup> wg_mask: atomic<u32>;

@compute @workgroup_size(8, 4)
fn main(@builtin(local_invocation_id) lid: vec3u, @builtin(workgroup_id) gid: vec3u,
        @builtin(local_invocation_index) li: u32) {
  if (li == 0u) { atomicStore(&wg_mask, 0u); }
  workgroupBarrier();
  let dims = vec2u(P.dims);
  let did = gid.xy * vec2u(8u, 4u) + lid.xy;
  let p = min(did, dims - 1u);
  let d = ${depthIsDepthFormat ? 'textureLoad(t_depth, p, 0)' : 'textureLoad(t_depth, p, 0).r'};
  if (all(did < dims)) { textureStore(o_depth, did, vec4f(d, 0.0, 0.0, 0.0)); }
  // FFX: lane_mask = hit_light ? bit : 0; StoreShadowMask(tile, WaveOr(lane_mask))
  if (textureLoad(t_vis, p, 0).r >= P.visThreshold) {
    atomicOr(&wg_mask, 1u << (lid.y * 8u + lid.x));
  }
  workgroupBarrier();
  if (li == 0u) { shadow_mask[gid.y * tileCountX() + gid.x] = atomicLoad(&wg_mask); }
}
`;
}

function kernelWeights() {
  // KERNEL_WEIGHT(i) = exp(-3 i^2 / (KERNEL_RADIUS + 1)^2), normalized over [-8, 8]
  const R = 8;
  const kw = (i: number) => Math.exp((-3 * i * i) / ((R + 1) * (R + 1)));
  let sum = kw(0);
  for (let c = 1; c <= R; c++) sum += 2 * kw(c);
  return Array.from({ length: R + 1 }, (_, i) => (kw(i) / sum).toPrecision(9));
}

/** Tile classification: temporal reprojection, moments, local-neighborhood clamp. */
export const TILE_CLASSIFICATION_WGSL = /* wgsl */ `
${PARAMS_WGSL}
@group(0) @binding(1) var t_depth: texture_2d<f32>;
@group(0) @binding(2) var t_velocity: texture_2d<f32>;
@group(0) @binding(3) var t_normal: texture_2d<f32>;
@group(0) @binding(4) var t_history: texture_2d<f32>;
@group(0) @binding(5) var t_prev_depth: texture_2d<f32>;
@group(0) @binding(6) var t_prev_moments: texture_2d<f32>;
@group(0) @binding(7) var s_linear: sampler;
@group(0) @binding(8) var<storage, read_write> tile_metadata: array<u32>;
@group(0) @binding(9) var o_reprojection: texture_storage_2d<rgba16float, write>;
@group(0) @binding(10) var o_moments: texture_storage_2d<rgba16float, write>;
@group(0) @binding(11) var<storage, read> shadow_mask: array<u32>;

const KW = array<f32, 9>(${kernelWeights().join(', ')});
const KERNEL_RADIUS: i32 = 8;

var<workgroup> wg_false_count: u32;
var<workgroup> wg_neighborhood: array<array<f32, 24>, 8>;
var<workgroup> wg_quad_depth: array<f32, 64>;
var<workgroup> wg_quad_velocity: array<vec2f, 64>;

fn loadDepth(p: vec2i) -> f32 { return textureLoad(t_depth, p, 0).r; }
fn isShadowReceiver(p: vec2i) -> bool { let d = loadDepth(p); return d > 0.0 && d < 1.0; }
fn loadNormals(p: vec2i) -> vec3f {
  let n = textureLoad(t_normal, p, 0).xyz * P.normUnpack.x + P.normUnpack.y;
  return safeNormalize(n);
}
fn loadVelocity(p: vec2i) -> vec2f { return textureLoad(t_velocity, p, 0).xy * P.mvScale; }
fn loadRaytracedShadowMask(i: u32) -> u32 { return shadow_mask[i]; }

// FFX_DNSR_Shadows_ThreadGroupAllTrue, LDS path (wave size != 64 on most WebGPU targets).
fn threadGroupAllTrue(val: bool, li: u32) -> bool {
  workgroupBarrier();
  if (li == 0u) { wg_false_count = 0u; }
  workgroupBarrier();
  if (!val) { wg_false_count = 1u; }
  return workgroupUniformLoad(&wg_false_count) == 0u;
}

// returns (all_in_light, all_in_shadow)
fn searchSpatialRegion(gid: vec2u) -> vec2<bool> {
  let base_tile = vec2i(tileIndexFromPixel(gid * 8u));
  let tmax = vec2i(i32(roundedDivide(u32(P.dims.x), 8u)), i32(roundedDivide(u32(P.dims.y), 4u))) - 1;
  var or_mask = 0u;
  var and_mask = 0xFFFFFFFFu;
  for (var j = -2; j <= 3; j++) {
    for (var i = -1; i <= 1; i++) {
      let ti = clamp(base_tile + vec2i(i, j), vec2i(0), tmax);
      let m = loadRaytracedShadowMask(linearTileIndex(vec2u(ti)));
      or_mask |= m;
      and_mask &= m;
    }
  }
  return vec2<bool>(and_mask == 0xFFFFFFFFu, or_mask == 0u);
}

fn isDisoccluded(did: vec2i, depth: f32, velocity: vec2f) -> bool {
  let dims = P.dims;
  let uv = (vec2f(did) + 0.5) * P.invDims;
  let ndc = (2.0 * uv - 1.0) * vec2f(1.0, -1.0);
  let previous_uv = uv + velocity;
  var disoccluded = true;
  if (all(previous_uv > vec2f(0.0)) && all(previous_uv < vec2f(1.0))) {
    let normal = loadNormals(did);
    var clip = P.reproj * vec4f(ndc, depth, 1.0);
    clip.z /= clip.w;
    let homogeneous = P.viewProjInv * vec4f(ndc, depth, 1.0);
    let world_position = homogeneous.xyz / homogeneous.w;
    let view_direction = normalize(P.eye - world_position);
    var z_alignment = 1.0 - dot(view_direction, normal);
    z_alignment = pow(max(z_alignment, 0.0), 8.0);
    let linear_depth = linearDepth(vec2f(did), clip.z);
    let idx = vec2i(previous_uv * vec2f(dims));
    let previous_depth = linearDepth(vec2f(idx), textureLoad(t_prev_depth, idx, 0).r);
    let depth_difference = abs(previous_depth - linear_depth) / linear_depth;
    let depth_tolerance = mix(1e-2, 1e-1, z_alignment);
    disoccluded = depth_difference >= depth_tolerance;
  }
  return disoccluded;
}

fn closer(a: f32, b: f32) -> bool {
  if (P.invertedDepth != 0u) { return a > b; }
  return a < b;
}

// FFX_DNSR_Shadows_GetClosestVelocity: 2x2 min-depth velocity via QuadReadX/Y.
fn closestVelocity(did: vec2i, depth: f32, gtid: vec2u, li: u32) -> vec2f {
  var cv = loadVelocity(did);
  var cd = depth;
  wg_quad_depth[li] = cd;
  wg_quad_velocity[li] = cv;
  workgroupBarrier();
  let nx = gtid.y * 8u + (gtid.x ^ 1u);
  var nd = wg_quad_depth[nx];
  var nv = wg_quad_velocity[nx];
  if (closer(nd, cd)) { cd = nd; cv = nv; }
  workgroupBarrier();
  wg_quad_depth[li] = cd;
  wg_quad_velocity[li] = cv;
  workgroupBarrier();
  let ny = (gtid.y ^ 1u) * 8u + gtid.x;
  nd = wg_quad_depth[ny];
  nv = wg_quad_velocity[ny];
  if (closer(nd, cd)) { cd = nd; cv = nv; }
  return cv;
}

// The horizontal part of a 17x17 local neighborhood kern
fn horizontalNeighborhood(did: vec2i) -> f32 {
  if (did.y < 0 || did.y >= P.dims.y) { return 0.0; }
  let tile_index = vec2u(u32(did.x) / 8u, u32(did.y) / 4u);
  let lti = linearTileIndex(tile_index);
  let first = tile_index.x == 0u;
  let last = tile_index.x == (roundedDivide(u32(P.dims.x), 8u) - 1u);
  var left_tile = 0u;
  if (!first) { left_tile = loadRaytracedShadowMask(lti - 1u); }
  let center_tile = loadRaytracedShadowMask(lti);
  var right_tile = 0u;
  if (!last) { right_tile = loadRaytracedShadowMask(lti + 1u); }
  let row_base = (u32(did.y) % 4u) * 8u;
  let left = (left_tile >> row_base) & 0xFFu;
  let center = (center_tile >> row_base) & 0xFFu;
  let right = (right_tile >> row_base) & 0xFFu;
  var nb = left | (center << 8u) | (right << 16u);
  nb = nb >> (u32(did.x) % 8u);
  var moment = 0.0;
  for (var i = 0u; i < 8u; i++) {
    if (((1u << i) & nb) != 0u) { moment += KW[8u - i]; }
  }
  if (((1u << 8u) & nb) != 0u) { moment += KW[0]; }
  for (var i = 1u; i <= 8u; i++) {
    if (((1u << (8u + i)) & nb) != 0u) { moment += KW[i]; }
  }
  return moment;
}

fn computeLocalNeighborhood(did: vec2i, gtid: vec2u) -> f32 {
  var acc = 0.0;
  let upper = horizontalNeighborhood(vec2i(did.x, did.y - 8));
  let center = horizontalNeighborhood(did);
  let lower = horizontalNeighborhood(vec2i(did.x, did.y + 8));
  wg_neighborhood[gtid.x][gtid.y] = upper;
  wg_neighborhood[gtid.x][gtid.y + 8u] = center;
  wg_neighborhood[gtid.x][gtid.y + 16u] = lower;
  workgroupBarrier();
  acc += center * KW[0];
  acc += upper * KW[KERNEL_RADIUS];
  acc += lower * KW[KERNEL_RADIUS];
  for (var i = 1; i < KERNEL_RADIUS; i++) {
    let u = wg_neighborhood[gtid.x][u32(8 + i32(gtid.y) - i)];
    let l = wg_neighborhood[gtid.x][u32(8 + i32(gtid.y) + i)];
    acc += (u + l) * KW[i];
  }
  return acc;
}

fn writeTileMetaData(gid: vec2u, gtid: vec2u, is_cleared: bool, all_in_light: bool) {
  if (all(gtid == vec2u(0u))) {
    let light_mask = select(0u, TILE_META_DATA_LIGHT_MASK, all_in_light);
    let clear_mask = select(0u, TILE_META_DATA_CLEAR_MASK, is_cleared);
    tile_metadata[gid.y * tileCountX() + gid.x] = light_mask | clear_mask;
  }
}

fn clearTargets(did: vec2u, gtid: vec2u, gid: vec2u, shadow_value: f32, is_receiver: bool, all_in_light: bool, inb: bool) {
  writeTileMetaData(gid, gtid, true, all_in_light);
  if (inb) {
    textureStore(o_reprojection, did, vec4f(shadow_value, 0.0, 0.0, 0.0)); // mean, variance
    let temporal_sample_count = select(0.0, 1.0, is_receiver);
    textureStore(o_moments, did, vec4f(shadow_value, 0.0, temporal_sample_count, 0.0));
  }
}

@compute @workgroup_size(8, 8)
fn main(@builtin(local_invocation_id) lid: vec3u, @builtin(workgroup_id) gid3: vec3u,
        @builtin(local_invocation_index) li: u32) {
  let gtid = lid.xy;
  let gid = gid3.xy;
  let did = gid * 8u + gtid;
  let inb = all(did < vec2u(P.dims));
  let pdid = vec2i(min(did, vec2u(P.dims) - 1u));

  let is_receiver = inb && isShadowReceiver(pdid);
  let skip_sky = threadGroupAllTrue(!is_receiver, li);
  if (skip_sky) {
    clearTargets(did, gtid, gid, 0.0, is_receiver, false, inb);
    return;
  }

  let region = searchSpatialRegion(gid);
  let all_in_light = region.x;
  let all_in_shadow = region.y;
  let shadow_value = select(0.0, 1.0, all_in_light);
  let can_skip = all_in_light || all_in_shadow;
  let skip_tile = threadGroupAllTrue(can_skip, li);
  if (skip_tile) {
    clearTargets(did, gtid, gid, shadow_value, is_receiver, all_in_light, inb);
    return;
  }

  writeTileMetaData(gid, gtid, false, false);

  let depth = loadDepth(pdid);
  let velocity = closestVelocity(pdid, depth, gtid, li);
  let local_neighborhood = computeLocalNeighborhood(vec2i(did), gtid);

  let uv = (vec2f(did) + 0.5) * P.invDims;
  let history_uv = uv + velocity;
  let history_pos = vec2i(history_uv * vec2f(P.dims));

  let shadow_tile = loadRaytracedShadowMask(linearTileIndex(tileIndexFromPixel(did)));

  var moments_current = vec3f(0.0);
  var variance = 0.0;
  var shadow_clamped = 0.0;
  if (is_receiver) {
    let hit_light = (shadow_tile & bitMaskFromPixel(did)) != 0u;
    let shadow_current = select(0.0, 1.0, hit_light);
    {
      let disoccluded = isDisoccluded(pdid, depth, velocity);
      let prev_load = textureLoad(t_prev_moments, clamp(history_pos, vec2i(0), P.dims - 1), 0).xyz;
      let previous_moments = select(prev_load, vec3f(0.0), disoccluded);
      let old_m = previous_moments.x;
      let old_s = previous_moments.y;
      let sample_count = previous_moments.z + 1.0;
      let new_m = old_m + (shadow_current - old_m) / sample_count;
      let new_s = old_s + (shadow_current - old_m) * (shadow_current - new_m);
      variance = select(1.0, new_s / (sample_count - 1.0), sample_count > 1.0);
      moments_current = vec3f(new_m, new_s, sample_count);
    }
    {
      let mean = local_neighborhood;
      let spatial_variance = max(local_neighborhood - mean * mean, 0.0);
      let std_deviation = sqrt(spatial_variance);
      let nmin = mean - 0.5 * std_deviation;
      let nmax = mean + 0.5 * std_deviation;
      var shadow_previous = shadow_current;
      if (P.firstFrame == 0) {
        shadow_previous = textureSampleLevel(t_history, s_linear, history_uv, 0.0).x;
      }
      shadow_clamped = clamp(shadow_previous, nmin, nmax);
      let sigma = 20.0;
      let temporal_discontinuity = (shadow_previous - mean) / max(0.5 * std_deviation, 0.001);
      let sample_counter_damper = exp(-temporal_discontinuity * temporal_discontinuity / sigma);
      moments_current.z *= sample_counter_damper;
      if (moments_current.z < 16.0) {
        let variance_boost = max(16.0 - moments_current.z, 1.0);
        variance = max(variance, spatial_variance);
        variance *= variance_boost;
      }
    }
    let history_weight = sqrt(max(8.0 - moments_current.z, 0.0) / 8.0);
    shadow_clamped = mix(shadow_clamped, shadow_current, mix(0.05, 1.0, history_weight));
  }

  if (inb) {
    textureStore(o_reprojection, did, vec4f(shadow_clamped, variance, 0.0, 0.0));
    textureStore(o_moments, did, vec4f(moments_current, 0.0));
  }
}
`;

/** Edge-avoiding a-trous filter passes 0/1/2 (step 1/2/4). Pass 2 writes the final mask. */
export function filterWgsl(pass: 0 | 1 | 2) {
  const step = [1, 2, 4][pass];
  return /* wgsl */ `
${PARAMS_WGSL}
@group(0) @binding(1) var t_depth: texture_2d<f32>;
@group(0) @binding(2) var t_normal: texture_2d<f32>;
@group(0) @binding(3) var t_input: texture_2d<f32>;
@group(0) @binding(4) var<storage, read> tile_metadata: array<u32>;
@group(0) @binding(5) var o_output: texture_storage_2d<rgba16float, write>;

const PASS_INDEX: u32 = ${pass}u;
const STEP_SIZE: i32 = ${step};

var<workgroup> wg_input: array<array<vec2f, 16>, 16>;
var<workgroup> wg_depth: array<array<f32, 16>, 16>;
var<workgroup> wg_normals: array<array<vec3f, 16>, 16>;
var<workgroup> wg_meta: u32;

fn loadNormals(p: vec2i) -> vec3f {
  let n = textureLoad(t_normal, p, 0).xyz * P.normUnpack.x + P.normUnpack.y;
  return safeNormalize(n);
}

fn loadWithOffset(did: vec2i, offset: vec2i, gtid: vec2i) {
  let p = clamp(did + offset, vec2i(0), P.dims - 1);
  let idx = gtid + offset;
  wg_normals[idx.y][idx.x] = loadNormals(p);
  wg_input[idx.y][idx.x] = textureLoad(t_input, p, 0).xy;
  wg_depth[idx.y][idx.x] = textureLoad(t_depth, p, 0).r;
}

fn initializeGroupSharedMemory(did_in: vec2i, gtid: vec2i) {
  let did = did_in - 4;
  loadWithOffset(did, vec2i(0, 0), gtid); // X
  loadWithOffset(did, vec2i(8, 0), gtid); // A
  loadWithOffset(did, vec2i(0, 8), gtid); // B
  loadWithOffset(did, vec2i(8, 8), gtid); // C
}

fn shadowSimilarity(x1: f32, x2: f32, sigma: f32) -> f32 { return exp(-abs(x1 - x2) / sigma); }
fn depthSimilarity(x1: f32, x2: f32, sigma: f32) -> f32 { return exp(-abs(x1 - x2) / sigma); }
fn normalSimilarity(x1: vec3f, x2: vec3f) -> f32 { return pow(saturate(dot(x1, x2)), 32.0); }

fn filteredVariance(pos: vec2i) -> f32 {
  let kern = array<array<f32, 2>, 2>(array<f32, 2>(1.0 / 4.0, 1.0 / 8.0), array<f32, 2>(1.0 / 8.0, 1.0 / 16.0));
  var variance = 0.0;
  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
      let w = kern[abs(x)][abs(y)];
      let q = pos + vec2i(x, y);
      variance += w * wg_input[q.y][q.x].y;
    }
  }
  return variance;
}

// returns (weight_sum, shadow_sum.x, shadow_sum.y)
fn denoiseFromGroupSharedMemory(did: vec2i, gtid: vec2i, depth: f32) -> vec3f {
  let shadow_center = wg_input[gtid.y][gtid.x];
  let normal_center = wg_normals[gtid.y][gtid.x];
  var weight_sum = 1.0;
  var shadow_sum = shadow_center;
  let variance = filteredVariance(gtid);
  let std_deviation = sqrt(max(variance + 1e-9, 0.0));
  let depth_center = linearDepth(vec2f(did), depth);
  let kern = array<f32, 3>(1.0, 2.0 / 3.0, 1.0 / 6.0);
  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
      let stp = vec2i(x, y) * STEP_SIZE;
      let gi = gtid + stp;
      let di = did + stp;
      var depth_neigh = wg_depth[gi.y][gi.x];
      let normal_neigh = wg_normals[gi.y][gi.x];
      let shadow_neigh = wg_input[gi.y][gi.x];
      let sky = (x == 0 && y == 0) || depth_neigh >= 1.0 || depth_neigh <= 0.0;
      depth_neigh = linearDepth(vec2f(di), depth_neigh);
      var w = kern[abs(x)] * kern[abs(y)];
      w *= shadowSimilarity(shadow_center.x, shadow_neigh.x, std_deviation);
      w *= depthSimilarity(depth_center, depth_neigh, P.depthSigma);
      w *= normalSimilarity(normal_center, normal_neigh);
      w *= select(1.0, 0.0, sky);
      shadow_sum += vec2f(w, w * w) * shadow_neigh;
      weight_sum += w;
    }
  }
  return vec3f(weight_sum, shadow_sum);
}

@compute @workgroup_size(8, 8)
fn main(@builtin(local_invocation_id) lid: vec3u, @builtin(workgroup_id) gid3: vec3u,
        @builtin(global_invocation_id) gdid: vec3u, @builtin(local_invocation_index) li: u32) {
  let gid = gid3.xy;
  let did = vec2i(gdid.xy);
  let gtid = vec2i(lid.xy);
  let inb = all(did < P.dims);
  if (li == 0u) { wg_meta = tile_metadata[gid.y * tileCountX() + gid.x]; }
  let md = workgroupUniformLoad(&wg_meta);
  let is_cleared = (md & TILE_META_DATA_CLEAR_MASK) != 0u;
  let all_in_light = (md & TILE_META_DATA_LIGHT_MASK) != 0u;

  var do_write = false;
  var results = vec2f(0.0);
  if (is_cleared) {
    if (PASS_INDEX != 1u) {
      results.x = select(0.0, 1.0, all_in_light);
      do_write = true;
    }
  } else {
    // FFX_DNSR_Shadows_ApplyFilterWithPrecache
    var weight_sum = 1.0;
    var shadow_sum = vec2f(0.0);
    initializeGroupSharedMemory(did, gtid);
    workgroupBarrier();
    let pd = clamp(did, vec2i(0), P.dims - 1);
    let depth = textureLoad(t_depth, pd, 0).r;
    let needs_denoiser = inb && depth > 0.0 && depth < 1.0;
    if (needs_denoiser) {
      let r = denoiseFromGroupSharedMemory(did, gtid + 4, depth);
      weight_sum = r.x;
      shadow_sum = r.yz;
    }
    results = vec2f(shadow_sum.x / weight_sum, shadow_sum.y / (weight_sum * weight_sum));
    do_write = true;
  }

  if (do_write && inb) {
${pass === 2 ? `    // Recover some of the contrast lost during denoising
    let shadow_remap = max(1.2 - results.y, 1.0);
    let mean = pow(abs(results.x), shadow_remap);
    textureStore(o_output, did, vec4f(mean, 0.0, 0.0, 1.0));` : `    textureStore(o_output, did, vec4f(results, 0.0, 0.0));`}
  }
}
`;
}
