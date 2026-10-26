# Re-measure, 2026-10-26 (M5 Pro cost of the shipped defaults after the 2026-10-26 flips)

_Timing evaluator (RULES.md rule 8: evaluator, no NRD code, README or port read; no denoiser code changed). Same
protocol, bench and scratch wrapper as [REMEASURE-2026-10-25](REMEASURE-2026-10-25.md), so the numbers compare
directly. Answers the TASKS item "M5 Pro bench re-time of the shipped defaults after the 2026-10-26 flips"._

**Conclusion first:**

- **Diffuse + specular, the shipped default (A-SVGF `'auto'`, `youngNormalPower: 16`): 4.40 ms median, 4.19 ms
  fastest frame.** That is exactly the upper edge of the 4 ms ± 10 % guide (runs 4.35–4.47, 4 of 9 above 4.40).
  `youngNormalPower: 16` costs **+0.28 ms (+6.8 %)** over `youngNormalPower: 0` (4.12), all of it in the five à-trous
  passes (+0.27 ms, +0.05 ms each). The RTX showed +0.31 ms (+5 %); the SPEC v0.6 estimate of "≈ 4.4" holds.
- **Recurrent joint at its new defaults (`'spatial'` + `historyFixDense: 4` + T6 normal test + `virtualHitTest`):
  4.06 ms**, within the guide (+1.5 %) and 0.34 ms below the A-SVGF default. `historyFix: 'mips'` reads 3.89. So the
  spatial fix with dense 4 costs **+0.17 ms (+4.4 %)**, all of it in the history fix (0.72 ms vs 0.11 + 0.44). The T6 options
  cost **+0.02 ms (+0.5 %)** (4.06 vs 4.04 without them). Together, today's recurrent flips cost +0.20 ms (+5.2 %) over the 10-25
  configuration (3.86).
- **Shadows at the q21 defaults: 0.62 ms on `orbit` and 0.72 ms on `thin`**, the same as before q21 (0.62 / per-pass identical:
  `backfacePass` + `snapHardPx: 2` cost nothing measurable). The ~0.75 ms target is met. The open **q23** set adds
  +0.015 ms on `orbit` (+2.4 %) and +0.02 ms on `thin` (+2.8 %, **0.74 ms, still under 0.75**; SPEC v0.6 quoted 0.77–0.78).
  **q24** (`terminatorAnalytic`) is **0.02 ms cheaper** (0.60, −3 %; its spatial passes are lighter).
