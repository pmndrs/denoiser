// RecurrentPipeline: the recurrent blur filter (`filter: 'recurrent'`) for one
// or two signals per dispatch (resources, buffer rotation, pass sequence).
// Provisional: SPEC v0 (docs/research/rt-denoiser/SPEC.md §5, §10.1), not yet
// reviewed. Passes and their sources: shaders/recurrent.ts.
//
// Buffer rotation per signal (SPEC §10.1): four rgba16float buffers. At frame
// start p = last frame's post-blur output (H_prev), q = last frame's
// stabilized output (S_prev), r and s free.
//   R1 pre_blur     reads p (ĥ guide)            writes r = pre
//   R2 temporal     reads r, p (reprojected)     writes s = acc (+ fast history, data)
//   R3 mips         reads s                      writes p = signal mip atlas (+ depth atlas)   [historyFix 'mips' only]
//   R4 history_fix  reads s (+ p atlas)          writes r = fix (data in place)
//   R5 blur         reads r                      writes p = blur
//   R6 post_blur    reads p, s (centre)          writes r = H (next frame's history)
//   R7 stabilize    reads r, q (reprojected)     writes p = S (output, next frame's S_prev)
// Next frame: p' = r, q' = p, r' = q, s' = s.
import type { PassTimer } from './common';
import { withF16Rounding, type F16Rounding } from './f16';
import { makeBindGroup, makeLayout, makePipeline, runPass, storageTex, type Res } from './gpu';
import type { GuidePass } from './guides';
import type { PassDef } from './shaders/bindings';
import {
  blurPass, formatOf, historyFixPass, type SpatialFixConfig, isOccKind, isSpecKind, mipsPass, preBlurPass, RF_SIZE, RP_HAS_HIT, RP_NO_ANTILAG,
  RP_NO_FIREFLY, RP_NO_HISTORY_FIX, RP_NO_STABILIZE, RP_NO_VIRTUAL, RP_REMODULATE, RP_SIZE, stabilizePass, temporalPass, type RecurrentTemporalVariant,
  trivialPass, type RecurrentKind,
} from './shaders/recurrent';

/**
 * Recurrent blur settings (SPEC §5; defaults are SPEC v0's, provisional). All
 * optional except `filter`. Radii are in pixels at 1080p and scale with the
 * output height.
 */
