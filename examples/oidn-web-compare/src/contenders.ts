// The denoisers being compared, behind one interface: same inputs in, a linear-HDR
// rgba16float texture out, timed the same way.
//
//   ours            the `denoiser` package on the page's runtime (?runtime=, see _shared/stack.ts)
//   oidn-web 0.5    pissang/oidn-web, the build three-gpu-pathtracer's OIDNDenoiser targets:
//                   hand-written WGSL (default tiling, or the whole image as one tile) or WebNN
//   oidn-web 0.3.5  the last TensorFlow.js build (tfjs-backend-webgpu), installed as `oidn-web-tfjs`
//
// Fairness rules every contender follows:
// - the same weights: OIDN's `rt_hdr_calb_cnrm{_small,,_large}.tza` from one place
//   (`tzaBase`), picked by the same quality setting;
// - the same inputs: one snapshot of the tracer's accumulation and one rasterized G-buffer
//   (see GBuffer). Normals are written twice because the two libraries take them differently:
//   ours maps [-1, 1] itself, oidn-web passes the texture straight into the network, which
//   expects OIDN's [0, 1] encoding;
// - the same precision: fp16 when the device has `shader-f16` and the page asked for it;
// - the same clock: wall time from the call until the output texture is written and the queue
//   has drained (`onSubmittedWorkDone`), so CPU overhead and tile scheduling count.
import * as THREE from 'three/webgpu';
import { diffuseColor, mrt, normalView, vec4 } from 'three/tsl';
import type { Denoiser } from 'denoiser';
import { gpuTex } from '../../_shared/stack';

export type Quality = 'fast' | 'balanced' | 'high';

/** OIDN weights file for the guided (clean albedo + normal) HDR model, as `denoiser` picks it. */
export function modelFor(quality: Quality, aux: boolean) {
  const base = aux ? 'rt_hdr_calb_cnrm' : 'rt_hdr';
  if (quality === 'fast') return `${base}_small`;
  if (quality === 'high' && aux) return `${base}_large`; // rt_hdr has no large variant
  return base;
}

/** What every contender denoises: one frame, frozen. */
export interface Inputs {
  color: THREE.Texture; // rgba32float, linear HDR
  albedo: THREE.Texture;
  normal: THREE.Texture; // [-1, 1]
  normal01: THREE.Texture; // 0.5 * n + 0.5
  width: number;
  height: number;
  /** Bumped whenever the inputs change, so stale results are recognisable. */
  epoch: number;
}

export interface RunOptions { quality: Quality; aux: boolean }

export interface RunResult {
  /** Wall time of this run, ms. */
  ms: number;
  /** True when this run paid for the weights download, parse and shader compile. */
  cold: boolean;
  output: THREE.StorageTexture;
  /** Contender-specific detail (tiles, engine, precision). */
  detail: string;
}

export interface Contender {
  id: string;
  label: string;
  /** Short label for the split-view tags. */
  short: string;
  /** Why it can't run here, or undefined. */
  unavailable?: string;
  run(inputs: Inputs, opts: RunOptions): Promise<RunResult>;
  abort(): void;
}

/** Albedo + both normal encodings, rasterized once per frame and shared by every contender. */
export class GBuffer {
  // Multisampled like the tracer's own OIDNDenoiser, so rasterized silhouettes match the
  // anti-aliased path-traced ones.
  readonly target = new THREE.RenderTarget(1, 1, { count: 3, type: THREE.HalfFloatType, samples: 4, depthBuffer: true });

  constructor() {
    // MRT outputs bind to attachments by name
    this.target.textures[0].name = 'albedo';
    this.target.textures[1].name = 'normal';
    this.target.textures[2].name = 'normal01';
  }

  render(renderer: THREE.WebGPURenderer, scene: THREE.Scene, camera: THREE.Camera, width: number, height: number) {
    this.target.setSize(width, height);
    const prevTarget = renderer.getRenderTarget();
    const prevMRT = renderer.getMRT();
    const prevTone = renderer.toneMapping;
    renderer.toneMapping = THREE.NoToneMapping; // data, not an image
    renderer.setRenderTarget(this.target);
    renderer.setMRT(mrt({
      albedo: diffuseColor,
      normal: vec4(normalView, 1),
      normal01: vec4(normalView.mul(0.5).add(0.5), 1),
    }));
    renderer.render(scene, camera);
    renderer.setMRT(prevMRT);
    renderer.setRenderTarget(prevTarget);
    renderer.toneMapping = prevTone;
    const [albedo, normal, normal01] = this.target.textures;
    return { albedo, normal, normal01 };
  }
}

function outputTexture(renderer: THREE.WebGPURenderer, prev: THREE.StorageTexture | null, width: number, height: number) {
  if (prev && prev.width === width && prev.height === height) return prev;
  prev?.dispose();
  const t = new THREE.StorageTexture(width, height);
  t.type = THREE.HalfFloatType;
  t.generateMipmaps = false;
  t.colorSpace = THREE.LinearSRGBColorSpace;
  renderer.initTexture(t);
  return t;
}

