# E-2b: OIDN 2 (fast / balanced / high) vs our real-time filters, rerun at HEAD

_2026-11-19, E-2b agent (evaluator / tooling; RULES.md rule 8: no NRD code, README or port read; this compares our own
filters with OIDN only). Asked for after a session told Dennis "OIDN gives a much cleaner single frame than SVGF", a
general expectation that contradicted [E-2](E2-oidn-baseline.md) and his own tests. This reruns E-2 at today's HEAD, adds
OIDN `balanced`, adds per-region and boil numbers and four more scenes, and puts OIDN on the review bench for a visual
A/B. OIDN is a **baseline** scored against the same converged references as every other filter (SPEC §13)._

## Conclusion first

- **With history, our shipped filters beat OIDN at every quality on almost everything.** Settled frames, OIDN high vs
  ours (group means of per-capture pooled dB): test bed diffuse 35.61 vs **38.12** (A-SVGF), specular 33.62 vs
  **34.48**, shadows 32.20 vs **37.68**; real corner scene diffuse 39.93 vs **40.67**, SSR specular 41.90 vs **46.66**,
  shadows 31.75 vs **33.75**, AO 33.18 vs **33.71**; moving occluders diffuse 35.40 vs **37.79**, shadows 29.99 vs
  **31.33**, AO 30.42 vs **35.97**; golden scenes diffuse 29.65 vs **30.63**, shadows 26.76 vs **26.85**, AO 26.45 vs
  **28.59**. FLIP agrees on every signal and group. **Per capture, OIDN is ahead on settled frames in five cases:**
  `bistro-move` shadows by 2.4 dB (high; fast +0.8: ours 24.38 dB is no better than the raw input's 24.42, already in
  the scorecard, FFX 19.65; ours loses on dense geometry, 23.1 vs raw 31.4 dB, and from frame 0, so it is our spatial
  filter on Bistro's thin geometry with a small moving light, not lag); `golden-G4-pan-light-on` shadows +0.27 (high;
  a light switches on at frame 32); and test-bed specular on `pan` +0.8, `cut` +0.4, `glossy` +0.1 (high; E-2 saw `pan`
  too: a disocclusion every frame).
- **"OIDN gives a much cleaner single frame than SVGF" is wrong as a general statement, and partly right on real
  scenes.** At frame 0 (a reset: nobody has history):
  - **Test bed:** ours beat all three OIDN qualities in the group means (diffuse 36.02 vs 35.39 high, specular 33.40 vs
    33.07, shadows 34.48 vs 31.91); OIDN high is ahead on 4 of 21 path-signals by 0.1–0.5 dB.
  - **Real scenes (8 captures):** OIDN **high** is ahead at frame 0 on **diffuse in all 8** (+0.01 to +1.1 dB, group
    means +0.5 to +0.7) and on **AO in all 8** (+0.2 to +2.1 dB), on shadows in 4 of 8 (`bistro-move` +2.9,
    `three-knot-static` +1.8, `sponza-move` +0.5, `golden-G4` +0.2) and on SSR specular in 2 of 8 (≤ 0.4). OIDN
    **balanced** is about as good as high there (AO often a little better). OIDN **fast** is ahead at frame 0 on diffuse
    in 3 of 8 (`golden-G3` +0.5, `bistro-move` +0.3, `sponza-move` +0.05), AO in 2 of 8 (`three-pan` +0.8,
    `golden-G3` +0.3) and shadows in 2 of 8 (`bistro-move` +1.2, `three-knot-static` +0.9); behind ours elsewhere.
  - E-2's "+1.9 dB diffuse at frame 0 on the corner" was against the paper SVGF, which still scores 37.83 there; the
    shipped A-SVGF scores 39.25, so the corner gap is now +0.5 (high). A-SVGF overtakes OIDN within a few frames
    everywhere except the five settled cases above.
  - So Dennis's observation holds for OIDN fast (and mostly balanced) at any frame, and for every quality after the
    first frames; the single-frame edge is OIDN high/balanced on real-scene diffuse and AO, ≤ 1.1 dB diffuse and ≤ 2.1 dB
    AO, for the frames right after a reset.
- **Real-scene shadows flipped since E-2.** E-2 had OIDN high +0.6 / +0.8 dB over our shadows on `three-orbit` /
  `three-pan`; a month of shadow changes (q21, q23, q24, q29 and the stabilizer) put ours ahead by +2.1 dB (33.63 / 33.91
  vs 31.53 / 31.86), also at frame 0 (33.08 vs 31.50), and +4.8 dB in penumbrae (settled; 29.69 vs 24.92).
- **Per region.** Ours lead in static, disoccluded and dense-geometry regions on nearly every signal and group
  (exceptions: test-bed specular static, OIDN high +0.75 dB; shadows dense geometry on the corner and golden scenes and
  golden static, golden specular disoccluded / dense, OIDN by ≤ 0.45 dB). OIDN's clearest edge is the **moving region**
  (pixels whose reference changed in the last 4 frames) on the test bed and the corner scene: test-bed diffuse 28.48 vs
  27.26 and specular 26.35 vs 25.48, corner diffuse 19.21 vs 18.12, corner AO 16.81 vs 14.33. That is our temporal lag
  where the truth changes. On the asset scenes ours lead there too (moving-occluder diffuse 24.79 vs 24.08, AO 23.12 vs
  21.66), and on moving **shadows** ours lead everywhere (corner 21.12 vs 17.16, moving occluders 20.22 vs 18.72).
- **Temporal stability.** OIDN flickers 1.1–3× as much as ours (settled flicker, every group and signal: e.g. test-bed
  diffuse 0.0076 vs 0.0032, corner shadows 0.0075 vs 0.0044). Boil (Dennis's definition: motion-compensated, stride 8 on
  the long captures): on static regions OIDN boils 1.2–7× as much as ours, close to or above the clean reference's own
  noise floor while ours stays below it (test-bed diffuse k = 1: 0.0060 vs ours 0.0008, reference 0.0052; corner diffuse
  0.0027 vs 0.0011, reference 0.0029; golden shadows 0.0133 vs 0.0083, reference 0.0102). On **moving shadows** OIDN boils above the reference (corner 0.0957 vs reference 0.0673; ours 0.0665; golden
  0.148 vs 0.134; ours 0.108): the shadow undulates frame to frame. On moving diffuse OIDN's k = 8 boil is lower than
  ours (corner 0.022–0.033 vs 0.045), but both stay below the reference's 0.080 there.
- **fast / balanced / high.** high > balanced > fast on diffuse and specular (test bed: 35.58 / 34.47 / 34.24 dB);
  balanced ≈ high on shadows and AO (balanced sometimes ahead) and at less than half the cost; balanced ≈ fast on
  test-bed diffuse. None of the three changes any ranking above.
- **Cost (1080p, M5 Pro shared with other agents, best-effort):** OIDN per signal **45 ms fast, 86 ms balanced, 216 ms
  high** (fp32 with subgroup matrices; fp16 fast 37 ms), vs ours **4.3 ms for diffuse + specular together**, 0.65 ms
  shadows, 1.9 ms AO (GPU timestamps, fastest frame). A frame with all four signals: ~180 ms (OIDN fast) or ~860 ms (high)
  vs ~7 ms: 25–125×. The unmerged subgroup-matrix v2 kernel (~1.3× faster fp32) doesn't change this.
- **What to take away:** OIDN 2 single-frame is a quality yardstick, not the bar: our filters clear it with history on
  every signal and scene group, with five per-capture exceptions (two shadow cases worth fixing, three small specular
  ones), and OIDN's frame-0 lead is real-scene diffuse / AO at its slower qualities, gone after a few frames.
  Follow-ups (TASKS): `bistro-move` shadows (ours = raw input), and our frame-0 AO / shadows on the asset scenes.

## Setup

