# Tracks (from 2026-11-07)

_The working board for the reset in [STOCKTAKE-2026-11-06.md](STOCKTAKE-2026-11-06.md) §5.
Work is bound to measures of success, not dates. The coordinator (the main session) owns this
file; each track writes only its own `tracks/<id>.md`. Rules: [RULES.md](RULES.md) (clean room,
binding), [TASKS.md](TASKS.md) "How agents work here" (rules 1–12 still apply, esp. 9, 11, 12),
[LESSONS.md](LESSONS.md) (read the sections for your area first)._

## Board

| track | branch / worktree | model | phase | status |
|---|---|---|---|---|
| T0-scenes: golden scene registry, G5, G2–G4 paths, perfect-input + reference modes | `track/t0-scenes` · `../Denoiser-track-t0s` | Sonnet | 1 | **done**, merged (42fb730). Captured and VALID: G3 orbit, hold; G4 pan-light-on, -colour, lamp-switch, hold-light-on; G2 occluder. **G4 pan-light-fade fails validation** (motion-Z reprojection, history consistency), so it's left out of the scorecard until checked. Also VALID: G5 turntable, G2 drift / drift-held / drift-frozen, G3 move |
| T0-scorecard: runner, metrics, dashboard, calibration mode for T1 | `track/t0-scorecard` · `../Denoiser-track-t0c` | Sonnet | 1 | **done**, squash-merged (8a8e128; clip sheets regenerated locally, not in git). Calm headline at stride 8. Cost at 1080p, M5 Pro (GPU / wall ms): ours diffuse+specular 3.60 / 4.50, shadows 0.89 / 1.60 (FFX 0.60 / 1.20), AO 1.52 / 2.20. Next: a lag metric on G1, G1 detail without a resolver, calm clips from 128-frame captures. Further work goes on a new branch from the cleanroom |
| T0-native: golden captures through native NRD | Dennis's Windows machine | – | 1 | **ready to start**: [native/GOLDEN-BRIEF.md](native/GOLDEN-BRIEF.md) |
| T1 calibration: Dennis blind A/B | – | Dennis | 1 | **ready**: 40 pairs (10 each: calm, detail, lag, calm-vs-sharp), 256 px windows, 1.3–2 s loops; 5 of the calm pairs are where stride 1 and stride 8 disagree |
| R reflections (G1, G5) | `track/r-reflections` · `../Denoiser-track-r` | Opus | 1: diagnosis | **diagnosis done** (tracks/r.md on its branch, 8a9a6de, pushed). Ours is unbiased (FFX is 4.5 levels dark, 17.7 on the camera body). Causes: SVGF's specular history is too short (anti-lag never settles on still 1-spp noise), and roughness 0 isn't treated as a mirror. Both fixed together → calmer than FFX on traced, but lags more under motion, and still ~6 % behind on SSR mirrors. Plan F1–F4 (SVGF first; recurrent retired unless it's needed for mirrors; dropoutGuard removed). Waits for T1 |
| S shadows (G2) | `track/s-shadows` · `../Denoiser-track-s` | Opus | 1: diagnosis | **diagnosis done** (87bfba6). Remaining gap: pops in static penumbrae (p99 1.4–2.9× FFX). **New from the scorecard:** with bilinear history, the moving-camera shadow orbit boils 2.1× FFX in the moving region (0.0515 vs 0.0241; p99 0.255 vs 0.111), and the dense region is 2× too; smooth static is level. That contradicts S's "level with FFX on orbits", so it goes into S's phase 2. Waits for T1 |
| D diffuse + AO + cost (G3, G4) | `track/d-diffuse` · `../Denoiser-track-d` | Opus | 1: diagnosis | **diagnosis done** (tracks/d.md on its branch, 02154b7). Waits for T1 + native runs on G3/G4 |
| O OIDN 3 | – | Opus | – | waits for the OIDN 3 release |

## Gates (measures, not dates)

- **Phase 1 → 2 (all tracks):** the dashboard shows today's numbers for ours, FFX and native on
  G1–G5, **and** each metric used by a gate agreed with Dennis on ≥ 8 of 10 blind A/B pairs (T1),
  **and** the track's diagnosis report is in.
- **R exit:** calm (stride 8) ≤ FFX on G1, traced and hybrid, **both with FSR3 1.5× and with no
  resolver**; bias within 1 level of the reference; motion lag no worse than FFX (orbit RMSE as
  the guard until the lag metric covers G1); Dennis's visual OK. Reassess after two failed fix attempts.
- **S exit:** calm ≤ FFX on G2 with the moving occluder, detail (FLIP) better than FFX,
  ≤ 0.6 ms at 1080p on the M5 Pro, Dennis's visual OK.
- **D exit:** calm and lag ≤ native (tuned settings) on G3 / G4, diffuse + specular ≤ 4 ms
  GPU at 1080p on the M5 Pro with wall overhead reported, Dennis's visual OK.
- **Phase 3 (each track):** option count for the track's signal roughly halved with the
  scorecard unchanged, a fresh Opus review of the diff with no blocking findings, Dennis's
  visual OK on the bench → merge into `feat/rt-denoiser-cleanroom` → T6 ships to main.

## The five numbers (definitions T0-scorecard implements)

1. **Calm:** motion-compensated boil (TASKS rule 9 definition, LESSONS "boil"), per region
   (static, moving / dynamic, disoccluded), relative to the clean reference's own boil.
   **Measured 8 frames apart** (reprojection chained over the 8 hops), with stride 1 as a
   secondary column: temporal filters correlate neighbouring frames, so consecutive-frame boil
   hides the slow ripple and can rank filters backwards (track R, tracks/r.md §1).
   Plus still-camera temporal σ of luma where the scene allows (the reflection bench's metric).
2. **Detail:** FLIP against the 4096-spp reference (PSNR kept as a secondary column).
3. **Lag:** frames until error is back within 10 % of its settled level after a cut or a
   light change.
4. **Bias:** mean luma of output minus reference, in 8-bit display levels after the scene's
   tone mapping.
5. **Cost:** per-pass GPU ms and wall ms per frame, 1080p, M5 Pro (rule 11 timing protocol);
   same-GPU ratio to native from the Windows machine.

## File ownership

| owner | paths |
|---|---|
| T0-scenes | `examples/three-temporal/src/golden/**`, `examples/three-temporal/golden*.html`, G5 assets, `examples/three-temporal/vite.config.ts` (input list only), `examples/three-temporal/GOLDEN.md` |
| T0-scorecard | `tools/scorecard/**`, `docs/research/rt-denoiser/scorecard/**`, `examples/three-temporal/src/review/calibration*` (new files; register in the review bench without changing other options) |
| R | `examples/three-temporal/reflect-bench.html`, `examples/three-temporal/src/reflect-bench/**` (moved from `feat/interior-lab`), `packages/denoiser-realtime/src/recurrent.ts`, `shaders/recurrent.ts`, and **only the specular paths** of the SVGF files (ask D for anything shared) |
| S | `packages/denoiser-realtime/src/shadow.ts`, `shaders/shadow.ts`, `examples/three-temporal/src/realtime-shadows.ts` |
| D | the SVGF core: `svgf.ts`, `shaders/svgf.ts`, `shaders/common.ts`, `shaders/prepass.ts`, `shaders/gradient.ts`, `shaders/bindings.ts`, `common.ts`, `gpu.ts`, occlusion files |
| R + D, phase 2 | R edits the **specular branches** of `svgf.ts` / `shaders/svgf.ts`; D owns everything shared. Anti-lag stays in D's `shaders/gradient.ts`: D exposes per-signal parameters, R sets the specular ones. One of them edits a shared file at a time; rebase before each commit |
| everyone | `docs/research/rt-denoiser/tracks/<own id>.md`, `docs/research/rt-denoiser/results/data/<own id>/**` |
| coordinator | this file, STOCKTAKE, PLAN, SPEC, TASKS, the status page |

Phase 1 is diagnosis: **no default changes** in `packages/denoiser-realtime`. Instrumentation
(debug views, counters) and experiments behind options are fine in your own files.

## Shared resources

- **GPU lock:** `RT_GPU_LOCK=/tmp/rt-gpu.lock` (TASKS rule 11). Anything longer than a short
  smoke test holds it. **From 2026-11-07 use the fair queue:** `tools/gpu-lock.sh "<agent> <task>" <command…>`
  (FIFO tickets in `/tmp/rt-gpu.queue`, same lock directory, so it also excludes the old inline
  loop). One batch per call, **≤ 15 min per hold**; call again for the next batch.
- **Dev-server ports:** T0-scenes 5301, T0-scorecard 5302, R 5303, S 5304, D 5305
  (`--strictPort --host 127.0.0.1`).
- **Captures:** `Denoiser-nrd-cleanroom/tools/rt-capture/captures/` holds the kept golden
  captures (Sponza, Bistro, knot, corner scene). Read them from there by absolute path (set
  `RT_CAPTURE_DIR`); don't copy them. New outputs go under your own worktree and are deleted
  when your phase ends.

## Report format (each track, at the end of a phase)

`tracks/<id>.md`: what you measured (numbers, commands, commit hashes), ranked causes with the
evidence for each, proposed fixes with the gate measure each should move and by how much,
risks, and what you need from other tracks. Then a ≤ 10-line final message to the coordinator.
