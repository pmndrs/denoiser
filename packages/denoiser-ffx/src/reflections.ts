// FfxReflectionDenoiser — WebGPU host for the WGSL port of the FidelityFX
// reflection denoiser (SDK v1.1.4). Pass order and resource ping-pong follow
// denoiserDispatchReflections() in sdk/src/components/denoiser/ffx_denoiser.cpp
// and its caller in sdk/src/components/sssr/ffx_sssr.cpp
// (Copyright (C) 2024 Advanced Micro Devices, Inc., MIT — see NOTICE):
//
//   prepare           depth -> r32f, normal+roughness -> rgba16f   (this frame's copies;
//                     replaces FFX's end-of-frame depth/normal/roughness history copies)
//   reproject         -> reprojected radiance, variance, sample count[cur], 8x8 avg radiance[cur]
//   prefilter         noisy radiance + variance -> prefiltered radiance/variance
//   resolve_temporal  -> result[cur] (= output, and next frame's radiance history), variance[cur]
import type {
  FrameCamera, FrameGuides, SpecularInputs, TemporalConfig, TemporalDenoiser,
} from '@pmndrs/denoiser-core';
import { invert, isDepthFormat, mat4, mul, PassTimer } from './common';
import { PREFILTER_WGSL, reflectionPrepareWgsl, REPROJECT_WGSL, RESOLVE_TEMPORAL_WGSL } from './shaders/reflections';

export interface FfxReflectionDenoiserOptions {
  /**
   * FFX `temporalStabilityFactor` (history clip box scale; higher = more stable,
   * more ghosting). Default 0.7 (FidelityFX SSSR sample default).
   */
  temporalStabilityFactor?: number;
  /**
   * Pixels whose (linear) roughness is >= this are passed through untouched.
   * FFX's samples use ~0.2 because rougher pixels don't trace rays there; this
   * denoiser assumes every pixel was traced, so the default is 1 (denoise all).
   */
  roughnessThreshold?: number;
  /** `guides.roughness` is perceptual (squared before use). Default true (three.js convention). */
  roughnessIsPerceptual?: boolean;
  /** Ray length used for misses (hitDistance <= 0). Default: camera.far. */
  missDistance?: number;
  /**
   * FFX v1.1.4's host (ffx_denoiser.cpp) binds the *previous* frame's 8x8 average
   * radiance (prefilter, resolve) and sample count (resolve, un-reprojected): its
   * SRV/UAV ping-pong is one frame off. That blends zeroed history at full weight
   * on disocclusions (dark speckles) and outputs ~black on the first frame after a
   * reset. true (default) reads this frame's values; false reproduces v1.1.4 exactly.
   */
  currentFrameStatistics?: boolean;
  /** Per-pass GPU timestamps into `gpuTimings` when the device supports them. Default true. */
  timestamps?: boolean;
}

const PARAMS_SIZE = 256;
const STORAGE_TEX = GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING;

export class FfxReflectionDenoiser implements TemporalDenoiser<SpecularInputs> {
  readonly name = 'ffx-reflections';
  readonly device: GPUDevice;
  private opts: Required<Omit<FfxReflectionDenoiserOptions, 'missDistance'>> & { missDistance?: number };
  private timer?: PassTimer;
  private width = 0;
  private height = 0;
  private frame = 0;
  private needsReset = true;

  private params: GPUBuffer;
  private sampler: GPUSampler;
  private layouts: Record<string, GPUBindGroupLayout> = {};
  private pipes: Record<string, GPUComputePipeline> = {};

  private depth: GPUTexture[] = [];
  private normRough: GPUTexture[] = [];
  private result: GPUTexture[] = [];        // rgba16float: temporal result = output + radiance history
  private finalVariance: GPUTexture[] = []; // r32float
  private sampleCount: GPUTexture[] = [];   // r32float
  private avgRadiance: GPUTexture[] = [];   // rgba16float, ceil(W/8) x ceil(H/8)
  private reprojected?: GPUTexture;
  private reprojVariance?: GPUTexture;
  private prefiltered?: GPUTexture;
  private prefilterVariance?: GPUTexture;

