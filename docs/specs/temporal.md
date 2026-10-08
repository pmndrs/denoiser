# Temporal (real-time) denoising

> Status 2026-10-08: interface in `packages/denoiser-core/src/temporal.ts`
> (exported from `denoiser` / `denoiser/core`). First implementation: the
> FidelityFX shadow + reflection denoisers ported to WGSL (in progress).

## Why a second API

`Denoiser` is a single-image denoiser: async calls, whole-frame, no history —
right for stills, progressive refinement and the current OIDN 2 weights.
Real-time denoising is a per-frame loop with history: reprojection with motion
vectors, accumulation, disocclusion handling, camera cuts. The end goal is
real-time denoising "no matter the source", so this API is source-agnostic:

| source | kind | status |
|---|---|---|
| FidelityFX Denoiser (AMD, MIT, SDK v1.1.4) | shadows, reflections — hand-tuned filters | porting |
| OIDN 3 (Intel) | neural, temporal, full beauty frame | waiting on upstream |
| NRD (NVIDIA: ReBLUR, ReLAX, SIGMA) | diffuse/specular GI, shadows | license check first |
| own models | anything | later |

AMD's newer **FSR Ray Regeneration** (FidelityFX SDK 2.x) is an ML denoiser
shipped as a signed DX12 DLL under a binary-only, no-reverse-engineering
license — not portable. The SDK **v1.1.4** release (MIT) has the full
shadow + reflection denoiser source.

## Design

```ts
interface TemporalDenoiser<Inputs> {
  configure({ width, height }): void;                       // allocate; drops history
  dispatch(inputs: Inputs, guides: FrameGuides, camera: FrameCamera): GPUTexture;
  resetHistory(): void;                                     // camera cut
  gpuTimings?: ReadonlyMap<string, number>;
  dispose(): void;
}
```

- **Synchronous, encode-and-submit.** `dispatch()` runs after the frame's
  inputs are submitted, records its passes and submits them on `device.queue`
  — no awaits, no readback — so it fits inside a render loop. (The
  single-image engine awaits; real-time can't.) Backends that can't submit
  synchronously (ORT's async `session.run`) can't implement this; the WGSL and
  WebNN-style runtimes can.
- **Shared guides** (`FrameGuides`: depth, world normals, motion, optional
  roughness/albedo) and **camera** (`FrameCamera`: current + previous view and
  unjittered projection, jitter, near/far) — every temporal filter needs the
  same reprojection inputs.
- **Per-signal inputs**: `ShadowInputs` (1-spp visibility + hit distance),
  `SpecularInputs` (radiance + hit distance), `DiffuseInputs` (GI/AO),
  `BeautyInputs` (full frame, for OIDN 3). Signal-specific filters exist
  because one filter can't serve them all — shadows need penumbra-aware
  kernels from blocker distance, reflections need roughness-driven lobes and
  hit-distance reprojection, GI needs wide kernels and long history. (A
  screen-space SSR denoiser applied to other signals degrades badly for
  exactly this reason.)
- **Conventions match `@pmndrs/upscaler`** (FSR3): `configure` /
  `dispatch` / `resetHistory` / `dispose`, motion = NDC delta current −
  previous (three's `velocity`), unjittered projection + jitter. A three.js
  TSL node can wrap any `TemporalDenoiser` the same way `UpscalerNode` wraps
  the upscaler, and the chain render → denoise → upscale runs on one device.

## Evaluation

Extends `tools/eval`: per-signal converged references (many-sample renders of
the same signal), PSNR/FLIP-style error per frame, and **temporal stability**
under camera motion (frame-to-frame error of the denoised sequence vs the
reference sequence — flicker matters more than single-frame PSNR here), plus
GPU ms per frame at 1080p.
