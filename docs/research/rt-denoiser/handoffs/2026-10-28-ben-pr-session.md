# Handoff: the Ben Houston PR #35228 session (2026-10-26 to 10-28)

_Closed by Dennis: "this session has gone long and is tainted". Start the next session from
[results/REFLECT-BENCH.md](../results/REFLECT-BENCH.md) (findings + plan). This file is the map of what exists._

## What the session did, in order

1. **Compared Ben's `CoverageDenoiseNode` (three.js PR #35228) with our denoisers.**
   - His design: a coverage-weighted spatial + temporal filter for SSR, plus TRAA.
   - Ours: FFX reflections, plus the realtime SVGF / recurrent filters, with FSR3 as the resolver.
2. **Interior lab:** Ben's kitchen-sink interior example as a split bench (worktree `../Denoiser-interior-lab`, branch
   `feat/interior-lab`). It is superseded and its files are still there; Dennis can decide whether to delete them.
3. **Workbench (`workbench.html`):** our scenes, probes, SSR + SSGI, FSR3, every denoiser except OIDN, three's
   multi-canvas `CanvasTarget` panes.
   - Ben's PR head (3210e46) is vendored in `src/workbench/ben/` as pane options: his SSR, coverage denoiser and TRAA,
     plus a scene from his `webgpu_postprocessing_ssr.html`.
   - Later additions: the planar reflector reference for the table, and the `missZero` and guard toggles.
4. **`dropoutGuard`** (recurrent specular, opt-in), in the cleanroom: v1 bd8110a, v2 31add09, ablation ae853ef, resolver
   numbers a38a51a. See results/DROPOUT-GUARD.md. **Paused**: it was designed against Ben's SSR scene.
5. **Reflection bench (`reflect-bench.html`, 9b41e63):** reflections only, on Ben's model, using the reflections-hybrid
   pipeline. It showed that the boil is three's SSR march, and that FFX beats both of ours. This is the base for the next
   session.

## Where things are

| What | Where |
|---|---|
| Plan + findings | `docs/research/rt-denoiser/results/REFLECT-BENCH.md` (this branch), TASKS.md entry "Restart reflections from the reflection bench" |
| Reflection bench | `../Denoiser-interior-lab/examples/three-temporal/reflect-bench.html`, `src/reflect-bench/main.ts`, `REFLECT-BENCH.md` |
| Workbench | same worktree: `workbench.html`, `src/workbench/`, `WORKBENCH.md` |
| Run | `cd ../Denoiser-interior-lab/examples/three-temporal && yarn dev` → http://127.0.0.1:5220/reflect-bench.html (needs `../three.js` for the model locally, else GitHub r186; `../upscaler` for `upscaler-src`). In a fresh worktree run `yarn build:lib` first |
| Coverage-input idea | GitHub issue #23 |
| Review desk (status page) | https://claude.ai/artifact/T9NQMZRaoA1cbQKocXQksv (stale after ac7f763) |

**Commits:**
- `feat/interior-lab`, none pushed: 60797a8, 45d96e1, e6591b5, 4864d96, a44378a, e250536, ac7f763, 63d720d, 9b41e63.
- `feat/rt-denoiser-cleanroom`, not pushed: bd8110a, 31add09, ae853ef, a38a51a, plus this handoff.

## Library state (the "taint" check)

The only change to `packages/denoiser-realtime` is the `dropoutGuard` / `tune.dropoutParts` option:
- Recurrent specular only, default off.
- The default WGSL is byte-identical (495,629 bytes).

No default changed. The interior-lab worktree carries a mirrored copy of those package files (already built), so keep
the two in sync until the bench moves to this branch (plan, Phase 0).

## Don't carry forward

- **Numbers from the workbench on Ben's scene.** They mix SSR boil, GI and the resolver. Use the reflection bench
  instead.
- **The guard's tuning** (`dropoutLo 0.1`, `dropoutHi 0.3`). It was tuned on Ben's scene.
- **"Mirrors are fine because clean traced input"** as a reason for recurrent's r = 0 history cap. On the bench we still
  trail FFX with traced input (0.25 vs 0.17 at roughness 0; 0.52 vs 0.40 with model defaults).

## Housekeeping

- `examples/realtime-denoiser/src/paths.ts.orig` (untracked, this worktree) belongs to another session. Leave it.
- Dev servers this session started (5220 interior lab, 5226 realtime test bed, 5262 review bench) end with the session.