| | |
|---|---|
| GPU / browser | Apple M5 Pro, HeadlessChrome 157 (`--use-angle=metal`), WebGPU. The Mac was shared with other agents throughout (load average 8–14); timings are best-effort with the load recorded |
| Code | branch `feat/oidn-vs-svgf-bench` off main **7014384** (2026-11-13; 58 `packages/denoiser-realtime` commits since E-2's 7a8b980). OIDN: `packages/denoiser-core` + `denoiser-wgsl` at the same commit (network code unchanged since E-2: OIDN's test-bed scores match E-2 to the hundredth). The unmerged subgroup-matrix v2 branch (`feat/wgsl-sgm-v2`) is not used: it changes fp32 speed (~1.3×), not outputs (≤ 1.3e-6) |
| Captures | E-2's analytic test bed, re-recorded identically from `examples/realtime-denoiser` capture set `standard` (`std540-{orbit,pan,light,thin,glossy,cut,object}`, 960×540, 16–24 frames, 256-spp references; `std1080-orbit` for cost); E-2's real three.js corner `three-orbit` / `three-pan` (1024-ray references, SSR specular, `ao_ref`); **new:** the moving-occluder captures `three-knot-static`, `three-knot-orbit` (2048 rays), `sponza-move`, `bistro-move` (1024 rays) and the golden scenes `golden-G3-orbit` (Sponza orbit), `golden-G4-pan-light-on` (Bistro pan, a light switches on at frame 32), 64 frames, 4096-spp references |
| Arms | **ours, shipped defaults:** `svgf-auto` (A-SVGF, diffuse + specular in one dispatch), `shadows`, `occlusion-svgf-auto` (AO). **ours, paper SVGF:** `svgf`, `occlusion-svgf` (M1 behaviour pinned: anti-lag off). **OIDN 2 single frame:** `oidn-default` (fast, `*_small` weights), `oidn-balanced` (new, base weights), `oidn` (high, `*_large`), fp32, WGSL runtime on its own max-limits device with subgroup matrices (what `AutoRuntime` picks without WebNN) |
| OIDN inputs | as E-2 (decided there on `std540-orbit`): demodulated HDR radiance as HDR colour; shadow visibility and AO ĥ as grey colour through the HDR weights; aux = albedo 1 + the capture's normal (`rt_hdr_calb_cnrm*`) |
| Scoring | `tools/scorecard/lib/metrics.mjs` (the scorecard's metric code), driven by `tools/scorecard/oidn-vs-svgf.mjs`: pooled PSNR (Reinhard per channel for colour, clamp for scalars), FLIP (every 4th frame, the test bed's viewing condition), flicker = fixed-pixel mean \|e_t − e_t−1\| (E-2's definition), boil = RMS second temporal difference along the reprojected history / √6 at stride k = 1 and k = 8 (Dennis's boil: motion-compensated, low-frequency; the 16-frame test-bed captures are too short for k = 8). **Regions** (per pixel and frame, frames ≥ 8 after a reset): *moving* = the reference changed by > 0.05 within 4 frames along its history (moving shadows, moving objects, the light event), *disoccluded* = history 2–6 frames old, *dense geometry* = creases and silhouettes, *static* = the rest; *penumbra* (shadows) = 0.02 < reference < 0.98. **Frame 0** = the reset frames (frame 0, and the camera cut in `std540-cut`): no filter has history. **Settled** = frames ≥ 8 after a reset |

Raw numbers: [data/e2b-oidn-vs-svgf.json](data/e2b-oidn-vs-svgf.json) (every capture, signal, arm and region, per-frame
RMSE series, OIDN models) and [data/e2b-cost.json](data/e2b-cost.json) (every cost round).

## Results

Group means; **bold** = best denoised value in the column. *frame 0* = reset frames (no history anywhere); *settled* =
frames ≥ 8 after a reset; *flicker* on settled frames; boil k = 1 on the 16–24-frame test bed, k = 8 elsewhere, with the
clean reference's own boil in the same pixels as the floor (a filter below the reference there is not "too calm": the
reference boils from real change in moving regions and from its own residual noise elsewhere). AO has a reference only on
the three.js and asset captures. `three-knot-orbit` shares the camera path and frame 0 with `three-orbit`, so its AO and
specular numbers are within 0.01 dB of `three-orbit`'s; its moving shadow is what it adds.

#### Analytic test bed (7 paths, 960×540, 256-spp references)

**diffuse**

| filter | frame 0 dB | settled dB | all frames dB | FLIP | flicker | boil all | boil moving |
|---|---|---|---|---|---|---|---|
| raw 1-ray input | 16.08 | 15.82 | 15.97 | 0.4325 | 0.1213 | 0.1129 | 0.1217 |
| SVGF (paper, pinned) | 35.88 | 37.87 | 37.48 | 0.0575 | 0.0037 | 0.0024 | 0.0084 |
| **A-SVGF (shipped)** | **36.02** | **38.12** | **37.70** | **0.0557** | **0.0032** | **0.0020** | **0.0082** |
| OIDN fast | 34.04 | 34.32 | 34.24 | 0.1088 | 0.0080 | 0.0072 | 0.0124 |
| OIDN balanced | 34.15 | 34.59 | 34.47 | 0.0924 | 0.0076 | 0.0067 | 0.0128 |
| OIDN high | 35.39 | 35.61 | 35.58 | 0.0823 | 0.0076 | 0.0073 | 0.0145 |

<sub>Reference boil (same pixels, k = 1, all regions): 0.0055.</sub>

| diffuse: settled PSNR dB per region | static | moving | disoccluded | dense geometry |
|---|---|---|---|---|
| raw 1-ray input | 15.80 | 15.31 | 15.98 | 15.79 |
| SVGF (paper, pinned) | 38.79 | 27.08 | **37.02** | 36.94 |
| **A-SVGF (shipped)** | **39.10** | 27.26 | 37.00 | **37.15** |
| OIDN fast | 35.99 | 28.16 | 34.27 | 31.80 |
| OIDN balanced | 36.29 | 28.29 | 34.65 | 31.96 |
| OIDN high | 37.12 | **28.48** | 35.64 | 33.30 |

| diffuse: boil (k = 1) per region | static | moving | disoccluded | dense geometry |
|---|---|---|---|---|
| reference | 0.0052 | 0.0222 | 0.0048 | 0.0052 |
| raw 1-ray input | 0.1131 | 0.1217 | 0.1164 | 0.1132 |
| SVGF (paper, pinned) | 0.0012 | 0.0084 | 0.0028 | 0.0044 |
| **A-SVGF (shipped)** | 0.0008 | 0.0082 | 0.0027 | 0.0039 |
| OIDN fast | 0.0061 | 0.0124 | 0.0097 | 0.0102 |
| OIDN balanced | 0.0055 | 0.0128 | 0.0087 | 0.0098 |
| OIDN high | 0.0060 | 0.0145 | 0.0095 | 0.0106 |

**specular**

| filter | frame 0 dB | settled dB | all frames dB | FLIP | flicker | boil all | boil moving |
|---|---|---|---|---|---|---|---|
| raw 1-ray input | 15.83 | 16.39 | 15.98 | 0.3059 | 0.1165 | 0.1092 | 0.1317 |
| SVGF (paper, pinned) | 32.87 | 33.68 | 33.46 | 0.0658 | 0.0044 | **0.0046** | **0.0129** |
| **A-SVGF (shipped)** | **33.40** | **34.48** | **34.15** | **0.0628** | **0.0039** | 0.0050 | 0.0157 |
| OIDN fast | 32.33 | 32.87 | 32.36 | 0.0786 | 0.0080 | 0.0110 | 0.0273 |
| OIDN balanced | 32.61 | 33.16 | 32.64 | 0.0762 | 0.0076 | 0.0108 | 0.0270 |
| OIDN high | 33.07 | 33.62 | 33.13 | 0.0720 | 0.0073 | 0.0107 | 0.0266 |

<sub>Reference boil (same pixels, k = 1, all regions): 0.0087.</sub>

| specular: settled PSNR dB per region | static | moving | disoccluded | dense geometry |
|---|---|---|---|---|
| raw 1-ray input | 16.50 | 14.34 | 18.16 | 16.33 |
| SVGF (paper, pinned) | 35.10 | 23.73 | 36.35 | 34.73 |
| **A-SVGF (shipped)** | 35.82 | 25.48 | **36.38** | **34.97** |
| OIDN fast | 36.26 | 25.83 | 33.41 | 30.07 |
| OIDN balanced | 36.54 | 25.96 | 33.81 | 30.52 |
| OIDN high | **36.57** | **26.35** | 34.29 | 31.35 |

