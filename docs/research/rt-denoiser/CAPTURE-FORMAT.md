# Capture format v0 (final) and v1

_v1 (2026-10-25, testbed-v1) adds the buffers SPEC v0.3 asks for (M7 SH/SG directional variants, M8
translucent shadows) as a strict superset: every v0 capture stays a valid v0 capture, a capture with
only v0 buffers is still written as version 0, and v0 readers can read a v1 capture by ignoring the
buffers they don't know. See [v1](#v1-directional-payloads-and-translucent-shadows) at the end._

The contract between our renderer (which writes captures) and anything that replays them:
our WGSL denoisers, and the native NRD harness on Windows. Captures stay in **our**
conventions. Converting to NRD's conventions is the harness's job, because only the harness
builder may read NRD's headers ([RULES.md](RULES.md) rule 4).

No EXR dependency on either side: buffers are raw little-endian `float32`, described by a
JSON manifest. Tools that read, write, check and score captures live in
[`tools/rt-capture/`](../../../tools/rt-capture/) (generator, validator, replay, compare,
PNG/PFM preview).

_Changelog:_
- _v1, 2026-10-25 (testbed-v1): buffers `normal_geom`, `diffuse_dir`, `specular_dir`, `diffuse_sh_ref`,
  `specular_sh_ref` (SPEC M7-4), `transmittance`, `translucent_dist`, `shadow_rgb_ref` (SPEC §7.10.4);
  `"version": 1` when any of them is present; per-frame `lights` made official; v1 signals
  `sh-diffuse`, `sh-specular`, `shadow-rgb` for replay outputs, and their metrics. Additive: v0
  captures validate, replay and score bit-identically._
- _v0 final, 2026-10-24 (capture-io): added `motion_z` (2.5D motion), the exact specular
  demodulation term (Karis 2014 analytic env-BRDF), the jitter and sky conventions, one
  shadow light per capture with a forward-compatible `lights` array, `static`, and the
  metric definitions for replay outputs._
- _v0 draft, 2026-10-24 (orchestrator): layout, buffers, manifest, output layout._

## Layout

```
<capture>/
  capture.json             # manifest: scene, size, buffers, lights, frames
  frame_0000/
    depth.f32  viewz.f32  normal.f32  roughness.f32  motion.f32  motion_z.f32
    albedo.f32  f0.f32
    diffuse.f32  diffuse_hitt.f32  diffuse_ref.f32
    specular.f32 specular_hitt.f32 specular_ref.f32
    visibility.f32 occluder_dist.f32 visibility_ref.f32
  frame_0001/ ...
```

Every `.f32` is `width × height × channels` floats, row-major, **row 0 = top of the image**,
channels interleaved, little-endian. File size is exactly `width·height·channels·4` bytes.
A buffer that a capture doesn't include is simply absent and isn't listed in the manifest.
Every listed buffer exists in every frame. Readers ignore buffers they don't know.

## Coordinate conventions

- **World and view space** are three.js's: right-handed, +y up, the camera looks down
  **−z** in view space, so a visible point has **negative** view z.
- **Clip space** is WebGPU's: `projection` maps view space to NDC x, y ∈ [−1, 1] with
  **+y up**, and NDC z ∈ [0, 1] (0 = near unless `reversedDepth`).
- **Pixel ↔ NDC.** Pixel `(px, py)` (x right, y down, row 0 at the top) has its centre at
  `uv = ((px + 0.5)/W, (py + 0.5)/H)` and `ndc = (2·uv.x − 1, 1 − 2·uv.y)`. In UV space
  (origin top-left, v down) a motion vector is `Δuv = (0.5·motion.x, −0.5·motion.y)`.
- **Jitter** `[jx, jy]` is in pixels, same axes as pixels (x right, y down): the primary
  ray of pixel `(px, py)` goes through the unjittered image position
  `(px + 0.5 + jx, py + 0.5 + jy)`. Its NDC is the **sample position** below. (The
  jittered projection therefore adds `(−2·jx/W, +2·jy/H)` to NDC.) `[0, 0]` = no jitter.
