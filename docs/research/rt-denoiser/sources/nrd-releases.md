# NRD release audit: what changed, 2021 → v4.18.0

_Audit date: 2026-10-25. Auditor: the release-audit agent (RULES.md rule 3b; RULES §8 register row
"release auditor"). The auditor does not write or review our passes (rule 8)._

This file says **what** changed in NVIDIA's NRD from release to release: denoisers, inputs,
outputs, settings that appeared or disappeared (names only), platforms, published performance and
memory figures, and the behaviour NVIDIA claims. It never says **how**. Lines that state a formula,
threshold, constant, default value, pass order or structure, data layout, or an algorithm name that
no public talk or paper names were left out (count at the end). Implementers and researchers read
this file, never the raw notes (rule 3b).

**Sources read (and nothing else):**

| Source | Range | Ref |
|---|---|---|
| GitHub release bodies, `gh api repos/NVIDIA-RTX/NRD/releases --paginate` | 78 releases, `v2.5.0` (2021-07-19, the earliest release on GitHub; nothing earlier in 2021) through `v4.18.0` (2026-10-09, marked pre-release) | fetched 2026-10-25 |
| `UPDATE.md` prose ("HOW TO UPDATE?" migration guide, "To v3.0" … "To v4.18" and "Custom shader compilation"), `gh api repos/NVIDIA-RTX/NRD/contents/UPDATE.md` | whole file | blob `679097cb79f8d82440fe2803bf8d6fca644c4016`; last commit touching it `fca9486957dececb7a7d5b5646d0829c667a01cf` (2026-09-04) |

