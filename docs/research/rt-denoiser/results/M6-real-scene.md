# M6 groundwork: first real-scene numbers (three.js scene, static camera)

_2026-10-25, m6 agent (implementer, RULES.md rule 8: no NRD code, README or port read).
**Provisional / experimental**: the defaults are the classes' own (Dennis decides them, SPEC §12
item 1); nothing here was tuned on this scene. denoiser-realtime served from a `git archive`
snapshot of 19340b3 (later changes up to dda6596 are comment-only)._

This is the first data point outside the analytic test bed (PLAN §9: "add at least one real
scene before drawing conclusions"). The scene is the furnished corner of
`examples/three-temporal/shadows.html` (three r186 WebGPU raster, 20,862 triangles, one
1.62 × 1.2 m area light), traced at 1 ray per pixel with three-mesh-bvh's WebGPU BVH, and
denoised through the new `denoiser/three` nodes.

Pages: `examples/three-temporal/realtime-shadows.html` (ours vs FFX shadows) and
`realtime-gi.html` (diffuse + specular + AO). Runner: `examples/three-temporal/run-realtime.mjs`
(`shadows --metrics`, `gi --metrics`, `bench`). Raw numbers: `data/M6-real-scene.json`.

## How the reference is made

Static camera only. Each page accumulates many independent samples per pixel while the camera
holds still (float32 running mean), then resets the denoisers and runs 64 frames on the same
view; PSNR (pooled MSE) and FLIP are taken against that reference at frames 1, 2, 4, 8, 16, 32
and 64 after the reset. FLIP uses the test bed's viewing condition (image spans 46.4°:
20.7 ppd at 960 px, 41.4 at 1920).

- Shadows: 16 stratified white-noise rays/pixel/frame × 256 frames = **4096 rays/pixel** (the
  1-ray signal uses blue noise by default, `&sampler=white` the PCG white noise of shadows.html).
  Penumbra = pixels with 0.02 < reference < 0.98 (13 % of the wide shot, 21 % of the close-up).
- GI page: diffuse = 4 white-noise cosine rays/pixel/frame × 512 frames = 2048 rays (AO from the
  same rays, normalized per sample with `OcclusionDenoiser`'s default curve h/(h + 1 + 0.05·depth),
  miss = 1); specular = three's stochastic SSR accumulated over 512 frames, i.e. the reference is
  SSR's own expectation (SSR's misses and biases are shared by every denoiser here).

Run-to-run noise is ±0.1 dB (the blue-noise frame index differs between page sessions).

## Shadows: ours (`ShadowDenoiser`) vs FFX, static camera

PSNR on visibility (all receivers / penumbra), frame 64 after a reset, plus FLIP:

| view | res | sampler | noisy | FFX | **ours** | FLIP noisy / FFX / **ours** |
|---|---|---|---|---|---|---|
| wide (shot 0) | 960×540 | blue | 16.56 / 7.78 | 28.46 / 22.22 | **31.67 / 27.42** | 0.094 / 0.044 / **0.024** |
| close-up (shot 1) | 960×540 | blue | 14.42 / 7.68 | 26.22 / 23.26 | **31.65 / 29.29** | 0.152 / 0.063 / **0.031** |
| wide | 960×540 | white | 16.60 / 7.82 | 28.41 / 22.16 | **30.49 / 24.71** | 0.095 / 0.044 / **0.032** |
| close-up | 960×540 | white | 14.44 / 7.70 | 26.19 / 23.19 | **30.11 / 25.92** | 0.153 / 0.064 / **0.045** |
| wide | 1920×1080 | blue | 16.56 / 7.79 | 30.20 / 23.87 | **33.37 / 28.85** | 0.048 / 0.034 / **0.017** |
| close-up | 1920×1080 | blue | 14.41 / 7.67 | 29.97 / 24.32 | **33.15 / 30.29** | 0.073 / 0.049 / **0.023** |

Convergence after a reset (960×540, blue noise; all receivers / penumbra):

