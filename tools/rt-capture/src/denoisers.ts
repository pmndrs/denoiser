// THE denoiser registry of the project (single source of truth): the replay page here
// AND the test bed (examples/realtime-denoiser, live and capture modes) both run the
// entries below, so a denoiser registers once and runs everywhere. Add one with
// registerDenoiser(); single-signal TemporalDenoisers wrap with perSignal(). A joint
// denoiser (e.g. diffuse + specular in one dispatch) implements ReplayDenoiser directly
// and returns both outputs. Inputs follow the TemporalDenoiser API shapes (DiffuseInputs /
// SpecularInputs / ShadowInputs); signal names are the capture's (`visibility` = the test
// bed's `shadows`).
//
//   passthrough        the noisy input, unchanged (the "noisy" baseline through the same path)
//   accumulate         reprojected running mean (our analogue of native REFERENCE; M0 sanity)
//   accumulate-static  running mean without reprojection (static-camera captures)
//   accumulate-32      capped accumulation, 32 frames, 2.5D depth test (the test bed's
//                      baseline row; needs viewz + motion_z); `maxFrames` overrides
//   accumulate-8       the same, 8 frames
//   svgf               denoiser/realtime SVGF with antiLag 'off' (pinned; the package default is
//                      'auto' since 2026-10-25), diffuse + specular (DiffuseSpecularDenoiser,
//                      dispatchBoth; a single requested signal runs that signal's class)
//   svgf-auto          the same with A-SVGF anti-lag 'auto' (renderer-free gradients)
//   svgf-diffuse       DiffuseDenoiser alone;  svgf-specular  SpecularDenoiser alone
//   (svgf settings from the URL: see svgfOptions(); antiLag 'gradient' needs renderer
//   gradient samples that neither the test bed nor the captures provide)
//   recurrent          denoiser/realtime recurrent blur (SPEC §5) for diffuse AND specular in shared
//                      dispatches (= DiffuseSpecularDenoiser({ filter: 'recurrent' }) since 2026-10-25;
//                      dispatchBoth; a single requested signal runs that signal's class with the same options)
//   recurrent-svgfspec recurrent diffuse + SVGF (antiLag 'auto') specular, two pipelines (the explicit
//                      hybrid; until 2026-10-25 what `filter: 'recurrent'` meant on the joint class)
//   recurrent-diffuse  DiffuseDenoiser alone;  recurrent-specular  SpecularDenoiser alone
//   (recurrent settings from the URL: see recurrentOptions(); the output texture rotates
//   between internal buffers, valid until the next dispatch)
//   shadows            denoiser/realtime ShadowDenoiser (visibility; provisional, SPEC v0 §7): the
//                      light comes from the frame's `lights` (test bed / per-frame extras) or the
//                      manifest's; settings `sh.<option>=v` (see shadowOptions())
//   shadows-translucent  ShadowDenoiser({ translucency: true }) (SPEC v0.3 §7.10, M8; provisional): on shadow-rgb
//                      the coloured shadow v̂·τ̂ (rgba16float, v̂ in alpha), and on visibility the opaque v̂ of the
//                      same instance (exactly the `shadows` output when there is no transmittance); `tr.hit=none`
//                      drops translucent_dist; sh.<option> settings as `shadows`
//   ffx-shadows        @pmndrs/denoiser-ffx FfxShadowDenoiser (visibility)
//   ffx-reflections    @pmndrs/denoiser-ffx FfxReflectionDenoiser (specular)
//   occlusion-*        AO / SO (derived signals `ao` / `so`): src/occlusion-entries.ts
//   svgf-sh            denoiser/realtime SVGF with the directional payload (M7, payload 'sh') on the v1
//                      signals sh-diffuse / sh-specular: filters with shGuides() (normal_geom), fused resolve
//                      at the shading normal; settings: svgf ones + m7.sharpen, m7.guard, m7.enc,
//                      m7.ratio (sg|l1), m7.lightSharp, m7.maxRatio, m7.fadeR, m7.truncate=1 (test: f16
//                      packing rounds toward zero like the plain filter's rgba16float stores on Metal)
//   svgf-sh-auto       the same with antiLag 'auto'
//                      (the fused diffuse resolve sharpens by default, shSharpen 0.75: score vsShRef with &refS=0.75)
//   v1 signals         sh-diffuse / sh-specular / shadow-rgb baselines (svgf-plain, svgf-plain-smooth,
//                      shadows-lumt, ffx-shadows-lumt; passthrough / accumulate* extended): src/v1-entries.ts
//
// Settings come from the replay page's URL (?denoiser=accumulate&maxFrames=64 ...).
import type { TemporalDenoiser } from '../../../packages/denoiser-core/src/temporal';
// relative source import: works from any page without a package alias or a built dist
import { FfxReflectionDenoiser, FfxShadowDenoiser } from '../../../packages/denoiser-ffx/src/index';
import { AccumulateDenoiser } from './accumulate';
import { EmaAccumulateDenoiser } from './accumulate-ema';
import { DiffuseDenoiser, DiffuseSpecularDenoiser, SpecularDenoiser } from '../../../packages/denoiser-realtime/src/index';
import type { DiffuseSpecularDenoiserOptions, RecurrentOptions, SpecularSvgfOptions } from '../../../packages/denoiser-realtime/src/index';
import { ShadowDenoiser } from '../../../packages/denoiser-realtime/src/index';
import type { ShadowDenoiserOptions, ShadowLight } from '../../../packages/denoiser-realtime/src/index';
import { shGuides, type DenoiserEntry, type ReplayDenoiser, type ReplayFrame } from './replay';
import type { CaptureLight, SignalName } from './format';
import { registerOcclusionDenoisers } from './occlusion-entries';
import { registerV1Denoisers } from './v1-entries';

