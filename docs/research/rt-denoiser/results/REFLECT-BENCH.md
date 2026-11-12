# Reflection bench: findings and the plan to match FFX (2026-10-28)

_Session summary and plan. Written at Dennis's request to pause the work on Ben Houston's three.js PR #35228 and restart
from a simple setup. The bench is `examples/three-temporal/reflect-bench.html` on `feat/interior-lab`
(worktree `../Denoiser-interior-lab`, commit 9b41e63). Its notes are `examples/three-temporal/REFLECT-BENCH.md` there._

## Why we stopped

Everything we built on Ben's scenes and settings boiled: his PR's example, the interior lab, and the workbench with his
scene. Our own examples (reflections-hybrid, reflections-rooms) were clean. So the bench strips out everything except
reflections:
- Ben's model (the steampunk camera on a metal disc).
- Plain three materials lit by an environment only: no lights, GI, AO or probes.
- The reflections-hybrid pipeline:
  - **Sources:** SSR / BVH-traced / hybrid.
  - **Split:** one noisy signal, a denoiser per side of a divider.
  - **Resolver:** FSR3 temporal or none.

Dennis's review on it:
- **Model defaults** (the file's roughness maps): FFX is totally clean, and ours (recurrent, SVGF) ripples, most visibly on
  the camera body.
- **Ben's settings** (everything roughness 0): FFX shows super faint motion in some mid-distance reflections, and ours
  keeps rippling.
- Verdict: neither of our denoisers looks good here. We may have over-tuned to Ben's setup.

## Measurements

Still camera, 1400×757 headless, FSR3 1.5×, mean temporal σ of luma over 16 frames (lower is calmer).

| Input | Raw | FFX | Our recurrent | Our SVGF |
|---|---|---|---|---|
| Model defaults, hybrid | 1.17 | **0.38** | 0.61 | 0.64 |
| Model defaults, ray traced | 1.38 | **0.40** | 0.52 | 0.59 |
| Roughness 0 (Ben), ray traced | 0.24 | **0.17** | 0.25 | – |
| Roughness 0, hybrid (SSR thickness 0.03) | 0.58 | **0.33** | 0.59 | – |
| Roughness 0, SSR + environment | – | **0.30** | 0.66 | – |

With no resolver, roughness 0: ray traced raw 0.70, hybrid raw 3.73, SSR raw 6.5–7.5.

**Energy:** with model defaults, our outputs are about 3 luma levels brighter than raw and FFX (mean 98.7 vs 95.8–96.1).
This is a bias, not just noise. It is unexplained.

## Findings

1. **Ben's boil is three's stochastic SSR march, not the scene or the denoisers.**
   - **Mechanism:** each frame the march offsets its steps with new noise. It uses a fixed step count (quality × 192)
     spread as (i/steps)², so the far steps are coarse. A step behind the depth buffer counts as a hit only within
     `thickness` (Ben: 0.03) of the ray. The same ray therefore hits on one frame and misses on the next.
   - **What doesn't help:** more steps, linear steps and binary refine (raw 6.3 / 7.5 / 7.2). Normal maps make no
     difference.
   - **What helps:** thickness 0.1 helps raw (2.5), but not once FSR3 and a denoiser are on.
2. **Traced mirrors need no denoiser.** At roughness 0 the traced ray is the same every frame, so FSR3 alone gives 0.24.
3. **On this model, hybrid is worse than tracing everything.** SSR hits and misses interleave. An SSR hit (the full
   raster colour) and a traced hit (cheap per-vertex shading) differ, so the mix shows a screen door that the denoiser
   has to hide.
4. **FFX beats both of ours on every input here**, including the clean traced one. On SSR mirror input our recurrent
   filter matches raw: at roughness 0 its surface history is capped at 0 by design. With model defaults, where that cap
   doesn't apply, we still trail FFX by 1.3–1.7×. So the gap is not only the mirror cap.
5. **Earlier workbench numbers on Ben's scene were not a fair base.** The workbench's results there mix SSR boil, GI and
   the resolver, and we tuned against that. That includes the dropoutGuard work (results/DROPOUT-GUARD.md).

### What this session changed in the library (the "taint" check)

`packages/denoiser-realtime` gained only **`dropoutGuard`** (v1 bd8110a, v2 31add09) and **`tune.dropoutParts`**
(ae853ef):
- Recurrent specular, opt-in, default off.
- The default WGSL is byte-identical (495,629 bytes).

No default changed. Everything else is in the interior-lab worktree (workbench, Ben's vendored nodes, the benches). The
guard was designed and tuned on Ben's SSR scene, so treat it as **paused**: don't build on it, and decide later whether
to remove it. Coverage input (issue #23) stays an issue.

## Plan

**Goal:** at a minimum, match FFX reflections on this bench. Then beat it on quality and GPU time, and fit hybrid input
(SSR + traced + environment) by design. We fail all three today.

### Phase 0: make the bench a measuring instrument (before touching a denoiser)

- [ ] **Move the bench to `feat/rt-denoiser-cleanroom`**, so denoiser work and the bench share a branch. No more
      mirroring package files into the interior-lab worktree. Copy over `reflect-bench.html`, `src/reflect-bench/` and
      the vite input. It imports `upscaler-src` (the interior-lab vite alias to ../upscaler): bring the alias, or use the
      installed `@pmndrs/upscaler` if it has `path: 'temporal'`.
- [ ] **Headless runner in the repo.** Start from `results/data/reflect-bench/smoke-rb.mjs` and `rb-measure.py`, this
      session's scratch scripts; the raw numbers are in `flicker-2026-10-28.txt` there.
  - Configs: presets × source × denoiser × resolver.
  - Camera: still, a scripted orbit, the turntable.
  - Per-side metrics, by giving both sides the same denoiser.
  - Outputs: temporal σ (still), error against the accumulated traced reference, a motion / ghosting metric, and JSON
    into results/data/.
- [ ] **Presets** in the GUI: "model defaults", "Ben (roughness 0)", and a table roughness sweep (0 / 0.05 / 0.15 / 0.3).
- [ ] **GPU time per denoiser** on the bench: FFX's `gpuTimings`, our `timestamps`. Time each run alone (rule 11).
- [ ] **Reference:** the bench's `ref` mode (traced, accumulated). Check whether it needs the resolver off and no jitter
      to be exact, and use it for error and bias, including the +3 luma finding.
- [ ] **Debug views** for ours on the bench (history length / confidence per pixel, if the package exposes them), next
      to the existing "where reflections come from" view.

### Phase 1: find the gap to FFX (model defaults, traced input first)

Traced input is the most deterministic, so it isolates the denoiser. Change one thing at a time, record each test
(rule 8), and run each against FFX:
- [ ] **Bias:** where does the +3 luma come from? Compare against the reference with the camera still. Suspects: BRDF
      demodulation and remodulation, the firefly clamp, the hit-distance alpha, prefilters.
- [ ] **Jitter:** our σ / FFX σ with the resolver off vs FSR3, and with `ignoreViewOffset` on vs off. results/T8-jitter.md
      has earlier work.
- [ ] **Low-roughness history:**
  - Recurrent caps the surface history at 0 at r = 0; SVGF caps it at 1 frame. FFX accumulates.
  - Sweep table roughness and compare the curves.
  - Our curve came from rm-* paths with clean traced input. Check what it costs on a detailed model.
- [ ] **Normal-mapped gloss:** reprojection rejection and edge-stopping on normal detail (results/T5-normal-detail.md).
      The body ripple is on normal-mapped metal.
- [ ] **Read our FFX port (`packages/denoiser-ffx`, MIT) side by side with ours**. Read its temporal accumulation, variance
      and clamping, and its roughness handling, and write down every difference that could explain the table. The
      clean-room rule covers NRD only.

### Phase 2: designed for hybrid input

- [ ] **Bench option "mirrors go to rays":** in hybrid, skip SSR below a small roughness. Measure against the reference,
      still and orbiting.
- [ ] **Optional per-pixel source input** (SSR hit / traced / environment fill) for the specular denoisers. Trust traced
      and deterministic samples, and treat SSR flips as dropout. This replaces what dropoutGuard tried to infer from hit
      distances. Fill hit distance (0 vs 100) becomes part of the contract.
- [ ] **On the bench side**, bring SSR hit shading and traced hit shading closer, so the source switch isn't itself a
      signal.

### Phase 3: beat FFX

- [ ] Quality (error against the reference, ghosting under motion) and GPU time, once Phase 1 has us level.

**Rules that still apply:**
- Defaults change only through a rule 9 A/B, on this bench and on the rm-* paths.
- Dennis approves look changes.
- Every proposal gets a review-bench toggle (rule 12).
- One heavy GPU job at a time.
- Commit after each run with a summary.