| frame | FFX wide | ours wide | FFX close | ours close |
|---|---|---|---|---|
| 1 | 29.37 / 23.22 | **30.93 / 24.76** | 27.77 / 24.37 | **30.32 / 26.42** |
| 2 | **30.23** / 23.14 | 29.78 / **23.64** | 28.21 / 23.95 | **29.14 / 24.41** |
| 4 | 30.13 / 23.06 | **30.37 / 24.80** | 28.20 / 23.97 | **30.17 / 26.19** |
| 8 | 30.27 / 23.63 | **30.85 / 25.78** | 28.22 / 24.37 | **30.79 / 27.32** |
| 16 | 28.82 / 22.84 | **31.36 / 26.67** | 27.02 / 23.86 | **31.31 / 28.35** |
| 64 | 28.46 / 22.22 | **31.67 / 27.42** | 26.22 / 23.26 | **31.65 / 29.29** |

Reading:

- **Ours is ahead on every view, resolution and sampler at frame 64**: +2.1 … +5.4 dB overall
  (+3.2 … +5.4 with blue noise), +5.0 … +6.0 dB in penumbrae with blue noise, FLIP roughly halved. That is the same ranking as
  the test bed (M4: +4.9 … +8.9 dB pooled), with a smaller margin.
- **FFX gets worse as its history grows** (wide 30.27 → 28.46 dB from frame 8 to 64): a dark,
  widening bias in every penumbra (error images below). Ours keeps improving to frame 64.
- **Frame 2 dips below frame 1 for ours** in every configuration (−0.8 … −1.3 dB overall, −1.0 …
  −2.2 dB penumbra), and FFX is ahead overall at frame 2 on the wide shot. The first frame (A = 0,
  spatial-only with the young-history mean) is better than the second (first temporal blend).
  The test bed's reset windows showed ours behind FFX for frames 0–2 (M4 §10); this is the same
  weak spot, seen on a real scene. Filed in TASKS (owner denoiser-realtime).
- **Blue noise matters for ours, not for FFX**: white noise costs ours 1.2 / 2.7 dB (wide /
  penumbra) and 1.5 / 3.4 dB (close), FFX ≤ 0.1 dB. Expected (ours' clamp relies on blue-noise
  light samples, SH-7), but it means our margin depends on the renderer contract: with white noise
  it is +2.1 … +3.9 dB.
- The absolute PSNR (31–33 dB) is lower than the test bed's 37 dB: errors concentrate at thin
  geometry (chair and table legs, the lamp pole, the rug's 1 cm edge, where both denoisers leave
  a lit/shadow fringe) and in the outer, low-contrast half of the big penumbrae.

![error images, close-up](img/M6-shadows-error-close.jpg)

_Close-up, 64 frames after a reset, signed error ×4 (red = darker than the reference, blue =
brighter). FFX: dark band through every penumbra; ours: mostly neutral, a faint bright haze at the
outer penumbra edge and fringes at thin geometry._

## GI page: `DiffuseSpecularDenoiser`, `OcclusionDenoiser`, vs FFX reflections (960×540, static)

Signals: diffuse = 1 cosine-weighted ray (a miss sees the environment, a hit returns the area light
bounced off a grey 0.5 surface without a secondary shadow ray), demodulated; specular = three's
stochastic SSR (ray length in .a), not demodulated; AO = the diffuse ray's hit distance. Every class
with its defaults (SVGF for diffuse/specular, recurrent for occlusion, antiLag off). Diffuse and
specular PSNR on tonemapped x/(1+x) rgb, AO on ĥ:

| | frame | diffuse noisy / **ours** | specular noisy / FFX / **ours** | AO noisy / **ours** |
|---|---|---|---|---|
| wide | 1 | 16.90 / 37.56 | 34.36 / 39.82 / **43.33** | 12.50 / 29.44 |
| wide | 8 | 16.93 / 41.43 | 34.58 / 43.13 / **49.48** | 12.50 / 33.99 |
| wide | 64 | 16.91 / **41.65** | 34.51 / 44.08 / **50.05** | 12.50 / **35.83** |
| close-up | 64 | 17.51 / **41.73** | 38.91 / 47.75 / **55.23** | 12.09 / **34.08** |

FLIP at frame 64 (wide / close-up): diffuse noisy 0.444 / 0.437, ours **0.036 / 0.036**; specular
noisy 0.144 / 0.083, FFX 0.039 / 0.039, ours **0.029 / 0.020**; AO noisy 0.421 / 0.449, ours
**0.028 / 0.031**.

