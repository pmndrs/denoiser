# Brief: native NRD on the golden scenes (Windows RTX machine)

_2026-11-07, from the coordinator. For the harness builder (RULES.md rule 4 / rule 8 role table).
Read [../RULES.md](../RULES.md), [../TRACKS.md](../TRACKS.md) and
[../../../../examples/three-temporal/GOLDEN.md](../../../../examples/three-temporal/GOLDEN.md) first.
Same constraints as before: NRD lives in `C:\dev\nrd-reference\` outside the repo, nothing from
NRD is committed, and you don't write or review our denoiser code._

## Why

The reset ([../STOCKTAKE-2026-11-06.md](../STOCKTAKE-2026-11-06.md)) judges every denoiser on
**golden scenes**: real three.js scenes with deterministic paths and clean references. Native NRD
has **never run on Sponza or Bistro, or on any light change**, and track D's phase 2 can't compare
calm or lag with native until it has. Native outputs are also needed as dashboard rows.

## What to do

1. **Update:** `git pull` on `feat/rt-denoiser-cleanroom` (it now has `examples/three-temporal/src/golden/`),
   `git lfs pull` for the scene assets (Sponza, Bistro; see `examples/three-temporal/CAPTURES.md`),
   `yarn install`, `yarn build:lib`.
2. **Make the captures on this machine** with the golden driver, so nothing has to be copied
   across (each is ~4.2 GB at half resolution). Start the page server
   (`node node_modules/vite/bin/vite.js examples/three-temporal --port 5301 --strictPort --host 127.0.0.1`,
   with `RT_SCENE_ASSETS` if the assets aren't in the default place), then follow
   `examples/three-temporal/src/golden/capture-all.sh`. It's bash, so run its `driver.mjs capture`
   lines one by one in PowerShell, or under Git Bash. Priority order:
   G3 `orbit` → G4 `pan-light-on`, `pan-light-colour`, `pan-light-fade`, `pan-lamp-switch` →
   G3 `hold` and G4 `hold-light-on` (16384 spp) → G2 `occluder` → G5 `turntable`.
   Validate each with `node tools/rt-capture/validate.mjs <name>`. The same seeds give the same
   scenes as on the Mac; GPU rounding may differ slightly, which is fine because references come
   from the same machine as the inputs.
3. **Replay each capture through native NRD** with the existing harness:
   - `REBLUR_DIFFUSE_SPECULAR` at **defaults** and at **tuned** hit-distance settings (diffuse
     A = 0.01; specular (0.1, 0.1, 1), as in ROUND3);
   - `RELAX_DIFFUSE_SPECULAR`;
   - `REBLUR_DIFFUSE_SPECULAR_OCCLUSION` for AO;
   - `SIGMA_SHADOW` on G2;
   - `REFERENCE` as the sanity check.

   **Keep the full output frames** (not only metrics). Calm (motion-compensated boil) is
   computed from them, and the scorecard needs them (step 5).
4. **Same-GPU cost of ours, with wall time:** run our denoisers on this machine through the
   golden driver's `time` command (GOLDEN.md) on G3 and G4 at 1080p, GPU idle, timestamps on and
   off. Also run track D's bench pages (`git show origin/track/d-diffuse:docs/research/rt-denoiser/results/data/d/cost-pages.json`,
   method in `tracks/d.md` on that branch). On the RTX, our wall time was 2–3.5 ms above GPU time
   (Mac: ~0.6 ms); we need to know where that comes from.
5. **Scoring:** once the scorecard lands on this branch (`tools/scorecard/`, from track
   T0-scorecard), run it on the native outputs and ours. Until then, `tools/rt-capture/compare.mjs`
   plus track D's calm scorer (`results/data/d/calm.mjs` on `track/d-diffuse`) are fine.

## What comes back

On `feat/rt-denoiser-native-results` (as before), only under `docs/research/rt-denoiser/native/`:
`results/golden/<capture>/` with metrics (`compare.md` / `.json`, calm / lag tables), `run.json`,
`timings.csv` and a few small crops. A `results/golden/README.md` summary covers native vs ours on
calm, lag, detail and cost, and says which comparisons are like-for-like. Raw outputs stay in
`C:\dev\nrd-reference\outputs\`; say where they are.

## Kickoff prompt for the Windows agent

> Pull `feat/rt-denoiser-cleanroom` and read `docs/research/rt-denoiser/RULES.md`, `TRACKS.md`,
> `examples/three-temporal/GOLDEN.md`, then `docs/research/rt-denoiser/native/GOLDEN-BRIEF.md`.
> You're the harness builder (rule 4). Do steps 1–4 of GOLDEN-BRIEF in priority order (G3 and the
> G4 light-change paths first), keeping native output frames on disk. Report back on
> `feat/rt-denoiser-native-results` under `docs/research/rt-denoiser/native/` only. Never commit
> anything from NRD.
