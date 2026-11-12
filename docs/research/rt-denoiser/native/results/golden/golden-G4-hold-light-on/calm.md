# golden-G4-hold-light-on: calm (track D's calm.mjs, motion-compensated boil per region)


**diffuse** (boil x1e3; static / edge / disocc: boil of the output, its reference's in the ref row; dynamic: boil of the error; px = pixels per frame)

| capture | denoiser | static boil | dynamic err-boil (px) | edge boil | disocc boil (px) | static PSNR | dynamic PSNR | all PSNR | lag | still σ (8-bit) |
|---|---|---|---|---|---|---|---|---|---|---|
| golden-G4-hold-light-on | noisy | 221.65 | 213.73 (27838) | 247.92 | 205.38 (102832) | 13.16 | 12.93 | 13.16 | 0 | 53.84 |
| golden-G4-hold-light-on | nrd-reblur | 1.88 | 72.50 (27838) | 3.15 | 18.98 (102832) | 21.18 | 15.28 | 20.90 | 22 | 8.46 |
| golden-G4-hold-light-on | nrd-reblur-tunedD | 1.68 | 71.78 (27838) | 2.95 | 14.66 (102832) | 21.82 | 15.61 | 21.46 | 22 | 8.79 |
| golden-G4-hold-light-on | nrd-reblur-tunedS | 1.68 | 71.70 (27838) | 2.99 | 14.97 (102832) | 21.80 | 15.61 | 21.44 | 22 | 8.79 |
| golden-G4-hold-light-on | nrd-relax | 3.57 | 68.42 (27838) | 6.62 | 7.67 (102832) | 23.59 | 16.18 | 23.02 | 21 | 10.97 |
| golden-G4-hold-light-on | ours-auto | 5.01 | 26.73 (27838) | 19.79 | 9.60 (102832) | 32.21 | 26.68 | 30.56 | 19 | 17.36 |
| golden-G4-hold-light-on | ref | 0.38 | 72.25 (27838) | 21.48 | 0.00 (102832) |  |  |  |  | 17.73 |


**specular** (boil x1e3; static / edge / disocc: boil of the output, its reference's in the ref row; dynamic: boil of the error; px = pixels per frame)

| capture | denoiser | static boil | dynamic err-boil (px) | edge boil | disocc boil (px) | static PSNR | dynamic PSNR | all PSNR | lag | still σ (8-bit) |
|---|---|---|---|---|---|---|---|---|---|---|
| golden-G4-hold-light-on | noisy | 31.93 | 43.95 (3674) | 28.22 | 27.73 (102832) | 29.70 | 24.90 | 30.10 | 0 | 5.21 |
| golden-G4-hold-light-on | nrd-reblur | 0.15 | 20.99 (3674) | 0.36 | 1.67 (102832) | 37.03 | 25.34 | 36.57 | 21 | 0.41 |
| golden-G4-hold-light-on | nrd-reblur-tunedD | 0.13 | 20.99 (3674) | 0.34 | 1.38 (102832) | 37.08 | 25.31 | 36.80 | 21 | 0.38 |
| golden-G4-hold-light-on | nrd-reblur-tunedS | 0.13 | 21.02 (3674) | 0.31 | 1.12 (102832) | 37.97 | 25.48 | 37.51 | 21 | 0.41 |
| golden-G4-hold-light-on | nrd-relax | 0.36 | 19.95 (3674) | 0.62 | 1.05 (102832) | 38.16 | 25.78 | 37.76 | 21 | 0.49 |
| golden-G4-hold-light-on | ours-auto | 0.62 | 9.48 (3674) | 1.99 | 0.89 (102832) | 46.26 | 34.52 | 44.91 | 19 | 1.10 |
| golden-G4-hold-light-on | ref | 0.71 | 21.03 (3674) | 2.60 | 0.06 (102832) |  |  |  |  | 1.13 |


**ao** (boil x1e3; static / edge / disocc: boil of the output, its reference's in the ref row; dynamic: boil of the error; px = pixels per frame)

| capture | denoiser | static boil | dynamic err-boil (px) | edge boil | disocc boil (px) | static PSNR | dynamic PSNR | all PSNR | lag | still σ (8-bit) |
|---|---|---|---|---|---|---|---|---|---|---|
| golden-G4-hold-light-on | ours-occ | 4.88 | – (0) | 7.94 | 15.02 (102832) | 32.92 | – | 30.87 | 12 | 1.43 |
| golden-G4-hold-light-on | ref | 0.00 | – (0) | 0.00 | 0.00 (102832) |  |  |  |  | 0.00 |

