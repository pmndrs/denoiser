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
- `examples/realtime-denoiser` evaluates several (signal, denoiser) pairs in ONE page
  (`signal=all&denoiser=a,b`): the expensive references are rendered once per frame and
  shared. A 1080p 96-frame path with all three signals and 256-spp references takes
  ~80 s, ~60 s of it CPU FLIP; the 960x540 default preset ~25 s. `flip=0` for speed.
  — testbed, 2026-10-25
- Bench one denoiser per page load: in a page that benches several denoisers in a row,
  FFX shadows read 1.2 ms instead of 0.51 ms (alone). Eval-mode `gpuMs` (GPU kept busy
  by the references) agree with the solo bench. — testbed, 2026-10-25
- Vite serves `src/` live: every headless run of a batch loads the current files, so
  don't edit shaders while a `run-headless.mjs` batch is running (later runs would test
  the edit). Use `--json=out.json` and summarize afterwards. — svgf, 2026-10-25
- `URLSearchParams.get` returns the FIRST occurrence: appending `&path=pan` to a query
  that already has `path=orbit` silently keeps `orbit`. — svgf, 2026-10-25
- `run-headless.mjs` occasionally returns without results on one run of a batch (page
  not attached yet); a rerun of that query works. Check the result count. — svgf, 2026-10-25
- Other projects on this Mac run Vite servers too (e.g. `Denoiser-oidn-compare` holds
  `[::1]:5240`). Bind and browse `127.0.0.1` explicitly (`--host 127.0.0.1 --strictPort`), and
  check `lsof -nP -iTCP -sTCP:LISTEN | grep 52` before blaming your code for a stale page.
  — orchestrator, 2026-10-25
- Replay timings need a warm GPU: the replay idles the GPU between frames (fetch, upload,
  readback) and Apple's GPU clocks down, so timestamps read 4–9× the live test bed's
  (svgf-diffuse 2.11 vs 0.49 ms at 960×540). `replay()` now runs 50 ms of throwaway compute
  before each timed dispatch (`&warm=`); 20 ms was enough at 960×540 but not at 1080p.
  The live eval's timings are kept busy by reference rendering but read high at 1080p;
  use the solo bench or a warmed replay for costs. — wiring, 2026-10-25
- Headless Chrome without a fixed port: `--remote-debugging-port=0` and read the port from
  `<user-data-dir>/DevToolsActivePort` (no random-port collisions between parallel runs).
  `tools/rt-capture/lib/headless.mjs` does it, plus Chrome discovery per platform and
  `--serve` (starts Vite as `node <vite>/bin/vite.js <root>`, no shell). — wiring, 2026-10-25
- The test bed now writes and replays captures itself: `run-headless.mjs --serve --set=standard`
  (10.6 GB in ~45 s on the M5 Pro, validated) and `--set=<set> --replay=<ids>` (replays +
  compare.mjs). Live and replay give the same PSNR to 0.001 dB, so a capture can stand in
  for the live test bed in any comparison. — wiring, 2026-10-25
- To run a registry entry in the test bed before it is registered (without editing
  `tools/rt-capture` or `examples/realtime-denoiser`): a scratch `registry-wrap.ts` that
  `export *`s the registry by absolute path and calls `registerDenoiser()` for the new ids,
  plus a scratch Vite config that `mergeConfig`s the test bed's config with `root` set and
  an alias `/^(\.\.\/)+tools\/rt-capture\/src\/denoisers$/` → the wrapper. A config file
  outside the repo can't resolve the bare `vite` import; import
  `<repo>/node_modules/vite/dist/node/index.js` by absolute path. — recurrent, 2026-10-25
- Results runs while another agent edits `packages/denoiser-realtime`: Vite serves its
  `src/` live, so pin it: `git archive HEAD packages/denoiser-realtime/src packages/denoiser-core/src | tar -x -C <dir>`
  and start the test bed with `RT_REALTIME_SRC=<dir>/packages/denoiser-realtime/src`
  (alias in its vite.config.ts). Check with `curl .../@fs/<repo>/tools/rt-capture/src/denoisers.ts | grep realtime`.
  — results, 2026-10-25
- Several of your own 1080p evals can run in parallel for *quality* numbers (CPU FLIP is
  most of the time; results are deterministic), ~2–5 min per path with 3 jobs; never for
  timings. A bench loop that waits on `pgrep -f dev/run-headless` before each page gives
  quiet timings while other agents work. — results, 2026-10-25

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
- One WGSL module with many entry points + `layout: 'auto'` binds only what each entry
  statically uses, so the test bed keeps every CAPTURE-FORMAT buffer in one module and
  splits writers per entry (`guides` 6, `material` 2, `signals` 6 storage textures) under
  the 8 storage textures it requests. Long reference dispatches are chunked (32 spp per
  submit, sums in a storage buffer) so no single command buffer runs for seconds.
  — testbed, 2026-10-25
