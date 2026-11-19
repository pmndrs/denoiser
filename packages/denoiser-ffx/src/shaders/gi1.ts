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
//   g_GIDenoiser_ColorBuffer, which ReprojectGI then reads and overwrites in place).
// - Capsaicin's previous depth and shading normal are its renderer's shared "Prev*" textures;
//   here a prepare pass copies this frame's depth (r32float) and normal (rgba16float, signed)
//   into a ping-pong pair, or the caller hands its own copies (FrameGuides.previousDepth /
//   previousNormal). The prepare pass also marks the sky (zero normal) where the depth is at
//   the far plane: Capsaicin's visibility buffer writes a zero normal there, FrameGuides
//   doesn't promise one.
// - The colour history (RGBA16F in Capsaicin) is rgba32float and the colour delta (R16F) is
//   r32float: the history is a running sum of up to 64 samples rewritten three times a frame,
//   and rgba16float stores truncate on some GPUs (measured by pmndrs/gi, its register D48),
//   which pulls a constant field down by about a half step per store. The blur mask (R8_SNORM,
//   not a WebGPU storage format) is r32float holding the same snorm8 values (rounded to /127).
// - Positions are rebuilt relative to the current camera (the host computes both inverse
//   view-projections in double precision around the current eye), so g_Eye is the origin.
//   Same distances as Capsaicin's world-space positions, without f32 cancellation far from
//   the world origin.
// - Linear depth comes from the inverse projection (any depth convention) instead of
//   toLinearDepth(depth, g_NearFar).
// - Motion is FrameGuides' NDC delta (current - previous, y up), scaled to Capsaicin's uv
//   velocity (current - previous, y down) by P.motionScale.
// - Nearest-sampler reads (SampleLevel with g_NearestSampler) are textureLoad at the clamped
//   texel: the same texel a clamp-to-edge nearest sampler returns.

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
  // bit 0: history valid; bit 1: radiance.a is GI-1.0's denoiser hint; bit 2: reversed depth;
  // bit 3: guides.normal is unorm-encoded (0..1).
  flags: u32,
};
@group(0) @binding(0) var<uniform> P: Params;

const FLAG_HISTORY_VALID: u32 = 1u;
const FLAG_HINT_IN_ALPHA: u32 = 2u;
const FLAG_REVERSED_DEPTH: u32 = 4u;
const FLAG_NORMALS_UNORM: u32 = 8u;

// gi_denoiser.hlsl:26
const kGIDenoiser_MaxBlurMask: f32 = 8.0;

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

// GIDenoiser_RemoveNaNs (gi_denoiser.hlsl:64-91): squashes, saturates and unsquashes, so a NaN
// or infinite value comes out finite (at most 1e4).
fn removeNaNs1(c: f32) -> f32 {
  var color = c / (1.0 + c);
  color = saturate(color);
  return color / max(1.0 - color, 1e-4);
}
fn removeNaNs4(c: vec4f) -> vec4f {
  var color = c / (1.0 + c);
  color = saturate(color);
  return color / max(1.0 - color, vec4f(1e-4));
}
`;

/**
 * Port addition: this frame's depth and normal copied into the denoiser's own textures, the
 * sky marked by a zero normal (Capsaicin's sky test, gi1.comp:4012).
 */
export function gi1PrepareWgsl(depthIsDepthFormat: boolean): string {
  return /* wgsl */ `
