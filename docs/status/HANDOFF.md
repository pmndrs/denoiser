# Handoff — 2026-10-14

Where the project is and what's left, written for a fresh session in this folder.
Older history: [STATUS.md](STATUS.md) (next actions, known issues), [ROADMAP.md](ROADMAP.md),
eval numbers in [eval-2026-10-08-quiet.md](eval-2026-10-08-quiet.md).

## Where the repo lives

- **Work here:** `/Users/dex/Developer/Denoiser`, branch `main`.
- **Experiment worktree:** `/Users/dex/Developer/Denoiser-probes`, branch `exp/reflection-probes` (see 2026-10-19).
- **Old clone:** `/Users/dex/Documents/GitHub/homefig/Denoiser` is stale, sitting on `feat/network-runtimes`.
  It has no uncommitted or unpushed work. Keep it only until its gitignored data is copied over (see Cleanup).

## Held back, then pushed on 2026-10-19

On 2026-10-14, local `main` was 6 commits ahead of `origin/main` (`d2e5b7a`). Nothing below is pushed:

1. **Runtime examples/docs (`6cbf302`, merge `17628c3`):**
   - gallery and bench runtime pickers gain WebNN and Auto;
   - the gallery status line shows what Auto picked;
   - WGSL is no longer labelled experimental;
   - `choosing-a-runtime.mdx` gets a "See it running" section.
2. **FFX use-case demo (`9895cbd`, `ae7cd59`, merge `ec0fb8f`):**
   - `examples/three-temporal/shadows.html` becomes the "when would you use FFX?" page;
   - furnished room, area-light shadows ray traced with three-mesh-bvh 0.9.16 (WebGPU/TSL) at 1 ray/pixel;
   - shadow modes: shadow map / raw / `ffxShadows` / reference; reflection modes: env / raw SSR / `ffxReflections`;
   - live GPU cost table and explainer boxes on the page;
   - landing card plus `docs/site/examples/index.mdx`;
   - "Which denoiser do I need?" section in `realtime-temporal-denoising.mdx`.
3. **Examples hub (`3778dd4`):** `yarn examples` is now one dev server. The landing page is at
   http://localhost:5160/, and each example is at `/<dir>/`. Each example gets its own Vite server
   in middleware mode, started on first visit. `yarn examples <name>` still runs one example standalone;
   `--list` prints the index.

Verified locally: `yarn build:lib`, the CI typecheck list plus `three-temporal` and `gallery`,
`node tools/build-site.mjs`, and every example loading through the hub in headless Chrome with no exceptions.

**Not verified:**
- Hub reload-on-save. The HMR socket connects, but an edit didn't trigger a reload in the sandboxed
  test, for the standalone servers too. Needs a manual check.
- The FFX demo running live in a normal browser at 60 fps, and on any non-Apple GPU.

