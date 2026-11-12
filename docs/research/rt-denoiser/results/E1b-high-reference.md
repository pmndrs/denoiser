# E-1b: high-reference leftovers, and two option A/Bs at 4096 spp

_e1b evaluator (RULES.md rule 8: no NRD code, README, release notes or port read), 2026-10-26. Everything here was
measured on our own test bed. It closes E-1's leftovers (diffuse / specular on `thin` and `cut`, 4096-spp noise floors
there) and re-scores the two open T1 options against 4096-spp references, as TASKS rule 9 asks for diffuse, specular
and AO: SVGF `youngNormalPower: 16` (T1 §5.1, SPEC §12 item 15, decision q18) and recurrent `historyFix: 'spatial'`
(T1 §5.2, decision q19). No denoiser code changed._

## Conclusion first

- **No ranking or rule-9 verdict changes at 4096 spp.** Every sign that held at 256 spp holds at 4096, on every path,
  arm and signal, including the near-ties (`youngNormalPower` on `light` −0.003 → −0.010 dB, specular `thin` recurrent vs
  SVGF +0.01 → +0.04).
- **E-1 leftovers (§1).** On `thin` and `cut`, recurrent's diffuse deficit to A-SVGF `auto` is −0.62 → **−2.09 dB**,
  plain SVGF's −0.17 → −0.67; specular −0.89 → −1.57 and −1.32 → −2.18. Over all **7 paths** now: diffuse recurrent vs
  `auto` −0.86 → **−2.39 dB**, SVGF vs `auto` −0.24 → **−0.86**; specular −0.94 → **−1.81** and −1.59 → **−2.63**. The
  theory check (MSE@256 − MSE@4096 = σ²_256 − σ²_4096) holds on both paths (ratio 0.95–1.06).
- **Surprise: `thin`'s diffuse reference is far noisier than the other paths'.** Its 256-spp floor is 31.75 dB (ceiling
  **34.8 dB**, while our filters scored 34.2–34.5 there: every `thin` diffuse number at 256 spp was pinned to the
  ceiling), and even its 4096-spp floor is only 41.37 dB (ceiling 44.4; other paths 53–54). The diffuse reference
  variance falls only ×9 from 256 to 4096 spp on `thin` (×31 elsewhere). A-SVGF's `thin` diffuse is 41.93 dB measured
  but **45.6 dB "true"**: on `thin`, even 4096 spp hides 3.7 dB. Use the "true" column or a 16k reference there.
- **`youngNormalPower: 16` (§2): still passes rule 9, still neutral by the numbers.** Mean of `orbit` / `light` /
  `glossy`: pooled +0.001 → **+0.003 dB**, disoccluded +0.03 → **+0.06**, FLIP ±0.0 %, flicker ±0 (at the test bed's
  4-digit resolution), "true" ±0.00. `cut` / `pan`: pooled +0.011 / +0.019, disoccluded on `cut` +0.12; the frame after
  the cut −0.08 → **−0.14 dB**, the 8-frame post-cut window −0.01 → −0.02. Young-pixel PSNR on 540p captures +0.05…+0.14
  (was +0.03…+0.09), young boil −0…−4 %, settled boil ±0. The q18 proposal stands as written; only its numbers get the
  4096 column (TASKS).
