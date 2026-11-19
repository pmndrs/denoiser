// Gi1Denoiser — WebGPU host for the WGSL port of AMD GI-1.0's image-space GI denoiser,
// as AMD Capsaicin v1.3 (914b915) dispatches it in GI1::render
// (src/core/src/render_techniques/gi1/gi1.cpp:2881-2926; resources in
// GI1::GIDenoiser::ensureMemoryIsAllocated, gi1.cpp:1193-1228)
// (Copyright (c) 2025 Advanced Micro Devices, Inc., MIT — see NOTICE):
//
//   prepare        depth -> r32f, normal -> rgba16f (this frame's copies, sky = zero normal;
//                  replaces Capsaicin's shared PrevVisibilityDepth / PrevShadingNormal)
//   ReprojectGI    noisy irradiance + reprojected history -> colour[cur] (running sum, count
//                  in w), colour delta[cur], blur mask
//   FilterGI (x)   colour[cur] -> colour[prev]   disocclusion blur, horizontal
//   FilterGI (y)   colour[prev] -> colour[cur]   vertical; also writes the output
//
// colour[cur] (the filtered sum) is next frame's history, as Capsaicin's buffer index swap
// makes it (gi1.cpp:3102).
import type {
  DiffuseInputs, FrameCamera, FrameGuides, TemporalConfig, TemporalDenoiser,
} from '@pmndrs/denoiser-core';
import { eyeFromView, invert, isDepthFormat, mat4, PassTimer, type M4 } from './common';
import { GI1_REPROJECT_WGSL, gi1FilterWgsl, gi1PrepareWgsl } from './shaders/gi1';

export interface Gi1DenoiserOptions {
  /**
   * The screen-probe size in pixels that sizes the reprojection's distance test
   * (Capsaicin's `g_ScreenProbesConstants.cell_size`, gi1.cpp:1839-1843:
   * `tan(fovY * probeSize * max(1 / height, height / width²))` per unit distance).
   * Default 8, Capsaicin's `ScreenProbes::probe_size_`.
   */
  probeSize?: number;
  /**
   * `inputs.radiance.a` is GI-1.0's denoiser hint (Capsaicin's InterpolateScreenProbes,
   * gi1.comp:1636-1638): 1 = a sample to keep, 0 = a fallback value to show this frame but
   * not to accumulate into the history. Default false: every pixel is a sample to keep.
   */
  hintInAlpha?: boolean;
  /** Per-pass GPU timestamps into `gpuTimings` when the device supports them (dispatch only). Default true. */
  timestamps?: boolean;
}

const PARAMS_SIZE = 256;
const WORKGROUP = 8;
// Read lazily: GPUTextureUsage is undefined where WebGPU is absent (SSR / Node), and this runs at import.
const storageTex = () => GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING;

function translation(x: number, y: number, z: number): M4 {
  const m = new Float32Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  m[12] = x; m[13] = y; m[14] = z;
  return m;
}

/** Double-precision column-major product (positions far from the origin stay exact enough). */
function mul64(a: ArrayLike<number>, b: ArrayLike<number>): number[] {
  const o = new Array<number>(16).fill(0);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      o[c * 4 + r] = s;
    }
  }
  return o;
}

export class Gi1Denoiser implements TemporalDenoiser<DiffuseInputs> {
  readonly name = 'gi1';
  readonly device: GPUDevice;
  private opts: Required<Gi1DenoiserOptions>;
  private timer?: PassTimer;
  private width = 0;
  private height = 0;
  private frame = 0;
  private needsReset = true;
  /** The sub-pixel jitter of the previous frame (pixels), for its inverse view-projection. */
  private prevJitter: readonly [number, number] = [0, 0];

  private params: GPUBuffer;
  private layouts: Record<string, GPUBindGroupLayout> = {};
  private pipes: Record<string, GPUComputePipeline> = {};

  private depth: GPUTexture[] = [];
  private normal: GPUTexture[] = [];
  private color: GPUTexture[] = [];
  private colorDelta: GPUTexture[] = [];
  private blurMask?: GPUTexture;
  private output?: GPUTexture;

