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

RESULTS_TABLES_PLACEHOLDER
