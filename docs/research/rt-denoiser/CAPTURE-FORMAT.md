# Capture format v0 (final)

The contract between our renderer (which writes captures) and anything that replays them:
our WGSL denoisers, and the native NRD harness on Windows. Captures stay in **our**
conventions. Converting to NRD's conventions is the harness's job, because only the harness
builder may read NRD's headers ([RULES.md](RULES.md) rule 4).

No EXR dependency on either side: buffers are raw little-endian `float32`, described by a
JSON manifest. Tools that read, write, check and score captures live in
[`tools/rt-capture/`](../../../tools/rt-capture/) (generator, validator, replay, compare,
PNG/PFM preview).

_Changelog:_
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
