# Audit handoff (reviewed copy): public-research prompt

_Reviewed copy of Dennis's external auditor's `clean-agent-public-research-prompt.txt` (2026-10-26, snapshot
66c4c66, final check 8cf32bc). Clean review: [codex-audit-2026-10-26-review.md](../reviews/codex-audit-2026-10-26-review.md) — **pass with redactions**: three clauses
removed, each marked `[redacted: reason]`. Otherwise the text is verbatim (headings added for reading). The original
stays outside the repo; implementers read only this copy. **Read with the review's staleness notes**: the shadow
experiments it calls uncommitted are committed (1a2861a) and measured (results/SHADOWS-LOOK.md), and much of task 1
is answered there. The reading list's order is a priority, not information about NRD._

---

**Continue the existing denoiser work with focused diagnostics and public-source research**


Repository: /Users/dex/Developer/Denoiser-nrd-cleanroom  
Branch: feat/rt-denoiser-cleanroom  
Audit snapshot: 66c4c6604d66e8711c7c5188290553e3be51656a, 2026-10-26.  
Recheck HEAD, current defaults and working-tree changes before beginning.  
Final status check: HEAD advanced to 8cf32bcb8b67f49a37557aa5bc18623e6987cb1f, adding only a task-board entry for optional upscaler guides. The inspected package implementation was unchanged by that commit.  

Use our existing implementation and public research. Read this project's RULES.md, TASKS.md, PROVENANCE.md and the accepted filtered review-targets document. Apply the project's required clean review to this new handoff before implementation use. Do not read NRD source, ports, raw README/release material excluded by the rules, or quarantined originals. This handoff contains our own implementation/results, independently published references, and proposed observable tests. It makes no claim to reproduce current NRD internals.  

The existing filtered handoff is:  
/Users/dex/Developer/Denoiser-nrd-cleanroom/docs/research/rt-denoiser/sources/nrd-review-targets.md  

We are extending completed work, including 2021-derived recurrent filtering, SVGF/A-SVGF, reflection-motion support, directional lighting and translucent shadows. Do not start from scratch or assume these features are missing. Distinguish the shipped configuration, optional alternatives, and active uncommitted experiments. Current shadow files have active edits; coordinate before touching them. Do not overwrite another agent's work.  

First read the recent evidence:  
- docs/research/rt-denoiser/results/scenes-bistro-sponza.md
- docs/research/rt-denoiser/results/T1-recovery.md
- docs/research/rt-denoiser/results/M2-M3.md
- docs/research/rt-denoiser/results/M4.md
- docs/research/rt-denoiser/results/E1-high-reference.md
- docs/research/rt-denoiser/native/results/ROUND2.md
- docs/research/rt-denoiser/TASKS.md, especially target D and the shadow follow-ups.
Paths in this list are relative to the repository above. Treat each historical measurement as belonging to its recorded revision and input set.  

## 1. Diagnose shadow quality during motion first

Reproduce bistro-move on the exact shipped baseline and a pinned snapshot of any active shadow experiment. The recorded ab3f4d7 evaluation has raw visibility ahead of our denoiser: 24.42 versus 22.69 dB, FLIP 0.017 versus 0.050. The loss starts at frame zero, so a temporal-only explanation is insufficient. Existing wide-penumbra stabilization helped the original knot scene, but that does not establish that hard moving edges or real asset scenes are solved.  

Separate camera-only, light-only and occluder-only motion, plus a fully frozen scene. Include small local lights with near-hard shadows and broad sun penumbrae. Include stop/hold and reverse-motion intervals. Retain the no-history first-frame control and raw input as baselines. Inspect the existing look-comparison crops if available.  

Score hard boundaries, contact, penumbra, static and genuinely changing regions separately. Use motion-compensated boil/flicker, pooled PSNR, FLIP, shadow bias, edge sharpness and visible trailing. Include a reference-noise control. On a moving camera, a screen-space dynamic mask can select resampling rather than changing illumination; verify what each mask means before interpreting its score. A blurrier shadow cannot pass just because its boil is lower.  

Deliver a cause/evidence table before proposing a fix: reproduced symptom, affected scene, whether it exists before history, whether it persists in a frozen control, and what remains uncertain. Then evaluate independently justified candidates under options.  

## 2. Establish reflection tracking coverage with known geometry

Inventory what each actual configuration does today. The recurrent path already implements virtual motion and curvature handling. The current SVGF specular default follows surface motion and does not use hit distance for reflection reprojection. Do not mistake the capabilities of one option for those of every option, or assume the more complex option wins overall.  

