# Native comparison, round 2 (in progress)

_Harness builder, 2026-10-26. Answers the "new scope" brief: ours at `feat/rt-denoiser-cleanroom` @ `90aa679`
(shadows v2.2), native NRD v4.18.0 (`e06852b`) with defaults, one RTX 3060 Laptop GPU (driver 592.00).
Round 1 (same captures, ours @ `7a8b980`, the locked-clock cost table, P1–P3, jitter) is
[PHASE4-5.md](PHASE4-5.md). Images, metrics, timings and build facts only. This file grows as steps
finish; each step is pushed when done._

## Scope decisions (for the orchestrator to review)

- **Not run: P4's version comparison (SIGMA v4.9.4 / v4.11.0) and P5 (ReBLUR v3.3.1 / v3.4.0).**
  Building old tags means porting the harness to older integration APIs (NRD 3.x is a substantially
  different API), about 5–9 h with a real risk the old tags don't build with today's toolchain. Ours
  already beats current native on every signal we can score, so how native changed since the 2021
  descriptions doesn't change a decision for us now. P4's useful half, current SIGMA vs our
  `shadows` v2.2 on moving shadows with the dynamic / static / boil fields, **is** run (knot captures,
  below). If a version comparison is still wanted, say which question it would answer, and it can be
  scoped to SIGMA alone.
- **P2, P3 and the jitter re-check are already answered** in [PHASE4-5.md](PHASE4-5.md) (pushed in
  `24f9f4e` on this branch; not yet merged into cleanroom, which is why TASKS still shows them open):
  - **P2:** no, input conventions don't explain native specular.
  - **P3:** the curve table is there.
  - **Jitter:** pixel units confirmed on `std540-orbit`.
- Roundtrip, the standard set and `three-orbit` / `three-pan` were captured and validated in round 1;
  the standard capture set is unchanged since, so they are reused.

## Done so far

1. Merged cleanroom @ `90aa679`; rebuilt the library (the `denoiser-realtime` type workaround is
   still needed, SETUP.md); re-applied the Windows fix to `run-realtime.mjs`.
2. Harness rebuilt (SH diffuse + translucent-shadow support for P6 / P7) and **native re-run on all
   captures with that one build**. Every native output is bit-identical to round 1's, except SIGMA:
   a last-bit rounding change in its penumbra input (the harness's position math moved into a
   function) changes its output by up to 0.015 on ~4 % of pixels (scores move ≤ 0.01 dB).
3. Ours at HEAD replayed on the whole standard set (the documented `--replay` list). One run failed
   at startup with a Chrome WebGPU device error ("valid external Instance reference no longer exists",
   under heavy GPU load) and passed on retry.
4. Everything re-scored with the new `compare.mjs` (dynamic / static / boil fields).

## Standard set (8 captures), pooled PSNR (dB)

