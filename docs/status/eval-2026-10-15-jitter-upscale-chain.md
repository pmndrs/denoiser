# Jitter and the upscaler chain: findings (2026-10-15)

Branch `exp/jitter-study`. Two questions:

1. Should the FFX shadow/reflection denoisers compensate for sub-pixel camera jitter?
2. What does an FFX denoiser add in front of `@pmndrs/upscaler` (FSR3-style temporal upscale)?

Everything here is one analytic ray-traced scene, one fixed-seed run per configuration, on one Apple Metal-3 GPU. Differences under ~0.2 dB are noise. Scores are PSNR on tonemapped pixels where the signal matters (shadow penumbra, or reflecting surfaces), over settled frames.

## What these denoisers are (and are not)

They are **signal denoisers that run before shading is composed**: they take a noisy 1-spp shadow or reflection signal and return a clean one. They are not image-space post filters.

- They do **not** replace RCAS, EASU, or any upscaler stage. RCAS sharpens finished colour; the denoisers clean a noisy ray-traced input upstream of that colour.
- The upscaler's own temporal accumulation already averages noise. The question is only whether cleaning the signal first beats feeding it raw. Results below: sometimes, not always.
- Where it belongs in a pipeline: `trace -> FFX denoiser -> compose -> upscaler (EASU/temporal, then RCAS)`.

## 1. Jitter compensation (denoiser alone, 960x540)

Halton jitter on primary rays; modes `off | ignore | compensate | centroid | flip`.

| mode (shadows, static camera) | PSNR |
|---|---|
| no jitter | 33.88 |
| jitter, ignored | 33.64 |
| compensate | 32.22 |
| centroid | 32.63 |
| wrong-sign (control) | 31.39 |

Moving camera: all jittered modes within ~0.2 dB. Reflections: no mode moves PSNR by more than 0.1 dB.

Why: the denoiser's history is an average over many jitter phases, so its centroid sits near the pixel centre. Compensating forces a fractional bilinear resample every frame, which blurs (the TAA problem). **Conclusion: leave jitter ignored**, as `docs/specs/temporal.md` already said.

`compensateJitter` (default `false`) exists on `FfxShadowDenoiserOptions` / `FfxReflectionDenoiserOptions` only because `denoiser-three` already forwards `jitter` and the default had to remain "ignored". It never helped in any scenario. Candidate for removal.

## 2. Chain: trace -> denoise -> compose -> upscale (640x360 -> 1280x720, ratio 2)

Example: `examples/ffx-upscale-chain`. Scored against a 4x4-supersampled native render. "noisy" = raw signal into the upscaler; "denoised" = FFX denoiser, jitter ignored; "oracle" = noise-free signal (upper bound).

### Shadows (PSNR dB: noisy -> denoised, oracle)

| scenario | noisy | denoised | oracle |
|---|---|---|---|
| static camera | 39.94 | 41.47 | 42.62 |
| camera path | 37.12 | 37.70 | 38.19 |
| camera path x3 | 34.12 | 36.92 | 37.25 |
| orbiting spheres, static camera | 34.78 | 35.16 | 35.73 |
| camera x2 + spheres x2 | 33.31 | 35.12 | 35.57 |
| first frames after reset | 31.7 | 35.9 | 36.3 |
| after a camera cut | | +4 to +8.6 | |

The denoiser helps in every scenario, and most under fast motion and after history resets. Flicker with the denoiser matches the oracle (2.7x lower than noisy when static). Jitter compensation = ignore (-0.22 to +0.01 dB). Feeding the denoiser an unjittered lattice gave 41.34 (no gain).

### Reflections (noisy -> denoised, oracle)

| scenario | noisy | denoised | oracle |
|---|---|---|---|
| static camera | 29.13 | **22.53** | 34.81 |
| camera path | 28.43 | **27.27** | 33.20 |
| camera path x3 | 29.93 | 30.65 | 35.18 |
| orbiting spheres, static camera | 26.92 | **21.78** | 31.64 |
| camera x2 + spheres x2 | 31.54 | 32.64 | 34.90 |
| first frame | 18.96 | 21.76 | 32.1 |
| after a camera cut | | +2.5 to +6.8 | |