| specular: boil (k = 1) per region | static | moving | disoccluded | dense geometry |
|---|---|---|---|---|
| reference | 0.0058 | 0.0287 | 0.0048 | 0.0067 |
| raw 1-ray input | 0.1067 | 0.1317 | 0.0917 | 0.1148 |
| SVGF (paper, pinned) | 0.0017 | 0.0129 | 0.0036 | 0.0055 |
| **A-SVGF (shipped)** | 0.0018 | 0.0157 | 0.0039 | 0.0056 |
| OIDN fast | 0.0074 | 0.0273 | 0.0100 | 0.0127 |
| OIDN balanced | 0.0072 | 0.0270 | 0.0095 | 0.0124 |
| OIDN high | 0.0071 | 0.0266 | 0.0099 | 0.0122 |

**shadows**

| filter | frame 0 dB | settled dB | all frames dB | FLIP | flicker | boil all | boil moving |
|---|---|---|---|---|---|---|---|
| raw 1-ray input | 17.99 | 17.64 | 17.74 | 0.0763 | 0.0506 | 0.1153 | 0.3251 |
| **shadows (shipped)** | **34.48** | **37.68** | **37.03** | **0.0143** | **0.0024** | **0.0170** | **0.0600** |
| OIDN fast | 30.29 | 30.56 | 30.33 | 0.0325 | 0.0078 | 0.0233 | 0.0849 |
| OIDN balanced | 31.85 | 32.19 | 31.94 | 0.0257 | 0.0064 | 0.0224 | 0.0839 |
| OIDN high | 31.91 | 32.20 | 32.00 | 0.0304 | 0.0064 | 0.0220 | 0.0810 |

<sub>Reference boil (same pixels, k = 1, all regions): 0.0170.</sub>

| shadows: settled PSNR dB per region | static | moving | disoccluded | dense geometry | penumbra | penumbra, frame 0 |
|---|---|---|---|---|---|---|
| raw 1-ray input | 17.83 | 8.39 | 19.48 | 21.80 | 8.27 | 8.18 |
| **shadows (shipped)** | **41.52** | **24.78** | **40.17** | **38.34** | **28.94** | **25.21** |
| OIDN fast | 35.80 | 22.49 | 30.67 | 26.62 | 23.89 | 23.05 |
| OIDN balanced | 37.72 | 23.59 | 32.41 | 28.42 | 25.04 | 24.15 |
| OIDN high | 36.29 | 23.54 | 32.61 | 29.07 | 24.84 | 24.01 |

| shadows: boil (k = 1) per region | static | moving | disoccluded | dense geometry |
|---|---|---|---|---|
| reference | 0.0021 | 0.0587 | 0.0033 | 0.0139 |
| raw 1-ray input | 0.1117 | 0.3251 | 0.1093 | 0.0783 |
| **shadows (shipped)** | 0.0021 | 0.0600 | 0.0063 | 0.0152 |
| OIDN fast | 0.0095 | 0.0849 | 0.0221 | 0.0239 |
| OIDN balanced | 0.0081 | 0.0839 | 0.0199 | 0.0231 |
| OIDN high | 0.0083 | 0.0810 | 0.0191 | 0.0218 |

#### Real three.js corner scene (three-orbit, three-pan; SSR specular)

**diffuse**

| filter | frame 0 dB | settled dB | all frames dB | FLIP | flicker | boil k=8 all | boil k=8 moving |
|---|---|---|---|---|---|---|---|
| raw 1-ray input | 16.93 | 17.02 | 16.98 | 0.4428 | 0.1617 | 0.0973 | 0.1354 |
| SVGF (paper, pinned) | 37.83 | 40.31 | 40.08 | 0.0370 | 0.0056 | 0.0048 | 0.0613 |
| **A-SVGF (shipped)** | 39.25 | **40.67** | **40.47** | **0.0355** | **0.0054** | **0.0035** | 0.0448 |
| OIDN fast | 38.49 | 38.78 | 38.72 | 0.0558 | 0.0070 | 0.0043 | 0.0224 |
| OIDN balanced | 38.76 | 39.10 | 39.03 | 0.0540 | 0.0068 | 0.0040 | **0.0216** |
| OIDN high | **39.72** | 39.93 | 39.90 | 0.0485 | 0.0065 | 0.0044 | 0.0328 |

<sub>Reference boil (same pixels, k = 8, static region): 0.0029.</sub>

| diffuse: settled PSNR dB per region | static | moving | disoccluded | dense geometry |
|---|---|---|---|---|
| raw 1-ray input | 17.02 | 15.60 | 17.51 | 16.48 |
| SVGF (paper, pinned) | 45.63 | 18.40 | 43.45 | 33.49 |
| **A-SVGF (shipped)** | **46.06** | 18.12 | **43.69** | **33.84** |
| OIDN fast | 43.69 | 17.90 | 41.20 | 31.69 |
| OIDN balanced | 44.13 | 17.90 | 41.70 | 32.02 |
| OIDN high | 44.37 | **19.21** | 42.13 | 32.97 |

| diffuse: boil (k = 8) per region | static | moving | disoccluded | dense geometry |
|---|---|---|---|---|
| reference | 0.0029 | 0.0795 | 0.0098 | 0.0121 |
| raw 1-ray input | 0.0965 | 0.1354 | 0.0916 | 0.1037 |
| SVGF (paper, pinned) | 0.0015 | 0.0613 | 0.0176 | 0.0128 |
| **A-SVGF (shipped)** | 0.0011 | 0.0448 | 0.0104 | 0.0093 |
| OIDN fast | 0.0030 | 0.0224 | 0.0108 | 0.0099 |
| OIDN balanced | 0.0028 | 0.0216 | 0.0104 | 0.0092 |
| OIDN high | 0.0027 | 0.0328 | 0.0128 | 0.0109 |

**specular**

| filter | frame 0 dB | settled dB | all frames dB | FLIP | flicker | boil k=8 all | boil k=8 moving |
|---|---|---|---|---|---|---|---|
| raw 1-ray input | 34.81 | 35.47 | 35.33 | 0.1358 | 0.0092 | 0.0143 | 0.0691 |
| SVGF (paper, pinned) | 44.34 | 45.20 | 45.22 | 0.0403 | 0.0012 | **0.0049** | **0.0332** |
| **A-SVGF (shipped)** | **44.42** | **46.66** | **46.45** | **0.0372** | **0.0011** | 0.0054 | 0.0391 |
| OIDN fast | 39.28 | 39.26 | 39.25 | 0.0702 | 0.0043 | 0.0096 | 0.0465 |
| OIDN balanced | 40.25 | 40.37 | 40.33 | 0.0658 | 0.0039 | 0.0089 | 0.0444 |
| OIDN high | 41.77 | 41.90 | 41.86 | 0.0577 | 0.0033 | 0.0081 | 0.0448 |

<sub>Reference boil (same pixels, k = 8, static region): 0.0043.</sub>

| specular: settled PSNR dB per region | static | moving | disoccluded | dense geometry |
|---|---|---|---|---|
| raw 1-ray input | 36.08 | 22.85 | 36.79 | 33.19 |
| SVGF (paper, pinned) | 50.59 | 25.43 | 46.34 | 39.84 |
| **A-SVGF (shipped)** | **52.83** | **26.94** | **50.03** | **40.44** |
| OIDN fast | 40.09 | 25.61 | 40.18 | 38.11 |
| OIDN balanced | 41.35 | 26.06 | 42.07 | 38.91 |
| OIDN high | 43.28 | 26.70 | 43.45 | 39.70 |

| specular: boil (k = 8) per region | static | moving | disoccluded | dense geometry |
|---|---|---|---|---|
| reference | 0.0043 | 0.0438 | 0.0301 | 0.0120 |
| raw 1-ray input | 0.0128 | 0.0691 | 0.0399 | 0.0209 |
| SVGF (paper, pinned) | 0.0030 | 0.0332 | 0.0275 | 0.0111 |
| **A-SVGF (shipped)** | 0.0034 | 0.0391 | 0.0291 | 0.0117 |
| OIDN fast | 0.0088 | 0.0465 | 0.0269 | 0.0127 |
| OIDN balanced | 0.0080 | 0.0444 | 0.0282 | 0.0122 |
| OIDN high | 0.0070 | 0.0448 | 0.0245 | 0.0122 |

