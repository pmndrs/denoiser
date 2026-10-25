# Public research 2022–2026: real-time denoising after RTG II

_2026-10-25. Research agent (RULES.md rule 8: researcher; no NRD code, README, release notes,
UPDATE.md, NRD-Sample or ports). Local copies: `/Users/dex/Developer/rt-denoiser-sources/public-2022-2026/`
(outside the repo; see its README for files and licenses). Companion: [nrd-releases.md](nrd-releases.md)
says **what** NRD changed since 2021 (release auditor, rule 3b). This file collects **how** other
people describe doing the same jobs, from public talks and papers._

**Why this exists.** Our design inputs stop at 2021 (RTG II ch. 49, Zhdan GTC 2020, SVGF/A-SVGF).
SPEC §0.2 / §12 item 1: our recurrent filter loses to SVGF / A-SVGF on every signal. STATUS: our
shadow denoiser boils on a moving shadow (rotating knot) where FFX stays stable. This report looks
for published ideas since 2021 that bear on those gaps.

**Headline.** NVIDIA has published almost nothing technical about ReBLUR, ReLAX or SIGMA since RTG II
(2021). Its web pages since then are product blurbs, and the technical changes appear only in
release notes (see nrd-releases.md). The useful material comes from **game studios and AMD/EA
research**: Epic (Lumen 2022, MegaLights 2025), Ubisoft (Snowdrop 2024, Assassin's Creed Shadows
2025), id (2025), Striking Distance (2023), AMD (GI-1.0 2022, glossy reflections 2023), EA SEED
(FAST 2024/2025), plus one open-access EGSR paper (Philippi 2023) that gives a principled per-pixel
blend weight. Two findings matter most for us: shipped variance-guided denoisers avoid recurrence
on purpose, and nobody who ships restarts history to zero when the clamp fires.

---

## 1. Sources

Keys are used throughout. "p." = PDF page; "s." = the slide number printed on the slide, where
there is one.

