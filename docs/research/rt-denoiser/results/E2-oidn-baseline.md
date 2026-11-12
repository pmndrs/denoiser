# E-2: OIDN 2 single-frame baseline on our captures

_2026-10-25, e2 agent (evaluator / implementer, RULES.md rule 8: no NRD code, README or port read).
SPEC §13: OIDN is a **baseline** scored against the same converged references as every other
filter, never the reference. Every arm below was replayed fresh in one server at HEAD 7a8b980,
with denoiser/realtime pinned to a `git archive` snapshot of that commit (`RT_REALTIME_SRC`)._

## Conclusion first

- **OIDN 2 doesn't lead.** With history, our real-time filters beat it on the analytic test bed
  on every signal: diffuse 37.60 (A-SVGF `auto`) vs 35.58 dB, specular 34.13 vs 33.13, shadows
  35.47 vs 32.00 (7 paths, 960×540, pooled). On the real three.js scene they draw level on
  diffuse (39.84 / 40.39 vs 39.80 / 40.01 on `three-orbit` / `three-pan`) and AO (SVGF on ĥ
  33.43 / 33.55 vs 33.12 / 33.19). They stay well ahead on SSR specular (45.32 / 47.58 vs
  41.71 / 42.02). **One exception: real-scene shadows.** OIDN scores +0.6 / +0.8 dB over our
  shadow filter (31.53 / 31.86 vs 30.93 / 31.10), but its FLIP is 36 % worse (0.0318 vs 0.0233) and
  its penumbra is 1.6–2.0 dB worse. OIDN "high" is the largest weights (`rt_hdr_calb_cnrm_large`)
  in fp32 with clean albedo + normal auxiliaries. The package default (`fast`, `*_small`) scores
  another 0.8–3.0 dB lower everywhere.
- **Single frame, no history for anyone** (frame 0 after a reset): on the test bed SVGF alone
  already matches or beats OIDN: diffuse 36.00 vs 35.36 dB, specular (A-SVGF) 33.20 vs 32.81,
  our shadows 33.07 vs 31.75. On the real scene, OIDN leads at frame 0 on diffuse by 1.9 dB
  (39.72 vs 37.83) and on shadows by 0.9 dB (31.50 vs 30.56). Our filters close that gap
  within a few frames of history (settled frames: diffuse 40.00 / 40.72 vs 39.81 / 40.04). So
  the real-time filters reach OIDN's single-frame quality through accumulation, not through a
  better spatial filter. OIDN's spatial filter is the better one on the real scene but not on the
  test bed. A likely reason, not tested: blue-noise 1-spp input suits wide à-trous footprints
  (LESSONS), while OIDN was trained on other noise.
- **Flicker without history:** OIDN removes 87–97 % of the input's frame-to-frame error change (65 % on SSR).
  Even so it flickers **1.6–2.0× as much as our filters on the test bed** (diffuse 0.0077 vs A-SVGF
  0.0039, specular 0.0075 vs 0.0044, shadows 0.0065 vs 0.0040). On the real scene the factor is
  1.1–1.2× for diffuse, shadows and AO and 2.9× for SSR specular (0.0032 vs 0.0011). FLIP agrees.
  OIDN is worse than A-SVGF on every signal and both scenes (test-bed diffuse 0.082 vs 0.056).
  Its output is smooth but too flat: it loses contact shadows and GI colour bleeding.
- **Cost gap: about two orders of magnitude.** At 1080p, OIDN high costs **205–239 ms per
  signal**, and the package default (`fast`) 44–49 ms. That is WGSL fp32 with subgroup-matrix on
  the M5 Pro: fastest frame and best run's median (Cost). fp16 brings it to 165 / 42 ms. Our
  diffuse + specular costs 3.8–3.9 ms for **both** signals in the same replay (4.0–4.2 ms on the
  test-bed bench), and shadows 0.6 ms. Per denoised frame that is ~105× for OIDN high and
  ~22× for the fastest OIDN (fast fp16) on diffuse + specular, and ~340× / 70× on shadows.
  Native Metal OIDN would still be ~14× our joint budget per signal (54 ms for large weights,
  docs/status/eval-2026-10-08-quiet.md). OIDN is a quality yardstick here, not a real-time contender.
