# T0-scenes: the golden scenes

_Agent T0-scenes, branch `track/t0-scenes` (worktree `Denoiser-track-t0s`, cut from `feat/rt-denoiser-cleanroom`). Contract and
scene documentation: [examples/three-temporal/GOLDEN.md](../../../../examples/three-temporal/GOLDEN.md). Role: implementer of test
tooling (RULES.md). No NRD source was opened; no change under `packages/**`._

## What is done

All of GOLDEN.md's Status section, plus: contract committed first (`08cd412`); registry, kits, engine, page, Node driver, G5 asset
(`02d3c7e`); G1 move cherry-picked (`16720b8`, R's commit `8c1ef6b`; only registered, not rendered by the engine); G4 light-change
paths, G3 hold, fixed reference seeds (coordinator's request from track D). Asset: Flight Helmet, CC0 (NOTICE in the asset folder).
Full captures were queued under the GPU lock (S, scorecard and D held it for long stretches): check `/tmp/t0s-full.log`.

## Commits

`git log track/t0-scenes -- examples/three-temporal/src/golden examples/three-temporal/GOLDEN.md`

## Commands

```
node node_modules/vite/bin/vite.js examples/three-temporal --port 5301 --strictPort --host 127.0.0.1   # RT_SCENE_ASSETS=<dir> for G3/G4
node src/golden/driver.mjs list|record|snapshot|determinism|time|capture ...    (see its header, GOLDEN.md)
src/golden/capture-all.sh
```