| Key | Citation | License / access |
|---|---|---|
| **ML25** | K. Narkowicz, T. Costa (Epic): *MegaLights: Stochastic Direct Lighting in Unreal Engine 5*. SIGGRAPH 2025 Advances in Real-Time Rendering. https://advances.realtimerendering.com/s2025/content/MegaLights_Stochastic_Direct_Lighting_2025.pdf | Public course download, no license stated. Slides print short code: read it, describe it, don't copy it |
| **ACS25** | L. Leblanc, M. Conte (Ubisoft): *Ray Tracing the World of Assassin's Creed Shadows*. SIGGRAPH 2025 Advances. https://advances.realtimerendering.com/s2025/content/Advances%202025%20-%20Raytracing%20the%20world%20of%20Assassin's%20Creed%20Shadows.pdf | Public, no license stated. Slide 74 points to NRD's README for demodulation: not followed |
| **SD24** | Q. Kuenlin (Ubisoft Massive): *Raytracing in Snowdrop: An Optimized Lighting Pipeline for Consoles* (Avatar: Frontiers of Pandora). GDC 2024. https://media.gdcvault.com/gdc2024/Slides/GDC+slide+presentations/Kuenlib_Quentin_Raytracing_In_Snowdrop.pdf | Public GDC Vault media file, no license stated; prints code (SH packing) |
| **ID25** | T. Sousa (id Software): *Fast as Hell: idTech8 Global Illumination*. SIGGRAPH 2025 Advances. https://advances.realtimerendering.com/s2025/content/SOUSA_SIGGRAPH_2025_Final.pdf | Public, no license stated |
| **HH25** | J. Lempiäinen (HypeHype): *Stochastic Tile-Based Lighting in HypeHype*. SIGGRAPH 2025 Advances. https://advances.realtimerendering.com/s2025/content/s2025_stb_lighting_v1.1_notes.pdf | Public, no license stated |
| **CP23** | J. Jimenez, M. Petersen: *The Rendering of The Callisto Protocol*. SIGGRAPH 2023 Advances. https://advances.realtimerendering.com/s2023/SIGGRAPH2023-Advances-The-Rendering-of-The-Callisto-Protocol-JimenezPetersen.pdf | Public, no license stated |
| **LU22** | D. Wright, K. Narkowicz, P. Kelly (Epic): *Lumen: Real-time Global Illumination in Unreal Engine 5*. SIGGRAPH 2022 Advances. https://advances.realtimerendering.com/s2022/SIGGRAPH2022-Advances-Lumen-Wright%20et%20al.pdf | Public, no license stated |
| **CY23** | P. Kozlowski (NVIDIA), G. De Francesco (CDPR): *Cyberpunk 2077 – Ray Tracing: Overdrive, ReSTIR Integration*. SIGGRAPH 2023 course "A Gentle Introduction to ReSTIR". https://intro-to-restir.cwyman.org/presentations/2023ReSTIR_Course_Cyberpunk_2077_Integration.pdf | Public, © authors. Already S10 in [svgf-relax.md](svgf-relax.md); re-read here for denoising and test-method points |
| **CL22** | P. Clarberg, S. Kallweit, C. Kolb, P. Kozlowski, Y. He, L. Wu, E. Liu (NVIDIA): *Research Advances Toward Real-Time Path Tracing*. GDC / GTC 2022. Page: https://research.nvidia.com/labs/rtr/publication/clarberg2022gdc/ ; slides (.pptx, 681 MB) https://d1qx31qr3h6wln.cloudfront.net/publications/Research%20Advances%20Toward%20Real-Time%20Path%20Tracing%20GTC%202022.pptx | Public, no license stated. Read slide text and speaker notes |
| **GI22** | G. Boissé, S. Meunier, H. de Dinechin, M. Oliver, P. Bartels, K. Eto, T. Harada (AMD): *GI-1.0: A Fast Scalable Two-Level Radiance Caching Scheme for Real-Time Global Illumination*. AMD tech. report 22-10-9831, 2022 (arXiv 2310.19855). https://gpuopen.com/download/GPUOpen2022_GI1_0.pdf | Public, no license stated. Its code (Capsaicin) was not opened |
| **GR23** | K. Eto, S. Meunier, T. Harada, G. Boissé (AMD): *Real-Time Rendering of Glossy Reflections Using Ray Tracing and Two-Level Radiance Caching*. SIGGRAPH Asia 2023 Technical Communications, doi:10.1145/3610543.3626167. https://gpuopen.com/download/SA2023_RealTimeReflection.pdf | Author copy; © authors, rights licensed to ACM |
| **FAST24** | W. Donnelly, A. Wolfe, J. Bütepage, J. Valdés (EA SEED / Frostbite): *FAST: Filter-Adapted Spatio-Temporal Sampling for Real-Time Rendering*. I3D 2024, PACMCGIT 7(1), doi:10.1145/3651283. https://media.contentapi.ea.com/content/dam/ea/seed/presentations/seed-id3-2024-spatio-temporal-sampling-paper.pdf | Author's version, personal use. Generator and textures: `electronicarts/fastnoise`, **BSD-3** (license checked on its page; not downloaded) |
| **ISF25** | A. Wolfe, W. Donnelly, H. Halén: *Importance-Sampled Filter-Adapted Spatiotemporal Sampling*. JCGT 14(1), 2025. https://jcgt.org/published/0014/01/08/paper.pdf | **CC BY-ND 4.0** |
| **STBN22** | A. Wolfe, N. Morrical, T. Akenine-Möller, R. Ramamoorthi: *Spatiotemporal Blue Noise Masks*. EGSR 2022, doi:10.2312/sr.20221161. https://cseweb.ucsd.edu/~ravir/stbn.pdf | Author copy, © Eurographics. Masks in NVIDIA's STBN SDK repo; its License.txt not read |
| **PH23** | H. Philippi, J. R. Frisvad, H. W. Jensen: *Practical temporal and stereoscopic filtering for real-time ray tracing*. EGSR 2023, doi:10.2312/sr.20231129. https://diglib.eg.org/bitstream/handle/10.2312/sr20231129/111-118.pdf | Open access, **CC BY** |
| **HTD21** | J. Hanika, L. Tessari, C. Dachsbacher: *Fast temporal reprojection without motion vectors*. JCGT 10(3), 2021. https://cg.ivd.kit.edu/publications/2021/repro_no_motion/2021_no_motion_vectors.pdf | **CC BY-ND 3.0** |
| **OPR26** | H. Jin et al. (Peking University / Huawei): *Occlusion-Point Reuse for Ray-Traced Ambient Occlusion and Shadow*. arXiv 2607.23122, July 2026. https://arxiv.org/pdf/2607.23122 | arXiv preprint, no license stated |
| **DHD24** | R. Dolp, J. Hanika, C. Dachsbacher: *A Fast GPU Schedule For À-Trous Wavelet-Based Denoisers*. I3D 2024, PACMCGIT 7(1) art. 15, doi:10.1145/3651299. Page: https://cg.ivd.kit.edu/english/fast-svgf.php | **Abstract only** (KIT page empty, ACM PDF behind a bot check) |
| **OSC24** | W. Tatzgern et al.: *Radiance Caching with On-Surface Caches for Real-Time GI*. HPG 2024 slides. https://www.highperformancegraphics.org/slides24/hpg24_oscgi.pdf | Public; skimmed |
| **NVWEB** | NVIDIA web pages: RTX Kit / NRD page (https://developer.nvidia.com/rtx/ray-tracing/rt-denoisers); blog "Ray Tracing Updates … NVIDIA Branch of Unreal Engine" (2021-11-09, NRD 2.9); "Ultra-Realism Made Accessible …" (2023-03-20, RTX Path Tracing SDK); "Essential Ray Tracing SDKs …" (2021-04-01); "Leveling Up Graphics …" (2021-04-14, NRD 2.0); "NVIDIA Real-Time Denoiser … Watch Dogs Legion" (2020-10-29, context only); GTC21 session page S32759 (title only) | Public web pages |

Skimmed and dropped as off topic: Frostbite *Shipping Dynamic GI* (SIGGRAPH 2024 Advances, nothing
on denoising); NVIDIA's GDC 2025 show guide (session titles only). Neural denoisers, as context only:
DLSS Ray Reconstruction (2023, replaces the hand-tuned denoisers in Alan Wake 2 and Cyberpunk when
enabled), AMD FSR Redstone "Ray Regeneration" (announced Computex 2025, shipped in Call of Duty: Black
Ops 7, SDK 2.2 in March 2026), Intel's joint neural denoising and supersampling (HPG 2022).

---

## 2. What each source says

### ML25 — MegaLights (Epic, SIGGRAPH 2025)

Stochastic direct lighting for hundreds of shadowed area lights: ~1 ray per pixel, one denoiser for
all lights (2 targets: diffuse, specular). The most relevant 2022–2026 public description of a
shipped, hand-tuned denoiser.

- **Denoiser shape (p.33):** demodulate albedo and EnvBRDF (citing Zhuang et al. 2021), then
  "based on temporal variance like SVGF": a temporal filter, then a spatial filter.
- **Temporal filter (p.34–35):** lighting in 2× R11G11B10F with "stochastic float quantization" (no
  banding vs a 64-bit reference), luminance moments in RGBA16F, values pre-exposed. **5×5
  neighbourhood clamp** (groupshared), variance clipping (Salvi 2016) in YCoCg (Karis 2014).
  - **History confidence from the clamp distance (p.35):** when the history lies outside the
    neighbourhood bounds, confidence = `saturate(1 − |clamp(H) − H| / max(extent, 0.1))` (vector
    length over channels, normalised per channel by the box extent). Confidence **scales the max
    number of accumulated frames down**; "we don't allow it to drop to 0, as we want to blend-in at
    least a few history frames in order to prevent harsh transitions."
  - The clamp is relaxed for pixels reconstructed by the upsampler (less reliable).
- **Spatial filter (p.36):** a **single pass**, sparse kernel rotated per pixel (TSR cleans the
  holes), SVGF edge-stopping (depth, normal, temporal variance). Run **only where variance / lighting
  exceeds a threshold**. Explicitly **non-recurrent**: "run after temporal accumulation into history
  (no recurrent blurring through history), which allows us to make the output sharper and quickly
  converge on the right result as we accumulate more data after disocclusion."
- **Disocclusion (p.36):** for up to 4 frames after a reveal, assume a constant temporal variance,
  increase the spatial sample count, accumulate in **tonemapped space** (Karis 2013) to kill
  fireflies; fade all of it out over those 4 frames.
- **Render vs display resolution (p.37):** the denoiser accumulates at render resolution, the
  upscaler at display resolution, so denoiser history blurs lighting that the upscaler would keep.
  Per-light ratio-estimator denoisers suffer less (only penumbrae). Unsolved; display-res history ~4×
  the cost.
- **Shading confidence (p.38–39):** if the light-list sampling captured most of a pixel's energy
  this frame (e.g. 80 %), reduce history weight and spatial filtering and pass the signal to TSR. It
  cuts specular ghosting "hard to reproject correctly, especially on non-flat surfaces".
- **Sampling for the denoiser (p.11, 16, 19–20):** ReSTIR's repeated samples correlate and "denoisers
  don't like correlation" (citing Bitterli 2022); ReSTIR and a denoiser do similar spatial/temporal
  filtering, so they sample for the denoiser instead. STBN / FAST masks via weighted reservoir
  sampling with sample warping (Ogaki 2021) and dithered sampling (Georgiev 2016), keeping one mask
  value per pixel. 20 % of samples go to "hidden" lights, raised to 50 % where history reprojection
  failed.
- **Cost (p.67):** PS5, 1080p, 1 spp: denoising **0.96 ms** opaque (diffuse + specular), 0.22 ms
  translucency/fog; total direct lighting 5.51 ms.
- **Limits (p.75):** temporal artifacts in fast motion with large lights or many important lights
  per pixel, "usually hidden by the denoiser".

### ACS25 — Assassin's Creed Shadows (Ubisoft, SIGGRAPH 2025)

Ray-traced diffuse and specular GI for a large open world; shipped on consoles.

- **Denoiser (s.58):** "Modular Snowdrop Denoiser (MSD)", "similar to NVIDIA's NRD". The slide's
  pass diagram: pre-filtering → temporal accumulation → history fix → disocclusion filtering →
  filtering ×3 → temporal stabilization. Details not given ("could be a talk on its own").
- **SH (s.57–60):** diffuse traced at quarter resolution, radiance encoded as L1 SH in YCoCg (6
  channels, 8-bit, scaled by a 16-bit max magnitude: 64 bits), denoised, then bilaterally upscaled
  and evaluated per pixel with the full-resolution normal. Hit distance is output and denoised into
  RTAO (s.57).
- **Specular (s.74–78):** split-sum demodulation (error noted at grazing angles); denoising in a
  **compressed space** (a power curve relative to the max radiance; Reinhard "was reducing too much
  the reflection"); a specular-specialised pass with "different reprojection"; firefly removal by
  clamping a pixel's luminance against its neighbours' average in one spatial pass.
- **Production fixes (s.119–123):** material-ID mask to stop translucent/opaque bleeding; shorter
  rays + radiance-cache fallback to cut noise in interiors; **disocclusion: an extra Poisson spatial
  pass with 8/16 samples** for disoccluded pixels (their 2D motion vectors have no depth, so
  validation is hard); vegetation: drop the normal weight, relax temporal reprojection and search 16
  px instead of 4.
- **Cost (s.133–134):** diffuse denoising 2.04 ms PS5 / 1.24 ms PS5 Pro / 0.86 ms RTX 4070 at
  1440p (quarter-res tracing); specular denoising 1.98 / 1.6 ms (half res). "Our current denoising
  costs almost half the pass" (s.137).

### SD24 — Raytracing in Snowdrop (Avatar: Frontiers of Pandora, GDC 2024)

- **Four diffuse denoisers in one engine (p.34):** a tile-wide denoiser (cheapest, noisy in complex
  scenes); **MSD, "based on recurrent blur", shipped with Avatar: "almost as fast as TWD but reduce
  the noise a lot more, at the cost of some more blurriness"**; ReBLUR and ReLAX, "the best in term of
  quality, but also more expensive". For specular, AMD's FidelityFX reflection denoiser too, between
  TWD and MSD (p.52).
- GI lighting encoded to SH and packed in 64 bits (L1 luma in YCoCg-Y, chroma as L0 only; code on
  p.30), denoised with the recurrent blur, upscaled (p.24).
- Reflections demodulated before denoising using RTG I ch. 32 Eq. 4 (p.~45).
- Denoising cost 1.573 ms in their table (p.60; console, GI).

### ID25 — idTech8 GI (id, SIGGRAPH 2025)

- Final gather at ½ or ¼ resolution, 1 ray per pixel, stored as **2-band SH, 3×RGBA16F**, "each
  pixel = irradiance probe" (s.~20, p.22).
- **Denoise (s.21–22, p.23):** separable "bilateral" Gaussian at gather resolution, weights from
  normal/depth **and hit-distance deltas**; 4-tap Poisson bilateral upscale; a temporal filter with a
  per-pixel valid-frame counter, `new = (n·prev + cur)/(n+1)`, `n ← min(n+1, n_max)` (citing
  Mattausch 2010); TAA acts as a second temporal filter. RGB9E5 where supported, "avoid R11G11B10F:
  color shift/banding".
- Denoise 0.18–0.52 ms per platform (p.32).

### HH25 — Stochastic Tile-Based Lighting (HypeHype, SIGGRAPH 2025)

- Wants TAA to be the denoiser. Problem (s.36): **a 3×3 history colour clamp on stochastic lighting
  causes "flashing lighting splotch artifacts"**, because a neighbourhood may not contain the key
  light this frame, shrinking the colour range. Open R&D: "noise-compatible ghosting suppression".
- Stochastic bilinear selection between tiles to avoid tile artifacts before denoising (s.22).

### CP23 — The Callisto Protocol (SIGGRAPH 2023)

- **Ray-traced shadows on all lights**, cost-driven: variance of shadow occlusion after tracing sets
  next frame's **variable trace rate** per tile; "difficult to spot error, denoising will help"
  (p.229).
- **Denoise only where needed (p.261):** UE4's stock shadow denoiser, run on shadowing tiles only,
  skipping culled tiles and tiles with low shadowing variance. With culling, "−89 % denoising cost"
  (p.266).
- **Static/dynamic split (p.223–224):** static-on-static shadowing is baked; a dynamic-only TLAS is
  traced for dynamic casters onto static receivers; runtime tracing only inside the projected
  **caster frustum** of dynamic objects.
- **Reflections (p.317):** IGN noise; a temporal counter since disocclusion, `α = 1 − 1/(t+1)`
  (moving average, not exponential), and a hierarchical blur whose size shrinks with time since
  disocclusion.

### LU22 — Lumen (Epic, SIGGRAPH 2022)

- Screen-space denoising (SVGF) was rejected for diffuse GI: it needs decorrelated rays, is
  expensive at screen resolution, and is poor in disocclusions (p.~150).
- **Full-res temporal filter (p.166–167):** neighbourhood clamp avoided (jittered probes need
  stability), history rejected by depth/normal only, which gives **ghosting behind moving objects**.
  Fix: **"faster temporal accumulation when traces hit fast moving object"**, i.e. pixels whose
  lighting mostly comes from fast-moving objects accumulate faster; and the shortest-range occlusion
  (16 px) is applied **after** the temporal filter "so it won't have any lag".
- **Reflections (p.175–181):** VNDF rays → spatial reuse (neighbours reweighted by BRDF, Stachowiak
  2015/2018) → temporal accumulation → bilateral filter only where variance after spatial reuse is
  high, at double strength in disoccluded areas, with tonemapped weights to remove fireflies.

### CY23 — Cyberpunk 2077 RT Overdrive / ReSTIR (SIGGRAPH 2023 course)

- "Simplified layout of NRD radiance denoisers" (p.12): pre-blur "uses constant radius, pass is
  needed to fix outliers"; temporal accumulation with linear weights, up to 64 frames (input
  parameter); a spatial blur "guided by various things depending on the exact denoiser".
- With ReSTIR (p.14): skip the pre-blur, make the denoiser "more conservative": **shorter history,
  smaller final blur radius**.
- **Test method (p.15, 17, 26):** validation modes that change parameters rather than code (e.g.
  spatial reuse radius 0 instead of removing the pass); a "semi-reference" accumulated over 1000s of
  frames; "test scenes are simpler than the final product", keep ratios such as candidates per light
  so results transfer.

### CL22 — Research Advances Toward Real-Time Path Tracing (NVIDIA, GDC/GTC 2022)

- A unified path tracer + **path decomposition** in a resolve pass: diffuse, specular, delta
  reflection, delta transmission, residual, each denoised separately with NRD kernels, DLSS last
  (slides 32–39).
- **Guide paths:** noise-free guide/demodulation buffers for delta chains come from up to 2 extra
  cheap paths that follow ideal reflection/refraction to the first non-delta hit (slides 40–43).
  Without demodulation the result "gets over-blurred" (s.44).
- **Cost (s.24, 46):** RTX 3090, 1080p, 1 spp: NRD denoising 4.1 ms, delta guide paths 1.4 ms,
  DLSS 1.4 ms; 10–20 % path-tracing overhead for denoiser inputs.

### GI22 — AMD GI-1.0 (2022)

- Screen probes + hash-grid world cache. Temporal gradients (A-SVGF) are "not trivial to compute,
  nor [do they] help when the input signal is overly noisy" (p.2).
- **Biased shadow-preserving temporal hysteresis (p.4, Algorithm 3), after Lottes 2015:** the blend
  factor depends on the normalised difference between new and old radiance and is **asymmetric**: a
  sample darker than the history is taken quickly, a brighter one slowly (keeps occlusion and shadow
  detail, and suppresses fireflies, at the cost of some darkening). An exponential moving average lost
  visible fidelity.
- Disocclusion holes: reassign probes from tiles that reprojected well; mip-based masking (p.4–5).

### GR23 — AMD glossy reflections (SIGGRAPH Asia 2023)

- Denoise + upscale with an à-trous whose holes are replaced by **sums of truncated Gaussians**,
  weights = sampling PDF × tangent-plane distance × hole function; jitter for 4 iterations at 5×5
  footprint (p.3).
- **Dual-source temporal reprojection (p.4, after Stachowiak 2018):** reproject both the surface
  point and the hit point, blend the two reprojected colours by their brightness difference to the
  current colour, clamp to the current neighbourhood (mean/variance from the à-trous).
- **Cleanup before temporal (p.4):** fireflies found by counting brighter neighbours (after Mara
  2017) and replaced by a 3×3 bilateral of unmarked neighbours; missing reflections filled the same
  way. "Cleanup is important for using the dual-source temporal reprojection … or clamping
  reprojected colors will introduce noise."
- Denoise + upscale 0.46–0.96 ms at 1080p, RX 7900 XTX (Table 1, p.4).

### PH23 — Philippi, Frisvad, Jensen (EGSR 2023)

- **Optimal per-pixel blend weight (p.2, Eq. 4):** for history X and current Y,
  `α' = 1 − σ_Y² / (Bias² + σ_X² + σ_Y²) = 1 − σ_Y² / E[(X − Y)²]`. With no bias it reduces to
  `1/N` (progressive averaging, Eq. 6); bias from a constant rate of change δ grows as `δ/α` (Eq. 9).
- **Estimators (p.4, Eq. 10–11):** `σ_Y²` from 3×3 raw moments of the current frame (as in variance
  clipping); `E[(X − Y)²]` as the mean of `(X_hist − Y_i)²` over the same 3×3. Used in TAA, it
  replaces keep-or-discard history validation and "naturally captures disocclusions, resampling blur
  and temporal lag" without G-buffer or velocity heuristics.
- Caveat (p.2): "works well in low noise scenarios"; for high noise they point to A-SVGF.
- ~0.3–1.5 ms (their TAA) at the resolutions tested.

### FAST24, ISF25, STBN22 — sampling for the denoiser (EA SEED, NVIDIA)

- STBN22 (p.1, §5.3): blue noise over space **and** time; under an EMA (α = 0.1) it converges faster
  and is more stable than 2D blue noise animated per frame (golden ratio). With TAA motion, history
  migrates between pixels but spatial benefit stays.
- FAST24 (p.1): masks optimised for the **actual** filters, e.g. a 5×5 box + EMA, beat STBN, which
  assumes Gaussian filters; mismatch shows as blocky artifacts. **Randomly truncated EMA (p.8, Eq.
  16–17):** history rejection is modelled as a per-pixel probability β per frame, so the masks also
  look good in pixels with short histories (paper uses α = 0.1, β = 0.1).
- ISF25: the same for arbitrary importance-sampled distributions.

### HTD21 — reprojection without motion vectors (JCGT 2021)

- Hierarchical patch-based correspondence gives motion where analytic vectors don't exist (moving
  glass, reflections), at TAA-like cost. A tool for shadow and reflection motion, untested by us.

