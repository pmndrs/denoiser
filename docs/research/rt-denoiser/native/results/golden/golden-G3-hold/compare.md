# golden-G3-hold: replay scores

960×540, 32 frames, resets at [0], referenceSpp 16384. Metrics: CAPTURE-FORMAT.md; settled = ≥ 8 frames after a reset. PSNR, settled, last frame and penumbra are means of per-frame dB; pooled = PSNR of the mean MSE over all frames and pixels; capped = mean of per-frame dB clipped at 60 dB.

| denoiser | signal | PSNR dB (noisy → out) | pooled | capped | settled | settled pooled | last frame | penumbra | penumbra pooled | flicker (noisy → out) | bias | non-finite | GPU ms | wall ms |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| nrd-reblur | diffuse | 16.75 → **32.41** | 31.92 | 32.41 | 33.26 | 33.22 | 34.09 | – | – | 0.0755 → 0.0020 | -0.0021 | 0 | 1.780 | 1.89 |
| nrd-reblur | specular | 38.07 → **45.58** | 45.36 | 45.58 | 46.24 | 46.19 | 47.13 | – | – | 0.0092 → 0.0002 | -0.0002 | 0 | 1.780 | 1.89 |
| nrd-reblur-tunedD | diffuse | 16.75 → **33.74** | 33.41 | 33.74 | 34.47 | 34.44 | 35.17 | – | – | 0.0755 → 0.0015 | -0.0007 | 0 | 1.482 | 1.60 |
| nrd-reblur-tunedD | specular | 38.07 → **46.54** | 46.26 | 46.54 | 47.30 | 47.23 | 48.32 | – | – | 0.0092 → 0.0001 | -0.0001 | 0 | 1.482 | 1.60 |
| nrd-reblur-tunedS | diffuse | 16.75 → **33.64** | 33.30 | 33.64 | 34.39 | 34.35 | 35.08 | – | – | 0.0755 → 0.0015 | -0.0007 | 0 | 1.338 | 1.46 |
| nrd-reblur-tunedS | specular | 38.07 → **48.89** | 48.60 | 48.89 | 49.66 | 49.61 | 50.45 | – | – | 0.0092 → 0.0001 | -0.0000 | 0 | 1.338 | 1.46 |
| nrd-reference | diffuse | 16.75 → **24.39** | 22.97 | 24.39 | 25.99 | 25.61 | 28.35 | – | – | 0.0755 → 0.0096 | -0.0069 | 0 | 0.408 | – |
| nrd-reference | specular | 38.07 → **49.99** | 47.57 | 49.99 | 51.86 | 51.57 | 53.98 | – | – | 0.0092 → 0.0007 | -0.0000 | 0 | 0.408 | – |
| nrd-reference | visibility | 21.62 → **37.24** | 33.01 | 37.24 | 39.57 | 39.06 | 42.14 | 23.77 | 19.52 | 0.0193 → 0.0015 | 0.0004 | 0 | 0.408 | – |
| nrd-relax | diffuse | 16.75 → **34.72** | 34.44 | 34.72 | 35.48 | 35.44 | 36.04 | – | – | 0.0755 → 0.0022 | -0.0006 | 0 | 2.273 | 2.76 |
| nrd-relax | specular | 38.07 → **48.11** | 46.93 | 48.11 | 49.63 | 49.40 | 51.29 | – | – | 0.0092 → 0.0002 | 0.0000 | 0 | 2.273 | 2.76 |
| ours-auto | diffuse | 16.75 → **33.45** | 33.30 | 33.45 | 34.01 | 34.00 | 34.19 | – | – | 0.0755 → 0.0031 | -0.0020 | 0 | 24.210 | 27.90 |
| ours-auto | specular | 38.07 → **52.95** | 52.87 | 52.95 | 53.21 | 53.21 | 53.24 | – | – | 0.0092 → 0.0001 | -0.0002 | 0 | 24.210 | 27.90 |
