// The two post passes the path tracer runs for us, through its own hooks:
//
//   pathTracer.setDenoiser(new DenoiserPass(denoiser))   // once the render reaches maxSamples
//   pathTracer.setUpscaler(new UpscalerPass())           // every frame, before presenting
//
// three-gpu-pathtracer ships an OIDNDenoiser (oidn-web) and an FSRUpscaler (@pmndrs/upscaler)
// for these hooks; DenoiserPass is the same contract on top of the `denoiser` package, and
// UpscalerPass is FSRUpscaler with the path, sharpening and GPU timing exposed for the lab.
import * as THREE from 'three/webgpu';
import { mrt, diffuseColor, normalView } from 'three/tsl';
import { Upscaler } from '@pmndrs/upscaler';
import type { Denoiser } from 'denoiser';
import { gpuTex } from '../../_shared/stack';

/**
 * The path tracer's denoiser hook (the OIDNDenoiser contract: `texture`, `complete`,
 * `running`, `init`, `setScene`, `update`, `reset`), running our Denoiser on the shared device.
 * Output is linear HDR in an rgba16float texture; the tracer's present pass tone maps it.
 */
export class DenoiserPass {
  /** Rasterized albedo + normal guide the filter (the cleanAux models). */
  useAux = true;
  /** Wall time of the last denoise, ms (submit → result ready). */
  lastMs = 0;
  /** First (cold: model load + compile) denoise time per model + size, ms. */
  readonly coldMs = new Map<string, number>();
  /** Called after every finished denoise. */
  onDenoised?: (ms: number) => void;

  private renderer!: THREE.WebGPURenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.Camera;
  private out: THREE.StorageTexture | null = null;
  private gbuffer = new THREE.RenderTarget(1, 1, { count: 2, type: THREE.HalfFloatType });
  private _complete = false;
  private _running = false;
  private _texture: THREE.Texture | null = null;
  private epoch = 0;

  constructor(readonly denoiser: Denoiser) {
    this.gbuffer.textures[0].name = 'albedo'; // MRT outputs bind to attachments by name
    this.gbuffer.textures[1].name = 'normal';
  }

  get texture() { return this._texture; }
  get complete() { return this._complete; }
  get running() { return this._running; }

  init(renderer: THREE.WebGPURenderer) { this.renderer = renderer; }
  setScene(scene: THREE.Scene, camera: THREE.Camera) { this.scene = scene; this.camera = camera; }

  /** Starts a denoise of `target` (the tracer's linear-HDR accumulation) unless one is done or running. */
  update(target: THREE.Texture) {
    if (this._complete || this._running) return this._texture;
    this.run(target).catch((e) => { this._running = false; console.error('denoise failed', e); });
    return this._texture;
  }

  /** Denoises `target` now (the benchmark drives this directly). Resolves with the output texture. */
  async run(target: THREE.Texture): Promise<THREE.Texture | null> {
    const { width, height } = target.image as unknown as { width: number; height: number };
    const r = this.renderer;
    this._running = true;
    const epoch = this.epoch;
    if (!this.out || this.out.width !== width || this.out.height !== height) {
      this.out?.dispose();
      this.out = new THREE.StorageTexture(width, height);
      this.out.type = THREE.HalfFloatType;
      this.out.generateMipmaps = false;
      this.out.colorSpace = THREE.LinearSRGBColorSpace;
      r.initTexture(this.out);
    }
    let albedo: GPUTexture | undefined;
    let normal: GPUTexture | undefined;
    if (this.useAux) {
      this.renderGBuffer(width, height);
      albedo = gpuTex(r, this.gbuffer.textures[0]);
      normal = gpuTex(r, this.gbuffer.textures[1]);
    }
    r.initTexture(target);
    const t0 = performance.now();
    const result = await this.denoiser.denoiseTextures({
      color: gpuTex(r, target)!,
      albedo, normal,
      hdr: true,
      inputFlipY: false, // tracer output and the raster G-buffer are both top-down
      transfer: 'linear',
      output: gpuTex(r, this.out)!,
    });
    if (epoch !== this.epoch) return null; // reset while in flight: the result is for an old view
    this._running = false;
    if (!result) return null; // aborted
    this.lastMs = performance.now() - t0;
    const key = this.modelKey(width, height);
    if (!this.coldMs.has(key)) this.coldMs.set(key, this.lastMs);
    this._complete = true;
    this._texture = this.out;
    this.onDenoised?.(this.lastMs);
    return this.out;
  }