### OPR26 — occlusion-point reuse (arXiv 2026)

- Reuse neighbours' **first-hit occluder points** (not their visibility values) for AO and area-light
  shadows, combined with MIS; biased variants assume local first-hit occluder consistency (p.1).
  Better shadows than light-sample reuse at equal cost; compared with SVGF without its temporal part,
  SVGF is smoother but deviates more from the reference (p.7). An input-side (pre-denoiser) technique.

### DHD24 — fast à-trous schedule (I3D 2024, abstract only)

- À-trous gets slower per iteration as the dilation grows (cache misses). Reordering invocation
  indices so each iteration reads **undilated** neighbours gives **1.3–3.8×** for common wavelet
  configurations (abstract, KIT library record).

### NVWEB — NVIDIA's own public statements since 2021

- NRD 2.0 (Apr 2021): ReLAX added for RTXDI signals. NRD 2.9 (Nov 2021): AO / SO denoisers, ReLAX
  diffuse-only / specular-only. RTX Path Tracing SDK (Mar 2023) lists NRD "for high-performance
  denoising of all light sources". RTX Kit page: ReBLUR (diffuse + specular), ReLAX (RTXDI signals),
  SIGMA (shadows), one line each.
- No NVIDIA talk, paper or blog since RTG II describes how any of the three denoisers works.