- **AO + SO joint: occlusion A-SVGF default 2.89 ms, occlusion recurrent default 2.54 ms** (no PLAN target).
- **Optional:** q25 (`f16Rounding: 'nearest'`) costs nothing measurable (4.40 vs 4.40); q26 (`antiLagChroma`) +0.15 ms
  (+3.4 %, 4.55 ms joint, over the 4.4 ms guide edge if it ships on top of today's default). Both are well inside rule 9's +10 %.
- **≤ 2× native (binding): still met with a wide margin.** Native round 3's locked-clock RTX ratios at HEAD were 1.18×
  (A-SVGF + `youngNormalPower: 16`, 1.20× steady) and 0.99× (`'off'`) REBLUR; round 1's recurrent ratio was 1.02×; shadows were
  1.19× SIGMA; AO + SO 1.37× REBLUR occlusion (A-SVGF). If today's M5 Pro deltas carried over to the RTX: recurrent ≈ 1.07×,
  shadows unchanged, q23 ≈ 1.22×, q26 on A-SVGF ≈ 1.24×. Those are projections; native round 4 measures them (TASKS).
- **Gotcha:** a desktop video call (Slack, camera on) started during round 3 and put every page into a slow state for
  50 minutes (joint medians +5 … +100 %). Those 104 pages are tagged and excluded. Six replacement rounds ran after the
  call ended (§1, LESSONS). Without that load no clean run landed in the slow clock state: every configuration's run medians
  spread ≤ 3 %.

## 1. Setup (identical to 2026-10-25 except where noted)

| | |
|---|---|
| GPU / browser | Apple M5 Pro (`metal-3`), HeadlessChrome 155, `--use-angle=metal`, WebGPU timestamps; on AC power |
| Denoiser code | `packages/denoiser-realtime` + `packages/denoiser-core` **at f649a50** (HEAD at start), frozen as a `git archive` copy via `RT_REALTIME_SRC`. The registry (`tools/rt-capture`) and the test bed were served from the worktree at f649a50 (clean apart from an untracked `paths.ts.orig`) |
| Server | own instance on 127.0.0.1:5340 (`--strictPort`, port checked free first), the 10-25 scratch Vite config: the test bed's config merged with `server.hmr: false` and the scratch registry wrapper |
| Scratch wrapper | re-exports the registry and adds `j-<id>` = the entry forced to its **joint** instance (`DiffuseSpecularDenoiser.dispatchBoth` / `OcclusionDenoiser.dispatchBoth`) for `svgf`, `svgf-auto`, `recurrent`, `occlusion-svgf-auto`, `occlusion-recurrent`. Option variants come from the page URL's settings (one variant per page, so no in-page `@` variants were needed); every variant was checked to reach its page (pass lists: `mips` appears with `r.historyFix=mips`, `antiLagChroma` widens the gradient passes, etc.) |
| Timing statistic | test-bed solo bench `mode=bench&preset=full&path=orbit&n=200`: 200 timed frames after 20 warm-up, one (signal, config) per page load. Rounds alternate the page order, each led by a throwaway warm-up page. Each page started only when no other headless Chrome tree or runner used CPU (> 3 % over the process tree); for the replacement rounds the check also waited while a `Video Wake Lock` power assertion or the camera service was active. **median** = the median over runs of each run's median frame; **min** = the fastest single frame over all runs; the spread is listed |
| Runs | 15 rounds × 17 configurations = 255 pages, no failures, no headless contention. **Clean runs: rounds 1–2, round 3 up to its 15th page, rounds 10–15** = 9 per configuration (8 for the q25 / q26 pages, which came last in round 3). The rest of round 3 and rounds 4–9 (104 pages, 19:57–20:47 JST) ran during a desktop video call and are tagged `externalLoad` in the data, not used |
| Extra vs 10-25 | shadows also on `thin` (the path that sets the ~0.75 ms limit), to check the SPEC v0.6 `thin` rows |

Commands (from `examples/realtime-denoiser`; `$S` = the scratch folder; scripts copied to
[data/remeasure-2026-10-26/](data/remeasure-2026-10-26/), absolute scratch paths inside):

```sh
git archive f649a50 packages/denoiser-realtime/src packages/denoiser-core/src | tar -x -C $S/snap
RT_REALTIME_SRC=$S/snap/packages/denoiser-realtime/src node ../../node_modules/vite/bin/vite.js \
  --config $S/wrap/vite.config.mjs --port 5340 --strictPort --host 127.0.0.1
node $S/bench.mjs 9 200          # rounds of 17 pages, e.g. "signal=diffuse&mode=bench&preset=full&path=orbit&n=200&denoiser=j-recurrent&r.historyFix=mips"
ROUND0=9 OUT=$S/out/bench2.jsonl START_MAXWAIT_S=4500 node $S/bench.mjs 6 200   # replacement rounds
node $S/sum2.mjs                 # merge, tag the video-call window, summarize clean runs
```

Raw data: [data/remeasure-2026-10-26-bench-1080p.jsonl](data/remeasure-2026-10-26-bench-1080p.jsonl), one line per page with
the query, run median / p25 / p90 / min, per-pass medians, wall time, timestamp, and the `externalLoad` tag.

**Reproduction check against 10-25** (identical configurations: `svgf` = `'off'` + `youngNormalPower: 0`, `svgf-auto` with
`youngNormalPower=0`, `recurrent` with `r.historyFix=mips` and the T6 options off): the **fastest frames reproduce to
±0.02 ms** (3.66 vs 3.68, 3.95 vs 3.94, 3.73 vs 3.73). The medians read 2.6–3.5 % lower today (3.86 vs 4.00, 4.12 vs
4.23, 3.86 vs 3.99). None of today's clean runs landed in the slow state. On 10-25, 3–4 of 9 runs did, and its fast-state runs sat
at 3.92–4.00 (today 3.82–3.94). Compare today's configurations with each other (§2–§4); compare with 10-25 by the
min column or by the same-session reproduction arms.

## 2. Joint diffuse + specular (`dispatchBoth`, 1080p, `orbit`)

| configuration | **median** (ms) | **min** (ms) | run medians, 9 runs (sorted) | Δ median | passes (median over runs) |
|---|---|---|---|---|---|
| **A-SVGF `'auto'`, shipped default** (`youngNormalPower: 16`) | **4.40** | 4.19 | 4.35 4.35 4.36 4.37 4.40 4.42 4.42 4.43 4.47 | +0.28 vs `ynp 0` | prepass 0.15, gradient 0.50 (create 0.28, à-trous 4 × 0.04, λ 0.07), temporal 0.61, variance 0.49, à-trous 0.53 + 0.53 + 0.52 + 0.52 + 0.50 |
| A-SVGF `'auto'`, `youngNormalPower: 0` (10-25 default) | 4.12 | 3.95 | 4.09 4.09 4.09 4.10 4.12 4.16 4.16 4.17 4.24 | (10-25: 4.23 / 3.94) | à-trous 0.48 + 0.47 + 0.47 + 0.47 + 0.45 |
| SVGF `'off'` (`ynp 0`, registry `svgf`) | 3.86 | 3.66 | 3.82 3.82 3.84 3.85 3.86 3.88 3.88 3.89 3.94 | (10-25: 4.00 / 3.68) | prepass 0.15, temporal 0.59, variance 0.73, à-trous 0.48 + 0.47 + 0.47 + 0.47 + 0.45 |
| **recurrent, shipped default** (`'spatial'` + dense 4 + T6) | **4.06** | 3.94 | 4.04 4.04 4.04 4.05 4.06 4.07 4.10 4.11 4.13 | +0.20 vs 10-25 config | prepass 0.09, pre-blur 0.63, temporal 1.04, history fix 0.72, blur 0.75, post-blur 0.39, stabilize 0.43 |
| recurrent, `historyFix: 'mips'` (T6 on) | 3.89 | 3.74 | 3.87 3.87 3.88 3.88 3.89 3.90 3.94 3.95 3.96 | −0.17 vs default | mips 0.11, history fix 0.44; rest as default |
| recurrent, `'spatial'` + dense 4, T6 off | 4.04 | 3.92 | 4.03 4.03 4.03 4.03 4.04 4.05 4.05 4.07 4.09 | −0.02 vs default | temporal 1.02 (vs 1.04); rest as default |
| recurrent, `'mips'`, T6 off (= the 10-25 configuration) | 3.86 | 3.73 | 3.84 3.84 3.85 3.85 3.86 3.89 3.89 3.90 3.91 | (10-25: 3.99 / 3.73) | as 10-25 within 0.01 per pass |
| A-SVGF default + `f16Rounding: 'nearest'` (q25), 8 runs | 4.40 | 4.22 | 4.37 4.38 4.39 4.40 4.41 4.43 4.44 4.48 | ±0.00 | à-trous +0.005 each |
| A-SVGF default + `antiLagChroma` (q26), 8 runs | 4.55 | 4.36 | 4.51 4.52 4.52 4.55 4.55 4.57 4.57 4.59 | +0.15 | gradient à-trous 4 × 0.06 (vs 0.04), λ 0.13 (vs 0.07), create 0.29, temporal 0.62 |

- **`youngNormalPower: 16`: +0.28 ms median (+6.8 %), +0.24 ms on the fastest frame.** The five à-trous passes sum to
  2.61 vs 2.34 ms (+0.27); nothing else moves. On the RTX it was +0.31 ms (+5 %), also à-trous only. This puts the
  default at **4.40 ms = 4 ms + 10 %**, the edge of the guide.
- **Recurrent:** the history fix is the only pass that changed. `'spatial'` + dense 4 reads 0.72 ms vs 0.55 for
  `'mips'` (mips 0.11 + history fix 0.44), +0.17 ms. T1b's single-signal medians (diffuse 2.09 → 2.17, specular 2.42 → 2.48,
  +0.14 summed) agree. The T6 normal test and `virtualHitTest` add 0.013 ms to temporal and +0.02 ms joint (T6 §6–7 measured
  +0.9 / +1.2 % per option on single signals; joint they overlap in one temporal pass).
