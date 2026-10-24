# Prior work: the SVGF in the SSGI experiment (`ssgiDev`)

_Reviewed 2026-10-24 for M1. Repo: `DennisSmolek/ssgiDev` (local
`/Users/dex/Developer/ssgiDev`, HEAD `99e2f9b`)._

## What exists

| piece | where | size |
|---|---|---|
| SVGF lab (5 arms: bilateral, svgf-lite, svgf, two incumbents) | `bench/src/demos/14-svgf/` | `index.ts` ~1050 lines + 6 WGSL files, ~450 lines |
| FSR3 + SVGF pipeline (streamlined, "v1 candidate") | `bench/src/demos/21-fsr-svgf/index.ts` | ~460 lines; imports demo 14's WGSL unchanged |
| Temporal guides (dilated velocity, graded disocclusion, history length N, reactive mask) | `bench/src/harness/temporal-guides.ts` + 3 WGSL | ~270 lines, 3 dispatches |
| Spatial variance fallback | `MomentsPass` from `@pmndrs/upscaler` (4×4 block moments) | Dennis's MIT library |
| Design spec | `SVGF-SPEC.md` | |
| Measurements | `bench/results/lab14-svgf.md`, `lab14-cost.md`; `WORKLOG.md` 2026-07-22…24 | |

The chain: demodulate (÷ albedo) → temporal accumulation + luminance moments → variance
(temporal, ramped toward a spatial estimate while N is small) → à-trous ×K (default 4)
→ remodulate. It is raw WGSL compute through a `RawComputePass`, the same style as
`packages/denoiser-ffx`, so it ports without a TSL rewrite.

## Provenance: clean

- The shader headers cite the SVGF paper (§4.2) and the bench's own `SVGF-SPEC.md`
  only. There's no mention of NRD, ReLAX, Falcor or Web-RTRT anywhere in the code
  (searched the repo, excluding `node_modules`/`dist`/`vendor`).
- The temporal guides and `MomentsPass` come from Dennis's FSR3-style upscaler work
  (`@pmndrs/upscaler`, derived from AMD FidelityFX, MIT).
- **Two things to keep in mind,** both in `ssgiDev`'s research notes, not its code:
  - `research/sources/temporal/11-denoising-direction.md` calls NRD "open-source (MIT)"
    and recommends it as "the best reference for a better SVGF". That's wrong: NRD is
    under the proprietary NVIDIA RTX SDKs license. Worth correcting there so no future
    agent in that repo acts on it.
  - The same notes list `C-none/Web-RTRT` (WebGPU ReSTIR → SVGF + RELAX → FSR2) as the
    "single best code analog". Its RELAX implementation is almost certainly derived
    from NRD, so it falls under RULES.md rule 1 (ports of NRD). Don't consult its
    denoiser code for this project.
- Verdict: usable as our M1 starting point. Record it in PROVENANCE.md as "prior work by
  Dennis, written from Schied et al. 2017".

## Compared with the SVGF paper ([svgf-relax.md](svgf-relax.md))

| stage | ssgiDev | paper | for M1 |
|---|---|---|---|
| Demodulation | ÷ max(albedo, ε), remodulate after | same | keep |
| History read | nearest texel at the reprojected position (`floor`) | 2×2 bilinear with per-tap depth/normal consistency, 3×3 fallback | **upgrade**: bilinear with per-tap validity (sharper, less edge ghosting) |
| History validity | shared graded disocclusion from the guides pass, threshold | per-tap geometric tests | keep the guides idea, but test per tap |
| Accumulation | α = max(α_min, 1/N) | α = 0.2 after start-up; A-SVGF code uses max(α, 1/(n+1)) | keep |
| Extra | 25 % blend toward a 4-neighbour min/max clamp | not in SVGF | keep as an option; measure |
| Moments | E[l], E[l²] in **rgba16float** | — | **change to rg32float**: l² overflows fp16 on HDR input |
| Variance fallback | ramp to 4×4 block moments over N ∈ [0, nMin] | 7×7 bilateral spatial estimate while history < 4 | keep the smooth ramp; compare against the paper's bilateral estimate |
| À-trous kernel | 5×5 B3-spline, stride doubling, ×K | same | keep |
| Depth weight | relative depth difference, `|Δz| / (z·σ_z)` | gradient-scaled, `|Δz| / (σ_z·|∇z·Δp|)`, σ_z = 1 | **upgrade**: the paper's form handles slanted surfaces; needs a depth-slope input (no derivatives in compute) |
| Normal weight | max(0, n·n')^σ_n | same, σ_n = 128 | keep; check default |
| Luminance weight | √ of 3×3 **box**-prefiltered variance | 3×3 **Gaussian** prefilter | trivial switch |
| Variance propagation | Σw²·Var / (Σw)² | same | keep |
| Feedback | option: feed iteration-0 output back as history | paper does this | keep, default on per paper |
| A-SVGF | not built (planned as "C1" in EXPERIMENTS.md) | — | add in M1 |
| Signals | diffuse SSGI + AO only | any | specular is new work |

## What it measured (on its own SSGI signal)

From `WORKLOG.md` 2026-07-23/24 and `bench/results/lab14-*.md`:

- **Stability:** svgf at K = 4 was the most stable arm in every cell, 7–88× better
  frame-to-frame than the incumbent temporal + bilateral stack.
- **Accuracy:** all five arms tied on MSE against the bench's own (biased) oracle. The
  SSGI signal is low-noise, so it couldn't separate them. An unbiased path-traced
  reference (`15-ptref`) was specified but never built. Our M0 test bed has exactly
  that.
- **Cost:** K = 4 cost 2.4–2.8× the plain bilateral; K = 2 met the bench's 2× budget but
  lost the stability win.
- **Caveat:** those stability runs were recorded with a camera-jitter bug, found and
  fixed on 2026-07-24. The ranking likely stands, since all arms shared the bug.
- `svgf-noiseinject.wgsl` (adding controlled noise to a converged image, so ground truth
  is exact) is a cheap validation trick worth reusing in M0.

## Plan for M1

1. Port the five passes into the new package as the SVGF baseline, behind
   `TemporalDenoiser<DiffuseInputs>` (then `SpecularInputs`).
2. Replace the bench-only dependencies: the guides pass becomes part of our shared
   temporal core (we get depth, normal and motion as inputs; disocclusion and N are
   computed inside), and the spatial-variance fallback no longer needs `MomentsPass`.
3. Apply the upgrades marked above: bilinear history with per-tap validity, rg32float
   moments, gradient-scaled depth weight, Gaussian variance prefilter.
4. Add A-SVGF (gradient-driven α).
5. Measure on the M0 test bed against references and native RELAX, keeping the old
   ssgiDev version as a comparison arm for the first runs.
