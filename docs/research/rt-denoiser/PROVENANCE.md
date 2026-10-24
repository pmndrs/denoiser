# Provenance log

_Skeleton v0, 2026-10-24, spec author. Required by [RULES.md](RULES.md) rule 5: every
algorithmic piece of `denoiser/realtime` cites a public source or is marked as our design.
Implementers add the file/function column as code lands and keep rows in sync with
[SPEC.md](SPEC.md). Reviews check that every pass has rows here._

## How to use this file

- **One row per pass, constant or technique.** Source = paper/talk/book with section, page
  or slide; or **"our design, tuned on captures"**. Deviation = what we changed from the
  source, or "—".
- **Allowed sources only** (RULES §2): papers, books, public talks, NVIDIA's public pages,
  permissive code from its own upstream. Never NRD code, NRD's README, forks or ports.
- **RTG II ch. 49** (CC BY-NC-ND 4.0): prose and equations only. Its numbered listings are
  **not** a source for this project (they may mirror NRD code); where `sources/reblur.md`
  transcribed a listing formula, SPEC.md designs its own instead and this log says so.
- **GTC 2020 / Metro 2019 slides** (© NVIDIA / authors, public talks): allowed; rows say
  "slide pseudo-code" where a formula came from a slide's code box.
- **BSD-3 code** (A-SVGF, © 2018 Christoph Schied): constants taken from it are cited as
  "S3 file". If shipped code contains S3-derived constants or structure, keep the BSD-3
  notice in that file and in the package `NOTICE`, and send the courtesy note the S3 README
  asks for.
- **2nd review** column: rows whose only source note is `sources/shadows-specular.md` get a
  second reviewer before merge, because that note's author read NRD README prose before it
  was ruled out (RULES §8 register). Rows marked "yes" must be checked against the primary
  source directly.

## Contamination register

The register of who may see what lives in [RULES.md §8](RULES.md). Status of the SPEC.md
author (2026-10-24): read RULES, LESSONS, TASKS, PLAN, HANDOFF, all of `sources/*.md`,
CAPTURE-FORMAT, `temporal.ts`, `docs/specs/temporal.md`, RTG II ch. 49 prose
(`ch49_prose.txt`, listings already stripped), Frostbite 2014 §4.9, and the A-SVGF BSD-3
shaders. **No NRD code, README, fork or port was opened.** One web fetch (Unreal Engine
blog, for Karis 2014) was refused by the server; the constants used are the ones already
recorded in CAPTURE-FORMAT.

## Rule-7 procedure (if someone reads NRD code by accident)

1. Stop and say so in your report and in TASKS.md ("Found along the way").
2. Add an entry below under **Incidents**: who, when, what was seen (file/area, not
   content), and which of our passes it could touch.
3. Mark the affected rows below `CONTAMINATED: <incident #>`.
4. Someone else (not contaminated) re-writes or re-reviews those passes from the public
   sources, and records that here; then the mark is cleared.
5. The contaminated person may keep working on unrelated passes, and is added to the
   RULES §8 register.

### Incidents

_None._

## Prior work

| item | where | source | notes |
|---|---|---|---|
| SVGF lab and FSR3+SVGF pipeline (demos 14, 21), temporal guides | Dennis's `ssgiDev` (`bench/src/demos/14-svgf/`, `21-fsr-svgf/`, `harness/temporal-guides.ts`) | **prior work by Dennis, written from Schied et al. 2017**; the guides and `MomentsPass` come from `@pmndrs/upscaler` (Dennis's, from AMD FidelityFX, MIT) | reviewed clean in [sources/ssgi-svgf-review.md](sources/ssgi-svgf-review.md): no NRD/ReLAX/Web-RTRT references in the code. M1 ports its five passes with the review's upgrades |
| FidelityFX denoiser port | `packages/denoiser-ffx` | AMD FidelityFX SDK v1.1.4, MIT | comparison baseline only; nothing from it in SPEC.md |

## Source keys

