# std540-light: replay scores

960×540, 24 frames, resets at [0], referenceSpp 256. Metrics: CAPTURE-FORMAT.md; settled = ≥ 8 frames after a reset. PSNR, settled, last frame and penumbra are means of per-frame dB; pooled = PSNR of the mean MSE over all frames and pixels; capped = mean of per-frame dB clipped at 60 dB.

| denoiser | signal | PSNR dB (noisy → out) | pooled | capped | settled | settled pooled | last frame | penumbra | penumbra pooled | flicker (noisy → out) | bias | non-finite | GPU ms | wall ms |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| accumulate | diffuse | 16.31 → **23.98** | 22.17 | 23.98 | 26.38 | 25.86 | 28.37 | – | – | 0.1065 → 0.0165 | -0.0111 | 0 | 5.455 | 102.80 |
| accumulate | specular | 13.75 → **24.84** | 22.59 | 24.84 | 26.80 | 26.62 | 28.30 | – | – | 0.1541 → 0.0157 | -0.0073 | 0 | 5.455 | 102.80 |
| accumulate | visibility | 17.74 → **17.33** | 13.76 | 17.33 | 12.90 | 12.12 | 16.51 | 13.41 | 12.07 | 0.0479 → 0.0174 | 0.1023 | 0 | 5.455 | 102.80 |
| ffx-reflections | specular | 13.75 → **18.00** | 18.00 | 18.00 | 17.94 | 17.94 | 17.85 | – | – | 0.1541 → 0.0036 | -0.0698 | 0 | 19.560 | 29.20 |
| ffx-shadows | visibility | 17.74 → **29.78** | 29.48 | 29.78 | 28.66 | 28.62 | 28.74 | 23.44 | 23.33 | 0.0479 → 0.0030 | -0.0225 | 0 | 5.529 | 68.70 |
| nrd-reblur | diffuse | 16.31 → **34.47** | 34.41 | 34.47 | 34.51 | 34.46 | 35.41 | – | – | 0.1065 → 0.0015 | 0.0054 | 0 | 135.498 | 189.41 |
| nrd-reblur | specular | 13.75 → **28.54** | 28.45 | 28.54 | 28.54 | 28.46 | 29.62 | – | – | 0.1541 → 0.0028 | 0.0060 | 0 | 135.498 | 189.41 |
| nrd-relax | diffuse | 16.31 → **36.15** | 36.10 | 36.15 | 36.02 | 35.97 | 36.80 | – | – | 0.1065 → 0.0010 | 0.0055 | 0 | 188.030 | 209.69 |
| nrd-relax | specular | 13.75 → **28.35** | 27.91 | 28.35 | 29.34 | 29.07 | 31.21 | – | – | 0.1541 → 0.0025 | 0.0096 | 0 | 188.030 | 209.69 |
| nrd-sigma | visibility | 17.74 → **24.89** | 24.74 | 24.89 | 24.36 | 24.25 | 25.01 | 15.69 | 15.68 | 0.0479 → 0.0086 | 0.0271 | 0 | 5.497 | 65.95 |
| recurrent | diffuse | 16.31 → **38.02** | 37.73 | 38.02 | 38.64 | 38.53 | 39.57 | – | – | 0.1065 → 0.0017 | -0.0012 | 0 | 256.106 | 316.20 |
| recurrent | specular | 13.75 → **31.88** | 31.75 | 31.88 | 32.23 | 32.16 | 32.84 | – | – | 0.1541 → 0.0024 | 0.0001 | 0 | 256.106 | 316.20 |
| recurrent-svgfspec | diffuse | 16.31 → **38.02** | 37.73 | 38.02 | 38.64 | 38.53 | 39.57 | – | – | 0.1065 → 0.0017 | -0.0012 | 0 | 391.221 | 409.50 |
| recurrent-svgfspec | specular | 13.75 → **33.38** | 33.32 | 33.38 | 33.44 | 33.39 | 33.81 | – | – | 0.1541 → 0.0021 | 0.0002 | 0 | 391.221 | 409.50 |
| shadows | visibility | 17.74 → **34.63** | 33.76 | 34.63 | 34.65 | 33.40 | 37.06 | 26.26 | 25.49 | 0.0479 → 0.0027 | 0.0224 | 0 | 48.953 | 109.80 |
| svgf | diffuse | 16.31 → **38.93** | 38.84 | 38.93 | 39.12 | 39.04 | 39.78 | – | – | 0.1065 → 0.0020 | -0.0018 | 0 | 178.767 | 239.70 |
| svgf | specular | 13.75 → **32.99** | 32.81 | 32.99 | 32.91 | 32.71 | 33.81 | – | – | 0.1541 → 0.0026 | 0.0011 | 0 | 178.767 | 239.70 |
| svgf-auto | diffuse | 16.31 → **39.22** | 39.13 | 39.22 | 39.54 | 39.47 | 40.06 | – | – | 0.1065 → 0.0016 | -0.0012 | 0 | 289.628 | 439.20 |
| svgf-auto | specular | 13.75 → **33.38** | 33.32 | 33.38 | 33.44 | 33.39 | 33.81 | – | – | 0.1541 → 0.0021 | 0.0002 | 0 | 289.628 | 439.20 |

Visibility, dynamic vs static region (dynamic: reference range over frames t-4..t > 0.05, reprojected; 29431 px per frame). Pooled PSNR; flicker = mean |e_t − e_t−1| and tPSNR, motion-compensated, valid history.

| denoiser | dynamic PSNR | dynamic flicker | dynamic tPSNR | dynamic boil | static PSNR | static penumbra | static flicker | static tPSNR | static penumbra boil |
|---|---|---|---|---|---|---|---|---|---|
| noisy | 11.40 | 0.2070 | 7.28 | 0.3748 | 18.86 | 8.40 | 0.0356 | 14.50 | 0.4725 |
| accumulate | 5.31 | 0.1673 | 10.04 | 0.0387 | 16.30 | 13.18 | 0.0058 | 32.05 | 0.0350 |
| ffx-shadows | 23.66 | 0.0229 | 26.27 | 0.1950 | 30.49 | 23.74 | 0.0014 | 42.97 | 0.0127 |
| nrd-sigma | 17.04 | 0.0539 | 14.55 | 0.2327 | 26.69 | 16.45 | 0.0051 | 23.63 | 0.1616 |
| shadows | 24.92 | 0.0235 | 25.98 | 0.1930 | 36.70 | 27.61 | 0.0010 | 43.97 | 0.0108 |
| reference (its own boil) | | | | 0.2000 | | | | | 0.0024 |
