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
| position from viewZ, camera-relative X | C-1 | RTG2 §49.4 prose (position from viewZ; camera-relative X) | jittered sample NDC per CAPTURE-FORMAT; formulas ours | | `packages/denoiser-realtime/src/shaders/common.ts` `unprojectZ` (generic two-point ray through projInv, also ortho / reversed-Z) |
| depth source / linearization | C-2 | standard projection algebra | — | | `packages/denoiser-realtime/src/shaders/prepass.ts` `linZ` |
| previous depth from 2.5D motion or static transform | C-3, D16 | 2.5D convention: nrd-provenance §3.2 (interface fact) | static-world derivation when absent: ours | | `packages/denoiser-realtime/src/shaders/common.ts` `expectedPrev` |
| packed guide `G` (oct normal 2×12 b + roughness 8 b + f32 depth) | C-5 | CIG14 (octahedral) | packing layout ours | | `packages/denoiser-realtime/src/shaders/common.ts` `packGeoTap`/`geoTap`, `shaders/prepass.ts` (same layout) |
| sanitize / safety clamp | F-1 | our design | | | `packages/denoiser-realtime/src/shaders/recurrent.ts` `sanitize` |
| diffuse demodulation, 1e-3 floor | F-2 | S1 §3 "Reconstruction"; Z15 §3 (floor) | — | yes (Z15 via shadows-specular.md) | |
| specular demodulation (split-sum, analytic) | F-2 | K13 Eq. 7–8; K14m (analytic env-BRDF fit; constants as in CAPTURE-FORMAT) | f90 = 1 | yes | |
| hit-distance normalization ĥ = h/(h + a + b·d) | F-3, D5 | concept "normalized hit distance = AO/SO": GTC20 s.9 | **our design, tuned on captures** (rational curve, a = 1, b = 0.05) | | `packages/denoiser-realtime/src/shaders/recurrent.ts` `hNorm{i}`/`hDenorm{i}` |
| firefly policy: redistribute, don't suppress | F-4 | RTG2 §49.5.1 | — | | |

### Shared temporal core

| item | SPEC | source | our deviation | 2nd review | code |
|---|---|---|---|---|---|
| reprojection into previous view space | C-6, D6b | RTG2 §49.6 prose | doing all math in previous view space is ours | | `packages/denoiser-realtime/src/shaders/common.ts` `reproject` |
| plane-distance disocclusion, τ = 1 % | C-7 | RTG2 §49.6 p.831 (0.5–1.5 %); METRO s.59 | pairwise-averaged normal; listing 49-2 not used | | `packages/denoiser-realtime/src/shaders/common.ts` `tapValid` |
| backface rejection | C-7 | RTG2 p.832 | — | | `packages/denoiser-realtime/src/shaders/common.ts` `tapValid` |
| SVGF normal test cosN = 0.95 | C-7 | S3 `TemporalAccumulation.frag` / `svgf_shared.glsl` | — | | `packages/denoiser-realtime/src/shaders/common.ts` `tapValid` |
| custom-weighted bilinear history | C-8 | GTC20 s.27–30; RTG2 p.832; S1 p.5 | 1e-3 weight guard ours | | `packages/denoiser-realtime/src/shaders/svgf.ts` `temporalPass` (accept if Σ b·v > 0.01, S3; no 1e-3 guard) |
| Catmull-Rom when 4×4 valid | C-8 | RTG2 §49.7 | 16-tap exact check, 9-tap evaluation (GG2-20), min/max clamp: ours | | `packages/denoiser-realtime/src/shaders/common.ts` `sampleCatmullRom` (5-fetch); option, off by default for svgf; gate = the 4 inner taps valid + clamp, not a 16-tap test |
| history length A, α = 1/(1+A), increment / reset | C-9 | RTG2 Eq. 49.1, §49.5.2; GTC20 s.25–26; BAV12 s.37–39 | A_cap = 31 default (RTG2: up to 64) | | `packages/denoiser-realtime/src/shaders/svgf.ts` `temporalPass` (n = A + 1 in `accum.a`) |
| fast history + luminance clamp + A reduction (anti-lag) | C-10, D8, D11 | idea "clamp toward a faster history": RTG2 p.830 (and p.824 for ReLAX); variance clipping SAL16; A reduction behaviour RTG2 §49.11 | **our design, tuned on captures** (luminance/ĥ only, γ = 2, A_fast = 3, min-combine, runs in history fix) | | `packages/denoiser-realtime/src/shaders/recurrent.ts` `temporalPass` (F update), `historyFixPass` (c); plus a current-frame detector (M2 additions below) |
| reset via `historyValid` uniform | C-12 | our design | | | `packages/denoiser-realtime/src/shaders/common.ts` `FRAME_RESET` flag |

