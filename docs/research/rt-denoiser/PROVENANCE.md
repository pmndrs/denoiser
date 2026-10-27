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

Status of the release auditor (2026-10-25, RULES rule 3b, register row "release auditor"):
read RULES, NRD's GitHub release bodies `v2.5.0`…`v4.18.0` (78 releases) and the prose of
`UPDATE.md` (blob `679097c`), both with fenced code blocks stripped by script before reading
(none were present). **No NRD code, README, source, shader, header, Integration folder,
NRD-Sample, fork or port was opened.** Output: [sources/nrd-releases.md](sources/nrd-releases.md)
(what changed, never how). The auditor writes and reviews none of our passes.

Status of the change auditor (2026-10-25, RULES rule 3c): line/file counts, paths, hashes and
dates from a `--no-checkout` clone (deleted afterwards). **No file contents, diffs or commit
messages were read.** Output: [sources/nrd-change-magnitude.md](sources/nrd-change-magnitude.md).
Writes none of our passes.

**Exposure, public researcher (2026-10-25, rule 7):** while writing
`sources/nrd-public-2022-2026.md`, a web-search result summary quoted about three sentences of
NRD's README "History confidence" section (README prose is off limits, RULES §2). The researcher
did not open the page, and nothing from it is in the report. Not code. Consequence: that
researcher writes none of our passes, and any pass on history confidence or anti-lag inputs is
written from public sources by another agent. Mitigation added to LESSONS: avoid search queries
on NRD anti-lag / confidence that pull README text into summaries. The orchestrator relayed only
the fact of the exposure, not its content.

**Exposure, orchestrator (2026-10-25, rule 7):** Dennis added
`docs/research/independent-denoiser-implementation-brief.md`, an external review whose statements
about NRD come from an audit of NRD 4.18.0's source and history. The orchestrator read its header,
its "already implemented" table (about our code) and its first section, which says ReBLUR replaced
mip-based history repair with direct spatial repair in 2022 (the "what" is also in the release audit,
`sources/nrd-releases.md`, rule 3b) and gives one sentence on how the current repair works. It stopped
there. Consequences: the orchestrator writes no passes and will not brief a history-repair design
from that sentence; any change to history repair is designed from public sources, our measurements
or black-box probes by an implementer who hasn't read the brief. Running agents were told not to open
it. The brief was never committed; Dennis removed it from the worktree the same day (as was the
snapshot JSON), and must not be given to implementers (RULES §1). Its author is asked to produce a
filtered what-not-how targets file, `sources/nrd-review-targets.md`, checked by a clean reviewer first.

**Clean review of `sources/nrd-review-targets.md` (2026-10-25, commit c94934a):** reviewer status
**clean** (no NRD code, README, release notes, fork or port, and not the quarantined brief or snapshot;
listing `rt-denoiser-sources/` showed the quarantine folder's file names only, nothing opened). Checked
every entry for formulas, thresholds, constants, defaults, pass structure, data layouts, internal tests,
NRD names, non-public algorithm names, parameter-encoding targets and mechanism phrasing, against the
release audit's level of detail; checked the five public references (SVGF §4.2, Dammertz 2010, the TAA
survey, PBRT §9.6, A-SVGF) exist and say what is claimed. **Verdict: pass, no redactions; implementers may
read it.** Review: [reviews/nrd-review-targets-review.md](reviews/nrd-review-targets-review.md).

