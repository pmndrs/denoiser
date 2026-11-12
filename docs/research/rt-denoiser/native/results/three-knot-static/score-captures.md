
## three-knot-static (960x540, 48 frames; settled = frames ≥ 8; FLIP every 4th frame, 20.69 ppd)

| signal | denoiser | pooled PSNR | settled pooled | penumbra pooled | FLIP | flicker | bias | non-finite |
|---|---|---|---|---|---|---|---|---|
| diffuse | noisy | 15.12 | 15.12 | – | 0.5141 | 0.2266 | -0.0467 | 0 |
| diffuse | accumulate | 26.61 | 31.17 | – | 0.1287 | 0.0146 | -0.0030 | 0 |
| diffuse | nrd-reblur | 32.22 | 32.53 | – | 0.1029 | 0.0055 | -0.0188 | 0 |
| diffuse | nrd-relax | 36.27 | 36.39 | – | 0.0729 | 0.0051 | -0.0108 | 0 |
| diffuse | recurrent | 37.94 | 38.59 | – | 0.0392 | 0.0051 | -0.0008 | 0 |
| diffuse | recurrent-svgfspec | 37.94 | 38.59 | – | 0.0392 | 0.0051 | -0.0008 | 0 |
| diffuse | svgf | 41.82 | 42.10 | – | 0.0358 | 0.0053 | -0.0009 | 0 |
| diffuse | svgf-auto | 42.09 | 42.45 | – | 0.0350 | 0.0052 | -0.0008 | 0 |
| specular | noisy | 32.92 | 32.93 | – | 0.1100 | 0.0087 | -0.0006 | 0 |
| specular | accumulate | 40.83 | 41.71 | – | 0.0429 | 0.0009 | 0.0001 | 0 |
| specular | ffx-reflections | 39.52 | 39.44 | – | 0.0382 | 0.0008 | -0.0003 | 0 |
| specular | nrd-reblur | 40.42 | 40.62 | – | 0.0368 | 0.0007 | -0.0001 | 0 |
| specular | nrd-relax | 42.39 | 42.72 | – | 0.0304 | 0.0007 | -0.0005 | 0 |
| specular | recurrent | 42.46 | 43.15 | – | 0.0262 | 0.0008 | -0.0002 | 0 |
| specular | recurrent-svgfspec | 45.99 | 46.20 | – | 0.0209 | 0.0007 | -0.0000 | 0 |
| specular | svgf | 45.67 | 45.80 | – | 0.0210 | 0.0007 | -0.0000 | 0 |
| specular | svgf-auto | 45.99 | 46.20 | – | 0.0209 | 0.0007 | -0.0000 | 0 |
| visibility | noisy | 16.85 | 16.85 | 7.84 | 0.0907 | 0.0472 | -0.0001 | 0 |
| visibility | accumulate | 28.94 | 33.48 | 20.06 | 0.0265 | 0.0035 | -0.0000 | 0 |
| visibility | ffx-shadows | 28.68 | 28.41 | 23.06 | 0.0470 | 0.0014 | -0.0468 | 0 |
| visibility | nrd-sigma | 21.50 | 21.52 | 12.53 | 0.0496 | 0.0151 | 0.0074 | 0 |
| visibility | shadows | 32.41 | 32.60 | 26.61 | 0.0241 | 0.0014 | 0.0006 | 0 |
| ao | noisy | 12.00 | 12.00 | – | 0.4419 | 0.3681 | – | 0 |
| ao | nrd-reblur-occlusion | 26.20 | 27.25 | – | 0.0952 | 0.0142 | – | 0 |
| ao | occlusion-recurrent | 35.60 | 36.75 | – | 0.0301 | 0.0062 | – | 0 |
| ao | occlusion-svgf | 39.96 | 40.57 | – | 0.0281 | 0.0068 | – | 0 |
| ao | occlusion-svgf-auto | 40.42 | 41.19 | – | 0.0278 | 0.0063 | – | 0 |
