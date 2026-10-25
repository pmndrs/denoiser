# NRD change-magnitude audit: how much changed since the 2021 public descriptions

_Status: **final** (2026-10-25). Audit date: 2026-10-25. Auditor: the change-magnitude agent (RULES.md rule 3c; RULES §8 register
row "change auditor"). The auditor does not write or review our passes (rule 8)._

This file measures NVIDIA's NRD history **as numbers only**: tags, dates, line and file counts
between releases, grouped by area using file paths. It says how much changed and when, and compares
that with the release audit ([nrd-releases.md](nrd-releases.md), rule 3b). It never says what the
code does.

**What was and wasn't looked at.** No file contents, diff hunks or commit messages (subjects or
bodies) were opened, printed or read. Git computed the diffs internally; only its counts
(`--numstat`), status letters (`--name-status`), paths, blob sizes, hashes, dates and ref names were
printed. No working tree was checked out. The raw release notes were not read (the release
auditor's summary was). NRD's README was not opened.

## How it was measured

**Clone.** `git clone --no-checkout https://github.com/NVIDIA-RTX/NRD nrd-churn` into this
session's scratch directory
(`/private/tmp/claude-502/-Users-dex-Developer-Denoiser-nrd-cleanroom/e9f5ef6a-5b0b-422e-b903-b6fd737cf629/scratchpad/nrd-churn/`),
outside the repo. HEAD = `e06852b` = tag `v4.18.0` (2026-10-09). 492 commits, the first dated
2020-06-08; 78 tags from `v2.5.0` (2021-07-19) to `v4.18.0`. **The clone was deleted at the end of
the audit** (`rm -rf` of that folder; see the last section).

**Commands (exact; `<a>`, `<b>` are tags or the hashes listed below):**

```
git clone --no-checkout https://github.com/NVIDIA-RTX/NRD nrd-churn
git tag --sort=creatordate --format='%(refname:short) %(creatordate:short)'
git log -1 --format='%h %ad %D'
git log --reverse --format='%h %ad' --date=short | head -1
git log --format='%h %ad %D' --date=short v2.5.0          # hashes + dates of the 20 pre-tag commits
git rev-list --count HEAD ; git rev-list --count --merges HEAD
git rev-list --count <a>..<b> [-- <every path of one area>]  # commits per release / per area
git ls-tree -r --name-only <tag>                          # paths, for grouping
git ls-tree -r -l -z <tag>                                # paths + blob sizes
git diff --numstat -z 4b825dc642cb6eb9a060e54bf8d69288fbee4904 <tag>   # lines per file at a tag (vs the empty tree)
git diff --numstat -z -M -l99999 <a> <b>                  # raw line counts, rename detection on
git diff --numstat -z -w -M -l99999 <a> <b>               # same, whitespace ignored (primary figures)
git diff --name-status -z -M -l99999 <a> <b>              # files added / deleted / renamed / modified
git diff --numstat -z -w -l99999 {-M | -M30% | -M20% | -C30% --find-copies-harder -M30%} <a> <b>   # rename-sensitivity check
git diff --numstat -M [--ignore-cr-at-eol | -w] 93ea3f5 v2.5.0 -- NRD/Include Include   # line-ending check
git diff --name-status -M v3.0.0 v3.1.0 | grep …          # path names only
git ls-tree -r --name-only <tag> | grep -ci mipgen         # count of paths with that token
```

Small Python scripts (in the scratch directory, not committed) ran these commands and summed the
numbers per area. They never read a blob.

**Pre-tag history.** The NRD library lived under `NRD/` next to other projects (the NRI library,
samples, test scenes) until `v2.5.0`. For the untagged 2021 commits `936607c` (2020-12-16),
`6263dce` (2021-02-03), `53f4ad4` (2021-04-13, the week of GTC 2021), `837df2f` (2021-04-19),
`f9ff996` (2021-05-04), `22ce09f` (2021-05-07) and `93ea3f5` (2021-05-20), the `NRD/` prefix was
stripped before grouping, and every path outside `NRD/` and `External/` was left out.

### Areas (path rules only)

| area | paths |
|---|---|
| ReBLUR | file name or folder starting `REBLUR`/`Reblur` (shaders and the per-denoiser host file), except the two rows below |
| occlusion variants | ReBLUR paths whose file name contains `Occlusion` (AO, SO, AO+SO, directional occlusion) |
| SH variants | ReBLUR or ReLAX paths whose file name contains `DiffuseSh`, `SpecularSh` or `DiffuseSpecularSh` |
| ReLAX | file name or folder starting `RELAX`/`Relax`, except SH |
| SIGMA | file name or folder starting `SIGMA`/`Sigma` |
| REFERENCE | file name starting `REFERENCE`/`Reference` |
| specular MV utils | file names with `SpecularReflectionMv`, `SpecularDeltaMv`, `DeltaOptimizationMv` (removed in v4.8.0) |
| shared shader code | any other `.hlsl`/`.hlsli` (common includes, clear and mip-generation shaders, Poisson table) |
| API headers | `Include/*.h` |
| NRD.hlsli | `NRD.hlsli` / `NRD.hlsl`, wherever it sits (the application-side shader helper header) |
| library core | other files under `Source/` (instance, wrapper, timer, allocator) |
| integration | `Integration/` |
| build/scripts | CMake files, `.bat`/`.sh`, `Scripts/`, `.github/`, `.gitmodules`, `.gitignore`, `.clang-format`, `Shaders.cfg`, `Resources/` (version resource) |
| docs | `README.md`, `UPDATE.md`, `LICENSE.txt`, `CLA.txt`, `Images/` |
| external deps | `External/` (MathLib was vendored, ~13 k lines, until v2.5.0, then a submodule, then gone from the tree). Left out of the churn tables. |
| other | nothing landed here |

"Layer": `.hlsl`/`.hlsli` = shader, everything else = host.

### Metrics

- **+add / −rem**: lines from `git diff --numstat -w -M` between two tags. A changed line counts once in
  each. Whitespace-only changes are ignored: several releases converted line endings (e.g. the header
  move at v2.5.0 shows 331 of 335 lines "changed" in `NRDDescs.h` raw, 0 with `-w`). Raw figures
  are given next to the `-w` ones in the cumulative tables.
- **rem%** = removed lines ÷ the area's line count at the earlier tag: the share of the starting lines
  that were deleted or changed.
- **edited / deleted split**: removed lines in files that still exist (modified or renamed) vs lines
  in files that were deleted. Deleted-file lines are mostly packaging (files merged, permutations
  generated instead of hand-written), but can also be real removals.
- **Chained estimate of lines replaced** over a window = 1 − Π(1 − rem%ᵢ) over consecutive releases. It
  assumes edits land on random lines; since edits cluster on the same hot lines, it **over**-states.
  Given as a range: *edits only* (deleted-file lines left out) – *all removed lines*.
- **Direct diff** between distant tags (e.g. v2.10.0 → v4.18.0) is also shown, but it over-states even
  more: git's rename detection loses track of files across the 2022 and 2025 directory reshuffles, so
  the old file counts as fully deleted. Lowering the rename threshold to 20 % or adding copy
  detection lowers the long-window ReBLUR / ReLAX / SIGMA figures by up to ~20 points (e.g. SIGMA
  since v2.5.0: 100 → 80 %; ReLAX since v4.0.0: 90 → 73 %), so the conclusion does not hinge on it.
- **Gross churn ÷ start**: all added + removed lines over a window, summed release by release,
  divided by the starting size. Shows how many times over an area was rewritten.
- **Verdict per window**: **stable** < 20 % estimated replaced (upper value); **moderate** otherwise;
  **major rework** when even the edits-only estimate is ≥ 50 %.
- **Commits**: until v4.12.0 most releases are 1–3 squashed commits, afterwards tens. Commit counts are
  not comparable across eras and are given for completeness only.

Line counts measure edits, not ideas. A rewrite may keep the same algorithm; a two-line change may
replace one. These numbers say **where to look**, not what changed.

## 1. Answer: has NRD changed majorly since 2021?

**Yes, by line count almost entirely.** Per area, the share of lines replaced since the first release
after the public 2021 material (`v2.5.0`, July 2021; RTG II ch. 49 came out in August 2021 and was
written against code at or before that point):

| area | v2.5.0 → v4.18.0, est. replaced (edits only – all) | v4.0.0 → v4.18.0 | gross churn ÷ size, since v2.5.0 |
|---|---:|---:|---:|
| ReBLUR (its SH/occlusion variants are separate areas) | 97–100 % | 72–85 % | 9.3× |
| ReLAX | 88–98 % | 65–80 % | 7.2× |
| SIGMA | 85–89 % | 64–73 % | 4.5× |
| shared shader code | 73–85 % | 41–44 % | 3.8× |
| API headers (`Include/*.h`) | 84 % | 60 % | 5.8× |
| NRD.hlsli | 84 % | 56 % | 9.5× |

Even ReBLUR's code from the GTC 2021 week (`53f4ad4`) was ~43–52 % replaced by v2.5.0 three months
later, and 92 % of ReBLUR's shader lines were replaced again in v2.9.0 (November 2021). So the code
RTG II describes was already gone by the end of 2021, and the "last 2021 release" (v2.10.0) is itself
a different code base from the book's.

**When.** The rework came in bursts:

- **2021**: ReBLUR (Apr–Jul before the book, then v2.9.0), SIGMA v2.9.0, ReLAX v2.9.0 (new stand-alone
  diffuse/specular denoisers).
- **2022 (v3.0.0 – v3.4.0)**: ReBLUR, ReLAX (v3.0.0, mostly files merged), occlusion, shared shaders
  (v3.1.0). Mostly feature additions announced in the notes (hit-distance reconstruction, SH, settings
  rework).
- **v4.4.0 (Dec 2023)**: every denoiser at once, 19–40 %, a large share of it host code (flexible
  dynamic resolution, "no denoiser uses mips any more").
- **v4.15.0 – v4.16.0 (2025)**: host / integration rework, then shader permutations generated
  instead of hand-written (most removed lines are in deleted files).
- **v4.17.2 – v4.18.0 (2026)**: ReBLUR 15 % in v4.17.2; ReBLUR 15 %, ReLAX 16 %, SIGMA 10 % in v4.18.0
  (15–20 % of their shader lines), with no deleted files behind v4.18.0. v4.18.0 is a pre-release with
  95 commits.

**How much is explained.** Almost every release with large churn has matching items in the release
notes, at the "what" level: new denoisers, inputs, settings, behaviour claims. The "how" is what the
notes don't give, by design of the rule 3b audit (about 417 items left out,
[nrd-releases.md](nrd-releases.md) line 297). One release with large churn has **no** matching note
(SIGMA in v2.9.0). A few are partly explained (section 2). Public talks and papers since 2021 add
nothing on how NRD changed: NVIDIA has published no technical description of ReBLUR, ReLAX or SIGMA
since RTG II ([nrd-public-2022-2026.md](nrd-public-2022-2026.md) lines 14, 283, 474). In practice,
the RTG II / GTC material is the newest public "how" there is, for code that has since been almost
entirely rewritten.

### Verdict per area and window

`a–b %` = estimated share of the window's starting lines replaced, edits only – all removed lines
(single value when equal). Verdict as defined above. The first column (pre-tag) uses all removed lines.

| area | Apr→Jul 2021 (53f4ad4 → v2.5.0), all | 2021 H2 (v2.5.0 → v2.10.0) | 2022 (v2.10.0 → v4.0.0) | 2023 – Aug 2025 (v4.0.0 → v4.15.1-fixed) | Aug 2025 – Oct 2026 (v4.15.1-fixed → v4.18.0) |
|---|---:|---:|---:|---:|---:|
| ReBLUR | 43% | 58–82% major | 79–84% major | 57–66% major | 36–55% moderate |
| ReLAX | 18% | 30–36% moderate | 50–86% major | 52–62% major | 27–47% moderate |
| SIGMA | 26% | 41% moderate | 29–32% moderate | 55–61% major | 20–31% moderate |
| REFERENCE | – | – | 27% moderate | 59% major | 12% stable |
| SH variants | – | – | 8–15% stable | 59–66% major | 7–44% moderate |
| occlusion variants | – | 11% stable | 65–88% major | 46–63% moderate | 6–48% moderate |
| specular MV utils | – | – | 42–50% moderate | 38–100% moderate | – |
| shared shader code | 64% | 7% stable | 50–72% major | 32% moderate | 14–18% stable |
| API headers | 14% | 28% moderate | 43% moderate | 53% major | 14% stable |
| NRD.hlsli | 38% | 17% stable | 56% major | 40% moderate | 27% moderate |
| library core | 28% | 21% moderate | 68% major | 70% major | 23% moderate |
| integration | 2% | 20% moderate | 24% moderate | 73% major | 11% stable |
| build/scripts | 83% | 7% stable | 56% major | 57–73% major | 31–40% moderate |
| docs | 15% | 23% moderate | 44% moderate | 30% moderate | 23% moderate |

