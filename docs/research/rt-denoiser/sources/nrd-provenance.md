# NRD provenance audit

_Audit date: 2026-10-24. Auditor: the single provenance-audit agent (RULES.md rule 3)._

This file holds names, licenses, citations, file and dependency lists, build and platform
facts, and interface facts taken from the prose of NRD's README.md and UPDATE.md. It does
not describe how NRD implements anything and contains no NRD code, constants or formulas.

Snapshot audited:

| Repo | Ref | Commit |
|---|---|---|
| `NVIDIA-RTX/NRD` | `master` (README title: v4.18.0, release tag `v4.18.0`, 2026-10-09) | `e06852bd545973cb224eb28820b891205cfc1624` |
| `NVIDIA-RTX/NRD-Sample` | `main` | `99bf21d9bbc77b9d5f59cceb298fdc679aafc753` (submodules: NRD `e06852b`, NRIFramework `21cce85`) |

**Contamination note (rule 7).** The auditor read NRD and NRD-Sample source files with
grep, to find citations. That surfaced some comment lines and a few code lines next to
them. So the auditor must not write or review any of our passes. Nothing from those lines
is in this file.

---

## 1. Licenses and dependencies

### 1.1 The NRD repositories

| Item | License | Notes |
|---|---|---|
| `NVIDIA-RTX/NRD` | **NVIDIA RTX SDKs LICENSE** (`LICENSE.txt`; GitHub shows NOASSERTION) | Proprietary. It grants "install and use", modification of *sample* source, and distribution in object-code form inside an application. §4(a) bans reverse engineering, decompiling and disassembling. §4(e) bans any use that would subject the SDK to an open-source license. §7 says third-party components may carry their own terms. Supplement §1 says applications built on the SDK "must be fully interoperable with compatible GPU hardware products designed by NVIDIA". The DLSS/NGX-only restriction to NVIDIA GPUs doesn't name NRD. Every NRD source file has a header reserving all rights to NVIDIA. |
| `NVIDIA-RTX/NRD` `CLA.txt` | NVIDIA Contribution License Agreement | For contributors only. |
| `NVIDIA-RTX/NRD-Sample` | **No LICENSE file** (GitHub: none). Source header: "© 2022 NVIDIA Corporation". | No grant, so treat it as all rights reserved. Its downloaded assets come from NVIDIA releases. |
| `NVIDIA-RTX/NRIFramework` (sample submodule) | **No LICENSE file** (GitHub: none) | Treat it as all rights reserved. It vendors Detex and stb (see below). |

NRD has **no `.gitmodules`** and **no third-party-notice file**. NRD-Sample has submodules
`External/NRIFramework` (github.com/NVIDIA-RTX/NRIFramework) and `External/NRD`
(github.com/NVIDIA-RTX/NRD). NRIFramework in turn has submodules `External/MathLib` and
`External/NRI`.

### 1.2 Build dependencies of NRD (from `CMakeLists.txt`, FetchContent)

| Dependency | Pin | Upstream | License | Permissive? |
|---|---|---|---|---|
| ShaderMake (shader build tool) | commit `3f01623a…` | https://github.com/NVIDIA-RTX/ShaderMake | MIT (NVIDIA, 2014-2023) | **Yes** |
| MathLib (`ml.h`, `ml.hlsli`) | tag `v11` | https://github.com/NVIDIA-RTX/MathLib | MIT (NVIDIA, 2021) | **Yes** |
| NRI (only if `NRD_NRI=ON`; needed by the integration layer) | tag `v190` | https://github.com/NVIDIA-RTX/NRI | MIT (NVIDIA, 2021) | **Yes** |

### 1.3 Transitive dependencies

ShaderMake:

| Dependency | Upstream | License | Permissive? |
|---|---|---|---|
| argparse (vendored, listed in `ThirdPartyLicenses.txt`) | https://github.com/cofyc/argparse | MIT | Yes |
| DXC, downloaded release `v1.9.2609` (Windows and Linux hosts only, **not on Apple hosts**) | https://github.com/microsoft/DirectXShaderCompiler | LLVM Release License (NCSA-style) | Yes |
| DXC for SPIR-V, taken from the installed Vulkan SDK | https://vulkan.lunarg.com/sdk/home | LunarG SDK terms / NCSA for dxc | n/a (tool) |
| Slang (optional, off by default), `2026.19` | https://github.com/shader-slang/slang | Apache-2.0 WITH LLVM-exception | Yes |

NRI v190 (only what is fetched or enabled):

