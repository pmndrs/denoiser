// Denoiser registry: id -> factory + which signals it consumes + how to build its
// inputs from the test bed's textures. Select with `?denoiser=id[,id...]`.
//
// Every entry returns a `TemporalDenoiser` (packages/denoiser-core/src/temporal.ts),
// so anything that implements that interface plugs in here unchanged.
import * as FFX from '@pmndrs/denoiser-ffx';
import type { TemporalDenoiser } from '@pmndrs/denoiser-ffx';
import { AccumulateDenoiser, PassthroughDenoiser } from './accumulate';
import type { SceneSignals, Signal } from './signals';

export interface DenoiserEntry {
  id: string;
  label: string;
  /** signals this denoiser can consume */
  signals: Signal[];
  create(device: GPUDevice, signal: Signal, q: URLSearchParams): TemporalDenoiser<object>;
  /** the signal-specific `inputs` argument of dispatch() */
  inputs(s: SceneSignals, signal: Signal): object;
}

const ALL: Signal[] = ['diffuse', 'specular', 'shadows'];
/** generic `{ signal }` inputs of the test-bed baselines */
const signalInputs = (s: SceneSignals, signal: Signal) => ({ signal: s.signal(signal).noisy });
/** `ShadowInputs` (visibility + occluder distance) */
const shadowInputs = (s: SceneSignals) => ({ visibility: s.textures.visibility, hitDistance: s.textures.occluderDist });
/** `SpecularInputs` / `DiffuseInputs` (radiance + hit distance) */
const radianceInputs = (s: SceneSignals, signal: Signal) => {
  const t = s.signal(signal);
  return { radiance: t.noisy, hitDistance: t.hitT };
};

export const DENOISERS: DenoiserEntry[] = [
  {
    id: 'passthrough', label: 'passthrough (noisy input)', signals: ALL,
    create: (device) => new PassthroughDenoiser(device),
    inputs: signalInputs,
  },
  {
    id: 'accumulate', label: 'temporal accumulation (32 frames, no clamp)', signals: ALL,
    create: (device, _s, q) => new AccumulateDenoiser(device, { maxFrames: Number(q.get('accN') ?? 32) }),
    inputs: signalInputs,
  },
  {
    id: 'accumulate-8', label: 'temporal accumulation (8 frames, no clamp)', signals: ALL,
    create: (device) => new AccumulateDenoiser(device, { maxFrames: 8 }),
    inputs: signalInputs,
  },
  {
    id: 'ffx-shadows', label: 'FidelityFX shadows (WGSL port)', signals: ['shadows'],
    create: (device) => new FFX.FfxShadowDenoiser(device) as TemporalDenoiser<object>,
    inputs: shadowInputs,
  },
  {
    // FFX reflections on the demodulated specular signal. (It also runs on diffuse,
    // where it acts as a generic radiance filter with roughness = the surface's; that
    // is not what it was designed for, so it is only registered for specular.)
    id: 'ffx-reflections', label: 'FidelityFX reflections (WGSL port)', signals: ['specular'],
    create: (device, _s, q) => new FFX.FfxReflectionDenoiser(device, {
      ...(q.has('tsf') ? { temporalStabilityFactor: Number(q.get('tsf')) } : {}),
    }) as TemporalDenoiser<object>,
    inputs: radianceInputs,
  },

  // ---------------------------------------------------------------------------
  // denoiser/realtime (packages/denoiser-realtime) goes HERE once it exports its
  // denoisers (T1.2 SVGF diffuse, T1.3 SVGF specular, T1.4 A-SVGF; later the
  // recurrent diffuse/specular, shadows, occlusion). Not imported yet on purpose:
  // the package is being built in parallel. Sketch:
  //
  //   import * as RT from '@pmndrs/denoiser-realtime';   // + vite alias like denoiser-ffx
  //   {
  //     id: 'svgf', label: 'SVGF (denoiser/realtime)', signals: ['diffuse', 'specular'],
  //     create: (device, signal) => new RT.SvgfDenoiser(device, { signal }),
  //     inputs: radianceInputs,
  //   },
  //
  // Guides passed to every dispatch include the optional 2.5D fields
  // (`guides.viewZ`, `guides.motionZ`) and `albedo`; see main.ts `guides`.
  // ---------------------------------------------------------------------------
];

export const denoiserById = (id: string) => DENOISERS.find((d) => d.id === id);

/** default denoisers per signal (used when ?denoiser= is absent) */
export const defaultDenoisers = (signal: Signal) =>
  DENOISERS.filter((d) => d.signals.includes(signal) && d.id !== 'accumulate-8').map((d) => d.id);
