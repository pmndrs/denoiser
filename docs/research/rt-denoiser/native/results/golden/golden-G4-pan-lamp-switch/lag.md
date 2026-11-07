# golden-G4-pan-lamp-switch: lag after the event at frame 32

event at frame 32. lag (track D's definition): frames after the event until MSE stays <= 1.1 x settled (mean of the last 16 frames) to the end; a value of 32 means "never" (often the camera's own late drift, see lag-to-pre). lag-to-pre: frames until MSE <= 1.1 x the pre-event level (mean of the 8 frames before) for 3 frames in a row

| signal | denoiser | lag (settled band) | lag-to-pre | peak / pre-event | peak / settled | pre-event / settled | settled PSNR dB |
|---|---|---|---|---|---|---|---|
| diffuse | noisy | 0 | 0 | 0.81 | 0.96 | 1.18 | 13.08 |
| diffuse | nrd-reblur | 18 | 18 | 5.58 | 5.65 | 1.01 | 25.76 |
| diffuse | nrd-reblur-tunedD | 19 | 15 | 7.10 | 9.11 | 1.28 | 27.89 |
| diffuse | nrd-reblur-tunedS | 19 | 15 | 7.00 | 8.67 | 1.24 | 27.65 |
| diffuse | nrd-relax | 17 | 11 | 7.84 | 11.49 | 1.47 | 29.83 |
| diffuse | ours-auto | 32 | 3 | 4.55 | 8.94 | 1.96 | 31.71 |
| specular | noisy | 32 | 0 | 0.55 | 8.89 | 16.05 | 41.03 |
| specular | nrd-reblur | 32 | 2 | 1.41 | 20.90 | 14.78 | 48.20 |
| specular | nrd-reblur-tunedD | 32 | 2 | 1.61 | 24.06 | 14.91 | 48.99 |
| specular | nrd-reblur-tunedS | 32 | 2 | 1.69 | 28.01 | 16.62 | 49.81 |
| specular | nrd-relax | 32 | 2 | 1.60 | 19.25 | 12.05 | 48.70 |
| specular | ours-auto | 32 | 0 | 1.06 | 24.11 | 22.65 | 54.08 |

event at frame 32. lag (track D's definition): frames after the event until MSE stays <= 1.1 x settled (mean of the last 16 frames) to the end; a value of 32 means "never" (often the camera's own late drift, see lag-to-pre). lag-to-pre: frames until MSE <= 1.1 x the pre-event level (mean of the 8 frames before) for 3 frames in a row

| signal | denoiser | lag (settled band) | lag-to-pre | peak / pre-event | peak / settled | pre-event / settled | settled PSNR dB |
|---|---|---|---|---|---|---|---|
| ao | ours-occ | 16 | 0 | 0.93 | 1.76 | 1.89 | 28.45 |
