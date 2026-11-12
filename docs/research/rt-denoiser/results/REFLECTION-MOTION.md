# Reflection motion: isolated tests against an analytic oracle (review target 2, target D item c)

_reflection-motion agent (implementer / evaluator, RULES.md rule 8: no NRD code, README, release notes, port or
quarantined file read; the audit handoff only in its reviewed copies), 2026-10-26. Everything here was measured on
our own test bed (Apple M5 Pro, HeadlessChrome 155, Metal). Package measured: HEAD 9c00359 (= f22af56 for
`denoiser/realtime`) plus the two options below._

## Conclusion first

- **The shipped default (A-SVGF `antiLag: 'auto'`) does not drag mirror reflections under camera motion**, although
  it reprojects specular history with surface motion and reads no hit distance: SPEC R-8's parallax cap leaves a
  near-mirror ~1 frame of history whenever the camera moves, so it filters clean input spatially. On every camera path
  (plane, convex ball, concave mirror, grazing, rippled mirror) its reflected marker images sit within 0.1–0.2 px of
  the analytic oracle (0.7 px on the concave near image, whose reference itself is 1.1 px off), with no duplicate images.
- **It does leave short trails where parallax is zero**: a reflected object moving in front of a still camera and
  mirror (trail 6.1 px, the ROI 4.9 dB under the clean input on a plane mirror; 3.7 px on a mirror ball), and a turning
  mirror (5.1 px). Only A-SVGF's gradient cuts those histories, a few frames late. On **glossy** mirrors (r 0.1–0.2) the
  cap admits many frames and the near image drags 0.7–1.6 px behind the oracle, the far image 2.5 px at r 0.1.
- **Plain SVGF (`antiLag: 'off'`) drags and duplicates** in the same zero-parallax cases: 28 px trails and a second
  image on 34 of 40 moving frames (reflected object), 24 px (turning mirror).
- **The recurrent filter's virtual motion produces a *leading* ghost and duplicate images on clean mirrors** (far image
  5.6 px *ahead* of the oracle, extra blobs on 36 / 40 frames, reflector region 29.6 vs 38.5 dB for A-SVGF). Cause:
  reflected-world disocclusion — background pixels next to a reflected object reproject, by their own far hit distance,
  onto where the object's image was, and the virtual confidence only shortens that history to 3 frames. With
  `virtualMotion: false` the same filter tracks the mirrors. Virtual motion still gives it the best centroid on r 0.1.
