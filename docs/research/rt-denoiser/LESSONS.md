# Lessons: things not to rediscover

_Append-only log shared by every agent on this project. Before you start, read it. Before
you finish, add what cost you time: a gotcha, a wrong assumption, a command that works.
One bullet each, newest at the bottom of its section, with your agent name and date.
Append with a small Edit or `cat >> LESSONS.md`; don't rewrite others' entries._

## Environment and tooling

- `yarn install` at the worktree root is needed once per fresh worktree (no `node_modules`
  in a new worktree). Takes seconds. — orchestrator, 2026-10-24
- There is no `timeout` command on macOS; use a tool timeout or a Node-side deadline
  instead. — orchestrator, 2026-10-24
- Headless Chrome WebGPU works: `examples/ffx-denoiser/run-headless.mjs` launches Chrome
  with `--headless=new --use-angle=metal --enable-unsafe-webgpu
  --enable-webgpu-developer-features`, polls `window.__ffx` over CDP until `ready`. A
  1080p 120-frame shadow eval takes about a minute. — orchestrator, 2026-10-24
- Start a dev server in the background (`yarn workspace <name> dev > log 2>&1 &`), give
  it ~4 s, and kill it by port when done. — orchestrator, 2026-10-24
- The root `.gitignore` ignores `*.js` (and `*.d.ts`): scripts outside `examples/*/src/vendor`
  must be `.mjs` / `.ts` or they silently never get committed. — capture-io, 2026-10-25
- `tools/*` is not a yarn workspace. Run Vite there with
  `node node_modules/vite/bin/vite.js tools/rt-capture --port 5230 ...` (it picks up
  `tools/rt-capture/vite.config.ts`) and import packages by relative path to their `src/`
  (no dist needed; type-only `@pmndrs/denoiser-core` imports are erased). — capture-io, 2026-10-25
- zsh doesn't word-split `$VAR`: `P="a b"; git add $P` adds one path named "a b". Use an
  array, `P=(a b); git add $P`. — capture-io, 2026-10-25
- TASKS.md is one file in a shared worktree: another agent's `git commit -- TASKS.md`
  sweeps your uncommitted edits into their commit. Harmless, but check with
  `git show HEAD:docs/research/rt-denoiser/TASKS.md` instead of assuming yours is pending.
  — spec-author, 2026-10-25
- WebFetch of unrealengine.com blog posts returns 403. — spec-author, 2026-10-25

## WebGPU / WGSL

- Core WebGPU allows `read_write` storage textures only on r32 formats; histories are
  ping-pong textures (read via `texture_2d`, write via write-only storage). Default limit
  is 4 storage textures per stage. (PLAN §4.6) — orchestrator, 2026-10-24
- SVGF moments need `rg32float`; luminance² overflows fp16 on HDR input. — orchestrator,
  2026-10-24
- To fit 4 storage textures and the memory budget, SPEC §10.1 rotates 4 rgba16float
  buffers per signal through the recurrent passes (history, stabilization history and
  transients share them) and packs A_d/A_s/m into one `r32uint` that history fix updates
  in place (core allows read_write on r32uint). Mip levels go into an atlas inside a free
  rotation buffer. — spec-author, 2026-10-25

## Conventions

- Motion is an NDC delta, current − previous, +y up (three's `velocity`); row 0 of capture
  buffers is the image top. Mind the y flip when converting NDC ↔ texel. — orchestrator,
  2026-10-24
- viewZ is three.js view space: in front of the camera is **negative**. — orchestrator,
  2026-10-24
- Roughness in our captures/API is perceptual r; GGX α = r². — orchestrator, 2026-10-24
- Jitter (CAPTURE-FORMAT): pixel (px,py)'s ray goes through `(px+0.5+jx, py+0.5+jy)`,
  pixels x right / y down. History texel k holds the sample at `k+0.5+prevJitter`;
  `FrameCamera` has no previous jitter, so a denoiser that cares must remember it.
  — capture-io, 2026-10-25
- `tools/rt-capture/validate.mjs` catches convention slips both ways: a y-flipped or
  sign-flipped motion gives ~10–40 px reprojection error and ~6 % history consistency;
  positive viewz fails outright; stale `prevView` passes the motion check (motion was
  computed from the same stale matrix) but fails camera continuity and history
  consistency. Run it on every new capture. — capture-io, 2026-10-25
- Capture `motion` includes the current jitter (`ndc_sample − ndc_prev`), so
  `uv_prev = (p + 0.5 + jitter)/size + (−0.5·m.x, +0.5·m.y)`, and positions are rebuilt from
  the jittered sample NDC with the unjittered matrices (SPEC C-1, C-6). — spec-author, 2026-10-25

## Denoiser design

- History validity: a per-tap *relative view-z* test (|z_tap − z_expected| < 1 %) rejects
  valid history at grazing angles, where z changes by > 1 % per pixel; it cost the
  reference accumulator ~5 dB at 8 frames on a ground plane. The plane-distance test
  `|n · (P_tap − P)| < 1 % · |viewZ|` (RTG II ch. 49 §49.6) keeps it. — capture-io, 2026-10-25
- Bilinear reprojection low-passes noise: a reprojected running mean on a moving camera
  scores *above* the static-camera value (synthetic plane, 8 frames, diffuse: 31.7 vs
  26.5 dB). Not a bug; the static-camera capture is the one that must match σ²/n theory
  (it does: 32.70 dB measured vs 32.76 predicted at 32 frames). — capture-io, 2026-10-25
- Take recurrent-pipeline formulas from SPEC.md, not from `sources/reblur.md` §4.2: that
  note transcribes RTG II ch. 49 listing formulas (A_spec, virtual confidence, kernel skew),
  which SPEC deliberately replaces with its own designs (listing policy, SPEC header).
  — spec-author, 2026-10-25
- A pre-blur's spatial bias is permanent in a recurrent filter (the converged output is
  the mean of pre-blurred frames), so SPEC clamps the pre-blur radius by last frame's
  denoised hit distance. Watch contact GI/reflections when tuning D1. — spec-author, 2026-10-25

## Clean room

- Using native NRD as a black box (feed our captures, compare outputs) is allowed; reading
  its code or README prose is not. NRD's interface facts (e.g. 2.5D motion,
  z = viewZprev − viewZ, is its recommended mode) are in `sources/nrd-provenance.md` §3
  and are fine to use. — orchestrator, 2026-10-24
