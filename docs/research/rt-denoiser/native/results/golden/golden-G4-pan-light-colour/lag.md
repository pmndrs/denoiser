# golden-G4-pan-light-colour: lag after the event at frame 32

event at frame 32. lag (track D's definition): frames after the event until MSE stays <= 1.1 x settled (mean of the last 16 frames) to the end; a value of 32 means "never" (often the camera's own late drift, see lag-to-pre). lag-to-pre: frames until MSE <= 1.1 x the pre-event level (mean of the 8 frames before) for 3 frames in a row

| signal | denoiser | lag (settled band) | lag-to-pre | peak / pre-event | peak / settled | pre-event / settled | settled PSNR dB |
|---|---|---|---|---|---|---|---|
| diffuse | noisy | 0 | never | 1.28 | 1.01 | 0.79 | 11.33 |
| diffuse | nrd-reblur | 20 | never | 4.18 | 3.17 | 0.76 | 24.51 |
| diffuse | nrd-reblur-tunedD | 18 | 21 | 4.95 | 4.63 | 0.93 | 26.51 |
| diffuse | nrd-reblur-tunedS | 18 | 23 | 4.88 | 4.42 | 0.91 | 26.29 |
| diffuse | nrd-relax | 14 | 23 | 5.56 | 5.07 | 0.91 | 27.77 |
| diffuse | ours-auto | 12 | 6 | 1.95 | 2.23 | 1.14 | 29.36 |
| specular | noisy | 19 | 0 | 0.91 | 5.17 | 5.68 | 36.52 |
| specular | nrd-reblur | 20 | 2 | 1.37 | 6.19 | 4.52 | 43.05 |
| specular | nrd-reblur-tunedD | 20 | 3 | 1.49 | 6.43 | 4.32 | 43.62 |
| specular | nrd-reblur-tunedS | 21 | 3 | 1.53 | 7.22 | 4.71 | 44.33 |
| specular | nrd-relax | 20 | 3 | 1.86 | 7.57 | 4.06 | 43.98 |
| specular | ours-auto | 21 | 1 | 1.25 | 7.67 | 6.13 | 48.41 |

event at frame 32. lag (track D's definition): frames after the event until MSE stays <= 1.1 x settled (mean of the last 16 frames) to the end; a value of 32 means "never" (often the camera's own late drift, see lag-to-pre). lag-to-pre: frames until MSE <= 1.1 x the pre-event level (mean of the 8 frames before) for 3 frames in a row

| signal | denoiser | lag (settled band) | lag-to-pre | peak / pre-event | peak / settled | pre-event / settled | settled PSNR dB |
|---|---|---|---|---|---|---|---|
| ao | ours-occ | 16 | 0 | 0.93 | 1.76 | 1.89 | 28.45 |