- The default limit of 4 storage textures per stage bites test scenes too: a G-buffer +
  signals + refs pass (10 outputs) has to be split. The dev page generates the same WGSL
  3× with per-part `textureStore` stubs (`packages/denoiser-realtime/dev/scene.ts`). — svgf, 2026-10-25
- À-trous at 3×3 taps is ALU-bound as much as bandwidth-bound on the M5 Pro: a per-tap
  `acos`/`atan` (lobe-angle normal weight) cost +35 % per iteration. Compute per-center
  constants once and compare in cosine space (sqrt((1−cos)/(1−cos θ0)) ≈ θ/θ0). — svgf, 2026-10-25
- One thread per 3×3 stratum doing 9 reprojections is 2.5× slower than one thread per
  pixel in a 9×9 workgroup with a shared-memory reduction (1.05 → 0.43 ms at 1080p). — svgf, 2026-10-25
- Packing geometry for taps: an rg32uint (f32 depth + 12/12-bit oct normal + 8-bit
  roughness) plus a separate r32uint depth slope read only at the center beat one
  rgba32uint per tap (−25 % à-trous time). SPEC C-5 chose the same tap layout. — svgf, 2026-10-25
- Store the standard deviation, not the variance, in an rgba16float alpha (SPEC S-2a);
  when converting, every `var` use must become `σ*σ` — a missed one in the inner-tap loop
  cost 1.2 dB and looked like a depth-weight regression. — svgf, 2026-10-25
- Unroll small tap loops at codegen time instead of `var taps: array<vec4f, 9>` indexed
  by a loop variable: on the M5 Pro (Tint → Metal) the array version was ~35 % slower
  per à-trous iteration (0.38 → 0.28 ms at 1080p, same output). TS template strings make
  full unrolling trivial. — svgf, 2026-10-25
- Generate WGSL binding declarations and the bind-group-layout entries from one list
  (`packages/denoiser-realtime/src/shaders/bindings.ts`) and bind by name: with 1- or
  2-signal variants of every pass, hand-numbered bindings drift immediately. — svgf, 2026-10-25
- Recurrent skeleton (7 passes + prepass, trivial kernels with the real bindings and
  SPEC §10.1 formats/rotation) at 1080p on the M5 Pro: **1.03 ms** diffuse + specular,
  0.87 ms diffuse only (prepass 0.18 of it). Dispatch + centre I/O is a quarter of the
  4 ms budget, so the 8-dispatch structure stands. `shaders/recurrent.ts` `trivialPass`
  regenerates it from any pass's binding list (`skeleton: true`). — recurrent, 2026-10-25
- A screen-offset clamp tied to one radius parameter silently disables another pass:
  the recurrent kernel clamps tap offsets to 2·R_max, so a sweep with `blurRadius≈0`
  also collapsed the pre-blur onto the centre pixel (identical numbers with and without
  pre-blur). Clamp to 2·max(R_max, R_pre). — recurrent, 2026-10-25

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
- An infinite ground plane hits beyond the far plane near the horizon: the test bed wrote
  depth > 1 with normals there (validate.mjs: depth range warnings, "sky" normals non-zero).
  The guides now mark such pixels as sky (depth 1, viewz −far, normal 0). — wiring, 2026-10-25
- The denoiser registry is `tools/rt-capture/src/denoisers.ts` only; the test bed maps its
  signal names (`visibility` ↔ `shadows`) and filters its own URL keys before passing the
  rest as `settings`. The test bed's old `accumulate` is now `accumulate-32`; `accumulate`
  is the replay's unbounded reference mean. — wiring, 2026-10-25

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
- Test-bed numbers to keep in mind: the noisy input's *tonemapped* bias is negative
  (−0.06 diffuse, −0.07 specular) only because x/(1+x) is concave; use the linear
  `energy` ratio for energy loss. FFX reflections on our demodulated specular loses ~28 %
  energy (its luminance-weighted firefly suppression), far more than the −0.04 tonemapped
  bias seen in `examples/ffx-denoiser`. FFX shadows writes 0 on sky pixels (not scored).
  — testbed, 2026-10-25
- FLIP's viewing condition decides what "noise" is: at FLIP's standard 67 ppd a 960x540
  frame is ~14° wide and 1-px binary shadow dither scores *better* than FFX's smooth
  result. The test bed scales ppd with resolution (image spans 46.4°, ~41 ppd at 1080p;
  `&ppd=67` restores the standard). — testbed, 2026-10-25
- Test-bed ground-truth disocclusion (history age) uses a slope-aware depth test:
  1 % |z| + 2 × the robust one-sided z slope per pixel (`metrics.ts` `depthTol`); a
  best-of-4-taps 2 % relative test gave the same counts on our scene, so best-of-4 also
  avoids most grazing-angle false rejections. In the slow orbit ~8 % of receivers have
  < 8 frames of valid history, real ones: behind the fence slats and at the screen edge
  (see `mode=eval&show=age`). — testbed, 2026-10-25
