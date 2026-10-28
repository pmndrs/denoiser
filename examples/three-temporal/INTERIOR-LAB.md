# Interior lab: denoisers and resolvers side by side in Ben Houston's interior example

Ben Houston's `webgpu_interior` example (SSGI, SSR, light/reflection probes, light baking, GTAO) is from his three.js
branch `webgpu_preview_interior`. The lab runs two or three copies of it side by side. Each copy (a pane) has its
own SSR / SSGI denoisers and its own resolver, the final temporal stage. It is a tool for learning and debugging:
look at the paths and turn their knobs. Numbers come from the test bed, not from here.

```sh
yarn workspace three-temporal interior      # http://127.0.0.1:5270/interior-lab.html
```

## Dependencies

- **three.js** comes from a checkout of Ben's branch at `../three.js` next to this repo (`THREE_INTERIOR_REPO`
  overrides it). Its `examples/` folder is served as the public dir: models, textures, `example.css`, lil-gui.
- **`@pmndrs/upscaler`** resolves to the source of the upscaler repo at `../upscaler` (`UPSCALER_REPO` overrides it).
  This is the same code its `09-kitchen-sink` example runs.
- **The denoiser packages** resolve to their source.

## Files

- `interior-lab.html` + `src/interior-lab/shell.ts`: the page. It holds:
  - the panes and the CSS reveal
  - the one loop that drives every pane
  - camera sync
  - the lab panel, cards and experiments
- `interior-pane.html` + `src/interior-lab/pane.ts`: one pane. It builds the denoisers and the resolver its config
  names. Opened on its own, it runs Ben's preset.
- `src/interior-lab/interior.js`: Ben's example script, copied verbatim apart from the lines marked `LAB`. To pick
  up a newer version, copy the script again and re-apply those lines (`grep -n LAB`).
- `src/interior-lab/catalog.ts`: the text of the cards, the presets and the experiments.

## How it works

- **One iframe per pane.** Each pane is a full copy of the example: its own renderer, GPU device, histories,
  TRAA / FSR3, and SSR lighting feedback. Nothing one pane renders reaches another.
- **CSS reveal.** The iframes are stacked, and a clip-path reveals each pane's strip. Drag the grips to move the
  dividers.
- **One loop drives every pane.**
  - The leading pane runs its OrbitControls and renders. The leading pane is the one you last clicked or scrolled in.
  - The others copy its camera and render the same frame.
  - Auto orbit runs on the leading pane.
- **Resolver per pane:**
  - TRAA: Ben's, which jitters the camera.
  - FSR3: `upscale()` at ratio 1, which only anti-aliases. It applies its own jitter and keeps motion vectors
    jitter-free.
  - None: no jitter and no anti-aliasing.
- **Lab views** other than Beauty show the denoiser output before the resolver.
- **Inspect** shows one pane full screen, with its own three Inspector: Ben's settings, the render graph's textures,
  and Performance.
- **Linked settings.** With *link Ben's settings* on, a change made by hand in one pane's Inspector is applied to
  the other panes.
- **Keys:**
  - S: side by side
  - F: next pane alone
  - 1 / 2 / 3: that pane alone
  - I: inspect
  - O: auto orbit
  - 0: reset histories
  - `window.__lab` is there for scripts.

## Paths

| SSR / SSGI denoiser | notes |
|---|---|
| Off / Raw | baselines: fallback only / the unfiltered signal |
| three `DenoiseNode` (spatial) | the upscaler 09 recipe: no history; FSR3 does the accumulating |
| Ben: `CoverageDenoiseNode` | radiance + coverage, fallback after; knobs live |
| three r186 (TemporalReproject + Recurrent) | SSR only; Ben's "Before filtering" chain |
| Ours: FFX Reflections / SVGF / recurrent | via `denoiser/three`. Contract is either "resolve before" (fallback mixed in, one signal) or "coverage twin" (SSR · coverage and coverage denoised separately, divided, fallback after) |

## Caveats

- **Cost.** Every visible pane renders the whole example. Three panes cost three frames, and loading bakes the scene
  once per pane.
- **Private fields.** `rebuildOurs()` in pane.ts reaches into `TemporalDenoiseNode` (`create`, `_denoiser`), because
  the node has no public way to swap its denoiser.
- **Card timings.** The GPU ms on a card covers our passes only. Everything else is in the pane's Inspector ▸
  Performance.
