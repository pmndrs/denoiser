// OcclusionDenoiser: ambient occlusion (AO, diffuse rays) and specular occlusion (SO,
// specular rays) from the normalized hit distance ĥ = h / (h + a + b·depth) of the
// renderer's 1-spp rays (SPEC F-3, §8; "normalized hit distance = AO / SO": Zhdan, GTC 2020
// s.9). Experimental (M5, SPEC §8). Default filter 'svgf' since 2026-10-25 (SPEC §12 item 1:
// SVGF beat the recurrent mode on every test-bed path for AO and SO, and on the real scene).
//
//   filter 'svgf' (default)       SVGF (Schied et al. 2017) on ĥ written as a gray image
//                                 (src/svgf.ts unchanged; its luminance is ĥ); antiLag inherits
//                                 SVGF's default 'auto' (SPEC §12 item 2; 'off' is cheaper)
//   filter 'recurrent'            the recurrent pipeline's occlusion-only mode (SPEC O-2;
//                                 the memory-lean option): the same passes as the radiance
//                                 filter with the radiance channels dropped, one r32float per
//                                 signal, no pre-blur (ĥ is never pre-blurred, GTC20 s.60),
//                                 anti-lag from the ĥ detectors only (src/recurrent.ts, kinds `ao` / `so`)
//
// Output: ĥ in `.r` (recurrent: r32float; svgf: rgba16float gray). 1 = open, → 0 at
// contact; the falloff is 1 / (1 + h / (a + b·depth)) (SPEC F-3, §12 item 6).
import type { FrameCamera, FrameGuides, TemporalConfig, TemporalDenoiser } from '@pmndrs/denoiser-core';
import { PassTimer } from './common';
import { makeBindGroup, makeLayout, makePipeline, runPass, storageTex } from './gpu';
import { GuidePass } from './guides';
import {
  recurrentPassCount, RecurrentPipeline, resolveRecurrent, usesDeprecatedAntiLag, warnDeprecatedAntiLag, type RecurrentOptions,
  type ResolvedRecurrent,
} from './recurrent';
import { normalizeHitWgsl, OCC_NORM_SIZE } from './shaders/occlusion';
import { resolveOptions, SvgfPipeline, type ResolvedOptions, type SpecularSvgfOptions } from './svgf';

/** Per-frame input of one occlusion signal. */
export interface OcclusionInputs {
  /** Hit distance of this frame's 1-spp ray in `.r` (world units, primary segment excluded, 0 = miss). */
  hitDistance: GPUTexture;
}

export interface OcclusionBothInputs {
  diffuse: OcclusionInputs;
  specular: OcclusionInputs;
}

export interface OcclusionOutputs {
  diffuse: GPUTexture;
  specular: GPUTexture;
}

interface OcclusionCommon {
  /** Which rays: 'diffuse' = AO (default), 'specular' = SO (needs guides.roughness), 'both' (use dispatchBoth). */
  signal?: 'diffuse' | 'specular' | 'both';
  /** ĥ = h / (h + a + b·depth): a in world units (SPEC F-3; the AO radius). Default 1. */
  hitDistanceScale?: number;
  /** b, per unit of view depth. Default 0.05 (0 = a world-space AO radius, SPEC O-3). */
  hitDistanceViewScale?: number;
  /** Per-pass GPU timestamps into `gpuTimings` when supported. Default true. */
  timestamps?: boolean;
}

/** Recurrent occlusion-only mode: every RecurrentOptions key except radiance-only ones applies. */
export type OcclusionRecurrentOptions = OcclusionCommon & { filter: 'recurrent' }
  & Partial<Omit<RecurrentOptions, 'filter' | 'remodulate' | 'maxRadiance' | 'preBlurRadius' | 'preBlurTaps' | 'fireflyThreshold'>>;
