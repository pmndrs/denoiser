// Public classes: named by the signal they denoise, the algorithm is an option
// (`filter`). Each conforms to TemporalDenoiser. DiffuseSpecularDenoiser runs
// both signals behind one shared prepass and returns both outputs.
import type {
  DiffuseInputs, DiffuseSpecularInputs, FrameCamera, FrameGuides, SpecularInputs,
  TemporalConfig, TemporalDenoiser,
} from '@pmndrs/denoiser-core';
import { PassTimer } from './common';
import { GuidePass } from './guides';
import {
  resolveOptions, structuralKey, SvgfPipeline, type ResolvedOptions, type SignalFrame, type SpecularSvgfOptions,
  type SvgfOptions,
} from './svgf';

/** Extra per-signal inputs understood by this package (all optional). */
export interface SignalExtras {
  /**
   * Per-pixel factor the radiance was divided by (CAPTURE-FORMAT
   * demodulation). Used only with `remodulate: true`; diffuse falls back to
   * `guides.albedo`.
   */
  demodulation?: GPUTexture;
  /**
   * A-SVGF gradient samples for `antiLag: 'gradient'`: one texel per 3x3 stratum
   * (ceil(W/3) x ceil(H/3), rgba32float or rgba16float): r = luminance of the
   * forward-projected sample shaded last frame, g = luminance of the same
   * sample re-shaded this frame with the same random numbers, b > 0 = valid.
   */
  gradient?: GPUTexture;
}

export type RealtimeDiffuseInputs = DiffuseInputs & SignalExtras;
export type RealtimeSpecularInputs = SpecularInputs & SignalExtras;
export interface RealtimeDiffuseSpecularInputs extends DiffuseSpecularInputs {
  diffuse: RealtimeDiffuseInputs;
  specular: RealtimeSpecularInputs;
}

export type DiffuseDenoiserOptions = SvgfOptions;
export type SpecularDenoiserOptions = SpecularSvgfOptions;
export interface DiffuseSpecularDenoiserOptions extends SvgfOptions {
  /** Overrides for the diffuse signal only. */
  diffuse?: SvgfOptions;
  /** Overrides for the specular signal only. */
  specular?: SpecularSvgfOptions;
}

export interface DiffuseSpecularOutputs {
  diffuse: GPUTexture;
  specular: GPUTexture;
}

function checkSize(who: string, W: number, H: number, entries: [string, GPUTexture | undefined][]) {
  for (const [k, t] of entries) {
    if (t && (t.width !== W || t.height !== H)) throw new Error(`${who}: ${k} is ${t.width}x${t.height}, configured ${W}x${H}`);
  }
}

function passCount(o: ResolvedOptions) {
  return 2 + o.atrousIterations + (o.antiLag !== 'off' ? 2 + o.gradientIterations : 0);
}

/**
 * Diffuse indirect lighting (GI) or AO. Input: 1-spp radiance, demodulated by
 * the caller (CAPTURE-FORMAT); output: the denoised signal (rgba16float), still
 * demodulated unless `remodulate` is set.
 */
export class DiffuseDenoiser implements TemporalDenoiser<RealtimeDiffuseInputs> {
  readonly name: string;
  private base: Base;
  private signal: SvgfPipeline;
  readonly options: Readonly<ResolvedOptions>;

  constructor(device: GPUDevice, options: DiffuseDenoiserOptions = {}) {
    this.options = resolveOptions(options);
    this.name = `${options.filter ?? 'svgf'}-diffuse`;
    this.base = new Base(device, this.name, this.options.timestamps, passCount(this.options) + 1);
    this.signal = new SvgfPipeline(device, [{ kind: 'diffuse', opts: this.options }], this.name);
  }

  get device() { return this.base.device; }
  get gpuTimings() { return this.base.gpuTimings; }

  configure(config: TemporalConfig): void {
    this.base.configure(config);
    this.signal.configure(config.width, config.height);
  }

  dispatch(inputs: RealtimeDiffuseInputs, guides: FrameGuides, camera: FrameCamera): GPUTexture {
    const frame: SignalFrame = { radiance: inputs.radiance, demodulation: inputs.demodulation ?? guides.albedo, gradient: inputs.gradient };
    this.base.run(this.name, guides, camera, [['radiance', inputs.radiance]], (enc, timer, gp) => {
      this.signal.encode(enc, timer, gp, [frame], guides.motion, guides.motionZ, '');
    });
    this.signal.endFrame();
    return this.signal.outputs[0]!;
  }

