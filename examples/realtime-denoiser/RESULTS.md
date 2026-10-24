# Real-time denoiser test bed: baseline results

Baselines for the clean-room `denoiser/realtime` work (T0.3): what the noisy input, plain
temporal accumulation and the FidelityFX WGSL ports score on every signal and stress
path. Later denoisers (SVGF, recurrent) are measured against these rows.

## How to run

```sh
yarn workspace realtime-denoiser dev                      # http://127.0.0.1:5220/
cd examples/realtime-denoiser
node run-headless.mjs "signal=all&path=pan&mode=eval"     # fast preset: 960x540, ~25 s/path
node run-headless.mjs --all-paths --json=out/full.json "signal=all&mode=eval&preset=full"
node run-headless.mjs "signal=shadows&denoiser=ffx-shadows&mode=bench&preset=full"
node results-table.mjs out/full.json                      # the tables below
```

URL options are listed at the top of `src/main.ts`. `noise=inject` replaces the traced
noise by noise drawn around the reference (Bernoulli for visibility, mean-1 multiplicative
Gamma noise + fireflies for RGB), so the reference is the exact expectation: use it for
quick correctness checks of a denoiser's math.

## What is measured

- **Signals** (demodulated, linear HDR; `src/scene.ts` documents every estimator):
  diffuse = cosine-sampled one-bounce GI (hit shaded by the sphere light with one shadow
  ray + sky ambient; misses see the sky), specular = GGX VNDF sample × F × G1(L) divided
  by Karis 2014's analytic env-BRDF (`f0·A + B`, CAPTURE-FORMAT v0), shadows = one ray
  into the sphere light's cone (fractional reference visibility). References: the same
  estimator, 256 spp (stratified 16×16 grid), every frame.
- **Paths** (`src/paths.ts`, 96 frames each): `orbit` slow orbit; `pan` fast low truck +
  yaw (disocclusion every frame); `light` static camera, light orbits, flips side at frame
  48, shrinks at 72 (anti-lag); `thin` the 4 cm fence slats and their shadows; `glossy`
  low over the glossy floor; `cut` camera cut at 48 (reset); `object` static camera,
  bouncing sphere (object motion, `motion_z`).
