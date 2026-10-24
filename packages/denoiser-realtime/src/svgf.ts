// SvgfSignal: one signal's SVGF / A-SVGF pipeline (resources, pipelines, and
// the per-frame pass sequence). The public classes in denoisers.ts compose one
// or two of these behind a shared GuidePass.
//
//   [gradient_create, gradient_atrous_0..G-1]   (antiLag only, 1/3 resolution)
//   temporal      input + history -> accum[cur] (rgb, n), moments[cur]
//   variance      accum, moments -> ping (rgb, variance)
//   atrous_0..K-1 ping <-> pong; iteration 0 also writes hist (feedback);
//                 the last writes the output (optionally remodulated)
import type { PassTimer } from './common';
import { makeBindGroup, makeLayout, makePipeline, runPass, STORAGE_TEX } from './gpu';
import type { GuidePass } from './guides';
import { GRADIENT_DOWNSAMPLE, gradientAtrousWgsl, gradientCreateWgsl } from './shaders/gradient';
import {
  atrousWgsl, P_ANTILAG, P_CATMULL, P_GRADIENT_INPUT, P_KERNEL_BOX3, P_REMODULATE, P_SPEC_NORMAL_POWER, P_VAR_OF_MEAN, PARAMS_SIZE,
  temporalWgsl, varianceWgsl, type SignalKind,
} from './shaders/svgf';

/** SVGF / A-SVGF settings shared by every signal. All optional. */
export interface SvgfOptions {
  /** Algorithm. Only 'svgf' today ('recurrent' comes with M2). Default 'svgf'. */
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

export class SvgfSignal {
  private params: GPUBuffer;
  private iterParams: GPUBuffer[] = [];
  private gradIterParams: GPUBuffer[] = [];
  private layouts: Record<string, GPUBindGroupLayout> = {};
  private pipes: Record<string, GPUComputePipeline> = {};
  private accum: GPUTexture[] = [];
  private moments: GPUTexture[] = [];
  private hist?: GPUTexture;
  private ping: GPUTexture[] = [];
  private grad: GPUTexture[] = [];   // g0a, g1a, g0b, g1b
  private out?: GPUTexture;
  private cur = 0;
  private width = 0;
  private height = 0;
  private gw = 0;
  private gh = 0;