export interface RecurrentOptions {
  filter: 'recurrent';
  /** Hit-distance normalization ĥ = h / (h + a + b·depth) (SPEC F-3): a in world units. Default 1. */
  hitDistanceScale?: number;
  /** b in the curve above (per unit of view depth). Default 0.05. */
  hitDistanceViewScale?: number;
  /** Safety clamp per channel on the input (SPEC F-1). Default 1e4. */
  maxRadiance?: number;
  /** Pre-blur radius in px at 1080p (SPEC D1: 15; tuned on the test bed). Default 25 (diffuse), 10 (specular). */
  preBlurRadius?: number;
  /** Blur radius at A = 0 in px at 1080p (R_max, SPEC R-5: 30; tuned on the test bed). Default 45 (diffuse), 30 (specular). */
  blurRadius?: number;
  /** Minimum blur radius in px (SPEC R-5). Default 1. */
  minBlurRadius?: number;
  /** History length cap A_cap (frames - 1, SPEC C-9). Default 31. */
  maxAccumulatedFrames?: number;
  /** Fast-history cap A_fast (SPEC C-10). Default 3. */
  fastFrames?: number;
  /** History fix (mip repair) below this A (SPEC D7). Default 3. */
  historyFixFrames?: number;
  /** History-fix depth tolerance τ_fix, relative, per mip level (SPEC D7). Default 0.02. */
  historyFixDepthTolerance?: number;
  /** History-fix minimum normalized weight sum before falling to a finer level (SPEC D7). Default 0.25. */
  historyFixMinWeight?: number;
  /**
   * How the history fix rebuilds young pixels (A < historyFixFrames). 'spatial' (default since 2026-10-26, Dennis
   * q19 (a); results/T1-recovery.md §5.2): no mips; 16 disk taps of the full-resolution accumulated signal, weighted
   * by plane distance and normal, radius historyFixRadius (8 px) at A = 0 halving per frame; one dispatch and the
   * depth atlas (1.5 B/px) fewer. 'mips' (the default until then, SPEC D7): a 3-level mip pyramid of the accumulated
   * signal, bilaterally upsampled by view depth; smoother (less young-pixel boil) and better on the single frame
   * right after a camera cut at 1080p, worse on every pooled / disoccluded / boundary measure. Structural.
   */
  historyFix?: 'mips' | 'spatial';
  /** 'spatial' history fix: tap radius in pixels at A = 0, halving per frame (not scaled with resolution, like the mips). Default 8 (results/T1-recovery.md: 4 / 6 / 8 / 12 / 16 / 24 measured; 8 is best for specular, within 0.1 dB of best for diffuse). */
  historyFixRadius?: number;
  /**
   * 'spatial' history fix, T1b extension (results/T1b-spatial-repair.md; option, default 0 = off): each tap's weight is
   * multiplied by 1 + k · min(A_tap, fastFrames), so older (less noisy) neighbours count more. Structural.
   */
  historyFixAgeWeight?: number;
  /**
   * 'spatial' history fix, T1b extension (default 0 = off): a second 16-tap ring at this multiple of the radius where
   * the young fraction (share of the first ring's geometry weight on taps with A = 0) is ≥ historyFixYoungThreshold,
   * i.e. inside full resets and wide reveals. Structural.
   */
  historyFixWideRing?: number;
  /** Number of wide rings (ring k at (1 + k · (historyFixWideRing − 1)) × the radius). Default 1. Structural. */
  historyFixWideRings?: number;
  /** What the wide ring rebuilds: 'all' (rgb and ĥ, default) or 'hit' (ĥ only; occlusion: same as 'all'). Structural. */
  historyFixWideUse?: 'all' | 'hit';
  /**
   * 'spatial' history fix, T1b extension (default 'off'): fall back to the mip repair (SPEC D7; builds the mips pass and
   * depth atlas again) where the young fraction is ≥ historyFixYoungThreshold ('young') or on frames flagged reset
   * ('reset'); 'hit' takes ĥ from the mip repair everywhere and rgb from the taps (diagnostic); 'clamp' takes the mip
   * repair where the young fraction is high, its luminance clamped to the taps' mean ± historyFixMipsClamp standard
   * errors. Structural.
   */
  historyFixMips?: 'off' | 'young' | 'reset' | 'hit' | 'clamp';
  /** historyFixMips 'clamp': window half-width in standard errors of the taps' weighted mean luminance. Default 1. Structural. */
  historyFixMipsClamp?: number;
  /**
   * T1b option (default 0 = off): blur taps added on pixels with A = 0 (resets and reveals): 8 = 8 more taps (the disk
   * turned by π/8). Structural.
   */
  youngBlurTaps?: number;
  /**
   * 'spatial' history fix, T1b extension (default 4 since T1b, rule 9 passed; 0 = the 16 disk taps only): pixels with A = 0 average every pixel within this many px
   * (geometry / normal weighted; a shared-memory tile loaded only by workgroups that hold an A = 0 pixel) instead of
   * the 16 disk taps. Structural; at most 7 (workgroup memory).
   */
  historyFixDense?: number;
  /** historyFixDense radius cap: 'mip' (default: the D7 mip level's tent, larger on mid-rough specular) or 'disk' (the disk's roughness-scaled radius). Structural. */
  historyFixDenseCap?: 'disk' | 'mip';
  /** Young-fraction threshold of historyFixWideRing / historyFixMips 'young' (0..1). Default 0.9. Structural. */
  historyFixYoungThreshold?: number;
  /** Anti-firefly: centre luminance ≤ k × second-largest neighbour (SPEC D9); 0 disables. Default 1.5. */
  fireflyThreshold?: number;
  /**
   * History anti-lag: shorten the history where the fast history (or this frame) disagrees
   * with it (SPEC C-10; the `antiLag*` keys below tune it). Default true.
   */
  historyAntiLag?: boolean;
  /**
   * @deprecated Renamed `historyAntiLag` (SPEC §12 item 8, decided 2026-10-25): SVGF's
   * `antiLag` is `'off' | 'auto' | 'gradient'` and shadows' is a gain, so the boolean got its own
   * name. Still read when `historyAntiLag` is unset; warns once per instance.
   */
  antiLag?: boolean;
  /** Anti-lag clamp window γ (in standard errors of the 3x3 fast-history mean, see antiLagStandardError). Default 1 (SPEC: 2 spreads). */
  antiLagSigma?: number;
  /** Relative luminance excess e_max at which history is fully shortened. Default 0.5. */
  antiLagExcess?: number;
  /** ĥ excess at which history is fully shortened. Default 0.2. */
  antiLagHitTolerance?: number;
  /**
   * Current-frame anti-lag detector (our addition to SPEC C-10): threshold in
   * standard errors of the 3x3 mean of this frame's pre-blurred signal vs the
   * reprojected history; history is shortened between 1x and 2x this. 0 disables. Default 3.
   */
  antiLagCurrentSigma?: number;
  /** Absolute ĥ tolerance added to the current-frame detector. Default 0.05. */
  antiLagCurrentHitTolerance?: number;
  /** Fast-history clamp window from the standard error of the 3x3 mean instead of the spread (SPEC C-10 uses the spread). Default true. */
  antiLagStandardError?: boolean;
  /** Stabilization speed N_stab (α ≥ 1/(1 + N), SPEC D10); 0 disables stabilization. Default 7. */
  stabilizationFrames?: number;
  /** Plane-distance disocclusion threshold, relative to view distance (SPEC C-7). Default 0.01. */
  planeDistance?: number;
  /** GGX lobe energy fraction E for the lobe half-angle (SPEC R-1). Default 0.75. */
  lobeFraction?: number;
  /**
   * Disk taps (4 or 8, compiled in; SPEC R-3: 8). Measured on the 1080p test bed: a 4-tap
   * post-blur is neutral (±0.06 dB) for both signals and saves 0.4 ms joint; a 4-tap
   * pre-blur costs diffuse 0.5 dB but is neutral for specular; a 4-tap blur costs
   * 0.07 dB and +5 % flicker. Defaults: pre-blur 8 (diffuse) / 4 (specular), blur 8, post-blur 4.
   */
  preBlurTaps?: number;
  blurTaps?: number;
  postBlurTaps?: number;
  /** Specular surface-motion history scale k_s (SPEC R-8). Default 1. */
  specularHistoryScale?: number;
  /** Specular virtual-motion (reflected-image) reprojection, blended with surface motion (SPEC R-9..R-12). Default true. */
  virtualMotion?: boolean;
  /**
   * Review target 6 candidate (results/T6-boundaries.md; our design after the SVGF option `reflectionHitTest`): drop a
   * virtual-footprint tap when its stored fast ĥ disagrees with this frame's pre-blurred ĥ by more than
   * tune.virtHitTestA × the virtual ĥ tolerance (virtualHitTolerance + virtualHitToleranceRoughness · r) plus
   * tune.virtHitTestB × the 3x3 spread of this frame's ĥ: a reflected-world disocclusion (background pixels next to a
   * reflected object whose virtual footprint lands where the object's image was) then has no virtual history instead
   * of a short one. Default true since T6 (rule 9 passed for the recurrent filter); false compiles it out. OcclusionDenoiser keeps false.
   */
  virtualHitTest?: boolean;
  /**
   * Review target 6 candidate (results/T6-boundaries.md): minimum cosine between this pixel's normal and a history tap's
   * normal (SVGF sec. 4.1's normal test, on top of the plane test). Default 0.95 since T6 (with normalTest 'relative';
   * rule 9 passed); 0 = backfacing taps only (the previous test). OcclusionDenoiser keeps 0. Geometry tolerances are shared: the first signal's value applies to a joint pipeline.
   */
  normalThreshold?: number;
  /**
   * Review target 6 candidate (results/T6-boundaries.md, our design): 'relative' relaxes the history normal test to the
   * pixel's own neighbourhood: min(normalThreshold, lowest normal cosine between this pixel and its 3x3 neighbours on
   * the same surface - 0.02), floored at the backface test. Default 'relative' since T6; 'center' = normalThreshold as is.
   */
  normalTest?: 'center' | 'relative';
  /** Virtual-history clamp window γ (σ of this frame's 3x3, SPEC R-11: 2), widened × (1 + 2·confidence) (tune.virtWiden). Default 1. */
  virtualClampSigma?: number;
  /** Virtual confidence normal tolerance, × lobe half-angle (SPEC R-10). Default 0.5. */
  virtualAngleScale?: number;
  /** Virtual confidence ĥ tolerance a + b·roughness (SPEC R-10): a. Default 0.05. */
  virtualHitTolerance?: number;
  /** b in the tolerance above. Default 0.25. */
  virtualHitToleranceRoughness?: number;
  /** Specular minimum blur radius: minBlurRadius · lerp(1, f_r(roughness), s) (0 = SPEC's constant floor; 1 = no floor on mirrors). Default 1. */
  specularMinRadiusScale?: number;
  /** Multiply the output by the demodulation factor into separate textures. Default false. */
  remodulate?: boolean;
  /** Per-pass GPU timestamps into `gpuTimings` when supported. Default true. */
  timestamps?: boolean;
  /** @internal Replace every pass by a trivial kernel with the same bindings (SPEC §10.3 skeleton timing). */
  skeleton?: boolean;
  /**
   * Rounding of values written to the rgba16float buffers: 'nearest' rounds to nearest-even before every store
   * (src/f16.ts), 'store' leaves it to the platform (Metal truncates toward zero). Default 'nearest' since Dennis q25 (a),
   * 2026-10-27 (rule 9 passed, results/DISTANCE-LONG.md §6); OcclusionDenoiser's recurrent mode keeps 'store' (not in
   * that A/B).
   */
  f16Rounding?: F16Rounding;
  /** @internal Weight tolerance overrides (sweeps): [geometry A=0, A=1], normal tightening, hit [r=0, r=1, tightening], post-blur [lo, hi, delta], stabilization γ [lo, hi], β. */
  tune?: Partial<RecurrentTune>;
}

