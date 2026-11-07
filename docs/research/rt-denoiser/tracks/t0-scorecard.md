# T0-scorecard: runner, metrics, dashboard, calibration mode

_Agent T0-scorecard (Sonnet), branch `track/t0-scorecard` (cut from `feat/rt-denoiser-cleanroom`), 2026-11-07. Role: evaluator /
tooling (RULES.md §8); no NRD code or README opened; native rows are imported from the existing black-box result files.
No change under `packages/**`._

## What is done

| item | where | state |
|---|---|---|
| Runner + metric library: the five numbers | `tools/scorecard/` (`run.mjs`, `lib/metrics.mjs`, `lib/cost.mjs`, `lib/native.mjs`, `lib/report.mjs`, `lib/crops.mjs`, `lib/gpu-lock.mjs`, `scenes.json`, `README.md`) | done, runs end to end |
| Dashboard | `docs/research/rt-denoiser/scorecard/{latest.json, latest.md, index.html, crops/}` | first numbers on the kept captures (G2-G4 provisional + the two corner captures) |
| Calibration mode (blind A/B) | review bench button "Blind A/B calibration": `examples/three-temporal/src/review/calibration.ts`, `calibration/{pairs.json, sheets/*.png}`; one `<script>` line in `review.html` | built and tested in the bench with synthetic pairs (answers, keys, copy button, analysis script); the real pair set is NOT generated yet: the committed `pairs.json` is an empty stub until `make-pairs.mjs` has run (GPU queue) |
| Pair builder + agreement script | `tools/scorecard/calibration/{make-pairs.mjs, analyze.mjs, sources.json, key.json}` | built and tested in the bench with synthetic pairs (answers, keys, copy button, analysis script); the real pair set is NOT generated yet: the committed `pairs.json` is an empty stub until `make-pairs.mjs` has run (GPU queue) |
| Golden scenes G1 / G5, G2-G4 golden paths | waiting for T0-scenes (see "Next") | not started here: `GOLDEN.md` is on `track/t0-scenes` (contract only so far) |

## Commands

```sh
yarn install && yarn build:lib
export RT_GPU_LOCK=/tmp/rt-gpu.lock
node tools/scorecard/run.mjs                    # every scene: replay -> score -> dashboard (about 14 min incl. lock waits)
node tools/scorecard/run.mjs --scenes G2-knot-static,corner-orbit
node tools/scorecard/run.mjs --cost-only        # 1080p cost, rule 11 protocol (lock + idle GPU), keeps the scene tables
node tools/scorecard/run.mjs --report-only      # rebuild latest.md / index.html from latest.json
tools/scorecard/regenerate.sh                   # everything, step by step under tools/gpu-lock.sh
node tools/scorecard/calibration/make-pairs.mjs # rebuild the blind pairs (replays, windowed scoring, sheets)
node tools/scorecard/calibration/analyze.mjs results.json   # agreement per metric from the bench's "Copy results"
```

Defaults and options are in `tools/scorecard/README.md`. Raw outputs go to `../scorecard-work-track-t0c/` (outside git; captures are
symlinked from `Denoiser-nrd-cleanroom/tools/rt-capture/captures/`, never copied) and are deleted after scoring.

## The five numbers as implemented

(definitions in `tools/scorecard/README.md`; summary here)

1. **Calm.** Motion-compensated boil (second temporal difference / √6 on tonemapped values along the reprojected history) in three
   regions: *static*, *moving* (the reference changed by > 0.05 within 4 frames along its history), *disoccluded* (history age 2-6
   frames); each reported with the clean reference's own boil in the same pixels and as a ratio. Plus still-camera σ of luma on
   the captures with a static camera. Scored only ≥ 8 frames after a reset. The score-captures.mjs boil is kept as `legacyBoil`.
