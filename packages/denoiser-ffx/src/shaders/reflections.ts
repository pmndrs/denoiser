// WGSL port of the AMD FidelityFX Denoiser — reflections (FidelityFX SDK v1.1.4):
//   sdk/include/FidelityFX/gpu/denoiser/ffx_denoiser_reflections_reproject.h
//   sdk/include/FidelityFX/gpu/denoiser/ffx_denoiser_reflections_prefilter.h
//   sdk/include/FidelityFX/gpu/denoiser/ffx_denoiser_reflections_resolve_temporal.h
//   sdk/include/FidelityFX/gpu/denoiser/ffx_denoiser_reflections_common.h
//   sdk/include/FidelityFX/gpu/denoiser/ffx_denoiser_reflections_config.h
//   sdk/include/FidelityFX/gpu/denoiser/ffx_denoiser_reflections_callbacks_glsl.h
//   sdk/src/backends/vk/shaders/denoiser/ffx_denoiser_*_reflections_pass.glsl
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
// FFX_DNSR_Reflections_ClipAABB is from "Temporal Reprojection Anti-Aliasing"
// (https://github.com/playdeadgames/temporal), Copyright (c) 2015 Playdead, MIT.
//
// Port notes (deviations from the source):
// - The fp32 (non-FFX_HALF) paths are ported; LDS holds f32 instead of packed half.
// - No tile list / indirect dispatch: the classifier that builds FFX's denoiser
//   tile list belongs to SSSR / hybrid reflections, not the denoiser. Every 8x8
//   tile is dispatched; the per-pixel roughness gates (IsGlossyReflection /
//   IsMirrorReflection) are unchanged.
// - Ray length comes from a separate hit-distance texture instead of radiance.w;
//   misses (0) map to Params.missDistance (environment ~ at infinity).
// - The host's end-of-frame copy jobs (depth / normal / roughness history) are
//   replaced by a prepare pass writing ping-pong copies (normal.xyz + roughness.w
//   in one rgba16float, depth in r32float).
// - Scalar history (depth, variance, sample count) lives in r32float, which core
//   WebGPU cannot filter; SampleXHistory() use an exact manual bilinear
//   (clamp-to-edge) instead of the hardware linear sampler.
// - OOB texel fetches at the screen border are clamped (FFX relies on robust
//   buffer access returning 0).
// - isnan/isinf are bit tests (WGSL lets compilers assume finite math).

