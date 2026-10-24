# SVGF family and ReLAX: clean-room source notes

Research date: 2026-10-24. Scope: SVGF and its direct relatives (the published basis of
NVIDIA's ReLAX), plus everything about ReLAX that NVIDIA or third parties have said in prose.
These notes follow `../RULES.md`. No NRD or NRD-Sample code was opened, and no fork, port or
mirror of NRD was opened either. See "Provenance and exposure notes" at the end.

Notation used throughout (my own):

- `p`, `q`: pixel positions. `i`: frame index. `k`: à-trous iteration (0-based).
- `c_i(p)`: noisy, albedo-demodulated illumination for frame `i` (RGB).
- `C_i(p)`: temporally integrated illumination. `H`: history buffers from frame `i-1`.
- `l(p)`: luminance of a color. `m1`, `m2`: first and second raw moments of luminance.
- `n`: per-pixel history length (number of frames accumulated).
- `a`: EMA blend weight given to the new sample (the papers call it α).

Page numbers are the page of the PDF file I downloaded (the authors' preprint unless noted).
For ACM PACMCGIT papers I also give the printed article page (e.g. 24:9).

---

## 1. Sources

| # | Title | Authors | Year | URL (copy used) | License / access | Covers |
|---|---|---|---|---|---|---|
| S1 | Spatiotemporal Variance-Guided Filtering: Real-Time Reconstruction for Path-Traced Global Illumination (SVGF) | Schied, Kaplanyan, Wyman, Patney, Chaitanya, Burgess, Liu, Dachsbacher, Lefohn, Salvi | HPG 2017, doi:10.1145/3105762.3105770 | https://cg.ivd.kit.edu/publications/2017/svgf/svgf_preprint.pdf (project page https://cg.ivd.kit.edu/svgf.php) | Author's version, "personal use, not for redistribution". Kept out of repo. | The whole SVGF pipeline, parameters, timings, limitations. **Primary.** |
| S2 | Gradient Estimation for Real-Time Adaptive Temporal Filtering (A-SVGF) | Schied, Peters, Dachsbacher | PACMCGIT 1(2) art. 24, 2018, doi:10.1145/3233301 | https://cg.ivd.kit.edu/publications/2018/adaptive_temporal_filtering/adaptive_temporal_filtering.pdf (page https://cg.ivd.kit.edu/atf.php) | Author's version, personal use. | Temporal gradients, adaptive α, cost. |
| S3 | A-SVGF companion source code (`a_svgf.zip`: GLSL shaders + Falcor host code) | Christoph Schied (KIT) | 2018 | https://cg.ivd.kit.edu/publications/2018/adaptive_temporal_filtering/a_svgf.zip | **BSD-3-Clause** (Copyright 2018 Christoph Schied). README asks for a short note to the author if used in a product. Authors' own upstream, so usable under rule 2. README says its SVGF part is a reimplementation, not the 2017 original. | Concrete constants and buffer formats the papers leave out. |
| S4 | Edge-Avoiding À-Trous Wavelet Transform for fast Global Illumination Filtering | Dammertz, Sewtz, Hanika, Lensch | HPG 2010 | https://jo.dreggn.org/home/2010_atrous.pdf | Author preprint. The paper ends with a GLSL listing whose license isn't stated; I did not use it. | The à-trous base filter that SVGF builds on. |
| S5 | Blockwise Multi-Order Feature Regression for Real-Time Path Tracing Reconstruction (BMFR) | Koskela, Immonen, Mäkitalo, Foi, Viitanen, Jääskeläinen, Kultala, Takala | ACM TOG 2019 | https://webpages.tuni.fi/foi/papers/Koskela-TOG-2019-Blockwise_Multi_Order_Feature_Regression_for_Real_Time_Path_Tracing_Reconstruction.pdf | Author copy. | A regression alternative to SVGF. Its accumulation trick (cumulative average first, then EMA) and its comparison with SVGF. |
| S6 | Temporally Reliable Motion Vectors for Real-time Ray Tracing (TRMV) | Zeng, Liu, Yang, Wang, Yan | CGF 40(2), Eurographics 2021 | https://sites.cs.ucsb.edu/~lingqi/publications/paper_trmv.pdf | Author copy. | Special motion vectors for shadows, glossy reflections and disocclusions, plus a µ±3σ history clamp. |
| S7 | An Excursion in Temporal Supersampling | Marco Salvi (NVIDIA) | GDC 2016 | https://developer.download.nvidia.com/gameworks/events/GDC2016/msalvi_temporal_supersampling.pdf | Public slides. | Variance clipping (clamping history to mean ± γσ from local moments). |
| S8 | ReBLUR: A Hierarchical Recurrent Denoiser (Ray Tracing Gems II, ch. 49) | Dmitry Zhdan (NVIDIA) | 2021 | https://link.springer.com/content/pdf/10.1007/978-1-4842-7185-8_49.pdf | **CC BY-NC-ND 4.0** open-access book chapter. I used only the prose that mentions ReLAX/SVGF, not its code listings. | NVIDIA's one-paragraph description of ReLAX. |
| S9 | Rearchitecting Spatiotemporal Resampling for Production (the RTXDI paper) | Chris Wyman, Alexey Panteleev | HPG 2021 | https://d1qx31qr3h6wln.cloudfront.net/publications/hpg21_rearchitectingReSTIR.pdf | NVIDIA Research public PDF. | What ReLAX improves over SVGF/A-SVGF (prose), its cost, and the noise ReSTIR hands to a denoiser. |
| S10 | Cyberpunk 2077 – Ray Tracing: Overdrive, ReSTIR Integration (SIGGRAPH 2023 ReSTIR course) | Pawel Kozlowski (NVIDIA), Giovanni De Francesco (CDPR) | 2023 | https://intro-to-restir.cwyman.org/presentations/2023ReSTIR_Course_Cyberpunk_2077_Integration.pdf | Public course slides. | A simplified public layout of NRD's radiance denoisers, and how ReSTIR changes denoiser tuning. |
| S11 | Decorrelating ReSTIR Samplers via MCMC Mutations | Sawhney, Lin, Kettunen, Bitterli, Ramamoorthi, Wyman, Pharr | 2022 (arXiv 2211.00166; TOG 2024) | https://arxiv.org/pdf/2211.00166 | arXiv. | Why moment-based variance (SVGF) is less reliable on correlated ReSTIR input. Cites the ReLAX GTC talk. |
| S12 | NVIDIA web pages: NRD product page; RTXDI launch blog; RTX Remix glossary; GTC21 session page | NVIDIA | 2021–2026 | https://developer.nvidia.com/nrd ; https://developer.nvidia.com/blog/lighting-scenes-with-millions-of-lights-using-rtx-direct-illumination/ ; https://docs.omniverse.nvidia.com/kit/docs/rtx_remix/1.2.4/docs/remix-glossary.html ; https://www.nvidia.com/en-us/on-demand/session/gtcspring21-s32759/ | Public web pages. | One-line descriptions of ReLAX. The GTC page carries the title only: no abstract, slides or speakers were readable. |
| S13 | "ReLAX: A Denoiser Tailored to Work with the ReSTIR Algorithm" | Pawel Kozlowski, Tim Cheblokov | GTC 2021, session S32759 | (as above) | NVIDIA On-Demand. Video and slides **not accessed** (page renders no content without JS/login). | The primary public talk on ReLAX. **Biggest gap in these notes.** |
| S14 | Falcor (contains an SVGF render pass) | NVIDIA | ongoing | https://github.com/NVIDIAGameWorks/Falcor | LICENSE.md is **BSD-3-Clause** (checked). **Warning:** Falcor also links and integrates NRD (its LICENSE names NRD as a third-party component). Only its SVGF pass could be consulted; its NRD pass and any NRD submodule are off limits. | Not opened beyond the license file. Optional cross-check. |

Sources I deliberately did **not** use:

- **Patents.** Web searches returned several USPTO patents titled "History clamping for denoising dynamic ray-traced scenes using temporal accumulation". I did not open them. One search-engine summary included a one-sentence paraphrase of such a patent; see section 9.
- **deepwiki.com/NVIDIA-RTX/NRD.** This is an AI summary generated from NRD's source code, so it is off limits.
- **NRD README prose.** Allowed by rule 2, but my fetch was blocked by the session's permission system. I did not read it.
- **Q2RTX / Q2VKPT** (game-integrated A-SVGF). Believed GPL-2.0 because they are based on Quake II; license not verified. Treat them as not permissive and don't use them.
- **RadeonProRender-Baikal SVGF** (the base of BMFR's SVGF comparison, S5 p.11 footnote). License not verified; not opened.
- **Third-party blogs** that may paraphrase NRD code (e.g. alain.xyz "Ray Tracing Denoising"). Skipped as a contamination risk.

---

## 2. SVGF, pass by pass

### 2.0 Overall structure (S1 §3, Fig. 2–3, p.3–4)

- Input is 1 path per pixel. Primary visibility comes from rasterization, so the G-buffer is noise-free (S1 §1, p.2; §3 "Path Tracing", p.3).
- The path tracer writes **direct and indirect illumination separately**, and each is filtered by its own copy of the pipeline. Much of the work is shared because it reads the same G-buffer (S1 §3, p.4).
- **Albedo demodulation.** Before filtering, divide out the albedo of the directly visible surface (textures and spatially varying BRDF). After filtering, multiply it back in. For layered materials, use the per-layer albedos summed and weighted by their sampling probability (S1 §3 "Reconstruction", p.4).
- **Core filter** (S1 Fig. 3, p.4): temporal accumulation of color and moments, then variance estimation, then N à-trous iterations. The **output of the first à-trous iteration becomes next frame's color history** (S1 §4.3, p.5).
- **After the filter:** re-modulate albedo, recombine direct and indirect, tone map, then run TAA (Karis 2014) (S1 §3 "Post Processing", p.4).
- The paper's path tracer samples with a small looping Halton set (e.g. 16 samples), because the EMA forgets older frames anyway. It also uses path-space regularization after the first bounce. Each pixel gets one indirect bounce: one ray to the secondary hit plus two shadow rays (S1 §3, p.3). These are input-side choices, not part of the filter.

**G-buffer used** (S1 §3, p.4): depth, object-space and world-space normals, mesh ID, and screen-space motion vectors. History buffers hold the integrated color, the integrated moments, and the previous frame's depth, normals and mesh IDs.

### 2.1 Pass 1: temporal accumulation (S1 §4.1, p.4–5)

**Inputs:** `c_i`, motion vectors, current and previous depth/normal/mesh ID, color history `C_{i-1}` (filtered), moments history `(m1, m2)_{i-1}`, history length `n_{i-1}` (S3).
**Outputs:** `C_i`, `(m1, m2)_i`, `n_i`.

1. **Back-project.** Use the motion vector to find the pixel's position in the previous frame. The paper's motion vectors cover camera and rigid-object motion (p.5).
2. **Resample the history with a 2×2 bilinear footprint.** Test each tap for consistency: depth, normal (object-space normals in the paper's tests, p.4), and mesh ID. Drop inconsistent taps and redistribute their weight evenly over the consistent ones (p.5).
3. **Fallback.** If no tap passes, try a **3×3** footprint, which helps with thin geometry such as foliage. If that also fails, treat the pixel as a disocclusion: drop the history and set `C_i = c_i` (p.5).
4. **Exponential moving average:** `C_i = a·c_i + (1−a)·C_{i−1}`, with **a = 0.2** in SVGF (p.5). A-SVGF uses a = 0.1 as its base value (S2 §5, p.10 / 24:10).
5. **Moments.** Accumulate `m1 = l`, `m2 = l²` of the luminance of `c_i` the same way, reusing the same consistency tests (S1 §4.2, p.5).

Constants from the authors' 2018 reimplementation (S3, `TemporalAccumulation.frag` and `svgf_shared.glsl`, BSD-3). The papers don't give these:

- **Normal test:** dot(n_curr, n_prev) > 0.95.
- **Depth test:** |z_curr − z_prev| < 2·(dz + 0.001), where `dz` is a per-pixel screen-space derivative of linear depth stored in the G-buffer.
- **Mesh test:** mesh IDs must be equal. **Bounds test:** the tap must be inside the screen.
- **Accept rule:** use the history if the summed bilinear weight of the passing taps is > 0.01. Renormalize by that sum. The 3×3 fallback is *not* implemented in this reimplementation.
- **History length** `n` is reprojected like the color, incremented, and capped at **64**.
- **Color blend weight** = max(a, 1/(n+1)). This is a cumulative average during the first frames, then the fixed EMA. BMFR describes the same idea independently: cumulative average until the new sample's weight would drop below 20%, then the EMA (S5 §3.2, p.4).
- **Moments blend weight** = max(0.6, 1/(n+1)). The moments are deliberately much "faster" than the color. *This is from the code, not the paper.* The paper doesn't say which a it uses for the moments.
- The motion vector is offset by the camera jitter before back-projection.

### 2.2 Pass 2: variance estimation (S1 §4.2, p.5; Fig. 9)

- **Temporal estimate:** `σ² = m2 − m1²`, from the integrated moments (p.5). Clamp at 0 (S3).
- **Spatial fallback.** Use it while history is short (**< 4 frames** after a disocclusion): estimate the variance spatially with a **7×7 bilateral filter** weighted by depth and world-space normals (p.5). This pass is the main cause of frame-time variation (S1 §5.3, p.9).
- The paper's warning: variance is only a proxy for noise. Noise raises variance, but real detail also has variance (p.5).

Fallback details from S3 (`EstimateVariance.frag`, BSD-3):

- **Footprint:** 7×7 when n ≤ 1, 5×5 when 1 < n < 4.
- **Weights:** depth term exp(−|Δz| / (dz·|offset| + 0.01)), times normal term max(0, n·n')^128, times (same mesh ? 1 : 0).
- **Boost:** the spatial variance is multiplied by `1 + 3·(1 − n/4)` (up to 4× right after a disocclusion), which deliberately over-blurs fresh pixels.
- **Background:** background pixels pass through with variance 0.
- *Quirk:* inside the loop, the luminance used for the neighbor moments appears to be computed from the running center sum rather than from the neighbor. Treat this as a probable bug. Don't copy it; use the neighbor's luminance.

### 2.3 Passes 3..(N+2): edge-avoiding à-trous wavelet (S1 §4.3, p.5; S4 §2.2, p.3–4)

**Base transform (S4):**

- Each iteration convolves with a kernel whose taps are spaced 2^k apart. Dammertz fills 2^k − 1 zeros between taps; the tap count stays constant (S4 p.3–4, Fig. 3).
- **Kernel:** the 1D B3-spline `h = (1/16, 1/4, 3/8, 1/4, 1/16)`, used as a separable 5×5 (S4 p.4; S1 Eq. 1, p.5).
- **Detail coefficients are discarded:** the last smoothed level is the output (S4 p.4).
- **Iterations:** Dammertz uses 5 and calls the footprint "80×80" (S4 p.3). SVGF says 5 levels give an effective **65×65** footprint (S1 p.5).

**One SVGF iteration** (S1 Eq. 1, 2, p.5), with weights normalized over the footprint Ω:

```
C_{k+1}(p) = Σ_q h(q)·w_k(p,q)·C_k(q) / Σ_q h(q)·w_k(p,q)
w_k(p,q)   = w_z · w_n · w_l
```

**Variance is filtered alongside the color**, assuming uncorrelated samples (S1 p.5):

```
Var_{k+1}(p) = Σ_q h(q)²·w_k(p,q)²·Var_k(q) / (Σ_q h(q)·w_k(p,q))²
```

The filtered variance drives the luminance weight of the *next* iteration. As variance shrinks, the luminance term gets stricter, which stops the coarser levels from over-blurring (S1 §4.4, p.6).

**History feedback:** the color after iteration 0 (the first) is written as next frame's color history. The paper reports this empirically balances stability against spatial bias (S1 p.5). The *moments* history is the unfiltered integrated moments.

**Albedo remodulation:** S3 multiplies albedo back in during the last iteration's output.

**Kernel variants seen in S3:**

- The full 5×5 B3 kernel, normalized so the center weight is 1 (1D weights 1, 2/3, 1/6).
- 3×3 box.
- 5×5 box.
- A "subsampled" alternating cross pattern.

A-SVGF switched the color filter to a **3×3 box** at all 5 levels (effective 49×49). It reports a negligible quality loss and a notable speedup (S2 §4, p.9 / 24:9). S3's default `mFilterKernel = 1` is the 3×3 box.

### 2.4 Edge-stopping functions (S1 §4.4, p.5–6; S2 Eq. 9–11, p.8 / 24:8)

**Published parameters:** σ_z = 1, σ_n = 128, σ_l = 4. The paper found these work for every scene it tested, so it doesn't expose them (S1 p.5). A-SVGF uses "the same as SVGF" (S2 p.8).

- **Depth** (S1 Eq. 3): `w_z = exp(−|z(p) − z(q)| / (σ_z·|∇z(p)·(p−q)| + ε))`.
  - `z` is clip-space depth and `∇z` its screen-space gradient. The depth is modeled as a local plane, so tilted surfaces don't get falsely rejected.
- **Normal** (S1 Eq. 4): `w_n = max(0, n(p)·n(q))^σ_n`, using world-space normals.
- **Luminance** (S1 Eq. 5): `w_l = exp(−|l(p) − l(q)| / (σ_l·sqrt(g3x3(Var(l(p)))) + ε))`.
  - `g3x3` is a 3×3 Gaussian blur of the variance image. The blur is used *only* to drive this weight; the unblurred variance is what propagates to the next level (S1 p.6, Fig. 5).
  - Pre-filtering the variance fixes underestimation where light arrives with low probability (Fig. 5).

**What S3's code does differently** (BSD-3; record it as a variant, not as "SVGF as published"):

- **Luminance:** the term enters the exponent **squared**, i.e. a Gaussian `exp(−(Δl/σ)²)`, with `σ = 3·sqrt(g3x3(Var))`.
- **Depth:** the exponent is `3·|Δz| / (dz·|offset_px| + 0.01)`, where `dz` is a stored per-pixel depth derivative and `offset_px = tap offset × step`. The single derivative approximates the gradient-dot-offset term.
- **Normal:** power 128, same as the paper.
- **Weights are not mixed across meshes** in the variance pass. The à-trous pass has no mesh test.

### 2.5 Measured cost (S1 §5.3, p.7–9, Fig. 8)

- **Time:** 4.4 ms on average at 1280×720, ranging 4.1–5.8 ms in the San Miguel fly-through. 10.2 ms at 1920×1080. That is about 200 MPix/s on a TITAN X (Pascal), OpenGL implementation.
- **Variation:** less than 15% apart from the first frame, all of it from the spatial variance fallback. Full-frame disocclusions are about 50% slower.
- **Breakdown (Fig. 8):** the à-trous passes dominate, followed by variance estimation, temporal accumulation and TAA.
- **Comparison:** BMFR later reported 2.4 ms against SVGF's 4.4 ms on similar hardware (S5 p.11).

---

## 3. A-SVGF: adaptive temporal accumulation (S2)

**Goal:** replace SVGF's constant `a` with a per-pixel `a_i(p)` that rises toward 1 where the shading changed, so stale history is dropped (S2 §1, p.2 / 24:2).

### 3.1 Gradient sampling (S2 §3.1–3.3, p.5–7 / 24:5–24:7)

- **Definition:** the temporal gradient is defined by **forward projection**: `δ = f_i(G→_{i−1,j}) − f_{i−1}(G_{i−1,j})`.
  - A previous frame's surface sample is carried forward and shaded again with this frame's lighting.
  - Forward projection only needs the previous frame's *shading results*. Back-projection would need the previous frame's whole shading state (p.5–6).
- **Luminance only:** only the luminance of δ is kept (p.6).
- **Same surface point:** the re-shaded sample must be at exactly the same surface point. Reusing a nearby current-frame sample instead adds sub-pixel offsets that grossly overestimate the gradient (p.6).
- **Same random numbers:** the re-shaded sample reuses the old pixel's random numbers, so δ = 0 in static regions. Only a **per-pixel RNG seed** is stored (Eq. 6, p.6).
- **Requires a visibility buffer:** forward projection is easy with one (triangle ID + barycentrics) and hard with a plain G-buffer (p.5).

**Construction** (p.7):

1. Split the screen into **3×3 strata**. In each stratum, randomly pick one pixel of the previous frame.
2. Forward-project the picked pixel's surface sample and seed.
3. Discard it if it's occluded in the current depth buffer.
4. Write it into the current visibility buffer at the pixel it lands on, replacing that pixel's own sample. At most one gradient sample is allowed per stratum; collisions are resolved with **GPU atomics** (first writer wins).
5. Shade all pixels normally. Then subtract to get δ.

The re-shaded samples are still valid samples for their pixels (just off-center), so no holes appear. They do carry less new information and break blue-noise properties.

- **2×2 strata:** up to 25% of samples are recycled. Visible artifacts appear (dark splotches).
- **3×3 strata:** at most 11% (S2 §5.1, p.11–12, Fig. 5).

### 3.2 Gradient reconstruction (S2 §3.4, p.7–8 / 24:7–24:8)

- **Grid:** samples are stored on a grid at stratum resolution (1/3 × 1/3). Empty strata get δ = 0.
- **Per-stratum luminance:** the mean of the stratum's pixels. Its variance is the luminance variance within the stratum.
- **Filter:** a **5-iteration joint-bilateral à-trous** (k = 0..4) with a 3×3 box kernel at level 0, spread out at later levels.
- **Weights:** w_z, w_n and w_l in the SVGF form, with SVGF's parameters.
  - The luminance weight uses the luminance being filtered in the same pass, normalized by sqrt of the 3×3-Gaussian-blurred variance (Eq. 9–11).
- **δ uses the luminance pass's weights:** the gradient is filtered with exactly the weights computed for the luminance (Eq. 12).

S3's version (`AtrousGradient.frag`, `CreateGradientSamples.frag`):

- The gradient filter uses only depth and luminance weights (no normal term) and a 3×3 box.
- Buffers are two RGBA32F images at stratum resolution. They hold (Δ, δ, valid flag), and (mean luminance, luminance variance, z, dz).
- Within a stratum, the moments only include pixels with the same mesh ID.

### 3.3 From gradient to blend weight (S2 §3.5, p.8–9 / 24:8–24:9)

```
Δ(p)   = max(f_i(fwd sample), f_{i−1}(old sample))      (normalizer, filtered like δ)
λ(p)   = min(1, |δ̂(p)| / Δ̂(p))
a_i(p) = (1 − λ)·a + λ
```

- **Holes fill themselves.** Empty strata contribute zero to both δ̂ and Δ̂, so sample density cancels in the ratio.
- **Disocclusions:** in disoccluded areas the ratio is meaningless, but the history is dropped there anyway (p.8).
- **Safety margin:** take the **max of `a_i` over a 3×3 neighborhood** to cover reconstruction error (p.9).
- **Same weight for color and moments:** S3 applies `a ← lerp(a, 1, λ)` to both the color and the moments weights, then resets the history length to `1/a`, capped at 64.
  - S3 also takes the max of the ratio over a (2r+1)² neighborhood at gradient resolution (default r = 2).
  - *Quirk:* S3 clamps the ratio to [0, 200] and the intended clamp to [0, 1] has no effect, so λ > 1 can push `a` past 1. Follow the paper (Eq. 14): clamp λ to ≤ 1.
- **Spatial fallback:** when A-SVGF drops history, it falls back to SVGF's spatial variance estimate, which blurs more (S2 §4, p.9).
- **Path tracer setup in the paper:** the path-tracer variant of A-SVGF did *not* split direct and indirect (p.9).

### 3.4 Cost and limits (S2 §5.3–5.4, p.14)

- **Cost:** gradient sampling plus reconstruction take < 1 ms. The whole temporal filter takes < 2 ms at 1920×1080 on a Titan Xp.
  - Overall frame cost rises somewhat because history drops more often, which triggers the costlier spatial variance path (Fig. 7, p.13).
- **Coherent sampling required:** the primary sample space must stay coherent between frames. If the light list or importance sampling changes, the gradient fires and history is dropped. The paper suggests also storing the light index (p.14).
- **Not compatible with** stochastic primary visibility (DOF, motion blur), because the method needs forward projection of stable sample positions (p.14).
- **Variance-estimator switches:** switching between spatial and temporal variance briefly reduces stability (S2 §5.2, p.12–13).

---

## 4. ReLAX: what is public

### 4.1 Documented in public prose

1. **Lineage and key feature.** NVIDIA calls ReLAX an advanced version of SVGF whose main feature is **clamping to the fast history**. It was built for the signal produced by **RTXDI** (S8 §49.1, p.824).
2. **Spatial filter.** ReLAX uses an **à-trous** hierarchical spatial filter, like SVGF (S8 §49.14 "Future work", p.842).
3. **Improvements over SVGF/A-SVGF.** The RTXDI paper says ReLAX draws on SVGF and A-SVGF but improves:
   - denoising of **specular reflections**,
   - **firefly suppression**,
   - **temporal stability**,
   - **robust disocclusion handling**,
   - **speed**.
   It reports the denoiser at **1.8 ms at 1920×1080 on an RTX 3090** in their RTXDI setup (S9 §8.1, p.14). That number covers whatever signals they denoised; the paper doesn't break it down.
4. **Signals.** RTX Remix's glossary describes ReLAX as an SVGF variant tuned for ray-traced **diffuse and specular** signals (S12, glossary). NVIDIA's NRD page lists it as the denoiser for "RTX Dynamic Illumination signals" (S12).
5. **Release history.** It shipped in **NRD 2.0** at GTC 2021, announced as a "high frequency" denoiser for RTXDI signals (NVIDIAGameDev post, seen only as a search-result snippet). The talk was "ReLAX: A Denoiser Tailored to Work with the ReSTIR Algorithm" by Kozlowski and Cheblokov, session S32759 (S13; cited as [KC21] in S9 and S11).
6. **RTXDI pairing.** NVIDIA's RTXDI blog says ReLAX is "especially designed for RTXDI", and that RTXDI also works with generic denoisers such as SVGF (S12, RTXDI blog).
7. **NRD radiance denoiser layout (simplified, public).** In Kozlowski's SIGGRAPH 2023 slides (S10 slides 12–14), NRD's radiance denoisers are shown as three stages:
   - **Pre-blur:** constant radius; also needed to fix outliers. Its job is to turn a raw, sparse frame into something denser for later stages.
   - **Temporal accumulation:** "linear weights", with up to **64** frames, set by an input parameter.
   - **Blur:** a spatial blur whose guides depend on the specific denoiser.
   Slide 12 cites RTG II ch. 49 for this layout, so it may describe ReBLUR more exactly than ReLAX. Treat it as family-level.
8. **ReSTIR changes the tuning** (S10 slide 14). ReSTIR's own spatiotemporal reuse acts as a sophisticated pre-blur. With ReSTIR input you can **skip the pre-blur** and make the denoiser **more conservative**: a **shorter history** and a **smaller final-blur radius**.
9. **What ReSTIR input looks like to a denoiser** (S9, S11):
   - **Correlation:** ReSTIR samples are spatiotemporally correlated. Moment-based estimators such as SVGF's become **less effective because the variance estimates are off** (S11 §1, p.2).
   - **Spatial reuse dithers correlation away:** randomized spatial reuse breaks up temporal correlations (S9 §6.3, p.10).
   - **After disocclusions:** with 1 temporal + 1 spatial sample, variance stays high for 3–4 frames, then a longer trail of mild noise that "a denoiser easily fixes" (S9 §6.4, p.10).
10. **Cost relative to ReBLUR (unverified).** A forum post quoting the NRD README says ReLAX uses about 30% more memory and runs about 20% slower than ReBLUR. I could not check this against the README (see section 9). Treat as low confidence.

### 4.2 Public ideas we can use to build "clamp to fast history"

The phrase "clamping to the fast history" (S8 p.824) plus open literature give enough for a clean-room design. The design below is **my synthesis**, not a description of ReLAX:

- **Two accumulators per signal**:
  - a *slow* history with a long cap (e.g. up to 32–64 frames, the cap S10 mentions);
  - a *fast* history with a short cap (a few frames).
  Both use the same reprojection and the max(a, 1/(n+1)) start-up rule (S3; S5 p.4). Their only difference is the cap.
- **Before blending**, clip or clamp the reprojected slow history toward the fast history's statistics.
  - Use an AABB of mean ± γσ, as in Salvi's variance clipping (S7 slides 23–25: γ ≈ 1 typical; larger γ is more stable but ghosts more).
  - TRMV uses a "mild" [µ−3σ, µ+3σ] clamp on history (S6 §5, p.7).
  - The σ can come from SVGF's per-pixel temporal moments, from a small spatial neighborhood, or from both.
  - Salvi notes the moments can be pre-blurred to make the window cheaply larger (S7 slide 53).
- **Why this cuts lag:** the fast history reacts within a few frames to lighting changes that motion vectors can't see (moving shadows, toggled lights). That is SVGF's failure mode in S2 Fig. 1. The slow history keeps its noise reduction where nothing changed. It is a cheaper, noisier alternative to A-SVGF's gradient sampling: no forward projection, no RNG-seed reuse.
- **Trade-off (from S7):** when the clamp window is tight relative to the noise, history keeps getting clipped and you get flicker. When it is loose, you get ghosting. A fast history that is itself noisy widens σ, which loosens the clamp exactly where the input is noisy.
- **Disocclusion fallback:** SVGF's spatial variance estimate is one option. Another, from S10, is to rely on ReSTIR's spatial reuse and lower the pre-blur.

### 4.3 Not publicly documented (as far as these sources go)

- Fast and slow history lengths, blend weights or caps. Whether the clamp uses the fast history's moments, its spatial neighborhood, or both. γ / σ multipliers. Clamp vs. clip.
- How ReLAX handles **specular**: virtual or reflection motion vectors, use of hit distance, roughness- or lobe-based edge-stopping, and the specular history length vs. roughness.
- ReLAX's **firefly suppression** method. (ReBLUR's chapter names a rank-conditioned rank-selection filter, S8 p.829, but nothing says ReLAX uses the same one.)
- ReLAX's disocclusion handling: history fix or reconstruction, spatial variance fallback, or anything else.
- Number of à-trous iterations, kernel shape, edge-stopping parameter values, and any changes to SVGF's luminance weight.
- Whether ReLAX keeps a separate variance/moments buffer or keeps albedo demodulation as in SVGF. Anti-lag beyond fast-history clamping. Confidence inputs. Checkerboard, SH or occlusion-only variants. Memory layout and formats.
- Whether ReLAX denoises diffuse and specular jointly or separately (the glossary and later release notes mention both; details unknown).
- Everything in the GTC 2021 talk (S13), which I could not reach.

---

## 5. Known failure modes and published mitigations

| Failure | Cause | Where documented | Published mitigation |
|---|---|---|---|
| **Temporal lag / ghosting** after lighting changes (moving lights, flicker, moving occluders) | Fixed EMA α. Motion vectors only follow geometry. | S1 §6 "Detached shadows", p.11, Fig. 13a; S2 Fig. 1, §1 | A-SVGF adaptive α (S2). Fast-history clamping (ReLAX, S8). Variance/neighborhood clipping (S7; µ±3σ in S6 p.7). Effect-specific motion vectors (S6). |
| **Glossy reflections lag or smear** | Reflections move with the reflected scene, not the surface. | S1 §6 p.11, Fig. 13d; S2 §5.1 GlossySponza, p.10 | Separate diffuse/glossy reprojection (Mara et al. 2017, cited in S2 p.4). TRMV stochastic glossy motion vectors (S6 §4.2). ReLAX "improved specular" (S9; method undocumented). |
| **Over-blur after disocclusion** | Spatial variance fallback, boosted variance, no history. | S1 Fig. 9; S2 §4, §5.1 Pillars; S3 boost factor | Accept the blur. BMFR-style cumulative average for fast convergence (S5 p.4). ReSTIR spatial reuse at disocclusions (S9 §6.4). TRMV dual motion vectors reuse the background's history (S6 §4.3). |
| **Over-blur under motion** | Bilinear resampling of history; back-projection adds variance. | S1 §6 "Over-Blurred Features Under Motion", p.11, Fig. 13e,f | Not solved in S1. Yang et al. 2009 analyze resampling blur (cited in S2 p.3). Final TAA. |
| **Over-blurred chrominance** | Only luminance variance drives the filter. | S1 §6 p.10 | Per-channel variance, at more memory and compute (S1 p.10). |
| **Temporally unstable noise in very low light** | Too few non-zero samples, so the variance estimate is unreliable. | S1 §6 p.11, Fig. 13b, Fig. 9 right | None in S1. Better sampling (ReSTIR) upstream. |
| **Variance underestimated** with rare, bright paths | Few samples carry the energy. | S1 Fig. 5, p.6 | 3×3 Gaussian prefilter of variance before the luminance weight. |
| **Flicker / instability** | Switching from spatial to temporal variance. Clamp windows that are too tight. | S2 §5.2, p.12–13; S7 slide 39 | Smooth the switch. Choose γ carefully. Final TAA. |
| **Fireflies** | Rare high-energy paths. | S9 (ReLAX lists firefly suppression as an improvement) | Method not public for ReLAX. Generic: clamp outliers in a pre-pass (S10 says the pre-blur "fixes outliers"). |
| **Correlated ReSTIR input fools moment-based variance** | Spatiotemporal sample reuse. | S11 §1 p.2; S9 §6.3 | Spatial reuse dithers correlation (S9). MCMC mutations (S11). Shorter history and smaller blur with ReSTIR (S10). |
| **Aliased sub-pixel geometry** stops filtering | Edge-stopping rejects every neighbor. | S1 §6 "Highly Aliased Primary Rays", p.11 | None. |
| **Stochastic primary effects** (DOF, motion blur, stochastic transparency) | The variance proxy needs a noise-free G-buffer. | S1 §6 p.11; S2 §5.4 | Texture-space filtering (Munkberg et al. 2016, cited in S2). |
| **A-SVGF false history drops** | The light list or sampling changes between frames. | S2 §5.4 p.14 | Keep the sample space coherent. Store light indices with the seeds. |

---

## 6. Implementation notes for WGSL / WebGPU

These are my recommendations, derived from the sources above and from WebGPU's format rules. They are not taken from NRD.

### 6.1 Per-pixel buffers (per denoised signal, e.g. diffuse and specular, or direct and indirect)

| Buffer | Contents | Suggested format | Lifetime |
|---|---|---|---|
| Noisy input | demodulated RGB | `rgba16float` | per frame |
| Integrated color (curr/prev ping-pong) | RGB + history length in A (S3 stores n in the alpha of the accumulated color) | `rgba16float` ×2 | persistent |
| Moments (curr/prev) | m1, m2 of luminance | `rg32float` ×2. **Not fp16**: m2 = l² overflows fp16 above l ≈ 256, and HDR radiance can get there. | persistent |
| History length (if not packed) | n (≤ 64; S3 uses `r16float`) | pack into an alpha channel, or `r32float` ×2 (`r16float` as a storage target needs `texture-formats-tier1`) | persistent |
| Color history for feedback | output of à-trous iteration 0 | `rgba16float` | persistent |
| À-trous ping/pong | RGB + variance in A | `rgba16float` ×2 (S3 uses `RGBA16F`). Variance can be tiny: consider `rgba32float` if precision artifacts show up. | per frame |
| *(fast-history design)* fast color + fast moments | RGB, m1, m2, n_fast | `rgba16float` + `rg32float`, ×2 each | persistent |

Shared G-buffer (current + previous frame):

- Linear depth + its screen derivative: `rg32float` (S3 packs z and dz together).
- Normal: octahedral in `rg16float`/`rgba16float`. Note `rg16float` isn't a core *storage* format (see 6.3).
- Mesh/instance ID: `r32uint`.
- Motion vectors: `rg16float`.
- Albedo for demodulation: `rgba8unorm` or `rgba16float`.

A-SVGF extras:

- RNG seed per pixel: `r32uint`, persistent.
- Previous frame's unfiltered shading luminance: `r32float`.
- Visibility buffer (triangle ID + barycentrics), current and previous.
- Gradient tile index at 1/3 res: `r32uint`, written with atomics. In WebGPU, atomics need a storage *buffer*, so use an `array<atomic<u32>>`.
- Two gradient ping-pong pairs at 1/9 the pixel count: `rgba32float` (S3).

Rough size at 1920×1080 (2.07 Mpx), for the SVGF set above with moments at 8 B, color at 8 B and both ping-ponged: on the order of 60–70 B/px per signal, so about 130–145 MB for one signal, ×2 for diffuse+specular. That is before the shared G-buffer. Packing (n in alpha, ping-pong reuse across signals) cuts this a lot.

### 6.2 Pass count per frame (per signal)

1. Temporal accumulation: 1 compute dispatch. Writes color, moments, n, and the fast history if used.
2. Variance estimation: 1 dispatch. It's branchy: the 5×5/7×7 spatial path runs only where n < 4.
3. À-trous: **5 dispatches**, steps 1, 2, 4, 8, 16. Copy iteration 0's output to the history (or write it directly to the history texture as a second output). Fuse albedo remodulation into the last iteration.
4. *(A-SVGF)* +1 forward-projection pass (scatter with atomics) before shading, +1 gradient-creation pass, +5 small à-trous passes at 1/3 res.
5. *(Optional)* final TAA, as in S1.

Totals: 7 dispatches per signal for plain SVGF, about 14 with A-SVGF. Diffuse and specular can share dispatches by processing both signals in one shader. That halves the dispatch count and shares the G-buffer loads.

### 6.3 WebGPU and WGSL specifics

- **No derivatives in compute.** `dpdx`/`fwidth` exist only in fragment shaders. Either write `dz` (or the depth plane gradient) into the G-buffer during the raster pass, as S3 does, or rebuild it from neighbors in compute.
- **Float32 textures aren't filterable by default** (they need the optional `float32-filterable` feature). SVGF's bilinear history read is manual anyway: 4 `textureLoad`s, each consistency-tested and then renormalized (S1 p.5). So `rg32float` moments are fine.
- **Core storage-texture formats** include `rgba8unorm`, `rgba16float`, `rgba32float`, `rg32float`, `r32float` and `r32uint`, but **not** `r16float`, `rg16float`, `r8unorm` or `rg8unorm`, which need the optional `texture-formats-tier1` feature. Plan write targets around the core list, or check for the feature.
  - Read-write storage textures in core are limited to `r32float`, `r32uint` and `r32sint`. Use ping-pong textures rather than in-place updates.
- **Large à-trous steps** (8, 16 px) make workgroup shared-memory tiling unattractive. Plain `textureLoad` gather per tap is simplest. Iteration 0 (step 1) could use a shared-memory tile.
- **Atomics for gradient strata:** use `atomicCompareExchangeWeak` or `atomicMax` on a storage buffer to let one sample win per stratum (S2 p.7).
- **NaN guards:** S3 zeroes NaN weights and clamps variance at ≥ 0. Do the same.

---

## 7. Parameter quick reference (as published)

| Parameter | Value | Source |
|---|---|---|
| Temporal α (SVGF) | 0.2 | S1 p.5 |
| Temporal α (A-SVGF base) | 0.1 | S2 p.10 |
| Bilinear history taps / fallback | 2×2, then 3×3 | S1 p.5 |
| Spatial-variance threshold | history < 4 frames | S1 p.5; S3 |
| Spatial variance kernel | 7×7 bilateral (depth + normal) | S1 p.5 (S3: 7×7 at n ≤ 1, 5×5 otherwise) |
| à-trous levels / kernel | 5, B3 5×5 (65×65 effective) | S1 p.5 |
| A-SVGF à-trous kernel | 5 levels, 3×3 box (49×49) | S2 p.9 |
| σ_z, σ_n, σ_l | 1, 128, 4 | S1 p.5 |
| Variance prefilter for w_l | 3×3 Gaussian | S1 p.6 |
| History source for feedback | à-trous iteration 0 output | S1 p.5 |
| Gradient strata | 3×3 (≤ 11% of samples) | S2 p.7, p.12 |
| Gradient filter | 5 à-trous iterations at stratum res | S2 p.7–8 |
| α safety max | over 3×3 neighborhood | S2 p.9 |
| History length cap | 64 | S3 (also "up to 64 frames" in S10 slide 12) |
| Variance clip γ | ≈ 1 typical | S7 slide 25 |
| TRMV history clamp | µ ± 3σ | S6 p.7 |
| BMFR accumulation | cumulative mean until weight < 20%, then 20% EMA (and 10% for the second accumulation pass) | S5 p.4–5 |

---

## 8. Confidence notes

- **High.** Everything in sections 2–3 attributed to S1/S2: I read it directly from the authors' preprints, with page references.
- **High.** The S3 constants. I read them from the authors' BSD-3 code. Caveats:
  - S3 is a 2018 *reimplementation* and differs from the 2017 paper in places (Gaussian vs. linear luminance weight, depth scale, no 3×3 fallback, moments α of 0.6). Those differences are marked as such.
  - Two apparent bugs in S3 are flagged (section 2.2 and section 3.3); don't reproduce them.
- **Medium.** The ReLAX facts in 4.1. Each is a short NVIDIA statement (book chapter, research paper, course slides, glossary), but none goes into algorithmic detail.
  - Item 7 (pre-blur / linear-weight accumulation / blur) may describe ReBLUR more than ReLAX.
- **Low.** The ReLAX vs. ReBLUR memory/speed figure (forum quote of the README, unverified) and the NRD 2.0 announcement wording (search snippet only).
- **Design synthesis, not fact.** Section 4.2, the "fast history" design, is my own construction from S7, S6, S5 and S3 plus the one-line S8 description. It should be validated by experiment, not treated as a description of ReLAX.
- **Estimates.** The memory figures in 6.1 are rough estimates.

## 9. Provenance and exposure notes

- **No NRD or NRD-Sample code** (or any fork/port) was opened, fetched or searched. No NRD README content was read: my one attempt to fetch the README's prose was blocked by the session's permission system before any content came back.
- **Patents.** One web-search result summary, generated by the search tool, paraphrased an NVIDIA patent on history clamping. The paraphrase was roughly: a "fast" history with a higher blend weight sets the clamping window for the normal history. I did not open any patent. Under rule 2, patents aren't design sources. Section 4.2's design is built only from the term "fast history" in S8 and the open literature cited there, but reviewers should know I saw that sentence.
- **Avoided as contamination risks:** deepwiki's NRD page (generated from NRD code) and third-party blogs.
- **Falcor:** I read only the license file. Its NRD integration is off limits; only its SVGF pass could be consulted.
- **Copies:** PDFs and the A-SVGF zip are in the session scratchpad (`/private/tmp/claude-502/.../scratchpad/rt-research/svgf/`), not in the repository. If S3-derived constants end up in shipped code, the BSD-3 notice (Copyright 2018 Christoph Schied) must be kept, and PROVENANCE.md should cite S3.

### Worth fetching next

- The GTC 2021 ReLAX talk (S13) video or slides. This is the single most valuable missing source.
- The NRD README prose sections on ReLAX, read by someone permitted to fetch it, quoting prose only.
- Mara et al., "An Efficient Denoising Algorithm for Global Illumination" (HPG 2017): separate diffuse/glossy reprojection.
- Ray Tracing Gems ch. 19 (Liu et al., UE4 denoisers) and EA SEED's PICA PICA talks for other public temporal-clamping practice.
