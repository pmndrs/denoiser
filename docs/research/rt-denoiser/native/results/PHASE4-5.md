# Native comparison, phases 4–5

_Harness builder, 2026-10-25. Native NRD v4.18.0 (`e06852b`), default settings; ours from
`feat/rt-denoiser-cleanroom` @ `7a8b980`. Everything ran on one RTX 3060 Laptop GPU (driver 592.00,
D3D12; ours through Chrome 156 / Dawn). Scores come from `tools/rt-capture/compare.mjs` (standard
set) and `examples/three-temporal/score-captures.mjs` (real scene, plus AO and FLIP). Ranking is
on pooled PSNR. Images, metrics, timings and build facts only. Setup and script notes are in
[../SETUP.md](../SETUP.md). Raw outputs stay in `C:\dev\nrd-reference\outputs\`._

Columns, all pooled PSNR in dB (the PSNR of the mean squared error over every frame and pixel of a
capture):

- **std set**: mean over the 8 standard captures.
- **settled**: frames ≥ 8 after a reset, so seven 960×540 captures only (`std1080-orbit` has
  8 frames).
- **real scene**: `three-orbit` (40 frames, slow orbit) and `three-pan` (32 frames, fast pan).
- Per-capture tables are in `<capture>/compare.md` and, for the real scene,
  `<capture>/score-captures.md` (with FLIP).

## Diffuse

| # | denoiser | side | std set | settled (7× 540) | 7× 960×540 | 1080p orbit | three-orbit | three-pan |
|---|---|---|---|---|---|---|---|---|
| 1 | `svgf-auto` | ours | **37.80** | 38.07 | 37.60 | 39.21 | 39.83 | **40.39** |
| 2 | `svgf` | ours | **37.69** | 37.87 | 37.48 | 39.15 | **39.89** | 40.27 |
| 3 | `recurrent` (= `recurrent-svgfspec`) | ours | **36.57** | 37.47 | 36.52 | 36.96 | 38.78 | 39.55 |
| 4 | `RELAX_DIFFUSE_SPECULAR` | native | **34.68** | 34.48 | 34.27 | 37.55 | 37.59 | 38.73 |
| 5 | `REBLUR_DIFFUSE_SPECULAR` | native | **33.63** | 33.72 | 33.33 | 35.78 | 32.93 | 33.18 |
| 6 | `accumulate` | ours | **21.76** | 26.38 | 21.95 | 20.41 | 28.53 | 26.47 |
| – | noisy input | – | | | | | 16.88 | 17.09 |

## Specular

| # | denoiser | side | std set | settled (7× 540) | 7× 960×540 | 1080p orbit | three-orbit | three-pan |
|---|---|---|---|---|---|---|---|---|
| 1 | `svgf-auto` (= `recurrent-svgfspec`) | ours | **34.24** | 34.45 | 34.13 | 34.97 | 45.33 | 47.58 |
| 2 | `svgf` | ours | **33.58** | 33.68 | 33.46 | 34.42 | 44.34 | 46.11 |
| 3 | `recurrent` | ours | **32.78** | 33.43 | 32.77 | 32.85 | 43.02 | 44.29 |
| 4 | `RELAX_DIFFUSE_SPECULAR` | native | **29.73** | 31.10 | 29.73 | 29.73 | 41.41 | 42.67 |
| 5 | `REBLUR_DIFFUSE_SPECULAR` | native | **29.69** | 29.99 | 29.47 | 31.23 | 39.91 | 41.65 |
| 6 | `accumulate` | ours | **22.90** | 27.30 | 23.24 | 20.48 | 39.28 | 37.34 |
| 7 | `ffx-reflections` | ours | **20.86** | 21.82 | 21.21 | 18.41 | 39.11 | 40.85 |
| – | noisy input | – | | | | | 34.79 | 35.87 |

The real scene's specular is three's SSR: it isn't demodulated, and its noisy input already scores
35–36 dB, so its numbers sit far above the test bed's. `recurrent-svgfspec` = `recurrent` diffuse +
`svgf-auto` specular, so rows coincide. RELAX's 29.73 twice is a coincidence (27.3–33.4 per capture).

## Shadows (visibility)

| # | denoiser | side | std set | settled (7× 540) | penumbra (std set) | 7× 960×540 | 1080p orbit | three-orbit | three-pan | penumbra orbit / pan |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `shadows` | ours | **35.62** | 36.29 | 26.69 | 35.47 | 36.66 | 30.92 | 31.08 | 26.81 / 26.71 |
| 2 | `ffx-shadows` | ours | **31.42** | 29.91 | 23.77 | 30.85 | 35.40 | 26.32 | 27.86 | 22.61 / 23.20 |
| 3 | `accumulate` | ours | **23.67** | 26.51 | 15.50 | 23.55 | 24.46 | 25.96 | 25.73 | 19.98 / 18.10 |
| 4 | `SIGMA_SHADOW` | native | **22.04** | 22.05 | 12.51 | 21.92 | 22.87 | 24.93 | 25.79 | 17.36 / 17.62 |
| – | noisy input | – | | | | | | 16.05 | 16.79 | 7.79 / 7.84 |

Native SIGMA ranks below plain accumulation on the test bed and level with it on the real scene. Its
error is almost all in the penumbrae: on `std540-orbit` frame 15 its penumbra RMSE is 0.243 (ours
0.053, accumulate 0.111), against lit 0.011 and umbra 0.048. To rule out the harness's light
conversion, I scaled the light size given to the penumbra helper (sphere diameter × s) on
`std540-orbit`:

| light size × | 0.5 | 1 (as reported) | 2 | 4 | 8 |
|---|---|---|---|---|---|
| pooled / penumbra pooled | 22.92 / 12.44 | 22.84 / 12.38 | 22.42 / 12.04 | 21.60 / 11.44 | 20.86 / 11.02 |

No setting helps, so the result stands as measured. Crops (noisy | SIGMA | `shadows` | `ffx-shadows` |
reference): [std540-thin](std540-thin/crop_f15_visibility.png),
[std540-light](std540-light/crop_f12_visibility.png), [three-pan](three-pan/crop_f20_visibility.png).

## AO / SO

AO is scorable only on the real scene, against its `ao_ref` buffer; the standard set has no AO/SO
references, and the real scene has no SO reference.

| # | denoiser | side | three-orbit | three-pan |
|---|---|---|---|---|
| 1 | `occlusion-svgf` | ours | **33.42** | **33.55** |
| 2 | `occlusion-svgf-auto` | ours | 33.10 | 33.47 |
| 3 | `occlusion-recurrent` | ours | 32.53 | 32.59 |
| – | `REBLUR_DIFFUSE_SPECULAR_OCCLUSION` | native | not comparable | not comparable |
| – | noisy input (1-ray ĥ on our curve) | – | 12.52 | 12.74 |

`ao_ref` holds the mean of ĥ = h / (h + 1 + 0.05·(−viewz)) per ray, which is our normalization.
Native's output is on its own normalization (P3 below), so scoring it against `ao_ref` measures the
curve difference more than the denoiser. (For the record, that score is 23.01 / 21.74, but it is not
a ranking.) A fair comparison needs references rendered on native's curve, and P3 gives the data
for that.

## Cost: same GPU, `std1080-orbit`, clocks locked

Both sides ran with the GPU locked at **1200 MHz graphics / 7001 MHz memory** (`nvidia-smi -lgc` /
`-lmc`). Each timed run started below 82 °C, and every one of 1,991 clock samples (every 200 ms)
held 1200 / 7001 MHz with no thermal slowdown (76–79 °C). Before each timed frame, each side
ran the same 50 ms ALU warm-up. GPU ms = timestamps around the denoiser's dispatches (ours: the
WebGPU timestamp queries summed as `total`; native: around `DenoiseD3D12`). The value is the median of
frames 1–7, then the median of 3 runs; the range across runs is in brackets. Data and per-run
`timings.csv`: [std1080-orbit/cost/](std1080-orbit/cost/).

| signals | ours | GPU ms | native | GPU ms | ours / native |
|---|---|---|---|---|---|
| diffuse + specular | `svgf` | 5.351 [5.349–5.354] | `REBLUR_DIFFUSE_SPECULAR` | 5.377 [5.373–5.378] | **1.00×** (RELAX: 0.74×) |
| | `recurrent` | 5.477 [5.477–5.502] | | | **1.02×** (0.76×) |
| | `svgf-auto` | 6.089 [6.084–6.097] | | | **1.13×** (0.84×) |
| | `recurrent-svgfspec` | 7.471 [7.469–7.555] | | | **1.39×** (1.03×) |
| | | | `RELAX_DIFFUSE_SPECULAR` | 7.241 [6.975–7.250] | |
| shadows | `shadows` | 1.071 [1.070–1.071] | `SIGMA_SHADOW` | 0.959 [0.959–0.961] | **1.12×** |
| | `ffx-shadows` | 0.962 [0.961–0.963] | | | 1.00× |
| AO + SO | `occlusion-recurrent` | 3.763 [3.748–3.764] | `REBLUR_DIFFUSE_SPECULAR_OCCLUSION` | 3.356 [3.354–3.359] | **1.12×** |
| | `occlusion-svgf` | 4.146 [4.144–4.146] | | | **1.24×** |
| | `occlusion-svgf-auto` | 4.952 [4.618–4.988] | | | **1.48×** |
| specular only | `ffx-reflections` | 3.100 | – | – | |
| all three, baseline | `accumulate` | 1.817 | – | – | |

**Every one of our denoisers is within the 2× target**: 1.00–1.39× REBLUR on diffuse + specular,
1.12× SIGMA on shadows, 1.12–1.48× REBLUR occlusion on AO + SO. Wall time (submit to done) adds
about 2.1–3.4 ms per frame on our side (Chrome / Dawn submission), against 0.1–0.15 ms native (e.g.
`svgf` 8.5 ms wall vs `REBLUR` 5.5).

These are locked-clock numbers, so they are not the speeds the laptop reaches on its own. Locking
was necessary: unlocked, the driver kept our Chrome work at ≤ 780 MHz with the memory clock
dropping to 810 MHz (P5) on some frames, making our times bimodal (e.g. `svgf` 5.3 ↔ 28 ms), while
native boosted to ~1.9 GHz. A visible (non-headless) Chrome window gave the same 28 ms, so headless
mode isn't the cause. The `GPU ms` columns in this session's `compare.md` / `score-captures.md`
files come from unlocked runs: **don't use them.**

## P2: is native specular low because of input conventions? **No.**

Specular only, sequence pooled PSNR (last frame in brackets), `compare.mjs`:

| capture | variant | REBLUR | RELAX |
|---|---|---|---|
| synthetic-static | (a) as now | 25.24 (26.01) | 24.49 (26.34) |
| | (b) `specular_hitt` × 0.1 | 27.57 (30.56) | 24.44 (26.25) |
| | (b) `specular_hitt` × 10 | 23.50 (23.61) | 24.06 (25.56) |
| | (c) roughness := 0.3 | 24.15 (24.79) | 23.88 (24.80) |
| | (c) roughness := 0.7 | 22.75 (23.00) | 23.81 (24.75) |
| | (d) hit-distance parameters (2, 0.08, 1) | 25.39 (26.20) | – |
| synthetic-plane | (a) as now | 25.00 (25.37) | 23.49 (23.97) |
| | (b) `specular_hitt` × 0.1 | 26.64 (27.92) | 23.41 (23.85) |
| | (b) `specular_hitt` × 10 | 23.38 (23.41) | 23.22 (23.59) |
| | (c) roughness := 0.3 | 24.04 (24.46) | 22.90 (22.88) |
| | (c) roughness := 0.7 | 22.76 (22.90) | 22.96 (23.02) |
| | (d) hit-distance parameters (2, 0.08, 1) | 25.10 (25.50) | – |

Noisy input: 12.87 (static), 12.79 (plane).

- **Range in (a).** The normalized specular hit distance the helper produced with default
  parameters (3, 0.1, 20), over scored pixels of all frames: **p1 0.021, p50 0.056–0.061,
  p99 0.20–0.22** (min 0.011, max 0.28–0.29), on both captures.
- **Choice of (d).** I picked (2, 0.08, 1) by measuring the dumped range: p1 0.28, p5 0.36,
  p50 0.59, p95 0.83, p99 0.87. It gains 0.1 dB.
- **Sensitivities.** REBLUR responds to hit-distance scale (shorter hits +1.6 to +2.3 dB, longer
  −1.6 to −1.7). RELAX barely does (≤ 0.5 dB). Forcing roughness costs both.
- **No variant closes the gap to ours** (28.7–29.4 on these captures, per results/M1.md §7). The
  gap persists on the test bed (std set: native 29.7, ours 34.2) and the real scene (best of ours vs best native: +3.9 / +4.9 dB).

## P3: native occlusion's hit-distance curve (data)

Probe captures (`harness/tools/gen-probe.mjs`):
- static camera facing a wall at exactly viewZ = −d, 64×64, 32 noise-free frames;
- constant hit distance h for both lobes;
- roughness 0.3 on the left half, 0.8 on the right;
- our 0 (miss) passed as 65504; default hit-distance parameters.

The table gives the converged output at frame 31; frame 15 is already identical.
`REBLUR_DIFFUSE_OCCLUSION` + `REBLUR_SPECULAR_OCCLUSION` (separate instances) and
`REBLUR_DIFFUSE_SPECULAR_OCCLUSION` (joint) give identical values. AO doesn't depend on roughness.

| viewZ | h | AO | SO, r = 0.3 | SO, r = 0.8 |
|---|---|---|---|---|
| −2 | 0.1 | 0.0314 | 0.0039 | 0.0117 |
| −2 | 0.3 | 0.0940 | 0.0078 | 0.0314 |
| −2 | 1 | 0.3134 | 0.0314 | 0.1021 |
| −2 | 3 | 0.9375 | 0.0979 | 0.3124 |
| −2 | 10 | 1.0000 | 0.3257 | 0.9996 |
| −2 | 30 | 1.0000 | 0.9772 | 0.9999 |
| −2 | 0 (miss) | 1.0000 | 1.0000 | 1.0000 |
| −20 | 0.1 | 0.0196 | 0.0000 | 0.0078 |
| −20 | 0.3 | 0.0589 | 0.0078 | 0.0196 |
| −20 | 1 | 0.2000 | 0.0196 | 0.0666 |
| −20 | 3 | 0.6000 | 0.0627 | 0.1997 |
| −20 | 10 | 1.0000 | 0.2079 | 0.6655 |
| −20 | 30 | 1.0000 | 0.6241 | 0.9997 |
| −20 | 0 (miss) | 1.0000 | 1.0000 | 1.0000 |

The converged output equals the normalized input given to the denoiser to within ±0.004. Small
values come out on steps of 1/255 (0.0039, 0.0078, …).

## Jitter units (re-checked on a test-bed capture with edges)

The test bed writes no jitter, so this test tells native about a jitter the capture doesn't have.
The capture is the truly unjittered `std540-orbit`. The false jitter is Halton(2,3) − 0.5 (±0.5 px),
given as pixels, as UV (÷ size), or not at all.

| | REBLUR diff / spec | RELAX diff / spec | SIGMA |
|---|---|---|---|
| no jitter (as captured) | 34.149 / 28.814 | 35.858 / 27.633 | 22.840 |
| false jitter, passed as UV | 34.149 / 28.814 | 35.858 / 27.633 | 22.840 |
| false jitter, passed as pixels | 34.150 / 28.813 | 35.861 / 27.625 | 22.840 |

Passing ±0.5 as pixels changes scores by ≤ 0.02 dB. If native read the value as UV, that would be
half the screen and the run would have collapsed. **Pixel units are consistent**, and the setting
barely matters on these captures, all of which are unjittered.

## Crops

- **Diffuse:** [std540-pan](std540-pan/crop_f15_diffuse.png), [three-pan](three-pan/crop_f20_diffuse.png).
  Panels: noisy | REBLUR | RELAX | `svgf-auto` | `recurrent` | reference.
- **Specular:** [std540-glossy](std540-glossy/crop_f15_specular.png), same panels.
