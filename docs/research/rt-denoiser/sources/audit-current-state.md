# Audit handoff (reviewed copy): current denoiser state

_Reviewed copy of Dennis's external auditor's `current-denoiser-state-audit.txt` (2026-10-26, snapshot 66c4c66,
final check 8cf32bc). Clean review: [codex-audit-2026-10-26-review.md](../reviews/codex-audit-2026-10-26-review.md) — **pass, no redactions**; text verbatim (headings
added for reading; line references are valid at 66c4c66). **Read with the review's staleness notes**: the
"uncommitted" shadow changes are committed (1a2861a) and measured (results/SHADOWS-LOOK.md: `backfacePass` +
`snapHardPx: 2` passes rule 9 and is proposed to Dennis, `noiseCap` fails the boil clause, `bistro-move` is mostly
the spatial filter); M4's v2.2 numbers ran with `uniformSnap: true`, not the shipped `'change'`._

---

**Current denoiser state and highest-value next evaluations** (26 October 2026)


## Scope and method

A separately initialized subagent audited only this project's own source, public research notes, accepted behavior targets and recorded results. It did not inherit the earlier NRD source audit. It was explicitly instructed not to inspect NRD source, ports or the quarantined originals. This is a repository/state review, not a new benchmark run or a clean-handoff compliance certification. No repository files were changed and no benchmark servers were started.  

Repository: /Users/dex/Developer/Denoiser-nrd-cleanroom  
Snapshot: 66c4c6604d66e8711c7c5188290553e3be51656a  
Final HEAD check: 8cf32bcb8b67f49a37557aa5bc18623e6987cb1f. This adds a TASKS entry for optional upscaler-provided guides, with measurement first; no package implementation changed in that commit. Coordinate new guide work with that queued task.  
Active work at inspection: uncommitted src/shadow.ts and src/shaders/shadow.ts changes, plus four shadow look-comparison images. Historical measurements are tied to their own recorded revisions, not silently attributed to this snapshot.  

## Assessment

The project is a functioning denoiser suite with substantial existing reflection, temporal, directional and shadow work. The main remaining questions concern correctness and quality in isolated difficult cases, long-duration behavior, and broader input/test coverage. Existing evidence does not establish a general percentage of parity with current native NRD.  

## 1. Shadow instability and hard moving edges

The original knot-wall boil was materially improved in validated v2.2 work: the recorded crop fell from 0.0062 to 0.0013, close to FFX's 0.0011. A frozen-scene control originally boiled too; the original symptom was therefore not explained solely by moving-object motion vectors. Stabilization also cost 0.19 dB on the moving-light path, showing a response/stability tradeoff.  

The newer, same-revision Bistro/Sponza evaluation at ab3f4d7 exposes harder cases:  
- bistro-move, a small moving local light: raw visibility 24.42 dB / FLIP 0.017; ours 22.69 / 0.050. Ours loses already at frame zero, so there is a spatial-detail problem before temporal history can contribute. Moving edges also trail, with reported positive bias 0.058.
- Wide sun penumbrae: our static-penumbra boil is 8-23% above FFX on Sponza/Bistro, despite our penumbra PSNR being 3-5 dB better. A calmer blurred baseline is not sufficient evidence for adopting more blur.
- Camera-motion dynamic masks often select edge resampling. Their reference boil is large; they should not be read as a clean measure of moving-light or moving-shadow instability.

The active working-tree changes introduce default-off experiments directed at hard-edge and related appearance problems. No committed results validate them yet. Do not label these as fixes or overwrite them during another task.  

### Evidence:
/Users/dex/Developer/Denoiser-nrd-cleanroom/docs/research/rt-denoiser/results/M4.md:880  
/Users/dex/Developer/Denoiser-nrd-cleanroom/docs/research/rt-denoiser/results/M4.md:918  
/Users/dex/Developer/Denoiser-nrd-cleanroom/docs/research/rt-denoiser/results/M4.md:936  
/Users/dex/Developer/Denoiser-nrd-cleanroom/docs/research/rt-denoiser/results/M4.md:1082  
/Users/dex/Developer/Denoiser-nrd-cleanroom/docs/research/rt-denoiser/results/scenes-bistro-sponza.md:14  
/Users/dex/Developer/Denoiser-nrd-cleanroom/docs/research/rt-denoiser/results/scenes-bistro-sponza.md:76  

## 2. Reflection tracking exists, but capability differs by selected filter

