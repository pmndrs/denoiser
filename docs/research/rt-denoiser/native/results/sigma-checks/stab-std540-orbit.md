# std540-orbit: replay scores

960×540, 16 frames, resets at [0], referenceSpp 256. Metrics: CAPTURE-FORMAT.md; settled = ≥ 8 frames after a reset. PSNR, settled, last frame and penumbra are means of per-frame dB; pooled = PSNR of the mean MSE over all frames and pixels; capped = mean of per-frame dB clipped at 60 dB.

| denoiser | signal | PSNR dB (noisy → out) | pooled | capped | settled | settled pooled | last frame | penumbra | penumbra pooled | flicker (noisy → out) | bias | non-finite | GPU ms | wall ms |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| nrd-sigma-stab0 | visibility | 18.81 → **22.80** | 22.80 | 22.80 | 22.88 | 22.88 | 22.98 | 12.30 | 12.30 | 0.0365 → 0.0176 | 0.0125 | 0 | 0.247 | 0.52 |
| nrd-sigma-stab5 | visibility | 18.81 → **22.84** | 22.84 | 22.84 | 22.90 | 22.90 | 22.98 | 12.38 | 12.38 | 0.0365 → 0.0166 | 0.0051 | 0 | 0.325 | 0.69 |
| nrd-sigma-stab7 | visibility | 18.81 → **22.81** | 22.81 | 22.81 | 22.87 | 22.87 | 22.94 | 12.36 | 12.36 | 0.0365 → 0.0166 | 0.0045 | 0 | 0.325 | 0.65 |

Visibility, dynamic vs static region (dynamic: reference range over frames t-4..t > 0.05, reprojected; 5975 px per frame). Pooled PSNR; flicker = mean |e_t − e_t−1| and tPSNR, motion-compensated, valid history.

| denoiser | dynamic PSNR | dynamic flicker | dynamic tPSNR | dynamic boil | static PSNR | static penumbra | static flicker | static tPSNR | static penumbra boil |
|---|---|---|---|---|---|---|---|---|---|
| noisy | 7.51 | 0.4260 | 4.09 | 0.4562 | 19.73 | 8.48 | 0.0225 | 16.66 | 0.3860 |
| nrd-sigma-stab0 | 11.75 | 0.2165 | 8.02 | 0.3000 | 23.66 | 12.44 | 0.0110 | 20.69 | 0.2435 |
| nrd-sigma-stab5 | 11.82 | 0.1824 | 8.38 | 0.2848 | 23.69 | 12.50 | 0.0097 | 20.84 | 0.2387 |
| nrd-sigma-stab7 | 11.77 | 0.1821 | 8.37 | 0.2847 | 23.67 | 12.49 | 0.0097 | 20.84 | 0.2387 |
| reference (its own boil) | | | | 0.0612 | | | | | 0.0314 |
