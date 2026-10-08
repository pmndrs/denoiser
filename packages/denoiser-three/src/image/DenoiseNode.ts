// TSL node for the single-image Denoiser. The denoise is async GPU work (it
// awaits the network), so the node is not "per frame": it keeps showing its input
// until a result lands in its own output texture, then swaps to it. When a result is
// produced is up to you: `request()`, `every`, or a `when` predicate (path
// tracers: "once the sample count reaches N").
//
// Mirrors @pmndrs/upscaler's UpscalerNode: a TempNode whose `updateBefore` does the
// GPU work and whose `setup` returns a pass-texture node over the output texture.
import { TempNode, NodeUpdateType, StorageTexture, HalfFloatType, LinearFilter, LinearSRGBColorSpace, NoColorSpace } from 'three/webgpu';
import { nodeObject, convertToTexture, passTexture, uniform, mix } from 'three/tsl';
import type { NodeBuilder, NodeFrame, Texture, WebGPURenderer } from 'three/webgpu';
import type { Denoiser, DenoiserCreateOptions, NetworkRuntime, OutputTransfer } from '@pmndrs/denoiser-core';
import { getGPUTexture } from '../shared/three';
import { createDenoiserForRenderer } from './createDenoiser';

// Same loose typing as UpscalerNode: node-graph types don't express "a texture node".
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TextureNodeLike = any;

export interface DenoiseNodeOptions {
  /** Albedo (feature) texture node, [0,1]. Selects the `_calb`/`_alb` models. Noise-free is best. */
  albedo?: TextureNodeLike;
  /** Normal texture node: [-1,1] floats (NOT packed to [0,1]). Needs `albedo` for the clean-aux model. */
  normal?: TextureNodeLike;
  /** Input is linear HDR (default true); false = LDR in [0,1]. */
  hdr?: boolean;
  /** Manual HDR input scale (overrides autoexposure). */
  inputScale?: number;
  /**
   * Encoding written to the output texture. Default 'linear': unclamped linear
   * HDR in an rgba16float texture, so three's own tonemapping / output transform
   * still applies downstream. 'aces-srgb' / 'srgb' bake the display transform in
   * (then present with a raw write, e.g. a QuadMesh `fragmentNode`).
   */
  transfer?: OutputTransfer;
  /** Color rows are bottom-up in the GPU texture (default false = top-down raster targets;
   *  true for compute-written targets such as the path tracer's output). */
  inputFlipY?: boolean;
  /** Aux flip when it differs from color (default: same as `inputFlipY`). */
  auxInputFlipY?: boolean;
  /** Flip the result vertically. */
  outputFlipY?: boolean;

  /** Auto-request a denoise every N rendered frames (when idle). Default: never (manual). */
  every?: number;
  /** Auto-request whenever this returns true while the current view has no result
   *  and no run is in flight (e.g. `() => pathTracer.samples >= 64`). */
  when?: () => boolean;
  /** Called with the result GPUTexture (the node's own output texture) after each fresh denoise. */
  onDenoised?: (gpuTexture: GPUTexture, ms: number) => void;
  onError?: (error: unknown) => void;

  /** A ready Denoiser (shared with other nodes/helpers), or a promise of one. */
  denoiser?: Denoiser | Promise<Denoiser>;
  /** Otherwise create one lazily on the renderer's device — see {@link createDenoiserForRenderer}. */
  runtime?: NetworkRuntime | ((device: GPUDevice) => NetworkRuntime);
  precision?: DenoiserCreateOptions['precision'];
  quality?: DenoiserCreateOptions['quality'];
}

/**
 * Denoises a texture node on demand and exposes the result as a texture node.
 *
 * ```ts
 * const denoised = denoise(sceneColor, { albedo, normal, runtime: (d) => new WgslRuntime({ device: d }) });
 * post.outputNode = denoised;       // shows the input until the first result lands
 * denoised.request();               // run on the next frame
 * ```
 */
export class DenoiseNode extends TempNode {
  readonly isDenoiseNode = true;

  private readonly _color: TextureNodeLike;
  private readonly _options: DenoiseNodeOptions;
  private readonly _ready = uniform(0);
  private _textureNode: TextureNodeLike = null;
  private _out: StorageTexture | null = null;

  private _denoiser: Promise<Denoiser> | null = null;
  private _denoiserOwned = false;
  private _pending = false;
  private _busy = false;
  private _generation = 0;
  private _frames = 0;
  private _hasResult = false;
  private _lastMs = 0;

  constructor(colorNode: TextureNodeLike, options: DenoiseNodeOptions = {}) {
    super('vec4');
    this.updateBeforeType = NodeUpdateType.FRAME;
    this._color = colorNode;
    this._options = options;
    if (options.denoiser) this._denoiser = Promise.resolve(options.denoiser);
  }

  /** A denoised result is currently shown (false after `invalidate()` until the next result). */
  get denoised(): boolean { return this._ready.value === 1; }
  /** A run is in flight. */
  get busy(): boolean { return this._busy; }
  /** Wall-clock ms of the last completed run (includes awaiting the GPU). */
  get lastMs(): number { return this._lastMs; }
  /** The three texture holding the latest result (rgba16float; sample it or read its GPU texture). */
  get texture(): Texture | null { return this._out; }
  /** The Denoiser in use (set once the node has been built or a denoiser was passed). */
  get denoiserPromise(): Promise<Denoiser> | null { return this._denoiser; }

  /** Run a denoise on the next frame (coalesces with an already queued request). */
  request(): this { this._pending = true; return this; }

