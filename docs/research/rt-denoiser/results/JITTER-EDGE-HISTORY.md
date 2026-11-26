# Jittered guides: history at silhouettes and sub-pixel geometry (`historyFootprint`)

_2026-11-27, chain-edge-history agent (RULES.md: no NRD code, README, release notes, port or quarantined file read).
Asked for by the pathtracer's real-time chain (pathtracer TASKS N11.14–N11.17): SVGF loses its history along every
silhouette and on thin geometry at a STILL camera once the renderer jitters its primary rays for a temporal upscaler.
Measured in the pathtracer's `chain-debug` bench (Classroom, 640×360 → 1280×720, 1 spp path tracing with a neural
radiance cache, per-frame jitter owned by `@pmndrs/upscaler/core`, Apple M5 Pro, Chrome, the desktop app's browser pane;
single runs, load average 2.4–4.3, no timings). Package: main 7ffb742 + the option below on branch
`fix/jitter-edge-history`. The option defaults to off; with it off every generated pass is unchanged text._

## 0. Conclusion

- **T8 was right about the image and missed the history.** With jitter-free motion the filter is correct, but a pixel
  whose ONE-sample guides land on another surface in the next frame fails the normal test against its own history. At a
  still camera with the upscaler's per-frame jitter, 24.6 % of the hit pixels change surface at least once in 24 frames
  (normal cosine < 0.95 or depth off by > 2 %). The 3×3 fallback rescues two thirds of them; **8.8 % of the hit pixels
  sit below the history cap for good, 6.2 % at ≤ 8 frames** (anti-lag off, α 0.05, cap 64). Every one of those pixels is
  a pixel whose guides flipped (100 % of the below-cap pixels, 0 % with stable guides); with the jitter off no pixel is
  below the cap. With no fallback (`historyFallback: 'off'`) it is 24.7 %: the whole flipped set.
- **It is the normal test, not the plane test.** `planeDistance` 0.1: 8.8 % (no change). `normalThreshold` 0: 0.5 %.
  `normalTest: 'relative'`: 1.6–1.8 %. `'soft'` and `'center'` are the same (soft's 3-frame history is what the ≤ 8
  share is made of).
- **Two kinds of pixel.** (a) Silhouettes of thin things against something at another depth (chair legs, window bars):
  neither surface's neighbours hold the other's history. (b) Geometry finer than a pixel at ONE depth: creases, and a
  corrugated panel whose normals swing through 90° inside a pixel (the "teal patch" of the pathtracer notes: per frame
  the normal reads (−1, 0, 0), (−0.27, 0, 0.96), (−0.89, 0, 0.45) … and the depth 2.91–2.94 m): no neighbour ever matches
  within 18°.
- **Built: `historyFootprint`** (`'neighbour' | 'plane' | 'both'`, default `'off'`; §2). It restores the history
  LENGTH: below the cap 8.8 % → 4.0 % / 2.6 % / 0.5 %, ≤ 8 frames 6.2 % → 2.3 % / 1.1 % / 0.2 %.
- **It does not pass as a default, and the chain does not adopt it** (§3). On the pixels that lose history, the final
  (upscaled) image flickers 11–12 % less and the time-averaged denoised image is 12–27 % further from the pixel-area
  reference: the history that is kept was shaded on the OTHER surface, and one irradiance remodulated by whichever
  albedo this frame's sample hit is off by the covariance of albedo and irradiance inside the footprint (bias on those
  pixels −0.5 % → +1.5 % `'plane'`, +2.8 % `'both'`). Whole image, still: final flicker −5 % / −9 %. `'plane'` is neutral
  in motion by construction (its cap is 1 / the pixel's own motion); `'both'` ghosts more (error while panning +19 %).
- **Why the gain is small: most of the edge flicker is not noise.** With 16 samples per frame instead of 1 (noise ÷ 4)
  the final image's flicker on the lost pixels falls by only 14 % (0.0052 → 0.0044; rest of the image 0.00088 →
  0.00069). What is left is the jitter itself: the sample lands on another surface, the denoised colour changes with it
  (0.48 relative per frame on those pixels, by design), and the upscaler has to integrate that. A longer SVGF history
  cannot remove it. The 3-frame history `'soft'` gives those pixels today is about as much as their history is worth.
- **Tried and dropped: the footprint history in modulated radiance** (rescale an accepted tap by last frame's
  demodulation factor at the tap over this frame's at the pixel, so the pixel accumulates what its footprint shows and
  the covariance bias goes away). It needs the previous factors (+8 B/px per signal, its own copy pass: the temporal pass
  is at the 4-storage-texture limit) and it diverges: the rescaled values are spread by the à-trous into same-surface
  neighbours, which keep them as ordinary history (error on the lost pixels ×40, on the pixels around them +80 %).
  Not in the branch; it would need the spatial filter to treat those pixels as sinks only.