**Clean review of the Codex audit handoff (2026-10-26):** two files from Dennis's external auditor
(`clean-agent-public-research-prompt.txt`, `current-denoiser-state-audit.txt`, kept outside the repo; the prompt's author
had the separate NRD source audit in context, the state audit's subagent did not). Reviewer status **clean** (no NRD code,
README, release notes, fork or port, nothing under or named quarantine). Checked every line for formulas, thresholds,
constants, defaults, pass structure, data layouts, internal tests, NRD names, non-public algorithm names,
parameter-encoding targets and mechanism phrasing, against the release audit and TASKS target D; checked the nine
public references (Eto 2023, Rodriguez 2020, Mara 2017, SVGF, Igehy 1999, Mehta 2012, A-SVGF, Heitz 2018, Panteleev
2020) exist and say what is claimed; spot-checked the claims about our code and results. **Verdicts: research prompt
pass with three clauses redacted (design-hint disclaimers about distance data and another denoiser's history repair);
state audit pass, no redactions.** Several premises are stale since 1a2861a / 4457481 / 694937c (shadows). Review:
[reviews/codex-audit-2026-10-26-review.md](reviews/codex-audit-2026-10-26-review.md); reviewed copies:
[sources/audit-public-research-prompt.md](sources/audit-public-research-prompt.md),
[sources/audit-current-state.md](sources/audit-current-state.md).

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
| gradient reconstruction (5 à-trous at stratum res) | S-7 | S2 §3.4; S3 `CreateGradientSamples.frag`, `AtrousGradient.frag` | one gradient on the remodulated sum for both signals | | `packages/denoiser-realtime/src/shaders/gradient.ts` `gradientAtrousPassV2` (per signal, not on the remodulated sum; 4 iterations, packed; v1: `gradientAtrousPass`, 5) |
| λ = min(1, |δ̂|/Δ̂), 3×3 max, α ← lerp(α, 1, λ), A = 1/α − 1 | S-7 | S2 Eq. 13–14, p.9; S3 `TemporalAccumulation.frag` | λ clamped (S3 bug not copied) | | `packages/denoiser-realtime/src/shaders/gradient.ts` `gradientLambdaPass` (max over strata once at 1/3 res), applied in `svgf.ts` `temporalPass` (n ← min(n, 1/lerp(1/n, 1, λ))) |

### `denoiser-realtime` M1 additions (svgf implementer, 2026-10-25)

| item | SPEC | source | our deviation | 2nd review | code |
|---|---|---|---|---|---|
| 3×3 history fallback when no 2×2 tap passes | (S-1 says none) | S1 §4.1 p.5 | kept from the paper (S3 omits it) | | `src/shaders/svgf.ts` `temporalPass` |
| depth-slope texture from the prepass (smaller one-sided difference per axis) | S-3 ∇q | needed by S1 Eq. 3; S3 stores a depth derivative in the G-buffer | **our design**: one r32uint (2×f16) written once instead of 4 loads per pass | | `src/shaders/prepass.ts` |
| variance prefilter from the inner taps at stride > 1 | S-3 g3x3 | S1 p.6 | **our approximation** (wider prefilter at coarse levels, saves 8 loads) | | `src/shaders/svgf.ts` `atrousPass` |
| `antiLag: 'auto'`: per-stratum mean of the noisy input vs the reprojected *accumulated* history, k·σ noise floor (v1: k = 2 on S3's variance propagation; v2: see the v2 rows below), then S2's reconstruction and λ | (C-10 is the SPEC's renderer-free option) | gradient idea S2 §3; "clamp toward a faster history" RTG2 p.830 | **our design** (no renderer cooperation; fires until history catches up) | | `src/shaders/gradient.ts` `gradientCreatePassV2(n, false)`, `gradientLambdaPassV2` (v1: `gradientCreatePass`, `gradientLambdaPass`) |
| `antiLag: 'gradient'` input contract: one (l_prev, l_cur, valid) texel per 3×3 stratum | S-8 | S2 §3.1–3.3 | renderer projects and re-shades; denoiser only reconstructs | | `src/shaders/gradient.ts`, `src/denoisers.ts` `SignalExtras.gradient` |
| gradient strata reduced in 9×9 workgroups (one pixel per thread) | — | our design (performance) | | | `src/shaders/gradient.ts` `gradientCreatePass` (now `antiLagVersion: 1` only) |
| anti-lag v2 noise floor: var(δ̂) = (linearly filtered per-stratum var δ) × ΣK², ΣK² ≈ 1/(4πv) with v the per-axis spatial variance of the composite reconstruction kernel, tracked through the iterations as a weighted mixture (taps' v + this iteration's offset spread) | S-7b | Gaussian approximation of an iterated kernel (central limit; variances of convolved kernels add); S2 §3.4 / S3 `AtrousGradient.frag` propagate Σw²var/(Σw)², which assumes independent taps | **our design / measured deviation from S3's propagation**: after the first iteration neighbours share inputs, so S3's form shrinks var ~20× too far over 5 equal-weight iterations (estimate: 9⁵ vs ~2900 effective strata; σ ~4.5× too low); v1 then had λ > 0 on 85–93 % of static pixels and histories ≤ ~13 frames (results/M1.md §12) | | `src/shaders/gradient.ts` `gradientAtrousPassV2` (w channel), `gradientLambdaPassV2` |
| anti-lag v2 per-signal floor k: diffuse 2, specular 1 | S-7b | our tuning (test bed, results/M1.md §12) | diffuse: k = 1 or 2 equal (39.12 dB), 2 keeps static histories long; specular: 1 keeps detecting view-dependent drift (+0.11 dB vs 2) | | `src/svgf.ts` `writeParams` (`antiLagNoiseFloor` −1 = per signal) |
| anti-lag v2 gradient samples: one thread and one reprojection per 3×3 stratum; history mean of the stratum = mean of 9 bilinear samples at the centre's reprojection + (dx, dy) = per axis weights (1 − f, 1, 1, f)/3 over 4 texels = 2 hardware-bilinear taps per axis | S-7b | linear-filter tap folding (Sigg & Hadwiger, *GPU Gems 2* ch. 20); stratum = S2 §3.1 | **our design** (performance): assumes uniform motion inside a stratum; strata touching sky or with an invalid centre footprint get no history; same PSNR as v1's per-pixel reprojection (results/M1.md §12), create 0.46–0.57 → ~0.2–0.3 ms | | `src/shaders/gradient.ts` `gradientCreatePassV2` |
| anti-lag v2 gradient state packed as 8 × f16 in one rgba32uint (σ instead of var) | S-7b | storage choice; σ for f16 range as SPEC S-2a | **our design** (performance): one 16-byte load per tap instead of two rgba32float | | `src/shaders/gradient.ts` `PACK_WGSL` |
| 4 gradient à-trous iterations (v2; S2/S3: 5) | S-7 | S2 §3.4 | **measured**: 4 = 5 within ±0.01 dB, 3 = −0.04 dB diffuse (results/M1.md §12) | | `src/svgf.ts` `resolveOptions` (`gradientIterations`) |
| young-history spatial variance radius 1 (3×3) for specular under anti-lag v2 (S1/S3: 7×7 at n < 2, else 5×5) | S-2 | S1 p.5; S3 `EstimateVariance.frag` | **measured**: +0.07 dB specular pooled, cheaper; diffuse keeps 3 (radius 2: −0.01, 1: −0.03 dB); radius 0: −3.5 dB (results/M1.md §12) | | `src/shaders/svgf.ts` `variancePass` (`spatialVarianceRadius`) |
| specular normal weight: cutoff at θ_L(α) + 1°, linear in angle, angle ratio via sqrt((1−cos)/(1−cos θ0)) | (S-3 uses the power form) | θ_L: SPEC R-1; linear shape: GTC20 s.46 | **ours**; `specularNormalWeight: 'power'` gives SPEC S-3 (measured −0.65 dB) | | `src/shaders/svgf.ts` `weightsWgsl` |
| specular roughness radius 1 − smoothstep(10r, 70r, ∣Δp∣) | — | RTG1-32 Eq. 15 | `radiusScale` option | yes (RTG1-32 via shadows-specular.md) | `src/shaders/svgf.ts` `wSpec` |
| `luminanceVariance: 'mean'` (variance of the accumulated mean drives w_l) | — | our design (experiment) | off by default (measured worse) | | `src/shaders/svgf.ts` `variancePass` |
| dev page: exact ground truth + injected Exp(1) noise | — | ssgiDev `svgf-noiseinject.wgsl` (prior work by Dennis) | analytic scene and noise model ours; dev only, not shipped | | `packages/denoiser-realtime/dev/` |

### Recurrent pipeline (M2/M3)

| item | SPEC | source | our deviation | 2nd review | code |
|---|---|---|---|---|---|
| 7-pass structure, recurrent loop, separate stabilization history | §5.1 | RTG2 §49.3, §49.5, Fig. 49-3; GTC20 s.15–19, s.51 | + `prepare` pass | | `packages/denoiser-realtime/src/recurrent.ts` `RecurrentPipeline.encode` (buffer rotation §10.1; both signals per dispatch) |
| GGX lobe half-angle θ_L, E = 0.75 | R-1, D4e | E = 0.75 from RTG2 p.841 prose; derivation from the GGX NDF | **our derivation** (replaces GTC20 / FB p.72 forms) | | `packages/denoiser-realtime/src/shaders/svgf.ts` (SVGF specular: `setCenter`, `historyCap`); `src/shaders/recurrent.ts` `thetaL` |
| dominant direction factor (simple fit, α input) | R-2, D4f | FB Listing 22, p.71 (and its remark that the simple fit performs better) | input convention α chosen deliberately | | `packages/denoiser-realtime/src/shaders/recurrent.ts` `domFactor`, `kern{i}` (specular kernel plane), `temporalSpecular` (m, R-12) |
| pre-blur: static disk, constant radius, A = 0 weights | R1, D1 | RTG2 §49.5.1, §49.5.5; GTC20 s.51 | radii 15/10 px and the denoised-ĥ clamp: **our design** | | `packages/denoiser-realtime/src/shaders/recurrent.ts` `preBlurPass` |
| ĥ not filtered in pre-blur | R1 | GTC20 s.60 | — | | `packages/denoiser-realtime/src/shaders/recurrent.ts` `preBlurPass` |
| temporal accumulation, Catmull-Rom, no clamp in TA | R2 | RTG2 §49.5.2, §49.7, p.834 | — | | `packages/denoiser-realtime/src/shaders/recurrent.ts` `temporalPass` (Catmull-Rom gated on the 4 inner taps + min/max clamp, like svgf) |
| parallax definition | R-7 | RTG2 §49.8.1 prose, Fig. 49-5 | previous direction from 2.5D reprojection; no ×60 | | `packages/denoiser-realtime/src/shaders/svgf.ts` `historyCap` (previous direction from `expectedPrev`) |
| surface-motion frame cap A_spec = θ_L·NoV^κ/π | R-8 | properties from RTG2 p.834 | **our design** (listing 49-4 not used) | | `packages/denoiser-realtime/src/shaders/svgf.ts` `historyCap` (used by SVGF specular, SPEC S-1); `src/shaders/recurrent.ts` `specCap{i}` (surface candidate of recurrent specular) |
| virtual position X + v̂·h̃·F_dom | R-9 | virtual image: RTG1-25 p.451, S15 slide 67; pull-back by dominant factor: RTG2 p.835–836 prose | listing 49-6 not used; h̃ = this frame's fast ĥ (surface-reprojected fast history + this frame's ĥ) | yes (RTG1-25/S15 via shadows-specular.md) | `packages/denoiser-realtime/src/shaders/recurrent.ts` `virtualPrevUV`, `temporalSpecular` |
| virtual confidence (validity × normal × roughness × fast-ĥ) | R-10, D12a | concept: RTG2 p.837 prose | **our design** (listing 49-7 not used); tap plane test against {Xp, np} only (no pairwise normal), bilinear only (Catmull-Rom +0.04 dB for 0.13 ms) | | `src/shaders/recurrent.ts` `virt{i}`, `temporalSpecular` |
| confidence-scaled virtual clamp | R-11, D12b | RTG2 p.837 prose | **our design**; M3: always clamped, window γ·(1 + 2·c_v)·σ with γ = 1 (SPEC: lerp(clamp γ = 2, unclamped, c_v)); measured +0.07 dB glossy | | `src/shaders/recurrent.ts` `temporalSpecular` |
| surface/virtual blend by dominant factor; α-space A update | R-12 | RTG2 p.837 prose ("amount of virtual motion") | blend in α-space ours (listing 49-8 not used); current-frame detector compares against the blended history; fast luminance follows the blended reprojection (ĥ stays surface) | | `src/shaders/recurrent.ts` `temporalSpecular` |
| mip generation, 3 levels, shared memory | R3, D7e | RTG2 §49.5.3, Fig. 49-3; GTC20 s.32–35 | atlas layout, non-sky averaging: ours | | `packages/denoiser-realtime/src/shaders/recurrent.ts` `mipsPass`, `ATLAS` |
| history fix: start level, 3×3 viewZ-only cross-bilateral, fall to finer level | R4a, D7 | RTG2 §49.5.4 p.829; GTC20 s.35 (start-level formula, slide pseudo-code) | τ_fix, sum threshold 0.25, A_fix = 3: **ours, tuned on captures** | | `packages/denoiser-realtime/src/shaders/recurrent.ts` `historyFixPass` `mipRepair{i}` |
| anti-firefly (rank-based clamp) | R4b, D9 | named in RTG2 p.830 (RCRS, HB94 — not read) | **our design** | | `packages/denoiser-realtime/src/shaders/recurrent.ts` `historyFixPass` (b) |
| 8-tap Poisson disk | R-3, D3a | 8 taps: RTG2 §49.5.5, §49.10; golden-angle spiral VOG79 | antipodal 4+4 layout ours | | `packages/denoiser-realtime/src/shaders/recurrent.ts` `DISK` |
| Bayer 4×4 rotation, animated | D3b | RTG2 §49.5.5; golden-ratio animation RTG2-24 §24.7.2 | — | reviewed 2026-10-25: confirmed (RTG2-24 §24.7.2 pp.383–384, checked in the shadows review) [review](reviews/shadows-provenance.md) | `packages/denoiser-realtime/src/shaders/recurrent.ts` `blurRotation` |
| world-space kernel plane, axis reflect(−D, n), tangent ⟂ n | R-4 | RTG2 §49.9 prose, Fig. 49-9; GTC20 s.38–40; METRO s.56 | elongation function s_T: **ours** (listing 49-9 not used); basis DUF17 | | `packages/denoiser-realtime/src/shaders/recurrent.ts` `kern{i}`, `tapPixel`, `onbT`/`onbB` (affine screen Jacobian of the kernel plane at the centre since 1ecc596) |
| radius: 1/(1+A), hit-distance clamp, R_max/R_min | R-5, D2 | GTC20 s.20–22 (1/(1+A)), s.60 (shrink for short hits); RTG2 p.830 (inputs) | lobe-footprint clamp c_h·h̃ and constants: **ours** | | `packages/denoiser-realtime/src/shaders/recurrent.ts` `blurPass`, `radiusRough{i}`, `hitClamp{i}` |
| weight shape smoothstep(0,1,sat(1−|ax+b|)) | R-6 | RTG2 Eq. 49.3 | — | | `packages/denoiser-realtime/src/shaders/recurrent.ts` `Wt` |
| geometry weight = plane distance | R-6 | RTG2 p.841; GTC20 s.44–45; METRO s.59 | relative tolerance lerp(2 %, 0.5 %) ours | | `packages/denoiser-realtime/src/shaders/recurrent.ts` `tapWgsl`, `planeDist` |
| normal weight via lobe angle, tightening with A | R-6 | RTG2 p.841; GTC20 s.46 | g(A) and +1° ours | | `packages/denoiser-realtime/src/shaders/recurrent.ts` `tapWgsl` (angle ratio in cosine space, sqrt((1−cos)/(1−cos θ0))) |
| roughness weight | R-6 | concept GTC20 s.48 | tolerance ours | | `packages/denoiser-realtime/src/shaders/recurrent.ts` `tapWgsl` (specular) |
| hit-distance weight | R-6, D4b | concept RTG2 p.841 | **our formula** | | `packages/denoiser-realtime/src/shaders/recurrent.ts` `tapWgsl` |
| post-blur radius scaled by |blur − TA| | R6, D2c | RTG2 §49.5.6 | scaling function **ours** | | `packages/denoiser-realtime/src/shaders/recurrent.ts` `blurPass(kinds, true)` |
| temporal stabilization, variance clamp, own history | R7, D10 | RTG2 §49.5.7; SAL16 | widening γ_s/β_s, N_stab = 7: **ours**; anti-lag moved to R4 | | `packages/denoiser-realtime/src/shaders/recurrent.ts` `stabilizePass` |
| specular stabilization uses both reprojections, amount from TA | R7 | RTG2 p.831 | **not used (M3, measured)**: the virtual candidate (no validity test in R7, curvature-corrected, m·c_v from TA) cost 0.36–1.5 dB on `std540-orbit` replays (removed together with storing m·c_v: live orbit +1.9 dB); stabilization reprojects with surface motion only, m stays in `data` | | `src/shaders/recurrent.ts` `stabilizePass` |
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
| neighbourhood validity in history fix / stabilization / detector = plane distance at τ_g(A = 0) | R4, R7 | RTG2 p.841 (plane distance) | normal test omitted in neighbourhoods (cost) | | `src/shaders/recurrent.ts` `temporalPass` / `historyFixPass` / `stabilizePass` neighbourhood loops (`tile_z`, `planeDist`) |
| taps placed with the affine screen Jacobian of the kernel plane at the centre; plane distance linear in the tap pixel | R-4 | standard projective algebra | identical PSNR to exact projection, ~0.1 ms per kernel pass less | | `src/shaders/recurrent.ts` `kern{i}`, `tapPixel`, `makePlaneU`, `planeDist` |
| skeleton timing mode: every pass replaced by a trivial kernel with identical bindings | §10.3 | our design (tooling) | | | `src/shaders/recurrent.ts` `trivialPass` |
| ~~interim recurrent specular (surface motion only)~~ superseded by M3 (a787b20), see below | R-7, R-8, §5.6 | as rows above | | | |
| dev page: 1-spp diffuse (cosine) and mirror hit distances in the synthetic scene; `still=1` | — | our design (dev only, not shipped) | | | `packages/denoiser-realtime/dev/scene.ts` |

### `denoiser-realtime` M3 additions (recurrent-spec implementer, 2026-10-25; provisional, SPEC v0/v0.1)

| item | SPEC | source | our deviation | 2nd review | code |
|---|---|---|---|---|---|
| curvature correction of the virtual distance: d_v = h̃ / (1 + 2κh̃), κ = mean over the 4 axis neighbours of dot(n_q − n, ΔX)/‖ΔX‖² (convex > 0) | D12c (was "later") | mirror equation 1/d_o + 1/d_i = 2/R as used for reflections in RTG1 ch. 32 §32.4.3 (thin-lens reflection motion); curvature from neighbouring normals: textbook differential geometry | isotropic κ, no incidence-angle term; measured +1.0 dB glossy specular (r < 0.15: 30.5 → 32.1 dB) | | `src/shaders/recurrent.ts` `temporalSpecular` (`curvSum`) |
| m stored as m·c_v in `data` | D14 | — | our design (only consumer was the R7 virtual candidate, now unused) | | `src/shaders/recurrent.ts` `temporalSpecular` |
| specular current-frame detector floor A_fast·f_r(α) (mirrors drop to ~0 history on a mismatch) | C-10b | — | **our design, measured** (+0.1 dB orbit): mirror input is nearly noise-free, history buys little there | | `src/shaders/recurrent.ts` `temporalSpecular` (`detRough`) |
| specular anti-lag (history fix) and detector mean centred on the pixel's own value as roughness → 0: μ = lerp(own, 3×3 mean, f_r(α)) | C-10, C-10b | — | **our design, measured**: the 3×3-mean ± standard-error window blurred every reflected edge on clean mirror input (`light` r < 0.15: 34.8 → 40.7 dB; glossy +0.3, orbit +0.5) | | `src/shaders/recurrent.ts` `historyFixPass` (c), `detector` |
| specular minimum blur radius R_min·f_r(α) (no floor on mirrors) | R-5 | — | our design; +0.5 dB at r < 0.15 on `light` | | `src/shaders/recurrent.ts` `blurPass` (`specMinRadius`) |
| specular R_max 30 px (diffuse 45) | R-5 | SPEC 30 px | measured: 45 → 30 = +0.13 dB orbit, +0.7 dB disoccluded | | `src/recurrent.ts` `writeParams` |
| tap counts: post-blur 4 taps (both signals), pre-blur 4 taps (specular) | R-3 | SPEC 8 taps | **measured** (4 paths, 1080p): post-blur 4 neutral (+0.00..+0.06 dB), pre-blur 4 neutral for specular (diffuse −0.5 dB, stays 8); −0.5 ms joint | | `src/shaders/recurrent.ts` `tapSet`; `src/recurrent.ts` `preBlurTaps` / `blurTaps` / `postBlurTaps` |
| recurrent-only reprojection: linear unprojection with the previous projection, plane test against {Xp, np} (no per-tap unprojection, no pairwise normal average) | C-6, C-7 | RTG2 §49.6 (plane distance) | SPEC pairwise-averaged normal dropped; quality-neutral on 4 paths, −0.09 ms | | `src/shaders/recurrent.ts` `REPROJECT_R` (`reprojectR`) |
| 10×10 workgroup-shared tiles for the 3×3 neighbourhoods (temporal, history fix, stabilize); branchless 2×2 history taps | — | standard GPU practice (our code) | identical output; −0.2 / −0.35 / −0.26 ms | | `src/shaders/recurrent.ts` `tileWgsl` |
| stabilization history: bilinear for diffuse, Catmull-Rom for specular | C-8 | RTG2 §49.7 | diffuse bilinear: identical PSNR, −0.07 ms; specular keeps Catmull-Rom (bilinear −0.05..−0.16 dB) | | `src/shaders/recurrent.ts` `stabilizePass` |
| GuidePass `slope: false` for recurrent-only pipelines | C-5 | — | the recurrent filter never reads the depth slope: prepass 0.18 → 0.10 ms, −4 B/px | | `src/guides.ts`, `src/shaders/prepass.ts` |
| tried and removed (measured, M3): luminance weight with predicted relative noise k·f_r/√(1+A) (±0.1 dB, −1.7 dB at r ≥ 0.6 for k = 1); radius ∝ (1+A)^−p with p < 1 (−0.1..−0.5 dB); virtual gate by surface parallax loss (orbit mirrors +1.4, glossy r < 0.35 −0.9); m = F_dom^p; f16 kernel taps (−0.11 ms, −0.2 dB on HDR dev-page diffuse) | — | — | not in the code | | — |

### Shadows (M4)

_Implemented 2026-10-25 by the shadows agent (implementer, RULES §8: no NRD code, README or
port opened; `sources/shadows-specular.md` read, every primary source below re-read by the
implementer: M12 §3–4 Eq. 4/11–13 and §6, H18 §4.1–4.2, RTG1-25 §25.2.1 p.443, TR19 slide 72).
Rows marked "yes" still need the second reviewer the register asks for, because their
pointer came from `sources/shadows-specular.md`. Host: `packages/denoiser-realtime/src/shadow.ts`;
results: [results/M4.md](results/M4.md). v2 (same night, same agent, same role): the rows marked
"v2" and the constant rows below; their sources (H18, RTG2-49 prose) were read directly, not via
`sources/shadows-specular.md`. v2.1 (2026-10-25, shadows-reset agent, implementer,
RULES §8: no NRD code, README or port opened): the rows marked "v2.1" (the reset fix); `youngSpan`
of the v2 young-mean row is replaced by `youngFrames` / `youngTaper`._

| item | SPEC | source | our deviation | 2nd review | code |
|---|---|---|---|---|---|
| penumbra footprint R·h/(D−h), h·tanθ | SH-2 | M12 Eq. 4 (`s = d1/d2 − 1`) and Eq. 13 (filter width ∝ σ·(d1/d2_max − 1), pixel floor; constants §6) | rewritten for a hit distance: d1/d2 − 1 = h/(D − h) (our algebra); light radius instead of M12's Gaussian σ; kernel radius = 0.75·W (tuned, M4.md §3), pixel floor 1 px | reviewed 2026-10-25: confirmed with correction (M12 Eq. 13's floor is 1/(kµ·Ω_x^max); 1 px is ours) [review](reviews/shadows-provenance.md) | `packages/denoiser-realtime/src/shaders/shadow.ts` `temporal` (gS = h/(D−h), accumulated over occluded samples), `spatial` (Rw) |
| nearest occluder wins (3×3-tile minimum, also for pixels with their own estimate) | SH-3 | principle: M12 `d2_max` (the occluder closest to the receiver sets the width); M12 §6 gives unoccluded pixels the d1/d2 averaged over a 5-px radius | **our design**: min over 8×8 tiles (3×3 neighbourhood) instead of a 5-px average; the patent-described remedy in shadows-specular.md G2 not used (its text was never read) | reviewed 2026-10-25: confirmed (M12 p.163:4, §6 p.163:7) [review](reviews/shadows-provenance.md) | `packages/denoiser-realtime/src/shaders/shadow.ts` `temporal` (tile stats), `SHADOW_TILES_WGSL`, `spatial` (`SF_MERGE_MIN`) |
| penumbra tiles / skip (indirect dispatch over a tile list) | SH-3 | TR19 slide 72 ("penumbra mask", slide title + figure); H18 §4.1 (no filtering cost outside penumbrae) | tile = 8×8, active if the 3×3 tiles hold a fractional history or disagreeing raw samples (our criterion) | reviewed 2026-10-25: confirmed (TR19 s.71–72, H18 §4.1 p.7) [review](reviews/shadows-provenance.md) | `packages/denoiser-realtime/src/shaders/shadow.ts` `SHADOW_TILES_WGSL`, `dispatchWorkgroupsIndirect` in `shadow.ts` |
| temporal on raw visibility, no spatial output fed back | SH-4 | RTG1-25 §25.2.1 p.443 (scalar shadow filter derived from SVGF, Karis-style box clamp sized by Salvi's variance over 5×5); raw-only history precedent: RTG1-13 §13.4.5.1 Eq. 11 p.170 (reprojected raw visibility averaged, spatial filter afterwards); FFX drift measured in `docs/specs/temporal.md` | history = raw visibility only (our design); clamp window 0.4σ + 0.05 instead of 1σ (≈ 2 standard errors of the 25-sample mean, tuned) | reviewed 2026-10-25: confirmed (RTG1-25 p.443; raw-history precedent RTG1-13 Eq. 11 p.170) [review](reviews/shadows-provenance.md) | `packages/denoiser-realtime/src/shaders/shadow.ts` `temporal` |
| anti-lag: a history the clamp moved restarts at the current frame | — | **our design** (clamp-toward-current idea, RTG2 p.830 / SPEC C-10; restart to A = 0 measured, M4.md §3) | | | `packages/denoiser-realtime/src/shaders/shadow.ts` `temporal` (`antiLag`, `antiLagHistory`) |
| uniform 5×5 window → exact history value | — | **our design** | | | `packages/denoiser-realtime/src/shaders/shadow.ts` `temporal` (`SF_SNAP`) |
| history cap from penumbra width in pixels (A ≤ W_px²) | — | **our design** (repeated reprojection resampling blurs ~√A px) | | | `packages/denoiser-realtime/src/shaders/shadow.ts` `temporal` (`historyScale`) |
| Catmull-Rom history fetch, clamped to the 2×2 taps | C-8 | shared core / RTG2 §49.7 prose (see the core rows above) | used for visibility only; scalar channels stay bilinear | | `packages/denoiser-realtime/src/shaders/shadow.ts` `temporal` (`sampleCatmullRom`) |
| reprojection: affine tap positions, plane = current normal | C-6/C-7 | shared core rows above (RTG2 §49.6 prose) | plane distance linear in the tap pixel (as the recurrent kernels do), current normal instead of the pairwise average, backfacing via unnormalized octahedral sign (our simplifications, −0.03 dB, −0.1 ms) | | `packages/denoiser-realtime/src/shaders/shadow.ts` `reprojFast` |
| spatial: 2 passes, 8-tap disk on the tangent plane, rotated per pixel, second pass half radius | SH-5 | SPEC R-3 / D3b (VOG79; RTG2 §49.5.5 prose; RTG2-24 §24.7.2) | radius × lerp(1, 0.5, A/A_cap); weights: plane distance (2 %) and normal (30°) in SPEC's W(x) shape; affine screen Jacobian of the kernel axes (our approximation) | reviewed 2026-10-25: confirmed (RTG2-24 §24.7.2 pp.383–384) [review](reviews/shadows-provenance.md) | `packages/denoiser-realtime/src/shaders/shadow.ts` `shadowSpatialWgsl` |
| self-shadowing terminator (light partly below the horizon, h = 0) | — | **our design**: analytic test n·l < sin(angular radius of the light), 16-px radius there (visibility follows n·l) | | | `packages/denoiser-realtime/src/shaders/shadow.ts` `spatial` |
| anisotropic stretch along the projected light direction by 1/(n·l) | SH-5 | M12 Eq. 11–12: filter distances measured along the plane parallel to the light (our reading: on the receiver plane this stretches the kernel by 1/(n·l)); RTG2-24 p.389 (grazing light lengthens penumbrae) | option `anisotropy`, **off**: −0.3 to −2.7 dB on the test bed (M4.md §3) | reviewed 2026-10-25: confirmed (M12 Eq. 11–12 p.163:4; RTG2-24 p.389) [review](reviews/shadows-provenance.md) | `packages/denoiser-realtime/src/shaders/shadow.ts` `spatial` (`SF_ANISO`) |
| noise-driven fallback (no hit distance or no light) | SH-6 | H18 §4.1 (σ ∝ E, E denoised by a 3×3 box), §4.2 Eq. 29 (E: total variation of the second derivative along n = 4 lines through x) | on the 5×5 shared tile without the random offset; accumulated over time instead of the paper's 3×3 box; radius = 32 px × E at 1080p (v2; v1 24 px, tuned for the fallback alone, 24–48 flat there) | reviewed 2026-10-25: confirmed with correction (σ ∝ E is H18 §4.1, Eq. 29 §4.2, p.7) [review](reviews/shadows-provenance.md) | `packages/denoiser-realtime/src/shaders/shadow.ts` `temporal` (`SF_NOISE`), `spatial` |
| renderer contract (unjittered origins, golden-ratio blue noise) | SH-7 | TR19 slides 55–62; RTG2-24 §24.7.2 | documented only (the test bed renders without jitter, blue noise per M1.md §2) | reviewed 2026-10-25: confirmed (TR19 s.55–62, RTG2-24 §24.7.2) [review](reviews/shadows-provenance.md) | — |
| v2: kernel radius = mean of the occluder-sized and the noise-sized radius (with hit distance and light) | SH-5/SH-6 | sizing from M12 Eq. 13 (row SH-2) and from H18 §4.1/Eq. 29 (row SH-6); combining them is **our design** | `noiseBlend` 0.5: R = ½·0.75·W + ½·32 px·E; E (accumulated like g over ≤ 8 frames) rides in the geometry texture's unused 8-bit roughness slot; measured: live 960×540 5 paths +0.24 dB pooled (0.5) vs +0.13 (0.25), +0.20 (0.75), noise radius 32 px best of 16/24/32/48/64 (results/M4.md §10) | — (sources read directly by the implementer, not via shadows-specular.md) | `packages/denoiser-realtime/src/shaders/shadow.ts` `temporal` (`noiseE`, `withE`), `shadowSpatialWgsl` (`withE`) |
| v2: fresh pixels: the spatial passes' input mixes the 1-spp sample with a 5×5 mean of raw visibility over taps on the receiver's plane | — | idea: RTG2 ch. 49 §49.5.4 prose (history fix: where history was discarded only a 1-rpp signal exists; a pre-averaged (mip) neighbourhood stands in for it, upsampled bilaterally by viewZ; full reconstruction only for 1–3 frames) | **our design**: one 5×5 level from the temporal pass's shared tile instead of mips; plane-distance weight (2 %) instead of a viewZ weight; weight 0.75 on A = 0 only (`youngMean`, `youngSpan` 1; longer spans lost on the 96-frame paths); gated off where the pass-0 radius is ≤ 1 px (hard edges); output copies only, the history stays raw | — (RTG2-49 prose read directly; listings not used) | `packages/denoiser-realtime/src/shaders/shadow.ts` `temporal` (young variant) |
| v2: tried and removed or left off (measured, results/M4.md §10.3–10.4) | — | — | 8 extra spatial taps at half radius for young pixels (no gain); young radius boost ×(1 + k/(1+A)) with the young mean (−0.1…−0.4 dB); young mean over 7×7 / 9×9 (worse than 5×5); young mean on every short history, weight k/(1+A) or spans 2–3 (−0.08…−0.15 dB live: narrow penumbrae stay short-lived under the W_px² cap); young mean into the history (worse); 4-tap second pass (−0.23 dB, no time saved); no normal weight in pass 2 (−2.5 dB) | | — |
| `uniformSnap: 'change'`: snap only where the history sits outside the clamp window | — | **our design** (variant of the uniform-snap row above) | option, not default: between snap on and off on every metric (M4 §10.5) | | `packages/denoiser-realtime/src/shaders/shadow.ts` `temporal` (`SF_SNAP_CHANGE`) |
| `maxScaleHistory` = 7 (sample cap of the accumulated g and E) | SH-2 | **our design** | ≈ 1/√8 standard error on g while following a moving occluder within 8 frames; measured flat: 3 / 7 / 15 → ±0.01 dB (M4 §10.6) | | `packages/denoiser-realtime/src/shaders/shadow.ts` `temporal` (`maxWHistory`) |
| `maxRadius` = 48 px at 1080p (cap of each kernel axis) | SH-5 | **our design** | safety cap on the taps' texture-cache footprint for very wide penumbrae; inert on the test bed (24 / 48 / 96 px identical, M4 §10.6) | | `packages/denoiser-realtime/src/shaders/shadow.ts` `shadowSpatialWgsl` (`maxRadiusPx`) |
| pass-2 rotation offset 2 − φ ≈ 0.382 turn (`pass1Phase`) | SH-5 | **our choice**: the golden angle (Vogel 1979's spiral step), complementing the per-frame golden-ratio animation (RTG2-24 §24.7.2), so pass 2's angle never repeats pass 1's in the same or the next frame | measured flat: 0 / 0.25 / 0.382 / 0.5 within 0.012 dB; 0.5 ≡ 0 (antipodal disk) (M4 §10.6) | | `packages/denoiser-realtime/src/shaders/shadow.ts` `shadowSpatialWgsl` |
| v2.1: clamp window over the 5×5 taps whose normal is within `normalAngle` of the receiver's (binary), window × √(25/n), the plain window below 3 such taps; the normal tile (pack4x8snorm in workgroup memory) is loaded only in tiles whose raw samples disagree | SH-4 | **our design**, on RTG1-25 §25.2.1's 5×5 clamp window (row SH-4); geometry-aware neighbourhood statistics as such are the edge-stopping idea of SVGF (Schied et al. 2017, HPG) | fixes "frame 2 worse than frame 1": from the second frame on, the plain window pulled thin occluders / creases toward the surface next to them (real scene: legs in shadow on a lit floor +0.075 bias). A plane-distance test on top: 0 dB on the test bed, +0.06…0.28 dB on the real scene, for a depth tile and ~+0.05 ms, left out; a plane test alone (2 % of view distance, also with a depth-relative tolerance) lost up to 2.4 dB (`thin`: a slat's side face takes the front face next to it) (results/M4.md §11) | — | `packages/denoiser-realtime/src/shaders/shadow.ts` `temporal` (`clampGeometry`, `clampMinTaps`) |
| v2.1: clamp window widened by saturate(1 − W_px / 2) where the pixel's own penumbra width W_px is below 2 px | — | **our design** (a 5×5 mean is off by up to ~0.4 next to a step; such pixels keep a short history anyway under the W_px² cap) | `clampEdgePx` 2 (1 / 3 / 4: −0.03 / −0.02 / −0.1 dB at 960×540) | — | `packages/denoiser-realtime/src/shaders/shadow.ts` `temporal` (`clampEdgePx`) |
| v2.1: young mean kept for 8 frames after a reset / disocclusion, weight 0.75 · (frames left / 8) / (1 + A / 4); counter in the history's A channel above 32 (not shortened by the history cap or anti-lag); its taps also pass the normal test | — | extends the v2 row (idea: RTG2 ch. 49 §49.5.4 prose); the weight shape is **our design** (about the inverse-variance share of a biased 25-sample mean against an (A + 1)-sample temporal mean); the v2 lesson "short history ≠ new" kept by counting frames since the pixel was new | `youngFrames` 8, `youngTaper` 0.25 (replaces v2's `youngSpan`); v2 switched the mean off on the second frame (penumbra −1.0…−2.2 dB at frame 2 on the real scene) | — | `packages/denoiser-realtime/src/shaders/shadow.ts` `temporal` (`youngFrames`, `youngTaper`, `histA`) |
| v2.2: output stabilization pass: a short history of the final output (never fed back into the raw temporal history), reprojected with the motion vectors, clamped to the 3×3 min / max of this frame's spatial output, blended with weight `stabilize` 0.25; indirect over the penumbra tiles (box from the final spatial output, from T in skipped tiles, per-tile flag from `tiles`) | SH-5 (new pass) | RTG2 §49.5.7 prose (a temporal stabilization pass with its own history outside the feedback loop, "logically very close to temporal supersampling with variance color clamping", with anti-lag) | min / max box instead of a variance box, blend 0.25 (0.125 / 0.25 / 0.5 measured) and the tile restriction: **our design**, measured (results/M4.md §12.3). Implemented 2026-10-25 by the moving-shadows agent (implementer, RULES §8: no NRD code, README or port opened) | — | `packages/denoiser-realtime/src/shaders/shadow.ts` `SHADOW_STABILIZE_WGSL`, `shadow.ts` (`stabilize`) |
| v2.2: stabilization only where the 3×3 range is below `stabilizeBox` (0.05 at 1080p, × 1080 / height), fading out up to twice it | — | **our design** (without it the pass blurred hard edges, −5.5 dB on the test bed: TAA-style blur of a resampled history where the box spans the step); resolution scaling because a penumbra's per-pixel slope halves when the resolution doubles | 0.1 at 1080p: `light` −0.45 dB, 0.05: −0.19 (M4 §12.3) | — | `SHADOW_STABILIZE_WGSL` (`stabilizeBox`) |
| v2.2: stabilization anti-lag: blend weight raised to saturate(64 · \|clamped − history\|) | — | anti-lag in the stabilization pass: RTG2 §49.5.7 / §49.11 prose; the clamp distance as the confidence signal: a later-found public parallel is ML25 p.35 (history confidence from the normalised distance to the clamp box), listed in `sources/nrd-public-2022-2026.md` §3.4 | gain 64 and the form saturate(gain · distance): **our design**, measured (8 / 32 / 64 / 128 on std540-object: dynamic PSNR 21.76 / 22.14 / 22.24 / 22.29; the alternative on the temporal history length, `stabilizeYoung`, lost) | — | `SHADOW_STABILIZE_WGSL` (`stabilizeAntiLag`, `stabilizeYoung`) |
| v2.2: `rotationStep` option: per-frame step of the spatial disk's rotation (0 = fixed rotation) | SH-5 | default unchanged (0.618, RTG2-24 §24.7.2 golden-ratio animation, SPEC D3b) | the option itself is a measurement aid: a fixed rotation removes ~40 % of the boil without stabilization, ±0.01 dB pooled; left at the default (M4 §12.2); default 0 since 2026-10-27 (Dennis q23 (a), d2f3a0f) | — | `shadowSpatialWgsl` (`rotationStep`) |
| `snapHardPx` option: with `uniformSnap: 'change'`, also snap a uniform 5×5 window where the pixel's own penumbra width W_px is below N px (default 0 = off) | SH-4 | **our design** (results/SHADOWS-LOOK.md: `'change'` + the `clampEdgePx` window keeps resampled fractional history next to hard edges on moving cameras) | option; **default 2 since cc8f1e7** (Dennis, q21 (a), 2026-10-26) | — | `shadowTemporalWgsl` (snap test), `shadow.ts` (`snapHardPx`) |
| `backfacePass` option: pixels with n·l ≤ −sin θ_light and no occluded sample of their own keep their input | SH-5 | **our design**; relies on the renderer contract that a ray toward a light below the horizon returns v = 0 (SH-7; the pages and test bed do) | option; **default true since cc8f1e7** (Dennis, q21 (a)) | — | `shadowSpatialWgsl` (`backface` variant) |
| `noiseCap` / `noiseCapSettled` options: H18 noise radius capped at k × the M12 occluder-sized radius before the blend, optionally only once the pixel's young frames are over | SH-5 | H18 §4.1–4.2 (E) and M12 Eq. 13 (W), as in the v2 blend row; the cap and the settled gate: **our design** | option, default off; fails rule 9's boil clause (results/SHADOWS-LOOK.md) | — | `shadowSpatialWgsl` (`noiseCap`, `noiseCapSettled` variants) |
| `f16Rounding` option (shadows; also SVGF, recurrent, occlusion normalizer — one implementation): `'nearest'` stores `unpack2x16float(pack2x16float(v))` into every f16 storage texture, so Metal's truncating store can't round again | SH-4 (history) | **our design**, from our measurement (LESSONS m8: rgba16float stores truncate on the M5 Pro, `pack2x16float` rounds to nearest); results/DISTANCE-LONG.md | default `'nearest'` for SVGF and the radiance recurrent filter since 2026-10-27 (Dennis q25 (a), bfd20b2); `'store'` (pass WGSL untouched) for shadows (−0.05 dB pooled), the occlusion recurrent mode and payload 'sh' | — | `src/f16.ts` (`roundF16Stores`), `shadow.ts` (`mkPipe`), `svgf.ts`, `recurrent.ts`, `occlusion.ts` |
| `stepTest` option: the H18 noise estimate E counts 0 for a frame where the raw 5×5 window is a clean step (both values present, no sample disagreeing with all of its in-window 4-neighbours; inner samples with 3 of 4) | SH-4 / SH-5 | H18 §4.2 Eq. 29 (E) and §4.1 (kernel ∝ E), re-read; the step test: **our design** (results/SHADOWS-MOTION.md: E is large at every clean hard step, LESSONS) | default since 2026-10-27 (Dennis q23 (a), d2f3a0f; results/SHADOWS-MOTION.md "Rule 9") | — | `shadowTemporalWgsl` (`stepTest`), `shadow.ts` (`stepTest`) |
| `edgeBox` option: where the clamp window opens at hard edges (W_px < clampEdgePx), the history is also clamped to the 3×3 raw min / max, weighted like the widening | SH-4 | Karis 2014, "High Quality Temporal Supersampling", SIGGRAPH course, slide 30 ("restrict history to the range of current frame's local neighborhood … clamp with min/max of 3×3 neighborhood", citing Lottes 2011 / Malan 2012), read in the slides; applied to hard shadow edges with the `clampEdgePx` weight: **our design** | default since 2026-10-27 (Dennis q23 (a), d2f3a0f) | — | `shadowTemporalWgsl` (`edgeBox`) |
| `terminatorAnalytic` option: occluder-free terminator pixels (no occluded sample of their own, n·l < sin θ_light) output the visible fraction of the light's disk above the tangent plane, 1 − (acos t − t√(1 − t²))/π with t = asin(n·l)/θ_light, instead of the 16 px terminator kernel | SH-5 | H18 Eq. 4 / 12 (§3: the unshadowed illumination U is integrated over the hemisphere Ω, so the horizon-clipped part of the light belongs to the analytic term and the stochastic visibility has nothing left there), re-read; the disk-segment closed form (small-light approximation of the cone cut by the tangent plane) and its use for 1-ray visibility that counts below-horizon samples as occluded (SH-7): **our design** | default since 2026-10-27 (Dennis q24 (a), with `horizonSnap`, d2f3a0f; needs the exact light, README) | — | `shadowSpatialWgsl` (`terminatorAnalytic` variant) |
| `horizonSnap` option (2026-10-27, shadows follow-ups): in the temporal pass, n·l ≤ −sin θ_light (whole light below the receiver's tangent plane) and a 0 sample → the history value is 0 | SH-4 | renderer contract SH-7 (a ray toward a light below the horizon returns v = 0) and H18 Eq. 4 / 12 (§3: the horizon-clipped light belongs to the analytic unshadowed term), re-read; the snap of the *history* (so `backfacePass` stops passing a lagging lit history on, and `terminatorAnalytic` has no jump at the back face): **our design** | default since 2026-10-27 (Dennis q24 (a), d2f3a0f); with `terminatorAnalytic` it removes q24's boil exception (results/SHADOWS-FOLLOWUPS.md §4) | — | `shadowTemporalWgsl` (`TemporalVariant.horizonSnap`), `shadow.ts` (`horizonSnap`) |
| `floorE` option (2026-10-27): the `minRadius` floor × clamp(E / floorE, 0.5, 1), E = the accumulated H18 noise estimate; at half the floor all 8 disk taps land on the pixel | SH-5 | M12 Eq. 13 (the filter width is floored near one pixel footprint; ours is a plain 1 px, row above) and H18 §4.1–4.2 (kernel ∝ E), re-read; scaling the floor by the accumulated E (which `stepTest` drives to 0 at clean steps): **our design** | default 0.05 since 2026-10-27 (Dennis q29 (a), d2f3a0f; it fails the boil clause narrowly, results/SHADOWS-FOLLOWUPS.md §1). Tried and removed: the same with this frame's clean-step flag (`hardFloor`, more boil) | — | `shadowSpatialWgsl` (`SpatialVariant.floorE`), `shadow.ts` (`floorE`, params slot q6) |
| `lightMotion` option (2026-10-27): ρ = light displacement / light size per frame (sphere: \|ΔL\| / radius; directional: angle / angular radius); history cap min(cap, k · max(W_px, 1) / (W_px · ρ)), history dropped where that is under one frame and the raw 5×5 window holds an edge | SH-4 | shadow displacement = g × light displacement, from M12 Eq. 4's slope s = d1/d2 − 1 = h/(D − h) (similar triangles; our algebra), re-read; the related public method, shadow motion vectors from the blocker and light positions (Zeng et al. 2021, "Temporally Reliable Motion Vectors for Real-time Ray Tracing", CGF 40(2), §4.1 Eq. 3, read in the author copy) reprojects along the motion instead; capping / dropping: **our design** | option, default off; fails the boil clause (std540-light static-penumbra +6.5 %), trade for Dennis (results/SHADOWS-FOLLOWUPS.md §3) | — | `shadowTemporalWgsl` (`TemporalVariant.lightMotion`), `shadow.ts` (`lightMotion`, `prevLight`, params slots q4 / q5) |

### Occlusion (M5)

_Implemented 2026-10-25 by the occlusion agent (implementer, RULES §8: no NRD code, README or
port opened). Host: `packages/denoiser-realtime/src/occlusion.ts`; results:
[results/M5.md](results/M5.md). Provisional (SPEC v0.1 §8 is an outline)._

| item | SPEC | source | our deviation | 2nd review | code |
|---|---|---|---|---|---|
| AO/SO = denoised normalized hit distance | O-1 | GTC20 s.9, s.54, s.63 | falloff from F-3 (ours). Measured (M5): the recurrent radiance output's alpha is a usable but clearly worse AO/SO than a dedicated occlusion filter | | `src/recurrent.ts` (output alpha); registry `occlusion-radiance-alpha` |
| occlusion-only mode of the recurrent pipeline: same passes, radiance channels dropped | O-2 | pipeline rows above (RTG2 §49.3–49.5 prose, GTC20) | **our design**: kinds `ao` / `so`, one r32float per signal instead of O-2's packed (ĥ_d, ĥ_s) rgba16float (same bytes for two signals, half for one); no pre-blur pass: the temporal pass normalizes the raw hit distance on load (ĥ is never pre-blurred, GTC20 s.60) | | `src/shaders/recurrent.ts` (`isOccKind`, `VT`/`LD`/`ST` helpers), `src/recurrent.ts` (`occ`) |
| ĥ-only anti-lag; slow ĥ clamped into the fast-history window | O-2, C-10 | C-10 row above (clamp toward a faster history: RTG2 p.830) | **our design**: the detector and history-fix window run on ĥ (no luminance); the clamp moves the slow ĥ itself (`occClamp`, +0.85 dB AO on the fast test bed) | | `src/shaders/recurrent.ts` `histFixOcc`, `detector` |
| SO: fast ĥ follows the virtual reprojection, weighted by m·c_v | R-9…R-12 | virtual-motion rows above | **our design** (the radiance filter keeps the fast ĥ surface-reprojected; for SO the clamp target must move with the reflection): SO +0.9 dB, `pan` +2.5 dB | | `src/shaders/recurrent.ts` `temporalSpecular` |
| Catmull-Rom history from 16 `textureLoad`s (r32float is unfilterable in core WebGPU) | C-8 | RTG2 §49.7 prose; standard Catmull-Rom weights | our code | | `src/shaders/recurrent.ts` `CATMULL_ROM_LOAD` |
| occlusion radius defaults: AO R_max 20 px, R_min 2 px | R-5 | R-5 row above | **tuned on the test bed** (fast preset, 7 paths) | | `src/recurrent.ts` `writeParams`, `src/occlusion.ts` |
| SVGF on ĥ written as a gray image | §8 (new) | S1 (unchanged SVGF) | normalization pass ours (F-3); occlusion defaults σ_l = 1.5, 3 à-trous iterations, SO α_min 0.3: **tuned on the test bed** | | `src/occlusion.ts`, `src/shaders/occlusion.ts` |
| test-bed AO/SO references: mean of per-sample normalized hit distances | — | **our design** (the curve is nonlinear, so the reference normalizes each sample) | | | `examples/realtime-denoiser/src/scene.ts` `ref_ao`, `ref_so`, `OCC_WGSL` |
| SO from AO (optional) | O-4 | FB §4.10.2 Listing 26 | not built | yes | |

### M7 SH/SG directional variants — **built (SVGF family), provisional** (SPEC v0.3 §8.5; results/M7.md)

_Added 2026-10-25 by the spec author (RULES §8: no NRD code, README, release notes or port opened;
read `sources/nrd-provenance.md` §3, `sources/nrd-releases.md`, `sources/nrd-change-magnitude.md`,
`sources/nrd-public-2022-2026.md`, the SD24 / ACS25 / ID25 primary slides, and Pettineo's SG series
parts 3–4 on his public blog, which the provenance audit lists as cited by NRD; the blog is a public
source, rule 2). New keys: **SD24** Kuenlin, Raytracing in Snowdrop, GDC 2024 · **ACS25** Leblanc &
Conte, AC Shadows, SIGGRAPH 2025 Advances · **ID25** Sousa, idTech8 GI, SIGGRAPH 2025 Advances ·
**RH01** Ramamoorthi & Hanrahan, "An Efficient Representation for Irradiance Environment Maps",
SIGGRAPH 2001 (cited by ID25 s.20; band factors are textbook) · **MS03** Malvar & Sullivan, YCoCg,
2003 · **MJP-SG3/4** Pettineo, SG series parts 3–4 (2016) · **WANG09** Wang et al., "All-Frequency
Rendering of Dynamic, Spatially-Varying Reflectance", SIGGRAPH Asia 2009 (via MJP-SG4, not read).
Every row: spec only, not built._

_Built 2026-10-25 by the m7-sh implementer (RULES §8 implementer: no NRD code, README, release notes or
port opened; read SPEC §8.5, this table and `sources/nrd-public-2022-2026.md`; none of SD24's printed
code was used). Code: `src/shaders/sh.ts` (payload, encoding, resolves), `src/shaders/svgf-sh.ts` (SVGF
passes in SH mode), `src/shaders/sh-gradient.ts` (anti-lag gradient samples), `src/svgf.ts` (`payload`,
`resolve`, options), `src/sh.ts` (`ShResolver`), `packages/denoiser-three/src/temporal/realtime.ts`
(`realtimeDiffuse` SH mode). Deviations from the spec are in the rows and in TASKS (spec-author items)._

| item | SPEC | source | our deviation | 2nd review | code |
|---|---|---|---|---|---|
| L1 payload, Y with 4 coefficients, Co / Cg as L0, through the existing filters | M7-1 | SD24 p.30, ACS25 s.57–59 (description only; SD24's printed code has no license and is not used); ID25 s.20 ("each pixel an irradiance probe") | world-space storage, evaluation-ready `a + b·ω` form; `'sh-rgb'` option (12 ch): **our design**. Built | | `src/shaders/sh.ts` `SH_CORE_WGSL` (struct `SH`, YCoCg, `shLum`); `'sh-rgb'` not built |
| SH vs SG as the payload (SG only at resolve time) | M7-1 | linearity argument: **our design**; SG tail vs L1 negativity: MJP-SG3 "Error analysis" | — | | SH payload; SG only in `shResolveSpecular` |
| per-sample encoding `a = L/(1+2c)`, `b = 2Lω/(1+2c)`, exact at the sampling normal | M7-2 | clamped-cosine L1 band factors ¼ and ½ (RH01) | the renormalization and the resulting estimator: **our design, tune on captures** (vs the textbook projection with a cos floor). Built; the textbook variant (`shEncoding: 'textbook'`) lost 7.7 dB on the dev page | | `src/shaders/sh.ts` `shEncodeWgsl` |
| 8 × f16 in one rgba32uint; no 8-bit histories; 64-bit packing only for input / à-trous (tune) | M7-3 | 64-bit 6 × 8-bit + f16 magnitude packing: SD24 p.30, ACS25 s.57; quantized-vs-reference check: ML25 p.34 | **our design**. Built (f16 everywhere; 64-bit packing not built) | | `src/shaders/sh.ts` `shPack`/`shUnpack`, `src/svgf.ts` `configure` |
| input forms (encoded / raw + direction), `detailNormal` guide, CAPTURE-FORMAT v1 buffers | M7-4 | evaluate with the full-resolution normal: ACS25 s.59 | **our design**. Built (raw form encodes in the temporal and gradient passes; `detailNormal` falls back to `guides.normal`) | | `src/shaders/svgf-sh.ts` `shLoaderWgsl`; core `FrameGuides.detailNormal`, `DiffuseInputs`/`SpecularInputs` `.direction`/`.sh` |
| guide luminance = Rec. 709 luminance of the payload at the filter's normal | M7-5 | S1 (luminance-driven weights and moments) | **our design** (keeps every tuned SVGF constant valid). Built; specular evaluates at the guide normal's dominant direction (M7-10) | | `src/shaders/sh.ts` `shLum`, `src/shaders/svgf-sh.ts` `shDirWgsl` |
| all coefficients filtered with the same weights; variance on l only | M7-6/7 | S1, S3 (unchanged passes) | **our design**. Built | | `src/shaders/svgf-sh.ts` `temporalPassSh`, `variancePassSh`, `atrousPassSh`; `src/shaders/sh-gradient.ts` |
| value-preserving ringing guard on b (k = 1); chroma stored as a ratio to Y at the guide normal | M7-8 | chroma rescaled by the evaluated luma: SD24 p.37 (description) | the guard and the reference value Y_g: **our design, tune k on captures**. Built (k = 1 inert on the dev page; 0.5: −0.4 dB) | | `src/shaders/sh.ts` `shOutputPayload` |
| diffuse resolve; optional sharpening via ambient + one extracted light, renormalized at the guide normal | M7-9 | light direction / intensity from the L1 luma: SD24 p.37 (description); clamped-cosine L1: RH01 | the decomposition and the renormalization: **our design, tune s**. Built | | `src/shaders/sh.ts` `shResolveDiffuse`, `src/sh.ts` `ShResolver`, fused in `atrousPassSh` |
| specular ratio resolve: NDF as an SG (sharpness 2/α²) warped to the reflection direction (÷ 4\|n·v\|), SG inner product with the extracted SG light; ratio clamp; roughness fade | M7-10 | MJP-SG4 (after WANG09); rough-specular-only SH use: SD24 p.55, ACS25 s.65; "specular-compatible SG resolve": nrd-releases v4.1.0 (behaviour only) | the ratio form (payload sets only the detail/guide ratio), λ_l = 8, ρ_max = 4, fade below r = 0.2: **our design, tune on captures**. Built, plus an `'l1'` ratio (the payload at the two dominant directions, our design). Both lose to no ratio on the dev page (results/M7.md) | | `src/shaders/sh.ts` `shResolveSpecular`, `shSpecResponse`, `shSgInner` |
| resolve helpers, API (`payload`, `resolve`, `sh` / `direction` inputs) | M7-11/12 | — | **our design**; no NVIDIA names (rule 6). Built | | `src/svgf.ts`, `src/denoisers.ts`, `src/sh.ts`, `SH_RESOLVE_WGSL`, three.js `realtimeDiffuse` |
| recurrent SH needs (buffers, luminance-ratio clamps) | §8.5.6 | L1 YCoCg through a recurrent-blur denoiser ships in SD24 / ACS25 | **our design** (not specified in detail) | | — |
| evaluation: `bumpy` / coloured-bounce scenes, two references, detail band, ringing fraction; native after colour extraction | M7-13 | native colour-extraction comparison: nrd-provenance §3.4; PLAN §6 | **our design**. Spec only | | — |

### M8 translucent shadows — **built, provisional** (SPEC v0.3 §7.10; results/M8.md)

_Added 2026-10-25 by the spec author; marked built 2026-10-25 by the M8 implementer (rule 8: no NRD code,
README, release notes or port read; not the public researcher). Sources: TR19 slides 47–53 (primary,
`shadows-specular/tombraider2019.txt`), RTG1-25 §25.2.1 pp. 444–445 (primary, `rtg1.txt`), both re-read
directly by the implementer. Code: `packages/denoiser-realtime/src/shadow.ts` (option `translucency`,
wide / packed paths), `src/shaders/shadow.ts` (`tr` variants of `shadowTemporalWgsl`,
`shadowSpatialWgsl`, `shadowTilesWgsl`; `shadowStabilizeTrWgsl`)._

| item | SPEC | source | our deviation | 2nd review | code |
|---|---|---|---|---|---|
| renderer contract: keep tracing through translucent layers, accumulate per-layer transmittance, stop on opaque / miss / full absorption | M8-1 | RTG1-25 §25.2.1 pp. 444–445 (thin film, albedo absorption, TIR-corrected Schlick); TR19 slides 47–51 (any-hit, order non-deterministic, layer cap 3) | **multiplicative** RGB transmittance (commutes like TR19's subtraction, exact for any colours), colour-aware early out `max T < 0.01` → opaque, nearest-translucent distance by `min`: **our design**. Contract only (the test bed implements it) | | `ShadowInputs.translucency`, `translucencyHitDistance` (denoiser-core) |
| denoise opaque v as today and τ = E[T \| v = 1]; output v̂·τ̂ | M8-2 | identity E[vT] = P(v=1)·E[T\|v=1]; conditional accumulation like g over occluded samples (SPEC §7.2 v0.1) | **our design** (no public source says how coloured shadows are filtered: shadows-specular.md G5). Built: v bit-identical to v2.2 with T ≡ 1 (results/M8.md §1) | | temporal `tr` block |
| one footprint; translucent samples feed g from the nearest translucent hit; nearest blocker wins | M8-3 | M12 ("sharpest occluder wins", via SPEC §7.3 `mergeMin`); RTG1-25 (translucent shadows through the opaque filter) | ε_τ = 0.01 (measured flat 0.002–0.05); built as specified, plus the H18 noise estimate E taken on v·mean(T) so coloured edges without h_τ get the noise-sized radius: **our design** | | temporal (gS from `trHitTex`, `sE`) |
| τ temporal: reprojection, per-channel 5×5 clamp over lit taps (window 0.4σ + 0.05), restart gain 64, cap N_τ = 7 | M8-4 | SPEC SH-4 / v2.1 clamp (ours, measured for v) | built as specified, plus **uniform snap** for τ (all lit taps agree → τ_c = their value; v's SH-4 snap) and update forms exact for a uniform history (f16 stores truncate on the M5 Pro and drifted τ below 1): **our design**. N_τ 3 / 7 / 15 and window 0.2–0.8σ / 0.02–0.1 measured (results/M8.md §3) | | temporal `tr` block |
| τ tile bits; τ-only tiles in the indirect list | M8-5 | TR19 slide 72, H18 §4.1 (tile skip) | bits: lit sample attenuated / clear / τ differs from raw T; per-tile mode (activeTile bit 2); two indirect lists (v-only tiles run the opaque spatial passes unchanged, τ tiles the colour variants): **our design** | | `shadowTilesWgsl(true)` |
| visibility-weighted spatial τ (ratio of filtered v·τ to filtered v) | M8-6 | ratio-estimator reasoning: H18 (SPEC §7.9) | built as specified (fused multiply-adds so v's sum compiles as before: bit identity): **our design** | | `shadowSpatialWgsl(..., tr)` |
| stabilization of (S rgb, v) with v's blend weight, per-channel 3×3 clamp | M8-7 | RTG2 §49.5.7 prose (via the v2.2 rows above) | **deviation**: S's weight = max(v's, S's own box-width gate, S's own clamp-distance anti-lag) (`translucencyOwnGate`, measured +0.18 dB on glass-moving); tau-only tiles pass v through; v-only tiles S = v̂·τ: **our design** | | `shadowStabilizeTrWgsl` |
| API: `ShadowInputs.translucency?`, `translucencyHitDistance?`, `translucency: true`, rgba16float output | M8-8 | interface shape of native's translucency variant (separate translucency input, one combined output): nrd-provenance §3.3–3.4 (names only) | **our design**; no NVIDIA names. `realtimeShadows({ translucency })` in denoiser/three (`.visibility` = alpha) | | shadow.ts, denoiser-three realtime.ts |
| fifth storage texture or packed rgba32uint history | M8-9 | WebGPU limits (`maxStorageTexturesPerShaderStage`) | **deviation**: the wide path needs 6 (v's f32 copies stay as in v2.2 for bit identity, plus the f16 output written for unfiltered tiles); packed path at 4 (v and τ histories as 8 f16 in rgba32uint, 16-load Catmull-Rom, the output doubles as v's copy and stabilization history): **our design** | | `translucencyPath` |
| evaluation: `glass` / `glass-moving` / `glass-still`, `shadow_rgb_ref`, tint-region chroma error, opaque regression | M8-10 | dynamic region / boil: SPEC §13, results/M4.md §12 | **our design**. Native `SIGMA_SHADOW_TRANSLUCENCY` not run yet (probe P7) | | results/M8.md |

### Target 1 recovery candidates (T1) — **options, default off** (results/T1-recovery.md)

_Added 2026-10-26 by the target-1 implementer (rule 8: no NRD code, README, release notes, port or the quarantined
review read; `sources/nrd-review-targets.md` and its clean review read). Primary sources re-read directly: SVGF
§4.1–4.4 (`svgf/svgf.txt`), RTG II ch. 49 §49.5.3–49.5.4 prose (`shadows-specular/ch49_prose.txt`, no listings),
`sources/nrd-public-2022-2026.md` (ML25 p.36, ACS25 s.122, LU22 p.181 notes), `sources/nrd-releases.md` only at the
"what" level relayed by the orchestrator (mips no longer used). Code: `src/recurrent.ts` / `src/shaders/recurrent.ts`
(`historyFix`, `historyFixRadius`), `src/svgf.ts` / `src/shaders/svgf.ts` (`spatialHistoryWeight`,
`youngLuminanceWeight`, `youngNormalPower`). Every default path generates byte-identical WGSL._

| item | SPEC | source | our deviation | 2nd review | code |
|---|---|---|---|---|---|
| recurrent `historyFix: 'spatial'`: young pixels (A < A_fix) rebuilt from this frame's full-resolution accumulated signal, no mip pyramid | §5.8 (D7) alternative | SVGF §4.2 (spatial estimate for < 4 frames after a disocclusion) and §4.3 (edge-avoiding spatial filter guided by depth / normals); RTG2 §49.5.4 prose (discarded history leaves a 1-rpp signal that needs a wide spatial reconstruction for 1–3 frames, depth-guided weights to avoid bleeding); leads only: ACS25 s.122 (extra Poisson pass on disoccluded pixels), the release audit's "mips dropped" (a "what", no how) | **our design**: own value + 16-tap Vogel disk (golden angle) rotated by the blur's animated Bayer angle; weights = smooth `Wt` of the plane distance at the A = 0 geometry tolerance × `Wt` of the normal angle (cos 0.9 scale); radius r0 · 2^(3(s − 1)) px, s = (1 − A/A_fix)·ρ (ρ = roughness for specular, as D7's level choice), r0 = `historyFixRadius` 8 (4–24 measured); no repair under 1.5 px or < 0.5 tap weight; the mips pass and the depth atlas are skipped | | `spatialRepairWgsl`, `historyFixPass(kinds, 'spatial')` |
| SVGF `spatialHistoryWeight`: young-history spatial estimate weights each neighbour by min(n_q, cap) | §4.3 (S-2) variant | SVGF §4.2 (7×7 bilateral spatial estimate); inverse-variance weighting of n-sample means (textbook) | **our design**; measured null (±0.02 dB) | | `variancePass(kinds, { historyWeight })` |
| SVGF `youngLuminanceWeight`: luminance edge-stop of young pixels scaled by mix(k, 1, t) | §4.4 (S-3) variant | lead: ML25 p.36 (fresh pixels: constant temporal variance assumption, more spatial samples, faded over 4 frames) | **our design**; measured a loss (specular −0.6 dB post-cut) and no visual change | | `atrousPass(..., { youngLum })` |
| SVGF `youngNormalPower`: normal edge-stop exponent of young pixels exp2(mix(log2 s, log2 σ_n, t)), t over `varianceRampFrames` | §4.4 (S-3) variant | SVGF §4.4 (σ_n = 128, power form); lead: ML25 p.36 (more spatial support for fresh pixels, faded out) | **our design**: diffuse (power form) only; the specular lobe cutoff is untouched | | `weightsWgsl(kind, i, youngRelax)` |
| evaluation: ground-truth pixel age (frames of valid history) per pixel, scores per age bucket / per frame after a reset, mid-band error, edge band | SPEC §13 | test bed `metrics.ts` AGE_WGSL (same age definition, on the CPU); compare.mjs boil | **our tool**: `results/data/t1-*.mjs` | | results/data/ |
| evaluation: disocclusion detectors vs exact ground truth (results/UPSCALER-GUIDES.md); **nothing adopted into the package** | — | `@pmndrs/upscaler` 0.2.0 (fsr3 57eac72, **MIT**, © Dennis Smolek; its reconstruct pass is derived from AMD FidelityFX FSR2 `ffx_fsr2_depth_clip.h`, MIT): `src/shaders/reconstruct.ts`, `src/internal/ConstantsBuffer.ts`, `ComputePass.ts`, imported by path from its own repo (RULES §2) and run unmodified, only in the harness; three-mesh-bvh (MIT) for the real-scene GT | **our tool**: GT by re-tracing the analytic scene at t−1 / BVH ray casts from the previous eye; interior / band / wrong-surface classes | | results/data/upscaler-guides/ |

### Reflection-motion tests and candidates (review target 2) — **options, default off** (results/REFLECTION-MOTION.md)

_Added 2026-10-26 by the reflection-motion implementer / evaluator (rule 8: no NRD code, README, release notes, port
or quarantined file read; the audit handoff read only in its reviewed copies `sources/audit-public-research-prompt.md`
and `sources/audit-current-state.md`, with `reviews/codex-audit-2026-10-26-review.md`). Primary sources read directly:
Eto, Meunier, Harada, Boissé 2023 §2.4.1–2.4.3 (`public-2022-2026/amd-glossy-reflections-sa2023.txt`), Stachowiak 2015
speaker notes (`shadows-specular/sssr.txt`, "Temporal reprojection" / "Proper reflection parallax" and the neighbourhood
clamping notes), the FidelityFX 1.x reflections denoiser in our MIT port (`packages/denoiser-ffx/src/shaders/reflections.ts`,
`getHitPositionReprojection` / `pickReprojection`). Mara et al. 2017 not re-read (the clean review checked its stage 5 / 8
content); nothing here depends on it. Every default path generates byte-identical WGSL (all SVGF passes, 1 / 2 signals)
and a byte-identical `std540-orbit` replay._

| item | SPEC | source | our deviation | 2nd review | code |
|---|---|---|---|---|---|
| test bed reflect build: plane / convex / concave reflectors (analytic quad, sphere, spherical cap), normal-mapped ripples, emissive markers, reflector and marker poses with previous poses | §13 (evaluation) | textbook ray / quadric intersection | **our tool** | | `examples/realtime-denoiser/src/scene.ts` (`REFLECT_HELPERS_WGSL`, `REFLECT_TRACE_WGSL`), `src/paths-reflect.ts` |
| CPU oracle of a marker's mirror image (plane: mirror point; sphere: in-plane root finding of the reflection condition, i.e. Alhazen's problem on a circle), independent pinhole camera | §13 | textbook geometric optics (law of reflection; the reflection point lies in the plane of the centre, eye and object) | **our tool**; float64 JS sharing no code with the tracer or any denoiser | | `src/reflect-oracle.ts` |
| ROI metrics: image position error, signed lag, trail length, ghost energy outside the reference blob, duplicate blobs, recovery after stop, ghost decay after the image leaves; renderer checks against the oracle | §13 | TAA survey's artefact vocabulary (target 2's cited source) for what to look for; metric definitions ours | **our tool** | | `src/reflect-eval.ts`, `rm-table.mjs`, `rm-crops.mjs` |
| SVGF `reflectionHitTest`: drop specular history taps whose stored hit distance (this frame's 3×3 mean of `inputs.hitDistance`, misses = far) differs from this frame's by more than (0.1 + 0.4 r) of the larger + max(this frame's 3×3 hit-distance spread, ½ the tap's stored spread) | §4.2 (S-1) variant | SVGF §4.1 (history rejected by per-tap consistency tests of the surface: depth, normals, mesh ids), applied to the reflected surface the pixel sees | **our design**. Tolerance measured in three steps: without a spread term held mirrors lost 2.5–3.4 dB (per-frame 3×3 means jitter at reflected edges and over grazing floors); with this frame's spread alone the test bed's `light` path lost 0.5–0.7 dB in the mirror bin (static glossy pixels whose 9 samples happened to cluster); with the full stored spread the object-motion gain halved (trail pixels at the object's old edge kept their history); ½ of it keeps both. Hit distance and spread stored in the moments' `.b` / `.a` (rg32float → rgba32float for that signal, +8 B/px) | | `src/shaders/svgf.ts` `perSignalVirt`, `virtualUvWgsl`; `src/svgf.ts` |
| SVGF `reflectionReprojection: 'virtual'`: history fetched at the reflected image's previous position X + v̂·h̄·F_dom/(1 + 2κh̄), h̄ = 3×3 mean hit distance, κ from the 4 axis neighbours' normals, previous uv by inverting `prevProjInv` at the point's depth; surface history where that footprint fails the plane / hit-distance tests or 1 + 2κh̄ < 0.05 | §4.2 variant | Stachowiak 2015 notes ("reproject using the average depth of the reflected objects"); FidelityFX 1.x `getHitPositionReprojection` (MIT; view ray extended by the hit distance); SPEC R-9 for κ and F_dom (rows above) | **our design** for the combination; no virtual candidate past a concave focus (oracle: the R-9 estimate is 6–14 px off there) | | `src/shaders/svgf.ts` `VIRTUAL_WGSL`, `virtualUvWgsl` |
| SVGF `reflectionReprojection: 'dual'`: both candidates, weight 1/(1 + d²) each, d = (luma(history) − μ)/(σ + 0.05μ), μ, σ of this frame's 3×3 input luminance; faded out between r 0.1 and 0.2 | §4.2 variant | Eto et al. 2023 §2.4.2 (dual-source temporal accumulation after Stachowiak 2018: two reprojection points, surfaces and hit positions, blended by a brightness distance to the current colour) | **our design** for the weights and the roughness fade (without it: r ≥ 0.2 glossy −2…−8 dB and the r 0.9 floor −0.8 dB pooled); no clamp (the paper also clamps to the current neighbourhood: not built) | | `src/shaders/svgf.ts` `perSignalVirt` |
| SVGF `historyFallback` (`'3x3'` default / `'off'` / `'strict'`): what happens when no tap of the 2×2 footprint passes the consistency tests | §4.1 (S-1) variant | SVGF §4.1 p. 4 ("If no taps remain consistent, we try a larger 3 × 3 filter to help find thin geometry such as foliage"); A-SVGF reference code (BSD-3, `TemporalAccumulation.frag`) has the 2×2 test only, no fallback | **our measurement** (results/T6-boundaries.md §3): `'off'` = A-SVGF code's behaviour; `'strict'` (our design) also restarts when < ½ of the bilinear weight is valid | option, default `'3x3'` (generator WGSL identical, replays byte-identical); fails rule 9 on the real scenes (results/T6-boundaries.md §4) | `src/shaders/svgf.ts` `temporalPass` (`TemporalVariant.fallback`), `src/svgf.ts` |
| `normalTest: 'relative'` (SVGF, recurrent, shadows): the per-tap normal threshold relaxed to min(threshold, lowest normal cosine between the pixel and its 3×3 same-surface neighbours − 0.02); same surface = screen-space depth continuity (2 % z + 2 × the robust slope); computed only where a tap failed the full threshold (equal to testing with it everywhere) | §4.1 (S-1) / C-7 variant | SVGF §4.1 (per-tap normal consistency test, "empirical similarity metrics"); A-SVGF code's cos 0.95 | **our design**, from our measurement: on Bistro 13 % of horizontally adjacent same-surface texel pairs differ by > 18° (Sponza 4 %, test bed 0.5 %), so a fixed threshold rejects the surface's own resampling | option, default `'center'`; SVGF: fails rule 9 on Bistro / Sponza (AO −1.0 dB, §5); recurrent / shadows with cos 0.95: passes (§6) | `src/shaders/common.ts` `REL_NORMAL_WGSL`; `svgf.ts`, `recurrent.ts` (`reprojectRWgsl`), `shadow.ts` (`relNormalTolS`) |
| recurrent / shadows `normalThreshold` (per-tap normal test in the reprojection, default 0 = backface only) | C-7 variant | SVGF §4.1 (normal consistency per tap) | our parameterization (compiled-in constant) | option, default 0 | `src/shaders/recurrent.ts` `reprojectRWgsl`, `src/shaders/shadow.ts` `reprojFast` |
| recurrent `virtualHitTest`: a virtual-footprint tap is dropped when its stored fast ĥ differs from this frame's pre-blurred ĥ by more than a·(virtual ĥ tolerance) + b·(3×3 ĥ spread), a = 2, b = 1 (`tune.virtHitTestA/B`) | §5.6 R-10 variant | SVGF §4.1 consistency tests applied to the reflected surface (as the SVGF `reflectionHitTest` row) | **our design** (tolerance from this frame's spread, since the recurrent history stores no spread) | option, default false | `src/shaders/recurrent.ts` `virt{i}`, `temporalSpecular` |
| test bed `boundary` regions: receivers within 2 px of a discontinuity of the exact primary G-buffer (sky, depth jump > 2 % z + 2·ring·slope, normal > 37°) | metrics | review target 6 ("add a reference-labelled boundary region") | our definition | additive (new regions; other fields unchanged) | `examples/realtime-denoiser/src/metrics.ts` `BOUNDARY_WGSL`, `BoundaryMask`; `results/data/t6-boundaries/score.mjs` |

### T1b spatial history repair at resets and reveals — **options, default off** (results/T1b-spatial-repair.md)

_Added 2026-10-26 by the recurrent implementer / evaluator (rule 8: no NRD code, README, release notes, port, quarantine
folder or original audit file read; the reviewed audit copy `sources/audit-public-research-prompt.md` priority 4 and
its review read). Primary sources read directly: RTG II ch. 49 §49.5.4 prose (`shadows-specular/ch49_prose.txt`, p.828–829,
no listings), SVGF §4.2 (`svgf/svgf.txt`), Mara, McGuire, Bitterli, Jarosz, "An Efficient Denoising Algorithm for
Global Illumination", HPG 2017 (author PDF, benedikt-bitterli.me/mmbj/mmbj.pdf, §3 stages (5) and (7), p.3, and §5.1).
Code: `src/recurrent.ts` (options), `src/shaders/recurrent.ts` (`spatialRepairWgslX`, `denseRepairWgsl`, `historyFixPass`
with a `SpatialFixConfig`, `blurPass(…, youngTaps)`). Every default path generates byte-identical WGSL (474619c)._

| item | SPEC | source | our deviation | 2nd review | code |
|---|---|---|---|---|---|
| default `historyFix: 'spatial'` | §5.8 v0.6 | decision q19 (a), Dennis 2026-10-26 (rule 9's boil clause amended by q20 (a)); the design is the T1 row above | — | | `resolveRecurrent` (5ad7831) |
| `historyFixDense`: A = 0 pixels average every pixel within r px (r = 4 measured best) from a workgroup-shared tile of depth, normal and the accumulated signal, loaded only by workgroups holding an A = 0 pixel; radius capped by the disk's roughness-scaled radius | §5.8 v0.6 option | RTG II §49.5.4 p.828 prose: where history was discarded "we have only a raw 1 rpp signal … Using a very wide spatial filter is a good option, but it is expensive. Mip levels can be used to emulate a high rpp input"; SVGF §4.2 (for < 4 frames a 7×7 bilateral neighbourhood with depth / normal weights stands in for the missing history) | **our design**: a dense full-resolution neighbourhood instead of mips (no resolution loss, plane-distance × normal weights as the T1 disk), shared memory instead of scattered taps (measured: 48 dense taps 2.4 ms vs 128 scattered taps 11.9 ms on a 1080p reset frame), per-workgroup gate with `workgroupUniformLoad`, roughness cap r0·2^(3(ρ−1)) | | `denseRepairWgsl`, `historyFixPass` (gate), `xRepair` |
| `historyFixWideRing` / `historyFixWideRings` / `historyFixWideUse`: extra 16-tap rings where the first ring's taps are ≥ `historyFixYoungThreshold` (0.9) A = 0 | option | Mara et al. 2017 §3 stage (5)/(7), p.3: the final sparse bilateral filter's radius is r = (1 − min over a 2R×2R box of the temporal confidence c) × R, and they "expand the radius … where temporal confidence c is low" (×6 where c < 1/2) | **our design**: the young fraction of the first ring's geometry weight as the neighbourhood confidence; rings at (1 + k(f − 1)) × the radius, turned by half the golden angle; measured: density beats radius (results §1) | | `spatialRepairWgslX` |
| `historyFixAgeWeight`: taps × (1 + k·min(A_tap, A_fast)) | option | inverse-variance weighting (a running mean of n frames has variance ∝ 1/n), as SVGF `spatialHistoryWeight` above | **our design**; min(·, A_fast) because the history fix rewrites A in place only above A_fast (race-free read) | | `spatialRepairWgslX` |
| `historyFixMips` 'young' / 'reset' / 'hit' / 'clamp' (+ `historyFixMipsClamp`): the D7 mip repair as a fallback inside the spatial fix | option (diagnostic) | RTG II §49.5.4 (mips, 3×3 viewZ-weighted upsampling = D7 row); 'clamp': variance clipping SAL16 (mip value clamped to the taps' mean ± k standard errors) | **our design**; all rejected by measurement (results §3) | | `xRepair`, `xRepairOcc{i}` |
| `youngBlurTaps`: 8 more blur taps (the R-3 disk turned by π/8) on A = 0 pixels | option | RTG II §49.5.5 prose (8-tap Poisson disk, rotated) = R-3 row | **our design**; partial gain, not pursued | | `blurPass(…, youngTaps)` |
| evaluation: static-camera reveal paths `rv-narrow` / `rv-medium` / `rv-wide` and fixed revealed pixel sets followed over time | SPEC §13 | audit priority 4 (reviewed copy): "Score the same newly revealed surfaces over time, not just unrelated pixels grouped by history age" | **our tool**: reveal = the view depth grows by > 5 %, cover = it shrinks by > 5 %; boundary, mid-band, bias, FLIP, boil per set | | `examples/realtime-denoiser/src/paths.ts` (rv-*), `results/data/t1b-reveal.mjs` |

### Light-change tests and anti-lag options (review target 3) — **options, default off** (results/T3-light-changes.md); `antiLagChroma` is the default since 2026-10-27 (Dennis q26 (a), bfd20b2; `antiLag: 'auto'` v2, radiance payload)

_t3 agent (implementer / evaluator, RULES §8: no NRD code, README, release notes, port or quarantined file read).
Sources read directly: Schied, Peters, Dachsbacher 2018 (A-SVGF, `svgf/asvgf.pdf` / `.txt`: §3.1 Eq. 2 and the
"only the luminance" sentence p.24:6, §3.5 Eq. 13–15 p.24:8, the 3×3 max p.24:9, §5.4 limitations); the reviewed
source note `sources/nrd-public-2022-2026.md` for ML25 p.34–35, PH23 and GI22; `@pmndrs/upscaler` (MIT, © 2026 Dennis
Smolek; /Users/dex/Developer/fsr3 at 57eac72, read-only): `src/shaders/shadingChange.ts`, PARITY.md §3, CLAUDE.md.
Every default path generates byte-identical WGSL (062361a)._

| item | SPEC | source | our deviation | 2nd review | code |
|---|---|---|---|---|---|
| `antiLagChroma`: per-stratum YCoCg chroma change (δCo, δCg of the current mean vs the reprojected accumulated history) and the standard deviation of the current means, filtered with the luminance weights through the same reconstruction, λ = max(luminance term, max over Co, Cg of max(0, \|δ̂_c\| − kσ̂_c) / Δ̂) | §4.6 option | S2 §3.1 restricts the temporal gradient to luminance "thus saving resources"; S2 §3.4–3.5 reconstruction and λ (as the 'auto' rows above); public parallel: ML25 p.34–35 computes its history confidence over all YCoCg channels (via the source note); YCoCg: Malvar & Sullivan 2003 | **our design**: chroma normalized by the luminance Δ̂, the v2 composite-kernel noise floor for both chroma channels, rg32uint storage (σ, not var) | | `src/shaders/gradient.ts` (`GradientVariant.chroma`, `COCG_WGSL`, `PACK_C_WGSL`), `src/svgf.ts` |
| `antiLagGain`: λ = min(1, g · ratio), per signal | §4.6 option | S2 Eq. 14–15 (g = 1) | **our design** (a scale on the ratio; baked into the λ pass per signal, not structural) | | `src/shaders/gradient.ts` `gradientLambdaPassV2`, `src/svgf.ts` |
| evaluation: fixed-camera light-change paths (`lc-step`, `lc-hue`, `lc-fade`, `lc-jump`, `lc-emitter`), onset / held / return windows, old-appearance fraction r = Σ(o − n)(b − n)/Σ(b − n)², frames to r < 0.1, ramp lag, static-region boil with a bit-identical-reference mask | SPEC §13 | review target 3 (sources/nrd-review-targets.md: "identical event times … separately report onset, held illumination and return") | **our tool** | | `examples/realtime-denoiser/src/paths-light.ts`, `results/data/t3-score.mjs` |
| evaluation: CPU port of the upscaler's `shadingChange` response (block-mean luma ratio at 4×4 / 8×8, contrast-gated floors) to measure it as an anti-lag input | — | `@pmndrs/upscaler` `src/shaders/shadingChange.ts` (MIT, from its own upstream) | identity reprojection (fixed camera, no jitter); measurement only, nothing of it in the package | | `results/data/t3-shading-change.mjs` |

### Normal-mapped detail (review target 5) — **options, default off** (results/T5-normal-detail.md)

| item | SPEC | source | our deviation | 2nd review | code |
|---|---|---|---|---|---|
| `shDetailNormalPower` (SH payload): extra spatial weight max(0, n_d·n_d')^p on the detail normals in the variance and à-trous passes, on top of the smooth-normal weights; the detail normal rides octahedral 8:8 in the unused upper half of each f16 ping-pong texel | §8.5.3 M7-6 option | the normal edge-stop form max(0, n·n')^σ: S1 eq. 4 (SVGF §4.3); per-pixel 2-band SH "irradiance probes" filtered by a bilateral weighted by normal / depth / hit distance: ID25 s.21–22 (which normal it uses is not stated) | **our design**: the weight on the **detail** normal inside the smooth-normal SH filter, and its packing (octahedral encoding: Cigolle et al. 2014, JCGT 3(2), as a general technique), so a payload is averaged mostly with payloads sampled around similar hemispheres (M7-6 kept one weight for all coefficients; this keeps that, it only adds a factor) | | `src/shaders/svgf-sh.ts` `ShVariant.detail`, `detailW`; `src/svgf.ts` |
| `shDetailNormalStride`: the detail weight only in à-trous iterations with stride ≥ k | §8.5.3 option | — | **our design** (measured worse on still views; kept as a documented dead end) | | `src/shaders/svgf-sh.ts` `detailW` |
| `youngNormalPower` honoured by the SH à-trous | §4.4 / §8.5.3 | T1's option (results/T1-recovery.md, our design) | the SH à-trous reads the centre's history length from the accumulated payload (`c.z`) instead of the plain accum's alpha | | `src/shaders/svgf-sh.ts` `ShVariant.youngN` |
| evaluation: `detail` scene build (held-out detail-normal patterns, a smooth control, an emitter seen only by secondary rays), detail-band **gain** k = Σ b_o b_r / Σ b_r² and residual noise, bump / flat regions, motion-compensated boil with the reference floor, 4096-spp references | SPEC §13, M7-13 | review target 5 (sources/nrd-review-targets.md: "slow camera motion and a moving broad light … a smooth-surface control and held-out normal maps … detail-band contrast toward the reference"); band definition M7-13 | the regression gain (noise-free contrast measure) and the scene variants: **our design** | | `examples/realtime-denoiser/src/scene.ts` (`detail` build), `src/paths-detail.ts`, `results/data/t5-normal-detail/score.mjs` |

### SVGF cost (svgf-cost implementer, 2026-10-27) — **adopted, byte-identical output** (results/SVGF-COST.md)

| item | SPEC | source | our deviation | 2nd review | code |
|---|---|---|---|---|---|
| à-trous workgroup-shared tile at strides 1, 2, 4: each 8×8 workgroup loads its (8 + 2·stride)² tap texels once (f32 depth, decoded normal, roughness byte decoded at use, colours as 2 × `pack2x16float`) | §4.4 S-3 (pass structure unchanged) | standard GPU practice (shared-memory tiling of a stencil); same idea as the recurrent 10×10 tiles above | **our code**: contiguous tiles per stride, not an interleaved mapping (measured slower); same arithmetic per pixel, outputs byte-identical on 11 captures; −0.23 ms joint | | `src/shaders/svgf.ts` `atrousPass` (`tile`), `src/svgf.ts` `ATROUS_TILE_MAX_STRIDE` |
| variance pass: 14×14 tile for the young-history spatial estimate, loaded only when the workgroup's largest radius (workgroup max + `workgroupUniformLoad`) is > 0 | §4.3 S-2 | standard GPU practice; gate as T1b's `historyFixDense` row | **our code**; byte-identical; −0.035 ms | | `src/shaders/svgf.ts` `variancePass` (`tile`) |
| joint à-trous: one depth weight per tap shared by both signals when their `sigmaDepth` agree | §4.4 S-3 | — (common-subexpression by construction) | **our code**; byte-identical; −0.03 ms | | `atrousPass` (`sharedDepth`), `weightsWgsl` (`wGeoZ`) |
| young-pixel à-trous variant compiled only where it can act (specular only with `specularNormalWeight: 'power'`; luminance factor only with `youngLuminanceWeight ≠ 1`); per-8×8-tile young flags from the variance pass let settled tiles skip the history-length load | §4.4 v0.5 (`youngNormalPower`) | T1's option (our design, rows above) | **our code**; byte-identical; −0.18 and −0.03 ms | | `atrousPass` (`youngLum` / `youngNormal` / `youngTile`), `variancePass` (`youngFlag`) |
| `outputAliasing` (option, default false): the last à-trous iteration's ping-pong target is the output | §10.2, §12 item 4 (c) | SPEC §10.2's proposal (our design); the recurrent filter's rotating output | none: as proposed; byte-identical, −8 B/px per signal | | `src/svgf.ts` `configure` |

### SVGF follow-ups (SVGF implementer, 2026-10-27) — options, default off (results/SVGF-FOLLOWUPS.md); `normalTest: 'soft'` is the default since 2026-10-27 (Dennis q31 (a), bfd20b2)

| item | SPEC | source | our deviation | 2nd review | code |
|---|---|---|---|---|---|
| `normalTest: 'soft'` + `normalSoftThreshold` / `normalSoftHistory`: where the full normal test resets the pixel (no 2×2 tap and no 3×3 fallback texel passes), the 2×2 footprint is retried at a looser cosine and its passing taps give a history capped at 1 + (frames − 1)·s, s = their bilinear-weighted normal agreement ramp between the two thresholds; frames per signal (1 = today's reset) | §3.2 / §4.2 option | SVGF §4.1 (S1: per-tap normal / depth consistency, renormalized bilinear weights); A-SVGF's history length n as the blend weight 1/n (S2 / its code, as the temporal rows above) | **our design**: a graded history *length* from normal agreement instead of a binary reset, applied only where the binary test resets, per-signal cap | | `src/shaders/svgf.ts` `TemporalVariant.soft`, `temporalPass`; `src/svgf.ts` |
| `historyNormal: 'geometric'`: the history's geometry test (normal agreement, backface, plane distance) on the renderer's geometric normal (`guides.geometricNormal`, octahedral 16+16 bits, ping-pong), the edge stops on `guides.normal` | §3.2 option | SVGF §4.1 tests; octahedral encoding Cigolle et al. 2014 (JCGT 3(2)); the smooth / detail normal split of the SH payload (M7-4, CAPTURE-FORMAT `normal_geom`) | **our design** (which normal feeds the history test) | | `src/shaders/svgf.ts` `GEO_NORMAL_*`, `geoNormalPackPass`; `src/svgf.ts` `gn` |
| `antiLagHistoryScale`: after the anti-lag boost the history length becomes max(1, (1 − λ)·n) instead of n = 1/α | §4.6 option | S2 Eq. 14–15 (α boost by λ); A-SVGF code sets n from α (rows above) | **our design** (keeps the boost, drops its persistence) | | `src/shaders/svgf.ts` `TemporalVariant.lamScale` |
| evaluation: static-pixel spill by distance to the nearest changing receiver, split by the pixel's own λ and by stratum purity; a debug replay entry reading n / λ / the unfiltered accumulation | SPEC §13 | T3's strict static mask (results/T3-light-changes.md) | **our tools** | | `results/data/svgf-followups/tools/` |

## Open provenance items

- Verify the K14m constants against the original Unreal Engine blog post (the fetch was
  refused); CAPTURE-FORMAT records the same constants.
- Hardie & Barner 1994 (RCRS) not read; our anti-firefly is our own until someone reads it.
- Salvi GDC 2016 is in the local sources folder (`svgf/salvi.txt`) but was not re-read for
  this skeleton; variance clipping is cited as the general technique.