Reading: no diffuse or AO baseline exists in `denoiser/ffx`, so those rows show the size of the
cleanup only. On specular ours (SVGF) beats FFX reflections by 6–7.5 dB PSNR; part of that is FFX's
known energy loss on HDR input (test bed: ~28 % on demodulated specular, LESSONS) and SSR's
mostly dim specular on this scene (high absolute PSNR); FLIP (−25 … −50 %) is the more telling
number. The `ao` rows of an earlier run were stale (the AO node was not in the render graph during
the measurement; fixed, see LESSONS).

## Cost on the real scene (Apple M5 Pro, Chrome, per-denoiser GPU timestamps)

Two caveats dominate: (1) the realtime-shadows page is light (raster + 1 ray), so the GPU sits in
its slow clock state and every pass reads 2–3× the test bed's ms; (2) per-page medians move
×1.3–1.8 run to run (LESSONS, two clock states). The most comparable numbers:

| | 960×540 | 1920×1080 | notes |
|---|---|---|---|
| shadows, **split view** (FFX and ours in the same frames, same clock) | FFX 0.58–0.79, **ours 0.44–0.58** | FFX 1.85–1.91, ours 1.84–1.85 | medians of 60 frames, 5 / 2 page loads (ours lower in each) |
| shadows, solo page per denoiser, fastest frame of 4 runs | FFX 0.34, ours 0.35 | FFX 0.82, ours 0.97 | per-page medians: FFX 0.81–0.90 / 1.27–2.75, ours 0.82–0.87 / 1.49–2.64 |
| ours shadows on the GI page (GPU kept busy by SSR + the joint denoiser) | 0.57 | **0.59** (temporal 0.37) | matches the test bed's 0.55 / 0.37 measured in the same session |
| test bed (same session, `signal=shadows&mode=bench`, 1080p) | | FFX 1.01, ours 0.55–0.71 | M4: FFX 0.50–0.61, ours 0.48–0.59 |
| `DiffuseSpecularDenoiser` (joint SVGF, defaults), solo | 2.90–2.97 | 3.90–3.94 | 1080p README: 3.98 (dev page) |
| `OcclusionDenoiser` (recurrent AO), solo | 0.95–1.04 | 2.88–3.03 | M5: 1.32 at 1080p (fast clock) |
| FFX reflections on the same SSR, solo | 1.30–1.34 | 3.65–4.12 | |

So: on this scene ours and FFX shadows cost about the same (ours a little cheaper in the
same-clock split view at 960, level at 1080, ~15 % more at the fastest solo frame at 1080). The
1080p shadows target (≤ 0.6 ms) holds when the GPU is busy (0.59 ms on the GI page). Passing a
linear view z guide instead of hardware depth (`&viewz=1`) did not change the cost; neither did
`youngMean: 0`, `catmullRom: false`, `noiseBlend: 0` or `normalWeight: false` (all within the
run-to-run spread).

## What is not measured yet (and what it would take)

- **Moving camera**: done, see "Moving camera" below. **Moving objects** are still not measured
  (the knot is frozen on the scripted path).
- **Recurrent / A-SVGF variants on the real scene** (only class defaults ran). The pages take the
  options (`realtimeDiffuseSpecular(..., { denoiser: {...} })`; shadows page `&sh.<option>=`).
- **Directional light** (sun) shadows on a real scene.
- The specular reference is SSR's expectation, not ground truth; a BVH-traced specular signal
  (as `reflections-hybrid.html` traces) would allow a true reference.

## Moving camera (scripted path, per-pose references, replayed captures)

_Appended 2026-10-25 by the real-scene-motion agent (implementer, RULES.md rule 8: no NRD code,
README or port read). Same experimental / provisional status as above: class defaults only,
nothing tuned on this scene. denoiser/realtime served from a `git archive` snapshot of 2b69b7e
(package content = dda6596, i.e. without the shadows edits in progress at the time of the run);
denoiser-ffx and the registry from the working tree at 2b69b7e._

### Setup