  constructor(device: GPUDevice, options: FfxReflectionDenoiserOptions = {}) {
    this.device = device;
    this.opts = {
      temporalStabilityFactor: options.temporalStabilityFactor ?? 0.7,
      roughnessThreshold: options.roughnessThreshold ?? 1.0,
      roughnessIsPerceptual: options.roughnessIsPerceptual ?? true,
      missDistance: options.missDistance,
      currentFrameStatistics: options.currentFrameStatistics ?? true,
      timestamps: options.timestamps ?? true,
    };
    if (this.opts.timestamps && PassTimer.supported(device)) this.timer = new PassTimer(device);
    this.params = device.createBuffer({ size: PARAMS_SIZE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
    this.createPipelines();
  }

  get gpuTimings(): ReadonlyMap<string, number> | undefined { return this.timer?.timings; }

  private createPipelines() {
    const d = this.device;
    const C = GPUShaderStage.COMPUTE;
    const uni: GPUBindGroupLayoutEntry = { binding: 0, visibility: C, buffer: { type: 'uniform' } };
    const tex = (binding: number, sampleType: GPUTextureSampleType = 'unfilterable-float'): GPUBindGroupLayoutEntry =>
      ({ binding, visibility: C, texture: { sampleType } });
    const sto = (binding: number, format: GPUTextureFormat): GPUBindGroupLayoutEntry =>
      ({ binding, visibility: C, storageTexture: { access: 'write-only', format } });
    const smp = (binding: number): GPUBindGroupLayoutEntry => ({ binding, visibility: C, sampler: { type: 'filtering' } });

    for (const kind of ['depth', 'float'] as const) {
      this.layouts[`prepare_${kind}`] = d.createBindGroupLayout({
        label: `ffx-reflections prepare (${kind})`,
        entries: [uni, tex(1, kind === 'depth' ? 'depth' : 'unfilterable-float'), tex(2), tex(3), sto(4, 'r32float'), sto(5, 'rgba16float')],
      });
    }
    this.layouts.reproject = d.createBindGroupLayout({
      label: 'ffx-reflections reproject',
      entries: [uni, tex(1), tex(2), tex(3), tex(4), tex(5), tex(6, 'float'), tex(7), tex(8, 'float'), tex(9), tex(10), smp(11),
        sto(12, 'rgba16float'), sto(13, 'r32float'), sto(14, 'r32float'), sto(15, 'rgba16float')],
    });
    this.layouts.prefilter = d.createBindGroupLayout({
      label: 'ffx-reflections prefilter',
      entries: [uni, tex(1), tex(2), tex(3), tex(4), tex(5, 'float'), smp(6), sto(7, 'rgba16float'), sto(8, 'r32float')],
    });
    this.layouts.resolve = d.createBindGroupLayout({
      label: 'ffx-reflections resolve_temporal',
      entries: [uni, tex(1), tex(2), tex(3), tex(4), tex(5, 'float'), tex(6), smp(7), sto(8, 'rgba16float'), sto(9, 'r32float')],
    });
    const make = (name: string, code: string, layout: GPUBindGroupLayout) => {
      this.pipes[name] = d.createComputePipeline({
        label: `ffx-reflections ${name}`,
        layout: d.createPipelineLayout({ bindGroupLayouts: [layout] }),
        compute: { module: d.createShaderModule({ label: `ffx-reflections ${name}`, code }), entryPoint: 'main' },
      });
    };
    make('prepare_depth', reflectionPrepareWgsl(true), this.layouts.prepare_depth);
    make('prepare_float', reflectionPrepareWgsl(false), this.layouts.prepare_float);
    make('reproject', REPROJECT_WGSL, this.layouts.reproject);
    make('prefilter', PREFILTER_WGSL, this.layouts.prefilter);
    make('resolve', RESOLVE_TEMPORAL_WGSL, this.layouts.resolve);
  }

  configure({ width, height }: TemporalConfig): void {
    this.destroyTargets();
    this.width = width;
    this.height = height;
    const d = this.device;
    const RA = GPUTextureUsage.RENDER_ATTACHMENT;
    const tex = (label: string, format: GPUTextureFormat, extra = 0, w = width, h = height) =>
      d.createTexture({ label: `ffx-reflections ${label}`, size: [w, h], format, usage: STORAGE_TEX | RA | extra });
    const pair = (label: string, format: GPUTextureFormat, extra = 0, w = width, h = height) =>
      [tex(`${label}0`, format, extra, w, h), tex(`${label}1`, format, extra, w, h)];
    this.depth = pair('depth', 'r32float');
    this.normRough = pair('normal+roughness', 'rgba16float');
    this.result = pair('result', 'rgba16float', GPUTextureUsage.COPY_SRC);
    this.finalVariance = pair('variance', 'r32float');
    this.sampleCount = pair('sample count', 'r32float');
    this.avgRadiance = pair('avg radiance', 'rgba16float', 0, Math.ceil(width / 8), Math.ceil(height / 8));
    this.reprojected = tex('reprojected radiance', 'rgba16float');
    this.reprojVariance = tex('reproject variance', 'r32float');
    this.prefiltered = tex('prefiltered radiance', 'rgba16float');
    this.prefilterVariance = tex('prefilter variance', 'r32float');
    this.needsReset = true;
    this.frame = 0;
  }

  resetHistory(): void { this.needsReset = true; }

  dispatch(inputs: SpecularInputs, guides: FrameGuides, camera: FrameCamera): GPUTexture {
    if (!this.reprojected) throw new Error('FfxReflectionDenoiser: call configure() before dispatch()');
    if (!guides.roughness) throw new Error('FfxReflectionDenoiser: guides.roughness is required');
    const { width: W, height: H } = this;
    for (const [k, t] of [['radiance', inputs.radiance], ['hitDistance', inputs.hitDistance], ['depth', guides.depth],
      ['normal', guides.normal], ['motion', guides.motion], ['roughness', guides.roughness]] as const) {
      if (t.width !== W || t.height !== H) throw new Error(`FfxReflectionDenoiser: ${k} is ${t.width}x${t.height}, configured ${W}x${H}`);
    }
    const d = this.device;

    // ---- constants (DenoiserReflectionsConstants)
    const V = mat4(camera.view), Pm = mat4(camera.projection);
    const prevVP = mul(mat4(camera.prevProjection), mat4(camera.prevView));
    const buf = new ArrayBuffer(PARAMS_SIZE);
    const f = new Float32Array(buf), u32 = new Uint32Array(buf);
    f.set(invert(Pm), 0); f.set(invert(V), 16); f.set(prevVP, 32);
    u32[48] = W; u32[49] = H; f[50] = 1 / W; f[51] = 1 / H;
    f[52] = -0.5; f[53] = 0.5; // NDC delta (current - previous) -> previous_uv - current_uv
    f[54] = 1; f[55] = 0;       // normals already in [-1, 1]
    u32[56] = this.opts.roughnessIsPerceptual ? 1 : 0;
    f[57] = this.opts.temporalStabilityFactor;
    f[58] = this.opts.roughnessThreshold;
    f[59] = this.opts.missDistance ?? camera.far;
    d.queue.writeBuffer(this.params, 0, buf);

    const enc = d.createCommandEncoder({ label: 'ffx-reflections' });
    if (this.needsReset) {
      // FFX zero-initializes sample counts, average radiance and reprojected radiance
      // on the first frame (and average radiance on reset); a reset here drops all history.
      // Port addition: also clear the depth / normal+roughness history so the reset
      // frame sees a full disocclusion (FFX's `reset` only clears the average radiance,
      // which lets stale geometry history accept the zeroed radiance history).
      for (const t of [...this.sampleCount, ...this.avgRadiance, this.reprojected, ...this.result, ...this.finalVariance,
        ...this.depth, ...this.normRough]) {
        enc.beginRenderPass({ colorAttachments: [{ view: t.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }] }).end();
      }
    }
    const cur = this.frame & 1, prev = cur ^ 1;
    const v = (t: GPUTexture) => t.createView();
    const kind = isDepthFormat(guides.depth.format) ? 'depth' : 'float';
    const depthIn = kind === 'depth' ? guides.depth.createView({ aspect: 'depth-only' }) : guides.depth.createView();
    const P = { binding: 0, resource: { buffer: this.params } };
    const bg = (layout: string, entries: GPUBindingResource[]) => d.createBindGroup({
      layout: this.layouts[layout], entries: [P, ...entries.map((resource, i) => ({ binding: i + 1, resource }))],
    });
    const groups: [number, number] = [Math.ceil(W / 8), Math.ceil(H / 8)];
    const run = (name: string, pipe: string, group: GPUBindGroup) => {
      const pass = enc.beginComputePass({ label: `ffx-reflections ${name}`, timestampWrites: this.timer?.pass(name) });
      pass.setPipeline(this.pipes[pipe]);
      pass.setBindGroup(0, group);
      pass.dispatchWorkgroups(groups[0], groups[1]);
      pass.end();
    };
    // statistics read by prefilter / resolve: FFX's one-frame-late SRVs, or this frame's
    const statIdx = this.opts.currentFrameStatistics ? cur : prev;

    this.timer?.begin();
    run('prepare', `prepare_${kind}`, bg(`prepare_${kind}`, [
      depthIn, v(guides.normal), v(guides.roughness), v(this.depth[cur]), v(this.normRough[cur]),
    ]));
    run('reproject', 'reproject', bg('reproject', [
      v(this.depth[cur]), v(this.normRough[cur]), v(guides.motion), v(inputs.radiance), v(inputs.hitDistance),
      v(this.result[prev]), v(this.depth[prev]), v(this.normRough[prev]), v(this.finalVariance[prev]), v(this.sampleCount[prev]),
      this.sampler, v(this.reprojected), v(this.reprojVariance!), v(this.sampleCount[cur]), v(this.avgRadiance[cur]),
    ]));
    run('prefilter', 'prefilter', bg('prefilter', [
      v(this.depth[cur]), v(this.normRough[cur]), v(inputs.radiance), v(this.reprojVariance!), v(this.avgRadiance[statIdx]),
      this.sampler, v(this.prefiltered!), v(this.prefilterVariance!),
    ]));
    run('resolve_temporal', 'resolve', bg('resolve', [
      v(this.normRough[cur]), v(this.prefiltered!), v(this.prefilterVariance!), v(this.sampleCount[statIdx]),
      v(this.avgRadiance[statIdx]), v(this.reprojected), this.sampler, v(this.result[cur]), v(this.finalVariance[cur]),
    ]));
    const after = this.timer?.end(enc);
    d.queue.submit([enc.finish()]);
    after?.();

    this.needsReset = false;
    this.frame++;
    return this.result[cur];
  }

  private destroyTargets() {
    for (const t of [...this.depth, ...this.normRough, ...this.result, ...this.finalVariance, ...this.sampleCount, ...this.avgRadiance]) t.destroy();
    for (const t of [this.reprojected, this.reprojVariance, this.prefiltered, this.prefilterVariance]) t?.destroy();
    this.depth = []; this.normRough = []; this.result = []; this.finalVariance = []; this.sampleCount = []; this.avgRadiance = [];
    this.reprojected = this.reprojVariance = this.prefiltered = this.prefilterVariance = undefined;
  }

  dispose(): void {
    this.destroyTargets();
    this.params.destroy();
    this.timer?.destroy();
  }
}
