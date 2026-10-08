// FfxShadowDenoiser — WebGPU host for the WGSL port of the FidelityFX shadow
// denoiser (SDK v1.1.4). Pass order and resource aliasing follow
// denoiserDispatchShadows() in sdk/src/components/denoiser/ffx_denoiser.cpp
// (Copyright (C) 2024 Advanced Micro Devices, Inc., MIT — see NOTICE):
//
//   prepare            visibility -> 8x4 tile bitmask, depth -> r32f (ping-pong)
//   tile_classification  tile skip + temporal reprojection/moments  -> scratch0, moments[cur]
//   filter_0 (step 1)  scratch0 -> scratch1   (scratch1 = next frame's history)
//   filter_1 (step 2)  scratch1 -> scratch0
//   filter_2 (step 4)  scratch0 -> output     (+ contrast remap)
import type {
  FrameCamera, FrameGuides, ShadowInputs, TemporalConfig, TemporalDenoiser,
} from '@pmndrs/denoiser-core';
import { eyeFromView, invert, isDepthFormat, mat4, mul, PassTimer } from './common';
import { filterWgsl, prepareWgsl, TILE_CLASSIFICATION_WGSL } from './shaders/shadows';

export interface FfxShadowDenoiserOptions {
  /** FFX `depthSimilaritySigma` (edge-stopping on linear depth in view units). Default 1. */
  depthSimilaritySigma?: number;
  /**
   * FFX consumes a binary ray-hit mask. Visibility >= threshold counts as lit.
   * Default 0.5.
   */
  visibilityThreshold?: number;
  /** Per-pass GPU timestamps into `gpuTimings` when the device supports them. Default true. */
  timestamps?: boolean;
}

const PARAMS_SIZE = 256;
const STORAGE_TEX = GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING;

export class FfxShadowDenoiser implements TemporalDenoiser<ShadowInputs> {
  readonly name = 'ffx-shadows';
  readonly device: GPUDevice;
  private opts: Required<FfxShadowDenoiserOptions>;
  private timer?: PassTimer;
  private width = 0;
  private height = 0;
  private frame = 0;
  private needsReset = true;

  private params: GPUBuffer;
  private sampler: GPUSampler;
  private layouts: Record<string, GPUBindGroupLayout> = {};
  private pipes: Record<string, GPUComputePipeline> = {};

  private shadowMask?: GPUBuffer;
  private tileMeta?: GPUBuffer;
  private depth: GPUTexture[] = [];
  private moments: GPUTexture[] = [];
  private scratch: GPUTexture[] = [];
  private output?: GPUTexture;

