# OIDN's U-Net on WebNN in Chrome: results and friction

For: the WebNN / Chromium WebNN implementation teams.
From: [pmndrs/denoiser](https://github.com/pmndrs/denoiser) (browser port of Intel's Open Image Denoise).
Demo and code: `<DEMO LINK>` (runtime in `packages/denoiser-webnn`, bench in `examples/webnn-bench`).

We run Intel's Open Image Denoise 2 networks (a U-Net of dense 3x3 convolutions over
full-frame images) in the browser. We already had four executors for the same weights, so WebNN could be
compared on equal terms. On Apple silicon it is the fastest web runtime we have
for the larger models, and it works. This note is what we measured and what got in
the way, in the hope the second part is useful to you.

## What we built

`WebnnRuntime` builds the whole network with `MLGraphBuilder` from OIDN's weight
files, one `MLGraph` per run geometry (static shapes), and executes it with
`MLContext.dispatch`. The graph uses only:

`resample2d` (nearest, scales [2, 2]), `concat`, `conv2d` (NCHW input, OIHW filter,
pad 1, bias), `clamp(0, 6)` (relu6) and `maxPool2d`.

That is a 16-conv graph for the standard topology (19 for the large one), with
3-, 6- or 9-channel inputs, batch 1 or tiled batches, fp32 and fp16. Everything
else (tiling, color transfer, autoexposure, aux encoding) is WGSL on a shared
`GPUDevice`, so WebNN is only the network step. We use the WebNN to WebGPU
tensor export (`createExportableTensor` + `exportToGPU`) so the pixels stay on
the GPU for fp16.

We tested Chrome 154 stable and 157 Canary (identical behavior) on macOS, an Apple
M5 Pro, headless, `--enable-features=WebMachineLearningNeuralNetwork`, CoreML
backend.

## Results

Quiet GPU, 1080p, mean over models, `denoiseTextures` to a texture, warm median.
Native OIDN on Metal is the best native option on this machine; native OIDN CPU is
189 / 331 / 739 ms. The 25-case harness and the full tables are in
`docs/status/eval-2026-10-08-quiet.md`, `<DEMO LINK>`.

| 1080p | small | base | large |
|---|---|---|---|
| native OIDN, Metal | 14.3 ms | 24.8 ms | 54.2 ms |
| **WebNN fp16, deviceType `gpu`** | **31.5 ms (2.2x)** | **40.1 ms (1.6x)** | **65.4 ms (1.2x)** |
| WebNN fp16, `npu` (Neural Engine, needs the second feature) | 33.1 ms (2.3x) | 43.6 ms (1.8x) | 78.9 ms (1.5x) |
| WebNN fp32, `gpu` | 49.6 ms (3.5x) | 74.7 ms (3.0x) | 159 ms (2.9x) |
| our hand-written WGSL, fp16 | 33.6 ms (2.4x) | 67.0 ms (2.7x) | 167 ms (3.1x) |
| WGSL fp32 (experimental subgroup matrix) | 39.5 ms (2.8x) | 76.3 ms (3.1x) | 186 ms (3.4x) |

(Multiples are against native Metal.) 512x512, fp16: native 2.7 / 4.0 / 7.8 ms;
WebNN 6.4 / 7.3 / 10.8 ms; WGSL 4.6 / 8.7 / 21.0 ms for small / base / large.

Takeaways:

- **WebNN fp16 on the GPU is within 1.2-1.6x of native OIDN on Metal for the base
  and large models**, and 1.7x / 2.5x faster than our own tuned WGSL on them at 1080p.
  On small models and at 512x512 the WGSL kernels are as fast or faster.
- **fp32 does not help**: WebNN on the GPU is about the same as WGSL fp32.
- The Neural Engine path is close to the GPU path in time and leaves the GPU free,
  which matters if a renderer shares the machine. It is only reachable with a second
  non-default feature (below).

**Correctness.** Against native OIDN CPU on 25 scene/model cases, WebNN fp32 is
within 1 LSB on every case (70-84 dB), fp16 on the GPU within 1 LSB (72-78 dB, closer
to fp32 than our WGSL fp16, which suggests CoreML computes fp16 graphs at higher
internal precision), and fp16 on the Neural Engine within 2 LSB (62-67 dB). Network
only, maximum absolute difference against our WGSL fp32 (itself within about 2e-6 of
onnxruntime-web on wasm/CPU): fp32 1.3-2.8e-6, fp16 on the GPU 0.7-1.3e-3, fp16 on
the Neural Engine 2.5-3.2e-3.

For context: onnxruntime-web's WebGPU execution provider is wrong on part of this
model family (the first convolution with more than 3 input channels, and the large
topology), while WebNN reproduces the reference on every model.

## What worked well

