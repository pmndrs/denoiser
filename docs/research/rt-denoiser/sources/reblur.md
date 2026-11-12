# ReBLUR and its predecessors: public-source research notes

_Clean-room research note, 2026-10-24. Written only from the public sources listed below,
under [RULES.md](../RULES.md). No NRD / NRD-Sample source, fork, port, mirror, README code
block, or patent was opened. The README prose was not consulted for this note either._

All equations below are restated in our own notation. Where a source gives a number, it is
quoted with its citation. Where we infer something, it is labelled **(inferred)**.

Citation keys:

- **[RTG2]** = Zhdan, *ReBLUR: A Hierarchical Recurrent Denoiser*, Ray Tracing Gems II ch. 49.
  Page numbers are the book's printed page numbers (pp. 823–844).
- **[GTC20]** = Zhdan, *Fast Denoising with Self-Stabilizing Recurrent Blurs*, GTC 2020.
  "s.N" means slide N of the PDF.
- **[METRO]** = Shyshkovtsov, Archard, Karmalsky, Zhdan, *Exploring the Ray Traced Future in
  Metro Exodus*, GTC/GDC 2019. "s.N" means slide N.
- **[FB]** = Lagarde & de Rousiers, *Moving Frostbite to PBR*, SIGGRAPH 2014 course notes v3.2.
  Page numbers are the printed page numbers.
- **[BAV12]** = Bavoil & Andersson, *Stable SSAO in Battlefield 3 with Selective Temporal
  Filtering*, GDC 2012. "s.N" means slide N.

---

## 1. Sources

| Key | Title | Authors | Year | URL | License / access | What it covers |
|---|---|---|---|---|---|---|
| RTG2 | ReBLUR: A Hierarchical Recurrent Denoiser (Ray Tracing Gems II, ch. 49, pp. 823–844) | D. Zhdan (NVIDIA) | 2021 | https://doi.org/10.1007/978-1-4842-7185-8_49 . We got the full-book PDF from the Internet Archive's OAPEN mirror: https://archive.org/details/oapen-20.500.12657-50334 (Springer, OAPEN and realtimerendering.com sit behind bot challenges, which we did not try to get past) | Open access, **CC BY-NC-ND 4.0**. The listings are part of the licensed text: we may read and cite them, but we may not redistribute adapted copies, so our code must not paste them | **Primary source.** Inputs, the 7-pass pipeline, temporal accumulation formula, mip-based history fix, blur and post-blur, temporal stabilization, disocclusion test, diffuse Catmull–Rom reprojection, specular surface vs virtual motion, parallax, accumulation-speed heuristic, virtual-motion confidence, kernel basis, weight shape, anti-lag (briefly), limitations, per-pass timings |
| GTC20 | Fast Denoising with Self-Stabilizing Recurrent Blurs (GTC 2020 s22699; the same talk is listed on GDC Vault as 1026701) | D. Zhdan (NVIDIA) | 2020 | https://developer.download.nvidia.com/video/gputechconf/gtc/2020/presentations/s22699-fast-denoising-with-self-stabilizing-recurrent-blurs.pdf | Public NVIDIA download. No license stated, so the slides are © NVIDIA | Earlier (pre-"ReBLUR" name) version: recurrent-blur rationale, linear accumulation weights, bilinear-with-custom-weights reprojection, history-fix mip selection, sampling-space generalization, geometry/normal/roughness weight formulas, hit-distance radius control, anisotropic kernel, SH diffuse inputs, buffer formats, timings on RTX 20-series |
| METRO | Exploring the Ray Traced Future in Metro Exodus (GTC 2019 s9985 / GDC 2019) | O. Shyshkovtsov, B. Archard, S. Karmalsky (4A Games), D. Zhdan (NVIDIA) | 2019 | https://developer.download.nvidia.com/video/gputechconf/gtc/2019/presentation/s9985-exploring-ray-traced-future-in-metro-exodus.pdf | Public NVIDIA download, © authors | Predecessor GI/AO denoiser: world-space sampling, plane-distance weight, radius heuristics, temporal-before-spatial "recurrent" structure, two-stage GI denoiser, YCoCg+SH irradiance encoding and its precision needs |
| FB | Moving Frostbite to Physically Based Rendering 3.0 (course notes v3.2), pp. 68–69, 72 | S. Lagarde, C. de Rousiers | 2014 | https://seblagarde.files.wordpress.com/2015/07/course_notes_moving_frostbite_to_pbr_v32.pdf | Public course notes | GGX specular dominant direction fits (the 0.298475 / 39.4115 / 10.8649 fit, plus a simpler fit) and the NDF bounding-cone angle as a function of energy fraction E. Both RTG2 and GTC20 cite these |
| BAV12 | Stable SSAO in Battlefield 3 with Selective Temporal Filtering, s.37–39 | L. Bavoil, J. Andersson | 2012 | https://developer.nvidia.com/sites/default/files/akamai/gamedev/files/gdc12/GDC12_Bavoil_Stable_SSAO_In_BF3_With_STF.pdf | Public NVIDIA download | Origin of the per-pixel accumulated-frame counter with linear (1/(N+1)) weights and a cap; GTC20 s.20 cites it |
| (cited, not read) | Rank conditioned rank selection filters for signal restoration (IEEE TIP 3(2)) | R. Hardie, K. Barner | 1994 | DOI 10.1109/83.277900 | Paywalled | RTG2 cites it as the basis of the anti-firefly filter. **Not read**, so §7 lists the anti-firefly details as unspecified |
| (cited, not read) | An Excursion in Temporal Supersampling (GDC 2016) | M. Salvi | 2016 | Dropbox link in RTG2 ref [5] | Public slides | Variance colour clipping, which RTG2 names as the model for temporal stabilization. **Not fetched**; we rely on the general, well-known technique (clamp history to mean ± γσ of the neighbourhood) |
| (cited) | Sampling the GGX Distribution of Visible Normals (JCGT 7(4)) | E. Heitz | 2018 | http://jcgt.org/published/0007/04/01/paper.pdf | Open | Recommended specular ray sampling (VNDF). GTC20 s.11 and s.39 mention "trimming" the lobe |
| (cited) | Rendering Perfect Reflections and Refractions in Path-Traced Games (NVIDIA blog) | A. Panteleev | 2020 | https://developer.nvidia.com/blog/rendering-perfect-reflections-and-refractions-in-path-traced-games/ | Public | Primary Surface Replacement. RTG2 p.826 says a viewZ-only input can't support it |
| (cited) | SVGF (HPG 2017) | C. Schied et al. | 2017 | DOI 10.1145/3105762.3105770 | ACM | Comparison point (à-trous filtering). RTG2 future work |
| NRDPAGE | NVIDIA Real-Time Denoisers product page | NVIDIA | n.d. | https://developer.nvidia.com/nrd | Public | Marketing level only: ReBLUR handles diffuse and specular, SIGMA handles shadows, ReLAX handles RTXDI signals. Nothing algorithmic |
| NVBLOG | "What Is Denoising?" | J. Kim (NVIDIA blog) | 2022 | https://blogs.nvidia.com/blog/what-is-denoising/ | Public | One line: ReBLUR is "based on the idea of self-stabilizing, recurrent blurring". Nothing algorithmic |