### SVGF + A-SVGF (M1)

| item | SPEC | source | our deviation | 2nd review | code |
|---|---|---|---|---|---|
| pass structure (TA → variance → à-trous ×K, feedback after iteration 0) | §4.1 | S1 §4, Fig. 3, p.5; prior work (ssgiDev) | diffuse+specular in shared dispatches | | `packages/denoiser-realtime/src/svgf.ts` `SvgfPipeline.encode`; diffuse and specular share every dispatch (two signals per thread) |
| α = max(α_min, 1/(1+A)), α_min 0.2 / 0.1 | S-1 | S1 p.5; S2 p.10; S3 (max with 1/(n+1)) | — | | `packages/denoiser-realtime/src/shaders/svgf.ts` `temporalPass` |
| moments α = α_min by default (S3: 0.6) | S-1 | S1 §4.2; S3 | default follows the paper's reading | | `packages/denoiser-realtime/src/shaders/svgf.ts` `temporalPass` |
| moments in rg32float | S-1 | ssgi-svgf-review upgrade | — | | `packages/denoiser-realtime/src/svgf.ts` `configure` |
| spatial variance below 4 frames, 7×7 / 5×5, boost | S-2 | S1 p.5; S3 `EstimateVariance.frag` | smooth ramp (ssgiDev); S3 neighbour-luminance quirk not copied | | `packages/denoiser-realtime/src/shaders/svgf.ts` `variancePass` |
| σ stored instead of σ² | S-2a | our design | numerically equivalent | | `packages/denoiser-realtime/src/shaders/svgf.ts` `variancePass`/`atrousPass` |
| B3 5×5 à-trous, K = 5 | S-3 | S1 Eq. 1; DAM §2.2 | — | | `packages/denoiser-realtime/src/shaders/svgf.ts` `atrousPass` (`kernel: '5x5'`; default is the 3×3 box, measured equal/better and ~2.6× cheaper) |
| edge stops σ_z = 1, σ_n = 128, σ_l = 4 | S-3 | S1 Eq. 3–5, p.5 | depth weight on q = 1/d with ∇q from one-sided differences (no derivatives in compute) | | `packages/denoiser-realtime/src/shaders/svgf.ts` `weightsWgsl` (∇d from the prepass slope texture, converted to ∇q) |
| 3×3 Gaussian variance prefilter | S-3 | S1 p.6, Fig. 5 | — | | `packages/denoiser-realtime/src/shaders/svgf.ts` `atrousPass` (taken from the inner taps at the current stride: exact at stride 1) |
| variance propagation | S-3 | S1 p.5 | — | | `packages/denoiser-realtime/src/shaders/svgf.ts` `atrousPass` |
| specular roughness weight | S-3 | RTG1-32 Eq. 14 | — | yes | `packages/denoiser-realtime/src/shaders/svgf.ts` `weightsWgsl` `wSpec` |
| 3×3 box kernel option | S-3 | S2 §4 | — | | `packages/denoiser-realtime/src/shaders/svgf.ts` `atrousPass` (default) |
| gradient sampling (3×3 strata, forward projection, atomics, same seed) | S-7, S-8 | S2 §3.1–3.3; S3 `GradientForwardProject.fs` | static-world forward projection; hash choice ours | | `packages/denoiser-realtime/src/shaders/gradient.ts` (`antiLag: 'gradient'`): the renderer does the forward projection and supplies one (l_prev, l_cur) sample per stratum; no in-denoiser G1 pass |
| gradient reconstruction (5 à-trous at stratum res) | S-7 | S2 §3.4; S3 `CreateGradientSamples.frag`, `AtrousGradient.frag` | one gradient on the remodulated sum for both signals | | `packages/denoiser-realtime/src/shaders/gradient.ts` `gradientAtrousPass` (per signal, not on the remodulated sum) |
| λ = min(1, |δ̂|/Δ̂), 3×3 max, α ← lerp(α, 1, λ), A = 1/α − 1 | S-7 | S2 Eq. 13–14, p.9; S3 `TemporalAccumulation.frag` | λ clamped (S3 bug not copied) | | `packages/denoiser-realtime/src/shaders/gradient.ts` `gradientLambdaPass` (max over strata once at 1/3 res), applied in `svgf.ts` `temporalPass` (n ← min(n, 1/lerp(1/n, 1, λ))) |