---

## 3. What's new since 2021, by topic

Each item: what was published, sources, and how it maps onto our gaps (SPEC §12; recurrent vs SVGF;
moving-shadow boiling).

### 3.1 Diffuse / specular temporal accumulation

- **Variance-guided, non-recurrent is what Epic ships (ML25 p.33–36).** Temporal accumulation with
  moments, then one spatial pass after accumulation that does not feed back, so outputs stay sharp
  and converge quickly after disocclusion. → **Recurrent vs SVGF:** this is independent support for
  SPEC §12 item 1 option (a). Our measurement (recurrent −0.9 dB vs A-SVGF, weaker in disocclusions,
  11 vs 5 frames to recover) matches the reason Epic gives.
- **Recurrent blur is shipped as the cheap option (SD24 p.34; ACS25 s.58).** Ubisoft's MSD is a
  recurrent design "similar to NRD" (pre-filter, temporal, history fix, disocclusion filter, 3
  filters, stabilization). Their own ranking: MSD cheap but blurrier, ReBLUR/ReLAX best but more
  expensive. → No public source shows a recurrent blur beating variance-guided filtering on
  quality without NVIDIA's unpublished details. Keep recurrent as the memory/cost option (§12 item 4).
- **Linear 1/(n+1) counters with a cap, plus TAA as a second temporal filter** (ID25 s.21; CP23
  p.317). Already ours.
