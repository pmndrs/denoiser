# @pmndrs/denoiser-realtime

Real-time, per-signal `TemporalDenoiser`s for WebGPU, in WGSL, written from
published papers (clean room: see `docs/research/rt-denoiser/RULES.md`; every
pass cites its source in its shader header and in
`docs/research/rt-denoiser/PROVENANCE.md`). Users import it as
**`denoiser/realtime`**, which also re-exports the FidelityFX shadow and
reflection denoisers (`denoiser/ffx` keeps working).

| class | signal | conforms to |
|---|---|---|
| `DiffuseDenoiser` | diffuse indirect (GI) / AO | `TemporalDenoiser<DiffuseInputs>` |
| `SpecularDenoiser` | specular indirect (reflections) | `TemporalDenoiser<SpecularInputs>` |
| `DiffuseSpecularDenoiser` | both, one shared prepass | `TemporalDenoiser<DiffuseSpecularInputs>` (+ `dispatchBoth`) |

Classes are named by what they denoise; the algorithm is an option
(`filter: 'svgf'` today; `'recurrent'` is planned as the default later).

```ts
import { DiffuseSpecularDenoiser } from 'denoiser/realtime';

const gi = new DiffuseSpecularDenoiser(device, { filter: 'svgf', antiLag: 'auto' });
gi.configure({ width, height });
// every frame, after the frame's inputs are submitted:
if (cameraCut) gi.resetHistory();
const { diffuse, specular } = gi.dispatchBoth(
  {
    diffuse: { radiance: diffuseDemod },                      // 1 spp, demodulated (÷ albedo)
    specular: { radiance: specularDemod, hitDistance },       // 1 spp, ÷ pre-integrated specular term
  },
  { depth, normal, motion, roughness, viewZ /* optional */, motionZ /* optional */ },
  { view, projection, prevView, prevProjection, near, far },
);
// rgba16float, still demodulated (pass `remodulate: true` + `demodulation` to get radiance back).
```

## Two outputs from one `TemporalDenoiser`

`TemporalDenoiser.dispatch()` returns one texture, so:

- `DiffuseDenoiser` and `SpecularDenoiser` are independent and each conforms
  fully — the simplest choice for a registry of single-signal denoisers.
- `DiffuseSpecularDenoiser` shares the guide prepass (packed depth / slope /
  normal / roughness, and its previous-frame copy) between both signals.
  `dispatch()` returns the diffuse texture (so it still conforms) and fills
  `outputs`; `dispatchBoth()` returns `{ diffuse, specular }`. Per-signal
  options go in `{ diffuse: {...}, specular: {...} }`; shared ones at the top
  level.

## Inputs and conventions

Per [CAPTURE-FORMAT](../../docs/research/rt-denoiser/CAPTURE-FORMAT.md):
radiance arrives **demodulated** (diffuse ÷ albedo, specular ÷ the
pre-integrated split-sum term) and the output stays in that space unless
`remodulate: true` (diffuse multiplies by `inputs.demodulation ??
guides.albedo`, specular by `inputs.demodulation`).