**Pushing `main` does not publish to npm.** It runs CI and redeploys GitHub Pages
(https://pmndrs.github.io/denoiser/). npm publishing is only the manual `release.yml` workflow.
The user wanted to hold the push until they had looked things over, so ask before pushing.

## Added 2026-10-18

- **Pipeline Lab** (`examples/pipeline-lab`): three-gpu-pathtracer → denoiser → @pmndrs/upscaler on one device,
  through the tracer's `setDenoiser` / `setUpscaler` hooks (`src/passes.ts`). Scenes: spheres, furnished room,
  LEGO Eiffel, your own .glb. Benchmark button: per-stage times + PSNR vs a high-spp reference, "run on every
  runtime" (reloads per runtime), results copy out as Markdown/JSON. Guide: `docs/site/guides/benchmarking.mdx`.
  Known: HF-kernels logs a destroyed-texture validation error during a benchmark run (results fine); skinned
  glTF models render black (tracer limitation).
- **Example shell:** every example has a top bar (back to list, prev/next, jump menu) and shared controls styling
  (`examples/_shared/shell.ts`, `shell.css`). One example list, `examples/_shared/examples.json`, drives the
  landing page (`tools/site.mjs`), the menus and `build-site.mjs`'s deploy list. Adding an example = one entry
  + a 640×400 shot in `examples/site/shots`.
- **Reflections explainer** (`three-temporal/reflections-hybrid.html`): probe / SSR + probe / ray traced / hybrid / reference,
  split-screen compare (two `ffxReflections` instances), a "where reflections come from" view, a 7-step guided tour
  (`?scenario=mirror|offscreen|moving|contact|rough|sources|explore`), diagrams and a decision guide. The room gained a mirror,
  a front wall with lit art, a globe lamp and a plant (only visible in reflections). GPU frame at 960x540 on M-series:
  probe 3.5, SSR 3.9, hybrid 4.2, ray traced 6.0 ms. Probe bake: ~2.5 ms since 2026-10-19 (see below).
- **Shadow split experiment** merged (`three-temporal/shadows-split.html`).
- **three-gpu-pathtracer** pinned to upstream main `1e206d8` (after 0.0.27). three is 0.186.1 (latest).
  @pmndrs/upscaler 0.5.0 is the latest release; its merged #89/#90 fixes need a 0.5.1.

## 2026-10-19

Main was pushed to `origin/main` on this date, including everything above.

- **Upscaling with path-traced input is spatial only.** The tracer's `setUpscaler` hook passes the accumulated
  average, rendered with its own random per-pixel jitter, not one frame under the upscaler's jitter. Temporal would
  smear (jitter on) or gain nothing (jitter off). The plan is filed as pmndrs/upscaler#93. The Pipeline Lab and
  the site docs say so.
- **`upscale-pipeline` moved to Tools** (`deployed: false`) as "Upscaler wiring check (synthetic noise)": its input
  is a raster scene with fake noise, so it doesn't show path-traced quality.
- **`three-pathtracer-webgpu?fsr=1`** uses @pmndrs/upscaler's spatial path instead of three's `FSR1Node`.
  No example uses three's FSR1 any more.
- **Reflections explainer probe bake: ~33 ms → ~2.5 ms** at 256² (render loop stopped, M-series).
  - The bake used to add a shadow-casting stand-in `SpotLight` per capture and remove it after. Changing the light
    count re-keys every material (~29 ms). The light now stays in the scene at intensity 0 between bakes
    (`shadow.autoUpdate = false`). Cost: +0.08 ms/frame raster. The image is pixel-identical.
  - `DynamicLighting` (three r184+) would not fix it: it doesn't batch shadow-casting lights.
  - The prefilter is `SkyPmrem` from `@pmndrs/sky@0.6.0` (3.5 → 1.1 ms). `?pmrem=three` switches back to three's
    `PMREMGenerator`. On r186's atlas layout the rough levels differ slightly (mean 1.9/255).
  - `__t.probeBench(n)` times fence latency, first/warm capture and the prefilter separately. Time with
    `?manual`: while the render loop runs, `onSubmittedWorkDone` alone takes 9-19 ms (0.1 ms when stopped).
- **Ben Houston's `ReflectionProbes` (three.js PR #35046)** is the multi-room probe system; ours is one room.
  - The user's three.js fork (`~/Developer/three.js`, pushed to `DennisSmolek/three.js`) has
    `pmrem-compute-probes`: Ben's head plus a compute `PMREMGenerator` and target reuse between bakes.
  - Measured on Ben's example (3 probes + env, loop stopped): PR head 29.4 / 32.5 ms at 128 / 256;
    with both commits 14.2 / 14.4 ms. No PR offered to Ben or upstream yet; the user decides.
  - His PR needs `CubeArrayTexture` (#35053, open) and cube-array sampling (#35045, merged after r186).
- **Experiment:** a standalone, swappable version of Ben's probes on r186, in the worktree above. Same
  methodology and memory layout (a 2D array of 6 × N faces with roughness mips); our own cube lookup and compute
  prefilter. The first question is whether face seams show on rough surfaces without hardware cube filtering.

## Runtime / denoiser status

- **`denoiser/auto` (default):** WebNN fp16 for base/large models when available, else WGSL. Never ORT.
- **`denoiser/wgsl`:** stable and correct on every model.
- **`denoiser/webnn`:** needs the Chrome flag `WebMachineLearningNeuralNetwork`.
- **`denoiser/ort`:** opt-in. Wrong on `*_alb` / `*_alb_nrm` (ORT WebGPU conv bug, microsoft/onnxruntime#29651,
  worked around by splitAux). `*_large` falls back to base.
- **`denoiser/kernels`:** experimental.
- **`denoiser/ffx`, `denoiser/three`:** FFX shadows and reflections as TSL nodes.
- **1080p base model on M5 Pro:**

  | Runtime | Time |
  |---|---|
  | native Metal OIDN | 24.8 ms |
  | WebNN fp16 | 40.1 ms |
  | WGSL fp16 | 67 ms |
  | kernels | 163 ms |
  | ORT | 210 ms |
  | FFX shadows | 0.49 ms |
  | FFX reflections | 1.66 ms |

- **Positioning:** OIDN is for a whole path-traced frame, on demand, tens of ms. FFX is for one ray-traced
  effect inside a real-time raster app, every frame.

## Open items needing the user

- **Publish `denoiser@2.0.0` to npm.** npm `latest` is still `0.0.11`. Either add an `NPM_TOKEN` repo secret
  and run `release.yml`, or publish locally. Then tag `v2.0.0` and make the GitHub release (issue #12).
- **11 gallery PNGs** accidentally committed earlier: keep them or restore?
- **Outreach docs** (`docs/outreach/*`, with `<DEMO LINK>` placeholders) and the upstream HF-kernels / ORT issues.
  Public posts need the user's approval.
- **Remote branch `origin/feat/network-runtimes`** is fully merged. Delete it if the user wants
  (the auto-mode classifier blocked doing it unasked).

## Offered, not yet approved

- **Close #13** (maxRunPixels): already fixed in `packages/denoiser-core/src/engine.ts:195`.
- **#14:** move the docs build to `npx -y @pmndrs/docs@latest build docs out --format website`.
  The frozen `ghcr.io/pmndrs/docs:3` image still works.
- **#11:** update the text. The pathtracer is pinned to upstream main 0.0.27, awaiting an npm release.
- **`examples/realtime-compare`:** fix its 5 TS errors under r186 TSL types. It builds and runs, and isn't in CI.
- **A "Runtimes" side-by-side comparison demo page.**
- **FFX demo perf:** about 3 ms of shadow rays at 960×540. three-mesh-bvh only has closest-hit; a custom
  any-hit/early-out traversal or a compute pass might be faster. The FSR3 flicker numbers in
  `three-and-tsl.mdx` were measured before a tone-map fix on the upscaled path.
- **Cosmetic:** the gallery runtime segmented control has empty space on its right.

## Done elsewhere

- **pmndrs/upscaler#90** (exposure dead-band) is MERGED. #89 and #91 were still open there.

## Cleanup (later)

- **Copy gitignored data from the old clone into this one:**
  - `packages/denoiser/models` (local ONNX models; without it the bench's ORT option has no local models,
    and the pathtracer falls back to the CDN);
  - `tools/eval/out`;
  - `tools/onnx-convert/.venv` (or recreate it from `requirements.txt`).
- **Then delete** `/Users/dex/Documents/GitHub/homefig/Denoiser` and `/Users/dex/Developer/.Denoiser-partial-copy-55183`.
- **Remove the upscaler worktree** `.claude/worktrees/ae-deadband` in the upscaler repo now that #90 is merged.

## Roadmap (not started)

- OIDN 3 temporal, once upstream ships it. The FFX temporal API is source-agnostic so it can slot in.
- The user's own web-focused denoiser.
