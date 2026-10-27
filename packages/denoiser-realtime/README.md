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
`filter: 'svgf'` (the default for every signal, with `antiLag: 'auto'`) or `filter: 'recurrent'`
(opt-in, the memory-lean filter; see [Recurrent filter](#recurrent-filter-provisional)). Defaults
as decided by Dennis on 2026-10-25 (SPEC §12); everything stays experimental.

```ts
import { DiffuseSpecularDenoiser } from 'denoiser/realtime';

const gi = new DiffuseSpecularDenoiser(device);   // filter 'svgf', antiLag 'auto' (the defaults)
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
  options go in `{ diffuse: {...}, specular: {...} }`; shared ones (including
  `filter`) at the top level apply to both signals.

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
['sample' | 'mean'], `antiLag` ['auto' | 'off' | 'gradient'], `antiLagVersion` [2 | 1],
`antiLagNoiseFloor` [diffuse 2, specular 1; v1: 2], `antiLagRadius` [1], `gradientIterations` [4; v1: 5],
`youngNormalPower` [16 since 2026-10-26 (Dennis q18 (a); the SH payload since review target 5); 0 for
`OcclusionDenoiser`: the normal edge-stop exponent of a pixel's first frame, ramping to `sigmaNormal` over
`varianceRampFrames`; removes the blotches on curved surfaces in the first frames after a reset, +5 % cost on the RTX
bench; 0 = the previous behaviour; SPEC §4.4; payload 'sh' honours an explicit value since review target 5 (before, it
was ignored there; results/T5-normal-detail.md)], `spatialHistoryWeight` [0; measured null], `youngLuminanceWeight`
[1 = off; measured a loss], `f16Rounding` ['nearest' since 2026-10-27 (Dennis q25 (a)); 'store' for payload 'sh':
`'nearest'` rounds to nearest-even before every rgba16float store; `'store'` leaves it to the platform, and Metal
truncates toward zero, so every history sat 0.2–0.7 % dark. Gains: diffuse +0.07 dB, AO +0.19 (at 4096 spp +0.22 /
+0.42), FLIP −4 / −17 %, no cost; loss: none measured; look: SVGF outputs 0.2–0.5 % brighter on Metal, contacts that
were a little bright get a little brighter. A no-op on GPUs whose f16 stores already round to nearest. Shadows keep
`'store'` (−0.05 dB there); results/DISTANCE-LONG.md §6],
`antiLagChroma` [true with `antiLag: 'auto'` (v2) on payload 'radiance' since 2026-10-27 (Dennis q26 (a)); false
elsewhere (it needs 'auto' v2) and in `OcclusionDenoiser` (grey signal, not measured there): `'auto'` also detects
colour changes (YCoCg chroma gradients through the same reconstruction), so a light that changes colour at constant
luminance no longer leaves its old tint for ~20 frames (diffuse 21 → 8 frames, specular 17 → 4; transition +3.8 / +3.3
dB). Level everywhere else (±0.01 dB). Cost +0.06–0.11 ms per signal at 1080p (+2–4 %), ≈ 1.8 B/px per signal. Known
property, not a regression: during a colour change, constant-light pixels within ~2 px of a changing one boil +44 %, the
same leak A-SVGF's luminance gradient already shows on a brightness change (its 3×3 strata, results/SVGF-FOLLOWUPS.md
§2). false = A-SVGF's luminance-only gradient; results/T3-light-changes.md],
`antiLagGain` [1, per signal; λ = min(1, gain × the A-SVGF ratio): faster reaction, more boil on still views, fails
rule 9 at 2 and 1.5],
`remodulate` [false], `timestamps` [true], `outputAliasing` [true for the radiance payload since 2026-10-27 (false for 'sh' and OcclusionDenoiser); the last à-trous iteration writes into the
ping-pong texture that then serves as the output, −8 B/px per signal (140 → 124 B/px for the joint A-SVGF default),
same values and cost, output valid until the next dispatch as for every output; radiance payload only;
results/SVGF-COST.md]. Specular only:
`specularHistoryScale` [1], `specularHistoryCurve` [0.5], `lobeFraction`
[0.75], `specularNormalWeight` ['lobe' | 'power'], `radiusScale` [1].
History tests (review target 6, results `T6-boundaries.md`): `historyFallback` ['3x3' |
'off' | 'strict'] (the SVGF paper's 3×3 fallback when the 2×2 footprint fails; 'off' wins on the test bed but loses
on Bistro / Sponza AO; measured, not adopted), `normalTest` ['soft' since 2026-10-27 (Dennis q31 (a)) | 'center' |
'relative'; payload 'sh': 'center' only] (see [History normal test](#history-normal-test-soft-default-or-center-hard)
below), `normalSoftThreshold` [0.5], `normalSoftHistory` [per signal; 3 for diffuse / AO, 1 = the hard reset for
specular / SO], `historyNormal` ['normal' | 'geometric'] (the history test on `guides.geometricNormal`, +8 B/px;
loses diffuse / specular on normal-mapped surfaces; measured, not adopted). `antiLagHistoryScale` [false, per signal] (after the anti-lag boost
the history length becomes (1 − λ)·n instead of 1/α: halves the boil next to a light change but slows the reaction by
4–5 frames; measured, not adopted).

### History normal test: `'soft'` (default) or `'center'` (hard)

Every SVGF history tap must pass a plane test and a normal test (cos ≥ `normalThreshold`, 0.95, the SVGF paper's
§4.1). Where no tap of the 2×2 footprint and no texel of the 3×3 fallback passes, the pixel **resets**: it restarts
from this frame's 1-spp sample. On smooth geometry that is rare and right (a real edge). On densely tessellated or
normal-mapped surfaces (Bistro's façades, Sponza's columns) a pixel's own sub-pixel resampling fails the cos 0.95 test
every few frames under camera motion, so those surfaces restart as noise again and again: boil. On Bistro the shipped
hard test left AO boiling at 2.6× the reference's own level and diffuse at 2.1×.

- **`'soft'`** (default since 2026-10-27): the hard test runs first, unchanged. Only where it would reset, the footprint
  is retried at `normalSoftThreshold` (cos 0.5), and the taps that pass give a **short** history, at most
  1 + (`normalSoftHistory` − 1) × their mean normal agreement (0 at cos 0.5, 1 at cos 0.95): a history shaded at a
  nearby normal counts for up to 3 frames, one shaded far away for almost nothing. Specular and SO keep the hard
  reset (`normalSoftHistory` 1): a reflection shaded at another normal is wrong even for 2 frames.
  Measured (11 real captures; results `SVGF-FOLLOWUPS.md` §3.3): diffuse +0.15 dB, AO +0.18, boil −9 % / −11 % and lower
  in every region of every capture (Bistro orbit AO 26.20 → 26.46 dB, boil 2.6× → 2.1× the reference's), specular
  byte-identical; test bed and 4096-spp references level (worst −0.017 dB, SO on `object`); cost ±0 (the retry runs
  only on pixels that would reset, ≈ 1.7 % on Bistro), no memory.
- **`'center'`** (the hard test, the default until 2026-10-27; still available): pros: the SVGF paper's test, the
  strictest guard against history shaded at another normal, slightly cheaper code (no retry branch); cons: restart
  noise (boil) on dense or normal-mapped geometry under camera motion. It may come back if a better reset rule lands:
  the remaining Bistro AO boil (still 2.1× the reference's) is not yet attributed (plane-test resets the soft retry
  can't keep, normals beyond cos 0.5, 3×3-fallback pixels), and a per-cause fix could make `'soft'` unnecessary or
  replace it.
- `'relative'` (option): relaxes the threshold to the pixel's own neighbourhood and keeps a full-length history at
  another normal: fewer resets but it smears (Bistro AO −1.6 dB, specular −1.1); not recommended.

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

Defaults: `antiLag` is **`'auto'`** (v2) since 2026-10-25 (Dennis, SPEC §12 item 2); `antiLag: 'off'` (the
previous default, unchanged when passed explicitly) is the cheaper option. `'auto'` buys (test bed, pooled: +0.24 dB diffuse, +1.58 dB specular over 7 paths,
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
| test bed, 2026-10-27 (median of 13 runs): joint `'auto'` default before the SVGF-cost work (`youngNormalPower: 16`) | 0.15 | 0.60 | 0.48 | 2.58 | 0.28 + 0.15 + 0.07 | **4.31 ms** |
| test bed, 2026-10-27: joint `'auto'` default, workgroup tiles etc. (results/SVGF-COST.md; byte-identical) | 0.15 | 0.60 | 0.45 | 2.11 | 0.28 + 0.15 + 0.07 | **3.81 ms** |
| test bed, 2026-10-27: joint `'off'`, same code | 0.15 | 0.58 | 0.56 | 2.06 | — | **3.37 ms** |

`kernel: '5x5'` costs 0.7–1.0 ms per à-trous iteration (4.7 ms total for
diffuse); `atrousIterations: 4` saves one iteration. `DiffuseSpecularDenoiser`
processes both signals per thread in every pass (SPEC §4.1) unless their
structural options differ.

## Recurrent filter (provisional)

`filter: 'recurrent'`: the recurrent-blur pipeline of SPEC v0 §5 (pre-blur →
temporal accumulation → history fix → blur → post-blur → temporal
stabilization; the post-blur output is next frame's history, the stabilization
history never feeds back). Written from RTG II ch. 49 prose and Zhdan's GTC 2020
talk plus our own designs; every pass cites its sources in
`src/shaders/recurrent.ts` and `docs/research/rt-denoiser/PROVENANCE.md`.

```ts
const gi = new DiffuseDenoiser(device, { filter: 'recurrent' });
gi.dispatch({ radiance: diffuseDemod, hitDistance /* optional, world units, 0 = miss */ }, guides, camera);
// rgb = denoised (demodulated); a = denoised normalized hit distance ĥ = h/(h + 1 + 0.05·depth), an AO estimate
```

- **Diffuse** (M2) and **specular** (M3) are implemented; both are **opt-in** (not the default,
  SPEC §12 item 1, decided 2026-10-25): on the test bed, the real scene and against native NRD
  they score **below the SVGF defaults** (see results), for about a fifth less memory. Specular
  adds virtual (reflected-image) reprojection with a curvature-corrected distance, confidence,
  clamp and an α-space blend with surface motion (SPEC R-9…R-12, D12c).
- `DiffuseSpecularDenoiser({ filter: 'recurrent' })` runs **both signals recurrent** in shared
  dispatches (since 2026-10-25). Until then it meant recurrent diffuse + A-SVGF specular; that
  mix is now explicit: `{ filter: 'recurrent', specular: { filter: 'svgf', antiLag: 'auto' } }`
  (byte-identical to the old default).
- **History fix** (young pixels, A < `historyFixFrames`): `historyFix: 'spatial'` (**default since 2026-10-26**,
  Dennis q19 (a)) rebuilds them from 16 depth / normal-weighted disk taps of this frame's full-resolution accumulated
  signal (radius `historyFixRadius` 8 px at A = 0, halving per frame); `historyFix: 'mips'` (the default until then,
  SPEC D7) uses a 3-level mip pyramid with a depth atlas instead. `'spatial'` is better on every pooled, disoccluded
  and boundary measure (4096-spp references: diffuse +0.34 dB pooled / +0.49 disoccluded, AO +0.39 / +0.82, FLIP
  −0.5 %), one dispatch and 1.5 B/px leaner; `'mips'` is stiller on young pixels (its boil sits further under a clean
  reference's). The plain disk taps lost the single frame right after a camera cut at 1080p (−1.9 dB diffuse);
  the default `historyFixDense: 4` fixes that (cut frame vs `'mips'`: diffuse +0.46 dB, specular +0.16, AO +2.84,
  SO +0.08). Results: `docs/research/rt-denoiser/results/T1-recovery.md`
  §5.2, `E1b-high-reference.md` §3.
  Options of the `'spatial'` fix (results `T1b-spatial-repair.md`): `historyFixDense` [4; 0 = the 16 disk taps only]
  rebuilds A = 0 pixels (resets, reveals) from every pixel within that many px (a shared-memory tile; the 1080p cut frame
  then beats the mips on every signal, and pooled +0.12 dB diffuse / +0.29 AO over the disk taps alone; +0.11-0.13 ms),
  `historyFixDenseCap` ['mip': specular / SO get the mips' footprint; 'disk'], and diagnostic ones (off by default): `historyFixWideRing` / `historyFixWideRings` /
  `historyFixWideUse`, `historyFixAgeWeight`, `historyFixMips` ('young' / 'reset' / 'hit' / 'clamp',
  `historyFixMipsClamp`), `historyFixYoungThreshold`, `youngBlurTaps`.
- The output texture rotates between internal buffers (valid until the next dispatch,
  per the TemporalDenoiser contract).
- Options (defaults): `hitDistanceScale` [1], `hitDistanceViewScale` [0.05],
  `maxRadiance` [1e4], `preBlurRadius` [25 diffuse / 10 specular px @1080p],
  `blurRadius` [45 diffuse / 30 specular px @1080p], `minBlurRadius` [1],
  `specularMinRadiusScale` [1: the floor scales with f_r, none on mirrors], `preBlurTaps`
  [8 diffuse / 4 specular], `blurTaps` [8], `postBlurTaps` [4] (4 or 8, compiled in),
  `maxAccumulatedFrames` [31], `fastFrames` [3], `historyFix` ['spatial'; or 'mips'], `historyFixFrames` [3],
  `historyFixRadius` [8 px, 'spatial'], `historyFixDepthTolerance` [0.02, 'mips'], `historyFixMinWeight` [0.25,
  'mips'], `fireflyThreshold` [1.5],
  `historyAntiLag` [true] (renamed from `antiLag`, SPEC §12 item 8; the old name still works and
  warns once per instance), `antiLagSigma` [1], `antiLagStandardError` [true], `antiLagExcess` [0.5],
  `antiLagHitTolerance` [0.2], `antiLagCurrentSigma` [3], `antiLagCurrentHitTolerance`
  [0.05], `stabilizationFrames` [7], `planeDistance` [0.01], `lobeFraction` [0.75],
  `specularHistoryScale` [1], `virtualMotion` [true], `virtualClampSigma` [1],
  `virtualAngleScale` [0.5], `virtualHitTolerance` [0.05], `virtualHitToleranceRoughness`
  [0.25], `remodulate` [false], `timestamps` [true].
  Review target 6 (results `T6-boundaries.md`, defaults since 2026-10-26, rule 9 passed): `normalThreshold` [0.95]
  with `normalTest` ['relative'] (a history normal test relaxed to the pixel's own neighbourhood: removes the ghost at
  a moving object's floor contact; 0 / 'center' = the previous plane test only) and `virtualHitTest` [true] (drops
  virtual-motion history whose hit distance disagrees: removes the duplicate images on clean mirrors). The occlusion
  pipeline keeps 0 / 'center' / false (not measured there).
  **Opt-in: a plain per-tap normal test** (`normalThreshold: 0.8, normalTest: 'center'`; Dennis q28 (b), 2026-10-27:
  stays an option). What it does: every history tap whose normal is more than ~37° from the pixel's is dropped, with no
  relaxation to the neighbourhood, so dense or normal-mapped geometry resets more often and the `'spatial'` history fix
  rebuilds those pixels from this frame's same-normal neighbours instead of keeping history shaded at another normal.
  Gains (9 real captures, results `T6-boundaries.md` §6.3): diffuse +0.39 dB, specular +0.29 (Bistro up to +0.8, bistro-orbit
  specular +1.2 with cos 0.95), FLIP −1.6…−2.4 %; test bed level. Losses: the extra resets boil like young pixels
  (real boil diffuse +27 %, specular +9 %), above the reference's own level on `bistro-pan` diffuse and `sponza-orbit`
  specular (fails rule 9's boil clause). Use it when the scene is dominated by dense or normal-mapped geometry and
  sharpness matters more than a calm image under camera motion; keep the default otherwise.
  `f16Rounding` ['nearest' since 2026-10-27 (Dennis q25 (a)): round to nearest before every rgba16float store (Metal
  truncates); diffuse +0.13 dB, specular +0.03, FLIP −10 / −3 %, no cost, results `DISTANCE-LONG.md` §6;
  `OcclusionDenoiser`'s recurrent mode keeps 'store' (not in that A/B)].

| pass | reads → writes | formats |
|---|---|---|
| `prepass` (shared) | guides → packed geometry (no depth slope for recurrent-only denoisers) | rg32uint ×2 |
| `pre_blur` | radiance (sanitized), hit distance → static disk on the tangent / lobe plane, radius clamped by last frame's denoised hit distance; ĥ unfiltered | rgba16float |
| `temporal` | + reprojected history (Catmull-Rom / custom bilinear) → acc = lerp(H, pre, 1/(1+A)); specular: surface + virtual candidates blended in α by F_dom·[valid]; fast history (A ≤ 3); A + 2×2 validity + m packed in `data`; current-frame anti-lag detector (10×10 shared tile) | rgba16float ×2, rgba16float (fast), r32uint |
| `mips` (`historyFix: 'mips'` only) | acc → 3-level atlas (non-sky averages), depth atlas, one 16×16 shared-memory dispatch | rgba16float (rotation buffer), r32float |
| `history_fix` | spatial repair where A < 3 (16 disk taps; or the mip repair), rank anti-firefly, fast-history clamp + A reduction (`data` read-write; shared tile) | rgba16float, r32uint rw |
| `blur` | rotated 8-tap disk, radius R_max/(1+A), clamped by hit distance; geometry · normal · ĥ (· roughness) weights | rgba16float |
| `post_blur` | unrotated 4-tap disk, radius × lerp(0.5, 2, δ/0.3) → next frame's history | rgba16float |
| `stabilize` | own history (bilinear diffuse / Catmull-Rom specular), 3×3 clamp widening with A → output | rgba16float (+ remodulated outputs) |

Memory (diffuse + specular): 4 rgba16float rotation buffers per signal, fast history ×2,
`data` ×2, geometry ×2: **104 B/px** with the default `historyFix: 'spatial'` (target ≤ 100; half-res fast history
would give 92, not implemented); diffuse only 72 B/px. `historyFix: 'mips'` adds the depth atlas (+1.5 B/px: 105.5 /
73.5).

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

`blurTaps: 4` gives 4.05 ms (−0.07 dB diffuse, +5 % flicker). For comparison on this page (anti-lag
v1 at the time), joint SVGF `'off'` is 4.02 ms, joint A-SVGF `auto` 5.55 ms, and the recurrent
diffuse + A-SVGF specular mix 5.98 ms. On the test-bed bench with anti-lag v2 (SPEC §0.2): SVGF
`'off'` 4.00, `'auto'` 4.23, recurrent 3.99, the mix 4.79 ms.

## Occlusion (provisional)

`OcclusionDenoiser` denoises ambient occlusion (AO, from the diffuse ray) and specular
occlusion (SO, from the specular ray) as the **normalized hit distance** of the renderer's
1-spp rays, ĥ = h / (h + a + b·depth) (SPEC F-3 / §8; a = `hitDistanceScale` = 1 world unit,
b = `hitDistanceViewScale` = 0.05; miss → 1). Output: ĥ in `.r` (1 = open, → 0 at contact).
**Default filter `'svgf'`** (since 2026-10-25, SPEC §12 item 1; it was `'recurrent'`), with SVGF's
default `antiLag: 'auto'`. Provisional: defaults were tuned on the test bed it is scored on.

```ts
import { OcclusionDenoiser } from 'denoiser/realtime';

const ao = new OcclusionDenoiser(device);                                // filter 'svgf'; or { filter: 'recurrent' }
ao.configure({ width, height });
const aoTex = ao.dispatch({ hitDistance: diffuseHitT }, guides, camera); // ĥ in .r

const both = new OcclusionDenoiser(device, { signal: 'both' });         // SO needs guides.roughness
const { diffuse, specular } = both.dispatchBoth(
  { diffuse: { hitDistance: diffuseHitT }, specular: { hitDistance: specularHitT } }, guides, camera);
```

- `filter: 'recurrent'` (opt-in, memory-lean): the recurrent pipeline's occlusion-only mode (signal kinds `ao` / `so`
  in `src/shaders/recurrent.ts`): the same passes with the radiance channels dropped, one
  r32float per signal, no pre-blur (the temporal pass normalizes the raw hit distance), anti-lag
  on ĥ only, the slow ĥ clamped into the fast-history window, and for SO the fast ĥ follows the
  virtual (reflection) reprojection. Every `RecurrentOptions` key applies; occlusion defaults:
  AO blur radius 20 px, minimum radius 2 px.
- `filter: 'svgf'` (default): SVGF (unchanged `SvgfPipeline`) on ĥ written as a gray image by a
  normalization pass. Occlusion defaults: `sigmaLuminance` 1.5, `atrousIterations` 3, SO
  `temporalAlpha` 0.3 (the radiance defaults 4 / 5 / 0.2 over-blur ĥ: −0.5 dB AO, −1.8 dB SO at
  1080p). `antiLag` as for radiance (`'auto'` by default). SVGF's 2026-10-27 defaults `f16Rounding: 'nearest'` and
  `normalTest: 'soft'` apply here too (both were A/B'd on AO / SO: AO +0.19 dB / +0.18 dB on the real captures);
  `antiLagChroma` is pinned false (ĥ is grey; not measured). `'off'` is the cheaper option (AO + SO −0.2 ms on the
  M5 Pro, −0.8 ms on the RTX bench, 4 B/px less per signal) at AO contact −0.6 dB, AO flicker +15 % and SO −0.9 dB
  on the test bed; it was briefly the default and was reverted (`docs/research/rt-denoiser/results/OCCLUSION-ANTILAG.md`).
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
| `svgf`, `antiLag: 'off'` | 38.93 | 33.53 | 38.76 | 35.66 | 1.37 / 1.92 / 2.99 | 84 / 148 |
| `svgf`, `antiLag: 'auto'` (anti-lag v1; **the default**, re-measured with v2: 39.03 / 39.68 dB, 1.67 / 1.61 / 3.10 ms median joint, 88 / 156 B/px, REMEASURE §3) | **39.05** | **34.14** | **39.52** | **36.37** | 2.16 / 2.53 / 5.27 | 92 / 163 |
| recurrent radiance alpha ("free") | 35.15 | 27.64 | 35.47 | 32.10 | 0 extra | 0 extra |

(Medians run 15–60 % above the fastest-clock numbers; `results/M5.md` §5.)
`recurrent` rows were measured with `historyFix: 'mips'`; the default since 2026-10-26, `'spatial'`, needs no depth
atlas (56 / 72 B/px) and scores AO +0.39 dB pooled, +0.82 dB disoccluded, SO +0.16 dB against 4096-spp references
(`results/E1b-high-reference.md` §3).

SVGF beats the recurrent occlusion mode on every path for both signals (+0.9 dB AO,
+1.4 dB SO), A-SVGF `auto` is best overall; recurrent is the memory-lean option and flickers
least on the static-light path. The radiance alpha is 2.9 dB (AO) / 1.9 dB (SO) below the
dedicated recurrent mode and doubles FLIP: "nearly free" holds for cost, not for quality. On the
three.js scene with a moving camera (AO only, `docs/research/rt-denoiser/native/results/PHASE4-5.md`)
plain SVGF leads (33.42 / 33.55 dB orbit / pan), `'auto'` 33.10 / 33.47, recurrent 32.53 / 32.59.

## Shadows (provisional)

`ShadowDenoiser` (`TemporalDenoiser<ShadowInputs>`, registry id `shadows`): a penumbra-aware
denoiser for 1-ray (or few-ray) shadow visibility, described as built in SPEC v0.5 §7
(**provisional**: tuned and scored on the test bed and the three.js scene). Fractional visibility is kept end to end (never thresholded), the
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
  [1], `clampSigma` [0.4], `clampFloor` [0.05], `clampGeometry` [true] (normal-tested 5×5 window), `clampMinTaps` [3], `clampEdgePx` [2], `antiLagGain` [64] (old name `antiLag` still accepted, deprecated), `antiLagHistory` [0],
  `stabilize` [0.25] (0 = off: no pass, 40 B/px), `stabilizeBox` [0.05 @1080p], `stabilizeAntiLag` [64], `stabilizeYoung` [0], `rotationStep` [0 since 2026-10-27, q23; was 0.618: the kernel's rotation then changes every frame],
  `uniformSnap` ['change'], `snapHardPx` [2] ('change' also snaps uniform windows where the own penumbra is under 2 px:
  crisp hard edges on a moving camera), `backfacePass` [true] (surfaces with the whole light below their horizon keep
  their input: stay black), `noiseCap` [0] / `noiseCapSettled` [false] (cap the H18 noise radius at k × the
  occluder-sized radius: sharper near-hard shadows, but more boil in wide penumbrae), `stepTest` [true since 2026-10-27,
  q23] (no noise-sized kernel where the raw 5×5 is a clean step: crisper hard edges and contacts, wide penumbrae
  unchanged), `edgeBox` [true since 2026-10-27, q23] (hard edges: history clamped to the 3×3 raw min / max, no trailing
  behind moving hard shadows), `terminatorAnalytic` [true since 2026-10-27, q24] (occluder-free terminators get the
  analytic above-horizon fraction of the light instead of a 16 px kernel) — results/SHADOWS-MOTION.md, `horizonSnap`
  [true since 2026-10-27, q24] (whole light below the horizon and a 0 sample: the history is 0, so a surface turning
  away from a moving light doesn't keep its lit history; pairs with `terminatorAnalytic`; both **need the exact light**,
  see below), `floorE` [0.05 since 2026-10-27, q29] (the 1-px `minRadius` floor scaled by the noise estimate E, down to
  half where E is 0: with `stepTest`, contacts and sub-pixel penumbrae are no longer blurred; 0 = the fixed 1-px floor),
  `lightMotion` [0; opt-in, see below] — results/SHADOWS-FOLLOWUPS.md, `normalThreshold` [0] / `normalTest`
  ['center'] (a history normal test as on the recurrent filter: passes rule 9 but gains only +0.004…+0.010 dB for
  +5.8 % cost, results/T6-boundaries.md), `catmullRom` [true], `planeDistance` [0.01], `radiusScale` [0.75],
  `historyShrink` [0.5], `minRadius` [1 px], `maxRadius` [48 px @1080p], `maxScaleHistory` [7],
  `noiseRadius` [32 px @1080p], `noiseBlend` [0.5], `noiseYoung` [0], `youngMean` [0.75],
  `youngFrames` [8], `youngTaper` [0.25], `youngRadius` [2], `youngMinPx` [1], `mergeMin` [true], `terminatorRadius`
  [16 px @1080p], `geometryTolerance` [0.02], `normalAngle` [30°], `normalWeight` [true],
  `pass1Phase` [0.382], `spatialPasses` [2], `tileSkip` [true], `anisotropy` [false],
  `anisotropyMax` [4], `freshBoost` [0], `timestamps` [true]; `uniformSnap` takes `true` (snap
  wherever the 5×5 samples agree: best FLIP), `'change'` (default: only after a change) or `false` (+0.18 dB pooled on v2). Every one is documented in `src/shadow.ts`; M4.md has
  the measurements behind them.

### Shadow defaults since 2026-10-27, and the exact-light requirement

Dennis approved three measured changes together (q23, q24, q29; results `SHADOWS-MOTION.md`, `SHADOWS-FOLLOWUPS.md`):

| change | what it does | gains | losses |
|---|---|---|---|
| `stepTest` + `edgeBox` + `rotationStep: 0` (q23) | no noise-sized kernel at clean hard steps; hard edges clamp their history to the 3×3 raw range; the spatial kernel's rotation no longer changes per frame | real captures +0.43 dB, motion-compensated boil −15 % (edges −16 %, contacts −19 %); moving hard occluder: changing region 10.0 → 12.0 dB, lag 0.6 → 0 frames; 1080p +0.07 | +0.01 / +0.03 ms (+2 / +5 %); contact boil +7 % on one test-bed capture (not a rule-9 region) |
| `terminatorAnalytic` + `horizonSnap` (q24) | on terminators without an occluder, the analytic fraction of the light above the tangent plane replaces the 16 px kernel; where the whole light is below the horizon and the sample is 0, the history is set to 0 | the largest gain measured on shadows: 1080p +1.51 dB (worst path +0.95), FLIP −27 %, flicker −25 %; real +0.90 dB, FLIP −11 %; no cost (−0.01 ms) | trusts the light and the renderer's horizon rule exactly (below); static-penumbra boil rises on moving-camera Bistro / Sponza captures but stays below the references' own |
| `floorE: 0.05` (q29) | the 1-px radius floor shrinks to half (no filtering) where the accumulated noise estimate is 0: contacts and sub-pixel penumbrae stay sharp | hard-light contacts 17.9 → 22.6 dB (above the raw input's 21.9), real +0.40 dB, FLIP −5 %; no cost | crisper edges resampled on a moving camera boil a little more (`bistro-move` dynamic +5.6 %, `sponza-orbit` changing +7 %); 540p frame 0 −0.15…−0.8 dB |

All three together: 1080p 40.10 dB vs 38.49, real captures 30.88 vs 28.86 (+2.0 dB), FLIP −18…−24 %, `bistro-move`
24.38 dB (the raw 1-ray input: 24.42). The previous look is one option object away:
`{ stepTest: false, edgeBox: false, rotationStep: 0.618, terminatorAnalytic: false, horizonSnap: false, floorE: 0 }`.
With `translucency: true` only q23 applies (`terminatorAnalytic`, `horizonSnap` and `floorE` are opaque-path only), so
its visibility output is no longer exactly the opaque denoiser's.

**`terminatorAnalytic` and `horizonSnap` need the exact light.** Both compute the visible fraction of the light from
`light` and `guides.normal` instead of from the samples, so they are only right when (1) `light` is the light the
renderer sampled (same position or direction and the same radius / angular radius), and (2) the renderer clips shadow
rays at the horizon of the same normal as `guides.normal`. Turn both off (`{ terminatorAnalytic: false, horizonSnap:
false }`) when:

- the light is an approximation: e.g. a directional stand-in for a nearby sphere light (on the test bed's sun captures,
  whose stand-in direction is off by up to 0.4 θ, the analytic terminator loses 0.6–0.8 dB instead of gaining 0.9–1.1);
- the renderer's horizon rule uses another normal (shadow rays cast from the bump-mapped shading normal while
  `guides.normal` is the geometric one, or the reverse): the analytic band and the snapped back faces then sit where
  the renderer's own terminator is not;
- the visibility is not a single light's (a baked or screen-space mask, an area light given to the denoiser as a point).

Real directional lights (Sponza, Bistro sun) are exact: +0.02…+0.39 dB there. Without `light` (noise-driven fallback)
both do nothing.

**Opt-in: `lightMotion`** (Dennis q30 (b), 2026-10-27: stays an option). A moving light moves every penumbra by
(light displacement / light size) penumbra widths per frame, whatever its size; the history (≈ W_px² frames) assumes a
still shadow, so it drags. `lightMotion: k` caps the history at k such widths and drops it at edges where that is under
one frame. Gains (results `SHADOWS-FOLLOWUPS.md` §3): a fast-moving hard light 27.7 → 30.4 dB (trail 0.142 → 0.040),
std540-light +1.97 dB, 1080p `light` +0.44; still lights byte-for-byte unaffected in practice (≤ 2·10⁻⁶), cost +0.002…0.004
ms. Losses: noisier while the light moves (edge boil +47 % on that capture, static-penumbra boil +6.5 % on
std540-light: fails rule 9's boil clause). Use `1` (or `0.5`, sharper and noisier) for scenes where a hard-shadowing light
moves a large fraction of its size per frame (a swinging lantern, a flashlight) and trailing shadows are the bigger
problem; keep 0 for still or slow lights.

| pass | threads | reads → writes |
|---|---|---|
| `temporal` | 8×8 per tile, shared raw visibility (+ depth for the young-history mean) | guides, visibility, hit distance, previous geometry/history → geometry (rg32uint; its spare byte carries the noise estimate E), history (rgba16float: v, penumbra scale g, A, n_g), unfiltered copies T and out (r32float), tile stats |
| `tiles` | 1 per 8×8 tile | 3×3-tile nearest-occluder scale; indirect list of penumbra tiles |
| `spatial0` | indirect, penumbra tiles | out copy → T: 8-tap rotated disk on the receiver's tangent plane |
| `spatial1` | indirect, penumbra tiles | T → out: same, half radius, another rotation |
| `stabilize` | indirect, penumbra tiles | out + last frame's final output → final output: reprojected, clamped to the 3×3 range of this frame's output, blended 0.25; only where that range is narrow (wide penumbrae); anti-lag on the clamp distance (v2.2) |

With `stabilize` on (default) the temporal pass writes its unfiltered copy into the final output pair
and the spatial passes run final → T → out. Memory: **48 B/px** (40 without `stabilize`) + 20 B per 8×8
tile (99.5 MB at 1080p). Core WebGPU only (≤ 4 storage textures per pass).

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
| `ShadowDenoiser` v2.2 (`uniformSnap: true`, as measured in M4) | 38.22 | 29.16 | 35.51 | 0.0131 | 0.0024 | 0.55–0.72 |
| **`ShadowDenoiser` (defaults since 2026-10-26: v2.2 + `snapHardPx: 2` + `backfacePass`)** | **38.49** | **29.39** | – | **0.0124** | **0.0024** | 0.55–0.72 |

Ahead of FFX on every path. **v2.2** (M4.md §12, "Moving shadows") fixes visible boiling in wide,
soft penumbrae (the rotating torus knot's shadow on the three.js page): in that shadow the output's
frame-to-frame noise drops from 4.9× FFX's to FFX's level (0.0013 vs 0.0062 per frame, FFX 0.0011) while
staying 8 dB more accurate; on the test bed flicker −11 % and temporal PSNR +0.5 dB at 1080p, worst path
`light` −0.19 dB (a little lag after light changes). The stabilization pass costs 0.03–0.05 ms (`stabilize: 0`
turns it off: v2.1's cost, 40 B/px; v2.1 read 0.52–0.66 ms on the same bench). v2.1 (M4.md §11) fixes the frame-2 dip after a reset and leads FFX
from frame 0 on the reset-window replays, including `std1080-orbit`; it costs ~+0.1 ms (the
normal-tested clamp; `clampGeometry: false` returns to v2's cost and gives up ~1 dB pooled). v2.2's
0.55–0.72 ms are within the ~0.75 ms target (SPEC §12, decided 2026-10-25). The v2.2 row ran
`uniformSnap: true`; the default is `'change'` since then, and since 2026-10-26 (Dennis, q21 (a)) `snapHardPx: 2`
and `backfacePass: true` (last row, results/SHADOWS-LOOK.md "Rule-9 A/B": the grey veil `'change'` left next to
hard edges on moving cameras goes, back faces stay black; real-scene captures +0.53 dB, FLIP −14 %; same cost). GPU
ms are the fastest of 4 solo runs (Apple M5 Pro, Chrome; the GPU has two clock states, ×1.3–1.8).
Per pass on `thin`, the penumbra-heaviest view: temporal 0.42, tiles 0.005, spatial 0.12 + 0.11,
stabilize 0.05 ms. `youngMean: 0` saves ~0.025 ms (−0.07 dB, measured on v2). Directional lights: the code path is exercised on
images only through a stand-in (the test bed's sphere light handed over as a directional light,
M4.md §10.7). Provisional: tuned and scored on the same scene.

### Coloured shadows: `translucency: true` (provisional, SPEC v0.3 §7.10 / M8)

Shadows through glass, stained glass or tinted plastic. The renderer keeps tracing the shadow ray through
translucent layers, multiplies their transmittances (order doesn't matter) and reports the nearest layer's
distance; a ray stopped by something opaque keeps visibility 0. The denoiser filters the **opaque** visibility v
exactly as above and, separately, a conditional transmittance τ = E[T | v = 1] accumulated only over samples
that reached the light; the output is their product, so overlapping opaque and coloured penumbrae stay right.

```ts
const shadows = new ShadowDenoiser(device, { translucency: true });   // structural
const out = shadows.dispatch(
  {
    visibility, hitDistance, light,
    translucency,             // rgb transmittance T of the ray (1 where it crossed no layer; ignored where visibility = 0)
    translucencyHitDistance,  // optional: distance to the nearest translucent layer, 0 = none (sizes coloured penumbrae)
  },
  guides, camera,
);
// out: rgba16float (coloured shadow rgb = what multiplies the light, opaque visibility in alpha)
```

- With T ≡ 1 (or no `translucency` texture) the opaque part is the opaque denoiser's output bit for bit (r32float
  internally; the f16 output rounds it).
- Options: `translucencyEpsilon` [0.01], `translucencyHistory` [7], `translucencyClampSigma` / `translucencyClampFloor`
  [= clampSigma / clampFloor], `translucencyOwnGate` ['antiLag'], `translucencyPath` ['auto': 'wide' with ≥ 6 storage
  textures per stage, else 'packed' (4)].
- Memory 80 B/px (wide) / 88 (packed), 166 / 182 MB at 1080p. `realtimeShadows(v, { translucency: T, translucencyHitDistance })`
  in `denoiser/three` returns the coloured shadow in `.rgb`, `.visibility` = alpha (`examples/three-temporal/realtime-glass.html`).

Test bed (1080p, 96 frames, rgb vs a 256-spp reference of v·T, pooled PSNR / chroma error in tinted pixels / FLIP;
`docs/research/rt-denoiser/results/M8.md`):

| | glass (orbit) | glass-moving (panel slides) | glass-still |
|---|---|---|---|
| **`translucency: true`** | **38.83** / **0.0017** / **0.0078** | **34.21** / **0.0061** / **0.0185** | **40.61** / **0.0018** / 0.0068 |
| `ShadowDenoiser` on v·lum(T) (grey) | 28.42 / 0.065 / 0.028 | 26.25 / 0.067 / 0.044 | 26.51 / 0.068 / 0.037 |
| accumulate-32 | 31.10 / 0.003 / 0.018 | 20.04 / 0.036 / 0.079 | 36.42 / 0.004 / **0.0057** |

GPU 0.97–0.99 ms on the glass paths and +0.12 … 0.17 ms over the opaque denoiser elsewhere (1080p, M5 Pro, solo
bench; the temporal pass is most of it). Known: static coloured penumbrae boil a little more than the grey scalar
(τ's own noise at the colour edges); native NRD's translucency mode not compared yet.

## Directional payload: `payload: 'sh'` (provisional, SPEC v0.3 §8.5 / M7)

A plain denoised value is right for the normal the filter used and nothing else. With
**normal-mapped** surfaces that's a bad trade: filter with the detail normal and the
weights reject neighbours across every bump (noise stays); filter with the smooth normal
and the bump shading is averaged away. `payload: 'sh'` filters a small function of
direction per pixel instead (L1 spherical harmonics of the luma, chroma without direction,
YCoCg: six channels in one `rgba32uint` per buffer) with the **smooth** normal, and
evaluates it afterwards at the **detail** normal.

```ts
import { DiffuseDenoiser, ShResolver } from 'denoiser/realtime';

const gi = new DiffuseDenoiser(device, { payload: 'sh', resolve: 'fused' });  // SVGF only
gi.configure({ width, height });
const rgb = gi.dispatch(
  { radiance: diffuseDemod, direction: rayDirection },      // world direction of each 1-spp ray
  { depth, normal: smoothNormal, detailNormal: shadingNormal, motion },
  camera,
); // rgba16float, demodulated, resolved at detailNormal
```

- **Inputs.** Per frame either `direction` (rgb, world-space direction of the sampled ray; the
  denoiser encodes on load around `guides.detailNormal`) with `radiance`, or an encoded `sh`
  texture (rgba32uint, 8 × f16 `a, b.xyz, Co, Cg, –, –`, SPEC M7-2). `guides.normal` is the
  filter's (smooth) normal, `guides.detailNormal` the normal the rays were sampled around and
  the payload is resolved at (falls back to `guides.normal`). Without either input it throws.
- **Output.** `resolve: 'fused'` (the specular default): rgb resolved in the last à-trous pass
  (remodulated with `remodulate: true`). `resolve: 'none'` (the diffuse default): the
  resolve-ready payload (rgba32uint: `a', b'.xyz, ρCo, ρCg, Y_g`); resolve it with
  `ShResolver` (compute pass, diffuse), or in your own shader with `SH_RESOLVE_WGSL`
  (`shUnpack`, `shResolveDiffuse(p, nDetail, sharpen, nGuide)`,
  `shResolveSpecular(p, nDetail, nGuide, view, roughness, lightSharp, rhoMax, fadeR)`), e.g.
  to light any BSDF with the payload.
- **Options.** `shSharpen` (1 since review target 5, was 0.75; diffuse resolve: blend toward ambient + one extracted light; SPEC said 0),
  `shGuard` (1, ringing guard on |b|), `shEncoding` ('normal-exact' | 'textbook'); specular:
  `shSpecularRatio` ('sg' | 'l1'), `shLightSharpness` (2), `shMaxRatio` (4), `shFadeRoughness` (0.2);
  `shPingPacking` ('f16' | 'u8'); `shDetailNormalPower` (0 = off; opt-in, Dennis q27 (b), 2026-10-27; below) and
  `shDetailNormalStride` (1: apply it only in à-trous iterations with at least this stride; measured worse).
- **Opt-in: `shDetailNormalPower`** (review target 5, results `T5-normal-detail.md` §3, §5). What it does: an extra spatial
  weight max(0, n_d·n_d')^p on the **detail** normals in the variance and à-trous passes, so a pixel's payload is
  averaged mostly with payloads sampled around similar hemispheres (extrapolating an L1 payload to a far-off normal is
  what flattens the bumps). Gains at p 16 on normal-mapped diffuse: bump contrast 0.62–0.73 → 0.68–0.80 of the
  reference's, +0.8…+2.9 dB, FLIP −8…−19 % on all six normal-mapped captures; under camera motion it then beats the
  plain filter on every pattern (+1.0…+4.6 dB, bump boil −46…−76 %). Losses: shimmer comes back with the contrast on
  still views (bump flicker +15…+45 %, boil +24…+75 % against a still reference that has none: fails rule 9), smooth
  surfaces −0.02…−0.07 dB, +0.3 ms per signal at 1080p (+9 %; one more guide read per tap). p 8 gives half the gain
  with still-view boil +13…+25 %. Use it when normal-mapped surfaces are mostly seen in motion (games, walkthroughs) and
  crisp bumps matter; keep 0 for still or slowly orbiting views (product shots), where the calmer flat look wins.
  `payload` is structural; `filter: 'recurrent'` with `payload: 'sh'` throws (not built);
  `historyFilter: 'catmull-rom'` is ignored in SH mode (the history is unfilterable; bilinear).
- **three.js:** `realtimeDiffuse(radiance, { direction, detailNormal, denoiser: { payload: 'sh' } })`
  returns the resolved rgb (fused by default; with `resolve: 'none'` the node resolves with
  `ShResolver` at `shResolve.normal`).
- **Equal to the plain filter where the normals agree:** resolved at the guide normal the SH
  filter scores like plain SVGF (test bed, 7 paths: within 0.04 dB at equal f16 rounding; results/M7.md). SH packs f16
  by rounding to nearest; the plain filter does too since `f16Rounding: 'nearest'` became its default (2026-10-27;
  before, its `rgba16float` stores truncated on Metal and SH read ~0.1 dB better).
- **The 2026-10-27 SVGF default flips don't apply to `'sh'`**: `antiLagChroma` and `normalTest` other than 'center' need
  the radiance payload, and `f16Rounding` stays 'store' (SH's own packing already rounds to nearest; the fused output's
  store was not measured).

### Results (provisional; full tables in `docs/research/rt-denoiser/results/M7.md`)

| test bed, 1080p, `sh-diffuse` (pooled dB) | `bumpy` | `bumpy` bump region | `bounce` |
|---|---|---|---|
| plain SVGF, filter normal = shading normal (`'auto'`) | 37.40 | 34.23 | **39.21** |
| plain SVGF, filter normal = smooth (`'auto'`) | 36.19 | 32.27 | – |
| **SH** (`'auto'`, `shSharpen` 0.75, the M7 default) | **38.26** | **36.32** | 39.09 |

- **Regression:** on the 7 standard paths SH at the guide normal matches plain SVGF within 0.013–0.038 dB
  at equal f16 rounding (as shipped +0.03…+0.10 dB, see the f16 note above).
- SH keeps only 25–50 % of the bump contrast (detail-band energy) and FLIP prefers plain with the shading
  normal on `bumpy` (0.0405 vs 0.0439): use SH where noise across bumps is the problem, plain with the
  shading normal where crisp bumps matter.
- **Specular SH does not pay** (≥ 2 dB below plain with the shading normal on the glossy bumpy floor);
  experimental.
- Cost (1080p, quiet dev-page bench): diffuse 2.20 → 2.92 ms (1.33×), diffuse + specular 3.97 → 5.42 ms
  (1.37×); `antiLag: 'auto'` 2.56 → 3.41 / 4.41 → 6.13. Memory: diffuse 116 B/px (108 fused; plain 76),
  diffuse + specular 204 with the default resolves (plain 132), +8 with `'auto'`; `shPingPacking: 'u8'`
  −16 per signal (faster for diffuse alone, slower joint).

## Dev page

`yarn workspace @pmndrs/denoiser-realtime dev` (port 5240), then
`node packages/denoiser-realtime/dev/run-headless.mjs "signal=diffuse&mode=eval"
"signal=both&mode=bench"`. Query switches: `signal=diffuse|specular|both`,
`mode=eval|bench`, `w`, `h`, `frames`, `path=orbit|static|pan`, `cut=N`,
`switch=N` (a light turns on), `noise`, `ff`, `noHistory=1`,
`antiLag=off|auto|gradient`, `kernel`, `iters`, `feedback=0|1`, `history`,
`alpha`, `view=out|noisy|ref|err|histlen`, `gain`, `stopAt=N`, `filter=recurrent`,
`r.<option>=…` / `t.<tune>=…` (recurrent options), `skeleton=1`, `specularFilter=svgf|recurrent`,
`still=1` (lights don't move), `hit=0`, SH (M7): `payload=sh`, `resolve=none|fused`, `sharpen`, `guard`,
`enc`, `specRatio=sg|l1`, `lightSharp`, `maxRatio`, `fadeR`, `bumps=deg` (detail-normal bumps; reference =
irradiance at the detail normal), `dirs=1` (directional samples), `guideNormal=detail`, `--shot=file.png`,
`--json=file.json`. See the shader headers for sources.
