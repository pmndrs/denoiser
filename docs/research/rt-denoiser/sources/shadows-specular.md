# Shadows, specular and signal preparation: public-source research notes

Scope: what an NRD-class real-time denoiser needs for (A) 1-spp ray-traced shadows,
(B) specular / reflections and (C) signal preparation (demodulation, hit-distance
handling, firefly suppression, AO/SO), written only from public sources, and how that
compares with what our FidelityFX 1.x port (`packages/denoiser-ffx`, see
`docs/specs/temporal.md`) already does.

Clean-room status of this note (2026-10-24):

- No NRD or NRD-Sample source, shader, fork or port was opened, fetched or searched.
- NRD README **prose** was read once through a fetch tool that was told to return prose
  only and to leave out code blocks and helper names (allowed by RULES.md §2 at the time).
  RULES.md was tightened afterwards to put the README off limits, so every passage drawn
  from it was **removed** from this note before it was committed (2026-10-24). The author
  of this note has read the README prose and is recorded in RULES.md rule 8.
- Ray Tracing Gems II ch. 49 (ReBLUR, by NVIDIA) is a published book chapter and allowed.
  Its prose and equations were read with the numbered code listings **filtered out** on
  purpose, because those listings may mirror NRD code. Function signatures from a few
  listings leaked through the filter; nothing from them is used here. Implementers should
  also skip the listings.
- The GTC 2019/2020 NVIDIA talk slides are public talks (allowed). Two slides show small
  pseudo-code functions. Where a formula below comes from such a slide, it says so, so
  the project lead can decide whether to use the formula or only the prose properties
  around it.
- Patents were not opened. One web-search result summary paraphrased an NVIDIA patent
  about shadow hit-distance handling. That idea is **deliberately not used** (see Gaps,
  item G2).
- Equation notation below is our own. Citations give source key + page/section/slide.

---

## Sources

| Key | Title | Authors | Year | URL | License / access | Topic |
|---|---|---|---|---|---|---|
| RTG1-13 | Ray Traced Shadows: Maintaining Real-Time Frame Rates (Ray Tracing Gems ch. 13, pp. 159–182) | J. Boksansky, M. Wimmer, J. Bittner | 2019 | https://link.springer.com/content/pdf/10.1007/978-1-4842-4427-2.pdf | Open access, CC BY-NC-ND 4.0 | A |
| RTG1-19 | Cinematic Rendering in UE4 with Real-Time Ray Tracing and Denoising (RTG ch. 19, pp. 289–319) | E. Liu, I. Llamas, J. Cañada, P. Kelly | 2019 | same book | CC BY-NC-ND 4.0 | A, B, C |
| RTG1-25 | Hybrid Rendering for Real-Time Ray Tracing (RTG ch. 25, pp. 437–473; SEED / PICA PICA) | C. Barré-Brisebois et al. (EA SEED) | 2019 | same book | CC BY-NC-ND 4.0 | A, B, C |
| RTG1-32 | Accurate Real-Time Specular Reflections with Radiance Caching (RTG ch. 32, pp. 571–607) | A. Hirvonen, A. Seppälä, M. Aizenshtein, N. Smal | 2019 | same book | CC BY-NC-ND 4.0 | B, C |
| RTG2-24 | Using Blue Noise for Ray Traced Soft Shadows (RTG II ch. 24, pp. 367–394) | A. Wolfe | 2021 | https://link.springer.com/content/pdf/10.1007/978-1-4842-7185-8.pdf | CC BY-NC-ND 4.0 | A |
| RTG2-46 | Ray Tracing in Control (RTG II ch. 46, pp. 739–762) | J. Sjöholm, P. Jukarainen (NVIDIA), T. Aalto (Remedy) | 2021 | same book | CC BY-NC-ND 4.0 | A, B, C |
| RTG2-49 | ReBLUR: A Hierarchical Recurrent Denoiser (RTG II ch. 49, pp. 823–844) | D. Zhdan (NVIDIA) | 2021 | same book | CC BY-NC-ND 4.0; **listings skipped** | B, C |
| H18 | Combining Analytic Direct Illumination and Stochastic Shadows (I3D 2018) | E. Heitz, S. Hill, M. McGuire | 2018 | https://research.nvidia.com/sites/default/files/pubs/2018-05_Combining-Analytic-Direct/I3D2018_combining.pdf | Author copy on NVIDIA Research | A, C |
| M12 | Axis-Aligned Filtering for Interactive Sampled Soft Shadows (ACM TOG 31(6) 163) | S. U. Mehta, B. Wang, R. Ramamoorthi | 2012 | https://visualcomp.ucsd.edu/classes/cse274/fa21/papers/a163-mehta.pdf | Author copy (course mirror); paper says source is published | A |
| TR19 | "Shadows" of the Tomb Raider: Ray Tracing Deep Dive (GTC 2019 s9984) | H. Gruen, J. Story (NVIDIA), M. Roza (Nixxes) | 2019 | https://developer.download.nvidia.com/video/gputechconf/gtc/2019/presentation/s9984-shadows-of-the-tomb-raider-ray-tracing-deep-dive.pdf | Public talk slides | A |
| Z20 | Fast Denoising with Self-Stabilizing Recurrent Blurs (GTC 2020 s22699) | D. Zhdan (NVIDIA) | 2020 | https://developer.download.nvidia.com/video/gputechconf/gtc/2020/presentations/s22699-fast-denoising-with-self-stabilizing-recurrent-blurs.pdf | Public talk slides | B, C |
| S15 | Stochastic Screen-Space Reflections (SIGGRAPH 2015 Advances) | T. Stachowiak, Y. Uludag (EA) | 2015 | http://advances.realtimerendering.com/s2015/Stochastic%20Screen-Space%20Reflections.pptx | Public talk slides + speaker notes | B, C |
| K13 | Real Shading in Unreal Engine 4 (SIGGRAPH 2013 course notes) | B. Karis | 2013 | https://cdn2.unrealengine.com/Resources/files/2013SiggraphPresentationsNotes-26915738.pdf | Public course notes | C |
| K14 | High-Quality Temporal Supersampling (SIGGRAPH 2014 Advances) | B. Karis | 2014 | http://advances.realtimerendering.com/s2014/epic/TemporalAA.pptx | Public talk slides | C |
| L14 | Moving Frostbite to Physically Based Rendering 3.0 (course notes v3.2) | S. Lagarde, C. de Rousiers | 2014 | https://seblagarde.files.wordpress.com/2015/07/course_notes_moving_frostbite_to_pbr_v32.pdf | Public course notes | B, C |
| Z15 | Path-space Motion Estimation and Decomposition for Robust Animation Filtering (EGSR 2015) | H. Zimmer, F. Rousselle, W. Jakob, O. Wang, D. Adler, W. Jarosz, O. Sorkine-Hornung, A. Sorkine-Hornung | 2015 | https://rgl.s3.eu-central-1.amazonaws.com/media/papers/Zimmer2015Path.pdf | Author copy | B, C |
| T13 | Specular Lobe Aware Upsampling Based on Spherical Gaussians (SIGGRAPH 2013 poster) | Y. Tokuyoshi | 2013 | https://history.siggraph.org/wp-content/uploads/2023/01/2013-Poster-95-Tokuyoshi_Specular-Lobe-Aware-Upsampling-Based-on-Spherical-Gaussians.pdf | Public poster | B |
| T15 | Specular Lobe-Aware Filtering and Upsampling for Interactive Indirect Illumination (CGF 34(6)) | Y. Tokuyoshi | 2015 | https://diglib.eg.org/handle/10.1111/cgf12525 | Paywalled; **not read** (only the 2013 poster) | B |
| FFX | FidelityFX Denoiser docs (shadows + reflections) | AMD | 2023–24 | https://gpuopen.com/manuals/fidelityfx_sdk/fidelityfx_sdk-page_techniques_denoiser/ | Public docs; code MIT (already ported) | A, B |
| MX19 | Exploring the Ray Traced Future in Metro Exodus (GTC 2019 s9985) | O. Shyshkovtsov et al. | 2019 | https://developer.download.nvidia.com/video/gputechconf/gtc/2019/presentation/s9985-exploring-ray-traced-future-in-metro-exodus.pdf | Public talk slides; skimmed only (GI/AO, little on shadows) | C |

