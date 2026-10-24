# SPEC v0: our real-time denoisers (`denoiser/realtime`)

_v0, 2026-10-24, spec author (RULES.md rule 8: may not see NRD code; writes our design).
Status: **provisional until Dennis reviews** (TASKS T0.1). M1 (SVGF) may be built from this
now; M2+ may start against it, marked provisional._

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
| `guides.albedo`, `f0` | `FrameGuides` (+ proposed `f0?`) | only when inputs are **not** demodulated, or for remodulated output |
| radiance (rgb), `hitDistance` | `DiffuseInputs`, `SpecularInputs` (`DiffuseSpecularInputs` for both) | diffuse / specular |
| `visibility`, `hitDistance` (occluder distance), light | `ShadowInputs` (+ proposed `light`) | shadows |
| camera | `FrameCamera` (current + previous view, unjittered projection, jitter, near/far, position) | all |
| reset | `resetHistory()` or capture `frame.reset` | all |

**Proposed API additions** (owner: package skeleton, T0.5; listed under "Found along the
way" in TASKS): `FrameGuides.f0?`; `ShadowInputs.light` (`{ type: 'sphere', position,
radius } | { type: 'directional', direction, angularRadius }`, same fields as the capture's
`lights`); an option `inputDemodulated` (default `true`, matching captures) and
`output: 'demodulated' | 'remodulated'` (default `'demodulated'`, see §9).

**C-4 Hit distance input.** World units, primary segment excluded. `0` means **miss**
(ray escaped) and is treated as `h = ∞`. The capture format also uses 0 for "lobe not
sampled"; v0 assumes every pixel traces both lobes (our test bed does), so 0 is always a
miss. If probabilistic lobe selection is ever used, "not sampled" needs its own value
(proposed: negative), and the pre-blur fills those pixels from neighbours.

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

---

## 2. Front end (signal preparation)

Runs per tap wherever a pass reads a raw input (pre-blur in `recurrent`, temporal
accumulation in `svgf`), so it costs no dispatch.

**F-1 Sanitize.** Non-finite → 0. Negative → 0. Clamp each channel to `maxRadiance`
(default 1e4 in demodulated units, leaving fp16 headroom for sums). Tune: [1e3, 6e4]. This is a safety
clamp, not the firefly filter (D9).

**F-2 Demodulation** (only when `inputDemodulated = false`; captures arrive demodulated):

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
- Storage: `recurrent` packs A into the `data` texture (§6.9); `svgf` stores it in the
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

### 3.6 History repair from mips (C-11)

Defined with the recurrent pipeline (§6.5, D7); usable by `svgf` as an experiment
(default off there: the paper's spatial-variance fallback covers fresh pixels).

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
  `α_c = max(α_min, 1/(1 + min(A, A_spec)))`, `A_spec` from R-6 (§6.6). Virtual motion is M3.

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

### 4.5 Parameters at a glance

| parameter | default | source | tune |
|---|---|---|---|
| α_min | 0.2 (0.1 with A-SVGF) | S1 p.5, S2 p.10 | [0.05, 0.2] |
| α_mom | = α_min | S1 §4.2 | [α_min, 0.6] |
| A_cap | 63 | S3 | — |
| plane τ / cosN | 0.01 / 0.95 | RTG2 p.831 / S3 | [0.005, 0.015] / [0.8, 0.98] |
| spatial variance below | A < 3 | S1 p.5 | — |
| K, kernel | 5, B3 5×5 | S1 | [4, 5], 3×3 box |
| σ_z, σ_n, σ_l | 1, 128, 4 | S1 p.5 | — |

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

---
