# Tracks (from 2026-11-07, re-planned 2026-11-25)

_The working board for the reset in [STOCKTAKE-2026-11-06.md](STOCKTAKE-2026-11-06.md) §5.
The coordinator (the main session) owns this file; each track writes only its own `tracks/<id>.md`.
Rules: [RULES.md](RULES.md) (clean room, binding), [TASKS.md](TASKS.md) "How agents work here"
(rules 1–12 still apply, esp. 9, 11, 12), [LESSONS.md](LESSONS.md) (read the sections for your area first)._

## 2026-11-25: build first, tune and prune once at the end (Dennis)

Long tuning rounds and calibration gates were blocking feature work. From now on:

- **Phase 2 builds features and tooling.** Each item lands behind an option, gets a review-bench
  toggle (Dennis judges on the bench, never URL params), and is measured **once** on the scorecard.
  Nothing in phase 2 has to beat FFX or native; it has to work, be measured, and leave the shipped
  default byte-identical unless the item says otherwise.
- **Hard time cap: 5–10 minutes per tuning, sweep or measurement run.** Longer only for a very
  serious need, stated in the track report before starting. No parameter sweeps in phase 2: write
  "could be tuned" findings into the track report's **tune list** and move on.
- **Phase 3 tunes and prunes, once, for all signals.** Calibration feeds it; the quality targets
  below are its targets.

## Board

| track | where | model | phase | status |
|---|---|---|---|---|
| T0-scenes | on main | – | 1 | **done**. All golden captures VALID except G4 pan-light-fade on the Mac (motion-Z reprojection, history consistency; the Windows capture of it is valid). Kept captures: `~/Developer/rt-captures/captures/` |
| T0-scorecard | on main | – | 1 | **done**. Calm headline at stride 8. Calibration panel with per-pair notes. Clip sheets are gitignored: regenerate with `node tools/scorecard/calibration/make-pairs.mjs --skip-replay --work ~/Developer/scorecard-work-track-t0c` (no GPU, ~6 min) |
| T0-native | on main, [native/results/golden/](native/results/golden/README.md) | Dennis's Windows machine | 1 | **done** (groups 1–3). Ours leads native on detail everywhere and on lag after every G4 light change; loses on calm where things hold still and at edges (G3 edges 2–2.7×, G5 static 3.7–5.5×, specular static 2.3–7.6×); wall cost 1.3× RELAX, 1.6× REBLUR at 1080p, GPU passes alone between the two |
| T1 calibration | review bench, "Blind A/B calibration (40 pairs)" | Dennis | – | **ready, not a gate**: 40 pairs, ~30 min. Feeds phase 3 (which metrics to trust, how much sharpness to give for calm). Do it any time before phase 3 |
| D diffuse + AO + cost | branch from main | Opus | 2: build | diagnosis done ([tracks/d.md](tracks/d.md)). Build list below |
| S shadows | branch from main | Opus | 2: build | diagnosis done ([tracks/s.md](tracks/s.md)). Build list below |
| R reflections | branch from main | Opus | 2: build | diagnosis done ([tracks/r.md](tracks/r.md)). Build list below; starts after D's shared-core items land (shared files) |
| Tooling | branch from main | Sonnet | 2: build | list below |
| O OIDN 3 | – | Opus | – | waits for the OIDN 3 release |

## Phase 2 build lists

Each item: option + bench toggle + one scorecard run (≤ 10 min) + a line in the track report.
Items marked _tune list_ are not built in phase 2.

**D (shared SVGF core first; R and S read its anti-lag mechanism):**
1. D5 host overhead: cached bind groups and views, one compute pass per frame, timestamps opt-in
   (byte-identical output).
2. D4 pass fusion: variance into à-trous iteration 0, merged gradient à-trous chain, chroma into
   the luminance gradient texture (byte-identical).
3. D2 noise-robust anti-lag as a mechanism with **per-signal parameters** (diffuse, specular, AO),
   in `shaders/gradient.ts`. Parameter values: _tune list_.
4. D1 output stabilization pass as a real option for diffuse and specular, and D6 the same through
   `OcclusionDenoiser`. Clip, α and history cap values: _tune list_.
