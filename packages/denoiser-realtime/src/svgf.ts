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
import {
  GRADIENT_DOWNSAMPLE, gradientAtrousPass, gradientAtrousPassV2, gradientCreatePass, gradientCreatePassV2, gradientLambdaPass, gradientLambdaPassV2,
} from './shaders/gradient';
import { gradientCreatePassSh } from './shaders/sh-gradient';
import { SH_PACK_NEAREST, SH_PACK_TRUNCATE, type ShEncoding } from './shaders/sh';
import { atrousPassSh, P_SH_OFFSET, temporalPassSh, variancePassSh, type ShInputForm, type ShResolve } from './shaders/svgf-sh';
import {
  atrousPass, P_ANTILAG, P_CATMULL, P_GRADIENT_INPUT, P_KERNEL_BOX3, P_REMODULATE, P_SPEC_NORMAL_POWER, P_VAR_OF_MEAN,
  PARAMS_SIZE, temporalPass, variancePass, type ReflectionReprojection, type SignalKind,
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
  /**
   * Feed a-trous iteration 0 back as next frame's color history (SVGF paper's choice).
   * Default false: on the test bed feedback compounds spatial blur (results/M1.md §4: off
   * wins on all 7 paths, +0.6…+2.6 dB diffuse, and is cheaper).
   */
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
   * Largest radius of the young-history spatial variance estimate (SVGF: 3 = 7x7 when
   * n < 2, else 5x5). Default (-1): 3, but 1 (3x3) for specular with anti-lag v2, whose
   * anti-lag keeps many specular histories below 4 frames under camera motion: 3x3 was
   * +0.07 dB pooled and cheaper there (results/M1.md §12).
   */
  spatialVarianceRadius?: number;
  /**
   * Target 1 candidate (results/T1-recovery.md; our design, default 0 = off): in the young-history spatial
   * estimate (history < varianceRampFrames), weight each neighbour also by its own history length, capped at
   * this many frames, so pixels next to valid history (narrow disocclusions) borrow mostly from it. Resets
   * (every pixel at n = 1) are unaffected. Off = today's estimate, bit-identical.
   */
  spatialHistoryWeight?: number;
  /**
   * Target 1 candidate (results/T1-recovery.md; our design, default 1 = off): luminance edge-stopping strength
   * for young pixels in the a-trous passes, ramping linearly to 1 over varianceRampFrames frames of history.
   * 0 = no luminance weight on a pixel's first frame. 1 = today's filter, bit-identical.
   */
  youngLuminanceWeight?: number;
  /**
   * Target 1 (results/T1-recovery.md, E1b; our design): exponent of the normal
   * edge-stopping weight (the power form: diffuse, or specularNormalWeight 'power') for a pixel's first frame,
   * ramping geometrically to sigmaNormal over varianceRampFrames frames. A low value (e.g. 8-16) lets young
   * pixels on curved surfaces average over the full a-trous footprint (with 128 a sphere stops it within a few
   * pixels), while creases (n.n' <= 0) still stop. Removes the post-reset blotches. Default 16 for the radiance
   * payload (Dennis q18 (a), 2026-10-26: rule 9 passed at 256 and 4096 spp, +0.31 ms native-GPU cost at 1080p);
   * 0 = the previous behaviour (sigmaNormal from the first frame), still the default for payload 'sh' and for
   * OcclusionDenoiser (unmeasured there).
   */
  youngNormalPower?: number;
  /**
   * A-SVGF anti-lag (gradient-driven alpha). 'auto' estimates the temporal
   * gradient from the signal itself; 'gradient' uses renderer-supplied gradient
   * samples (`inputs.gradient`, see README). Default 'auto' (v2; Dennis, SPEC §12 item 2, 2026-10-25);
   * 'off' (the previous default) is unchanged when passed explicitly.
   */
  antiLag?: 'off' | 'auto' | 'gradient';
  /**
   * 'auto' anti-lag: gradient noise floor in standard deviations. Default (-1 = per signal):
   * 2 for diffuse (static regions keep long histories), 1 for specular (stays sensitive to
   * view-dependent drift: +0.11 dB pooled on the test bed); 2 for both with antiLagVersion 1.
   */
  antiLagNoiseFloor?: number;
  /**
   * Anti-lag implementation. 2 (default): gradient samples per stratum from one
   * reprojection, packed f16 reconstruction, and a noise floor from the composite
   * reconstruction kernel (v1 underestimated the noise ~4.5x, so static regions never
   * kept more than ~13 frames of history). 1: the M1 passes (results/M1.md §4), for
   * comparisons.
   */
  antiLagVersion?: 1 | 2;
  /** Anti-lag: neighbourhood (in strata) for the max over lambda. Default 1 (3x3, A-SVGF). */
  antiLagRadius?: number;
  /** Anti-lag: a-trous iterations of the gradient reconstruction. Default 4 (5 with antiLagVersion 1, as A-SVGF). */
  gradientIterations?: number;
  /**
   * Multiply the result by the demodulation factor (`inputs.demodulation`, or
   * `guides.albedo` for diffuse). Default false: output stays demodulated,
   * like the input (CAPTURE-FORMAT).
   */
  remodulate?: boolean;
  /** Per-pass GPU timestamps into `gpuTimings` when supported. Default true. */
  timestamps?: boolean;
  /**
   * What is filtered (SPEC v0.3 §8.5, M7). 'radiance' (default): one rgb value per pixel.
   * 'sh': a directional payload, L1 SH of the luma + chroma (YCoCg, 6 channels in one
   * rgba32uint), filtered with the smooth `guides.normal` and resolved afterwards at
   * the detail normal (`guides.detailNormal`), so normal-map detail survives the
   * filter. Needs `inputs.direction` (with `radiance`) or an encoded `inputs.sh` each
   * frame. Structural (pipelines differ).
   */
  payload?: 'radiance' | 'sh';
  /**
   * SH payload only: 'none' (diffuse default) returns the resolve-ready payload
   * (rgba32uint; resolve with `ShResolver`, `SH_RESOLVE_WGSL` or the three.js node);
   * 'fused' (specular default) resolves in the last a-trous pass at `guides.detailNormal`
   * and returns rgba16float rgb (remodulated if asked).
   */
  resolve?: 'none' | 'fused';
  /** SH: per-sample encoding (SPEC M7-2). Default 'normal-exact' (exact at the sampling normal); 'textbook' is the cosine-sampled projection with a 0.1 cosine floor. Structural. */
  shEncoding?: ShEncoding;
  /** SH: ringing guard k on |b| relative to Y at the guide normal (SPEC M7-8). Default 1. */
  shGuard?: number;
  /**
   * SH: sharpening s in [0, 1] of the fused diffuse resolve (SPEC M7-9). Default 0.75 (SPEC: 0; best or within
   * 0.05 dB of best on the dev page, test-bed `bumpy` and `bounce`, results/M7.md).
   */
  shSharpen?: number;
  /**
   * SH: format of the a-trous ping-pong (SPEC M7-3 tune). 'f16' (8 x f16, 16 B/px per buffer) or 'u8'
   * (6 x 8-bit of a shared exponent + an 8-bit log sigma, 8 B/px per buffer: -16 B/px per signal).
   * Default 'f16'. Structural.
   */
  shPingPacking?: 'f16' | 'u8';
  /** @internal Test only: f16 packing rounds toward zero (as rgba16float stores do on Metal), for the plain-vs-SH regression. */
  shPackTruncate?: boolean;
}