- **Metrics** (`src/metrics.ts`, `src/flip.ts`), all on receivers (depth < 1):
  - PSNR on the tonemapped value (Reinhard x/(1+x) per channel; visibility clamped), mean
    of per-frame dB; *settled* skips 8 frames after each reset.
  - Regions, pooled over the path: *penumbra* (0.02 < reference visibility < 0.98),
    *disocc.* (pixels with < 8 frames of valid history by ground-truth reprojection,
    excluding the 8 frames after a reset), *after cut* (the reset frame of `cut`),
    specular roughness bins.
  - FLIP: LDR-FLIP (paper + NVlabs/flip BSD-3 reference) on the tonemapped images, every
    12th frame, at a resolution-scaled viewing condition (image spans 46.4°: ~41 ppd at
    1080p; `&ppd=67` for FLIP's standard condition). Lower is better.
  - flicker: mean |s_t − s_{t−1}| at a fixed pixel, s = channel-mean signed error (the
    definition of `examples/ffx-denoiser` and `tools/rt-capture/compare.mjs`).
  - tPSNR: motion-compensated temporal PSNR, −10 log10 mean (e_t − e_{t−1})², previous
    error fetched at the reprojected pixel, valid-history pixels only.
  - bias: mean signed tonemapped error (penumbra pixels for shadows). Tonemapping is
    concave, so even an unbiased input reads negative here; **energy** (Σ linear luminance
    out / Σ reference − 1) is the energy-conservation number.
  - GPU ms: the denoiser's own `gpuTimings` (timestamp queries), median over the eval.

## Baseline, 1080p (2026-10-25, Apple M5 Pro, Chrome headless, Metal)

Run: `node run-headless.mjs --all-paths "signal=all&mode=eval&preset=full"` at commit
0047bfb (test-bed code unchanged since). No other agent's headless job was running before
or after the runs (checked with `ps`), so timings are **uncontended**, but the eval's GPU
ms are taken while the test bed itself renders 256-spp references between dispatches; use
the solo bench below for cost. `accumulate` = 32-frame cap. FFX reflections only consumes
specular; diffuse has no FFX row. "–" = region empty on that path (no disocclusion with
a static camera, no cut).

_1920x1080, 96 frames/path, reference 256 spp, FLIP every 12 frames at 41.38 ppd, disoccluded = < 8 frames of valid history._

### diffuse

| path | denoiser | PSNR | settled | disocc. | after cut | FLIP | flicker | tPSNR | bias | energy | GPU ms |
|---|---|---|---|---|---|---|---|---|---|---|---|
| orbit | passthrough | 16.49 | 16.50 | 16.20 | – | 0.316 | 0.1001 | 14.55 | -0.0616 | -0.0% | – |
| orbit | accumulate | 28.35 | 29.01 | 20.34 | – | 0.081 | 0.0297 | 29.21 | -0.0052 | -0.6% | – |
| pan | passthrough | 16.03 | 16.11 | 16.20 | – | 0.325 | 0.1169 | 14.11 | -0.0654 | -0.0% | – |
| pan | accumulate | 24.61 | 25.00 | 19.33 | – | 0.123 | 0.0529 | 25.59 | -0.0101 | -0.3% | – |
| light | passthrough | 16.35 | 16.34 | – | – | 0.324 | 0.0997 | 14.42 | -0.0637 | -0.1% | – |
| light | accumulate | 25.54 | 26.18 | – | – | 0.104 | 0.0070 | 33.52 | -0.0076 | -0.5% | – |
| thin | passthrough | 16.82 | 16.83 | 17.18 | – | 0.291 | 0.1039 | 14.69 | -0.0535 | -0.1% | – |
| thin | accumulate | 28.37 | 28.99 | 21.51 | – | 0.082 | 0.0284 | 28.11 | -0.0039 | -0.6% | – |
| glossy | passthrough | 16.64 | 16.64 | 15.71 | – | 0.288 | 0.1143 | 14.40 | -0.0490 | -0.0% | – |
| glossy | accumulate | 32.29 | 33.23 | 19.70 | – | 0.065 | 0.0196 | 31.13 | -0.0035 | -0.7% | – |
| cut | passthrough | 14.57 | 14.51 | 16.19 | 13.40 | 0.373 | 0.1293 | 12.79 | -0.0896 | -0.1% | – |
| cut | accumulate | 26.91 | 28.30 | 20.35 | 13.40 | 0.096 | 0.0414 | 26.91 | -0.0077 | -0.4% | – |
| object | passthrough | 16.25 | 16.25 | 15.83 | – | 0.313 | 0.1064 | 14.28 | -0.0615 | -0.1% | – |
| object | accumulate | 24.98 | 25.56 | 18.51 | – | 0.108 | 0.0082 | 32.86 | -0.0091 | -0.9% | – |

### specular

| path | denoiser | PSNR | settled | disocc. | after cut | FLIP | flicker | tPSNR | bias | energy | GPU ms |
|---|---|---|---|---|---|---|---|---|---|---|---|
| orbit | passthrough | 13.90 | 13.92 | 12.65 | – | 0.247 | 0.1435 | 12.30 | -0.0703 | -0.0% | – |
| orbit | accumulate | 21.35 | 21.22 | 18.13 | – | 0.152 | 0.0247 | 27.38 | 0.0082 | 4.9% | – |
| orbit | ffx-reflections | 18.13 | 18.10 | 15.25 | – | 0.198 | 0.0174 | 30.69 | -0.0658 | -27.8% | 1.86 |
| pan | passthrough | 19.10 | 19.22 | 19.82 | – | 0.160 | 0.0917 | 16.60 | -0.0233 | -0.0% | – |
| pan | accumulate | 25.92 | 26.21 | 24.31 | – | 0.127 | 0.0372 | 28.34 | -0.0063 | -3.6% | – |
| pan | ffx-reflections | 27.47 | 27.83 | 28.91 | – | 0.102 | 0.0250 | 33.42 | -0.0185 | -11.4% | 1.55 |
| light | passthrough | 13.79 | 13.78 | – | – | 0.261 | 0.1437 | 12.24 | -0.0741 | -0.0% | – |
| light | accumulate | 26.97 | 27.68 | – | – | 0.076 | 0.0062 | 33.18 | -0.0037 | -0.4% | – |
| light | ffx-reflections | 18.07 | 18.04 | – | – | 0.214 | 0.0015 | 47.35 | -0.0741 | -28.3% | 2.33 |
| thin | passthrough | 17.05 | 17.08 | 19.96 | – | 0.190 | 0.0996 | 15.11 | -0.0340 | -0.1% | – |
| thin | accumulate | 26.90 | 27.20 | 25.09 | – | 0.093 | 0.0179 | 30.43 | -0.0082 | -6.8% | – |
| thin | ffx-reflections | 21.29 | 21.24 | 26.45 | – | 0.133 | 0.0103 | 33.30 | -0.0340 | -21.8% | 2.30 |
| glossy | passthrough | 17.02 | 16.86 | 15.60 | – | 0.218 | 0.0999 | 14.90 | -0.0373 | -0.1% | – |
| glossy | accumulate | 23.34 | 23.15 | 22.42 | – | 0.141 | 0.0132 | 31.28 | -0.0208 | -21.0% | – |
| glossy | ffx-reflections | 21.85 | 21.44 | 20.97 | – | 0.155 | 0.0054 | 32.37 | -0.0366 | -26.0% | 1.98 |
| cut | passthrough | 16.29 | 16.24 | 13.41 | 19.35 | 0.208 | 0.1134 | 13.76 | -0.0505 | -0.0% | – |
| cut | accumulate | 24.24 | 24.30 | 18.94 | 19.35 | 0.124 | 0.0248 | 27.69 | 0.0014 | 5.3% | – |
| cut | ffx-reflections | 21.25 | 21.03 | 16.39 | 26.54 | 0.159 | 0.0143 | 31.83 | -0.0458 | -25.5% | 2.09 |
| object | passthrough | 14.46 | 14.46 | 17.99 | – | 0.242 | 0.1311 | 12.75 | -0.0594 | -0.0% | – |
| object | accumulate | 26.72 | 27.36 | 21.39 | – | 0.073 | 0.0068 | 32.96 | -0.0057 | -1.1% | – |
| object | ffx-reflections | 19.38 | 19.37 | 24.41 | – | 0.164 | 0.0026 | 41.71 | -0.0531 | -25.2% | 2.25 |

Specular PSNR by roughness bin (pooled over the path):

| path | denoiser | r<0.15 | r<0.35 | r<0.6 | r≥0.6 |
|---|---|---|---|---|---|
| orbit | passthrough | 28.72 | 15.67 | 11.52 | 13.10 |
| orbit | accumulate | 20.28 | 20.76 | 20.26 | 23.68 |
| orbit | ffx-reflections | 29.07 | 21.56 | 15.43 | 17.55 |
| pan | passthrough | 32.10 | 20.92 | 15.88 | 12.54 |
| pan | accumulate | 26.60 | 25.53 | 22.93 | 20.38 |
| pan | ffx-reflections | 37.53 | 31.04 | 21.96 | 17.06 |
| light | passthrough | 29.01 | 15.45 | 11.43 | 13.36 |
| light | accumulate | 33.23 | 26.97 | 23.22 | 23.55 |
| light | ffx-reflections | 32.34 | 21.73 | 15.28 | 17.39 |
| thin | passthrough | 31.67 | 18.28 | 13.91 | 14.77 |
| thin | accumulate | 40.82 | 25.94 | 23.99 | 21.49 |
| thin | ffx-reflections | 41.43 | 25.10 | 17.41 | 24.33 |
| glossy | passthrough | 27.93 | 15.97 | 17.43 | 12.94 |
| glossy | accumulate | 24.03 | 18.94 | 27.60 | 26.07 |
| glossy | ffx-reflections | 26.74 | 19.02 | 24.72 | 17.39 |
| cut | passthrough | 29.42 | 17.05 | 12.57 | 11.91 |
| cut | accumulate | 22.94 | 22.58 | 21.60 | 22.43 |
| cut | ffx-reflections | 31.50 | 23.84 | 17.17 | 15.03 |
| object | passthrough | 26.64 | 14.80 | 13.22 | 11.01 |
| object | accumulate | 32.84 | 27.24 | 23.63 | 21.74 |
| object | ffx-reflections | 30.44 | 20.64 | 18.58 | 12.73 |

### shadows

| path | denoiser | PSNR | settled | penumbra | disocc. | FLIP | flicker | tPSNR | bias | energy | GPU ms |
|---|---|---|---|---|---|---|---|---|---|---|---|
| orbit | passthrough | 18.02 | 17.96 | 7.99 | 17.15 | 0.042 | 0.0387 | 14.88 | 0.0001 | 0.0% | – |
| orbit | accumulate | 28.02 | 28.20 | 19.12 | 23.40 | 0.026 | 0.0123 | 29.99 | -0.0134 | -0.2% | – |
| orbit | ffx-shadows | 30.59 | 30.26 | 22.51 | 33.09 | 0.034 | 0.0086 | 35.48 | -0.0427 | -0.5% | 0.50 |
| pan | passthrough | 36.05 | 37.70 | 8.27 | 16.71 | 0.043 | 0.0498 | 15.00 | 0.0000 | 0.0% | – |
| pan | accumulate | 35.41 | 36.24 | 16.80 | 21.31 | 0.023 | 0.0155 | 27.49 | -0.0030 | -0.0% | – |
| pan | ffx-shadows | 48.70 | 50.12 | 25.13 | 34.47 | 0.034 | 0.0093 | 37.67 | -0.0334 | -0.4% | 0.53 |
| light | passthrough | 19.33 | 19.45 | 8.11 | – | 0.035 | 0.0273 | 15.82 | 0.0001 | 0.0% | – |
| light | accumulate | 17.83 | 17.32 | 11.37 | – | 0.152 | 0.0061 | 26.55 | 0.1382 | 6.3% | – |
| light | ffx-shadows | 28.52 | 28.05 | 19.98 | – | 0.046 | 0.0019 | 38.71 | -0.0028 | -0.1% | 0.63 |
| thin | passthrough | 16.08 | 16.09 | 8.41 | 16.64 | 0.062 | 0.0558 | 13.07 | 0.0002 | 0.0% | – |
| thin | accumulate | 27.36 | 27.68 | 20.10 | 23.09 | 0.032 | 0.0137 | 28.74 | -0.0137 | -0.3% | – |
| thin | ffx-shadows | 29.80 | 29.53 | 23.95 | 32.01 | 0.051 | 0.0091 | 34.03 | -0.0364 | -0.8% | 0.78 |
| glossy | passthrough | 18.05 | 17.93 | 7.96 | 16.04 | 0.047 | 0.0353 | 14.90 | -0.0001 | 0.0% | – |
| glossy | accumulate | 36.69 | 37.48 | 24.25 | 22.16 | 0.015 | 0.0036 | 35.85 | -0.0036 | -0.1% | – |
| glossy | ffx-shadows | 32.66 | 32.52 | 23.68 | 27.85 | 0.030 | 0.0021 | 42.03 | -0.0489 | -0.8% | 0.58 |
| cut | passthrough | 18.26 | 18.23 | 8.06 | 16.99 | 0.041 | 0.0354 | 15.26 | 0.0001 | 0.0% | – |
| cut | accumulate | 28.77 | 29.29 | 18.88 | 23.00 | 0.020 | 0.0107 | 29.86 | -0.0069 | -0.2% | – |
| cut | ffx-shadows | 32.02 | 31.69 | 23.46 | 33.27 | 0.031 | 0.0064 | 36.70 | -0.0406 | -0.6% | 0.57 |
| object | passthrough | 16.80 | 16.79 | 8.46 | 14.73 | 0.059 | 0.0436 | 13.79 | 0.0002 | 0.0% | – |
| object | accumulate | 21.87 | 21.93 | 17.09 | 17.77 | 0.041 | 0.0057 | 30.99 | 0.0056 | -0.6% | – |
| object | ffx-shadows | 31.28 | 31.12 | 24.21 | 29.30 | 0.040 | 0.0021 | 39.38 | -0.0382 | -0.8% | 0.75 |

### Cost (solo bench, 1080p, 100 frames after 20 warm-up, one denoiser per page)

| signal | denoiser | GPU ms (median) | passes (median ms) | wall ms |
|---|---|---|---|---|
| shadows | ffx-shadows | 0.50 | prepare 0.07 · tile_classification 0.14 · filter_0 0.10 · filter_1 0.09 · filter_2 0.10 | 0.9 |
| specular | ffx-reflections | 1.85 | prepare 0.06 · reproject 0.77 · prefilter 0.41 · resolve_temporal 0.61 | 2.3 |
| any | accumulate | (no timestamps) | 1 pass | 0.5 |

### What the baseline shows

- **Specular is where the work is.** Plain accumulation (surface reprojection) *hurts*
  near-mirror pixels (r < 0.15: 28.7 → 20.3 dB on `orbit`) and ghosts highlights
  (`orbit` +4.9 % energy, `glossy` −21 %); FFX reflections is sharp on smooth surfaces but
  loses 11–28 % energy (firefly suppression) and is weak for r ≥ 0.35. Neither handles
  the 0.35–0.8 range: virtual-motion reprojection and lobe-sized kernels (SPEC §M3) have
  clear room.
- **Anti-lag**: on `light`, accumulation goes *below* the noisy input for shadows
  (17.8 vs 19.3 dB, +6.3 % energy, FLIP 0.152 vs 0.035) after the light flips; FFX
  shadows recovers (28.5 dB).
- **Disocclusion**: accumulation's disoccluded pixels sit 6–14 dB under its settled PSNR
  on every signal (no spatial fallback); FFX shadows' spatial filter keeps them at
  28–34 dB.
- **Shadows**: FFX shadows wins PSNR everywhere except `glossy` (smooth large shadows,
  where 32-frame accumulation reaches 36.7 dB) but carries a −0.03…−0.05 penumbra bias
  (it thresholds visibility to binary) and its FLIP is *worse* than accumulation's on
  every path but `light`: it smears penumbrae (visible in view mode). `pan` frames mostly lit
  surfaces, hence its high PSNR for every row.
- **FLIP vs PSNR** disagree for shadows (see above) and for 1-px dither in general; keep
  both in result tables.

### Provisional

- White-noise sampling (PCG per pixel and frame); blue noise is a later option (TASKS).
- 256-spp references still carry residual noise: the PSNR ceiling is roughly the
  reference's own error (≈ 35–45 dB depending on signal); differences above ~40 dB are
  not meaningful.
- `pixelsPerFrame` in the JSON regions is averaged over all frames of the path,
  including frames where the region is empty.