  constructor(device: GPUDevice, options: Gi1DenoiserOptions = {}) {
    this.device = device;
    this.opts = {
      probeSize: options.probeSize ?? 8,
      hintInAlpha: options.hintInAlpha ?? false,
      timestamps: options.timestamps ?? true,
    };
    if (this.opts.timestamps && PassTimer.supported(device)) this.timer = new PassTimer(device);
    this.params = device.createBuffer({ label: 'gi1 params', size: PARAMS_SIZE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.createPipelines();
  }

  get gpuTimings(): ReadonlyMap<string, number> | undefined { return this.timer?.timings; }

  /** Change `hintInAlpha` between frames. */
  set hintInAlpha(value: boolean) { this.opts.hintInAlpha = value; }
  get hintInAlpha(): boolean { return this.opts.hintInAlpha; }

  /**
   * The blur mask of the latest frame (r32float, the snorm8 values Capsaicin's R8_SNORM
   * holds: blur radius / 8, -1/8 on the sky). Internal; exposed for tests and debug views.
   */
  get debugBlurMask(): GPUTexture | undefined { return this.blurMask; }

  private createPipelines() {
    const d = this.device;
    const C = GPUShaderStage.COMPUTE;
    const uni: GPUBindGroupLayoutEntry = { binding: 0, visibility: C, buffer: { type: 'uniform' } };
    const tex = (binding: number, sampleType: GPUTextureSampleType = 'unfilterable-float'): GPUBindGroupLayoutEntry =>
      ({ binding, visibility: C, texture: { sampleType } });
    const sto = (binding: number, format: GPUTextureFormat): GPUBindGroupLayoutEntry =>
      ({ binding, visibility: C, storageTexture: { access: 'write-only', format } });

    for (const kind of ['depth', 'float'] as const) {
      this.layouts[`prepare_${kind}`] = d.createBindGroupLayout({
        label: `gi1 prepare (${kind})`,
        entries: [uni, tex(1, kind === 'depth' ? 'depth' : 'unfilterable-float'), tex(2), sto(3, 'r32float'), sto(4, 'rgba16float')],
      });
    }
    this.layouts.reproject = d.createBindGroupLayout({
      label: 'gi1 ReprojectGI',
      entries: [uni, tex(1), tex(2), tex(3), tex(4), tex(5), tex(6), tex(7), tex(8),
        sto(9, 'rgba32float'), sto(10, 'r32float'), sto(11, 'r32float')],
    });
    this.layouts.filter_x = d.createBindGroupLayout({
      label: 'gi1 FilterGI (x)',
      entries: [uni, tex(1), tex(2), tex(3), tex(4), sto(5, 'rgba32float')],
    });
    this.layouts.filter_y = d.createBindGroupLayout({
      label: 'gi1 FilterGI (y)',
      entries: [uni, tex(1), tex(2), tex(3), tex(4), sto(5, 'rgba32float'), sto(6, 'rgba16float')],
    });
    const make = (name: string, code: string, layout: GPUBindGroupLayout) => {
      this.pipes[name] = d.createComputePipeline({
        label: `gi1 ${name}`,
        layout: d.createPipelineLayout({ bindGroupLayouts: [layout] }),
        compute: { module: d.createShaderModule({ label: `gi1 ${name}`, code }), entryPoint: 'main' },
      });
    };
    make('prepare_depth', gi1PrepareWgsl(true), this.layouts.prepare_depth);
    make('prepare_float', gi1PrepareWgsl(false), this.layouts.prepare_float);
    make('reproject', GI1_REPROJECT_WGSL, this.layouts.reproject);
    make('filter_x', gi1FilterWgsl(false), this.layouts.filter_x);
    make('filter_y', gi1FilterWgsl(true), this.layouts.filter_y);
  }

  configure({ width, height }: TemporalConfig): void {
    this.destroyTargets();
    this.width = width;
    this.height = height;
    const d = this.device;
    const tex = (label: string, format: GPUTextureFormat, extra = 0) =>
      d.createTexture({ label: `gi1 ${label}`, size: [width, height], format, usage: storageTex() | extra });
    this.depth = [tex('depth0', 'r32float'), tex('depth1', 'r32float')];
    this.normal = [tex('normal0', 'rgba16float'), tex('normal1', 'rgba16float')];
    // Capsaicin: RGBA16F colour and R16F delta; rgba32float / r32float here (see shaders/gi1.ts).
    this.color = [tex('color0', 'rgba32float'), tex('color1', 'rgba32float')];
    this.colorDelta = [tex('colorDelta0', 'r32float'), tex('colorDelta1', 'r32float')];
    // Capsaicin: R8_SNORM; r32float holding the same snorm8 values (r8snorm can't be a storage texture).
    this.blurMask = tex('blurMask', 'r32float', GPUTextureUsage.COPY_SRC);
    // GI_IrradianceBuffer: RGBA16F (gi1.cpp:1707), filterable, as consumers sample it.
    this.output = tex('output', 'rgba16float', GPUTextureUsage.COPY_SRC);
    this.needsReset = true;
    this.frame = 0;
  }

  resetHistory(): void { this.needsReset = true; }

  dispatch(inputs: DiffuseInputs, guides: FrameGuides, camera: FrameCamera): GPUTexture {
    const enc = this.device.createCommandEncoder({ label: 'gi1' });
    this.timer?.begin();
    const output = this.record(enc, inputs, guides, camera, this.timer);
    const after = this.timer?.end(enc);
    this.device.queue.submit([enc.finish()]);
    after?.();
    return output;
  }

  encode(encoder: GPUCommandEncoder, inputs: DiffuseInputs, guides: FrameGuides, camera: FrameCamera): GPUTexture {
    return this.record(encoder, inputs, guides, camera, undefined);
  }

  private record(enc: GPUCommandEncoder, inputs: DiffuseInputs, guides: FrameGuides, camera: FrameCamera, timer: PassTimer | undefined): GPUTexture {
    if (!this.output || !this.blurMask) throw new Error('Gi1Denoiser: call configure() before dispatch()');
    const { width: W, height: H } = this;
    const sized: [string, GPUTexture | undefined][] = [
      ['radiance', inputs.radiance], ['depth', guides.depth], ['normal', guides.normal], ['motion', guides.motion],
      ['previousDepth', guides.previousDepth], ['previousNormal', guides.previousNormal],
    ];
    for (const [k, t] of sized) {
      if (t && (t.width !== W || t.height !== H)) throw new Error(`Gi1Denoiser: ${k} is ${t.width}x${t.height}, configured ${W}x${H}`);
    }
    if (!guides.previousDepth !== !guides.previousNormal) {
      throw new Error('Gi1Denoiser: give both guides.previousDepth and guides.previousNormal, or neither');
    }
    if (guides.previousDepth && isDepthFormat(guides.previousDepth.format)) {
      throw new Error('Gi1Denoiser: guides.previousDepth must be a float colour texture (r32float), not a depth format');
    }
    const d = this.device;
    const historyValid = !this.needsReset;

    // ---- constants (gi1.cpp:1819-1843, 1983-1984)
    const jitter = camera.jitter ?? [0, 0];
    // Jitter in render pixels, y down, as @pmndrs/upscaler applies it (setViewOffset moves
    // points by -x, -y pixels): an NDC offset of (-2x / W, +2y / H).
    const jitterMatrix = (j: readonly [number, number]) => translation((-2 * j[0]) / W, (2 * j[1]) / H, 0);
    const V = mat4(camera.view), Vp = mat4(camera.prevView);
    const eye = camera.position ?? eyeFromView(V);
    // Camera-relative: both frames' positions relative to this frame's eye, in double precision.
    const toEye = translation(eye[0], eye[1], eye[2]);
    const viewProj = mul64(mul64(jitterMatrix(jitter), camera.projection), mul64(V, toEye));
    const prevViewProj = mul64(mul64(jitterMatrix(this.prevJitter), camera.prevProjection), mul64(Vp, toEye));
    const invViewProj = invert(Float32Array.from(viewProj));
    const prevInvViewProj = invert(Float32Array.from(prevViewProj));
    // Linear depth from the inverse projection: view z = (m[10] d + m[14]) / (m[11] d + m[15]).
    const projInv = invert(mat4(camera.projection));
    // Capsaicin's cell_size from the vertical field of view (projection[5] = 1 / tan(fovY / 2)).
    const fovY = 2 * Math.atan(1 / camera.projection[5]);
    const cellSize = Math.tan(fovY * this.opts.probeSize * Math.max(1 / H, H / (W * W)));

    const buf = new ArrayBuffer(PARAMS_SIZE);
    const f = new Float32Array(buf), u32 = new Uint32Array(buf);
    f.set(invViewProj, 0);
    f.set(prevInvViewProj, 16);
    f[32] = projInv[10]; f[33] = projInv[14]; f[34] = projInv[11]; f[35] = projInv[15];
    u32[36] = W; u32[37] = H; f[38] = 1 / W; f[39] = 1 / H;
    // guides.motion is an NDC delta (current - previous, y up); Capsaicin's velocity is the
    // uv delta (current - previous, y down).
    f[40] = 0.5; f[41] = -0.5;
    f[42] = cellSize;
    u32[43] = (historyValid ? 1 : 0) | (this.opts.hintInAlpha ? 2 : 0) | (camera.reversedDepth ? 4 : 0);
    d.queue.writeBuffer(this.params, 0, buf);

    const cur = this.frame & 1, prev = cur ^ 1;
    const v = (t: GPUTexture) => t.createView();
    const kind = isDepthFormat(guides.depth.format) ? 'depth' : 'float';
    const depthIn = kind === 'depth' ? guides.depth.createView({ aspect: 'depth-only' }) : guides.depth.createView();
    const previousDepth = guides.previousDepth ?? this.depth[prev];
    const previousNormal = guides.previousNormal ?? this.normal[prev];
    const P = { binding: 0, resource: { buffer: this.params } };
    const bg = (layout: string, resources: GPUBindingResource[]) =>
      d.createBindGroup({ layout: this.layouts[layout], entries: [P, ...resources.map((resource, i) => ({ binding: i + 1, resource }))] });
    const groups: [number, number] = [Math.ceil(W / WORKGROUP), Math.ceil(H / WORKGROUP)];
    const run = (name: string, pipe: string, group: GPUBindGroup) => {
      const pass = enc.beginComputePass({ label: `gi1 ${name}`, timestampWrites: timer?.pass(name) });
      pass.setPipeline(this.pipes[pipe]);
      pass.setBindGroup(0, group);
      pass.dispatchWorkgroups(groups[0], groups[1]);
      pass.end();
    };

    run('prepare', `prepare_${kind}`, bg(`prepare_${kind}`, [depthIn, v(guides.normal), v(this.depth[cur]), v(this.normal[cur])]));
    run('reproject', 'reproject', bg('reproject', [
      v(inputs.radiance), v(this.depth[cur]), v(this.normal[cur]), v(guides.motion),
      v(this.color[prev]), v(previousDepth), v(previousNormal), v(this.colorDelta[prev]),
      v(this.color[cur]), v(this.colorDelta[cur]), v(this.blurMask),
    ]));
    // FilterGI twice, ping-ponging the colour buffers (gi1.cpp:2907-2925).
    run('filter_x', 'filter_x', bg('filter_x', [
      v(this.color[cur]), v(this.blurMask), v(this.depth[cur]), v(this.normal[cur]), v(this.color[prev]),
    ]));
    run('filter_y', 'filter_y', bg('filter_y', [
      v(this.color[prev]), v(this.blurMask), v(this.depth[cur]), v(this.normal[cur]), v(this.color[cur]), v(this.output),
    ]));

    this.needsReset = false;
    this.prevJitter = [jitter[0], jitter[1]];
    this.frame++;
    return this.output;
  }

  private destroyTargets() {
    for (const t of [...this.depth, ...this.normal, ...this.color, ...this.colorDelta]) t.destroy();
    this.blurMask?.destroy();
    this.output?.destroy();
    this.depth = []; this.normal = []; this.color = []; this.colorDelta = [];
    this.blurMask = this.output = undefined;
  }

  dispose(): void {
    this.destroyTargets();
    this.params.destroy();
    this.timer?.destroy();
  }
}
