# golden-G5-turntable: replay scores

960×540, 64 frames, resets at [0], referenceSpp 4096. Metrics: CAPTURE-FORMAT.md; settled = ≥ 8 frames after a reset. PSNR, settled, last frame and penumbra are means of per-frame dB; pooled = PSNR of the mean MSE over all frames and pixels; capped = mean of per-frame dB clipped at 60 dB.

| denoiser | signal | PSNR dB (noisy → out) | pooled | capped | settled | settled pooled | last frame | penumbra | penumbra pooled | flicker (noisy → out) | bias | non-finite | GPU ms | wall ms |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| nrd-reblur | diffuse | 21.13 → **35.96** | 35.94 | 35.96 | 35.98 | 35.97 | 35.77 | – | – | 0.0964 → 0.0019 | -0.0023 | 0 | 1.318 | 1.51 |
| nrd-reblur | specular | 35.60 → **42.42** | 42.23 | 42.42 | 41.99 | 41.92 | 42.38 | – | – | 0.0176 → 0.0010 | -0.0002 | 0 | 1.318 | 1.51 |
| nrd-reblur-tunedD | diffuse | 21.13 → **36.35** | 36.32 | 36.35 | 36.27 | 36.24 | 35.89 | – | – | 0.0964 → 0.0018 | -0.0036 | 0 | 1.187 | 1.30 |
| nrd-reblur-tunedD | specular | 35.60 → **42.37** | 42.16 | 42.37 | 41.91 | 41.84 | 42.29 | – | – | 0.0176 → 0.0010 | -0.0001 | 0 | 1.187 | 1.30 |
| nrd-reblur-tunedS | diffuse | 21.13 → **36.30** | 36.27 | 36.30 | 36.25 | 36.22 | 35.90 | – | – | 0.0964 → 0.0018 | -0.0034 | 0 | 1.077 | 1.21 |
| nrd-reblur-tunedS | specular | 35.60 → **42.34** | 42.14 | 42.34 | 41.90 | 41.82 | 42.24 | – | – | 0.0176 → 0.0010 | -0.0002 | 0 | 1.077 | 1.21 |
| nrd-reference | diffuse | 21.13 → **31.61** | 30.85 | 31.61 | 32.12 | 32.12 | 32.63 | – | – | 0.0964 → 0.0059 | -0.0004 | 0 | 0.407 | – |
| nrd-reference | specular | 35.60 → **36.23** | 36.11 | 36.23 | 35.90 | 35.87 | 36.36 | – | – | 0.0176 → 0.0017 | 0.0004 | 0 | 0.407 | – |
| nrd-reference | visibility | 25.33 → **20.45** | 20.22 | 20.45 | 19.91 | 19.88 | 20.02 | 10.70 | 10.61 | 0.0091 → 0.0069 | 0.1268 | 0 | 0.407 | – |
| nrd-relax | diffuse | 21.13 → **36.96** | 36.95 | 36.96 | 37.01 | 37.01 | 37.21 | – | – | 0.0964 → 0.0016 | -0.0005 | 0 | 1.551 | 1.74 |
| nrd-relax | specular | 35.60 → **43.89** | 43.83 | 43.89 | 44.00 | 43.97 | 44.24 | – | – | 0.0176 → 0.0009 | -0.0001 | 0 | 1.551 | 1.74 |
| ours-auto | diffuse | 21.13 → **38.00** | 38.00 | 38.00 | 38.01 | 38.01 | 38.27 | – | – | 0.0964 → 0.0016 | -0.0010 | 0 | 12.068 | 18.20 |
| ours-auto | specular | 35.60 → **49.40** | 49.38 | 49.40 | 49.31 | 49.28 | 49.90 | – | – | 0.0176 → 0.0006 | -0.0001 | 0 | 12.068 | 18.20 |

Visibility, dynamic vs static region (dynamic: reference range over frames t-4..t > 0.05, reprojected; 5040 px per frame). Pooled PSNR; flicker = mean |e_t − e_t−1| and tPSNR, motion-compensated, valid history.

| denoiser | dynamic PSNR | dynamic flicker | dynamic tPSNR | dynamic boil | static PSNR | static penumbra | static flicker | static tPSNR | static penumbra boil | edge sharpness |
|---|---|---|---|---|---|---|---|---|---|---|
| noisy | 8.94 | 0.3348 | 5.70 | 0.3985 | 28.12 | 8.29 | 0.0045 | 23.72 | 0.4856 | 1.274 |
| nrd-reference | 7.53 | 0.1665 | 11.10 | 0.0537 | 21.17 | 13.30 | 0.0032 | 29.63 | 0.0335 | 0.165 |
| reference (its own boil) | | | | 0.1481 | | | | | 0.0269 | 1 |
