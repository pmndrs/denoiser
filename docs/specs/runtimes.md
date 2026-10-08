# Network runtimes: one engine, many executors

> Status 2026-10-07: **steps 1–3 done** — runtime seam (outputs byte-identical),
> experimental `KernelsRuntime` driving the unchanged `Denoiser` facade with
> zero-copy IO, and the package split into internal workspaces shipped as
> subpath entries of `denoiser` (`denoiser/core`, `/ort`, `/kernels`, `/wgsl`).
> Bench, regression and gallery are runtime-parametric. Hand-written
> `WgslRuntime` (`denoiser/wgsl`, experimental): 2.5–3x faster than ORT, ~2x
> faster than kernels through the facade at matching parity (see "Hand-written
> WGSL runtime"). ORT-WebGPU miscomputes the large models — see that section.
> 2026-10-08: experimental `WebnnRuntime` (`denoiser/webnn`, Chrome flag only) —
> see "WebNN runtime".

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

`Denoiser.create({ runtime: new KernelsRuntime({ tzaUrl }) })` vs the ORT runtime (the default when this was measured)
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

## Hand-written WGSL runtime (`packages/denoiser-wgsl`, `examples/wgsl-bench`)

`WgslRuntime({ tzaUrl, device? })` — experimental, `private`. Same `.tza`
weights as kernels, same facade, no ML library. All 3/6/9-channel models,
standard + large topology, fp32 + fp16, batch > 1.

**Shape of a run.** The U-Net is 16 (std) / 19 (large) conv dispatches in **one
compute pass of one command encoder**; `run()` only encodes and submits (the
engine's accumulate/resolve is queued behind it on the same device, so there's no
host sync per run). Intermediates live in persistent per-geometry buffers
allocated in `bind()`, shared by liveness (a slot is reused once its last reader
ran). Every op is a fused conv (`graph.ts`):

- conv 3x3 + bias + relu6 in the epilogue (no activation on the last conv);
- maxpool folded into the producing conv: it writes the pooled tensor only (every
  pooled conv's full-res output feeds nothing but its pool);
- decoder convs read the 2x-upsampled tensor at `(y>>1, x>>1)` for the first
  channels and the skip for the rest: no materialized upsample or concat;
- the NCHW contract is met at the edges: the first conv and `dec_conv1a`'s skip
  read the binding's NCHW input planar, the last conv writes NCHW; everything in
  between is channel-packed NC4HW4 (vec4 of 4 channels).

**Two conv kernels.**

- *Portable* (`conv.ts`): direct conv, each thread owns 2x2 px x 8 output channels
  (vec4 accumulators, `mat4x4 * vec4` per tap), workgroup 8x8 threads, per
  4-channel chunk the (16+2)² input tile is staged in workgroup memory (zero pad,
  upsample and two-source concat resolved in the loader). fp32 models accumulate
  in f32. fp16 models keep weights + tile in f16 and sum each chunk's 36
  products (9 taps x 4 channels) in f16, adding to an f32 accumulator once per
  chunk — f16 FMA runs at 2x the f32 rate on this GPU.
- *Subgroup matrix* (`mma.ts`), when the device has
  `chromium-experimental-subgroup-matrix` (f32 8x8x8, 32-wide subgroups): the conv
  as an implicit GEMM on 8x8 matrices, one subgroup per workgroup (8x4 px x 32 oc),
  the 8-channel input patch staged as `[row][col][8]` so each (segment, tap)
  operand is one contiguous load; f32 accumulation. Used by default for fp32 only
  (for fp16 the portable kernel's f16 sums are faster). **Experimental Chrome
  feature** — today it needs `--enable-unsafe-webgpu`, so normal users get the
  portable kernel.

### Results — facade, M5 Pro (20-core GPU), headless Chrome, `spheres` 512²

Warm median of 15, the three runtimes **interleaved** one call per round (the
bench machine had other GPU load that swung sequential timings 2-3x; see
caveats). `denoise()` end to end (upload, pre/post, network, readback).

| fp32 | ORT | kernels | WGSL (subgroup matrix) | WGSL (portable) |
|---|---|---|---|---|
| 512² | 18.2 ms | 16.7 | **6.2** | 9.1 |
| 512² + albedo/normal (9ch) | 21.8 | 17.8 | **8.5** | 10.2 |
| 1920×1080 | 163.7 | 131.6 | **50.6** | 71.4 ¹ |
| 512² large (`rt_hdr_calb_cnrm_large`, textures) | 63.9 | 64.2 | **32.0** | — |

| fp16 | ORT | kernels | WGSL (portable, f16 sums) |
|---|---|---|---|
| 512² | 14.7 | 13.6 | **4.9** |
| 512² + albedo/normal (9ch) | 18.5 | 14.0 | **7.3** |
| 1920×1080 | 126.0 | 102.3 | **43.6** (40.5 in a quieter run) |
| 512² large (textures) | 75.4 ² | 84.9 ² | **41.1** ² |

¹ The portable column is a separate run (`sm=0`) with ORT at 172.9 / kernels at
139.8 in the same run. ² Noisy run; a quieter one gave 50.0 / 59.5 / 23.4.
Create (first `Denoiser.create`): WGSL 27–35 ms, ORT 220–1100 ms, kernels ~900–1150 ms.

Network alone (`?mode=net`, `binding.run()` + queue drain), 1920×1088,
rt_ldr_small: fp32 ORT 165 / kernels 126 / WGSL 50 (subgroup matrix) – 57
(portable); fp16 ORT 112 / kernels 90 / WGSL ~35.

**Parity through the facade** (max byte Δ / PSNR):

| | denoise | + albedo/normal | denoiseTextures | tiled 1280×720 ³ | tiled 496², batch 2 |
|---|---|---|---|---|---|
| fp32 WGSL vs ORT | 1 (97.1 dB) | 1 (94.8) | 1 (96.3) | 1 (112.5) | 1 (94.0) |
| fp16 WGSL vs ORT fp16 | 2 (54.2) | 2 (54.0) | 2 (54.2) | 2 (56.4) | 2 (54.6) |
| fp16 WGSL vs ORT **fp32** | 1 (61.2) | 1 (59.8) | 1 (61.2) | 1 (69.9) | 1 (61.1) |
| fp16 ORT vs ORT fp32 | 2 (54.4) | 2 (54.1) | 2 (54.4) | 2 (56.5) | 3 (54.7) |

PSNR vs the 4096-spp reference is unchanged (39.16 fp32; fp16 WGSL 39.16 vs ORT
39.02). The portable fp32 kernel gives the same parity (≤ 1). With f32 math, fp16
WGSL is within 1 LSB of fp32 at 66 dB, and the tiled-batch case is 3 off ORT fp16
— because ORT fp16 is the one that's 3 off fp32 there.

³ `maxRunPixels: 256*256` on 1280×720 makes the engine plan 1024² tiles, batch 1
(`planFor` takes the first tile size not larger than the image and clamps the
batch to ≥ 1, so `maxRunPixels` doesn't shrink the tile). The 496² case is the
one that runs 256² tiles, batch 2 (9 tiles, 5 runs, the last one partial).

**Large model / ORT-WebGPU bug.** On `rt_hdr_calb_cnrm_large` WGSL vs ORT is Δ 251
(1.2 dB) while WGSL vs kernels is Δ 1 (fp32) / 2 (fp16). At the network level
(`mode=net&runtimes=cpu,...`, the same `.onnx` on onnxruntime-web's **wasm/CPU**
backend as reference) WGSL is within 1.7e-6 on the large models and the 6-channel
model, while ORT-WebGPU is off by 1.0 on `rt_alb_large` (3 channels!) and 0.067 on
`rt_ldr_alb` (6 channels). So the ORT WebGPU Conv bug isn't only the >3-channel
first conv: it also breaks the large topology. Neither the WGSL nor the kernels
runtime has it.

### What mattered (1920×1088 fp32 unless noted, network GPU time)

| step | before → after |
|---|---|
| correct first version: fused ops, one encoder, 4x2 px x 8 oc per thread, taps unrolled | 200 ms (ORT 165) |
| smaller register block (2x2 px x 4 oc) | 200 → 75 |
| **runtime loop over ky** (the Metal compiler hoisted all 9 taps' weight loads; bigger blocks spilled) — enables 2x2 px x 8 oc | 75 → 57 (enc_conv0 12.9 → 3.2) |
| **subgroup-matrix GEMM** (experimental feature) | 57 → 44–50 |
| fp16: **f16 sums per 4-channel chunk** (f16 FMA 6.6 vs f32 3.1 TFMA/s) | 44 → 37 (fp16) |

Measured and dropped: weights staged in workgroup memory (no gain); 4x2 / 4x4 /
2x4 pixel blocks and more output channels per thread (register pressure, up to
460 ms); 16x8 / 8x4 workgroups; non-interleaved output columns for fp32 (61 vs
55); a full 9-tap runtime loop (= ky loop); f16 products converted per tap (no
gain — the conversions ate it); **Winograd F(2x2,3x3) on subgroup matrices**
(correct to 1e-6, but 73–77 vs 58–60 ms: with one subgroup per workgroup the
transforms and the extra barrier cost more than the 2.25x fewer MMAs save; it's
in the history as `b5dfa0e`). A store-bandwidth probe (`bw.html`, ~230 GB/s with
the conv's exact store pattern) ruled out memory as the limit early on.

Where the time goes now: the big layers run at ~2.5 (portable f32) / ~2.7–3.4
(subgroup matrix, f16 sums) TMAC/s against measured peaks of ~3.1 (f32 FMA) /
~3.8 (MMA) / ~6.6 (f16 FMA), i.e. it's compute-bound; the rest is
enc_conv0/dec_conv0 (channel padding) and low-res layers with few workgroups.

### Still on the table

- Several subgroups per workgroup on the matrix path (blocked: matrix load/store
  offsets must be workgroup-uniform, and `subgroupBroadcastFirst` doesn't count).
  That would share the staged tile across subgroups and make Winograd worth
  revisiting.
- f16 subgroup matrices only exist with f16 accumulation here (`f16 x f16 -> f16`),
  so they're out under the f32-accumulation rule; their raw rate is ≈ f32 anyway.
- Per-level tilings: low-res layers (and the large model's 192/256-channel ones)
  launch few workgroups; smaller pixel tiles there would raise occupancy.
- Two 4-channel chunks per barrier stage; cheaper edge layers (enc_conv0 pads 3→4
  channels, dec_conv0 3→4 / 8 outputs).
- A non-Apple GPU pass: everything above was tuned on one M5 Pro; subgroup size,
  f16 rate and register file differ elsewhere.

Bench: `yarn dev:wgsl` (port 5190), then `node examples/wgsl-bench/run-headless.mjs
"precision=fp32" "precision=fp16"`; `mode=net` (network only, `profile=1` per-layer
timestamps, `runtimes=cpu,...` for the ORT-wasm reference), `mode=tune` (configs
round-robin on one device), `sm=0|1` (subgroup-matrix path), `bw.html`,
`mma.html`, `features.html` (probes).

## WebNN runtime (`packages/denoiser-webnn`, `examples/webnn-bench`)

`WebnnRuntime({ tzaUrl, deviceType: 'gpu' | 'npu' | 'cpu', device?, interop? })`
(`denoiser/webnn`, experimental, `private`). The graph is built with
`MLGraphBuilder` from the `.tza` weights by unfolding the WGSL runtime's fused
op list (`buildGraph`) back into `resample2d` (nearest, scales [2,2]) → `concat`
→ `conv2d` (NCHW / OIHW, pad 1, bias) → `clamp(0, 6)` → `maxPool2d`. One
`MLGraph` per geometry (static shapes), compiled in `bind()` (the engine's first
geometry starts compiling from `load()`'s hint).

**Chrome 154 stable and 157 Canary (identical), M5 Pro, headless,
`--enable-features=WebMachineLearningNeuralNetwork`.** What the API does on macOS
(CoreML backend):

- `deviceType: 'gpu'` runs on the GPU. **`'npu'` is the same as `'gpu'` by
  default** (bit-identical outputs and timings — Chrome maps it to CoreML "all
  compute units", which picks the GPU). Only with the extra Chrome feature
  **`WebNNCoreMLExplicitGPUOrNPU`** does `'npu'` reach the **Apple Neural Engine**
  (fp16 outputs then differ, 2.5–3e-3 vs fp32, and timings change). fp32 graphs
  on that `'npu'` fall back to the CPU (same outputs and speed as `'cpu'`).
- `navigator.ml.createContext(gpuDevice)` works but **runs on the CPU** (same
  outputs as `'cpu'`, 7–8× slower than `'gpu'`: rt_hdr_small 512² ~100–180 ms,
  1080p ~700 ms). Not usable.
- Graph layout: `preferredInputLayout` is `nchw`; an NHWC graph (transposes at the
  ends, OHWI filters) measured the same. NCHW is the default.
- Correctness (network only, max |Δ| vs WGSL fp32 on the same random input; WGSL
  fp32 is within ~2e-6 of ORT-wasm CPU): fp32 1.3–2.8e-6; fp16 on 'gpu'
  0.7–1.3e-3 (closer to fp32 than WGSL fp16's 3.3–4.8e-3 — CoreML seems to
  compute fp16 graphs at higher internal precision on the GPU); fp16 on the ANE
  2.5–3.2e-3.
- **Cold start:** the very first build of a graph on a machine took 5–7 s
  (`build()` 5.5 s + first dispatch 2.5–4.5 s on 'gpu'); afterwards — even in a
  fresh browser profile, so it's CoreML's own on-disk cache — 0.4–1.2 s per
  geometry on 'gpu', 1.0–2.7 s on the ANE ('npu' explicit), plus a first dispatch
  of 0.1–1.3 s ('gpu'). `createContext` 0–700 ms. Every new run geometry pays
  this (WGSL: 30–400 ms per model, nothing per geometry).

### Network-only timings

`examples/webnn-bench` (`index.html?model=…&precision=…&devs=gpu,npu,wgsl`),
batch 1, random input in [0, 1). All runners **interleaved one call per round**,
warm median (min) of 10. "dispatch" = (8 back-to-back dispatches + one
readTensor − one readTensor) / 8 for WebNN, `run()` + queue drain for WGSL — the
network alone; "io" = writeTensor + dispatch + readTensor (host in → host out).

**Caveat — read this first.** The whole session ran with the GPU **75–97 % busy
with another process** (IOAccelerator "Device Utilization", sampled while our
harness was idle; it never went quiet). WGSL fp16 measured ~3.5× its quiet
2026-10-07 numbers (rt_hdr 1080p: 279 vs 78 ms), so the GPU columns are inflated
and only their **ratios within a run** mean something — and even those assume
time-slicing hurts both runtimes alike, which isn't guaranteed (WebNN submits one
CoreML request per run, WGSL one big command buffer; both sync once). The ANE
column is not GPU-bound and its run-to-run spread is tiny (min ≈ median), so it
is probably close to its quiet value. A quiet-GPU rerun is needed before quoting
any GPU number in absolute terms.

fp16, Chrome with `WebNNCoreMLExplicitGPUOrNPU` ('npu' = ANE), ms:

| model | size | WGSL fp16 | WebNN gpu | WebNN npu (ANE) | gpu / ANE io | WGSL ÷ gpu / ÷ ANE | WGSL fp16 quiet (10-07) | native Metal |
|---|---|---|---|---|---|---|---|---|
| rt_hdr_small | 512² | 22.6 (17.1) | 23.8 (18.3) | **6.6** (6.5) | 24.8 / 8.4 | 0.95× / 3.4× | ~5–6 | 2.8 |
| rt_hdr_small | 1920×1088 | 171 (113) | 135 (129) | **49.9** (49.6) | 151 / 62 | 1.27× / 3.4× | ~38 | 14 |
| rt_hdr | 512² | 38.8 (37.1) | 31.0 (26.4) | **11.4** (11.4) | 35 / 14 | 1.25× / 3.4× | ~10 | 4 |
| rt_hdr | 1920×1088 | 279 (254) | 169 (159) | **82.0** (80.7) | 196 / 101 | 1.66× / 3.4× | ~78 | 25 |
| rt_hdr_calb_cnrm (9ch) | 512² | 41.1 (36.3) | 31.4 (29.5) | **10.8** (10.7) | 37 / 14 | 1.31× / 3.8× | ~10 | 4 |
| rt_hdr_calb_cnrm (9ch) | 1920×1088 | 297 (266) | 181 (170) | **84.6** (84.1) | 217 / 107 | 1.64× / 3.5× | ~78 | 25 |
| rt_hdr_calb_cnrm_large | 512² | 96.1 (87.8) | 49.8 (46.0) | **22.1** (21.9) | 51 / 25 | 1.93× / 4.4× | ~25 | 7.8 |
| rt_hdr_calb_cnrm_large | 1920×1088 | 718 (697) | 309 (279) | **196** (191) | 386 / 220 | 2.32× / 3.7× | ~201 | 54 |

fp32 and fp16, default Chrome mapping ('npu' ran on the GPU, so only 'gpu' shown):

| model | size | WGSL fp32 | WebNN gpu fp32 | WGSL fp16 | WebNN gpu fp16 |
|---|---|---|---|---|---|
| rt_hdr_small | 512² | 17.5 | 19.3 (0.90×) | 19.2 | 24.5 (0.78×) |
| rt_hdr_small | 1920×1088 | 134 | 115 (1.16×) | 131 | 136 (0.97×) |
| rt_hdr | 512² | 38.6 | 42.5 (0.91×) | 33.2 | 27.7 (1.20×) |
| rt_hdr | 1920×1088 | 257 | 263 (0.98×) | 247 | 178 (1.39×) |
| rt_hdr_calb_cnrm | 512² | 38.8 | 43.0 (0.90×) | 35.6 | 29.2 (1.22×) |
| rt_hdr_calb_cnrm | 1920×1088 | 273 | 284 (0.96×) | 263 | 192 (1.37×) |
| rt_hdr_calb_cnrm_large | 512² | 83.8 | 85.1 (0.99×) | 81.3 | 45.1 (1.80×) |
| rt_hdr_calb_cnrm_large | 1920×1088 | 625 | 594 (1.05×) | 632 | 329 (1.92×) |

(× = WGSL ÷ WebNN; > 1 means WebNN is faster.) WGSL fp32 here is the
subgroup-matrix kernel (`--enable-unsafe-webgpu`).

Reading:

- **fp32: WebNN on the GPU ≈ WGSL** (0.9–1.16×). No win.
- **fp16 on the GPU: WebNN wins on the bigger models** — 1.2–1.4× on base, 1.8–2.3×
  on large, ~1× on small — under contention. If those ratios held on a quiet
  GPU, WebNN gpu fp16 would be roughly ~47 ms (base) / ~87–105 ms (large) at
  1080p vs WGSL's 78 / 201: closer to native Metal (25 / 54) but still ~2× off.
  Unverified.
- **ANE (flag-only): 50 / 82 / 85 / 196 ms at 1080p**, 6.6 / 11.4 / 10.8 / 22 ms
  at 512² for small / base / 9ch / large. That is about **the same as quiet WGSL
  fp16** (38 / 78 / ~78 / 201) — not faster — but it leaves the GPU free for
  the renderer, which matters for a path tracer sharing the GPU. Behind a
  non-default Chrome feature, so no user gets it today.

### IO with the engine (WebNN ↔ WebGPU interop)

`createExportableTensor(desc, device)` + `exportToGPU(tensor)` work on 'gpu',
'npu' and GPUDevice contexts — **float16 only** ("Invalid operand data type:
float32"/"int32"). Each export returns a **new** `GPUBuffer`
(`STORAGE | COPY_SRC | COPY_DST`) holding the tensor's data; WebNN refuses to
dispatch with a tensor while it's exported ("Input tensor has been exported to
WebGPU") until that buffer is `destroy()`ed; data survives round trips. One
export + destroy costs 0.36–0.54 ms. Chrome also refuses large exportable
tensors: probed, the limit is (product of all dims but the last) ≤ 16384 and
last dim ≤ 16384 — a 2D surface — so [1, 9, 1088, 1920] (37.6 MB) and
[1, 1, 8192, 4096] export fine while [8, 9, 256, 256] (the engine's eager tile
batch for 9-channel models) and [1, 9, 2048, 1024] are "Tensor size is too
large". The runtime checks that up front and uses the host path for such
geometries. Once, a fresh context reported "Context is lost" on creating an
[8, 3, 256, 256] exportable right after other contexts were destroyed (not
seen in the engine/eval runs).

Because the engine's `binding.input/output` must be fixed buffers, the runtime
keeps its own WebGPU IO buffers and per `run()`: exports the input tensor,
GPU-copies `binding.input` into it, destroys it, dispatches, exports the output,
GPU-copies it to `binding.output`, destroys it. fp32 (no export) and geometries
Chrome won't export take the **host path**: copy + map `binding.input`,
`writeTensor`, dispatch, `readTensor`, `queue.writeBuffer(binding.output)`.

Cost through the runtime (`devs=rt-<gpu|npu>-<interop|host>`, rt_hdr fp16, run()
+ queue drain, vs raw dispatch + readTensor in the same run, contended GPU):
'npu' 512² 13.1 → 27.8 (interop) / 16.6 (host); 1080p 108 → 121 / 125; 'gpu'
512² 32 → 47 / 35; 1080p ~250–325 for all three (noise > difference). So the
interop path works and stays on the GPU, but **isn't measurably cheaper than the
host round trip** here — the export/fence handoffs cost about what the copies
save, and under GPU contention the GPU-side copies queue behind other work.

### Through the engine (`examples/eval`, `webnn` / `webnn-npu`)

Full eval (25 cases, [docs/status/eval-2026-10-08-webnn.md](../status/eval-2026-10-08-webnn.md),
same contended GPU, WGSL fp16 run in the same session for scale):

- **Correctness gate passed:** webnn fp32 ≤ 1 LSB vs native CPU on every case
  (72–84 dB), webnn fp16 ≤ 1 LSB (71–78 dB — closer than WGSL fp16's 62–68),
  webnn-npu (ANE) fp16 ≤ 2 LSB (62–67 dB). The one exception,
  eiffel/rt_ldr_calb_cnrm at 5 LSB, is 5 LSB on every runtime (open issue from
  the 10-07 eval). PSNR vs the converged reference matches native (ANE ~0.2 dB
  lower on spheres).
- **Speed @1080p (contended):** webnn fp16 vs WGSL fp16 ≈ 1.0–1.2× on small
  (149–181 vs 159–206 ms, one outlier 74), 1.4–1.9× on base (175–210 vs 258–378),
  2.8× on large (317 vs 890). webnn fp32 is ≈ WGSL fp16 or slower (host IO
  path). webnn-npu 85–137 ms on most cases with outliers to 255 ms (the engine's
  pre/post + interop copies still run on the busy GPU).
- At 512² WebNN is not faster than WGSL fp16 except large; the ANE has outliers
  (19–73 ms).
- Load: webnn ~0.4–0.9 s per model (two graphs: the engine's eager 256²×8 tile
  geometry + the first run geometry), webnn-npu 1.2–2.7 s, WGSL 30–430 ms.

### Verdict

> **Superseded by the quiet-GPU rerun** ([eval-2026-10-08-quiet](../status/eval-2026-10-08-quiet.md)):
> WebNN fp16 (gpu) is 1.6× / 1.2× native Metal on base / large at 1080p
> (40 / 65 ms) — the fastest web runtime there; `denoiser/auto` picks it for
> those models. The flag, compile-cost and interop caveats below still apply.

WebNN does reach Apple's ML hardware, and on fp16 base/large models the GPU path
looked 1.4–2.3× faster than WGSL fp16 in this (contended) session — but it is
**not near native OIDN-on-Metal**, it's behind a Chrome flag
(`WebMachineLearningNeuralNetwork`), the ANE needs a second non-default flag,
fp32 gains nothing, the WebGPU interop is fp16-only and no cheaper than a host
copy, and every new geometry costs ~0.5–2.5 s of CoreML compile. Keep it as an
experimental runtime; re-measure on a quiet GPU before deciding anything, and
watch for Chrome shipping WebNN by default.

## Plan

1. ~~Runtime seam inside `packages/denoiser`, no public API change~~ ✓
2. ~~`KernelsRuntime` behind the seam (experimental)~~ ✓ — blocker 1 via the shim,
   blocker 2 via kernels-allocated IO tensors (zero-copy).
3. ~~Package split~~ ✓ — internal workspace packages `packages/denoiser-core`,
   `-ort`, `-kernels` (private, never published) ship as **subpath entries of the one
   `denoiser` package**: `denoiser` (core + ORT preset), `denoiser/core`,
   `denoiser/ort`, `denoiser/kernels`. One rollup pass with shared chunks (a single
   copy of the core); types via rollup-plugin-dts. `@huggingface/kernels` is an
   optional peer dependency. One publish, one version; the release workflow only
   needed the build order (`--topological-dev`).
4. ~~Bench + regression parametric over runtimes~~ ✓ — `examples/bench` takes
   `?runtime=ort|kernels` (selector too) for the table, `__denoiseOnce` and
   `__regression(precision, runtime)`. Kernels is deterministic run-to-run (16
   cases). Bench, synthetic noise, warm median:

   | | 512² | 1280×720 | 1920×1080 |
   |---|---|---|---|
   | fp32 ORT → kernels | 17.9 → 17.0 ms | 60.0 → 57.5 ms | 168.9 → 129.6 ms (1.30×) |
   | fp16 ORT → kernels | 15.9 → 13.7 ms | 50.4 → 44.2 ms | 110.9 → 94.5 ms (1.17×) |

   Both runtimes only submit in run() (`runMs` ≈ 1–2 ms for each); the network's
   GPU time lands in `resolveMs`, where the final readback waits. Compare totals. Gallery: Runtime control (ONNX Runtime / HF kernels / hand-written
   WGSL, `?runtime=`), non-default runtimes lazy-loaded; `.tza` weights served from
   `pmndrs/denoiser-weights@models-v3/tzas`. First denoise per model in the gallery:
   WGSL 11–16 ms, ORT 0.15–1.1 s, kernels ~1.2 s (kernel fetch + compile).
   The bench regression also checks tiled-vs-whole-frame PSNR (~50 dB, all
   runtimes) now that the planner respects `maxRunPixels` (it used to keep 1024²
   tiles under a smaller budget).
5. OIDN 3 on the winning runtime; add `createStream()` (temporal state, `reset()`)
   and `motion`/`depth` inputs once its inputs are public.
6. ~~WebNN runtime~~ — experimental `WebnnRuntime` (`denoiser/webnn`) on
   `feat/webnn-runtime` (see "WebNN runtime"); ~~hand-written WGSL runtime (fusion, single encoder per frame),
   using kernels as the correctness/perf baseline~~ — first cut on
   `feat/wgsl-runtime` (above).

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
