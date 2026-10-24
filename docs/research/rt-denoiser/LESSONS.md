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

## WebGPU / WGSL

- Core WebGPU allows `read_write` storage textures only on r32 formats; histories are
  ping-pong textures (read via `texture_2d`, write via write-only storage). Default limit
  is 4 storage textures per stage. (PLAN §4.6) — orchestrator, 2026-10-24
- SVGF moments need `rg32float`; luminance² overflows fp16 on HDR input. — orchestrator,
  2026-10-24

## Conventions

- Motion is an NDC delta, current − previous, +y up (three's `velocity`); row 0 of capture
  buffers is the image top. Mind the y flip when converting NDC ↔ texel. — orchestrator,
  2026-10-24
- viewZ is three.js view space: in front of the camera is **negative**. — orchestrator,
  2026-10-24
- Roughness in our captures/API is perceptual r; GGX α = r². — orchestrator, 2026-10-24

## Denoiser design

## Clean room

- Using native NRD as a black box (feed our captures, compare outputs) is allowed; reading
  its code or README prose is not. NRD's interface facts (e.g. 2.5D motion,
  z = viewZprev − viewZ, is its recommended mode) are in `sources/nrd-provenance.md` §3
  and are fine to use. — orchestrator, 2026-10-24