**Search results we did not open, because they are NRD source or derived from it:**
github.com/NVIDIA-RTX/NRD (and its releases page), github.com/xiaohunqupo/RayTracingDenoiser (a
fork), github.com/dust-engine/NVIDIA_RayTracingDenoiser (a port), deepwiki.com/NVIDIA-RTX/NRD (an
AI summary generated from the source), and a cnblogs.com "NRD 剖析" (NRD analysis) post that
appears to walk through the source. Several patents also came up in search results (e.g.
"Denoising techniques suitable for recurrent blurs"). We did not open them, per the rules.
**No contamination occurred.**

---

## 2. Inputs and outputs

### 2.1 Per-pixel inputs (RTG2 p.826; GTC20 s.50, s.56)

| Input | Meaning / encoding | Units | Source |
|---|---|---|---|
| `n` | World-space surface normal | unit vector | RTG2 p.826. GTC20 s.50/56 packs it in RGBA8, with roughness for specular |
| `viewZ` | Linearized view depth, used to rebuild the primary-hit position | view-space units (world units along the view axis) | RTG2 p.826 and Listing 49-1 (p.827). GTC20 s.50: R32F |
| `roughness` | **Linear** (perceptual) roughness. GGX α = m = roughness² | [0,1] | RTG2 p.825–826. GTC20 s.9 |
| motion vector | **World-space 3D surface motion**: Xprev = X + mv | world units | RTG2 p.826. GTC20 s.50/56 allows "2D or 3D (RG16f or RGBA16f)" |
| `c_diffuse` | Noisy diffuse **radiance**, with material (albedo/BRDF) removed | HDR radiance | RTG2 p.826 and §49.12 (p.842). GTC20 s.11: inputs are radiance only, and diffuse and specular must be separate |
| `c_specular` | Noisy specular radiance, material removed | HDR radiance | as above |
| `hitT` | Hit distance (ray length). It sets the spatial filter radius and drives specular (virtual-motion) reprojection | world units (see below) | RTG2 p.826 |

Notes on the inputs:

- **Position reconstruction.** The view-space position comes from screen uv and viewZ:
  p.xy = (uv · frustum.zw + frustum.xy) · viewZ, and p.z = viewZ. Orthographic projection has its
  own branch (RTG2 Listing 49-1, p.827). World position X is **camera-relative** (RTG2 p.825).
- **Primary Surface Replacement can't be supported from viewZ alone.** It would need an explicit
  per-pixel world position (RTG2 p.826).
- **Hit-distance normalization.** GTC20 s.9 defines a "normalized hit distance" =
  saturate(hitT / maxHitT). Logically this is AO for diffuse and SO (specular occlusion) for
  specular. GTC20 stores it in the alpha channel next to the radiance: diffuse "SH.c1, AO" and
  specular "radiance and SO" (s.50, s.56). It is then denoised for free with the same weights
  (s.54, s.63). **How maxHitT is chosen is not stated** (see §7). RTG2 only says "hitT" and that
  hit distance is itself denoised (p.837).
- **Ray budget.** The design target is about 1 rpp diffuse and 0.5 rpp specular (RTG2 Fig. 49-1,
  p.824; Fig. 49-2 also uses 0.5 rpp). Checkerboarded half-resolution input is supported
  (RTG2 p.828, p.832).
- **Sampling quality.** Better inputs denoise better: cosine or importance-sampled diffuse, and
  VNDF-sampled specular (GTC20 s.11).
- **Diffuse in SH (GTC20 version).** Diffuse came in as spherical harmonics: two RGBA16F textures,
  "SH.c1, AO" and "SH.c0, chroma, viewZ(fp16)" (s.50). SH preserves normal-map detail at extra
  cost (s.53). The Metro encoding was luma as L1 SH (4×FP16) plus CoCg (2×FP16) = 96 bits per
  pixel. 64 bits "failed" because recurrent accumulation needs the precision (METRO s.40–41).
  **RTG2 does not mention SH at all.** We treat SH as an optional variant.

### 2.2 Outputs

- Denoised diffuse and/or specular radiance, plus the denoised normalized hit distance (AO/SO)
  in alpha, in the same layout as the input (GTC20 s.50, s.56). The final output is the
  temporal-stabilization result (RTG2 Fig. 49-3, p.827; §49.5.7, pp.830–831).
- Three variants: diffuse-only, specular-only, and combined (RTG2 p.842).
- Material (BRDF, albedo) is applied **after** denoising (RTG2 §49.12, p.842).

---

## 3. Pass-by-pass pipeline

Diffuse and specular share one pipeline (RTG2 §49.5, p.827, Fig. 49-3):

