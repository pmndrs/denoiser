// TSL entry points for `denoiser/realtime` (our own per-signal denoisers,
// experimental): the same shape as the FidelityFX helpers in ./ffx.ts. Each
// normalises three's conventions (world normals, `velocity`, hardware depth,
// signals rendered into textures when they aren't textures already) and hands
// over to TemporalDenoiseNode.
//
//   realtimeShadows(visibility, opts)              ShadowDenoiser         -> visibility in .r
//   realtimeDiffuse(radiance, opts)                DiffuseDenoiser        -> rgb (+ ĥ in .a with the recurrent filter)
//   realtimeSpecular(radiance, opts)               SpecularDenoiser       -> rgb
//   realtimeDiffuseSpecular({ diffuse, specular }) DiffuseSpecularDenoiser -> .diffuse / .specular nodes
//   realtimeOcclusion(hitDistance, opts)           OcclusionDenoiser      -> ĥ in .r (.diffuse / .specular with signal 'both')
//
// The algorithm stays an option of the class (`denoiser: { filter: ... }`); the
// nodes never pick a filter or a default of their own.
import {
  DiffuseDenoiser, DiffuseSpecularDenoiser, OcclusionDenoiser, ShadowDenoiser, SpecularDenoiser,
} from '@pmndrs/denoiser-realtime';
import type {
  DiffuseDenoiserOptions, DiffuseSpecularDenoiserOptions, OcclusionDenoiserOptions, ShadowDenoiserOptions,
  SpecularDenoiserOptions,
} from '@pmndrs/denoiser-realtime';
import type { FrameCamera, FrameGuides, ShadowInputs, ShadowLight, TemporalDenoiser } from '@pmndrs/denoiser-core';
import { float, vec4 } from 'three/tsl';
import type { Camera, Node } from 'three/webgpu';
import { finite1, finite3, toSignalTexture, worldNormalTexture } from './tsl';
import { TemporalDenoiseNode, denoiseNodeObject } from './TemporalDenoiseNode';
import type { TemporalDenoiseNodeObject, TemporalGuideNodes, TextureNodeLike } from './TemporalDenoiseNode';
import type { FfxGuideOptions } from './ffx';

/** Guides for the realtime nodes: the same as the FFX helpers' (camera, depth, normal, velocity, ...). */
export interface RealtimeGuideOptions extends FfxGuideOptions {
  /** Surface albedo (rgb), for `remodulate: true` on diffuse without a `demodulation` input. */
  albedo?: TextureNodeLike;
  /**
   * Optional linear view-space z (three.js view space, negative in front): a texture node's .r or a
   * float node. The denoisers then skip linearizing `depth`.
   */
  viewZ?: TextureNodeLike;
  /** Optional 2.5D motion (viewZprev - viewZ) for moving objects: a texture node's .r or a float node. */
  motionZ?: TextureNodeLike;
}

/** A light value, or a function read every frame (lights move). */
export type ShadowLightSource = ShadowLight | (() => ShadowLight | undefined);

export interface RealtimeShadowsOptions extends RealtimeGuideOptions {
  /**
   * Distance to the occluder in world units, 0 = unoccluded (a float node or a
   * texture node's .r). With `light` it sizes the penumbra-aware kernel; without
   * either the denoiser falls back to a noise-driven radius.
   */
  hitDistance?: TextureNodeLike;
  /** The shadow-casting light (sphere or directional). Read every frame when it is a function. */
  light?: ShadowLightSource;
  denoiser?: ShadowDenoiserOptions;
}

/** One radiance signal: noisy 1-spp radiance (rgb), its hit distance, optional demodulation factor. */
export interface RealtimeSignal {
  /** Noisy radiance, linear HDR (rgb). Pixels without a sample must be 0. */
  radiance: TextureNodeLike;
  /**
   * Ray hit distance, world units, 0 = miss (a texture node's .r or a float node).
   * Specular: defaults to `radiance.a` (three's SSR node stores its ray length there).
   * Diffuse: optional (feeds the recurrent filter's radius clamp and its ĥ / AO in .a).
   */
  hitDistance?: TextureNodeLike;
  /** Per-pixel factor the radiance was divided by (for `remodulate: true`). */
  demodulation?: TextureNodeLike;
}

interface RadianceCommon extends RealtimeGuideOptions {
  /** Replace NaN / negative / overflowing radiance (and hit distance) with 0 first. Default true. */
  sanitize?: boolean;
}

