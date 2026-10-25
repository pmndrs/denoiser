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

- zsh: `paths=(${@:-a b c})` is ONE element "a b c" (and an unknown `path=` silently falls
  back to `orbit` in the test bed, so a sweep "over 3 paths" measured orbit three times).
  Use `if (( $# )); then paths=($@); else paths=(a b c); fi`. — shadows, 2026-10-25
- The M5 Pro runs solo benches in two GPU clock states (every pass ×1.3–1.8 in the slow one,
  FFX too, run to run): a tiny fixed-cost pass is a clock indicator (shadows `tiles` reads
  0.005 ms fast, 0.007–0.009 slow). Alternate denoisers over several runs and report the
  fastest run plus the median. — shadows, 2026-10-25
- The scratchpad folder can be shared with other sessions' files; work in your own subfolder.
  — shadows, 2026-10-25

- A full-resolution look at a test-bed frame: the view-mode panels are ≤ 640 px canvases.
  Replay a standard capture with `mode=replay&capture=std540-orbit&denoiser=<id>&output=<name>&<settings>`
  (seconds) and crop with `crops.mjs crop ... --cols <name>,svgf-auto,ref --err 6`; `compare.mjs`
  on the same outputs gives numbers. `output=` keeps several configs of one id apart. — recurrent-spec, 2026-10-25
- WGSL compile errors of generated passes: `device.createShaderModule(...).getCompilationInfo()`
  in a headless page on the test-bed origin, importing the pass generators by `/@fs/<abs path>`
  (a 30-line script; much faster than reading "Invalid ShaderModule" from a run). — recurrent-spec, 2026-10-25

