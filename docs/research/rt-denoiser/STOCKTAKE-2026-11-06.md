# Stocktake: the real-time denoiser, 2026-11-06

_Written for Dennis as technical manager: where we are, what went wrong, and a reset into small,
testable steps. Supersedes [STATUS.md](STATUS.md) (last updated 2026-10-25). Page version:
https://claude.ai/artifact/22UkP6phKJQyt8PLPHuQvd (private to Dennis until shared)._

## 1. Where we are, in one paragraph

Between 2026-10-24 and 10-28 we built every milestone in the plan (M0–M8): an SVGF / A-SVGF
filter, the recurrent ReBLUR-style filter, shadows, AO/SO, the SH variants, translucent shadows,
three.js nodes, a capture/replay system, and native NRD running on the Windows RTX laptop. On our
own scorecards it all looks excellent: we beat native NRD by 2–4 dB on every signal, at 1.0–1.4×
its GPU cost on the same machine. **But it doesn't look right in real scenes.** On the reflection
bench (Ben's camera model) FFX is visibly cleaner than both of our filters. The knot's shadow
boiled until a late fix, and in places it still boils slightly more than FFX. Nothing is merged
to main, the work has been paused since 10-28, and the branch has grown to a size that's hard to
manage: 317 commits, ~9,300 lines of TypeScript, ~500 KB of generated WGSL, roughly 200 options.

## 2. Scorecard against the targets we set (PLAN §8)

| target | measured | verdict |
|---|---|---|
| Quality within ~0.5 dB of native NRD, no more flicker | +2.0 to +4.6 dB **above** native on PSNR (diffuse, specular, shadows) | passes on paper, **but the ruler is suspect** (§3.1) |
| No new artifact classes (ghosting, smearing) in stress paths | ripple on normal-mapped metal and boil on reflections (reflection bench); shadow boil fixed late (0.0013 vs FFX 0.0011) | **fails** where you looked |
| Cost ≤ 2× native on the same GPU | 0.99–1.37× (RTX 3060 Laptop, clocks locked) | passes, but excludes 2–3.5 ms/frame of submit overhead on our side |
| M5 Pro 1080p: diffuse+specular ≤ 4 ms | 4.40 ms (A-SVGF default) | **over** by 10 % |
| M5 Pro 1080p: shadows ≤ 0.6 ms | 0.62–0.72 ms | **over** |
| Memory ≤ 100 B/px (diffuse+specular) | SVGF 132–140, recurrent 105.5 | **over** |
| Recurrent filter becomes the default (M2 go/no-go) | loses to SVGF on every signal | **no-go**, SVGF is the default |

Reflections against FFX on the reflection bench (mean temporal σ of luma over 16 still frames,
FSR3 on, lower is calmer):

| input | raw | FFX | our recurrent | our SVGF |
|---|---|---|---|---|
| model defaults, ray traced | 1.38 | **0.40** | 0.52 | 0.59 |
| model defaults, hybrid SSR + rays | 1.17 | **0.38** | 0.61 | 0.64 |
| roughness 0, ray traced | 0.24 | **0.17** | 0.25 | – |

Ours also comes out ~3 luma levels brighter than FFX and the raw input (an unexplained bias).

## 3. What went wrong

### 3.1 We measured the wrong thing, and believed it

- **The goal was written as metric targets, not as what it should look like in use.** PLAN §8
  (written in the planning session) asked for "within 0.5 dB PSNR of native". PSNR is error
  against a reference, averaged over the frame. It barely notices what you see: shapes
  undulating frame to frame (boil), ripple on normal-mapped detail, energy loss vs stability
  trade-offs.
- **The main test bed is our own analytic scene** (spheres, boxes, a plane), with references
  from the same estimator. Real three.js scenes have normal maps, thin geometry, SSR's stochastic
  march and dense texture: exactly where the problems showed up.
- **Beating a production denoiser by 2–4 dB should have been a red flag, not a headline.** Native
  SIGMA scored *below plain accumulation* on our captures, and REBLUR moved +4.6 dB just by
  changing one hit-distance setting. That means the comparison measures our conventions and our
  references as much as the denoisers. FFX reflections "lost" on PSNR (it drops ~24 % energy) yet
  wins visually on stability. The ruler rewards a trade-off you don't want.
- **Input noise was mistaken for denoiser quality.** The boil on Ben's scene turned out to be
  three.js's stochastic SSR march, and we spent a day tuning a denoiser (`dropoutGuard`) against it.

### 3.2 Speed outran review

- 194 commits and ~20 agents in one night (10-25); M0–M8 all marked built within four days.
- You became a decision queue: 31 decision cards (q01–q31), most answered "as recommended",
  because for a long time you had no one-click way to see the difference (URL parameters; the
  review bench came on 10-27).
- The paperwork outgrew a manager's reading time: SPEC 3,950 lines, TASKS 1,500, LESSONS 1,200,
  plus 40 results files. STATUS.md stopped being updated on 10-25.

### 3.3 Breadth before depth

- Five denoiser families and two filter algorithms built in parallel, instead of one signal made
  excellent end to end.
- Rule 9 ("new techniques land as options") protected the defaults but turned every fix into a
  new option: roughly 200 optional settings, most of which no user will ever touch.
- The recurrent filter, the most complex piece, never beat SVGF, but it stayed in and kept
  absorbing work (T1b, T6, dropoutGuard).

### 3.4 Side quests and cost

- Ben Houston's PR #35228 work (interior lab, workbench, dropoutGuard) pulled the effort onto a
  scene whose problem was upstream of us.
- Usage: Opus subagents were 62 % of your usage before the switch to Sonnet; you went onto paid
  usage.
- Disk: `tools/rt-capture/` in this worktree holds **306 GB** of captures and replays. There are
  also 6 extra `Denoiser-*` worktrees.

## 4. What's worth keeping

- **The clean-room discipline held.** No NRD code or README reached an implementer; provenance is
  logged per pass; the contaminated roles are recorded.
- **The infrastructure is real and reusable:** capture format + replay, the native NRD harness
  on Windows (same-GPU timings, locked clocks), the review bench with A/B toggles, the reflection
  bench, the boil and dynamic-region metrics.
- **SVGF / A-SVGF is a solid base:** fast (≈ native REBLUR on the same GPU), best on our numbers,
  and simpler than the recurrent filter.
- **Shadows** are competitive with FFX on stability after v2.2 and well ahead on accuracy.
- **LESSONS.md** has ~120 hard-won gotchas (WebGPU limits, timing protocol, headless Chrome).

## 5. The reset: goals you can see

**North star (proposed):** in the scenes our users will build, our denoisers look at least as
calm as the best thing available (FFX for reflections and shadows, native NRD for the rest),
keep more detail, and fit the frame budget. **Your visual verdict is a gate, not a tiebreaker.**

### 5.1 Golden scenes (real three.js inputs only)

| # | scene | signal it judges | bar to clear | exists today? |
|---|---|---|---|---|
| G1 | reflection bench: Ben's camera model, normal-mapped metal, traced + hybrid | specular | FFX | yes (`feat/interior-lab`, needs moving here) |
| G2 | the knot over a floor, moving occluder, area light | shadows | FFX | yes (`realtime-shadows.html`) |
| G3 | Sponza orbit | diffuse GI + AO | native RELAX / REBLUR (tuned settings) | yes (`realtime-scenes`) |
| G4 | Bistro pan + a light switching on | diffuse, light-change lag | native | yes (captures) |
| G5 | product turntable: glossy + rough, normal maps | specular + diffuse | FFX + native | **new** |

Each has a scripted camera path, fixed seeds, a **perfect-input mode** (so input noise and
denoiser quality can be told apart), and a 4096-spp accumulated reference per frame.

### 5.2 The scorecard: five numbers per scene, plus your eye

1. **Calm:** motion-compensated boil in static and moving regions, against the clean reference's
   own boil.
2. **Detail:** FLIP (perceptual error) against the reference, instead of PSNR.
3. **Lag:** frames to settle after a cut or a light change.
4. **Bias:** mean brightness against the reference.
5. **Cost:** GPU ms **and** wall ms per frame, 1080p, M5 Pro; same-GPU ratio on the RTX.

Plus a **side-by-side clip** per scene for your review. **Before any of these numbers is used to
make a decision, it gets calibrated:** you blind-judge ~10 A/B pairs on the review bench, and the
metric has to agree with you on at least 8. If it doesn't, the metric gets fixed first.

### 5.3 Parallel tracks, each with a bench, a bar and a stop rule

_Revised 2026-11-07 after Dennis's review: no waiting on OIDN 3; the work runs as parallel
tracks instead of a line of sprints; and **work is bound to measures of success, not dates**.
A track moves to its next phase when its gate is met, however long that takes. The time figures
below are rough estimates only._

**OIDN 3 is not a dependency.** NRD's family is out now, so our tools get built as well as we can
build them now. When OIDN 3 ships (due late November), it joins as one more
`TemporalDenoiser` in `denoiser/realtime` (`OidnTemporalDenoiser`, full frame) and as one more row
on every golden scene's scorecard. Track O below is the slot for that.

```
phase 1 (gate: dashboard live + metrics calibrated)
         T0 foundation lanes ──────┐   in parallel
         R / S / D diagnosis ──────┤   read-only + measurement, start immediately
         T1 calibration ───────────┘   needs the dashboard and bench toggles
phase 2 (gate per track: its exit measures, below)
         R reflections ─┐
         S shadows      ├─ fixes in parallel, gated by calibrated metrics
         D diffuse + AO ┘
phase 3 (gate per track: Opus review + Dennis's visual OK)
         each track prunes its options → review → merge; T6 ships the first one
any time O OIDN 3 adapter, when it's released
```

Rough estimates, for planning only: phase 1 a few days; phase 2 a few days to a week per track;
phase 3 a day or two per track.

| track | lanes / steps | owner model | depends on | exit |
|---|---|---|---|---|
| **T0 Foundation** | 0a scorecard runner + dashboard (5 numbers × golden scene, ours / FFX / native rows); 0b move the reflection bench onto this branch as G1; 0c build G5 (product turntable); 0d branch and disk hygiene (push or drop the 5 commits, captures, worktrees: with your OK); 0e native captures of the golden scenes on the Windows RTX (your Windows agent) | Sonnet (all lanes are tooling) | nothing | dashboard shows today's numbers on G1–G5; no denoiser code changed |
| **T1 Calibration** | blind A/B pairs on the review bench, scored against the metrics | – (half a day of your time) | 0a | each metric agrees with you on ≥ 8 of 10 pairs, or gets fixed before it gates anything |
| **R Reflections** (G1, G5) | day 1: diagnosis (the +3 luma bias, low-roughness history, normal-mapped gloss, our MIT FFX port read side by side). Week 2: fixes | **Opus** author | diagnosis: nothing; fixes: T1 | calm ≤ FFX on G1, traced and hybrid; bias within 1 luma; your OK. Stop and reassess after 2 failed attempts |
| **S Shadows** (G2) | day 1: diagnosis of moving-occluder boil vs FFX. Week 2: fixes | **Opus** author | as R | calm ≤ FFX on G2, more detail than FFX, ≤ 0.6 ms, your OK |
| **D Diffuse + AO** (G3, G4) | day 1: baseline vs native at tuned settings (REBLUR A = 0.01). Week 2: fixes, plus the cost work (4.40 → ≤ 4 ms, wall-time overhead) | **Opus** author; Sonnet for the measurement batches | as R | calm and lag ≤ native, ≤ 4 ms joint with specular, your OK |
| **T5 Simplify** | done inside each track before it merges: retire what didn't win (the recurrent filter included), delete options without a measured win | the track's author | that track's exit | the track's option count roughly halved, scorecard unchanged |
| **T6 Ship** | merge `denoiser/realtime` to main as experimental, docs page, one demo; later tracks follow as their own PRs | Sonnet (docs), Opus review | first track through review | CI green, your OK on the demo |
| **O OIDN 3** | `OidnTemporalDenoiser` adapter on our runtimes, plus scorecard rows | Opus | OIDN 3 release + T0 | runs on every golden scene; numbers on the dashboard |

### 5.4 How the parallel work stays sane

- **Concurrency cap: three authoring agents at once** (R, S, D), plus Sonnet helpers for T0. That
  is the most I can review properly and keep within your usage.
- **One worktree per track, and file ownership:**
  - S owns `shadow.ts` and its shader outright, so it never conflicts.
  - R and D share the SVGF code (`svgf.ts`, `shaders/svgf.ts`, `common.ts`, `prepass.ts`,
    `gradient.ts`). **D owns that core.** R edits only the specular paths, rebases on D daily,
    and asks D's owner for core changes.
  - T0 lanes touch only tools, examples and docs.
- **GPU measurements go through one queue.** The Mac keeps rule 11 (one heavy GPU job at a time):
  analysis and coding run in parallel, measurement runs take turns. The Windows RTX is a second
  measurement machine for native and same-GPU timings.
- **Merges are serialized:** each track's diff gets a fresh Opus reviewer (who didn't write it),
  then your visual OK on the dashboard and the bench, then merge.
