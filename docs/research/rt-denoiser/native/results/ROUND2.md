# Native comparison, round 2 (handoff)

_Harness builder, 2026-10-26. Ours at `feat/rt-denoiser-cleanroom` @ `90aa679` (shadows v2.2), native
NRD v4.18.0 (`e06852b`) with defaults, one RTX 3060 Laptop GPU (driver 592.00). Harness commits
`fead856`, `f6545c4` (outside the repo). Round 1 (the locked-clock cost table, P1–P3, jitter) is in
[PHASE4-5.md](PHASE4-5.md). Images, metrics, timings and build facts only._

## For the orchestrator: is native's low shadow score a harness issue? Checked; most likely not.

You flagged native's shadow results as suspicious. The fair concern is that the harness feeds SIGMA
wrong inputs. These are the black-box checks on SIGMA, each changing one harness convention:

| check | result |
|---|---|
| penumbra input vs geometry | the packed penumbra matches a CPU recomputation from the capture's matrices, light and occluder distance (`synthetic-static`, exact to float precision) |
| light size given to the penumbra helper × 0.5 … 16 | no setting helps; larger only adds positive bias. Static-penumbra boil on `three-knot-still`: 0.216 / 0.216 / 0.218 at ×1 / ×4 / ×16 |
| viewZ sign (ours negative vs positive, with −`motion_z`) | identical (SIGMA bit-for-bit on `three-knot-still`; ≤ 0.01 dB on `std540-orbit`) |
| motion vectors / history | `three-knot-still` has a static camera and a static scene (max \|motion\| 7e-7): SIGMA still boils at 0.22 in static penumbrae, against the reference's 0.005 |
| stabilization setting (`maxStabilizedFrameNum` 0 / 5 / 7) | active (outputs differ) but nearly inert: boil 0.244 → 0.239 on `std540-orbit`, 0.223 → 0.216 on `three-knot-still` |
| jitter units | pixel units confirmed (round 1) |
| determinism, D3D12 debug layer, NRI validation | clean |

So with the camera, the scene and the inputs all held fixed, SIGMA's output barely uses temporal
history. Its spatial smoothing barely responds to the penumbra size either. The output is
lightly smoothed noise; see the knot strip below.

Its public settings header is consistent with a deliberately short history: `SigmaSettings` default
`maxStabilizedFrameNum` is 5, the maximum is 7, and the default accumulation time is 0.084 s. Our
captures have wide penumbrae (sphere lights of radius 0.4–0.9 m) at 1 spp, and on such content any
long-history filter wins. Even our plain `accumulate` beats SIGMA everywhere except inside moving
shadows. I read this as a design difference, not a harness bug, with medium confidence: the one
thing I can't do is compare against a known-good SIGMA integration.

Other places a harness choice could cost native, in order of likelihood:

1. **REBLUR diffuse on the real scene** (32.9 / 33.2 dB) sits ~5 dB below RELAX (37.6 / 38.7) and ours.
   REBLUR takes the hit distance normalized with default parameters (A = 3, B = 0.1, C = 20), which
   are scale-dependent; P2 showed REBLUR specular moves ±2 dB with hit-distance scale. **Not tested on
   diffuse or the real scene: worth a sweep before reading much into REBLUR's real-scene rows.**
2. **Specular**: the conventions are ruled out on the synthetic captures (P2). Native stays ~4 dB
   behind on every capture set.
