# Native comparison, phases 4–5 (interim)

_Harness builder, 2026-10-25. Native NRD v4.18.0 (`e06852b`), default settings; ours from
`feat/rt-denoiser-cleanroom` @ `7a8b980`. All on one RTX 3060 Laptop GPU (driver 592.00, D3D12;
ours through Chrome 156 / Dawn). Scores: `tools/rt-capture/compare.mjs`, ranked on pooled PSNR.
Images, metrics, timings and build facts only. Setup and script notes: [../SETUP.md](../SETUP.md)._

**Interim:** the standard set, the probes and the jitter check are complete. Still to come: the
real-scene captures (`three-orbit`, `three-pan`; being written now, slowed by thermal throttling),
their replays, the AO/SO comparison on them, and the same-GPU cost table (the 1080p timings taken
so far were under thermal throttling and are not reported).

## Ranking per signal: standard set (8 captures)

Pooled PSNR (dB): PSNR of the mean squared error over all frames and pixels of a capture; "std set" =
mean over the 8 captures. Settled = frames ≥ 8 after a reset, so only the seven 960×540 captures have
it (`std1080-orbit` has 8 frames). Per-capture tables: `<capture>/compare.md`.

### Diffuse

| # | denoiser | side | std set pooled | settled pooled (7× 540) | 7× 960×540 pooled | 1080p orbit pooled |
|---|---|---|---|---|---|---|
| 1 | `svgf-auto` | ours | **37.80** | 38.07 | 37.60 | 39.21 |
| 2 | `svgf` | ours | **37.69** | 37.87 | 37.48 | 39.15 |
| 3 | `recurrent` | ours | **36.57** | 37.47 | 36.52 | 36.96 |
| 3 | `recurrent-svgfspec` | ours | **36.57** | 37.47 | 36.52 | 36.96 |
| 5 | `RELAX_DIFFUSE_SPECULAR` | native | **34.68** | 34.48 | 34.27 | 37.55 |
| 6 | `REBLUR_DIFFUSE_SPECULAR` | native | **33.63** | 33.72 | 33.33 | 35.78 |
| 7 | `accumulate` | ours | **21.76** | 26.38 | 21.95 | 20.41 |

### Specular

| # | denoiser | side | std set pooled | settled pooled (7× 540) | 7× 960×540 pooled | 1080p orbit pooled |
|---|---|---|---|---|---|---|
| 1 | `svgf-auto` | ours | **34.24** | 34.45 | 34.13 | 34.97 |
| 1 | `recurrent-svgfspec` | ours | **34.24** | 34.45 | 34.13 | 34.97 |
| 3 | `svgf` | ours | **33.58** | 33.68 | 33.46 | 34.42 |
| 4 | `recurrent` | ours | **32.78** | 33.43 | 32.77 | 32.85 |
| 5 | `RELAX_DIFFUSE_SPECULAR` | native | **29.73** | 31.10 | 29.73 | 29.73 |
| 6 | `REBLUR_DIFFUSE_SPECULAR` | native | **29.69** | 29.99 | 29.47 | 31.23 |
| 7 | `accumulate` | ours | **22.90** | 27.30 | 23.24 | 20.48 |
| 8 | `ffx-reflections` | ours | **20.86** | 21.82 | 21.21 | 18.41 |

