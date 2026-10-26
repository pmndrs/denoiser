# Consumer report: the `disocclusion` guide, measured against exact ground truth

_From the `denoiser/realtime` project (feat/rt-denoiser-cleanroom), 2026-10-26. For the `@pmndrs/upscaler` maintainers.
Measured on fsr3 57eac72 (= the published 0.2.0), read-only, nothing modified. Full method, tables and raw data:
`docs/research/rt-denoiser/results/UPSCALER-GUIDES.md` in the denoiser repo (commit 217a0a4)._

## Why we looked

We assessed whether the guides bundle's `disocclusion` mask could replace or improve the history-reset tests inside our
real-time denoisers (SVGF, a recurrent filter, a shadow denoiser). We scored both against **exact** ground truth:
- **Analytic test bed:** the scene is re-traced at t−1, and a pixel counts as disoccluded when its surface point was
  off-screen or not the first hit from the previous eye.
- **Real scenes:** five Bistro and Sponza captures at 960×540, with BVH ray casts. The ground truth agrees with the
  raster to within 0.005 % of pixels.

Our verdict for **our** use was "don't adopt": our per-tap plane test is more accurate, and we need per-tap validity
anyway. The mask is designed for upscaling, where some of what we count as errors is intended. The findings below are
offered as data in case they help the upscaler itself, or other consumers of the guides bundle (SSGI, TAA-class
effects).

## Findings, most useful first

### 1. The mask sits one pixel onto the foreground and misses revealed strips next to silhouettes

"Wrong-surface" pixels are revealed pixels where no texel of the same object lies in the 3×3 around the true
reprojection, so any history kept there belongs to another surface. Share of those pixels the mask misses at
`disocclusion ≥ 0.5`:

| resolution / path | missed |
|---|---|
| 1080p, pooled over 6 paths | **14.4 %** |
| 960×540, pooled | **21.2 %** |
| `thin` (thin occluders), 1080p | **41.5 %** |
| `glossy` (grazing floor), 1080p | 49.6 % |

**Cause:** the mask is computed from the **dilated** (nearest of 3×3) depth and motion, then max-voted over 4 taps.
That's right for upscaling, where thin foreground edges should drag their own motion. But it shifts the mask one pixel
toward the foreground, so the revealed strip beside a silhouette reads as "seen before". A figure is in the denoiser
repo: `results/img/upscaler-guides-masks.png`.

**Suggestion:** an optional **undilated** disocclusion product (or a flag on the guides stage) for consumers that need
the exact reveal strip. If the upscaler also keeps history in those strips, a short look at ghosting beside thin
moving occluders may be worthwhile; we didn't measure the upscaler's own output.

### 2. No 2.5D motion input: objects moving in depth are flagged as disoccluded

Without a view-z motion component, surfaces moving toward or away from the camera fail the depth test:

| case | false resets, mask | false resets, ours (with `motion_z`) | ours without `motion_z` |
|---|---|---|---|
| test bed `object` (sphere moving in depth), 960×540 | ~30 k | 0 | ~92 k |
| `sponza-move` (spinning, swinging torus knot, static camera) | **124 k** | 0 | 193 k |

**Suggestion:** an optional `motionZ` (or 3D velocity) input to the guides stage. If the upscaler rejects history on
those pixels too, objects moving in depth may lose accumulation (softer or shimmering). That's a hypothesis for you to
check; we didn't measure it.

### 3. Over-flagging on dense real geometry

On the real scenes the mask's precision (the share of flagged pixels that are truly disoccluded) is low. Its
false-alarm rate on interior pixels is 10 ‰, against 0.8 ‰ for our plane test.

| capture | mask precision | interior false alarms |
|---|---|---|
| pooled, 5 captures | 38.6 % | 10.1 ‰ |
| `bistro-pan` | 34.9 % | **41.2 ‰** |
| `sponza-pan` | 62.0 % | 5.1 ‰ |

If the upscaler uses the grade to drop history, panning across dense geometry may cost it accumulation for no reason.
It may be worth checking against your own ghosting/softness metrics.

### 4. The tolerance depends on resolution

The depth tolerance scales with the viewport diagonal (`1.37e-5 · |size/2| · depth`), so it is twice as loose at 1080p
as at 960×540. That's why the `object` false alarms fall from ~30 k to 8 between the two. If that's intended (the
FSR-faithful constant), it may still be worth documenting for guide consumers, who otherwise see different mask
behaviour per resolution.

### 5. Integration friction for non-three consumers

- **Raw WebGPU:** the public API needs a three.js `WebGPURenderer` and returns three `Texture`s. A raw-WebGPU consumer
  must import non-exported internals (`RECONSTRUCT_SHADER`, `ConstantsBuffer`, `ComputePass`), which is what our harness
  did through a Vite alias. A small raw-device entry point for the guides stage would make it usable outside three.
- **Depth format:** the input must be a hardware depth texture (`texture_depth_2d`). A renderer with r32float or linear
  depth needs a copy pass first. Accepting r32float (device or linear depth) would remove it.
- **Camera cuts:** the reconstruct pass ignores the reset flag, so guide consumers must handle cuts themselves.
  Writing `disocclusion = 1` on a reset frame would make the bundle self-consistent.

### 6. The grade behaves like a tolerance ratio: please document it

For guide consumers, thresholds between 0.25 and 0.75 give nearly identical results. Any value above 0 adds ~113 k
interior false alarms at 960×540, and ≥ 0.99 misses 84 % of wrong-surface pixels. A one-line note on the grade's
meaning and a recommended threshold (~0.5) would help consumers that need a yes/no.

## What we measured cost-wise (M5 Pro, for reference)

Guides stage (dilate + depth clip + mask): **0.046 ms** at 960×540 and **0.158 ms** at 1080p (median of 3 × 200
dispatches). The 1080p number was partly contended by another GPU job. TEMPORAL-GUIDES-SPEC quotes 0.035 ms from your
bench.

## Offered back

The exact-ground-truth harness may be useful as a regression test for the mask:
- the test-bed re-trace;
- the BVH ground truth for the Bistro and Sponza captures;
- scoring by silhouette band and wrong-surface class.

It lives in the denoiser repo under `docs/research/rt-denoiser/results/data/upscaler-guides/` (`main.ts`, `gt-bvh.ts`,
`run.mjs`; `FSR3_SRC` points it at your `src/`). It runs headless Chrome with WebGPU on macOS.

_Nothing here is derived from NRD or any other restricted source. It's our own measurement of your MIT-licensed
package. Happy to rerun the tables against a future revision (for example an undilated variant or `motionZ`)._