Diffuse and specular: ours at HEAD gives the same numbers as round 1 (those denoisers didn't change);
native is unchanged. See PHASE4-5.md's tables. Shadows:

| # | denoiser | side | std set | settled (7× 540) | penumbra | 7× 960×540 | 1080p orbit |
|---|---|---|---|---|---|---|---|
| 1 | `shadows` (v2.2) | ours | **35.67** | 36.31 | 26.80 | 35.51 | 36.81 |
| 2 | `ffx-shadows` | ours | **31.42** | 29.91 | 23.77 | 30.85 | 35.40 |
| 3 | `accumulate` | ours | **23.67** | 26.51 | 15.50 | 23.55 | 24.46 |
| 4 | `SIGMA_SHADOW` | native | **22.04** | 22.05 | 12.51 | 21.92 | 22.87 |

### Shadows: dynamic region and boil (test-bed captures with moving shadows)

`dynamic` = pixels whose reference visibility changed by > 0.05 within the last 4 frames.
`boil` = RMS of the output's second temporal difference along the history ÷ √6, so lower means
calmer. The reference's own boil (its noise floor) is in italics.

| capture | denoiser | side | pooled | penumbra | dynamic | static penumbra | boil dynamic | boil static penumbra | flicker dynamic | dyn px/frame |
|---|---|---|---|---|---|---|---|---|---|---|
| std540-object | `shadows` | ours | **33.85** | 25.96 | 22.24 | 27.08 | 0.0497 | 0.0172 | 0.0447 | 7615 |
| std540-object | `ffx-shadows` | ours | **30.50** | 23.73 | 19.76 | 24.82 | 0.0461 | 0.0193 | 0.0436 | 7615 |
| std540-object | `accumulate` | ours | **21.70** | 14.75 | 7.82 | 16.44 | 0.0769 | 0.0654 | 0.1158 | 7615 |
| std540-object | `SIGMA_SHADOW` | native | **21.12** | 12.98 | 16.31 | 12.80 | 0.0939 | 0.2639 | 0.0689 | 7615 |
| std540-object | noisy input / *reference boil* | – | 16.61 | 8.45 | 9.15 | 8.53 | *0.0448* | *0.0026* | 0.3770 | 7615 |
| std540-light | `shadows` | ours | **33.76** | 25.49 | 24.92 | 27.61 | 0.1930 | 0.0108 | 0.0235 | 29431 |
| std540-light | `ffx-shadows` | ours | **29.48** | 23.33 | 23.66 | 23.74 | 0.1950 | 0.0127 | 0.0229 | 29431 |
| std540-light | `SIGMA_SHADOW` | native | **24.74** | 15.68 | 17.04 | 16.45 | 0.2327 | 0.1616 | 0.0539 | 29431 |
| std540-light | `accumulate` | ours | **13.76** | 12.07 | 5.31 | 13.18 | 0.0387 | 0.0350 | 0.1673 | 29431 |
| std540-light | noisy input / *reference boil* | – | 17.67 | 8.31 | 11.40 | 8.40 | *0.2000* | *0.0024* | 0.2070 | 29431 |
| std540-orbit | `shadows` | ours | **35.00** | 25.11 | 20.63 | 26.87 | 0.0595 | 0.0349 | 0.0459 | 5975 |
| std540-orbit | `ffx-shadows` | ours | **31.07** | 23.12 | 18.90 | 24.66 | 0.0582 | 0.0337 | 0.0526 | 5975 |
| std540-orbit | `accumulate` | ours | **25.82** | 16.10 | 16.71 | 15.92 | 0.0751 | 0.0744 | 0.0843 | 5975 |
| std540-orbit | `SIGMA_SHADOW` | native | **22.84** | 12.38 | 11.82 | 12.50 | 0.2848 | 0.2387 | 0.1824 | 5975 |
| std540-orbit | noisy input / *reference boil* | – | 18.81 | 8.29 | 7.51 | 8.48 | *0.0612* | *0.0314* | 0.4260 | 5975 |

- **Static penumbrae: native SIGMA boils hard**: 0.16–0.26, against 0.011–0.035 for `shadows` v2.2
  and a reference floor of 0.002–0.031.
- **Inside moving shadows:** `shadows` and `ffx-shadows` boil about as much as the reference itself
  (std540-light: 0.193 / 0.195 vs the reference's 0.200; std540-object: 0.050 vs 0.045). SIGMA is above
  the reference there (0.23 / 0.094).
- **SIGMA beats `accumulate` only in the dynamic region** (16.3 vs 7.8 dB on std540-object), where
  accumulation ghosts.

## Pending (in this order)

1. Knot captures `three-knot-static` (48 frames, nearly done), `three-knot-orbit` (40),
   `three-knot-still` (32). This GPU writes ~1 frame a minute, so about 1.5 h.
2. Native + ours (HEAD) on the knot captures and `three-orbit` / `three-pan`; the shadows table above
   for the knot captures; a frame strip of the knot shadow; real-scene columns of the per-signal
   tables.
3. v1 captures (`--set=v1`, 8.6 GB) and P6 (native `REBLUR_DIFFUSE_SH` / `RELAX_DIFFUSE_SH`) and P7
   (`SIGMA_SHADOW_TRANSLUCENCY`, plus `SIGMA_SHADOW` on visibility alone).
4. Same-GPU cost table on `std1080-orbit` (ours at HEAD + native, clocks locked as in round 1,
   medians and the fastest run).