```
pre-blur → temporal accumulation → mip generation → history fix → blur → post-blur ──► (history for next frame)
                                                                                  └──► temporal stabilization ──► output
```

Notation used below:
A is the accumulated-frame count. α(A) = 1/(1+A). X is the camera-relative world position.
d̂ = normalize(X) points from the camera to the surface, and v = −d̂ is the view vector pointing
out of the surface. r is linear roughness, NoV = |n·v|, h is the hit distance, and lerp(a,b,t) = a + t(b−a).

### Pass 1: Pre-blur

- **Purpose.** Fix outliers by *redistributing* their energy over neighbours where the spatial
  weights allow. Outliers are not suppressed (RTG2 §49.5.1, p.827). GTC20 s.52 says pre-blur blurs
  out pixels whose radiance changed a lot compared with the reprojected previous frame.
- **Radius.** "Uses constant radius" (RTG2 Fig. 49-3, p.827; GTC20 s.51). The value isn't given.
- **Sampling.** Same Poisson-disk cross-bilateral blur as the other blur passes, but with a
  *statically* defined disk, not per-pixel rotated (RTG2 §49.5.5, p.830).
- **Checkerboard.** If the pixel centre falls on an empty checkerboard cell, it is rebuilt from the
  left and right neighbours with a bilateral filter. If a spatial *sample* lands on an empty cell,
  it is shifted left or right "in a consecutive order" (RTG2 p.828).
- **Hit distance.** GTC20 s.60 says hit distance is "denoised in all passes except pre-blur". So
  pre-blur works with the raw hit distance, or doesn't filter it.
- In: noisy radiance + hitT, G-buffer. Out: pre-blurred radiance + hitT.

### Pass 2: Temporal accumulation

**Core formula (linear weights)** (RTG2 Eq. 49.1, p.828; GTC20 s.25–26):

  C_out = lerp(H, C_in, 1/(1+A))

where H is the reprojected history and C_in is the pre-blurred input. Since α = 1/(1+A), this is an
exact running mean of the last A+1 frames (proof in GTC20 s.26). It avoids exponential weights, which
have only "two speeds", slow and reset (GTC20 s.25). This idea goes back to BAV12 s.39:
AO_i = (N·AO_{i−1} + AO_i)/(N+1), and N = min(N+1, N_max), reset to 1 on disocclusion.

**Frame count.** A is incremented, or set to 0 on disocclusion (RTG2 §49.5.2, p.828). It is capped:
"up to 64 frames can be accumulated (input parameter)" (RTG2 Fig. 49-3). GTC20 said "up to 32"
(s.51) and suggested 5 < MAX_FRAME_NUM < 32 (s.20). RTG2 Listing 49-4 gives MAX_ACCUM_FRAME_NUM = 32–64.
A is reprojected like the colour, with the same custom-weighted bilinear filter, as min(A_prev + 1, A_max)
(GTC20 s.30). In GTC20 s.20 it is stored normalized: (A/A_max) in [0,1].

**Disocclusion test** (RTG2 §49.6, p.831, Listing 49-2 p.832; GTC20 s.30). For each of the 4 texels i
in the previous frame's 2×2 bilinear footprint at uv_prev:

1. Build the plane through Xprev = X + mv with normal n.
2. Rebuild the previous-frame point along that texel's ray from its stored prevViewZ_i.
3. Measure that point's distance to the plane, divided by the distance from the camera to the point.
4. The texel is valid if the relative distance is below a threshold "around 0.5–1.5%".

In our notation:
  q = max(|Xprev·n|, |Xprev·n_prev|) / ‖X‖
  z_p = view-space depth of Xprev in the previous view
  δ_i = | (q / |z_p|) · |prevViewZ_i| − q |
  valid_i = δ_i < τ, with τ ≈ 0.005–0.015, or τ = −1 if Xprev is off-screen

The max over current and previous normals, and averaging n and n_prev over the 2×2 footprint,
"worked better for silhouettes". Geometric normals help slightly, but matter less once normals are
averaged. The test suits sub-pixel-jittered input (RTG2 p.831).

Texels with backfacing normals are also rejected: plane distance ≈ 0 but opposite orientation
(RTG2 p.832).

**Bilinear with custom weights** (GTC20 s.27–30; RTG2 p.832). Each of the 4 bilinear weights is
multiplied by a per-texel validity (0/1) and the result is renormalized. With all weights equal to 1
this is ordinary bilinear filtering. With binary weights it is a 2×2 bilateral filter that prevents
ghosting (GTC20 s.29).

**Diffuse reprojection** (RTG2 §49.7, pp.831–832).
- Use bicubic **Catmull–Rom** to avoid blurring under slow motion, and only if the whole **4×4**
  footprint passes the disocclusion test. Otherwise fall back to the custom-weighted 2×2 bilinear.
- If **at least one** footprint sample is valid, A += 1. Otherwise A = 0.
- The final checkerboard resolve also happens here.

**Specular reprojection.** There are two history candidates, surface motion and virtual motion,
blended with the same α formula (RTG2 §49.8, pp.832–839). The math is in §4.2.

- **No variance clamping here.** Clamping isn't done in temporal accumulation, because pre-blur
  doesn't make the signal clean enough and high local variance rules out wide clamps
  (RTG2 p.834, first paragraph). Virtually reprojected history gets an *optional* clamp scaled by
  confidence (see §4.2).
- **Hit-distance history.** It is accumulated alongside, with its own cap on the frame count,
  `maxHitDistAccumulatedFrameNum` (value not given) (RTG2 Listing 49-8 lines 10–13 and 49–52).
- In: pre-blurred signal, the previous **post-blur** output (the recurrent history), A_prev,
  previous viewZ/normal/roughness, motion. Out: accumulated signal, A, and for specular the
  virtual-motion "amount" and confidence. Stabilization uses these later (RTG2 p.831).

### Pass 3: Mip generation

