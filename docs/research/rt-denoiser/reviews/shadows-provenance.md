# Second review: shadows (M4) provenance

_2026-10-25, second reviewer required by [RULES.md §8](../RULES.md) for passes whose pointers
came from [sources/shadows-specular.md](../sources/shadows-specular.md). Reviewer status: no
NRD code, NRD README, fork or port opened, before or during this review. This reviewer
wrote no passes. Read for this review: RULES, LESSONS, TASKS, PROVENANCE, SPEC §7, results/M4.md,
`packages/denoiser-realtime/src/shadow.ts`, `src/shaders/shadow.ts`, and these primary
sources from `rt-denoiser-sources/shadows-specular/`: `mehta2012.pdf` (pp. 163:3, 163:4 as page
images, 163:6–7 as text), `heitz2018.txt` / `.pdf` p.7, `rtg1.txt` (ch. 13 §13.4.5.1, ch. 25
§25.2.1), `tombraider2019.txt` plus slide images 67, 68 and 72, `rtg2.txt` ch. 24, and
`ch49_prose.txt` (prose only). `shadows-specular.md` was read as the thing under review, not
as a source._

## Scope and method

Scope: the 8 rows of PROVENANCE "Shadows (M4)" whose 2nd-review column was "yes". For each
row I checked three things:

1. Does the cited primary source contain the idea or formula as it is used? (location given)
2. Does the code follow that source, or is it plainly marked as our design?
3. Does anything in the code or SPEC §7 point to an uncited origin: a magic constant with no
   rationale, a structure that matches no cited source, or terminology no public source uses?

## Verdicts

| # | row (SPEC) | verdict | primary-source location |
|---|---|---|---|
| 1 | penumbra footprint R·h/(D−h), h·tanθ (SH-2) | **confirmed with correction** | M12 Eq. 2–4 p.163:3; Eq. 13 p.163:4; constants §6 p.163:6 |
| 2 | nearest occluder wins, 3×3-tile minimum (SH-3) | **confirmed** (our design from public M12) | M12 p.163:4 (text after Eq. 13, "smaller d2,max"); M12 §6 p.163:7 (unoccluded pixels: d1, d2 averaged over a 5-px radius) |
| 3 | penumbra tiles / indirect skip (SH-3) | **confirmed** | TR19 slides 71 ("Could we do less work?") and 72 ("Penumbra mask", title + image); H18 §4.1 p.7 |
| 4 | temporal on raw visibility, 5×5 clamp (SH-4) | **confirmed** | RTG1 ch. 25 §25.2.1 p.443; extra precedent for raw-only history: RTG1 ch. 13 §13.4.5.1 Eq. 11 p.170 |
| 5 | spatial: 2 passes, 8-tap rotated disk (SH-5) | **confirmed** | RTG2 ch. 24 §24.7.2 pp.383–384 (golden-ratio animation); RTG2 ch. 49 §49.5.5 prose (8 taps, animated 4×4 Bayer rotation), Eq. 49.3 (weight shape) |
| 6 | anisotropic stretch by 1/(n·l) (SH-5) | **confirmed** (our derivation, checked) | M12 Eq. 11–12 p.163:4; RTG2 ch. 24 §24.7.6 p.389 |
| 7 | noise-driven fallback (SH-6) | **confirmed with correction** (location) | H18 §4.2 Eq. 29 p.7; σ ∝ E and the 3×3 box are in §4.1 p.7 |
| 8 | renderer contract (SH-7) | **confirmed** | TR19 slides 55–62 (fix on slide 62); RTG2 ch. 24 §24.7.2 pp.383–384 |

No row is unsupported. The two corrections fix how the source is described. Neither one
changes the code.

## Per-row notes

### 1. Penumbra footprint (SH-2): confirmed with correction

- **Source check.** In M12, d1 is the light→receiver distance and d2 the light→occluder
  distance (Eq. 2). The slope is s = d1/d2 − 1 (Eq. 3 text), with s1, s2 from d2^min and d2^max
  (Eq. 4). Eq. 13 is
  `β(x) = (1/k)·(1/µ)·max[σ·(d1/d2,max − 1), 1/Ω_x^max]`, with k = 3, α = 1, µ = 2 (§6). From
  the page image of p.163:4: the factor **1/(kµ) multiplies both terms**. The floor term is
  **1/Ω_x^max**, which by Eq. 6 equals (d1/d2^max)·d/α, a little over one pixel footprint d.