(`recurrent-svgfspec` = `recurrent` diffuse + `svgf-auto` specular, so the identical rows are expected.
RELAX's 29.73 twice is a coincidence: per capture 27.3–33.4.)

### Shadows (visibility)

| # | denoiser | side | std set pooled | settled pooled (7× 540) | penumbra pooled (std set) | 7× 960×540 pooled | 1080p orbit pooled |
|---|---|---|---|---|---|---|---|
| 1 | `shadows` | ours | **35.62** | 36.29 | 26.69 | 35.47 | 36.66 |
| 2 | `ffx-shadows` | ours | **31.42** | 29.91 | 23.77 | 30.85 | 35.40 |
| 3 | `accumulate` | ours | **23.67** | 26.51 | 15.50 | 23.55 | 24.46 |
| 4 | `SIGMA_SHADOW` | native | **22.04** | 22.05 | 12.51 | 21.92 | 22.87 |

Native SIGMA ranks below plain accumulation here (it beat accumulation on the synthetic plane). Its
error is almost all in the penumbrae: on `std540-orbit` frame 15, penumbra RMSE 0.243 (ours 0.053,
accumulate 0.111), lit 0.011, umbra 0.048. To rule out the harness's light conversion, the light size
given to the penumbra helper was scaled (sphere diameter × s):

| light size × | 0.5 | 1 (as reported) | 2 | 4 | 8 |
|---|---|---|---|---|---|
| `std540-orbit` pooled / penumbra pooled | 22.92 / 12.44 | 22.84 / 12.38 | 22.42 / 12.04 | 21.60 / 11.44 | 20.86 / 11.02 |

No setting helps, so the result stands as measured. Crops:
[thin](std540-thin/crop_f15_visibility.png), [light](std540-light/crop_f12_visibility.png)
(noisy | SIGMA | `shadows` | `ffx-shadows` | reference).

### AO / SO

Not scorable on the standard set: its captures have no AO/SO references (the test bed scores AO
live). On the real scene, `ao_ref` exists but is on **our** normalization curve; native occlusion
outputs are on its own (P3), so a native AO score against `ao_ref` would not be meaningful. Ours vs
`ao_ref` on the real scene follows with the real-scene replays; native AO needs references rendered on
its curve (P3 gives the data).

Crops: [glossy specular](std540-glossy/crop_f15_specular.png), [pan diffuse](std540-pan/crop_f15_diffuse.png)
(noisy | REBLUR | RELAX | `svgf-auto` | `recurrent` | reference).

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

- Range of the normalized specular hit distance the helper produced in (a), default parameters
  (3, 0.1, 20), over scored pixels of all frames: **p1 0.021, p50 0.056–0.061, p99 0.20–0.22**
  (min 0.011, max 0.28–0.29), both captures.
- (d): parameters (2, 0.08, 1) were picked by measuring the dumped range: p1 0.28, p5 0.36, p50 0.59,
  p95 0.83, p99 0.87. Gain: +0.1 dB.
- REBLUR is sensitive to hit-distance scale (shorter hits +1.6 to +2.3 dB, longer −1.6 to −1.7),
  RELAX barely (≤ 0.5 dB). Forcing roughness costs both. No variant closes the gap to ours
  (28.7–29.4 on these captures per results/M1.md §7), and on the test bed the gap persists
  (specular std set: native 29.7, ours 34.2).

## P3: native occlusion's hit-distance curve (data)

Probe captures (`harness/tools/gen-probe.mjs`): static camera facing a wall at exactly viewZ = −d,
64×64, 32 noise-free frames, constant hit distance h for both lobes, roughness 0.3 left half / 0.8
right half. Our 0 (miss) is passed as 65504. Default hit-distance parameters. Converged output at frame
31 (frame 15 is already identical). `REBLUR_DIFFUSE_OCCLUSION` + `REBLUR_SPECULAR_OCCLUSION` (separate
instances) and `REBLUR_DIFFUSE_SPECULAR_OCCLUSION` (joint) give identical values. AO does not depend on
roughness.

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

The converged output equals the normalized input given to the denoiser to within ±0.004; small values
come out on steps of 1/255 (0.0039, 0.0078, …).

## Jitter units (re-check on a test-bed capture with edges)

The test bed writes no jitter, so this tells native a jitter the capture doesn't have: Halton(2,3)
− 0.5 (±0.5 px) on the truly unjittered `std540-orbit`, given as pixels, as UV (÷ size), or not at all.

| | REBLUR diff / spec | RELAX diff / spec | SIGMA |
|---|---|---|---|
| no jitter (as captured) | 34.149 / 28.814 | 35.858 / 27.633 | 22.840 |
| false jitter, passed as UV | 34.149 / 28.814 | 35.858 / 27.633 | 22.840 |
| false jitter, passed as pixels | 34.150 / 28.813 | 35.861 / 27.625 | 22.840 |

Passing ±0.5 as pixels changes scores by ≤ 0.02 dB; if native read the value as UV, that would be
half the screen and the run would have collapsed. **Pixel units are consistent**, and the setting
barely matters on these captures (all of ours are unjittered).

## Cost (pending)

The 1080p cost table on `std1080-orbit` will be re-measured: during today's runs the GPU sat at
98–100 °C with hardware thermal slowdown active and clocks at 210 MHz (max 2100), which made our
per-frame times bimodal (e.g. `shadows` 1.6 → 5.6 ms mid-run, `svgf` 28 ↔ 65 ms). The `GPU ms`
columns in this session's `compare.md` files come from those runs: **don't use them.** The re-run
waits for the GPU to cool below 70 °C before every timed run and logs clocks and temperature
(`harness/tools/timing-1080.ps1`).
