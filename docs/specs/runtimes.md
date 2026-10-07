# Network runtimes: one engine, many executors

> Status 2026-10-07: **steps 1–2 done** — runtime seam inside `packages/denoiser`
> (outputs byte-identical), and an experimental `KernelsRuntime`
> (`examples/kernels-smoke/src/kernelsRuntime.ts`) driving the unchanged `Denoiser`
> facade. Next: the package split.

## Why

The roadmap has several things that all want to run "a denoising network on
WebGPU" without rebuilding the tooling each time:

1. OIDN 2 on onnxruntime-web (shipping today)
2. OIDN 2 on `@huggingface/kernels` (faster per the spike below; also good for promotion)
3. OIDN 3 (temporal) on whichever of 1/2 wins
4. WebNN
5. Hand-written WGSL, then our own web-first denoiser

These split along two axes — the **model** (network + weights + pre/post) and
the **runtime** that executes it. OIDN 2 weights run unchanged on ORT, kernels,
WebNN or hand-written WGSL; only the executor differs. So the seam is between
the engine and the network, not around whole "engines".

## The seam (`packages/denoiser/src/runtime.ts`)

```
Denoiser ──► TiledEngine ──────────────────────────► NetworkRuntime.load(model)
             · model selection (Denoiser)                 │
             · geometry plan (whole-frame / tiled)        ▼
             · WGSL extract → binding.input          NetworkSession (device)
             · await binding.run()  ───────────────►   .bind(geometry) → NetworkBinding
             · WGSL accumulate ← binding.output            { input, output, run() }
             · resolve → pixels / texture
```

- The engine owns everything runtime-independent: tiling + overlap blend, sRGB /
  OIDN PU transfer + autoexposure, aux encoding, resolve, texture IO, stats.
- A runtime owns: fetching its model format, the device (create or adopt), and
  running NCHW `[B,C,H,W]` → `[B,3,H,W]` in the model precision **on that device**.
- ORT specifics stay in `ort/`: session-per-geometry (pinned free dims), the
  max-limits device patch, the static-dims fallback, the split-aux workaround.
- `DenoiseEngine` (2.x API) is now `TiledEngine` + an `OrtSession` from raw bytes.

Verified by `examples/bench` → `window.__regression()`: 16 output hashes (fp32 +
fp16 × image / linear+flip / CPU aux (split path) / 1280×720 whole-frame / tiled /
texture LDR / texture HDR+autoexposure / texture aux+ACES) are identical before
and after the refactor, and deterministic across runs.

## Kernels spike (`examples/kernels-smoke`)

OIDN's U-Net needs four ops, all on the Hub: `com.microsoft.FusedConv` (conv +
bias + relu6 as `Clip[0,6]`, NCHW, fp16/fp32, f32 accumulation), `ai.onnx.MaxPool`,
`ai.onnx.Resize` (nearest/floor/asymmetric), `ai.onnx.Concat`. The spike builds the
graph from the `.tza` weights (JS port of `tools/onnx-convert/convert.py`'s
builder) — 28 kernel calls, all GPU-resident except the final readback.

Headless Chrome, Apple GPU (Metal), `spheres` 4 spp 512², host in → host out for
both, warm median of 20, single run per mode:

| model / precision / device | max abs Δ vs ORT | PSNR vs reference (ORT → kernels) | ORT → kernels |
|---|---|---|---|
| `rt_ldr_small` fp32 separate | 1.4e-6 | 39.16 → 39.16 dB | 23.0 → 18.5 ms (1.24×) |
| `rt_ldr_small` fp32 shared | 1.6e-6 | 39.16 → 39.16 dB | 19.4 → 19.7 ms (0.98×) |
| `rt_ldr_small` fp16 separate | 7.3e-3 | 39.02 → 39.17 dB | 17.4 → 14.6 ms (1.19×) |
| `rt_ldr_small` fp16 shared | 7.3e-3 | 39.02 → 39.17 dB | 17.3 → 16.2 ms (1.07×) |
| `rt_ldr` fp32 separate | 1.1e-6 | 39.31 → 39.31 dB | 39.4 → 26.5 ms (1.49×) |
| `rt_ldr` fp16 shared | 5.9e-3 | 39.27 → 39.31 dB | 32.6 → 23.1 ms (1.41×) |

- fp32 matches ORT to rounding. Kernels fp16 is *closer to fp32* than ORT fp16.
- Gains grow with model size. First-run cost is 1.5–2.7 s (shader compile) vs
  40–350 ms for ORT — the runtime needs a warmup.

### Blockers in `@huggingface/kernels@0.0.1-preview.3`

