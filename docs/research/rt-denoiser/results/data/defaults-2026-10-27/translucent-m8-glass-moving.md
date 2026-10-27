# m8-glass-moving: replay scores

960×540, 40 frames, resets at [0], referenceSpp 256. Metrics: CAPTURE-FORMAT.md; settled = ≥ 8 frames after a reset. PSNR, settled, last frame and penumbra are means of per-frame dB; pooled = PSNR of the mean MSE over all frames and pixels; capped = mean of per-frame dB clipped at 60 dB.

| denoiser | signal | PSNR dB (noisy → out) | pooled | capped | settled | settled pooled | last frame | penumbra | penumbra pooled | flicker (noisy → out) | bias | non-finite | GPU ms | wall ms |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| tr-old | visibility | 19.68 → **33.14** | 33.04 | 33.14 | 32.87 | 32.82 | 33.97 | 21.12 | 21.04 | 0.0318 → 0.0039 | 0.0251 | 0 | 1.457 | 2.60 |
| tr-old | shadow-rgb | 20.52 → **33.52** | 33.42 | 33.52 | 33.45 | 33.39 | 34.80 | 24.82 | 24.72 | 0.0338 → 0.0045 | 0.0090 | 0 | 1.457 | 2.60 |
| tr-new | visibility | 19.68 → **33.22** | 33.12 | 33.22 | 32.96 | 32.91 | 34.02 | 21.17 | 21.10 | 0.0318 → 0.0038 | 0.0250 | 0 | 1.468 | 2.90 |
| tr-new | shadow-rgb | 20.52 → **33.60** | 33.51 | 33.60 | 33.55 | 33.49 | 34.87 | 24.88 | 24.78 | 0.0338 → 0.0045 | 0.0089 | 0 | 1.468 | 2.90 |

Visibility, dynamic vs static region (dynamic: reference range over frames t-4..t > 0.05, reprojected; 35820 px per frame). Pooled PSNR; flicker = mean |e_t − e_t−1| and tPSNR, motion-compensated, valid history.

| denoiser | dynamic PSNR | dynamic flicker | dynamic tPSNR | dynamic boil | static PSNR | static penumbra | static flicker | static tPSNR | static penumbra boil | edge sharpness |
|---|---|---|---|---|---|---|---|---|---|---|
| noisy | 8.96 | 0.3767 | 4.96 | 0.4204 | 26.50 | 7.92 | 0.0051 | 22.96 | 0.4762 | 1.590 |
| tr-old | 22.44 | 0.0471 | 23.70 | 0.0608 | 39.58 | 21.91 | 0.0005 | 45.21 | 0.0265 | 0.935 |
| tr-new | 22.47 | 0.0471 | 23.71 | 0.0607 | 39.88 | 22.12 | 0.0004 | 45.22 | 0.0282 | 0.940 |
| reference (its own boil) | | | | 0.0683 | | | | | 0.0053 | 1 |

shadow-rgb (v1): rgb clamped to [0, 1]; penumbra = any reference channel in (0.02, 0.98); tint = reference chroma > 0.02 (50330 px per frame); chroma error = mean |S/ΣS − R/ΣR|; dynamic / boil on the mean of the clamped channels.

| denoiser | pooled | penumbra pooled | tint PSNR | chroma err | dynamic PSNR | dynamic boil | static penumbra | static penumbra boil |
|---|---|---|---|---|---|---|---|---|
| noisy | 20.47 | 11.51 | 14.09 | 0.0641 | 12.08 | 0.2890 | 11.26 | 0.3264 |
| tr-old | 33.42 | 24.72 | 27.04 | 0.0071 | 25.23 | 0.0421 | 24.41 | 0.0186 |
| tr-new | 33.51 | 24.78 | 27.04 | 0.0071 | 25.26 | 0.0420 | 24.58 | 0.0198 |
| reference (its own boil) | | | | | | 0.0461 | | 0.0066 |