  resetHistory(): void { this.base.resetHistory(); }

  /** @internal Debug textures of the last frame (dev page). */
  debugTexture(name: 'accum' | 'gradient') { return this.signal.debugTexture(name); }

  dispose(): void {
    this.signal.dispose();
    this.base.dispose();
  }
}

/**
 * Specular indirect lighting (reflections). Input: 1-spp radiance demodulated
 * by the caller's pre-integrated specular term (CAPTURE-FORMAT), hit distance,
 * and `guides.roughness` (required). Surface-motion reprojection with a
 * roughness / N.V / parallax-dependent history cap and roughness-aware spatial
 * weights.
 */
export class SpecularDenoiser implements TemporalDenoiser<RealtimeSpecularInputs> {
  readonly name: string;
  private base: Base;
  private signal: SvgfPipeline;
  readonly options: Readonly<ResolvedOptions>;

  constructor(device: GPUDevice, options: SpecularDenoiserOptions = {}) {
    this.options = resolveOptions(options);
    this.name = `${options.filter ?? 'svgf'}-specular`;
    this.base = new Base(device, this.name, this.options.timestamps, passCount(this.options) + 1);
    this.signal = new SvgfPipeline(device, [{ kind: 'specular', opts: this.options }], this.name);
  }

  get device() { return this.base.device; }
  get gpuTimings() { return this.base.gpuTimings; }

  configure(config: TemporalConfig): void {
    this.base.configure(config);
    this.signal.configure(config.width, config.height);
  }

  dispatch(inputs: RealtimeSpecularInputs, guides: FrameGuides, camera: FrameCamera): GPUTexture {
    if (!guides.roughness) throw new Error(`${this.name}: guides.roughness is required`);
    const frame: SignalFrame = { radiance: inputs.radiance, demodulation: inputs.demodulation, gradient: inputs.gradient };
    this.base.run(this.name, guides, camera, [['radiance', inputs.radiance], ['hitDistance', inputs.hitDistance]], (enc, timer, gp) => {
      this.signal.encode(enc, timer, gp, [frame], guides.motion, guides.motionZ, '');
    });
    this.signal.endFrame();
    return this.signal.outputs[0]!;
  }

  resetHistory(): void { this.base.resetHistory(); }

  /** @internal Debug textures of the last frame (dev page). */
  debugTexture(name: 'accum' | 'gradient') { return this.signal.debugTexture(name); }

  dispose(): void {
    this.signal.dispose();
    this.base.dispose();
  }
}

/**
 * Diffuse + specular in one dispatch sequence with a shared guide prepass.
 * Conforms to TemporalDenoiser: `dispatch()` returns the diffuse output; use
 * `dispatchBoth()` (or `outputs` after `dispatch()`) for both textures. Each pass
 * processes both signals per thread (SPEC §4.1) unless their structural options
 * (atrousIterations, kernel, feedback, antiLag, gradientIterations) differ; then
 * they run separately and timings are prefixed `diffuse/` and `specular/`.
 */
export class DiffuseSpecularDenoiser implements TemporalDenoiser<RealtimeDiffuseSpecularInputs> {
  readonly name: string;
  private base: Base;
  /** One joint pipeline (both signals per dispatch), or two when structural options differ. */
  private pipes: SvgfPipeline[];
  readonly options: { readonly diffuse: Readonly<ResolvedOptions>; readonly specular: Readonly<ResolvedOptions> };

  constructor(device: GPUDevice, options: DiffuseSpecularDenoiserOptions = {}) {
    const { diffuse: dOpts, specular: sOpts, ...shared } = options;
    this.options = {
      diffuse: resolveOptions({ ...shared, ...dOpts }),
      specular: resolveOptions({ ...shared, ...sOpts }),
    };
    this.name = `${options.filter ?? 'svgf'}-diffuse-specular`;
    const { diffuse: od, specular: os } = this.options;
    const timestamps = od.timestamps || os.timestamps;
    const joint = structuralKey(od) === structuralKey(os);
    this.base = new Base(device, this.name, timestamps, passCount(od) + (joint ? 0 : passCount(os)) + 1);
    this.pipes = joint
      ? [new SvgfPipeline(device, [{ kind: 'diffuse', opts: od }, { kind: 'specular', opts: os }], this.name)]
      : [new SvgfPipeline(device, [{ kind: 'diffuse', opts: od }], `${this.name} diffuse`),
        new SvgfPipeline(device, [{ kind: 'specular', opts: os }], `${this.name} specular`)];
  }