- The operator set covered the whole network with no workarounds. `conv2d` with
  fused bias, `clamp` for relu6, `resample2d` for the nearest upsample and `concat`
  for the skip connections mapped one to one.
- Static shapes per geometry gave the backend what it wanted. NCHW (the backend's
  preferred layout) and an NHWC graph with transposes at the ends measured the same.
- `MLTensor` and the export to WebGPU make it possible to keep a pipeline on the
  GPU at all. Data survived our round trips.
- Performance on larger models is genuinely good, and the Neural Engine is reachable.

## Friction we hit

None of these is a blocker for experiments; several are for shipping.

1. **Feature flags.** Needs `--enable-features=WebMachineLearningNeuralNetwork`
   today. Reaching the Neural Engine needs a second feature,
   `WebNNCoreMLExplicitGPUOrNPU`. No normal user has either, so we ship WebNN as an
   experimental opt-in with an `isAvailable()` check and a fallback to our WGSL
   runtime.
2. **`deviceType: 'npu'` silently runs on the GPU without the explicit flag.**
   Chrome maps it to CoreML "all compute units", which picks the GPU: we measured
   bit-identical outputs and timings to `'gpu'`. We found out by timing, not from
   any signal in the API. A way to ask what a context actually runs on (or an
   error when the requested device type is not honored) would have saved us time.
   With the explicit feature on, fp32 graphs on `'npu'` fall back to the CPU (same
   outputs and speed as `'cpu'`), again silently.
3. **`navigator.ml.createContext(gpuDevice)` falls back to the CPU.** It succeeds,
   and the context then runs on the CPU: same outputs as `deviceType: 'cpu'` and
   7-8x slower than `'gpu'` (about 100-180 ms for a 512x512 small model, about 700
   ms at 1080p; measured on a busy GPU, so treat as a ratio). That was the API we
   expected to use to put WebNN and our WebGPU work on one device. We now create the
   context from a `deviceType` and bridge with tensor export.
4. **Interop is float16 only.** `createExportableTensor` + `exportToGPU` accept
   float16 only ("Invalid operand data type: float32" / "int32"), so fp32 graphs go
   through the host (map, `writeTensor`, `readTensor`, `queue.writeBuffer`). We also
   saw that each export returns a new `GPUBuffer` and WebNN refuses to dispatch with
   the tensor while it is exported, until that buffer is destroyed. In our
   measurements one export plus destroy cost 0.36-0.54 ms and the interop path was
   not measurably cheaper than the host round trip, because the export and fence
   handoffs cost about what the copies save. We would love a path where a
   pre-existing `GPUBuffer` can be bound as a tensor's storage (the reverse of
   `exportToGPU`), so we could keep fixed buffers on the WebGPU side.
5. **Exportable-tensor size limits.** Chrome refuses large exportable tensors with
   "Tensor size is too large". Probing, the limit looks like a 2D surface: the
   product of all dimensions but the last must be at most 16384, and the last
   dimension at most 16384. [1, 9, 1088, 1920] (37.6 MB) and [1, 1, 8192, 4096]
   export fine; [8, 9, 256, 256] (our eager tile batch for 9-channel models) and
   [1, 9, 2048, 1024] do not. The limit is not in the spec as far as we can tell, and
   it is a surprising constraint for an NCHW image tensor. We now check it up front
   and use the host path for such geometries. Once, a fresh context reported
   "Context is lost" when creating an [8, 3, 256, 256] exportable tensor right after
   other contexts were destroyed; we have not seen it since.
6. **Per-geometry compile cost.** Every new set of input dimensions is a new
   `MLGraph`, and the CoreML compile is expensive. On a cold CoreML cache the first
   ever build of a graph took 5-7 s (`build()` about 5.5 s plus a 2.5-4.5 s first
   dispatch on the GPU). Once CoreML's on-disk cache is warm (it survived a fresh
   browser profile) it is 0.4-1.2 s per geometry on the GPU and 1.0-2.7 s on the
   Neural Engine, plus a first dispatch of 0.1-1.3 s. For an interactive image tool
   where users resize, that is the main reason it cannot be a default: our WGSL
   runtime has no per-geometry cost and loads a model in tens of milliseconds.
   Dynamic dimensions (or bucketed shapes with padding supported in the backend)
   would remove the problem.

## What would make this shippable for us

In order of impact: no flags; a documented, queryable relationship between
`deviceType` and the hardware actually used; float32 export (or an fp16-only story
we can rely on); a spec-visible tensor size limit; and cheaper or cacheable
graph compilation per shape.

We are happy to share the bench page, the graph builder and the eval harness, and
to test a Canary build against the full 25-case regression.

Caveats on our side: everything here was measured on Apple GPUs only, one machine,
and the speed numbers come from a quiet-GPU rerun (an earlier session ran with
another process using 75-97% of the GPU and is not used for absolute figures).
