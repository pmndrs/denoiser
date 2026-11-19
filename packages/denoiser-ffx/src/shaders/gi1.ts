// WGSL port of AMD GI-1.0's image-space GI denoiser, as AMD Capsaicin v1.3 ships it
// (https://github.com/GPUOpen-LibrariesAndSDKs/Capsaicin, commit 914b915):
//   src/core/src/render_techniques/gi1/gi_denoiser.hlsl        (bindings and helpers)
//   src/core/src/render_techniques/gi1/gi1.comp:3997-4103       ReprojectGI
//   src/core/src/render_techniques/gi1/gi1.comp:4105-4154       FilterGI
// Paper: "GI-1.0: A Fast and Scalable Two-level Radiance Caching Scheme for Real-time
// Global Illumination" (Boissé et al., AMD, 2023, arXiv 2310.19855), section 2.4.3.
//
// Copyright (c) 2025 Advanced Micro Devices, Inc. All rights reserved.
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.  IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
// THE SOFTWARE.
//
// Port notes (deviations from the source; docs/specs/temporal.md, "GI-1.0 port"):
// - The noisy input is its own texture (Capsaicin's InterpolateScreenProbes writes it into
//   g_GIDenoiser_ColorBuffer, which ReprojectGI then reads and overwrites in place). A
//   non-finite input sample is treated as a sample not to keep, with value 0.
// - The current depth and normal are read from the caller's guides (any depth format; signed
//   or unorm normals). The sky is a zero normal (Capsaicin's test) or a depth at the far plane
//   (FrameGuides doesn't promise a zero normal).
// - Capsaicin's previous depth and shading normal are its renderer's shared "Prev*" textures;
//   here the caller hands its own copies (FrameGuides.previousDepth / previousNormal), or a
//   "keep" pass at the end of the frame copies depth (r32float) and the signed normal
//   (rgba16float, zero on the sky) for the next frame.
// - Every rgba16float / packed-half store rounds to the nearest half (pmndrs/gi's
//   rcNearestHalf): rgba16float stores and pack2x16float truncate on some GPUs, which pulls a
//   running sum down by up to a half step per store (pmndrs/gi register D48). With that the
//   colour history is RGBA16F as in Capsaicin. The colour delta (R16F) and the blur mask
//   (R8_SNORM, its snorm8 values) share one r32uint as two halves (neither is a storage format).
// - RemoveNaNs tests for NaN / infinity with a bit test instead of relying on saturate(NaN) = 0,
//   which WGSL doesn't promise, and is applied to the history's mean and count, not to its
//   running sum: Capsaicin's form caps the sum at 1e4, i.e. the irradiance at 1e4 / count
//   (156 with 64 samples). Ours caps the irradiance at 1e4.
// - Positions are rebuilt relative to the current camera (the host computes both inverse
//   view-projections in double precision around the current eye), so g_Eye is the origin.
// - Linear depth comes from the inverse projection (any depth convention) instead of
//   toLinearDepth(depth, g_NearFar).
// - Motion is FrameGuides' NDC delta (current - previous, y up), scaled to Capsaicin's uv
//   velocity (current - previous, y down) by P.motionScale.
// - Nearest-sampler reads (SampleLevel with g_NearestSampler) are textureLoad at the clamped
//   texel: the same texel a clamp-to-edge nearest sampler returns.
// - Port additions, switchable (Gi1DenoiserOptions):
//   * historyClamp 'neighbourhood' (default): a short history (about 4 samples) and its
//     luminance moments are reprojected with the long one; the long history's mean is clipped
//     to the short mean ± clipGamma × max(spatial, temporal) standard deviation in YCoCg
//     (A-SVGF / variance clipping). Capsaicin's delta still sees the unclipped history.
//     'none' = Capsaicin's history.
//   * changeReset (default on): inside changed regions (or everywhere, for a global change)
//     the history is shortened to at most 3 samples and alpha_blend is 0 (Capsaicin's own
//     4-sample cap), for as many frames as the host keeps the regions.