S1 SVGF (Schied et al., HPG 2017) · S2 A-SVGF (Schied, Peters, Dachsbacher, PACMCGIT 2018) ·
S3 A-SVGF code (BSD-3) · DAM Dammertz et al. 2010 · RTG2 = RTG II ch. 49 (Zhdan 2021) ·
GTC20 Zhdan, GTC 2020 s22699 · METRO Shyshkovtsov et al. GDC/GTC 2019 · BAV12 Bavoil &
Andersson GDC 2012 · FB Lagarde & de Rousiers 2014 (Frostbite PBR v3.2) · K13 Karis 2013 ·
K14m Karis 2014, "Physically Based Shading on Mobile" (Unreal Engine blog) · Z15 Zimmer et
al. EGSR 2015 · RTG1-13/19/25/32 Ray Tracing Gems chapters · RTG2-24 Wolfe, RTG II ch. 24 ·
M12 Mehta et al. 2012 · H18 Heitz et al. 2018 · TR19 Tomb Raider GTC 2019 · SAL16 Salvi GDC
2016 · S15 Stachowiak SIGGRAPH 2015 · GG2-20 Sigg & Hadwiger, GPU Gems 2 ch. 20 ·
CIG14 Cigolle et al. JCGT 2014 · DUF17 Duff et al. JCGT 2017 · VOG79 Vogel 1979 ·
HB94 Hardie & Barner 1994 (cited by RTG2, not read).

## Log

### Conventions and front end

| item | SPEC | source | our deviation | 2nd review | code |
|---|---|---|---|---|---|
| position from viewZ, camera-relative X | C-1 | RTG2 §49.4 prose (position from viewZ; camera-relative X) | jittered sample NDC per CAPTURE-FORMAT; formulas ours | | |
| depth source / linearization | C-2 | standard projection algebra | — | | |
| previous depth from 2.5D motion or static transform | C-3, D16 | 2.5D convention: nrd-provenance §3.2 (interface fact) | static-world derivation when absent: ours | | |
| packed guide `G` (oct normal 2×12 b + roughness 8 b + f32 depth) | C-5 | CIG14 (octahedral) | packing layout ours | | |
| sanitize / safety clamp | F-1 | our design | | | |
| diffuse demodulation, 1e-3 floor | F-2 | S1 §3 "Reconstruction"; Z15 §3 (floor) | — | yes (Z15 via shadows-specular.md) | |
| specular demodulation (split-sum, analytic) | F-2 | K13 Eq. 7–8; K14m (analytic env-BRDF fit; constants as in CAPTURE-FORMAT) | f90 = 1 | yes | |
| hit-distance normalization ĥ = h/(h + a + b·d) | F-3, D5 | concept "normalized hit distance = AO/SO": GTC20 s.9 | **our design, tuned on captures** (rational curve, a = 1, b = 0.05) | | |
| firefly policy: redistribute, don't suppress | F-4 | RTG2 §49.5.1 | — | | |

### Shared temporal core

| item | SPEC | source | our deviation | 2nd review | code |
|---|---|---|---|---|---|
| reprojection into previous view space | C-6, D6b | RTG2 §49.6 prose | doing all math in previous view space is ours | | |
| plane-distance disocclusion, τ = 1 % | C-7 | RTG2 §49.6 p.831 (0.5–1.5 %); METRO s.59 | pairwise-averaged normal; listing 49-2 not used | | |
| backface rejection | C-7 | RTG2 p.832 | — | | |
| SVGF normal test cosN = 0.95 | C-7 | S3 `TemporalAccumulation.frag` / `svgf_shared.glsl` | — | | |
| custom-weighted bilinear history | C-8 | GTC20 s.27–30; RTG2 p.832; S1 p.5 | 1e-3 weight guard ours | | |
| Catmull-Rom when 4×4 valid | C-8 | RTG2 §49.7 | 16-tap exact check, 9-tap evaluation (GG2-20), min/max clamp: ours | | |
| history length A, α = 1/(1+A), increment / reset | C-9 | RTG2 Eq. 49.1, §49.5.2; GTC20 s.25–26; BAV12 s.37–39 | A_cap = 31 default (RTG2: up to 64) | | |
| fast history + luminance clamp + A reduction (anti-lag) | C-10, D8, D11 | idea "clamp toward a faster history": RTG2 p.830 (and p.824 for ReLAX); variance clipping SAL16; A reduction behaviour RTG2 §49.11 | **our design, tuned on captures** (luminance/ĥ only, γ = 2, A_fast = 3, min-combine, runs in history fix) | | |
| reset via `historyValid` uniform | C-12 | our design | | | |

### SVGF + A-SVGF (M1)

