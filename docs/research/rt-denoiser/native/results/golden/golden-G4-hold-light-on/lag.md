# golden-G4-hold-light-on: lag after the light step at frame 16 (still camera; settled = mean of the last 8 frames, since the hold is 32 frames)

event at frame 16. lag (track D's definition): frames after the event until MSE stays <= 1.1 x settled (mean of the last 8 frames) to the end; a value of 16 means "never" (often the camera's own late drift, see lag-to-pre). lag-to-pre: frames until MSE <= 1.1 x the pre-event level (mean of the 8 frames before) for 3 frames in a row

| signal | denoiser | lag (settled band) | lag-to-pre | peak / pre-event | peak / settled | pre-event / settled | settled PSNR dB |
|---|---|---|---|---|---|---|---|
| diffuse | noisy | 0 | never | 1.20 | 1.00 | 0.84 | 12.79 |
| diffuse | nrd-reblur | 11 | never | 37.16 | 3.59 | 0.10 | 20.62 |
| diffuse | nrd-reblur-tunedD | 11 | never | 46.13 | 3.91 | 0.08 | 21.26 |
| diffuse | nrd-reblur-tunedS | 11 | never | 45.16 | 3.89 | 0.09 | 21.24 |
| diffuse | nrd-relax | 11 | never | 51.77 | 6.61 | 0.13 | 24.06 |
| diffuse | ours-auto | 8 | 13 | 5.48 | 4.85 | 0.89 | 31.76 |
| specular | noisy | 0 | never | 1.55 | 1.01 | 0.65 | 29.28 |
| specular | nrd-reblur | 10 | never | 5.76 | 2.04 | 0.35 | 35.98 |
| specular | nrd-reblur-tunedD | 10 | never | 7.18 | 2.00 | 0.28 | 35.94 |
| specular | nrd-reblur-tunedS | 10 | never | 10.22 | 2.20 | 0.22 | 36.62 |
| specular | nrd-relax | 10 | never | 8.59 | 2.47 | 0.29 | 37.34 |
| specular | ours-auto | 5 | never | 4.95 | 3.17 | 0.64 | 44.94 |

event at frame 16. lag (track D's definition): frames after the event until MSE stays <= 1.1 x settled (mean of the last 8 frames) to the end; a value of 16 means "never" (often the camera's own late drift, see lag-to-pre). lag-to-pre: frames until MSE <= 1.1 x the pre-event level (mean of the 8 frames before) for 3 frames in a row

| signal | denoiser | lag (settled band) | lag-to-pre | peak / pre-event | peak / settled | pre-event / settled | settled PSNR dB |
|---|---|---|---|---|---|---|---|
| ao | ours-occ | 0 | 0 | 0.92 | 1.04 | 1.13 | 32.86 |