  constructor(device: GPUDevice, options: FfxShadowDenoiserOptions = {}) {
    this.device = device;
    this.opts = {
      depthSimilaritySigma: options.depthSimilaritySigma ?? 1.0,
      visibilityThreshold: options.visibilityThreshold ?? 0.5,
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
    const buf = (binding: number, type: GPUBufferBindingType): GPUBindGroupLayoutEntry =>
      ({ binding, visibility: C, buffer: { type } });

    for (const kind of ['depth', 'float'] as const) {
      this.layouts[`prepare_${kind}`] = d.createBindGroupLayout({
        label: `ffx-shadows prepare (${kind})`,
        entries: [uni, tex(1), tex(2, kind === 'depth' ? 'depth' : 'unfilterable-float'), sto(3, 'r32float'), buf(4, 'storage')],
      });
    }
    this.layouts.tile = d.createBindGroupLayout({
      label: 'ffx-shadows tile_classification',
      entries: [uni, tex(1), tex(2), tex(3), tex(4, 'float'), tex(5), tex(6),
        { binding: 7, visibility: C, sampler: { type: 'filtering' } },
        buf(8, 'storage'), sto(9, 'rgba16float'), sto(10, 'rgba16float'), buf(11, 'read-only-storage')],
    });
    this.layouts.filter = d.createBindGroupLayout({
      label: 'ffx-shadows filter',
      entries: [uni, tex(1), tex(2), tex(3), buf(4, 'read-only-storage'), sto(5, 'rgba16float')],
    });
    const make = (name: string, code: string, layout: GPUBindGroupLayout) => {
      this.pipes[name] = d.createComputePipeline({
        label: `ffx-shadows ${name}`,
        layout: d.createPipelineLayout({ bindGroupLayouts: [layout] }),
        compute: { module: d.createShaderModule({ label: `ffx-shadows ${name}`, code }), entryPoint: 'main' },
      });
    };
    make('prepare_depth', prepareWgsl(true), this.layouts.prepare_depth);
    make('prepare_float', prepareWgsl(false), this.layouts.prepare_float);
    make('tile', TILE_CLASSIFICATION_WGSL, this.layouts.tile);
    make('filter0', filterWgsl(0), this.layouts.filter);
    make('filter1', filterWgsl(1), this.layouts.filter);
    make('filter2', filterWgsl(2), this.layouts.filter);
  }

  configure({ width, height }: TemporalConfig): void {
    this.destroyTargets();
    this.width = width;
    this.height = height;
    const d = this.device;
    const tex = (label: string, format: GPUTextureFormat, extra = 0) =>
      d.createTexture({ label: `ffx-shadows ${label}`, size: [width, height], format, usage: STORAGE_TEX | extra });
    const tilesX = Math.ceil(width / 8);
    // shadow mask: one u32 per 8x4 tile; metadata: one u32 per 8x8 thread group
    this.shadowMask = d.createBuffer({ label: 'ffx-shadows mask', size: 4 * tilesX * Math.ceil(height / 4), usage: GPUBufferUsage.STORAGE });
    this.tileMeta = d.createBuffer({ label: 'ffx-shadows tile metadata', size: 4 * tilesX * Math.ceil(height / 8), usage: GPUBufferUsage.STORAGE });
    this.depth = [tex('depth0', 'r32float'), tex('depth1', 'r32float')];
    // FFX uses R11G11B10F moments and RG16F scratch; neither is a core WebGPU
    // storage format, so both are rgba16float (more precision, not less).
    const RA = GPUTextureUsage.RENDER_ATTACHMENT;
    this.moments = [tex('moments0', 'rgba16float', RA), tex('moments1', 'rgba16float', RA)];
    this.scratch = [tex('scratch0', 'rgba16float', RA), tex('scratch1', 'rgba16float', RA)];
    this.output = tex('output', 'rgba16float', GPUTextureUsage.COPY_SRC);
    this.needsReset = true;
    this.frame = 0;
  }

  resetHistory(): void { this.needsReset = true; }

  dispatch(inputs: ShadowInputs, guides: FrameGuides, camera: FrameCamera): GPUTexture {
    if (!this.output) throw new Error('FfxShadowDenoiser: call configure() before dispatch()');
    const { width: W, height: H } = this;
    for (const [k, t] of [['visibility', inputs.visibility], ['depth', guides.depth], ['normal', guides.normal], ['motion', guides.motion]] as const) {
      if (t.width !== W || t.height !== H) throw new Error(`FfxShadowDenoiser: ${k} is ${t.width}x${t.height}, configured ${W}x${H}`);
    }
    const d = this.device;
    const first = this.needsReset;

    // ---- constants (ffx_denoiser.cpp: DenoiserShadowsTileClassificationConstants / FilterConstants)
    const V = mat4(camera.view), Pm = mat4(camera.projection), Vp = mat4(camera.prevView);
    const VP = mul(Pm, V);
    const viewProjInv = invert(VP);
    const projInv = invert(Pm);
    // "projection(current) * (prevView * inverse(viewProjection(current)))"
    const reproj = mul(Pm, mul(Vp, viewProjInv));
    const eye = camera.position ?? eyeFromView(V);
    const buf = new ArrayBuffer(PARAMS_SIZE);
    const f = new Float32Array(buf), i32 = new Int32Array(buf), u32 = new Uint32Array(buf);
    f.set(projInv, 0); f.set(reproj, 16); f.set(viewProjInv, 32);
    f.set(eye, 48); i32[51] = first ? 1 : 0;
    i32[52] = W; i32[53] = H; f[54] = 1 / W; f[55] = 1 / H;
    // motion is an NDC delta (current - previous, y up); FFX wants previous_uv - current_uv
    f[56] = -0.5; f[57] = 0.5;
    f[58] = 1; f[59] = 0; // normals already in [-1, 1]
    f[60] = this.opts.depthSimilaritySigma;
    u32[61] = camera.reversedDepth ? 1 : 0;
    f[62] = this.opts.visibilityThreshold;
    d.queue.writeBuffer(this.params, 0, buf);

    const enc = d.createCommandEncoder({ label: 'ffx-shadows' });
    if (first) {
      // "Clear shadow map": moments0/1, scratch0/1
      for (const t of [...this.moments, ...this.scratch]) {
        enc.beginRenderPass({ colorAttachments: [{ view: t.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }] }).end();
      }
    }
    const cur = this.frame & 1;
    const depthCur = this.depth[cur], depthPrev = this.depth[cur ^ 1];
    // FFX: even frame reads moments0, writes moments1
    const momentsPrev = this.moments[cur], momentsCur = this.moments[cur ^ 1];
    const [s0, s1] = this.scratch;
    const v = (t: GPUTexture) => t.createView();
    const depthIn = isDepthFormat(guides.depth.format)
      ? guides.depth.createView({ aspect: 'depth-only' }) : guides.depth.createView();
    const kind = isDepthFormat(guides.depth.format) ? 'depth' : 'float';
    const P = { binding: 0, resource: { buffer: this.params } };
    const bg = (layout: string, entries: GPUBindGroupEntry[]) =>
      d.createBindGroup({ layout: this.layouts[layout], entries: [P, ...entries.map((e, i) => ({ ...e, binding: i + 1 }))] as GPUBindGroupEntry[] });
    const R = (resource: GPUBindingResource) => ({ binding: 0, resource });

    const tilesX = Math.ceil(W / 8);
    const groups8x8: [number, number] = [tilesX, Math.ceil(H / 8)];
    const run = (name: string, pipe: string, group: GPUBindGroup, [x, y]: [number, number]) => {
      const pass = enc.beginComputePass({ label: `ffx-shadows ${name}`, timestampWrites: this.timer?.pass(name) });
      pass.setPipeline(this.pipes[pipe]);
      pass.setBindGroup(0, group);
      pass.dispatchWorkgroups(x, y);
      pass.end();
    };
    this.timer?.begin();
    run('prepare', `prepare_${kind}`, bg(`prepare_${kind}`, [
      R(v(inputs.visibility)), R(depthIn), R(v(depthCur)), R({ buffer: this.shadowMask! }),
    ]), [tilesX, Math.ceil(H / 4)]);
    run('tile_classification', 'tile', bg('tile', [
      R(v(depthCur)), R(v(guides.motion)), R(v(guides.normal)), R(v(s1)), R(v(depthPrev)), R(v(momentsPrev)),
      R(this.sampler), R({ buffer: this.tileMeta! }), R(v(s0)), R(v(momentsCur)), R({ buffer: this.shadowMask! }),
    ]), groups8x8);
    const filter = (i: number, input: GPUTexture, out: GPUTexture) =>
      run(`filter_${i}`, `filter${i}`, bg('filter', [
        R(v(depthCur)), R(v(guides.normal)), R(v(input)), R({ buffer: this.tileMeta! }), R(v(out)),
      ]), groups8x8);
    filter(0, s0, s1);
    filter(1, s1, s0);
    filter(2, s0, this.output);
    const after = this.timer?.end(enc);
    d.queue.submit([enc.finish()]);
    after?.();

    this.needsReset = false;
    this.frame++;
    return this.output;
  }

  private destroyTargets() {
    for (const t of [...this.depth, ...this.moments, ...this.scratch]) t.destroy();
    this.output?.destroy();
    this.shadowMask?.destroy();
    this.tileMeta?.destroy();
    this.depth = []; this.moments = []; this.scratch = [];
    this.output = this.shadowMask = this.tileMeta = undefined;
  }

  dispose(): void {
    this.destroyTargets();
    this.params.destroy();
    this.timer?.destroy();
  }
}