The recurrent implementation actually reconstructs positions, computes virtual reflection motion, estimates curvature and validates history; these are not merely roadmap entries. The project documents an isotropic curvature approximation, and the virtual-position function assumes a static reflected world. Those are limitations to test, not proof that every resulting image is wrong.  

The shipped SVGF specular default follows surface reprojection and does not use hit distance for reflection reprojection. A feature implemented in the recurrent alternative therefore does not automatically exist in the shipped winner.  

There is evidence the recurrent reflection-specific work matters: its recorded motion on/off test improved glossy by 2.75 dB, orbit by 1.10 and light by 0.21. Yet E1's higher-quality reference comparison still finds recurrent 1.23 dB below A-SVGF over orbit/light/glossy, with a 0.30 dB glossy win and a 2.11 dB deficit in its roughest bin. Feature sophistication has not made it the overall measured winner.  

Missing isolated tests include reflected-object-only motion; reflector-only translation/rotation; convex versus concave reflectors; grazing views; curvature sign changes; known near/far reflected features; and motion-stop recovery. Existing generic glossy/camera/object paths exercise some reflections but do not isolate these cases.  

### Evidence:
/Users/dex/Developer/Denoiser-nrd-cleanroom/packages/denoiser-realtime/src/shaders/common.ts:170  
/Users/dex/Developer/Denoiser-nrd-cleanroom/packages/denoiser-realtime/src/shaders/recurrent.ts:153  
/Users/dex/Developer/Denoiser-nrd-cleanroom/packages/denoiser-realtime/src/shaders/recurrent.ts:490  
/Users/dex/Developer/Denoiser-nrd-cleanroom/packages/denoiser-realtime/src/shaders/recurrent.ts:760  
/Users/dex/Developer/Denoiser-nrd-cleanroom/packages/denoiser-realtime/src/shaders/svgf.ts:238  
/Users/dex/Developer/Denoiser-nrd-cleanroom/docs/research/rt-denoiser/PROVENANCE.md:241  
/Users/dex/Developer/Denoiser-nrd-cleanroom/docs/research/rt-denoiser/results/M2-M3.md:228  
/Users/dex/Developer/Denoiser-nrd-cleanroom/docs/research/rt-denoiser/results/E1-high-reference.md:158  

## 3. Disocclusion work has already produced measured alternatives

T1 compares d92a37f against candidate 35839c5 and registry 0ffe427. On its cut sequence, the shipped defaults reach a fixed settled band in 4 frames for diffuse, 0 for specular and 4 for shadows. These are test-specific results, not universal convergence guarantees. Recurrent remains 1.5-2 dB behind SVGF on young pixels and 3-4 dB behind at revealed boundaries.  

The spatial-repair option is built and tested: +0.67 dB diffuse / +0.43 specular pooled over its capture set, boundary gains of 1.2-4.6 dB, one fewer dispatch and approximately 1.5 B/px less memory. It also raises young-pixel boil 4-70%, raises settled real-scene diffuse boil about 6.6%, and loses immediately after a cut. It fails the current adoption gate and remains opt-in. Requesting that it simply be implemented would duplicate completed work.  

The separate SVGF young-history normal option improves visible early mottling and recorded real-scene quality with lower young boil. Its default remains unchanged pending the project's approval and a quiet-GPU cost check; T1 timing was contended.  

The highest-value missing test is a controlled patterned-background reveal followed by a still hold. Follow the same newly exposed surface over time; different history-age buckets can contain different content and are not automatically a pure recovery curve.  

### Evidence:
/Users/dex/Developer/Denoiser-nrd-cleanroom/docs/research/rt-denoiser/results/T1-recovery.md:11  
/Users/dex/Developer/Denoiser-nrd-cleanroom/docs/research/rt-denoiser/results/T1-recovery.md:34  
/Users/dex/Developer/Denoiser-nrd-cleanroom/docs/research/rt-denoiser/results/T1-recovery.md:316  
/Users/dex/Developer/Denoiser-nrd-cleanroom/packages/denoiser-realtime/src/recurrent.ts:183  
/Users/dex/Developer/Denoiser-nrd-cleanroom/packages/denoiser-realtime/src/recurrent.ts:305  
/Users/dex/Developer/Denoiser-nrd-cleanroom/packages/denoiser-realtime/src/shaders/recurrent.ts:933  

## 4. Distance degradation remains an unproven, useful hypothesis