**shadows**

| filter | frame 0 dB | settled dB | all frames dB | FLIP | flicker | boil k=8 all | boil k=8 moving |
|---|---|---|---|---|---|---|---|
| raw 1-ray input | 16.11 | 16.55 | 16.42 | 0.0965 | 0.0603 | 0.1078 | 0.2895 |
| **shadows (shipped)** | **33.08** | **33.75** | **33.77** | **0.0180** | **0.0044** | **0.0129** | **0.0665** |
| OIDN fast | 30.20 | 30.53 | 30.46 | 0.0348 | 0.0089 | 0.0181 | 0.0929 |
| OIDN balanced | 31.41 | 31.69 | 31.62 | 0.0286 | 0.0076 | 0.0170 | 0.0920 |
| OIDN high | 31.50 | 31.75 | 31.69 | 0.0318 | 0.0075 | 0.0176 | 0.0957 |

<sub>Reference boil (same pixels, k = 8, static region): 0.0027.</sub>

| shadows: settled PSNR dB per region | static | moving | disoccluded | dense geometry | penumbra | penumbra, frame 0 |
|---|---|---|---|---|---|---|
| raw 1-ray input | 16.95 | 7.75 | 19.10 | 14.37 | 7.82 | 7.78 |
| **shadows (shipped)** | **42.89** | **21.12** | **36.30** | 24.85 | **29.69** | **26.32** |
| OIDN fast | 36.33 | 16.90 | 31.17 | 23.31 | 24.29 | 24.07 |
| OIDN balanced | 37.78 | 17.44 | 32.69 | 24.70 | 25.19 | 25.10 |
| OIDN high | 37.54 | 17.16 | 32.66 | **25.08** | 24.92 | 25.08 |

| shadows: boil (k = 8) per region | static | moving | disoccluded | dense geometry |
|---|---|---|---|---|
| reference | 0.0027 | 0.0673 | 0.0385 | 0.0428 |
| raw 1-ray input | 0.0995 | 0.2895 | 0.0444 | 0.1431 |
| **shadows (shipped)** | 0.0032 | 0.0665 | 0.0197 | 0.0354 |
| OIDN fast | 0.0080 | 0.0929 | 0.0463 | 0.0447 |
| OIDN balanced | 0.0070 | 0.0920 | 0.0391 | 0.0419 |
| OIDN high | 0.0072 | 0.0957 | 0.0401 | 0.0435 |

**AO**

| filter | frame 0 dB | settled dB | all frames dB | FLIP | flicker | boil k=8 all | boil k=8 moving |
|---|---|---|---|---|---|---|---|
| raw 1-ray input | 12.51 | 12.66 | 12.63 | 0.4179 | 0.3323 | 0.1577 | 0.2670 |
| AO SVGF (pinned) | 31.45 | 33.65 | 33.49 | 0.0313 | 0.0094 | 0.0098 | 0.0817 |
| **AO A-SVGF (shipped)** | 31.45 | **33.71** | **33.56** | **0.0296** | **0.0085** | **0.0073** | 0.0605 |
| OIDN fast | 31.81 | 31.94 | 31.91 | 0.0540 | 0.0114 | 0.0099 | 0.0572 |
| OIDN balanced | **33.13** | 33.26 | 33.22 | 0.0416 | 0.0108 | 0.0092 | **0.0515** |
| OIDN high | 33.07 | 33.18 | 33.16 | 0.0440 | 0.0103 | 0.0102 | 0.0664 |

<sub>Reference boil (same pixels, k = 8, static region): 0.0037.</sub>

| AO: settled PSNR dB per region | static | moving | disoccluded | dense geometry |
|---|---|---|---|---|
| raw 1-ray input | 13.08 | 9.14 | 12.08 | 10.21 |
| AO SVGF (pinned) | 43.34 | 14.42 | **36.23** | **27.83** |
| **AO A-SVGF (shipped)** | **44.38** | 14.33 | 35.89 | 27.68 |
| OIDN fast | 35.57 | 16.11 | 32.93 | 26.65 |
| OIDN balanced | 38.71 | 16.39 | 33.83 | 27.12 |
| OIDN high | 37.90 | **16.81** | 33.78 | 27.27 |

| AO: boil (k = 8) per region | static | moving | disoccluded | dense geometry |
|---|---|---|---|---|
| reference | 0.0037 | 0.0974 | 0.0308 | 0.0223 |
| raw 1-ray input | 0.1507 | 0.2670 | 0.2112 | 0.2099 |
| AO SVGF (pinned) | 0.0037 | 0.0817 | 0.0468 | 0.0220 |
| **AO A-SVGF (shipped)** | 0.0024 | 0.0605 | 0.0298 | 0.0170 |
| OIDN fast | 0.0063 | 0.0572 | 0.0365 | 0.0217 |
| OIDN balanced | 0.0056 | 0.0515 | 0.0351 | 0.0210 |
| OIDN high | 0.0052 | 0.0664 | 0.0409 | 0.0242 |

#### Moving occluders (three-knot-static, three-knot-orbit, sponza-move, bistro-move)

**diffuse**

| filter | frame 0 dB | settled dB | all frames dB | FLIP | flicker | boil k=8 all | boil k=8 moving |
|---|---|---|---|---|---|---|---|
| raw 1-ray input | 15.73 | 15.69 | 15.69 | 0.5578 | 0.1645 | 0.1602 | 0.1904 |
| SVGF (paper, pinned) | 33.34 | 37.39 | 37.05 | 0.0683 | 0.0071 | 0.0079 | 0.0265 |
| **A-SVGF (shipped)** | 34.70 | **37.79** | **37.46** | **0.0661** | **0.0067** | **0.0058** | **0.0184** |
| OIDN fast | 34.42 | 34.41 | 34.40 | 0.0990 | 0.0100 | 0.0089 | 0.0223 |
| OIDN balanced | 34.86 | 34.88 | 34.87 | 0.0954 | 0.0097 | 0.0083 | 0.0213 |
| OIDN high | **35.38** | 35.40 | 35.40 | 0.0881 | 0.0100 | 0.0093 | 0.0254 |

<sub>Reference boil (same pixels, k = 8, static region): 0.0051.</sub>

| diffuse: settled PSNR dB per region | static | moving | disoccluded | dense geometry |
|---|---|---|---|---|
| raw 1-ray input | 16.18 | 13.46 | 15.12 | 15.05 |
| SVGF (paper, pinned) | 42.84 | 24.66 | 36.46 | 32.72 |
| **A-SVGF (shipped)** | **43.08** | **24.79** | **36.91** | **33.16** |
| OIDN fast | 40.59 | 23.22 | 32.02 | 29.32 |
| OIDN balanced | 40.99 | 23.64 | 33.34 | 29.87 |
| OIDN high | 41.36 | 24.08 | 33.90 | 30.39 |

| diffuse: boil (k = 8) per region | static | moving | disoccluded | dense geometry |
|---|---|---|---|---|
| reference | 0.0051 | 0.0434 | 0.0141 | 0.0078 |
| raw 1-ray input | 0.1507 | 0.1904 | 0.1056 | 0.1729 |
| SVGF (paper, pinned) | 0.0024 | 0.0265 | 0.0252 | 0.0139 |
| **A-SVGF (shipped)** | 0.0017 | 0.0184 | 0.0213 | 0.0101 |
| OIDN fast | 0.0052 | 0.0223 | 0.0296 | 0.0142 |
| OIDN balanced | 0.0049 | 0.0213 | 0.0308 | 0.0132 |
| OIDN high | 0.0049 | 0.0254 | 0.0239 | 0.0151 |

**specular**

| filter | frame 0 dB | settled dB | all frames dB | FLIP | flicker | boil k=8 all | boil k=8 moving |
|---|---|---|---|---|---|---|---|
| raw 1-ray input | 34.68 | 34.76 | 34.74 | 0.1469 | 0.0093 | 0.0091 | 0.0840 |
| SVGF (paper, pinned) | 45.31 | 47.45 | 47.38 | 0.0361 | 0.0008 | **0.0017** | **0.0279** |
| **A-SVGF (shipped)** | **45.50** | **48.10** | **47.97** | **0.0352** | **0.0008** | 0.0019 | 0.0347 |
| OIDN fast | 42.13 | 42.03 | 42.03 | 0.0578 | 0.0027 | 0.0050 | 0.0446 |
| OIDN balanced | 42.80 | 42.76 | 42.75 | 0.0549 | 0.0026 | 0.0042 | 0.0418 |
| OIDN high | 43.79 | 43.62 | 43.62 | 0.0503 | 0.0024 | 0.0041 | 0.0443 |

