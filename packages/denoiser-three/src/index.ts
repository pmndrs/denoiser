// `denoiser/three` — three.js (WebGPURenderer / TSL) integration.
//   shared/   raw GPU handles + camera history (this file's exports)
//   temporal/ TSL nodes for TemporalDenoisers (FidelityFX shadows, reflections)
//   image/    TSL node for the single-image Denoiser (any NetworkRuntime)
export { getDevice, getGPUTexture, CameraHistory } from './shared/three';
export { DenoiseNode, denoise, createDenoiserForRenderer } from './image';
export type { DenoiseNodeOptions, CreateDenoiserForRendererOptions } from './image';