/** Specular SH resolve settings (SPEC M7-10, all tune guesses). */
export interface SpecularShOptions {
  /**
   * Detail / guide ratio of the fused specular resolve: 'sg' (SPEC M7-10: ambient + one SG
   * light from the payload, responses of SG-approximated GGX lobes) or 'l1' (the payload
   * itself at the two lobes' dominant directions). Default 'sg'.
   */
  shSpecularRatio?: 'sg' | 'l1';
  /** Sharpness of the SG light extracted from the payload ('sg'). Default 2 (SPEC: 8; 2 was best of 2 / 8 / 32 on both test scenes). */
  shLightSharpness?: number;
  /** Clamp of the detail / guide lobe-response ratio. Default 4. */
  shMaxRatio?: number;
  /** Roughness below which the ratio fades to 1 (fully faded at half of it). Default 0.2. */
  shFadeRoughness?: number;
}

/** Specular-only settings. */
export interface SpecularSvgfOptions extends SvgfOptions, SpecularShOptions {
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
  /**
   * Which point the specular history follows (review target 2, results/REFLECTION-MOTION.md; candidate, our
   * design from public sources): 'surface' (default, today's behaviour, bit-identical) reprojects with the surface's
   * motion; 'virtual' fetches the history where the reflected image was, X + v h F_dom / (1 + 2 kappa h) (hit
   * distance from `inputs.hitDistance`, its 3x3 mean; curvature kappa from neighbouring normals; Stachowiak 2015,
   * SPEC R-9), and falls back to the surface history where that footprint fails the plane test or the image is
   * real (past a concave mirror's focus); 'dual' takes both and blends them by their luminance distance to this
   * frame's 3x3 input mean (Eto et al. 2023 §2.4.2 after Stachowiak 2018), faded out between roughness 0.1 and 0.2.
   * Needs `inputs.hitDistance` (0 = miss).
   */
  reflectionReprojection?: ReflectionReprojection;
  /**
   * Reflected-world disocclusion test (review target 2 candidate, our design): drop specular history taps whose
   * stored hit distance (this frame's 3x3 mean of `inputs.hitDistance`, misses = far) differs from this frame's by
   * more than (0.1 + 0.4 r) of the larger plus max(this frame's 3x3 spread of hit distances, half the tap's stored
   * spread): the reflection analogue of the depth test, tolerant where the reflected depth itself is unstable (edges,
   * grazing floors, glossy lobes whose 9 samples happen to cluster). The virtual candidate of
   * `reflectionReprojection` always has it; this switches it on for the surface history too (trails of moving
   * reflected objects, reflector motion). Default false (bit-identical). Needs `inputs.hitDistance`; +8 B/px (the
   * specular moments become rgba32float: hit distance and spread in .b / .a).
   */
  reflectionHitTest?: boolean;
}

