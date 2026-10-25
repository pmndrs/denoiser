
## three-pan (960x540, 32 frames; settled = frames ≥ 8; FLIP every 4th frame, 20.69 ppd)

| signal | denoiser | pooled PSNR | settled pooled | penumbra pooled | FLIP | flicker | bias | non-finite |
|---|---|---|---|---|---|---|---|---|
| diffuse | noisy | 17.09 | 17.17 | – | 0.4394 | 0.1592 | -0.0302 | 0 |
| diffuse | accumulate | 26.47 | 29.37 | – | 0.1260 | 0.0375 | -0.0031 | 0 |
| diffuse | nrd-reblur | 33.18 | 33.32 | – | 0.0714 | 0.0098 | -0.0066 | 0 |
| diffuse | nrd-relax | 38.73 | 38.98 | – | 0.0510 | 0.0061 | -0.0033 | 0 |
| diffuse | recurrent | 39.55 | 40.15 | – | 0.0381 | 0.0059 | -0.0010 | 0 |
| diffuse | recurrent-svgfspec | 39.55 | 40.15 | – | 0.0381 | 0.0059 | -0.0010 | 0 |
| diffuse | svgf | 40.27 | 40.54 | – | 0.0368 | 0.0058 | -0.0012 | 0 |
| diffuse | svgf-auto | 40.39 | 40.71 | – | 0.0361 | 0.0056 | -0.0009 | 0 |
| specular | noisy | 35.87 | 36.05 | – | 0.1338 | 0.0091 | -0.0001 | 0 |
| specular | accumulate | 37.34 | 36.67 | – | 0.0800 | 0.0035 | 0.0006 | 0 |
| specular | ffx-reflections | 40.85 | 40.66 | – | 0.0695 | 0.0028 | -0.0000 | 0 |
| specular | nrd-reblur | 41.65 | 41.90 | – | 0.0596 | 0.0021 | 0.0014 | 0 |
| specular | nrd-relax | 42.67 | 42.94 | – | 0.0566 | 0.0016 | -0.0004 | 0 |
| specular | recurrent | 44.29 | 44.68 | – | 0.0478 | 0.0018 | 0.0000 | 0 |
| specular | recurrent-svgfspec | 47.58 | 47.92 | – | 0.0359 | 0.0011 | 0.0002 | 0 |
| specular | svgf | 46.11 | 46.13 | – | 0.0399 | 0.0012 | 0.0002 | 0 |
| specular | svgf-auto | 47.58 | 47.92 | – | 0.0359 | 0.0011 | 0.0002 | 0 |
| visibility | noisy | 16.79 | 17.12 | 7.84 | 0.0867 | 0.0586 | 0.0001 | 0 |
| visibility | accumulate | 25.73 | 28.32 | 18.10 | 0.0340 | 0.0161 | 0.0003 | 0 |
| visibility | ffx-shadows | 27.86 | 27.56 | 23.20 | 0.0408 | 0.0099 | -0.0371 | 0 |
| visibility | nrd-sigma | 25.79 | 26.04 | 17.62 | 0.0403 | 0.0115 | 0.0151 | 0 |
| visibility | shadows | 31.13 | 31.39 | 26.89 | 0.0212 | 0.0065 | 0.0043 | 0 |
| ao | noisy | 12.74 | 12.77 | – | 0.4135 | 0.3292 | – | 0 |
| ao | nrd-reblur-occlusion | 21.74 | 21.70 | – | 0.1461 | 0.0465 | – | 0 |
| ao | occlusion-recurrent | 32.59 | 33.16 | – | 0.0327 | 0.0099 | – | 0 |
| ao | occlusion-svgf | 33.55 | 33.89 | – | 0.0308 | 0.0099 | – | 0 |
| ao | occlusion-svgf-auto | 33.47 | 33.79 | – | 0.0309 | 0.0093 | – | 0 |
