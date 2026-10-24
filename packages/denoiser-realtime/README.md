# @pmndrs/denoiser-realtime

Real-time, per-signal `TemporalDenoiser`s for WebGPU, in WGSL, written from
published papers (clean room: see `docs/research/rt-denoiser/RULES.md`; every
pass cites its source in its shader header and in
`docs/research/rt-denoiser/PROVENANCE.md`). Users import it as
**`denoiser/realtime`**, which also re-exports the FidelityFX shadow and
reflection denoisers (`denoiser/ffx` keeps working).

| class | signal | conforms to |
|---|---|---|
| `DiffuseDenoiser` | diffuse indirect (GI) / AO | `TemporalDenoiser<DiffuseInputs>` |
| `SpecularDenoiser` | specular indirect (reflections) | `TemporalDenoiser<SpecularInputs>` |
| `DiffuseSpecularDenoiser` | both, one shared prepass | `TemporalDenoiser<DiffuseSpecularInputs>` (+ `dispatchBoth`) |

Classes are named by what they denoise; the algorithm is an option:
`filter: 'svgf'` (default) or `filter: 'recurrent'` (**provisional**, built against
SPEC v0 §5, which is not reviewed yet; see [Recurrent filter](#recurrent-filter-provisional)).

```ts
import { DiffuseSpecularDenoiser } from 'denoiser/realtime';

const gi = new DiffuseSpecularDenoiser(device, { filter: 'svgf', antiLag: 'auto' });
gi.configure({ width, height });
// every frame, after the frame's inputs are submitted:
if (cameraCut) gi.resetHistory();
const { diffuse, specular } = gi.dispatchBoth(
  {
    diffuse: { radiance: diffuseDemod },                      // 1 spp, demodulated (÷ albedo)
    specular: { radiance: specularDemod, hitDistance },       // 1 spp, ÷ pre-integrated specular term
  },
  { depth, normal, motion, roughness, viewZ /* optional */, motionZ /* optional */ },
  { view, projection, prevView, prevProjection, near, far },
);
// rgba16float, still demodulated (pass `remodulate: true` + `demodulation` to get radiance back).
```

## Two outputs from one `TemporalDenoiser`

`TemporalDenoiser.dispatch()` returns one texture, so:

- `DiffuseDenoiser` and `SpecularDenoiser` are independent and each conforms
  fully — the simplest choice for a registry of single-signal denoisers.
- `DiffuseSpecularDenoiser` shares the guide prepass (packed depth / slope /
  normal / roughness, and its previous-frame copy) between both signals.
  `dispatch()` returns the diffuse texture (so it still conforms) and fills
  `outputs`; `dispatchBoth()` returns `{ diffuse, specular }`. Per-signal
  options go in `{ diffuse: {...}, specular: {...} }`; shared ones at the top
  level.

## Inputs and conventions

Per [CAPTURE-FORMAT](../../docs/research/rt-denoiser/CAPTURE-FORMAT.md):
radiance arrives **demodulated** (diffuse ÷ albedo, specular ÷ the
pre-integrated split-sum term) and the output stays in that space unless
`remodulate: true` (diffuse multiplies by `inputs.demodulation ??
guides.albedo`, specular by `inputs.demodulation`).

- Motion: NDC delta, current − previous, +y up (three's `velocity`).
- Depth: any depth format or r32float device depth, linearized with the
  (unjittered) projection; or pass `guides.viewZ` (three.js view z, negative
  in front) to skip that.
- `guides.motionZ` (optional): 2.5D motion, viewZprev − viewZ in `.r`, for
  moving objects; without it the previous depth comes from the camera.
- Roughness: perceptual (GGX α = r²), required for specular.
- Sky / no surface: normal = 0 or depth at the far plane (or viewZ = −far); output 0.

Additions to `@pmndrs/denoiser-core/temporal.ts` (additive): `FrameGuides.viewZ`,
`FrameGuides.motionZ`, `DiffuseSpecularInputs`.

### A-SVGF anti-lag (`antiLag`)

- `'auto'`: temporal gradients estimated from the signal itself (per 3×3
  stratum: current mean luminance vs the reprojected accumulated history, with
  the noise of the current mean subtracted as a k·σ floor). No renderer work.
- `'gradient'`: A-SVGF proper. The renderer supplies `inputs.gradient`, one texel
  per 3×3 stratum (`ceil(W/3) × ceil(H/3)`, rgba32float/rgba16float):
  r = luminance of the forward-projected sample as shaded last frame,
  g = the same sample re-shaded this frame with the same random numbers,
  b > 0 = valid (A-SVGF §3.1–3.3).

## Options (SVGF)

All optional; defaults in brackets. Shared: `temporalAlpha` [0.2; 0.1 with
anti-lag], `momentsAlpha` [= temporalAlpha], `maxHistory` [64],
`historyFilter` ['bilinear' | 'catmull-rom'], `planeDistance` [0.01],
`normalThreshold` [0.95], `atrousIterations` [5], `kernel` ['3x3' | '5x5'],
`feedback` [true], `sigmaDepth/Normal/Luminance` [1, 128, 4],
`varianceRampFrames` [4], `spatialVarianceBoost` [3], `luminanceVariance`
['sample' | 'mean'], `antiLag` ['off' | 'auto' | 'gradient'],
`antiLagNoiseFloor` [2], `antiLagRadius` [1], `gradientIterations` [5],
`remodulate` [false], `timestamps` [true]. Specular only:
`specularHistoryScale` [1], `specularHistoryCurve` [0.5], `lobeFraction`
[0.75], `specularNormalWeight` ['lobe' | 'power'], `radiusScale` [1].

## Passes (per signal)

| pass | reads → writes | formats |
|---|---|---|
| (each pass below handles one or both signals per thread) | | |
| `prepass` (shared) | depth / viewZ, normal, roughness → tap geometry (linear depth f32, oct normal 12+12 b, roughness 8 b) and depth slope (2×f16) | rg32uint ×2 (ping-pong), r32uint |
| `gradient_create`, `gradient_atrous_0..4`, `gradient_lambda` (anti-lag only) | input, history → per 3×3 stratum (δ, Δ, var δ, valid), (mean l, var l, z, ∣∇z∣) → λ max-filtered over 3×3 strata | rgba32float ×4 + r32float at 1/3 res |
| `temporal` | input + reprojected history → integrated color + history length n; luminance moments | rgba16float ×2 (rgb, n), rg32float ×2 |
| `variance` | → color + **standard deviation** (bilateral spatial estimate blended in while n < 4) | rgba16float |
| `atrous_0..K-1` | edge-avoiding à-trous ping-pong; iteration 0 also writes the feedback history; the last writes the output | rgba16float ×2, + history (rgba16float), output (rgba16float) |

Internal memory per signal: 56 B/px including the output (+8 with feedback),
plus 20 B/px shared geometry: ≈ 148 B/px for diffuse + specular with feedback
(SPEC §10.2 estimates 112 without outputs; SVGF is the baseline, not the
memory-target filter). Anti-lag adds ~7 B/px per signal.

## Results (dev page, synthetic scene, 1920×1080, Apple M5 Pro, Chrome)

Synthetic analytic scene with an exact converged signal and injected noise
(relative σ = 1, Exp-distributed, 0.1 % fireflies; `dev/`), 120 frames, orbiting
camera with a cut at frame 60. PSNR on x/(1+x)-tonemapped demodulated values,
flicker = mean |e_t − e_{t−1}| (e = output − truth).

| | diffuse PSNR | flicker | specular PSNR | flicker |
|---|---|---|---|---|
| noisy input | 14.04 dB | — | 15.87 dB | — |
| spatial only (history reset every frame) | 40.13 | 0.0089 | 41.00 | 0.0080 |
| **SVGF (defaults)** | 40.48 | 0.0020 | 43.56 | 0.0017 |
| SVGF, `feedback: false` | 41.55 | 0.0021 | | |
| SVGF, `kernel: '5x5'` | 40.32 | 0.0021 | | |
| **A-SVGF (`antiLag: 'auto'`)** | **41.62** | **0.0017** | **44.52** | **0.0013** |

Light switching on at frame 60, static camera (diffuse): plain SVGF drops to
22.8 dB and needs ~8 frames to get back above 34 dB; `antiLag: 'auto'` drops to
27.6 dB and is above 35 dB after 3 frames; `'gradient'` (renderer samples)
27.1 dB, slower recovery (it only fires on the change frame, as in the paper).
No NaNs in any run.

GPU time per frame at 1080p (timestamp queries, min of 400 frames; median
within 5 %; other headless sessions were alive, so treat as possibly
contended):

| | prepass | temporal | variance | à-trous ×5 | anti-lag passes | total |
|---|---|---|---|---|---|---|
| `DiffuseDenoiser` | 0.18 | 0.39 | 0.17 | 0.31 + 4 × 0.27 | — | **2.18 ms** |
| `SpecularDenoiser` | 0.18 | 0.41 | 0.37 | 0.36 + 4 × 0.33 | — | **2.68 ms** |
| `DiffuseSpecularDenoiser` (joint dispatches) | 0.18 | 0.64 | 0.48 | 0.58 + 4 × 0.51 | — | **3.98 ms** |
| `DiffuseDenoiser`, `antiLag: 'auto'` | 0.18 | 0.41 | 0.18 | 1.40 | 0.45 + 0.36 + 0.04 | **3.08 ms** |
| `DiffuseSpecularDenoiser`, `antiLag: 'auto'` | 0.18 | 0.68 | 0.51 | 2.62 | 0.57 + 0.73 + 0.07 | **5.45 ms** |

`kernel: '5x5'` costs 0.7–1.0 ms per à-trous iteration (4.7 ms total for
diffuse); `atrousIterations: 4` saves one iteration. `DiffuseSpecularDenoiser`
processes both signals per thread in every pass (SPEC §4.1) unless their
structural options differ.

## Recurrent filter (provisional)

`filter: 'recurrent'`: the recurrent-blur pipeline of SPEC v0 §5 (pre-blur →
temporal accumulation → mips → history fix → blur → post-blur → temporal
stabilization; the post-blur output is next frame's history, the stabilization
history never feeds back). Written from RTG II ch. 49 prose and Zhdan's GTC 2020
talk plus our own designs; every pass cites its sources in
`src/shaders/recurrent.ts` and `docs/research/rt-denoiser/PROVENANCE.md`.

```ts
const gi = new DiffuseDenoiser(device, { filter: 'recurrent' });
gi.dispatch({ radiance: diffuseDemod, hitDistance /* optional, world units, 0 = miss */ }, guides, camera);
// rgb = denoised (demodulated); a = denoised normalized hit distance ĥ = h/(h + 1 + 0.05·depth), an AO estimate
```

- **Diffuse** is the M2 deliverable. **Specular** with `filter: 'recurrent'` is interim
  (surface motion only, no virtual motion until M3) and measures below SVGF, so
  `DiffuseSpecularDenoiser({ filter: 'recurrent' })` runs recurrent diffuse + SVGF
  (`antiLag: 'auto'`) specular; `specular: { filter: 'recurrent' }` puts both in shared
  dispatches.
- The output texture rotates between internal buffers (valid until the next dispatch,
  per the TemporalDenoiser contract).
- Options (defaults): `hitDistanceScale` [1], `hitDistanceViewScale` [0.05],
  `maxRadiance` [1e4], `preBlurRadius` [25 diffuse / 10 specular px @1080p],
  `blurRadius` [45 px @1080p], `minBlurRadius` [1], `maxAccumulatedFrames` [31],
  `fastFrames` [3], `historyFixFrames` [3], `historyFixDepthTolerance` [0.02],
  `historyFixMinWeight` [0.25], `fireflyThreshold` [1.5], `antiLag` [true],
  `antiLagSigma` [1], `antiLagStandardError` [true], `antiLagExcess` [0.5],
  `antiLagHitTolerance` [0.2], `antiLagCurrentSigma` [3], `antiLagCurrentHitTolerance`
  [0.05], `stabilizationFrames` [7], `planeDistance` [0.01], `lobeFraction` [0.75],
  `specularHistoryScale` [1], `remodulate` [false], `timestamps` [true].

| pass | reads → writes | formats |
|---|---|---|
| `prepass` (shared) | guides → packed geometry | rg32uint ×2, r32uint |
| `pre_blur` | radiance (sanitized), hit distance → 8-tap static disk on the tangent plane, radius clamped by last frame's denoised hit distance; ĥ unfiltered | rgba16float |
| `temporal` | + reprojected history (Catmull-Rom / custom bilinear) → acc = lerp(H, pre, 1/(1+A)); fast history (A ≤ 3); A + 2×2 validity packed in `data`; current-frame anti-lag detector | rgba16float ×2, rgba16float (fast), r32uint |
| `mips` | acc → 3-level atlas (non-sky averages), depth atlas, one 16×16 shared-memory dispatch | rgba16float (rotation buffer), r32float |
| `history_fix` | mip repair where A < 3, rank anti-firefly, fast-history clamp + A reduction (`data` read-write) | rgba16float, r32uint rw |
| `blur` | rotated 8-tap disk, radius 45/(1+A) px, clamped by hit distance; geometry · normal · ĥ weights | rgba16float |
| `post_blur` | unrotated, radius × lerp(0.5, 2, δ/0.3) → next frame's history | rgba16float |
| `stabilize` | own history, 3×3 clamp widening with A → output | rgba16float (+ remodulated outputs) |

Memory (diffuse + specular): 4 rgba16float rotation buffers per signal, fast history
×2, `data` ×2, depth atlas, geometry: 105.5 B/px as in SPEC §10.1, plus the shared
prepass's 4 B/px depth-slope texture = 109.5 B/px; diffuse only 77.5 B/px.

### Results (provisional)

**Test bed** (`examples/realtime-denoiser`, path-traced one-bounce GI and GGX specular,
256-spp references, blue-noise sampling), 1920×1080, 96 frames per path, PSNR in dB on
tonemapped demodulated values (mean over frames), registry entries `svgf`, `svgf-auto`
and a local `recurrent` entry (see TASKS):

| diffuse | SVGF | A-SVGF auto | recurrent | disocc. (auto / rec.) | flicker (auto / rec.) | energy (auto / rec.) |
|---|---|---|---|---|---|---|
| orbit | 38.23 | 39.23 | **39.85** | 37.93 / 36.59 | 0.0027 / 0.0037 | −2.8 % / −1.1 % |
| pan | 37.90 | 38.64 | **39.05** | 37.83 / 36.71 | 0.0071 / 0.0081 | −2.6 % / −1.0 % |
| light | 38.03 | 39.11 | **39.97** | – | 0.0009 / 0.0006 | −2.8 % / −1.0 % |
| thin | 33.83 | 34.12 | **34.18** | 37.99 / 37.68 | 0.0050 / 0.0058 | −2.6 % / −1.1 % |
| glossy | 37.91 | 38.62 | **39.74** | 35.90 / 36.05 | 0.0023 / 0.0027 | −2.5 % / −1.1 % |
| cut | 37.38 | 38.15 | **39.10** | 37.98 / 36.59 | 0.0031 / 0.0041 | −3.1 % / −1.1 % |
| object | 36.41 | **37.09** | 37.07 | 36.90 / 34.33 | 0.0015 / 0.0013 | −2.9 % / −1.2 % |

Recurrent diffuse beats A-SVGF on 6 of 7 paths (+0.06 to +1.12 dB) and loses less
energy; it is weaker in freshly disoccluded regions (−1 to −2.6 dB) and flickers a
little more under camera motion. Interim recurrent specular (surface motion only) is
0.5–3 dB below A-SVGF on every path (hence the SVGF default above).

**Dev page** (synthetic scene: direct point lights with hard shadows, exact truth +
injected noise; 120 frames orbit + cut): recurrent 38.41 dB vs SVGF 40.48 / A-SVGF
41.62. A light switching on (static camera): 12 frames later recurrent 34.2 dB, SVGF
38.0, A-SVGF 40.4. Hard direct-light shadow edges and abrupt lighting changes are the
recurrent blur's worst case (no luminance weight; the history moves at most 1/(1+A) per
frame); no NaNs in any run.

**GPU time** at 1080p (dev page, M5 Pro, min of 400 frames, uncontended; median within 8 %):

| | prepass | pre_blur | temporal | mips | history_fix | blur | post_blur | stabilize | total |
|---|---|---|---|---|---|---|---|---|---|
| `DiffuseDenoiser` recurrent | 0.18 | 0.48 | 0.53 | 0.08 | 0.51 | 0.33 | 0.40 | 0.40 | **2.92 ms** |
| diffuse + specular, shared dispatches | 0.18 | 0.82 | 0.84 | 0.11 | 0.79 | 0.83 | 0.83 | 0.79 | **5.22 ms** |
| skeleton (trivial kernels, same bindings), diffuse + specular | 0.18 | 0.24 | 0.16 | 0.09 | 0.09 | 0.05 | 0.06 | 0.09 | 0.96 ms |

`DiffuseSpecularDenoiser({ filter: 'recurrent' })` (recurrent diffuse + A-SVGF specular)
is 6.48 ms. Over the 4 ms target for diffuse + specular; see TASKS for the levers.

## Dev page

`yarn workspace @pmndrs/denoiser-realtime dev` (port 5240), then
`node packages/denoiser-realtime/dev/run-headless.mjs "signal=diffuse&mode=eval"
"signal=both&mode=bench"`. Query switches: `signal=diffuse|specular|both`,
`mode=eval|bench`, `w`, `h`, `frames`, `path=orbit|static|pan`, `cut=N`,
`switch=N` (a light turns on), `noise`, `ff`, `noHistory=1`,
`antiLag=off|auto|gradient`, `kernel`, `iters`, `feedback=0`, `history`,
`alpha`, `view=out|noisy|ref|err|histlen`, `gain`, `stopAt=N`, `filter=recurrent`,
`r.<option>=…` / `t.<tune>=…` (recurrent options), `skeleton=1`, `specularFilter=svgf|recurrent`,
`still=1` (lights don't move), `hit=0`, `--shot=file.png`,
`--json=file.json`. See the shader headers for sources.