export interface RealtimeDiffuseOptions extends RadianceCommon {
  hitDistance?: TextureNodeLike;
  demodulation?: TextureNodeLike;
  denoiser?: DiffuseDenoiserOptions;
}

export interface RealtimeSpecularOptions extends RadianceCommon {
  /** Perceptual roughness: a texture node (value in .r) or a float node. */
  roughness: TextureNodeLike;
  /** Ray hit distance, world units, 0 = miss. Defaults to `radiance.a` (three's SSR). */
  hitDistance?: TextureNodeLike;
  demodulation?: TextureNodeLike;
  denoiser?: SpecularDenoiserOptions;
}

export interface RealtimeDiffuseSpecularOptions extends RadianceCommon {
  /** Perceptual roughness: a texture node (value in .r) or a float node. */
  roughness: TextureNodeLike;
  denoiser?: DiffuseSpecularDenoiserOptions;
}

export interface RealtimeOcclusionOptions extends RealtimeGuideOptions {
  /** Perceptual roughness (specular occlusion, `denoiser.signal` 'specular' / 'both'). */
  roughness?: TextureNodeLike;
  denoiser?: OcclusionDenoiserOptions;
}

/** A node with two outputs: the node itself is the first, `.diffuse` / `.specular` are texture nodes of each. */
export type TwoOutputNodeObject<I extends object> = TemporalDenoiseNodeObject<I> & {
  readonly diffuse: Node<'vec4'>;
  readonly specular: Node<'vec4'>;
};

// ---- helpers ---------------------------------------------------------------------

const asR = (n: TextureNodeLike): TextureNodeLike => (n?.isTextureNode ? n.r : n);

/** A scalar signal as its own texture (value in .r): texture nodes pass through unless `sanitize`. */
function scalarTexture(node: TextureNodeLike, scale: number, sanitize: boolean): TextureNodeLike {
  if (node?.isTextureNode && !sanitize) return node;
  const v = float(asR(node));
  return toSignalTexture(vec4(sanitize ? finite1(v) : v, 0, 0, 1), scale, (n) => n, { force: true });
}

function radianceTexture(node: TextureNodeLike, scale: number, sanitize: boolean): TextureNodeLike {
  return toSignalTexture(node, scale, (n) => vec4(sanitize ? finite3(n.rgb) : n.rgb, 1), { force: sanitize || !node.isTextureNode });
}

function roughnessTexture(node: TextureNodeLike, scale: number): TextureNodeLike {
  return node.isTextureNode ? node : toSignalTexture(node, scale, (n) => vec4(n, 0, 0, 1));
}

function guidesOf(o: RealtimeGuideOptions, roughness?: TextureNodeLike): TemporalGuideNodes {
  const g: TemporalGuideNodes = { depth: o.depth, normal: worldNormalTexture(o.normal, o), motion: o.velocity };
  if (roughness) g.roughness = roughnessTexture(roughness, o.resolutionScale ?? 1);
  if (o.albedo) g.albedo = o.albedo;
  if (o.viewZ) g.viewZ = scalarTexture(o.viewZ, o.resolutionScale ?? 1, false);
  if (o.motionZ) g.motionZ = scalarTexture(o.motionZ, o.resolutionScale ?? 1, false);
  return g;
}

/** Splits flat input keys `a.b` back into `{ a: { b } }`. */
function nest(inputs: Record<string, GPUTexture>): Record<string, Record<string, GPUTexture>> {
  const out: Record<string, Record<string, GPUTexture>> = {};
  for (const [k, t] of Object.entries(inputs)) {
    const [a, b] = k.split('.');
    (out[a] ??= {})[b] = t;
  }
  return out;
}

class ShadowNode extends TemporalDenoiseNode<ShadowInputs> {
  constructor(create: (d: GPUDevice) => TemporalDenoiser<ShadowInputs>, inputs: Record<string, TextureNodeLike>,
    guides: TemporalGuideNodes, camera: Camera, options: RealtimeShadowsOptions) {
    super(create, inputs, guides, camera, options.node);
    this.light = options.light;
  }

  /** The light handed to the denoiser each frame (a value or a function). */
  light: ShadowLightSource | undefined;

  protected dispatchDenoiser(denoiser: TemporalDenoiser<ShadowInputs>, inputs: Record<string, GPUTexture>, guides: FrameGuides, camera: FrameCamera): GPUTexture[] {
    const light = typeof this.light === 'function' ? this.light() : this.light;
    return [denoiser.dispatch({ ...(inputs as unknown as ShadowInputs), ...(light ? { light } : {}) }, guides, camera)];
  }
}

