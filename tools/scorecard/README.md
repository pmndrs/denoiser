# tools/scorecard

One command regenerates the real-time denoiser scorecard: the five numbers of
[TRACKS.md](../../docs/research/rt-denoiser/TRACKS.md) for every scene in `scenes.json`, as
`docs/research/rt-denoiser/scorecard/{latest.json, latest.md, index.html}` (open `index.html` directly: one table
per scene and signal, gates pass/fail, crop strips embedded). Raw outputs stay outside git and are deleted after scoring.

```sh
yarn install && yarn build:lib                 # once
node tools/scorecard/run.mjs                   # all scenes (cost reused from the last --cost run)
node tools/scorecard/run.mjs --scenes G2-knot-static,corner-orbit
node tools/scorecard/run.mjs --cost            # also time every row at 1080p (rule 11: GPU lock + idle GPU)
node tools/scorecard/run.mjs --report-only     # rebuild latest.md / index.html from latest.json
```

Options: `--captures <dir>` (read only; default `$SCORECARD_CAPTURES` or the kept captures of the cleanroom worktree),
`--work <dir>` (raw outputs; default `../scorecard-work-<worktree>`), `--port 5302`, `--skip-replay`, `--keep`,
`--settle 8`, `--flip-every 4`. `RT_GPU_LOCK` (default `/tmp/rt-gpu.lock`) is held for every replay batch and every timing
run, never while scoring. The runner starts the test bed's Vite server on the port and stops it at the end.

## What is measured

| number | definition (all in `lib/metrics.mjs`) |
|---|---|
| calm | **boil** = RMS of the second temporal difference x_t − 2x_(t−1) + x_(t−2) along the reprojected history, / √6, on tonemapped values (Reinhard per channel for rgb, clamp for visibility / AO), per region and relative to the clean reference's own boil in the same pixels. Regions, per pixel and frame, only ≥ 8 frames after a reset: **moving** = the reference changed by > 0.05 along its history within 4 frames, **disoccluded** = history age 2–6 frames, **static** = the rest. Plus **still σ**: per-pixel temporal σ of luma over the settled frames, where the camera is static, on pixels whose reference σ < 0.01. `legacyBoil` is score-captures.mjs's smooth-mask boil, kept so imported native rows compare. `errBoil` (second difference of out − ref) is in the JSON. |
| detail | FLIP (`examples/realtime-denoiser/src/flip.ts`, image spans 46.4°, every 4th frame) against the capture's `<signal>_ref`; PSNR pooled as secondary. |
| lag | per event (start, `reset` frames, light intensity / colour changes found in the manifest): frames until the per-frame RMSE (tonemapped) is back within 10 % of its settled level (mean of the last quarter of the window to the next event). 0 = no visible warm-up. |
| bias | mean over scored pixels of display luma(out) − display luma(ref), 8-bit levels, display = tonemap then sRGB OETF ×255 (Reinhard here; `tonemap: 'aces'` is in `DEFAULTS`). |
| cost | per-pass GPU ms (timestamp queries) and wall ms (dispatch → queue idle) at 1920×1080 on a synthetic capture, 50 ms warm-up before each dispatch, first frame dropped, median of 3 rounds, GPU lock held and no other headless Chrome running. |

Rows: raw input; `accumulate-32`; ours at shipped defaults (`svgf` diffuse + specular, `shadows`, `occlusion-svgf` AO);
FFX (`ffx-shadows`, `ffx-reflections`); native NRD. Native rows are **imported** from
`docs/research/rt-denoiser/native/results/*/score-captures.json` (FLIP, PSNR and lag, from per-frame PSNR, are
comparable). For region boil, σ and bias the native *outputs* are needed: put them in
`$RT_NATIVE_OUTPUTS/outputs/<capture>/nrd-*/frame_XXXX/<signal>.f32` and the runner scores them like ours.

## Adding a scene (golden scenes from T0-scenes)

Add an entry to `scenes.json` (`capture`, optional `capturesDir`, `native` result folder name, `signals`, `gates`).
Gate metrics are paths into a row (`calm.moving.boil`, `detail.flip`, `lag.0.lag`, `bias.levels`, `cost.gpuMs` with
`"cost": "<cost row id>"`); `vs` is `ffx`, `native` (best native) or a number.

## Calibration (T1)

`calibration/make-pairs.mjs` builds the blind A/B set for the review bench, `calibration/analyze.mjs` scores Dennis's
answers. See the header of each file. In the bench (`yarn workspace three-temporal review`, then
`http://127.0.0.1:5262/review.html`) the **Blind A/B calibration** button in the header opens it: a pair per screen,
labels hidden, left / right randomised, keys ← → ↓ Space, answers kept in localStorage, **Copy results**.
Then `node tools/scorecard/calibration/analyze.mjs results.json`.