export const DENOISERS = new Map<string, DenoiserEntry>();

export function registerDenoiser(entry: DenoiserEntry): void {
  DENOISERS.set(entry.id, entry);
}

/**
 * Wrap a factory of single-signal TemporalDenoisers: one instance per signal, fed the
 * signal's inputs in the TemporalDenoiser API shape (DiffuseInputs / SpecularInputs /
 * ShadowInputs), the shared guides and the camera.
 */
export function perSignal(
  make: (device: GPUDevice, signal: SignalName, settings: Record<string, string>) => TemporalDenoiser<object>,
): DenoiserEntry['create'] {
  return (device, { width, height, signals, settings }) => {
    const dens = new Map(signals.map((s) => {
      const d = make(device, s, settings);
      d.configure({ width, height });
      return [s, d] as const;
    }));
    const den: ReplayDenoiser = {
      signals,
      dispatch(frame: ReplayFrame) {
        const out: Partial<Record<SignalName, GPUTexture>> = {};
        for (const [s, d] of dens) {
          const inputs = frame.inputs[s];
          if (!inputs) throw new Error(`capture has no ${s} input`);
          out[s] = d.dispatch(inputs, frame.guides, frame.camera);
        }
        return out;
      },
      resetHistory() { for (const d of dens.values()) d.resetHistory(); },
      gpuTimings() {
        const m = new Map<string, number>();
        for (const [s, d] of dens) for (const [k, v] of d.gpuTimings ?? []) m.set(dens.size > 1 ? `${s}/${k}` : k, v);
        return m;
      },
      dispose() { for (const d of dens.values()) d.dispose(); },
    };
    return den;
  };
}

/** Returns the noisy input itself. */
class Passthrough implements TemporalDenoiser<{ radiance?: GPUTexture; visibility?: GPUTexture }> {
  readonly name = 'passthrough';
  constructor(readonly device: GPUDevice) {}
  configure() {}
  dispatch(inputs: { radiance?: GPUTexture; visibility?: GPUTexture }) {
    const t = inputs.radiance ?? inputs.visibility;
    if (!t) throw new Error('passthrough: no input');
    return t;
  }
  resetHistory() {}
  dispose() {}
}

