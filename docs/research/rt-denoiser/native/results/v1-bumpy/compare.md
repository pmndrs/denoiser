# v1-bumpy: replay scores

960×540, 32 frames, resets at [0], referenceSpp 256. Metrics: CAPTURE-FORMAT.md; settled = ≥ 8 frames after a reset. PSNR, settled, last frame and penumbra are means of per-frame dB; pooled = PSNR of the mean MSE over all frames and pixels; capped = mean of per-frame dB clipped at 60 dB.

| denoiser | signal | PSNR dB (noisy → out) | pooled | capped | settled | settled pooled | last frame | penumbra | penumbra pooled | flicker (noisy → out) | bias | non-finite | GPU ms | wall ms |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| nrd-reblur-sh-color | sh-diffuse | 16.18 → **31.85** | 31.83 | 31.85 | 32.08 | 32.08 | 32.39 | – | – | 0.1366 → 0.0052 | 0.0075 | 0 | 0.853 | 0.96 |
| nrd-reblur-sh-color-a001 | sh-diffuse | 16.18 → **33.35** | 33.34 | 33.35 | 33.51 | 33.51 | 33.66 | – | – | 0.1366 → 0.0046 | -0.0001 | 0 | 0.823 | 0.93 |
| nrd-reblur-sh-sgresolve | sh-diffuse | 16.18 → **32.10** | 32.10 | 32.10 | 32.16 | 32.16 | 32.17 | – | – | 0.1366 → 0.0045 | -0.0037 | 0 | – | – |
| nrd-reblur-sh-sgresolve-a001 | sh-diffuse | 16.18 → **32.36** | 32.35 | 32.36 | 32.33 | 32.33 | 32.18 | – | – | 0.1366 → 0.0040 | -0.0101 | 0 | – | – |
| nrd-reblur-sh-shresolve | sh-diffuse | 16.18 → **26.06** | 26.05 | 26.06 | 26.25 | 26.25 | 26.45 | – | – | 0.1366 → 0.0042 | 0.0451 | 0 | – | – |
| nrd-reblur-sh-shresolve-a001 | sh-diffuse | 16.18 → **27.44** | 27.44 | 27.44 | 27.58 | 27.58 | 27.77 | – | – | 0.1366 → 0.0036 | 0.0385 | 0 | – | – |
| nrd-relax-sh-color | sh-diffuse | 16.18 → **32.70** | 32.68 | 32.70 | 32.90 | 32.90 | 33.01 | – | – | 0.1366 → 0.0046 | 0.0097 | 0 | 1.253 | 1.36 |
| nrd-relax-sh-sgresolve | sh-diffuse | 16.18 → **33.09** | 33.09 | 33.09 | 33.12 | 33.11 | 32.95 | – | – | 0.1366 → 0.0039 | -0.0018 | 0 | – | – |
| nrd-relax-sh-shresolve | sh-diffuse | 16.18 → **31.77** | 31.77 | 31.77 | 31.80 | 31.80 | 31.75 | – | – | 0.1366 → 0.0037 | -0.0168 | 0 | – | – |
| svgf-plain | sh-diffuse | 16.18 → **35.42** | 35.37 | 35.42 | 35.68 | 35.68 | 35.84 | – | – | 0.1366 → 0.0056 | -0.0017 | 0 | 2.043 | 4.20 |
| svgf-plain | sh-specular | 17.95 → **30.95** | 30.94 | 30.95 | 30.84 | 30.84 | 30.39 | – | – | 0.0931 → 0.0065 | 0.0005 | 0 | 2.043 | 4.20 |
| svgf-plain-smooth | sh-diffuse | 16.18 → **34.69** | 34.69 | 34.69 | 34.76 | 34.76 | 34.72 | – | – | 0.1366 → 0.0050 | -0.0012 | 0 | 2.013 | 4.20 |
| svgf-plain-smooth | sh-specular | 17.95 → **28.14** | 28.12 | 28.14 | 28.08 | 28.07 | 27.83 | – | – | 0.0931 → 0.0075 | 0.0017 | 0 | 2.013 | 4.20 |
| svgf-sh-auto | sh-diffuse | 16.18 → **36.69** | 36.67 | 36.69 | 36.84 | 36.84 | 36.86 | – | – | 0.1366 → 0.0035 | -0.0039 | 0 | 2.679 | 5.00 |
| svgf-sh-auto | sh-specular | 17.95 → **28.55** | 28.54 | 28.55 | 28.43 | 28.42 | 28.16 | – | – | 0.0931 → 0.0074 | -0.0018 | 0 | 2.679 | 5.00 |

SH signals (v1): bump mask = angle(normal, normal_geom) > 5 deg; detail band = x − G(x), G = masked Gaussian σ 2 px, energy ratio Σband(out)² / Σband(ref)² (1 = detail kept, < 1 smoothed, > 1 noise); floor = output exactly 0; vs SH ref = against diffuse_sh_ref resolved (M7-8 / M7-9, k 1, s 0).

| denoiser | signal | pooled | bump PSNR | band PSNR | band energy | floor | vs SH ref pooled |
|---|---|---|---|---|---|---|---|
| noisy | sh-diffuse | 16.18 | 15.62 | 16.40 | 48.795 | 0.0073 | 16.18 |
| noisy | sh-specular | 17.94 | 17.29 | 17.94 | 5.743 | 0.0241 | – |
| nrd-reblur-sh-color | sh-diffuse | 31.83 | 27.88 | 33.91 | 0.139 | 0.0000 | 31.83 |
| nrd-reblur-sh-color-a001 | sh-diffuse | 33.34 | 29.12 | 34.05 | 0.140 | 0.0000 | 33.34 |
| nrd-reblur-sh-sgresolve | sh-diffuse | 32.10 | 29.76 | 35.75 | 0.251 | 0.0000 | 32.11 |
| nrd-reblur-sh-sgresolve-a001 | sh-diffuse | 32.35 | 30.24 | 35.91 | 0.245 | 0.0000 | 32.36 |
| nrd-reblur-sh-shresolve | sh-diffuse | 26.05 | 25.64 | 36.76 | 0.340 | 0.0000 | 26.05 |
| nrd-reblur-sh-shresolve-a001 | sh-diffuse | 27.44 | 27.19 | 37.01 | 0.336 | 0.0000 | 27.43 |
| nrd-relax-sh-color | sh-diffuse | 32.68 | 28.62 | 34.22 | 0.151 | 0.0000 | 32.68 |
| nrd-relax-sh-sgresolve | sh-diffuse | 33.09 | 30.98 | 36.19 | 0.260 | 0.0000 | 33.10 |
| nrd-relax-sh-shresolve | sh-diffuse | 31.77 | 30.56 | 36.87 | 0.275 | 0.0000 | 31.78 |
| svgf-plain | sh-diffuse | 35.37 | 31.57 | 32.82 | 1.217 | 0.0000 | 35.36 |
| svgf-plain | sh-specular | 30.94 | 27.42 | 29.15 | 0.534 | 0.0001 | – |
| svgf-plain-smooth | sh-diffuse | 34.69 | 30.60 | 34.28 | 0.168 | 0.0000 | 34.70 |
| svgf-plain-smooth | sh-specular | 28.12 | 23.47 | 26.27 | 0.140 | 0.0000 | – |
| svgf-sh-auto | sh-diffuse | 36.67 | 34.16 | 37.89 | 0.444 | 0.0000 | 36.70 |
| svgf-sh-auto | sh-specular | 28.54 | 23.97 | 26.31 | 0.195 | 0.0000 | – |