- SVGF's feedback (à-trous iteration 0 as color history) compounds spatial blur over
  frames: with a static camera PSNR *falls* over time, more so with lower α (α = 0.05:
  39.6 → 34.6 dB in 30 frames). At 1080p on the dev scene `feedback: false` is +1.1 dB
  with ~4 % more flicker. Defaults keep the paper's `true` (brief); see Questions for
  Dennis. — svgf, 2026-10-25
- SVGF luminance weight with the paper's per-sample variance is right for PSNR at 1 spp:
  using the variance of the accumulated mean (sharper edges) left more noise and lost
  0.7–2 dB. At relative noise σ ≈ 1 SVGF visibly softens hard shadow edges; that's the
  method, not a bug. — svgf, 2026-10-25
- A-SVGF with renderer gradients only fires on the frame where shading changes; an
  "auto" gradient against the reprojected accumulated history keeps firing until history
  catches up and recovered ~2× faster after a light switch on the dev scene. — svgf, 2026-10-25
- Synthetic scenes: geometry beyond the far plane is "sky" to the denoiser; mark it sky
  in the ground truth too, or the metric scores unfiltered pixels. — svgf, 2026-10-25

## Native harness (from `native/SETUP.md`, Windows harness builder, 2026-10-25)

_Facts about driving native NRD as a black box: interface and build behavior only._

- Native `REFERENCE` doesn't reproject. On a moving camera it returns the noisy frame unchanged;
  with prev matrices := current it is a plain per-pixel screen-space mean. Use it as a sanity
  check on static-camera captures only (`synthetic-static`: 26.53 / 21.51 / 23.63 dB, matches
  ours). Our `accumulate-static` differs from that mean only where a pixel was sky last frame
  (ours restarts history there). — orchestrator, 2026-10-25
- `NRD_NORMAL_ENCODING=4` (RGBA16_SNORM) doesn't build at `e06852b`; encoding 2 with
  `NRD_ROUGHNESS_ENCODING=1` (linear) does, and is what the harness uses. — harness builder
- One `Denoise` call per `nrd::Integration` per frame. Several calls on one instance overran its
  per-frame descriptor pool: a crash with REFERENCE alone, and silent corruption of ~7 % of pixels
  with all denoisers, which looked like a weighting bug. — harness builder
- The first-frame format check reads the normal/roughness guide even for `REFERENCE`; always
  bind the guides. — harness builder
- Hit distance 0 means "lobe not sampled" to NRD, so the harness maps our 0 (miss) to 65504.
  Our own 0 still means both miss and not-sampled (TASKS item). — harness builder
- Shadows: the native shadow denoiser takes distance to occluder, not visibility. The harness maps
  visibility ≥ 0.5 → miss (65504), 0 with `occluder_dist` > 0 → that distance, 0 with
  `occluder_dist` 0 (self-shadowed) → 0. Fractional input visibility is lost on that side.
  — harness builder
- Jitter is passed in pixels; units are only provisionally confirmed (a smooth plane can't tell).
  Re-check on a test-bed capture with edges. — harness builder
- Native timings on the RTX 3060 Laptop drift with clocks (wide p90) because the harness idles
  between frames while loading the next one, the same effect our replay fixes with a 50 ms GPU
  warm-up. Compare medians from the same machine only. — orchestrator, 2026-10-25
- The test bed's scene uniform has no spare slot where it looks like one: `u[86]` is
  `seedOffset`, the old `_pad0` is `u[87]`. Writing the sampler flag into `u[86]` silently
  changed the white-noise seed instead (two "different" samplers gave identical stats).
  When a new mode changes nothing, check the uniform offsets first. — results, 2026-10-25
- Spatiotemporal blue noise for 2-D (or n-D) samples: animate with the R_n sequence
  (Roberts 2018), not the golden ratio on every dimension; equal per-dimension steps put a
  pixel's samples over time on a line. Blue noise lifts temporal accumulation (+1.35 dB
  diffuse mean, +4.5 dB on a static camera) but leaves SVGF's PSNR unchanged (−12 %
  flicker): wide à-trous footprints average past the mask's correlation length.
  — results, 2026-10-25
- SVGF on the test bed (M1.md §4): `feedback: false` is +0.6…+2.6 dB diffuse with no
  flicker cost; under `antiLag: 'auto'` α_min ≤ 0.1 is inert (λ keeps 1/n ≥ ~0.1), so
  sweep α only with anti-lag off; plain SVGF with low α_min ghosts specular (orbit
  −2.8 dB at 0.1). — results, 2026-10-25

## Clean room

- Using native NRD as a black box (feed our captures, compare outputs) is allowed; reading
  its code or README prose is not. NRD's interface facts (e.g. 2.5D motion,
  z = viewZprev − viewZ, is its recommended mode) are in `sources/nrd-provenance.md` §3
  and are fine to use. — orchestrator, 2026-10-24
