# @pmndrs/denoiser-three

three.js integration (WebGPURenderer, TSL nodes) for pmndrs/denoiser.
**Internal workspace package — never published.** Ships inside the `denoiser`
package as the `denoiser/three` entry; `three` (>= r185) is an optional peer
dependency of `denoiser`.

- `shared/` — `getDevice(renderer)`, `getGPUTexture(renderer, texture)`,
  `CameraHistory` (three camera → `FrameCamera` with previous-frame matrices).
- `temporal/` — TSL nodes wrapping `TemporalDenoiser`s (FidelityFX shadows /
  reflections), conventions matching `@pmndrs/upscaler`'s `UpscalerNode`.
- `image/` — TSL node for the single-image `Denoiser` with a selectable runtime.