  constructor(private device: GPUDevice, readonly kind: SignalKind, readonly opts: ResolvedOptions, private label: string) {
    const d = device;
    this.params = d.createBuffer({ label: `${label} params`, size: PARAMS_SIZE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const K = opts.atrousIterations;
    for (let i = 0; i < Math.max(K, opts.gradientIterations); i++) {
      const b = d.createBuffer({ label: `${label} iter ${i}`, size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      d.queue.writeBuffer(b, 0, new Int32Array([1 << i, i, 0, 0]));
      this.iterParams.push(b);
    }
    this.gradIterParams = this.iterParams;

    this.layouts.temporal = makeLayout(d, `${label} temporal`,
      ['u', 'u', 'f', 'i', 'i', 'f', 'f', 'F', 'f', 'f', 's', 'f', 'rgba16float', 'rg32float']);
    this.layouts.variance = makeLayout(d, `${label} variance`, ['u', 'u', 'f', 'f', 'i', 'rgba16float', 'i']);
    const atrousBase: Parameters<typeof makeLayout>[2] = ['u', 'u', 'u', 'f', 'i', 'f', 'f', 'rgba16float', 'i'];
    this.layouts.atrous = makeLayout(d, `${label} atrous`, atrousBase);
    this.layouts.atrousHist = makeLayout(d, `${label} atrous+hist`, [...atrousBase, 'rgba16float']);
    this.pipes.temporal = makePipeline(d, `${label} temporal`, temporalWgsl(kind), this.layouts.temporal);
    this.pipes.variance = makePipeline(d, `${label} variance`, varianceWgsl(kind), this.layouts.variance);
    for (const writeHist of [false, true]) {
      for (const last of [false, true]) {
        if (writeHist && !opts.feedback) continue;
        this.pipes[`atrous_${+writeHist}${+last}`] = makePipeline(d, `${label} atrous${writeHist ? ' hist' : ''}${last ? ' last' : ''}`,
          atrousWgsl(kind, { writeHist, last }, opts.kernel === '3x3'), writeHist ? this.layouts.atrousHist : this.layouts.atrous);
      }
    }
    if (opts.antiLag !== 'off') {
      this.layouts.gcreate = makeLayout(d, `${label} gradient create`,
        ['u', 'u', 'f', 'i', 'i', 'f', 'f', 'f', 'f', 'rgba32float', 'rgba32float', 'i']);
      this.layouts.gatrous = makeLayout(d, `${label} gradient atrous`, ['u', 'u', 'f', 'f', 'rgba32float', 'rgba32float']);
      this.pipes.gcreate = makePipeline(d, `${label} gradient create`, gradientCreateWgsl(opts.antiLag === 'gradient'), this.layouts.gcreate);
      this.pipes.gatrous = makePipeline(d, `${label} gradient atrous`, gradientAtrousWgsl(), this.layouts.gatrous);
    }
  }

  configure(width: number, height: number) {
    this.destroyTargets();
    this.width = width;
    this.height = height;
    const d = this.device;
    const tex = (name: string, format: GPUTextureFormat, w = width, h = height, extra = 0) => d.createTexture({
      label: `${this.label} ${name}`, size: [w, h], format, usage: STORAGE_TEX | extra,
    });
    this.accum = [tex('accum0', 'rgba16float'), tex('accum1', 'rgba16float')];
    this.moments = [tex('moments0', 'rg32float'), tex('moments1', 'rg32float')];
    if (this.opts.feedback) this.hist = tex('history', 'rgba16float');
    this.ping = [tex('ping', 'rgba16float'), tex('pong', 'rgba16float')];
    this.out = tex('output', 'rgba16float', width, height, GPUTextureUsage.COPY_SRC);
    if (this.opts.antiLag !== 'off') {
      this.gw = Math.ceil(width / GRADIENT_DOWNSAMPLE);
      this.gh = Math.ceil(height / GRADIENT_DOWNSAMPLE);
      this.grad = ['g0a', 'g1a', 'g0b', 'g1b'].map((n) => tex(n, 'rgba32float', this.gw, this.gh));
    }
    this.cur = 0;
    this.writeParams();
  }

  private writeParams() {
    const o = this.opts;
    const f = new Float32Array(PARAMS_SIZE / 4);
    const u = new Uint32Array(f.buffer);
    const i32 = new Int32Array(f.buffer);
    f[0] = o.temporalAlpha; f[1] = o.momentsAlpha; f[2] = o.maxHistory; f[3] = o.planeDistance;
    f[4] = o.normalThreshold; f[5] = o.sigmaDepth; f[6] = o.sigmaNormal; f[7] = o.sigmaLuminance;
    f[8] = o.varianceRampFrames; f[9] = o.spatialVarianceBoost;
    f[10] = o.specularHistoryScale; f[11] = o.specularHistoryCurve;
    f[12] = o.lobeFraction; f[13] = o.antiLagNoiseFloor; f[14] = o.radiusScale;
    u[15] = (o.historyFilter === 'catmull-rom' ? P_CATMULL : 0) | (o.antiLag !== 'off' ? P_ANTILAG : 0)
      | (o.remodulate ? P_REMODULATE : 0) | (o.antiLag === 'gradient' ? P_GRADIENT_INPUT : 0)
      | (o.kernel === '3x3' ? P_KERNEL_BOX3 : 0) | (o.luminanceVariance === 'mean' ? P_VAR_OF_MEAN : 0)
      | (o.specularNormalWeight === 'power' ? P_SPEC_NORMAL_POWER : 0);
    i32[16] = o.antiLagRadius; i32[17] = GRADIENT_DOWNSAMPLE; i32[18] = this.gw; i32[19] = this.gh;
    this.device.queue.writeBuffer(this.params, 0, f);
  }

  get output(): GPUTexture | undefined { return this.out; }

  /** @internal Debug access: 'accum' (rgb, history length) of the last frame, 'gradient' (A-SVGF). */
  debugTexture(name: 'accum' | 'gradient'): GPUTexture | undefined {
    if (name === 'accum') return this.accum[this.cur ^ 1];
    return this.grad[this.opts.gradientIterations % 2 === 0 ? 0 : 2];
  }

  /** Records this signal's passes. Returns the output texture. */
  encode(enc: GPUCommandEncoder, timer: PassTimer | undefined, gp: GuidePass, frame: SignalFrame,
    motion: GPUTexture, motionZ: GPUTexture | undefined, prefix: string): GPUTexture {
    const d = this.device;
    const o = this.opts;
    const W = this.width, H = this.height;
    const gx = Math.ceil(W / 8), gy = Math.ceil(H / 8);
    const name = (n: string) => prefix + n;
    const accumCur = this.accum[this.cur], accumPrev = this.accum[this.cur ^ 1];
    const momCur = this.moments[this.cur], momPrev = this.moments[this.cur ^ 1];
    const colorHist = o.feedback ? this.hist! : accumPrev;
    const mz = motionZ ?? gp.dummy;

    let gradResult: GPUTexture = gp.dummy32;
    if (o.antiLag !== 'off') {
      const [g0a, g1a, g0b, g1b] = this.grad;
      const ggx = Math.ceil(this.gw / 8), ggy = Math.ceil(this.gh / 8);
      runPass(enc, timer, name('gradient_create'), this.pipes.gcreate, makeBindGroup(d, this.layouts.gcreate, [
        gp.frame, this.params, frame.radiance, gp.geoCur, gp.geoPrev, motion, mz, accumPrev,
        frame.gradient ?? gp.dummy32, g0a, g1a, gp.geoGrad,
      ]), Math.ceil(W / 9), Math.ceil(H / 9));
      let src = [g0a, g1a], dst = [g0b, g1b];
      for (let i = 0; i < o.gradientIterations; i++) {
        runPass(enc, timer, name(`gradient_atrous_${i}`), this.pipes.gatrous, makeBindGroup(d, this.layouts.gatrous, [
          this.params, this.gradIterParams[i], src[0], src[1], dst[0], dst[1],
        ]), ggx, ggy);
        [src, dst] = [dst, src];
      }
      gradResult = src[0];
    }

    runPass(enc, timer, name('temporal'), this.pipes.temporal, makeBindGroup(d, this.layouts.temporal, [
      gp.frame, this.params, frame.radiance, gp.geoCur, gp.geoPrev, motion, mz,
      colorHist, accumPrev, momPrev, gp.sampler, gradResult, accumCur, momCur,
    ]), gx, gy);
    runPass(enc, timer, name('variance'), this.pipes.variance, makeBindGroup(d, this.layouts.variance, [
      gp.frame, this.params, accumCur, momCur, gp.geoCur, this.ping[0], gp.geoGrad,
    ]), gx, gy);

    const K = o.atrousIterations;
    const demod = frame.demodulation ?? gp.dummy;
    let src = this.ping[0], dst = this.ping[1];
    for (let i = 0; i < K; i++) {
      const last = i === K - 1;
      const writeHist = i === 0 && o.feedback;
      const target = last ? this.out! : dst;
      const res = [gp.frame, this.params, this.iterParams[i], src, gp.geoCur, accumCur, demod, target, gp.geoGrad];
      if (writeHist) res.push(this.hist!);
      runPass(enc, timer, name(`atrous_${i}`), this.pipes[`atrous_${+writeHist}${+last}`],
        makeBindGroup(d, writeHist ? this.layouts.atrousHist : this.layouts.atrous, res), gx, gy);
      [src, dst] = [dst, src];
    }
    return this.out!;
  }

  /** Call once per frame after encode(). */
  endFrame() { this.cur ^= 1; }

  private destroyTargets() {
    for (const t of [...this.accum, ...this.moments, ...this.ping, ...this.grad]) t.destroy();
    this.hist?.destroy();
    this.out?.destroy();
    this.accum = []; this.moments = []; this.ping = []; this.grad = [];
    this.hist = this.out = undefined;
  }

  dispose() {
    this.destroyTargets();
    this.params.destroy();
    for (const b of this.iterParams) b.destroy();
  }
}
