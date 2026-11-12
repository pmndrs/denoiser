
## three-knot-still (960x540, 32 frames; settled = frames ≥ 8; FLIP every 4th frame, 20.69 ppd)

| signal | denoiser | pooled PSNR | settled pooled | penumbra pooled | FLIP | flicker | bias | non-finite |
|---|---|---|---|---|---|---|---|---|
| diffuse | noisy | 15.05 | 15.05 | – | 0.5051 | 0.2287 | -0.0459 | 0 |
| diffuse | accumulate | 24.31 | 27.87 | – | 0.1620 | 0.0360 | -0.0034 | 0 |
| diffuse | nrd-reblur | 29.19 | 29.43 | – | 0.1370 | 0.0287 | -0.0177 | 0 |
| diffuse | nrd-relax | 30.76 | 30.82 | – | 0.1226 | 0.0283 | -0.0096 | 0 |
| diffuse | recurrent | 30.99 | 31.17 | – | 0.1158 | 0.0283 | 0.0002 | 0 |
| diffuse | recurrent-svgfspec | 30.99 | 31.17 | – | 0.1158 | 0.0283 | 0.0002 | 0 |
| diffuse | svgf | 31.61 | 31.66 | – | 0.1136 | 0.0284 | -0.0001 | 0 |
| diffuse | svgf-auto | 31.64 | 31.69 | – | 0.1135 | 0.0284 | 0.0000 | 0 |
| specular | noisy | 32.35 | 32.35 | – | 0.1102 | 0.0097 | -0.0005 | 0 |
| specular | accumulate | 39.17 | 40.57 | – | 0.0618 | 0.0042 | 0.0001 | 0 |
| specular | ffx-reflections | 38.89 | 39.13 | – | 0.0656 | 0.0041 | -0.0001 | 0 |
| specular | nrd-reblur | 39.15 | 39.80 | – | 0.0637 | 0.0041 | 0.0001 | 0 |
| specular | nrd-relax | 40.25 | 40.97 | – | 0.0613 | 0.0041 | -0.0005 | 0 |
| specular | recurrent | 39.71 | 40.41 | – | 0.0597 | 0.0041 | -0.0000 | 0 |
| specular | recurrent-svgfspec | 40.94 | 41.13 | – | 0.0580 | 0.0041 | 0.0000 | 0 |
| specular | svgf | 41.01 | 41.21 | – | 0.0578 | 0.0041 | 0.0000 | 0 |
| specular | svgf-auto | 40.94 | 41.13 | – | 0.0580 | 0.0041 | 0.0000 | 0 |
| visibility | noisy | 16.79 | 16.79 | 7.81 | 0.0915 | 0.0474 | 0.0001 | 0 |
| visibility | accumulate | 27.57 | 32.88 | 18.60 | 0.0296 | 0.0046 | 0.0001 | 0 |
| visibility | ffx-shadows | 28.89 | 28.49 | 23.34 | 0.0475 | 0.0015 | -0.0463 | 0 |
| visibility | nrd-sigma | 21.47 | 21.48 | 12.53 | 0.0495 | 0.0152 | 0.0069 | 0 |
| visibility | shadows | 32.33 | 32.63 | 26.55 | 0.0245 | 0.0015 | 0.0005 | 0 |
| ao | noisy | 11.93 | 11.93 | – | 0.4335 | 0.3710 | – | 0 |
| ao | nrd-reblur-occlusion | 24.43 | 25.47 | – | 0.1238 | 0.0388 | – | 0 |
| ao | occlusion-recurrent | 28.95 | 29.28 | – | 0.0885 | 0.0338 | – | 0 |
| ao | occlusion-svgf | 29.72 | 29.81 | – | 0.0869 | 0.0340 | – | 0 |
| ao | occlusion-svgf-auto | 29.77 | 29.86 | – | 0.0869 | 0.0339 | – | 0 |