/** Changed regions the reprojection takes per frame (more count as everything changed). */
export const GI1_MAX_CHANGE_BOXES = 16;

const GI1_PARAMS_WGSL = /* wgsl */ `
struct Params {
  // Current inverse view-projection (jittered when the frame is), positions relative to the
  // current eye.
  invViewProj: mat4x4f,
  // Previous frame's inverse view-projection, positions relative to the CURRENT eye.
  prevInvViewProj: mat4x4f,
  // Linear depth from device depth d: -(x * d + y) / (z * d + w), from the inverse projection.
  linearDepth: vec4f,
  renderSize: vec2u,
  inverseRenderSize: vec2f,
  // guides.motion (NDC delta) -> Capsaicin's uv velocity (current - previous, y down).
  motionScale: vec2f,
  // g_ScreenProbesConstants.cell_size: world size per unit distance of about one probe tile.
  cellSize: f32,
  // FLAG_* below.
  flags: u32,
  // Port addition: the history clip's width in standard deviations (0 = off, Capsaicin as is)
  // and the radius of its spatial neighbourhood.
  clipGamma: f32,
  clipRadius: i32,
  // Port addition: changed regions (world boxes relative to the current eye).
  changeCount: u32,
  _pad0: u32,
  changeBoxes: array<vec4f, ${GI1_MAX_CHANGE_BOXES * 2}>,  // min, max pairs
};
@group(0) @binding(0) var<uniform> P: Params;

const FLAG_HISTORY_VALID: u32 = 1u;
const FLAG_HINT_IN_ALPHA: u32 = 2u;
const FLAG_REVERSED_DEPTH: u32 = 4u;
const FLAG_NORMALS_UNORM: u32 = 8u;
const FLAG_ALL_CHANGED: u32 = 16u;

// gi_denoiser.hlsl:26
const kGIDenoiser_MaxBlurMask: f32 = 8.0;
// Port addition (changeReset): the history kept inside a changed region, in samples.
const CHANGED_HISTORY_SAMPLES: f32 = 3.0;
// Port addition (historyClamp): the short history's length in samples.
const SHORT_HISTORY_SAMPLES: f32 = 4.0;
const LARGEST_HALF: f32 = 65504.0;

fn luminance(color: vec3f) -> f32 {
  return dot(color, vec3f(0.2126, 0.7152, 0.0722)); // math/color.hlsl:34-37
}

// transformPointProjection(uv, depth, transform) (math/transform.hlsl:94-113).
fn transformPointProjection(uv: vec2f, depth: f32, transform: mat4x4f) -> vec3f {
  let ret = transform * vec4f(2.0 * vec2f(uv.x, 1.0 - uv.y) - 1.0, depth, 1.0);
  return ret.xyz / ret.w;
}

// View-space distance along the view axis (toLinearDepth's role).
fn linearDepth(depth: f32) -> f32 {
  return -(P.linearDepth.x * depth + P.linearDepth.y) / (P.linearDepth.z * depth + P.linearDepth.w);
}

fn clampTexel(st: vec2f) -> vec2i {
  return clamp(vec2i(floor(st * vec2f(P.renderSize))), vec2i(0), vec2i(P.renderSize) - 1);
}

fn atFarPlane(depth: f32) -> bool {
  return select(depth >= 1.0, depth <= 0.0, (P.flags & FLAG_REVERSED_DEPTH) != 0u);
}

// NaN or infinity, by the bits: WGSL lets compilers assume finite maths, so x != x can fold away.
fn isFinite(x: f32) -> bool {
  return (bitcast<u32>(x) & 0x7f800000u) != 0x7f800000u;
}
fn isFinite3(v: vec3f) -> bool {
  return isFinite(v.x) && isFinite(v.y) && isFinite(v.z);
}

// GIDenoiser_RemoveNaNs (gi_denoiser.hlsl:64-91): squashes, saturates and unsquashes, so a NaN
// or infinite value comes out finite (at most 1e4). The non-finite case is explicit (0, what
// HLSL's saturate(NaN) gives) rather than left to saturate.
fn removeNaNs1(c: f32) -> f32 {
  var color = c / (1.0 + c);
  color = select(0.0, color, isFinite(color));
  color = saturate(color);
  return color / max(1.0 - color, 1e-4);
}
fn removeNaNs3(c: vec3f) -> vec3f {
  return vec3f(removeNaNs1(c.x), removeNaNs1(c.y), removeNaNs1(c.z));
}

// The half nearest to value, a tie to the even one (pmndrs/gi's rcNearestHalf, MIT): written
// before every half store, since stores and pack2x16float truncate on some GPUs.
fn nearestHalf(value: f32) -> f32 {
  let clamped = clamp(value, -LARGEST_HALF, LARGEST_HALF);
  let bits = pack2x16float(vec2f(clamped, 0.0)) & 0xffffu;
  let magnitude = abs(clamped);
  let packedMagnitude = abs(unpack2x16float(bits).x);
  if (magnitude == packedMagnitude) {
    return unpack2x16float(bits).x;
  }
  var lower = bits;
  var upper = bits + 1u;
  if (packedMagnitude > magnitude) {
    lower = bits - 1u;
    upper = bits;
  } else if ((bits & 0x7fffu) >= 0x7bffu) {
    return unpack2x16float(bits).x;
  }
  let below = magnitude - abs(unpack2x16float(lower).x);
  let above = abs(unpack2x16float(upper).x) - magnitude;
  let upperIsEven = (upper & 1u) == 0u;
  return unpack2x16float(select(lower, upper, above < below || (above == below && upperIsEven))).x;
}
fn nearestHalf4(v: vec4f) -> vec4f {
  return vec4f(nearestHalf(v.x), nearestHalf(v.y), nearestHalf(v.z), nearestHalf(v.w));
}
`;

