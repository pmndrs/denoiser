// The test bed's view of the project's ONE denoiser registry,
// tools/rt-capture/src/denoisers.ts (single source of truth: register a denoiser there
// once and it runs here live, in capture-replay (`mode=replay`) and on the replay page).
// This file only maps names: the registry speaks capture signal names
// (`diffuse`, `specular`, `visibility`); the test bed calls visibility `shadows`.
//
// Each (signal, denoiser) pair gets its own ReplayDenoiser instance created with
// `signals: [that signal]`, fed a ReplayFrame built from the live SceneSignals textures
// (src/capture.ts `liveFrame`), the same structure the replay builds from a capture.
import { DENOISERS as REGISTRY } from '../../../tools/rt-capture/src/denoisers';
import type { DenoiserEntry as RegistryEntry } from '../../../tools/rt-capture/src/replay';
import type { SignalName } from '../../../tools/rt-capture/src/format';
import type { Signal } from './signals';

export interface DenoiserEntry {
  id: string;
  label: string;
  /** test-bed signals this denoiser can consume */
  signals: Signal[];
  /** the registry entry (create() returns a ReplayDenoiser) */
  entry: RegistryEntry;
}

export const toCaptureSignal = (s: Signal): SignalName => (s === 'shadows' ? 'visibility' : s);
export const fromCaptureSignal = (s: SignalName): Signal => (s === 'visibility' ? 'shadows' : s);

export const DENOISERS: DenoiserEntry[] = [...REGISTRY.values()].map((e) => ({
  id: e.id, label: e.description, signals: e.signals.map(fromCaptureSignal), entry: e,
}));

export const denoiserById = (id: string) => DENOISERS.find((d) => d.id === id);

/** registry baselines left out of the default set (still selectable with ?denoiser=) */
const NOT_DEFAULT = new Set(['accumulate', 'accumulate-static', 'accumulate-8']);

/** default denoisers per signal (used when ?denoiser= is absent) */
export const defaultDenoisers = (signal: Signal) =>
  DENOISERS.filter((d) => d.signals.includes(signal) && !NOT_DEFAULT.has(d.id)).map((d) => d.id);