- **Two options, default off, default path byte-identical** (WGSL of every SVGF pass and a `std540-orbit` replay):
  - `reflectionHitTest` (our design after SVGF §4.1's consistency tests): drop history taps whose stored reflected hit
    distance disagrees with this frame's beyond its local spread. Halves the zero-parallax trails of the shipped
    default (6.1 → 3.3 px; the moving-object ROI +3.1 / +1.4 dB on plane / ball, reflector region +2.4 / +1.2 dB;
    turning mirror +1.3 dB), neutral (±0.02 dB) everywhere else on the reflection paths.
  - `reflectionReprojection: 'dual'` (Eto et al. 2023 §2.4.2 after Stachowiak 2018: surface and hit-point history,
    blended by brightness distance to the current colour; our weights, our roughness fade): fixes the glossy drag
    (r 0.1: lag −0.69 → +0.08 px, far image 2.5 → 0.6 px, ROI +2.8 / +3.4 dB, reflector region +2.6 dB, FLIP −1.4 %).
    Without the roughness fade it lost up to 8 dB on rough surfaces. `'virtual'` alone (Stachowiak 2015's hit-depth
    reprojection) lost on glossy and stays only as a measured option.
- **Rule-9 A/B** (§6): on the 7 standard paths at 1080p (4096-spp references on orbit / light / glossy) the hit test is
  level (+0.01 dB) and `'dual'` + hit test gains +0.08 dB (near-mirrors +0.7…+1.2 dB on 5 paths, FLIP −1…−3 %); the
  real SSR scenes are level (+0.01 / +0.05 dB). **Neither passes for adoption**: boil +16 % on the two real-scene
  captures with a moving object (the hit test drops exactly the history that hid SSR noise there) and cost +14.5 % /
  +31 % for the specular denoiser at 1080p.
- **Decisions for Dennis** (§7): no default change proposed; whether the trail-vs-noise trade of the hit test is worth
  offering beyond an opt-in; the recurrent filter's leading ghost is filed for its owner; a native probe (P8) and its
  captures are defined but not written.

## 1. Inventory: what each configuration does for reflection tracking

Read from the code at HEAD (`packages/denoiser-realtime/src/shaders/svgf.ts`, `common.ts`, `gradient.ts`,
`recurrent.ts`; `packages/denoiser-ffx/src/shaders/reflections.ts`; `tools/rt-capture/src/denoisers.ts`), not from
the docs.

| configuration (registry id) | where the specular history comes from | hit distance | curvature | what limits a wrong history | inputs it reads |
|---|---|---|---|---|---|
| **A-SVGF `antiLag: 'auto'`** (`svgf-auto`; **the shipped default** of `SpecularDenoiser` / `DiffuseSpecularDenoiser` since 64a1123) | the **surface point's** previous position only (NDC motion + view z / 2.5D motion z, per-tap plane + normal tests, 3×3 fallback; one reprojection shared with diffuse in the joint class) | **not read** (accepted by the API, never bound) | none | (1) SPEC R-8 cap: history ≤ θ_L(α)·√(N·V)/parallax + 1 frames, parallax = angle between this and last frame's view ray to the surface point (camera *and* surface motion; 0 under pure rotation); (2) A-SVGF λ: per 3×3 stratum, this frame's luminance vs the **surface-reprojected** history, noise floor 1σ for specular, α → 1 where λ > 0. It detects reflection motion as "change" and shortens history; it does not follow the reflection | radiance, depth / view z, motion (+ motion z), normal, roughness |
| SVGF `antiLag: 'off'` (`svgf`, pinned) | same | not read | none | R-8 cap only; α_min 0.2. Nothing reacts when the reflected *world* moves (parallax = 0 for a static camera and surface) | same |
| recurrent (`recurrent-specular`, `filter: 'recurrent'`) | two candidates: surface (R-8 cap) and **virtual** (SPEC R-9: X + v̂·d_v·F_dom(α), d_v = h̃/(1 + 2κh̃), projected with the previous camera; **static reflected world**), blended in α-space by m = F_dom·[virtual footprint valid] | **read** (optional): h̃ = fast history of the normalized hit distance mixed with this frame's pre-blurred one; without `hitDistance` every reflection is treated as at infinity | **isotropic κ** from the 4 axis neighbours' normals (normal-mapped normals included), no incidence-angle term; past a concave focus 1 + 2κh is clamped at 0.05 | virtual confidence c_v (footprint plane test × normal × roughness × fast-ĥ agreement, tolerance 0.05 + 0.25r); low c_v only shortens the virtual history to A_fast = 3 and tightens the clamp μ ± γ(1 + 2c_v)σ (3×3 of the pre-blurred input); current-frame detector C-10b; stabilization (R7) is surface-reprojected | radiance, hit distance, depth / view z, motion, normal, roughness |
| recurrent `virtualMotion: false` (`recurrent-specular@r.virtualMotion=false`, control) | surface only + R-8 cap | sizes radii only | — | detector, clamp | same |
| FidelityFX 1.x reflections (`ffx-reflections`, MIT port, control) | **hit-point** candidate (view ray extended by the pixel's own 1-ray hit distance: planar virtual image, no curvature, no F_dom) if its history normal / roughness agree at least as well as the surface candidate's; else surface if its squared distance to the 9×9 Gaussian-weighted local mean is under 1.5 × the local variance; else no history | read (raw, per pixel) | none | normal / roughness agreement, variance test, neighbourhood clip | radiance, hit distance, depth, motion, normal, roughness |
| three.js SSR pages (`realtime-gi.html`, real-scene `three-*` / Bistro / Sponza captures) | whatever the filter above does | SSR ray length in `.a` (× three's dominant factor; misses = 0) → `hitDistance` by default; SVGF ignores it | — | — | SSR radiance is **not demodulated** and misses fall back to the environment: a different signal from the traced one below |

Two facts the rest of this report rests on:

- **"SVGF uses no hit distance" does not mean "SVGF drags on mirrors".** For r ≈ 0 the R-8 cap is ~1 frame under any
  parallax, so a near-mirror under camera motion keeps no history at all: it is spatially filtered clean input. The
  cap is blind only where parallax is 0: a moving reflected object, a turning reflector, and glossy surfaces whose
  cap admits tens of frames (θ_L grows with roughness).
- **The recurrent filter's virtual motion assumes the reflected world is static and that a pixel's reflected scene
  point was visible at the virtual position last frame.** Around a reflected object both fail: background pixels
  next to its image reproject (correctly, by their own far hit distance) to where the object's image *was*, and the
  confidence only shortens that history to 3 frames instead of dropping it.

## 2. The test bed: reflect build, paths, oracle, metrics

### 2.1 Scene and paths

A new scene build `reflect` in the analytic tracer (`examples/realtime-denoiser/src/scene.ts`; the standard, bumpy and
glass builds generate byte-identical WGSL): a dark checker floor (r 0.9), a dim sky without the window band, one metal
reflector (f0 0.95) and two emissive marker spheres (radius 8 / 10 cm, radiance 8): marker 1 **near** the reflector
(0.6–1.1 m), marker 2 **far** (4.4–5.4 m, on most paths behind the camera, so it is only seen in the mirror).
Reflector kinds: a 2.4 × 1.6 m **plane** mirror (optionally with normal-mapped ripples: 8°, 25 cm period, geometry
flat), a **convex** mirror ball (R 0.6 m), a **concave** spherical cap (R 3 m, f 1.5 m, aperture 2 m). Reflector and
markers carry previous poses, so motion vectors follow them.

16 paths (`src/paths-reflect.ts`, registered into `PATHS` on import), 72 frames: frames 0–40 move at constant speed,
41–71 hold the last state (stop / hold); `rm-cut-plane` cuts the camera at frame 36 instead.

| path | what moves | reflector | why |
|---|---|---|---|
| `rm-cam-plane` | camera (7.5 cm / frame strafe, turning to keep the mirror centred) | plane, r 0.02 | the classic reflection-parallax case |
| `rm-cam-plane-r10` / `-r20` / `-r35` / `-r50` | same | plane, r 0.1 … 0.5 | roughness sweep (4096-spp references) |
| `rm-bump-plane` | same | plane with ripples | curvature only in the normals (vs `rm-cam-convex`: true curvature) |
| `rm-graze-plane` | camera, incidence ~70–78° | plane | grazing views |
| `rm-obj-plane` | near marker (5 cm / frame) | plane | reflected-object-only motion |
| `rm-obj-exit` | near marker, leaving the mirror at frame 23 | plane | visibility change, ghost persistence |
| `rm-refl-slide` | mirror slides in its plane (4 cm / frame) | plane | surface motion vectors move, the reflection must not |
| `rm-refl-turn` | mirror turns 0.35° / frame | plane | reflector rotation: the far image swings at twice the turn |
| `rm-cam-convex` | camera | ball | convex curvature |
| `rm-obj-convex` | near marker circling the ball | ball | object motion on a curved mirror |
| `rm-refl-ball` | ball translates (2 cm / frame) | ball | reflector translation with curvature |
| `rm-cam-concave` | camera | concave | near marker inside f (upright virtual image), far marker beyond 2f (inverted **real** image in front of the mirror) |
| `rm-cut-plane` | camera, cut at 36, then hold | plane | old view must not survive the cut |

### 2.2 The oracle

`src/reflect-oracle.ts`: float64 JS sharing no code with the tracer or any denoiser. Its own pinhole camera (eye,
target, vertical FOV; no matrices), its own ray / quad / sphere / cap intersections, and the analytic mirror point of
each marker: for the plane, the crossing of E → M′ (M mirrored across the plane) inside the quad; for the sphere, every
root of the reflection condition in the plane through the centre, the eye and the marker (Alhazen's problem on a
circle; up to four roots, so the concave cap could show several images — none of our paths does), kept when the
reflector is the first hit along the view ray and no marker blocks either leg. It also evaluates, at its own mirror
point, the two correspondence estimates a filter can use: **surface reprojection** (the reflector point's own previous
position) and SPEC R-9's **virtual image** (true curvature, true hit distance, static reflected world) — scored against
the true previous image position, never used as the truth.

### 2.3 Oracle and renderer checks

Noise-free correspondence error over the 40 moving frames (px per frame; `ref vs oracle` = the reference image's
centroid against the oracle):

| path | marker | image motion | surface reproj. err | virtual (R-9) err | ref vs oracle |
|---|---|---|---|---|---|
| rm-cam-plane | near / far | 1.31 / 5.85 | 1.36 / 6.20 | 0.16 / 0.05 | 0.06 / 0.02 |
| rm-graze-plane | near / far | 4.04 / 1.32 | 2.23 / 6.37 | 0.14 / 0.05 | 0.10 / 0.10 |
| rm-obj-plane | near (moving) | 6.20 | 6.20 | 6.20 | 0.06 |
| rm-refl-slide | near / far | 0.00 / 0.00 | 5.61 / 5.89 | 0.00 / 0.00 | 0.07 / 0.01 |
| rm-refl-turn | near / far | 0.98 / 4.11 | 0.94 / 4.10 | 0.98 / 4.11 | 0.04 / 0.02 |
| rm-cam-convex | near / far | 1.38 / 1.16 | 0.99 / 1.35 | 0.07 / 0.02 | 0.09 / 0.09 |
| rm-obj-convex | near (moving) | 3.50 | 3.50 | 3.50 | 0.05 |
| rm-refl-ball | near / far | 3.25 / 3.96 | 1.39 / 0.78 | 3.25 / 3.96 | 0.08 / 0.15 |
| rm-cam-concave | near / far (real image) | 1.03 / 3.45 | 1.05 / 3.45 | 0.15 / **6.18** | 1.12 / 0.07 |
| rm-bump-plane | near / far | 1.31 / 5.85 | 1.36 / 6.20 | 0.16 / 0.05 | 6.01 / 3.97 (ripples move the image by design) |

What the oracle says before any denoiser runs: under camera motion the virtual image is right to a fraction of a
pixel on plane, convex and grazing mirrors, and surface reprojection is off by up to 6 px per frame; with the planar
formula (κ = 0) the convex far image would be 6.9 px off, so curvature matters. The virtual estimate is **as wrong as
surface reprojection** whenever the reflected world moves (object motion, reflector rotation), **worse** when the
reflector translates (the static-world assumption), and **wrong past a concave mirror's focus** (6.2 px; SPEC R-9's
1 + 2κh goes negative there and is clamped).

Renderer checks at the oracle pixel, every frame of every path (CPU ray through the same pixel centre vs the GPU
guides): view z, geometric normal and the motion vector (incl. reflector motion) agree to f32 precision (max errors
0.0000 m, 0.011°, 0.000 px); the mirror ray's 1-spp hit distance agrees within 1.1 % (r 0.02 GGX jitter); the
reference's image centroid lands 0.02–0.3 px from the oracle on every mirror (1.1 px on the concave near image,
whose magnified image is not round). Projection, unprojection, primary positions / normals and secondary-hit distances
are therefore validated independently of any denoiser.

### 2.4 Metrics (`src/reflect-eval.ts`, results under `results.reflect` of a test-bed eval)

Per frame and marker, an 80 × 80 px window around the oracle position (32 × 32 on the ball), **reflector pixels only**
(the marker seen directly and the other marker's image are masked), read back for reference, input and every
specular denoiser: ROI PSNR (Reinhard per channel, pooled), centroid position error and signed lag along the image's
motion (negative = dragging), trail length behind the image beyond the reference's own blob, ghost energy (output
luminance excess outside the reference blob over the reference's excess: trails, smears and duplicates in one
number), duplicate frames (more 8-connected blobs than the reference), recovery after the stop (frames until the ROI
error stays within 1 dB of its settled value), ghost decay after an image leaves (`rm-obj-exit`). The test bed's own
full-frame scores run alongside (pooled PSNR, the reflector's roughness bin, the dynamic region, FLIP every 6 frames,
motion-compensated flicker). Position metrics are meaningful while the reference image is compact: up to r 0.2 for the
near marker, r 0.1 for the far one (at r 0.2 the far image is a glow wider than the window).

## 3. Reproduction: who drags, duplicates or smears, and where

Batch 1, every `rm-*` path, 960×540, 72 frames (40 moving, 31 held), blue noise, 256-spp references on the mirrors
(the input is a near-mirror view of emissive markers and a diffuse floor; the reference is converged there) and
**4096-spp references on the roughness sweep**. Same page per path, so every arm sees identical inputs. Full tables:
[data/reflection-motion/b1-tables.md](data/reflection-motion/b1-tables.md), JSON without crops in [data/reflection-motion/b1/](data/reflection-motion/b1/), and `node examples/realtime-denoiser/rm-table.mjs <dir>`.

**Summary per configuration** (ROI = 80×80 px around the oracle's image position, reflector pixels only; "far" =
marker 2, ~9 m along the mirror path; trail / pos err while moving):

| configuration | mirrors, camera motion | reflected object moves (`rm-obj-*`) | reflector turns / moves | glossy r 0.1–0.2, camera | concave, grazing, ripples |
|---|---|---|---|---|---|
| **svgf-auto (shipped)** | **tracks** (pos err ≤ 0.2 px, trail ≈ input's): R-8 cap drops mirror history | **short trail**: 6.1 px plane, 3.7 px ball, ghost 0.014–0.021, ROI −4.9 / −8.3 dB vs the clean input | turn: far trail 5.1 px, pos err 1.0 px; slide: clean (cap) | **drags** the near image: lag −0.7 (r 0.1) / −1.6 px (r 0.2); far image blotchy | clean (concave far image pos err 0.2 px); graze clean; ripples clean |
| svgf (`antiLag 'off'`) | tracks (same cap) | **drags, duplicates**: trail 28 px, pos err 11.6 px, extra blob on 34 / 40 frames (plane); trail 10 px (ball) | turn: trail 24 px, dup 12 / 40 | drags more: lag −1.3 / −4.3 px | as svgf-auto |
| recurrent (virtual motion) | **leading ghost + duplicates**: far image pos err 5.6 px *ahead*, ghost 0.33, near image extra blob 36 / 40 frames, ROI −12.7 dB vs svgf-auto; reflector bin 29.6 vs 38.5 dB | trail 27 px (plane), dup 31 / 40 (ball) | turn: trail 23.5 px, dup 13 / 40 | **best centroid** at r 0.1 (0.15 px), but duplicates on 40 / 40 frames at r 0.2 (far) | concave far: trail 22 px, dup 38 / 40; graze: trail 14–16 px |
| recurrent, `virtualMotion: false` | tracks (0.1–0.2 px) | trail 6.1 px | turn: trail 4.1 px | drags (lag −1.5 / −3.4 px) | clean |
| ffx-reflections | blurred, offset 2 px | trail 9 px | turn: 3–4.5 px | blurred out | smear on concave |
| accumulate-32 (no clamp, surface) | trail 22–29 px | trail 27 px | trail 18–29 px | trail 23 px | trail 16–22 px |

Crops (columns: reference, input, svgf-auto, svgf, recurrent, recurrent without virtual motion, ffx-reflections; rows:
frame 24 moving, 41 first held, 44): [far image, camera](img/rm-b1-cam-plane-far.png),
[near image, moving object](img/rm-b1-obj-plane-near.png), [far image, turning mirror](img/rm-b1-refl-turn-far.png),
[concave mirror, real image](img/rm-b1-concave-far.png).

Read with the oracle table (§2.3): on a plane mirror under camera motion the far image moves 5.9 px/frame and
surface reprojection misses its previous position by 6.2 px per frame; SVGF survives that only because R-8
gives mirrors ~1 frame of history. Where parallax is 0 (object motion, reflector rotation) the cap is wide open and
only A-SVGF's λ cuts history, a few frames late (the 3–6 px trails). On glossy surfaces the cap admits tens of frames
by design (θ_L grows with roughness), and the near image drags by 0.7–1.6 px at r 0.1–0.2.

The recurrent filter's virtual motion fails in a way none of the surface-only filters do: a **leading ghost**
(crops: [img/rm-b1-cam-plane-far.png](img/rm-b1-cam-plane-far.png)). Background pixels just ahead of a moving reflected object reproject, by their
own (far) hit distance, onto where the object's image was; the virtual confidence notices the hit-distance mismatch
but only shortens that history to A_fast = 3 frames, and the 3×3 clamp around a high-contrast image is wide enough to
let it through. With `virtualMotion: false` the same filter tracks the mirrors (ROI +7 … +8 dB). M3's "virtual motion
+2.75 dB on `glossy`" is a glossy-floor result (no isolated bright reflected object); both hold.

Geometry checks (§2.3) pass on every path: view z, geometric normal and motion vector at the oracle pixel match the
CPU to f32 precision; the mirror ray's hit distance agrees within 1 %; the reference's image centroid sits 0.02–0.3 px
from the oracle (1.1 px on the concave near image, whose magnified image is not round; 4–6 px on the rippled mirror,
whose detail normals move the image by design).

## 4. Candidates (from the cited publications; options, default off)

All live in SVGF's temporal pass for the specular signal (`src/shaders/svgf.ts` `perSignalVirt`, compiled in only
when an option is on), read `inputs.hitDistance` (0 = miss), and store this frame's 3×3 mean hit distance and its spread in
the specular moments' `.b` / `.a` (rg32float → rgba32float, +8 B/px).

| option | what | source |
|---|---|---|
| `reflectionHitTest: true` | a history tap is dropped when its stored hit distance h_prev differs from this frame's h by more than (0.1 + 0.4 r)·max(h, h_prev) **+ max(this frame's 3×3 spread of hit distances, ½ the tap's stored spread)** | our design: SVGF §4.1's per-tap consistency test applied to the reflected surface. The tolerance took three measured steps: no spread term lost 2.5–3.4 dB on held mirrors (per-frame 3×3 means jitter at reflected edges and over grazing floors); this frame's spread alone lost 0.5–0.7 dB on the test bed's `light` mirrors (static glossy pixels whose 9 samples happen to cluster); the full stored spread halved the object-motion gain (pixels at the object's old edge kept their history); half of it keeps both |
| `reflectionReprojection: 'virtual'` | history fetched at X + v̂·h̄·F_dom/(1 + 2κh̄) (h̄ the 3×3 mean hit distance, κ from neighbouring normals, previous uv by inverting `prevProjInv` at the point's depth), its taps plane- and hit-distance-tested; the surface history where they fail or past a concave focus | Stachowiak 2015 (reproject with the reflected objects' depth), FidelityFX 1.x `getHitPositionReprojection` (MIT, our port), SPEC R-9 for κ / F_dom |
| `reflectionReprojection: 'dual'` | both candidates, weights 1/(1 + d²), d = (luma(history) − μ)/(σ + 0.05μ) over this frame's 3×3 input; faded out between r 0.1 and 0.2 | Eto et al. 2023 §2.4.2 (dual-source temporal accumulation, after Stachowiak 2018); weights and fade ours; the paper's neighbourhood clamp not built |

Not done: anything that needs reflected-object motion (no renderer supplies it); a clamp of the reprojected history
(A-SVGF's gradient already reacts); the recurrent filter's virtual-motion disocclusion (below, §7).

## 5. Candidates on the reflection paths

Batch 2 (same paths, inputs and references as §3, one page per path, final option code). Δ against `svgf-auto` (the
shipped default); full tables: [data/reflection-motion/b2-deltas.md](data/reflection-motion/b2-deltas.md). Dropped
variants: [b2-variants-deltas.md](data/reflection-motion/b2-variants-deltas.md) (no-spread hit test, unfaded `'dual'`,
`'virtual'`), [b2-tolerance-v1-deltas.md](data/reflection-motion/b2-tolerance-v1-deltas.md) (hit test with this
frame's spread only).

**Where the reflections are** (marker ROI, dB while moving / after the stop; trail in px):

| path, marker | svgf-auto | + `reflectionHitTest` | + `'dual'` + hit test |
|---|---|---|---|
| rm-obj-plane, near (moving object) | 23.76 / 33.37, trail 6.1, pos err 0.73 | **+3.13** / +0.40, trail 3.3, pos err 0.21 | +3.13 / +0.37, trail 3.3 |
| rm-obj-exit, near (image leaves at 23) | 23.33, trail 6.1 | **+3.44**, trail 3.6 | +3.44, trail 3.6 |
| rm-obj-convex, near (moving object) | 18.50 / 29.31, trail 3.7 | **+1.39** / +0.24 | +1.39 / +0.08 |
| rm-refl-turn, far (turning mirror) | 27.14 / 34.76, pos err 1.03 | **+1.28** / +0.07, pos err 0.74 | +1.27 / +0.06 |
| rm-cam-plane-r10, near (glossy, camera) | 29.24 / 36.52, lag −0.69 px | ±0.00 | **+2.82** / +0.46, lag +0.08 px |
| rm-cam-plane-r10, far | 28.95 / 36.40, trail 6.4, pos err 2.50 | −0.02 / ±0.00 | **+3.43** / +0.12, trail 1.0, pos err 0.56 |
| every other path and marker | | −0.07 … +0.23 / −0.01 … +0.03 | −0.09 … +0.38 / −0.34 … +0.65 |

**Whole frame** (pooled specular dB / the reflector's roughness bin / dynamic region / FLIP): `reflectionHitTest`
moves nothing by more than 0.02 dB except where it removes trails: rm-obj-plane +0.27 pooled / +2.38 reflector / +1.20
dynamic, rm-obj-exit +0.18 / +2.46 / +0.99, rm-obj-convex +0.12 / +1.22 / +1.09, rm-refl-turn +0.06 / +0.41 / +0.66;
FLIP within ±0.3 %. `'dual'` + hit test adds rm-cam-plane-r10 +0.66 / +2.57 / +2.19, FLIP −1.4 %, and stays within
±0.02 dB pooled of the hit test alone everywhere else. On plain SVGF (`'off'`) the hit test hardly acts (its 28 px
object trail stays): the test only trims the edge history that A-SVGF's gradient leaves.

**The tolerance is a trade-off** (all three versions measured): this frame's spread alone removed more of the object
trail (6.1 → 1.0 px, reflector +2.9 dB) but lost 0.5–0.7 dB in the mirror bin of the test bed's static-camera `light`
path (glossy pixels whose 9 samples happen to cluster) and 0.4–0.55 dB in the r 0.2 held ROI; the built version
(+ ½ the stored spread) loses nothing measurable and keeps about half the trail reduction (6.1 → 3.3 px).

**Dropped on the way** (b2-variants): the hit test **without** a spread term lost 2.5–3.4 dB on every held mirror;
`'dual'` **without** the roughness fade won r 0.1 (+2.6 dB reflector) but lost r 0.2–0.5 by 2–8 dB in the reflector
bin and 0.8–5 dB pooled (the r 0.9 floor), FLIP +5…+50 %; `'virtual'` + hit test lost 4–7 dB on the glossy near image
(r 0.1–0.5) while tracking it. Crops: [img/rm-b2-obj-plane-near.png](img/rm-b2-obj-plane-near.png),
[img/rm-b2-r10-far.png](img/rm-b2-r10-far.png), [img/rm-b2-refl-turn-far.png](img/rm-b2-refl-turn-far.png)
(columns: reference, input, svgf-auto, + hit test, + dual + hit test; rows: frame 24 moving, frame 41 first held).

## 6. Rule-9 A/B

Both options against the shipped default `svgf-auto` (TASKS rule 9), final option code. Tables:
[data/reflection-motion/b3-std-tables.md](data/reflection-motion/b3-std-tables.md),
[b3-real-scene.md](data/reflection-motion/b3-real-scene.md); JSON in `b3/`.

**7 standard paths, 1080p, 96 frames, specular** (orbit / light / glossy against 4096-spp references; Δ dB unless noted):

| path | ref | svgf-auto pooled | hit test: Δ pooled / Δ mirror bin (r < 0.15) / Δ disoccl. / FLIP / flicker | dual + hit: Δ pooled / Δ mirror bin / Δ disoccl. / FLIP / flicker |
|---|---|---|---|---|
| orbit | 4096 | 36.31 | +0.00 / +0.01 / +0.00 / 0 % / 0 % | **+0.17** / +0.75 / +0.03 / −1.7 % / 0 % |
| light | 4096 | 39.66 | −0.00 / −0.00 / – / 0 % / 0 % | −0.00 / −0.01 / – / 0 % / 0 % |
| glossy | 4096 | 37.44 | +0.01 / +0.07 / +0.04 / 0 % / 0 % | **+0.18** / +0.98 / +0.19 / −1.2 % / 0 % |
| pan | 256 | 35.80 | +0.01 / +0.14 / +0.01 / −0.2 % / 0 % | +0.01 / +0.70 / **−0.17** / −1.3 % / 0 % |
| thin | 256 | 35.93 | +0.00 / +0.00 / +0.00 / 0 % / 0 % | +0.02 / +0.91 / +0.02 / −1.4 % / 0 % |
| cut | 256 | 34.81 | +0.00 / +0.02 / +0.00 / 0 % / 0 % | +0.16 / +1.21 / +0.02 / −3.1 % / −1.1 % |
| object | 256 | 35.11 | +0.01 / +0.19 / +0.12 / −0.2 % / **−6.3 %** | +0.01 / +0.19 / **−0.15** / −0.2 % / −6.3 % |
| **7 paths** (mean MSE) | | 36.20 | **+0.01** | **+0.08** |

Against the 256-spp references orbit / glossy read +0.10 / +0.09 for `'dual'` (the gaps widen 1.7–2× at 4096 spp, as
E-1 found for specular). No other roughness bin moves by more than ±0.06 dB.

**Real scene, SSR** (kept apart: three's stochastic SSR, **not demodulated**, ray length × three's dominant factor as
the hit distance, misses = 0; 8 captures, 960×540, specular replayed alone, `score-captures.mjs`):

| capture | svgf-auto pooled / FLIP / boil | hit test: Δ pooled, FLIP, boil | dual + hit: Δ pooled, FLIP, boil |
|---|---|---|---|
| three-orbit | 45.32 / 0.0384 / 0.00133 | +0.00, −0.1 %, +0.8 % | +0.05, −1.9 %, +1.3 % |
| three-pan | 47.58 / 0.0359 / 0.00146 | +0.02, −0.4 %, +0.4 % | +0.09, −1.2 %, +1.9 % |
| bistro-orbit | 46.69 / 0.0486 / 0.00111 | +0.00, −0.0 %, +0.9 % | +0.01, −0.2 %, +0.9 % |
| bistro-pan | 43.87 / 0.0552 / 0.00132 | +0.00, −0.1 %, +0.5 % | +0.07, −1.1 %, +0.9 % |
| **bistro-move** | 49.61 / 0.0402 / 0.00041 | −0.04, +0.2 %, **+16.4 %** | −0.04, +0.2 %, **+16.4 %** |
| sponza-orbit | 50.40 / 0.0427 / 0.00066 | +0.08, −0.1 %, +2.1 % | +0.09, −0.1 %, +2.0 % |
| sponza-pan | 52.04 / 0.0379 / 0.00053 | +0.09, −0.1 %, −0.9 % | +0.09, −0.1 %, −0.9 % |
| **sponza-move** | 50.95 / 0.0419 / 0.00035 | −0.04, +0.1 %, **+15.8 %** | −0.05, +0.1 %, **+15.6 %** |
| **8 captures** (mean MSE) | 47.46 | +0.01 | +0.05 |

On the two captures with a moving object the hit test does what it is for (it drops history where the reflected
object moved) and the SSR signal is noisy there, so that history was hiding noise: boil +16 % on a very quiet base
(4 × 10⁻⁴, the reference's own boil is ~6–8 × 10⁻⁴), pooled −0.04 dB.

**Cost** (1080p solo bench, `orbit`, specular alone, 200 frames, 3 alternating rounds after a warm-up page, quiet GPU
held under the lock; median of round medians):

| config | total ms (median of 3 rounds) | fastest frame | temporal pass | Δ total |
|---|---|---|---|---|
| svgf-auto | 2.62 | 2.32 | 0.38 | |
| + `reflectionHitTest` | 3.00 | 2.65 | 0.72 | **+14.5 %** (+0.38 ms) |
| + `'dual'` + hit test | 3.44 | 2.74 | 1.16 | **+31 %** (+0.82 ms) |

Both over rule 9's +10 % for the specular denoiser alone. The added work is the 3×3 hit-distance statistics (9 hit + 9
geometry loads), the rgba32float moments, and for `'dual'` the virtual footprint, the curvature and the 3×3 input
mean. In a joint diffuse + specular denoiser (~4.2 ms) the hit test's +0.38 ms would be ~+9 %: an estimate, not
measured.

**Default-path identity**: every SVGF pass (temporal, variance, à-trous; diffuse, specular, joint) generates
byte-identical WGSL with the options off (both module versions dumped in Node and compared with `cmp`), and a `std540-orbit` replay of `svgf-auto` (diffuse + specular, 16 frames) gives byte-identical `.f32`
outputs before and after (32 / 32 files).

**Verdict (rule 9):** neither option passes for default adoption. Both fail the **boil** clause on the real-scene
moving-object captures (+16 %) and the **cost** clause (above); `'dual'` also loses 0.15–0.17 dB in the disoccluded
region on `pan` / `object` (not a rule-9 clause, noted). On quality alone the hit test is level everywhere and gains
only where reflections move at zero parallax; `'dual'` + hit test is +0.08 dB over the 7 paths (+0.75…+1.21 dB on
near-mirrors on 5 of them) and +0.05 dB on the real scenes. They stay options.

## 7. Decisions for Dennis

1. **No default change proposed.** The shipped default already tracks mirrors under camera motion; its remaining
   reflection artefacts are short (3–6 px trails at zero parallax, ~1 px glossy drag). Both options fail rule 9 on
   boil (real-scene moving objects, +16 %) and cost. Recommendation: keep them opt-in and document them in the
   README as "for scenes where reflected objects or mirrors move" (`reflectionHitTest`) and "for glossy mirrors under
   camera motion" (`'dual'`). Dennis: agree, or ask for a cheaper variant before a second A/B?
2. **Is +16 % boil acceptable when it is the cost of removing a trail?** On the two real moving-object captures the hit
   test trades history (lag) for noise exactly where the reflection changed; rule 9 counts that as a regression. If
   Dennis wants trail-free reflections over quietness there, the hit test is the option; if not, nothing to do.
3. **Recurrent filter, virtual motion** (not the default): its leading ghost and duplicate images on clean mirrors
   are a real defect of the opt-in filter (§3). The same per-tap hit-distance test, applied to its virtual footprint
   (`virt{i}`: drop the tap instead of falling back to 3 frames of history), is the obvious candidate; filed for the
   recurrent owner (TASKS), not done here.
4. **Native comparison**: the six `rm540-*` captures (CAPTURES.md, 13.1 GB, not written) would show how native
   REBLUR / RELAX specular handle the same zero-parallax and glossy cases (probe request in TASKS). Worth writing only
   when the Windows harness has time.
5. **SSR vs traced**: everything above the real-scene table is traced, demodulated specular with true hit distances.
   The real scenes are SSR; a traced real-scene specular (TASKS item) would tell whether the SSR boil result holds.


## 8. Setup and reproduction

| | |
|---|---|
| package | `denoiser/realtime` at HEAD 9c00359 (unchanged since f22af56) + the options, pinned in a scratch snapshot |
| test bed | `examples/realtime-denoiser` with the reflect build (5053015) |
| reflection paths | 960×540, 72 frames, blue noise, 256-spp references (mirrors), 4096-spp (roughness sweep), FLIP every 6 frames |
| standard paths | 1080p, 96 frames; orbit / light / glossy against 4096-spp references (+ the standard 256-spp set, E-1 setup) |
| real scene | SSR captures `three-*`, `bistro-*`, `sponza-*` (specular **not demodulated**, SSR ray length as hit distance), replayed specular-only, `score-captures.mjs` |

```sh
# one reflection path, every specular configuration in one page (results.reflect = the oracle metrics)
node examples/realtime-denoiser/run-headless.mjs --json=rm-obj-plane.json \
  "signal=specular&mode=eval&path=rm-obj-plane&refspp=256&flipEvery=6&denoiser=svgf-auto,svgf-auto@reflectionHitTest=1,svgf-auto@reflectionReprojection=dual@reflectionHitTest=1,svgf,recurrent-specular,recurrent-specular@r.virtualMotion=false,ffx-reflections,accumulate-32"
node examples/realtime-denoiser/rm-table.mjs <dir of such JSON>          # oracle / marker / full-frame tables
node examples/realtime-denoiser/rm-crops.mjs rm-obj-plane.json --marker 1 --frames 24,41 --out crop.png
```

Data: [data/reflection-motion/](data/reflection-motion/) (`b1/` reproduction, `b2/` candidates, `b2-variants/` the
dropped variants, `b3/` rule 9; JSON without crops, tables as `.md`, `delta.mjs` for the Δ tables).
