# NRD review targets for the existing denoiser

Status: filtered handoff, pending review by the project's clean reviewer before implementation use. Prepared 2026-10-25 by the source-informed reviewer, acting only as a filter and evaluator.

Clean review 2026-10-25: **passed, no redactions**; implementers may read this file ([review](../reviews/nrd-review-targets-review.md)).

These are observable quality targets for the existing library. They prescribe no implementation technique. Their order reflects estimated visual impact, rather than a measured ranking against current NRD. The public references provide background for the image-quality problems; they do not establish how current NRD solves them. No current-NRD parity claim follows from this document.

## Evaluation agreement

Use the current shipped configuration at a pinned revision as the primary baseline, and the strongest existing alternative for each signal as a control. Record the actual selected denoiser and resolved options: older results may represent different defaults. The repository was at `c9c80225d3958f52c538e9595be1020921e99cfd` during preparation, with other work in progress. Historical results below identify useful tests, not new measurements at that revision.

For each target, run baseline and candidate on identical captures, noise samples, references, exposure, resolution and hardware. Check repeat variation before claiming a small gain. Compare pooled PSNR, FLIP and temporal measures together, including the relevant static, dynamic, penumbra and disoccluded regions; record cost. Do not accept a quieter image if it merely trails motion, loses detail or changes the intended colour.

The common regression gate is [TASKS rule 9](../TASKS.md): no regression beyond −0.1 dB pooled PSNR, +5% FLIP, +5% boil/flicker in any applicable region, or +10% cost. These are this project's adoption criteria. A target also needs the specific improvement stated below, beyond measured repeat variation. An inconclusive difference does not pass. Test all seven standard paths and real-scene captures, with native comparison where applicable. New behaviour remains optional; preserve the existing default output bit for bit. Record results before proposing a default change for Dennis's approval.

Capture names and replay instructions are in [CAPTURES](../../../../examples/realtime-denoiser/CAPTURES.md). Longer sequences and new scenarios below require new captures; short replays cannot establish long-term stability. When a requested region or temporal comparison is not yet reported by the harness, the evaluator should add that measurement before assigning a pass.

## 1. Newly visible regions and camera cuts