const num = (s: Record<string, string>, k: string) => (s[k] !== undefined ? Number(s[k]) : undefined);
const ALL: SignalName[] = ['diffuse', 'specular', 'visibility'];

registerDenoiser({
  id: 'passthrough', description: 'noisy input, unchanged', signals: ALL,
  create: perSignal((device) => new Passthrough(device)),
});
registerDenoiser({
  id: 'accumulate', description: 'reprojected running mean (reference accumulation, analogue of native REFERENCE)', signals: ALL,
  create: perSignal((device, _s, st) => new AccumulateDenoiser(device, { reproject: true, maxFrames: num(st, 'maxFrames'), depthTolerance: num(st, 'depthTolerance') })),
});
registerDenoiser({
  id: 'accumulate-static', description: 'running mean without reprojection', signals: ALL,
  create: perSignal((device, _s, st) => new AccumulateDenoiser(device, { reproject: false, maxFrames: num(st, 'maxFrames') })),
});
registerDenoiser({
  id: 'accumulate-32', description: 'capped temporal accumulation (32 frames, no clamp, 2.5D depth test; test-bed baseline)', signals: ALL,
  create: perSignal((device, _s, st) => new EmaAccumulateDenoiser(device, { maxFrames: num(st, 'maxFrames') ?? 32 })),
});
registerDenoiser({
  id: 'accumulate-8', description: 'capped temporal accumulation (8 frames, no clamp, 2.5D depth test)', signals: ALL,
  create: perSignal((device, _s, st) => new EmaAccumulateDenoiser(device, { maxFrames: num(st, 'maxFrames') ?? 8 })),
});
registerDenoiser({
  id: 'ffx-shadows', description: '@pmndrs/denoiser-ffx FfxShadowDenoiser (FidelityFX 1.x port)', signals: ['visibility'],
  create: perSignal((device, _s, st) => new FfxShadowDenoiser(device, {
    ...(st.depthSimilaritySigma ? { depthSimilaritySigma: Number(st.depthSimilaritySigma) } : {}),
  })),
});
registerDenoiser({
  id: 'ffx-reflections', description: '@pmndrs/denoiser-ffx FfxReflectionDenoiser (FidelityFX 1.x port)', signals: ['specular'],
  create: perSignal((device, _s, st) => new FfxReflectionDenoiser(device, {
    ...(st.stats ? { currentFrameStatistics: st.stats === 'current' } : {}),
    ...(st.tsf ? { temporalStabilityFactor: Number(st.tsf) } : {}),
  })),
});

// ---- denoiser/realtime (packages/denoiser-realtime) --------------------------------

const SVGF_NUM = ['temporalAlpha', 'momentsAlpha', 'maxHistory', 'planeDistance', 'normalThreshold', 'atrousIterations',
  'sigmaDepth', 'sigmaNormal', 'sigmaLuminance', 'varianceRampFrames', 'spatialVarianceBoost', 'antiLagNoiseFloor',
  'antiLagRadius', 'gradientIterations', 'specularHistoryScale', 'specularHistoryCurve', 'lobeFraction', 'radiusScale'] as const;
const SVGF_STR = ['historyFilter', 'kernel', 'luminanceVariance', 'antiLag', 'specularNormalWeight'] as const;

/** SVGF options from replay / test-bed settings (`feedback=0|1`; outputs stay demodulated). */
export function svgfOptions(st: Record<string, string>, defaults: SpecularSvgfOptions = {}): SpecularSvgfOptions {
  const o: Record<string, unknown> = { ...defaults };
  for (const k of SVGF_NUM) if (st[k] !== undefined) o[k] = Number(st[k]);
  for (const k of SVGF_STR) if (st[k] !== undefined) o[k] = st[k];
  if (st.feedback !== undefined) o.feedback = !['0', 'false', 'off'].includes(st.feedback);
  return o as SpecularSvgfOptions;
}

/**
 * Joint diffuse + specular SVGF: DiffuseSpecularDenoiser.dispatchBoth() when both signals
 * are requested; a single requested signal falls back to that signal's class.
 */