<sub>Reference boil (same pixels, k = 8, static region): 0.0013.</sub>

| specular: settled PSNR dB per region | static | moving | disoccluded | dense geometry |
|---|---|---|---|---|
| raw 1-ray input | 36.10 | 18.83 | 35.34 | 32.31 |
| SVGF (paper, pinned) | 54.62 | 22.43 | 41.62 | 43.20 |
| **A-SVGF (shipped)** | **55.56** | **23.48** | **43.68** | **43.69** |
| OIDN fast | 46.11 | 21.06 | 36.42 | 39.43 |
| OIDN balanced | 46.73 | 21.52 | 37.86 | 40.17 |
| OIDN high | 48.08 | 22.07 | 38.51 | 40.76 |

| specular: boil (k = 8) per region | static | moving | disoccluded | dense geometry |
|---|---|---|---|---|
| reference | 0.0013 | 0.0423 | 0.0257 | 0.0040 |
| raw 1-ray input | 0.0081 | 0.0840 | 0.0366 | 0.0138 |
| SVGF (paper, pinned) | 0.0010 | 0.0279 | 0.0245 | 0.0036 |
| **A-SVGF (shipped)** | 0.0010 | 0.0347 | 0.0264 | 0.0041 |
| OIDN fast | 0.0046 | 0.0446 | 0.0247 | 0.0063 |
| OIDN balanced | 0.0038 | 0.0418 | 0.0261 | 0.0057 |
| OIDN high | 0.0037 | 0.0443 | 0.0217 | 0.0059 |

**shadows**

| filter | frame 0 dB | settled dB | all frames dB | FLIP | flicker | boil k=8 all | boil k=8 moving |
|---|---|---|---|---|---|---|---|
| raw 1-ray input | 19.06 | 18.82 | 18.83 | 0.0724 | 0.0417 | 0.1257 | 0.3856 |
| **shadows (shipped)** | 29.22 | **31.33** | **31.25** | **0.0229** | **0.0026** | **0.0339** | **0.1620** |
| OIDN fast | 28.82 | 28.73 | 28.75 | 0.0367 | 0.0065 | 0.0409 | 0.1974 |
| OIDN balanced | 29.77 | 29.66 | 29.68 | 0.0312 | 0.0059 | 0.0405 | 0.1974 |
| OIDN high | **30.13** | 29.99 | 30.00 | 0.0317 | 0.0059 | 0.0410 | 0.1973 |

<sub>Reference boil (same pixels, k = 8, static region): 0.0236.</sub>

| shadows: settled PSNR dB per region | static | moving | disoccluded | dense geometry | penumbra | penumbra, frame 0 |
|---|---|---|---|---|---|---|
| raw 1-ray input | 23.38 | 8.47 | 22.95 | 19.94 | 8.01 | 7.96 |
| **shadows (shipped)** | **38.34** | **20.22** | **33.74** | **26.38** | **24.60** | 21.17 |
| OIDN fast | 35.03 | 18.35 | 22.88 | 24.12 | 21.13 | 20.95 |
| OIDN balanced | 36.05 | 18.70 | 24.60 | 25.19 | 21.70 | **21.50** |
| OIDN high | 35.89 | 18.72 | 25.15 | 25.86 | 21.53 | 21.31 |

| shadows: boil (k = 8) per region | static | moving | disoccluded | dense geometry |
|---|---|---|---|---|
| reference | 0.0236 | 0.1770 | 0.0281 | 0.0343 |
| raw 1-ray input | 0.1134 | 0.3856 | 0.0262 | 0.1235 |
| **shadows (shipped)** | 0.0234 | 0.1620 | 0.0542 | 0.0336 |
| OIDN fast | 0.0271 | 0.1974 | 0.0526 | 0.0452 |
| OIDN balanced | 0.0265 | 0.1974 | 0.0443 | 0.0442 |
| OIDN high | 0.0265 | 0.1973 | 0.0451 | 0.0448 |

**AO**

| filter | frame 0 dB | settled dB | all frames dB | FLIP | flicker | boil k=8 all | boil k=8 moving |
|---|---|---|---|---|---|---|---|
| raw 1-ray input | 12.57 | 12.60 | 12.60 | 0.4076 | 0.3138 | 0.2701 | 0.4186 |
| AO SVGF (pinned) | 29.80 | 35.31 | 34.80 | 0.0404 | 0.0084 | 0.0104 | 0.0366 |
| **AO A-SVGF (shipped)** | 29.80 | **35.97** | **35.27** | **0.0374** | **0.0071** | **0.0065** | **0.0249** |
| OIDN fast | 29.22 | 29.19 | 29.20 | 0.0752 | 0.0155 | 0.0196 | 0.0485 |
| OIDN balanced | 30.46 | 30.39 | 30.40 | 0.0636 | 0.0148 | 0.0190 | 0.0467 |
| OIDN high | **30.46** | 30.42 | 30.43 | 0.0641 | 0.0155 | 0.0220 | 0.0562 |

<sub>Reference boil (same pixels, k = 8, static region): 0.0049.</sub>

| AO: settled PSNR dB per region | static | moving | disoccluded | dense geometry |
|---|---|---|---|---|
| raw 1-ray input | 13.33 | 9.09 | 12.48 | 11.16 |
| AO SVGF (pinned) | 42.15 | **23.15** | **34.28** | 30.96 |
| **AO A-SVGF (shipped)** | **43.19** | 23.12 | 33.80 | **31.57** |
| OIDN fast | 34.65 | 21.60 | 27.59 | 24.98 |
| OIDN balanced | 37.15 | 21.89 | 27.97 | 25.65 |
| OIDN high | 36.80 | 21.66 | 27.99 | 25.78 |

| AO: boil (k = 8) per region | static | moving | disoccluded | dense geometry |
|---|---|---|---|---|
| reference | 0.0049 | 0.0362 | 0.0293 | 0.0106 |
| raw 1-ray input | 0.2463 | 0.4186 | 0.2234 | 0.3153 |
| AO SVGF (pinned) | 0.0044 | 0.0366 | 0.0435 | 0.0178 |
| **AO A-SVGF (shipped)** | 0.0025 | 0.0249 | 0.0287 | 0.0116 |
| OIDN fast | 0.0075 | 0.0485 | 0.0434 | 0.0316 |
| OIDN balanced | 0.0068 | 0.0467 | 0.0316 | 0.0309 |
| OIDN high | 0.0063 | 0.0562 | 0.0397 | 0.0361 |

#### Golden scenes (golden-G3-orbit Sponza orbit, golden-G4-pan-light-on Bistro pan + light on; 4096-spp references)

**diffuse**

| filter | frame 0 dB | settled dB | all frames dB | FLIP | flicker | boil k=8 all | boil k=8 moving |
|---|---|---|---|---|---|---|---|
| raw 1-ray input | 15.66 | 14.36 | 14.50 | 0.6734 | 0.1721 | 0.1951 | 0.2150 |
| SVGF (paper, pinned) | 27.46 | 29.07 | 29.07 | 0.1667 | 0.0196 | **0.0472** | **0.0713** |
| **A-SVGF (shipped)** | 29.15 | **30.63** | **30.57** | **0.1582** | **0.0171** | 0.0513 | 0.0737 |
| OIDN fast | 29.04 | 28.83 | 28.87 | 0.2070 | 0.0244 | 0.0566 | 0.0751 |
| OIDN balanced | **29.77** | 29.52 | 29.55 | 0.1951 | 0.0227 | 0.0569 | 0.0760 |
| OIDN high | 29.71 | 29.65 | 29.67 | 0.1928 | 0.0224 | 0.0580 | 0.0792 |

<sub>Reference boil (same pixels, k = 8, static region): 0.0479.</sub>