3. **Normals** are quantized (encoding 2, ~10 bit, because encoding 4 doesn't build). This is small,
   and it affects REBLUR and RELAX equally.
4. **Lights on the real scene** are a rectangle passed as an equal-area sphere (stated in its
   manifest). Ours and native get the same sphere.
5. **AO** isn't comparable: the real scene's `ao_ref` is on our normalization curve (P3, round 1).

On "native shadows slower": in GPU time native SIGMA is faster than ours (0.96 vs 1.07 ms at 1080p,
round 1, locked clocks; ours was then v2.1). In quality it converges much slower, or not at all, on
these captures (tables below).

## Diffuse (pooled PSNR, dB)

| # | denoiser | side | std set (8) | three-orbit | three-pan | three-knot-static | three-knot-orbit |
|---|---|---|---|---|---|---|---|
| 1 | `svgf-auto` | ours | **37.80** | 39.83 | **40.39** | **42.09** | 39.82 |
| 2 | `svgf` | ours | 37.69 | **39.89** | 40.27 | 41.82 | **39.88** |
| 3 | `recurrent` | ours | 36.57 | 38.78 | 39.55 | 37.94 | 38.78 |
| 4 | `RELAX_DIFFUSE_SPECULAR` | native | 34.68 | 37.59 | 38.73 | 36.27 | 37.59 |
| 5 | `REBLUR_DIFFUSE_SPECULAR` | native | 33.63 | 32.93 | 33.18 | 32.22 | 32.93 |
| 6 | `accumulate` | ours | 21.76 | 28.53 | 26.47 | 26.61 | 28.53 |

## Specular

| # | denoiser | side | std set (8) | three-orbit | three-pan | three-knot-static | three-knot-orbit |
|---|---|---|---|---|---|---|---|
| 1 | `svgf-auto` (= `recurrent-svgfspec`) | ours | **34.24** | **45.33** | **47.58** | **45.99** | **45.26** |
| 2 | `svgf` | ours | 33.58 | 44.34 | 46.11 | 45.67 | 44.27 |
| 3 | `recurrent` | ours | 32.78 | 43.02 | 44.29 | 42.46 | 42.95 |
| 4 | `RELAX_DIFFUSE_SPECULAR` | native | 29.73 | 41.41 | 42.67 | 42.39 | 41.36 |
| 5 | `REBLUR_DIFFUSE_SPECULAR` | native | 29.69 | 39.91 | 41.65 | 40.42 | 39.95 |
| 6 | `accumulate` | ours | 22.90 | 39.28 | 37.34 | 40.83 | 39.23 |
| 7 | `ffx-reflections` | ours | 20.86 | 39.11 | 40.85 | 39.52 | 39.05 |

The real-scene and knot specular is three's SSR (not demodulated; noisy input already 33–36 dB).

## Shadows, with the dynamic region and boil

All sets at a glance (pooled):

| # | denoiser | side | std set (8) | three-orbit | three-pan | knot-static | knot-orbit | knot-still |
|---|---|---|---|---|---|---|---|---|
| 1 | `shadows` v2.2 | ours | **35.67** | **30.96** | **31.13** | **32.41** | **30.97** | **32.33** |
| 2 | `ffx-shadows` | ours | 31.42 | 26.32 | 27.86 | 28.68 | 26.34 | 28.89 |
| 3 | `accumulate` | ours | 23.67 | 25.96 | 25.73 | 28.94 | 25.96 | 27.57 |
| 4 | `SIGMA_SHADOW` | native | 22.04 | 24.93 | 25.79 | 21.50 | 24.93 | 21.47 |

Detail on the captures where shadows move:
- `dynamic` = pixels whose reference changed by > 0.05 within 4 frames.
- `boil` = RMS second temporal difference along the history ÷ √6, so lower is calmer.
- *Italics* = the reference's own boil (its noise floor).
- Full tables per capture are in `<capture>/compare.md`.

| capture | denoiser | side | pooled | penumbra | dynamic | static penumbra | boil dynamic | boil static penumbra | dyn px/frame |
|---|---|---|---|---|---|---|---|---|---|
| three-knot-static | `shadows` | ours | **32.41** | 26.61 | 19.64 | 26.81 | 0.0203 | 0.0085 | 761 |
| three-knot-static | `accumulate` | ours | 28.94 | 20.06 | 18.21 | 20.09 | 0.0369 | 0.0313 | 761 |
| three-knot-static | `ffx-shadows` | ours | 28.68 | 23.06 | 16.59 | 23.23 | 0.0395 | 0.0094 | 761 |
| three-knot-static | `SIGMA_SHADOW` | native | 21.50 | 12.53 | 8.81 | 12.60 | 0.3639 | 0.2135 | 761 |
| three-knot-static | *reference* / noisy | – | 16.85 | 7.84 | 7.45 | 7.85 | *0.0212* | *0.0049* | |
| three-knot-orbit | `shadows` | ours | **30.97** | 26.95 | 18.04 | 29.55 | 0.0489 | 0.0103 | 6913 |
| three-knot-orbit | `ffx-shadows` | ours | 26.34 | 22.67 | 15.02 | 24.05 | 0.0463 | 0.0123 | 6913 |
| three-knot-orbit | `accumulate` | ours | 25.96 | 19.96 | 15.77 | 20.13 | 0.0443 | 0.0448 | 6913 |
| three-knot-orbit | `SIGMA_SHADOW` | native | 24.93 | 17.36 | 11.95 | 18.51 | 0.2215 | 0.0968 | 6913 |
| three-knot-orbit | *reference* / noisy | – | 16.06 | 7.80 | 7.76 | 7.82 | *0.0730* | *0.0108* | |
| three-knot-still (control) | `shadows` | ours | **32.33** | 26.55 | – | 26.55 | – | 0.0096 | 0 |
| three-knot-still | `SIGMA_SHADOW` | native | 21.47 | 12.53 | – | 12.53 | – | 0.2164 | 0 |
| three-knot-still | *reference* | – | 16.79 | 7.81 | – | 7.81 | – | *0.0048* | |
| std540-object | `shadows` | ours | **33.85** | 25.96 | 22.24 | 27.08 | 0.0497 | 0.0172 | 7615 |
| std540-object | `ffx-shadows` | ours | 30.50 | 23.73 | 19.76 | 24.82 | 0.0461 | 0.0193 | 7615 |
| std540-object | `SIGMA_SHADOW` | native | 21.12 | 12.98 | 16.31 | 12.80 | 0.0939 | 0.2639 | 7615 |
| std540-object | *reference* / noisy | – | 16.61 | 8.45 | 9.15 | 8.53 | *0.0448* | *0.0026* | |
| std540-light | `shadows` | ours | **33.76** | 25.49 | 24.92 | 27.61 | 0.1930 | 0.0108 | 29431 |
| std540-light | `ffx-shadows` | ours | 29.48 | 23.33 | 23.66 | 23.74 | 0.1950 | 0.0127 | 29431 |
| std540-light | `SIGMA_SHADOW` | native | 24.74 | 15.68 | 17.04 | 16.45 | 0.2327 | 0.1616 | 29431 |
| std540-light | *reference* / noisy | – | 17.67 | 8.31 | 11.40 | 8.40 | *0.2000* | *0.0024* | |

- **Moving shadows.** `shadows` v2.2 leads in the dynamic region on every capture. Its boil
  there is at or below the reference's own on the knot captures (0.020 vs 0.021 on knot-static).
  SIGMA boils 0.09–0.36 in the dynamic region and 0.10–0.26 in static penumbrae.
- **`three-knot-orbit` and `three-orbit` score nearly the same.** Same camera path; the rotating knot
  adds a small shadow region (6913 vs 6483 dynamic px/frame).

Knot shadow strip, `three-knot-static`, frames 12 / 24 / 36 / 47. Panels: noisy | SIGMA | `shadows` |
`ffx-shadows` | reference.

![f12](three-knot-static/strip_f12_visibility.png)
![f24](three-knot-static/strip_f24_visibility.png)
![f36](three-knot-static/strip_f36_visibility.png)
![f47](three-knot-static/strip_f47_visibility.png)

## AO (pooled; real-scene captures only)

| # | denoiser | side | three-orbit | three-pan | three-knot-static | three-knot-orbit |
|---|---|---|---|---|---|---|
| 1 | `occlusion-svgf` | ours | **33.42** | **33.55** | 39.96 | **33.43** |
| 2 | `occlusion-svgf-auto` | ours | 33.10 | 33.47 | **40.42** | 33.10 |
| 3 | `occlusion-recurrent` | ours | 32.53 | 32.59 | 35.60 | 32.53 |
| – | `REBLUR_DIFFUSE_SPECULAR_OCCLUSION` | native | not comparable | not comparable | not comparable | not comparable |

There's no SO reference anywhere, and the standard set has no AO reference.

## Not done (left for the next session or the orchestrator's call)

- **P6 and P7 weren't run.** The harness supports them now:
  - `reblur-sh` / `relax-sh` read out colour, SG resolve and SH resolve as `sh-diffuse`, plus memory
    in `run.json`;
  - `sigma-translucency` gives `shadow-rgb` + `visibility`, with `--translucency-mode 0|1` for the
    two ways a translucent layer can feed the penumbra input.

  The v1 captures were stopped to hand off. A partial `v1-bumpy` is on disk; rewrite it with
  `--set=v1` before use.
- **Cost re-run at HEAD.** Round 1's locked-clock table stands (all within 2× native). Shadows moved
  v2.1 → v2.2 since; not re-timed.
- **P4's version comparison and P5** were skipped by decision (scope note in the earlier interim).
  The knot results above cover P4's moving-shadow question with current SIGMA.
- **REBLUR hit-distance sweep on diffuse / real scene** (item 1 above). Worth doing before trusting
  REBLUR's real-scene rows.

## What changed since the interim push

- `three-knot-static` (48), `three-knot-orbit` (40), `three-knot-still` (32) captured and VALID:
  25–29 s per frame on this GPU, 2048-ray visibility references.
- Native and ours at HEAD on the knot captures and `three-orbit` / `three-pan`; all scored with
  `compare.mjs` (dynamic / static / boil) and `score-captures.mjs` (AO, FLIP).
- SIGMA checks above. Harness probe switches added: `--sigma-stab`, `--viewz-positive`,
  `--light-size-scale`.
