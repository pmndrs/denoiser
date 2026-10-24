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

URL options are listed at the top of `src/main.ts`. Captures of test-bed frames (and
replaying them) are in [CAPTURES.md](CAPTURES.md). `noise=inject` replaces the traced
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
  - Three ways to average PSNR over a path (every result has all three; the old names keep
    the per-frame mean, so older tables stay comparable):
    - *per-frame mean* (`psnrDen`, `psnrDenSettled`): mean of per-frame dB. A frame with
      (almost) no error scores up to 120 dB (MSE floor 1e-12), so a few near-empty frames
      decide the mean: on `pan` the last 17 frames show no shadow, every output that
      returns exactly 1 scores 120 dB there, and the shadows mean reads 52.6 dB.
    - *pooled* (`psnrDenPooled`, `psnrDenSettledPooled`, `psnrNoisyPooled`): PSNR of the
      mean MSE, 10·log10(1 / (Σ squared error / Σ scored values)) over all frames (or the
      settled ones) and pixels. Every pixel-frame weighs the same. **Rank denoisers on this
      one.**
    - *capped* (`psnrDenCapped`, `psnrDenSettledCapped`, `psnrNoisyCapped`): mean of
      per-frame dB after clipping each frame at 60 dB (`psnrCapDb`; RMS error 0.001).
    - Regions (`regions.<name>`): `psnrDen` there was always pooled (= `psnrDenPooled`);
      `psnrDenMean` / `psnrDenCapped` are the per-frame mean and capped mean (frames where
      the region is empty skipped). `results-table.mjs` prints all three in a second table;
      the replay side (`tools/rt-capture/compare.mjs`) uses the same definitions
      (CAPTURE-FORMAT.md "Metrics for replay outputs").
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

## Baseline, 1080p (re-measured 2026-10-25 for T1.5, Apple M5 Pro, Chrome 155 headless, Metal)

Run: `node run-headless.mjs --all-paths "signal=all&mode=eval&preset=full&denoiser=passthrough,accumulate-32,ffx-shadows,ffx-reflections,svgf,svgf-auto"`
with the **blue-noise sampler** (`sampling=blue`, now the default; `src/bluenoise.ts`).
SVGF rows, the parameter sweep and solo costs are in
[docs/research/rt-denoiser/results/M1.md](../../docs/research/rt-denoiser/results/M1.md);
this file keeps the baseline rows. Since the first baseline: `accumulate` is now the
registry's `accumulate-32` (same shader), beyond-far geometry is sky in the guides, and the
sampler changed. With `sampling=white` the old tables reproduce exactly (e.g. accumulate
orbit diffuse 28.35 dB); blue noise leaves the noisy input's PSNR unchanged (±0.01 dB),
lifts accumulate-32 by +1.35 dB diffuse on average (+4.5 dB on the static-camera `light`
path: per-pixel low-discrepancy sequences over time), FFX shadows by +0.2 dB, FFX
reflections by −0.09 dB (M1.md §2). The "GPU ms" column was **contended** (other headless
jobs ran at the same time); use the solo bench below. FFX reflections only consumes
specular; diffuse has no FFX row. "–" = region empty on that path.

_1920x1080, 96 frames/path, reference 256 spp, FLIP every 12 frames at 41.38 ppd, disoccluded = < 8 frames of valid history._

### diffuse

| path | denoiser | PSNR | settled | disocc. | after cut | FLIP | flicker | tPSNR | bias | energy | GPU ms |
|---|---|---|---|---|---|---|---|---|---|---|---|
| orbit | passthrough | 16.49 | 16.50 | 16.20 | – | 0.296 | 0.1055 | 14.53 | -0.0615 | -0.0% | – |
| orbit | accumulate-32 | 28.63 | 29.29 | 20.47 | – | 0.071 | 0.0293 | 29.16 | -0.0049 | -0.5% | – |
| pan | passthrough | 16.03 | 16.11 | 16.20 | – | 0.305 | 0.1219 | 14.11 | -0.0654 | -0.0% | – |
| pan | accumulate-32 | 24.89 | 25.28 | 19.46 | – | 0.108 | 0.0518 | 25.52 | -0.0098 | -0.3% | – |
| light | passthrough | 16.34 | 16.34 | – | – | 0.304 | 0.1055 | 14.01 | -0.0637 | -0.0% | – |
| light | accumulate-32 | 30.09 | 31.08 | – | – | 0.066 | 0.0076 | 32.82 | -0.0043 | -0.4% | – |
| thin | passthrough | 16.82 | 16.83 | 17.18 | – | 0.276 | 0.1081 | 14.68 | -0.0535 | -0.0% | – |
| thin | accumulate-32 | 28.63 | 29.26 | 21.67 | – | 0.073 | 0.0281 | 28.08 | -0.0036 | -0.6% | – |
| glossy | passthrough | 16.64 | 16.64 | 15.72 | – | 0.266 | 0.1205 | 14.39 | -0.0490 | -0.0% | – |
| glossy | accumulate-32 | 32.70 | 33.66 | 19.88 | – | 0.058 | 0.0193 | 31.09 | -0.0034 | -0.7% | – |
| cut | passthrough | 14.57 | 14.51 | 16.19 | 13.41 | 0.350 | 0.1382 | 12.78 | -0.0895 | -0.0% | – |
| cut | accumulate-32 | 27.39 | 28.80 | 20.48 | 13.41 | 0.080 | 0.0405 | 26.85 | -0.0072 | -0.4% | – |
| object | passthrough | 16.25 | 16.25 | 15.83 | – | 0.294 | 0.1122 | 13.97 | -0.0615 | -0.0% | – |
| object | accumulate-32 | 28.19 | 29.01 | 18.98 | – | 0.075 | 0.0086 | 32.30 | -0.0062 | -0.9% | – |

