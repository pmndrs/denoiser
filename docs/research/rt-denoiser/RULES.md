# Clean-room rules: our own NRD-class real-time denoiser

We are building a hand-tuned, per-signal real-time denoiser (diffuse/specular lighting,
shadows, occlusion) in WGSL. NVIDIA's NRD covers the same ground, but its source is under
the proprietary NVIDIA RTX SDKs license. Our implementation must be **written from public
descriptions of the techniques, never from NRD's code**. These rules apply to people and
to every agent working on this project.

## 1. NRD code is off limits

Nobody who researches, designs or writes our implementation reads, copies, translates,
paraphrases or "summarizes the logic of" NRD code. That covers:

- everything under `NVIDIA-RTX/NRD`: `Shaders/`, `Source/`, `Include/`, `Integration/`,
  `Resources/`, and code blocks inside its README/UPDATE.md;
- `NVIDIA-RTX/NRD-Sample` source and shaders;
- compiled or decompiled NRD shaders, and captures of them (RenderDoc, PIX);
- forks, mirrors and third-party ports of NRD (Unity/Unreal/WebGPU ports,
  `dust-engine/NVIDIA_RayTracingDenoiser`, etc.).

## 2. Allowed sources

- Published papers, books and book chapters (e.g. *Ray Tracing Gems* I/II, GPU Pro/Zen),
  conference talks, slides and videos, theses.
- NVIDIA's public web pages and blog posts about NRD and its denoisers.
- NRD's interface, as extracted by the provenance audit in
  [sources/nrd-provenance.md](sources/nrd-provenance.md) §3. Researchers and implementers
  don't read NRD's README themselves: some of its prose sections describe implementation
  details ("HISTORY CONFIDENCE", "MATERIAL DEMODULATION", the SIGMA multi-light paragraph,
  "INTERACTION WITH LOW DISCREPANCY SAMPLERS"). Those are off limits too.
- Open-source code under permissive licenses (MIT/BSD/Apache/zlib), taken **from its own
  upstream**, under its own license. This includes AMD FidelityFX 1.x (MIT), which we
  already ported.
- Patents are not used as design sources.
- **Ray Tracing Gems II** (decided by Dennis, 2026-10-25). The book, including every code listing
  printed in it, is CC BY-NC-ND 4.0: read its prose and equations, never copy, port or paraphrase a
  listing (porting is an adaptation, and our MIT library allows commercial use). The book's GitHub
  repo (`Apress/Ray-Tracing-Gems-II`) is MIT (© 2021 NVIDIA, unless a chapter's files say
  otherwise) and is usable under the rule above, but it only has chapters 7, 14, 16, 18, 20, 27–29,
  31–33, 36, 39 and 47. **Chapter 49 (ReBLUR) has no code there**, and its listings likely mirror
  NRD's code, so they stay off limits **even if our filter underperforms the chapter's results**.
  When stuck, use the prose, public talks, our own design, or a black-box probe of native NRD.

## 3. One exception: the provenance audit

A single, clearly labeled audit may look inside the NRD repository for **references only**:

- license files, third-party notices, submodules and build-dependency lists, with their
  licenses;
- citations in comments or docs (paper titles, authors, URLs) that point at public or
  open-source material.

The audit's output is a list of names, licenses and citations. It never describes how NRD
implements anything. Third-party open code found this way is used from its own upstream
(rule 2), never from NRD's copy.

## 4. Native NRD as a black box

We may build and run native NRD to compare quality and performance, because its license
allows installing and using the SDK. Constraints:

- It lives **outside this repository** (a sibling "parent setup" folder). Nothing from it
  is committed here: no source, no binaries, no shader blobs.
- It's driven only through its public API, fed with inputs we captured from our own
  renderer. We compare its **outputs** (images, timings) with ours.
- Whoever builds the harness touches NRD's build and public API surface only, and
  does not write our shaders for the same pass.

## 5. Provenance log

Every algorithmic piece of our implementation cites its public source (paper, section,
page, or talk slide) in `docs/research/rt-denoiser/PROVENANCE.md`. Reviews check that the
log covers each pass.

## 6. Naming

ReBLUR, ReLAX, SIGMA and NRD are NVIDIA's names. Our public API, package and pass names
don't use them. Docs may name them when comparing.

## 7. If someone gets contaminated

If anyone reads NRD code by accident, they say so, note it in PROVENANCE.md, and someone
else writes the affected pass.

## 8. Roles and contamination register

| role | who | may see NRD code? | may write our passes? |
|---|---|---|---|
| researchers | research agents → `sources/*.md` | no | yes |
| spec author / implementers | agents or people writing `SPEC.md` and the WGSL | no | yes |
| provenance auditor | the audit agent of 2026-10-24 | yes, for references only (rule 3) | **no** (contaminated: grep of NRD source) |
| research agent, shadows/specular | wrote `sources/shadows-specular.md` (2026-10-24) | no code; it read NRD's README prose before the README was ruled out. Those passages were removed from its report | not without review: if reused, its passes get a second reviewer |
| harness builder | the agent on the Windows RTX machine ([NATIVE-HARNESS.md](NATIVE-HARNESS.md)) | public headers, integration layer, `NRD.hlsli` (rule 4) | **no** |

Any new agent gets this file in its brief and a clear role from this table.

_Status of the planning session (2026-10-24): it read NRD's README prose (overview,
performance numbers, input section headings), its LICENSE.txt and its top-level repo
layout. A keyword search of the README also surfaced a few lines of the README's HLSL
integration example (helper function names only). It has not opened any source file._