| diffuse: settled PSNR dB per region | static | moving | disoccluded | dense geometry |
|---|---|---|---|---|
| raw 1-ray input | 15.14 | 13.32 | 16.33 | 13.94 |
| SVGF (paper, pinned) | 35.69 | 23.38 | 31.19 | 30.05 |
| **A-SVGF (shipped)** | **37.00** | **25.49** | **32.53** | **30.86** |
| OIDN fast | 35.49 | 24.66 | 30.94 | 28.10 |
| OIDN balanced | 36.22 | 25.13 | 31.48 | 28.88 |
| OIDN high | 36.22 | 25.34 | 31.68 | 28.95 |

| diffuse: boil (k = 8) per region | static | moving | disoccluded | dense geometry |
|---|---|---|---|---|
| reference | 0.0479 | 0.0810 | 0.0647 | 0.0541 |
| raw 1-ray input | 0.1851 | 0.2150 | 0.2306 | 0.2001 |
| SVGF (paper, pinned) | 0.0320 | 0.0713 | 0.0816 | 0.0497 |
| **A-SVGF (shipped)** | 0.0391 | 0.0737 | 0.0755 | 0.0518 |
| OIDN fast | 0.0480 | 0.0751 | 0.0651 | 0.0576 |
| OIDN balanced | 0.0482 | 0.0760 | 0.0598 | 0.0578 |
| OIDN high | 0.0471 | 0.0792 | 0.0698 | 0.0598 |

**specular**

| filter | frame 0 dB | settled dB | all frames dB | FLIP | flicker | boil k=8 all | boil k=8 moving |
|---|---|---|---|---|---|---|---|
| raw 1-ray input | 35.28 | 35.27 | 35.22 | 0.1455 | 0.0122 | 0.0273 | 0.1236 |
| SVGF (paper, pinned) | 43.18 | 43.94 | 43.93 | 0.0734 | 0.0041 | **0.0052** | **0.0219** |
| **A-SVGF (shipped)** | **44.06** | **44.40** | **44.35** | **0.0718** | **0.0040** | 0.0065 | 0.0279 |
| OIDN fast | 42.49 | 42.59 | 42.50 | 0.0788 | 0.0047 | 0.0128 | 0.0619 |
| OIDN balanced | 42.89 | 43.06 | 42.96 | 0.0772 | 0.0045 | 0.0120 | 0.0610 |
| OIDN high | 43.77 | 43.61 | 43.56 | 0.0746 | 0.0043 | 0.0114 | 0.0596 |

<sub>Reference boil (same pixels, k = 8, static region): 0.0087.</sub>

| specular: settled PSNR dB per region | static | moving | disoccluded | dense geometry |
|---|---|---|---|---|
| raw 1-ray input | 35.93 | 21.54 | 37.82 | 36.81 |
| SVGF (paper, pinned) | 47.29 | 28.38 | 46.85 | 45.22 |
| **A-SVGF (shipped)** | **47.60** | **28.97** | 47.47 | 45.46 |
| OIDN fast | 44.84 | 27.08 | 46.84 | 44.82 |
| OIDN balanced | 45.34 | 27.42 | 47.23 | 45.12 |
| OIDN high | 45.89 | 27.99 | **47.62** | **45.56** |

| specular: boil (k = 8) per region | static | moving | disoccluded | dense geometry |
|---|---|---|---|---|
| reference | 0.0087 | 0.0489 | 0.0163 | 0.0071 |
| raw 1-ray input | 0.0258 | 0.1236 | 0.0376 | 0.0186 |
| SVGF (paper, pinned) | 0.0037 | 0.0219 | 0.0151 | 0.0048 |
| **A-SVGF (shipped)** | 0.0052 | 0.0279 | 0.0160 | 0.0053 |
| OIDN fast | 0.0128 | 0.0619 | 0.0151 | 0.0058 |
| OIDN balanced | 0.0117 | 0.0610 | 0.0165 | 0.0059 |
| OIDN high | 0.0107 | 0.0596 | 0.0172 | 0.0062 |

**shadows**

| filter | frame 0 dB | settled dB | all frames dB | FLIP | flicker | boil k=8 all | boil k=8 moving |
|---|---|---|---|---|---|---|---|
| raw 1-ray input | 20.38 | 18.92 | 19.07 | 0.0640 | 0.0464 | 0.0968 | 0.3084 |
| **shadows (shipped)** | **27.56** | **26.85** | **26.88** | **0.0396** | **0.0156** | **0.0383** | **0.1075** |
| OIDN fast | 25.50 | 25.02 | 25.08 | 0.0527 | 0.0225 | 0.0441 | 0.1381 |
| OIDN balanced | 26.85 | 26.15 | 26.23 | 0.0467 | 0.0196 | 0.0447 | 0.1430 |
| OIDN high | 27.46 | 26.76 | 26.83 | 0.0434 | 0.0178 | 0.0458 | 0.1482 |

<sub>Reference boil (same pixels, k = 8, static region): 0.0102.</sub>

| shadows: settled PSNR dB per region | static | moving | disoccluded | dense geometry | penumbra | penumbra, frame 0 |
|---|---|---|---|---|---|---|
| raw 1-ray input | 19.20 | 7.99 | 22.94 | 22.07 | 8.12 | 8.12 |
| **shadows (shipped)** | 35.47 | **15.56** | **31.64** | 26.30 | **20.73** | **18.33** |
| OIDN fast | 34.65 | 14.67 | 29.36 | 24.28 | 18.23 | 17.24 |
| OIDN balanced | **35.79** | 15.33 | 30.18 | 25.69 | 18.82 | 17.88 |
| OIDN high | 35.75 | 15.32 | 30.50 | **26.74** | 18.61 | 17.69 |

| shadows: boil (k = 8) per region | static | moving | disoccluded | dense geometry |
|---|---|---|---|---|
| reference | 0.0102 | 0.1341 | 0.1030 | 0.0562 |
| raw 1-ray input | 0.0832 | 0.3084 | 0.1539 | 0.0822 |
| **shadows (shipped)** | 0.0083 | 0.1075 | 0.0881 | 0.0469 |
| OIDN fast | 0.0136 | 0.1381 | 0.0925 | 0.0512 |
| OIDN balanced | 0.0130 | 0.1430 | 0.0988 | 0.0517 |
| OIDN high | 0.0133 | 0.1482 | 0.1018 | 0.0526 |

**AO**

| filter | frame 0 dB | settled dB | all frames dB | FLIP | flicker | boil k=8 all | boil k=8 moving |
|---|---|---|---|---|---|---|---|
| raw 1-ray input | 12.81 | 12.64 | 12.66 | 0.4058 | 0.2725 | 0.1636 | 0.2367 |
| AO SVGF (pinned) | 24.87 | **28.61** | **28.37** | 0.0752 | 0.0235 | 0.0314 | 0.0863 |
| **AO A-SVGF (shipped)** | 24.87 | 28.59 | 28.37 | **0.0748** | **0.0224** | **0.0271** | 0.0735 |
| OIDN fast | 24.76 | 25.58 | 25.45 | 0.1079 | 0.0390 | 0.0309 | **0.0713** |
| OIDN balanced | 25.34 | 26.31 | 26.16 | 0.1001 | 0.0357 | 0.0303 | 0.0724 |
| OIDN high | **25.52** | 26.45 | 26.30 | 0.0981 | 0.0349 | 0.0350 | 0.0869 |

<sub>Reference boil (same pixels, k = 8, static region): 0.0079.</sub>

| AO: settled PSNR dB per region | static | moving | disoccluded | dense geometry |
|---|---|---|---|---|
| raw 1-ray input | 13.62 | 10.06 | 12.54 | 12.31 |
| AO SVGF (pinned) | 37.84 | 18.73 | **30.86** | **29.41** |
| **AO A-SVGF (shipped)** | **37.91** | 18.56 | 30.81 | 29.39 |
| OIDN fast | 33.54 | 17.99 | 27.73 | 24.60 |
| OIDN balanced | 34.93 | 18.44 | 28.62 | 25.38 |
| OIDN high | 34.94 | **18.87** | 28.84 | 25.32 |

