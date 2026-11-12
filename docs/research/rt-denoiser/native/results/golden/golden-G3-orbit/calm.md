# golden-G3-orbit: calm (track D's calm.mjs, motion-compensated boil per region)


**diffuse** (boil x1e3; static / edge / disocc: boil of the output, its reference's in the ref row; dynamic: boil of the error; px = pixels per frame)

| capture | denoiser | static boil | dynamic err-boil (px) | edge boil | disocc boil (px) | static PSNR | dynamic PSNR | all PSNR | lag | still σ (8-bit) |
|---|---|---|---|---|---|---|---|---|---|---|
| golden-G3-orbit | noisy | 134.92 | 190.82 (19304) | 164.51 | 127.53 (56966) | 16.61 | 13.37 | 16.23 | 0 |  |
| golden-G3-orbit | nrd-reblur | 4.69 | 34.71 (19304) | 9.28 | 13.92 (56966) | 32.21 | 23.91 | 30.28 | 64 |  |
| golden-G3-orbit | nrd-reblur-tunedD | 3.39 | 34.36 (19304) | 7.61 | 10.22 (56966) | 32.96 | 24.13 | 30.98 | 64 |  |
| golden-G3-orbit | nrd-reblur-tunedS | 3.40 | 34.38 (19304) | 7.73 | 10.38 (56966) | 32.90 | 24.11 | 30.92 | 64 |  |
| golden-G3-orbit | nrd-relax | 4.49 | 30.89 (19304) | 10.22 | 7.55 (56966) | 34.06 | 25.88 | 32.14 | 64 |  |
| golden-G3-orbit | ours-auto | 4.85 | 31.11 (19304) | 20.41 | 11.56 (56966) | 34.15 | 25.90 | 31.84 | 4 |  |
| golden-G3-orbit | ref | 11.93 | 35.34 (19304) | 20.82 | 12.39 (56966) |  |  |  |  |  |


**specular** (boil x1e3; static / edge / disocc: boil of the output, its reference's in the ref row; dynamic: boil of the error; px = pixels per frame)

| capture | denoiser | static boil | dynamic err-boil (px) | edge boil | disocc boil (px) | static PSNR | dynamic PSNR | all PSNR | lag | still σ (8-bit) |
|---|---|---|---|---|---|---|---|---|---|---|
| golden-G3-orbit | noisy | 11.59 | 63.09 (416) | 16.94 | 12.24 (56966) | 38.57 | 23.68 | 37.92 | 0 |  |
| golden-G3-orbit | nrd-reblur | 0.76 | 18.43 (416) | 1.92 | 1.46 (56966) | 47.77 | 27.02 | 44.64 | 41 |  |
| golden-G3-orbit | nrd-reblur-tunedD | 0.57 | 18.32 (416) | 1.83 | 1.22 (56966) | 48.29 | 27.31 | 45.06 | 53 |  |
| golden-G3-orbit | nrd-reblur-tunedS | 0.45 | 18.52 (416) | 1.73 | 0.95 (56966) | 48.56 | 27.28 | 45.33 | 53 |  |
| golden-G3-orbit | nrd-relax | 0.42 | 16.27 (416) | 1.41 | 1.11 (56966) | 50.68 | 29.77 | 46.72 | 41 |  |
| golden-G3-orbit | ours-auto | 0.77 | 13.97 (416) | 2.84 | 1.25 (56966) | 53.02 | 32.55 | 50.23 | 39 |  |
| golden-G3-orbit | ref | 1.29 | 20.50 (416) | 3.64 | 1.85 (56966) |  |  |  |  |  |


**ao** (boil x1e3; static / edge / disocc: boil of the output, its reference's in the ref row; dynamic: boil of the error; px = pixels per frame)

| capture | denoiser | static boil | dynamic err-boil (px) | edge boil | disocc boil (px) | static PSNR | dynamic PSNR | all PSNR | lag | still σ (8-bit) |
|---|---|---|---|---|---|---|---|---|---|---|
| golden-G3-orbit | ours-occ | 6.01 | 40.13 (28352) | 32.11 | 18.61 (56966) | 34.30 | 22.87 | 30.59 | 46 |  |
| golden-G3-orbit | ref | 11.28 | 56.09 (28352) | 35.11 | 19.30 (56966) |  |  |  |  |  |