### specular

| path | denoiser | PSNR | settled | disocc. | after cut | FLIP | flicker | tPSNR | bias | energy | GPU ms |
|---|---|---|---|---|---|---|---|---|---|---|---|
| orbit | passthrough | 13.90 | 13.92 | 12.65 | – | 0.228 | 0.1524 | 12.30 | -0.0703 | -0.0% | – |
| orbit | accumulate-32 | 21.43 | 21.27 | 18.28 | – | 0.149 | 0.0242 | 27.36 | 0.0084 | 4.9% | – |
| orbit | ffx-reflections | 17.93 | 17.88 | 15.13 | – | 0.201 | 0.0166 | 30.90 | -0.0676 | -28.6% | 2.01 |
| pan | passthrough | 19.10 | 19.22 | 19.82 | – | 0.141 | 0.0949 | 16.60 | -0.0233 | -0.1% | – |
| pan | accumulate-32 | 26.03 | 26.31 | 24.43 | – | 0.122 | 0.0368 | 28.27 | -0.0062 | -3.6% | – |
| pan | ffx-reflections | 27.44 | 27.79 | 28.96 | – | 0.102 | 0.0247 | 33.52 | -0.0185 | -11.5% | 3.83 |
| light | passthrough | 13.79 | 13.78 | – | – | 0.242 | 0.1538 | 11.88 | -0.0742 | -0.0% | – |
| light | accumulate-32 | 28.72 | 29.43 | – | – | 0.064 | 0.0064 | 32.81 | -0.0020 | -0.4% | – |
| light | ffx-reflections | 18.00 | 17.96 | – | – | 0.215 | 0.0014 | 47.84 | -0.0748 | -28.6% | 3.12 |
| thin | passthrough | 17.05 | 17.08 | 19.96 | – | 0.172 | 0.1046 | 15.10 | -0.0340 | -0.0% | – |
| thin | accumulate-32 | 27.01 | 27.29 | 25.25 | – | 0.090 | 0.0177 | 30.40 | -0.0082 | -6.8% | – |
| thin | ffx-reflections | 21.20 | 21.15 | 26.45 | – | 0.134 | 0.0102 | 33.38 | -0.0344 | -22.0% | 4.03 |
| glossy | passthrough | 17.02 | 16.86 | 15.63 | – | 0.200 | 0.1034 | 14.89 | -0.0373 | -0.0% | – |
| glossy | accumulate-32 | 23.40 | 23.19 | 22.59 | – | 0.138 | 0.0129 | 31.25 | -0.0207 | -21.0% | – |
| glossy | ffx-reflections | 21.79 | 21.37 | 20.86 | – | 0.157 | 0.0051 | 32.44 | -0.0369 | -26.4% | 5.24 |
| cut | passthrough | 16.29 | 16.24 | 13.42 | 19.36 | 0.190 | 0.1198 | 13.76 | -0.0505 | -0.0% | – |
| cut | accumulate-32 | 24.36 | 24.38 | 19.10 | 19.36 | 0.120 | 0.0243 | 27.66 | 0.0016 | 5.3% | – |
| cut | ffx-reflections | 21.16 | 20.93 | 16.18 | 26.63 | 0.161 | 0.0138 | 32.02 | -0.0466 | -26.0% | 3.37 |
| object | passthrough | 14.46 | 14.46 | 17.99 | – | 0.223 | 0.1382 | 12.48 | -0.0594 | -0.0% | – |
| object | accumulate-32 | 27.66 | 28.29 | 21.97 | – | 0.065 | 0.0070 | 32.71 | -0.0047 | -1.1% | – |
| object | ffx-reflections | 19.28 | 19.25 | 24.42 | – | 0.165 | 0.0025 | 41.88 | -0.0539 | -25.6% | 4.30 |