interface BothDenoiser<I extends object> extends TemporalDenoiser<I> {
  dispatchBoth(inputs: never, guides: FrameGuides, camera: FrameCamera): { diffuse: GPUTexture; specular: GPUTexture };
}

/** Two outputs from one `dispatchBoth()` (inputs keyed `diffuse.<k>` / `specular.<k>`). */
class BothNode<I extends object> extends TemporalDenoiseNode<I> {
  protected dispatchDenoiser(denoiser: TemporalDenoiser<I>, inputs: Record<string, GPUTexture>, guides: FrameGuides, camera: FrameCamera): GPUTexture[] {
    const r = (denoiser as unknown as BothDenoiser<I>).dispatchBoth(nest(inputs) as never, guides, camera);
    return [r.diffuse, r.specular];
  }
}

function twoOutputs<I extends object>(node: BothNode<I>): TwoOutputNodeObject<I> {
  const obj = denoiseNodeObject(node) as TwoOutputNodeObject<I>;
  Object.defineProperty(node, 'diffuse', { get: () => node.getOutputNode(0), configurable: true });
  Object.defineProperty(node, 'specular', { get: () => node.getOutputNode(1), configurable: true });
  return obj;
}

// ---- public factories ---------------------------------------------------------------

/**
 * `ShadowDenoiser` (denoiser/realtime, experimental) as a TSL node: penumbra-aware
 * shadow denoising of 1-ray visibility, fractional visibility kept.
 *
 * @param visibility - 1-spp visibility in [0, 1] (1 = lit): a float node or a texture node (.r).
 * @returns a node whose value is the denoised visibility in .r (rgba16float). Has
 *   `.resetHistory()`; `.light` can be reassigned.
 */
export function realtimeShadows(visibility: TextureNodeLike, options: RealtimeShadowsOptions): TemporalDenoiseNodeObject<ShadowInputs> & { light: ShadowLightSource | undefined } {
  const scale = options.resolutionScale ?? 1;
  const inputs: Record<string, TextureNodeLike> = { visibility: toSignalTexture(visibility, scale, (n) => vec4(n, 0, 0, 1)) };
  if (options.hitDistance) inputs.hitDistance = scalarTexture(options.hitDistance, scale, false);
  return denoiseNodeObject(new ShadowNode(
    (device) => new ShadowDenoiser(device, options.denoiser), inputs, guidesOf(options), options.camera, options,
  )) as TemporalDenoiseNodeObject<ShadowInputs> & { light: ShadowLightSource | undefined };
}

/**
 * `DiffuseDenoiser` (denoiser/realtime, experimental) as a TSL node.
 *
 * @param radiance - noisy diffuse radiance (rgb), ideally demodulated (÷ albedo).
 * @returns denoised radiance in .rgb (still demodulated unless `remodulate: true`); with
 *   `filter: 'recurrent'` and a hit distance, .a holds the denoised normalized hit distance (AO).
 */
export function realtimeDiffuse(radiance: TextureNodeLike, options: RealtimeDiffuseOptions): TemporalDenoiseNodeObject {
  const scale = options.resolutionScale ?? 1;
  const sanitize = options.sanitize ?? true;
  const inputs: Record<string, TextureNodeLike> = { radiance: radianceTexture(radiance, scale, sanitize) };
  if (options.hitDistance) inputs.hitDistance = scalarTexture(options.hitDistance, scale, sanitize);
  if (options.demodulation) inputs.demodulation = options.demodulation;
  return denoiseNodeObject(new TemporalDenoiseNode(
    (device) => new DiffuseDenoiser(device, options.denoiser), inputs, guidesOf(options), options.camera, options.node,
  ));
}

/**
 * `SpecularDenoiser` (denoiser/realtime, experimental) as a TSL node.
 *
 * @param radiance - noisy specular radiance (rgb); alpha = hit distance unless `hitDistance` is given.
 * @returns denoised radiance in .rgb.
 */
export function realtimeSpecular(radiance: TextureNodeLike, options: RealtimeSpecularOptions): TemporalDenoiseNodeObject {
  const scale = options.resolutionScale ?? 1;
  const sanitize = options.sanitize ?? true;
  const inputs: Record<string, TextureNodeLike> = {
    radiance: radianceTexture(radiance, scale, sanitize),
    hitDistance: scalarTexture(options.hitDistance ?? radiance.a, scale, true),
  };
  if (options.demodulation) inputs.demodulation = options.demodulation;
  return denoiseNodeObject(new TemporalDenoiseNode(
    (device) => new SpecularDenoiser(device, options.denoiser), inputs, guidesOf(options, options.roughness), options.camera, options.node,
  ));
}

