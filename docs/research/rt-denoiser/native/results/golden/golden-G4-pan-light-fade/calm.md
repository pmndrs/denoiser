# golden-G4-pan-light-fade: calm (track D's calm.mjs, motion-compensated boil per region)


**diffuse** (boil x1e3; static / edge / disocc: boil of the output, its reference's in the ref row; dynamic: boil of the error; px = pixels per frame)

| capture | denoiser | static boil | dynamic err-boil (px) | edge boil | disocc boil (px) | static PSNR | dynamic PSNR | all PSNR | lag | still σ (8-bit) |
|---|---|---|---|---|---|---|---|---|---|---|
| golden-G4-pan-light-fade | noisy | 212.47 | 212.36 (53075) | 219.14 | 200.13 (115855) | 12.67 | 12.68 | 12.84 | 0 |  |
| golden-G4-pan-light-fade | nrd-reblur | 26.14 | 53.05 (53075) | 67.81 | 31.31 (115855) | 25.84 | 21.20 | 24.40 | 52 |  |
| golden-G4-pan-light-fade | nrd-reblur-tunedD | 17.76 | 45.78 (53075) | 51.55 | 22.09 (115855) | 27.32 | 22.11 | 25.84 | 51 |  |
| golden-G4-pan-light-fade | nrd-reblur-tunedS | 18.35 | 46.25 (53075) | 53.32 | 22.98 (115855) | 27.24 | 22.06 | 25.73 | 52 |  |
| golden-G4-pan-light-fade | nrd-relax | 12.93 | 40.52 (53075) | 33.11 | 15.29 (115855) | 28.50 | 23.07 | 27.28 | 48 |  |
| golden-G4-pan-light-fade | ours-auto | 12.40 | 39.18 (53075) | 33.59 | 19.50 (115855) | 31.60 | 24.93 | 29.15 | 47 |  |
| golden-G4-pan-light-fade | ref | 17.28 | 44.43 (53075) | 32.33 | 21.60 (115855) |  |  |  |  |  |


**specular** (boil x1e3; static / edge / disocc: boil of the output, its reference's in the ref row; dynamic: boil of the error; px = pixels per frame)

| capture | denoiser | static boil | dynamic err-boil (px) | edge boil | disocc boil (px) | static PSNR | dynamic PSNR | all PSNR | lag | still σ (8-bit) |
|---|---|---|---|---|---|---|---|---|---|---|
| golden-G4-pan-light-fade | noisy | 25.39 | 67.35 (3086) | 24.37 | 20.99 (115855) | 31.64 | 23.40 | 32.06 | 51 |  |
| golden-G4-pan-light-fade | nrd-reblur | 2.70 | 27.99 (3086) | 5.96 | 2.85 (115855) | 40.80 | 26.35 | 39.40 | 52 |  |
| golden-G4-pan-light-fade | nrd-reblur-tunedD | 2.27 | 27.61 (3086) | 5.68 | 2.60 (115855) | 41.53 | 26.80 | 40.03 | 52 |  |
| golden-G4-pan-light-fade | nrd-reblur-tunedS | 1.97 | 27.19 (3086) | 5.18 | 2.33 (115855) | 42.25 | 26.96 | 40.68 | 52 |  |
| golden-G4-pan-light-fade | nrd-relax | 1.62 | 25.76 (3086) | 5.00 | 2.11 (115855) | 41.79 | 27.58 | 40.41 | 52 |  |
| golden-G4-pan-light-fade | ours-auto | 2.97 | 22.85 (3086) | 7.43 | 3.40 (115855) | 45.65 | 29.37 | 43.83 | 53 |  |
| golden-G4-pan-light-fade | ref | 3.98 | 32.07 (3086) | 9.15 | 4.68 (115855) |  |  |  |  |  |


**ao** (boil x1e3; static / edge / disocc: boil of the output, its reference's in the ref row; dynamic: boil of the error; px = pixels per frame)

| capture | denoiser | static boil | dynamic err-boil (px) | edge boil | disocc boil (px) | static PSNR | dynamic PSNR | all PSNR | lag | still σ (8-bit) |
|---|---|---|---|---|---|---|---|---|---|---|
| golden-G4-pan-light-fade | ours-occ | 27.33 | 62.19 (58881) | 60.46 | 42.42 (115855) | 30.57 | 21.07 | 26.10 | 48 |  |
| golden-G4-pan-light-fade | ref | 31.16 | 93.92 (58881) | 63.27 | 44.58 (115855) |  |  |  |  |  |