### `denoiser-realtime` M1 additions (svgf implementer, 2026-10-25)

| item | SPEC | source | our deviation | 2nd review | code |
|---|---|---|---|---|---|
| 3×3 history fallback when no 2×2 tap passes | (S-1 says none) | S1 §4.1 p.5 | kept from the paper (S3 omits it) | | `src/shaders/svgf.ts` `temporalPass` |
| depth-slope texture from the prepass (smaller one-sided difference per axis) | S-3 ∇q | needed by S1 Eq. 3; S3 stores a depth derivative in the G-buffer | **our design**: one r32uint (2×f16) written once instead of 4 loads per pass | | `src/shaders/prepass.ts` |
| variance prefilter from the inner taps at stride > 1 | S-3 g3x3 | S1 p.6 | **our approximation** (wider prefilter at coarse levels, saves 8 loads) | | `src/shaders/svgf.ts` `atrousPass` |
| `antiLag: 'auto'`: per-stratum mean of the noisy input vs the reprojected *accumulated* history, k·σ noise floor (k = 2), then S2's reconstruction and λ | (C-10 is the SPEC's renderer-free option) | gradient idea S2 §3; "clamp toward a faster history" RTG2 p.830 | **our design** (no renderer cooperation; fires until history catches up) | | `src/shaders/gradient.ts` `gradientCreatePass(n, false)`, `gradientLambdaPass` |
| `antiLag: 'gradient'` input contract: one (l_prev, l_cur, valid) texel per 3×3 stratum | S-8 | S2 §3.1–3.3 | renderer projects and re-shades; denoiser only reconstructs | | `src/shaders/gradient.ts`, `src/denoisers.ts` `SignalExtras.gradient` |
| gradient strata reduced in 9×9 workgroups (one pixel per thread) | — | our design (performance) | | | `src/shaders/gradient.ts` |
| specular normal weight: cutoff at θ_L(α) + 1°, linear in angle, angle ratio via sqrt((1−cos)/(1−cos θ0)) | (S-3 uses the power form) | θ_L: SPEC R-1; linear shape: GTC20 s.46 | **ours**; `specularNormalWeight: 'power'` gives SPEC S-3 (measured −0.65 dB) | | `src/shaders/svgf.ts` `weightsWgsl` |
| specular roughness radius 1 − smoothstep(10r, 70r, ∣Δp∣) | — | RTG1-32 Eq. 15 | `radiusScale` option | yes (RTG1-32 via shadows-specular.md) | `src/shaders/svgf.ts` `wSpec` |
| `luminanceVariance: 'mean'` (variance of the accumulated mean drives w_l) | — | our design (experiment) | off by default (measured worse) | | `src/shaders/svgf.ts` `variancePass` |
| dev page: exact ground truth + injected Exp(1) noise | — | ssgiDev `svgf-noiseinject.wgsl` (prior work by Dennis) | analytic scene and noise model ours; dev only, not shipped | | `packages/denoiser-realtime/dev/` |