- **With ReSTIR input, shorten history and shrink the final blur; drop the pre-blur** (CY23 p.14).
  → Matters only if ReSTIR input arrives (PLAN non-goal for now).

### 3.2 Specular reprojection

- **Dual-source reprojection blended by brightness difference + neighbourhood clamp** (GR23 p.4).
  A cheaper relative of our surface/virtual blend (SPEC §5.6). Note the prerequisite: firefly and
  missing-sample cleanup **before** the temporal step, or the clamp injects noise. → Our recurrent
  specular already has a virtual candidate with a validity test; the cleanup-before-clamp point
  applies to our A-SVGF specular (the current best, 35.04 dB).
- **Energy-based "shading confidence"** (ML25 p.38–39): where this frame's samples captured most of
  the energy, trust the current frame and filter less. → Not directly ours (no light lists), but the
  idea generalises: a renderer-known "this sample is nearly exact" signal can lower history weight
  on specular highlights.
- **Compressed denoising space for specular** (ACS25 s.76) and **firefly clamp against the
  neighbour average** (ACS25 s.78); **tonemapped weights** (LU22 p.181, ML25 p.36). → We have an
  anti-firefly (D9); a compressed-space variant is untested.
- **Path decomposition + delta guide paths** (CL22 s.33–43). → For a future three.js path tracer
  input: mirror/glass paths need their own guide buffers or they over-blur.