Specular PSNR by roughness bin (pooled over the path):

| path | denoiser | r<0.15 | r<0.35 | r<0.6 | r≥0.6 |
|---|---|---|---|---|---|
| orbit | passthrough | 28.72 | 15.67 | 11.52 | 13.10 |
| orbit | accumulate-32 | 20.29 | 20.79 | 20.34 | 23.83 |
| orbit | ffx-reflections | 29.05 | 21.24 | 15.23 | 17.52 |
| pan | passthrough | 32.08 | 20.92 | 15.88 | 12.54 |
| pan | accumulate-32 | 26.61 | 25.58 | 23.04 | 20.62 |
| pan | ffx-reflections | 37.50 | 30.94 | 21.92 | 17.07 |
| light | passthrough | 29.00 | 15.45 | 11.43 | 13.37 |
| light | accumulate-32 | 33.30 | 28.47 | 24.80 | 24.18 |
| light | ffx-reflections | 32.30 | 21.65 | 15.21 | 17.36 |
| thin | passthrough | 31.67 | 18.28 | 13.91 | 14.77 |
| thin | accumulate-32 | 40.91 | 25.98 | 24.12 | 21.62 |
| thin | ffx-reflections | 41.48 | 24.93 | 17.34 | 24.27 |
| glossy | passthrough | 27.91 | 15.97 | 17.43 | 12.94 |
| glossy | accumulate-32 | 24.03 | 18.96 | 27.68 | 26.30 |
| glossy | ffx-reflections | 26.73 | 18.92 | 24.65 | 17.37 |
| cut | passthrough | 29.42 | 17.06 | 12.57 | 11.91 |
| cut | accumulate-32 | 22.94 | 22.62 | 21.73 | 22.64 |
| cut | ffx-reflections | 31.48 | 23.69 | 17.00 | 15.01 |
| object | passthrough | 26.65 | 14.80 | 13.22 | 11.02 |
| object | accumulate-32 | 33.02 | 28.37 | 24.46 | 22.62 |
| object | ffx-reflections | 30.43 | 20.54 | 18.43 | 12.71 |

### shadows

| path | denoiser | PSNR | settled | penumbra | disocc. | FLIP | flicker | tPSNR | bias | energy | GPU ms |
|---|---|---|---|---|---|---|---|---|---|---|---|
| orbit | passthrough | 18.02 | 17.96 | 8.00 | 17.15 | 0.034 | 0.0476 | 14.88 | 0.0001 | 0.0% | – |
| orbit | accumulate-32 | 28.13 | 28.29 | 19.26 | 23.55 | 0.025 | 0.0125 | 29.93 | -0.0133 | -0.2% | – |
| orbit | ffx-shadows | 30.80 | 30.38 | 22.74 | 34.40 | 0.034 | 0.0083 | 35.95 | -0.0424 | -0.5% | 0.59 |
| pan | passthrough | 36.00 | 37.65 | 8.27 | 16.71 | 0.036 | 0.0530 | 15.00 | 0.0002 | 0.0% | – |
| pan | accumulate-32 | 35.65 | 36.46 | 16.96 | 21.43 | 0.020 | 0.0154 | 27.36 | -0.0029 | -0.0% | – |
| pan | ffx-shadows | 49.09 | 50.46 | 25.79 | 36.28 | 0.033 | 0.0087 | 39.35 | -0.0333 | -0.4% | 2.32 |
| light | passthrough | 19.33 | 19.45 | 8.11 | – | 0.029 | 0.0364 | 14.50 | 0.0001 | 0.0% | – |
| light | accumulate-32 | 18.20 | 17.53 | 11.60 | – | 0.151 | 0.0061 | 26.49 | 0.1380 | 6.3% | – |
| light | ffx-shadows | 28.49 | 27.91 | 19.77 | – | 0.047 | 0.0016 | 39.62 | -0.0008 | -0.1% | 0.90 |
| thin | passthrough | 16.08 | 16.09 | 8.41 | 16.63 | 0.054 | 0.0641 | 13.07 | 0.0003 | 0.0% | – |
| thin | accumulate-32 | 27.48 | 27.79 | 20.24 | 23.26 | 0.030 | 0.0137 | 28.70 | -0.0135 | -0.3% | – |
| thin | ffx-shadows | 30.00 | 29.64 | 24.19 | 33.05 | 0.051 | 0.0087 | 34.39 | -0.0358 | -0.7% | 1.09 |
| glossy | passthrough | 18.05 | 17.93 | 7.96 | 16.04 | 0.038 | 0.0484 | 14.86 | 0.0000 | 0.0% | – |
| glossy | accumulate-32 | 37.23 | 38.01 | 24.65 | 22.48 | 0.014 | 0.0040 | 35.62 | -0.0033 | -0.1% | – |
| glossy | ffx-shadows | 32.82 | 32.61 | 23.85 | 28.43 | 0.030 | 0.0019 | 43.10 | -0.0487 | -0.8% | 1.77 |
| cut | passthrough | 18.26 | 18.23 | 8.06 | 16.98 | 0.034 | 0.0447 | 15.24 | 0.0001 | 0.0% | – |
| cut | accumulate-32 | 29.01 | 29.50 | 19.08 | 23.18 | 0.018 | 0.0110 | 29.77 | -0.0069 | -0.2% | – |
| cut | ffx-shadows | 32.30 | 31.81 | 23.76 | 34.71 | 0.031 | 0.0060 | 37.49 | -0.0408 | -0.6% | 0.98 |
| object | passthrough | 16.80 | 16.79 | 8.46 | 14.74 | 0.050 | 0.0543 | 12.80 | 0.0001 | 0.0% | – |
| object | accumulate-32 | 22.29 | 22.27 | 18.03 | 18.80 | 0.036 | 0.0058 | 30.75 | 0.0056 | -0.6% | – |
| object | ffx-shadows | 31.47 | 31.21 | 24.41 | 30.61 | 0.040 | 0.0017 | 41.08 | -0.0386 | -0.8% | 1.32 |

