# golden-G4-hold-light-on: replay scores

960×540, 32 frames, resets at [0], referenceSpp 16384. Metrics: CAPTURE-FORMAT.md; settled = ≥ 8 frames after a reset. PSNR, settled, last frame and penumbra are means of per-frame dB; pooled = PSNR of the mean MSE over all frames and pixels; capped = mean of per-frame dB clipped at 60 dB.

| denoiser | signal | PSNR dB (noisy → out) | pooled | capped | settled | settled pooled | last frame | penumbra | penumbra pooled | flicker (noisy → out) | bias | non-finite | GPU ms | wall ms |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| nrd-reblur | diffuse | 13.18 → **24.07** | 20.90 | 24.07 | 22.81 | 19.91 | 21.98 | – | – | 0.2201 → 0.0102 | -0.0519 | 0 | 3.750 | 5.59 |
| nrd-reblur | specular | 30.20 → **37.33** | 36.57 | 37.33 | 36.82 | 36.02 | 36.69 | – | – | 0.0191 → 0.0007 | -0.0037 | 0 | 3.750 | 5.59 |
| nrd-reblur-tunedD | diffuse | 13.18 → **25.01** | 21.46 | 25.01 | 23.57 | 20.41 | 22.62 | – | – | 0.2201 → 0.0095 | -0.0474 | 0 | 4.349 | 5.85 |
| nrd-reblur-tunedD | specular | 30.20 → **37.86** | 36.80 | 37.86 | 37.13 | 36.10 | 36.65 | – | – | 0.0191 → 0.0006 | -0.0041 | 0 | 4.349 | 5.85 |
| nrd-reblur-tunedS | diffuse | 13.18 → **24.95** | 21.44 | 24.95 | 23.54 | 20.40 | 22.60 | – | – | 0.2201 → 0.0095 | -0.0474 | 0 | 1.456 | 1.69 |
| nrd-reblur-tunedS | specular | 30.20 → **38.93** | 37.51 | 38.93 | 38.11 | 36.74 | 37.37 | – | – | 0.0191 → 0.0006 | -0.0038 | 0 | 1.456 | 1.69 |
| nrd-reference | diffuse | 13.18 → **20.16** | 19.06 | 20.16 | 20.67 | 19.66 | 21.78 | – | – | 0.2201 → 0.0246 | -0.0531 | 0 | 0.406 | – |
| nrd-reference | specular | 30.20 → **38.18** | 37.06 | 38.18 | 38.50 | 37.50 | 38.83 | – | – | 0.0191 → 0.0017 | -0.0032 | 0 | 0.406 | – |
| nrd-reference | visibility | 16.35 → **31.85** | 27.67 | 31.85 | 34.17 | 33.66 | 36.75 | 23.71 | 19.50 | 0.0642 → 0.0051 | -0.0001 | 0 | 0.406 | – |
| nrd-relax | diffuse | 13.18 → **26.71** | 23.02 | 26.71 | 25.32 | 21.96 | 25.49 | – | – | 0.2201 → 0.0098 | -0.0367 | 0 | 2.478 | 3.01 |
| nrd-relax | specular | 30.20 → **38.78** | 37.76 | 38.78 | 38.35 | 37.21 | 38.14 | – | – | 0.0191 → 0.0006 | -0.0041 | 0 | 2.478 | 3.01 |
| ours-auto | diffuse | 13.18 → **30.94** | 30.56 | 30.94 | 31.17 | 30.72 | 32.00 | – | – | 0.2201 → 0.0066 | -0.0048 | 0 | 23.948 | 26.90 |
| ours-auto | specular | 30.20 → **45.27** | 44.91 | 45.27 | 45.10 | 44.72 | 44.99 | – | – | 0.0191 → 0.0005 | -0.0006 | 0 | 23.948 | 26.90 |
