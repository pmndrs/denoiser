# Track R (reflections), phase 1: diagnosis

_Agent R, branch `track/r-reflections` (worktree `../Denoiser-track-r`), 2026-11-07. Role: implementer (RULES.md §8).
No NRD material read. Our FFX port (`packages/denoiser-ffx`, MIT) read side by side with ours. No package default
changed; every experiment below is an option or a WGSL text patch applied by the bench at pipeline build (nothing in
`packages/` was edited)._

SUMMARY_PLACEHOLDER

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