### Cost (solo bench, 1080p, 100 frames after 20 warm-up, one denoiser per page)

Re-measured with no other headless job running; two runs ~20 min apart (spread up to ±15 %).

| signal | denoiser | GPU ms (median) | passes (median ms) | wall ms |
|---|---|---|---|---|
| shadows | ffx-shadows | 0.73 / 0.51 | prepare 0.08 · tile_classification 0.22 · filter_0 0.15 · filter_1 0.14 · filter_2 0.14 (run 1) | 1.1 |
| specular | ffx-reflections | 1.94 / 1.99 | prepare 0.07 · reproject 0.78 · prefilter 0.42 · resolve_temporal 0.61 | 2.4 |
| diffuse | svgf (defaults) | 2.36 / 2.17 | prepass 0.18 · temporal 0.40 · variance 0.23 · atrous 0.33 + 4 × 0.28 | 2.8 |
| specular | svgf (defaults) | 2.83 / 3.01 | prepass 0.17 · temporal 0.39 · variance 0.66 · atrous ≈ 5 × 0.31 | 3.3 |
| any | accumulate-32 | (no timestamps) | 1 pass | 0.6 |

### What the baseline shows

- **Specular is where the work is.** Plain accumulation (surface reprojection) *hurts*
  near-mirror pixels (r < 0.15: 28.7 → 20.3 dB on `orbit`) and ghosts highlights
  (`orbit` +4.9 % energy, `glossy` −21 %); FFX reflections is sharp on smooth surfaces but
  loses 11–28 % energy (firefly suppression) and is weak for r ≥ 0.35. Neither handles
  the 0.35–0.8 range: virtual-motion reprojection and lobe-sized kernels (SPEC §M3) have
  clear room.
- **Anti-lag**: on `light`, accumulation goes *below* the noisy input for shadows
  (18.2 vs 19.3 dB, +6.3 % energy, FLIP 0.151 vs 0.029) after the light flips; FFX
  shadows recovers (28.5 dB).
- **Disocclusion**: accumulation's disoccluded pixels sit 6–14 dB under its settled PSNR
  on every signal (no spatial fallback); FFX shadows' spatial filter keeps them at
  28–34 dB.
- **Shadows**: FFX shadows wins PSNR everywhere except `glossy` (smooth large shadows,
  where 32-frame accumulation reaches 37.2 dB) but carries a −0.03…−0.05 penumbra bias
  (it thresholds visibility to binary) and its FLIP is *worse* than accumulation's on
  every path but `light`: it smears penumbrae (visible in view mode). `pan` frames mostly lit
  surfaces, hence its high PSNR for every row.
- **SVGF** (M1.md): 37–39 dB diffuse and 34–35 dB specular averaged over the paths, 8–14 dB
  above these baselines on specular; recommended defaults `feedback: false`, `antiLag: 'auto'`.