| Dependency | Upstream | License | Permissive? |
|---|---|---|---|
| Vulkan-Headers v1.4.365 | https://github.com/KhronosGroup/Vulkan-Headers | Apache-2.0 / MIT (per-file) | Yes |
| VulkanMemoryAllocator | https://github.com/GPUOpen-LibrariesAndSDKs/VulkanMemoryAllocator | MIT | Yes |
| D3D12MemoryAllocator | https://github.com/GPUOpen-LibrariesAndSDKs/D3D12MemoryAllocator | MIT | Yes |
| D3D12 Agility SDK (NuGet) | https://www.nuget.org/packages/Microsoft.Direct3D.D3D12 | Microsoft license (redistributable) | No (proprietary, Windows only) |
| NVTX v3.6.0 | https://github.com/NVIDIA/NVTX | Apache-2.0 with LLVM exceptions | Yes |
| metal-cpp (Metal 4 backend) | https://github.com/apple/metal-cpp | Apache-2.0 | Yes |
| wgpu-native (WebGPU backend, optional) | https://github.com/gfx-rs/wgpu-native | Apache-2.0 (GitHub-detected) | Yes |
| AMD AGS v6.3.1 (D3D only) | https://github.com/GPUOpen-LibrariesAndSDKs/AGS_SDK | MIT | Yes |
| NVAPI (D3D only) | https://github.com/NVIDIA/nvapi | Mixed: libs under NVIDIA terms (see `License.txt`) | Partly |
| NIS (image scaling, `NRI_ENABLE_NIS_SDK`) | https://github.com/NVIDIAGameWorks/NVIDIAImageScaling | MIT | Yes |
| NGX / DLSS (`NRI_ENABLE_NGX_SDK`) | https://github.com/NVIDIA/DLSS | NVIDIA RTX SDKs LICENSE | **No** |
| FidelityFX SDK v1.1.4 (VK), v2.3.0 (D3D12) | https://github.com/GPUOpen-LibrariesAndSDKs/FidelityFX-SDK | v1.x MIT; v2.x license not verified here | v1.x yes |
| XeSS v3.0.2 | https://github.com/intel/xess | Intel Simplified Software License | No (binary SDK) |
| Metal Shader Converter (optional, locally installed) | Apple developer download | Apple license | No |

### 1.4 Dependencies of NRD-Sample (`CMakeLists.txt`) and NRIFramework

| Dependency | Upstream | License | Permissive? |
|---|---|---|---|
| Sample assets `_Data.7z` (v4.17.1 release) | https://github.com/NVIDIA-RTX/NRD-Sample/releases | none stated (NVIDIA) | No |
| SHARC (radiance cache), commit `76238ef…` | https://github.com/NVIDIA-RTX/SHARC | NVIDIA RTX SDKs LICENSE (`License.md`) | **No** |
| RTXCR Material Library v1.3.0 | https://github.com/NVIDIA-RTX/RTXCR-Material-Library | NVIDIA RTX SDKs LICENSE | **No** |
| RTXCR-Assets v1.2.0 ("Claire" scene, Git LFS) | https://github.com/NVIDIA-RTX/RTXCR-Assets | NVIDIA RTX SDKs LICENSE | **No** |
| Dear ImGui v1.92.9b | https://github.com/ocornut/imgui | MIT | Yes |
| GLFW 3.5.1 | https://github.com/glfw/glfw | zlib | Yes |
| cgltf | https://github.com/jkuhlmann/cgltf | MIT | Yes |
| Detex (vendored in NRIFramework `External/Detex`) | https://github.com/hglm/detex | ISC (Harm Hanemaaijer, 2015) | Yes |
| stb_image / stb_image_write (vendored with Detex) | https://github.com/nothings/stb | MIT or Unlicense | Yes |
| MathLib, NRI, ShaderMake | see 1.2 | MIT | Yes |

### 1.5 Summary for our project

- **Usable from their own upstream under permissive terms (rule 2):** MathLib, NRI,
  ShaderMake (all MIT, NVIDIA), argparse, VMA, D3D12MA, Vulkan-Headers, NVTX, metal-cpp,
  wgpu-native, AMD AGS, NIS, Dear ImGui, GLFW, cgltf, Detex, stb, Slang, DXC, and
  FidelityFX 1.x. MathLib's `ml.hlsli` holds generic sampling and color math. NRD's README
  links to its cosine-weighted and "VNDF v3" samplers. It is MIT and is not NRD code.
- **NVIDIA-proprietary (keep out of our repo):** NRD, NRD-Sample, NRIFramework (no
  license), SHARC, RTXCR library and assets, DLSS/NGX, and NVAPI libraries.
- **Other proprietary:** Agility SDK, XeSS, Apple Metal Shader Converter.
- **Not usable even for reference:** NVIDIA-RTX/STBN (spatiotemporal blue noise; the README
  points to it) is under an **NVIDIA Source Code License, Non-Commercial**. Use the
  published STBN paper instead.

---

## 2. External references cited inside NRD and NRD-Sample

Method: every URL in the NRD and NRD-Sample source and docs, plus a keyword sweep for
paper, book, chapter, author and technique names. Only the citation is listed here. Line
numbers are omitted on purpose.

### 2.1 NRD library (`NVIDIA-RTX/NRD`)

