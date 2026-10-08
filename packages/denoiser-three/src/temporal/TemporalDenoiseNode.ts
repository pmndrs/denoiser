// A TSL node that runs any TemporalDenoiser (denoiser-core's interface) inside a
// three.js (WebGPURenderer) post-processing graph, the way @pmndrs/upscaler's
// UpscalerNode wraps the FSR3 upscaler:
//
//   - the input / guide nodes are registered as graph dependencies in setup(), so
//     three renders them (scene pass, RTT conversions, SSR, ...) before this
//     node's updateBefore() runs;
//   - updateBefore() (once per frame) maps the three textures to the GPUTextures
//     behind them, updates the camera history, (re)configures the denoiser on a
//     size change and calls dispatch() - which records and submits its own
//     passes on the renderer's GPUDevice;
//   - the denoised GPUTexture is copied (GPU->GPU, same device, no CPU) into a
//     three StorageTexture that the node exposes as a regular texture node.
//     (The copy is needed because denoisers own their output and may ping-pong
//     it between frames, which a three texture can't follow.)
import type { FrameCamera, FrameGuides, TemporalDenoiser } from '@pmndrs/denoiser-core';
import { passTexture } from 'three/tsl';
import {
  type Camera, type Matrix4, type Node, type Texture, type WebGPURenderer,
  HalfFloatType, LinearFilter, NoColorSpace, NodeUpdateType, RGBAFormat, StorageTexture, TempNode,
} from 'three/webgpu';
import { CameraHistory, getDevice, getGPUTexture } from '../shared/three';

/** Anything that resolves to a texture: pass/RTT/texture nodes, or a bare three Texture. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type TextureNodeLike = any;

export interface TemporalGuideNodes {
  /** Scene depth (`pass.getTextureNode('depth')`). Hardware depth, any format. */
  depth: TextureNodeLike;
  /** WORLD-space unit normals in [-1, 1] (rgba16float / rgba8snorm). */
  normal: TextureNodeLike;
  /** NDC motion delta, current - previous (three's `velocity` node, rg in the texture). */
  motion: TextureNodeLike;
  /** Perceptual roughness in .r (specular denoisers). */
  roughness?: TextureNodeLike;
  albedo?: TextureNodeLike;
}

export interface TemporalDenoiseNodeOptions {
  /**
   * Override the projection used for reprojection. By default the node uses the
   * camera's and, if a view offset is enabled (sub-pixel jitter, e.g.
   * @pmndrs/upscaler's), computes the projection WITHOUT the offset.
   */
  unjitteredProjection?: () => Matrix4;
  /** Strip `camera.view` (jitter) offsets from the projection. Default true. */
  ignoreViewOffset?: boolean;
  /** Called after each dispatch with the denoiser (e.g. to read `gpuTimings`). */
  onDispatch?: (denoiser: TemporalDenoiser<never>) => void;
}

type InputNodes<I extends object> = { [K in keyof I]?: TextureNodeLike };

/** The three Texture behind a pass/RTT/texture node (same resolution the upscaler uses). */
export function resolveTexture(node: TextureNodeLike): Texture | null {
  if (!node) return null;
  if (node.isTexture) return node as Texture;
  return node.value?.isTexture ? node.value
    : node.renderTarget?.texture ?? node.passNode?.renderTarget?.texture ?? null;
}

/**
 * Wraps a {@link TemporalDenoiser} as a TSL node whose value is the denoised
 * texture. Build one with {@link temporalDenoise}, or use the signal-specific
 * helpers (`ffxShadows`, `ffxReflections`).
 */
export class TemporalDenoiseNode<I extends object = object> extends TempNode {
  readonly isTemporalDenoiseNode = true;

  /** Skip the denoiser (history is dropped; re-enabling starts fresh). Output keeps its last frame. */
  enabled = true;

  private readonly create: (device: GPUDevice) => TemporalDenoiser<I>;
  private readonly inputNodes: InputNodes<I>;
  private readonly guideNodes: TemporalGuideNodes;
  private readonly camera: Camera;
  private readonly options: TemporalDenoiseNodeOptions;
  private readonly cameraHistory = new CameraHistory();

  private _renderer: WebGPURenderer | null = null;
  private _denoiser: TemporalDenoiser<I> | null = null;
  private _output: StorageTexture | null = null;
  private _textureNode: Node | null = null;
  private _width = 0;
  private _height = 0;
  private _needsReset = true;
  private _warned = false;

  /**
   * @param create - builds the denoiser once the renderer's GPUDevice exists
   * @param inputs - per-signal input nodes, keyed like the denoiser's `Inputs`
   *   (e.g. `{ visibility }`, `{ radiance, hitDistance }`)
   * @param guides - depth / world normal / motion (+ roughness, albedo) nodes
   * @param camera - the scene camera
   */
  constructor(
    create: (device: GPUDevice) => TemporalDenoiser<I>,
    inputs: InputNodes<I>,
    guides: TemporalGuideNodes,
    camera: Camera,
    options: TemporalDenoiseNodeOptions = {},
  ) {
    super('vec4');
    this.create = create;
    this.inputNodes = inputs;
    this.guideNodes = guides;
    this.camera = camera;
    this.options = options;
    this.updateBeforeType = NodeUpdateType.FRAME;
  }

  /** The wrapped denoiser (null until the node has been built). */
  get denoiser(): TemporalDenoiser<I> | null { return this._denoiser; }