Cited but not read here (pointers only): Liu, "Low Sample Count Ray Tracing with
NVIDIA's Ray Tracing Denoisers", SIGGRAPH 2018 course (the source of RTG1-19's kernel
figures; no public copy found). Yan et al. 2015 "Fast 4D sheared filtering". Salvi 2016
"An excursion in temporal supersampling" (variance clipping). Schied et al. 2017 SVGF
(covered in `svgf-relax.md`). Hardie & Barner 1994 "Rank conditioned rank selection
filters" (the anti-firefly filter RTG2-49 names).

Sibling notes: `reblur.md` covers the ReBLUR pipeline in depth (including virtual motion
and parallax, RTG2-49 §49.8). This note only repeats what the specular reprojection and
hit-distance topics need.

---

## A. Shadow denoising from 1-spp ray-traced visibility

### A1. Separate visibility from shading first

Every source denoises a **visibility** signal, not a shaded image, so texture and
normal-map detail never goes through the blur.

- **Point/centroid split** (RTG1-13 §13.3, Eq. 5, p.163). Shade an area light as if all
  of it sat at its centroid C. Multiply by the mean of the ray-traced visibility samples,
  stored in one visibility buffer per light. In our notation:
  `L_d ≈ f(ω_C) L(C) G(P, C) · (1/|S|) Σ_X v(P, X)`.
- **Split-sum shadow** (RTG1-19 §19.3.1.1, Eq. 1, p.302): `L ≈ ∫V dω · ∫L f cosθ dω`.
  The unshadowed term comes from LTC area lighting and is noise-free. Only `∫V` is ray
  traced and denoised. The paper calls the bias negligible on diffuse surfaces and points
  to H18 for glossy ones.
- **Ratio estimator** (H18 §3.3–3.5). Write shadowed direct light as `U · W`, where
  `U = ∫ f L` (unshadowed, analytic) and `W = ∫ f L V / ∫ f L` (illumination-weighted
  shadow, in [0,1]). With N light/BRDF samples:
  `S_N = Σ f L V / p` and `U_N = Σ f L / p` (same samples). The result is
  `U · denoise(S_N) / denoise(U_N)` (Eq. 25).
  Key rules:
  - **Denoise the numerator and denominator separately, then divide** (§3.5). Denoising
    the ratio `S_N/U_N` is biased (Eq. 26). Dividing after denoising is consistent
    (Eq. 27). It also avoids 0/0 = NaN where `U_N = 0` (Eq. 28).
  - A grayscale `W` is an acceptable memory saving (§3.4, Fig. 4).
  - `U` may be an approximate real-time term, such as a prefiltered environment map
    (K13). `W` then just modulates it (Eq. 18–19, §3.4).
  - Only shadows get over-blurred. Highlight noise that appears in both `S_N` and `U_N`
    cancels (§4.2, Fig. 9).

### A2. Penumbra-size estimation (filter footprint)

**Geometry (published derivation).** M12 derives a screen-space Gaussian filter width
from a frequency analysis of sampled soft shadows. In M12's notation, `d1` is the
distance from the light to the receiver and `d2` the distance from the light to the
occluder (§3, Eq. 4, p.163:3). The light is a Gaussian with standard deviation `σ`
metres (§4.1). The spatial filter standard deviation is (Eq. 13, p.163:4):

```
β(x) = (1/k) · (1/μ) · max( σ · (d1 / d2_max − 1),  1 / Ω_x^max )
```

- `d2_max` is the occluder **closest to the receiver** (the sharpest penumbra wins).
- The second term is the pixel-footprint floor, so the filter never shrinks below about
  one pixel.
