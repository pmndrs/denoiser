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

**Status.** Group 1 (G3 orbit + the four G4 light-change paths) is done: captured, replayed, scored. **Cost (step 4) is
not in yet**: it needs locked GPU clocks (admin shell; see "Cost" below). Next groups: the two 16384-spp holds, then
G2 occluder (+ SIGMA) and G5 turntable.

**Raw outputs** (every frame of every denoiser, `.f32`, CAPTURE-FORMAT replay layout) are on the Windows machine in
`C:\dev\nrd-reference\outputs\<capture>\<denoiser>\frame_NNNN\` and the captures in `C:\dev\nrd-reference\captures\<capture>\`
(4.2 GB each). Folder names: `nrd-reference`, `nrd-reblur` (defaults), `nrd-reblur-tunedD` (hit distance A, B, C =
0.01, 0.1, 20), `nrd-reblur-tunedS` (0.1, 0.1, 1), `nrd-relax`, `nrd-reblur-occlusion` (+ `-tunedD`), `ours-auto`,
`ours-occ`. Each also has `calm.json` / `calm-ao.json` / `compare.json` next to the denoiser folders.

## Per-capture folders

| folder | path | event |
|---|---|---|
| [golden-G3-orbit/](golden-G3-orbit/calm.md) | Sponza orbit, 64 frames | – |
| [golden-G4-pan-light-on/](golden-G4-pan-light-on/lag.md) | Bistro pan, lantern off → on | step at 32 |
| [golden-G4-pan-light-colour/](golden-G4-pan-light-colour/lag.md) | colour step at constant luminance | step at 32 |
| [golden-G4-pan-light-fade/](golden-G4-pan-light-fade/lag.md) | power ramp | ramp 24 → 40 |
| [golden-G4-pan-lamp-switch/](golden-G4-pan-lamp-switch/lag.md) | lamp A off, lamp B on | step at 32 |

Each folder: `compare.md` / `.json` (PSNR per frame, flicker, bias), `calm.md` / `calm.json` / `calm-ao.json` (boil per
region), `lag.md` / `lag.json` (G4), `capture-manifest.json`, `validate.txt`, `<denoiser>/run.json` + `timings.csv`, and
crop strips `crop_f<frame>_<signal>.png` (128 px per panel: noisy | REBLUR | REBLUR tuned D | RELAX | ours | reference;
tile = the most detailed 128-px tile of the reference; Reinhard + sRGB). G4 crops are 2 frames after the event and
at frame 56.

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
  REBLUR), edge (vs all native) and disocclusion (vs RELAX).
- All denoisers boil below the reference's own boil on these moving paths (fixed-seed references; GOLDEN.md "Reference
  noise and boil"), so these calm numbers rank denoisers against each other, not against a clean floor. The 16384-spp
  holds (next group) give that floor.

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

### AO

Ours (`occlusion-svgf-auto`): 30.59 dB on G3 orbit, 26.10 dB on G4 (identical on all four G4 paths: AO depends only on
geometry, camera and seed; `ao_ref` is byte-identical across them). **Native `REBLUR_DIFFUSE_SPECULAR_OCCLUSION` is not
comparable**: its output is on NRD's hit-distance normalization, not the curve our `ao_ref` uses (rounds 1–2, P3). Its
frames are kept (`nrd-reblur-occlusion*`), and it enters the cost table only.

### Sanity: REFERENCE

`REFERENCE` equals its noisy input on every capture (PSNR noisy → out identical to 0.01 dB, all signals), as on the
synthetic captures: the harness wiring is unchanged on the golden format.

## Which comparisons are like-for-like

| comparison | like-for-like? | why |
|---|---|---|
| detail / calm / lag, ours vs native, diffuse | **yes** | same input bytes, guides, motion and references; same scorer and regions |
| … except native's guides | slightly in ours' favour | NRD gets normals and roughness quantized to ~10 bits (encoding 2; encoding 4 doesn't build at `e06852b`, SETUP.md) |
| REBLUR "tuned" | native at its best **for our earlier scenes** | the ROUND3 setting (A = 0.01 diffuse; (0.1, 0.1, 1) specular), not re-swept on Sponza / Bistro; A = 0.01 is at the flat end of the curve, so a re-sweep is unlikely to move REBLUR far |
| specular | **inputs equal, but not native's design point** | NRD expects demodulated specular radiance; the golden scenes deliver three's SSR with its GGX weight, not demodulated (as all earlier captures). Ours sees the same signal |
| ours = golden `ours` | yes by construction, not re-verified bit-for-bit | the test bed's `svgf-auto` is the package's default `DiffuseSpecularDenoiser` options, which is what golden `ours` builds for diffuse + specular |
| AO | **no** | different normalization (above) |
| calm vs a clean floor | **no** on these paths | reference boil is above every denoiser's; use the holds |
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
thermally limited laptop, so ≈ 22 min and ≈ 57 min per path.

Incidents, none affecting results: a hand-over script failed to stop the first capture chain, so for about a minute two
G4 captures started while G3 was being processed; both were stopped and their partial folders removed before any G4
capture was kept. A PowerShell variable clash made the first G3 processing pass skip every step; it was rerun.
