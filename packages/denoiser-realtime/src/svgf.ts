// SvgfPipeline: SVGF / A-SVGF for one or two signals (resources, pipelines and
// the per-frame pass sequence). The public classes in denoisers.ts wrap it
// behind a shared GuidePass. With two signals each pass handles both.
//
//   [gradient_create, gradient_atrous_0..G-1]   (antiLag only, 1/3 resolution)
//   temporal      input + history -> accum[cur] (rgb, n), moments[cur]
//   variance      accum, moments -> ping (rgb, standard deviation)
//   atrous_0..K-1 ping <-> pong; iteration 0 also writes hist (feedback);
//                 the last writes the output (optionally remodulated)
import type { PassTimer } from './common';
import { makeBindGroup, makeLayout, makePipeline, runPass, storageTex, type Res } from './gpu';
import type { GuidePass } from './guides';
import type { PassDef } from './shaders/bindings';
import { GRADIENT_DOWNSAMPLE, gradientAtrousPass, gradientCreatePass, gradientLambdaPass } from './shaders/gradient';
import {
  atrousPass, P_ANTILAG, P_CATMULL, P_GRADIENT_INPUT, P_KERNEL_BOX3, P_REMODULATE, P_SPEC_NORMAL_POWER, P_VAR_OF_MEAN,
  PARAMS_SIZE, temporalPass, variancePass, type SignalKind,
} from './shaders/svgf';

/** SVGF / A-SVGF settings shared by every signal. All optional. */
export interface SvgfOptions {
  /** Algorithm: 'svgf' (default) here; `filter: 'recurrent'` takes RecurrentOptions instead. */
  filter?: 'svgf';
  /**
   * Minimum blend weight of the new frame (SVGF's alpha). Default 0.2 (SVGF
   * paper), 0.1 when `antiLag` is on (A-SVGF paper).
   */
  temporalAlpha?: number;
  /** Minimum blend weight for the luminance moments. Default = temporalAlpha. */
  momentsAlpha?: number;
  /** History length cap in frames, incl. the current one. Default 64 (A-SVGF code). */
  maxHistory?: number;
  /** History resampling when the 2x2 footprint is valid. Default 'bilinear' (SPEC C-8 for svgf: its history is already the smooth a-trous output; Catmull-Rom measured +0.03-0.07 dB, slightly more flicker). */
  historyFilter?: 'catmull-rom' | 'bilinear';
  /** Plane-distance disocclusion threshold, relative to camera distance. Default 0.01. */
  planeDistance?: number;
  /** Minimum cosine between current and previous normals to reuse history. Default 0.95 (A-SVGF code). */
  normalThreshold?: number;
  /** A-trous iterations (strides 1, 2, 4, ...). Default 5 (SVGF paper). */
  atrousIterations?: number;
  /** A-trous kernel: SVGF's 5x5 B3 spline or A-SVGF's 3x3 box (sec. 4: negligible loss, much cheaper; on our dev scene equal or better). Default '3x3'. */
  kernel?: '5x5' | '3x3';
  /** Feed a-trous iteration 0 back as next frame's color history (SVGF paper). Default true. */
  feedback?: boolean;
  /** Edge-stopping parameters (SVGF eq. 3-5). Defaults 1, 128, 4. */
  sigmaDepth?: number;
  sigmaNormal?: number;
  sigmaLuminance?: number;
  /**
   * Variance that drives the luminance edge-stopping weight: 'sample' (SVGF
   * paper: per-sample luminance variance from the moments) or 'mean' (our
   * variant: variance of the temporally accumulated mean, i.e. the noise that is
   * actually left in what the a-trous filters; sharper edges). Default 'sample'.
   */
  luminanceVariance?: 'sample' | 'mean';
  /** Frames over which variance ramps from the spatial to the temporal estimate. Default 4. */
  varianceRampFrames?: number;
  /** Spatial variance boost for young history: x (1 + boost (1 - n / rampFrames)). Default 3 (A-SVGF code). */
  spatialVarianceBoost?: number;
  /**
   * A-SVGF anti-lag (gradient-driven alpha). 'auto' estimates the temporal
   * gradient from the signal itself; 'gradient' uses renderer-supplied gradient
   * samples (`inputs.gradient`, see README). Default 'off'.
   */
  antiLag?: 'off' | 'auto' | 'gradient';
  /** 'auto' anti-lag: gradient noise floor in standard deviations. Default 2. */
  antiLagNoiseFloor?: number;
  /** Anti-lag: neighbourhood (in strata) for the max over lambda. Default 1 (3x3, A-SVGF). */
  antiLagRadius?: number;
  /** Anti-lag: a-trous iterations of the gradient reconstruction. Default 5 (A-SVGF). */
  gradientIterations?: number;
  /**
   * Multiply the result by the demodulation factor (`inputs.demodulation`, or
   * `guides.albedo` for diffuse). Default false: output stays demodulated,
   * like the input (CAPTURE-FORMAT).
   */
  remodulate?: boolean;
  /** Per-pass GPU timestamps into `gpuTimings` when supported. Default true. */
  timestamps?: boolean;
}

