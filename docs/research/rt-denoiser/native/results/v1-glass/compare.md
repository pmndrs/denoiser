# v1-glass: replay scores

960×540, 16 frames, resets at [0], referenceSpp 256. Metrics: CAPTURE-FORMAT.md; settled = ≥ 8 frames after a reset. PSNR, settled, last frame and penumbra are means of per-frame dB; pooled = PSNR of the mean MSE over all frames and pixels; capped = mean of per-frame dB clipped at 60 dB.

| denoiser | signal | PSNR dB (noisy → out) | pooled | capped | settled | settled pooled | last frame | penumbra | penumbra pooled | flicker (noisy → out) | bias | non-finite | GPU ms | wall ms |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| nrd-sigma-m1 | visibility | 20.30 → **29.89** | 29.88 | 29.89 | 29.73 | 29.73 | 29.64 | 17.84 | 17.84 | 0.0274 → 0.0039 | 0.0191 | 0 | 0.358 | 0.46 |
| nrd-sigma-translucency-m0 | visibility | 20.30 → **29.89** | 29.88 | 29.89 | 29.73 | 29.73 | 29.63 | 17.84 | 17.84 | 0.0274 → 0.0039 | 0.0191 | 0 | 0.414 | 0.51 |
| nrd-sigma-translucency-m0 | shadow-rgb | 21.08 → **29.78** | 29.77 | 29.78 | 29.70 | 29.69 | 29.59 | 20.41 | 20.40 | 0.0284 → 0.0054 | 0.0055 | 0 | 0.414 | 0.51 |
| nrd-sigma-translucency-m1 | visibility | 20.30 → **12.78** | 12.78 | 12.78 | 12.78 | 12.78 | 12.78 | 8.03 | 8.03 | 0.0274 → 0.0041 | -0.2232 | 0 | 0.421 | 0.52 |
| nrd-sigma-translucency-m1 | shadow-rgb | 21.08 → **30.18** | 30.18 | 30.18 | 30.02 | 30.02 | 29.92 | 20.89 | 20.89 | 0.0284 → 0.0040 | 0.0024 | 0 | 0.421 | 0.52 |
| shadows-translucent | visibility | 20.30 → **35.48** | 35.43 | 35.48 | 36.00 | 35.99 | 36.40 | 24.31 | 24.25 | 0.0274 → 0.0028 | 0.0089 | 0 | 0.649 | 4.20 |
| shadows-translucent | shadow-rgb | 21.08 → **35.37** | 35.15 | 35.37 | 36.07 | 36.06 | 36.46 | 26.97 | 26.63 | 0.0284 → 0.0029 | 0.0038 | 0 | 0.649 | 4.20 |

Visibility, dynamic vs static region (dynamic: reference range over frames t-4..t > 0.05, reprojected; 6059 px per frame). Pooled PSNR; flicker = mean |e_t − e_t−1| and tPSNR, motion-compensated, valid history.

| denoiser | dynamic PSNR | dynamic flicker | dynamic tPSNR | dynamic boil | static PSNR | static penumbra | static flicker | static tPSNR | static penumbra boil |
|---|---|---|---|---|---|---|---|---|---|
| noisy | 7.47 | 0.3889 | 4.62 | 0.4155 | 21.35 | 7.48 | 0.0145 | 18.56 | 0.4121 |
| nrd-sigma-m1 | 16.05 | 0.0653 | 15.37 | 0.1224 | 31.27 | 18.51 | 0.0015 | 33.30 | 0.0683 |
| nrd-sigma-translucency-m0 | 16.05 | 0.0653 | 15.37 | 0.1224 | 31.27 | 18.51 | 0.0015 | 33.30 | 0.0683 |
| nrd-sigma-translucency-m1 | 9.75 | 0.0679 | 15.34 | 0.1224 | 12.83 | 7.65 | 0.0016 | 33.24 | 0.0683 |
| shadows-translucent | 20.59 | 0.0419 | 23.13 | 0.0608 | 37.29 | 26.17 | 0.0011 | 41.68 | 0.0149 |
| reference (its own boil) | | | | 0.0626 | | | | | 0.0148 |

shadow-rgb (v1): rgb clamped to [0, 1]; penumbra = any reference channel in (0.02, 0.98); tint = reference chroma > 0.02 (36007 px per frame); chroma error = mean |S/ΣS − R/ΣR|; dynamic / boil on the mean of the clamped channels.

| denoiser | pooled | penumbra pooled | tint PSNR | chroma err | dynamic PSNR | dynamic boil | static penumbra | static penumbra boil |
|---|---|---|---|---|---|---|---|---|
| noisy | 21.08 | 11.03 | 13.96 | 0.0680 | 7.64 | 0.4052 | 11.68 | 0.2479 |
| nrd-sigma-translucency-m0 | 29.77 | 20.40 | 23.84 | 0.0096 | 15.60 | 0.1314 | 21.52 | 0.0592 |
| nrd-sigma-translucency-m1 | 30.18 | 20.89 | 25.66 | 0.0069 | 15.58 | 0.1313 | 22.25 | 0.0455 |
| shadows-translucent | 35.15 | 26.63 | 32.03 | 0.0034 | 20.04 | 0.0651 | 28.75 | 0.0112 |
| reference (its own boil) | | | | | | 0.0669 | | 0.0092 |