export const REFLECTION_PARAMS_WGSL = /* wgsl */ `
struct Params {
  invProjection: mat4x4f,
  invView: mat4x4f,
  prevViewProjection: mat4x4f,
  renderSize: vec2u,
  inverseRenderSize: vec2f,
  motionVectorScale: vec2f,
  normalsUnpackMul: f32,
  normalsUnpackAdd: f32,
  isRoughnessPerceptual: u32,
  temporalStabilityFactor: f32,
  roughnessThreshold: f32,
  missDistance: f32,
};
@group(0) @binding(0) var<uniform> P: Params;

const GAUSSIAN_K: f32 = 3.0;
const RADIANCE_WEIGHT_BIAS: f32 = 0.6;
const RADIANCE_WEIGHT_VARIANCE_K: f32 = 0.1;
const AVG_RADIANCE_LUMINANCE_WEIGHT: f32 = 0.3;
const PREFILTER_VARIANCE_WEIGHT: f32 = 4.4;
const REPROJECT_SURFACE_DISCARD_VARIANCE_WEIGHT: f32 = 1.5;
const PREFILTER_VARIANCE_BIAS: f32 = 0.1;
const PREFILTER_NORMAL_SIGMA: f32 = 512.0;
const PREFILTER_DEPTH_SIGMA: f32 = 4.0;
const DISOCCLUSION_NORMAL_WEIGHT: f32 = 1.4;
const DISOCCLUSION_DEPTH_WEIGHT: f32 = 1.0;
const DISOCCLUSION_THRESHOLD: f32 = 0.9;
const REPROJECTION_NORMAL_SIMILARITY_THRESHOLD: f32 = 0.9999;
const LOCAL_NEIGHBORHOOD_RADIUS: i32 = 4;
fn samplesForRoughness(r: f32) -> f32 { return 1.0 - exp(-r * 100.0); }

fn isGlossyReflection(roughness: f32) -> bool { return roughness < P.roughnessThreshold; }
fn isMirrorReflection(roughness: f32) -> bool { return roughness < 0.0001; }

fn safeNormalize(n: vec3f) -> vec3f {
  let l2 = dot(n, n);
  return select(vec3f(0.0, 0.0, 1.0), n * inverseSqrt(l2), l2 > 1e-12);
}
fn notFinite(v: f32) -> bool { return (bitcast<u32>(v) & 0x7f800000u) == 0x7f800000u; }
fn anyNotFinite3(v: vec3f) -> bool { return notFinite(v.x) || notFinite(v.y) || notFinite(v.z); }

fn clampPx(p: vec2i) -> vec2i { return clamp(p, vec2i(0), vec2i(P.renderSize) - 1); }

fn projectPosition(origin: vec3f, m: mat4x4f) -> vec3f {
  var projected = m * vec4f(origin, 1.0);
  var p = projected.xyz / projected.w;
  p = vec3f(0.5 * p.xy + 0.5, p.z);
  p.y = 1.0 - p.y;
  return p;
}
fn invProjectPosition(coord_in: vec3f, m: mat4x4f) -> vec3f {
  var coord = coord_in;
  coord.y = 1.0 - coord.y;
  coord = vec3f(2.0 * coord.xy - 1.0, coord.z);
  let projected = m * vec4f(coord, 1.0);
  return projected.xyz / projected.w;
}
fn getLinearDepth(uv: vec2f, depth: f32) -> f32 {
  return abs(invProjectPosition(vec3f(uv, depth), P.invProjection).z);
}
fn screenSpaceToViewSpace(c: vec3f) -> vec3f { return invProjectPosition(c, P.invProjection); }
fn worldSpaceToScreenSpacePrevious(p: vec3f) -> vec3f { return projectPosition(p, P.prevViewProjection); }
fn viewSpaceToWorldSpace(v: vec4f) -> vec3f { return (P.invView * v).xyz; }

fn roundUp8(v: vec2u) -> vec2u {
  let rd = v & vec2u(~7u);
  return select(v + 8u, v, rd == v);
}

fn luminance(c: vec3f) -> f32 { return max(dot(c, vec3f(0.299, 0.587, 0.114)), 0.001); }
fn computeTemporalVariance(history_radiance: vec3f, radiance: vec3f) -> f32 {
  let hl = luminance(history_radiance);
  let l = luminance(radiance);
  let diff = abs(hl - l) / max(max(hl, l), 0.5);
  return diff * diff;
}

fn clipAABB(aabb_min: vec3f, aabb_max: vec3f, prev_sample: vec3f) -> vec3f {
  let aabb_center = 0.5 * (aabb_max + aabb_min);
  let extent_clip = 0.5 * (aabb_max - aabb_min) + 0.001;
  let color_vector = prev_sample - aabb_center;
  let cvc = abs(color_vector / extent_clip);
  let max_abs_unit = max(max(cvc.x, cvc.y), cvc.z);
  if (max_abs_unit > 1.0) { return aabb_center + color_vector / max_abs_unit; }
  return prev_sample;
}

fn localNeighborhoodKernelWeight(i: f32) -> f32 {
  let radius = f32(LOCAL_NEIGHBORHOOD_RADIUS) + 1.0;
  return exp(-GAUSSIAN_K * (i * i) / (radius * radius));
}

// roughness stored as provided in .w of the prepared normal/roughness texture
fn toLinearRoughness(raw: f32) -> f32 { return select(raw, raw * raw, P.isRoughnessPerceptual != 0u); }

// exact bilinear of an r32float texture at uv (clamp-to-edge), = textureSampleLevel w/ linear sampler
fn bilinear1(t: texture_2d<f32>, uv: vec2f) -> f32 {
  let size = vec2f(P.renderSize);
  let p = uv * size - 0.5;
  let f = fract(p);
  let i = vec2i(floor(p));
  let a = textureLoad(t, clampPx(i), 0).x;
  let b = textureLoad(t, clampPx(i + vec2i(1, 0)), 0).x;
  let c = textureLoad(t, clampPx(i + vec2i(0, 1)), 0).x;
  let d = textureLoad(t, clampPx(i + vec2i(1, 1)), 0).x;
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
`;

/** Prepare: depth -> r32float, normal (unpacked) + roughness -> rgba16float (this frame's copies = next frame's history). */
export function reflectionPrepareWgsl(depthIsDepthFormat: boolean) {
  return /* wgsl */ `
${REFLECTION_PARAMS_WGSL}
@group(0) @binding(1) var t_depth_in: ${depthIsDepthFormat ? 'texture_depth_2d' : 'texture_2d<f32>'};
@group(0) @binding(2) var t_normal_in: texture_2d<f32>;
@group(0) @binding(3) var t_rough_in: texture_2d<f32>;
@group(0) @binding(4) var o_depth: texture_storage_2d<r32float, write>;
@group(0) @binding(5) var o_normrough: texture_storage_2d<rgba16float, write>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= P.renderSize)) { return; }
  let d = ${depthIsDepthFormat ? 'textureLoad(t_depth_in, id.xy, 0)' : 'textureLoad(t_depth_in, id.xy, 0).r'};
  let n = safeNormalize(P.normalsUnpackMul * textureLoad(t_normal_in, id.xy, 0).xyz + P.normalsUnpackAdd);
  let r = textureLoad(t_rough_in, id.xy, 0).r;
  textureStore(o_depth, id.xy, vec4f(d, 0.0, 0.0, 0.0));
  textureStore(o_normrough, id.xy, vec4f(n, r));
}
`;
}

