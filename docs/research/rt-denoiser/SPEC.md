# SPEC v0.4: our real-time denoisers (`denoiser/realtime`)

_v0.4, 2026-10-25 (late night), spec author (RULES.md rule 8: may not see NRD code; writes our
design). Status: **reviewed** for the §12 decisions (Dennis, 2026-10-25, every item as
recommended); the algorithms stay provisional until scored on more scenes (§12 item 7)._

**Changelog**
- **v0.3 → v0.4 (2026-10-25, late night):** Dennis decided every §12 item as recommended.
  §12 marks each one; §0.1 / §0.3 are the short form. Applied in code: SVGF `antiLag: 'auto'`
  default (M7 agent), shadows `uniformSnap: 'change'` default and `antiLag` → `antiLagGain` (M8
  agent), `OcclusionDenoiser` default `'svgf'`, `DiffuseSpecularDenoiser({ filter: 'recurrent' })`
  = recurrent for both signals, recurrent `antiLag` → `historyAntiLag` (both renames keep the old
  name as a deprecated alias that warns once per instance). §0.2 / §10.3 carry the native results
  (native/results/PHASE4-5.md): same-GPU locked-clock cost ours / native 1.00–1.39× diffuse +
  specular, 1.12× shadows, 1.12–1.48× occlusion; quality ahead of native NRD at its default
  settings on every comparable signal, with an integration issue not ruled out. PLAN §8's targets as
  decided: ≤ 2× native binding, 4 ms on the M5 Pro a guide ± 10 %, ~140 B/px accepted, shadows
  ~0.75 ms. §7 gets a short v2.1 / v2.2 note (full rewrite still pending).
- **v0.2 → v0.3 (2026-10-25, late night):** two milestones specified, nothing built.
  **M7 SH/SG directional variants** (§8.5 rewritten, decisions M7-1…M7-14): an L1 payload (Y with
  4 coefficients, Co / Cg as L0, after the public Snowdrop / AC Shadows recipe) in a per-sample
  encoding of ours that is exact at the filter's normal, filtered by SVGF with unchanged weights,
  plus a resolve step (L1 with a value-preserving ringing guard, optional sharpening, and a ratio
  SG resolve for specular). **M8 translucent shadows** (new §7.10, decisions M8-1…M8-10): an RGB
  transmittance channel riding on `ShadowDenoiser` v2.2, accumulated only over samples that reach
  the light past opaque geometry, so that `v̂ · τ̂` is the mean of `v · T`; multiplicative
  (order-independent) layers per the Tomb Raider talk. §0.1 / §0.3, §7.9, §9, §10.3, §11 and §12
  (items 10–14 appended) updated. §7 still describes shadows v2; v2.1 / v2.2 are in
  results/M4.md §11–12 (TASKS has the fold-in item) and §7.10 builds on v2.2's pass list.
- **v0.1 → v0.2 (2026-10-25, night):** folds in everything measured since v0.1, each change in
  its section as a **v0.2** note (old → new → evidence): recurrent specular as built (§5.6
  rewritten: curvature-corrected virtual motion, no virtual candidate in stabilization, clamp
  always on with a confidence-widened window, roughness-centred anti-lag) and the recurrent
  budget work (§5.1, §5.4, §5.9–5.12: tap counts, recurrent-only reprojection, bilinear diffuse
  stabilization history); shadows v2 (§7: noise-radius blend, fresh-pixel 5×5 mean,
  `uniformSnap: 'change'`, the constants' rationale); occlusion as built (§8 rewritten: filters,
  radii, fast-ĥ virtual reprojection for SO, r32float per signal, no pre-blur, SVGF as an
  occlusion filter); A-SVGF anti-lag v2 (§4.6: noise floor from ΣK², per-signal k, one
  reprojection per stratum, f16 state, 4 iterations, `spatialVarianceRadius`, `antiLagVersion`).
  **Rankings now use pooled PSNR** (PSNR of the mean MSE; the per-frame mean is kept in brackets
  for continuity) and every headline number is re-quoted on it. §0 and §10 carry the latest ms and
  B/px. §0.2 states the central finding: on the test bed SVGF / A-SVGF beats the recurrent filter
  on diffuse, specular and occlusion; recurrent is the memory-lean option; the native comparison
  on test-bed captures is still pending. §12 is one review list, ordered by how much each item
  blocks, merged with TASKS "Questions for Dennis" (which now points here).
- v0 → v0.1 (2026-10-25): the text now describes what was built and measured: M1
  (SVGF / A-SVGF), M2 (recurrent diffuse), M4 (shadows). Each measured deviation sits in its
  section as a **v0.1** note: old value → new value, the number, the results doc. §7
  (shadows) is rewritten as built. §10 has measured memory and ms against PLAN §8. §12
  (review list) is rewritten; its short form is §0. Recurrent specular (§5.6) stays as
  designed because T3 is implementing it now. Occlusion (§8, M5), SH/SG (M7) and
  translucent shadows (M8) are not built.
- v0 (2026-10-24): first version, written before any code.

This is our algorithm, written from [sources/](sources/) and the papers they cite. Every
pass and constant is traced in [PROVENANCE.md](PROVENANCE.md). Rules that shaped it:

- **RTG II ch. 49 listings are not used.** `sources/reblur.md` transcribes several formulas
  from the chapter's numbered listings (49-2, 49-4, 49-7, 49-8, 49-9). Because those
  listings may mirror NRD code, this spec designs its own functions from the chapter's
  **prose** properties instead, and says so at each place. Formulas from public talk slides
  (GTC 2020, Metro 2019) are used where cited.
- Names: no ReBLUR / ReLAX / SIGMA / NRD in our API or pass names (rule 6). Our two filter
  families are called **`svgf`** and **`recurrent`**.
- Priorities: performance > quality > fidelity to NRD (PLAN §1).

How to read: `D1`…`D16` are the decisions for the 16 open items in
[sources/reblur.md §7](sources/reblur.md) (same numbering). `C-`, `F-`, `S-`, `R-`, `SH-`,
`O-` number our other decisions (core, front end, SVGF, recurrent, shadows, occlusion);
`M7-` and `M8-` the v0.3 decisions for directional payloads and translucent shadows (note: the
shadows' `SH-` prefix predates M7 and means "shadow", not spherical harmonics).
**"Tune: [a, b]"** marks a guess with the range to sweep on captures; the first value is
the default. Everything in "our design" is ours to change.

Evidence keys for v0.1 / v0.2 notes: **M1** = [results/M1.md](results/M1.md), **M2-M3** =
[results/M2-M3.md](results/M2-M3.md), **M4** = [results/M4.md](results/M4.md), **M5** =
[results/M5.md](results/M5.md), **README** = `packages/denoiser-realtime/README.md`, **TASKS** =
the implementers' "Found along the way" reports. "Test bed" = `examples/realtime-denoiser` at
1920×1080, 7 stress paths, 96 frames, blue-noise sampling, 256-spp references, tonemapped
demodulated values (scalars: clamped to [0, 1]). "Dev page" = the package's synthetic scene
(direct point lights, exact truth + injected noise). All ms are Apple M5 Pro, 1080p.

**Evaluation method:** §13 (what the references are, the reference-noise ceiling, OIDN as a baseline not a reference).

**Metric (v0.2).** Denoisers are ranked on **pooled PSNR**: 10·log10(1 / mean squared error
over every frame and scored pixel) (CAPTURE-FORMAT "Metrics for replay outputs"; M1 §11, M4 §9).
The old headline, the mean of per-frame dB, let near-empty frames score up to 120 dB (shadows on
`pan`). Where both exist this spec gives "pooled (per-frame mean)". Region numbers (penumbra,
disoccluded, contact, roughness bins) were always pooled. Deltas from tuning sweeps done before
the switch (most of M1 §4, M4 §3, the T2/T3 sweeps) are per-frame means and are marked so; they
record why a value was chosen at the time. The pooled re-score changed no 7-path ranking of
filters; the one decision it flipped is shadows' uniform snap (§7.4; per path, specular `pan`
recurrent vs SVGF swapped, M1 §11).

---

## 0. For the review (read first)

### 0.1 State of each part

| part | SPEC | built | status (v0.4) |
|---|---|---|---|
| shared temporal core | §3 | yes, used by every filter | v0.1 notes (Catmull-Rom gating C-8, anti-lag window and detector C-10/C-10b); the recurrent filter uses a cheaper reprojection (§5.1) |
| SVGF / A-SVGF | §4 | yes (M1), anti-lag v2 | **the default filter for every radiance and occlusion signal, `antiLag: 'auto'` by default** (items 1–2, decided 2026-10-25) |
| recurrent diffuse | §5 | yes (M2) | opt-in, memory-lean; not the default (item 1, decided) |
| recurrent specular | §5.6 | yes (M3) | opt-in; `filter: 'recurrent'` on the joint class = recurrent for both signals (item 1, decided) |
| shadows | §7 | yes (M4, v2.2) | provisional; §7 describes v2, the v2.1 / v2.2 note at its top has the rest; `uniformSnap: 'change'` default (item 5, decided) |
| occlusion | §8 | yes (M5) | default filter `'svgf'` (item 1, decided) with `antiLag: 'off'` (item 2, decided); AO curve kept (item 6) |
| TSL nodes, real-scene pages | — | yes (M6) | outside this spec; the real scene is the second scoring scene (item 7); the pages stay local (decided) |
| SH/SG directional | §8.5 | yes (M7) | provisional (results/M7.md); payload, resolve and scope as recommended (items 10–12, decided) |
| translucent shadows | §7.10 | yes (M8) | provisional (results/M8.md); output and storage limit as recommended (items 13–14, decided) |

### 0.2 Where we stand

Test bed, 1080p, 7 paths × 96 frames, **pooled PSNR** in dB (per-frame mean in brackets
where it was reported); GPU ms on the M5 Pro at 1080p; internal memory in bytes per pixel.

**Diffuse + specular** (M1 §11–12, M2-M3 §2 and §4; quality re-run in one page and "bench" ms re-measured on one bench in [REMEASURE-2026-10-25](results/REMEASURE-2026-10-25.md) §2, package at 7782074):

