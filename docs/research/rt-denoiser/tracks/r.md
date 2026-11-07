# Track R (reflections), phase 1: diagnosis

_Agent R, branch `track/r-reflections` (worktree `../Denoiser-track-r`), 2026-11-07. Role: implementer (RULES.md §8).
No NRD material read. Our FFX port (`packages/denoiser-ffx`, MIT) read side by side with ours. No package default
changed; every experiment below is an option or a WGSL text patch applied by the bench at pipeline build (nothing in
`packages/` was edited)._

**Summary.** On the reflection bench (G1), against a converged traced reference:
1. **Ours has no +3 luma bias; FFX is dark** (−4.5 levels overall, −17.7 on the camera body, ours −0.4 / −1.4). The
   2026-10-28 "+3" was measured against FFX and raw-through-FSR3, both of which lose energy.
2. **SVGF's gap is history length** (cause #1, its 'auto' anti-lag keeps α ≈ 0.1 on still 1-spp GGX) **plus a
   1-frame cap at roughness 0** (cause #2: three's sampler clamps α ≥ 0.001, the guide says 0). Fixing both as
   options puts SVGF below FFX on traced input with and without FSR3, unbiased (0.445 vs 0.473; 0.538 vs 0.582), at
   the cost of FFX-like lag under motion; SSR mirrors stay ~6 % behind.
3. **Recurrent's gap is its C-10 anti-lag window, its 0 detector floor at r 0, and a vanishing glossy blur radius.**
   Fixed, it beats FFX on every mirror case (SSR included) but not on the rough body.
4. Jitter and normal-mapped gloss are not causes. FSR3 hides most of the difference (no resolver: FFX 0.58, SVGF
   1.48, recurrent 1.08). The ripple is low-frequency (σ over consecutive frames ranks the filters backwards).
5. Four measurement bugs were found and fixed before any of this was trustworthy (§1).


## 1. The instrument (G1)

| commit | what |
|---|---|
| `8c1ef6b` | **reflect-bench moved** from `feat/interior-lab` (fc10b39): `reflect-bench.html`, `src/reflect-bench/main.ts` (+ its notes as `README.md`), the vite input, `three-examples-plugin.ts` (Ben's model from `../three.js`, else GitHub r186). Uses this worktree's `packages/denoiser-realtime` and the installed `@pmndrs/upscaler` 0.5.0 (it has `path: 'temporal'`), so no `upscaler-src` alias. |
| `6198cf9` | scripted API (`window.__rb.configure / step / grab / timingsOf`), presets (`ben`, `defaults`), table roughness, normal maps, per-denoiser options, a `regions` view (runner masks: table / model / model roughness), orbit pose hold. Runner `results/data/r/rb-run.mjs` + scorer `rb-metrics.py`. |
| `a756db5` | diagnosis hook: WGSL text patches per shader-module label (`configure({ patches })`), so an FFX constant or one of our passes can be changed for one run without editing the packages. `rb-plans.py`, `rb-lock.sh`. |
| `8165323` | **measurement fixes** (below). |

Serve: `cd examples/three-temporal && yarn vite --config vite.review.config.ts --port 5303 --strictPort --host 127.0.0.1`
(package source, no `build:lib`), then `/reflect-bench.html`. Run a plan:
`cd docs/research/rt-denoiser/results/data/r && python3 rb-plans.py <plan> /tmp/p.json && RB_OUT=<scratch> ./rb-lock.sh /tmp/p.json <plan>`
(takes the GPU lock, writes `<plan>.json` here). Plans: `baseline`, `jitter`, `ours`, `ffxpatch`, `tablesweep`, `normalmaps`, `timing`.

**Metrics** (`rb-metrics.py`, luma = Rec. 709 on the 8-bit display image after ACES + sRGB, as TRACKS "five numbers"):
- **σ** (calm, still form): per-pixel temporal std of luma over 24 frames taken **8 frames apart** (192 frames), mean
  over the region. `σn` = σ × ref luma / luma (calm at equal brightness: a darker image fluctuates less in display levels).
- **bias**: mean luma − the reference's, **reference** = the bench's `ref` mode (the traced estimator, 4 rays/px/frame,
  128 frames = 512 rays/px, same resolver, same pose), accumulated after the fixes below.
- **rmse** of the temporal mean against the reference; **orbit**: RMSE / bias / flicker against per-pose references
  at frames 60, 61, 90, 91, … of the scripted orbit (flicker = RMS of (Δout − Δref) between consecutive frames).
- Regions: `crop` = the 2026-10-28 screenshot crop (whole image minus the GUI strip, for continuity), `table` (the
  mirror disc), `model` (camera body; `model_gloss` r < 0.25, `model_rough` r ≥ 0.25), `bg`.
- GPU ms: each denoiser's own timestamp total (median), run alone.

### Measurement bugs found and fixed (worth a LESSONS entry)

1. **Rendering outside three's animation loop runs FRAME-type nodes once per display tick, not once per render.**
   A manual `pipeline.render()` loop advanced the bench's noise seed every call, but the denoisers, FSR3 and the
   reference accumulator (all `NodeUpdateType.FRAME`) only updated when three's node frame id moved, i.e. on real
   rAF ticks. The first baseline (reference count 11–20 after "200 frames") was meaningless. Scripted frames are now
   rendered inside the animation loop (`step()` queues them).
2. **σ over consecutive frames hides the ripple.** Temporal filters correlate neighbouring frames: on the same run
   σ(stride 1) vs σ(stride 8) = FFX 0.25 / 0.47, recurrent 0.23 / 0.53, SVGF 0.28 / 0.60 (crop). Ours is *calmer*
   than FFX frame to frame and *rougher* over ~100 frames: the undulation Dennis sees is low-frequency. The 2026-10-28
   screenshots were ~6 frames apart, which is why they agreed with stride 8. **T0-scorecard: the calm metric needs a
   frame stride (or a long window), else it ranks these filters backwards.**
3. **The traced estimator emits non-finite samples at grazing silhouettes.** The denoiser wrappers sanitize them; the
   reference accumulator didn't, so a NaN stayed in its running mean for good and FSR3 spread it into black halos.
   Reference and raw path are now sanitized like the denoisers' inputs.
4. An orbit run left the camera at the end of its path, so later "still" runs were at another pose than the cached
   reference; `configure` now resets the still pose.

## 2. Baseline (plan `baseline`, `results/data/r/baseline.json`)

Still camera, 1400 × 757 canvas, FSR3 1.5× (installed `@pmndrs/upscaler` 0.5.0), table roughness 0. σ / σn / bias in
8-bit display levels; `crop` is the whole image minus the GUI strip.

| input | denoiser | crop σ | crop bias | table σ | model σ (σn) | model bias | orbit RMSE / flicker |
|---|---|---|---|---|---|---|---|
| model defaults, traced | raw | 1.39 | −4.1 | 0.50 | 5.37 (6.84) | −16.9 | 11.9 / 3.06 |
| | **FFX** | **0.47** | −4.5 | **0.37** | 1.54 (1.98) | **−17.7** | 12.6 / **2.50** |
| | recurrent | 0.53 | −0.5 | 0.45 | 1.83 (**1.88**) | −2.3 | 10.3 / 2.63 |
| | SVGF | 0.60 | −0.4 | 0.47 | 2.06 (2.10) | −1.4 | **8.9** / 2.92 |
| model defaults, hybrid | raw | 1.21 | −2.8 | 1.04 | 3.91 (4.63) | −12.2 | 12.8 / 2.99 |
| | **FFX** | **0.45** | −3.6 | **0.59** | 1.15 (1.41) | −14.3 | 13.8 / **2.46** |
| | recurrent | 0.63 | −0.3 | 1.00 | 1.52 (1.55) | −1.5 | 11.1 / 2.69 |
| | SVGF | 0.68 | −0.3 | 1.03 | 1.59 (1.61) | −0.8 | 10.3 / 2.90 |
| Ben (r 0), traced | raw | 0.29 | −1.3 | 0.47 | 0.62 | −5.2 | 11.2 / 2.88 |
| | **FFX** | **0.25** | −0.9 | **0.36** | **0.56** | −2.1 | 11.6 / **2.43** |
| | recurrent | 0.29 | −0.8 | 0.45 | 0.71 | −3.4 | 11.7 / 2.58 |
| | SVGF | 0.28 | −1.4 | 0.47 | 0.61 | −5.2 | 11.2 / 2.89 |
| Ben (r 0), hybrid | raw | 0.62 | −1.9 | 1.05 | 1.25 | −7.4 | 12.8 / 2.92 |
| | **FFX** | **0.39** | −1.3 | **0.59** | **0.92** | −3.9 | 12.1 / **2.36** |
| | recurrent | 0.62 | −1.3 | 1.01 | 1.41 | −5.5 | 12.4 / 2.64 |
| | SVGF | 0.63 | −1.9 | 1.05 | 1.26 | −7.4 | 12.8 / 2.94 |

The crop σ reproduces the 2026-10-28 table (traced 1.38 / 0.40 / 0.52 / 0.59; hybrid 1.17 / 0.38 / 0.61 / 0.64; Ben
traced 0.24 / 0.17 / 0.25), so the bench moved intact. Reading it:
- **There is no +3 luma bias in ours.** Against the accumulated reference ours is within 0.5 level (crop) and 1.4–2.3
  on the camera body; **FFX is 4.5 levels dark overall and 17.7 on the camera body** (22 % of its brightness). The
  2026-10-28 "+3" compared ours with FFX and with raw through FSR3, and both are dark: FFX by its own energy loss (§4.5),
  raw by FSR3 averaging very noisy HDR input after its tone map plus Jensen (§4.2: raw without FSR3 is −16.8 on the
  body too, at σ 33).
- **At equal brightness the camera body is not where FFX wins** with FSR3 on: σn recurrent 1.88, FFX 1.98, SVGF 2.10.
  FFX's lower display-level σ there is mostly its darkness.
- **FFX wins on the mirror table** (0.37 vs 0.45 / 0.47; hybrid 0.59 vs 1.00 / 1.03) and on everything roughness 0
  (Ben), where SVGF equals raw to the second decimal (1-frame history) and recurrent is close to raw.
- **The ripple is low-frequency.** Over consecutive frames ours is calmer than FFX (crop 0.23 / 0.28 vs 0.25); 8 frames
  apart it isn't (0.53 / 0.60 vs 0.47). See §1, bug 2.
- Under the orbit ours has the lower error against the per-pose references (SVGF 8.9, recurrent 10.3, FFX 12.6: FFX's
  darkness again) and FFX the lower flicker (2.50 vs 2.63 / 2.92).


## 3. FFX port vs ours, read side by side

FFX = `packages/denoiser-ffx/src/shaders/reflections.ts` (port of FidelityFX SDK 1.1.4, MIT). Ours = `svgf.ts` /
`shaders/svgf.ts` (specular paths) and `recurrent.ts` / `shaders/recurrent.ts`. Roughness r is perceptual, α = r².
Every difference that could move σ or bias on the bench, with where it was tested (§4):

| # | aspect | FFX | ours | tested |
|---|---|---|---|---|
| D1 | history length, glossy | n ≤ max(8, 32·(1 − e^(−100 α))): 32 frames for r ≥ ~0.2, 20 at r 0.1; blend 1/n | SVGF: α ≥ `temporalAlpha` 0.1 (EMA, ≈ 19-frame equivalent), anti-lag λ shortens; recurrent: A ≤ 31, then anti-lag C-10 + detector shorten | §4.4 |
| D2 | history length, mirrors (r = 0, still camera) | 8 frames (floor of D1), no prefilter (`isMirrorReflection`) | SVGF: R-8 cap = θ_L(0)·… + 1 = **1 frame** whatever the motion; recurrent: surface cap 0, virtual history only, behind the detector (floor A_fast·f_r = 0 at r 0) and the R-11 clamp | §4.3 |
| D3 | history clamp | AABB clip to the 9×9 Gaussian moments of the *prefiltered* signal, half-width (σ + ‖mean − avg8×8‖)·0.7·1.4, centre 0.8·mean + 0.2·avg | recurrent: slow luminance clamped to the 3-frame fast history's 3×3 mean ± 1 **standard error** (σ/3), + history cut on the excess (C-10); SVGF: none (anti-lag λ instead) | §4.4 |
| D4 | new-sample outlier clip | the new sample is clipped to avg8×8 ± the same half-width, and blended toward avg8×8 by 1/(n+1) | recurrent: anti-firefly (≤ 1.5 × 2nd-largest neighbour) only for r ≥ 0.25; SVGF: none | §4.5 |
| D5 | the 8×8 average | **luminance-weighted** mean, weights exp(−0.3 L) (dark samples count more), 30 % of the reprojected history mixed in | – | §4.5 |
| D6 | spatial filter | 16-tap prefilter (≤ 3 px) *before* the temporal resolve, normal^512, depth, radiance weight vs avg8×8; the result is the history (recurrent) | SVGF: 5 à-trous iterations *after* the temporal pass, history = unfiltered accumulation (`feedback: false`), radius ∝ r (10 r … 70 r px, so none at r 0); recurrent: pre-blur, blur, post-blur, stabilization, history = post-blur | §4.4 |
| D7 | reprojection choice | hit (virtual) reprojection only when the history normal there matches to 0.9999 and roughness is closer; else surface history if it lies inside the local variance (`REPROJECT_SURFACE_DISCARD_VARIANCE_WEIGHT`), else disocclusion | SVGF: surface only (default); recurrent: surface and virtual blended by F_dom(α), virtual confidence | – (still camera: both reproject to the pixel) |
| D8 | disocclusion | soft factor exp(−1.4 (1 − n·n'))·exp(−Δz/z) > 0.9 (≈ n·n' > 0.925), 3×3 search for a better tap, bilinear slow path | SVGF: per-tap plane 1 % + normal 0.95, `normalTest 'soft'` (specular: 1 frame), 3×3 fallback; recurrent: plane + normal 0.95 'relative' | §4.6 (normal maps) |
| D9 | jitter | both read the same jittered input; reprojection with the unjittered projection (`ignoreViewOffset`, node default) | same | §4.2 |
| D10 | input | hit distance (miss 100 on the bench), radiance not demodulated | same input; our filters document *demodulated* specular as their input contract | – |

## 4. Experiments (one change at a time; defaults traced FSR3 1.5× unless named)

### 4.1 Bias (the "+3 luma")

Plans `baseline`, `jitter`, `ffxpatch`, `ffx2`, `recbias`. Bias in 8-bit levels against the reference (crop / camera body):

| | FSR3 1.5× | no resolver |
|---|---|---|
| raw | −4.1 / −16.9 | −3.9 / −16.8 (Jensen: σ 33 on the body through ACES) |
| FFX | **−4.5 / −17.7** | **−3.3 / −14.9** |
| recurrent | −0.5 / −2.3 | +0.2 / +0.6 |
| SVGF | −0.4 / −1.4 | +0.2 / +0.8 |

- **Ours meets the bias gate (within 1 level) on the whole image; FFX does not.** Our small negative bias under FSR3
  is FSR3 + the ACES curve on our residual noise (it vanishes without the resolver).
- FFX's loss is not its luminance-weighted 8×8 average or its new-sample clip: removing both (`ffx-energy`) leaves
  −4.0 / −15.8. It comes from the prefilter: removing the prefilter makes FFX darker still (−5.8 / −23.5, its resolve
  then clips raw samples to the tile average), and its radiance weight exp(−(0.6 + 0.1 var)·‖avg − sample‖), floored at
  0.01, weighs a bright sample up to 100× less than one near the tile average (`ffx-rw1`, see §4.5).
- Recurrent: switching off its C-10 history anti-lag (`historyAntiLag: false`) costs −4.7 on the body (§4.4, `recbias`).

### 4.2 Jitter (plan `jitter`)

| crop σ (table σ, body σ) | FSR3 1.5× | no resolver (no jitter, no FSR3) | FSR3, `ignoreViewOffset: false` |
|---|---|---|---|
| raw | 1.39 (0.50, 5.37) | 7.82 (2.10, 32.6) | – |
| FFX | 0.47 (0.37, 1.54) | **0.58 (0.57, 2.07)** | 0.33 (0.23, 1.05) |
| recurrent | 0.53 (0.45, 1.83) | 1.07 (1.35, 3.66) | 0.50 (0.42, 1.71) |
| SVGF | 0.60 (0.47, 2.06) | 1.47 (2.10, 4.76) | 0.61 (0.47, 2.07) |

- **Jitter is not the cause.** Without jitter (and without FSR3) the gap to FFX *grows*: 1.9× (recurrent) and 2.5×
  (SVGF) on the crop, 1.8× / 2.3× on the body (1.4× / 1.8× at equal brightness). FSR3 is a second temporal filter that
  hides most of our extra noise; with it the gap is 1.12× / 1.26×. **The gate should be checked with the resolver off
  too**: an app using our filter without FSR3 (or with plain TAA) sees the larger gap.
- Without jitter the traced table (r 0) still has σ 2.1 raw: see §4.3.
- `ignoreViewOffset: false` (reproject with the jittered matrices) makes FFX calmer (0.33) by blurring: its error vs
  the exact reference rises; ours barely move. Not a lead; the default (strip the offset) is right.
- Under FSR3 the reference is filtered twice (accumulated over jitter, then reconstructed by FSR3), so RMSE against it
  measures the reference's softness as much as the output's: raw on Ben's scene scores 10.6 at σ 0.29. **Use the
  no-resolver run for detail / RMSE** (there raw scores 2.2). With it: crop RMSE FFX 11.4, recurrent 6.0, SVGF 4.3
  (Ben: FFX 4.1, recurrent 2.6, SVGF 2.2): FFX is the least accurate, by bias and by blur.

### 4.3 Low-roughness history (plans `tablesweep`, `mirror`)

**Cause found: three's GGX sampler clamps α ≥ 0.001 (`SpecularHelpers.ggxReflectionSample`), so "roughness 0" is a
small lobe, not a mirror,** while the roughness guide (`materialRoughness`) says 0. The traced table at r 0 is noisy
without jitter (raw σ 2.1, p99 40: reflected silhouettes and the soft box flicker). Our filters take the guide at its
word: SVGF's R-8 cap θ_L(α = 0) = 0 gives 1 frame, a pass-through (Ben traced: SVGF σ = raw to the second decimal);
recurrent keeps only virtual history, and its current-frame detector floor A_fast·f_r is 0 at r 0, so any mismatch
drops it.

Table roughness sweep, table region σ (σn) / bias:

| table r | FFX | recurrent | SVGF |
|---|---|---|---|
| 0 | **0.38** / +0.0 | 0.45 / −0.1 | 0.47 / −0.4 |
| 0.05 | **0.33** / −0.3 | 0.56 / −0.1 | 0.36 / +1.0 |
| 0.15 | 0.55 (0.58) / **−7.5** | 1.06 / −1.8 | 0.57 / +1.2 |
| 0.3 | 0.79 (0.90) / **−20.6** | 1.30 / −1.4 | **0.57** / +1.0 |

- The low-roughness cap matters at r = 0 only (and, under motion, at r ≲ 0.05). From r 0.05 SVGF is level with FFX,
  and from 0.15 better at equal brightness, while FFX darkens the glossy table by 7–21 levels.
- **Recurrent is worst on every glossy table (1.06 at r 0.15, 1.30 at 0.3, 2× SVGF)**: a separate recurrent cause (§4.4).
- Mirror fixes, one at a time (crop / table σ; FFX for comparison):

| | defaults traced | Ben traced | Ben hybrid |
|---|---|---|---|
| FFX | 0.47 / 0.37 | 0.25 / 0.36 | 0.39 / 0.59 |
| SVGF | 0.60 / 0.47 | 0.28 / 0.47 | 0.63 / 1.05 |
| SVGF, R-8 cap + 8 frames (patch) | 0.60 / **0.43** | **0.25** / 0.42 | 0.48 / 0.77 |
| recurrent | 0.53 / 0.45 | 0.29 / 0.45 | 0.62 / 1.01 |
| recurrent, surface cap ≥ 7 (patch) | 0.59 / 0.48 | 0.29 / 0.46 | 0.60 / 0.99 |
| recurrent, detector floor A_fast at every r (`tune.detRough: 0`) | 0.53 / 0.39 | 0.25 / 0.40 | 0.53 / 0.86 |
| recurrent, both | 0.54 / **0.38** | **0.23** / 0.37 | **0.41** / 0.63 |

  With both changes recurrent matches or beats FFX on Ben's scene traced (0.23 vs 0.25) and nearly on SSR mirrors
  (0.41 vs 0.39); SVGF's floor closes the traced case but not the SSR flips (0.48 vs 0.39): its 8 frames have no clamp,
  so it averages hit / miss flips instead of rejecting them.
- FFX's mirror floor is not what makes FFX calm at r 0: dropping it to 1 frame (`ffx-mirror1`) makes FFX *calmer*
  (Ben 0.20) because its resolve then blends the sample 50 % with the 8×8 tile average, a blur (RMSE against the
  reference 10.4 → 14.5, table 5.6 → 12.3). FFX's mirror calm is partly that tile blend.

### 4.4 Our filters with FFX-like settings (plan `ours`)

Crop σ / table σ / body σ (σn) / body bias; one change from the defaults each.

| run | crop | table | body | body bias |
|---|---|---|---|---|
| FFX (reference row) | **0.474** | **0.374** | 1.54 (1.98) | −17.7 |
| SVGF defaults | 0.598 | 0.469 | 2.06 (2.10) | −1.4 |
| `temporalAlpha: 1/32` | 0.605 | 0.475 | 2.07 | −1.3 |
| `antiLag: 'off'` (α 0.2) | 0.597 | 0.472 | 2.05 | −1.1 |
| **`antiLag: 'off'`, `temporalAlpha: 1/32`** | **0.476** | 0.477 | **1.44 (1.44)** | **+0.0** |
| `feedback: true` | 0.522 | 0.474 | 1.66 | −1.0 |
| `atrousIterations: 1` | 1.031 | 0.478 | 3.91 | −2.7 |
| recurrent defaults | 0.531 | 0.447 | 1.83 (1.88) | −2.3 |
| `historyAntiLag: false` (C-10 off) | 0.519 | **0.344** | 1.59 (1.69) | **−4.7** |
| `antiLagCurrentSigma: 0` (detector off) | 0.538 | 0.388 | 1.92 | −1.4 |
| both off | 0.515 | 0.335 | 1.61 | −4.7 |
| `stabilizationFrames: 0` | 0.629 | 0.463 | 2.05 | −2.2 |
| `stabilizationFrames: 31` | 0.525 | 0.439 | 1.82 | −2.3 |
| `fireflyThreshold: 0` | 0.629 | 0.496 | 1.87 | −2.2 |
| `preBlurRadius: 0` | 0.604 | 0.491 | 1.79 | −5.3 |

- **SVGF: the history is short because of the 'auto' anti-lag, not α.** On this still view λ never settles at 0 (the
  gradient noise floor of 1 σ for specular is too low for 1-spp GGX on a normal-mapped rough metal), so α stays near
  0.1 whatever `temporalAlpha` says, and with anti-lag off the default α 0.2 is short too. Both together put SVGF level
  with FFX on the image (0.476 vs 0.474) and **27 % calmer than FFX on the body at equal brightness (1.44 vs 1.98),
  unbiased**. What this costs under motion is in §4.7 (`combos`: orbit error, flicker).
- **Recurrent: the C-10 history anti-lag is what shortens it.** Its window is ± 1 standard error of the 3×3 mean of a
  3-frame fast history (≈ σ/3 of a very noisy estimate), so on 1-spp GGX input it clamps and cuts the 31-frame history
  most frames. Off, the table beats FFX (0.344 vs 0.374), but the body darkens by 2.4 levels. `recbias`: the
  anti-firefly, applied every frame to an ever longer history, is about 1 level of it (−4.7 → −3.6 with it off too);
  without a resolver the loss is −1.5 (−0.3 with the anti-firefly off), so the rest is FSR3 reacting to rec-C's output.
- The recurrent anti-firefly is worth 16 % of its calm (0.629 without), stabilization 16 % as well; neither is a gap.

### 4.5 FFX made like ours (plan `ffxpatch`, `ffx2`): where FFX's calm comes from

| FFX run (WGSL patch) | crop σ | table σ | body σ (σn) | body bias |
|---|---|---|---|---|
| FFX | 0.474 | 0.374 | 1.54 (1.98) | −17.7 |
| `max_samples` 32 → 10 (≈ our α 0.1) | 0.527 (+11 %) | 0.367 | 1.77 (+15 %) | −16.3 |
| luminance-weighted 8×8 average → plain | 0.507 (+7 %) | 0.391 | 1.64 | −16.9 |
| no new-sample clip to avg ± window | 0.530 (+12 %) | 0.412 | 1.75 | −16.6 |
| both (`ffx-energy`) | 0.553 (+17 %) | 0.430 | 1.79 | −15.8 |
| no history clip | 0.482 (+2 %) | 0.384 | 1.56 | −17.6 |
| no blend toward avg at low n | 0.453 (−4 %) | 0.334 | 1.47 | −18.5 |
| `temporalStabilityFactor` 0.35 / 1.4 | 0.387 / 0.521 | 0.302 / 0.408 | 1.15 / 1.71 | −15.9 / −16.7 |
| **no prefilter** | **1.417 (3.0×)** | 0.419 | **5.41** | −23.5 |
| prefilter radiance weight → 1 (`ffx2`) | 0.564 (+19 %) | 0.370 | 1.93 (2.24) | **−10.7** |
| same, no resolver (FFX 0.582, −14.9) | 0.728 (+25 %) | 0.572 | 2.71 | −7.5 |
| `max_samples` 10, no resolver | 0.949 (+63 %) | 0.570 | 3.68 | −13.4 |

The prefilter's radiance weight is ~40 % of FFX's energy loss and ~20 % of its calm; the rest of the loss (−7 to
−11 on the body) was not isolated further (the luminance-weighted average and the new-sample clip, removed together, move
it by 2 levels). FFX's calm, by size: (1) the **prefilter** (16 taps before the temporal resolve, and its result becomes the history),
3× on its own; (2) the **32-frame history** (vs our ~10), +11–15 %; (3) the **new-sample clip and the
luminance-weighted average**, +17 % together, i.e. firefly rejection, which is also bias; (4) a smaller clip window is
*calmer* (0.35: −18 %), because the clip pulls the history toward the local (prefiltered) mean, a spatial blur.

### 4.6 Normal-mapped gloss (plan `normalmaps`)

Model normal maps off, body σ (defaults traced / hybrid): FFX 1.54 → 1.47 / 1.15 → 1.11, recurrent 1.83 → 1.78 /
1.52 → 1.46, SVGF 2.06 → 1.99 / 1.59 → 1.53. **Every filter loses 3–5 % with the normal maps, ours no more than FFX:
the still-view ripple on the camera body is not reprojection rejection or edge-stopping on normal detail**, it is the
history length of §4.4 on a rough, noisy signal. (The body is mostly r 0.3–0.6: 77 % of its pixels.) Under motion the
normal tests do act (T5, SVGF-FOLLOWUPS); the orbit runs in §4.7 carry the normal maps.

### 4.7 The causes combined, still and under motion (plan `combos`)

Configurations (all reachable as options except the two WGSL patches, which phase 2 would turn into options):
- **SVGF-C**: `antiLag: 'off'`, `temporalAlpha: 1/32`, R-8 cap + 8 frames (patch).
- **SVGF-D**: `temporalAlpha: 1/32`, `antiLagNoiseFloor: 3` (anti-lag kept, less trigger-happy), cap + 8 (patch).
- **rec-C**: `historyAntiLag: false`. **rec-D**: rec-C + surface cap ≥ 7 (patch) + `tune.detRough: 0`.

Crop σ (table σ) / body bias; orbit: RMSE vs per-pose references / flicker. Bold = at or below FFX's σ.

| run | traced FSR3 | traced no resolver | hybrid FSR3 | hybrid no resolver | Ben hybrid FSR3 | Ben hybrid no resolver |
|---|---|---|---|---|---|---|
| FFX | 0.473 (0.37) / −17.7 | 0.582 (0.57) / −14.9 | 0.451 (0.59) / −14.3 | 0.693 (1.58) / −11.5 | 0.395 (0.59) | 0.875 (1.61) |
| SVGF | 0.619 (0.48) / −1.3 | 1.478 (2.10) / +0.8 | 0.672 (1.04) / −0.8 | 2.586 (7.33) / +0.7 | 0.628 (1.05) | 3.852 (7.60) |
| SVGF-C | **0.445** (0.41) / +0.1 | **0.538** (0.81) / +2.1 | 0.477 (0.74) / +0.1 | 0.743 (1.98) / +1.7 | 0.445 (0.74) | 1.046 (2.01) |
| SVGF-D | 0.527 (0.41) / −0.5 | 0.789 (0.81) / +1.6 | 0.549 (0.75) / −0.3 | 0.935 (1.99) / +1.2 | 0.455 (0.75) | 1.102 (2.02) |
| recurrent | 0.557 (0.47) / −2.4 | 1.078 (1.35) / +0.6 | 0.623 (0.99) / −1.5 | 1.622 (4.16) / +0.7 | 0.620 (1.01) | 2.309 (4.15) |
| rec-C | 0.536 (**0.35**) / −4.7 | 0.764 (**0.50**) / −1.5 | 0.626 (0.82) / −3.6 | 0.796 (**1.22**) / −1.3 | 0.531 (0.80) | 0.904 (**1.22**) |
| rec-D | 0.531 (**0.32**) / −4.7 | 0.745 (**0.32**) / −1.6 | 0.529 (**0.56**) / −3.6 | 0.743 (**0.95**) / −1.3 | **0.369** (**0.53**) | **0.619** (**0.95**) |

Body σ at equal brightness (σn), traced FSR3 / no resolver: FFX 1.99 / 2.58, SVGF-C **1.46 / 1.63**, rec-D 1.69 / 3.08.

Orbit, model defaults traced FSR3 (RMSE / flicker / bias): FFX 12.6 / 2.51 / −2.4; SVGF 8.9 / 2.94 / −0.6;
SVGF-C 12.1 / **2.36** / +0.4; SVGF-D 10.4 / 2.47 / +0.1; recurrent 10.2 / 2.64 / −0.5; rec-D 11.0 / 2.55 / −0.9.
No resolver: FFX 10.5 / 3.40; SVGF-C 9.1 / **3.33**; rec-D 8.1 / 3.56; SVGF 6.2 / 6.49.

- **SVGF-C is calmer than FFX on traced input with or without FSR3, unbiased**, and flickers less under the orbit. Its
  cost is lag: the orbit RMSE rises from 8.9 to 12.1 (FFX's level, 12.6) because a 32-frame history with no anti-lag
  trails under motion, exactly as FFX's does. SVGF-D keeps half of that (10.4) and loses half the calm (0.527).
- **SVGF-C still loses on mirrors** (table 0.41–0.81 vs FFX 0.37–0.57; on SSR input 0.74 / 1.98 vs 0.59 / 1.58): an
  unclamped 8-frame floor averages SSR hit / miss flips instead of rejecting them. **rec-D is the best mirror filter**
  (it beats FFX on every table and on Ben's SSR scene: 0.369 vs 0.395, 0.619 vs 0.875) but not on the rough body,
  and turning C-10 off costs it 4.7 levels there.
- So the two filters each hold half of the answer: SVGF's long plain accumulation for rough / glossy, recurrent's
  confidence-checked virtual history for mirrors.

### 4.8 Recurrent on glossy surfaces (plans `glossy`, `glossy2`, `glossy3`)

Recurrent is 2× SVGF on the glossy table (r 0.15: 1.06 vs 0.57). Not C-10 alone (rec-C 1.12), not the detector
(1.32), not the virtual history (`virtualMotion: false` 1.07, `virtualClampSigma: 3` 1.03). It is the spatial radius:
R = R_max·√(α/0.25)/(1 + A), floored at `minBlurRadius`·f_r, is a fraction of a pixel on a settled glossy pixel
(r 0.15: ~0.3 px at A = 31), so nothing averages the 1-spp lobe noise spatially. A 3 px floor
(`specularMinRadiusScale: 0, minBlurRadius: 3`) gives 0.83, and with C-10 off 0.41 (FFX 0.55, SVGF-C 0.38). FFX's
prefilter has a fixed ~3 px footprint at every roughness above its mirror cut (D6). SVGF-C on the glossy table: 0.38
(r 0.15) and 0.35 (r 0.3) vs FFX 0.55 / 0.79.

### 4.9 dropoutGuard (plan `dropout`)

`dropoutGuard: true` on recurrent: Ben hybrid crop 0.607 (default 0.62), defaults hybrid 0.658 (0.63), traced 0.554
(0.53–0.56): **no effect beyond run-to-run noise** (repeat runs of one configuration vary ±3 % for ours, ±1 % for FFX).
It keys on exact misses (hit distance 0); the bench fills misses with 100, as reflections-hybrid does. What it was
for (SSR hit / miss flips on mirrors) is what rec-D does without it (Ben hybrid 0.369, FFX 0.395). **Recommend
removing it** in the simplify step, per the stocktake.

### 4.10 GPU time (plan `timing`, 1080p denoiser resolution, no resolver, each alone, median of 300 frames, 3 rounds)

| denoiser | total ms | passes |
|---|---|---|
| FFX | **1.04** | prepare 0.05, reproject 0.44, prefilter 0.21, resolve 0.34 |
| recurrent | 1.47 | prepass 0.06, pre-blur 0.14, temporal 0.47, history fix 0.29, blur 0.18, post-blur 0.13, stabilize 0.21 |
| SVGF | 1.73 | prepass 0.10, anti-lag 0.25 (gradient + 4 à-trous + λ), temporal 0.20, variance 0.22, à-trous 5 × 0.17–0.23 |

Rounds agree within 0.003 ms. SVGF-C drops the anti-lag passes (−0.25 ms → ~1.48). Specular alone; the TRACKS cost
gate is diffuse + specular (track D).

## 5. Ranked causes

Gap = our crop σ − FFX's, model defaults traced (FSR3 1.5× / no resolver): SVGF 0.124 / 0.896, recurrent 0.057 /
0.496 (FFX 0.474 / 0.582). "Closes" = how much of that gap the single fix removes in §4.

| rank | cause | filter | evidence | σ contribution | bias contribution |
|---|---|---|---|---|---|
| 1 | **History too short on noisy (rough / glossy) specular**: 'auto' anti-lag λ never reaches 0 on still 1-spp GGX (specular noise floor 1 σ), so α stays ~0.1; `temporalAlpha` alone can't lengthen it. FFX keeps 32 frames. | SVGF | `ours`, `combos`: anti-lag off + α 1/32 | closes ~100 % (FSR3: 0.598 → 0.476) and 78 % (no resolver: 1.478 → 0.778); body 27 % below FFX at equal brightness | none (+0.0) |
| 2 | **"Roughness 0" is not a mirror**: three's GGX sampler clamps α ≥ 0.001, the guide says 0, our caps go to 1 frame (SVGF R-8: θ_L(0) = 0) / virtual-only with a 0 detector floor (recurrent) | both | `jitter` (raw traced table σ 2.1 with no jitter), `mirror` | table: SVGF 0.47 → 0.43 (FSR3), and in SVGF-C no-resolver 0.778 → 0.538 (the rest of SVGF's gap, now 8 % below FFX); Ben traced 0.28 → 0.23–0.25 (= FFX); Ben SSR 0.62 → 0.37 (rec-D) | none |
| 3 | **Recurrent C-10 anti-lag window = ± 1 standard error of a 3-frame fast history** (≈ σ/3 of a noisy estimate) cuts the 31-frame history most frames | recurrent | `ours`, `combos` | FSR3 small (0.531 → 0.519) but table −23 %; no resolver 1.078 → 0.764 (64 % of the gap) | −2.4 on the body with it off (−1.5 no resolver; anti-firefly 1 level of it) |
| 4 | **Recurrent spatial radius vanishes on settled glossy pixels** (R ∝ √α/(1 + A)) | recurrent | `glossy3` | glossy table 1.06 → 0.83 (→ 0.41 with #3) | small |
| 5 | **FFX's prefilter + firefly rejection**: 16 taps before the temporal resolve (3× of FFX's calm), radiance weights against a luminance-weighted tile average, new samples clipped to it | FFX (what we're compared with) | `ffxpatch`, `ffx2` | the reason FFX is calm on very noisy input; ours reach it without them (#1) | **FFX −4.5 overall, −17.7 on the body**; the radiance weight is ~40 % of it |
| – | Jitter, normal-mapped gloss, hit-distance alpha, demodulation | – | `jitter`, `normalmaps` | none differential: without jitter the gap grows; normal maps cost every filter 3–5 % | ours unbiased with or without FSR3 |

Together #1 + #2 put SVGF at or below FFX's σ on traced input with and without FSR3 (SVGF-C: 0.445 vs 0.473, 0.538
vs 0.582), unbiased (+0.1 / +0.5), but not yet on SSR mirrors (hybrid table 0.74 vs 0.59; hybrid crop 0.477 vs 0.451,
+6 %; no resolver 0.743 vs 0.693, +7 %). #2 + #3 put recurrent below FFX on every mirror case, SSR included, but not
on the rough body (crop 0.531 vs 0.473).

## 6. Fix plan (phase 2; starts after the metrics are calibrated with Dennis)

Gate measures: **calm** = crop σ (stride 8) ≤ FFX on G1 traced and hybrid, checked with FSR3 1.5× **and** with no
resolver; **bias** within 1 level of the reference; plus orbit RMSE / flicker as the lag guard until T0 has a lag metric.

| fix | where | moves | expected (measured analogue) | risk / guard |
|---|---|---|---|---|
| **F1. Specular history length on SVGF**: a specular anti-lag that doesn't fire on stationary 1-spp lobe noise (noise floor / gain per signal sized for GGX noise, or λ gated by the fast-vs-slow test in standard errors of the *history*), with α floor ~1/32 for specular | `svgf.ts` specular options; anti-lag per-signal params (D owns `shaders/gradient.ts`) | calm traced + hybrid, FSR3 and no resolver | crop σ 0.60 → 0.45–0.53 (FSR3), 1.48 → 0.54–0.79 (no resolver); body −30 %; bias unchanged | lag under motion: orbit RMSE 8.9 → 10.4 (D-like) … 12.1 (C-like, = FFX). Pick the point with T0's lag metric and Dennis |
| **F2. Low-roughness floor**: take α ≥ α_min (option, default matching three's sampler 0.001) in the caps and weights, and a minimum mirror history (~8 frames) that is clamp-guarded (an FFX-like clip box, or recurrent's confidence-checked virtual history ported as SVGF's mirror path) | specular paths of `shaders/svgf.ts` (R-8 cap) and `recurrent.ts` | calm on mirrors (table, Ben traced / SSR) | table 0.47 → ≤ 0.37; Ben traced 0.28 → 0.23–0.25; Ben hybrid 0.63 → ≤ 0.40 (rec-D 0.369, SVGF + unclamped floor 0.48) | clean mirrors under motion: run the 12 `rm-*` reflection paths first (LESSONS, dropout guard) |
| F3 (only if recurrent is kept). C-10 window from the spread, not the standard error; detector floor A_fast at every roughness; a px floor on the specular blur radius | `recurrent.ts`, `shaders/recurrent.ts` | calm, glossy table | no resolver 1.08 → 0.75; glossy table 1.06 → 0.41 | bias −1.5…−4.7 on the body (C-10 off): needs its own fix |
| F4. Remove `dropoutGuard` | `recurrent.ts` | option count | no measurable effect here | – |

Recommendation: **build phase 2 on SVGF (F1 + F2) and move recurrent's mirror handling into it if SVGF's clamped
floor doesn't reach FFX on SSR mirrors**; retire recurrent otherwise (stocktake §3.3). Expected end state on G1:
calm ≤ FFX traced and hybrid with and without FSR3, bias within 1 level (FFX: −4.5), cost ~1.5 ms specular at 1080p
(FFX 1.04).

**Estimate for phase 2:** F1 + F2 as options on SVGF with rule-9 checks (test bed 7 paths + 12 `rm-*` paths + G1,
G5 when it exists): **2–3 working days** of one Opus agent, plus one A/B session with Dennis on the bench for the
lag-vs-calm point of F1. F3 adds ~1 day if recurrent stays.

## 7. What I need from other tracks

- **D (SVGF core owner):** F1 needs per-signal anti-lag parameters in a joint pipeline (noise floor / gain exist per
  signal; check `temporalAlpha` is per signal too) and possibly a specular variant of the λ test in
  `shaders/gradient.ts`; F2 changes `capWgsl` (specular branch) in `shaders/svgf.ts`. I'd like D's OK to edit those
  specular branches, or D to add the hooks.
- **T0-scorecard:**
  - calm σ needs a frame stride or a long window: consecutive frames rank these filters backwards (§1, bug 2);
  - report σ at equal brightness next to σ (FFX's darkness reads as calm);
  - detail / RMSE against a resolver-free reference, or a per-jitter-phase one (§4.2);
  - a lag metric under motion (F1's trade-off);
  - the gate wording: is "calm ≤ FFX" with FSR3 only, or also without a resolver? (I'd gate both.)
- **T0-scenes:** G1 = `reflect-bench.html` as of `8c1ef6b` + the API in `6198cf9` / `8165323` (presets `defaults` /
  `ben`, `configure`, frame-locked `step`, `regions` masks). Its non-finite traced samples at silhouettes are now
  sanitized; if G1 captures are taken elsewhere, sanitize the same way.
- **Dennis:** calibration pairs worth including: SVGF vs SVGF-C on the camera body (calm vs motion lag), FFX vs ours
  on the body (calm vs 17 levels of brightness), rec-D vs FFX on Ben's SSR table.

## 8. Commits (track/r-reflections, not pushed)

`8c1ef6b` bench moved · `6198cf9` scripted API + runner · `a756db5` WGSL patch hook + plans · `8165323` measurement
fixes · `92f42ae` first measurements + draft · this report's commit. Data: `results/data/r/*.json` (one per plan),
scripts `rb-run.mjs`, `rb-metrics.py`, `rb-plans.py`, `rb-show.py`, `rb-lock.sh` (fair GPU queue). PNG frames were in
scratch and are deleted.
