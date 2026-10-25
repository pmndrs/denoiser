# std540-orbit: replay scores

960×540, 16 frames, resets at [0], referenceSpp 256. Metrics: CAPTURE-FORMAT.md; settled = ≥ 8 frames after a reset. PSNR, settled, last frame and penumbra are means of per-frame dB; pooled = PSNR of the mean MSE over all frames and pixels; capped = mean of per-frame dB clipped at 60 dB.

| denoiser | signal | PSNR dB (noisy → out) | pooled | capped | settled | settled pooled | last frame | penumbra | penumbra pooled | flicker (noisy → out) | bias | non-finite | GPU ms | wall ms |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| nrd-reblur-vzneg | diffuse | 16.42 → **34.22** | 34.15 | 34.22 | 34.85 | 34.84 | 35.08 | – | – | 0.1041 → 0.0053 | 0.0040 | 0 | 1.409 | 1.81 |
| nrd-reblur-vzneg | specular | 13.66 → **28.85** | 28.81 | 28.85 | 28.83 | 28.82 | 28.39 | – | – | 0.1512 → 0.0083 | 0.0007 | 0 | 1.409 | 1.81 |
| nrd-reblur-vzpos | diffuse | 16.42 → **34.22** | 34.15 | 34.22 | 34.84 | 34.84 | 35.08 | – | – | 0.1041 → 0.0053 | 0.0040 | 0 | 1.403 | 1.62 |
| nrd-reblur-vzpos | specular | 13.66 → **28.85** | 28.82 | 28.85 | 28.83 | 28.82 | 28.38 | – | – | 0.1512 → 0.0083 | 0.0007 | 0 | 1.403 | 1.62 |
| nrd-relax-vzneg | diffuse | 16.42 → **35.92** | 35.86 | 35.92 | 36.55 | 36.55 | 36.86 | – | – | 0.1041 → 0.0037 | 0.0047 | 0 | 1.838 | 2.24 |
| nrd-relax-vzneg | specular | 13.66 → **28.01** | 27.63 | 28.01 | 29.40 | 29.40 | 29.46 | – | – | 0.1512 → 0.0063 | 0.0077 | 0 | 1.838 | 2.24 |
| nrd-relax-vzpos | diffuse | 16.42 → **35.93** | 35.87 | 35.93 | 36.57 | 36.57 | 36.88 | – | – | 0.1041 → 0.0037 | 0.0047 | 0 | 1.836 | 2.03 |
| nrd-relax-vzpos | specular | 13.66 → **28.01** | 27.63 | 28.01 | 29.40 | 29.40 | 29.46 | – | – | 0.1512 → 0.0063 | 0.0077 | 0 | 1.836 | 2.03 |
| nrd-sigma-vzneg | visibility | 18.81 → **22.84** | 22.84 | 22.84 | 22.90 | 22.90 | 22.98 | 12.38 | 12.38 | 0.0365 → 0.0166 | 0.0051 | 0 | 0.329 | 0.68 |
| nrd-sigma-vzpos | visibility | 18.81 → **22.84** | 22.84 | 22.84 | 22.90 | 22.90 | 22.98 | 12.38 | 12.38 | 0.0365 → 0.0166 | 0.0051 | 0 | 0.327 | 0.51 |

Visibility, dynamic vs static region (dynamic: reference range over frames t-4..t > 0.05, reprojected; 5975 px per frame). Pooled PSNR; flicker = mean |e_t − e_t−1| and tPSNR, motion-compensated, valid history.

| denoiser | dynamic PSNR | dynamic flicker | dynamic tPSNR | dynamic boil | static PSNR | static penumbra | static flicker | static tPSNR | static penumbra boil |
|---|---|---|---|---|---|---|---|---|---|
| noisy | 7.51 | 0.4260 | 4.09 | 0.4562 | 19.73 | 8.48 | 0.0225 | 16.66 | 0.3860 |
| nrd-sigma-vzneg | 11.82 | 0.1824 | 8.38 | 0.2848 | 23.69 | 12.50 | 0.0097 | 20.84 | 0.2387 |
| nrd-sigma-vzpos | 11.82 | 0.1824 | 8.38 | 0.2848 | 23.69 | 12.50 | 0.0097 | 20.84 | 0.2387 |
| reference (its own boil) | | | | 0.0612 | | | | | 0.0314 |
