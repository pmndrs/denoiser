# SVGF follow-ups: anti-lag spill into constant light, and Bistro boil from the normal test (2026-10-27)

_SVGF implementer / evaluator (RULES.md rule 8: no NRD code, README, NRD-Sample, RTG II listing or quarantine folder
opened). Two follow-ups filed in TASKS on the shipped A-SVGF default: (1) T3's "λ leaks into constant-light pixels during a
light event" (it blocks q26 option (b)), (2) T6 §5's "Bistro AO / diffuse boil from SVGF's normal-test resets". Everything
was measured on our own test bed and captures (Apple M5 Pro, HeadlessChrome 155, Metal). Every option defaults to today's
behaviour, byte-identical (§4). Provisional until the orchestrator / Dennis act on §6._

## Conclusion first

1. **Item 1, anti-lag spill: reproduced exactly** (lc-step diffuse static boil +38 %, lc-jump +25 %, lc-hue with
   `antiLagChroma` +38 %; specular +14…+20 %). **Cause, measured:** it is not λ spreading far, not the reconstruction blur
   and not the spatial filter blending reset neighbours. The whole excess sits in static pixels **within 2 px** of a pixel
   whose light changes, and only in those whose **own** stratum λ became > 0: two thirds of them share their 3×3 stratum
   with changing pixels (+71 %), one third got λ through the 3×3 max over strata (+22 %); pixels whose λ stayed 0 show no
   excess. About half the excess is the boost itself, half its persistence through A-SVGF's history clamp n = 1/α. It is
   the 3–9 px granularity of A-SVGF's per-stratum gradient, and at 1 spp no per-pixel statistic can tell those pixels from
   their changing neighbours. **Candidates** (all options, default off): the existing `antiLagRadius: 0` and
   `gradientIterations`, and a new `antiLagHistoryScale` (n ← (1 − λ) n) halve or third the leak but slow the reaction by
   2–7 frames (lc-step diffuse t10 8 → 13 with the new option; on lc-hue it gives back most of what `antiLagChroma` gains);
   three spatial variants changed nothing and were removed. **None proposed.** For q26: the exception is the shipped
   default's own brightness-event behaviour, inherent to the 3×3 strata and not specific to `antiLagChroma`; my
   recommendation is to treat it as a documented property of A-SVGF, not a blocker (§2.3).

