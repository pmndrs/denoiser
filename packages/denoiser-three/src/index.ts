// `denoiser/three` — three.js (WebGPURenderer / TSL) integration.
//   shared/   raw GPU handles + camera history (this file's exports)
//   temporal/ TSL nodes for TemporalDenoisers (FidelityFX shadows, reflections)
//   image/    TSL node for the single-image Denoiser (any NetworkRuntime)
export { getDevice, getGPUTexture, CameraHistory } from './shared/three';
export { DenoiseNode, denoise, createDenoiserForRenderer } from './image';
export type { DenoiseNodeOptions, CreateDenoiserForRendererOptions } from './image';
export { TemporalDenoiseNode, temporalDenoise, denoiseNodeObject, resolveTexture } from './temporal/TemporalDenoiseNode';
export type { TemporalDenoiseNodeObject, TemporalGuideNodes, TemporalDenoiseNodeOptions, TextureNodeLike } from './temporal/TemporalDenoiseNode';
export { ffxShadows, ffxReflections } from './temporal/ffx';
export type { FfxGuideOptions, FfxShadowsOptions, FfxReflectionsOptions } from './temporal/ffx';
export { worldNormalTexture, toSignalTexture } from './temporal/tsl';
export type { NormalSpace, NormalEncoding } from './temporal/tsl';
