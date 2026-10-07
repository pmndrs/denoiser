# @pmndrs/denoiser-wgsl (experimental)

The OIDN U-Net in hand-written WGSL, as a `NetworkRuntime` for
[`@pmndrs/denoiser-core`](../denoiser-core): 16 (standard) / 19 (large) fused
conv dispatches in one command encoder per run — bias + relu6 + max pool fused
into the convs, decoder convs reading the upsampled tensor and the skip directly,
persistent per-geometry buffers. fp32 / fp16 (f16 math, f32 accumulation),
standard + large models, 3/6/9 input channels, batched tiles. No runtime
dependencies; weights are OIDN `.tza` files.

**Internal workspace package — never published.** Ships inside the
[`denoiser`](../denoiser) package as the `denoiser/wgsl` entry:

```ts
import { Denoiser } from 'denoiser';
import { WgslRuntime } from 'denoiser/wgsl';

const denoiser = await Denoiser.create({
  runtime: new WgslRuntime(), // weights: jsDelivr models-v3 by default; or { tzaUrl: '/tzas' }
});
```

Through the facade on an Apple M5 Pro it's 2.5–3× faster than the ORT runtime
and ~2× faster than HF kernels, within 1 LSB (fp32) / 2 LSB (fp16) of ORT, and
creates a `Denoiser` in ~25 ms. **Tuned on one Apple GPU only** — validate on
other hardware before relying on it. With Chrome's experimental
`chromium-experimental-subgroup-matrix` feature (behind
`--enable-unsafe-webgpu` today) fp32 uses a faster 8×8-matrix kernel; everyone
else gets the portable kernel. Details, numbers and what was tried:
[docs/specs/runtimes.md](../../docs/specs/runtimes.md); bench:
[examples/wgsl-bench](../../examples/wgsl-bench).