2. **Item 2, Bistro boil: reproduced exactly** (AO boil 0.0103 = 2.6× the reference's 0.0039, diffuse 2.1×). One premise
   of T6 corrected: the Bistro / Sponza captures have **no normal maps** (geometry-only scenes; a `normal_geom` capture
   matches `normal` to cos > 0.9999), so the resets come from dense geometry, and "the geometric normal as the test's
   input" is already what the test reads there. **New option `normalTest: 'soft'`** (our design): where the full cos 0.95
   test would reset the pixel, the footprint is retried at cos 0.5 and its taps give a short history, n ≤ 1 + 2 × their
   normal agreement (diffuse / AO), while specular keeps its reset (`normalSoftHistory` per signal, 1 = today's, byte-
   identical). **Rule 9: passes every clause.** 11 real captures: diffuse +0.150 dB, AO +0.183, boil −8.7 % / −11.0 %, FLIP
   −0.2 / −0.1 %, no capture or region worse than −0.017 dB, specular byte-identical; Bistro orbit AO 26.20 → 26.46 dB,
   boil 0.0103 → 0.0082 (2.6× → 2.1× the reference's). Test bed 1080p 7 paths level (diffuse −0.000, AO −0.001, SO −0.003,
   worst −0.017 SO on `object`; flicker ±0), 4096-spp ±0.000, normal-mapped detail paths diffuse +0.054 / AO +0.204, cost
   ±0 (within ±0.6 % on Bistro / Sponza replays). **Proposed as a default flip** (§6): it changes the look of moving
   views over dense geometry (less boil), so it goes to Dennis via the orchestrator. The geometric-normal option
   (`historyNormal: 'geometric'`, measured on the normal-mapped detail build) **fails** (specular −0.19 dB, diffuse −0.98 on
   `dt-grooves`).

## 1. Setup

| | |
|---|---|
| package | HEAD ec12ebf + this work, served from frozen copies of `packages/denoiser-realtime/src` (`RT_REALTIME_SRC`, one Vite server per code state on 5221–5229, `server.hmr: false`, `--strictPort`) |
| light-change captures | `lc540-step`, `lc540-jump`, `lc540-hue` re-captured with T3's paths (`signal=diffuse,specular`, 96 frames, 960×540, 256-spp references; 5.4 GB each, deleted afterwards). Scored with T3's [t3-score.mjs](data/t3-score.mjs) `--stat 0` (static = reference bit-identical over all 96 frames) and two new scorers: [spill.mjs](data/svgf-followups/tools/spill.mjs) (static-pixel boil per window by distance to the nearest non-static receiver) and [spill-lam.mjs](data/svgf-followups/tools/spill-lam.mjs) (the 0–2 px band split by the pixel's own λ and by whether its 3×3 stratum is all-static). Diagnostics from a scratch registry entry ([registry-wrap-dbg.ts](data/svgf-followups/tools/registry-wrap-dbg.ts): history length n, λ at the pixel's stratum, and the temporal accumulation before the spatial filter) |
| real scenes | T6's 9 captures (`bistro-orbit/-move/-pan`, `sponza-orbit/-pan/-move`, `three-orbit`, `three-pan`, `three-knot-static`) + `three-knot-orbit`, `three-knot-still` = 11, 48 (40 / 32) frames, 960×540; scored with [t6-boundaries/score.mjs](data/t6-boundaries/score.mjs) (reference-smooth boil with the reference's own boil as the q20 (a) floor, boundary region, AO vs `ao_ref`), tables by [scenes.mjs](data/svgf-followups/scenes.mjs) |
| motion-compensated boil | [t1-score.mjs](data/t1-score.mjs) on std540 × 7, std1080-orbit and the knot captures |
| live A/B | test bed, 7 paths, 1920×1080, 96 frames, 256-spp references, FLIP every 12th frame, baseline and variant in one page (`id@key=v`); 4096-spp references (E-1 setup) on orbit / light / glossy at 960×540; normal-mapped `dt-bumpy` / `dt-grooves` / `dt-fine` (T5's detail build) at 960×540 with 4096-spp references |

## 2. Item 1: anti-lag spill into constant-light pixels (T3 §3)

### 2.1 Reproduced

Shipped `svgf-auto` on the re-captured paths, strict static mask (reference bit-identical over 96 frames), boil ×10⁻⁴
before / in the 8 frames after onset / after the return. Byte-identical to T3's numbers (the default path did not change):

| path | signal | static boil pre / in / out | Δ in | t10 on / ret | plain SVGF (`'off'`) |
|---|---|---|---|---|---|
| lc-step | diffuse | 6.8 / 9.4 / 9.3 | **+38 %** | 8 / 8 | 11.8 / 11.9 / 11.7, t10 9 / 10 |
| lc-step | specular | 9.0 / 10.5 / 11.0 | +17 % | 4 / 4 | 14.7 / 14.4 / 14.7 |
| lc-jump | diffuse | 6.7 / 8.4 / 8.4 | **+25 %** | 11 / 9 | 11.7 constant |
| lc-jump | specular | 9.1 / 10.4 / 10.3 | +14 % | 4 / 4 | 14.8 constant |
| lc-hue | diffuse | 6.8 / 6.5 / 6.6 | −4 % (blind) | 21 / 21 | 11.8 constant |
| lc-hue + `antiLagChroma` | diffuse | 6.8 / 9.4 / 9.0 | **+38 %** (T3 quoted +44 % on another window cut) | 8 / 9 | |
| lc-hue + `antiLagChroma` | specular | 9.1 / 10.9 / 11.0 | +20 % | 4 / 4 | |

Raw: [raw/light-change/t3-score-repro.txt](data/svgf-followups/raw/light-change/t3-score-repro.txt) and the `s1-*.json` files.

### 2.2 Mechanism: the pixel's own λ, through its stratum, kept alive by the history-length clamp

1. **Where.** By distance to the nearest receiver whose reference changes at all ([spill.mjs](data/svgf-followups/tools/spill.mjs),
   lc-step, boil ×10⁻⁴ pre / in): the whole excess sits **within 2 px** of such a pixel (42 % of the static set). Further out,
   static boil *drops* during the event. Same on lc-jump and on lc-hue with `antiLagChroma`.

   | distance (px) | 0–2 | 3–5 | 6–11 | 12–23 | 24–47 |
   |---|---|---|---|---|---|
   | static pixels (diffuse) | 53 861 | 28 040 | 22 942 | 18 575 | 5 404 |
   | diffuse boil pre / in | 8.7 / 13.8 (**+58 %**) | 4.6 / 4.5 | 4.1 / 3.7 | 4.8 / 4.2 | 6.2 / 4.9 |
   | specular boil pre / in | 10.4 / 12.7 (+22 %) | 7.8 / 8.2 | 7.0 / 7.2 | 7.8 / 7.5 | 12.6 / 12.5 |

2. **Whose λ.** Splitting the 0–2 px band by the pixel's *own* λ (its stratum's value, read back through a scratch debug
   entry) during the window: pixels whose λ stayed 0 have no excess (diffuse 4.2 → 3.7, −13 %); pixels whose λ was > 0 at
   least once carry all of it (11.3 → 18.6, **+64 %**). Of those, **two thirds share their 3×3 stratum with a pixel whose
   light changes** (+71 %); one third sit in an all-static stratum and got λ from the 3×3 max over strata or the
   reconstruction (+22 %). Specular: 99 % of the band has λ > 0 at some frame (its noise floor is k = 1), +25 % / +11 %.
   ([spill-lam.mjs](data/svgf-followups/tools/spill-lam.mjs), [raw](data/svgf-followups/raw/light-change/spill-step-by-lambda.txt).)