function svgfJoint(defaults: SpecularSvgfOptions): DenoiserEntry['create'] {
  return (device, ctx) => {
    const opts = svgfOptions(ctx.settings, defaults);
    if (!(ctx.signals.includes('diffuse') && ctx.signals.includes('specular'))) {
      return perSignal((d, s) => (s === 'diffuse' ? new DiffuseDenoiser(d, opts) : new SpecularDenoiser(d, opts)))(device, ctx);
    }
    const den = new DiffuseSpecularDenoiser(device, opts);
    den.configure({ width: ctx.width, height: ctx.height });
    return {
      signals: ['diffuse', 'specular'],
      dispatch(frame: ReplayFrame) {
        const { diffuse, specular } = frame.inputs;
        if (!diffuse || !specular) throw new Error('svgf: capture needs diffuse and specular');
        return den.dispatchBoth({ diffuse, specular }, frame.guides, frame.camera);
      },
      resetHistory() { den.resetHistory(); },
      gpuTimings() { return new Map(den.gpuTimings ?? []); },
      dispose() { den.dispose(); },
    };
  };
}

registerDenoiser({
  id: 'svgf', description: 'denoiser/realtime SVGF (diffuse + specular, joint dispatch)', signals: ['diffuse', 'specular'],
  create: svgfJoint({ antiLag: 'off' }), // pinned: the package default is 'auto' since Dennis's q02
});
registerDenoiser({
  id: 'svgf-auto', description: "denoiser/realtime A-SVGF (antiLag 'auto'), diffuse + specular", signals: ['diffuse', 'specular'],
  create: svgfJoint({ antiLag: 'auto' }),
});
registerDenoiser({
  id: 'svgf-diffuse', description: 'denoiser/realtime SVGF DiffuseDenoiser', signals: ['diffuse'],
  create: perSignal((device, _s, st) => new DiffuseDenoiser(device, svgfOptions(st, { antiLag: 'off' }))),
});
registerDenoiser({
  id: 'svgf-specular', description: 'denoiser/realtime SVGF SpecularDenoiser (needs roughness)', signals: ['specular'],
  create: perSignal((device, _s, st) => new SpecularDenoiser(device, svgfOptions(st, { antiLag: 'off' }))),
});

/**
 * Recurrent options from replay / test-bed settings: `r.<option>=v` (any RecurrentOptions
 * key, numbers or true/false), `t.<tune>=v` (RecurrentTune), and per signal `d.<option>` /
 * `s.<option>` (diffuse / specular only). Outputs stay demodulated.
 */
export function recurrentOptions(st: Record<string, string>, signal?: 'diffuse' | 'specular'): RecurrentOptions {
  const val = (v: string) => (v === 'true' ? true : v === 'false' ? false : Number(v));
  const o: Record<string, unknown> = { filter: 'recurrent' };
  const tune: Record<string, unknown> = {};
  const own = signal === 'diffuse' ? 'd.' : signal === 'specular' ? 's.' : null;
  for (const [k, v] of Object.entries(st)) {
    if (k.startsWith('r.') || (own && k.startsWith(own))) o[k.slice(2)] = val(v);
    else if (k.startsWith('t.')) tune[k.slice(2)] = val(v);
  }
  if (Object.keys(tune).length) o.tune = tune;
  return o as unknown as RecurrentOptions;
}

/** Joint recurrent (both signals in shared dispatches unless `specular` says otherwise). */
function recurrentJoint(specular: (st: Record<string, string>) => DiffuseSpecularDenoiserOptions['specular']): DenoiserEntry['create'] {
  return (device, ctx) => {
    const st = ctx.settings;
    const spec = specular(st);
    if (!(ctx.signals.includes('diffuse') && ctx.signals.includes('specular'))) {
      return perSignal((d, s) => (s === 'diffuse'
        ? new DiffuseDenoiser(d, recurrentOptions(st, 'diffuse'))
        : new SpecularDenoiser(d, { ...recurrentOptions(st), ...spec } as RecurrentOptions)))(device, ctx);
    }
    const den = new DiffuseSpecularDenoiser(device, { ...recurrentOptions(st), diffuse: recurrentOptions(st, 'diffuse'), specular: spec });
    den.configure({ width: ctx.width, height: ctx.height });
    return {
      signals: ['diffuse', 'specular'],
      dispatch(frame: ReplayFrame) {
        const { diffuse, specular: sp } = frame.inputs;
        if (!diffuse || !sp) throw new Error('recurrent: capture needs diffuse and specular');
        return den.dispatchBoth({ diffuse, specular: sp }, frame.guides, frame.camera);
      },
      resetHistory() { den.resetHistory(); },
      gpuTimings() { return new Map(den.gpuTimings ?? []); },
      dispose() { den.dispose(); },
    };
  };
}

