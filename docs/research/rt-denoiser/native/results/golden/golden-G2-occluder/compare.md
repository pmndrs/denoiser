# golden-G2-occluder: replay scores

960×540, 64 frames, resets at [0], referenceSpp 4096. Metrics: CAPTURE-FORMAT.md; settled = ≥ 8 frames after a reset. PSNR, settled, last frame and penumbra are means of per-frame dB; pooled = PSNR of the mean MSE over all frames and pixels; capped = mean of per-frame dB clipped at 60 dB.

| denoiser | signal | PSNR dB (noisy → out) | pooled | capped | settled | settled pooled | last frame | penumbra | penumbra pooled | flicker (noisy → out) | bias | non-finite | GPU ms | wall ms |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ffx-shadows | visibility | 16.85 → **28.58** | 28.53 | 28.58 | 28.35 | 28.34 | 28.41 | 22.72 | 22.70 | 0.0468 → 0.0009 | -0.0477 | 0 | 3.857 | 6.30 |
| nrd-reblur | diffuse | 15.12 → **31.86** | 31.81 | 31.86 | 32.02 | 32.01 | 31.75 | – | – | 0.2264 → 0.0007 | -0.0192 | 0 | 1.267 | 1.38 |
| nrd-reblur | specular | 32.99 → **40.05** | 39.94 | 40.05 | 40.11 | 40.02 | 38.88 | – | – | 0.0081 → 0.0003 | -0.0002 | 0 | 1.267 | 1.38 |
| nrd-reblur-tunedD | diffuse | 15.12 → **36.90** | 36.88 | 36.90 | 37.06 | 37.05 | 36.94 | – | – | 0.2264 → 0.0004 | -0.0038 | 0 | 1.290 | 1.42 |
| nrd-reblur-tunedD | specular | 32.99 → **40.42** | 40.29 | 40.42 | 40.44 | 40.31 | 38.99 | – | – | 0.0081 → 0.0003 | -0.0002 | 0 | 1.290 | 1.42 |
| nrd-reblur-tunedS | diffuse | 15.12 → **36.53** | 36.50 | 36.53 | 36.69 | 36.69 | 36.58 | – | – | 0.2264 → 0.0004 | -0.0044 | 0 | 1.215 | 1.34 |
| nrd-reblur-tunedS | specular | 32.99 → **40.44** | 40.33 | 40.44 | 40.41 | 40.30 | 39.02 | – | – | 0.0081 → 0.0002 | -0.0003 | 0 | 1.215 | 1.34 |
| nrd-reference | diffuse | 15.12 → **30.82** | 27.44 | 30.82 | 32.10 | 31.44 | 34.81 | – | – | 0.2264 → 0.0105 | -0.0023 | 0 | 0.406 | – |
| nrd-reference | specular | 32.99 → **37.14** | 36.95 | 37.14 | 37.07 | 36.96 | 35.74 | – | – | 0.0081 → 0.0005 | 0.0001 | 0 | 0.406 | – |
| nrd-reference | visibility | 16.85 → **27.71** | 26.82 | 27.71 | 28.17 | 28.02 | 26.08 | 22.13 | 20.02 | 0.0468 → 0.0028 | 0.0029 | 0 | 0.406 | – |
| nrd-relax | diffuse | 15.12 → **35.28** | 35.28 | 35.28 | 35.35 | 35.35 | 35.21 | – | – | 0.2264 → 0.0006 | -0.0111 | 0 | 1.637 | 1.77 |
| nrd-relax | specular | 32.99 → **42.10** | 41.95 | 42.10 | 42.23 | 42.14 | 41.20 | – | – | 0.0081 → 0.0003 | -0.0006 | 0 | 1.637 | 1.77 |
| nrd-sigma | visibility | 16.85 → **21.49** | 21.49 | 21.49 | 21.50 | 21.50 | 21.56 | 12.48 | 12.48 | 0.0468 → 0.0147 | 0.0074 | 0 | 0.268 | 0.38 |
| ours-auto | diffuse | 15.12 → **39.27** | 39.25 | 39.27 | 39.37 | 39.37 | 39.39 | – | – | 0.2264 → 0.0007 | -0.0009 | 0 | 24.265 | 27.90 |
| ours-auto | specular | 32.99 → **45.68** | 45.61 | 45.68 | 45.81 | 45.80 | 46.62 | – | – | 0.0081 → 0.0003 | -0.0001 | 0 | 24.265 | 27.90 |
| ours-shadows | visibility | 16.85 → **36.56** | 36.47 | 36.56 | 36.70 | 36.70 | 36.71 | 28.94 | 28.87 | 0.0468 → 0.0005 | -0.0001 | 0 | 1.986 | 6.40 |

Visibility, dynamic vs static region (dynamic: reference range over frames t-4..t > 0.05, reprojected; 824 px per frame). Pooled PSNR; flicker = mean |e_t − e_t−1| and tPSNR, motion-compensated, valid history.

| denoiser | dynamic PSNR | dynamic flicker | dynamic tPSNR | dynamic boil | static PSNR | static penumbra | static flicker | static tPSNR | static penumbra boil | edge sharpness |
|---|---|---|---|---|---|---|---|---|---|---|
| noisy | 7.43 | 0.4423 | 3.75 | 0.4549 | 16.90 | 7.81 | 0.0462 | 13.37 | 0.4216 | 1.823 |
| ffx-shadows | 16.35 | 0.0296 | 24.88 | 0.0362 | 28.64 | 22.88 | 0.0008 | 45.79 | 0.0084 | 0.662 |
| nrd-reference | 9.49 | 0.0378 | 24.14 | 0.0281 | 27.21 | 20.64 | 0.0027 | 34.33 | 0.0271 | 0.974 |
| nrd-sigma | 8.87 | 0.3016 | 5.62 | 0.3591 | 21.61 | 12.56 | 0.0143 | 18.73 | 0.2142 | 1.459 |
| ours-shadows | 22.97 | 0.0180 | 28.34 | 0.0184 | 36.62 | 29.03 | 0.0005 | 46.28 | 0.0062 | 0.934 |
| reference (its own boil) | | | | 0.0205 | | | | | 0.0014 | 1 |
