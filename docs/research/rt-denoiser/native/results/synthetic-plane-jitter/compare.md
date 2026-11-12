# synthetic-plane-jitter: replay scores

256×256, 8 frames, resets at [0], referenceSpp 0. Metrics: CAPTURE-FORMAT.md; settled = ≥ 8 frames after a reset.

| denoiser | signal | PSNR dB (noisy → out) | settled | last frame | penumbra | flicker (noisy → out) | bias | non-finite | GPU ms | wall ms |
|---|---|---|---|---|---|---|---|---|---|---|
| nrd-reblur | diffuse | 16.62 → **50.60** | – | 51.76 | – | 0.1632 → 0.0028 | -0.0007 | 0 | 0.243 | 0.46 |
| nrd-reblur | specular | 12.79 → **25.01** | – | 25.43 | – | 0.2398 → 0.0230 | 0.0074 | 0 | 0.243 | 0.46 |
| nrd-reference | diffuse | 16.62 → **16.62** | – | 16.64 | – | 0.1632 → 0.1632 | -0.0289 | 0 | 0.070 | – |
| nrd-reference | specular | 12.79 → **12.79** | – | 12.86 | – | 0.2398 → 0.2398 | -0.0885 | 0 | 0.070 | – |
| nrd-reference | visibility | 14.46 → **14.46** | – | 14.32 | 7.64 | 0.0861 → 0.0861 | 0.0002 | 0 | 0.070 | – |
| nrd-relax | diffuse | 16.62 → **50.98** | – | 51.94 | – | 0.1632 → 0.0028 | -0.0006 | 0 | 0.293 | 0.55 |
| nrd-relax | specular | 12.79 → **23.51** | – | 23.97 | – | 0.2398 → 0.0208 | 0.0103 | 0 | 0.293 | 0.55 |
| nrd-sigma | visibility | 14.46 → **22.19** | – | 20.97 | 16.10 | 0.0861 → 0.0346 | 0.0115 | 0 | 0.097 | 0.22 |