export interface RecurrentTune {
  geoTolLo: number; geoTolHi: number; normalTight: number;
  hitTolLo: number; hitTolHi: number; hitTolTight: number;
  postLo: number; postHi: number; postDelta: number;
  stabGammaLo: number; stabGammaHi: number; stabBeta: number;
  /** virtual distance curvature correction scale (D12c; 0 = flat reflectors) */
  virtCurv: number;
  /** virtual clamp window widening with confidence: gamma (1 + virtWiden cv) (0 = SPEC R-11 form) */
  virtWiden: number;
  /** specular current-frame detector floor A_fast x lerp(1, f_r, detRough) */
  detRough: number;
  /** specular anti-lag / detector mean: own pixel (mirrors) .. 3x3 mean (f_r = 1); 0 = always the 3x3 mean */
  specCentre: number;
  /** glossy kernel elongation kappa_e (SPEC R-4) */
  elong: number;
  /** occlusion kinds only: clamp the slow ĥ into the fast-history window in history fix (1) or only shorten A (0) */
  occClamp: number;
  /** virtualHitTest tolerance: a × the virtual ĥ tolerance + b × the 3x3 ĥ spread (compiled in) */
  virtHitTestA: number;
  virtHitTestB: number;
}

export type ResolvedRecurrent = Required<Omit<RecurrentOptions, 'filter' | 'tune' | 'preBlurRadius' | 'blurRadius' | 'antiLag'>> & {
  preBlurRadius?: number; blurRadius?: number; tune: RecurrentTune;
};

