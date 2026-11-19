// Gi1Denoiser — WebGPU host for the WGSL port of AMD GI-1.0's image-space GI denoiser,
// as AMD Capsaicin v1.3 (914b915) dispatches it in GI1::render
// (src/core/src/render_techniques/gi1/gi1.cpp:2881-2926; resources in
// GI1::GIDenoiser::ensureMemoryIsAllocated, gi1.cpp:1193-1228)
// (Copyright (c) 2025 Advanced Micro Devices, Inc., MIT — see NOTICE):
//
//   ReprojectGI    noisy irradiance + reprojected history -> colour[cur] (running sum, count
//                  in w), short history[cur], colour delta + blur mask[cur]
//   FilterGI (x)   colour[cur] -> colour[prev]   disocclusion blur, horizontal
//   FilterGI (y)   colour[prev] -> colour[cur]   vertical; also writes the output
//   keep           this frame's depth and signed normal for the next frame, only when the
//                  caller doesn't hand its own (replaces Capsaicin's shared
//                  PrevVisibilityDepth / PrevShadingNormal)
//
// colour[cur] (the filtered sum) is next frame's history, as Capsaicin's buffer index swap
// makes it (gi1.cpp:3102).
//
// Memory: 48 bytes a pixel (colour and short history, 2 x rgba16float each; delta + mask,
// 2 x r32uint; output rgba16float), plus 12 when the denoiser keeps its own previous depth
// and normal.
import type {
  DiffuseInputs, FrameCamera, FrameGuides, TemporalConfig, TemporalDenoiser,
} from '@pmndrs/denoiser-core';
import { eyeFromView, invert, isDepthFormat, mat4, PassTimer, type M4 } from './common';
import { GI1_MAX_CHANGE_BOXES, gi1FilterWgsl, gi1KeepWgsl, gi1ReprojectWgsl } from './shaders/gi1';

/** A world-space axis-aligned box. */
export interface Gi1Box {
  min: readonly [number, number, number];
  max: readonly [number, number, number];
}

/** `DiffuseInputs`, plus where the scene changed this frame. */
export interface Gi1Inputs extends DiffuseInputs {
  /**
   * Port addition: world-space boxes where the scene changed since the last frame (a moved
   * object's old and new bounds, a light's reach), or `'everything'` (the sun, the sky).
   * With `changeReset`, pixels whose surface lies inside one keep a short history (at most 3
   * samples, then Capsaicin's 4-sample cap) for `changeFrames` frames, so the GI follows the
   * change while staying denoised. Up to 16 boxes over those frames; more count as
   * everything. Omit when nothing changed. Only `resetHistory()` drops the history.
   */
  changedRegions?: readonly Gi1Box[] | 'everything';
}

export interface Gi1DenoiserOptions {
  /**
   * Port addition: `'neighbourhood'` keeps a short history (about 4 samples) and its luminance
   * moments beside Capsaicin's, and clips the long history's mean to the short mean ±
   * `historyClip` × max(spatial, temporal) standard deviation in YCoCg (the spatial one over a
   * (2 `historyClipRadius` + 1)² window of the input). A change of lighting is then followed
   * within a few frames; the temporal deviation keeps it from clipping to noise that is
   * smooth in space (probe-interpolated GI). `'none'` is Capsaicin's history, which takes
   * 45-160 frames to follow a step change. Default `'neighbourhood'`.
   */
  historyClamp?: 'neighbourhood' | 'none';
  /** The clip box's half width in standard deviations. Default 2.5. */
  historyClip?: number;
  /** Radius in pixels of the clip's spatial window. Default 1 (3 x 3). */
  historyClipRadius?: number;
  /** Port addition: the soft history reset in `Gi1Inputs.changedRegions`. Default true. */
  changeReset?: boolean;
  /** Frames a reported change keeps its region's history short. Default 8. */
  changeFrames?: number;
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
  /**
   * How `guides.normal` is stored: `'signed'` (FrameGuides' contract, [-1, 1]) or `'unorm'`
   * (0..1, decoded as 2n - 1, as Capsaicin decodes its own). Zero means nothing drawn
   * either way. `guides.previousNormal` is always signed. Default `'signed'`.
   */
  normalEncoding?: 'signed' | 'unorm';
  /** Per-pass GPU timestamps into `gpuTimings` when the device supports them (dispatch only). Default true. */
  timestamps?: boolean;
}

const PARAMS_SIZE = 768; // 192 bytes of constants + 16 boxes x 2 vec4f
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

export class Gi1Denoiser implements TemporalDenoiser<Gi1Inputs> {
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
  /** Changed regions still within `changeFrames`, with the frame they were reported. */
  private recentChanges: { box: Gi1Box; frame: number }[] = [];
  /** A global change keeps every pixel's history short until this frame (inclusive). */
  private everythingChangedUntil = -1;
  /** Whether the previous frame's depth / normal came from the denoiser's own copies. */
  private usedOwnCopies: boolean | null = null;