  get device() { return this.base.device; }
  get gpuTimings() { return this.base.gpuTimings; }

  configure(config: TemporalConfig): void {
    this.base.configure(config);
    for (const p of this.pipes) p.configure(config.width, config.height);
  }

  /** Both outputs of the last dispatch (valid until the next dispatch / configure / dispose). */
  get outputs(): DiffuseSpecularOutputs | undefined {
    const [d, s] = this.pipes.length === 1 ? this.pipes[0].outputs : [this.pipes[0].outputs[0], this.pipes[1].outputs[0]];
    return d && s ? { diffuse: d, specular: s } : undefined;
  }

  dispatchBoth(inputs: RealtimeDiffuseSpecularInputs, guides: FrameGuides, camera: FrameCamera): DiffuseSpecularOutputs {
    if (!guides.roughness) throw new Error(`${this.name}: guides.roughness is required`);
    const { diffuse: di, specular: si } = inputs;
    const fd: SignalFrame = { radiance: di.radiance, demodulation: di.demodulation ?? guides.albedo, gradient: di.gradient };
    const fs: SignalFrame = { radiance: si.radiance, demodulation: si.demodulation, gradient: si.gradient };
    this.base.run(this.name, guides, camera, [
      ['diffuse.radiance', di.radiance], ['specular.radiance', si.radiance], ['specular.hitDistance', si.hitDistance],
    ], (enc, timer, gp) => {
      if (this.pipes.length === 1) {
        this.pipes[0].encode(enc, timer, gp, [fd, fs], guides.motion, guides.motionZ, '');
      } else {
        this.pipes[0].encode(enc, timer, gp, [fd], guides.motion, guides.motionZ, 'diffuse/');
        this.pipes[1].encode(enc, timer, gp, [fs], guides.motion, guides.motionZ, 'specular/');
      }
    });
    for (const p of this.pipes) p.endFrame();
    return this.outputs!;
  }

  /** TemporalDenoiser conformance: returns the diffuse output (see `outputs`). */
  dispatch(inputs: RealtimeDiffuseSpecularInputs, guides: FrameGuides, camera: FrameCamera): GPUTexture {
    return this.dispatchBoth(inputs, guides, camera).diffuse;
  }

  resetHistory(): void { this.base.resetHistory(); }

  dispose(): void {
    for (const p of this.pipes) p.dispose();
    this.base.dispose();
  }
}

/** Frame plumbing shared by the public classes (composition, not inheritance). */
class Base {
  readonly device: GPUDevice;
  private timer?: PassTimer;
  private gp: GuidePass;
  private width = 0;
  private height = 0;
  private needsReset = true;
  private configured = false;

  constructor(device: GPUDevice, label: string, timestamps: boolean, maxPasses: number) {
    this.device = device;
    if (timestamps && PassTimer.supported(device)) this.timer = new PassTimer(device, maxPasses);
    this.gp = new GuidePass(device, label);
  }

  get gpuTimings(): ReadonlyMap<string, number> | undefined { return this.timer?.timings; }

  configure({ width, height }: TemporalConfig) {
    if (!(width > 0 && height > 0)) throw new Error(`denoiser-realtime: bad size ${width}x${height}`);
    this.width = width;
    this.height = height;
    this.gp.configure(width, height);
    this.needsReset = true;
    this.configured = true;
  }

  resetHistory() { this.needsReset = true; }

  run(who: string, guides: FrameGuides, camera: FrameCamera, extra: [string, GPUTexture | undefined][],
    body: (enc: GPUCommandEncoder, timer: PassTimer | undefined, gp: GuidePass) => void) {
    if (!this.configured) throw new Error(`${who}: call configure() before dispatch()`);
    checkSize(who, this.width, this.height, [
      ['depth', guides.depth], ['normal', guides.normal], ['motion', guides.motion],
      ['viewZ', guides.viewZ], ['motionZ', guides.motionZ], ['roughness', guides.roughness], ...extra,
    ]);
    const enc = this.device.createCommandEncoder({ label: who });
    this.timer?.begin();
    this.gp.encode(enc, this.timer, guides, camera, this.needsReset);
    body(enc, this.timer, this.gp);
    const after = this.timer?.end(enc);
    this.device.queue.submit([enc.finish()]);
    after?.();
    this.gp.endFrame();
    this.needsReset = false;
  }

  dispose() {
    this.gp.dispose();
    this.timer?.destroy();
  }
}