- **`historyFix: 'spatial'` (§3): its gains roughly double, its cut-frame loss grows, and the boil question changes.**
  - 4096 spp, 4 paths (`orbit` / `light` / `glossy` / `cut`): diffuse pooled +0.14 → **+0.34 dB**, disoccluded +0.29 →
    **+0.49**; specular +0.07 → +0.12; AO +0.18 → **+0.39** (disoccluded +0.60 → +0.82); SO +0.14 → +0.16. `pan`
    diffuse +0.20 → +0.39, disoccluded +0.46 → +0.87. FLIP −0.5 % (AO −0.8 %).
  - The frame right after the cut: diffuse −1.26 → **−1.91 dB**, specular −0.41 → −0.67, SO −1.43 (unchanged), AO
    −0.20. Pooled over the 8 frames after the cut (mean MSE) it stays behind: diffuse −0.15 → −0.31, specular −0.07,
    SO −0.69; AO ahead +0.79. From frame 1 on it is ahead.
  - **Boil vs the reference (Dennis's question).** Against a 4096-spp reference, young-pixel diffuse boil is
    **above** the reference's own on the moving-camera windows for every arm (A-SVGF 1.1–3.5×, spatial 1.1–3.5× the
    4096 reference's boil; recurrent mips 1.7–3.4×, the one exception being mips on `pan` at 0.77×); specular
    straddles its still-noisy 4096 reference (0.86–1.4×). The 256-spp reference boiled 2–5× more than the 4096 one (young
    diffuse 0.0076–0.0111 vs 0.0014–0.0048), which is what made filters look "below the reference's level" in T1. So
    for young pixels the "below the reference" case mostly disappears: the spatial fix's extra young boil (+7 % `orbit`,
    **+38 % `pan`**, specular +6 %) moves the output *away* from the clean reference (`pan`: mips 0.0037 sat under the
    reference's 0.0048, spatial 0.0051 sits above it), while staying at or under the shipped A-SVGF default's young
    boil on every window. Settled pixels: every arm boils at or below the 4096 reference (A-SVGF 0.73–1.03×, recurrent
    0.53–0.74×); the spatial fix adds +1…+3 % there.
  - Rule 9 by the letter: PSNR / FLIP pass with larger margins; the boil clause still fails (young +7…+38 % diffuse);
    the frame after a cut loses more. The q19 recommendation (keep `'mips'` unless Dennis accepts the boil) is
    unchanged; the question to Dennis is now "young-pixel boil that rises toward, and on `pan` past, a clean reference's
    own level, but stays at or below the default filter's", not "boil below the reference's level".

## 1. E-1 leftovers: `thin` and `cut` at 4096 spp

Setup exactly as [E1-high-reference.md](E1-high-reference.md) §1: 1920×1080, 96 frames, FLIP every 12th frame, arms
`svgf` (`antiLag: 'off'`), `svgf-auto`, `recurrent`, `accumulate-32` scored against the 4096-spp reference and the
standard 256-spp one in the same page (`&refspp=4096&ref2spp=256&ref2salt=0`); floors from two independent sets
(`&ref2salt=1`, 4096: first 32 frames, all five signals). Code: a `git archive` snapshot of 7ea3928 (package code =
694937c; TASKS-only commit on top) served on its own port with `server.hmr: false`. Its 256-spp scores reproduce
REMEASURE (7a8b980) to the 4th decimal on both paths (e.g. `svgf-auto` `thin` diffuse 34.4690, `cut` specular
34.8071), so these rows merge with E-1's five paths. The previous attempt lost its GPU device under another agent's
2048-spp captures; on a quiet GPU both pages ran in ~20 min (3 pages in parallel).

### 1.1 Noise floors on `thin`, `cut` (and `pan`)

Two independent references of the same frames, pooled PSNR (dB); ceiling = floor + 3.01 dB (E-1 §2).

| signal | `thin` 256 | `thin` 4096 | `cut` 256 | `cut` 4096 | `pan` 256 | `pan` 4096 | E-1 mean of `orbit` / `light` / `glossy`, 256 → 4096 |
|---|---|---|---|---|---|---|---|
| diffuse | **31.75** | **41.37** | 38.27 | 53.42 | 38.10 | 52.78 | 38.65 → 53.56 |
| specular | 34.86 | 42.72 | 34.72 | 42.79 | 35.80 | 44.49 | 33.88 → 43.43 |
| shadows | 41.82 | 57.47 | 46.19 | 61.41 | – | – | 46.12 → 61.26 |
| AO | 33.18 | 44.15 | 38.99 | 49.43 | 38.18 | 51.60 | 39.15 → 50.88 |
| SO | 43.83 | 57.93 | 47.86 | 61.20 | 46.51 | 59.11 | 46.25 → 60.38 |

(`pan` floors were measured for §2–3; its shadows floor was not.) On `thin` every signal's reference is 4–12 dB
noisier than on the other paths; diffuse worst, and its variance drops only ×9 from 256 to 4096 spp (others ×31).
A likely cause (not verified): `thin`'s fence slats put sub-pixel depth / normal edges in many pixels, so the
per-pixel integrand is far less smooth and the stratified primary sample that helps elsewhere helps little. The E-1 thin rows for shadows and AO (§6
there) are fine (ceilings 60.5 / 47.2 dB at 4096); diffuse on `thin` is reference-limited even at 4096.

### 1.2 Re-score, 256 → 4096 spp

Pooled PSNR (dB) per path, mean of the two paths, disoccluded region (age < 8), FLIP and fixed-pixel flicker, and the
"true" score per path (PSNR of MSE@4096 − σ²_4096).

**Diffuse**

| denoiser | `thin` | `cut` | mean 256 | mean 4096 | Δ | true (`thin` / `cut`) | disocc. 256 → 4096 | FLIP 256 → 4096 | flicker 256 → 4096 |
|---|---|---|---|---|---|---|---|---|---|
| noisy input | 16.82 → 16.86 | 14.31 → 14.32 | 15.56 | 15.59 | +0.03 | | 16.69 → 16.70 | 0.313 → 0.316 | 0.1231 → 0.1226 |
| `svgf` | 34.41 → 41.54 | 39.71 → 44.44 | 37.06 | 42.99 | +5.93 | 44.73 / 44.72 | 38.24 → 42.02 | 0.0393 → 0.0295 | 0.0043 → 0.0031 |
| `svgf-auto` | 34.47 → 41.93 | 40.00 → 45.39 | **37.23** | **43.66** | +6.43 | **45.59 / 45.75** | 38.29 → 42.14 | 0.0369 → 0.0251 | 0.0040 → 0.0027 |
| `recurrent` | 34.16 → 40.41 | 39.06 → 42.73 | 36.61 | 41.57 | +4.96 | 42.63 / 42.92 | 37.25 → 40.01 | 0.0435 → 0.0348 | 0.0049 → 0.0037 |
| `accumulate-32` | 27.40 → 28.15 | 25.03 → 25.12 | 26.21 | 26.64 | +0.43 | 28.26 / 25.13 | 21.07 → 21.12 | 0.0769 → 0.0741 | 0.0343 → 0.0336 |

**Specular**

| denoiser | `thin` | `cut` | mean 256 | mean 4096 | Δ | true (`thin` / `cut`) | disocc. 256 → 4096 | FLIP 256 → 4096 | flicker 256 → 4096 |
|---|---|---|---|---|---|---|---|---|---|
| noisy input | 17.05 → 17.07 | 15.43 → 15.43 | 16.24 | 16.25 | +0.01 | | 16.69 → 16.71 | 0.181 → 0.183 | 0.1122 → 0.1121 |
| `svgf` | 35.41 → 38.22 | 32.69 → 34.10 | 34.05 | 36.16 | +2.11 | 39.06 / 34.41 | 34.49 → 36.89 | 0.0501 → 0.0447 | 0.0040 → 0.0034 |
| `svgf-auto` | 35.93 → 39.29 | 34.81 → 37.39 | **35.37** | **38.34** | +2.97 | **40.40 / 38.06** | 35.03 → 37.76 | 0.0461 → 0.0407 | 0.0039 → 0.0032 |
| `recurrent` | 35.42 → 38.26 | 33.54 → 35.28 | 34.48 | 36.77 | +2.29 | 39.12 / 35.68 | 33.79 → 35.68 | 0.0520 → 0.0479 | 0.0050 → 0.0044 |
| `accumulate-32` | 26.39 → 26.65 | 22.38 → 22.50 | 24.39 | 24.57 | +0.18 | 26.70 / 22.52 | 22.17 → 22.27 | 0.1054 → 0.1042 | 0.0210 → 0.0207 |

Gaps to `svgf-auto` (dB, 256 → 4096): diffuse `svgf` `thin` −0.06 → −0.39, `cut` −0.29 → −0.95; `recurrent` `thin`
−0.30 → −1.53, `cut` −0.94 → −2.66. Specular `svgf` `thin` −0.52 → −1.07, `cut` −2.12 → −3.29; `recurrent` `thin`
−0.51 → −1.03, `cut` −1.27 → −2.11. The only near-tie, specular `thin` recurrent vs SVGF, keeps its sign (+0.01 → +0.04).

Theory check (E-1 §5): measured ΔMSE / predicted σ²_256 − σ²_4096 = 0.98–0.99 diffuse (0.96 for `accumulate-32`),
1.00–1.01 specular `thin`, 1.02–1.06 specular `cut` (heavy-tailed reference, 32-frame 4096 floor, as in E-1).

### 1.3 Seven paths (E-1 §6 completed)

E-1's five paths (`orbit`, `pan`, `light`, `glossy`, `object`; snapshot 7a8b980) plus `thin` and `cut` (above; same
outputs, §1 setup). Mean of per-path pooled dB:

