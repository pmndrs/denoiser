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
| NRD (NVIDIA: ReBLUR, ReLAX, SIGMA) | diffuse/specular GI, shadows — hand-tuned, not neural | source public, license (NVIDIA RTX SDKs) rules out a port; implement from the published papers instead (SVGF, A-SVGF, RTG II ReBLUR chapter) — see [research/nppd-fssa.md](../research/nppd-fssa.md#nrd-how-it-works-and-where-it-comes-from) |
| NPPD / FSSA (MPI Informatik, research) | neural, temporal; FSSA adds adaptive sampling | NPPD dropped; FSSA watch-only — see [research/nppd-fssa.md](../research/nppd-fssa.md) |
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

## GI-1.0 port

`Gi1Denoiser` (`TemporalDenoiser<DiffuseInputs>`, in `packages/denoiser-ffx`, users import
`denoiser/ffx`): AMD GI-1.0's image-space GI denoiser, ported to WGSL from AMD Capsaicin
v1.3 (commit `914b915`, MIT; AMD's notice in `shaders/gi1.ts` and the package `NOTICE`).
Not part of the FidelityFX SDK, but the same kind of work (an AMD MIT port of a hand-tuned
real-time filter), so it sits next to the FFX ports (pmndrs/gi DECISIONS 2026-11-19: "the
denoiser can go into denoiser like the other fidelity work"). The paper is GI-1.0
(Boissé et al., arXiv 2310.19855), §2.4.3 and Fig. 19.

What it does: per pixel, a running sum of the irradiance with its sample count in `w`,
reprojected through a 3x3 tent (rejecting samples whose world position is farther than about
a screen-probe tile, or whose normal differs, `dot > 0.95`); the history length adapts to a
smoothed luminance delta between the new sample and the history (up to 64 samples, 4 near
changes, shorter at the screen edges); where the history holds fewer than 8 samples a blur
mask sets a separable depth / normal-weighted blur of radius 8 − count, run horizontally then
vertically. The filtered sum is next frame's history.

### Passes and deviations

| Capsaicin | port |
|---|---|
| `InterpolateScreenProbes` writes the noisy irradiance into `g_GIDenoiser_ColorBuffer`, which `ReprojectGI` reads and overwrites in place | the input is its own texture (`DiffuseInputs.radiance`); `hintInAlpha` (default false) reads GI-1.0's keep / don't-keep hint from its alpha, otherwise every pixel is a sample to keep. A non-finite input sample is not kept (value 0) |
| previous depth and shading normal: the renderer's shared `PrevVisibilityDepth` / `PrevShadingNormal` | the caller's copies via `FrameGuides.previousDepth` / `previousNormal`, or, without them, a `keep` pass at the end of the frame copying depth (r32float) and the signed normal (rgba16float) for the next frame. The current depth and normal are read from the guides in place (depth-format and float pipeline variants) |
| sky = zero shading normal (its visibility buffer writes one) | the same, or depth at the far plane (`FrameGuides` doesn't promise a zero normal) |
| `ReprojectGI` (`gi1.comp:3997-4103`) | 1:1. Nearest-sampler reads become `textureLoad` at the clamped texel; `pow(t, 6)` and `pow(x, 0.25)` as products / square roots (WGSL's `pow` is undefined at 0). `RemoveNaNs` tests NaN / infinity by the bits instead of relying on `saturate(NaN) = 0` (WGSL doesn't promise it), and runs on the history's mean and count instead of its sum: Capsaicin's form caps the sum at 1e4, i.e. the irradiance at 1e4 / count (156 at 64 samples); ours caps the irradiance at 1e4 |
| `FilterGI` x2 (`gi1.comp:4105-4154`, `gi1.cpp:2898-2926`) | 1:1, two pipelines (horizontal, vertical + output) instead of a `g_BlurDirection` uniform |
| colour history RGBA16F, colour delta R16F | RGBA16F colour; every half store rounds to the nearest half first (pmndrs/gi's `rcNearestHalf`): rgba16float stores and `pack2x16float` truncate on some GPUs, which drags a running sum down by up to a half step per store. Delta and blur mask share an r32uint (two halves; neither R16F nor R8_SNORM is a storage format) |
| blur mask R8_SNORM | the same snorm8 values, as the high half of the delta's r32uint; internal, readable as `debugDeltaMask` |
| world positions, `g_Eye` | positions relative to the current eye (both inverse view-projections built in double precision on the host): the same distances, without f32 cancellation far from the origin |
| `toLinearDepth(depth, g_NearFar)` | linear depth from the inverse projection (any depth convention) |
| velocity (uv, current − previous, y down) | `guides.motion` (NDC delta) scaled by (0.5, −0.5) |
| `cell_size` from `ScreenProbes::probe_size_` (`gi1.cpp:1839-1843`) | `probeSize` option (default 8), from the projection's field of view |
| unorm normals decoded `2n − 1` | `normalEncoding: 'signed'` (default, FrameGuides' contract) or `'unorm'` (Capsaicin's decode) |
| the reprojected history is used as is; its length adapts to a luminance delta smoothed over 8 frames, so after a lighting change the output takes 45-160 frames to follow | **`historyClamp: 'neighbourhood'` (default):** a short history (running mean of at most 4 samples, rgb, plus its luminance variance, updated the exponential Welford way: a half can't hold E[l²] − E[l]² without cancelling to about 2 %) is reprojected with the long one through the same 3x3 weights; the long history's mean is clipped toward the short mean's box in YCoCg, ± `historyClip` (2) × the short mean's standard error (its samples' σ / √4); while the history is younger than 4 samples, ± `historyClip` × max(that σ, the input's spatial σ over 3x3) (A-SVGF's temporal moments, Schied et al. 2018; Salvi's variance clipping). The review's max(σ_spatial, σ_temporal) on every pixel kept a trail: on a mature pixel the spatial σ of a shadow's gradient widens the box (ghosting bed, noise-free: 274 pixels over 5 % at frame 64 against 143 before the move). Capsaicin's delta and `alpha_blend` still use the unclipped history, so the history also shortens. `'none'` = Capsaicin. An earlier 3x3 spatial-only clip was dropped: GI-1.0's input is probe-interpolated, its noise correlated over about 8 px, so with the interpolation jitter off the 3x3 σ is near 0 and the history snapped to the current frame |
| no change signal | **`changeReset` (default true)** with `Gi1Inputs.changedRegions` (world boxes, or `'everything'` for the sun / sky): a soft reset. For `changeFrames` (8) frames after a report, pixels in a region keep at most 3 samples of history and get `alpha_blend` 0 (Capsaicin's 4-sample cap), so the GI follows the change while staying denoised. More than 16 boxes over those frames count as everything. Only `resetHistory()` drops the history |

Memory: 48 bytes a pixel (colour and short history 2 x rgba16float each, delta + mask
2 x r32uint, output rgba16float), 60 when the denoiser keeps its own previous depth and normal;
398 MB at 3840x2160 (497 MB with its own copies). Capsaicin's own buffers are about 29 bytes
(240 MB at 4K); the difference is the short history (16 bytes, the clamp) and the r32uint
for delta and mask (R16F and R8 aren't storage formats).

`encode()` writes the frame's constants to one uniform buffer: encode one frame per instance
before each submit (a second `encode` on the same instance overwrites the first one's).

The paper calls the blur mask "dilated"; Capsaicin's v1.3 kernels don't dilate it, and the
port follows the code. `camera.jitter` (render pixels, as @pmndrs/upscaler) is applied to
both frames' inverse view-projections, so positions rebuilt from a jittered depth land where
they were drawn (the previous frame's jitter is kept by the denoiser).

### Interface additions (denoiser-core)

- `FrameGuides.previousDepth` / `previousNormal` (optional, both or neither): a caller that
  already keeps last frame's depth and normals (a renderer's screen history) hands them in,
  and `Gi1Denoiser` reprojects against them instead of its own copies. Ignored by the other
  denoisers.
- `TemporalDenoiser.encode?(encoder, inputs, guides, camera)` (optional): the frame recorded
  into the caller's encoder instead of submitted, for pipelines that build the inputs in the
  same encoder (a GI technique's screen passes). No `gpuTimings` for such frames.
  `Gi1Denoiser` implements it; `dispatch` is `encode` plus a submit.

### Checks and results

`examples/ffx-denoiser/gi1.html` (same dev server, port 5210; headless:
`BASE=http://127.0.0.1:5210/gi1.html node examples/ffx-denoiser/run-headless.mjs "checks=all"`;
on Windows pass the adapter with `CHROME_ARGS=--use-adapter-luid=<high>,<low>`). An analytic
scene (floor, back wall, a box that moves) ray cast per pixel in WGSL writes the guides, a
noisy irradiance and its noise-free value; 640x360.

RTX 3060 Laptop (Chrome, D3D12, `--use-adapter-luid`), 2026-11-19, defaults (`historyClamp`
'neighbourhood', `historyClip` 2, `changeReset` on), after the review's rework; `clamp=none` gives
Capsaicin's history. (The first round also ran on an Intel UHD gen-12lp; the rework hasn't.)

| check | result |
|---|---|
| still constant field (E = 0.7, 40 frames) | every pixel within 0.07 % of its input (one half step either way) |
| moving camera + moving box, constant field (60 frames) | the same, also inside the blur mask: no darkening at disocclusion edges |
| uniform noise ±50 % on a constant field (160 frames) | mean 0.9996 of the f32 value; frame-to-frame std of a pixel 0.76 % against the input's 28.9 % (the same with `clamp=none`) |
| box jumps after 40 still frames | all 4,846 uncovered pixels get the mask; 99.98 % of converged pixels don't |
| reprojection: converged world-space pattern, camera moves, the frame's input withheld (hint 0) | output = history: mean error 0.28 %; control with zero motion 8.7 % |
| NaN at every 37th and +infinity at every 53rd input pixel, every frame (28 frames) | output finite everywhere and within 0.07 % of the field |
| ghosting, noise-free: a box with a contact shadow on the floor slides 1.8 m in 30 frames and stops; passes when, 64 frames after the stop, no more pixels are over 5 % **and** over 2 % off than before the move | **passes**: back to the pre-move counts in 16 frames (5 %) and 25 (2 %). `clamp=none`: fails, 3,130 over 5 % at frame 64 against 145 |
| ghosting, 8 px tile noise ±30 % interpolated like GI-1.0's probes, lookup jittered | fails, narrowly at 5 %: 166 against 123 before the move (none: about 3,300); at 2 %: 5,936 against 3,426 |
| the same, jitter off | fails narrowly: 1,060 against 851 (5 %), 27,739 against 26,937 (2 %); the converged view is worse than with no clamp (851 pixels over 5 % before the move against 186): the box clips into probe noise that is smooth in space |

Capsaicin's ghosting is GI-1.0's design, not the port: a scalar model of `ReprojectGI`'s
recurrence (history cap 64, delta smoothed by 1/8) takes 45-160 frames to come within 5 % of
a step change in irradiance (1 -> 0.2: 159 frames; 0.6 -> 1: 107). The history only
shortens once the smoothed luminance delta is large against the history's own luminance, so
a darkening (a shadow arriving) is the slowest. Hence the clamp (pmndrs/gi, lead decision
2026-11-19: the lag is a defect for dynamic scenes).

How the clamp got here: a first 3x3 spatial-only clip (mean ± 1.5 σ of the input) passed the
noise-free check but clipped to probe noise once the interpolation jitter was off (Cornell,
pmndrs/gi: 5.0 % frame-to-frame against 0.24 % unclamped). The review's short history with
max(σ_spatial, σ_temporal) on every pixel kept a trail (the gradient's spatial σ) and, with
the short history's E[l²] stored in a half, a σ floor of about 2 % from cancellation. Now: the
short history's variance stored directly, and the box is its mean's standard error (spatial σ
only while the history is young). Sweep on the jitter-off tile-noise ghosting (over 5 % at
frame 64 / before): γ 1.5: 719 / 195; γ 2: 1,060 / 851; γ 2.5: 483 / 251; γ 3: 678 / 188;
noise-free γ 2.5 fails the 2 % criterion by 4 pixels (87 / 83), γ 2 passes.

`changeReset` is not exercised by the ghosting check (the moved box's bounds hold the box and
the floor under it, not the shadow beside it); pmndrs/gi's `radiance-cache-denoiser-change`
page moves a light through it.

Not done: timing (no bench run: the checks only test correctness), Apple GPUs,
a three.js node wrapper.
