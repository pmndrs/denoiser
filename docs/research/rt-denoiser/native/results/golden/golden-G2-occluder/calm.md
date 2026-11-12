# golden-G2-occluder: calm (track D's calm.mjs, motion-compensated boil per region)


**diffuse** (boil x1e3; static / edge / disocc: boil of the output, its reference's in the ref row; dynamic: boil of the error; px = pixels per frame)

| capture | denoiser | static boil | dynamic err-boil (px) | edge boil | disocc boil (px) | static PSNR | dynamic PSNR | all PSNR | lag | still σ (8-bit) |
|---|---|---|---|---|---|---|---|---|---|---|
| golden-G2-occluder | noisy | 201.96 | 260.46 (10) | 224.23 | 202.73 (50254) | 15.15 | 12.23 | 15.12 | 0 | 42.13 |
| golden-G2-occluder | nrd-reblur | 0.28 | 43.37 (10) | 1.75 | 9.95 (50254) | 32.06 | 21.62 | 31.81 | 5 | 0.44 |
| golden-G2-occluder | nrd-reblur-tunedD | 0.22 | 42.81 (10) | 1.52 | 3.75 (50254) | 37.50 | 21.75 | 36.88 | 8 | 0.50 |
| golden-G2-occluder | nrd-reblur-tunedS | 0.22 | 42.90 (10) | 1.54 | 4.32 (50254) | 37.12 | 21.74 | 36.50 | 8 | 0.50 |
| golden-G2-occluder | nrd-relax | 0.68 | 41.55 (10) | 1.96 | 1.31 (50254) | 35.42 | 23.46 | 35.28 | 5 | 0.35 |
| golden-G2-occluder | ours-auto | 0.64 | 40.18 (10) | 3.38 | 1.99 (50254) | 39.54 | 25.46 | 39.25 | 6 | 0.40 |
| golden-G2-occluder | ref | 0.21 | 43.44 (10) | 1.49 | 0.49 (50254) |  |  |  |  | 0.26 |


**specular** (boil x1e3; static / edge / disocc: boil of the output, its reference's in the ref row; dynamic: boil of the error; px = pixels per frame)

| capture | denoiser | static boil | dynamic err-boil (px) | edge boil | disocc boil (px) | static PSNR | dynamic PSNR | all PSNR | lag | still σ (8-bit) |
|---|---|---|---|---|---|---|---|---|---|---|
| golden-G2-occluder | noisy | 19.80 | 136.02 (332) | 46.11 | 21.98 (50254) | 33.73 | 16.90 | 32.99 | 0 | 2.45 |
| golden-G2-occluder | nrd-reblur | 0.11 | 17.64 (332) | 1.34 | 3.08 (50254) | 43.73 | 19.43 | 39.94 | 2 | 0.31 |
| golden-G2-occluder | nrd-reblur-tunedD | 0.10 | 17.64 (332) | 1.33 | 2.78 (50254) | 44.36 | 19.45 | 40.29 | 2 | 0.30 |
| golden-G2-occluder | nrd-reblur-tunedS | 0.09 | 17.64 (332) | 1.31 | 1.88 (50254) | 44.35 | 19.67 | 40.33 | 0 | 0.26 |
| golden-G2-occluder | nrd-relax | 0.30 | 19.21 (332) | 2.46 | 2.24 (50254) | 46.07 | 21.39 | 41.95 | 3 | 0.30 |
| golden-G2-occluder | ours-auto | 0.68 | 18.21 (332) | 6.41 | 2.11 (50254) | 49.56 | 25.24 | 45.61 | 44 | 0.31 |
| golden-G2-occluder | ref | 0.38 | 20.33 (332) | 7.28 | 1.33 (50254) |  |  |  |  | 0.32 |


**ao** (boil x1e3; static / edge / disocc: boil of the output, its reference's in the ref row; dynamic: boil of the error; px = pixels per frame)

| capture | denoiser | static boil | dynamic err-boil (px) | edge boil | disocc boil (px) | static PSNR | dynamic PSNR | all PSNR | lag | still σ (8-bit) |
|---|---|---|---|---|---|---|---|---|---|---|
| golden-G2-occluder | ours-occ | 1.39 | 17.04 (33) | 4.90 | 4.50 (50254) | 37.96 | 28.33 | 37.52 | 6 | 0.81 |
| golden-G2-occluder | ref | 0.18 | 16.94 (33) | 2.68 | 0.63 (50254) |  |  |  |  | 0.36 |


**visibility** (boil x1e3; static / edge / disocc: boil of the output, its reference's in the ref row; dynamic: boil of the error; px = pixels per frame)

| capture | denoiser | static boil | dynamic err-boil (px) | edge boil | disocc boil (px) | static PSNR | dynamic PSNR | all PSNR | lag | still σ (8-bit) |
|---|---|---|---|---|---|---|---|---|---|---|
| golden-G2-occluder | noisy | 148.59 | 440.75 (626) | 140.98 | 148.63 (50254) | 16.87 | 7.60 | 16.85 | 0 | 13.21 |
| golden-G2-occluder | nrd-sigma | 75.78 | 350.68 (626) | 61.55 | 76.66 (50254) | 21.54 | 8.95 | 21.49 | 0 | 4.77 |
| golden-G2-occluder | ours-shadows | 1.94 | 11.00 (626) | 6.55 | 5.67 (50254) | 36.99 | 24.68 | 36.47 | 6 | 1.02 |
| golden-G2-occluder | ffx-shadows | 1.46 | 12.91 (626) | 10.07 | 8.46 (50254) | 28.92 | 17.92 | 28.53 | 26 | 1.15 |
| golden-G2-occluder | ref | 0.43 | 8.55 (626) | 5.98 | 1.30 (50254) |  |  |  |  | 0.99 |