| signal | denoiser | mean 256 | mean 4096 | Δ | disocc. 256 → 4096 | FLIP 256 → 4096 | flicker 256 → 4096 | gap to best @256 → @4096 |
|---|---|---|---|---|---|---|---|---|
| diffuse | `svgf-auto` | **39.12** | **44.91** | +5.79 | 37.69 → 40.99 | 0.0332 → 0.0246 | 0.0031 → 0.0020 | best |
| diffuse | `svgf` | 38.88 | 44.05 | +5.17 | 37.57 → 40.79 | 0.0357 → 0.0287 | 0.0035 → 0.0025 | −0.24 → **−0.86** |
| diffuse | `recurrent` | 38.26 | 42.52 | +4.26 | 36.41 → 38.66 | 0.0407 → 0.0350 | 0.0038 → 0.0027 | −0.86 → **−2.39** |
| diffuse | `accumulate-32` | 26.63 | 26.88 | +0.25 | 20.16 → 20.20 | 0.0758 → 0.0746 | 0.0265 → 0.0260 | −12.49 → −18.03 |
| specular | `svgf-auto` | **35.04** | **38.29** | +3.25 | 34.96 → 37.16 | 0.0464 → 0.0402 | 0.0037 → 0.0031 | best |
| specular | `recurrent` | 34.10 | 36.48 | +2.38 | 33.60 → 35.06 | 0.0521 → 0.0476 | 0.0047 → 0.0041 | −0.94 → **−1.81** |
| specular | `svgf` | 33.46 | 35.66 | +2.21 | 34.11 → 35.89 | 0.0511 → 0.0451 | 0.0042 → 0.0036 | −1.59 → **−2.63** |
| specular | `accumulate-32` | 24.13 | 24.34 | +0.21 | 21.94 → 22.01 | 0.1070 → 0.1060 | 0.0185 → 0.0182 | −10.91 → −13.95 |

