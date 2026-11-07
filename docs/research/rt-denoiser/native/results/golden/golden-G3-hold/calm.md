# golden-G3-hold: calm (track D's calm.mjs, motion-compensated boil per region)


**diffuse** (boil x1e3; static / edge / disocc: boil of the output, its reference's in the ref row; dynamic: boil of the error; px = pixels per frame)

| capture | denoiser | static boil | dynamic err-boil (px) | edge boil | disocc boil (px) | static PSNR | dynamic PSNR | all PSNR | lag | still σ (8-bit) |
|---|---|---|---|---|---|---|---|---|---|---|
| golden-G3-hold | noisy | 132.61 | – (0) | 170.80 | 138.75 (103559) | 17.14 | – | 16.75 | 0 | 24.28 |
| golden-G3-hold | nrd-reblur | 0.55 | – (0) | 1.66 | 14.12 (103559) | 33.99 | – | 31.92 | 18 | 0.43 |
| golden-G3-hold | nrd-reblur-tunedD | 0.41 | – (0) | 1.53 | 9.92 (103559) | 35.24 | – | 33.41 | 17 | 0.36 |
| golden-G3-hold | nrd-reblur-tunedS | 0.42 | – (0) | 1.56 | 10.13 (103559) | 35.15 | – | 33.30 | 17 | 0.35 |
| golden-G3-hold | nrd-relax | 2.08 | – (0) | 4.15 | 5.66 (103559) | 36.24 | – | 34.44 | 16 | 0.63 |
| golden-G3-hold | ours-auto | 3.13 | – (0) | 9.76 | 7.89 (103559) | 35.52 | – | 33.30 | 12 | 1.19 |
| golden-G3-hold | ref | 0.00 | – (0) | 0.00 | 0.00 (103559) |  |  |  |  | 0.00 |


**specular** (boil x1e3; static / edge / disocc: boil of the output, its reference's in the ref row; dynamic: boil of the error; px = pixels per frame)

| capture | denoiser | static boil | dynamic err-boil (px) | edge boil | disocc boil (px) | static PSNR | dynamic PSNR | all PSNR | lag | still σ (8-bit) |
|---|---|---|---|---|---|---|---|---|---|---|
| golden-G3-hold | noisy | 11.88 | – (0) | 18.01 | 13.46 (103559) | 38.78 | – | 38.07 | 0 | 2.14 |
| golden-G3-hold | nrd-reblur | 0.08 | – (0) | 0.20 | 1.16 (103559) | 48.91 | – | 45.36 | 18 | 0.05 |
| golden-G3-hold | nrd-reblur-tunedD | 0.07 | – (0) | 0.19 | 0.98 (103559) | 49.98 | – | 46.26 | 19 | 0.04 |
| golden-G3-hold | nrd-reblur-tunedS | 0.07 | – (0) | 0.16 | 0.73 (103559) | 52.11 | – | 48.60 | 18 | 0.03 |
| golden-G3-hold | nrd-relax | 0.20 | – (0) | 0.46 | 0.73 (103559) | 51.53 | – | 46.93 | 20 | 0.05 |
| golden-G3-hold | ours-auto | 0.16 | – (0) | 0.54 | 0.44 (103559) | 55.78 | – | 52.87 | 4 | 0.03 |
| golden-G3-hold | ref | 0.02 | – (0) | 0.04 | 0.03 (103559) |  |  |  |  | 0.00 |


**ao** (boil x1e3; static / edge / disocc: boil of the output, its reference's in the ref row; dynamic: boil of the error; px = pixels per frame)

| capture | denoiser | static boil | dynamic err-boil (px) | edge boil | disocc boil (px) | static PSNR | dynamic PSNR | all PSNR | lag | still σ (8-bit) |
|---|---|---|---|---|---|---|---|---|---|---|
| golden-G3-hold | ours-occ | 2.80 | – (0) | 5.89 | 9.34 (103559) | 35.97 | – | 33.95 | 11 | 1.03 |
| golden-G3-hold | ref | 0.00 | – (0) | 0.00 | 0.00 (103559) |  |  |  |  | 0.00 |

