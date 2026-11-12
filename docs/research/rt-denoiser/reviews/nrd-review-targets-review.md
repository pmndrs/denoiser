# Clean review: `sources/nrd-review-targets.md`

_2026-10-25, clean reviewer required by [PROVENANCE.md](../PROVENANCE.md) (orchestrator exposure note)
before any implementer reads [sources/nrd-review-targets.md](../sources/nrd-review-targets.md)
(commit c94934a). Reviewer status: **clean**. No NRD code, README, release notes, `UPDATE.md`, fork or
port opened, before or during this review, and not the quarantined external review or its snapshot.
This reviewer writes no passes._

**Read for this review:** RULES (all, incl. §1, §2, 3b, 3c, 7, §8), PROVENANCE (header, contamination
register, rule-7 procedure), `sources/nrd-releases.md` (whole, as the allowed "what changed" bar),
`sources/nrd-provenance.md` §3, SPEC §0 and §13, TASKS rule 9, then the file under review line by line.
For the cross-checks: `results/E1-high-reference.md` (conclusion), `results/M7.md` (summary),
`results/M8.md` (gate / opaque-channel lines), both `CAPTURES.md` files (capture names). Primary sources:
`rt-denoiser-sources/svgf/svgf.txt` (§4.1–4.3), `atrous.txt` (header), `asvgf.txt` (header, intro),
`shadows-specular/ch49_prose.txt` (a keyword search for "history fix", prose only);
web: the cited URLs' landing pages / metadata only (no NRD GitHub page reached).

**Incidental:** listing `/Users/dex/Developer/rt-denoiser-sources/` to find the papers showed the
**file names** in its `quarantine/` folder. Nothing in it was opened. See LESSONS.

## Method

Each entry was checked for: formulas, thresholds, constants or defaults; pass structure or ordering,
data layouts, internal tests or weights; NRD file / function / variable / setting names (none beyond
the public interface facts would be allowed; the file uses none at all); algorithm names not in a public
paper or talk; target values specific enough to encode an internal parameter; and phrasing that
describes a mechanism rather than an image outcome. The bar is `sources/nrd-releases.md`: anything at or
below its level of detail ("less ghosting on disocclusion", "umbra inside a wide penumbra") is a "what".

The file contains **no numbers that come from NRD**. Every number in it is ours: the TASKS rule 9 gate
(−0.1 dB, +5 % FLIP, +5 % boil / flicker, +10 % cost, identical to SPEC §13's adoption rule), "seven
standard paths", a repo commit hash, and an exclusion count. It names no NRD setting, resource,
function, pass or denoiser, and no algorithm except SVGF, A-SVGF, à-trous and microfacet roughness,
all public papers / books.

## Verdicts

| part | verdict | reason |
|---|---|---|
| Header and preamble (l. 1–5) | **pass** | Disclaims technique, ranking and parity; no content about NRD. |
| Evaluation agreement (l. 7–15) | **pass** | Process only: baselines, repeat variation, metrics, our own rule 9 gate, our captures. |
| 1. Newly visible regions and camera cuts | **pass** | Outcomes (cleaner sooner, boundaries kept, no ghost of the old foreground, no bleeding); explicitly no NRD-derived frame count. Same level as release-audit T15. |
| 2. Moving reflections and glossy detail | **pass** | Outcomes (no dragging, duplicate edges, jumps, smearing; smooth and rough, curved, grazing). Covered by release-audit T7, T8, T10, T13. |
| 3. Changing illumination on stationary geometry | **pass** | Outcomes (prompt response, no lingering patch / tint, quiet constant regions). Release-audit T2; A-SVGF is the public source. |
| 4. Stable soft and coloured shadows | **pass** | Outcomes (no crawl, no wake, tint and contact kept); points at our M8. Release-audit T1, T4. |
| 5. Normal-mapped diffuse and specular detail | **pass** | Outcomes (bump contrast kept, no sparkle); the gap it cites is our own M7 result. |
| 6. Silhouettes, thin objects and surface boundaries | **pass** | Outcomes (no bleed, distinct thin objects, attached contact shadows, no halos). Release-audit T11, T12, T14. |
| 7. Convergence without loss of brightness or detail | **pass** | Outcomes (no softening, drift, expanding dark contacts, lost highlights); release audit already lists darkening and "crawling" fixes. No plateau length given. |
| 8. Camera jitter and subpixel motion | **pass** | Outcomes (no double edges, crawling highlights, brightness change); conditional; release-audit T22. |
| No action needed unless a test demonstrates a gap (l. 89–95) | **pass** | About our library only. |
| "Excluded items: 8." | **pass** | A count, like the release audit's §4. |

**Redactions: none.**

### Points looked at closely (kept, not leaks)

- **Entry 1 asks to compare "the current recurrent option" first and cites Dammertz 2010 "for
  independent spatial reconstruction research".** Read together with the orchestrator's exposure note
  this could look like a steer toward a particular history-repair design. It states no mechanism, and
  the "what" it could point at (short-history pixels reconstructed spatially; no mips) is already public:
  SVGF §4.2 estimates variance spatially for the first frames after a disocclusion and §4.3 filters with
  à-trous, RTG II ch. 49 prose has a "History fix" step (§49.5.4), and the release audit lists `historyFix*` settings and
  "no denoiser uses mips any more". Kept. Implementers should treat the choice of filter to test as a
  priority, not as information about how NRD repairs history.
- **Order of the entries** reflects the author's estimate of visual impact. That is a "what" (where to
  look), at the level of the release audit's topic emphasis, not a "how".
