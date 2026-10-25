# std540-cut: replay scores

960×540, 24 frames, resets at [0, 8], referenceSpp 256. Metrics: CAPTURE-FORMAT.md; settled = ≥ 8 frames after a reset. PSNR, settled, last frame and penumbra are means of per-frame dB; pooled = PSNR of the mean MSE over all frames and pixels; capped = mean of per-frame dB clipped at 60 dB.

| denoiser | signal | PSNR dB (noisy → out) | pooled | capped | settled | settled pooled | last frame | penumbra | penumbra pooled | flicker (noisy → out) | bias | non-finite | GPU ms | wall ms |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| accumulate | diffuse | 14.28 → **22.48** | 20.45 | 22.48 | 26.70 | 26.54 | 28.38 | – | – | 0.1433 → 0.0777 | -0.0202 | 0 | 5.184 | 67.20 |
| accumulate | specular | 17.56 → **25.45** | 22.58 | 25.45 | 29.36 | 29.35 | 28.94 | – | – | 0.1016 → 0.0398 | -0.0083 | 0 | 5.184 | 67.20 |
| accumulate | visibility | 18.03 → **28.10** | 25.41 | 28.10 | 31.94 | 31.94 | 31.89 | 19.31 | 15.65 | 0.0474 → 0.0159 | -0.0017 | 0 | 5.184 | 67.20 |
| ffx-reflections | specular | 17.56 → **23.28** | 21.47 | 23.28 | 25.16 | 25.15 | 24.69 | – | – | 0.1016 → 0.0136 | -0.0323 | 0 | 23.200 | 30.50 |
| ffx-shadows | visibility | 18.03 → **31.92** | 31.87 | 31.92 | 31.04 | 30.98 | 30.14 | 23.55 | 23.54 | 0.0474 → 0.0052 | -0.0342 | 0 | 142.356 | 147.90 |
| nrd-reblur | diffuse | 14.28 → **33.46** | 33.42 | 33.46 | 33.31 | 33.31 | 33.12 | – | – | 0.1433 → 0.0069 | 0.0088 | 0 | 116.944 | 186.25 |
| nrd-reblur | specular | 17.56 → **29.56** | 29.25 | 29.56 | 30.53 | 30.52 | 30.40 | – | – | 0.1016 → 0.0114 | -0.0007 | 0 | 116.944 | 186.25 |
| nrd-relax | diffuse | 14.28 → **34.01** | 33.83 | 34.01 | 32.96 | 32.96 | 32.84 | – | – | 0.1433 → 0.0043 | 0.0104 | 0 | 189.410 | 200.81 |
| nrd-relax | specular | 17.56 → **29.58** | 28.64 | 29.58 | 31.52 | 31.52 | 31.53 | – | – | 0.1016 → 0.0064 | 0.0091 | 0 | 189.410 | 200.81 |
| nrd-sigma | visibility | 18.03 → **23.46** | 22.75 | 23.46 | 24.65 | 24.65 | 24.61 | 13.57 | 12.77 | 0.0474 → 0.0165 | 0.0057 | 0 | 6.375 | 55.76 |
| recurrent | diffuse | 14.28 → **37.52** | 37.30 | 37.52 | 38.41 | 38.41 | 38.50 | – | – | 0.1433 → 0.0048 | -0.0023 | 0 | 26.972 | 83.20 |
| recurrent | specular | 17.56 → **33.84** | 32.51 | 33.84 | 35.77 | 35.77 | 35.44 | – | – | 0.1016 → 0.0068 | -0.0004 | 0 | 26.972 | 83.20 |
| recurrent-svgfspec | diffuse | 14.28 → **37.52** | 37.30 | 37.52 | 38.41 | 38.41 | 38.50 | – | – | 0.1433 → 0.0048 | -0.0023 | 0 | 30.208 | 36.00 |
| recurrent-svgfspec | specular | 17.56 → **34.92** | 34.08 | 34.92 | 36.44 | 36.44 | 36.28 | – | – | 0.1016 → 0.0046 | 0.0002 | 0 | 30.208 | 36.00 |
| shadows | visibility | 18.03 → **36.65** | 36.19 | 36.65 | 38.21 | 38.21 | 37.96 | 27.74 | 27.04 | 0.0474 → 0.0033 | 0.0040 | 0 | 10.954 | 118.10 |
| svgf | diffuse | 14.28 → **38.34** | 38.30 | 38.34 | 38.25 | 38.25 | 38.23 | – | – | 0.1433 → 0.0038 | -0.0026 | 0 | 189.196 | 239.50 |
| svgf | specular | 17.56 → **34.17** | 33.37 | 34.17 | 35.33 | 35.33 | 35.22 | – | – | 0.1016 → 0.0048 | 0.0004 | 0 | 189.196 | 239.50 |
| svgf-auto | diffuse | 14.28 → **38.46** | 38.42 | 38.46 | 38.51 | 38.51 | 38.46 | – | – | 0.1433 → 0.0035 | -0.0020 | 0 | 45.334 | 51.80 |
| svgf-auto | specular | 17.56 → **34.92** | 34.08 | 34.92 | 36.44 | 36.44 | 36.28 | – | – | 0.1016 → 0.0046 | 0.0002 | 0 | 45.334 | 51.80 |

Visibility, dynamic vs static region (dynamic: reference range over frames t-4..t > 0.05, reprojected; 3879 px per frame). Pooled PSNR; flicker = mean |e_t − e_t−1| and tPSNR, motion-compensated, valid history.

| denoiser | dynamic PSNR | dynamic flicker | dynamic tPSNR | dynamic boil | static PSNR | static penumbra | static flicker | static tPSNR | static penumbra boil |
|---|---|---|---|---|---|---|---|---|---|
| noisy | 7.35 | 0.4115 | 4.22 | 0.4397 | 18.55 | 8.02 | 0.0292 | 15.50 | 0.3988 |
| accumulate | 18.69 | 0.0804 | 17.82 | 0.0776 | 25.58 | 15.38 | 0.0082 | 26.36 | 0.0812 |
| ffx-shadows | 18.60 | 0.0472 | 22.46 | 0.0470 | 32.92 | 24.73 | 0.0028 | 38.33 | 0.0288 |
| nrd-sigma | 11.59 | 0.1638 | 8.88 | 0.2588 | 23.34 | 12.94 | 0.0108 | 20.74 | 0.2164 |
| shadows | 21.75 | 0.0374 | 24.11 | 0.0393 | 37.64 | 28.39 | 0.0019 | 39.77 | 0.0274 |
| reference (its own boil) | | | | 0.0372 | | | | | 0.0252 |