- **Anti-lag is the bigger still-camera limit, and it is not an edge problem.** With A-SVGF `'auto'` +
  `antiLagHistoryScale` (the chain's candidate), 93 % of the hit pixels are below the cap anyway (p50 36–40 frames,
  12–14 % at ≤ 8); `historyFootprint` takes the ≤ 8 share to 8 %, and half of what is left is on pixels whose guides
  never flip (noise-driven λ).

## 1. What the denoiser is fed

Guides (normal, view depth, roughness, motion) are the path tracer's primary vertex of the frame's sample, at the
jittered position; motion is jitter-free (world point through the two unjittered cameras). `FrameCamera.jitter` is
passed and, as T8 documented, unused. Frame-to-frame change of the guides at a still camera, 8 frame pairs ("edge" =
within a pixel of a depth step > 3 % or a normal cosine < 0.95 against a 4-neighbour in any of the frames: 46–52 % of
this dense scene; cells = mean change, share of pixel-frames over the threshold: normal cosine < 0.95, depth 2 %, albedo
/ specular factor 5 %, roughness 0.05):

| jitter | region | normal (1 − cos) | depth | albedo factor, mip 0 | albedo factor, ray cone 1 px | ray cone 2 px | specular factor | roughness |
|---|---|---|---|---|---|---|---|---|
| off (pixel centre) | all | bit-identical | bit-identical | bit-identical | bit-identical | | bit-identical | bit-identical |
| per frame (upscaler) | edge | 0.114, 23.0 % | 1.5 %, 5.8 % | 14.9 %, 37 % | 10.4 %, 24 % | 9.7 %, 18 % | 1.7 %, 2.5 % | 0.006, 2.6 % |
| per frame (upscaler) | interior | 5e-5, 0.01 % | 0.14 %, 0 | 8.7 %, 31 % | 3.0 %, 16 % | 1.7 %, 7.8 % | 0 | 0 |
| per pixel (sampler) | edge | 0.106, 20.4 % | 1.4 %, 5.6 % | 14.2 %, 35 % | 9.9 %, 22 % | | 1.5 %, 2.2 % | 0.006, 2.3 % |
| per pixel (sampler) | interior | 2e-5, 0 | 0.14 %, 0 | 7.9 %, 29 % | 2.5 %, 13 % | | 0 | 0 |

So: no Monte Carlo noise in any guide (bit-identical planes without jitter; the one stochastic thing the renderer
writes is which of the two signals a sample belongs to, the lobe sampled at the primary vertex: 1.6–2.4 % of pixels
change class per frame, on metal). Texture aliasing only in the albedo factor (the scene has no normal or roughness
maps: those planes are identical with and without a texture LOD), which a ray-cone LOD cuts 3–5×; what is left inside
surfaces is print and joints (sharp albedo steps a normal / depth mask cannot see). Everything else is geometric
coverage under the jitter. The history resets do not move with the texture LOD (8.7 % below the cap either way).

## 2. The option

`historyFootprint` (radiance payload; `packages/denoiser-realtime/src/shaders/svgf.ts` `footprintWgsl`, compiled in
only when on). Where no tap of the 2×2 footprint and no 3×3 fallback texel passes the full test (today: restart, or
`normalTest: 'soft'`'s short history), footprint taps are accepted as "another sample of the same pixel footprint":

- `'neighbour'` — the dual of SVGF's 3×3 fallback (which asks whether THIS surface was in the previous 3×3): the surface
  the tap stored last frame is still shown by one of this pixel's 8 neighbours this frame (that neighbour passes the
  full plane / normal test against the tap, through its own motion vector). Cap: `historyFootprintDwell` / d frames,
  d = relative screen motion (px / frame) of this pixel and that neighbour: the time the other surface's edge needs to
  cross a pixel.
