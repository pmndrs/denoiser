# v1-glass-still: replay scores

960×540, 16 frames, resets at [0], referenceSpp 256. Metrics: CAPTURE-FORMAT.md; settled = ≥ 8 frames after a reset. PSNR, settled, last frame and penumbra are means of per-frame dB; pooled = PSNR of the mean MSE over all frames and pixels; capped = mean of per-frame dB clipped at 60 dB.

| denoiser | signal | PSNR dB (noisy → out) | pooled | capped | settled | settled pooled | last frame | penumbra | penumbra pooled | flicker (noisy → out) | bias | non-finite | GPU ms | wall ms |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| nrd-sigma-m1 | visibility | 19.89 → **32.08** | 32.07 | 32.08 | 32.25 | 32.25 | 32.31 | 20.04 | 20.03 | 0.0280 → 0.0007 | 0.0300 | 0 | 0.339 | 0.44 |
| nrd-sigma-translucency-m0 | visibility | 19.89 → **32.08** | 32.07 | 32.08 | 32.25 | 32.25 | 32.31 | 20.04 | 20.03 | 0.0280 → 0.0007 | 0.0300 | 0 | 0.389 | 0.49 |
| nrd-sigma-translucency-m0 | shadow-rgb | 20.82 → **30.99** | 30.96 | 30.99 | 31.28 | 31.28 | 31.32 | 22.19 | 22.16 | 0.0300 → 0.0032 | 0.0094 | 0 | 0.389 | 0.49 |
| nrd-sigma-translucency-m1 | visibility | 19.89 → **11.20** | 11.20 | 11.20 | 11.20 | 11.20 | 11.20 | 7.53 | 7.53 | 0.0280 → 0.0006 | -0.2620 | 0 | 0.409 | 0.51 |
| nrd-sigma-translucency-m1 | shadow-rgb | 20.82 → **32.41** | 32.40 | 32.41 | 32.58 | 32.58 | 32.61 | 23.75 | 23.74 | 0.0300 → 0.0007 | 0.0056 | 0 | 0.409 | 0.51 |
| shadows-translucent | visibility | 19.89 → **38.04** | 37.92 | 38.04 | 38.80 | 38.79 | 39.24 | 26.64 | 26.53 | 0.0280 → 0.0008 | 0.0132 | 0 | 0.641 | 4.10 |
| shadows-translucent | shadow-rgb | 20.82 → **37.48** | 36.87 | 37.48 | 38.62 | 38.61 | 39.02 | 29.78 | 28.98 | 0.0300 → 0.0011 | 0.0049 | 0 | 0.641 | 4.10 |

shadow-rgb (v1): rgb clamped to [0, 1]; penumbra = any reference channel in (0.02, 0.98); tint = reference chroma > 0.02 (50742 px per frame); chroma error = mean |S/ΣS − R/ΣR|; dynamic / boil on the mean of the clamped channels.

| denoiser | pooled | penumbra pooled | tint PSNR | chroma err | dynamic PSNR | dynamic boil | static penumbra | static penumbra boil |
|---|---|---|---|---|---|---|---|---|
| noisy | 20.82 | 11.78 | 14.28 | 0.0621 | – | – | 11.78 | 0.3155 |
| nrd-sigma-translucency-m0 | 30.96 | 22.16 | 23.01 | 0.0120 | – | – | 22.16 | 0.0604 |
| nrd-sigma-translucency-m1 | 32.40 | 23.74 | 25.81 | 0.0069 | – | – | 23.74 | 0.0353 |
| shadows-translucent | 36.87 | 28.98 | 31.69 | 0.0039 | – | – | 28.98 | 0.0117 |
| reference (its own boil) | | | | | | – | | 0.0000 |
