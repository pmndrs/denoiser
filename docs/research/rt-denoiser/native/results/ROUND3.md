# Native comparison, round 3

_Harness builder, 2026-10-26. Ours at `feat/rt-denoiser-cleanroom` @ `9b20263`; native NRD v4.18.0
(`e06852b`); one RTX 3060 Laptop GPU (driver 592.00). Images, metrics, timings and settings names
only. Steps are pushed as they finish: 1. REBLUR hit-distance sweep (done), 2. cost re-run at HEAD
(done), 3. P6 / P7 (done)._

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

## 3. P6 / P7 on the v1 captures

The v1 set was rewritten with `node examples/realtime-denoiser/run-headless.mjs --serve --set=v1`
(5 / 5 captures validated, 8.63 GB): `v1-bumpy` (32 frames), `v1-bounce` (16), `v1-glass` (16),
`v1-glass-moving` (40) and `v1-glass-still` (16), all at 960×540 with 256-spp references. Scores
come from `compare.mjs`, with ours and native in the same table. Per-capture `compare.md` / `.json`,
native `run.json` / `timings.csv` and crops are in [v1-bumpy/](v1-bumpy/), [v1-bounce/](v1-bounce/),
[v1-glass/](v1-glass/), [v1-glass-moving/](v1-glass-moving/) and
[v1-glass-still/](v1-glass-still/). How the harness feeds these modes:
[SETUP.md](../SETUP.md#harness-additions-for-v1-captures-p6--p7).

GPU ms below are from one run each, at the same locked clocks as step 2 (1200 / 7151 MHz), with
the 50 ms warm-up. They are not the 3-run protocol from step 2. Native memory is `nrdMemoryMb` at
960×540: REBLUR-SH 30.7 MB, RELAX-SH 44.1 MB, SIGMA translucency 14.3 MB, SIGMA 9.0 MB. Our replay
doesn't measure memory.

### P6: directional (SH) diffuse, `sh-diffuse`

Pooled PSNR against `diffuse_ref` (dB). Bump = pixels whose shading and geometric normals differ by
more than 5°. Band energy = detail energy kept, against the reference: 1 = all kept, below 1 =
smoothed, above 1 = residual noise. Native has three readouts of the same run: SG colour, SG resolve
and SH resolve, both resolves at the shading normal.

| | v1-bumpy | bump | band energy | v1-bounce | GPU ms (bounce) |
|---|---|---|---|---|---|
| noisy | 16.18 | 15.62 | 48.8 | 14.65 | |
| REBLUR-SH, colour / SG / SH resolve | 31.83 / 32.10 / 26.05 | 27.88 / 29.76 / 25.64 | 0.14 / 0.25 / 0.34 | 30.16 / 30.30 / 25.80 | 0.84 |
| REBLUR-SH, A = 0.01: colour / SG / SH | **33.34** / 32.35 / 27.44 | 29.12 / 30.24 / 27.19 | 0.14 / 0.25 / 0.34 | **32.30** / 29.54 / 27.84 | 0.81 |
| RELAX-SH, colour / SG / SH resolve | 32.68 / **33.09** / 31.77 | 28.62 / **30.98** / 30.56 | 0.15 / 0.26 / 0.28 | 30.52 / 30.28 / **31.05** | 1.25 |
| ours `svgf-plain` | 35.37 | 31.57 | 1.22 | 35.53 | 0.83 |
| ours `svgf-plain-smooth` | 34.69 | 30.60 | 0.17 | 33.77 | 0.82 |
| ours `svgf-sh-auto` | **36.67** | **34.16** | 0.44 | **36.45** | 1.41 |

- **Ours leads by 3.3–4.2 dB.** `svgf-sh-auto` is 3.3 dB over native's best readout on `v1-bumpy`
  and 4.2 dB on `v1-bounce`. In the bump region it leads by 3.2 dB. `svgf-plain` is also 2.0–3.2 dB
  over native.
- **Native flattens the bump detail.** Band energy is 0.14–0.34 for every native readout, against
  0.44 for `svgf-sh-auto`. See [v1-bumpy/crops/sh-diffuse-f31.png](v1-bumpy/crops/sh-diffuse-f31.png):
  noisy, REBLUR-SH colour at A = 0.01, RELAX-SH SG, `svgf-plain`, `svgf-sh-auto`, reference.
  `svgf-plain` keeps the bumps but also leaves noise (band energy 1.22).
- **The fair plain comparison is `svgf-plain-smooth`.** It filters with `normal_geom`, as native
  does. It still leads native's best by 1.4–1.5 dB.
- **No native readout is best on both captures.** REBLUR-SH colour at A = 0.01 is native's best on
  `v1-bounce`; RELAX-SH SG resolve is native's best on `v1-bumpy`.
- **REBLUR-SH's SH resolve is 4.4–5.8 dB below its own colour readout**, with a +0.05 bias. RELAX-SH's
  SH resolve, on identical inputs and the same harness code path, is within 1 dB of its colour
  readout. I checked the harness inputs: the same public pack/unpack helpers for both, world-space
  ray directions and normals, and resolve at the shading normal as the format specifies. I found
  nothing harness-side, so I read this as a design difference, with medium confidence.
- **A = 0.01 helps REBLUR-SH's colour readout** (+1.5 / +2.1 dB), consistent with step 1, but not
  its SG resolve on `v1-bounce` (−0.8 dB).
- **Cost on `v1-bounce`** (diffuse only on both sides):
  - `svgf-sh-auto` is 1.68× REBLUR-SH and 1.13× RELAX-SH.
  - `svgf-plain` is 0.98× REBLUR-SH.
  - On `v1-bumpy`, ours also denoises `sh-specular` (2.68 / 2.04 ms), which native doesn't run
    here, so there is no ratio for it.

### P7: translucent (coloured) shadows, `shadow-rgb`

Pooled PSNR against `shadow_rgb_ref` (dB). Tint = pixels whose reference chroma exceeds 0.02.
Chroma error = mean |S/ΣS − R/ΣR|. Static penumbra boil = reference-free temporal noise in the
static penumbra; the reference's own value is in brackets.

| | v1-glass | tint | chroma err | static pen. boil | v1-glass-moving | dynamic | static pen. boil | v1-glass-still | static pen. boil | GPU ms |
|---|---|---|---|---|---|---|---|---|---|---|
| noisy (v·T) | 21.08 | 13.96 | 0.068 | | 20.47 | 12.08 | | 20.82 | | |
| SIGMA translucency, mode 0 | 29.77 | 23.84 | 0.0096 | 0.059 | 27.94 | 19.38 | 0.098 | 30.96 | 0.060 | 0.39–0.41 |
| SIGMA translucency, mode 1 | 30.18 | 25.66 | 0.0069 | 0.046 | 29.01 | 20.47 | 0.084 | 32.40 | 0.035 | 0.41–0.42 |
| ours `shadows-translucent` | **35.15** | **32.03** | **0.0034** | **0.011** (0.009) | **33.20** | **25.18** | **0.019** (0.007) | **36.87** | **0.012** (0.000) | 0.64–0.66 |

- **Ours leads by 4.2–5.0 dB on `shadow-rgb`** over SIGMA's better mode (mode 1, where the
  nearest glass layer is the occluder). It leads by 5.0–6.4 dB inside the tint region and has
  0.5–0.6× the chroma error.
