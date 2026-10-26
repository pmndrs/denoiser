# DISTANCE-LONG: distance information over long histories (review target D + review target 7)

_2026-10-26, evaluator/implementer (clean). Audit priority 3: [TASKS](../TASKS.md) "Review target D", target 7 of
[sources/nrd-review-targets.md](../sources/nrd-review-targets.md), §3–4 of
[sources/audit-public-research-prompt.md](../sources/audit-public-research-prompt.md) /
[sources/audit-current-state.md](../sources/audit-current-state.md). Treated as a hypothesis. Mac (M5 Pro, Chrome → Metal)
only; the Windows / RTX repeat is in §8. Code: 73358ce (option + tooling)._

## 0. Conclusion

**No signal's image drifts over a long hold.** On ≥ 378-frame stationary holds (and a 2016-frame one) of the test bed
(`glossy`, `thin`), the real corner (`three-knot-still`) and Bistro, with every shipped default and the recurrent option,
the window-mean output's PSNR, bias, brightness and edge sharpness are flat once settled. The hold inputs repeat
exactly each period, so any change between settled windows would be the filter's own state, not sampling noise; every
such drift is below 0.03 dB and 0.0002 brightness per 100 frames, with one invisible exception (−0.07 dB / 100 f in the
test bed's 55 dB lit outer penumbra, an MSE change of ~5·10⁻⁸). What the long holds do show:

| finding | signal | kind | size | cause |
|---|---|---|---|---|
| **Metal f16 truncation darkens every rgba16float history** | SVGF diffuse / specular / AO / SO (shipped), recurrent, shadows | **biased plateau** (reached within ~1 history length, then constant) | brightness −0.2 … −0.7 %; pooled-hold PSNR +0.1 dB diffuse, +0.1 … +0.7 dB AO, ±0.15 dB elsewhere when removed | truncating `textureStore` into rgba16float (LESSONS m8) × the history's 1/α |
| **shadows' penumbra scale g decays in rarely occluded pixels** | shadows (shipped) | **drift that saturates**: −5 … −7 % after 300–600 frames, then flat (2016-frame hold) | g in the outer penumbra (reference ≥ 0.98) 0.93–0.96 × the raw mean; penumbra −1 %; **no visible effect** (PSNR, edge, boil flat) | a frame without an occluded sample re-stores the reprojected g, and each truncating store loses up to one f16 ulp |
| **recurrent ĥ is inflated in contacts** | recurrent diffuse / specular (option) | **biased plateau** after ~150 frames | stored ĥ / raw-mean ĥ = 1.12 (knot), 1.18 / 1.34 (Bistro diffuse / specular contacts); −1 % from truncation elsewhere | the post-blur output is the next history, so ĥ is re-blurred every frame (its tap weights keep it from spreading far, not from creeping up next to a contact) |
| **settled state depends on history** in two places | shadows | persistent offset | Bistro: after a 48-frame walk the same view settles **+0.27 dB / edge 0.821 vs 0.806** better than a hold from a reset, and the hold closes the gap only slowly (25.32 → 25.41 dB over 384 frames); outer penumbra (55 dB region) −0.1 … −0.9 dB, test bed | (1) g of rarely occluded pixels is learned only from occluded samples, which the walk supplies and a still camera supplies rarely; (2) truncation-stuck values (a history at 1 − 1 ulp can't return to 1) |
| everything else converges to the same image within one hold period | all | – | arrive − hold ≤ 0.02 dB from the second window on | – |

**Hypotheses (TASKS target D):** (a) shadows' g drifts down: **yes, but saturating and invisible**, and it is not what
bands contact shadows (contact g is within 0.1–2 % of its raw mean; no banding, contact error flat); (b) recurrent
hit distance drifts from the per-frame mean: **a biased plateau, not drift** (+12 … +34 % in contacts, from re-blurring,
not f16); (c) SVGF / A-SVGF specular uses no hit distance: confirmed (answered by results/REFLECTION-MOTION.md, c9db2df);
(d) AO / SO long-hold contact darkening: **no** — the shipped AO is slightly *brighter* than the reference in contacts
(+0.002 … +0.009), SO within ±0.003, both flat over the hold.

**Candidate built:** `f16Rounding: 'nearest'` (option on SVGF, recurrent, shadows and the occlusion normalizer; default
`'store'`, byte-identical): every write to an f16 storage texture first goes through `pack2x16float` (round to nearest),
so the store can't round again. It removes the truncation plateau, the g decay and the stuck states. Rule-9 A/B (§6):
passes for the SVGF signals (diffuse +0.07 dB, AO +0.19 at 256 spp; +0.22 / +0.42 at 4096 spp; FLIP −1 … −17 %) and
recurrent; loses slightly on shadows (−0.05 dB pooled). **Proposed flip (Dennis): `'nearest'` for the SVGF and recurrent
pipelines, shadows stay `'store'`.**

## 1. Setup

**Sequences.** Captures are short; long holds are built by `tools/rt-capture/loop-capture.mjs` (new): a capture whose
frame folders are symlinks into an existing capture, an optional *head* played once, then a static *hold window*
repeated to ≥ 300 frames, one reset at frame 0, and the hold frames' references replaced by the **mean of the window's
per-frame references** (a still view's per-frame references are independent estimates of one image). The hold input
repeats with period P, longer than every history cap under test (shadows 15, SVGF 64 (EMA α 0.1), recurrent 31): with
identical inputs every period, **any change between settled period-aligned windows is the filter's own state**, which
separates drift from sampling variance exactly.

| sequence | source | frames | hold period P | reference of the hold |
|---|---|---|---|---|
| `dl-glossy-hold` / `dl-glossy-arrive` | test bed `glossy-arrive` (new path): 60-frame 25° arc ending on `glossy`'s frame-48 pose, then 64 frames holding it; 960×540, 256 spp per frame, signals diffuse, specular, shadows, ao, so (ao_ref / so_ref written as extra buffers, new) | 378 (hold from a reset) / 61 + 378 (arc, then hold) | 63 (frames 61–123) | 63 × 256 = 16 k spp |
| `dl-thin-hold` / `dl-thin-arrive` | test bed `thin-arrive` (new), the same around `thin`'s frame-48 pose (fence, thin contact shadows) | 378 / 439 | 63 | 16 k spp |
| `dl-knot-hold`, `dl-knot-long` | `three-knot-still` (real corner, frozen knot, contact + wide penumbrae) | 384, 2016 | 32 | visibility 64 k rays, diffuse / AO 2 k (no SO ref) |
| `dl-bistro-hold` / `dl-bistro-arrive` | `bistro-hold` (new three-temporal path: `bistro-orbit`'s last pose held, path frames 48–79, refs 128 / 128 / 32 per frame) after nothing / after `bistro-orbit`'s 48-frame walk | 384 / 432 | 32 | visibility and diffuse / AO 4 k rays, SSR 1 k frames (no SO ref) |

"arrive" and "hold" share the hold frames bit for bit, so arrive − hold per aligned window is the effect of history alone.

**Probe.** `examples/realtime-denoiser/distance.html` (`src/distance.ts`, new) replays a loop capture through one registry
denoiser (no outputs written) and measures on the CPU, per frame and per period-aligned window, per region:
mean output vs reference ("val": shadows / AO / SO clamped to [0, 1], rgb per-channel Reinhard), MSE, bias, linear
brightness ratio Σ lum(out) / Σ lum(ref), boil (RMS second temporal difference / √6), window-mean edge sharpness
(mean |∇ō| / mean |∇ref| where |∇ref| > 0.1 scalar / 0.05 rgb), temporal variance, and **the stored distance against
the raw samples**: `ReplayDenoiser.inspect()` (new, @internal) hands it the shadow history (v, **g**, A, n_g) and the
recurrent post-blur history H (ĥ in `.a`); the raw side is the per-pixel mean over one hold period of exactly the
shader's sample (shadows g = h (directional) or h / (D − h) (sphere), occluded samples only; recurrent
ĥ = h / (h + 1 + 0.05 d), miss = 1). Regions come from the hold reference and raw samples: shadows lit (ref ≥ 0.98) /
penumbra / umbra (≤ 0.02) / **contact** (ref < 0.98 and mean occluder distance < 0.25 m); diffuse, AO **contact**
(mean diffuse ĥ < 0.5) / open (≥ 0.9); specular, SO glossy (r < 0.35) / rough / contact (mean specular ĥ < 0.5).
"Settled" = the second half of the hold windows; drift = least-squares slope over those windows.

**Configurations.** Shipped defaults per signal: diffuse / specular `svgf-auto` (single-signal `DiffuseDenoiser` /
`SpecularDenoiser`, A-SVGF `'auto'`), shadows `shadows` (v2.2, `uniformSnap: 'change'`), AO / SO `occlusion-svgf-auto`;
plus the recurrent option (`recurrent-diffuse` / `-specular`, `occlusion-recurrent`), each also with
`f16Rounding: 'nearest'`. The probe runs used a snapshot taken before d168f7e, so **their SVGF rows run
`youngNormalPower: 0`** (the previous default; it only touches a pixel's first ~4 frames, so settled holds are
unaffected) and **their shadows rows run `snapHardPx: 0`, `backfacePass: false`** (the defaults before cc8f1e7); the
rule-9 A/B of §6 runs the tree of 73358ce (`svgf-auto` = `youngNormalPower: 16`, shadows `snapHardPx: 2`,
`backfacePass: true`).

## 2. Glossary: where hit distance enters each filter

Inputs (CAPTURE-FORMAT, `ShadowInputs` / `*Inputs.hitDistance`): **h** = world-space length of the secondary ray
(primary segment excluded); `diffuse_hitt` / `specular_hitt`: 0 = miss; `occluder_dist`: distance to the first
occluder along the shadow ray, 0 when the sample is lit (v = 0 with h = 0: light below the horizon). Camera depth:
three.js viewZ < 0 in front; every filter uses the linear depth d = −viewZ > 0. Normalized hit distance (recurrent,
AO / SO): **ĥ = h / (h + a + b·d)**, a = `hitDistanceScale` = 1 world unit, b = `hitDistanceViewScale` = 0.05 per unit
of depth; a miss or a non-finite h → ĥ = 1 ("open"); a radiance signal without a hit texture → ĥ = 1 everywhere
(flag RP_HAS_HIT off). Inverse: hDenorm(x) = (a + b·d)·x / (1 − x), x clamped to 0.999.

| filter (shipped?) | quantity | where it is made | where it is stored (format) | who reads it |
|---|---|---|---|---|
| SVGF / A-SVGF diffuse, specular (**shipped default**) | none | – | – | no hit distance anywhere: reflections reproject with surface motion (review target 2) |
| shadows v2.2 (**shipped**) | penumbra scale **g** per occluded sample: g = h (directional light, world units) or g = h / (D − h) (sphere light, D = distance receiver → light centre; dimensionless); lit samples add nothing | temporal pass | history `.y` (wide path, the default: **rgba16float** ping-pong `(v, g, A + youngBase·y, n_g)`; the packed translucency path packs with `pack2x16float`), a running mean over n_g ≤ `maxScaleHistory` + 1 = 8 occluded samples; a frame without an occluded sample re-stores the reprojected value (bilinear, weights max(bil, 10⁻³)) | the history cap A_cap = clamp(W_px², 1, 15) with W_px = lightSize · g / pixel size; the clamp window's edge term (W_px < `clampEdgePx`); `snapHardPx`; the per-tile minimum g (nearest-occluder estimate for unoccluded neighbours, tiles pass); the spatial passes' kernel radius (M12 Eq. 13 width, `radiusScale`, `historyShrink`, `noiseBlend` / `noiseCap`) |
| recurrent diffuse / specular (option) | ĥ of the 1-spp hit distance, carried in `.a` of every radiance buffer | pre-blur (computed, passed through unfiltered) | **rgba16float** pre, acc, fix, blur, H (next history), S (output), mip atlas; fast history `(luma, ĥ)` **rgba16float**; A in r32uint | pre-blur radius min(R_pre, c_h · hDenorm(H_prev.a)); temporal EMA (cap 31) of rgb and ĥ, the current-frame anti-lag detector on ĥ (tolerance 0.05), fast history (cap 3); specular virtual motion: hDenorm(fast ĥ) → curvature-corrected virtual depth → previous-frame uv, confidence from the fast-ĥ agreement; history fix: ĥ excess detector, mip repair of rgb and ĥ; blur / post-blur: radius min(R_max f_A f_r, c_h · hDenorm(ĥ_centre)) (c_h = 1 diffuse, tan θ_lobe specular) and a tap weight on \|ĥ_tap − ĥ_centre\|, and ĥ itself is blurred with rgb, so **the next frame's history ĥ is a spatially filtered ĥ** |
| AO / SO, `OcclusionDenoiser` filter 'svgf' (**shipped**) | ĥ is the signal | `HitDistanceNormalizer` once per frame | input: **rgba16float** gray (ĥ, ĥ, ĥ, 1); then SVGF's **rgba16float** history (EMA α 0.1 AO, 0.3 SO) and à-trous ping-pong | SVGF as radiance (no distance-specific use) |
| AO / SO, filter 'recurrent' (option) | ĥ is the signal | temporal pass (from raw h) | **r32float** buffers; fast history rgba16float | as recurrent radiance, ĥ only |

Stored formats and the Metal store: Chrome on Metal (M5 Pro) **truncates** values written to rgba16float storage
textures (LESSONS m8), `pack2x16float` rounds to nearest. A quantity re-stored every frame through an exponential
history of weight α therefore carries a steady loss of roughly (½ ulp per store × stores per frame) / α: SVGF 1 store
in the loop, α = 0.1; shadows g 1 store, α = 1/8 (and every frame where no occluded sample refreshes it); recurrent
radiance ~5 stores in the loop (acc, fix, blur, post-blur → H; + the stabilization history S), α = 1/32.

## 3. Results

### 3.1 Settled holds, shipped defaults (second half of the hold; drift per 100 frames)

| scene | signal | region | px | PSNR of mean (dB) | bias | brightness | edge | drift PSNR (dB / 100 f) | drift brightness (/ 100 f) | drift edge (/ 100 f) |
|---|---|---|---|---|---|---|---|---|---|---|
| knot-hold | visibility | all | 518400 | 33.24 | +0.0003 | 1.0004 | 0.849 | +0.009 | +0.00000 | +0.0002 |
| knot-hold | visibility | penumbra | 65109 | 28.18 | +0.0004 | 1.0008 | 0.791 | +0.018 | +0.00003 | +0.0003 |
| knot-hold | visibility | contact | 12812 | 27.01 | +0.0027 | 1.0130 | 0.878 | +0.013 | -0.00005 | +0.0002 |
| knot-hold | visibility | lit | 392420 | 38.50 | -0.0007 | 0.9993 | 0.885 | +0.002 | -0.00000 | +0.0001 |
| knot-hold | diffuse | all | 518400 | 42.77 | -0.0010 | 0.9943 | 0.876 | -0.000 | +0.00000 | +0.0000 |
| knot-hold | diffuse | contact | 17492 | 31.64 | +0.0030 | 0.9991 | 0.839 | +0.000 | +0.00000 | -0.0000 |
| knot-hold | ao | all | 518400 | 41.64 | -0.0030 | 0.9961 | 0.944 | -0.000 | +0.00000 | -0.0000 |
| knot-hold | ao | contact | 17492 | 32.13 | +0.0050 | 1.0133 | 0.923 | -0.000 | +0.00000 | +0.0000 |
| glossy-hold | visibility | all | 385172 | 43.33 | -0.0001 | 0.9999 | 0.963 | -0.015 | +0.00000 | -0.0001 |
| glossy-hold | visibility | penumbra | 36449 | 33.49 | -0.0012 | 0.9977 | 0.946 | -0.013 | +0.00002 | -0.0001 |
| glossy-hold | visibility | contact | 14632 | 43.06 | -0.0002 | 0.9971 | 0.952 | +0.024 | +0.00002 | -0.0001 |
| glossy-hold | visibility | lit | 270024 | 55.75 | -0.0000 | 1.0000 | 0.996 | -0.074 | -0.00000 | -0.0001 |
| glossy-hold | diffuse | all | 385172 | 39.18 | -0.0017 | 0.9893 | 0.872 | +0.000 | +0.00000 | +0.0000 |
| glossy-hold | diffuse | contact | 32519 | 35.96 | +0.0048 | 1.0301 | 0.835 | -0.000 | +0.00000 | +0.0000 |
| glossy-hold | specular | all | 385172 | 36.46 | -0.0010 | 0.9853 | 0.678 | +0.000 | -0.00000 | +0.0000 |
| glossy-hold | specular | glossy | 218715 | 40.65 | -0.0008 | 0.9916 | 0.904 | -0.000 | -0.00000 | +0.0000 |
| glossy-hold | specular | contact | 75875 | 37.84 | +0.0005 | 1.0018 | 0.860 | +0.000 | +0.00000 | +0.0000 |
| glossy-hold | ao | all | 385172 | 42.19 | -0.0026 | 0.9968 | 0.951 | -0.000 | +0.00000 | +0.0000 |
| glossy-hold | ao | contact | 32519 | 38.20 | +0.0019 | 1.0055 | 0.935 | +0.000 | +0.00000 | +0.0000 |
| glossy-hold | so | all | 385172 | 44.85 | -0.0012 | 0.9983 | 0.984 | +0.000 | +0.00000 | +0.0000 |
| glossy-hold | so | contact | 75875 | 42.25 | -0.0026 | 0.9919 | 0.981 | +0.000 | +0.00000 | +0.0000 |
| thin-hold | visibility | all | 397970 | 38.75 | +0.0017 | 1.0021 | 0.991 | -0.003 | +0.00000 | -0.0000 |
| thin-hold | visibility | penumbra | 67417 | 31.31 | +0.0093 | 1.0126 | 0.971 | -0.001 | +0.00001 | -0.0000 |
| thin-hold | visibility | contact | 4177 | 26.24 | +0.0060 | 1.0408 | 0.940 | -0.025 | +0.00021 | -0.0001 |
| thin-hold | visibility | lit | 275282 | 53.46 | +0.0001 | 1.0001 | 0.995 | -0.013 | +0.00000 | -0.0000 |
| thin-hold | diffuse | all | 397970 | 34.33 | -0.0010 | 0.9920 | 0.565 | +0.000 | +0.00000 | +0.0000 |
| thin-hold | diffuse | contact | 8403 | 34.16 | +0.0089 | 1.0561 | 0.818 | +0.000 | +0.00000 | +0.0000 |
| thin-hold | specular | all | 397970 | 36.24 | -0.0007 | 0.9923 | 0.777 | -0.000 | +0.00000 | +0.0000 |
| thin-hold | specular | glossy | 263991 | 41.06 | -0.0007 | 0.9939 | 0.831 | -0.000 | -0.00000 | +0.0000 |
| thin-hold | specular | contact | 33136 | 31.73 | +0.0059 | 1.0436 | 0.855 | -0.000 | -0.00001 | +0.0000 |
| thin-hold | ao | all | 397970 | 35.58 | -0.0024 | 0.9973 | 0.960 | +0.000 | +0.00000 | +0.0000 |
| thin-hold | ao | contact | 8403 | 33.46 | +0.0079 | 1.0221 | 0.934 | +0.000 | +0.00000 | -0.0000 |
| thin-hold | so | all | 397970 | 43.33 | -0.0000 | 1.0000 | 0.995 | +0.000 | +0.00000 | +0.0000 |
| thin-hold | so | contact | 33136 | 37.47 | +0.0006 | 1.0018 | 0.991 | +0.000 | +0.00000 | +0.0000 |
| bistro-hold | visibility | all | 498392 | 25.40 | -0.0000 | 0.9998 | 0.806 | +0.006 | -0.00004 | +0.0005 |
| bistro-hold | visibility | penumbra | 59767 | 23.34 | -0.0089 | 0.9784 | 0.743 | +0.002 | +0.00005 | +0.0001 |
| bistro-hold | visibility | contact | 42154 | 19.14 | +0.0245 | 4.9920 | 0.729 | +0.001 | -0.00068 | +0.0001 |
| bistro-hold | visibility | lit | 92002 | 24.01 | -0.0151 | 0.9849 | 0.809 | +0.000 | -0.00001 | +0.0007 |
| bistro-hold | diffuse | all | 498392 | 34.49 | -0.0004 | 0.9917 | 0.839 | +0.000 | +0.00000 | +0.0000 |
| bistro-hold | diffuse | contact | 83185 | 29.07 | +0.0074 | 1.0499 | 0.784 | +0.000 | +0.00001 | -0.0000 |
| bistro-hold | specular | all | 498392 | 49.24 | -0.0002 | 0.9801 | 0.885 | +0.000 | +0.00000 | +0.0000 |
| bistro-hold | specular | glossy | 160461 | 45.46 | -0.0004 | 0.9768 | 0.872 | -0.000 | -0.00000 | -0.0000 |
| bistro-hold | specular | contact | 65929 | 45.49 | +0.0000 | 0.9912 | 0.842 | -0.000 | +0.00000 | +0.0000 |
| bistro-hold | ao | all | 498392 | 33.29 | -0.0019 | 0.9973 | 0.942 | +0.000 | +0.00000 | +0.0000 |
| bistro-hold | ao | contact | 83185 | 27.88 | +0.0086 | 1.0238 | 0.918 | +0.000 | -0.00000 | -0.0000 |

Every drift column is at the noise of the window means (0.000–0.03 dB / 100 f). The only region with a steady trend is
the test bed's lit outer penumbra (55 dB): −0.07 dB / 100 f on `glossy-hold`, in both rounding modes, an absolute MSE
change of ~5·10⁻⁸ per 100 frames. Over 2016 frames (`dl-knot-long`) shadows' PSNR stays 33.87 ± 0.01 dB (all),
28.31 ± 0.02 (penumbra), edge 0.872 throughout.

### 3.2 Stored distance against the raw samples

| scene | quantity | region | stored / raw mean (native) | drift (log / 100 f) | nearest | drift |
|---|---|---|---|---|---|---|
| knot-hold | shadows g | lit | 0.953 | -0.0060 | 1.000 | +0.0001 |
| knot-hold | shadows g | penumbra | 0.990 | -0.0003 | 1.000 | +0.0000 |
| knot-hold | shadows g | contact | 1.000 | -0.0001 | 1.007 | +0.0000 |
| knot-hold | recurrent ĥ (diffuse) | all | 0.986 | -0.0000 | 1.003 | +0.0000 |
| knot-hold | recurrent ĥ (diffuse) | contact | 1.116 | -0.0002 | 1.132 | -0.0001 |
| glossy-hold | shadows g | lit | 0.928 | -0.0160 | 0.993 | -0.0014 |
| glossy-hold | shadows g | penumbra | 0.986 | -0.0011 | 0.999 | -0.0001 |
| glossy-hold | shadows g | contact | 0.999 | -0.0000 | 1.002 | +0.0000 |
| glossy-hold | recurrent ĥ (diffuse) | all | 0.990 | +0.0000 | 1.002 | +0.0000 |
| glossy-hold | recurrent ĥ (diffuse) | contact | 0.982 | +0.0001 | 0.996 | +0.0001 |
| glossy-hold | recurrent ĥ (specular) | all | 0.993 | +0.0000 | 0.997 | +0.0000 |
| glossy-hold | recurrent ĥ (specular) | contact | 0.970 | +0.0000 | 0.976 | +0.0000 |
| thin-hold | shadows g | lit | 0.961 | -0.0078 | 0.996 | -0.0016 |
| thin-hold | shadows g | penumbra | 0.987 | -0.0010 | 1.002 | -0.0001 |
| thin-hold | shadows g | contact | 1.016 | +0.0001 | 1.022 | +0.0005 |
| thin-hold | recurrent ĥ (diffuse) | all | 0.992 | +0.0000 | 1.002 | +0.0000 |
| thin-hold | recurrent ĥ (diffuse) | contact | 1.009 | +0.0005 | 1.025 | +0.0006 |
| thin-hold | recurrent ĥ (specular) | all | 0.999 | -0.0000 | 1.002 | -0.0000 |
| thin-hold | recurrent ĥ (specular) | contact | 0.988 | -0.0000 | 0.994 | +0.0000 |
| bistro-hold | shadows g | lit | 0.955 | -0.0060 | 0.983 | -0.0031 |
| bistro-hold | shadows g | penumbra | 0.996 | -0.0000 | 1.003 | +0.0001 |
| bistro-hold | shadows g | contact | 1.128 | +0.0011 | 1.132 | +0.0013 |
| bistro-hold | recurrent ĥ (diffuse) | all | 1.011 | -0.0001 | 1.025 | -0.0001 |
| bistro-hold | recurrent ĥ (diffuse) | contact | 1.178 | -0.0003 | 1.190 | -0.0003 |
| bistro-hold | recurrent ĥ (specular) | all | 1.038 | -0.0000 | 1.043 | -0.0000 |
| bistro-hold | recurrent ĥ (specular) | contact | 1.342 | -0.0002 | 1.352 | -0.0002 |
| knot-long | shadows g | lit | 0.947 | -0.0001 | 1.000 | +0.0000 |
| knot-long | shadows g | penumbra | 0.990 | +0.0000 | 1.000 | +0.0000 |
| knot-long | shadows g | contact | 1.001 | +0.0000 | 1.007 | +0.0000 |

- **Shadows g** (shipped): in the lit outer penumbra the stored g falls to 0.93–0.96 of the raw mean and keeps falling
  over the 384-frame holds (−0.6 … −1.6 % / 100 f in the second half); the 2016-frame hold shows where it ends: 0.989 →
  0.958 → 0.949 → **0.947** by ~600 frames, then flat (a biased plateau, not unbounded). Penumbra −1 %, contact within
  0.1–2 % (Bistro's contact 1.13 is the same in both rounding modes and flat over the hold: not a long-history
  effect; not investigated further). `'nearest'` holds it at 1.000 (knot, test bed); Bistro keeps a residual
  −0.3 % / 100 f in the outer penumbra (the 10⁻³ bilinear weight of neighbouring texels mixes a carried g toward its
  neighbours every frame it isn't refreshed).
- **Recurrent ĥ**: the stored ĥ settles 1–4 % off the raw mean overall and **+12 % (knot), +18 % / +34 % (Bistro diffuse /
  specular) in contacts**, reached in ~150 frames (knot contact: 1.20 → 1.14 → 1.13 → 1.12 … over windows 0–4, then
  flat). Rounding changes it by ~1 %. The contact inflation is the recurrent design's re-filtering of ĥ (§4); it raises
  the blur radius cap c_h·hDenorm(ĥ) next to contacts by the same 12–34 % (the AO / SO contact numbers in §3.1 are the
  shipped SVGF path, which has no such cap).

### 3.3 f16 truncation: `'nearest'` minus native, same inputs

| scene | signal | filter | region | Δ PSNR (dB) | Δ bias | brightness native → nearest |
|---|---|---|---|---|---|---|
| knot-hold | visibility | shipped | all | -0.007 | +0.0002 | 1.0004 → 1.0007 |
| knot-hold | visibility | shipped | penumbra | -0.013 | +0.0016 | 1.0008 → 1.0038 |
| knot-hold | diffuse | shipped | all | +0.096 | +0.0010 | 0.9943 → 0.9993 |
| knot-hold | diffuse | shipped | contact | -0.018 | +0.0011 | 0.9991 → 1.0040 |
| knot-hold | diffuse | recurrent | all | +0.056 | +0.0014 | 0.9928 → 0.9995 |
| knot-hold | diffuse | recurrent | contact | -0.027 | +0.0015 | 0.9870 → 0.9937 |
| knot-hold | ao | shipped | all | +0.675 | +0.0032 | 0.9961 → 1.0003 |
| knot-hold | ao | shipped | contact | -0.110 | +0.0017 | 1.0133 → 1.0178 |
| glossy-hold | visibility | shipped | all | -0.022 | +0.0002 | 0.9999 → 1.0001 |
| glossy-hold | visibility | shipped | penumbra | -0.019 | +0.0019 | 0.9977 → 1.0013 |
| glossy-hold | diffuse | shipped | all | +0.114 | +0.0011 | 0.9893 → 0.9942 |
| glossy-hold | diffuse | shipped | contact | -0.111 | +0.0007 | 1.0301 → 1.0350 |
| glossy-hold | diffuse | recurrent | all | +0.194 | +0.0013 | 0.9877 → 0.9937 |
| glossy-hold | diffuse | recurrent | contact | +0.062 | +0.0009 | 0.9891 → 0.9955 |
| glossy-hold | specular | shipped | all | +0.027 | +0.0008 | 0.9853 → 0.9895 |
| glossy-hold | specular | shipped | glossy | +0.055 | +0.0007 | 0.9916 → 0.9959 |
| glossy-hold | specular | recurrent | all | +0.060 | +0.0008 | 0.9828 → 0.9875 |
| glossy-hold | specular | recurrent | glossy | +0.096 | +0.0008 | 0.9893 → 0.9943 |
| glossy-hold | ao | shipped | all | +0.623 | +0.0030 | 0.9968 → 1.0004 |
| glossy-hold | ao | shipped | contact | -0.161 | +0.0015 | 1.0055 → 1.0099 |
| glossy-hold | so | shipped | all | +0.168 | +0.0013 | 0.9983 → 1.0000 |
| glossy-hold | so | shipped | contact | +0.253 | +0.0007 | 0.9919 → 0.9942 |
| thin-hold | visibility | shipped | all | -0.148 | +0.0003 | 1.0021 → 1.0024 |
| thin-hold | visibility | shipped | penumbra | -0.158 | +0.0017 | 1.0126 → 1.0149 |
| thin-hold | diffuse | shipped | all | +0.016 | +0.0012 | 0.9920 → 0.9969 |
| thin-hold | diffuse | shipped | contact | -0.136 | +0.0007 | 1.0561 → 1.0610 |
| thin-hold | diffuse | recurrent | all | +0.051 | +0.0015 | 0.9870 → 0.9928 |
| thin-hold | diffuse | recurrent | contact | -0.070 | +0.0010 | 1.0151 → 1.0219 |
| thin-hold | specular | shipped | all | +0.019 | +0.0009 | 0.9923 → 0.9967 |
| thin-hold | specular | shipped | glossy | +0.056 | +0.0009 | 0.9939 → 0.9985 |
| thin-hold | specular | recurrent | all | +0.037 | +0.0008 | 0.9886 → 0.9932 |
| thin-hold | specular | recurrent | glossy | +0.086 | +0.0008 | 0.9922 → 0.9972 |
| thin-hold | ao | shipped | all | +0.101 | +0.0029 | 0.9973 → 1.0005 |
| thin-hold | ao | shipped | contact | -0.275 | +0.0016 | 1.0221 → 1.0265 |
| thin-hold | so | shipped | all | -0.136 | +0.0010 | 1.0000 → 1.0012 |
| thin-hold | so | shipped | contact | -0.023 | +0.0007 | 1.0018 → 1.0041 |
| bistro-hold | visibility | shipped | all | +0.003 | +0.0002 | 0.9998 → 1.0005 |
| bistro-hold | visibility | shipped | penumbra | +0.004 | +0.0013 | 0.9784 → 0.9815 |
| bistro-hold | diffuse | shipped | all | +0.009 | +0.0005 | 0.9917 → 0.9964 |
| bistro-hold | diffuse | shipped | contact | -0.023 | +0.0004 | 1.0499 → 1.0546 |
| bistro-hold | diffuse | recurrent | all | +0.011 | +0.0007 | 0.9821 → 0.9886 |
| bistro-hold | diffuse | recurrent | contact | -0.015 | +0.0005 | 1.0162 → 1.0223 |
| bistro-hold | specular | shipped | all | +0.034 | +0.0001 | 0.9801 → 0.9846 |
| bistro-hold | specular | shipped | glossy | +0.038 | +0.0001 | 0.9768 → 0.9811 |
| bistro-hold | specular | recurrent | all | +0.027 | +0.0001 | 0.9725 → 0.9785 |
| bistro-hold | specular | recurrent | glossy | +0.041 | +0.0001 | 0.9762 → 0.9825 |
| bistro-hold | ao | shipped | all | +0.071 | +0.0030 | 0.9973 → 1.0016 |
| bistro-hold | ao | shipped | contact | -0.076 | +0.0016 | 1.0238 → 1.0282 |

Truncation is a constant darkening of every rgba16float history, −0.5 % on diffuse, −0.4 % specular, −0.3 … −0.4 % AO,
−0.2 % SO, −0.6 … −0.7 % recurrent radiance (5 stores per frame in its loop), +0.2 … +0.4 % *darker* shadow penumbrae.
It **helps** where a filter is biased bright (contacts, thin's penumbrae, thin's SO: −0.1 … −0.3 dB when removed) and
costs elsewhere (AO open areas +0.6 … +2.4 dB, diffuse / specular +0.02 … +0.19 dB when removed). So it is a bias that
happens to cancel part of another bias in places, not a precision-neutral detail.

### 3.4 Same final view, two histories (arrive − hold, aligned hold windows, identical inputs)

| scene | signal | region | window 0 | window 1 | last window | note |
|---|---|---|---|---|---|---|
| glossy | all five (SVGF, recurrent) | all, contact | −0.17 … +0.35 dB | ≤ ±0.04 | ≤ ±0.02 | converged within one period |
| glossy | shadows | lit (55 dB) | −0.11 | −0.94 | −0.61 (`'nearest'`: −0.15) | truncation-stuck outer-penumbra history |
| glossy / thin | AO, SO (SVGF) | all | −0.06 … −0.17 | −0.01 … −0.02 | −0.01 … −0.02 (`'nearest'`: 0.00) | truncation-stuck |
| thin | shadows | lit | +0.05 | +0.18 | +0.19 (both modes) | g carried from the arc |
| thin | shadows | contact | −0.34 | −0.06 | +0.01 | converged |
| Bistro | diffuse, specular, AO | all, contact | −1.3 … +0.4 | ≤ ±0.06 | ≤ ±0.01 | converged |
| **Bistro** | **shadows** | **all** | **+0.29** | **+0.30** | **+0.27** (both modes) | **edge 0.821 vs 0.806; the hold from a reset creeps up 25.32 → 25.41 dB over 384 frames** |

(full per-window table: [data/distance-long-tables.md](data/distance-long-tables.md)).

## 4. Causes

1. **Truncating f16 stores** (Metal): one store per frame in an EMA of weight α leaves a steady loss of about
   ½ ulp / α (SVGF α = 0.1 → ~5 ulp ≈ 0.2 %; recurrent α = 1/32 with ~5 stores in the loop → ~0.7 %, measured). A value
   that is re-stored without new information loses up to a whole ulp per frame (the bilinear reprojection
   `Σ w h / Σ w` doesn't return h exactly) until it reaches a value the arithmetic maps to itself: g in rarely occluded
   pixels (saturates at −5 %), the stuck 1 − ulp lit histories. This is the TASKS item "Plain SVGF loses ~0.1–0.16 dB
   to f16 truncation", now measured for every filter and over long holds.
2. **Recurrent re-filtering of ĥ**: the post-blur output (rgb and ĥ, both blurred with the hit-distance tap weight) is
   the next frame's history, so at steady state ĥ is a fixed point of "blend 1/32 of the raw ĥ, then blur" — a wider
   effective blur than one pass, which pulls small contact ĥ toward the larger values around it.
3. **g is only learned from occluded samples**: a pixel the reference calls lit but that sometimes sees the occluder
   (outer penumbra) gets a few occluded samples per period; on a still camera it may take hundreds of frames to fill
   its g, while a moving camera that swept the same surface carried g in with it (sun light: g = h is
   camera-independent). Until it has its own g it uses its tile neighbourhood's nearest occluder, which is wider.

## 5. Candidates

| candidate | source | status |
|---|---|---|
| `f16Rounding: 'nearest'` on every f16 storage write (SVGF, recurrent, shadows, occlusion normalizer) | **our design** (LESSONS m8: rgba16float stores truncate, `pack2x16float` rounds to nearest, both measured on this GPU) | **built**, option, default `'store'` (byte-identical: the pass code is untouched); A/B §6 |
| shadows: don't re-store an unrefreshed g (keep the exact texel value, no bilinear mix, when no occluded sample arrived) | our design | not built: invisible over 2016 frames (§3.1); `'nearest'` already removes the decay on two of three scenes |
| recurrent: keep ĥ out of the post-blur (store the temporal ĥ as the history) or a separate unblurred ĥ channel | our design (the recurrent pipeline's own description, SPEC §5) | not built: recurrent is not a default; would change the radius cap and the virtual-motion depth. Follow-up in TASKS |
| shadows: g for rarely occluded pixels on a still camera (Bistro +0.27 dB after motion) | our design (e.g. a longer `maxScaleHistory` for pixels with few occluded samples, or seeding from the tile's nearest occluder) | not built: a convergence-speed question on hard sun edges, outside target D's "degrades over time"; TASKS follow-up |

## 6. Rule-9 A/B: `f16Rounding: 'nearest'` vs the default (tree of 73358ce: `youngNormalPower: 16`, shadows `snapHardPx: 2`, `backfacePass: true`)

Same inputs, variant ids in one page (`<id>@f16Rounding=nearest`, `shadows@sh.f16Rounding=nearest`,
`recurrent-*@r.f16Rounding=nearest`). Script: [data/distance-long-ab.mjs](data/distance-long-ab.mjs); raw tables in
[data/distance-long-tables.md](data/distance-long-tables.md).

**Test bed, 7 paths, 1920×1080, 256-spp references, FLIP every 12th frame** (pooled over the paths):

| signal | filter | PSNR native → nearest | Δ | worst path | Δ FLIP | Δ flicker | Δ penumbra (shadows) |
|---|---|---|---|---|---|---|---|
| diffuse | A-SVGF (shipped) | 38.501 → 38.571 | **+0.070** | +0.017 (thin) | **−4.3 %** | 0.0 % | – |
| specular | A-SVGF (shipped) | 34.994 → 35.011 | +0.018 | −0.002 (orbit) | −1.4 % | 0.0 % | – |
| shadows | v2.2 (shipped) | 37.867 → 37.819 | **−0.048** | **−0.142 (thin)** | +0.5 % | 0.0 % | −0.049 (thin −0.158) |
| AO | occlusion A-SVGF (shipped) | 38.527 → 38.715 | **+0.188** | +0.086 (thin) | **−17.0 %** | −0.7 % | – |
| SO | occlusion A-SVGF (shipped) | 39.297 → 39.296 | −0.001 | −0.090 (light) | −4.2 % | −1.0 % | – |
| diffuse | recurrent (option) | 37.883 → 38.011 | +0.128 | +0.044 | −10.2 % | +0.4 % | – |
| specular | recurrent (option) | 34.095 → 34.121 | +0.026 | +0.009 | −2.7 % | −0.3 % | – |

**4096-spp references** (E-1 setup `refspp=4096&ref2spp=256&ref2salt=0`, 960×540, `orbit` / `light` / `glossy`): diffuse
42.980 → 43.197 (**+0.217**, worst +0.193), specular 35.031 → 35.052 (+0.021, worst −0.003), AO 42.338 → 42.759
(**+0.420**, worst +0.251). As E-1 predicted, the 256-spp references shrink the gains 2–3×.

**Real-scene captures** (replays, score-captures.mjs; `three-orbit`, `three-pan`, `three-knot-static`, `bistro-orbit`,
`bistro-move`, `sponza-orbit`): diffuse +0.004 dB (worst −0.005), specular +0.008 (−0.004), shadows −0.001 (−0.006), AO
+0.027 (+0.008); FLIP −0.5 / −0.2 / −0.1 / −4.8 %; boil +0.2 / +0.1 / 0.0 / +0.1 %. Long holds (§3.3): boil −0.3 … +0.5 %
on every signal.

**Cost** (1080p, one denoiser per page, 100 frames, GPU lock held): A-SVGF diffuse 2.659 / 2.631 → 2.643 / 2.645 ms
(two alternating pairs: within noise), occlusion AO 1.833 → 1.833 ms, shadows 0.641 → 0.652 ms (+1.7 %, the temporal
pass +0.03 ms). Other agents' headless pages were not excluded, so read these as "no measurable cost", not as timings.

**Byte-identity of the default:** replays of `std540-orbit` and `std540-thin` through `svgf-auto` (diffuse + specular),
`shadows`, `occlusion-svgf-auto` (AO), `recurrent-diffuse` and `occlusion-recurrent` (SO), built from 73358ce^ and
73358ce (git archives, own servers): all 160 output files byte-identical (and two runs of the same build too). The
`'store'` path passes the WGSL through untouched, so this holds by construction as well.

**Verdict.**

- **A-SVGF diffuse, specular, AO, SO (shipped) and recurrent (option): passes rule 9** on every clause (worst pooled
  Δ −0.001 dB SO; per path worst −0.09 dB SO `light`; FLIP −0.2 … −17 %; boil / flicker ≤ +0.5 %; cost ≤ noise), with
  the gains confirmed at 4096 spp (+0.22 diffuse, +0.42 AO). It changes the look slightly: every SVGF output gets
  0.2–0.5 % brighter (the truncation darkening goes away), contacts that were already a little too bright get a
  little brighter. **Proposed flip (Dennis):** `f16Rounding: 'nearest'` as the default of the SVGF pipeline
  (DiffuseDenoiser, SpecularDenoiser, DiffuseSpecularDenoiser, OcclusionDenoiser 'svgf') and of the recurrent pipeline.
  On a GPU whose f16 stores already round to nearest it is a no-op (§8 checks that on RTX).
- **Shadows: no flip.** Pooled −0.048 dB is inside the −0.1 dB clause, but it loses on all 7 paths (thin −0.14,
  thin penumbra −0.16) for no gain anywhere: the truncation's darker history cancels part of v2.2's bright penumbra
  bias (thin penumbra bias +0.009, §3.1). The g decay it would fix is invisible (§3.2). Keep `'store'`; the option stays
  for the RTX comparison.


## 7. Reproduce (Mac)

```sh
# captures (GPU lock, rule 11): test bed paths and Bistro hold
node examples/realtime-denoiser/run-headless.mjs "mode=capture&name=dl-glossy&path=glossy-arrive&signal=diffuse,specular,shadows,ao,so&refspp=256"
node examples/realtime-denoiser/run-headless.mjs "mode=capture&name=dl-thin&path=thin-arrive&signal=diffuse,specular,shadows,ao,so&refspp=256"
(cd examples/three-temporal && node run-realtime.mjs capture --port=<p> --set=bistro-hold --refShadow=128 --refDiffuse=128 --refSpec=32 --chunk=8)
# loop captures (CPU, symlinks + averaged hold references) and the probe matrix
node examples/realtime-denoiser/distance-long.mjs loops
BASE=http://127.0.0.1:<port>/distance.html node examples/realtime-denoiser/distance-long.mjs run --out=<dir>
node examples/realtime-denoiser/distance-long.mjs table --out=<dir> --md=<file>
```

## 8. Windows / RTX repeat (native round)

Purpose: separate the Metal-only effects (§3.3, the g decay, the stuck states) from the filter's own (recurrent ĥ,
Bistro g learning). If D3D12 rounds f16 stores to nearest, `'store'` and `'nearest'` must give **identical** outputs there
(one pack/unpack of an already rounded value is exact), and the §3.3 deltas must vanish. Copy (or regenerate)
`dl-glossy`, `dl-thin`, `three-knot-still`, `bistro-orbit`, `bistro-hold` (≈ 21 GB), then on the RTX machine:

```powershell
$env:RT_CAPTURE_DIR = "C:\dev\nrd-reference"
node examples/realtime-denoiser/distance-long.mjs loops
# dev server of examples/realtime-denoiser on a free port, then:
$env:BASE = "http://127.0.0.1:5220/distance.html"
node examples/realtime-denoiser/distance-long.mjs run --out=out\distance-long-rtx --only="__(visibility|diffuse|ao)__"
node examples/realtime-denoiser/distance-long.mjs table --out=out\distance-long-rtx --md=out\distance-long-rtx.md
```

Compare with [data/distance-long-tables.md](data/distance-long-tables.md): the f16 table should read 0 everywhere on RTX
if its stores round to nearest; the recurrent contact ĥ (+12 … +34 %) and the Bistro arrive − hold shadow gap should
remain (they are not precision effects).

## 9. Caveats

- The hold inputs repeat with period 32–63 frames. Blue noise in a real renderer also repeats or is low-discrepancy;
  every history cap under test is shorter than the period, so the loop changes nothing a filter can see — but a
  second-period or longer correlation in a real renderer is not tested.
- References of the holds are means of 32–63 per-frame references (4 k–64 k samples): the PSNR column carries a small
  reference floor (test bed ≥ 50 dB, knot visibility ≥ 55 dB); the arrive − hold and nearest − native deltas share it
  and cancel it.
- The Bistro visibility PSNR (25 dB) is low in absolute terms (hard sun edges, thin geometry, a 960×540 view); target D
  only uses its changes over time and between runs.
- The test bed's `ao_ref` / `so_ref` capture buffers are extras outside CAPTURE-FORMAT v0 (validate.mjs warns, v0
  readers ignore them), like the three-temporal captures' `ao_ref`.
