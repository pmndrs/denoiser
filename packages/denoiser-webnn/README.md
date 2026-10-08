# @pmndrs/denoiser-webnn (experimental)

The OIDN U-Net on [WebNN](https://www.w3.org/TR/webnn/) (`navigator.ml`), as a
`NetworkRuntime` for [`@pmndrs/denoiser-core`](../denoiser-core): the graph is
built with `MLGraphBuilder` from the OIDN `.tza` weights (one `MLGraph` per run
geometry) and executed by the browser's ML backend — CoreML in Chrome on macOS,
which can run it on the Apple Neural Engine. fp32 / fp16, standard + large
models, 3/6/9 input channels, batched tiles.

**Internal workspace package — never published.** Ships inside the
[`denoiser`](../denoiser) package as the `denoiser/webnn` entry:

```ts
import { Denoiser } from 'denoiser';
import { WebnnRuntime } from 'denoiser/webnn';

const denoiser = await Denoiser.create({
  runtime: new WebnnRuntime({ deviceType: 'npu' }), // 'gpu' (default) | 'npu' | 'cpu'
  precision: 'fp16',
});
```

Needs Chrome with `--enable-features=WebMachineLearningNeuralNetwork` (Chrome
154/157). On macOS, `deviceType: 'npu'` only reaches the Neural Engine with the
additional `WebNNCoreMLExplicitGPUOrNPU` feature; without it Chrome maps 'npu'
to "all compute units" and CoreML runs it on the GPU.

IO with the engine's WebGPU buffers: fp16 uses WebNN↔WebGPU tensor export
(`createExportableTensor` + `exportToGPU`, GPU copies only); fp32 goes through
the host (Chrome only exports float16 tensors). Graph build/compile is
0.4–6 s per geometry — expect a slow first denoise per size.

Numbers and caveats: [docs/specs/runtimes.md](../../docs/specs/runtimes.md);
bench: [`examples/webnn-bench`](../../examples/webnn-bench).