- **SIGMA's static penumbra boils 3–5× more than ours.** That includes the frozen
  `v1-glass-still` (0.035, against a reference at 0.000). This is consistent with round 2's opaque
  SIGMA result (ROUND2.md, "SIGMA checks"). See
  [v1-glass-moving/crops/shadow-rgb-f39.png](v1-glass-moving/crops/shadow-rgb-f39.png) (noisy,
  mode 0, mode 1, ours, reference): mode 0 leaves blotchy, trailing tint in the moving coloured
  shadow, and mode 1 is cleaner but blurrier.
- **Exception: SIGMA mode 1 has lower dynamic boil on `v1-glass-moving`** (0.035, against ours at
  0.042 and the reference at 0.046), but it scores 4.7 dB lower PSNR in that dynamic region. It's
  smoother than the reference there and further from it.
- **Opaque part (`visibility` against `visibility_ref`):** SIGMA scores 29.89 / 28.27 / 32.08 and
  ours 35.48 / 32.90 / 38.04. Mode 0's `.x` is identical to opaque SIGMA. Mode 1's `.x` counts the
  glass as an occluder, so it isn't comparable with the opaque reference (11–13 dB) and isn't
  ranked.
- **Cost:** ours is 1.54–1.61× SIGMA translucency, within the 2× target.
- **Harness fix this round:** the translucency input is now v·T. The first runs passed T alone,
  which our format sets to 1 in umbra (scores were 11–13 dB with a +0.2 bias). Only the fixed
  build's results are above. Details are in [SETUP.md](../SETUP.md#harness-additions-for-v1-captures-p6--p7).
