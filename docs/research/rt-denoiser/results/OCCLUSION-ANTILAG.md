# Occlusion SVGF: `antiLag` default `'off'` (2026-10-26)

**Decision (Dennis, 2026-10-25; SPEC §12 item 2):** `OcclusionDenoiser` with `filter: 'svgf'` defaults to
`antiLag: 'off'`, independently of SVGF radiance's `'auto'` default. `'auto'` stays an option. Code:
`resolveOcclusion` in `packages/denoiser-realtime/src/occlusion.ts` (`antiLag: svgf.antiLag ?? 'off'`);
explicit values pass through unchanged. TASKS `occlusion-antilag-off`.

## Byte checks (rule 9)

Two pinned `git archive` snapshots of `packages/denoiser-realtime/src` at 64acae0: before, and after with only
`occlusion.ts` swapped in. Each was served on its own port (`RT_REALTIME_SRC`, `RT_NO_HMR=1`), with a scratch
registry wrapper adding `x-occ-default` = `new OcclusionDenoiser(device, { signal: 'both' })` (class defaults,
`dispatchBoth`). Replay: `signals=ao,so&frames=16&warm=0`, `cmp` on every `ao.f32` / `so.f32` (32 files per
pair).

| pair | `std540-orbit` | `three-orbit` |
|---|---|---|
| after: class default vs `occlusion-svgf` (explicit `'off'`) | identical | identical |
| before: class default vs `occlusion-svgf-auto` (sanity: the old default was `'auto'`) | identical | identical |
| `occlusion-svgf-auto` (explicit `'auto'`), before vs after | identical | identical |
| `occlusion-svgf` (explicit `'off'`), before vs after | identical | identical |
| `occlusion-recurrent`, before vs after | identical | identical |
| class default, before vs after (should differ) | 31 / 32 differ (frame 0 has no history) | 31 / 32 differ |

So the new default is `occlusion-svgf` and the old one was `occlusion-svgf-auto`, and the A/B below compares those
two registry ids.

## A/B: default before (`'auto'`) vs after (`'off'`)

**Test bed**, 1080p, 96 frames, 7 paths, `signal=ao,so&mode=eval&preset=full&denoiser=occlusion-svgf,occlusion-svgf-auto`,
served from a `git archive` mirror. Pooled PSNR per path and its mean; region columns are means of per-path pooled
PSNR (contact = reference ĥ < 0.5; dynamic = reference changed > 0.05 within 4 frames, for paths that have such
pixels); flicker = fixed-pixel |Δ error|; static tFlicker = motion-compensated |e_t − e_t−1| on static pixels
(the boil proxy); FLIP = path mean. The per-path numbers match REMEASURE-2026-10-25 §3 exactly.

| signal | default | orbit | pan | light | thin | glossy | cut | object | **mean** | contact | dynamic | disocc. | flicker | static tFlicker | FLIP |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| AO | before: `'auto'` | 39.57 | 39.40 | **40.18** | **35.61** | **41.85** | 40.07 | **36.52** | **39.03** | **34.12** | **25.69** | **35.93** | **0.0041** | **0.0056** | 0.0205 |
| AO | after: `'off'` | **39.64** | **39.56** | 40.05 | 35.58 | 41.63 | **40.16** | 35.87 | 38.93 | 33.53 | 25.26 | 35.56 | 0.0047 | 0.0060 | **0.0191** |
| SO | before: `'auto'` | **40.86** | **37.43** | 43.85 | **38.33** | **38.97** | **39.73** | **38.57** | **39.68** | **36.64** | **25.81** | **37.43** | **0.0042** | 0.0034 | **0.0196** |
| SO | after: `'off'` | 40.42 | 35.86 | **43.92** | 38.07 | 38.29 | 38.59 | 36.18 | 38.76 | 35.66 | 24.01 | 36.24 | 0.0043 | 0.0034 | 0.0202 |

**Real scene** (three.js corner, CAPTURE-FORMAT v0, 960×540, AO only: no SO reference), full captures replayed
through the after snapshot's class default (= `'off'`) and `occlusion-svgf-auto` with `signals=ao,so`, scored by a
scratch scorer with compare.mjs's definitions: pooled PSNR, settled (≥ 8 frames after the reset), contact
(`ao_ref` < 0.5), fixed-pixel flicker, and boil = RMS of the output's second temporal difference along the
reprojected history / √6 (all receivers, and contact). The pooled, settled and flicker numbers match
results/M6-real-scene.md.

| capture | default | pooled | settled | contact | flicker | boil | boil contact |
|---|---|---|---|---|---|---|---|
| `three-orbit` | before: `'auto'` | 33.10 | 33.02 | 20.84 | **0.0084** | **0.0092** | **0.0317** |
| `three-orbit` | after: `'off'` | **33.43** | **33.41** | **21.26** | 0.0091 | 0.0099 | 0.0336 |
| `three-pan` | before: `'auto'` | 33.48 | 33.80 | 20.23 | **0.0093** | **0.0091** | **0.0342** |
| `three-pan` | after: `'off'` | **33.55** | **33.90** | **20.43** | 0.0099 | 0.0099 | 0.0361 |

(The reference's own boil is 0.0145 / 0.0129, 0.048 / 0.049 in contact: the 1024-ray references are noisier
frame to frame than either output.)

**Cost.** Not re-measured: the GPU was busy the whole time (another agent's 1080p E-1 evals and replays),
so a solo bench would have been unreliable. Existing numbers: the M5 Pro solo bench (REMEASURE §3) gives joint
AO + SO median 2.89 (`'off'`) vs 3.10 ms (`'auto'`), fastest frame 2.54 vs 2.75; AO alone 1.33 vs 1.67 (fastest);
SO alone 1.77 vs 1.61 (fastest; on SO `'auto'` is the cheaper one there). On the RTX 3060 Laptop next to native
(native/results/PHASE4-5.md): AO + SO 4.15 vs 4.95 ms. Memory: 84 / 148 B/px vs 88 / 156 (AO / AO + SO).

## Reading

- AO: `'off'` is 0.1 dB below `'auto'` on the test bed mean (ahead on orbit / pan / cut, behind on the rest),
  with most of the gap on `object` (−0.65 dB) and in contact (−0.6 dB mean, again mostly `object`). On the
  real scene `'off'` is ahead: +0.33 / +0.07 dB pooled, +0.42 / +0.20 dB in contact. It flickers and boils
  ~7–15 % more on both scenes.
- SO: `'auto'` is 0.9 dB better on the test bed (pan +1.6, cut +1.1, object +2.4), with no real-scene
  reference to check it. A caller who uses SO should pass `{ antiLag: 'auto' }`.
- Cost: `'off'` saves 0.2 ms joint on the M5 Pro and 0.8 ms on the RTX bench, plus 4 B/px per signal.
