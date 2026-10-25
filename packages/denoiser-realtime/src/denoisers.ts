// Public classes: named by the signal they denoise, the algorithm is an option
// (`filter: 'svgf' | 'recurrent'`). Each conforms to TemporalDenoiser.
// DiffuseSpecularDenoiser runs both signals behind one shared prepass and
// returns both outputs.
import type {
  DiffuseInputs, DiffuseSpecularInputs, FrameCamera, FrameGuides, SpecularInputs,
  TemporalConfig, TemporalDenoiser,
} from '@pmndrs/denoiser-core';
import { PassTimer } from './common';
import { GuidePass } from './guides';
import {
  RECURRENT_PASSES, RecurrentPipeline, recurrentStructuralKey, resolveRecurrent, type RecurrentOptions,
  type ResolvedRecurrent,
} from './recurrent';
import {
  resolveOptions, structuralKey, SvgfPipeline, type ResolvedOptions, type SpecularSvgfOptions, type SvgfOptions,
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
   * A-SVGF gradient samples for `antiLag: 'gradient'` (svgf only): one texel per 3x3 stratum
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

/** `filter: 'svgf'` (default) or `filter: 'recurrent'` (provisional, SPEC v0 §5). */
export type DiffuseDenoiserOptions = SvgfOptions | RecurrentOptions;
export type SpecularDenoiserOptions = SpecularSvgfOptions | RecurrentOptions;
export type DiffuseSpecularDenoiserOptions = (SpecularSvgfOptions | RecurrentOptions) & {
  /** Overrides for the diffuse signal only (may switch its filter). */
  diffuse?: SvgfOptions | Partial<RecurrentOptions>;
  /** Overrides for the specular signal only (may switch its filter). */
  specular?: SpecularSvgfOptions | Partial<RecurrentOptions>;
};

export interface DiffuseSpecularOutputs {
  diffuse: GPUTexture;
  specular: GPUTexture;
}

/** Resolved options of one signal. */
export type SignalOptions = Readonly<ResolvedOptions> | Readonly<ResolvedRecurrent>;

type Resolved = { filter: 'svgf'; o: ResolvedOptions } | { filter: 'recurrent'; o: ResolvedRecurrent };
type Kind = 'diffuse' | 'specular';

function resolve(o: Partial<SpecularSvgfOptions> | Partial<RecurrentOptions>): Resolved {
  const { filter, ...rest } = o as { filter?: string };
  if (filter === 'recurrent' && (rest as { payload?: string }).payload && (rest as { payload?: string }).payload !== 'radiance') {
    throw new Error(`denoiser-realtime: payload '${(rest as { payload?: string }).payload}' needs filter 'svgf' (recurrent SH is not built, SPEC §8.5.6)`);
  }
  if (filter === 'recurrent') return { filter, o: resolveRecurrent(rest as Partial<RecurrentOptions>) };
  if (filter && filter !== 'svgf') throw new Error(`denoiser-realtime: unknown filter '${filter}'`);
  return { filter: 'svgf', o: resolveOptions(rest as SpecularSvgfOptions) };
}

function checkSize(who: string, W: number, H: number, entries: [string, GPUTexture | undefined][]) {
  for (const [k, t] of entries) {
    if (t && (t.width !== W || t.height !== H)) throw new Error(`${who}: ${k} is ${t.width}x${t.height}, configured ${W}x${H}`);
  }
}

/** Per-frame inputs of one signal, whatever the filter. */
interface InputFrame {
  radiance: GPUTexture;
  hitDistance?: GPUTexture;
  demodulation?: GPUTexture;
  gradient?: GPUTexture;
  direction?: GPUTexture;
  sh?: GPUTexture;
}

/** One pipeline (one filter, one or two signals) behind a common surface. */
interface Pipe {
  readonly passes: number;
  readonly outputs: (GPUTexture | undefined)[];
  configure(w: number, h: number): void;
  encode(enc: GPUCommandEncoder, timer: PassTimer | undefined, gp: GuidePass, frames: InputFrame[],
    guides: FrameGuides, camera: FrameCamera, prefix: string): void;
  endFrame(): void;
  debugTexture(name: string): GPUTexture | undefined;
  dispose(): void;
}

function makePipe(device: GPUDevice, signals: { kind: Kind; r: Resolved }[], label: string): Pipe {
  if (signals[0].r.filter === 'recurrent') {
    const p = new RecurrentPipeline(device, signals.map((s) => ({ kind: s.kind, opts: s.r.o as ResolvedRecurrent })), label);
    return {
      passes: RECURRENT_PASSES.length,
      get outputs() { return p.outputs; },
      configure: (w, h) => p.configure(w, h),
      encode: (enc, timer, gp, frames, guides, camera, prefix) =>
        p.encode(enc, timer, gp, frames, guides.motion, guides.motionZ, camera.projection, camera.prevProjection, prefix),
      endFrame: () => p.endFrame(),
      debugTexture: (n) => (n === 'data' ? p.dataTexture : p.debugTexture(n as 'acc' | 'history')),
      dispose: () => p.dispose(),
    };
  }
  const o = signals[0].r.o as ResolvedOptions;
  const p = new SvgfPipeline(device, signals.map((s) => ({ kind: s.kind, opts: s.r.o as ResolvedOptions })), label);
  return {
    passes: 2 + o.atrousIterations + (o.antiLag !== 'off' ? 2 + o.gradientIterations : 0),
    get outputs() { return p.outputs; },
    configure: (w, h) => p.configure(w, h),
    encode: (enc, timer, gp, frames, guides, _camera, prefix) => p.encode(enc, timer, gp, frames, guides.motion, guides.motionZ, prefix,
      { normal: guides.normal, detailNormal: guides.detailNormal }),
    endFrame: () => p.endFrame(),
    debugTexture: (n) => p.debugTexture(n as 'accum' | 'gradient'),
    dispose: () => p.dispose(),
  };
}

const key = (r: Resolved) => (r.filter === 'recurrent' ? recurrentStructuralKey(r.o) : `svgf|${structuralKey(r.o)}`);
const filterName = (r: Resolved) => r.filter;

/** Single-signal denoiser body shared by DiffuseDenoiser and SpecularDenoiser. */
class Single {
  readonly base: Base;
  readonly pipe: Pipe;
  readonly r: Resolved;
  constructor(device: GPUDevice, kind: Kind, options: Partial<SpecularSvgfOptions> | Partial<RecurrentOptions>, readonly name: string) {
    this.r = resolve(options);
    this.base = new Base(device, name, this.r.o.timestamps, 0, this.r.filter !== 'recurrent');
    this.pipe = makePipe(device, [{ kind, r: this.r }], name);
    this.base.setTimer(this.r.o.timestamps, this.pipe.passes + 1);
  }
}

/**
 * Diffuse indirect lighting (GI) or AO. Input: 1-spp radiance, demodulated by
 * the caller (CAPTURE-FORMAT), optional hit distance (used by `recurrent`);
 * output: the denoised signal (rgba16float), still demodulated unless
 * `remodulate` is set. With `filter: 'recurrent'` the output alpha is the
 * denoised normalized hit distance (an AO estimate, SPEC O-1).
 */
export class DiffuseDenoiser implements TemporalDenoiser<RealtimeDiffuseInputs> {
  readonly name: string;
  readonly options: SignalOptions;
  private s: Single;

  constructor(device: GPUDevice, options: DiffuseDenoiserOptions = {}) {
    this.name = `${options.filter ?? 'svgf'}-diffuse`;
    this.s = new Single(device, 'diffuse', options, this.name);
    this.options = this.s.r.o;
  }

  get device() { return this.s.base.device; }
  get gpuTimings() { return this.s.base.gpuTimings; }

  configure(config: TemporalConfig): void {
    this.s.base.configure(config);
    this.s.pipe.configure(config.width, config.height);
  }

  dispatch(inputs: RealtimeDiffuseInputs, guides: FrameGuides, camera: FrameCamera): GPUTexture {
    const frame: InputFrame = {
      radiance: inputs.radiance, hitDistance: inputs.hitDistance, demodulation: inputs.demodulation ?? guides.albedo, gradient: inputs.gradient,
      direction: inputs.direction, sh: inputs.sh,
    };
    this.s.base.run(this.name, guides, camera, [['radiance', inputs.radiance], ['hitDistance', inputs.hitDistance],
      ['albedo', guides.albedo], ['demodulation', inputs.demodulation], ['direction', inputs.direction], ['sh', inputs.sh]], (enc, timer, gp) => {
      this.s.pipe.encode(enc, timer, gp, [frame], guides, camera, '');
    });
    this.s.pipe.endFrame();
    return this.s.pipe.outputs[0]!;
  }

  resetHistory(): void { this.s.base.resetHistory(); }

  /**
   * @internal Debug textures of the last frame (dev page): svgf 'accum' | 'gradient';
   * recurrent 'acc' | 'history' | 'data'.
   */
  debugTexture(name: string) { return this.s.pipe.debugTexture(name); }

  dispose(): void {
    this.s.pipe.dispose();
    this.s.base.dispose();
  }
}

/**
 * Specular indirect lighting (reflections). Input: 1-spp radiance demodulated
 * by the caller's pre-integrated specular term (CAPTURE-FORMAT), hit distance,
 * and `guides.roughness` (required). Surface-motion reprojection with a
 * roughness / N.V / parallax-dependent history cap and roughness-aware spatial
 * weights. `filter: 'recurrent'` (provisional) adds virtual-motion reprojection
 * blended with surface motion (SPEC R-9..R-12).
 */
export class SpecularDenoiser implements TemporalDenoiser<RealtimeSpecularInputs> {
  readonly name: string;
  readonly options: SignalOptions;
  private s: Single;

  constructor(device: GPUDevice, options: SpecularDenoiserOptions = {}) {
    this.name = `${options.filter ?? 'svgf'}-specular`;
    this.s = new Single(device, 'specular', options, this.name);
    this.options = this.s.r.o;
  }

  get device() { return this.s.base.device; }
  get gpuTimings() { return this.s.base.gpuTimings; }

  configure(config: TemporalConfig): void {
    this.s.base.configure(config);
    this.s.pipe.configure(config.width, config.height);
  }

  dispatch(inputs: RealtimeSpecularInputs, guides: FrameGuides, camera: FrameCamera): GPUTexture {
    if (!guides.roughness) throw new Error(`${this.name}: guides.roughness is required`);
    const frame: InputFrame = {
      radiance: inputs.radiance, hitDistance: inputs.hitDistance, demodulation: inputs.demodulation, gradient: inputs.gradient,
      direction: inputs.direction, sh: inputs.sh,
    };
    this.s.base.run(this.name, guides, camera, [['radiance', inputs.radiance], ['hitDistance', inputs.hitDistance], ['demodulation', inputs.demodulation],
      ['direction', inputs.direction], ['sh', inputs.sh]], (enc, timer, gp) => {
      this.s.pipe.encode(enc, timer, gp, [frame], guides, camera, '');
    });
    this.s.pipe.endFrame();
    return this.s.pipe.outputs[0]!;
  }

  resetHistory(): void { this.s.base.resetHistory(); }

  /** @internal Debug textures of the last frame (dev page), see DiffuseDenoiser. */
  debugTexture(name: string) { return this.s.pipe.debugTexture(name); }

  dispose(): void {
    this.s.pipe.dispose();
    this.s.base.dispose();
  }
}

/**
 * Diffuse + specular in one dispatch sequence with a shared guide prepass.
 * Conforms to TemporalDenoiser: `dispatch()` returns the diffuse output; use
 * `dispatchBoth()` (or `outputs` after `dispatch()`) for both textures. Each pass
 * processes both signals per thread (SPEC §4.1, §5.1) unless their filters or
 * structural options differ; then they run separately and timings are prefixed
 * `diffuse/` and `specular/`. `{ filter: 'recurrent' }` currently means recurrent
 * diffuse + SVGF (antiLag 'auto') specular (provisional; recurrent specular measured
 * below A-SVGF on 6/7 test-bed paths, results/M2-M3.md); add
 * `specular: { filter: 'recurrent' }` for both recurrent in shared dispatches.
 */
export class DiffuseSpecularDenoiser implements TemporalDenoiser<RealtimeDiffuseSpecularInputs> {
  readonly name: string;
  private base: Base;
  /** One joint pipeline (both signals per dispatch), or two when filters / structural options differ. */
  private pipes: Pipe[];
  readonly options: { readonly diffuse: SignalOptions; readonly specular: SignalOptions };
  /** Filter per signal. */
  readonly filters: { readonly diffuse: 'svgf' | 'recurrent'; readonly specular: 'svgf' | 'recurrent' };

  constructor(device: GPUDevice, options: DiffuseSpecularDenoiserOptions = {}) {
    const { diffuse: dOpts, specular: sOpts, ...shared } = options;
    const rd = resolve({ ...shared, ...dOpts } as Partial<SpecularSvgfOptions>);
    // `filter: 'recurrent'` denoises specular with SVGF + antiLag 'auto' (measured best on
    // the test bed, results/M2-M3.md; the default is Dennis's call, SPEC §12); pass
    // `specular: { filter: 'recurrent' }` for recurrent specular in shared dispatches.
    const recurrentShared = shared.filter === 'recurrent' && !sOpts?.filter;
    const rs = resolve((recurrentShared
      ? { filter: 'svgf', antiLag: 'auto', remodulate: shared.remodulate, timestamps: shared.timestamps, ...sOpts }
      : { ...shared, ...sOpts }) as Partial<SpecularSvgfOptions>);
    this.options = { diffuse: rd.o, specular: rs.o };
    this.filters = { diffuse: filterName(rd), specular: filterName(rs) };
    this.name = rd.filter === rs.filter ? `${rd.filter}-diffuse-specular` : `${rd.filter}+${rs.filter}-diffuse-specular`;
    const timestamps = rd.o.timestamps || rs.o.timestamps;
    const joint = key(rd) === key(rs);
    this.base = new Base(device, this.name, timestamps, 0, rd.filter !== 'recurrent' || rs.filter !== 'recurrent');
    this.pipes = joint
      ? [makePipe(device, [{ kind: 'diffuse', r: rd }, { kind: 'specular', r: rs }], this.name)]
      : [makePipe(device, [{ kind: 'diffuse', r: rd }], `${this.name} diffuse`),
        makePipe(device, [{ kind: 'specular', r: rs }], `${this.name} specular`)];
    this.base.setTimer(timestamps, this.pipes.reduce((n, p) => n + p.passes, 0) + 1);
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
    const fd: InputFrame = {
      radiance: di.radiance, hitDistance: di.hitDistance, demodulation: di.demodulation ?? guides.albedo, gradient: di.gradient, direction: di.direction, sh: di.sh,
    };
    const fs: InputFrame = {
      radiance: si.radiance, hitDistance: si.hitDistance, demodulation: si.demodulation, gradient: si.gradient, direction: si.direction, sh: si.sh,
    };
    this.base.run(this.name, guides, camera, [
      ['diffuse.radiance', di.radiance], ['diffuse.hitDistance', di.hitDistance], ['specular.radiance', si.radiance],
      ['specular.hitDistance', si.hitDistance], ['albedo', guides.albedo], ['diffuse.demodulation', di.demodulation],
      ['specular.demodulation', si.demodulation], ['diffuse.direction', di.direction], ['specular.direction', si.direction],
      ['diffuse.sh', di.sh], ['specular.sh', si.sh],
    ], (enc, timer, gp) => {
      if (this.pipes.length === 1) {
        this.pipes[0].encode(enc, timer, gp, [fd, fs], guides, camera, '');
      } else {
        this.pipes[0].encode(enc, timer, gp, [fd], guides, camera, 'diffuse/');
        this.pipes[1].encode(enc, timer, gp, [fs], guides, camera, 'specular/');
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

  /** `slope: false` when no SVGF pipeline reads the depth slope (recurrent only). */
  constructor(device: GPUDevice, label: string, timestamps: boolean, maxPasses: number, slope = true) {
    this.device = device;
    if (maxPasses > 0) this.setTimer(timestamps, maxPasses);
    this.gp = new GuidePass(device, label, slope);
  }

  setTimer(timestamps: boolean, maxPasses: number) {
    this.timer?.destroy();
    this.timer = timestamps && PassTimer.supported(this.device) ? new PassTimer(this.device, maxPasses) : undefined;
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
      ['viewZ', guides.viewZ], ['motionZ', guides.motionZ], ['roughness', guides.roughness], ['detailNormal', guides.detailNormal], ...extra,
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