3. **Why it lasts.** A static pixel in such a stratum gets α = mix(0.1, 1, λ) for the frame (the boost), and then A-SVGF's
   history clamp n = 1 / α (n ← min(n, 1 / mix(1 / n, 1, λ))) leaves it at n ≈ 5 for λ ≈ 0.15, so α = 1 / n stays above the
   0.1 floor for ~5 more frames. Replacing the clamp by n ← (1 − λ) n (option `antiLagHistoryScale` below, same boost)
   halves the excess, so about half of the boil comes from the boost and half from the clamp's persistence.
4. **What it is not** (each measured on lc-step and ruled out):
   - *λ spreading far*: the reconstruction reaches up to 45 px but nothing is measurable beyond 2 px; gradient iterations
     4 → 2 lowers the excess to +20 % only because it also raises the static floor (9.8 vs 8.7 before the event).
   - *the spatial filter blending neighbours that reset*: down-weighting à-trous taps by history ratio
     (w × min(1, k n_q / n_p), k = 1 / 2 / 4), capping the neighbours' variance in SVGF's 3×3 variance prefilter at k × the
     centre's (k = 1 / 2 / 4), or stopping taps whose λ exceeds the centre's (exp(−k Δλ), k = 10 / 50 / 300): the excess
     stays at +54…+58 %. Neither do `sigmaLuminance` 1, `spatialVarianceBoost` 0 or `spatialVarianceRadius` 0. (These three
     à-trous variants were built as scratch options for the test only and removed again.)
   - *the temporal accumulation of the static pixel alone*: its unfiltered accumulation boil rises only 0.2 % — but that
     is in quadrature with 214 × 10⁻⁴ of white noise, i.e. an added ~15 × 10⁻⁴ component, the same size as the output's
     excess: the boost is per stratum (3×3 pixels at once, 9×9 with the max), so it is spatially correlated and the spatial
     filter cannot average it away. With 1 à-trous iteration the output excess is +3 × 10⁻⁴, with 3 +3.9, with 5 +5.1.

