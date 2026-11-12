# Re-measure, 2026-10-25 (SPEC v0.2 items)

_remeasure agent (evaluator / implementer, RULES.md rule 8: no NRD code, README or port read).
Everything here was measured on our own test bed. It re-runs the rows SPEC v0.2 §0.2 still
quoted with anti-lag v1, a different bench or the 960×540 preset, each comparison in one page
so the arms share references. The defaults are still **provisional** (SPEC not reviewed)._

**Headline:**

- **Joint diffuse + specular, on one bench:** the `filter: 'recurrent'` default hybrid (recurrent
  diffuse + A-SVGF v2 specular) scores 38.26 / 35.04 dB pooled at **4.79 ms**. The old 5.98 ms
  was anti-lag v1, timed on the dev page. Its specular output is bit-identical to `svgf-auto`'s on
  all 7 paths. It is still dominated: `svgf-auto` gives 39.12 / 35.04 at 4.23 ms. On the same
  test-bed bench, **recurrent for both signals costs 3.99 ms, the same as SVGF `'off'` (4.00)**.
  The dev page timed it at 4.44 ms. Quality is unchanged: recurrent loses to both SVGF variants
  on diffuse, and to `svgf-auto` on specular.
- **Occlusion, A-SVGF `auto` with v2:** AO 39.03 dB (v1 39.05), SO **39.68** (v1 39.52). It is
  now cheaper than v1: fastest frame AO 1.67 ms (v1 2.16), SO 1.61 ms (v1 2.53, now below plain
  SVGF's 1.77). Joint AO + SO costs 3.10 ms (median) on the bench. Memory is 88 / 156 B/px
  (v1 92 / 163). SVGF and recurrent reproduce M5 to the hundredth.
- **Shadows `uniformSnap: 'change'` at 1080p:** 37.23 dB pooled, penumbra 28.75, FLIP 0.0186.
  That is between on (37.11 / 28.57 / 0.0182) and off (37.29 / 28.88 / 0.0198). It keeps the
  snap's light-flip recovery (frames 48–51 equal to on, +0.4–0.5 dB over off) and three
  quarters of its FLIP gain, while recovering two thirds of the PSNR the snap costs. This
  supports SPEC §12 item 5's recommendation (`'change'`).
- Hygiene: the stale "for stabilization" comments on `data`'s m·c_v bits in
  `src/shaders/recurrent.ts` are fixed in dda6596. Comments only: the generated WGSL is
  identical, modulo comments, over 96 pass variants.

## 1. Setup

| | |
|---|---|
| GPU / browser | Apple M5 Pro (`metal-3`), HeadlessChrome 155, `--use-angle=metal`, WebGPU timestamps |
| Test bed | `examples/realtime-denoiser`, `preset=full` (1920×1080), 7 paths × 96 frames, blue noise, 256-spp references, FLIP every 12th frame at 41.4 ppd (as M1–M5) |
| Denoiser code | `packages/denoiser-realtime` + `packages/denoiser-core` **at 7782074** (HEAD at start; the package `src/` is unchanged since 39aeb6b), frozen as a `git archive` copy via `RT_REALTIME_SRC`. The registry (`tools/rt-capture`) and the test bed were served from the worktree, also at 7782074 (clean). dda6596 (comments, §5) came after the measurements and changes no code |
| Server | own instance on 127.0.0.1:5340, a scratch Vite config merged with the test bed's: `server.hmr: false` and a scratch registry wrapper (below) |
| Arms | registry ids with package defaults: `svgf` (`antiLag: 'off'`), `svgf-auto` (`'auto'`, v2), `recurrent` (both signals recurrent), `recurrent-svgfspec` (= `DiffuseSpecularDenoiser({ filter: 'recurrent' })`: recurrent diffuse + SVGF `'auto'` v2 specular), `occlusion-svgf`, `occlusion-svgf-auto` (v2), `occlusion-recurrent`, `ffx-shadows`, `shadows`. In eval mode each (signal, id) pair is its own instance (the registry's per-signal path), as in M1–M5 |
| Scratch wrapper | re-exports the registry and adds (a) `j-<id>`: the entry forced to its **joint** instance (`DiffuseSpecularDenoiser.dispatchBoth` / `OcclusionDenoiser.dispatchBoth`), registered for one signal, so `mode=bench` times both signals in shared dispatches; (b) `shadows-snapon` / `-snapchange` / `-snapoff`: `shadows` with `sh.uniformSnap` forced to `true` / `'change'` / `false`, so all three run in one page |
| Quality metrics | **pooled PSNR** (PSNR of the mean MSE over frames and pixels), mean over the 7 paths. Regions are pooled: disoccluded = < 8 frames of true history, 6 paths (`light` has none); penumbra (shadows); contact = reference ĥ < 0.5 (occlusion). FLIP and flicker (fixed-pixel \|Δ error\|) are path means. "per-frame mean" is the old mean of per-frame dB, given for reference only |
| Timing statistic | test-bed solo bench, `mode=bench&preset=full&path=orbit&n=200`: 200 timed frames after 20 warm-up, one (signal, id) per page load. 9 rounds alternate the page order, each led by a throwaway warm-up page. Each page started only when no other headless Chrome tree or runner used CPU (summed over the process tree, > 3 %). One page that had contention when it finished was dropped (8 runs left for `j-svgf`). Reported: **median** = the median over runs of each run's median frame; **min** = the fastest single frame over all runs (the "fastest clock state" of M4/M5). The M5 Pro switches between two clock states from run to run (LESSONS), so the spread is listed too |

Commands (from `examples/realtime-denoiser`; `$S` = the scratch folder):

```sh
git archive 7782074 packages/denoiser-realtime/src packages/denoiser-core/src | tar -x -C $S/snap
RT_REALTIME_SRC=$S/snap/packages/denoiser-realtime/src node ../../node_modules/vite/bin/vite.js \
  --config $S/wrap/vite.config.mjs --port 5340 --strictPort --host 127.0.0.1
export BASE=http://127.0.0.1:5340/
node run-headless.mjs --json=joint-<path>.json "signal=diffuse,specular&mode=eval&preset=full&denoiser=svgf,svgf-auto,recurrent,recurrent-svgfspec&path=<path>"
node run-headless.mjs --json=occ-<path>.json "signal=ao,so&mode=eval&preset=full&denoiser=occlusion-svgf,occlusion-svgf-auto,occlusion-recurrent&path=<path>"
node run-headless.mjs --json=sh-<path>.json "signal=shadows&mode=eval&preset=full&denoiser=ffx-shadows,shadows-snapon,shadows-snapchange,shadows-snapoff&path=<path>"
node run-headless.mjs "signal=diffuse&mode=bench&preset=full&path=orbit&n=200&denoiser=j-svgf"   # one per page, quiet GPU
```

The eval pages ran 3 at a time. The results are deterministic (LESSONS), so parallel pages don't
change them. Raw data: [data/remeasure-joint-1080p.json](data/remeasure-joint-1080p.json),
[data/remeasure-occlusion-1080p.json](data/remeasure-occlusion-1080p.json),
[data/remeasure-shadows-snap-1080p.json](data/remeasure-shadows-snap-1080p.json) (per-frame PSNR
included), [data/remeasure-bench-1080p.jsonl](data/remeasure-bench-1080p.jsonl) (every bench
page, with per-pass medians), and
[data/remeasure-bench-occ-n600-1080p.jsonl](data/remeasure-bench-occ-n600-1080p.jsonl) (§3 note).

**Reproduction check:** every arm that was already measured at 1080p reproduces its earlier
number exactly, per path. `svgf` / `svgf-auto` match M1 §12.3, `recurrent` matches M2-M3 §2,
`occlusion-svgf` / `-recurrent` match M5 §2, and `ffx-shadows` / `shadows` with snap on and off
match M4 §10.1. So the deltas below come only from the changed arms. No arm produced a NaN or Inf.

## 2. Joint diffuse + specular (one page)

Pooled PSNR (dB) per path, 1080p:

| signal | denoiser | orbit | pan | light | thin | glossy | cut | object | **mean** | disocc. | FLIP | flicker |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| diffuse | `svgf` (`'off'`) | 40.65 | 39.45 | 40.57 | 34.41 | 39.48 | 39.71 | 37.87 | 38.88 | 37.57 | 0.0357 | 0.0035 |
| diffuse | `svgf-auto` (v2) | **40.97** | **39.65** | **40.93** | **34.47** | **39.71** | **40.00** | **38.08** | **39.12** | **37.69** | **0.0332** | **0.0031** |
| diffuse | `recurrent` | 39.79 | 38.20 | 39.90 | 34.16 | 39.70 | 39.06 | 37.02 | 38.26 | 36.41 | 0.0407 | 0.0038 |
| diffuse | `recurrent-svgfspec` | = `recurrent` (same diffuse filter, identical numbers) | | | | | | | 38.26 | 36.41 | 0.0407 | 0.0038 |
| specular | `svgf` (`'off'`) | 32.29 | 33.91 | 35.02 | 35.41 | 30.65 | 32.69 | 34.24 | 33.46 | 34.11 | 0.0511 | 0.0042 |
| specular | `svgf-auto` (v2) | **33.93** | **35.80** | **35.27** | **35.93** | 34.48 | **34.81** | **35.11** | **35.04** | **34.96** | **0.0464** | **0.0037** |
| specular | `recurrent` | 32.83 | 34.45 | 34.35 | 35.42 | **34.65** | 33.54 | 33.48 | 34.10 | 33.60 | 0.0521 | 0.0047 |
| specular | `recurrent-svgfspec` | = `svgf-auto` on every path (bit-identical specular filter) | | | | | | | 35.04 | 34.96 | 0.0464 | 0.0037 |

Joint cost, both signals in one `dispatchBoth`, 1080p, solo bench on `orbit`:

| configuration | **median** (ms) | **min** (ms) | run medians (9 runs) | passes (median over runs) |
|---|---|---|---|---|
| `svgf` (`'off'`) | **4.00** | 3.68 | 3.92–4.00 in 5 runs; 4.45, 4.66, 6.46 (slow clock); 8 runs | prepass 0.15, temporal 0.59, variance 0.80, à-trous 0.48 + 0.48 + 0.47 + 0.47 + 0.45 |
| `svgf-auto` (v2) | 4.23 | 3.94 | 4.21–4.23 in 6 runs; 4.52, 4.53, 4.96, 6.05 | + gradient 0.50 (create 0.28, à-trous 4 × 0.04, λ 0.07); variance 0.50 |
| `recurrent` (both) | **3.99** | 3.73 | 3.96–3.99 in 5 runs; 4.53, 5.12, 5.29, 5.51 | prepass 0.09, pre-blur 0.64, temporal 1.03, mips 0.11, history fix 0.44, blur 0.75, post-blur 0.39, stabilize 0.43 |
| `recurrent-svgfspec` (`filter: 'recurrent'` default) | 4.79 | 4.46 | 4.77–4.79 in 5 runs; 5.34, 5.62, 5.86, 8.19 | prepass 0.15 (shared); recurrent diffuse 2.02; SVGF `'auto'` specular 2.47 (gradient 0.32) |

- **The hybrid now costs 4.79 ms, not 5.98.** The 5.98 ms was anti-lag v1 on the dev page. On
  the same bench it is +0.56 ms over `svgf-auto` for −0.86 dB diffuse and the same specular, so
  it is still dominated (SPEC §12 item 1).
- **On the test-bed bench, recurrent for both signals costs the same as SVGF `'off'`** (3.99 vs
  4.00 ms, within 0.25 % of the median) and 0.24 ms less than `svgf-auto`. M2-M3 §4's 4.44 ms
  came from the package's dev page (min of 400 frames, a different scene). There SVGF read 4.02,
  about the same as here, but every recurrent pass reads 7–18 % slower there (pre-blur 0.75 vs
  0.64, temporal 1.20 vs 1.03, blur 0.87 vs 0.75, history fix 0.47 vs 0.44). So the cost ranking between filters depends on the
  scene. Compare filters on one bench only.
- `svgf` / `svgf-auto` agree with M1 §12.4 (3.99 / 4.24, median of 100 frames) within 0.01 ms.

## 3. Occlusion (one page, AO and SO)

Pooled PSNR on ĥ (dB) per path, 1080p:

| signal | filter | orbit | pan | light | thin | glossy | cut | object | **mean** | contact | disocc. | FLIP | flicker |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| AO | `occlusion-svgf` | **39.64** | **39.56** | 40.05 | 35.58 | 41.63 | **40.16** | 35.87 | 38.93 | 33.53 | 35.56 | **0.0191** | 0.0047 |
| AO | `occlusion-svgf-auto` (v2) | 39.57 | 39.40 | **40.18** | **35.61** | **41.85** | 40.07 | **36.52** | **39.03** | **34.12** | **35.93** | 0.0205 | **0.0041** |
| AO | `occlusion-recurrent` | 38.59 | 38.53 | 39.53 | 35.15 | 40.89 | 38.80 | 34.63 | 38.02 | 31.09 | 34.07 | 0.0205 | 0.0044 |
| SO | `occlusion-svgf` | 40.42 | 35.86 | **43.92** | 38.07 | 38.29 | 38.59 | 36.18 | 38.76 | 35.66 | 36.24 | 0.0202 | 0.0043 |
| SO | `occlusion-svgf-auto` (v2) | **40.86** | **37.43** | 43.85 | **38.33** | **38.97** | **39.73** | **38.57** | **39.68** | **36.64** | **37.43** | **0.0196** | 0.0042 |
| SO | `occlusion-recurrent` | 38.30 | 34.01 | 42.43 | 36.71 | 38.23 | 36.93 | 34.98 | 37.37 | 33.47 | 34.13 | 0.0225 | **0.0039** |

v2 vs v1 (M5 §2, same references): AO 39.03 vs 39.05 (−0.02; contact 34.12 vs 34.14), SO
**39.68 vs 39.52** (+0.16; contact 36.64 vs 36.37). A-SVGF still wins SO on 6/7 paths (`light`
−0.07 vs SVGF) and AO on 4/7. SVGF and recurrent are unchanged from M5.

Cost, 1080p, solo bench on `orbit`. AO and SO alone each pay the guide prepass; "joint" is
`dispatchBoth` (AO + SO in shared dispatches):

| filter | AO median / **min** | SO median / **min** | joint AO + SO median / **min** | AO run medians (9 runs) |
|---|---|---|---|---|
| `occlusion-svgf` | 1.72 / **1.33** | 2.34 / **1.77** | **2.89** / 2.54 | 1.40–2.09 |
| `occlusion-svgf-auto` (v2) | 1.97 / **1.67** | 2.19 / **1.61** | **3.10** / 2.75 | 1.86–2.42 |
| `occlusion-recurrent` | 1.94 / **1.20** | 2.13 / **1.29** | **2.62** / 2.27 | 1.52–2.16 |

- **The single-signal medians are not reliable here.** A 1.2–2 ms page is short enough that
  whole runs land in one clock state or the other, so run medians spread by ±20 % (AO
  `occlusion-svgf` 1.40–2.09). A second set with 600 frames per page (5 rounds,
  [data](data/remeasure-bench-occ-n600-1080p.jsonl)) landed in the slow state more often:
  medians were 10–40 % higher. Its fastest frames matched the SVGF arms' to ±0.05 ms, but the
  recurrent arm's fastest frames were higher: AO 1.31 (vs 1.20) and SO 1.61 (vs 1.29). Read
  single-signal costs from the **min** column (M5's statistic), give the recurrent mins about
  ±0.1–0.3 ms, and prefer the joint medians, which are stable (the 2.5–3 ms joint pages spread
  less).
- v2 vs v1 (M5 §5, min): A-SVGF AO 1.67 vs 2.16 ms, SO 1.61 vs 2.53 ms. The SO gain comes from
  anti-lag v2's 3×3 young-history variance for specular (variance pass 0.20 vs SVGF `'off'`'s
  0.64 ms), so SO A-SVGF is now cheaper than SO SVGF. The joint 3.10 ms replaces M5's 5.27 ms,
  which was v1 and came from an 8-frame replay that overweights young histories. On the same
  bench, joint A-SVGF costs +0.21 ms over joint SVGF and +0.48 ms over joint recurrent.
- **Memory with v2** (from the allocations in `svgf.ts` at 7782074, not measured): the anti-lag
  state is 2 × rgba32uint + 1 × r32float per 3×3 stratum = 4 B/px per signal (v1 7.6). A-SVGF
  occlusion is **88 B/px for AO, 156 B/px for AO + SO** (v1 92 / 163). SVGF stays 84 / 148 and
  recurrent 57.5 / 73.5.

## 4. Shadows `uniformSnap` (one page)

Pooled PSNR (dB) per path, 1080p (`shadows` = v2 defaults; only `uniformSnap` differs):

| denoiser | orbit | pan | light | thin | glossy | cut | object | **mean** | penumbra | disocc. | FLIP | flicker |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `ffx-shadows` | 30.49 | 34.12 | 27.88 | 29.82 | 32.72 | 31.99 | 31.36 | 31.20 | 23.50 | 32.91 | 0.0379 | 0.0053 |
| `uniformSnap: true` (default) | 36.38 | 39.09 | **34.08** | 35.03 | 41.60 | 37.31 | 36.26 | 37.11 | 28.57 | **34.68** | **0.0182** | 0.0033 |
| `uniformSnap: 'change'` | 36.44 | 39.19 | **34.08** | 35.15 | 42.03 | 37.40 | 36.32 | 37.23 | 28.75 | 34.67 | 0.0186 | 0.0033 |
| `uniformSnap: false` | **36.49** | **39.25** | 33.99 | **35.22** | **42.28** | **37.46** | **36.34** | **37.29** | **28.88** | 34.66 | 0.0198 | 0.0033 |

FLIP per path:

| | orbit | pan | light | thin | glossy | cut | object |
|---|---|---|---|---|---|---|---|
| `true` | **0.0149** | **0.0162** | **0.0212** | 0.0265 | 0.0114 | 0.0143 | 0.0231 |
| `'change'` | 0.0152 | 0.0164 | 0.0234 | 0.0265 | 0.0112 | 0.0143 | **0.0230** |
| `false` | 0.0151 | 0.0164 | 0.0312 | **0.0262** | **0.0106** | **0.0140** | 0.0251 |

Light flip (`light`, frame 48), per-frame PSNR: frames 48 / 49 / 50 / 51 read on 27.22 / 31.64 /
33.09 / 34.03, `'change'` 27.21 / 31.63 / 33.08 / 34.02, off 26.78 / 31.09 / 32.65 / 33.72.

- `'change'` vs `true`: +0.12 dB pooled (better on 6/7, `light` equal), +0.18 penumbra, FLIP
  +0.0004 mean (worse on `orbit`, `pan`, `light`; better on `glossy`, `object`).
- `'change'` vs `false`: −0.06 dB pooled, −0.13 penumbra, FLIP −0.0012. Most of that comes from
  `light`, 0.0234 vs 0.0312, where `'change'` recovers from the flip as fast as `true`.
- So `'change'` recovers 2/3 of the PSNR the snap costs (0.12 of 0.18 dB) and keeps 3/4 of its
  FLIP gain (0.0012 of 0.0016). It confirms the 960×540 ordering of M4 §10.5 at 1080p. Disoccluded
  and flicker are equal across the three. This is evidence for SPEC §12 item 5; the default is
  not changed here (it is still `true`, Dennis decides).

## 5. Hygiene: recurrent comments (dda6596)

`src/shaders/recurrent.ts` described the m·c_v value packed into `data` (8-bit `m`) as feeding
stabilization. No pass has read it since R7's virtual candidate was removed: temporal writes it,
history fix only carries it over (`unpackM` has no other use), and stabilization reads only the
2×2 validity mask. Three comments now say so: the `data` layout note, `mVirt`'s declaration and
its assignment. `src/recurrent.ts` had no such comment. Check: bundle the generator with rolldown,
then dump every pass for {diffuse, specular, both, ao, so, ao + so} × {8, 4 taps} × both
stabilize variants (96 passes) from the 7782074 snapshot and from the edited file. The WGSL is
identical once comments and blank lines are stripped (40 650 code lines), the binding lists are
identical, and `tsc --noEmit` passes. Behaviour matches SPEC v0.2 §5.11–5.12. The 8 bits are
still written (a cost of nothing measurable), so dropping them is left as a possible cleanup.
