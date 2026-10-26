// ShadowDenoiser: penumbra-aware denoiser for 1-ray (or few-ray) shadow visibility
// (SPEC v0 §7, M4; provisional until the SPEC is reviewed). Sources and pass list in
// shaders/shadow.ts; provenance in docs/research/rt-denoiser/PROVENANCE.md.
//
//   temporal   raw visibility -> history (rgba16float: v, penumbra scale g, A (+ young-frames
//              counter x youngBase), n_g), packed geometry (rg32uint ping-pong; its roughness byte
//              carries the H18 noise estimate E), tile stats; unfiltered copies into T and out
//              (young pixels: mixed with a geometry-weighted 5x5 mean, `youngMean` / `youngFrames`)
//   tiles      3x3 tile neighbourhood: nearest-occluder scale + indirect list of penumbra tiles
//   spatial 0  out copy -> T      (penumbra tiles only)
//   spatial 1  T -> out           (penumbra tiles only)
//   stabilize  out (+ T's 3x3 range) + last frame's final output -> final output (v2.2, option
//              `stabilize`; penumbra tiles only: with it on, the temporal pass writes its unfiltered
//              copy into the final output, the spatial passes run final -> T -> out)
//
// Memory at W x H: history 2 x 8 B + geometry 2 x 8 B + T 4 B + out 4 B = 40 B/px (+ 2 x 4 B
// stabilized ping-pong with `stabilize` > 0, the default: 48 B/px), plus four tile-sized buffers
// (20 B per 8x8 tile: stats 8, nearest occluder 4, list 4, active flag 4).
//
// Translucency (option `translucency`, SPEC v0.3 §7.10, M8; provisional): coloured shadows through
// translucent layers. The opaque visibility v runs through the passes above unchanged (with T = 1 its
// result is bit-identical); a conditional transmittance tau = E[T | v = 1] (rgb) is accumulated over the
// samples that reached the light, filtered with v's taps weighted by v in tiles where the colour
// varies, and the output is rgba16float (v-hat tau-hat, v-hat). Wide path (>= 6 storage textures per
// stage): tau history ping-pong 2 x 8 B + final output ping-pong 2 x 8 B on top of the 48 = 80 B/px;
// the spatial passes' tau scratch reuses last frame's histories. Packed path (4 storage textures): v's
// and tau's histories as 8 f16 in one rgba32uint (2 x 16 B), the final output doubles as v's unfiltered
// copy and stabilization history, two tau scratch textures: 88 B/px.
import type {
  FrameCamera, FrameGuides, ShadowInputs, ShadowLight, TemporalConfig, TemporalDenoiser,
} from '@pmndrs/denoiser-core';
import { invert, isDepthFormat, mat4, PassTimer, type M4 } from './common';
import { withF16Rounding, type F16Rounding } from './f16';
import { storageTex } from './gpu';
import { writeFrameUniform } from './guides';
import { FRAME_SIZE } from './shaders/common';
import {
  SF_ANISO, SF_CATMULL, SF_SNAP, SF_SNAP_CHANGE, SF_HAS_HIT, SF_MERGE_MIN, SF_NOISE, SF_NO_SKIP, SF_SPHERE, SHADOW_STABILIZE_WGSL, SHADOW_TILES_WGSL, SP_SIZE,
  TR_HAS_HIT, TR_HAS_T, TR_OWN_ANTILAG, TR_OWN_GATE, shadowSpatialWgsl, shadowStabilizeTrWgsl, shadowTemporalWgsl, shadowTilesWgsl, type SpatialVariant, type TrVariant,
} from './shaders/shadow';

