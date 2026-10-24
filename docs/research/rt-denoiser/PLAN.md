# Plan: our own NRD-class real-time denoiser (clean room) — DRAFT for review

_2026-10-24. Branch `feat/rt-denoiser-cleanroom`. Rules: [RULES.md](RULES.md). Research:
[sources/](sources/). Native comparison: [NATIVE-HARNESS.md](NATIVE-HARNESS.md),
[CAPTURE-FORMAT.md](CAPTURE-FORMAT.md)._

## 1. Goal

A hand-tuned (non-neural, no weights) real-time denoiser suite in WGSL that covers what
NVIDIA's NRD covers, for 1-path-per-pixel path tracing in the browser:

- **diffuse and specular lighting** (the ReBLUR / ReLAX job);
- **shadows** (the SIGMA job), beyond the FFX shadow denoiser we already ship;
- **ambient and specular occlusion**, nearly free on top of the radiance filter.

It plugs into the existing `TemporalDenoiser` API (`packages/denoiser-core/src/temporal.ts`,
which already has the `DiffuseInputs` / `SpecularInputs` / `ShadowInputs` slots) and ships
as a subpath of `denoiser`, next to `denoiser/ffx`. Priority order, as with
`@pmndrs/upscaler`: **performance > quality > fidelity to NRD**.

**Later phases (in scope, after the core ships):** SH/SG (directional) variants and
translucent shadows, as milestones M7 and M8.

**Non-goals for now:** checkerboard rendering, strand and material-ID special cases,
ReSTIR-specific tuning.

**Working name:** `denoiser/rt` (package `@pmndrs/denoiser-rt`). Rule 6: no NVIDIA names
in our API. Name TBD by you.

## 2. Process

1. **Research** (done, first pass): four reports in [sources/](sources/).
2. **Spec**: `SPEC.md`, our own algorithm written from the sources, with a decision for
   every item the sources leave open (ReBLUR has 16 such items, ReLAX more). Reviewed
   by you before code.
3. **Provenance**: `PROVENANCE.md`, a table mapping every pass and constant to its public
   source (paper/page/slide) or to "our design, tuned on captures".
4. **Implement** pass by pass behind the eval harness; every change is measured.
5. **Compare** against native NRD on the Windows RTX machine, on the same captures and
   the same GPU (our WGSL runs in Chrome there too).

Roles and who may see what: [RULES.md](RULES.md) rule 8. The provenance auditor and the
Windows harness builder never write our passes.

## 3. What the research says (one paragraph each)

- **ReBLUR** ([sources/reblur.md](sources/reblur.md)). *Ray Tracing Gems II* ch. 49
  documents a 7-pass pipeline (pre-blur, temporal accumulation, mip generation, history
  fix, blur, post-blur, temporal stabilization) with most of the math and a per-pass cost
  table: 2.72 ms for diffuse+specular at 1440p on an RTX 3090. The recurrent loop (blurred
  output becomes history), linear accumulation with blur radius shrinking as 1/(1+A),
  plane-distance disocclusion, specular surface-vs-virtual-motion reprojection and mip-based
  history repair are all described. 16 details aren't (radii, Poisson pattern, weight
  parameters, anti-lag thresholds, anti-firefly).