### Recurrent pipeline (M2/M3)

| item | SPEC | source | our deviation | 2nd review | code |
|---|---|---|---|---|---|
| 7-pass structure, recurrent loop, separate stabilization history | §5.1 | RTG2 §49.3, §49.5, Fig. 49-3; GTC20 s.15–19, s.51 | + `prepare` pass | | `packages/denoiser-realtime/src/recurrent.ts` `RecurrentPipeline.encode` (buffer rotation §10.1; both signals per dispatch) |
| GGX lobe half-angle θ_L, E = 0.75 | R-1, D4e | E = 0.75 from RTG2 p.841 prose; derivation from the GGX NDF | **our derivation** (replaces GTC20 / FB p.72 forms) | | `packages/denoiser-realtime/src/shaders/svgf.ts` (SVGF specular: `setCenter`, `historyCap`); `src/shaders/recurrent.ts` `thetaL` |
| dominant direction factor (simple fit, α input) | R-2, D4f | FB Listing 22, p.71 (and its remark that the simple fit performs better) | input convention α chosen deliberately | | `packages/denoiser-realtime/src/shaders/recurrent.ts` `kern{i}` (specular kernel plane; interim until M3) |
| pre-blur: static disk, constant radius, A = 0 weights | R1, D1 | RTG2 §49.5.1, §49.5.5; GTC20 s.51 | radii 15/10 px and the denoised-ĥ clamp: **our design** | | `packages/denoiser-realtime/src/shaders/recurrent.ts` `preBlurPass` |
| ĥ not filtered in pre-blur | R1 | GTC20 s.60 | — | | `packages/denoiser-realtime/src/shaders/recurrent.ts` `preBlurPass` |
| temporal accumulation, Catmull-Rom, no clamp in TA | R2 | RTG2 §49.5.2, §49.7, p.834 | — | | `packages/denoiser-realtime/src/shaders/recurrent.ts` `temporalPass` (Catmull-Rom gated on the 4 inner taps + min/max clamp, like svgf) |
| parallax definition | R-7 | RTG2 §49.8.1 prose, Fig. 49-5 | previous direction from 2.5D reprojection; no ×60 | | `packages/denoiser-realtime/src/shaders/svgf.ts` `historyCap` (previous direction from `expectedPrev`) |
| surface-motion frame cap A_spec = θ_L·NoV^κ/π | R-8 | properties from RTG2 p.834 | **our design** (listing 49-4 not used) | | `packages/denoiser-realtime/src/shaders/svgf.ts` `historyCap` (used by SVGF specular, SPEC S-1); `src/shaders/recurrent.ts` `specCap{i}` (interim recurrent specular) |
| virtual position X + v̂·h̃·F_dom | R-9 | virtual image: RTG1-25 p.451, S15 slide 67; pull-back by dominant factor: RTG2 p.835–836 prose | listing 49-6 not used | yes (RTG1-25/S15 via shadows-specular.md) | |
| virtual confidence (validity × normal × roughness × fast-ĥ) | R-10, D12a | concept: RTG2 p.837 prose | **our design** (listing 49-7 not used) | | |
| confidence-scaled virtual clamp | R-11, D12b | RTG2 p.837 prose | **our design** | | |
| surface/virtual blend by dominant factor; α-space A update | R-12 | RTG2 p.837 prose ("amount of virtual motion") | blend in α-space ours (listing 49-8 not used) | | |
| mip generation, 3 levels, shared memory | R3, D7e | RTG2 §49.5.3, Fig. 49-3; GTC20 s.32–35 | atlas layout, non-sky averaging: ours | | `packages/denoiser-realtime/src/shaders/recurrent.ts` `mipsPass`, `ATLAS` |
| history fix: start level, 3×3 viewZ-only cross-bilateral, fall to finer level | R4a, D7 | RTG2 §49.5.4 p.829; GTC20 s.35 (start-level formula, slide pseudo-code) | τ_fix, sum threshold 0.25, A_fix = 3: **ours, tuned on captures** | | `packages/denoiser-realtime/src/shaders/recurrent.ts` `historyFixPass` `mipRepair{i}` |
| anti-firefly (rank-based clamp) | R4b, D9 | named in RTG2 p.830 (RCRS, HB94 — not read) | **our design** | | `packages/denoiser-realtime/src/shaders/recurrent.ts` `historyFixPass` (b) |
| 8-tap Poisson disk | R-3, D3a | 8 taps: RTG2 §49.5.5, §49.10; golden-angle spiral VOG79 | antipodal 4+4 layout ours | | `packages/denoiser-realtime/src/shaders/recurrent.ts` `DISK` |
| Bayer 4×4 rotation, animated | D3b | RTG2 §49.5.5; golden-ratio animation RTG2-24 §24.7.2 | — | reviewed 2026-10-25: confirmed (RTG2-24 §24.7.2 pp.383–384, checked in the shadows review) [review](reviews/shadows-provenance.md) | `packages/denoiser-realtime/src/shaders/recurrent.ts` `blurRotation` |
| world-space kernel plane, axis reflect(−D, n), tangent ⟂ n | R-4 | RTG2 §49.9 prose, Fig. 49-9; GTC20 s.38–40; METRO s.56 | elongation function s_T: **ours** (listing 49-9 not used); basis DUF17 | | `packages/denoiser-realtime/src/shaders/recurrent.ts` `kern{i}`, `tapPixel`, `onbT`/`onbB` (taps projected exactly: clip = c + kx·P·T + ky·P·B) |
| radius: 1/(1+A), hit-distance clamp, R_max/R_min | R-5, D2 | GTC20 s.20–22 (1/(1+A)), s.60 (shrink for short hits); RTG2 p.830 (inputs) | lobe-footprint clamp c_h·h̃ and constants: **ours** | | `packages/denoiser-realtime/src/shaders/recurrent.ts` `blurPass`, `radiusRough{i}`, `hitClamp{i}` |
| weight shape smoothstep(0,1,sat(1−|ax+b|)) | R-6 | RTG2 Eq. 49.3 | — | | `packages/denoiser-realtime/src/shaders/recurrent.ts` `Wt` |
| geometry weight = plane distance | R-6 | RTG2 p.841; GTC20 s.44–45; METRO s.59 | relative tolerance lerp(2 %, 0.5 %) ours | | `packages/denoiser-realtime/src/shaders/recurrent.ts` `tapGeoW` |
| normal weight via lobe angle, tightening with A | R-6 | RTG2 p.841; GTC20 s.46 | g(A) and +1° ours | | `packages/denoiser-realtime/src/shaders/recurrent.ts` `tapGeoW` (angle ratio in cosine space, sqrt((1−cos)/(1−cos θ0))) |
| roughness weight | R-6 | concept GTC20 s.48 | tolerance ours | | `packages/denoiser-realtime/src/shaders/recurrent.ts` `tapWgsl` (specular) |
| hit-distance weight | R-6, D4b | concept RTG2 p.841 | **our formula** | | `packages/denoiser-realtime/src/shaders/recurrent.ts` `tapWgsl` |
| post-blur radius scaled by |blur − TA| | R6, D2c | RTG2 §49.5.6 | scaling function **ours** | | `packages/denoiser-realtime/src/shaders/recurrent.ts` `blurPass(kinds, true)` |
| temporal stabilization, variance clamp, own history | R7, D10 | RTG2 §49.5.7; SAL16 | widening γ_s/β_s, N_stab = 7: **ours**; anti-lag moved to R4 | | `packages/denoiser-realtime/src/shaders/recurrent.ts` `stabilizePass` |
| specular stabilization uses both reprojections, amount from TA | R7 | RTG2 p.831 | — | | |
| pass order post-blur → stabilization | D15 | RTG2 Fig. 49-3 | — | | `packages/denoiser-realtime/src/recurrent.ts` `RecurrentPipeline.encode` |
| `data` packing (A fixed point, m) | D14 | our design | | | `packages/denoiser-realtime/src/shaders/recurrent.ts` `packData`/`unpackA` (history fix updates it read-write) |

