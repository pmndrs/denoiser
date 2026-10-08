// Convenience TSL entry points for the FidelityFX shadow / reflection denoisers
// (denoiser/ffx) - they normalise three's conventions into what the denoisers
// want, then hand over to TemporalDenoiseNode:
//
//   * normals  must be WORLD-space unit vectors in [-1, 1]. three's `normalView`
//     (and `packNormalToRGB`'d MRT attachments) are converted on the GPU with a
//     small RTT pass - see `normalSpace` / `normalEncoding`.
//   * motion   is three's `velocity` node as-is (NDC delta current - previous,
//     the same data @pmndrs/upscaler reads with a (0.5, -0.5) scale).
//   * depth    any hardware depth texture of the scene pass (depth24plus /
//     depth32float); the denoisers read the depth aspect directly.
//   * signals  that are not already texture nodes (TSL expressions, SSR output,
//     swizzles) are rendered into half-float textures with `convertToTexture`.
import { FfxReflectionDenoiser, FfxShadowDenoiser } from '@pmndrs/denoiser-ffx';
import type { FfxReflectionDenoiserOptions, FfxShadowDenoiserOptions } from '@pmndrs/denoiser-ffx';
import { finite1, finite3, toSignalTexture, worldNormalTexture } from './tsl';
import type { NormalEncoding, NormalSpace } from './tsl';
import { TemporalDenoiseNode, denoiseNodeObject } from './TemporalDenoiseNode';
import type { TemporalDenoiseNodeObject } from './TemporalDenoiseNode';
import type { TemporalDenoiseNodeOptions, TextureNodeLike } from './TemporalDenoiseNode';
import type { Camera } from 'three/webgpu';
import { float, vec4 } from 'three/tsl';
import type { ShadowInputs, SpecularInputs } from '@pmndrs/denoiser-core';

export interface FfxGuideOptions {
  /** The scene camera (reprojection matrices, near/far). */
  camera: Camera;
  /** Scene depth texture node, e.g. `scenePass.getTextureNode('depth')`. */
  depth: TextureNodeLike;
  /**
   * Normals: a texture node (e.g. an MRT attachment) or any vec3/vec4 node.
   * World-space and in [-1, 1] unless `normalSpace` / `normalEncoding` say otherwise.
   */
  normal: TextureNodeLike;
  /** three's `velocity` (via an MRT attachment): NDC delta, current - previous. */
  velocity: TextureNodeLike;
  /** `'world'` (default) or `'view'` (e.g. three's `normalView`): converted with the camera's world matrix. */
  normalSpace?: NormalSpace;
  /** `'signed'` (default, [-1, 1]) or `'packed'` ([0, 1] from `packNormalToRGB`). */
  normalEncoding?: NormalEncoding;
  /**
   * Resolution of the intermediate textures this helper creates, as a fraction of
   * the drawing buffer. Must match the scene pass's `setResolutionScale` (e.g.
   * `1 / upscaleRatio` when rendering low-res for @pmndrs/upscaler). Default 1.
   */
  resolutionScale?: number;
  /** Extra node options (jitter handling, dispatch callback). */
  node?: TemporalDenoiseNodeOptions;
}

export interface FfxShadowsOptions extends FfxGuideOptions {
  /** Occluder distance (unused by FFX shadows today; accepted for the interface). */
  hitDistance?: TextureNodeLike;
  denoiser?: FfxShadowDenoiserOptions;
}

export interface FfxReflectionsOptions extends FfxGuideOptions {
  /** Perceptual roughness: a texture node (value in .r) or a float node. */
  roughness: TextureNodeLike;
  /**
   * Ray hit distance in world units, 0 = miss (a texture node's .r, or a float node).
   * Defaults to `radiance.a` - three's SSR node stores its ray length there.
   */
  hitDistance?: TextureNodeLike;
  denoiser?: FfxReflectionDenoiserOptions;
  /** Replace NaN / negative / overflowing radiance with 0 first (FFX needs finite input). Default true. */
  sanitize?: boolean;
}

/**
 * FidelityFX shadow denoiser as a TSL node.
 *
 * @param visibility - 1-spp visibility in [0, 1] (1 = lit): a float node or a texture node (.r).
 *   FFX is a binary 1-ray denoiser; values are thresholded at 0.5 (see `denoiser.visibilityThreshold`).
 * @returns a node whose value is the denoised visibility in .r (rgba16float); use
 *   `.r` / `.x` in the composite. Has `.resetHistory()`.
 */
export function ffxShadows(visibility: TextureNodeLike, options: FfxShadowsOptions): TemporalDenoiseNodeObject<ShadowInputs> {
  const scale = options.resolutionScale ?? 1;
  const inputs: { visibility: TextureNodeLike; hitDistance?: TextureNodeLike } = {
    visibility: toSignalTexture(visibility, scale, (n) => vec4(n, 0, 0, 1)),
  };
  if (options.hitDistance) inputs.hitDistance = toSignalTexture(options.hitDistance, scale, (n) => vec4(n, 0, 0, 1));
  return denoiseNodeObject(new TemporalDenoiseNode(
    (device) => new FfxShadowDenoiser(device, options.denoiser),
    inputs,
    {
      depth: options.depth,
      normal: worldNormalTexture(options.normal, options),
      motion: options.velocity,
    },
    options.camera,
    options.node,
  ));
}

/**
 * FidelityFX reflection denoiser as a TSL node.
 *
 * @param radiance - noisy reflected radiance, linear HDR (rgb); alpha = hit distance unless
 *   `hitDistance` is given. Pixels without a reflection must be 0 (radiance 0 -> output 0).
 * @returns a node whose value is the denoised radiance (rgba16float). Has `.resetHistory()`.
 */
export function ffxReflections(radiance: TextureNodeLike, options: FfxReflectionsOptions): TemporalDenoiseNodeObject<SpecularInputs> {
  const scale = options.resolutionScale ?? 1;
  const sanitize = options.sanitize ?? true;
  const hitSource = options.hitDistance
    ? (options.hitDistance.isTextureNode ? options.hitDistance.r : options.hitDistance)
    : radiance.a;
  // Both signals go through our own RTT so each is a real texture of the right
  // channel layout (radiance.rgb, hitDistance.r) and radiance is sanitised.
  const rad = toSignalTexture(radiance, scale, (n) => vec4(sanitize ? finite3(n.rgb) : n.rgb, 1), { force: sanitize || !radiance.isTextureNode });
  const hit = toSignalTexture(vec4(sanitize ? finite1(float(hitSource)) : float(hitSource), 0, 0, 1), scale, (n) => n, { force: true });
  const rough = options.roughness.isTextureNode
    ? options.roughness
    : toSignalTexture(options.roughness, scale, (n) => vec4(n, 0, 0, 1));
  return denoiseNodeObject(new TemporalDenoiseNode(
    (device) => new FfxReflectionDenoiser(device, options.denoiser),
    { radiance: rad, hitDistance: hit },
    {
      depth: options.depth,
      normal: worldNormalTexture(options.normal, options),
      motion: options.velocity,
      roughness: rough,
    },
    options.camera,
    options.node,
  ));
}
