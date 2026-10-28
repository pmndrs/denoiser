# Denoiser workbench: SSR + SSGI + probes + FSR3

`workbench.html` puts every denoiser we have, except OIDN, side by side in one scene setup:
- **SSR:** three's stochastic SSR, with the reflection probe filling in where it misses (as on reflections-rooms).
- **SSGI:** three's SSGI.
- **Resolver:** the upscaler's temporal path (`upscale(..., { path: 'temporal' })`, FSR2/3-style), as in its
  examples 09 / 10. The workbench imports it as `upscaler-src`: the upscaler repo's source at `../upscaler`
  (`$UPSCALER_REPO`), ahead of the published 0.5.0, falling back to the installed package (`vite.config.ts`).

None of Ben Houston's interior example code is used. His Space Ship Hallway model (an upstream three.js asset) is
one of the scenes.

## Ben's PR #35228 nodes

The latest head of his PR is vendored in `src/workbench/ben/` (README there: commit, files, the two local changes).
His nodes are pane options next to ours:
- **Tracer:** his `SSRNode`, with FAST blue noise and Hi-Z. It outputs radiance + coverage + hit distance, and the
  probe fills 1 − coverage.
- **Denoiser:** his `CoverageDenoiseNode`, for SSR, SSGI and AO.
- **Resolver:** his `TRAANode`.

The preset "Ben PR #35228: his SSR + coverage denoise + TRAA" is his pipeline.

Not vendored:
- His previous-frame trace source (`ReprojectedRadianceNode`) and his half-resolution guides + upsampling. Both need
  the PR's core `PassNode` / `VelocityNode` changes.
- So his tracer and denoiser run at the pane's render resolution and trace this frame's lit colour.

Option "Ben tracer traversal":
- His default, adaptive Hi-Z, leaves vertical streaks and black holes in the mirror reflections on his own scene.
- Conservative Hi-Z and linear marching don't.

```sh
yarn workspace three-temporal dev      # http://127.0.0.1:5220/workbench.html
```

The denoiser packages are used from their `dist/`, so run `yarn build:lib` first in a fresh worktree.

## Scenes

- **Two rooms (ours):** the scene from reflections-rooms. One probe per room plus one in the doorway, a mirror ball,
  and coloured point lights that drift through the hues.
- **Space Ship Hallway:** lit by `pedestrian_overpass_1k.hdr` through its windows and by its emissive strips. Probes
  are placed in a row along the corridor.
- **Ben's SSR example (steampunk camera):** his `webgpu_postprocessing_ssr.html` scene. The model and floor are at
  roughness 0 (sliders under Scene materials). RoomEnvironment is the only light and fills the probes' environment
  slot. SSR distance is 5, thickness 0.03, cutoff 0.8, and SSGI starts off.
- **Ben's branch models:** listed only when a local three.js checkout has them.

Assets are served from a local checkout (`threeExamples()` in `vite.config.ts`, `$THREE_EXAMPLES` or
`../three.js/examples`). Otherwise they come from the r186 tag on GitHub, which only has the upstream ones.

## Panes

Up to three panes. Each pane is a full frame graph (`src/workbench/pane.ts`):

- **Rendering:** one WebGPURenderer draws each pane into its own canvas through three's `CanvasTarget`.
- **Shared between panes:** the device, the scene, the probes and the shadow maps.
- **Per pane:** the camera copy, the G-buffer, SSR, SSGI, every history, and FSR3.
- **Velocity:** each pane has its own node (`velocity.ts`). three's global `velocity` keeps one "previous matrix"
  per object, and the second pane to draw in a frame would see no object motion.

Per-pane options:

| Option | Choices |
|---|---|
| SSR tracer | three r186 SSRNode · Ben's SSRNode (traversal: Hi-Z adaptive / conservative / linear) |
| SSR denoiser | raw · three DenoiseNode (spatial) · FFX reflections · realtime SVGF · realtime recurrent · realtime joint diffuse + specular (SVGF / recurrent) · Ben's CoverageDenoiseNode |
| SSGI denoiser | raw · three DenoiseNode · realtime SVGF · realtime recurrent · Ben's CoverageDenoiseNode |
| SSGI AO denoiser | raw · three DenoiseNode · realtime SVGF · Ben's CoverageDenoiseNode |
| Resolver | FSR3 (ratio 1 / 1.5 / 2, jitter on / off) · Ben's TRAA · none |
| Denoisers see the jitter | `TemporalDenoiseNode` `ignoreViewOffset`. On (the default): reproject without the FSR3 jitter. Off: the #10 setup. |
| SSGI pattern | rotating or static (three's `useTemporalFiltering`) |
| SSR misses pass hit distance 0 | Probe / environment fills reach the denoisers as hit distance 0 (denoiser-realtime's miss) instead of 100. Ben's tracer: a miss below coverage 0.5. The recurrent `dropoutGuard` needs it (ticking the guard ticks this). |
| recurrent: SSR dropout guard | The recurrent specular filter's opt-in `dropoutGuard` (experimental, `results/DROPOUT-GUARD.md` on the cleanroom branch). |
| FSR3 | RCAS denoise, debug views |

Views: beauty (resolved), and the denoised specular / GI / AO or their noisy inputs before the resolver.

Keys:
- 1 / 2 / 3: one pane alone
- F: next pane
- S: side by side
- O: auto orbit
- 0: reset histories

`window.__wb` is there for scripts.
