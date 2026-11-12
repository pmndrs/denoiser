# golden-G4-pan-light-colour: calm (track D's calm.mjs, motion-compensated boil per region)


**diffuse** (boil x1e3; static / edge / disocc: boil of the output, its reference's in the ref row; dynamic: boil of the error; px = pixels per frame)

| capture | denoiser | static boil | dynamic err-boil (px) | edge boil | disocc boil (px) | static PSNR | dynamic PSNR | all PSNR | lag | still σ (8-bit) |
|---|---|---|---|---|---|---|---|---|---|---|
| golden-G4-pan-light-colour | noisy | 221.38 | 219.75 (39595) | 231.16 | 215.25 (115855) | 12.00 | 12.07 | 12.11 | 0 |  |
| golden-G4-pan-light-colour | nrd-reblur | 26.45 | 61.29 (39595) | 69.92 | 32.25 (115855) | 26.38 | 20.23 | 24.36 | 52 |  |
| golden-G4-pan-light-colour | nrd-reblur-tunedD | 17.92 | 54.18 (39595) | 53.47 | 22.78 (115855) | 27.57 | 20.79 | 25.60 | 50 |  |
| golden-G4-pan-light-colour | nrd-reblur-tunedS | 18.51 | 54.64 (39595) | 55.28 | 23.71 (115855) | 27.48 | 20.75 | 25.49 | 50 |  |
| golden-G4-pan-light-colour | nrd-relax | 12.88 | 48.85 (39595) | 33.55 | 15.54 (115855) | 28.90 | 21.40 | 26.91 | 46 |  |
| golden-G4-pan-light-colour | ours-auto | 12.15 | 47.06 (39595) | 33.98 | 20.04 (115855) | 31.57 | 23.32 | 28.68 | 44 |  |
| golden-G4-pan-light-colour | ref | 17.93 | 54.10 (39595) | 34.46 | 24.23 (115855) |  |  |  |  |  |


**specular** (boil x1e3; static / edge / disocc: boil of the output, its reference's in the ref row; dynamic: boil of the error; px = pixels per frame)

| capture | denoiser | static boil | dynamic err-boil (px) | edge boil | disocc boil (px) | static PSNR | dynamic PSNR | all PSNR | lag | still σ (8-bit) |
|---|---|---|---|---|---|---|---|---|---|---|
| golden-G4-pan-light-colour | noisy | 29.37 | 69.21 (4231) | 28.76 | 26.11 (115855) | 30.46 | 23.20 | 30.71 | 51 |  |
| golden-G4-pan-light-colour | nrd-reblur | 3.10 | 28.51 (4231) | 7.12 | 3.77 (115855) | 39.58 | 26.62 | 38.04 | 52 |  |
| golden-G4-pan-light-colour | nrd-reblur-tunedD | 2.58 | 28.14 (4231) | 6.79 | 3.44 (115855) | 40.36 | 27.02 | 38.72 | 52 |  |
| golden-G4-pan-light-colour | nrd-reblur-tunedS | 2.20 | 27.67 (4231) | 6.19 | 3.08 (115855) | 41.03 | 27.14 | 39.36 | 53 |  |
| golden-G4-pan-light-colour | nrd-relax | 1.82 | 26.11 (4231) | 5.84 | 2.71 (115855) | 40.69 | 27.71 | 39.12 | 52 |  |
| golden-G4-pan-light-colour | ours-auto | 3.35 | 22.94 (4231) | 8.68 | 4.33 (115855) | 44.71 | 29.68 | 42.58 | 53 |  |
| golden-G4-pan-light-colour | ref | 4.44 | 33.17 (4231) | 10.80 | 5.91 (115855) |  |  |  |  |  |


**ao** (boil x1e3; static / edge / disocc: boil of the output, its reference's in the ref row; dynamic: boil of the error; px = pixels per frame)

| capture | denoiser | static boil | dynamic err-boil (px) | edge boil | disocc boil (px) | static PSNR | dynamic PSNR | all PSNR | lag | still σ (8-bit) |
|---|---|---|---|---|---|---|---|---|---|---|
| golden-G4-pan-light-colour | ours-occ | 27.33 | 62.19 (58881) | 60.46 | 42.42 (115855) | 30.57 | 21.07 | 26.10 | 48 |  |
| golden-G4-pan-light-colour | ref | 31.16 | 93.92 (58881) | 63.27 | 44.58 (115855) |  |  |  |  |  |

