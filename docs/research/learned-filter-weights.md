# Ray Reconstruction, Ray Regeneration and learned filter weights

_2026-11-26. Sources: [FidelityFX SDK](https://github.com/GPUOpen-LibrariesAndSDKs/FidelityFX-SDK)
README and denoiser docs, [GPUOpen Ray Regeneration page](https://gpuopen.com/amd-fsr-rayregeneration/),
[NVIDIA's interview with id Software](https://developer.nvidia.com/blog/how-id-software-used-neural-rendering-and-path-tracing-in-doom-the-dark-ages/).
Related: [nppd-fssa.md](nppd-fssa.md), [temporal.md](../specs/temporal.md),
[pmndrs/denoiser#46](https://github.com/pmndrs/denoiser/issues/46) (the experiment),
[pmndrs/denoiser#16](https://github.com/pmndrs/denoiser/issues/16) (OIDN 3 runtime)._

## TL;DR

- **Both vendor products are denoisers.** "Ray Reconstruction" (NVIDIA) and "Ray
  Regeneration" (AMD) are brand names. What changes is who designs the filter: a
  trained network in place of hand-written rules.
- **They are built differently.** AMD's is a per-signal denoiser with a learned core,
  with upscaling left to FSR 4. NVIDIA's is one network that denoises and upscales a
  combined image.
- **Neither is usable on the web**, and neither has a paper.
- **The idea behind AMD's is public.** "ML decides the filter weights" is kernel
  prediction (KPCN, NPPD, FSSA). It fits `denoiser/realtime`, which is already per
  signal with reprojection and history.
- **A transformer isn't required for this quality.** FSSA, a convolutional
  kernel-predicting network, reports 25.41 dB against 22.88 dB for DLSS 4 Ray
  Reconstruction at 0.25 spp in its own test ([nppd-fssa.md](nppd-fssa.md)).
- **Proposed:** one bounded experiment, a tiny network predicting the shadow filter's
  weights, tracked in [#46](https://github.com/pmndrs/denoiser/issues/46). Measure
  OIDN 3 first (upstream date 2026-11-30).

## The three approaches

| | Classic (NRD-class, ours) | AMD FSR Ray Regeneration | NVIDIA DLSS Ray Reconstruction |
|---|---|---|---|
| Filter logic | Hand-tuned heuristics | ML predicts the filter weights | End-to-end network |
| Signals | Per signal | Per signal, 7 of them | One combined noisy image plus guides |
| Upscaling | Separate, afterwards | Separate; docs say pair with FSR 4 | Joint denoise and upscale |
| Architecture | n/a | Not stated | Transformer since DLSS 4; layout unpublished |
| Usable on the web | Yes | No | No |

### AMD FSR Ray Regeneration

From the SDK README (FSR SDK 2.4.0 "Redstone", Ray Regeneration 1.2.1) and the GPUOpen
page. The repo's denoiser doc was truncated when fetched, so the input and signal
details below come from a summary of its second half, not verbatim text.

- **What it is:** "a machine learning-based solution for denoising". GPUOpen says it
  uses ML "to dynamically determine optimal filter weights". The architecture is not
  stated.
- **Signals:** ambient occlusion, direct diffuse, direct specular, dominant light
  visibility, indirect diffuse, indirect specular, specular occlusion. Each has its own
  flag and dispatch.
- **Inputs:** the noisy signal with albedo divided out, plus linear depth, motion
  vectors, normals, roughness, material type, diffuse and specular albedo, camera
  matrices and jitter.
- **Upscaling:** not included. The denoiser does no anti-aliasing or jitter resolve; an
  upscaler handles that afterwards.
- **Cost:** 3.74 ms at 1080p for all seven signals on an RX 9070 XT (AMD's figure).
- **Requirements:** Radeon RX 9000 series, DX12 with Shader Model 6.6, Windows 11. No
  Vulkan.
- **Distribution:** a signed binary DLL. The license allows binary redistribution only
  and forbids reverse engineering ([nppd-fssa.md](nppd-fssa.md)). We can read the
  docs; the binary is off limits.

Structurally this is the same layout as NRD or our own filters, with the heuristics
swapped for a network.

### NVIDIA DLSS Ray Reconstruction

The id Software interview (2025-09-30, Billy Khan) says DLSS 4's transformer model
improved super resolution and denoising, and that Ray Reconstruction beat "traditional
denoising techniques" on quality and performance. It gives no inputs, no measurements,
and never names NRD.

The rest of this section is from memory of NVIDIA's public material and was not
re-checked:

- It takes the noisy combined colour plus guide buffers: diffuse and specular albedo,
  normals, roughness, depth, motion vectors, and optionally specular hit distance.
- It replaces the per-signal denoisers and the upscaler with one network.

Why it works without split signals:

1. **Splitting exists to help hand-written filters.** Diffuse and specular are separated
   because each needs its own blur radius and reprojection rule. A network can infer
   from roughness and albedo which part of a pixel behaves like a reflection.
2. **The guides are noise-free.** Albedo, normals and depth come from the primary hit,
   so only the lighting is noisy.
3. **It sees the samples before anything has damaged them.** A classic chain blurs,
   then the upscaler tries to recover detail from the blurred result. The joint network
   accumulates raw jittered samples straight into the output resolution.

Its weakness is the other side of that: on content unlike its training data it can
invent or smear detail, and it can't be tuned per signal.

## CNN, transformer, U-Net

These are two separate choices.

- **U-Net is the shape:** an encoder that downsamples, a decoder that upsamples, and
  skip connections at each resolution.
- **Conv or attention is the block** used at each level of that shape.

| | Conv blocks | Attention blocks |
|---|---|---|
| U-shaped | Classic U-Net; OIDN 2 | Restormer, Uformer, Swin-UNet |
| Flat | Plain stacked CNNs | The original Vision Transformer |

A convolution looks at a small fixed window with weights fixed at training time.
Attention compares each patch with every other patch in its window and decides per
frame how much to take from each. A bilateral filter is the hand-written version of
that test; attention learns what "similar" means and reaches across larger distances
and across history. It costs much more compute than a 3×3 convolution, which is why
restoration transformers keep the U shape and put the heavy attention at coarse levels.

## Kernel prediction

A kernel-predicting network does not output colour. It outputs, per pixel, the weights
of a filter that is then applied to the noisy input (and to history). Two consequences:

- The result is a weighted average of real samples, so it can't invent detail and it
  fails more gently than a network that paints pixels directly.
- The filtering passes stay ordinary shader code. Only the weights come from the
  network.

This is the family AMD's description puts Ray Regeneration in, and it is the family
OIDN 3 is reported to be moving to ([nppd-fssa.md](nppd-fssa.md)).

## Proposed experiment

Tracked in [#46](https://github.com/pmndrs/denoiser/issues/46). One signal, not a new
denoiser.

1. **Signal: shadows.** Our hand-tuned shadow filter boils on moving occluders and
   orbits, so there is a real problem to beat and a boil metric to score with.
2. **Data: our own captures.** Noisy per-signal inputs with converged references.
   Noisebase is 1.84 TB, its license is unconfirmed, and it hasn't been checked for
   per-signal splits.
3. **Model: tiny.** Well under JNDS's 2.6 M parameters, since it runs per signal. A
   small conv U-Net that outputs per-pixel kernel weights and a temporal blend factor.
4. **Runtime: WGSL**, reusing the existing reprojection and history passes.
5. **Score** against the hand-tuned shadow filter on the dynamic-content eval, per
   region: boil, penumbra error, ghosting, frame cost at 1080p.

Decide before starting:

- Measure OIDN 3's real-time model. Confirm whether it supersamples (it may build on
  JNDS) and what it costs at 1080p. The gate in [nppd-fssa.md](nppd-fssa.md) was
  written about full-frame models; a per-signal weight predictor is a different slot.
- Confirm the capture pipeline can emit enough varied shadow sequences with references.
- Set a parameter and frame-time budget for one signal.
- Define the pass/fail bar before training anything.

## Reading list

Papers and permissively licensed research code are fine under the clean-room rules.
NRD's code and AMD's binary are not.

| Paper | Why |
|---|---|
| FSSA, Bálint et al., SIGGRAPH 2026 ([arXiv:2602.08642](https://arxiv.org/abs/2602.08642)) | Current best public result; Apache 2.0 code, no weights yet |
| NPPD, Bálint et al., SIGGRAPH 2023 ([paper](https://balint.io/nppd/nppd_paper.pdf)) | Kernel-predicting spatiotemporal denoiser; code, weights and data public |
| JNDS, Thomas et al., Intel 2022 ([article](https://www.intel.com/content/www/us/en/developer/articles/technical/temporally-stable-denoising-and-supersampling.html)) | Joint denoising and supersampling at 2.6 M parameters |
| AFGSA, Yu et al., SIGGRAPH Asia 2021 | Self-attention guided by auxiliary buffers, for Monte Carlo denoising |
| Restormer, Zamir et al., CVPR 2022 | Standard transformer U-Net for image restoration |
| KPCN, Bako et al., SIGGRAPH 2017 | Origin of kernel prediction |

The last three rows are from memory and were not re-read for this note.