- **Algebra check.** With h = receiver→occluder and D = receiver→light, d2 = D − h, so
  d1/d2 − 1 = h/(D − h). For a directional light (D → ∞, R/D → tanθ), W = h·tanθ. Both are
  correct. M12 measures d1 and d2 along a planar light's normal, and the code uses Euclidean
  ray lengths. It also uses the sphere radius R in place of M12's Gaussian σ. Both are
  approximations, and the tuned 0.75 radius factor absorbs the scale. The row already lists
  them as deviations.
- **Corrections.**
  - The row says "pixel floor 1 px". The 1-px value is ours: M12's floor is 1/(kµ·Ω_x^max).
    The row already lists "pixel floor 1 px" under our deviation, so it stands.
  - The code comment in `shaders/shadow.ts` (lines 15–16, "floored at one pixel") should say
    "floored near one pixel (M12), 1 px here".
  - `shadows-specular.md` line 110 mis-transcribes Eq. 13 as `(1/k)·max(σ(d1/d2_max − 1),
    1/(µ·Ω_pix))`. µ belongs outside the max, and the floor is 1/Ω_x^max, not 1/Ω_pix. Our
    code doesn't depend on this, because the radius scale is tuned.
- **Constants.** `radiusScale` 0.75 was tuned (M4.md §3 table). The `1e-3·D` guard is a
  numeric guard. The code also caches `g = h/(D−h)` over at most 7 occluded samples
  (`maxScaleHistory` = 7). No source or measurement is given for that 7; see "Minor hygiene".

### 2. Nearest occluder wins (SH-3): confirmed

- **Source check.** On p.163:4 M12 writes "shadows from close occluders can be sharper and
  should be filtered less, while those from further occluders (smaller d2,max) can be filtered
  more aggressively". In M12, d2,max is the occluder closest to the receiver among a pixel's
  samples. §6 p.163:7: "for these unoccluded pixels, we store the average values of d1 and d2
  in a 5 pixel radius". Both halves of the idea are public and say what the row claims.
- **Implementation.** The code takes the minimum of g over the occluded pixels of each 8×8
  tile (`atomicMin` on the f32 bits), then the minimum over 3×3 tiles. Lit pixels use that
  value, and occluded pixels take min(own, tile) (`SF_MERGE_MIN`). Smaller g = h/(D−h) means
  a larger d2, so taking the minimum follows M12's d2,max principle. Using a minimum instead
  of M12's 5-px average, and tiles instead of a radius, is plainly labeled our design. It was
  measured: +0.13 dB (`mergeMin`, M4.md §3).
- **Contamination check.** TR19 slides 67–68 ("Overlapping penumbra #1/#2") are photos only,
  with no text describing a fix, so the design cannot have come from there. The patent
  remedy mentioned in shadows-specular.md G2 is never described in this repo, so I can't
  compare against it. That doesn't matter here: the design follows completely from M12
  plus a stated, measured choice of our own.

### 3. Penumbra tiles / skip (SH-3): confirmed

- **Sources.** TR19 slide 71 asks "Could we do less work?". Slide 72 is titled "Penumbra
  mask" and shows a binary band around shadow edges. H18 §4.1 p.7 says "our filter incurs
  almost no cost outside of the penumbrae". In H18 that comes from σ ∝ E, so the kernel
  shrinks to nothing; it isn't a tile list, and the row's wording, "no filtering cost outside
  penumbrae", is accurate.
- **Our design.** The 8×8 tile and the activity test are labeled ours. The test is a
  fractional history, or raw samples that disagree, anywhere in the 3×3 tiles. Indirect
  dispatch over a tile list is standard WebGPU. FFX's tile classification (MIT, ported) is
  further prior art, and SPEC SH-3 cites it.

### 4. Temporal on raw visibility (SH-4): confirmed

- **Source check.** RTG1 ch. 25 §25.2.1 p.443 says: "a filter derived from spatiotemporal
  variance-guided filtering (SVGF) [24], with a single scalar value to represent shadowing …
  a pixel value bounding box clamp similar to the one proposed by Karis [15]. We calculate the
  size of the bounding box using Salvi variance-based method [22], with a kernel footprint of
  5 × 5 pixels." This matches the row word for word.