Extend the existing analytic test renderer. It already uses exact sphere, box and plane intersections; an SDF implementation is not a prerequisite. If signed-distance-field scenes are useful, independently validate their marching/intersection tolerances. Preserve exact primitive controls.  

Create small deterministic scenes with a high-contrast reflected marker and known geometry:  
- stationary planar reflector, camera motion only;
- stationary camera/reflector, reflected-object motion only;
- stationary camera/reflected object, reflector translation or rotation only;
- convex and concave reflectors, grazing views, and near/far reflected objects;
- true geometric curvature versus normal-mapped detail;
- a roughness sweep, reflection visibility changes, stop/hold and camera cuts.

Validate camera projection/unprojection, primary positions/normals, secondary-hit identity/distance, and reflected-feature locations against an independent CPU analytic or geometric oracle. Do not use the denoiser's own virtual-position or curvature approximation as ground truth. Use clean/high-sample reflection inputs to isolate correspondence errors from Monte Carlo noise. A single exact feature correspondence may be inappropriate for rough reflections; compare their high-sample appearance and temporal error as well.  

Report specular pooled PSNR, FLIP, motion-compensated error, reference feature-position error where meaningful, trail length/decay, duplicate edges and post-stop recovery. Compare the shipped default, existing recurrent option and suitable existing controls on identical inputs. Separate SSR tests from traced/demodulated reflection tests. Add traced real-scene reflection captures if the existing SSR inputs cannot answer the question.  

Use the public reading list below to derive any candidate independently. The purpose of these tests is to establish which visible failures actually remain, not to mandate a particular reprojection formula.  

## 3. Test distance information and long-duration stability

Continue the already queued target D rather than opening a duplicate task. No committed measurement currently establishes long-duration guide degradation. Treat it as a hypothesis.  
Also note the new optional-upscaler-guides task at 8cf32bc. It already requests measuring detection quality before adding inputs; coordinate with that task rather than creating another copy.  

Use known-distance analytic scenes, near/far secondary hits, hit/miss transitions, contact shadows and thin occluders. Run at least 300-frame stationary holds, plus slow motion followed by a hold, as requested by the task board. Compare an identical final view reached through different histories. Include the glossary of actual input units, camera-depth convention, normalized versus physical distances, and miss versus absent-sample semantics.  

Have the clean researcher define diagnostic instrumentation from our own implementation: raw input versus historical distance/scale, mean brightness, contact/detail contrast and per-frame regional image error. Determine whether any change is continuing drift, a biased plateau, ordinary sampling variance, or a change in the input signal. Repeat a focused case on Metal and RTX where possible because the project has already measured device-specific f16 storage behavior.  

