# std540-glossy: replay scores

960×540, 16 frames, resets at [0], referenceSpp 256. Metrics: CAPTURE-FORMAT.md; settled = ≥ 8 frames after a reset. PSNR, settled, last frame and penumbra are means of per-frame dB; pooled = PSNR of the mean MSE over all frames and pixels; capped = mean of per-frame dB clipped at 60 dB.

| denoiser | signal | PSNR dB (noisy → out) | pooled | capped | settled | settled pooled | last frame | penumbra | penumbra pooled | flicker (noisy → out) | bias | non-finite | GPU ms | wall ms |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| accumulate | diffuse | 16.65 → **25.68** | 23.44 | 25.68 | 29.08 | 28.91 | 30.83 | – | – | 0.1139 → 0.0475 | -0.0096 | 0 | 5.228 | 56.00 |
| accumulate | specular | 18.82 → **27.77** | 26.13 | 27.77 | 29.87 | 29.87 | 29.62 | – | – | 0.0875 → 0.0260 | -0.0057 | 0 | 5.228 | 56.00 |
| accumulate | visibility | 19.28 → **31.62** | 28.37 | 31.62 | 34.60 | 34.58 | 35.03 | 21.50 | 17.32 | 0.0350 → 0.0078 | 0.0000 | 0 | 5.228 | 56.00 |
| ffx-reflections | specular | 18.82 → **25.74** | 25.73 | 25.74 | 25.47 | 25.46 | 25.15 | – | – | 0.0875 → 0.0048 | -0.0186 | 0 | 11.473 | 21.60 |
| ffx-shadows | visibility | 19.28 → **31.76** | 31.60 | 31.76 | 30.87 | 30.78 | 29.66 | 22.35 | 22.32 | 0.0350 → 0.0023 | -0.0412 | 0 | 1.875 | 118.40 |
| nrd-reblur | diffuse | 16.65 → **34.16** | 34.10 | 34.16 | 34.72 | 34.72 | 34.93 | – | – | 0.1139 → 0.0041 | 0.0068 | 0 | 24.929 | 31.81 |
| nrd-reblur | specular | 18.82 → **30.84** | 30.76 | 30.84 | 31.16 | 31.16 | 31.01 | – | – | 0.0875 → 0.0071 | -0.0018 | 0 | 24.929 | 31.81 |
| nrd-relax | diffuse | 16.65 → **33.92** | 33.81 | 33.92 | 34.71 | 34.71 | 35.02 | – | – | 0.1139 → 0.0030 | 0.0090 | 0 | 39.262 | 43.10 |
| nrd-relax | specular | 18.82 → **33.48** | 33.38 | 33.48 | 34.14 | 34.14 | 34.16 | – | – | 0.0875 → 0.0027 | 0.0073 | 0 | 39.262 | 43.10 |
| nrd-sigma | visibility | 19.28 → **20.69** | 20.69 | 20.69 | 20.62 | 20.62 | 20.58 | 9.40 | 9.40 | 0.0350 → 0.0251 | 0.0050 | 0 | 2.123 | 11.17 |
| recurrent | diffuse | 16.65 → **38.76** | 38.67 | 38.76 | 39.35 | 39.35 | 39.49 | – | – | 0.1139 → 0.0033 | -0.0017 | 0 | 39.997 | 51.60 |
| recurrent | specular | 18.82 → **35.32** | 35.31 | 35.32 | 35.38 | 35.38 | 35.25 | – | – | 0.0875 → 0.0037 | -0.0021 | 0 | 39.997 | 51.60 |
| recurrent-svgfspec | diffuse | 16.65 → **38.76** | 38.67 | 38.76 | 39.35 | 39.35 | 39.49 | – | – | 0.1139 → 0.0033 | -0.0017 | 0 | 300.788 | 367.20 |
| recurrent-svgfspec | specular | 18.82 → **35.66** | 35.65 | 35.66 | 35.47 | 35.47 | 35.39 | – | – | 0.0875 → 0.0027 | -0.0023 | 0 | 300.788 | 367.20 |
| shadows | visibility | 19.28 → **38.60** | 38.13 | 38.60 | 39.97 | 39.96 | 40.16 | 28.21 | 27.83 | 0.0350 → 0.0016 | 0.0006 | 0 | 5.280 | 26.20 |
| svgf | diffuse | 16.65 → **38.43** | 38.36 | 38.43 | 38.93 | 38.93 | 38.91 | – | – | 0.1139 → 0.0029 | -0.0022 | 0 | 140.441 | 151.30 |
| svgf | specular | 18.82 → **35.01** | 34.97 | 35.01 | 34.51 | 34.50 | 34.31 | – | – | 0.0875 → 0.0028 | -0.0022 | 0 | 140.441 | 151.30 |
| svgf-auto | diffuse | 16.65 → **38.55** | 38.46 | 38.55 | 39.12 | 39.12 | 39.16 | – | – | 0.1139 → 0.0027 | -0.0018 | 0 | 178.321 | 229.20 |
| svgf-auto | specular | 18.82 → **35.66** | 35.65 | 35.66 | 35.47 | 35.47 | 35.39 | – | – | 0.0875 → 0.0027 | -0.0023 | 0 | 178.321 | 229.20 |

Visibility, dynamic vs static region (dynamic: reference range over frames t-4..t > 0.05, reprojected; 3813 px per frame). Pooled PSNR; flicker = mean |e_t − e_t−1| and tPSNR, motion-compensated, valid history.

| denoiser | dynamic PSNR | dynamic flicker | dynamic tPSNR | dynamic boil | static PSNR | static penumbra | static flicker | static tPSNR | static penumbra boil |
|---|---|---|---|---|---|---|---|---|---|
| noisy | 7.42 | 0.4085 | 4.26 | 0.4387 | 19.95 | 8.06 | 0.0240 | 16.28 | 0.4463 |
| accumulate | 19.47 | 0.0650 | 19.23 | 0.0654 | 28.67 | 16.99 | 0.0046 | 29.39 | 0.0743 |
| ffx-shadows | 19.60 | 0.0372 | 25.08 | 0.0351 | 32.30 | 22.89 | 0.0017 | 41.71 | 0.0174 |
| nrd-sigma | 13.18 | 0.1052 | 10.82 | 0.2125 | 20.90 | 9.02 | 0.0197 | 17.19 | 0.4038 |
| shadows | 25.56 | 0.0310 | 26.73 | 0.0364 | 38.95 | 28.31 | 0.0011 | 43.37 | 0.0131 |
| reference (its own boil) | | | | 0.0292 | | | | | 0.0080 |