export interface ShadowDenoiserOptions {
  /** History cap A_cap (frames - 1) of the accumulated visibility. Default 15 (SPEC SH-4). */
  maxHistory?: number;
  /**
   * History cap from the penumbra width in pixels: A_cap(px) = clamp(historyScale x W_px^2,
   * minHistory, maxHistory); 0 = always maxHistory. Default 1.
   */
  historyScale?: number;
  /** Lower bound of that cap. Default 1. */
  minHistory?: number;
  /**
   * Neighbourhood clamp: history kept within the 5x5 raw mean +- clampSigma * sigma + clampFloor.
   * Default 0.4 (about 2 standard errors of the 25-sample mean: with blue-noise samples the
   * 5x5 mean is accurate, and a window of 1 sigma lets moving penumbrae lag).
   */
  clampSigma?: number;
  /** Constant added to the clamp window (keeps penumbra history when all 25 samples agree by chance). Default 0.05. */
  clampFloor?: number;
  /**
   * Clamp window over the 5x5 taps whose normal is within normalAngle of the receiver's only
   * (window x sqrt(25 / n) for n taps), so thin occluders and creases aren't clamped toward the
   * surface next to them (pipeline variant: a shared normal tile, loaded only where the raw
   * samples disagree). Default true (v2.1).
   */
  clampGeometry?: boolean;
  /** clampGeometry: with fewer taps than this passing the normal test (silhouette slivers), the plain 5x5 window. Default 3. */
  clampMinTaps?: number;
  /**
   * Near-hard edges: the clamp window grows by saturate(1 - W_px / clampEdgePx) (up to no clamp)
   * where the pixel's own penumbra width W_px is below this many pixels (0 = off). Default 2 (v2.1).
   */
  clampEdgePx?: number;
  /**
   * Anti-lag gain: history length drops toward 1 frame as the clamp moves the history by 1/antiLagGain
   * (0 = off). Default 64 (any noticeable clamp restarts the history at 1 frame).
   */
  antiLagGain?: number;
  /** @deprecated Old name of `antiLagGain` (still accepted; warns once per instance). */
  antiLag?: number;
  /** Radius factor 1 + freshBoost / (1 + A) for young histories (disocclusions, anti-lag). Default 0. */
  freshBoost?: number;
  /**
   * Fresh pixels (reset / disocclusion): a geometry-weighted 5x5 mean of raw visibility is mixed
   * into the spatial passes' input (the history stays raw) with weight youngMean on the first
   * frame, gated by the penumbra width (pipeline variant; 0 = off). Default 0.75.
   */
  youngMean?: number;
  /**
   * Frames after a reset / disocclusion during which the 5x5 mean keeps a share of the spatial
   * input: weight youngMean x (frames left / youngFrames) / (1 + youngTaper x A). Counted from
   * the first valid history, not shortened by the history cap or anti-lag. 0 = first frame only
   * (v2). Default 8 (v2.1).
   */
  youngFrames?: number;
  /** Decay of that weight with the accumulated history length A (see youngFrames). Default 0.25. */
  youngTaper?: number;
  /** Footprint of the young-history mean: (2 youngRadius + 1)^2 pixels (pipeline variant). Default 2. */
  youngRadius?: number;
  /** Young-history mean only where the pass-0 kernel radius (px, at A = 0) exceeds this; full weight 2 px above. Default 1. */
  youngMinPx?: number;
  /** History length (A) a full anti-lag drops to (0 = this frame only). Default 0. */
  antiLagHistory?: number;
  /** Temporal disocclusion: plane distance relative to view distance. Default 0.01. */
  planeDistance?: number;
  /** Kernel radius = radiusScale x penumbra width W (first pass; the second uses half). Default 0.75. */
  radiusScale?: number;
  /** Radius factor at full history (lerp(1, historyShrink, A / maxHistory)). Default 0.5. */
  historyShrink?: number;
  /** Smallest kernel radius in pixels. Default 1 (our value; M12 Eq. 13 floors its width near one pixel footprint, 1/(k mu Omega_x^max)). */
  minRadius?: number;
  /** Largest kernel axis in pixels at 1080p (scaled with height). Default 48. */
  maxRadius?: number;
  /** History cap of the penumbra-scale estimate (occluded samples). Default 7. */
  maxScaleHistory?: number;
  /** Spatial normal weight (structural: a pipeline variant). Default true. */
  normalWeight?: boolean;
  /** Spatial weights: plane-distance tolerance (relative to view distance) and normal angle (degrees). */
  geometryTolerance?: number;
  normalAngle?: number;
  /** Stretch the kernel along the projected light direction by 1/(n.l), capped (M12 Eq. 12). Default false. */
  anisotropy?: boolean;
  /** Cap of the anisotropic stretch. Default 4. */
  anisotropyMax?: number;
  /**
   * Where all 25 raw samples of the 5x5 window agree, the history takes their value exactly (no
   * residual lag in lit / umbra areas). 'change': only where the history sits outside the clamp
   * window (after a change such as a light flip). Default 'change' (Dennis, SPEC §12 item 5: between true
   * (best FLIP) and false (+0.18 dB pooled) on every metric, results/M4.md §10.5, REMEASURE §4).
   */
  uniformSnap?: boolean | 'change';
  /**
   * With uniformSnap 'change': also snap where the pixel's own penumbra is narrower than this many pixels
   * (results/SHADOWS-LOOK.md: there 'change' keeps a fractional history that is only the resampling blur of
   * the nearby hard edge, and moving cameras soften every hard edge). 0 = off. Default 2 (Dennis, q21 (a),
   * 2026-10-26; rule-9 A/B in results/SHADOWS-LOOK.md).
   */
  snapHardPx?: number;
  /** Catmull-Rom history fetch for visibility where the 2x2 footprint is valid (clamped to it). Default true. */
  catmullRom?: boolean;
  /**
   * Rotation offset of the second spatial pass, in turns. Default 2 - phi = 0.382 (the golden
   * angle): with the per-frame golden-ratio step it never repeats pass 0's angle of this or the
   * next frame (our choice; measured insensitive, results/M4.md "v2").
   */
  pass1Phase?: number;
  /**
   * Per-frame step of the spatial passes' disk rotation, in turns. Default 0.618 (the golden ratio,
   * SPEC D3b); 0 = a fixed per-pixel rotation (no frame-to-frame change of the kernel).
   */
  rotationStep?: number;
  /**
   * Output stabilization (v2.2): weight of this frame's spatial output against a short, reprojected
   * history of the final output clamped to the 3x3 range of this frame's output (0 = off: no pass, no
   * memory). Averages the frame-to-frame noise ("boil") the spatial passes leave in wide, slowly moving
   * penumbrae (results/M4.md "Moving shadows"). Default 0.25; +8 B/px and one pass when on (indirect, over the
   * penumbra tiles only, like the spatial passes).
   */
  stabilize?: number;
  /**
   * Stabilization only where the 3x3 range of the output is below this (fading out up to twice it),
   * at 1080p, scaled by 1080 / height (a penumbra's per-pixel slope scales with resolution). Default 0.05
   * (0.1 at 540p).
   */
  stabilizeBox?: number;
  /** Stabilization anti-lag: blend weight raised to saturate(gain x distance the box moved the history). Default 64 (0 = off). */
  stabilizeAntiLag?: number;
  /** Stabilization anti-lag: blend weight raised to saturate(1 - A / stabilizeYoung) for short temporal histories. Default 0 (off). */
  stabilizeYoung?: number;
  /** Spatial passes: 0, 1 or 2. Default 2. */
  spatialPasses?: number;
  /** Skip tiles without penumbra (TR19 slide 72). Default true. */
  tileSkip?: boolean;
  /** Pixels with their own occluder estimate still take the 3x3-tile minimum ("nearest occluder wins", SPEC SH-3). Default true. */
  mergeMin?: boolean;
  /** Kernel radius in px (at 1080p) on self-shadowing terminators (light partly below the horizon, no occluder distance). Default 16. */
  terminatorRadius?: number;
  /**
   * Noise-driven radius (H18): radius in px (at 1080p) = noiseRadius x E, used alone when there is
   * no hitDistance or light, and blended in by noiseBlend otherwise. Default 32 (v2; M4 tuned 24
   * for the fallback alone, 24..48 measured flat there).
   */
  noiseRadius?: number;
  /**
   * Blend the kernel radius toward the noise-driven one (H18, as in the fallback) by
   * saturate(noiseBlend + noiseYoung / (1 + A)) when the hit-distance radius is used
   * (pipeline variant when either is > 0). Defaults 0.5 (v2), 0.
   */
  noiseBlend?: number;
  noiseYoung?: number;
  /**
   * Cap of the noise-driven radius at noiseCap x the occluder-sized radius before the blend (pipeline variant
   * when > 0; results/SHADOWS-LOOK.md: E is large at any clean hard edge, so near-hard shadows got a
   * several-pixel kernel). 0 = off. Default 0.
   */
  noiseCap?: number;
  /** noiseCap only on settled pixels (no young frames left, see youngFrames): fresh pixels keep the noise radius. Default false. */
  noiseCapSettled?: boolean;
  /**
   * Pixels with the whole light below their horizon (n.l <= -sin of the light's angular radius) and no occluded
   * sample of their own pass their input through instead of taking the terminator radius (pipeline variant;
   * results/SHADOWS-LOOK.md). Default true (Dennis, q21 (a), 2026-10-26).
   */
  backfacePass?: boolean;
  /**
   * Coloured shadows through translucent layers (SPEC v0.3 §7.10, M8; structural). The inputs may then
   * carry `translucency` (rgb transmittance T of the sample, ignored where v = 0; absent = 1) and
   * `translucencyHitDistance` (distance to the nearest translucent layer, 0 = none). Output:
   * rgba16float (v-hat tau-hat rgb, v-hat) instead of r32float v-hat; with T = 1 its alpha is the opaque
   * output exactly (bit-identical before the f16 store). +32 B/px (wide path) or +40 (packed). Default false.
   */
  translucency?: boolean;
  /** Translucency: a lit sample counts as attenuated (feeds the footprint, tau tile bits) when 1 - min_c T > this. Default 0.01. */
  translucencyEpsilon?: number;
  /** Translucency: sample cap n_tau of the conditional transmittance history. Default 7 (as maxScaleHistory). */
  translucencyHistory?: number;
  /** Translucency: tau's neighbourhood clamp window, per channel (as clampSigma / clampFloor for v). Defaults: clampSigma, clampFloor. */
  translucencyClampSigma?: number;
  translucencyClampFloor?: number;
  /**
   * Translucency: the colour's stabilization weight also follows its own 3x3 range (box-width gate) and / or
   * clamp distance (anti-lag), not only v's, so a moving coloured edge over uniform v isn't held back by the
   * output history. 'box' / 'antiLag': only that half. Default 'antiLag' (results/M8.md: the same PSNR as
   * true within 0.05 dB, 3-6 % less boil in static coloured penumbrae; false loses 0.15 dB on a moving panel).
   */
  translucencyOwnGate?: boolean | 'box' | 'antiLag';
  /**
   * Translucency storage path: 'wide' (a separate tau history; needs 6 storage textures per stage), 'packed'
   * (v and tau histories in one rgba32uint, 4 storage textures; v's Catmull-Rom from 16 loads, not
   * bit-identical), 'auto' (wide when the device allows). Default 'auto'.
   */
  translucencyPath?: 'auto' | 'wide' | 'packed';
  /** Light used when the inputs carry none. */
  light?: ShadowLight;
  /** Per-pass GPU timestamps into `gpuTimings`. Default true. */
  timestamps?: boolean;
  /**
   * Rounding of values written to the rgba16float textures (history: v, g, A, n_g; translucency): 'store'
   * (default) leaves it to the platform (Metal truncates toward zero), 'nearest' rounds to nearest-even
   * before every store (src/f16.ts; diagnostic / candidate option, results/DISTANCE-LONG.md).
   */
  f16Rounding?: F16Rounding;
}

