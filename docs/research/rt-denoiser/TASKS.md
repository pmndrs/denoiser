# Tasks: the shared board for agents on this project

_Started 2026-10-24 (overnight run). Owner of this file's structure: the orchestrator
session. Agents update **only their own task's** checkboxes and status line, and add new
tasks under "Found along the way". Read [LESSONS.md](LESSONS.md) before you start, and add
to it before you finish._

## How agents work here (read first)

1. **Read, in order:** [RULES.md](RULES.md) (binding; your role is in your brief),
   [LESSONS.md](LESSONS.md), this file, then [PLAN.md](PLAN.md) and whatever your brief
   points at.
2. **Clean room.** Never open NRD / NRD-Sample code, NRD's README, forks or ports (incl.
   `C-none/Web-RTRT`). No web searches that land on NRD's GitHub source. NRD's interface is
   in `sources/nrd-provenance.md` §3; that is all anyone needs. In the RTG II chapter,
   read prose and equations, skip numbered listings. Allowed: the papers in
   `/Users/dex/Developer/rt-denoiser-sources/` (don't commit them), NVIDIA's public talks
   and blog posts, permissive code from its own upstream (A-SVGF's BSD-3 code is in
   `svgf/asvgf_zip/`).
3. **When you're stuck on "how would NRD do this?"**, don't guess at its code. Either find
   a public source, design it yourself and record it as "our design" in PROVENANCE.md, or
   write a **black-box probe** request under "Probes for the Windows harness" below: a
   capture that isolates the behavior, and what output to compare. Native NRD's outputs
   are fair game; its code is not.
4. **File ownership.** Your brief lists the paths you own. Don't edit other agents' paths.
   If you need a change there, add a task under "Found along the way".
5. **Commits.** Commit as you go on `feat/rt-denoiser-cleanroom`, **only your own paths**:
   `git add <your paths> && git commit -m "<area>: <what>" -- <your paths>`. Other agents
   share this worktree; if you hit `index.lock`, wait a few seconds and retry. Never
   `git stash`, never `git add -A`, never reset or checkout other people's files. End
   messages with the `Co-Authored-By` line from your brief.
6. **Dev-server ports** (one per agent, so headless runs don't collide):
   5210 `examples/ffx-denoiser` · 5220 `examples/realtime-denoiser` · 5230
   `tools/rt-capture` · 5240 `packages/denoiser-realtime` dev page. Kill your server when
   done (`pkill -f "vite --port 52X0"`).
7. **Headless WebGPU works** on this Mac: see `examples/ffx-denoiser/run-headless.mjs`
   (CDP over Node's WebSocket, no puppeteer, Chrome at the default path). GPU timings
   taken while other agents run headless jobs are noisy: mark them "contended" and
   re-measure alone before they go in a results table.
8. **Don't loop.** If an approach fails twice the same way, write what you tried in
   LESSONS.md, pick the next-best option or narrow scope, and say so in your report. If a
   question genuinely needs Dennis, add it under "Questions for Dennis" and continue with
   your best guess, marked as provisional.
9. **Report back** (your final message): what's done (with commit hashes), numbers, what's
   provisional, what's next, and anything a later agent must know.

## Milestones

Status legend: `[ ]` open · `[~]` in progress (agent name) · `[x]` done (commit) · `[!]` blocked (why)

### M0: foundations

- [x] (d3d603a, 4619633) **T0.1 SPEC.md v0** (spec author): SVGF + A-SVGF pipeline (papers + `ssgi-svgf-review.md`
      upgrades) and the recurrent pipeline, with a decision for each open item in
      `reblur.md` §7; shared temporal core; shadows and occlusion outlines; WebGPU
      resource/memory budget. _Dennis reviews before M2 is final; M2 may start against v0,
      marked provisional._ _v0.1 (2026-10-25, spec author): the measured M1/M2/M4 deviations
      are folded in, shadows rewritten as built, measured memory/ms vs PLAN §8 (§10.3), review
      list rewritten (§12, short form §0.2). Recurrent specular left as designed (T3 in flux)._
- [x] (4619633) **T0.2 PROVENANCE.md skeleton** (spec author): pass → public source → our deviation.
- [x] (0a035e3, 85783f8, 0047bfb, 10ecb5b) testbed **T0.3 Test bed signals** (`examples/realtime-denoiser`): 1-bounce diffuse GI + hitT,
      specular + hitT over a roughness range, shadows + occluder distance + light size,
      albedo/f0; per-frame converged references; stress paths (fast pan, lighting change,
      thin geometry, glossy floor, camera cut); metrics: PSNR, FLIP, temporal PSNR /
      flicker, per-region (penumbra, disoccluded), per-pass GPU ms; headless runner.
- [x] (e411ee7, f376fe2, bb343d9) capture-io **T0.4 Capture I/O** (`tools/rt-capture`): finalize CAPTURE-FORMAT v0 (incl. 2.5D
      motion z), synthetic capture generator (also serves the Windows harness's phase 3),
      validator, browser writer + replay module running any `TemporalDenoiser` from a
      capture, metrics on replay outputs.
- [x] svgf (6561a00) **T0.5 Package skeleton** `packages/denoiser-realtime` (private), exported as
      `denoiser/realtime`, mirroring `packages/denoiser-ffx`; FFX classes re-exported.
- [x] wiring (2359748, 6bf2bf7, 0709015) **T0.6 Wire capture exporter + replay into the test bed** (after T0.3, T0.4).
      One registry (`tools/rt-capture/src/denoisers.ts`, the test bed maps it); test bed
      `mode=capture` / `mode=replay` / `start=`; standard capture set in
      `examples/realtime-denoiser/CAPTURES.md` (10.6 GB, one command); runners cross-platform. SVGF registered as `svgf`,
      `svgf-auto`, `svgf-diffuse`, `svgf-specular` (orbit smoke + standard-set replay: no NaNs).
- [x] wiring (0709015) **T0.7 Exit (our side):** a capture written by the test bed replays through our
      replay mode with matching results. _Done: PSNR within 0.001 dB on 30 rows (rt-orbit,
      rt-cut; RESULTS.md "Capture round trip")._ _Windows side (native REFERENCE reads it) waits
      for Dennis's machine._

### M1: SVGF + A-SVGF baseline

- [x] svgf (81758c9, ef0c9a9) **T1.1 Shared temporal core**: reprojection (NDC motion + viewZ, 2.5D z when
      present), per-tap plane-distance disocclusion, bilinear / Catmull-Rom history,
      history length, reset.
- [x] svgf (81758c9, ef0c9a9) **T1.2 SVGF diffuse** ported from `ssgiDev` demo 14 with the review's upgrades.
- [x] svgf (d6a4780) **T1.3 SVGF specular** (surface reprojection first; roughness-aware weights).
- [x] svgf (1f8d028) **T1.4 A-SVGF** gradient-driven α (from the paper + BSD reference code).
- [x] results (13dea6c, 89f0050) **T1.5 Results table** vs references (and vs FFX reflections for specular) on the
      test bed's paths; per-pass ms at 1080p. _Done: `results/M1.md` (blue-noise sampler,
      7 paths × 3 signals at 1080p, standard-set replay, SVGF sweep, solo costs, crops).
      Recommended SVGF defaults below (owner denoiser-realtime). Quality vs native awaits
      the Windows replay of the regenerated standard set._

### M2–M5 (start after M1 numbers exist; against SPEC v0, provisional until reviewed)

- [~] recurrent (e5e3932, 1ecc596 + docs) **T2 Recurrent diffuse** (pre-blur → temporal → history fix → blur → post-blur →
      stabilization, anti-lag). _Implemented, provisional (SPEC v0): `filter: 'recurrent'`
      on `DiffuseDenoiser`. ~~Test bed 1080p: beats A-SVGF 'auto' on 6/7 paths~~ (that compared
      against feedback-on SVGF). Same-page rerun vs today's defaults (results/M2-M3.md): recurrent
      diffuse 38.44 dB mean vs SVGF 39.00 / A-SVGF auto 39.27, wins only `glossy`; weaker in disoccluded regions. 2.92 ms at 1080p (diffuse), over
      budget for diffuse + specular (5.22 ms). Left open: registry entry (below), budget,
      M2 go/no-go vs native._
- [x] recurrent-spec (a787b20, 25c80aa, 1b49e75, 6fa9274 + results) **T3 Recurrent specular** (virtual motion, lobe kernels), then the joint budget.
      _Implemented, provisional (SPEC v0/v0.1): virtual motion with curvature-corrected distance,
      confidence, clamp, α-space blend; M1's mirror over-blur and glossy-floor ghosting fixed
      (`light` mirrors 34.4 → 40.8 dB, `glossy` r < 0.35 35.7 vs A-SVGF 34.8). But specular is
      below A-SVGF auto on 6/7 paths (34.41 vs 35.32 dB mean, wins `glossy` +0.17), above plain
      SVGF on 4/7. Joint recurrent 5.41 → 4.44 ms (target 4; `blurTaps: 4` = 4.05 ms at −0.07 dB),
      105.5 B/px. Joint default left as is (recurrent diffuse + A-SVGF specular): Dennis decides.
      Details: results/M2-M3.md._
- [x] shadows (27eab97 … 86e0262) **T4 Shadows** (penumbra-aware, fractional visibility, no blur feedback).
      _Done, provisional (SPEC v0 §7): `ShadowDenoiser` (`src/shadow.ts`, `src/shaders/shadow.ts`),
      `ShadowInputs.light` (core, additive), registry id `shadows` (`sh.<option>` settings). 1080p, 7 paths:
      38.89 dB / penumbra 28.12 / FLIP 0.018 vs FFX 33.57 / 23.50 / 0.038 (better on every path);
      0.43–0.64 ms solo (FFX 0.50–0.73; `thin` 0.64 over the 0.6 target). Weak spot: first ~5 frames
      after a reset/disocclusion. `results/M4.md`; PROVENANCE rows marked "yes" need the second
      reviewer (RULES §8)._
- [~] occlusion **T5 Occlusion** (AO/SO from normalized hit distance). _In progress (occlusion agent, 2026-10-25): test-bed `ao`/`so` signals + references, `OcclusionDenoiser` (recurrent occlusion-only mode, SVGF on the scalar), M5 results._

## Found along the way

_(agents add tasks here: `- [ ] <task> — found by <agent>, owner <path or "unassigned">`)_

- [x] (spec-author, SPEC v0.1 §1.2/§9: superseded by the built API) API additions proposed by SPEC §1.2/§9 (`ShadowInputs.light` done: faade1e, `ShadowLight`): `FrameGuides.f0?`, `ShadowInputs.light`
      (capture `lights` fields), options `inputDemodulated` (default true) and
      `output: 'demodulated' | 'remodulated'` (default demodulated), and how
      `DiffuseSpecularDenoiser.dispatch` returns two outputs — found by spec-author, owner
      `packages/denoiser-core/src/temporal.ts` / T0.5
      _SPEC v0.1 adopts what was built: `remodulate: boolean` + caller's `inputs.demodulation`
      (no `f0`, no in-denoiser demodulation), `dispatchBoth()` for two outputs._
- [ ] Capture format: `*_hitt = 0` means both "miss" and "lobe not sampled"; SPEC C-4 treats
      0 as miss. If probabilistic lobe selection is ever captured, give "not sampled" its
      own value (proposed: negative) — found by spec-author, owner CAPTURE-FORMAT (capture-io)
- [ ] A-SVGF renderer contract (SPEC §4.6 S-8): the test bed's tracer must split primary
      visibility and shading, and re-shade requested pixels at the previous surface point
      with the previous seed — found by spec-author, owner `examples/realtime-denoiser` (T0.3/T1.4)
- [x] (e5e3932, recurrent: 1.03 ms → 0.96 ms both signals; SPEC v0.1 §10.3) M2 first step: time the 8-pass recurrent skeleton with trivial kernels at 1080p
      (SPEC §10.3 says the 4 ms target is at risk) — found by spec-author, owner T2

- [x] (T0.6, wiring) T0.6 wiring notes: the test bed adds `rtCapture()` from `tools/rt-capture/src/vite-plugin`
      to its Vite config and writes with `CaptureWriter` (`tools/rt-capture/src/writer.ts`);
      set `static: false` when the movable sphere moves; run `validate.mjs` on the result.
      Its Karis 2014 envBRDF matches CAPTURE-FORMAT v0. — found by capture-io, owner `examples/realtime-denoiser`
- [x] (T0.6, wiring) Register the SVGF denoiser(s) in `tools/rt-capture/src/denoisers.ts` (`registerDenoiser`;
      a joint diffuse+specular denoiser implements `ReplayDenoiser` and returns both
      outputs). The replay already fills `guides.viewZ` / `guides.motionZ` when the capture
      has them. — found by capture-io, owner `tools/rt-capture` (any agent may add the entry)

- [x] (T0.6, wiring) T0.6 hook: every test-bed buffer lives in `SceneSignals.textures` (`examples/realtime-denoiser/src/signals.ts`,
      CAPTURE-FORMAT names and formats in its header comment; refs only for signals passed in `refs`,
      `refs=all` renders all three) plus `SceneSignals.frameMeta` (camera, light, movable sphere, reset)
      after each `render()`. Write after `render()` in `runEval`; the light is `frameMeta.light`
      (sphere: pos, radius). — found by testbed, owner T0.6
- [ ] A-SVGF re-shading (SPEC S-8) not built in T0.3: the tracer's 1-spp samples are already
      deterministic per (pixel, `u.frame`, signal salt) (`noisySeed` in `src/scene.ts`), so a
      `reshade` entry that evaluates a forward-projected pixel's sample with frame − 1's seed at
      the current surface point is the missing piece. — found by testbed, owner T1.4
- [x] (13dea6c, results) Test-bed sampling is white noise (PCG); the renderer contract in `sources/shadows-specular.md`
      asks for blue noise animated per frame. Add a `sampler=bluenoise` option before tuning
      spatial filters on it (provisional until then). — found by testbed, owner `examples/realtime-denoiser`

- [x] (T0.6, wiring) Register `denoiser/realtime` in the test bed (`examples/realtime-denoiser/src/denoisers.ts`):
      add `@pmndrs/denoiser-realtime` (workspace) + a vite alias to
      `packages/denoiser-realtime/src/index.ts` like denoiser-ffx, then entries
      `{ id: 'svgf', signals: ['diffuse', 'specular'], create: (d, s, q) => s === 'diffuse' ?
      new RT.DiffuseDenoiser(d, opts(q)) : new RT.SpecularDenoiser(d, opts(q)), inputs: radianceInputs }`
      and `'asvgf'` with `{ antiLag: 'auto' }` (options from `q`: `feedback`, `kernel`, `antiLag`).
      Both conform to `TemporalDenoiser`; specular needs `guides.roughness`. Joint use:
      `DiffuseSpecularDenoiser.dispatchBoth({ diffuse, specular }, guides, camera)` returns
      `{ diffuse, specular }` (shared prepass; `dispatch()` returns diffuse only). Inputs
      are demodulated; outputs stay demodulated. — found by svgf, owner `examples/realtime-denoiser`
- [x] (T0.6, wiring) Same for the replay (`tools/rt-capture/src/denoisers.ts`): `perSignal((d, s, set) => s ===
      'diffuse' ? new DiffuseDenoiser(d, …) : new SpecularDenoiser(d, …))` for ids `svgf`,
      `asvgf`; a joint entry can wrap `DiffuseSpecularDenoiser.dispatchBoth`. Import from
      `../../../packages/denoiser-realtime/src/index` (relative, like FFX). — found by svgf, owner `tools/rt-capture`
- [x] (spec-author, SPEC v0.1 §1.3, §3.3, §4) SVGF vs SPEC v0 deviations to review (all measured on the dev page, provisional):
      (1) default kernel 3×3 box, not B3 5×5 (equal/better PSNR, 2.6× cheaper per iteration);
      (2) resolved: `DiffuseSpecularDenoiser` now runs both signals per dispatch (SPEC §4.1),
      3.98 ms at 1080p (was 5.85 separate); falls back to two pipelines if structural options differ;
      (3) Catmull-Rom (option, off) gates on the 4 inner taps + clamp, not a 16-tap test;
      (4) the paper's 3×3 history fallback is kept (S-1 drops it);
      (5) `antiLag: 'gradient'` takes renderer-made per-stratum samples instead of an
      in-denoiser G1 forward projection; plus `antiLag: 'auto'` (our renderer-free design)
      instead of C-10's fast history; gradients are per signal, not on the remodulated sum;
      (6) specular normal weight = lobe half-angle cutoff (+0.65 dB vs S-3's power form);
      (7) `remodulate: boolean` + `inputs.demodulation` instead of `output:` / `inputDemodulated`.
      — found by svgf, owner spec-author (SPEC.md §4)

- [ ] `denoiser/ffx` (and therefore `denoiser/realtime`, which re-exports it) throws on import
      outside WebGPU (Node / SSR): `packages/denoiser-ffx/src/{shadows,reflections}.ts` read
      `GPUTextureUsage` at module load (`const STORAGE_TEX = …`). Make it lazy (a function or
      numeric flags); `@pmndrs/denoiser-realtime` itself imports fine. — found by svgf, owner `packages/denoiser-ffx`

- [ ] CAPTURE-FORMAT v1: per-frame lights. Test-bed captures move/resize the light (path
      `light`) and move the sphere (`object`); v0 has one capture-level `lights`, so the test
      bed writes per-frame `frames[i].lights` and `frames[i].object` as extras (ReplayFrame
      exposes them as `frame.meta`). A shadow denoiser that needs the light size per frame
      should read `meta.lights`; consider making it part of v1 — found by wiring, owner CAPTURE-FORMAT (capture-io)
- [x] (89f0050, results) Re-measure the test bed's 1080p baseline tables: `accumulate` there is now
      `accumulate-32` (same code), and beyond-far geometry became sky in the guides (unscored
      pixels, tiny effect near the horizon on spatial filters) — found by wiring, owner T1.5
- [ ] Test bed live `svgf` / `svgf-auto` run one instance per signal (the registry's joint
      entry falls back to per-signal classes when created for one signal); only replay
      exercises `DiffuseSpecularDenoiser.dispatchBoth` (identical PSNR, ~12 % cheaper at
      960×540). Share one instance across a denoiser's signal pairs in `src/main.ts` if live
      timings of the joint path are wanted — found by wiring, owner `examples/realtime-denoiser`
- [ ] Windows: the runners (`examples/realtime-denoiser/run-headless.mjs`,
      `tools/rt-capture/run-headless.mjs`, shared `tools/rt-capture/lib/headless.mjs`) are
      untested there: Chrome discovery, headless WebGPU on D3D12, Browser.close / kill and
      temp-profile cleanup, `--serve` starting Vite. First run on the RTX machine:
      `--set=roundtrip`, then check `validate.mjs` and the round-trip numbers against
      RESULTS.md — found by wiring, owner harness builder (report only)

- [x] recurrent (24ffe6f) **SVGF defaults from M1** (results/M1.md §4, 1080p test bed, blue noise): set
      `feedback: false` (+0.6…+2.6 dB diffuse on all 7 paths, FLIP −24…−44 %, energy loss
      −3.5 → −1.2 %, specular +0.1…+0.8 dB, flicker unchanged, a bit cheaper) and
      `antiLag: 'auto'` (+0.1…+1.1 dB diffuse, +0.0…+2.9 dB specular over the 7 paths;
      +0.27 / +1.23 dB mean with feedback off, lower FLIP/flicker,
      light-change recovery ~3 vs ~9 frames; costs +2.1 ms joint: 4.20 → 6.31 ms at 1080p).
      Keep `kernel: '3x3'` (5×5: ≤ +0.15 dB for +2 ms), `atrousIterations: 5` (4: −0.1 dB,
      +15…56 % flicker), `temporalAlpha` 0.2 off / 0.1 auto. If `antiLag` stays 'off', make
      α_min per signal (diffuse 0.1: +1.2 dB; specular must stay 0.2: −1.5 dB at 0.1).
      Repro: test bed `signal=diffuse,specular&mode=eval&preset=full&denoiser=svgf,svgf-auto&path=orbit&feedback=0`.
      Update the README results table too. — found by results, owner `packages/denoiser-realtime`
      _Done per the orchestrator: `feedback` defaults to false; `antiLag` stays 'off' (performance
      first; 'auto' documented in the README as the quality option); kernel / iterations /
      α unchanged (per-signal α_min not done). Dev page re-measured: diffuse 40.48 → 41.55,
      specular 43.56 → 45.64 dB; joint 3.98 ms at 1080p._
- [ ] A-SVGF `antiLag: 'auto'` makes α_min ≤ 0.1 inert: 0.05 and 0.1 give identical output
      (≤ 0.02 dB) on orbit/pan/light, i.e. λ keeps 1/n ≥ ~0.1 everywhere, so histories never
      exceed ~10 frames even on static, unchanged regions (`light` before frame 48). Check
      the λ noise floor (`antiLagNoiseFloor`, default 2) on static regions; longer histories
      there would cut residual noise. Repro: `signal=diffuse&mode=eval&preset=full&denoiser=svgf-auto&path=light&temporalAlpha=0.05`
      vs `...&temporalAlpha=0.1` (same numbers); try `&antiLagNoiseFloor=3`. — found by results, owner `packages/denoiser-realtime`
- [ ] Specular `variance` pass is 0.66 ms at 1080p (0.95 with anti-lag) vs 0.23 for diffuse
      (README measured 0.37 on the dev scene); worth a profile, it is the largest single
      specular pass (M1.md §6). — found by results, owner `packages/denoiser-realtime`
- [ ] Windows: the standard capture set was regenerated with blue-noise sampling
      (2026-10-25 ~01:00, same names and sizes, `extra.testbed.sampling: "blue"`); copy the
      new set before the native M1 replay. Old white-noise captures are obsolete. — found by results, owner harness builder (report only)
- [ ] `RT_REALTIME_SRC=<dir>` on the test-bed Vite server pins `denoiser/realtime` to a frozen
      `git archive` copy (examples/realtime-denoiser/vite.config.ts); use it for results runs while
      someone edits the package. — found by results, owner any agent (FYI)

- [x] (0715551, recurrent-spec: `recurrent` = both recurrent, `recurrent-svgfspec`, `recurrent-diffuse`, `recurrent-specular`; settings `r.` / `t.` / `d.` / `s.`) Register `recurrent` in `tools/rt-capture/src/denoisers.ts` (test bed + replay): the
      SVGF pattern works unchanged, options with `filter: 'recurrent'`: (1) `recurrent-diffuse`:
      `perSignal((d, _s, st) => new DiffuseDenoiser(d, { filter: 'recurrent', ...recOpts(st) }))`;
      (2) `recurrent`: the `svgfJoint` shape with `new DiffuseSpecularDenoiser(device,
      { filter: 'recurrent', ...recOpts(st) })` (= recurrent diffuse + SVGF `antiLag: 'auto'`
      specular until M3; `specular: { filter: 'recurrent' }` for both recurrent in shared
      dispatches), single-signal fallback to `DiffuseDenoiser` / `SpecularDenoiser` with the same
      options. Settings: every `RecurrentOptions` key is numeric or boolean (README); a
      working mapper used for T2 (`r.<key>=v`, `t.<tune>=v`) is in the T2 report. Diffuse
      `hitDistance` is optional but feeds the radius clamp and ĥ (AO). The output texture
      rotates between internal buffers (valid until the next dispatch) — don't cache it
      across frames — found by recurrent, owner `tools/rt-capture`
- [x] (spec-author, SPEC v0.1 §3.5, §5, §6) Recurrent vs SPEC v0, measured deviations for the spec author (test bed `fast` preset,
      7 paths, mean PSNR; SPEC defaults = 36.94 dB): (1) fast-history clamp window = γ·σ/√N
      (standard error of the 3×3 mean) with γ = 1 instead of γ = 2 spreads: +0.37 dB and
      dev-page light switch 29.0 → 34.3 dB 12 frames after (SPEC form alone recovers at the
      fast EMA's speed minus a γσ offset); (2) added a current-frame detector in TA (3×3 mean
      of this frame's pre-blurred lum/ĥ vs reprojected history, threshold 3 standard errors,
      A ← lerp(min(A, A_fast), A, sat(2 − r))): dev switch +2–3 dB, test bed ±0.03; a floor of
      0 instead of A_fast cost 1.4–1.8 dB on static scenes; (3) radii pre-blur 25 px (D1: 15) and
      R_max 45 px (R-5: 30): +0.10 / +0.17 dB; (4) A_cap: 15 vs 31 vs 63 = +0.11 / 0 / −0.02
      with SPEC anti-lag, −0.04 for 31 vs 15 with ours: kept 31; N_stab 3/7/15 ≈ flat, kept 7;
      (5) taps placed with the screen Jacobian of the kernel plane (affine) instead of
      projecting each world tap (R-4), plane distance as a linear function of the tap pixel;
      identical PSNR, part of 3.86 → 2.92 ms; (6) pre-blur's D1b guide uses a 5 % relative
      depth check instead of the plane test; (7) stabilization reuses TA's 2×2 validity
      (`data` keeps it in 4 bits; m shrinks to 8 bits) instead of re-running C-7; (8)
      Catmull-Rom gated on the 4 inner taps (as svgf); (9) neighbourhood validity in R4/R7/
      detector = plane distance at τ_g(A = 0), no normal test — found by recurrent, owner spec-author (SPEC.md §3.5, §5)
- [x] (recurrent-spec, 25c80aa + 1b49e75: 4.44 ms joint, lever table in results/M2-M3.md §4; (d) tiles and branchless taps paid most, (a) became free with tiles, (c) f16 not kept, (b)/(e) not done) Recurrent budget: 2.92 ms diffuse, 5.22 ms diffuse + specular in shared dispatches
      (1080p, M5 Pro, uncontended) vs ≤ 4 ms; skeleton 0.96 ms. Every pass costs 0.33–0.53 ms
      (diffuse) above a 0.04–0.24 ms skeleton; the second signal adds ~75 % (separate kernel
      per signal in R1/R5/R6). Measured levers left: (a) history fix — the mip-repair code
      alone costs 0.24 ms though few pixels run it (register pressure; unrolling didn't
      help): move it to a tile-classified indirect dispatch or into the mips pass; (b)
      fuse prepass into R1 (−0.18); (c) `shader-f16` arithmetic; (d) workgroup-shared tiles
      for the 3×3 neighbourhoods (R2 detector, R4, R7); (e) half-res fast history. Branchless
      taps (all loads in flight) was the biggest single win so far (temporal −0.18, blur
      −0.16 ms) — found by recurrent, owner T2/T3
- [x] (a787b20, recurrent-spec) T3 (recurrent specular) starting point: `src/shaders/recurrent.ts` already handles
      `kind: 'specular'` in every pass (lobe kernel plane R-4 with elongation, f_r / c_h radius
      factors, roughness weight, R-8 surface cap `specCap`, firefly skip below r = 0.25,
      mip-repair start level ρ = r); missing: virtual motion (R-9..R-12, `m` in `data` is
      written as 0), the two-candidate stabilization, specular-specific fast history. Interim
      surface-only recurrent specular is 0.5–3 dB below A-SVGF on the test bed (README) — found by recurrent, owner T3
- [ ] Dev page vs test bed disagree for the recurrent filter: the dev page's direct point
      lights with hard shadows favour SVGF (luminance-weighted à-trous) by ~2 dB, the test
      bed's path-traced GI favours recurrent by ~0.5–1 dB. Tune recurrent on the test bed (or
      captures), sanity-check on the dev page — found by recurrent, owner T1.5 / T3

- [x] (reviewer, `reviews/shadows-provenance.md`) Second review of the shadows PROVENANCE rows marked "yes" (pointers came from
      `sources/shadows-specular.md`, whose author read NRD README prose; the implementer re-read
      M12, H18, RTG1-25 §25.2.1 and TR19 slide 72 directly) — found by shadows, owner a reviewer
      who hasn't read NRD's README. _Done: 6 confirmed, 2 confirmed with a citation correction, none
      unsupported. The same check covers the RTG2-24 source of the recurrent D3b row (still marked "yes")._
- [x] (spec-author, SPEC v0.1 §7, incl. the reviewer's M12 floor / H18 §4.1 corrections) Shadows spec deviations (results/M4.md §7): clamp 0.4σ instead of γ = 1, anti-lag restart
      at A = 0, uniform snap, W_px² history cap, Catmull-Rom on visibility, g = h/(D−h) stored
      instead of W_eff, radius 0.75·W, anisotropy off (measured worse), tiles folded into
      temporal, 40 B/px — found by shadows, owner spec-author (SPEC.md §7)
- [ ] Shadows: first frames after a reset/disocclusion are ~3 dB below FFX (std1080-orbit frame
      0: 31.6 vs 34.8 dB); a wider kernel for young histories lost. Try more taps (or a third
      pass) only where A < 3, or a variance-guided weight there — found by shadows, owner T4 follow-up
- [ ] Shadows cost on penumbra-heavy views (`thin` 0.64 ms vs ≤ 0.6): temporal writes two
      unfiltered r32float copies (T and out) that only inactive tiles need; pass 2 could read the
      history for taps landing in inactive tiles and drop one copy; `shader-f16` — found by shadows, owner T4 follow-up
- [ ] Shadows: directional-light path untested on images (no capture has a directional light);
      add a sun to a test-bed path or a synthetic capture — found by shadows, owner `examples/realtime-denoiser`
- [ ] Shadows section in `packages/denoiser-realtime/README.md` (usage: `new ShadowDenoiser(device)`,
      `dispatch({ visibility, hitDistance, light }, guides, camera)`, options, M4 numbers); not written
      by the shadows agent because the README is being edited by the recurrent agent — found by shadows, owner `packages/denoiser-realtime`
- [x] (orchestrator) Trim `sources/shadows-specular.md` (list with line numbers in `reviews/shadows-provenance.md`
      last section): delete the NRD-README multi-light sentence (l. 582–583, RULES §2), drop the
      "NRD prose says it exists" attribution (l. 573–574), cite M12 §6 for "spread h to lit pixels"
      (l. 246–247), fix the M12 Eq. 13 transcription (l. 110: 1/(kµ) outside the max, floor 1/Ω_x^max)
      — found by shadows provenance reviewer, owner orchestrator (`sources/`)
- [ ] Shadows provenance hygiene (non-blocking): record `maxScaleHistory` = 7, `maxRadius` = 48 px and
      the pass-2 rotation offset 2 − φ as "our design" in PROVENANCE (or tune them); fix the
      `shaders/shadow.ts` comments "floored at one pixel" (M12's floor is 1/(kµ·Ω_x^max), 1 px is ours) and
      the two merged comments on line 58; row SH-6: σ ∝ E is H18 §4.1, not §4.2; optionally cite RTG1-13
      Eq. 11 p.170 as precedent for the raw-only history — found by shadows provenance reviewer, owner shadows
- [x] (recurrent-spec, results/M2-M3.md §2: confirmed in one page — recurrent diffuse 38.44 vs SVGF 39.00 / A-SVGF 39.27, wins 1/7; specular 34.41 vs 34.09 / 35.32; README and T2 updated) **Re-measure recurrent diffuse against today's SVGF defaults, in one page.** The README /
      T2 claim "recurrent beats A-SVGF on 6/7 paths" was measured against `feedback: true` SVGF
      (its SVGF column equals M1's feedback-on numbers). Against M1 §4's `feedback: false` runs
      (same preset: 1080p, 96 frames, blue noise), SVGF wins 6 of 7: recurrent − SVGF = orbit −0.83,
      pan −1.07, light −0.65, thin −0.23, glossy +0.24, cut −0.67, object −0.82 dB (mean 38.42 vs
      39.00; A-SVGF auto 39.27), and SVGF diffuse is cheaper (2.11–2.18 vs 2.92 ms). Confirm with
      `signal=diffuse&mode=eval&preset=full&denoiser=svgf,svgf-auto,recurrent-diffuse` on all 7 paths
      (feedback off is the default now), then update README and T2. Main input to the M2 go/no-go
      (SPEC v0.1 §12 item 1) — found by spec-author, owner T2 / results
- [x] (recurrent-spec: README recurrent section rewritten with the same-page results, 105.5 / 73.5 B/px, 4.44 ms) README (`packages/denoiser-realtime`) stale numbers: recurrent memory is 105.5 B/px both
      signals / 73.5 diffuse since 25c80aa (the prepass skips the depth slope for recurrent-only
      pipelines), not 109.5 / 77.5; joint recurrent is 5.41 ms after 25c80aa, not 5.22 — found by
      spec-author, owner `packages/denoiser-realtime`
- [x] (6fa9274, recurrent-spec) PROVENANCE stale rows (M2 additions, R-4 code column): "taps projected exactly from per-pixel
      clip-space axes (clip = c + kx·P·T + ky·P·B)" — the code uses the affine screen Jacobian since
      1ecc596 (`tapPixel`, `kern{i}` in `src/shaders/recurrent.ts`); "interim recurrent specular …
      virtual motion not implemented" is stale since a787b20; the R-9..R-12 rows have no code column —
      found by spec-author, owner PROVENANCE (second-review agent / T3)
- [x] (8b94f8f, metrics agent; results M4 §9, M1 §11) Pooled PSNR: headline PSNR was the mean of per-frame dB, so
      near-empty frames (up to 120 dB) decided it (`pan` shadows 52.6 dB). Added pooled PSNR (PSNR of the mean
      MSE) and a 60 dB-capped per-frame mean next to it in the test bed, `compare.mjs`, `results-table.mjs`,
      `replay-table.mjs`; re-scored shadows (snap on/off) and diffuse/specular at 1080p. Rank on pooled from now
      on. Findings: uniform snap is −0.06 dB pooled (but −10 % FLIP); ours still beats FFX everywhere live —
      found by spec-author (SPEC §12 item 6c), owner metrics agent

- [ ] Recurrent specular (M3) vs SPEC v0/v0.1, measured deviations for the spec author (1080p
      test bed, specular PSNR glossy / orbit unless noted): (1) curvature correction of the
      virtual distance d_v = h/(1 + 2κh), κ from the 4 axis neighbours (D12c was "later"):
      glossy +1.0 dB (mirrors 30.5 → 32.1); (2) stabilization uses surface motion only — the R7
      virtual candidate (no validity test) cost 0.36–1.5 dB on replays; removing it together with
      storing m·c_v: live orbit 30.37 → 32.23, glossy 33.60 → 34.56; (3) virtual clamp always applied, window γ(1 + 2c_v)σ, γ = 1 (SPEC: lerp
      between a γ = 2 clamp and no clamp by c_v): +0.07 / +0.07; (4) specular current-frame
      detector floor A_fast·f_r and anti-lag / detector mean centred on the pixel's own value as
      r → 0 (μ = lerp(own, 3×3 mean, f_r)): `light` mirrors 34.8 → 40.7 dB, orbit +0.6;
      (5) R_min·f_r for specular, specular R_max 30 px (diffuse 45): +0.1…+0.7 disoccluded;
      (6) virtual taps: plane test against {Xp, np} only, bilinear (Catmull-Rom +0.04 dB for
      0.13 ms); fast luminance follows the blended reprojection, fast ĥ stays surface; the
      detector compares against the blended history; (7) tap counts: post-blur 4 (both),
      pre-blur 4 (specular) — neutral, −0.5 ms; (8) recurrent-only reprojection (linear
      unprojection, plane {Xp, np}, no pairwise normal average; SPEC C-7): neutral, −0.11 ms;
      (9) stabilization history bilinear for diffuse (identical), Catmull-Rom kept for specular.
      Tried and dropped with numbers in results/M2-M3.md §5 — found by recurrent-spec, owner spec-author (SPEC §5.6, §5.11)
- [ ] Recurrent budget left: 4.44 ms joint vs ≤ 4 ms. Measured, not default: `blurTaps: 4` →
      4.05 ms (−0.07 dB diffuse, +5 % flicker); `shader-f16` taps −0.11 ms but −0.2 dB on HDR
      input. Not tried: fold the (now 0.10 ms) prepass into pre-blur; half-res fast history
      (also the memory cut 105.5 → 93.5 B/px); temporal is the largest pass (1.20 ms, of which
      the specular virtual fetch ≈ 0.45) — found by recurrent-spec, owner T2/T3 (whoever continues)
- [ ] Recurrent specular's remaining gap to A-SVGF auto is at mid/high roughness on
      static-camera paths (`light` / `object` r < 0.6: −0.9 / −1.8 dB) and in flicker under motion
      (+15…40 %); ~20 knobs moved it ≤ ±0.2 dB (results/M2-M3.md §5). Candidates not tried: a
      variance-guided (measured, not predicted) luminance weight in the blur, short-history +
      wide spatial mode for r ≥ 0.35 — found by recurrent-spec, owner unassigned

## Probes for the Windows harness

_(black-box questions for native NRD: the capture, the denoiser, what to compare. The
harness builder runs them and returns images/metrics only.)_

- [x] (answered 530c780: **no**. With the capture's moving camera it passes the noisy frame through unchanged; told the camera is static (prev := current) it keeps a plain per-pixel screen-space mean. That mean scores 22.88 / 17.31 / 12.94 vs our `accumulate-static` 25.7 / 18.1 / 13.9 because ours restarts history where the same pixel was sky last frame (horizon moving); verified CPU-side on a fresh `synthetic-plane`: plain mean 22.88 / 17.31 / 12.94, sky-gated 25.66 / 18.13 / 13.86. Not a bug on either side. — orchestrator) **P1: does `REFERENCE` reproject?** Captures: `synthetic-static` and `synthetic-plane`
      (`gen-synthetic.mjs`, see NATIVE-HARNESS phase 3). Run `REFERENCE` on all three
      signals, score with `compare.mjs`. On `synthetic-static` expect last-frame PSNR ≈ 26.5 /
      21.5 / 23.6 dB (diffuse / specular / visibility). On `synthetic-plane`, ours
      (`accumulate`, reprojected) gets 31.7 / 26.4 / 26.4; without reprojection
      (`accumulate-static`) 25.7 / 18.1 / 13.9. Return both tables and a specular strip
      (`preview.mjs --strip specular`). — from capture-io
- [ ] **P2: is native specular low because of input conventions?** On `synthetic-static` /
      `synthetic-plane`, native specular scores 24.6–25.3 dB vs ours 28.7–29.4 (results/M1.md §7),
      while diffuse is on par. Sensitivity runs, specular only, REBLUR and RELAX, scored with
      `compare.mjs`: (a) as now; (b) `specular_hitt` scaled ×0.1 and ×10 before packing; (c)
      roughness forced to 0.3 and to 0.7 everywhere (same in our replay of `svgf-specular`, the
      orchestrator will run ours); (d) REBLUR with hit-distance parameters chosen so the
      normalized hit distance of this capture spans roughly 0.2–0.8. Return the PSNR table and
      the range of normalized hit distance the helper produced in (a). Words/metrics only.
      — orchestrator

## Questions for Dennis

_(only genuine blockers or taste calls; continue with a provisional best guess meanwhile)_

- **Joint default for `filter: 'recurrent'`** (SPEC §12 item 1). Same-page 1080p test bed
  (results/M2-M3.md): diffuse recurrent 38.44 / SVGF 39.00 / A-SVGF auto 39.27 dB; specular
  34.41 / 34.09 / 35.32; joint cost 4.44 (both recurrent) / 4.02 (SVGF) / 5.55 (A-SVGF auto) /
  5.98 ms (today's `filter: 'recurrent'` default = recurrent diffuse + A-SVGF specular, which
  `antiLag: 'auto'` SVGF on both signals beats on quality and cost). Memory 105.5 B/px vs SVGF
  ~132. Provisional: left unchanged; options are SVGF everywhere (cheapest, best diffuse),
  A-SVGF auto (best quality), or recurrent (best memory, budget-closest with `blurTaps: 4`). — recurrent-spec

- **SPEC v0.1 review list.** The taste calls the implementations raised are collected in
  SPEC.md §0.2 (short) and §12 (with numbers). The biggest: M2 go/no-go, since recurrent
  diffuse no longer beats SVGF once SVGF's feedback is off (§12 item 1). — spec-author

- **SVGF feedback default.** The brief and SPEC keep the paper's feedback (à-trous
  iteration 0 → color history) on. Measured on the dev page at 1080p: `feedback: false` is
  +1.1 dB PSNR (40.5 → 41.6 diffuse) with ~4 % more flicker; feedback compounds blur under
  a static camera. Provisional: default stays `true`; recommend `false`. — svgf
  _Measured on the test bed (results/M1.md §4): `feedback: false` wins on all 7 paths
  (+0.6…+2.6 dB diffuse, FLIP −24…−44 %, no flicker cost). Recommendation stands; it is a
  defaults change for the package owner (Found along the way), no taste call left._ — results

