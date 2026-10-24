# Capture format v0 (draft)

The contract between our renderer (which writes captures) and anything that replays them:
our WGSL denoisers, and the native NRD harness on Windows. Captures stay in **our**
conventions. Converting to NRD's conventions is the harness's job, because only the harness
builder may read NRD's headers ([RULES.md](RULES.md) rule 4).

No EXR dependency on either side: buffers are raw little-endian `float32`, described by a
JSON manifest. (A converter to EXR/PFM for viewing can come later, like
`tools/oidn-native-compare/prepare.py`.)

## Layout

```
<capture>/
  capture.json             # manifest: scene, size, buffers, lights, frames
  frame_0000/
    depth.f32  viewz.f32  normal.f32  roughness.f32  motion.f32
    albedo.f32  f0.f32
    diffuse.f32  diffuse_hitt.f32  diffuse_ref.f32
    specular.f32 specular_hitt.f32 specular_ref.f32
    visibility.f32 occluder_dist.f32 visibility_ref.f32
  frame_0001/ ...
```

Every `.f32` is `width × height × channels` floats, row-major, **row 0 = top of the image**,
channels interleaved. A buffer that a capture doesn't include is simply absent and isn't
listed in the manifest.

## Buffers

| name | ch | meaning | conventions |
|---|---|---|---|
| `depth` | 1 | device depth of the primary hit | [0,1]; `reversedDepth` in the manifest; sky = far plane value |
| `viewz` | 1 | view-space z of the primary hit | three.js view space (camera looks down −z, so in front is negative); sky = −far |
| `normal` | 3 | world-space unit normal | [−1,1]; sky = 0,0,0 |
| `roughness` | 1 | perceptual roughness r | GGX α = r² |
| `motion` | 2 | screen motion | NDC delta, current − previous (three's `velocity`); +y is up in NDC |
| `albedo` | 3 | diffuse reflectance | used to demodulate diffuse |
| `f0` | 3 | specular reflectance at normal incidence | used to demodulate specular (with a pre-integrated BRDF term, see manifest) |
| `diffuse`, `specular` | 3 | 1-spp noisy radiance, **demodulated** | linear HDR, not pre-exposed, no primary emission; finite everywhere |
| `diffuse_hitt`, `specular_hitt` | 1 | hit distance of the sampled ray | world units, primary segment excluded; 0 = miss / lobe not sampled |
| `diffuse_ref`, `specular_ref` | 3 | converged reference of the same estimator, same frame | same space as the noisy signal |
| `visibility` | 1 | 1-ray shadow visibility toward the manifest's light | 1 = lit |
| `occluder_dist` | 1 | distance to the blocker for that ray | world units; 0 = unoccluded |
| `visibility_ref` | 1 | converged visibility | |

## `capture.json`

```jsonc
{
  "version": 0,
  "scene": "analytic-room",          // generator id
  "width": 1920, "height": 1080,
  "reversedDepth": false,
  "demodulation": { "specular": "f0 * envBRDF(NdotV, r)" },  // exact term, documented by the generator
  "lights": [ { "type": "sphere", "position": [0, 4, 0], "radius": 0.25 } ],
  "buffers": [ { "name": "diffuse", "channels": 3 }, ... ],
  "referenceSpp": 256,
  "frames": [
    {
      "index": 0,
      "reset": true,                    // camera cut / first frame: history must be dropped
      "camera": {
        "view": [16 floats], "projection": [16 floats],          // column-major, projection WITHOUT jitter
        "prevView": [16 floats], "prevProjection": [16 floats],
        "jitter": [0, 0],                 // pixels
        "near": 0.1, "far": 100, "position": [x, y, z]
      }
    }
  ]
}
```

Matrices are three.js `Matrix4.elements` (column-major), the same as `FrameCamera` in
`packages/denoiser-core/src/temporal.ts`.

## Outputs from a replay

Results use the same raw format:
`outputs/<capture>/<denoiser>/frame_NNNN/<signal>.f32`, plus `run.json` (denoiser
identity and version or commit, settings, GPU, driver, OS) and `timings.csv`
(`frame,pass,ms`). Outputs are in the same demodulated space as the inputs, so they compare
directly against `*_ref`.

## Open points

- Whether to add a 2.5D motion z (`viewz_prev − viewz`) buffer. NRD recommends 2.5D
  motion; the harness can derive it from `viewz` and reprojection.
- Exact pre-integrated specular term (the shadows/specular research recommends one).
- Multiple lights for the shadow signal.
