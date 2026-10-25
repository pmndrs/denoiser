# Clean review: Codex audit handoff of 2026-10-26 (research prompt and state audit)

_2026-10-26, clean reviewer. Reviewer status: **clean**. No NRD code, README, release notes, `UPDATE.md`, fork
or port opened, before or during this review, and nothing under `nrd-quarantine/` or named quarantine. This
reviewer writes no passes. Same method and bar as [nrd-review-targets-review.md](nrd-review-targets-review.md)._

**Files under review** (from Dennis's external auditor; not committed, originals stay outside the repo):

| file | lines | reviewed copy |
|---|---|---|
| `/Users/dex/Documents/Codex/2026-10-25/i-w/outputs/clean-agent-public-research-prompt.txt` | 123 | [sources/audit-public-research-prompt.md](../sources/audit-public-research-prompt.md) |
| `/Users/dex/Documents/Codex/2026-10-25/i-w/outputs/current-denoiser-state-audit.txt` | 121 | [sources/audit-current-state.md](../sources/audit-current-state.md) |

Line numbers below are the originals' (`cat -n`).

**Read for this review:** RULES (all, incl. §1, §2, 3b, 3c, 7, §8), PROVENANCE (header, contamination register,
rule-7 procedure), `sources/nrd-releases.md` (whole, as the allowed "what changed" bar), TASKS rule 9 and rule 11,
TASKS target D and the upscaler-guides entry, the previous clean review, then both files line by line. For the
cross-checks: `results/M4.md` §12 (l. 880–1092), `results/scenes-bistro-sponza.md` (setup, findings l. 60–90),
`results/SHADOWS-LOOK.md` (header, answers, setup), `results/M2-M3.md` l. 220–230, `results/E1-high-reference.md`
(summary, roughness bins), `results/T1-recovery.md` (headline, setup, §5 grep), `native/results/ROUND2.md`
(header, pooled tables, caveats), `native/results/PHASE4-5.md` (header, cost table), PROVENANCE l. 241 at 66c4c66,
LESSONS l. 350 / 619 at 66c4c66, TASKS l. 559 / 907 at 66c4c66; code: `shaders/svgf.ts` (temporal pass around l. 238,
grep for hit distance), `shaders/common.ts` l. 165–175, `shaders/recurrent.ts` l. 150–156 / 488 / 758,
`examples/realtime-denoiser/src/scene.ts` (header, intersectors); `git log` for 7a8b980..90aa679 on the shadow files.
Primary sources (local copies in the reviewer's scratch, not committed): Eto et al. 2023 PDF (title block, §2.4),
Mara et al. 2017 PDF (intro, §5.1, dynamic-scene paragraph), Mehta et al. 2012 PDF (title block), Rodriguez et al.
2020 author PDF (title block, section headings); web: Panteleev 2020 blog (title, date, the limitation sentence),
search-result metadata for Heitz et al. 2018, Igehy 1999, Rodriguez et al. 2020; NVIDIA SVGF page (HTTP 200). No
NRD GitHub page reached; no link inside a source was followed into NRD.

## Method

Each line was checked for: NRD code, formulas, thresholds, constants or defaults; pass structure or ordering, data
layouts, internal tests or weights; NRD file / function / variable / setting names beyond public-interface facts;
algorithm names not in a public paper or talk; target values specific enough to encode an internal parameter; and
mechanism ("how") phrasing derived from NRD rather than image outcomes ("what"). The bar is
`sources/nrd-releases.md` and the already-accepted TASKS target D wording. Because the research prompt's author had
the separate NRD source audit in context (its own l. 115 says so), **disclaimers that name a design choice for "a
modern denoiser" or "another denoiser" were read as possible steers**: "X does not prescribe Y" tells the reader Y is
the topic. Three such clauses were removed under rule 3b's "when in doubt, a line is left out".

Neither file contains a number that comes from NRD's internals. Every number is ours (results docs, commits, rule 9
gate) or a black-box native measurement (ROUND2 / PHASE4-5 scores and timings, allowed by RULES rule 4). NRD names
used: NRD, REBLUR, RELAX, SIGMA, "native v4.18.0" (comparison only, RULES §6). No NRD setting, resource, function,
file or pass name. Algorithm names: SVGF, A-SVGF, à-trous, virtual motion / virtual positions, dual-source
reprojection, primary surface replacement, ray differentials, axis-aligned filtering, ratio estimator background;
all in public papers / talks (cited and checked below) or already in our own SPEC.

## Verdicts

| file | verdict |
|---|---|
| `clean-agent-public-research-prompt.txt` | **pass with redactions** (3 clauses) |
| `current-denoiser-state-audit.txt` | **pass**, no redactions |

### File 1: `clean-agent-public-research-prompt.txt`

| part | verdict | reason |
|---|---|---|
| l. 1–14 header, rules, scope | pass | Process; our own feature list (recurrent, SVGF / A-SVGF, reflection motion, directional, translucent shadows). |
| l. 16–24 reading list (our results) | pass | Our docs only. |
| l. 26–34 task 1, moving shadows | pass | Our ab3f4d7 numbers; test design (motion separation, frozen control, regional scores, reference-noise control); outcomes only. Release-audit T1, T3, T4 level. |
| l. 36–54 task 2, reflection tracking | pass | Inventory of our configurations (correct, see below), deterministic scenes, independent CPU oracle. Scenarios match release-audit T7, T8, T10, T13. No reprojection formula. |
| l. 56–65 task 3, distance / target D | pass with **1 redaction** (l. 65, second sentence's last clause) | Rest is at target D's level (TASKS, Dennis's public-blog "what": distance feeds filtering and reflection tracking, can degrade over long histories) or test method (300-frame holds, same view via different histories, units glossary, Metal vs RTX). |
| l. 67–73 task 4, disocclusion | pass | Our T1 results and a reveal-and-hold test. |
| l. 75–113 public reading list R1–R9 | pass with **1 redaction** (l. 96–97 clause) and **1 phrase redacted** (l. 93) | All nine sources are public and real (table below). The paper summaries are of the papers. |
| l. 115 | pass (kept, see "points looked at") | |
| l. 117–123 acceptance | pass | TASKS rule 9 and our deliverables. |

**Redactions (reason only):**

1. **l. 65, clause after "Do not treat an arbitrarily rescaled distance buffer as a physically valid reference
   scene."** A caution about how many distance statistics a denoiser should keep. It reads as a design hint about
   distance representation, it goes one step past target D's "what" (distance has more than one consumer) toward a
   "how", and its author had NRD-source context. Not needed for the test; target D already lists our own consumers.
2. **l. 96–97, second clause of R5's note.** A disclaimer that names specific design choices for "a modern
   denoiser's" distance data. Same pattern: the negation identifies the topic, from a source-exposed author. The
   remaining note (ray footprints through propagation and reflection; supports footprint reasoning) is the paper's
   content.
3. **l. 93, last clause of R4's note.** A comparative statement about the internals of "another denoiser's history
   repair". It adds nothing for an implementer (the sentence before it already says SVGF's fallback is about variance
   estimation) and it is a statement, if only negative, about how NRD repairs history, the area the orchestrator's
   exposure note keeps away from implementers. Removed.

### File 2: `current-denoiser-state-audit.txt`

| part | verdict | reason |
|---|---|---|
| l. 1–15 scope, snapshot, assessment | pass | Process; disclaims parity. |
| §1 shadows (l. 17–34) | pass | Our M4 / Bistro-Sponza numbers and their reading. |
| §2 reflections (l. 36–54) | pass | Our code (virtual motion, isotropic κ, static reflected world, SVGF without hit distance) and our M2-M3 / E1 numbers. |
| §3 disocclusion (l. 56–72) | pass | Our T1 results. |
| §4 distance (l. 74–88) | pass | Our f16 histories and LESSONS (Metal truncation); target D as hypothesis. |
| §5 geometry controls (l. 90–99) | pass | Our test renderer; SSR caveat is ours. |
| §6 native (l. 101–111) | pass | Black-box scores and timings (RULES rule 4), with the harness caveats our own docs record. |
| l. 113–121 order | pass | Priorities only. |

**Redactions: none.**

### Points looked at closely (kept, not leaks)

- **R1 "dual-source temporal reflection reprojection".** A pointer at a reflection-tracking idea from an author with
  source exposure. Kept: it is published in Eto et al. 2023 §2.4.2 (verified: "two reprojection points, one on the
  surfaces and the other at the hit positions", blended by brightness difference, neighbourhood clamping), credited
  there to Stachowiak, SIGGRAPH 2018 "Stochastic All The Things" (public talk); Mara et al. 2017 publishes temporal
  filtering at virtual positions; RTG II ch. 49 prose (§49.8) and our recurrent filter (SPEC, "two history candidates") already combine surface and
  virtual history. Treat it as reading-list priority, not as information about NRD.
- **R1 "tangent-plane separation, not a universal substitute for secondary-ray hit distance".** Checked against §2.4.1:
  the edge-stopping weight uses a scaled, saturated distance between the tangent planes of the filtered and the
  sample position. An accurate reading of the paper.
- **l. 115 "the precise modern distance-handling or repair changes from the separate source-informed audit".**
  Discloses only that such changes exist. The release audit already says as much (hit-distance reconstruction,
  zero-hit-distance handling, `historyFix*` settings, "no denoiser uses mips any more"). Kept as a disclaimer.
- **l. 84 "not … evidence of NRD's current design"** and l. 105 / 109 / 113 limits: generic, carry no content. Kept.
- **The choice and order of tasks** (shadows first, reflections second, distance third, reveal tests fourth) is a
  "where to look", the same level as the earlier targets file. It matches TASKS' own queue.

## Factual corrections and staleness (for the orchestrator and implementers)

Not contamination issues; implementers should not chase stale premises. Both files were written at snapshot 66c4c66
(final check 8cf32bc). HEAD has moved: 1a2861a, 4457481, 694937c (shadows), 7ea3928 (TASKS rule 11).

**Out of date since the shadows agent finished (both files):**

1. **"Current shadow files have active edits" / "uncommitted src/shadow.ts … No committed results validate them
   yet"** (file 1 l. 14, file 2 l. 11, l. 26). Those edits are committed (1a2861a: `snapHardPx`, `backfacePass`,
   `noiseCap` / `noiseCapSettled`, default off, default path byte-identical) and measured in `results/SHADOWS-LOOK.md`
   (4457481). `backfacePass: true` + `snapHardPx: 2` **passes rule 9** (1080p +0.11 dB, FLIP −6 / −9 / −14 %, same
   cost) and is proposed to Dennis as a look-changing flip (TASKS "Questions for Dennis"); `noiseCap` gains +0.67 dB on
   the real scenes and +1.75 dB on `bistro-move` but **fails rule 9's boil clause**. File 1 l. 7's "inspected package
   implementation was unchanged" no longer holds.
2. **File 1 task 1 (bistro-move diagnosis) is largely answered.** SHADOWS-LOOK: the loss is mostly the spatial filter,
   not temporal lag (temporal accumulation alone scores 28.35 dB, 4 dB above raw); causes: the noise-sized half of the
   radius blend at clean steps, the terminator radius on surfaces facing away from the light, the 1-px minimum radius.
   With the proposed flip 22.98 dB, with `noiseCap` 24.73 (above raw). Frame 0 still loses (23.4 vs 25.0 dB). An
   edge-sharpness metric now exists (SHADOWS-LOOK setup). What remains open from task 1: the camera-only / light-only /
   occluder-only / frozen separation and the hard-light frame 0 follow-up (TASKS, 694937c). File 2 l. 22's "moving
   edges also trail, positive bias 0.058" should be read with SHADOWS-LOOK's finding that the leak into the umbra is
   spatial blur from lit taps.
3. **"Validated v2.2 work … 0.0062 → 0.0013"** (file 2 l. 19; file 1 l. 28 "helped the original knot scene"). The
   numbers are right (M4 §12), but every v2.2 number in M4 ran with `uniformSnap: true`; the shipped default is
   `'change'` (255a06a), which SHADOWS-LOOK identifies as the cause of the softer look on moving cameras (Bistro edge
   sharpness 0.680 → 0.595, −0.68 dB). On a still camera the two are indistinguishable, so the knot-static crop stands.
   The shipped defaults have now been measured at 1080p (694937c).
4. **Heavy GPU work now needs the lock** (TASKS rule 11, 7ea3928): both files predate it. 4096-spp runs are in progress
   (E-1 leftovers `thin` / `cut`), and target D is queued "after the shadows-look agent and the 4096-spp runs" (TASKS).

**Corrections (minor):**

5. **R3 (Mara et al. 2017)** "the remaining difficulty of moving glossy objects": the paper's dynamic-scene limitation
   is stale lighting on surfaces that are unchanged in view (latency mainly in diffuse indirect), and it says sharp
   (mirror) reflections show minimal latency; §5.1 lists over-blurring and distance-independent glossy filter width.
   Virtual positions and disocclusion handling are as stated.
6. **R1 author:** Guillaume Boissé (not "Boisse"); venue SIGGRAPH Asia 2023 Technical Communications.
7. **Line references** in file 2 are valid at 66c4c66 (checked TASKS 559 / 907, LESSONS 350 / 619, PROVENANCE 241) but
   have drifted at HEAD (target D is now TASKS l. 939).

**Checked and correct:** bistro-move 24.42 / 22.69 dB, FLIP 0.017 / 0.050, bias +0.058, frame-0 loss; static-penumbra
boil 8–23 % above FFX (Sponza +9 / +23 / +10 %, Bistro +8 / +19 %) with 3–5 dB better penumbra PSNR; camera-motion
dynamic masks dominated by edge resampling; knot crop 0.0062 → 0.0013 vs FFX 0.0011, frozen control boils as much,
`light` −0.19 dB; virtual motion on/off glossy +2.75 / orbit +1.10 / light +0.21 (M2-M3 final design); E1 specular
recurrent −1.23 dB vs A-SVGF `auto`, `glossy` +0.30, roughness ≥ 0.6 bin −2.11; T1 revisions d92a37f / 35839c5 /
0ffe427, settle frames 4 / 0 / 4, recurrent −1.5…−2 dB young and −3…−4 dB boundaries; `historyFix: 'spatial'` +0.67 /
+0.43 dB, boundary +1.2…+4.6, one dispatch and ~1.5 B/px less, young boil +4…+70 %, settled real-scene boil +6.6 %,
loss on the frame after a cut, opt-in; `youngNormalPower` proposal pending Dennis and a quiet-GPU cost check (TASKS
native round 3 item 2); SVGF specular reprojects with surface motion and reads no hit distance (`shaders/svgf.ts`);
recurrent virtual motion assumes a static reflected world (`virtualPrevUV` comment), isotropic κ (PROVENANCE);
f16 truncation on Metal and the repaired translucency drift (LESSONS); holds 32 / 48 / 96 frames; analytic spheres,
boxes, plane in `scene.ts`; real-scene specular is undemodulated SSR; ROUND2 pooled 37.80 vs 34.68, 34.24 vs 29.73,
35.67 vs 22.04 (ours 90aa679, v4.18.0, RTX 3060 Laptop) and its "no known-good SIGMA integration" caveat; PHASE4-5
locked-clock timings 6.089 / 5.377 / 7.241 ms and 1.071 / 0.959 ms at 7a8b980, where shadows were still v2.1 (v2.2
landed in 033a869, between 7a8b980 and 90aa679).

## Reference check

| cited | exists | says what is claimed |
|---|---|---|
| R1 Eto, Meunier, Harada, Boissé, "Real-Time Rendering of Glossy Reflections Using Ray Tracing and Two-Level Radiance Caching", SIGGRAPH Asia 2023 Tech. Comm. (GPUOpen PDF) | yes: PDF fetched, title block matches | yes: §2.4.2 "Dual-source temporal accumulation" (credited to Stachowiak 2018); §2.4.1 tangent-plane distance in the weight; radiance caches separate |
| R2 Rodriguez, Leimkühler, Prakash, Wyman, Shirley, Drettakis, "Glossy Probe Reprojection for Interactive Global Illumination", ACM TOG (SIGGRAPH Asia 2020) | yes: author PDF (cwyman.org) title block; INRIA page unreachable from here, NVIDIA research page and SA2020 listing confirm | yes: §4.3 "Geometric Information" (precomputed curvature), §5.1 "On-the-fly Reflection Position Estimation", §6 two-step convolution / §6.1 filter footprint; static scenes |
| R3 Mara, McGuire, Bitterli, Jarosz, "An Efficient Denoising Algorithm for Global Illumination", HPG 2017 | yes: PDF fetched | mostly: virtual-position temporal filter (stage 8, citing Zimmer 2015), disocclusion detection (stage 5); the "moving glossy objects" reading is overstated (correction 5) |
| R4 Schied et al., SVGF, HPG 2017 | yes: NVIDIA page 200; KIT PDF checked in the previous review | yes: §4.1–4.3 (previous review) |
| R5 Igehy, "Tracing Ray Differentials", SIGGRAPH 1999 | yes: SIGGRAPH history archive / search metadata (Stanford host unreachable from here) | yes: footprint through transfer, reflection, refraction |
| R6 Mehta, Wang, Ramamoorthi, "Axis-Aligned Filtering for Interactive Sampled Soft Shadows", ACM TOG 31(6) art. 163, 2012 | yes: PDF fetched (UCSD course copy), DOI 10.1145/2366145.2366182 | yes (already our M12 source in PROVENANCE) |
| R7 Schied, Peters, Dachsbacher, A-SVGF, 2018 (KIT PDF) | yes: checked in the previous review | yes |
| R8 Heitz, Hill, McGuire, "Combining Analytic Direct Illumination and Stochastic Shadows", I3D 2018 | yes: NVIDIA research page and PDF in search metadata (casual-effects page is script-rendered) | yes: ratio estimator, shadow term denoised separately (already our H18 source) |
| R9 Panteleev, "Rendering Perfect Reflections and Refractions in Path-Traced Games", NVIDIA developer blog, 2020-08-13 | yes: page fetched | yes: PSR, flat-mirror motion vectors; "Computing motion vectors for curved surfaces or moving mirrors is not in scope for this post" |

All nine are public publications (RULES §2). None is NRD material.

## Overall verdict

**Both files may be read by implementers and researchers in their reviewed form**:
[sources/audit-public-research-prompt.md](../sources/audit-public-research-prompt.md) (three clauses redacted) and
[sources/audit-current-state.md](../sources/audit-current-state.md) (unchanged). The originals stay outside the repo
and must not be given to implementers. Cautions carried over: the reading list's choice and order is a priority, not
information about NRD; nothing here gives NRD parameters, and none may be inferred; any history-repair change is still
designed from public sources, our measurements or black-box probes by an implementer who hasn't read the quarantined
brief (PROVENANCE, orchestrator exposure note). Read both copies together with the staleness notes above.
