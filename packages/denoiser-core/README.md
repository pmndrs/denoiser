# @pmndrs/denoiser-core

The runtime-agnostic core of [pmndrs/denoiser](https://github.com/pmndrs/denoiser):
the `Denoiser` facade, the tiled WebGPU engine (`TiledEngine`), WGSL pre/post
(sRGB / OIDN PU transfer, autoexposure, aux encoding, overlap blend) and the
`NetworkRuntime` interface the U-Net executors implement.

Most apps want the [`denoiser`](../denoiser) package instead — the same API with
onnxruntime-web as the default runtime. Use core directly to bring a different
runtime:

```ts
import { Denoiser } from '@pmndrs/denoiser-core';
import { KernelsRuntime } from '@pmndrs/denoiser-kernels';

const denoiser = await Denoiser.create({ runtime: new KernelsRuntime({ tzaUrl }) });
```

Not yet published — the `denoiser` package bundles it. See
[docs/specs/runtimes.md](../../docs/specs/runtimes.md).
