# m8-glass-still: replay scores

960×540, 16 frames, resets at [0], referenceSpp 256. Metrics: CAPTURE-FORMAT.md; settled = ≥ 8 frames after a reset. PSNR, settled, last frame and penumbra are means of per-frame dB; pooled = PSNR of the mean MSE over all frames and pixels; capped = mean of per-frame dB clipped at 60 dB.

| denoiser | signal | PSNR dB (noisy → out) | pooled | capped | settled | settled pooled | last frame | penumbra | penumbra pooled | flicker (noisy → out) | bias | non-finite | GPU ms | wall ms |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| tr-old | visibility | 19.89 → **38.62** | 38.52 | 38.62 | 39.29 | 39.28 | 39.65 | 26.75 | 26.64 | 0.0280 → 0.0008 | 0.0129 | 0 | 1.350 | 2.70 |
| tr-old | shadow-rgb | 20.82 → **38.01** | 37.32 | 38.01 | 39.11 | 39.10 | 39.43 | 29.87 | 29.06 | 0.0300 → 0.0011 | 0.0048 | 0 | 1.350 | 2.70 |
| tr-new | visibility | 19.89 → **38.81** | 38.68 | 38.81 | 39.54 | 39.53 | 39.85 | 26.87 | 26.72 | 0.0280 → 0.0007 | 0.0128 | 0 | 1.372 | 2.50 |
| tr-new | shadow-rgb | 20.82 → **38.18** | 37.43 | 38.18 | 39.34 | 39.33 | 39.62 | 30.00 | 29.12 | 0.0300 → 0.0010 | 0.0048 | 0 | 1.372 | 2.50 |

shadow-rgb (v1): rgb clamped to [0, 1]; penumbra = any reference channel in (0.02, 0.98); tint = reference chroma > 0.02 (50741 px per frame); chroma error = mean |S/ΣS − R/ΣR|; dynamic / boil on the mean of the clamped channels.

| denoiser | pooled | penumbra pooled | tint PSNR | chroma err | dynamic PSNR | dynamic boil | static penumbra | static penumbra boil |
|---|---|---|---|---|---|---|---|---|
| noisy | 20.82 | 11.78 | 14.28 | 0.0620 | – | – | 11.78 | 0.3155 |
| tr-old | 37.32 | 29.06 | 31.68 | 0.0039 | – | – | 29.06 | 0.0117 |
| tr-new | 37.43 | 29.12 | 31.67 | 0.0039 | – | – | 29.12 | 0.0120 |
| reference (its own boil) | | | | | | – | | 0.0000 |