Notes: occlusion variants first appear in v2.9.0 (so their "2021 H2" figure is one release), SH
variants in v3.4.0, REFERENCE in v2.12.0; the specular MV utilities exist v3.0.0 – v4.8.0 only.

**Per area, plain verdict:**

| area | verdict since 2021 | where it happened |
|---|---|---|
| ReBLUR | **major rework** | Apr–Jul 2021 (pre-tag), v2.9.0 (79 %, 92 % of shader lines), v3.0.0–v3.4.0 (22–29 % each), v4.4.0 (28 %), v4.16.0 (33 %, two thirds in deleted files), v4.17.2 / v4.18.0 (15 % each) |
| ReLAX | **major rework** | v2.9.0 (36 %, +6 k lines: new stand-alone denoisers), v3.0.0 (71 %, 6.2 k of 6.9 k removed lines in deleted files), v4.4.0 (40 %), v4.16.0 (34 %, mostly deleted files), v4.18.0 (16 %) |
| SIGMA | **major rework** (cumulative; no single release above 40 %) | v2.9.0 (40 %), v4.4.0 (28 %), v4.16.0 (21 %), many 2–13 % steps in 2023–2026, v4.18.0 (10 %) |
| REFERENCE | moderate (small area, ~200 lines) | v3.1.0, v4.4.0, v4.8.0 |
| SH variants | **major rework**, but mostly host code and packaging | v4.1.0 (14 %), v4.4.0 (38 %, mostly host code), v4.15.1 (15 %) and v4.16.0 (43 %), both ≥ 88 % in deleted files |
| occlusion variants | **major rework**, much of it packaging | v3.0.0 (34 %, mostly edits), v3.2.3 / v3.4.0 (43 % / 40 %, 60–70 % in deleted files), v4.15.1 / v4.16.0 (33 % / 47 %, ≥ 90 % in deleted files) |
| specular MV utils | added v3.0.0, removed v4.8.0 | — |
| shared shader code | major in 2022, **stable since** | v3.1.0 (44 %: the shared mip-generation shaders were deleted), v3.0.0–v3.4.0 |
| API headers | moderate per release, **major cumulatively** | v2.9.0 (27 %), v3.0.0 (15 %), v4.4.0 (24 %), ~100 small steps |
| NRD.hlsli | **major** cumulatively | v2.12.0, v3.4.0, v4.1.0 (23 %), v4.17.0 (12 %) |
| library core | **major rework** | v3.9.0 (48 %), v4.1.0 (32 %), v4.2.0 (28 %), v4.15.0 (19 %), v4.16.0 (19 %) |
| integration | **major rework**, mostly in one step | v4.15.0 (50 %) |
| build/scripts | **major rework** | v4.0.0 (35 %), v4.1.0 (31 %), v4.15.0 (28 %), v4.18.0 (21 %) |
| docs | moderate (grows, rarely rewritten) | v2.9.0, v4.0.0, v4.17.0 |

### Where inside the three denoisers (stage grouping by file name)

File names in NRD's shader tree carry stage names that the public material already uses (RTG II
names the pre-blur, temporal accumulation, history fix, blur, post-blur and temporal stabilization
passes; NRD's public interface and release notes name the pre-pass, anti-firefly, hit-distance
reconstruction, validation and history clamping; à-trous is SVGF's public term). Grouping each
denoiser's files by those tokens gives the table below. SH and occlusion variant files are counted
with their denoiser here. Files whose names match none of these tokens are "other files"; files
without a shader extension are "host setup". Chained estimate (all removed lines), so packaging is
included.

| denoiser | stage (grouped by file name) | lines at v2.5.0 / v2.10.0 / v4.0.0 / v4.15.1-fixed / v4.18.0 | est. replaced v2.5.0→v4.18.0 | v4.0.0→v4.18.0 | v4.15.1-fixed→v4.18.0 |
|---|---|---|---:|---:|---:|
| ReBLUR | anti-firefly | 0 / 199 / 0 / 0 / 0 | 70% | – | – |
| ReBLUR | blur | 346 / 383 / 824 / 474 / 261 | 100% | 95% | 78% |
| ReBLUR | debug/validation | 208 / 298 / 583 / 664 / 549 | 99% | 75% | 53% |
| ReBLUR | denoiser-shared code | 1061 / 1555 / 1152 / 1088 / 988 | 100% | 82% | 57% |
| ReBLUR | history fix | 465 / 356 / 948 / 820 / 603 | 100% | 90% | 73% |
| ReBLUR | hit-distance reconstruction | 0 / 0 / 759 / 498 / 228 | 93% | 92% | 77% |
| ReBLUR | host setup | 1152 / 2168 / 3231 / 3282 / 3080 | 96% | 68% | 19% |
| ReBLUR | post-blur | 287 / 393 / 968 / 588 / 203 | 100% | 98% | 94% |
| ReBLUR | pre-pass | 447 / 305 / 626 / 427 / 164 | 100% | 96% | 86% |
| ReBLUR | temporal accumulation | 1258 / 1400 / 1296 / 1305 / 1132 | 100% | 90% | 60% |
| ReBLUR | temporal stabilization | 728 / 540 / 867 / 637 / 409 | 100% | 92% | 69% |
| ReLAX | a-trous | 1117 / 1596 / 1015 / 1183 / 928 | 99% | 81% | 60% |
| ReLAX | anti-firefly | 566 / 727 / 323 / 401 / 273 | 100% | 77% | 62% |
| ReLAX | debug/validation | 146 / 216 / 405 / 510 / 377 | 100% | 77% | 60% |
| ReLAX | denoiser-shared code | 365 / 248 / 275 / 291 / 296 | 99% | 53% | 6% |
| ReLAX | history clamping | 491 / 557 / 290 / 607 / 452 | 100% | 85% | 60% |
| ReLAX | history fix | 0 / 0 / 284 / 378 / 238 | 92% | 90% | 77% |
| ReLAX | hit-distance reconstruction | 0 / 0 / 343 / 369 / 218 | 88% | 86% | 70% |
| ReLAX | host setup | 855 / 1532 / 1841 / 2321 / 2165 | 94% | 82% | 20% |
| ReLAX | other files | 2787 / 3947 / 0 / 288 / 174 | 98% | 82% | 71% |
| ReLAX | pre-pass | 0 / 1133 / 467 / 581 / 475 | 98% | 83% | 57% |
| ReLAX | temporal accumulation | 0 / 0 / 1074 / 1202 / 1062 | 90% | 76% | 46% |
| SIGMA | blur | 300 / 317 / 296 / 358 / 392 | 96% | 81% | 38% |
| SIGMA | debug/validation | 104 / 102 / 103 / 115 / 92 | 93% | 78% | 49% |
| SIGMA | denoiser-shared code | 151 / 148 / 176 / 205 / 184 | 63% | 57% | 23% |
| SIGMA | host setup | 383 / 402 / 349 / 516 / 524 | 87% | 75% | 15% |
| SIGMA | other files | 284 / 271 / 273 / 380 / 312 | 88% | 70% | 44% |
| SIGMA | temporal stabilization | 261 / 259 / 271 / 313 / 284 | 96% | 76% | 32% |

Read with care: the v4.15.1 / v4.16.0 file merges show up as removed lines in every stage. The
point of the table is that **no stage was left alone**: every ReBLUR stage named in RTG II is
estimated ≥ 90 % replaced since v4.0.0, the shared ReBLUR code 82 %, and ReLAX and SIGMA stages
mostly at 70–90 % (their shared code 53–57 %).

## 2. Comparison with the release notes and public research

Sources compared:

- [nrd-releases.md](nrd-releases.md) (release auditor, rule 3b), as committed in `b4b38bd`. Cited as
  "R:L*n*" = its line *n*.
- [nrd-public-2022-2026.md](nrd-public-2022-2026.md) (research agent, public talks and papers
  2022–2026), as committed in `4feaf4e` (text complete, final polish was still in progress). Cited as
  "P:L*n*".

