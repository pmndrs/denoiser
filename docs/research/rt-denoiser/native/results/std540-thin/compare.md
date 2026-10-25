# std540-thin: replay scores

960×540, 16 frames, resets at [0], referenceSpp 256. Metrics: CAPTURE-FORMAT.md; settled = ≥ 8 frames after a reset. PSNR, settled, last frame and penumbra are means of per-frame dB; pooled = PSNR of the mean MSE over all frames and pixels; capped = mean of per-frame dB clipped at 60 dB.

| denoiser | signal | PSNR dB (noisy → out) | pooled | capped | settled | settled pooled | last frame | penumbra | penumbra pooled | flicker (noisy → out) | bias | non-finite | GPU ms | wall ms |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| accumulate | diffuse | 16.69 → **24.35** | 22.82 | 24.35 | 27.06 | 26.99 | 28.17 | – | – | 0.1109 → 0.0551 | -0.0101 | 0 | 5.518 | 62.80 |
| accumulate | specular | 16.74 → **26.48** | 24.37 | 26.48 | 29.09 | 29.07 | 29.53 | – | – | 0.1118 → 0.0367 | -0.0074 | 0 | 5.518 | 62.80 |
| accumulate | visibility | 15.98 → **25.90** | 23.94 | 25.90 | 27.89 | 27.89 | 27.54 | 19.18 | 16.67 | 0.0649 → 0.0227 | -0.0052 | 0 | 5.518 | 62.80 |
| ffx-reflections | specular | 16.74 → **21.35** | 21.35 | 21.35 | 21.29 | 21.29 | 21.26 | – | – | 0.1118 → 0.0104 | -0.0353 | 0 | 64.329 | 177.70 |
| ffx-shadows | visibility | 15.98 → **30.40** | 30.04 | 30.40 | 28.91 | 28.74 | 27.37 | 24.31 | 24.20 | 0.0649 → 0.0086 | -0.0244 | 0 | 5.872 | 13.10 |
| nrd-reblur | diffuse | 16.69 → **32.07** | 31.96 | 32.07 | 32.59 | 32.59 | 32.63 | – | – | 0.1109 → 0.0079 | 0.0063 | 0 | 66.542 | 133.65 |
| nrd-reblur | specular | 16.74 → **30.58** | 30.34 | 30.58 | 31.26 | 31.26 | 31.07 | – | – | 0.1118 → 0.0097 | 0.0002 | 0 | 66.542 | 133.65 |
| nrd-relax | diffuse | 16.69 → **32.75** | 32.74 | 32.75 | 32.98 | 32.98 | 33.03 | – | – | 0.1109 → 0.0056 | 0.0069 | 0 | 86.821 | 146.41 |
| nrd-relax | specular | 16.74 → **31.32** | 31.19 | 31.32 | 32.17 | 32.17 | 32.37 | – | – | 0.1118 → 0.0054 | 0.0092 | 0 | 86.821 | 146.41 |
| nrd-sigma | visibility | 15.98 → **20.31** | 20.31 | 20.31 | 20.31 | 20.31 | 20.27 | 12.69 | 12.69 | 0.0649 → 0.0280 | 0.0070 | 0 | 4.511 | 45.01 |
| recurrent | diffuse | 16.69 → **33.27** | 33.18 | 33.27 | 33.81 | 33.81 | 33.83 | – | – | 0.1109 → 0.0072 | -0.0014 | 0 | 42.666 | 76.80 |
| recurrent | specular | 16.74 → **33.34** | 33.28 | 33.34 | 33.80 | 33.80 | 33.77 | – | – | 0.1118 → 0.0067 | -0.0015 | 0 | 42.666 | 76.80 |
| recurrent-svgfspec | diffuse | 16.69 → **33.27** | 33.18 | 33.27 | 33.81 | 33.81 | 33.83 | – | – | 0.1109 → 0.0072 | -0.0014 | 0 | 42.216 | 57.90 |
| recurrent-svgfspec | specular | 16.74 → **34.25** | 34.23 | 34.25 | 34.22 | 34.22 | 34.09 | – | – | 0.1118 → 0.0048 | -0.0017 | 0 | 42.216 | 57.90 |
| shadows | visibility | 15.98 → **34.97** | 34.92 | 34.97 | 35.17 | 35.17 | 35.08 | 27.68 | 27.62 | 0.0649 → 0.0047 | 0.0079 | 0 | 38.966 | 104.70 |
| svgf | diffuse | 16.69 → **34.11** | 34.10 | 34.11 | 34.24 | 34.24 | 34.21 | – | – | 0.1109 → 0.0059 | -0.0016 | 0 | 254.873 | 335.30 |
| svgf | specular | 16.74 → **34.20** | 34.18 | 34.20 | 34.19 | 34.19 | 34.06 | – | – | 0.1118 → 0.0048 | -0.0018 | 0 | 254.873 | 335.30 |
| svgf-auto | diffuse | 16.69 → **34.14** | 34.13 | 34.14 | 34.29 | 34.29 | 34.27 | – | – | 0.1109 → 0.0057 | -0.0011 | 0 | 171.456 | 224.40 |
| svgf-auto | specular | 16.74 → **34.25** | 34.23 | 34.25 | 34.22 | 34.22 | 34.09 | – | – | 0.1118 → 0.0048 | -0.0017 | 0 | 171.456 | 224.40 |

Visibility, dynamic vs static region (dynamic: reference range over frames t-4..t > 0.05, reprojected; 6095 px per frame). Pooled PSNR; flicker = mean |e_t − e_t−1| and tPSNR, motion-compensated, valid history.

| denoiser | dynamic PSNR | dynamic flicker | dynamic tPSNR | dynamic boil | static PSNR | static penumbra | static flicker | static tPSNR | static penumbra boil |
|---|---|---|---|---|---|---|---|---|---|
| noisy | 7.39 | 0.3957 | 4.41 | 0.4300 | 16.42 | 8.46 | 0.0471 | 13.44 | 0.3762 |
| accumulate | 16.83 | 0.0840 | 16.90 | 0.0680 | 24.23 | 16.64 | 0.0121 | 25.07 | 0.0685 |
| ffx-shadows | 18.30 | 0.0521 | 21.17 | 0.0540 | 31.08 | 25.51 | 0.0049 | 35.91 | 0.0246 |
| nrd-sigma | 15.26 | 0.0781 | 14.05 | 0.1405 | 20.46 | 12.50 | 0.0200 | 17.76 | 0.2291 |
| shadows | 21.85 | 0.0466 | 22.06 | 0.0622 | 36.43 | 28.82 | 0.0035 | 37.52 | 0.0282 |
| reference (its own boil) | | | | 0.0709 | | | | | 0.0287 |