| AO: boil (k = 8) per region | static | moving | disoccluded | dense geometry |
|---|---|---|---|---|
| reference | 0.0079 | 0.0838 | 0.0602 | 0.0317 |
| raw 1-ray input | 0.1449 | 0.2367 | 0.1821 | 0.1727 |
| AO SVGF (pinned) | 0.0061 | 0.0863 | 0.0578 | 0.0340 |
| **AO A-SVGF (shipped)** | 0.0044 | 0.0735 | 0.0516 | 0.0298 |
| OIDN fast | 0.0114 | 0.0713 | 0.0558 | 0.0366 |
| OIDN balanced | 0.0104 | 0.0724 | 0.0554 | 0.0354 |
| OIDN high | 0.0099 | 0.0869 | 0.0688 | 0.0411 |

#### Per capture: pooled PSNR dB, all frames (frame 0 in brackets)

**diffuse**

| capture | raw 1-ray input | SVGF (paper, pinned) | **A-SVGF (shipped)** | OIDN fast | OIDN balanced | OIDN high |
|---|---|---|---|---|---|---|
| std540-orbit | 16.42 (16.43) | 38.09 (35.90) | 38.31 (35.97) | 34.32 (33.89) | 34.33 (33.67) | 35.76 (35.38) |
| std540-pan | 15.34 (15.20) | 38.04 (36.12) | 38.34 (36.65) | 35.37 (35.45) | 35.89 (35.84) | 36.87 (36.88) |
| std540-light | 16.31 (16.44) | 38.84 (37.50) | 39.19 (37.61) | 34.72 (34.48) | 34.71 (34.50) | 36.13 (35.96) |
| std540-thin | 16.69 (16.67) | 34.10 (33.34) | 34.14 (33.31) | 31.64 (31.65) | 31.75 (31.62) | 32.53 (32.49) |
| std540-glossy | 16.65 (16.63) | 38.36 (36.19) | 38.55 (36.27) | 35.19 (35.04) | 35.86 (35.45) | 36.64 (36.38) |
| std540-cut | 14.16 (14.84) | 38.30 (36.91) | 38.53 (36.99) | 35.59 (35.03) | 35.62 (34.96) | 36.67 (36.38) |
| std540-object | 16.26 (16.32) | 36.63 (35.22) | 36.80 (35.35) | 32.82 (32.78) | 33.15 (32.98) | 34.42 (34.27) |
| three-orbit | 16.88 (17.02) | 39.89 (37.62) | 40.08 (38.95) | 38.50 (38.41) | 38.80 (38.72) | 39.80 (39.64) |
| three-pan | 17.09 (16.84) | 40.27 (38.05) | 40.86 (39.56) | 38.94 (38.57) | 39.26 (38.80) | 40.01 (39.79) |
| three-knot-static | 15.12 (15.12) | 41.81 (38.17) | 42.22 (39.12) | 38.15 (38.19) | 38.46 (38.47) | 39.47 (39.43) |
| three-knot-orbit | 16.88 (17.02) | 39.88 (37.62) | 40.06 (38.95) | 38.52 (38.41) | 38.80 (38.72) | 39.78 (39.64) |
| sponza-move | 13.68 (13.70) | 32.58 (28.41) | 33.23 (30.05) | 30.02 (30.11) | 30.68 (30.74) | 30.87 (31.00) |
| bistro-move | 17.10 (17.06) | 33.91 (29.16) | 34.34 (30.70) | 30.90 (30.97) | 31.53 (31.52) | 31.47 (31.44) |
| golden-G3-orbit | 16.23 (16.86) | 31.27 (28.17) | 31.85 (29.95) | 30.07 (30.43) | 30.74 (31.14) | 30.75 (31.06) |
| golden-G4-pan-light-on | 12.76 (14.46) | 26.87 (26.74) | 29.30 (28.34) | 27.67 (27.66) | 28.37 (28.41) | 28.59 (28.35) |

**specular**

| capture | raw 1-ray input | SVGF (paper, pinned) | **A-SVGF (shipped)** | OIDN fast | OIDN balanced | OIDN high |
|---|---|---|---|---|---|---|
| std540-orbit | 13.66 (13.74) | 32.28 (31.78) | 32.94 (32.60) | 31.06 (31.54) | 31.17 (31.68) | 31.82 (32.29) |
| std540-pan | 17.97 (17.41) | 33.83 (35.29) | 35.09 (35.63) | 34.88 (34.86) | 35.44 (35.45) | 35.64 (35.59) |
| std540-light | 13.75 (13.83) | 32.81 (30.93) | 33.32 (31.64) | 29.25 (29.36) | 29.25 (29.35) | 30.07 (30.22) |
| std540-thin | 16.74 (16.71) | 34.18 (32.88) | 34.26 (33.21) | 32.70 (32.71) | 32.95 (32.98) | 33.32 (33.31) |
| std540-glossy | 18.82 (18.91) | 34.97 (35.16) | 35.72 (35.38) | 35.05 (35.21) | 35.51 (35.71) | 35.77 (35.92) |
| std540-cut | 16.54 (15.66) | 33.37 (32.50) | 34.08 (33.12) | 32.29 (31.31) | 32.43 (31.43) | 33.08 (32.11) |
| std540-object | 14.40 (14.57) | 32.76 (31.53) | 33.67 (32.20) | 31.30 (31.34) | 31.69 (31.65) | 32.19 (32.07) |
| three-orbit | 34.79 (34.41) | 44.33 (43.56) | 45.32 (43.52) | 39.47 (39.41) | 40.31 (40.07) | 41.71 (41.77) |
| three-pan | 35.87 (35.22) | 46.11 (45.12) | 47.58 (45.31) | 39.03 (39.14) | 40.35 (40.44) | 42.02 (41.78) |
| three-knot-static | 32.92 (32.96) | 45.65 (42.22) | 45.98 (42.07) | 35.86 (35.94) | 37.08 (37.24) | 36.87 (37.09) |
| three-knot-orbit | 34.81 (34.41) | 44.26 (43.56) | 45.26 (43.52) | 39.48 (39.41) | 40.34 (40.07) | 41.72 (41.77) |
| sponza-move | 37.27 (37.39) | 50.01 (49.35) | 51.00 (49.83) | 48.40 (48.70) | 49.03 (49.30) | 49.87 (50.17) |
| bistro-move | 33.95 (33.95) | 49.61 (46.10) | 49.63 (46.59) | 44.39 (44.48) | 44.55 (44.58) | 46.04 (46.11) |
| golden-G3-orbit | 38.08 (38.89) | 47.70 (47.13) | 47.89 (48.28) | 46.77 (48.07) | 47.01 (48.26) | 47.32 (48.66) |
| golden-G4-pan-light-on | 32.36 (31.66) | 40.15 (39.23) | 40.80 (39.83) | 38.22 (36.92) | 38.92 (37.53) | 39.80 (38.88) |

**shadows**

| capture | raw 1-ray input | **shadows (shipped)** | OIDN fast | OIDN balanced | OIDN high |
|---|---|---|---|---|---|
| std540-orbit | 18.81 (18.48) | 36.52 (34.39) | 28.70 (28.65) | 30.02 (30.08) | 30.32 (30.20) |
| std540-pan | 17.82 (17.92) | 39.19 (35.16) | 31.67 (31.74) | 33.42 (33.22) | 33.23 (33.21) |
| std540-light | 17.67 (18.98) | 35.29 (34.85) | 29.50 (29.51) | 31.26 (31.14) | 31.71 (31.60) |
| std540-thin | 15.98 (15.96) | 35.61 (32.69) | 29.13 (29.34) | 30.73 (31.00) | 30.47 (30.74) |
| std540-glossy | 19.28 (19.43) | 39.52 (35.36) | 33.23 (33.22) | 34.96 (34.94) | 35.02 (34.92) |
| std540-cut | 18.03 (18.16) | 37.75 (34.59) | 30.92 (30.39) | 32.23 (31.59) | 32.40 (31.88) |
| std540-object | 16.61 (16.97) | 35.33 (34.32) | 29.20 (29.20) | 30.98 (30.95) | 30.82 (30.83) |
| three-orbit | 16.05 (16.34) | 33.63 (33.05) | 30.28 (30.29) | 31.45 (31.56) | 31.53 (31.59) |
| three-pan | 16.79 (15.88) | 33.91 (33.10) | 30.65 (30.10) | 31.80 (31.27) | 31.86 (31.41) |
| three-knot-static | 16.85 (16.78) | 37.13 (31.16) | 32.09 (32.03) | 33.09 (33.01) | 33.02 (32.97) |
| three-knot-orbit | 16.06 (16.34) | 33.62 (33.08) | 30.30 (30.31) | 31.48 (31.57) | 31.56 (31.61) |
| sponza-move | 17.99 (18.08) | 29.88 (28.29) | 27.37 (27.43) | 28.23 (28.28) | 28.62 (28.73) |
| bistro-move | 24.42 (25.05) | 24.38 (24.36) | 25.21 (25.52) | 25.92 (26.22) | 26.83 (27.22) |
| golden-G3-orbit | 20.90 (22.12) | 29.64 (30.24) | 27.46 (27.97) | 28.63 (29.23) | 29.16 (29.84) |
| golden-G4-pan-light-on | 17.25 (18.64) | 24.13 (24.89) | 22.70 (23.03) | 23.83 (24.46) | 24.51 (25.08) |