| File | Reference | What it points to |
|---|---|---|
| `Include/NRD.h` (credits block) | Oles Shyshkovtsov, 4A Games | Credited with the "recurrent blurring concept" behind REBLUR. Look for 4A Games' public talks on Metro Exodus ray-traced GI denoising. |
| `Include/NRD.h` (credits block) | Developers Dmitrii Zhdan and Tim Cheblokov (NVIDIA); also Ivan Fedorov, Ganesh Mamadapu ("DSLE"), Justin McTavish Avola, Pawel Kozlowski, Evgeny Makarov, Ivan Povarov | Authors and contributors. Zhdan's public talk is "ReBLUR: A Hierarchical Recurrent Denoiser" (Ray Tracing Gems II, ch. 49) and the GTC/GDC NRD talks. |
| `Shaders/NRD.hlsli` | https://gpuopen.com/download/publications/Bounded_VNDF_Sampling_for_Smith-GGX_Reflections.pdf | Eto & Tokuyoshi, "Bounded VNDF Sampling for Smith-GGX Reflections" (SIGGRAPH Asia 2023 Technical Communications). This is the "VNDF v3" sampler. |
| `Shaders/NRD.hlsli` | "Ray Tracing Gems", Chapter 32, Equation 4 (GGX VNDF + Schlick) | Hirvonen, Seppälä, Aizenshtein, Smal, "Accurate Real-Time Specular Reflections with Radiance Caching", *Ray Tracing Gems* (2019), ch. 32, doi:10.1007/978-1-4842-4427-2_32 (open access) |
| `Shaders/NRD.hlsli` | https://twitter.com/Stubbesaurus/status/937994790553227264 | Rune Stubbe's tweet on octahedral normal encoding |
| `Shaders/NRD.hlsli` | https://johnwhite3d.blogspot.com/2017/10/signed-octahedron-normal-encoding.html | John White, "Signed Octahedron Normal Encoding" (blog, 2017) |
| `Shaders/NRD.hlsli` | https://media.contentapi.ea.com/content/dam/eacom/frostbite/files/gdc2018-precomputedgiobalilluminationinfrostbite.pdf | Frostbite, "Precomputed Global Illumination in Frostbite" (GDC 2018) |
| `Shaders/NRD.hlsli` | https://therealmjp.github.io/posts/sg-series-part-1-a-brief-and-incomplete-history-of-baked-lighting-representations/ | Matt Pettineo (MJP), Spherical Gaussian series, part 1 |
| `Shaders/NRD.hlsli` | https://therealmjp.github.io/posts/sg-series-part-3-diffuse-lighting-from-an-sg-light-source/ | MJP SG series, part 3 (diffuse from an SG light) |
| `Shaders/NRD.hlsli` | https://therealmjp.github.io/posts/sg-series-part-4-specular-lighting-from-an-sg-light-source/ | MJP SG series, part 4 (specular from an SG light) |
| `Shaders/NRD.hlsli` | "Burley" (name only) | Burley, "Physically-Based Shading at Disney" (SIGGRAPH 2012 course): the Disney diffuse model |
| `Shaders/NRD.hlsli` | "Unreal Engine" (name only) | Engine-integration note, not a technique source |
| `Shaders/Common.hlsli` | https://computergraphics.stackexchange.com/questions/1718/what-is-the-simplest-way-to-compute-principal-curvature-for-a-mesh-triangle | Computer Graphics Stack Exchange Q&A on estimating principal curvature of a mesh triangle |
| `Shaders/Common.hlsli` | https://www.geeksforgeeks.org/sign-convention-for-spherical-mirrors/ | Basic optics: sign convention for spherical mirrors (mirror equation) |
| `Shaders/Common.hlsli` | "Catmull-Rom" (name only) | Catmull-Rom spline / bicubic filtering (public; e.g., Catmull & Rom 1974) |
| `Shaders/*` (several), `Shaders/RELAX_*` | "YCoCg" (identifier names) | YCoCg color space (Malvar & Sullivan, 2003) |
| `Source/InstanceImpl.cpp` | "Weyl" (identifier) | Weyl / additive-recurrence low-discrepancy sequence |
| `Include/NRDSettings.h`, `Shaders/Common.hlsli` | "Bayer" (comments) | Bayer ordered-dither matrix |
| `Include/NRDSettings.h` | RTXDI, ReSTIR, SHARC, DLSS (names in comments) | NVIDIA products and ReSTIR (Bitterli et al., SIGGRAPH 2020) |
| `Include/NRDSettings.h` (1 URL), `Shaders/Common.hlsli` (8 URLs), `Shaders/NRD.hlsli` (1 URL), `Shaders/REBLUR_Common.hlsli` (1 URL) | desmos.com/calculator/… graphs, **URLs deliberately not reproduced** | Desmos plots made by NRD's authors that chart NRD's own curves. They are NRD design material, not an independent public source. **Do not open (rule 1 by extension).** |

### 2.2 NRD-Sample (`NVIDIA-RTX/NRD-Sample`)

