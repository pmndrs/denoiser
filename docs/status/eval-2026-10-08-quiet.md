# Eval 2026-10-08 (quiet GPU): all runtimes incl. WebNN vs native OIDN

Same harness and 25 cases as [eval-2026-10-07](eval-2026-10-07.md), rerun on an
idle GPU (Apple M5 Pro, Chrome 154) with WebNN added (`--enable-features=
WebMachineLearningNeuralNetwork,WebNNCoreMLExplicitGPUOrNPU`). Supersedes the
contended WebNN numbers in eval-2026-10-08-webnn.md.

## Findings

**Speed, mean ms over models (× slower than native Metal):**

| 1080p | small | base | large |
|---|---|---|---|
| native Metal | 14.3 | 24.8 | 54.2 |
| ORT fp16 | 101 (7.1×) | 210 (8.5×) | runs base |
| kernels fp16 | 79 (5.5×) | 163 (6.5×) | 440 (8.1×) |
| WGSL fp16 | 33.6 (2.4×) | 67.0 (2.7×) | 167 (3.1×) |
| WGSL fp32 (subgroup-matrix) | 39.5 (2.8×) | 76.3 (3.1×) | 186 (3.4×) |
| **WebNN fp16 (gpu)** | **31.5 (2.2×)** | **40.1 (1.6×)** | **65.4 (1.2×)** |
| WebNN fp16 (npu / Neural Engine) | 33.1 (2.3×) | 43.6 (1.8×) | 78.9 (1.5×) |
| WebNN fp32 (gpu) | 49.6 (3.5×) | 74.7 (3.0×) | 159 (2.9×) |

| 512² | small | base | large |
|---|---|---|---|
| native Metal | 2.7 | 4.0 | 7.8 |
| WGSL fp16 | **4.6** | 8.7 | 21.0 |
| WebNN fp16 (gpu) | 6.4 | **7.3** | **10.8** |

- **WebNN fp16 is the fastest web runtime for base/large** — 1.7× WGSL fp16 on
  base and 2.5× on large at 1080p, 1.2–1.6× from native Metal. On small models
  and at 512² WGSL fp16 is as fast or faster.
- WebNN's Neural Engine path is close to its GPU path and leaves the GPU free.
- Quality: WebNN fp32/fp16 match native like kernels/WGSL (70–84 dB, ≤1 LSB;
  npu ≤2 LSB); ORT still wrong on `*_alb` / `*_alb_nrm` (32 dB). The
  eiffel/rt_ldr_calb_cnrm 5-LSB case is identical on every runtime.
