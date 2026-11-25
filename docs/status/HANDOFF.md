# Handoff — 2026-10-14

## 2026-11-20: three r187 (`chore/three-r187`, merged 2026-11-25)

- **three 0.187.0, @types/three ^0.187.0; peer range `>=0.187.0`** (was `>=0.185.0`) in `denoiser` and `denoiser-three`.
  Raised because the nodes now extend `Node` (three r187 deprecates `TempNode`, and `Node` as a base only exists
  with the r187 node core); the sibling stack (@pmndrs/reflections, @pmndrs/bvh) is on r187 as well.
- **three-gpu-pathtracer: npm `0.0.28`** (first release built for r187) replaces the SHA pin `1e206d8` in
  `ldraw-eiffel`, `three-pathtracer-webgpu`, `oidn-web-compare`, `pipeline-lab`; `three-mesh-bvh ^0.9.17` (its peer). This closes #11.
- **Code changes:** `DenoiseNode`, `TemporalDenoiseNode` and the example nodes extend `Node`, not `TempNode`
  (no "THREE.TempNode deprecated" warning from our code; the one left comes from `@pmndrs/upscaler` 0.5.0). No
  VelocityNode or TAA-registration code lives in this repo, so nothing to change there.
  `pipeline-lab`'s `DenoiserPass` is now an `EventDispatcher` with `useAuxiliaryBuffers = false` (0.0.28's
  `setDenoiser` calls `addEventListener('progress')`; before that it threw "denoiser.addEventListener is not a function").
  `pipeline-lab/src/types.d.ts` (the GradientEquirectTexture module declaration; `*.d.ts` is gitignored, force-added).
- **#21 (compileAsync back faces) does not reproduce on r187**: the issue's repro reads 0.331 plain and 0.331 after
  `compileAsync` (r186.1: 0.331 / 0.078). The impostors workaround is no longer needed on r187; close the issue
  once the stack is on r187 (not closed here).
- **Checks (real GPU, headless Chrome/WebGPU, loaded machine, correctness only):** `yarn build:lib`, the full `yarn build`,
  the CI typecheck list plus `denoiser-three`, `denoiser-ffx`, `denoiser-realtime`, `three-temporal`, `pipeline-lab`: clean.
  There are no unit tests (`yarn test` is `vitest run` and vitest isn't a dependency, as on main).
  `three-temporal` pages (`run-realtime.mjs smoke`): index, shadows, shadows-split, realtime-shadows, realtime-gi,
  realtime-glass, reflections-hybrid, reflections-rooms, golden: pass. `reflect-bench` and `reflection-probes` render
  ("60 fps", "three r187, 3 probes") but fail the smoke runner's ready probe, exactly as on r186 (the probe expects a status
  text those pages don't write). `run-realtime.mjs shadows` and `gi`, `run-headless.mjs ssr` and `shadows`: all checks pass, 0 NaN.
  ffx-denoiser `mode=eval` (shadows + reflections): every non-timing field identical to r186.
  Screenshots r187 vs r186 (realtime-shadows, 9 images): the FFX/ours/noisy/reference all differ by mean 0.6/255,
  0.07% of pixels over 8/255, max 40: the same on the noisy and the reference image, so it is r187's scene render, not the denoiser.
  Path tracer pages (`three-pathtracer-webgpu`, `ldraw-eiffel`, `oidn-web-compare`, `pipeline-lab`) load, accumulate and denoise.
- **Not changed:** the reflection-probe stand-in (`three-temporal/src/probes`) still is the r186-era port (cube arrays in a
  2D array texture, own prefilter); r187 has native cube-array binding and cube-mip PMREM, so it can be dropped for the
  real `ReflectionProbes` when #35046 lands. Asset URLs in `ssr.ts` / `reflect-bench` still point at the three `r186` tag.
  Remaining `THREE.TempNode` warning is `@pmndrs/upscaler` 0.5.0. New warning from the tracer: "adaptiveFrameBudget needs
  timestamp queries" (harmless; create the renderer with `trackTimestamp: true` to silence).

Where the project is and what's left, written for a fresh session in this folder.
Older history: [STATUS.md](STATUS.md) (next actions, known issues), [ROADMAP.md](ROADMAP.md),
eval numbers in [eval-2026-10-08-quiet.md](eval-2026-10-08-quiet.md).

## 2026-11-12: branches consolidated onto main

- **FFX reflections:** #24 (`motionVectorScale`), #25 (read-only `variance`) and #26 (optional indirect tile list) merged.
  The `ffx-denoiser` reflections eval is identical to the old baseline on every path (default, `motion=uv`, `tiles=all`,
  both): 23.4556 dB, flicker 0.00803.
- **`denoiser/realtime` (the clean-room GI / per-signal denoisers) is on main, experimental.** It came in through
  `feat/rt-denoiser-cleanroom`, with the phase-1 diagnosis tracks D, S and R and the native results folded in first.
  The next npm release ships `denoiser/realtime` and the `realtime*` nodes in `denoiser/three`, unless the release
  drops them. The project's own status is in `docs/research/rt-denoiser/STOCKTAKE-2026-11-06.md`: experimental,
  about 200 options still to prune, and visually behind FFX on the reflection bench. Phase-2 work branches from main now.
- **Retired (superseded, kept on origin as a record):** `feat/interior-lab`, `feat/shadow-bench`, `track/t0-scenes`,
  `track/t0-scorecard`, the track branches above.
- **#29 merged 2026-11-13** (hit-source / hit-distance affinity: `separateHitSources`, `missesMatchAnySource`,
  `hitDistanceWeight`, all off by default). Defaults match the old baseline on every path; the look with them on
  is not judged on the bench yet. It uses the last `Params` slot (`f[63]`), so the next reflections option has to
  grow `PARAMS_SIZE`.
