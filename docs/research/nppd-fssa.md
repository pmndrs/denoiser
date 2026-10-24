# NPPD and FSSA: research neural denoisers vs OIDN 3

_2026-10-24. Papers (authors' copies): [NPPD](https://balint.io/nppd/nppd_paper.pdf) + [supplementary](https://balint.io/nppd/nppd_supplementary.pdf), [FSSA](https://balint.io/fssa/fssa.pdf) ([arXiv](https://arxiv.org/abs/2602.08642)). Related: [temporal.md](../specs/temporal.md),
[pmndrs/denoiser#16](https://github.com/pmndrs/denoiser/issues/16) (OIDN 3 runtime)._

## TL;DR

- **The follow-up to NPPD is FSSA**, "Forget Superresolution, Sample Adaptively (when
  Path Tracing)" (Bálint et al., SIGGRAPH 2026 / ACM TOG). It keeps NPPD's network and
  adds a sampler network that tells the path tracer where to spend samples.
- **Neither is lighter than OIDN.** NPPD's small model has 15 M parameters and its large
  model 30 M. OIDN's `rt_*` models have 0.32 M (small), 0.92 M (base) and 3.85 M (large).
  FSSA's main results use the same 15 M network. The only model in the paper near our
  size class is FSSA's "Mini" ablation: 2.6 M parameters, using the JNDS network from
  Intel's 2022 real-time paper. [Issue #16](https://github.com/pmndrs/denoiser/issues/16) suspects that same line of work is the basis
  of OIDN 3.
- **NPPD is dropped.** FSSA beats it on every metric in the paper. Even the 2.6 M Mini
  uniform model (no adaptive sampling) beats the 15 M NPPD on most metrics.
- **The OIDN lock-in is about data, not code** ([below](#oidn-lock-in-and-who-else-is-in-the-game)).
  OIDN's architecture, weights and training toolkit are all Apache 2.0, and the runtimes
  are ours. Intel's training data and release schedule are the parts we don't control.
  No other open, maintained, cross-vendor neural denoiser exists. The hedge is being able
  to retrain OIDN's architecture on open data, not switching to another vendor.
- **Don't train anything before OIDN 3 ships.** OIDN 3 is due late November 2026, five
  weeks from now. It brings temporal denoising plus kernel prediction, from Intel, under
  Apache 2.0, with weights. FSSA weights and training data are "coming months".
  Training our own is affordable in compute ($50–500 per run). The real costs are the
  data (1.8 TB or more) and the engineering.
- **Revisit after OIDN 3 lands** if any of these is true: its real-time model is too
  heavy for 1080p in the browser, FSSA weights are published, or we want adaptive
  sampling in three-gpu-pathtracer. Adaptive sampling is the one thing here that
  OIDN 3 won't give us.

## The two papers

| | NPPD (2023) | FSSA (2026) |
|---|---|---|
| Venue | SIGGRAPH 2023 Conference Papers, [doi:10.1145/3588432.3591562](https://doi.org/10.1145/3588432.3591562) | ACM TOG 45(4), SIGGRAPH 2026, [doi:10.1145/3811377](https://doi.org/10.1145/3811377) |
| Paper | [PDF](https://balint.io/nppd/nppd_paper.pdf), [supplementary](https://balint.io/nppd/nppd_supplementary.pdf), [project page](https://balint.io/nppd/) | [PDF](https://balint.io/fssa/fssa.pdf) (CC BY 4.0), [arXiv:2602.08642](https://arxiv.org/abs/2602.08642), [project page](https://balint.io/fssa/) |
| Authors | Bálint, Wolski, Myszkowski, Seidel, Mantiuk (MPI Informatik / Cambridge) | Bálint, Salaün, Seidel, Myszkowski (MPI Informatik) |
| What it is | Kernel-predicting spatiotemporal denoiser. A network predicts per-pixel weights for a 5-level "partitioning pyramid": the radiance is split across scales, filtered with 5×5 kernels, and recombined with learned 4×4 upsampling kernels (110×110 px footprint). Then a learned temporal blend and a 5×5 temporal kernel. | Sampler U-Net plus denoiser U-Net. The sampler predicts a sample-density map from the previous frame and the G-buffer. The path tracer renders that many samples per pixel, then a gather-pyramid filter reconstructs the frame. Trained end to end through a relaxed stochastic-rounding estimator. |
| Inputs | Per-sample radiance + albedo, camera-space normal, depth (encoded per sample by a small 3-layer MLP, then averaged per pixel); previous output + backward motion | Full-resolution G-buffer, sparse samples (0.11–4 spp), previous HDR and display output, motion |
| Networks | OursSmall: 15 M U-Net (max-pool, LeakyReLU). OursLarge: 30 M ConvNeXt/Restormer-style | Same 15 M network for sampler and denoiser. Mini ablation: 2.6 M JNDS network |
| Speed (paper) | Small: 32 ms at 1080p (TensorRT/XLA; the GPU isn't named). Large: about 500 ms, like OIDN 1.4 | 15 M: 48.7 ms at 1440p; 2.6 M Mini: 4.3 ms at 1440p (TensorRT INT8, RTX 3090) |
| Quality headline | Beats OIDN 1.4, AFGSA and OptiX on PSNR/SSIM/FovVideoVDP/FLIP at 2–32 spp | At 0.25 spp (equal to DLSS at 50% scale): 25.41 dB PSNR vs NPPD 23.92 vs DLSS 4 RR 22.88. Mini uniform: 24.16 dB, still above NPPD |
| Code | [balintio/nppd](https://github.com/balintio/nppd), Apache 2.0, PyTorch Lightning + Hydra | [balintio/fssa](https://github.com/balintio/fssa), Apache 2.0, "preliminary": modules, filters, loss; no training script |
| Weights | **Released.** [`nppd_pretrained.zip`](https://neural-partitioning-pyramids.mpi-inf.mpg.de/data/nppd_pretrained.zip), 1.08 GB, four Lightning checkpoints (below) | **Not released.** Listed under "planned releases" |
| Training data | **Released** via [Noisebase](https://github.com/balintio/noisebase): `sampleset_v1`, 1.84 TB (1024 sequences × 64 frames of 256² crops, 32 spp, references at 6144 spp) | **Not released.** It extends Noisebase (8 outdoor + 8 indoor scenes, pre-rendered up to 256 spp); listed as planned with Noisebase v2 |

> **Data status check.** As of 2026-10-24 the FSSA repo still lists "training dataset and
> a complete training script" as planned; its last commit is 2026-07-22. The data that
> *is* public is NPPD's `sampleset_v1`, which FSSA's set extends. If FSSA data has
> appeared somewhere else, add the link here.

Notes from reading the papers:

- FSSA says the 15 M NPPD network "also serves as the highest-quality preset for OIDN
  [Áfra 2024]". So OIDN and this group are already sharing architectures. OIDN 3 is also
  moving to kernel prediction, according to the
  [CG Channel announcement](https://www.cgchannel.com/2026/01/open-image-denoise-3-will-support-temporal-denoising/).
- NPPD's per-sample encoder only pays off with several spp. three-gpu-pathtracer
  accumulates per pixel, so we would feed it one "sample" per pixel and lose that part.
- Both papers need a temporal loop: warping, blending and history. Our
  `TemporalDenoiser` interface ([temporal.md](../specs/temporal.md)) already models this.
  OIDN 3's real-time mode will need the same inputs: previous output, backward motion,
  depth.

## Size: NPPD/FSSA vs what we ship

| model | params | weights on the wire (fp16) | source |
|---|---|---|---|
| OIDN `rt_*_small` | 0.32 M | 0.64 MB | our `.tza`, counted |
| OIDN `rt_*` (base) | 0.92 M | 1.8 MB | our `.tza`, counted |
| OIDN `rt_*_large` | 3.85 M | 7.7 MB | our `.tza`, counted |
| JNDS / FSSA Mini | 2.6 M | ~5 MB | FSSA §8.1 |
| NPPD small / FSSA main | 15 M | ~31 MB | paper; checkpoint 187 MB ÷ 3 (weights + 2 Adam moments) ≈ 62 MB fp32 |
| NPPD large | 30 M | ~67 MB | paper; checkpoint 402 MB ÷ 3 ≈ 134 MB fp32 |

Parameter count is not compute: NPPD's network runs partly at pyramid resolutions.
Still, the paper's own 32 ms at 1080p for the small model is TensorRT on an NVIDIA
desktop GPU. Our fastest web path for OIDN large (3.85 M) is 65 ms at 1080p with WebNN
and 167 ms with WGSL on an M5 Pro ([ROADMAP](../status/ROADMAP.md)). Expect NPPD small
in the browser to land well above OIDN large, not below it. To get "lighter than OIDN"
with temporal and supersampling, the candidate is a JNDS-class network around 2.6 M.

## What's in the released NPPD weights

Listed from the zip's central directory with a range request; the zip was not downloaded:

```
401.9 MB  outputs/large_32_spp/ckpt_epoch/epoch=43-val_loss=0.207870.ckpt
401.9 MB  outputs/large_8_spp/ckpt_epoch/epoch=51-val_loss=0.241670.ckpt
187.2 MB  outputs/small_2_spp/ckpt_epoch/epoch=47-val_loss=0.294069.ckpt
187.2 MB  outputs/small_4_spp/ckpt_epoch/epoch=52-val_loss=0.268622.ckpt
```

These are PyTorch Lightning training checkpoints with optimizer state. To ship one, load
it in the repo's Python, keep `state_dict` only, cast to fp16 and export: to ONNX for
the ORT/WebNN runtimes, or to our own packed format for WGSL. The whole pipeline is a
network plus hand-written filters: sample encoder, warp, pyramid split/filter/upsample,
temporal kernel. Only the network part fits the ONNX path; the filters are WGSL work,
much like FFX.

## Training time and cost

What the papers report:

| run | hardware | time | GPU-hours |
|---|---|---|---|
| NPPD small (15 M), 50 epochs | 1× A40 | 2–3 days | 48–72 A40-h |
| NPPD large (30 M), 50 epochs | 4× A40 | 4–5 days | 384–480 A40-h |
| FSSA (2 × 15 M), 256 epochs, AMP | 1× H100 | ~5 days | ~120 H100-h |
| FSSA Mini (2 × 2.6 M) | not reported | — | — |

Rough cloud cost per run. Prices are October 2026 list prices and moving up: H100 about
$2–4/h on RunPod/Lambda; A40 about $0.40–0.80/h on marketplaces (unverified).

| run | compute per run | notes |
|---|---|---|
| NPPD small | **~$30–60** (A40) or ~$70–120 (1 day on an H100) | the cheapest thing on this page |
| NPPD large | **~$200–400** | 4-GPU node |
| FSSA full | **~$250–500** | data not public yet; pre-rendered to 256 spp, so expect several TB |
| FSSA Mini | guess **~$100–250** | smaller networks rarely train proportionally faster; I/O and the filters dominate |

What the per-run numbers hide:

- **Data.** `sampleset_v1` is 1.84 TB. Downloading it takes 4–5 hours at a sustained
  1 Gbit/s. Cloud block storage for 2 TB costs roughly $150–200 a month, and 50 epochs
  over 1.84 TB needs local NVMe or the loader becomes the bottleneck. The FSSA set will
  be bigger.
- **Runs.** Budget 3–5 runs for a first model: one to reproduce the paper, then retrains
  for *our* inputs (1 spp per pixel from three-gpu-pathtracer, our aux set, our tone
  mapping). That puts realistic compute at **$200–500 for NPPD small** and
  **$1–2.5k for an FSSA-class model**, plus storage.
- **The M5 Pro.** Training locally is not practical for the full data: it needs 2 TB of
  disk, and MPS is several times slower than an A40 per run. Fine-tuning a Mini model on
  a subset might work.
- **The dominant cost is engineering.** Porting the filters, temporal loop and sampler
  integration to WGSL is weeks of work. FFX took a similar amount for simpler filters.

## Where to put the weights

Today OIDN weights live in `pmndrs/denoiser-weights` and are served by jsDelivr from
immutable `models-vN` tags ([STATUS](../status/STATUS.md)). That works because each file
is 0.6–7.7 MB. The research models are a different size class: NPPD small is about
31 MB in fp16, NPPD large about 67 MB.

| option | fit for 30–130 MB research weights |
|---|---|
| `pmndrs/denoiser-weights` + jsDelivr, new tag | Works up to a point. GitHub warns above 50 MB and refuses files over 100 MB. jsDelivr caps single-file size on its GitHub proxy (number not published) and we've hit its ~50 MB package cap before. fp16 NPPD small probably fits; large would need sharding. |
| **Hugging Face Hub model repo** (e.g. `pmndrs/nppd-web`) | **Recommended for anything non-OIDN or over ~20 MB.** LFS-backed with no practical per-file cap, CORS on `resolve/` URLs, a pinned `revision` instead of a tag, and a model card for license and citation (the Evermotion / ABO / Poly Haven provenance matters). It also fits the HF outreach ([hf-kernels.md](../outreach/hf-kernels.md)). |
| This repo, Git LFS | No. LFS media URLs are not a CDN, and org LFS bandwidth and storage quotas are small. |
| GitHub Release assets | No: they send no CORS headers (already verified). |

Either way, publish **inference-only fp16 weights**, never the Lightning checkpoints.
Pin them by tag or revision the way `models-v3` is pinned. The license chain needs
checking before any upload: the NPPD repo is Apache 2.0, but the zip and the
Noisebase data state no license of their own, and the training scenes are commercial
Evermotion assets. Ask the authors before redistributing anything derived from them.

## OIDN lock-in, and who else is in the game

What depending on OIDN actually means for us:

| piece | open? |
|---|---|
| Architecture | Yes. The U-Net is in OIDN's source, and our runtimes implement it. |
| Weights | Yes, Apache 2.0. We ship our own copies of the `.tza` files. |
| Training code | Yes, Apache 2.0. [`training/`](https://github.com/RenderKit/oidn/tree/master/training) in the OIDN repo (`preprocess.py`, `train.py`, `export.py` to `.tza`) trains "with image datasets provided by the user". |
| Runtime | Ours (WGSL, WebNN, ORT). No Intel code runs in the browser. |
| Training data | **No.** Intel trains on its own private dataset. |
| Roadmap | **Intel's.** OIDN 3 already slipped from end of 2025 to the second half of 2026. If Intel stopped, we would keep the last weights forever but get no new models. |

So the dependency is Intel's data and release schedule. The hedge is the ability to
train OIDN-architecture models ourselves. OIDN's toolkit plus an open dataset (NPPD's
`sampleset_v1`, averaged down to per-pixel images at a chosen spp) would do it, once
the dataset's license is confirmed. OIDN base is 0.92 M parameters, far cheaper to
train than NPPD (a guess: around a day on one GPU per run). Treat this as insurance to
buy if Intel stalls, not work to do now.

Everyone else:

| who | what | usable on the web? |
|---|---|---|
| NVIDIA OptiX denoiser, DLSS Ray Reconstruction | neural | No: proprietary, tied to NVIDIA drivers. |
| AMD FSR Ray Regeneration | neural | No: only headers plus a signed DX12 DLL ([FidelityFX SDK 2.x](https://github.com/GPUOpen-LibrariesAndSDKs/FidelityFX-SDK), `Kits/FidelityFX/signedbin/amd_fidelityfx_denoiser_dx12.dll`); the license allows binary redistribution only and forbids reverse engineering. |
| Apple MetalFX denoised upscaler | neural | No: Metal only. |
| AMD FidelityFX Denoiser 1.x | hand-tuned shadows and reflections | Yes, already ported (`denoiser/ffx`). |
| NVIDIA NRD (ReBLUR, ReLAX, SIGMA) | hand-tuned | No, as a port: the source is public ([NVIDIA-RTX/NRD](https://github.com/NVIDIA-RTX/NRD), v4.18.0, Oct 2026) but under the proprietary NVIDIA RTX SDKs license. It allows modifying only sample code, distributing only as object code inside an app, and no stand-alone redistribution, so a WGSL port in our MIT package is out without an agreement with NVIDIA. |
| SVGF / A-SVGF / BMFR | classic temporal filters | Yes: published papers, implementable in WGSL. |
| Academic neural (NPPD, FSSA, KPCN, neural bilateral grid…) | neural | Weights are rarely released. NPPD is the exception; FSSA's are promised. |

OIDN is the only open, maintained, cross-vendor neural denoiser with weights. Most of
the hedging is already done: we own the runtimes, and the `TemporalDenoiser` API takes
any source. What's left is non-neural temporal fallbacks (FFX done, SVGF-class later)
and, if needed, retraining OIDN's architecture ourselves.

## NRD: how it works and where it comes from

NRD ([NVIDIA-RTX/NRD](https://github.com/NVIDIA-RTX/NRD), v4.18.0, Oct 2026) is
NVIDIA's real-time denoiser for 1-path-per-pixel path tracing. **It isn't neural**:
there are no weights to train or download, only hand-tuned compute shaders. It's the
same family as the FFX filters we ported, with more signals.

- **Inputs:** per-pixel diffuse and specular radiance, each with its hit distance,
  plus the G-buffer (normals, roughness, view depth, motion). Materials are divided
  out before denoising and multiplied back in after, so it blurs lighting, not texture.
- **Temporal step:** reprojects history along the motion vectors and rejects
  disocclusions. Specular gets its own reprojection based on hit distance. History
  confidence and "anti-lag" logic reset stale history when lighting changes.
- **Spatial step:** a blur whose radius is set by hit distance, roughness and the
  number of frames accumulated. Contact lighting stays sharp, and young history gets
  blurred more.
- **Three filters:**
  - **ReBLUR** (diffuse/specular, plus ambient and specular occlusion): a "recurrent
    blur" whose output feeds back into the history.
  - **ReLAX** (diffuse/specular): SVGF-style à-trous filtering guided by variance,
    built to pair with RTXDI/ReSTIR.
  - **SIGMA** (shadows only): penumbra-sized blur from the distance to the blocker.
- **Cost** (README, RTX 4080, 1440p): ReBLUR diffuse+specular 2.55 ms, ReLAX
  3.25 ms, SIGMA 0.40 ms.

**vs DLSS Ray Reconstruction.** RR replaces this whole stack with one neural network
(a transformer since DLSS 4) that denoises and upscales every signal at once. It holds
fine specular detail better and ghosts less, but it is RTX-only and closed. NRD runs on
any D3D12/Vulkan GPU, can be tuned, and is cheaper on older hardware. For us, the NRD
tier is what FFX (and later an SVGF-class GI filter) covers. The RR tier is what
OIDN 3's real-time mode is aiming at.

**License.** The source is public, but under the proprietary NVIDIA RTX SDKs license
(see the table above), so we can't port NRD's code. We can implement the published
techniques below ourselves, written from the papers and the book chapter, not from
NRD's source.

**Lineage.** NRD was never published as a paper. The written sources are:

| source | what it covers |
|---|---|
| Zhdan, ["ReBLUR: A Hierarchical Recurrent Denoiser"](https://www.realtimerendering.com/raytracinggems/rtg2/), *Ray Tracing Gems II*, ch. 49 (2021; free download, CC BY-NC-ND 4.0) | ReBLUR, the closest thing to a paper |
| Zhdan, "Fast Denoising with Self-Stabilizing Recurrent Blurs", GTC 2020 ([slides](https://developer.download.nvidia.com/video/gputechconf/gtc/2020/presentations/s22699-fast-denoising-with-self-stabilizing-recurrent-blurs.pdf), [video](https://developer.nvidia.com/gtc/2020/video/s22699-vid)) | ReBLUR's origin (it grew out of the Metro Exodus denoiser): recurrent blur, temporal accumulation, hierarchical history reconstruction, blur weights |
| Schied et al., "Spatiotemporal Variance-Guided Filtering" (SVGF), HPG 2017, [doi:10.1145/3105762.3105770](https://doi.org/10.1145/3105762.3105770) | temporal accumulation + variance-guided à-trous: ReLAX's direct ancestor |
| Schied, Peters, Dachsbacher, "Gradient Estimation for Real-Time Adaptive Temporal Filtering" (A-SVGF), HPG 2018, [doi:10.1145/3233301](https://doi.org/10.1145/3233301) | dropping stale history when lighting changes (what NRD's anti-lag solves) |
| Dammertz et al., "Edge-Avoiding À-Trous Wavelet Transform for Fast Global Illumination Filtering", HPG 2010, [doi:10.2312/EGGH/HPG10/067-075](https://doi.org/10.2312/EGGH/HPG10/067-075) | the wide, cheap, edge-aware blur under SVGF and ReLAX |

ReLAX and SIGMA have no write-up beyond NVIDIA's [NRD page](https://developer.nvidia.com/nrd)
and the README. NVIDIA also holds patents on the recurrent-blur idea ("Denoising
techniques suitable for recurrent blurs", e.g. [US11823321](https://patents.google.com/patent/US11823321)).
They're noted for completeness; we work from the published chapter and papers, not
from the patents.

**If we build a diffuse/GI filter**, start from SVGF + A-SVGF (+ à-trous). They're
published, well understood, and match the `DiffuseInputs` slot in `TemporalDenoiser`.
Borrow ReBLUR ideas from the RTG II chapter where they help: hit-distance-driven
radius, recurrent blur, hierarchical history reconstruction.

## Is it worth doing?

| question | answer |
|---|---|
| NPPD? | **Dropped.** FSSA supersedes it with the same network, and its 2.6 M Mini variant already beats it. |
| FSSA now? | **Watch only.** No weights and no training script; data is "coming months". |
| Train our own now? | **No.** The compute is cheap; the data and the port aren't. And OIDN 3 lands in about 5 weeks with temporal kernel prediction from Intel, under Apache 2.0, with weights. |
| A lighter-than-OIDN denoiser? | Only a JNDS-class (~2.6 M) temporal network gets there, and that's likely close to what OIDN 3's real-time mode is. Measure OIDN 3 first. |
| Anything unique here? | **Adaptive sampling** (FSSA's sampler): the path tracer spends samples where they're visible. OIDN won't do that. It's a renderer feature as much as a denoiser one, and needs per-pixel sample counts in three-gpu-pathtracer. |

**Decision gates, after OIDN 3 ships:**

1. Port OIDN 3's real-time model ([#16](https://github.com/pmndrs/denoiser/issues/16)) on the WGSL/WebNN runtimes and measure 1080p.
2. If it's too slow for real time, or Intel stalls: train a smaller OIDN-architecture
   (or JNDS-class) model ourselves with OIDN's toolkit on open data.
3. FSSA only if it publishes weights *and* we want adaptive sampling in
   three-gpu-pathtracer (training FSSA Mini on our inputs: $1–2.5k compute).
4. Otherwise close this as "covered by OIDN 3".

## Sources

- NPPD: [paper](https://balint.io/nppd/nppd_paper.pdf), [supplementary](https://balint.io/nppd/nppd_supplementary.pdf), [project](https://balint.io/nppd/), [code](https://github.com/balintio/nppd), [Noisebase](https://github.com/balintio/noisebase), [SampleSet v1](https://balint.io/noisebase/datasets/sampleset_v1.html)
- FSSA: [paper](https://balint.io/fssa/fssa.pdf), [project](https://balint.io/fssa/), [code](https://github.com/balintio/fssa), [arXiv:2602.08642](https://arxiv.org/abs/2602.08642)
- OIDN: [training toolkit](https://github.com/RenderKit/oidn/tree/master/training); OIDN 3: [CG Channel, 2026-01](https://www.cgchannel.com/2026/01/open-image-denoise-3-will-support-temporal-denoising/), [OIDN milestone](https://github.com/RenderKit/oidn/milestone/1), JNDS: [Intel, 2022](https://www.intel.com/content/www/us/en/developer/articles/technical/temporally-stable-denoising-and-supersampling.html)
- NRD: [repo](https://github.com/NVIDIA-RTX/NRD), [NVIDIA page](https://developer.nvidia.com/nrd), [Ray Tracing Gems II](https://www.realtimerendering.com/raytracinggems/rtg2/), [GTC 2020 slides](https://developer.download.nvidia.com/video/gputechconf/gtc/2020/presentations/s22699-fast-denoising-with-self-stabilizing-recurrent-blurs.pdf)
- GPU prices: [RunPod H100, 2026](https://www.spheron.network/blog/runpod-h100-pricing-2026/), [Lambda H100, 2026](https://www.spheron.network/blog/lambda-cloud-h100-pricing-2026/)
