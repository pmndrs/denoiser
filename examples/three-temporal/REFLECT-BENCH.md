# Reflection bench: hybrid reflections on Ben's model

`reflect-bench.html` (`yarn dev`, then /reflect-bench.html). Reflections only, nothing else: three.js' steampunk camera on
its metal disc (Ben's `webgpu_postprocessing_ssr.html` scene: everything roughness 0) with plain three materials lit by an
environment, and the pipeline of `reflections-hybrid.html`, not the workbench's. No lights, no SSGI, no AO, no probes
(an empty probe set, so every fallback is the prefiltered environment).

- **Environment:** analytic (studio gradient + four soft boxes). The raster pass gets it as an equirect DataTexture; the
  traced rays evaluate the same function in WGSL, so a traced reflection and a raster lookup agree.
- **Reflection source** (one GGX sample per pixel per frame, three's sampler): environment only / SSR with the environment
  on a miss / hybrid (SSR, a ray traced against the scene BVH where SSR misses) / ray traced every pixel / an
  accumulated traced reference.
- **Split:** one noisy signal; the left and right of the divider run it through a denoiser each (raw, FFX reflections,
  our recurrent, our SVGF).
- **Resolver:** FSR3 temporal (`upscaler-src`) at 2x / 1.5x / native (as a TAA) or none.
- **Traced hits** are shaded cheaply, as hybrid renderers do: albedo and metalness sampled from the model's textures
  per vertex, with vertex normals, both interpolated at the hit; diffuse from the environment's irradiance, metals
  mirroring the environment (no second bounce). So an SSR hit (the full raster colour) and a traced hit don't match exactly.
- GUI: model roughness (Ben's forced 0 / the file's), normal maps, table roughness, turntable, camera orbit, SSR
  thickness / distance / quality / step exponent / binary refine, "where reflections come from" view.

## First results (2026-10-28, still camera, temporal sigma of luma over 16 frames, 1400x757 headless)

| source \ denoiser, FSR3 1.5x | raw | FFX | recurrent |
|---|---|---|---|
| ray traced, every pixel | 0.24 | **0.17** | 0.25 |
| hybrid, SSR thickness 0.03 (Ben's) | 0.58 | 0.33 | 0.59 |
| hybrid, thickness 0.1 | 0.69 | 0.35 | 0.60 |
| SSR + environment, 0.03 | – | 0.30 | 0.66 |

Without a resolver: ray traced raw 0.70; hybrid raw 3.73; SSR raw 6.5-7.5.

Model defaults (the file's roughness maps), FSR3 1.5x: hybrid raw 1.17 / FFX **0.38** / recurrent 0.61 / SVGF 0.64; ray
traced 1.38 / **0.40** / 0.52 / 0.59. Ours is also ~3 luma brighter than raw and FFX (a bias). Dennis's review: FFX
clean, ours ripples on the camera body.

**Next:** Ben's PR work is paused. The plan to match FFX (and then beat it on quality, speed and hybrid input) starts
from this bench: `docs/research/rt-denoiser/results/REFLECT-BENCH.md` on `feat/rt-denoiser-cleanroom`.

- **The boil is three's SSR trace on this model, not the scene, the lighting or the denoisers.** Its stochastic march
  offsets the steps with new noise every frame over a fixed step count (quality x 192, spread as (i / steps)^2), and a
  step behind the depth buffer counts as a hit only within `thickness` of the ray. On a detailed model the far steps
  overshoot 0.03, so the same ray hits on one frame and misses on the next. More steps (quality 1), linear steps and
  binary refine don't change it (6.3 / 7.5 / 7.2 raw); thickness 0.1 does (2.5 raw) but not once FSR3 and a denoiser
  are on. Normal maps make no difference.
- **Ray tracing the mirrors needs no denoiser**: at roughness 0 the ray is deterministic, and FSR3 alone gives 0.24.
- **Hybrid on this model is worse than tracing everything**: SSR's hits and misses interleave, and a hit (raster colour)
  and a traced hit (cheap shading) differ, so the mix shows a screen door that the denoisers must hide.
- **Our recurrent filter does not stabilise mirrors** (= raw wherever the input is SSR): at roughness 0 its surface
  history is capped at 0 by design (a mirror's signal is deterministic), which assumes the input doesn't flip. FFX
  accumulates anyway and is ~2x calmer on SSR input. That is the dropoutGuard problem again (results/DROPOUT-GUARD.md
  in the cleanroom), here without GI or the workbench around it.