export const REPROJECT_WGSL = /* wgsl */ `
${REFLECTION_PARAMS_WGSL}
@group(0) @binding(1) var t_depth: texture_2d<f32>;
@group(0) @binding(2) var t_normrough: texture_2d<f32>;
@group(0) @binding(3) var t_motion: texture_2d<f32>;
@group(0) @binding(4) var t_radiance: texture_2d<f32>;
@group(0) @binding(5) var t_raylength: texture_2d<f32>;
@group(0) @binding(6) var t_radiance_history: texture_2d<f32>;
@group(0) @binding(7) var t_depth_history: texture_2d<f32>;
@group(0) @binding(8) var t_normrough_history: texture_2d<f32>;
@group(0) @binding(9) var t_variance_history: texture_2d<f32>;
@group(0) @binding(10) var t_sample_count_history: texture_2d<f32>;
@group(0) @binding(11) var s_linear: sampler;
@group(0) @binding(12) var o_reprojected: texture_storage_2d<rgba16float, write>;
@group(0) @binding(13) var o_variance: texture_storage_2d<r32float, write>;
@group(0) @binding(14) var o_sample_count: texture_storage_2d<r32float, write>;
@group(0) @binding(15) var o_avg_radiance: texture_storage_2d<rgba16float, write>;

var<workgroup> wg_radiance: array<array<vec4f, 16>, 16>;

fn loadRadiance(p: vec2i) -> vec3f { return textureLoad(t_radiance, clampPx(p), 0).xyz; }
fn loadDepth(p: vec2i) -> f32 { return textureLoad(t_depth, p, 0).r; }
fn loadNormal(p: vec2i) -> vec3f { return textureLoad(t_normrough, p, 0).xyz; }
fn loadRoughness(p: vec2i) -> f32 { return toLinearRoughness(textureLoad(t_normrough, p, 0).w); }
fn loadMotionVector(p: vec2i) -> vec2f { return P.motionVectorScale * textureLoad(t_motion, p, 0).xy; }
fn loadRayLength(p: vec2i) -> f32 {
  let t = textureLoad(t_raylength, p, 0).r;
  return select(t, P.missDistance, t <= 0.0);
}
fn sampleRadianceHistory(uv: vec2f) -> vec3f { return textureSampleLevel(t_radiance_history, s_linear, uv, 0.0).xyz; }
fn loadRadianceHistory(p: vec2i) -> vec3f { return textureLoad(t_radiance_history, clampPx(p), 0).xyz; }
fn sampleNormalHistory(uv: vec2f) -> vec3f {
  return safeNormalize(textureSampleLevel(t_normrough_history, s_linear, uv, 0.0).xyz);
}
fn loadNormalHistory(p: vec2i) -> vec3f { return safeNormalize(textureLoad(t_normrough_history, clampPx(p), 0).xyz); }
fn sampleRoughnessHistory(uv: vec2f) -> f32 {
  return toLinearRoughness(textureSampleLevel(t_normrough_history, s_linear, uv, 0.0).w);
}
fn sampleDepthHistory(uv: vec2f) -> f32 { return bilinear1(t_depth_history, uv); }
fn loadDepthHistory(p: vec2i) -> f32 { return textureLoad(t_depth_history, clampPx(p), 0).r; }
fn sampleVarianceHistory(uv: vec2f) -> f32 { return bilinear1(t_variance_history, uv); }
fn sampleNumSamplesHistory(uv: vec2f) -> f32 { return bilinear1(t_sample_count_history, uv); }

fn initializeGroupSharedMemory(did_in: vec2i, gtid: vec2i) {
  let did = did_in - 4;
  let offs = array<vec2i, 4>(vec2i(0, 0), vec2i(8, 0), vec2i(0, 8), vec2i(8, 8));
  for (var i = 0; i < 4; i++) {
    let q = gtid + offs[i];
    wg_radiance[q.y][q.x] = vec4f(loadRadiance(did + offs[i]), 0.0);
  }
}

fn getLuminanceWeight(v: vec3f) -> f32 {
  return max(exp(-luminance(v) * AVG_RADIANCE_LUMINANCE_WEIGHT), 1.0e-2);
}

fn getHitPositionReprojection(did: vec2i, uv: vec2f, reflected_ray_length: f32) -> vec2f {
  let z = loadDepth(did);
  var view_space_ray = screenSpaceToViewSpace(vec3f(uv, z));
  let surface_depth = length(view_space_ray);
  let ray_length = surface_depth + reflected_ray_length;
  view_space_ray /= surface_depth;
  view_space_ray *= ray_length;
  let world_hit_position = viewSpaceToWorldSpace(vec4f(view_space_ray, 1.0));
  let prev_hit_position = worldSpaceToScreenSpacePrevious(world_hit_position);
  return prev_hit_position.xy;
}

fn getDisocclusionFactor(normal: vec3f, history_normal: vec3f, linear_depth: f32, history_linear_depth: f32) -> f32 {
  return 1.0
    * exp(-abs(1.0 - max(0.0, dot(normal, history_normal))) * DISOCCLUSION_NORMAL_WEIGHT)
    * exp(-abs(history_linear_depth - linear_depth) / linear_depth * DISOCCLUSION_DEPTH_WEIGHT);
}

struct Moments { mean: vec3f, variance: vec3f };

fn estimateLocalNeighborhoodInGroup(gtid: vec2i) -> Moments {
  var m = Moments(vec3f(0.0), vec3f(0.0));
  var acc = 0.0;
  for (var j = -LOCAL_NEIGHBORHOOD_RADIUS; j <= LOCAL_NEIGHBORHOOD_RADIUS; j++) {
    for (var i = -LOCAL_NEIGHBORHOOD_RADIUS; i <= LOCAL_NEIGHBORHOOD_RADIUS; i++) {
      let q = gtid + vec2i(i, j);
      let radiance = wg_radiance[q.y][q.x].xyz;
      let w = localNeighborhoodKernelWeight(f32(i)) * localNeighborhoodKernelWeight(f32(j));
      acc += w;
      m.mean += radiance * w;
      m.variance += radiance * radiance * w;
    }
  }
  m.mean /= acc;
  m.variance /= acc;
  m.variance = abs(m.variance - m.mean * m.mean);
  return m;
}

fn dot2(a: vec3f) -> f32 { return dot(a, a); }

struct Pick { disocclusion_factor: f32, reprojection_uv: vec2f, reprojection: vec3f };

fn pickReprojection(did: vec2i, gtid: vec2i, screen_size: vec2u, roughness: f32, ray_length: f32) -> Pick {
  var o = Pick(0.0, vec2f(0.0), vec3f(0.0));
  let local_neighborhood = estimateLocalNeighborhoodInGroup(gtid);
  let uv = (vec2f(did) + 0.5) / vec2f(screen_size);
  let normal = loadNormal(did);
  var history_normal: vec3f;
  var history_linear_depth: f32;
  {
    let motion_vector = loadMotionVector(did);
    let surface_reprojection_uv = uv + motion_vector;
    let hit_reprojection_uv = getHitPositionReprojection(did, uv, ray_length);
    let surface_normal = sampleNormalHistory(surface_reprojection_uv);
    let hit_normal = sampleNormalHistory(hit_reprojection_uv);
    let surface_history = sampleRadianceHistory(surface_reprojection_uv);
    let hit_history = sampleRadianceHistory(hit_reprojection_uv);
    let hit_normal_similarity = dot(safeNormalize(hit_normal), safeNormalize(normal));
    let surface_normal_similarity = dot(safeNormalize(surface_normal), safeNormalize(normal));
    let hit_roughness = sampleRoughnessHistory(hit_reprojection_uv);
    let surface_roughness = sampleRoughnessHistory(surface_reprojection_uv);
    if (hit_normal_similarity > REPROJECTION_NORMAL_SIMILARITY_THRESHOLD
        && hit_normal_similarity + 1.0e-3 > surface_normal_similarity
        && abs(hit_roughness - roughness) < abs(surface_roughness - roughness) + 1.0e-3) {
      history_normal = hit_normal;
      history_linear_depth = getLinearDepth(hit_reprojection_uv, sampleDepthHistory(hit_reprojection_uv));
      o.reprojection_uv = hit_reprojection_uv;
      o.reprojection = hit_history;
    } else {
      if (dot2(surface_history - local_neighborhood.mean) <
          REPROJECT_SURFACE_DISCARD_VARIANCE_WEIGHT * length(local_neighborhood.variance)) {
        history_normal = surface_normal;
        history_linear_depth = getLinearDepth(surface_reprojection_uv, sampleDepthHistory(surface_reprojection_uv));
        o.reprojection_uv = surface_reprojection_uv;
        o.reprojection = surface_history;
      } else {
        // FFX returns with reprojection_uv / reprojection unset (undefined in HLSL).
        o.disocclusion_factor = 0.0;
        o.reprojection_uv = surface_reprojection_uv;
        return o;
      }
    }
  }
  let depth = loadDepth(did);
  let linear_depth = getLinearDepth(uv, depth);
  o.disocclusion_factor = getDisocclusionFactor(normal, history_normal, linear_depth, history_linear_depth);
  if (o.disocclusion_factor > DISOCCLUSION_THRESHOLD) { return o; }

  if (o.disocclusion_factor < DISOCCLUSION_THRESHOLD) {
    let dudv = 1.0 / vec2f(screen_size);
    let base_uv = o.reprojection_uv;
    for (var y = -1; y <= 1; y++) {
      for (var x = -1; x <= 1; x++) {
        let suv = base_uv + vec2f(f32(x), f32(y)) * dudv;
        let hn = sampleNormalHistory(suv);
        let hld = getLinearDepth(suv, sampleDepthHistory(suv));
        let w = getDisocclusionFactor(normal, hn, linear_depth, hld);
        if (w > o.disocclusion_factor) {
          o.disocclusion_factor = w;
          o.reprojection_uv = suv;
        }
      }
    }
    o.reprojection = sampleRadianceHistory(o.reprojection_uv);
  }

  // Rare slow path - triggered only on the edges.
  if (o.disocclusion_factor < DISOCCLUSION_THRESHOLD) {
    let fs = vec2f(screen_size);
    let uvx = fract(fs.x * o.reprojection_uv.x + 0.5);
    let uvy = fract(fs.y * o.reprojection_uv.y + 0.5);
    let rtc = vec2i(fs * o.reprojection_uv - 0.5);
    let r00 = loadRadianceHistory(rtc + vec2i(0, 0));
    let r10 = loadRadianceHistory(rtc + vec2i(1, 0));
    let r01 = loadRadianceHistory(rtc + vec2i(0, 1));
    let r11 = loadRadianceHistory(rtc + vec2i(1, 1));
    let n00 = loadNormalHistory(rtc + vec2i(0, 0));
    let n10 = loadNormalHistory(rtc + vec2i(1, 0));
    let n01 = loadNormalHistory(rtc + vec2i(0, 1));
    let n11 = loadNormalHistory(rtc + vec2i(1, 1));
    let d00 = getLinearDepth(o.reprojection_uv, loadDepthHistory(rtc + vec2i(0, 0)));
    let d10 = getLinearDepth(o.reprojection_uv, loadDepthHistory(rtc + vec2i(1, 0)));
    let d01 = getLinearDepth(o.reprojection_uv, loadDepthHistory(rtc + vec2i(0, 1)));
    let d11 = getLinearDepth(o.reprojection_uv, loadDepthHistory(rtc + vec2i(1, 1)));
    let half_t = DISOCCLUSION_THRESHOLD / 2.0;
    var w = vec4f(
      select(0.0, 1.0, getDisocclusionFactor(normal, n00, linear_depth, d00) > half_t),
      select(0.0, 1.0, getDisocclusionFactor(normal, n10, linear_depth, d10) > half_t),
      select(0.0, 1.0, getDisocclusionFactor(normal, n01, linear_depth, d01) > half_t),
      select(0.0, 1.0, getDisocclusionFactor(normal, n11, linear_depth, d11) > half_t));
    w.x = w.x * (1.0 - uvx) * (1.0 - uvy);
    w.y = w.y * uvx * (1.0 - uvy);
    w.z = w.z * (1.0 - uvx) * uvy;
    w.w = w.w * uvx * uvy;
    let ws = max(w.x + w.y + w.z + w.w, 1.0e-3);
    w /= ws;
    o.reprojection = r00 * w.x + r10 * w.y + r01 * w.z + r11 * w.w;
    let hld = d00 * w.x + d10 * w.y + d01 * w.z + d11 * w.w;
    let hn = n00 * w.x + n10 * w.y + n01 * w.z + n11 * w.w;
    o.disocclusion_factor = getDisocclusionFactor(normal, hn, linear_depth, hld);
  }
  o.disocclusion_factor = select(o.disocclusion_factor, 0.0, o.disocclusion_factor < DISOCCLUSION_THRESHOLD);
  return o;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(local_invocation_id) lid: vec3u, @builtin(global_invocation_id) gdid: vec3u) {
  let screen_size = P.renderSize;
  let max_samples = 32.0;
  let did = vec2i(gdid.xy);
  var gtid = vec2i(lid.xy);
  let inb = all(gdid.xy < screen_size);
  let pd = clampPx(did);

  initializeGroupSharedMemory(did, gtid);
  workgroupBarrier();
  gtid += 4;

  let roughness = loadRoughness(pd);
  var radiance = loadRadiance(pd);
  let ray_length = loadRayLength(pd);

  if (isGlossyReflection(roughness)) {
    let pick = pickReprojection(pd, gtid, screen_size, roughness, ray_length);
    let ruv = pick.reprojection_uv;
    if (ruv.x > 0.0 && ruv.y > 0.0 && ruv.x < 1.0 && ruv.y < 1.0) {
      let prev_variance = sampleVarianceHistory(ruv);
      var num_samples = sampleNumSamplesHistory(ruv) * pick.disocclusion_factor;
      let s_max_samples = max(8.0, max_samples * samplesForRoughness(roughness));
      num_samples = min(s_max_samples, num_samples + 1.0);
      let new_variance = computeTemporalVariance(radiance, pick.reprojection);
      if (pick.disocclusion_factor < DISOCCLUSION_THRESHOLD) {
        if (inb) {
          textureStore(o_reprojected, did, vec4f(0.0));
          textureStore(o_variance, did, vec4f(1.0));
          textureStore(o_sample_count, did, vec4f(1.0));
        }
      } else {
        let variance_mix = mix(new_variance, prev_variance, 1.0 / num_samples);
        if (inb) {
          textureStore(o_reprojected, did, vec4f(pick.reprojection, 0.0));
          textureStore(o_variance, did, vec4f(variance_mix));
          textureStore(o_sample_count, did, vec4f(num_samples));
        }
        // Mix in reprojection for radiance mip computation
        radiance = mix(radiance, pick.reprojection, 0.3);
      }
    } else if (inb) {
      textureStore(o_reprojected, did, vec4f(0.0));
      textureStore(o_variance, did, vec4f(1.0));
      textureStore(o_sample_count, did, vec4f(1.0));
    }
  }

  // Downsample 8x8 -> 1 radiance using groupshared memory
  var weight = getLuminanceWeight(radiance);
  radiance *= weight;
  if (!inb || anyNotFinite3(radiance) || weight > 1.0e3) {
    radiance = vec3f(0.0);
    weight = 0.0;
  }
  gtid -= 4;
  workgroupBarrier(); // everyone is done reading the neighborhood before it is overwritten
  wg_radiance[gtid.y][gtid.x] = vec4f(radiance, weight);
  workgroupBarrier();
  for (var i = 2; i <= 8; i = i * 2) {
    let ox = gtid.x * i;
    let oy = gtid.y * i;
    let ix = gtid.x * i + i / 2;
    let iy = gtid.y * i + i / 2;
    if (ix < 8 && iy < 8) {
      let sum = wg_radiance[oy][ox] + wg_radiance[iy][ox] + wg_radiance[oy][ix] + wg_radiance[iy][ix];
      wg_radiance[oy][ox] = sum;
    }
    workgroupBarrier();
  }
  if (gtid.x == 0 && gtid.y == 0) {
    let sum = wg_radiance[0][0];
    let weight_acc = max(sum.w, 1.0e-3);
    textureStore(o_avg_radiance, gdid.xy / 8u, vec4f(sum.xyz / weight_acc, 0.0));
  }
}
`;

