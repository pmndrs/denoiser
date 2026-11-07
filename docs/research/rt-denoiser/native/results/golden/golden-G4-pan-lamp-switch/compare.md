# golden-G4-pan-lamp-switch: replay scores

960×540, 64 frames, resets at [0], referenceSpp 4096. Metrics: CAPTURE-FORMAT.md; settled = ≥ 8 frames after a reset. PSNR, settled, last frame and penumbra are means of per-frame dB; pooled = PSNR of the mean MSE over all frames and pixels; capped = mean of per-frame dB clipped at 60 dB.

| denoiser | signal | PSNR dB (noisy → out) | pooled | capped | settled | settled pooled | last frame | penumbra | penumbra pooled | flicker (noisy → out) | bias | non-finite | GPU ms | wall ms |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| nrd-reblur | diffuse | 13.08 → **24.96** | 24.35 | 24.96 | 24.82 | 24.18 | 25.94 | – | – | 0.2389 → 0.0410 | 0.0048 | 0 | 1.647 | 1.80 |
| nrd-reblur | specular | 33.65 → **40.78** | 38.65 | 40.78 | 41.40 | 39.09 | 46.50 | – | – | 0.0161 → 0.0052 | 0.0009 | 0 | 1.647 | 1.80 |
| nrd-reblur-tunedD | diffuse | 13.08 → **26.22** | 25.35 | 26.22 | 26.14 | 25.18 | 28.20 | – | – | 0.2389 → 0.0336 | 0.0099 | 0 | 1.609 | 1.78 |
| nrd-reblur-tunedD | specular | 33.65 → **41.44** | 39.31 | 41.44 | 42.01 | 39.67 | 47.83 | – | – | 0.0161 → 0.0048 | 0.0005 | 0 | 1.609 | 1.78 |
| nrd-reblur-tunedS | diffuse | 13.08 → **26.09** | 25.25 | 26.09 | 26.01 | 25.08 | 28.03 | – | – | 0.2389 → 0.0341 | 0.0101 | 0 | 1.546 | 1.67 |
| nrd-reblur-tunedS | specular | 33.65 → **42.11** | 39.91 | 42.11 | 42.64 | 40.17 | 48.78 | – | – | 0.0161 → 0.0044 | 0.0007 | 0 | 1.546 | 1.67 |
| nrd-reference | diffuse | 13.08 → **13.08** | 13.07 | 13.08 | 13.04 | 13.03 | 12.84 | – | – | 0.2389 → 0.2389 | -0.0749 | 0 | 0.408 | – |
| nrd-reference | specular | 33.65 → **33.65** | 31.41 | 33.65 | 34.29 | 31.84 | 38.34 | – | – | 0.0161 → 0.0161 | -0.0009 | 0 | 0.408 | – |
| nrd-reference | visibility | 17.33 → **17.33** | 17.25 | 17.33 | 17.15 | 17.09 | 17.93 | 8.20 | 8.20 | 0.0642 → 0.0642 | 0.0002 | 0 | 0.408 | – |
| nrd-relax | diffuse | 13.08 → **27.82** | 26.95 | 27.82 | 27.84 | 26.86 | 29.75 | – | – | 0.2389 → 0.0281 | 0.0084 | 0 | 1.995 | 2.22 |
| nrd-relax | specular | 33.65 → **41.82** | 39.92 | 41.82 | 42.46 | 40.46 | 46.28 | – | – | 0.0161 → 0.0044 | -0.0003 | 0 | 1.995 | 2.22 |
| ours-auto | diffuse | 13.08 → **29.57** | 29.17 | 29.57 | 29.81 | 29.38 | 31.29 | – | – | 0.2389 → 0.0243 | 0.0024 | 0 | 13.970 | 20.10 |
| ours-auto | specular | 33.65 → **45.83** | 43.27 | 45.83 | 46.48 | 43.66 | 52.56 | – | – | 0.0161 → 0.0030 | 0.0004 | 0 | 13.970 | 20.10 |

Visibility, dynamic vs static region (dynamic: reference range over frames t-4..t > 0.05, reprojected; 19791 px per frame). Pooled PSNR; flicker = mean |e_t − e_t−1| and tPSNR, motion-compensated, valid history.

| denoiser | dynamic PSNR | dynamic flicker | dynamic tPSNR | dynamic boil | static PSNR | static penumbra | static flicker | static tPSNR | static penumbra boil | edge sharpness |
|---|---|---|---|---|---|---|---|---|---|---|
| noisy | 8.50 | 0.3213 | 5.66 | 0.4263 | 18.55 | 8.49 | 0.0310 | 15.43 | 0.3791 | 1.218 |
| nrd-reference | 8.50 | 0.3213 | 5.66 | 0.4263 | 18.55 | 8.49 | 0.0310 | 15.43 | 0.3791 | 1.218 |
| reference (its own boil) | | | | 0.2257 | | | | | 0.0461 | 1 |