| item | SPEC | source | our deviation | 2nd review | code |
|---|---|---|---|---|---|
| pass structure (TA → variance → à-trous ×K, feedback after iteration 0) | §4.1 | S1 §4, Fig. 3, p.5; prior work (ssgiDev) | diffuse+specular in shared dispatches | | |
| α = max(α_min, 1/(1+A)), α_min 0.2 / 0.1 | S-1 | S1 p.5; S2 p.10; S3 (max with 1/(n+1)) | — | | |
| moments α = α_min by default (S3: 0.6) | S-1 | S1 §4.2; S3 | default follows the paper's reading | | |
| moments in rg32float | S-1 | ssgi-svgf-review upgrade | — | | |
| spatial variance below 4 frames, 7×7 / 5×5, boost | S-2 | S1 p.5; S3 `EstimateVariance.frag` | smooth ramp (ssgiDev); S3 neighbour-luminance quirk not copied | | |
| σ stored instead of σ² | S-2a | our design | numerically equivalent | | |
| B3 5×5 à-trous, K = 5 | S-3 | S1 Eq. 1; DAM §2.2 | — | | |
| edge stops σ_z = 1, σ_n = 128, σ_l = 4 | S-3 | S1 Eq. 3–5, p.5 | depth weight on q = 1/d with ∇q from one-sided differences (no derivatives in compute) | | |
| 3×3 Gaussian variance prefilter | S-3 | S1 p.6, Fig. 5 | — | | |
| variance propagation | S-3 | S1 p.5 | — | | |
| specular roughness weight | S-3 | RTG1-32 Eq. 14 | — | yes | |
| 3×3 box kernel option | S-3 | S2 §4 | — | | |
| gradient sampling (3×3 strata, forward projection, atomics, same seed) | S-7, S-8 | S2 §3.1–3.3; S3 `GradientForwardProject.fs` | static-world forward projection; hash choice ours | | |
| gradient reconstruction (5 à-trous at stratum res) | S-7 | S2 §3.4; S3 `CreateGradientSamples.frag`, `AtrousGradient.frag` | one gradient on the remodulated sum for both signals | | |
| λ = min(1, |δ̂|/Δ̂), 3×3 max, α ← lerp(α, 1, λ), A = 1/α − 1 | S-7 | S2 Eq. 13–14, p.9; S3 `TemporalAccumulation.frag` | λ clamped (S3 bug not copied) | | |

### Recurrent pipeline (M2/M3)

| item | SPEC | source | our deviation | 2nd review | code |
|---|---|---|---|---|---|
| 7-pass structure, recurrent loop, separate stabilization history | §5.1 | RTG2 §49.3, §49.5, Fig. 49-3; GTC20 s.15–19, s.51 | + `prepare` pass | | |
| GGX lobe half-angle θ_L, E = 0.75 | R-1, D4e | E = 0.75 from RTG2 p.841 prose; derivation from the GGX NDF | **our derivation** (replaces GTC20 / FB p.72 forms) | | |
| dominant direction factor (simple fit, α input) | R-2, D4f | FB Listing 22, p.71 (and its remark that the simple fit performs better) | input convention α chosen deliberately | | |
| pre-blur: static disk, constant radius, A = 0 weights | R1, D1 | RTG2 §49.5.1, §49.5.5; GTC20 s.51 | radii 15/10 px and the denoised-ĥ clamp: **our design** | | |
| ĥ not filtered in pre-blur | R1 | GTC20 s.60 | — | | |
| temporal accumulation, Catmull-Rom, no clamp in TA | R2 | RTG2 §49.5.2, §49.7, p.834 | — | | |
| parallax definition | R-7 | RTG2 §49.8.1 prose, Fig. 49-5 | previous direction from 2.5D reprojection; no ×60 | | |
| surface-motion frame cap A_spec = θ_L·NoV^κ/π | R-8 | properties from RTG2 p.834 | **our design** (listing 49-4 not used) | | |
| virtual position X + v̂·h̃·F_dom | R-9 | virtual image: RTG1-25 p.451, S15 slide 67; pull-back by dominant factor: RTG2 p.835–836 prose | listing 49-6 not used | yes (RTG1-25/S15 via shadows-specular.md) | |
| virtual confidence (validity × normal × roughness × fast-ĥ) | R-10, D12a | concept: RTG2 p.837 prose | **our design** (listing 49-7 not used) | | |
| confidence-scaled virtual clamp | R-11, D12b | RTG2 p.837 prose | **our design** | | |
| surface/virtual blend by dominant factor; α-space A update | R-12 | RTG2 p.837 prose ("amount of virtual motion") | blend in α-space ours (listing 49-8 not used) | | |
| mip generation, 3 levels, shared memory | R3, D7e | RTG2 §49.5.3, Fig. 49-3; GTC20 s.32–35 | atlas layout, non-sky averaging: ours | | |
| history fix: start level, 3×3 viewZ-only cross-bilateral, fall to finer level | R4a, D7 | RTG2 §49.5.4 p.829; GTC20 s.35 (start-level formula, slide pseudo-code) | τ_fix, sum threshold 0.25, A_fix = 3: **ours, tuned on captures** | | |
| anti-firefly (rank-based clamp) | R4b, D9 | named in RTG2 p.830 (RCRS, HB94 — not read) | **our design** | | |
| 8-tap Poisson disk | R-3, D3a | 8 taps: RTG2 §49.5.5, §49.10; golden-angle spiral VOG79 | antipodal 4+4 layout ours | | |
| Bayer 4×4 rotation, animated | D3b | RTG2 §49.5.5; golden-ratio animation RTG2-24 §24.7.2 | — | yes (RTG2-24 via shadows-specular.md) | |
| world-space kernel plane, axis reflect(−D, n), tangent ⟂ n | R-4 | RTG2 §49.9 prose, Fig. 49-9; GTC20 s.38–40; METRO s.56 | elongation function s_T: **ours** (listing 49-9 not used); basis DUF17 | | |
| radius: 1/(1+A), hit-distance clamp, R_max/R_min | R-5, D2 | GTC20 s.20–22 (1/(1+A)), s.60 (shrink for short hits); RTG2 p.830 (inputs) | lobe-footprint clamp c_h·h̃ and constants: **ours** | | |
| weight shape smoothstep(0,1,sat(1−|ax+b|)) | R-6 | RTG2 Eq. 49.3 | — | | |
| geometry weight = plane distance | R-6 | RTG2 p.841; GTC20 s.44–45; METRO s.59 | relative tolerance lerp(2 %, 0.5 %) ours | | |
| normal weight via lobe angle, tightening with A | R-6 | RTG2 p.841; GTC20 s.46 | g(A) and +1° ours | | |
| roughness weight | R-6 | concept GTC20 s.48 | tolerance ours | | |
| hit-distance weight | R-6, D4b | concept RTG2 p.841 | **our formula** | | |
| post-blur radius scaled by |blur − TA| | R6, D2c | RTG2 §49.5.6 | scaling function **ours** | | |
| temporal stabilization, variance clamp, own history | R7, D10 | RTG2 §49.5.7; SAL16 | widening γ_s/β_s, N_stab = 7: **ours**; anti-lag moved to R4 | | |
| specular stabilization uses both reprojections, amount from TA | R7 | RTG2 p.831 | — | | |
| pass order post-blur → stabilization | D15 | RTG2 Fig. 49-3 | — | | |
| `data` packing (A fixed point, m) | D14 | our design | | | |

