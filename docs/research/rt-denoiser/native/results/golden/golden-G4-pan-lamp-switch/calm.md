# golden-G4-pan-lamp-switch: calm (track D's calm.mjs, motion-compensated boil per region)


**diffuse** (boil x1e3; static / edge / disocc: boil of the output, its reference's in the ref row; dynamic: boil of the error; px = pixels per frame)

| capture | denoiser | static boil | dynamic err-boil (px) | edge boil | disocc boil (px) | static PSNR | dynamic PSNR | all PSNR | lag | still σ (8-bit) |
|---|---|---|---|---|---|---|---|---|---|---|
| golden-G4-pan-lamp-switch | noisy | 203.12 | 202.10 (41018) | 213.64 | 208.98 (115855) | 13.17 | 13.43 | 13.07 | 32 |  |
| golden-G4-pan-lamp-switch | nrd-reblur | 25.28 | 63.13 (41018) | 64.79 | 32.52 (115855) | 26.14 | 19.88 | 24.35 | 50 |  |
| golden-G4-pan-lamp-switch | nrd-reblur-tunedD | 17.49 | 56.94 (41018) | 50.33 | 23.33 (115855) | 27.06 | 20.19 | 25.34 | 51 |  |
| golden-G4-pan-lamp-switch | nrd-reblur-tunedS | 18.05 | 57.39 (41018) | 51.84 | 24.17 (115855) | 26.98 | 20.15 | 25.24 | 51 |  |
| golden-G4-pan-lamp-switch | nrd-relax | 12.75 | 50.16 (41018) | 34.45 | 17.10 (115855) | 28.83 | 21.36 | 26.95 | 49 |  |
| golden-G4-pan-lamp-switch | ours-auto | 12.17 | 45.58 (41018) | 33.70 | 20.45 (115855) | 32.22 | 24.05 | 29.17 | 64 |  |
| golden-G4-pan-lamp-switch | ref | 17.14 | 58.08 (41018) | 35.14 | 24.60 (115855) |  |  |  |  |  |


**specular** (boil x1e3; static / edge / disocc: boil of the output, its reference's in the ref row; dynamic: boil of the error; px = pixels per frame)

| capture | denoiser | static boil | dynamic err-boil (px) | edge boil | disocc boil (px) | static PSNR | dynamic PSNR | all PSNR | lag | still σ (8-bit) |
|---|---|---|---|---|---|---|---|---|---|---|
| golden-G4-pan-lamp-switch | noisy | 26.71 | 64.84 (5171) | 25.37 | 25.20 (115855) | 31.27 | 24.06 | 31.40 | 64 |  |
| golden-G4-pan-lamp-switch | nrd-reblur | 2.43 | 25.93 (5171) | 5.67 | 3.34 (115855) | 40.58 | 27.09 | 38.65 | 64 |  |
| golden-G4-pan-lamp-switch | nrd-reblur-tunedD | 2.03 | 25.61 (5171) | 5.54 | 3.06 (115855) | 41.34 | 27.40 | 39.30 | 64 |  |
| golden-G4-pan-lamp-switch | nrd-reblur-tunedS | 1.83 | 25.24 (5171) | 5.24 | 2.78 (115855) | 41.98 | 27.49 | 39.90 | 64 |  |
| golden-G4-pan-lamp-switch | nrd-relax | 1.63 | 24.48 (5171) | 5.19 | 2.49 (115855) | 42.04 | 28.32 | 39.91 | 64 |  |
| golden-G4-pan-lamp-switch | ours-auto | 3.06 | 20.67 (5171) | 8.01 | 4.09 (115855) | 45.67 | 30.64 | 43.26 | 64 |  |
| golden-G4-pan-lamp-switch | ref | 4.07 | 30.72 (5171) | 10.05 | 5.71 (115855) |  |  |  |  |  |


**ao** (boil x1e3; static / edge / disocc: boil of the output, its reference's in the ref row; dynamic: boil of the error; px = pixels per frame)

| capture | denoiser | static boil | dynamic err-boil (px) | edge boil | disocc boil (px) | static PSNR | dynamic PSNR | all PSNR | lag | still σ (8-bit) |
|---|---|---|---|---|---|---|---|---|---|---|
| golden-G4-pan-lamp-switch | ours-occ | 27.33 | 62.19 (58881) | 60.46 | 42.42 (115855) | 30.57 | 21.07 | 26.10 | 48 |  |
| golden-G4-pan-lamp-switch | ref | 31.16 | 93.92 (58881) | 63.27 | 44.58 (115855) |  |  |  |  |  |

