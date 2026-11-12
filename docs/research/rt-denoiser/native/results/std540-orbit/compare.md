# std540-orbit: replay scores

960×540, 16 frames, resets at [0], referenceSpp 256. Metrics: CAPTURE-FORMAT.md; settled = ≥ 8 frames after a reset. PSNR, settled, last frame and penumbra are means of per-frame dB; pooled = PSNR of the mean MSE over all frames and pixels; capped = mean of per-frame dB clipped at 60 dB.

| denoiser | signal | PSNR dB (noisy → out) | pooled | capped | settled | settled pooled | last frame | penumbra | penumbra pooled | flicker (noisy → out) | bias | non-finite | GPU ms | wall ms |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| accumulate | diffuse | 16.42 → **24.07** | 22.52 | 24.07 | 26.90 | 26.81 | 28.15 | – | – | 0.1041 → 0.0601 | -0.0127 | 0 | 1.843 | 90.60 |
| accumulate | specular | 13.66 → **24.71** | 22.50 | 24.71 | 26.44 | 26.43 | 26.01 | – | – | 0.1512 → 0.0377 | -0.0094 | 0 | 1.843 | 90.60 |
| accumulate | visibility | 18.81 → **27.01** | 25.82 | 27.01 | 28.15 | 28.13 | 27.59 | 17.98 | 16.10 | 0.0365 → 0.0150 | -0.0057 | 0 | 1.843 | 90.60 |
| ffx-reflections | specular | 13.66 → **18.50** | 18.49 | 18.50 | 18.53 | 18.53 | 18.42 | – | – | 0.1512 → 0.0152 | -0.0625 | 0 | 173.528 | 233.50 |
| ffx-shadows | visibility | 18.81 → **31.34** | 31.07 | 31.34 | 30.18 | 30.03 | 28.61 | 23.15 | 23.12 | 0.0365 → 0.0077 | -0.0223 | 0 | 4.531 | 31.50 |
| nrd-reblur | diffuse | 16.42 → **34.22** | 34.15 | 34.22 | 34.85 | 34.84 | 35.08 | – | – | 0.1041 → 0.0053 | 0.0040 | 0 | 25.104 | 30.68 |
| nrd-reblur | specular | 13.66 → **28.85** | 28.81 | 28.85 | 28.83 | 28.82 | 28.39 | – | – | 0.1512 → 0.0083 | 0.0007 | 0 | 25.104 | 30.68 |
| nrd-relax | diffuse | 16.42 → **35.92** | 35.86 | 35.92 | 36.55 | 36.55 | 36.86 | – | – | 0.1041 → 0.0037 | 0.0047 | 0 | 42.519 | 44.34 |
| nrd-relax | specular | 13.66 → **28.01** | 27.63 | 28.01 | 29.40 | 29.40 | 29.46 | – | – | 0.1512 → 0.0063 | 0.0077 | 0 | 42.519 | 44.34 |
| nrd-sigma | visibility | 18.81 → **22.84** | 22.84 | 22.84 | 22.90 | 22.90 | 22.98 | 12.38 | 12.38 | 0.0365 → 0.0166 | 0.0051 | 0 | 9.286 | 17.14 |
| recurrent | diffuse | 16.42 → **36.27** | 36.07 | 36.27 | 37.24 | 37.23 | 37.56 | – | – | 0.1041 → 0.0060 | -0.0019 | 0 | 348.371 | 367.70 |
| recurrent | specular | 13.66 → **31.15** | 31.15 | 31.15 | 31.04 | 31.04 | 30.96 | – | – | 0.1512 → 0.0079 | -0.0008 | 0 | 348.371 | 367.70 |
| recurrent-svgfspec | diffuse | 16.42 → **36.27** | 36.07 | 36.27 | 37.24 | 37.23 | 37.56 | – | – | 0.1041 → 0.0060 | -0.0019 | 0 | 290.300 | 299.10 |
| recurrent-svgfspec | specular | 13.66 → **32.95** | 32.94 | 32.95 | 32.77 | 32.77 | 32.68 | – | – | 0.1512 → 0.0051 | -0.0003 | 0 | 290.300 | 299.10 |
| shadows | visibility | 18.81 → **35.05** | 35.00 | 35.05 | 35.44 | 35.43 | 35.46 | 25.16 | 25.11 | 0.0365 → 0.0039 | 0.0082 | 0 | 49.919 | 126.30 |
| svgf | diffuse | 16.42 → **38.18** | 38.09 | 38.18 | 38.90 | 38.90 | 39.10 | – | – | 0.1041 → 0.0044 | -0.0023 | 0 | 29.848 | 39.70 |
| svgf | specular | 13.66 → **32.32** | 32.28 | 32.32 | 31.92 | 31.92 | 31.70 | – | – | 0.1512 → 0.0051 | -0.0004 | 0 | 29.848 | 39.70 |
| svgf-auto | diffuse | 16.42 → **38.32** | 38.21 | 38.32 | 39.13 | 39.13 | 39.40 | – | – | 0.1041 → 0.0041 | -0.0018 | 0 | 341.828 | 496.90 |
| svgf-auto | specular | 13.66 → **32.95** | 32.94 | 32.95 | 32.77 | 32.77 | 32.68 | – | – | 0.1512 → 0.0051 | -0.0003 | 0 | 341.828 | 496.90 |

Visibility, dynamic vs static region (dynamic: reference range over frames t-4..t > 0.05, reprojected; 5975 px per frame). Pooled PSNR; flicker = mean |e_t − e_t−1| and tPSNR, motion-compensated, valid history.

| denoiser | dynamic PSNR | dynamic flicker | dynamic tPSNR | dynamic boil | static PSNR | static penumbra | static flicker | static tPSNR | static penumbra boil |
|---|---|---|---|---|---|---|---|---|---|
| noisy | 7.51 | 0.4260 | 4.09 | 0.4562 | 19.73 | 8.48 | 0.0225 | 16.66 | 0.3860 |
| accumulate | 16.71 | 0.0843 | 16.80 | 0.0751 | 26.32 | 15.92 | 0.0066 | 27.16 | 0.0744 |
| ffx-shadows | 18.90 | 0.0526 | 21.04 | 0.0582 | 32.25 | 24.66 | 0.0030 | 37.23 | 0.0337 |
| nrd-sigma | 11.82 | 0.1824 | 8.38 | 0.2848 | 23.69 | 12.50 | 0.0097 | 20.84 | 0.2387 |
| shadows | 20.63 | 0.0459 | 21.42 | 0.0595 | 37.24 | 26.87 | 0.0019 | 39.03 | 0.0349 |
| reference (its own boil) | | | | 0.0612 | | | | | 0.0314 |
