# synthetic-plane: replay scores

256×256, 8 frames, resets at [0], referenceSpp 0. Metrics: CAPTURE-FORMAT.md; settled = ≥ 8 frames after a reset.

| denoiser | signal | PSNR dB (noisy → out) | settled | last frame | penumbra | flicker (noisy → out) | bias | non-finite | GPU ms | wall ms |
|---|---|---|---|---|---|---|---|---|---|---|
| nrd-reference | diffuse | 16.62 → **16.62** | – | 16.64 | – | 0.1632 → 0.1632 | -0.0289 | 0 | 0.061 | – |
| nrd-reference | specular | 12.79 → **12.79** | – | 12.86 | – | 0.2397 → 0.2397 | -0.0885 | 0 | 0.061 | – |
| nrd-reference | visibility | 14.45 → **14.45** | – | 14.34 | 7.63 | 0.0859 → 0.0859 | -0.0004 | 0 | 0.061 | – |
| nrd-reblur | diffuse | 16.62 → **50.53** | – | 51.54 | – | 0.1632 → 0.0029 | -0.0007 | 0 | 0.246 | 0.42 |
| nrd-reblur | specular | 12.79 → **25.00** | – | 25.37 | – | 0.2397 → 0.0230 | 0.0073 | 0 | 0.246 | 0.42 |
| nrd-relax | diffuse | 16.62 → **50.92** | – | 51.69 | – | 0.1632 → 0.0029 | -0.0006 | 0 | 0.294 | 0.42 |
| nrd-relax | specular | 12.79 → **23.49** | – | 23.97 | – | 0.2397 → 0.0205 | 0.0102 | 0 | 0.294 | 0.42 |
| nrd-sigma | visibility | 14.45 → **20.50** | – | 20.98 | 15.72 | 0.0859 → 0.0440 | 0.0113 | 0 | 0.097 | 0.21 |
| nrd-reference-prev-eq-cur | diffuse | 16.62 → **21.52** | – | 22.88 | – | 0.1632 → 0.0347 | -0.0163 | 0 | 0.067 | – |
| nrd-reference-prev-eq-cur | specular | 12.79 → **16.39** | – | 17.31 | – | 0.2397 → 0.0621 | -0.0404 | 0 | 0.067 | – |
| nrd-reference-prev-eq-cur | visibility | 14.45 → **14.35** | – | 12.94 | 11.17 | 0.0859 → 0.0539 | -0.0091 | 0 | 0.067 | – |
