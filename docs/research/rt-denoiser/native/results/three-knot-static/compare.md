# three-knot-static: replay scores

960×540, 48 frames, resets at [0], referenceSpp 2048. Metrics: CAPTURE-FORMAT.md; settled = ≥ 8 frames after a reset. PSNR, settled, last frame and penumbra are means of per-frame dB; pooled = PSNR of the mean MSE over all frames and pixels; capped = mean of per-frame dB clipped at 60 dB.

| denoiser | signal | PSNR dB (noisy → out) | pooled | capped | settled | settled pooled | last frame | penumbra | penumbra pooled | flicker (noisy → out) | bias | non-finite | GPU ms | wall ms |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| accumulate | diffuse | 15.12 → **30.23** | 26.61 | 30.23 | 31.88 | 31.17 | 35.15 | – | – | 0.2266 → 0.0146 | -0.0030 | 0 | 0.516 | 4.00 |
| accumulate | specular | 32.92 → **41.35** | 40.83 | 41.35 | 41.78 | 41.71 | 40.43 | – | – | 0.0087 → 0.0009 | 0.0001 | 0 | 0.516 | 4.00 |
| accumulate | visibility | 16.85 → **32.41** | 28.94 | 32.41 | 33.92 | 33.48 | 35.73 | 23.93 | 20.06 | 0.0472 → 0.0035 | -0.0000 | 0 | 0.516 | 4.00 |
| ffx-reflections | specular | 32.92 → **39.56** | 39.52 | 39.56 | 39.48 | 39.44 | 38.56 | – | – | 0.0087 → 0.0008 | -0.0003 | 0 | 0.910 | 4.00 |
| ffx-shadows | visibility | 16.85 → **28.76** | 28.68 | 28.76 | 28.43 | 28.41 | 28.49 | 23.08 | 23.06 | 0.0472 → 0.0014 | -0.0468 | 0 | 0.303 | 4.00 |
| nrd-reblur | diffuse | 15.12 → **32.30** | 32.22 | 32.30 | 32.54 | 32.53 | 32.36 | – | – | 0.2266 → 0.0055 | -0.0188 | 0 | 1.673 | 2.01 |
| nrd-reblur | specular | 32.92 → **40.53** | 40.42 | 40.53 | 40.69 | 40.62 | 39.50 | – | – | 0.0087 → 0.0007 | -0.0001 | 0 | 1.673 | 2.01 |
| nrd-relax | diffuse | 15.12 → **36.29** | 36.27 | 36.29 | 36.39 | 36.39 | 36.23 | – | – | 0.2266 → 0.0051 | -0.0108 | 0 | 2.171 | 2.44 |
| nrd-relax | specular | 32.92 → **42.58** | 42.39 | 42.58 | 42.80 | 42.72 | 41.64 | – | – | 0.0087 → 0.0007 | -0.0005 | 0 | 2.171 | 2.44 |
| nrd-sigma | visibility | 16.85 → **21.50** | 21.50 | 21.50 | 21.52 | 21.52 | 21.56 | 12.53 | 12.53 | 0.0472 → 0.0151 | 0.0074 | 0 | 0.346 | 0.54 |
| recurrent | diffuse | 15.12 → **38.14** | 37.94 | 38.14 | 38.60 | 38.59 | 38.80 | – | – | 0.2266 → 0.0051 | -0.0008 | 0 | 1.706 | 4.20 |
| recurrent | specular | 32.92 → **42.74** | 42.46 | 42.74 | 43.15 | 43.15 | 43.19 | – | – | 0.0087 → 0.0008 | -0.0002 | 0 | 1.706 | 4.20 |
| recurrent-svgfspec | diffuse | 15.12 → **38.14** | 37.94 | 38.14 | 38.60 | 38.59 | 38.80 | – | – | 0.2266 → 0.0051 | -0.0008 | 0 | 2.284 | 5.00 |
| recurrent-svgfspec | specular | 32.92 → **46.07** | 45.99 | 46.07 | 46.21 | 46.20 | 46.64 | – | – | 0.0087 → 0.0007 | -0.0000 | 0 | 2.284 | 5.00 |
| shadows | visibility | 16.85 → **32.43** | 32.41 | 32.43 | 32.60 | 32.60 | 32.66 | 26.66 | 26.61 | 0.0472 → 0.0014 | 0.0006 | 0 | 0.395 | 4.10 |
| svgf | diffuse | 15.12 → **41.88** | 41.82 | 41.88 | 42.10 | 42.10 | 42.17 | – | – | 0.2266 → 0.0053 | -0.0009 | 0 | 1.542 | 4.20 |
| svgf | specular | 32.92 → **45.73** | 45.67 | 45.73 | 45.82 | 45.80 | 46.02 | – | – | 0.0087 → 0.0007 | -0.0000 | 0 | 1.542 | 4.20 |
| svgf-auto | diffuse | 15.12 → **42.18** | 42.09 | 42.18 | 42.45 | 42.45 | 42.54 | – | – | 0.2266 → 0.0052 | -0.0008 | 0 | 1.852 | 4.10 |
| svgf-auto | specular | 32.92 → **46.07** | 45.99 | 46.07 | 46.21 | 46.20 | 46.64 | – | – | 0.0087 → 0.0007 | -0.0000 | 0 | 1.852 | 4.10 |

Visibility, dynamic vs static region (dynamic: reference range over frames t-4..t > 0.05, reprojected; 761 px per frame). Pooled PSNR; flicker = mean |e_t − e_t−1| and tPSNR, motion-compensated, valid history.

| denoiser | dynamic PSNR | dynamic flicker | dynamic tPSNR | dynamic boil | static PSNR | static penumbra | static flicker | static tPSNR | static penumbra boil |
|---|---|---|---|---|---|---|---|---|---|
| noisy | 7.45 | 0.4419 | 3.76 | 0.4557 | 16.89 | 7.85 | 0.0466 | 13.36 | 0.4197 |
| accumulate | 18.21 | 0.0348 | 23.78 | 0.0369 | 29.01 | 20.09 | 0.0035 | 33.00 | 0.0313 |
| ffx-shadows | 16.59 | 0.0311 | 24.34 | 0.0395 | 28.78 | 23.23 | 0.0013 | 44.19 | 0.0094 |
| nrd-sigma | 8.81 | 0.3082 | 5.52 | 0.3639 | 21.62 | 12.60 | 0.0146 | 18.71 | 0.2135 |
| shadows | 19.64 | 0.0237 | 27.06 | 0.0203 | 32.52 | 26.81 | 0.0014 | 43.42 | 0.0085 |
| reference (its own boil) | | | | 0.0212 | | | | | 0.0049 |
