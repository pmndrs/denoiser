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
//   svgf               denoiser/realtime SVGF, diffuse + specular (DiffuseSpecularDenoiser,
//                      dispatchBoth; a single requested signal runs that signal's class)
//   svgf-auto          the same with A-SVGF anti-lag 'auto' (renderer-free gradients)
//   svgf-diffuse       DiffuseDenoiser alone;  svgf-specular  SpecularDenoiser alone
//   (svgf settings from the URL: see svgfOptions(); antiLag 'gradient' needs renderer
//   gradient samples that neither the test bed nor the captures provide)
//   recurrent          denoiser/realtime recurrent blur (provisional, SPEC v0 §5) for diffuse AND
//                      specular in shared dispatches (DiffuseSpecularDenoiser, dispatchBoth; a single
//                      requested signal runs that signal's class with the same options)
//   recurrent-svgfspec recurrent diffuse + SVGF (antiLag 'auto') specular, two pipelines
//   recurrent-diffuse  DiffuseDenoiser alone;  recurrent-specular  SpecularDenoiser alone
//   (recurrent settings from the URL: see recurrentOptions(); the output texture rotates
//   between internal buffers, valid until the next dispatch)
//   shadows            denoiser/realtime ShadowDenoiser (visibility; provisional, SPEC v0 §7): the
//                      light comes from the frame's `lights` (test bed / per-frame extras) or the
//                      manifest's; settings `sh.<option>=v` (see shadowOptions())
//   ffx-shadows        @pmndrs/denoiser-ffx FfxShadowDenoiser (visibility)
//   ffx-reflections    @pmndrs/denoiser-ffx FfxReflectionDenoiser (specular)
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
import type { DenoiserEntry, ReplayDenoiser, ReplayFrame } from './replay';
import type { CaptureLight, SignalName } from './format';

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
  create: svgfJoint({}),
});
registerDenoiser({
  id: 'svgf-auto', description: "denoiser/realtime A-SVGF (antiLag 'auto'), diffuse + specular", signals: ['diffuse', 'specular'],
  create: svgfJoint({ antiLag: 'auto' }),
});
registerDenoiser({
  id: 'svgf-diffuse', description: 'denoiser/realtime SVGF DiffuseDenoiser', signals: ['diffuse'],
  create: perSignal((device, _s, st) => new DiffuseDenoiser(device, svgfOptions(st))),
});
registerDenoiser({
  id: 'svgf-specular', description: 'denoiser/realtime SVGF SpecularDenoiser (needs roughness)', signals: ['specular'],
  create: perSignal((device, _s, st) => new SpecularDenoiser(device, svgfOptions(st))),
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
 * ShadowDenoiser options from settings: `sh.<option>=v` (numbers or true/false). Two input
 * switches for experiments: `sh.light=none` (no light: noise-driven radius) and
 * `sh.hit=none` (drop the occluder distance).
 */
export function shadowOptions(st: Record<string, string>): ShadowDenoiserOptions {
  const o: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(st)) {
    if (k === 'sh.light' || k === 'sh.hit') continue;
    if (k.startsWith('sh.')) o[k.slice(3)] = v === 'true' ? true : v === 'false' ? false : Number(v);
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
    const noHit = ctx.settings['sh.hit'] === 'none';
    return {
      signals: ['visibility'],
      dispatch(frame: ReplayFrame) {
        const inp = frame.inputs.visibility;
        if (!inp) throw new Error('shadows: capture has no visibility input');
        // per-frame lights (test bed extras, CAPTURE-FORMAT v1 proposal) before the capture's
        const light = noLight ? undefined
          : shadowLightOf(frame.meta?.lights as CaptureLight[] | undefined) ?? shadowLightOf(frame.manifest.lights);
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