export type ResolvedOptions = Omit<Required<Omit<SpecularSvgfOptions, 'filter'>>, 'resolve'> & {
  /** 'auto' = the signal's default (shResolveOf). */
  resolve: 'none' | 'fused' | 'auto';
};

export function resolveOptions(o: SpecularSvgfOptions = {}): ResolvedOptions {
  if (o.filter && o.filter !== 'svgf') throw new Error(`denoiser-realtime: unknown filter '${o.filter}'`);
  const antiLag = o.antiLag ?? 'auto';
  const antiLagVersion = o.antiLagVersion ?? 2;
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
    feedback: o.feedback ?? false,
    sigmaDepth: o.sigmaDepth ?? 1,
    sigmaNormal: o.sigmaNormal ?? 128,
    sigmaLuminance: o.sigmaLuminance ?? 4,
    luminanceVariance: o.luminanceVariance ?? 'sample',
    varianceRampFrames: o.varianceRampFrames ?? 4,
    spatialVarianceBoost: o.spatialVarianceBoost ?? 3,
    spatialVarianceRadius: o.spatialVarianceRadius === undefined ? -1 : Math.max(0, Math.round(o.spatialVarianceRadius)),
    spatialHistoryWeight: Math.max(0, o.spatialHistoryWeight ?? 0),
    youngLuminanceWeight: Math.max(0, o.youngLuminanceWeight ?? 1),
    youngNormalPower: Math.max(0, o.youngNormalPower ?? (o.payload === 'sh' ? 0 : 16)), // 16: Dennis q18 (a), 2026-10-26
    antiLag,
    antiLagNoiseFloor: o.antiLagNoiseFloor ?? -1,
    antiLagVersion,
    antiLagRadius: o.antiLagRadius ?? 1,
    gradientIterations: o.gradientIterations ?? (antiLagVersion === 1 ? 5 : 4),
    remodulate: o.remodulate ?? false,
    timestamps: o.timestamps ?? true,
    payload: o.payload ?? 'radiance',
    resolve: o.resolve ?? 'auto',
    shSpecularRatio: o.shSpecularRatio ?? 'sg',
    shLightSharpness: o.shLightSharpness ?? 2,
    shMaxRatio: o.shMaxRatio ?? 4,
    shFadeRoughness: o.shFadeRoughness ?? 0.2,
    shEncoding: o.shEncoding ?? 'normal-exact',
    shGuard: o.shGuard ?? 1,
    shSharpen: o.shSharpen ?? 0.75,
    shPackTruncate: o.shPackTruncate ?? false,
    shPingPacking: o.shPingPacking ?? 'f16',
    specularHistoryScale: o.specularHistoryScale ?? 1,
    specularHistoryCurve: o.specularHistoryCurve ?? 0.5,
    lobeFraction: o.lobeFraction ?? 0.75,
    radiusScale: o.radiusScale ?? 1,
    specularNormalWeight: o.specularNormalWeight ?? 'lobe',
    reflectionReprojection: o.reflectionReprojection ?? 'surface',
    reflectionHitTest: o.reflectionHitTest ?? false,
  };
}

