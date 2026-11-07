# Native NRD on the golden scenes

_Harness builder (RULES.md rule 4), 2026-11-07/08, for [../../GOLDEN-BRIEF.md](../../GOLDEN-BRIEF.md). Images, metrics,
timings and settings names only; nothing from NRD is in this repo. Machine, conventions and harness:
[../../SETUP.md](../../SETUP.md)._

| | |
|---|---|
| native | NRD v4.18.0 (`e06852b`), harness `d686691`, D3D12 headless, encodings normal 2 / roughness LINEAR |
| ours | `feat/rt-denoiser-cleanroom` @ `3138168`, test-bed replay of the **same capture bytes** (`mode=replay`): `svgf-auto` (package defaults, = golden `ours` diffuse + specular), `occlusion-svgf-auto` (AO) |
| captures | made on this machine with the golden driver (`driver.mjs capture`) at `3138168`, 960×540, seed 1, per-frame 4096-spp references, all **VALID** (`validate.txt` per folder) |
| GPU | RTX 3060 Laptop, driver 592.00, Chrome 157 (Dawn / D3D12) |
| scorers | `tools/rt-capture/compare.mjs` (PSNR, flicker, bias); track D's `calm.mjs` / `calm-table.mjs` from `track/d-diffuse` @ `02154b7` (motion-compensated boil per region); [tools/lag.mjs](tools/lag.mjs) (lag) |

**Status.** Every capture in GOLDEN-BRIEF step 1 is done: captured, validated, replayed, scored. Group 1 (G3 orbit +
the four G4 light-change paths) is pushed first. Group 2 adds the two 16384-spp holds (the clean calm floor and a
still-camera light step), plus G2 occluder (with SIGMA, ours `shadows` and `ffx-shadows`) and G5 turntable. **Cost
(step 4) is not in yet**: it needs locked GPU clocks (admin shell; see "Cost" below).