${GI1_PARAMS_WGSL}
@group(0) @binding(1) var depthIn: ${depthIsDepthFormat ? 'texture_depth_2d' : 'texture_2d<f32>'};
@group(0) @binding(2) var normalIn: texture_2d<f32>;
@group(0) @binding(3) var depthOut: texture_storage_2d<r32float, write>;
@group(0) @binding(4) var normalOut: texture_storage_2d<rgba16float, write>;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) did: vec3u) {
  if (any(did.xy >= P.renderSize)) {
    return; // out of bounds
  }
  let depth = ${depthIsDepthFormat ? 'textureLoad(depthIn, did.xy, 0)' : 'textureLoad(depthIn, did.xy, 0).x'};
  var normal = textureLoad(normalIn, did.xy, 0).xyz;
  let reversed = (P.flags & FLAG_REVERSED_DEPTH) != 0u;
  let atFarPlane = select(depth >= 1.0, depth <= 0.0, reversed);
  // The sky test on the stored value, then Capsaicin's decode of a unorm normal (2 * n - 1).
  let isSky = dot(normal, normal) == 0.0 || atFarPlane;
  if ((P.flags & FLAG_NORMALS_UNORM) != 0u) {
    normal = 2.0 * normal - 1.0;
  }
  textureStore(depthOut, did.xy, vec4f(depth, 0.0, 0.0, 0.0));
  textureStore(normalOut, did.xy, select(vec4f(normal, 0.0), vec4f(0.0), isSky));
}
`;
}

/** ReprojectGI (gi1.comp:3996-4103). */
export const GI1_REPROJECT_WGSL = /* wgsl */ `
${GI1_PARAMS_WGSL}
// g_GIDenoiser_ColorBuffer as InterpolateScreenProbes left it: irradiance, hint in alpha.
@group(0) @binding(1) var colorIn: texture_2d<f32>;
@group(0) @binding(2) var depthBuffer: texture_2d<f32>;            // g_DepthBuffer
@group(0) @binding(3) var shadingNormalBuffer: texture_2d<f32>;    // g_ShadingNormalBuffer (signed, 0 = sky)
@group(0) @binding(4) var velocityBuffer: texture_2d<f32>;         // g_VelocityBuffer (guides.motion)
@group(0) @binding(5) var previousColorBuffer: texture_2d<f32>;    // g_GIDenoiser_PreviousColorBuffer
@group(0) @binding(6) var previousDepthBuffer: texture_2d<f32>;    // g_PreviousDepthBuffer
@group(0) @binding(7) var previousDetailsBuffer: texture_2d<f32>;  // g_PreviousDetailsBuffer (previous normal)
@group(0) @binding(8) var previousColorDeltaBuffer: texture_2d<f32>; // g_GIDenoiser_PreviousColorDeltaBuffer
@group(0) @binding(9) var colorBuffer: texture_storage_2d<rgba32float, write>;    // g_GIDenoiser_ColorBuffer
@group(0) @binding(10) var colorDeltaBuffer: texture_storage_2d<r32float, write>; // g_GIDenoiser_ColorDeltaBuffer
@group(0) @binding(11) var blurMaskBuffer: texture_storage_2d<r32float, write>;   // g_GIDenoiser_BlurMask

