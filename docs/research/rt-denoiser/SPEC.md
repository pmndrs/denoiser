# SPEC v0.1: our real-time denoisers (`denoiser/realtime`)

_v0.1, 2026-10-25, spec author (RULES.md rule 8: may not see NRD code; writes our design).
Status: **provisional until Dennis reviews** (TASKS T0.1)._

**Changelog**
- **v0 → v0.1 (2026-10-25):** the text now describes what was built and measured: M1
  (SVGF / A-SVGF), M2 (recurrent diffuse), M4 (shadows). Each measured deviation sits in its
  section as a **v0.1** note: old value → new value, the number, the results doc. §7
  (shadows) is rewritten as built. §10 has measured memory and ms against PLAN §8. §12
  (review list) is rewritten; its short form is §0. Recurrent specular (§5.6) stays as
  designed because T3 is implementing it now. Occlusion (§8, M5), SH/SG (M7) and
  translucent shadows (M8) are not built.
- v0 (2026-10-24): first version, written before any code.

This is our algorithm, written from [sources/](sources/) and the papers they cite. Every
pass and constant is traced in [PROVENANCE.md](PROVENANCE.md). Rules that shaped it:

- **RTG II ch. 49 listings are not used.** `sources/reblur.md` transcribes several formulas
  from the chapter's numbered listings (49-2, 49-4, 49-7, 49-8, 49-9). Because those
  listings may mirror NRD code, this spec designs its own functions from the chapter's
  **prose** properties instead, and says so at each place. Formulas from public talk slides
  (GTC 2020, Metro 2019) are used where cited.
- Names: no ReBLUR / ReLAX / SIGMA / NRD in our API or pass names (rule 6). Our two filter
  families are called **`svgf`** and **`recurrent`**.
- Priorities: performance > quality > fidelity to NRD (PLAN §1).

How to read: `D1`…`D16` are the decisions for the 16 open items in
[sources/reblur.md §7](sources/reblur.md) (same numbering). `C-`, `F-`, `S-`, `R-`, `SH-`,
`O-` number our other decisions (core, front end, SVGF, recurrent, shadows, occlusion).
**"Tune: [a, b]"** marks a guess with the range to sweep on captures; the first value is
the default. Everything in "our design" is ours to change.

Evidence keys for v0.1 notes: **M1** = [results/M1.md](results/M1.md), **M4** =
[results/M4.md](results/M4.md), **README** = `packages/denoiser-realtime/README.md`, **TASKS**
= the implementers' "Found along the way" reports. "Test bed" = `examples/realtime-denoiser`
at 1920×1080, 7 stress paths, 96 frames, blue-noise sampling, 256-spp references, mean of
per-frame PSNR on tonemapped demodulated values. "Dev page" = the package's synthetic scene
(direct point lights, exact truth + injected noise). All ms are Apple M5 Pro, 1080p.

---

## 0. For the review (read first)

### 0.1 State of each part

| part | SPEC | built | status |
|---|---|---|---|
| shared temporal core | §3 | yes, used by all three filters | v0.1: Catmull-Rom gating (C-8), anti-lag window and detector (C-10) |
| SVGF / A-SVGF | §4 | yes (M1) | provisional; defaults set from M1 |
| recurrent diffuse | §5 | yes (M2) | provisional; v0.1 deviations folded in; **see review item 1** |
| recurrent specular | §5.6 | **in progress (T3)** | **in flux**: virtual motion and budget work running now; section left as designed |
| shadows | §7 | yes (M4) | provisional; rewritten as built |
| occlusion | §8 | no (M5) | outline only |
| SH/SG directional | §8.5 | no (M7) | not specified |
| translucent shadows | §7.9 | no (M8) | not specified |

**Where we stand** (test bed, mean of 7 paths; cost at 1080p on the M5 Pro):

| | diffuse PSNR | specular PSNR | diffuse + specular ms | target |
|---|---|---|---|---|
| SVGF, `feedback: false` (default) | 39.00 | 34.09 | 4.20 (test-bed replay), 3.98 (dev page) | ≤ 4 ms |
| A-SVGF `antiLag: 'auto'` | **39.27** | **35.32** | 6.31 | |
| recurrent diffuse | 38.42 | (T3) | 2.92 diffuse only; 5.41 both recurrent (dev page, in flux) | |
| shadows, ours / FFX (visibility, not diffuse) | PSNR 38.89 / 33.57, penumbra 28.12 / 23.50 | | shadows only: 0.43–0.64 / 0.50–0.73 | ≤ 0.6 ms |

Sources: M1 §4 (SVGF rows), README (recurrent per-path table, mean computed here), M4
headline, commit 25c80aa (5.41 ms). The README's claim "recurrent beats A-SVGF on 6 of 7
paths" compares against SVGF with the **old** `feedback: true` default (its SVGF column
matches M1's feedback-on numbers exactly). Against today's defaults, SVGF wins 6 of 7 paths
(review item 1).

### 0.2 Open for review (short; details and numbers in §12)

1. **Is recurrent still the expected default?** Today SVGF (feedback off) beats recurrent
   diffuse on 6 of 7 test-bed paths (−0.58 dB mean vs SVGF, −0.85 vs A-SVGF auto) and costs
   less (2.11–2.18 vs 2.92 ms). Recurrent's case now rests on specular (M3) and native parity.
2. **Default anti-lag for SVGF:** `'off'` (at budget) or `'auto'` (+0.27 / +1.23 dB,
   3-frame light recovery, +2.1 ms).
3. **The 4 ms budget** (diffuse + specular) vs quality: A-SVGF auto is 6.3 ms, both-recurrent
   5.4 ms. Firm target, or a quality preset above it?
4. **Memory over 100 B/px** in every diffuse + specular configuration (recurrent 105.5, SVGF
   132, mixed default ≈ 141). Accept, or cut?
5. **Tuned on the scene it is scored on.** Every default was tuned on one analytic scene.
   Which real scene before the defaults freeze (PLAN §9)?
6. **Shadows taste calls:** fresh-history noise (~3 dB below FFX for ~5 frames after a
   disocclusion), `thin` at 0.64 ms, and the metric-driven "uniform snap".
7. **API shape as built:** `remodulate` + caller-supplied `demodulation` texture, two
   outputs via `dispatchBoth`, A-SVGF `'gradient'` as an input-texture contract.
8. Kept from v0: listing policy, hit-distance curve (AO look), pre-blur strength, glossy
   kernel elongation (M3).

---

## 1. Conventions and inputs

### 1.1 Spaces (from [CAPTURE-FORMAT.md](CAPTURE-FORMAT.md) and `temporal.ts`)

| quantity | convention |
|---|---|
| world / view | three.js: right-handed, +y up, camera looks down −z; **viewZ < 0 in front** |
| linear depth (ours) | `d = −viewZ > 0`. All shader math uses `d`. Sky: `viewZ = −far` or `depth` = far plane value → pixel is **sky**: skipped by every pass, output 0 |
| pixel / uv | pixel `p = (px, py)`, x right, y down, row 0 top; `uv = (p + 0.5)/size` |
| NDC | `ndc = (2·uv.x − 1, 1 − 2·uv.y)`, +y up |
| jitter `j` | pixels, x right / y down. Sample position `uv_s = (p + 0.5 + j)/size`, `ndc_s` from it |
| motion `m` | NDC delta **current sample − previous**, so `uv_prev = uv_s + (−0.5·m.x, +0.5·m.y)` |
| motion z `mz` (optional) | `viewZprev − viewZ` (both negative in front) → `d_prev = d − mz` |
| roughness | perceptual `r`; GGX `α = r²` |
| matrices | column-major (three `Matrix4.elements`); projection `P` **unjittered** |

**C-1 Position reconstruction.** View-space position of pixel `p` with depth `d`, using
the sample NDC (jitter included, as the capture format defines `P`):

```
perspective (P[15] == 0):  Xv = ( d·(ndc_s.x + P[8]) / P[0],  d·(ndc_s.y + P[9]) / P[5],  −d )
orthographic (P[15] == 1): Xv = ( (ndc_s.x − P[12]) / P[0],  (ndc_s.y − P[13]) / P[5],  −d )
```

Camera-relative world position `X = Rc · Xv`, with `Rc` the upper 3×3 of `inverse(view)`
(world-space offsets from the camera; world `X_w = X + camPos`). Host code computes
`Rc`, `Rc_prev`, `camPos`, `camPos_prev`, `Δcam = camPos − camPos_prev`, and
`R_prev` = upper 3×3 of `prevView` once per frame. The view distance is `‖X‖`.

**C-2 Depth source.** `guides.viewZ` when given (exact). Otherwise linearize `guides.depth`
with `P` (handles `reversedDepth`). Device depth and viewZ are both in the capture; the
replay passes `viewZ`.

**C-3 Previous depth.** With `guides.motionZ`: `d_prev = d − mz`. Without it (static-world
assumption, exact for camera-only motion): `d_prev = −(prevView · (X_w, 1)).z`. Objects
that move in depth without `motionZ` may fail the disocclusion test and lose history
(documented limitation, no artifact).

### 1.2 Inputs per frame

| input | where | used by |
|---|---|---|
| `guides.depth` / `guides.viewZ`, `guides.normal` (world, unit), `guides.motion`, `guides.motionZ?` | `FrameGuides` | all |
| `guides.roughness` | `FrameGuides` | specular; diffuse treats r = 1 |
| `guides.albedo`, demodulation factor | `FrameGuides.albedo`; per-signal `inputs.demodulation` texture | only for remodulated output (`remodulate: true`) |
| radiance (rgb), `hitDistance` | `DiffuseInputs`, `SpecularInputs` (`DiffuseSpecularInputs` for both) | diffuse / specular |
| `visibility`, `hitDistance` (occluder distance), light | `ShadowInputs` (+ `light`, built) | shadows |
| camera | `FrameCamera` (current + previous view, unjittered projection, jitter, near/far, position) | all |
| reset | `resetHistory()` or capture `frame.reset` | all |

**v0.1: API as built** (v0 proposed `FrameGuides.f0?`, `inputDemodulated` and
`output: 'demodulated' | 'remodulated'`):
- Inputs are always demodulated (captures are). No in-denoiser demodulation, so no `f0`.
- `remodulate: boolean` (default `false`). When true, the last pass multiplies by
  `inputs.demodulation` (the factor the caller divided by; diffuse falls back to
  `guides.albedo`). The caller owns E(f0, r, NoV), so the denoiser needs no specular term.
  `remodulate: true` without a factor texture is an explicit error. (TASKS, svgf deviation 7.)
