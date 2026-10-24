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
//   R3 mips         reads s                      writes p = signal mip atlas (+ depth atlas)
//   R4 history_fix  reads s, p (atlas)           writes r = fix (data in place)
//   R5 blur         reads r                      writes p = blur
//   R6 post_blur    reads p, s (centre)          writes r = H (next frame's history)
//   R7 stabilize    reads r, q (reprojected)     writes p = S (output, next frame's S_prev)
// Next frame: p' = r, q' = p, r' = q, s' = s.
import type { PassTimer } from './common';
import { makeBindGroup, makeLayout, makePipeline, runPass, storageTex, type Res } from './gpu';
import type { GuidePass } from './guides';
import type { PassDef } from './shaders/bindings';
import {
  blurPass, historyFixPass, mipsPass, preBlurPass, RF_SIZE, RP_HAS_HIT, RP_NO_ANTILAG, RP_NO_FIREFLY,
  RP_NO_HISTORY_FIX, RP_NO_STABILIZE, RP_NO_VIRTUAL, RP_REMODULATE, RP_SIZE, stabilizePass, temporalPass, trivialPass,
  type RecurrentKind,
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
  /** Blur radius falls as (1 + A)^-p with history length (SPEC R-5 / GTC20: p = 1). Default 1. */
  blurRadiusHistoryPower?: number;
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
  /** Anti-firefly: centre luminance ≤ k × second-largest neighbour (SPEC D9); 0 disables. Default 1.5. */
  fireflyThreshold?: number;
  /** Anti-lag from the fast history (SPEC C-10). Default true. */
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
  /** Specular surface-motion history scale k_s (SPEC R-8). Default 1. */
  specularHistoryScale?: number;
  /** Specular virtual-motion (reflected-image) reprojection, blended with surface motion (SPEC R-9..R-12). Default true. */
  virtualMotion?: boolean;
  /** Virtual-history clamp window γ (σ of this frame's 3x3, SPEC R-11: 2), widened × (1 + 2·confidence) (tune.virtWiden). Default 1. */
  virtualClampSigma?: number;
  /** Virtual confidence normal tolerance, × lobe half-angle (SPEC R-10). Default 0.5. */
  virtualAngleScale?: number;
  /** Virtual confidence ĥ tolerance a + b·roughness (SPEC R-10): a. Default 0.05. */
  virtualHitTolerance?: number;
  /** b in the tolerance above. Default 0.25. */
  virtualHitToleranceRoughness?: number;
  /**
   * Luminance weight in blur / post-blur (our addition): tolerance on the relative luminance
   * difference = k · f_r(roughness) / sqrt(1 + A) (the expected relative noise; mirrors have
   * clean input, so their reflections keep their edges); 0 disables. Default 0.
   */
  luminanceWeight?: number;
  /** Specular minimum blur radius: minBlurRadius · lerp(1, f_r(roughness), s) (0 = SPEC's constant floor; 1 = no floor on mirrors). Default 1. */
  specularMinRadiusScale?: number;
  /** Multiply the output by the demodulation factor into separate textures. Default false. */
  remodulate?: boolean;
  /** Per-pass GPU timestamps into `gpuTimings` when supported. Default true. */
  timestamps?: boolean;
  /** @internal Replace every pass by a trivial kernel with the same bindings (SPEC §10.3 skeleton timing). */
  skeleton?: boolean;
  /** @internal Weight tolerance overrides (sweeps): [geometry A=0, A=1], normal tightening, hit [r=0, r=1, tightening], post-blur [lo, hi, delta], stabilization γ [lo, hi], β. */
  tune?: Partial<RecurrentTune>;
}