/** The guides read in place: depth (a depth format or a float colour format) and the normal. */
function guidesWgsl(depthIsDepthFormat: boolean, first: number): string {
  return /* wgsl */ `
@group(0) @binding(${first}) var depthBuffer: ${depthIsDepthFormat ? 'texture_depth_2d' : 'texture_2d<f32>'};  // g_DepthBuffer
@group(0) @binding(${first + 1}) var shadingNormalBuffer: texture_2d<f32>;  // g_ShadingNormalBuffer

fn loadDepth(p: vec2u) -> f32 {
  return ${depthIsDepthFormat ? 'textureLoad(depthBuffer, p, 0)' : 'textureLoad(depthBuffer, p, 0).x'};
}

// The signed shading normal, zero on the sky (Capsaicin decodes its unorm normal as 2n - 1).
fn loadNormal(p: vec2u) -> vec3f {
  var normal = textureLoad(shadingNormalBuffer, p, 0).xyz;
  if (dot(normal, normal) == 0.0 || atFarPlane(loadDepth(p))) {
    return vec3f(0.0);
  }
  if ((P.flags & FLAG_NORMALS_UNORM) != 0u) {
    normal = 2.0 * normal - 1.0;
  }
  return normal;
}
`;
}

/**
 * Port addition: this frame's depth and signed normal kept for the next frame's reprojection,
 * after the frame's last read of the previous ones (only when the caller keeps no copies).
 */
export function gi1KeepWgsl(depthIsDepthFormat: boolean): string {
  return /* wgsl */ `
${GI1_PARAMS_WGSL}
${guidesWgsl(depthIsDepthFormat, 1)}
@group(0) @binding(3) var depthOut: texture_storage_2d<r32float, write>;
@group(0) @binding(4) var normalOut: texture_storage_2d<rgba16float, write>;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) did: vec3u) {
  if (any(did.xy >= P.renderSize)) {
    return; // out of bounds
  }
  textureStore(depthOut, did.xy, vec4f(loadDepth(did.xy), 0.0, 0.0, 0.0));
  textureStore(normalOut, did.xy, vec4f(loadNormal(did.xy), 0.0));
}
`;
}

