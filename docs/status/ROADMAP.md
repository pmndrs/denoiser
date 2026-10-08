# Roadmap & positioning

_Last updated: 2026-10-08 (branch `feat/network-runtimes`: runtime split, WebNN, the
eval harness and the temporal API). Companion to
[STATUS.md](STATUS.md) (tactical next actions, still describing the 2026-07 ORT
state in places); this doc is the strategic view: where we stand vs v1 and native
OIDN, what the library is for, what is shipped, and what is next._

Numbers below come from [eval-2026-10-07](eval-2026-10-07.md) and
[eval-2026-10-08-quiet](eval-2026-10-08-quiet.md) (the authoritative runs, Apple
M5 Pro, Chrome 154) and from [runtimes.md](../specs/runtimes.md) /
[temporal.md](../specs/temporal.md). [eval-2026-10-08-webnn](eval-2026-10-08-webnn.md)
was measured on a contended GPU; its absolute timings are superseded.

## Where we stand

### The product, now

One `denoiser` package with subpath entries. The facade (`Denoiser.create` /
`denoise` / `denoiseTextures`) owns tiling, color transfer, autoexposure, aux
encoding and texture IO, and delegates only the U-Net to a pluggable
**`NetworkRuntime`**. The same OIDN weights run on:

| runtime | entry | state |
|---|---|---|
| onnxruntime-web (WebGPU EP) | `denoiser`, `denoiser/ort` | the default; known-wrong on some models (below) |
| HF kernels | `denoiser/kernels` | experimental; needs a device-sharing shim |
| hand-written WGSL | `denoiser/wgsl` | experimental; fastest runtime that needs no flags |
| WebNN | `denoiser/webnn` | experimental; Chrome flag; fastest on base/large |

Plus the real-time side: the **`TemporalDenoiser`** API (`denoiser/core`) and its
first implementation, the FidelityFX shadow + reflection denoisers ported to WGSL
(`denoiser/ffx`), and a three.js entry (`denoiser/three`, currently the shared
`WebGPURenderer` helpers; TSL nodes in progress). Workspaces other than `denoiser`
are internal (private) and ship as its subpath entries.

### vs v1 (0.0.x, TensorFlow.js)

| | v1 (TFJS) | v2 (ORT-web WebGPU, the default runtime) |
|---|---|---|
| Engine | TFJS WebGL/WebGPU, runtime graph build from TZA | ONNX on WebGPU EP, offline-converted models |
| 512² warm | 37.6 ms (9 tiles)* | **13.7 ms** (whole-frame, fp16) — 2.7× |
| 1080p warm | 188 ms (45 tiles)* | **104 ms** (whole-frame) — 1.8× |
| Precision | fp32 only usable | fp16 end-to-end (53.5 dB vs fp32) |
| GPU interop | WebGLTexture marshaling, copies | zero-copy texture in/out on a shared `GPUDevice` |
| API | stateful (set inputs, execute) | stateless per-call `create`/`denoise`/`denoiseTextures` |
| Browser coverage | WebGL fallback = near-universal | **WebGPU only** — v1 remains the answer for old browsers |
| Maintenance | TFJS is abandoned | onnxruntime-web actively developed |

\* the "v1" timing columns are the pre-optimization tiled fp32 baseline of the
NEW engine (perf-plan Phase 0) — v1 TFJS itself was never benchmarked on this
harness; treat the speedups as engine-optimization gains, not a measured
TFJS-vs-ORT comparison. The ORT numbers are from the July measurements; the
current multi-runtime numbers are in the next section.

The one true regression is coverage: no WebGL fallback by design. WebGPU is
Chrome/Edge stable, Safari 26+, Firefox (win stable/others in progress).

### vs native OIDN (OIDN 2.5.1, same weights)

**Speed, 1080p, mean over models, idle GPU (× slower than native Metal):**