- **Implication for OIDN 3 real-time in `denoiser/realtime` (PLAN §1):** a single-frame OIDN 2
  is not the bar our filters have to clear. They already clear it on the test bed and match it
  on the real scene except shadows. A real-time OIDN 3 class earns its place only if it beats
  these numbers *with* history and flicker in the A-SVGF range (≤ 0.004–0.006 on these metrics),
  at a cost near the 4 ms budget. The OIDN arm built here (`oidn` registry entry, same captures,
  same metrics) is the harness to score it with when it ships. Our 1-spp **demodulated** inputs
  are OIDN-friendly only with clean aux: albedo 1 + normal gave +1.4–1.8 dB over color-only. Any
  OIDN-family real-time model should get the same demodulated signal plus normals.

## Setup

| | |
|---|---|
| GPU / browser | Apple M5 Pro, HeadlessChrome 155 (`--use-angle=metal`), WebGPU |
| Captures | `std540-{orbit,pan,light,thin,glossy,cut,object}` (960×540, 16–24 frames, 256-spp references), `std1080-orbit` (8 frames), real scene `three-orbit` (40) / `three-pan` (32) (1024–2048-ray references, SSR specular, `ao_ref`) |
| Code | HEAD **7a8b980**; `packages/denoiser-realtime` + `denoiser-core` from a `git archive` of it via `RT_REALTIME_SRC`; OIDN from the worktree's `packages/denoiser-core` / `denoiser-wgsl` src (unchanged since faade1e) and `packages/denoiser/tzas` |
| Server | own Vite on 127.0.0.1:5395 for `tools/rt-capture` (`RT_NO_HMR=1`); the test bed was not used |
| Arms (output `e2-<id>`) | `oidn` (high), `oidn-default` (fast); `svgf`, `svgf-auto`, `recurrent` (joint diffuse + specular); `shadows`, `ffx-shadows`; `ffx-reflections`; `accumulate-32`; AO (real scene only): `occlusion-svgf`, `occlusion-svgf-auto`, `occlusion-recurrent`, `occlusion-accumulate-32` |
| Scoring | `tools/rt-capture/compare.mjs` (pooled PSNR, settled, penumbra, flicker) and `examples/three-temporal/score-captures.mjs` (same metric code, plus LDR-FLIP at the test bed's viewing condition every 4th frame, and AO against `ao_ref`). "mean" = mean over the 7 std540 paths of each path's pooled PSNR. Flicker = mean fixed-pixel \|Δ error\| between consecutive frames (CAPTURE-FORMAT) |
| Not scored | AO on the std captures (they have no AO reference; the test bed renders it live) and SO (no reference anywhere) |

Raw data: [data/e2-oidn-baseline.json](data/e2-oidn-baseline.json) (every row per capture,
signal and arm, the per-frame PSNR, OIDN per-signal timings and models).

## The OIDN arm

**Adapter** (`tools/rt-capture`, additive). `ReplayDenoiser` gets an optional
`dispatchAsync(frame): Promise<outputs>`, and `replay()` awaits it instead of `dispatch()` before
the readback. It also gets an optional `info()` (written to run.json as `denoiserInfo`), and
`DenoiserEntry` gets `offline?: true` (GPU warm-up defaults to 0). Synchronous entries take the
unchanged path. Check: `svgf` and `shadows` on `std540-orbit` replayed before and after the
change gave **byte-identical outputs (48 / 48 files)**, and their solo timings are unchanged
(Cost section). The entries live in `src/oidn-entries.ts` and are registered by the replay
page (`src/main.ts`) only. The test bed never loads them: its live loop is synchronous, and their
`dispatch()` throws.

**How it runs.** It uses the package's single-image `Denoiser`
(`packages/denoiser-core`) on `WgslRuntime`, which is what `AutoRuntime` picks when WebNN is
unavailable (headless Chrome here). The network runs on its own max-limits device, with the
subgroup-matrix feature present. Per frame and signal: the inputs are read back from the replay
device and uploaded, then `denoiseTextures({ color, albedo, normal, hdr, output: rgba16float })`
is awaited, and the result is written back to a replay texture. Timings are wall-clock ms of
that `denoiseTextures` call (extract + network + resolve, awaited), without the cross-device
copies, median over frames ≥ 1.

**Inputs, decided on `std540-orbit` (16 frames, high, pooled PSNR dB):**

| aux (OIDN takes a normal only together with an albedo) | diffuse | specular | shadows (via HDR) |
|---|---|---|---|
| none (color only, `rt_hdr`) | 33.94 | 30.39 | 28.86 |
| **albedo = 1 + world normal** (`rt_hdr_calb_cnrm[_large]`, clean aux) | **35.76** | **31.82** | **30.32** |
| capture albedo + normal | 33.07 | 31.56 | 29.46 |

- **Diffuse, specular:** demodulated HDR radiance as HDR color, so OIDN applies its PU transfer
  and autoexposure. Turning autoexposure off (input scale 1) cost −0.1 dB. The aux is a constant
  albedo of 1 plus the capture's world-space normal. That normal is in OIDN's convention: any
  consistent space, [−1, 1], sky = 0. The signal is already demodulated, so passing the real albedo
  tells the network about texture edges the signal doesn't have, and it loses 2.7 dB diffuse.
- **Shadows (visibility) and AO (ĥ):** scalars in [0, 1], as grey color through the **HDR**
  weights, with the same aux. ĥ = h / (h + 1 + 0.05·|viewZ|), miss = 1: the exact `HitDistanceNormalizer`
  output the `occlusion-*` filters get. The output is the mean of OIDN's three channels.
  **The LDR weights (`rt_ldr_calb_cnrm`, what the brief suggested) failed:** shadows 19.26 dB
  vs 30.32 through the HDR weights on `std540-orbit` and 14.94 vs 31.53 on `three-orbit`. AO
  scored 12.56 vs 33.12 on `three-orbit`, i.e. no better than the noisy input. The LDR
  route brightens dark regions: a fully shadowed quad with reference 0.11 came out 0.77, and AO
  mean 0.754 came out 0.967. The HDR route is unbiased (AO mean 0.748). Whether that is the LDR
  network's behaviour on 1-spp binary / scalar input or the package's LDR texture path (float
  inputs skip OIDN's sRGB transfer for linear LDR) is a TASKS item. It needs native OIDN to tell.
- **Models.** `high` resolves to `rt_hdr_calb_cnrm_large` for all four signals. The `*_ldr_calb_cnrm_large`
  weights aren't shipped, so 'high' with LDR falls back to `balanced`, which the adapter logs.
  The default `fast` resolves to `rt_hdr_calb_cnrm_small`. Precision is fp32 for quality; fp16 is
  timed in the Cost section.

## Per signal: analytic test bed (std540, 960×540, pooled PSNR dB; 1080p = `std1080-orbit`)

**Diffuse** (demodulated, 256-spp reference):

| filter | orbit | pan | light | thin | glossy | cut | object | **mean** | 1080 orbit | FLIP | flicker |
|---|---|---|---|---|---|---|---|---|---|---|---|
| noisy | 16.42 | 15.34 | 16.31 | 16.69 | 16.65 | 14.16 | 16.26 | **15.97** | 16.43 | 0.4325 | 0.1178 |
| accumulate-32 | 22.52 | 21.62 | 22.17 | 22.81 | 23.44 | 20.45 | 20.73 | **21.96** | 20.40 | 0.1996 | 0.0497 |
| recurrent | 36.46 | 37.74 | 37.74 | 33.25 | 38.67 | 37.39 | 35.07 | **36.62** | 37.11 | 0.0613 | 0.0049 |
| svgf | 38.09 | 38.04 | 38.84 | 34.10 | 38.36 | 38.30 | 36.63 | **37.48** | 39.15 | 0.0575 | 0.0041 |
| svgf-auto | 38.21 | 38.14 | 39.13 | 34.13 | 38.46 | 38.42 | 36.73 | **37.60** | 39.21 | 0.0564 | 0.0039 |
| OIDN fast (default) | 34.32 | 35.37 | 34.72 | 31.64 | 35.19 | 35.59 | 32.82 | **34.24** | 35.75 | 0.1088 | 0.0080 |
| **OIDN high** | 35.76 | 36.87 | 36.13 | 32.53 | 36.64 | 36.67 | 34.42 | **35.58** | 37.07 | 0.0823 | 0.0077 |

**Specular** (demodulated by the env-BRDF, traced, 256-spp reference):

| filter | orbit | pan | light | thin | glossy | cut | object | **mean** | 1080 orbit | FLIP | flicker |
|---|---|---|---|---|---|---|---|---|---|---|---|
| noisy | 13.66 | 17.97 | 13.75 | 16.74 | 18.82 | 16.54 | 14.40 | **15.98** | 13.68 | 0.3059 | 0.1200 |
| accumulate-32 | 22.53 | 23.06 | 22.59 | 24.37 | 26.18 | 22.61 | 21.54 | **23.27** | 20.50 | 0.1295 | 0.0315 |
| ffx-reflections | 18.49 | 24.03 | 18.00 | 21.35 | 25.73 | 21.47 | 19.40 | **21.21** | 18.41 | 0.1611 | 0.0109 |
| recurrent | 31.85 | 33.89 | 31.76 | 33.43 | 35.31 | 33.02 | 31.55 | **32.97** | 33.44 | 0.0684 | 0.0059 |
| svgf | 32.28 | 33.83 | 32.81 | 34.18 | 34.97 | 33.37 | 32.76 | **33.46** | 34.42 | 0.0658 | 0.0048 |
| svgf-auto | 32.94 | 35.02 | 33.32 | 34.23 | 35.65 | 34.08 | 33.66 | **34.13** | 34.97 | 0.0632 | 0.0044 |
| OIDN fast (default) | 31.06 | 34.88 | 29.25 | 32.70 | 35.05 | 32.29 | 31.30 | **32.36** | 33.63 | 0.0786 | 0.0082 |
| **OIDN high** | 31.82 | 35.64 | 30.07 | 33.32 | 35.77 | 33.08 | 32.19 | **33.13** | 34.33 | 0.0720 | 0.0075 |

On specular, OIDN high beats `recurrent` (+0.16 dB mean, 4 of 7 paths) and even beats A-SVGF
`auto` on `pan` (+0.6, a disocclusion every frame) and `glossy` (+0.1). It loses the other five
paths to A-SVGF by 0.9–3.3 dB (`light`, the light flip, by the most).

**Shadows** (visibility; penumbra pooled, mean over 7: noisy 8.25, accumulate-32 15.69, FFX 23.49,
ours **26.66**, OIDN fast 23.50, OIDN high 24.48):

| filter | orbit | pan | light | thin | glossy | cut | object | **mean** | 1080 orbit | FLIP | flicker |
|---|---|---|---|---|---|---|---|---|---|---|---|
| noisy | 18.81 | 17.82 | 17.67 | 15.98 | 19.28 | 18.03 | 16.61 | **17.74** | 18.66 | 0.0763 | 0.0493 |
| accumulate-32 | 25.79 | 25.96 | 13.77 | 23.89 | 28.48 | 25.44 | 21.83 | **23.59** | 24.46 | 0.0535 | 0.0151 |
| ffx-shadows | 31.08 | 31.41 | 29.48 | 30.04 | 31.60 | 31.87 | 30.51 | **30.85** | 35.40 | 0.0521 | 0.0059 |
| **shadows** (ours) | 34.92 | 36.71 | 33.92 | 34.74 | 38.10 | 36.04 | 33.85 | **35.47** | 36.64 | 0.0195 | 0.0040 |
| OIDN fast (default) | 28.70 | 31.67 | 29.50 | 29.13 | 33.23 | 30.92 | 29.20 | **30.33** | 31.91 | 0.0325 | 0.0079 |
| **OIDN high** | 30.32 | 33.23 | 31.71 | 30.47 | 35.02 | 32.40 | 30.82 | **32.00** | 33.15 | 0.0304 | 0.0065 |

## Per signal: real scene (three.js corner, moving camera; pooled PSNR dB)

| signal | filter | three-orbit | three-pan | settled (orbit / pan) | penumbra (orbit / pan) | FLIP | flicker |
|---|---|---|---|---|---|---|---|
| diffuse | noisy | 16.88 | 17.09 | 16.86 / 17.17 | – | 0.4428 | 0.1626 |
| diffuse | accumulate-32 | 28.54 | 26.48 | 33.77 / 29.39 | – | 0.1112 | 0.0321 |
| diffuse | recurrent | 38.78 | 39.56 | 39.31 / 40.15 | – | 0.0383 | 0.0057 |
| diffuse | svgf | **39.89** | 40.27 | 40.07 / 40.55 | – | 0.0370 | 0.0056 |
| diffuse | svgf-auto | 39.84 | **40.39** | 40.00 / 40.72 | – | **0.0363** | **0.0055** |
| diffuse | OIDN fast (default) | 38.50 | 38.94 | 38.53 / 39.03 | – | 0.0558 | 0.0069 |
| diffuse | **OIDN high** | 39.80 | 40.01 | 39.81 / 40.04 | – | 0.0485 | 0.0065 |
| specular (SSR) | noisy | 34.79 | 35.87 | 34.88 / 36.06 | – | 0.1358 | 0.0092 |
| specular (SSR) | accumulate-32 | 39.31 | 37.22 | 39.29 / 36.53 | – | 0.0754 | 0.0030 |
| specular (SSR) | ffx-reflections | 39.12 | 40.86 | 38.85 / 40.66 | – | 0.0700 | 0.0026 |
| specular (SSR) | recurrent | 43.02 | 44.29 | 43.53 / 44.68 | – | 0.0465 | 0.0017 |
| specular (SSR) | svgf | 44.33 | 46.11 | 44.26 / 46.13 | – | 0.0403 | 0.0012 |
| specular (SSR) | svgf-auto | **45.32** | **47.58** | 45.39 / 47.92 | – | **0.0371** | **0.0011** |
| specular (SSR) | OIDN fast (default) | 39.47 | 39.03 | 39.47 / 39.05 | – | 0.0702 | 0.0043 |
| specular (SSR) | **OIDN high** | 41.71 | 42.02 | 41.68 / 42.13 | – | 0.0577 | 0.0032 |
| shadows | noisy | 16.05 | 16.79 | 15.99 / 17.12 | 7.79 / 7.84 | 0.0965 | 0.0609 |
| shadows | accumulate-32 | 26.03 | 25.76 | 27.73 / 28.37 | 19.99 / 18.10 | 0.0370 | 0.0148 |
| shadows | ffx-shadows | 26.32 | 27.87 | 25.80 / 27.57 | 22.61 / 23.19 | 0.0479 | 0.0088 |
| shadows | shadows (ours) | 30.93 | 31.10 | 30.91 / 31.37 | **26.82 / 26.72** | **0.0233** | **0.0063** |
| shadows | OIDN fast (default) | 30.28 | 30.65 | 30.25 / 30.81 | 24.27 / 24.31 | 0.0348 | 0.0087 |
| shadows | **OIDN high** | **31.53** | **31.86** | 31.50 / 32.00 | 25.22 / 24.77 | 0.0318 | 0.0074 |
| AO | noisy | 12.52 | 12.74 | 12.55 / 12.77 | – | 0.4179 | 0.3333 |
| AO | occlusion-accumulate-32 | 24.44 | 22.72 | 29.36 / 25.44 | – | 0.0886 | 0.0537 |
| AO | occlusion-recurrent | 32.54 | 32.59 | 32.94 / 33.16 | – | 0.0328 | 0.0091 |
| AO | occlusion-svgf | **33.43** | **33.55** | 33.41 / 33.90 | – | **0.0313** | 0.0095 |
| AO | occlusion-svgf-auto | 33.10 | 33.48 | 33.02 / 33.80 | – | 0.0316 | **0.0089** |
| AO | OIDN fast (default) | 31.82 | 32.01 | 31.79 / 32.09 | – | 0.0540 | 0.0112 |
| AO | **OIDN high** | 33.12 | 33.19 | 33.08 / 33.28 | – | 0.0440 | 0.0102 |

The real scene's specular is SSR, not demodulated, and its reference is SSR's own expectation
(examples/three-temporal/CAPTURES.md). The noisy input already scores 34.8–35.9 dB. On this
input OIDN *removes* detail the reference keeps: it ends 3.6–5.6 dB below A-SVGF, and the
gap is the same at frame 0 (41.77 vs 44.42). Don't read this row as a traced-specular result
(LESSONS: say which specular signal a ranking was measured on).

## Single-frame quality and history

Frame 0 is a reset, so no filter has any history. Means of per-frame dB:

| signal | filter | frame 0, std540 (7) | frame 0, three (2) | frame 1, std540 | settled pooled, std540 | settled pooled, three | `cut` frames 8–9 (after the cut) |
|---|---|---|---|---|---|---|---|
| diffuse | recurrent | 33.75 | 36.01 | 34.60 | 37.63 | 39.73 | 35.95 |
| diffuse | svgf / svgf-auto | **36.00** | 37.83 | **36.85** | **38.07** | **40.36** | 36.65 |
| diffuse | OIDN high | 35.36 | **39.72** | 35.32 | 35.61 | 39.93 | **36.69** |
| specular | svgf-auto | **33.20** | **44.42** | **33.81** | **34.44** | **46.65** | 36.10 |
| specular | OIDN high | 32.81 | 41.77 | 32.75 | 33.62 | 41.90 | **36.93** |
| shadows | shadows (ours) | **33.07** | 30.56 | **34.47** | **36.28** | 31.14 | **35.51** |
| shadows | OIDN high | 31.75 | **31.50** | 31.77 | 32.20 | **31.75** | 33.75 |

- OIDN's quality is flat over time (35.36 at frame 0, 35.61 settled), as it must be. Ours climbs
  1.5–4 dB from frame 0 to the settled frames.
- On the test bed SVGF's frame-0 output (spatial variance + 5 à-trous levels) already beats
  OIDN's on diffuse and specular. On the real scene OIDN leads at frame 0 by 1.9 dB diffuse and
  0.9 dB shadows. Right after a camera cut (`cut`, frames 8–9) OIDN and SVGF are level on
  diffuse, OIDN is ahead on specular (+0.8 dB) and ours on shadows (+1.8 dB). Recovery without history is where OIDN is strongest.

## Cost

Wall-clock ms of one `denoiseTextures()` call (one signal, `diffuse`), awaited, on the OIDN
device. Frames 1–7 of each run (frame 0 compiles); 3 rounds per configuration, interleaved.
Another agent's 1080p evals ran on the same GPU throughout (no quiet window came in 40 min).
So run medians swing up to 4× between rounds, and the **fastest frame** and the **best run's
median** are the numbers to read. The 102-page quality batch ran under heavier contention, and
its per-frame ms (in the data file) read 3–5× higher. Don't quote those.

| configuration | weights | 960×540 fastest / best-run median | 1920×1080 fastest / best-run median |
|---|---|---|---|
| **high, fp32** (scored) | `rt_hdr_calb_cnrm_large` | 47.3 / 47.8 | **204.9 / 238.5** |
| balanced, fp32 | `rt_hdr_calb_cnrm` | 20.0 / 20.5 | 88.7 / 90.3 |
| **fast, fp32** (package default, scored) | `rt_hdr_calb_cnrm_small` | 10.7 / 11.1 | **44.3 / 49.3** |
| high, fp16 | large | 40.9 / 41.5 | 165.3 / 178.4 |
| fast, fp16 | small | 8.9 / 9.0 | 41.8 / 42.1 |
| ours: `svgf` joint diffuse + specular (both signals), same replay | – | 0.96 / 1.00 | 3.77 / 3.90 |
| ours: `shadows`, same replay | – | 0.19 / 0.19 | 0.60 / 0.61 |

These agree with the package's own eval (docs/status/eval-2026-10-08-quiet.md, 1080p WGSL fp32
large 186 ms, small 39.5 ms). A frame needs one OIDN call per signal; ours shares one dispatch
for diffuse + specular.

**Adapter timing check** (same interleaved rounds): HEAD's `tools/rt-capture` (a `git archive`
of 7a8b980 served on a second port) vs the changed one, same pinned package. Fastest frame:
`svgf` 3.77 vs 3.78 ms at 1080p and 0.96 vs 0.96 at 960×540; `shadows` 0.60 vs 0.60 and 0.19 vs
0.19. Run medians differ only where one run hit contention (both directions). Outputs are
byte-identical (48 / 48 files).