| File | Reference | What it points to |
|---|---|---|
| `Shaders/RaytracingShared.hlsli` | https://blog.selfshadow.com/publications/turquin/ms_comp_final.pdf | Emmanuel Turquin, "Practical multiple scattering compensation for microfacet models" (2019) |
| `Shaders/RaytracingShared.hlsli` | https://eheitzresearch.wordpress.com/772-2/ | Eric Heitz's research page, entry for Heitz, Belcour, Ostromoukhov, Coeurjolly, Iehl, "A Low-Discrepancy Sampler that Distributes Monte Carlo Errors as a Blue Noise in Screen Space" (SIGGRAPH 2019 Talks); the page offers source code under its own license |
| `Shaders/RaytracingShared.hlsli` | https://belcour.github.io/blog/research/publication/2019/06/17/sampling-bluenoise.html | Same paper, Laurent Belcour's page. NRD's README also links it as the recommended LDS. |
| `Shaders/RaytracingShared.hlsli` | https://arxiv.org/pdf/1705.01263.pdf (Appendix 3) | Keller, Wächter, Raab, Seibert, van Antwerpen et al., "The Iray Light Transport Simulation and Rendering System" (arXiv 1705.01263) |
| `Shaders/RaytracingShared.hlsli`, `Shaders/TraceTransparent.cs.hlsl`, `Source/NRDSample.cpp` | "Sobol", "Halton", "Weyl", "Burley" (names) | Standard low-discrepancy sequences; Disney diffuse |
| `Shaders/Shared.hlsli` | https://www.slideshare.net/TiagoAlexSousa/graphics-gems-from-cryengine-3-siggraph-2013 (slides 23+) | Tiago Sousa et al., "Graphics Gems from CryENGINE 3" (SIGGRAPH 2013 course) |
| `Shaders/Shared.hlsli`, `Shaders/ConfidenceBlur.cs.hlsl` | "Uncharted" (identifier) | Hable's Uncharted 2 filmic tonemapper (GDC 2010, "Uncharted 2: HDR Lighting") |
| `Shaders/Taa.cs.hlsl` | https://www.cs.rit.edu/~ncs/color/t_convert.html | "Color Conversion Algorithms" (RIT course page; RGB/HSV etc.) |
| `Shaders/Taa.cs.hlsl` | http://www.brucelindbloom.com/index.html?Eqn_RGB_XYZ_Matrix.html | Bruce Lindbloom, RGB to XYZ matrix |
| `Shaders/*`, `Source/NRDSample.cpp` | SHARC, RTXCR, DLSS, XeSS, FSR (names) | NVIDIA, Intel and AMD SDKs (proprietary, see §1) |
| `Source/NRDSample.cpp` | a godbolt.org link, **URL not reproduced** | A Compiler Explorer snippet (code, not a public technique source) |

### 2.3 References in NRD README.md prose (public pages)