/** ReprojectGI (gi1.comp:3996-4103). */
export function gi1ReprojectWgsl(depthIsDepthFormat: boolean): string {
  return /* wgsl */ `
${GI1_PARAMS_WGSL}
// g_GIDenoiser_ColorBuffer as InterpolateScreenProbes left it: irradiance, hint in alpha.
@group(0) @binding(1) var colorIn: texture_2d<f32>;
${guidesWgsl(depthIsDepthFormat, 2)}
@group(0) @binding(4) var velocityBuffer: texture_2d<f32>;           // g_VelocityBuffer (guides.motion)
@group(0) @binding(5) var previousColorBuffer: texture_2d<f32>;      // g_GIDenoiser_PreviousColorBuffer
@group(0) @binding(6) var previousDepthBuffer: texture_2d<f32>;      // g_PreviousDepthBuffer
@group(0) @binding(7) var previousDetailsBuffer: texture_2d<f32>;    // g_PreviousDetailsBuffer (previous normal)
@group(0) @binding(8) var previousDeltaMaskBuffer: texture_2d<u32>;  // g_GIDenoiser_PreviousColorDeltaBuffer (low half)
@group(0) @binding(9) var previousShortBuffer: texture_2d<f32>;      // port addition: short history
@group(0) @binding(10) var colorBuffer: texture_storage_2d<rgba16float, write>;  // g_GIDenoiser_ColorBuffer
@group(0) @binding(11) var shortBuffer: texture_storage_2d<rgba16float, write>;  // port addition
@group(0) @binding(12) var deltaMaskBuffer: texture_storage_2d<r32uint, write>;  // colour delta | blur mask << 16

// R8_SNORM's conversion (round to nearest /127), so the radius FilterGI reads is Capsaicin's.
fn snorm8(value: f32) -> f32 {
  return round(clamp(value, -1.0, 1.0) * 127.0) / 127.0;
}

fn toYCoCg(c: vec3f) -> vec3f {
  return vec3f(dot(c, vec3f(0.25, 0.5, 0.25)), dot(c, vec3f(0.5, 0.0, -0.5)), dot(c, vec3f(-0.25, 0.5, -0.25)));
}
fn fromYCoCg(c: vec3f) -> vec3f {
  return vec3f(c.x + c.y - c.z, c.x + c.z, c.x - c.y - c.z);
}

// Port addition: is this point (relative to the current eye) inside a changed region?
fn inChangedRegion(world: vec3f) -> bool {
  if ((P.flags & FLAG_ALL_CHANGED) != 0u) {
    return true;
  }
  for (var i = 0u; i < P.changeCount; i++) {
    if (all(world >= P.changeBoxes[2u * i].xyz) && all(world <= P.changeBoxes[2u * i + 1u].xyz)) {
      return true;
    }
  }
  return false;
}

// Port addition: the spatial standard deviation of this frame's input around the pixel, per
// YCoCg channel. Sky pixels, non-finite samples and, with the hint, samples not to keep are
// left out.
fn spatialSigma(did: vec2u) -> vec3f {
  var m1 = vec3f(0.0);
  var m2 = vec3f(0.0);
  var n = 0.0;
  let hint = (P.flags & FLAG_HINT_IN_ALPHA) != 0u;
  for (var dy = -P.clipRadius; dy <= P.clipRadius; dy++) {
    for (var dx = -P.clipRadius; dx <= P.clipRadius; dx++) {
      let p = vec2u(clamp(vec2i(did) + vec2i(dx, dy), vec2i(0), vec2i(P.renderSize) - 1));
      let c = textureLoad(colorIn, p, 0);
      let normal = loadNormal(p);
      if (dot(normal, normal) == 0.0 || (hint && c.w <= 0.0) || !isFinite3(c.xyz)) {
        continue;
      }
      let y = toYCoCg(c.xyz);
      m1 += y;
      m2 += y * y;
      n += 1.0;
    }
  }
  if (n == 0.0) {
    return vec3f(0.0);
  }
  let mean = m1 / n;
  return sqrt(max(m2 / n - mean * mean, vec3f(0.0)));
}

// Port addition: a colour clipped toward the box around centre (YCoCg), Playdead's ClipAABB
// toward the centre as FFX reflections' resolve does.
fn clipToBox(value: vec3f, centre: vec3f, extent: vec3f) -> vec3f {
  let v = toYCoCg(value) - centre;
  let units = abs(v / max(extent, vec3f(1e-7)));
  let largest = max(units.x, max(units.y, units.z));
  if (largest <= 1.0) {
    return value;
  }
  return fromYCoCg(centre + v / largest);
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let did = id.xy;
  if (any(did >= P.renderSize)) {
    return; // out of bounds
  }

  var color = textureLoad(colorIn, did, 0);
  if ((P.flags & FLAG_HINT_IN_ALPHA) == 0u) {
    color.w = 1.0; // no hint: every pixel is a sample to keep
  }
  if (!isFinite3(color.xyz)) {
    color = vec4f(0.0); // port: a non-finite sample is not kept
  }
  var lighting = vec4f(0.0);
  var shortHistory = vec4f(0.0); // port addition: rgb mean of about 4 samples, a: mean luminance²
  let normal = loadNormal(did);

  var alpha_blend = 1.0;
  var color_delta = 0.0;
  var weight = 0.0;
  var changed = false;
  let bufferDimensions = vec2f(P.renderSize);
  let uv = (vec2f(did) + 0.5) / bufferDimensions;
  let is_sky_pixel = dot(normal, normal) == 0.0;
  let historyValid = (P.flags & FLAG_HISTORY_VALID) != 0u;

  if (!is_sky_pixel) {
    let velocity = textureLoad(velocityBuffer, did, 0).xy * P.motionScale;
    let previous_uv = uv - velocity;

    let depth = loadDepth(did);

    if (all(previous_uv > vec2f(0.0)) && all(previous_uv < vec2f(1.0))) {
      let world = transformPointProjection(uv, depth, P.invViewProj);
      var cell_size = length(world) * P.cellSize; // distance(g_Eye, world), the eye at the origin
      changed = inChangedRegion(world);

      // pow(t, 6.0) as products: WGSL's pow is exp2(y * log2(x)), undefined at x = 0 (facing the camera).
      let grazing = 1.0 - max(dot(normalize(-world), normalize(normal)), 0.0);
      let grazing3 = grazing * grazing * grazing;
      cell_size *= mix(1.0, 5.0, grazing3 * grazing3);

      let texel_size = P.inverseRenderSize;

      let kOneOverSqrtOfTwo = 0.707107;

      for (var y = -1.0; y <= 1.0; y += 1.0) {
        for (var x = -1.0; x <= 1.0; x += 1.0) {
          let st = previous_uv + vec2f(x, y) * texel_size;
          let texel = clampTexel(st);
          let c = textureLoad(previousColorBuffer, texel, 0);
          let previous_normal = textureLoad(previousDetailsBuffer, texel, 0).xyz;
          let previous_depth = textureLoad(previousDepthBuffer, texel, 0).x;

          // Port: with no history (first frame, after resetHistory) every sample is invalid, as
          // Capsaicin's freshly zeroed buffers are; a caller's previous depth at the far plane is sky.
          if (!historyValid || c.w < 1.0 || dot(previous_normal, previous_normal) == 0.0 || atFarPlane(previous_depth)) {
            continue; // skip invalid sample(s)
          }

          let previous_world = transformPointProjection(st, previous_depth, P.prevInvViewProj);

          if (distance(world, previous_world) < cell_size && dot(normal, previous_normal) > 0.95) {
            let subpixel_dist = distance(floor(st * bufferDimensions) + 0.5, previous_uv * bufferDimensions);
            let w = saturate(1.0 - subpixel_dist * kOneOverSqrtOfTwo);

            color_delta += w * unpack2x16float(textureLoad(previousDeltaMaskBuffer, texel, 0).x).x;
            lighting += w * c;
            shortHistory += w * textureLoad(previousShortBuffer, texel, 0);
            weight += w;
          }
        }
      }

      if (weight > 0.0) {
        let s = sign(color_delta);
        color_delta = removeNaNs1(abs(color_delta) / weight);
        color_delta *= s; // restore delta

        // Capsaicin: lighting = GIDenoiser_RemoveNaNs(lighting / weight), which caps the sum.
        // Port: the same on the count and on the mean (see the port notes).
        let count = removeNaNs1(lighting.w / weight);
        let mean = removeNaNs3(lighting.xyz / weight / max(count, 1.0));
        lighting = vec4f(mean * max(count, 1.0), count);
        shortHistory = vec4f(removeNaNs3(shortHistory.xyz / weight), removeNaNs1(shortHistory.w / weight));
      }

      if (color.w > 0.0) {
        let lumaA = luminance(color.xyz);
        // Capsaicin's delta, on the unclipped history, so the history length still adapts.
        let lumaB = luminance(lighting.xyz / max(lighting.w, 1.0));

        color_delta = mix(color_delta, lumaA - lumaB, 1.0 / 8.0); // smoothed delta
        alpha_blend = saturate(1.0 - abs(color_delta) / max(lumaB, 1e-4));
      }
    }
  }

  let blur_mask = select(-1.0, max(kGIDenoiser_MaxBlurMask - lighting.w, 0.0), !is_sky_pixel);

  // Port addition (changeReset): inside a changed region, keep at most 3 samples so the new
  // one weighs a quarter, and cap the history at Capsaicin's 4 (alpha_blend 0).
  if (changed && weight > 0.0) {
    alpha_blend = 0.0;
    if (lighting.w > CHANGED_HISTORY_SAMPLES) {
      lighting *= CHANGED_HISTORY_SAMPLES / lighting.w;
    }
  }

  // Port addition (historyClamp): the short history takes this frame's sample (a running mean
  // over at most 4), then bounds the long history's mean.
  let lumaA = luminance(color.xyz);
  if (color.w > 0.0) {
    if (weight > 0.0) {
      let a = 1.0 / min(max(lighting.w, 0.0) + 1.0, SHORT_HISTORY_SAMPLES);
      shortHistory = vec4f(mix(shortHistory.xyz, color.xyz, a), mix(shortHistory.w, lumaA * lumaA, a));
    } else {
      shortHistory = vec4f(color.xyz, lumaA * lumaA);
    }
  } else if (weight == 0.0) {
    shortHistory = vec4f(color.xyz, lumaA * lumaA); // a fallback sample, shown but not kept
  }
  if (P.clipGamma > 0.0 && weight > 0.0 && !is_sky_pixel) {
    let shortLuma = luminance(shortHistory.xyz);
    let temporalSigma = sqrt(max(shortHistory.w - shortLuma * shortLuma, 0.0));
    let extent = P.clipGamma * max(spatialSigma(did), vec3f(temporalSigma));
    let count = max(lighting.w, 1.0);
    lighting = vec4f(clipToBox(lighting.xyz / count, toYCoCg(shortHistory.xyz), extent) * count, lighting.w);
  }

  if (color.w > 0.0 || lighting.w < 1.0) { // append new sample
    lighting += vec4f(color.xyz, select(-1.0, 1.0, color.w > 0.0));
  }

  let vignette_uv = uv * (1.0 - uv.yx);
  let vignette = sqrt(sqrt(15.0 * vignette_uv.x * vignette_uv.y)); // pow(x, 0.25)
  let max_sample_count = max(mix(4.0, 8.0 * min(abs(lighting.w), kGIDenoiser_MaxBlurMask), alpha_blend) * vignette, 1.0);

  if (lighting.w > max_sample_count) { // evict old samples from the history
    lighting *= (max_sample_count / lighting.w);
  }

  let mask = nearestHalf(snorm8(blur_mask / kGIDenoiser_MaxBlurMask));
  textureStore(deltaMaskBuffer, did, vec4u(pack2x16float(vec2f(nearestHalf(color_delta), mask)), 0u, 0u, 0u));
  textureStore(colorBuffer, did, nearestHalf4(lighting));
  textureStore(shortBuffer, did, nearestHalf4(shortHistory));
}
`;
}