- **Raw-only history.** The row labels it our design, which is fine. A public precedent
  also exists: RTG1 ch. 13 §13.4.5.1 Eq. 11 p.170 averages the reprojected **raw**
  visibility of the last 4 frames, and the spatial filter runs afterwards on that result.
  The row could cite it.
- **Constants.** The clamp window 0.4σ + 0.05 is explained as ≈ 2 standard errors of a
  25-sample mean (σ/√25 = 0.2σ) and was tuned (M4.md §3). The other constants were all
  tuned and are labeled our design in their own rows: anti-lag 64, restart to A = 0,
  uniform snap, and the W_px² cap.

### 5. Spatial, 2 passes, 8-tap disk (SH-5): confirmed

- **Flagged source.** RTG2 ch. 24 §24.7.2 pp.383–384 says to "add the frame number
  multiplied by the golden ratio … then use modulus", calling it "the golden ratio additive
  recurrence low-discrepancy sequence on the time axis". The code does the same with
  `fract(Bayer/16 + frame·0.618… + pass·0.382…)`.
- **Other parts.**
  - The 4×4 Bayer rotation and the 8 taps come from RTG2 ch. 49 §49.5.5 prose ("animated
    in-time 4 × 4 Bayer dithering", "Poisson disk with eight samples").
  - `BAYER4` is the standard 4×4 Bayer matrix.
  - `DISK` follows SPEC R-3: golden-angle spiral (Vogel 1979), radii √((i+0.5)/4), antipodal
    pairs.
  - The weight shape W(x) = smoothstep(0, 1, sat(1 − x)) is RTG2 Eq. 49.3.
  - The second-pass phase offset 0.382 (= 2 − φ), the 2 % plane and 30° normal tolerances,
    and the lerp(1, 0.5, A/A_cap) radius shrink are ours. The tolerances were measured
    insensitive (M4.md §3), and SPEC SH-5 gives 30°.
  - `maxRadius` 48 px at 1080p is an unexplained safety cap; see "Minor hygiene".
- **Side effect.** The same RTG2-24 §24.7.2 check covers the "Bayer 4×4 rotation, animated"
  row (D3b, Recurrent section), which is also flagged "yes". That row is out of this
  review's scope and I left it unchanged; the orchestrator can mark it from this note.

### 6. Anisotropic stretch by 1/(n·l) (SH-5): confirmed (our derivation)

- **Source check.** M12 Eq. 11–12 p.163:4: "‖x − x′‖ … measured along the plane parallel to
  the light (motion normal to the light is excluded) … ‖x − x′‖² = |x − x′|² − [n·(x − x′)]²",
  where n is the light normal.
- **Derivation check.** Take a receiver-plane offset t·T, with T the light direction l
  projected on the receiver plane. Its in-light-plane length is t·|n_r·l|. So a Gaussian of
  width β in M12's metric spans β/(n_r·l) along T on the receiver. The "our reading" claim
  is correct.
- **Adaptation.** For a sphere light, the code uses the direction to the light centre as M12's
  light normal; this is our adaptation. RTG2 ch. 24 §24.7.6 p.389: "Glancing angles of
  lighting also make for longer penumbras". Location confirmed. The option is off by default
  because it measured worse.

### 7. Noise-driven fallback (SH-6): confirmed with correction (location)

- **Source check.** H18 §4.2 p.7, Eq. 29: E[x] = (1/n) Σ ∫ |d²W_N/dt²| dt over n uniformly
  angled lines, "an asterisk shape of n = 4 lines with a random per-pixel offset". §4.1 p.7
  adds: "Denoise E itself via a 3 × 3 box filter" and "We set the standard deviation of the
  Gaussian kernel proportional to the noise estimate E".
- **Correction.** The row puts "σ ∝ E" under §4.2. It is in §4.1, so the citation should read
  "§4.1 (σ ∝ E, 3×3 box), §4.2 Eq. 29 (E)".
- **Implementation.** The code applies E to raw visibility instead of W_N = S_N/U_N. That's
  equivalent when there's no analytic unshadowed term, though not stated. Its discrete form
  takes 3 second differences along each of 4 lines on the 5×5 shared tile. `/24` normalizes
  E to [0, 1]: 4 lines × 3 positions × max |Δ²| = 2, as the comment says. Dropping the
  random offset, accumulating E over time and the 24-px scale are listed as our deviations
  (scale tuned, M4.md §4).

### 8. Renderer contract (SH-7): confirmed

- **TR19 slides 55–62.** Jittered TAA moves shadow-ray origins and causes flicker on flat
  ground (slides 59–60). Slide 62 gives the fix: "render an extra depth pass without
  jittering … to reconstruct WS ray origins".
- **RTG2-24 §24.7.2.** As in row 5.
- **Note.** RTG2-24 describes the golden-ratio step for a scalar per pixel. LESSONS (results,
  2026-10-25) records that 2-D samples should use the R2 sequence (Roberts 2018), because
  golden-ratio steps on every dimension put samples on a line. If the contract text names
  the golden ratio for 2-D light samples, it should add that.

## Scan of the code and SPEC §7 for uncited origins

No terminology outside the cited public sources and our own descriptive names. Names like
"tiles", "penumbra scale", "uniform snap", "anti-lag" and "terminator" are descriptive. No NRD
or SIGMA names appear in the code; the `sigma` identifiers are standard deviations.

No structure without a source or a "design" label:

- The pass order temporal → tiles → spatial ×2, with tile stats folded into the temporal
  pass, is documented as ours (M4.md §7.7, LESSONS).
- The terminator test n·l < sin(angular radius) is ours and labeled.

Constants without a stated rationale (minor, not provenance blockers; see below):
`maxScaleHistory` = 7, `maxRadius` = 48 px at 1080p, and the pass-2 rotation offset 2 − φ.

Cosmetic: `shaders/shadow.ts` line 58 has two comments merged onto one line: the
`SF_SNAP` comment and a stray Catmull-Rom comment that belongs to `SF_CATMULL`.

## Minor hygiene (for the shadows owner, non-blocking)

- Record `maxScaleHistory` = 7 and `maxRadius` = 48 px as "our design, untuned" in
  PROVENANCE, or tune them.
- Note in PROVENANCE that the pass-2 phase offset 2 − φ is ours.
- Fix the "floored at one pixel" comment (row 1) and the merged comment at line 58.
- Optionally cite RTG1-13 Eq. 11 p.170 for the raw-only history (row 4), and fix the H18
  section in row 7.

## Passages in `sources/shadows-specular.md` to trim or fix

Line numbers are for the committed file at review time.

| lines | text | why | suggested change |
|---|---|---|---|
| 582–583 | "NRD prose calls single-pass multi-light theoretical." | Comes from NRD README prose. RULES §2 names the README's multi-light paragraph as off limits. | **Delete the sentence.** |
| 573–574 | "NRD prose says it exists, not what it is." | Attributes a fact to the NRD README. The concept is public anyway (GTC 2020 s.9 normalized hit distance, already cited at line 500). | Replace with "Z20 slide 9 names the concept; no public source gives the curve." |
| 654–656 | "…may match early NRD code." | Speculation about NRD's code. Not a description of internals, but unnecessary. | Optional: shorten to "public-talk pseudo-code; the lead may prefer the stated properties only". |
| 462–465 | "NRD-class filters avoid luminance-weighted averaging in the main path (RTG2-49 §49.5.1 …)" | The cited source supports the claim for ReBLUR only (ch49 §49.5.1: "doesn't suppress them, but tries to redistribute energy"), not for "NRD-class filters" in general. | Reword to "ReBLUR avoids … (RTG2-49 §49.5.1)". |
| 246–247 | "Hit-distance preprocessing: denoise or spread h so lit pixels next to a shadow still know a blocker distance (see G2)." | No public citation, and it sits next to the patent-derived G2 remark. A public source exists: M12 §6 p.163:7. | Add "(M12 §6 p.163:7: unoccluded pixels take d1, d2 averaged over a 5-px radius)". |
| 109–111 | Eq. 13 transcription | Mis-transcribed (see row 1). | `β = (1/k)(1/µ)·max(σ(d1/d2,max − 1), 1/Ω_x^max)`, with 1/Ω_x^max = (d1/d2^max)·d/α (Eq. 6). |

Nothing else in the note goes beyond what its cited public sources say. I checked the A2,
A3 and G1 claims against M12, H18, RTG1-13/25, RTG2-24 and TR19. The FFX rows describe
AMD's public docs and MIT code. B and C are outside this review's shadows scope; I skimmed
them for NRD attributions and found only the lines above.