export interface RecurrentTune {
  geoTolLo: number; geoTolHi: number; normalTight: number;
  hitTolLo: number; hitTolHi: number; hitTolTight: number;
  postLo: number; postHi: number; postDelta: number;
  stabGammaLo: number; stabGammaHi: number; stabBeta: number;
  /** amount of virtual motion m = F_dom^virtPow; virtual distance from fast ĥ (0) .. slow history ĥ (1); curvature scale */
  virtPow: number; virtHitSrc: number; virtCurv: number; stabVirt: number;
  /** virtual motion gated by the surface candidate's parallax loss (0/1); virtual clamp window widening with confidence (0 = SPEC R-11 form) */
  virtGate: number; virtWiden: number;
  /** specular current-frame detector floor A_fast × lerp(1, f_r, detRough) */
  detRough: number;
  /** specular anti-lag / detector mean: own pixel (mirrors) .. 3x3 mean (f_r = 1), 0 = always the 3x3 mean */
  specCentre: number;
}

export type ResolvedRecurrent = Required<Omit<RecurrentOptions, 'filter' | 'tune' | 'preBlurRadius' | 'blurRadius'>> & {
  preBlurRadius?: number; blurRadius?: number; tune: RecurrentTune;
};

export function resolveRecurrent(o: Partial<RecurrentOptions> = {}): ResolvedRecurrent {
  return {
    hitDistanceScale: o.hitDistanceScale ?? 1,
    hitDistanceViewScale: o.hitDistanceViewScale ?? 0.05,
    maxRadiance: o.maxRadiance ?? 1e4,
    preBlurRadius: o.preBlurRadius,
    blurRadius: o.blurRadius,
    minBlurRadius: o.minBlurRadius ?? 1,
    blurRadiusHistoryPower: o.blurRadiusHistoryPower ?? 1,
    maxAccumulatedFrames: o.maxAccumulatedFrames ?? 31,
    fastFrames: o.fastFrames ?? 3,
    historyFixFrames: o.historyFixFrames ?? 3,
    historyFixDepthTolerance: o.historyFixDepthTolerance ?? 0.02,
    historyFixMinWeight: o.historyFixMinWeight ?? 0.25,
    fireflyThreshold: o.fireflyThreshold ?? 1.5,
    antiLag: o.antiLag ?? true,
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
    virtualMotion: o.virtualMotion ?? true,
    virtualClampSigma: o.virtualClampSigma ?? 1,
    virtualAngleScale: o.virtualAngleScale ?? 0.5,
    virtualHitTolerance: o.virtualHitTolerance ?? 0.05,
    virtualHitToleranceRoughness: o.virtualHitToleranceRoughness ?? 0.25,
    specularMinRadiusScale: o.specularMinRadiusScale ?? 1,
    luminanceWeight: o.luminanceWeight ?? 0,
    remodulate: o.remodulate ?? false,
    timestamps: o.timestamps ?? true,
    skeleton: o.skeleton ?? false,
    tune: {
      geoTolLo: 0.02, geoTolHi: 0.005, normalTight: 0.25,
      hitTolLo: 0.1, hitTolHi: 0.5, hitTolTight: 0.5,
      postLo: 0.5, postHi: 2.0, postDelta: 0.3,
      stabGammaLo: 1, stabGammaHi: 3, stabBeta: 0.02,
      virtPow: 1, virtHitSrc: 0, virtCurv: 1, stabVirt: 0, virtGate: 0, virtWiden: 2, detRough: 1, specCentre: 1,
      ...o.tune,
    },
  };
}

/** Per-frame inputs of one signal. */
export interface RecurrentFrame {
  radiance: GPUTexture;
  /** Hit distance in `.r` (world units, 0 = miss). Optional for diffuse. */
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
  return (hasHit ? RP_HAS_HIT : 0) | (o.remodulate ? RP_REMODULATE : 0) | (o.antiLag ? 0 : RP_NO_ANTILAG)
    | (o.fireflyThreshold > 0 ? 0 : RP_NO_FIREFLY) | (o.historyFixFrames > 0 ? 0 : RP_NO_HISTORY_FIX)
    | (o.stabilizationFrames > 0 ? 0 : RP_NO_STABILIZE) | (o.virtualMotion ? 0 : RP_NO_VIRTUAL);
}

/** Options that change the pass structure (signals in one pipeline must agree). */
export function recurrentStructuralKey(o: ResolvedRecurrent) {
  return ['recurrent', o.remodulate, o.skeleton].join('|');
}