  modelKey(width: number, height: number) { return `${this.denoiser.quality}|${this.useAux}|${width}x${height}`; }

  reset() {
    this.epoch++;
    this.denoiser.abort();
    this._running = false;
    this._complete = false;
    this._texture = null;
  }

  dispose() { this.reset(); this.out?.dispose(); this.gbuffer.dispose(); }

  private renderGBuffer(width: number, height: number) {
    const r = this.renderer;
    this.gbuffer.setSize(width, height);
    const prevTarget = r.getRenderTarget();
    const prevMRT = r.getMRT();
    const prevTone = r.toneMapping;
    r.toneMapping = THREE.NoToneMapping; // data, not an image
    r.setRenderTarget(this.gbuffer);
    r.setMRT(mrt({ albedo: diffuseColor, normal: normalView }));
    r.render(this.scene, this.camera);
    r.setMRT(prevMRT);
    r.setRenderTarget(prevTarget);
    r.toneMapping = prevTone;
  }
}

export type UpscalePath = 'spatial' | 'bilinear';

/**
 * The path tracer's upscaler hook (the FSRUpscaler contract: `init`, `upscale`), on
 * @pmndrs/upscaler. Spatial only: the temporal path needs motion vectors and a per-frame
 * jittered render, and a path tracer accumulating one still image has neither.
 */
export class UpscalerPass {
  path: UpscalePath = 'spatial';
  sharpness = 0.8;
  private renderer!: THREE.WebGPURenderer;
  private upscaler!: Upscaler;
  private size = new THREE.Vector2();
  private configured = '';

  init(renderer: THREE.WebGPURenderer) {
    if (this.renderer === renderer && this.upscaler) return; // re-attached to the same tracer
    this.renderer = renderer;
    this.configured = '';
    this.upscaler?.dispose();
    this.upscaler = new Upscaler({ renderer, gpuTiming: true });
    this.ready = this.upscaler.init();
  }

  /** Resolves once the first configured path's pipelines are built. */
  ready: Promise<void> = Promise.resolve();

  /** GPU time of the last upscale, ms (0 until timestamps arrive or without timestamp-query). */
  get gpuMs() {
    let ms = 0;
    for (const v of this.upscaler?.gpuTimings.values() ?? []) ms += v;
    return ms;
  }

  get output() { return this.upscaler.outputTexture; }

  /** Upscales `source` to the canvas's drawing-buffer size. */
  upscale(source: THREE.Texture, camera: THREE.Camera) {
    const r = this.renderer;
    r.initTexture(source);
    r.getDrawingBufferSize(this.size);
    const { width, height } = source.image as unknown as { width: number; height: number };
    const key = `${this.size.x}x${this.size.y}<${width}x${height}:${this.path}`;
    if (key !== this.configured) { // configure() reallocates, so only on change
      this.upscaler.configure({
        displayWidth: this.size.x, displayHeight: this.size.y,
        renderWidth: width, renderHeight: height, path: this.path,
      });
      this.configured = key;
      void this.upscaler.prepare(); // builds the new path's pipelines; until then we pass through
    }
    if (!this.upscaler.isReady) return source;
    this.upscaler.settings.sharpness = this.sharpness;
    this.upscaler.dispatch({ color: source }, camera as THREE.PerspectiveCamera);
    return this.upscaler.outputTexture;
  }

  /** Configures for `source` and waits for the path's pipelines, so the next call is warm. */
  async warm(source: THREE.Texture, camera: THREE.Camera) {
    this.upscale(source, camera);
    await this.upscaler.prepare();
    this.upscale(source, camera);
  }

  dispose() { this.upscaler?.dispose(); }
}