- **Motion without motion vectors** (HTD21). → Candidate for reflections on curved surfaces, where
  our virtual motion smears (LESSONS), but cost in WebGPU unknown.
- NRD's release notes claim many specular-tracking fixes (nrd-releases.md T7–T10, T13); none has a
  public "how".

### 3.3 Disocclusion and history repair

- **Fresh pixels get more spatial samples, tonemapped accumulation, a constant-variance assumption,
  faded out over 4 frames** (ML25 p.36). → Close to our shadows' `youngMean` (SPEC §7.4); the
  fade-out over frames is what our "A = 0 only" rule lacks (LESSONS: a trick switched off abruptly on
  frame 2 made frame 2 worse than frame 1).
- **An extra Poisson pass (8/16 samples) only on disoccluded pixels** (ACS25 s.122); **bilateral at
  double strength on disocclusions** (LU22 p.181); **blur size tied to time since disocclusion**
  (CP23 p.317). → All variants of the same cheap idea; our SVGF already boosts variance at low
  history.
- Vegetation: drop the normal weight, widen the reprojection search (ACS25 s.123). → Relevant to
  the `thin` path / T12.

### 3.4 Anti-lag and reactivity

- **History confidence = 1 − normalised distance of the history to the clamp box; it scales the max
  accumulated frames, never to zero** (ML25 p.35). → **Directly relevant to the moving-shadow
  boiling** (see §3.5).
- **Optimal blend weight from bias² vs variance** (PH23 Eq. 4, 10–11): continuous instead of
  keep-or-restart. Caveat: designed for low noise; on 1-spp it needs the 5×5 (or blurred) moments we
  already have.
- **Asymmetric hysteresis: accept darkening fast, brightening slowly** (GI22 Algorithm 3). → For
  shadows, a moving occluder darkens the leading edge and brightens the trailing edge; asymmetric
  accumulation would keep new shadow crisp and let the trailing edge fade, and it doubles as firefly
  suppression. Biased (darkens); untested.
- **Renderer-side flags beat image-space detection where available:** Lumen speeds up accumulation
  for pixels whose rays hit fast-moving objects (LU22 p.167); Callisto knows where dynamic shadows can
  be (caster-frustum masks, dynamic-only TLAS, CP23 p.223–224); NRD's notes call a user-supplied
  history confidence "essential for responsive dynamic lighting" in v4.17.0 (nrd-releases.md, "what"
  only). A-SVGF's gradients (2018) remain the published image-space version.
- **Tight clamps on stochastic input flash** (HH25 s.36). Same failure class as ours (§3.5).

### 3.5 Moving shadows and shadow history

Our shadow temporal step (SPEC §7.4): a 5×5 clamp with window `0.4σ + 0.05`, and an anti-lag that
**restarts `A_hist` at 0** when the clamp moves the history by ≥ 1/64 (gain 64), plus a per-pixel cap
`W_px²`. On a moving occluder the clamp fires across the whole moving penumbra every frame, so those
pixels live at A ≈ 0–1 and the output is close to a spatially filtered 1-spp frame: boiling. FFX
keeps an EMA with a ±0.5σ clamp and no restart, so it lags but stays stable. The public material
points to these fixes:

1. **Never restart to zero; reduce the frame cap in proportion to the clamp distance, with a floor
   of a few frames** (ML25 p.35). Our own LESSONS already found the floor rule for the recurrent
   anti-lag ("shorten A to A_fast, not 0"); shadows went the other way (restart at 0 measured +0.9 dB
   on frozen-occluder paths). Re-screen with the moving-knot metric.
2. **Continuous α from bias vs noise** (PH23): a clamp displacement that the 5×5 noise explains keeps
   accumulating; only a displacement above the noise shortens history.
3. **Move the history with the shadow** instead of rejecting it: shadow motion vectors (TRMV, 2021,
   already S6 in svgf-relax.md); HTD21's correspondence search as a renderer-free alternative.
4. **Tell the denoiser where shadows can move** (renderer cooperation): a per-pixel "occluder is
   dynamic" bit from the shadow ray's hit (LU22's moving-object rule applied to shadow rays), or a
   caster-frustum mask (CP23). Then fast accumulation applies only there, and static penumbrae keep
   long histories.
5. **Asymmetric response** (GI22): darkening fast, brightening slow.
6. **Sample patterns tuned for short, randomly truncated histories** (FAST24, β > 0) so the young
   pixels that a moving shadow keeps producing show less low-frequency noise.
