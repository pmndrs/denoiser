// `denoiser/realtime` — per-frame TemporalDenoisers with history: our own
// diffuse / specular denoisers (SVGF, A-SVGF; WGSL, written from the published
// papers) plus the FidelityFX shadow / reflection denoisers re-exported, so
// `denoiser/realtime` is the one entry for real-time work (`denoiser/ffx`
// keeps working). No runtime dependencies.
export * from '@pmndrs/denoiser-realtime';
export { FfxShadowDenoiser, FfxReflectionDenoiser } from '@pmndrs/denoiser-ffx';
export type { FfxShadowDenoiserOptions, FfxReflectionDenoiserOptions, ShadowInputs } from '@pmndrs/denoiser-ffx';
