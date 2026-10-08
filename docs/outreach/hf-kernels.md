# OIDN on @huggingface/kernels: results, a workaround, and three asks

For: the Hugging Face kernels team.
From: [pmndrs/denoiser](https://github.com/pmndrs/denoiser) (browser port of Intel's Open Image Denoise).
Demo and code: `<DEMO LINK>` (runtime in `packages/denoiser-kernels`, spike in `examples/kernels-smoke`).

We ported the Open Image Denoise U-Net to `@huggingface/kernels` (tested on
`0.0.1-preview.3`). It works, it is faster than onnxruntime-web, and it is correct
on models where onnxruntime-web's WebGPU provider is not. The one thing keeping it
out of a shippable path is that the library always creates its own `GPUDevice`.
This note has the results, how we work around that today, and the three small API
changes that would remove the workaround.

## What we built

OIDN's U-Net needs four ops, and all four are on the Hub:

- `com.microsoft.FusedConv` (conv + bias + relu6 as `Clip[0, 6]`, NCHW, fp16/fp32,
  f32 accumulation)
- `ai.onnx.MaxPool`
- `ai.onnx.Resize` (nearest, floor, asymmetric)
- `ai.onnx.Concat`

`KernelsRuntime` builds the graph straight from OIDN's `.tza` weight files:
28 kernel calls per frame, all GPU-resident. It plugs into the denoiser's
runtime-agnostic facade (`Denoiser.create({ runtime: new KernelsRuntime() })`), so
the engine's own WGSL does tiling, color transfer and autoexposure on the same
device, and kernels only runs the network.

## Results

Apple M5 Pro, headless Chrome, `spheres` scene.

**Through the facade, 512x512, warm median of 10 (kernels vs onnxruntime-web):**

| | `denoise()` | `denoise()` + albedo/normal (9ch) | `denoiseTextures()` |
|---|---|---|---|
| fp32 kernels vs ORT output | max 1 LSB (94.3 dB) | max 1 LSB (93.3 dB) | max 1 LSB (95.3 dB) |
| fp16 kernels vs ORT output | max 2 LSB (54.3 dB) | max 2 LSB (54.0 dB) | max 2 LSB (54.3 dB) |
| fp32 warm, ORT to kernels | 18.1 to 16.9 ms | 21.5 to 20.6 ms | |
| fp16 warm, ORT to kernels | 15.5 to 14.7 ms | 17.9 to 16.7 ms | |

**1920x1080, warm median, with the zero-copy trick below:**

| | readback | zero-copy | ORT |
|---|---|---|---|
| fp32 | 128.8 ms | **121.2 ms** (1.35x ORT) | 163.6 ms |
| fp16 | 98.4 ms | **91.8 ms** (1.22x ORT) | 112.2 ms |

**Against native OIDN (full 25-case eval, idle GPU, 1080p, fp16, mean over models):**
kernels is 79 / 163 / 440 ms for the small / base / large models; native OIDN on
Metal is 14.3 / 24.8 / 54.2 ms; onnxruntime-web is 101 / 210 ms for small / base
(it cannot run the large topology correctly, see below). Our hand-written WGSL
runtime is 34 / 67 / 167 ms. So kernels is about 1.3x faster than onnxruntime-web
on small and base, and 2.4-2.6x behind our tuned hand-written runtime. What is left in
the kernels path is GPU time plus 28 individually awaited kernel calls; a fused,
single-encoder version is what the hand-written runtime does.

**Quality.** kernels matches native OIDN's CPU output on every model: fp32 70-84 dB
and within 1 LSB; fp16 72-78 dB and within 1 LSB. fp16 is the most accurate fp16 of
any runtime we tested (f32 accumulation). The 9-channel albedo/normal models run
**directly**, with no workaround, and so do the 6-channel and large models.
onnxruntime-web's WebGPU provider miscomputes those (a Conv bug on inputs with more
than 3 channels, and the large topology), so for this workload kernels is also the
more trustworthy path.

**Cold start.** The first load of a model costs 0.8-1.8 s (kernel fetch and shader
compile), against 10-90 ms for a hand-written runtime. The runtime needs a warm-up.

## What blocks shipping it

1. **The library creates its own `GPUDevice`.** `navigator.gpu.requestAdapter()` is
   called on the first kernels call, with no option to pass a device. Our pipeline
   (pre/post-processing, the renderer, an upscaler) shares one device and hands
   textures and buffers between stages. A kernels result on another device cannot be
   read from ours without a CPU round trip; the error is
   `... is associated with [Device "webgpu-ml-runtime"], and cannot be used with [Device]`.
2. **Only kernel-produced GPU tensors are accepted.** A hand-built
   `{ buffer, shape, dtype }` is refused, so our NCHW input buffer cannot be passed
   directly, and weights have to go through an `Identity` call to become resident.
3. **`disposeSharedKernelRuntime()` calls `device.destroy()`.** That is fatal once
   the device is shared with anything else on the page.

## How we work around it today

**Device sharing (not for production).** Kernels makes exactly one
`requestAdapter()` call. We answer it with a fake adapter whose `requestDevice()`
returns our device (`packages/denoiser-kernels/src/deviceShim.ts`, about 20 lines).
With it, kernels outputs are usable on our device, verified. It works only because
of an implementation detail, and it forces every `KernelsRuntime` on a page to
share one device (kernels keeps a page-global runtime bound to the first device it
sees). We never call `disposeSharedKernelRuntime()` while it runs.

**Zero-copy IO.** Blocker 2 is an `instanceof` check, and this preview gives every
tensor its own buffer (`STORAGE | COPY_SRC | COPY_DST`, offset 0). So the binding
allocates its input and output tensors through kernels once, and hands their
underlying `GPUBuffer`s to our engine: the engine writes the input buffer, kernels
runs the network, and the last conv writes straight into the output tensor
(`outputs: { y }`). There is no host sync inside the network step. Outputs are
identical to the readback path, which stays available behind `zeroCopy: false`. The
trick relies on kernels not sub-allocating buffers out of a larger one, which is
not something we can count on across versions.

## The asks

1. **Run on an existing device.** `getKernel(..., { device })`, a
   `setKernelDevice(device)` call, or a runtime option, so that a page that already
   has a `GPUDevice` can use kernels on it. Today the library cannot be part of a
   shared-device pipeline without a shim.
2. **Wrap an external `GPUBuffer` as a tensor.** Something like
   `fromGpuBuffer(buffer, { shape, dtype })` returning a `KernelGpuTensor`, so inputs
   written by our own WGSL (and weights uploaded once) can be passed without an
   `Identity` hop, and without depending on how the library allocates its buffers.
3. **`disposeSharedKernelRuntime()` must not destroy a device it did not create.**
   It should release its own resources and leave a caller-provided device alone.

Also useful, though not blocking: a documented way to pre-warm the kernels you will
use (to hide the 0.8-1.8 s first-load cost), and a way to submit several kernel calls
in one command encoder instead of awaiting each of them.

The kernels loader is only available as the npm bundle, which is why we are asking
rather than sending a patch. We are happy to test a preview build against our
regression suite (16 output-hash cases across fp32/fp16 and the image, aux, texture
and tiled paths, which is deterministic run to run for kernels, plus the 25-case
eval against native OIDN) and report back.

Caveat: all numbers are from Apple GPUs (one M5 Pro) only.
