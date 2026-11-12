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
//     it between frames, which a three texture can't follow.) Outputs that
//     can't be copied as is (another format, e.g. r32float visibility, or no
//     COPY_SRC usage) go through a one-dispatch compute blit instead.
//   - denoisers with several outputs (e.g. diffuse + specular from one
//     dispatch) get one StorageTexture each: subclasses pass `outputCount` and
//     override `dispatchDenoiser()`; `getOutputNode(i)` is a texture node of
//     output i.
import type { FrameCamera, FrameGuides, TemporalDenoiser } from '@pmndrs/denoiser-core';
import { nodeObject, passTexture } from 'three/tsl';
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
  /** Optional linear view-space z in .r (three.js view space: negative in front; see FrameGuides.viewZ). */
  viewZ?: TextureNodeLike;
  /** Optional 2.5D motion, viewZprev - viewZ in .r (see FrameGuides.motionZ). */
  motionZ?: TextureNodeLike;
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

  private readonly outputCount: number;
  private _renderer: WebGPURenderer | null = null;
  private _denoiser: TemporalDenoiser<I> | null = null;
  private _outputs: (StorageTexture | null)[];
  private _outputNodes: (Node | null)[];
  private _blit: OutputBlit | null = null;
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
   * @param outputCount - number of output textures (subclasses with several outputs)
   */
  constructor(
    create: (device: GPUDevice) => TemporalDenoiser<I>,
    inputs: InputNodes<I>,
    guides: TemporalGuideNodes,
    camera: Camera,
    options: TemporalDenoiseNodeOptions = {},
    outputCount = 1,
  ) {
    super('vec4');
    this.create = create;
    this.inputNodes = inputs;
    this.guideNodes = guides;
    this.camera = camera;
    this.options = options;
    this.outputCount = outputCount;
    this._outputs = new Array(outputCount).fill(null);
    this._outputNodes = new Array(outputCount).fill(null);
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
    return this.getOutputNode(0);
  }

  /**
   * The denoised result as a three Texture (rgba16float). The instance is stable
   * for the node's lifetime - it is resized in place - so it can be handed to
   * consumers that keep a reference, e.g. `ssrNode.setHistory(node.outputTexture, velocity)`.
   */
  get outputTexture(): Texture {
    return this.getOutputTexture(0);
  }

  /** @internal Output 0, or null before the first frame (example test hooks read it). */
  get _output(): StorageTexture | null { return this._outputs[0]; }

  /** Output `index` as a three Texture (rgba16float, stable instance; see `outputTexture`). */
  getOutputTexture(index: number): Texture {
    if (index < 0 || index >= this.outputCount) throw new Error(`denoiser/three: output ${index} out of range (${this.outputCount})`);
    return this._outputs[index] ??= this._makeOutput(1, 1, index);
  }

  /**
   * Output `index` as a TSL texture node. Using it in a graph (alone or next to
   * this node) runs the denoiser, so secondary outputs work on their own.
   */
  getOutputNode(index: number): Node {
    return this._outputNodes[index] ??= passTexture(this as never, this.getOutputTexture(index)) as unknown as Node;
  }

  /**
   * Runs the denoiser for one frame and returns its output texture(s), in output
   * order. Override for denoisers with extra inputs (non-texture) or several outputs.
   */
  protected dispatchDenoiser(denoiser: TemporalDenoiser<I>, inputs: Record<string, GPUTexture>, guides: FrameGuides, camera: FrameCamera): GPUTexture[] {
    return [denoiser.dispatch(inputs as I, guides, camera)];
  }

  private _makeOutput(width: number, height: number, index = 0): StorageTexture {
    const out = new StorageTexture(width, height);
    out.name = `${this._denoiser?.name ?? 'temporal-denoise'}-output${index ? index : ''}`;
    out.type = HalfFloatType;
    out.format = RGBAFormat;
    out.colorSpace = NoColorSpace;
    out.minFilter = out.magFilter = LinearFilter;
    out.generateMipmaps = false;
    return out;
  }

  private _allocateOutputs(width: number, height: number) {
    for (let i = 0; i < this.outputCount; i++) {
      const out = this._outputs[i] ?? (this._outputs[i] = this._makeOutput(width, height, i));
      (out as unknown as { setSize(w: number, h: number): void }).setSize(width, height); // no-op when unchanged; disposes the old GPU texture otherwise
      this._renderer!.initTexture(out);
    }
    this._blit?.clear();
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
    for (const k of ['albedo', 'viewZ', 'motionZ'] as const) {
      if (!this.guideNodes[k]) continue;
      const t = this._gpu(this.guideNodes[k], k);
      if (!t) return undefined;
      guides[k] = t;
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
      this._allocateOutputs(w, h);
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
    const results = this.dispatchDenoiser(denoiser, inputs, guides, cam);

    const device = denoiser.device;
    const enc = device.createCommandEncoder({ label: `${denoiser.name} output copy` });
    for (let i = 0; i < this.outputCount; i++) {
      const src = results[i];
      if (!src) continue;
      const dst = getGPUTexture(renderer, this.getOutputTexture(i));
      if (src.format === dst.format && (src.usage & GPUTextureUsage.COPY_SRC)) {
        enc.copyTextureToTexture({ texture: src }, { texture: dst }, { width: w, height: h });
      } else {
        (this._blit ??= new OutputBlit(device)).record(enc, src, dst);
      }
    }
    device.queue.submit([enc.finish()]);
    this.options.onDispatch?.(denoiser as unknown as TemporalDenoiser<never>);
    return undefined;
  }

  dispose(): void {
    this._denoiser?.dispose();
    this._denoiser = null;
    for (const o of this._outputs) o?.dispose();
    this._outputs.fill(null);
    this._outputNodes.fill(null);
    this._blit?.clear();
    this._blit = null;
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
): TemporalDenoiseNodeObject<I> {
  return denoiseNodeObject(new TemporalDenoiseNode(create, inputs, guides, camera, options));
}

/** A `TemporalDenoiseNode` as a TSL node object: swizzles (`.r`, `.rgb`), `.mul()`, ... work on it. */
export type TemporalDenoiseNodeObject<I extends object = object> = TemporalDenoiseNode<I> & Node<'vec4'>;
export function denoiseNodeObject<I extends object>(node: TemporalDenoiseNode<I>): TemporalDenoiseNodeObject<I> {
  return nodeObject(node) as unknown as TemporalDenoiseNodeObject<I>;
}

/**
 * Copies a denoiser output into a node's rgba16float StorageTexture when a plain
 * texture copy can't (different format, e.g. r32float visibility, or no
 * COPY_SRC usage): one compute dispatch, `textureLoad` -> `textureStore`, so a
 * single-channel output arrives as (r, 0, 0, 1) like any sampled r texture.
 */
class OutputBlit {
  private readonly layout: GPUBindGroupLayout;
  private readonly pipeline: GPUComputePipeline;
  private readonly groups = new Map<GPUTexture, { dst: GPUTexture; group: GPUBindGroup }>();

  constructor(private readonly device: GPUDevice) {
    this.layout = device.createBindGroupLayout({
      label: 'denoiser/three output blit',
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'rgba16float' } },
      ],
    });
    this.pipeline = device.createComputePipeline({
      label: 'denoiser/three output blit',
      layout: device.createPipelineLayout({ bindGroupLayouts: [this.layout] }),
      compute: {
        entryPoint: 'main',
        module: device.createShaderModule({
          label: 'denoiser/three output blit',
          code: /* wgsl */ `
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var dst: texture_storage_2d<rgba16float, write>;
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let size = min(textureDimensions(dst), textureDimensions(src));
  if (id.x >= size.x || id.y >= size.y) { return; }
  textureStore(dst, id.xy, textureLoad(src, id.xy, 0));
}`,
        }),
      },
    });
  }

  record(enc: GPUCommandEncoder, src: GPUTexture, dst: GPUTexture) {
    let g = this.groups.get(src);
    if (!g || g.dst !== dst) {
      g = {
        dst,
        group: this.device.createBindGroup({
          layout: this.layout,
          entries: [{ binding: 0, resource: src.createView() }, { binding: 1, resource: dst.createView() }],
        }),
      };
      this.groups.set(src, g);
      if (this.groups.size > 16) this.groups.delete(this.groups.keys().next().value!); // outputs rotate among a few buffers
    }
    const pass = enc.beginComputePass({ label: 'denoiser/three output blit' });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, g.group);
    pass.dispatchWorkgroups(Math.ceil(dst.width / 8), Math.ceil(dst.height / 8));
    pass.end();
  }

  clear() { this.groups.clear(); }
}