// R8_SNORM's conversion (round to nearest /127), so the radius FilterGI reads is Capsaicin's.
fn snorm8(value: f32) -> f32 {
  return round(clamp(value, -1.0, 1.0) * 127.0) / 127.0;
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
  var lighting = vec4f(0.0);
  var normal = textureLoad(shadingNormalBuffer, did, 0).xyz;

  var alpha_blend = 1.0;
  var color_delta = 0.0;
  let bufferDimensions = vec2f(P.renderSize);
  let uv = (vec2f(did) + 0.5) / bufferDimensions;
  let is_sky_pixel = dot(normal, normal) == 0.0;
  let historyValid = (P.flags & FLAG_HISTORY_VALID) != 0u;

  if (!is_sky_pixel) {
    let velocity = textureLoad(velocityBuffer, did, 0).xy * P.motionScale;
    let previous_uv = uv - velocity;

    let depth = textureLoad(depthBuffer, did, 0).x;
    // (Capsaicin decodes its unorm normal here: 2 * normal - 1. Ours are signed already.)

    if (all(previous_uv > vec2f(0.0)) && all(previous_uv < vec2f(1.0))) {
      let world = transformPointProjection(uv, depth, P.invViewProj);
      var cell_size = length(world) * P.cellSize; // distance(g_Eye, world), the eye at the origin

      // pow(t, 6.0) as products: WGSL's pow is exp2(y * log2(x)), undefined at x = 0 (facing the camera).
      let grazing = 1.0 - max(dot(normalize(-world), normalize(normal)), 0.0);
      let grazing3 = grazing * grazing * grazing;
      cell_size *= mix(1.0, 5.0, grazing3 * grazing3);

      var weight = 0.0;
      let texel_size = P.inverseRenderSize;

      let kOneOverSqrtOfTwo = 0.707107;

      for (var y = -1.0; y <= 1.0; y += 1.0) {
        for (var x = -1.0; x <= 1.0; x += 1.0) {
          let st = previous_uv + vec2f(x, y) * texel_size;
          let texel = clampTexel(st);
          let c = textureLoad(previousColorBuffer, texel, 0);
          let previous_normal = textureLoad(previousDetailsBuffer, texel, 0).xyz;

          // Port: with no history (first frame, after a reset) every sample is invalid, as
          // Capsaicin's freshly zeroed buffers are.
          if (!historyValid || c.w < 1.0 || dot(previous_normal, previous_normal) == 0.0) {
            continue; // skip invalid sample(s)
          }

          let previous_depth = textureLoad(previousDepthBuffer, texel, 0).x;
          let previous_world = transformPointProjection(st, previous_depth, P.prevInvViewProj);

          if (distance(world, previous_world) < cell_size && dot(normal, previous_normal) > 0.95) {
            let subpixel_dist = distance(floor(st * bufferDimensions) + 0.5, previous_uv * bufferDimensions);
            let w = saturate(1.0 - subpixel_dist * kOneOverSqrtOfTwo);

            color_delta += w * textureLoad(previousColorDeltaBuffer, texel, 0).x;
            lighting += w * c;
            weight += w;
          }
        }
      }

      if (weight > 0.0) {
        let s = sign(color_delta);
        color_delta = removeNaNs1(abs(color_delta) / weight);
        color_delta *= s; // restore delta

        lighting = removeNaNs4(lighting / weight);
      }

      if (color.w > 0.0) {
        let lumaA = luminance(color.xyz);
        let lumaB = luminance(lighting.xyz / max(lighting.w, 1.0));

        color_delta = mix(color_delta, lumaA - lumaB, 1.0 / 8.0); // smoothed delta
        alpha_blend = saturate(1.0 - abs(color_delta) / max(lumaB, 1e-4));
      }
    }
  }

  let blur_mask = select(-1.0, max(kGIDenoiser_MaxBlurMask - lighting.w, 0.0), !is_sky_pixel);

  if (color.w > 0.0 || lighting.w < 1.0) { // append new sample
    lighting += vec4f(color.xyz, select(-1.0, 1.0, color.w > 0.0));
  }

  let vignette_uv = uv * (1.0 - uv.yx);
  let vignette = sqrt(sqrt(15.0 * vignette_uv.x * vignette_uv.y)); // pow(x, 0.25)
  let max_sample_count = max(mix(4.0, 8.0 * min(abs(lighting.w), kGIDenoiser_MaxBlurMask), alpha_blend) * vignette, 1.0);

  if (lighting.w > max_sample_count) { // evict old samples from the history
    lighting *= (max_sample_count / lighting.w);
  }

  textureStore(blurMaskBuffer, did, vec4f(snorm8(blur_mask / kGIDenoiser_MaxBlurMask), 0.0, 0.0, 0.0));
  textureStore(colorBuffer, did, lighting);
  textureStore(colorDeltaBuffer, did, vec4f(color_delta, 0.0, 0.0, 0.0));
}
`;

/**
 * FilterGI (gi1.comp:4105-4154), one direction: Capsaicin dispatches it twice, horizontally
 * then vertically (gi1.cpp:2898-2926); the vertical pass also writes the output
 * (g_IrradianceBuffer).
 */
export function gi1FilterWgsl(vertical: boolean): string {
  return /* wgsl */ `
${GI1_PARAMS_WGSL}
@group(0) @binding(1) var previousColorBuffer: texture_2d<f32>; // this pass's input (Capsaicin's naming)
@group(0) @binding(2) var blurMaskBuffer: texture_2d<f32>;
@group(0) @binding(3) var depthBuffer: texture_2d<f32>;
@group(0) @binding(4) var shadingNormalBuffer: texture_2d<f32>;
@group(0) @binding(5) var colorBuffer: texture_storage_2d<rgba32float, write>;
${vertical ? '@group(0) @binding(6) var irradianceBuffer: texture_storage_2d<rgba16float, write>;' : ''}

const blurDirection = vec2i(${vertical ? '0, 1' : '1, 0'}); // g_BlurDirection

// GIDenoiser_GetBlurRadius (gi_denoiser.hlsl:42-54).
fn getBlurRadius(pos: vec2u) -> i32 {
  var blur_radius = 0;
  let blur_mask = textureLoad(blurMaskBuffer, pos, 0).x * kGIDenoiser_MaxBlurMask;

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

    let center_depth = linearDepth(textureLoad(depthBuffer, did, 0).x);
    let center_normal = textureLoad(shadingNormalBuffer, did, 0).xyz;

    for (var r = -blur_radius; r <= blur_radius; r++) {
      let pos = clamp(vec2i(did) + r * blurDirection, vec2i(0), vec2i(P.renderSize) - 1);
      let c = textureLoad(previousColorBuffer, pos, 0);

      if (c.w > 0.0) {
        let depth = linearDepth(textureLoad(depthBuffer, pos, 0).x);
        let normal = textureLoad(shadingNormalBuffer, pos, 0).xyz;

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
  textureStore(irradianceBuffer, did, vec4f(lighting.xyz / max(lighting.w, 1.0), 1.0));` : ''}

  textureStore(colorBuffer, did, lighting);
}
`;
}
