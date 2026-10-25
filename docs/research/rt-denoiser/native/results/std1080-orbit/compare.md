# std1080-orbit: replay scores

1920×1080, 8 frames, resets at [0], referenceSpp 256. Metrics: CAPTURE-FORMAT.md; settled = ≥ 8 frames after a reset. PSNR, settled, last frame and penumbra are means of per-frame dB; pooled = PSNR of the mean MSE over all frames and pixels; capped = mean of per-frame dB clipped at 60 dB.

| denoiser | signal | PSNR dB (noisy → out) | pooled | capped | settled | settled pooled | last frame | penumbra | penumbra pooled | flicker (noisy → out) | bias | non-finite | GPU ms | wall ms |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| accumulate | diffuse | 16.43 → **21.31** | 20.41 | 21.31 | – | – | 24.91 | – | – | 0.1040 → 0.0835 | -0.0216 | 0 | 54.368 | 76.90 |
| accumulate | specular | 13.68 → **23.11** | 20.48 | 23.11 | – | – | 26.71 | – | – | 0.1505 → 0.0555 | -0.0168 | 0 | 54.368 | 76.90 |
| accumulate | visibility | 18.66 → **26.31** | 24.46 | 26.31 | – | – | 29.60 | 16.39 | 14.26 | 0.0376 → 0.0181 | -0.0022 | 0 | 54.368 | 76.90 |
| ffx-reflections | specular | 13.68 → **18.42** | 18.41 | 18.42 | – | – | 18.57 | – | – | 0.1505 → 0.0170 | -0.0660 | 0 | 90.240 | 99.80 |
| ffx-shadows | visibility | 18.66 → **35.40** | 35.40 | 35.40 | – | – | 35.37 | 25.69 | 25.69 | 0.0376 → 0.0049 | -0.0202 | 0 | 171.845 | 211.80 |
| nrd-reblur | diffuse | 16.43 → **35.87** | 35.78 | 35.87 | – | – | 36.81 | – | – | 0.1040 → 0.0059 | 0.0044 | 0 | 142.362 | 146.60 |
| nrd-reblur | specular | 13.68 → **31.32** | 31.23 | 31.32 | – | – | 31.63 | – | – | 0.1505 → 0.0079 | -0.0004 | 0 | 142.362 | 146.60 |
| nrd-relax | diffuse | 16.43 → **37.57** | 37.55 | 37.57 | – | – | 38.18 | – | – | 0.1040 → 0.0036 | 0.0049 | 0 | 203.927 | 205.98 |
| nrd-relax | specular | 13.68 → **29.92** | 29.73 | 29.92 | – | – | 31.69 | – | – | 0.1505 → 0.0054 | 0.0070 | 0 | 203.927 | 205.98 |
| nrd-sigma | visibility | 18.66 → **22.87** | 22.87 | 22.87 | – | – | 22.94 | 12.52 | 12.52 | 0.0376 → 0.0164 | 0.0094 | 0 | 22.851 | 26.96 |
| recurrent | diffuse | 16.43 → **37.12** | 36.96 | 37.12 | – | – | 38.46 | – | – | 0.1040 → 0.0052 | -0.0012 | 0 | 1246.052 | 1250.50 |
| recurrent | specular | 13.68 → **32.86** | 32.85 | 32.86 | – | – | 32.55 | – | – | 0.1505 → 0.0063 | -0.0003 | 0 | 1246.052 | 1250.50 |
| recurrent-svgfspec | diffuse | 16.43 → **37.12** | 36.96 | 37.12 | – | – | 38.46 | – | – | 0.1040 → 0.0052 | -0.0012 | 0 | 1539.035 | 1554.30 |
| recurrent-svgfspec | specular | 13.68 → **34.97** | 34.97 | 34.97 | – | – | 34.71 | – | – | 0.1505 → 0.0042 | -0.0010 | 0 | 1539.035 | 1554.30 |
| shadows | visibility | 18.66 → **36.87** | 36.81 | 36.87 | – | – | 37.76 | 27.09 | 27.03 | 0.0376 → 0.0033 | 0.0064 | 0 | 28.790 | 42.30 |
| svgf | diffuse | 16.43 → **39.19** | 39.15 | 39.19 | – | – | 39.90 | – | – | 0.1040 → 0.0044 | -0.0027 | 0 | 726.241 | 736.20 |
| svgf | specular | 13.68 → **34.45** | 34.42 | 34.45 | – | – | 33.72 | – | – | 0.1505 → 0.0042 | -0.0009 | 0 | 726.241 | 736.20 |
| svgf-auto | diffuse | 16.43 → **39.26** | 39.21 | 39.26 | – | – | 40.16 | – | – | 0.1040 → 0.0044 | -0.0025 | 0 | 1144.284 | 1151.00 |
| svgf-auto | specular | 13.68 → **34.97** | 34.97 | 34.97 | – | – | 34.71 | – | – | 0.1505 → 0.0042 | -0.0010 | 0 | 1144.284 | 1151.00 |

Visibility, dynamic vs static region (dynamic: reference range over frames t-4..t > 0.05, reprojected; 7981 px per frame). Pooled PSNR; flicker = mean |e_t − e_t−1| and tPSNR, motion-compensated, valid history.

| denoiser | dynamic PSNR | dynamic flicker | dynamic tPSNR | dynamic boil | static PSNR | static penumbra | static flicker | static tPSNR | static penumbra boil |
|---|---|---|---|---|---|---|---|---|---|
| noisy | 7.42 | 0.4020 | 4.35 | 0.4375 | 18.94 | 8.36 | 0.0262 | 15.98 | 0.3837 |
| accumulate | 16.09 | 0.1123 | 15.43 | 0.1024 | 24.59 | 14.17 | 0.0098 | 25.03 | 0.1006 |
| ffx-shadows | 19.59 | 0.0601 | 20.71 | 0.0691 | 36.31 | 26.48 | 0.0028 | 38.23 | 0.0283 |
| nrd-sigma | 12.08 | 0.1609 | 9.21 | 0.2519 | 23.12 | 12.55 | 0.0105 | 20.40 | 0.2292 |
| shadows | 20.10 | 0.0505 | 21.25 | 0.0599 | 37.97 | 28.04 | 0.0020 | 39.80 | 0.0239 |
| reference (its own boil) | | | | 0.0687 | | | | | 0.0223 |
