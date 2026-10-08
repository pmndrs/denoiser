# @pmndrs/denoiser-ffx

Real-time `TemporalDenoiser`s for WebGPU — a WGSL port of AMD's
**FidelityFX Denoiser** from FidelityFX SDK **v1.1.4** (MIT, see `NOTICE`).
Exposed to users as `denoiser/ffx`.

| class | signal | FFX passes |
|---|---|---|
| `FfxShadowDenoiser` | 1-spp ray-traced shadow visibility | prepare, tile classification, 3x a-trous filter |
| `FfxReflectionDenoiser` | 1-spp glossy reflections | reproject, prefilter, resolve temporal |

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

See `docs/specs/temporal.md` (FidelityFX port section) for conventions,
deviations from AMD's source and measured quality / cost, and
`examples/ffx-denoiser` for the test bed.
