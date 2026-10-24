// @pmndrs/denoiser-realtime — real-time per-signal denoisers for WebGPU (WGSL),
// written from public papers (clean room; see
// docs/research/rt-denoiser/RULES.md and PROVENANCE.md). Users import it as
// `denoiser/realtime`, which also re-exports the FidelityFX denoisers.
export { DiffuseDenoiser, SpecularDenoiser, DiffuseSpecularDenoiser } from './denoisers';
export type {
  DiffuseDenoiserOptions, SpecularDenoiserOptions, DiffuseSpecularDenoiserOptions, DiffuseSpecularOutputs,
  RealtimeDiffuseInputs, RealtimeSpecularInputs, RealtimeDiffuseSpecularInputs, SignalExtras, SignalOptions,
} from './denoisers';
export type { RecurrentOptions } from './recurrent';
export type { SvgfOptions, SpecularSvgfOptions } from './svgf';
export type {
  TemporalDenoiser, TemporalConfig, FrameCamera, FrameGuides, DiffuseInputs, SpecularInputs,
  DiffuseSpecularInputs, Mat4,
} from '@pmndrs/denoiser-core';
export { ShadowDenoiser, type ShadowDenoiserOptions } from './shadow';
export type { ShadowInputs, ShadowLight } from '@pmndrs/denoiser-core';
