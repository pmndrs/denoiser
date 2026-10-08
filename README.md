![title-card-resized](https://github.com/DennisSmolek/Denoiser/assets/1397052/ffe87fd5-00e6-464e-b8a2-ba80402b9d2f)

## WebGPU denoising for the web.

#### Path-traced frames with [Intel OIDN](https://github.com/RenderKit/oidn)'s networks, real-time shadows and reflections with AMD FidelityFX, and three.js nodes, all on one `GPUDevice`

Denoiser is a WebGPU denoising library for the web, in three parts:

1. **Single-image and progressive denoising** of path-traced frames with Intel OIDN's
   pre-trained networks, matching native OIDN output. The network runs on an
   interchangeable runtime (hand-written WGSL, WebNN, Hugging Face kernels, or
   onnxruntime-web); `AutoRuntime` is the default and picks WebNN fp16 for base/large
   models when available, WGSL otherwise. All pre/post-processing (normalization,
   tiling, overlap blending, color transforms) is WGSL compute on the same
   `GPUDevice`. Images up to ~1080p denoise in a single model run, fast enough to
   denoise progressively while a path tracer accumulates. Per-runtime speed and
   quality are in the [runtime guide](docs/site/guides/choosing-a-runtime.mdx).
2. **Real-time temporal denoisers** for raster and hybrid pipelines, behind a
   `TemporalDenoiser` API: AMD's FidelityFX shadow and reflection denoisers ported
   to WGSL (`denoiser/ffx`). An OIDN 3 temporal model is planned. See the
   [real-time guide](docs/site/guides/realtime-temporal-denoising.mdx).
3. **three.js `WebGPURenderer` / TSL nodes** (`denoise()`, `ffxShadows()`,
   `ffxReflections()`) that share the renderer's `GPUDevice` and compose with
   [@pmndrs/upscaler](https://github.com/pmndrs/upscaler) (FSR3). See the
   [three.js & TSL guide](docs/site/guides/three-and-tsl.mdx).

Everything is validated on Apple GPUs only so far.
[onnxruntime-web](https://onnxruntime.ai/) is an opt-in runtime (`denoiser/ort`,
optional peer dependency).

> **v2 note:** the library was rewritten from TensorFlow.js (abandoned) to
> WebGPU, with a new **stateless per-call API** (clean break).
> Coming from 0.x? See the
> [migration guide](docs/guides/migrating-from-v1.md).
>
> **Breaking (alpha): `AutoRuntime` is now the default and ORT moved to
> `denoiser/ort`.** The root entry no longer re-exports ORT, `onnxruntime-web` is an
> optional peer dependency, and `weightsUrl` / `wasmPaths` / `graphCapture` /
> `splitAux` are `OrtRuntime` options now (new root options: `tzaUrl`, `device`):
>
> ```ts
> // before
> await Denoiser.create({ weightsUrl: '/models', splitAux: true });
> // after (explicit ORT; npm i onnxruntime-web)
> import { OrtRuntime } from "denoiser/ort";
> await Denoiser.create({ runtime: new OrtRuntime({ weightsUrl: '/models', splitAux: true }) });
> ```
>
> Details: [packages/denoiser/README.md](packages/denoiser/README.md#breaking-changes-alpha).

### Basic example

```ts
import { Denoiser } from "denoiser";

const denoiser = await Denoiser.create();
const clean = await denoiser.denoise(document.getElementById("noisy-img")); // ImageData
canvas.getContext("2d").putImageData(clean, 0, 0);
```

### Zero-copy GPU pipeline (three.js)

Create the renderer first, run the denoiser on its `GPUDevice`, and run render
targets straight through — pathtracer → denoiser → render target, no CPU pixels:

```ts
const renderer = new THREE.WebGPURenderer({ canvas });
await renderer.init();
const denoiser = await Denoiser.create({ precision: "fp16", device: renderer.backend.device });

const out = await denoiser.denoiseTextures({
  color: tracerGpuTexture,   // float, linear HDR
  albedo, normal,            // optional MRT G-buffer -> guided model auto-selected
  hdr: true,
  // inputFlipY: true,       // only for bottom-up sources (e.g. some WebGL readbacks)
  output: myStorageTexture,  // optional: resolve into a texture three.js samples
});
```

**Docs:**
- [`packages/denoiser/README.md`](packages/denoiser/README.md) — install, API sketch, device-lifetime rules.
- [`docs/guides/three-js-render-targets.md`](docs/guides/three-js-render-targets.md) — render targets in/out, full parameter reference, pitfalls.
- [`docs/guides/migrating-from-v1.md`](docs/guides/migrating-from-v1.md) — 0.x → 2.x mapping.
- [`docs/`](docs/README.md) — index: status/next actions, specs, perf results.

### Examples (`/examples`)

- `three-pathtracer-webgpu` — three.js `WebGPUPathTracer` → denoiser on one
  shared device: CPU vs zero-copy paths, live progressive denoising, MRT
  G-buffer aux.
- `bench` — the performance harness (sizes × precision × quality, PSNR parity).
- `denoiser-package-test` — minimal end-to-end package test.
- `webgpu-ort-smoke` — low-level ORT/WGSL engine harness.
- `three-temporal`, `realtime-compare` — the `denoiser/three` TSL nodes
  (`ffxShadows`, `ffxReflections`, `denoise`); see the
  [three.js & TSL guide](docs/site/guides/three-and-tsl.mdx).

### Repo layout

- `packages/denoiser` — the library (npm: `denoiser`).
- `tools/onnx-convert` — Python tooling that builds the ONNX U-Nets directly
  from OIDN `.tza` weights (no PyTorch). Only the opt-in ORT runtime uses them;
  the default runtime reads the `.tza` weights directly. Weights are hosted
  separately from the library (a page only fetches the one file it uses) — see
  [Hosting the weights](packages/denoiser/README.md#models--weights).
- `docs/` — guides (three.js interop, v1→v2 migration), status/next actions,
  specs, and the perf plan + measured results.

### Development

```sh
corepack yarn install
cd packages/denoiser && yarn build

# convert models once (serves at /models in the example dev servers)
cd tools/onnx-convert && python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
python convert.py ../../packages/denoiser/tzas/*.tza -o ../../packages/denoiser/models
python convert.py ../../packages/denoiser/tzas/*.tza -o ../../packages/denoiser/models --fp16

cd examples/three-pathtracer-webgpu && yarn dev
```

### License

MIT. OIDN weights are Apache-2.0 (© Intel) — see `packages/denoiser/tzas/LICENSE.txt`.
