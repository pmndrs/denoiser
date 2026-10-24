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
  resolveOptions, SvgfSignal, type ResolvedOptions, type SignalFrame, type SpecularSvgfOptions,
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
   * A-SVGF gradient samples for `antiLag: 'input'`: one texel per 3x3 stratum
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
  return 2 + o.atrousIterations + (o.antiLag !== 'off' ? 1 + o.gradientIterations : 0);
}

/**
 * Diffuse indirect lighting (GI) or AO. Input: 1-spp radiance, demodulated by
 * the caller (CAPTURE-FORMAT); output: the denoised signal (rgba16float), still
 * demodulated unless `remodulate` is set.
 */
export class DiffuseDenoiser implements TemporalDenoiser<RealtimeDiffuseInputs> {
  readonly name: string;
  private base: Base;
  private signal: SvgfSignal;
  readonly options: Readonly<ResolvedOptions>;

  constructor(device: GPUDevice, options: DiffuseDenoiserOptions = {}) {
    this.options = resolveOptions(options);
    this.name = `${options.filter ?? 'svgf'}-diffuse`;
    this.base = new Base(device, this.name, this.options.timestamps, passCount(this.options) + 1);
    this.signal = new SvgfSignal(device, 'diffuse', this.options, this.name);
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
      this.signal.encode(enc, timer, gp, frame, guides.motion, guides.motionZ, '');
    });
    this.signal.endFrame();
    return this.signal.output!;
  }

  resetHistory(): void { this.base.resetHistory(); }

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
  private signal: SvgfSignal;
  readonly options: Readonly<ResolvedOptions>;

  constructor(device: GPUDevice, options: SpecularDenoiserOptions = {}) {
    this.options = resolveOptions(options);
    this.name = `${options.filter ?? 'svgf'}-specular`;
    this.base = new Base(device, this.name, this.options.timestamps, passCount(this.options) + 1);
    this.signal = new SvgfSignal(device, 'specular', this.options, this.name);
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
      this.signal.encode(enc, timer, gp, frame, guides.motion, guides.motionZ, '');
    });
    this.signal.endFrame();
    return this.signal.output!;
  }

  resetHistory(): void { this.base.resetHistory(); }

  dispose(): void {
    this.signal.dispose();
    this.base.dispose();
  }
}

/**
 * Diffuse + specular in one dispatch sequence with a shared guide prepass.
 * Conforms to TemporalDenoiser: `dispatch()` returns the diffuse output; use
 * `dispatchBoth()` (or `outputs` after `dispatch()`) for both textures.
 * Timings are prefixed `diffuse/` and `specular/` (plus `prepass`, `total`).
 */
export class DiffuseSpecularDenoiser implements TemporalDenoiser<RealtimeDiffuseSpecularInputs> {
  readonly name: string;
  private base: Base;
  private diffuse: SvgfSignal;
  private specular: SvgfSignal;
  readonly options: { readonly diffuse: Readonly<ResolvedOptions>; readonly specular: Readonly<ResolvedOptions> };

  constructor(device: GPUDevice, options: DiffuseSpecularDenoiserOptions = {}) {
    const { diffuse: dOpts, specular: sOpts, ...shared } = options;
    this.options = {
      diffuse: resolveOptions({ ...shared, ...dOpts }),
      specular: resolveOptions({ ...shared, ...sOpts }),
    };
    this.name = `${options.filter ?? 'svgf'}-diffuse-specular`;
    const timestamps = this.options.diffuse.timestamps || this.options.specular.timestamps;
    this.base = new Base(device, this.name, timestamps, passCount(this.options.diffuse) + passCount(this.options.specular) + 1);
    this.diffuse = new SvgfSignal(device, 'diffuse', this.options.diffuse, `${this.name} diffuse`);
    this.specular = new SvgfSignal(device, 'specular', this.options.specular, `${this.name} specular`);
  }

  get device() { return this.base.device; }
  get gpuTimings() { return this.base.gpuTimings; }

  configure(config: TemporalConfig): void {
    this.base.configure(config);
    this.diffuse.configure(config.width, config.height);
    this.specular.configure(config.width, config.height);
  }

  /** Both outputs of the last dispatch (valid until the next dispatch / configure / dispose). */
  get outputs(): DiffuseSpecularOutputs | undefined {
    const d = this.diffuse.output, s = this.specular.output;
    return d && s ? { diffuse: d, specular: s } : undefined;
  }

  dispatchBoth(inputs: RealtimeDiffuseSpecularInputs, guides: FrameGuides, camera: FrameCamera): DiffuseSpecularOutputs {
    if (!guides.roughness) throw new Error(`${this.name}: guides.roughness is required`);
    const { diffuse: di, specular: si } = inputs;
    this.base.run(this.name, guides, camera, [
      ['diffuse.radiance', di.radiance], ['specular.radiance', si.radiance], ['specular.hitDistance', si.hitDistance],
    ], (enc, timer, gp) => {
      this.diffuse.encode(enc, timer, gp, { radiance: di.radiance, demodulation: di.demodulation ?? guides.albedo, gradient: di.gradient },
        guides.motion, guides.motionZ, 'diffuse/');
      this.specular.encode(enc, timer, gp, { radiance: si.radiance, demodulation: si.demodulation, gradient: si.gradient },
        guides.motion, guides.motionZ, 'specular/');
    });
    this.diffuse.endFrame();
    this.specular.endFrame();
    return this.outputs!;
  }

  /** TemporalDenoiser conformance: returns the diffuse output (see `outputs`). */
  dispatch(inputs: RealtimeDiffuseSpecularInputs, guides: FrameGuides, camera: FrameCamera): GPUTexture {
    return this.dispatchBoth(inputs, guides, camera).diffuse;
  }

  resetHistory(): void { this.base.resetHistory(); }

  dispose(): void {
    this.diffuse.dispose();
    this.specular.dispose();
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
