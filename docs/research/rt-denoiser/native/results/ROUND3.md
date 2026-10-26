# Native comparison, round 3

_Harness builder, 2026-10-26. Ours at `feat/rt-denoiser-cleanroom` @ `9b20263`; native NRD v4.18.0
(`e06852b`); one RTX 3060 Laptop GPU (driver 592.00). Images, metrics, timings and settings names
only. Steps are pushed as they finish: 1. REBLUR hit-distance sweep (done), 2. cost re-run at HEAD,
3. P6 / P7._

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
