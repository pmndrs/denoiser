# @pmndrs/denoiser-ffx

Real-time `TemporalDenoiser`s for WebGPU — a WGSL port of AMD's
**FidelityFX Denoiser** from FidelityFX SDK **v1.1.4** (MIT, see `NOTICE`).
Exposed to users as `denoiser/ffx`.

| class | signal | FFX passes |
|---|---|---|
| `FfxShadowDenoiser` | 1-spp ray-traced shadow visibility | prepare, tile classification, 3x a-trous filter |
| `FfxReflectionDenoiser` | 1-spp glossy reflections | reproject, prefilter, resolve temporal |
| `Gi1Denoiser` | diffuse GI irradiance (AMD GI-1.0's screen probes, or any per-pixel irradiance) | ReprojectGI, FilterGI x2 (from AMD Capsaicin v1.3, not the FidelityFX SDK) |

```ts
import { FfxShadowDenoiser } from 'denoiser/ffx';

const shadows = new FfxShadowDenoiser(device);
shadows.configure({ width, height });
// every frame, after the frame's inputs are submitted:
if (cameraCut) shadows.resetHistory();
const mask = shadows.dispatch(
  { visibility },                        // r32float / r16float / r8unorm, 1 = lit
  { depth, normal, motion },             // FrameGuides (motion = NDC current - previous)
  { view, projection, prevView, prevProjection, near, far },
);
// `mask` (rgba16float, .r = denoised visibility) is valid until the next dispatch.
```

`Gi1Denoiser` is AMD GI-1.0's image-space GI denoiser, ported from AMD Capsaicin v1.3
(MIT, see `NOTICE`): a temporal accumulation with an adaptive history length (up to 64
frames) and a separable blur where the history is short (disocclusions). It takes
`DiffuseInputs.radiance` and the usual guides; `encode(encoder, ...)` records into the
caller's encoder; `hintInAlpha` reads GI-1.0's keep/discard hint from `radiance.a`; the
optional `guides.previousDepth` / `previousNormal` save its own history copy.

See `docs/specs/temporal.md` (FidelityFX port and GI-1.0 port sections) for conventions,
deviations from AMD's source and measured quality / cost, and
`examples/ffx-denoiser` for the test bed (`gi1.html` for the GI-1.0 checks).