7. **Cheapen rather than sharpen:** trace and denoise only where shadow variance is high
   (CP23 p.229, 261), which leaves budget for a second spatial pass in moving penumbrae.

None of the 2022–2026 sources describes SIGMA or any shadow denoiser's temporal logic in detail; the
above are adjacent techniques. nrd-releases.md lists the moving-occluder scenario (T1) as one NRD
claims to have improved (v2.5.0, v4.10.0, v4.11.0, v4.18.0), which supports using native SIGMA on a
moving-knot capture as the comparison.

### 3.6 Occlusion (AO / SO)

- **Denoised hit distance → RTAO** on the same rays (ACS25 s.57). Our O-1 / O-2.
- **Apply the shortest-range occlusion after the temporal filter so it has no lag** (LU22 p.167).
  → For AO on moving geometry: a cheap short-range term outside the history.
- **Occluder-point reuse** improves AO/shadow input before denoising (OPR26).
- FAST24's own demo is RTAO under a 5×5 box + EMA.

### 3.7 SH / SG (directional) payloads

- **L1 SH in YCoCg, chroma as L0 only (6 channels), packed in 64 bits with a shared max magnitude**
  (SD24 p.30; ACS25 s.57–59), denoised by a recurrent blur, upscaled and evaluated per pixel with the
  full-resolution normal. **2-band SH in 3×RGBA16F, each pixel an irradiance probe** (ID25 s.~20).
  → A concrete, public recipe for M7 (SPEC §8.5 "not specified"): carry Y's 4 coefficients + CoCg
  through our filters, weights from Y's L0. Note: the SD24 slide prints Ubisoft's encoding code,
  license unstated: implement from the description.
- NRD added SH variants (2022) and an SG resolve / re-jitter for upscalers (nrd-releases.md); no
  public "how".

### 3.8 Performance tricks

- **Spatial filtering only where relative variance is high; one rotated sparse pass instead of
  à-trous** (ML25 p.36). → Could cut our SVGF's 5-level à-trous cost (4.00–4.23 ms joint vs the 4 ms
  guide, §12 item 3).
- **À-trous with undilated access order: 1.3–3.8×** (DHD24, abstract). → Same target; worth
  fetching the paper.
- **Denoise only active tiles, skip low-variance tiles** (CP23 p.261: −89 % cost). → Our shadows
  already tile; the variance gate is new.
- **Memory:** R11G11B10F lighting with stochastic float quantization + RGBA16F moments (ML25 p.34)
  vs RGB9E5 "avoid R11G11B10F" (ID25 s.22). → Relevant to the 100 B/px target (§12 item 4):
  ~4 B lighting + 8 B moments per signal per history copy, if quantization artefacts stay invisible.
- **Lower-resolution tracing + bilateral upscale with SH** (ACS25, SD24, ID25) is how all three
  console GI talks hit budget.
- Shipped costs for scale: ML25 0.96 ms (PS5 1080p, diffuse + specular); ACS25 0.86–2.04 ms diffuse,
  1.6–1.98 ms specular (1440p); SD24 1.57 ms; ID25 0.18–0.52 ms; GR23 0.46–0.96 ms; CL22 NRD 4.1 ms
  (RTX 3090, 1080p, full path tracer).

### 3.9 Test methodology

- **Semi-reference over 1000s of frames; validation modes by parameters, not code; keep scene
  ratios realistic** (CY23 p.15–26). → Matches SPEC §13; the "test scenes simpler than the product"
  warning matches §12 item 7.
- **Score under the real filter with random history truncation** (FAST24 Eq. 17) rather than only
  converged EMA.
- **Compare quantized histories against a 64-bit reference** (ML25 p.34).
- **Moving-occluder, light-change and fast-motion cases are where shipped systems admit artefacts**
  (ML25 p.75, LU22 p.166, HH25 s.36), consistent with nrd-releases.md T1–T2 and with our missing
  dynamic-shadow metric (M4 §12).

---

## 4. Usable now

Concrete, published techniques an implementer can adopt, with source and caveats. None comes from
NRD; none requires NRD's code.