| | |
|---|---|
| path | `examples/three-temporal/src/realtime/path.ts`, 64 frames: 0–39 slow orbit around the wide shot (0.46°/frame, dolly in, ~5–7 px/frame), 40–63 fast pan (6 cm/frame slide + 1.6°/frame yaw, ~22 px/frame plus parallax). The torus knot is frozen: camera motion only |
| captures | CAPTURE-FORMAT v0, 960×540: `three-orbit` = path frames 0–39 (40 frames), `three-pan` = 32–63 (32 frames; the pan starts at local frame 8). Frame 0 of each is a reset. Written by `realtime-gi.html?path=orbit&ref=1` (`node run-realtime.mjs capture --set=moving`), 9–10 s per frame, 4.9 GB (4.5 GiB) together; validate.mjs passes (motion reprojection < 0.001 px, history consistency 98.8–99.0 %). Recipe and contents: [examples/three-temporal/CAPTURES.md](../../../../examples/three-temporal/CAPTURES.md) |
| references, per pose | the pose is frozen and accumulated before the path advances: visibility 1024 rays (4×4 stratified white noise × 64 frames), diffuse 2048 white-noise cosine rays (AO from the same rays, `ao_ref`), specular = 256 frames of SSR lit by the converged diffuse + visibility references (the noisy SSR sample sees the same input). Reference noise floors (variance of the reference mean): diffuse ≈ 50 dB, AO ≈ 46 dB, visibility > 46 dB, specular ≈ 59–60 dB; every denoiser below scores ≥ 4 dB under its floor, and the floor lowers all of them alike |
| signals | as on the static page: blue-noise 1-ray visibility + occluder distance, 1 cosine diffuse ray + hit distance, three's stochastic SSR (not demodulated, SSR ray length as hit distance), AO = ĥ of the diffuse ray |
| denoisers | registry entries replayed with `tools/rt-capture`'s replay (the TemporalDenoiser classes the `denoiser/three` nodes wrap): `shadows`, `ffx-shadows`, `svgf`, `svgf-auto`, `recurrent`, `ffx-reflections`, `occlusion-svgf`, `occlusion-svgf-auto`, `occlusion-recurrent` (`&signals=ao`), plus `accumulate-32` as the no-spatial-filter baseline. Defaults, no settings |
| metrics | `examples/three-temporal/score-captures.mjs`: compare.mjs's definitions (pooled PSNR over all frames and receivers, rank on it; settled = frames ≥ 8 after the reset, which on `three-pan` is exactly the pan; penumbra = 0.02 < ref < 0.98; fixed-pixel flicker; bias) plus AO against `ao_ref` and LDR-FLIP every 4th frame at the test bed's viewing condition (20.7 ppd at 960 px) |
| commands | `BASE=http://127.0.0.1:5371/ node examples/three-temporal/replay-captures.mjs` (test-bed server pinned with `RT_REALTIME_SRC`), raw numbers [data/M6-moving-camera.json](data/M6-moving-camera.json) |

Replay is deterministic (same numbers on a rerun), so differences of a few hundredths of a dB are
real but not meaningful. GPU ms from these replays are not reported (idle-GPU replay, LESSONS).

### Shadows

| capture | denoiser | pooled PSNR | settled | penumbra | FLIP | flicker | bias |
|---|---|---|---|---|---|---|---|
| `three-orbit` | noisy | 16.05 | 15.99 | 7.79 | 0.106 | 0.0632 | 0.000 |
| | `accumulate-32` | 26.03 | 27.73 | 19.99 | 0.040 | 0.0135 | −0.002 |
| | `ffx-shadows` | 26.32 | 25.80 | 22.61 | 0.055 | 0.0077 | −0.040 |
| | **`shadows`** | **30.04** | **30.01** | **26.68** | **0.030** | **0.0067** | 0.003 |
| `three-pan` | noisy | 16.79 | 17.12 | 7.84 | 0.087 | 0.0586 | 0.000 |
| | `accumulate-32` | 25.76 | 28.37 | 18.10 | 0.034 | 0.0161 | −0.001 |
| | `ffx-shadows` | 27.87 | 27.57 | 23.19 | 0.041 | 0.0099 | −0.037 |
| | **`shadows`** | **30.31** | **30.59** | **26.47** | **0.024** | **0.0078** | 0.005 |