For SPEC §0.2 / §12 items 1–2 (which quote E-1's 5-path numbers): recurrent vs `auto` diffuse −2.51 (5 paths) →
**−2.39** (7), specular −1.91 → **−1.81**; `antiLag: 'auto'` vs `'off'` diffuse +0.93 → **+0.86**, specular +2.81 →
**+2.63**. `thin` pulls every 7-path gap in because its reference is the noisiest. Occlusion and shadows were already
on 7 paths in E-1 §6. Per path, no ordering flips anywhere.

## 2. SVGF `youngNormalPower: 16` vs default at 4096 spp

Live test bed, §1 setup, both arms (and §3's) in one page per path so they share references: `svgf-auto` (the shipped
default) vs `svgf-auto@youngNormalPower=16`, diffuse + specular, `orbit` / `light` / `glossy` / `cut` / `pan`.
Specular is byte-identical between the arms (as T1 §5.1 says) and is left out below.

| path | pooled base 256 → 4096 | Δ pooled | disocc. base | Δ disocc. | frame after cut Δ | post-cut window Δ | FLIP Δ (4096) |
|---|---|---|---|---|---|---|---|
| `orbit` | 40.974 → 46.276 | +0.004 → +0.013 | 38.24 → 41.70 | +0.03 → +0.07 | | | ±0.0 % |
| `light` | 40.935 → 46.715 | −0.003 → **−0.010** | | | | | ±0.0 % |
| `glossy` | 39.713 → 46.475 | +0.001 → +0.005 | 36.27 → 38.72 | +0.03 → +0.05 | | | ±0.0 % |
| `cut` | 39.995 → 45.390 | +0.003 → +0.011 | 38.29 → 41.81 | +0.05 → +0.12 | −0.08 → **−0.14** | −0.01 → −0.02 | ±0.0 % |
| `pan` | 39.650 → 44.609 | +0.006 → +0.019 | 38.17 → 42.31 | −0.00 → −0.00 | | | ±0.0 % |
| mean 3 (`orbit`/`light`/`glossy`) | 40.541 → 46.489 | +0.001 → **+0.003** | 37.26 → 40.21 | +0.03 → **+0.06** | | | ±0.0 % |
| mean 5 | 40.253 → 45.893 | +0.002 → +0.007 | 37.74 → 41.14 | +0.03 → +0.06 | | | ±0.0 % |

"Frame after cut" = the cut frame itself (path frame 48); "post-cut window" = PSNR of the mean per-frame MSE over
frames 48–55. Per-frame after the cut at 4096 (frames 48–52): −0.14, −0.09, +0.12, +0.03, ±0.00 dB. Fixed-pixel and
motion-compensated flicker: identical at the 4 decimals the test bed reports (so within about ±3 % at these levels).
"True" (MSE − σ²_4096) Δ: −0.00 dB mean of 3, +0.01 mean of 5. Theory check ratios 0.96–1.04 for both arms.

**Young pixels and boil** (§4 captures: 960×540, same noisy frames scored against 4096- and 256-spp references;
age < 8 = young, ≥ 17 = settled):

| window | Δ young PSNR 256 → 4096 | Δ settled | Δ all | FLIP young (4096) | boil young | boil settled |
|---|---|---|---|---|---|---|
| `cut` (path frames 16–79) | +0.06 → +0.10 | ±0.00 | +0.02 → +0.04 | ±0 % | −0 % | −0 % |
| `pan` (0–47) | +0.09 → +0.14 | ±0.00 | +0.04 → +0.07 | −1 % | −2 % | −0 % |
| `orbit` (0–47) | +0.06 → +0.10 | ±0.00 | +0.02 → +0.05 | ±0 % | −0 % | −0 % |
| `light` (24–71) | +0.05 → +0.09 | −0.00 → −0.01 | +0.01 → +0.02 | ±0 % | −4 % | −0 % |
| `glossy` (0–47) | +0.03 → +0.05 | ±0.00 | +0.01 | +1 % | −4 % | ±0 % |

**Rule 9 at 4096 spp: passes** (worst pooled −0.010 dB on `light`, FLIP ±0, flicker ±0, boil equal or lower). The
real-scene captures (T1 §5.1: +0.22…+0.32 dB, young boil −15 %) were not re-scored (no 4096-spp references for them in
this run); the quiet-GPU cost check that the proposal also asks for was not part of this brief.

## 3. Recurrent `historyFix: 'spatial'` vs `'mips'` at 4096 spp

Same pages as §2 (`recurrent` vs `recurrent@r.historyFix=spatial`), plus occlusion pages (`occlusion-recurrent` vs
`occlusion-recurrent@o.historyFix=spatial`, signals `ao` / `so`, `occlusion-svgf-auto` alongside for context).

| signal | path | pooled base 256 → 4096 | Δ pooled | disocc. base | Δ disocc. | frame after cut Δ | post-cut window Δ | FLIP Δ (4096) |
|---|---|---|---|---|---|---|---|---|
| diffuse | `orbit` | 39.791 → 43.116 | +0.218 → +0.486 | 36.83 → 39.02 | +0.27 → +0.46 | | | −0.9 % |
| diffuse | `light` | 39.896 → 43.631 | +0.117 → +0.282 | | | | | −0.3 % |
| diffuse | `glossy` | 39.699 → 46.368 | +0.015 → +0.072 | 35.78 → 37.92 | +0.30 → +0.50 | | | ±0.0 % |
| diffuse | `cut` | 39.057 → 42.731 | +0.209 → +0.506 | 36.86 → 39.07 | +0.30 → +0.51 | −1.26 → **−1.91** | −0.15 → **−0.31** | −0.9 % |
| diffuse | `pan` | 38.199 → 41.101 | +0.196 → +0.393 | 36.66 → 39.14 | +0.46 → +0.87 | | | −2.9 % |
| diffuse | **mean 4** | 39.611 → 43.961 | +0.140 → **+0.337** | 36.49 → 38.67 | +0.29 → **+0.49** | | | −0.5 % |
| specular | `orbit` | 32.829 → 34.521 | +0.069 → +0.102 | 30.94 → 32.56 | +0.11 → +0.16 | | | −0.4 % |
| specular | `light` | 34.350 → 37.443 | +0.116 → +0.238 | | | | | ±0.0 % |
| specular | `glossy` | 34.654 → 37.736 | −0.001 → −0.002 | 33.64 → 34.13 | +0.08 → +0.09 | | | ±0.0 % |
| specular | `cut` | 33.541 → 35.277 | +0.081 → +0.122 | 31.41 → 32.78 | +0.09 → +0.13 | −0.41 → **−0.67** | −0.03 → −0.07 | −0.2 % |
| specular | `pan` | 34.452 → 36.088 | +0.086 → +0.126 | 37.11 → 39.02 | +0.71 → +1.15 | | | −0.8 % |
| specular | **mean 4** | 33.844 → 36.244 | +0.066 → **+0.115** | 32.00 → 33.16 | +0.09 → +0.13 | | | −0.2 % |
| AO | `orbit` | 38.587 → 41.506 | +0.260 → +0.524 | 33.32 → 34.93 | +0.45 → +0.66 | | | −1.4 % |
| AO | `light` | 39.530 → 43.918 | +0.136 → +0.384 | | | | | −0.8 % |
| AO | `glossy` | 40.888 → 43.644 | +0.035 → +0.068 | 35.25 → 36.10 | +0.87 → +1.09 | | | ±0.0 % |
| AO | `cut` | 38.805 → 41.386 | +0.305 → +0.570 | 33.75 → 35.18 | +0.49 → +0.70 | −0.17 → −0.20 | +0.52 → +0.79 | −1.3 % |
| AO | **mean 4** | 39.452 → 42.613 | +0.184 → **+0.386** | 34.11 → 35.40 | +0.60 → **+0.82** | | | −0.8 % |
| SO | `orbit` | 38.304 → 38.591 | +0.227 → +0.243 | 34.40 → 34.67 | +0.08 → +0.08 | | | ±0.0 % |
| SO | `light` | 42.431 → 43.176 | +0.299 → +0.358 | | | | | ±0.0 % |
| SO | `glossy` | 38.234 → 38.774 | −0.062 → −0.071 | 35.04 → 35.27 | +0.75 → +0.80 | | | ±0.0 % |
| SO | `cut` | 36.927 → 37.097 | +0.092 → +0.096 | 34.29 → 34.51 | +0.07 → +0.08 | −1.43 → **−1.43** | −0.68 → −0.69 | ±0.0 % |
| SO | **mean 4** | 38.974 → 39.409 | +0.139 → +0.156 | 34.58 → 34.82 | +0.30 → +0.32 | | | ±0.0 % |

AO contact region (ref ĥ < 0.5), 256 → 4096: `orbit` 29.22 → 29.64 vs 30.06 → 30.57, `light` 32.38 → 33.27 vs
33.06 → 34.12, `glossy` 36.47 → 38.52 vs 36.65 → 38.82, `cut` 29.53 → 29.96 vs 30.49 → 31.03 (base vs spatial).
"True" Δ (MSE − σ²_4096), mean of 3 / of all paths: diffuse +0.30 / +0.37, specular +0.13 / +0.13, AO +0.36 / +0.43,
SO +0.18 / +0.16 dB. Theory check ratios 0.95–1.02.

After the cut, diffuse at 4096 (path frames 48–52): mips 39.96, 40.97, 41.66, 41.85, 43.01; spatial **38.06**, 41.20,
42.09, 42.19, 43.14 dB. The single cut frame loses 1.9 dB and the next ones win 0.1–0.4, so the 8-frame window still
reads −0.31 dB in MSE terms. (At the path's first reset, frame 0, the spatial fix wins: T1 §5.2.) Fixed-pixel flicker
−1.2 % diffuse, −0.7 % specular (4-digit resolution, ±3 %).

### 3.1 Young-pixel and settled boil next to the reference's own

From the §4 captures (boil = RMS second temporal difference of the output along the reprojection taps / √6, young =
ages 2–7, settled = age ≥ 17; the reference's boil is the same statistic of the capture's reference in the same
pixels). Output boil does not depend on the reference; only the reference's own boil changes between the two capture
sets (inputs byte-identical).

**Diffuse**

| window | ref boil young 256 / **4096** | `svgf-auto` (default) | `youngNormalPower: 16` | recurrent `'mips'` | `'spatial'` (Δ) | ref boil settled 256 / **4096** | `svgf-auto` | mips | spatial (Δ) |
|---|---|---|---|---|---|---|---|---|---|
| `cut` | 0.0079 / **0.0028** | 0.0099 | 0.0099 | 0.0096 | 0.0097 (+2 %) | 0.0083 / **0.0030** | 0.0029 | 0.0021 | 0.0021 (+1 %) |
| `orbit` | 0.0089 / **0.0041** | 0.0080 | 0.0080 | 0.0069 | 0.0074 (+7 %) | 0.0074 / **0.0037** | 0.0038 | 0.0027 | 0.0028 (+3 %) |
| `pan` | 0.0111 / **0.0048** | 0.0053 | 0.0052 | **0.0037** | **0.0051 (+38 %)** | 0.0095 / **0.0034** | 0.0032 | 0.0025 | 0.0025 (+3 %) |
| `glossy` | 0.0076 / **0.0014** | 0.0035 | 0.0033 | 0.0033 | 0.0034 (+2 %) | 0.0083 / **0.0015** | 0.0011 | 0.0008 | 0.0009 (+3 %) |
| `light` | 0.0001 / 0.0000 | 0.0022 | 0.0021 | 0.0023 | 0.0023 (−0 %) | 0.0012 / 0.0012 | 0.0009 | 0.0007 | 0.0007 (−0 %) |

**Specular**

| window | ref boil young 256 / **4096** | `svgf-auto` | recurrent `'mips'` | `'spatial'` (Δ) | ref boil settled 256 / **4096** | `svgf-auto` | mips | spatial (Δ) |
|---|---|---|---|---|---|---|---|---|
| `cut` | 0.0145 / **0.0087** | 0.0118 | 0.0108 | 0.0114 (+6 %) | 0.0157 / **0.0097** | 0.0080 | 0.0072 | 0.0072 (+0 %) |
| `orbit` | 0.0150 / **0.0092** | 0.0125 | 0.0113 | 0.0120 (+6 %) | 0.0163 / **0.0110** | 0.0096 | 0.0078 | 0.0079 (+1 %) |
| `pan` | 0.0194 / **0.0160** | 0.0137 | 0.0145 | 0.0154 (+6 %) | 0.0150 / **0.0093** | 0.0070 | 0.0079 | 0.0079 (−0 %) |
| `glossy` | 0.0098 / **0.0042** | 0.0037 | 0.0050 | 0.0052 (+2 %) | 0.0118 / **0.0045** | 0.0024 | 0.0040 | 0.0041 (+1 %) |
| `light` | 0.0001 / 0.0000 | 0.0032 | 0.0044 | 0.0041 (−8 %) | 0.0031 / 0.0031 | 0.0025 | 0.0029 | 0.0029 (+0 %) |

Reading:

- **The 256-spp reference's own boil was mostly its noise.** Young diffuse 0.0076–0.0111 at 256 spp vs 0.0014–0.0048
  at 4096 (moving-camera windows). T1's "the spatial fix's young boil is far below the reference's own (0.0058–0.0111)"
  compared against that noise.
- **Against 4096, young pixels of every filter boil above the reference** on the moving-camera windows (diffuse):
  A-SVGF 1.1–3.5×, recurrent mips 0.8–3.4× (only `pan` under it), spatial 1.1–3.5×. The spatial fix's increase is a
  step away from the clean reference on `orbit` (0.0069 → 0.0074, reference 0.0041) and `pan` (from 0.77× to 1.06× of
  the reference), but it never exceeds the shipped default's young boil (`pan` 0.0051 vs 0.0053, `orbit` 0.0074 vs
  0.0080, `cut` 0.0097 vs 0.0099, `glossy` 0.0034 vs 0.0035; `light` 0.0023 vs 0.0022, equal at this precision).
- **Settled pixels** of every arm boil at or under the 4096 reference (A-SVGF 0.73–1.03×, recurrent 0.53–0.74×); the
  spatial fix adds +1…+3 % there on the test bed (T1: +6.6 % on the real scene, not re-measured).
- **Specular's 4096 reference still boils** (its variance only falls ×9, E-1 §2), and the arms straddle it: young
  specular boil is 1.2–1.4× the 4096 reference on `cut` and `orbit` (all three arms), 0.86–0.96× on `pan`, and on
  `glossy` A-SVGF 0.88× vs recurrent 1.2×. At 256 spp every arm was under the reference everywhere.
- `light` has a static camera: the reference is the same stratified estimate every frame (fixed per-pixel seeds), so
  its own boil is 0 except where the light actually changes; it is no noise floor there.
- A reference's boil is not a pure noise floor either: on moving windows it contains the real second difference that
  nearest-tap reprojection of detailed content produces. So the 4096 value is close to (an upper bound of) the boil a
  perfect output would have; an output above it is boiling, one below it is smoothing real change.

**Verdict at 4096 spp:** PSNR, FLIP and flicker pass rule 9 with about twice the margin of 256 spp (diffuse +0.34 dB
pooled, +0.49 disoccluded; AO +0.39 / +0.82); the boil clause still fails by the letter (young boil +7 % `orbit`,
+38 % `pan` diffuse, +6 % specular); the cut frame loses −1.9 dB diffuse / −1.4 dB SO. Recommendation unchanged: keep
`'mips'` unless Dennis accepts young-pixel boil that rises to about the clean reference's level (above it on `orbit` and
`pan`) while staying at or under the default filter's (TASKS q19).