| 1080p | small | base | large |
|---|---|---|---|
| native Metal | 14.3 ms | 24.8 ms | 54.2 ms |
| native CPU | 189 ms | 331 ms | 739 ms |
| ORT fp16 | 101 ms (7.1×) | 210 ms (8.5×) | runs base (see below) |
| kernels fp16 | 79 ms (5.5×) | 163 ms (6.5×) | 440 ms (8.1×) |
| **WGSL fp16** (no flags) | 33.6 ms (2.4×) | 67.0 ms (2.7×) | 167 ms (3.1×) |
| **WebNN fp16, gpu** (Chrome flag) | 31.5 ms (2.2×) | **40.1 ms (1.6×)** | **65.4 ms (1.2×)** |

At 512²: WGSL fp16 is fastest on small (4.6 ms vs WebNN 6.4, native 2.7); WebNN
is fastest on base/large (7.3 / 10.8 ms vs WGSL 8.7 / 21.0, native 4.0 / 7.8).
Every GPU web runtime beats native **CPU**.

- **The July "~4× off native Metal, unreachable from WGSL" conclusion is
  superseded.** The 2026-07 spike (kernel-spike, NO-GO at ≤1.32×) benchmarked
  generic tiled conv kernels against ORT. The shipped WGSL runtime fuses the
  whole U-Net into one encoder, runs the conv with runtime-looped taps and f16
  partial sums, and gets to 2.4–3.1× of native Metal (and ~3× faster than ORT);
  the experimental subgroup-matrix kernel helps fp32 (39.5 / 76.3 / 186 ms) but
  not fp16. WebNN (CoreML) gets within 1.2–1.6× on base/large.
- **Quality: parity on kernels, WGSL and WebNN.** fp32 70–84 dB, within 1 LSB of
  native CPU on every model; fp16 within 1–2 LSB (WebNN on the Neural Engine ≤2).
  One open case: `eiffel/rt_ldr_calb_cnrm` is 5 LSB off on *all* runtimes
  identically (a shared pre/post difference).
