# golden-G4-pan-light-fade: replay scores

960×540, 64 frames, resets at [0], referenceSpp 4096. Metrics: CAPTURE-FORMAT.md; settled = ≥ 8 frames after a reset. PSNR, settled, last frame and penumbra are means of per-frame dB; pooled = PSNR of the mean MSE over all frames and pixels; capped = mean of per-frame dB clipped at 60 dB.

| denoiser | signal | PSNR dB (noisy → out) | pooled | capped | settled | settled pooled | last frame | penumbra | penumbra pooled | flicker (noisy → out) | bias | non-finite | GPU ms | wall ms |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| nrd-reblur | diffuse | 12.96 → **24.85** | 24.40 | 24.85 | 24.51 | 24.12 | 25.28 | – | – | 0.2449 → 0.0392 | -0.0156 | 0 | 1.581 | 1.70 |
| nrd-reblur | specular | 32.70 → **39.89** | 39.40 | 39.89 | 40.15 | 39.63 | 43.85 | – | – | 0.0153 → 0.0051 | -0.0003 | 0 | 1.581 | 1.70 |
| nrd-reblur-tunedD | diffuse | 12.96 → **26.29** | 25.85 | 26.29 | 26.02 | 25.60 | 27.36 | – | – | 0.2449 → 0.0316 | -0.0099 | 0 | 1.571 | 1.69 |
| nrd-reblur-tunedD | specular | 32.70 → **40.51** | 40.04 | 40.51 | 40.74 | 40.22 | 44.77 | – | – | 0.0153 → 0.0047 | -0.0006 | 0 | 1.571 | 1.69 |
| nrd-reblur-tunedS | diffuse | 12.96 → **26.17** | 25.74 | 26.17 | 25.90 | 25.49 | 27.20 | – | – | 0.2449 → 0.0321 | -0.0099 | 0 | 1.571 | 1.70 |
| nrd-reblur-tunedS | specular | 32.70 → **41.19** | 40.69 | 41.19 | 41.37 | 40.80 | 45.63 | – | – | 0.0153 → 0.0042 | -0.0004 | 0 | 1.571 | 1.70 |
| nrd-reference | diffuse | 12.96 → **12.96** | 12.84 | 12.96 | 12.75 | 12.65 | 11.99 | – | – | 0.2449 → 0.2449 | -0.0785 | 0 | 0.407 | – |
| nrd-reference | specular | 32.70 → **32.70** | 32.07 | 32.70 | 32.96 | 32.26 | 36.71 | – | – | 0.0153 → 0.0153 | -0.0007 | 0 | 0.407 | – |
| nrd-reference | visibility | 17.33 → **17.33** | 17.25 | 17.33 | 17.15 | 17.09 | 17.93 | 8.20 | 8.20 | 0.0642 → 0.0642 | 0.0002 | 0 | 0.407 | – |
| nrd-relax | diffuse | 12.96 → **27.64** | 27.29 | 27.64 | 27.39 | 27.05 | 28.34 | – | – | 0.2449 → 0.0265 | -0.0059 | 0 | 1.946 | 2.10 |
| nrd-relax | specular | 32.70 → **40.91** | 40.41 | 40.91 | 41.21 | 40.70 | 44.59 | – | – | 0.0153 → 0.0043 | -0.0010 | 0 | 1.946 | 2.10 |
| ours-auto | diffuse | 12.96 → **29.23** | 29.15 | 29.23 | 29.22 | 29.14 | 30.01 | – | – | 0.2449 → 0.0229 | -0.0053 | 0 | 25.104 | 29.20 |
| ours-auto | specular | 32.70 → **44.58** | 43.84 | 44.58 | 44.84 | 44.02 | 49.84 | – | – | 0.0153 → 0.0030 | -0.0001 | 0 | 25.104 | 29.20 |

Visibility, dynamic vs static region (dynamic: reference range over frames t-4..t > 0.05, reprojected; 19791 px per frame). Pooled PSNR; flicker = mean |e_t − e_t−1| and tPSNR, motion-compensated, valid history.

| denoiser | dynamic PSNR | dynamic flicker | dynamic tPSNR | dynamic boil | static PSNR | static penumbra | static flicker | static tPSNR | static penumbra boil | edge sharpness |
|---|---|---|---|---|---|---|---|---|---|---|
| noisy | 8.50 | 0.3213 | 5.66 | 0.4263 | 18.55 | 8.49 | 0.0310 | 15.43 | 0.3791 | 1.218 |
| nrd-reference | 8.50 | 0.3213 | 5.66 | 0.4263 | 18.55 | 8.49 | 0.0310 | 15.43 | 0.3791 | 1.218 |
| reference (its own boil) | | | | 0.2257 | | | | | 0.0461 | 1 |