- Published constants (§6): `k = 3`, `μ = 2`, `α = 1`.
- `d1, d2` come from a sparse pre-pass of 9 stratified rays per pixel. The paper notes
  those estimates are noisy and filters them (§6, p.163:6–7).

Rewritten with what a 1-spp renderer has (our derivation, not in M12):

- `h` = receiver→blocker hit distance and `D` = receiver→light distance give
  `d1/d2 − 1 = h / (D − h)`.
- World-space penumbra scale for a sphere light of radius `R`: `R · h / (D − h)`.
- Directional light with angular radius `θ_L` (D → ∞): `h · tan θ_L`.

Divide either by the world-space size of a pixel at the receiver to get pixels. This is
the PCSS relationship. RTG2-24 §24.7.1 (Fig. 24-10, p.380) states the same dependence in
words: penumbra size depends on light size and distance and on occluder size and
distance. It adds that grazing light angles make penumbrae longer (p.389).

**Shipped hit-distance-driven filters.**

- **Control** (Remedy/NVIDIA, RTG2-46 §46.6.2, pp.757–761; Fig. 46-17):
  - The shadow ray generator writes `hitT` along with visibility. Ray directions are
    offset by a concentric-disk sample scaled by the light radius.
  - The spatial filter projects the light radius onto the receiver using `hitT` and the
    light/surface positions. It uses that projected radius to set a Gaussian σ over
    **world-space** sample distance.
  - Taps: 8-pixel radius in 2-pixel steps, separable (one pass per axis). A tap counts
    only if it comes from **the same light** and passes a depth test.
  - The temporal filter runs first. The filter is based on the GameWorks spatial shadow
    filter (Story & Liu) and on M12.
- **UE4 / GameWorks** (RTG1-19 §19.3.1.2, pp.303–305):
  - The denoiser knows the light's size, shape, direction and distance, plus the shadow
    hit distances. It derives a per-pixel **anisotropic** footprint that stretches along
    the penumbra direction. This is inspired by M12 and sheared filtering.
  - The filter runs per light (cost is linear in light count), because a shared filter
    looked worse.
  - The spatial part was enough for moderate lights. Very large lights also needed the
    temporal part, which raised effective spp to about 8–16, with Salvi-style clamping
    against lag.
- **TR19** (slides 64–73) is the GameWorks spatial denoiser as shipped:
  - Inputs: light description parameters, visibility, `hitT`, normals and depth.
  - Slides compare isotropic and anisotropic kernels and show two problems: "overlapping
    penumbra" (slides 67–68) and depth-boundary bleeding fixed by "customized boundary
    detection" (slides 69–70). The slides are images; the fixes are not described in
    text.
  - A **penumbra mask** restricts work (slide 72). Half-resolution denoising is used for
    all light types. MSAA depth/normal input is supported (slide 73).

**Noise-driven footprint without hit distance** (H18 §4.1–4.2).

- The noise estimate `E[x]` averages, over n = 4 lines through x in an asterisk pattern
  with a random per-pixel offset, the integral of `|d²W_N/dt²|` along each line (Eq. 29).
  It measures total variation, which separates noise from a clean step edge.
- `E` is 3×3 box-filtered.
- The joint-bilateral Gaussian then takes `σ ∝ E`, with plane-distance weights from the
  G-buffer position and normal. It is separable (H then V) and filters `S_N` and `U_N`
  in the same pass. The final step is TAA.
- Result: no filtering, and almost no cost, outside penumbrae. The kernel grows with
  large lights and shrinks where shadows harden.

**Variation-driven footprint** (RTG1-13 §13.4.2–13.4.5, pp.166–171).

- Temporal range `Δv_t = max(v_{t−1..t−4}) − min(v_{t−1..t−4})` over 4 reprojected
  frames (Eq. 8).
- Spatial spread: a 5×5 max filter, then a 13×13 tent (Eq. 9, separable).
- Combination: `½(spatial + ¼ Σ raw Δv of the last 4 frames)` (Eq. 10).
- Bilateral Gaussian kernel size goes linearly from 1×1 to 9×9 with `Δv`, reaching the
  maximum at `η = 0.4`. Precomputed kernels are interpolated so sizes never pop
  (§13.4.5.2).
- The same measure drives adaptive ray counts: +1/−1 per frame with 4-frame hysteresis,
  `s_max` = 5 (standard) or 8 (high). An 8×8-block mask forces at least one ray per
  pixel every 4 frames (§13.4.3–13.4.4).

**Adaptive tracing from hitT** (TR19 slides 41–45). Phase 1 traces one ray per pixel.
Phase 2 traces up to 2 more rays only where the neighbourhood's visibility/hitT shows a
penumbra. The result averages the samples. RTG2-24 §24.7.5 gives the same early-out
idea: trace a few rays and stop if they agree.

### A3. Temporal stabilization of shadows

| Source | Temporal scheme |
|---|---|
| RTG1-13 §13.4.1, §13.4.5.1 | Reverse reprojection with a relative-depth test `|1 − z_t/z_{t−1}| < ε`, `ε = c1 + c2·n_z` (c1 = 0.003, c2 = 0.017; Eq. 7). Box average of 4 frames (Eq. 11). Sample sets interleave across 4 frames. Light motion is ignored; artifacts were judged minor above 30 fps. |
| RTG1-19 §19.3.1.2 | Spatio-temporal, temporal lag reduced by Salvi variance clamping. |
| RTG1-25 §25.2.1, p.443 | SVGF-derived filter on a **single scalar** (cheaper than RGB). The history is clamped to a box sized by Salvi's variance method over a **5×5** footprint (Karis-style clamp). |
| FFX docs (shadows) | Disocclusion: 1 % depth threshold, made adaptive with view/normal angle. Neighbourhood mean ± 0.5 σ clamp, because velocity does not capture moving shadows. Variance boost `max(16 − n, 1)` while fewer than 16 samples are accumulated. EMA blend whose alpha adapts to history confidence. 17×17 local moments (separable). 3 à-trous passes. Optional TAA afterwards. |
| RTG2-46 §46.6.2 | Temporal accumulation first, then the light-aware spatial filter. |
| TR19 slides 55–62 | Jittered TAA moves ray **origins** each frame (depth at pixel centres changes), which causes shadow flicker on large flat ground. Fix: build ray origins from an **unjittered** depth pass. |
| RTG2-24 §24.7.2 | Blue-noise mask animated per frame with the golden-ratio additive sequence. Neither independent blue-noise textures nor scrolling are good over time. |