Our shadow and recurrent implementations retain and process distance-derived information in f16 histories. The project has measured Metal storage truncation elsewhere, including previously repaired translucent-history drift. That is a reason to test this area; it does not demonstrate current shadow-scale or reflection-distance degradation.  

Existing stationary/scene sequences are short: the reliable knot hold is 32 frames, scene captures 48, standard live paths 96. No committed result for the queued long-duration target D was found. Fresh input and bounded accumulation may produce a biased plateau instead of continuing drift.  

Use at least 300-frame holds and motion-stop sequences with known geometry, logging raw and historical guides alongside brightness, contact/detail contrast and image error. Distinguish precision effects, changing input samples, filtering bias and actual temporal drift. Repeat focused controls on Metal and RTX where available.  

### Evidence:
/Users/dex/Developer/Denoiser-nrd-cleanroom/docs/research/rt-denoiser/TASKS.md:907  
/Users/dex/Developer/Denoiser-nrd-cleanroom/docs/research/rt-denoiser/LESSONS.md:350  
/Users/dex/Developer/Denoiser-nrd-cleanroom/docs/research/rt-denoiser/LESSONS.md:619  
/Users/dex/Developer/Denoiser-nrd-cleanroom/packages/denoiser-realtime/src/shaders/recurrent.ts:259  
/Users/dex/Developer/Denoiser-nrd-cleanroom/packages/denoiser-realtime/src/shaders/recurrent.ts:504  
Committed shadow history references: src/shaders/shadow.ts at HEAD lines 444-475 and 538. Working-tree edits shift those line numbers.  

## 5. Exact geometry controls are already available

The focused renderer uses analytic sphere, slab-box and plane intersections, rather than SDF ray marching. These provide useful exact positions, normals and hit distances. Preserve them when building reflection tests. An SDF scene is optional and must not introduce unbounded intersection/normal error into an otherwise exact control.  

High-sample references share the renderer/estimator with noisy inputs. They measure denoising error relative to that renderer's expectation, not independent proof of all physical correctness. Real-scene specular remains SSR and is not demodulated; an SSR result cannot establish performance on fully traced, independently moving reflected geometry. A separate CPU geometric oracle should check reflection positions without reusing the denoiser's approximation.  

### Evidence:
/Users/dex/Developer/Denoiser-nrd-cleanroom/examples/realtime-denoiser/src/scene.ts:229  
/Users/dex/Developer/Denoiser-nrd-cleanroom/examples/realtime-denoiser/src/scene.ts:680  
/Users/dex/Developer/Denoiser-nrd-cleanroom/docs/research/rt-denoiser/TASKS.md:559  

## 6. What the native measurements establish

Round 2 compares native v4.18.0 with our 90aa679 revision on an RTX 3060 Laptop. On that supplied standard set, recorded pooled scores favor ours: diffuse 37.80 versus RELAX 34.68 dB; specular 34.24 versus 29.73; shadows 35.67 versus SIGMA 22.04.  

These numbers describe supplied inputs and that harness. A known-good native shadow integration control remains missing; some normalization comparisons remain unresolved; real-scene reflections are SSR; and native Bistro/Sponza replay is pending. There is no defensible global percentage of quality parity from these data.  

Older locked-clock GPU timings at 7a8b980 show our A-SVGF joint at 6.089 ms versus native REBLUR 5.377 and RELAX 7.241; our shadow v2.1 at 1.071 versus SIGMA 0.959. Current shadow v2.2/HEAD needs retiming. Browser/Dawn wall overhead is a separate measurement, so GPU timing alone does not establish application latency parity.  

### Evidence:
/Users/dex/Developer/Denoiser-nrd-cleanroom/docs/research/rt-denoiser/native/results/ROUND2.md:3  
/Users/dex/Developer/Denoiser-nrd-cleanroom/docs/research/rt-denoiser/native/results/PHASE4-5.md:92  

## Recommended order

1. Reproduce hard moving-light shadow failures and evaluate active work without conflating blur, lag and boil.  
2. Add isolated reflection-motion tests with independent geometry/position checks for each actual filter configuration.  
3. Run long holds and guide diagnostics for target D.  
4. Complete reveal/hold recovery tests and quiet timing for existing T1 candidates.  
5. Complete native integration controls, traced real-scene reflection inputs and cross-device comparisons.  

Use identical source inputs and recorded noise across candidates, independent reference samples where needed, and the current high-reference acceptance requirements. The E1 results show that lower-quality references can substantially compress important differences.  
