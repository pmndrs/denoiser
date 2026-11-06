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

### 5.3 Small plans (sprints), each with a bench, a bar and a stop rule

| sprint | goal | exit (all must hold) | size |
|---|---|---|---|
| **S0 Consolidate** | push the 5 unpushed commits; move the reflection bench here; one scorecard runner for G1–G4 with FFX / native rows; refresh STATUS; storage cleanup (your OK) | dashboard shows today's numbers for every golden scene; no denoiser code changed | 1–2 days |
| **S1 Calibrate** | blind A/B with you on the review bench | each metric agrees with you on ≥ 8 of 10 pairs | ½ day of your time |
| **S2 Reflections parity** | find and close the gap to FFX on G1 (REFLECT-BENCH phase 1: bias, low-roughness history, normal-mapped gloss; read our MIT FFX port side by side) | calm ≤ FFX on G1 (traced and hybrid), bias within 1 luma, your OK | ≤ 1 week, stop and reassess after 2 failed attempts |
| **S3 Shadows in motion** | G2 moving occluder | calm ≤ FFX, detail better than FFX, ≤ 0.6 ms, your OK | ≤ 1 week |
| **S4 Diffuse + AO** | G3 / G4 against native at tuned settings | calm ≤ native, lag ≤ native, ≤ 4 ms joint incl. specular | decide after OIDN 3 ships (late Nov): it may cover full-frame GI |
| **S5 Simplify** | one filter per signal; retire the recurrent filter unless it won somewhere in S2–S4; delete options with no measured win; cut submit overhead | option count down by half; WGSL size down; scorecard unchanged | 3–4 days |
| **S6 Ship** | merge `denoiser/realtime` to main as experimental, one docs page, one demo | CI green, your OK on the demo | 1–2 days |

### 5.4 How we work from here

- **One sprint at a time, one active agent** (Sonnet by default), one branch per sprint, merged
  when its exit holds.
- **The dashboard page is the status report.** It's updated at the end of every sprint; no
  status lives only in chat or in a 4,000-line spec.
- **At most three decisions per sprint**, each with a bench preset you can flip with one key.
- **No new options without a scorecard win on a golden scene.** No new scenes or side projects
  mid-sprint.
- **Disk and usage budget:** captures older than the current sprint get deleted; no overnight
  swarms.

## 6. Decisions needed now

1. **Approve the reset:** pause features, start with S0.
2. **Golden scenes:** keep G1–G5 as listed, or change them.
3. **Order:** reflections (S2) before shadows (S3), and hold diffuse/AO (S4) until OIDN 3 is out?
4. **Storage:** OK to delete the 306 GB in `tools/rt-capture/` and the stale worktrees
   (`Denoiser-interior-lab` after the bench moves, `-review`, `-shadow-bench`, `-jitter-study`)?
5. **The 5 unpushed commits** on this branch (dropoutGuard and the 10-28 handoff): push them
   as a record, or drop dropoutGuard now (it was tuned on the wrong scene)?

## Sources

STATUS.md (10-25), results/REMEASURE-2026-10-26.md, results/REFLECT-BENCH.md,
native/results/PHASE4-5.md and ROUND3.md, handoffs/2026-10-28-ben-pr-session.md, TASKS.md
(rules 9 and 12, questions), git history of `feat/rt-denoiser-cleanroom`.