- **ORT is wrong on some models.** The 6-channel (`*_alb`) and 9-channel
  `*_alb_nrm` models come out at 32–40 dB (up to 120 LSB; up to 4.8 dB lost vs
  the converged reference). `splitAux` only fixes the clean-aux (`*_calb_cnrm`)
  models. The large topology is also wrong on ORT-WebGPU; the ORT runtime now
  falls back to the base model for `*_large` with a console warning. The upstream
  cause is the onnxruntime WebGPU Conv (issue filed, microsoft/onnxruntime#29651).
- **Features: subset.** RT (interactive/final-frame) models; native OIDN also has
  RTLightmap models (not converted yet) and temporal models (OIDN 3.x, upstream
  not released).
- **Validation scope.** Everything above is **Apple GPUs only** (one M5 Pro). The
  WGSL kernels were tuned there; subgroup size, f16 rate and register file differ
  elsewhere.

### Real-time (temporal)

`TemporalDenoiser` is a synchronous encode-and-submit per-frame API with
`@pmndrs/upscaler` conventions (NDC-delta motion, unjittered projection + jitter,
`resetHistory()`). `denoiser/ffx` implements it for shadows and reflections (AMD
FidelityFX SDK v1.1.4, MIT). At 1080p on an idle GPU: **shadows 0.49 ms,
reflections 1.66 ms**. Quality on the test bed: shadows 34.24 dB (25.06 dB in
penumbrae) vs 17.63 dB noisy with half the flicker of spatial-only; reflections
23.46 dB vs 18.05 dB noisy, flicker halved vs spatial-only at about 1 dB PSNR cost
under fast motion and a dark bias of ~0.04 (inherited from FFX). The OIDN RT
weights remain single-frame; a neural temporal mode waits for OIDN 3.x.

## Use cases (and whether we serve them today)

| Use case | Works? | Example today | Gap |
|---|---|---|---|
| three.js WebGPU path tracing (progressive) | ✅ flagship; zero-copy, shared device | `three-pathtracer-webgpu`, `ldraw-eiffel` | pathtracer dep is an unreleased branch (SHA-pinned) |
| Real-time shadows / reflections in a raster or hybrid renderer | ✅ `denoiser/ffx` (raw WebGPU) | `examples/ffx-denoiser` | TSL node wrappers in progress; no comparison against three's `recurrentDenoise()` yet |
| Denoise a static render (image/canvas → image) | ✅ simplest API path | Phase B hello-world / gallery | — |
| In-pipeline for ANY WebGPU renderer (Babylon, wgpu/WASM, custom) | ✅ engine-agnostic | raw-WebGPU demo | — |
| Offline-render preview in the browser (Blender/Cycles low-spp + AOVs) | ✅ works via aux inputs | gallery | EXR/HDR loading recipe |
| Lightmap baking denoise | ⚠️ model not converted yet | none | convert `rt_lightmap_*` TZAs; demo is a separate effort |
| Photo/sensor noise | ❌ off-label — weights trained on Monte-Carlo render noise | n/a | non-goal |
| Non-WebGPU browsers | ❌ by design | n/a | point to v1 / document requirement |

## Done since the last roadmap (2026-07)

- **Phase A/B (launch work):** site + 10 demos live, docs site in the pmndrs
  layout, ONNX issue filed (microsoft/onnxruntime#29651), `@pmndrs/upscaler`
  0.1.0 released. See [phase-b-plan.md](phase-b-plan.md) and STATUS. The npm
  publish of `denoiser@2.0.0` is still gated on the launch checklist (issue #12).
- **Runtime seam** (`NetworkRuntime` / `NetworkSession` / `NetworkBinding`) with
  byte-identical output (16 regression hashes) and a runtime-parametric bench and
  regression suite.
- **Package split** into internal workspaces shipped as subpath entries of the one
  `denoiser` package.
- **HF kernels runtime** (experimental, zero-copy IO via kernels-allocated
  tensors) — ~1.2–1.35× faster than ORT, correct on all aux models.
- **Hand-written WGSL runtime** (experimental) — fused U-Net in one compute pass;
  2.5–3× faster than ORT through the facade, correct on every model, 10–90 ms model
  load.
- **WebNN runtime** (experimental) — `MLGraphBuilder` graph from the `.tza`
  weights, CoreML backend, WebNN↔WebGPU tensor export for fp16.
- **Eval harness** (`tools/eval`, `examples/eval`): 25 scene/model cases × every
  runtime × fp32/fp16 against native OIDN (CPU = ground truth, Metal = ceiling).
  This is how the parity and speed claims above are made.
- **Temporal API + FidelityFX shadow/reflection denoisers** (WGSL) with a test bed
  and measured quality/cost.
- **Docs:** [Choosing a runtime](../site/guides/choosing-a-runtime.mdx) and
  [Real-time (temporal) denoising](../site/guides/realtime-temporal-denoising.mdx)
  guides, API reference updates, and outreach write-ups for the WebNN and HF
  kernels teams (`docs/outreach/`).

## Next steps

### 1. Make the runtimes shippable

- **Decide the 2.0 default runtime / auto-selection (open decision).** Today ORT is
  the default only because it is the one that shipped. The data says WGSL fp16 is
  the best flag-free default (correct on every model, 3× faster), with WebNN as an
  opt-in or an auto-selected upgrade where `WebnnRuntime.isAvailable()`, and ORT
  kept for compatibility. Open questions: ship `denoiser/wgsl` as default in 2.0 or
  2.1; what an `'auto'` runtime picks per device/model/size (WebNN's per-geometry
  compile cost of 0.4–2.7 s, 5–7 s on a cold CoreML cache, argues against it for
  resizable UIs); whether to make the experimental runtimes public API.
- **Validate on non-Apple GPUs (open decision, blocking the default question).**
  NVIDIA, AMD, Intel, Qualcomm, mobile. WGSL tuning (tiling, f16 sums, subgroup
  size 32), the subgroup-matrix kernel and the WebNN backends on other platforms are
  all untested. Expect re-tuning, or per-vendor tiling presets.
- **Fix ORT's `*_alb` / `*_alb_nrm` models via split artifacts (open decision).**
  `splitAux` covers only clean-aux models. Options: extend the split (enc_conv0 in
  WGSL, tail graph on ORT) to the 6-channel and dirty-aux models, which means new
  `models-v*` artifacts; or make the facade refuse ORT for those models and point to
  another runtime; or wait for the upstream fix and re-verify per ORT release. The
  large topology has the same status (currently a warned fallback to base).
- **Resolve the shared 5-LSB case** (`eiffel/rt_ldr_calb_cnrm`): a shared pre/post
  difference, not a runtime bug.
- **HF kernels:** see [docs/outreach/hf-kernels.md](../outreach/hf-kernels.md).
  Productize only once kernels accepts an injected device and external buffers
  (until then the requestAdapter shim stays unshippable).
- **WebNN:** see [docs/outreach/webnn.md](../outreach/webnn.md). Stays opt-in until
  it ships without flags; re-measure when Chrome changes `deviceType` mapping or
  adds dynamic shapes.
- **WGSL performance backlog** (runtimes.md "Still on the table"): several
  subgroups per workgroup on the matrix path (and revisiting Winograd), per-level
  tilings, cheaper edge layers, f16 matrix accumulate when it exists.

### 2. Real-time

- **TSL nodes for the temporal denoisers and the single-image denoiser**
  (`denoiser/three`, in progress), following `@pmndrs/upscaler`'s `UpscalerNode`;
  demo for the render → denoise → upscale chain on one device.
- **Real-time comparison demo** against three's `recurrentDenoise()` (quality and
  ms per frame); needs the raw WebGPU textures wrapped as three nodes. Honest
  framing: temporal real-time denoisers and the final-frame/progressive OIDN path
  are different points on the curve.
- **More signals** behind `TemporalDenoiser`: diffuse GI / AO (`DiffuseInputs`),
  then OIDN 3.x (`BeautyInputs`) when upstream publishes it; NRD needs a license
  check first. FFX optimization: subgroup paths, tile skipping for reflections.
- **Neural temporal mode** waits for OIDN 3.x (the current weights are
  single-frame). `createStream()` and `motion`/`depth` inputs on `Denoiser` only
  once those inputs are public.

### 3. Publishing and launch

- **Publish `denoiser@2.0.0`** (gated on the launch checklist, issue #12:
  docs.pmnd.rs redirect PR + `release.yml` with `NPM_TOKEN`). Decide first what the
  2.0 surface is (default runtime, which subpath entries are public API, which are
  labelled experimental, `@huggingface/kernels` as an optional peer dependency).
- **Merge `feat/network-runtimes`** and publish the docs additions. Replace the
  `<DEMO LINK>` placeholders in the outreach docs once demos are public; send the
  WebNN and HF kernels write-ups.
- **Demos:** the gallery already has a runtime control (`?runtime=`); the FFX test
  bed (`examples/ffx-denoiser`) needs a public build.

### 4. Longer term (demand-driven)

- **Lightmap track:** convert `rt_lightmap_hdr`/`rt_lightmap_dir` (cheap, the
  converter is generic); the three.js lightmapper integration is a separate side
  repo.
- **Our own web-first denoiser** (own models, trained for the temporal case) — the
  eventual endpoint of the runtime split; the runtimes and the temporal interface
  are the substrate.
- OIDN 2.x engine-side investigation (weights identical; gains were engine choices).
- **When the upstream ORT bug is fixed:** re-verify with `aux-split-verify` and the
  eval harness; gate `splitAux` by ORT version; keep the `models-v2` tail artifacts
  hosted (immutable-tag policy). Re-test graphCapture each ORT release.

## Open decisions (summary)

1. **2.0 default runtime and auto-selection** — WGSL vs ORT as default; whether and
   how `'auto'` exists; whether WebNN can be auto-selected.
2. **Non-Apple GPU validation** — blocks every speed/quality claim beyond Apple.
3. **ORT `*_alb` / `*_alb_nrm` and large-topology correctness** — split artifacts,
   a refusal/redirect, or wait for upstream.
4. **Publishing** — scope of the 2.0 public API, experimental labels, the
   `@huggingface/kernels` peer dependency, the launch checklist.

## Non-goals (documented so we stop re-litigating)
- Photo denoising (wrong training domain).
- WebGL fallback (v1 exists; WebGPU-only is the point of v2).
- Reusing the single-frame RT weights per frame as a "temporal" mode (it would
  flicker); real-time goes through `TemporalDenoiser` filters and, later, OIDN 3.x.
- ~~Custom WGSL conv engine~~ — **no longer a non-goal; shipped** as
  `denoiser/wgsl` (the July NO-GO was for generic conv kernels benchmarked against
  ORT, not for a fused whole-network runtime).