## 4. Setup for §2–3 boil (captures)

| | |
|---|---|
| Captures | Test-bed `mode=capture`, 960×540, `signal=diffuse,specular`, windows `cut` path frames 16–79 (= T1's `t1-cut`: 32 frames of history, the cut, 32 after), `pan` 0–47 (= `t1-pan`), `orbit` 0–47, `light` 24–71 (light flip at local frame 24), `glossy` 0–47. Each window captured twice: `e1b4k-*` (`refspp=4096`) and `e1b256-*` (`refspp=256`). Every non-reference buffer of every frame is byte-identical between the two sets (`cmp`), so one replay output serves both (symlinked) |
| Replays | `mode=replay&capture=e1b4k-<w>&denoiser=<id>&output=<name>&warm=0[&youngNormalPower=16 \| &r.historyFix=spatial]`; `run.json` records the settings; specular outputs of the two SVGF arms are byte-identical |
| Scoring | [data/t1-score.mjs](data/t1-score.mjs) (T1's scorer, unchanged; `--flip-every 4`), then [data/e1b-boil.mjs](data/e1b-boil.mjs) (tables, imports `t1-summary.mjs`'s `summarize`) |
| Live tables | [data/e1b-ab-table.mjs](data/e1b-ab-table.mjs) (pairs, per path and mean, 256 vs 4096, frame after cut, post-cut window) and `examples/realtime-denoiser/e1-table.mjs` (§1, floors, theory check) |
| GPU | Apple M5 Pro, HeadlessChrome 155; TASKS rule 11 lock held per batch, released between jobs; `caffeinate -s -i -m -w` per batch. 1080p pages with 4096-spp references: 20–25 min each with 3 in parallel; 540p 4096-spp captures ~1.5 s per frame |

Commands (`$S` = scratch folder, snapshot served on 127.0.0.1:5470, `C="mode=eval&preset=full&refspp=4096&ref2spp=256&ref2salt=0"`):

```sh
git archive 7ea3928 examples/realtime-denoiser examples/_shared tools/rt-capture packages/denoiser-core packages/denoiser-ffx packages/denoiser-realtime package.json | tar -x -C $S/snap
ln -s <repo>/node_modules $S/snap/node_modules   # + server.hmr: false in the snapshot's vite.config.ts
cd $S/snap/examples/realtime-denoiser && RT_CAPTURE_DIR=$S/caps node $S/snap/node_modules/vite/bin/vite.js --port 5470 --strictPort --host 127.0.0.1
export BASE=http://127.0.0.1:5470/
node run-headless.mjs --json=joint-thin.json "signal=diffuse,specular&denoiser=svgf,svgf-auto,recurrent,accumulate-32&path=thin&$C"
node run-headless.mjs --json=ab-orbit.json "signal=diffuse,specular&denoiser=svgf-auto,svgf-auto@youngNormalPower=16,recurrent,recurrent@r.historyFix=spatial&path=orbit&$C"
node run-headless.mjs --json=occ-orbit.json "signal=ao,so&denoiser=occlusion-svgf-auto,occlusion-recurrent,occlusion-recurrent@o.historyFix=spatial&path=orbit&$C"
node run-headless.mjs --json=floor4096-thin.json "signal=diffuse,specular,shadows,ao,so&denoiser=&frames=32&mode=eval&preset=full&path=thin&refspp=4096&ref2spp=4096&ref2salt=1"
node run-headless.mjs "mode=capture&name=e1b4k-cut&path=cut&start=16&frames=64&w=960&h=540&signal=diffuse,specular&refspp=4096"
RT_CAPTURE_DIR=$S/caps node docs/research/rt-denoiser/results/data/t1-score.mjs e1b4k-cut --den svgf-auto,svgf-auto-yn16,recurrent,recurrent-fixsp --signals diffuse,specular --flip-every 4 --json e1b4k-cut.json
node docs/research/rt-denoiser/results/data/e1b-ab-table.mjs --pair=diffuse:recurrent:recurrent@r.historyFix=spatial docs/research/rt-denoiser/results/data/e1b-highref-1080p.json
node docs/research/rt-denoiser/results/data/e1b-boil.mjs --pairs=svgf-auto:svgf-auto-yn16,recurrent:recurrent-fixsp docs/research/rt-denoiser/results/data/e1b-boil-scores.json
```

Raw data: [data/e1b-highref-1080p.json](data/e1b-highref-1080p.json) (every live page: main fields vs 4096 spp, `vsRef2`
vs 256, `refFloor`, `perFrameDb` = [vs 4096, vs 256]); [data/e1b-boil-scores.json](data/e1b-boil-scores.json) (t1-score
age buckets of the 10 captures). The captures (30 GB) were deleted afterwards; the capture queries above regenerate
them bit for bit.

## 5. Notes

- The test bed rounds every metric to 4 decimals in its JSON. Flicker sits at 0.0013–0.0045 at 1080p, so flicker
  deltas below about ±3 % are invisible (several "±0.0 %" and the AO `cut` "+5 %" flicker-mc entries are one unit of
  the last digit). Boil from the captures is computed in double precision.
- 4096-spp floors (32 frames) for `thin` / `cut` / `pan` cost ~10 min per path for all signals alone; for `thin`, 16k
  spp would be needed to get the diffuse ceiling above 50 dB (variance falls ~×9 per ×16 spp there).