registerDenoiser({
  id: 'recurrent', description: 'denoiser/realtime recurrent blur, diffuse + specular in shared dispatches (provisional)', signals: ['diffuse', 'specular'],
  create: recurrentJoint((st) => recurrentOptions(st, 'specular')),
});
registerDenoiser({
  id: 'recurrent-svgfspec', description: "recurrent diffuse + SVGF (antiLag 'auto') specular", signals: ['diffuse', 'specular'],
  create: recurrentJoint((st) => ({ ...svgfOptions(st, { antiLag: 'auto' }), filter: 'svgf' }) as DiffuseSpecularDenoiserOptions['specular']),
});
registerDenoiser({
  id: 'recurrent-diffuse', description: 'denoiser/realtime recurrent DiffuseDenoiser (provisional)', signals: ['diffuse'],
  create: perSignal((device, _s, st) => new DiffuseDenoiser(device, recurrentOptions(st, 'diffuse'))),
});
registerDenoiser({
  id: 'recurrent-specular', description: 'denoiser/realtime recurrent SpecularDenoiser (provisional, needs roughness)', signals: ['specular'],
  create: perSignal((device, _s, st) => new SpecularDenoiser(device, recurrentOptions(st, 'specular'))),
});

// ---- shadows (denoiser/realtime ShadowDenoiser) -------------------------------------

/**
 * ShadowDenoiser options from settings: `sh.<option>=v` (numbers, true/false, other strings as is). Input
 * switches for experiments: `sh.light=none` (no light: noise-driven radius),
 * `sh.light=directional` (the sphere light handed over as a directional light toward its
 * centre from the world origin, angular radius asin(R / |position|) x `sh.dirScale`, default
 * 1: tests the directional code path on sphere-lit images) and `sh.hit=none` (drop the
 * occluder distance).
 */
const SHADOW_INPUT_KEYS = new Set(['sh.light', 'sh.hit', 'sh.dirScale']);
export function shadowOptions(st: Record<string, string>): ShadowDenoiserOptions {
  const o: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(st)) {
    if (SHADOW_INPUT_KEYS.has(k)) continue;
    if (k.startsWith('sh.')) o[k.slice(3)] = v === 'true' ? true : v === 'false' ? false : Number.isNaN(Number(v)) ? v : Number(v);
  }
  return o as ShadowDenoiserOptions;
}

/** The shadow light (CAPTURE-FORMAT `lights`, `shadow: true`) as a ShadowLight. */
export function shadowLightOf(lights: readonly CaptureLight[] | undefined): ShadowLight | undefined {
  const l = lights?.find((x) => x.shadow) ?? lights?.[0];
  if (l?.type === 'sphere' && l.position) return { type: 'sphere', position: l.position, radius: l.radius ?? 0 };
  if (l?.type === 'directional' && l.direction) return { type: 'directional', direction: l.direction, angularRadius: l.angularRadius ?? 0 };
  return undefined;
}