- **The page is the status report,** updated whenever a track changes state (started, blocked,
  exit met, merged), not only at the end.
- **Three decisions per track, at most,** each with a bench preset you can flip with one key.
- **No new option without a scorecard win on a golden scene.** No new scenes or side projects
  mid-track. Captures older than the current week get deleted.

### 5.5 Model policy

| work | model | why |
|---|---|---|
| Algorithm and shader authoring (R, S, D, O), design, diagnosis | **Opus** | correctness on the first pass matters most here |
| Independent review of every track's diff before merge | **Opus**, a fresh agent | catches what the author can't see |
| Runners, replays, measurement batches, dashboards, UI wiring, docs | Sonnet | mechanical; Sonnet is reliable and cheap here |

An honest note on what Opus fixes: **305 of the branch's 318 commits, nearly all of M0–M8, were
written before the switch to Sonnet on 10-27, by Opus subagents.** The problems in §3 came mostly
from the goals and the ruler, not from the model. Opus authoring is still the right call for the
algorithm work, but the scorecard and your visual gate are what change the outcome.

## 6. Decisions (made 2026-11-07)

1. **Reset approved** as revised: parallel tracks gated by measures (not dates), Opus for
   algorithm authoring and review, OIDN 3 joining when it ships.
2. **Golden scenes:** G1–G5 as listed.
3. **Concurrency cap:** three authoring agents at once (R, S, D), plus Sonnet helpers.
4. **Storage:** done 2026-11-07. Replay outputs (228 GB) and the non-golden captures deleted;
   the golden-scene captures (Sponza, Bistro, the knot, the corner scene: 33 GB) and the small
   synthetic smoke captures kept until T0 replaces them. Worktrees `-review`, `-shadow-bench`,
   `-jitter-study` removed (their branches stay); `-interior-lab` goes once the reflection bench
   has moved.
5. **The unpushed commits** are pushed as a record. dropoutGuard stays opt-in and gets removed
   in track R's simplify step unless it wins on the scorecard.

## Sources

STATUS.md (10-25), results/REMEASURE-2026-10-26.md, results/REFLECT-BENCH.md,
native/results/PHASE4-5.md and ROUND3.md, handoffs/2026-10-28-ben-pr-session.md, TASKS.md
(rules 9 and 12, questions), git history of `feat/rt-denoiser-cleanroom`.
