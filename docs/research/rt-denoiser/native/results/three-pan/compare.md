# three-pan: replay scores

960×540, 32 frames, resets at [0], referenceSpp 1024. Metrics: CAPTURE-FORMAT.md; settled = ≥ 8 frames after a reset. PSNR, settled, last frame and penumbra are means of per-frame dB; pooled = PSNR of the mean MSE over all frames and pixels; capped = mean of per-frame dB clipped at 60 dB.

| denoiser | signal | PSNR dB (noisy → out) | pooled | capped | settled | settled pooled | last frame | penumbra | penumbra pooled | flicker (noisy → out) | bias | non-finite | GPU ms | wall ms |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| accumulate | diffuse | 17.09 → **28.20** | 26.47 | 28.20 | 29.38 | 29.37 | 28.81 | – | – | 0.1592 → 0.0375 | -0.0031 | 0 | 2.844 | 27.80 |
| accumulate | specular | 35.89 → **38.31** | 37.34 | 38.31 | 37.26 | 36.67 | 34.90 | – | – | 0.0091 → 0.0035 | 0.0006 | 0 | 2.844 | 27.80 |
| accumulate | visibility | 16.87 → **27.31** | 25.73 | 27.31 | 28.33 | 28.32 | 28.02 | 21.11 | 18.10 | 0.0586 → 0.0161 | 0.0003 | 0 | 2.844 | 27.80 |
| ffx-reflections | specular | 35.89 → **40.87** | 40.85 | 40.87 | 40.68 | 40.66 | 40.84 | – | – | 0.0091 → 0.0028 | -0.0000 | 0 | 0.849 | 3.10 |
| ffx-shadows | visibility | 16.87 → **27.90** | 27.86 | 27.90 | 27.57 | 27.56 | 27.65 | 23.12 | 23.20 | 0.0586 → 0.0099 | -0.0371 | 0 | 0.310 | 3.10 |
| nrd-reblur | diffuse | 17.09 → **33.24** | 33.18 | 33.24 | 33.36 | 33.32 | 34.94 | – | – | 0.1592 → 0.0098 | -0.0066 | 0 | 144.162 | 181.58 |
| nrd-reblur | specular | 35.89 → **41.68** | 41.65 | 41.68 | 41.91 | 41.90 | 42.53 | – | – | 0.0091 → 0.0021 | 0.0014 | 0 | 144.162 | 181.58 |
| nrd-relax | diffuse | 17.09 → **38.76** | 38.73 | 38.76 | 38.99 | 38.98 | 39.61 | – | – | 0.1592 → 0.0061 | -0.0033 | 0 | 182.665 | 203.29 |
| nrd-relax | specular | 35.89 → **42.73** | 42.67 | 42.73 | 42.95 | 42.94 | 43.82 | – | – | 0.0091 → 0.0016 | -0.0004 | 0 | 182.665 | 203.29 |
| nrd-sigma | visibility | 16.87 → **25.82** | 25.79 | 25.82 | 26.06 | 26.04 | 26.70 | 17.56 | 17.62 | 0.0586 → 0.0115 | 0.0151 | 0 | 6.118 | 30.85 |
| recurrent | diffuse | 17.09 → **39.69** | 39.55 | 39.69 | 40.15 | 40.15 | 40.42 | – | – | 0.1592 → 0.0059 | -0.0010 | 0 | 1.715 | 4.10 |
| recurrent | specular | 35.89 → **44.45** | 44.29 | 44.45 | 44.70 | 44.68 | 45.18 | – | – | 0.0091 → 0.0018 | 0.0000 | 0 | 1.715 | 4.10 |
| recurrent-svgfspec | diffuse | 17.09 → **39.69** | 39.55 | 39.69 | 40.15 | 40.15 | 40.42 | – | – | 0.1592 → 0.0059 | -0.0010 | 0 | 2.346 | 5.10 |
| recurrent-svgfspec | specular | 35.89 → **47.64** | 47.58 | 47.64 | 47.94 | 47.92 | 48.71 | – | – | 0.0091 → 0.0011 | 0.0002 | 0 | 2.346 | 5.10 |
| shadows | visibility | 16.87 → **31.16** | 31.13 | 31.16 | 31.40 | 31.39 | 32.05 | 26.92 | 26.89 | 0.0586 → 0.0065 | 0.0043 | 0 | 0.417 | 4.50 |
| svgf | diffuse | 17.09 → **40.31** | 40.27 | 40.31 | 40.54 | 40.54 | 40.59 | – | – | 0.1592 → 0.0058 | -0.0012 | 0 | 31.839 | 43.10 |
| svgf | specular | 35.89 → **46.13** | 46.11 | 46.13 | 46.15 | 46.13 | 46.85 | – | – | 0.0091 → 0.0012 | 0.0002 | 0 | 31.839 | 43.10 |
| svgf-auto | diffuse | 17.09 → **40.44** | 40.39 | 40.44 | 40.71 | 40.71 | 40.77 | – | – | 0.1592 → 0.0056 | -0.0009 | 0 | 1.974 | 5.10 |
| svgf-auto | specular | 35.89 → **47.64** | 47.58 | 47.64 | 47.94 | 47.92 | 48.71 | – | – | 0.0091 → 0.0011 | 0.0002 | 0 | 1.974 | 5.10 |

Visibility, dynamic vs static region (dynamic: reference range over frames t-4..t > 0.05, reprojected; 4303 px per frame). Pooled PSNR; flicker = mean |e_t − e_t−1| and tPSNR, motion-compensated, valid history.

| denoiser | dynamic PSNR | dynamic flicker | dynamic tPSNR | dynamic boil | static PSNR | static penumbra | static flicker | static tPSNR | static penumbra boil |
|---|---|---|---|---|---|---|---|---|---|
| noisy | 7.79 | 0.3789 | 4.92 | 0.4069 | 17.05 | 7.86 | 0.0408 | 14.01 | 0.4042 |
| accumulate | 15.30 | 0.0965 | 14.99 | 0.0587 | 26.11 | 18.12 | 0.0076 | 27.21 | 0.0592 |
| ffx-shadows | 15.10 | 0.0794 | 16.90 | 0.0697 | 28.56 | 24.47 | 0.0032 | 32.62 | 0.0142 |
| nrd-sigma | 10.97 | 0.1954 | 8.71 | 0.2559 | 27.02 | 18.86 | 0.0052 | 26.15 | 0.0929 |
| shadows | 16.82 | 0.0726 | 17.40 | 0.0623 | 32.20 | 29.23 | 0.0027 | 33.00 | 0.0116 |
| reference (its own boil) | | | | 0.1019 | | | | | 0.0129 |