- **Entry 3's emissive object moving off-screen** and **entry 7's "expanding dark contacts"** are test
  scenarios / outcomes; both have release-audit counterparts (T2; occlusion darkening with long history,
  v3.5.0).

### Non-blocking accuracy notes for the file's owner or the evaluator

1. **Entry 1 vs the evaluation agreement.** The agreement says the shipped configuration is the primary
   baseline (today SVGF `antiLag: 'auto'`), while entry 1 says to compare "the current recurrent option
   with the strongest existing control". Evaluate the shipped default too.
2. **Capture docs.** Line 15 links only `examples/realtime-denoiser/CAPTURES.md`; the `three-knot-*`
   captures (entry 4) and the detailed `three-*` notes are in `examples/three-temporal/CAPTURES.md`.
3. **E-1 link.** `results/E1-high-reference.md` was untracked when c94934a was committed (the E-1 agent's
   work in progress), so the link dangles in history until E-1 commits. Entry 2's "rankings depend on the
   path and roughness region" is right per path (recurrent wins specular `glossy`); E-1 itself finds no
   ranking *change* between 256 and 4096 spp.
4. Internal claims checked and correct: TASKS rule 9 numbers; M7 (diffuse SH wins PSNR on `bumpy` but keeps
   25–50 % of bump contrast and loses FLIP; specular SH −2.1 dB vs plain); M8 (opaque output bit-identical
   with T ≡ 1); capture ids `v1-glass*`, `v1-bumpy`, `v1-bounce`, `three-knot-*`, `three-pan` exist; commit
   `c9c80225` exists.

## Reference check

| cited | exists | says what is claimed |
|---|---|---|
| SVGF, Schied et al. 2017, §4.2 (KIT preprint PDF; NVIDIA research page) | yes: PDF 200 OK; NVIDIA page = HPG 2017, Schied, Kaplanyan, Wyman, … Salvi | yes: §4.2 "Variance estimation" switches to a spatial estimate when temporal history is short after a disocclusion (local `svgf.txt` l. 306–340); §4.1 discards history on disocclusion |
| Dammertz, Sewtz, Hanika, Lensch, HPG 2010, doi 10.2312/EGGH/HPG10/067-075 | yes: DOI resolves to the EG diglib record, same title and authors, 2010 | yes: edge-avoiding à-trous spatial filtering of noisy GI (local `atrous.txt`) |
| Yang, Liu, Salvi, "A Survey of Temporal Antialiasing Techniques", 2020 (EG diglib) | yes: diglib record, title and authors match | yes, as background on temporal artefacts (ghosting, blur, flicker) |
| PBRT 4ed, "Roughness Using Microfacet Theory" | yes: §9.6 | yes: roughness spreads reflection, glossy vs rough appearance |
| Schied, Peters, Dachsbacher 2018, "Gradient Estimation for Real-Time Adaptive Temporal Filtering" (KIT PDF) | yes: PDF fetched, title and authors match | yes: adaptive temporal filtering against lag and ghosting under changing shading (local `asvgf.txt`) |

All five references are public and support the background role the file gives them. None is NRD
material.

## Overall verdict

**Pass. Implementers and researchers may read `sources/nrd-review-targets.md`.** It contains observable
targets, test scenarios, our own adoption gate and public references, and nothing about how NRD works.
Two cautions carry over: it gives no NRD convergence counts or parameters and implementers must not try
to infer any from it; and the orchestrator's restriction still stands (any history-repair change is
designed from public sources, our measurements or black-box probes, by an implementer who hasn't read
the quarantined brief).