registerDenoiser({
  id: 'shadows', description: 'denoiser/realtime ShadowDenoiser (penumbra-sized, provisional)', signals: ['visibility'],
  create: (device, ctx) => {
    const den = new ShadowDenoiser(device, shadowOptions(ctx.settings));
    den.configure({ width: ctx.width, height: ctx.height });
    const noLight = ctx.settings['sh.light'] === 'none';
    const asDirectional = ctx.settings['sh.light'] === 'directional';
    const dirScale = Number(ctx.settings['sh.dirScale'] ?? 1);
    const noHit = ctx.settings['sh.hit'] === 'none';
    return {
      signals: ['visibility'],
      dispatch(frame: ReplayFrame) {
        const inp = frame.inputs.visibility;
        if (!inp) throw new Error('shadows: capture has no visibility input');
        // per-frame lights (test bed extras, CAPTURE-FORMAT v1 proposal) before the capture's
        let light = noLight ? undefined
          : shadowLightOf(frame.meta?.lights as CaptureLight[] | undefined) ?? shadowLightOf(frame.manifest.lights);
        if (asDirectional && light?.type === 'sphere') {
          const [x, y, z] = light.position;
          const d = Math.hypot(x, y, z);
          light = { type: 'directional', direction: [x / d, y / d, z / d], angularRadius: Math.asin(Math.min(light.radius / d, 1)) * dirScale };
        }
        return {
          visibility: den.dispatch({
            visibility: inp.visibility, ...(inp.hitDistance && !noHit ? { hitDistance: inp.hitDistance } : {}),
            ...(light ? { light } : {}),
          }, frame.guides, frame.camera),
        };
      },
      resetHistory() { den.resetHistory(); },
      gpuTimings() { return new Map(den.gpuTimings ?? []); },
      dispose() { den.dispose(); },
    };
  },
});

registerDenoiser({
  id: 'shadows-translucent', description: 'denoiser/realtime ShadowDenoiser with translucency (M8, coloured shadows, provisional)', signals: ['shadow-rgb', 'visibility'],
  create: (device, ctx) => {
    const den = new ShadowDenoiser(device, { ...shadowOptions(ctx.settings), translucency: true });
    den.configure({ width: ctx.width, height: ctx.height });
    const noTrHit = ctx.settings['tr.hit'] === 'none';
    const rgb = ctx.signals.includes('shadow-rgb');
    return {
      signals: ctx.signals,
      dispatch(frame: ReplayFrame) {
        const inp = rgb ? frame.inputs['shadow-rgb'] : frame.inputs.visibility;
        if (!inp) throw new Error(`shadows-translucent: capture has no ${rgb ? 'shadow-rgb' : 'visibility'} input`);
        const light = shadowLightOf(frame.meta?.lights as CaptureLight[] | undefined) ?? shadowLightOf(frame.manifest.lights);
        const tr = rgb ? frame.inputs['shadow-rgb']! : undefined;
        const out = den.dispatch({
          visibility: inp.visibility, ...(inp.hitDistance ? { hitDistance: inp.hitDistance } : {}), ...(light ? { light } : {}),
          ...(tr ? { translucency: tr.translucency } : {}), ...(tr?.translucencyHitDistance && !noTrHit ? { translucencyHitDistance: tr.translucencyHitDistance } : {}),
        }, frame.guides, frame.camera);
        // visibility: the opaque v̂ in r32float (wide path), else the output (alpha = v̂; scalar readers take .r = v̂ τ̂_r)
        const vis = den.debugTexture('visibility') ?? out;
        return { ...(rgb ? { 'shadow-rgb': out } : {}), ...(ctx.signals.includes('visibility') ? { visibility: vis } : {}) };
      },
      resetHistory() { den.resetHistory(); },
      gpuTimings() { return new Map(den.gpuTimings ?? []); },
      dispose() { den.dispose(); },
    };
  },
});

// ---- occlusion (signals ao / so, T5): src/occlusion-entries.ts --------------------------
registerOcclusionDenoisers({ register: registerDenoiser, perSignal, recurrentOptions, svgfOptions });

// ---- CAPTURE-FORMAT v1 signals (sh-diffuse, sh-specular, shadow-rgb): src/v1-entries.ts -------------
registerV1Denoisers({ register: registerDenoiser, get: (id) => DENOISERS.get(id), svgfOptions, shadowOptions, shadowLightOf });