/** Our `denoiser` package on whatever runtime the page was created with. */
export class OursContender implements Contender {
  readonly id = 'ours';
  readonly short = 'denoiser';
  private out: THREE.StorageTexture | null = null;
  private warm = new Set<string>();

  constructor(
    private renderer: THREE.WebGPURenderer,
    private device: GPUDevice,
    private denoiser: Denoiser,
    private describe: () => string,
  ) {}

  /** `denoiser · <runtime>`, e.g. `denoiser · auto → webnn-gpu` once AutoRuntime has picked. */
  get label() { return `denoiser · ${this.describe()}`; }

  async run(inp: Inputs, o: RunOptions): Promise<RunResult> {
    const r = this.renderer;
    this.out = outputTexture(r, this.out, inp.width, inp.height);
    this.denoiser.quality = o.quality;
    const model = modelFor(o.quality, o.aux);
    const cold = !this.warm.has(`${model}|${inp.width}x${inp.height}`);
    await this.device.queue.onSubmittedWorkDone();
    const t0 = performance.now();
    const res = await this.denoiser.denoiseTextures({
      color: gpuTex(r, inp.color)!,
      albedo: o.aux ? gpuTex(r, inp.albedo) : undefined,
      normal: o.aux ? gpuTex(r, inp.normal) : undefined,
      hdr: true,
      inputFlipY: false, // tracer output and the raster G-buffer are both top-down
      transfer: 'linear',
      output: gpuTex(r, this.out)!,
    });
    await this.device.queue.onSubmittedWorkDone();
    const ms = performance.now() - t0;
    if (!res) throw new Error('aborted');
    this.warm.add(`${model}|${inp.width}x${inp.height}`);
    return { ms, cold, output: this.out, detail: `${this.describe()} · ${this.denoiser.modelName ?? model}` };
  }

  abort() { this.denoiser.abort(); }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type UNetLike = {
  tileExecute(o: any): () => void;
  getRuntimeInfo?(): any;
  dispose?(): void;
};

export interface OidnWebVariant {
  id: string;
  label: string;
  short: string;
  /** `oidn-web` is 0.5.0, `oidn-web-tfjs` is 0.3.5 (TensorFlow.js). */
  pkg: 'oidn-web' | 'oidn-web-tfjs';
  engine?: 'wgsl' | 'webnn';
  /** Run the whole image as one tile (0.5: `wholeImage`; 0.3.5: `maxTileSize` = the image). */
  wholeImage?: boolean;
  unavailable?: string;
}

/**
 * pissang/oidn-web on the shared device, fed GPU textures (no CPU pixels), its packed output
 * buffer copied into a sampleable texture the same way three-gpu-pathtracer's OIDNDenoiser does.
 */
export class OidnWebContender implements Contender {
  readonly id: string;
  readonly label: string;
  readonly short: string;
  readonly unavailable?: string;
  private unets = new Map<string, Promise<UNetLike>>();
  private warm = new Set<string>();
  private out: THREE.StorageTexture | null = null;
  private pipeline: GPUComputePipeline | null = null;
  private cancel: (() => void) | null = null;
  private reject: ((e: Error) => void) | null = null;

  constructor(
    private renderer: THREE.WebGPURenderer,
    private device: GPUDevice,
    private v: OidnWebVariant,
    private tzaBase: string,
    private precision: 'fp16' | 'fp32',
  ) {
    this.id = v.id;
    this.label = v.label;
    this.short = v.short;
    this.unavailable = v.unavailable;
  }

  private unet(model: string, aux: boolean, maxTileSize?: number): Promise<UNetLike> {
    const key = `${model}|${maxTileSize ?? ''}`;
    let p = this.unets.get(key);
    if (!p) {
      p = (async () => {
        const url = `${this.tzaBase}/${model}.tza`;
        if (this.v.pkg === 'oidn-web') {
          const { initUNetFromURL } = await import('oidn-web');
          return initUNetFromURL(url, { device: this.device }, {
            // 'auto' = fp16 when the device has shader-f16 ('fp16' would throw without it)
            aux, hdr: true, engine: this.v.engine ?? 'wgsl', precision: this.precision === 'fp16' ? 'auto' : 'fp32',
          }) as Promise<UNetLike>;
        }
        // 0.3.5 runs TensorFlow.js's WebGPU backend on the device it is handed (and wants the
        // adapter info TF.js uses to pick kernels)
        const { initUNetFromURL } = await import('oidn-web-tfjs');
        return (initUNetFromURL as any)(url, { device: this.device, adapterInfo: (this.device as any).adapterInfo }, {
          aux, hdr: true, ...(maxTileSize ? { maxTileSize } : {}),
        }) as Promise<UNetLike>;
      })();
      p.catch(() => this.unets.delete(key)); // let a later attempt retry
      this.unets.set(key, p);
    }
    return p;
  }