export const PREFILTER_WGSL = /* wgsl */ `
${REFLECTION_PARAMS_WGSL}
@group(0) @binding(1) var t_depth: texture_2d<f32>;
@group(0) @binding(2) var t_normrough: texture_2d<f32>;
@group(0) @binding(3) var t_radiance: texture_2d<f32>;
@group(0) @binding(4) var t_variance: texture_2d<f32>;
@group(0) @binding(5) var t_avg_radiance: texture_2d<f32>;
@group(0) @binding(6) var s_linear: sampler;
@group(0) @binding(7) var o_radiance: texture_storage_2d<rgba16float, write>;
@group(0) @binding(8) var o_variance: texture_storage_2d<r32float, write>;

struct NS { radiance: vec3f, variance: f32, normal: vec3f, depth: f32 };
var<workgroup> wg_rv: array<array<vec4f, 16>, 16>;  // radiance, variance
var<workgroup> wg_nd: array<array<vec4f, 16>, 16>;  // normal, linear depth

fn loadNS(idx: vec2i) -> NS {
  let a = wg_rv[idx.y][idx.x];
  let b = wg_nd[idx.y][idx.x];
  return NS(a.xyz, a.w, b.xyz, b.w);
}

fn initializeGroupSharedMemory(did_in: vec2i, gtid: vec2i) {
  let did = did_in - 4;
  let offs = array<vec2i, 4>(vec2i(0, 0), vec2i(8, 0), vec2i(0, 8), vec2i(8, 8));
  for (var i = 0; i < 4; i++) {
    let p = clampPx(did + offs[i]);
    let q = gtid + offs[i];
    let radiance = textureLoad(t_radiance, p, 0).xyz;
    let variance = textureLoad(t_variance, p, 0).x;
    let normal = textureLoad(t_normrough, p, 0).xyz;
    let uv = (vec2f(p) + 0.5) / vec2f(P.renderSize);
    let depth = getLinearDepth(uv, textureLoad(t_depth, p, 0).x);
    wg_rv[q.y][q.x] = vec4f(radiance, variance);
    wg_nd[q.y][q.x] = vec4f(normal, depth);
  }
}

fn edgeStoppingNormalWeight(np: vec3f, nq: vec3f) -> f32 { return pow(max(dot(np, nq), 0.0), PREFILTER_NORMAL_SIGMA); }
fn edgeStoppingDepthWeight(cd: f32, nd: f32) -> f32 { return exp(-abs(cd - nd) * cd * PREFILTER_DEPTH_SIGMA); }
fn radianceWeight(cr: vec3f, nr: vec3f, variance: f32) -> f32 {
  return max(exp(-(RADIANCE_WEIGHT_BIAS + variance * RADIANCE_WEIGHT_VARIANCE_K) * length(cr - nr)), 1.0e-2);
}

const SAMPLE_OFFSETS = array<vec2i, 15>(
  vec2i(0, 1), vec2i(-2, 1), vec2i(2, -3), vec2i(-3, 0), vec2i(1, 2), vec2i(-1, -2), vec2i(3, 0), vec2i(-3, 3),
  vec2i(0, -3), vec2i(-1, -1), vec2i(2, 1), vec2i(-2, -2), vec2i(1, 0), vec2i(0, 2), vec2i(3, -1));

@compute @workgroup_size(8, 8)
fn main(@builtin(local_invocation_id) lid: vec3u, @builtin(global_invocation_id) gdid: vec3u) {
  let did = vec2i(gdid.xy);
  var gtid = vec2i(lid.xy);
  let inb = all(gdid.xy < P.renderSize);
  let pd = clampPx(did);
  let center_roughness = toLinearRoughness(textureLoad(t_normrough, pd, 0).w);
  initializeGroupSharedMemory(did, gtid);
  workgroupBarrier();
  gtid += 4;
  let center = loadNS(gtid);
  var resolved_radiance = center.radiance;
  var resolved_variance = center.variance;
  let needs_denoiser = center.variance > 0.0 && isGlossyReflection(center_roughness) && !isMirrorReflection(center_roughness);
  if (needs_denoiser) {
    let uv8 = (vec2f(did) + 0.5) / vec2f(roundUp8(P.renderSize));
    let avg_radiance = textureSampleLevel(t_avg_radiance, s_linear, uv8, 0.0).xyz;
    // FFX_DNSR_Reflections_Resolve
    var accumulated_weight = radianceWeight(avg_radiance, center.radiance, center.variance);
    var accumulated_radiance = center.radiance * accumulated_weight;
    var accumulated_variance = center.variance * accumulated_weight * accumulated_weight;
    let variance_weight = max(PREFILTER_VARIANCE_BIAS, 1.0 - exp(-(center.variance * PREFILTER_VARIANCE_WEIGHT)));
    for (var i = 0; i < 15; i++) {
      let nb = loadNS(gtid + SAMPLE_OFFSETS[i]);
      var w = 1.0;
      w *= edgeStoppingNormalWeight(center.normal, nb.normal);
      w *= edgeStoppingDepthWeight(center.depth, nb.depth);
      w *= radianceWeight(avg_radiance, nb.radiance, center.variance);
      w *= variance_weight;
      accumulated_weight += w;
      accumulated_radiance += w * nb.radiance;
      accumulated_variance += w * w * nb.variance;
    }
    resolved_radiance = accumulated_radiance / accumulated_weight;
    resolved_variance = accumulated_variance / (accumulated_weight * accumulated_weight);
  }
  if (inb) {
    textureStore(o_radiance, did, vec4f(resolved_radiance, resolved_radiance.z));
    textureStore(o_variance, did, vec4f(resolved_variance));
  }
}
`;

