# golden-G4-pan-light-on: lag after the event at frame 32

event at frame 32. lag (track D's definition): frames after the event until MSE stays <= 1.1 x settled (mean of the last 16 frames) to the end; a value of 32 means "never" (often the camera's own late drift, see lag-to-pre). lag-to-pre: frames until MSE <= 1.1 x the pre-event level (mean of the 8 frames before) for 3 frames in a row

| signal | denoiser | lag (settled band) | lag-to-pre | peak / pre-event | peak / settled | pre-event / settled | settled PSNR dB |
|---|---|---|---|---|---|---|---|
| diffuse | noisy | 0 | never | 1.37 | 1.01 | 0.73 | 11.83 |
| diffuse | nrd-reblur | 20 | never | 9.01 | 6.91 | 0.77 | 24.82 |
| diffuse | nrd-reblur-tunedD | 18 | 20 | 10.60 | 10.34 | 0.98 | 27.05 |
| diffuse | nrd-reblur-tunedS | 18 | 21 | 10.42 | 9.84 | 0.94 | 26.82 |
| diffuse | nrd-relax | 16 | never | 11.60 | 10.15 | 0.87 | 28.17 |
| diffuse | ours-auto | 13 | 6 | 3.21 | 3.76 | 1.17 | 30.04 |
| specular | noisy | 19 | 6 | 1.29 | 5.26 | 4.06 | 36.80 |
| specular | nrd-reblur | 19 | 4 | 2.03 | 7.16 | 3.52 | 43.39 |
| specular | nrd-reblur-tunedD | 20 | 5 | 2.29 | 7.69 | 3.36 | 43.98 |
| specular | nrd-reblur-tunedS | 20 | 5 | 2.41 | 8.83 | 3.67 | 44.72 |
| specular | nrd-relax | 20 | 6 | 3.06 | 9.71 | 3.17 | 44.35 |
| specular | ours-auto | 21 | 2 | 1.84 | 8.97 | 4.87 | 48.92 |

event at frame 32. lag (track D's definition): frames after the event until MSE stays <= 1.1 x settled (mean of the last 16 frames) to the end; a value of 32 means "never" (often the camera's own late drift, see lag-to-pre). lag-to-pre: frames until MSE <= 1.1 x the pre-event level (mean of the 8 frames before) for 3 frames in a row

| signal | denoiser | lag (settled band) | lag-to-pre | peak / pre-event | peak / settled | pre-event / settled | settled PSNR dB |
|---|---|---|---|---|---|---|---|
| ao | ours-occ | 16 | 0 | 0.93 | 1.76 | 1.89 | 28.45 |