## Follow-ups (TASKS)

- OIDN LDR route on 1-spp scalar input brightens dark regions (shadows 19 dB, AO = noisy level).
  Check `denoiseTextures({ hdr: false })` on a float binary-dither image against native
  `oidnDenoise` (LDR, `--srgb` off vs on). If native agrees, it's the LDR network; if not, the
  package's LDR texture path (no sRGB transfer for linear float input). Owner: OIDN package.
- OIDN 3 real-time, when it ships: add it as a `denoiser/realtime` class and register it beside
  `oidn` in `tools/rt-capture`. Score it on these captures with the same table.

## Reproduce

```sh
S=<scratch>; git archive 7a8b980 packages/denoiser-realtime/src packages/denoiser-core/src | tar -x -C $S/pin
RT_NO_HMR=1 RT_REALTIME_SRC=$S/pin/packages/denoiser-realtime/src \
  node node_modules/vite/bin/vite.js tools/rt-capture --port 5395 --strictPort --host 127.0.0.1
export BASE=http://127.0.0.1:5395/
node tools/rt-capture/run-headless.mjs "capture=std540-orbit&denoiser=oidn&signals=diffuse,specular,visibility&output=e2-oidn" \
  "capture=three-orbit&denoiser=oidn&output=e2-oidn" "capture=three-orbit&denoiser=occlusion-svgf&signals=ao&output=e2-occlusion-svgf" ...
node tools/rt-capture/compare.mjs std540-orbit e2-oidn e2-svgf-auto ...
node examples/three-temporal/score-captures.mjs three-orbit --denoisers e2-oidn,e2-occlusion-svgf,...   # FLIP, AO
```