- **Ranking on this bench:** SVGF `'off'` 3.86 < recurrent `'mips'` 3.89 < recurrent default 4.06 < A-SVGF `ynp 0` 4.12
  < **A-SVGF default 4.40**. The flips moved the two defaults apart: recurrent is now 0.34 ms cheaper than A-SVGF, where on
  10-25 it was 0.24 ms cheaper.
- **q26** costs +0.15 ms joint (+3.4 %), i.e. ≈ +0.07 per signal, inside T3's +0.06…0.11 per signal. With q26 the default
  would sit at 4.55 ms, 14 % over the 4 ms guide. **q25** is free.

## 3. Shadows (1080p, `orbit` and `thin`)

| configuration | `orbit` median / **min** | `orbit` run medians (9) | `thin` median / **min** | `thin` run medians (9) | passes, `orbit` (median) |
|---|---|---|---|---|---|
| **shipped (q21: `backfacePass` + `snapHardPx: 2`)** | **0.62** / 0.57 | 0.62 ×8, 0.63 | **0.72** / 0.68 | 0.72 ×9 | temporal 0.409, tiles 0.005, spatial 0.080 + 0.079, stabilize 0.038 |
| pre-q21 (`backfacePass: false`, `snapHardPx: 0`) | 0.62 / 0.57 | 0.62 ×9 | — | — | identical to 0.001 per pass |
| + q23 (`stepTest` + `edgeBox` + `rotationStep: 0`) | 0.64 / 0.58 | 0.63 ×4, 0.64 ×5 | 0.74 / 0.70 | 0.74 ×7, 0.75 ×2 | temporal 0.424 (+0.015); `thin` 0.443 (+0.020) |
| + q24 (`terminatorAnalytic`) | 0.60 / 0.56 | 0.60 ×9 | — | — | spatial 0.073 + 0.072 (−0.007 each) |