/** Specular-only settings. */
export interface SpecularSvgfOptions extends SvgfOptions {
  /**
   * Surface-motion history cap for specular (SPEC R-8, our design):
   * A_spec = scale * theta_L(alpha) * NoV^curve / parallax. Defaults 1 and 0.5.
   */
  specularHistoryScale?: number;
  specularHistoryCurve?: number;
  /** Energy fraction E defining the GGX lobe half-angle theta_L (SPEC R-1). Default 0.75. */
  lobeFraction?: number;
  /**
   * Specular normal edge-stop: 'lobe' (reject beyond the GGX lobe half-angle,
   * roughness-aware) or 'power' (SVGF's max(0, n.n')^sigmaNormal). Default 'lobe'.
   */
  specularNormalWeight?: 'lobe' | 'power';
  /** Scales the roughness-dependent kernel radius (RTG ch. 32 eq. 15); 0 disables it. Default 1. */
  radiusScale?: number;
}

export type ResolvedOptions = Required<Omit<SpecularSvgfOptions, 'filter'>>;

export function resolveOptions(o: SpecularSvgfOptions = {}): ResolvedOptions {
  if (o.filter && o.filter !== 'svgf') throw new Error(`denoiser-realtime: unknown filter '${o.filter}'`);
  const antiLag = o.antiLag ?? 'off';
  const temporalAlpha = o.temporalAlpha ?? (antiLag === 'off' ? 0.2 : 0.1);
  return {
    temporalAlpha,
    momentsAlpha: o.momentsAlpha ?? temporalAlpha,
    maxHistory: o.maxHistory ?? 64,
    historyFilter: o.historyFilter ?? 'bilinear',
    planeDistance: o.planeDistance ?? 0.01,
    normalThreshold: o.normalThreshold ?? 0.95,
    atrousIterations: Math.max(1, Math.round(o.atrousIterations ?? 5)),
    kernel: o.kernel ?? '3x3',
    feedback: o.feedback ?? true,
    sigmaDepth: o.sigmaDepth ?? 1,
    sigmaNormal: o.sigmaNormal ?? 128,
    sigmaLuminance: o.sigmaLuminance ?? 4,
    luminanceVariance: o.luminanceVariance ?? 'sample',
    varianceRampFrames: o.varianceRampFrames ?? 4,
    spatialVarianceBoost: o.spatialVarianceBoost ?? 3,
    antiLag,
    antiLagNoiseFloor: o.antiLagNoiseFloor ?? 2,
    antiLagRadius: o.antiLagRadius ?? 1,
    gradientIterations: o.gradientIterations ?? 5,
    remodulate: o.remodulate ?? false,
    timestamps: o.timestamps ?? true,
    specularHistoryScale: o.specularHistoryScale ?? 1,
    specularHistoryCurve: o.specularHistoryCurve ?? 0.5,
    lobeFraction: o.lobeFraction ?? 0.75,
    radiusScale: o.radiusScale ?? 1,
    specularNormalWeight: o.specularNormalWeight ?? 'lobe',
  };
}