export const RESOLVE_TEMPORAL_WGSL = /* wgsl */ `
${REFLECTION_PARAMS_WGSL}
@group(0) @binding(1) var t_normrough: texture_2d<f32>;
@group(0) @binding(2) var t_radiance: texture_2d<f32>;
@group(0) @binding(3) var t_variance: texture_2d<f32>;
@group(0) @binding(4) var t_sample_count: texture_2d<f32>;
@group(0) @binding(5) var t_avg_radiance: texture_2d<f32>;
@group(0) @binding(6) var t_reprojected: texture_2d<f32>;
@group(0) @binding(7) var s_linear: sampler;
@group(0) @binding(8) var o_radiance: texture_storage_2d<rgba16float, write>;
@group(0) @binding(9) var o_variance: texture_storage_2d<r32float, write>;

const RADIANCE_THRESHOLD: f32 = 0.0001;
var<workgroup> wg_radiance: array<array<vec3f, 16>, 16>;

fn initializeGroupSharedMemory(did_in: vec2i, gtid: vec2i) {
  let did = did_in - 4;
  let offs = array<vec2i, 4>(vec2i(0, 0), vec2i(8, 0), vec2i(0, 8), vec2i(8, 8));
  for (var i = 0; i < 4; i++) {
    let q = gtid + offs[i];
    wg_radiance[q.y][q.x] = textureLoad(t_radiance, clampPx(did + offs[i]), 0).xyz;
  }
}

struct Moments { mean: vec3f, variance: vec3f };
fn estimateLocalNeighborhoodInGroup(gtid: vec2i) -> Moments {
  var m = Moments(vec3f(0.0), vec3f(0.0));
  var acc = 0.0;
  for (var j = -LOCAL_NEIGHBORHOOD_RADIUS; j <= LOCAL_NEIGHBORHOOD_RADIUS; j++) {
    for (var i = -LOCAL_NEIGHBORHOOD_RADIUS; i <= LOCAL_NEIGHBORHOOD_RADIUS; i++) {
      let q = gtid + vec2i(i, j);
      let radiance = wg_radiance[q.y][q.x];
      let w = localNeighborhoodKernelWeight(f32(i)) * localNeighborhoodKernelWeight(f32(j));
      acc += w;
      m.mean += radiance * w;
      m.variance += radiance * radiance * w;
    }
  }
  m.mean /= acc;
  m.variance /= acc;
  m.variance = abs(m.variance - m.mean * m.mean);
  return m;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(local_invocation_id) lid: vec3u, @builtin(global_invocation_id) gdid: vec3u) {
  let did = vec2i(gdid.xy);
  var gtid = vec2i(lid.xy);
  let inb = all(gdid.xy < P.renderSize);
  let pd = clampPx(did);
  let history_clip_weight = P.temporalStabilityFactor;
  initializeGroupSharedMemory(did, gtid);
  workgroupBarrier();
  gtid += 4;
  let radiance = wg_radiance[gtid.y][gtid.x];
  if (radiance.x + radiance.y + radiance.z < RADIANCE_THRESHOLD) {
    if (inb) {
      textureStore(o_radiance, did, vec4f(0.0));
      textureStore(o_variance, did, vec4f(0.0));
    }
    return;
  }
  var new_signal = radiance;
  let roughness = toLinearRoughness(textureLoad(t_normrough, pd, 0).w);
  var new_variance = textureLoad(t_variance, pd, 0).x;
  if (isGlossyReflection(roughness)) {
    let num_samples = textureLoad(t_sample_count, pd, 0).x;
    let uv8 = (vec2f(did) + 0.5) / vec2f(roundUp8(P.renderSize));
    let avg_radiance = textureSampleLevel(t_avg_radiance, s_linear, uv8, 0.0).xyz;
    let old_signal = textureLoad(t_reprojected, pd, 0).xyz;
    var ln = estimateLocalNeighborhoodInGroup(gtid);
    // Clip history based on the current local statistics
    let color_std = (sqrt(ln.variance) + length(ln.mean - avg_radiance)) * history_clip_weight * 1.4;
    ln.mean = mix(ln.mean, avg_radiance, vec3f(0.2));
    let radiance_min = ln.mean - color_std;
    let radiance_max = ln.mean + color_std;
    let clipped_old_signal = clipAABB(radiance_min, radiance_max, old_signal);
    let accumulation_speed = 1.0 / max(num_samples, 1.0);
    let weight = 1.0 - accumulation_speed;
    // Blend with average for small sample count
    new_signal = mix(new_signal, avg_radiance, 1.0 / max(num_samples + 1.0, 1.0));
    // Clip outliers
    {
      let rmin = avg_radiance - color_std;
      let rmax = avg_radiance + color_std;
      new_signal = clipAABB(rmin, rmax, new_signal);
    }
    // Blend with history
    new_signal = mix(new_signal, clipped_old_signal, weight);
    new_variance = mix(computeTemporalVariance(new_signal, clipped_old_signal), new_variance, weight);
    if (anyNotFinite3(new_signal) || notFinite(new_variance)) {
      new_signal = vec3f(0.0);
      new_variance = 0.0;
    }
  }
  if (inb) {
    textureStore(o_radiance, did, vec4f(new_signal, new_signal.z));
    textureStore(o_variance, did, vec4f(new_variance));
  }
}
`;
