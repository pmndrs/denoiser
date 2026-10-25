
## three-orbit (960x540, 40 frames; settled = frames ≥ 8; FLIP every 4th frame, 20.69 ppd)

| signal | denoiser | pooled PSNR | settled pooled | penumbra pooled | FLIP | flicker | bias | non-finite |
|---|---|---|---|---|---|---|---|---|
| diffuse | noisy | 16.88 | 16.86 | – | 0.4461 | 0.1661 | -0.0315 | 0 |
| diffuse | accumulate | 28.53 | 33.75 | – | 0.0951 | 0.0266 | -0.0018 | 0 |
| diffuse | nrd-reblur | 32.93 | 33.10 | – | 0.0780 | 0.0084 | -0.0099 | 0 |
| diffuse | nrd-relax | 37.59 | 37.73 | – | 0.0563 | 0.0054 | -0.0053 | 0 |
| diffuse | recurrent | 38.78 | 39.30 | – | 0.0385 | 0.0054 | -0.0010 | 0 |
| diffuse | recurrent-svgfspec | 38.78 | 39.30 | – | 0.0385 | 0.0054 | -0.0010 | 0 |
| diffuse | svgf | 39.89 | 40.07 | – | 0.0372 | 0.0055 | -0.0011 | 0 |
| diffuse | svgf-auto | 39.83 | 40.00 | – | 0.0365 | 0.0054 | -0.0008 | 0 |
| specular | noisy | 34.79 | 34.88 | – | 0.1378 | 0.0094 | -0.0002 | 0 |
| specular | accumulate | 39.28 | 39.26 | – | 0.0711 | 0.0025 | 0.0006 | 0 |
| specular | ffx-reflections | 39.11 | 38.83 | – | 0.0708 | 0.0023 | 0.0001 | 0 |
| specular | nrd-reblur | 39.91 | 39.88 | – | 0.0625 | 0.0016 | 0.0005 | 0 |
| specular | nrd-relax | 41.41 | 41.52 | – | 0.0583 | 0.0014 | -0.0004 | 0 |
| specular | recurrent | 43.02 | 43.53 | – | 0.0452 | 0.0016 | 0.0002 | 0 |
| specular | recurrent-svgfspec | 45.33 | 45.39 | – | 0.0384 | 0.0011 | 0.0003 | 0 |
| specular | svgf | 44.34 | 44.27 | – | 0.0407 | 0.0012 | 0.0004 | 0 |
| specular | svgf-auto | 45.33 | 45.39 | – | 0.0384 | 0.0011 | 0.0003 | 0 |
| visibility | noisy | 16.05 | 15.99 | 7.79 | 0.1063 | 0.0632 | 0.0002 | 0 |
| visibility | accumulate | 25.96 | 27.61 | 19.98 | 0.0397 | 0.0136 | 0.0004 | 0 |
| visibility | ffx-shadows | 26.32 | 25.79 | 22.61 | 0.0551 | 0.0077 | -0.0402 | 0 |
| visibility | nrd-sigma | 24.93 | 24.81 | 17.36 | 0.0493 | 0.0103 | 0.0119 | 0 |
| visibility | shadows | 30.92 | 30.90 | 26.81 | 0.0253 | 0.0058 | 0.0026 | 0 |
| ao | noisy | 12.52 | 12.55 | – | 0.4222 | 0.3374 | – | 0 |
| ao | nrd-reblur-occlusion | 23.01 | 23.46 | – | 0.1266 | 0.0309 | – | 0 |
| ao | occlusion-recurrent | 32.53 | 32.93 | – | 0.0329 | 0.0084 | – | 0 |
| ao | occlusion-svgf | 33.42 | 33.41 | – | 0.0318 | 0.0091 | – | 0 |
| ao | occlusion-svgf-auto | 33.10 | 33.01 | – | 0.0324 | 0.0084 | – | 0 |
