# v1-glass-moving: replay scores

960×540, 40 frames, resets at [0], referenceSpp 256. Metrics: CAPTURE-FORMAT.md; settled = ≥ 8 frames after a reset. PSNR, settled, last frame and penumbra are means of per-frame dB; pooled = PSNR of the mean MSE over all frames and pixels; capped = mean of per-frame dB clipped at 60 dB.

| denoiser | signal | PSNR dB (noisy → out) | pooled | capped | settled | settled pooled | last frame | penumbra | penumbra pooled | flicker (noisy → out) | bias | non-finite | GPU ms | wall ms |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| nrd-sigma-m1 | visibility | 19.68 → **28.27** | 28.22 | 28.27 | 28.28 | 28.24 | 29.38 | 16.31 | 16.28 | 0.0318 → 0.0063 | 0.0521 | 0 | 0.340 | 0.44 |
| nrd-sigma-translucency-m0 | visibility | 19.68 → **28.27** | 28.22 | 28.27 | 28.28 | 28.24 | 29.38 | 16.31 | 16.28 | 0.0318 → 0.0063 | 0.0521 | 0 | 0.393 | 0.49 |
| nrd-sigma-translucency-m0 | shadow-rgb | 20.52 → **27.99** | 27.94 | 27.99 | 28.04 | 28.00 | 28.86 | 19.19 | 19.16 | 0.0338 → 0.0086 | 0.0110 | 0 | 0.393 | 0.49 |
| nrd-sigma-translucency-m1 | visibility | 19.68 → **11.23** | 11.22 | 11.23 | 11.17 | 11.16 | 11.58 | 7.61 | 7.63 | 0.0318 → 0.0090 | -0.2433 | 0 | 0.410 | 0.51 |
| nrd-sigma-translucency-m1 | shadow-rgb | 20.52 → **29.06** | 29.01 | 29.06 | 29.07 | 29.03 | 30.16 | 20.32 | 20.28 | 0.0338 → 0.0061 | 0.0118 | 0 | 0.410 | 0.51 |
| shadows-translucent | visibility | 19.68 → **32.90** | 32.82 | 32.90 | 32.66 | 32.61 | 32.40 | 21.09 | 21.01 | 0.0318 → 0.0039 | 0.0252 | 0 | 0.661 | 4.10 |
| shadows-translucent | shadow-rgb | 20.52 → **33.28** | 33.20 | 33.28 | 33.24 | 33.18 | 33.26 | 24.79 | 24.70 | 0.0338 → 0.0045 | 0.0089 | 0 | 0.661 | 4.10 |

Visibility, dynamic vs static region (dynamic: reference range over frames t-4..t > 0.05, reprojected; 35820 px per frame). Pooled PSNR; flicker = mean |e_t − e_t−1| and tPSNR, motion-compensated, valid history.

| denoiser | dynamic PSNR | dynamic flicker | dynamic tPSNR | dynamic boil | static PSNR | static penumbra | static flicker | static tPSNR | static penumbra boil |
|---|---|---|---|---|---|---|---|---|---|
| noisy | 8.96 | 0.3767 | 4.96 | 0.4204 | 26.50 | 7.92 | 0.0051 | 22.96 | 0.4761 |
| nrd-sigma-m1 | 17.41 | 0.0784 | 18.44 | 0.0562 | 35.64 | 17.47 | 0.0006 | 34.62 | 0.1258 |
| nrd-sigma-translucency-m0 | 17.41 | 0.0784 | 18.44 | 0.0562 | 35.64 | 17.47 | 0.0006 | 34.62 | 0.1258 |
| nrd-sigma-translucency-m1 | 5.45 | 0.1085 | 15.73 | 0.0384 | 12.22 | 11.07 | 0.0006 | 34.59 | 0.1256 |
| shadows-translucent | 22.38 | 0.0469 | 23.78 | 0.0606 | 38.79 | 21.77 | 0.0005 | 45.07 | 0.0263 |
| reference (its own boil) | | | | 0.0683 | | | | | 0.0053 |

shadow-rgb (v1): rgb clamped to [0, 1]; penumbra = any reference channel in (0.02, 0.98); tint = reference chroma > 0.02 (50330 px per frame); chroma error = mean |S/ΣS − R/ΣR|; dynamic / boil on the mean of the clamped channels.

| denoiser | pooled | penumbra pooled | tint PSNR | chroma err | dynamic PSNR | dynamic boil | static penumbra | static penumbra boil |
|---|---|---|---|---|---|---|---|---|
| noisy | 20.47 | 11.51 | 14.09 | 0.0641 | 12.08 | 0.2890 | 11.26 | 0.3263 |
| nrd-sigma-translucency-m0 | 27.94 | 19.16 | 20.14 | 0.0191 | 19.38 | 0.0562 | 19.63 | 0.0984 |
| nrd-sigma-translucency-m1 | 29.01 | 20.28 | 22.01 | 0.0118 | 20.47 | 0.0349 | 20.78 | 0.0844 |
| shadows-translucent | 33.20 | 24.70 | 27.05 | 0.0071 | 25.18 | 0.0420 | 24.31 | 0.0185 |
| reference (its own boil) | | | | | | 0.0461 | | 0.0066 |