/**
 * `DiffuseSpecularDenoiser` (denoiser/realtime, experimental) as a TSL node: both
 * signals in shared dispatches (one prepass), two outputs.
 *
 * ```ts
 * const gi = realtimeDiffuseSpecular({ diffuse: { radiance: diffuseNode }, specular: { radiance: ssrNode } },
 *   { camera, depth, normal, velocity, roughness });
 * const lit = albedo.mul(gi.diffuse.rgb).add(gi.specular.rgb);
 * ```
 *
 * @returns a node whose value is the denoised diffuse; `.diffuse` / `.specular` are texture
 *   nodes of each output (rgba16float). Has `.resetHistory()`.
 */
export function realtimeDiffuseSpecular(
  signals: { diffuse: RealtimeSignal; specular: RealtimeSignal },
  options: RealtimeDiffuseSpecularOptions,
): TwoOutputNodeObject<object> {
  const scale = options.resolutionScale ?? 1;
  const sanitize = options.sanitize ?? true;
  const { diffuse: d, specular: s } = signals;
  const inputs: Record<string, TextureNodeLike> = {
    'diffuse.radiance': radianceTexture(d.radiance, scale, sanitize),
    'specular.radiance': radianceTexture(s.radiance, scale, sanitize),
    'specular.hitDistance': scalarTexture(s.hitDistance ?? s.radiance.a, scale, true),
  };
  if (d.hitDistance) inputs['diffuse.hitDistance'] = scalarTexture(d.hitDistance, scale, sanitize);
  if (d.demodulation) inputs['diffuse.demodulation'] = d.demodulation;
  if (s.demodulation) inputs['specular.demodulation'] = s.demodulation;
  return twoOutputs(new BothNode<object>(
    (device) => new DiffuseSpecularDenoiser(device, options.denoiser) as unknown as TemporalDenoiser<object>,
    inputs, guidesOf(options, options.roughness), options.camera, options.node, 2,
  ));
}

/**
 * `OcclusionDenoiser` (denoiser/realtime, experimental) as a TSL node: ambient /
 * specular occlusion from the hit distance of the renderer's 1-spp rays.
 *
 * @param hitDistance - world units, 0 = miss (a float node or a texture node's .r). With
 *   `denoiser.signal: 'both'` pass `{ diffuse, specular }` (AO and SO rays).
 * @returns a node whose value is the denoised normalized hit distance ĥ in .r (1 = open,
 *   -> 0 at contact); with 'both', `.diffuse` (AO) and `.specular` (SO) texture nodes.
 */
export function realtimeOcclusion(
  hitDistance: TextureNodeLike | { diffuse: TextureNodeLike; specular: TextureNodeLike },
  options: RealtimeOcclusionOptions,
): TwoOutputNodeObject<object> {
  const scale = options.resolutionScale ?? 1;
  const both = options.denoiser?.signal === 'both';
  const needsRoughness = options.denoiser?.signal === 'specular' || both;
  if (needsRoughness && !options.roughness) throw new Error('realtimeOcclusion: specular occlusion needs `roughness`');
  const guides = guidesOf(options, needsRoughness ? options.roughness : undefined);
  const create = (device: GPUDevice) => new OcclusionDenoiser(device, options.denoiser) as unknown as TemporalDenoiser<object>;
  if (both) {
    const h = hitDistance as { diffuse: TextureNodeLike; specular: TextureNodeLike };
    if (!h?.diffuse || !h?.specular) throw new Error("realtimeOcclusion: signal 'both' needs { diffuse, specular } hit distances");
    return twoOutputs(new BothNode<object>(create, {
      'diffuse.hitDistance': scalarTexture(h.diffuse, scale, true),
      'specular.hitDistance': scalarTexture(h.specular, scale, true),
    }, guides, options.camera, options.node, 2));
  }
  const node = new TemporalDenoiseNode<object>(create, { hitDistance: scalarTexture(hitDistance, scale, true) }, guides, options.camera, options.node);
  const obj = denoiseNodeObject(node) as TwoOutputNodeObject<object>;
  const sig = options.denoiser?.signal ?? 'diffuse';
  Object.defineProperty(node, sig, { get: () => node.getOutputNode(0), configurable: true });
  return obj;
}