**Raw outputs** (every frame of every denoiser, `.f32`, CAPTURE-FORMAT replay layout) are on the Windows machine in
`C:\dev\nrd-reference\outputs\<capture>\<denoiser>\frame_NNNN\` and the captures in `C:\dev\nrd-reference\captures\<capture>\`
(4.2 GB each). Folder names: `nrd-reference`, `nrd-reblur` (defaults), `nrd-reblur-tunedD` (hit distance A, B, C =
0.01, 0.1, 20), `nrd-reblur-tunedS` (0.1, 0.1, 1), `nrd-relax`, `nrd-reblur-occlusion` (+ `-tunedD`), `ours-auto`,
`ours-occ`; on G2 also `nrd-sigma`, `ours-shadows`, `ffx-shadows`. Each also has `calm.json` / `calm-ao.json` /
`compare.json` next to the denoiser folders (G2: `calm-vis.json` for visibility).

## Per-capture folders

| folder | path | event |
|---|---|---|
| [golden-G3-orbit/](golden-G3-orbit/calm.md) | Sponza orbit, 64 frames | – |
| [golden-G4-pan-light-on/](golden-G4-pan-light-on/lag.md) | Bistro pan, lantern off → on | step at 32 |
| [golden-G4-pan-light-colour/](golden-G4-pan-light-colour/lag.md) | colour step at constant luminance | step at 32 |
| [golden-G4-pan-light-fade/](golden-G4-pan-light-fade/lag.md) | power ramp | ramp 24 → 40 |
| [golden-G4-pan-lamp-switch/](golden-G4-pan-lamp-switch/lag.md) | lamp A off, lamp B on | step at 32 |
| [golden-G3-hold/](golden-G3-hold/calm.md) | Sponza, still camera, 32 frames, **16384 spp** | – |
| [golden-G4-hold-light-on/](golden-G4-hold-light-on/lag.md) | Bistro, still camera (pan frame 20), 32 frames, **16384 spp** | step at 16 |
| [golden-G2-occluder/](golden-G2-occluder/compare.md) | knot over a floor, static close-up camera, knot rotates | – |
| [golden-G5-turntable/](golden-G5-turntable/calm.md) | Flight Helmet turntable (CAPTURE-FORMAT v1, `normal_geom`) | – |

Each folder: `compare.md` / `.json` (PSNR per frame, flicker, bias), `calm.md` / `calm.json` / `calm-ao.json` (boil per
region; G2 also `calm-vis.json`), `lag.md` / `lag.json` (G4), `capture-manifest.json`, `validate.txt`,
`<denoiser>/run.json` + `timings.csv`, and crop strips `crop_f<frame>_<signal>.png` (128 px per panel: noisy | REBLUR |
REBLUR tuned D | RELAX | ours | reference; visibility: noisy | `ffx-shadows` | SIGMA | ours `shadows` | reference;
tile = the most detailed 128-px tile of the reference; Reinhard + sRGB). G4 pan crops are 2 frames after the event and
at frame 56; G3 hold at frame 24, G4 hold at frame 20 (4 after the step), G2 / G5 at frame 40.

## Summary: native vs ours

### Diffuse (the signal track D's gate is about)

| | G3 orbit | G4 light-on | G4 colour | G4 fade | G4 lamp switch |
|---|---|---|---|---|---|
| **detail: all-pixel PSNR dB** (REBLUR def / tuned D / RELAX / **ours**) | 30.28 / 30.98 / **32.14** / 31.84 | 23.87 / 25.19 / 26.62 / **29.29** | 24.36 / 25.60 / 26.91 / **28.68** | 24.40 / 25.84 / 27.28 / **29.15** | 24.35 / 25.34 / 26.95 / **29.17** |
| **calm: static boil ×1e3** | 4.69 / **3.39** / 4.49 / 4.85 | 26.16 / 17.76 / 12.95 / **12.16** | 26.45 / 17.92 / 12.88 / **12.15** | 26.14 / 17.76 / 12.93 / **12.40** | 25.28 / 17.49 / 12.75 / **12.17** |
| calm: edge boil | 9.28 / **7.61** / 10.22 / 20.41 | 69.20 / 53.14 / 35.40 / **35.33** | 69.92 / 53.47 / **33.55** / 33.98 | 67.81 / 51.55 / **33.11** / 33.59 | 64.79 / 50.33 / 34.45 / **33.70** |
| calm: disoccluded boil | 13.92 / 10.22 / **7.55** / 11.56 | 33.11 / 24.42 / **18.59** / 21.51 | 32.25 / 22.78 / **15.54** / 20.04 | 31.31 / 22.09 / **15.29** / 19.50 | 32.52 / 23.33 / **17.10** / 20.45 |
| calm: dynamic error boil | 34.71 / 34.36 / **30.89** / 31.11 | 67.72 / 61.14 / 54.39 / **45.21** | 61.29 / 54.18 / 48.85 / **47.06** | 53.05 / 45.78 / 40.52 / **39.18** | 63.13 / 56.94 / 50.16 / **45.58** |
| reference's own static boil | 11.93 | 17.33 | 17.93 | 17.28 | 17.14 |
| **lag, frames** (settled band; see below) | – | 20 / 18 / 16 / **13** | 20 / 18 / 14 / **12** | 28 / 27 / 24 / **23** (from ramp start), 12 / 11 / 8 / **7** (from ramp end) | 18 / 19 / 17 / 32\* |
| lag-to-pre-event level, frames | – | never / 20 / never / **6** | never / 21 / 23 / **6** | (ramp: n/a) | 18 / 15 / 11 / **3** |
| peak error after the event / settled | – | 6.91 / 10.34 / 10.15 / **3.76** | 3.17 / 4.63 / 5.07 / **2.23** | 2.09 / 2.68 / 2.31 / **1.70** | 5.65 / 9.11 / 11.49 / 8.94 |

\* lamp switch, ours: the error is back at its pre-event level 3 frames after the switch (60 → 13 ×1e-4 MSE) and keeps
falling to 6.0 by frame 56, then the camera's own drift lifts it to 7.4 at frame 63, just above the 1.1 × settled band (7.37),
so the settled-band definition reads "never" (32). Lag-to-pre (3 vs 11–18) is the meaningful number on that path.

- **G4 (Bistro, all four light changes): ours leads native on detail (+1.8…2.7 dB over RELAX, +3.1…4.1 dB over tuned
  REBLUR), lag (fastest on every path: 1–3 frames ahead of RELAX and 4–7 ahead of REBLUR on the settled band, 8 ahead of
  RELAX on the lamp switch by lag-to-pre), the error peak right after the change (lowest on every path; on the lamp
  switch counted against the pre-event level, 4.55 vs 5.58–7.84) and static / dynamic calm, and ties RELAX on edge
  boil.** RELAX remains calmer in disoccluded regions (15.3–18.6 vs 19.5–21.5 ×1e-3, 14–24 % less boil); REBLUR is
  behind RELAX everywhere here, even tuned.
- **G3 (Sponza orbit): mixed.** RELAX is 0.3 dB ahead on all-pixel PSNR (ours is ahead on static pixels, 34.15 vs 34.06).
  Tuned REBLUR is the calmest on static pixels (3.39 vs ours 4.85, −30 %), and **ours boils 2–2.7× native at depth edges
  (20.4 vs 7.6–10.2)**, the one large calm gap on these scenes. RELAX is calmest in disocclusions (7.55 vs 11.56).
- **Against track D's exit gate ("calm and lag ≤ native at tuned settings on G3 / G4")**: lag passes on all four G4 paths;
  calm passes on G4 static / dynamic / edge, fails on G4 disocclusion (vs RELAX), and on G3 fails static (vs tuned
  REBLUR), edge (vs all native) and disocclusion (vs RELAX). The G3 hold (clean floor, below) confirms the G3 calm
  failure: ours boils 1.5–7.6× native on static pixels and 2.4–6.4× at edges there. The G4 hold makes the lag pass
  much stronger.
- All denoisers boil below the reference's own boil on these moving paths (fixed-seed references; GOLDEN.md "Reference
  noise and boil"), so these calm numbers rank denoisers against each other, not against a clean floor. The G3 hold
  below gives that floor, and it agrees with the G3 orbit ranking.

### Specular (three's SSR, not demodulated)

| | G3 orbit | G4 light-on | G4 colour | G4 fade | G4 lamp switch |
|---|---|---|---|---|---|
| all-pixel PSNR dB (REBLUR def / tuned S / RELAX / **ours**) | 44.64 / 45.33 / 46.72 / **50.23** | 39.14 / 40.36 / 40.10 / **43.75** | 38.04 / 39.36 / 39.12 / **42.58** | 39.40 / 40.68 / 40.41 / **43.83** | 38.65 / 39.90 / 39.91 / **43.26** |
| static boil ×1e3 | 0.76 / 0.45 / **0.42** / 0.77 | 2.73 / 2.01 / **1.65** / 3.01 | 3.10 / 2.20 / **1.82** / 3.35 | 2.70 / 1.97 / **1.62** / 2.97 | 2.43 / 1.83 / **1.63** / 3.06 |
| edge boil | 1.92 / 1.73 / **1.41** / 2.84 | 6.10 / 5.29 / **5.05** / 7.57 | 7.12 / 6.19 / **5.84** / 8.68 | 5.96 / 5.18 / **5.00** / 7.43 | 5.67 / 5.24 / **5.19** / 8.01 |
| dynamic error boil | 18.43 / 18.52 / 16.27 / **13.97** | 24.46 / 23.72 / 23.36 / **19.53** | 28.51 / 27.67 / 26.11 / **22.94** | 27.99 / 27.19 / 25.76 / **22.85** | 25.93 / 25.24 / 24.48 / **20.67** |

- **Ours: +3.2…3.5 dB over native's best on every capture and the lowest dynamic error boil, but ~1.8× RELAX's static
  boil and 1.5–2× its edge boil.** Native is calmer on still specular; ours is closer to the reference.
- Specular lag isn't reported as a result: on these pans even the noisy input reads 19+ frames, because the specular error
  drifts with the camera (pre-event error 3–5× the settled level). Values are in each `lag.md`.

### Holds (still camera, 16384 spp)

**G3 hold: the clean calm floor.** On a still camera the fixed-seed reference is identical every frame (its own boil and
still σ are 0), so here calm is measured against zero. Values are REBLUR def / tuned D (tuned S for specular) / RELAX /
**ours**. Still σ is the per-pixel temporal std from frame 8 on, in 8-bit levels after the tonemap (`calm.mjs`
`stillSigma255`).

| G3 hold | diffuse | specular |
|---|---|---|
| all-pixel PSNR dB | 31.92 / 33.41 / **34.44** / 33.30 | 45.36 / 48.60 / 46.93 / **52.87** |
| static-pixel PSNR dB | 33.99 / 35.24 / **36.24** / 35.52 | 48.91 / 52.11 / 51.53 / **55.78** |
| still σ, 8-bit levels (noisy: 24.3 / 2.14) | 0.43 / **0.36** / 0.63 / 1.19 | 0.049 / **0.028** / 0.050 / 0.034 |
| static boil ×1e3 | 0.55 / **0.41** / 2.08 / 3.13 | 0.08 / **0.07** / 0.20 / 0.16 |
| edge boil | 1.66 / **1.53** / 4.15 / 9.76 | 0.20 / **0.16** / 0.46 / 0.54 |
| history-ramp boil (age 2–7, i.e. frames 2–7 after the start) | 14.12 / 9.92 / **5.66** / 7.89 | 1.16 / 0.73 / 0.73 / **0.44** |

- **Diffuse: on a still Sponza view, RELAX beats ours on both detail (+0.7 dB static) and calm (still σ 0.63 vs 1.19,
  static boil −34 %, edge boil −57 %).** Tuned REBLUR is the calmest by far: still σ 3.3× lower than ours, static boil
  7.6× lower, edge boil 6.4× lower. It gives up 0.3 dB of static detail to ours for that. Ours shimmers at about 1.2
  8-bit levels on a converged still image. This confirms G3 orbit's calm gap against a true floor.
- **Specular: ours leads detail by 3.7–4.3 dB and is mid-pack on calm** (still σ 0.034, between tuned S's 0.028 and
  RELAX's 0.050). Its edge boil is the highest (0.54 vs 0.16–0.46).
- AO, ours: still σ 1.03 levels, static boil in `calm.md`. Native AO is not comparable (below).

**G4 hold-light-on: light step on a still camera.** Diffuse PSNR dB per frame (tuned D / RELAX / **ours**). REBLUR
defaults sits 0.2–1.2 dB below tuned D at these frames (31.2 / 15.1 / 15.6 / 17.2 / 19.3 / 22.0); see
[lag.md](golden-G4-hold-light-on/lag.md).

| frame | 15 (before) | 16 (step) | 17 | 20 | 24 | 31 (last) |
|---|---|---|---|---|---|---|
| REBLUR tuned D | 32.4 | 15.3 | 15.9 | 17.7 | 19.9 | 22.6 |
| RELAX | **33.4** | 15.9 | 16.6 | 19.2 | 22.6 | 25.5 |
| ours | 32.6 | **24.9** | **28.1** | **30.3** | **31.4** | **32.0** |

- **Native has not recovered 15 frames after the step.** It climbs about 0.5 dB per frame and ends 7.9 dB (RELAX)
  and 9.8 dB (tuned REBLUR) below its own pre-step level. Ours loses 7.7 dB on the step frame, is within 2.3 dB after
  4 frames, and is back within 1.1× of its pre-step error after 13 frames (lag-to-pre). Native's lag-to-pre is "never"
  within the hold.
- On the pan paths, native's lag was 16–20 frames. A still camera removes the disocclusions that refresh part of the
  history on a pan, and native gets slower. Ours is about as fast on both.
- Track D's settled-band lag (settled = the last 8 frames here) reads 11 for native and 8 for ours. That understates
  native's lag, because native is still converging at the end of the hold. Use the per-frame table and lag-to-pre.
- Native runs with default anti-lag settings here (as everywhere in this report). Tuning them was not part of the brief
  and was not swept, so this is native at defaults, not native at its best, on light changes.
- Specular all-pixel PSNR: 36.6–37.8 native vs 44.9 ours. Calm on this capture mixes the step into "static" pixels
  (the reference's own still σ is 17.7 levels), so it isn't reported as a result.

### G2 occluder and G5 turntable (diffuse and specular)

REBLUR def / tuned D (tuned S for specular) / RELAX / **ours**:

| | G2 diffuse | G5 diffuse | G2 specular | G5 specular |
|---|---|---|---|---|
| all-pixel PSNR dB | 31.81 / 36.88 / 35.28 / **39.25** | 35.94 / 36.32 / 36.95 / **38.00** | 39.94 / 40.33 / 41.95 / **45.61** | 42.23 / 42.14 / 43.83 / **49.38** |
| static boil ×1e3 | 0.28 / **0.22** / 0.68 / 0.64 | **0.51** / **0.51** / 0.75 / 2.81 | 0.11 / **0.09** / 0.30 / 0.68 | 0.43 / **0.41** / 0.42 / 1.04 |
| edge boil | 1.75 / **1.52** / 1.96 / 3.38 | 5.47 / **5.35** / 5.53 / 13.87 | 1.34 / **1.31** / 2.46 / 6.41 | 2.16 / **2.10** / 2.59 / 7.08 |
| disoccluded boil | 9.95 / 3.75 / **1.31** / 1.99 | 6.01 / 4.68 / **2.98** / 5.83 | 3.08 / **1.88** / 2.24 / 2.11 | 1.95 / 1.82 / **1.70** / 2.61 |
| dynamic error boil | 43.37 / 42.81 / 41.55 / **40.18** | 61.60 / 61.61 / 60.56 / **56.05** | **17.64** / **17.64** / 19.21 / 18.21 | 44.96 / 45.03 / 39.23 / **25.21** |
| reference's own static boil | 0.21 | 5.94 | 0.38 | 1.16 |

- **Detail: ours leads everywhere.** Diffuse is +2.4 dB over tuned REBLUR on G2 and +1.1 dB over RELAX on G5. Specular
  is +3.7 dB on G2 and +5.5 dB on G5 over RELAX.
- **Calm: the G3 pattern again.** Tuned REBLUR has the lowest static and edge boil on both scenes. Ours is about level
  with RELAX on static G2 diffuse, but on G5 its static boil is 3.7–5.5× native and its edge boil 2.5–2.6× native.
  Specular static boil is 2.3–7.6× native and edge boil 2.6–4.9× native. Ours keeps the lowest dynamic error boil on
  diffuse (and on G5 specular by a wide margin), so it follows moving content best.
- On G5 the reference itself boils above most denoisers (static 5.94, from the turntable moving under a fixed-seed
  pattern), so those calm numbers are a ranking, not a distance to a floor.

### Shadows (G2 occluder): SIGMA vs ours `shadows` vs `ffx-shadows`

| visibility | SIGMA | ours `shadows` | `ffx-shadows` | native REFERENCE (running mean, still camera) |
|---|---|---|---|---|
| all-pixel PSNR dB (noisy 16.85) | 21.49 | **36.47** | 28.53 | 26.82 |
| penumbra PSNR (pooled) | 12.48 | **28.87** | 22.70 | 20.02 |
| dynamic-region PSNR | 8.87 | **22.97** | 16.35 | 9.49 |
| static boil ×1e3 | 75.78 | 1.94 | **1.46** | – |
| edge boil | 61.55 | **6.55** | 10.07 | – |
| disoccluded boil | 76.66 | **5.67** | 8.46 | – |
| dynamic error boil | 350.68 | **11.00** | 12.91 | – |
| reference's own boil (static / dynamic) | 0.43 / 8.55 | | | |

- **Ours leads on every number except static boil, where `ffx-shadows` is 25 % calmer.** The frame-40 strip
  ([crop_f40_visibility.png](golden-G2-occluder/crop_f40_visibility.png)) shows how each gets there: `ffx-shadows`
  blurs the penumbra wide, SIGMA leaves visible grain, and ours is closest to the reference. It is +7.9 dB over
  `ffx-shadows` overall and +6.2 dB in penumbrae.
- **SIGMA's numbers here reproduce round 2's on the same kind of content to two decimals**: `three-knot-static` there
  scored 21.50 overall, 12.53 penumbra, 8.81 dynamic, with boil 0.36 dynamic and 0.21 static penumbra; here 21.49 /
  12.48 / 8.87 / 0.36 / 0.21 (`compare.md`). Round 2 checked the SIGMA inputs one convention at a time: the penumbra
  pack matches a CPU recomputation exactly, a light-size sweep didn't help, and the viewZ sign and a fully still scene
  made no difference ([../ROUND2.md](../ROUND2.md)). So this is not a new mismatch. What is still open is the same
  as round 2: there is no known-good SIGMA integration to compare against. Treat the SIGMA column as "SIGMA through
  this harness", not as a verdict on SIGMA.

### AO

Ours (`occlusion-svgf-auto`): 30.59 dB on G3 orbit, 26.10 dB on G4 (identical on all four G4 paths: AO depends only on
geometry, camera and seed; `ao_ref` is byte-identical across them). **Native `REBLUR_DIFFUSE_SPECULAR_OCCLUSION` is not
comparable**: its output is on NRD's hit-distance normalization, not the curve our `ao_ref` uses (rounds 1–2, P3). Its
frames are kept (`nrd-reblur-occlusion*`), and it enters the cost table only.

### Sanity: REFERENCE

On the moving-camera captures (G3 orbit, the four G4 pans), `REFERENCE` equals its noisy input (PSNR noisy → out
identical to 0.01 dB, all signals), as on the synthetic captures. On the still-camera captures (both holds, G2 occluder,
G5 turntable) it accumulates instead, as on `synthetic-static` (P1: a per-pixel running mean, no reprojection). For
example, G3 hold diffuse goes 16.75 → 24.39 dB, and on G5 visibility it smears the turning helmet (25.33 → 20.45).
Both behaviours match the earlier rounds, so the harness wiring is unchanged on the golden format (CAPTURE-FORMAT v1 on
G5 included). This was not re-checked bit-for-bit against a CPU running mean here.

## Which comparisons are like-for-like

| comparison | like-for-like? | why |
|---|---|---|
| detail / calm / lag, ours vs native, diffuse | **yes** | same input bytes, guides, motion and references; same scorer and regions |
| … except native's guides | slightly in ours' favour | NRD gets normals and roughness quantized to ~10 bits (encoding 2; encoding 4 doesn't build at `e06852b`, SETUP.md) |
| REBLUR "tuned" | native at its best **for our earlier scenes** | the ROUND3 setting (A = 0.01 diffuse; (0.1, 0.1, 1) specular), not re-swept on Sponza / Bistro; A = 0.01 is at the flat end of the curve, so a re-sweep is unlikely to move REBLUR far |
| specular | **inputs equal, but not native's design point** | NRD expects demodulated specular radiance; the golden scenes deliver three's SSR with its GGX weight, not demodulated (as all earlier captures). Ours sees the same signal |
| ours = golden `ours` | yes by construction, not re-verified bit-for-bit | the test bed's `svgf-auto` is the package's default `DiffuseSpecularDenoiser` options, which is what golden `ours` builds for diffuse + specular |
| AO | **no** | different normalization (above) |
| calm vs a clean floor | **no** on the moving paths; **yes on G3 hold** | moving paths: the reference boils above every denoiser. G3 hold: the reference is constant (boil 0) |
| G4 hold calm | **no** | the light step lands inside the still-σ window; G4 hold is a lag capture |
| light-change lag, native | native at **defaults**, not at its best | anti-lag settings were not tuned or swept (not in the brief) |
| shadows: SIGMA vs ours / ffx | inputs equal and checked (ROUND2); **integration unverified** | no known-good SIGMA integration to compare with; SIGMA's G2 numbers match round 2's knot captures |
| G5 guides | same capture bytes | native gets the capture's `normal` buffer, which on G5 is the shading normal (GOLDEN.md known limits); the v1 `normal_geom` extra buffer is not given to NRD |
| lag | yes, two definitions | settled band (track D) misreads late camera drift as "never"; lag-to-pre misreads paths where the settled level legitimately differs from the pre-event level (light-on). Both are given |
| cost (pending) | GPU ms yes; wall no | native wall is fence-to-fence in-process; ours is `onSubmittedWorkDone` in Chrome (tracks/d.md §6) |

## Cost (step 4): pending

Not measured yet. The cost runs need both clocks locked from an admin shell
(`nvidia-smi -lgc 1200,1200`, `nvidia-smi -lmc 7001,7001`): unlocked, the driver clocks Chrome's WebGPU work at ≤ 780 MHz
and native at ~1.9 GHz, which made round 1's timings bimodal (SETUP.md). This session isn't elevated. Ready to run:
[tools/time-golden.ps1](tools/time-golden.ps1) (1080p timing captures of G3 orbit / G4 pan-light-on; native with
`--loops 8`; golden `time` for ours / ffx / raw, 3 alternating rounds, cool-down gate; then track D's bench pages via
[tools/bench-win.mjs](tools/bench-win.mjs)).

- The golden `time` command has no timestamps-off switch and its `wall` is the whole frame (rays + denoiser), so the
  denoiser's wall share is taken as ours − `raw` on the same page config. Timestamps on / off come from track D's bench.
- Of track D's 13 cost pages, **3 can't be reproduced here**: `c-bg`, `c-one`, `c-bgone` were built from frozen package
  copies with local patches that were never committed (track D's `tools/wrap.ts` imports them from a Mac scratchpad). The
  other variants run through [tools/wrap-win.ts](tools/wrap-win.ts) (a copy of track D's wrapper pointing at the package
  in a scratch worktree of `track/d-diffuse`) and [tools/cost-pages-win.json](tools/cost-pages-win.json).
- The per-frame `gpuMs` / `wallMs` in these replays' `timings.csv` and `compare.md` are **not cost numbers**: clocks were
  unlocked and the laptop was thermally limited (88–89 °C, `SW thermal slowdown`) during the whole session.

## How this was run

[tools/](tools/): `pipeline.ps1` (per item: capture → validate → `process-capture.ps1`), `process-capture.ps1` (native
defaults + tuned, ours via `run-headless.mjs mode=replay`, then `compare.mjs` and `calm.mjs`), `collect.ps1` (this
folder), `lag.mjs`, `crops.mjs`, `summary.mjs`. Captures: 20 s / frame (G3) and 52–56 s / frame (G4) at 4096 spp on the
thermally limited laptop, so ≈ 22 min and ≈ 57 min per path. Group 2: G3 hold 37 min and G4 hold 89 min (32 frames at
16384 spp), G2 occluder 5 min, G5 turntable 8 min. Every capture validated VALID on the first try, with no device
loss.

Incidents, none affecting results: a hand-over script failed to stop the first capture chain, so for about a minute two
G4 captures started while G3 was being processed; both were stopped and their partial folders removed before any G4
capture was kept. A PowerShell variable clash made the first G3 processing pass skip every step; it was rerun.