export const RECURRENT_PASSES = ['pre_blur', 'temporal', 'mips', 'history_fix', 'blur', 'post_blur', 'stabilize'];

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

  constructor(private device: GPUDevice, signals: { kind: RecurrentKind; opts: ResolvedRecurrent }[], private label: string) {
    const d = device;
    this.sigs = signals.map((s) => new SignalState(d, s.kind, s.opts, signals.length > 1 ? `${label} ${s.kind}` : label));
    this.opts = signals[0].opts;
    this.rframe = d.createBuffer({ label: `${label} rframe`, size: RF_SIZE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const kinds = signals.map((s) => s.kind);
    const skel = this.opts.skeleton;
    const make = (name: string, def: PassDef, trivial = skel) => {
      if (trivial) def = trivialPass(def);
      this.defs[name] = def;
      this.layouts[name] = makeLayout(d, `${label} ${name}`, def.entries.map((e) => e.kind));
      this.pipes[name] = makePipeline(d, `${label} ${name}`, def.code, this.layouts[name]);
    };
    make('pre_blur', preBlurPass(kinds));
    make('temporal', temporalPass(kinds));
    make('mips', mipsPass(kinds), false);   // no taps: the real pass is its own skeleton
    make('history_fix', historyFixPass(kinds));
    make('blur', blurPass(kinds, false));
    make('post_blur', blurPass(kinds, true));
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
      s.buf = [0, 1, 2, 3].map((i) => tex(`${s.kind} buffer ${i}`, 'rgba16float', width, height, GPUTextureUsage.COPY_SRC));
      if (this.opts.remodulate) s.out = tex(`${s.kind} output`, 'rgba16float', width, height, GPUTextureUsage.COPY_SRC);
      this.writeParams(s);
    }
    for (const t of [...this.fast, ...this.data]) t.destroy();
    this.mipZ?.destroy();
    this.fast = [0, 1].map((i) => tex(`fast ${i}`, 'rgba16float'));
    this.data = [0, 1].map((i) => tex(`data ${i}`, 'r32uint'));
    this.mipZ = tex('depth mips', 'r32float', Math.ceil(width / 2) + Math.ceil(width / 4), Math.ceil(height / 2));
    this.rot = [0, 1, 2, 3];
    this.cur = 0;
  }

  private writeParams(s: SignalState) {
    const o = s.opts;
    const t = o.tune;
    const f = new Float32Array(RP_SIZE / 4);
    const u = new Uint32Array(f.buffer);
    const res = this.height / 1080;
    const pre = o.preBlurRadius ?? (s.kind === 'diffuse' ? 25 : 10);
    const blur = o.blurRadius ?? (s.kind === 'diffuse' ? 45 : 30);
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
    f[40] = t.virtPow; f[41] = t.virtHitSrc; f[42] = t.virtCurv; f[43] = t.stabVirt;
    f[44] = t.virtGate; f[45] = t.virtWiden; f[46] = t.detRough; f[47] = o.luminanceWeight; f[48] = t.specCentre; f[49] = o.blurRadiusHistoryPower;
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
    this.device.queue.writeBuffer(this.rframe, 0, f);
  }

  /** Output of the last frame per signal (rgb = denoised, a = denoised normalized hit distance). */
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

    run('pre_blur', per((sg, f) => ({ input: f.radiance, hit: f.hitDistance ?? gp.dummy, histPrev: sg.buf[p], outPre: sg.buf[r] })));
    run('temporal', per((sg) => ({ pre: sg.buf[r], histPrev: sg.buf[p], outAcc: sg.buf[s] }),
      { fastPrev: this.fast[c ^ 1], dataPrev: this.data[c ^ 1], outFast: this.fast[c], outData: this.data[c] }));
    run('mips', per((sg) => ({ acc: sg.buf[s], outMip: sg.buf[p] }), { outMipZ: this.mipZ! }), Math.ceil(W / 16), Math.ceil(H / 16));
    run('history_fix', per((sg) => ({ acc: sg.buf[s], mip: sg.buf[p], outFix: sg.buf[r] }),
      { fastCur: this.fast[c], mipZ: this.mipZ!, dataRW: this.data[c] }));
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
