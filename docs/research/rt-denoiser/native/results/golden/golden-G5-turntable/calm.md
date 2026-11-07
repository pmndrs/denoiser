# golden-G5-turntable: calm (track D's calm.mjs, motion-compensated boil per region)


**diffuse** (boil x1e3; static / edge / disocc: boil of the output, its reference's in the ref row; dynamic: boil of the error; px = pixels per frame)

| capture | denoiser | static boil | dynamic err-boil (px) | edge boil | disocc boil (px) | static PSNR | dynamic PSNR | all PSNR | lag | still σ (8-bit) |
|---|---|---|---|---|---|---|---|---|---|---|
| golden-G5-turntable | noisy | 94.67 | 142.42 (1244) | 110.37 | 96.99 (49361) | 21.26 | 16.60 | 21.13 | 0 | 21.86 |
| golden-G5-turntable | nrd-reblur | 0.51 | 61.60 (1244) | 5.47 | 6.01 (49361) | 37.40 | 19.16 | 35.94 | 2 | 1.54 |
| golden-G5-turntable | nrd-reblur-tunedD | 0.51 | 61.61 (1244) | 5.35 | 4.68 (49361) | 37.58 | 19.47 | 36.32 | 0 | 1.59 |
| golden-G5-turntable | nrd-reblur-tunedS | 0.51 | 61.63 (1244) | 5.47 | 5.16 (49361) | 37.59 | 19.44 | 36.27 | 0 | 1.58 |
| golden-G5-turntable | nrd-relax | 0.75 | 60.56 (1244) | 5.53 | 2.98 (49361) | 38.62 | 19.62 | 36.95 | 32 | 1.36 |
| golden-G5-turntable | ours-auto | 2.81 | 56.05 (1244) | 13.87 | 5.83 (49361) | 39.41 | 20.27 | 38.00 | 38 | 1.54 |
| golden-G5-turntable | ref | 5.94 | 63.29 (1244) | 16.49 | 7.88 (49361) |  |  |  |  | 1.94 |


**specular** (boil x1e3; static / edge / disocc: boil of the output, its reference's in the ref row; dynamic: boil of the error; px = pixels per frame)

| capture | denoiser | static boil | dynamic err-boil (px) | edge boil | disocc boil (px) | static PSNR | dynamic PSNR | all PSNR | lag | still σ (8-bit) |
|---|---|---|---|---|---|---|---|---|---|---|
| golden-G5-turntable | noisy | 18.49 | 56.47 (953) | 23.60 | 19.76 (49361) | 35.75 | 24.66 | 35.59 | 36 | 4.32 |
| golden-G5-turntable | nrd-reblur | 0.43 | 44.96 (953) | 2.16 | 1.95 (49361) | 43.70 | 23.02 | 42.23 | 51 | 0.95 |
| golden-G5-turntable | nrd-reblur-tunedD | 0.42 | 44.98 (953) | 2.13 | 1.90 (49361) | 43.59 | 22.91 | 42.16 | 51 | 0.95 |
| golden-G5-turntable | nrd-reblur-tunedS | 0.41 | 45.03 (953) | 2.10 | 1.82 (49361) | 43.58 | 22.80 | 42.14 | 52 | 0.94 |
| golden-G5-turntable | nrd-relax | 0.42 | 39.23 (953) | 2.59 | 1.70 (49361) | 46.04 | 24.85 | 43.83 | 50 | 0.95 |
| golden-G5-turntable | ours-auto | 1.04 | 25.21 (953) | 7.08 | 2.61 (49361) | 51.99 | 29.24 | 49.38 | 47 | 1.03 |
| golden-G5-turntable | ref | 1.16 | 48.29 (953) | 8.85 | 2.88 (49361) |  |  |  |  | 1.10 |


**ao** (boil x1e3; static / edge / disocc: boil of the output, its reference's in the ref row; dynamic: boil of the error; px = pixels per frame)

| capture | denoiser | static boil | dynamic err-boil (px) | edge boil | disocc boil (px) | static PSNR | dynamic PSNR | all PSNR | lag | still σ (8-bit) |
|---|---|---|---|---|---|---|---|---|---|---|
| golden-G5-turntable | ours-occ | 4.98 | 48.11 (11814) | 41.30 | 17.36 (49361) | 37.86 | 22.21 | 33.33 | 7 | 6.00 |
| golden-G5-turntable | ref | 8.64 | 56.77 (11814) | 41.28 | 15.54 (49361) |  |  |  |  | 6.29 |

