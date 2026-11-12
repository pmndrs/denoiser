# std540-pan: replay scores

960×540, 16 frames, resets at [0], referenceSpp 256. Metrics: CAPTURE-FORMAT.md; settled = ≥ 8 frames after a reset. PSNR, settled, last frame and penumbra are means of per-frame dB; pooled = PSNR of the mean MSE over all frames and pixels; capped = mean of per-frame dB clipped at 60 dB.

| denoiser | signal | PSNR dB (noisy → out) | pooled | capped | settled | settled pooled | last frame | penumbra | penumbra pooled | flicker (noisy → out) | bias | non-finite | GPU ms | wall ms |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| accumulate | diffuse | 15.34 → **23.19** | 21.63 | 23.19 | 25.73 | 25.71 | 26.22 | – | – | 0.1334 → 0.0692 | -0.0154 | 0 | 3.503 | 14.80 |
| accumulate | specular | 17.98 → **23.62** | 23.06 | 23.62 | 24.36 | 24.36 | 24.62 | – | – | 0.0964 → 0.0456 | -0.0098 | 0 | 3.503 | 14.80 |
| accumulate | visibility | 17.82 → **27.68** | 25.89 | 27.68 | 29.17 | 29.14 | 29.93 | 19.93 | 17.14 | 0.0563 → 0.0180 | 0.0008 | 0 | 3.503 | 14.80 |
| ffx-reflections | specular | 17.98 → **24.13** | 24.03 | 24.13 | 25.00 | 24.99 | 24.91 | – | – | 0.0964 → 0.0229 | -0.0232 | 0 | 75.280 | 188.10 |
| ffx-shadows | visibility | 17.82 → **31.52** | 31.41 | 31.52 | 30.90 | 30.82 | 30.00 | 24.21 | 24.20 | 0.0563 → 0.0106 | -0.0400 | 0 | 4.974 | 12.80 |
| nrd-reblur | diffuse | 15.34 → **32.35** | 32.35 | 32.35 | 32.39 | 32.38 | 32.60 | – | – | 0.1334 → 0.0132 | 0.0094 | 0 | 208.055 | 261.70 |
| nrd-reblur | specular | 17.98 → **29.48** | 29.47 | 29.48 | 29.60 | 29.60 | 29.50 | – | – | 0.0964 → 0.0198 | -0.0006 | 0 | 208.055 | 261.70 |
| nrd-relax | diffuse | 15.34 → **33.04** | 33.03 | 33.04 | 33.08 | 33.07 | 33.14 | – | – | 0.1334 → 0.0093 | 0.0106 | 0 | 259.029 | 379.01 |
| nrd-relax | specular | 17.98 → **32.04** | 32.04 | 32.04 | 32.04 | 32.03 | 32.06 | – | – | 0.0964 → 0.0119 | 0.0055 | 0 | 259.029 | 379.01 |
| nrd-sigma | visibility | 17.82 → **21.00** | 20.96 | 21.00 | 20.49 | 20.49 | 20.63 | 11.69 | 11.65 | 0.0563 → 0.0300 | 0.0047 | 0 | 2.233 | 94.26 |
| recurrent | diffuse | 15.34 → **37.78** | 37.61 | 37.78 | 38.48 | 38.48 | 38.67 | – | – | 0.1334 → 0.0090 | -0.0018 | 0 | 214.699 | 345.40 |
| recurrent | specular | 17.98 → **33.86** | 33.84 | 33.86 | 33.62 | 33.62 | 33.60 | – | – | 0.0964 → 0.0109 | -0.0010 | 0 | 214.699 | 345.40 |
| recurrent-svgfspec | diffuse | 15.34 → **37.78** | 37.61 | 37.78 | 38.48 | 38.48 | 38.67 | – | – | 0.1334 → 0.0090 | -0.0018 | 0 | 40.601 | 48.60 |
| recurrent-svgfspec | specular | 17.98 → **35.04** | 35.02 | 35.04 | 34.75 | 34.74 | 34.23 | – | – | 0.0964 → 0.0085 | -0.0015 | 0 | 40.601 | 48.60 |
| shadows | visibility | 17.82 → **37.01** | 36.73 | 37.01 | 38.08 | 38.04 | 39.03 | 28.56 | 28.31 | 0.0563 → 0.0056 | -0.0042 | 0 | 53.124 | 103.10 |
| svgf | diffuse | 15.34 → **38.11** | 38.04 | 38.11 | 38.56 | 38.56 | 38.57 | – | – | 0.1334 → 0.0072 | -0.0024 | 0 | 32.675 | 42.30 |
| svgf | specular | 17.98 → **33.87** | 33.83 | 33.87 | 33.49 | 33.49 | 33.22 | – | – | 0.0964 → 0.0100 | -0.0015 | 0 | 32.675 | 42.30 |
| svgf-auto | diffuse | 15.34 → **38.22** | 38.15 | 38.22 | 38.74 | 38.74 | 38.77 | – | – | 0.1334 → 0.0070 | -0.0020 | 0 | 154.936 | 243.10 |
| svgf-auto | specular | 17.98 → **35.04** | 35.02 | 35.04 | 34.75 | 34.74 | 34.23 | – | – | 0.0964 → 0.0085 | -0.0015 | 0 | 154.936 | 243.10 |

Visibility, dynamic vs static region (dynamic: reference range over frames t-4..t > 0.05, reprojected; 6013 px per frame). Pooled PSNR; flicker = mean |e_t − e_t−1| and tPSNR, motion-compensated, valid history.

| denoiser | dynamic PSNR | dynamic flicker | dynamic tPSNR | dynamic boil | static PSNR | static penumbra | static flicker | static tPSNR | static penumbra boil |
|---|---|---|---|---|---|---|---|---|---|
| noisy | 7.45 | 0.3854 | 4.48 | 0.4214 | 18.68 | 8.64 | 0.0281 | 15.67 | 0.3681 |
| accumulate | 19.41 | 0.0731 | 18.35 | 0.0770 | 26.17 | 16.79 | 0.0076 | 26.94 | 0.0690 |
| ffx-shadows | 21.31 | 0.0346 | 25.41 | 0.0383 | 32.21 | 24.98 | 0.0029 | 38.38 | 0.0227 |
| nrd-sigma | 13.62 | 0.1044 | 12.08 | 0.1762 | 21.33 | 11.37 | 0.0172 | 18.38 | 0.2725 |
| shadows | 25.89 | 0.0289 | 27.28 | 0.0377 | 37.71 | 28.92 | 0.0019 | 41.03 | 0.0220 |
| reference (its own boil) | | | | 0.0354 | | | | | 0.0197 |