- **Caveats:** WebNN needs Chrome feature flags (the Neural Engine a second
  one); cold start here is low only because CoreML's on-disk cache was warm
  from earlier runs — first-ever build is 5–7 s and each new geometry
  0.4–2.7 s (WebNN agent's measurements). WGSL loads a model in ~20–90 ms.

**WGSL subgroup-matrix at fp16** (network only, 1080p): forcing it runs the
f32 matrix path with f16 storage — 4× more accurate (8e-4 vs 4e-3 max error)
but ~20% slower than the portable f16 kernel (base 73.5 vs 59.3 ms). A true
f16-accumulate matrix kernel doesn't exist yet.

**FidelityFX temporal denoisers** (1080p GPU time, median of 100):
shadows **0.49 ms**, reflections **1.66 ms**.

## Full tables

Generated 2026-10-08T10:51:16.416Z by examples/eval/run.mjs. Native: OIDN 2.5.1 (  Name: Apple M5 Pro).
Inputs are rounded to fp16 for every setup. Quality = PSNR (dB) / max 8-bit Δ against native OIDN **CPU** output (the reference implementation, same weights); HDR compared after x/(1+x) + gamma 2.2. Timings = warm median, `denoiseTextures` → texture, awaited (web) / `oidnDenoise` filter time (native, excludes host IO).

## Speed @ 1920×1080 (ms, warm median)

| case | native Metal | native CPU | ort fp32 | ort fp16 | kernels fp32 | kernels fp16 | wgsl fp32 | wgsl-portable fp32 | wgsl fp16 | webnn fp32 | webnn fp16 | webnn-npu fp16 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| spheres/rt_ldr_small | 13.7 | 187 | 146.8 | 93.2 | 114.9 | 77.7 | 37.7 | 49.6 | 30.8 | 43.5 | 27.0 | 30.8 |
| spheres/rt_ldr | 24.4 | 310 | 308.9 | 199.9 | 192.1 | 158.7 | 74.0 | 101.1 | 63.7 | 70.3 | 35.9 | 40.5 |
| spheres/rt_ldr_alb_small | 13.9 | 183 | 146.7 | 96.0 | 117.2 | 79.0 | 38.2 | 53.0 | 33.1 | 48.0 | 29.9 | 30.8 |
| spheres/rt_ldr_alb | 24.5 | 320 | 310.6 | 204.9 | 194.2 | 163.5 | 74.5 | 105.3 | 66.6 | 74.0 | 38.8 | 44.5 |
| spheres/rt_ldr_alb_nrm_small | 14.6 | 188 | 152.0 | 100.6 | 119.8 | 79.7 | 40.9 | 55.7 | 34.4 | 53.2 | 34.6 | 34.3 |
| spheres/rt_ldr_alb_nrm | 25.2 | 333 | 318.1 | 210.8 | 198.9 | 163.2 | 78.3 | 109.1 | 68.7 | 78.7 | 42.8 | 45.9 |
| spheres/rt_ldr_calb_cnrm_small | 14.7 | 187 | 168.6 | 115.0 | 119.8 | 79.6 | 40.6 | 56.3 | 34.9 | 53.4 | 34.5 | 38.0 |
| spheres/rt_ldr_calb_cnrm | 25.2 | 339 | 319.6 | 225.2 | 195.9 | 164.9 | 78.3 | 110.0 | 68.7 | 78.3 | 42.5 | 45.9 |
| eiffel/rt_ldr_small | 13.9 | 181 | 143.2 | 93.1 | 116.1 | 78.1 | 37.9 | 52.3 | 31.7 | 43.2 | 27.1 | 30.4 |
| eiffel/rt_ldr | 24.8 | 317 | 303.2 | 199.9 | 193.1 | 158.1 | 74.0 | 104.2 | 64.1 | 67.4 | 35.9 | 40.7 |
| eiffel/rt_ldr_alb_small | 13.8 | 193 | 147.7 | 95.9 | 118.4 | 78.9 | 38.2 | 54.6 | 33.1 | 48.0 | 29.9 | 30.8 |
| eiffel/rt_ldr_alb | 24.7 | 327 | 308.7 | 204.8 | 196.8 | 162.4 | 74.5 | 107.6 | 66.3 | 72.1 | 38.8 | 44.6 |
| eiffel/rt_ldr_alb_nrm_small | 14.6 | 193 | 152.2 | 100.8 | 119.8 | 80.6 | 40.5 | 56.9 | 34.2 | 53.7 | 34.9 | 36.3 |
| eiffel/rt_ldr_alb_nrm | 25.0 | 339 | 316.8 | 210.8 | 199.5 | 162.9 | 77.9 | 111.1 | 68.5 | 78.4 | 43.1 | 45.9 |
| eiffel/rt_ldr_calb_cnrm_small | 14.6 | 189 | 167.9 | 115.0 | 121.7 | 79.2 | 40.5 | 57.4 | 34.8 | 53.5 | 34.6 | 36.4 |
| eiffel/rt_ldr_calb_cnrm | 24.8 | 323 | 320.6 | 225.0 | 199.3 | 166.1 | 77.9 | 111.5 | 68.6 | 78.3 | 42.9 | 44.0 |
| hdrdump/rt_hdr_small | 13.8 | 178 | 143.5 | 93.3 | 116.8 | 77.7 | 38.3 | 53.6 | 31.9 | 43.4 | 27.1 | 27.9 |
| hdrdump/rt_hdr | 24.7 | 329 | 301.6 | 200.3 | 192.9 | 160.1 | 74.5 | 105.6 | 64.5 | 67.7 | 35.9 | 38.0 |
| hdrdump/rt_hdr_alb_small | 14.2 | 186 | 147.9 | 96.2 | 117.9 | 79.1 | 38.8 | 55.3 | 33.7 | 48.0 | 30.0 | 29.2 |
| hdrdump/rt_hdr_alb | 24.6 | 328 | 310.3 | 205.2 | 195.8 | 159.1 | 75.0 | 108.5 | 66.9 | 72.8 | 39.2 | 40.2 |
| hdrdump/rt_hdr_alb_nrm_small | 14.9 | 209 | 151.6 | 101.0 | 120.5 | 80.0 | 41.1 | 57.3 | 34.8 | 53.3 | 34.3 | 36.0 |
| hdrdump/rt_hdr_alb_nrm | 25.1 | 369 | 315.2 | 211.1 | 198.8 | 165.0 | 78.6 | 111.7 | 68.7 | 78.9 | 42.6 | 47.3 |
| hdrdump/rt_hdr_calb_cnrm_small | 14.7 | 188 | 168.7 | 115.5 | 120.8 | 80.1 | 41.1 | 57.8 | 36.2 | 53.5 | 34.6 | 36.0 |
| hdrdump/rt_hdr_calb_cnrm | 25.0 | 339 | 320.2 | 225.7 | 196.9 | 166.0 | 78.4 | 112.0 | 68.1 | 78.9 | 42.7 | 45.9 |
| hdrdump/rt_hdr_calb_cnrm_large | 54.2 | 739 | 319.6 | 225.6 | 389.5 | 439.5 | 185.9 | 279.2 | 166.6 | 159.1 | 65.4 | 78.9 |

## Speed @ 512² (ms, warm median)

| case | native Metal | native CPU | ort fp32 | ort fp16 | kernels fp32 | kernels fp16 | wgsl fp32 | wgsl-portable fp32 | wgsl fp16 | webnn fp32 | webnn fp16 | webnn-npu fp16 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| spheres/rt_ldr_small | 2.8 | 28 | 15.3 | 12.7 | 13.5 | 10.7 | 5.4 | 6.7 | 4.5 | 7.1 | 5.0 | 5.6 |
| spheres/rt_ldr | 4.1 | 66 | 30.1 | 25.6 | 22.1 | 19.7 | 9.8 | 12.7 | 8.3 | 9.4 | 6.0 | 7.1 |
| spheres/rt_ldr_alb_small | 2.7 | 28 | 15.1 | 12.8 | 13.5 | 10.8 | 5.3 | 6.9 | 4.5 | 8.7 | 8.1 | 6.1 |
| spheres/rt_ldr_alb | 4.0 | 65 | 30.7 | 26.2 | 23.5 | 20.5 | 9.8 | 13.3 | 8.6 | 10.9 | 6.9 | 7.9 |
| spheres/rt_ldr_alb_nrm_small | 2.8 | 31 | 15.8 | 13.3 | 13.6 | 11.3 | 5.5 | 7.1 | 4.7 | 9.0 | 6.7 | 7.0 |
| spheres/rt_ldr_alb_nrm | 4.0 | 64 | 31.4 | 26.8 | 22.9 | 20.3 | 10.4 | 13.6 | 8.8 | 12.2 | 8.1 | 8.8 |
| spheres/rt_ldr_calb_cnrm_small | 2.8 | 32 | 17.3 | 14.8 | 14.7 | 10.8 | 5.6 | 7.1 | 4.7 | 8.3 | 6.8 | 7.1 |
| spheres/rt_ldr_calb_cnrm | 3.7 | 67 | 33.1 | 28.4 | 23.6 | 20.6 | 10.3 | 13.8 | 8.8 | 11.4 | 7.9 | 8.9 |
| eiffel/rt_ldr_small | 2.8 | 31 | 14.8 | 12.5 | 13.3 | 10.7 | 5.2 | 6.7 | 4.4 | 6.8 | 5.0 | 5.2 |
| eiffel/rt_ldr | 4.2 | 64 | 29.9 | 25.5 | 22.5 | 19.9 | 9.8 | 13.0 | 8.3 | 10.1 | 6.0 | 6.9 |
| eiffel/rt_ldr_alb_small | 2.5 | 29 | 15.1 | 12.8 | 13.5 | 11.0 | 5.2 | 6.9 | 4.5 | 7.6 | 6.6 | 6.2 |
| eiffel/rt_ldr_alb | 3.9 | 65 | 30.6 | 26.0 | 22.8 | 20.1 | 9.9 | 13.4 | 8.6 | 10.6 | 6.8 | 7.7 |
| eiffel/rt_ldr_alb_nrm_small | 2.6 | 32 | 15.6 | 13.3 | 13.5 | 10.9 | 5.5 | 7.2 | 4.7 | 8.2 | 6.9 | 7.0 |
| eiffel/rt_ldr_alb_nrm | 4.0 | 71 | 31.4 | 26.8 | 22.9 | 20.4 | 10.4 | 13.9 | 8.7 | 11.4 | 8.6 | 9.1 |
| eiffel/rt_ldr_calb_cnrm_small | 2.7 | 29 | 17.3 | 14.9 | 13.7 | 11.0 | 5.6 | 7.1 | 4.7 | 8.5 | 6.8 | 6.9 |
| eiffel/rt_ldr_calb_cnrm | 4.1 | 65 | 33.1 | 28.3 | 23.0 | 20.3 | 10.3 | 14.1 | 8.9 | 11.4 | 7.9 | 9.0 |
| hdrdump/rt_hdr_small | 2.7 | 29 | 14.7 | 12.5 | 13.3 | 10.7 | 5.3 | 6.9 | 4.4 | 7.2 | 5.3 | 6.4 |
| hdrdump/rt_hdr | 4.1 | 69 | 29.9 | 25.5 | 22.6 | 19.5 | 9.9 | 13.1 | 8.4 | 9.6 | 6.3 | 7.0 |
| hdrdump/rt_hdr_alb_small | 2.9 | 30 | 15.2 | 12.8 | 13.4 | 10.8 | 5.4 | 6.9 | 4.6 | 7.6 | 6.0 | 6.0 |
| hdrdump/rt_hdr_alb | 4.1 | 66 | 30.8 | 26.0 | 22.5 | 20.1 | 9.9 | 13.5 | 8.7 | 10.1 | 7.0 | 7.6 |
| hdrdump/rt_hdr_alb_nrm_small | 2.8 | 30 | 15.6 | 13.2 | 13.8 | 10.9 | 5.7 | 7.2 | 4.8 | 8.3 | 6.8 | 6.9 |
| hdrdump/rt_hdr_alb_nrm | 3.9 | 66 | 31.5 | 26.8 | 23.1 | 20.3 | 10.4 | 13.9 | 8.9 | 11.6 | 8.1 | 9.0 |
| hdrdump/rt_hdr_calb_cnrm_small | 2.8 | 30 | 17.4 | 15.0 | 13.6 | 10.9 | 5.6 | 7.2 | 4.8 | 9.0 | 6.9 | 6.9 |
| hdrdump/rt_hdr_calb_cnrm | 4.0 | 66 | 33.1 | 28.4 | 23.1 | 20.3 | 10.4 | 13.9 | 9.5 | 12.0 | 7.9 | 8.8 |
| hdrdump/rt_hdr_calb_cnrm_large | 7.8 | 156 | 33.2 | 28.4 | 49.5 | 52.0 | 24.4 | 35.3 | 21.0 | 20.3 | 10.8 | 13.9 |

## Quality vs native CPU (PSNR dB / max 8-bit Δ)

| case | native Metal | ort fp32 | ort fp16 | kernels fp32 | kernels fp16 | wgsl fp32 | wgsl-portable fp32 | wgsl fp16 | webnn fp32 | webnn fp16 | webnn-npu fp16 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| spheres/rt_ldr_small | max abs 7.7e-4 | 73.1 / 1 | 57.2 / 2 | 73.1 / 1 | 77.8 / 1 | 73.1 / 1 | 73.1 / 1 | 66.6 / 1 | 73.1 / 1 | 77.8 / 1 | 63.0 / 1 |
| spheres/rt_ldr | max abs 6.3e-4 | 73.4 / 1 | 59.3 / 2 | 73.4 / 1 | 77.6 / 1 | 73.4 / 1 | 73.4 / 1 | 68.1 / 1 | 73.4 / 1 | 77.6 / 1 | 63.5 / 1 |
| spheres/rt_ldr_alb_small | max abs 9.0e-4 | 35.9 / 34 | 35.8 / 35 | 73.1 / 1 | 77.0 / 1 | 73.1 / 1 | 73.1 / 1 | 65.2 / 1 | 73.1 / 1 | 77.0 / 1 | 66.6 / 1 |
| spheres/rt_ldr_alb | max abs 7.9e-4 | 36.4 / 48 | 36.4 / 50 | 73.1 / 1 | 77.4 / 1 | 73.1 / 1 | 73.1 / 1 | 66.7 / 1 | 73.1 / 1 | 77.4 / 1 | 64.1 / 1 |
| spheres/rt_ldr_alb_nrm_small | max abs 8.3e-4 | 36.0 / 43 | 36.0 / 44 | 73.1 / 1 | 77.2 / 1 | 73.1 / 1 | 73.1 / 1 | 66.4 / 1 | 73.2 / 1 | 77.2 / 1 | 63.8 / 1 |
| spheres/rt_ldr_alb_nrm | max abs 8.0e-4 | 35.3 / 27 | 35.4 / 27 | 73.0 / 1 | 77.1 / 1 | 73.0 / 1 | 73.0 / 1 | 66.4 / 1 | 73.0 / 1 | 77.1 / 1 | 65.9 / 1 |
| spheres/rt_ldr_calb_cnrm_small | max abs 8.5e-4 | 73.0 / 1 | 56.5 / 2 | 73.0 / 1 | 77.0 / 1 | 73.0 / 1 | 73.0 / 1 | 64.1 / 1 | 73.0 / 1 | 77.0 / 1 | 64.2 / 1 |
| spheres/rt_ldr_calb_cnrm | max abs 8.6e-4 | 73.2 / 1 | 55.6 / 2 | 73.2 / 1 | 76.7 / 1 | 73.2 / 1 | 73.2 / 1 | 65.5 / 1 | 73.2 / 1 | 76.8 / 1 | 64.8 / 1 |
| eiffel/rt_ldr_small | max abs 6.8e-4 | 72.3 / 1 | 55.3 / 2 | 72.3 / 1 | 76.9 / 1 | 72.3 / 1 | 72.3 / 1 | 64.4 / 1 | 72.3 / 1 | 76.9 / 1 | 61.9 / 1 |
| eiffel/rt_ldr | max abs 8.6e-4 | 72.2 / 1 | 56.7 / 2 | 72.2 / 1 | 75.7 / 1 | 72.2 / 1 | 72.2 / 1 | 65.2 / 1 | 72.2 / 1 | 75.7 / 1 | 61.9 / 1 |
| eiffel/rt_ldr_alb_small | max abs 1.3e-3 | 32.0 / 70 | 32.0 / 71 | 72.2 / 1 | 74.8 / 1 | 72.2 / 1 | 72.2 / 1 | 62.7 / 1 | 72.2 / 1 | 74.8 / 1 | 63.7 / 1 |
| eiffel/rt_ldr_alb | max abs 9.3e-4 | 34.0 / 52 | 34.1 / 53 | 72.1 / 1 | 75.3 / 1 | 72.1 / 1 | 72.1 / 1 | 63.3 / 1 | 72.1 / 1 | 75.3 / 1 | 62.4 / 1 |
| eiffel/rt_ldr_alb_nrm_small | max abs 1.0e-3 | 33.4 / 120 | 33.4 / 120 | 72.1 / 1 | 74.9 / 1 | 72.1 / 1 | 72.1 / 1 | 63.3 / 1 | 72.1 / 1 | 74.9 / 1 | 61.8 / 1 |
| eiffel/rt_ldr_alb_nrm | max abs 7.7e-4 | 32.6 / 64 | 32.8 / 64 | 72.2 / 1 | 75.9 / 1 | 72.2 / 1 | 72.2 / 1 | 65.0 / 1 | 72.2 / 1 | 75.9 / 1 | 64.1 / 1 |
| eiffel/rt_ldr_calb_cnrm_small | max abs 1.4e-3 | 72.3 / 1 | 53.2 / 3 | 72.3 / 1 | 74.7 / 1 | 72.3 / 1 | 72.3 / 1 | 62.3 / 2 | 72.3 / 1 | 74.7 / 1 | 62.3 / 1 |
| eiffel/rt_ldr_calb_cnrm | max abs 9.4e-4 | 70.1 / 5 | 53.2 / 5 | 70.1 / 5 | 71.6 / 5 | 70.1 / 5 | 70.1 / 5 | 63.1 / 5 | 70.1 / 5 | 71.6 / 5 | 62.6 / 5 |
| hdrdump/rt_hdr_small | max abs 4.3e-3 | 83.9 / 1 | 56.2 / 3 | 83.9 / 1 | 74.8 / 1 | 83.9 / 1 | 83.9 / 1 | 65.0 / 3 | 83.9 / 1 | 74.8 / 1 | 64.8 / 2 |
| hdrdump/rt_hdr | max abs 2.8e-3 | 83.8 / 1 | 58.3 / 4 | 83.8 / 1 | 74.9 / 1 | 83.8 / 1 | 83.8 / 1 | 66.5 / 1 | 83.8 / 1 | 74.9 / 1 | 64.5 / 1 |
| hdrdump/rt_hdr_alb_small | max abs 2.8e-3 | 38.4 / 27 | 38.3 / 26 | 83.7 / 1 | 74.6 / 1 | 83.7 / 1 | 83.7 / 1 | 64.7 / 1 | 83.7 / 1 | 74.6 / 1 | 65.2 / 1 |
| hdrdump/rt_hdr_alb | max abs 2.6e-3 | 37.1 / 26 | 37.1 / 26 | 83.7 / 1 | 74.7 / 1 | 83.7 / 1 | 83.7 / 1 | 63.8 / 1 | 83.7 / 1 | 74.7 / 1 | 64.6 / 1 |
| hdrdump/rt_hdr_alb_nrm_small | max abs 2.8e-3 | 40.0 / 18 | 40.0 / 18 | 83.4 / 1 | 74.0 / 1 | 83.4 / 1 | 83.4 / 1 | 64.6 / 1 | 83.4 / 1 | 74.0 / 1 | 65.9 / 1 |
| hdrdump/rt_hdr_alb_nrm | max abs 2.9e-3 | 33.1 / 46 | 33.0 / 46 | 83.8 / 1 | 74.5 / 1 | 83.8 / 1 | 83.8 / 1 | 65.3 / 1 | 83.8 / 1 | 74.5 / 1 | 63.7 / 1 |
| hdrdump/rt_hdr_calb_cnrm_small | max abs 3.6e-3 | 83.5 / 1 | 55.0 / 3 | 83.5 / 1 | 74.3 / 1 | 83.5 / 1 | 83.5 / 1 | 63.8 / 1 | 83.5 / 1 | 74.4 / 1 | 65.4 / 1 |
| hdrdump/rt_hdr_calb_cnrm | max abs 2.6e-3 | 83.7 / 1 | 55.6 / 2 | 83.7 / 1 | 74.6 / 1 | 83.7 / 1 | 83.7 / 1 | 65.3 / 1 | 83.7 / 1 | 74.6 / 1 | 65.8 / 1 |
| hdrdump/rt_hdr_calb_cnrm_large | max abs 2.9e-3 | 53.1 / 14 | 51.5 / 14 | 83.7 / 1 | 74.6 / 1 | 83.7 / 1 | 83.7 / 1 | 66.1 / 1 | 83.7 / 1 | 74.6 / 1 | 65.0 / 1 |

## Quality vs converged reference (LDR scenes, PSNR dB)

| case | native CPU | ort fp32 | ort fp16 | kernels fp32 | kernels fp16 | wgsl fp32 | wgsl-portable fp32 | wgsl fp16 | webnn fp32 | webnn fp16 | webnn-npu fp16 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| spheres/rt_ldr_small | 39.19 | 39.22 | 39.05 | 39.22 | 39.19 | 39.22 | 39.22 | 39.18 | 39.22 | 39.19 | 38.99 |
| spheres/rt_ldr | 39.34 | 39.37 | 39.30 | 39.37 | 39.34 | 39.37 | 39.37 | 39.32 | 39.37 | 39.34 | 39.14 |
| spheres/rt_ldr_alb_small | 39.13 | 35.43 | 35.38 | 39.16 | 39.13 | 39.16 | 39.16 | 39.13 | 39.16 | 39.13 | 38.98 |
| spheres/rt_ldr_alb | 39.55 | 35.18 | 35.12 | 39.59 | 39.55 | 39.59 | 39.59 | 39.56 | 39.59 | 39.55 | 39.36 |
| spheres/rt_ldr_alb_nrm_small | 39.22 | 34.62 | 34.59 | 39.26 | 39.22 | 39.26 | 39.26 | 39.23 | 39.26 | 39.22 | 39.03 |
| spheres/rt_ldr_alb_nrm | 39.58 | 34.78 | 34.80 | 39.62 | 39.58 | 39.62 | 39.62 | 39.53 | 39.62 | 39.58 | 39.43 |
| spheres/rt_ldr_calb_cnrm_small | 39.15 | 39.18 | 39.07 | 39.18 | 39.14 | 39.18 | 39.18 | 39.13 | 39.18 | 39.14 | 38.97 |
| spheres/rt_ldr_calb_cnrm | 39.27 | 39.30 | 38.95 | 39.30 | 39.27 | 39.30 | 39.30 | 39.20 | 39.30 | 39.27 | 39.09 |
| eiffel/rt_ldr_small | 26.84 | 26.84 | 26.83 | 26.84 | 26.84 | 26.84 | 26.84 | 26.84 | 26.84 | 26.84 | 26.84 |
| eiffel/rt_ldr | 26.97 | 26.98 | 26.98 | 26.98 | 26.97 | 26.98 | 26.98 | 26.98 | 26.98 | 26.97 | 26.97 |
| eiffel/rt_ldr_alb_small | 27.06 | 26.40 | 26.41 | 27.06 | 27.06 | 27.06 | 27.06 | 27.05 | 27.06 | 27.06 | 27.05 |
| eiffel/rt_ldr_alb | 27.10 | 26.80 | 26.80 | 27.10 | 27.10 | 27.10 | 27.10 | 27.10 | 27.10 | 27.10 | 27.09 |
| eiffel/rt_ldr_alb_nrm_small | 27.03 | 26.83 | 26.83 | 27.03 | 27.03 | 27.03 | 27.03 | 27.03 | 27.03 | 27.03 | 27.02 |
| eiffel/rt_ldr_alb_nrm | 27.13 | 26.63 | 26.66 | 27.13 | 27.13 | 27.13 | 27.13 | 27.13 | 27.13 | 27.13 | 27.12 |
| eiffel/rt_ldr_calb_cnrm_small | 26.98 | 26.98 | 26.97 | 26.98 | 26.98 | 26.98 | 26.98 | 26.98 | 26.98 | 26.98 | 26.97 |
| eiffel/rt_ldr_calb_cnrm | 27.03 | 27.03 | 27.01 | 27.03 | 27.03 | 27.03 | 27.03 | 27.02 | 27.03 | 27.03 | 27.02 |

## Cold start (ms): engine load / first call @ 512² (includes compile)

| case | ort fp32 | ort fp16 | kernels fp32 | kernels fp16 | wgsl fp32 | wgsl-portable fp32 | wgsl fp16 | webnn fp32 | webnn fp16 | webnn-npu fp16 |
|---|---|---|---|---|---|---|---|---|---|---|
| spheres/rt_ldr_small | 749 / 16 | 720 / 23 | 995 / 23 | 980 / 21 | 65 / 6 | 77 / 14 | 73 / 6 | 187 / 17 | 157 / 17 | 450 / 7 |
| spheres/rt_ldr | 22 / 31 | 13 / 26 | 857 / 22 | 978 / 28 | 29 / 11 | 31 / 15 | 31 / 10 | 135 / 12 | 127 / 8 | 419 / 8 |
| spheres/rt_ldr_alb_small | 12 / 15 | 13 / 13 | 820 / 14 | 879 / 20 | 14 / 6 | 15 / 8 | 16 / 5 | 120 / 14 | 126 / 10 | 364 / 8 |
| spheres/rt_ldr_alb | 19 / 31 | 15 / 26 | 959 / 24 | 864 / 29 | 26 / 10 | 23 / 14 | 29 / 9 | 134 / 13 | 123 / 9 | 371 / 10 |
| spheres/rt_ldr_alb_nrm_small | 16 / 16 | 13 / 14 | 819 / 17 | 833 / 19 | 16 / 6 | 11 / 7 | 11 / 5 | 113 / 11 | 109 / 9 | 369 / 10 |
| spheres/rt_ldr_alb_nrm | 22 / 32 | 15 / 27 | 837 / 25 | 817 / 29 | 26 / 11 | 22 / 14 | 26 / 9 | 131 / 13 | 126 / 10 | 392 / 11 |
| spheres/rt_ldr_calb_cnrm_small | 15 / 17 | 9 / 15 | 812 / 16 | 815 / 19 | 10 / 6 | 10 / 7 | 12 / 5 | 112 / 10 | 110 / 9 | 360 / 10 |
| spheres/rt_ldr_calb_cnrm | 21 / 33 | 16 / 29 | 850 / 25 | 836 / 28 | 29 / 11 | 22 / 14 | 23 / 9 | 134 / 12 | 124 / 10 | 383 / 11 |
| eiffel/rt_ldr_small | 5 / 16 | 5 / 14 | 900 / 14 | 817 / 20 | 13 / 6 | 10 / 8 | 11 / 5 | 108 / 10 | 107 / 8 | 362 / 7 |
| eiffel/rt_ldr | 6 / 31 | 5 / 26 | 830 / 24 | 852 / 29 | 19 / 11 | 23 / 14 | 26 / 9 | 125 / 12 | 124 / 8 | 382 / 8 |
| eiffel/rt_ldr_alb_small | 5 / 15 | 5 / 13 | 888 / 14 | 810 / 17 | 9 / 5 | 11 / 7 | 9 / 5 | 115 / 13 | 109 / 8 | 361 / 8 |
| eiffel/rt_ldr_alb | 6 / 31 | 5 / 26 | 823 / 24 | 825 / 29 | 23 / 10 | 21 / 14 | 24 / 9 | 134 / 13 | 122 / 10 | 372 / 9 |
| eiffel/rt_ldr_alb_nrm_small | 12 / 16 | 10 / 13 | 848 / 15 | 806 / 17 | 9 / 6 | 13 / 8 | 11 / 5 | 112 / 11 | 111 / 10 | 369 / 10 |
| eiffel/rt_ldr_alb_nrm | 11 / 32 | 7 / 27 | 842 / 24 | 821 / 27 | 20 / 11 | 25 / 14 | 24 / 9 | 127 / 13 | 120 / 10 | 390 / 12 |
| eiffel/rt_ldr_calb_cnrm_small | 11 / 17 | 8 / 15 | 877 / 14 | 828 / 18 | 11 / 6 | 11 / 7 | 10 / 5 | 112 / 10 | 108 / 9 | 364 / 10 |
| eiffel/rt_ldr_calb_cnrm | 17 / 33 | 14 / 29 | 859 / 23 | 851 / 28 | 20 / 11 | 23 / 14 | 21 / 9 | 130 / 14 | 120 / 9 | 373 / 11 |
| hdrdump/rt_hdr_small | 13 / 15 | 8 / 23 | 870 / 14 | 804 / 24 | 11 / 6 | 10 / 7 | 9 / 14 | 111 / 12 | 112 / 7 | 364 / 7 |
| hdrdump/rt_hdr | 19 / 30 | 13 / 26 | 878 / 23 | 821 / 41 | 24 / 11 | 23 / 14 | 22 / 18 | 128 / 13 | 120 / 11 | 372 / 8 |
| hdrdump/rt_hdr_alb_small | 13 / 15 | 12 / 22 | 887 / 14 | 929 / 19 | 13 / 6 | 11 / 16 | 9 / 12 | 112 / 11 | 115 / 14 | 367 / 9 |
| hdrdump/rt_hdr_alb | 22 / 31 | 15 / 27 | 840 / 23 | 842 / 28 | 26 / 11 | 20 / 23 | 23 / 18 | 133 / 13 | 121 / 9 | 373 / 9 |
| hdrdump/rt_hdr_alb_nrm_small | 13 / 25 | 21 / 14 | 832 / 22 | 819 / 20 | 11 / 15 | 10 / 17 | 12 / 6 | 109 / 11 | 108 / 9 | 362 / 10 |
| hdrdump/rt_hdr_alb_nrm | 21 / 32 | 17 / 27 | 891 / 23 | 847 / 28 | 24 / 11 | 24 / 14 | 23 / 18 | 131 / 15 | 128 / 9 | 382 / 11 |
| hdrdump/rt_hdr_calb_cnrm_small | 13 / 27 | 10 / 15 | 834 / 14 | 847 / 20 | 16 / 15 | 11 / 8 | 10 / 5 | 112 / 12 | 110 / 10 | 361 / 10 |
| hdrdump/rt_hdr_calb_cnrm | 20 / 43 | 14 / 29 | 875 / 23 | 863 / 28 | 23 / 11 | 25 / 14 | 25 / 11 | 150 / 14 | 122 / 9 | 377 / 11 |
| hdrdump/rt_hdr_calb_cnrm_large | 17 / 34 | 14 / 37 | 895 / 52 | 891 / 54 | 89 / 24 | 94 / 33 | 92 / 22 | 390 / 22 | 203 / 12 | 412 / 16 |
