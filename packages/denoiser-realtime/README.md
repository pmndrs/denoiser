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
| `OcclusionDenoiser` | AO / SO from hit distance (provisional, [Occlusion](#occlusion-provisional)) | `TemporalDenoiser<OcclusionInputs>` (+ `dispatchBoth`) |

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
- **v2** (`antiLagVersion: 2`, default since 2026-10-25; results/M1.md §12): the noise
  floor uses the variance of the *reconstructed* gradient (local var δ × ΣK² of the
  composite à-trous kernel, tracked through the iterations). v1 propagated var as if
  every tap were independent, so σ came out ~4.5× too small, λ was > 0 on ~90 % of
  static pixels and histories never passed ~13 frames. v2 floors at k = 2 for diffuse
  (static histories now reach 32–64 frames) and k = 1 for specular (stays sensitive to
  view-dependent drift, which the test bed rewards). It is also much cheaper: one
  reprojection per stratum (history mean from 4 bilinear taps), packed f16 state, 4
  reconstruction iterations, and a 3×3 young-history variance for specular. Same
  quality as v1 (diffuse 39.12 vs 39.13, specular 35.04 vs 34.96 dB pooled, 7 paths)
  for +0.25 ms over `'off'` on the joint denoiser (v1: +1.7 ms). `antiLagVersion: 1`
  restores the M1 passes for comparisons.
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
`feedback` [false; the paper's true compounds blur, results/M1.md §4], `sigmaDepth/Normal/Luminance` [1, 128, 4],
`varianceRampFrames` [4], `spatialVarianceBoost` [3], `spatialVarianceRadius` [3; 1 for
specular with anti-lag v2], `luminanceVariance`
['sample' | 'mean'], `antiLag` ['off' | 'auto' | 'gradient'], `antiLagVersion` [2 | 1],
`antiLagNoiseFloor` [diffuse 2, specular 1; v1: 2], `antiLagRadius` [1], `gradientIterations` [4; v1: 5],
`remodulate` [false], `timestamps` [true]. Specular only:
`specularHistoryScale` [1], `specularHistoryCurve` [0.5], `lobeFraction`
[0.75], `specularNormalWeight` ['lobe' | 'power'], `radiusScale` [1].

## Passes (per signal)

| pass | reads → writes | formats |
|---|---|---|
| (each pass below handles one or both signals per thread) | | |
| `prepass` (shared) | depth / viewZ, normal, roughness → tap geometry (linear depth f32, oct normal 12+12 b, roughness 8 b) and depth slope (2×f16) | rg32uint ×2 (ping-pong), r32uint |
| `gradient_create`, `gradient_atrous_0..3`, `gradient_lambda` (anti-lag only) | input, history → per 3×3 stratum (δ, Δ, σ δ, 1 + kernel variance), (mean l, σ l, z, ∣∇z∣) as 8 × f16 → λ max-filtered over 3×3 strata | rgba32uint ×2 + r32float at 1/3 res (v1: rgba32float ×4, 5 iterations) |
| `temporal` | input + reprojected history → integrated color + history length n; luminance moments | rgba16float ×2 (rgb, n), rg32float ×2 |
| `variance` | → color + **standard deviation** (bilateral spatial estimate blended in while n < 4) | rgba16float |
| `atrous_0..K-1` | edge-avoiding à-trous ping-pong; iteration 0 also writes the feedback history; the last writes the output | rgba16float ×2, + history (rgba16float), output (rgba16float) |

Internal memory per signal: 56 B/px including the output (+8 with feedback),
plus 20 B/px shared geometry: ≈ 148 B/px for diffuse + specular with feedback
(SPEC §10.2 estimates 112 without outputs; SVGF is the baseline, not the
memory-target filter). Anti-lag adds 4 B/px per signal (v1: ~7.6).

## Results (dev page, synthetic scene, 1920×1080, Apple M5 Pro, Chrome)

Synthetic analytic scene with an exact converged signal and injected noise
(relative σ = 1, Exp-distributed, 0.1 % fireflies; `dev/`), 120 frames, orbiting
camera with a cut at frame 60. PSNR on x/(1+x)-tonemapped demodulated values,
flicker = mean |e_t − e_{t−1}| (e = output − truth).

| | diffuse PSNR | flicker | specular PSNR | flicker |
|---|---|---|---|---|
| noisy input | 14.04 dB | — | 15.87 dB | — |
| spatial only (history reset every frame) | 40.13 | 0.0089 | 41.00 | 0.0080 |
| **SVGF (defaults: `feedback: false`)** | 41.55 | 0.0021 | 45.64 | 0.0018 |
| SVGF, `feedback: true` (paper; old default) | 40.48 | 0.0020 | 43.56 | 0.0017 |
| SVGF, `feedback: true, kernel: '5x5'` | 40.32 | 0.0021 | | |
| **A-SVGF (`antiLag: 'auto'`, quality option)** | **42.52** | **0.0018** | **46.39** | **0.0015** |
| A-SVGF, `feedback: true` | 41.62 | 0.0017 | 44.52 | 0.0013 |

Light switching on at frame 60, static camera (diffuse): plain SVGF drops to
22.8 dB and needs ~8 frames to get back above 34 dB; `antiLag: 'auto'` drops to
27.6 dB and is above 35 dB after 3 frames; `'gradient'` (renderer samples)
27.1 dB, slower recovery (it only fires on the change frame, as in the paper).
No NaNs in any run.

Defaults: `antiLag` stays `'off'` (Dennis decides, SPEC §12 item 2); `antiLag: 'auto'` is
the quality option (test bed, pooled: +0.24 dB diffuse, +1.58 dB specular over 7 paths,
~3-frame light-change recovery vs ~8) and with v2 costs **+0.25 ms** on the joint denoiser
at 1080p (4.24 vs 3.99 ms, test-bed orbit bench; v1 was 5.61–5.74). The light-switch
numbers above were measured with `feedback: true` and anti-lag v1.

GPU time per frame at 1080p (timestamp queries, min of 400 frames; median
within 5 %). Rows marked † were re-measured uncontended with the `feedback: false`
default (2026-10-25); the others are the earlier `feedback: true` measurements (possibly
contended; feedback costs one extra history write):

| | prepass | temporal | variance | à-trous ×5 | anti-lag passes | total |
|---|---|---|---|---|---|---|
| `DiffuseDenoiser` † | 0.18 | 0.41 | 0.18 | 0.29 + 4 × 0.28 | — | **2.18 ms** |
| `SpecularDenoiser` | 0.18 | 0.41 | 0.37 | 0.36 + 4 × 0.33 | — | **2.68 ms** |
| `DiffuseSpecularDenoiser` (joint dispatches) † | 0.18 | 0.66 | 0.49 | 0.54 + 4 × 0.52 | — | **3.98 ms** |
| `DiffuseDenoiser`, `antiLag: 'auto'` | 0.18 | 0.41 | 0.18 | 1.40 | 0.45 + 0.36 + 0.04 | **3.08 ms** |
| `DiffuseSpecularDenoiser`, `antiLag: 'auto'` v1 † | 0.18 | 0.68 | 0.51 | 2.57 | 0.57 + 0.73 + 0.07 | **5.43 ms** |
| test bed (orbit, solo bench, median, 2026-10-25): joint `'off'` | 0.15 | 0.59 | 0.76 | 2.35 | — | **3.99 ms** |
| test bed: joint `'auto'` v1 | 0.15 | 0.63 | 1.10 | 2.32 | 0.57 + 0.63 + 0.07 | **5.61 ms** |
| test bed: joint `'auto'` v2 | 0.15 | 0.61 | 0.51 | 2.33 | 0.28 + 0.14 + 0.07 | **4.24 ms** |

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

- **Diffuse** (M2) and **specular** (M3) are implemented; both are **provisional** and, on
  the test bed, **below today's SVGF defaults** (see results). Specular adds virtual
  (reflected-image) reprojection with a curvature-corrected distance, confidence, clamp and an
  α-space blend with surface motion (SPEC R-9…R-12, D12c).
- `DiffuseSpecularDenoiser({ filter: 'recurrent' })` runs recurrent diffuse + SVGF
  (`antiLag: 'auto'`) specular (unchanged default, Dennis decides; SPEC §12 item 1);
  `specular: { filter: 'recurrent' }` puts both in shared dispatches.
- The output texture rotates between internal buffers (valid until the next dispatch,
  per the TemporalDenoiser contract).
- Options (defaults): `hitDistanceScale` [1], `hitDistanceViewScale` [0.05],
  `maxRadiance` [1e4], `preBlurRadius` [25 diffuse / 10 specular px @1080p],
  `blurRadius` [45 diffuse / 30 specular px @1080p], `minBlurRadius` [1],
  `specularMinRadiusScale` [1: the floor scales with f_r, none on mirrors], `preBlurTaps`
  [8 diffuse / 4 specular], `blurTaps` [8], `postBlurTaps` [4] (4 or 8, compiled in),
  `maxAccumulatedFrames` [31], `fastFrames` [3], `historyFixFrames` [3],
  `historyFixDepthTolerance` [0.02], `historyFixMinWeight` [0.25], `fireflyThreshold` [1.5],
  `antiLag` [true], `antiLagSigma` [1], `antiLagStandardError` [true], `antiLagExcess` [0.5],
  `antiLagHitTolerance` [0.2], `antiLagCurrentSigma` [3], `antiLagCurrentHitTolerance`
  [0.05], `stabilizationFrames` [7], `planeDistance` [0.01], `lobeFraction` [0.75],
  `specularHistoryScale` [1], `virtualMotion` [true], `virtualClampSigma` [1],
  `virtualAngleScale` [0.5], `virtualHitTolerance` [0.05], `virtualHitToleranceRoughness`
  [0.25], `remodulate` [false], `timestamps` [true].

| pass | reads → writes | formats |
|---|---|---|
| `prepass` (shared) | guides → packed geometry (no depth slope for recurrent-only denoisers) | rg32uint ×2 |
| `pre_blur` | radiance (sanitized), hit distance → static disk on the tangent / lobe plane, radius clamped by last frame's denoised hit distance; ĥ unfiltered | rgba16float |
| `temporal` | + reprojected history (Catmull-Rom / custom bilinear) → acc = lerp(H, pre, 1/(1+A)); specular: surface + virtual candidates blended in α by F_dom·[valid]; fast history (A ≤ 3); A + 2×2 validity + m packed in `data`; current-frame anti-lag detector (10×10 shared tile) | rgba16float ×2, rgba16float (fast), r32uint |
| `mips` | acc → 3-level atlas (non-sky averages), depth atlas, one 16×16 shared-memory dispatch | rgba16float (rotation buffer), r32float |
| `history_fix` | mip repair where A < 3, rank anti-firefly, fast-history clamp + A reduction (`data` read-write; shared tile) | rgba16float, r32uint rw |
| `blur` | rotated 8-tap disk, radius R_max/(1+A), clamped by hit distance; geometry · normal · ĥ (· roughness) weights | rgba16float |
| `post_blur` | unrotated 4-tap disk, radius × lerp(0.5, 2, δ/0.3) → next frame's history | rgba16float |
| `stabilize` | own history (bilinear diffuse / Catmull-Rom specular), 3×3 clamp widening with A → output | rgba16float (+ remodulated outputs) |

Memory (diffuse + specular): 4 rgba16float rotation buffers per signal, fast history ×2,
`data` ×2, depth atlas, geometry ×2: **105.5 B/px** (target ≤ 100; half-res fast history would
give 93.5, not implemented); diffuse only 73.5 B/px.

### Results (provisional; full tables in `docs/research/rt-denoiser/results/M2-M3.md`)

**Test bed** (`examples/realtime-denoiser`, path-traced one-bounce GI and GGX specular,
256-spp references, blue-noise sampling), 1920×1080, 96 frames per path, all three filters in
the **same page** with today's defaults (SVGF `feedback: false`), PSNR in dB on tonemapped
demodulated values (mean of per-frame dB; pooled in the results doc):

| path | diffuse SVGF | A-SVGF auto | recurrent | specular SVGF | A-SVGF auto | recurrent |
|---|---|---|---|---|---|---|
| orbit | 40.68 | **41.01** | 39.90 | 32.37 | **33.80** | 32.85 |
| pan | 40.12 | **40.46** | 39.06 | 35.90 | **37.24** | 35.66 |
| light | 40.62 | **40.99** | 39.99 | 35.11 | **35.29** | 34.40 |
| thin | 34.41 | **34.47** | 34.17 | 35.41 | **35.93** | 35.44 |
| glossy | 39.50 | 39.72 | **39.73** | 31.65 | 34.63 | **34.80** |
| cut | 39.77 | **40.07** | 39.16 | 33.80 | **35.21** | 34.14 |
| object | 37.89 | **38.17** | 37.09 | 34.37 | **35.10** | 33.57 |
| mean | 39.00 | **39.27** | 38.44 | 34.09 | **35.32** | 34.41 |

Recurrent loses to A-SVGF `auto` on 6/7 paths for both signals (wins `glossy`), and to plain
SVGF on diffuse (6/7); recurrent specular beats plain SVGF on 4/7. It is weaker in disoccluded
regions (−1.2 dB diffuse) and after light changes (diffuse back within 0.5 dB after 11 frames
vs 5 for A-SVGF). No NaNs in any run.

**GPU time** at 1080p (dev page, M5 Pro, min of 400 frames, uncontended; median within 5 %):

| | prepass | pre_blur | temporal | mips | history_fix | blur | post_blur | stabilize | total |
|---|---|---|---|---|---|---|---|---|---|
| `DiffuseDenoiser` recurrent | 0.10 | 0.50 | 0.50 | 0.08 | 0.31 | 0.35 | 0.22 | 0.31 | **2.38 ms** |
| `SpecularDenoiser` recurrent | 0.10 | 0.34 | 0.92 | 0.08 | 0.31 | 0.40 | 0.26 | 0.38 | **2.79 ms** |
| diffuse + specular, shared dispatches | 0.10 | 0.75 | 1.20 | 0.11 | 0.47 | 0.87 | 0.46 | 0.48 | **4.44 ms** |
| skeleton (trivial kernels, same bindings), diffuse + specular | 0.10 | 0.23 | 0.15 | 0.09 | 0.09 | 0.05 | 0.06 | 0.09 | 0.85 ms |

`blurTaps: 4` gives 4.05 ms (−0.07 dB diffuse, +5 % flicker). For comparison, joint SVGF is
4.02 ms, joint A-SVGF `auto` 5.55 ms, and `DiffuseSpecularDenoiser({ filter: 'recurrent' })`
(recurrent diffuse + A-SVGF specular) 5.98 ms.

## Occlusion (provisional)

`OcclusionDenoiser` denoises ambient occlusion (AO, from the diffuse ray) and specular
occlusion (SO, from the specular ray) as the **normalized hit distance** of the renderer's
1-spp rays, ĥ = h / (h + a + b·depth) (SPEC F-3 / §8; a = `hitDistanceScale` = 1 world unit,
b = `hitDistanceViewScale` = 0.05; miss → 1). Output: ĥ in `.r` (1 = open, → 0 at contact).
Provisional: SPEC v0.1 §8 is an outline Dennis has not reviewed; defaults were tuned on the
test bed it is scored on.

```ts
import { OcclusionDenoiser } from 'denoiser/realtime';

const ao = new OcclusionDenoiser(device, { filter: 'svgf' });          // or 'recurrent' (default)
ao.configure({ width, height });
const aoTex = ao.dispatch({ hitDistance: diffuseHitT }, guides, camera); // ĥ in .r

const both = new OcclusionDenoiser(device, { filter: 'svgf', signal: 'both' }); // SO needs guides.roughness
const { diffuse, specular } = both.dispatchBoth(
  { diffuse: { hitDistance: diffuseHitT }, specular: { hitDistance: specularHitT } }, guides, camera);
```

- `filter: 'recurrent'`: the recurrent pipeline's occlusion-only mode (signal kinds `ao` / `so`
  in `src/shaders/recurrent.ts`): the same passes with the radiance channels dropped, one
  r32float per signal, no pre-blur (the temporal pass normalizes the raw hit distance), anti-lag
  on ĥ only, the slow ĥ clamped into the fast-history window, and for SO the fast ĥ follows the
  virtual (reflection) reprojection. Every `RecurrentOptions` key applies; occlusion defaults:
  AO blur radius 20 px, minimum radius 2 px.
- `filter: 'svgf'`: SVGF (unchanged `SvgfPipeline`) on ĥ written as a gray image by a
  normalization pass. Occlusion defaults: `sigmaLuminance` 1.5, `atrousIterations` 3, SO
  `temporalAlpha` 0.3 (the radiance defaults 4 / 5 / 0.2 over-blur ĥ: −0.5 dB AO, −1.8 dB SO at
  1080p). `antiLag: 'auto'` works as for radiance.
- `HitDistanceNormalizer`: the normalization pass alone (noisy AO / SO as a gray image). It
  starts at the denoiser's default curve (a 1, b 0.05); `setCurve(a, b, far)` changes it.
- "Free" AO / SO: `filter: 'recurrent'` radiance outputs keep the denoised ĥ in alpha. It costs
  nothing extra but is clearly worse than either dedicated filter (below).

**Test bed** (`examples/realtime-denoiser`, signals `ao` / `so`, references = mean of
per-sample normalized hit distances, 1920×1080, 96 frames, 7 paths; pooled PSNR on ĥ in [0, 1],
mean over paths; "contact" = pixels whose reference ĥ < 0.5; full tables: `results/M5.md`):

| | AO PSNR | AO contact | SO PSNR | SO contact | GPU ms AO / SO / both (1080p, M5 Pro, fastest clock) | B/px AO / AO + SO |
|---|---|---|---|---|---|---|
| noisy 1 spp | 14.55 | 9.65 | 17.65 | 14.72 | | |
| `recurrent` | 38.02 | 31.09 | 37.37 | 33.47 | **1.32** / **1.32** / **2.39** | **57.5** / **73.5** |
| `svgf` | 38.93 | 33.53 | 38.76 | 35.66 | 1.37 / 1.92 / 2.99 | 84 / 148 |
| `svgf`, `antiLag: 'auto'` | **39.05** | **34.14** | **39.52** | **36.37** | 2.16 / 2.53 / 5.27 | 92 / 163 |
| recurrent radiance alpha ("free") | 35.15 | 27.64 | 35.47 | 32.10 | 0 extra | 0 extra |

(Medians run 15–60 % above the fastest-clock numbers; `results/M5.md` §5.)

SVGF beats the recurrent occlusion mode on every path for both signals (+0.9 dB AO,
+1.4 dB SO), A-SVGF `auto` is best overall; recurrent is the memory-lean option and flickers
least on the static-light path. The radiance alpha is 2.9 dB (AO) / 1.9 dB (SO) below the
dedicated recurrent mode and doubles FLIP: "nearly free" holds for cost, not for quality.

## Shadows (provisional)

`ShadowDenoiser` (`TemporalDenoiser<ShadowInputs>`, registry id `shadows`): a penumbra-aware
denoiser for 1-ray (or few-ray) shadow visibility, built against SPEC v0.1 §7 (not reviewed
yet: **provisional**). Fractional visibility is kept end to end (never thresholded), the
history accumulates raw visibility only (no spatial output fed back), and the spatial kernel
is sized per pixel from the penumbra width (Mehta et al. 2012, from the occluder distance and
the light size) blended with a noise estimate (Heitz et al. 2018). A short stabilization history of
the final output (v2.2, RTG II ch. 49 §49.5.7) removes the frame-to-frame "boil" of wide, soft
penumbrae. Sources per pass:
`src/shaders/shadow.ts` header and `docs/research/rt-denoiser/PROVENANCE.md` "Shadows (M4)".

```ts
import { ShadowDenoiser } from 'denoiser/realtime';

const shadows = new ShadowDenoiser(device);
shadows.configure({ width, height });
// every frame:
if (cameraCut) shadows.resetHistory();
const out = shadows.dispatch(
  {
    visibility,              // [0, 1], 1 = lit (r8unorm / r16float / r32float), one ray per pixel
    hitDistance,             // optional: distance to the occluder, world units, 0 = unoccluded
    light: { type: 'sphere', position: [x, y, z], radius: r },
    //  or { type: 'directional', direction: [dx, dy, dz] /* toward the light */, angularRadius: 0.0047 }
  },
  { depth, normal, motion, viewZ /* optional */, motionZ /* optional */ },
  { view, projection, prevView, prevProjection, near, far },
);
// out: r32float denoised visibility (valid until the next dispatch; two textures alternate)
```

- Without `hitDistance` or `light` it falls back to the noise-driven radius alone (H18).
- One light per instance (filter per light, as RTG I ch. 19 does). The `light` option sets a
  default for inputs that carry none.
- Renderer contract (SPEC SH-7, not enforced): unjittered shadow-ray origins; blue-noise light
  samples (golden-ratio animation for a scalar, R2 for 2-D samples). The temporal clamp relies
  on blue-noise samples (its window is about 2 standard errors of the 5×5 mean).
- Options (defaults): `maxHistory` [15], `historyScale` [1] (history cap ≈ W_px²), `minHistory`
  [1], `clampSigma` [0.4], `clampFloor` [0.05], `clampGeometry` [true] (normal-tested 5×5 window), `clampMinTaps` [3], `clampEdgePx` [2], `antiLag` [64], `antiLagHistory` [0],
  `stabilize` [0.25] (0 = off: no pass, 40 B/px), `stabilizeBox` [0.05 @1080p], `stabilizeAntiLag` [64], `stabilizeYoung` [0], `rotationStep` [0.618],
  `uniformSnap` [true], `catmullRom` [true], `planeDistance` [0.01], `radiusScale` [0.75],
  `historyShrink` [0.5], `minRadius` [1 px], `maxRadius` [48 px @1080p], `maxScaleHistory` [7],
  `noiseRadius` [32 px @1080p], `noiseBlend` [0.5], `noiseYoung` [0], `youngMean` [0.75],
  `youngFrames` [8], `youngTaper` [0.25], `youngRadius` [2], `youngMinPx` [1], `mergeMin` [true], `terminatorRadius`
  [16 px @1080p], `geometryTolerance` [0.02], `normalAngle` [30°], `normalWeight` [true],
  `pass1Phase` [0.382], `spatialPasses` [2], `tileSkip` [true], `anisotropy` [false],
  `anisotropyMax` [4], `freshBoost` [0], `timestamps` [true]; `uniformSnap` also takes
  `'change'` (snap only after a change). Every one is documented in `src/shadow.ts`; M4.md has
  the measurements behind them.

| pass | threads | reads → writes |
|---|---|---|
| `temporal` | 8×8 per tile, shared raw visibility (+ depth for the young-history mean) | guides, visibility, hit distance, previous geometry/history → geometry (rg32uint; its spare byte carries the noise estimate E), history (rgba16float: v, penumbra scale g, A, n_g), unfiltered copies T and out (r32float), tile stats |
| `tiles` | 1 per 8×8 tile | 3×3-tile nearest-occluder scale; indirect list of penumbra tiles |
| `spatial0` | indirect, penumbra tiles | out copy → T: 8-tap rotated disk on the receiver's tangent plane |
| `spatial1` | indirect, penumbra tiles | T → out: same, half radius, another rotation |
| `stabilize` | indirect, penumbra tiles | out + last frame's final output → final output: reprojected, clamped to the 3×3 range of this frame's output, blended 0.25; only where that range is narrow (wide penumbrae); anti-lag on the clamp distance (v2.2) |

With `stabilize` on (default) the temporal pass writes its unfiltered copy into the final output pair
and the spatial passes run final → T → out. Memory: **48 B/px** (40 without `stabilize`) + 16 B per 8×8
tile (100 MB at 1080p). Core WebGPU only (≤ 4 storage textures per pass).

### Results (provisional; tables in `docs/research/rt-denoiser/results/M4.md`)

**Test bed** (`examples/realtime-denoiser`, analytic scene, one sphere light, 1-spp blue-noise
visibility, 256-spp references), 1920×1080, 96 frames per path, 7 stress paths, PSNR on
visibility, **pooled** (PSNR of the mean squared error over all frames and pixels):

| | PSNR | penumbra | disoccluded | FLIP | flicker | GPU ms (solo, 7 paths) |
|---|---|---|---|---|---|---|
| FFX shadows (`denoiser/ffx`) | 31.20 | 23.50 | 32.91 | 0.038 | 0.0053 | 0.50–0.61 |
| `ShadowDenoiser` v1 options | 36.55 | 28.11 | 33.19 | 0.018 | 0.0035 | 0.48–0.58 |
| `ShadowDenoiser` v2 | 37.11 | 28.57 | 34.68 | 0.018 | 0.0033 | 0.48–0.59 |
| `ShadowDenoiser` v2.1 | 38.12 | 29.05 | 35.33 | 0.0129 | 0.0027 | 0.58–0.69 |
| **`ShadowDenoiser` (defaults, v2.2)** | **38.22** | **29.16** | **35.51** | 0.0131 | **0.0024** | 0.55–0.72 |

Ahead of FFX on every path. **v2.2** (M4.md §12, "Moving shadows") fixes visible boiling in wide,
soft penumbrae (the rotating torus knot's shadow on the three.js page): in that shadow the output's
frame-to-frame noise drops from 4.9× FFX's to FFX's level (0.0013 vs 0.0062 per frame, FFX 0.0011) while
staying 8 dB more accurate; on the test bed flicker −11 % and temporal PSNR +0.5 dB at 1080p, worst path
`light` −0.19 dB (a little lag after light changes). The stabilization pass costs 0.03–0.05 ms (`stabilize: 0`
turns it off: v2.1's cost, 40 B/px; v2.1 read 0.52–0.66 ms on the same bench). v2.1 (M4.md §11) fixes the frame-2 dip after a reset and leads FFX
from frame 0 on the reset-window replays, including `std1080-orbit`; it costs ~+0.1 ms (the
normal-tested clamp), so 5 of 7 paths are over the 0.6 ms target (`clampGeometry: false` returns
to v2's cost and gives up ~1 dB pooled; SPEC §12). GPU
ms are the fastest of 4 solo runs (Apple M5 Pro, Chrome; the GPU has two clock states, ×1.3–1.8).
Per pass on `thin`, the penumbra-heaviest view: temporal 0.33, tiles 0.005, spatial 0.13 + 0.12 ms.
`youngMean: 0` saves ~0.025 ms (−0.07 dB). Directional lights: the code path is exercised on
images only through a stand-in (the test bed's sphere light handed over as a directional light,
M4.md §10.7). Provisional: tuned and scored on the same scene.

## Dev page

`yarn workspace @pmndrs/denoiser-realtime dev` (port 5240), then
`node packages/denoiser-realtime/dev/run-headless.mjs "signal=diffuse&mode=eval"
"signal=both&mode=bench"`. Query switches: `signal=diffuse|specular|both`,
`mode=eval|bench`, `w`, `h`, `frames`, `path=orbit|static|pan`, `cut=N`,
`switch=N` (a light turns on), `noise`, `ff`, `noHistory=1`,
`antiLag=off|auto|gradient`, `kernel`, `iters`, `feedback=0|1`, `history`,
`alpha`, `view=out|noisy|ref|err|histlen`, `gain`, `stopAt=N`, `filter=recurrent`,
`r.<option>=…` / `t.<tune>=…` (recurrent options), `skeleton=1`, `specularFilter=svgf|recurrent`,
`still=1` (lights don't move), `hit=0`, `--shot=file.png`,
`--json=file.json`. See the shader headers for sources.