1. **It creates its own `GPUDevice`** (`navigator.gpu.requestAdapter()` on the first
   call; no option to pass one). Our pre/post, ORT, three.js and `@pmndrs/upscaler`
   all share one device; a kernels result on another device can't be read without
   a CPU round trip ("is associated with [Device "webgpu-ml-runtime"], and cannot
   be used with [Device]").
2. **Only kernel-produced GPU tensors are accepted** — a hand-built
   `{ buffer, shape, dtype }` is refused, so the engine's NCHW input buffer can't
   be fed directly; weights also have to go through an `Identity` call to become
   resident. *Worked around* (zero-copy, below) by binding the engine to
   kernels-allocated tensors — relies on kernels not sub-allocating buffers.
3. `disposeSharedKernelRuntime()` calls `device.destroy()` — fatal once the device
   is shared.

Workaround for the demo (`examples/kernels-smoke/src/deviceShim.ts`, not for
shipping): answer kernels' one `requestAdapter()` with a fake adapter whose
`requestDevice()` returns our device. With it, kernels results are usable on our
device (verified). The loader isn't open source (npm bundle only), so these go
to HF as a request — draft below.

### KernelsRuntime through the facade (`examples/kernels-smoke/facade.html`)

`Denoiser.create({ runtime: new KernelsRuntime({ tzaUrl }) })` vs the default ORT
runtime, same calls, spheres 512², warm median of 10:

| | `denoise()` | `denoise()` + albedo/normal (9ch) | `denoiseTextures()` |
|---|---|---|---|
| fp32 kernels vs ORT | max 1 LSB (94.3 dB) | max 1 LSB (93.3 dB) | max 1 LSB (95.3 dB) |
| fp16 kernels vs ORT | max 2 LSB (54.3 dB) | max 2 LSB (54.0 dB) | max 2 LSB (54.3 dB) |
| fp32 warm ORT → kernels | 18.1 → 16.9 ms | 21.5 → 20.6 ms | |
| fp16 warm ORT → kernels | 15.5 → 14.7 ms | 17.9 → 16.7 ms | |

- Kernels runs the 9-channel cleanAux model **directly** — no split-graph
  workaround — and matches ORT's workaround output: the ORT Conv bug is ORT-only.
- **Zero-copy IO** (default): blocker 2 is an `instanceof` check, and this preview
  gives every tensor its own buffer (`STORAGE|COPY_SRC|COPY_DST`, offset 0). So the
  binding allocates its input/output tensors via kernels once and hands their
  buffers to the engine; the last conv writes into the output tensor
  (`outputs: { y }`). No host sync inside the network step. Same outputs as the
  readback path, which stays behind `zeroCopy: false`:

| warm median | readback | zero-copy | ORT |
|---|---|---|---|
| 1920×1080 fp32 | 128.8 ms | **121.2 ms** (1.35× ORT) | 163.6 ms |
| 1920×1080 fp16 | 98.4 ms | **91.8 ms** (1.22× ORT) | 112.2 ms |
| 512² + aux fp32 | 20.2 ms | **16.1 ms** | 21.1 ms |

  What's left is GPU time plus 28 individually awaited kernel calls — the target
  for a fused, single-encoder hand-written runtime.

## Plan

1. ~~Runtime seam inside `packages/denoiser`, no public API change~~ ✓
2. ~~`KernelsRuntime` behind the seam (experimental)~~ ✓ — blocker 1 via the shim,
   blocker 2 via kernels-allocated IO tensors (zero-copy).
3. Package split: `@pmndrs/denoiser-core` (engine, ops, types), `-runtime-ort`,
   `-runtime-kernels`; `denoiser` stays the core + ORT preset (2.x compatible).
4. Bench + gallery + regression parametric over runtimes.
5. OIDN 3 on the winning runtime; add `createStream()` (temporal state, `reset()`)
   and `motion`/`depth` inputs once its inputs are public.
6. WebNN runtime; hand-written WGSL runtime (fusion, single encoder per frame),
   using kernels as the correctness/perf baseline.

## Appendix: request to Hugging Face (draft)

> **Title:** `@huggingface/kernels`: run on an existing `GPUDevice` / accept external `GPUBuffer`s
>
> We ported the Open Image Denoise U-Net (pmndrs/denoiser) to `@huggingface/kernels`
> — FusedConv/MaxPool/Resize/Concat, 28 calls per frame — and it beats
> onnxruntime-web by 1.2–1.5× with fp32 output identical to ORT (fp16 even closer to
> fp32 than ORT's). It also runs our 9-channel albedo/normal models correctly, which
> ORT-WebGPU miscomputes (we ship a split-graph workaround for that). Plugged into
> the full denoiser as a runtime it matches ORT to 1 LSB across image, aux and
> texture paths. Demo + numbers: <link to examples/kernels-smoke>.
>
> What blocks shipping it: the library always creates its own `GPUDevice`. Real-time
> graphics pipelines (three.js `WebGPURenderer` → denoiser → upscaler) share one
> device and hand textures/buffers between stages; on a second device every frame
> needs a CPU round trip. A 20-line `requestAdapter` shim that hands kernels our
> device works today (kernels outputs become usable on the shared device), so the
> runtime already supports it — it just isn't API.
>
> Ask:
> 1. `getKernel(..., { device })` or a `setKernelDevice(device)` / runtime option.
> 2. A way to wrap an external `GPUBuffer` as a `KernelGpuTensor`
>    (`fromGpuBuffer(buffer, { shape, dtype })`), so inputs written by our own WGSL
>    (and weights uploaded once) can be passed without an `Identity` hop.
> 3. `disposeSharedKernelRuntime()` not destroying a device it didn't create.
>
> Happy to test a preview build against our regression suite.
