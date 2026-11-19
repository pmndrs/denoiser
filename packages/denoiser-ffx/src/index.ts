// @pmndrs/denoiser-ffx — real-time TemporalDenoisers for WebGPU, ported to WGSL
// from AMD FidelityFX Denoiser (FidelityFX SDK v1.1.4, MIT; see NOTICE).
export { FfxShadowDenoiser } from './shadows';
export type { FfxShadowDenoiserOptions } from './shadows';
export { FfxReflectionDenoiser } from './reflections';
export type {
  FfxReflectionDenoiserOptions, FfxReflectionDenoiserRuntimeOptions, FfxReflectionInputs, FfxReflectionTileList,
} from './reflections';
export type {
  TemporalDenoiser, TemporalConfig, FrameCamera, FrameGuides, ShadowInputs, SpecularInputs, DiffuseInputs, Mat4,
} from '@pmndrs/denoiser-core';
// AMD GI-1.0's image-space GI denoiser, ported from AMD Capsaicin v1.3 (MIT; see NOTICE).
export { Gi1Denoiser } from './gi1';
export type { Gi1DenoiserOptions } from './gi1';
