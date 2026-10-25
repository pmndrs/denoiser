# three-knot-orbit: replay scores

960×540, 40 frames, resets at [0], referenceSpp 2048. Metrics: CAPTURE-FORMAT.md; settled = ≥ 8 frames after a reset. PSNR, settled, last frame and penumbra are means of per-frame dB; pooled = PSNR of the mean MSE over all frames and pixels; capped = mean of per-frame dB clipped at 60 dB.

| denoiser | signal | PSNR dB (noisy → out) | pooled | capped | settled | settled pooled | last frame | penumbra | penumbra pooled | flicker (noisy → out) | bias | non-finite | GPU ms | wall ms |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| accumulate | diffuse | 16.88 → **32.15** | 28.53 | 32.15 | 33.98 | 33.75 | 35.09 | – | – | 0.1661 → 0.0266 | -0.0018 | 0 | 0.519 | 4.00 |
| accumulate | specular | 34.83 → **39.54** | 39.23 | 39.54 | 39.33 | 39.20 | 37.78 | – | – | 0.0094 → 0.0025 | 0.0007 | 0 | 0.519 | 4.00 |
| accumulate | visibility | 16.07 → **27.00** | 25.96 | 27.00 | 27.62 | 27.60 | 27.05 | 23.05 | 19.96 | 0.0631 → 0.0135 | 0.0010 | 0 | 0.519 | 4.00 |
| ffx-reflections | specular | 34.83 → **39.11** | 39.05 | 39.11 | 38.79 | 38.78 | 39.31 | – | – | 0.0094 → 0.0023 | 0.0001 | 0 | 0.864 | 4.10 |
| ffx-shadows | visibility | 16.07 → **26.59** | 26.34 | 26.59 | 25.88 | 25.82 | 25.68 | 22.69 | 22.67 | 0.0631 → 0.0075 | -0.0395 | 0 | 0.331 | 4.10 |
| nrd-reblur | diffuse | 16.88 → **32.96** | 32.93 | 32.96 | 33.11 | 33.10 | 33.65 | – | – | 0.1661 → 0.0084 | -0.0099 | 0 | 1.829 | 2.43 |
| nrd-reblur | specular | 34.83 → **39.96** | 39.95 | 39.96 | 39.93 | 39.92 | 40.40 | – | – | 0.0094 → 0.0016 | 0.0005 | 0 | 1.829 | 2.43 |
| nrd-relax | diffuse | 16.88 → **37.60** | 37.59 | 37.60 | 37.74 | 37.73 | 38.32 | – | – | 0.1661 → 0.0054 | -0.0053 | 0 | 2.303 | 2.69 |
| nrd-relax | specular | 34.83 → **41.38** | 41.36 | 41.38 | 41.46 | 41.45 | 42.17 | – | – | 0.0094 → 0.0014 | -0.0003 | 0 | 2.303 | 2.69 |
| nrd-sigma | visibility | 16.07 → **24.94** | 24.93 | 24.94 | 24.82 | 24.81 | 25.12 | 17.36 | 17.36 | 0.0631 → 0.0101 | 0.0124 | 0 | 0.444 | 0.63 |
| recurrent | diffuse | 16.88 → **38.91** | 38.78 | 38.91 | 39.31 | 39.30 | 39.89 | – | – | 0.1661 → 0.0054 | -0.0010 | 0 | 1.715 | 4.10 |
| recurrent | specular | 34.83 → **43.13** | 42.95 | 43.13 | 43.50 | 43.45 | 45.00 | – | – | 0.0094 → 0.0016 | 0.0002 | 0 | 1.715 | 4.10 |
| recurrent-svgfspec | diffuse | 16.88 → **38.91** | 38.78 | 38.91 | 39.31 | 39.30 | 39.89 | – | – | 0.1661 → 0.0054 | -0.0010 | 0 | 2.332 | 5.10 |
| recurrent-svgfspec | specular | 34.83 → **45.32** | 45.26 | 45.32 | 45.37 | 45.31 | 47.00 | – | – | 0.0094 → 0.0011 | 0.0003 | 0 | 2.332 | 5.10 |
| shadows | visibility | 16.07 → **30.97** | 30.97 | 30.97 | 30.94 | 30.94 | 30.94 | 26.98 | 26.95 | 0.0631 → 0.0052 | 0.0032 | 0 | 0.442 | 4.20 |
| svgf | diffuse | 16.88 → **39.90** | 39.88 | 39.90 | 40.06 | 40.06 | 40.21 | – | – | 0.1661 → 0.0055 | -0.0011 | 0 | 1.678 | 4.10 |
| svgf | specular | 34.83 → **44.31** | 44.27 | 44.31 | 44.23 | 44.19 | 45.63 | – | – | 0.0094 → 0.0012 | 0.0004 | 0 | 1.678 | 4.10 |
| svgf-auto | diffuse | 16.88 → **39.85** | 39.82 | 39.85 | 39.98 | 39.98 | 40.07 | – | – | 0.1661 → 0.0054 | -0.0008 | 0 | 1.927 | 4.40 |
| svgf-auto | specular | 34.83 → **45.32** | 45.26 | 45.32 | 45.37 | 45.31 | 47.00 | – | – | 0.0094 → 0.0011 | 0.0003 | 0 | 1.927 | 4.40 |

Visibility, dynamic vs static region (dynamic: reference range over frames t-4..t > 0.05, reprojected; 6913 px per frame). Pooled PSNR; flicker = mean |e_t − e_t−1| and tPSNR, motion-compensated, valid history.

| denoiser | dynamic PSNR | dynamic flicker | dynamic tPSNR | dynamic boil | static PSNR | static penumbra | static flicker | static tPSNR | static penumbra boil |
|---|---|---|---|---|---|---|---|---|---|
| noisy | 7.76 | 0.3739 | 4.84 | 0.4044 | 16.41 | 7.82 | 0.0470 | 13.38 | 0.4075 |
| accumulate | 15.77 | 0.0773 | 16.14 | 0.0443 | 26.55 | 20.13 | 0.0064 | 28.34 | 0.0448 |
| ffx-shadows | 15.02 | 0.0654 | 17.30 | 0.0463 | 27.14 | 24.05 | 0.0031 | 32.56 | 0.0123 |
| nrd-sigma | 11.95 | 0.1533 | 9.70 | 0.2215 | 26.21 | 18.51 | 0.0051 | 25.18 | 0.0968 |
| shadows | 18.04 | 0.0563 | 18.70 | 0.0489 | 32.23 | 29.55 | 0.0026 | 32.80 | 0.0103 |
| reference (its own boil) | | | | 0.0730 | | | | | 0.0108 |
