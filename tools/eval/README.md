# Eval: every RT model × every runtime vs native OIDN

Quality and speed of all 17 OIDN RT color models (HDR/LDR × color / +albedo /
+albedo+normal / clean aux × small/base/large) on every web runtime — ORT,
HF kernels, hand-written WGSL — in fp32 and fp16, against Intel's native OIDN
(CPU = ground truth, Metal = the native GPU ceiling). Same `.tza` weights
everywhere: native runs with `-w` on the files in `packages/denoiser/tzas/`
(verified hash-identical to native's built-in weights).

## Inputs

| scene | range | source | aux | reference |
|---|---|---|---|---|
| `spheres` | LDR (sRGB-encoded) | gallery, 4 spp | albedo + normal | converged render |
| `eiffel` | LDR (sRGB-encoded) | gallery, 4 spp | albedo + normal | converged render |
| `hdrdump` | linear HDR | path tracer dump (tools/oidn-native-compare) | albedo + normal | — |

512² for quality, nearest-resampled to 1920×1080 for timing. All inputs are
rounded to fp16 so every setup (web textures are rgba16float) sees the same data.
LDR scenes run the 8 LDR models, `hdrdump` the 9 HDR models → 25 cases.

## Run

```sh
# 1. native OIDN (Intel's prebuilt, e.g. oidn-2.5.1.arm64.macos.tar.gz from
#    github.com/RenderKit/oidn/releases) -> tools/eval/out/{inputs,native}/, plan.json, native.json
OIDN_BIN=/path/to/oidn-2.5.1.arm64.macos/bin \
  tools/onnx-convert/.venv/bin/python tools/eval/native.py

# 2. web runtimes (needs `yarn build:lib`, and packages/denoiser/models/ with the
#    split-aux artifacts for ORT's clean-aux models)
cd examples/eval && yarn dev &          # :5196
node run.mjs                            # all runtime x precision -> tools/eval/out/report.{md,json}
node run.mjs wgsl:fp16 ort:fp16         # subset
ONLY='hdrdump/' node run.mjs            # filter cases
```

`wgsl` fp32 uses the experimental subgroup-matrix kernel (headless Chrome runs
with `--enable-unsafe-webgpu`); `wgsl-portable` is the kernel users get today.

## Metrics

- **vs native CPU:** PSNR / max 8-bit Δ of the denoised output (LDR clamped to
  [0,1]; HDR mapped x/(1+x), gamma 2.2 first). Web outputs are read from an
  rgba16float texture, so ~70–85 dB is "identical".
- **vs reference:** PSNR against the converged render (LDR scenes) — which model
  actually denoises best.
- **speed:** web = `denoiseTextures` → texture, awaited, warm median of 10 (plus
  cold first call per size, which includes pipeline compiles); native =
  `oidnDenoise -n` filter time, warm median (excludes host IO).