- `'plane'` — the tap's point is within the plane distance of this pixel's point (either surface's plane), whatever
  its normal. Cap: `historyFootprintDwell` / m frames, m = this pixel's own screen motion: how long a point stays in one
  pixel.
- `'both'` — either.

A cap below 2 frames leaves the pixel to today's path, so anything moving at half a pixel per frame or more behaves as
before. Not with `historyNormal: 'geometric'` or the SH payload.

## 3. Numbers

Still camera, 200 frames settled, then 48 frames measured. `X` = anti-lag off, α 0.05; `D` = `antiLag: 'auto'` +
`antiLagHistoryScale`, α 0.05 (upscaler sharpness 0, history 64). Pixel classes from the plain test (anti-lag off, option
off): `lost` = guides flipped and history below the cap (8.7–8.8 % of hit pixels), `kept` = flipped, history at the
cap (15–16 %), `rest` = stable guides (75–76 %). Error = mean |L(mean denoised) − L(reference)| / mean L(reference) over
the class; reference = the mean raw path-traced image over 128 frames × 16 spp with the same jitter sequence (the
pixel-area average). Flicker = mean |ΔL| / mean L per frame of the final 1280×720 image.

| config | below cap | ≤ 8 frames | lost: error | lost: bias | lost: final flicker | kept: error | kept: final flicker | rest: final flicker |
|---|---|---|---|---|---|---|---|---|
| X off | 8.8 % | 6.2 % | 0.132 | −1.0 % | 0.00494 | 0.128 | 0.00314 | 0.00074 |
| X neighbour | 4.3 % | 2.4 % | 0.182 | +4.1 % | 0.00422 | 0.149 | 0.00293 | 0.00074 |
| X plane | 2.6 % | 1.3 % | 0.167 | +0.6 % | 0.00402 | 0.137 | 0.00293 | 0.00086 |
| X both | 0.6 % | 0.25 % | 0.204 | +3.0 % | 0.00391 | 0.150 | 0.00290 | 0.00075 |
| X `normalTest: 'relative'` | 1.7 % | 1.0 % | 0.144 | +3.3 % | 0.00441 | 0.129 | 0.00286 | 0.00077 |
| D off | 93 % | 11.7 % | 0.115 | −0.5 % | 0.00518 | 0.113 | 0.00314 | 0.00088 |
| D plane | 90 % | 8.6 % | 0.129 | +1.5 % | 0.00462 | 0.117 | 0.00292 | 0.00087 |
| D both | 93 % | 7.7 % | 0.146 | +2.8 % | 0.00456 | 0.128 | 0.00292 | 0.00091 |
| D off, 16 spp per frame | 84 % | 10.4 % | 0.088 | +0.1 % | 0.00442 | 0.085 | 0.00282 | 0.00069 |

(The `X` rows and the `D` rows are from two sessions; a second session's `X off` read 0.139 / 0.00497 and `D off`
0.113–0.117 / 0.0051–0.0052 on the lost pixels: differences under ~5 % between rows are run-to-run.)

Whole image and motion, on `D` (flicker = reprojected relative change per frame; strafe 0.15 m, pan 0.3 rad, period
120 frames; lamp = interior lights switched off without a history cut, residual after 1 / 8 / 32 frames; ghost = final
image while moving against the settled image at the same pose):

| | D off | D plane | D both |
|---|---|---|---|
| still flicker, denoised / final | 0.201 / 0.00284 | 0.187 / 0.00270 | 0.184 / 0.00259 |
| strafe flicker, denoised / final | 0.200 / 0.0254 | 0.198 / 0.0255 | 0.188 / 0.0248 |
| SVGF history while strafing, p10 / p50 / ≤ 8 | 6.4 / 35.5 / 12.6 % | 6.3 / 35.3 / 12.5 % | 8.9 / 36.9 / 8.6 % |
| lamp residual r1 / r8 / r32, frames to 10 % | 0.133 / 0.075 / 0.038, 4 | 0.137 / 0.075 / 0.040, 4 | 0.137 / 0.077 / 0.041, 4 |
| strafe ghost relMSE, off-by-20 % | 0.00390, 1.84 % | 0.00392, 1.89 % | 0.00431, 1.93 % |
| pan ghost relMSE, off-by-20 % | 0.00409, 2.08 % | 0.00435, 2.03 % | 0.00485, 2.24 % |

## 4. What this means for a renderer

- Feed jitter-free motion (T8). Expect a few-frame history on pixels whose one-sample guides change surface under the
  jitter; that is the correct reading of "this pixel's history was shaded somewhere else", and the temporal upscaler
  after the denoiser is what integrates those pixels.
- A per-frame jitter (one offset for the whole frame) is better for the fallback than a per-pixel random one: a thin
  vertical feature is then hit by the pixels above and below in the same frame, so its history survives in the 3×3.
- `historyFootprint: 'plane'` is there for a still view where edge shimmer matters more than edge accuracy.
- Texture detail in the demodulation factor does not disturb the filter (it only sees the demodulated signal), but it
  flickers in the remodulated output: prefilter it (ray-cone / mip LOD) or leave it to the upscaler.

## 5. Open

- The `'auto'` gradient takes its history sample only where the stratum centre's full test passes; strata on flipped
  pixels are filled from their neighbours. Whether λ near edges (history p50 26 on flipped pixels against 39 overall)
  is a real jitter-coverage change or avoidable was not looked at.
- Specular history under `historyFootprint` (a history at another normal is wrong for a reflection, T6) was not
  measured separately: the chain's specular is a small part of the Classroom's image.
- One scene, one resolution, single runs, no Bistro / Sponza captures: not a rule-9 evaluation.