- Build the first four mip levels of the accumulated diffuse, specular and viewZ by
  **averaging**, in **one pass using shared memory** (RTG2 §49.5.3, p.828; Fig. 49-3).
- The count is inconsistent: Fig. 49-3 says "first 3 mip levels" (probably the levels below the
  base), the text says "first four mip levels", and GTC20 s.51 says "first 4 mips". GTC20 s.32–35
  used mips 0–4 (5 levels).
- Mip k stands in for 4^k "virtual" rays per pixel over a 2^k × 2^k tile (RTG2 table p.828;
  GTC20 s.32).

### Pass 4: History fix (hierarchical history reconstruction)

**Purpose.** In regions where history was just discarded, only the raw ~1 rpp signal exists.
Instead of a very wide spatial blur, borrow from coarser mips: a coarse mip is a higher-rpp,
lower-resolution estimate (RTG2 §49.5.4, pp.828–829; GTC20 s.31–36).

**Start level.** It depends on the frame count and roughness. GTC20 s.35 gives:

  L = floor( L_max · (1 − saturate(A / A_fix)) · r ), with L_max = 4

The pass does nothing when A ≥ A_fix. A_fix is `MAX_FRAME_NUM_WITH_HISTORY_FIX`, value not given.
RTG2 says the coarse level "depends on the roughness of the specular signals" and that full
reconstruction lasts 1–3 frames, depending on roughness, and only in newly visible regions (p.829).

**Filter.**
- RTG2 (p.829): a **3×3 cross-bilateral** filter on level L. Each tap's weight compares the real
  base-level viewZ of the pixel with the interpolated viewZ_mip of that tap.
- If the weight sum is "close to zero", drop to the next finer level and repeat, until the sum
  passes a threshold. The text literally says "until the sum of weights is less than a threshold",
  which reads inverted; the intent is to stop once the sum is large enough.
- **Only viewZ weights.** Normal and roughness weights are skipped for performance (p.829).
- GTC20 s.35 version: bilinear weights on mip L times bilateral viewZ weights
  (`UPSAMPLING_VIEWZ_SENSITIVITY`, value not given). It writes back into mip 0 of the same resource.
- **Convergence over frames** (GTC20 s.35):

  | Frame after reset | Mip used | Real pixels touched |
  |---|---|---|
  | 0 | 4 | 32×32 |
  | 1 | 3 | 16×16 |
  | 2 | 2 | 8×8 |

  Each frame's result re-enters the feedback loop (GTC20 s.35; RTG2 p.829).

**Also in this pass** (RTG2 p.830):
- **Variance-based colour clamping**, toward a *faster* history with fewer accumulated frames, to
  improve response time.
- **Anti-firefly filtering** based on Rank Conditioned Rank Selection [Hardie & Barner 1994].
- Neither is parameterized in the public text.

In: accumulated signal + mips, viewZ + mips, A. Out: fixed accumulated signal.

### Pass 5: Blur (main spatial pass)

- **Kernel.** Cross-bilateral with **8 Poisson-disk samples** (RTG2 p.830, §49.10 p.840;
  GTC20 s.16). The low count is a quality/performance balance. GTC20 s.16's argument: at 30 fps,
  8 × 30 = 240 effective samples per second, thanks to recurrence.
- **Per-pixel rotation.** This is the only pass with a per-pixel *rotated* disk. The rotation
  comes from an **animated-in-time 4×4 Bayer** pattern, computed with ALU only (no texture
  lookups) (RTG2 p.830).
- **Radius.** A function of A, roughness and hit distance, capped by a user-set max radius
  (RTG2 p.830). From GTC20:
  - Frame-count scale: radiusScale = 1/(1+A). Largest right after disocclusion, smallest near
    A_max (s.20, s.22).
  - Hit-distance scale: f = h/(h + ‖X_v‖), radius *= lerp(K·r, 1, f), with K a constant in (0,1).
    Reflections of nearby geometry are sharper (s.60).
  - The exact composition isn't published (see §7).
- **Sampling plane.** World space (§4.3).
- **Weights.** Geometry × normal × roughness × hit-distance (§4.4).
- In: the history-fixed signal. Out: the blurred signal.

### Pass 6: Post-blur

- Same as Blur, but the radius is **also scaled by the difference between the Blur output and
  the Temporal Accumulation output** (RTG2 §49.5.6, p.830). The purpose is to limit "colour
  divergence" from recurrent blurring.
- GTC20 s.51 calls it the "intensity delta between reprojected history and the final value".
  The scaling function isn't given.
- **The post-blur output is the history buffer for the next frame.** This is the recurrent loop
  (RTG2 p.830; §49.3 p.825).

### Pass 7: Temporal stabilization

- A TAA-like pass with **its own history**, which "never goes to the temporal feedback loop"
  (RTG2 §49.5.7, pp.830–831). Logically it is temporal supersampling with variance clamping (Salvi).
  It "uses wider variance clamping if possible" and adds no extra lag (RTG2 Fig. 49-3; GTC20 s.51).
- **Specular** uses both reprojections again. The blend factor between them (the "amount" of
  virtual motion) comes from temporal accumulation (RTG2 p.831).
- It also **does anti-lag** (§5.3).
- GTC20 s.63 calls it a "must have" for specular.
- GTC20 s.59 lists the specular pipeline with stabilization *before* post-blur. RTG2's figure has
  post-blur before stabilization. We follow RTG2, and the GTC20 order may be a slide-layout
  artefact.
- In: post-blur output, the stabilization history, A, and the reprojection data. Out: final output
  and the new stabilization history.

### Per-pass cost (RTG2 §49.13, p.842)

Combined diffuse+specular at 2560×1440 on RTX 3090:

| Pass | Time (ms) |
|---|---|
| Pre-blur | 0.48 |
| Temporal accumulation | 0.59 |
| Mip generation | 0.10 |
| History fix | 0.30 |
| Blur | 0.40 |
| Post-blur | 0.44 |
| Temporal stabilization | 0.41 |
| **Total** | **2.72** |

