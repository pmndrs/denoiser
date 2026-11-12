# golden-G3-orbit: replay scores

960×540, 64 frames, resets at [0], referenceSpp 4096. Metrics: CAPTURE-FORMAT.md; settled = ≥ 8 frames after a reset. PSNR, settled, last frame and penumbra are means of per-frame dB; pooled = PSNR of the mean MSE over all frames and pixels; capped = mean of per-frame dB clipped at 60 dB.

| denoiser | signal | PSNR dB (noisy → out) | pooled | capped | settled | settled pooled | last frame | penumbra | penumbra pooled | flicker (noisy → out) | bias | non-finite | GPU ms | wall ms |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| nrd-reblur | diffuse | 16.27 → **30.40** | 30.28 | 30.40 | 30.53 | 30.46 | 28.89 | – | – | 0.0882 → 0.0115 | -0.0020 | 0 | 1.519 | 2.56 |
| nrd-reblur | specular | 37.94 → **44.68** | 44.64 | 44.68 | 44.77 | 44.74 | 45.52 | – | – | 0.0095 → 0.0015 | -0.0002 | 0 | 1.519 | 2.56 |
| nrd-reblur-tunedD | diffuse | 16.27 → **31.07** | 30.98 | 31.07 | 31.10 | 31.02 | 29.43 | – | – | 0.0882 → 0.0107 | -0.0004 | 0 | 1.922 | 2.09 |
| nrd-reblur-tunedD | specular | 37.94 → **45.09** | 45.06 | 45.09 | 45.16 | 45.14 | 45.98 | – | – | 0.0095 → 0.0014 | -0.0001 | 0 | 1.922 | 2.09 |
| nrd-reblur-tunedS | diffuse | 16.27 → **31.02** | 30.92 | 31.02 | 31.05 | 30.97 | 29.38 | – | – | 0.0882 → 0.0107 | -0.0005 | 0 | 14.033 | 17.10 |
| nrd-reblur-tunedS | specular | 37.94 → **45.41** | 45.33 | 45.41 | 45.25 | 45.19 | 45.29 | – | – | 0.0095 → 0.0013 | -0.0000 | 0 | 14.033 | 17.10 |
| nrd-reference | diffuse | 16.27 → **16.27** | 16.23 | 16.27 | 16.19 | 16.15 | 15.06 | – | – | 0.0882 → 0.0882 | -0.0466 | 0 | 0.409 | – |
| nrd-reference | specular | 37.94 → **37.94** | 37.92 | 37.94 | 37.86 | 37.85 | 37.53 | – | – | 0.0095 → 0.0095 | -0.0002 | 0 | 0.409 | – |
| nrd-reference | visibility | 20.98 → **20.98** | 20.90 | 20.98 | 20.82 | 20.75 | 19.91 | 8.05 | 8.05 | 0.0249 → 0.0249 | 0.0003 | 0 | 0.409 | – |
| nrd-relax | diffuse | 16.27 → **32.21** | 32.14 | 32.21 | 32.29 | 32.22 | 30.64 | – | – | 0.0882 → 0.0097 | 0.0007 | 0 | 1.776 | 2.37 |
| nrd-relax | specular | 37.94 → **47.00** | 46.72 | 47.00 | 47.46 | 47.40 | 48.31 | – | – | 0.0095 → 0.0012 | 0.0000 | 0 | 1.776 | 2.37 |
| ours-auto | diffuse | 16.27 → **31.87** | 31.84 | 31.87 | 31.98 | 31.96 | 31.41 | – | – | 0.0882 → 0.0099 | -0.0011 | 0 | 25.606 | 29.90 |
| ours-auto | specular | 37.94 → **50.23** | 50.23 | 50.23 | 50.19 | 50.19 | 50.40 | – | – | 0.0095 → 0.0010 | -0.0001 | 0 | 25.606 | 29.90 |

Visibility, dynamic vs static region (dynamic: reference range over frames t-4..t > 0.05, reprojected; 9022 px per frame). Pooled PSNR; flicker = mean |e_t − e_t−1| and tPSNR, motion-compensated, valid history.

| denoiser | dynamic PSNR | dynamic flicker | dynamic tPSNR | dynamic boil | static PSNR | static penumbra | static flicker | static tPSNR | static penumbra boil | edge sharpness |
|---|---|---|---|---|---|---|---|---|---|---|
| noisy | 7.77 | 0.3887 | 4.70 | 0.4270 | 22.74 | 8.36 | 0.0122 | 19.41 | 0.3995 | 1.417 |
| nrd-reference | 7.77 | 0.3887 | 4.70 | 0.4270 | 22.74 | 8.36 | 0.0122 | 19.41 | 0.3995 | 1.417 |
| reference (its own boil) | | | | 0.1179 | | | | | 0.0343 | 1 |
