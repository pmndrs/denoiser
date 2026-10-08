# @pmndrs/denoiser-ort

onnxruntime-web (WebGPU EP) `NetworkRuntime` for
[`@pmndrs/denoiser-core`](../denoiser-core): `OrtRuntime` / `OrtSession`, the
`.onnx` model loader (`Models`), the split-graph workaround for the ORT-WebGPU
9-channel Conv bug, and the 2.x `DenoiseEngine`.

**Internal workspace package — never published.** Ships inside the
[`denoiser`](../denoiser) package as the `denoiser/ort` entry. It is opt-in: the
root `denoiser` entry defaults to `AutoRuntime` and never loads onnxruntime-web
(an optional peer dependency); ORT computes the `*_alb`, `*_alb_nrm` and `*_large`
models wrong (see `docs/status/eval-2026-10-08-quiet.md`).

```ts
import { Denoiser } from 'denoiser';
import { OrtRuntime } from 'denoiser/ort';

const denoiser = await Denoiser.create({ runtime: new OrtRuntime({ weightsUrl: '/models' }) });
```