### `denoiser-realtime` M2 additions (recurrent implementer, 2026-10-25; provisional, SPEC v0)

| item | SPEC | source | our deviation | 2nd review | code |
|---|---|---|---|---|---|
| current-frame anti-lag detector: 3×3 mean of this frame's pre-blurred luminance and ĥ vs the reprojected history, threshold in standard errors (σ_cur = 3) + 2 % relative / 0.05 ĥ floor; A ← lerp(min(A, A_fast), A, sat(2 − r)) in the temporal pass | (addition to C-10) | idea "react to changes not explained by motion": RTG2 §49.5.7 / §49.11 prose; standard error of a mean: textbook statistics | **our design, measured**: dev-page light switch +2–3 dB over C-10 alone; floor at A_fast, not 0 (floor 0 cost 1.4–1.8 dB on static content) | | `src/shaders/recurrent.ts` `temporalPass` |
| fast-history clamp window = γ·(spread / √N) (standard error of the 3×3 mean), γ = 1 | C-10, D8 | variance clipping SAL16 (window from neighbourhood statistics) | **measured deviation** from SPEC's γ = 2 spreads: test bed mean +0.37 dB, dev light switch 29.0 → 34.3 dB 12 frames after; `antiLagStandardError: false` restores SPEC | | `src/shaders/recurrent.ts` `historyFixPass` (c) |
| radii: pre-blur 25 px, blur R_max 45 px (at 1080p) | D1, R-5 | SPEC ranges [0, 30], [10, 60] | **measured** (test bed, 7 paths): +0.10 / +0.17 dB over 15 / 30 | | `src/recurrent.ts` `resolveRecurrent` |
| tap screen-offset clamp 2·max(R_max, R_pre) | R-4 | — | SPEC says 2·R_max; ours keeps the pre-blur alive when R_max is small | | `src/shaders/recurrent.ts` `kern{i}` |
| Catmull-Rom gated on the 4 inner taps, clamped to their min/max (TA and stabilization) | C-8 | RTG2 §49.7 | same deviation as svgf (no 16-tap test) | | `src/shaders/recurrent.ts` `temporalPass`, `stabilizePass` |
| neighbourhood validity in history fix / stabilization / detector = plane distance at τ_g(A = 0) | R4, R7 | RTG2 p.841 (plane distance) | normal test omitted in neighbourhoods (cost) | | `src/shaders/recurrent.ts` `planeOk` |
| taps projected exactly from per-pixel clip-space axes (clip = c + kx·P·T + ky·P·B) | R-4 | standard projective algebra | — | | `src/shaders/recurrent.ts` `tapPixel` |
| skeleton timing mode: every pass replaced by a trivial kernel with identical bindings | §10.3 | our design (tooling) | | | `src/shaders/recurrent.ts` `trivialPass` |
| interim recurrent specular: surface motion only, R-8 cap, lobe kernel plane and weights, no virtual motion (M3) | R-7, R-8, §5.6 | as rows above | virtual motion, R-10..R-12 and the two-candidate stabilization are **not implemented** | | `src/shaders/recurrent.ts` `specCap{i}`, `kern{i}` |
| dev page: 1-spp diffuse (cosine) and mirror hit distances in the synthetic scene; `still=1` | — | our design (dev only, not shipped) | | | `packages/denoiser-realtime/dev/scene.ts` |

