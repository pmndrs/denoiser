# Denoiser eval: every RT model, every runtime, vs native OIDN

> **2026-10-08, WebNN runtimes + WGSL fp16 in one session** (`examples/eval`,
> `node run.mjs webnn:fp32 webnn:fp16 webnn-npu:fp16 wgsl:fp16`). **Caveat:** the
> GPU was 75–97 % busy with another process throughout (IOAccelerator "Device
> Utilization" while this harness was idle), so every GPU timing here is inflated
> ~3–4× vs the quiet [2026-10-07 eval](eval-2026-10-07.md) (WGSL fp16
> eiffel/rt_ldr_calb_cnrm 1080p: 312 here vs 76 ms there). Compare columns within
> this file only. `webnn-npu` = Chrome with `WebNNCoreMLExplicitGPUOrNPU` (Apple
> Neural Engine): its network isn't GPU-bound, but the engine's pre/post and the
> interop copies still are. Quality columns are unaffected. Discussion:
> [runtimes.md → WebNN](../specs/runtimes.md#webnn-runtime-packagesdenoiser-webnn-exampleswebnn-bench).

Generated 2026-10-08T05:57:32.139Z by examples/eval/run.mjs. Native: OIDN 2.5.1 (  Name: Apple M5 Pro).
Inputs are rounded to fp16 for every setup. Quality = PSNR (dB) / max 8-bit Δ against native OIDN **CPU** output (the reference implementation, same weights); HDR compared after x/(1+x) + gamma 2.2. Timings = warm median, `denoiseTextures` → texture, awaited (web) / `oidnDenoise` filter time (native, excludes host IO).

## Speed @ 1920×1080 (ms, warm median)

| case | native Metal | native CPU | webnn fp32 | webnn fp16 | webnn-npu fp16 | wgsl fp16 |
|---|---|---|---|---|---|---|
| spheres/rt_ldr_small | 13.7 | 187 | 200.6 | 156.2 | 86.2 | 164.3 |
| spheres/rt_ldr | 24.4 | 310 | 332.5 | 201.7 | 119.7 | 291.3 |
| spheres/rt_ldr_alb_small | 13.9 | 183 | 250.9 | 164.8 | 100.6 | 74.2 |
| spheres/rt_ldr_alb | 24.5 | 320 | 344.5 | 192.3 | 119.0 | 366.0 |
| spheres/rt_ldr_alb_nrm_small | 14.6 | 188 | 234.4 | 171.7 | 106.6 | 202.5 |
| spheres/rt_ldr_alb_nrm | 25.2 | 333 | 404.3 | 206.4 | 137.2 | 377.8 |
| spheres/rt_ldr_calb_cnrm_small | 14.7 | 187 | 265.5 | 170.6 | 103.7 | 206.1 |
| spheres/rt_ldr_calb_cnrm | 25.2 | 339 | 371.0 | 204.6 | 134.1 | 374.8 |
| eiffel/rt_ldr_small | 13.9 | 181 | 218.1 | 153.3 | 84.7 | 172.9 |
| eiffel/rt_ldr | 24.8 | 317 | 322.2 | 175.1 | 107.3 | 258.4 |
| eiffel/rt_ldr_alb_small | 13.8 | 193 | 245.8 | 156.9 | 104.5 | 193.4 |
| eiffel/rt_ldr_alb | 24.7 | 327 | 359.0 | 190.1 | 132.3 | 337.4 |
| eiffel/rt_ldr_alb_nrm_small | 14.6 | 193 | 276.5 | 170.2 | 105.2 | 194.9 |
| eiffel/rt_ldr_alb_nrm | 25.0 | 339 | 404.4 | 210.4 | 235.5 | 372.6 |
| eiffel/rt_ldr_calb_cnrm_small | 14.6 | 189 | 271.2 | 179.0 | 97.0 | 196.9 |
| eiffel/rt_ldr_calb_cnrm | 24.8 | 323 | 397.5 | 203.9 | 237.4 | 312.5 |
| hdrdump/rt_hdr_small | 13.8 | 178 | 223.4 | 149.1 | 171.7 | 159.2 |
| hdrdump/rt_hdr | 24.7 | 329 | 331.0 | 176.8 | 175.9 | 345.4 |
| hdrdump/rt_hdr_alb_small | 14.2 | 186 | 240.5 | 148.6 | 95.5 | 187.7 |
| hdrdump/rt_hdr_alb | 24.6 | 328 | 379.7 | 187.2 | 212.1 | 347.4 |
| hdrdump/rt_hdr_alb_nrm_small | 14.9 | 209 | 288.9 | 175.8 | 109.2 | 203.3 |
| hdrdump/rt_hdr_alb_nrm | 25.1 | 369 | 406.8 | 206.3 | 255.2 | 376.7 |
| hdrdump/rt_hdr_calb_cnrm_small | 14.7 | 188 | 277.8 | 181.2 | 217.3 | 204.9 |
| hdrdump/rt_hdr_calb_cnrm | 25.0 | 339 | 414.0 | 208.2 | 136.3 | 372.4 |
| hdrdump/rt_hdr_calb_cnrm_large | 54.2 | 739 | 754.9 | 317.4 | 225.2 | 890.2 |

## Speed @ 512² (ms, warm median)

| case | native Metal | native CPU | webnn fp32 | webnn fp16 | webnn-npu fp16 | wgsl fp16 |
|---|---|---|---|---|---|---|
| spheres/rt_ldr_small | 2.8 | 28 | 39.8 | 40.9 | 19.5 | 27.1 |
| spheres/rt_ldr | 4.1 | 66 | 55.4 | 46.2 | 25.7 | 53.1 |
| spheres/rt_ldr_alb_small | 2.7 | 28 | 40.8 | 43.0 | 32.5 | 29.2 |
| spheres/rt_ldr_alb | 4.0 | 65 | 52.1 | 47.6 | 30.5 | 41.4 |
| spheres/rt_ldr_alb_nrm_small | 2.8 | 31 | 46.6 | 44.3 | 31.1 | 27.4 |
| spheres/rt_ldr_alb_nrm | 4.0 | 64 | 62.5 | 47.8 | 33.6 | 57.6 |
| spheres/rt_ldr_calb_cnrm_small | 2.8 | 32 | 48.8 | 41.0 | 33.3 | 32.3 |
| spheres/rt_ldr_calb_cnrm | 3.7 | 67 | 63.2 | 52.3 | 33.8 | 54.2 |
| eiffel/rt_ldr_small | 2.8 | 31 | 41.4 | 39.3 | 19.0 | 25.6 |
| eiffel/rt_ldr | 4.2 | 64 | 59.1 | 39.4 | 29.5 | 38.3 |
| eiffel/rt_ldr_alb_small | 2.5 | 29 | 42.4 | 38.7 | 32.0 | 25.4 |
| eiffel/rt_ldr_alb | 3.9 | 65 | 64.3 | 51.1 | 33.3 | 52.6 |
| eiffel/rt_ldr_alb_nrm_small | 2.6 | 32 | 41.6 | 39.3 | 34.6 | 29.0 |
| eiffel/rt_ldr_alb_nrm | 4.0 | 71 | 61.5 | 49.3 | 34.1 | 51.8 |
| eiffel/rt_ldr_calb_cnrm_small | 2.7 | 29 | 47.2 | 47.0 | 66.9 | 28.6 |
| eiffel/rt_ldr_calb_cnrm | 4.1 | 65 | 59.6 | 48.7 | 34.7 | 50.0 |
| hdrdump/rt_hdr_small | 2.7 | 29 | 40.5 | 39.3 | 54.4 | 28.4 |
| hdrdump/rt_hdr | 4.1 | 69 | 56.0 | 43.8 | 51.0 | 53.0 |
| hdrdump/rt_hdr_alb_small | 2.9 | 30 | 43.5 | 38.8 | 32.2 | 31.5 |
| hdrdump/rt_hdr_alb | 4.1 | 66 | 61.5 | 47.1 | 34.9 | 51.1 |
| hdrdump/rt_hdr_alb_nrm_small | 2.8 | 30 | 44.2 | 42.9 | 69.5 | 33.5 |
| hdrdump/rt_hdr_alb_nrm | 3.9 | 66 | 61.3 | 57.7 | 35.2 | 52.4 |
| hdrdump/rt_hdr_calb_cnrm_small | 2.8 | 30 | 47.8 | 39.1 | 70.2 | 27.9 |
| hdrdump/rt_hdr_calb_cnrm | 4.0 | 66 | 64.1 | 50.3 | 73.1 | 52.6 |
| hdrdump/rt_hdr_calb_cnrm_large | 7.8 | 156 | 107.3 | 70.3 | 52.4 | 109.0 |

## Quality vs native CPU (PSNR dB / max 8-bit Δ)

| case | native Metal | webnn fp32 | webnn fp16 | webnn-npu fp16 | wgsl fp16 |
|---|---|---|---|---|---|
| spheres/rt_ldr_small | max abs 7.7e-4 | 73.1 / 1 | 77.8 / 1 | 63.0 / 1 | 66.6 / 1 |
| spheres/rt_ldr | max abs 6.3e-4 | 73.4 / 1 | 77.6 / 1 | 63.5 / 1 | 68.1 / 1 |
| spheres/rt_ldr_alb_small | max abs 9.0e-4 | 73.1 / 1 | 77.0 / 1 | 66.6 / 1 | 65.2 / 1 |
| spheres/rt_ldr_alb | max abs 7.9e-4 | 73.1 / 1 | 77.4 / 1 | 64.1 / 1 | 66.7 / 1 |
| spheres/rt_ldr_alb_nrm_small | max abs 8.3e-4 | 73.2 / 1 | 77.2 / 1 | 63.8 / 1 | 66.4 / 1 |
| spheres/rt_ldr_alb_nrm | max abs 8.0e-4 | 73.0 / 1 | 77.1 / 1 | 65.9 / 1 | 66.4 / 1 |
| spheres/rt_ldr_calb_cnrm_small | max abs 8.5e-4 | 73.0 / 1 | 77.0 / 1 | 64.2 / 1 | 64.1 / 1 |
| spheres/rt_ldr_calb_cnrm | max abs 8.6e-4 | 73.2 / 1 | 76.8 / 1 | 64.8 / 1 | 65.5 / 1 |
| eiffel/rt_ldr_small | max abs 6.8e-4 | 72.3 / 1 | 76.9 / 1 | 61.9 / 1 | 64.4 / 1 |
| eiffel/rt_ldr | max abs 8.6e-4 | 72.2 / 1 | 75.7 / 1 | 61.9 / 1 | 65.2 / 1 |
| eiffel/rt_ldr_alb_small | max abs 1.3e-3 | 72.2 / 1 | 74.8 / 1 | 63.7 / 1 | 62.7 / 1 |
| eiffel/rt_ldr_alb | max abs 9.3e-4 | 72.1 / 1 | 75.3 / 1 | 62.4 / 1 | 63.3 / 1 |
| eiffel/rt_ldr_alb_nrm_small | max abs 1.0e-3 | 72.1 / 1 | 74.9 / 1 | 61.8 / 1 | 63.3 / 1 |
| eiffel/rt_ldr_alb_nrm | max abs 7.7e-4 | 72.2 / 1 | 75.9 / 1 | 64.1 / 1 | 65.0 / 1 |
| eiffel/rt_ldr_calb_cnrm_small | max abs 1.4e-3 | 72.3 / 1 | 74.7 / 1 | 62.3 / 1 | 62.3 / 2 |
| eiffel/rt_ldr_calb_cnrm | max abs 9.4e-4 | 70.1 / 5 | 71.6 / 5 | 62.6 / 5 | 63.1 / 5 |
| hdrdump/rt_hdr_small | max abs 4.3e-3 | 83.9 / 1 | 74.8 / 1 | 64.8 / 2 | 65.0 / 3 |
| hdrdump/rt_hdr | max abs 2.8e-3 | 83.8 / 1 | 74.9 / 1 | 64.5 / 1 | 66.5 / 1 |
| hdrdump/rt_hdr_alb_small | max abs 2.8e-3 | 83.7 / 1 | 74.6 / 1 | 65.2 / 1 | 64.7 / 1 |
| hdrdump/rt_hdr_alb | max abs 2.6e-3 | 83.7 / 1 | 74.7 / 1 | 64.6 / 1 | 63.8 / 1 |
| hdrdump/rt_hdr_alb_nrm_small | max abs 2.8e-3 | 83.4 / 1 | 74.0 / 1 | 65.9 / 1 | 64.6 / 1 |
| hdrdump/rt_hdr_alb_nrm | max abs 2.9e-3 | 83.8 / 1 | 74.5 / 1 | 63.7 / 1 | 65.3 / 1 |
| hdrdump/rt_hdr_calb_cnrm_small | max abs 3.6e-3 | 83.5 / 1 | 74.4 / 1 | 65.4 / 1 | 63.8 / 1 |
| hdrdump/rt_hdr_calb_cnrm | max abs 2.6e-3 | 83.7 / 1 | 74.6 / 1 | 65.8 / 1 | 65.3 / 1 |
| hdrdump/rt_hdr_calb_cnrm_large | max abs 2.9e-3 | 83.7 / 1 | 74.6 / 1 | 65.0 / 1 | 66.1 / 1 |

## Quality vs converged reference (LDR scenes, PSNR dB)

| case | native CPU | webnn fp32 | webnn fp16 | webnn-npu fp16 | wgsl fp16 |
|---|---|---|---|---|---|
| spheres/rt_ldr_small | 39.19 | 39.22 | 39.19 | 38.99 | 39.18 |
| spheres/rt_ldr | 39.34 | 39.37 | 39.34 | 39.14 | 39.32 |
| spheres/rt_ldr_alb_small | 39.13 | 39.16 | 39.13 | 38.98 | 39.13 |
| spheres/rt_ldr_alb | 39.55 | 39.59 | 39.55 | 39.36 | 39.56 |
| spheres/rt_ldr_alb_nrm_small | 39.22 | 39.26 | 39.22 | 39.03 | 39.23 |
| spheres/rt_ldr_alb_nrm | 39.58 | 39.62 | 39.58 | 39.43 | 39.53 |
| spheres/rt_ldr_calb_cnrm_small | 39.15 | 39.18 | 39.14 | 38.97 | 39.13 |
| spheres/rt_ldr_calb_cnrm | 39.27 | 39.30 | 39.27 | 39.09 | 39.20 |
| eiffel/rt_ldr_small | 26.84 | 26.84 | 26.84 | 26.84 | 26.84 |
| eiffel/rt_ldr | 26.97 | 26.98 | 26.97 | 26.97 | 26.98 |
| eiffel/rt_ldr_alb_small | 27.06 | 27.06 | 27.06 | 27.05 | 27.05 |
| eiffel/rt_ldr_alb | 27.10 | 27.10 | 27.10 | 27.09 | 27.10 |
| eiffel/rt_ldr_alb_nrm_small | 27.03 | 27.03 | 27.03 | 27.02 | 27.03 |
| eiffel/rt_ldr_alb_nrm | 27.13 | 27.13 | 27.13 | 27.12 | 27.13 |
| eiffel/rt_ldr_calb_cnrm_small | 26.98 | 26.98 | 26.98 | 26.97 | 26.98 |
| eiffel/rt_ldr_calb_cnrm | 27.03 | 27.03 | 27.03 | 27.02 | 27.02 |

## Cold start (ms): engine load / first call @ 512² (includes compile)

| case | webnn fp32 | webnn fp16 | webnn-npu fp16 | wgsl fp16 |
|---|---|---|---|---|
| spheres/rt_ldr_small | 556 / 67 | 762 / 31 | 1895 / 28 | 245 / 22 |
| spheres/rt_ldr | 663 / 62 | 656 / 45 | 1306 / 27 | 96 / 45 |
| spheres/rt_ldr_alb_small | 578 / 48 | 566 / 48 | 1336 / 24 | 426 / 29 |
| spheres/rt_ldr_alb | 724 / 69 | 545 / 53 | 1667 / 36 | 266 / 28 |
| spheres/rt_ldr_alb_nrm_small | 500 / 45 | 523 / 44 | 2409 / 27 | 218 / 28 |
| spheres/rt_ldr_alb_nrm | 516 / 65 | 553 / 52 | 1434 / 34 | 95 / 48 |
| spheres/rt_ldr_calb_cnrm_small | 574 / 52 | 554 / 46 | 1277 / 28 | 34 / 32 |
| spheres/rt_ldr_calb_cnrm | 637 / 62 | 598 / 58 | 1392 / 34 | 78 / 58 |
| eiffel/rt_ldr_small | 417 / 42 | 548 / 32 | 1314 / 17 | 61 / 26 |
| eiffel/rt_ldr | 545 / 54 | 662 / 52 | 1591 / 29 | 70 / 43 |
| eiffel/rt_ldr_alb_small | 482 / 47 | 558 / 44 | 2730 / 32 | 56 / 22 |
| eiffel/rt_ldr_alb | 516 / 48 | 620 / 40 | 1434 / 21 | 66 / 60 |
| eiffel/rt_ldr_alb_nrm_small | 543 / 51 | 575 / 44 | 1296 / 26 | 32 / 43 |
| eiffel/rt_ldr_alb_nrm | 500 / 71 | 558 / 40 | 1655 / 34 | 148 / 50 |
| eiffel/rt_ldr_calb_cnrm_small | 432 / 46 | 646 / 43 | 1511 / 93 | 28 / 29 |
| eiffel/rt_ldr_calb_cnrm | 497 / 81 | 565 / 49 | 1294 / 26 | 79 / 44 |
| hdrdump/rt_hdr_small | 447 / 46 | 528 / 38 | 1211 / 51 | 36 / 29 |
| hdrdump/rt_hdr | 574 / 58 | 528 / 47 | 1437 / 61 | 165 / 50 |
| hdrdump/rt_hdr_alb_small | 450 / 47 | 544 / 39 | 2009 / 23 | 31 / 32 |
| hdrdump/rt_hdr_alb | 942 / 57 | 563 / 41 | 1633 / 25 | 57 / 48 |
| hdrdump/rt_hdr_alb_nrm_small | 416 / 48 | 537 / 41 | 1203 / 71 | 79 / 34 |
| hdrdump/rt_hdr_alb_nrm | 491 / 66 | 573 / 54 | 1316 / 32 | 112 / 49 |
| hdrdump/rt_hdr_calb_cnrm_small | 402 / 48 | 584 / 35 | 1256 / 43 | 53 / 31 |
| hdrdump/rt_hdr_calb_cnrm | 553 / 72 | 578 / 67 | 1621 / 80 | 115 / 46 |
| hdrdump/rt_hdr_calb_cnrm_large | 718 / 97 | 905 / 68 | 1802 / 38 | 363 / 113 |