GTC20 s.13 (marked "preliminary") gives older numbers on RTX 2060/2080/2080 Ti. For example,
on a 2080 at 1440p: diffuse 2.48 ms, specular 2.08 ms, sun shadow 0.60 ms.

---

## 4. Math details by topic

### 4.1 Specular dominant direction (RTG2 Listing 49-5, p.836; FB pp.68–69; GTC20 s.39)

The dominant direction is D = normalize(lerp(n, r_refl, F)), where r_refl = reflect(−v, n).

- **RTG2 fit:** F(NoV, r) = saturate( (1−NoV)^10.8649 · (1−a) + a ), with
  a = 0.298475 · ln(39.4115 − 39.0029·r). This is FB's "accurate" fit for correlated Smith G
  (FB Listing 21).
- **GTC20 (s.39):** uses FB's *simpler* fit, F = (1−r)·(sqrt(1−r) + r).
- **Ambiguity:** FB's `roughness` in these listings is GGX α. RTG2/GTC20 feed it *linear*
  roughness. Pick one convention deliberately and test it.

### 4.2 Specular history: surface motion vs virtual motion (RTG2 §49.8, pp.832–839)

**Parallax** (RTG2 Listing 49-3, p.833; Fig. 49-5):
- Definition: π = tan(∠(V, V_prev)) · 60, where V = normalize(X), V_prev = normalize(Xprev − Δcam),
  and Δcam is the camera translation. The ×60 normalizes to 60 fps, optionally.
- π = 0 for pure camera rotation (RTG2 p.833).
- GTC20 s.57 used a different form: ‖X − (Xprev − Δcam)‖ / (dist · frameTime).
- Parallax is used two ways: larger parallax → faster accumulation, and larger parallax → more
  clamping (RTG2 p.833).

**Maximum frame count for surface-motion reprojection** (RTG2 Listing 49-4, p.834):

  c = (1 − NoV)^κ
  b = 1.1 + r²
  S = (b + c)/(b − c)
  A_spec(r, NoV, π) = M · (1 − 2^(−200 r²)) · r^( P · (1 + π·S) )
  A_surf = min(A_spec, A)

| Parameter | Stated value | Meaning |
|---|---|---|
| M (max frames) | 32–64 | Cap on accumulated frames |
| P (base power) | 0.5–1.0 | Larger = less aggressive accumulation |
| κ (accum curve) | 1.0 = low, 0.66 = medium, 0.5 = high | How aggressively history is rejected at glancing angles. A "reference" mode uses 0.5 |

GTC20 s.58 had an earlier form: b = 1.001 + r², no (1 − 2^(−200r²)) term, and the same structure.

The design intent: fewer frames for low roughness, for grazing angles (Fresnel doesn't follow the
surface), and for high parallax (RTG2 p.834).

Surface-motion candidate:

  C_surf = lerp(H_surf, C_in, α(A_surf))

The hit distance h is accumulated the same way, with A capped at A_hmax = `maxHitDistAccumulatedFrameNum`
(RTG2 p.835 steps 1–4; Listing 49-8 lines 1–13).

**Virtual position** (RTG2 p.835, Listing 49-6 p.836):

  X_virt = X + d̂ · h̃ · F(NoV, r)

Here h̃ is the *surface-accumulated* hit distance, and d̂ points from the camera through X. This
is the reflected-image point behind the surface. With F = 1 it is exact for mirrors only. F → 0
pulls it back to the surface for rough lobes (Fig. 49-7). The previous-frame uv comes from
projecting X_virt with the previous view-projection. Plain bilinear is used here (Listing 49-8
line 20), not custom-weighted.

**Virtual-motion confidence** (RTG2 Listing 49-7, p.837):

  c_v = inScreen(uv_virt) · w_n(r, n, n_prev,virt) · w_r(r, r_prev,virt) · w_h

  w_h = smoothstep(t_max, t_min, Δ)
  Δ = |h_virt − h| / (max(h_virt, h) + viewZ)
  t_min = 0.02 · smoothstep(0.2, 0.01, π)
  t_max = lerp(0.01, 0.25, r²) + t_min

- w_n and w_r: RTG2 doesn't define them here. The GTC20 forms (§4.4) are the obvious candidates.
- Confidence is used two ways: it controls how hard virtual history is variance-clamped, and low
  confidence speeds up accumulation (RTG2 p.837).

**Amount of virtual motion** (RTG2 p.837, Listing 49-8 lines 29–31):

  m = F(NoV, r) · inScreen(uv_virt) · [optional w_n]

**Combined specular accumulation** (RTG2 Listing 49-8, pp.838–839):

1. Clamp the virtual history: H_virt ← lerp( clamp_var(H_virt), H_virt, lerp(c_v, 1, r²) ).
2. Frame count for virtual motion, with no parallax penalty: A_v0 = min(A_spec(r, NoV, 0), A).
3. A_min = min(A_v0, K_mip · sqrt(r)), with K_mip = "MIP_NUM" = 3–4.
4. α_v = lerp(α(A_min), α(A_v0), c_v), then A_virt = 1/α_v − 1.
5. Virtual candidate: C_virt = lerp(H_virt, C_in, α(A_virt)). Hit distance uses min(A_virt, A_hmax).
6. Blend the candidates: C = lerp(C_surf, C_virt, m).
7. Frame count for the next frame: α_next = lerp(α(A_surf), α(A_virt), m), then A_next = 1/α_next − 1.
   Blending happens in α-space, not A-space.

**Curvature.** Virtual motion is exact only for flat reflectors. Local curvature "can be used to
solve the lens equation" to correct X_virt and/or m (RTG2 p.837). Not specified.

**Hit-distance denoising for confidence.** Raw hitT is too noisy, so the input hitT is mixed with a
fast-accumulated, parallax-corrected, surface-reprojected hit distance (RTG2 p.837).

