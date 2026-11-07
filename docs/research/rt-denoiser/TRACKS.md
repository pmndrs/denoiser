# Tracks (from 2026-11-07)

_The working board for the reset in [STOCKTAKE-2026-11-06.md](STOCKTAKE-2026-11-06.md) §5.
Work is bound to measures of success, not dates. The coordinator (the main session) owns this
file; each track writes only its own `tracks/<id>.md`. Rules: [RULES.md](RULES.md) (clean room,
binding), [TASKS.md](TASKS.md) "How agents work here" (rules 1–12 still apply, esp. 9, 11, 12),
[LESSONS.md](LESSONS.md) (read the sections for your area first)._

## Board

| track | branch / worktree | model | phase | status |
|---|---|---|---|---|
| T0-scenes: golden scene registry, G5, G2–G4 paths, perfect-input + reference modes | `track/t0-scenes` · `../Denoiser-track-t0s` | Sonnet | 1 | running |
| T0-scorecard: runner, metrics, dashboard, calibration mode for T1 | `track/t0-scorecard` · `../Denoiser-track-t0c` | Sonnet | 1 | running |
| T0-native: golden captures through native NRD | Dennis's Windows machine | – | 1 | waits for T0-scenes captures |
| T1 calibration: Dennis blind A/B | – | Dennis | 1 | waits for T0-scorecard |
| R reflections (G1, G5) | `track/r-reflections` · `../Denoiser-track-r` | Opus | 1: diagnosis | running |
| S shadows (G2) | `track/s-shadows` · `../Denoiser-track-s` | Opus | 1: diagnosis | running |
| D diffuse + AO + cost (G3, G4) | `track/d-diffuse` · `../Denoiser-track-d` | Opus | 1: diagnosis | running |
| O OIDN 3 | – | Opus | – | waits for the OIDN 3 release |

## Gates (measures, not dates)

- **Phase 1 → 2 (all tracks):** the dashboard shows today's numbers for ours, FFX and native on
  G1–G5, **and** each metric used by a gate agreed with Dennis on ≥ 8 of 10 blind A/B pairs (T1),
  **and** the track's diagnosis report is in.
- **R exit:** calm ≤ FFX on G1 (traced and hybrid), bias within 1 luma of the reference,
  Dennis's visual OK. Reassess after two failed fix attempts.
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
| everyone | `docs/research/rt-denoiser/tracks/<own id>.md`, `docs/research/rt-denoiser/results/data/<own id>/**` |
| coordinator | this file, STOCKTAKE, PLAN, SPEC, TASKS, the status page |

Phase 1 is diagnosis: **no default changes** in `packages/denoiser-realtime`. Instrumentation
(debug views, counters) and experiments behind options are fine in your own files.

## Shared resources

- **GPU lock:** `RT_GPU_LOCK=/tmp/rt-gpu.lock` (TASKS rule 11). Anything longer than a short
  smoke test holds it; release between batches.
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