**Reading.** A-SVGF estimates the temporal gradient per 3×3 stratum and applies λ per stratum (S2 §3.5, with the 3×3 max
"to account for reconstruction error"), so the boost has a 3–9 px granularity by construction; a pixel next to a lighting
change gets it whether its own light changes or not. At 1 spp no per-pixel statistic separates the two: a 20 % change of
a pixel's indirect light is far inside one sample's noise, and a 3×3 pixel-centred test sees the changing neighbours too
(two thirds of the affected pixels share the stratum with them). `antiLagChroma` does not create the leak; it makes a
colour change trigger the shipped default's brightness-event behaviour (lc-hue + chroma +38 % = lc-step's +38 %).

### 2.3 Candidates (options, default off) and their trade

lc paths, t3-score `--stat 0`; "in" = dynamic-region pooled PSNR in the event window, t10 = frames until < 10 % of the old
appearance is left ([raw](data/svgf-followups/raw/light-change/t3-score-history-scale.txt)):

| arm | lc-step diffuse: static boil Δ in / t10 / in dB | lc-step specular | lc-jump diffuse | lc-hue + chroma diffuse | lc-hue + chroma specular |
|---|---|---|---|---|---|
| shipped (`svgf-auto`; hue: + `antiLagChroma`) | +38 % / 8 / 33.55 | +17 % / 4 / 28.27 | +25 % / 11 / 35.20 | +38 % / 8 / 37.54 | +20 % / 4 / 30.56 |
| `antiLagRadius: 0` (existing; no 3×3 max) | +31 % / 10 / 33.01 | +3 % / 6 / 27.72 | +11 % / 13 / 34.71 | +35 % / 9 / 37.18 | +5 % / 5 / 30.42 |
| **`antiLagHistoryScale`** (new: n ← (1 − λ) n) | +21 % / **13** / 32.50 | +4 % / **8** / 27.53 | +10 % / **16** / 34.40 | +19 % / **13** / 36.64 | +7 % / **7** / 30.57 |
| `antiLagHistoryScale` + radius 0 | +17 % / 15 / 32.11 | −1 % / 10 / 26.99 | +3 % / 17 / 34.02 | +17 % / 14 / 36.37 | +1 % / 9 / 30.18 |
| `gradientIterations: 2` (existing) | +13 % (floor +12 %) / 9 / 33.52 | +3 % (floor +29 %) / 4 / 28.47 | +9 % / 13 / 34.87 | | |