/** SVGF on ĥ (luminance = ĥ); the default filter. */
export type OcclusionSvgfOptions = OcclusionCommon & { filter?: 'svgf' } & Omit<SpecularSvgfOptions, 'remodulate' | 'filter'>;
export type OcclusionDenoiserOptions = OcclusionRecurrentOptions | OcclusionSvgfOptions;

type Kind = 'diffuse' | 'specular';

/** Resolved options: the filter's own plus the curve. */
export type ResolvedOcclusion = { filter: 'recurrent'; signals: Kind[]; o: ResolvedRecurrent }
  | { filter: 'svgf'; signals: Kind[]; o: ResolvedOptions; perSignal: ResolvedOptions[]; hitDistanceScale: number; hitDistanceViewScale: number };

/** The curve's defaults (SPEC F-3), shared by OcclusionDenoiser and HitDistanceNormalizer. */
const DEFAULT_A = 1;
const DEFAULT_B = 0.05;

function resolveOcclusion(options: OcclusionDenoiserOptions): ResolvedOcclusion {
  const { signal = 'diffuse', filter = 'svgf', ...rest } = options as OcclusionCommon & { filter?: string };
  const signals: Kind[] = signal === 'both' ? ['diffuse', 'specular'] : [signal];
  if (filter === 'recurrent') {
    const r = rest as Partial<RecurrentOptions>;
    // occlusion defaults (test bed, T5): minimum blur radius 2 px (radiance: 1)
    return { filter, signals, o: resolveRecurrent({ ...r, minBlurRadius: r.minBlurRadius ?? 2, remodulate: false }) };
  }
  if (filter !== 'svgf') throw new Error(`OcclusionDenoiser: unknown filter '${filter}'`);
  const { hitDistanceScale = DEFAULT_A, hitDistanceViewScale = DEFAULT_B, ...svgf } = rest as OcclusionCommon & SpecularSvgfOptions;
  // occlusion defaults (test bed, fast preset, 7 paths; T5 / results/M5.md): a tighter luminance
  // weight and 3 à-trous iterations (AO 36.12 -> 37.93 dB, SO 34.78 -> 36.24 vs the radiance
  // defaults 4 / 5), and a shorter SO history (temporalAlpha 0.3: SO +0.9 dB; AO prefers the default).
  // antiLag inherits SVGF's default 'auto': 'off' was tried as the occlusion default and reverted
  // (results/OCCLUSION-ANTILAG.md: AO contact -0.6 dB, AO flicker +15 %, SO -0.9 dB for -0.2 / -0.8 ms)
  const base = { sigmaLuminance: 1.5, atrousIterations: 3, youngNormalPower: 0, ...svgf, remodulate: false }; // youngNormalPower: unmeasured on occlusion (TASKS T1 follow-ups)
  const perSignal = signals.map((k) => resolveOptions(k === 'specular' && svgf.temporalAlpha === undefined ? { ...base, temporalAlpha: 0.3 } : base));
  return { filter, signals, o: perSignal[0], perSignal, hitDistanceScale, hitDistanceViewScale };
}

/**
 * Normalized hit distance as a gray image (ĥ, ĥ, ĥ, 1; rgba16float): the noisy AO / SO
 * input of a filter that doesn't normalize itself. Depth from GuidePass's packed geometry
 * (`'geo'`) or from a three.js viewZ texture (`'viewz'`, sky at viewZ <= -far). Starts
 * with OcclusionDenoiser's default curve (a 1, b 0.05, far ∞); `setCurve()` changes it.
 */
export class HitDistanceNormalizer {
  private layout: GPUBindGroupLayout;
  private pipe: GPUComputePipeline;
  private params: GPUBuffer;
  private outs: GPUTexture[] = [];
  private next = 0;

