# Temporal (real-time) denoising

> Quiet-GPU timings (2026-10-08, M5 Pro, 1080p): FFX shadows 0.49 ms, reflections 1.66 ms GPU — see docs/status/eval-2026-10-08-quiet.md.

> Status 2026-10-08: interface in `packages/denoiser-core/src/temporal.ts`
> (exported from `denoiser` / `denoiser/core`). First implementation: the
> FidelityFX shadow + reflection denoisers ported to WGSL —
> `@pmndrs/denoiser-ffx`, exposed as `denoiser/ffx` (see
> [FidelityFX port](#fidelityfx-port) below).

## Why a second API

`Denoiser` is a single-image denoiser: async calls, whole-frame, no history —
right for stills, progressive refinement and the current OIDN 2 weights.
Real-time denoising is a per-frame loop with history: reprojection with motion
vectors, accumulation, disocclusion handling, camera cuts. The end goal is
real-time denoising "no matter the source", so this API is source-agnostic:

| source | kind | status |
|---|---|---|
| FidelityFX Denoiser (AMD, MIT, SDK v1.1.4) | shadows, reflections — hand-tuned filters | ported (`denoiser/ffx`) |
| OIDN 3 (Intel) | neural, temporal, full beauty frame | waiting on upstream |
| NRD (NVIDIA: ReBLUR, ReLAX, SIGMA) | diffuse/specular GI, shadows | license check first |
| own models | anything | later |

AMD's newer **FSR Ray Regeneration** (FidelityFX SDK 2.x) is an ML denoiser
shipped as a signed DX12 DLL under a binary-only, no-reverse-engineering
license — not portable. The SDK **v1.1.4** release (MIT) has the full
shadow + reflection denoiser source.

## Design

```ts
interface TemporalDenoiser<Inputs> {
  configure({ width, height }): void;                       // allocate; drops history
  dispatch(inputs: Inputs, guides: FrameGuides, camera: FrameCamera): GPUTexture;
  resetHistory(): void;                                     // camera cut
  gpuTimings?: ReadonlyMap<string, number>;
  dispose(): void;
}
```

- **Synchronous, encode-and-submit.** `dispatch()` runs after the frame's
  inputs are submitted, records its passes and submits them on `device.queue`
  — no awaits, no readback — so it fits inside a render loop. (The
  single-image engine awaits; real-time can't.) Backends that can't submit
  synchronously (ORT's async `session.run`) can't implement this; the WGSL and
  WebNN-style runtimes can.
- **Shared guides** (`FrameGuides`: depth, world normals, motion, optional
  roughness/albedo) and **camera** (`FrameCamera`: current + previous view and
  unjittered projection, jitter, near/far) — every temporal filter needs the
  same reprojection inputs.
- **Per-signal inputs**: `ShadowInputs` (1-spp visibility + hit distance),
  `SpecularInputs` (radiance + hit distance), `DiffuseInputs` (GI/AO),
  `BeautyInputs` (full frame, for OIDN 3). Signal-specific filters exist
  because one filter can't serve them all — shadows need penumbra-aware
  kernels from blocker distance, reflections need roughness-driven lobes and
  hit-distance reprojection, GI needs wide kernels and long history. (A
  screen-space SSR denoiser applied to other signals degrades badly for
  exactly this reason.)
- **Conventions match `@pmndrs/upscaler`** (FSR3): `configure` /
  `dispatch` / `resetHistory` / `dispose`, motion = NDC delta current −
  previous (three's `velocity`), unjittered projection + jitter. A three.js
  TSL node can wrap any `TemporalDenoiser` the same way `UpscalerNode` wraps
  the upscaler, and the chain render → denoise → upscale runs on one device.

## Evaluation

Extends `tools/eval`: per-signal converged references (many-sample renders of
the same signal), PSNR/FLIP-style error per frame, and **temporal stability**
under camera motion (frame-to-frame error of the denoised sequence vs the
reference sequence — flicker matters more than single-frame PSNR here), plus
GPU ms per frame at 1080p.

## FidelityFX port

`packages/denoiser-ffx` (`@pmndrs/denoiser-ffx`, private; users import
`denoiser/ffx`): `FfxShadowDenoiser` (`TemporalDenoiser<ShadowInputs>`) and
`FfxReflectionDenoiser` (`TemporalDenoiser<SpecularInputs>`), constructors
take a `GPUDevice` (+ options). WGSL ported from AMD FidelityFX SDK **v1.1.4**
(`sdk/include/FidelityFX/gpu/denoiser/*`, Vulkan GLSL entry points, host
orchestration in `sdk/src/components/denoiser/ffx_denoiser.cpp`); AMD's MIT
notice is kept in every ported file and in the package `NOTICE`. Nothing from
SDK 2.x. Every pass runs as its own compute pass (per-pass timestamps when
`timestamp-query` is available, surfaced as `gpuTimings`, `total` = sum of
passes). No WebGPU features beyond core are required; only core storage
formats are used, and every pipeline stays within the default limits
(≤ 4 storage textures per stage).

### Shadows — passes and deviations

| FFX pass | port |
|---|---|
| prepare shadow mask (ray-hit mask → 8x4 tile bits, `WaveOr`) | `prepare`: builds the bitmask from per-pixel `visibility >= threshold` (default 0.5) with a workgroup `atomicOr`; also copies depth into an r32float ping-pong pair (replaces the host's depth→previous-depth copy job; lets later passes read any depth format) |
| tile classification | 1:1. `WaveAllTrue` → the source's own LDS fallback made uniform with `workgroupUniformLoad`; `QuadReadX/Y` (closest velocity) → workgroup-memory exchange with the x^1 / y^1 neighbour |
| filter soft shadows 0/1/2 (à-trous, steps 1/2/4) | 1:1 incl. resource aliasing (pass 0 output = next frame's history). The source only has an fp16 path (`FFX_HALF`); the port is fp32 throughout, LDS holds f32 |
| R11G11B10F moments, RG16F scratch | rgba16float (neither is a core storage format) |
| dispatch | the SDK dispatches tile classification / filters with a Y count for 8x4 tiles but 8x8 groups (2x over-dispatch); the port dispatches exactly ⌈H/8⌉ |

Additions: a zero-normal guard (sky normals would turn into NaN filter
weights). `hitDistance` is accepted but unused — FFX shadows doesn't use
blocker distance. Fractional visibility (PCF, etc.) is thresholded: FFX is a
binary 1-ray denoiser.

### Reflections — passes and deviations

| FFX pass | port |
|---|---|
| (host copies of depth / normal / roughness to history) | `prepare` pass writing ping-pong copies (normal.xyz + roughness.w in one rgba16float, depth r32float) |
| reproject (surface vs mirror-parallax hit reprojection, disocclusion, 3x3 search, 2x2 edge path, 8x8 average radiance) | 1:1 from the fp32 path. Scalar history (depth, variance, sample count) is r32float, which core WebGPU can't filter, so `Sample*History` use an exact manual bilinear |
| prefilter (15-tap Halton, variance-guided edge-aware) | 1:1 |
| resolve temporal (9x9 neighbourhood clip, avg-radiance blend) | 1:1 |
| tile list + indirect dispatch (built by SSSR's classifier) | full-screen 8x8 dispatch; the per-pixel roughness gates are unchanged (`roughnessThreshold` default 1 = denoise all pixels, since the caller traced all of them) |
| ray length in `radiance.w` | `inputs.hitDistance`; misses (≤ 0) use `missDistance` (default `camera.far`) |

Two behavioural fixes, both options:

- **`currentFrameStatistics` (default true).** The v1.1.4 host binds the
  *previous* frame's 8x8 average radiance (prefilter, resolve) and sample count
  (resolve, not even reprojected) — its SRV/UAV ping-pong is one frame off. At
  a disocclusion reproject stores zero history with sample count 1, but resolve
  reads last frame's count (up to 32) and blends that zero at ~97 % → dark
  speckles; the first frame after a reset blends toward a zero average → black
  frame (4.8 dB). `false` reproduces the SDK exactly (numbers below).
- **`resetHistory()` drops geometry history too** (FFX's `reset` only clears
  the average radiance, so stale depth/normal history accepts the zeroed
  radiance history on the cut frame).

Input contract inherited from FFX: radiance must be finite and > 0 wherever
there is a reflection — resolve treats `r+g+b < 1e-4` as "no reflection" and
outputs 0, and one NaN wipes a 7x7 prefilter footprint. (The test bed folds
below-horizon GGX samples back into the hemisphere instead of returning 0.)

### Interface

No changes to `temporal.ts` were needed: shadows consume `visibility`
(+ ignored `hitDistance`), reflections consume `radiance` + `hitDistance`
(0 = miss) and require `guides.roughness` (perceptual by default,
`roughnessIsPerceptual: false` for linear). Motion is the NDC delta
(current − previous) and maps to FFX's `motionVectorScale = (-0.5, 0.5)`;
normals in [-1, 1] → `normalsUnpackMul/Add = 1/0`; `reversedDepth` drives
the shadow denoiser's inverted-depth option (closest-velocity pick). `jitter` is not used — FFX reconstructs positions
from the unjittered projection, the sub-pixel error is within its tolerances.

### Test bed + results

`examples/ffx-denoiser` (vite, port 5210; `run-headless.mjs` drives headless
Chrome over CDP). An analytic WGSL ray tracer (6 spheres, 4 boxes, a plane
with roughness bands, a spherical area light, an HDR sky with a bright
"window" band) renders per frame: depth / world normal / NDC motion /
roughness, the 1-spp noisy signal and a stratified many-spp reference of the
same estimator at the same frame. The camera follows a scripted 120-frame
path (orbit + dolly, then a hard cut at frame 60 → `resetHistory()`, then a
lateral truck). Metrics on GPU, over shadow receivers (non-sky pixels):
PSNR vs the reference (shadows: visibility; reflections: after a Reinhard
x/(1+x) tonemap so a few highlights don't dominate), flicker = mean
|e_t − e_{t−1}| with e = output − reference (skipping frames 0 and 60), and
a mean signed error (bias). Baselines: the noisy input, and the same
denoiser with history reset every frame (spatial only).

1920x1080, 120 frames, reference 256 spp, Apple M5 Pro, Chrome 154
(`--use-angle=metal`):

**Shadows** (penumbra = pixels with reference in (0.02, 0.98))

| | PSNR all | PSNR penumbra | flicker | bias (penumbra) |
|---|---|---|---|---|
| noisy 1 spp | 17.63 dB | 7.80 dB | 0.0393 | — |
| FFX shadows, spatial only | 34.07 dB | 24.55 dB | 0.0055 | −0.030 |
| **FFX shadows** | **34.24 dB** | **25.06 dB** | **0.0029** | −0.042 |

First frame 35.6 dB, cut frame 32.8 dB (both spatial-only by construction).
The temporal part halves flicker and adds ~0.5 dB in the penumbrae. With a
static camera the penumbra PSNR peaks after ~10 frames (25.1 dB) and drifts
down ~1 dB: FFX's history is the output of filter pass 0, so the spatial blur
compounds over frames (visible as slightly softened contact shadows).

**Reflections** (tonemapped)

| | PSNR | flicker | bias |
|---|---|---|---|
| noisy 1 spp | 18.05 dB | 0.0845 | — |
| FFX reflections, spatial only | 24.50 dB | 0.0157 | −0.039 |
| FFX reflections, SDK-exact statistics (`currentFrameStatistics: false`) | 22.17 dB | 0.0174 | −0.050 |
| **FFX reflections (default)** | **23.46 dB** | **0.0080** | −0.040 |

SDK-exact: first frame 4.8 dB, cut frame 10.1 dB (black frame after reset);
default: 19.8 / 30.4 dB. PSNR varies a lot along the path (≈18–19 dB on the
first segment, which looks down a bright glossy floor; 27–30 dB after the
cut). Honest reading: in this scene FFX reflections buys a 2x flicker
reduction over its own spatial-only result at the price of ~1 dB PSNR under
fast camera motion (ghosting on glossy surfaces, conservative
disocclusion rejection on the near floor), and is biased dark by ~0.04
(tonemapped) — by design: the prefilter's initial weight and the resolve's
clip both pull toward a luminance-weighted 8x8 average that suppresses
fireflies ("removes quite a bit of energy", per the source). The bias is
unchanged by loosening `temporalStabilityFactor` (0.7 → 3), so it's the
spatial/average path, not the history clip. With a static camera (960x540 check) the output
converges (flicker 0.0007) at ~19.6 dB on the hard first viewpoint vs 18.2 dB
spatial-only.

**GPU time per frame, 1080p** (timestamp queries, unquantized via
`--enable-webgpu-developer-features`). Another session was running GPU
benchmarks throughout, so per-frame medians are dominated by contention
spikes; the minimum over 300–1000 frames in 4–5 interleaved runs is the
best estimate of uncontended cost:

| denoiser | min total | per-pass min | median (contended) |
|---|---|---|---|
| shadows | **0.86 ms** | prepare 0.10, tile classification 0.26, filters 0.17 + 0.16 + 0.16 | 10–17 ms |
| reflections | **3.7 ms** | prepare 0.09, reproject 1.34, prefilter 0.74, resolve 1.07 | 15–25 ms |

Wall time with a queue sync per frame (dispatch → `onSubmittedWorkDone`):
min 2.1 ms (shadows), 5.3 ms (reflections). Not optimized yet: no subgroup
paths (the wave intrinsics are emulated in workgroup memory), the reflection
reproject + resolve each build a 9x9 neighbourhood per pixel from LDS, and all
tiles are processed (no classifier / tile skipping for reflections).

Reproduce: `yarn workspace ffx-denoiser dev`, then
`node examples/ffx-denoiser/run-headless.mjs "signal=shadows&mode=eval"
"signal=reflections&mode=eval" "signal=shadows&mode=bench"
"signal=reflections&mode=bench"`. Extra switches: `noHistory=1`,
`static=1`, `stats=ffx|current`, `tsf=`, `debug=<internal texture>`,
`err=<gain>` (error heat map), `stopAt=N` + `--shot=file.png`.

Not done: three.js `recurrentDenoise()` comparison for reflections (needs
the raw WebGPU textures wrapped as three nodes); subgroup fast paths; FFX's
SSSR tile classifier / variable-rate tracing (that's part of SSSR, not the
denoiser); a three.js TSL node wrapper.