- Every `tiles` pass read 0.005 ms (the fast-clock indicator of M4): all 6 shadow configurations × 9 clean runs (54 pages) ran in
  the fast state.
- q21 costs nothing measurable. q23 costs +2.4 % (`orbit`) / +2.8 % (`thin`), all in the temporal pass (the step test and
  edge box). `thin` with q23 reads 0.74 ms, **below the ~0.75 ms target**; SPEC v0.6 §0.3 / §10.3's 0.77–0.78 (SL / SM
  medians) came from other benches. q24 makes the spatial passes cheaper and saves 0.02 ms on `orbit`.

## 4. AO + SO joint (1080p, `orbit`)

| configuration | **median** / **min** | run medians (9) | passes (median) |
|---|---|---|---|
| occlusion A-SVGF `'auto'` (OcclusionDenoiser default) | **2.89** / 2.75 | 2.86 2.86 2.88 2.88 2.89 2.89 2.89 2.90 2.92 | prepass 0.15, normalize 0.06 + 0.05, gradient 0.42, temporal 0.50, variance 0.35, à-trous 0.46 + 0.45 + 0.42 |
| occlusion recurrent (default: `'spatial'` + dense 4, T6 off) | **2.54** / 2.45 | 2.52 2.52 2.52 2.54 2.54 2.55 2.55 2.55 2.65 | prepass 0.09, temporal 0.76, history fix 0.49, blur 0.57, post-blur 0.33, stabilize 0.29 |

10-25 read 3.10 / 2.75 (A-SVGF) and 2.62 / 2.27 (recurrent, then `'mips'`). The A-SVGF min is unchanged. The recurrent
min is +0.18 ms, which fits the spatial fix's cost on radiance (+0.17), but there was no same-session `'mips'` arm for occlusion, so
read the occlusion recurrent delta as unmeasured. No PLAN target applies.

## 5. Status against SPEC §10 / PLAN §8 (targets as decided 2026-10-25)

| target | measured today (M5 Pro, 1080p, test-bed bench median) | status |
|---|---|---|
| diffuse + specular 4 ms, a guide ± 10 % (≤ 4.40) | A-SVGF default **4.40** (min 4.19); recurrent default 4.06; SVGF `'off'` 3.86; A-SVGF + q26 4.55; + q25 4.40 | **default exactly at the edge** (median = 4.40, 4 of 9 runs 4.42–4.47); recurrent and `'off'` within; q26 on top would be 14 % over |
| shadows ~0.75 ms | 0.62 `orbit` / 0.72 `thin` (q21); q23 0.64 / 0.74; q24 0.60 | **met**, also with q23 |
| ≤ 2× native on the same GPU (binding) | locked-clock RTX, native round 3 at HEAD: A-SVGF + `ynp 16` 1.18× (1.20× steady), `'off'` 0.99× REBLUR; recurrent 1.02× (round 1, `'mips'`, pre-T6); shadows 1.19× SIGMA; AO + SO 1.37× (A-SVGF) / 1.12× (recurrent, round 1) REBLUR occlusion | **met**; projected with today's deltas: recurrent ≈ 1.07×, shadows 1.19× (q23 ≈ 1.22×), A-SVGF + q26 ≈ 1.24×. Native round 4 replaces the projections |
| memory | not measured here (unchanged by these options except `'spatial'` 72 vs 73.5 B/px per recurrent signal, SPEC §10.3) | as SPEC v0.6 |

For the spec author (SPEC §0.2 / §0.3 / §10.3 rows "not re-timed on the M5 Pro"): A-SVGF default 4.40 (was ≈ 4.4 estimated),
recurrent joint 4.06, shadows 0.62 / 0.72 (q23 0.64 / 0.74, q24 0.60), AO + SO 2.89 / 2.54.

## 6. Pages during the video call (excluded)

For the record, the same configurations during the call (6 runs each, from 19:57 to 20:47 JST): A-SVGF default 5.20 median
(4.65–5.74), recurrent default 5.66 (4.38–6.19), `'mips'` 10-25 configuration 4.98 (3.91–8.83), occlusion A-SVGF 3.07 with
one 8.38 ms run, shadows `thin` 0.74 with one 1.04 ms run. The fastest frames stayed near the clean ones (within 0.15 ms), so
the "min" statistic survives such load but the medians don't. Every joint diffuse + specular page was hit harder than the
shadow pages. The headless-only quiet check did not see the call (it watches only headless Chromes and runners).
