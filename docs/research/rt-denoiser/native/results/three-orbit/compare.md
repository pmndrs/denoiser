# three-orbit: replay scores

960×540, 40 frames, resets at [0], referenceSpp 1024. Metrics: CAPTURE-FORMAT.md; settled = ≥ 8 frames after a reset. PSNR, settled, last frame and penumbra are means of per-frame dB; pooled = PSNR of the mean MSE over all frames and pixels; capped = mean of per-frame dB clipped at 60 dB.

| denoiser | signal | PSNR dB (noisy → out) | pooled | capped | settled | settled pooled | last frame | penumbra | penumbra pooled | flicker (noisy → out) | bias | non-finite | GPU ms | wall ms |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| accumulate | diffuse | 16.88 → **32.15** | 28.53 | 32.15 | 33.98 | 33.75 | 35.10 | – | – | 0.1661 → 0.0266 | -0.0018 | 0 | 2.583 | 41.10 |
| accumulate | specular | 34.80 → **39.58** | 39.28 | 39.58 | 39.39 | 39.26 | 37.83 | – | – | 0.0094 → 0.0025 | 0.0006 | 0 | 2.583 | 41.10 |
| accumulate | visibility | 16.05 → **27.00** | 25.96 | 27.00 | 27.63 | 27.61 | 27.06 | 23.10 | 19.98 | 0.0632 → 0.0136 | 0.0004 | 0 | 2.583 | 41.10 |
| ffx-reflections | specular | 34.80 → **39.16** | 39.11 | 39.16 | 38.85 | 38.83 | 39.30 | – | – | 0.0094 → 0.0023 | 0.0001 | 0 | 14.282 | 47.80 |
| ffx-shadows | visibility | 16.05 → **26.57** | 26.32 | 26.57 | 25.86 | 25.79 | 25.60 | 22.64 | 22.61 | 0.0632 → 0.0077 | -0.0402 | 0 | 3.055 | 28.20 |
| nrd-reblur | diffuse | 16.88 → **32.97** | 32.93 | 32.97 | 33.11 | 33.10 | 33.64 | – | – | 0.1661 → 0.0084 | -0.0099 | 0 | 78.541 | 94.79 |
| nrd-reblur | specular | 34.80 → **39.92** | 39.91 | 39.92 | 39.89 | 39.88 | 40.45 | – | – | 0.0094 → 0.0016 | 0.0005 | 0 | 78.541 | 94.79 |
| nrd-relax | diffuse | 16.88 → **37.60** | 37.59 | 37.60 | 37.74 | 37.73 | 38.33 | – | – | 0.1661 → 0.0054 | -0.0053 | 0 | 128.123 | 133.14 |
| nrd-relax | specular | 34.80 → **41.43** | 41.41 | 41.43 | 41.53 | 41.52 | 42.17 | – | – | 0.0094 → 0.0014 | -0.0004 | 0 | 128.123 | 133.14 |
| nrd-sigma | visibility | 16.05 → **24.94** | 24.93 | 24.94 | 24.81 | 24.81 | 25.11 | 17.36 | 17.36 | 0.0632 → 0.0103 | 0.0119 | 0 | 8.476 | 39.99 |
| recurrent | diffuse | 16.88 → **38.91** | 38.78 | 38.91 | 39.31 | 39.30 | 39.92 | – | – | 0.1661 → 0.0054 | -0.0010 | 0 | 1.717 | 5.00 |
| recurrent | specular | 34.80 → **43.20** | 43.02 | 43.20 | 43.58 | 43.53 | 45.01 | – | – | 0.0094 → 0.0016 | 0.0002 | 0 | 1.717 | 5.00 |
| recurrent-svgfspec | diffuse | 16.88 → **38.91** | 38.78 | 38.91 | 39.31 | 39.30 | 39.92 | – | – | 0.1661 → 0.0054 | -0.0010 | 0 | 51.439 | 74.40 |
| recurrent-svgfspec | specular | 34.80 → **45.39** | 45.33 | 45.39 | 45.45 | 45.39 | 47.02 | – | – | 0.0094 → 0.0011 | 0.0003 | 0 | 51.439 | 74.40 |
| shadows | visibility | 16.05 → **30.96** | 30.96 | 30.96 | 30.94 | 30.94 | 30.94 | 26.99 | 26.96 | 0.0632 → 0.0054 | 0.0027 | 0 | 3.079 | 31.10 |
| svgf | diffuse | 16.88 → **39.92** | 39.89 | 39.92 | 40.07 | 40.07 | 40.24 | – | – | 0.1661 → 0.0055 | -0.0011 | 0 | 144.008 | 187.90 |
| svgf | specular | 34.80 → **44.38** | 44.34 | 44.38 | 44.31 | 44.27 | 45.66 | – | – | 0.0094 → 0.0012 | 0.0004 | 0 | 144.008 | 187.90 |
| svgf-auto | diffuse | 16.88 → **39.86** | 39.83 | 39.86 | 40.00 | 40.00 | 40.10 | – | – | 0.1661 → 0.0054 | -0.0008 | 0 | 1.927 | 5.10 |
| svgf-auto | specular | 34.80 → **45.39** | 45.33 | 45.39 | 45.45 | 45.39 | 47.02 | – | – | 0.0094 → 0.0011 | 0.0003 | 0 | 1.927 | 5.10 |

Visibility, dynamic vs static region (dynamic: reference range over frames t-4..t > 0.05, reprojected; 6483 px per frame). Pooled PSNR; flicker = mean |e_t − e_t−1| and tPSNR, motion-compensated, valid history.

| denoiser | dynamic PSNR | dynamic flicker | dynamic tPSNR | dynamic boil | static PSNR | static penumbra | static flicker | static tPSNR | static penumbra boil |
|---|---|---|---|---|---|---|---|---|---|
| noisy | 7.77 | 0.3756 | 4.85 | 0.4039 | 16.38 | 7.80 | 0.0476 | 13.34 | 0.4079 |
| accumulate | 15.54 | 0.0802 | 15.90 | 0.0443 | 26.55 | 20.17 | 0.0066 | 28.31 | 0.0448 |
| ffx-shadows | 14.79 | 0.0690 | 17.04 | 0.0476 | 27.11 | 23.94 | 0.0033 | 32.52 | 0.0123 |
| nrd-sigma | 11.68 | 0.1630 | 9.43 | 0.2285 | 26.20 | 18.53 | 0.0054 | 25.16 | 0.0966 |
| shadows | 17.80 | 0.0596 | 18.43 | 0.0503 | 32.21 | 29.52 | 0.0028 | 32.76 | 0.0103 |
| reference (its own boil) | | | | 0.0754 | | | | | 0.0118 |
