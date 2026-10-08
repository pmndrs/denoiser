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

## `denoise()` — the single-image denoiser as a TSL node

The denoise is async GPU work (stills, converged path-tracer frames, progressive
refinement — not per-frame). The node shows its input until a result lands in its
own `rgba16float` StorageTexture, then swaps to it.

```ts
import { denoise, createDenoiserForRenderer } from 'denoiser/three';
import { WgslRuntime } from 'denoiser/wgsl';

await renderer.init();
const node = denoise(sceneColor, {            // any texture node / pass / TSL expression
  albedo, normal,                             // optional aux texture nodes (normal in [-1,1])
  hdr: true,                                  // linear HDR input (default)
  runtime: (device) => new WgslRuntime({ device }), // or `denoiser: await createDenoiserForRenderer(...)`
  when: () => pathTracer.samples >= 64,       // or `every: 30`, or call node.request()
});
post.outputNode = node;                       // renders input until node.denoised
// camera moved / accumulation restarted:  node.invalidate();
```

`request()`, `every` (frames) and `when()` start a run during the next render that
includes the node; `invalidate()` drops the shown/in-flight result; `settled()`
resolves when the in-flight run is done; `setAux()` swaps aux inputs;
`onDenoised(gpuTexture, ms)` fires per result. `transfer: 'linear'` (default) keeps
the output linear HDR so three's own tone mapping applies; `'aces-srgb'` bakes the
display transform in (present with a raw `fragmentNode` write).

### One GPUDevice: who creates it

| runtime | flow |
|---|---|
| `ort` (default `denoiser`) | denoiser first: `Denoiser.create()` → `new WebGPURenderer({ device: denoiser.device })`. ORT cannot adopt a device; `createDenoiserForRenderer` throws a pointed error. |
| `wgsl` (`WgslRuntime`) | renderer first: `await renderer.init()` → `createDenoiserForRenderer(renderer, { runtime: (device) => new WgslRuntime({ device }) })` |
| `webnn` (`WebnnRuntime`, Chrome flag) | same as wgsl (`device` option) |
| `kernels` (`KernelsRuntime`) | same, via the demo-only device shim; the first `KernelsRuntime` on a page picks the device for all |

Either way, request a high-limits device first for heavy pipelines (path tracers):
see `patchWebGPUForMaxLimits()` in `examples/_shared/stack.ts`, which also implements
the whole flow behind `?runtime=ort|wgsl|webnn|kernels`.
