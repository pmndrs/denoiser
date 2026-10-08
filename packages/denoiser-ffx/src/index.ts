// @pmndrs/denoiser-ffx — real-time TemporalDenoisers for WebGPU, ported to WGSL
// from AMD FidelityFX Denoiser (FidelityFX SDK v1.1.4, MIT; see NOTICE).
export { FfxShadowDenoiser } from './shadows';
export type { FfxShadowDenoiserOptions } from './shadows';
export type {
  TemporalDenoiser, TemporalConfig, FrameCamera, FrameGuides, ShadowInputs, SpecularInputs, Mat4,
} from '@pmndrs/denoiser-core';