/** The specular reflection-tracking variant of the temporal pass is on (reflectionReprojection / reflectionHitTest). */
export const reflVariant = (kind: SignalKind, o: ResolvedOptions) => kind === 'specular' && (o.reflectionReprojection !== 'surface' || o.reflectionHitTest);

/** Effective SH resolve of a signal: the option, else 'none' for diffuse and 'fused' for specular (SPEC M7-11). */
export function shResolveOf(kind: SignalKind, o: ResolvedOptions): ShResolve {
  return o.resolve === 'auto' ? (kind === 'specular' ? 'fused' : 'none') : o.resolve;
}

/** Per-frame inputs of one signal. */
export interface SignalFrame {
  radiance: GPUTexture;
  /** Ray hit distance (world units, 0 = miss); read by `reflectionReprojection` 'virtual' / 'dual' only. */
  hitDistance?: GPUTexture;
  /** Factor the radiance was divided by (for `remodulate`). */
  demodulation?: GPUTexture;
  /** Renderer gradient samples for antiLag 'gradient' (rgba32float/rgba16float at ceil(W/3) x ceil(H/3)). */
  gradient?: GPUTexture;
  /** SH payload: world direction of each sample's ray (with `radiance`), or ... */
  direction?: GPUTexture;
  /** ... an encoded payload (rgba32uint, 8 x f16: a, b.xyz, Co, Cg, -, -; SPEC M7-2). */
  sh?: GPUTexture;
}