- Ours leads by **+3.7 / +2.4 dB** pooled (orbit / pan), **+4.1 / +3.3 dB** in penumbrae, FLIP −45 / −42 %,
  less flicker. The same ranking as the test bed (orbit +5.9, pan +5.0 dB at 1080p, REMEASURE §4)
  and as the static real-scene views (+3.2 … +5.4 dB), with the smaller real-scene margin.
- FFX's dark penumbra bias (−0.04) is there under motion too, and FFX again gets worse as its
  history grows (orbit per-frame 29.8 dB at frame 1 → 26.9 at frame 11 → 25.3–25.6 from frame 18 on); ours stays
  within 29.8–30.2 dB through the orbit after frame 0 and climbs to 31.2 dB during the pan.
- **The frame-2 dip after a reset shows on the moving path as well** (orbit 30.59 → 29.99, pan 30.05 →
  29.24 dB at frames 0 → 1), the weak spot already filed in TASKS (shadows-reset).
- `uniformSnap` (SPEC §12 item 5) on the real scene: `true` 30.04 / 30.31, `'change'` 30.06 / 30.33,
  `false` 30.07 / 30.35 dB pooled (orbit / pan); penumbra 26.68 / 26.75 / 26.81 and 26.47 / 26.53 / 26.58;
  FLIP 0.0295 / 0.0294 / 0.0291 and 0.0238 / 0.0238 / 0.0236. Same order as the test bed's PSNR
  (`false` ≥ `'change'` ≥ `true`, within 0.03 dB), but here `false` also has the (marginally) best
  FLIP, where the test bed had `true` best on orbit / pan. No path here changes the lighting, which is
  the case the snap is for.

### Diffuse and specular (`DiffuseSpecularDenoiser` joint, FFX reflections)

Pooled PSNR on tonemapped x/(1+x) rgb:

| signal | denoiser | orbit | orbit settled | pan | pan settled (= the pan) | FLIP orbit / pan | flicker orbit / pan |
|---|---|---|---|---|---|---|---|
| diffuse | noisy | 16.88 | 16.86 | 17.09 | 17.17 | 0.446 / 0.439 | 0.166 / 0.159 |
| | `accumulate-32` | 28.54 | 33.77 | 26.48 | 29.39 | 0.096 / 0.126 | 0.027 / 0.038 |
| | `svgf` (`'off'`) | **39.89** | **40.07** | 40.27 | 40.55 | 0.037 / 0.037 | 0.0055 / 0.0058 |
| | `svgf-auto` (v2) | 39.84 | 40.00 | **40.39** | **40.72** | **0.036 / 0.036** | **0.0054 / 0.0056** |
| | `recurrent` | 38.78 | 39.31 | 39.56 | 40.15 | 0.039 / 0.038 | 0.0054 / 0.0059 |
| specular | noisy | 34.79 | 34.88 | 35.87 | 36.06 | 0.138 / 0.134 | 0.0094 / 0.0091 |
| | `accumulate-32` | 39.31 | 39.29 | 37.22 | 36.53 | 0.071 / 0.080 | 0.0025 / 0.0035 |
| | `ffx-reflections` | 39.12 | 38.85 | 40.86 | 40.66 | 0.071 / 0.069 | 0.0023 / 0.0028 |
| | `svgf` (`'off'`) | 44.33 | 44.26 | 46.11 | 46.13 | 0.041 / 0.040 | 0.0012 / 0.0012 |
| | `svgf-auto` (v2) | **45.32** | **45.39** | **47.58** | **47.92** | **0.038 / 0.036** | **0.0011 / 0.0011** |
| | `recurrent` | 43.02 | 43.53 | 44.29 | 44.68 | 0.045 / 0.048 | 0.0016 / 0.0018 |

- **Diffuse:** SVGF / A-SVGF `'auto'` ahead of recurrent by 1.1 dB (orbit) and 0.7–0.8 dB (pan), test
  bed −0.86 / −1.25 dB for recurrent vs SVGF on the same two paths: **agrees**. `'auto'` vs `'off'` is a
  tie here (−0.05 orbit, +0.12 pan; test bed +0.32 / +0.20).
