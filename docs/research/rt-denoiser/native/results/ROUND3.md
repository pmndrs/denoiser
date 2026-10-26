# Native comparison, round 3

_Harness builder, 2026-10-26. Ours at `feat/rt-denoiser-cleanroom` @ `9b20263`; native NRD v4.18.0
(`e06852b`); one RTX 3060 Laptop GPU (driver 592.00). Images, metrics, timings and settings names
only. Steps are pushed as they finish: 1. REBLUR hit-distance sweep (done), 2. cost re-run at HEAD
(done), 3. P6 / P7._

## 1. REBLUR hit-distance sweep

`ReblurSettings.hitDistanceParameters` (A, B, C; defaults 3, 0.1, 20) varied **one at a time**, the
others at default. The harness normalizes the capture's hit distance with the same parameters (the
`NRD.hlsli` helper), so input and settings always agree. Grid:

- A: 0.01, 0.03, 0.1, 0.3, 1, 10, 30
- B: 0.01, 0.03, 0.3, 1
- C: 1 (the API's lower bound), 5, 50
- plus two combinations for specular: (0.3, 0.1, 1) and (0.1, 0.1, 1)

Coverage: the 8 standard captures and `three-orbit` / `three-pan`. Scenes differ in scale: median
|viewZ| is 8.3 m on the test bed vs 4.5 m on the real scene. The grid spans both, from A × 0.003 to
A × 10. Full per-capture tables: [reblur-sweep/diffuse.md](reblur-sweep/diffuse.md),
[reblur-sweep/specular.md](reblur-sweep/specular.md), and per-capture `*.compare.json`.

### Answer: yes, REBLUR's real-scene diffuse moves to RELAX's level, and on the test bed past it

Diffuse, pooled PSNR (dB). REBLUR at one **fixed** setting across all captures, not a per-capture best:

| | std set (8, mean) | three-orbit | three-pan |
|---|---|---|---|
| REBLUR, defaults (3, 0.1, 20) | 33.63 | 32.93 | 33.18 |
| REBLUR, A = 0.3 | 35.37 | 36.68 | 36.90 |
| REBLUR, A = 0.1 | 35.70 | 37.20 | 37.68 |
| REBLUR, A = 0.03 | 35.81 | 37.41 | 37.99 |
| **REBLUR, A = 0.01** | **35.84** | **37.49** | **38.10** |
| RELAX, defaults | 34.68 | 37.59 | 38.73 |
| ours `svgf-auto` | 37.80 | 39.83 | 40.39 |

- **Every capture improves monotonically as A shrinks**, flattening below 0.03 (0.01 adds ≤ 0.1 dB).
  Gain over default: +1.4 to +3.3 dB on the test bed, **+4.6 / +4.9 dB on the real scene**.
- **B helps only slightly** (+0.1 to +0.7 dB at B = 0.01 on diffuse); larger B hurts.
- **C has no effect on diffuse** (identical to 0.01 dB at C = 1 / 5 / 50).
- At A = 0.01, REBLUR beats RELAX on 6 of 8 standard captures and is within 0.1 / 0.6 dB of it on the
  real scene. Ours stays ahead: +2.0 dB on the standard set, +2.3 / +2.3 dB on the real scene.
- **So round 2's "REBLUR diffuse 5 dB below RELAX on the real scene" was mostly the default
  hit-distance normalization, not REBLUR itself.** That's a harness/settings effect, not a bug: the
  defaults are what the brief asked for, and they are scale-dependent.

Specular (pooled PSNR, dB):

| | std set (8, mean) | three-orbit | three-pan |
|---|---|---|---|
| REBLUR, defaults | 29.69 | 39.91 | 41.65 |
| REBLUR, A = 0.01 | 30.44 | 40.28 | 42.23 |
| REBLUR, C = 1 | 30.30 | 40.34 | 42.52 |
| REBLUR, (0.3, 0.1, 1) | 30.35 | 40.64 | **43.72** |
| REBLUR, (0.1, 0.1, 1) | 30.40 | **40.64** | 43.61 |
| RELAX, defaults | 29.73 | 41.41 | 42.67 |
| ours `svgf-auto` | 34.24 | 45.33 | 47.58 |

- Specular gains are smaller: +0.4 to +2.1 dB per capture, best with small A **and** C = 1.
- On the real scene the combined settings reach RELAX on `three-pan` and stay 0.8 dB under it on
  `three-orbit`. The gap to ours stays ~4 dB, consistent with P2.

**Which REBLUR numbers to use:** the round 1–2 tables use defaults, as briefed. For "native at its
best on our scenes", read REBLUR diffuse at A = 0.01 and specular at (0.1, 0.1, 1); the rankings
don't change. SIGMA and RELAX don't take these parameters.

## 2. Cost re-run at HEAD: same GPU, `std1080-orbit`, clocks locked

Same method as round 1 ([PHASE4-5.md](PHASE4-5.md#cost-same-gpu-std1080-orbit-clocks-locked)).
Ours was built from `9b20263` and replayed in headless Chrome; native NRD ran in the same session.
Each item started below 82 °C, with nothing else running on the GPU. Each side ran the same 50 ms
ALU warm-up before every frame. The value is the median of frames 1–7, then the median of 3 runs.
The range across runs is in brackets. Data, per-run `timings.csv` and the clock summary:
[std1080-orbit/cost-r3/](std1080-orbit/cost-r3/).

**Clock state:** all 1,118 samples (every 200 ms) taken during timed items held **1200 MHz graphics /
7151 MHz memory**, with no hardware or software thermal slowdown, at 60–68 °C. The memory clock
reads 7151 MHz this session against 7001 in round 1, with the same `-lmc 7001` request. Native
times moved < 0.2 % between rounds (RELAX aside, below), so the difference doesn't matter here.

| signals | ours | GPU ms | steady (frames 4–7) | native | GPU ms | ours / native |
|---|---|---|---|---|---|---|
| diffuse + specular | `svgf` (antiLag off) | 5.330 [5.325–5.337] | 5.308 | `REBLUR_DIFFUSE_SPECULAR` | 5.370 [5.370–5.371] | **0.99×** (RELAX: 0.77×) |
| | `svgf-auto` | 6.346 [6.051–6.369] | 6.041 | | | **1.18×** (0.91×); steady 1.14× |
| | `svgf-auto`, `youngNormalPower` = 16 | 6.363 [6.357–6.657] | 6.347 | | | **1.18×** (0.91×); steady 1.20× |
| | | | | `RELAX_DIFFUSE_SPECULAR` | 6.966 [6.966–6.967] | |
| shadows | `shadows` (v2.2, `uniformSnap` 'change') | 1.147 [1.147–1.150] | 1.147 | `SIGMA_SHADOW` | 0.960 [0.957–0.960] | **1.19×** |
| AO + SO | `occlusion-svgf` | 4.124 [4.117–4.127] | 4.109 | `REBLUR_DIFFUSE_SPECULAR_OCCLUSION` | 3.350 [3.349–3.355] | **1.23×** |
| | `occlusion-svgf-auto` | 4.591 [4.587–4.924] | 4.577 | | | **1.37×** |

Fastest run, each against native's fastest run: `svgf` 0.99×, `svgf-auto` 1.13×, ynp16 1.18×,
`shadows` 1.20×, `occlusion-svgf` 1.23×, `occlusion-svgf-auto` 1.37×. Fastest single frame:
[cost-r3/cost.json](std1080-orbit/cost-r3/cost.json) (`min`).

- **Everything is within the 2× target** (worst: `occlusion-svgf-auto`, 1.37×). REBLUR occlusion
  was not in the brief's native list. I re-timed it in the same session so the AO + SO rows compare
  same-session numbers.
- **`svgf-auto` range [6.05–6.37] is a median artifact, not a cost change.** Its per-pass times are
  identical across the three runs and match round 1 to within 0.01 ms. In every run, frames 1–3
  cost 7.0–7.6 ms and frames 4–7 cost ~6.05. So the median of frames 1–7 lands on the boundary,
  and a single 6.35 ms frame moves it. Read the steady column: 6.04 ms, against round 1's 6.09.
  The same applies to `occlusion-svgf-auto` (one run at 4.92, steady 4.58).
- **`youngNormalPower` = 16 costs +0.31 ms steady (+5 %).** All of it is in the five `atrous_*`
  passes (+0.045 to +0.068 ms each). Every other pass is unchanged.
- **`shadows` is +0.076 ms over round 1 (1.071 → 1.147).** That is exactly the new `stabilize` pass
  (0.075 ms). The `temporal`, `tiles` and `spatial*` passes match round 1 to 0.001 ms.
- **Native is unchanged from round 1** (REBLUR 5.377 → 5.370, SIGMA 0.959 → 0.960, REBLUR occlusion
  3.356 → 3.350), except RELAX. Round 1 had RELAX at 7.241 with one run at 6.975; all three runs now
  give 6.966. That moves the RELAX ratios up by ~0.03×.
- Wall time (submit to done) still adds 2–3.5 ms per frame on our side (`svgf` 7.7 ms wall, against
  REBLUR's 5.5 ms). It is not in the ratios.