### 4.3 Sampling space / kernel basis (RTG2 §49.9, pp.839–840, Listing 49-9; GTC20 s.38–41, s.62; METRO s.56)

- **World-space kernel.** The Poisson-disk offsets lie on a plane through X, and each sample is
  projected to the screen to fetch its data. Screen-space kernels waste samples on thin objects and
  at glancing angles (METRO s.56).
- **Diffuse.** The plane is the tangent plane of n (RTG2 p.839). Diffuse is the roughness = 1 case
  of the general model (RTG2 p.842).
- **Specular.** The plane is perpendicular to the **reflected dominant direction**
  D' = reflect(−D, n) (GTC20 s.40; RTG2 Fig. 49-9). This generalizes "blur in the screen plane" for
  mirrors and "blur in the tangent plane" for diffuse (GTC20 s.38).
- **Basis** (RTG2 Listing 49-9):
  - If n·D < 0.999 and r ≠ 1: T = normalize(n × D'), B = D' × T, and T *= lerp(1, r, sqrt(1 − NoV)).
    This is anisotropic "specular elongation" at grazing angles.
  - Otherwise: any orthonormal tangent frame of n.
  - Scale T and B by the world radius (GTC20 s.40).
- **GTC20 s.62 variant.** The skew is applied progressively: T *= lerp(1, skew, A_norm). If
  accumulation goes badly, the kernel goes back toward isotropic in world space.
- **Edge case.** n × D' degenerates when n = D' (GTC20 s.40 notes this).

### 4.4 Sample weights (RTG2 §49.10, pp.840–841; GTC20 s.43–48; METRO s.58–60)

**Total weight** (RTG2 Eq. 49.2):

  w_sample = w_geometry · w_normal · w_roughness · w_hitDist

w_roughness applies to specular only.

**Generic shape** (RTG2 Eq. 49.3):

  w(x) = smoothstep(0, 1, saturate(1 − |a·x + b|))

a normalizes and b shifts. Most a, b depend on A and "become more strict over time" (RTG2 p.841).
**The a, b values are not published.**

**Geometry weight.** Based on the distance of sample p from the centre's tangent plane {X, n},
not a viewZ comparison. Plane distance doesn't reject valid samples at grazing angles
(GTC20 s.44; METRO s.59, which also says to use the absolute value).

  GTC20 s.45: w = saturate(1 − |n·(p − X)| · k),  k = A_factor / (1 + viewZ_center)

**Normal weight.** Reject when the angle between normals exceeds the specular lobe half-angle θ_0,
which narrows over time.

  GTC20 s.46: θ_0 = θ_lobe(r) · g(A) + 0.5°
              w = linearstep(θ_0, 0, acos(n·n_s))

g(A) → 0 "if accumulation goes well". Its form isn't given.

Three versions of θ_lobe appear in the sources. They disagree, so we have to choose:

| Source | Formula for θ_lobe | Notes |
|---|---|---|
| GTC20 s.46–47 | 90° · m/(1+m), with m = r² | Example on the slide: r = 1 → 45° |
| RTG2 p.841 | atan( m · E/(1−E) ), with m = r², E = 0.75 | |
| FB p.72 | atan( E·α²/(1−E) ) | Notation for α is unclear. Our own derivation from the GGX CDF gives atan(α·sqrt(E/(1−E))) |

METRO s.60 warns against pow(n·n, 8) normal weights.

**Roughness weight** (GTC20 s.48):

  w = saturate( 1 − |r_0 − r_s| / (0.99·r_0² + 0.01) )

**Hit-distance weight.** Avoids over-blurring where hit distance varies a lot, such as contact
vs far reflections (RTG2 p.841). The formula isn't given.

**Metro predecessor.** It put the distance falloff into the sample distribution (quadratic, denser
near the centre) and used a step function as the weight, which reduced noise (METRO s.58).

---

## 5. History management

### 5.1 History length and accumulation speed
- A per-pixel frame count A, with linear weights α = 1/(1+A) (RTG2 Eq. 49.1; GTC20 s.26; BAV12 s.39).
- Cap: 64 per RTG2 Fig. 49-3, or 32–64 per Listing 49-4. It is a user input parameter.
- For specular, the allowed A also depends on roughness, NoV, parallax and virtual confidence
  (§4.2).
- The spatial radius shrinks as A grows: 1/(1+A) (GTC20 s.20–23).
- The normal-weight angle and the other weight parameters tighten as A grows (RTG2 p.841;
  GTC20 s.46).

### 5.2 Disocclusion detection
- Plane-distance test on the 2×2 previous footprint, with relative threshold 0.5–1.5% (§3, Pass 2).
- Off-screen counts as occluded. Backfacing samples are rejected.
- Catmull–Rom needs a fully valid 4×4 footprint.
- If no sample is valid, A is set to 0 (RTG2 §49.6–49.7, pp.831–832).
- Metro rejected history on any out-of-screen sample or z-occlusion (METRO s.68).

### 5.3 Anti-lag / history reset (RTG2 §49.11, pp.841–842; §49.5.7)
- It runs in temporal stabilization. It compares the "slow" history (temporal accumulation) with the
  "even slower" stabilization history, *before* the latter is clamped to the current frame.
- There are two kinds: **hit-distance-based** and **intensity-based**.
- If the relative delta is high, A is **reduced**, and accumulation continues from the reduced
  value next frame.
- **Thresholds, the delta metric, and the reduction formula are not published.**
- Separately, the history-fix pass clamps toward a faster history (RTG2 p.830).
- For specular, low virtual confidence speeds up accumulation (RTG2 p.837).
- GTC20 s.54 warns that chaining temporal accumulations makes lag hard to tune.

### 5.4 Hierarchical (mip) reconstruction of missing history
See Pass 3 and Pass 4. Mips of the accumulated signal and viewZ are rebuilt with depth-aware
weights, from a coarse level (depends on A and roughness) toward mip 0. It converges in 1–3 frames
because each result goes back into the recurrent loop (RTG2 pp.828–829; GTC20 s.31–36).

### 5.5 What "recurrent" means here
The **post-blur output** is next frame's history. Blur output is fed back into temporal
accumulation, which spreads spatial filtering over time and allows few samples per pass
(RTG2 §49.3 p.825; GTC20 s.15–19).

The predecessor in METRO s.64–71 had the same idea:
- Temporal accumulation came *before* each denoiser, and the denoised output was fed back.
- The GI version chained two blocks: TA → denoiser #1 (no normal weight, base radius 6 m) →
  combiner → TA → denoiser #2 (normal weight, base radius 3 m).
- Each "combiner" mixed denoised and noisy signal: lerp(denoised, input, 0.5·accumSpeed), with
  accumSpeed = 0.93 when there is no motion (s.67). It "helps to preserve tiny details" (s.69).
- The radius was BaseRadius · F(viewZ) · F(variance) · F(AO) (s.62).
- Up to 32 Poisson samples per pass, with an adaptive stride (s.67). AO used up to 64 samples,
  2 pixels per thread (s.65).
- Metro rotated the kernel per frame, not per pixel. Per-pixel rotation cost 2–5× (s.61).
  ReBLUR later chose per-pixel ALU-only Bayer rotation, but only in the Blur pass.

---

## 6. Diffuse vs specular; occlusion-only variants

| Aspect | Diffuse | Specular |
|---|---|---|
| Reprojection | Surface motion. Catmull–Rom, or custom 2×2 bilinear as fallback (RTG2 p.831) | Surface motion **and** virtual motion, blended by m = F(NoV, r) (RTG2 §49.8) |
| Accumulation cap | A_max | min(A, A_spec(r, NoV, π)), adjusted by virtual confidence (§4.2) |
| Kernel plane | Tangent plane of n | Plane ⟂ reflected dominant direction, skewed at grazing angles (§4.3) |
| Weights | geometry, normal, hit distance | adds roughness weight. The normal cutoff uses the lobe half-angle (§4.4) |
| History fix start mip | Coarsest (r = 1) | Scales with roughness. Mirrors start near mip 0 (GTC20 s.35) |
| Radius vs hit distance | Uses hitT (RTG2 p.830) | Shrinks for short hits on glossy surfaces: lerp(K·r, 1, h/(h+d)) (GTC20 s.60) |
| Stabilization | Plain reprojection | Two reprojections, using m from TA (RTG2 p.831) |

**Occlusion-only variants:**
- The public material only says that the normalized hit distance (AO for diffuse, SO for specular)
  is carried in the alpha channel and denoised "for free" with no extra logic (GTC20 s.9, s.54,
  s.63).
- GTC20 s.63 suggests "SO only" denoising as a cheap IBL-visibility solution.
- RTG2's history-fix illustration uses AO (Fig. 49-4, p.829).
- No dedicated occlusion-only pipeline, directional-occlusion variant, or SH variant is described in
  RTG2. Shadow denoising (SIGMA) is a separate denoiser and out of scope here.
- **Inferred:** an occlusion-only mode is the same pipeline with a 1-channel signal and no radiance.

---

## 7. Unspecified or ambiguous in the public sources (we must design these)

1. **Pre-blur radius.** Only "constant radius" is stated. The value, and whether it scales with
   viewZ or hitT, aren't given.
2. **Blur/post-blur radius.** The exact formula combining A, roughness, hitT, viewZ, and the
   user max-radius isn't given. Neither is the default max radius, or the post-blur scaling
   function of |blur − TA|.
3. **Poisson disk.** The 8 sample positions aren't given. Neither is the exact 4×4 Bayer
   animation (how the rotation advances per frame).
4. **Weights.**
   - The (a, b) parameters of Eq. 49.3 for each weight, and how they tighten with A.
   - The hit-distance weight formula.
   - g(A) in the normal weight.
   - The geometry weight's A_factor.
   - The three θ_lobe formulas conflict (§4.4).
   - Linear roughness vs α in the dominant-direction fit (§4.1).
5. **Hit distance.**
   - How maxHitT is chosen for normalization. Constant? Scaled by viewZ or roughness?
   - The A_hmax cap.
   - How hit distance is denoised in each pass.
   - "Mixes input hitT with surface-based parallax-corrected reprojection" isn't defined further.
6. **Disocclusion.**
   - The exact threshold within 0.5–1.5%.
   - Whether Xprev must be expressed relative to the *previous* camera for the q/|z_p| plane
     construction. Listing 49-2 mixes camera-relative X with a previous-view transform, so the
     frame of reference needs care.
   - How the 4×4 Catmull–Rom validity is evaluated: 4 × 2×2 tests, or a dilated mask?
7. **History fix.**
   - A_fix (`MAX_FRAME_NUM_WITH_HISTORY_FIX`).
   - The viewZ sensitivity.
   - The weight-sum threshold.
   - 3×3 (RTG2) vs 2×2 bilinear (GTC20) footprint.
   - Mip count (4 vs 5 levels).
   - Whether the specular start mip uses r or something else.
8. **Variance clamping.**
   - Neighbourhood size and γ (σ multiplier) in history fix and stabilization.
   - What "wider clamping if possible" means.
   - What the "faster history" in history fix is: a second accumulation buffer with a smaller cap?
9. **Anti-firefly (RCRS).** Neighbourhood, rank thresholds, and which channel (luma?) the ranks use.
10. **Temporal stabilization.** Its accumulation speed or cap, and how it uses A.
11. **Anti-lag.**
    - The delta metric (relative luminance?).
    - Thresholds.
    - How much A is reduced.
    - How the hit-distance and intensity variants combine.
12. **Virtual motion.**
    - w_n and w_r inside the confidence term.
    - The clamp operator clamp_var.
    - The curvature / lens-equation correction (mentioned only).
    - Whether A passed to A_spec is pre- or post-increment.
13. **Checkerboard.** Which cells are valid on which frame, and the resolve details.
14. **Storage of A.** GTC20 hints it is stored normalized. The precision and format aren't given.
15. **Specular pass order.** GTC20 s.59 puts stabilization before post-blur. RTG2 doesn't.
16. **Motion vectors.** RTG2 wants world-space 3D. GTC20 allows 2D. 2D can't give Xprev for the
    plane test without extra data.

---

## 8. Implementation notes for WGSL / WebGPU (our analysis, not from the sources)

**Pass count.**
- 7 compute dispatches per frame for the combined diffuse+specular variant. Diffuse and specular
  are processed in the same dispatch, as the RTG2 timing table implies.
- Possibly +1 if we split hit-distance preparation or a classification/tiling pass.
- An occlusion-only variant has the same pass count with thinner data.

**Formats.**
- Radiance histories need **at least rgba16float**. Metro's experience says 64-bit encodings fail
  under recurrent accumulation (METRO s.41). rgba16float is a core write-only storage format.
- ViewZ: r32float (GTC20 s.50).
- Normal + roughness: rgba8unorm or rgb10a2. Our renderer can provide better.
- A (frame count): r8unorm normalized, or r16float. r8unorm/r16float as *storage* textures need
  the `texture-formats-tier1` feature. Without it, pack A into a spare channel or use r32float.

**Read-write.**
- History fix updates mip 0 in place in GTC20 (s.35).
- Core WebGPU allows `read_write` storage access only for r32float/r32sint/r32uint. rgba16float
  read-write needs `texture-formats-tier2`.
- Plan: **ping-pong textures**. Read via `texture_2d` (textureLoad/textureGather) and write via
  write-only storage textures.

**Mip generation in one pass.**
- Workgroup shared memory for the 2×2 → 4×4 → 8×8 reductions (e.g., an 8×8 or 16×16 workgroup).
- Each written mip level is a separate storage-texture binding. Diffuse + specular + viewZ × 3
  levels = 9 storage textures.
- That exceeds the default `maxStorageTexturesPerShaderStage` = 4 (many adapters expose 8).
  Options:
  - request a higher limit;
  - pack diffuse and specular, or move viewZ into a channel;
  - split into 2–3 dispatches;
  - write mips to a storage buffer.
- Different mips of one texture are different subresources, so sampling mip k while writing
  mip k+1 in the same dispatch is allowed.

**Gathers.**
- The custom-weighted bilinear needs the 4 texels individually: textureGather per channel
  (4 gathers for RGBA) or 4 textureLoads.
- Catmull–Rom needs a 4×4 validity test, so the usual 5- or 9-tap bilinear trick can't skip the
  validity loads.

**No atomics or subgroups needed** for anything described. Subgroups could speed up the mip
reduction and the variance/RCRS neighbourhood stats. Make them optional.

**Workgroup tiles.** The 3×3 or larger neighbourhood ops (variance clamp, RCRS, history fix) suit
shared-memory tiles with a 1–2 pixel apron.

**Memory per pixel** (estimate for the combined variant, rgba16float = 8 B):

| Group | Contents | Bytes |
|---|---|---|
| Persistent | Recurrent history (post-blur out) ×2 signals | 16 |
| | Stabilization history ×2 signals | 16 |
| | A_diff, A_spec, plus spec "amount"/confidence | ~4 |
| | Previous viewZ, previous normal+roughness | 8 |
| Transient (aliased ping-pong) | ~2 × 8 B per signal | ~32 |
| | Mips 1–3 (≈ 1/3 of base) for 2 signals + viewZ | ~7 |
| **Internal total** | | **~80–90** |

- That is about 300–330 MB at 2560×1440. Without aliasing it could be double.
- Inputs are extra: about 32 B/pixel for normal+roughness, viewZ, 3D motion and two radiance+hitT
  textures.
- The SH diffuse variant adds about 8 B per diffuse texture (2 × rgba16float instead of 1).

**Precision.** Do the A ↔ α conversions (1/α − 1) in f32. Guard α = 0 and A = 0.

**Licence hygiene.** RTG2 is CC BY-NC-ND and the GTC20 slides are © NVIDIA. Re-derive the math in
our own code. Don't paste listing code.

---

## 9. Confidence

**Well documented** (explicit text, formula or listing in RTG2, sometimes also in GTC20):
- pipeline order and the purpose of each pass;
- linear 1/(1+A) accumulation;
- the frame cap (32–64);
- plane-distance disocclusion with a 0.5–1.5% threshold;
- custom-weighted bilinear and Catmull–Rom fallback;
- the parallax definition;
- the specular accumulation-speed heuristic, with parameter ranges;
- virtual position and the dominant-direction factor;
- the virtual-confidence hit-distance term, with constants;
- the full surface/virtual blending procedure;
- kernel basis construction;
- the generic weight shape;
- 8-tap Poisson disk with Bayer rotation in the Blur pass;
- mip-based history fix (concept and the viewZ-only weights);
- per-pass timings.

**Partially documented** (concept stated, constants partly or only in the older GTC20 talk):
- radius scaling with A and hit distance;
- geometry, normal and roughness weight formulas (GTC20; RTG2's may differ);
- history-fix mip selection;
- hit-distance normalization as AO/SO;
- SH diffuse inputs.

**Only named, design is ours:**
- anti-lag (delta metric, thresholds, reduction);
- post-blur radius scaling;
- variance-clamp parameters;
- the RCRS anti-firefly;
- temporal stabilization speed;
- hit-distance denoising;
- the hit-distance weight;
- curvature correction;
- checkerboard details;
- occlusion-only mode beyond "use the alpha channel".

**Version drift:** GTC20 (2020) and RTG2 (2021) differ in frame caps, constants (b = 1.001 vs 1.1),
mip counts and filter footprints. Prefer RTG2, the later and more detailed source, and treat GTC20
as a source for formulas RTG2 leaves out.