Separate correctness tests with physically consistent geometry from deliberate input perturbation tests. Do not treat an arbitrarily rescaled distance buffer as a physically valid reference scene. [redacted: design hint about distance representation, beyond target D's what-level], and do not prescribe a replacement before reproducing a problem.  

## 4. Finish the disocclusion evaluation already underway

The spatial-repair option already exists and has measured gains: +0.67 dB diffuse and +0.43 dB specular pooled over its recorded capture set, with stronger boundary gains. It also increased boil and lost quality immediately after a cut, so it failed the current adoption gate. Preserve both sides of that result.  

Add a patterned-background reveal with narrow strips and wide reveals, followed by a stationary hold. Score the same newly revealed surfaces over time, not just unrelated pixels grouped by history age. Track recovery to a fixed reference-based band, boundary leakage, mid-scale blotches, FLIP and boil together.  

The SVGF young-history normal option has separate promising results and pending timing/look approval. Confirm its status before duplicating work. Research any further candidate from the cited papers and our own measurements; an architectural resemblance is not an acceptance criterion.  

## Public reading list, independently published sources

R1. Eto, Meunier, Harada and Boisse, 2023. Real-Time Rendering of Glossy Reflections Using Ray Tracing and Two-Level Radiance Caching.  
https://gpuopen.com/download/publications/SA2023_RealTimeReflection.pdf  
Read section 2.4, especially 2.4.2: it explicitly publishes dual-source temporal reflection reprojection. The paper's renderer also uses radiance caches; adopting those caches is not required by this task. Its distance in the spatial weighting discussion is a tangent-plane separation, not a universal substitute for secondary-ray hit distance.  

R2. Rodriguez, Leimkuhler, Prakash, Wyman, Shirley and Drettakis, 2020. Glossy Probe Reprojection for Interactive Global Illumination.  
https://www-sop.inria.fr/reves/Basilic/2020/RLPWSD20/  
Author PDF: https://cwyman.org/papers/siga20_glossyProbeReprojection.pdf  
Read sections 4.3, 5.1 and 6 for geometric curvature, reflected-position estimation and glossy footprints. This is a precomputed, static-scene probe method, not a drop-in temporal denoiser or evidence of NRD's current design.  

R3. Mara, McGuire, Bitterli and Jarosz, 2017. An Efficient Denoising Algorithm for Global Illumination.  
https://benedikt-bitterli.me/mmbj/mmbj.pdf  
Read the reconstruction discussion around Figure 2 and the results/limitations. It publicly discusses virtual reflected positions, disocclusion handling and the remaining difficulty of moving glossy objects. Useful historical groundwork beyond treating every signal as surface motion.  

R4. Schied et al., 2017. Spatiotemporal Variance-Guided Filtering.  
https://research.nvidia.com/labs/rtr/publication/schied2017spatiotemporal/  
Author PDF: https://cg.ivd.kit.edu/publications/2017/svgf/svgf_preprint.pdf  
Read sections 4.1-4.3, especially 4.2 on limited history after disocclusion. Its spatial fallback concerns variance estimation; [redacted: comparative statement about another denoiser's internal history repair, not needed for implementation]. Our SVGF implementation already exists.  

R5. Igehy, 1999. Tracing Ray Differentials.  
https://www.graphics.stanford.edu/papers/trd/  
Public geometric foundation for how ray footprints change through propagation and reflection. This supports distance/footprint reasoning; [redacted: disclaimer naming design choices for a modern denoiser's distance data, possible steer from a source-exposed author].  

R6. Mehta, Wang and Ramamoorthi, 2012. Axis-Aligned Filtering for Interactive Sampled Soft Shadows.  
https://cseweb.ucsd.edu/~viscomp/classes/cse274/fa18/papers/a163-mehta.pdf  
Public sampling/filtering analysis for soft shadows and their geometric scale. Useful for evaluating hard-edge versus wide-penumbra tradeoffs. It is not a temporal-boil fix by itself.  

R7. Schied, Peters and Dachsbacher, 2018. Gradient Estimation for Real-Time Adaptive Temporal Filtering.  
https://cg.ivd.kit.edu/publications/2018/adaptive_temporal_filtering/adaptive_temporal_filtering.pdf  
Research on distinguishing shading changes from noise and balancing temporal response against stability. Our A-SVGF implementation already exists; identify a demonstrated missing capability before adding another detector.  

R8. Heitz, Hill and McGuire, 2018. Combining Analytic Direct Illumination and Stochastic Shadows.  
https://casual-effects.com/research/Heitz2018Shadow/index.html  
Useful when checking whether the supplied shadow signal and final lighting composition preserve shading detail. It addresses signal formulation; it does not demonstrate that a particular boiling problem has been solved.  

R9. Panteleev, 2020. Rendering Perfect Reflections and Refractions in Path-Traced Games.  
https://developer.nvidia.com/blog/rendering-perfect-reflections-and-refractions-in-path-traced-games/  
The primary-surface-replacement discussion provides public flat-mirror motion/position reasoning. The post explicitly excludes curved surfaces and moving mirrors from that derivation. Use those limitations when designing controls, not as a promise of general reflection tracking.  

The references are research foundations. No listed source is asserted to specify the precise modern distance-handling or repair changes from the separate source-informed audit. Derive designs from the publications themselves and log exact supporting sections in PROVENANCE.  

## Acceptance and deliverables

Follow current TASKS rule 9, including the 4096-spp reference requirement for diffuse/specular/AO decisions. Every new technique is optional; verify unchanged default output byte for byte. Run the seven standard paths and the real-scene captures, with native output comparison where integration is controlled. Do not adopt an option solely because PSNR improves while boil, lag or detail gets worse.  

Deliver: (a) a source/configuration coverage table; (b) deterministic reproductions and geometric-oracle checks; (c) pinned baseline/candidate results, image sequences and cost; (d) explicit findings versus hypotheses; (e) the highest-value improvement that actually passes the gate. Keep native integration questions separate from filter-quality conclusions. Do not claim a global percentage of NRD parity from the current capture set.  

Start with the moving-shadow reproduction and the reflection test matrix; continue independent tasks while any approval or external native run is pending.  
