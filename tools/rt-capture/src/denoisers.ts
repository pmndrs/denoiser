// Denoisers the replay can run, by id. Add one with registerDenoiser(); single-signal
// TemporalDenoisers wrap with perSignal(). A joint denoiser (e.g. diffuse + specular in
// one dispatch) implements ReplayDenoiser directly and returns both outputs.
//
//   passthrough        the noisy input, unchanged (the "noisy" baseline through the same path)
//   accumulate         reprojected running mean (our analogue of native REFERENCE; M0 sanity)
//   accumulate-static  running mean without reprojection (static-camera captures)
//   ffx-shadows        @pmndrs/denoiser-ffx FfxShadowDenoiser (visibility)
//   ffx-reflections    @pmndrs/denoiser-ffx FfxReflectionDenoiser (specular)
//
// Settings come from the replay page's URL (?denoiser=accumulate&maxFrames=64 ...).
import type { TemporalDenoiser } from '../../../packages/denoiser-core/src/temporal';
// relative source import: works from any page without a package alias or a built dist
import { FfxReflectionDenoiser, FfxShadowDenoiser } from '../../../packages/denoiser-ffx/src/index';
import { AccumulateDenoiser } from './accumulate';
import type { DenoiserEntry, ReplayDenoiser, ReplayFrame } from './replay';
import type { SignalName } from './format';

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