/**
 * True when `o` sets the deprecated boolean `antiLag` (now `historyAntiLag`). The public
 * classes call this per signal and warn once per instance.
 */
export function usesDeprecatedAntiLag(o: object | undefined): boolean {
  return typeof (o as { antiLag?: unknown } | undefined)?.antiLag === 'boolean';
}

/** The one-per-instance warning for the deprecated recurrent `antiLag`. */
export function warnDeprecatedAntiLag(who: string): void {
  console.warn(`${who}: the recurrent option \`antiLag\` (boolean) is deprecated, use \`historyAntiLag\``);
}

export function resolveRecurrent(o: Partial<RecurrentOptions> = {}): ResolvedRecurrent {
  return {
    hitDistanceScale: o.hitDistanceScale ?? 1,
    hitDistanceViewScale: o.hitDistanceViewScale ?? 0.05,
    maxRadiance: o.maxRadiance ?? 1e4,
    preBlurRadius: o.preBlurRadius,
    blurRadius: o.blurRadius,
    minBlurRadius: o.minBlurRadius ?? 1,
    maxAccumulatedFrames: o.maxAccumulatedFrames ?? 31,
    fastFrames: o.fastFrames ?? 3,
    historyFixFrames: o.historyFixFrames ?? 3,
    historyFixDepthTolerance: o.historyFixDepthTolerance ?? 0.02,
    historyFixMinWeight: o.historyFixMinWeight ?? 0.25,
    historyFix: o.historyFix ?? 'spatial',   // Dennis q19 (a), 2026-10-26 (was 'mips')
    historyFixRadius: o.historyFixRadius ?? 8,
    historyFixAgeWeight: o.historyFixAgeWeight ?? 0,
    historyFixWideRing: o.historyFixWideRing ?? 0,
    historyFixWideRings: o.historyFixWideRings ?? 1,
    historyFixWideUse: o.historyFixWideUse ?? 'all',
    historyFixMips: o.historyFixMips ?? 'off',
    historyFixYoungThreshold: o.historyFixYoungThreshold ?? 0.9,
    historyFixMipsClamp: o.historyFixMipsClamp ?? 1,
    youngBlurTaps: o.youngBlurTaps ?? 0,
    historyFixDense: Math.min(Math.max(Math.round(o.historyFixDense ?? 4), 0), 7), // 4 + 'mip': default since T1b (rule 9 passed)
    historyFixDenseCap: o.historyFixDenseCap ?? 'mip',
    fireflyThreshold: o.fireflyThreshold ?? 1.5,
    historyAntiLag: o.historyAntiLag ?? (typeof o.antiLag === 'boolean' ? o.antiLag : undefined) ?? true,
    antiLagSigma: o.antiLagSigma ?? 1,
    antiLagExcess: o.antiLagExcess ?? 0.5,
    antiLagHitTolerance: o.antiLagHitTolerance ?? 0.2,
    antiLagCurrentSigma: o.antiLagCurrentSigma ?? 3,
    antiLagCurrentHitTolerance: o.antiLagCurrentHitTolerance ?? 0.05,
    antiLagStandardError: o.antiLagStandardError ?? true,
    stabilizationFrames: o.stabilizationFrames ?? 7,
    planeDistance: o.planeDistance ?? 0.01,
    lobeFraction: o.lobeFraction ?? 0.75,
    specularHistoryScale: o.specularHistoryScale ?? 1,
    preBlurTaps: o.preBlurTaps ?? 0,   // 0 = per-signal default
    blurTaps: o.blurTaps ?? 8,
    postBlurTaps: o.postBlurTaps ?? 4,
    virtualMotion: o.virtualMotion ?? true,
    virtualHitTest: o.virtualHitTest ?? true, // T6: default on (rule 9 passed)
    normalThreshold: o.normalThreshold ?? 0.95, // T6: 0.95 + 'relative' by default (rule 9 passed)
    normalTest: o.normalTest ?? 'relative',
    virtualClampSigma: o.virtualClampSigma ?? 1,
    virtualAngleScale: o.virtualAngleScale ?? 0.5,
    virtualHitTolerance: o.virtualHitTolerance ?? 0.05,
    virtualHitToleranceRoughness: o.virtualHitToleranceRoughness ?? 0.25,
    specularMinRadiusScale: o.specularMinRadiusScale ?? 1,
    remodulate: o.remodulate ?? false,
    timestamps: o.timestamps ?? true,
    skeleton: o.skeleton ?? false,
    f16Rounding: o.f16Rounding ?? 'nearest', // q25 (a); OcclusionDenoiser's recurrent mode pins 'store'
    tune: {
      geoTolLo: 0.02, geoTolHi: 0.005, normalTight: 0.25,
      hitTolLo: 0.1, hitTolHi: 0.5, hitTolTight: 0.5,
      postLo: 0.5, postHi: 2.0, postDelta: 0.3,
      stabGammaLo: 1, stabGammaHi: 3, stabBeta: 0.02,
      virtCurv: 1, virtWiden: 2, detRough: 1, specCentre: 1, elong: 0.75, occClamp: 1, virtHitTestA: 2, virtHitTestB: 1,
      ...o.tune,
    },
  };
}