- Motion: NDC delta, current − previous, +y up (three's `velocity`).
- Depth: any depth format or r32float device depth, linearized with the
  (unjittered) projection; or pass `guides.viewZ` (three.js view z, negative
  in front) to skip that.
- `guides.motionZ` (optional): 2.5D motion, viewZprev − viewZ in `.r`, for
  moving objects; without it the previous depth comes from the camera.
- Roughness: perceptual (GGX α = r²), required for specular.
- Sky / no surface: normal = 0 or depth at the far plane (or viewZ = −far); output 0.

Additions to `@pmndrs/denoiser-core/temporal.ts` (additive): `FrameGuides.viewZ`,
`FrameGuides.motionZ`, `DiffuseSpecularInputs`.

### A-SVGF anti-lag (`antiLag`)

- `'auto'`: temporal gradients estimated from the signal itself (per 3×3
  stratum: current mean luminance vs the reprojected accumulated history, with
  the noise of the current mean subtracted as a k·σ floor). No renderer work.
- `'gradient'`: A-SVGF proper. The renderer supplies `inputs.gradient`, one texel
  per 3×3 stratum (`ceil(W/3) × ceil(H/3)`, rgba32float/rgba16float):
  r = luminance of the forward-projected sample as shaded last frame,
  g = the same sample re-shaded this frame with the same random numbers,
  b > 0 = valid (A-SVGF §3.1–3.3).

## Options (SVGF)

All optional; defaults in brackets. Shared: `temporalAlpha` [0.2; 0.1 with
anti-lag], `momentsAlpha` [= temporalAlpha], `maxHistory` [64],
`historyFilter` ['bilinear' | 'catmull-rom'], `planeDistance` [0.01],
`normalThreshold` [0.95], `atrousIterations` [5], `kernel` ['3x3' | '5x5'],
`feedback` [true], `sigmaDepth/Normal/Luminance` [1, 128, 4],
`varianceRampFrames` [4], `spatialVarianceBoost` [3], `luminanceVariance`
['sample' | 'mean'], `antiLag` ['off' | 'auto' | 'gradient'],
`antiLagNoiseFloor` [2], `antiLagRadius` [1], `gradientIterations` [5],
`remodulate` [false], `timestamps` [true]. Specular only:
`specularHistoryScale` [1], `specularHistoryCurve` [0.5], `lobeFraction`
[0.75], `specularNormalWeight` ['lobe' | 'power'], `radiusScale` [1].

## Passes (per signal)

| pass | reads → writes | formats |
|---|---|---|
| `prepass` (shared) | depth / viewZ, normal, roughness → tap geometry (linear depth f32, oct normal 12+12 b, roughness 8 b) and depth slope (2×f16) | rg32uint ×2 (ping-pong), r32uint |
| `gradient_create`, `gradient_atrous_0..4` (anti-lag only) | input, history → per 3×3 stratum (δ, Δ, var δ, valid), (mean l, var l, z, ∣∇z∣) | rgba32float ×4 at 1/3 res |
| `temporal` | input + reprojected history → integrated color + history length n; luminance moments | rgba16float ×2 (rgb, n), rg32float ×2 |
| `variance` | → color + **standard deviation** (bilateral spatial estimate blended in while n < 4) | rgba16float |
| `atrous_0..K-1` | edge-avoiding à-trous ping-pong; iteration 0 also writes the feedback history; the last writes the output | rgba16float ×2, + history (rgba16float), output (rgba16float) |

Internal memory per signal: 56 B/px including the output (+8 with feedback),
plus 20 B/px shared geometry: ≈ 148 B/px for diffuse + specular with feedback
(SPEC §10.2 estimates 112 without outputs; SVGF is the baseline, not the
memory-target filter). Anti-lag adds ~7 B/px per signal.

## Results (dev page, synthetic scene, 1920×1080, Apple M5 Pro, Chrome)

Synthetic analytic scene with an exact converged signal and injected noise
(relative σ = 1, Exp-distributed, 0.1 % fireflies; `dev/`), 120 frames, orbiting
camera with a cut at frame 60. PSNR on x/(1+x)-tonemapped demodulated values,
flicker = mean |e_t − e_{t−1}| (e = output − truth).

| | diffuse PSNR | flicker | specular PSNR | flicker |
|---|---|---|---|---|
| noisy input | 14.04 dB | — | 15.87 dB | — |
| spatial only (history reset every frame) | 40.13 | 0.0089 | 41.00 | 0.0080 |
| **SVGF (defaults)** | 40.48 | 0.0020 | 43.56 | 0.0017 |
| SVGF, `feedback: false` | 41.55 | 0.0021 | | |
| SVGF, `kernel: '5x5'` | 40.32 | 0.0021 | | |
| **A-SVGF (`antiLag: 'auto'`)** | **41.62** | **0.0017** | **44.52** | **0.0013** |

Light switching on at frame 60, static camera (diffuse): plain SVGF drops to
22.8 dB and needs ~8 frames to get back above 34 dB; `antiLag: 'auto'` drops to
27.6 dB and is above 35 dB after 3 frames; `'gradient'` (renderer samples)
27.1 dB, slower recovery (it only fires on the change frame, as in the paper).
No NaNs in any run.

GPU time per frame at 1080p (timestamp queries, min of 400 frames; other
headless sessions were alive, so treat as possibly contended):

| | prepass | temporal | variance | à-trous ×5 | gradient | total |
|---|---|---|---|---|---|---|
| `DiffuseDenoiser` | 0.18 | 0.47 | 0.15 | 0.44 + 4 × 0.38 | — | **2.76 ms** |
| `SpecularDenoiser` | 0.18 | 0.48 | 0.36 | 0.47 + 4 × 0.43 | — | **3.23 ms** |
| `DiffuseSpecularDenoiser` | 0.18 (shared) | | | | — | **5.85 ms** |
| `DiffuseDenoiser`, `antiLag: 'auto'` | 0.18 | 0.57 | 0.16 | 1.94 | 0.43 + 0.36 | **3.70 ms** |

`kernel: '5x5'` costs ~1.0 ms per à-trous iteration (6.2 ms total for diffuse);
`atrousIterations: 4` saves ~0.38 ms.

## Dev page

`yarn workspace @pmndrs/denoiser-realtime dev` (port 5240), then
`node packages/denoiser-realtime/dev/run-headless.mjs "signal=diffuse&mode=eval"
"signal=both&mode=bench"`. Query switches: `signal=diffuse|specular|both`,
`mode=eval|bench`, `w`, `h`, `frames`, `path=orbit|static|pan`, `cut=N`,
`switch=N` (a light turns on), `noise`, `ff`, `noHistory=1`,
`antiLag=off|auto|gradient`, `kernel`, `iters`, `feedback=0`, `history`,
`alpha`, `view=out|noisy|ref|err|histlen`, `gain`, `stopAt=N`, `--shot=file.png`,
`--json=file.json`. See the shader headers for sources.