/** Per-frame inputs of one signal. */
export interface SignalFrame {
  radiance: GPUTexture;
  /** Factor the radiance was divided by (for `remodulate`). */
  demodulation?: GPUTexture;
  /** Renderer gradient samples for antiLag 'gradient' (rgba32float/rgba16float at ceil(W/3) x ceil(H/3)). */
  gradient?: GPUTexture;
}

/** Per-signal GPU state. */
class SignalState {
  params: GPUBuffer;
  accum: GPUTexture[] = [];
  moments: GPUTexture[] = [];
  hist?: GPUTexture;
  ping: GPUTexture[] = [];
  grad: GPUTexture[] = [];   // g0a, g1a, g0b, g1b, lambda
  out?: GPUTexture;

  constructor(device: GPUDevice, readonly kind: SignalKind, readonly opts: ResolvedOptions, readonly label: string) {
    this.params = device.createBuffer({ label: `${label} params`, size: PARAMS_SIZE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  }

  destroyTargets() {
    for (const t of [...this.accum, ...this.moments, ...this.ping, ...this.grad]) t.destroy();
    this.hist?.destroy();
    this.out?.destroy();
    this.accum = []; this.moments = []; this.ping = []; this.grad = [];
    this.hist = this.out = undefined;
  }
}

/** Options that change the pass structure: signals in one pipeline must agree on these. */
export function structuralKey(o: ResolvedOptions) {
  return [o.atrousIterations, o.kernel, o.feedback, o.antiLag, o.gradientIterations].join('|');
}

/**
 * SVGF / A-SVGF for one or two signals. With two signals every pass handles both
 * per thread (SPEC §4.1): geometry, reprojection and taps are loaded once.
 * Structural options (iterations, kernel, feedback, antiLag mode) come from the
 * first signal; numeric ones are per signal. Geometry tolerances (plane
 * distance, normal threshold) of the first signal are shared.
 */
export class SvgfPipeline {
  private sigs: SignalState[];
  private iterParams: GPUBuffer[] = [];
  private layouts: Record<string, GPUBindGroupLayout> = {};
  private pipes: Record<string, GPUComputePipeline> = {};
  private defs: Record<string, PassDef> = {};
  private cur = 0;
  private width = 0;
  private height = 0;
  private gw = 0;
  private gh = 0;
  private opts: ResolvedOptions;

  constructor(private device: GPUDevice, signals: { kind: SignalKind; opts: ResolvedOptions }[], private label: string) {
    const d = device;
    this.sigs = signals.map((s) => new SignalState(d, s.kind, s.opts, signals.length > 1 ? `${label} ${s.kind}` : label));
    this.opts = signals[0].opts;
    const o = this.opts;
    const kinds = signals.map((s) => s.kind);
    for (let i = 0; i < Math.max(o.atrousIterations, o.gradientIterations); i++) {
      const b = d.createBuffer({ label: `${label} iter ${i}`, size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      d.queue.writeBuffer(b, 0, new Int32Array([1 << i, i, 0, 0]));
      this.iterParams.push(b);
    }
    const make = (name: string, def: PassDef) => {
      this.defs[name] = def;
      this.layouts[name] = makeLayout(d, `${label} ${name}`, def.entries.map((e) => e.kind));
      this.pipes[name] = makePipeline(d, `${label} ${name}`, def.code, this.layouts[name]);
    };
    make('temporal', temporalPass(kinds));
    make('variance', variancePass(kinds));
    const box = o.kernel === '3x3';
    for (const writeHist of [false, true]) {
      for (const last of [false, true]) {
        if (writeHist && !o.feedback) continue;
        make(`atrous_${+writeHist}${+last}`, atrousPass(kinds, { writeHist, last, box }));
      }
    }
    if (o.antiLag !== 'off') {
      make('gcreate', gradientCreatePass(kinds.length, o.antiLag === 'gradient'));
      make('gatrous', gradientAtrousPass(kinds.length));
      make('glambda', gradientLambdaPass(kinds.length));
    }
  }

  configure(width: number, height: number) {
    this.width = width;
    this.height = height;
    const d = this.device;
    this.gw = Math.ceil(width / GRADIENT_DOWNSAMPLE);
    this.gh = Math.ceil(height / GRADIENT_DOWNSAMPLE);
    for (const s of this.sigs) {
      s.destroyTargets();
      const tex = (name: string, format: GPUTextureFormat, w = width, h = height, extra = 0) => d.createTexture({
        label: `${s.label} ${name}`, size: [w, h], format, usage: storageTex() | extra,
      });
      s.accum = [tex('accum0', 'rgba16float'), tex('accum1', 'rgba16float')];
      s.moments = [tex('moments0', 'rg32float'), tex('moments1', 'rg32float')];
      if (this.opts.feedback) s.hist = tex('history', 'rgba16float');
      s.ping = [tex('ping', 'rgba16float'), tex('pong', 'rgba16float')];
      s.out = tex('output', 'rgba16float', width, height, GPUTextureUsage.COPY_SRC);
      if (this.opts.antiLag !== 'off') {
        s.grad = ['g0a', 'g1a', 'g0b', 'g1b'].map((n) => tex(n, 'rgba32float', this.gw, this.gh));
        s.grad.push(tex('lambda', 'r32float', this.gw, this.gh));
      }
      this.writeParams(s);
    }
    this.cur = 0;
  }

  private writeParams(s: SignalState) {
    const o = s.opts;
    const f = new Float32Array(PARAMS_SIZE / 4);
    const u = new Uint32Array(f.buffer);
    const i32 = new Int32Array(f.buffer);
    f[0] = o.temporalAlpha; f[1] = o.momentsAlpha; f[2] = o.maxHistory; f[3] = o.planeDistance;
    f[4] = o.normalThreshold; f[5] = o.sigmaDepth; f[6] = o.sigmaNormal; f[7] = o.sigmaLuminance;
    f[8] = o.varianceRampFrames; f[9] = o.spatialVarianceBoost;
    f[10] = o.specularHistoryScale; f[11] = o.specularHistoryCurve;
    f[12] = o.lobeFraction; f[13] = o.antiLagNoiseFloor; f[14] = o.radiusScale;
    u[15] = (o.historyFilter === 'catmull-rom' ? P_CATMULL : 0) | (this.opts.antiLag !== 'off' ? P_ANTILAG : 0)
      | (o.remodulate ? P_REMODULATE : 0) | (this.opts.antiLag === 'gradient' ? P_GRADIENT_INPUT : 0)
      | (this.opts.kernel === '3x3' ? P_KERNEL_BOX3 : 0) | (o.luminanceVariance === 'mean' ? P_VAR_OF_MEAN : 0)
      | (o.specularNormalWeight === 'power' ? P_SPEC_NORMAL_POWER : 0);
    i32[16] = o.antiLagRadius; i32[17] = GRADIENT_DOWNSAMPLE; i32[18] = this.gw; i32[19] = this.gh;
    this.device.queue.writeBuffer(s.params, 0, f);
  }

  /** Outputs of the last frame, one per signal. */
  get outputs(): (GPUTexture | undefined)[] { return this.sigs.map((s) => s.out); }

  /** @internal Debug access (signal 0): 'accum' (rgb, history length) of the last frame, 'gradient' (lambda). */
  debugTexture(name: 'accum' | 'gradient', signal = 0): GPUTexture | undefined {
    const s = this.sigs[signal];
    if (name === 'accum') return s.accum[this.cur ^ 1];
    return s.grad[4];
  }

  private group(name: string, res: Record<string, Res>): GPUBindGroup {
    return makeBindGroup(this.device, this.layouts[name], this.defs[name].entries.map((e) => {
      const r = res[e.name];
      if (!r) throw new Error(`${this.label}: no resource for binding '${e.name}' of ${name}`);
      return r;
    }));
  }

  /** Records the passes for all signals (frames in signal order). */
  encode(enc: GPUCommandEncoder, timer: PassTimer | undefined, gp: GuidePass, frames: SignalFrame[],
    motion: GPUTexture, motionZ: GPUTexture | undefined, prefix: string) {
    const o = this.opts;
    this.sigs.forEach((s, i) => {
      if (s.opts.remodulate && !frames[i].demodulation) {
        throw new Error(`${s.label}: remodulate needs inputs.demodulation${s.kind === 'diffuse' ? ' (or guides.albedo)' : ''}`);
      }
    });
    const W = this.width, H = this.height;
    const gx = Math.ceil(W / 8), gy = Math.ceil(H / 8);
    const name = (n: string) => prefix + n;
    const c = this.cur;
    const shared: Record<string, Res> = {
      F: gp.frame, geoCur: gp.geoCur, geoPrev: gp.geoPrev, geoGrad: gp.geoGrad,
      motionTex: motion, motionZTex: motionZ ?? gp.dummy, smp: gp.sampler,
    };
    const per = (fn: (s: SignalState, f: SignalFrame, i: number) => Record<string, Res>) => {
      const r: Record<string, Res> = { ...shared };
      this.sigs.forEach((s, i) => {
        r[`P${i}`] = s.params;
        for (const [k, v] of Object.entries(fn(s, frames[i], i))) r[`${k}${i}`] = v;
      });
      return r;
    };

    const gradResult: GPUTexture[] = this.sigs.map(() => gp.dummy32);
    if (o.antiLag !== 'off') {
      runPass(enc, timer, name('gradient_create'), this.pipes.gcreate, this.group('gcreate', per((s, f) => ({
        input: f.radiance, accumPrev: s.accum[c ^ 1], gradInput: f.gradient ?? gp.dummy32, outG0: s.grad[0], outG1: s.grad[1],
      }))), Math.ceil(W / 9), Math.ceil(H / 9));
      let a = 0;
      for (let it = 0; it < o.gradientIterations; it++) {
        const res = per((s) => ({ inG0: s.grad[a], inG1: s.grad[a + 1], outG0: s.grad[a ^ 2], outG1: s.grad[(a ^ 2) + 1] }));
        res.It = this.iterParams[it];
        runPass(enc, timer, name(`gradient_atrous_${it}`), this.pipes.gatrous, this.group('gatrous', res),
          Math.ceil(this.gw / 8), Math.ceil(this.gh / 8));
        a ^= 2;
      }
      runPass(enc, timer, name('gradient_lambda'), this.pipes.glambda, this.group('glambda', per((s) => ({
        inG0: s.grad[a], outL: s.grad[4],
      }))), Math.ceil(this.gw / 8), Math.ceil(this.gh / 8));
      this.sigs.forEach((s, i) => { gradResult[i] = s.grad[4]; });
    }

    runPass(enc, timer, name('temporal'), this.pipes.temporal, this.group('temporal', per((s, f, i) => ({
      input: f.radiance, colorHist: o.feedback ? s.hist! : s.accum[c ^ 1],
      momentsPrev: s.moments[c ^ 1], grad: gradResult[i], outAccum: s.accum[c], outMoments: s.moments[c],
    }))), gx, gy);
    runPass(enc, timer, name('variance'), this.pipes.variance, this.group('variance', per((s) => ({
      accumCur: s.accum[c], momentsCur: s.moments[c], outPing: s.ping[0],
    }))), gx, gy);

    const K = o.atrousIterations;
    let src = 0;
    for (let it = 0; it < K; it++) {
      const last = it === K - 1;
      const writeHist = it === 0 && o.feedback;
      const key = `atrous_${+writeHist}${+last}`;
      const res = per((s, f) => ({
        src: s.ping[src], accumCur: s.accum[c], demod: f.demodulation ?? gp.dummy,
        dst: last ? s.out! : s.ping[src ^ 1], ...(writeHist ? { hist: s.hist! } : {}),
      }));
      res.I = this.iterParams[it];
      runPass(enc, timer, name(`atrous_${it}`), this.pipes[key], this.group(key, res), gx, gy);
      src ^= 1;
    }
  }

  /** Call once per frame after encode(). */
  endFrame() { this.cur ^= 1; }

  dispose() {
    for (const s of this.sigs) { s.destroyTargets(); s.params.destroy(); }
    for (const b of this.iterParams) b.destroy();
  }
}
