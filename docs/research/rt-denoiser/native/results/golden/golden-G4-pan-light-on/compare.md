# golden-G4-pan-light-on: replay scores

960×540, 64 frames, resets at [0], referenceSpp 4096. Metrics: CAPTURE-FORMAT.md; settled = ≥ 8 frames after a reset. PSNR, settled, last frame and penumbra are means of per-frame dB; pooled = PSNR of the mean MSE over all frames and pixels; capped = mean of per-frame dB clipped at 60 dB.

| denoiser | signal | PSNR dB (noisy → out) | pooled | capped | settled | settled pooled | last frame | penumbra | penumbra pooled | flicker (noisy → out) | bias | non-finite | GPU ms | wall ms |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| nrd-reblur | diffuse | 12.88 → **24.86** | 23.88 | 24.86 | 24.51 | 23.57 | 25.31 | – | – | 0.2453 → 0.0410 | -0.0147 | 0 | 3.651 | 4.87 |
| nrd-reblur | specular | 32.66 → **39.75** | 39.15 | 39.75 | 39.99 | 39.32 | 43.85 | – | – | 0.0154 → 0.0052 | -0.0003 | 0 | 3.651 | 4.87 |
| nrd-reblur-tunedD | diffuse | 12.88 → **26.32** | 25.19 | 26.32 | 26.05 | 24.90 | 27.40 | – | – | 0.2453 → 0.0334 | -0.0090 | 0 | 4.753 | 6.08 |
| nrd-reblur-tunedD | specular | 32.66 → **40.37** | 39.75 | 40.37 | 40.57 | 39.88 | 44.77 | – | – | 0.0154 → 0.0048 | -0.0006 | 0 | 4.753 | 6.08 |
| nrd-reblur-tunedS | diffuse | 12.88 → **26.19** | 25.09 | 26.19 | 25.92 | 24.80 | 27.24 | – | – | 0.2453 → 0.0339 | -0.0089 | 0 | 4.766 | 6.21 |
| nrd-reblur-tunedS | specular | 32.66 → **41.04** | 40.36 | 41.04 | 41.19 | 40.42 | 45.64 | – | – | 0.0154 → 0.0044 | -0.0004 | 0 | 4.766 | 6.21 |
| nrd-reference | diffuse | 12.88 → **12.88** | 12.76 | 12.88 | 12.66 | 12.57 | 11.99 | – | – | 0.2453 → 0.2453 | -0.0799 | 0 | 0.407 | – |
| nrd-reference | specular | 32.66 → **32.66** | 32.00 | 32.66 | 32.91 | 32.19 | 36.71 | – | – | 0.0154 → 0.0154 | -0.0007 | 0 | 0.407 | – |
| nrd-reference | visibility | 17.33 → **17.33** | 17.25 | 17.33 | 17.15 | 17.09 | 17.93 | 8.20 | 8.20 | 0.0642 → 0.0642 | 0.0002 | 0 | 0.407 | – |
| nrd-relax | diffuse | 12.88 → **27.68** | 26.62 | 27.68 | 27.43 | 26.34 | 28.39 | – | – | 0.2453 → 0.0280 | -0.0050 | 0 | 4.747 | 5.69 |
| nrd-relax | specular | 32.66 → **40.79** | 40.10 | 40.79 | 41.07 | 40.32 | 44.60 | – | – | 0.0154 → 0.0044 | -0.0010 | 0 | 4.747 | 5.69 |
| ours-auto | diffuse | 12.88 → **29.40** | 29.29 | 29.40 | 29.42 | 29.30 | 30.01 | – | – | 0.2453 → 0.0234 | -0.0018 | 0 | 10.095 | 14.20 |
| ours-auto | specular | 32.66 → **44.54** | 43.76 | 44.54 | 44.80 | 43.93 | 49.84 | – | – | 0.0154 → 0.0030 | 0.0001 | 0 | 10.095 | 14.20 |

Visibility, dynamic vs static region (dynamic: reference range over frames t-4..t > 0.05, reprojected; 19791 px per frame). Pooled PSNR; flicker = mean |e_t − e_t−1| and tPSNR, motion-compensated, valid history.

| denoiser | dynamic PSNR | dynamic flicker | dynamic tPSNR | dynamic boil | static PSNR | static penumbra | static flicker | static tPSNR | static penumbra boil | edge sharpness |
|---|---|---|---|---|---|---|---|---|---|---|
| noisy | 8.50 | 0.3213 | 5.66 | 0.4263 | 18.55 | 8.49 | 0.0310 | 15.43 | 0.3791 | 1.218 |
| nrd-reference | 8.50 | 0.3213 | 5.66 | 0.4263 | 18.55 | 8.49 | 0.0310 | 15.43 | 0.3791 | 1.218 |
| reference (its own boil) | | | | 0.2257 | | | | | 0.0461 | 1 |