- **Sample position** of a pixel = its centre plus jitter, in NDC. The surface point seen
  by the pixel is `P = inverse(projection · view) · (ndc_sample, depth, 1)` (homogeneous
  divide), with the manifest's unjittered matrices.
- **Sky** (no primary hit): `depth` = far-plane value (1, or 0 with `reversedDepth`),
  `viewz` = −far, `normal` = 0,0,0, signals finite (0 is fine). Sky `motion` should be the
  reprojection of the far-plane point (camera rotation), but nothing may rely on it; the
  validator and the metrics skip sky pixels.

## Buffers

| name | ch | meaning | conventions |
|---|---|---|---|
| `depth` | 1 | device depth of the primary hit | NDC z of `P` under `projection` (unjittered); [0,1]; `reversedDepth` in the manifest |
| `viewz` | 1 | view-space z of the primary hit | `(view · P).z`; **in front is negative**; sky = −far |
| `normal` | 3 | world-space unit normal | [−1,1], facing the camera side of the surface; sky = 0,0,0 |
| `roughness` | 1 | perceptual roughness r | [0,1]; GGX α = r² |
| `motion` | 2 | screen motion of the surface point | NDC delta, **current − previous**: `ndc_sample − ndc_prev`, where `ndc_prev` = `prevProjection · prevView · P` (unjittered) for a static point; three's `velocity`; +y up |
| `motion_z` | 1 | 2.5D motion z (optional) | `viewZprev − viewZ` in **our** sign: `(prevView · P_prev).z − viewz`, both negative in front (camera moving toward a surface gives a negative value) |
| `albedo` | 3 | diffuse reflectance ρ | demodulates diffuse: `diffuse = L_diff / max(ρ, 1e-3)` per channel |
| `f0` | 3 | specular reflectance at normal incidence | demodulates specular with the term below |
| `diffuse`, `specular` | 3 | 1-spp noisy radiance, **demodulated** | linear HDR, not pre-exposed, no primary emission; finite everywhere |
| `diffuse_hitt`, `specular_hitt` | 1 | hit distance of the sampled ray | world units, primary segment excluded; 0 = miss / lobe not sampled |
| `diffuse_ref`, `specular_ref` | 3 | converged reference of the same estimator, same frame | same space as the noisy signal |
| `visibility` | 1 | 1-ray shadow visibility toward the shadow light | {0,1} or [0,1]; 1 = lit |
| `occluder_dist` | 1 | distance from the surface to the blocker for that ray | world units; 0 = unoccluded, or self-shadowed (light below the surface's horizon) when `visibility` = 0 |
| `visibility_ref` | 1 | converged visibility | [0,1] |

`P_prev` is where the surface point was in the previous frame (`P_prev = P` in a static
scene). With object motion, `motion` and `motion_z` carry it; the matrices alone don't.

### 2.5D motion and NRD's convention

NRD's recommended motion mode is 2.5D with z = viewZprev − viewZ, motion meaning
"old = new + MV" ([sources/nrd-provenance.md](sources/nrd-provenance.md) §3.2), and NRD
accepts viewZ of either sign. So, for the harness:

- If NRD is given our `viewz` as is (negative in front), pass `motion_z` unchanged.
- If NRD is given positive viewZ (`−viewz`), pass **`−motion_z`**, so z stays
  viewZprev − viewZ in NRD's own sign.
- NRD's MV is previous − current, the opposite of our `motion`; its xy units and y
  direction are set by `motionVectorScale`/bias (harness's job; our UV-space delta is
  above).

### Specular demodulation term (exact)

`specular = L_spec / max(E, 1e-3)` per channel, and remodulation is `L_spec = specular · E`,
with the split-sum pre-integrated term (Karis 2013, Eq. 7–8) in the analytic mobile
approximation of Karis 2014 ("Physically Based Shading on Mobile"), f90 = 1:

```
E(f0, r, NdotV):        r = perceptual roughness, NdotV = clamp(dot(N, V), 1e-4, 1),
                        V = normalize(cameraPosition − P)
  c0 = (−1, −0.0275, −0.572,  0.022)
  c1 = ( 1,  0.0425,  1.040, −0.040)
  t  = r · c0 + c1
  a004 = min(t.x · t.x, exp2(−9.28 · NdotV)) · t.x + t.y
  A = −1.04 · a004 + t.z
  B =  1.04 · a004 + t.w
  E = f0 · A + B
```

The manifest names it: `"demodulation": { "diffuse": "albedo", "specular": "karis2014-envbrdf-approx" }`.
(A LUT-based term, or Frostbite's f90 variant, would be a new name there; none is used in v0.)

### Lights

v0 has **one shadow light per capture**: the entry in `lights` with `"shadow": true`
(exactly one if the capture has visibility buffers). The array is forward-compatible:

```jsonc
"lights": [
  { "id": "key", "type": "sphere", "position": [0, 4, 0], "radius": 0.25, "shadow": true },
  { "id": "sun", "type": "directional", "direction": [0.3, 0.9, 0.2], "angularRadius": 0.0047 }
]
```

- `sphere`: `position` (world), `radius` (world units).
- `directional`: `direction` is the unit vector **from the surface toward the light**;
  `angularRadius` in radians (the sun is about 0.0047).
- `color`, `intensity` optional, informational.
- Later versions add per-light buffers named `visibility_<id>`, `occluder_dist_<id>`,
  `visibility_ref_<id>` for multi-light captures; v0 readers ignore them.

## `capture.json`

```jsonc
{
  "version": 0,
  "scene": "synthetic-plane",        // generator / scene id
  "generator": "tools/rt-capture/gen-synthetic.mjs",   // free text: who wrote it (+ commit)
  "width": 256, "height": 256,
  "reversedDepth": false,
  "static": true,                    // no object motion: motion follows from depth + matrices
  "demodulation": { "diffuse": "albedo", "specular": "karis2014-envbrdf-approx" },
  "lights": [ { "id": "key", "type": "sphere", "position": [0, 4, 0], "radius": 0.25, "shadow": true } ],
  "buffers": [ { "name": "diffuse", "channels": 3 }, ... ],
  "referenceSpp": 256,               // 0 = analytic (exact) reference
  "frames": [
    {
      "index": 0,                       // consecutive from 0; folder frame_NNNN (4 digits)
      "reset": true,                    // camera cut / first frame: history must be dropped
      "camera": {
        "view": [16 floats], "projection": [16 floats],          // column-major, projection WITHOUT jitter
        "prevView": [16 floats], "prevProjection": [16 floats],  // = previous frame's view/projection (or own, on reset frames)
        "jitter": [0, 0],                 // pixels, see conventions
        "near": 0.1, "far": 100, "position": [x, y, z]
      }
    }
  ]
}
```

Matrices are three.js `Matrix4.elements` (column-major), the same as `FrameCamera` in
`packages/denoiser-core/src/temporal.ts`. Frame 0 always has `reset: true`. Unknown
manifest keys are ignored by readers.

## Outputs from a replay

Results use the same raw format:

```
outputs/<capture>/<denoiser>/
  run.json                        # identity + settings, see below
  timings.csv                     # frame,pass,ms
  frame_NNNN/<signal>.f32         # denoised <signal>, same channel count as the input
```

- `<signal>` is the noisy input's name (`diffuse`, `specular`, `visibility`), so each
  output compares directly against `<signal>_ref` of the same frame. Outputs are in the
  same demodulated space as the inputs.
- `run.json`: `capture`, `denoiser` (id), `version` or `commit`, `settings`, `signals`,
  `frames`, `width`, `height`, `gpu` (adapter vendor/architecture/description), `driver`,
  `os`, `date`.
- `timings.csv`: one row per frame and pass, `ms` as measured by the runner (GPU
  timestamps when available; `wall` = submit-to-done wall time with a queue sync, which
  includes overhead). Pass names are free text; `total` is the sum of the denoiser's
  passes when it reports per-pass times.

## Metrics for replay outputs

`tools/rt-capture/compare.mjs` scores every output, ours and native, with exactly these
definitions (they match `examples/ffx-denoiser/src/eval.ts`), so numbers are comparable:

- **Scored pixels:** non-sky (`0 < depth < 1`), in that frame.
- **Tonemap** `T`: RGB signals (3 channels): Reinhard per channel on the demodulated value,
  `T(x) = max(x, 0) / (1 + max(x, 0))`, no exposure. Scalar signals (1 channel):
  `T(x) = clamp(x, 0, 1)`.
- **Per-pixel error** `e = T(out) − T(ref)` per channel; `s = mean over channels of e`.
- **PSNR** per frame: `MSE = mean over scored pixels and channels of e²`,
  `PSNR = 10 · log10(1 / max(MSE, 1e-12))` (peak 1). Sequence PSNR = **mean of per-frame
  dB**. "Settled" = skipping the first 8 frames after each reset (frame 0 included).
- **Three sequence PSNRs** (added 2026-10-25; the per-frame mean keeps its old field names):
  - *per-frame mean* (`psnr`, `psnrSettled`, `psnrPenumbra`): the mean of per-frame dB above.
    A frame with (almost) no error scores up to 120 dB (the 1e-12 floor), so a few near-empty
    frames (e.g. no shadow on screen, every output exactly 1) can lift the mean far above
    what a viewer sees.
  - *pooled* (`psnrPooled`, `psnrSettledPooled`, `psnrPenumbraPooled`): the PSNR of the mean
    MSE, `10 · log10(1 / max(Σ e² / Σ n, 1e-12))`, sums over every frame in the window (all,
    or settled only) and every scored pixel and channel of the region. Every pixel-frame
    weighs the same; near-empty frames add little error and little weight. **Use this one
    to rank denoisers.**
  - *capped* (`psnrCapped`, `psnrSettledCapped`, `psnrPenumbraCapped`): the mean of per-frame
    dB with each frame clipped at **60 dB** first (`PSNR_CAP_DB` in `lib/capture.mjs`; 60 dB
    = RMS error 0.001, below anything visible in 8-bit output). Still a mean of dB, so
    it still favours frames with little error, but no single frame can add more than 60 dB.
  - The live test bed (`examples/realtime-denoiser`) reports the same three
    (`psnrDen` / `psnrDenPooled` / `psnrDenCapped`, plus `…Settled…`). Its **region**
    numbers (`regions.<name>.psnrDen`, e.g. its penumbra PSNR) were always pooled; it adds
    `psnrDenMean` / `psnrDenCapped` there. `compare.mjs`'s `psnrPenumbra` is a per-frame
    mean, so compare its `psnrPenumbraPooled` with the test bed's penumbra column.
- **Penumbra region** (scalar signals only): scored pixels with `0.02 < ref < 0.98`;
  PSNR and bias over those.
- **Flicker** per frame t (t not a reset frame): mean over pixels scored in t and t−1 of
  `|s_t − s_{t−1}|`, the frame-to-frame change of the signed error at a fixed pixel.
  Sequence flicker = mean over those frames. Lower is better; a perfect output is 0.
  (eval.ts takes s = 0 for pixels not scored in t−1; the difference is negligible.)
- **Bias**: mean of `s` over scored pixels (penumbra pixels for scalar signals), averaged
  over frames. Negative = darker than the reference.
- **Non-finite**: count of NaN/Inf output values (never scored silently).
- The noisy input is scored the same way as a baseline.

## v1: directional payloads and translucent shadows

Added for SPEC v0.3 M7 (SH/SG directional variants, §8.5) and M8 (translucent shadows, §7.10). Written
by the test bed (`examples/realtime-denoiser`, CAPTURES.md "v1 captures"); read by `tools/rt-capture`
(replay, validate, compare, preview).

**Version.** `"version": 1` when the capture has any buffer of the table below, else 0. Nothing in v0
changes meaning; a v1 reader accepts both.

### v1 buffers

| name | ch | meaning | conventions |
|---|---|---|---|
| `normal_geom` | 3 | smooth normal the **filter** should use | world-space unit, faces the camera, sky 0. Geometric or interpolated-vertex normal. `normal` stays the **shading** normal: the normal-mapped (detail) normal the rays were sampled around and specular was demodulated with. Equal to `normal` on surfaces without a normal map |
| `diffuse_dir` | 3 | direction ω of the 1-spp diffuse ray | world-space unit vector of the ray whose radiance `diffuse` holds (cosine lobe around `normal`); sky 0 |
| `specular_dir` | 3 | direction ω of the 1-spp specular ray | as above, after the renderer's below-horizon handling (the test bed mirrors about `normal`'s tangent plane); sky 0 |
| `diffuse_sh_ref` | 6 | converged M7-2 payload `(a, b.x, b.y, b.z, Co, Cg)` | mean over the reference's samples of each sample's payload (below), sampling normal n_s = `normal`; world space. The payload is linear, so this is exact for the estimator |
| `specular_sh_ref` | 6 | the same for specular | n_s = the sampling lobe's dominant direction D_s (below) |
| `transmittance` | 3 | RGB transmittance T of the 1-ray shadow sample | `Π t_i` over the translucent layers the ray crossed toward the shadow light; (1, 1, 1) when it crossed none, **and wherever `visibility` = 0** (T is meaningless there) |
| `translucent_dist` | 1 | distance to the nearest translucent layer with `min_c t_i < 1` | world units from the surface; 0 = none (and wherever `visibility` = 0) |
| `shadow_rgb_ref` | 3 | converged `v·T` | [0, 1] per channel; ≤ `visibility_ref` per channel |

**Visibility with translucent layers (SPEC M8-1).** `visibility` stays the **opaque** visibility:
1 = the ray reached the light past every opaque surface. Translucent layers only multiply T (order
independent). Once `max_c T < 0.01` along the ray, the ray counts as opaque: `visibility` = 0 and
`occluder_dist` = that layer's distance. A renderer may cap the number of layers (past the cap: opaque);
the test bed has no cap. `visibility_ref` is the mean of that opaque `visibility`.

**The M7-2 payload of one sample** (radiance L, demodulated as the plain signal; ray direction ω;
sampling normal n_s). YCoCg after Malvar & Sullivan 2003:

```
Y = ¼R + ½G + ¼B,   Co = ½R − ½B,   Cg = −¼R + ½G − ¼B      (R = Y + Co − Cg, G = Y + Cg, B = Y − Co − Cg)
c = n_s·ω,   β = 2 / (1 + 2·max(c, 0))
a = Y·(1 − β·c),   b = β·Y·ω,   Co, Cg                     → a + b·n_s = Y for every sample
```

For c ≥ 0 this is SPEC M7-2's `a = Y/(1 + 2c)`, `b = 2Yω/(1 + 2c)`. c < 0 happens only for specular
(n_s = D_s, a direction the rough lobe can sample behind); there β stays 2, which keeps the payload exact
at n_s and its weights bounded (our choice; SPEC M7-2 only covers c ≥ 0). Rays the renderer returns as
L = 0 (e.g. below the geometric surface of a normal-mapped one, SPEC M7-4) contribute a zero payload
and still count in the mean.

**Specular dominant direction** (SPEC R-2, Frostbite's simple fit with GGX α = r²):
`D_s = normalize(lerp(n, reflect(−v, n), (1 − α)(√(1 − α) + α)))`, n = `normal`, v = unit vector from the
surface point to the camera.

**Consistency** (validate.mjs checks it): when `*_sh_ref` and `*_ref` average the same samples (the test
bed does), `a + b·n_s` equals YCoCg-Y of `*_ref`, and Co / Cg equal its chroma, up to rounding (the f16
`normal` limits it to ~0.3 %).

**Per-frame lights.** `frames[i].lights` (same schema as the capture-level `lights`) is now part of
the format: when present it overrides `lights` for that frame (the test bed's `light` path moves and
resizes the light). Other per-frame extras stay informational: `object` (the moving sphere),
`translucent` (glass build: panel pose), `pathFrame`.

### v1 signals: inputs, outputs and scoring

Three signals with no noisy buffer of their own (format.ts / lib `V1_SIGNALS`):

| signal | needs | replay input (`ReplayFrame.inputs[signal]`, replay.ts) | output `<signal>.f32` (3 ch) | scored against |
|---|---|---|---|---|
| `sh-diffuse` | `diffuse`, `diffuse_dir` | `{ radiance: diffuse, direction: diffuse_dir, hitDistance }` (SPEC M7-4 raw form) | demodulated rgb **resolved at `normal`** | `diffuse_ref` (+ resolved `diffuse_sh_ref`) |
| `sh-specular` | `specular`, `specular_dir` | `{ radiance: specular, direction: specular_dir, hitDistance }` | demodulated rgb resolved at `normal` | `specular_ref` |
| `shadow-rgb` | `visibility`, `transmittance` | `{ visibility, hitDistance, translucency, translucencyHitDistance, radiance: v·T, visibilityLumT: v·lum709(T) }` (SPEC M8-8 names; the last two are derived on load for baselines) | rgb `v̂·τ̂` (what multiplies the light) | `shadow_rgb_ref` |

`ReplayFrame.guides.geometricNormal` = `normal_geom`; `shGuides(frame)` returns the guides an SH
denoiser filters with (`normal` = `normal_geom`, `detailNormal` = `normal`). A 6-channel buffer is
uploaded as two rgba32float textures, `textures[name]` (channels 0–3) and `textures[name + '#4']`.

**Metrics** (compare.mjs and the live test bed, same definitions):

- `sh-diffuse`, `sh-specular`: everything an rgb signal gets (Reinhard), against `*_ref` (the total
  error, SPEC M7-13 reference (2)); noisy baseline = the plain sample. Plus:
  - **bump region**: scored pixels with angle(`normal`, `normal_geom`) > 5°; pooled PSNR there;
  - **detail band** in the bump region: band = x − G(x), G = Gaussian σ = 2 px (radius 6) over scored
    pixels only (masked, normalized; separable with the mask folded into the inner sums), on the Reinhard
    values; pooled PSNR of band(out) vs band(ref) and the energy ratio Σ band(out)² / Σ band(ref)² (1 =
    detail kept, < 1 bumps smoothed away, > 1 noise);
  - **floor fraction**: scored pixels whose output rgb is exactly 0 (ringing into the resolve's
    max(0, ·), SPEC M7-13);
  - `sh-diffuse` only, **vs SH ref** (SPEC M7-13 reference (1), the denoising error alone):
    `diffuse_sh_ref` resolved like SPEC M7-8 (guard k) + M7-9 (sharpening s) at `normal` with
    `normal_geom` as the guide normal; compare.mjs `--sh-k 1 --sh-s 0`, test bed `&refK=&refS=`; set them
    to the denoiser's resolve. Because the reference payload is exact at its sampling normal, this
    reference differs from `diffuse_ref` only by the guard, the chroma ratio and the sharpening.
- `shadow-rgb`: each channel clamped to [0, 1] (T is a transmittance, so the Reinhard rule does not
  apply); penumbra = any reference channel in (0.02, 0.98) (bias over those pixels, as for visibility);
  **tint region** = reference `max_c − min_c > 0.02` with its pooled PSNR and the **chroma error** mean
  over pixels of mean_c |S_c/ΣS − R_c/ΣR| (sums floored at 1e-4); the dynamic / static split, flicker,
  tPSNR and boil of visibility, computed on the per-pixel mean of the clamped channels; noisy baseline =
  `visibility · transmittance`.