- **Specular: the ranking of `'off'` and recurrent flips.** `svgf-auto` first on both (as on the test
  bed), but plain SVGF beats recurrent by **+1.3 / +1.8 dB** here, where the test bed has recurrent
  ahead of plain SVGF on orbit and pan (+0.54 / +0.54) and on 5 of 7 paths. FFX reflections is last,
  4–7 dB behind (test bed: 12–14 dB behind; its energy loss is negligible here, bias ≈ 0, because
  this SSR signal is dim and LDR-ish).
- Caveat on that specular row: this specular is three's SSR, mostly rough / dim (walls 0.85, floor
  and table 0.12), not demodulated, with SSR's ray length (× the specular dominant factor) as hit
  distance and environment misses as 0. Recurrent specular leans on the hit distance (virtual motion)
  and on flat glossy floors, where it won on the test bed (`glossy`); this scene has a glossy floor
  too, but its SSR hit distances are not the traced ones the test bed hands it. So the flip says
  "recurrent specular's advantage over plain SVGF did not carry to SSR input", not more.

### Occlusion (AO on ĥ, `OcclusionDenoiser`)

| denoiser | orbit | orbit settled | pan | pan settled | FLIP orbit / pan | flicker orbit / pan |
|---|---|---|---|---|---|---|
| noisy | 12.52 | 12.55 | 12.74 | 12.77 | 0.422 / 0.414 | 0.337 / 0.329 |
| `occlusion-svgf` | **33.43** | **33.41** | **33.55** | **33.90** | **0.032 / 0.031** | 0.0091 / 0.0099 |
| `occlusion-svgf-auto` (v2) | 33.10 | 33.02 | 33.48 | 33.80 | 0.032 / 0.031 | **0.0084 / 0.0093** |
| `occlusion-recurrent` (class default) | 32.54 | 32.94 | 32.59 | 33.16 | 0.033 / 0.033 | **0.0084** / 0.0099 |

- SVGF > A-SVGF `'auto'` > recurrent on both paths, SVGF ahead of recurrent by +0.9 / +1.0 dB: the
  test bed's order and margin on the same paths (orbit / pan: SVGF 39.64 / 39.56, `'auto'` 39.57 /
  39.40, recurrent 38.59 / 38.53, i.e. +1.05 / +1.03). **Agrees.** Absolute AO PSNR is ~6 dB lower than
  on the test bed (thin legs, the rug edge, the lamp pole: contact detail everywhere).

### Do the rankings match the analytic test bed?

Plainly: **yes for shadows, diffuse and AO; no for one pair in specular.**

| signal | test bed (1080p, orbit / pan, REMEASURE) | real scene, moving camera | match |
|---|---|---|---|
| shadows | ours > FFX (+5.9 / +5.0 dB) | ours > FFX (+3.7 / +2.4 dB) | yes, smaller margin |
| diffuse | `svgf-auto` > `svgf` > `recurrent` | `svgf` ≈ `svgf-auto` (±0.1) > `recurrent` (−0.7 … −1.1 dB) | yes (`'auto'` vs `'off'` a tie) |
| specular | `svgf-auto` > `recurrent` > `svgf` > FFX | `svgf-auto` > `svgf` > `recurrent` > FFX | **no**: plain SVGF and recurrent swap (SSR input, see caveat) |
| AO | `svgf` > `svgf-auto` > `recurrent` | `svgf` > `svgf-auto` > `recurrent` | yes, same margins |

For SPEC §12: item 1's recommendation (SVGF family for diffuse, specular and occlusion; recurrent
opt-in) is **supported** by the second scene; the one disagreement makes recurrent specular look
worse, not better, so it doesn't argue for recurrent as a default. Item 2 (`'auto'`): it is first on
specular here too (+1.0 / +1.5 dB over `'off'`) and ties on diffuse; still the recommendation. Item 5
(uniform snap): the real scene can't separate the three settings (≤ 0.03 dB). Item 7: this scene
now exists as captures every registry denoiser and the native harness can replay; no default moved
by more than ~0.5 dB in the direction of a different choice, so nothing needs re-tuning on its
evidence alone. Limits: one scene, one light, 72 frames, 960×540, SSR as the specular signal, no
object motion; the live TSL-node path was not scored on the moving path (the replay feeds the same
classes the nodes wrap).