/**
 * FilterGI (gi1.comp:4105-4154), one direction: Capsaicin dispatches it twice, horizontally
 * then vertically (gi1.cpp:2898-2926); the vertical pass also writes the output
 * (g_IrradianceBuffer).
 */
export function gi1FilterWgsl(vertical: boolean, depthIsDepthFormat: boolean): string {
  return /* wgsl */ `
${GI1_PARAMS_WGSL}
@group(0) @binding(1) var previousColorBuffer: texture_2d<f32>; // this pass's input (Capsaicin's naming)
@group(0) @binding(2) var deltaMaskBuffer: texture_2d<u32>;     // the blur mask in the high half
${guidesWgsl(depthIsDepthFormat, 3)}
@group(0) @binding(5) var colorBuffer: texture_storage_2d<rgba16float, write>;
${vertical ? '@group(0) @binding(6) var irradianceBuffer: texture_storage_2d<rgba16float, write>;' : ''}

const blurDirection = vec2i(${vertical ? '0, 1' : '1, 0'}); // g_BlurDirection

// GIDenoiser_GetBlurRadius (gi_denoiser.hlsl:42-54).
fn getBlurRadius(pos: vec2u) -> i32 {
  var blur_radius = 0;
  let blur_mask = unpack2x16float(textureLoad(deltaMaskBuffer, pos, 0).x).y * kGIDenoiser_MaxBlurMask;

  if (blur_mask > 0.0) {
    blur_radius = i32(max(blur_mask, 1.0) + 0.5);
  }

  return blur_radius;
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let did = id.xy;
  if (any(did >= P.renderSize)) {
    return; // out of bounds
  }

  var lighting = textureLoad(previousColorBuffer, did, 0);
  let blur_radius = getBlurRadius(did);

  if (blur_radius > 0) {
    var weight = 1.0;
    var color = lighting.xyz / max(lighting.w, 1.0);

    let center_depth = linearDepth(loadDepth(did));
    let center_normal = loadNormal(did);

    for (var r = -blur_radius; r <= blur_radius; r++) {
      let pos = vec2u(clamp(vec2i(did) + r * blurDirection, vec2i(0), vec2i(P.renderSize) - 1));
      let c = textureLoad(previousColorBuffer, pos, 0);

      if (c.w > 0.0) {
        let depth = linearDepth(loadDepth(pos));
        let normal = loadNormal(pos);

        let depth_diff = 1.0 - (center_depth / depth);
        let depth_factor = exp2(-select(2e1, 2e2, lighting.w > 0.0) * abs(depth_diff));
        var normal_factor = max(dot(normal, center_normal), 0.0);
        normal_factor *= normal_factor;
        normal_factor *= normal_factor;

        let w = depth_factor * select(1.0, normal_factor, lighting.w > 0.0);

        color += w * (c.xyz / max(c.w, 1.0));
        weight += w;
      }
    }

    lighting = vec4f((color / weight) * max(lighting.w, 1.0), lighting.w);
  }
${vertical ? `
  textureStore(irradianceBuffer, did, nearestHalf4(vec4f(lighting.xyz / max(lighting.w, 1.0), 1.0)));` : ''}

  textureStore(colorBuffer, did, nearestHalf4(lighting));
}
`;
}
