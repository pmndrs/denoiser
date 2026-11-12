# golden-G4-pan-light-fade: lag after the event at frame 24

event at frame 24. lag (track D's definition): frames after the event until MSE stays <= 1.1 x settled (mean of the last 16 frames) to the end; a value of 40 means "never" (often the camera's own late drift, see lag-to-pre). lag-to-pre: frames until MSE <= 1.1 x the pre-event level (mean of the 8 frames before) for 3 frames in a row

| signal | denoiser | lag (settled band) | lag-to-pre | peak / pre-event | peak / settled | pre-event / settled | settled PSNR dB |
|---|---|---|---|---|---|---|---|
| diffuse | noisy | 0 | 0 | 1.51 | 1.01 | 0.67 | 11.83 |
| diffuse | nrd-reblur | 28 | never | 3.23 | 2.09 | 0.65 | 24.73 |
| diffuse | nrd-reblur-tunedD | 27 | 37 | 3.20 | 2.68 | 0.84 | 26.94 |
| diffuse | nrd-reblur-tunedS | 28 | never | 3.18 | 2.58 | 0.81 | 26.71 |
| diffuse | nrd-relax | 24 | never | 2.89 | 2.31 | 0.80 | 28.04 |
| diffuse | ours-auto | 23 | 19 | 1.49 | 1.70 | 1.14 | 30.06 |
| specular | noisy | 27 | 14 | 1.28 | 4.71 | 3.67 | 36.80 |
| specular | nrd-reblur | 28 | 10 | 1.57 | 4.64 | 2.95 | 43.36 |
| specular | nrd-reblur-tunedD | 28 | 0 | 1.51 | 4.50 | 2.98 | 43.96 |
| specular | nrd-reblur-tunedS | 28 | 0 | 1.58 | 5.02 | 3.18 | 44.68 |
| specular | nrd-relax | 28 | 18 | 1.92 | 4.55 | 2.37 | 44.33 |
| specular | ours-auto | 29 | 8 | 1.51 | 6.39 | 4.24 | 48.92 |

event at frame 24. lag (track D's definition): frames after the event until MSE stays <= 1.1 x settled (mean of the last 16 frames) to the end; a value of 40 means "never" (often the camera's own late drift, see lag-to-pre). lag-to-pre: frames until MSE <= 1.1 x the pre-event level (mean of the 8 frames before) for 3 frames in a row

| signal | denoiser | lag (settled band) | lag-to-pre | peak / pre-event | peak / settled | pre-event / settled | settled PSNR dB |
|---|---|---|---|---|---|---|---|
| ao | ours-occ | 24 | 0 | 0.96 | 1.99 | 2.07 | 28.45 |

## lag from the end of the ramp (frame 40)

event at frame 40. lag (track D's definition): frames after the event until MSE stays <= 1.1 x settled (mean of the last 16 frames) to the end; a value of 24 means "never" (often the camera's own late drift, see lag-to-pre). lag-to-pre: frames until MSE <= 1.1 x the pre-event level (mean of the 8 frames before) for 3 frames in a row

| signal | denoiser | lag (settled band) | lag-to-pre | peak / pre-event | peak / settled | pre-event / settled | settled PSNR dB |
|---|---|---|---|---|---|---|---|
| diffuse | noisy | 0 | never | 1.19 | 1.01 | 0.85 | 11.83 |
| diffuse | nrd-reblur | 12 | 0 | 0.95 | 1.94 | 2.04 | 24.73 |
| diffuse | nrd-reblur-tunedD | 11 | 0 | 0.91 | 2.35 | 2.60 | 26.94 |
| diffuse | nrd-reblur-tunedS | 12 | 0 | 0.92 | 2.30 | 2.50 | 26.71 |
| diffuse | nrd-relax | 8 | 0 | 0.95 | 2.14 | 2.26 | 28.04 |
| diffuse | ours-auto | 7 | 0 | 0.99 | 1.61 | 1.63 | 30.06 |