- **FLIP vs PSNR** disagree for shadows (see above) and for 1-px dither in general; keep
  both in result tables.

### Provisional

- Sampling is spatiotemporal blue noise by default since T1.5 (`sampling=white` for the old PCG streams).
- 256-spp references still carry residual noise: the PSNR ceiling is roughly the
  reference's own error (≈ 35–45 dB depending on signal); differences above ~40 dB are
  not meaningful.
- `pixelsPerFrame` in the JSON regions is averaged over all frames of the path,
  including frames where the region is empty.

## Capture round trip (T0.7, our side), 2026-10-25

A capture written by the test bed (`mode=capture`) replayed through `replay()` and scored
by `tools/rt-capture/compare.mjs` gives the same numbers as the live test bed on the same
frames (`mode=eval` with the same path / start / frames / size; paths are pure functions
of the frame index and the tracer's seed is the path frame, so both render identical
frames). Captures: `rt-orbit` (orbit, frames 0–23) and `rt-cut` (cut, path frames 36–59:
camera cut at local frame 12), 960×540, all three signals, 256-spp references, 1.59 GB
each. Both pass `validate.mjs` with no warnings. Apple M5 Pro, Chrome headless (Metal).

```sh
cd examples/realtime-denoiser
node run-headless.mjs --serve --set=roundtrip                 # write + validate rt-orbit, rt-cut
node run-headless.mjs --serve --set=roundtrip --replay=passthrough,accumulate,accumulate-32,ffx-shadows,ffx-reflections,svgf,svgf-auto
                                                              # replay each, then compare.mjs per capture
# live side: capture-sets.mjs evalQuery(), e.g.
node run-headless.mjs --serve "mode=eval&path=cut&start=36&frames=24&w=960&h=540&signal=all&refspp=256&flip=0&denoiser=passthrough,accumulate,accumulate-32,ffx-shadows,ffx-reflections,svgf,svgf-auto"
```

_(Measured with the white-noise sampler of the time; the `rt-*` captures were deleted when the
sampler changed. `--set=roundtrip` regenerates them.)_

**Result: match.** Over 30 (capture, signal, denoiser) rows the sequence PSNR and settled
PSNR agree within **0.001 dB**, and every per-frame PSNR within **0.0006 dB**, which is
the rounding of the two reports (live 4 decimals, compare.mjs 3). So the replay sees the
same inputs: the rgba16float test-bed textures (normal, albedo, f0, diffuse, specular) are
written as the exact f32 value of each half and uploaded as rgba32float, and the r32float
ones are copied bit for bit; no fp16-vs-f32 gap exists for these denoisers. Flicker
differs by up to 6.5 % (relative) by definition only: the live number is pooled over all
pixels of all frames and takes s = 0 for pixels not scored in the previous frame,
compare.mjs averages per-frame means and skips those pixels (CAPTURE-FORMAT notes it);
the gap is largest on `rt-cut`, whose camera moves more. `svgf` runs per signal live (one
instance per signal pair) and jointly (`dispatchBoth`) in replay: identical PSNR.


GPU ms (median, timestamps, per frame; live = eval run, replay = `compare.mjs`, 20 ms GPU
warm-up before each replay dispatch, see below), `rt-orbit`:

| denoiser | live | replay |
|---|---|---|
| accumulate (3 signals) | 0.12 + 0.12 + 0.09 | 0.35 |
| ffx-shadows | 0.155 | 0.157 |
| ffx-reflections | 0.476 | 0.489 |
| svgf (live: diffuse + specular instances; replay: joint) | 0.49 + 0.67 | 1.02 |
| svgf-diffuse / svgf-specular | 0.49 / 0.67 | 0.51 / 0.68 |
| svgf-auto | 0.72 + 0.96 | 1.47 |

Without the warm-up (`warm=0`) replay timestamps read 4–9× higher (svgf-diffuse 2.11 ms):
the replay idles the GPU between frames (fetch, upload, readback) and Apple's GPU clocks
down. The live eval keeps it busy rendering references. The table above used `warm=20`;
at 1080p that is not enough (`std1080-orbit`, svgf-diffuse: 3.05 ms at 20 ms warm-up,
2.23 / 2.24 / 2.35 ms at 50 / 100 / 200 ms; at 960×540 0.51 vs 0.58 ms at 20 vs 100 ms,
noise), so the default is now **`warm=50`**. The live eval's own 1080p timings
(svgf diffuse 3.70 ms over 8 frames) sit above the warmed replay: measure costs with the
solo bench or a warmed replay, not the eval (T1.5). Compare like with like on Windows.