**AO**

| capture | raw 1-ray input | AO SVGF (pinned) | **AO A-SVGF (shipped)** | OIDN fast | OIDN balanced | OIDN high |
|---|---|---|---|---|---|---|
| three-orbit | 12.52 (12.41) | 33.43 (32.06) | 33.39 (32.07) | 31.82 (31.96) | 33.07 (33.35) | 33.12 (33.26) |
| three-pan | 12.74 (12.60) | 33.55 (30.83) | 33.72 (30.84) | 32.01 (31.66) | 33.37 (32.91) | 33.19 (32.89) |
| three-knot-static | 11.99 (11.99) | 39.96 (34.38) | 40.78 (34.39) | 32.65 (32.64) | 34.69 (34.71) | 34.63 (34.67) |
| three-knot-orbit | 12.52 (12.41) | 33.43 (32.06) | 33.40 (32.07) | 31.82 (31.96) | 33.07 (33.35) | 33.12 (33.26) |
| sponza-move | 13.37 (13.37) | 34.47 (28.28) | 35.09 (28.27) | 28.06 (28.01) | 28.77 (28.74) | 28.90 (28.85) |
| bistro-move | 12.49 (12.50) | 31.35 (24.48) | 31.84 (24.47) | 24.26 (24.25) | 25.05 (25.04) | 25.05 (25.07) |
| golden-G3-orbit | 13.44 (13.41) | 30.67 (27.11) | 30.63 (27.11) | 27.34 (27.43) | 28.05 (28.09) | 28.15 (28.24) |
| golden-G4-pan-light-on | 11.87 (12.20) | 26.07 (22.64) | 26.10 (22.63) | 23.57 (22.09) | 24.27 (22.59) | 24.44 (22.80) |

#### OIDN models used

- oidn-balanced ao: rt_hdr_calb_cnrm (balanced, aux one, subgroupMatrix true)
- oidn-balanced diffuse: rt_hdr_calb_cnrm (balanced, aux one, subgroupMatrix true)
- oidn-balanced specular: rt_hdr_calb_cnrm (balanced, aux one, subgroupMatrix true)
- oidn-balanced visibility: rt_hdr_calb_cnrm (balanced, aux one, subgroupMatrix true)
- oidn-fast ao: rt_hdr_calb_cnrm_small (fast, aux one, subgroupMatrix true)
- oidn-fast diffuse: rt_hdr_calb_cnrm_small (fast, aux one, subgroupMatrix true)
- oidn-fast specular: rt_hdr_calb_cnrm_small (fast, aux one, subgroupMatrix true)
- oidn-fast visibility: rt_hdr_calb_cnrm_small (fast, aux one, subgroupMatrix true)
- oidn-high ao: rt_hdr_calb_cnrm_large (high, aux one, subgroupMatrix true)
- oidn-high diffuse: rt_hdr_calb_cnrm_large (high, aux one, subgroupMatrix true)
- oidn-high specular: rt_hdr_calb_cnrm_large (high, aux one, subgroupMatrix true)
- oidn-high visibility: rt_hdr_calb_cnrm_large (high, aux one, subgroupMatrix true)

#### Cost (std1080-orbit, 1920×1080)

| configuration | fastest frame ms | best round median ms | wall fastest / best median |
|---|---|---|---|
| OIDN high, fp32 (large weights) | 215.50 | 271.20 | 314.30 / 356.20 |
| OIDN balanced, fp32 (base weights) | 85.80 | 89.80 | 167.90 / 169.40 |
| OIDN fast, fp32 (small weights) | 45.20 | 45.70 | 117.00 / 123.00 |
| OIDN high, fp16 | 218.00 | 253.50 | 333.90 / 383.80 |
| OIDN fast, fp16 | 36.70 | 37.30 | 122.90 / 131.10 |
| ours: A-SVGF diffuse + specular (both signals, shipped) | 4.33 | 4.75 | 5.80 / 6.50 |
| ours: shadows (shipped) | 0.65 | 0.72 | 1.70 / 1.80 |
| ours: AO (occlusion A-SVGF, shipped) | 1.86 | 2.43 | 3.00 / 3.80 |

Rounds (load average 1 / 5 / 15 min, other headless Chromes before the round):

- round 1 at 2026-11-19T03:54:17.978Z: load 13.8 / 11.1 / 9.9, other headless Chromes 2
- round 2 at 2026-11-19T03:55:39.844Z: load 9.9 / 10.4 / 9.7, other headless Chromes 0
- round 3 at 2026-11-19T03:58:21.179Z: load 12.5 / 10.7 / 9.9, other headless Chromes 1

## Visual A/B on the review bench

`yarn workspace three-temporal review`, then `http://127.0.0.1:5262/review.html`: the **E2b** card at the top ("OIDN 2
(single frame) vs our real-time filters"). "Load the flip test" sets A = the shipped real-time filters and B = OIDN high;
the card's buttons switch B between fast, balanced and high; the "at" / "also" buttons jump to the places listed below.
Any side can also be set from the `oidn.engine` row of the options table. Details: [REVIEW-BENCH.md](REVIEW-BENCH.md)
"OIDN on a side".

**How OIDN runs there.** OIDN takes tens to hundreds of ms per signal, so with OIDN on a side the page runs in
**lockstep**: each frame is rendered offscreen, OIDN denoises that frame's 1-ray inputs, then the same frame is shown on
both sides. Motion therefore slows to a few frames per second (about 2–4 on the shared Mac with OIDN fast and the lit
view; high is slower), and both sides always show the same frame. A note under the canvas says this and shows the rate.
Pausing (Space) keeps rendering new 1-ray frames: the real-time side keeps converging, OIDN denoises each frame alone.
The ms the bench shows for OIDN is not its cost (no subgroup matrices on the renderer's device, four signals at once).

Where it shows best (the card's jump buttons):

- **corner / orbit / diffuse** (the card's default): the real scene where OIDN high led at frame 0 in E-2. With history
  A-SVGF is ahead (+0.7 dB settled); look at texture and contact detail, and at OIDN's flat, smudged walls.
- **corner, camera cut (K), AO** (or diffuse): the first frames after a cut, where nobody has history; OIDN balanced /
  high lead AO by 1–2 dB and diffuse by ~0.5 dB there, for a few frames.
- **knot / knot-orbit / shadow**: the moving occluder under an orbit; OIDN's moving shadow boils above the reference's own
  noise, ours stays below it.
- **bistro / bistro-move / shadow**: the one case where OIDN wins with history (ours is no better than the raw input
  there); worth a look so the A/B isn't one-sided.
- **sponza / sponza-orbit / lit**: the lit composite on a large scene.

## Reproduce

```sh
W=<work dir>; mkdir -p $W/captures   # symlink or copy the kept captures into $W/captures
RT_CAPTURE_DIR=$W BASE=http://127.0.0.1:5397/ node examples/realtime-denoiser/run-headless.mjs --serve --set=standard
node tools/scorecard/oidn-vs-svgf.mjs --work $W            # replays (GPU lock per capture) + scoring, ~1 h
node tools/scorecard/oidn-cost.mjs --work $W --rounds 3    # 1080p cost, GPU lock per round
node tools/scorecard/oidn-vs-svgf-report.mjs > tables.md   # the tables above
```
