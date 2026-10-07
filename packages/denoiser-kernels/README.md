# @pmndrs/denoiser-kernels (experimental)

Runs the OIDN U-Net on [`@huggingface/kernels`](https://www.npmjs.com/package/@huggingface/kernels)
(WebGPU) as a `NetworkRuntime` for [`@pmndrs/denoiser-core`](../denoiser-core) —
FusedConv / MaxPool / Resize / Concat, weights read straight from OIDN `.tza`
files. Matches the ORT runtime to 1 LSB (fp32) and is ~1.2–1.35× faster at 1080p
on Apple Metal; it also runs the 9-channel aux models without ORT's workaround.

**Internal workspace package — never published.** Ships inside the
[`denoiser`](../denoiser) package as the `denoiser/kernels` entry;
`@huggingface/kernels` is an optional peer dependency (install it to use this entry).

```ts
import { Denoiser } from 'denoiser';
import { KernelsRuntime } from 'denoiser/kernels';

const denoiser = await Denoiser.create({
  runtime: new KernelsRuntime({ tzaUrl: '/tzas' }),
});
```

**Experimental:** kernels `0.0.1-preview.3` always creates its own `GPUDevice`, so
this package hands it ours through a `navigator.gpu.requestAdapter` shim
(`shareDeviceWithKernels`) — needed for zero-copy IO, not meant for production.
Never call kernels' `disposeSharedKernelRuntime()` while it runs on a shared
device: it destroys that device. kernels keeps one page-global runtime, so all
`KernelsRuntime`s on a page share one device (the first one's). Status and benchmarks:
[docs/specs/runtimes.md](../../docs/specs/runtimes.md); demo:
[examples/kernels-smoke](../../examples/kernels-smoke).
