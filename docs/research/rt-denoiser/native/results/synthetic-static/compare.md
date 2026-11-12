# synthetic-static: replay scores

256×256, 8 frames, resets at [0], referenceSpp 0. Metrics: CAPTURE-FORMAT.md; settled = ≥ 8 frames after a reset.

| denoiser | signal | PSNR dB (noisy → out) | settled | last frame | penumbra | flicker (noisy → out) | bias | non-finite | GPU ms | wall ms |
|---|---|---|---|---|---|---|---|---|---|---|
| nrd-reblur | diffuse | 16.62 → **52.30** | – | 52.99 | – | 0.1631 → 0.0012 | -0.0012 | 0 | 0.189 | 0.33 |
| nrd-reblur | specular | 12.87 → **25.27** | – | 26.01 | – | 0.2365 → 0.0056 | 0.0065 | 0 | 0.189 | 0.33 |
| nrd-reference | diffuse | 16.62 → **22.99** | – | 26.53 | – | 0.1631 → 0.0340 | -0.0094 | 0 | 0.059 | – |
| nrd-reference | specular | 12.87 → **18.28** | – | 21.51 | – | 0.2365 → 0.0513 | -0.0334 | 0 | 0.059 | – |
| nrd-reference | visibility | 14.49 → **20.28** | – | 23.63 | 13.42 | 0.0711 → 0.0174 | 0.0020 | 0 | 0.059 | – |
| nrd-relax | diffuse | 16.62 → **54.80** | – | 57.30 | – | 0.1631 → 0.0008 | -0.0008 | 0 | 0.238 | 0.38 |
| nrd-relax | specular | 12.87 → **24.61** | – | 26.34 | – | 0.2365 → 0.0040 | 0.0076 | 0 | 0.238 | 0.38 |
| nrd-sigma | visibility | 14.49 → **26.81** | – | 30.19 | 20.04 | 0.0711 → 0.0040 | 0.0152 | 0 | 0.094 | 0.22 |