| filter | diffuse PSNR | specular PSNR | joint ms | B/px |
|---|---|---|---|---|
| SVGF, `antiLag: 'off'` (package default until 2026-10-25) | 38.88 (39.00) | 33.46 (34.09) | **4.00** bench / 4.02 dev page | 132 |
| A-SVGF, `antiLag: 'auto'` (v2; **package default** since 2026-10-25) | **39.12** | **35.04** | 4.23 bench | 140 |
| recurrent, both signals in shared dispatches (= `{ filter: 'recurrent' }` since 2026-10-25) | 38.26 (38.44) | 34.10 (34.41) | **3.99** bench / 4.44 dev page (4.05 with `blurTaps: 4`, dev page) | **105.5** |
| explicit mix `{ filter: 'recurrent', specular: { filter: 'svgf', antiLag: 'auto' } }` (what `filter: 'recurrent'` meant until 2026-10-25) | 38.26 | 35.04 (= A-SVGF's, bit-identical) | 4.79 bench (anti-lag v2; v1 on the dev page: 5.98) | ≈ 138 |

**Occlusion** (M5; A-SVGF row re-measured with anti-lag **v2** in [REMEASURE-2026-10-25](results/REMEASURE-2026-10-25.md) §3, where SVGF and recurrent reproduced M5 exactly; ms = fastest frame of the solo bench, "both" = joint `dispatchBoth` on the same bench, whose medians are 2.62 / 2.89 / 3.10):

| filter | AO PSNR | SO PSNR | ms AO / SO / both | B/px AO / both |
|---|---|---|---|---|
| recurrent occlusion-only mode (`OcclusionDenoiser` default until 2026-10-25) | 38.02 | 37.37 | **1.32 / 1.32 / 2.27** | **57.5 / 73.5** |
| SVGF on ĥ, `antiLag: 'off'` (**`OcclusionDenoiser` default** since 2026-10-25, item 2) | 38.93 | 38.76 | 1.37 / 1.92 / 2.54 | 84 / 148 |
| A-SVGF `auto` on ĥ (v2; the class default for a few hours on 2026-10-25, via SVGF's default; opt-in since) | **39.03** | **39.68** | 1.67 / 1.61 / 2.75 | 88 / 156 |
| recurrent radiance output's alpha ("free" AO/SO) | 35.15 | 35.47 | 0 extra | 0 extra |

**Shadows** (M4 §10): ours (v2) **37.11** dB, penumbra **28.57**, disoccluded 34.68, FLIP
0.018, 0.48–0.59 ms, 40 B/px; FFX shadows 31.20 / 23.50 / 32.91 / 0.038, 0.50–0.61 ms. Ahead on
every path. v2.1 (M4 §11.3): 38.12 / 29.05 / 35.33 / FLIP 0.0129; v2.2 (M4 §12, the code today):
38.22, penumbra 29.16, FLIP 0.013, **0.55–0.72 ms**, 48 B/px (all with `uniformSnap: true`).
`uniformSnap` at 1080p on v2 ([REMEASURE-2026-10-25](results/REMEASURE-2026-10-25.md) §4): `true` 37.11 / 28.57 / FLIP 0.0182,
`'change'` (**default** since 2026-10-25) 37.23 / 28.75 / 0.0186, `false` 37.29 / 28.88 / 0.0198.

**Against native NRD** (NRD v4.18.0 at its **default settings**, fed our captures through its public
API; everything on one RTX 3060 Laptop GPU; [native/results/PHASE4-5.md](native/results/PHASE4-5.md)).
Pooled PSNR, mean over the 8 standard captures:

| signal | ours | native |
|---|---|---|
| diffuse | `svgf-auto` 37.80, `svgf` 37.69, `recurrent` 36.57 | RELAX 34.68, REBLUR 33.63 |
| specular | `svgf-auto` 34.24, `svgf` 33.58, `recurrent` 32.78 | RELAX 29.73, REBLUR 29.69 |
| shadows (penumbra) | `shadows` 35.62 (26.69) | SIGMA 22.04 (12.51); plain `accumulate` 23.67 (15.50) |

The real-scene captures (`three-orbit` / `three-pan`) rank the same way (diffuse ours 39.8–40.4 vs
RELAX 37.6 / 38.7; shadows 30.9 / 31.1 vs SIGMA 24.9 / 25.8). AO is not comparable yet (native
normalizes on its own curve, P3). **Caveat:** SIGMA scoring below plain accumulation points to an
input-convention problem in the harness rather than a real quality gap; light size, jitter units and
the specular hit-distance / roughness conventions (P2) were probed without closing any gap, but a
native integration issue is not ruled out. Cost, same GPU, clocks locked at 1200 / 7001 MHz,
`std1080-orbit`: diffuse + specular `svgf` 5.35 ms, `recurrent` 5.48, `svgf-auto` 6.09, the explicit
mix 7.47 vs REBLUR 5.38 (RELAX 7.24): **1.00–1.39×**; shadows 1.07 vs SIGMA 0.96: **1.12×**; AO + SO
`occlusion-recurrent` 3.76, `-svgf` 4.15, `-svgf-auto` 4.95 vs REBLUR occlusion 3.36: **1.12–1.48×**.

**Against PLAN §8:**

Targets as decided 2026-10-25 (§12 items 3–4 and the shadows target):

| target | measured | status |
|---|---|---|
| **≤ 2× native on the same GPU** (binding) | locked clocks: diffuse + specular 1.00–1.39× REBLUR, shadows 1.12× SIGMA, AO + SO 1.12–1.48× REBLUR occlusion | **met** by every configuration |
| diffuse + specular: 4 ms on the M5 Pro at 1080p, a guide ± 10 % | test-bed bench: A-SVGF auto v2 (default) 4.23, SVGF `'off'` 4.00, recurrent 3.99, explicit mix 4.79 (recurrent on the dev page: 4.44, 4.05 with `blurTaps: 4`) | default within the guide; the mix 20 % over |
| shadows ~0.75 ms (was ≤ 0.6) | v2.2: 0.55–0.72 (`thin` 0.72) | met |
| memory: ~140 B/px accepted for the SVGF default (was ≤ 100) | A-SVGF 140, SVGF 132, recurrent 105.5 (93.5 with half-res fast history, not built) | met; recurrent is the lean option |
| quality within ~0.5 dB of native | ours ahead of native NRD at its defaults on every comparable signal (diffuse +3.1, specular +4.5 dB std set) | met, with the integration caveat above |

**The central finding, plainly.** On our test bed SVGF / A-SVGF beats the recurrent filter on
every signal: diffuse (A-SVGF auto 39.12 vs recurrent 38.26 dB; recurrent loses all 7 paths to
A-SVGF auto, `glossy` by 0.01 dB, and 6 of 7 to plain SVGF), specular (35.04 vs 34.10; recurrent
wins only `glossy`, +0.17 dB) and occlusion (SVGF wins every path for both signals: AO +0.91,
SO +1.39 dB). Recurrent is the leaner option (105.5 vs 132–140 B/px for diffuse + specular, 57.5
vs 84 for AO) and flickers least on static views, but it is not faster for diffuse + specular
(3.99 vs 4.00–4.23 ms on the test-bed bench; 4.44 on the dev page). The gap looks structural, not a tuning gap: about 20 knobs moved
recurrent specular and the occlusion mode by ≤ ±0.2 dB (M2-M3 §5, M5 §4), and SVGF's
variance-guided luminance weight keeps beating the recurrent blur's fixed tolerances. Two things
could still change the ranking: **native NRD on the test-bed captures** (pending; the only native
comparison so far is a synthetic plane) and **a real scene** (M6, in progress; every default was
tuned on the scene it is scored on). Shadows are the clear win: 5.9 dB pooled over FFX shadows at
the same cost. **Update (v0.4):** both have now been measured. The real scene (M6) keeps the
ranking, and native NRD at its default settings scores below all of our filters on our captures
(above); Dennis decided item 1 as recommended (SVGF default, recurrent opt-in), to be re-checked if a
fixed native integration or the new scenes change the picture.

Sources: M1 §11–12, M2-M3 §2–4, M4 §10, M5 headline and §5, [REMEASURE-2026-10-25](results/REMEASURE-2026-10-25.md). Benches differ: "bench" = test-bed
solo bench (`orbit`, uncontended; REMEASURE: median over 9 runs of each run's 200-frame median,
M1: median of 100 frames); "dev page" = the package's synthetic scene (min of 400 frames); M4 and M5
report the fastest clock state. For SVGF they agree within a few % (joint 4.00 vs 4.02 ms); the
recurrent filter reads 11 % higher on the dev page (4.44 vs 3.99), so compare filters on one bench.

### 0.3 Decided (short; options and evidence in §12)

**Dennis decided every item as recommended on 2026-10-25** (decisions page q01–q17; TASKS
"Questions for Dennis" points here). Nothing is open for review; re-checks are noted.

1. **Default filter per signal** (q01): SVGF for diffuse, specular and occlusion; recurrent is the
   opt-in, memory-lean filter; `DiffuseSpecularDenoiser({ filter: 'recurrent' })` = recurrent for
   both signals (the hybrid stays reachable explicitly). Re-check if a fixed native integration
   changes the ranking.
2. **SVGF `antiLag` default** (q02): `'auto'` (v2). `OcclusionDenoiser`'s SVGF defaults to `'off'` (§12 item 2).
3. **Cost target** (q03): ≤ 2× native on the same GPU is binding (met: 1.00–1.48×); 4 ms on the
   M5 Pro is a guide ± 10 %.
4. **Memory** (q04): ~140 B/px accepted for the SVGF default; recurrent is the ≤ 100 B/px option.
5. **Shadows uniform snap** (q06): `'change'` by default, still a setting. Shadows cost target
   ~0.75 ms (q05).
6. **AO curve** (q07): keep the rational curve; choose the AO scale `a` after the real scenes and
   P3, whose data is now in [native/results/PHASE4-5.md](native/results/PHASE4-5.md).
7. **Scenes** (q08): the test bed plus the three.js real scene; Bistro / Sponza are coming.
8. **API** (q11): as is (`remodulate` + caller factor, `dispatchBoth`, the occlusion API,
   `'gradient'` experimental, shadows standalone); the overloaded `antiLag` booleans / numbers are
   renamed (q10): recurrent `historyAntiLag`, shadows `antiLagGain`, old names deprecated aliases.
9. **Listing policy:** keep, by caution (decided earlier, RULES §2).
10. **M7 colour payload** (q12): YCoCg with chroma as L0 by default, `'sh-rgb'` opt-in.
11. **M7 resolve location** (q13): diffuse returns the SH, specular resolves in the last pass; both
    modes on both signals.
12. **M7 scope** (q14): SVGF only.
13. **M8 output** (q15): one rgba16float `(v̂·τ̂ rgb, v̂)`.
14. **M8 storage limit** (q16): the adapter's extra storage texture when offered, a packed history
    otherwise.

Also decided: the realtime example pages stay local (`deployed: false`, q09); the captures are kept
(q17).

---

## 1. Conventions and inputs

### 1.1 Spaces (from [CAPTURE-FORMAT.md](CAPTURE-FORMAT.md) and `temporal.ts`)

| quantity | convention |
|---|---|
| world / view | three.js: right-handed, +y up, camera looks down −z; **viewZ < 0 in front** |
| linear depth (ours) | `d = −viewZ > 0`. All shader math uses `d`. Sky: `viewZ = −far` or `depth` = far plane value → pixel is **sky**: skipped by every pass, output 0 |
| pixel / uv | pixel `p = (px, py)`, x right, y down, row 0 top; `uv = (p + 0.5)/size` |
| NDC | `ndc = (2·uv.x − 1, 1 − 2·uv.y)`, +y up |
| jitter `j` | pixels, x right / y down. Sample position `uv_s = (p + 0.5 + j)/size`, `ndc_s` from it |
| motion `m` | NDC delta **current sample − previous**, so `uv_prev = uv_s + (−0.5·m.x, +0.5·m.y)` |
| motion z `mz` (optional) | `viewZprev − viewZ` (both negative in front) → `d_prev = d − mz` |
| roughness | perceptual `r`; GGX `α = r²` |
| matrices | column-major (three `Matrix4.elements`); projection `P` **unjittered** |

**C-1 Position reconstruction.** View-space position of pixel `p` with depth `d`, using
the sample NDC (jitter included, as the capture format defines `P`):

```
perspective (P[15] == 0):  Xv = ( d·(ndc_s.x + P[8]) / P[0],  d·(ndc_s.y + P[9]) / P[5],  −d )
orthographic (P[15] == 1): Xv = ( (ndc_s.x − P[12]) / P[0],  (ndc_s.y − P[13]) / P[5],  −d )
```

Camera-relative world position `X = Rc · Xv`, with `Rc` the upper 3×3 of `inverse(view)`
(world-space offsets from the camera; world `X_w = X + camPos`). Host code computes
`Rc`, `Rc_prev`, `camPos`, `camPos_prev`, `Δcam = camPos − camPos_prev`, and
`R_prev` = upper 3×3 of `prevView` once per frame. The view distance is `‖X‖`.

**C-2 Depth source.** `guides.viewZ` when given (exact). Otherwise linearize `guides.depth`
with `P` (handles `reversedDepth`). Device depth and viewZ are both in the capture; the
replay passes `viewZ`.

**C-3 Previous depth.** With `guides.motionZ`: `d_prev = d − mz`. Without it (static-world
assumption, exact for camera-only motion): `d_prev = −(prevView · (X_w, 1)).z`. Objects
that move in depth without `motionZ` may fail the disocclusion test and lose history
(documented limitation, no artifact).

### 1.2 Inputs per frame

| input | where | used by |
|---|---|---|
| `guides.depth` / `guides.viewZ`, `guides.normal` (world, unit), `guides.motion`, `guides.motionZ?` | `FrameGuides` | all |
| `guides.roughness` | `FrameGuides` | specular; diffuse treats r = 1 |
| `guides.albedo`, demodulation factor | `FrameGuides.albedo`; per-signal `inputs.demodulation` texture | only for remodulated output (`remodulate: true`) |
| radiance (rgb), `hitDistance` | `DiffuseInputs`, `SpecularInputs` (`DiffuseSpecularInputs` for both) | diffuse / specular |
| `visibility`, `hitDistance` (occluder distance), light | `ShadowInputs` (+ `light`, built) | shadows |
| camera | `FrameCamera` (current + previous view, unjittered projection, jitter, near/far, position) | all |
| reset | `resetHistory()` or capture `frame.reset` | all |

**v0.1: API as built** (v0 proposed `FrameGuides.f0?`, `inputDemodulated` and
`output: 'demodulated' | 'remodulated'`):
- Inputs are always demodulated (captures are). No in-denoiser demodulation, so no `f0`.
- `remodulate: boolean` (default `false`). When true, the last pass multiplies by
  `inputs.demodulation` (the factor the caller divided by; diffuse falls back to
  `guides.albedo`). The caller owns E(f0, r, NoV), so the denoiser needs no specular term.
  `remodulate: true` without a factor texture is an explicit error. (TASKS, svgf deviation 7.)
- `ShadowInputs.light?: ShadowLight` (`{ type: 'sphere', position, radius } | { type:
  'directional', direction, angularRadius }`, the capture's `lights` fields), additive in
  `denoiser-core` (faade1e).
- Diffuse + specular: `DiffuseSpecularDenoiser.dispatchBoth()` returns `{ diffuse, specular }`;
  `dispatch()` returns diffuse so the class still conforms to `TemporalDenoiser`.
- `FrameGuides.viewZ?` and `FrameGuides.motionZ?` (2.5D) are additive too.

**C-4 Hit distance input.** World units, primary segment excluded. `0` means **miss**
(ray escaped) and is treated as `h = ∞`. The capture format also uses 0 for "lobe not
sampled"; v0 assumes every pixel traces both lobes (our test bed does), so 0 is always a
miss. If probabilistic lobe selection is ever used, "not sampled" needs its own value
(proposed: negative), and the pre-blur fills those pixels from neighbours.
**v0.1:** diffuse `hitDistance` is optional in `recurrent`. Without it ĥ = 1 everywhere, so
the contact clamp (D1b, R-5) and the AO output are off. `svgf` ignores hit distance.

### 1.3 Internal guide texture `G` (both families)

**C-5.** A `prepare` pass packs the current guides once into `G` (`rg32uint`, 8 B/px), the
same layout every later pass reads (one load per tap instead of three textures in caller
formats). `G_prev` is last frame's `G` (ping-pong, 2 × 8 B).

```
G.x = bitcast<u32>(d)            // f32 linear depth; 0 = sky
G.y = oct normal (2 × 12 bits, signed octahedral) | roughness (8 bits, unorm of perceptual r)
```

Octahedral encoding: Cigolle et al., "A Survey of Efficient Representations for Independent
Unit Vectors", JCGT 3(2), 2014. 12 bits per component is well under 0.1° error.

**v0.1:** the prepass also writes a **depth-slope** texture (`r32uint`, 2 × f16, current
frame only, 4 B/px): per axis, the one-sided depth difference with the smaller magnitude.
SVGF's depth weight (S-3) reads it at the centre instead of 4 neighbour loads per pass. A
pipeline with no SVGF signal skips it: prepass 0.18 → 0.10 ms (commit 25c80aa). Shadows
pack their own `G` pair inside their temporal pass (§7) instead of sharing this prepass.
**v0.2:** shadows have no roughness, so their `G` carries the accumulated noise estimate E in
the 8-bit roughness slot (§7.5); its previous value comes with the reprojection taps.

---

## 2. Front end (signal preparation)

Runs per tap wherever a pass reads a raw input (pre-blur in `recurrent`, temporal
accumulation in `svgf`), so it costs no dispatch.

**F-1 Sanitize.** Non-finite → 0. Negative → 0. Clamp each channel to `maxRadiance`
(default 1e4 in demodulated units, leaving fp16 headroom for sums). Tune: [1e3, 6e4]. This is a safety
clamp, not the firefly filter (D9).

**F-2 Demodulation** (only when `inputDemodulated = false`; captures arrive demodulated).
**v0.1: not built.** Inputs must arrive demodulated and remodulation multiplies by the
caller's factor texture (§1.2). The definitions below stay as the reference for what a
caller should divide by:

- Diffuse: `c_d = L_d / max(ρ, 1e-3)` per channel (SVGF §3 "Reconstruction"; floor from
  Zimmer 2015 §3).
- Specular: `c_s = L_s / max(E, 1e-3)` per channel, with `E(f0, r, NdotV)` = the split-sum
  term (Karis 2013 Eq. 7–8) in Karis 2014's analytic mobile approximation, f90 = 1, exactly
  as written in CAPTURE-FORMAT §"Specular demodulation term" (`NdotV = clamp(n·v, 1e-4, 1)`,
  `v = normalize(−X)`). Chosen because it is public, LUT-free (one less texture and
  binding) and is the term our captures already use.
- Remodulation (when `output = 'remodulated'`) multiplies by the same `ρ` / `E`, fused into
  the last pass.

**F-3 Hit-distance normalization (D5a).** Our curve. The stored, filtered quantity is

```
ĥ = h / (h + h_scale(d)),      h_scale(d) = a + b·d,      miss (h = ∞) → ĥ = 1
h = h_scale(d) · ĥ / (1 − ĥ)   (inverse, ĥ clamped to ≤ 0.999)
```

with `a = hitDistanceScale` (default **1.0** world unit; tune: [0.25, 5]) and
`b = hitDistanceViewScale` (default **0.05**; tune: [0, 0.2]). Rationale:

- Rational instead of `saturate(h/h_max)` (GTC20 s.9): it never clips, so far reflection
  distances survive for virtual motion (mirrors need them), fp16 resolves ratios up to
  ~2000·h_scale, and `ĥ` stays in [0,1] for linear filtering.
- `ĥ` doubles as occlusion: its denoised mean is an AO/SO value with a `1/(1 + h/h_scale)`
  distance falloff (GTC20 s.9 "normalized hit distance = AO/SO"; the falloff shape is ours).
  At `h = h_scale`, `ĥ = 0.5`.
- `b·d` keeps the scale proportional to the screen footprint at distance (a 1-unit scale
  is meaningless 200 units away). Roughness does not enter (the rational curve removes the
  precision reason NRD-style curves would need it for).
- Same curve for diffuse and specular, so one `h_scale` per pixel.

Denormalizing a **filtered** `ĥ` gives a hit distance biased toward near hits (a harmonic
-like mean). That is the conservative direction for radius and contact hardening.

**F-4 Firefly handling.** Three layers, none of which removes energy in the main path
(RTG2 §49.5.1: redistribute, don't suppress):
1. F-1 safety clamp.
2. Pre-blur redistributes outliers over its kernel (recurrent) / à-trous does (svgf).
3. Rank-based anti-firefly on the accumulated signal in the history-fix pass (D9).

---

## 3. Shared temporal core

Used by both families. One WGSL module (`temporal-core.wgsl`) with these functions.

### 3.1 Reprojection (C-6)

Per pixel with `d > 0`:
1. `uv_prev = uv_s + (−0.5·m.x, +0.5·m.y)`; `d_prev` from C-3.
2. `Xp = Xv_prev(uv_prev, d_prev)` with `prevProjection` (C-1 formulas): the current surface
   point in **previous view space**. All disocclusion math happens in this one frame
   (resolves D6b: no mixing of camera-relative frames).
3. Normal in previous view space: `np = R_prev · n`.
4. Off-screen (`uv_prev` outside [0,1]²) → every tap invalid.

### 3.2 Per-tap plane-distance test (C-7, D6)

For a previous-frame texel `t` (decoded from `G_prev`: `d_t`, `n_t`):

```
P_t   = Xv_prev(uv(t), d_t)                      // texel centre, prevProjection
n̄     = normalize(np + R_prev · n_t)             // pairwise-averaged normal (RTG2 p.831 prose)
δ_t   = |dot(P_t − Xp, n̄)| / ‖Xp‖
valid = inside(t) ∧ d_t > 0 ∧ dot(n, n_t) > 0 ∧ δ_t < τ ∧ [svgf only: dot(n, n_t) > cosN]
```

- `τ = disocclusionThreshold`, default **0.01** (1 %), tune: [0.005, 0.015] (RTG2 p.831
  "around 0.5–1.5 %").
- `dot(n, n_t) > 0` rejects backfacing taps (RTG2 p.832).
- Plane distance (not a depth ratio) keeps grazing surfaces valid: neighbours on a tilted
  plane lie on the plane (RTG2 §49.6; Metro s.59).
- Previous texels are reconstructed at their **centres** (previous jitter is unknown to the
  texel). The sub-pixel error is far below τ at any normal angle the plane test accepts;
  revisit if captures with large jitter show false rejections.
- `svgf` adds the paper's normal test, `cosN = 0.95` (A-SVGF code `TemporalAccumulation.frag`),
  tune: [0.8, 0.98]. `recurrent` doesn't (RTG2 uses plane distance + backfacing only).

### 3.3 History fetch (C-8)

Bilinear footprint: `f = uv_prev·size − 0.5`, `t0 = floor(f)`, `w = f − t0`; taps
`t0 + {(0,0),(1,0),(0,1),(1,1)}` with bilinear weights `b_i`.

- **Custom-weighted bilinear** (GTC20 s.27–30, RTG2 p.832): `H = Σ b_i v_i H_i / Σ b_i v_i`,
  `v_i ∈ {0,1}` from C-7. History exists if **any** `v_i = 1` (RTG2 §49.7). Guard: use
  `max(b_i, 1e-3)` so a valid tap with a tiny bilinear weight still counts.
- **Catmull-Rom** (RTG2 §49.7) when **all 16** texels of the 4×4 footprint (`t0 − 1 … t0 + 2`)
  are valid (D6c: we run the plane test on all 16; their `G_prev` values come from 16
  `textureLoad`s or 8 `textureGather`s, 2 components each). Evaluate with the 9-tap
  bilinear decomposition (Sigg & Hadwiger, *GPU Gems 2* ch. 20) on a linear sampler (history
  textures are `rgba16float`, filterable). Then clamp per channel to [min, max] of the 4
  inner texels and to ≥ 0 (no ringing, no negatives; our addition).
- Per-signal option `catmullRom`: `recurrent` **on** (RTG2), `svgf` **off** (paper uses
  bilinear; its history is already the smooth à-trous output).
- Scalar per-pixel history (A, moments) always uses the custom-weighted bilinear.

**v0.1 (all three filters): Catmull-Rom is gated on the 4 inner taps, not 16.** When all 4
taps of the bilinear footprint pass C-7, evaluate the 5-fetch Catmull-Rom (bilinear taps,
Jimenez 2016) and clamp it per channel to the 4 taps' [min, max]. The clamp removes the
ringing an invalid outer ring could cause, so the 16 plane tests buy nothing measurable for
their cost. Measured use of the option: `svgf` off (`historyFilter: 'catmull-rom'`: +0.03 …
+0.07 dB, slightly more flicker); `recurrent` on, in temporal and stabilization; shadows on
(+0.65 dB on `orbit`, M4 §3: repeated bilinear resampling blurs sharp penumbrae). Recurrent
specular's virtual history stays bilinear (Catmull-Rom +0.04 dB for 0.13 ms, commit 25c80aa).
Sources: TASKS (svgf 3, recurrent 8), M4 §7.2.
**v0.2:** recurrent stabilization uses Catmull-Rom for specular only; diffuse and the occlusion
kinds read their stabilization history bilinearly (identical PSNR, −0.08 ms; §5.11). The
occlusion kinds' r32float histories are unfilterable, so their temporal Catmull-Rom takes 16
`textureLoad`s (§8.2). The recurrent filter also uses a cheaper C-6/C-7 (current normal only,
no pairwise average; §5.1 v0.2).

### 3.4 History length A (C-9, D14)

`A` = frames accumulated in the output **minus one** (0 = current frame only).

```
A_hist = valid ? min(A_prev_reprojected, A_cap) : −1
A      = A_hist + 1                     // 0 after a disocclusion
out    = lerp(H, C, 1/(1 + A))          // RTG2 Eq. 49.1; exact running mean (GTC20 s.26)
```

- `A_cap = maxAccumulatedFrames`, default **31** (so `1/(1+A)` ≥ 1/32), tune: [15, 63]
  (RTG2 Fig. 49-3: up to 64; GTC20: up to 32).
- Fractional A is allowed (anti-lag reduces it, A-SVGF sets `A = 1/α − 1`).
- Storage: `recurrent` packs A into the `data` texture (§5.12); `svgf` stores it in the
  history colour's alpha (A-SVGF code layout). fp16 represents every integer ≤ 2048 exactly.
- A ↔ α conversions in f32; `α = 1/(1 + max(A, 0))`.

### 3.5 Anti-lag without renderer help (C-10, D11) — our design

Lighting changes that motion vectors don't see (moving lights, moving shadows, toggles).
A-SVGF's gradients need the renderer's cooperation (§4.6); this one doesn't. It is the
"clamp toward a faster history" idea (RTG2 p.830; RTG2 p.824 for ReLAX) made concrete:

- A **fast history** per signal, accumulated in the same reprojection step with a short cap
  `A_fast` (default **3** → α ≥ 1/4; tune: [2, 7]). To fit the storage budget it keeps
  **luminance and ĥ only** (4 scalars for diffuse + specular, one `rgba16float`):
  `F = (lum_d, ĥ_d, lum_s, ĥ_s)`.
- In the history-fix pass (after accumulation), per signal, with `L_s` = luminance of the
  slow (accumulated) value, and `μ_f`, `σ_f` = mean and std of fast luminance over the 3×3
  neighbourhood (geometry-valid neighbours only, same plane test as the blur's w_geom):

```
lo = μ_f − γ·σ_f,  hi = μ_f + γ·σ_f                  γ = antiLagSigma, default 2.0, tune [1, 3]
L_c  = clamp(L_s, lo, hi)
C_s ← C_s · (L_c / max(L_s, 1e-6))                     // luminance clamp, keeps chroma
e    = |L_s − L_c| / (max(L_s, L_c) + ε_L)             // relative excess, ε_L = 1e-3
c_I  = saturate(1 − e / e_max)                         e_max = 0.5, tune [0.2, 1]
```

  The same for `ĥ` (no relative division, ĥ is already in [0,1]):
  `e_h = |ĥ_s − clamp(ĥ_s, μ_h ± γ·σ_h)|`, `c_H = saturate(1 − e_h / 0.2)` (tune [0.1, 0.4]).
- **Combine (D11d):** `c = min(c_I, c_H)` (the more alarmed detector wins).
  **Reduce A:** `A ← lerp(min(A, A_fast), A, c)`. Accumulation continues from the reduced A
  next frame (RTG2 §49.11 behaviour).
- Only where `A > A_fast` (below that, slow ≈ fast).
- Applies to both signals in `recurrent`. In `svgf` the A-SVGF gradient path is the anti-lag
  (S-7); this core anti-lag is an option there (`antiLag: 'fast'`), default off for M1.

**v0.1: what was built and why (recurrent; TASKS recurrent 1, 2, 9).**

- **Window = standard error, γ = 1** (v0: γ = 2 spreads). `lo/hi = μ_f ∓ γ·σ_f/√N`, with N =
  the number of geometry-valid pixels in the 3×3 (centre included), for luminance and ĥ.
  Why: a window of γσ around the fast EMA can only move the slow value as fast as the fast
  EMA moves, minus a γσ offset. The standard error of the 3×3 mean is the noise of μ_f
  itself. Test bed +0.37 dB mean; dev-page light switch 29.0 → 34.3 dB 12 frames after.
  `antiLagStandardError: false` restores v0.
- **C-10b current-frame detector** (new, in R2 temporal, before accumulation). The 3×3 mean
  μ of this frame's **pre-blurred** luminance and ĥ (geometry-valid pixels, N ≥ 4) is
  compared with the reprojected history `H` in standard errors `se` of that mean:

  ```
  r_I = |μ_l − lum(H)| / (3·se_l + 0.02·max(lum(H), μ_l) + 1e-4)
  r_H = |μ_h − H.ĥ|    / (3·se_h + 0.05)
  A   ← lerp(min(A, A_fast), A, saturate(2 − max(r_I, r_H)))
  ```

  It fires on the first frame of a change, where the fast history (C-10) still lags by its
  own EMA. Dev-page light switch +2–3 dB over C-10 alone; test bed ±0.03 dB (no cost on
  static content). The floor is `A_fast`, not 0: shortening to 0 cost 1.4–1.8 dB on static
  scenes (blur bleeding at A = 0). Options `antiLagCurrentSigma` (3, 0 = off),
  `antiLagCurrentHitTolerance` (0.05).
- **Neighbourhood validity** in C-10, C-10b, the anti-firefly (D9) and stabilization (R7) =
  plane distance at `τ_g(A = 0)` = 2 %, no normal test (cost).
- In `svgf` the `'fast'` option was **not built**; `antiLag: 'auto'` (S-7b, our renderer-free
  gradient) took its place.
- **v0.2:** for specular, C-10 and C-10b centre their window on `lerp(own value, 3×3 mean,
  f_r(α))` and C-10b's floor is `A_fast·f_r(α)` (§5.6); the occlusion kinds run both detectors
  on ĥ alone and C-10 clamps the slow ĥ itself (§8.2). A-SVGF's `'auto'` got its own fix (v2,
  §4.6).

### 3.6 History repair from mips (C-11)

Defined with the recurrent pipeline (§5.8a, D7); usable by `svgf` as an experiment
(default off there: the paper's spatial-variance fallback covers fresh pixels).
**v0.1:** recurrent only; not built for `svgf` (its disoccluded-pixel PSNR is already within
0.1 dB of its overall PSNR, M1 §8.7).

### 3.7 Reset (C-12)

`resetHistory()`, a capture's `reset: true`, the first frame after `configure`, and a size
change all set a uniform `historyValid = 0` for one frame. Every history read then counts
as invalid (A = 0 everywhere, fast and stabilization histories ignored). No texture clears
are needed; outputs are written in full every frame.

---

## 4. Family 1: SVGF + A-SVGF (M1)

Defined by Schied et al. 2017 (SVGF, "S1") and 2018 (A-SVGF, "S2"), the authors' BSD-3
code ("S3", `svgf/asvgf_zip/`), and the upgrade list in
[sources/ssgi-svgf-review.md](sources/ssgi-svgf-review.md). The structure is the paper's and
the ssgiDev port's; this section fixes parameters. Diffuse and specular run in the **same
dispatches** (two signals per thread).

### 4.1 Pass list

| # | pass | in | out | storage textures |
|---|---|---|---|---|
| S0 | `prepare` | guides | `G` | 1 |
| S1 | `temporal` | inputs (front end F-1/F-2), `G`, `G_prev`, `hist_prev` ×2, `moments_prev` ×2 | `accum` ×2 (rgb, A), `moments` ×2 | 4 |
| S2 | `variance` | `accum` ×2, `moments` ×2, `G` | `V` ×2 (rgb, σ) | 2 |
| S3 | `atrous` k = 0 | `V` ×2, `G` | `hist_new` ×2 (rgb, A): next frame's colour history and k = 1's input | 2 |
| S4–S7 | `atrous` k = 1…4 | ping-pong | last one writes the output (remodulated if asked) | 2 |
| (A-SVGF) G1 | `gradientProject` | `G_prev`, `G`, camera | `gradientRequests` (storage **buffer**, atomics) | 0 |
| (A-SVGF) G2 | `gradientCreate` | requests, inputs, `lum_prev` | `grad` ping (rgba32f, 1/3 res) ×2, `lum_cur` | 3 |
| (A-SVGF) G3–G7 | `gradientAtrous` ×5 | `grad` ping-pong | filtered gradient | 2 |

Totals: **8 dispatches** for diffuse + specular, **15** with A-SVGF (G1 runs between the
renderer's primary-visibility pass and its shading pass, see S-8). All ≤ 4 storage textures.

**v0.1: pass list as built** (`src/svgf.ts`, `src/shaders/svgf.ts`, `src/shaders/gradient.ts`):

| pass | what | notes |
|---|---|---|
| `prepass` | `G` pair + depth slope (§1.3) | shared by both signals |
| `gradient_create` | per 3×3 stratum: (δ, Δ, var δ, valid), (mean l, var l, z, ∣∇z∣) | anti-lag only; 9×9 workgroups, one pixel per thread, shared-memory reduction (2.5× faster than a thread per stratum) |
| `gradient_atrous_0..4` | S2 reconstruction at stratum resolution | anti-lag only |
| `gradient_lambda` | λ, max over 3×3 strata, written once at 1/3 resolution | anti-lag only |
| `temporal` | as S-1 | |
| `variance` | as S-2 | |
| `atrous_0..4` | as S-3; the last writes the output | iteration 0 also writes the history only with `feedback: true` |

8 dispatches without anti-lag, 15 with it. There is no in-denoiser G1: in `'gradient'` mode
the renderer forward-projects and re-shades (S-8 as built). `DiffuseSpecularDenoiser` runs both
signals per thread in every pass (v0 §4.1) unless their structural options differ (`kernel`,
`atrousIterations`, `feedback`, `antiLag`, `gradientIterations`); then it builds two
pipelines. Joint vs two single-signal denoisers: 4.20 vs 5.1 ms (M1 §6).
**v0.2:** anti-lag v2 has 4 gradient à-trous passes, so **14 dispatches** with anti-lag (v1:
15); `antiLagVersion` is a structural option too. Joint cost on the test-bed bench: 3.99 ms
`'off'`, 4.24 ms `'auto'` v2 (M1 §12.4).

### 4.2 S-1 Temporal accumulation (S1 §4.1, S3)

- Reprojection, per-tap validity (C-7 with `cosN`), custom-weighted bilinear (C-8). No 3×3
  fallback (S3 omits it; tune later if foliage-like content suffers).
- `α_c = max(α_min, 1/(1+A))`, `A` per C-9 with `A_cap = 63` (S3 caps at 64 frames).
  `α_min = 0.2` (S1 p.5); **0.1 when A-SVGF is on** (S2 p.10).
- Moments of luminance `l = dot(c, (0.2126, 0.7152, 0.0722))`: `m = (l, l²)`,
  `α_m = max(α_mom, 1/(1+A))`, `α_mom` default **= α_min** (S1 §4.2 accumulates moments "the
  same way"), tune: [α_min, 0.6] (0.6 is S3's choice).
- Formats: `accum`/`hist` `rgba16float` (alpha = A), `moments` **`rg32float`** (review
  upgrade; l² overflows fp16).
- Specular (T1.3): surface reprojection only in M1, with
  `α_c = max(α_min, 1/(1 + min(A, A_spec)))`, `A_spec` from R-8 (§5.6). Virtual motion is M3.

**v0.1 (S-1 as built):**
- **3×3 fallback kept** (v0 dropped it, following S3). When no 2×2 tap has weight > 0.01,
  the 3×3 texels around the reprojected point that pass C-7 are averaged with equal weights
  (S1 §4.1, for thin geometry). Not measured separately; it is the paper's behaviour.
  (TASKS svgf 4.)
- `historyFilter` option: `'bilinear'` (default) or `'catmull-rom'` with the 4-tap gating of
  C-8 v0.1 (+0.03 … +0.07 dB, slightly more flicker, so off). (TASKS svgf 3.)
- `A_cap`: `maxHistory = 64` frames including the current one (= A 63), as v0.
- **α_min is shared by both signals.** M1 §4 measured that with `antiLag: 'off'` diffuse wants
  0.1 (+1.2 dB) while specular must stay 0.2 (0.1 costs −1.5 dB mean, −2.8 dB on `orbit`:
  ghosting of view-dependent reflections). A per-signal α_min is non-structural (free) and
  recommended, **not applied yet** (TASKS). With `antiLag: 'auto'`, α_min ≤ 0.1 is inert: λ
  keeps 1/n ≥ ~0.1 everywhere (0.05 and 0.1 give identical output within 0.02 dB), so even
  static regions never pass ~10 frames of history. Open in TASKS (λ noise floor).
- **v0.2:** the inertness was anti-lag v1's noise floor (§4.6 v0.2). With v2, static diffuse
  regions keep 32–64 frames, so α_min acts again, but lower values don't pay: diffuse α_min
  0.05 / 0.03 / 0.02 cost −0.01 … −0.12 dB, specular −0.7 dB (view-dependent lag) (M1 §12.5).
  **Keep 0.1 for both signals with `'auto'`.** The `'off'` recommendation (diffuse 0.1, specular
  0.2; per-frame mean) is unchanged and still not applied (review item 2).

### 4.3 S-2 Variance (S1 §4.2, S3 `EstimateVariance.frag`)

```
σ²_t = max(0, m2 − m1²)
if A < 3:                                         // fewer than 4 frames (S1 p.5)
    σ²_s = spatial estimate (7×7 if A = 0, else 5×5; S3)
           weights: w_z(q) · max(0, n·n_q)^128     (w_z as in S-3, offset in pixels)
           σ²_s = Σw·m2_q / Σw − (Σw·m1_q / Σw)²  (each neighbour's own moments; S3's quirk not copied)
    σ²_s *= 1 + 3·(1 − (A + 1)/4)                  // S3 boost
    σ²   = lerp(σ²_s, σ²_t, saturate(A / 3))       // smooth ramp (review: keep ssgiDev's ramp)
else σ² = σ²_t
V = (accum.rgb, sqrt(σ²))
```

**S-2a.** `V` stores the **standard deviation** in alpha, not the variance, so `rgba16float`
holds HDR values (σ ~ l, while σ² ~ l² overflows fp16). Every consumer squares it in f32.
Our deviation; numerically the paper's quantity.

**v0.1:** the spatial estimate's weights are the à-trous geometry weights of S-3 (depth ×
normal; for specular also the lobe cutoff, roughness and radius terms), not a separate
`n^128`. The specular `variance` pass costs 0.66 ms (0.95 with anti-lag) vs 0.23 ms for
diffuse, the largest single specular pass. Not profiled (TASKS).

**v0.2: `spatialVarianceRadius`** (new option; the cap on the spatial window's radius, S-2's
3 = 7×7 at A = 0, 2 = 5×5 after). Cause of the specular cost: under camera motion many specular
pixels have A < 3 (short histories from R-8 and anti-lag) and take the wide spatial path.
Default **3** (S-2 unchanged), except **1 (3×3) for specular when anti-lag v2 is on**: +0.07 dB
pooled specular, variance 1.10 → 0.51 ms joint (radius 3 / 2 / 1 / 0: 34.97 / 34.99 / 35.04 /
31.49 dB); diffuse keeps 3 (radius 1 or 2: −0.01 … −0.03 dB) (M1 §12.5). `'off'` with specular radius 1 is +0.03 dB
and cheaper but not applied, so `'off'` stays bit-identical to M1 (review item 2).

### 4.4 S-3 À-trous (S1 §4.3–4.4, Dammertz 2010)

Iteration `k = 0…K−1`, step `s = 2^k`, `K = 5` (S1; tune [4, 5], ssgiDev used 4). Kernel:
B3-spline 5×5, `h = [1/16, 1/4, 3/8, 1/4, 1/16]` outer product (S1 Eq. 1). Option
`kernel: '3x3-box'` (S2 §4, cheaper).

```
q   = 1/d                                               // affine in screen space for planes, like S1's clip depth
w_z = exp(−|q_p − q_t| / (σ_z·|∇q_p · Δ| + ε_q))        σ_z = 1, ε_q = 1e-3·q_p,  Δ = tap offset in pixels
w_n = max(0, n_p·n_t)^σ_n                               σ_n = 128
w_l = exp(−|l_p − l_t| / (σ_l·sqrt(g3x3(σ²)_p) + ε_l))   σ_l = 4, ε_l = 1e-4
[specular only] w_r = 1 − smoothstep(0.01, 0.1, |r_p − r_t|)    (RTG1 ch. 32 Eq. 14)
w   = w_z·w_n·w_l·w_r
C'  = Σ h·w·C_t / Σ h·w           σ²' = Σ h²·w²·σ²_t / (Σ h·w)²     (centre tap included, w = 1)
```

- **∇q** (review upgrade: gradient-scaled depth weight; no derivatives in compute): per axis,
  the one-sided difference of `q` to the left/right (up/down) neighbour with the **smaller**
  magnitude (doesn't straddle silhouettes). Computed from `G` at the centre pixel of each
  pass (4 extra loads), no texture.
- `g3x3` = 3×3 Gaussian `[1,2,1]⊗[1,2,1]/16` of σ² (review upgrade from box; S1 Fig. 5).
- Sky taps: weight 0. NaN guard: weights that are NaN → 0 (S3).
- **Feedback:** iteration 0's output is next frame's colour history (S1 p.5; review: default
  on). Its alpha carries A through from `accum`. Moments history = the unfiltered integrated
  moments.
- The ssgiDev 25 % blend toward a 4-neighbour min/max clamp is kept as an option
  (`neighbourClamp`, default off; measure).
- Remodulation (if asked) fuses into the last iteration (S3).

**v0.1 (S-3 as built; TASKS svgf 1, 6; M1 §4):**

| item | v0 | v0.1 | evidence |
|---|---|---|---|
| kernel | B3 5×5 | **3×3 box** (A-SVGF's); `kernel: '5x5'` kept | 5×5 buys ≤ +0.15 dB (+0.09 svgf, +0.14 auto) for +2 ms per signal (0.65 vs 0.28 ms per iteration); M1 §4 |
| feedback | on (paper) | **off**: next frame's colour history is the temporal output `accum`, not à-trous iteration 0 | +0.6 … +2.6 dB diffuse on all 7 paths, FLIP −24 … −44 %, energy loss −3.5 → −1.2 %, specular +0.1 … +0.8 dB, flicker unchanged, slightly cheaper; M1 §4. With feedback a static view *loses* PSNR over time (`cut`, frames 48 → 59: 39.2 → 36.8 dB) |
| specular normal weight | `max(0, n·n_t)^128` | **lobe cutoff**: `w_n = saturate(1 − θ/(θ_L(α) + 1°))`, with θ/θ0 computed as `sqrt((1 − cos)/(1 − cos θ0))` (no acos per tap); `specularNormalWeight: 'power'` restores v0 | +0.65 dB (TASKS svgf 6). The power form ignores roughness |
| specular radius weight | — | `w *= 1 − smoothstep(10r, 70r, ∣Δp∣)` (RTG1 ch. 32 Eq. 15, r perceptual, Δp in px); `radiusScale` (1; 0 = off) | from the source; not measured in isolation |
| variance prefilter | 3×3 Gaussian of σ² | the 3×3 Gaussian over this iteration's inner taps (exact at stride 1, wider at larger strides) | saves 8 loads per pixel per iteration; our approximation |
| `neighbourClamp` | option | **not built** | — |
| `luminanceVariance: 'mean'` | — | experiment: the accumulated mean's variance drives w_l | lost 0.7–2 dB (LESSONS); off |

Iterations stay at K = 5: 4 saves 0.3 ms per signal but loses up to 0.26 dB and raises
diffuse flicker 15–56 % (M1 §4).

### 4.5 Parameters at a glance

| parameter | default | source | tune |
|---|---|---|---|
| α_min | 0.2 (0.1 with A-SVGF) | S1 p.5, S2 p.10 | `'off'`: per signal recommended (S-1 v0.1); `'auto'`: keep 0.1 (v0.2) |
| α_mom | = α_min | S1 §4.2 | [α_min, 0.6] |
| A_cap | 63 | S3 | — |
| plane τ / cosN | 0.01 / 0.95 | RTG2 p.831 / S3 | [0.005, 0.015] / [0.8, 0.98] |
| spatial variance below | A < 3 | S1 p.5 | — |
| `spatialVarianceRadius` | 3 (7×7 / 5×5); **1 for specular with anti-lag v2** (v0.2) | S3; M1 §12.5 | measured |
| K, kernel | 5, **3×3 box** (v0.1; v0: B3 5×5) | S2 §4; M1 §4 | measured: keep |
| feedback | **off** (v0.1; v0: on) | M1 §4 | measured: keep |
| σ_z, σ_n, σ_l | 1, 128 (diffuse; specular uses the lobe cutoff), 4 | S1 p.5 | — |
| anti-lag | **`'off'`** (v0.1; `'auto'` = quality option); v0.2 recommends `'auto'` v2 | §4.6 | review item 2 |
| anti-lag v2 (`antiLagVersion` 2, default) | noise floor k: diffuse 2, specular 1 (`antiLagNoiseFloor` −1); `gradientIterations` 4; λ max radius 1 | §4.6 v0.2; M1 §12 | measured |

### 4.6 S-7/S-8 A-SVGF: gradient-driven α (S2 §3, S3)

**Renderer contract (S-8).** Gradients need the renderer to re-shade a few previous-frame
surface samples with this frame's lighting and the *same random numbers* (S2 §3.1). Our
denoiser can't do that, so A-SVGF mode is opt-in (`antiLag: 'gradient'`) and requires:

1. The renderer exposes its primary visibility (G-buffer) before shading, so G1 can run
   between the two (the test bed's analytic tracer can split its pass).
2. For every pixel `p` that G1 selected, the renderer shades **the previous frame's surface
   point** of the recorded previous pixel `p_old` (re-derived from that pixel's previous
   primary ray, or the renderer's own stored position), with **`p_old`'s previous-frame RNG
   seed** and current lighting, and writes that result as `p`'s sample (it is a valid sample
   for `p`, S2 p.7).
3. Static-world forward projection only in v0 (we have backward motion only); moving objects
   just don't get gradient samples.

**G1 `gradientProject`** (S3 `GradientForwardProject`): one thread per 3×3 stratum of the
**previous** frame. Pick a pixel in it with a hash of (stratum index, frame) (S3 uses TEA;
any good integer hash, e.g. PCG, Jarzynski & Olano JCGT 2020). Reconstruct its world point
from `G_prev` and the previous camera, project with the current camera, skip if off-screen,
and accept if the current `G` at the landing pixel passes the plane test (C-7) and
`dot(n, n_old) > 0.9` (S3). Then `atomicCompareExchangeWeak(requests[stratum_cur], 0, code)`
(first writer wins; S2 p.7). `code = 0x80000000 | (p_old.y·W + p_old.x) << 4 | slot`, `slot`
= position inside the current stratum (0…8). Requests buffer: `array<atomic<u32>>`,
`⌈W/3⌉·⌈H/3⌉` entries, cleared each frame (a `clearBuffer`).

**G2 `gradientCreate`** (S3 `CreateGradientSamples`), one thread per current stratum:
- If a request exists: `l_cur` = luminance of the (remodulated, see below) sample at the
  requested pixel, `l_old = lum_prev[p_old]`; write `g1 = (Δ = max(l_cur, l_old), δ = l_cur − l_old, 1, 0)`.
  Else `g1 = 0` (S2 §3.4: empty strata add zero to both, the ratio cancels density).
- `g2 = (mean l, var l, q, ∇q)` over the stratum's 9 pixels (for the filter's weights).
- Also write `lum_cur[p]` for all 9 pixels (next frame's `lum_prev`; `r32float` ping-pong).
- **S-7a one gradient for both signals:** `l` = luminance of the remodulated sum
  `c_d·ρ + c_s·E` (S2's path-tracer variant didn't split signals either, p.9). Both signals'
  α use the same λ.

**G3–G7 `gradientAtrous`** (S2 §3.4, S3 `AtrousGradient`): 5 iterations at stratum
resolution, 3×3 box, steps 1, 2, 4, 8, 16; weights `w_z` as S-3 (offset scaled by 3 px per
stratum) × `exp(−(Δl/σ)²)` with `σ = 3·sqrt(g3x3(var))` (S3's Gaussian form, used for the
gradient only). Filters (Δ, δ) and propagates `var` like S-3.

**In S1 (temporal):** `λ = max over the (2r+1)² strata around p's stratum of
min(1, |δ̂| / Δ̂)` (0 where Δ̂ < 1e-4), `r = 1` (S2 p.9: 3×3 safety max; S3 uses 2; tune
[1, 2]). **Clamp λ ≤ 1** (S2 Eq. 14; S3's missing clamp is a known bug, not copied).
`α_c ← lerp(α_c, 1, λ)`, `α_m ← lerp(α_m, 1, λ)`, `A ← min(1/α_c − 1, A_cap)` (S3).
Gradient strata 3×3 (S2 p.12: ≤ 11 % of samples recycled).

**Without the contract:** plain SVGF (α_min 0.2), or the core fast-history anti-lag (C-10)
as an experiment.

**v0.1: anti-lag as built (TASKS svgf 5; M1 §4; README).** `antiLag: 'off' | 'auto' |
'gradient'`, default **`'off'`**.

- **S-7b `'auto'` (our design, replaces C-10's `'fast'` in svgf).** No renderer work. Per 3×3
  stratum: `δ = mean(l_cur) − mean(l_hist)`, `Δ = max(both)`, over the stratum's pixels with
  valid history, where `l_hist` is the luminance of the reprojected **temporally accumulated**
  history (before à-trous) and `l_cur` the noisy input; `var δ` = the variance of the
  current mean. Then S2's 5-iteration reconstruction and `λ = max(0, |δ̂| − k·σ_δ̂) / Δ̂`, k =
  2 (`antiLagNoiseFloor`), so static noise doesn't read as change. Unlike renderer gradients,
  it keeps firing until the history has caught up: dev-page light switch above 35 dB after 3
  frames vs ~8 for plain SVGF and slower for `'gradient'`. Test bed (feedback off, 7 paths,
  v1): +0.25 / +1.50 dB pooled diffuse / specular (+0.27 / +1.23 per-frame mean), lower FLIP and
  flicker, light-flip recovery ~3 vs ~9 frames; cost +2.1 ms joint on the 8-frame replay
  (4.20 → 6.31 ms; +1.6 ms on the bench, 3.99 → 5.61). v0.2 replaces the noise floor and the
  passes (below).
- **S-8 `'gradient'` contract as built.** The renderer does the forward projection and the
  re-shading and supplies `inputs.gradient`: one texel per 3×3 stratum (`⌈W/3⌉ × ⌈H/3⌉`,
  rgba32float/rgba16float), r = luminance of the forward-projected sample as shaded last
  frame, g = the same sample re-shaded this frame with the same random numbers, b > 0 =
  valid. The denoiser only reconstructs (no G1 pass, no requests buffer). The test bed
  doesn't produce these samples yet (TASKS), so `'gradient'` is measured on the dev page only.
- **Per signal, not one shared gradient** (v0 S-7a used the remodulated sum): inputs are
  demodulated and the remodulation factors are optional, so each signal gets its own λ.
- **Default `'off'`** is the orchestrator's call (performance first: SVGF stays near the 4 ms
  budget). M1 recommended `'auto'` on quality. Review item 2.
- Budget preset (not built): `'auto'` for specular only takes most of the gain (+1.23 vs
  +0.27 dB) but needs two pipelines, because `antiLag` is structural.

**v0.2: anti-lag v2** (`antiLagVersion: 2`, the default since 5eb75d4 + f16ffcd; `1` keeps the
M1 passes bit-identical; `'off'` is unchanged to 4 decimals). Root cause of v1's history cap
(M1 §12.1, readback of n and λ on a static `light` view): λ > 0 on ~85 % of static pixels, n
p50 ≈ 13, never ≥ 32. Two mechanisms: (1) the noise floor was ~4.5× too low, because S3's
variance propagation `Σw²·var/(Σw)²` assumes independent taps, and after the first iteration
neighbouring strata share inputs (over 5 equal-weight iterations it shrinks var by 9⁵ while
the composite kernel averages only ~2900 strata), so k = 2 acted like k ≈ 0.45; (2) a persistent
small λ caps n at 1/√λ through the `n = 1/α` compounding (fixed point of n·(1 + λn) = n + 1).

| item | v0.1 (v1) | v0.2 (v2, built) | evidence (pooled, 7 paths) |
|---|---|---|---|
| noise floor σ_δ̂ | S3's propagation of var through the 5 iterations | **var(δ̂) = (linearly filtered per-stratum var δ) × ΣK²**, ΣK² ≈ 1/(4πv) with v the per-axis spatial variance of the composite kernel, tracked through the iterations as a weighted mixture (taps' v + this iteration's offset spread), clamped ≤ 1. Our design (central-limit Gaussian approximation; variances of convolved kernels add) | λ = 0 on 88–93 % of static diffuse pixels (v1 7–18 %); static diffuse n p50 36–43 (v1 13) |
| floor k (`antiLagNoiseFloor`) | 2 for both | **diffuse 2, specular 1** (−1 = per signal) | diffuse k 1 or 2 equal (39.12); specular k 1 vs 2: +0.11 dB (it keeps detecting real view-dependent drift under camera motion) |
| compounding n = 1/α | yes | kept: once noise no longer triggers λ, it only shortens history where a drift persists | without compounding (n capped at 1/λ): specular 34.41, lags |
| gradient samples | per pixel: reprojection per pixel, stratum reduction in 9×9 workgroups | **one thread and one reprojection per 3×3 stratum**; the stratum's history mean = 9 bilinear samples folded into 2 hardware-bilinear taps per axis (Sigg & Hadwiger tap folding; assumes uniform motion inside a stratum) | same PSNR; create 0.57 → 0.28 ms |
| gradient state | 4 × rgba32float + r32float at 1/9 res, ~7.6 B/px per signal | **8 × f16 in one rgba32uint** (σ, not var, for f16 range) ping-pong + λ r32float: **4 B/px per signal** | one 16-byte load per tap |
| reconstruction iterations (`gradientIterations`) | 5 (S2) | **4** | 4 = 5 within ±0.01 dB; 3: −0.04 diffuse |
| young-history variance (S-2) | 7×7 / 5×5 | **`spatialVarianceRadius` 1 for specular with v2** (§4.3) | +0.07 dB specular; variance 1.10 → 0.51 ms |
| α_min with `'auto'` | inert | acts, keep 0.1 (§4.2) | lower costs up to −0.12 / −0.7 dB |

Result (M1 §12.3–12.4): diffuse 39.12 (v1 39.13, `'off'` 38.88), specular **35.04** (v1 34.96,
`'off'` 33.46); every specular path ≥ v1; FLIP 0.033 / 0.046 vs `'off'` 0.036 / 0.051; light-flip
recovery 4 / 3 frames (`'off'` 5 / 8). Joint cost on the uncontended bench **4.24 ms vs `'off'`
3.99** (v1 5.61): gradient chain 1.27 → 0.50 ms, variance 1.10 → 0.51. `'gradient'` (renderer
samples) runs the same v2 reconstruction, unmeasured (no producer on the test bed). A shared
gradient for both signals was not built: after these levers it could save ~0.2 ms at most and
would lose the per-signal floor. Whether `'auto'` becomes the default is review item 2.
**v0.4:** decided, `'auto'` is the default (64a1123).

---
## 5. Family 2: recurrent blur (M2 diffuse, M3 specular) — opt-in; below SVGF on the test bed (review item 1, decided)

Pipeline shape from RTG II ch. 49 §49.5 (Fig. 49-3) and GTC 2020: the **post-blur output
is next frame's history** (the recurrent loop, RTG2 §49.3), and a separate stabilization
history never feeds back (RTG2 §49.5.7). Diffuse and specular share every dispatch.

**v0.2 status.** Diffuse (M2) and specular (M3) are built (`filter: 'recurrent'`,
`src/recurrent.ts`, `src/shaders/recurrent.ts`) and every measured deviation is folded in
below as a v0.1 or v0.2 note. `DiffuseSpecularDenoiser({ filter: 'recurrent' })` still runs
recurrent diffuse + SVGF `antiLag: 'auto'` specular (two pipelines, shared prepass); `specular:
{ filter: 'recurrent' }` puts both signals in shared recurrent dispatches (review item 1
proposes making that the meaning of `filter: 'recurrent'`). The same passes also run an
occlusion-only mode (§8.2). **v0.4:** item 1 decided: the recurrent filter is opt-in (SVGF is
the default for every signal) and `filter: 'recurrent'` on the joint class means both signals in
shared dispatches; the mix is explicit (`specular: { filter: 'svgf', antiLag: 'auto' }`). The
anti-lag switch is `historyAntiLag` (was `antiLag`, kept as a deprecated alias).

Measured (M2-M3 §2, M1 §11; all three filters in one page, pooled with the per-frame mean in
brackets): recurrent diffuse **38.26 (38.44)** vs SVGF 38.88 (39.00) and A-SVGF auto v2 39.12;
SVGF wins 6 of 7 paths (recurrent − SVGF: −0.25 … −1.25 dB; recurrent leads only on `glossy`,
+0.22). Recurrent specular **34.10 (34.41)** vs SVGF 33.46 and A-SVGF auto v2 35.04 (§5.6). It
is weaker in disoccluded regions (diffuse 36.41 vs SVGF 37.57), recovers more slowly from a
light flip (diffuse 11 frames vs 5 for A-SVGF), and flickers ~10 % more under camera motion
(less on static views). Joint cost 4.44 ms vs SVGF 3.99–4.02; memory 105.5 vs 132 B/px (§10).
On the dev page (hard direct-light shadows) it is ~2–3 dB below SVGF: without a luminance weight
the blur smears hard direct-light edges (a luminance weight was tried twice and removed, 25c80aa
and M3). The earlier claim "recurrent beats A-SVGF on 6 of 7 paths" was measured against
feedback-on SVGF and does not hold against today's defaults.

### 5.1 Pass list

| # | pass | reads | writes (storage) | n storage |
|---|---|---|---|---|
| R0 | `prepare` | caller guides | `G` | 1 |
| R1 | `preBlur` | raw radiance + hitT (front end), `G`, `G_prev`, `H_prev` (ĥ guide only) | `pre_d`, `pre_s` (rgb, raw ĥ) | 2 |
| R2 | `temporal` | `pre_*`, `G`, `G_prev`, `H_prev_*`, `F_prev`, `data_prev` | `acc_d`, `acc_s` (rgb, ĥ), `F`, `data` | 4 |
| R3 | `mips` | `acc_*`, `G` | mip atlases `M_d`, `M_s` (rgba16f), `M_z` (r32f) | 3 |
| R4 | `historyFix` | `acc_*`, `M_*`, `G`, `F`, `data` (rw) | `fix_d`, `fix_s`; `data` in place | 3 |
| R5 | `blur` | `fix_*`, `G`, `data` | `blur_d`, `blur_s` | 2 |
| R6 | `postBlur` | `blur_*`, `acc_*` (centre only), `G`, `data` | `H_d`, `H_s` = next frame's history | 2 |
| R7 | `stabilize` | `H_*`, `S_prev_*`, `G`, `G_prev`, `data` | `S_d`, `S_s` (+ remodulated outputs if asked) | 2–4 |

**8 dispatches** per frame for diffuse + specular (RTG2 has 7; our extra one is `prepare`,
fusable into R1 later). Every dispatch stays within the default 4 storage textures.
Formats and buffer rotation: §10.

**v0.1: implementation choices that apply to every pass** (same outputs, less time; TASKS
recurrent 5, 7; LESSONS; commit 25c80aa):
- **Affine taps (R-4).** The kernel axes `T·R_w`, `B·R_w` are projected once at the centre to
  a screen-space Jacobian, and each tap's pixel is `p + J·K_i` instead of projecting each
  world tap. The plane distance of a tap is linear in its pixel for a fixed tap depth
  (`dot(n, X_q) = z·(a0 + ax·qx + ay·qy)` in perspective), so it costs a few FMAs. Identical
  PSNR, part of 3.86 → 2.92 ms diffuse. The screen-offset cap is `2·max(R_max, R_pre)` (v0:
  `2·R_max`, which silently collapsed the pre-blur when R_max was swept small).
- **Branchless taps.** Clamp the tap coordinate, issue every load, zero rejected weights with
  `select`. Temporal 0.74 → 0.56 ms, blur 0.50 → 0.34 ms.
- **Workgroup-shared 10×10 tiles** (8×8 workgroup + 1-px halo) for the 3×3 neighbourhoods of
  R2 (detector), R4 (anti-firefly, fast clamp) and R7 (clamp): joint temporal −0.20 ms,
  history fix 0.82 → 0.47 ms, stabilize −0.04 ms. With tiles, the mip-repair code no longer
  costs occupancy, so it stays in R4 (v0.1 drops the "move it to an indirect dispatch" lever).
- **No depth slope** in recurrent-only pipelines (prepass 0.18 → 0.10 ms, §1.3).

**v0.2: the budget work after v0.1** (1b49e75; M2-M3 §4, joint diffuse + specular on the dev
page; each step measured alone; quality on 4 paths at 1080p):

| change | v0.1 | v0.2 (built) | ms | quality |
|---|---|---|---|---|
| tap counts per pass (structural options `preBlurTaps` / `blurTaps` / `postBlurTaps`, 4 or 8) | 8 everywhere | **pre-blur 8 diffuse / 4 specular, blur 8, post-blur 4** (§5.9) | post-blur −0.41, specular pre-blur −0.08 | post-blur +0.00 … +0.06 dB both signals; specular pre-blur ±0.15 (diffuse would lose 0.5 dB, stays 8); 4-tap blur −0.07 dB / +5 % flicker for −0.40 ms: option only |
| reprojection (C-6/C-7) | shared core: per-tap unprojection, pairwise-averaged normal | **recurrent-only reprojection**: linear unprojection with the previous projection, plane test against `{Xp, np}` (current normal only), distance linear in the tap pixel, backfacing rejected | −0.11 | within 0.03 dB |
| 2×2 history taps in R7 | branchy | branchless, like R2 | stabilize 0.78 → 0.56 | identical |
| R7 history filter (diffuse) | Catmull-Rom | **bilinear** for diffuse; specular keeps Catmull-Rom (§5.11) | −0.08 | diffuse identical; specular bilinear −0.05 … −0.16 dB |
| `shader-f16` kernel taps | — | not kept | −0.11 | −0.2 dB on HDR (dev-page diffuse); f16 weights with f32 sums were slower |

Joint recurrent: 5.41 ms (T2 state, before virtual motion; v0.1 quoted this number) → 7.00 with the first virtual motion →
**4.44 ms** after the dead options were removed, the virtual fetch went bilinear, the tiles,
`slope: false` and the table above (M2-M3 §4 has every row). Skeleton (trivial kernels, same
bindings): 0.85 ms.

### 5.2 Common definitions

```
pixSize(d)  = 2·d / (P[5]·H)        (orthographic: 2 / (P[5]·H))          world size of one pixel at depth d
v           = −normalize(X)          view vector, out of the surface;  NoV = max(dot(n, v), 1e-4)
α           = r²                     diffuse uses r = 1
θ_L(α)      = atan(α · sqrt(E / (1 − E))),  E = lobeFraction = 0.75      GGX lobe half-angle (R-1)
F_dom(α)    = (1 − α)·(sqrt(1 − α) + α)                                  dominant-direction factor (R-2)
D           = normalize(lerp(n, reflect(−v, n), F_dom(α)))               specular dominant direction
A_n         = saturate(A / A_cap)
W(x)        = smoothstep(0, 1, saturate(1 − x))                          weight shape, RTG2 Eq. 49.3 with a = 1/tolerance, b = 0
lum(c)      = dot(c, (0.2126, 0.7152, 0.0722))
```

**R-1 Lobe half-angle (D4e).** Our derivation from the GGX NDF: the fraction of
projected microfacet area within angle θ of the normal is `tan²θ / (α² + tan²θ)`; setting it
to E gives `tan θ = α·sqrt(E/(1−E))`. With E = 0.75 (the fraction RTG2 p.841 names):
θ_L = 60° at r = 1, 23° at r = 0.5, 4° at r = 0.2. This replaces the three conflicting
forms in reblur.md §4.4 (GTC20's 90°·α/(1+α), the FB p.72 form, and RTG2's call, which is
a listing). Tune: E ∈ [0.5, 0.9].

**R-2 Dominant direction (D4f).** Frostbite's simple fit (Lagarde & de Rousiers 2014,
Listing 22, p.71), which the authors found to perform better than their accurate fit, fed
with **GGX α** (FB's `roughness` is α). Mirror: F = 1 (D = reflection); r = 1: F = 0 (D = n).
Tune on captures: feeding perceptual r instead.

### 5.3 R0 `prepare`

Writes `G` (C-5). Nothing else; no signal processing here.

### 5.4 R1 `preBlur` (D1)

Purpose: redistribute outliers and densify the 1-spp input before it enters the history
(RTG2 §49.5.1).

- Front end per tap: F-1 sanitize, F-2 demodulate if needed, F-3 normalize hitT → ĥ.
- Kernel: the shared 8-tap disk (R-3) on the world-space plane (R-4), **static** (no
  per-pixel rotation; RTG2 §49.5.5), centre included.
- Radius (D1): `R_pre_px = 15·(H/1080)` diffuse, `10·(H/1080)·f_r(α)` specular (R-5);
  converted to world with `pixSize(d)`. Constant per pixel, i.e. world radius grows with
  distance like a screen-space blur. **D1b:** clamped by `c_h·h̃_prev` (R-5) where
  `h̃_prev` is last frame's **denoised** hit distance: the alpha of `H_prev` at the
  nearest texel to `uv_prev` (C-6), if that texel passes the plane test (C-7); otherwise no
  hit clamp. Raw hitT is too noisy to size a kernel (RTG2 p.837), and a pre-blur bias is
  permanent (the converged result is an average of pre-blurred frames), so contact regions
  must not be pre-blurred wide. Tune: diffuse [0, 30] px, specular [0, 20] px.
- Weights: `w_geom`, `w_normal`, `w_rough` (spec) at **A = 0** tolerances (R-6). No
  hit-distance weight (raw ĥ), no luminance weight (redistribute, don't reject).
- ĥ passes through **unfiltered** (GTC20 s.60: hit distance denoised in all passes except
  pre-blur).

**v0.1 (R1 as built; TASKS recurrent 3, 6):**
- Diffuse radius **25 px** at 1080p (v0: 15). Test bed +0.10 dB (per-frame mean). Specular
  stays 10 px·f_r (5 / 20 px measured worse in M3). The bias is permanent (§12, the
  lower-priority pre-blur item: look at contact GI before freezing).
- **D1b guide:** the nearest reprojected texel's denoised ĥ is used when its depth is within
  **5 % relative** of the expected previous depth (v0: the C-7 plane test). It only sizes a
  kernel, and the cheaper test keeps the loads parallel. Not measured separately.

**v0.2:** specular pre-blur uses **4 taps** (R-3's taps 0, 2, 4, 6: two antipodal pairs, still
zero-mean), diffuse keeps 8: specular ±0.15 dB for −0.08 ms joint, diffuse would lose 0.5 dB (§5.1 v0.2). The
occlusion-only mode has no pre-blur pass (§8.2).

### 5.5 R2 `temporal` — diffuse

- Reproject `H_prev_d` (C-6, C-7, C-8 with Catmull-Rom), A per C-9, `A_cap = 31`.
- `acc_d = lerp(H_d, pre_d, 1/(1 + A_d))` for rgb **and ĥ** (ĥ accumulates with the signal's
  own A: long accumulation gives good AO; the responsive hit distance lives in `F`).
- Fast history (C-10): `F_prev` reprojected with custom bilinear;
  `F.(lum_d, ĥ_d) = lerp(F_prev, (lum(pre_d), ĥ_pre), 1/(1 + min(A_d, A_fast)))`.
- No variance clamp here (RTG2 p.834: the pre-blurred signal is too noisy for a useful clamp).
- **v0.1:** the current-frame detector C-10b runs here, between the A update and the
  accumulation, so the accumulation already uses the shortened A. Catmull-Rom per C-8 v0.1.
  `A_cap = 31` kept: 15 / 31 / 63 measured +0.11 / 0 / −0.02 dB with v0's anti-lag and −0.04
  dB for 31 vs 15 with ours, i.e. flat (TASKS recurrent 4).

### 5.6 R2 `temporal` — specular (M3; D12) — as built (v0.2)

Two history candidates, surface and virtual motion, blended (RTG2 §49.8). The functions
below are **our design** built from the chapter's prose properties; the listing formulas
transcribed in reblur.md §4.2 are not used. **v0.2:** v0.1 left this section as designed
while T3 was working. It now describes `temporalSpecular` in `src/shaders/recurrent.ts`
(a787b20, 25c80aa, 1b49e75) and gives each change with its measurement (M2-M3 §5: 1080p live
specular PSNR on `glossy` / `orbit`, per-frame mean, the metric T3 tuned on).

**R-7 Parallax** (RTG2 §49.8.1 prose, Fig. 49-5): `π = tan(angle(v_cur, v_prev))` with
`v_cur = normalize(X)` and `v_prev = normalize(Rc_prev · Xp)` (the point relative to the
previous camera, from C-6, so object motion is included). `π = 0` under pure rotation.
Per frame; no fps normalization (constants are tuned on 60 fps captures). Built as written.

**R-8 Surface-motion frame cap.** RTG2 p.834 requires a cap that is smaller for low
roughness, small |n·v|, and high parallax. Ours, from a lag argument: the reflected image
slides across the surface by about π per frame; history stays sharp while the accumulated
slide stays inside the lobe half-angle:

```
A_spec = min(A_cap, k_s · θ_L(α) · NoV^κ / max(π, 1e-4))        k_s = 1 (tune [0.25, 4]), κ = 0.5 (tune [0, 1])
A_surf = min(A_s, A_spec)                                         A_s after the +1 of C-9 (D12d: post-increment)
C_surf = lerp(H_surf, pre_s, 1/(1 + A_surf))
```

Examples: π = 0 → full history even on mirrors (rotation is reprojected exactly); r = 0.05
with any translation → ~1 frame; r = 0.32 strafing 1 cm/frame at 2 m → full. Built as written
(`specCap`; SVGF specular uses the same cap, S-1).

**R-9 Virtual position, with curvature (D12c built in v0.2).** The reflected image point along
the view ray (the "virtual image" of RTG1 ch. 25 p.451 and Stachowiak 2015), pulled back to the
surface by the dominant factor (RTG2 p.835–836 prose: F → 0 resolves virtual to surface
motion). v0 assumed a flat reflector; the built version corrects the distance with the mirror
equation (1/d_o + 1/d_i = 2/R, as RTG1 ch. 32 §32.4.3 uses it for reflection motion), with the
curvature estimated from neighbouring normals:

```
h̃      = denormalize(lerp(F_prev.ĥ_s, ĥ_pre, 1/(1 + min(A_s, A_fast))))   this frame's fast hit distance (RTG2 p.837 prose)
κ      = mean over the 4 axis neighbours q that pass the 2 % plane test of dot(n_q − n, X_q − X) / ‖X_q − X‖²   (convex > 0)
d_v    = h̃ / max(1 + 2κ·h̃, 0.05)
X_virt = X + normalize(X) · d_v · F_dom(α)
uv_virt = project(prevProjection, R_prev · (X_virt + Δcam))
```

Curvature: `glossy` 32.62 → 33.60 dB (mirror bin 30.5 → 32.1); isotropic κ, no incidence-angle
term (our simplification). Static-world assumption for the reflected scene (moving reflectors
and reflected moving objects lose confidence instead).

**R-10 Virtual history and confidence (D12a).** `H_virt` = custom-weighted bilinear at
`uv_virt`. Tap validity = plane test against the **current surface plane** `{Xp, np}` (a flat
reflector's previous texels at `uv_virt` lie on that plane), its distance linear in the tap
pixel like the kernels (no pairwise normal average). Then:

```
v_g   = Σ b_i·v_i                                   valid fraction of the footprint
n̄_v, r̄_v, ĥ̄_v = valid-weighted averages at uv_virt of previous normal, roughness and F_prev.ĥ_s
c_v   = inScreen(uv_virt) · v_g
      · W( acos(n·n̄_v) / (0.5·θ_L(α) + 1°) )        reflections move twice as fast as normals
      · W( |r − r̄_v| / (0.05 + 0.25·r) )
      · W( |ĥ̄_v − h̃_n| / (0.05 + 0.25·r) )          h̃_n = the normalized h̃ of R-9; hit distance must agree in the reflected world
```

**v0.2:** built as designed, with two measured choices: **bilinear only** (Catmull-Rom on the
virtual fetch: +0.04 dB for 0.13 ms, dropped in 25c80aa) and the plane test above (cheaper than
C-7, identical output). Option names: `virtualAngleScale` 0.5, `virtualHitTolerance` 0.05,
`virtualHitToleranceRoughness` 0.25.

**R-11 Virtual clamp (D12b).** `μ`, `σ` per channel of `pre_s` (rgb and ĥ) over its
geometry-valid 3×3 neighbourhood.

| | v0 | v0.2 (built) | evidence |
|---|---|---|---|
| clamp | `lerp(clamp(H_virt, μ ± 2σ), H_virt, c_v)`: confidence decides whether to clamp | **always clamped**, window `μ ± γ·(1 + 2·c_v)·σ`, γ = 1 (`virtualClampSigma`): confidence widens the window | +0.07 / +0.07 dB. Mirror input is clean, so a tight window costs nothing there and catches wrong virtual fetches; RTG2 p.837 prose ("confidence controls how hard virtual history is clamped") is read as the window width |

**R-12 Blend.** As designed:

```
α_surf = 1/(1 + A_surf)
α_virt = lerp(1/(1 + min(A_s, A_fast)), 1/(1 + A_s), c_v)   // no parallax penalty; low confidence → fast (RTG2 p.837)
m      = F_dom(α) · inScreen(uv_virt) · [v_g > 0]            // amount of virtual motion (RTG2 p.837 prose)
C_virt = lerp(H_virt, pre_s, α_virt)
acc_s  = lerp(C_surf, C_virt, m)                             // rgb and ĥ
α_next = lerp(α_surf, α_virt, m);   A_s ← 1/α_next − 1       // blend in α-space: α is the actual weight
```

If the surface footprint is fully invalid: `A_s = 0`, `acc_s = pre_s`, `m = 0`.

**v0.2: what surrounds the blend, as built.**
- **Fast history.** Fast luminance follows the blended reprojection (`F.lum ← lerp(F_surf.lum,
  F_virt.lum, m)`); the fast ĥ stays surface-reprojected because it sizes R-9 (v0: both
  surface-reprojected). The occlusion mode's SO moves the fast ĥ too (§8.2).
- **Current-frame detector (C-10b) for specular** runs before the R-8 cap and compares the 3×3
  input mean with the **blended** history `lerp(H_surf, H_virt, m)`. Two specular changes, both
  measured: the floor is `A_fast·f_r(α)` instead of `A_fast` (mirror input is nearly noise-free,
  so a mismatch drops a mirror to ~0 history; +0.1 dB `orbit`), and the window is centred on
  `μ = lerp(own value, 3×3 mean, f_r(α))` instead of the 3×3 mean (a clean mirror's 3×3 mean is a
  blur of its reflected edges; `light` mirror bin 34.8 → 40.7 dB, `orbit` +0.6). The same
  centring applies to C-10 in the history fix (§5.8).
- **`data` stores `m·c_v`**, not `m` (§5.12). Its only consumer was R7's virtual candidate,
  which is gone (§5.11).

**Steps and their effect** (M2-M3 §5; A-SVGF `auto` v1 = 34.63 / 33.80 on the same pages):

| step | glossy | orbit |
|---|---|---|
| T2 interim (surface motion only) | 31.56 | 31.27 |
| + virtual motion R-9…R-12 as in v0 | 32.62 | 30.49 |
| + curvature (D12c) | 33.60 | 30.37 |
| − R7 virtual candidate, `m·c_v` in `data` | 34.56 | 32.23 |
| + clamp always on, window γ(1 + 2c_v)σ | 34.63 | 32.30 |
| + detector floor A_fast·f_r | 34.66 | 32.40 |
| + specular R_max 30 px, R_min·f_r (§5.9), window centred on the pixel as r → 0 | 34.92 | 32.85 |
| final, after the budget work (4-tap pre/post-blur, bilinear virtual fetch) | 34.80 | 32.85 |

Virtual motion on vs off in the final design: `glossy` +2.75, `orbit` +1.10, `light` +0.21 dB.
Glossy kernel elongation κ_e 0 / 0.75 / 1: ±0.1 dB (0.75 kept). Tried and dropped (each ±0.2 dB
or worse; PROVENANCE M3 rows): gating virtual motion by the surface candidate's parallax loss,
m = F_dom², the slow ĥ for the virtual distance, a luminance weight with predicted noise, radius
∝ (1+A)^−p, other R_max / pre-blur radii / A_cap / N_stab, anti-lag σ variants, firefly
thresholds, an input clamp.

**Result** (pooled, 7 paths): specular 34.10 dB vs SVGF 33.46 and A-SVGF auto v2 35.04; ahead of
plain SVGF on 5 of 7 paths, of A-SVGF auto only on `glossy` (+0.17). M1's two SVGF failure modes:
mirror over-blur fixed on a static camera (`light` r < 0.15: 34.4 → 40.8 dB; A-SVGF 42.5) and
level with A-SVGF under motion; glossy-floor lag fixed (`glossy` r < 0.35: SVGF 28.1, A-SVGF 34.8,
recurrent 35.7). The remaining gap is at mid/high roughness on static-camera paths (`light` /
`object` r < 0.6: −0.9 / −1.8 dB vs A-SVGF) and in flicker under motion (+15…40 %), where A-SVGF's
short history plus a 5-level variance-guided à-trous wins (M2-M3 §2, §5).

### 5.7 R3 `mips` (D7e)

- Levels 1–3 below the base (4 levels in total: base + 3), which reconciles RTG2's "first
  four mip levels" (text) with "first 3 mip levels" (figure). Tune: add level 4.
- One dispatch, 16×16 workgroups, shared-memory reduction 16×16 → 8×8 → 4×4 → 2×2
  (RTG2 §49.5.3: single pass in shared memory).
- **Averages over non-sky pixels only** (weight `d > 0`), for `acc_d`, `acc_s` (rgb + ĥ) and `d`.
- **R-13 Atlas layout** (to stay within 4 storage textures): all three levels of one signal
  go into one 2D texture: level 1 at (0, 0), level 2 at (⌈W/2⌉, 0), level 3 at
  (⌈W/2⌉, ⌈H/4⌉); atlas size (⌈W/2⌉ + ⌈W/4⌉) × ⌈H/2⌉ (0.375 of the base area). The
  signal atlases reuse a free full-size rotation buffer (§10); the depth atlas is its own
  `r32float`. History fix reads atlases with `textureLoad` only (no hardware filtering
  across regions).

### 5.8 R4 `historyFix` (D7, D8, D9, D11)

Order per pixel and signal: (a) mip repair, (b) anti-firefly, (c) fast-history clamp and
anti-lag.

**(a) Mip repair (D7).** Only where `A < A_fix`, `A_fix = 3` (RTG2 p.829: full
reconstruction lasts 1–3 frames). Tune [2, 6].

```
ρ = 1 (diffuse) or r (specular, perceptual)                   // mirrors start near the base level (GTC20 s.35)
L = floor(3 · saturate(1 − A/A_fix) · ρ + 0.5)                // GTC20 s.35 structure, L_max = 3
while L ≥ 1:
    f  = (p + 0.5)/2^L − 0.5;   3×3 texels t around round(f)          (D7d: 3×3 per RTG2 p.829)
    w_b = tent(f − t) with half-width 1.5 texels
    w_z = W( |d_mip(t) − d| / (τ_fix · 2^L · d) ),  τ_fix = 0.02     (D7b; viewZ-only weights, RTG2 p.829)
    if Σ w_b·w_z / Σ w_b ≥ 0.25:  C ← Σ w_b·w_z·C_t / Σ w_b·w_z;  break     (D7c)
    L ← L − 1
```

Tune: τ_fix [0.005, 0.05], weight-sum threshold [0.1, 0.5]. The repaired value replaces the
accumulated one (rgb and ĥ). Diffuse: A = 0 uses mip 3 (8×8), A = 1 mip 2, A = 2 mip 1.

**(b) Anti-firefly (D9).** Our rank-based clamp in the spirit of rank-conditioned rank
selection (RTG2 p.830 names Hardie & Barner 1994; we have not read it): over the 8
neighbours of `acc` that pass `w_geom` at A = 0 tolerances, take the **second-largest
luminance** `l_(2)`; if the centre's `l > k_ff·l_(2)`, scale its rgb by `k_ff·l_(2)/l`.
Needs ≥ 4 valid neighbours. `k_ff = 1.5`, tune [1, 4]. Skipped for specular with
`r < 0.25` (sharp highlights are legitimate and mirror input isn't noisy). ĥ untouched.

**(c) Fast clamp and anti-lag (D8, D11):** C-10 exactly. "Faster history" (D8c) = `F`, a
second accumulation with cap `A_fast = 3`; neighbourhood 3×3, γ = 2 (D8a). Writes the
reduced A into `data` in place (`r32uint` read-write, own pixel).
**v0.1:** window `γ·σ_f/√N`, γ = 1 (C-10 v0.1, +0.37 dB per-frame mean).
**v0.2 (specular branch as built):** the window is centred on `μ = lerp(own fast value, 3×3
mean, f_r(α))` for luminance and ĥ, so mirrors are compared with themselves (a clean mirror's
3×3 mean blurs its reflected edges; `light` mirror bin 34.8 → 40.7 dB, §5.6). The occlusion
kinds clamp the slow ĥ itself into the window (§8.2).

### 5.9 Spatial kernel (R5, R6, and R1's shape)

**R-3 Poisson disk (D3a).** 8 taps in 4 antipodal pairs, from a golden-angle (Vogel 1979)
spiral of 4 points with radii `sqrt((i + 0.5)/4)`, mirrored. Zero mean (no shift when
used unrotated), minimum spacing 0.425 of the radius:

| i | x | y | i | x | y |
|---|---|---|---|---|---|
| 0 | 0.3536 | 0.0000 | 4 | −0.3536 | 0.0000 |
| 1 | −0.4515 | 0.4137 | 5 | 0.4515 | −0.4137 |
| 2 | 0.0691 | −0.7875 | 6 | −0.0691 | 0.7875 |
| 3 | 0.5691 | 0.7423 | 7 | −0.5691 | −0.7423 |

Plus the centre pixel (weight 1 before the bilateral terms). No distance falloff (uniform
disk; recurrence smooths). Tune: add `exp(−3u²)` falloff.

**v0.2: tap counts per pass** (structural options, compiled in; 4 = taps 0, 2, 4, 6, two
antipodal pairs): pre-blur 8 diffuse / 4 specular, blur 8, post-blur 4 (both signals). Evidence
in §5.1 v0.2: the 4-tap post-blur is neutral (+0.00 … +0.06 dB) for −0.41 ms; `blurTaps: 4`
(−0.40 ms, −0.07 dB, +5 % flicker) is an option, not the default.

**D3b rotation (blur only).** `φ = 2π · fract(B4[py & 3][px & 3]/16 + frameIndex · 0.6180339887)`,
`B4 = [[0,8,2,10],[12,4,14,6],[3,11,1,9],[15,7,13,5]]` (4×4 Bayer, animated with the
golden-ratio additive sequence; RTG2 §49.5.5 says animated 4×4 Bayer, ALU only; the
golden-ratio animation is RTG II ch. 24's recommendation for blue noise). Pre- and
post-blur: φ = 0.

**R-4 Kernel plane (RTG2 §49.9 prose, GTC20 s.38–40).** Axis `a = reflect(−D, n)`: equals
`n` for diffuse (tangent plane) and `v` for a mirror (screen plane).

```
if |dot(a, n)| > 0.999:  (T, B) = orthonormal basis of n     (Duff et al., JCGT 6(1), 2017)
else:                    T = normalize(cross(n, a));  B = cross(a, T)
T *= s_T,  s_T = 1 − κ_e · (1 − NoV) · 4r(1 − r)              κ_e = 0.75, tune [0, 1]
X_i = X + R_w · (K_i.x·T + K_i.y·B)       (K_i rotated by φ)
```

`T` is perpendicular to the plane of incidence, so shrinking it elongates the kernel along
the plane of incidence (glossy streaks), most at mid roughness and grazing view; mirrors and
diffuse stay isotropic. The elongation function is ours (the chapter's is in a listing).
Each `X_i` is projected with the current view-projection; the tap reads the pixel it lands
in (`textureLoad`); a tap landing on the centre pixel or off-screen gets weight 0; screen
offsets longer than `2·R_max_px` are scaled back.

**R-5 Radius (D2).**

```
R_w  = max( min( R_max_px · f_A · f_r(α) · pixSize(d),  c_h · h̃ ),  R_min_px · pixSize(d) )
f_A  = 1/(1 + A)                                    (GTC20 s.20–22)
f_r  = 1 (diffuse);  sqrt(saturate(α / 0.25)) (specular: 0 at mirrors, 1 from r = 0.5)
c_h  = 1 (diffuse);  tan(θ_L(α)) (specular: the lobe's footprint at the hit point)
h̃    = denormalize(centre ĥ of this pass's input)  (the filtered hit distance)
R_max_px = 30 · (H/1080), R_min_px = 1             tune: R_max [10, 60], R_min [0.5, 2], c_h diffuse [0.5, 3]
```

The `c_h·h̃` clamp gives contact hardening: GI and reflections of nearby geometry stay sharp
(RTG2 p.830 lists hit distance as a radius input; GTC20 s.60 shrinks the radius for short
hits; the lobe-footprint form is ours).

**v0.1:** diffuse `R_max_px` = **45** at 1080p (v0: 30): test bed +0.17 dB (TASKS recurrent 3).
Projection of the taps per §5.1 v0.1 (affine).

**v0.2 (M3, M5):**

| item | v0.1 | v0.2 (built) | evidence |
|---|---|---|---|
| specular R_max | 30 px (in flux) | **30 px** confirmed | 45 → 30: +0.13 dB `orbit`, +0.7 dB disoccluded |
| specular R_min | 1 px | **R_min · f_r(α)**: no floor on mirrors (`specularMinRadiusScale` 1) | +0.5 dB at r < 0.15 on `light` |
| occlusion radii | radiance | AO R_max **20 px**, R_min **2 px** for AO and SO (§8.2) | AO +0.35 dB, contact +1.3 |
| radius ∝ (1 + A)^−p, p < 1 | — | tried, not kept | −0.1 … −0.5 dB |

**R-6 Weights (D4).** `w = w_geom · w_normal · w_rough · w_hit` (RTG2 Eq. 49.2), each `W(x)`:

| weight | x | tolerance (tightens with A) | notes |
|---|---|---|---|
| geometry | `|dot(n, X_t − X)| / ‖X‖` | `τ_g = lerp(0.02, 0.005, A_n)` | plane distance (RTG2 p.841, Metro s.59); replaces GTC20's A_factor (D4d) |
| normal | `acos(dot(n, n_t))` | `θ_n = θ_L(α) · lerp(1, 0.25, A_n) + 1°` | g(A) = lerp(1, 0.25, A_n) (D4c); fast acos approximation is fine |
| roughness (spec) | `|r − r_t|` | `0.05 + 0.25·r` | our tolerance (GTC20 s.48 has another; RTG1 ch. 32 Eq. 14 a third) |
| hit distance | `|ĥ_t − ĥ|` | `τ_h = lerp(0.1, 0.5, r) · lerp(1, 0.5, A_n)` | D4b: our formula on normalized ĥ (a relative measure by construction); not in pre-blur |

Tune each tolerance's endpoints by ×[0.5, 2]. Sky taps: 0.

### 5.10 R5 `blur` and R6 `postBlur`

- R5: kernel R-3/R-4, rotated (D3b), radius R-5, weights R-6. Filters rgb and ĥ.
- R6: same, unrotated, radius scaled by how much the blur changed the signal (RTG2 §49.5.6):

```
δ    = |lum(blur) − lum(acc)| / (max(lum(blur), lum(acc)) + 1e-3)        (centre pixel)
R_w  = R5's R_w · lerp(0.5, 2.0, saturate(δ / 0.3))                       (D2c)
```

  Tune: base [0.25, 1], max [1, 3], δ₀ [0.1, 0.5]. R6's output is `H`, next frame's
  history (RTG2 p.830).
- **v0.2:** R5 uses 8 taps, R6 4 taps (§5.9 v0.2). The occlusion kinds measure δ on ĥ instead
  of luminance. A luminance weight in R5 (predicted relative noise k·f_r/√(1+A)) was tried for
  specular in M3 and removed (±0.1 dB, −1.7 dB at r ≥ 0.6), as in M2 for diffuse; a
  variance-guided (measured) luminance weight is untried (TASKS).

### 5.11 R7 `stabilize` (D10, D15)

Order: post-blur, then stabilization (RTG2 Fig. 49-3; D15 — GTC20 s.59's order is treated
as a slide artefact). Own history `S`, never fed back (RTG2 §49.5.7).

- Diffuse: reproject `S_prev_d` (C-6/C-7/C-8 with Catmull-Rom). Specular: surface and
  virtual fetches (virtual position recomputed with R-9 from `H_s`'s ĥ), blended by `m` from
  `data` (RTG2 p.831). Invalid → `S = H`.
- Clamp per channel to the 3×3 neighbourhood of `H` (geometry-valid neighbours):
  `w = γ_s·σ + β_s·μ`, `γ_s = lerp(1, 3, A_n)`, `β_s = 0.02·A_n` — "wider clamping if
  possible" (RTG2 Fig. 49-3) read as: wider once the pixel has a long, trusted history.
  Tune γ_s endpoints [0.5, 4], β_s [0, 0.05].
- `α_st = max(1/(1 + A), 1/(1 + N_stab))`, `N_stab = 7` (D10; tune [3, 31]); A is the
  signal's A after anti-lag (A_s for specular, so mirrors stabilize less).
- `S = lerp(clamp(S_prev), H, α_st)` for rgb and ĥ. Output = `S` (demodulated), or
  `S·ρ` / `S·E` written to separate output textures when `output = 'remodulated'`.
- No A reduction here (deviation from RTG2 §49.11, which runs anti-lag in this pass): our
  anti-lag lives in R4 (C-10), so A is written in one place and the blur radii of this
  frame already see the reduced A. A second, stabilization-based detector is a tuning
  option for later.

**v0.1 (R7 as built; TASKS recurrent 4, 7):**
- **Reuses R2's 2×2 validity** instead of re-running C-7: R2 stores the 4 tap-valid bits in
  `data` (§5.12), and R7 decodes them. Same reprojection, no second set of plane tests.
  Catmull-Rom when all 4 bits are set (C-8 v0.1).
- `N_stab = 7` kept: 3 / 7 / 15 measured about flat.
- Anti-lag is now in **two** places, R2 (C-10b) and R4 (C-10), both before the blurs; still
  none in R7.
- Specular: surface motion only (the virtual candidate measured −0.4 dB, §5.6 notes).

**v0.2 (R7 as built after M3):**

| item | v0 / v0.1 | v0.2 | evidence |
|---|---|---|---|
| specular history | surface + virtual fetch, blended by `m` | **surface fetch only** | the R7 virtual candidate has no validity test of its own; it cost 0.36–1.5 dB on `std540-orbit` replays; removing it (with storing `m·c_v`) gave live `orbit` 30.37 → 32.23, `glossy` 33.60 → 34.56 dB (per-frame mean). Keep virtual fetches only where a plane test and a confidence exist (R2) |
| history filter | Catmull-Rom (4-tap gated) | **bilinear for diffuse** (and occlusion), Catmull-Rom kept for specular | diffuse identical PSNR, −0.08 ms; specular bilinear −0.05 … −0.16 dB |
| 2×2 history taps | branchy | branchless (all loads in flight) | stabilize 0.78 → 0.56 ms joint |

### 5.12 `data` texture (D14)

`r32uint` per pixel: `A_d` (10 bits, fixed point A·16, max 63.94), `A_s` (10 bits), `m`
(12 bits unorm). Written by R2 (write-only), updated in place by R4 (read-write, which core
WebGPU allows for `r32uint`), read by R5–R7 and next frame's R2 (bilinear decode of 4 texels
for A). GTC20 s.20 hints at a normalized A; the fixed-point packing is ours.

**v0.1:** `m` shrinks to **8 bits** and the top 4 bits hold R2's 2×2 tap-validity mask for R7:
`A_d (10) | A_s (10) | m (8) | mask (4)`.
**v0.2:** the 8-bit field stores `m·c_v` (virtual amount × confidence), written for R7's
virtual candidate, which was then removed (§5.11). No pass reads it today; the bits are free
for a later use.

---

## 6. Decisions for the 16 open items (reblur.md §7)

| # | open item | decision | rationale | tune |
|---|---|---|---|---|
| D1 | pre-blur radius | **v0.1: 25 px diffuse** (v0 15; +0.10 dB), 10 px·f_r specular (at 1080p, scaled by H), static disk, A = 0 weights; clamped by `c_h·h̃` from last frame's denoised ĥ when available (guide texel accepted by a 5 % depth test) | densify without permanent contact bias; raw hitT too noisy to size kernels | [0, 30] / [0, 20] px |
| D2 | blur / post-blur radius | R-5: `max(min(R_max·f_A·f_r·pixSize, c_h·h̃), R_min·pixSize)`, f_A = 1/(1+A), **v0.1: R_max 45 px diffuse** (v0 30; +0.17 dB), 30 px specular (v0.2: confirmed), R_min 1 px (**v0.2:** specular R_min·f_r, none on mirrors; occlusion AO R_max 20 px, R_min 2 px); post-blur × lerp(0.5, 2, sat(δ/0.3)) | GTC20's 1/(1+A); hit distance as a physical footprint (lobe at the hit); post-blur grows only where the blur still changed things | R_max [10, 60]; post-blur [0.25–1, 1–3, δ₀ 0.1–0.5] |
| D3 | Poisson disk, rotation | 8 antipodal golden-angle taps (table R-3) + centre; blur rotates by 4×4 Bayer + golden-ratio per frame; pre/post static. **v0.2:** 4-tap subsets (two antipodal pairs) for post-blur (both) and specular pre-blur; blur stays 8 | zero-mean set is safe unrotated; ALU only | falloff on/off |
| D4 | weights | W(x) = smoothstep(0,1,sat(1−x)) for all; geometry plane distance τ_g 2 %→0.5 %; normal θ_L(α)·lerp(1, 0.25, A_n) + 1°; roughness 0.05 + 0.25r; hit-distance on ĥ, lerp(0.1, 0.5, r)·lerp(1, 0.5, A_n); θ_L from our GGX derivation, E = 0.75; FB simple dominant fit with α | one shape everywhere (RTG2 Eq. 49.3); tolerances tighten with A (RTG2 p.841) | endpoints ×[0.5, 2]; E [0.5, 0.9]; r vs α in the fit |
| D5 | hit distance | rational `ĥ = h/(h + a + b·d)`, a = 1, b = 0.05; main ĥ accumulates with the signal's A; responsive copy in `F` (cap A_fast = 3) for confidence and virtual motion; ĥ filtered by every pass except pre-blur, with the same weights as radiance; "mix input with reprojection" = the fast history | never clips far hits; AO/SO for free; one curve | a [0.25, 5], b [0, 0.2] |
| D6 | disocclusion | τ = 1 %; all math in previous view space; pairwise-averaged normal; backface reject; **v0.1: Catmull-Rom if the 4 inner taps pass, clamped to their range** (v0: all 16) | removes the frame-of-reference ambiguity; the clamp makes the outer-ring test unnecessary | τ [0.5 %, 1.5 %] |
| D7 | history fix | A_fix = 3; levels base + 3; start L = floor(3·sat(1 − A/A_fix)·ρ + 0.5), ρ = r for specular; 3×3 tent at level L; viewZ weight with τ_fix = 2 %·2^L; fall to finer level if normalized weight sum < 0.25; full replacement | RTG2 p.829 (3×3, viewZ only, 1–3 frames), GTC20 s.35 (start level) | A_fix [2, 6]; τ_fix [0.5 %, 5 %]; sum [0.1, 0.5] |
| D8 | variance clamping | history fix: 3×3 of fast luminance, **v0.1: γ = 1 standard error** (v0: γ = 2 spreads; +0.37 dB), luminance-only clamp; stabilization: 3×3 of post-blur output, w = γ_s σ + β_s μ widening with A; "faster history" = `F` with A_fast = 3 | fast history makes the window track recent lighting; the window is the noise of the 3×3 mean; widening = "wider if possible" | γ [0.5, 2]; γ_s, β_s ranges above |
| D9 | anti-firefly | clamp centre luminance to 1.5× the second-largest of 8 valid neighbours in history fix; skip specular r < 0.25 | rank-conditioned in spirit; no energy removed unless the centre is an extreme outlier | k_ff [1, 4] |
| D10 | stabilization speed | α = max(1/(1+A), 1/8) (N_stab = 7), uses the signal's A after anti-lag | lag bounded by the clamp; mirrors (low A_s) stabilize less | N_stab [3, 31] |
| D11 | anti-lag | C-10: fast/slow relative luminance excess beyond γσ/√N, and ĥ excess; confidence `c = min(c_I, c_H)`; `A ← lerp(min(A, A_fast), A, c)`; runs in history fix. **v0.1: plus C-10b**, a current-frame detector in R2 (3×3 mean of the pre-blurred input vs reprojected history in standard errors, floor A_fast) | renderer-independent; C-10b catches the first frame of a change (dev light switch +2–3 dB) | γ [0.5, 2]; e_max [0.2, 1]; ĥ tol [0.1, 0.4]; A_fast [2, 7]; C-10b σ [2, 5] |
| D12 | virtual motion | confidence R-10 (footprint validity × normal × roughness × fast-ĥ agreement); A post-increment. **v0.2 (built):** curvature-corrected virtual distance h̃/(1 + 2κh̃) (D12c, +1.0 dB `glossy`); clamp R-11 always on with window γ(1 + 2c_v)σ, γ = 1 (v0: μ ± 2σ, strength by c_v); bilinear virtual fetch; no virtual candidate in R7 | prose properties of RTG2 §49.8.2; listing not used | tolerances in R-10/R-11 |
| D13 | checkerboard | not supported in v0 | PLAN §1 non-goal | — |
| D14 | storage of A | `data` r32uint: A_d, A_s as 10-bit A·16, **v0.1: m 8-bit unorm + 4-bit 2×2 validity mask for R7** (v0: m 12 bits; v0.2: holds m·c_v, unread); read-write in history fix | fits the 4-storage limit and the memory budget | — |
| D15 | specular pass order | post-blur → stabilization (RTG2) | later, more detailed source | — |
| D16 | motion vectors | 2D NDC motion + optional 2.5D `motionZ` + viewZ + matrices → Xp (C-3, C-6); no 3D world motion input | the API and captures carry 2D/2.5D; 2.5D is NRD's recommended mode too | — |

Other recurrent constants: `A_cap = 31` (C-9; 15 / 63 measured flat), `A_fast = 3` (C-10),
`R_max = 45 px` diffuse / 30 px specular / 20 px AO (R-5), `N_stab = 7` (D10; 3 / 15 flat),
`A_fix = 3` (D7), tap counts 8 / 8 / 4 (pre-blur diffuse, blur, post-blur; specular pre-blur 4).
M3 re-swept A_cap 15 / 63 and N_stab 3 / 15 for specular: ±0.2 dB or worse, kept.

---

## 7. Shadows (M4) — as built (v0.1, v2 in v0.2)

Replaces the FFX shadow denoiser's weak points measured in `docs/specs/temporal.md`
(binary visibility, blur feedback drift, no penumbra sizing). **v0.1:** this section was an
outline in v0; it now describes `ShadowDenoiser` (`src/shadow.ts`, `src/shaders/shadow.ts`,
registry id `shadows`) as built and tuned in M4. Each item gives the v0 value where it
changed. Tuning log: M4 §3 (960×540, paths `orbit light thin object` (+`pan`), per-frame
mean); tables: M4 §2 (1080p, 7 paths). **v0.2:** the v2 defaults (72abd13, 090db19; M4 §10,
ranked on pooled PSNR, pooled penumbra and FLIP) are folded in as v0.2 notes in §7.4–7.9.

**Result** (1080p, 7 paths, pooled; M4 §10.1):

| | PSNR | penumbra | disoccluded | FLIP | flicker | ms (fastest of 4 solo runs) |
|---|---|---|---|---|---|---|
| FFX shadows | 31.20 (33.57) | 23.50 | 32.91 | 0.038 | 0.0053 | 0.50–0.61 |
| ours, v1 (v0.1 defaults) | 36.55 (38.88) | 28.11 | 33.19 | 0.018 | 0.0035 | 0.48–0.58 |
| **ours, v2** (defaults) | **37.11** (39.34) | **28.57** | **34.68** | 0.018 | 0.0033 | 0.48–0.59 |

Better than FFX on every path (+4.9 … +8.9 dB pooled), including disoccluded regions on average
(level on `pan` and `cut`). v0.1's weak spot, the first frames after a reset, is mostly closed:
on the `std1080-orbit` reset replay v2 scores 35.42 vs FFX 35.40 pooled (v1 34.25); FFX is still
0.2–0.5 dB ahead on frames 0–2, ours from frame 3 on (M4 §10.2).

**v0.4 note: v2.1, v2.2 and the 2026-10-25 decisions** (short; §7.1–7.8 still describe v2, the full
rewrite is pending; M4 §11–12 have the numbers):
- **v2.1 (reset fix, M4 §11):** the history clamp window uses only the 5×5 taps that pass a normal
  test (`clampGeometry` true, at least `clampMinTaps` 3, else the full window), widened by
  `clampEdgePx` 2 next to hard edges; the young-history mean runs over the first `youngFrames` 8
  frames with weight tapering by `youngTaper` 0.25 (replaces `youngSpan`); "fresh" = a per-pixel
  frame counter since the pixel was new, not A. 1080p, 7 paths: 38.12 / penumbra 29.05 / disoccluded
  35.33 / FLIP 0.0129 (v2: 37.11 / 28.57 / 34.68 / 0.0182); frame 2 after a reset now above frame 1
  on the real scene. Cost +0.07…0.14 ms (temporal 0.42–0.47).
- **v2.2 (moving shadows, M4 §12):** a fifth pass, `stabilize`: a short history of the final output,
  reprojected, clamped to the 3×3 min / max of this frame's spatial output, blended by `stabilize`
  0.25, gated by the 3×3 range (`stabilizeBox` 0.05 at 1080p, × 1080 / height) and with an anti-lag
  on the clamp distance (`stabilizeAntiLag` 64); penumbra tiles only; never feeds back (RTG II
  §49.5.7 prose). Knot-shadow boil 0.0062 → 0.0013 (FFX 0.0011); 1080p 38.22 / penumbra 29.16 /
  FLIP 0.013; `light` −0.19 dB. **0.55–0.72 ms**, **48 B/px** (+16 B per tile).
- **2026-10-25 decisions (§12):** `uniformSnap` default `'change'` (item 5; the v2.1 / v2.2 numbers
  above were taken with `true`); the numeric `antiLag` (§7.4) is now `antiLagGain` (default 64, old
  name a deprecated alias); cost target ~0.75 ms (v2.2 meets it).

### 7.1 SH-1 Inputs

`visibility` ∈ [0, 1] (fractional kept end to end, never thresholded), occluder distance `h`
(`hitDistance`, 0 = unoccluded), and the light (`ShadowInputs.light`, or the `light` option;
one light per instance, RTG1 ch. 19 also filters per light). Missing light or missing `h` →
SH-6 fallback.

### 7.2 SH-2 Penumbra width

Mehta 2012 Eq. 13 rewritten for a hit distance (derivation in `sources/shadows-specular.md`
§A2): `W = R · g` with **`g = h / max(D − h, 1e-3·D)`** for a sphere light of radius R at
distance D from the receiver; `W = tan(θ_L) · g` with `g = h` for a directional light of
angular radius θ_L. Floor 1 px: ours. M12's floor term is 1/(kµ·Ω_x^max), a little over one
pixel footprint (correction from `reviews/shadows-provenance.md` row 1). M12 measures d1, d2
along a planar light's normal and uses a Gaussian σ; we use ray lengths and the sphere
radius, and the tuned radius factor 0.75 (§7.5) absorbs the scale.

**v0.1: the history stores `g`, not `W_eff`** (M4 §7.3). `g` is light-size free, so a light
that changes size takes effect at once (`light` path shrinks the light at frame 72). `g` is
accumulated over the pixel's **occluded** samples only, with its own sample count `n_g`
(cap 7: our design, untuned).

### 7.3 SH-3 Nearest occluder, tiles

8×8 tiles. The temporal pass's workgroup is one tile, so the tile statistics come for free:
`atomicMin` of `g` over pixels with an estimate and `atomicOr` of flags (fractional history;
any raw occluded; any raw lit) in workgroup memory (v0 had a separate `tiles` pass first).
A small `tiles` pass then, per tile, takes the minimum `g` over its 3×3 tiles and builds the
indirect list of **active** tiles: those whose 3×3 neighbourhood holds a fractional history
or raw samples that disagree. Only active tiles run the spatial passes (TR19 slide 72;
H18 §4.1). Tile skip is worth ~0.5 ms (each spatial pass 0.33 ms on `orbit` without it).

`g_eff`: pixels with their own estimate take `min(own, 3×3-tile min)` (v0's "nearest occluder
wins"; `mergeMin`, +0.13 dB); pixels without one take the tile minimum; none → 0 (1-px
radius). **Terminators** (no own estimate and `n·l < sin θ_light`, i.e. the light partly
below the receiver's horizon; visibility follows n·l there) get a fixed **16 px** radius
(6 px within noise, 32 px −0.7 dB). The patent-described remedy in shadows-specular.md G2
is not used.

### 7.4 SH-4 Temporal (raw visibility, no blur feedback)

Accumulates **raw** visibility with the shared core's reprojection (C-6/C-7, affine form:
plane distance linear in the tap pixel, temporal 0.40 → 0.31 ms) and a neighbourhood clamp.
The spatial output never re-enters the history (FFX's compounding blur drifts ~1 dB). Per
pixel, with μ, σ the mean and spread of the **5×5 raw** visibility (12×12 shared tile):

```
v_H   = reprojected history (Catmull-Rom when the 4 taps are valid, clamped to them)
win   = 0.4·σ + 0.05                                   (v0: 1·σ)
v_c   = clamp(v_H, μ − win, μ + win)
A_hist ← lerp(A_hist, min(A_hist, 0), saturate(64·|v_c − v_H|))   anti-lag restart (new)
if σ == 0: v_c = μ                                     uniform snap (new), A kept
cap   = clamp(1 · W_px², 1, 15)                         W_px from the accumulated g (new)
A     = min(A_hist, cap) + 1                            (0 after a disocclusion)
v     = lerp(v_c, v_raw, 1/(1 + A))
```

v0.1 changes, with the measurement (M4 §3, §7):

| item | v0 | v0.1 | evidence |
|---|---|---|---|
| clamp window | μ ± 1·σ (γ = 1) | **μ ± (0.4·σ + 0.05)**, about 2 standard errors of the 25-sample mean | the big step: about +2 dB (M4 §7.1; +2.5 dB overall, +1.7 dB penumbra in the shadows agent's LESSONS entry). Binary 1-spp samples give σ ≈ 0.5 in any penumbra, so a 1σ window never fires there and moving shadows lag through it. 0.3σ / 0.5σ: −0.25 / −0.11 dB. Blue-noise samples make the 5×5 mean accurate enough (same lesson as recurrent C-10) |
| anti-lag | — | **restart**: a history the clamp moved by ≥ 1/64 restarts at `A_hist = 0` (the clamped value counts as one frame) | restart at 0 instead of 1: +0.9 dB, penumbra +0.45 (31.77 / 24.48 → 32.65 / 24.93); from 1, the 1/n decay left a visible ~1 % residue after a light flip. Gains 8 / 32 / 64: 30.47 / 31.11 / 31.18 |
| uniform snap | — | where all 25 samples agree (σ = 0) the history takes their value exactly | measured on the per-frame mean: `pan` 39.9 → 50.6 dB (its last 17 frames have no shadow: exact frames score 120 dB), other paths −0.00 … −0.06. **Pooled, it is a loss**: −0.06 dB (v1), −0.18 dB and penumbra −0.31 (v2), better FLIP (0.0182 vs 0.0198). Review item 5 |
| history cap | A_cap = 15 | 15 **and** `1·W_px²` per pixel | each reprojection resamples the history, so A frames blur a narrow penumbra by ~√A px. Cap 31: −1.3 dB. k = 1 / 0.25 / 0.0625 on `orbit`: +0.54 / +1.00 / +1.45 dB before the clamp change, within ±0.1 dB after it; k = 1 kept |
| history fetch | bilinear | Catmull-Rom (C-8 v0.1) | +0.65 dB on `orbit` |
| stored | v, W_eff, A | v, g, A, n_g (`rgba16float`) | §7.2 |

The young-history radius boost `× (1 + k/(1 + A))` lost (k = 0.5 / 1 / 2: −0.01 / −0.05 /
−0.18 dB; also worse on `std1080-orbit`): `freshBoost`, default 0.

**v0.2 (v2, M4 §10):**

| item | v0.1 | v0.2 (built) | evidence |
|---|---|---|---|
| fresh pixels (A = 0) | 1-spp sample into the spatial passes | **the spatial passes' input mixes in a geometry-weighted 5×5 mean of raw visibility** (`youngMean` 0.75): taps within 2 % of the receiver's plane, gated off where the pass-0 radius ≤ 1 px (hard edges); depths loaded per fresh pixel (bit-identical to a shared depth tile, half its cost); **the history stays raw** | idea from RTG2 §49.5.4 prose (a pre-averaged neighbourhood stands in for the 1-rpp input where history was discarded). On top of the radius blend (§7.5): reset replays (std540 mean, pooled / penumbra) 33.78 / 25.68 → 33.92 / 25.93, `std1080-orbit` 35.34 → 35.47 (frame 0 33.7 → 34.4), live 960×540 33.30 / 25.54 → 33.37 / 25.64; the same mean weighted k/(1+A) lost live (33.13) |
| which pixels count as fresh | — | **A = 0 only** (`youngSpan` 1) | spans 2 / 3 lose live (−0.3 / −0.5 dB at 960×540): the W_px² cap and anti-lag restarts keep many penumbra pixels short-lived for good, so "short history" ≠ "new" |
| `uniformSnap` | on / off | adds **`'change'`**: snap only where the history sits outside the clamp window (after a real change) | lands between on and off on every metric (960×540: 34.31 / 26.45 / FLIP 0.0297 vs on 34.26 / 26.35 / 0.0286, off 34.34 / 26.52 / 0.0309). Default stays on; review item 5 |
| `maxScaleHistory` (sample cap of g and E) | 7, untuned | 7, **rationale recorded** | 3 / 7 / 15 flat (±0.01 dB); 7 ≈ a 1/√8 standard error on g while still following a moving occluder within 8 frames |
| tried, not kept | — | young mean on every short history (weight k/(1+A)), into the history, over 7×7 / 9×9; 8 extra taps for young pixels; young radius boost | each worse live or no gain (M4 §10.3) |

### 7.5 SH-5 Spatial

Two passes over the active tiles, each SPEC's 8-tap disk (R-3) on the receiver's tangent
plane (axis T along the light direction projected on the plane), per-pixel animated Bayer
rotation (D3b) with a different angle per pass. Radius `R = 0.75 · W_eff · lerp(1, 0.5, A_n)`,
the second pass `0.5·R`, floor 1 px, axes ≤ 48 px at 1080p (our design, untuned). Weights:
plane distance (2 %) × normal (30°).

| item | v0 | v0.1 | evidence |
|---|---|---|---|
| radius | `1·W_eff` | **`0.75·W_eff`** | radius 0.5 / 1.5 / 2 / 3·W on `orbit`: +0.12 / −0.37 / −0.81 / −1.71 dB vs 1·W; 0.75 vs 1·W after the clamp change: 31.18 → 31.64 dB (4-path mean). The true profile is S-shaped; a disk as wide as the penumbra rounds its ends |
| shrink at full history | lerp(1, 0.5, A_n) | same | 1 / 0.25: −0.28 / −0.01 dB |
| anisotropy (stretch by 1/(n·l) along the light) | M4 experiment | built, **off** | −2.7 dB (cap 4), −1.4 (with radius 0.5), −0.26 (cap 2 + radius 0.5): on these scenes the extra length is extra blur (M12 Eq. 12 reading) |
| normal weight | 30° | kept | off saves ~0.04 ms but costs −4.1 dB |
| plane 1 % / normal 20° | — | 2 % / 30° kept | ±0.00 dB |

One spatial pass instead of two: 0.42 vs 0.47 ms on `orbit`, quality not measured in full.

**v0.2 (v2, M4 §10):**

| item | v0.1 | v0.2 (built) | evidence |
|---|---|---|---|
| radius | `0.75·W_eff·lerp(1, 0.5, A_n)` (occluder-sized only) | **mean of the occluder-sized and the noise-sized radius**: `R = ½·0.75·W_eff·lerp(1, 0.5, A_n) + ½·32 px·E` (`noiseBlend` 0.5, `noiseRadius` 32 px at 1080p), E = SH-6's H18 noise estimate, now also computed in the hit-distance path, accumulated like g and stored in the geometry texture's unused 8-bit roughness slot (no memory added) | found when the noise-only fallback beat the occluder sizing on reset replays (std1080-orbit 35.06 vs 34.25). Blend 0.25 / **0.5** / 0.75 / 1: replays 33.52 / **33.78** / 33.82 / 33.46, live 33.19 / **33.30** / 33.26; noise radius 16 / 24 / **32** / 48 / 64 px live 33.22 / 33.37 / **33.45** / 33.46 / 33.34 (flat around blend × radius ≈ 16 px). Why: on 1-spp blue noise the fresh-pixel error is pixel-scale noise in the outer half of penumbrae, where lit samples carry no occluder estimate and the tile minimum sets a small radius; E sizes exactly those regions. 1080p, 7 paths: v2 vs v1 +0.56 dB pooled, +0.46 penumbra, +1.49 disoccluded |
| pass 0 input | the rgba16float history | **the temporal pass's unfiltered r32float copy** | needed by the fresh-pixel mean (§7.4); halves pass 0's tap bytes (`thin` spatial0 0.17 → 0.13 ms) |
| `maxRadius` 48 px | untuned | 48, **rationale recorded** | 24 / 48 / 96 identical on the test bed: a safety cap on the 8 taps' cache footprint for very wide penumbrae |
| pass-2 rotation offset | "a different angle" | **2 − φ ≈ 0.382 turn** (`pass1Phase`), the golden angle: pass 2's angle never repeats pass 1's in this frame or the next | 0 / 0.25 / 0.382 / 0.5 within 0.012 dB; 0.5 ≡ 0 (antipodal disk) |
| 4-tap second pass; no normal weight in pass 2 | — | tried, **removed** | no time saved (pass bound by per-pixel setup and centre loads), −0.23 dB; −2.5 dB for 0.025 ms |

The directional-light path (W = tan θ_L · h) has been exercised once on images, through a stand-in
(the sphere light handed over as a directional light of equal angular radius): it runs clean and
scores between the noise-only fallback and the true sphere light (960×540, 5 paths: 32.99 vs
32.76 / 33.45 pooled); the −0.46 dB to the sphere is the D/(D − h) geometry a directional light
doesn't have (M4 §10.7). A real sun capture is still missing (TASKS).

### 7.6 SH-6 Fallback without `h` or light (built; v0: "later")

Noise-driven radius from Heitz 2018 (§4.2 Eq. 29 for E; §4.1 for σ ∝ E and the 3×3 box):
E = total variation of the second derivative of raw visibility along 4 lines through the
pixel on the 5×5 tile (no random offset), in [0, 1], accumulated over time like g instead of
the paper's 3×3 box; radius = **24 px · E** (at 1080p). The pixel's own E only: tile minima of E are
~0 at every penumbra edge (−0.9 dB with the tile minimum). 960×540, 5 paths: 32.21 / 24.40 dB
vs 32.62 / 24.90 with hit distance (12 px: 31.65; 48 px: 32.22; v1, per-frame mean). Cost not
re-measured (one slow-clock run: 0.73 vs 0.47 ms).
**v0.2:** the fallback radius is `noiseRadius` = **32 px · E** (v1: 24; 24–48 were flat for the
fallback alone, 32 is best in the v2 blend, §7.5), and E now also feeds the hit-distance path.
With v2 the fallback scores 32.76 / 25.00 pooled vs 33.45 / 25.73 with hit distance and light
(960×540, 5 paths).

### 7.7 SH-7 Renderer contract (documented, not enforced)

Unjittered shadow-ray origins (TR19 slides 55–62); blue-noise light samples animated with the
golden-ratio sequence (RTG II ch. 24 §24.7.2) for a scalar per pixel, and with the R_n
sequence (Roberts 2018) for 2-D samples: equal golden-ratio steps on every dimension put a
pixel's samples over time on a line (LESSONS, results; reviewer note). The test bed's
blue-noise sampler is what the clamp window (§7.4) relies on.

### 7.8 Budget as built

4 dispatches: `temporal` (with the tile statistics folded in) → `tiles` → `spatial` × 2
(indirect). Storage textures: temporal 4, spatial 1. **40 B/px** (v0 estimate ≈ 32): history
2 × 8 (`rgba16float`), own geometry ping-pong 2 × 8 (`rg32uint`), T 4 and output 4
(`r32float`: unfiltered copies the inactive tiles need), plus 12 B per 8×8 tile; 83 MB at
1080p. Sharing the diffuse/specular prepass instead would save the geometry pair but cost
0.18 ms when shadows run alone (M4 §7.7). Cost per pass (fastest run, `orbit`): temporal
0.31 · tiles 0.005 · spatial 0.08 + 0.08. Levers left: one unfiltered copy instead of two,
`shader-f16`, fewer taps in pass 2 (TASKS).
**v0.2 (v2, M4 §10.4):** memory unchanged (40 B/px; E rides in the geometry texture). Cost
**0.48–0.59 ms** (fastest of 4 solo runs; FFX 0.50–0.61), the same as v1 within ±0.015 ms;
`thin`, the penumbra-heaviest view, 0.59 (temporal 0.33 · tiles 0.005 · spatial 0.13 + 0.12;
`youngMean: 0` saves ~0.025 ms for −0.07 dB if a strict ≤ 0.6 matters). The three v0.1 levers:
a 4-tap pass 2 saved nothing; one unfiltered copy instead of two needs a per-tap tile lookup and
loses on this load-latency-bound GPU; `shader-f16` not tried (passes aren't ALU bound).

### 7.9 Later (not specified)

Heitz 2018 ratio estimator for glossy receivers; a real directional-light (sun) capture (the
code path is exercised only through the stand-in of §7.5 v0.2: TASKS). **v0.3:** translucent
shadows (M8) are specified in §7.10.

### 7.10 Translucent shadows (M8) — specified, not built (v0.3)

_Spec only. Builds on shadows **v2.2** as committed (results/M4.md §12; `src/shadow.ts` header):
`temporal` (raw visibility → history `(v, g, A, n_g)` rgba16float, geometry ping-pong, tile
statistics, unfiltered copies) → `tiles` → `spatial` × 2 (indirect, penumbra tiles) → `stabilize`
(indirect), 48 B/px, 0.55–0.72 ms at 1080p. §7.1–7.8 still read as v2; the v2.1 / v2.2 additions
(normal-tested clamp window, young mean over 8 frames, output stabilization) are assumed below._

**Sources.** TR19 slides 47–53 (up to 3 translucent layers; any-hit order is non-deterministic,
so each layer subtracts 1/3 of the visibility, which is order independent; an opaque hit ends the
ray at 0; slide 53 shows the result next to opaque shadows). RTG1-25 §25.2.1 pp. 444–445 (PICA
PICA: keep tracing toward the light through transparent hits, accumulate absorption from each
surface's albedo, thin-film approximation, no distance-based absorption; stop on an opaque hit, a
miss or full absorption; Fresnel with a total-internal-reflection-corrected Schlick; filtered with
the same SVGF-derived filter as opaque shadows). Neither says how a **coloured** shadow is
filtered (shadows-specular.md gap G5). Native: `SIGMA_SHADOW_TRANSLUCENCY` takes `IN_PENUMBRA` and
`IN_TRANSLUCENCY` and writes `OUT_SHADOW_TRANSLUCENCY` (nrd-provenance §3.3–3.4); it costs 0.45 ms
vs 0.40 for the opaque denoiser (RTX 4080, 1440p, §3.1), and NVIDIA's notes claim "translucent
shadows match opaque ones" since v4.7.0 (nrd-releases.md). Behaviour targets only; nothing about
how.

#### 7.10.1 Signal and renderer contract

**M8-1 What the renderer writes per pixel (one shadow ray, per light).**

| input | meaning | format |
|---|---|---|
| `visibility` v | **opaque** visibility, as today: 1 = the ray reached the light past every opaque surface | unchanged |
| `hitDistance` h | unchanged: distance to the opaque blocker where v = 0 | unchanged |
| `translucency` T (new) | RGB transmittance of the translucent layers the ray crossed, `T = Π_i t_i`; (1, 1, 1) when it crossed none; **ignored where v = 0** | rgba16float / rgba8unorm (rgb) |
| `translucencyHitDistance` h_τ (new, optional) | distance to the **nearest** translucent layer with `min_c t_i,c < 1`; 0 = none | r16float / r32float |

- **Layers multiply, so order doesn't matter.** `Π t_i` commutes like TR19's subtraction, so an
  any-hit shader can accumulate layers in whatever order the traversal reports them; `min` (for
  h_τ) commutes too. Subtraction is exact only for identical layers; multiplication is exact for
  any colours (our choice; TR19's `1/3` rule stays available to a renderer as the scalar special
  case `T = max(0, 1 − k/N)`).
- **Per layer:** `t_i = (1 − α_i) + α_i·κ_i`, with α_i the layer's coverage (alpha) and κ_i its
  transmission colour (thin film, RTG1-25), optionally times `(1 − F)` (RTG1-25's TIR-corrected
  Schlick). Renderer side; the denoiser only sees T.
- **Early out and layer cap.** When `max_c T_c < 0.01` the ray counts as **opaque**: v = 0, h = the
  distance of the layer that crossed the threshold (TR19's "full shadow after N hits", with a
  colour-aware threshold). A renderer may cap layers at N for cost (TR19: 3); past the cap it
  treats the ray as opaque. Test bed: no cap.
- Contract only (documented, not enforced), like SH-7.

**M8-2 The denoised quantity: opaque visibility and a conditional transmittance.** The shading
needs the mean of `v·T` over the light's samples. We split it exactly:

```
E[v·T] = P(v = 1) · E[T | v = 1] = E[v] · τ,      τ := E[T | v = 1]
```

The v2.2 pipeline keeps denoising **v** unchanged; a new 3-channel **τ** is accumulated **only over
samples that reached the light** (weight v), the way g is accumulated over occluded samples only
with its own count n_g (§7.2 v0.1). Output `S = v̂·τ̂`. Rationale: (1) the product of the two
estimates is unbiased for the product's mean (a product of two plain spatial means would not be,
wherever opaque and translucent blockers overlap, e.g. a window frame's penumbra over its own
glass shadow); (2) every opaque decision (penumbra sizing, clamp window, snap, restarts, tiles,
stabilization box) stays on the scalar it was tuned on, and with T ≡ 1 the v output is
**bit-identical** to `ShadowDenoiser` v2.2 (regression test, M8-10); (3) inside a uniform glass
shadow every sample has v = 1 and the same T, so τ is exact after one frame and needs no
filtering. Rejected: denoising `S_rgb = v·T` as one RGB signal (the scalar clamp / snap / box
logic would need an RGB redesign and the opaque path would change); denoising v and T
unconditionally (biased product).

**M8-3 Penumbra footprint: one footprint, nearest blocker of either kind.** The penumbra width of
a coloured shadow's edge is set by the distance to the translucent layer, so translucent samples
feed g like occluded ones: a sample contributes `g` (§7.2, from h_τ) when v = 1 and
`1 − min_c T_c > ε_τ`, `ε_τ = 0.01` (tune [0.002, 0.05]); occluded samples keep using h (opaque
results unchanged). The tile minimum and `mergeMin` (§7.3) then make the sharpest blocker win
(M12's principle), whatever its kind. Without `translucencyHitDistance`, translucent samples
contribute nothing to g and their edges take the noise-sized radius (§7.5 v0.2's E term), which is
already half the v2 radius blend. τ uses exactly the same spatial taps and weights as v (one
footprint; RTG1-25 filters translucent shadows with the opaque filter).

#### 7.10.2 Passes (deltas to v2.2)

**M8-4 `temporal`: τ history with conditional accumulation and its own clamp.** New history
`(τ_r, τ_g, τ_b, n_τ)`, reprojected with v's 2×2 footprint and validity (custom-weighted
**bilinear**: τ is smooth, Catmull-Rom is not worth 4 more loads; tune). Per pixel:

```
τ_H, n_τ   = reprojected τ history (invalid footprint → n_τ = 0, τ_H = 1)
μ_τ, σ_τ   = per-channel mean / spread of raw T over the 5×5 taps with raw v = 1
             that pass v2.1's normal test (the clamp window's taps); ≥ 3 taps, else no clamp
τ_c        = clamp(τ_H, μ_τ − win_τ, μ_τ + win_τ),  win_τ = 0.4·σ_τ + 0.05   (v's window form, SH-4)
n_τ        ← lerp(n_τ, 0, saturate(64·max_c |τ_c − τ_H|))                    (v's restart gain)
if v_raw > 0:  τ = (n_τ·τ_c + v_raw·T_raw) / (n_τ + v_raw);  n_τ ← min(n_τ + v_raw, N_τ)
else:          τ = τ_c                                                         (nothing to learn: the sample was blocked)
N_τ = 7 (tune [3, 15]; the same rationale as maxScaleHistory, §7.4 v0.2)
```

The clamp is what follows a **moving glass panel** (no motion vector moves its shadow over a static
receiver): the same mechanism as v's, on the same taps. Fractional v (several rays) weights the
sample. The unfiltered copies the spatial passes read widen from r32float to rgba16float `(v, τ)`.

**M8-5 `tiles`: a translucency flag.** The temporal pass also `atomicOr`s two more tile bits, the
analogues of v's: "raw T samples with v = 1 disagree" (some attenuated by more than ε_τ, some not,
or different colours) and "τ history differs from this frame's raw T by more than ε_τ". A tile is
**τ-active** if its 3×3 tile neighbourhood has either bit. The indirect list becomes v-active ∪
τ-active tiles, with a per-tile mode flag: a τ-only tile runs the τ part of the spatial and
stabilize passes and passes v through; a v-only tile skips τ. Elsewhere `τ̂ = τ` from the
temporal pass (exact inside a uniform glass shadow, white where there is no glass). Cost then
scales with the coloured shadow's edge area, as v's does with the penumbra (TR19 slide 72's tile
skip).

**M8-6 `spatial` × 2: visibility-weighted τ.** Same taps and weights w_i as v (disk, radius from
g_eff and E, plane and normal tests):

```
τ̂ = Σ w_i·v_i·τ_i / Σ w_i·v_i      (v_i = this pass's input visibility; Σ w·v < 1e-4 → τ̂ = τ_centre)
```

This is the ratio of the filtered `v·τ` to the filtered v under identical weights, so `v̂·τ̂`
equals the spatially filtered product wherever v̂ comes from the same taps (our design; the ratio
form follows the same reasoning as H18's ratio estimator, §7.9). Blocked taps carry no colour
information and get no say.

**M8-7 `stabilize`: one blend weight for both.** The stabilization history becomes rgba16float
`(S_r, S_g, S_b, v)` (was r32float v). v2.2's blend weight (box-width gate from v's 3×3 range,
clamp-distance anti-lag) is computed from v as today and applied to all four channels; S's
channels are clamped to their own 3×3 min/max. No separate box for colour (tune: a per-channel
gate if stained-glass textures boil).

#### 7.10.3 API, resources, cost

**M8-8 API** (additive; no NVIDIA names):

```ts
interface ShadowInputs {
  visibility: GPUTexture; hitDistance?: GPUTexture; light?: ShadowLight;   // unchanged
  translucency?: GPUTexture;             // rgb transmittance T of the sample (ignored where v = 0)
  translucencyHitDistance?: GPUTexture;  // nearest translucent layer, 0 = none
}
new ShadowDenoiser(device, { translucency: true });   // structural: compiles the τ channel
```

- With `translucency: true` the output is **rgba16float `(v̂·τ̂ rgb, v̂)`**: rgb is what the shader
  multiplies the light by, alpha the opaque visibility (for consumers that want the grey shadow,
  and for the opaque regression). Without it: r32float v̂ as today. Valid until the next dispatch.
- `translucency: true` with no `translucency` texture in a frame = T ≡ 1 (output rgb = v̂).
- TSL: `realtimeShadows(..., { translucency: node })` returns the rgb output; the node's `.visibility`
  gives alpha. `denoiser/three` owner decides the exact shape.

**Resources (estimate, not built).** v2.2 48 B/px + τ history ping-pong 2 × 8 (rgba16float) +
the two unfiltered copies widened r32float → rgba16float (+4 + 4) + stabilization ping-pong widened
(+8) = **≈ 80 B/px** (≈ 166 MB at 1080p). Opaque-only instances stay at 48.

**Storage textures.** v2.2's temporal pass already writes 4 (geometry, history, two copies); the τ
history makes 5, over WebGPU's default limit of 4. **M8-9:** with `maxStorageTexturesPerShaderStage
≥ 5` (the test bed and examples request min(8, adapter), common on desktop and Apple GPUs), use the
fifth texture. Otherwise pack `(v, g, A, n_g, τ_r, τ_g, τ_b, n_τ)` as 8 f16 in **one rgba32uint
history** (`pack2x16float`); it is unfilterable, so v's Catmull-Rom history takes 16 `textureLoad`s
(as the occlusion kinds do, §8.2) or falls back to bilinear (−0.65 dB on `orbit` in M4 §3 — measure
the 16-load cost first). Review item 14.

**Cost (estimate).** Temporal: + one 8 B history load/store, raw T in the 12×12 tile (3 more
channels), per-channel statistics: +0.08–0.15 ms on every frame (the temporal pass runs full
screen). Spatial and stabilize: +40–60 % per τ-active tile (one more 8 B load per tap). On a path
with large glass shadows **≈ 0.70–0.95 ms** vs v2.2's 0.55–0.72; without translucent tiles
≈ +0.1 ms. Native's translucency variant is +12.5 % over its opaque one; ours will be +20–35 %.
Target: ≤ 2× native `SIGMA_SHADOW_TRANSLUCENCY` on the same GPU (PLAN §8); M5 Pro guide ≤ 0.9 ms
on the glass paths.

#### 7.10.4 Test bed, metrics, native comparison

**M8-10 Evaluation.**

- **Scenarios** (test bed, analytic): `glass` — a thin coloured panel (κ = (0.9, 0.35, 0.2),
  α = 0.8, with an opaque frame) between the sphere light and the floor, static, camera orbit; a
  second, **nested** panel (blue-green) overlapping the first, to check order independence (the
  overlap must show the product colour) and nested penumbrae; a stripe texture on α for spatial
  colour detail. `glass-moving` — the panel slides and rotates over a static receiver with a
  static camera (no motion vector follows the shadow; the M4 §12 case), plus a frozen control
  (`glass-still`) for boil. Later: a real-scene capture (a window or stained glass in
  `examples/three-temporal`).
- **References:** `shadow_rgb_ref` = 256-spp mean of `v·T` per pixel (same estimator), and
  `visibility_ref` = the mean of v as today.
- **Metrics** (pooled, SPEC §13): RGB PSNR of S with the scalar tonemap per channel (clamp to
  [0, 1]; S is a transmittance, so CAPTURE-FORMAT's Reinhard rule for RGB radiance doesn't apply);
  penumbra region (any channel of the reference in (0.02, 0.98)); **tint region** (reference
  chroma `max_c − min_c > 0.02`) with a chroma error (mean |S/Σ S − ref/Σ ref| there); FLIP; the
  dynamic region, flicker, tPSNR and **boil** on `glass-moving` / `glass-still` (§13). Plus the
  **opaque regression**: with T ≡ 1 the v channel must be bit-identical to v2.2, and on `glass` the
  v channel scores against `visibility_ref` like v2.2 does on its paths.
- **Baselines:** v2.2 run on `v·lum(T)` as a scalar (what a caller without M8 would do: correct
  luminance, no colour); FFX shadows likewise; `accumulate-32`.
- **Native:** `SIGMA_SHADOW_TRANSLUCENCY` on the same captures, packed by the harness from
  `visibility`, `occluder_dist`, `transmittance` (CAPTURE-FORMAT v1, §11) with native's own front
  end (harness builder, rule 4), scored against `shadow_rgb_ref` with the same tonemap. Probe P7
  (TASKS).

**CAPTURE-FORMAT v1 additions (proposed; the capture owner writes them):** `transmittance` (3 ch,
T of the 1-ray sample; (1, 1, 1) where none), `translucent_dist` (1 ch, h_τ), `shadow_rgb_ref`
(3 ch). v0 readers ignore them.

## 8. Occlusion (M5) — as built (v0.2)

**v0.2:** v0.1 had an outline (O-1…O-4). This section now describes `OcclusionDenoiser`
(`src/occlusion.ts`; recurrent signal kinds `ao` / `so` in `src/shaders/recurrent.ts`; SVGF on ĥ
via `src/shaders/occlusion.ts`) as built and tuned in M5, old → new → evidence. Tuning: M5 §4
(960×540 fast preset, 7 paths, pooled); tables: M5 §2 (1080p, 7 paths, pooled).

**Signal.** AO = ĥ of the renderer's 1-spp diffuse (cosine) ray, SO = ĥ of its specular (GGX
VNDF) ray, `ĥ = h / (h + a + b·d)` (F-3: a = `hitDistanceScale` 1, b = `hitDistanceViewScale`
0.05; miss → 1). Output: ĥ in `.r` (1 = open, → 0 at contact); `dispatchBoth` for AO + SO.
Test-bed references normalize **each** reference sample's hit distance, then average (the curve
is nonlinear: normalizing the mean hit distance would bias it). Region "contact" = reference
ĥ < 0.5.

**Result** (1080p, 7 paths, pooled; contact in brackets): AO / SO = recurrent 38.02 (31.09) /
37.37 (33.47), SVGF 38.93 (33.53) / 38.76 (35.66), A-SVGF `auto` (anti-lag v1) 39.05 (34.14) /
39.52 (36.37). **SVGF beats the recurrent mode on every path for both signals.** The recurrent
mode is the memory-lean option and flickers least on static views (`light` AO 0.0005 vs 0.0015).
Cost and memory: §10.

### 8.1 O-1 "Free" AO/SO from the radiance filter

Design unchanged: `recurrent`'s radiance outputs keep the denoised ĥ in alpha (GTC20 s.9, s.54,
s.63), diffuse and specular. **v0.2, measured:** 35.15 / 35.47 dB, i.e. 2.9 / 1.9 dB below the
dedicated recurrent mode on the same rays, with twice its AO FLIP (0.039 vs 0.020) and a dark
bias (−0.008). Why (M5 §4): no ĥ clamp in the radiance history fix (worth 0.85 dB in the
occlusion mode), radii tuned for radiance (AO wants 20 px, not 45), and a history shortened by
luminance-driven anti-lag. Making the alpha as good would change the radiance output (ĥ steers
the radiance blur's radius and hit-distance weight), so it stays a preview. PLAN §1's "occlusion
nearly free on top of the radiance filter" holds for cost, not for quality.

### 8.2 O-2 Recurrent occlusion-only mode (`filter: 'recurrent'`; the default until v0.4, opt-in since)

The recurrent passes with the radiance channels dropped. The radiance kinds compile to the same
WGSL as before (generated code diffed over 6 configurations).

| item | v0.1 | v0.2 (built) | evidence |
|---|---|---|---|
| passes | the same 8 | **7: no pre-blur.** The temporal pass normalizes the raw hit distance on load | ĥ is never pre-blurred anyway (GTC20 s.60, §5.4) |
| storage | one rgba16float pool `(ĥ_d, ĥ_s, –, –)` for both signals | **one r32float rotation set per signal** | core WebGPU has no r16float / rg16float storage format; same 8 B/px for two signals, 4 for one. r32float is unfilterable, so the Catmull-Rom history takes 16 `textureLoad`s |
| memory | ≈ 62 B/px (both) | AO **57.5**, AO + SO **73.5** | §10.1 |
| anti-lag | ĥ detector only | ĥ only, in both detectors (C-10, C-10b); in the history fix the **slow ĥ itself is clamped into the fast window** (radiance only shortens A from the ĥ excess) | clamp +0.85 / +0.35 dB AO / SO |
| SO reprojection | — | virtual motion (R-9…R-12, §5.6) as for specular radiance, and **the fast ĥ follows the virtual fetch**, weighted `m·c_v` (radiance keeps it surface-reprojected) | SO +0.9 dB, `pan` +2.5. A clamp toward a fast history must use the reprojection of the value it clamps (LESSONS) |
| radii | radiance (45 / 30 px) | **AO R_max 20 px**, **R_min 2 px** for both (SO R_max 30) | AO +0.35 dB, contact +1.3. At 1080p the same plateau (AO 10 / 20 / 40 px: 38.03 / 38.02 / 37.72) |
| other constants | radiance | radiance (A_cap 31, A_fast 3, tap counts, N_stab 7, tolerances) | history cap 15 / 63, hit tolerance, anti-lag σ, fast cap, post-blur taps, N_stab: ±0.1 dB or worse; a radius clamp by hit distance was flat and removed |

Weakest spot: SO at mid roughness (0.35–0.6: −2.2 dB vs SVGF), where the specular ray mixes near
hits and misses. Cost 1.32 ms per signal, 2.39 joint: only ~35 % below the recurrent radiance
diffuse filter (2.02 ms), because per-tap geometry loads and plane tests dominate every pass and
only the pre-blur goes away. Untried levers: bilinear history instead of the 16-load Catmull-Rom
(temporal 0.47 ms), 4-tap blur, a single-signal fast history as r32float (−8 B/px).

### 8.3 SVGF on ĥ (`filter: 'svgf'`, new in v0.2; the default since v0.4, with `antiLag: 'off'` by default)

Not in v0.1. A normalization pass (`HitDistanceNormalizer`, also exported for a noisy AO / SO
preview) writes ĥ as a gray rgba16float image; the unchanged SVGF pipeline (§4) filters it with
ĥ as luminance. Retuned for a smooth, bounded scalar:

| parameter | radiance default | occlusion default | evidence (fast preset, pooled AO / SO) |
|---|---|---|---|
| σ_l | 4 | **1.5** | 36.12 / 34.78 → 37.57 / 36.08 (σ_l 1: +0.05, flat) |
| à-trous iterations | 5 | **3** | with σ_l 1.5: 37.93 / 36.24 |
| α_min | 0.2 | 0.2 AO, **0.3 SO** | SO 36.24 → 37.15; AO prefers 0.2 |
| with `antiLag: 'auto'` | α_min 0.1 | 0.1 AO / 0.3 SO | 38.04 / 37.59 |

At 1080p the radiance defaults give 38.44 / 36.96 and the occlusion defaults 38.93 / 38.76:
fewer, tighter iterations keep contact detail. M5 ran the committed anti-lag **v1**; A-SVGF on ĥ
with v2: AO / SO 39.03 / 39.68 (REMEASURE §3). **Default `antiLag: 'off'`** (§12 item 2, set in
`resolveOcclusion`, not inherited from SVGF's `'auto'`): AO 0.1 dB below `'auto'` on the test bed and
0.1–0.3 dB above it on the real scene, SO 0.9 dB below, cheaper (results/OCCLUSION-ANTILAG.md).

### 8.4 Not adopted, not built, native comparison

- **O-3 AO radius: not adopted.** v0.1 set `h_scale = aoRadius` (b = 0) in occlusion mode. Built:
  the F-3 curve with b = 0.05 stays the default, so the occlusion signal is exactly the radiance
  filter's ĥ; `hitDistanceViewScale: 0` gives O-3's world-space radius. Which curve and scale look
  right as AO is review item 6.
- **O-4 SO from AO** (Lagarde & de Rousiers 2014 Listing 26): not built; no consumer yet.
- **Native.** No new capture buffer: the replay derives ao / so from `*_hitt`. Native's occlusion
  denoiser normalizes hit distance with its own curve and parameters, so PSNR against our
  references is not a fair comparison until probe P3 (TASKS) returns native's curve as data.

## 8.5 SH/SG directional variants (M7) — specified, not built (v0.3)

_v0.2 said "not specified, waits for review item 1". v0.3 specifies M7 against the likely default
filter, **SVGF / A-SVGF** (item 1's recommendation), and lists what the recurrent filter would need
(§8.5.6). Nothing here is built or measured; every constant is a guess with a tune range._

**What it is for.** A plain denoised radiance is one value per pixel: it is correct for the normal
the filter used and nothing else. Two things go wrong on detailed surfaces. If the caller gives the
filter its **normal-mapped** normal, the normal weights reject neighbours across bumps and noise
stays; if it gives the smooth normal, the bump shading is averaged away. A **directional payload**
stores, per pixel, a low-order function of direction ("each pixel an irradiance probe", ID25 s.20),
filtered with the smooth normal and evaluated afterwards with the detailed one. ACS25 s.62 shows the
gain on a shipped game ("much more details and better directionality"); SD24 and ACS25 also reuse
the payload as a light source for other materials and for rough specular (SD24 p.37, p.55; ACS25
s.65).

**Sources.** SD24 p.30 (GI encoded as SH in 64 bits: L1 luma in YCoCg-Y, chroma as L0), p.37
(light colour, intensity and direction extracted from the SH; chroma rescaled by the evaluated luma),
p.55 (SH evaluated at the roughness-bent reflection direction for rough specular); ACS25 s.57–62
(L1 for Y, L0 for CoCg, 6 × 8 bit + a 16-bit max magnitude, denoised by a recurrent-blur denoiser,
evaluated per pixel with the full-resolution normal); ID25 s.20–22 (2-band SH, 3 × RGBA16F, one
irradiance probe per pixel, bilateral spatial filter with normal / depth / hit-distance weights, a
counter-based temporal filter; cites Ramamoorthi & Hanrahan 2001); Ramamoorthi & Hanrahan 2001
(irradiance from the first SH bands: the clamped cosine's band factors π and 2π/3); Malvar & Sullivan
2003 (YCoCg); Pettineo's SG series parts 3–4 (SG irradiance and the L1 ringing comparison; the NDF as
an SG and its warp to the reflection direction, after Wang et al. 2009). The SD24 slides print
Ubisoft's encoding code with no license: we read the description and write our own (our encoding is
different anyway, M7-2). Native: the `*_SH` denoisers take an SH input packed by native's front end
and need an application-side resolve; "for an apples-to-apples image comparison, use
`NRD_SG_ExtractColor`" (nrd-provenance §3.4). The release notes (nrd-releases.md, v4.1.0) describe
the switch from an SH to an SG resolve ("higher quality & specular-compatible") as a **resolve**
change, plus re-jittering for upscalers; we know nothing about native's payload beyond that.
Published cost: SH variants 1.33× (REBLUR, 3.40 vs 2.55 ms) and 1.48× (RELAX, 4.80 vs 3.25 ms) their
plain versions (RTX 4080, 1440p; nrd-provenance §3.1, nrd-releases v4.17.3).

### 8.5.1 Payload

**M7-1 L1 SH with Y directional and CoCg as L0 (6 channels), world space.** Per pixel:

```
Y(ω)  = a + b·ω                    a: scalar, b: 3-vector (the L1 band, constants folded in)
Co, Cg                             chroma, no direction
YCoCg (Malvar & Sullivan 2003):  Y = ¼R + ½G + ¼B,  Co = ½R − ½B,  Cg = −¼R + ½G − ¼B
                                 R = Y + Co − Cg,    G = Y + Cg,     B = Y − Co − Cg
```

- **Why SH and not SG as the payload.** Every pass of both filter families is a weighted mean (EMA,
  à-trous, bilinear history taps, mip averages). SH coefficients are linear in the radiance, so a
  weighted mean of payloads is exactly the payload of the weighted mean: the filters run unchanged
  on more channels. An SG's axis and sharpness are not linear: averaging two lobes' parameters is
  not the lobe of the average, so every pass would need a re-fit, and a mixture needs several
  lobes. SGs earn their place at **resolve** time, where a lobe is fitted once from the filtered L1
  data (M7-10; Pettineo part 3's error analysis favours SG over L1 for the cosine lobe's tail).
- **Why L1 and not L2.** 4 coefficients per channel vs 9; L1 is what all three shipped recipes use
  (SD24, ACS25, ID25) and what fits our memory budget (below). L2 is not specified.
- **Why chroma as L0 (6 channels) and not RGB L1 (12).** The directional detail a normal map reveals
  is mostly a luminance change; chroma as L0 halves the cost (SD24, ACS25 ship it). It loses
  **coloured directionality** (a bump facing a red wall does not get redder). `payload: 'sh-rgb'`
  (12 channels: a, b per RGB channel; two rgba32uint per copy) is the option; review item 10 decides
  the default on the coloured-bounce scene (M7-13).
- **World space**, not tangent or view space: incident directions don't change under camera motion,
  so reprojection needs no SH rotation.

**M7-2 Per-sample encoding: L1 of the sample's clamped-cosine lobe, renormalized to be exact at the
sampling normal (our design).** The renderer samples a cosine lobe around a normal `n_s` (the normal
it shades with, usually the normal-mapped one) and returns demodulated radiance L along ω (the
plain diffuse input, CAPTURE-FORMAT). That sample's unbiased contribution to the demodulated
diffuse value at any other normal n' is `L·max(0, n'·ω) / (n_s·ω)`; its L1 projection replaces
`max(0, n'·ω)` by `¼ + ½·(n'·ω)` (Ramamoorthi & Hanrahan's band factors: π·Y₀₀² = ¼, (2π/3)·Y₁² = ½).
Scaling the projection so that it is exact at `n' = n_s` gives, with `c = n_s·ω`:

```
a_i = L_Y / (1 + 2c),      b_i = 2·L_Y·ω / (1 + 2c),      Co_i = L_Co,  Cg_i = L_Cg
check:  a_i + b_i·n_s = L_Y    (every sample, so the payload evaluated at n_s has the plain filter's mean)
```

- **Exact at the sampling normal.** The payload resolved at the normal the rays were sampled around
  reproduces the plain diffuse signal in expectation, so SH mode can be regression-tested against
  the plain filter (M7-13) and never changes the mean on smooth surfaces.
- **Bounded weights.** `1 + 2c ∈ [1, 3]`, `|b_i| ≤ 2·L_Y`. The textbook projection of radiance
  (`π·L·Y_lm(ω)/c` for cosine sampling) has a 1/c weight with infinite variance at grazing rays.
- **What it gets right.** Uniform sky over the upper hemisphere: expected payload
  `Y(n') = L·(0.451 + 0.549·n'·n_s)` vs the true `L·(0.5 + 0.5·n'·n_s)` (a normal tilted 90° gets
  0.45 L vs 0.5 L; the plain filter says L). A light at the sampling normal: exact at n_s, L1's
  usual smoothing elsewhere. The derivation is ours; the alternative estimators (the textbook
  projection with `max(c, 0.1)`, SD24's constant weights) are the tune set.
- Tune on captures: encoding ∈ {normal-exact (default), textbook with c floor 0.1}.

**M7-3 Storage: 8 × f16 in one `rgba32uint` per pixel per buffer** (`pack2x16float`, core WGSL;
`rgba32uint` is a core storage format). Layout `(a, b.x, b.y, b.z, Co, Cg, s0, s1)`: two spare halves
for what the plain buffer kept in alpha (SVGF: A in `accum`, σ in the à-trous ping-pong; recurrent:
ĥ). One storage binding and one 16-byte load per tap instead of two textures, which keeps every
SVGF pass within the 4-storage-texture default. Unfilterable, which costs nothing in SVGF (bilinear
history from 4 `textureLoad`s, C-8; `historyFilter: 'catmull-rom'` would take 16 loads in SH mode).
Not 8-bit: an EMA history quantized to 1/254 of a shared magnitude stalls on small increments
(α ≥ 1/64). Tune: SD24 / ACS25's 64-bit packing (6 × 8-bit snorm + f16 magnitude in `rg32uint`) for
the **renderer input** and the non-accumulating à-trous ping-pong only, checked against an f16 run
(ML25 p.34's quantized-vs-reference check).

### 8.5.2 Input contract

**M7-4 Two accepted input forms, plus guides.**

| form | what the caller passes | who encodes |
|---|---|---|
| encoded (recommended for renderers) | `sh` texture: the M7-2 payload, `rgba32uint` 8 × f16 (6 used), or `rg32uint` 64-bit packed (M7-3 tune) | the renderer, per sample (it knows n_s) |
| raw (replay, simple renderers) | `radiance` (rgb, demodulated, as today) + `direction` (rgb, world-space unit ω of the sampled ray) | the denoiser, on load in the temporal pass, with `n_s = guides.detailNormal ?? guides.normal` |

- `guides.normal` = the normal the **filter** uses for its weights. In SH mode the caller should
  pass the **smooth** (geometric or interpolated vertex) normal here: that is the whole point.
  `guides.detailNormal?` (new, additive in `FrameGuides`) = the normal-mapped shading normal the
  rays were sampled around; used by raw-form encoding and by the fused resolve (M7-9).
- Demodulation as today (CAPTURE-FORMAT): diffuse divided by albedo; specular by E evaluated with
  the **detail** normal (the normal the renderer shaded with). The caller remodulates after the
  resolve.
- Rays below the geometric surface (possible when sampling around a bumped normal): the renderer
  returns L = 0 for them (energy loss, a renderer issue); the payload of L = 0 is zero.
- `hitDistance` unchanged (SVGF ignores it).
- **CAPTURE-FORMAT v1 additions (proposed; the capture owner writes them):** `diffuse_dir` and
  `specular_dir` (3 ch: world ω of each sampled ray), `normal_geom` (3 ch: smooth normal for the
  filter; `normal` stays the shading normal the rays used), `diffuse_sh_ref` / `specular_sh_ref`
  (6 ch: the 256-spp mean of the M7-2 payloads, which is exact because the payload is linear). The
  replay encodes from `diffuse` + `diffuse_dir`; the native harness packs native's SH input from the
  same two buffers with native's front end (harness builder, rule 4). v0 readers ignore them.

### 8.5.3 Filtering (SVGF / A-SVGF)

**M7-5 The guide luminance is the payload evaluated at the filter's normal, in Rec. 709.** Every
scalar SVGF uses (moments, variance, `w_l`, A-SVGF gradients, the anti-lag λ) reads

```
l = lum709( RGB( Y(n_g), Co, Cg ) ),   Y(n_g) = a + b·n_g,   n_g = guides.normal;   l ← max(l, 0)
```

On smooth surfaces `n_s = n_g` and l has the plain filter's mean and noise, so σ_l = 4, the
variance thresholds and anti-lag v2's floors carry over without retuning (they were tuned on 709
luminance). On bumpy surfaces the smooth normal keeps bump shading out of the weights. Rejected:
L0 (`a`) alone (scale-biased, and blind to the noise in b); YCoCg's Y (a different luminance than
the one every constant was tuned on). Moments stay `rg32float` (l, l²).

**M7-6 All six channels are filtered with the same weights.** One weight per tap (`w_z·w_n·w_l`, plus
specular's lobe and roughness terms), applied to `a, b, Co, Cg` alike: exact, because the payload is
linear (M7-1). Variance propagation (`σ²' = Σh²w²σ²/(Σhw)²`) stays on l only. No per-coefficient
weights: b is noisier than a, but giving it its own weights would make the filtered function
inconsistent across coefficients (a direction from one footprint, a magnitude from another).

**M7-7 Per-pass changes.**

| pass | change in SH mode |
|---|---|
| prepass | unchanged (`G` from `guides.normal`) |
| temporal (S-1) | encode on load (raw form); reproject and accumulate all six with α_c; `accum` = rgba32uint (A in s0); moments from l |
| variance (S-2) | spatial variance from each tap's l; writes σ into s0 of the ping-pong |
| à-trous (S-3) × 5 | weights from l and σ as today; six channels averaged |
| last à-trous | writes the **output payload** (M7-8), or the fused resolve (M7-9) |
| A-SVGF gradient passes | unchanged, fed l (strata means of l_cur and l_hist) |
| remodulation | not in the denoiser in SH mode (the caller remodulates after the resolve); `remodulate: true` + `resolve: 'fused'` multiplies the resolved rgb |

**M7-8 Output payload: resolve-ready.** The last pass (it has n_g) writes
`(a', b'.x, b'.y, b'.z, ρ_Co, ρ_Cg, Y_g, –)` with:

```
Y_g    = a + b·n_g                                         value at the filter's normal (= the plain result's Y)
b'     = b · min(1, k·max(Y_g, 0) / max(|b|, 1e-6))         value-preserving ringing guard, k = 1 (tune [0.5, 2])
a'     = Y_g − b'·n_g                                      so a' + b'·n_g = Y_g exactly
ρ_Co, ρ_Cg = clamp( Co / max(Y_g, ε), −2, 2 ), clamp( Cg / max(Y_g, ε), −2, 2 )    ε = 1e-4
```

The guard keeps Y ≥ 0 for every normal within 60° of n_g (|n' − n_g| ≤ 1) without changing the
value at n_g; k = 1 leaves a uniform sky untouched (|b|/Y_g ≈ 0.55) and trims b on young, noisy
pixels. Chroma is stored as a ratio to Y_g, so a resolve needs only the detail normal and colour
follows the evaluated luma (SD24 p.37 rescales chroma by the evaluated luma the same way; our
reference value is Y_g instead of L0). |Co/Y|, |Cg/Y| ≤ 2 bound the non-negative RGB gamut.

### 8.5.4 Resolve

**M7-9 Diffuse resolve (the caller's step, or fused into the last pass).**

```
Y(n_d)   = max(0, a' + b'·n_d)                              n_d = detail normal
rgb      = max(0, RGB( Y(n_d), Y(n_d)·ρ_Co, Y(n_d)·ρ_Cg ))
optional sharpening, s ∈ [0, 1] (default 0; tune [0, 1]), needs Y_g and n_g:
  ambient + one light from the L1 data (the clamped cosine's L1 is ¼ + ½·cos, so a light I·max(0, n·d)
  contributes (¼I, ½I·d)):   I = 2|b'|,  d = b'/|b'|,  A = max(a' − ½|b'|, 0)
  Y_sh(n)  = A + I·max(0, n·d)                               full clamped cosine instead of its L1 band
  Y(n_d)   ← lerp( Y(n_d),  Y_sh(n_d) · Y_g / max(Y_sh(n_g), ε),  s )     renormalized: exact at n_g
```

The light extraction is the idea of SD24 p.37 (a light direction and intensity from the L1 luma);
the decomposition and the renormalization are ours. Sharpening restores the contrast L1 loses when
a bump turns toward a light (a normal turned fully toward a light at angle θ from n_s gets
`3cos θ / (1 + 2cos θ)` of the true value under M7-2) at the risk of overshoot on mixed lighting. `resolve: 'fused'` runs this in the last
à-trous pass with `guides.detailNormal` and writes rgba16float rgb (8 B instead of 16).

**M7-10 Specular resolve: a ratio resolve with SG lobes (fused by default).** L1 is far too wide for
glossy lobes (its features are ~90° wide), which is why the shipped recipes use SH only for rough
specular (SD24 p.55: r ≥ 0.9, faded from 0.7; ACS25 s.65) and why NVIDIA's notes call the SG resolve
"specular-compatible". Ours uses the payload only for the **ratio** between the detail and the guide
lobe, so model error moves bump detail, never the mean:

```
specular payload: M7-2 with n_s replaced by the sampling lobe's dominant direction D_s (R-2, from the
  detail normal, roughness and view), c = D_s·ω; exact at D_s. M7-5's l and M7-8's Y_g / guard use
  D_g (R-2 from the guide normal) in place of n_g, so where the two normals agree it is the plain value
lighting model from (a', b'): ambient A and an SG light (axis d, sharpness λ_l, amplitude matching I)
  λ_l = 8 (tune [2, 32]): a delta would make bumps sparkle; the SG gives the extracted light a size
lobe response R(n) = ∫ (warped NDF SG of n, α, v) × (A + SG light): NDF as an SG of sharpness 2/α²,
  warped to the reflection direction with sharpness / (4|n·v|) (Pettineo part 4, after Wang et al. 2009),
  SG inner product for the light, A·(lobe integral) for the ambient
S(n_d)   = S_g · clamp( R(n_d) / max(R(n_g), ε), 0, ρ_max )         S_g = the payload at D_g (plain value), ρ_max = 4 (tune [2, 8])
roughness fade: below r = 0.2 (tune [0.1, 0.4]) the ratio fades to 1 (L1 has no information at mirror scales)
```

Fused by default for specular (`resolve: 'fused'`): the denoiser's last pass has n_g, roughness and
v, and the caller then only needs `guides.detailNormal`. The fade and the λ_l / ρ_max ranges are
guesses for the bumpy-floor scenario (M7-13).

**M7-11 Helpers for callers who resolve themselves** (`resolve: 'none'`, the diffuse default; review
item 11):

- WGSL source export `SH_RESOLVE_WGSL` with `shResolveDiffuse(p: SHPayload, nDetail, sharpen, nGuide)`
  and `shResolveSpecular(p, nDetail, nGuide, view, roughness, opts)`, and `shUnpack(texel)`, so
  renderers can resolve inside their own material shaders (SD24's "use the SH as a light source for
  any BSDF" case).
- `ShResolver` (compute helper: payload texture + detail normal [+ roughness] → rgba16float).
- TSL: `realtimeShResolve(node, { normal, mode: 'diffuse' | 'specular', sharpen })` in
  `denoiser/three` (owner of that package decides the shape).
- Re-jittering for upscalers (native's v4.1 / v4.17 notes) is out of scope: our outputs are at the
  pixels' sample positions, like the plain filters' (CAPTURE-FORMAT jitter convention).

### 8.5.5 API, resources, cost

**M7-12 API** (additive; no NVIDIA names):

```ts
new DiffuseDenoiser(device, { filter: 'svgf', payload: 'sh' });        // 'radiance' (default) | 'sh' | 'sh-rgb'
new SpecularDenoiser(device, { payload: 'sh', resolve: 'fused' });     // resolve: 'none' | 'fused'
new DiffuseSpecularDenoiser(device, { payload: 'sh' });                // both signals, per-signal resolve option
// inputs: DiffuseInputs | SpecularInputs gain   sh?: GPUTexture   or   direction?: GPUTexture (with radiance)
// guides: FrameGuides gains   detailNormal?: GPUTexture
```

- `payload` is structural (pipelines differ). `payload: 'sh'` without `sh` or `direction` in a frame
  is an explicit error. Output: the M7-8 payload as rgba32uint (`resolve: 'none'`) or resolved
  rgba16float (`'fused'`, requires `guides.detailNormal`; without it the resolve uses
  `guides.normal` and equals the plain filter). Valid until the next dispatch, as today.
- `filter: 'recurrent'` with `payload: 'sh'`: not supported until §8.5.6 is built (error).
- `OcclusionDenoiser`: no directional variant (native's directional occlusion is a separate
  denoiser we don't plan; PLAN §1).

**Memory (estimate, SVGF, per signal; plain values in brackets):** `accum` ping-pong 2 × 16 (2 × 8),
moments 2 × 8 (same), à-trous ping-pong 2 × 16 (2 × 8), output 16 SH / 8 fused (8) = **96 / 88 B/px**
(56). With the shared `G` pair + depth slope (20): diffuse alone **116 / 108** (76); diffuse +
specular **212 / 196** (132), +8 with anti-lag v2 (**220 / 204**; plain 140). The 64-bit à-trous
packing (M7-3 tune) would save 16 per signal (joint 188 / 172 with anti-lag). `'sh-rgb'`: about +48
per signal. PLAN §8's 100 B/px is a target for the plain filters; native's SH memory isn't in our
sources (its README table is off limits), so probe P6 asks the harness for native's reported
allocation (the integration reports memory usage, nrd-releases v3.4.0).

**Cost (estimate):** every SVGF pass is load-bound; SH doubles the bytes per tap and adds a few ALU
for l. Diffuse alone ≈ 2.9–3.4 ms (plain 2.11–2.18 on the dev page), joint ≈ 5.4–6.4 ms (plain
4.00 bench, 4.23 with `'auto'`): **1.35–1.6×**, in line with native's published 1.33× / 1.48×.
Target: ≤ 1.5× our plain filter on the same bench, and ≤ 2× native `*_SH` on the same GPU (PLAN §8).
The fused resolve adds ~0.02 ms to the last pass and saves the caller a full-screen pass.

### 8.5.6 What the recurrent filter would need (not specified in detail; review item 12)

- **Buffers:** every rotation buffer becomes 16 B (rgba32uint, ĥ in s0): diffuse 4 × 16 = 64 B/px
  (32 plain); mip atlases with six channels (the atlas reuses a free rotation buffer, so no extra
  memory); diffuse SH **≈ 105.5 B/px** (73.5), joint **≈ 169.5** (105.5). `F` (luminance + ĥ) and
  `data` unchanged.
- **Catmull-Rom history** (R2, R7) on an unfilterable rgba32uint costs 16 loads; or keep two
  filterable rgba16float textures per buffer, which pushes R2 to 6 storage textures (needs the
  adapter's limit of 8, or split dispatches per signal).
- **Clamps on a function, not a colour:** C-10's luminance clamp already scales every channel by
  `L_c/L_s`, which keeps the direction; use it for all six. R7's per-channel clamp to the 3×3 of H
  must become the same luminance-ratio clamp (clamping b's components independently would rotate
  the direction). The anti-firefly scales all six by the same factor.
- Virtual motion, radii, ĥ: unchanged (geometry only). The luminance for detectors: M7-5's l.
- SD24 and ACS25 ship exactly this combination (L1 YCoCg through a recurrent-blur denoiser), so
  it is known to work; it is not specified further until item 1 keeps recurrent.

### 8.5.7 Test bed, metrics, native comparison

**M7-13 Evaluation.**

- **Scenarios** (test bed): `bumpy` — a normal-mapped floor and wall (procedural bumps with an
  analytic detail normal; amplitudes of 10–40°) lit by the sphere light, a coloured area light and
  the sky, slow orbit; **coloured bounce** — a red and a green wall next to the bumpy floor (YCoCg
  vs RGB, item 10); the seven existing paths in SH mode with `normal_geom = normal` (the
  **regression**: resolved at the guide normal, SH must score within 0.05 dB of the plain filter
  pooled, since M7-2 and M7-5 make them equal in expectation; any larger gap is a bug or f16 loss).
- **References:** (1) `diffuse_sh_ref` resolved **the same way** as the output (same normal, same
  guard and sharpening): measures the denoising error alone; (2) `diffuse_ref` rendered with rays
  around the detail normal (the plain converged signal at n_d): measures the total error, L1
  truncation included. Reference (2) is the one where SH must beat plain radiance on `bumpy`.
- **Contenders on `bumpy`:** plain SVGF with `guides.normal` = detail normal; plain SVGF with the
  smooth normal; SH SVGF (smooth normal + resolve at n_d) with s = 0 and s = 0.5; `accumulate-32`;
  OIDN 2 (E-2 route).
- **Metrics:** pooled PSNR of the resolved rgb vs (1) and (2); FLIP; flicker and boil; **detail
  band** in the bump mask (pixels with angle(n_d, n_g) > 5°): the band `x − G_2px(x)` (Gaussian
  σ = 2 px) of output and reference, its pooled PSNR and the energy ratio
  `Σ band_out² / Σ band_ref²` (1 = detail kept, < 1 = bumps smoothed away, > 1 = noise); **ringing**:
  the fraction of pixels where the guard trimmed b and where Y(n_d) hit the max(0, ·) floor.
- **Expected outcome** (to falsify): on `bumpy`, SH beats both plain variants on reference (2) and
  on the detail band (plain with the smooth normal: energy ratio well below 1; plain with the
  detail normal: above 1 and lower PSNR from rejected neighbours).
- **Native:** `REBLUR_DIFFUSE_SH` / `RELAX_DIFFUSE_SH` (and `_SPECULAR_SH` once M7-10 is built) on
  the same captures. (a) After native's colour extraction (`NRD_SG_ExtractColor`, nrd-provenance
  §3.4) vs our payload resolved at the **guide** normal, both against `diffuse_ref` (the PLAN §6
  comparison: a plain-equivalent image); (b) native's own diffuse resolve with the detail normal vs
  ours at n_d, against reference (2), on `bumpy` only. Probe P6 (TASKS).

**M7-14 Order of work** is in §11.

---

## 9. Output, remodulation, API notes

- Default output is **demodulated**: captures and metrics compare in that space, and callers
  usually composite with their own material terms. **v0.1:** built as `remodulate: false`;
  with `remodulate: true` the last pass multiplies by the caller's `inputs.demodulation`
  (diffuse: or `guides.albedo`), fused into the last à-trous iteration (svgf) or written to
  separate textures by R7 (recurrent). v0's `output: 'demodulated' | 'remodulated'` and
  in-denoiser E (F-2) were not built (§1.2).
- **v0.1:** `DiffuseDenoiser` / `SpecularDenoiser` return one texture each;
  `DiffuseSpecularDenoiser.dispatchBoth()` returns `{ diffuse, specular }` and `dispatch()`
  returns diffuse. The recurrent output texture rotates between internal buffers: valid
  until the next dispatch (the `TemporalDenoiser` contract), so callers must not cache it.
- AO/SO: in the outputs' alpha (O-1); recurrent diffuse only so far.
- **v0.2:** AO/SO: `OcclusionDenoiser` (§8) returns ĥ in `.r` (`dispatchBoth()` →
  `{ diffuse, specular }` = AO, SO); `HitDistanceNormalizer` gives the noisy ĥ as a gray image.
  The recurrent radiance outputs keep the denoised ĥ in alpha, diffuse and specular (a preview,
  §8.1). `ShadowDenoiser` returns r32float visibility, valid until the next dispatch. API
  questions are review item 8.
- **v0.3 (specified, not built):** `payload: 'sh' | 'sh-rgb'` and `resolve: 'none' | 'fused'` on the
  diffuse / specular classes, `sh?` / `direction?` inputs, `FrameGuides.detailNormal?`, resolve
  helpers (`SH_RESOLVE_WGSL`, `ShResolver`, a TSL node) (§8.5.5, M7-11/12);
  `ShadowDenoiser({ translucency: true })` with `ShadowInputs.translucency?` /
  `translucencyHitDistance?` and an rgba16float `(v̂·τ̂ rgb, v̂)` output (§7.10.3, M8-8). Review items
  10–14.

---

## 10. WebGPU resource plan

**v0.2:** refreshed with the latest measurements (M1 §12, M2-M3 §4, M4 §10.4, M5 §5). §10.1–10.2
are the allocation plans as built; §10.3 compares cost and memory with PLAN §8.

### 10.1 Recurrent (diffuse + specular)

Buffer rotation per signal (4 × `rgba16float`, W×H). At frame start: `P` = `H_prev`,
`Q` = `S_prev`; `R`, `S` free. Built exactly like this (`src/recurrent.ts`).

| pass | reads | writes | after the pass |
|---|---|---|---|
| R1 | P (ĥ guide) | R = `pre` | |
| R2 | R, P (reprojected) | S = `acc` | P free |
| R3 | S | P ← signal mip atlas | |
| R4 | S, P (atlas) | R = `fix` | P free again |
| R5 | R | P = `blur` | |
| R6 | P, S (centre) | R = `H` (next history) | |
| R7 | R, Q (reprojected) | P = `S_new` (next stabilization history) | next frame: P' = R, Q' = P |

| resource | format | count | B/px |
|---|---|---|---|
| signal buffers (diffuse, specular) | rgba16float | 2 × 4 | 64 |
| fast history `F` (both signals in one texture) | rgba16float | 2 (ping-pong) | 16 |
| `data` | r32uint | 2 (ping-pong) | 8 |
| `G`, `G_prev` | rg32uint | 2 | 16 |
| depth mip atlas | r32float | 0.375 | 1.5 |
| **total internal** | | | **105.5** (≈ 219 MB at 1080p) |
| optional remodulated outputs | rgba16float | 2 | +16 |

Diffuse only: 32 + 16 + 8 + 16 + 1.5 = **73.5 B/px**. Occlusion-only mode (§8.2): the rotation
set is r32float (4 × 4 B per signal), so AO **57.5**, AO + SO **73.5** (`F`, `data` and `G` as
above). Ready cut, not built: `F` at half resolution (−12 → **93.5 B/px** for diffuse + specular),
at some risk to the anti-lag window and the virtual-motion ĥ at edges. Inputs (caller-owned,
~32 B/px) are not counted.

Storage textures per dispatch: R0 1, R1 2, R2 4, R3 3, R4 3, R5 2, R6 2, R7 2 (4 with
remodulated outputs). Read-write storage only on `r32uint` (`data`), which core WebGPU
allows. No optional features required; `shader-f16` was measured and not kept (§10.3).

### 10.2 SVGF

As built (README): per signal `accum` ping-pong 16, `moments` (rg32float) ping-pong 16, à-trous
ping-pong 16, output 8 = **56 B** (+8 with `feedback: true`); shared `G` pair 16 + depth slope 4.
Diffuse + specular: **132 B/px** (148 with feedback). **v0.2:** anti-lag v2 adds **4 B/px per
signal** (gradient state 8 × f16 in one rgba32uint ping-pong + λ r32float, all at 1/9 resolution;
v1: ~7.6), so A-SVGF `auto` is **140 B/px**. Occlusion on SVGF adds a normalized-ĥ rgba16float
(8 B) per signal: AO 84, AO + SO 148 (+4 per signal with anti-lag v2).

Untested cut (review item 4c): the output could be the last à-trous iteration's ping-pong target
instead of its own texture (the recurrent filter's output already rotates under the same "valid
until the next dispatch" contract): −8 B/px per signal, 132 → 124 (140 → 132 with `'auto'`).

### 10.3 Measured cost and memory vs PLAN §8

PLAN §8 as written: diffuse + specular ≤ 4 ms and ≤ 100 B/px on the M5 Pro at 1080p; shadows
≤ 0.6 ms; ≤ 2× native on the same GPU; quality within ~0.5 dB of native. **As decided 2026-10-25
(§12 items 3–4):** ≤ 2× native binding, 4 ms on the M5 Pro a guide ± 10 %, ~140 B/px accepted for
the SVGF default, shadows ~0.75 ms. The last column judges against the decided targets.

| configuration | dispatches | GPU ms (1080p, M5 Pro) | B/px | vs targets |
|---|---|---|---|---|
| SVGF diffuse + specular (`antiLag: 'off'`, explicit) | 8 | **3.99** (bench, M1 §12.4) / 4.02 (dev page, M2-M3 §4) | 132 | within |
| A-SVGF diffuse + specular (`antiLag: 'auto'` v2, **default**) | 14 | **4.24** (bench; v1: 5.61 bench, 5.55 dev page) | 140 | within the guide (+6 %) and the accepted memory |
| recurrent diffuse + specular, shared dispatches (`filter: 'recurrent'`) | 8 | **3.99** test-bed bench median ([REMEASURE](results/REMEASURE-2026-10-25.md)); 4.44 dev page; 4.05 with `blurTaps: 4` (dev page; −0.07 dB, +5 % flicker) | 105.5 | within |
| recurrent diffuse alone / specular alone | 8 | 2.38 / 2.79 (dev page) | 73.5 / 73.5 | SVGF alone: 2.11–2.18 / 2.68–2.99 |
| explicit mix: recurrent diffuse + A-SVGF specular, shared prepass (the joint `filter: 'recurrent'` until 2026-10-25) | 21 | **4.79** test-bed bench median, anti-lag v2 ([REMEASURE](results/REMEASURE-2026-10-25.md); v1 dev page: 5.98) | ≈ 138 | 20 % over the guide |
| skeleton: 8 recurrent passes with trivial kernels, both signals | 8 | 0.85 | — | dispatch + centre I/O ≈ ⅕ of 4 ms |
| occlusion AO: recurrent / SVGF / A-SVGF `auto` (v1) | 7 / 7 / 13 | 1.32 / 1.37 / 2.16 (fastest clock) | 57.5 / 84 / 92 | no PLAN target |
| occlusion AO + SO joint: recurrent / SVGF / A-SVGF `auto` (v2) | 7 / 8 / 14 | 2.62 / 2.89 / 3.10 test-bed bench median ([REMEASURE](results/REMEASURE-2026-10-25.md); v1 8-frame replay min: 2.39 / 2.99 / 5.27) | 73.5 / 148 / 156 | no PLAN target |
| shadows (v2) | 4 | **0.48–0.59** fastest of 4 runs (`thin` 0.59); FFX 0.50–0.61 | 40 (+12 B per tile) | at target |
| shadows v2.2 (results/M4.md §12.6; §7's v2.1 / v2.2 note) | 5 | 0.55–0.72 fastest run (`thin` 0.72) | 48 (+16 B per tile) | within ~0.75 ms |
| _estimate, not built:_ SVGF diffuse SH (M7, §8.5.5) alone / + specular SH | 8 / 8 | ≈ 2.9–3.4 / ≈ 5.4–6.4 | 116 / 212 (fused output: 108 / 196; +8 with anti-lag v2) | SH target: ≤ 1.5× plain, ≤ 2× native `*_SH` |
| _estimate, not built:_ translucent shadows (M8, §7.10.3) | 5 | ≈ 0.70–0.95 on glass paths, ≈ +0.1 elsewhere | ≈ 80 | ≤ 2× native translucency |

The M5 Pro runs solo benches in two clock states (every pass ×1.3–1.8 in the slow one): M4 and M5
report the fastest run, M1 §12 the median of an uncontended round, M2-M3 the minimum of 400
frames on the dev page. They agree within a few % where they overlap. Joint SVGF numbers from the
8-frame `std1080-orbit` replay (M1 §6: 4.20 / 6.31 ms) overweight young histories and are
superseded by the bench.

**Same GPU as native** (v0.4; [native/results/PHASE4-5.md](native/results/PHASE4-5.md) "Cost"): RTX 3060
Laptop, clocks locked at 1200 MHz graphics / 7001 MHz memory (unlocked, the driver kept Chrome's work
at ≤ 780 MHz and our times were bimodal), `std1080-orbit`, GPU time around the dispatches, median of
frames 1–7, median of 3 runs. Our Chrome / Dawn submission adds 2.1–3.4 ms of wall time per frame
that the table leaves out (native: 0.1–0.15 ms).

| signals | ours (GPU ms) | native (GPU ms) | ours / native |
|---|---|---|---|
| diffuse + specular | `svgf` 5.35 · `recurrent` 5.48 · `svgf-auto` 6.09 · explicit mix 7.47 | REBLUR 5.38 (RELAX 7.24) | **1.00 / 1.02 / 1.13 / 1.39×** REBLUR (0.74–1.03× RELAX) |
| shadows | `shadows` 1.07 (`ffx-shadows` 0.96) | SIGMA 0.96 | **1.12×** |
| AO + SO | `occlusion-recurrent` 3.76 · `-svgf` 4.15 · `-svgf-auto` 4.95 | REBLUR occlusion 3.36 | **1.12 / 1.24 / 1.48×** |

Every configuration meets "≤ 2× native". Quality vs native: §0.2 (ours ahead at native's defaults,
integration caveat).

Levers, measured (TASKS, M2-M3 §4, M1 §12, M4 §10.4, M5 §5):
- **Recurrent** 7.00 (first virtual motion) → 4.44 ms joint: dead options removed, bilinear
  virtual fetch, 10×10 shared tiles, no depth slope, branchless 2×2 history taps, 4-tap post-blur,
  4-tap specular pre-blur, recurrent-only reprojection, bilinear diffuse stabilization history
  (§5.1; affine and branchless kernel taps came earlier, in M2). Not kept: `shader-f16` taps (−0.11 ms, −0.2 dB on HDR input),
  4-tap blur (option). Not done: folding the 0.10 ms prepass into pre-blur, half-res `F`.
- **A-SVGF** v1 → v2: gradient chain 1.27 → 0.50 ms (one reprojection per stratum, packed f16, 4
  iterations), specular variance 1.10 → 0.51 ms (`spatialVarianceRadius` 1).
- **Occlusion** (untried): bilinear history, 4-tap blur, r32float fast history for one signal.
- **Shadows:** a 4-tap second pass saved nothing (the passes are bound by per-pixel setup and
  centre loads); one unfiltered copy instead of two loses on this GPU (per-tap tile lookups);
  `shader-f16` not tried (not ALU bound).

---

## 11. What's next for implementers (v0.2; M7 / M8 added in v0.3)

1. ~~**Native replays** of the blue-noise test-bed captures (Windows), for the PLAN §8 quality
   target and review item 1; then NATIVE-HARNESS phase 5 (our WGSL on the RTX machine) for
   "≤ 2× native" (item 3).~~ Done (native/results/PHASE4-5.md). Next: rule out a native
   integration issue (SIGMA below plain accumulation), then re-score.
2. **M6 real-scene numbers** (`results/M6-real-scene.md`) for item 7, with every filter in the
   same page as on the test bed.
3. ~~Once Dennis decides items 1–2: flip the defaults (`antiLag`, `OcclusionDenoiser` filter, the
   meaning of `filter: 'recurrent'` on the joint class), update README tables.~~ Done 2026-10-25.
4. Small measurement gaps (TASKS): A-SVGF `auto` v2 on occlusion; `uniformSnap: 'change'` at
   1080p; the hybrid default with anti-lag v2.
5. If recurrent stays in play: half-res fast history (memory, item 4), and the untried
   variance-guided luminance weight / short-history wide mode for r ≥ 0.35 (TASKS).

**v0.3: M7 and M8, in order** (after items 1–2 above are decided, or against the recommendations;
each step ends with numbers):

_M7 (SH/SG, §8.5)_
1. **Captures and test bed** (capture owner + test-bed owner): CAPTURE-FORMAT v1 buffers
   `diffuse_dir`, `specular_dir`, `normal_geom`, `diffuse_sh_ref`, `specular_sh_ref` (M7-4); the
   `bumpy` and coloured-bounce scenes, the detail-band and ringing metrics (M7-13).
2. **SVGF diffuse SH, raw-form input** (encode on load, M7-2/M7-3/M7-5–M7-8), registry ids
   `svgf-sh` / `svgf-sh-auto`. Gate: the 7-path regression (SH resolved at the guide normal within
   0.05 dB of plain SVGF, pooled).
3. **Resolve**: `SH_RESOLVE_WGSL`, `ShResolver`, `resolve: 'fused'` (M7-9, M7-11). Then the `bumpy`
   table against both references, and the cost / memory rows vs the §10.3 estimates.
4. **Tune on captures:** encoding (M7-2), guard k, sharpening s, `'sh-rgb'` on the coloured-bounce
   scene (item 10), 64-bit à-trous packing (M7-3).
5. **Specular SH** with the fused ratio-SG resolve and roughness fade (M7-10); the glossy bumpy
   floor.
6. **Native replays** of the SH captures (probe P6).
7. Recurrent SH (§8.5.6) only if item 12 / item 1 keep recurrent.

_M8 (translucent shadows, §7.10)_
1. **Captures and test bed**: CAPTURE-FORMAT v1 `transmittance`, `translucent_dist`,
   `shadow_rgb_ref`; the test bed's shadow ray made multiplicative through translucent layers with
   the early out (M8-1); scenes `glass`, `glass-moving`, `glass-still` (M8-10).
2. **`ShadowDenoiser({ translucency: true })`**: τ history and conditional accumulation (M8-2,
   M8-4), g from h_τ (M8-3), tile bits (M8-5), visibility-weighted spatial (M8-6), widened
   stabilization (M8-7), the storage-limit path (M8-9). Gate: with T ≡ 1, v output bit-identical
   to v2.2.
3. **Measure** (M8-10 metrics, dynamic region and boil on `glass-moving` / `glass-still`) and the
   cost / memory rows; tune N_τ, ε_τ, the τ window.
4. **Native replay** (probe P7).
5. Real-scene glass capture (`examples/three-temporal`) once the analytic numbers hold.

---

## 12. Open for Dennis's review

**v0.4: all decided.** Dennis decided every item as recommended on 2026-10-25 (via the decisions
page, q01–q17). Each item below starts with its decision in one line; options and evidence are kept
as the record. Decisions outside the numbered items: shadows' cost target becomes ~0.75 ms (q05; v2.2
measures 0.55–0.72); the realtime example pages stay local, `deployed: false` (q09); the captures are
kept (q17).

**v0.2:** one list, merged with TASKS "Questions for Dennis" (which now points here), ordered by
how much each item blocks. Each item has options, evidence (test bed, 1080p, 7 paths, pooled PSNR
unless noted) and our recommendation.

Settled since v0.1 and dropped from the list: SVGF feedback (off, M1 §4; was also a TASKS
question); the recurrent history cap (31); anti-lag placement; default output space
(demodulated); checkerboard (PLAN non-goal); glossy kernel elongation (κ_e 0 / 0.75 / 1 within
±0.1 dB, M2-M3 §5); A-SVGF `'auto'`'s inert α_min (fixed by anti-lag v2, §4.6); shadows'
fresh-history noise (v0.1 item 6a: v2 matches FFX from frame 3 of a reset, `std1080-orbit` 35.42
vs 35.40 pooled; frames 0–2 still 0.2–0.5 dB behind) and `thin`'s cost (6b: 0.59 ms).

1. **Default filter per signal: diffuse, specular, occlusion.** Blocks the M2/M3 go/no-go, the
   defaults of M6's nodes, and M7 (SH/SG waits for it).
   **Decided 2026-10-25 (Dennis): (a).** SVGF for all three, recurrent opt-in; `OcclusionDenoiser` default `'svgf'`;
   `DiffuseSpecularDenoiser({ filter: 'recurrent' })` = recurrent for both signals, the hybrid explicit
   (`specular: { filter: 'svgf', antiLag: 'auto' }`). In code since 6be4f23 (explicit paths and the new
   defaults byte-checked against their explicit configs). Checkpoint (d) stays: re-check after a native
   replay with the integration question settled (native at its defaults already scores below ours).
   - *Evidence.* PLAN §4.2 expects recurrent as the shipping default; M2's exit criterion is
     "beats M1 on quality or cost". Measured (§0.2): diffuse SVGF 38.88 / A-SVGF auto 39.12 /
     recurrent 38.26 dB (recurrent − SVGF per path: orbit −0.86, pan −1.25, light −0.67, thin
     −0.25, glossy +0.22, cut −0.65, object −0.85); specular 33.46 / 35.04 / 34.10 (recurrent
     beats plain SVGF on 5 of 7 paths, A-SVGF auto only on `glossy`, +0.17); occlusion AO SVGF
     38.93 vs recurrent 38.02, SO 38.76 vs 37.37, SVGF ahead on every path. Recurrent is weaker in
     disocclusions (diffuse −1.2 dB vs SVGF) and slower after light changes (diffuse 11 frames to
     recover vs 5 for A-SVGF, M2-M3 §6). Cost (test-bed bench medians, [REMEASURE](results/REMEASURE-2026-10-25.md)): joint SVGF 4.00 / A-SVGF auto 4.23 / recurrent 3.99 ms; AO+SO joint 2.89 / 3.10 / 2.62.
     Memory: 132 / 140 / 105.5 B/px; AO 84 vs 57.5. Recurrent's wins: flat glossy floors (virtual
     motion), memory, static-view flicker, and a design meant to track native (unmeasured). About
     20 knobs moved its gap by ≤ ±0.2 dB (M2-M3 §5, M5 §4).
   - *Today's code.* `DiffuseDenoiser`, `SpecularDenoiser` and `DiffuseSpecularDenoiser` default
     to `'svgf'`; `OcclusionDenoiser` defaults to `'recurrent'` (SPEC O-2);
     `DiffuseSpecularDenoiser({ filter: 'recurrent' })` means recurrent diffuse + A-SVGF specular
     (4.79 ms bench with anti-lag v2, ≈ 138 B/px), which `'svgf'` + `'auto'` on both signals beats on quality,
     cost and memory.
   - *Options.* (a) SVGF for all three (plus item 2's anti-lag), recurrent opt-in. (b) Recurrent
     for all three, accepting −0.9 dB diffuse and specular (vs A-SVGF auto) and −0.9 / −1.4 dB
     AO / SO (vs SVGF) for 25–30 % less memory. (c) Mixed per signal: no signal shows a recurrent
     win that would justify it today. (d) Decide after the native replay of the test-bed
     captures.
   - *Recommendation:* (a) now, (d) as the checkpoint. SVGF + `'auto'` for diffuse and specular;
     `OcclusionDenoiser` default → `'svgf'`; `filter: 'recurrent'` on the joint class = recurrent
     for both signals (drop the hybrid). By PLAN's exit criterion M2/M3 is a no-go **as the
     default** on today's evidence; keep the code as the memory option and the native-parity bet.

2. **SVGF `antiLag` default** (the svgf-antilag agent's proposal in TASKS).
   **Decided 2026-10-25 (Dennis): (a).** `'auto'` (v2) is the default (64a1123); `'off'` stays an option.
   **Occlusion (Dennis, 2026-10-25): `OcclusionDenoiser` with `filter: 'svgf'` defaults to `'off'`**, independently of the radiance default; `'auto'` stays an option. Evidence: AO about level on the test bed (`'off'` 38.93 vs 39.03 dB, contact −0.6, mostly `object`) and ahead on the real scene (+0.07…+0.33 dB, contact +0.2…+0.4), ~10 % more flicker, SO −0.9 dB, AO + SO 0.8 ms cheaper on the RTX bench (4.15 vs 4.95 ms; M5 Pro 2.89 vs 3.10); byte checks and A/B in [results/OCCLUSION-ANTILAG.md](results/OCCLUSION-ANTILAG.md).
   - *Evidence* (M1 §12). `'auto'` v2 vs `'off'`: diffuse 39.12 vs 38.88 (+0.24), specular 35.04
     vs 33.46 (+1.58; `glossy` +3.8, `'off'`'s specular lag), FLIP 0.033 / 0.046 vs 0.036 / 0.051,
     lower flicker; light-flip recovery 4 / 3 frames vs 5 / 8; joint 4.24 vs 3.99 ms (+0.25; v1
     was +1.6); +4 B/px per signal. v2 matches v1's quality (39.12 / 35.04 vs 39.13 / 34.96).
   - *Options.* (a) `'auto'` default (one line in `resolveOptions`, plus README / SPEC). (b)
     `'off'` default with `'auto'` documented as the quality option (today). (c) `'auto'` for
     specular only: most of the gain, but `antiLag` is structural, so two pipelines, which costs
     more than (a). Free tweaks if `'off'` stays: per-signal α_min (diffuse 0.1: +1.2 dB
     per-frame mean, M1 §4) and specular `spatialVarianceRadius: 1` (+0.03 dB, cheaper).
   - *Recommendation:* (a). Item 3 decides whether 4.24 ms is acceptable.

3. **The 4 ms budget vs ≤ 2× native.**
   **Decided 2026-10-25 (Dennis): (b).** ≤ 2× native on the same GPU is binding, 4 ms on the M5 Pro a
   guide ± 10 %. Measured since (native/results/PHASE4-5.md, locked clocks): ours / native 1.00–1.39×
   diffuse + specular, 1.12× shadows, 1.12–1.48× occlusion, so every configuration meets it.
   - *Evidence.* Joint diffuse + specular on the M5 Pro, test-bed bench medians ([REMEASURE](results/REMEASURE-2026-10-25.md)): SVGF 4.00,
     A-SVGF auto v2 4.23, recurrent 3.99, hybrid 4.79 (recurrent on the dev page: 4.44). Native on the RTX 3060 Laptop: RELAX 6.74 ms,
     REBLUR 5.61 ms at 1080p (M1 §7); ours has never run there (NATIVE-HARNESS phase 5).
   - *Options.* (a) ≤ 4 ms firm for the defaults (then `'auto'` misses by 6 %; recurrent passes on the test-bed bench).
     (b) ≤ 2× native on the same GPU binding, 4 ms on the M5 Pro a guide. (c) Both, with a
     tolerance.
   - *Recommendation:* (b), with 4 ms ± 10 % as the M5 Pro guide until phase 5 runs, and phase 5
     scheduled before the defaults freeze.

4. **Memory over 100 B/px.**
   **Decided 2026-10-25 (Dennis): (a).** ~140 B/px accepted for the SVGF default; (c) if it measures clean; recurrent (+ half-res
   `F`, not built) is the documented lean option.
   - *Evidence.* Diffuse + specular: recurrent 105.5 (half-res `F` → 93.5, not built), SVGF 132,
     A-SVGF auto v2 140, today's hybrid ≈ 138. AO: recurrent 57.5, SVGF 84. Shadows 40 (+12 B per
     tile).
   - *Options.* (a) Accept ~140 B/px for an SVGF default. (b) Require ≤ 100 for the default: only
     recurrent with half-res `F` gets there. (c) Cut SVGF: the output aliasing the last à-trous
     target (untested, §10.2) gives −8 B/px per signal → 132 with `'auto'`.
   - *Recommendation:* (a), plus (c) if it measures clean; recurrent + half-res `F` as the
     documented ≤ 100 B/px option if item 1 keeps recurrent.

5. **Shadows: uniform snap.**
   **Decided 2026-10-25 (Dennis): `'change'`** as the default (255a06a), still a setting (`true` /
   `false`). The 1080p check landed between on and off as predicted (REMEASURE §4).
   - *Evidence* (M4 §9, §10.5). Snap = where all 25 raw samples of the 5×5 window agree, the
     history takes their value. It was tuned against the per-frame-mean metric (empty `pan`
     frames scored 120 dB). Pooled, v2: on 37.11 / penumbra 28.57 / FLIP 0.0182; off 37.29 / 28.88 /
     0.0198 (off has the better PSNR on 6 of 7 paths, on the better FLIP on 4 of 7, mostly `light`:
     0.021 vs 0.031). `uniformSnap: 'change'` (snap only where the history sits outside the clamp
     window, i.e. after a real change) lands between at 960×540: 34.31 / 26.45 / 0.0297 vs on
     34.26 / 26.35 / 0.0286 and off 34.34 / 26.52 / 0.0309.
   - *Options.* On (cleaner flat areas after a lighting change), off (best PSNR, simplest, no
     unsourced rule), `'change'`.
   - *Recommendation:* `'change'`: it keeps the snap for the one case where it visibly helps
     (stale flat areas after a lighting change) and gives up ~0.03 dB against off. Needs one
     1080p run to confirm it lands between there too (TASKS).

6. **AO look / hit-distance curve** (v0 item 2).
   **Decided 2026-10-25 (Dennis): (a).** Keep the rational curve and its defaults; choose the AO scale `a` (option b) after the
   real scenes and P3, whose data is now in native/results/PHASE4-5.md ("P3": native's converged
   output equals its normalized input, so the curve is the whole AO look).
   - *Evidence.* `ĥ = h / (h + a + b·d)`, a = 1, b = 0.05 (F-3), one curve for radiance and
     occlusion. It never clips (far hits survive for virtual motion), but as AO it is soft and
     mostly white on the test-bed scene (M5 §7). Native's normalized AO uses its own curve and
     parameters; probe P3 asks for it as data. O-3's world-space AO radius (b = 0) is available as
     `hitDistanceViewScale: 0`.
   - *Options.* (a) Keep the curve and its defaults. (b) Keep the curve, choose another default
     `a` (the distance at which AO = 0.5) for `OcclusionDenoiser`, possibly with b = 0 (O-3).
     (c) A clipping curve `saturate(h / h_max)` for the occlusion denoiser only (the classic
     AO-radius look; the radiance filters keep the rational curve).
   - *Recommendation:* (a) for now, (b) once Dennis has looked at AO on an M6 real scene and P3 has
     returned; (c) only if the soft falloff is rejected on looks.

7. **Tuned on the scene it is scored on.**
   **Decided 2026-10-25 (Dennis): as recommended.** Scoring scenes: the test bed plus the three.js
   real scene, with Bistro and Sponza coming; defaults stay provisional until scored there.
   - *Evidence.* Every default (SVGF sweep, recurrent radii and anti-lag, shadows clamp, radius and
     v2 constants, occlusion radii and σ_l) was tuned on the one analytic test-bed scene and scored
     on the same 7 paths. The dev page and the test bed already disagree by 2–3 dB on recurrent vs
     SVGF. M6 is building real-scene pages (`examples/three-temporal`); first numbers go to
     `results/M6-real-scene.md`.
   - *Recommendation:* M6's real scene(s) as the second scoring scene; every default stays
     provisional until it and the native replay agree with the test bed; re-tune only what moves by
     more than ~0.5 dB there.

8. **API items** (§1.2, §9).
   **Decided 2026-10-25 (Dennis): (a)–(f) as recommended, API as is.** Plus the renames from TASKS
   (q10): the recurrent filter's boolean `antiLag` is `historyAntiLag` (6be4f23) and the shadows'
   numeric `antiLag` is `antiLagGain` (255a06a); SVGF keeps `antiLag: 'off' | 'auto' | 'gradient'`.
   The old names stay as deprecated aliases that warn once per instance.
   - (a) `remodulate` + caller-supplied `inputs.demodulation` instead of `f0` and an in-denoiser
     E: keep (the caller owns its material terms).
   - (b) Two outputs via `dispatchBoth`, `dispatch()` returning the first (diffuse / AO): keep.
   - (c) A-SVGF `'gradient'`: an input-texture contract with no producer (the renderer
     forward-projects and re-shades with old seeds), unmeasured on the test bed. Ship as
     experimental and documented; `'auto'` is the supported anti-lag.
   - (d) Shadows build their own guide pair (40 B/px instead of ≈ 32; sharing the diffuse /
     specular prepass costs 0.18 ms when shadows run alone): keep standalone; revisit if M6 shows
     the need for a shared multi-denoiser guide pass.
   - (e) `OcclusionDenoiser({ filter, signal: 'diffuse' | 'specular' | 'both' })`, ĥ in `.r`,
     `HitDistanceNormalizer` exported: keep.
   - (f) Outputs may rotate between internal buffers (recurrent today; SVGF if item 4c lands):
     valid until the next dispatch, per the `TemporalDenoiser` contract. Keep, and state it in the
     README for every class.

9. **Listing policy** (v0 item 1, unchanged). We don't use formulas from RTG II ch. 49's numbered
   listings even though `sources/reblur.md` transcribed them; we do use GTC 2020 **slide**
   formulas (radius 1/(1+A), history-fix start level). Every recurrent pass now exists without
   the listings. **Decided 2026-10-25 (Dennis): keep, by caution, even if our filter underperforms
   the chapter.** The book and its listings are CC BY-NC-ND 4.0; the MIT GitHub repo has no ch. 49
   code; RULES §2 records the details.

**v0.3 items (appended; M7 / M8 are specified, not built, so these are design calls, not yet
measured):**

10. **M7 colour payload: YCoCg with chroma as L0 (6 channels) or RGB L1 (12).**
    **Decided 2026-10-25 (Dennis): (a).** 6 channels by default, `'sh-rgb'` opt-in.
    - *Evidence.* The shipped recipes use 6 channels (SD24 p.30, ACS25 s.57); 6 fit one rgba32uint
      per buffer (M7-3), 12 need two, ≈ +48 B/px per signal and more load-bound time. 6 channels
      lose coloured directionality (a bump facing a coloured wall keeps the pixel's average hue).
    - *Options.* (a) 6 by default, `'sh-rgb'` opt-in. (b) 12 by default. (c) 6 only.
    - *Recommendation:* (a); flip only if the coloured-bounce scene shows a visible hue error in
      the detail band that `'sh-rgb'` removes.

11. **M7 resolve location.**
    **Decided 2026-10-25 (Dennis): (a).** diffuse `resolve: 'none'`, specular `'fused'` by default; both modes on both signals.
    - *Evidence.* A caller resolve keeps the payload for other uses (SH as a light source for any
      BSDF, SD24 p.37; rough-specular reuse, SD24 p.55, ACS25 s.65) but costs a full-screen pass and
      16 B of output; a fused resolve saves both and needs only the detail normal. Specular's ratio
      resolve needs roughness, view and the guide normal, which the denoiser has.
    - *Options.* (a) Diffuse `resolve: 'none'` by default, specular `'fused'`. (b) `'fused'` for
      both. (c) `'none'` for both.
    - *Recommendation:* (a), both modes available on both signals.

12. **M7 scope: which filter.**
    **Decided 2026-10-25 (Dennis): (a).** SVGF only (item 1 keeps recurrent opt-in, so recurrent SH stays unbuilt).
    - *Evidence.* Item 1 recommends SVGF for diffuse and specular; recurrent SH needs larger buffers,
      a luminance-ratio stabilization clamp and either 16-load Catmull-Rom or a higher storage
      limit (§8.5.6). The shipped SH recipes run on recurrent-blur denoisers, so it is known to work.
    - *Options.* (a) SVGF only, recurrent SH later if item 1 keeps recurrent. (b) Both now.
    - *Recommendation:* (a).

13. **M8 output.**
    **Decided 2026-10-25 (Dennis): (a).** one rgba16float `(v̂·τ̂ rgb, v̂)`.
    - *Evidence.* The shader needs `v̂·τ̂` (rgb); opaque-only consumers and the regression need v̂.
      One rgba16float carries both (8 B); separate τ̂ and v̂ would let a caller recombine but invite
      the biased product of plain means (M8-2).
    - *Options.* (a) rgba16float `(v̂·τ̂ rgb, v̂)`. (b) two outputs, v̂ (r32float) and τ̂ (rgba16float).
    - *Recommendation:* (a).

14. **M8 storage limit** (M8-9).
    **Decided 2026-10-25 (Dennis): (a).** the fifth storage texture when the device has it, the packed history otherwise.
    - *Evidence.* The temporal pass needs a fifth storage texture for the τ history. Our examples
      already request min(8, adapter); the WebGPU default is 4. Packing v's and τ's histories into
      one rgba32uint works at 4 but loses hardware filtering for v's Catmull-Rom history (16 loads,
      or bilinear at −0.65 dB on `orbit`, M4 §3).
    - *Options.* (a) Use the fifth texture when the device has it, the packed history otherwise
      (two pipeline variants). (b) Require ≥ 5 for `translucency: true` (explicit error otherwise).
      (c) Packed history always.
    - *Recommendation:* (a), after measuring the packed path's cost; (b) if that cost is high and
      no target device lacks the limit.

Lower priority, kept from v0.1: **pre-blur strength** (recurrent diffuse 25 px, +0.10 dB over
15; the bias is permanent near contacts, limited by D1b). It matters only if item 1 keeps
recurrent as a default; look at contact GI on captures first.

## 13. Evaluation method (v0.2, added 2026-10-25)

What every quality number in this spec is measured against, and why.

**Ground truth is a converged render of the same estimator, never another denoiser.** Each
test-bed frame is rendered a second time with many samples (256 spp, stratified 16×16, same
estimator as the 1-spp input), so the specular reference is the converged version of exactly the
specular signal being denoised. The real three.js scene does the same per frozen camera pose
(1024 rays for visibility, 2048 for diffuse and AO, 4096 for the static shadow shots). Denoisers
are never scored against each other: "recurrent vs SVGF" means two scores against the same
reference. Noise-injection mode (test bed `noise=inject`, the package dev page) has exact truth
and is used for math checks only, because injected noise is easier than traced noise.

**Reference noise sets a ceiling.** A finite-sample reference carries its own variance σ²_ref,
uncorrelated with any denoiser's output, so every measured MSE is the true MSE + σ²_ref. That
keeps rankings but compresses gaps, and it caps meaningful PSNR (at 256 spp, around 40 dB on our
signals). The best filters score 38–39 dB, close to that cap. So:

- **High-reference subset (E-1).** Two or three test-bed paths are re-scored against 2048–4096-spp
  references for the top filters, to measure the true gaps. When a ranking or a decision rests on a
  gap of a few tenths of a dB, cite the high-reference number.
- Where it's cheap, report the reference's own noise floor (e.g. PSNR between two independent
  references of the same frame) next to the scores.

**Baselines vs references.** A strong offline denoiser is a *baseline* scored against the same
reference, never the reference itself: its output is an estimate with its own bias and
over-smoothing, so scoring against it would measure resemblance to it, not error.

- **OIDN baseline (E-2).** OIDN 2 (the `denoiser` package's single-image `Denoiser`), run once
  per frame on the same 1-spp demodulated signal, with albedo and normal as auxiliary inputs where
  the signal allows, scored per signal with the same metrics. It is the "heavy neural, no history"
  point: expected to lead on single-frame PSNR, lose on flicker, and cost far more than the
  real-time budget. It also gives the comparison point for OIDN 3's real-time model, which joins
  `denoiser/realtime` later (PLAN §1).
- **Native NRD (PLAN §6)** is the main comparison: same captures, same references, same metrics
  (`compare.mjs`), same GPU for cost.
- FFX shadows / reflections and plain accumulation remain the in-repo baselines.

**Metrics.** Pooled PSNR ranks (header note; CAPTURE-FORMAT "Metrics for replay outputs"), with
the per-frame mean and the 60 dB-capped mean kept for continuity. FLIP (perceptual), flicker and
temporal PSNR (stability), bias and energy (darkening and brightening), and region breakdowns
(penumbra, disoccluded, after-cut, roughness bins, contact) are reported next to it. A filter that
wins pooled PSNR but loses FLIP or flicker is a judgement call, not a win.
For shadows two more (results/M4.md §12): a **dynamic region** (pixels whose reference range over
frames t−4..t exceeds 0.05, carried along the reprojected history) with its own pooled PSNR, flicker and
temporal PSNR next to the static rest and the static penumbra; and **boil**, the RMS of the output's own
second temporal difference / √6, reported with the reference's own boil as its floor. Flicker and
temporal PSNR measure the change of the error, which includes the reference's frame-to-frame noise; on
slowly moving soft shadows that noise is as large as a good output's change and hid visible boiling.
Boil doesn't see the reference, but it also rewards a frozen output: read it with PSNR.

**Scenes.** The analytic test bed is where defaults were tuned, so it can't be the only judge. The
real three.js scene's moving-camera captures (`three-orbit`, `three-pan`) are the second scoring
scene (§12 item 7). Moving occluders over static receivers (no motion vector follows the shadow) have their own
captures: the rotating torus knot (`three-knot-static`, `three-knot-orbit`, and the frozen-knot control
`three-knot-still`; examples/three-temporal/CAPTURES.md), scored with the dynamic region and boil; the
test bed's `object` and `light` paths cover the same case analytically. A default stands only if both scenes, and later the native replay, agree.

**Adoption rule (Dennis, 2026-10-25).** New techniques ship as options with today's behavior as the
default (bit-identical default path). Promotion to a default needs an A/B on both scoring scenes
(and native where it applies) with no regression beyond −0.1 dB pooled PSNR, +5 % FLIP, +5 % boil
or flicker in any region, +10 % cost; look-changing defaults need Dennis's approval (TASKS rule 9).