Bold = the denoiser is **worse** than doing nothing. On a converged view the FFX reflection denoiser costs 5-7 dB: the output is smooth but hazy and biased dark (mean tonemapped error -0.039 denoised vs -0.014 raw vs -0.001 oracle), while the upscaler accumulating the raw signal produces something sharper. `temporalStabilityFactor` (tsf=0.3 gives 23.2) and `currentFrameStatistics` do not fix it. It pays off only with fast camera/object motion or right after resets.

### Sanity checks

- Upscaler jitter off (static): 34.1 vs 40.4 with jitter (+6.3 dB), so the harness sees the reconstruction benefit it should.
- Ratio 3 gives the same ordering.
- Published `@pmndrs/upscaler` 0.5.0 and local source give identical numbers.
- The raw-WebGPU chain does **not** reproduce the "higher residual flicker with FSR3 jitter" open issue noted for the TSL nodes in the guide.

## Practical rules

- Shadows: denoise before the upscaler. Gain grows with motion and after resets.
- Reflections: use the denoiser while the camera/objects move fast or after a reset; bypass or blend it down once the view has converged.
- Do not compensate for upscaler jitter in the denoisers.

## Caveats

- One analytic scene; the only moving objects are three orbiting spheres.
- One seed per configuration.
- No three-rendered (rasterised + BVH) scene, so material variety, roughness and real G-buffer noise are untested.
- PSNR only (plus flicker for shadows). No perceptual metric or side-by-side human review beyond the screenshots I looked at.

## Ideas and next steps

1. **Adaptive reflection bypass.** Blend `mix(raw, denoised, w)` with `w` driven by history age / camera + object motion, so converged views get the raw signal. Cheapest way to remove the 5-7 dB regression. Test with the same chain sweep.
2. **Find the reflection denoiser's dark/hazy bias.** The -0.039 mean error is systematic, not noise. Likely the variance clamp / stabilisation in `shaders/reflections.ts`; compare against the oracle per-pixel to see which stage loses energy. Fixing it could make the denoiser a win on static views too.
3. **Re-run on a real three scene** (denoiser-three + upscaler example 09 style, with roughness variety) to see whether the analytic-scene conclusions hold.
4. **Seeds / variance.** Repeat each row with 3-5 seeds and report spread; today only gaps above ~0.2 dB are trustworthy.
5. **Decide on `compensateJitter`.** Remove it (and the `jitterDelta` / `jitterCur` / `jitterPrev` shader plumbing and `FrameCamera.prevJitter`) or keep it as documented opt-in. Recommendation: remove unless a downstream user shows a case where it helps.
6. **Try denoise-after-upscale vs before.** Not tested: running a spatial/temporal cleanup on the upscaled signal instead of the render-resolution signal.
7. **Moving-object coverage.** Add skinned/rotating/fast-thin objects and thin-feature occluders; the shadow gain may differ.
8. **Upscaler side (separate repo).** If the bypass idea works, consider a documented recipe in the upscaler guides; this experiment does not suggest any change to RCAS/EASU or the upscaler core.

## Reproduce

```bash
cd examples/ffx-upscale-chain
npx vite --port 5211 --host 127.0.0.1   # live: http://127.0.0.1:5211/?sig=reflections&cond=ignore
# headless, one scenario (~3-8 s):
BASE=http://127.0.0.1:5211/ node ../ffx-denoiser/run-headless.mjs "mode=eval&sig=shadows&cond=ignore" --json=out.json
```

URL parameters: `sig=shadows|reflections`, `cond=oracle|noisy|ignore|compensate|centroid|decoupled`, `static=1`, `speed=N`, `movers=N`, `ujitter=0`, `ratio/rw/rh`, `mode=eval|view`, `frames`, `refspp`, `tsf`. `UPSCALER_SRC=<path>/src/index.ts` swaps in a local upscaler checkout.

Denoiser-only study: `examples/ffx-denoiser` with `?signal=shadows&jitter=off|ignore|compensate|centroid|flip`.