- **Area:** recovery after disocclusion and reset.
- **Target behaviour:** a newly exposed surface becomes clean sooner, retains its boundaries, and carries no recognisable image of the previous foreground. After a cut, the old view must not remain visible. Faster recovery must not spread colour or shadow across depth edges.
- **Test scenario:** `examples/realtime-denoiser` paths `pan`, `cut` and `object`; replays `std540-pan`, `std540-cut`, `std540-object`; real-scene `three-pan`. Add a moving foreground panel that reveals a patterned, indirectly lit background, followed by a fully stationary interval. Test both narrow newly exposed strips and wide reveals, including contrasting surfaces across the revealed boundary. Include diffuse, specular, shadows and occlusion where those signals exist.
- **Metric and pass criterion:** improve pooled PSNR and FLIP in the disoccluded and post-cut regions over the same event windows. Report per-frame recovery curves and the first sustained return to a common, reference-based error band fixed before comparing candidates. Pass requires earlier recovery, no worse boundary error, and the common regression gate. Record observed frame counts; no NRD-derived convergence count is specified.
- **Public source:** [SVGF, Schied et al. 2017, section 4.2](https://cg.ivd.kit.edu/publications/2017/svgf/svgf_preprint.pdf), specifically its discussion of limited history after disocclusion; [Edge-Avoiding À-Trous Wavelet Transform for Fast Global Illumination Filtering, Dammertz et al. 2010](https://doi.org/10.2312/EGGH/HPG10/067-075), for independent spatial reconstruction research; and [A Survey of Temporal Antialiasing Techniques, Yang et al. 2020](https://diglib.eg.org/items/cfa6a05c-53b3-4ee1-979d-48abc6225f6b), for temporal image artefacts. These are research leads, not claims of equivalence to another denoiser's implementation.
- **What our code does today:** multiple temporal denoisers, recovery behaviour and these test paths already exist. Give this evaluation first priority, comparing the current recurrent option with the strongest existing control. Use the public sources to investigate independently justified candidates only if a visible gap is reproduced; this is an improvement target for existing functionality.

## 2. Moving reflections and glossy detail

- **Area:** specular stability during camera and object motion.
- **Target behaviour:** reflected features follow the reference without visible dragging, duplicate edges, sudden jumps or persistent smearing. Smooth and rough materials should both remain stable, including curved surfaces and grazing views.
- **Test scenario:** `glossy`, `orbit` and `object`; `std540-glossy`, `std540-orbit` and `three-orbit`. Add a glossy curved object reflecting a high-contrast strip, with separate camera-only and object-only motion, then a stop. Include a roughness sweep and both near and distant reflected objects.
- **Metric and pass criterion:** improve specular pooled PSNR and FLIP in the dynamic region and affected roughness bins, subject to the common gate. Inspect aligned reference/candidate sequences for trails and duplicated features; report errors after motion stops. A gain confined to rough surfaces must not hide a regression on smooth surfaces.
- **Public source:** [PBRT, Roughness Using Microfacet Theory](https://www.pbr-book.org/4ed/Reflection_Models/Roughness_Using_Microfacet_Theory) for the expected material appearance; the [TAA survey](https://diglib.eg.org/items/cfa6a05c-53b3-4ee1-979d-48abc6225f6b) for temporal artefacts.
- **What our code does today:** specular filtering and motion support already exist. The recorded [high-reference evaluation](../results/E1-high-reference.md) shows that rankings depend on the path and roughness region. Reproduce those comparisons against the current revision rather than treating one existing option as universally best.

## 3. Changing illumination on stationary geometry

- **Area:** lighting response without a geometry change.
- **Target behaviour:** light movement, switching and colour changes appear promptly, without an old bright patch, shadow or tint lingering. Regions whose illumination stays constant should remain quiet during the same event.
- **Test scenario:** `light` and `std540-light`; add a fixed camera and fixed geometry with a light that changes brightness and colour, holds, then returns. Include an emissive object moving outside the camera view while its illumination remains visible.
- **Metric and pass criterion:** improve dynamic-region pooled PSNR and FLIP during the transition and reduce the time to the new reference appearance. Pass also requires static-region boil/flicker within the common gate. Use identical event times and separately report onset, held illumination and return, so a delayed response cannot win by temporal averaging.
- **Public source:** [Gradient Estimation for Real-Time Adaptive Temporal Filtering, Schied et al. 2018](https://cg.ivd.kit.edu/publications/2018/adaptive_temporal_filtering/adaptive_temporal_filtering.pdf).
- **What our code does today:** adaptive temporal filtering and lighting-change options already exist. This target is for residual visible lag or instability in those options; it does not request that A-SVGF be built again.

## 4. Stable soft and coloured shadows

- **Area:** penumbra boil, motion and transmitted colour.
- **Target behaviour:** a stationary soft shadow does not visibly crawl. Moving shadows follow their casters and lights without a smeared wake. Coloured shadows retain their tint, contact detail and brightness while remaining stable.
- **Test scenario:** `three-knot-static`, `three-knot-still`, `three-knot-orbit`, `std540-light`, `std540-object`; `v1-glass`, `v1-glass-moving`, `v1-glass-still`. Evaluate stationary and moving portions separately, plus the real glass scene when its capture is available.
- **Metric and pass criterion:** reduce static-penumbra boil against today's matching shadow configuration, with penumbra PSNR, FLIP, dynamic-region accuracy and tint/chroma error within the common gate. Score coloured results against coloured references. A grayscale control is useful context, but cannot pass the colour requirement. Include a fixed-scene reference control to distinguish reconstruction instability from reference noise.
- **Public source:** [SVGF](https://research.nvidia.com/labs/rtr/publication/schied2017spatiotemporal/) and [adaptive temporal filtering](https://cg.ivd.kit.edu/publications/2018/adaptive_temporal_filtering/adaptive_temporal_filtering.pdf), as general background for the stability/responsiveness tradeoff. No NRD-specific public explanation is required for this observable target.
- **What our code does today:** opaque and coloured shadows already exist. [M8](../results/M8.md) records working tint reconstruction and remaining temporal tradeoffs. Preserve its existing colour advantage while testing stability improvements; do not reopen translucent shadows as a missing feature.

## 5. Normal-mapped diffuse and specular detail

- **Area:** fine surface appearance after denoising.
- **Target behaviour:** bumps and ripples remain visibly present under indirect and glossy lighting. Detail should neither wash out nor sparkle during motion, and a diffuse improvement should not worsen the glossy surface beside it.
- **Test scenario:** `bumpy`, `bounce`, `v1-bumpy` and `v1-bounce`; existing M7 wall and floor views. Add slow camera motion and a moving broad light over the same normal-mapped surfaces, with a smooth-surface control and held-out normal maps.
- **Metric and pass criterion:** improve detail-band contrast toward the reference and detail-region PSNR, while FLIP and flicker satisfy the common gate. Report diffuse and specular separately. A pooled PSNR gain accompanied by visibly reduced bump contrast or worse perceptual detail does not pass this target.
- **Public source:** [PBRT's material appearance discussion](https://www.pbr-book.org/4ed/Reflection_Models/Roughness_Using_Microfacet_Theory) and [SVGF](https://research.nvidia.com/labs/rtr/publication/schied2017spatiotemporal/), as background on shading detail and reconstruction quality.
- **What our code does today:** directional lighting output is implemented and evaluated. The provisional [M7 results](../results/M7.md) report a diffuse PSNR benefit alongside lost bump contrast and worse FLIP in one comparison; their specular directional variant underperforms the plain control. These are separate quality questions to retest, rather than a request to add directional support.

## 6. Silhouettes, thin objects and surface boundaries

- **Area:** cross-surface contamination and contact detail.
- **Target behaviour:** foreground colour, highlights and shadows do not bleed onto adjacent background surfaces. Thin objects remain distinct, contact shadows remain attached, and slow motion does not produce intermittent edge halos.
- **Test scenario:** `thin`, `object`, `std540-thin`, `std540-object` and `three-pan`. Add nearly touching foreground/background surfaces with contrasting lighting; repeat with similar orientations, grazing views and thin moving occluders.
- **Metric and pass criterion:** improve boundary-region PSNR and FLIP; report disoccluded, contact and dynamic regions plus boil. Use existing AO/SO contact measures where applicable, and add a reference-labelled boundary region if missing. Pass requires reduced boundary error and the common gate, including retained contact contrast.
- **Public source:** [SVGF](https://research.nvidia.com/labs/rtr/publication/schied2017spatiotemporal/) and the [TAA survey](https://diglib.eg.org/items/cfa6a05c-53b3-4ee1-979d-48abc6225f6b).
- **What our code does today:** edge-aware filtering, occlusion filtering and thin-object tests already exist. First establish whether a visible failure remains on a current capture. Existing coverage alone does not prove that every difficult boundary passes.

## 7. Convergence without loss of brightness or detail

- **Area:** settled appearance and long-duration stability.
- **Target behaviour:** as a scene settles, noise decreases without progressive softening, brightness drift, expanding dark contacts or disappearing highlights. Stopping and restarting camera motion should not leave the same view with a different settled appearance.
- **Test scenario:** extend `orbit` and `glossy` with long stationary holds before and after motion; include `three-knot-still` for shadows and a new fixed lit surface with fine detail, broad gradients and isolated highlights. Capture enough frames to demonstrate a plateau rather than relying on the short standard replay.
- **Metric and pass criterion:** improve settled-window pooled PSNR or FLIP beyond repeat variation, with the other metric and boil satisfying the common gate. Compare the same view before and after motion; report mean brightness error and detail contrast alongside existing metrics. Pass requires no significant new drift or detail loss over the held interval. Define the windows before comparing candidates.
- **Public source:** [SVGF](https://research.nvidia.com/labs/rtr/publication/schied2017spatiotemporal/) and [adaptive temporal filtering](https://cg.ivd.kit.edu/publications/2018/adaptive_temporal_filtering/adaptive_temporal_filtering.pdf).
- **What our code does today:** temporal convergence is already implemented. Existing short tests and pooled scores should be extended before claiming either a long-duration defect or an improvement. The [high-reference evaluation](../results/E1-high-reference.md) also shows why reference noise needs checking when judging small differences.

## 8. Camera jitter and subpixel motion

- **Area:** renderer integration and fine edge stability.
- **Target behaviour:** enabling the renderer's normal camera jitter must not introduce systematic double edges, crawling highlights or a changed settled brightness. Slow subpixel motion should remain coherent across the supported rendering configurations.
- **Test scenario:** new matched captures of the `thin` and `glossy` scenes with jitter enabled and disabled, static holds and a slow pan. Use a reference appropriate to each camera sample sequence, and confirm the renderer's camera/motion convention with its owner before interpreting a difference.
- **Metric and pass criterion:** compare each configuration against its own current baseline and matching reference. Reduce any reproducible excess boundary/specular FLIP and boil under jitter while satisfying the common gate. If today's integration already passes with no reproducible artefact, close this as no action needed. Do not compare jittered and unjittered pixels as though their sample locations were identical.
- **Public source:** [A Survey of Temporal Antialiasing Techniques](https://diglib.eg.org/items/cfa6a05c-53b3-4ee1-979d-48abc6225f6b).
- **What our code does today:** the shared camera API exposes jitter. This review has not established an end-to-end image failure; this is a conditional integration check, below the measured quality tradeoffs above.

## No action needed unless a test demonstrates a gap

- SVGF, adaptive temporal filtering, recurrent diffuse/specular filtering and occlusion are already present. Keep the existing options as controls instead of rebuilding their foundations.
- Reflection-motion support and geometry-edge handling already exist. Targets 2 and 6 concern observable residual artefacts.
- Directional lighting and translucent shadows are already implemented. M7/M8 work should be assessed and extended, rather than duplicated.
- M8 reports preserved opaque visibility with fully clear transmission on its tested capture set. Retain that regression check; no replacement feature is requested.
- Existing higher-scoring alternatives remain valid controls. An architectural change, resemblance to another library, or a feature checklist is insufficient reason to replace a measured winner.

Excluded items: 8.