type Resolved = Required<Omit<ShadowDenoiserOptions, 'light' | 'antiLag'>> & { light?: ShadowLight };

export function resolveShadowOptions(o: ShadowDenoiserOptions = {}): Resolved {
  return {
    maxHistory: o.maxHistory ?? 15,
    historyScale: o.historyScale ?? 1,
    minHistory: o.minHistory ?? 1,
    clampSigma: o.clampSigma ?? 0.4,
    clampFloor: o.clampFloor ?? 0.05,
    clampGeometry: o.clampGeometry ?? true,
    clampMinTaps: o.clampMinTaps ?? 3,
    clampEdgePx: o.clampEdgePx ?? 2,
    antiLagGain: o.antiLagGain ?? o.antiLag ?? 64,
    antiLagHistory: o.antiLagHistory ?? 0,
    freshBoost: o.freshBoost ?? 0,
    youngMean: o.youngMean ?? 0.75,
    youngMinPx: o.youngMinPx ?? 1,
    youngFrames: Math.max(0, Math.min(15, Math.round(o.youngFrames ?? 8))),
    youngTaper: o.youngTaper ?? 0.25,
    youngRadius: Math.max(1, Math.min(4, Math.round(o.youngRadius ?? 2))),
    pass1Phase: o.pass1Phase ?? 0.3819660113,
    rotationStep: o.rotationStep ?? 0.6180339887,
    stabilize: o.stabilize ?? 0.25,
    stabilizeBox: o.stabilizeBox ?? 0.05,
    stabilizeAntiLag: o.stabilizeAntiLag ?? 64,
    stabilizeYoung: o.stabilizeYoung ?? 0,
    planeDistance: o.planeDistance ?? 0.01,
    radiusScale: o.radiusScale ?? 0.75,
    historyShrink: o.historyShrink ?? 0.5,
    minRadius: o.minRadius ?? 1,
    maxRadius: o.maxRadius ?? 48,
    maxScaleHistory: o.maxScaleHistory ?? 7,
    geometryTolerance: o.geometryTolerance ?? 0.02,
    normalAngle: o.normalAngle ?? 30,
    normalWeight: o.normalWeight ?? true,
    anisotropy: o.anisotropy ?? false,
    anisotropyMax: o.anisotropyMax ?? 4,
    catmullRom: o.catmullRom ?? true,
    uniformSnap: o.uniformSnap ?? 'change',
    snapHardPx: o.snapHardPx ?? 2,
    spatialPasses: Math.max(0, Math.min(2, Math.round(o.spatialPasses ?? 2))),
    tileSkip: o.tileSkip ?? true,
    mergeMin: o.mergeMin ?? true,
    noiseRadius: o.noiseRadius ?? 32,
    noiseBlend: o.noiseBlend ?? 0.5,
    noiseYoung: o.noiseYoung ?? 0,
    noiseCap: o.noiseCap ?? 0,
    noiseCapSettled: o.noiseCapSettled ?? false,
    backfacePass: o.backfacePass ?? true,
    terminatorRadius: o.terminatorRadius ?? 16,
    translucency: o.translucency ?? false,
    translucencyEpsilon: o.translucencyEpsilon ?? 0.01,
    translucencyHistory: o.translucencyHistory ?? 7,
    translucencyClampSigma: o.translucencyClampSigma ?? o.clampSigma ?? 0.4,
    translucencyClampFloor: o.translucencyClampFloor ?? o.clampFloor ?? 0.05,
    translucencyOwnGate: o.translucencyOwnGate ?? 'antiLag',
    translucencyPath: o.translucencyPath ?? 'auto',
    timestamps: o.timestamps ?? true,
    f16Rounding: o.f16Rounding ?? 'store',
    ...(o.light ? { light: o.light } : {}),
  };
}

