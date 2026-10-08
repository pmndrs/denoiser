# @pmndrs/denoiser-core

The runtime-agnostic core of [pmndrs/denoiser](https://github.com/pmndrs/denoiser):
the `Denoiser` facade, the tiled WebGPU engine (`TiledEngine`), WGSL pre/post
(sRGB / OIDN PU transfer, autoexposure, aux encoding, overlap blend) and the
`NetworkRuntime` interface the U-Net executors implement.

**Internal workspace package — never published.** It ships inside the
[`denoiser`](../denoiser) package as the `denoiser/core` entry (and under the
root entry, which adds `AutoRuntime` as the default runtime):

```ts
import { Denoiser } from 'denoiser/core';
import { KernelsRuntime } from 'denoiser/kernels';

const denoiser = await Denoiser.create({ runtime: new KernelsRuntime({ tzaUrl }) });
```

See [docs/specs/runtimes.md](../../docs/specs/runtimes.md).