  async run(inp: Inputs, o: RunOptions): Promise<RunResult> {
    const r = this.renderer;
    const { width, height } = inp;
    this.out = outputTexture(r, this.out, width, height);
    const model = modelFor(o.quality, o.aux);
    // 0.3.5 has no whole-image switch: one tile = a max tile edge covering the image
    // (its tiles are square and rounded up to multiples of maxTileSize / 2, which must stay a
    // multiple of 16 or the U-Net's skip connections disagree by a pixel)
    const tfjsTile = this.v.pkg === 'oidn-web-tfjs' && this.v.wholeImage ? Math.ceil(Math.max(width, height) / 32) * 32 : undefined;
    const warmKey = `${model}|${width}x${height}`;
    const cold = !this.warm.has(warmKey);
    await this.device.queue.onSubmittedWorkDone();
    const t0 = performance.now();
    const unet = await this.unet(model, o.aux, tfjsTile);
    const tex = (t: THREE.Texture) => ({ data: gpuTex(r, t)!, width, height });
    await new Promise<void>((resolve, reject) => {
      this.reject = reject;
      this.cancel = unet.tileExecute({
        color: tex(inp.color),
        ...(o.aux ? { albedo: tex(inp.albedo), normal: tex(inp.normal01) } : {}),
        ...(this.v.pkg === 'oidn-web' && this.v.wholeImage ? { wholeImage: true } : {}),
        done: (output: { data: GPUBuffer }) => {
          this.copy(output.data, width, height);
          resolve();
        },
        error: (e: unknown) => reject(e instanceof Error ? e : new Error(String(e))),
      });
    }).finally(() => { this.cancel = null; this.reject = null; });
    await this.device.queue.onSubmittedWorkDone();
    const ms = performance.now() - t0;
    this.warm.add(warmKey);
    const info = unet.getRuntimeInfo?.();
    const last = info?.lastExecution;
    const detail = info
      ? `${info.gpuEngine} ${info.precision} · ${last ? `${last.tileCount} tile${last.tileCount === 1 ? '' : 's'}` : ''}`
      : `tfjs-webgpu fp32 · ${tfjsTile ? '1 tile' : '512² tiles, rAF-paced'}`;
    return { ms, cold, output: this.out, detail: `${detail} · ${model}` };
  }

  abort() {
    this.cancel?.();
    this.reject?.(new Error('aborted'));
    this.cancel = null;
    this.reject = null;
  }

  // copyBufferToTexture needs 256-byte row alignment, so a compute pass unpacks the
  // tightly packed vec4f buffer instead (as in three-gpu-pathtracer's OIDNDenoiser).
  private copy(src: GPUBuffer, width: number, height: number) {
    const device = this.device;
    if (!this.pipeline) {
      const module = device.createShaderModule({
        code: /* wgsl */ `
          @group(0) @binding(0) var<storage, read> src: array<vec4f>;
          @group(0) @binding(1) var dst: texture_storage_2d<rgba16float, write>;
          @compute @workgroup_size(8, 8)
          fn main(@builtin(global_invocation_id) gid: vec3u) {
            let dims = textureDimensions(dst);
            if (gid.x >= dims.x || gid.y >= dims.y) { return; }
            textureStore(dst, gid.xy, src[gid.y * dims.x + gid.x]);
          }`,
      });
      this.pipeline = device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint: 'main' } });
    }
    const dst = gpuTex(this.renderer, this.out!)!;
    const bindGroup = device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: src } },
        { binding: 1, resource: dst.createView({ baseMipLevel: 0, mipLevelCount: 1 }) },
      ],
    });
    const enc = device.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(Math.ceil(width / 8), Math.ceil(height / 8));
    pass.end();
    device.queue.submit([enc.finish()]);
  }
}

/** The oidn-web builds and settings on offer. */
export function oidnWebVariants(): OidnWebVariant[] {
  const webnn = typeof navigator !== 'undefined' && 'ml' in navigator ? undefined
    : 'WebNN is not exposed in this browser (Chrome: chrome://flags/#web-machine-learning-neural-network)';
  return [
    { id: 'oidn-wgsl', label: 'oidn-web 0.5 · WGSL', short: 'oidn-web 0.5', pkg: 'oidn-web', engine: 'wgsl' },
    { id: 'oidn-wgsl-whole', label: 'oidn-web 0.5 · WGSL · whole image', short: 'oidn-web 0.5 (1 tile)', pkg: 'oidn-web', engine: 'wgsl', wholeImage: true },
    { id: 'oidn-webnn', label: 'oidn-web 0.5 · WebNN', short: 'oidn-web 0.5 WebNN', pkg: 'oidn-web', engine: 'webnn', unavailable: webnn },
    { id: 'oidn-tfjs', label: 'oidn-web 0.3.5 · TensorFlow.js', short: 'oidn-web 0.3.5 TF.js', pkg: 'oidn-web-tfjs' },
    { id: 'oidn-tfjs-whole', label: 'oidn-web 0.3.5 · TensorFlow.js · one tile', short: 'oidn-web 0.3.5 TF.js (1 tile)', pkg: 'oidn-web-tfjs', wholeImage: true },
  ];
}
