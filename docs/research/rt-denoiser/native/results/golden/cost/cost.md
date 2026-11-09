### Native (harness, `--loops 8`, steady frames 1–7 of each loop = 56 per round)

| capture | denoiser | GPU ms median (range of rounds) | p10 / p90 (all rounds) | reset frame GPU | wall ms (fence) | wall − GPU |
|---|---|---|---|---|---|---|
| G3-orbit-1080t | nrd-reblur | **7.16** (7.15–7.16) | 6.83 / 8.53 | 8.90 | 7.32 (7.32–7.39) | 0.17 |
| G3-orbit-1080t | nrd-reblur-occlusion | **4.46** (4.45–4.46) | 4.19 / 5.68 | 5.96 | 4.61 (4.61–4.68) | 0.16 |
| G3-orbit-1080t | nrd-reblur-tunedD | **7.09** (7.09–7.09) | 6.77 / 8.45 | 8.85 | 7.28 (7.25–7.32) | 0.19 |
| G3-orbit-1080t | nrd-relax | **9.03** (9.03–9.03) | 8.88 / 10.09 | 9.92 | 9.20 (9.20–9.26) | 0.18 |
| G4-pan-light-on-1080t | nrd-reblur | **8.11** (8.10–8.11) | 8.02 / 8.39 | 8.85 | 8.34 (8.31–8.54) | 0.23 |
| G4-pan-light-on-1080t | nrd-reblur-occlusion | **5.37** (5.37–5.37) | 5.32 / 5.66 | 5.94 | 5.68 (5.56–5.80) | 0.30 |
| G4-pan-light-on-1080t | nrd-reblur-tunedD | **8.04** (8.04–8.05) | 7.96 / 8.34 | 8.81 | 8.24 (8.22–8.24) | 0.19 |
| G4-pan-light-on-1080t | nrd-relax | **9.67** (9.67–9.67) | 9.63 / 9.93 | 9.89 | 9.97 (9.96–10.06) | 0.30 |
### Ours, test-bed replay of the same 1080p timing captures (frames 1–7 of each run, 7 per round; median of round medians)

| capture | arm | rounds | GPU ms (sum of passes) | wall ms dispatch→fence (range of rounds) | wall − GPU | first frame (reset) wall |
|---|---|---|---|---|---|---|
| G3-orbit-1080t | ours-auto-w0 | 5 | **7.77** (7.76–29.80) | **13.4** (11.0–35.7) | 5.6 | 128.7 |
| G3-orbit-1080t | ours-auto-w50 | 5 | **7.77** (7.76–14.92) | **11.7** (10.4–20.2) | 3.9 | 112.4 |
| G3-orbit-1080t | ours-occ-w0 | 5 | **3.25** (3.25–3.26) | **7.1** (6.4–7.4) | 3.8 | 66.8 |
| G3-orbit-1080t | ours-occ-w50 | 5 | **3.26** (3.25–3.59) | **6.3** (6.1–7.1) | 3.0 | 71.4 |
| G4-pan-light-on-1080t | ours-auto-w0 | 5 | **9.33** (9.33–10.09) | **13.0** (12.5–14.2) | 3.7 | 106.1 |
| G4-pan-light-on-1080t | ours-auto-w50 | 5 | **9.33** (9.32–9.33) | **13.3** (12.9–13.7) | 4.0 | 108.0 |
| G4-pan-light-on-1080t | ours-occ-w0 | 5 | **3.67** (3.66–3.68) | **7.3** (6.9–9.0) | 3.6 | 65.0 |
| G4-pan-light-on-1080t | ours-occ-w50 | 5 | **3.66** (3.66–3.67) | **6.2** (6.2–7.2) | 2.5 | 69.9 |


### Golden driver `time` (1080p, lean, whole frame: rays + denoisers; n = 120 per round, median of rounds)

| scene | denoiser | wall ms median (range of rounds) | denoiser GPU ms total | per group GPU ms | wall − raw wall | (wall − raw) − GPU |
|---|---|---|---|---|---|---|
| G3 | raw | **124.6** (120.7–138.3) | – | – | – | – |
| G3 | ffx | **126.5** (125.5–142.2) | 5.87 | specular 4.66, shadow 1.21 | 1.9 | -4.0 |
| G3 | ours | **136.1** (135.7–157.5) | 14.72 | diffuse+specular 9.19, ao 4.03, shadow 1.48 | 11.5 | -3.2 |
| G4 | raw | **373.2** (369.2–383.2) | – | – | – | – |
| G4 | ffx | **378.9** (373.7–389.5) | 6.56 | specular 4.74, shadow 1.77 | 5.7 | -0.9 |
| G4 | ours | **374.8** (369.2–404.8) | 17.31 | diffuse+specular 10.29, ao 4.58, shadow 2.37 | 1.6 | -15.7 |

### Track D bench pages (test bed solo, 1080p orbit, diffuse only, n = 200 per page, median of rounds)

| page | rounds | GPU ms (timestamps) | wall ms median (range of rounds) | wall p90 | CPU encode ms | wall − GPU |
|---|---|---|---|---|---|---|
| default (timestamps) | 6/6 | 6.49 | **9.1** (8.6–10.1) | 10.1 | 0.4 | 2.6 |
| default, no timestamps | 6/6 | – | **9.0** (8.9–9.7) | 10.0 | 0.3 | – |
| chroma off | 6/6 | 6.35 | **9.0** (8.6–9.0) | 10.1 | 0.4 | 2.6 |
| antiLag off (alpha 0.1) | 6/6 | 5.85 | **8.1** (8.1–9.5) | 9.2 | 0.3 | 2.2 |
| stabilize (x-auto) | 6/6 | 7.32 | **10.0** (9.7–10.5) | 11.1 | – | 2.7 |
| x-auto default | 6/6 | 6.49 | **9.1** (9.0–9.4) | 10.1 | – | 2.6 |
| empty submit | 6/6 | – | **0.2** (0.2–0.3) | 0.3 | 0.0 | – |
| one tiny dispatch | 6/6 | – | **1.9** (0.8–3.0) | 4.0 | 0.0 | – |

### Clocks while busy (nvidia-smi every 200 ms, utilization > 20 %)

| runs | busy samples | below 1190 MHz | min graphics MHz | max °C | throttle reasons (count) |
|---|---|---|---|---|---|
| bench | 846 | 222 (26 %) | 457 | 89 | idle/none 623, SW power cap 54, SW thermal slowdown 164, power + thermal 5 |
| golden `time` G3 | 644 | 526 (82 %) | 435 | 89 | idle/none 142, SW power cap 90, SW thermal slowdown 412 |
| golden `time` G4 | 1980 | 1642 (83 %) | 307 | 90 | SW power cap 105, idle/none 321, SW thermal slowdown 1554 |
| native G3 | 122 | 0 (0 %) | 1200 | 70 | idle/none 122 |
| native G4 | 136 | 0 (0 %) | 1200 | 69 | idle/none 136 |
| replay G3 | 164 | 2 (1 %) | 1132 | 74 | idle/none 163, 0x00000000000000 1 |
| replay G4 | 83 | 0 (0 %) | 1200 | 75 | idle/none 83 |