**What the public material adds.** Very little about NRD itself: "NVIDIA has published almost nothing
technical about ReBLUR, ReLAX or SIGMA since RTG II (2021)"; its pages are product blurbs and "no
NVIDIA talk, paper or blog since RTG II describes how any of the three denoisers works" (P:L14,
P:L283, P:L474). The ReLAX GTC 2021 talk and any SIGMA description could not be found (P:L476,
P:L478). The only NRD-specific public items are the NRD 2.0 / 2.9 blog posts (P:L279), the CY23
"simplified layout" slide that still cites RTG II (P:L190), and CL22's use of NRD on decomposed
path-tracer signals (P:L202–209). Third parties describe their own pipelines that resemble NRD's
public stage names (Ubisoft's MSD, P:L110–112, P:L132–134), which say nothing about NRD's code.

So the "public" column below upgrades **no** flag except ReLAX v2.9.0 (already explained by the notes)
and downgrades none. Every "explained" in this section means explained at the **what** level by the
release notes; at the **how** level, no change since RTG II is publicly explained.

Flags: **explained** = the notes announce changes in that area in that release on a scale that fits
the churn (new denoiser, input, settings rework, packaging, or several behaviour claims);
**partly explained** = the notes say something, but much less than the churn suggests;
**unexplained** = large churn, no matching note.

### ReBLUR

| release | churn | what the release notes say | flag | public |
|---|---|---|---|---|
| pre-tag Apr–Jul 2021 (`53f4ad4` → v2.5.0) | 43–52 % | v2.5.0 notes list specular-tracking, history-rejection, roughness and hit-distance fixes (R:L44). Nothing covers the months before v2.5.0 (no earlier release on GitHub, R:L17). | **partly explained** | none; GTC 2021 / RTG II are the last technical NVIDIA sources (P:L14) |
| v2.9.0 (2021-11) | 79 %; 3040 lines removed in edited files + 1674 in deleted files, of 5952; **92 % of shader lines** | New occlusion denoisers, confidence inputs, direction-PDF inputs for an optional advanced pre-pass, `accumulationMode`, material-ID filtering, "REBLUR anti-firefly reworked", less specular smearing, better tracking on curved surfaces (R:L45) | **partly explained**: features added, but a near-total shader rewrite is described only as behaviour | NRD 2.9 blog (Nov 2021) names the new AO / SO denoisers only (P:L279); nothing on the rest |
| v3.0.0 (2022-03) | 29 % | Settings reworked into `ReblurSettings`, performance mode, better disocclusions, more normal and shadow detail, low-roughness reprojection fixed (R:L50) | explained | none; CY23 (SIGGRAPH 2023) still shows the RTG II-era layout and cites the chapter (P:L190) |
| v3.1.0 | 22 % | Firefly suppression always on, diffuse-only denoisers skip specular work (R:L51) | explained | none (P:L283, P:L474) |
| v3.2.3 | 25 % | Hit-distance reconstruction, probabilistic lobe sampling, pre-pass settings, ~13 % faster, several reprojection claims (R:L52) | explained | none (P:L283, P:L474) |
| v3.4.0 | 27 % | SH denoisers, TS can be turned off, memory reduced, better history reconstruction in disocclusions (R:L55) | explained | none (P:L283, P:L474) |
| v4.4.0 (2023-12) | 28 % (1372 edited + 896 deleted) | Flexible DRS, "no denoiser uses mips any more", thin objects, material-boundary outlines, disocclusion colour bleeding (R:L76) | explained | none (P:L283, P:L474) |
| v4.14.0 | 8 % | "REBLUR outputs are no longer used as history", +6 % / +10 % perf, −10 % memory, specular motion changed (old method kept behind a define) (R:L93) | explained | none (P:L283, P:L474) |
| v4.15.0 – v4.16.0 (2025) | 5 % / 13 % / 33 %; in v4.16.0 1490 of 2246 removed lines are in deleted files | Compile-time specialization; "160+ hand-written shader permutations replaced by ShaderMake generation"; history length in `.w`; `fastHistoryClampingSigmaScale`, `ResponsiveAccumulationSettings`; better disocclusions and glossy history (R:L95–97) | explained | none (P:L283, P:L474) |
| v4.17.2 (2026-03) | 15 % (424 edited + 470 deleted) | MV patching and `IN_BASECOLOR_METALNESS` removed; faster; less noise at lobe boundaries; less bias, better shadow preservation (R:L101) | explained | none (P:L283, P:L474) |
| v4.18.0 (2026-10, pre-release) | 15 %, 835 lines removed in edited files, no deleted files | Time-based accumulation (`REBLUR_FRAME_RATE_COMPENSATION`); specular tracking on glossy, camera-attached and tiled surfaces; less ghosting from bright foreground reflections; strafing smear fixed; diffuse disocclusions; zero hit distances (R:L103) | explained | none; a news snippet repeated release-note facts only (P:L502) |

The notes date two structural changes that touch what RTG II describes: mips dropped in v4.4.0
(R:L76; the chapter's history fix is mip-based, [reblur.md](reblur.md)) and outputs no longer used
as history in v4.14.0 (R:L93). Path names agree on timing only loosely: the shared mip-generation
shader files were deleted in v3.1.0, and no path contains `MipGen` from v3.4.0 on, over a year
before the notes' v4.4.0 entry. That gap is not explained by the notes.

### ReLAX

| release | churn | what the release notes say | flag | public |
|---|---|---|---|---|
| v2.9.0 | 36 %, +6042 lines, 22 files added | Stand-alone `RELAX_DIFFUSE` and specular-only denoisers; more stable specular, less darkening at low rpp, 0.5-rpp history (R:L45) | explained | NRD 2.9 blog: ReLAX diffuse-only / specular-only (P:L279). Explained publicly too |
| v3.0.0 (2022-03) | 71 %; 6166 of 6924 removed lines in 49 deleted files; edits 8 % | Settings renames (`diffuseLobeAngleFraction`, material test, roughness fraction, reprojection tests), quarter-resolution and concave-surface fixes (R:L50). Nothing about merging the per-signal code | **partly explained** (packaging not mentioned; the edits fit the fixes) | none; the GTC 2021 ReLAX talk could not be found (P:L476) |
| v3.1.0 – v3.4.0 | 11–16 % each | Hit-distance reconstruction, luminance weights, ~17 % faster, memory (v3.2.3, R:L52); confidence-driven relaxation settings, better anti-firefly (v3.4.0, R:L55) | explained | none (P:L283, P:L474) |
| v4.4.0 (2023-12) | 40 %: 65 % of host lines, 32 % of shader lines | RELAX separate diffuse/specular settings structs removed, "RELAX host code 181 KB → 99 KB", flexible DRS, no mips (R:L76) | explained for the host part; **partly** for the shader part (no RELAX behaviour claim) | none (P:L283, P:L474) |
| v4.11.0 | 11 % (14 % of shader lines) | One shared lobe fraction, "max accumulated frames" clamped, dummy allocation removed (R:L87) | partly explained | none (P:L283, P:L474) |
| v4.16.0 | 34 %; 1631 of 2246 removed lines in deleted files | ShaderMake permutations; RELAX returns history length instead of squared variance in `.w` (R:L97) | explained | none (P:L283, P:L474) |
| v4.18.0 | 16 %, 885 shader lines removed in edited files | `RELAX_FRAME_RATE_COMPENSATION`, zero-hit-distance handling, hit-distance reconstruction roughness weighting fixed, "SIGMA/RELAX slightly faster" (R:L103, R:L229) | partly explained (few ReLAX-specific behaviour items for ~20 % of its shader lines) | none (P:L283, P:L474) |

ReLAX's main public description, the GTC 2021 talk, is still unread in our notes
([svgf-relax.md](svgf-relax.md) S13). So ReLAX has both a large change and a thin public baseline.

### SIGMA

| release | churn | what the release notes say | flag | public |
|---|---|---|---|---|
| v2.9.0 (2021-11) | 40 %: 592 lines removed (51 % of shader lines), no deleted files, 8 renames | **No SIGMA item.** The v2.9.0 notes are about REBLUR, RELAX and the common API (R:L45). The SIGMA claims ("2× faster", "closer to the reference in umbra–penumbra", "no lag on hard shadows") are in v2.5.0 (R:L44), the release before | **unexplained** | none; no public SIGMA description at all, 2021–2026 (P:L478) |
| v3.1.0 / v4.1.0 | 15 % / 13 % | No SIGMA item (R:L51, R:L67) | unexplained, but moderate | none (P:L478) |
| v4.4.0 (2023-12) | 28 % | "SIGMA less bias, more stable" (R:L76) | explained | none (P:L478) |
| v4.7.0 – v4.11.0 (2024) | 6 %, 6 %, 4 %, 2 %, 2 %, 11 % (v4.7.0, v4.8.0, v4.8.2, v4.9.0, v4.10.0, v4.11.0) | Large claims: TS optional for many lights, `lightDirection`, umbra in wide penumbra (v4.7.0, R:L80); shared viewZ, renamed inputs (v4.8.0, R:L81); sub-pixel and nested penumbrae, less flicker (v4.8.2, R:L83); "notable IQ improvements: less flickering in motion, better responsiveness" (v4.10.0, R:L86); ghosting at disocclusions removed (v4.11.0, R:L87) | explained; the reverse case: **big behaviour claims from small edits** (v4.10.0: 36 lines removed) | none (P:L478) |
| v4.16.0 | 21 % (159 edited + 240 deleted) | Honours the denoising range, better at screen edges; ShaderMake (R:L97) | explained | none (P:L478) |
| v4.18.0 | 10 %, 176 lines removed in edited files | Checkerboard support, "better spatial filtering and TS", better umbra in penumbra, `SIGMA_PRESERVE_SHADOWS_IN_PENUMBRA` (R:L103) | explained | none; a news snippet repeated the penumbra flag only (P:L503) |

SIGMA has **no public algorithm description at all** in our sources (no chapter or talk;
[shadows-specular.md](shadows-specular.md) builds shadows from other public work). Its 2021
baseline is the release notes themselves.

### Other areas with major churn

| area / release | churn | what the release notes say | flag | public |
|---|---|---|---|---|
| SH variants, v4.1.0 | 13 %, 28 files added | SH → SG resolve, re-jittering, RELAX gains SH (R:L67) | explained | none on NRD's SG resolve; third-party SH recipes only (P:L410, P:L404) |
| SH variants, v4.4.0 | 38 %, mostly host code, no deleted files | Host and API rework: flexible DRS, RELAX host code shrink, RELAX settings structs merged (R:L76). No SH-specific item | explained (host part); partly for the rest | none (P:L283, P:L474) |
| SH / occlusion variants, v4.15.1 / v4.16.0 | 15–47 %, ≥ 88 % in deleted files | Compile-time specialization, ShaderMake permutations (R:L96–97). From v4.16.0 these variants have **no shader files of their own**: only host setup files remain; their shader code lives in the shared ReBLUR / ReLAX files, where line counts cannot separate it | explained (packaging) | none (P:L283, P:L474) |
| occlusion variants, v3.0.0 – v3.4.0 | 34–43 %; v3.0.0 mostly edits, v3.2.3 / v3.4.0 60–70 % in deleted files | Directional occlusion fixes and memory "significantly" reduced come in v3.4.x / v3.5.0 (R:L56–57); nothing occlusion-specific in v3.0.0 – v3.2.3 | partly explained | none (P:L283, P:L474) |
| shared shader code, v3.1.0 | 44 %, 8 mip-generation files deleted | Normal encoding via CMake, Slang fixes (R:L51). Nothing about mips until v4.4.0 (R:L76) | partly explained | none (P:L283, P:L474) |
| library core, v3.9.0 | 48 % (host) | Validation layer moved to a per-frame setting, 2.5D motion vectors, no double clears for grouped denoisers (R:L61) | partly explained | none (P:L283, P:L474) |
| library core, v4.1.0 / v4.2.0 | 32 % / 28 % | ShaderMake, `NRD_HEADER_ONLY` removed (R:L67); one instance for any mix of denoisers, `Denoiser` → `Instance` rename (R:L69; the files were renamed accordingly) | explained | none on NRD; CL22 (GDC/GTC 2022) runs NRD kernels on several decomposed signals of one path tracer (P:L202–209), the use case a multi-denoiser instance serves |
| integration, v4.15.0 | 50 % | "Integration reworked: wraps native D3D11 / D3D12 / Vulkan objects", `Recreate`, `ResourceSnapshot` (R:L95) | explained | none (P:L283, P:L474) |
| API headers, v2.9.0 / v3.0.0 / v4.4.0 | 27 % / 15 % / 24 % | Long lists of new, renamed and removed settings in each (R:L45, R:L50, R:L76) | explained | none (P:L283, P:L474) |
| NRD.hlsli, v2.12.0 / v4.1.0 / v4.17.0 | 16 % / 23 % / 12 % | Packing helpers (R:L47); SG helpers (R:L67); SG resolve and re-jitter changes (R:L99) | explained | none (P:L283, P:L474) |
| build/scripts, v4.0.0 / v4.1.0 / v4.15.0 | 35 % / 31 % / 28 % | CMake rewritten (R:L64), ShaderMake (R:L67), CMake `NRD_NRI` (R:L95) | explained | none (P:L283, P:L474) |

**Consistency checks.** v4.6.0 says "no algorithmic changes" (R:L79) and measures < 1 % in every
denoiser. v4.3.1 – v4.3.6, v4.9.x and v4.14.1 – v4.14.3 are fix releases in the notes and measure
< 1–9 % per area. The notes and the numbers agree wherever both are small.

## 3. Worth reading into

Ranked by "large change, little public explanation", weighted by how much our denoiser leans on the
area. Each item gives a next step. No item says anything about NRD's implementation; the probes
compare outputs only (rule 4). T-numbers are the release audit's scenarios (R:L268–291).

The public research already searched 2022–2026 and found no NVIDIA technical material on any of the
three denoisers (P:L474–478). So for every item below, **the black-box probe is the first step**;
public searches are reduced to the few leads that research could not reach.

1. **SIGMA (shadows): unexplained 2021 rework, steady change since, no public description ever.**
   v2.9.0 rewrote about half of SIGMA's shader lines with no SIGMA note; 2023–2025 replaced another
   55–61 % in small steps that the notes describe only as claims; v4.18.0 changed it again. Our
   shadow denoiser is being tuned on moving occluders right now (M4 `moving-knot`).
   - **Probe (Windows harness):** T1 (moving occluder over a receiver, hard light and wide area light,
     then stopping dead: score penumbra flicker, trail, settle time), T3 (sub-pixel and contact
     penumbrae), T4 (umbra inside a wide penumbra; with and without
     `SIGMA_PRESERVE_SHADOWS_IN_PENUMBRA`), T21 (checkerboard shadow input), on the same captures we
     feed our own filter. If the harness can build more than one version, run **v4.9.4 vs v4.11.0 vs
     v4.18.0** on T1: the notes put the moving-shadow claims in v4.10.0 – v4.11.0 (R:L86–87) and the
     line counts say those were small edits, so a before/after output comparison isolates that
     behaviour cheaply.
   - **Public material:** none on SIGMA exists (P:L478). For our own design, the research lists
     adjacent published techniques for moving shadows (P:L362–392, U1/U2/U6/U7 at P:L452–458); those
     are design inputs, not explanations of SIGMA. Remaining lead: postmortems of games that shipped
     NRD shadows (e.g. *Dark Souls 2: PT*, named in R:L100).

2. **ReBLUR's 2021 rework, after the book.** The book's ReBLUR is the code of early to mid 2021. That
   code was half replaced by v2.5.0 and 92 % of the shader lines again in v2.9.0, which the notes
   describe as feature additions and behaviour only. Every RTG II stage has since been rewritten
   several times over (stage table). The notes give strong "what" hints with dates: mips dropped
   (v4.4.0), outputs not used as history (v4.14.0), anti-lag always on (v4.3.0), time-based
   accumulation (v4.11.0, v4.18.0).
   - **Probe:** T15 (disocclusion with short history: frames 0–N after a reveal; score noise and fill
     radius), T2 (light switched on/off with static geometry: frames to the new level, with and
     without a confidence input), T7 / T8 (mirror, near-mirror and curved reflectors with camera
     motion), T16 (uneven frame pacing). Compare NRD's frame-by-frame response curves with what the
     chapter's description predicts and with ours; where NRD's curve departs from the chapter's, that
     is post-2021 behaviour to design for ourselves.
   - **Public material:** none on ReBLUR after RTG II (P:L474); CY23 (2023) still presents the
     chapter's layout (P:L190). Remaining leads are talks whose slides are not public: GDC 2023
     *Cyberpunk 2077 RT: Overdrive*, GDC 2024 *Alan Wake 2 path tracing*, GDC 2025 *Indiana Jones*
     (P:L481–485); check for recorded video. Third-party recurrent pipelines with similar public stage
     names (Ubisoft MSD, P:L110–112, P:L299–303) are design references for us, not evidence about
     NRD.
   - Also unexplained by the notes: mip-generation file names vanish in v3.1.0 / v3.4.0, while the
     notes date the end of mips to v4.4.0. A public source that dates this would settle which release
     first changed the history-fix behaviour; a v3.3.1 vs v3.4.0 probe on T15 would show it directly.

3. **ReLAX: big shader churn, thin public baseline.** 2022 (v3.0.0, mostly merged files) and v4.4.0
   (32 % of shader lines) carry little ReLAX-specific behaviour text; v4.11.0 and v4.18.0 edit 14–20 %
   of its shader lines with one or two ReLAX items each. Our SVGF-family filter relies on ReLAX's
   public description, whose main source (the GTC 2021 talk, S32759) the public research could not
   find either (P:L476). Nothing later covers ReLAX anti-lag (v4.3.0, R:L72) or ReLAX SH (v4.1.0,
   R:L67).
   - **Public lead:** only NVIDIA On-Demand with an account, for the GTC 2021 talk
     ([svgf-relax.md](svgf-relax.md) S13).
   - **Probe:** T2 (light change) and T15 (disocclusion) with ReLAX, plus the history length it can
     output (validation since v4.0.0, `.w` since v4.16.0) to see accumulation speed per pixel from the
     outside.

4. **All three denoisers in v4.18.0 (pre-release, 2026-10).** Explained by the notes, but it is the
   largest non-packaging edit in years (15–20 % of each denoiser's shader lines, 95 commits) and it
   ships behaviours we haven't tested against: strafing smear, ghosting from bright foreground
   reflections, tiled surfaces, frame-rate compensation (R:L103).
   - **Probe:** T10 (strafing past a grazing glossy surface), T7 with a bright foreground object,
     T11 (tiled floor), T16 (uneven frame pacing), on v4.17.3 and v4.18.0.

5. **Occlusion and SH variants: low priority.** The churn is mostly packaging or host code and the
   notes explain it. From v4.16.0 their shader code is inside the shared denoiser files, so line
   counts can't track them further. Only worth a probe if we build AO or SH output: T15 for AO, and
   the SG resolve with re-jittering under an upscaler (R:L99) for SH.

Not worth reading into: library core, integration, build, API headers and NRD.hlsli. Their churn is
large, but it is API and host plumbing, and the notes list it item by item.

## 4. Appendix: tables

All line figures are `-w` (whitespace ignored) unless marked raw.

### Area size (lines / files) at selected tags

| area | v2.5.0 (2021-07-19) | v2.10.0 (2021-11-18) | v3.0.0 (2022-03-21) | v4.0.0 (2022-12-20) | v4.5.0 (2024-02-20) | v4.10.0 (2024-10-09) | v4.15.0 (2025-06-02) | v4.15.1 (2025-08-19) | v4.16.0 (2025-10-22) | v4.18.0 (2026-10-09) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| ReBLUR | 5952 / 51 | 5203 / 53 | 5143 / 80 | 6863 / 87 | 7947 / 90 | 7896 / 90 | 7759 / 85 | 6887 / 58 | 5882 / 28 | 5808 / 27 |
| ReLAX | 6327 / 38 | 9956 / 59 | 5519 / 45 | 6317 / 55 | 6559 / 63 | 6548 / 63 | 6565 / 63 | 6579 / 63 | 5617 / 30 | 5682 / 30 |
| SIGMA | 1483 / 26 | 1499 / 25 | 1507 / 25 | 1468 / 24 | 1559 / 25 | 1618 / 25 | 1887 / 29 | 1887 / 29 | 1671 / 17 | 1788 / 17 |
| REFERENCE | 0 / 0 | 0 / 0 | 186 / 5 | 191 / 5 | 195 / 5 | 228 / 6 | 234 / 6 | 234 / 6 | 235 / 6 | 259 / 6 |
| SH variants | 0 / 0 | 0 / 0 | 0 / 0 | 2088 / 51 | 3713 / 82 | 3713 / 82 | 3511 / 79 | 2985 / 58 | 1901 / 6 | 1889 / 6 |
| occlusion variants | 0 / 0 | 2394 / 33 | 2689 / 49 | 2303 / 60 | 2200 / 60 | 2200 / 60 | 2153 / 60 | 1463 / 32 | 898 / 4 | 896 / 4 |
| specular MV utils | 0 / 0 | 0 / 0 | 502 / 6 | 536 / 6 | 575 / 6 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 |
| shared shader code | 1121 / 6 | 1641 / 14 | 1480 / 14 | 986 / 6 | 1036 / 6 | 1081 / 6 | 1172 / 6 | 1197 / 6 | 1136 / 4 | 1141 / 4 |
| API headers | 647 / 3 | 903 / 3 | 971 / 3 | 1053 / 3 | 1018 / 3 | 1005 / 3 | 1050 / 3 | 1047 / 3 | 1081 / 3 | 1116 / 3 |
| NRD.hlsli | 378 / 1 | 452 / 1 | 587 / 1 | 719 / 1 | 1114 / 1 | 1082 / 1 | 1170 / 1 | 1170 / 1 | 1178 / 1 | 1338 / 1 |
| library core | 1487 / 6 | 1801 / 6 | 2010 / 6 | 2513 / 6 | 1917 / 7 | 1822 / 6 | 1786 / 6 | 1812 / 6 | 1665 / 6 | 1686 / 6 |
| integration | 634 / 2 | 697 / 2 | 715 / 2 | 808 / 2 | 838 / 2 | 917 / 2 | 1370 / 2 | 1363 / 2 | 1297 / 2 | 1310 / 2 |
| build/scripts | 505 / 10 | 509 / 10 | 573 / 14 | 681 / 15 | 882 / 15 | 882 / 15 | 1112 / 15 | 1124 / 15 | 1019 / 15 | 1129 / 15 |
| docs | 766 / 2 | 1014 / 3 | 1050 / 4 | 1380 / 8 | 1576 / 9 | 1659 / 9 | 1724 / 9 | 1734 / 9 | 1760 / 9 | 1993 / 11 |
| external deps | 13278 / 10 | 1 / 1 | 1 / 1 | 1 / 1 | 2 / 2 | 2 / 2 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 |

### Cumulative churn

**v2.5.0 (2021-07-19) → v4.18.0 (2026-10-09)**, 472 commits

| area | lines start → end | direct diff +add / −rem | direct rem% (raw) | files A / D / R | chained est. replaced (edits only – all) | Σ per-release rem% | gross churn ÷ start | commits touching |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| ReBLUR | 5952 → 5808 | +5808 / −5952 | 100% (100%) | 27 / 51 / 0 | 97–100% | 430% | 9.3× | 185 |
| ReLAX | 6327 → 5682 | +5682 / −6327 | 100% (100%) | 30 / 38 / 0 | 88–98% | 315% | 7.2× | 106 |
| SIGMA | 1483 → 1788 | +1788 / −1483 | 100% (100%) | 17 / 26 / 0 | 85–89% | 199% | 4.5× | 63 |
| REFERENCE | 0 → 259 | +259 / −0 | – (–) | 6 / 0 / 0 | new | – | – | 28 |
| SH variants | 0 → 1889 | +1889 / −0 | – (–) | 6 / 0 / 0 | new | – | – | 25 |
| occlusion variants | 0 → 896 | +896 / −0 | – (–) | 4 / 0 / 0 | new | – | – | 32 |
| shared shader code | 1121 → 1141 | +731 / −711 | 63% (63%) | 3 / 5 / 1 | 73–85% | 171% | 3.8× | 77 |
| API headers | 647 → 1116 | +812 / −343 | 53% (54%) | 0 / 0 / 0 | 84–84% | 170% | 5.8× | 121 |
| NRD.hlsli | 378 → 1338 | +1338 / −378 | 100% (100%) | 1 / 1 / 0 | 84–84% | 173% | 9.5× | 84 |
| library core | 1487 → 1686 | +1505 / −1306 | 88% (89%) | 2 / 2 / 0 | 94–94% | 246% | 7.1× | 77 |
| integration | 634 → 1310 | +1065 / −389 | 61% (68%) | 0 / 0 / 0 | 86–86% | 168% | 5.9× | 61 |
| build/scripts | 505 → 1129 | +1025 / −401 | 79% (81%) | 12 / 7 / 1 | 88–93% | 245% | 9.3× | 200 |
| docs | 766 → 1993 | +1459 / −232 | 30% (33%) | 9 / 0 / 0 | 77–77% | 138% | 6.3× | 152 |

**v2.10.0 (2021-11-18) → v4.18.0 (2026-10-09)**, 469 commits

| area | lines start → end | direct diff +add / −rem | direct rem% (raw) | files A / D / R | chained est. replaced (edits only – all) | Σ per-release rem% | gross churn ÷ start | commits touching |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| ReBLUR | 5203 → 5808 | +5808 / −5203 | 100% (100%) | 27 / 53 / 0 | 94–98% | 337% | 8.7× | 183 |
| ReLAX | 9956 → 5682 | +5682 / −9956 | 100% (100%) | 30 / 59 / 0 | 83–97% | 279% | 3.7× | 104 |
| SIGMA | 1499 → 1788 | +1788 / −1499 | 100% (100%) | 17 / 25 / 0 | 74–82% | 158% | 3.6× | 61 |
| REFERENCE | 0 → 259 | +259 / −0 | – (–) | 6 / 0 / 0 | new | – | – | 28 |
| SH variants | 0 → 1889 | +1889 / −0 | – (–) | 6 / 0 / 0 | new | – | – | 25 |
| occlusion variants | 2394 → 896 | +896 / −2394 | 100% (100%) | 4 / 33 / 0 | 82–98% | 312% | 5.8× | 30 |
| shared shader code | 1641 → 1141 | +716 / −1216 | 74% (74%) | 2 / 12 / 2 | 71–84% | 164% | 2.2× | 76 |
| API headers | 903 → 1116 | +683 / −470 | 52% (53%) | 0 / 0 / 0 | 77–77% | 141% | 3.5× | 119 |
| NRD.hlsli | 452 → 1338 | +1338 / −452 | 100% (100%) | 1 / 1 / 0 | 81–81% | 155% | 7.5× | 82 |
| library core | 1801 → 1686 | +1501 / −1616 | 90% (92%) | 2 / 2 / 0 | 93–93% | 225% | 5.3× | 75 |
| integration | 697 → 1310 | +1057 / −444 | 64% (68%) | 0 / 0 / 0 | 82–82% | 147% | 4.9× | 59 |
| build/scripts | 509 → 1129 | +1025 / −405 | 80% (81%) | 12 / 7 / 1 | 87–93% | 238% | 9.1× | 197 |
| docs | 1014 → 1993 | +1252 / −273 | 27% (27%) | 8 / 0 / 0 | 70–70% | 115% | 4.2× | 150 |

**v2.10.0 (2021-11-18) → v4.0.0 (2022-12-20)**, 22 commits

| area | lines start → end | direct diff +add / −rem | direct rem% (raw) | files A / D / R | chained est. replaced (edits only – all) | Σ per-release rem% | gross churn ÷ start | commits touching |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| ReBLUR | 5203 → 6863 | +6325 / −4704 | 90% (93%) | 77 / 46 / 7 | 79–84% | 164% | 4.1× | 19 |
| ReLAX | 9956 → 6317 | +5384 / −9070 | 91% (93%) | 51 / 56 / 1 | 50–86% | 141% | 1.9× | 14 |
| SIGMA | 1499 → 1468 | +552 / −583 | 39% (40%) | 10 / 11 / 12 | 29–32% | 37% | 0.7× | 12 |
| REFERENCE | 0 → 191 | +191 / −0 | – (–) | 5 / 0 / 0 | new | – | – | 7 |
| SH variants | 0 → 2088 | +2088 / −0 | – (–) | 51 / 0 / 0 | new | – | – | 7 |
| occlusion variants | 2394 → 2303 | +2029 / −2008 | 84% (88%) | 57 / 24 / 0 | 65–88% | 176% | 4.1× | 15 |
| specular MV utils | 0 → 536 | +536 / −0 | – (–) | 6 / 0 / 0 | new | – | – | 11 |
| shared shader code | 1641 → 986 | +526 / −1207 | 74% (74%) | 1 / 11 / 5 | 50–72% | 108% | 1.4× | 14 |
| API headers | 903 → 1053 | +446 / −296 | 33% (33%) | 0 / 0 / 0 | 43–43% | 55% | 1.4× | 20 |
| NRD.hlsli | 452 → 719 | +719 / −452 | 100% (100%) | 1 / 1 / 0 | 56–56% | 78% | 2.6× | 13 |
| library core | 1801 → 2513 | +1388 / −676 | 38% (38%) | 0 / 0 / 0 | 68–68% | 95% | 2.8× | 14 |
| integration | 697 → 808 | +258 / −147 | 21% (22%) | 0 / 0 / 0 | 24–24% | 27% | 0.7× | 9 |
| build/scripts | 509 → 681 | +428 / −256 | 50% (52%) | 5 / 0 / 2 | 56–56% | 74% | 2.3× | 21 |
| docs | 1014 → 1380 | +583 / −217 | 21% (22%) | 5 / 0 / 0 | 44–44% | 55% | 1.6× | 20 |

**v4.0.0 (2022-12-20) → v4.18.0 (2026-10-09)**, 447 commits

| area | lines start → end | direct diff +add / −rem | direct rem% (raw) | files A / D / R | chained est. replaced (edits only – all) | Σ per-release rem% | gross churn ÷ start | commits touching |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| ReBLUR | 6863 → 5808 | +5808 / −6863 | 100% (100%) | 27 / 87 / 0 | 72–85% | 173% | 3.5× | 164 |
| ReLAX | 6317 → 5682 | +5107 / −5742 | 91% (91%) | 27 / 52 / 3 | 65–80% | 138% | 2.8× | 90 |
| SIGMA | 1468 → 1788 | +1749 / −1429 | 97% (97%) | 16 / 23 / 1 | 64–73% | 121% | 2.9× | 49 |
| REFERENCE | 191 → 259 | +224 / −156 | 82% (82%) | 4 / 3 / 2 | 64–64% | 93% | 2.1× | 21 |
| SH variants | 2088 → 1889 | +1889 / −2088 | 100% (100%) | 6 / 51 / 0 | 62–81% | 139% | 4.7× | 18 |
| occlusion variants | 2303 → 896 | +896 / −2303 | 100% (100%) | 4 / 60 / 0 | 49–81% | 136% | 1.7× | 15 |
| specular MV utils | 536 → 0 | +0 / −536 | 100% (100%) | 0 / 6 / 0 | 38–100% | 143% | 2.1× | 10 |
| shared shader code | 986 → 1141 | +714 / −559 | 57% (57%) | 2 / 4 / 2 | 41–44% | 56% | 1.4× | 62 |
| API headers | 1053 → 1116 | +526 / −463 | 44% (45%) | 0 / 0 / 0 | 60–60% | 87% | 1.8× | 99 |
| NRD.hlsli | 719 → 1338 | +1338 / −719 | 100% (100%) | 1 / 1 / 0 | 56–56% | 78% | 3.1× | 69 |
| library core | 2513 → 1686 | +1420 / −2247 | 89% (91%) | 2 / 2 / 0 | 77–77% | 130% | 1.8× | 61 |
| integration | 808 → 1310 | +1025 / −523 | 65% (70%) | 0 / 0 / 0 | 76–76% | 120% | 3.6× | 50 |
| build/scripts | 681 → 1129 | +980 / −532 | 78% (78%) | 10 / 10 / 0 | 70–84% | 164% | 5.1× | 176 |
| docs | 1380 → 1993 | +1008 / −395 | 29% (29%) | 3 / 0 / 0 | 47–47% | 60% | 1.9× | 130 |

### Per-release matrix: rem% (removed lines ÷ area lines at the previous tag)

Blank = no change. `new` = area did not exist at the previous tag. Bold ≥ 25 %.

| release | date | commits | ReBLUR | ReLAX | SIGMA | REFERENCE | SH variants | occlusion variants | specular MV utils | shared shader code | API headers | NRD.hlsli | library core | integration | build/scripts | docs |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| v2.9.0 | 2021-11-05 | 2 | **79%** | **36%** | **40%** |  |  | new |  | 7% | **27%** | 15% | 21% | 17% | 7% | 23% |
| v2.10.0 | 2021-11-18 | 1 | 13% | <1% | 1% |  |  | 11% |  |  | 2% | 2% | <1% | 4% | <1% | <1% |
| v2.12.0 | 2022-02-08 | 1 | 14% | 13% | 4% | new |  | 10% |  | 13% | 7% | 16% | 9% | 1% | 5% | 4% |
| v2.12.1 | 2022-02-09 | 1 |  |  |  |  |  |  |  |  | <1% | <1% | <1% | <1% | 2% | <1% |
| v2.12.2 | 2022-02-11 | 1 | <1% |  |  |  |  | 3% |  |  | <1% |  | <1% |  | 8% | 6% |
| v3.0.0 | 2022-03-21 | 1 | **29%** | **71%** | 4% | 3% |  | **34%** | new | 13% | 15% | 13% | 3% | <1% | 7% | 8% |
| v3.1.0 | 2022-03-25 | 1 | 22% | 16% | 15% | 21% |  | 18% | 23% | **44%** | 3% | 7% | 8% | 2% | 6% | <1% |
| v3.2.3 | 2022-05-27 | 3 | **25%** | 14% | 6% |  |  | **43%** | 18% | 12% | 4% | 6% | 1% | 5% | 5% | 2% |
| v3.3.0 | 2022-06-15 | 1 | 4% | 3% |  |  |  | 3% |  | 3% | 2% |  | 2% |  | <1% | 2% |
| v3.3.1 | 2022-06-16 | 1 | <1% |  |  |  |  | <1% |  |  | <1% | <1% |  |  | <1% | <1% |
| v3.4.0 | 2022-08-15 | 1 | **27%** | 11% | 2% | <1% | new | **40%** | 8% | 14% | 6% | 14% | 8% | 1% | <1% | 3% |
| v3.4.1 | 2022-08-17 | 1 | <1% | <1% |  |  |  |  |  | <1% | <1% |  |  |  | <1% | 2% |
| v3.4.2 | 2022-08-18 | 1 | <1% |  | <1% |  |  | <1% |  | <1% | <1% |  |  |  | <1% | <1% |
| v3.4.3 | 2022-08-19 | 1 | 2% |  |  |  |  |  |  |  | <1% |  |  |  | <1% | <1% |
| v3.5.0 | 2022-08-30 | 1 | 9% | <1% | 1% |  | 3% | 6% | 1% | 4% | 3% | 7% | 1% |  | <1% | 4% |
| v3.6.0 | 2022-09-05 | 1 | 6% | <1% | 1% |  | <1% | <1% | <1% | 1% | 2% | 2% | <1% | <1% | 2% | <1% |
| v3.7.0 | 2022-09-21 | 1 | 5% | <1% | <1% | 2% | <1% | 6% | 2% | 1% | 2% | 8% | 8% | 4% | 1% | <1% |
| v3.8.0 | 2022-10-28 | 1 | 7% | 4% | <1% | 1% | 10% | 12% | 5% | 1% | 2% | 2% | 4% |  | <1% | 3% |
| v3.9.0 | 2022-11-11 | 1 | 3% | 2% | 2% | 1% | <1% | <1% | 5% | <1% | 2% | <1% | **48%** |  | <1% | <1% |
| v3.9.1 | 2022-11-17 | 1 | <1% | <1% |  |  |  |  | 2% |  | <1% |  |  |  | <1% | 3% |
| v3.9.2 | 2022-12-05 | 1 | <1% |  |  |  |  |  |  |  | <1% |  |  |  | <1% | <1% |
| v4.0.0 | 2022-12-20 | 1 | 9% | 5% | <1% |  | 1% | <1% | <1% | <1% | 6% | <1% | 3% | 12% | **35%** | 16% |
| v4.0.1 | 2022-12-21 | 1 | <1% | <1% | <1% | 1% | 2% | 2% | <1% | <1% | <1% | <1% | <1% |  | <1% | <1% |
| v4.0.2 | 2023-01-16 | 1 | 1% | <1% |  |  | <1% | <1% | 2% | 7% | <1% |  | <1% |  | <1% | 2% |
| v4.1.0 | 2023-03-21 | 3 | 11% | 6% | 13% | 3% | 14% | 20% | 1% | <1% | <1% | 23% | **32%** | <1% | **31%** | <1% |
| v4.1.1 | 2023-03-30 | 1 |  | <1% |  |  |  |  |  |  | <1% | <1% | <1% |  | <1% | <1% |
| v4.1.2 | 2023-04-05 | 1 |  | <1% |  |  |  |  |  | <1% | <1% |  |  |  | <1% | <1% |
| v4.2.0 | 2023-05-23 | 2 | 5% | 8% | 7% | 6% | 8% | 3% | 3% | <1% | 2% | <1% | **28%** | 11% | 1% | 5% |
| v4.2.1 | 2023-05-30 | 1 | <1% |  |  | 2% |  |  |  | 2% | <1% |  | <1% |  | <1% | <1% |
| v4.2.2 | 2023-07-04 | 3 | 2% | <1% | 1% |  |  |  |  |  | <1% | <1% | 2% |  | 7% | <1% |
| v4.3.0 | 2023-09-22 | 1 | 7% | 4% | <1% | <1% | 3% | 1% | 12% | 3% | 7% | 4% | <1% |  | <1% | 3% |
| v4.3.1 | 2023-09-28 | 9 | <1% | <1% |  |  |  |  |  |  | <1% |  |  |  | <1% | <1% |
| v4.3.2 | 2023-10-10 | 2 | 1% | <1% | <1% |  |  |  | <1% | 5% | <1% |  |  |  | <1% | <1% |
| v4.3.3 | 2023-10-18 | 1 | <1% |  |  |  |  |  |  |  | <1% |  |  |  | <1% | <1% |
| v4.3.4 | 2023-10-24 | 1 | 1% | <1% |  |  |  |  | <1% | <1% | <1% | <1% |  |  | <1% | <1% |
| v4.3.5 | 2023-10-26 | 1 |  |  |  |  |  |  |  |  | <1% |  | <1% | 8% | 3% | <1% |
| v4.3.6 | 2023-11-03 | 1 | <1% |  |  |  |  |  |  |  | <1% |  |  |  | <1% | <1% |
| v4.4.0 | 2023-12-27 | 1 | **28%** | **40%** | **28%** | **29%** | **38%** | 19% | 23% | 6% | 24% | 8% | 13% | 9% | 2% | 1% |
| v4.4.1 | 2023-12-27 | 1 | <1% | <1% |  |  | <1% |  |  |  | <1% |  |  |  | <1% | <1% |
| v4.4.2 | 2023-12-27 | 2 |  |  |  |  |  |  |  |  | <1% | <1% |  |  | <1% | <1% |
| v4.4.3 | 2024-01-02 | 1 |  | <1% |  |  |  |  |  |  | <1% |  |  |  | <1% | <1% |
| v4.5.0 | 2024-02-20 | 3 | <1% | <1% | <1% |  |  |  |  | <1% | <1% |  | <1% | 2% | <1% | <1% |
| v4.6.0 | 2024-03-20 | 1 | <1% |  | <1% |  |  |  |  | <1% | <1% | <1% |  | 1% | <1% | <1% |
| v4.6.1 | 2024-03-25 | 1 | <1% | <1% |  |  |  |  | <1% | 2% | <1% |  |  |  | <1% | <1% |
| v4.7.0 | 2024-04-15 | 1 | <1% |  | 6% |  |  |  |  | <1% | <1% | 1% | <1% | 1% | <1% | <1% |
| v4.8.0 | 2024-05-09 | 1 | <1% | <1% | 6% | 17% |  |  | **100%** | <1% | 8% | 6% | 2% |  | <1% | 1% |
| v4.8.1 | 2024-05-16 | 1 | <1% |  |  |  |  |  |  |  | <1% |  |  |  | <1% | <1% |
| v4.8.2 | 2024-06-14 | 2 | <1% | <1% | 4% |  |  |  |  | <1% | <1% | 2% |  |  | <1% | <1% |
| v4.9.0 | 2024-08-01 | 2 | 7% | 4% | 2% | 1% | 2% | 3% |  | 2% | 6% | 1% | 2% | <1% | 1% | 3% |
| v4.9.0fix | 2024-08-05 | 9 |  |  |  |  |  |  |  |  |  |  | <1% |  | 4% |  |
| v4.9.1 | 2024-08-14 | 1 |  |  |  | 9% |  |  |  |  | <1% |  | 1% | <1% | <1% | <1% |
| v4.9.2 | 2024-08-23 | 1 | <1% |  |  |  |  |  |  |  | <1% |  | <1% |  | <1% | <1% |
| v4.9.3 | 2024-09-06 | 1 | <1% |  |  |  |  |  |  |  | <1% |  |  | <1% | <1% | <1% |
| v4.9.4 | 2024-09-20 | 1 |  |  |  |  |  |  |  |  | <1% |  |  | <1% | <1% | <1% |
| v4.10.0 | 2024-10-09 | 2 | 1% | <1% | 2% |  |  |  |  | 1% | <1% |  | <1% | 16% | <1% | <1% |
| v4.11.0 | 2024-11-05 | 1 | 4% | 11% | 11% | 1% |  |  |  | 3% | 6% | <1% | <1% | <1% | <1% | 1% |
| v4.11.1 | 2024-11-11 | 1 | <1% | <1% |  |  |  |  |  | <1% | <1% |  |  |  | <1% | <1% |
| v4.11.2 | 2024-11-14 | 2 | <1% |  |  |  |  |  |  |  | <1% |  | <1% | 1% | <1% | <1% |
| v4.11.3 | 2025-01-03 | 1 | <1% | <1% | <1% | <1% |  |  |  | <1% | <1% | <1% | <1% | 1% | <1% | <1% |
| v4.11.4 | 2025-01-21 | 2 | <1% | <1% |  |  | <1% |  |  | <1% | <1% | <1% | 2% | <1% | <1% | <1% |
| v4.11.4-fixed | 2025-02-03 | 1 |  |  |  |  |  |  |  | <1% |  |  |  |  |  |  |
| v4.12.0 | 2025-02-06 | 3 | <1% | <1% |  |  |  |  |  |  | 1% | <1% | <1% |  | 9% | <1% |
| v4.14.0 | 2025-03-03 | 16 | 8% | <1% | <1% |  | 5% | 2% |  | <1% | 3% | <1% | <1% |  | 2% | 2% |
| v4.14.0-fixed | 2025-03-04 | 1 | <1% |  |  |  |  |  |  |  |  |  |  |  |  |  |
| v4.14.1 | 2025-03-07 | 1 | <1% |  |  |  |  | <1% |  | <1% | <1% |  |  | <1% | <1% | <1% |
| v4.14.2 | 2025-03-19 | 10 |  | <1% |  |  |  |  |  |  | <1% |  | <1% |  | <1% | <1% |
| v4.14.3 | 2025-03-20 | 1 |  |  |  |  |  |  |  |  | <1% |  |  |  | <1% | <1% |
| v4.15.0 | 2025-06-02 | 37 | 5% | 3% | 3% | 8% | 5% | 4% |  | <1% | 2% | <1% | 19% | **50%** | **28%** | 9% |
| v4.15.1 | 2025-08-19 | 23 | 13% | <1% | <1% | 1% | 15% | **33%** |  | <1% | 3% |  | <1% | 5% | 19% | <1% |
| v4.15.1-fixed | 2025-08-20 | 1 |  |  |  |  |  |  |  |  |  |  |  |  | <1% |  |
| v4.16.0 | 2025-10-22 | 50 | **33%** | **34%** | 21% | 5% | **43%** | **47%** |  | 7% | 5% | 2% | 19% | 9% | 17% | <1% |
| v4.16.1 | 2025-11-10 | 13 | <1% | <1% |  |  |  |  |  | <1% | 1% | 2% | <1% |  | <1% | <1% |
| v4.17.0 | 2026-02-05 | 56 | 3% | 1% | 1% |  |  |  |  | 4% | 2% | 12% | <1% | <1% | 6% | 19% |
| v4.17.1 | 2026-02-25 | 18 | 3% | <1% | 1% | 3% |  |  |  | <1% | <1% | 7% | <1% | <1% | <1% | 1% |
| v4.17.2 | 2026-03-20 | 26 | 15% | <1% |  |  | <1% | <1% |  | 2% | 2% | <1% | <1% |  | <1% | <1% |
| v4.17.3 | 2026-04-30 | 27 | 3% | 3% | <1% | 2% |  |  |  | <1% | <1% | 2% | <1% | <1% | <1% | <1% |
| v4.18.0 | 2026-10-09 | 95 | 15% | 16% | 10% | 3% | <1% | 1% |  | 5% | 4% | 6% | 3% | <1% | 21% | 2% |

### Per-area detail (releases with rem% ≥ 10 % or any file added / deleted / renamed)

#### ReBLUR

| release | date | lines at start | +add / −rem | −rem in edited / deleted files | rem% | churn ratio (add+rem)/start | files A / D / R | commits |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| v2.9.0 | 2021-11-05 | 5952 | +4101 / −4714 | 3040 / 1674 | 79% | 1.48 | 26 / 24 / 3 | 1 |
| v2.10.0 | 2021-11-18 | 5315 | +592 / −704 | 704 / 0 | 13% | 0.24 | 0 / 0 / 0 | 1 |
| v2.12.0 | 2022-02-08 | 5203 | +694 / −704 | 704 / 0 | 14% | 0.27 | 0 / 0 / 0 | 1 |
| v3.0.0 | 2022-03-21 | 5187 | +1516 / −1495 | 1237 / 258 | 29% | 0.58 | 31 / 3 / 42 | 1 |
| v3.1.0 | 2022-03-25 | 5143 | +1650 / −1124 | 619 / 505 | 22% | 0.54 | 18 / 15 / 62 | 1 |
| v3.2.3 | 2022-05-27 | 5669 | +1695 / −1441 | 1441 / 0 | 25% | 0.55 | 7 / 0 / 1 | 1 |
| v3.3.0 | 2022-06-15 | 5990 | +394 / −260 | 260 / 0 | 4% | 0.11 | 6 / 0 / 6 | 1 |
| v3.4.0 | 2022-08-15 | 6124 | +2882 / −1644 | 1387 / 257 | 27% | 0.74 | 20 / 3 / 9 | 1 |
| v3.5.0 | 2022-08-30 | 7087 | +556 / −666 | 644 / 22 | 9% | 0.17 | 0 / 1 / 0 | 1 |
| v3.7.0 | 2022-09-21 | 6921 | +137 / −370 | 233 / 137 | 5% | 0.07 | 0 / 6 / 0 | 1 |
| v3.8.0 | 2022-10-28 | 6688 | +327 / −479 | 342 / 137 | 7% | 0.12 | 0 / 6 / 0 | 1 |
| v3.9.0 | 2022-11-11 | 6536 | +570 / −225 | 225 / 0 | 3% | 0.12 | 2 / 0 / 0 | 1 |
| v4.1.0 | 2023-03-21 | 6886 | +1475 / −779 | 779 / 0 | 11% | 0.33 | 1 / 0 / 0 | 1 |
| v4.2.0 | 2023-05-23 | 7582 | +622 / −362 | 362 / 0 | 5% | 0.13 | 2 / 0 / 3 | 1 |
| v4.4.0 | 2023-12-27 | 8069 | +2127 / −2268 | 1372 / 896 | 28% | 0.54 | 9 / 9 / 16 | 1 |
| v4.14.0 | 2025-03-03 | 8105 | +382 / −651 | 475 / 176 | 8% | 0.13 | 0 / 5 / 0 | 8 |
| v4.15.1 | 2025-08-19 | 7759 | +119 / −991 | 382 / 609 | 13% | 0.14 | 0 / 27 / 0 | 4 |
| v4.16.0 | 2025-10-22 | 6887 | +1241 / −2246 | 756 / 1490 | 33% | 0.51 | 8 / 38 / 12 | 22 |
| v4.17.1 | 2026-02-25 | 5931 | +257 / −182 | 182 / 0 | 3% | 0.07 | 0 / 0 / 4 | 4 |
| v4.17.2 | 2026-03-20 | 6006 | +620 / −894 | 424 / 470 | 15% | 0.25 | 1 / 2 / 0 | 21 |
| v4.18.0 | 2026-10-09 | 5724 | +919 / −835 | 835 / 0 | 15% | 0.31 | 0 / 0 / 0 | 33 |

#### ReLAX

| release | date | lines at start | +add / −rem | −rem in edited / deleted files | rem% | churn ratio (add+rem)/start | files A / D / R | commits |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| v2.9.0 | 2021-11-05 | 6327 | +5855 / −2254 | 1873 / 381 | 36% | 1.28 | 22 / 2 / 19 | 1 |
| v2.12.0 | 2022-02-08 | 9956 | +1114 / −1306 | 1306 / 0 | 13% | 0.24 | 0 / 0 / 0 | 1 |
| v3.0.0 | 2022-03-21 | 9764 | +2614 / −6924 | 758 / 6166 | 71% | 0.98 | 34 / 49 / 6 | 1 |
| v3.1.0 | 2022-03-25 | 5519 | +1034 / −909 | 296 / 613 | 16% | 0.35 | 16 / 15 / 26 | 1 |
| v3.2.3 | 2022-05-27 | 5633 | +742 / −798 | 798 / 0 | 14% | 0.27 | 4 / 0 / 0 | 1 |
| v3.3.0 | 2022-06-15 | 5577 | +359 / −156 | 156 / 0 | 3% | 0.09 | 4 / 0 / 2 | 1 |
| v3.4.0 | 2022-08-15 | 5780 | +704 / −614 | 614 / 0 | 11% | 0.23 | 0 / 0 / 3 | 1 |
| v3.9.0 | 2022-11-11 | 6049 | +387 / −121 | 121 / 0 | 2% | 0.08 | 2 / 0 / 0 | 1 |
| v4.1.0 | 2023-03-21 | 6316 | +985 / −387 | 387 / 0 | 6% | 0.22 | 1 / 0 / 0 | 1 |
| v4.2.0 | 2023-05-23 | 6915 | +727 / −539 | 539 / 0 | 8% | 0.18 | 2 / 0 / 3 | 1 |
| v4.3.0 | 2023-09-22 | 7144 | +526 / −280 | 280 / 0 | 4% | 0.11 | 5 / 0 / 0 | 1 |
| v4.4.0 | 2023-12-27 | 7421 | +2099 / −3000 | 1846 / 1154 | 40% | 0.69 | 11 / 11 / 11 | 1 |
| v4.11.0 | 2024-11-05 | 6548 | +718 / −709 | 709 / 0 | 11% | 0.22 | 0 / 0 / 0 | 1 |
| v4.16.0 | 2025-10-22 | 6579 | +1284 / −2246 | 615 / 1631 | 34% | 0.54 | 10 / 43 / 14 | 11 |
| v4.17.1 | 2026-02-25 | 5623 | +66 / −37 | 37 / 0 | 1% | 0.02 | 0 / 0 / 2 | 2 |
| v4.18.0 | 2026-10-09 | 5652 | +922 / −892 | 892 / 0 | 16% | 0.32 | 0 / 0 / 0 | 21 |

#### SIGMA

| release | date | lines at start | +add / −rem | −rem in edited / deleted files | rem% | churn ratio (add+rem)/start | files A / D / R | commits |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| v2.9.0 | 2021-11-05 | 1483 | +665 / −592 | 592 / 0 | 40% | 0.85 | 4 / 0 / 8 | 1 |
| v3.0.0 | 2022-03-21 | 1505 | +58 / −56 | 56 / 0 | 4% | 0.08 | 0 / 0 / 21 | 1 |
| v3.1.0 | 2022-03-25 | 1507 | +222 / −229 | 172 / 57 | 15% | 0.30 | 3 / 5 / 19 | 1 |
| v3.6.0 | 2022-09-05 | 1454 | +16 / −16 | 16 / 0 | 1% | 0.02 | 0 / 0 / 2 | 1 |
| v4.1.0 | 2023-03-21 | 1468 | +250 / −189 | 189 / 0 | 13% | 0.30 | 1 / 0 / 0 | 1 |
| v4.2.0 | 2023-05-23 | 1529 | +125 / −111 | 111 / 0 | 7% | 0.15 | 0 / 0 / 2 | 1 |
| v4.4.0 | 2023-12-27 | 1554 | +432 / −429 | 250 / 179 | 28% | 0.55 | 5 / 5 / 6 | 1 |
| v4.11.0 | 2024-11-05 | 1618 | +446 / −179 | 179 / 0 | 11% | 0.39 | 4 / 0 / 1 | 1 |
| v4.16.0 | 2025-10-22 | 1887 | +183 / −399 | 159 / 240 | 21% | 0.31 | 0 / 12 / 12 | 6 |
| v4.17.1 | 2026-02-25 | 1671 | +37 / −19 | 19 / 0 | 1% | 0.03 | 0 / 0 / 2 | 2 |
| v4.18.0 | 2026-10-09 | 1688 | +276 / −176 | 176 / 0 | 10% | 0.27 | 0 / 0 / 0 | 18 |

#### REFERENCE

| release | date | lines at start | +add / −rem | −rem in edited / deleted files | rem% | churn ratio (add+rem)/start | files A / D / R | commits |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| v2.12.0 | 2022-02-08 | 0 | +186 / −0 | 0 / 0 | – | – | 5 / 0 / 0 | 1 |
| v3.0.0 | 2022-03-21 | 186 | +6 / −6 | 6 / 0 | 3% | 0.06 | 0 / 0 / 4 | 1 |
| v3.1.0 | 2022-03-25 | 186 | +34 / −39 | 39 / 0 | 21% | 0.39 | 0 / 0 / 4 | 1 |
| v4.2.0 | 2023-05-23 | 191 | +12 / −12 | 12 / 0 | 6% | 0.13 | 0 / 0 / 1 | 1 |
| v4.4.0 | 2023-12-27 | 191 | +60 / −56 | 56 / 0 | 29% | 0.61 | 0 / 0 / 0 | 1 |
| v4.8.0 | 2024-05-09 | 195 | +3 / −33 | 33 / 0 | 17% | 0.18 | 0 / 0 / 1 | 1 |
| v4.9.1 | 2024-08-14 | 226 | +23 / −21 | 21 / 0 | 9% | 0.19 | 0 / 0 / 2 | 1 |
| v4.16.0 | 2025-10-22 | 234 | +12 / −11 | 11 / 0 | 5% | 0.10 | 0 / 0 / 4 | 3 |

#### SH variants

| release | date | lines at start | +add / −rem | −rem in edited / deleted files | rem% | churn ratio (add+rem)/start | files A / D / R | commits |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| v3.4.0 | 2022-08-15 | 0 | +1932 / −30 | 30 / 0 | new | – | 42 / 0 / 18 | 1 |
| v3.5.0 | 2022-08-30 | 2301 | +45 / −68 | 45 / 23 | 3% | 0.05 | 0 / 1 / 0 | 1 |
| v3.8.0 | 2022-10-28 | 2243 | +68 / −227 | 84 / 143 | 10% | 0.13 | 0 / 6 / 0 | 1 |
| v4.1.0 | 2023-03-21 | 2094 | +2715 / −285 | 285 / 0 | 14% | 1.43 | 28 / 0 / 0 | 1 |
| v4.2.0 | 2023-05-23 | 4524 | +518 / −378 | 378 / 0 | 8% | 0.20 | 0 / 0 / 6 | 1 |
| v4.3.0 | 2023-09-22 | 4664 | +181 / −138 | 138 / 0 | 3% | 0.07 | 3 / 0 / 0 | 1 |
| v4.4.0 | 2023-12-27 | 4707 | +795 / −1803 | 1803 / 0 | 38% | 0.55 | 0 / 0 / 3 | 1 |
| v4.14.0 | 2025-03-03 | 3716 | +62 / −183 | 119 / 64 | 5% | 0.07 | 0 / 3 / 0 | 1 |
| v4.15.1 | 2025-08-19 | 3511 | +12 / −538 | 45 / 493 | 15% | 0.16 | 0 / 21 / 0 | 1 |
| v4.16.0 | 2025-10-22 | 2985 | +209 / −1293 | 154 / 1139 | 43% | 0.50 | 0 / 52 / 0 | 3 |

#### occlusion variants

| release | date | lines at start | +add / −rem | −rem in edited / deleted files | rem% | churn ratio (add+rem)/start | files A / D / R | commits |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| v2.9.0 | 2021-11-05 | 0 | +2510 / −7 | 7 / 0 | new | – | 30 / 0 / 3 | 1 |
| v2.10.0 | 2021-11-18 | 2542 | +135 / −283 | 283 / 0 | 11% | 0.16 | 0 / 0 / 0 | 1 |
| v2.12.0 | 2022-02-08 | 2394 | +688 / −238 | 238 / 0 | 10% | 0.39 | 1 / 0 / 0 | 1 |
| v3.0.0 | 2022-03-21 | 2782 | +853 / −946 | 791 / 155 | 34% | 0.65 | 17 / 2 / 26 | 1 |
| v3.1.0 | 2022-03-25 | 2689 | +1123 / −472 | 351 / 121 | 18% | 0.59 | 18 / 7 / 38 | 1 |
| v3.2.3 | 2022-05-27 | 3340 | +696 / −1438 | 576 / 862 | 43% | 0.64 | 6 / 11 / 0 | 1 |
| v3.3.0 | 2022-06-15 | 2531 | +239 / −66 | 66 / 0 | 3% | 0.12 | 6 / 0 / 6 | 1 |
| v3.4.0 | 2022-08-15 | 2704 | +816 / −1076 | 297 / 779 | 40% | 0.70 | 18 / 10 / 12 | 1 |
| v3.5.0 | 2022-08-30 | 2374 | +274 / −149 | 104 / 45 | 6% | 0.18 | 8 / 2 / 8 | 1 |
| v3.7.0 | 2022-09-21 | 2591 | +28 / −155 | 12 / 143 | 6% | 0.07 | 0 / 6 / 0 | 1 |
| v3.8.0 | 2022-10-28 | 2464 | +80 / −289 | 99 / 190 | 12% | 0.15 | 0 / 8 / 0 | 1 |
| v4.1.0 | 2023-03-21 | 2303 | +336 / −466 | 466 / 0 | 20% | 0.35 | 0 / 0 / 0 | 1 |
| v4.2.0 | 2023-05-23 | 2173 | +166 / −68 | 68 / 0 | 3% | 0.11 | 0 / 0 / 4 | 1 |
| v4.4.0 | 2023-12-27 | 2288 | +338 / −426 | 426 / 0 | 19% | 0.33 | 0 / 0 / 0 | 1 |
| v4.15.1 | 2025-08-19 | 2153 | +10 / −700 | 42 / 658 | 33% | 0.33 | 0 / 28 / 0 | 1 |
| v4.16.0 | 2025-10-22 | 1463 | +126 / −691 | 61 / 630 | 47% | 0.56 | 0 / 28 / 0 | 2 |

#### specular MV utils

| release | date | lines at start | +add / −rem | −rem in edited / deleted files | rem% | churn ratio (add+rem)/start | files A / D / R | commits |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| v3.0.0 | 2022-03-21 | 0 | +502 / −0 | 0 / 0 | – | – | 6 / 0 / 0 | 1 |
| v3.1.0 | 2022-03-25 | 502 | +116 / −117 | 50 / 67 | 23% | 0.46 | 2 / 2 / 3 | 1 |
| v3.2.3 | 2022-05-27 | 501 | +12 / −91 | 91 / 0 | 18% | 0.21 | 0 / 0 / 0 | 1 |
| v4.2.0 | 2023-05-23 | 551 | +18 / −18 | 18 / 0 | 3% | 0.07 | 0 / 0 / 2 | 1 |
| v4.3.0 | 2023-09-22 | 551 | +41 / −65 | 65 / 0 | 12% | 0.19 | 0 / 0 / 0 | 1 |
| v4.4.0 | 2023-12-27 | 566 | +137 / −128 | 128 / 0 | 23% | 0.47 | 0 / 0 / 0 | 1 |
| v4.8.0 | 2024-05-09 | 579 | +0 / −579 | 0 / 579 | 100% | 1.00 | 0 / 6 / 0 | 1 |

#### shared shader code

| release | date | lines at start | +add / −rem | −rem in edited / deleted files | rem% | churn ratio (add+rem)/start | files A / D / R | commits |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| v2.9.0 | 2021-11-05 | 1121 | +575 / −78 | 78 / 0 | 7% | 0.58 | 7 / 0 / 5 | 1 |
| v2.12.0 | 2022-02-08 | 1641 | +136 / −210 | 210 / 0 | 13% | 0.21 | 0 / 0 / 0 | 1 |
| v3.0.0 | 2022-03-21 | 1567 | +124 / −211 | 211 / 0 | 13% | 0.21 | 0 / 0 / 12 | 1 |
| v3.1.0 | 2022-03-25 | 1480 | +14 / −650 | 21 / 629 | 44% | 0.45 | 0 / 8 / 6 | 1 |
| v3.2.3 | 2022-05-27 | 844 | +306 / −101 | 101 / 0 | 12% | 0.48 | 0 / 0 / 0 | 1 |
| v3.4.0 | 2022-08-15 | 1068 | +60 / −153 | 153 / 0 | 14% | 0.20 | 0 / 0 / 0 | 1 |
| v4.4.0 | 2023-12-27 | 989 | +97 / −64 | 64 / 0 | 6% | 0.16 | 0 / 0 / 4 | 1 |
| v4.16.0 | 2025-10-22 | 1197 | +19 / −80 | 28 / 52 | 7% | 0.08 | 0 / 2 / 2 | 4 |
| v4.17.1 | 2026-02-25 | 1111 | +5 / −7 | 7 / 0 | 1% | 0.01 | 0 / 0 / 2 | 2 |

#### API headers

| release | date | lines at start | +add / −rem | −rem in edited / deleted files | rem% | churn ratio (add+rem)/start | files A / D / R | commits |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| v2.9.0 | 2021-11-05 | 647 | +436 / −176 | 176 / 0 | 27% | 0.95 | 0 / 0 / 0 | 1 |
| v3.0.0 | 2022-03-21 | 938 | +173 / −140 | 140 / 0 | 15% | 0.33 | 0 / 0 / 0 | 1 |
| v4.4.0 | 2023-12-27 | 1101 | +175 / −259 | 259 / 0 | 24% | 0.39 | 0 / 0 / 0 | 1 |

#### NRD.hlsli

| release | date | lines at start | +add / −rem | −rem in edited / deleted files | rem% | churn ratio (add+rem)/start | files A / D / R | commits |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| v2.9.0 | 2021-11-05 | 378 | +122 / −57 | 57 / 0 | 15% | 0.47 | 0 / 0 / 1 | 1 |
| v2.12.0 | 2022-02-08 | 452 | +163 / −73 | 73 / 0 | 16% | 0.52 | 0 / 0 / 0 | 1 |
| v3.0.0 | 2022-03-21 | 554 | +105 / −72 | 72 / 0 | 13% | 0.32 | 0 / 0 / 0 | 1 |
| v3.1.0 | 2022-03-25 | 587 | +44 / −41 | 41 / 0 | 7% | 0.14 | 0 / 0 / 1 | 1 |
| v3.4.0 | 2022-08-15 | 579 | +195 / −82 | 82 / 0 | 14% | 0.48 | 0 / 0 / 0 | 1 |
| v4.1.0 | 2023-03-21 | 719 | +490 / −163 | 163 / 0 | 23% | 0.91 | 0 / 0 / 0 | 1 |
| v4.17.0 | 2026-02-05 | 1208 | +134 / −145 | 145 / 0 | 12% | 0.23 | 0 / 0 / 0 | 7 |
| v4.17.1 | 2026-02-25 | 1197 | +75 / −78 | 78 / 0 | 7% | 0.13 | 0 / 0 / 1 | 2 |

#### library core

| release | date | lines at start | +add / −rem | −rem in edited / deleted files | rem% | churn ratio (add+rem)/start | files A / D / R | commits |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| v2.9.0 | 2021-11-05 | 1487 | +608 / −307 | 307 / 0 | 21% | 0.62 | 0 / 0 / 0 | 1 |
| v3.9.0 | 2022-11-11 | 2463 | +1212 / −1174 | 1174 / 0 | 48% | 0.97 | 0 / 0 / 0 | 1 |
| v4.1.0 | 2023-03-21 | 2516 | +122 / −814 | 814 / 0 | 32% | 0.37 | 1 / 0 / 0 | 1 |
| v4.2.0 | 2023-05-23 | 1828 | +580 / −506 | 506 / 0 | 28% | 0.59 | 0 / 0 / 2 | 1 |
| v4.4.0 | 2023-12-27 | 1927 | +247 / −257 | 257 / 0 | 13% | 0.26 | 0 / 0 / 0 | 1 |
| v4.15.0 | 2025-06-02 | 1875 | +270 / −359 | 359 / 0 | 19% | 0.34 | 0 / 0 / 0 | 4 |
| v4.16.0 | 2025-10-22 | 1812 | +201 / −348 | 348 / 0 | 19% | 0.30 | 0 / 0 / 0 | 12 |

#### integration

| release | date | lines at start | +add / −rem | −rem in edited / deleted files | rem% | churn ratio (add+rem)/start | files A / D / R | commits |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| v2.9.0 | 2021-11-05 | 634 | +161 / −105 | 105 / 0 | 17% | 0.42 | 0 / 0 / 0 | 1 |
| v4.0.0 | 2022-12-20 | 739 | +157 / −88 | 88 / 0 | 12% | 0.33 | 0 / 0 / 0 | 1 |
| v4.2.0 | 2023-05-23 | 808 | +95 / −87 | 87 / 0 | 11% | 0.23 | 0 / 0 / 0 | 1 |
| v4.10.0 | 2024-10-09 | 842 | +209 / −134 | 134 / 0 | 16% | 0.41 | 0 / 0 / 0 | 1 |
| v4.15.0 | 2025-06-02 | 1039 | +854 / −523 | 523 / 0 | 50% | 1.33 | 0 / 0 / 0 | 8 |

#### build/scripts

| release | date | lines at start | +add / −rem | −rem in edited / deleted files | rem% | churn ratio (add+rem)/start | files A / D / R | commits |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| v2.12.0 | 2022-02-08 | 509 | +55 / −25 | 25 / 0 | 5% | 0.16 | 0 / 0 / 2 | 1 |
| v2.12.2 | 2022-02-11 | 540 | +88 / −45 | 45 / 0 | 8% | 0.25 | 4 / 0 / 0 | 1 |
| v3.2.3 | 2022-05-27 | 571 | +175 / −28 | 28 / 0 | 5% | 0.36 | 1 / 0 / 0 | 2 |
| v4.0.0 | 2022-12-20 | 762 | +183 / −264 | 264 / 0 | 35% | 0.59 | 0 / 0 / 0 | 1 |
| v4.1.0 | 2023-03-21 | 681 | +401 / −213 | 64 / 149 | 31% | 0.90 | 1 / 1 / 0 | 2 |
| v4.12.0 | 2025-02-06 | 883 | +100 / −81 | 71 / 10 | 9% | 0.20 | 0 / 1 / 0 | 3 |
| v4.14.0 | 2025-03-03 | 902 | +11 / −16 | 16 / 0 | 2% | 0.03 | 0 / 0 / 1 | 6 |
| v4.15.0 | 2025-06-02 | 897 | +468 / −253 | 124 / 129 | 28% | 0.80 | 3 / 2 / 0 | 21 |
| v4.15.1 | 2025-08-19 | 1112 | +220 / −208 | 208 / 0 | 19% | 0.38 | 0 / 0 / 0 | 18 |
| v4.16.0 | 2025-10-22 | 1124 | +88 / −193 | 193 / 0 | 17% | 0.25 | 0 / 0 / 0 | 14 |
| v4.18.0 | 2026-10-09 | 1035 | +315 / −221 | 94 / 127 | 21% | 0.52 | 8 / 8 / 0 | 22 |

#### docs

| release | date | lines at start | +add / −rem | −rem in edited / deleted files | rem% | churn ratio (add+rem)/start | files A / D / R | commits |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| v2.9.0 | 2021-11-05 | 766 | +409 / −173 | 173 / 0 | 23% | 0.76 | 1 / 0 / 0 | 1 |
| v3.0.0 | 2022-03-21 | 1036 | +93 / −79 | 79 / 0 | 8% | 0.17 | 1 / 0 / 0 | 1 |
| v3.9.1 | 2022-11-17 | 1281 | +51 / −41 | 41 / 0 | 3% | 0.07 | 2 / 0 / 0 | 1 |
| v4.0.0 | 2022-12-20 | 1291 | +298 / −209 | 209 / 0 | 16% | 0.39 | 2 / 0 / 0 | 1 |
| v4.1.0 | 2023-03-21 | 1380 | +86 / −3 | 3 / 0 | 0% | 0.06 | 1 / 0 / 0 | 1 |
| v4.17.0 | 2026-02-05 | 1762 | +446 / −343 | 343 / 0 | 19% | 0.45 | 1 / 0 / 0 | 19 |
| v4.18.0 | 2026-10-09 | 1910 | +115 / −32 | 32 / 0 | 2% | 0.08 | 1 / 0 / 0 | 17 |

### Top releases per area (by rem%)

| area | top 5 releases by rem% |
|---|---|
| ReBLUR | v2.9.0 79%, v4.16.0 33%, v3.0.0 29%, v4.4.0 28%, v3.4.0 27% |
| ReLAX | v3.0.0 71%, v4.4.0 40%, v2.9.0 36%, v4.16.0 34%, v3.1.0 16% |
| SIGMA | v2.9.0 40%, v4.4.0 28%, v4.16.0 21%, v3.1.0 15%, v4.1.0 13% |
| REFERENCE | v4.4.0 29%, v3.1.0 21%, v4.8.0 17%, v4.9.1 9%, v4.15.0 8% |
| SH variants | v4.16.0 43%, v4.4.0 38%, v4.15.1 15%, v4.1.0 14%, v3.8.0 10% |
| occlusion variants | v4.16.0 47%, v3.2.3 43%, v3.4.0 40%, v3.0.0 34%, v4.15.1 33% |
| specular MV utils | v4.8.0 100%, v3.1.0 23%, v4.4.0 23%, v3.2.3 18%, v4.3.0 12% |
| shared shader code | v3.1.0 44%, v3.4.0 14%, v3.0.0 13%, v2.12.0 13%, v3.2.3 12% |
| API headers | v2.9.0 27%, v4.4.0 24%, v3.0.0 15%, v4.8.0 8%, v2.12.0 7% |
| NRD.hlsli | v4.1.0 23%, v2.12.0 16%, v2.9.0 15%, v3.4.0 14%, v3.0.0 13% |
| library core | v3.9.0 48%, v4.1.0 32%, v4.2.0 28%, v2.9.0 21%, v4.16.0 19% |
| integration | v4.15.0 50%, v2.9.0 17%, v4.10.0 16%, v4.0.0 12%, v4.2.0 11% |
| build/scripts | v4.0.0 35%, v4.1.0 31%, v4.15.0 28%, v4.18.0 21%, v4.15.1 19% |
| docs | v2.9.0 23%, v4.17.0 19%, v4.0.0 16%, v4.15.0 9%, v3.0.0 8% |

### 2021 history before the first tag (untagged commits, NRD library under `NRD/` then)

Paths outside `NRD/` and `External/` (the NRI library, samples, test scenes, project files) are left out. `-w` counts.

| from → to | ReBLUR | ReLAX | SIGMA | shared shader code | API headers | NRD.hlsli | library core | integration |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 936607c (2020-12-16) → 6263dce (2021-02-03) | new (+1751/−1017) | 13% (+545/−409) | new (+59/−65) | 9% (+16/−565) | 13% (+121/−79) | 22% (+109/−53) | 10% (+255/−223) | 2% (+34/−12) |
| 6263dce (2021-02-03) → 53f4ad4 (2021-04-13) | 38% (+2448/−2136) | 31% (+898/−1040) | 46% (+465/−380) | 50% (+336/−647) | 15% (+71/−93) | 25% (+104/−73) | 32% (+172/−413) | 1% (+9/−9) |
| 53f4ad4 (2021-04-13) → 837df2f (2021-04-19) | 12% (+376/−727) | 1% (+21/−23) | 0% (+1/−1) | 0% (+1/−1) | 0% (+3/−2) | 0% (+1/−1) | 0% (+5/−4) | 1% (+1/−4) |
| 837df2f (2021-04-19) → f9ff996 (2021-05-04) | 15% (+758/−822) | 4% (+114/−132) | 0% (+2/−4) | 31% (+45/−308) | 3% (+22/−16) | 27% (+20/−88) | 1% (+4/−11) |  |
| f9ff996 (2021-05-04) → 22ce09f (2021-05-07) | 1% (+74/−48) | 1% (+18/−35) |  | 0% (+3/−3) | 6% (+33/−36) | 1% (+15/−3) | 0% (+1/−1) |  |
| 22ce09f (2021-05-07) → 93ea3f5 (2021-05-20) | 6% (+354/−339) | 2% (+70/−53) | 4% (+79/−37) | 5% (+364/−34) | 3% (+16/−16) | 13% (+41/−35) | 10% (+130/−105) |  |
| 93ea3f5 (2021-05-20) → v2.5.0 (2021-07-19) | 18% (+1399/−1017) | 12% (+3500/−370) | 22% (+683/−208) | 45% (+541/−475) | 4% (+50/−22) | 0% (+104/−1) | 18% (+257/−193) | 1% (+13/−7) |
| 53f4ad4 (2021-04-13) → v2.5.0 (2021-07-19) | 52% (+3076/−3068) | 17% (+3645/−535) | 33% (+863/−303) | 49% (+622/−489) | 39% (+269/−237) | 29% (+147/−94) | 65% (+754/−673) | 2% (+14/−11) |
| 53f4ad4 (2021-04-13) → v2.10.0 (2021-11-18) | 100% (+5203/−5921) | 95% (+9787/−3048) | 36% (+920/−330) | 56% (+1149/−552) | 42% (+548/−260) | 100% (+452/−325) | 72% (+1170/−743) | 28% (+243/−177) |
| 53f4ad4 (2021-04-13) → v4.18.0 (2026-10-09) | 100% (+5808/−5921) | 100% (+5682/−3217) | 100% (+1788/−909) | 101% (+1128/−997) | 100% (+1116/−615) | 100% (+1338/−325) | 100% (+1686/−1031) | 100% (+1310/−631) |

`new` with removed lines (first row): files with ReBLUR / SIGMA names first appear in this step, and
git paired them with differently named older files, so the removed lines belong to those. Over 100 %
means git attributed removed lines from files renamed in from another area. The last two rows are
direct diffs across many steps and over-state (see Metrics); the chained estimate below is the better
figure.

**Chained estimate of lines replaced, from 53f4ad4 (2021-04-13, GTC 2021 week) through v4.18.0** (all consecutive steps above plus every release step):

| area | lines at 53f4ad4 | lines at v4.18.0 | chained est. replaced | Σ per-step rem% | gross churn ÷ start |
|---|---:|---:|---:|---:|---:|
| ReBLUR | 5921 | 5808 | 100% | 482% | 10.3× |
| ReLAX | 3217 | 5682 | 99% | 334% | 15.4× |
| SIGMA | 909 | 1788 | 92% | 226% | 8.4× |
| shared shader code | 988 | 1141 | 95% | 252% | 6.1× |
| API headers | 615 | 1116 | 86% | 185% | 6.5× |
| NRD.hlsli | 325 | 1338 | 90% | 215% | 12.0× |
| library core | 1031 | 1686 | 96% | 276% | 10.9× |
| integration | 631 | 1310 | 86% | 169% | 5.9× |

## 5. Clean-up

The scratch clone
`/private/tmp/claude-502/-Users-dex-Developer-Denoiser-nrd-cleanroom/e9f5ef6a-5b0b-422e-b903-b6fd737cf629/scratchpad/nrd-churn/`
was deleted with `rm -rf` after the numbers above were computed (2026-10-25 21:14 JST; checked absent afterwards),
before the orchestrator's pause; the comparison step afterwards needed only the saved counts. The per-area numbers
(JSON with counts and paths only) stay in the scratch directory for this session and are not
committed.
