# std540-object: replay scores

960×540, 16 frames, resets at [0], referenceSpp 256. Metrics: CAPTURE-FORMAT.md; settled = ≥ 8 frames after a reset. PSNR, settled, last frame and penumbra are means of per-frame dB; pooled = PSNR of the mean MSE over all frames and pixels; capped = mean of per-frame dB clipped at 60 dB.

| denoiser | signal | PSNR dB (noisy → out) | pooled | capped | settled | settled pooled | last frame | penumbra | penumbra pooled | flicker (noisy → out) | bias | non-finite | GPU ms | wall ms |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| accumulate | diffuse | 16.26 → **21.61** | 20.66 | 21.61 | 24.07 | 23.85 | 25.87 | – | – | 0.1128 → 0.0230 | -0.0166 | 0 | 1.640 | 7.90 |
| accumulate | specular | 14.40 → **23.03** | 21.45 | 23.03 | 25.45 | 25.41 | 26.14 | – | – | 0.1378 → 0.0201 | -0.0126 | 0 | 1.640 | 7.90 |
| accumulate | visibility | 16.62 → **22.10** | 21.70 | 22.10 | 21.84 | 21.78 | 20.59 | 15.36 | 14.75 | 0.0571 → 0.0105 | 0.0134 | 0 | 1.640 | 7.90 |
| ffx-reflections | specular | 14.40 → **19.40** | 19.40 | 19.40 | 19.35 | 19.35 | 19.31 | – | – | 0.1378 → 0.0058 | -0.0516 | 0 | 75.740 | 161.30 |
| ffx-shadows | visibility | 16.62 → **30.77** | 30.50 | 30.77 | 29.49 | 29.39 | 28.32 | 23.88 | 23.73 | 0.0571 → 0.0040 | -0.0255 | 0 | 0.315 | 4.30 |
| nrd-reblur | diffuse | 16.26 → **33.02** | 32.89 | 33.02 | 33.73 | 33.72 | 34.01 | – | – | 0.1128 → 0.0032 | 0.0062 | 0 | 176.401 | 190.97 |
| nrd-reblur | specular | 14.40 → **29.36** | 29.24 | 29.36 | 30.12 | 30.11 | 30.41 | – | – | 0.1378 → 0.0053 | 0.0016 | 0 | 176.401 | 190.97 |
| nrd-relax | diffuse | 16.26 → **34.59** | 34.55 | 34.59 | 35.10 | 35.09 | 35.29 | – | – | 0.1128 → 0.0020 | 0.0070 | 0 | 179.912 | 190.67 |
| nrd-relax | specular | 14.40 → **27.74** | 27.34 | 27.74 | 29.41 | 29.35 | 30.39 | – | – | 0.1378 → 0.0035 | 0.0122 | 0 | 179.912 | 190.67 |
| nrd-sigma | visibility | 16.62 → **21.12** | 21.12 | 21.12 | 21.12 | 21.12 | 21.24 | 12.98 | 12.98 | 0.0571 → 0.0204 | 0.0125 | 0 | 5.124 | 66.66 |
| recurrent | diffuse | 16.26 → **35.33** | 35.06 | 35.33 | 36.47 | 36.46 | 36.86 | – | – | 0.1128 → 0.0025 | -0.0013 | 0 | 289.217 | 315.30 |
| recurrent | specular | 14.40 → **31.63** | 31.55 | 31.63 | 32.32 | 32.28 | 32.96 | – | – | 0.1378 → 0.0039 | -0.0009 | 0 | 289.217 | 315.30 |
| recurrent-svgfspec | diffuse | 16.26 → **35.33** | 35.06 | 35.33 | 36.47 | 36.46 | 36.86 | – | – | 0.1128 → 0.0025 | -0.0013 | 0 | 1.955 | 5.00 |
| recurrent-svgfspec | specular | 14.40 → **33.70** | 33.66 | 33.70 | 34.09 | 34.09 | 34.16 | – | – | 0.1378 → 0.0028 | -0.0004 | 0 | 1.955 | 5.00 |
| shadows | visibility | 16.62 → **33.87** | 33.85 | 33.87 | 33.97 | 33.97 | 34.05 | 25.97 | 25.96 | 0.0571 → 0.0034 | 0.0112 | 0 | 0.400 | 4.20 |
| svgf | diffuse | 16.26 → **36.68** | 36.64 | 36.68 | 37.18 | 37.18 | 37.29 | – | – | 0.1128 → 0.0027 | -0.0021 | 0 | 233.194 | 378.40 |
| svgf | specular | 14.40 → **32.85** | 32.76 | 32.85 | 33.65 | 33.65 | 33.96 | – | – | 0.1378 → 0.0032 | -0.0006 | 0 | 233.194 | 378.40 |
| svgf-auto | diffuse | 16.26 → **36.78** | 36.73 | 36.78 | 37.26 | 37.26 | 37.43 | – | – | 0.1128 → 0.0024 | -0.0016 | 0 | 306.544 | 320.40 |
| svgf-auto | specular | 14.40 → **33.70** | 33.66 | 33.70 | 34.09 | 34.09 | 34.16 | – | – | 0.1378 → 0.0028 | -0.0004 | 0 | 306.544 | 320.40 |

Visibility, dynamic vs static region (dynamic: reference range over frames t-4..t > 0.05, reprojected; 7615 px per frame). Pooled PSNR; flicker = mean |e_t − e_t−1| and tPSNR, motion-compensated, valid history.

| denoiser | dynamic PSNR | dynamic flicker | dynamic tPSNR | dynamic boil | static PSNR | static penumbra | static flicker | static tPSNR | static penumbra boil |
|---|---|---|---|---|---|---|---|---|---|
| noisy | 9.15 | 0.3770 | 5.00 | 0.4163 | 17.04 | 8.53 | 0.0494 | 13.07 | 0.4374 |
| accumulate | 7.82 | 0.1158 | 15.42 | 0.0769 | 24.50 | 16.44 | 0.0075 | 27.41 | 0.0654 |
| ffx-shadows | 19.76 | 0.0436 | 24.77 | 0.0461 | 31.59 | 24.82 | 0.0028 | 39.03 | 0.0193 |
| nrd-sigma | 16.31 | 0.0689 | 16.93 | 0.0939 | 21.31 | 12.80 | 0.0187 | 17.49 | 0.2639 |
| shadows | 22.24 | 0.0447 | 24.38 | 0.0497 | 35.24 | 27.08 | 0.0022 | 39.30 | 0.0172 |
| reference (its own boil) | | | | 0.0448 | | | | | 0.0026 |