Method: a script stripped every fenced code block (```` ``` ```` / `~~~`) before the text was
shown to the auditor. Neither source contained one (0 in the release bodies, 0 in `UPDATE.md`).
Inline code that was an expression rather than a name (one usage example in "To v4.7") was skipped.
Links inside the notes (to the README, `UPDATE.md` anchors, issues, ShaderMake) were not followed.

**No NRD code, README, source file, shader, header, Integration folder, NRD-Sample, fork or port was
opened.** No clone, no web search. Two README section names appear below only because the release
notes announce them ("History confidence", "Interaction with low discrepancy samplers"); those README
sections remain off limits (RULES §2).

Names: ReBLUR, ReLAX, SIGMA, NRD are NVIDIA's (RULES §6); they appear here because this file
compares. Settings, resources and helpers are named as NRD spells them (`REBLUR_*`, `IN_*`, ...).
Shorthands: rpp = rays per pixel; DRS = dynamic resolution scaling; TS = the "temporal
stabilization" stage ReBLUR's public chapter already names; AO/SO = ambient / specular occlusion.

---

## 1. Timeline

The "API/settings" items fold in `UPDATE.md`'s "To vX.Y" entry for the same minor version. There is
no `v4.13.0` release; `UPDATE.md` "To v4.13" adds `minHitDistanceWeight`, announced in `v4.14.0`.

| Version | Date | What changed |
|---|---|---|
| v2.5.0 | 2021-07-19 | **Platform:** Windows, Linux and ARM64 with MSVC, GCC and Clang. Consoles with minimal changes. Better "white-box" (engine-source) integration. **Perf:** SIGMA 2× faster. RELAX checkerboard mode (0.5 rpp). **Behaviour:** SIGMA closer to the reference in umbra–penumbra regions, no lag on hard shadows. REBLUR: specular (virtual-motion) tracking lags less, fewer history rejections, better on surfaces with varying roughness, over-blurred specular at very low roughness fixed (regression), blur on divergent roughness and over-eager history rejection when roughness changes fixed, fewer hit-distance disocclusions in reflections, a diffuse bias fixed. RELAX: ringing where the signal is badly defined fixed. **Settings:** REBLUR `forceReferenceAccumulation`, split screen. |
| v2.9.0 | 2021-11-08 | **New denoisers:** `REBLUR_DIFFUSE_OCCLUSION`, `REBLUR_SPECULAR_OCCLUSION`, `REBLUR_DIFFUSE_SPECULAR_OCCLUSION`, stand-alone RELAX diffuse-only (`RELAX_DIFFUSE`) and specular-only. **New optional inputs:** `IN_DIFF_CONFIDENCE` / `IN_SPEC_CONFIDENCE` (user-driven anti-lag, "history confidence"), `IN_DIFF_DIRECTION_PDF` / `IN_SPEC_DIRECTION_PDF` (for an optional advanced pre-pass, `PrePassMode`), `IN_DIFF_HITDIST` / `IN_SPEC_HITDIST` (occlusion denoisers). Renamed `IN_DIFF_HIT_DIST` → `IN_DIFF_RADIANCE_HITDIST`, `IN_SPEC_HIT_DIST` → `IN_SPEC_RADIANCE_HITDIST`. **API:** `CommonSettings::accumulationMode` replaces "frameIndex 0 resets", `CLEAR_AND_RESET` clears every texture. `cameraMotion` removed (taken from the matrices). `meterToUnitsMultiplier`. Resolution scale becomes 2-component. Split screen fully bypasses denoising. `NRD_GetSampleWeight` helper for many-rpp / path tracing. Optional material-ID-aware spatial filtering. REBLUR `isRadianceMultipliedByExposure`, `residualNoiseLevel`. **Behaviour:** less specular smearing and better specular tracking on curved surfaces (both). RELAX: more stable specular, less specular darkening at low rpp and high roughness, 0.5-rpp history fixed. REBLUR anti-firefly reworked. |
| v2.10.0 | 2021-11-18 | REBLUR/SIGMA history copied correctly when the previous dynamic resolution was larger. REBLUR anti-firefly restored, fewer under-blurred cases. Native FP16 types enabled in HLSL. |
| v2.12.0 | 2022-02-08 | **New denoisers:** `REFERENCE` (accumulating reference), `REBLUR_DIFFUSE_DIRECTIONAL_OCCLUSION`. **Removed:** `meterToUnitsMultiplier`, `isRadianceMultipliedByExposure`. **API:** stencil-like ops for material ID; helper to accumulate path length over bounces; normal/roughness packing helpers in `NRD.hlsli`; custom DXC path; static runtime; PS5 compatibility. **Behaviour:** better specular reprojection; orthographic projection supported (RELAX) / improved (REBLUR); REBLUR output closer to the reference, excessive blur on close-ups fixed, concave surfaces supported; RELAX more stable and responsive specular on uneven surfaces, right-handed camera fixed; NaN robustness. Integration: an instance can be reused for another set of inputs. |
| v2.12.1 | 2022-02-09 | CMake minimum 3.15; build fixes. |
| v2.12.2 | 2022-02-11 | Reference-accumulation fixes (stretching in reprojection). Linux warnings; bash scripts. |
| v3.0.0 | 2022-03-21 | **Settings reworked** (`UPDATE.md` introduced). REBLUR settings collapse into a shared `ReblurSettings`. Renames: `NRD_USE_MATERIAL_ID`, normal encodings `NRD_NORMAL_ENCODING_UNORM` / `_OCT`, `SpecularLobeTrimmingParameters`, `lobeAngleFraction` replaces `normalWeightStrictness`, `enableMaterialTestForDiffuse` / `ForSpecular` replace `materialMask`; RELAX `diffuseLobeAngleFraction` replaces `phiNormal`, plus `enableMaterialTest`, `roughnessFraction`, renamed reprojection-test settings. REBLUR exposes `enablePerformanceMode` (switchable at run time), `responsiveAccumulationRoughnessThreshold`, `inputMix`, `minConvergedStateBaseRadiusScale`, `roughnessFraction`. **New methods:** `SPECULAR_REFLECTION_MV`, `DELTA_OPTIMIZATION_MV` (motion-vector helpers; removed in v4.8). `REFERENCE` gets `IN_RADIANCE` / `OUT_RADIANCE`. `NRD_HEADER_ONLY`. **Behaviour:** better path-tracing compatibility; REBLUR low-roughness specular reprojection fixed, better disocclusions, more normal and shadow detail, better material-ID support; RELAX quarter resolution fixed, specular reprojection on concave surfaces; better checkerboard resolve with the pre-pass. PS5 / UE / Linux. |
| v3.1.0 | 2022-03-25 | Normal encoding selectable via CMake; `NRD_USE_OCT_NORMAL_ENCODING` and `NRD_USE_MATERIAL_ID` must be defined explicitly. Slang fixes. REBLUR firefly suppression always active, better with high-energy fireflies; reference mode no longer changes parameters; diffuse-only denoisers skip specular work. Integration mode without descriptor caching. |
| v3.2.3 | 2022-05-27 | **New:** probabilistic (lobe) sampling support (both). Hit-distance reconstruction (REBLUR `enableHitDistanceReconstruction`, RELAX `enableSpecularHitDistanceReconstruction`). Optional `CommonSettings::worldPrevToWorldMatrix` (for "virtual space" normals). `LibraryDesc` reports material bits and normal encoding. `ResourceType` → string. **Settings:** `PrePassMode` removed; REBLUR `enableAdvancedPrepass`, `diffusePrepassBlurRadius`, `specularPrepassBlurRadius`; RELAX `diffuseMinLuminanceWeight` / `specularMinLuminanceWeight` replace `minLuminanceWeight`, `diffuseHistoryRejectionNormalThreshold` removed. **Perf:** REBLUR ~13 %, RELAX ~17 % faster. RELAX memory optimized. **Behaviour:** less blurry, less leaky pre-pass; better orthographic support; better specular tracking; RELAX more stable, less biased specular at low roughness and better low–mid roughness reprojection; both better on contact reflections; REBLUR more stable specular reprojection, better at high frame rates. REBLUR expects radiance at real exposure. POSIX. |
| v3.3.0 | 2022-06-15 | `HitDistanceReconstructionMode` (3×3 and 5×5 area modes) replaces the enable booleans (both). REBLUR `residualNoiseLevel` removed. With probabilistic sampling, hit-distance reconstruction is assumed on. **Behaviour:** better hit-distance reconstruction, pre-pass and checkerboard quality and speed (both); REBLUR better history fix; RELAX black patches with very sparse signal fixed. |
| v3.3.1 | 2022-06-16 | REBLUR checkerboard regression and a specular-fallback bug fixed. |
| v3.4.0 | 2022-08-15 | **New denoisers:** `REBLUR_DIFFUSE_SH`, `REBLUR_SPECULAR_SH`, `REBLUR_DIFFUSE_SPECULAR_SH` (spherical-harmonics output). REBLUR TS can be turned off, removing its cost. `GetMethodString`. REBLUR `inputMix` removed. Front-end / back-end pack helpers renamed to normalized-hit-distance variants (`..._PackRadianceAndNormHitDist` etc.), `NRD_GetCorrectedHitDist` removed. RELAX `confidenceDrivenRelaxationMultiplier`, `confidenceDrivenLuminanceEdgeStoppingRelaxation`, `confidenceDrivenNormalEdgeStoppingRelaxation`. **Memory:** REBLUR reduced. **Behaviour:** better specular reprojection on curved surfaces (both); REBLUR better history reconstruction in disoccluded regions, laggy specular on bumpy surfaces fixed, less bias; RELAX better anti-firefly, better use of history confidence, faster. No output written for sky pixels. Integration reports memory usage. |
| v3.4.1–v3.4.3 | 2022-08-17 … 19 | Fixes: excessive blur at low roughness (regression), `REBLUR_DIRECTIONAL_OCCLUSION` bindings, over-blur after a history reset reduced, potential black outlines removed, checkerboard fixes. |
| v3.5.0 | 2022-08-30 | **Settings:** REBLUR `historyFixFrameNum`, `historyFixStrideBetweenSamples` replace `historyFixStrength`; RELAX `disocclusionFix*` renamed `historyFix*`. `REBLUR_FrontEnd_PackDirectionalOcclusion`. **Memory:** OCCLUSION and DIRECTIONAL_OCCLUSION denoisers "significantly" reduced. **Behaviour:** DIRECTIONAL_OCCLUSION fixed; occlusion darkening with very long history fixed; better anti-firefly; more stable specular tracking; fewer history drops for glossy specular; spatial filtering follows the specular lobe better; better disocclusions; a "darkening" bias fixed. |
| v3.6.0 | 2022-09-05 | `SpecularLobeTrimmingParameters` and `NRD_GetTrimmingFactor` removed. HLSL 2021 (WIP). Better SH denoising; IQ and speed; NaN-filled unused resource halves handled. |
| v3.7.0 | 2022-09-21 | `NRD_NORMAL_ENCODING` and `NRD_ROUGHNESS_ENCODING` (CMake) replace the two booleans; read-only `normalEncoding` / `roughnessEncoding` in `LibraryDesc`. REBLUR `enableAdvancedPrepass` removed ("low IQ gains, adds bias in SH mode"). `CLEAR_AND_RESTART` clears only history resources, including user-provided outputs. **Behaviour:** curvature fixes (one was a flipped direction); REBLUR fewer chroma shifts, SH lightness bias fixed, better specular tracking; RELAX dynamic-resolution specular regression fixed. |
| v3.8.0 | 2022-10-28 | Optional `NRDEncoding.hlsli`. **Per-pixel disocclusion threshold:** optional `IN_DISOCCLUSION_THRESHOLD_MIX` blends `disocclusionThreshold` with `disocclusionThresholdAlternate` (`isDisocclusionThresholdMixAvailable`). REBLUR `minConvergedStateBaseRadiusScale`, `maxAdaptiveRadiusScale` removed. RELAX anti-firefly respects material ID. **Behaviour:** REBLUR over-sharpening in disoccluded regions fixed, tuned against ghosting, specular confidence no longer too aggressive at high frame rates; RELAX better jitter handling; a material-ID rounding bug fixed. |
| v3.9.0 | 2022-11-11 | **Validation layer:** optional `OUT_VALIDATION` debug visualization via `CommonSettings::enableValidation` (was a creation flag). **2.5D motion vectors** (2D screen-space motion + delta viewZ; `motionVectorScale` becomes 3 floats). **Behaviour:** REBLUR better specular tracking, more robust under camera jitter; anti-lag with partial split screen fixed; no double clears for grouped denoisers. |
| v3.9.1 | 2022-11-17 | REBLUR: fewer history rejections and less ghosting "in certain cases"; resolution-scale regressions fixed. |
| v3.9.2 | 2022-12-05 | REBLUR laggy specular reprojection at zero roughness fixed. |
| v4.0.0 | 2022-12-20 | **Specular motion for upscalers:** optional `IN_BASECOLOR_METALNESS` (`isBaseColorMetalnessAvailable`) lets NRD patch `IN_MV` with specular motion where specularity is high, for TAA / DLSS / other upscalers (`specularProbabilityThresholdsForMvModification`). Removed again in v4.17.2. **API:** resource binding model reworked (constant buffer, samplers and resources in register spaces); renames (`isHistoryConfidenceAvailable`, `ResourceDesc`, `ResourceRangeDesc`, `ComputeShaderDesc`, `DescriptorPoolDesc`, plural counts); `frustumHeight` → `frustumSize`; `GetComputeDispatches` returns void; RELAX `enableSpecularVirtualHistoryClamping` removed. **Behaviour:** "significant" specular motion tracking improvements (both); REBLUR better disocclusions at zero roughness, `IN_DISOCCLUSION_THRESHOLD_MIX` was computed but ignored (fixed); RELAX better specular disocclusions, orthographic fixed. Validation shows RELAX history length. CMake rewritten. |
| v4.0.1 | 2022-12-21 | PlayStation compatibility; an STL dependency removed from `NRD.hlsli`. |
| v4.0.2 | 2023-01-16 | Better curvature estimation; REBLUR better specular tracking, reacts to "max accumulated frames" without a one-frame delay, diffuse denoisers use slightly less memory. |
| v4.1.0 | 2023-03-21 | **SH → SG:** the SH denoisers' SH resolve is replaced by a "higher quality & specular-compatible" spherical-Gaussian resolve; **re-jittering** after denoising, "essential for upscaling techniques". Helpers `NRD_SG_ExtractColor`, `NRD_SG_ExtractDirection`, `NRD_SG_ExtractRoughnessAA`, `NRD_SG_ResolveDiffuse`, `NRD_SG_ResolveSpecular`, `NRD_SG_ReJitter`, and `NRD_SH_ResolveDiffuse` / `_Specular` (comparison only). **RELAX gains SH denoisers.** ShaderMake; "significantly" shorter shader compile and link times; `NRD_HEADER_ONLY` removed. **Behaviour:** REBLUR better reprojection with varying roughness, accumulation at very high roughness fixed. Vulkan 1.3.239, Linux fixes. |
| v4.1.1–v4.1.2 | 2023-03-30, 04-05 | Minor fixes; README gives a feedback e-mail alias. |
| v4.2.0 | 2023-05-23 | **One instance, any mix of denoisers**, including repeats (e.g. two `RELAX_DIFFUSE` + `SIGMA_SHADOW`): `Identifier`, `SetCommonSettings`, `GetComputeDispatches` takes identifiers, `cameraJitterPrev`, `resolutionScalePrev`. Renames `Denoiser` → `Instance`, `Method` → `Denoiser`, `fullResolutionWidth/Height` → `renderWidth/Height`. Integration `NewFrame`. **Memory:** transient pool optimized for multi-denoiser instances; RELAX "significantly" less. **Perf:** faster sky-only frames. **Behaviour:** REBLUR anti-firefly rewritten, "significantly less biased, good cleaner of undenoised sporadic bright samples"; specular-occlusion-only denoiser fixed; y-inverted projection matrices handled. DLL version string carries the encoding. |
| v4.2.1 | 2023-05-30 | REBLUR no longer reads outside the DRS rectangle; projection-decomposition regression fixed. |
| v4.2.2 | 2023-07-04 | `NRD_SG_Rotate`. Choice of DXBC / DXIL / SPIR-V to embed. REBLUR NaN robustness outside the denoising range; anti-firefly with DRS fixed. |
| v4.3.0 | 2023-09-22 | **RELAX gains anti-lag** (`AntilagSettings`). **REBLUR anti-lag always on**, `ReblurAntilagSettings` replaces the intensity / hit-distance anti-lag settings. REBLUR `usePrepassOnlyForSpecularMotionEstimation`; `enableReferenceAccumulation` removed. **Behaviour:** REBLUR better with varying roughness, less trailing after roughness changes; zero hit distances handled better when reconstruction is off (both); SIGMA no longer too blurry on extreme (millimetre-scale) close-ups. Validation highlights zero-length history. aarch64 build fixed. |
| v4.3.1–v4.3.3 | 2023-09-28 … 10-18 | Linux shader workaround. Better 2D motion support; curvature better with low-precision normals. MV patching leaves unrelated MV channels alone. PDBs in the SDK. |
| v4.3.4 | 2023-10-24 | REBLUR better with highly varying (noisy) roughness; roughness-based disocclusion less sensitive to roughness noise; TS better at screen edges and in disocclusions; "snapping to screen edges" fixed (both). |
| v4.3.5–v4.3.6 | 2023-10-26, 11-03 | Integration descriptor-leak fix, pool optimizations. Less sensitive to INF in motion vectors. |
| v4.4.0 | 2023-12-27 | **Flexible DRS:** resources can be suballocated from a heap on the fly (`resourceSize` / `resourceSizePrev`, `rectSize` / `rectSizePrev`; `DenoiserDesc::renderWidth/Height` and `resolutionScale(Prev)` removed); `inputSubrectOrigin` → `rectOrigin`; no denoiser uses mips any more (mip fields removed); fewer samplers. GLSL support for `NRD.hlsli`. `NRD_FrontEnd_SpecHitDistAveraging_X` for averaging specular hit distance with many rpp. `identifier` in `DispatchDesc`. `NRD_USE_VIEWPORT_OFFSET`. `REFERENCE` uses `IN_SIGNAL` / `OUT_SIGNAL`. Removed `historyFixStrideBetweenSamples`, RELAX `enableReprojectionTestSkippingWithoutMotion` and RELAX's separate diffuse/specular settings structs. **Memory:** constant-data storage 2 MB → 128 KB. **Perf:** thread-group sizes tuned. **Behaviour:** less sensitive to NaN/INF outside the denoising range and DRS rectangle; SIGMA less bias, more stable; REBLUR better on thin objects, outlining on material boundaries fixed, colour bleeding from reflection disocclusions fixed, better specular reprojection in disocclusions. RELAX host code 181 KB → 99 KB. |
| v4.4.1–v4.4.3 | 2023-12-27 … 2024-01-02 | RELAX host-code regressions; `NRD_IsValidRadiance` fix; dependencies. |
| v4.5.0 | 2024-02-20 | `ResourceDesc::stateNeeded` → `descriptorType`. Shader `printf` (Vulkan). REBLUR: material ID now respected for reflection motion. |
| v4.6.0–v4.6.1 | 2024-03-20, 03-25 | REBLUR `blurRadius` → `maxBlurRadius`, new `minBlurRadius` (converged state); "no algorithmic changes". Shaders compatible with Vulkan 1.2; curvature improved; REBLUR less darkening at screen borders. |
| v4.7.0 | 2024-04-15 | **SIGMA TS can be disabled** (`stabilizationStrength`), "what makes SIGMA more useful for per-light shadow denoising if lights are many". `SigmaSettings::lightDirection` (directional lights only); `blurRadiusScale` removed; `SIGMA_BackEnd_UnpackShadow` usage clarified (opaque and translucent shadow). **Behaviour:** better umbra inside a wide penumbra (less umbra blur), less bias, opaque vs translucent mismatch fixed, less flicker where the blur radius is small. REBLUR minor speed-up. |
| v4.8.0 | 2024-05-09 | `CommonSettings::viewZScale` (better FP16 viewZ). **SIGMA multi-light friendly:** uses the shared `IN_VIEWZ` (no per-light viewZ copy); `IN_SHADOWDATA` → `IN_PENUMBRA`, `IN_SHADOW_TRANSLUCENCY` → `IN_TRANSLUCENCY`; front end split into `SIGMA_FrontEnd_PackPenumbra` (variants for infinite and local lights) and `SIGMA_FrontEnd_PackTranslucency`. `SPECULAR_REFLECTION_MV` and `SPECULAR_DELTA_MV` removed. |
| v4.8.1 | 2024-05-16 | REBLUR_SH fixes; minor speed-up. |
| v4.8.2 | 2024-06-14 | SIGMA: sub-pixel penumbrae no longer get a one-pixel blur; better multi-layered shadows ("a narrow penumbra inside a wide penumbra"); less flicker. |
| v4.9.0 | 2024-08-01 | **Hair and grass:** `CommonSettings::strandMaterialID`, `strandThickness` (adapting to sub-pixel-thick detail; works with `disocclusionThresholdAlternate` without the mix texture), `NRD_GetNormalizedStrandThickness`. `NRD_FrontEnd_TrimHitDistance`. REBLUR `hitDistanceStabilizationStrength` (AO/SO responsiveness), `fireflySuppressorMinRelativeScale`; `maxBlurRadius` meaning and default changed. Compile-time switches `NRD_USE_HISTORY_CONFIDENCE`, `NRD_USE_DISOCCLUSION_THRESHOLD_MIX`, `NRD_USE_BASECOLOR_METALNESS` to drop "almost dead and rarely used code". **Behaviour:** REBLUR better without TS, better in disocclusions and with short history ("much cleaner disocclusions"), less ghosting on varying roughness ("more roughness details"), better firefly suppressor; validation flags normalized hit distances outside [0, 1]; SIGMA rare small bleeding fixed; RELAX confidence / mix inputs honour the rect origin. |
| v4.9.0fix–v4.9.4 | 2024-08-05 … 09-20 | GCC fix. `MemoryAllocatorInterface` → `AllocationCallbacks`. REFERENCE split-screen / resolution fixes. Better MV patching. REBLUR potential edge smoothing fixed. |
| v4.10.0 | 2024-10-09 | **SIGMA "notable IQ improvements": less flickering in motion, better responsiveness**, rare one-pixel leaks fixed. REBLUR better specular tracking, including reflections on moving objects; `responsiveAccumulationRoughnessThreshold` fixed. RELAX viewZ FP16-compatible. Integration: initialization struct, `demoteFloat32to16`, `promoteFloat16to32`, `nrd::` namespace. |
| v4.11.0 | 2024-11-05 | **Time-based accumulation emphasized:** `GetMaxAccumulatedFrameNum` (time → frames), `DEFAULT_ACCUMULATION_TIME` and `MAX_HISTORY_FRAME_NUM` constants for all denoisers. **`CommonSettings::cameraAttachedReflectionMaterialID`** for mirror reflections of objects attached to the camera (REBLUR; "a suboptimal solution"). REBLUR/SIGMA `stabilizationStrength` → `maxStabilizedFrameNum`; REBLUR `hitDistanceStabilizationStrength` → `maxStabilizedFrameNumForHitDistance`, `luminanceAntilagPower` → `luminanceSensitivity`, `hitDistanceAntilagPower` → `hitDistanceSensitivity`. RELAX: one shared lobe fraction, user "max accumulated frames" clamped. Material ID keeps its range through pack/unpack. **Memory:** RELAX DIFFUSE dummy allocation removed. **Behaviour:** REBLUR anti-lag improved and "almost FPS independent"; a long-standing "bright lighting crawling" fixed; SIGMA ghosting at disocclusions removed, white outlines fixed. |
| v4.11.1 | 2024-11-11 | REBLUR: cleaner specular disocclusions, less "fluffy" / "boily" look, less "fatty" specular bias at glancing angles; `cameraAttachedReflectionMaterialID` tolerates relative camera motion; RELAX supports it too. |
| v4.11.2 | 2024-11-14 | `SetCommonSettings` returns `INVALID_ARGUMENT` on bad settings; `frameIndex` importance clarified; integration logs to files. |
| v4.11.3 | 2025-01-03 | **Perf:** ~3 % REBLUR/RELAX (cache reuse). `NRD_MaterialFactors` helper for application-side material demodulation, including roughness ("improved roughness details"). Less constant-data traffic. Integration can restore `UserPool` state. Specular corner cases improved. |
| v4.11.4 (+fixed) | 2025-01-21, 02-03 | Robustness: no reads of out-of-range / garbage pixels; checkerboard left-edge fix; critical pre-pass regression fixed. |
| v4.12.0 | 2025-02-06 | REBLUR/RELAX `historyFixBasePixelStride` (re)introduced. MathLib / ShaderMake via FetchContent; `NRDIntegration` interface target. REBLUR performance mode slightly faster. |
| v4.14.0 (+fixed) | 2025-03-03, 03-04 | **Perf:** REBLUR +6 % (non-SH), +10 % (SH). **Memory:** REBLUR −10 % in all modes. **REBLUR outputs are no longer used as history** (no inter-frame dependency on outputs). `minMaterialForDiffuse` / `minMaterialForSpecular` replace `enableMaterialTestFor…`. `minHitDistanceWeight` exposed, "handy for ReSTIR/RTXDI-produced signals". REBLUR hit-distance anti-lag settings and `maxStabilizedFrameNumForHitDistance` removed. **Behaviour:** more contact shadows regained; specular motion better on bumpy and wavy surfaces, worse on concave mirrors (old method kept behind `NRD_USE_SPECULAR_MOTION_V2`); lighter outline on material-ID borders fixed. |
| v4.14.1–v4.14.3 | 2025-03-07 … 20 | OCCLUSION denoisers broken with hit-distance reconstruction on: fixed. DIRECTIONAL_OCCLUSION memory −5 %. GCC; MathLib tag. |
| v4.15.0 | 2025-06-02 | **API:** `resourcesBaseRegisterIndex`, `constantBufferAndResourcesSpaceIndex`, reworked `DescriptorPoolDesc`, samplers in their own set. **Integration reworked:** wraps native D3D11 / D3D12 / Vulkan objects, `Recreate`, `autoWaitForIdle`, `ResourceSnapshot`. CMake `NRD_NRI`; `NRD_DISABLE_SHADER_COMPILATION` removed. **Behaviour:** better specular tracking in general, worse on concave surfaces; REBLUR rare light leaking fixed. |
| v4.15.1 (+fixed) | 2025-08-19, 08-20 | Compile-time specialization (slightly faster). REBLUR `enablePerformanceMode` becomes the compile-time `REBLUR_PERFORMANCE_MODE` ("low run-time value"). Arm64 including cross-compilation. |
| v4.16.0 | 2025-10-22 | 160+ hand-written shader permutations replaced by ShaderMake generation; custom shader builds (`shaderIdentifier`, `shaderEntryPoint`); `NRDEncoding.hlsli` → `NRDConfig.hlsli`, included by `NRD.hlsli`; register-space rework; `GetLibraryDesc` / `GetInstanceDesc` return pointers (C linkage). **Output:** history length can go in the `.w` of `OUT_` (REBLUR `returnHistoryLengthInsteadOfOcclusion`; RELAX returns it instead of squared variance). `historyFixAlternatePixelStride` + `CommonSettings::historyFixAlternatePixelStrideMaterialID` (e.g. camera-attached objects). REBLUR `fastHistoryClampingSigmaScale` exposed (RELAX's renamed to match), `ResponsiveAccumulationSettings`. **Behaviour:** REBLUR better disocclusions, better history reconstruction for glossy specular; REBLUR/SIGMA honour the denoising range; SIGMA better at screen edges. |
| v4.16.1 | 2025-11-10 | Better precision use of 10:10:10:2 normal encodings; hair (strand) tweaks; REBLUR orthographic specular fixed. |
| v4.17.0 | 2026-02-05 | **History confidence** support improved, "essential for responsive dynamic lighting" (README section "History confidence" added); `IN_DIFF_CONFIDENCE` / `IN_SPEC_CONFIDENCE` may be lower resolution (linearly upscaled) and no longer take the rect origin; confidence now also applies to REBLUR's reflection history. **SG resolve and re-jittering** "significantly improved", "essential … when paired with upscalers (DLSS/FSR/XeSS/TAAU)"; energy conservation of the SG/SH resolve fixed; `NRD_SG_ReJitter` drops a parameter and `NRD_SG_ResolveDiffuse` also takes view direction and roughness; `NRD_SG_ExtractRoughnessAA` removed (mismatched material demodulation). **Curvature overhaul:** "concave mirrors are functional again, convex mirrors look better, wavy surfaces now behave more predictably". REBLUR anti-firefly (`enableAntiFirefly`) "almost free" and "needed for upscalers". `ReblurConvergenceSettings`. Renames `ReblurHitDistanceParameters`, `ReblurReblurResponsiveAccumulationSettings`. Burley diffuse helper fixed. Apple/Clang build. |
| v4.17.1 | 2026-02-25 | REBLUR quality fixes "requested or inspired by and tested in *Dark Souls 2: PT*": robust to non-cleared, reused (render-graph) textures holding INF; brighter outlines on in-shadow geometry edges where history is discarded fixed; less anti-lag "blotchiness"; more contact detail in the converged state, specular contact shadows regression fixed; an undocumented option to skip NRD's copy of the g-buffer when the application keeps the previous one; slightly faster. |
| v4.17.2 | 2026-03-20 | **Removed** `IN_BASECOLOR_METALNESS` and MV patching ("largely misunderstood"; a "specular MV export" feature is promised) and `ReblurHitDistanceParameters::D`. **Behaviour:** REBLUR faster; less noise / pixelation on specular lobe boundaries; less bias and better shadow preservation in the radiance denoisers; "fat" reflections at very low roughness fixed; specular motion at very high roughness improved; occlusion-only fixes. |
| v4.17.3 | 2026-04-30 | **Perf:** RELAX SH 5.05 → 4.80 ms on RTX 4080 at 1440p. Critical artefact fix on some AMD configurations including Steam Deck (PC only). Integration `IntegrationCreationDesc::residencyPriority` ("game changer in VIDMEM-heavy scenarios"). Robustness to "bad" data; numerical fix near zero roughness in `NRD_SG_ResolveSpecular`. README section on low-discrepancy (blue-noise) samplers added. |
| v4.18.0 (pre-release) | 2026-10-09 | **Viewports:** `rectOrigin` → `inputRectOrigin` (applies to `IN_` except confidence and mix inputs); new `outputRectOrigin` (`NRD_SUPPORTS_VIEWPORT_OFFSET`; applies to `OUT_` and permanent resources including history; changing it means `CLEAR_AND_RESTART`). **`CommonSettings::motionVectorBias`** (MV unpacking and de-jittering). **`NRD_ComputeCavityShadow`** (SG-guided cavity shadows); less ringing in re-jittering. **Accumulation time-based** in REBLUR/RELAX to honour uneven frame pacing (`REBLUR_FRAME_RATE_COMPENSATION`, `RELAX_FRAME_RATE_COMPENSATION`); frame-time tracking fixed for repeated `SetCommonSettings`; pass a low-pass-filtered FPS to `GetMaxAccumulatedFrameNum`. **SIGMA:** checkerboard support, better spatial filtering and TS, better umbra in penumbra, `SIGMA_PRESERVE_SHADOWS_IN_PENUMBRA` (keeps darker shadows inside penumbrae). Slang; better GLSL; `NRD_SUPPORTS_QUAD_INTRINSICS` (quad intrinsics now allowed on consoles); Windows ARM64 / ARM64EC CI; CMake minimum 3.22 → 3.30; `NRD_FrontEnd_UnpackRoughness` removed; custom `NRD_INPUT` / `NRD_OUTPUT` take a policy argument. **Behaviour:** REBLUR specular tracking better on glossy surfaces, on camera-attached objects and on "flat surfaces with thin cavity lines (like tiles)"; "less reprojection ghosting left by bright foreground reflections (for low non-0 roughness)"; "specular smearing on surfaces perpendicular to the screen … during slow movement, such as strafing" fixed; better diffuse quality and disocclusion rejection. Zero hit distances: REBLUR/RELAX ignore them where possible, and they can legitimately come from rays pointing into the surface. RELAX hit-distance-reconstruction roughness weighting fixed. Validation detects projection-matrix and MV jitter. Docs: tracing vs denoising resolution, FPS-dependent accumulation, decoupling direct emission of primary surfaces. |

---

## 2. Behaviour claims by topic

"What does modern NRD handle that the 2021 design didn't?" Each line is a claim from the notes;
the versions are the releases that make it. Ours to test, not to copy.

### Diffuse (9)
- Bias / darkening biases fixed: v2.5.0, v3.5.0.
- Fewer chroma shifts: v3.7.0.
- Less "fluffy" / "boily" look: v4.11.1.
- Contact shadows and contact detail kept in the converged state: v3.0.0, v4.14.0, v4.17.1, v4.17.2.
- Better diffuse quality at disocclusion boundaries: v4.18.0.
- Ringing where the signal is badly defined fixed (RELAX): v2.5.0.
- No black patches with very sparse signal (RELAX): v3.3.0.
- Pre-pass less blurry and less leaky: v3.2.3.
- Expects radiance at real exposure: v3.2.3.

### Specular (18)
- Varying / noisy roughness (spatial and over time): v2.5.0, v4.1.0, v4.3.0 (less trailing after roughness changes), v4.3.4, v4.9.0.
- Mirror and near-mirror: over-blur at very low roughness fixed (v2.5.0), low-roughness reprojection (v3.0.0, v3.2.3), zero-roughness lag (v3.9.2), zero-roughness disocclusions (v4.0.0), "fat" low-roughness reflections (v4.17.2), near-zero-roughness SG resolve (v4.17.3).
- Curved reflectors: curved (v2.9.0, v3.4.0), concave (v2.12.0, v3.0.0), bumpy (v3.4.0), bumpy/wavy better but concave mirrors worse (v4.14.0, v4.15.0), then concave works again, convex better, wavy predictable (v4.17.0).
- Less smearing: v2.9.0; on surfaces perpendicular to the screen during slow strafing: v4.18.0.
- High frame rates: v3.2.3, v3.8.0.
- Contact reflections: v3.2.3.
- Glossy specular: fewer history drops (v3.5.0), better history reconstruction (v4.16.0), better tracking (v4.18.0).
- Spatial filter follows the lobe (v3.5.0); less noise / pixelation at lobe boundaries (v4.17.2).
- Less "fat" bias at glancing angles: v4.11.1.
- Reflections of camera-attached objects: v4.11.0, v4.11.1, v4.16.0, v4.18.0.
- Reflections on moving objects: v4.10.0.
- Flat surfaces with thin cavity lines (tiles): v4.18.0.
- Less ghosting from bright foreground reflections at low non-zero roughness: v4.18.0.
- Very high roughness: low-rpp darkening (v2.9.0), accumulation (v4.1.0), motion (v4.17.2).
- No colour bleeding from reflection disocclusions: v4.4.0.
- Specular motion handed to upscalers (MV patching): added v4.0.0, removed v4.17.2 (a "specular MV export" is promised).
- Many rpp: hit-distance averaging helper (v4.4.0); probabilistic lobe sampling (v3.2.3).
- Robust to camera jitter: v3.9.0, v4.18.0 (jitter detection in validation).

### Shadows, including moving shadows (20)
- SIGMA 2× faster: v2.5.0.
- Closer to the reference in umbra–penumbra regions: v2.5.0.
- No lag on hard shadows: v2.5.0.
- Not over-blurred on extreme (millimetre) close-ups: v4.3.0.
- Less bias, more stable: v4.4.0, v4.7.0.
- Many lights, one denoise per light: TS optional (v4.7.0), shared viewZ input, no per-light copy (v4.8.0).
- Directional lights get their own setting (`lightDirection`): v4.7.0.
- Umbra inside a wide penumbra: v4.7.0, v4.18.0 (`SIGMA_PRESERVE_SHADOWS_IN_PENUMBRA`).
- Translucent shadows match opaque ones: v4.7.0.
- Less flicker where the blur radius is small: v4.7.0, v4.8.2.
- Sub-pixel penumbrae are not blurred by a pixel: v4.8.2.
- Multi-layered shadows (narrow penumbra inside a wide one): v4.8.2.
- **Moving shadows: less flickering in motion, better responsiveness**: v4.10.0.
- Ghosting at disocclusions removed: v4.11.0.
- White outlines removed: v4.11.0.
- Small leaks / bleeding removed: v4.9.0, v4.10.0.
- Better at screen edges: v4.16.0.
- Checkerboard (half-rate) shadow input: v4.18.0.
- Shadow detail inside the lighting denoisers (contact shadows, in-shadow edges): v3.0.0, v4.14.0, v4.17.1, v4.17.2.
- Cavity shadows from the SG data (helper): v4.18.0.

### Occlusion (8)
- AO / SO denoisers added: v2.9.0; directional occlusion: v2.12.0 (broken and fixed in v3.4.2, v3.5.0).
- Memory: "significantly" less (v3.5.0), DIRECTIONAL_OCCLUSION −5 % (v4.14.1).
- No darkening with very long history: v3.5.0.
- AO/SO responsiveness setting: v4.9.0, its replacement v4.11.0, removed v4.14.0.
- Specular-occlusion-only denoiser fixed: v4.2.0.
- Occlusion with hit-distance reconstruction fixed: v4.14.1.
- History length can replace the occlusion in `.w`: v4.16.0.
- Occlusion-only mode fixes: v4.17.2.

### SH / SG (10)
- REBLUR SH denoisers: v3.4.0; RELAX SH denoisers: v4.1.0.
- SH bias / quality fixes: v3.6.0, v3.7.0, v4.8.1.
- SG resolve replaces SH resolve ("higher quality & specular-compatible"): v4.1.0.
- Re-jittering after denoising for upscalers: v4.1.0, v4.17.0 ("significantly improved"), v4.18.0 (less ringing).
- SG rotation helper: v4.2.2.
- Energy conservation of the resolve fixed: v4.17.0.
- Roughness-AA extraction removed (material demodulation mismatch): v4.17.0, v4.17.3.
- Resolve takes view direction and roughness: v4.17.0.
- Cavity shadows from SG: v4.18.0.
- Perf: REBLUR SH +10 % (v4.14.0); RELAX SH 5.05 → 4.80 ms at 1440p on RTX 4080 (v4.17.3).

### Disocclusion and history (14)
- Fewer history rejections: v2.5.0, v3.9.1.
- Better behaviour in disocclusions: v3.0.0, v3.4.0, v3.5.0, v4.9.0 ("much cleaner"), v4.16.0, v4.18.0.
- Over-sharpening in disoccluded regions fixed: v3.8.0.
- Per-pixel disocclusion threshold (`IN_DISOCCLUSION_THRESHOLD_MIX`): v3.8.0; strands without the texture: v4.9.0.
- Less ghosting: v3.8.0, v3.9.1, v4.9.0 (varying roughness), v4.18.0 (bright foreground reflections).
- Short history handled better: v4.9.0.
- Cleaner specular disocclusions: v4.11.1.
- History length exposed (validation v4.0.0, zero-length highlight v4.3.0, output `.w` v4.16.0).
- Reset semantics: `accumulationMode` (v2.9.0), `CLEAR_AND_RESTART` clears only history (v3.7.0), viewport change implies restart (v4.18.0).
- Outputs not used as history (apps may overwrite them): v4.14.0.
- Time-based accumulation: v4.11.0, v4.18.0.
- Rare light leaking fixed: v4.15.0.
- History survives dynamic-resolution changes: v2.10.0, v4.4.0.
- TS better at screen edges and in disocclusions: v4.3.4.

### Anti-lag and reactivity (10)
- User-provided history confidence: added v2.9.0, better used by RELAX v3.4.0, called "almost dead and rarely used" v4.9.0, then "essential for responsive dynamic lighting" and allowed at lower resolution v4.17.0.
- RELAX anti-lag: v4.3.0; REBLUR anti-lag always on: v4.3.0.
- Anti-lag "almost FPS independent": v4.11.0.
- Less anti-lag "blotchiness": v4.17.1.
- Responsive accumulation (by roughness): v3.0.0, v4.10.0, v4.16.0.
- Hard-shadow lag (v2.5.0) and SIGMA responsiveness in motion (v4.10.0).
- Less trailing after roughness changes: v4.3.0.
- "Bright lighting crawling" fixed: v4.11.0.
- Reacts to a new "max accumulated frames" without a one-frame delay: v4.0.2.
- Stabilization optional / counted in frames (`maxStabilizedFrameNum`): v3.4.0, v4.7.0, v4.11.0.

### Performance (14)
- SIGMA 2× (v2.5.0); RELAX checkerboard at 0.5 rpp (v2.5.0).
- REBLUR ~13 %, RELAX ~17 % (v3.2.3).
- TS can be turned off to save its cost (v3.4.0, SIGMA v4.7.0).
- "Significantly" shorter shader compile / link times (v4.1.0).
- Faster sky-only frames (v4.2.0).
- Thread-group size tuning (v4.4.0).
- ~3 % REBLUR/RELAX (v4.11.3).
- REBLUR performance mode slightly faster (v4.12.0); made compile-time (v4.15.1).
- REBLUR +6 % non-SH, +10 % SH (v4.14.0).
- Compile-time specialization (v4.15.1).
- Anti-firefly "almost free" (v4.17.0).
- REBLUR slightly faster (v4.17.1, v4.17.2).
- RELAX SH 5.05 → 4.80 ms, RTX 4080, 1440p (v4.17.3).
- SIGMA/RELAX slightly faster (v4.18.0).

### Memory (10)
- RELAX optimized (v3.2.3), "significantly" less (v4.2.0), DIFFUSE dummy allocation removed (v4.11.0).
- REBLUR reduced (v3.4.0), diffuse slightly (v4.0.2), −10 % in all modes (v4.14.0).
- OCCLUSION / DIRECTIONAL_OCCLUSION "significantly" reduced (v3.5.0), DIRECTIONAL_OCCLUSION −5 % (v4.14.1).
- Transient pool shared across denoisers in one instance (v4.2.0).
- Constant-data storage 2 MB → 128 KB (v4.4.0).
- Integration reports memory usage (v3.4.0); residency priority for VIDMEM-heavy cases (v4.17.3).

### Thin geometry, hair and materials (7)
- Thin objects: v4.4.0.
- Hair and grass (strand material ID and thickness, sub-pixel detail): v4.9.0, v4.16.1.
- Material-ID-aware filtering: v2.9.0, v3.0.0; outlining / lighter outlines on material boundaries fixed: v4.4.0, v4.14.0.
- Material ID respected for reflection motion: v4.5.0.
- Flexible material tests (`minMaterialFor…`): v4.14.0.
- Roughness detail kept by application-side demodulation helper: v4.11.3.
- ReSTIR / RTXDI-produced signals get a dedicated setting (`minHitDistanceWeight`): v4.14.0.

### Inputs, cameras and robustness (10)
- 2.5D motion vectors: v3.9.0; better 2D motion: v4.3.2; MV bias / de-jitter: v4.18.0.
- INF in motion vectors tolerated: v4.3.6.
- NaN / INF outside the denoising range or DRS rectangle tolerated: v4.2.2, v4.4.0.
- Non-cleared, reused textures holding INF tolerated: v4.17.1.
- Zero hit distance: handled when reconstruction is off (v4.3.0); ignored where possible, may come from rays into the surface (v4.18.0); probabilistic sampling assumes reconstruction (v3.3.0).
- Normalized hit distance outside [0, 1] flagged by validation: v4.9.0.
- FP16 viewZ: v4.8.0, v4.10.0.
- Orthographic projection: v2.12.0, v3.2.3, v4.16.1; y-inverted projection: v4.2.0; right-handed camera: v2.12.0.
- Lower-resolution confidence inputs: v4.17.0.
- Uneven frame pacing: v4.11.0, v4.18.0.

---

## 3. Implications for our test bed

Scenarios to add to our captures because NRD's notes claim to handle them. They are test
scenarios, not solutions. "Nearest existing" names a capture id that may cover part of it, by name
only; check the capture before relying on it.

| # | Scenario | What to score | Why (NRD versions) | Nearest existing |
|---|---|---|---|---|
| T1 | **Moving occluder** over a receiver, once with a hard (point / tiny area) light and once with a wide area light; also the occluder stopping dead | Penumbra flicker during motion, lag / ghost trail behind the occluder, settle time after it stops | v2.5.0, v4.10.0, v4.11.0 | M4 `moving-knot` |
| T2 | **Light change with static geometry**: a light switched on/off, and a light moved quickly | Frames to reach the new level (lag), overshoot; a run with and without a history-confidence-style input | v2.9.0, v4.17.0 | `std540-light` |
| T3 | **Hard and sub-pixel penumbrae**: a contact shadow plus a very small light | Penumbra width preserved, no extra blur, no lag | v2.5.0, v4.8.2 | — |
| T4 | **Nested penumbrae**: a small occluder close to the receiver inside the wide penumbra of a large occluder; an umbra inside a wide penumbra | Umbra darkness kept, inner penumbra not washed out | v4.7.0, v4.8.2, v4.18.0 | — |
| T5 | **Many lights**, one shadow signal per light | Cost per added light, quality with per-light history off | v4.7.0, v4.8.0 | — |
| T6 | **Extreme close-up**: camera millimetres from a shadowed, lit surface | Over-blur of shadows and lighting | v2.12.0, v4.3.0 | — |
| T7 | **Mirror and near-mirror specular** (roughness 0, near 0, low non-zero) with a bright foreground object reflected while the camera moves | Lag, ghost trails, reflection width ("fat" reflections) | v3.9.2, v4.0.0, v4.17.2, v4.18.0 | `std540-glossy` |
| T8 | **Curved reflectors**: concave mirror, convex mirror, wavy and bumpy surfaces, camera orbiting | Reflection lag / smear per surface type | v3.4.0, v4.14.0, v4.15.0, v4.17.0 | — |
| T9 | **Varying roughness**: a high-frequency roughness texture, and roughness animated over time | Roughness detail kept, trailing after the change | v2.5.0, v4.3.0, v4.3.4, v4.9.0 | — |
| T10 | **Strafing past a grazing surface**: slow sideways camera motion past a glossy floor or wall nearly edge-on; glancing-angle specular | Smearing, "fat" glancing highlights | v4.11.1, v4.18.0 | `std540-pan` |
| T11 | **Tiled floor**: flat glossy tiles with thin grout lines, plus contact shadows and contact reflections at object bases | Grout lines kept in reflections and lighting, contact shadows kept after convergence | v3.2.3, v4.14.0, v4.17.1, v4.18.0 | — |
| T12 | **Thin geometry and strands**: sub-pixel wires, fences, a hair / grass card patch | Thin features kept, no ghosting when they move | v4.4.0, v4.9.0, v4.16.1 | `std540-thin` |
| T13 | **Reflections of moving objects** and of a **camera-attached object** (first-person prop) seen in a mirror | Reflection lag, ghosting, smearing | v4.10.0, v4.11.0, v4.16.0, v4.18.0 | `std540-object` |
| T14 | **Material boundaries**: metal next to dielectric, different material IDs side by side | Halos / outlines along the boundary | v4.4.0, v4.14.0 | — |
| T15 | **Disocclusion with short history**: an object sliding away to reveal background, a camera cut, a reflection disoccluding | Frames 0–N after reveal: noise, over-sharpening, colour bleeding | v3.8.0, v4.4.0, v4.9.0, v4.16.0 | `std540-cut`, `std540-object` |
| T16 | **Uneven frame pacing**: replay one path with jittered frame times / frame drops | Lag and noise vs the same path at steady rate | v4.11.0, v4.18.0 | — |
| T17 | **Resolution changes and reduced inputs**: dynamic resolution change mid-sequence; a confidence input at lower resolution | History kept across the change, no edge artefacts | v2.10.0, v4.4.0, v4.17.0 | — |
| T18 | **Fireflies**: sparse, very bright samples over a converged region, sustained for many frames | Firefly residue, slow "crawling" brightness | v4.2.0, v4.11.0 | — |
| T19 | **Bad inputs**: INF/NaN in motion vectors and outside the denoising range, sky-only frames, uncleared reused textures | No NaN propagation, no garbage at borders | v4.3.6, v4.4.0, v4.17.1 | — |
| T20 | **Zero / missing hit distance**: rays going below the surface, lobes not sampled (probabilistic selection) | Specular tracking with zero hit distances present | v3.3.0, v4.3.0, v4.18.0 (ties to the TASKS capture item on `*_hitt = 0`) | — |
| T21 | **Sparse input**: checkerboard / 0.5 rpp for lighting and for shadows | Quality vs full rate | v2.5.0, v3.3.0, v4.18.0 | — |
| T22 | **Jittered camera** (TAA/upscaler-style sub-pixel jitter) | Stability, no jitter amplified into flicker | v3.9.0, v4.18.0 | — |

---

## 4. Excluded

About **417** items were left out under the exclusion rule (lines stating a formula, threshold,
constant, default value, pass order or structure, data layout, internal weight or test, or an
algorithm name not already public). Counted once per release in which the line appears; 9 of them
are from `UPDATE.md`. Lines left out only because they had no bearing on denoising (sample-app,
NRI, MathLib and refactoring notes, CI) are not counted.