  /**
   * The input changed (camera moved, accumulation restarted): stop showing the old
   * result, drop an in-flight one when it lands, and clear a queued request.
   * Call `request()` (or let `every`/`when` fire) for the new view.
   */
  invalidate(): this {
    this._generation++;
    this._pending = false;
    this._hasResult = false;
    this._ready.value = 0;
    return this;
  }

  setup(builder: NodeBuilder) {
    const renderer = builder.renderer as WebGPURenderer;
    // Start the denoiser now (the first load fetches weights / compiles shaders),
    // so the first request() doesn't pay for it.
    if (this._options.denoiser || this._options.runtime) this._getDenoiser(renderer);
    if (!this._out) this._allocOutput(renderer, 1, 1);
    this._textureNode ??= passTexture(this as never, this._out!);
    // Before the first result (and after invalidate) show the input as-is.
    return mix(this._color, this._textureNode, this._ready);
  }

  updateBefore(frame: NodeFrame): undefined {
    const renderer = frame.renderer as WebGPURenderer | null;
    if (!renderer) return;
    this._frames++;
    const o = this._options;
    if (!this._pending && !this._busy) {
      if (o.every && this._frames % o.every === 0) this._pending = true;
      else if (o.when && !this._hasResult && o.when()) this._pending = true;
    }
    if (!this._pending || this._busy) return;
    this._busy = true;
    this._pending = false;
    const generation = this._generation;
    const t0 = performance.now();
    this._run(renderer, generation)
      .then((tex) => {
        if (!tex || generation !== this._generation) return; // stale: its view is gone
        this._lastMs = performance.now() - t0;
        this._hasResult = true;
        this._ready.value = 1;
        o.onDenoised?.(tex, this._lastMs);
      })
      .catch((e) => { if (o.onError) o.onError(e); else console.error('denoiser/three: denoise failed', e); })
      .finally(() => { this._busy = false; });
  }

  dispose() {
    this._out?.dispose();
    if (this._denoiserOwned) this._denoiser?.then((d) => d.dispose());
    super.dispose();
  }

  // ---- internals ----------------------------------------------------------

  private _getDenoiser(renderer: WebGPURenderer): Promise<Denoiser> {
    if (this._denoiser) return this._denoiser;
    const o = this._options;
    if (!o.runtime) {
      return Promise.reject(new Error('denoiser/three: denoise() needs `denoiser` (a Denoiser) or `runtime` (a NetworkRuntime or (device) => runtime)'));
    }
    this._denoiserOwned = true;
    this._denoiser = createDenoiserForRenderer(renderer, { runtime: o.runtime, precision: o.precision, quality: o.quality });
    return this._denoiser;
  }

  /** The three Texture behind a texture/pass node. */
  private _texOf(node: TextureNodeLike): Texture | null {
    return node?.value ?? node?.renderTarget?.texture ?? node?.passNode?.renderTarget?.texture ?? null;
  }

  private _gpu(renderer: WebGPURenderer, node: TextureNodeLike): GPUTexture | undefined {
    const tex = this._texOf(node);
    if (!tex) return undefined;
    try {
      return getGPUTexture(renderer, tex);
    } catch {
      // Not on the GPU yet (e.g. a plain DataTexture that was never drawn): upload it.
      try { renderer.initTexture(tex); return getGPUTexture(renderer, tex); } catch { return undefined; }
    }
  }

  private _allocOutput(renderer: WebGPURenderer, w: number, h: number) {
    const out = new StorageTexture(w, h);
    out.type = HalfFloatType;
    out.generateMipmaps = false;
    out.minFilter = out.magFilter = LinearFilter;
    // Baked display transforms must not be touched by three's colour management.
    out.colorSpace = (this._options.transfer ?? 'linear') === 'linear' ? LinearSRGBColorSpace : NoColorSpace;
    renderer.initTexture(out);
    const old = this._out;
    this._out = out;
    if (this._textureNode) this._textureNode.value = out;
    old?.dispose();
  }

  private async _run(renderer: WebGPURenderer, generation: number): Promise<GPUTexture | undefined> {
    const o = this._options;
    const denoiser = await this._getDenoiser(renderer);
    if (generation !== this._generation) return undefined;

    const color = this._gpu(renderer, this._color);
    const albedo = o.albedo ? this._gpu(renderer, o.albedo) : undefined;
    const normal = o.normal ? this._gpu(renderer, o.normal) : undefined;
    if (!color || (o.albedo && !albedo) || (o.normal && !normal)) {
      this._pending = true; // an input isn't rendered yet — retry next frame
      return undefined;
    }

    if (!this._out || this._out.width !== color.width || this._out.height !== color.height) {
      this._allocOutput(renderer, color.width, color.height);
    }
    return denoiser.denoiseTextures({
      color, albedo, normal,
      output: getGPUTexture(renderer, this._out!),
      hdr: o.hdr ?? true,
      inputScale: o.inputScale,
      transfer: o.transfer ?? 'linear',
      inputFlipY: o.inputFlipY ?? false,
      auxInputFlipY: o.auxInputFlipY,
      outputFlipY: o.outputFlipY,
    });
  }
}

/**
 * Create a {@link DenoiseNode}. Non-texture inputs (arbitrary TSL expressions) are
 * rendered to a texture first, like three's own display nodes do.
 */
export const denoise = (color: TextureNodeLike, options: DenoiseNodeOptions = {}) =>
  nodeObject(new DenoiseNode(convertToTexture(color), {
    ...options,
    albedo: options.albedo ? convertToTexture(options.albedo) : undefined,
    normal: options.normal ? convertToTexture(options.normal) : undefined,
  }));