/** Layout entry kinds used here (gpu.ts's set plus storage buffers). */
type Kind = 'u' | 'f' | 'F' | 's' | 'i' | 'd' | 'sb' | 'sbr' | GPUTextureFormat;

function layout(device: GPUDevice, label: string, kinds: (Kind | null)[]): GPUBindGroupLayout {
  const C = GPUShaderStage.COMPUTE;
  return device.createBindGroupLayout({
    label,
    entries: kinds.map((k, binding) => [k, binding] as const).filter((e): e is readonly [Kind, number] => e[0] !== null).map(([k, binding]): GPUBindGroupLayoutEntry => {
      switch (k) {
        case 'u': return { binding, visibility: C, buffer: { type: 'uniform' } };
        case 'f': return { binding, visibility: C, texture: { sampleType: 'unfilterable-float' } };
        case 'F': return { binding, visibility: C, texture: { sampleType: 'float' } };
        case 's': return { binding, visibility: C, sampler: { type: 'filtering' } };
        case 'i': return { binding, visibility: C, texture: { sampleType: 'uint' } };
        case 'd': return { binding, visibility: C, texture: { sampleType: 'depth' } };
        case 'sb': return { binding, visibility: C, buffer: { type: 'storage' } };
        case 'sbr': return { binding, visibility: C, buffer: { type: 'read-only-storage' } };
        default: return { binding, visibility: C, storageTexture: { access: 'write-only', format: k } };
      }
    }),
  });
}

type Res = GPUBuffer | GPUTexture | GPUTextureView | GPUSampler;
function group(device: GPUDevice, l: GPUBindGroupLayout, res: (Res | null)[]): GPUBindGroup {
  return device.createBindGroup({
    layout: l,
    entries: res.map((r, binding) => [r, binding] as const).filter((e): e is readonly [Res, number] => e[0] !== null).map(([r, binding]): GPUBindGroupEntry => {
      if (r instanceof GPUBuffer) return { binding, resource: { buffer: r } };
      if (r instanceof GPUTexture) return { binding, resource: r.createView() };
      return { binding, resource: r };
    }),
  });
}

function pipeline(device: GPUDevice, label: string, code: string, l: GPUBindGroupLayout): GPUComputePipeline {
  return device.createComputePipeline({
    label,
    layout: device.createPipelineLayout({ label, bindGroupLayouts: [l] }),
    compute: { module: device.createShaderModule({ label, code }), entryPoint: 'main' },
  });
}

