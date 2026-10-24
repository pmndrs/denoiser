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
      marked provisional._
- [x] (4619633) **T0.2 PROVENANCE.md skeleton** (spec author): pass → public source → our deviation.
- [~] testbed **T0.3 Test bed signals** (`examples/realtime-denoiser`): 1-bounce diffuse GI + hitT,
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
- [ ] **T0.6 Wire capture exporter + replay into the test bed** (after T0.3, T0.4).
- [ ] **T0.7 Exit (our side):** a capture written by the test bed replays through our
      replay mode with matching results. _Windows side (native REFERENCE reads it) waits
      for Dennis's machine._

### M1: SVGF + A-SVGF baseline

- [x] svgf (81758c9, ef0c9a9) **T1.1 Shared temporal core**: reprojection (NDC motion + viewZ, 2.5D z when
      present), per-tap plane-distance disocclusion, bilinear / Catmull-Rom history,
      history length, reset.
- [x] svgf (81758c9, ef0c9a9) **T1.2 SVGF diffuse** ported from `ssgiDev` demo 14 with the review's upgrades.
- [~] svgf **T1.3 SVGF specular** (surface reprojection first; roughness-aware weights).
- [x] svgf (see T1.4 commit) **T1.4 A-SVGF** gradient-driven α (from the paper + BSD reference code).
- [ ] **T1.5 Results table** vs references (and vs FFX reflections for specular) on the
      test bed's paths; per-pass ms at 1080p.

### M2–M5 (start after M1 numbers exist; against SPEC v0, provisional until reviewed)

- [ ] **T2 Recurrent diffuse** (pre-blur → temporal → history fix → blur → post-blur →
      stabilization, anti-lag).
- [ ] **T3 Recurrent specular** (virtual motion, lobe kernels).
- [ ] **T4 Shadows** (penumbra-aware, fractional visibility, no blur feedback).
- [ ] **T5 Occlusion** (AO/SO from normalized hit distance).

## Found along the way

_(agents add tasks here: `- [ ] <task> — found by <agent>, owner <path or "unassigned">`)_

- [ ] API additions proposed by SPEC §1.2/§9: `FrameGuides.f0?`, `ShadowInputs.light`
      (capture `lights` fields), options `inputDemodulated` (default true) and
      `output: 'demodulated' | 'remodulated'` (default demodulated), and how
      `DiffuseSpecularDenoiser.dispatch` returns two outputs — found by spec-author, owner
      `packages/denoiser-core/src/temporal.ts` / T0.5
- [ ] Capture format: `*_hitt = 0` means both "miss" and "lobe not sampled"; SPEC C-4 treats
      0 as miss. If probabilistic lobe selection is ever captured, give "not sampled" its
      own value (proposed: negative) — found by spec-author, owner CAPTURE-FORMAT (capture-io)
- [ ] A-SVGF renderer contract (SPEC §4.6 S-8): the test bed's tracer must split primary
      visibility and shading, and re-shade requested pixels at the previous surface point
      with the previous seed — found by spec-author, owner `examples/realtime-denoiser` (T0.3/T1.4)
- [ ] M2 first step: time the 8-pass recurrent skeleton with trivial kernels at 1080p
      (SPEC §10.3 says the 4 ms target is at risk) — found by spec-author, owner T2

- [ ] T0.6 wiring notes: the test bed adds `rtCapture()` from `tools/rt-capture/src/vite-plugin`
      to its Vite config and writes with `CaptureWriter` (`tools/rt-capture/src/writer.ts`);
      set `static: false` when the movable sphere moves; run `validate.mjs` on the result.
      Its Karis 2014 envBRDF matches CAPTURE-FORMAT v0. — found by capture-io, owner `examples/realtime-denoiser`
- [ ] Register the SVGF denoiser(s) in `tools/rt-capture/src/denoisers.ts` (`registerDenoiser`;
      a joint diffuse+specular denoiser implements `ReplayDenoiser` and returns both
      outputs). The replay already fills `guides.viewZ` / `guides.motionZ` when the capture
      has them. — found by capture-io, owner `tools/rt-capture` (any agent may add the entry)

- [ ] T0.6 hook: every test-bed buffer lives in `SceneSignals.textures` (`examples/realtime-denoiser/src/signals.ts`,
      CAPTURE-FORMAT names and formats in its header comment; refs only for signals passed in `refs`,
      `refs=all` renders all three) plus `SceneSignals.frameMeta` (camera, light, movable sphere, reset)
      after each `render()`. Write after `render()` in `runEval`; the light is `frameMeta.light`
      (sphere: pos, radius). — found by testbed, owner T0.6
- [ ] A-SVGF re-shading (SPEC S-8) not built in T0.3: the tracer's 1-spp samples are already
      deterministic per (pixel, `u.frame`, signal salt) (`noisySeed` in `src/scene.ts`), so a
      `reshade` entry that evaluates a forward-projected pixel's sample with frame − 1's seed at
      the current surface point is the missing piece. — found by testbed, owner T1.4
- [ ] Test-bed sampling is white noise (PCG); the renderer contract in `sources/shadows-specular.md`
      asks for blue noise animated per frame. Add a `sampler=bluenoise` option before tuning
      spatial filters on it (provisional until then). — found by testbed, owner `examples/realtime-denoiser`

## Probes for the Windows harness

_(black-box questions for native NRD: the capture, the denoiser, what to compare. The
harness builder runs them and returns images/metrics only.)_

- [ ] **P1: does `REFERENCE` reproject?** Captures: `synthetic-static` and `synthetic-plane`
      (`gen-synthetic.mjs`, see NATIVE-HARNESS phase 3). Run `REFERENCE` on all three
      signals, score with `compare.mjs`. On `synthetic-static` expect last-frame PSNR ≈ 26.5 /
      21.5 / 23.6 dB (diffuse / specular / visibility). On `synthetic-plane`, ours
      (`accumulate`, reprojected) gets 31.7 / 26.4 / 26.4; without reprojection
      (`accumulate-static`) 25.7 / 18.1 / 13.9. Return both tables and a specular strip
      (`preview.mjs --strip specular`). — from capture-io

## Questions for Dennis

_(only genuine blockers or taste calls; continue with a provisional best guess meanwhile)_