/** Per-frame inputs of one signal. */
export interface RecurrentFrame {
  /** Radiance (radiance kinds; unused by the occlusion kinds `ao` / `so`). */
  radiance?: GPUTexture;
  /** Hit distance in `.r` (world units, 0 = miss). Optional for diffuse, required for `ao` / `so`. */
  hitDistance?: GPUTexture;
  /** Factor the radiance was divided by (for `remodulate`). */
  demodulation?: GPUTexture;
}

class SignalState {
  params: GPUBuffer;
  buf: GPUTexture[] = [];
  out?: GPUTexture;
  constructor(device: GPUDevice, readonly kind: RecurrentKind, readonly opts: ResolvedRecurrent, readonly label: string) {
    this.params = device.createBuffer({ label: `${label} params`, size: RP_SIZE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  }
  destroyTargets() {
    for (const t of this.buf) t.destroy();
    this.out?.destroy();
    this.buf = [];
    this.out = undefined;
  }
}

function flagsOf(o: ResolvedRecurrent, hasHit: boolean) {
  return (hasHit ? RP_HAS_HIT : 0) | (o.remodulate ? RP_REMODULATE : 0) | (o.historyAntiLag ? 0 : RP_NO_ANTILAG)
    | (o.fireflyThreshold > 0 ? 0 : RP_NO_FIREFLY) | (o.historyFixFrames > 0 ? 0 : RP_NO_HISTORY_FIX)
    | (o.stabilizationFrames > 0 ? 0 : RP_NO_STABILIZE) | (o.virtualMotion ? 0 : RP_NO_VIRTUAL);
}

/** Options that change the pass structure (signals in one pipeline must agree). */
export function recurrentStructuralKey(o: ResolvedRecurrent) {
  const k: (string | boolean)[] = ['recurrent', o.remodulate, o.skeleton];
  if (o.historyFix !== 'mips') k.push(o.historyFix);
  const x = spatialFixOf(o);
  if (o.historyFix === 'spatial' && (x.ageWeight || x.wide || x.mips !== 'off' || x.dense)) k.push(JSON.stringify(x));
  if (o.youngBlurTaps) k.push(`ybt${o.youngBlurTaps}`);
  if (o.f16Rounding !== 'store') k.push(o.f16Rounding);
  if (o.normalThreshold > 0) k.push(`nt${o.normalThreshold}`);
  if (o.normalTest !== 'center') k.push(`ntest-${o.normalTest}`);
  if (o.virtualHitTest) k.push(`vht${o.tune.virtHitTestA},${o.tune.virtHitTestB}`);
  return k.join('|');
}

/** T1b extensions of the 'spatial' history fix (compiled in). */
function spatialFixOf(o: ResolvedRecurrent): SpatialFixConfig {
  return {
    ageWeight: o.historyFixAgeWeight, wide: o.historyFixWideRing, rings: o.historyFixWideRings, wideUse: o.historyFixWideUse,
    mips: o.historyFixMips, clampK: o.historyFixMipsClamp, youngT: o.historyFixYoungThreshold, dense: o.historyFixDense, denseCap: o.historyFixDenseCap,
  };
}

/** Per-signal tap counts are compiled in (each signal of a joint pipeline keeps its own). */
function taps(o: ResolvedRecurrent, k: 'preBlurTaps' | 'blurTaps' | 'postBlurTaps', kind: RecurrentKind) {
  const n = o[k] || (isSpecKind(kind) ? 4 : 8);
  return n <= 4 ? 4 : 8;
}

export const RECURRENT_PASSES = ['pre_blur', 'temporal', 'mips', 'history_fix', 'blur', 'post_blur', 'stabilize'];
/** Dispatches per frame of a recurrent pipeline: no `mips` with historyFix 'spatial', no `pre_blur` for occlusion. */
export function recurrentPassCount(o: ResolvedRecurrent, occlusion = false) {
  return RECURRENT_PASSES.length - (o.historyFix === 'spatial' ? 1 : 0) - (occlusion ? 1 : 0);
}

export class RecurrentPipeline {
  private sigs: SignalState[];
  private layouts: Record<string, GPUBindGroupLayout> = {};
  private pipes: Record<string, GPUComputePipeline> = {};
  private defs: Record<string, PassDef> = {};
  private rframe: GPUBuffer;
  private fast: GPUTexture[] = [];
  private data: GPUTexture[] = [];
  private mipZ?: GPUTexture;
  private rot = [0, 1, 2, 3];   // p, q, r, s
  private cur = 0;              // fast / data ping-pong
  private width = 0;
  private height = 0;
  private frameIndex = 0;
  private opts: ResolvedRecurrent;

  /** Occlusion-only pipeline (kinds `ao` / `so`): no pre-blur pass, temporal reads the raw hit distance. */
  private occ: boolean;
  /** historyFix 'spatial': no mips pass, no depth atlas. */
  private spatialFix = false;

  constructor(private device: GPUDevice, signals: { kind: RecurrentKind; opts: ResolvedRecurrent }[], private label: string) {
    const d = device;
    this.occ = signals.every((s) => isOccKind(s.kind));
    if (!this.occ && signals.some((s) => isOccKind(s.kind))) throw new Error(`${label}: occlusion and radiance signals can't share a recurrent pipeline`);
    if (this.occ && signals[0].opts.remodulate) throw new Error(`${label}: remodulate does not apply to occlusion`);
    this.sigs = signals.map((s) => new SignalState(d, s.kind, s.opts, signals.length > 1 ? `${label} ${s.kind}` : label));
    this.opts = signals[0].opts;
    this.rframe = d.createBuffer({ label: `${label} rframe`, size: RF_SIZE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const kinds = signals.map((s) => s.kind);
    const skel = this.opts.skeleton;
    const make = (name: string, def: PassDef, trivial = skel) => {
      if (trivial) def = trivialPass(def);
      if (this.opts.f16Rounding !== 'store') def = { ...def, code: withF16Rounding(def.code, this.opts.f16Rounding) };
      this.defs[name] = def;
      this.layouts[name] = makeLayout(d, `${label} ${name}`, def.entries.map((e) => e.kind));
      this.pipes[name] = makePipeline(d, `${label} ${name}`, def.code, this.layouts[name]);
    };
    const T = (k: 'preBlurTaps' | 'blurTaps' | 'postBlurTaps') => signals.map((s) => taps(s.opts, k, s.kind));
    if (!this.occ) make('pre_blur', preBlurPass(kinds, T('preBlurTaps')));
    const o = this.opts;
    // T6 variants (compiled in only when on; per-signal virtualHitTest, shared geometry test)
    const tv: RecurrentTemporalVariant = {
      ...(o.normalThreshold > 0 ? { normalCos: o.normalThreshold } : {}),
      ...(o.normalTest === 'relative' ? { normalRelative: true } : {}),
      ...(signals.some((s) => s.opts.virtualHitTest) ? { virtualHitTest: { a: o.tune.virtHitTestA, b: o.tune.virtHitTestB } } : {}),
    };
    make('temporal', Object.keys(tv).length ? temporalPass(kinds, tv) : temporalPass(kinds));
    const fx = spatialFixOf(this.opts);
    this.spatialFix = this.opts.historyFix === 'spatial' && fx.mips === 'off';
    if (!this.spatialFix) make('mips', mipsPass(kinds), false);   // no taps: the real pass is its own skeleton
    make('history_fix', historyFixPass(kinds, this.opts.historyFix, fx));
    make('blur', blurPass(kinds, false, T('blurTaps'), this.opts.youngBlurTaps));
    make('post_blur', blurPass(kinds, true, T('postBlurTaps')));
    make('stabilize', stabilizePass(kinds, this.opts.remodulate));
  }

  configure(width: number, height: number) {
    this.width = width;
    this.height = height;
    const d = this.device;
    const tex = (label: string, format: GPUTextureFormat, w = width, h = height, extra = 0) => d.createTexture({
      label: `${this.label} ${label}`, size: [w, h], format, usage: storageTex() | extra,
    });
    for (const s of this.sigs) {
      s.destroyTargets();
      s.buf = [0, 1, 2, 3].map((i) => tex(`${s.kind} buffer ${i}`, formatOf(s.kind), width, height, GPUTextureUsage.COPY_SRC));
      if (this.opts.remodulate) s.out = tex(`${s.kind} output`, 'rgba16float', width, height, GPUTextureUsage.COPY_SRC);
      this.writeParams(s);
    }
    for (const t of [...this.fast, ...this.data]) t.destroy();
    this.mipZ?.destroy();
    this.fast = [0, 1].map((i) => tex(`fast ${i}`, 'rgba16float'));
    this.data = [0, 1].map((i) => tex(`data ${i}`, 'r32uint'));
    this.mipZ = this.spatialFix ? undefined : tex('depth mips', 'r32float', Math.ceil(width / 2) + Math.ceil(width / 4), Math.ceil(height / 2));
    this.rot = [0, 1, 2, 3];
    this.cur = 0;
  }

  private writeParams(s: SignalState) {
    const o = s.opts;
    const t = o.tune;
    const f = new Float32Array(RP_SIZE / 4);
    const u = new Uint32Array(f.buffer);
    const res = this.height / 1080;
    const pre = o.preBlurRadius ?? (isSpecKind(s.kind) ? 10 : 25);
    // occlusion AO: 20 px (test bed, fast preset: 45 → 20 = +0.23 dB, contact +1.3 dB; T5)
    const blur = o.blurRadius ?? (isSpecKind(s.kind) ? 30 : s.kind === 'ao' ? 20 : 45);
    f.set([
      o.hitDistanceScale, o.hitDistanceViewScale, o.maxRadiance, pre * res,
      blur * res, o.minBlurRadius, o.maxAccumulatedFrames, o.fastFrames,
      o.historyFixFrames, o.historyFixDepthTolerance, o.historyFixMinWeight, o.fireflyThreshold,
      o.antiLagSigma, o.antiLagExcess, o.antiLagHitTolerance, Math.max(o.stabilizationFrames, 0),
      t.stabGammaLo, t.stabGammaHi, t.stabBeta, o.planeDistance,
      t.geoTolLo, t.geoTolHi, t.normalTight, o.lobeFraction,
      t.postLo, t.postHi, t.postDelta, t.hitTolLo,
      t.hitTolHi, t.hitTolTight, o.specularHistoryScale,
    ]);
    u[31] = flagsOf(o, false);
    f[32] = o.antiLagCurrentSigma; f[33] = o.antiLagCurrentHitTolerance; f[34] = o.antiLagStandardError ? 1 : 0;
    f[35] = o.virtualClampSigma; f[36] = o.virtualAngleScale; f[37] = o.virtualHitTolerance; f[38] = o.virtualHitToleranceRoughness;
    f[39] = o.specularMinRadiusScale;
    f[40] = t.virtCurv; f[41] = t.virtWiden; f[42] = t.detRough; f[43] = t.specCentre;
    f[44] = t.elong; f[45] = t.occClamp;
    f[46] = o.historyFixRadius;   // RParams.pad7: 'spatial' history-fix radius (unused by 'mips')
    this.hitFlags.delete(s);
    this.device.queue.writeBuffer(s.params, 0, f);
  }

  private writeFrame(projection: ArrayLike<number>, prevProjection: ArrayLike<number>) {
    const f = new Float32Array(RF_SIZE / 4);
    const P = projection;
    for (let i = 0; i < 16; i++) f[i] = P[i];
    const ortho = P[15] === 1;
    f.set([1 / P[0], 1 / P[5], P[8], P[9]], 16);
    f.set([P[12], P[13], ortho ? 1 : 0, 2 / (P[5] * this.height)], 20);
    f[24] = (this.frameIndex * 0.6180339887) % 1;
    for (let i = 0; i < 16; i++) f[28 + i] = prevProjection[i];
    f.set([1 / prevProjection[0], 1 / prevProjection[5], prevProjection[8], prevProjection[9]], 44);
    this.device.queue.writeBuffer(this.rframe, 0, f);
  }

  /** Output of the last frame per signal (rgb = denoised, a = denoised normalized hit distance; occlusion kinds: ĥ in .r). */
  get outputs(): (GPUTexture | undefined)[] {
    // after endFrame(), last frame's S lives in q
    return this.sigs.map((s) => s.out ?? s.buf[this.rot[1]]);
  }

  /** @internal Debug textures of the last frame: 'acc' (temporal output, rgb + ĥ), 'history' (post-blur H). */
  debugTexture(name: 'acc' | 'history', signal = 0): GPUTexture | undefined {
    const s = this.sigs[signal];
    return s?.buf[name === 'acc' ? this.rot[3] : this.rot[0]];
  }

  /** @internal Packed A / data texture of the last frame (r32uint). */
  get dataTexture(): GPUTexture | undefined { return this.data[this.cur ^ 1]; }

  private group(name: string, res: Record<string, Res>): GPUBindGroup {
    return makeBindGroup(this.device, this.layouts[name], this.defs[name].entries.map((e) => {
      const r = res[e.name];
      if (!r) throw new Error(`${this.label}: no resource for binding '${e.name}' of ${name}`);
      return r;
    }));
  }

  encode(enc: GPUCommandEncoder, timer: PassTimer | undefined, gp: GuidePass, frames: RecurrentFrame[],
    motion: GPUTexture, motionZ: GPUTexture | undefined, projection: ArrayLike<number>, prevProjection: ArrayLike<number>,
    prefix: string) {
    this.sigs.forEach((s, i) => {
      if (isOccKind(s.kind) && !frames[i].hitDistance) throw new Error(`${s.label}: occlusion needs inputs.hitDistance`);
      if (!isOccKind(s.kind) && !frames[i].radiance) throw new Error(`${s.label}: needs inputs.radiance`);
      if (s.opts.remodulate && !frames[i].demodulation) {
        throw new Error(`${s.label}: remodulate needs inputs.demodulation${s.kind === 'diffuse' ? ' (or guides.albedo)' : ''}`);
      }
      this.setHitFlag(s, !!frames[i].hitDistance);
    });
    this.writeFrame(projection, prevProjection);
    const W = this.width, H = this.height;
    const gx = Math.ceil(W / 8), gy = Math.ceil(H / 8);
    const name = (n: string) => prefix + n;
    const [p, q, r, s] = this.rot;
    const c = this.cur;
    const shared: Record<string, Res> = {
      F: gp.frame, RF: this.rframe, geoCur: gp.geoCur, geoPrev: gp.geoPrev,
      motionTex: motion, motionZTex: motionZ ?? gp.dummy, smp: gp.sampler,
    };
    const per = (fn: (sg: SignalState, f: RecurrentFrame) => Record<string, Res>, extra: Record<string, Res> = {}) => {
      const out: Record<string, Res> = { ...shared, ...extra };
      this.sigs.forEach((sg, i) => {
        out[`P${i}`] = sg.params;
        for (const [k, v] of Object.entries(fn(sg, frames[i]))) out[`${k}${i}`] = v;
      });
      return out;
    };
    const run = (n: string, res: Record<string, Res>, x = gx, y = gy) => runPass(enc, timer, name(n), this.pipes[n], this.group(n, res), x, y);

    if (!this.occ) run('pre_blur', per((sg, f) => ({ input: f.radiance!, hit: f.hitDistance ?? gp.dummy, histPrev: sg.buf[p], outPre: sg.buf[r] })));
    // occlusion: temporal normalizes the raw hit distance itself (ĥ is never pre-blurred, GTC20 s.60)
    run('temporal', per((sg, f) => ({ pre: this.occ ? f.hitDistance! : sg.buf[r], histPrev: sg.buf[p], outAcc: sg.buf[s] }),
      { fastPrev: this.fast[c ^ 1], dataPrev: this.data[c ^ 1], outFast: this.fast[c], outData: this.data[c] }));
    if (this.spatialFix) {
      run('history_fix', per((sg) => ({ acc: sg.buf[s], outFix: sg.buf[r] }), { fastCur: this.fast[c], dataRW: this.data[c] }));
    } else {
      run('mips', per((sg) => ({ acc: sg.buf[s], outMip: sg.buf[p] }), { outMipZ: this.mipZ! }), Math.ceil(W / 16), Math.ceil(H / 16));
      // (also the 'spatial' fix with a mip fallback, T1b: historyFixMips)
      run('history_fix', per((sg) => ({ acc: sg.buf[s], mip: sg.buf[p], outFix: sg.buf[r] }),
        { fastCur: this.fast[c], mipZ: this.mipZ!, dataRW: this.data[c] }));
    }
    run('blur', per((sg) => ({ src: sg.buf[r], outBlur: sg.buf[p] }), { dataTex: this.data[c] }));
    run('post_blur', per((sg) => ({ src: sg.buf[p], acc: sg.buf[s], outBlur: sg.buf[r] }), { dataTex: this.data[c] }));
    run('stabilize', per((sg, f) => ({
      hCur: sg.buf[r], sPrev: sg.buf[q], outS: sg.buf[p],
      ...(this.opts.remodulate ? { demod: f.demodulation ?? gp.dummy, outRemod: sg.out! } : {}),
    }), { dataTex: this.data[c] }));
  }

  private hitFlags = new Map<SignalState, boolean>();
  private setHitFlag(s: SignalState, on: boolean) {
    if (this.hitFlags.get(s) === on) return;
    this.hitFlags.set(s, on);
    this.device.queue.writeBuffer(s.params, 31 * 4, new Uint32Array([flagsOf(s.opts, on)]));
  }

  /** Call once per frame after encode(). */
  endFrame() {
    const [p, q, r, s] = this.rot;
    this.rot = [r, p, q, s];
    this.cur ^= 1;
    this.frameIndex++;
  }

  dispose() {
    for (const s of this.sigs) { s.destroyTargets(); s.params.destroy(); }
    for (const t of [...this.fast, ...this.data]) t.destroy();
    this.mipZ?.destroy();
    this.rframe.destroy();
  }
}
