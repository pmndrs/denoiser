
## three-knot-orbit (960x540, 40 frames; settled = frames ≥ 8; FLIP every 4th frame, 20.69 ppd)

| signal | denoiser | pooled PSNR | settled pooled | penumbra pooled | FLIP | flicker | bias | non-finite |
|---|---|---|---|---|---|---|---|---|
| diffuse | noisy | 16.88 | 16.86 | – | 0.4462 | 0.1661 | -0.0315 | 0 |
| diffuse | accumulate | 28.53 | 33.75 | – | 0.0951 | 0.0266 | -0.0018 | 0 |
| diffuse | nrd-reblur | 32.93 | 33.10 | – | 0.0779 | 0.0084 | -0.0099 | 0 |
| diffuse | nrd-relax | 37.59 | 37.73 | – | 0.0563 | 0.0054 | -0.0053 | 0 |
| diffuse | recurrent | 38.78 | 39.30 | – | 0.0385 | 0.0054 | -0.0010 | 0 |
| diffuse | recurrent-svgfspec | 38.78 | 39.30 | – | 0.0385 | 0.0054 | -0.0010 | 0 |
| diffuse | svgf | 39.88 | 40.06 | – | 0.0372 | 0.0055 | -0.0011 | 0 |
| diffuse | svgf-auto | 39.82 | 39.98 | – | 0.0365 | 0.0054 | -0.0008 | 0 |
| specular | noisy | 34.81 | 34.91 | – | 0.1377 | 0.0094 | -0.0002 | 0 |
| specular | accumulate | 39.23 | 39.20 | – | 0.0711 | 0.0025 | 0.0007 | 0 |
| specular | ffx-reflections | 39.05 | 38.78 | – | 0.0708 | 0.0023 | 0.0001 | 0 |
| specular | nrd-reblur | 39.95 | 39.92 | – | 0.0625 | 0.0016 | 0.0005 | 0 |
| specular | nrd-relax | 41.36 | 41.45 | – | 0.0583 | 0.0014 | -0.0003 | 0 |
| specular | recurrent | 42.95 | 43.45 | – | 0.0453 | 0.0016 | 0.0002 | 0 |
| specular | recurrent-svgfspec | 45.26 | 45.31 | – | 0.0384 | 0.0011 | 0.0003 | 0 |
| specular | svgf | 44.27 | 44.19 | – | 0.0407 | 0.0012 | 0.0004 | 0 |
| specular | svgf-auto | 45.26 | 45.31 | – | 0.0384 | 0.0011 | 0.0003 | 0 |
| visibility | noisy | 16.06 | 16.01 | 7.80 | 0.1062 | 0.0631 | 0.0002 | 0 |
| visibility | accumulate | 25.96 | 27.60 | 19.96 | 0.0397 | 0.0135 | 0.0010 | 0 |
| visibility | ffx-shadows | 26.34 | 25.82 | 22.67 | 0.0545 | 0.0075 | -0.0395 | 0 |
| visibility | nrd-sigma | 24.93 | 24.81 | 17.36 | 0.0495 | 0.0101 | 0.0124 | 0 |
| visibility | shadows | 30.97 | 30.94 | 26.95 | 0.0252 | 0.0052 | 0.0032 | 0 |
| ao | noisy | 12.52 | 12.55 | – | 0.4223 | 0.3374 | – | 0 |
| ao | nrd-reblur-occlusion | 23.00 | 23.46 | – | 0.1266 | 0.0309 | – | 0 |
| ao | occlusion-recurrent | 32.53 | 32.93 | – | 0.0328 | 0.0084 | – | 0 |
| ao | occlusion-svgf | 33.43 | 33.41 | – | 0.0317 | 0.0091 | – | 0 |
| ao | occlusion-svgf-auto | 33.10 | 33.02 | – | 0.0324 | 0.0084 | – | 0 |