2. **Detail.** FLIP (the test bed's viewing condition) against the capture reference, PSNR beside it.
3. **Lag.** Frames until the per-frame RMSE is within 10 % of the settled level, per event; events are read from the manifest
   (first frame, `reset` frames, light intensity / colour changes), so G4's `light-on` and G1/G5 cuts need no code.
4. **Bias.** Mean display luma (tonemap, sRGB OETF, ×255) minus the reference, in 8-bit levels. `tonemap: "aces"` per scene for the
   golden scenes' display transform.
5. **Cost.** Per-pass GPU ms and wall ms at 1080p on a synthetic plane capture, 3 rounds, rule 11 protocol.

Metric choices to check with Dennis (T1): the *moving* region threshold (0.05 / 4 frames), boil on tonemapped values, the 10 %
lag tolerance, and that lag on a continuously moving camera (orbit, pan) is only a rough number: the error never "settles" there.

## First dashboard numbers (kept captures, M5 Pro, ours = shipped defaults)

From the first full run (commit 8a35e62; before the dense-geometry region, tails, bilinear history and the golden G4 capture, which a regeneration adds; boil in that run used the nearest tap and showed a ratio to the reference): ours vs FFX on shadows, boil moving / static, FLIP.

| scene | ours moving / static boil | FFX moving / static boil | FLIP ours / FFX / native sigma |
|---|---|---|---|
| G2 knot static camera | 0.0177 / 0.0021 | 0.0352 / 0.0020 | 0.0174 / 0.0470 / 0.0496 |
| G2 knot orbit | 0.0634 / 0.0117 | 0.0405 / 0.0065 | 0.0193 / 0.0545 / 0.0495 |
| G3 Sponza moving knot | 0.0844 / 0.0058 | 0.0465 / 0.0035 | 0.0264 / 0.0682 / - |
| G4 Bistro moving lantern | 0.0619 / 0.0055 | 0.0417 / 0.0041 | 0.0285 / 0.1089 / - |

Reading: on a static camera ours is calmer than FFX in the moving-occluder region and level in static penumbrae; on moving cameras
ours boils more than FFX (the gap Dennis sees) while keeping 2-4x less FLIP error. Diffuse on corner-orbit: ours FLIP 0.037 vs
native REBLUR 0.078 / RELAX 0.056 (default settings). Full tables: `docs/research/rt-denoiser/scorecard/latest.md`.

**Regenerating with the current code is pending the GPU queue.** The coordinator's four metric requests are implemented (commit
8de3257 and eea..46c: dense-geometry region reported separately; absolute boil with the reference floor as context, no ratio shown;
bilinear two-hop motion compensation; p99 and pop fraction per region; a "calm vs sharp" trade-off pair type in the calibration set;
wall time with timestamps off where the registry honours `timestamps=0`), but T0-scenes' long captures held the lock for over an hour
without using the queue, so `tools/scorecard/regenerate.sh` (replays, scoring, calibration replays, 1080p cost, pairs; each step under
`tools/gpu-lock.sh`) has not run. Run it once the queue is free; it rewrites `latest.*` and the calibration set, and the cost table
(none yet) fills the cost gate. The bilinear / tail code was only syntax-checked and run on one capture without replays, so expect a
fix round on the first run.

## Caveats

- **References are 1024-2048 spp** (the kept captures), not 4096. Reference noise sets the floor of every boil / FLIP number; the
  per-region ratio to the reference's own boil is there for that reason. Golden captures with 4096-spp references will move the ratios.
- **Pre-golden scenes.** G2-G4 rows use `three-knot-static/-orbit`, `sponza-orbit/-move`, `bistro-pan/-move/-hold`; there is no
  G4 light-switch capture yet and no G1 / G5. The scene entries are marked "provisional" in the dashboard.
- **Native rows** are imported (default settings, RTX 3060 Laptop, REBLUR at A = 0.01 only where the old rounds ran it): FLIP, PSNR and
  lag (from per-frame PSNR) are comparable; boil regions, σ and bias need native outputs (`RT_NATIVE_OUTPUTS`; T0-native). Sponza
  and Bistro have no native run. Native cost is the RTX's, marked †.
- **FFX** exists for shadows and reflections only; diffuse / AO rows have no FFX.
- **Ours** = registry ids `svgf` (diffuse + specular), `shadows`, `occlusion-svgf`; they track the package source at run time, and the
  dashboard header records the repo and package commits.
- **Cost on the 1080p synthetic capture** is content-independent for these filters but not identical to a real scene's wall time.
- The run holds the GPU lock for the replays and for the timing run only; the Mac was shared with tracks D / R / S, so lock waits
  dominated the wall time (the scoring itself is CPU, about 20 s per scene and signal).

## Next

- T0-scenes: when `golden.html` / `capture` mode lands, add G1-G5 to `scenes.json` (captures via `RT_CAPTURE_DIR`, `capturesDir` per
  scene, `tonemap: "aces"`, `perfect` and `reference` captures as extra scenes). Merge `track/t0-scenes` into this branch first.
- T0-native: native outputs for the golden captures under `$RT_NATIVE_OUTPUTS` fill the native rows' boil / σ / bias columns.
- T1: Dennis answers the blind pairs; `analyze.mjs` reports agreement per metric definition (the bench lists several definitions of calm).