// ---- M7: SVGF with the SH payload (owner m7-sh) ----------------------------------------------
function shOptions(st: Record<string, string>, defaults: SpecularSvgfOptions): SpecularSvgfOptions {
  const o: SpecularSvgfOptions = { ...svgfOptions(st, defaults), payload: 'sh', resolve: 'fused' };
  if (st['m7.sharpen'] !== undefined) o.shSharpen = Number(st['m7.sharpen']);
  if (st['m7.guard'] !== undefined) o.shGuard = Number(st['m7.guard']);
  if (st['m7.enc'] !== undefined) o.shEncoding = st['m7.enc'] as SpecularSvgfOptions['shEncoding'];
  if (st['m7.ratio'] !== undefined) o.shSpecularRatio = st['m7.ratio'] as SpecularSvgfOptions['shSpecularRatio'];
  if (st['m7.lightSharp'] !== undefined) o.shLightSharpness = Number(st['m7.lightSharp']);
  if (st['m7.maxRatio'] !== undefined) o.shMaxRatio = Number(st['m7.maxRatio']);
  if (st['m7.fadeR'] !== undefined) o.shFadeRoughness = Number(st['m7.fadeR']);
  if (st['m7.truncate'] !== undefined) (o as { shPackTruncate?: boolean }).shPackTruncate = st['m7.truncate'] === '1';
  return o;
}
function svgfSh(defaults: SpecularSvgfOptions): DenoiserEntry['create'] {
  return (device, ctx) => {
    const opts = shOptions(ctx.settings, defaults);
    const both = ctx.signals.includes('sh-diffuse') && ctx.signals.includes('sh-specular');
    const joint = both ? new DiffuseSpecularDenoiser(device, opts) : undefined;
    const dens = new Map(ctx.signals.map((s) => [s, joint ?? (s === 'sh-diffuse' ? new DiffuseDenoiser(device, opts) : new SpecularDenoiser(device, opts))] as const));
    for (const d of new Set(dens.values())) d.configure({ width: ctx.width, height: ctx.height });
    const input = (frame: ReplayFrame, s: 'sh-diffuse' | 'sh-specular') => {
      const i = frame.inputs[s];
      if (!i) throw new Error(`svgf-sh: no ${s} input (capture / scene without v1 buffers?)`);
      return { radiance: i.radiance, direction: i.direction, ...(i.hitDistance ? { hitDistance: i.hitDistance } : {}) };
    };
    return {
      signals: ctx.signals,
      dispatch(frame: ReplayFrame) {
        const g = shGuides(frame);
        if (joint) {
          const r = joint.dispatchBoth({ diffuse: input(frame, 'sh-diffuse'), specular: input(frame, 'sh-specular') as never }, g, frame.camera);
          return { 'sh-diffuse': r.diffuse, 'sh-specular': r.specular };
        }
        const out: Partial<Record<SignalName, GPUTexture>> = {};
        for (const [s, d] of dens) out[s] = (d as DiffuseDenoiser).dispatch(input(frame, s as 'sh-diffuse' | 'sh-specular') as never, g, frame.camera);
        return out;
      },
      resetHistory() { for (const d of new Set(dens.values())) d.resetHistory(); },
      gpuTimings() {
        const m = new Map<string, number>();
        for (const [s, d] of dens) for (const [k, v] of d.gpuTimings ?? []) m.set(dens.size > 1 && !joint ? `${s}/${k}` : k, v);
        return m;
      },
      dispose() { for (const d of new Set(dens.values())) d.dispose(); },
    };
  };
}
registerDenoiser({
  id: 'svgf-sh', description: "denoiser/realtime SVGF (antiLag 'off'), SH payload (M7): filter normal = normal_geom, fused resolve at the shading normal", signals: ['sh-diffuse', 'sh-specular'],
  create: svgfSh({ antiLag: 'off' }),
});
registerDenoiser({
  id: 'svgf-sh-auto', description: "denoiser/realtime A-SVGF (antiLag 'auto'), SH payload (M7)", signals: ['sh-diffuse', 'sh-specular'],
  create: svgfSh({ antiLag: 'auto' }),
});