5. D3 longer temporal window: _tune list_ (it's a value, not a feature).

**S (own files only):**
1. One significance-gated anti-lag that combines `clampHistoryNoise` and `antiLagNoise`
   (fix 1, as a single option, not two experiments).
2. Stabilizer box scaled by local σ (fix 2) instead of a constant.
3. Uniform-tile fast path in the temporal pass (fix 3, byte-checked on non-uniform tiles).
4. `clampGeometry` cost split, contacts hysteresis, fast-camera term (fixes 4–6): _tune list_ /
   later research.

**R (after D items 2–3 land; specular branches only):**
1. F2 mirror handling: roughness floor matching three's sampler (α ≥ 0.001) and a clamp-guarded
   minimum mirror history.
2. F4 remove `dropoutGuard`.
3. F1 uses D's per-signal anti-lag; specular values: _tune list_.
4. Keep `recurrent` until phase 3 decides (R recommends retiring it unless mirrors need it).

**Tooling (Sonnet):**
1. **A fast scorecard subset that finishes in ≤ 10 min** (one capture per golden scene, the five
   numbers, one command). Every phase-2 item is measured with it.
2. Lag metric on G1 and G1 detail without a resolver (the reflection bench).
3. Calm clips from 128-frame captures (≥ 4 s loops) for the phase-3 calibration refresh.

**Order and authors (3-author cap):** D 1–2 and S 1–3 and Tooling 1 in parallel; then D 3–4; then
R. Overlapping files go one writer at a time (ownership table below).

## Phase 3: tune and prune (once, all signals)

Inputs: the tune lists, Dennis's calibration answers, the fast scorecard and the full one.
Targets (formerly the per-track exit gates):

- **Reflections:** calm (stride 8) ≤ FFX on G1, traced and hybrid, with FSR3 1.5× and with no
  resolver; bias within 1 level; motion lag no worse than FFX.
- **Shadows:** calm ≤ FFX on G2 with the moving occluder, FLIP better than FFX, ≤ 0.6 ms at 1080p
  on the M5 Pro.
- **Diffuse / AO:** calm and lag ≤ native (tuned) on G3 / G4; diffuse + specular ≤ 4 ms GPU at
  1080p on the M5 Pro, wall overhead reported.
- **Prune:** option count roughly halved with the scorecard unchanged; a fresh Opus review of the
  diff with no blocking findings; Dennis's visual OK on the bench → release.

Each tuning run keeps the 5–10 min cap; the phase can have many of them, but no single multi-hour
sweep without Dennis's OK.

## The five numbers (definitions the scorecard implements)

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
| Tooling | `tools/scorecard/**`, `docs/research/rt-denoiser/scorecard/**`, `examples/three-temporal/src/review/calibration*`, `examples/three-temporal/src/golden/**` |
| R | `examples/three-temporal/reflect-bench.html`, `examples/three-temporal/src/reflect-bench/**`, `packages/denoiser-realtime/src/recurrent.ts`, `shaders/recurrent.ts`, and **only the specular branches** of `svgf.ts` / `shaders/svgf.ts` |
| S | `packages/denoiser-realtime/src/shadow.ts`, `shaders/shadow.ts`, `examples/three-temporal/src/realtime-shadows.ts` |
| D | the SVGF core: `svgf.ts`, `shaders/svgf.ts`, `shaders/common.ts`, `shaders/prepass.ts`, `shaders/gradient.ts`, `shaders/bindings.ts`, `common.ts`, `gpu.ts`, occlusion files |
| R + D | D owns everything shared; anti-lag stays in D's `shaders/gradient.ts` with per-signal parameters that R sets. One of them edits a shared file at a time; rebase before each commit |
| everyone | `docs/research/rt-denoiser/tracks/<own id>.md`, `docs/research/rt-denoiser/results/data/<own id>/**`, review-bench option rows for their own options (`examples/three-temporal/src/review/options.ts`, append only) |
| coordinator | this file, STOCKTAKE, PLAN, SPEC, TASKS, the status page |

## Shared resources

- **GPU lock:** `tools/gpu-lock.sh "<agent> <task>" <command…>` (fair FIFO queue,
  `RT_GPU_LOCK=/tmp/rt-gpu.lock`, TASKS rule 11). One batch per call, **≤ 10 min per hold**.
- **Dev-server ports:** review bench 5262; Tooling 5302, R 5303, S 5304, D 5305
  (`--strictPort --host 127.0.0.1`).
- **Captures:** `~/Developer/rt-captures/captures/` (115 GB with outputs; every golden and kept
  capture). Read by absolute path (`RT_CAPTURE_DIR`); don't copy. New outputs go under your own
  work dir and are deleted when your phase ends.
- **Scene assets** are Git LFS. A fresh checkout or worktree has pointer files: run
  `git lfs checkout examples/three-temporal/scene-assets` (fills from the shared local store, no
  download).

## Report format (each track, end of phase 2)

`tracks/<id>.md`: what you built (options, commits), the one scorecard run per item (numbers,
command), the **tune list** (what you'd tune, which way, why), risks, and what you need from other
tracks. Then a ≤ 10-line final message to the coordinator.