  private params: GPUBuffer;
  private layouts: Record<string, GPUBindGroupLayout> = {};
  private pipes: Record<string, GPUComputePipeline> = {};

  private color: GPUTexture[] = [];
  private shortHistory: GPUTexture[] = [];
  private deltaMask: GPUTexture[] = [];
  private keptDepth?: GPUTexture;
  private keptNormal?: GPUTexture;
  private output?: GPUTexture;

  constructor(device: GPUDevice, options: Gi1DenoiserOptions = {}) {
    this.device = device;
    this.opts = {
      probeSize: options.probeSize ?? 8,
      hintInAlpha: options.hintInAlpha ?? false,
      normalEncoding: options.normalEncoding ?? 'signed',
      timestamps: options.timestamps ?? true,
      historyClamp: options.historyClamp ?? 'neighbourhood',
      historyClip: options.historyClip ?? 2.5,
      historyClipRadius: options.historyClipRadius ?? 1,
      changeReset: options.changeReset ?? true,
      changeFrames: options.changeFrames ?? 8,
    };
    if (this.opts.timestamps && PassTimer.supported(device)) this.timer = new PassTimer(device);
    this.params = device.createBuffer({ label: 'gi1 params', size: PARAMS_SIZE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.createPipelines();
  }

  get gpuTimings(): ReadonlyMap<string, number> | undefined { return this.timer?.timings; }

  // The options below can change between frames.
  set historyClamp(value: 'neighbourhood' | 'none') { this.opts.historyClamp = value; }
  get historyClamp(): 'neighbourhood' | 'none' { return this.opts.historyClamp; }
  set historyClip(value: number) { this.opts.historyClip = value; }
  get historyClip(): number { return this.opts.historyClip; }
  set historyClipRadius(value: number) { this.opts.historyClipRadius = value; }
  get historyClipRadius(): number { return this.opts.historyClipRadius; }
  set changeReset(value: boolean) { this.opts.changeReset = value; }
  get changeReset(): boolean { return this.opts.changeReset; }
  set changeFrames(value: number) { this.opts.changeFrames = value; }
  get changeFrames(): number { return this.opts.changeFrames; }
  set normalEncoding(value: 'signed' | 'unorm') { this.opts.normalEncoding = value; }
  get normalEncoding(): 'signed' | 'unorm' { return this.opts.normalEncoding; }
  set hintInAlpha(value: boolean) { this.opts.hintInAlpha = value; }
  get hintInAlpha(): boolean { return this.opts.hintInAlpha; }

  /**
   * The latest frame's colour delta and blur mask (r32uint: pack2x16float(delta, mask), the
   * mask being the snorm8 values Capsaicin's R8_SNORM holds: blur radius / 8, -1/8 on the sky).
   * Internal; exposed for tests and debug views.
   */
  get debugDeltaMask(): GPUTexture | undefined { return this.deltaMask[(this.frame - 1) & 1]; }

  /** GPU bytes held now (the previous depth / normal copies only once the denoiser keeps its own). */
  get memoryBytes(): number {
    const textures = [...this.color, ...this.shortHistory, ...this.deltaMask, this.keptDepth, this.keptNormal, this.output];
    const bytesPerPixel: Partial<Record<GPUTextureFormat, number>> = { rgba16float: 8, r32uint: 4, r32float: 4 };
    return textures.reduce((sum, t) => sum + (t ? t.width * t.height * (bytesPerPixel[t.format] ?? 0) : 0), 0);
  }

  private createPipelines() {
    const d = this.device;
    const C = GPUShaderStage.COMPUTE;
    const uni: GPUBindGroupLayoutEntry = { binding: 0, visibility: C, buffer: { type: 'uniform' } };
    const tex = (binding: number, sampleType: GPUTextureSampleType = 'unfilterable-float'): GPUBindGroupLayoutEntry =>
      ({ binding, visibility: C, texture: { sampleType } });
    const sto = (binding: number, format: GPUTextureFormat): GPUBindGroupLayoutEntry =>
      ({ binding, visibility: C, storageTexture: { access: 'write-only', format } });
    const make = (name: string, code: string, layout: GPUBindGroupLayout) => {
      this.pipes[name] = d.createComputePipeline({
        label: `gi1 ${name}`,
        layout: d.createPipelineLayout({ bindGroupLayouts: [layout] }),
        compute: { module: d.createShaderModule({ label: `gi1 ${name}`, code }), entryPoint: 'main' },
      });
    };
    for (const kind of ['depth', 'float'] as const) {
      const isDepth = kind === 'depth';
      const depth = (binding: number) => tex(binding, isDepth ? 'depth' : 'unfilterable-float');
      const layout = (name: string, entries: GPUBindGroupLayoutEntry[]) => {
        const l = d.createBindGroupLayout({ label: `gi1 ${name} (${kind})`, entries: [uni, ...entries] });
        this.layouts[`${name}_${kind}`] = l;
        return l;
      };
      make(`reproject_${kind}`, gi1ReprojectWgsl(isDepth), layout('reproject', [
        tex(1), depth(2), tex(3), tex(4), tex(5), tex(6), tex(7), tex(8, 'uint'), tex(9),
        sto(10, 'rgba16float'), sto(11, 'rgba16float'), sto(12, 'r32uint'),
      ]));
      make(`filter_x_${kind}`, gi1FilterWgsl(false, isDepth), layout('filter_x', [
        tex(1), tex(2, 'uint'), depth(3), tex(4), sto(5, 'rgba16float'),
      ]));
      make(`filter_y_${kind}`, gi1FilterWgsl(true, isDepth), layout('filter_y', [
        tex(1), tex(2, 'uint'), depth(3), tex(4), sto(5, 'rgba16float'), sto(6, 'rgba16float'),
      ]));
      make(`keep_${kind}`, gi1KeepWgsl(isDepth), layout('keep', [depth(1), tex(2), sto(3, 'r32float'), sto(4, 'rgba16float')]));
    }
  }

  configure({ width, height }: TemporalConfig): void {
    this.destroyTargets();
    this.width = width;
    this.height = height;
    const d = this.device;
    const tex = (label: string, format: GPUTextureFormat, extra = 0) =>
      d.createTexture({ label: `gi1 ${label}`, size: [width, height], format, usage: storageTex() | extra });
    // Capsaicin: RGBA16F colour (stored rounded to nearest here, see shaders/gi1.ts).
    this.color = [tex('color0', 'rgba16float'), tex('color1', 'rgba16float')];
    // Port addition (historyClamp): the short history, rgb mean and luminance² mean.
    this.shortHistory = [tex('short0', 'rgba16float'), tex('short1', 'rgba16float')];
    // Capsaicin: R16F delta and R8_SNORM blur mask; two halves of one r32uint here.
    const copySrc = GPUTextureUsage.COPY_SRC;
    this.deltaMask = [tex('deltaMask0', 'r32uint', copySrc), tex('deltaMask1', 'r32uint', copySrc)];
    // GI_IrradianceBuffer: RGBA16F (gi1.cpp:1707), filterable, as consumers sample it.
    this.output = tex('output', 'rgba16float', copySrc);
    this.needsReset = true;
    this.frame = 0;
    this.usedOwnCopies = null;
  }

  /** Drops all history at the next frame (a cut). Scene changes use `changedRegions` instead. */
  resetHistory(): void {
    this.needsReset = true;
    this.recentChanges = [];
    this.everythingChangedUntil = -1;
  }

  dispatch(inputs: Gi1Inputs, guides: FrameGuides, camera: FrameCamera): GPUTexture {
    const enc = this.device.createCommandEncoder({ label: 'gi1' });
    this.timer?.begin();
    const output = this.record(enc, inputs, guides, camera, this.timer);
    const after = this.timer?.end(enc);
    this.device.queue.submit([enc.finish()]);
    after?.();
    return output;
  }

  /**
   * One frame recorded into the caller's encoder (see TemporalDenoiser.encode). The frame's
   * constants go to one uniform buffer through `queue.writeBuffer`, so encode one frame per
   * instance before each submit: a second `encode` on the same instance before the submit
   * overwrites the first one's constants.
   */
  encode(encoder: GPUCommandEncoder, inputs: Gi1Inputs, guides: FrameGuides, camera: FrameCamera): GPUTexture {
    return this.record(encoder, inputs, guides, camera, undefined);
  }

  /** This frame's soft-reset regions: the boxes reported in the last `changeFrames` frames, or everything. */
  private changesFor(regions: Gi1Inputs['changedRegions']): { everything: boolean; boxes: Gi1Box[] } {
    const frame = this.frame;
    const keep = Math.max(1, Math.round(this.opts.changeFrames));
    if (!this.opts.changeReset) {
      this.recentChanges = [];
      this.everythingChangedUntil = -1;
      return { everything: false, boxes: [] };
    }
    if (regions === 'everything') this.everythingChangedUntil = frame + keep - 1;
    else if (regions) for (const box of regions) this.recentChanges.push({ box, frame });
    this.recentChanges = this.recentChanges.filter((change) => change.frame > frame - keep);
    const everything = frame <= this.everythingChangedUntil || this.recentChanges.length > GI1_MAX_CHANGE_BOXES;
    return { everything, boxes: everything ? [] : this.recentChanges.map((change) => change.box) };
  }

  private record(enc: GPUCommandEncoder, inputs: Gi1Inputs, guides: FrameGuides, camera: FrameCamera, timer: PassTimer | undefined): GPUTexture {
    if (!this.output) throw new Error('Gi1Denoiser: call configure() before dispatch()');
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
    const ownCopies = !guides.previousDepth;
    if (ownCopies && !this.keptDepth) {
      const tex = (label: string, format: GPUTextureFormat) =>
        d.createTexture({ label: `gi1 ${label}`, size: [W, H], format, usage: storageTex() });
      this.keptDepth = tex('previous depth', 'r32float');
      this.keptNormal = tex('previous normal', 'rgba16float');
    }
    // Switching to our own copies: they don't hold the last frame.
    if (ownCopies && this.usedOwnCopies === false) this.needsReset = true;
    const changes = this.changesFor(inputs.changedRegions);
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
    u32[43] = (historyValid ? 1 : 0) | (this.opts.hintInAlpha ? 2 : 0) | (camera.reversedDepth ? 4 : 0)
      | (this.opts.normalEncoding === 'unorm' ? 8 : 0) | (changes.everything ? 16 : 0);
    f[44] = this.opts.historyClamp === 'neighbourhood' ? this.opts.historyClip : 0;
    new Int32Array(buf)[45] = Math.max(0, Math.round(this.opts.historyClipRadius));
    u32[46] = changes.boxes.length;
    changes.boxes.forEach((box, i) => {
      // Relative to the current eye, as the shader's positions are.
      f.set([box.min[0] - eye[0], box.min[1] - eye[1], box.min[2] - eye[2], 0], 48 + i * 8);
      f.set([box.max[0] - eye[0], box.max[1] - eye[1], box.max[2] - eye[2], 0], 52 + i * 8);
    });
    d.queue.writeBuffer(this.params, 0, buf);

    const cur = this.frame & 1, prev = cur ^ 1;
    const v = (t: GPUTexture) => t.createView();
    const kind = isDepthFormat(guides.depth.format) ? 'depth' : 'float';
    const depthIn = kind === 'depth' ? guides.depth.createView({ aspect: 'depth-only' }) : guides.depth.createView();
    const previousDepth = guides.previousDepth ?? this.keptDepth!;
    const previousNormal = guides.previousNormal ?? this.keptNormal!;
    const P = { binding: 0, resource: { buffer: this.params } };
    const bg = (layout: string, resources: GPUBindingResource[]) =>
      d.createBindGroup({ layout: this.layouts[`${layout}_${kind}`], entries: [P, ...resources.map((resource, i) => ({ binding: i + 1, resource }))] });
    const groups: [number, number] = [Math.ceil(W / WORKGROUP), Math.ceil(H / WORKGROUP)];
    const run = (name: string, group: GPUBindGroup) => {
      const pass = enc.beginComputePass({ label: `gi1 ${name}`, timestampWrites: timer?.pass(name) });
      pass.setPipeline(this.pipes[`${name}_${kind}`]);
      pass.setBindGroup(0, group);
      pass.dispatchWorkgroups(groups[0], groups[1]);
      pass.end();
    };

    run('reproject', bg('reproject', [
      v(inputs.radiance), depthIn, v(guides.normal), v(guides.motion),
      v(this.color[prev]), v(previousDepth), v(previousNormal), v(this.deltaMask[prev]), v(this.shortHistory[prev]),
      v(this.color[cur]), v(this.shortHistory[cur]), v(this.deltaMask[cur]),
    ]));
    // FilterGI twice, ping-ponging the colour buffers (gi1.cpp:2907-2925).
    run('filter_x', bg('filter_x', [v(this.color[cur]), v(this.deltaMask[cur]), depthIn, v(guides.normal), v(this.color[prev])]));
    run('filter_y', bg('filter_y', [
      v(this.color[prev]), v(this.deltaMask[cur]), depthIn, v(guides.normal), v(this.color[cur]), v(this.output),
    ]));
    // After the frame's last read of the previous copies.
    if (ownCopies) run('keep', bg('keep', [depthIn, v(guides.normal), v(this.keptDepth!), v(this.keptNormal!)]));

    this.needsReset = false;
    this.usedOwnCopies = ownCopies;
    this.prevJitter = [jitter[0], jitter[1]];
    this.frame++;
    return this.output;
  }

  private destroyTargets() {
    for (const t of [...this.color, ...this.shortHistory, ...this.deltaMask]) t.destroy();
    this.keptDepth?.destroy();
    this.keptNormal?.destroy();
    this.output?.destroy();
    this.color = []; this.shortHistory = []; this.deltaMask = [];
    this.keptDepth = this.keptNormal = this.output = undefined;
  }

  dispose(): void {
    this.destroyTargets();
    this.params.destroy();
    this.timer?.destroy();
  }
}
