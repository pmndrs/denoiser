# @pmndrs/denoiser-ort

onnxruntime-web (WebGPU EP) `NetworkRuntime` for
[`@pmndrs/denoiser-core`](../denoiser-core): `OrtRuntime` / `OrtSession`, the
`.onnx` model loader (`Models`), the split-graph workaround for the ORT-WebGPU
9-channel Conv bug, and the 2.x `DenoiseEngine`.

**Internal workspace package — never published.** Ships inside the
[`denoiser`](../denoiser) package as the `denoiser/ort` entry and as the root
entry's default runtime.
