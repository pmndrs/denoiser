# @pmndrs/denoiser-ort

onnxruntime-web (WebGPU EP) `NetworkRuntime` for
[`@pmndrs/denoiser-core`](../denoiser-core): `OrtRuntime` / `OrtSession`, the
`.onnx` model loader (`Models`), the split-graph workaround for the ORT-WebGPU
9-channel Conv bug, and the 2.x `DenoiseEngine`.

This is the default runtime of the [`denoiser`](../denoiser) package, which
bundles it. Not yet published separately.
