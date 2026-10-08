# denoiser

**WebGPU denoising for the web: OIDN for path-traced frames, FidelityFX for real-time shadows and reflections, three.js nodes for both.**

- **Single-image / progressive denoising** of path-traced frames with
  [Intel OIDN](https://github.com/RenderKit/oidn)'s pre-trained networks, matching
  native OIDN output. The network runs on an interchangeable runtime (hand-written
  WGSL, WebNN, Hugging Face kernels, onnxruntime-web); the default `AutoRuntime`
  uses WebNN fp16 for base/large models when WebNN is available and WGSL otherwise,
  and all of them read the upstream OIDN `.tza` weights. All pre/post-processing
  (normalization, layout, tiling, overlap blending, color transforms) is WGSL
  compute on the same `GPUDevice`, so the only CPU↔GPU round-trip is the one you ask
  for. Feed it images or `GPUTexture`s; get back `ImageData`, floats, or a texture.
- **Real-time temporal denoising** for raster and hybrid pipelines behind a
  `TemporalDenoiser` API: AMD FidelityFX shadow and reflection denoisers ported to
  WGSL (`denoiser/ffx`). OIDN 3 temporal is planned.
- **three.js `WebGPURenderer` / TSL nodes** (`denoiser/three`: `denoise()`,
  `ffxShadows()`, `ffxReflections()`) that share the renderer's `GPUDevice` and
  compose with `@pmndrs/upscaler` (FSR3).

Everything is validated on Apple GPUs only so far.

```sh
npm install denoiser
# optional: only for the opt-in ORT runtime (`denoiser/ort`)
npm install onnxruntime-web
```

`onnxruntime-web`, `three` (>= r185, for `denoiser/three`) and
`@huggingface/kernels` (for `denoiser/kernels`) are optional peer dependencies.

### Breaking changes (alpha)

**`denoiser` now defaults to `AutoRuntime`; ORT moved to `denoiser/ort`.**

- The root entry no longer re-exports `denoiser/ort` (`OrtRuntime`, `OrtSession`,
  `DenoiseEngine`, `Models`) and never loads onnxruntime-web, which is now an
  **optional** peer dependency (install it only to use `denoiser/ort`).
- The ORT-only `Denoiser.create` options `weightsUrl`, `wasmPaths`, `graphCapture` and
  `splitAux` are gone from the root. They are `OrtRuntime` options now.
- New root options: `tzaUrl` (base URL of the OIDN `.tza` weights) and `device` (run
  on an existing `GPUDevice`, such as a three.js renderer's).
- Why: per the evals (`docs/status/eval-2026-10-07.md`,
  `docs/status/eval-2026-10-08-quiet.md`), ORT computes the `*_alb`, `*_alb_nrm` and
  `*_large` models wrong, while WGSL and WebNN match native OIDN and are faster.

```ts
// before
const denoiser = await Denoiser.create({ weightsUrl: '/models', splitAux: true, precision: 'fp16' });
// after, same behaviour (opt in to ORT explicitly; `npm i onnxruntime-web`)
import { OrtRuntime } from 'denoiser/ort';
const denoiser = await Denoiser.create({
  runtime: new OrtRuntime({ weightsUrl: '/models', splitAux: true }),
  precision: 'fp16',
});
// after, recommended: the default runtime, with .tza weights
const denoiser = await Denoiser.create({ precision: 'fp16', tzaUrl: '/tzas' });
```

If you shared the device with three.js by creating the denoiser first, that still works
with ORT. With the default runtime, create the renderer first and pass
`device: renderer.backend.device` (see below).


## Quick start (image in, ImageData out)

```ts
import { Denoiser } from 'denoiser';

const denoiser = await Denoiser.create();
const clean = await denoiser.denoise(noisyImageElement); // ImageData
canvas.getContext('2d').putImageData(clean, 0, 0);
```

## Zero-copy GPU pipeline (three.js / render targets)

The integration path for renderers: **pathtracer → denoiser → render target**,
no CPU pixels anywhere. Execution is stateless — everything about a run is in
the call:

```ts
// renderer first, then the denoiser on the renderer's device (see Device sharing below)
const renderer = new THREE.WebGPURenderer({ canvas });
await renderer.init();
const denoiser = await Denoiser.create({
  precision: 'fp16',
  device: renderer.backend.device,
});

const result = await denoiser.denoiseTextures({
  color: tracerGpuTexture,     // float, linear HDR
  albedo, normal,              // optional aux planes -> guided model auto-selected
  hdr: true,                   // OIDN PU transfer + autoexposure applied
  inputFlipY: true,            // render targets are bottom-up
  output: threeStorageGpuTexture, // optional caller-owned target
  transfer: 'linear',          // or 'srgb' | 'aces-srgb' (display-ready)
});
// ...render the texture like any other three.js texture
```

This is fast enough to denoise progressively **while a path tracer accumulates**.
See `examples/three-pathtracer-webgpu` (live-denoise checkbox) for the full loop, and
the [three.js & TSL guide](../../docs/site/guides/three-and-tsl.mdx) for the
`denoise()`, `ffxShadows()` and `ffxReflections()` nodes in `denoiser/three`.

### Aux inputs (albedo + normal)

OIDN's aux-guided models sharply improve quality at low sample counts. Rasterize
albedo (base color) and view-normals into float textures (e.g. a three.js MRT
target) and pass them with the call — the matching model is selected automatically:

```ts
await denoiser.denoiseTextures({
  color,
  albedo: albedoGpuTexture, // [0,1] floats
  normal: normalGpuTexture, // [-1,1] floats
  hdr: true,
});
```

Rasterized aux is noise-free, so the `cleanAux` (`calb_cnrm`) models apply. The
image path takes aux the same way: `denoiser.denoise(color, { albedo, normal })`
(RGBA8; normals encoded [0,1] are mapped to [-1,1] internally).

Full three.js walkthrough (unwrapping render targets, output-into-three,
orientation, pitfalls): [`docs/guides/three-js-render-targets.md`](../../docs/guides/three-js-render-targets.md).
Coming from the 0.x TFJS API: [`docs/guides/migrating-from-v1.md`](../../docs/guides/migrating-from-v1.md).

## How it runs fast

- **Whole-frame inference**: images up to ~1080p (configurable) run through the
  U-Net in ONE network run — no tiling, no overlap redundancy, no seams.
- **Adaptive tiling**: bigger images fall back to 1024/512/256 tiles (batched
  per run, sigmoid overlap blending) based on a pixel budget and the device's
  buffer limits.
- **fp16 end-to-end**: `Denoiser.create({ precision: 'fp16' })` uses fp16 models,
  tensors, and WGSL IO (needs the `shader-f16` feature; falls back to fp32).
  On the ORT runtime that measured ~15% faster, PSNR vs fp32 ≈ 53dB (visually
  identical). WebNN is used for fp16 only.
- Everything between input and output stays on the GPU.

Per-runtime speed and quality (1080p, Apple M5 Pro, Chrome 154) are in
`docs/status/eval-2026-10-08-quiet.md` and summarized in the
[runtime guide](../../docs/site/guides/choosing-a-runtime.mdx). The older figures
(512² 13.7 ms, 720p 45 ms, 1080p 104 ms, fp16) were measured on the ORT runtime,
which is no longer the default. `balanced` is meaningfully slower than `fast`;
benchmark with `examples/bench` for your sizes.

## Device sharing & lifetime — READ THIS if you pass `denoiser.device` around

With the default runtime you can either hand it your device or take its device:

```ts
// renderer first (clean flow): the denoiser adopts the renderer's device
const denoiser = await Denoiser.create({ device: renderer.backend.device });
// or: createDenoiserForRenderer(renderer, { runtime }) from 'denoiser/three'

// denoiser first: the renderer adopts the denoiser's device
const renderer = new THREE.WebGPURenderer({ device: denoiser.device });
```

Without `device`, the runtime creates one with the adapter's **max limits +
features**, enough for whole-frame U-Net intermediates and a path tracer's pipelines.
If you pass your own device, request high limits when you create it.

The exception is the opt-in ORT runtime (`denoiser/ort`): onnxruntime-web **creates
and owns the `GPUDevice`** (it ignores an injected one —
[onnxruntime#26107](https://github.com/microsoft/onnxruntime/issues/26107)). With ORT
build the denoiser FIRST and hand `denoiser.device` to `WebGPURenderer`.
`createDenoiserForRenderer` throws for ORT.

Lifetime rules:

1. **With ORT, `destroyDevice()` destroys the shared device.** When the last ORT
   session is released, ORT destroys its device — three.js, canvas contexts, and every
   resource on it die with it (`GPUDevice.lost`, reason `'destroyed'`).
   `dispose()` is the safe between-workloads cleanup: it frees buffers and
   extra sessions but retains one so the device survives. `AutoRuntime` never
   destroys a device you pass in.
2. Model switches are safe: `Denoiser` overlaps the new engine's creation with
   the old one's disposal precisely so the session count never hits zero
   mid-swap. Don't "optimize" that ordering away.

## API sketch (v2 — stateless per call)

| | |
|---|---|
| `await Denoiser.create(opts?)` | `precision`, `quality`, `tzaUrl`, `device`, `maxRunPixels`, `batch`, `runtime` (default `AutoRuntime`) |
| `denoise(imageLike, opts?)` | → `ImageData`; opts: `albedo`, `normal`, `srgb`, `flipY`, `onProgress` |
| `denoiseToFloat(imageLike, opts?)` | → normalized `Float32Array` |
| `denoiseTextures(opts)` | → `GPUTexture`; opts: `color`, `albedo`, `normal`, `hdr`, `inputScale`, `inputFlipY`, `auxInputFlipY`, `output`, `transfer`, `outputFlipY` |
| `abort()` | drop the in-flight run's result |
| `dispose()` | free buffers/extra sessions, KEEP the device |
| `destroyDevice()` | full teardown (kills the shared device) |
| `on('progress' \| 'executed', cb)` | events; returns an off() fn |
| info | `device`, `stats` (per-stage timings), `quality` (mutable) |

Orientation: WebGPU render targets read bottom-up — set `inputFlipY`. If your
aux planes come from a raster pass their convention can differ from a
compute-written color texture; `auxInputFlipY` handles that independently.

The ORT-only options (`weightsUrl`, `wasmPaths`, `graphCapture`, `splitAux`) are
`OrtRuntime` options (`import { OrtRuntime } from 'denoiser/ort'`). `graphCapture` is
opt-in and off by default: it measured no gain (the workload is GPU-bound) and
onnxruntime-web 1.27 captured sessions crash after roughly 150–250 cumulative
replays regardless of GPU syncs — unusable for live loops (standalone reproduction:
the `ort-webgpu-graphcapture-repro` repo).

## Models / weights

Which weights are fetched depends on the runtime.

**Default runtime (`AutoRuntime`, `denoiser/wgsl`, `denoiser/webnn`, `denoiser/kernels`):**
the upstream OIDN `.tza` files, one per configuration (quality × hdr × aux), fetched
individually — a page never downloads the full set. From this repo's `tzas/`:
`*_small` ~0.6 MB, base ~1.8 MB, `*_large` up to ~7.7 MB (one set for both
precisions).

Point `tzaUrl` at wherever the files live — it's just static hosting:

```ts
const denoiser = await Denoiser.create({ tzaUrl: '/tzas' });
```

- **Production: host them yourself.** Copy the `.tza` files into your app's static
  assets (or your own CDN) and pin `tzaUrl`. Don't build a product on someone else's
  default URL.
- **Default:** `https://cdn.jsdelivr.net/gh/pmndrs/denoiser-weights@models-v3/tzas`
  (`DEFAULT_TZA_URL`), sha256-identical to RenderKit/oidn-weights, served by
  jsDelivr's GitHub endpoint.

**ORT runtime (`denoiser/ort`):** converted `.onnx` models, from `weightsUrl`:

```ts
import { OrtRuntime } from 'denoiser/ort';
const denoiser = await Denoiser.create({ runtime: new OrtRuntime({ weightsUrl: '/models' }) });
```

| variant | fp16 | fp32 |
|---|---|---|
| `*_small` (quality: fast) | ~0.6 MB | ~1.3 MB |
| base (balanced) | ~1.8 MB | ~3.6 MB |
| `*_large` (high) | ~7.3 MB | ~14.7 MB |

Full `.onnx` set (all RT + lightmap variants, both precisions): 46 files, ~144 MB
(96 MB fp32 + 48 MB fp16).

- **Production: host them yourself.** Copy the `models/` dir into your app's static
  assets and pin `weightsUrl`.
- **Default scheme: plain git + jsDelivr's GitHub endpoint.** The models are
  committed as ordinary git blobs (NOT LFS — jsDelivr can't resolve LFS
  pointers) and served version-pinned from
  `https://cdn.jsdelivr.net/gh/pmndrs/denoiser-weights@models-v2/models/<file>.onnx`.
  Verified: `access-control-allow-origin: *`, range requests, multi-provider
  CDN. `models-v2` is `models-v1` plus the `*.tail.onnx`/`*.enc0.bin` split-aux
  artifacts that the default-on `splitAux` option fetches for the 9-channel aux
  models; self-hosters should mirror `models-v2` (or set `splitAux: false`).
- ORT computes the `*_alb`, `*_alb_nrm` and `*_large` models wrong (see the evals);
  prefer the default runtime.

**Hosting dead ends (verified, so you don't re-litigate it):**

- **GitHub Releases assets**: no `access-control-allow-origin` on the download
  path (`release-assets.githubusercontent.com`), even on GET with an `Origin` —
  browser `fetch()` fails CORS. Fine for CLIs, useless as a web default.
- **Models inside the npm package**: every `npm install` would pull the full
  144 MB, and jsDelivr enforces a ~50 MB **total package** limit
  ([jsdelivr#18294](https://github.com/jsdelivr/jsdelivr/issues/18294)) — it would
  refuse the package outright.
- **`raw.githubusercontent.com`**: CORS is fine, but `cache-control:
  max-age=300` and GitHub discourages hotlinking — dev fallback only.
- GitHub Pages also works (verified CORS `*`) if you'd rather publish a branch than
  rely on jsDelivr.

The `.onnx` models are produced from the `.tza` weights offline by
`tools/onnx-convert` (Python, no PyTorch); only the ORT runtime needs them.

## License

MIT. OIDN weights are Apache-2.0 (© Intel) — see `tzas/LICENSE.txt`.