- **Still open:** #27 (reflection pages on `@pmndrs/reflections`; do not merge until that package is released). #15 (jitter study) was closed. The denoiser → upscaler chain is tracked in #30,
  and the branch `exp/jitter-study` is kept.

## Where the repo lives

- **Work here:** `/Users/dex/Developer/Denoiser`, branch `main`.
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
  probe 3.3, SSR 3.9, hybrid 4.2, ray traced 4.5 ms; no reflections 3.1 ms (re-measured 2026-10-19: `?manual`, "Explore" view,
  median of 6 × 60 frames, ±0.4 ms). Probe bake: ~1.8 ms since 2026-10-19 (see below).
- **Shadow split experiment** merged (`three-temporal/shadows-split.html`).
- **three-gpu-pathtracer** pinned to upstream main `1e206d8` (after 0.0.27). three is 0.186.1 (latest as of then; 0.187.0 since 2026-11-20, see above).
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
  - The probe is now one `ReflectionProbe` from `three-temporal/src/probes` (the #35046 stand-in below), baked with
    `ReflectionProbes.bake(..., { environment: false })` and sampled with `sampleReflectionProbes(probes, P, dir, rough)`.
    It captures from the old point (`originOffset`); the projection box is the room, pushed out to x = 8 / y = 4 on
    the open sides so nothing visible is outside it (the 3.3 m box left a hard edge in the "moving" view). The
    prefilter is our compute pass (WGSL vendored from @pmndrs/sky 0.6.0, r187's cube-mip algorithm); the
    `@pmndrs/sky` dependency and `?pmrem=` are gone. Bake: ~1.8 ms per timed bake, ~1.05 ms in bursts (256 px).
    Images vs the old CubeUV probe: probe mode mean 0.5-3.6/255 per scenario (r187's roughness-to-mip mapping
    puts a soft halo around emitters seen in the mirror); hybrid 0.1-0.8/255.
  - `__t.probeBench(n)` times fence latency, the first and warm bakes, and the stand-in setup. Time with
    `?manual`: while the render loop runs, `onSubmittedWorkDone` alone takes 9-19 ms (0.1 ms when stopped).
- **Ben Houston's `ReflectionProbes` (three.js PR #35046)** is the multi-room probe system; ours is one room.
  - The user's three.js fork (`~/Developer/three.js`, pushed to `DennisSmolek/three.js`) has
    `pmrem-compute-probes`: Ben's head plus a compute `PMREMGenerator` and target reuse between bakes.
  - Measured on Ben's example (3 probes + env, loop stopped): PR head 29.4 / 32.5 ms at 128 / 256;
    with both commits 14.2 / 14.4 ms. Later fork commits (by the three.js-side session) keep the moving mirror
    out of live captures and clear the environment slot when it's removed (`3cb8af5b6b`). No PR offered to Ben
    or upstream yet; the user decides.
  - His PR needs `CubeArrayTexture` (#35053, open) and cube-array sampling (#35045, merged after r186).
- **Ben's probes on r186, as example code (merged 2026-10-20).** `three-temporal/src/probes` stands in
  for three.js #35046 until it lands (same API; swap the imports for three's then). Not part of the published
  `denoiser` package. A 2D array of 6 × N faces with roughness mips, our own cube lookup with a 'warp' seam fix,
  and a compute prefilter. Extensions over #35046: `sampleReflectionProbes(probes, P, dir, rough)` (any shader;
  the environment node uses the same lookup), `ReflectionProbe.originOffset`, `bake({ environment: false })`.
  - **`reflection-probes.html`:** Ben's two-room example on that code. Matches his PR build within 8-bit noise;
    3 probes bake in 3-5 ms.
  - **`reflections-rooms.html`:** the same two rooms (his animated version: lights drifting through the hues, the
    knot turning; "Animate room" and "Live capture" toggles) with a polished floor and a mirror ball kept out of
    the captures. Probes only / probes + SSR / probes + SSR + rays (`ffxReflections()`) / reference, a 6-step tour,
    split view, cost table. Measured at 960x540 (`?manual`, 60-frame means): probes only ~2.9 ms, ~4.7 with live
    capture; probes + SSR + rays ~5.05, ~5.45 live; probes + SSR ~3.6-4.0. A bake of all 3 probes at 128 px:
    2.2 ms (bursts, loop stopped; ~1.8 ms of it is CPU encoding); each light's shadow map renders once per bake
    instead of once per face (2.9 → 2.2 ms).

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
- **#11:** done on `chore/three-r187` (pathtracer from npm 0.0.28); close it when that merges.
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