Every arm that shrinks the leak slows the reaction the leak comes from: `antiLagHistoryScale` halves it and costs 5 frames
of t10 on diffuse (8 → 13) and 4 on specular (4 → 8), −1.0 dB in the event window; on lc-hue it gives back most of what
`antiLagChroma` buys (t10 8 → 13). **None is proposed**, and no rule-9 A/B was run for them: they fail their own target
(the reaction time q26 is about) before the general clauses. `antiLagHistoryScale` stays as a documented option (it
isolates the clamp's share; a still-view application might prefer it); the à-trous variants were removed.

**For q26.** The exception T3 listed ("+44 % boil on lc-hue's constant-light pixels during the event") is the shipped
default's own brightness-event behaviour, confined to pixels within 2 px of a lighting change and inherent to the 3×3-stratum
gradient; it is not specific to `antiLagChroma`, it is not fixable by λ confinement at 1 spp, and every knob that reduces it
undoes the faster reaction. My recommendation for the decision is to treat it as a property of A-SVGF rather than a blocker
(the orchestrator maps this to the decisions page's q26 options).


## 3. Item 2: Bistro AO / diffuse boil from SVGF's normal-test resets (T6 §5)

### 3.1 Reproduced, and one premise corrected

Shipped defaults on `bistro-orbit` (T6 score): AO 26.20 dB, boil **0.0103** vs the reference's own 0.0039 (2.6×);
diffuse 31.35 dB, boil 0.0078 vs 0.0037 (2.1×); specular 46.69 dB, boil 0.0011 (reference 0.0012). Identical to T6.

T6 §3 / §5 attributed the resets to "normal-mapped bricks and cobbles" (the pages' `normalView`). **The Bistro / Sponza
captures carry no normal maps**: the scene loader keeps geometry only ("geometry only (no textures), flat colours",
`src/realtime/scenes.ts` attribution; every material's maps are dropped in `src/realtime/assets.ts`). I checked it on the
data: a capture of `bistro-orbit` with the interpolated vertex normal written as `normal_geom` (a capture-page flag, built
for this test and reverted: [normal-geom-capture.patch](data/svgf-followups/normal-geom-capture.patch); poses verified,
depth / viewz / motion byte-identical to the original capture) has cos(normal, normal_geom) > 0.9999 at every pixel of every
frame. So the 13 % of same-surface neighbour pairs that differ by > 18° on Bistro (T6 §3) are **geometric**: dense
tessellation and vertex normals interpolated across sub-pixel triangles. The "geometric normal as the test's input"
candidate is therefore already what the test reads on these captures; it can only be measured on normal-mapped content
(§3.4).

### 3.2 Candidate: `normalTest: 'soft'` (our design)

Where today's test resets the pixel (no 2×2 footprint tap and no 3×3 fallback texel passes cos 0.95), retry the 2×2
footprint at a looser threshold (`normalSoftThreshold`, default 0.5) and keep the taps that pass it as a **short**
history: n ≤ 1 + (`normalSoftHistory` − 1) × s, s = the bilinear-weighted mean over those taps of
clamp((n·n_q − 0.5) / (0.95 − 0.5), 0, 1). History shaded at a nearby normal counts for up to a few frames, one shaded far
away counts for almost nothing (s → 0 = today's reset). It runs only on pixels the full test resets (≈ 1.7 % of Bistro's
pixels per frame, T6 §3: 8 666 resets / frame), and `normalSoftHistory` is **per signal**: 1 keeps that signal's reset
exactly (n = 1 takes this frame's sample and moments), so in the joint pipeline specular keeps today's behaviour while
diffuse uses the soft history.

Sweep on `bistro-orbit` (T6 score, pooled PSNR / boil; first round with one setting for both signals):

| arm | diffuse | specular (SSR, not demodulated) | AO |
|---|---|---|---|
| shipped | 31.35 / 0.0078 | 46.69 / 0.0011 | 26.20 / 0.0103 |
| tol 0.5, 2 frames | 31.61 / 0.0069 | 46.63 / 0.0010 | **26.48** / 0.0086 |
| tol 0.5, 4 frames | **31.68** / 0.0064 | 46.49 / 0.0010 | 26.40 / 0.0080 |
| tol 0.5, 8 frames | 31.68 / **0.0062** | 46.38 / 0.0010 | 26.20 / **0.0077** |
| tol 0.8, 4 frames | 31.55 / 0.0069 | 46.58 / 0.0010 | 26.38 / 0.0087 |
| T6 `normalTest: 'relative'` (for comparison) | +0.04 dB pooled over 9 | −1.13 dB | **−1.59 dB** |

Specular loses with any soft history (−0.06 … −0.31 dB): for a reflection the history at another normal is wrong, as T6
found. Diffuse and AO gain: unlike `'relative'` (full-length history at another normal), a 2–4-frame history only takes
the noise out of the restart and smears nothing for long. Chosen: **tol 0.5, diffuse / AO 3 frames, specular 1**.

### 3.3 Rule-9 A/B: `normalTest: 'soft'`, `normalSoftThreshold: 0.5`, `normalSoftHistory` 3 (diffuse, AO, SO) / 1 (specular)

**Real scenes, 11 captures** (T6 score; boil = reference-smooth boil, its floor the reference's own boil;
[raw/real/](data/svgf-followups/raw/real/), table [scenes.mjs](data/svgf-followups/scenes.mjs)):

| signal | Δ pooled | worst capture | Δ boundary / boundary-young | Δ FLIP | Δ boil | Δ boundary boil |
|---|---|---|---|---|---|---|
| diffuse | **+0.150** | −0.017 (`three-orbit`, `three-knot-orbit`) | +0.148 / +0.153 | −0.2 % | **−8.7 %** | −9.8 % |
| specular | ±0 (byte-identical) | ±0 | ±0 | ±0 | ±0 | ±0 |
| AO | **+0.183** | ±0 (static-camera captures) | +0.214 / +0.174 | −0.1 % | **−11.0 %** | −11.9 % |

Per capture (diffuse / AO): `bistro-orbit` +0.31 / +0.26 dB, boil −15 % / −21 % (AO 0.0103 → 0.0082, i.e. 2.6× → 2.1× the
reference's); `bistro-pan` +0.30 / +0.24, −11 % / −15 %; `sponza-orbit` +0.16 / +0.19, −6 % / −10 %; `sponza-pan` +0.15 /
+0.17; `three-orbit` −0.02 / +0.23, boil −18 % / −14 %; `three-pan` +0.10 / +0.20; the static-camera captures
(`bistro-move`, `sponza-move`, `three-knot-static`, `three-knot-still`) are unchanged (no camera, no resets). No capture's
boil rises in any region.

**Motion-compensated boil** ([t1-score](data/t1-score.mjs), diffuse; std540 × 7, std1080-orbit, `three-knot-orbit`,
`three-knot-still`; [raw](data/svgf-followups/raw/real/)): the test-bed captures are unchanged to every printed digit
(PSNR, young PSNR, FLIP, boil in every region: smooth geometry, the full test rarely resets a surface pixel there); `three-knot-orbit` −0.017 dB, young −0.13 dB, boil all / young /
settled −23 % / −16 % / −25 %; pooled over the 10: −0.001 dB.

**Test bed, live 1080p, 7 paths** ([raw/live/live-n](data/svgf-followups/raw/live/live-n/), table
[t6-boundaries/ab.mjs](data/t6-boundaries/ab.mjs)):

| signal | Δ pooled | worst path | Δ boundary / boundary-young / disoccluded | Δ FLIP | Δ flicker (all / boundary / static / dynamic) |
|---|---|---|---|---|---|
| diffuse | −0.000 | −0.001 (`object`) | −0.000 / −0.001 / −0.001 | ±0.0 % | ±0.0 % |
| specular | ±0 | ±0 | ±0 | ±0 | ±0 |
| AO | −0.001 | −0.002 (`object`) | −0.000 / −0.004 / −0.007 | ±0.0 % | ±0.0 % |
| SO | −0.003 | −0.017 (`object`) | −0.012 / −0.008 / −0.005 | ±0.0 % | ±0.0 / +0.2 / ±0.0 / +0.2 % |

**4096-spp references** (orbit / light / glossy, 960×540): diffuse, specular and AO all ±0.000 dB, FLIP ±0.0 %
([raw/live/live4k-n](data/svgf-followups/raw/live/live4k-n/)). **Normal-mapped detail build** (`dt-bumpy` / `dt-grooves` /
`dt-fine`, 4096 spp): diffuse +0.054 dB (worst `dt-grooves` −0.010; boundary-young −0.12), specular ±0, AO +0.204 (§3.4 table;
[raw/live/live-dt](data/svgf-followups/raw/live/live-dt/)).

(A first live run is kept as `live-dt-wrong`: the test bed creates one registry instance per signal, so the per-signal
`d.` / `s.` settings did not reach it and both signals ran 4 frames; fixed in the registry, see LESSONS.)

**Verdict.** PSNR level or better everywhere (worst −0.017 dB, SO on `object`), FLIP level or better, boil and flicker
level or lower in every region of every capture, cost ±0 (§5): **passes rule 9**.

### 3.4 The geometric normal as the test's input (`historyNormal: 'geometric'`)

Built as an option (the renderer's geometric normal `guides.geometricNormal`, octahedral 16 + 16 bits, ping-ponged, drives
the normal agreement, backface and plane tests; the edge-stopping weights keep `guides.normal`; +8 B/px, one 0.02 ms pass at
960×540). Not measurable on Bistro / Sponza (§3.1). On the test bed's normal-mapped detail build (`dt-bumpy`, `dt-grooves`,
`dt-fine`: T5's slow orbit over a normal-mapped floor and wall, 960×540, 4096-spp references):

| signal | `historyNormal: 'geometric'` Δ pooled (worst) | Δ boundary-young | Δ FLIP | `normalTest: 'soft'` Δ pooled (worst) |
|---|---|---|---|---|
| diffuse | −0.076 (**dt-grooves −0.98**) | −0.23 | +1.3 % | +0.054 (dt-grooves −0.010) |
| specular | **−0.191** (dt-fine −0.28) | −0.71 | +1.8 % | ±0 (byte-identical) |
| AO | +0.398 (dt-bumpy −0.02) | +1.40 | −0.5 % | +0.204 (±0) |

Accepting history shaded at another detail normal smears the detail for the signals that depend on it (diffuse,
specular), as T6's `'relative'` did on Bistro; the same geometric test helps AO (whose reference here barely depends on the
detail normal). It is one shared geometry test for the joint pipeline, so it can't be split by signal. **Fails rule 9**
(specular −0.19 dB, diffuse −0.98 on one path); kept as a documented option (default 'normal').


## 4. Byte identity of the default path

- **Generated WGSL**: 224 pass variants (temporal for 4 signal sets incl. the `historyFallback`, `normalTest: 'relative'`
  and reflection variants; à-trous at every stride × young / feedback / box / 5×5 variants; variance incl. the tiled,
  young-flag and history-weight forms; all v2 gradient passes incl. chroma and gain) generated by HEAD and by this work:
  **0 differ** ([wgsl-dump.ts](data/svgf-followups/tools/wgsl-dump.ts)). Every new option compiles in only when on.
- **Replays**, HEAD snapshot vs the final code (both served frozen): `std540-object`, `std540-thin`, `bistro-orbit` ×
  `svgf-auto`, `svgf`, `occlusion-svgf-auto`: **0 of 432 output files differ**. Earlier code states: lc540-step / -jump /
  -hue × `svgf-auto`, 0 of 576 differ.
- `normalSoftHistory: 1` for a signal is that signal's exact reset: the specular outputs of every soft arm on 11 real
  captures and on the live pages are byte-identical / ±0 to the shipped default's.
- Registry: `d.<key>` / `s.<key>` per-signal SVGF settings (new); without them the options object is unchanged.

## 5. Cost and memory

`normalTest: 'soft'` adds work only where the full test resets a pixel (a second 2×2 footprint test and 4 normal reads).
Replays of `bistro-orbit` / `sponza-orbit` at 960×540 with a 50 ms warm-up, 4 alternating rounds, GPU lock held, no
other headless job, no video wake lock: joint diffuse + specular 1.302 → 1.297 ms (Bistro), 1.234 → 1.236 (Sponza); AO +
SO 0.952 → 0.949, 0.869 → 0.874 (medians of the run medians; [raw/cost](data/svgf-followups/raw/cost/)). Within ±0.6 %,
i.e. ±0; on the test bed (no resets on its smooth geometry) the soft branch never runs. No memory.
`historyNormal: 'geometric'`: +8 B/px (two r32uint), a 0.02 ms pack pass at 960×540, one more u32 load per tested tap.
`antiLagHistoryScale`: one expression, free.

## 6. Proposals

| item | what | evidence | to |
|---|---|---|---|
| SVGF default `normalTest: 'soft'` (its own defaults are the measured configuration: `normalSoftThreshold` 0.5, `normalSoftHistory` 3 for diffuse-kind signals = diffuse and AO, 1 = today's reset for specular-kind = specular and SO; checked: `normalTest=soft` alone gives byte-identical outputs to the explicit settings on `bistro-orbit`). SO was A/B'd at 3 (level, −0.003 dB) and ships at 1 (identical to today) to stay conservative | flip of options that pass every rule-9 clause; changes the look of moving views over dense geometry (less boil, same detail) | §3.3 | **Dennis** (look change), via the orchestrator |
| q26 (`antiLagChroma`): its one exception is the shipped default's own per-stratum leak, not fixable at 1 spp without slowing the reaction | evidence for the decision | §2.2–2.3 | orchestrator → Dennis (q26) |
| nothing for `antiLagHistoryScale`, `antiLagRadius`, `gradientIterations`, `historyNormal` | trade-offs / fail | §2.3, §3.4 | — |

If the flip is approved, the code change is one default in `resolveOptions` (`normalTest: 'soft'`; `OcclusionDenoiser`
inherits it), plus SPEC §3.2 / §4.2 / §12 and the README.

## Reproduce

```sh
S=<scratch>; R=/Users/dex/Developer/Denoiser-nrd-cleanroom
# light-change captures (7 s each) and replays on a frozen copy of the package (RT_REALTIME_SRC, port 5221)
BASE=http://127.0.0.1:5227/ node examples/realtime-denoiser/run-headless.mjs "mode=capture&name=lc540-step&path=lc-step&start=0&frames=96&w=960&h=540&signal=diffuse,specular&refspp=256"
BASE=http://127.0.0.1:5221/ node examples/realtime-denoiser/run-headless.mjs "mode=replay&capture=lc540-step&denoiser=svgf-auto&output=fu-hs&warm=0&signals=diffuse,specular&antiLagHistoryScale=1"
node docs/research/rt-denoiser/results/data/t3-score.mjs lc540-step --den fu-base,fu-hs --signals diffuse,specular --stat 0 --flip-every 8
node docs/research/rt-denoiser/results/data/svgf-followups/tools/spill.mjs lc540-step --den fu-base,fu-hs --signals diffuse,specular [--dbg <dbg-n output>]
node docs/research/rt-denoiser/results/data/svgf-followups/tools/spill-lam.mjs lc540-step fu-base <dbg-n output> diffuse
#   (dbg-n / dbg-a: tools/registry-wrap-dbg.ts aliased over tools/rt-capture/src/denoisers in a scratch Vite config)
# real scenes: replay + T6 score + table
BASE=http://127.0.0.1:5221/ node examples/realtime-denoiser/run-headless.mjs "mode=replay&capture=bistro-orbit&denoiser=svgf-auto&output=n-svgf-d3&warm=0&signals=diffuse,specular&normalTest=soft&normalSoftThreshold=0.5&d.normalSoftHistory=3&s.normalSoftHistory=1"
BASE=http://127.0.0.1:5221/ node examples/realtime-denoiser/run-headless.mjs "mode=replay&capture=bistro-orbit&denoiser=occlusion-svgf-auto&output=n-ao-d3&warm=0&signals=ao&normalTest=soft&normalSoftThreshold=0.5&normalSoftHistory=3"
node docs/research/rt-denoiser/results/data/t6-boundaries/score.mjs bistro-orbit --denoisers n-svgf,n-svgf-d3,n-ao,n-ao-d3 --json n2-bistro-orbit.json
node docs/research/rt-denoiser/results/data/svgf-followups/scenes.mjs n2-*.json [--per-capture]
# live A/B (one page per path; the d. / s. keys work in live pages since the registry fix)
BASE=http://127.0.0.1:5222/ node examples/realtime-denoiser/run-headless.mjs --json=orbit.json "signal=diffuse,specular,ao,so&mode=eval&preset=full&flipEvery=12&denoiser=svgf-auto,svgf-auto@normalTest=soft@normalSoftThreshold=0.5@d.normalSoftHistory=3@s.normalSoftHistory=1,occlusion-svgf-auto,occlusion-svgf-auto@normalTest=soft@normalSoftThreshold=0.5@normalSoftHistory=3&path=orbit"
node docs/research/rt-denoiser/results/data/t6-boundaries/ab.mjs <dir>/*.json
# normal_geom on a three-temporal capture: git apply results/data/svgf-followups/normal-geom-capture.patch, then
node examples/three-temporal/run-realtime.mjs capture --port=<p> --set=bistro-orbit --windows=ng-bistro-orbit:0:48 --refShadow=16 --refDiffuse=1 --refSpec=1 --query=normalGeom=1 --no-validate
```
