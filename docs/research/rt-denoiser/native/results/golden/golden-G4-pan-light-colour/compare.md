# golden-G4-pan-light-colour: replay scores

960×540, 64 frames, resets at [0], referenceSpp 4096. Metrics: CAPTURE-FORMAT.md; settled = ≥ 8 frames after a reset. PSNR, settled, last frame and penumbra are means of per-frame dB; pooled = PSNR of the mean MSE over all frames and pixels; capped = mean of per-frame dB clipped at 60 dB.

| denoiser | signal | PSNR dB (noisy → out) | pooled | capped | settled | settled pooled | last frame | penumbra | penumbra pooled | flicker (noisy → out) | bias | non-finite | GPU ms | wall ms |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| nrd-reblur | diffuse | 12.19 → **24.71** | 24.36 | 24.71 | 24.54 | 24.19 | 24.90 | – | – | 0.2734 → 0.0395 | -0.0063 | 0 | 1.816 | 2.11 |
| nrd-reblur | specular | 31.63 → **38.79** | 38.04 | 38.79 | 39.13 | 38.33 | 43.76 | – | – | 0.0189 → 0.0062 | 0.0004 | 0 | 1.816 | 2.11 |
| nrd-reblur-tunedD | diffuse | 12.19 → **26.01** | 25.60 | 26.01 | 25.91 | 25.46 | 26.84 | – | – | 0.2734 → 0.0317 | -0.0003 | 0 | 3.146 | 3.85 |
| nrd-reblur-tunedD | specular | 31.63 → **39.45** | 38.72 | 39.45 | 39.74 | 38.95 | 44.64 | – | – | 0.0189 → 0.0057 | 0.0001 | 0 | 3.146 | 3.85 |
| nrd-reblur-tunedS | diffuse | 12.19 → **25.89** | 25.49 | 25.89 | 25.78 | 25.35 | 26.69 | – | – | 0.2734 → 0.0323 | -0.0003 | 0 | 2.139 | 3.34 |
| nrd-reblur-tunedS | specular | 31.63 → **40.13** | 39.37 | 40.13 | 40.36 | 39.51 | 45.48 | – | – | 0.0189 → 0.0051 | 0.0002 | 0 | 2.139 | 3.34 |
| nrd-reference | diffuse | 12.19 → **12.19** | 12.11 | 12.19 | 12.02 | 11.96 | 11.52 | – | – | 0.2734 → 0.2734 | -0.0946 | 0 | 0.408 | – |
| nrd-reference | specular | 31.63 → **31.63** | 30.72 | 31.63 | 31.98 | 30.99 | 36.53 | – | – | 0.0189 → 0.0189 | -0.0010 | 0 | 0.408 | – |
| nrd-reference | visibility | 17.33 → **17.33** | 17.25 | 17.33 | 17.15 | 17.09 | 17.93 | 8.20 | 8.20 | 0.0642 → 0.0642 | 0.0002 | 0 | 0.408 | – |
| nrd-relax | diffuse | 12.19 → **27.30** | 26.91 | 27.30 | 27.25 | 26.81 | 27.91 | – | – | 0.2734 → 0.0267 | 0.0015 | 0 | 2.315 | 3.05 |
| nrd-relax | specular | 31.63 → **39.84** | 39.13 | 39.84 | 40.20 | 39.46 | 44.59 | – | – | 0.0189 → 0.0052 | -0.0008 | 0 | 2.315 | 3.05 |
| ours-auto | diffuse | 12.19 → **28.73** | 28.68 | 28.73 | 28.85 | 28.80 | 29.33 | – | – | 0.2734 → 0.0236 | 0.0005 | 0 | 11.493 | 16.70 |
| ours-auto | specular | 31.63 → **43.55** | 42.59 | 43.55 | 43.88 | 42.82 | 49.57 | – | – | 0.0189 → 0.0036 | 0.0003 | 0 | 11.493 | 16.70 |

Visibility, dynamic vs static region (dynamic: reference range over frames t-4..t > 0.05, reprojected; 19791 px per frame). Pooled PSNR; flicker = mean |e_t − e_t−1| and tPSNR, motion-compensated, valid history.

| denoiser | dynamic PSNR | dynamic flicker | dynamic tPSNR | dynamic boil | static PSNR | static penumbra | static flicker | static tPSNR | static penumbra boil | edge sharpness |
|---|---|---|---|---|---|---|---|---|---|---|
| noisy | 8.50 | 0.3213 | 5.66 | 0.4263 | 18.55 | 8.49 | 0.0310 | 15.43 | 0.3791 | 1.218 |
| nrd-reference | 8.50 | 0.3213 | 5.66 | 0.4263 | 18.55 | 8.49 | 0.0310 | 15.43 | 0.3791 | 1.218 |
| reference (its own boil) | | | | 0.2257 | | | | | 0.0461 | 1 |