- NVIDIA blog, "Rendering Perfect Reflections and Refractions in Path-Traced Games" (Primary Surface Replacement): https://developer.nvidia.com/blog/rendering-perfect-reflections-and-refractions-in-path-traced-games/
- Heitz/Belcour blue-noise LDS page (as above); STBN repo (non-commercial, see §1.5).
- RTXDI: https://developer.nvidia.com/rtxdi ; SHARC; NRC: https://github.com/NVIDIA-RTX/NRC (proprietary).
- NRD users named: Autodesk Aurora (https://github.com/Autodesk/Aurora), Enscape (Chaos blog), Lumion (forum).
- MathLib `ml.hlsli` cosine-weighted and VNDF samplers (MIT).
- NRD-Sample source permalinks (motion vectors, lobe selection, blue noise, PSR). **These
  point at sample code, so they are off-limits for implementers.**

**Caution for researchers reading README prose.** These README sections hold
implementation-level detail outside fenced code blocks. Skip them if you want a stricter
line:
- "HISTORY CONFIDENCE": two lines saying how REBLUR and RELAX consume confidence.
- "MATERIAL DEMODULATION": an indented pseudo-code block.
- "[SIGMA]" multi-light paragraph: equations.
- "INTERACTION WITH LOW DISCREPANCY SAMPLERS": sequence-length and spatial-size guidance.

The fenced blocks (material-ID comparison, FPS-to-frames formula, fast-history guidance,
shader examples) are code and are already excluded by rule 1.

---

## 3. Interface facts (from README/UPDATE.md prose only)

The exact per-denoiser resource lists, enum values and struct fields live in the public
headers (`Include/NRDDescs.h`, `Include/NRDSettings.h`) and in `Shaders/NRD.hlsli`. RULES
rule 1 lists those as off limits to researchers. **Only the harness builder (rule 4) should
read them**, to wire up the harness.

### 3.1 Denoisers and signal types

- **REBLUR** (recurrent blur): diffuse and/or specular radiance, plus "SH" variants (actually
  spherical Gaussians); diffuse/specular occlusion ("OCCLUSION"); diffuse directional
  occlusion ("DIRECTIONAL_OCCLUSION").
- **RELAX** (À-trous based, designed for RTXDI): diffuse and/or specular radiance, plus SH
  variants. No AO/SO.
- **SIGMA**: shadow from an infinite light (sun/moon) or a local light (omni/spot); shadow
  with translucency. Per light.
- **REFERENCE**: temporal accumulation for ground truth (`IN_SIGNAL` → `OUT_SIGNAL`).

Denoiser identifiers named in the README memory table: `REBLUR_DIFFUSE`,
`REBLUR_DIFFUSE_OCCLUSION`, `REBLUR_DIFFUSE_SH`, `REBLUR_SPECULAR`,
`REBLUR_SPECULAR_OCCLUSION`, `REBLUR_SPECULAR_SH`, `REBLUR_DIFFUSE_SPECULAR`,
`REBLUR_DIFFUSE_SPECULAR_OCCLUSION`, `REBLUR_DIFFUSE_SPECULAR_SH`,
`REBLUR_DIFFUSE_DIRECTIONAL_OCCLUSION`, `RELAX_DIFFUSE`, `RELAX_DIFFUSE_SH`,
`RELAX_SPECULAR`, `RELAX_SPECULAR_SH`, `RELAX_DIFFUSE_SPECULAR`,
`RELAX_DIFFUSE_SPECULAR_SH`, `SIGMA_SHADOW`, `SIGMA_SHADOW_TRANSLUCENCY`, `REFERENCE`.

Published cost (RTX 4080, 1440p native, default settings): REBLUR diffuse+specular 2.55 ms
(3.40 ms SH); RELAX diffuse+specular 3.25 ms (4.80 ms SH); SIGMA shadow 0.40 ms;
translucency 0.45 ms. The README has a memory table at 1080p/1440p/2160p.

### 3.2 Guide inputs (non-noisy; no NaN/Inf allowed)

- **`IN_MV`**: surface motion with "old = new + MV", non-jittered after scale and bias.
  - Three modes: 2D screen-space, **2.5D (recommended; z = viewZprev − viewZ)**, or 3D
    world-space (object motion only; camera motion comes from the matrices).
  - Selected via `CommonSettings::isMotionVectorInWorldSpace` and
    `CommonSettings::motionVectorScale` (3 components; z = 0 means 2D) and
    `motionVectorBias`, applied after scaling.
  - Bring-up tip: MV = 0 with world-space mode lets NRD track camera motion alone.
- **`IN_NORMAL_ROUGHNESS`**: world-space normal and **linear** roughness.
  - The encoding is fixed at build time: CMake `NRD_NORMAL_ENCODING` (0–4, default 2) and
    `NRD_ROUGHNESS_ENCODING` (0–2, default 1). They are readable at runtime via
    `LibraryDesc::normalEncoding` and `roughnessEncoding`.
  - `NormalEncoding::R10_G10_B10_A2_UNORM` enables a 2-bit `materialID`.
  - Pack with the `NRD.hlsli` front-end helper so the encoding matches.
- **`IN_VIEWZ`**: linear view-space Z of the primary hit (or of the PSR virtual position).
  Either sign is allowed. Not Inf. Must be in the same space as the matrices given to NRD.
  `CommonSettings::viewZScale` helps when viewZ is stored as FP16.
- **`IN_DIFF_CONFIDENCE`, `IN_SPEC_CONFIDENCE`** (optional): history confidence in [0,1]
  (0 = reset). May be lower resolution. Enabled by `isHistoryConfidenceAvailable` and the
  `NRD_SUPPORTS_HISTORY_CONFIDENCE` build option.
- **`IN_DISOCCLUSION_THRESHOLD_MIX`** (optional): [0,1] blend between
  `disocclusionThreshold` and `disocclusionThresholdAlternate`.

### 3.3 Noisy inputs

- **Radiance:**
  - Diffuse and specular separated at the primary (or PSR) hit.
  - **Demodulated**: materials removed before denoising, re-applied after; the
    `NRD_MaterialFactors` helper does this.
  - Positive RGB in a sane HDR range (README suggests [0, 250] for RELAX because of FP16).
  - Not pre-exposed.
  - Primary emission kept out of the signal.
  - Packed with `[REBLUR|RELAX]_FrontEnd_Pack*`.
  - NaN/Inf allowed only outside the viewport rect or beyond `denoisingRange`.
- **Hit distance** (`hitT`, REBLUR/RELAX):
  - In-lobe distance; non-negative; excludes the primary segment; 0 for a skipped lobe
    under probabilistic lobe selection.
  - **REBLUR expects normalized hitT** via `REBLUR_FrontEnd_GetNormHitDist`, with matching
    `ReblurHitDistanceParameters` passed in settings.
  - With probabilistic lobe selection, set `HitDistanceReconstructionMode` (e.g.,
    `AREA_3X3`) and a non-zero pre-pass radius.
- **SIGMA**:
  - `IN_PENUMBRA` (packed by `SIGMA_FrontEnd_PackPenumbra`; infinite- and local-light
    variants), plus `IN_TRANSLUCENCY` for the translucency variant.
  - Shadow data follows the hit/miss/NoL conventions in the README "Distance to occluder"
    list.
  - `lightDirection` in SIGMA settings is for directional lights.
- **REFERENCE**: `IN_SIGNAL`.

### 3.4 Outputs

- REBLUR/RELAX denoised radiance (plus hitT/occlusion for REBLUR), and SH/SG payloads for
  SH variants. Unpack with `[REBLUR|RELAX|SIGMA]_BackEnd_Unpack*`.
- SH outputs need an application-side resolve: `NRD_SG_ExtractColor`, `ResolveDiffuse` and
  `ResolveSpecular`, `ReJitter`.
  - For an apples-to-apples image comparison, use `NRD_SG_ExtractColor`, or the non-SH
    denoisers.
- SIGMA: `OUT_SHADOW_TRANSLUCENCY`.
- Debug: `OUT_VALIDATION` when `CommonSettings::enableValidation`.
- REFERENCE: `OUT_SIGNAL`.
- Most denoisers leave pixels beyond `denoisingRange` unwritten.

### 3.5 Per-frame settings the caller sets

`CommonSettings` (via `SetCommonSettings`):
- Camera matrices (current and previous, **non-jittered**). Exact field names are in
  `NRDSettings.h`. There is also an optional `worldPrevToWorldMatrix`.
- `cameraJitter` and `cameraJitterPrev`.
- A frame index (field name in `NRDSettings.h`).
- `motionVectorScale` and `motionVectorBias`; `isMotionVectorInWorldSpace`.
- `resourceSize`/`resourceSizePrev` and `rectSize`/`rectSizePrev` (dynamic resolution).
- `inputRectOrigin` and `outputRectOrigin` (need `NRD_SUPPORTS_VIEWPORT_OFFSET`).
- `denoisingRange`, `viewZScale`.
- `disocclusionThreshold` and `disocclusionThresholdAlternate`.
- `isHistoryConfidenceAvailable`, `isDisocclusionThresholdMixAvailable`.
- `enableValidation`.
- **`accumulationMode`**: `RESTART` for one frame, or `CLEAR_AND_RESTART` when history is
  garbage.
- Material-ID features: `strandMaterialID`, `strandThickness`,
  `cameraAttachedReflectionMaterialID`, `historyFixAlternatePixelStrideMaterialID`.
- `checkerboardMode`.

Per-denoiser settings (`SetDenoiserSettings`; `ReblurSettings`, the RELAX settings,
SIGMA settings):
- Defaults via `{}` are recommended.
- Named knobs include `maxAccumulatedFrameNum`, `maxFastAccumulatedFrameNum`,
  `historyFixFrameNum`, pre-pass radii, `hitDistanceReconstructionMode`, antilag settings,
  `minMaterialForDiffuse`/`Specular`, `lobeAngleFraction`, and `enableAntiFirefly`.
- `GetMaxAccumulatedFrameNum` converts an accumulation time to frames from (low-pass
  filtered) FPS.

Other interface facts:
- **Resize:** NRD has no resize call. Recreate the instance when resolution changes.
- **Low-level API flow:** `GetLibraryDesc` → `CreateInstance` → `GetInstanceDesc` → per
  frame `SetCommonSettings`, `SetDenoiserSettings`, `GetComputeDispatches` →
  `DestroyInstance`. NRD makes no graphics-API calls itself.
- **Integration layer** (`Integration/NRDIntegration.h`, needs `NRD_NRI=ON`):
  - Setup: `Initialize` with an `IntegrationCreationDesc`.
  - Each frame: `NewFrame`, `SetCommonSettings`, `SetDenoiserSettings`, then `Denoise` with
    a `ResourceSnapshot` holding the input and output textures.
  - The app supplies native Device, CommandList and Texture pointers (D3D12/VK/D3D11). The
    integration creates descriptors itself.

---

## 4. Running native NRD as a black box

### 4.1 Platform facts

**NRD:**
- Its README targets "D3D12, Vulkan or D3D11". Build scripts exist for **Windows and
  Linux** only. CI builds Windows x64, ARM64 and ARM64EC, and Linux x64 (ubuntu-latest).
  There is no macOS script or CI.
- CMake 3.30+.
- Embedded shader formats: SPIR-V (default on everywhere), DXIL and DXBC (Windows only;
  the CMake forces them off on other platforms).
- Shaders are compiled at build time by ShaderMake, targeting Vulkan 1.2 for SPIR-V.
  - Windows/Linux: ShaderMake downloads DXC.
  - macOS: it does not, and relies on the DXC shipped in the LunarG Vulkan SDK.
- `NRD_SUPPORTS_QUAD_INTRINSICS` (default ON) needs `VK_KHR_compute_shader_derivatives`
  on Vulkan.
- GitHub releases (v4.18.0, etc.) have **no binary assets**, so you must build from
  source.

**NRI v190:**
- Backends: D3D11/D3D12 (Windows), Vulkan (Windows, Linux, macOS via **MoltenVK**),
  native **Metal 4** (macOS 26+, Xcode 26+), WebGPU (wgpu-native).
- Its README documents a macOS build (Xcode CLT, Ninja, Vulkan SDK `setup-env.sh`) and
  lists the Apple-required Vulkan extensions (`VK_KHR_portability_enumeration`,
  `VK_KHR_portability_subset`, `VK_KHR_get_physical_device_properties2`).
- Required everywhere: `VK_KHR_synchronization2`.

**NRD-Sample:**
- D3D12 and Vulkan (`.args`). Scripts for Windows and Linux.
- Requires "any GPU supporting trace ray inline". Windows ARM64 drops FSR/XeSS.
- Its NRIFramework dependency has macOS scripts, but the sample itself has none, and it
  needs ray queries (MoltenVK ray-query support is limited).
- It is not needed for our harness.

**GPU requirements:** NRD itself is compute-only (2D textures, two samplers). Nothing in the
docs requires NVIDIA hardware. The license supplement asks that applications be
*interoperable* with NVIDIA GPUs; it doesn't forbid running elsewhere.

### 4.2 Feasibility on the Apple Silicon Mac (M5 Pro, macOS)

**(a) Vulkan via MoltenVK: plausible, unverified.** It is the most promising local route.

Steps:
1. Install the LunarG Vulkan SDK (MoltenVK and DXC) and Ninja.
2. Configure NRD with `-DNRD_NRI=ON -DNRD_SUPPORTS_QUAD_INTRINSICS=OFF`.
   - Quad intrinsics need `VK_KHR_compute_shader_derivatives`, which MoltenVK may not
     expose. Check with `vulkaninfo`.
3. Use NRI's Vulkan backend on MoltenVK.

Risks to check early:
- SPIRV-Cross translation of DXC-generated compute SPIR-V.
- Storage-image read/write formats that NRD's internal textures need on Metal.
- FP16 arithmetic.
- Descriptor-count limits.
- Timing numbers will not represent NVIDIA hardware. Use them only for image comparison.

Patching NRD's *build* files in the sibling folder is fine under rule 4. Patching its
shaders is not.

**(b) Native Metal 4 via NRI: not currently viable without build changes.**
- NRI's Metal backend takes metallib, or DXIL through Apple's Metal Shader Converter.
- NRD embeds DXIL only on Windows. So this route needs either DXIL produced on Windows and
  converted offline (ShaderMake's `--metalFromDXIL`, per NRI's README), or a patched CMake
  option.
- Second choice; worth a try only if MoltenVK fails.

**(c) Recommended primary route: a Linux or Windows machine with an NVIDIA RTX GPU.**
- This is NRD's supported, CI-tested setup, and its timings mean something.
- Options:
  - A local Windows/Linux box with an RTX 30/40/50 card.
  - A cloud GPU VM:
    - AWS `g5` (A10G) or `g6`/`g6e` (L4/L40S).
    - GCP `g2` (L4).
    - Azure `NVads A10 v5`.
    - Lambda, Paperspace or RunPod RTX-class instances.
  - Datacenter cards (A10G, L4, L40S) are fine for compute-only Vulkan or D3D12. Use
    Linux + Vulkan for a headless run (no display needed), or Windows Server + D3D12.
  - Prefer an Ada-class GPU (L4/L40S) so timings roughly track the README's RTX 4080
    figures.

### 4.3 Minimal headless harness

Steps only. It lives in the sibling folder and links NRD and NRI; NRI is MIT.

1. **Build:**
   - `cmake -S NRD -B NRD/_Build -DNRD_NRI=ON`, choosing `NRD_NORMAL_ENCODING` and
     `NRD_ROUGHNESS_ENCODING` to match what our capture writes. Prefer an encoding that our
     capture can produce exactly, so no lossy repack is needed.
   - Build, then run `Scripts/<Platform>/3-PrepareSDK` to get `_NRD_SDK` and `_NRI_SDK`.
   - The harness links both.
2. **Device:**
   - Create an NRI device on Vulkan (Linux/macOS) or D3D12 (Windows) with no swapchain.
   - Or create a native VkDevice or ID3D12Device and wrap it with NRI's
     `NRIWrapperVK`/`NRIWrapperD3D12` extensions.
3. **Load captures:** for N frames, read EXR or raw float buffers for:
   - radiance + hitT (diffuse, specular);
   - normal + roughness;
   - linear viewZ;
   - 2.5D motion;
   - optional confidence;
   - SIGMA penumbra/translucency, if testing shadows.

   Also read per-frame JSON with the view and projection matrices (current and previous,
   non-jittered), jitter, frame index, resolution, and a reset flag.
4. **Upload and pack:** upload to GPU textures.
   - If our capture is unpacked, run a small harness-side compute pass that calls
     `NRD.hlsli`'s front-end helpers: normal/roughness packing, `REBLUR_FrontEnd_GetNormHitDist`,
     `*_FrontEnd_Pack*`, and `NRD_MaterialFactors` demodulation if the capture isn't
     already demodulated.
   - This pass is harness code. Its author must not write our corresponding passes
     (rule 4).
5. **Instance:** call `Initialize` on `nrd::Integration` with an `IntegrationCreationDesc`
   and an instance creation desc listing the denoisers under test, for example
   `REBLUR_DIFFUSE_SPECULAR`, `RELAX_DIFFUSE_SPECULAR`, `SIGMA_SHADOW` and `REFERENCE`.
6. **Per frame:**
   1. `NewFrame`.
   2. Fill `CommonSettings` from the capture JSON: matrices, jitter, frame index, MV
      scale/bias/mode, `resourceSize`/`rectSize`, `denoisingRange`, `accumulationMode`
      (`CLEAR_AND_RESTART` on frame 0 and on scripted resets).
   3. `SetCommonSettings`; then `SetDenoiserSettings` (defaults `{}` unless testing a
      knob).
   4. Build a `ResourceSnapshot` mapping the input and output textures.
   5. `Denoise(identifiers, commandBuffer, snapshot)`.
   6. Submit and wait.
   7. Optionally bracket with GPU timestamp queries for timings.
7. **Unpack and write:** a harness compute pass with `*_BackEnd_Unpack*` (and
   `NRD_SG_ExtractColor` for SH variants). Read back and write EXR per frame and per signal
   (`outputs/<capture>/<denoiser>/<frame>.exr`), plus `timings.csv`.
8. **Compare:** run our WGSL denoiser on the same capture and diff images (FLIP, PSNR,
   temporal stability) with our own tooling. Only images and timings cross back into our
   repo.

---

## 5. Suggested sibling layout (outside our repo)

```
/Users/dex/Developer/nrd-reference/          # never inside Denoiser-nrd-cleanroom
  README.md          # what this is, rule-4 constraints, pinned commits
  NRD/               # git clone NVIDIA-RTX/NRD @ e06852b (build here; _Build/, _NRD_SDK/, _NRI_SDK/)
  NRD-Sample/        # optional: clone --recursive @ 99bf21d, only to sanity-check NRD on a Windows/Linux RTX box
  harness/           # our black-box driver (C++), links _NRD_SDK + _NRI_SDK; its own git repo
    src/  shaders/   # pack/unpack passes using NRD.hlsli (harness author only)
    CMakeLists.txt
  captures/          # inputs exported from OUR renderer: <scene>/<frame>/*.exr + camera.json
  outputs/           # NRD results: <scene>/<denoiser>/<frame>.exr, timings.csv, run.json (NRD commit, encodings, GPU, driver)
  toolchain/         # notes or links: Vulkan SDK version, DXC, cloud VM image
```

Rules for this folder:
- `captures/` can be written by our repo's tools.
- Only `outputs/` images and metrics may be copied back into our repo, for comparison
  reports.
- Never copy source, binaries or shader blobs back.
- On a cloud VM, mirror the same layout under `~/nrd-reference/` and sync `captures/` up
  and `outputs/` down.

---

## What I looked at (audit log)

Via `gh api` (GitHub REST), saved to a session scratchpad outside the repo (no clone):

- `NVIDIA-RTX/NRD`: repo metadata; recursive tree of `master`; tags/releases; `LICENSE.txt`
  (full); `CLA.txt` (header); `CMakeLists.txt` (options, FetchContent, ShaderMake
  invocation); `README.md` and `UPDATE.md` (read only after stripping fenced code blocks);
  `.github/workflows/build.yml`; `Scripts/Linux/*.sh`, `Scripts/Windows/1-Deploy.bat`,
  `2-Build.bat`; `Shaders/Shaders.cfg` (downloaded, not read).
- `NVIDIA-RTX/NRD` source (`Include/`, `Integration/`, `Source/`, `Shaders/`,
  `Resources/`): downloaded and **searched by grep only** for URLs, citation keywords,
  copyright and license headers. Read: the copyright header and CREDITS block of
  `Include/NRD.h`. The grep output also showed a handful of nearby comment and code lines
  (see the contamination note at the top).
- `NVIDIA-RTX/NRD-Sample`: metadata; tree of `main`; `.gitmodules`; `CMakeLists.txt`;
  `.args`; `README.md`; `.github/workflows/build.yml`; `Scripts/Linux/*`; source/shaders
  (`Shaders/*.hlsl(i)`, `Source/NRDSample.cpp`) **grep only** for citations; the first
  lines of `NRDSample.cpp` (copyright).
- `NVIDIA-RTX/NRI`: `LICENSE.txt` (header), `CMakeLists.txt` (options and FetchContent
  URLs), `README.md` (platform, backend and extension sections), the v190 tag README
  (Metal/macOS lines).
- `NVIDIA-RTX/NRIFramework`: `.gitmodules`, `CMakeLists.txt` (FetchContent URLs), tree,
  `External/Detex/_LICENSES.txt`, README build lines.
- `NVIDIA-RTX/ShaderMake`: `LICENSE.txt`, `ThirdPartyLicenses.txt`, `CMakeLists.txt`
  (compiler-download options).
- `NVIDIA-RTX/MathLib`, `SHARC`, `RTXCR-Material-Library`, `RTXCR-Assets`, `STBN`: license
  file headers.
- Upstream license checks (GitHub license API and/or license file first lines):
  - cofyc/argparse, hglm/detex, nothings/stb, ocornut/imgui, glfw/glfw, jkuhlmann/cgltf
  - KhronosGroup/Vulkan-Headers, KhronosGroup/MoltenVK
  - GPUOpen VMA, D3D12MA, AGS_SDK, FidelityFX-SDK
  - NVIDIA/NVTX, NVIDIA/DLSS, NVIDIA/nvapi, NVIDIAGameWorks/NVIDIAImageScaling
  - apple/metal-cpp, gfx-rs/wgpu-native
  - microsoft/DirectXShaderCompiler, shader-slang/slang
  - intel/xess, NVIDIA-RTX/NRC
- Citation resolution (public pages only):
  - arXiv abs page 1705.01263 (title and authors)
  - Eric Heitz's research page (title)
  - RIT color-conversion page (title)
  - Springer listing for *Ray Tracing Gems* ch. 32 (DOI suffix `_32`, authors)
- Web search on MoltenVK support for `VK_KHR_compute_shader_derivatives` (inconclusive).
- **Not opened:** any desmos.com or godbolt.org link cited in NRD/NRD-Sample; any
  third-party port or fork of NRD.
