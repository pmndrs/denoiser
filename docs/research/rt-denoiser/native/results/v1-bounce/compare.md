# v1-bounce: replay scores

960×540, 16 frames, resets at [0], referenceSpp 256. Metrics: CAPTURE-FORMAT.md; settled = ≥ 8 frames after a reset. PSNR, settled, last frame and penumbra are means of per-frame dB; pooled = PSNR of the mean MSE over all frames and pixels; capped = mean of per-frame dB clipped at 60 dB.

| denoiser | signal | PSNR dB (noisy → out) | pooled | capped | settled | settled pooled | last frame | penumbra | penumbra pooled | flicker (noisy → out) | bias | non-finite | GPU ms | wall ms |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| nrd-reblur-sh-color | sh-diffuse | 14.65 → **30.17** | 30.16 | 30.17 | 30.42 | 30.42 | 30.50 | – | – | 0.1525 → 0.0058 | 0.0135 | 0 | 0.838 | 0.95 |
| nrd-reblur-sh-color-a001 | sh-diffuse | 14.65 → **32.31** | 32.30 | 32.31 | 32.64 | 32.64 | 32.80 | – | – | 0.1525 → 0.0052 | 0.0009 | 0 | 0.814 | 0.92 |
| nrd-reblur-sh-sgresolve | sh-diffuse | 14.65 → **30.30** | 30.30 | 30.30 | 30.39 | 30.39 | 30.51 | – | – | 0.1525 → 0.0051 | -0.0057 | 0 | – | – |
| nrd-reblur-sh-sgresolve-a001 | sh-diffuse | 14.65 → **29.54** | 29.54 | 29.54 | 29.56 | 29.56 | 29.62 | – | – | 0.1525 → 0.0047 | -0.0170 | 0 | – | – |
| nrd-reblur-sh-shresolve | sh-diffuse | 14.65 → **25.80** | 25.80 | 25.80 | 26.07 | 26.07 | 26.17 | – | – | 0.1525 → 0.0045 | 0.0464 | 0 | – | – |
| nrd-reblur-sh-shresolve-a001 | sh-diffuse | 14.65 → **27.84** | 27.84 | 27.84 | 28.11 | 28.11 | 28.23 | – | – | 0.1525 → 0.0041 | 0.0349 | 0 | – | – |
| nrd-relax-sh-color | sh-diffuse | 14.65 → **30.52** | 30.52 | 30.52 | 30.69 | 30.69 | 30.78 | – | – | 0.1525 → 0.0048 | 0.0136 | 0 | 1.247 | 1.35 |
| nrd-relax-sh-sgresolve | sh-diffuse | 14.65 → **30.29** | 30.28 | 30.29 | 30.46 | 30.45 | 30.61 | – | – | 0.1525 → 0.0044 | -0.0069 | 0 | – | – |
| nrd-relax-sh-shresolve | sh-diffuse | 14.65 → **31.05** | 31.05 | 31.05 | 31.29 | 31.29 | 31.43 | – | – | 0.1525 → 0.0038 | -0.0174 | 0 | – | – |
| svgf-plain | sh-diffuse | 14.65 → **35.67** | 35.53 | 35.67 | 36.40 | 36.40 | 36.58 | – | – | 0.1525 → 0.0059 | -0.0019 | 0 | 0.825 | 4.00 |
| svgf-plain-smooth | sh-diffuse | 14.65 → **33.79** | 33.77 | 33.79 | 34.03 | 34.03 | 34.12 | – | – | 0.1525 → 0.0049 | -0.0012 | 0 | 0.816 | 3.90 |
| svgf-sh-auto | sh-diffuse | 14.65 → **36.47** | 36.45 | 36.47 | 36.87 | 36.87 | 36.93 | – | – | 0.1525 → 0.0036 | -0.0048 | 0 | 1.409 | 4.00 |

SH signals (v1): bump mask = angle(normal, normal_geom) > 5 deg; detail band = x − G(x), G = masked Gaussian σ 2 px, energy ratio Σband(out)² / Σband(ref)² (1 = detail kept, < 1 smoothed, > 1 noise); floor = output exactly 0; vs SH ref = against diffuse_sh_ref resolved (M7-8 / M7-9, k 1, s 0).

| denoiser | signal | pooled | bump PSNR | band PSNR | band energy | floor | vs SH ref pooled |
|---|---|---|---|---|---|---|---|
| noisy | sh-diffuse | 14.65 | 14.85 | 15.81 | 61.579 | 0.0111 | 14.65 |
| nrd-reblur-sh-color | sh-diffuse | 30.16 | 25.50 | 33.93 | 0.078 | 0.0000 | 30.18 |
| nrd-reblur-sh-color-a001 | sh-diffuse | 32.30 | 27.42 | 34.03 | 0.070 | 0.0000 | 32.32 |
| nrd-reblur-sh-sgresolve | sh-diffuse | 30.30 | 27.68 | 35.03 | 0.199 | 0.0000 | 30.32 |
| nrd-reblur-sh-sgresolve-a001 | sh-diffuse | 29.54 | 27.98 | 35.09 | 0.188 | 0.0000 | 29.56 |
| nrd-reblur-sh-shresolve | sh-diffuse | 25.80 | 24.80 | 37.63 | 0.338 | 0.0000 | 25.80 |
| nrd-reblur-sh-shresolve-a001 | sh-diffuse | 27.84 | 26.56 | 37.83 | 0.323 | 0.0000 | 27.84 |
| nrd-relax-sh-color | sh-diffuse | 30.52 | 25.91 | 34.03 | 0.077 | 0.0000 | 30.54 |
| nrd-relax-sh-sgresolve | sh-diffuse | 30.28 | 27.80 | 35.03 | 0.204 | 0.0000 | 30.30 |
| nrd-relax-sh-shresolve | sh-diffuse | 31.05 | 29.05 | 37.30 | 0.254 | 0.0000 | 31.08 |
| svgf-plain | sh-diffuse | 35.53 | 31.69 | 33.34 | 1.403 | 0.0000 | 35.51 |
| svgf-plain-smooth | sh-diffuse | 33.77 | 29.00 | 34.32 | 0.090 | 0.0000 | 33.80 |
| svgf-sh-auto | sh-diffuse | 36.45 | 33.83 | 38.89 | 0.472 | 0.0000 | 36.52 |
