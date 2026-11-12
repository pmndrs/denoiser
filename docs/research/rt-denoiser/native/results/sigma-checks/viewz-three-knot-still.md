# three-knot-still: replay scores

960×540, 32 frames, resets at [0], referenceSpp 64. Metrics: CAPTURE-FORMAT.md; settled = ≥ 8 frames after a reset. PSNR, settled, last frame and penumbra are means of per-frame dB; pooled = PSNR of the mean MSE over all frames and pixels; capped = mean of per-frame dB clipped at 60 dB.

| denoiser | signal | PSNR dB (noisy → out) | pooled | capped | settled | settled pooled | last frame | penumbra | penumbra pooled | flicker (noisy → out) | bias | non-finite | GPU ms | wall ms |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| nrd-reblur-vzneg | diffuse | 15.05 → **29.23** | 29.19 | 29.23 | 29.43 | 29.43 | 29.44 | – | – | 0.2287 → 0.0287 | -0.0177 | 0 | 1.694 | 1.88 |
| nrd-reblur-vzneg | specular | 32.35 → **39.30** | 39.15 | 39.30 | 39.82 | 39.80 | 40.44 | – | – | 0.0097 → 0.0041 | 0.0001 | 0 | 1.694 | 1.88 |
| nrd-reblur-vzpos | diffuse | 15.05 → **29.23** | 29.19 | 29.23 | 29.43 | 29.43 | 29.44 | – | – | 0.2287 → 0.0287 | -0.0177 | 0 | 1.694 | 1.90 |
| nrd-reblur-vzpos | specular | 32.35 → **39.30** | 39.15 | 39.30 | 39.82 | 39.80 | 40.44 | – | – | 0.0097 → 0.0041 | 0.0001 | 0 | 1.694 | 1.90 |
| nrd-relax-vzneg | diffuse | 15.05 → **30.77** | 30.76 | 30.77 | 30.82 | 30.82 | 30.82 | – | – | 0.2287 → 0.0283 | -0.0096 | 0 | 2.181 | 2.35 |
| nrd-relax-vzneg | specular | 32.35 → **40.44** | 40.25 | 40.44 | 40.99 | 40.97 | 41.57 | – | – | 0.0097 → 0.0041 | -0.0005 | 0 | 2.181 | 2.35 |
| nrd-relax-vzpos | diffuse | 15.05 → **30.77** | 30.76 | 30.77 | 30.82 | 30.82 | 30.82 | – | – | 0.2287 → 0.0283 | -0.0096 | 0 | 2.181 | 2.35 |
| nrd-relax-vzpos | specular | 32.35 → **40.44** | 40.25 | 40.44 | 40.99 | 40.97 | 41.57 | – | – | 0.0097 → 0.0041 | -0.0005 | 0 | 2.181 | 2.35 |
| nrd-sigma-vzneg | visibility | 16.79 → **21.47** | 21.47 | 21.47 | 21.48 | 21.48 | 21.49 | 12.53 | 12.53 | 0.0474 → 0.0152 | 0.0069 | 0 | 0.351 | 0.48 |
| nrd-sigma-vzpos | visibility | 16.79 → **21.47** | 21.47 | 21.47 | 21.48 | 21.48 | 21.49 | 12.53 | 12.53 | 0.0474 → 0.0152 | 0.0069 | 0 | 0.350 | 0.50 |