### Shadows (M4)

_Implemented 2026-10-25 by the shadows agent (implementer, RULES §8: no NRD code, README or
port opened; `sources/shadows-specular.md` read, every primary source below re-read by the
implementer: M12 §3–4 Eq. 4/11–13 and §6, H18 §4.1–4.2, RTG1-25 §25.2.1 p.443, TR19 slide 72).
Rows marked "yes" still need the second reviewer the register asks for, because their
pointer came from `sources/shadows-specular.md`. Host: `packages/denoiser-realtime/src/shadow.ts`;
results: [results/M4.md](results/M4.md)._

| item | SPEC | source | our deviation | 2nd review | code |
|---|---|---|---|---|---|
| penumbra footprint R·h/(D−h), h·tanθ | SH-2 | M12 Eq. 4 (`s = d1/d2 − 1`) and Eq. 13 (filter width ∝ σ·(d1/d2_max − 1), pixel floor; constants §6) | rewritten for a hit distance: d1/d2 − 1 = h/(D − h) (our algebra); light radius instead of M12's Gaussian σ; kernel radius = 0.75·W (tuned, M4.md §3), pixel floor 1 px | reviewed 2026-10-25: confirmed with correction (M12 Eq. 13's floor is 1/(kµ·Ω_x^max); 1 px is ours) [review](reviews/shadows-provenance.md) | `packages/denoiser-realtime/src/shaders/shadow.ts` `temporal` (gS = h/(D−h), accumulated over occluded samples), `spatial` (Rw) |
| nearest occluder wins (3×3-tile minimum, also for pixels with their own estimate) | SH-3 | principle: M12 `d2_max` (the occluder closest to the receiver sets the width); M12 §6 gives unoccluded pixels the d1/d2 averaged over a 5-px radius | **our design**: min over 8×8 tiles (3×3 neighbourhood) instead of a 5-px average; the patent-described remedy in shadows-specular.md G2 not used (its text was never read) | reviewed 2026-10-25: confirmed (M12 p.163:4, §6 p.163:7) [review](reviews/shadows-provenance.md) | `packages/denoiser-realtime/src/shaders/shadow.ts` `temporal` (tile stats), `SHADOW_TILES_WGSL`, `spatial` (`SF_MERGE_MIN`) |
| penumbra tiles / skip (indirect dispatch over a tile list) | SH-3 | TR19 slide 72 ("penumbra mask", slide title + figure); H18 §4.1 (no filtering cost outside penumbrae) | tile = 8×8, active if the 3×3 tiles hold a fractional history or disagreeing raw samples (our criterion) | reviewed 2026-10-25: confirmed (TR19 s.71–72, H18 §4.1 p.7) [review](reviews/shadows-provenance.md) | `packages/denoiser-realtime/src/shaders/shadow.ts` `SHADOW_TILES_WGSL`, `dispatchWorkgroupsIndirect` in `shadow.ts` |
| temporal on raw visibility, no spatial output fed back | SH-4 | RTG1-25 §25.2.1 p.443 (scalar shadow filter derived from SVGF, Karis-style box clamp sized by Salvi's variance over 5×5); FFX drift measured in `docs/specs/temporal.md` | history = raw visibility only (our design); clamp window 0.4σ + 0.05 instead of 1σ (≈ 2 standard errors of the 25-sample mean, tuned) | reviewed 2026-10-25: confirmed (RTG1-25 p.443; raw-history precedent RTG1-13 Eq. 11 p.170) [review](reviews/shadows-provenance.md) | `packages/denoiser-realtime/src/shaders/shadow.ts` `temporal` |
| anti-lag: a history the clamp moved restarts at the current frame | — | **our design** (clamp-toward-current idea, RTG2 p.830 / SPEC C-10; restart to A = 0 measured, M4.md §3) | | | `packages/denoiser-realtime/src/shaders/shadow.ts` `temporal` (`antiLag`, `antiLagHistory`) |
| uniform 5×5 window → exact history value | — | **our design** | | | `packages/denoiser-realtime/src/shaders/shadow.ts` `temporal` (`SF_SNAP`) |
| history cap from penumbra width in pixels (A ≤ W_px²) | — | **our design** (repeated reprojection resampling blurs ~√A px) | | | `packages/denoiser-realtime/src/shaders/shadow.ts` `temporal` (`historyScale`) |
| Catmull-Rom history fetch, clamped to the 2×2 taps | C-8 | shared core / RTG2 §49.7 prose (see the core rows above) | used for visibility only; scalar channels stay bilinear | | `packages/denoiser-realtime/src/shaders/shadow.ts` `temporal` (`sampleCatmullRom`) |
| reprojection: affine tap positions, plane = current normal | C-6/C-7 | shared core rows above (RTG2 §49.6 prose) | plane distance linear in the tap pixel (as the recurrent kernels do), current normal instead of the pairwise average, backfacing via unnormalized octahedral sign (our simplifications, −0.03 dB, −0.1 ms) | | `packages/denoiser-realtime/src/shaders/shadow.ts` `reprojFast` |
| spatial: 2 passes, 8-tap disk on the tangent plane, rotated per pixel, second pass half radius | SH-5 | SPEC R-3 / D3b (VOG79; RTG2 §49.5.5 prose; RTG2-24 §24.7.2) | radius × lerp(1, 0.5, A/A_cap); weights: plane distance (2 %) and normal (30°) in SPEC's W(x) shape; affine screen Jacobian of the kernel axes (our approximation) | reviewed 2026-10-25: confirmed (RTG2-24 §24.7.2 pp.383–384) [review](reviews/shadows-provenance.md) | `packages/denoiser-realtime/src/shaders/shadow.ts` `shadowSpatialWgsl` |
| self-shadowing terminator (light partly below the horizon, h = 0) | — | **our design**: analytic test n·l < sin(angular radius of the light), 16-px radius there (visibility follows n·l) | | | `packages/denoiser-realtime/src/shaders/shadow.ts` `spatial` |
| anisotropic stretch along the projected light direction by 1/(n·l) | SH-5 | M12 Eq. 11–12: filter distances measured along the plane parallel to the light (our reading: on the receiver plane this stretches the kernel by 1/(n·l)); RTG2-24 p.389 (grazing light lengthens penumbrae) | option `anisotropy`, **off**: −0.3 to −2.7 dB on the test bed (M4.md §3) | reviewed 2026-10-25: confirmed (M12 Eq. 11–12 p.163:4; RTG2-24 p.389) [review](reviews/shadows-provenance.md) | `packages/denoiser-realtime/src/shaders/shadow.ts` `spatial` (`SF_ANISO`) |
| noise-driven fallback (no hit distance or no light) | SH-6 | H18 §4.2 Eq. 29 (total variation of the second derivative along n = 4 lines through x; σ ∝ E) | on the 5×5 shared tile without the random offset; accumulated over time instead of the paper's 3×3 box; radius = 24 px × E (tuned) | reviewed 2026-10-25: confirmed with correction (σ ∝ E is H18 §4.1, Eq. 29 §4.2, p.7) [review](reviews/shadows-provenance.md) | `packages/denoiser-realtime/src/shaders/shadow.ts` `temporal` (`SF_NOISE`), `spatial` |
| renderer contract (unjittered origins, golden-ratio blue noise) | SH-7 | TR19 slides 55–62; RTG2-24 §24.7.2 | documented only (the test bed renders without jitter, blue noise per M1.md §2) | reviewed 2026-10-25: confirmed (TR19 s.55–62, RTG2-24 §24.7.2) [review](reviews/shadows-provenance.md) | — |

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