- `ShadowInputs.light?: ShadowLight` (`{ type: 'sphere', position, radius } | { type:
  'directional', direction, angularRadius }`, the capture's `lights` fields), additive in
  `denoiser-core` (faade1e).
- Diffuse + specular: `DiffuseSpecularDenoiser.dispatchBoth()` returns `{ diffuse, specular }`;
  `dispatch()` returns diffuse so the class still conforms to `TemporalDenoiser`.
- `FrameGuides.viewZ?` and `FrameGuides.motionZ?` (2.5D) are additive too.

**C-4 Hit distance input.** World units, primary segment excluded. `0` means **miss**
(ray escaped) and is treated as `h = ∞`. The capture format also uses 0 for "lobe not
sampled"; v0 assumes every pixel traces both lobes (our test bed does), so 0 is always a
miss. If probabilistic lobe selection is ever used, "not sampled" needs its own value
(proposed: negative), and the pre-blur fills those pixels from neighbours.
**v0.1:** diffuse `hitDistance` is optional in `recurrent`. Without it ĥ = 1 everywhere, so
the contact clamp (D1b, R-5) and the AO output are off. `svgf` ignores hit distance.

### 1.3 Internal guide texture `G` (both families)

**C-5.** A `prepare` pass packs the current guides once into `G` (`rg32uint`, 8 B/px), the
same layout every later pass reads (one load per tap instead of three textures in caller
formats). `G_prev` is last frame's `G` (ping-pong, 2 × 8 B).

```
G.x = bitcast<u32>(d)            // f32 linear depth; 0 = sky
G.y = oct normal (2 × 12 bits, signed octahedral) | roughness (8 bits, unorm of perceptual r)
```

Octahedral encoding: Cigolle et al., "A Survey of Efficient Representations for Independent
Unit Vectors", JCGT 3(2), 2014. 12 bits per component is well under 0.1° error.

**v0.1:** the prepass also writes a **depth-slope** texture (`r32uint`, 2 × f16, current
frame only, 4 B/px): per axis, the one-sided depth difference with the smaller magnitude.
SVGF's depth weight (S-3) reads it at the centre instead of 4 neighbour loads per pass. A
pipeline with no SVGF signal skips it: prepass 0.18 → 0.10 ms (commit 25c80aa). Shadows
pack their own `G` pair inside their temporal pass (§7) instead of sharing this prepass.

---

## 2. Front end (signal preparation)

Runs per tap wherever a pass reads a raw input (pre-blur in `recurrent`, temporal
accumulation in `svgf`), so it costs no dispatch.

**F-1 Sanitize.** Non-finite → 0. Negative → 0. Clamp each channel to `maxRadiance`
(default 1e4 in demodulated units, leaving fp16 headroom for sums). Tune: [1e3, 6e4]. This is a safety
clamp, not the firefly filter (D9).

**F-2 Demodulation** (only when `inputDemodulated = false`; captures arrive demodulated).
**v0.1: not built.** Inputs must arrive demodulated and remodulation multiplies by the
caller's factor texture (§1.2). The definitions below stay as the reference for what a
caller should divide by:

- Diffuse: `c_d = L_d / max(ρ, 1e-3)` per channel (SVGF §3 "Reconstruction"; floor from
  Zimmer 2015 §3).
- Specular: `c_s = L_s / max(E, 1e-3)` per channel, with `E(f0, r, NdotV)` = the split-sum
  term (Karis 2013 Eq. 7–8) in Karis 2014's analytic mobile approximation, f90 = 1, exactly
  as written in CAPTURE-FORMAT §"Specular demodulation term" (`NdotV = clamp(n·v, 1e-4, 1)`,
  `v = normalize(−X)`). Chosen because it is public, LUT-free (one less texture and
  binding) and is the term our captures already use.
- Remodulation (when `output = 'remodulated'`) multiplies by the same `ρ` / `E`, fused into
  the last pass.

**F-3 Hit-distance normalization (D5a).** Our curve. The stored, filtered quantity is

```
ĥ = h / (h + h_scale(d)),      h_scale(d) = a + b·d,      miss (h = ∞) → ĥ = 1
h = h_scale(d) · ĥ / (1 − ĥ)   (inverse, ĥ clamped to ≤ 0.999)
```

with `a = hitDistanceScale` (default **1.0** world unit; tune: [0.25, 5]) and
`b = hitDistanceViewScale` (default **0.05**; tune: [0, 0.2]). Rationale:

- Rational instead of `saturate(h/h_max)` (GTC20 s.9): it never clips, so far reflection
  distances survive for virtual motion (mirrors need them), fp16 resolves ratios up to
  ~2000·h_scale, and `ĥ` stays in [0,1] for linear filtering.
- `ĥ` doubles as occlusion: its denoised mean is an AO/SO value with a `1/(1 + h/h_scale)`
  distance falloff (GTC20 s.9 "normalized hit distance = AO/SO"; the falloff shape is ours).
  At `h = h_scale`, `ĥ = 0.5`.
- `b·d` keeps the scale proportional to the screen footprint at distance (a 1-unit scale
  is meaningless 200 units away). Roughness does not enter (the rational curve removes the
  precision reason NRD-style curves would need it for).
- Same curve for diffuse and specular, so one `h_scale` per pixel.

Denormalizing a **filtered** `ĥ` gives a hit distance biased toward near hits (a harmonic
-like mean). That is the conservative direction for radius and contact hardening.

**F-4 Firefly handling.** Three layers, none of which removes energy in the main path
(RTG2 §49.5.1: redistribute, don't suppress):
1. F-1 safety clamp.
2. Pre-blur redistributes outliers over its kernel (recurrent) / à-trous does (svgf).
3. Rank-based anti-firefly on the accumulated signal in the history-fix pass (D9).

---

## 3. Shared temporal core

Used by both families. One WGSL module (`temporal-core.wgsl`) with these functions.

### 3.1 Reprojection (C-6)

Per pixel with `d > 0`:
1. `uv_prev = uv_s + (−0.5·m.x, +0.5·m.y)`; `d_prev` from C-3.
2. `Xp = Xv_prev(uv_prev, d_prev)` with `prevProjection` (C-1 formulas): the current surface
   point in **previous view space**. All disocclusion math happens in this one frame
   (resolves D6b: no mixing of camera-relative frames).
3. Normal in previous view space: `np = R_prev · n`.
4. Off-screen (`uv_prev` outside [0,1]²) → every tap invalid.

### 3.2 Per-tap plane-distance test (C-7, D6)

For a previous-frame texel `t` (decoded from `G_prev`: `d_t`, `n_t`):

```
P_t   = Xv_prev(uv(t), d_t)                      // texel centre, prevProjection
n̄     = normalize(np + R_prev · n_t)             // pairwise-averaged normal (RTG2 p.831 prose)
δ_t   = |dot(P_t − Xp, n̄)| / ‖Xp‖
valid = inside(t) ∧ d_t > 0 ∧ dot(n, n_t) > 0 ∧ δ_t < τ ∧ [svgf only: dot(n, n_t) > cosN]
```

- `τ = disocclusionThreshold`, default **0.01** (1 %), tune: [0.005, 0.015] (RTG2 p.831
  "around 0.5–1.5 %").
- `dot(n, n_t) > 0` rejects backfacing taps (RTG2 p.832).
- Plane distance (not a depth ratio) keeps grazing surfaces valid: neighbours on a tilted
  plane lie on the plane (RTG2 §49.6; Metro s.59).
- Previous texels are reconstructed at their **centres** (previous jitter is unknown to the
  texel). The sub-pixel error is far below τ at any normal angle the plane test accepts;
  revisit if captures with large jitter show false rejections.
- `svgf` adds the paper's normal test, `cosN = 0.95` (A-SVGF code `TemporalAccumulation.frag`),
  tune: [0.8, 0.98]. `recurrent` doesn't (RTG2 uses plane distance + backfacing only).

### 3.3 History fetch (C-8)

Bilinear footprint: `f = uv_prev·size − 0.5`, `t0 = floor(f)`, `w = f − t0`; taps
`t0 + {(0,0),(1,0),(0,1),(1,1)}` with bilinear weights `b_i`.

- **Custom-weighted bilinear** (GTC20 s.27–30, RTG2 p.832): `H = Σ b_i v_i H_i / Σ b_i v_i`,
  `v_i ∈ {0,1}` from C-7. History exists if **any** `v_i = 1` (RTG2 §49.7). Guard: use
  `max(b_i, 1e-3)` so a valid tap with a tiny bilinear weight still counts.
- **Catmull-Rom** (RTG2 §49.7) when **all 16** texels of the 4×4 footprint (`t0 − 1 … t0 + 2`)
  are valid (D6c: we run the plane test on all 16; their `G_prev` values come from 16
  `textureLoad`s or 8 `textureGather`s, 2 components each). Evaluate with the 9-tap
  bilinear decomposition (Sigg & Hadwiger, *GPU Gems 2* ch. 20) on a linear sampler (history
  textures are `rgba16float`, filterable). Then clamp per channel to [min, max] of the 4
  inner texels and to ≥ 0 (no ringing, no negatives; our addition).
- Per-signal option `catmullRom`: `recurrent` **on** (RTG2), `svgf` **off** (paper uses
  bilinear; its history is already the smooth à-trous output).
- Scalar per-pixel history (A, moments) always uses the custom-weighted bilinear.

**v0.1 (all three filters): Catmull-Rom is gated on the 4 inner taps, not 16.** When all 4
taps of the bilinear footprint pass C-7, evaluate the 5-fetch Catmull-Rom (bilinear taps,
Jimenez 2016) and clamp it per channel to the 4 taps' [min, max]. The clamp removes the
ringing an invalid outer ring could cause, so the 16 plane tests buy nothing measurable for
their cost. Measured use of the option: `svgf` off (`historyFilter: 'catmull-rom'`: +0.03 …
+0.07 dB, slightly more flicker); `recurrent` on, in temporal and stabilization; shadows on
(+0.65 dB on `orbit`, M4 §3: repeated bilinear resampling blurs sharp penumbrae). Recurrent
specular's virtual history stays bilinear (Catmull-Rom +0.04 dB for 0.13 ms, commit 25c80aa).
Sources: TASKS (svgf 3, recurrent 8), M4 §7.2.

### 3.4 History length A (C-9, D14)

`A` = frames accumulated in the output **minus one** (0 = current frame only).

```
A_hist = valid ? min(A_prev_reprojected, A_cap) : −1
A      = A_hist + 1                     // 0 after a disocclusion
out    = lerp(H, C, 1/(1 + A))          // RTG2 Eq. 49.1; exact running mean (GTC20 s.26)
```

- `A_cap = maxAccumulatedFrames`, default **31** (so `1/(1+A)` ≥ 1/32), tune: [15, 63]
  (RTG2 Fig. 49-3: up to 64; GTC20: up to 32).
- Fractional A is allowed (anti-lag reduces it, A-SVGF sets `A = 1/α − 1`).
- Storage: `recurrent` packs A into the `data` texture (§5.12); `svgf` stores it in the
  history colour's alpha (A-SVGF code layout). fp16 represents every integer ≤ 2048 exactly.
- A ↔ α conversions in f32; `α = 1/(1 + max(A, 0))`.

### 3.5 Anti-lag without renderer help (C-10, D11) — our design

Lighting changes that motion vectors don't see (moving lights, moving shadows, toggles).
A-SVGF's gradients need the renderer's cooperation (§4.6); this one doesn't. It is the
"clamp toward a faster history" idea (RTG2 p.830; RTG2 p.824 for ReLAX) made concrete:

- A **fast history** per signal, accumulated in the same reprojection step with a short cap
  `A_fast` (default **3** → α ≥ 1/4; tune: [2, 7]). To fit the storage budget it keeps
  **luminance and ĥ only** (4 scalars for diffuse + specular, one `rgba16float`):
  `F = (lum_d, ĥ_d, lum_s, ĥ_s)`.
- In the history-fix pass (after accumulation), per signal, with `L_s` = luminance of the
  slow (accumulated) value, and `μ_f`, `σ_f` = mean and std of fast luminance over the 3×3
  neighbourhood (geometry-valid neighbours only, same plane test as the blur's w_geom):

```
lo = μ_f − γ·σ_f,  hi = μ_f + γ·σ_f                  γ = antiLagSigma, default 2.0, tune [1, 3]
L_c  = clamp(L_s, lo, hi)
C_s ← C_s · (L_c / max(L_s, 1e-6))                     // luminance clamp, keeps chroma
e    = |L_s − L_c| / (max(L_s, L_c) + ε_L)             // relative excess, ε_L = 1e-3
c_I  = saturate(1 − e / e_max)                         e_max = 0.5, tune [0.2, 1]
```

  The same for `ĥ` (no relative division, ĥ is already in [0,1]):
  `e_h = |ĥ_s − clamp(ĥ_s, μ_h ± γ·σ_h)|`, `c_H = saturate(1 − e_h / 0.2)` (tune [0.1, 0.4]).
- **Combine (D11d):** `c = min(c_I, c_H)` (the more alarmed detector wins).
  **Reduce A:** `A ← lerp(min(A, A_fast), A, c)`. Accumulation continues from the reduced A
  next frame (RTG2 §49.11 behaviour).
- Only where `A > A_fast` (below that, slow ≈ fast).
- Applies to both signals in `recurrent`. In `svgf` the A-SVGF gradient path is the anti-lag
  (S-7); this core anti-lag is an option there (`antiLag: 'fast'`), default off for M1.

**v0.1: what was built and why (recurrent; TASKS recurrent 1, 2, 9).**

- **Window = standard error, γ = 1** (v0: γ = 2 spreads). `lo/hi = μ_f ∓ γ·σ_f/√N`, with N =
  the number of geometry-valid pixels in the 3×3 (centre included), for luminance and ĥ.
  Why: a window of γσ around the fast EMA can only move the slow value as fast as the fast
  EMA moves, minus a γσ offset. The standard error of the 3×3 mean is the noise of μ_f
  itself. Test bed +0.37 dB mean; dev-page light switch 29.0 → 34.3 dB 12 frames after.
  `antiLagStandardError: false` restores v0.
- **C-10b current-frame detector** (new, in R2 temporal, before accumulation). The 3×3 mean
  μ of this frame's **pre-blurred** luminance and ĥ (geometry-valid pixels, N ≥ 4) is
  compared with the reprojected history `H` in standard errors `se` of that mean:

  ```
  r_I = |μ_l − lum(H)| / (3·se_l + 0.02·max(lum(H), μ_l) + 1e-4)
  r_H = |μ_h − H.ĥ|    / (3·se_h + 0.05)
  A   ← lerp(min(A, A_fast), A, saturate(2 − max(r_I, r_H)))
  ```

  It fires on the first frame of a change, where the fast history (C-10) still lags by its
  own EMA. Dev-page light switch +2–3 dB over C-10 alone; test bed ±0.03 dB (no cost on
  static content). The floor is `A_fast`, not 0: shortening to 0 cost 1.4–1.8 dB on static
  scenes (blur bleeding at A = 0). Options `antiLagCurrentSigma` (3, 0 = off),
  `antiLagCurrentHitTolerance` (0.05).
- **Neighbourhood validity** in C-10, C-10b, the anti-firefly (D9) and stabilization (R7) =
  plane distance at `τ_g(A = 0)` = 2 %, no normal test (cost).
- In `svgf` the `'fast'` option was **not built**; `antiLag: 'auto'` (S-7b, our renderer-free
  gradient) took its place.

### 3.6 History repair from mips (C-11)

Defined with the recurrent pipeline (§5.8a, D7); usable by `svgf` as an experiment
(default off there: the paper's spatial-variance fallback covers fresh pixels).
**v0.1:** recurrent only; not built for `svgf` (its disoccluded-pixel PSNR is already within
0.1 dB of its overall PSNR, M1 §8.7).

### 3.7 Reset (C-12)

`resetHistory()`, a capture's `reset: true`, the first frame after `configure`, and a size
change all set a uniform `historyValid = 0` for one frame. Every history read then counts
as invalid (A = 0 everywhere, fast and stabilization histories ignored). No texture clears
are needed; outputs are written in full every frame.

---

## 4. Family 1: SVGF + A-SVGF (M1)

Defined by Schied et al. 2017 (SVGF, "S1") and 2018 (A-SVGF, "S2"), the authors' BSD-3
code ("S3", `svgf/asvgf_zip/`), and the upgrade list in
[sources/ssgi-svgf-review.md](sources/ssgi-svgf-review.md). The structure is the paper's and
the ssgiDev port's; this section fixes parameters. Diffuse and specular run in the **same
dispatches** (two signals per thread).

### 4.1 Pass list

| # | pass | in | out | storage textures |
|---|---|---|---|---|
| S0 | `prepare` | guides | `G` | 1 |
| S1 | `temporal` | inputs (front end F-1/F-2), `G`, `G_prev`, `hist_prev` ×2, `moments_prev` ×2 | `accum` ×2 (rgb, A), `moments` ×2 | 4 |
| S2 | `variance` | `accum` ×2, `moments` ×2, `G` | `V` ×2 (rgb, σ) | 2 |
| S3 | `atrous` k = 0 | `V` ×2, `G` | `hist_new` ×2 (rgb, A): next frame's colour history and k = 1's input | 2 |
| S4–S7 | `atrous` k = 1…4 | ping-pong | last one writes the output (remodulated if asked) | 2 |
| (A-SVGF) G1 | `gradientProject` | `G_prev`, `G`, camera | `gradientRequests` (storage **buffer**, atomics) | 0 |
| (A-SVGF) G2 | `gradientCreate` | requests, inputs, `lum_prev` | `grad` ping (rgba32f, 1/3 res) ×2, `lum_cur` | 3 |
| (A-SVGF) G3–G7 | `gradientAtrous` ×5 | `grad` ping-pong | filtered gradient | 2 |

Totals: **8 dispatches** for diffuse + specular, **15** with A-SVGF (G1 runs between the
renderer's primary-visibility pass and its shading pass, see S-8). All ≤ 4 storage textures.

**v0.1: pass list as built** (`src/svgf.ts`, `src/shaders/svgf.ts`, `src/shaders/gradient.ts`):

| pass | what | notes |
|---|---|---|
| `prepass` | `G` pair + depth slope (§1.3) | shared by both signals |
| `gradient_create` | per 3×3 stratum: (δ, Δ, var δ, valid), (mean l, var l, z, ∣∇z∣) | anti-lag only; 9×9 workgroups, one pixel per thread, shared-memory reduction (2.5× faster than a thread per stratum) |
| `gradient_atrous_0..4` | S2 reconstruction at stratum resolution | anti-lag only |
| `gradient_lambda` | λ, max over 3×3 strata, written once at 1/3 resolution | anti-lag only |
| `temporal` | as S-1 | |
| `variance` | as S-2 | |
| `atrous_0..4` | as S-3; the last writes the output | iteration 0 also writes the history only with `feedback: true` |

8 dispatches without anti-lag, 15 with it. There is no in-denoiser G1: in `'gradient'` mode
the renderer forward-projects and re-shades (S-8 as built). `DiffuseSpecularDenoiser` runs both
signals per thread in every pass (v0 §4.1) unless their structural options differ (`kernel`,
`atrousIterations`, `feedback`, `antiLag`, `gradientIterations`); then it builds two
pipelines. Joint vs two single-signal denoisers: 4.20 vs 5.1 ms (M1 §6).

### 4.2 S-1 Temporal accumulation (S1 §4.1, S3)

- Reprojection, per-tap validity (C-7 with `cosN`), custom-weighted bilinear (C-8). No 3×3
  fallback (S3 omits it; tune later if foliage-like content suffers).
- `α_c = max(α_min, 1/(1+A))`, `A` per C-9 with `A_cap = 63` (S3 caps at 64 frames).
  `α_min = 0.2` (S1 p.5); **0.1 when A-SVGF is on** (S2 p.10).
- Moments of luminance `l = dot(c, (0.2126, 0.7152, 0.0722))`: `m = (l, l²)`,
  `α_m = max(α_mom, 1/(1+A))`, `α_mom` default **= α_min** (S1 §4.2 accumulates moments "the
  same way"), tune: [α_min, 0.6] (0.6 is S3's choice).
- Formats: `accum`/`hist` `rgba16float` (alpha = A), `moments` **`rg32float`** (review
  upgrade; l² overflows fp16).
- Specular (T1.3): surface reprojection only in M1, with
  `α_c = max(α_min, 1/(1 + min(A, A_spec)))`, `A_spec` from R-8 (§5.6). Virtual motion is M3.

**v0.1 (S-1 as built):**
- **3×3 fallback kept** (v0 dropped it, following S3). When no 2×2 tap has weight > 0.01,
  the 3×3 texels around the reprojected point that pass C-7 are averaged with equal weights
  (S1 §4.1, for thin geometry). Not measured separately; it is the paper's behaviour.
  (TASKS svgf 4.)
- `historyFilter` option: `'bilinear'` (default) or `'catmull-rom'` with the 4-tap gating of
  C-8 v0.1 (+0.03 … +0.07 dB, slightly more flicker, so off). (TASKS svgf 3.)
- `A_cap`: `maxHistory = 64` frames including the current one (= A 63), as v0.
- **α_min is shared by both signals.** M1 §4 measured that with `antiLag: 'off'` diffuse wants
  0.1 (+1.2 dB) while specular must stay 0.2 (0.1 costs −1.5 dB mean, −2.8 dB on `orbit`:
  ghosting of view-dependent reflections). A per-signal α_min is non-structural (free) and
  recommended, **not applied yet** (TASKS). With `antiLag: 'auto'`, α_min ≤ 0.1 is inert: λ
  keeps 1/n ≥ ~0.1 everywhere (0.05 and 0.1 give identical output within 0.02 dB), so even
  static regions never pass ~10 frames of history. Open in TASKS (λ noise floor).

### 4.3 S-2 Variance (S1 §4.2, S3 `EstimateVariance.frag`)

```
σ²_t = max(0, m2 − m1²)
if A < 3:                                         // fewer than 4 frames (S1 p.5)
    σ²_s = spatial estimate (7×7 if A = 0, else 5×5; S3)
           weights: w_z(q) · max(0, n·n_q)^128     (w_z as in S-3, offset in pixels)
           σ²_s = Σw·m2_q / Σw − (Σw·m1_q / Σw)²  (each neighbour's own moments; S3's quirk not copied)
    σ²_s *= 1 + 3·(1 − (A + 1)/4)                  // S3 boost
    σ²   = lerp(σ²_s, σ²_t, saturate(A / 3))       // smooth ramp (review: keep ssgiDev's ramp)
else σ² = σ²_t
V = (accum.rgb, sqrt(σ²))
```

**S-2a.** `V` stores the **standard deviation** in alpha, not the variance, so `rgba16float`
holds HDR values (σ ~ l, while σ² ~ l² overflows fp16). Every consumer squares it in f32.
Our deviation; numerically the paper's quantity.

**v0.1:** the spatial estimate's weights are the à-trous geometry weights of S-3 (depth ×
normal; for specular also the lobe cutoff, roughness and radius terms), not a separate
`n^128`. The specular `variance` pass costs 0.66 ms (0.95 with anti-lag) vs 0.23 ms for
diffuse, the largest single specular pass. Not profiled (TASKS).

### 4.4 S-3 À-trous (S1 §4.3–4.4, Dammertz 2010)

Iteration `k = 0…K−1`, step `s = 2^k`, `K = 5` (S1; tune [4, 5], ssgiDev used 4). Kernel:
B3-spline 5×5, `h = [1/16, 1/4, 3/8, 1/4, 1/16]` outer product (S1 Eq. 1). Option
`kernel: '3x3-box'` (S2 §4, cheaper).

```
q   = 1/d                                               // affine in screen space for planes, like S1's clip depth
w_z = exp(−|q_p − q_t| / (σ_z·|∇q_p · Δ| + ε_q))        σ_z = 1, ε_q = 1e-3·q_p,  Δ = tap offset in pixels
w_n = max(0, n_p·n_t)^σ_n                               σ_n = 128
w_l = exp(−|l_p − l_t| / (σ_l·sqrt(g3x3(σ²)_p) + ε_l))   σ_l = 4, ε_l = 1e-4
[specular only] w_r = 1 − smoothstep(0.01, 0.1, |r_p − r_t|)    (RTG1 ch. 32 Eq. 14)
w   = w_z·w_n·w_l·w_r
C'  = Σ h·w·C_t / Σ h·w           σ²' = Σ h²·w²·σ²_t / (Σ h·w)²     (centre tap included, w = 1)
```

- **∇q** (review upgrade: gradient-scaled depth weight; no derivatives in compute): per axis,
  the one-sided difference of `q` to the left/right (up/down) neighbour with the **smaller**
  magnitude (doesn't straddle silhouettes). Computed from `G` at the centre pixel of each
  pass (4 extra loads), no texture.
- `g3x3` = 3×3 Gaussian `[1,2,1]⊗[1,2,1]/16` of σ² (review upgrade from box; S1 Fig. 5).
- Sky taps: weight 0. NaN guard: weights that are NaN → 0 (S3).
- **Feedback:** iteration 0's output is next frame's colour history (S1 p.5; review: default
  on). Its alpha carries A through from `accum`. Moments history = the unfiltered integrated
  moments.
- The ssgiDev 25 % blend toward a 4-neighbour min/max clamp is kept as an option
  (`neighbourClamp`, default off; measure).
- Remodulation (if asked) fuses into the last iteration (S3).

**v0.1 (S-3 as built; TASKS svgf 1, 6; M1 §4):**

| item | v0 | v0.1 | evidence |
|---|---|---|---|
| kernel | B3 5×5 | **3×3 box** (A-SVGF's); `kernel: '5x5'` kept | 5×5 buys ≤ +0.15 dB (+0.09 svgf, +0.14 auto) for +2 ms per signal (0.65 vs 0.28 ms per iteration); M1 §4 |
| feedback | on (paper) | **off**: next frame's colour history is the temporal output `accum`, not à-trous iteration 0 | +0.6 … +2.6 dB diffuse on all 7 paths, FLIP −24 … −44 %, energy loss −3.5 → −1.2 %, specular +0.1 … +0.8 dB, flicker unchanged, slightly cheaper; M1 §4. With feedback a static view *loses* PSNR over time (`cut`, frames 48 → 59: 39.2 → 36.8 dB) |
| specular normal weight | `max(0, n·n_t)^128` | **lobe cutoff**: `w_n = saturate(1 − θ/(θ_L(α) + 1°))`, with θ/θ0 computed as `sqrt((1 − cos)/(1 − cos θ0))` (no acos per tap); `specularNormalWeight: 'power'` restores v0 | +0.65 dB (TASKS svgf 6). The power form ignores roughness |
| specular radius weight | — | `w *= 1 − smoothstep(10r, 70r, ∣Δp∣)` (RTG1 ch. 32 Eq. 15, r perceptual, Δp in px); `radiusScale` (1; 0 = off) | from the source; not measured in isolation |
| variance prefilter | 3×3 Gaussian of σ² | the 3×3 Gaussian over this iteration's inner taps (exact at stride 1, wider at larger strides) | saves 8 loads per pixel per iteration; our approximation |
| `neighbourClamp` | option | **not built** | — |
| `luminanceVariance: 'mean'` | — | experiment: the accumulated mean's variance drives w_l | lost 0.7–2 dB (LESSONS); off |

Iterations stay at K = 5: 4 saves 0.3 ms per signal but loses up to 0.26 dB and raises
diffuse flicker 15–56 % (M1 §4).

### 4.5 Parameters at a glance

| parameter | default | source | tune |
|---|---|---|---|
| α_min | 0.2 (0.1 with A-SVGF) | S1 p.5, S2 p.10 | per signal recommended (S-1 v0.1) |
| α_mom | = α_min | S1 §4.2 | [α_min, 0.6] |
| A_cap | 63 | S3 | — |
| plane τ / cosN | 0.01 / 0.95 | RTG2 p.831 / S3 | [0.005, 0.015] / [0.8, 0.98] |
| spatial variance below | A < 3 | S1 p.5 | — |
| K, kernel | 5, **3×3 box** (v0.1; v0: B3 5×5) | S2 §4; M1 §4 | measured: keep |
| feedback | **off** (v0.1; v0: on) | M1 §4 | measured: keep |
| σ_z, σ_n, σ_l | 1, 128 (diffuse; specular uses the lobe cutoff), 4 | S1 p.5 | — |
| anti-lag | **`'off'`** (v0.1; `'auto'` = quality option) | §4.6 | review item 2 |

### 4.6 S-7/S-8 A-SVGF: gradient-driven α (S2 §3, S3)

**Renderer contract (S-8).** Gradients need the renderer to re-shade a few previous-frame
surface samples with this frame's lighting and the *same random numbers* (S2 §3.1). Our
denoiser can't do that, so A-SVGF mode is opt-in (`antiLag: 'gradient'`) and requires:

1. The renderer exposes its primary visibility (G-buffer) before shading, so G1 can run
   between the two (the test bed's analytic tracer can split its pass).
2. For every pixel `p` that G1 selected, the renderer shades **the previous frame's surface
   point** of the recorded previous pixel `p_old` (re-derived from that pixel's previous
   primary ray, or the renderer's own stored position), with **`p_old`'s previous-frame RNG
   seed** and current lighting, and writes that result as `p`'s sample (it is a valid sample
   for `p`, S2 p.7).
3. Static-world forward projection only in v0 (we have backward motion only); moving objects
   just don't get gradient samples.

**G1 `gradientProject`** (S3 `GradientForwardProject`): one thread per 3×3 stratum of the
**previous** frame. Pick a pixel in it with a hash of (stratum index, frame) (S3 uses TEA;
any good integer hash, e.g. PCG, Jarzynski & Olano JCGT 2020). Reconstruct its world point
from `G_prev` and the previous camera, project with the current camera, skip if off-screen,
and accept if the current `G` at the landing pixel passes the plane test (C-7) and
`dot(n, n_old) > 0.9` (S3). Then `atomicCompareExchangeWeak(requests[stratum_cur], 0, code)`
(first writer wins; S2 p.7). `code = 0x80000000 | (p_old.y·W + p_old.x) << 4 | slot`, `slot`
= position inside the current stratum (0…8). Requests buffer: `array<atomic<u32>>`,
`⌈W/3⌉·⌈H/3⌉` entries, cleared each frame (a `clearBuffer`).

**G2 `gradientCreate`** (S3 `CreateGradientSamples`), one thread per current stratum:
- If a request exists: `l_cur` = luminance of the (remodulated, see below) sample at the
  requested pixel, `l_old = lum_prev[p_old]`; write `g1 = (Δ = max(l_cur, l_old), δ = l_cur − l_old, 1, 0)`.
  Else `g1 = 0` (S2 §3.4: empty strata add zero to both, the ratio cancels density).
- `g2 = (mean l, var l, q, ∇q)` over the stratum's 9 pixels (for the filter's weights).
- Also write `lum_cur[p]` for all 9 pixels (next frame's `lum_prev`; `r32float` ping-pong).
- **S-7a one gradient for both signals:** `l` = luminance of the remodulated sum
  `c_d·ρ + c_s·E` (S2's path-tracer variant didn't split signals either, p.9). Both signals'
  α use the same λ.

**G3–G7 `gradientAtrous`** (S2 §3.4, S3 `AtrousGradient`): 5 iterations at stratum
resolution, 3×3 box, steps 1, 2, 4, 8, 16; weights `w_z` as S-3 (offset scaled by 3 px per
stratum) × `exp(−(Δl/σ)²)` with `σ = 3·sqrt(g3x3(var))` (S3's Gaussian form, used for the
gradient only). Filters (Δ, δ) and propagates `var` like S-3.

**In S1 (temporal):** `λ = max over the (2r+1)² strata around p's stratum of
min(1, |δ̂| / Δ̂)` (0 where Δ̂ < 1e-4), `r = 1` (S2 p.9: 3×3 safety max; S3 uses 2; tune
[1, 2]). **Clamp λ ≤ 1** (S2 Eq. 14; S3's missing clamp is a known bug, not copied).
`α_c ← lerp(α_c, 1, λ)`, `α_m ← lerp(α_m, 1, λ)`, `A ← min(1/α_c − 1, A_cap)` (S3).
Gradient strata 3×3 (S2 p.12: ≤ 11 % of samples recycled).

**Without the contract:** plain SVGF (α_min 0.2), or the core fast-history anti-lag (C-10)
as an experiment.

**v0.1: anti-lag as built (TASKS svgf 5; M1 §4; README).** `antiLag: 'off' | 'auto' |
'gradient'`, default **`'off'`**.

- **S-7b `'auto'` (our design, replaces C-10's `'fast'` in svgf).** No renderer work. Per 3×3
  stratum: `δ = mean(l_cur) − mean(l_hist)`, `Δ = max(both)`, over the stratum's pixels with
  valid history, where `l_hist` is the luminance of the reprojected **temporally accumulated**
  history (before à-trous) and `l_cur` the noisy input; `var δ` = the variance of the
  current mean. Then S2's 5-iteration reconstruction and `λ = max(0, |δ̂| − k·σ_δ̂) / Δ̂`, k =
  2 (`antiLagNoiseFloor`), so static noise doesn't read as change. Unlike renderer gradients,
  it keeps firing until the history has caught up: dev-page light switch above 35 dB after 3
  frames vs ~8 for plain SVGF and slower for `'gradient'`. Test bed (feedback off, 7 paths):
  +0.27 dB diffuse, +1.23 dB specular mean, lower FLIP and flicker, light-flip recovery ~3
  vs ~9 frames; cost +2.1 ms joint (4.20 → 6.31 ms).
- **S-8 `'gradient'` contract as built.** The renderer does the forward projection and the
  re-shading and supplies `inputs.gradient`: one texel per 3×3 stratum (`⌈W/3⌉ × ⌈H/3⌉`,
  rgba32float/rgba16float), r = luminance of the forward-projected sample as shaded last
  frame, g = the same sample re-shaded this frame with the same random numbers, b > 0 =
  valid. The denoiser only reconstructs (no G1 pass, no requests buffer). The test bed
  doesn't produce these samples yet (TASKS), so `'gradient'` is measured on the dev page only.
- **Per signal, not one shared gradient** (v0 S-7a used the remodulated sum): inputs are
  demodulated and the remodulation factors are optional, so each signal gets its own λ.
- **Default `'off'`** is the orchestrator's call (performance first: SVGF stays near the 4 ms
  budget). M1 recommended `'auto'` on quality. Review item 2.
- Budget preset (not built): `'auto'` for specular only takes most of the gain (+1.23 vs
  +0.27 dB) but needs two pipelines, because `antiLag` is structural.

---
## 5. Family 2: recurrent blur (M2 diffuse, M3 specular) — expected default (see review item 1)

Pipeline shape from RTG II ch. 49 §49.5 (Fig. 49-3) and GTC 2020: the **post-blur output
is next frame's history** (the recurrent loop, RTG2 §49.3), and a separate stabilization
history never feeds back (RTG2 §49.5.7). Diffuse and specular share every dispatch.

**v0.1 status.** Diffuse is built (`filter: 'recurrent'`, `src/recurrent.ts`,
`src/shaders/recurrent.ts`) and its measured deviations are folded in below. **Specular
(§5.6 and the specular parts of §5.8, §5.11) is in flux:** T3 is implementing virtual motion
and working the joint budget right now, so those parts stay as designed in v0 (what has
been reported so far is listed at the end of §5.6, not folded in). Until M3 lands,
`DiffuseSpecularDenoiser({ filter: 'recurrent' })` runs recurrent diffuse + SVGF `antiLag:
'auto'` specular (two pipelines); `specular: { filter: 'recurrent' }` puts both signals in
shared recurrent dispatches.

Measured (README, test bed): recurrent diffuse 38.42 dB mean over the 7 paths; per path it
beats SVGF/A-SVGF *with feedback on* on 6 of 7, but against today's `feedback: false` defaults
SVGF wins 6 of 7 (−0.23 … −1.07 dB; recurrent leads only on `glossy`, +0.24). It is weaker in
disoccluded regions (−1 … −2.6 dB vs A-SVGF) and flickers slightly more under camera motion
(0.0038 vs 0.0032 mean). On the dev page (hard direct-light shadows) it is ~2–3 dB below
SVGF: without a luminance weight the blur smears hard direct-light edges (a luminance weight
was tried and removed as a measured dead end, commit 25c80aa).

### 5.1 Pass list

| # | pass | reads | writes (storage) | n storage |
|---|---|---|---|---|
| R0 | `prepare` | caller guides | `G` | 1 |
| R1 | `preBlur` | raw radiance + hitT (front end), `G`, `G_prev`, `H_prev` (ĥ guide only) | `pre_d`, `pre_s` (rgb, raw ĥ) | 2 |
| R2 | `temporal` | `pre_*`, `G`, `G_prev`, `H_prev_*`, `F_prev`, `data_prev` | `acc_d`, `acc_s` (rgb, ĥ), `F`, `data` | 4 |
| R3 | `mips` | `acc_*`, `G` | mip atlases `M_d`, `M_s` (rgba16f), `M_z` (r32f) | 3 |
| R4 | `historyFix` | `acc_*`, `M_*`, `G`, `F`, `data` (rw) | `fix_d`, `fix_s`; `data` in place | 3 |
| R5 | `blur` | `fix_*`, `G`, `data` | `blur_d`, `blur_s` | 2 |
| R6 | `postBlur` | `blur_*`, `acc_*` (centre only), `G`, `data` | `H_d`, `H_s` = next frame's history | 2 |
| R7 | `stabilize` | `H_*`, `S_prev_*`, `G`, `G_prev`, `data` | `S_d`, `S_s` (+ remodulated outputs if asked) | 2–4 |

**8 dispatches** per frame for diffuse + specular (RTG2 has 7; our extra one is `prepare`,
fusable into R1 later). Every dispatch stays within the default 4 storage textures.
Formats and buffer rotation: §10.

**v0.1: implementation choices that apply to every pass** (same outputs, less time; TASKS
recurrent 5, 7; LESSONS; commit 25c80aa):
- **Affine taps (R-4).** The kernel axes `T·R_w`, `B·R_w` are projected once at the centre to
  a screen-space Jacobian, and each tap's pixel is `p + J·K_i` instead of projecting each
  world tap. The plane distance of a tap is linear in its pixel for a fixed tap depth
  (`dot(n, X_q) = z·(a0 + ax·qx + ay·qy)` in perspective), so it costs a few FMAs. Identical
  PSNR, part of 3.86 → 2.92 ms diffuse. The screen-offset cap is `2·max(R_max, R_pre)` (v0:
  `2·R_max`, which silently collapsed the pre-blur when R_max was swept small).
- **Branchless taps.** Clamp the tap coordinate, issue every load, zero rejected weights with
  `select`. Temporal 0.74 → 0.56 ms, blur 0.50 → 0.34 ms.
- **Workgroup-shared 10×10 tiles** (8×8 workgroup + 1-px halo) for the 3×3 neighbourhoods of
  R2 (detector), R4 (anti-firefly, fast clamp) and R7 (clamp): joint temporal −0.20 ms,
  history fix 0.82 → 0.47 ms, stabilize −0.04 ms. With tiles, the mip-repair code no longer
  costs occupancy, so it stays in R4 (v0.1 drops the "move it to an indirect dispatch" lever).
- **No depth slope** in recurrent-only pipelines (prepass 0.18 → 0.10 ms, §1.3).

### 5.2 Common definitions

```
pixSize(d)  = 2·d / (P[5]·H)        (orthographic: 2 / (P[5]·H))          world size of one pixel at depth d
v           = −normalize(X)          view vector, out of the surface;  NoV = max(dot(n, v), 1e-4)
α           = r²                     diffuse uses r = 1
θ_L(α)      = atan(α · sqrt(E / (1 − E))),  E = lobeFraction = 0.75      GGX lobe half-angle (R-1)
F_dom(α)    = (1 − α)·(sqrt(1 − α) + α)                                  dominant-direction factor (R-2)
D           = normalize(lerp(n, reflect(−v, n), F_dom(α)))               specular dominant direction
A_n         = saturate(A / A_cap)
W(x)        = smoothstep(0, 1, saturate(1 − x))                          weight shape, RTG2 Eq. 49.3 with a = 1/tolerance, b = 0
lum(c)      = dot(c, (0.2126, 0.7152, 0.0722))
```

**R-1 Lobe half-angle (D4e).** Our derivation from the GGX NDF: the fraction of
projected microfacet area within angle θ of the normal is `tan²θ / (α² + tan²θ)`; setting it
to E gives `tan θ = α·sqrt(E/(1−E))`. With E = 0.75 (the fraction RTG2 p.841 names):
θ_L = 60° at r = 1, 23° at r = 0.5, 4° at r = 0.2. This replaces the three conflicting
forms in reblur.md §4.4 (GTC20's 90°·α/(1+α), the FB p.72 form, and RTG2's call, which is
a listing). Tune: E ∈ [0.5, 0.9].

**R-2 Dominant direction (D4f).** Frostbite's simple fit (Lagarde & de Rousiers 2014,
Listing 22, p.71), which the authors found to perform better than their accurate fit, fed
with **GGX α** (FB's `roughness` is α). Mirror: F = 1 (D = reflection); r = 1: F = 0 (D = n).
Tune on captures: feeding perceptual r instead.

### 5.3 R0 `prepare`

Writes `G` (C-5). Nothing else; no signal processing here.

### 5.4 R1 `preBlur` (D1)

Purpose: redistribute outliers and densify the 1-spp input before it enters the history
(RTG2 §49.5.1).

- Front end per tap: F-1 sanitize, F-2 demodulate if needed, F-3 normalize hitT → ĥ.
- Kernel: the shared 8-tap disk (R-3) on the world-space plane (R-4), **static** (no
  per-pixel rotation; RTG2 §49.5.5), centre included.
- Radius (D1): `R_pre_px = 15·(H/1080)` diffuse, `10·(H/1080)·f_r(α)` specular (R-5);
  converted to world with `pixSize(d)`. Constant per pixel, i.e. world radius grows with
  distance like a screen-space blur. **D1b:** clamped by `c_h·h̃_prev` (R-5) where
  `h̃_prev` is last frame's **denoised** hit distance: the alpha of `H_prev` at the
  nearest texel to `uv_prev` (C-6), if that texel passes the plane test (C-7); otherwise no
  hit clamp. Raw hitT is too noisy to size a kernel (RTG2 p.837), and a pre-blur bias is
  permanent (the converged result is an average of pre-blurred frames), so contact regions
  must not be pre-blurred wide. Tune: diffuse [0, 30] px, specular [0, 20] px.
- Weights: `w_geom`, `w_normal`, `w_rough` (spec) at **A = 0** tolerances (R-6). No
  hit-distance weight (raw ĥ), no luminance weight (redistribute, don't reject).
- ĥ passes through **unfiltered** (GTC20 s.60: hit distance denoised in all passes except
  pre-blur).

**v0.1 (R1 as built; TASKS recurrent 3, 6):**
- Diffuse radius **25 px** at 1080p (v0: 15). Test bed +0.10 dB. Specular stays 10 px·f_r.
  The bias is permanent (§12 item 10: look at contact GI before freezing).
- **D1b guide:** the nearest reprojected texel's denoised ĥ is used when its depth is within
  **5 % relative** of the expected previous depth (v0: the C-7 plane test). It only sizes a
  kernel, and the cheaper test keeps the loads parallel. Not measured separately.

### 5.5 R2 `temporal` — diffuse

- Reproject `H_prev_d` (C-6, C-7, C-8 with Catmull-Rom), A per C-9, `A_cap = 31`.
- `acc_d = lerp(H_d, pre_d, 1/(1 + A_d))` for rgb **and ĥ** (ĥ accumulates with the signal's
  own A: long accumulation gives good AO; the responsive hit distance lives in `F`).
- Fast history (C-10): `F_prev` reprojected with custom bilinear;
  `F.(lum_d, ĥ_d) = lerp(F_prev, (lum(pre_d), ĥ_pre), 1/(1 + min(A_d, A_fast)))`.
- No variance clamp here (RTG2 p.834: the pre-blurred signal is too noisy for a useful clamp).
- **v0.1:** the current-frame detector C-10b runs here, between the A update and the
  accumulation, so the accumulation already uses the shortened A. Catmull-Rom per C-8 v0.1.
  `A_cap = 31` kept: 15 / 31 / 63 measured +0.11 / 0 / −0.02 dB with v0's anti-lag and −0.04
  dB for 31 vs 15 with ours, i.e. flat (TASKS recurrent 4).

### 5.6 R2 `temporal` — specular (M3; D12) — **in flux (T3): as designed in v0**

Two history candidates, surface and virtual motion, blended (RTG2 §49.8). The functions
below are **our design** built from the chapter's prose properties; the listing formulas
transcribed in reblur.md §4.2 are not used.

**R-7 Parallax** (RTG2 §49.8.1 prose, Fig. 49-5): `π = tan(angle(v_cur, v_prev))` with
`v_cur = normalize(X)` and `v_prev = normalize(Rc_prev · Xp)` (the point relative to the
previous camera, from C-6, so object motion is included). `π = 0` under pure rotation.
Per frame; no fps normalization in v0 (constants are tuned on 60 fps captures).

**R-8 Surface-motion frame cap.** RTG2 p.834 requires a cap that is smaller for low
roughness, small |n·v|, and high parallax. Ours, from a lag argument: the reflected image
slides across the surface by about π per frame; history stays sharp while the accumulated
slide stays inside the lobe half-angle:

```
A_spec = min(A_cap, k_s · θ_L(α) · NoV^κ / max(π, 1e-4))        k_s = 1 (tune [0.25, 4]), κ = 0.5 (tune [0, 1])
A_surf = min(A_s, A_spec)                                         A_s after the +1 of C-9 (D12d: post-increment)
C_surf = lerp(H_surf, pre_s, 1/(1 + A_surf))
```

Examples: π = 0 → full history even on mirrors (rotation is reprojected exactly); r = 0.05
with any translation → ~1 frame; r = 0.32 strafing 1 cm/frame at 2 m → full.

**R-9 Virtual position.** The reflected image point along the view ray (the "virtual
image" used by RTG1 ch. 25 p.451 and Stachowiak 2015), pulled back to the surface by the
dominant factor (RTG2 p.835–836 prose: F → 0 resolves virtual to surface motion):

```
h̃      = denormalize(F.ĥ_s)                        this frame's fast specular hit distance (RTG2 p.837 prose)
X_virt = X + normalize(X) · h̃ · F_dom(α)
uv_virt = project(prevProjection, R_prev · (X_virt + Δcam))
```

Static-world assumption for the reflected scene (moving reflectors and reflected moving
objects lose confidence instead).

**R-10 Virtual history and confidence (D12a).** `H_virt` = custom-weighted bilinear at
`uv_virt`, tap validity = C-7 against the **current surface plane** `{Xp, np}` (a flat
reflector's previous texels at `uv_virt` lie on that plane). Then:

```
v_g   = Σ b_i·v_i                                   valid fraction of the footprint
n̄_v, r̄_v, ĥ̄_v = valid-weighted averages at uv_virt of previous normal, roughness and F_prev.ĥ_s
c_v   = inScreen(uv_virt) · v_g
      · W( acos(n·n̄_v) / (0.5·θ_L(α) + 1°) )        reflections move twice as fast as normals
      · W( |r − r̄_v| / (0.05 + 0.25·r) )
      · W( |ĥ̄_v − F.ĥ_s| / (0.05 + 0.25·r) )         hit distance must agree in the reflected world
```

Tolerances tune: angle factor [0.25, 1], hit tolerance [0.02, 0.1] + [0.1, 0.5]·r.

**R-11 Virtual clamp (D12b).** `μ`, `σ` per channel of `pre_s` over its 3×3 neighbourhood;
`H_virt ← lerp(clamp(H_virt, μ − 2σ, μ + 2σ), H_virt, c_v)` (RTG2 p.837 prose: confidence
controls how hard virtual history is clamped). γ tune [1, 3].

**R-12 Blend.**

```
α_surf = 1/(1 + A_surf)
α_virt = lerp(1/(1 + min(A_s, A_fast)), 1/(1 + A_s), c_v)   // no parallax penalty; low confidence → fast (RTG2 p.837)
m      = F_dom(α) · inScreen(uv_virt) · [v_g > 0]            // amount of virtual motion (RTG2 p.837 prose)
C_virt = lerp(H_virt, pre_s, α_virt)
acc_s  = lerp(C_surf, C_virt, m)                             // rgb and ĥ
α_next = lerp(α_surf, α_virt, m);   A_s ← 1/α_next − 1       // blend in α-space: α is the actual weight
```

If the surface footprint is fully invalid: `A_s = 0`, `acc_s = pre_s`, `m = 0`.
Fast specular history: surface reprojection only, like diffuse (RTG2's
"parallax-corrected" detail is not reproduced; our deviation). `m` goes to `data` for R7.

**D12c Curvature.** Not in v0 (flat-reflector virtual motion). Later refinement: the
thin-lens reflection motion of RTG1 ch. 32 §32.4.3, curvature from neighbouring normals.

**v0.1: reported by T3 so far, not folded in** (commits a787b20, 25c80aa; the agent is still
changing these, and the spec author has not reviewed them; they get folded in with M3's
results):
- virtual clamp always on, window γ = 1 σ widening × (1 + 2·c_v) (v0 R-11: γ = 2,
  strength by c_v);
- curvature correction of the virtual distance (mirror equation, D12c) from the 4 axis
  neighbours' normals;
- for low roughness, the specular detector floor and the anti-lag / detector mean move
  from the 3×3 mean toward the pixel's own value (clean mirror input: the 3×3 mean blurred
  reflected edges; mirrors on `light` 34.8 → 40.7 dB);
- minimum blur radius scaled by f_r (no 1-px floor on mirrors); specular R_max 30 px;
- the stabilization's virtual candidate is **off** (−0.4 dB), so R7 uses surface motion
  only for specular too;
- virtual taps: plane test linear in the tap pixel against the previous plane, bilinear only;
- numbers so far: specular `glossy` 31.56 → 34.92 dB (A-SVGF auto 34.63), `orbit`
  31.27 → 32.85 (A-SVGF auto 33.80). Joint diffuse + specular 5.41 ms (dev page).
- Uncommitted work in the tree as of this writing: per-pass disk tap counts (4 or 8) for
  the budget.

### 5.7 R3 `mips` (D7e)

- Levels 1–3 below the base (4 levels in total: base + 3), which reconciles RTG2's "first
  four mip levels" (text) with "first 3 mip levels" (figure). Tune: add level 4.
- One dispatch, 16×16 workgroups, shared-memory reduction 16×16 → 8×8 → 4×4 → 2×2
  (RTG2 §49.5.3: single pass in shared memory).
- **Averages over non-sky pixels only** (weight `d > 0`), for `acc_d`, `acc_s` (rgb + ĥ) and `d`.
- **R-13 Atlas layout** (to stay within 4 storage textures): all three levels of one signal
  go into one 2D texture: level 1 at (0, 0), level 2 at (⌈W/2⌉, 0), level 3 at
  (⌈W/2⌉, ⌈H/4⌉); atlas size (⌈W/2⌉ + ⌈W/4⌉) × ⌈H/2⌉ (0.375 of the base area). The
  signal atlases reuse a free full-size rotation buffer (§10); the depth atlas is its own
  `r32float`. History fix reads atlases with `textureLoad` only (no hardware filtering
  across regions).

### 5.8 R4 `historyFix` (D7, D8, D9, D11)

Order per pixel and signal: (a) mip repair, (b) anti-firefly, (c) fast-history clamp and
anti-lag.

**(a) Mip repair (D7).** Only where `A < A_fix`, `A_fix = 3` (RTG2 p.829: full
reconstruction lasts 1–3 frames). Tune [2, 6].

```
ρ = 1 (diffuse) or r (specular, perceptual)                   // mirrors start near the base level (GTC20 s.35)
L = floor(3 · saturate(1 − A/A_fix) · ρ + 0.5)                // GTC20 s.35 structure, L_max = 3
while L ≥ 1:
    f  = (p + 0.5)/2^L − 0.5;   3×3 texels t around round(f)          (D7d: 3×3 per RTG2 p.829)
    w_b = tent(f − t) with half-width 1.5 texels
    w_z = W( |d_mip(t) − d| / (τ_fix · 2^L · d) ),  τ_fix = 0.02     (D7b; viewZ-only weights, RTG2 p.829)
    if Σ w_b·w_z / Σ w_b ≥ 0.25:  C ← Σ w_b·w_z·C_t / Σ w_b·w_z;  break     (D7c)
    L ← L − 1
```

Tune: τ_fix [0.005, 0.05], weight-sum threshold [0.1, 0.5]. The repaired value replaces the
accumulated one (rgb and ĥ). Diffuse: A = 0 uses mip 3 (8×8), A = 1 mip 2, A = 2 mip 1.

**(b) Anti-firefly (D9).** Our rank-based clamp in the spirit of rank-conditioned rank
selection (RTG2 p.830 names Hardie & Barner 1994; we have not read it): over the 8
neighbours of `acc` that pass `w_geom` at A = 0 tolerances, take the **second-largest
luminance** `l_(2)`; if the centre's `l > k_ff·l_(2)`, scale its rgb by `k_ff·l_(2)/l`.
Needs ≥ 4 valid neighbours. `k_ff = 1.5`, tune [1, 4]. Skipped for specular with
`r < 0.25` (sharp highlights are legitimate and mirror input isn't noisy). ĥ untouched.

**(c) Fast clamp and anti-lag (D8, D11):** C-10 exactly. "Faster history" (D8c) = `F`, a
second accumulation with cap `A_fast = 3`; neighbourhood 3×3, γ = 2 (D8a). Writes the
reduced A into `data` in place (`r32uint` read-write, own pixel).
**v0.1:** window `γ·σ_f/√N`, γ = 1 (C-10 v0.1, +0.37 dB). The specular branch is in flux
(§5.6 notes).

### 5.9 Spatial kernel (R5, R6, and R1's shape)

**R-3 Poisson disk (D3a).** 8 taps in 4 antipodal pairs, from a golden-angle (Vogel 1979)
spiral of 4 points with radii `sqrt((i + 0.5)/4)`, mirrored. Zero mean (no shift when
used unrotated), minimum spacing 0.425 of the radius:

| i | x | y | i | x | y |
|---|---|---|---|---|---|
| 0 | 0.3536 | 0.0000 | 4 | −0.3536 | 0.0000 |
| 1 | −0.4515 | 0.4137 | 5 | 0.4515 | −0.4137 |
| 2 | 0.0691 | −0.7875 | 6 | −0.0691 | 0.7875 |
| 3 | 0.5691 | 0.7423 | 7 | −0.5691 | −0.7423 |

Plus the centre pixel (weight 1 before the bilateral terms). No distance falloff (uniform
disk; recurrence smooths). Tune: add `exp(−3u²)` falloff.

**D3b rotation (blur only).** `φ = 2π · fract(B4[py & 3][px & 3]/16 + frameIndex · 0.6180339887)`,
`B4 = [[0,8,2,10],[12,4,14,6],[3,11,1,9],[15,7,13,5]]` (4×4 Bayer, animated with the
golden-ratio additive sequence; RTG2 §49.5.5 says animated 4×4 Bayer, ALU only; the
golden-ratio animation is RTG II ch. 24's recommendation for blue noise). Pre- and
post-blur: φ = 0.

**R-4 Kernel plane (RTG2 §49.9 prose, GTC20 s.38–40).** Axis `a = reflect(−D, n)`: equals
`n` for diffuse (tangent plane) and `v` for a mirror (screen plane).

```
if |dot(a, n)| > 0.999:  (T, B) = orthonormal basis of n     (Duff et al., JCGT 6(1), 2017)
else:                    T = normalize(cross(n, a));  B = cross(a, T)
T *= s_T,  s_T = 1 − κ_e · (1 − NoV) · 4r(1 − r)              κ_e = 0.75, tune [0, 1]
X_i = X + R_w · (K_i.x·T + K_i.y·B)       (K_i rotated by φ)
```

`T` is perpendicular to the plane of incidence, so shrinking it elongates the kernel along
the plane of incidence (glossy streaks), most at mid roughness and grazing view; mirrors and
diffuse stay isotropic. The elongation function is ours (the chapter's is in a listing).
Each `X_i` is projected with the current view-projection; the tap reads the pixel it lands
in (`textureLoad`); a tap landing on the centre pixel or off-screen gets weight 0; screen
offsets longer than `2·R_max_px` are scaled back.

**R-5 Radius (D2).**

```
R_w  = max( min( R_max_px · f_A · f_r(α) · pixSize(d),  c_h · h̃ ),  R_min_px · pixSize(d) )
f_A  = 1/(1 + A)                                    (GTC20 s.20–22)
f_r  = 1 (diffuse);  sqrt(saturate(α / 0.25)) (specular: 0 at mirrors, 1 from r = 0.5)
c_h  = 1 (diffuse);  tan(θ_L(α)) (specular: the lobe's footprint at the hit point)
h̃    = denormalize(centre ĥ of this pass's input)  (the filtered hit distance)
R_max_px = 30 · (H/1080), R_min_px = 1             tune: R_max [10, 60], R_min [0.5, 2], c_h diffuse [0.5, 3]
```

The `c_h·h̃` clamp gives contact hardening: GI and reflections of nearby geometry stay sharp
(RTG2 p.830 lists hit distance as a radius input; GTC20 s.60 shrinks the radius for short
hits; the lobe-footprint form is ours).

**v0.1:** diffuse `R_max_px` = **45** at 1080p (v0: 30): test bed +0.17 dB (TASKS recurrent 3).
Specular stays 30 px (in flux). Projection of the taps per §5.1 v0.1 (affine).

**R-6 Weights (D4).** `w = w_geom · w_normal · w_rough · w_hit` (RTG2 Eq. 49.2), each `W(x)`:

| weight | x | tolerance (tightens with A) | notes |
|---|---|---|---|
| geometry | `|dot(n, X_t − X)| / ‖X‖` | `τ_g = lerp(0.02, 0.005, A_n)` | plane distance (RTG2 p.841, Metro s.59); replaces GTC20's A_factor (D4d) |
| normal | `acos(dot(n, n_t))` | `θ_n = θ_L(α) · lerp(1, 0.25, A_n) + 1°` | g(A) = lerp(1, 0.25, A_n) (D4c); fast acos approximation is fine |
| roughness (spec) | `|r − r_t|` | `0.05 + 0.25·r` | our tolerance (GTC20 s.48 has another; RTG1 ch. 32 Eq. 14 a third) |
| hit distance | `|ĥ_t − ĥ|` | `τ_h = lerp(0.1, 0.5, r) · lerp(1, 0.5, A_n)` | D4b: our formula on normalized ĥ (a relative measure by construction); not in pre-blur |

Tune each tolerance's endpoints by ×[0.5, 2]. Sky taps: 0.

### 5.10 R5 `blur` and R6 `postBlur`

- R5: kernel R-3/R-4, rotated (D3b), radius R-5, weights R-6. Filters rgb and ĥ.
- R6: same, unrotated, radius scaled by how much the blur changed the signal (RTG2 §49.5.6):

```
δ    = |lum(blur) − lum(acc)| / (max(lum(blur), lum(acc)) + 1e-3)        (centre pixel)
R_w  = R5's R_w · lerp(0.5, 2.0, saturate(δ / 0.3))                       (D2c)
```

  Tune: base [0.25, 1], max [1, 3], δ₀ [0.1, 0.5]. R6's output is `H`, next frame's
  history (RTG2 p.830).

### 5.11 R7 `stabilize` (D10, D15)

Order: post-blur, then stabilization (RTG2 Fig. 49-3; D15 — GTC20 s.59's order is treated
as a slide artefact). Own history `S`, never fed back (RTG2 §49.5.7).

- Diffuse: reproject `S_prev_d` (C-6/C-7/C-8 with Catmull-Rom). Specular: surface and
  virtual fetches (virtual position recomputed with R-9 from `H_s`'s ĥ), blended by `m` from
  `data` (RTG2 p.831). Invalid → `S = H`.
- Clamp per channel to the 3×3 neighbourhood of `H` (geometry-valid neighbours):
  `w = γ_s·σ + β_s·μ`, `γ_s = lerp(1, 3, A_n)`, `β_s = 0.02·A_n` — "wider clamping if
  possible" (RTG2 Fig. 49-3) read as: wider once the pixel has a long, trusted history.
  Tune γ_s endpoints [0.5, 4], β_s [0, 0.05].
- `α_st = max(1/(1 + A), 1/(1 + N_stab))`, `N_stab = 7` (D10; tune [3, 31]); A is the
  signal's A after anti-lag (A_s for specular, so mirrors stabilize less).
- `S = lerp(clamp(S_prev), H, α_st)` for rgb and ĥ. Output = `S` (demodulated), or
  `S·ρ` / `S·E` written to separate output textures when `output = 'remodulated'`.
- No A reduction here (deviation from RTG2 §49.11, which runs anti-lag in this pass): our
  anti-lag lives in R4 (C-10), so A is written in one place and the blur radii of this
  frame already see the reduced A. A second, stabilization-based detector is a tuning
  option for later.

**v0.1 (R7 as built; TASKS recurrent 4, 7):**
- **Reuses R2's 2×2 validity** instead of re-running C-7: R2 stores the 4 tap-valid bits in
  `data` (§5.12), and R7 decodes them. Same reprojection, no second set of plane tests.
  Catmull-Rom when all 4 bits are set (C-8 v0.1).
- `N_stab = 7` kept: 3 / 7 / 15 measured about flat.
- Anti-lag is now in **two** places, R2 (C-10b) and R4 (C-10), both before the blurs; still
  none in R7.
- Specular: surface motion only (the virtual candidate measured −0.4 dB, §5.6 notes).

### 5.12 `data` texture (D14)

`r32uint` per pixel: `A_d` (10 bits, fixed point A·16, max 63.94), `A_s` (10 bits), `m`
(12 bits unorm). Written by R2 (write-only), updated in place by R4 (read-write, which core
WebGPU allows for `r32uint`), read by R5–R7 and next frame's R2 (bilinear decode of 4 texels
for A). GTC20 s.20 hints at a normalized A; the fixed-point packing is ours.

**v0.1:** `m` shrinks to **8 bits** and the top 4 bits hold R2's 2×2 tap-validity mask for R7:
`A_d (10) | A_s (10) | m (8) | mask (4)`.

---

## 6. Decisions for the 16 open items (reblur.md §7)

| # | open item | decision | rationale | tune |
|---|---|---|---|---|
| D1 | pre-blur radius | **v0.1: 25 px diffuse** (v0 15; +0.10 dB), 10 px·f_r specular (at 1080p, scaled by H), static disk, A = 0 weights; clamped by `c_h·h̃` from last frame's denoised ĥ when available (guide texel accepted by a 5 % depth test) | densify without permanent contact bias; raw hitT too noisy to size kernels | [0, 30] / [0, 20] px |
| D2 | blur / post-blur radius | R-5: `max(min(R_max·f_A·f_r·pixSize, c_h·h̃), R_min·pixSize)`, f_A = 1/(1+A), **v0.1: R_max 45 px diffuse** (v0 30; +0.17 dB), 30 px specular, R_min 1 px; post-blur × lerp(0.5, 2, sat(δ/0.3)) | GTC20's 1/(1+A); hit distance as a physical footprint (lobe at the hit); post-blur grows only where the blur still changed things | R_max [10, 60]; post-blur [0.25–1, 1–3, δ₀ 0.1–0.5] |
| D3 | Poisson disk, rotation | 8 antipodal golden-angle taps (table R-3) + centre; blur rotates by 4×4 Bayer + golden-ratio per frame; pre/post static | zero-mean set is safe unrotated; ALU only | falloff on/off |
| D4 | weights | W(x) = smoothstep(0,1,sat(1−x)) for all; geometry plane distance τ_g 2 %→0.5 %; normal θ_L(α)·lerp(1, 0.25, A_n) + 1°; roughness 0.05 + 0.25r; hit-distance on ĥ, lerp(0.1, 0.5, r)·lerp(1, 0.5, A_n); θ_L from our GGX derivation, E = 0.75; FB simple dominant fit with α | one shape everywhere (RTG2 Eq. 49.3); tolerances tighten with A (RTG2 p.841) | endpoints ×[0.5, 2]; E [0.5, 0.9]; r vs α in the fit |
| D5 | hit distance | rational `ĥ = h/(h + a + b·d)`, a = 1, b = 0.05; main ĥ accumulates with the signal's A; responsive copy in `F` (cap A_fast = 3) for confidence and virtual motion; ĥ filtered by every pass except pre-blur, with the same weights as radiance; "mix input with reprojection" = the fast history | never clips far hits; AO/SO for free; one curve | a [0.25, 5], b [0, 0.2] |
| D6 | disocclusion | τ = 1 %; all math in previous view space; pairwise-averaged normal; backface reject; **v0.1: Catmull-Rom if the 4 inner taps pass, clamped to their range** (v0: all 16) | removes the frame-of-reference ambiguity; the clamp makes the outer-ring test unnecessary | τ [0.5 %, 1.5 %] |
| D7 | history fix | A_fix = 3; levels base + 3; start L = floor(3·sat(1 − A/A_fix)·ρ + 0.5), ρ = r for specular; 3×3 tent at level L; viewZ weight with τ_fix = 2 %·2^L; fall to finer level if normalized weight sum < 0.25; full replacement | RTG2 p.829 (3×3, viewZ only, 1–3 frames), GTC20 s.35 (start level) | A_fix [2, 6]; τ_fix [0.5 %, 5 %]; sum [0.1, 0.5] |
| D8 | variance clamping | history fix: 3×3 of fast luminance, **v0.1: γ = 1 standard error** (v0: γ = 2 spreads; +0.37 dB), luminance-only clamp; stabilization: 3×3 of post-blur output, w = γ_s σ + β_s μ widening with A; "faster history" = `F` with A_fast = 3 | fast history makes the window track recent lighting; the window is the noise of the 3×3 mean; widening = "wider if possible" | γ [0.5, 2]; γ_s, β_s ranges above |
| D9 | anti-firefly | clamp centre luminance to 1.5× the second-largest of 8 valid neighbours in history fix; skip specular r < 0.25 | rank-conditioned in spirit; no energy removed unless the centre is an extreme outlier | k_ff [1, 4] |
| D10 | stabilization speed | α = max(1/(1+A), 1/8) (N_stab = 7), uses the signal's A after anti-lag | lag bounded by the clamp; mirrors (low A_s) stabilize less | N_stab [3, 31] |
| D11 | anti-lag | C-10: fast/slow relative luminance excess beyond γσ/√N, and ĥ excess; confidence `c = min(c_I, c_H)`; `A ← lerp(min(A, A_fast), A, c)`; runs in history fix. **v0.1: plus C-10b**, a current-frame detector in R2 (3×3 mean of the pre-blurred input vs reprojected history in standard errors, floor A_fast) | renderer-independent; C-10b catches the first frame of a change (dev light switch +2–3 dB) | γ [0.5, 2]; e_max [0.2, 1]; ĥ tol [0.1, 0.4]; A_fast [2, 7]; C-10b σ [2, 5] |
| D12 | virtual motion | confidence R-10 (footprint validity × normal × roughness × fast-ĥ agreement); clamp R-11 to input 3×3 μ ± 2σ, strength by c_v; no curvature in v0; A post-increment | prose properties of RTG2 §49.8.2; listing not used | tolerances in R-10/R-11 |
| D13 | checkerboard | not supported in v0 | PLAN §1 non-goal | — |
| D14 | storage of A | `data` r32uint: A_d, A_s as 10-bit A·16, **v0.1: m 8-bit unorm + 4-bit 2×2 validity mask for R7** (v0: m 12 bits); read-write in history fix | fits the 4-storage limit and the memory budget | — |
| D15 | specular pass order | post-blur → stabilization (RTG2) | later, more detailed source | — |
| D16 | motion vectors | 2D NDC motion + optional 2.5D `motionZ` + viewZ + matrices → Xp (C-3, C-6); no 3D world motion input | the API and captures carry 2D/2.5D; 2.5D is NRD's recommended mode too | — |

Other recurrent constants: `A_cap = 31` (C-9; 15 / 63 measured flat), `A_fast = 3` (C-10),
`R_max = 45 px` diffuse / 30 px specular (R-5, v0.1), `N_stab = 7` (D10; 3 / 15 flat),
`A_fix = 3` (D7).

---

## 7. Shadows (M4) — as built (v0.1)

Replaces the FFX shadow denoiser's weak points measured in `docs/specs/temporal.md`
(binary visibility, blur feedback drift, no penumbra sizing). **v0.1:** this section was an
outline in v0; it now describes `ShadowDenoiser` (`src/shadow.ts`, `src/shaders/shadow.ts`,
registry id `shadows`) as built and tuned in M4. Each item gives the v0 value where it
changed. Tuning log: M4 §3 (960×540, paths `orbit light thin object` (+`pan`)); tables:
M4 §2 (1080p, 7 paths).

**Result** (1080p, mean of 7 paths, M4 headline): PSNR 38.89 dB, penumbra 28.12, FLIP 0.018,
vs FFX shadows 33.57 / 23.50 / 0.038; better on every path (PSNR +3.5 … +7.5 dB). Cost
0.43–0.64 ms in the fast clock state (FFX 0.50–0.73). Weak spot: the first ~5 frames after a
reset or disocclusion (§12 item 6).

### 7.1 SH-1 Inputs

`visibility` ∈ [0, 1] (fractional kept end to end, never thresholded), occluder distance `h`
(`hitDistance`, 0 = unoccluded), and the light (`ShadowInputs.light`, or the `light` option;
one light per instance, RTG1 ch. 19 also filters per light). Missing light or missing `h` →
SH-6 fallback.

### 7.2 SH-2 Penumbra width

Mehta 2012 Eq. 13 rewritten for a hit distance (derivation in `sources/shadows-specular.md`
§A2): `W = R · g` with **`g = h / max(D − h, 1e-3·D)`** for a sphere light of radius R at
distance D from the receiver; `W = tan(θ_L) · g` with `g = h` for a directional light of
angular radius θ_L. Floor 1 px: ours. M12's floor term is 1/(kµ·Ω_x^max), a little over one
pixel footprint (correction from `reviews/shadows-provenance.md` row 1). M12 measures d1, d2
along a planar light's normal and uses a Gaussian σ; we use ray lengths and the sphere
radius, and the tuned radius factor 0.75 (§7.5) absorbs the scale.

**v0.1: the history stores `g`, not `W_eff`** (M4 §7.3). `g` is light-size free, so a light
that changes size takes effect at once (`light` path shrinks the light at frame 72). `g` is
accumulated over the pixel's **occluded** samples only, with its own sample count `n_g`
(cap 7: our design, untuned).

### 7.3 SH-3 Nearest occluder, tiles

8×8 tiles. The temporal pass's workgroup is one tile, so the tile statistics come for free:
`atomicMin` of `g` over pixels with an estimate and `atomicOr` of flags (fractional history;
any raw occluded; any raw lit) in workgroup memory (v0 had a separate `tiles` pass first).
A small `tiles` pass then, per tile, takes the minimum `g` over its 3×3 tiles and builds the
indirect list of **active** tiles: those whose 3×3 neighbourhood holds a fractional history
or raw samples that disagree. Only active tiles run the spatial passes (TR19 slide 72;
H18 §4.1). Tile skip is worth ~0.5 ms (each spatial pass 0.33 ms on `orbit` without it).

`g_eff`: pixels with their own estimate take `min(own, 3×3-tile min)` (v0's "nearest occluder
wins"; `mergeMin`, +0.13 dB); pixels without one take the tile minimum; none → 0 (1-px
radius). **Terminators** (no own estimate and `n·l < sin θ_light`, i.e. the light partly
below the receiver's horizon; visibility follows n·l there) get a fixed **16 px** radius
(6 px within noise, 32 px −0.7 dB). The patent-described remedy in shadows-specular.md G2
is not used.

### 7.4 SH-4 Temporal (raw visibility, no blur feedback)

Accumulates **raw** visibility with the shared core's reprojection (C-6/C-7, affine form:
plane distance linear in the tap pixel, temporal 0.40 → 0.31 ms) and a neighbourhood clamp.
The spatial output never re-enters the history (FFX's compounding blur drifts ~1 dB). Per
pixel, with μ, σ the mean and spread of the **5×5 raw** visibility (12×12 shared tile):

```
v_H   = reprojected history (Catmull-Rom when the 4 taps are valid, clamped to them)
win   = 0.4·σ + 0.05                                   (v0: 1·σ)
v_c   = clamp(v_H, μ − win, μ + win)
A_hist ← lerp(A_hist, min(A_hist, 0), saturate(64·|v_c − v_H|))   anti-lag restart (new)
if σ == 0: v_c = μ                                     uniform snap (new), A kept
cap   = clamp(1 · W_px², 1, 15)                         W_px from the accumulated g (new)
A     = min(A_hist, cap) + 1                            (0 after a disocclusion)
v     = lerp(v_c, v_raw, 1/(1 + A))
```

v0.1 changes, with the measurement (M4 §3, §7):

| item | v0 | v0.1 | evidence |
|---|---|---|---|
| clamp window | μ ± 1·σ (γ = 1) | **μ ± (0.4·σ + 0.05)**, about 2 standard errors of the 25-sample mean | the big step: about +2 dB (M4 §7.1; +2.5 dB overall, +1.7 dB penumbra in the shadows agent's LESSONS entry). Binary 1-spp samples give σ ≈ 0.5 in any penumbra, so a 1σ window never fires there and moving shadows lag through it. 0.3σ / 0.5σ: −0.25 / −0.11 dB. Blue-noise samples make the 5×5 mean accurate enough (same lesson as recurrent C-10) |
| anti-lag | — | **restart**: a history the clamp moved by ≥ 1/64 restarts at `A_hist = 0` (the clamped value counts as one frame) | restart at 0 instead of 1: +0.9 dB, penumbra +0.45 (31.77 / 24.48 → 32.65 / 24.93); from 1, the 1/n decay left a visible ~1 % residue after a light flip. Gains 8 / 32 / 64: 30.47 / 31.11 / 31.18 |
| uniform snap | — | where all 25 samples agree (σ = 0) the history takes their value exactly | `pan` 39.9 → 50.6 dB (its last 17 frames have no shadow: exact frames score 120 dB in the mean of per-frame dB); other paths −0.00 … −0.06 dB, penumbra −0.06 … −0.12. Metric-driven: §12 item 6 |
| history cap | A_cap = 15 | 15 **and** `1·W_px²` per pixel | each reprojection resamples the history, so A frames blur a narrow penumbra by ~√A px. Cap 31: −1.3 dB. k = 1 / 0.25 / 0.0625 on `orbit`: +0.54 / +1.00 / +1.45 dB before the clamp change, within ±0.1 dB after it; k = 1 kept |
| history fetch | bilinear | Catmull-Rom (C-8 v0.1) | +0.65 dB on `orbit` |
| stored | v, W_eff, A | v, g, A, n_g (`rgba16float`) | §7.2 |

The young-history radius boost `× (1 + k/(1 + A))` lost (k = 0.5 / 1 / 2: −0.01 / −0.05 /
−0.18 dB; also worse on `std1080-orbit`): `freshBoost`, default 0.

### 7.5 SH-5 Spatial

Two passes over the active tiles, each SPEC's 8-tap disk (R-3) on the receiver's tangent
plane (axis T along the light direction projected on the plane), per-pixel animated Bayer
rotation (D3b) with a different angle per pass. Radius `R = 0.75 · W_eff · lerp(1, 0.5, A_n)`,
the second pass `0.5·R`, floor 1 px, axes ≤ 48 px at 1080p (our design, untuned). Weights:
plane distance (2 %) × normal (30°).

| item | v0 | v0.1 | evidence |
|---|---|---|---|
| radius | `1·W_eff` | **`0.75·W_eff`** | radius 0.5 / 1.5 / 2 / 3·W on `orbit`: +0.12 / −0.37 / −0.81 / −1.71 dB vs 1·W; 0.75 vs 1·W after the clamp change: 31.18 → 31.64 dB (4-path mean). The true profile is S-shaped; a disk as wide as the penumbra rounds its ends |
| shrink at full history | lerp(1, 0.5, A_n) | same | 1 / 0.25: −0.28 / −0.01 dB |
| anisotropy (stretch by 1/(n·l) along the light) | M4 experiment | built, **off** | −2.7 dB (cap 4), −1.4 (with radius 0.5), −0.26 (cap 2 + radius 0.5): on these scenes the extra length is extra blur (M12 Eq. 12 reading) |
| normal weight | 30° | kept | off saves ~0.04 ms but costs −4.1 dB |
| plane 1 % / normal 20° | — | 2 % / 30° kept | ±0.00 dB |

One spatial pass instead of two: 0.42 vs 0.47 ms on `orbit`, quality not measured in full.

### 7.6 SH-6 Fallback without `h` or light (built; v0: "later")

Noise-driven radius from Heitz 2018 (§4.2 Eq. 29 for E; §4.1 for σ ∝ E and the 3×3 box):
E = total variation of the second derivative of raw visibility along 4 lines through the
pixel on the 5×5 tile (no random offset), in [0, 1], accumulated over time like g instead of
the paper's 3×3 box; radius = **24 px · E** (at 1080p). The pixel's own E only: tile minima of E are
~0 at every penumbra edge (−0.9 dB with the tile minimum). 960×540, 5 paths: 32.21 / 24.40 dB
vs 32.62 / 24.90 with hit distance (12 px: 31.65; 48 px: 32.22). Cost not re-measured (one
slow-clock run: 0.73 vs 0.47 ms).

### 7.7 SH-7 Renderer contract (documented, not enforced)

Unjittered shadow-ray origins (TR19 slides 55–62); blue-noise light samples animated with the
golden-ratio sequence (RTG II ch. 24 §24.7.2) for a scalar per pixel, and with the R_n
sequence (Roberts 2018) for 2-D samples: equal golden-ratio steps on every dimension put a
pixel's samples over time on a line (LESSONS, results; reviewer note). The test bed's
blue-noise sampler is what the clamp window (§7.4) relies on.

### 7.8 Budget as built

4 dispatches: `temporal` (with the tile statistics folded in) → `tiles` → `spatial` × 2
(indirect). Storage textures: temporal 4, spatial 1. **40 B/px** (v0 estimate ≈ 32): history
2 × 8 (`rgba16float`), own geometry ping-pong 2 × 8 (`rg32uint`), T 4 and output 4
(`r32float`: unfiltered copies the inactive tiles need), plus 12 B per 8×8 tile; 83 MB at
1080p. Sharing the diffuse/specular prepass instead would save the geometry pair but cost
0.18 ms when shadows run alone (M4 §7.7). Cost per pass (fastest run, `orbit`): temporal
0.31 · tiles 0.005 · spatial 0.08 + 0.08. Levers left: one unfiltered copy instead of two,
`shader-f16`, fewer taps in pass 2 (TASKS).

### 7.9 Later (not specified)

Heitz 2018 ratio estimator for glossy receivers; directional light (code path exists, no
capture has one: TASKS); **translucent shadows (M8)**: not specified yet (TR19's
order-independent layers are the starting source).

## 8. Occlusion (M5) — outline, **not built**

**v0.1:** unchanged from v0; no implementation yet. One part already exists: `recurrent`
diffuse writes the denoised ĥ to its output's alpha (an AO estimate, O-1), when
`hitDistance` is given.

- **O-1 Free AO/SO.** The alpha (ĥ) of `recurrent`'s diffuse and specular outputs **is** AO
  and SO (GTC20 s.9, s.54, s.63), with our falloff `1/(1 + h/h_scale)` (F-3).
- **O-2 Occlusion-only denoiser.** The same 8 passes with one `rgba16float` per pixel
  carrying `(ĥ_d, ĥ_s, –, –)` for both signals: one buffer pool instead of two, no radiance.
  Anti-lag uses the ĥ detector only; `F` holds `(ĥ_d, ĥ_s)`. ≈ 32 + 8 + 4 + 16 + 1.5 ≈
  **62 B/px**. Kernel radius and weights unchanged (the hit-distance weight and clamp do the
  edge work).
- **O-3 AO radius.** In occlusion-only mode `h_scale = aoRadius` (b = 0), a world constant,
  the usual AO parameter. Default 1 world unit.
- **O-4 Cheap SO without specular rays:** Lagarde & de Rousiers 2014 Listing 26 from AO
  (empirical; optional output, not a denoiser).

## 8.5 SH/SG directional variants (M7) — **not specified**

PLAN §7 M7: directional payload through the same filters plus a resolve step for the caller.
No design yet; it waits until the recurrent diffuse/specular defaults settle (review item 1).

---

## 9. Output, remodulation, API notes

- Default output is **demodulated**: captures and metrics compare in that space, and callers
  usually composite with their own material terms. **v0.1:** built as `remodulate: false`;
  with `remodulate: true` the last pass multiplies by the caller's `inputs.demodulation`
  (diffuse: or `guides.albedo`), fused into the last à-trous iteration (svgf) or written to
  separate textures by R7 (recurrent). v0's `output: 'demodulated' | 'remodulated'` and
  in-denoiser E (F-2) were not built (§1.2).
- **v0.1:** `DiffuseDenoiser` / `SpecularDenoiser` return one texture each;
  `DiffuseSpecularDenoiser.dispatchBoth()` returns `{ diffuse, specular }` and `dispatch()`
  returns diffuse. The recurrent output texture rotates between internal buffers: valid
  until the next dispatch (the `TemporalDenoiser` contract), so callers must not cache it.
- AO/SO: in the outputs' alpha (O-1); recurrent diffuse only so far.

---

## 10. WebGPU resource plan

**v0.1:** measured memory and cost against PLAN §8 are in §10.3; §10.1–10.2 keep the
allocation plans, updated to what was built.

### 10.1 Recurrent (diffuse + specular)

Buffer rotation per signal (4 × `rgba16float`, W×H). At frame start: `P` = `H_prev`,
`Q` = `S_prev`; `R`, `S` free. **v0.1:** built exactly like this (`src/recurrent.ts`).

| pass | reads | writes | after the pass |
|---|---|---|---|
| R1 | P (ĥ guide) | R = `pre` | |
| R2 | R, P (reprojected) | S = `acc` | P free |
| R3 | S | P ← signal mip atlas | |
| R4 | S, P (atlas) | R = `fix` | P free again |
| R5 | R | P = `blur` | |
| R6 | P, S (centre) | R = `H` (next history) | |
| R7 | R, Q (reprojected) | P = `S_new` (next stabilization history) | next frame: P' = R, Q' = P |

| resource | format | count | B/px |
|---|---|---|---|
| signal buffers (diffuse, specular) | rgba16float | 2 × 4 | 64 |
| fast history `F` (both signals in one texture) | rgba16float | 2 (ping-pong) | 16 |
| `data` | r32uint | 2 (ping-pong) | 8 |
| `G`, `G_prev` | rg32uint | 2 | 16 |
| depth mip atlas | r32float | 0.375 | 1.5 |
| **total internal** | | | **105.5** (≈ 219 MB at 1080p) |
| optional remodulated outputs | rgba16float | 2 | +16 |

Diffuse only: 32 + 16 + 8 + 16 + 1.5 = **73.5 B/px**. (The README's 109.5 / 77.5 included
the depth slope, which recurrent-only pipelines skip since commit 25c80aa.) Ready cut:
`F` at half resolution (−12 → **93.5 B/px**), at some cost in hit-distance accuracy at edges
for virtual motion. Review item 4. Inputs (caller-owned, ~32 B/px) are not counted.

Storage textures per dispatch: R0 1, R1 2, R2 4, R3 3, R4 3, R5 2, R6 2, R7 2 (4 with
remodulated outputs). Read-write storage only on `r32uint` (`data`), which core WebGPU
allows. No optional features required; `shader-f16` and subgroups are optional speedups.

### 10.2 SVGF

**v0.1, as built** (README): per signal `accum` ping-pong 16, `moments` (rg32float) ping-pong
16, à-trous ping-pong 16, output 8 = 56 B (+8 with `feedback: true`); shared `G` pair 16 +
depth slope 4. Diffuse + specular: **132 B/px** (148 with feedback; v0 estimated 112 without
the output and slope). `antiLag` adds ~7.6 B/px per signal (4 × rgba32float + r32float at
1/9 resolution): **≈ 147 B/px**. SVGF was meant as the baseline, not the memory-target
filter; if it becomes the diffuse default (review item 1) the budget question applies to it.

### 10.3 Measured cost and memory vs PLAN §8

PLAN §8: diffuse + specular ≤ 4 ms and ≤ 100 B/px on the M5 Pro at 1080p; shadows ≤ 0.6 ms;
≤ 2× native on the same GPU; quality within ~0.5 dB of native.

| configuration | dispatches | GPU ms (1080p, M5 Pro) | B/px | vs PLAN §8 |
|---|---|---|---|---|
| SVGF diffuse + specular (`feedback: false`, `antiLag: 'off'`) | 8 | **4.20** (test-bed warmed replay, M1 §6); 3.98 (dev page, README) | 132 | ms ≈ at target (5 % over on the test bed); memory over |
| A-SVGF diffuse + specular (`antiLag: 'auto'`) | 15 | 6.31 (replay); 5.43 (dev page) | ≈ 147 | 1.6× over; memory over |
| recurrent diffuse only | 8 | 2.92 (dev page, before the shared tiles) | 73.5 | — (SVGF diffuse alone: 2.11–2.18) |
| recurrent diffuse + specular, shared dispatches | 8 | **5.41** (dev page, commit 25c80aa; virtual motion on) — **in flux** | 105.5 | 1.35× over; memory 5.5 % over |
| `filter: 'recurrent'` joint default today (recurrent diffuse + A-SVGF specular, two pipelines) | 22 | 6.48 (README, before the shared tiles) | ≈ 141 | over |
| skeleton: 8 recurrent passes with trivial kernels, both signals | 8 | 0.96 | — | dispatch + centre I/O ≈ ¼ of 4 ms |
| shadows | 4 | **0.43–0.64** fastest clock state (6 of 7 paths ≤ 0.6; `thin` 0.64), medians 0.47–0.86; FFX 0.50–0.73 | 40 (+12 B per tile) | at target except penumbra-heavy views |

The M5 Pro runs solo benches in two clock states (every pass ×1.3–1.8 in the slow one), so
M4 reports the fastest run and the median; M1 reports medians with ±15 % run-to-run spread.

Not measurable yet: **≤ 2× native** (needs our WGSL on the Windows RTX machine, NATIVE-HARNESS
phase 5) and **quality vs native** (the Windows side has replayed only the synthetic-plane
captures: SVGF within 1.6 dB of RELAX on static diffuse and above both native denoisers
elsewhere, M1 §7; the blue-noise test-bed captures await their native replay).

v0 estimated recurrent at 3.5–5 ms "at risk"; measured 5.41 ms for both signals with 0.96 ms
of skeleton. Levers measured or in progress (TASKS, T3): done: affine taps, branchless taps,
shared tiles, no slope; open: 4-tap kernels per pass (uncommitted, in flux), fuse the
prepass into R1 (−0.10 ms), `shader-f16`, half-res `F`. Review item 3.

---

## 11. What's next for implementers (v0.1)

1. **T3:** finish recurrent specular; its results (and the notes at the end of §5.6) get
   folded into §5.6 in the next SPEC revision.
2. **Same-page rerun** of recurrent diffuse against today's SVGF defaults (`feedback: false`,
   both anti-lag settings), test bed 1080p, 7 paths, plus the joint budget numbers (TASKS).
   This is the main input to review item 1.
3. **Native replays** of the blue-noise test-bed captures (Windows), for the PLAN §8 quality
   target and the M2 go/no-go.
4. **M5 occlusion** per §8 once item 1 is decided (O-2 reuses the recurrent passes).
5. A real scene for tuning and scoring (review item 5).

---

## 12. Open for Dennis's review (taste calls)

**v0.1:** rewritten. Dropped because measurements settled them: SVGF feedback (off: +0.6 …
+2.6 dB diffuse on every path, M1 §4); the recurrent history cap (31; 15 and 63 measured
flat); anti-lag placement (two renderer-free detectors before the blurs, C-10 and C-10b,
both measured); default output space (demodulated, built as `remodulate: false`);
checkerboard (PLAN non-goal). The memory question is now item 4.

1. **Is recurrent still the expected default?** PLAN §4.2 expects it to ship as the default;
   M2's exit criterion is "beats M1 on quality or cost". Today, on the test bed (same
   preset, two runs), recurrent diffuse is **38.42 dB** vs SVGF (feedback off) **39.00** and
   A-SVGF auto **39.27**. Per path, recurrent − SVGF: orbit −0.83, pan −1.07, light −0.65,
   thin −0.23, glossy +0.24, cut −0.67, object −0.82 dB. It also costs more: recurrent
   diffuse 2.92 ms vs SVGF diffuse 2.11–2.18. It flickers slightly more (0.0038 vs 0.0032) and
   is weaker in disocclusions. The "beats A-SVGF on 6 of 7" in the README/TASKS was measured
   against feedback-on SVGF, before that default changed. Where recurrent can still earn its
   place: specular (virtual motion and lobe kernels address SVGF's two worst failures, mirror
   over-blur and glossy lag, M1 §8.1–8.2), free AO/SO (ĥ), and native parity (unmeasured).
   Choices: (a) SVGF for diffuse, recurrent for specular if M3 wins; (b) keep recurrent for
   both and tune diffuse against SVGF-feedback-off as the bar; (c) decide after the native
   replays. The spec author leans (a) on today's numbers, pending the same-page rerun (§11.2).
2. **SVGF anti-lag default.** `'off'` (built default): 4.20 ms, at the budget; slow recovery
   from lighting changes (specular ~9 frames after the `light` flip). `'auto'`: +0.27 dB
   diffuse, +1.23 dB specular, ~3-frame recovery, lower FLIP and flicker, +2.1 ms (6.31).
   Middle: `'auto'` for specular only (most of the gain, two pipelines). Free either way:
   per-signal α_min (diffuse 0.1: +1.2 dB with `'off'`), recommended but not applied.
3. **The 4 ms budget.** Measured: SVGF 4.20, A-SVGF 6.31, both-recurrent 5.41 (T3 is cutting).
   Is ≤ 4 ms firm (the defaults must fit it, quality options may exceed it), or is the
   Windows "≤ 2× native" the target that matters, with the M5 Pro number a guide?
4. **Memory over 100 B/px** in every diffuse + specular configuration: recurrent 105.5
   (half-res `F` → 93.5), SVGF 132 (≈ 147 with anti-lag), today's mixed default ≈ 141.
   Shadows 40 (v0 estimated 32: own geometry ping-pong instead of the shared prepass).
   Accept, or require the cuts? If SVGF becomes the diffuse default (item 1), its memory has
   no plan yet.
5. **Tuned on the scene it is scored on.** Every default (SVGF sweep, recurrent radii and
   anti-lag, shadows clamp and radius) was tuned on the one analytic test-bed scene and scored
   on the same paths. The dev page and the test bed already disagree by 2–3 dB on recurrent vs
   SVGF. Which real scene (PLAN §9), and do the defaults wait for it?
6. **Shadows.** (a) Fresh histories: for ~5 frames after a reset or disocclusion ours is
   noisier than FFX (`std1080-orbit` frame 0: 31.6 vs 34.8 dB, level by frame 7); a wider
   kernel for young pixels lost; more taps where A < 3 would cost time. Accept? (b) `thin`
   0.64 ms vs ≤ 0.6 (6 of 7 paths under); levers exist. (c) Uniform snap exists because the
   mean of per-frame dB scores empty frames at 120 dB (`pan` +10.7 dB, other paths
   −0.00 … −0.06 dB). Keep it? And should results report PSNR of the mean MSE instead?
7. **API as built** (§1.2, §9): `remodulate` + caller-supplied demodulation texture instead
   of `f0` and in-denoiser E; `dispatchBoth` for two outputs; A-SVGF `'gradient'` as an
   input-texture contract (the renderer forward-projects and re-shades with old seeds; no
   producer exists yet). Ship `'gradient'` as an opt-in mode, or keep it test-bed-only?
   Shadows standalone, or share one guide prepass across denoisers (needs an API for it)?
8. **Listing policy** (v0 item 1, unchanged). We don't use formulas from RTG II ch. 49's
   numbered listings even though `sources/reblur.md` transcribed them; we do use GTC 2020
   **slide** formulas (radius 1/(1+A), history-fix start level). Keep, relax, or tighten?
9. **Hit-distance curve** (v0 item 2). Rational `h/(h + h_scale)` (never clips; AO with a
   soft `1/(1+h/s)` falloff) instead of `saturate(h/h_max)` (classic AO radius look). Decides
   how AO/SO look at M5.
10. **Pre-blur strength.** Now 25 px diffuse (+0.10 dB over 15). The bias is permanent near
    contacts (contact-limited by D1b). Look at contact GI on captures before freezing.
11. **Glossy kernel elongation** (`κ_e = 0.75`, R-4): how stretched glossy reflections look.
    Judge with M3's results.