| # | Technique | Source | Targets | Caveats |
|---|---|---|---|---|
| U1 | **Clamp-distance confidence**: `c = saturate(1 − ‖(clamp(H) − H) / max(extent, ε)‖)`; `A_cap ← lerp(A_floor, A_cap, c)` with `A_floor` = a few frames, **never 0**; replaces the restart-to-0 anti-lag in shadows (and is a variant of our recurrent C-10) | ML25 p.35 (Epic) | moving-shadow boiling | Talk prints Epic code without a license: implement from the description, cite in PROVENANCE. Screen on a moving-occluder capture, not only frozen paths (LESSONS) |
| U2 | **Bias/variance blend weight** `α = 1 − σ_cur² / mean₃ₓ₃((H − Y_i)²)`, clamped to `[1/(A_cap+1), 1]` | PH23 Eq. 4, 10–11 | shadows anti-lag, SVGF α | **CC BY**, free to use. Built for low noise: estimate σ² from the 5×5 we already load, or from the spatially filtered signal |
| U3 | **Fresh-pixel ramp**: for the first N (≈4) frames after a reveal, more spatial taps, tonemapped accumulation, constant-variance assumption, all faded linearly with A | ML25 p.36 | disocclusion (recurrent's weak spot), shadows frame-2 dip | Description only |
| U4 | **Variance-gated single spatial pass** (rotated sparse kernel, SVGF weights) after accumulation, only where `variance / lighting > t` | ML25 p.36 | SVGF cost (§12 item 3) | Relies on a later TAA/upscaler to clean holes; we may not have one in every use |
| U5 | **Dual-source specular reprojection** (surface + hit point, blended by brightness difference, then neighbourhood clamp) with a **firefly/missing-sample cleanup before** it | GR23 p.4 (after Stachowiak 2018); cleanup after Mara 2017 | specular ghosting, A-SVGF specular | © ACM paper: method usable, text not copied |
| U6 | **Asymmetric hysteresis** for shadows/visibility (darker → fast, brighter → slow) | GI22 Alg. 3 (after Lottes 2015) | moving-shadow leading edge, fireflies | Biased (darkens); try as an option |
| U7 | **Renderer "dynamic occluder" bit** from the shadow ray hit, driving faster accumulation only there; optional caster-frustum mask | LU22 p.167; CP23 p.223–224 | moving-shadow boiling without hurting static penumbrae | Needs a `ShadowInputs` addition (API item, SPEC §12 item 8) |
| U8 | **FAST masks** optimised for our actual filters (5×5 box/disk + EMA with truncation β) instead of generic STBN | FAST24; `electronicarts/fastnoise` | young-history noise in all signals | Generator **BSD-3** (usable from its upstream); paper personal-use only. ISF25 (CC BY-ND) for importance-sampled lobes |
| U9 | **L1 SH in YCoCg (4 + 2 channels, 64-bit packed)** through the existing filters, resolved with the full-res normal | SD24 p.30; ACS25 s.57–59; ID25 s.20 | M7 SH/SG (unspecified) | Code on SD24 slides has no license: re-derive (standard SH projection) |
| U10 | **Short-range occlusion after the temporal filter** (no lag) | LU22 p.167 | AO on moving geometry | — |
| U11 | **Variance-gated tiles** (skip denoising where tile variance is low) | CP23 p.261 | shadows cost (0.6 ms target) | — |
| U12 | **À-trous undilated access schedule** | DHD24 | SVGF cost | Abstract only; fetch the paper first |
| U13 | **Test additions**: moving-occluder capture with a dynamic-shadow metric (already planned, M4 §12), randomly truncated-history scoring, 64-bit reference check for any packed history | CY23, FAST24, ML25; nrd-releases.md T1 | methodology | — |

Suggested order for the shadow agent: U1 (and U2 as the alternative), then U7 if the API change is
accepted, then U6/U8. For the default-filter decision (§12 item 1): ML25 and SD24 support option (a);
U4 and U12 are the levers on SVGF's cost.

---

## 5. Not found

- **Any NVIDIA talk, paper or blog since RTG II (2021) that explains ReBLUR, ReLAX or SIGMA.** NVIDIA's
  pages are one-liners; technical changes exist only in release notes (nrd-releases.md).
- **The ReLAX GTC 2021 talk** (Kozlowski, Cheblokov, S32759): the On-Demand page shows a title only;
  no slides on developer.download.nvidia.com.
- **Any public description of SIGMA**, or of any shadow denoiser's temporal logic for moving
  occluders, 2022–2026. Academic: only TRMV (2021, already in svgf-relax.md) and a neural JCAD 2024
  paper (not read).
- **Shipped-game path-tracing talks with denoiser details**: GDC 2023 *Cyberpunk 2077 RT: Overdrive*
  (Kozlowski, Knapik), GDC 2024 *Alan Wake 2: A Deep Dive into Path Tracing* (Sjöholm, Kandar), GDC
  2025 *Path Tracing Deep Dive: Indiana Jones* and *Ray Tracing Inside Black Myth: Wukong*: no public
  slides found (GDC Vault / On-Demand behind accounts). Alan Wake 2 replaces its two denoisers with
  DLSS RR when enabled.
- **Portal with RTX, RTX Remix, Half-Life 2 RTX**: no technical denoising write-up; Remix docs have a
  glossary and settings only.
- **Metro Exodus Enhanced Edition** denoiser talk; **Doom: The Dark Ages / Indiana Jones**
  reflection or shadow denoisers (ID25 covers GI only).
- **Non-neural real-time denoising papers at HPG/EGSR/I3D 2022–2025** beyond PH23, DHD24 and *SVGF for
  Motion Blur* (Oberberger, Chajdas, Westermann, HPG 2022; not read, niche). The field moved to
  neural denoisers and to sampling (ReSTIR, FAST/STBN).
- **DHD24 full text** (bot wall); **AMD FidelityFX denoiser updates** past 1.3 (2023): none.
- **RTXDI's "denoiser confidence" documentation**: deliberately not opened (it lives in the RTXDI
  repo next to its NRD integration).

## 6. Exposure notes (rule 7)

- **NRD README text in a search summary.** One WebSearch (query about RTXDI temporal gradients and
  denoiser confidence) returned a summary that quoted three sentences from NRD's README "History
  confidence" section (off limits, RULES §2): roughly, that confidence inputs are the best way to
  fight temporal lag, that apps should not rely only on the built-in anti-lag, and that gradients
  should be blurred spatially rather than accumulated. I did not open the page and none of it is used
  above; §3.4/§3.5 rely on A-SVGF (2018), LU22, CP23, ML25 and nrd-releases.md instead. **To log in
  PROVENANCE.md** (not my file).
- Search snippets from a news article about NRD 4.18.0 (mixed-news.com) repeated release-note
  facts (time-based accumulation, a SIGMA penumbra flag). Not opened; nrd-releases.md covers them.
- Not opened, by rule or caution: NRD's GitHub (source, README, releases), deepwiki, alain.xyz,
  converter.brightcoding.dev (shows NRD code samples), RTXPT and dxvk-remix (integrate NRD), Falcor's
  NRD pass, RTXDI repo docs, USPTO patents (several on history clamping and shadow denoising surfaced
  in results).
- ACS25 cites NRD's README for demodulation (s.74); the link was not followed.
- No contamination by code.
