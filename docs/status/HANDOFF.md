# Handoff — 2026-10-14

Where the project is and what's left, written for a fresh session in this folder.
Older history: [STATUS.md](STATUS.md) (next actions, known issues), [ROADMAP.md](ROADMAP.md),
eval numbers in [eval-2026-10-08-quiet.md](eval-2026-10-08-quiet.md).

## Where the repo lives

- **Work here:** `/Users/dex/Developer/Denoiser`, branch `main`. There are no other local branches or worktrees.
- **Old clone:** `/Users/dex/Documents/GitHub/homefig/Denoiser` is stale, sitting on `feat/network-runtimes`.
  It has no uncommitted or unpushed work. Keep it only until its gitignored data is copied over (see Cleanup).
- **Never commit** `.yarn/install-state.gz`; it shows as modified after every install. Stage explicit paths.
- **Commit messages** end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Local `main` is ahead of GitHub (not pushed)

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
- **Push local `main`**; see above.
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