  constructor(private device: GPUDevice, readonly depth: 'geo' | 'viewz' = 'viewz', label = 'occlusion normalize') {
    this.layout = makeLayout(device, label, ['u', 'f', depth === 'geo' ? 'i' : 'f', 'rgba16float']);
    this.pipe = makePipeline(device, label, normalizeHitWgsl(depth), this.layout);
    this.params = device.createBuffer({ label, size: OCC_NORM_SIZE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.setCurve(DEFAULT_A, DEFAULT_B);
  }

  /** `count` output textures (one per signal normalized per frame). */
  configure(width: number, height: number, count = 1) {
    for (const t of this.outs) t.destroy();
    this.outs = [...Array(count).keys()].map((i) => this.device.createTexture({
      label: `occlusion normalized ${i}`, size: [width, height], format: 'rgba16float', usage: storageTex() | GPUTextureUsage.COPY_SRC,
    }));
  }

  /**
   * ĥ = h / (h + a + b·depth). `far`: with `'viewz'` depth, viewZ <= -far is sky (output 0);
   * pass the camera's far plane when the renderer writes sky as -far. Default ∞.
   */
  setCurve(a: number, b: number, far = 1e30) {
    this.device.queue.writeBuffer(this.params, 0, new Float32Array([a, b, far, 0]));
  }

  /**
   * @internal Records the pass into `enc` (OcclusionDenoiser; `timer` is the package's
   * PassTimer); returns output `slot`. Use `run()` from outside the package.
   */
  encode(enc: GPUCommandEncoder, timer: PassTimer | undefined, name: string, hit: GPUTexture, depth: GPUTexture, slot = 0): GPUTexture {
    const out = this.outs[slot];
    runPass(enc, timer, name, this.pipe, makeBindGroup(this.device, this.layout, [this.params, hit, depth, out]),
      Math.ceil(out.width / 8), Math.ceil(out.height / 8));
    return out;
  }

  /** One-shot: normalize and submit (test harnesses). Rotates between the configured outputs. */
  run(hit: GPUTexture, viewZ: GPUTexture): GPUTexture {
    const enc = this.device.createCommandEncoder({ label: 'occlusion normalize' });
    const t = this.encode(enc, undefined, 'normalize', hit, viewZ, this.next);
    this.next = (this.next + 1) % this.outs.length;
    this.device.queue.submit([enc.finish()]);
    return t;
  }

  dispose() {
    for (const t of this.outs) t.destroy();
    this.params.destroy();
  }
}

/**
 * Denoises AO and/or SO (experimental, SPEC §8; `filter: 'svgf'` by default, `'recurrent'`
 * for less memory). `dispatch()` takes one signal's hit
 * distance and returns ĥ in `.r`; with `signal: 'both'` use `dispatchBoth()` (shared
 * dispatches for both signals; `dispatch()` then returns the diffuse output after running
 * both with the same hit distance, which is only meaningful for tests).
 */
export class OcclusionDenoiser implements TemporalDenoiser<OcclusionInputs> {
  readonly name: string;
  readonly options: Readonly<ResolvedOcclusion>;
  readonly device: GPUDevice;
  private gp: GuidePass;
  private timer?: PassTimer;
  private rec?: RecurrentPipeline;
  private svgf?: SvgfPipeline;
  private norm?: HitDistanceNormalizer;
  private width = 0;
  private height = 0;
  private needsReset = true;
  private configured = false;

  constructor(device: GPUDevice, options: OcclusionDenoiserOptions = {}) {
    this.device = device;
    const r = resolveOcclusion(options);
    this.options = r;
    const sig = r.signals.length > 1 ? 'both' : r.signals[0];
    this.name = `${r.filter}-occlusion-${sig}`;
    if (r.filter === 'recurrent' && usesDeprecatedAntiLag(options)) warnDeprecatedAntiLag(this.name);
    this.gp = new GuidePass(device, this.name, r.filter === 'svgf');
    let passes: number;
    if (r.filter === 'recurrent') {
      this.rec = new RecurrentPipeline(device, r.signals.map((k) => ({ kind: k === 'diffuse' ? 'ao' : 'so', opts: r.o })), this.name);
      passes = recurrentPassCount(r.o, true);
    } else {
      this.svgf = new SvgfPipeline(device, r.signals.map((k, i) => ({ kind: k, opts: r.perSignal[i] })), this.name);
      this.norm = new HitDistanceNormalizer(device, 'geo', `${this.name} normalize`);
      this.norm.setCurve(r.hitDistanceScale, r.hitDistanceViewScale);
      passes = 3 + r.o.atrousIterations + (r.o.antiLag !== 'off' ? 2 + r.o.gradientIterations : 0);
    }
    const ts = r.o.timestamps;
    this.timer = ts && PassTimer.supported(device) ? new PassTimer(device, passes + 2) : undefined;
  }

  get gpuTimings(): ReadonlyMap<string, number> | undefined { return this.timer?.timings; }

  configure({ width, height }: TemporalConfig): void {
    if (!(width > 0 && height > 0)) throw new Error(`${this.name}: bad size ${width}x${height}`);
    this.width = width;
    this.height = height;
    this.gp.configure(width, height);
    this.rec?.configure(width, height);
    this.svgf?.configure(width, height);
    this.norm?.configure(width, height, this.options.signals.length);
    this.needsReset = true;
    this.configured = true;
  }

  /** Outputs of the last dispatch in signal order (valid until the next dispatch). */
  get outputs(): (GPUTexture | undefined)[] { return (this.rec ?? this.svgf)!.outputs; }

  dispatchBoth(inputs: OcclusionBothInputs, guides: FrameGuides, camera: FrameCamera): OcclusionOutputs {
    if (this.options.signals.length !== 2) throw new Error(`${this.name}: dispatchBoth needs signal: 'both'`);
    this.run([inputs.diffuse.hitDistance, inputs.specular.hitDistance], guides, camera);
    const [d, s] = this.outputs;
    return { diffuse: d!, specular: s! };
  }

  dispatch(inputs: OcclusionInputs, guides: FrameGuides, camera: FrameCamera): GPUTexture {
    this.run(this.options.signals.map(() => inputs.hitDistance), guides, camera);
    return this.outputs[0]!;
  }

  private run(hits: GPUTexture[], guides: FrameGuides, camera: FrameCamera) {
    if (!this.configured) throw new Error(`${this.name}: call configure() before dispatch()`);
    if (this.options.signals.includes('specular') && !guides.roughness) throw new Error(`${this.name}: specular occlusion needs guides.roughness`);
    for (const [k, t] of [['depth', guides.depth], ['normal', guides.normal], ['motion', guides.motion], ['viewZ', guides.viewZ],
      ['motionZ', guides.motionZ], ['roughness', guides.roughness], ...hits.map((h) => ['hitDistance', h])] as [string, GPUTexture | undefined][]) {
      if (t && (t.width !== this.width || t.height !== this.height)) throw new Error(`${this.name}: ${k} is ${t.width}x${t.height}, configured ${this.width}x${this.height}`);
    }
    const enc = this.device.createCommandEncoder({ label: this.name });
    this.timer?.begin();
    this.gp.encode(enc, this.timer, guides, camera, this.needsReset);
    if (this.rec) {
      this.rec.encode(enc, this.timer, this.gp, hits.map((h) => ({ hitDistance: h })), guides.motion, guides.motionZ,
        camera.projection, camera.prevProjection, '');
    } else {
      const frames = hits.map((h, i) => ({ radiance: this.norm!.encode(enc, this.timer, hits.length > 1 ? `normalize_${i}` : 'normalize', h, this.gp.geoCur, i) }));
      this.svgf!.encode(enc, this.timer, this.gp, frames, guides.motion, guides.motionZ, '');
    }
    const after = this.timer?.end(enc);
    this.device.queue.submit([enc.finish()]);
    after?.();
    this.gp.endFrame();
    this.rec?.endFrame();
    this.svgf?.endFrame();
    this.needsReset = false;
  }

  resetHistory(): void { this.needsReset = true; }

  dispose(): void {
    this.rec?.dispose();
    this.svgf?.dispose();
    this.norm?.dispose();
    this.gp.dispose();
    this.timer?.destroy();
  }
}