/** Mirror of WGSL unprojectZ (shaders/common.ts). */
function unprojectZ(projInv: M4, ndc: [number, number], vz: number): [number, number, number] {
  const tr = (z: number) => {
    const x = projInv[0] * ndc[0] + projInv[4] * ndc[1] + projInv[8] * z + projInv[12];
    const y = projInv[1] * ndc[0] + projInv[5] * ndc[1] + projInv[9] * z + projInv[13];
    const zz = projInv[2] * ndc[0] + projInv[6] * ndc[1] + projInv[10] * z + projInv[14];
    const w = projInv[3] * ndc[0] + projInv[7] * ndc[1] + projInv[11] * z + projInv[15];
    return [x / w, y / w, zz / w];
  };
  const a = tr(0.3), b = tr(0.6);
  const t = (vz - a[2]) / (b[2] - a[2]);
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

const PASSES = ['temporal', 'tiles', 'spatial0', 'spatial1', 'stabilize'] as const;

/** Storage textures the translucency wide path's temporal pass writes (geometry, two histories, two copies, output). */
const WIDE_STORAGE = 6;

export class ShadowDenoiser implements TemporalDenoiser<ShadowInputs> {
  readonly name = 'shadows';
  readonly device: GPUDevice;
  readonly options: Readonly<Resolved>;
  /** Translucency pipeline variant (undefined: opaque only). */
  readonly translucency?: Readonly<TrVariant>;
  private timer?: PassTimer;
  private width = 0;
  private height = 0;
  private tilesX = 0;
  private tilesY = 0;
  private frameIndex = 0;
  private withE = false;
  private needsReset = true;
  private cur = 0;

  private frame: GPUBuffer;
  private params: GPUBuffer;
  private dummy: GPUTexture;
  private sampler: GPUSampler;
  private layouts: Record<'temporalDepth' | 'temporalFloat' | 'tiles' | 'spatial' | 'stabilize', GPUBindGroupLayout>;
  private stabPipe?: GPUComputePipeline;
  private stab: GPUTexture[] = [];
  private pipes: Partial<Record<'temporalDepth' | 'temporalFloat', GPUComputePipeline>> = {};
  private tilesPipe: GPUComputePipeline;
  private spatialPipes: GPUComputePipeline[];
  // translucency: the tau tiles' passes (the v-only tiles run spatialPipes / lastPipe over `list`)
  private spatialTauPipes: GPUComputePipeline[] = [];
  private spatialVLayout?: GPUBindGroupLayout;
  private lastTauPipe?: GPUComputePipeline;
  private listTau?: GPUBuffer;

  private geo: GPUTexture[] = [];
  private hist: GPUTexture[] = [];
  private tTex?: GPUTexture;
  private out?: GPUTexture;
  private tileStats?: GPUBuffer;
  private tileMinG?: GPUBuffer;
  private args?: GPUBuffer;
  private list?: GPUBuffer;
  private activeTile?: GPUBuffer;
  // translucency
  private lastPipe?: GPUComputePipeline;   // stabilize (or compose) with the colour
  private trHist: GPUTexture[] = [];        // wide: tau history ping-pong (tau rgb, n_tau)
  private fOut: GPUTexture[] = [];          // final output (S rgb, v): ping-pong with stabilization
  private trT?: GPUTexture;                 // packed: tau scratch of the spatial passes
  private trOut?: GPUTexture;
  private visResult?: GPUTexture;

  constructor(device: GPUDevice, options: ShadowDenoiserOptions = {}) {
    this.device = device;
    this.options = resolveShadowOptions(options);
    if (options.antiLag !== undefined) console.warn('ShadowDenoiser: option `antiLag` is deprecated, use `antiLagGain`');
    const o = this.options;
    if (o.translucency) {
      const wideOk = device.limits.maxStorageTexturesPerShaderStage >= WIDE_STORAGE;
      if (o.translucencyPath === 'wide' && !wideOk) {
        throw new Error(`ShadowDenoiser: translucencyPath 'wide' needs maxStorageTexturesPerShaderStage >= ${WIDE_STORAGE} (device: ${device.limits.maxStorageTexturesPerShaderStage})`);
      }
      const packed = o.translucencyPath === 'packed' || (o.translucencyPath === 'auto' && !wideOk);
      this.translucency = { packed, compose: !(o.stabilize > 0) };
    }
    const tr = this.translucency;
    if (o.timestamps && PassTimer.supported(device)) this.timer = new PassTimer(device, PASSES.length + 3);
    this.frame = device.createBuffer({ label: 'shadows frame', size: FRAME_SIZE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.params = device.createBuffer({ label: 'shadows params', size: SP_SIZE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.dummy = device.createTexture({ label: 'shadows dummy', size: [1, 1], format: 'r32float', usage: GPUTextureUsage.TEXTURE_BINDING });
    this.sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
    const temporalKinds = (depth: Kind): Kind[] => {
      if (tr?.packed) return ['u', 'u', depth, 'f', 'f', 'f', 'f', 'f', 'f', 'i', 'i', 'rg32uint', 'rgba32uint', 'r32float', 'rgba16float', 'sb', 's', 'f', 'f'];
      const k: Kind[] = ['u', 'u', depth, 'f', 'f', 'f', 'f', 'f', 'f', 'i', 'F', 'rg32uint', 'rgba16float', 'r32float', 'r32float', 'sb', 's'];
      return tr ? [...k, 'f', 'f', 'f', 'rgba16float', 'rgba16float'] : k;
    };
    let spatialKinds: Kind[] = ['u', 'u', 'i', 'f', 'f', 'sbr', 'sbr', 'r32float'];
    if (tr) spatialKinds = tr.packed ? ['u', 'u', 'i', 'i', 'f', 'sbr', 'sbr', 'r32float', 'sbr', 'f', 'rgba16float'] : [...spatialKinds, 'sbr', 'f', 'f', 'rgba16float'];
    let stabKinds: (Kind | null)[] = ['u', 'u', 'f', 'f', 'f', 'f', 'f', 'sbr', 'sbr', 'r32float'];
    if (tr?.packed) stabKinds = ['u', 'u', 'f', 'f', 'f', 'f', 'i', 'sbr', 'sbr', 'rgba16float', 'f'];
    else if (tr) stabKinds = ['u', 'u', 'f', 'f', 'f', 'f', 'f', 'sbr', 'sbr', tr.compose ? null : 'r32float', 'f', 'f', tr.compose ? null : 'f', 'rgba16float'];
    this.layouts = {
      temporalDepth: layout(device, 'shadows temporal (depth)', temporalKinds('d')),
      temporalFloat: layout(device, 'shadows temporal (float)', temporalKinds('f')),
      tiles: layout(device, 'shadows tiles', tr ? ['u', 'sbr', 'sb', 'sb', 'sb', 'sb', 'sb'] : ['u', 'sbr', 'sb', 'sb', 'sb', 'sb']),
      spatial: layout(device, 'shadows spatial', spatialKinds),
      stabilize: layout(device, 'shadows stabilize', stabKinds),
    };
    if (tr) {
      if (o.spatialPasses > 0) {
        // compose reads the tile mode at run time; stabilize is specialized per list
        this.lastPipe = this.mkPipe('shadows stabilize (translucency, v tiles)', shadowStabilizeTrWgsl(tr, tr.compose ? true : false), this.layouts.stabilize);
        this.lastTauPipe = tr.compose ? this.lastPipe : this.mkPipe('shadows stabilize (translucency, tau tiles)', shadowStabilizeTrWgsl(tr, true), this.layouts.stabilize);
      }
    } else if (o.stabilize > 0 && o.spatialPasses > 0) {
      this.stabPipe = this.mkPipe('shadows stabilize', SHADOW_STABILIZE_WGSL, this.layouts.stabilize);
    }
    this.withE = o.noiseBlend > 0 || o.noiseYoung > 0;
    const sv: SpatialVariant = { noiseCap: this.withE && o.noiseCap > 0, noiseCapSettled: this.withE && o.noiseCap > 0 && o.noiseCapSettled, backface: o.backfacePass };
    this.tilesPipe = this.mkPipe('shadows tiles', tr ? shadowTilesWgsl(true) : SHADOW_TILES_WGSL, this.layouts.tiles);
    if (tr && !tr.packed) {
      // wide path: the v-only tiles run the opaque denoiser's own spatial passes (same code, same cost)
      this.spatialVLayout = layout(device, 'shadows spatial (v tiles)', ['u', 'u', 'i', 'f', 'f', 'sbr', 'sbr', 'r32float']);
      this.spatialPipes = [0, 1].map((i) => this.mkPipe(`shadows spatial${i}`, shadowSpatialWgsl(i as 0 | 1, o.normalWeight, this.withE, undefined, true, sv), this.spatialVLayout!));
    } else {
      this.spatialPipes = [0, 1].map((i) => this.mkPipe(`shadows spatial${i}`,
        shadowSpatialWgsl(i as 0 | 1, o.normalWeight, this.withE, tr, false, sv), this.layouts.spatial));
    }
    if (tr) {
      this.spatialTauPipes = [0, 1].map((i) => this.mkPipe(`shadows spatial${i} (tau tiles)`,
        shadowSpatialWgsl(i as 0 | 1, o.normalWeight, this.withE, tr, true, sv), this.layouts.spatial));
    }
  }

  /** A compute pipeline of this instance (f16Rounding 'nearest': f16 stores rounded first, src/f16.ts). */
  private mkPipe(label: string, code: string, l: GPUBindGroupLayout): GPUComputePipeline {
    return pipeline(this.device, label, withF16Rounding(code, this.options.f16Rounding), l);
  }

  get gpuTimings(): ReadonlyMap<string, number> | undefined { return this.timer?.timings; }

  /** Bytes per pixel of the textures configure() allocates (tile buffers not included). */
  get bytesPerPixel(): number {
    const tr = this.translucency;
    const stabilized = this.options.stabilize > 0 && this.options.spatialPasses > 0;
    if (!tr) return 40 + (stabilized ? 8 : 0);
    if (tr.packed) return 16 + 32 + 4 + 4 + 8 * (stabilized ? 2 : 1) + 16;
    return 40 + (stabilized ? 8 : 0) + 16 + 8 * (stabilized ? 2 : 1);
  }

  configure({ width, height }: TemporalConfig): void {
    this.destroyTargets();
    const d = this.device;
    const tr = this.translucency;
    this.width = width;
    this.height = height;
    this.tilesX = Math.ceil(width / 8);
    this.tilesY = Math.ceil(height / 8);
    const tex = (label: string, format: GPUTextureFormat) =>
      d.createTexture({ label: `shadows ${label}`, size: [width, height], format, usage: storageTex() });
    this.geo = [0, 1].map((i) => tex(`geometry ${i}`, 'rg32uint'));
    this.hist = [0, 1].map((i) => tex(`history ${i}`, tr?.packed ? 'rgba32uint' : 'rgba16float'));
    this.tTex = tex('T', 'r32float');
    this.out = tex('output', 'r32float');
    if (this.stabPipe || (tr && !tr.packed && !tr.compose && this.lastPipe)) this.stab = [0, 1].map((i) => tex(`stabilized ${i}`, 'r32float'));
    if (tr) {
      const pingPong = !tr.compose && !!this.lastPipe;
      this.fOut = (pingPong ? [0, 1] : [0]).map((i) => tex(`output (translucency) ${i}`, 'rgba16float'));
      if (tr.packed) {
        this.trT = tex('tau T', 'rgba16float');
        this.trOut = tex('tau out', 'rgba16float');
      } else {
        this.trHist = [0, 1].map((i) => tex(`tau history ${i}`, 'rgba16float'));
      }
    }
    const tiles = this.tilesX * this.tilesY;
    this.tileStats = d.createBuffer({ label: 'shadows tile stats', size: tiles * 8, usage: GPUBufferUsage.STORAGE });
    this.tileMinG = d.createBuffer({ label: 'shadows tile scale', size: tiles * 4, usage: GPUBufferUsage.STORAGE });
    this.list = d.createBuffer({ label: 'shadows tile list', size: tiles * 4, usage: GPUBufferUsage.STORAGE });
    if (tr) this.listTau = d.createBuffer({ label: 'shadows tau tile list', size: tiles * 4, usage: GPUBufferUsage.STORAGE });
    this.activeTile = d.createBuffer({ label: 'shadows active tiles', size: tiles * 4, usage: GPUBufferUsage.STORAGE });
    this.args = d.createBuffer({
      label: 'shadows indirect args', size: 32,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST,
    });
    d.queue.writeBuffer(this.args, 0, new Uint32Array([0, 1, 1, 0, 0, 1, 1, 0]));
    this.cur = 0;
    this.needsReset = true;
  }

  resetHistory(): void { this.needsReset = true; }

  /**
   * Internal textures for debugging (history: v, g, A, n_g; packed translucency: rgba32uint). 'visibility':
   * the last dispatch's opaque visibility in r32float (with translucency, wide path: exactly what the
   * opaque denoiser returns; packed path: undefined, alpha of the output only).
   */
  debugTexture(name: 'history' | 'geometry' | 'T' | 'visibility' | 'tauHistory'): GPUTexture | undefined {
    if (name === 'history') return this.hist[this.cur ^ 1];
    if (name === 'geometry') return this.geo[this.cur ^ 1];
    if (name === 'visibility') return this.visResult;
    if (name === 'tauHistory') return this.trHist[this.cur ^ 1];
    return this.tTex;
  }

  dispatch(inputs: ShadowInputs, guides: FrameGuides, camera: FrameCamera): GPUTexture {
    if (!this.out) throw new Error('ShadowDenoiser: call configure() first');
    const W = this.width, H = this.height;
    const tr = this.translucency;
    const trIn = tr ? inputs.translucency : undefined;
    const trHitIn = tr ? inputs.translucencyHitDistance : undefined;
    for (const [k, t] of [['visibility', inputs.visibility], ['hitDistance', inputs.hitDistance], ['depth', guides.depth],
      ['normal', guides.normal], ['motion', guides.motion], ['translucency', trIn], ['translucencyHitDistance', trHitIn]] as const) {
      if (t && (t.width !== W || t.height !== H)) throw new Error(`ShadowDenoiser: ${k} is ${t.width}x${t.height}, configured ${W}x${H}`);
    }
    const d = this.device;
    const o = this.options;
    const reset = this.needsReset;
    this.needsReset = false;
    writeFrameUniform(d, this.frame, W, H, this.frameIndex++, guides, camera, reset);
    this.writeParams(inputs, camera);

    const enc = d.createCommandEncoder({ label: 'shadows' });
    this.timer?.begin();
    const cur = this.cur, prev = cur ^ 1;
    const kind = isDepthFormat(guides.depth.format) ? 'temporalDepth' : 'temporalFloat';
    const tp = this.pipes[kind] ??= this.mkPipe(`shadows ${kind}`, shadowTemporalWgsl(kind === 'temporalDepth', o.youngMean > 0, o.youngRadius, this.withE, o.clampGeometry, tr), this.layouts[kind]);
    const depthView = kind === 'temporalDepth' ? guides.depth.createView({ aspect: 'depth-only' }) : guides.depth.createView();
    const pass = (name: string, p: GPUComputePipeline, g: GPUBindGroup, x: number, y = 1, indirect = false, argsOffset = 0) => {
      const cp = enc.beginComputePass({ label: `shadows ${name}`, timestampWrites: this.timer?.pass(name) });
      cp.setPipeline(p);
      cp.setBindGroup(0, g);
      if (indirect) cp.dispatchWorkgroupsIndirect(this.args!, argsOffset);
      else cp.dispatchWorkgroups(x, y);
      cp.end();
    };
    // translucency textures: final output index, the wide path's tau scratch (last frame's histories)
    const fi = this.fOut.length === 2 ? cur : 0;
    const fCur = this.fOut[fi];
    const trT = tr ? (tr.packed ? this.trT! : this.hist[prev]) : undefined;
    const trOut = tr ? (tr.packed ? this.trOut! : this.trHist[prev]) : undefined;
    // the unfiltered copy that becomes the final output where nothing filters (and pass 0's input)
    const vOut = this.stab.length ? this.stab[cur] : this.out;
    const common: Res[] = [
      this.frame, this.params, depthView, guides.viewZ ?? this.dummy, guides.normal, guides.motion,
      guides.motionZ ?? this.dummy, inputs.visibility, inputs.hitDistance ?? this.dummy,
      this.geo[prev], this.hist[prev], this.geo[cur], this.hist[cur], this.tTex!,
    ];
    let temporalRes: Res[];
    if (!tr) {
      // with stabilization the unfiltered copy goes straight into the final output (kept in non-penumbra tiles)
      temporalRes = [...common, vOut, this.tileStats!, this.sampler];
    } else if (tr.packed) {
      temporalRes = [...common, fCur, this.tileStats!, this.sampler, trIn ?? this.dummy, trHitIn ?? this.dummy];
    } else {
      temporalRes = [...common, vOut, this.tileStats!, this.sampler, trIn ?? this.dummy, trHitIn ?? this.dummy,
        this.trHist[prev], this.trHist[cur], fCur];
    }
    pass('temporal', tp, group(d, this.layouts[kind], temporalRes), this.tilesX, this.tilesY);
    if (o.spatialPasses > 0) {
      enc.clearBuffer(this.args!, 0, 4);
      if (tr) enc.clearBuffer(this.args!, 16, 4);
      pass('tiles', this.tilesPipe, group(d, this.layouts.tiles, [this.params, this.tileStats!, this.tileMinG!, this.args!, this.list!, this.activeTile!, ...(tr ? [this.listTau!] : [])]),
        Math.ceil(this.tilesX / 8), Math.ceil(this.tilesY / 8));
      const src = [tr?.packed ? fCur : vOut, this.tTex!];
      const dst = o.spatialPasses === 1 ? [this.out] : [this.tTex!, this.out];
      const trSrc = tr ? [tr.packed ? this.dummy : this.trHist[cur], trT!] : [];
      const trDst = tr ? (o.spatialPasses === 1 ? [trOut!] : [trT!, trOut!]) : [];
      for (let i = 0; i < o.spatialPasses; i++) {
        const res = (list: GPUBuffer): Res[] => {
          const r: Res[] = [this.frame, this.params, this.geo[cur], this.hist[cur], src[i], this.tileMinG!, list, dst[i]!];
          if (tr) r.push(this.activeTile!, trSrc[i], ...(tr.packed ? [] : [this.trHist[cur]]), trDst[i]);
          return r;
        };
        if (!tr) {
          pass(`spatial${i}`, this.spatialPipes[i], group(d, this.layouts.spatial, res(this.list!)), 0, 1, true);
        } else {
          // v-only tiles (wide path: the opaque passes and bindings exactly), then the tau tiles
          const vRes = tr.packed ? res(this.list!) : res(this.list!).slice(0, 8);
          pass(`spatial${i}`, this.spatialPipes[i], group(d, this.spatialVLayout ?? this.layouts.spatial, vRes), 0, 1, true, 0);
          pass(`spatial${i} tau`, this.spatialTauPipes[i], group(d, this.layouts.spatial, res(this.listTau!)), 0, 1, true, 16);
        }
      }
    }
    let result = this.out;
    if (this.stabPipe) {
      result = this.stab[cur];
      pass('stabilize', this.stabPipe, group(d, this.layouts.stabilize, [
        this.frame, this.params, this.out, this.tTex!, this.stab[prev], guides.motion, this.hist[cur], this.list!, this.activeTile!, result,
      ]), 0, 1, true);
    }
    this.visResult = this.stab.length ? this.stab[cur] : this.out;
    if (tr) {
      if (this.lastPipe) {
        const fPrev = this.fOut.length === 2 ? this.fOut[prev] : this.dummy;
        const res = (list: GPUBuffer): (Res | null)[] => (tr.packed
          ? [this.frame, this.params, this.out!, this.tTex!, tr.compose ? this.dummy : fPrev, guides.motion, this.hist[cur], list, this.activeTile!, fCur, trOut!]
          : [this.frame, this.params, this.out!, this.tTex!, tr.compose ? this.dummy : this.stab[prev], guides.motion, this.hist[cur], list, this.activeTile!,
            tr.compose ? null : this.stab[cur], this.trHist[cur], trOut!, tr.compose ? null : fPrev, fCur]);
        pass('stabilize', this.lastPipe, group(d, this.layouts.stabilize, res(this.list!)), 0, 1, true, 0);
        pass('stabilize tau', this.lastTauPipe!, group(d, this.layouts.stabilize, res(this.listTau!)), 0, 1, true, 16);
      }
      result = fCur;
      if (tr.packed) this.visResult = undefined;
    }
    const after = this.timer?.end(enc);
    d.queue.submit([enc.finish()]);
    after?.();
    this.cur ^= 1;
    return result;
  }

  private writeParams(inputs: ShadowInputs, camera: FrameCamera) {
    const o = this.options;
    const W = this.width, H = this.height;
    const P = mat4(camera.projection);
    const Pinv = invert(P);
    const f = new Float32Array(SP_SIZE / 4);
    const u = new Uint32Array(f.buffer);
    f.set(P, 0);
    // X(q, z) = A(q) + z B(q), A and B affine in the pixel position q (current and previous projection)
    const sub = (a: number[], b: number[]) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const affine = (inv: M4) => {
      const X = (qx: number, qy: number, z: number) => unprojectZ(inv, [2 * qx / W - 1, 1 - 2 * qy / H], -z);
      const B0 = sub(X(0, 0, 2), X(0, 0, 1)), A0 = sub(X(0, 0, 1), B0);
      const B1x = sub(X(1, 0, 2), X(1, 0, 1)), A1x = sub(X(1, 0, 1), B1x);
      const B1y = sub(X(0, 1, 2), X(0, 1, 1)), A1y = sub(X(0, 1, 1), B1y);
      return [A0, sub(A1x, A0), sub(A1y, A0), B0, sub(B1x, B0), sub(B1y, B0)];
    };
    const [A0, Ax, Ay, B0, Bx, By] = affine(Pinv);
    const prevCo = affine(invert(mat4(camera.prevProjection)));
    prevCo.forEach((v, i) => f.set(v, 64 + 4 * i));
    f[71] = o.noiseBlend;
    f[75] = o.noiseYoung;
    // young-frames counter in the history's A channel above youngBase (> A's range, f16-exact)
    const youngBase = Math.max(32, 2 ** Math.ceil(Math.log2(o.maxHistory + 2)));
    f[67] = o.youngMean > 0 ? Math.min(o.youngFrames, Math.floor(512 / youngBase)) : 0;
    f[79] = o.youngTaper;
    f[87] = youngBase;
    f[88] = o.clampMinTaps;
    f[89] = o.clampEdgePx;
    f[90] = o.rotationStep;
    f[91] = o.stabilize;
    f[92] = o.stabilizeBox * 1080 / H;
    f[93] = o.stabilizeAntiLag;
    f[94] = o.stabilizeYoung;
    f[95] = o.noiseCap;
    f[96] = o.snapHardPx;
    f[83] = o.pass1Phase;
    const light = inputs.light ?? o.light;
    const noise = !inputs.hitDistance || !light;
    let lightSize = 0, lightVec: readonly number[] = [0, 0, 0];
    if (light?.type === 'sphere') { lightSize = light.radius; lightVec = light.position; }
    else if (light?.type === 'directional') { lightSize = Math.tan(light.angularRadius); lightVec = light.direction; }
    f.set(A0, 16); f[19] = lightSize;
    f.set(Ax, 20); f[23] = o.maxHistory;
    f.set(Ay, 24); f[27] = o.clampSigma;
    f.set(B0, 28); f[31] = o.clampFloor;
    f.set(Bx, 32); f[35] = o.planeDistance;
    f.set(By, 36); f[39] = o.radiusScale;
    f.set(lightVec, 40); f[43] = o.antiLagGain;
    const ortho = P[15] === 1;
    f[44] = ortho ? 0 : 2 / (P[5] * H);
    f[45] = ortho ? 2 / (P[5] * H) : 0;
    f[46] = o.minRadius;
    f[47] = o.maxRadius * H / 1080;
    u[48] = (light?.type === 'sphere' ? SF_SPHERE : 0) | (noise ? SF_NOISE : 0) | (o.anisotropy ? SF_ANISO : 0)
      | (o.tileSkip ? 0 : SF_NO_SKIP) | (o.mergeMin ? SF_MERGE_MIN : 0) | (inputs.hitDistance ? SF_HAS_HIT : 0) | (o.catmullRom ? SF_CATMULL : 0) | (o.uniformSnap ? SF_SNAP : 0)
      | (o.uniformSnap === 'change' ? SF_SNAP_CHANGE : 0);
    f[49] = o.maxScaleHistory;
    f[50] = o.geometryTolerance;
    f[51] = Math.cos(o.normalAngle * Math.PI / 180);
    f[52] = o.noiseRadius * H / 1080;
    f[53] = o.anisotropyMax;
    u[54] = this.tilesX;
    u[55] = this.tilesY;
    f[56] = o.antiLagHistory;
    f[57] = o.freshBoost;
    f[58] = o.youngMean;
    f[59] = o.youngMinPx;
    f[60] = o.terminatorRadius * H / 1080;
    f[61] = o.historyScale;
    f[62] = o.minHistory;
    f[63] = o.historyShrink;
    if (this.translucency) {
      f[100] = o.translucencyEpsilon;
      f[101] = o.translucencyHistory;
      // the translucent hit distance sizes footprints like h does, so it needs a light too
      u[102] = (inputs.translucency ? TR_HAS_T : 0) | (inputs.translucencyHitDistance && light ? TR_HAS_HIT : 0)
        | (o.translucencyOwnGate === true || o.translucencyOwnGate === 'box' ? TR_OWN_GATE : 0)
        | (o.translucencyOwnGate === true || o.translucencyOwnGate === 'antiLag' ? TR_OWN_ANTILAG : 0);
      f[103] = o.translucencyClampSigma;
      f[104] = o.translucencyClampFloor;
    }
    this.device.queue.writeBuffer(this.params, 0, f);
  }

  private destroyTargets() {
    for (const t of [...this.geo, ...this.hist, ...this.stab, ...this.trHist, ...this.fOut, this.tTex, this.out, this.trT, this.trOut]) t?.destroy();
    this.stab = [];
    this.trHist = [];
    this.fOut = [];
    for (const b of [this.tileStats, this.tileMinG, this.args, this.list, this.listTau, this.activeTile]) b?.destroy();
    this.geo = [];
    this.hist = [];
    this.tTex = this.out = this.trT = this.trOut = this.visResult = undefined;
    this.tileStats = this.tileMinG = this.args = this.list = this.listTau = this.activeTile = undefined;
  }

  dispose(): void {
    this.destroyTargets();
    this.frame.destroy();
    this.params.destroy();
    this.dummy.destroy();
    this.timer?.destroy();
  }
}