- **SVGF family** ([sources/svgf-relax.md](sources/svgf-relax.md)). SVGF and A-SVGF are
  fully published, and the A-SVGF authors' own code is BSD-3, which fills in the constants
  the papers omit. ReLAX itself is thinly documented: an SVGF descendant that clamps to a
  fast history, 1.8 ms at 1080p on an RTX 3090. The report proposes our own fast-history
  clamp from published pieces (Salvi's variance clipping, TRMV, BMFR).
- **NRD provenance** ([sources/nrd-provenance.md](sources/nrd-provenance.md)). NRD's
  build dependencies (ShaderMake, MathLib, NRI) are MIT; NRD-Sample has no license. NRD's
  code cites public sources we can use directly: bounded VNDF sampling (Eto & Tokuyoshi),
  *Ray Tracing Gems* ch. 32, octahedral normal encoding, the Spherical Gaussian series
  (Pettineo). Native NRD builds on Windows/Linux only, from source.
- **Shadows / specular / signal prep** ([sources/shadows-specular.md](sources/shadows-specular.md)).
  The penumbra footprint has a published formula: Mehta 2012 gives the filter width from
  light size and distances, which with hit distance h becomes R·h/(D−h), or h·tanθ for
  a directional light. Heitz 2018 sizes the filter without hit distance and adds a ratio
  estimator. Boksansky (*Ray Tracing Gems* ch. 13) prints every parameter of a practical
  version. Specular has four reprojection approaches on record, a fully specified
  à-trous filter in *Ray Tracing Gems* ch. 32, and lobe-shaped world-space kernels
  (ReBLUR). Demodulation is albedo for diffuse and the split-sum term (Karis, with
  Frostbite's f90 variant) for specular, remodulated after the temporal filter.
  Normalized hit distance doubles as AO/SO. Not public anywhere: the anisotropic
  penumbra kernel, a fix for overlapping penumbrae, the hit-distance normalization
  curve, ReBLUR's confidence/parallax constants, and multi-light schemes.

## 4. Architecture

### 4.1 Shape

```
inputs (ours, per CAPTURE-FORMAT): demodulated diffuse/specular radiance + hitT,
  normal, roughness, viewZ/depth, motion, albedo, f0
        │
  front end ─ hit-distance normalization, firefly clamp, packing
        │
  temporal core ─ reprojection (surface; virtual for specular), disocclusion,
                  history length A, history repair, anti-lag
        │
  spatial filters ─ per signal
        │
  stabilization ─ variance clipping against a short history
        │
  remodulation (optional; callers may want the demodulated result)
```

### 4.2 Two filter families: SVGF built first, recurrent blur expected to ship as default

1. **Built first (M1): SVGF + A-SVGF**, fully specified by the papers and BSD reference
   code. About 7 dispatches per signal (14 with A-SVGF). It's the cheapest way to prove
   the test bed, captures, metrics and native harness end to end with a denoiser whose
   correct behavior is known. It stays as a second option (the natural fit for
   ReSTIR-style input later) and as the yardstick M2 must beat.
   **Head start:** Dennis's SVGF from the SSGI experiment (`ssgiDev` demos 14 and 21),
   reviewed in [sources/ssgi-svgf-review.md](sources/ssgi-svgf-review.md): written from
   the SVGF paper, provenance clean, five passes that port directly, with a short list of
   upgrades (bilinear history with per-tap validity, rg32float moments, gradient-scaled
   depth weight).
2. **Built second (M2–M3), expected default: recurrent blur (the RTG II design)** for
   diffuse + specular in shared dispatches. NVIDIA's own numbers say it's the cheaper and
   more stable of the two, and the chapter documents it well. Our decisions for its 16
   open items go in SPEC.md. If it doesn't beat SVGF on our captures, SVGF ships instead.

### 4.3 Shared temporal core

- Reprojection from our NDC motion plus viewZ; plane-distance disocclusion test on the
  previous frame's footprint; Catmull-Rom history read when the 4×4 footprint is valid,
  bilinear with rejected texels zeroed otherwise.
- Per-pixel history length A (capped 32–64), accumulation weight 1/(1+A).
- History repair from a low mip of the accumulated signal where history was just lost.
- Anti-lag: our design (A-SVGF's gradient idea or a luminance-delta test on the fast
  history); the chapter only names it.
- `resetHistory()` and per-frame `reset` flags from captures.

### 4.4 Specular

Surface-motion and virtual-motion (hit-distance) history candidates blended smoothly by
roughness and confidence (the chapter's design; our FFX port makes a hard pick). Kernels
on a plane facing the specular dominant direction, sized by the lobe half-angle and hit
distance; *Ray Tracing Gems* ch. 32's fully specified à-trous weights as the
fallback. Hit distance is itself denoised before it drives radius and confidence.
Curvature (thin-lens) correction is a later refinement. Input is demodulated by the
split-sum term, which also removes the −0.04 dark bias our FFX port shows from its
luminance-weighted averaging. FFX reflections stays as the comparison baseline.

### 4.5 Shadows

Per light: filter radius from occluder distance and light size (Mehta 2012's footprint,
rewritten for hit distance), with Heitz 2018's noise-based sizing as the fallback when
there's no hit distance. Fractional visibility is kept (FFX thresholds it to binary).
Temporal history uses a variance-clamped history that does **not** feed the spatial blur
back (FFX's feedback compounds blur, measured as ~1 dB drift). Needs one API addition:
light parameters (type, size or angular size) in `ShadowInputs`. The anisotropic
penumbra kernel and overlapping penumbrae are our design. The renderer contract is
documented too: unjittered ray origins (Tomb Raider talk) and blue-noise sampling
animated per frame. FFX shadows is the baseline.

### 4.6 WebGPU constraints (from the reports)

- Core WebGPU only allows `read_write` storage on r32 formats, so histories are ping-pong
  textures (rgba16float read through `texture_2d`, written as write-only storage).
- Default limit of 4 storage textures per stage: the single-pass mip build needs ~9, so
  pack signals, split the dispatch, or request the adapter's higher limit (often 8).
- SVGF moments need rg32float (fp16 overflows on HDR luminance squared).
- No derivatives in compute: depth slope comes from the G-buffer or a prepass.
- No atomics or subgroups required; subgroups optional for the reductions.
- Memory estimate: ~80–90 B/pixel internal state for diffuse+specular (~180 MB at
  1080p), plus inputs. The budget is part of SPEC.md.

## 5. Test bed and evaluation (our side)

Extend `examples/ffx-denoiser` (the analytic WGSL tracer that already renders 1-spp
signals, per-frame many-spp references, scripted camera paths with a cut, and computes
PSNR/flicker/bias headlessly) rather than start over:

- add signals: 1-bounce diffuse GI with hit distance, specular with hit distance on a
  roughness range, shadows with occluder distance, albedo/f0 for demodulation;
- add stress paths: fast pan (disocclusion), lighting change (anti-lag), thin geometry,
  glossy floor, camera cut;
- add metrics: FLIP, temporal PSNR, per-region (penumbra, disoccluded) breakdowns,
  GPU ms per pass;
- add the **capture exporter** writing [CAPTURE-FORMAT.md](CAPTURE-FORMAT.md) v0, and a
  replay mode so our denoisers run from captures exactly like the native harness does.

Later: real scenes from `examples/three-temporal` and three-gpu-pathtracer output.

## 6. Native comparison

On your Windows RTX machine, per [NATIVE-HARNESS.md](NATIVE-HARNESS.md): native NRD at
pinned commit `e06852b`, driven headlessly through its public API, replaying our captures.
Pairs compared:

| ours | native |
|---|---|
| SVGF baseline (diffuse, specular) | `RELAX_DIFFUSE_SPECULAR` |
| recurrent diffuse+specular | `REBLUR_DIFFUSE_SPECULAR` |
| shadows | `SIGMA_SHADOW` |
| occlusion | `REBLUR_DIFFUSE_SPECULAR_OCCLUSION` |
| (sanity) | `REFERENCE` accumulation vs our references |

Both run on the same GPU, so the timings compare directly. Only metrics, timings and small
crops come back into the repo.

## 7. Milestones (each ends with numbers in a results table)

| | work | exit criteria |
|---|---|---|
| **M0** | SPEC.md v0, PROVENANCE.md skeleton; test bed signals + stress paths; capture exporter + replay; Windows harness phases 1–3 (in parallel, on your machine) | a capture round-trips: our replay and native REFERENCE both read it correctly |
| **M1** | SVGF + A-SVGF baseline for diffuse and specular, ported from `ssgiDev` demo 14 with the review's upgrades | metrics vs references and vs native RELAX on the same captures |
| **M2** | recurrent diffuse (pre-blur → stabilization, history repair, anti-lag) | beats M1 on quality or cost; within agreed distance of native REBLUR diffuse. **Go/no-go:** if the gap to native isn't closing with tuning, stop and reassess before M3 |
| **M3** | recurrent specular (virtual motion, lobe kernels) | vs FFX reflections and native REBLUR specular |
| **M4** | shadows (penumbra-aware) | vs FFX shadows and native SIGMA |
| **M5** | occlusion (AO/SO) variants | vs native occlusion variant |
| **M6** | `denoiser/rt` entry, TSL nodes in `denoiser/three`, docs page, example | shipped behind "experimental" |
| **M7** | SH/SG directional variants (diffuse, then specular): directional payload through the same filters, plus the resolve step for the caller | vs native `*_SH` variants after their color extraction |
| **M8** | translucent shadows (absorption through transparent hits, order-independent layers per the Tomb Raider talk) | vs native `SIGMA_SHADOW_TRANSLUCENCY` |

## 8. Targets (proposed — please set them)

- **Quality:** on our captures, within ~0.5 dB PSNR and ≤ native flicker of the matching
  native denoiser, with no new artifact classes (ghosting, smearing) in the stress paths.
- **Cost:** ≤ 2× native NRD on the same Windows GPU for the same work. On the M5 Pro at
  1080p, diffuse+specular ≤ 4 ms, shadows ≤ 0.6 ms.
- **Memory:** ≤ 100 B/pixel internal state for diffuse+specular.

## 9. Risks

- **Ambiguities become tuning work.** The 16 open ReBLUR items are where most of the time
  goes. Native comparison on identical captures is how we tune them without looking at
  NRD.
- **Convention mismatches** in the native harness (motion sign/units, roughness
  definition, hit-distance normalization) can make native look wrong. Phase 3's REFERENCE
  sanity check catches the gross ones.
- **WebGPU limits** (storage-texture count, formats) may force extra passes and cost.
- **Comparison fairness:** NRD's defaults are tuned for game content; our analytic scenes
  are simpler. Add at least one real scene before drawing conclusions.
- **Contamination:** any agent added later must get RULES.md and a role.

## 10. Decisions for you

Decided (2026-10-24): SVGF baseline first, recurrent filter second and expected default;
SH/SG directional variants and translucent shadows are in, as later phases (M7, M8);
the SSGI experiment's SVGF (`ssgiDev` demo 14/21) is reviewed, clean, and M1's
starting point.

Still open:

1. Package/working name (`denoiser/rt`?) and public class names.
2. The targets in §8.
3. Results coming back from Windows: a separate branch touching only
   `docs/research/rt-denoiser/native/` (proposed in NATIVE-HARNESS.md)?