  /** Drop temporal history on the next frame (camera cut, teleport, scene switch). */
  resetHistory(): void {
    this._needsReset = true;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setup(builder: any): any {
    const renderer = builder.renderer as WebGPURenderer;
    this._renderer = renderer;
    this._denoiser ??= this.create(getDevice(renderer));

    // Register inputs as graph dependencies so three renders them before our
    // updateBefore (same trick as UpscalerNode / TAAUNode).
    const props = builder.getNodeProperties(this);
    for (const [k, n] of Object.entries(this.inputNodes)) if (n) props[`input_${k}`] = n;
    for (const [k, n] of Object.entries(this.guideNodes)) if (n) props[`guide_${k}`] = n;

    // Real size is taken from the guide textures on the first frame.
    if (!this._output) this._allocateOutput(1, 1);
    this._textureNode ??= passTexture(this as never, this._output as Texture) as unknown as Node;
    return this._textureNode;
  }

  private _allocateOutput(width: number, height: number) {
    this._output?.dispose();
    const out = new StorageTexture(width, height);
    out.name = `${this._denoiser?.name ?? 'temporal-denoise'}-output`;
    out.type = HalfFloatType;
    out.format = RGBAFormat;
    out.colorSpace = NoColorSpace;
    out.minFilter = out.magFilter = LinearFilter;
    out.generateMipmaps = false;
    this._renderer!.initTexture(out);
    this._output = out;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (this._textureNode) (this._textureNode as any).value = out;
  }

  /** Projection for reprojection: camera projection minus any view-offset jitter. */
  private _projection(): Matrix4 | undefined {
    if (this.options.unjitteredProjection) return this.options.unjitteredProjection();
    const cam = this.camera as Camera & { view?: { enabled: boolean }; updateProjectionMatrix?: () => void };
    if (this.options.ignoreViewOffset === false || !cam.view?.enabled || !cam.updateProjectionMatrix) return undefined;
    cam.view.enabled = false;
    cam.updateProjectionMatrix();
    const m = cam.projectionMatrix.clone();
    cam.view.enabled = true;
    cam.updateProjectionMatrix();
    return m;
  }

  private _gpu(node: TextureNodeLike, what: string): GPUTexture | null {
    const tex = resolveTexture(node);
    if (!tex) return null;
    try {
      return getGPUTexture(this._renderer!, tex);
    } catch (e) {
      if (!this._warned) {
        this._warned = true;
        console.warn(`denoiser/three: ${what} has no GPU texture yet (${(e as Error).message})`);
      }
      return null;
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  updateBefore(_frame: any): boolean | undefined {
    const renderer = this._renderer, denoiser = this._denoiser;
    if (!renderer || !denoiser) return undefined;
    if (!this.enabled) { this._needsReset = true; return undefined; }

    const depth = this._gpu(this.guideNodes.depth, 'depth');
    const normal = this._gpu(this.guideNodes.normal, 'normal');
    const motion = this._gpu(this.guideNodes.motion, 'motion');
    if (!depth || !normal || !motion) return undefined;
    const guides: FrameGuides = { depth, normal, motion };
    if (this.guideNodes.roughness) {
      const r = this._gpu(this.guideNodes.roughness, 'roughness');
      if (!r) return undefined;
      guides.roughness = r;
    }
    if (this.guideNodes.albedo) {
      const a = this._gpu(this.guideNodes.albedo, 'albedo');
      if (!a) return undefined;
      guides.albedo = a;
    }
    const inputs: Record<string, GPUTexture> = {};
    for (const [k, n] of Object.entries(this.inputNodes)) {
      if (!n) continue;
      const t = this._gpu(n, `input "${k}"`);
      if (!t) return undefined;
      inputs[k] = t;
    }

    const w = depth.width, h = depth.height;
    if (w !== this._width || h !== this._height) {
      denoiser.configure({ width: w, height: h }); // drops history
      this._width = w; this._height = h;
      this.cameraHistory.reset();
      this._allocateOutput(w, h);
      this._needsReset = false;
    }
    if (this._needsReset) {
      denoiser.resetHistory();
      this.cameraHistory.reset();
      this._needsReset = false;
    }

    const cam: FrameCamera = this.cameraHistory.update(this.camera, { unjitteredProjection: this._projection() });
    // dispatch() records + submits its own work (denoiser contract); the copy
    // below is submitted after it on the same queue.
    const result = denoiser.dispatch(inputs as I, guides, cam);

    const device = denoiser.device;
    const dst = getGPUTexture(renderer, this._output as Texture);
    const enc = device.createCommandEncoder({ label: `${denoiser.name} output copy` });
    enc.copyTextureToTexture({ texture: result }, { texture: dst }, { width: w, height: h });
    device.queue.submit([enc.finish()]);
    this.options.onDispatch?.(denoiser as unknown as TemporalDenoiser<never>);
    return undefined;
  }

  dispose(): void {
    this._denoiser?.dispose();
    this._denoiser = null;
    this._output?.dispose();
    this._output = null;
    super.dispose();
  }
}

/**
 * Wrap any TemporalDenoiser as a TSL node.
 *
 * ```ts
 * const n = temporalDenoise((device) => new FfxShadowDenoiser(device),
 *   { visibility }, { depth, normal, motion }, camera);
 * ```
 */
export function temporalDenoise<I extends object>(
  create: (device: GPUDevice) => TemporalDenoiser<I>,
  inputs: InputNodes<I>,
  guides: TemporalGuideNodes,
  camera: Camera,
  options?: TemporalDenoiseNodeOptions,
): TemporalDenoiseNode<I> {
  return new TemporalDenoiseNode(create, inputs, guides, camera, options);
}