Moving shadows on static receivers have no motion vectors of their own. Z15 §4.2
(offline) estimates their residual motion with optical flow **in the log domain**, after
compensating for primary motion. Real-time sources clamp history to the current
neighbourhood instead (FFX, RTG1-25).

### A4. Translucent shadows

- **RTG1-25** §25.2.1 (pp.444–445):
  - Keep tracing toward the light through transparent hits. Accumulate absorption from
    each surface's albedo (thin-film approximation; no distance-based absorption) and
    stop on an opaque hit, a miss or full absorption.
  - Fresnel at interfaces uses a total-internal-reflection-corrected Schlick.
  - The result is filtered with the same SVGF-derived shadow filter. Other passes treat
    all surfaces as opaque.
- **TR19** slides 47–53. Up to 3 translucent layers. Any-hit order is not deterministic,
  so each layer **subtracts 1/3** of the visibility, which makes the result
  order-independent. An opaque hit sets visibility to 0.

### A5. What our FFX port covers vs what is missing (shadows)

Covered (FFX shadows, `docs/specs/temporal.md` §Shadows):

- 1-ray binary mask packed into 8×4 tiles.
- Tile skip for uniform tiles (similar to TR19's penumbra mask).
- Moments-based variance with a boost while history is short.
- Neighbourhood clamp.
- 3 à-trous passes with depth/normal edge stopping.
- Temporal accumulation.

Missing for NRD-class shadows:

1. **Penumbra-size-aware footprint.** We take `hitDistance` but ignore it. FFX sizes the
   blur by variance only, so large penumbrae stay under-filtered and contact shadows get
   softened over time (our measured drift: −1 dB on a static camera). Sources: M12 Eq. 13,
   RTG2-46, RTG1-19.
2. **Light description input.** `ShadowInputs` has no light radius / angular radius /
   position. The footprint needs `R` (or `tan θ_L`) and `D`. This is an interface change.
3. **Fractional visibility and translucency.** FFX thresholds visibility at 0.5 (binary).
   RTG1-13, H18 and TR19 all produce fractional values. Translucent shadows are colored.
4. **Anisotropic kernel** along the penumbra direction (RTG1-19, TR19).
5. **Ratio estimator** path (two signals `S_N`, `U_N`, divide after filtering) for glossy
   receivers (H18).
6. **Hit-distance preprocessing**: denoise or spread `h` so lit pixels next to a shadow
   still know a blocker distance (M12 §6 p.163:7: unoccluded pixels take d1, d2 averaged
   over a 5-px radius; see G2).
7. **History design**: FFX feeds filter-pass-0 output back as history (recurrent). Our
   measurements show it compounds blur. Options: accumulate the raw signal (RTG1-13) or
   keep a separate stabilization history (RTG2-49 §49.5.7).
8. **Unjittered ray origins** (TR19). This is a renderer-side requirement to document.
9. **Multi-light**: per-light dispatch vs packing 4 lights in RGBA (RTG1-13 §13.4.5.2
   packs 4 lights per texture and filters 8 at once).

---

## B. Specular / reflection denoising

### B1. Reprojection of reflections

Surface motion vectors move the **reflector**. A reflected object moves with its own
parallax. The sources offer four approaches:

1. **Surface motion only.** Correct for rough and curved surfaces, wrong for smooth flat
   ones (RTG1-25 Fig. 25-16, p.452).
2. **Hit-point ("virtual image") reprojection.** Push the pixel's view ray **through** the
   surface by the reflection hit distance and reproject that virtual point with the
   previous camera.
   - In our notation: `X_virt = X_surf + t̂_view · h`, where `t̂_view` is the unit
     camera→surface direction and `h` the reflection ray length. Then `uv_prev =
     project_prev(X_virt)`.
   - S15 (slide 67 + notes) averages the reflection depth over the local rays.
   - RTG1-25 (p.451) uses the average hit point. It works on floors and fails on curved
     surfaces.
   - Our FFX port already does this (`getHitPositionReprojection`, using the sum of
     surface depth and ray length).
3. **Blend by roughness and confidence.**
   - RTG1-25 (p.452): weight each reprojection candidate by
     `w = 2^(−10 · luma(|c − μ| / σ))` against the current frame's local mean/σ, then
     apply a Karis clamp.
   - RTG2-49 §49.8.2–49.8.3 (pp.835–838):
     - Virtual motion is right only for mirrors. As the lobe widens, the reflection
       "moves" toward the surface, so virtual motion must turn into surface motion as
       roughness → 1 (Fig. 49-7).
     - The virtual point is pulled toward the surface by a factor from the **specular
       dominant direction** (L14 p.69–70).
     - A "virtual motion confidence", the product of several disocclusion-like tests in
       the reflected world, both tightens the history clamp and speeds accumulation.
     - Hit-distance confidence needs denoised hit distances.
     - Curvature can correct the virtual point via the lens equation.
     - Details: `reblur.md` §4.2.
4. **Thin-lens reflection motion** (RTG1-32 §32.4.3, pp.592–598).
   - Treat the reflector point as locally spherical (umbilical). Use the principal
     curvature that gives the image nearest the viewer, working with inverse radius and
     focus to handle planes.
   - Solve the thin-lens equations `1/f = −2/r`, `1/f = 1/z_o + 1/z_i`,
     `x_i/x_o = −z_i/z_o` (Eq. 23) in a local frame `{x, y, n_s}` (Eq. 24–25).
   - Differentiate in time to get the image velocity (Eq. 26–27) and project it (Eq. 28).
   - For glossy temporal filtering, use the length of the most probable ray along the
     primary reflection direction (p.596).
   - RTG1-19 (p.310) uses this method in UE4.

Offline ground truth: **Z15** §4.1. Temporal manifold exploration evolves a specular path
`x_1..x_n` to the next frame with a Newton-like solve on the generalized half-vector
constraints, then projects the difference. Two findings matter for us:

- Glossy surfaces were tracked as if smooth, because the effective motion was
  "almost identical" (§5, Glossy objects). This differs from RTG2-49's
  roughness-to-surface-motion blend.
- Untracked paths and silhouettes are **flagged**, not guessed (Fig. 6, Fig. 8).

**Parallax and accumulation speed.**

- RTG2-49 §49.8.1 (p.833, Fig. 49-5) defines parallax as `tan(acos(v · v_prev))`, the
  angle between current and previous view vectors to the same point. It is 0 for a
  rotating-only camera.
- Accumulation should be **smaller** for low roughness, small N·V (Fresnel does not
  follow surface motion) and high parallax (p.834).
- Z20 slide 58 gives one empirical form (public talk pseudo-code; use with care, see
  provenance note). In our notation:
  `a = (1 − N·V)^p_curve`, `b = 1.001 + α²`, `s = (b + a)/(b − a)`,
  `A_max = A_cap · roughness^(p_base · (1 + parallax · s))`.
  The tunable exponents `p_curve` and `p_base` are not given numerically.
- History mixing uses linear weights: `lerp(history, input, 1/(1 + A))` with
  `A ← min(A + 1, A_cap)` (RTG2-49 Eq. 49.1; Z20 slides 25–26).

### B2. Roughness-driven filter footprint (lobe-based kernels)

- **Screen-space BRDF-lobe projection** (RTG1-19 §19.3.2.2, pp.307–310).
  - Filter only incoming radiance, with the BRDF integral pre-integrated (Eq. 2).
  - The anisotropic kernel comes from projecting the BRDF lobe back to the screen from
    hit distance, roughness and normal. This gives contact hardening and stretching
    along the normal.
  - Usable up to GGX α ≈ 0.25 ("squared roughness"). Above that, biased stochastic
    sampling plus the temporal filter.
  - The kernel shape itself is only shown as figures (from the Liu 2018 course).
- **À-trous with reflection weights** (RTG1-32 §32.4.1, pp.588–591).
  - 5×5 taps per iteration with `h = (1/8, 1/4, 1/2, 1/4, 1/8)` (Eq. 10).
  - The total weight is the product of six terms (Eq. 18), using
    `f_w(a,b,x) = 1 − smoothstep(a,b,x)` (Eq. 11):

    | Weight | Formula (source) | Published parameters |
    |---|---|---|
    | depth | `w_z = exp(−|z_P − z_Q| / (σ_z |∇z_P · (P−Q)| + ε))` (Eq. 12) | σ_z = 1, ε = 1e-4 |
    | normal | `w_n = max(0, n_P·n_Q)^σ_n` (Eq. 13) | σ_n = 32 |
    | roughness similarity | `w_r = f_w(0.01, 0.1, |r_P − r_Q|)` (Eq. 14) | — |
    | roughness radius | `w_d = f_w(10 r_P, 70 r_P, |P−Q|)` (Eq. 15) | — |
    | direction | `w_s = sat((d̂ · r̂_ss) · 0.5 + 0.5)`, where `r̂_ss` is the screen-space reflection direction (Eq. 16) | — |
    | ray length | `w_l = f_w(0, 10 r_P, d)` (Eq. 17) | — |

  - Temporal: `C_i = (1−γ) S_i + γ C_{i−1}` with
    `γ = 0.95 · w_z w_n w_r · smoothstep(0, 0.1, r_P)` (Eq. 19–21). Mirrors take no
    history.
  - Plus colour variance clipping from a 5×5 edge-aware window, because geometry
    weights cannot catch ghosting from moving bright objects (p.592).
  - Note (ours): Eq. 17 as printed depends on the pixel offset `d` and roughness, not on
    the ray length. The text says ray length should scale it. Treat it as underspecified.
- **World-space lobe kernel** (RTG2-49 §49.9–49.10, pp.839–841; Z20 slides 38–48, 60, 62).
  - 8-tap Poisson disk on a plane perpendicular to the **reflected GGX dominant
    direction**, so one model covers diffuse (roughness 1) through mirror (screen-plane)
    blur. The tangent axis is scaled with viewing angle to elongate the kernel.
  - Per-pixel random rotation in the main blur pass (animated 4×4 Bayer).
  - Weight = geometry (distance to plane {X, n}) × normal × roughness × hit distance
    (Eq. 49.2). Each factor has the form `smoothstep(0, 1, sat(1 − |a x + b|))`
    (Eq. 49.3), and the parameters tighten as accumulation grows.
  - Normal cutoff: specular lobe half-angle `θ_½ = 90° · α/(1 + α)` with `α = roughness²`
    (Z20 slides 46–47). It narrows over time.
  - Radius shrinks with hit distance (Z20 slide 60, public-talk pseudo-code):
    `f = h / (h + |X_view|)`, `radius ← radius · lerp(K · roughness, 1, f)` with
    `0 < K < 1`.
  - Radius also shrinks with the number of accumulated frames (Z20 slides 20–23).
  - Kernel anisotropy relaxes toward isotropic when accumulation goes badly (slide 62).
- **Lobe-similarity weight** (T13). Approximate each pixel's specular lobe by a
  spherical Gaussian `G(ω) = e^{λ(μ·ω − 1)}`. The bilateral weight is the inner product
  of the normalized lobes, `w_ij = ⟨G_i/‖G_i‖, G_j/‖G_j‖⟩ ∈ [0,1]` (Eq. 1). It has no
  user parameters and accounts for normal, view and sharpness at once.
  - Closed form (our derivation from standard SG algebra, not in the poster), with
    `r = ‖λ_i μ_i + λ_j μ_j‖`: `w ≈ (2√(λ_i λ_j) / r) · e^{r − λ_i − λ_j}`.
  - S15 notes this weight lacks contact hardening because it ignores hit distance
    (slide notes for slide 69).
  - T15 extends it to filtering; not read.
- **Distance-based roughness** (L14 §4.9.3, p.72).
  - The BRDF footprint grows with distance to the reflected surface.
  - Bounding NDF cone angle as printed: `θ_lim = atan(E α² / (1 − E))`, with E the energy
    fraction kept, e.g. 75 %. Our note: for GGX the exact cone has
    `tan²θ = α² E/(1 − E)`, so the printed form may be missing a square root. Check
    before use.
  - Correction: `α' = (dist to shaded point / dist to probe centre) · α`, clamped to α
    and lerped back to α by α (Listing 25).
- **Stochastic resolve with ray reuse** (S15 slides 45–58 + notes; RTG1-25 pp.449–450).
  - Neighbour hits are reused with weight `w = f_local(hit) / pdf_neighbour(hit)` and
    **normalized**: `L = Σ w L_hit / Σ w`. Without normalization, reuse was worse than no
    reuse (spikes in f/pdf).
  - Then multiply by the pre-integrated BRDF (C1).
  - The importance sampler is truncated toward the mirror direction:
    `u.x ← lerp(u.x, 1, bias)` (slide 68). The normalization cancels the changed pdf
    constant.
  - Filtered importance sampling: the color-pyramid mip comes from a cone footprint fit
    over roughness, hit distance and elongation (slide 69).
  - Bias 0.7 was shipped (slide 72, timings slide).
- **Control** (RTG2-46 §46.6.1, pp.754–756).
  - Shorter rays on rough surfaces. Precomputed GI on misses.
  - World-position-based jitter to break screen-space correlation.
  - Firefly clamp against a lower-mip average luminance.
  - Temporal accumulation with variance clipping, then a separable spatial filter: 2
    iterations per axis for reflections. Weights: depth, normal, smoothness, material ID,
    hit distance and smoothness again.
  - A second temporal accumulation on the last spatial iteration.
  - Fresnel is demodulated and re-applied after the spatial pass.

### B3. Confidence and disocclusion for specular

- **Plane-distance disocclusion** (RTG2-49 §49.6, p.831; Z20 slide 30).
  - Measure the distance between the reprojected point and the plane `{X_prev, n}`.
    Normalize it by the camera distance and reject above about **0.5–1.5 %**.
  - Evaluate per tap of the 2×2 bilinear footprint.
  - Averaged normals in the footprint help at silhouettes.
  - Backfacing taps are rejected.
- **Bilinear with custom weights** (Z20 slides 27–29). Expand bilinear into 4 explicit
  weights, multiply by per-tap validity and renormalize. Binary validity removes ghosting
  at disocclusions.
- **Catmull-Rom history fetch** (RTG2-49 §49.7, p.831). Used only when the whole 4×4
  footprint is valid, otherwise 2×2.
- **Two-candidate confidence.** RTG2-49 keeps both a surface and a virtual history
  candidate. FFX instead picks one, by normal similarity and roughness similarity and a
  local-variance distance test (our port: `pickReprojection`).
- **Geometry-only temporal weight for glossy** (RTG1-32 Eq. 21). Glossy reflections vary
  too much in colour for colour-based rejection alone, so `γ` comes from
  depth/normal/roughness weights. Colour clipping is added only to fight ghosting from
  bright moving content.
- **Mirror special case.** RTG1-32 `w_rmax` sends mirrors (r < 0.1) to near-zero history.
  FFX caps history length by roughness: `max(8, N_max · (1 − e^{−100 r}))`.

### B4. What our FFX port covers vs what is missing (specular)

Covered (FFX reflections):

- Surface vs hit-point reprojection with a binary pick.
- Disocclusion factor from normal/depth.
- Roughness-scaled history length.
- 8×8 luminance-weighted average radiance that suppresses outliers.
- 15-tap Halton prefilter (7×7) weighted by normal, depth, radiance-vs-average and
  variance.
- 9×9 neighbourhood clip in resolve.

Missing for NRD-class specular:

1. **Roughness-/lobe-shaped spatial footprint.** The FFX prefilter footprint is fixed at
   7×7 and roughness only gates it. Sources: RTG1-19, RTG1-32 Eq. 14–17, RTG2-49 §49.9,
   T13.
2. **Hit-distance-scaled radius** (contact hardening): Z20 slide 60, RTG1-32 Eq. 17,
   S15 cone fit.
3. **Smooth surface→virtual blend** driven by roughness/dominant direction, plus a
   confidence term (RTG2-49 §49.8.2). FFX's hard pick flickers between candidates.
4. **Parallax-aware accumulation speed** (RTG2-49 §49.8.1, Z20 slide 58). FFX uses a
   fixed per-roughness cap.
5. **Curved-reflector motion** (RTG1-32 thin lens). None today.
6. **Denoised hit distance** as its own signal (RTG2-49 p.837). FFX uses the raw
   per-pixel ray length.
7. **Demodulated input** (C1). FFX expects plain radiance and is biased dark by
   ≈ 0.04 (tonemapped) by design (luminance-weighted average).
8. **Bias control**: our measured −0.04 bias comes from the average/clip path. ReBLUR
   avoids luminance-weighted averaging in its main path (RTG2-49 §49.5.1:
   redistribute outliers, do not suppress them).

---

## C. Signal preparation

### C1. Material demodulation / remodulation

- **Split-sum term** (K13 pp.5–6, Eq. 7–8).

  ```
  (1/N) Σ L f cos / p ≈ ((1/N) Σ L) · ((1/N) Σ f cos / p)
  ∫ f cos dω = F0 · A(α, N·V) + B(α, N·V)
  ```

  Schlick Fresnel lets F0 factor out. A and B form a 2D LUT over (roughness, N·V); K13
  found R16G16 precision important.
- **Frostbite DFG with f90** (L14 §4.9.2, p.70, Listing 24): `LD · (f0 · DFG.x + f90 · DFG.y)`,
  clamp `N·V ≥ 0.5 / LUT_size`. The same LUT has a third channel for Disney diffuse.
- **Where to remodulate.**
  - S15 (notes on the timings slide): multiply the FG term **after** the temporal
    filter, so it neither disturbs the neighbourhood clamp nor needs reprojection.
  - RTG1-19 Eq. 2: filter only `∫L dω`. Specular albedo lives in the pre-integrated
    term, so texture detail never blurs.
  - RTG1-32 §32.3.3 (p.580): keep the sums `L_total` and `w_total` in separate textures
    and combine only after spatio-temporal filtering, following H18.
- **Effective reflectance** (Z15 §3, pp.4–5).
  - Instead of an analytic albedo, divide the component colour by a per-pixel Monte
    Carlo **effective reflectance** `ρ(ω_o) = (1/π) ∫ ρ(ω_i, ω_o) dω_i⊥`. Colour then
    always equals reflectance × effective irradiance, even with DOF/AA or
    non-Lambertian BRDFs.
  - Do **not** divide where reflectance < 1e-3 (numerical floor).
- **Fresnel-only demodulation** (RTG2-46 p.755) is the minimal version.

### C2. Hit-distance handling and normalization

- **Normalized hit distance** `ĥ = sat(h / h_max)`. Z20 (slide 9) calls this AO for the
  diffuse signal and SO for the specular signal. No public source says what `h_max`
  depends on.
- **Hit distances are noisy and must be denoised.** RTG2-49 (p.837) mixes the input hit
  distance with a fast-accumulated, parallax-corrected surface-reprojected history before
  using it for confidence and radius. Z20 (slide 60): hit distance is denoised in every
  pass except pre-blur.
- **Which ray's distance.**
  - RTG1-32 (p.596): for glossy, use the most probable ray's length along the main
    reflection direction.
- **Misses.** Our FFX port maps misses (≤ 0) to `missDistance` (default `camera.far`).
  RTG2-46 shortens rays on rough surfaces and uses precomputed GI on misses.
- **Shadows**: `h` is shaded point → blocker.

### C3. Firefly / outlier suppression

| Technique | Source | Notes |
|---|---|---|
| Luminance weight `w = 1/(1 + luma)` on samples | K14 (tone-map vs luma weight slides) | Keeps chroma. The weight can be recomputed instead of stored. |
| Luminance-weighted local average, then clip to it | FFX (our port: `exp(−0.3 · luma)` 8×8 average; prefilter radiance weight) | Removes energy; source of our −0.04 bias. |
| Clamp to a lower-mip average luminance | RTG2-46 §46.6.1 | Different mip/constant per signal. |
| Pre-blur to **redistribute** (not suppress) outliers; rank-conditioned rank-selection anti-firefly in history fix | RTG2-49 §49.5.1, §49.5.4 | RCRS = Hardie & Barner 1994 (not read). |
| Truncated importance sampling toward the mirror direction (bias 0.7) | S15 slide 68 | GGX tail is the main noise source. |
| Ratio-normalized ray reuse | S15 slides 45–58 | Kills f/pdf spikes from neighbour reuse. |
| Variance/neighbourhood clipping (box sized by σ) | RTG1-25, RTG1-32, FFX | Standard. |

### C4. Ambient and specular occlusion denoising

- **RT AO.** Cosine-weighted hemisphere rays with a max distance. PICA PICA uses 0.6 m in
  its figure (RTG1-25 §25.2.3, pp.452–455). Filtered with "a technique similar to" its
  shadow filter. 1 spp filtered matches 1000 spp "albeit a bit less sharp". UE4
  (RTG1-19 §19.3.3.1) does the same.
- **AO as a free channel.** Store normalized hit distance in alpha next to radiance and
  denoise it with no extra logic. This gives AO from the diffuse denoiser and SO from the
  specular one (Z20 slides 50, 54, 56, 63).
- **SO-only denoising** is a cheap IBL-visibility substitute (Z20 slide 63).
- **Analytic specular occlusion from AO** (L14 §4.10.2, pp.76–77, Listing 26).
  - Formula: `SO = sat((N·V + AO)^{2^(−16 α − 1)} − 1 + AO)` (roughness = α per the v3.2
    erratum).
  - The authors call it non-physical. It returns AO unchanged at full roughness and
    reduces occlusion at normal incidence on smooth surfaces.
- **Metro Exodus** (MX19, skimmed slides ~100–170): RTAO is kept because the pipeline
  multiplies IBL by AO and AO guides the denoiser. RT AO accumulation weights (velocity,
  depth disocclusion) are shared with GI.

### C5. What our FFX port covers vs what is missing (prep)

- **Covered**: miss-distance substitution; luminance-weighted outlier suppression;
  NaN-safe guards; perceptual→linear roughness.
- **Missing**:
  - demodulation API (albedo / pre-integrated specular term, LUT generation);
  - normalized-hit-distance convention and its denormalization parameters;
  - a hit-distance denoising path;
  - an AO/SO channel;
  - a non-energy-removing outlier path;
  - a ratio-estimator mode for shadows and for reflections (two signals, divide late).

---

## Gaps: what no public source we read specifies well

- **G1. Exact anisotropic penumbra kernel.** RTG1-19 and TR19 show it only as pictures.
  M12 gives an isotropic width. We must design the anisotropy, for example by projecting
  the light disk's image through the blocker onto the receiver plane, and log it as our
  own derivation.
- **G2. Hit distance for lit pixels next to a shadow ("overlapping penumbra").** A lit
  pixel's shadow ray misses, so it has no blocker distance, yet it sits inside a
  neighbour's penumbra. Where penumbrae overlap, the nearest blocker should win
  (M12 uses `d2_max`). TR19 slides 67–68 name the problem without a textual fix. A
  search-result summary of an NVIDIA patent described a remedy. Per RULES.md we do not
  use it, and whoever designs this pass should derive a fix independently from M12's
  "sharpest occluder wins" principle and document it.
- **G3. Hit-distance normalization curve** (`h_max` as a function of view distance and
  roughness). Public sources (Z20 slide 9) say it exists, not what it is. Our design will need its own
  (e.g. `h_max = (a + b·|z_view|) · g(roughness)`, tuned on our test bed).
- **G4. Virtual-motion confidence terms and the parallax accumulation constants**
  (RTG2-49 Listings 49-4/49-7, not read on purpose). The prose lists the properties only.
  Z20 slide 58 shows a curve but no constants.
- **G5. Filtering colored translucent shadows.** No source says whether RGB transmittance
  is filtered per channel, as luminance + chroma, or with which hit distance (first or
  last translucent hit).
- **G6. Multi-light shadow denoising.** RTG2-46 needs one dominant light per pixel.
  RTG1-19 runs per light. No shipped public scheme for many lights.
- **G7. Specular footprint for α > ~0.25.** RTG1-19 switches to temporal + biased
  sampling. RTG2-49 handles it through dominant direction → diffuse. No source gives a
  closed-form screen-space footprint for rough GGX that includes elongation.
- **G8. Curvature-aware virtual motion in real time.** RTG1-32 gives the math. Obtaining
  principal curvatures from a G-buffer is left to "differential geometry" (do Carmo).
  RTG2-49 only mentions it as an option.
- **G9. Specular occlusion that is physically grounded.** L14 Listing 26 is explicitly
  empirical. GTSO (Jimenez 2016) was not read here.

---

## WGSL / WebGPU implementation notes (our analysis)

- **Formats.** Core WebGPU has no RG11B10 storage. Pack `radiance.rgb + ĥ` into one
  `rgba16float` (fp16 is fine for normalized `ĥ ∈ [0,1]`; raw distances lose precision
  past ~2k units). Visibility + `h` for shadows fit an `rg16float`. Translucent shadows
  need RGB + `h` in `rgba16float`.
- **Unfilterable r32float.** History scalars in `r32float` need manual bilinear
  (already done in the FFX port) unless `float32-filterable` is present. Prefer
  `rgba16float` for anything that needs hardware bilinear or Catmull-Rom history fetch.
- **Custom-weight bilinear** (Z20 slides 27–29) maps directly to 4 `textureLoad`s plus
  explicit weights. That is also how we avoid `textureSample` restrictions in compute
  shaders.
- **Penumbra mask and indirect dispatch.** Build a tile list (as FFX shadows already
  does with 8×4 bitmasks and `atomicOr`). Dispatch the expensive filters with
  `dispatchWorkgroupsIndirect` (core). TR19 and H18 both get most of their speed from
  skipping non-penumbra tiles.
- **Per-light dispatch cost.** One compute pass per light per filter pass. Pack up to 4
  lights per RGBA texture (RTG1-13) to amortize G-buffer reads. The default limit of 4
  storage textures per stage is the binding constraint.
- **Separable vs Poisson.** Separable world-space Gaussians (RTG2-46, H18) are cheap and
  fit workgroup-memory tiles. Rotated 8-tap Poisson (RTG2-49) needs no shared memory but
  gathers scattered taps. Our FFX port already uses `workgroupUniformLoad` / LDS
  emulation where subgroups are missing. Subgroups remain optional.
- **Split-sum LUT.** Generate the 2D `(N·V, α) → (A, B)` table once at init with a
  compute shader (K13 §Environment BRDF). Use `rg16float`, or `rgba16float` with the
  diffuse term in the third channel (L14). Use `textureSampleLevel` with a linear
  sampler.
- **Ratio estimator** costs one extra signal (two `rgba16float` or one packed pair). The
  divide happens in the last filter pass (H18 §4.1 writes the final image directly from
  the vertical pass).
- **Renderer-side contract to document:** unjittered ray origins (TR19); blue-noise
  sampling animated with the golden ratio (RTG2-24); importance-sampled rays with pdf
  clamping (S15).

---

## Confidence notes

- **High**:
  - H18's ratio estimator and the divide-after-denoise rule (explicit equations and
    argument);
  - RTG1-13 parameters (all numeric values printed);
  - RTG1-32 weight functions and constants (printed; Eq. 17 looks inconsistent with its
    prose, as noted);
  - K13 split-sum;
  - M12 Eq. 13 (verified on the layout text, constants from §6).
- **Medium**:
  - RTG2-46 shadow filter: prose plus figure. The listing bodies were not used, and the
    σ constant inside the listing was not relied on.
  - FFX docs: summarized through a fetch tool, cross-checked against our own port's
    constants.
  - S15: slide text + speaker notes, which are offset by one slide in the pptx;
    attribution to slide numbers is ±1.
- **Medium-low**:
  - RTG1-19 and TR19 anisotropic kernels. Only figures and slide titles exist; the
    mechanism is not public in text.
  - L14 cone-angle formula. Printed as `atan(Eα²/(1−E))`, which looks dimensionally off
    for GGX; verify.
- **Formulas from public talk pseudo-code** (Z20 slides 46–47, 58, 60) are accurate
  transcriptions into our notation. They are allowed sources (public talks); SPEC
  implements only the stated properties and tunes its own curves (SPEC listing policy).
- **Not read**: T15 (paywalled), Liu 2018 course, Salvi 2016, Hardie & Barner 1994,
  GTSO. Claims about them are only what the reading sources said.
- **Clean-room incidents**: none involving NRD code. One patent-derived idea surfaced
  through a web-search summary (G2) and is excluded.