### Shadows (M4, outline)

| item | SPEC | source | our deviation | 2nd review | code |
|---|---|---|---|---|---|
| penumbra footprint R·h/(D−h), h·tanθ | SH-2 | M12 Eq. 13 (§3–4, constants §6) | rewrite for hit distance: our derivation | yes | |
| nearest occluder wins (tile W_min) | SH-3 | principle: M12 (`d2_max`) | **our design**; patent-described remedy explicitly not used | yes | |
| penumbra tiles / skip | SH-3 | TR19 slide 72; FFX docs | — | yes | |
| temporal without blur feedback, 5×5 clamp | SH-4 | RTG1-25 §25.2.1 (5×5 Salvi clamp); FFX drift measured in `docs/specs/temporal.md` | — | yes | |
| anisotropic stretch along projected light | SH-5 | RTG2-24 p.389 (grazing light lengthens penumbrae); RTG1-19 / TR19 show anisotropy only as figures | **our derivation** | yes | |
| noise-driven fallback | SH-6 | H18 §4.1–4.2 | — | yes | |
| renderer contract (unjittered origins, golden-ratio blue noise) | SH-7 | TR19 slides 55–62; RTG2-24 §24.7.2 | — | yes | |

### Occlusion (M5, outline)

| item | SPEC | source | our deviation | 2nd review | code |
|---|---|---|---|---|---|
| AO/SO = denoised normalized hit distance | O-1 | GTC20 s.9, s.54, s.63 | falloff from F-3 (ours) | | |
| occlusion-only packing (ĥ_d, ĥ_s) | O-2 | our design | | | |
| SO from AO (optional) | O-4 | FB §4.10.2 Listing 26 | — | yes | |

## Open provenance items

- Verify the K14m constants against the original Unreal Engine blog post (the fetch was
  refused); CAPTURE-FORMAT records the same constants.
- Hardie & Barner 1994 (RCRS) not read; our anti-firefly is our own until someone reads it.
- Salvi GDC 2016 is in the local sources folder (`svgf/salvi.txt`) but was not re-read for
  this skeleton; variance clipping is cited as the general technique.
