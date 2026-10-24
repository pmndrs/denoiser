# synthetic-plane-1080p: replay scores

1920×1080, 8 frames, resets at [0], referenceSpp 0. Metrics: CAPTURE-FORMAT.md; settled = ≥ 8 frames after a reset.

| denoiser | signal | PSNR dB (noisy → out) | settled | last frame | penumbra | flicker (noisy → out) | bias | non-finite | GPU ms | wall ms |
|---|---|---|---|---|---|---|---|---|---|---|
| nrd-reblur | diffuse | 16.62 → **51.00** | – | 51.22 | – | 0.1629 → 0.0030 | -0.0006 | 0 | 5.282 | 5.42 |
| nrd-reblur | specular | 12.98 → **31.66** | – | 32.45 | – | 0.2343 → 0.0135 | 0.0024 | 0 | 5.282 | 5.42 |
| nrd-reference | diffuse | 16.62 → **16.62** | – | 16.62 | – | 0.1629 → 0.1629 | -0.0290 | 0 | 1.599 | – |
| nrd-reference | specular | 12.98 → **12.98** | – | 12.91 | – | 0.2343 → 0.2343 | -0.0839 | 0 | 1.599 | – |
| nrd-reference | visibility | 14.70 → **14.70** | – | 14.68 | 7.67 | 0.0839 → 0.0839 | -0.0003 | 0 | 1.599 | – |
| nrd-relax | diffuse | 16.62 → **50.84** | – | 50.98 | – | 0.1629 → 0.0030 | -0.0009 | 0 | 6.333 | 6.52 |
| nrd-relax | specular | 12.98 → **28.37** | – | 29.20 | – | 0.2343 → 0.0158 | 0.0040 | 0 | 6.333 | 6.52 |
| nrd-sigma | visibility | 14.70 → **27.41** | – | 26.78 | 20.67 | 0.0839 → 0.0170 | 0.0202 | 0 | 0.972 | 1.24 |