- Port 5300 (the M5 brief's) is held by an unrelated project's Vite server (`upscaler`, since
  Oct 19); the occlusion runs used 5310 (pinned) / 5311 (live). `lsof -nP -iTCP -sTCP:LISTEN` first. — occlusion, 2026-10-25
- "Bit-identical" for a shader-generator change can be checked without a GPU: bundle the
  generator with rolldown (`node_modules/rolldown`, `rolldown({ input, platform: 'node' })`),
  dump every pass's WGSL for the old and new code over the configurations, and `diff`; then one
  short eval on two `git archive` snapshots comparing `perFrame` arrays. — occlusion, 2026-10-25

- A comment containing backticks inside a WGSL template literal (`` /* wgsl */ `...` ``) ends the
  template: the TS module fails to transform, Vite logs a PARSE_ERROR, and every headless page
  just hangs until its timeout. After editing a shader generator, `curl` the served module or
  run `tsc --noEmit` before starting a batch. — shadows, 2026-10-25
- Idle orphaned headless Chromes (0 % CPU) and hung `run-headless` pages of other agents look
  "busy" to a `pgrep`-based quiet-GPU wait, which then never starts. Count a job as busy only if
  its process tree uses CPU (`ps -o pid=,ppid=,pcpu=` and sum the subtree). In a bench round,
  the first page tends to land in the slow clock state (shadows `tiles` 0.007 instead of
  0.005 ms): lead every round with a throwaway warm-up page. — shadows, 2026-10-25
- Killed headless runs leave orphaned Chromes (parent pid 1, idle). They stall quiet-GPU checks
  and eat memory. Sweep only orphans with our temp profiles: `ps -axo pid,ppid,command | awk '$2==1
  && /Google Chrome/ && /--headless/ && /user-data-dir=.*rt-headless/ && !/Helper/ {print $1}' | xargs kill`.
  Never kill a Chrome whose parent is alive (another agent's run) or Dennis's own Chrome.
  — orchestrator, 2026-10-25

- The test bed builds one registry instance per (signal, id) with `signals: [that signal]`, so `mode=bench`
  times a joint entry (`svgf`, `recurrent`, `occlusion-*`) as ONE signal's per-signal instance. To time
  `dispatchBoth`, a scratch wrapper registers `j-<id>` = the entry's `create` called with
  `signals: ['diffuse', 'specular']` (or `['ao', 'so']`), registered for one signal; the same trick
  (`settings` overridden in `create`) puts option variants of one id, e.g. `sh.uniformSnap`, in one page
  so they share references. — remeasure, 2026-10-25
- Short bench pages are clock-state lotteries: single-signal occlusion pages (1.2–2 ms) spread ±20 % in
  their run medians over 9 alternating rounds, and 600-frame pages landed in the slow state *more* often
  than 200-frame ones. The 4–5 ms joint pages were stable (5 of 9 runs within 0.03 ms). Report the
  fastest frame for short passes, or time them inside a longer joint dispatch. — remeasure, 2026-10-25

- three.js pages + `denoiser/three` from source: `examples/three-temporal` imports `denoiser/three` from
  `packages/denoiser/dist` (needs `yarn build:lib` per change). For iteration, a scratch Vite config that
  `mergeConfig`s `examples/three-temporal/vite.config.ts` and aliases `denoiser/three` →
  `packages/denoiser/src/three.ts` plus every `@pmndrs/denoiser-*` → its `src/index.ts` serves everything
  live (`server.hmr: false`); `RT_REALTIME_SRC` pinning works the same way. — m6, 2026-10-25
- A three.js node that isn't reachable from `pipeline.outputNode` doesn't run (its `updateBefore` never
  fires): a page that switches views must keep every denoiser it measures in the graph during metrics
  (`col.add(x.r.mul(0))` is enough), or readbacks silently return a stale frame (AO "converged" at frame 1
  in realtime-gi before that fix). — m6, 2026-10-25
- Headless pages that read several full-res RGBA float32 buffers back and run CPU FLIP on them at 1080p can
  run the tab out of memory; the CDP call then never returns (no error, idle Chrome). Keep single-channel
  copies, and give every CDP step its own deadline that does not itself wait on the page
  (`run-realtime.mjs` `--stepTimeout`). — m6, 2026-10-25
- wgslTagFn (three-mesh-bvh) defines ONE function per tag; helpers go in their own `wgslTagFn` and are
  interpolated by reference (`${helper}(args)` emits the name and includes the code). Pasting a WGSL string
  with several `fn`s inside another function body nests them (invalid WGSL). — m6, 2026-10-25
- Real-scene captures from a three.js page: freeze the pose, render the 1-ray signals once, then accumulate
  the references while holding it (`realtime-gi.html?path=orbit&ref=1`, `__t.capturePath`). Compute `motion` /
  `motion_z` in TSL from depth and the previous *path* pose's matrices (uniforms), not with three's `velocity`:
  the reference frames in between would make it 0. Read signals from float32 RTTs
  (`convertToTexture(node, null, null, { type: FloatType })`), and give every reference its own seed uniform
  (frame counter): the blue-noise index stays at the path frame during the hold, so reusing it repeats one
  sample. validate.mjs then passes first try (motion < 0.001 px). — real-scene-motion, 2026-10-25
- Node 22.22 imports `.ts` files directly (type stripping, an ExperimentalWarning): Node scripts can reuse the
  test bed's `src/flip.ts` without a build (`examples/three-temporal/score-captures.mjs`). — real-scene-motion, 2026-10-25

- The three-temporal realtime pages' `__t.metrics({ frames, checkpoints: [1, 2, …] })` gives per-frame curves after a
  reset without editing the page; its `errImages` (signed error ×4, 8-bit, plus the reference) can be decoded back in the
  page (Image → canvas → getImageData) to split the error by reference class. Two `three-temporal` dev servers with
  different `RT_REALTIME_SRC` snapshots (scratch config, `hmr: false`) give before/after on the same page; files in a
  snapshot outside the Vite root are still served fresh after an edit (no restart). — shadows-reset, 2026-10-25

- Claude Code's safety check refuses some zsh expansions in a long command (`${(s:,:)V}` inside a pipeline
  was flagged as "can't be checked for rm"); pass comma lists to scripts as one argument and split them
  in the script instead. Probe pages that switch the realtime-shadows view to `ours`/`ffx` mid-session
  hung once; the split view (`view: 'split'`) captures both sides in one page. — moving-shadows, 2026-10-25

- User-facing docs are the MDX pages in `docs/site/` (frontmatter `title` / `description` / `nav`; the sidebar sorts
  by `nav` numerically, so 27.5 slots a page between 27 and 28 without renumbering). They are built only in CI by the
  pmndrs docs Docker image (`.github/workflows/pages.yml`); `tools/build-site.mjs` builds the demo site, not the docs.
  Without Docker, compile-check a page with `@mdx-js/mdx` 3 + `remark-gfm` + `remark-frontmatter` installed in the
  scratchpad. A bare `{` or `<` in prose breaks MDX: keep them in code spans. Snippets: a scratch `.ts` in
  `examples/three-temporal/src/` plus a tsconfig extending that example's (`include` the scratch file) type-checks
  against `denoiser/realtime` and `denoiser/three` through the built dist, so check that dist is newer than the last
  src commit first. — m6-docs, 2026-10-25
- "Output unchanged" checks while other agents edit the package: copy `packages/denoiser-realtime/src` to the
  scratchpad (A), copy A again with only your edited file swapped in (B), serve the replay page with
  `RT_REALTIME_SRC=<A or B> RT_NO_HMR=1` on a spare port (`BASE=http://127.0.0.1:<port>/` for `run-headless.mjs`),
  run the same query with `&output=<name>` on each and `diff -rq -x run.json -x timings.csv`. Their WIP is in both
  snapshots, so only your change can differ. Small GPU checks need no page: put a `.ts` module in the snapshot dir
  (Vite's `fs.allow` includes it) and `cdp.evalJs("import('/@fs<dir>/check.ts').then(m => m.check())", true)` from
  `lib/headless.mjs`'s `openPage`. Snippet type checks also work from the scratchpad: symlink the repo's
  `node_modules` next to the scratch `.ts` (tsconfig `paths` does not apply package `exports` subpaths like
  `denoiser/three`). — api-fixes, 2026-10-25
- TS overloads keyed on an option literal (`realtimeOcclusion`'s `denoiser.signal`): add a last overload with the
  plain option type and a union return, or a caller holding a non-literal `signal` stops compiling. — api-fixes, 2026-10-25

- Another agent's Vite server may serve the test bed's `src/` from the worktree (E-1 did, with only the registry
  pinned): editing scene / main / metrics there changes their next page load, and a half-done multi-file edit
  hangs it. Develop in a scratch mirror instead: `git archive HEAD examples/realtime-denoiser examples/_shared
  tools/rt-capture packages/denoiser-{core,ffx,realtime} package.json | tar -x -C <mirror>`, symlink the repo's
  `node_modules` into it, serve it on your own port with `RT_CAPTURE_DIR=<repo>/tools/rt-capture` (captures land in
  the shared place), and copy the finished files back to commit. Mirror captures record generator commit `?`
  (no git there): write the captures you keep from a worktree server. — testbed-v1, 2026-10-25
- Python `str.replace` scripts that insert TS: a `'\n'` inside a non-raw Python string becomes a real newline,
  so `${B ? '  ng: vec3f,\n' : ''}` turns into an unterminated TS string (tsc: "Unterminated string literal").
  Use backtick templates for multi-line inserts, and run `tsc -p examples/realtime-denoiser` before any page.
  — testbed-v1, 2026-10-25
- Node 22 imports `.ts` directly, but not extensionless relative imports: to dump a module's generated WGSL,
  copy it to scratch with `from './x'` rewritten to `from './x.ts'` and `import()` both old and new versions
  (diff of the standard build vs the original module = the bit-identity proof before any GPU run).
  — testbed-v1, 2026-10-25

- Test-bed floor-only pages (`&ref2spp=…`, E-1) need `&denoiser=` (empty): without it every registered denoiser
  runs on every signal; at 1080p with five signals the tab ran out of memory, Chrome's page died and the runner
  hung (or Node exited with "unsettled top-level await" when the websocket closed). Same symptom when a Chrome is
  killed externally. A page that is `ready` while its runner still waits can be read directly over CDP
  (`Runtime.evaluate JSON.stringify(window.__rt)` on the page's DevTools port). — e1, 2026-10-25
- Pinning only `packages/` + `tools/rt-capture/src` is not enough for a long batch: other agents commit to the test
  bed itself, and the worktree's new test bed imported a registry export the pinned snapshot lacked
  (`does not provide an export named 'V1_BUFFERS'`, pages hang at frame 0, only the Vite log says why). Snapshot
  `examples/realtime-denoiser` + `examples/_shared` too, symlink `node_modules` into the snapshot root, and point the
  scratch Vite config's `root` there. — e1, 2026-10-25
- A zsh waiter `while pgrep -f "<pattern>"` matches its own `zsh -c` command line when the pattern is in it, and never
  ends. Wait on a log line count or a PID instead. — e1, 2026-10-25
- One test-bed page failed once on frame 0 with "Binding size (32) … smaller than the minimum binding size (48)" on the
  score bind group (no code change; the same query passed on rerun). Rerun before debugging. — e1, 2026-10-25

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
- Neighbourhood / tap loads behind `if (geometry ok) { load value }` serialize two loads
  per tap (latency-bound on the M5 Pro). Clamp the coordinate, load both unconditionally,
  and zero the weight with `select`: same output, recurrent temporal 0.74 → 0.56 ms and
  blur 0.50 → 0.34 ms at 1080p. — recurrent, 2026-10-25
- Rarely executed code still costs: the recurrent history fix's mip-repair loop runs only
  where A < 3, yet compiling it in costs 0.24 ms of the pass's 0.51 ms (register pressure /
  occupancy); unrolling it branchless did not help. Measure by stubbing the call out. — recurrent, 2026-10-25
- Per-tap ALU of the recurrent kernels: plane distance from the centre's plane is linear in
  the tap pixel for a fixed tap depth (perspective dot(n, X_q) = z·(a0 + ax·qx + ay·qy)), and
  the kernel axes projected once give an affine screen Jacobian: same PSNR, ~0.1 ms per
  kernel pass less than full per-tap unproject / projection. — recurrent, 2026-10-25

- `active` is a reserved word in WGSL (Tint: "'active' is a reserved keyword"). — shadows, 2026-10-25
- r16float is not a core storage-texture format (needs a tier feature); scalar outputs that a
  later pass writes as storage go to r32float (or rgba16float). — shadows, 2026-10-25
- Workgroup tile stats for free: when the temporal pass's 8×8 workgroup is exactly a tile,
  `atomicMin` on the f32 bits of a non-negative value (bit order = value order) and
  `atomicOr` of flags in workgroup memory, written once by thread 0, replace a separate
  tile-classification pass; the indirect list then needs only a tiny per-tile pass
  (`enc.clearBuffer(args, 0, 4)` resets the count, y = z = 1 written once at configure). — shadows, 2026-10-25

- Workgroup-shared 10×10 tiles for 3×3 neighbourhoods (each texel loaded and decoded once
  per 8×8 workgroup, `loadTile()` before any early return) cut the recurrent history fix
  0.82 → 0.47 ms and temporal −0.2 ms for both signals at 1080p, with identical output. After
  that the "rarely executed" mip-repair code cost nothing any more (the earlier 0.24 ms was
  register pressure from the 8 decoded neighbours). — recurrent-spec, 2026-10-25
- A `for k in 0..4 { if (w <= 0) { continue; } load }` 2×2 history fetch is a branch per tap:
  unrolled with clamped coordinates and `select`-ed min/max it made stabilization 0.78 → 0.56 ms. — recurrent-spec, 2026-10-25
- Disabled-by-uniform code still costs: an optional luminance weight (k = 0 → weight 1) and an
  unused virtual stabilization candidate added +0.1 ms to each of blur / post-blur /
  stabilize. Remove dead ends instead of leaving them behind a flag. — recurrent-spec, 2026-10-25
- `shader-f16` kernel taps on the M5 Pro: f16 sums + weights −0.07 ms per 8-tap pass but
  −0.2 dB on HDR (direct-light) input; f16 weights with f32 sums were *slower* (conversions).
  Not worth it here. — recurrent-spec, 2026-10-25
- Kernel passes are tap-ALU bound: a 4-tap post-blur halved it (0.87 → 0.46 ms joint), the
  per-pixel kernel setup is minor. — recurrent-spec, 2026-10-25

- r32float is not filterable in core WebGPU: a scalar history in r32float (half the bytes of
  rgba16float) needs Catmull-Rom from 16 `textureLoad`s and a `'f'` (unfilterable) binding. The
  storage-format choice for one scalar is r32float (r16float / rg16float are not core storage
  formats). — occlusion, 2026-10-25

- WGSL workgroup variables are zero-initialized, so a tile max (or 1 − min) of non-negative floats can go straight into
  `atomicMax(&wg, bitcast<u32>(v))` with no init barrier. To skip work for a whole workgroup on a computed condition:
  thread 0 writes a plain `var<workgroup> u32` after a barrier, then `let c = workgroupUniformLoad(&flag) != 0u;` is
  uniform, so `if (c) { … } workgroupBarrier();` is legal. `dot4I8Packed` (`packed_4x8_integer_dot_product`, available
  in Chrome) was not faster than `dot(unpack4x8snorm(a), unpack4x8snorm(b))` on the M5 Pro. — shadows-reset, 2026-10-25

- **rgba16float storage writes truncate on this GPU** (Chrome → Metal, M5 Pro): `textureStore` of 1 + 0.9 ulp
  stores 1.0, while `pack2x16float` rounds to nearest (measured with a 64-texel probe). Every f16 storage
  write loses ~½ ulp on average, an EMA history compounds it (~1/α writes), and plain SVGF comes out
  ~0.1–0.16 dB darker/worse than the same filter packing f16 by hand. Compare filters at equal rounding (the
  SH regression needed a truncating pack to match plain within 0.02 dB). — m7-sh, 2026-10-25
- Quick WebGPU probes don't need a server: a one-file `index.html` under the scratchpad and
  `BASE=file://<path>/index.html node packages/denoiser-realtime/dev/run-headless.mjs x=1` (the page sets
  `window.__rt`). Size readback buffers for `bytesPerRow` × rows, or `mapAsync` hangs the run silently.
  — m7-sh, 2026-10-25

- Scene variants without touching the original paths: generate the tracer WGSL from a TS template per build
  (`sceneWgsl('standard' | 'bumpy' | 'glass')`) and insert the new code with ``${B ? `...` : ''}``, so the standard
  build's existing entries are textually the original code and new entry points / bindings are only appended
  (unused bindings don't enter `layout: 'auto'`). Result: the 7 old paths' captures were byte-identical. Runtime
  `if (u.scene == …)` branches would have risked codegen (contraction) changes. Per-invocation state a shared
  helper needs (the geometric normal for the below-surface test) goes in a `var<private>` set by `primary()`.
  — testbed-v1, 2026-10-25
- A per-pixel 6-float payload doesn't fit one texture or `readTextures` (1–4 channels): keep two rgba32float halves
  on the GPU, read both and interleave on the CPU (`CaptureWriter` `{ parts: [...] }`), and upload as two textures
  in replay (`name`, `name#4`). The refs' second half needs its own accumulation buffer (`acc2`). — testbed-v1, 2026-10-25

- A CPU-based "is the GPU quiet?" check misses GPU-bound pages (high-spp reference renders burn GPU at ~0 % CPU):
  a bench that waited on Chrome CPU still read 25 ms medians. Wait on the *processes* instead (no other agent's
  `node … run-headless` / `run-realtime` for 15 s), and drop any round whose medians jump. — m7-sh, 2026-10-25
- Test-bed URL keys are first-occurrence wins and `bumpy.sh`-style wrappers that prepend `preset=full&` silently
  override a later `preset=fast` (LESSONS on `URLSearchParams.get`): put per-job overrides first. — m7-sh, 2026-10-25

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
- **Rank on pooled PSNR** (`psnrDenPooled` / compare.mjs `psnrPooled`: PSNR of the mean MSE
  over frames and pixels), not the old `psnrDen` (mean of per-frame dB). A frame with no error
  scores 120 dB (MSE floor 1e-12): on `pan` the last 17 frames show no shadow, so noisy input
  "scores" 36.0 dB mean vs 17.9 pooled, and shadows' uniform snap looked like +10 dB. Pooled is
  dominated by the worst frames instead (resets: accumulate-32 loses 2–3 dB). The live test
  bed's `regions.*.psnrDen` (incl. penumbra) were always pooled; compare.mjs's `psnrPenumbra`
  is a per-frame mean. Old JSON can be re-pooled approximately from `perFrame`
  (10·log10(1/mean 10^(−dB/10)), equal frame weights). — metrics, 2026-10-25
- `run-headless.mjs` is deterministic in quality: two runs of the same query on a frozen
  package give identical PSNR to 4 decimals, so a FLIP run can be compared cell by cell with
  a `flip=0` run, and parallel runs don't disturb quality numbers. — metrics, 2026-10-25

- An encoded reference made from the SAME samples as the plain one is a free correctness test: the test bed's
  `*_sh_ref` averages the M7-2 payloads of `*_ref`'s samples, so `a + b·n_s` must equal YCoCg-Y of `*_ref`
  (validate.mjs `*ExactAtSamplingNormal`). It agrees to ~0.3 %, the precision of the rgba16float `normal` it is
  evaluated with. Consequence for M7-13: resolving `diffuse_sh_ref` at the detail normal (reference (1)) gives
  almost exactly `diffuse_ref` (reference (2)); they differ only by the guard, the chroma ratio and sharpening.
  — testbed-v1, 2026-10-25
- RGB region metrics: square the per-channel error, not the channel-mean signed error. compare.mjs's dynamic /
  static split (written for scalar visibility) reused `s = mean_c e` for shadow-rgb and scored a grey output
  against a coloured reference 8 dB too high (opposite-sign channel errors cancel); per channel it matches the
  live test bed within 0.03 dB (the rest is the two history-validity tests' masks). — testbed-v1, 2026-10-25
- v1 capture sizes at 960×540 (f32, 256-spp refs): sh-diffuse + sh-specular 50 floats/px = 103.7 MB/frame,
  sh-diffuse alone 34 = 70.5 MB, shadow-rgb 28 = 58.1 MB; capture only the v1 signals a capture is for
  (`signal=sh-diffuse,sh-specular`), not `all,v1` (60 floats, 124 MB). — testbed-v1, 2026-10-25

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

- Shadows (1-spp binary visibility): SPEC's 1σ neighbourhood clamp never fires inside a
  penumbra (5×5 σ ≈ 0.5), so moving shadows lag through it; a window of ~2 standard errors
  of the 25-sample mean (0.4σ + 0.05) plus "restart at A = 0 when the clamp moved the
  history" was +2.5 dB overall and +1.7 dB penumbra. Restarting at A = 1 instead left a
  visible 1/n residue after a light flip (−0.9 dB). Blue-noise samples make the 5×5 mean
  accurate enough for this. — shadows, 2026-10-25
- Longer temporal history made shadows *worse* on every moving path, for `accumulate-32` vs
  `-8` too (orbit 25.8 vs 28.0 dB): repeated bilinear resampling blurs sharp shadows by
  ~√A px, and moving shadows lag. Catmull-Rom (+0.65 dB) and a per-pixel cap ~W_px² help;
  the tight clamp matters most. — shadows, 2026-10-25
- Penumbra-sized spatial kernels: radius ≈ 0.75 × the half-width W = R·h/(D−h), not more —
  the true profile is S-shaped and a disk as wide as the penumbra rounds its ends (radius
  1.5·W −0.4 dB, 3·W −1.7 dB on orbit). The noise-driven fallback (H18 total variation, no
  hit distance) gets within 0.4 dB of the hit-distance sizing on the test bed. — shadows, 2026-10-25
- Shadow anisotropy (stretch along the projected light by 1/(n·l)) only lost (−0.3 to
  −2.7 dB): the extra length is extra blur on these scenes. — shadows, 2026-10-25
- Mean-of-per-frame-dB metrics reward exactness in empty frames: `pan`'s last 17 frames have
  no shadow (passthrough = 120 dB), so a 1e-3 residue there cost ours 10 dB of the path mean
  until uniform 5×5 windows snapped the history to the exact value. — shadows, 2026-10-25

- A comparison table goes stale when a baseline's default changes after it was measured: the
  recurrent README table ("beats A-SVGF on 6/7") was taken minutes before SVGF's `feedback`
  default flipped to false, and against the new default SVGF wins 6/7. Before quoting "X beats
  Y", check which options Y ran with (here the SVGF column matched M1's feedback-on numbers
  exactly) and rerun Y in the same page. — spec-author, 2026-10-25
- Some measured numbers live only in commit messages (e.g. 25c80aa: joint recurrent 5.41 ms,
  prepass 0.10 ms without the depth slope; a787b20: specular per-path dB). `git log
  --format=%B -- packages/denoiser-realtime` is part of the reading list when updating SPEC or a
  resource table. — spec-author, 2026-10-25
- Results written the same night can use different versions of a baseline: M5's A-SVGF rows ran
  anti-lag v1 while M1 §12 (hours later) made v2 the default, and M2-M3's 5.55 ms A-SVGF joint is v1
  too. When quoting a number in SPEC or a README, write the version / commit next to it (each
  results doc's Setup table names the frozen commit) and add a TASKS re-measure item instead of
  mixing versions in one comparison. — spec-author, 2026-10-25
- Three GPU-time statistics are in use and are not interchangeable: dev-page min of 400 frames
  (M2-M3), test-bed solo bench median of 100 frames (M1 §12), fastest of several runs to dodge the
  M5 Pro's slow clock state (M4, M5). Uncontended they agree within a few % (SVGF joint 3.99 vs
  4.02 ms); the 8-frame `std1080-orbit` replay does not (every pixel young: 6.31 vs 5.61 ms for the
  same v1 config). Label the statistic with every ms. — spec-author, 2026-10-25

- Clean (mirror-like) specular breaks neighbourhood-statistics tricks tuned on noisy
  diffuse: clamping the slow value to the 3×3 *mean* ± a standard-error window blurs every
  reflected edge (mirror bin 34.8 vs 40.7 dB on a static camera). Centre such windows on the
  pixel's own value as roughness → 0. — recurrent-spec, 2026-10-25
- Virtual-motion reprojection: on a flat glossy floor it is the big win (+2.7 dB, r < 0.35:
  +5 dB); on curved mirrors the flat-reflector distance smears; the mirror equation with
  curvature from neighbouring normals fixes most of it (+1 dB). A virtual candidate without
  a validity test in the stabilization pass cost 0.4–1.5 dB: keep virtual fetches where a
  plane test and a confidence exist. — recurrent-spec, 2026-10-25
- Recurrent specular vs A-SVGF 'auto': at mid/high roughness with a static camera A-SVGF's
  short history + 5-level variance-guided à-trous beats the recurrent blur by 1–2 dB; no
  radius / tap / anti-lag / firefly / luminance-weight knob moved it more than ±0.2 dB
  (results/M2-M3.md). It is structural, not a tuning gap. — recurrent-spec, 2026-10-25

- A clamp toward a fast history must use the same reprojection as the value it clamps: the
  recurrent specular filter fetches the slow value with virtual motion but keeps the fast ĥ
  surface-reprojected (fine for radiance, where only luminance is clamped). Clamping SO (ĥ as
  the signal) to that surface-reprojected fast ĥ cost 2.5 dB on `pan`; blending the fast ĥ with
  the virtual fetch by m·confidence fixed it (+0.9 dB SO mean). — occlusion, 2026-10-25
- SVGF defaults tuned for radiance over-blur a [0, 1] occlusion signal: on ĥ, σ_l = 1.5 and 3
  à-trous iterations beat σ_l = 4 / 5 iterations by ~1.8 dB AO and ~1.5 dB SO (fast test bed),
  and are cheaper. Re-tune the value weight when a filter changes signal. — occlusion, 2026-10-25
- "AO for free from the radiance filter's alpha" is free in cost, not in quality: the radiance
  pipeline's ĥ inherits radiance-tuned radii, a history shortened by luminance anti-lag, and no
  ĥ clamp; a dedicated occlusion pass on the same rays is clearly better (results/M5.md). — occlusion, 2026-10-25

- Shadows on 1-spp blue noise: the error right after a reset was mostly **pixel-scale noise** in
  the outer half of penumbrae (box-filter the signed error: 3×3-filtered 37 dB vs 33 dB full),
  where lit samples carry no occluder distance and a tile minimum sets the radius. Wider kernels
  or more taps didn't help. Sizing by Heitz 2018's noise estimate E did, and **the mean of the
  occluder-sized and the E-sized radius beat either alone** everywhere (+0.56 dB pooled at
  1080p, +1.1 dB on a reset window). Look at where the error lives (by reference band, by spatial
  frequency) before tuning radii. — shadows, 2026-10-25
- Reset-window replays (16 frames from a reset) and 96-frame live paths disagree on
  young-history tricks: anything keyed on "short history" wins on the replays and loses live,
  because history caps (W_px²) and anti-lag restarts keep many penumbra pixels short-lived
  forever. Key fresh-pixel treatments on A = 0 (truly new), and screen on both. — shadows, 2026-10-25
- A per-pixel scalar the spatial pass needs can ride in a spare byte of the packed geometry
  texture (shadows: the 8-bit roughness slot carries the noise estimate E). Its previous-frame
  value comes for free with the reprojection taps, which already load that texture. — shadows, 2026-10-25

- "Frame 2 worse than frame 1" after a reset (shadows) had two causes, both invisible on frame 1: a fresh-pixel trick
  keyed on A = 0 that switches off abruptly on the second frame, and the neighbourhood clamp, which has nothing to act
  on until there is a history. Find them by splitting the error by reference class (umbra / penumbra / lit) and by
  neighbourhood (umbra px within 3 px of a lit px held 96–99 % of the umbra error, biased +0.05 → +0.075), and by
  switching the clamp off on a static view. — shadows-reset, 2026-10-25
- A 5×5 clamp window that ignores geometry pulls thin occluders and creases toward the surface next to them, and
  hard-edge pixels toward their 5×5 mean (~0.15 off). Counting only taps with a similar normal (binary 30° test, window
  × √(25/n)) was +1.0 dB pooled / −29 % FLIP at 1080p on the test bed. A plane-distance test (2 % of view distance, the
  spatial passes' test) does NOT do it: at a slat's silhouette the side face's plane passes within 2 % of the front-face
  pixels next to it (−2.4 dB on `thin`); on the test bed the normal test alone matched plane + normal. — shadows-reset, 2026-10-25

- Filter costs depend on the bench scene, and not equally: the recurrent pair reads 4.44 ms on the
  package dev page but 3.99 ms on the test-bed solo bench (`orbit`; every pass 7–18 % lower), while SVGF
  reads 4.02 vs 4.00. "Recurrent is slower than SVGF" was a cross-bench comparison; on one bench they cost
  the same. Rank costs from one bench only. — remeasure, 2026-10-25

- One analytic test bed vs a real scene: shadows, diffuse and AO rankings carried over to the three.js corner on a
  moving camera (results/M6-real-scene.md), but recurrent specular's lead over plain SVGF did not (SVGF +1.3 / +1.8 dB
  on SSR input). A specular ranking from one signal type (traced, demodulated, true hit distance) doesn't transfer to
  SSR input; say which specular signal a ranking was measured on. — real-scene-motion, 2026-10-25

- Public evidence on recurrent vs variance-guided (sources/nrd-public-2022-2026.md): Epic's MegaLights (2025) runs its
  spatial pass after accumulation with no feedback "to make the output sharper and quickly converge … after
  disocclusion"; Ubisoft ships a recurrent blur as the cheap option and ranks it blurrier than ReBLUR/ReLAX. Same
  pattern as our test bed. Shipped anti-lags shorten the frame cap in proportion to how far the history sits outside
  the clamp box and never drop it to 0; our shadows' restart-to-0 is the outlier and the likely moving-shadow boiling
  cause. — public research 2022–2026, 2026-10-25

- **Flicker and temporal PSNR on the error can't see boiling in soft shadows.** e_t − e_t−1 includes the
  reference's own frame-to-frame noise (2048-ray references: ~0.004 per frame in a wide penumbra), as
  large as a good output's change, so v2.1's 4.7× FFX output noise on the knot's shadow scored *better*
  flicker than FFX in the dynamic region. Look at the output's own temporal change (compare.mjs `boil`:
  RMS second temporal difference / √6, with the reference's boil as the floor) and at frame-difference
  strips. — moving-shadows, 2026-10-25
- **Run a frozen control before blaming motion.** The "moving shadow boils" report turned out to be wide,
  soft penumbrae boiling whether the knot moved or not (rect boil 0.0069 frozen vs 0.0062 rotating); the
  knot's shadow is just the widest. A dynamic region defined by reference change (0.05 over 4 frames)
  flagged 761 px/frame of a 40k px shadow. — moving-shadows, 2026-10-25
- An output stabilization history (box-clamped to the 3×3 range of the current output) is TAA, and blurs
  hard edges the same way: the box spans the step and holds nothing back (−5.5 dB on the test bed).
  Gate it to narrow ranges, and scale that threshold with resolution (a penumbra's per-pixel slope
  halves at 2× resolution: the 540p threshold cost 0.45 dB on `light` at 1080p). — moving-shadows, 2026-10-25
- **Coloured shadows split exactly: E[v·T] = E[v]·E[T | v = 1].** Denoise opaque visibility as before and
  accumulate the transmittance only over samples that reached the light (like g over occluded samples), then
  multiply. The product of two plain spatial means is biased wherever opaque and translucent blockers overlap, and
  this split keeps every tuned scalar rule on v (opaque output bit-identical when T ≡ 1). Multiplying layer
  transmittances is as order-independent as Tomb Raider's "subtract 1/3 per layer" (both commute) and exact for
  any colours. — spec-author (SPEC v0.3 §7.10), 2026-10-25
- **A directional payload should be exact at the filter's normal.** Encoding each diffuse sample as the L1 band
  of its clamped-cosine lobe, rescaled so it evaluates to L at the normal the ray was sampled around
  (`a = L/(1+2c)`, `b = 2Lω/(1+2c)`), keeps weights bounded (the textbook cosine-sampled projection has a 1/c weight
  with infinite variance) and makes SH mode regress against the plain filter: resolved at the guide normal it must
  match within noise. Reuse the plain luminance (payload evaluated at the guide normal) for every weight so the
  tuned constants carry over. — spec-author (SPEC v0.3 §8.5), 2026-10-25

- **Bit-identical after adding code to a shader: watch fused multiply-adds.** Adding a τ sum `tsum += (w * v) * τ` next to
  v's `sum += w * v` made ~0.7 % of v's pixels differ by up to 24 ULP: the shared product `w * v` is computed once (CSE),
  so v's sum no longer compiles to an fma. Writing the new sums with explicit `fma(w, v, ...)` (no standalone `w * v`)
  restored byte identity on every capture. Check with a replay byte compare (outputs `*.f32`), not only per-frame PSNR
  (which agreed to 0.0001 dB on all but one frame). — m8-translucency, 2026-10-25
- **rgba16float storage writes truncate (round toward zero) on the M5 Pro / Metal.** A history near 1 that is
  re-stored every frame drifts down by ~1 f16 ulp per store (τ fell to 1 − 2⁻¹¹ where nothing was in the way, and the
  approximate division `(n·x + x)/(n + 1)` doesn't return x exactly either). Use update forms that are exact when
  inputs agree (`h0 + Σ w (h_k − h0) / Σ w`, `x + a·(y − x)`), or snap uniform neighbourhoods. The same truncation
  applies to the opaque shadow history (TASKS). — m8-translucency, 2026-10-25
- Parameter sweeps on captures through compare.mjs take minutes per capture × variant under load; the live test bed
  scores many variants of one id in one page (`denoiser=id,id@sh.x=1,id@sh.x=2`) sharing references in ~20 s per
  path. Sweep live, then confirm the picks (and boil) on replays. — m8-translucency, 2026-10-25

- Reference noise is an additive term, and it is not small (E-1, results/E1-high-reference.md): against 256-spp
  references MSE = true MSE + σ²_256 held to ±5 % for every arm, so rankings are safe, but gaps shrink 2.5–3.6× on
  diffuse and AO (recurrent vs A-SVGF diffuse −0.75 → −2.12 dB at 4096 spp), 1.6–2× on specular, ~1.1× on shadows and
  SO. The 256-spp ceilings are diffuse 41.7, specular 36.9, AO 42.2, SO / shadows 49 dB. Quote decision gaps from
  high-spp references, or subtract σ²_256 (from two independent references) in MSE. — e1, 2026-10-25
- Two references of the same estimator at different spp but the same seed salt are correlated (shared per-pixel
  Cranley-Patterson rotation and secondary random stream): their mutual PSNR overstates the floor. Use `&refsalt` /
  `&ref2salt` for independent sets. Specular reference variance fell only ×9 from 256 to 4096 spp (heavy-tailed GGX
  samples), diffuse and shadows ×31–33 (stratification). — e1, 2026-10-25

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
- A "fast history" anti-lag (clamp the slow value to the fast EMA's μ ± γσ) can only move
  the slow value as fast as the fast EMA, minus a γσ offset: on the dev page a light switch
  recovered to 26 dB after 12 frames (SVGF 37). Using the standard error of the 3×3 mean
  (σ/√N) as the window, plus a current-frame detector (3×3 mean of this frame's pre-blurred
  signal vs the reprojected history, in standard errors) gets 34 dB; when such a detector
  fires, shorten A to A_fast, not 0 (0 cost 1.4–1.8 dB on static content: blur bleeding
  at A = 0). — recurrent, 2026-10-25
- The dev page (direct point lights, hard shadows, exact truth) ranks the recurrent blur
  ~2 dB below SVGF; the test bed's path-traced GI ranks it 0.5–1 dB above A-SVGF. Without a
  luminance weight the recurrent blur smears hard direct-light edges; tune it on the test
  bed / captures. — recurrent, 2026-10-25

## Clean room

- Using native NRD as a black box (feed our captures, compare outputs) is allowed; reading
  its code or README prose is not. NRD's interface facts (e.g. 2.5D motion,
  z = viewZprev − viewZ, is its recommended mode) are in `sources/nrd-provenance.md` §3
  and are fine to use. — orchestrator, 2026-10-24
- Second reviews: check equations against the PDF page image, not the text extraction.
  Two-column `pdftotext` scrambles stacked fractions (M12 Eq. 13 reads as "1 1 / k µ" and was
  transcribed with µ in the wrong place in a source note). `Read` on the PDF with `pages: "4"`
  renders the page; `pdftotext -f N -l N` finds which page a section is on. Slide decks: the
  `tr/p-0NN.png` images show whether a slide has text or only a picture (TR19's "overlapping
  penumbra" slides are pictures only, so no fix can have come from them). — shadows provenance reviewer, 2026-10-25

- Scratch-registry test beds: Vite's HMR **reloads running headless pages** when any served
  file changes (the wrapper, a synced package copy), so a batch silently restarts or hangs
  mid-run (a missing import → stuck until the 45-min timeout). Put `server: { hmr: false }`
  in the scratch Vite config and still don't touch served files during a batch. Also keep the
  `RT_REALTIME_SRC` snapshot at the registry's commit: the registry imports new package
  exports (e.g. `HitDistanceNormalizer`) and an older snapshot breaks every page
  ("does not provide an export named …" only in the Vite log). — svgf-antilag, 2026-10-25
- `batch` loops in a zsh script: `jobs -r` is empty in a non-interactive script, so a
  "max 4 jobs" throttle built on it starts everything at once (7 × 1080p pages + other
  agents' jobs: 40+ min instead of 5). Use `printf '%s\n' $paths | xargs -P 4 …`. — svgf-antilag, 2026-10-25

- A Vite middleware that calls `next()` for a missing file under its own prefix gets Vite's SPA fallback: `index.html`
  with **200**. A `fetch(HEAD)` "does this weight file exist?" probe then says yes and the loader dies on "Invalid or
  corrupted weights blob". Answer 404 yourself. — e2, 2026-10-25
- OIDN 2 on our 1-spp signals (E2-oidn-baseline): demodulated diffuse / specular want **albedo = 1 + normal** (clean-aux
  `*_calb_cnrm` weights; OIDN takes a normal only with an albedo). Color only is −1.4…−1.8 dB, and the real albedo −2.7 dB
  diffuse (it describes texture edges the demodulated signal doesn't have). Scalars (visibility, ĥ) go through the
  **HDR** weights as grey color. The LDR weights brightened dark regions (shadows 19 vs 30 dB). — e2, 2026-10-25
- Async / offline denoisers in the replay: implement `ReplayDenoiser.dispatchAsync` and register them from
  `tools/rt-capture/src/main.ts` (the replay page), not `denoisers.ts`. Then the test bed, which imports the registry
  and runs it synchronously, never loads them. — e2, 2026-10-25
- `pkill -f <waiter script>` also kills the copy of that waiter a running batch script is blocked on. The batch then runs
  its next page at once, unquieted. Kill your own extra instance by PID. — e2, 2026-10-25
- Reading a proprietary project's release notes cleanly (RULES 3b): fetch with `gh api`, strip fenced code blocks
  with a script *before* the text reaches you, and read the stripped copy only. NRD's release bodies and `UPDATE.md`
  had no fences, but `UPDATE.md` still carries inline usage snippets and default values in prose ("old value X matches
  new Y"), so the fence strip is not enough: skip inline expressions and numbers by eye. Most lines in NRD's notes
  are "how" (weights, tests, pass moves, tap counts: ~417 dropped vs ~200 kept), so keep a per-release tally in a
  scratch file as you go rather than counting at the end. — release auditor, 2026-10-25
- Change audits from `git diff --numstat` (rule 3c): always add `-w`. NRD converted line endings in several
  releases, so raw counts show whole files "rewritten" (`NRDDescs.h` at v2.5.0: 331 of 335 lines raw, 0 with `-w`;
  SH host files at v4.15.0: 30 % raw vs 5 %). Don't trust a direct diff across years either: git loses renames across
  directory reshuffles and counts every old file as deleted. Chain consecutive-release diffs instead, and split removed
  lines into edited vs deleted files (`--name-status` status per path) so file merges (packaging) don't read as
  rewrites. — change auditor, 2026-10-25

- Search-engine summaries can quote NRD's README even when you never open it (a query about RTXDI gradients and
  denoiser confidence did). Keep queries about anti-lag / history confidence on papers and talks (A-SVGF, studio
  talks), block github.com and deepwiki.com, and if a summary quotes NRD text, say so and use none of it.
  — public research 2022–2026, 2026-10-25
- Byte-checking a default flip without fighting other agents' edits: `git archive HEAD packages/denoiser-realtime/src`
  twice into scratch (before / after), copy only your changed files into "after", serve each with `RT_REALTIME_SRC` on
  its own port, and replay one capture through both (std540-orbit, 16 frames, `warm=0`: ~2 min per side), then `cmp`
  the `.f32` files. To add default-path entries without touching the registry, wrap it with a Vite `resolveId` plugin
  that redirects `./denoisers` **only for `src/main.ts` / `src/run.ts`**: a plain `resolve.alias` regex on
  `./denoisers` also catches the package's own `index.ts` re-export and the page dies with a missing-export error (the
  headless runner then hangs until its timeout). Count `console.warn` around a constructor inside the wrapper and throw
  on a mismatch to test "warns once" in the same run. — apply-decisions, 2026-10-25
- Defaults compose: `OcclusionDenoiser`'s SVGF inherits SVGF's `antiLag` default, so two separate decisions (occlusion
  → 'svgf', SVGF → 'auto') made the occlusion default A-SVGF. Registry ids whose names imply a config (`occlusion-svgf`,
  `svgf-sh`) should pin it explicitly, or they silently turn into their `-auto` sibling. — apply-decisions, 2026-10-25
- The quarantined external review lives in `rt-denoiser-sources/quarantine/`, inside the same tree as the allowed
  papers, so a clean agent that lists that tree to find SVGF or Dammertz sees its file names. List the subfolder you
  need (`svgf/`, `reblur/`, `shadows-specular/`, `public-2022-2026/`) instead of the root, and never open
  `quarantine/`. (Done 2026-10-26: the orchestrator moved it to a folder outside `rt-denoiser-sources/`;
  `rt-denoiser-sources/` now holds only allowed material.) When a clean review finds nothing to
  redact, still update the reviewed file's status line, so readers don't keep treating it as "pending".
  — clean reviewer (nrd-review-targets), 2026-10-25
