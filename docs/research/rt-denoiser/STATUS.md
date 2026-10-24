# Status: morning of 2026-10-25

_The overnight run's summary for Dennis. Task board: [TASKS.md](TASKS.md). Decisions waiting on
you: [SPEC.md §12](SPEC.md) (short form in §0). Everything below is provisional until you review
SPEC; every number comes from our own test bed or captures unless it says "native"._

## In one paragraph

M0, M1, M4 and M5 are built and measured. M2 and M3 are built. M6 has groundwork: three.js
nodes and two example pages. The recurrent filter (our RTG II–style design, M2/M3) works but
**loses to SVGF / A-SVGF** on our test bed for diffuse, specular and occlusion. It costs the
same as SVGF and needs less memory. That's the go/no-go question in SPEC §12 item 1: our
recommendation is SVGF with anti-lag `'auto'` as the default, recurrent opt-in, and a second
look once native NRD has replayed the test-bed captures. **Shadows are a clear win:** ours beats
FFX on every path, on the analytic test bed and on the first real three.js scene. Nothing has
been compared with native NRD on real captures yet; that's the main gap.

## Where we stand (1080p, M5 Pro, pooled PSNR over 7 stress paths)

| signal | best of ours | other filters | baseline | cost (bench median) |
|---|---|---|---|---|
| diffuse | A-SVGF `auto` 39.12 dB | SVGF 38.88 · recurrent 38.26 | accumulate 28.7 | joint diff+spec: SVGF 4.00 · `auto` 4.23 · recurrent 3.99 ms (target 4) |
| specular | A-SVGF `auto` 35.04 dB | recurrent 34.10 · SVGF 33.46 | FFX reflections 21.0 (loses 24 % energy) | (joint, above) |
| shadows | `ShadowDenoiser` 37.11 dB, penumbra 28.57, FLIP 0.018 | — | FFX 31.20 / 23.50 / 0.038 | 0.48–0.59 ms (target 0.6) |
| AO / SO | A-SVGF `auto` 39.03 / 39.68 dB | SVGF 38.93 / 38.76 · recurrent 38.02 / 37.37 | accumulate 27.3 / 26.5 | AO+SO 3.10 / 2.89 / 2.62 ms |

Sources: [results/REMEASURE-2026-10-25.md](results/REMEASURE-2026-10-25.md),
[M1](results/M1.md), [M2-M3](results/M2-M3.md), [M4](results/M4.md), [M5](results/M5.md),
[M6 real scene](results/M6-real-scene.md). Memory: SVGF ≈ 132–140 B/px, recurrent 105.5,
shadows 40 (target ≤ 100 for diffuse+specular).

**Real scene (three.js shadows page, static camera, 4096-ray reference):** ours beats FFX on
every view, e.g. 31.7 / 27.4 dB vs 28.5 / 22.2 (all receivers / penumbra) with FLIP halved. FFX
drifts dark as its history grows. Ours needs blue-noise sampling for its full margin.

**Native NRD so far (RTX 3060 Laptop, synthetic captures only):** the harness reads our format
correctly (REFERENCE matches to 0.03 dB). Cost at 1080p: REBLUR 5.6 ms, RELAX 6.7, SIGMA 1.1. On
the synthetic plane, SVGF is within 1.6 dB of RELAX on static diffuse and ahead elsewhere.
Native specular looks low, probably from a convention mismatch (probe P2).

## What to look at first

1. **SPEC §0 and §12:** one ordered list of decisions, each with evidence and a recommendation.
   The top three: default filter per signal, SVGF anti-lag default (`'auto'` v2 is +0.25 ms for
   +0.24 / +1.58 dB), and whether the binding cost target is 4 ms or ≤ 2× native.
2. **The pages:** `yarn workspace three-temporal dev`, then `/realtime-shadows.html` (FFX left,
   ours right, draggable divider) and `/realtime-gi.html`. The analytic test bed is
   `yarn workspace realtime-denoiser dev` (port 5220); see its `RESULTS.md` for queries.
3. **Clean-room items:** [reviews/shadows-provenance.md](reviews/shadows-provenance.md)
   (second review of the shadow rows: all confirmed; NRD-README-derived lines removed from
   `sources/shadows-specular.md`), and SPEC's listing policy (§12 item 9).

## For the Windows machine (next steps)

`git pull`, then in order (commands in [NATIVE-HARNESS.md](NATIVE-HARNESS.md) phases 4–5):

1. `node examples/realtime-denoiser/run-headless.mjs --serve --set=roundtrip` with
   `$env:RT_CAPTURE_DIR = "C:\dev\nrd-reference"`. These scripts have never run on Windows.
2. `--set=standard` (≈ 10.6 GB, blue-noise sampling), replay through native REBLUR / RELAX /
   SIGMA, score with `compare.mjs`. **This is the input the M2 go/no-go is waiting for.**
3. Phase 5: replay ours on the same GPU (`--replay=accumulate,svgf,svgf-auto,recurrent,shadows,ffx-shadows,ffx-reflections`)
   for same-GPU timings against the ≤ 2× native target.
4. Probes P2 (native specular conventions) and P3 (native hit-distance curve as numbers) in
   TASKS; re-check jitter units on a capture with edges.

## How the night went (process)

- About 20 agents, each with a role from RULES §8, file ownership, and a brief pointing at
  RULES / LESSONS / TASKS. Nobody opened NRD code or its README. The one research note whose
  author had read README prose got an independent second review.
- Corrections made along the way, so you know the numbers were checked: M2's first "recurrent
  beats A-SVGF" claim was against SVGF's old feedback-on default, and doesn't hold against
  today's default. The per-frame-mean PSNR over-rewarded near-perfect frames, so rankings now
  use pooled PSNR. A-SVGF `auto`'s history was capped at ~13 frames by a noise-floor bug (fixed;
  it now costs +0.25 ms instead of +1.6).
- [LESSONS.md](LESSONS.md) has ~120 entries; read it before working on this again.
- Captures (≈ 11 GB) and replay outputs (≈ 12 GB) are in `tools/rt-capture/` (gitignored);
  delete them if you need the space.

## Still running when this was written

- Shadows: frame 2 after a reset scores below frame 1 (found on the real scene); fix in progress.
- Real scene with a moving camera and per-pose references (and captures, if feasible), to make it
  the second scoring scene (SPEC §12 item 7).