/** Guide textures the SH passes read besides the packed geometry. */
export interface ShGuides {
  /** The caller's filter normal (`guides.normal`): stands in for the detail normal when there is none. */
  normal: GPUTexture;
  detailNormal?: GPUTexture;
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
  const k: (string | number | boolean)[] = [o.atrousIterations, o.kernel, o.feedback, o.antiLag, o.gradientIterations, o.antiLagVersion];
  if (o.payload !== 'radiance') k.push(o.payload, o.shEncoding, o.shPackTruncate, o.shPingPacking);
  return k.join('|');
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
  private make: (name: string, def: PassDef) => void;
  private kinds: SignalKind[];
  private sh: boolean;

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
    const make = (name: string, def0: PassDef) => {
      const def = o.shPackTruncate ? { ...def0, code: def0.code.replace(SH_PACK_NEAREST, SH_PACK_TRUNCATE) } : def0;
      this.defs[name] = def;
      this.layouts[name] = makeLayout(d, `${label} ${name}`, def.entries.map((e) => e.kind));
      this.pipes[name] = makePipeline(d, `${label} ${name}`, def.code, this.layouts[name]);
    };
    this.make = make;
    this.kinds = kinds;
    this.sh = o.payload === 'sh';
    const box = o.kernel === '3x3';
    if (this.sh) {
      if (o.antiLag !== 'off' && o.antiLagVersion === 1) throw new Error(`${label}: payload 'sh' needs antiLagVersion 2`);
      if (signals.some((s) => reflVariant(s.kind, s.opts))) throw new Error(`${label}: reflectionReprojection / reflectionHitTest need payload 'radiance'`);
      for (const s of signals) {
        if (s.opts.remodulate && shResolveOf(s.kind, s.opts) !== 'fused') throw new Error(`${label}: remodulate with payload 'sh' needs resolve 'fused' (otherwise remodulate after your resolve)`);
      }
      // temporal and gradient_create are built per input form on first use (encode)
      const p64 = o.shPingPacking === 'u8';
      make('variance', variancePassSh(kinds, p64));
      const res = signals.map((s) => shResolveOf(s.kind, s.opts));
      for (const writeHist of [false, true]) {
        for (const last of [false, true]) {
          if (writeHist && !o.feedback) continue;
          make(`atrous_${+writeHist}${+last}`, atrousPassSh(kinds, { writeHist, last, box }, res, p64));
        }
      }
    } else {
      const rr = signals.map((s) => (s.kind === 'specular' ? s.opts.reflectionReprojection : 'surface'));
      const ht = signals.map((s) => s.kind === 'specular' && s.opts.reflectionHitTest);
      make('temporal', signals.some((s) => reflVariant(s.kind, s.opts)) ? temporalPass(kinds, { reflection: rr, hitTest: ht }) : temporalPass(kinds));
      const hw = signals.map((s) => s.opts.spatialHistoryWeight > 0);
      make('variance', hw.some(Boolean) ? variancePass(kinds, { historyWeight: hw }) : variancePass(kinds));
      const yl = signals.map((s) => s.opts.youngLuminanceWeight !== 1 || s.opts.youngNormalPower > 0);
      for (const writeHist of [false, true]) {
        for (const last of [false, true]) {
          if (writeHist && !o.feedback) continue;
          make(`atrous_${+writeHist}${+last}`, atrousPass(kinds, yl.some(Boolean) ? { writeHist, last, box, youngLum: yl } : { writeHist, last, box }));
        }
      }
    }
    if (o.antiLag !== 'off' && !this.sh) {
      const v1 = o.antiLagVersion === 1;
      make('gcreate', (v1 ? gradientCreatePass : gradientCreatePassV2)(kinds.length, o.antiLag === 'gradient'));
      make('gatrous', (v1 ? gradientAtrousPass : gradientAtrousPassV2)(kinds.length));
      make('glambda', (v1 ? gradientLambdaPass : gradientLambdaPassV2)(kinds.length));
    }
    if (o.antiLag !== 'off' && this.sh) {
      make('gatrous', gradientAtrousPassV2(kinds.length));
      make('glambda', gradientLambdaPassV2(kinds.length));
    }
  }

  /** SH: pipelines that depend on the per-frame input form, built on first use. */
  private shPipe(base: 'temporal' | 'gcreate', forms: ShInputForm[]): string {
    const key = `${base}_${forms.join('_')}`;
    if (!this.pipes[key]) {
      const o = this.opts;
      this.make(key, base === 'temporal' ? temporalPassSh(this.kinds, forms, o.shEncoding)
        : gradientCreatePassSh(this.kinds, o.antiLag === 'gradient', forms, o.shEncoding));
    }
    return key;
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
      // SH: 8 x f16 in one rgba32uint (SPEC M7-3); the output is the payload unless fused
      const cf: GPUTextureFormat = this.sh ? 'rgba32uint' : 'rgba16float';
      s.accum = [tex('accum0', cf), tex('accum1', cf)];
      // reflectionReprojection: the moments also carry the frame's hit distance (.b) for the virtual tap test
      const mf: GPUTextureFormat = reflVariant(s.kind, s.opts) && !this.sh ? 'rgba32float' : 'rg32float';
      s.moments = [tex('moments0', mf), tex('moments1', mf)];
      if (this.opts.feedback) s.hist = tex('history', cf);
      const pf: GPUTextureFormat = this.sh && this.opts.shPingPacking === 'u8' ? 'rg32uint' : cf;
      s.ping = [tex('ping', pf), tex('pong', pf)];
      s.out = tex('output', this.sh && shResolveOf(s.kind, s.opts) !== 'fused' ? 'rgba32uint' : 'rgba16float', width, height, GPUTextureUsage.COPY_SRC);
      if (this.opts.antiLag !== 'off') {
        // v1: (g0, g1) rgba32float ping-pong; v2: one packed rgba32uint ping-pong
        s.grad = this.opts.antiLagVersion === 1
          ? ['g0a', 'g1a', 'g0b', 'g1b'].map((n) => tex(n, 'rgba32float', this.gw, this.gh))
          : ['ga', 'gb'].map((n) => tex(n, 'rgba32uint', this.gw, this.gh));
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
    f[12] = o.lobeFraction; f[14] = o.radiusScale;
    f[13] = o.antiLagNoiseFloor >= 0 ? o.antiLagNoiseFloor : this.opts.antiLagVersion === 1 || s.kind === 'diffuse' ? 2 : 1;
    u[15] = (o.historyFilter === 'catmull-rom' ? P_CATMULL : 0) | (this.opts.antiLag !== 'off' ? P_ANTILAG : 0)
      | (o.remodulate ? P_REMODULATE : 0) | (this.opts.antiLag === 'gradient' ? P_GRADIENT_INPUT : 0)
      | (this.opts.kernel === '3x3' ? P_KERNEL_BOX3 : 0) | (o.luminanceVariance === 'mean' ? P_VAR_OF_MEAN : 0)
      | (o.specularNormalWeight === 'power' ? P_SPEC_NORMAL_POWER : 0);
    i32[16] = o.antiLagRadius; i32[17] = GRADIENT_DOWNSAMPLE; i32[18] = this.gw; i32[19] = this.gh;
    f[21] = o.spatialHistoryWeight;   // Params.pad0 (bitcast in the variance pass when spatialHistoryWeight > 0)
    if (o.youngLuminanceWeight !== 1 || o.youngNormalPower > 0) { f[22] = o.youngLuminanceWeight; f[23] = o.youngNormalPower; }   // pad1, pad2 (a-trous)
    i32[20] = o.spatialVarianceRadius >= 0 ? o.spatialVarianceRadius
      : this.opts.antiLag !== 'off' && this.opts.antiLagVersion !== 1 && s.kind === 'specular' ? 1 : 3;
    if (this.sh) {
      f[P_SH_OFFSET] = o.shGuard; f[P_SH_OFFSET + 1] = o.shSharpen;
      f[P_SH_OFFSET + 3] = o.shSpecularRatio === 'l1' ? 0 : Math.max(o.shLightSharpness, 1e-3); f[P_SH_OFFSET + 4] = o.shMaxRatio; f[P_SH_OFFSET + 5] = o.shFadeRoughness;
    }
    this.device.queue.writeBuffer(s.params, 0, f);
  }

  /** Outputs of the last frame, one per signal. */
  get outputs(): (GPUTexture | undefined)[] { return this.sigs.map((s) => s.out); }

  /** @internal Debug access (signal 0): 'accum' (rgb, history length) of the last frame, 'gradient' (lambda). */
  debugTexture(name: 'accum' | 'gradient', signal = 0): GPUTexture | undefined {
    const s = this.sigs[signal];
    if (name === 'accum') return s.accum[this.cur ^ 1];
    return s.grad[s.grad.length - 1];
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
    motion: GPUTexture, motionZ: GPUTexture | undefined, prefix: string, shGuides?: ShGuides) {
    const o = this.opts;
    this.sigs.forEach((s, i) => {
      if (s.opts.remodulate && !frames[i].demodulation) {
        throw new Error(`${s.label}: remodulate needs inputs.demodulation${s.kind === 'diffuse' ? ' (or guides.albedo)' : ''}`);
      }
    });
    if (this.sh) {
      this.encodeSh(enc, timer, gp, frames, motion, motionZ, prefix, shGuides);
      return;
    }
    const W = this.width, H = this.height;
    const gx = Math.ceil(W / 8), gy = Math.ceil(H / 8);
    const name = (n: string) => prefix + n;
    const c = this.cur;
    const needHit = (s: SignalState, f: SignalFrame) => {
      if (!f.hitDistance) throw new Error(`${s.label}: reflectionReprojection / reflectionHitTest need inputs.hitDistance`);
      return f.hitDistance;
    };
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
    if (o.antiLag !== 'off' && o.antiLagVersion === 1) {
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
    } else if (o.antiLag !== 'off') {
      // v2: thread per stratum, packed rgba32uint ping-pong (grad[0], grad[1]), lambda grad[2]
      runPass(enc, timer, name('gradient_create'), this.pipes.gcreate, this.group('gcreate', per((s, f) => ({
        input: f.radiance, accumPrev: s.accum[c ^ 1], gradInput: f.gradient ?? gp.dummy32, outG: s.grad[0],
      }))), Math.ceil(this.gw / 8), Math.ceil(this.gh / 8));
      let a = 0;
      for (let it = 0; it < o.gradientIterations; it++) {
        const res = per((s) => ({ inG: s.grad[a], outG: s.grad[a ^ 1] }));
        res.It = this.iterParams[it];
        runPass(enc, timer, name(`gradient_atrous_${it}`), this.pipes.gatrous, this.group('gatrous', res),
          Math.ceil(this.gw / 8), Math.ceil(this.gh / 8));
        a ^= 1;
      }
      runPass(enc, timer, name('gradient_lambda'), this.pipes.glambda, this.group('glambda', per((s) => ({
        inG: s.grad[a], outL: s.grad[2],
      }))), Math.ceil(this.gw / 8), Math.ceil(this.gh / 8));
      this.sigs.forEach((s, i) => { gradResult[i] = s.grad[2]; });
    }

    runPass(enc, timer, name('temporal'), this.pipes.temporal, this.group('temporal', per((s, f, i) => ({
      input: f.radiance, colorHist: o.feedback ? s.hist! : s.accum[c ^ 1],
      momentsPrev: s.moments[c ^ 1], grad: gradResult[i], outAccum: s.accum[c], outMoments: s.moments[c],
      ...(reflVariant(s.kind, s.opts) ? { hit: needHit(s, f) } : {}),
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

  /** SH payload pass sequence (same structure as the plain one; SPEC M7-7). */
  private encodeSh(enc: GPUCommandEncoder, timer: PassTimer | undefined, gp: GuidePass, frames: SignalFrame[],
    motion: GPUTexture, motionZ: GPUTexture | undefined, prefix: string, shGuides?: ShGuides) {
    const o = this.opts;
    if (!shGuides) throw new Error(`${this.label}: payload 'sh' needs the guides`);
    const forms: ShInputForm[] = frames.map((f, i) => {
      if (f.sh) return 'enc';
      if (f.direction) return 'raw';
      throw new Error(`${this.sigs[i].label}: payload 'sh' needs inputs.direction (with radiance) or inputs.sh`);
    });
    const detail = shGuides.detailNormal ?? shGuides.normal;
    const W = this.width, H = this.height;
    const gx = Math.ceil(W / 8), gy = Math.ceil(H / 8);
    const name = (n: string) => prefix + n;
    const c = this.cur;
    const shared: Record<string, Res> = {
      F: gp.frame, geoCur: gp.geoCur, geoPrev: gp.geoPrev, geoGrad: gp.geoGrad,
      motionTex: motion, motionZTex: motionZ ?? gp.dummy, smp: gp.sampler, detailN: detail,
    };
    const per = (fn: (s: SignalState, f: SignalFrame, i: number) => Record<string, Res>) => {
      const r: Record<string, Res> = { ...shared };
      this.sigs.forEach((s, i) => {
        r[`P${i}`] = s.params;
        for (const [k, v] of Object.entries(fn(s, frames[i], i))) r[`${k}${i}`] = v;
      });
      return r;
    };
    const load = (f: SignalFrame): Record<string, Res> => (f.sh ? { shIn: f.sh } : { input: f.radiance, dir: f.direction! });

    const gradResult: GPUTexture[] = this.sigs.map(() => gp.dummy32);
    if (o.antiLag !== 'off') {
      const key = this.shPipe('gcreate', forms);
      runPass(enc, timer, name('gradient_create'), this.pipes[key], this.group(key, per((s, f) => ({
        ...load(f), accumPrev: s.accum[c ^ 1], gradInput: f.gradient ?? gp.dummy32, outG: s.grad[0],
      }))), Math.ceil(this.gw / 8), Math.ceil(this.gh / 8));
      let a = 0;
      for (let it = 0; it < o.gradientIterations; it++) {
        const res = per((s) => ({ inG: s.grad[a], outG: s.grad[a ^ 1] }));
        res.It = this.iterParams[it];
        runPass(enc, timer, name(`gradient_atrous_${it}`), this.pipes.gatrous, this.group('gatrous', res),
          Math.ceil(this.gw / 8), Math.ceil(this.gh / 8));
        a ^= 1;
      }
      runPass(enc, timer, name('gradient_lambda'), this.pipes.glambda, this.group('glambda', per((s) => ({
        inG: s.grad[a], outL: s.grad[2],
      }))), Math.ceil(this.gw / 8), Math.ceil(this.gh / 8));
      this.sigs.forEach((s, i) => { gradResult[i] = s.grad[2]; });
    }

    const tkey = this.shPipe('temporal', forms);
    runPass(enc, timer, name('temporal'), this.pipes[tkey], this.group(tkey, per((s, f, i) => ({
      ...load(f), colorHist: o.feedback ? s.hist! : s.accum[c ^ 1],
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
