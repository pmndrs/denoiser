# golden-G4-pan-light-on: calm (track D's calm.mjs, motion-compensated boil per region)


**diffuse** (boil x1e3; static / edge / disocc: boil of the output, its reference's in the ref row; dynamic: boil of the error; px = pixels per frame)

| capture | denoiser | static boil | dynamic err-boil (px) | edge boil | disocc boil (px) | static PSNR | dynamic PSNR | all PSNR | lag | still σ (8-bit) |
|---|---|---|---|---|---|---|---|---|---|---|
| golden-G4-pan-light-on | noisy | 214.22 | 214.35 (42153) | 221.85 | 201.52 (115855) | 12.60 | 12.53 | 12.76 | 0 |  |
| golden-G4-pan-light-on | nrd-reblur | 26.16 | 67.72 (42153) | 69.20 | 33.11 (115855) | 25.51 | 19.17 | 23.87 | 52 |  |
| golden-G4-pan-light-on | nrd-reblur-tunedD | 17.76 | 61.14 (42153) | 53.14 | 24.42 (115855) | 26.94 | 19.82 | 25.19 | 50 |  |
| golden-G4-pan-light-on | nrd-reblur-tunedS | 18.35 | 61.57 (42153) | 54.88 | 25.23 (115855) | 26.86 | 19.78 | 25.09 | 50 |  |
| golden-G4-pan-light-on | nrd-relax | 12.95 | 54.39 (42153) | 35.40 | 18.59 (115855) | 28.15 | 20.81 | 26.62 | 48 |  |
| golden-G4-pan-light-on | ours-auto | 12.16 | 45.21 (42153) | 35.33 | 21.51 (115855) | 32.14 | 24.00 | 29.29 | 45 |  |
| golden-G4-pan-light-on | ref | 17.33 | 64.73 (42153) | 36.09 | 24.76 (115855) |  |  |  |  |  |


**specular** (boil x1e3; static / edge / disocc: boil of the output, its reference's in the ref row; dynamic: boil of the error; px = pixels per frame)

| capture | denoiser | static boil | dynamic err-boil (px) | edge boil | disocc boil (px) | static PSNR | dynamic PSNR | all PSNR | lag | still σ (8-bit) |
|---|---|---|---|---|---|---|---|---|---|---|
| golden-G4-pan-light-on | noisy | 25.38 | 62.42 (4795) | 24.68 | 21.06 (115855) | 31.68 | 23.56 | 32.00 | 51 |  |
| golden-G4-pan-light-on | nrd-reblur | 2.73 | 24.46 (4795) | 6.10 | 2.88 (115855) | 40.70 | 27.24 | 39.14 | 51 |  |
| golden-G4-pan-light-on | nrd-reblur-tunedD | 2.31 | 24.05 (4795) | 5.81 | 2.63 (115855) | 41.42 | 27.62 | 39.75 | 52 |  |
| golden-G4-pan-light-on | nrd-reblur-tunedS | 2.01 | 23.72 (4795) | 5.29 | 2.36 (115855) | 42.14 | 27.73 | 40.36 | 52 |  |
| golden-G4-pan-light-on | nrd-relax | 1.65 | 23.36 (4795) | 5.05 | 2.12 (115855) | 41.74 | 27.91 | 40.10 | 52 |  |
| golden-G4-pan-light-on | ours-auto | 3.01 | 19.53 (4795) | 7.57 | 3.48 (115855) | 45.80 | 30.68 | 43.75 | 53 |  |
| golden-G4-pan-light-on | ref | 4.02 | 29.23 (4795) | 9.39 | 4.77 (115855) |  |  |  |  |  |


**ao** (boil x1e3; static / edge / disocc: boil of the output, its reference's in the ref row; dynamic: boil of the error; px = pixels per frame)

| capture | denoiser | static boil | dynamic err-boil (px) | edge boil | disocc boil (px) | static PSNR | dynamic PSNR | all PSNR | lag | still σ (8-bit) |
|---|---|---|---|---|---|---|---|---|---|---|
| golden-G4-pan-light-on | ours-occ | 27.33 | 62.19 (58881) | 60.46 | 42.42 (115855) | 30.57 | 21.07 | 26.10 | 48 |  |
| golden-G4-pan-light-on | ref | 31.16 | 93.92 (58881) | 63.27 | 44.58 (115855) |  |  |  |  |  |

