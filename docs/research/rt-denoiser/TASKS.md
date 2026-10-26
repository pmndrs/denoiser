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
9. **New techniques land as options, not as new defaults** (Dennis, 2026-10-25). Anything new (an
   idea from research, a review, a probe, or your own design) goes in behind an option whose default
   keeps today's behavior, with a bit-identical check of the default path. It becomes a default only
   after an A/B on the test bed's 7 paths **and** the real-scene captures (and native where it
   applies) shows no regression beyond: −0.1 dB pooled PSNR, +5 % FLIP, +5 % boil / flicker in any
   region (static, dynamic, penumbra, disoccluded), +10 % cost. **Boil (Dennis q20 (a), 2026-10-26):** a boil
   increase counts as a regression only if the result ends above both the clean (4096-spp) reference's own boil and the
   shipped default's boil in that region; flicker (which compares against the reference's change) is unchanged. Boil
   as Dennis sees it: shadows or detail changing shape and texture frame by frame in an unnatural way (undulating,
   rippling) during an orbit or under a moving object, not the legitimate change of moving content, so prefer
   motion-compensated boil on orbit / moving-occluder sequences. For diffuse, specular and AO, also
   score the A/B against 4096-spp references on `orbit` / `light` / `glossy` (E-1 setup:
   `&refspp=4096&ref2spp=256&ref2salt=0`, results/E1-high-reference.md): the 256-spp references cap
   those signals at 37–42 dB and shrink gaps 2–3×, so a close call there is decided at 4096 spp
   (shadows and SO references are clean enough at 256). Record the A/B in the results doc and
   propose the flip in TASKS; Dennis approves default changes that change the look. "It should be
   better" is not evidence.
10. **Report back** (your final message): what's done (with commit hashes), numbers, what's
   provisional, what's next, and anything a later agent must know.
11. **One heavy GPU job at a time on the Mac** (2026-10-26; two concurrent batches lost the GPU device in E-1). Code,
   docs and short smoke tests (a few frames) may overlap; anything longer (captures, replays of more than one capture,
   4096-spp references, timing) holds the lock: `L=$RT_GPU_LOCK; until mkdir "$L" 2>/dev/null; do sleep 30; done;
   echo "<agent> <task> $(date)" > "$L/owner"; …batch…; rm -rf "$L"` (the orchestrator sets `RT_GPU_LOCK` in your
   brief). Release it between batches so others can interleave; never hold it while you write code. If the owner file is
   older than 3 h and its processes are gone, it's stale: remove it and say so in your report. Timing runs also need
   the GPU otherwise idle, so take the lock and check no other headless Chrome is running.

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
      _v0.2 (2026-10-25 night, spec author): recurrent specular + budget (M3), shadows v2, occlusion
      (M5) and A-SVGF anti-lag v2 folded in; rankings on pooled PSNR; §0 / §10 refreshed; §12 is now
      the single ordered review list (Questions for Dennis below points to it)._
      _v0.4 (2026-10-25 late night, spec author / apply-decisions agent, 8fc3f00): §12 decided by Dennis (all as
      recommended), §0.1 / §0.3 short form, §0.2 / §10.3 native results and the decided targets, §7 v2.1 / v2.2 note._
      _v0.5 (2026-10-26, spec author, 546c777): §7 shadows rewritten as built (v2.2, history §7.0), §7.10 (M8) and §8.5 (M7)
      marked built with as-built deviation tables and measured cost / memory, E-1's 4096-spp gaps in §0.2 / §12 items 1–2,
      T1's options and recovery numbers (§4.3–4.5, §5.8, §0.2, §13), §12 items 15–16 (open: `youngNormalPower: 16`,
      `historyFix: 'spatial'`), §4.5 / §4.6 `antiLag: 'auto'` default, §9 / §10.3 / §11 refreshed._
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
- [x] occlusion (1dd7e70, 826d95a, e56a307, 4915d9a + docs) **T5 Occlusion** (AO/SO from normalized hit distance).
      _Done, provisional (SPEC v0.1 §8 outline): `OcclusionDenoiser` (`src/occlusion.ts`; `filter: 'recurrent'`
      = occlusion-only mode of the recurrent pipeline, kinds `ao`/`so`, radiance WGSL unchanged; `'svgf'` = SVGF on ĥ),
      test-bed signals `ao`/`so` with per-sample-normalized references and a `contact` region, registry
      `occlusion-recurrent|svgf|svgf-auto|radiance-alpha|accumulate-32|noisy`, replay derives ao/so from `*_hitt`.
      1080p, 7 paths, pooled: AO recurrent 38.02 / SVGF 38.93 / A-SVGF auto 39.05 dB, SO 37.37 / 38.76 / 39.52;
      **SVGF wins every path for both signals**; recurrent is the memory-lean option (57.5 vs 84 B/px AO).
      Cost (fastest clock) AO 1.32 / 1.37 / 2.16 ms, AO + SO joint 2.39 / 2.99 / 5.27 ms. The recurrent
      radiance alpha ("free" AO/SO) is 2.9 / 1.9 dB below the dedicated recurrent mode: free in cost,
      not in quality. `results/M5.md`._

### M6 (groundwork)

- [x] m6 (6102f7d, 7e96196 + examples/results commit) **M6 groundwork**: TSL nodes for the realtime classes in `denoiser/three`
      (`realtimeShadows`, `realtimeDiffuse`, `realtimeSpecular`, `realtimeDiffuseSpecular` with `.diffuse` / `.specular`,
      `realtimeOcclusion` incl. `signal: 'both'`; filter stays a class option; optional `viewZ` / `motionZ` guides);
      `TemporalDenoiseNode` gained several outputs and a format-converting output blit (r32float). Pages
      `examples/three-temporal/realtime-shadows.html` (ours vs FFX, split) and `realtime-gi.html` (joint diffuse + SSR
      specular + AO, vs raw / FFX reflections), runner `run-realtime.mjs`; listed with `deployed: false`. First real-scene
      numbers (`results/M6-real-scene.md`, static camera vs 4096-ray reference): shadows ours 31.7 / 31.7 dB vs FFX
      28.5 / 26.2 (wide / close, 960 px, blue noise; penumbra +5…6 dB, FLIP halved); same ranking at 1080p and with white
      noise (+2.1…3.9 dB). Experimental / provisional. Left: docs page (below), moving-camera reference (below).

## Found along the way

_(agents add tasks here: `- [ ] <task> — found by <agent>, owner <path or "unassigned">`)_

- [ ] **SVGF: option to switch off the 3×3 history fallback** (SVGF §4.1, "for thin geometry"). With it off, SVGF's
      disocclusion detection matches the strict plane test (interior misses 20.7 → 0.1 ‰ vs exact GT, wrong-surface
      misses ~0 either way), and `svgf-auto` gains **+0.07…+0.34 dB on the disoccluded region** of `orbit`, `pan`,
      `thin`, `cut`, `object` (diffuse and specular, 960×540, 256-spp refs; total +0.004…+0.035 dB; flicker unchanged),
      `thin` included (results/UPSCALER-GUIDES.md §4). Land as an option (default keeps the fallback), then the rule-9
      A/B: 1080p × 7 paths, captures, 4096-spp references on orbit / light / glossy. Then also try the stricter variant (reset when < half the bilinear weight is valid, `r.sumW > 0.5`: resets the silhouette band the mask adds) against fallback-off; the scratch run was dropped for GPU-lock time. — found by
      upscaler-guides evaluator, owner unassigned (packages/denoiser-realtime svgf)
- [ ] **Recurrent / shadows: wrong-surface history at a moving object's contact.** On `object` our plane test (no
      normal test) keeps history from another surface for 3.7–3.9 % of the revealed pixels that have no same-object
      texel nearby (1080p; glossy 0.4 %, other paths ~0); SVGF's normal test (cos 0.95) catches them (0.0 %).
      Candidate: a loose normal-agreement test for recurrent / shadows, measured on `object` and the captures.
      (results/UPSCALER-GUIDES.md §2) — found by upscaler-guides evaluator, owner unassigned
- [ ] **SVGF's normal test resets visible pixels on real geometry.** Against exact GT on the Bistro / Sponza captures,
      SVGF's resets have 39.7 % precision pooled (Bistro 4.6–46 %): the cos 0.95 normal test rejects the same surface
      on dense, finely tessellated geometry; the plane test alone gives 88.6 %. Sweep `normalThreshold` on the captures
      (needless resets = young-pixel noise). (results/UPSCALER-GUIDES.md §3) — found by upscaler-guides evaluator,
      owner unassigned

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

- [x] (8911a08, testbed-v1: `frames[i].lights` is part of v1) CAPTURE-FORMAT v1: per-frame lights. Test-bed captures move/resize the light (path
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
- [x] svgf-antilag (5eb75d4, f16ffcd + docs) **A-SVGF anti-lag v2**: diagnose and fix the `'auto'` history cap (below), re-check α_min per
      signal, cut the +2.1 ms of `'auto'` (target within ~1 ms of `'off'`), results in `results/M1.md`
      §12 — owner svgf-antilag agent. _Done, provisional: root cause = S3's variance propagation
      treats à-trous taps as independent (noise floor σ ~4.5× too low → λ > 0 on ~85 % of static
      pixels) and n = 1/α compounding (persistent λ caps n at 1/√λ ≈ 14). v2: noise floor from the
      composite kernel (ΣK² ≈ 1/(4πv)), per-signal k (diffuse 2, specular 1), one reprojection per
      stratum, packed f16, 4 iterations, 3×3 young-history variance for specular. Pooled, 7 paths:
      diffuse 39.12 (v1 39.13, off 38.88), specular 35.04 (v1 34.96, off 33.46); static diffuse n
      p50 36–43 (v1 13); light recovery 4 / 3 frames (off 5 / 8); joint 4.24 ms vs off 3.99 (v1 5.61),
      solo bench uncontended round. α_min with 'auto': keep 0.1 for both signals._
- [x] (decided by Dennis 2026-10-25, SPEC §12 item 2; flipped in 64a1123) **Proposal (Dennis decides, SPEC §12 item 2): make `antiLag: 'auto'` the SVGF default.** With
      v2 it costs +0.25 ms on the joint denoiser at 1080p (4.24 vs 3.99 ms) for +0.24 dB diffuse and
      +1.58 dB specular pooled (7 paths), lower FLIP (0.033 / 0.046 vs 0.036 / 0.051) and flicker,
      and 3-frame light recovery for specular (off: 8). It also fixes `'off'`'s specular lag on
      `glossy` (+3.8 dB). Memory +4 B/px per signal. The default flip is a one-line change in
      `src/svgf.ts` `resolveOptions` (`antiLag ?? 'auto'`), plus README/SPEC — found by svgf-antilag, owner Dennis
- [x] (svgf-antilag, 5eb75d4; results/M1.md §12) A-SVGF `antiLag: 'auto'` makes α_min ≤ 0.1 inert: 0.05 and 0.1 give identical output
      (≤ 0.02 dB) on orbit/pan/light, i.e. λ keeps 1/n ≥ ~0.1 everywhere, so histories never
      exceed ~10 frames even on static, unchanged regions (`light` before frame 48). Check
      the λ noise floor (`antiLagNoiseFloor`, default 2) on static regions; longer histories
      there would cut residual noise. Repro: `signal=diffuse&mode=eval&preset=full&denoiser=svgf-auto&path=light&temporalAlpha=0.05`
      vs `...&temporalAlpha=0.1` (same numbers); try `&antiLagNoiseFloor=3`. — found by results, owner `packages/denoiser-realtime`
- [~] (svgf-antilag: with anti-lag v2 the specular young-history estimate is 3×3, joint variance 1.10 → 0.51 ms; cause = many specular pixels with n < 4 under motion take the 7×7/5×5 spatial path) Specular `variance` pass is 0.66 ms at 1080p (0.95 with anti-lag) vs 0.23 for diffuse
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
- [x] (shadows-v2, 72abd13; results/M4.md §10: std1080-orbit 35.42 vs FFX 35.40, frame 0 34.3 vs 34.8, disoccluded 34.68 vs 32.91 live) Shadows: first frames after a reset/disocclusion are ~3 dB below FFX (std1080-orbit frame
      0: 31.6 vs 34.8 dB); a wider kernel for young histories lost. Try more taps (or a third
      pass) only where A < 3, or a variance-guided weight there — found by shadows, owner T4 follow-up
- [x] (shadows-v2, M4 §10.4: `thin` 0.59 ms fastest, same as v1 within noise; pass 0 reads the r32float copy; one-copy and f16 not done, reasons there) Shadows cost on penumbra-heavy views (`thin` 0.64 ms vs ≤ 0.6): temporal writes two
      unfiltered r32float copies (T and out) that only inactive tiles need; pass 2 could read the
      history for taps landing in inactive tiles and drop one copy; `shader-f16` — found by shadows, owner T4 follow-up
- [~] (shadows-v2, 67bcfd6, M4 §10.7: stand-in test `sh.light=directional` behaves; a real sun capture is still open, owner `examples/realtime-denoiser`) Shadows: directional-light path untested on images (no capture has a directional light);
      add a sun to a test-bed path or a synthetic capture — found by shadows, owner `examples/realtime-denoiser`
- [x] (shadows-v2, 808177e) Shadows section in `packages/denoiser-realtime/README.md` (usage: `new ShadowDenoiser(device)`,
      `dispatch({ visibility, hitDistance, light }, guides, camera)`, options, M4 numbers); not written
      by the shadows agent because the README is being edited by the recurrent agent — found by shadows, owner `packages/denoiser-realtime`
- [x] (orchestrator) Trim `sources/shadows-specular.md` (list with line numbers in `reviews/shadows-provenance.md`
      last section): delete the NRD-README multi-light sentence (l. 582–583, RULES §2), drop the
      "NRD prose says it exists" attribution (l. 573–574), cite M12 §6 for "spread h to lit pixels"
      (l. 246–247), fix the M12 Eq. 13 transcription (l. 110: 1/(kµ) outside the max, floor 1/Ω_x^max)
      — found by shadows provenance reviewer, owner orchestrator (`sources/`)
- [x] (shadows-v2, 03679f9, M4 §10.6: all three measured flat, rationale recorded; comments fixed in 72abd13) Shadows provenance hygiene (non-blocking): record `maxScaleHistory` = 7, `maxRadius` = 48 px and
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

- [x] (spec-author, SPEC v0.2 §5.1, §5.4, §5.6, §5.9–5.12, §6) Recurrent specular (M3) vs SPEC v0/v0.1, measured deviations for the spec author (1080p
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
- [x] shadows-v2 (shadows agent, 2026-10-25 night; 72abd13, 090db19, 67bcfd6, 55d0827, c6734c6, 808177e, 03679f9):
      provisional (SPEC not reviewed). New defaults: kernel radius = mean of the occluder-sized and the
      H18 noise-sized radius (`noiseBlend` 0.5, `noiseRadius` 32), geometry-weighted 5×5 mean in the
      spatial input of fresh pixels (`youngMean` 0.75, `youngSpan` 1). 1080p live, 7 paths, pooled:
      37.11 / penumbra 28.57 / disoccluded 34.68 (v1 36.55 / 28.11 / 33.19; FFX 31.20 / 23.50 / 32.91);
      0.48–0.59 ms (FFX 0.50–0.61). Uniform snap kept on (FLIP), but off is now +0.18 dB pooled
      (§10.5, taste call). Gaps: std1080-orbit frames 0–2 still 0.2–0.5 dB below FFX; `light` −0.10
      vs v1 — owner shadows
- [x] (spec-author, SPEC v0.2 §7.4–7.9, §12 items 5 and the dropped-items note) SPEC §7 v2 deviations (results/M4.md §10): SH-5 radius = ½ occluder-sized + ½ H18-sized (E in
      the geometry byte), SH-4 fresh-pixel 5×5 mean in the spatial input (A = 0 only), pass 0 reads the
      unfiltered r32float copy, `uniformSnap: 'change'` option, the three constants' rationale; §12
      item 6 numbers (6a mostly resolved, 6b at target, 6c snap now costs −0.18 dB) — found by shadows,
      owner spec-author (SPEC.md §7, §12)
- [ ] Shadows: a real directional-light (sun) path or capture in the test bed (today only the
      `sh.light=directional` stand-in, M4 §10.7) — found by shadows, owner `examples/realtime-denoiser`

- [x] (spec-author, SPEC v0.2 §8 rewritten as built, §10, §12 items 1 and 6) Occlusion (M5) vs SPEC v0.1 §8, deviations for the spec author (fast test bed, 7 paths, mean pooled
      PSNR AO / SO; results/M5.md §4): (1) O-2 packing: one **r32float per signal** instead of one rgba16float
      (ĥ_d, ĥ_s) pool (r16float / rg16float are not core storage formats; same 8 B/px for two signals, 4 for
      one; r32float is unfilterable, so the history's Catmull-Rom uses 16 `textureLoad`s): 57.5 / 73.5 B/px
      measured vs ≈ 62 estimated; (2) **no pre-blur pass**: the temporal pass normalizes the raw hit distance on
      load (7 dispatches; ĥ is never pre-blurred anyway); (3) the history-fix fast window **clamps the slow ĥ**
      (radiance only shortens A from ĥ): +0.85 / +0.35 dB; (4) **SO: the fast ĥ follows the virtual fetch** by
      m·c_v (the radiance filter keeps it surface-reprojected): SO +0.9 dB, `pan` +2.5; (5) AO R_max 20 px
      (§8 said radii unchanged = 45), R_min 2 px for both: +0.35 dB AO, contact +1.3; (6) **O-3 not adopted**:
      h_scale stays a + b·d (1, 0.05) so the occlusion signal is the radiance filter's ĥ (`hitDistanceViewScale: 0`
      gives O-3's world-space radius); (7) **SVGF added** as an occlusion filter (σ_l 1.5, 3 iterations, SO
      α_min 0.3; the radiance defaults lose 0.5 / 1.8 dB at 1080p), and it beats the recurrent mode on every
      path; (8) O-1 measured: the radiance alpha is a usable preview only (−2.9 / −1.9 dB vs the dedicated
      recurrent mode); (9) O-4 not built. Default filter stays `'recurrent'` (SPEC) pending Dennis (question
      below) — found by occlusion, owner spec-author (SPEC §8)
- [ ] Recurrent occlusion-only mode is only ~35 % cheaper than recurrent radiance diffuse (1.32 vs 2.02 ms
      at 1080p): geometry taps dominate. Untried levers: bilinear history instead of the 16-load Catmull-Rom
      (temporal 0.47 ms), 4-tap blur, fast history as r32float for a single signal (−8 B/px) — found by
      occlusion, owner whoever continues M5
- [ ] Windows harness / native occlusion: no new capture buffer (ao/so are derived from `*_hitt`), so the
      harness feeds `diffuse_hitt` / `specular_hitt` through native's own hit-distance normalization helper
      with its own parameters. Native's normalized AO is then on a different curve than our test-bed
      references (h/(h + 1 + 0.05·d), per-sample mean), so PSNR against our references is not a fair
      comparison until probe P3 returns native's curve — found by occlusion, owner harness builder (report only)

- [x] (spec-author, SPEC v0.2 §4.1–4.6, §10, §12 item 2) SPEC deviations from anti-lag v2 (results/M1.md §12; for the spec author, SPEC §4.6 S-7b, §4.3,
      §4.5, §10.2, §10.3, §12 item 2): (1) λ's noise floor uses var δ × ΣK² of the composite
      reconstruction kernel (ΣK² ≈ 1/(4πv), v tracked through the iterations) instead of S3's Σw²var/(Σw)²
      (which made 'auto' cap histories at ~13 frames); (2) per-signal floor k: diffuse 2, specular 1
      (`antiLagNoiseFloor` −1 = per signal); (3) gradient samples from one reprojection per stratum (4
      bilinear history taps) instead of per-pixel reprojection; (4) gradient state 8 × f16 in one
      rgba32uint, anti-lag memory 4 B/px per signal (was ~7.6); (5) `gradientIterations` default 4 (S2: 5;
      measured equal); (6) new `spatialVarianceRadius` (S-2's 7×7/5×5 cap), default 1 for specular when
      anti-lag is on (+0.07 dB, variance 1.10 → 0.51 ms); (7) `antiLagVersion: 1 | 2`; (8) cost numbers:
      'auto' is +0.25 ms joint (4.24 vs 3.99, solo bench), not +2.1 ms; the M1 §6 joint replay numbers
      (6.31 / 4.20) overweight young histories (8-frame capture). `'gradient'` mode uses the same v2
      reconstruction, unmeasured (no producer) — found by svgf-antilag, owner spec-author
- [ ] `'off'` specular could use `spatialVarianceRadius: 1` too: +0.03 dB pooled (33.46 → 33.49) and a
      cheaper variance pass. Not changed (keeps `'off'` bit-identical); a defaults call — found by
      svgf-antilag, owner `packages/denoiser-realtime` / Dennis
- [ ] Joint SVGF timings: `std1080-orbit` has 8 frames, so a warmed replay times frames where every
      pixel is younger than 4 frames (spatial-variance path); use the test-bed solo bench (orbit, 100
      frames) or a longer capture for cost tables — found by svgf-antilag, owner results / rt-capture

- [x] (remeasure, results/REMEASURE-2026-10-25.md, package at 7782074; comments dda6596) **remeasure**: the SPEC v0.2
      re-measure items below in one pass at 1080p, 7 paths, one page per comparison, pinned to HEAD of
      `packages/denoiser-realtime` (joint diffuse + specular incl. the `filter: 'recurrent'` hybrid with anti-lag v2,
      occlusion with v2, shadows `uniformSnap` true / `'change'` / false, solo ms), the `recurrent.ts` stale-comment
      fix; SPEC §0.2 numbers updated. Findings: hybrid 38.26 / 35.04 dB at **4.79 ms** (was 5.98, v1 / dev page),
      still dominated by `svgf-auto` (39.12 / 35.04, 4.23 ms); on the same test-bed bench **recurrent joint 3.99 ms
      = SVGF `'off'` 4.00** (dev page 4.44); occlusion A-SVGF v2 AO 39.03 / SO 39.68 dB, AO 1.67 / SO 1.61 ms
      fastest frame (v1 2.16 / 2.53), joint 3.10 ms median, 88 / 156 B/px; shadows `'change'` 37.23 / 28.75 /
      FLIP 0.0186 between on 37.11 / 28.57 / 0.0182 and off 37.29 / 28.88 / 0.0198
- [x] (remeasure, REMEASURE-2026-10-25 §2–3) Re-measure the rows that still ran A-SVGF anti-lag **v1**: occlusion `occlusion-svgf-auto`
      (results/M5.md, AO / SO quality, cost, memory 92 / 163 → expected 88 / 156 B/px) and the joint
      `filter: 'recurrent'` hybrid (recurrent diffuse + A-SVGF specular, 5.98 ms in M2-M3 §4). SPEC v0.2
      §0.2 / §10.3 quote them as v1 — found by spec-author, owner results / occlusion
- [x] (remeasure, REMEASURE-2026-10-25 §4: `'change'` keeps 3/4 of the snap's FLIP gain and 2/3 of off's PSNR; default not changed) Shadows `uniformSnap: 'change'` at 1080p, 7 paths (pooled, penumbra, FLIP per path; it was only
      measured at 960×540, M4 §10.5). SPEC v0.2 §12 item 5 recommends `'change'` pending this run —
      found by spec-author, owner shadows / results
- [x] (remeasure, dda6596: WGSL identical modulo comments over 96 pass variants) Stale comments in `packages/denoiser-realtime/src/shaders/recurrent.ts`: `mVirt` (l. ~549, ~744)
      is described as "for stabilization", but no pass reads the `m·c_v` bits since the R7 virtual
      candidate was removed (SPEC v0.2 §5.11–5.12). Behaviour matches SPEC; comments only — found by
      spec-author, owner `packages/denoiser-realtime`
- [ ] (Dennis picked SPEC §12 item 4 (a), plus (c) "if it measures clean": so this is now an open, optional task; land it as an option and A/B it per rule 9) SVGF output aliasing: let the last à-trous iteration
      write into the ping-pong target instead of a separate `out` texture (−8 B/px per signal, 132 →
      124; output valid until the next dispatch, as recurrent's already is). Untested proposal; check
      that nothing reads the ping buffer after the last iteration — found by spec-author, owner
      `packages/denoiser-realtime`
- [x] (orchestrator: §0.3, §10.3, §12 items 1 and 3 updated to the bench medians) SPEC numbers outside §0.2 still quote the pre-remeasure values: §0.3 item 3 ("A-SVGF auto 4.24 passes,
      recurrent 4.44 borderline"), §10.3 (hybrid 5.98 ms v1, occlusion A-SVGF v1 ms / B/px), §12 items 1, 3, 5
      (hybrid cost, recurrent joint cost: 3.99 ms on the test-bed bench vs 4.44 on the dev page, snap evidence now
      at 1080p). Numbers in results/REMEASURE-2026-10-25.md — found by remeasure, owner spec-author
- [ ] The recurrent filter's cost depends on the bench scene: dev page 4.44 ms vs test-bed solo bench 3.99 ms
      (every pass 7–18 % higher on the dev page), while SVGF reads the same on both (4.02 / 4.00). The README /
      M2-M3 §4 budget table is on the dev page; re-time recurrent levers on the test-bed bench before citing
      them against SVGF — found by remeasure, owner `packages/denoiser-realtime` README / results

- [x] (shadows-reset, ff04c8a; results/M4.md §11: frame 2 now above frame 1 overall in all 4 real-scene configs, +0.23 … +0.42 dB, was −0.73 … −1.24; 1080p 7 paths 38.12 / 29.05 / FLIP 0.0129 vs v2 37.11 / 28.57 / 0.0182; reset windows +1.40 std540 mean, +1.22 std1080-orbit; cost +0.07 … 0.14 ms, see the follow-up) ShadowDenoiser frame 2 after a reset is worse than frame 1 on the real scene in every configuration (−0.8 … −1.3 dB
      overall, −1.0 … −2.2 dB penumbra; FFX ahead at frame 2 on the wide shot). Repro: `examples/three-temporal`
      `node run-realtime.mjs shadows --metrics --metrics-only` (rows f1 / f2), results/M6-real-scene.md — found by m6,
      owner `packages/denoiser-realtime` (shadows)
- [x] (SPEC v0.4: Dennis set the shadows cost target to ~0.75 ms, q05; v2.2 0.55–0.72 ms meets it) Shadows v2.1 cost: the normal-tested clamp window adds +0.07 … 0.14 ms at 1080p (temporal 0.32–0.37 → 0.42–0.47 ms;
      totals 0.58–0.69, over the ≤ 0.6 target on 5 of 7 paths; FFX 0.51–0.63) for +1.0 dB pooled / −29 % FLIP. Lever:
      `clampGeometry: false` (v2's cost, −1 dB). Fold into SPEC §12 (cost item) — found by shadows-reset, owner spec-author
- [x] (spec-author, 546c777: SPEC v0.5 §7 rewritten as built (§7.0 history, §7.4 pseudo-code and parameter table, §0.2, §10.3); v0.4 note 8fc3f00) SPEC §7 / §0.2 shadows rows for v2.1 (results/M4.md §11): clamp window over normal-tested 5×5 taps (`clampGeometry`,
      `clampMinTaps` 3), hard-edge widening (`clampEdgePx` 2), young mean over 8 frames (`youngFrames` 8, `youngTaper`
      0.25, replaces `youngSpan`; "which pixels count as fresh" row: a frame counter since the pixel was new, not A), new
      1080p / reset-window numbers — found by shadows-reset, owner spec-author
- [x] (spec-author, 8f578d0: the options list was already current; SPEC pointer, v2.2 per-pass ms, 20 B per tile, the ~0.75 ms target and a `uniformSnap` note fixed) `packages/denoiser-realtime/README.md` shadows section: `youngSpan` [1] is gone (now `youngFrames` [8], `youngTaper`
      [0.25]); add `clampGeometry` [true], `clampMinTaps` [3], `clampEdgePx` [2]; the 1080p numbers / costs there are v2's
      (results/M4.md §11.3, §11.6) — found by shadows-reset, owner `packages/denoiser-realtime` README
- [ ] Shadows: anti-lag restarts in static penumbrae cost a −0.15 … −0.3 dB step at frame 5 on the real scene (v2 and
      v2.1; `antiLag: 0` is monotone) and keep static scenes below what the history could give (clamp off: 33.6 vs
      32.3 dB at frame 8, wide). Candidate: a window that also counts the history's own uncertainty,
      σ·√(1/(A+1) + 1/25); risk: lag on moving shadows (screen on the 96-frame paths) — found by shadows-reset, owner shadows
- [ ] Shadows: a plane-distance test on top of the normal test in the clamp window measured 0 dB on the test bed but
      +0.06 … 0.28 dB on the real scene (frame 16), for ~0.05–0.1 ms; revisit if the real scene becomes a tuning scene
      (SPEC §12 item 7) — found by shadows-reset, owner shadows
- [x] (real-scene-motion, commits: three-temporal + results) Real-scene moving-camera numbers: scripted 64-frame camera
      path (`src/realtime/path.ts`, slow orbit + fast pan, `?path=orbit` on both realtime pages); `realtime-gi.html?path=orbit&ref=1`
      writes CAPTURE-FORMAT v0 captures with a converged reference per pose (`node run-realtime.mjs capture --set=moving`:
      `three-orbit` 40 f, `three-pan` 32 f, 960×540, validated; AO ref as extra `ao_ref`); replayed through the registry
      (`replay-captures.mjs`) and scored (`score-captures.mjs`, + FLIP and AO). Rankings match the test bed for shadows
      (ours +3.7 / +2.4 dB over FFX), diffuse and AO; specular swaps plain SVGF and recurrent (SVGF +1.3 / +1.8 dB on SSR
      input). results/M6-real-scene.md "Moving camera", examples/three-temporal/CAPTURES.md — found by m6
- [ ] Real-scene captures: a BVH-traced specular signal (demodulated, true hit distance) in the capture mode instead of
      SSR, so the specular SVGF-vs-recurrent swap on `three-orbit` / `three-pan` can be told apart from SSR's input
      (results/M6-real-scene.md "Moving camera") — found by real-scene-motion, owner `examples/three-temporal`
- [ ] Native NRD replay of `three-orbit` / `three-pan` (Windows harness; specular is not demodulated, AO reference is
      the extra `ao_ref` buffer, light is the equal-area sphere of a rectangular panel: examples/three-temporal/CAPTURES.md)
      — found by real-scene-motion, owner harness builder
- [x] (m6-docs, `docs/site/guides/realtime-denoisers.mdx`, nav 27.5 after the FFX page; listed in `docs/README.md`) M6 docs
      page for `denoiser/realtime` + the `denoiser/three` realtime nodes (PLAN §7 M6; the guides live under
      `pmndrs.github.io/denoiser/docs/guides/`). Marked experimental, documents today's class defaults; every snippet
      type-checked against the built packages; MDX compiles (mdx-js 3 + GFM; the pmndrs docs image was not run, Docker
      was down). Examples referenced as local only (`deployed: false` unchanged) — found by m6, done by m6-docs
- [x] (apply-decisions, c9c8022: default rows, occlusion default note, cost table, renamed options and "Against NVIDIA NRD"
      with the native phases 4–5 numbers done; the deploy part is moot for now: Dennis decided the pages stay local, q09)
      Docs page upkeep (`docs/site/guides/realtime-denoisers.mdx`): when Dennis decides SPEC §12 items 1 / 2 / 5 (default
      filter per signal, `antiLag` default, `uniformSnap`), update the "today's default" rows, the occlusion default note
      and the cost table; when the native replay of the test-bed / three.js captures lands, fill "Against NVIDIA NRD"
      (comparison context only, RULES §6); when the realtime pages deploy, switch their links to live URLs and add them
      to `docs/site/examples/index.mdx` — found by m6-docs, owner docs
- [x] (api-fixes, a5ed52e: constructor writes a 1, b 0.05, far ∞; `encode()` documented `@internal` (the build has no
      `stripInternal`, so it stays in the .d.ts); OcclusionDenoiser output byte-identical on an occlusion-svgf replay;
      docs page + README updated) API (awkward to document): `HitDistanceNormalizer` has no default curve. Its params buffer starts zeroed, so every
      hit normalizes to ĥ = 1 until `setCurve()` is called; default it to the denoiser's (a 1, b 0.05, far ∞) in the
      constructor. Its public `encode()` also takes the internal `PassTimer` and a `'geo'` depth mode that only the
      package can produce: mark it `@internal` — found by m6-docs, owner `packages/denoiser-realtime`
- [x] (decided q10; recurrent `historyAntiLag` 6be4f23, shadows `antiLagGain` 255a06a; old names warn once per instance) API (awkward to document): `antiLag` means three things: SVGF `'off' | 'auto' | 'gradient'`, recurrent a boolean,
      `ShadowDenoiser` a number (a gain, default 64). Rename the boolean / numeric ones before the API leaves experimental
      (e.g. `historyAntiLag`, `antiLagGain`) — found by m6-docs, owner spec-author (SPEC §12 "API items") / Dennis
- [x] (api-fixes, a5ed52e: overloads by `denoiser.signal`: 'both' → `TwoOutputNodeObject`, one signal →
      `OcclusionNodeObject<'diffuse' | 'specular'>` (new export), non-literal signal → union; three-temporal and the docs
      snippets type-check) API: `realtimeOcclusion()` returns `TwoOutputNodeObject` for a single signal too, so `.specular` type-checks on an
      AO-only node but is no output (only the active signal's getter is defined; what three's node proxy returns for it is
      untested). Narrow the return type by
      `signal` (overloads) — found by m6-docs, owner `packages/denoiser-three`
- [ ] three-temporal realtime pages: per-pass ms on the light realtime-shadows page read 2–3× the test bed (slow GPU clock);
      the same ShadowDenoiser reads 0.59 ms at 1080p on the busier GI page (test bed 0.55). For cost tables use the
      split view (same clock for both) or a busier page — found by m6, owner any agent (FYI)
- [x] (decided by Dennis 2026-10-25, q09: they stay local, `deployed: false`; SPEC §12 header) Deploying the experimental realtime pages (question for Dennis, one line for SPEC §12 "API items"):
      `three-temporal/realtime-shadows.html` / `realtime-gi.html` are in `examples/_shared/examples.json` with
      `deployed: false` (local `yarn examples` only) and in the three-temporal Vite build; flip `deployed` + add a shot when
      `denoiser/realtime` should show on the site — found by m6, owner spec-author (fold into SPEC §12) / Dennis

- [x] (e1, results/E1-high-reference.md; test bed d256615) **E-1 high-reference re-score** (SPEC §13): re-score the top filters on 2–3 test-bed paths
      against 2048–4096-spp references, plus the reference noise floor. — orchestrator, owner: eval agent
- [x] (spec-author, 546c777: §0.2 4096-spp table and central finding, §12 items 1–2, §4.6, §13 note; the leftovers below stay open) Fold E-1 into SPEC §0.2 / §12 items 1–2: quote the 4096-spp gaps (recurrent vs A-SVGF `auto` diffuse −2.51 dB on 5
      paths, AO −2.33 on 7, specular −1.91; `antiLag: 'auto'` vs `'off'` diffuse +0.93, specular +2.81) next to the 256-spp
      ones, and the 256-spp ceilings (diffuse 41.7, specular 36.9 dB) in §13. No recommendation flips. results/E1-high-reference.md
      — found by e1, owner spec-author
- [x] (e1b, results/E1b-high-reference.md §1; snapshot 7ea3928, 256-spp scores = REMEASURE to the 4th decimal: no ranking change; 7 paths diffuse recurrent vs `auto` −0.86 → −2.39 dB, SVGF vs `auto` −0.24 → −0.86, specular −0.94 → −1.81 / −1.59 → −2.63; `thin`'s diffuse reference is noisy even at 4096 spp: floor 41.4 dB, ceiling 44.4, `auto` 41.9 measured vs 45.6 "true") E-1 leftovers: diffuse / specular on `thin` and `cut` at 4096 spp (both pages lost the GPU device under another agent's
      2048-spp captures; rerun on a quiet GPU, ~10 min each), and 4096-spp floors on those paths — found by e1, owner eval agent
- [ ] SPEC §0.2 / §12 items 1–2 quote E-1's 5-path 4096 gaps; the 7-path values are in results/E1b-high-reference.md §1.3
      (recurrent vs `auto` diffuse −2.51 → −2.39, specular −1.91 → −1.81; `antiLag: 'auto'` vs `'off'` diffuse +0.93 → +0.86,
      specular +2.81 → +2.63). `thin` diffuse needs the "true" column or a 16k-spp reference for any close call. — found by
      e1b, owner spec-author
- [x] (e2, results/E2-oidn-baseline.md, HEAD 7a8b980 pinned; offline `oidn` / `oidn-default` replay entries in tools/rt-capture: with history our filters beat OIDN high on the test bed on every signal and tie it on the real scene except shadows (OIDN +0.7 dB PSNR, worse FLIP/penumbra); OIDN flickers 1.1–2.9× ours; 205–239 ms per signal at 1080p) **E-2 OIDN baseline** (SPEC §13): OIDN 2 single-frame per signal on the standard captures,
      scored like the others. — orchestrator, owner: oidn agent
- [x] (moving-shadows, d02613d e573a04 033a869 + docs commit; results/M4.md §12) **moving-shadows**: the rotating knot's shadow
      boiled with ours. Measured: knot captures `three-knot-static` / `-orbit` / `-still` (control), dynamic-region and boil
      metrics (compare.mjs, test bed). Cause: wide soft penumbrae boil whether the knot moves or not (anti-lag restarts in
      static penumbrae, per-frame kernel rotation, raw-history update). Fix v2.2: output stabilization pass (RTG II §49.5.7),
      box-gated, clamp-distance anti-lag: knot-shadow boil 0.0062 → 0.0013 (FFX 0.0011); 1080p 7 paths 38.12 → 38.22 /
      penumbra +0.11 / flicker −11 %; `light` −0.19; +0.03…0.05 ms (0.55–0.72 ms), 48 B/px
- [x] (spec-author, 546c777: §7.5 SH-5b stabilization with its parameter table, §7.8 memory / per-pass cost, §0.2, §10.3) SPEC §7 / §0.2 shadows rows for v2.2 (results/M4.md §12): the stabilization pass (`stabilize` 0.25, `stabilizeBox`
      0.05 @1080p, `stabilizeAntiLag` 64), 48 B/px, the 1080p / capture numbers; §10.3 memory and cost rows — found by
      moving-shadows, owner spec-author
- [ ] Shadows v2.2 leftovers (results/M4.md §12.7): `light` −0.19 dB (stabilizer lag while the light orbits / after the
      flip; `stabilizeBox` 0.03 or a higher anti-lag gain untested at 1080p); `thin` at 0.72 ms; dynamic-region flicker
      +2.5 % over FFX on the 16-frame std540-object replay. The anti-lag v3 candidates (MegaLights p.35 etc.) should be
      measured with the knot captures' boil and the frozen control, not only the dynamic region — found by moving-shadows,
      owner shadows
- [ ] Native SIGMA on `three-knot-static` / `three-knot-still` (Windows harness): compare boil (compare.mjs) — the
      captures carry object motion for the knot (`static: false`) — found by moving-shadows, owner harness builder
- [ ] OIDN LDR route on 1-spp scalars brightens dark regions (E2-oidn-baseline "Inputs": shadows 19.3 vs 30.3 dB via
      HDR weights on std540-orbit, AO no better than noisy; an umbra at 0.11 came out 0.77). Check `Denoiser.denoiseTextures({ hdr: false })`
      on a float binary-dither image against native `oidnDenoise` (LDR, srgb on/off): LDR network behaviour, or the
      package's LDR texture path (float inputs skip the sRGB transfer upstream applies to linear LDR)? The E-2 adapter
      routes scalars through the HDR weights meanwhile — found by e2, owner: OIDN package (`packages/denoiser-core`)
- [ ] OIDN 3 real-time model (PLAN §1): when it lands in `denoiser/realtime`, register it in `tools/rt-capture` beside
      `oidn` and score it on the E-2 captures/table (bar: A-SVGF with history, flicker ≤ ~0.004–0.006) — found by e2, owner unassigned
- [x] release audit → sources/nrd-releases.md (release auditor, rule 3b)
- [x] public research 2022–2026 → sources/nrd-public-2022-2026.md
- [x] change-magnitude audit → sources/nrd-change-magnitude.md (change auditor, rule 3c)
- [ ] Shadows anti-lag v3 candidates from public sources (`sources/nrd-public-2022-2026.md`): shorten
      history in proportion to how far it sits outside the clamp box, never to zero (MegaLights
      SIGGRAPH 2025 p.35); Philippi et al. EGSR 2023 noise-vs-bias blend weight (CC BY); AMD GI-1.0
      asymmetric darken-fast / brighten-slow. Measure against v2.2 on knot captures + `light`/`object`
      with the dynamic-region and boil metrics. Implementer must not be the public researcher
      (PROVENANCE rule-7 note). — orchestrator, owner: unassigned
- [ ] SVGF cost levers from public sources: single rotated sparse spatial pass only where relative
      variance is high (MegaLights); à-trous access reordering (Dolp et al. I3D 2024, full text not
      yet obtained). — orchestrator, owner: unassigned
- [x] (shadows, 1a2861a, results/SHADOWS-LOOK.md: not the stabilization: `uniformSnap: 'change'` (default since 255a06a, never measured with v2.2) leaves a grey veil next to fine shadow detail on moving cameras, Bistro edge sharpness 0.680 → 0.595, −0.68 dB; `stabilize: 0` changes sharpness ±0.002; fix `snapHardPx: 2` + `backfacePass`, flip proposed below) **Shadows v2.2 look** (Dennis, 2026-10-25, live `realtime-shadows.html`): no more boiling, but
      the look is worse than before (likely softer / smeared penumbrae from the output
      stabilization or the radius blend). Refine later: compare v2.1 / v2.2 / FFX side by side on
      the knot and floor penumbrae, judge by eye plus FLIP and boil. Not blocking the phases.
      — orchestrator, owner: unassigned
- [x] spec-m7-m8 (spec author, 280cf3a) **SPEC v0.3**: M7 SH/SG directional variants (replaces §8.5) and M8 translucent shadows
      (§7.10), §0.1 / §11 / §12 touch-ups, PROVENANCE "spec only, not built" rows.
- [x] testbed-v1 (c0e3876, 6821c69, 8911a08, f426142, 208b40a) **CAPTURE-FORMAT v1 buffers for M7 / M8** (SPEC v0.3 M7-4, §7.10.4): `diffuse_dir`, `specular_dir` (world ω of the
      sampled ray), `normal_geom` (smooth normal for the filter; `normal` stays the shading normal), `diffuse_sh_ref`,
      `specular_sh_ref` (6 ch, mean of the M7-2 payloads); `transmittance` (rgb T of the shadow ray), `translucent_dist`,
      `shadow_rgb_ref` (mean of v·T). Test-bed scenes `bumpy`, coloured bounce, `glass`, `glass-moving`, `glass-still`
      (M7-13, M8-10) — found by spec-author, owner capture-io / test-bed owner. _Format, replay/validate/compare, test-bed
      signals, scenes and metrics done (bit-identical on the 7 old paths and on v0 replays); v1 capture set
      `--set=v1` (v1-bumpy, v1-bounce, v1-glass, v1-glass-moving, v1-glass-still; 8.63 GB, validated; baselines in
      CAPTURES.md "v1 captures"). Usage notes below._
- [x] (testbed-v1) **How to feed and score M7 / M8 (usage notes)**. Signals `sh-diffuse`, `sh-specular`, `shadow-rgb`
      (test bed `signal=`, also `v1` = all three, `all,v1` = six). Paths `bumpy`, `bounce` (scene build 'bumpy') and `glass`,
      `glass-moving`, `glass-still` ('glass'); on the 7 old paths the v1 signals run too (`normal_geom` = `normal`: the SPEC
      M7-13 regression). Registry entry contract (`tools/rt-capture/src/replay.ts`): `frame.inputs['sh-diffuse' | 'sh-specular']`
      = `{ radiance, direction, hitDistance }` (raw form); filter with `shGuides(frame)` (`normal` = `normal_geom`,
      `detailNormal` = shading normal); return demodulated rgb resolved at the shading normal. `frame.inputs['shadow-rgb']` =
      `{ visibility, hitDistance, translucency, translucencyHitDistance, radiance (= v·T), visibilityLumT }`, light from
      `frame.meta.lights` / manifest (as `shadows`); return rgb v̂·τ̂ (rgba16float with v̂ in alpha is fine). Register with
      `signals: ['sh-diffuse', ...]`; examples: `tools/rt-capture/src/v1-entries.ts` (baselines `svgf-plain`, `svgf-plain-smooth`,
      `shadows-lumt`, `ffx-shadows-lumt`; `passthrough` / `accumulate*` accept v1 signals). Live results add `regions.bump`,
      `floorFrac`, `detailBand` {psnrDen, energyRatioDen, …}, sh-diffuse `vsShRef` (diffuse_sh_ref resolved with M7-8/9,
      `&refK=1&refS=0`: set to your resolve), shadow-rgb `regions.tint`, `chromaErr`, any-channel penumbra; compare.mjs the
      same (`--sh-k`, `--sh-s`). The test bed's specular payload uses β = 2 / (1 + 2 max(c, 0)) so c < 0 stays exact and
      bounded (CAPTURE-FORMAT v1). Example: `mode=eval&path=bumpy&signal=sh-diffuse&denoiser=svgf-plain,svgf-plain-smooth`
      (8 frames: plain detail-normal band energy 1.76, smooth-normal 0.15). — testbed-v1
- [ ] SH ringing, guard half (SPEC M7-13 "fraction of pixels where the guard trimmed b"): the scorers report only the
      floor half (output exactly 0) and, for the resolved reference, `refGuardFrac`; the output's guard fraction needs the
      payload. Proposal: an optional `ReplayDenoiser.payloads?()` returning the M7-8 payload texture (rgba32uint, 8 × f16)
      that the test bed / replay then reads. — found by testbed-v1, owner `examples/realtime-denoiser` + `tools/rt-capture`
      (on request of m7-sh)
- [ ] Specular SH payload for c = D_s·ω < 0: the test bed's `specular_sh_ref` keeps β = 2 there (exact and bounded,
      CAPTURE-FORMAT v1); SPEC M7-2 only defines c ≥ 0. If the denoiser's encode-on-load does something else for c < 0,
      align one of the two (only matters for comparing against `specular_sh_ref`). — found by testbed-v1, owner m7-sh / spec-author
- [x] m8-translucency (7ba1871, 354e46c … 76c707c, 6491f81, 895dccb, a71881a; results/M8.md) **M8 steps 2, 3, 5**:
      `ShadowDenoiser({ translucency: true })` (wide path 6 storage textures / 80 B/px, packed 4 / 88 B/px), `realtimeShadows({ translucency })`,
      registry `shadows-translucent`, page `three-temporal/realtime-glass.html`. Gate: T ≡ 1 → v byte-identical to v2.2 on 7 paths +
      11 captures, rgb = f16-truncated v. Glass 1080p pooled 38.83 / 34.21 / 40.61 (glass / moving / still) vs grey baseline
      28.42 / 26.25 / 26.51, accumulate-32 31.10 / 20.04 / 36.42; chroma err 0.002–0.006 vs 0.065. Cost 0.97–0.99 ms on glass,
      +0.12 … 0.17 ms elsewhere (over the SPEC estimate) — owner m8-translucency
- [x] m7-sh (24f2e4a … c15936e, results/M7.md) **M7 steps 2–5**: SVGF `payload: 'sh'` (encode-on-load, fused / payload
      output, `ShResolver`, `SH_RESOLVE_WGSL`, anti-lag via an SH gradient pass, three.js `realtimeDiffuse` / `realtimeSpecular`
      SH mode, registry `svgf-sh` / `svgf-sh-auto`). **Gate passes**: 7 paths within 0.013–0.038 dB pooled at equal f16
      rounding (+0.03…+0.10 as shipped). `bumpy` diffuse: SH `'auto'` s 0.75 38.26 vs best plain 37.40 (bump region +2.1),
      but band energy 0.25–0.5 and FLIP favours plain-shading-normal; `bounce`: plain ahead by 0.04–0.12. Specular SH does
      not pay (−2.1 dB at best). Cost 1080p: diffuse 2.20 → 2.92 ms, joint 3.97 → 5.42; memory 116 / 204 B/px (= SPEC).
      New defaults `shSharpen` 0.75, `shLightSharpness` 2. Open: steps 6–7 (probe P6, recurrent SH) — owner m7-sh
- [x] (spec-author, 546c777: SPEC §7.10 as-built table (a)–(g), tuned constants, measured cost / memory in §7.10.3, §9, §10.3) SPEC §7.10 deviations from the M8 build (results/M8.md §6) — found by m8-translucency, owner spec-author:
      (a) wide path needs **6** storage textures in `temporal`, not 5: v's r32float copies stay as in v2.2 (bit identity: widening
      them to rgba16float would round v to f16) and the f16 output (S rgb, v) is written for unfiltered tiles; the spatial passes'
      τ scratch reuses last frame's histories, so memory is still **80 B/px**; packed path 4 storage textures, 88 B/px (the output
      doubles as v's unfiltered copy and stabilization history, so v is f16 there and not bit-identical); (b) stabilization: S's weight =
      max(v's, S's own clamp-distance anti-lag) (`translucencyOwnGate: 'antiLag'`; v's weight alone lost 0.15 dB on glass-moving, the
      box-width half costs boil); (c) τ gets v's **uniform snap** and update forms exact for uniform inputs (f16 stores truncate and
      drifted τ below 1); (d) the H18 noise estimate E is taken on v·mean(T) (coloured edges without h_τ get the noise radius);
      (e) τ tile bits = lit sample attenuated / clear / τ differs from raw T; tau-only tiles pass v through and v-only tiles take
      S = v̂·τ; (f) τ window keeps v2.1's √(25/n) factor; (g) the "T ≡ 1 bit-identical" gate holds for v in f32 and for the
      output's rgb = f16-truncated v (results/M8.md §1).
- [ ] Shadows (opaque): rgba16float history stores truncate on the M5 Pro (LESSONS, m8), so v's history (re-stored every frame
      with weight A/(A+1)) may carry a small negative bias in penumbrae (estimate up to ~0.5 ulp × (A+1) ≈ −0.002 … −0.004 at
      A = 15). Measure: r32float v history or a +0.5 ulp compensation, on the 7 paths and the knot captures — found by
      m8-translucency, owner shadows
- [ ] M8: static coloured penumbrae boil more than the grey baseline (`v1-glass-still` static-penumbra boil 0.012 vs
      `shadows-lumt` 0.009; the opaque v channel is at v2.2's level): τ's own noise in coloured penumbrae. Candidates: a
      longer τ history where the clamp doesn't fire, S stabilization without S's anti-lag in static regions, a per-channel
      box gate. Dennis to judge the look on `realtime-glass.html` first — found by m8-translucency, owner shadows
- [x] (spec-author, 8f578d0: listed, `deployed: false`, id `three-temporal-realtime-glass` as its `mountShell` uses; the capture half is split into the next item) `examples/three-temporal/realtime-glass.html` (M8 step 5, a71881a) is not in `examples/_shared/examples.json` (listing
      policy, SPEC §12 item 9) and has no captures yet (a `glass` capture set with per-pose references would let
      compare.mjs score it like the knot) — found by m8-translucency, owner orchestrator / three-temporal
- [ ] A `glass` capture set with per-pose references for `examples/three-temporal/realtime-glass.html` (static and
      `?moving=1`), so compare.mjs scores it like the knot captures (boil, dynamic region, tint) — split from the listing
      item by spec-author, owner three-temporal
- [ ] M8 temporal-pass cost (results/M8.md §6): +0.11 ms full screen with no transmittance (τ history taps + store, output
      store), +0.04 for the raw T tile, +0.22 in tiles with glass (per-channel 5×5 stats + normal tile). Levers: skip the τ history
      taps where last frame's tile flags say τ ≡ 1 (dilated for motion), τ stats only for pixels with lit attenuated taps, a
      cheaper τ history format; target ≤ 0.9 ms on the glass paths (M5 Pro guide) — found by m8-translucency, owner shadows
- [x] (spec-author, 8f578d0: comment fixed; it also notes the page's own `antiLag` default `'off'` vs the package's `'auto'`) `packages/denoiser-realtime/dev/main.ts` header comment still says `filter=recurrent&signal=both` defaults to "recurrent
      diffuse + SVGF antiLag 'auto' specular"; since 6be4f23 it runs both signals recurrent (pass `specularFilter=svgf` for the
      mix). Comment only — found by apply-decisions, owner package dev page (M7 agent's file)
- [x] (occlusion-antilag-off, **reverted 2026-10-26** by the orchestrator: under rule 9 `'off'` loses AO contact −0.6 dB, AO flicker +15 %, SO −0.9 dB; the default inherits `'auto'` again and `'off'` is documented as the cheaper option, revert byte-checked in results/OCCLUSION-ANTILAG.md. The flip itself was decided by Dennis 2026-10-25; class default byte-identical to `occlusion-svgf`, explicit `'auto'` / `'off'` / recurrent unchanged on `std540-orbit` + `three-orbit`; SPEC §8.3 / §12 item 2, README, docs page) `OcclusionDenoiser()` now means SVGF with SVGF's default `antiLag: 'auto'` (= registry `occlusion-svgf-auto`; the
      `occlusion-svgf` entry pins `'off'` since 6be4f23). On the real scene `'off'` is 0.1–0.3 dB better on AO and 0.8 ms
      cheaper for AO + SO on the RTX bench (4.15 vs 4.95 ms); on the test bed `'auto'` is +0.1 AO / +0.9 dB SO. If occlusion
      should default to `'off'`, that's a one-line base option in `resolveOcclusion` (A/B per rule 9) — found by
      apply-decisions, owner Dennis / occlusion
- [ ] Real-scene pages: `realtime-gi.html`'s AO (`realtimeOcclusion()` with class defaults) switched from recurrent to SVGF
      `'auto'`, so results/M6-real-scene.md's AO rows labelled "default" describe the old default — found by apply-decisions,
      owner results / three-temporal (FYI). (The occlusion-antilag-off flip to `'off'` was reverted: the class default is `'auto'` = M6's `occlusion-svgf-auto` rows.)
- [x] (spec-author, 546c777: SPEC §8.5 as-built table (a)–(i), measured results, cost / memory in §8.5.5, §9, §10.3) **SPEC §8.5 deviations from the M7 build** (results/M7.md §8) — found by m7-sh, owner spec author:
      (a) M7-5: the à-trous luminance weight evaluates every tap's payload at the **centre's** direction (normal, or
      the dominant direction for specular), not the tap's own (cheaper, +0.01–0.02 dB dev page); temporal and
      gradient passes use each pixel's own. (b) M7-2 for c < 0: β stays 2 (CAPTURE-FORMAT v1 rule). (c) M7-10: the SG
      ratio darkens systematically (the extracted light sits at the guide's reflection direction, so R(n_g) is the
      peak); an `'l1'` ratio option was added; neither beat "no ratio" (test bed: SG λ_l 8 24.92, λ_l 2 29.71, `l1` 29.66, no ratio 29.13 vs plain shading normal 31.82; λ_l default now 2). (c2) `shSharpen` default 0.75 (SPEC 0), best on dev page, `bumpy`, `bounce`. (c3) SH loses bump contrast (band energy 0.25–0.5):
      payloads encoded around different detail-normal hemispheres get averaged; worth a SPEC note. (d) Resolve default is per
      signal (`'auto'`: diffuse 'none', specular 'fused'), also inside a joint pipeline (per-signal output formats).
      (e) Anti-lag with SH needs its own gradient-create pass (16 loads of the unfilterable history per stratum);
      `antiLagVersion: 1` + SH throws. (f) `historyFilter: 'catmull-rom'` is ignored in SH mode (bilinear).
      (g) Not built: `'sh-rgb'` (12 channels need 3 storage textures per signal in the temporal pass, 6 joint: over the
      default limit of 4) and the 64-bit à-trous packing (σ doesn't fit beside 6 × 8 bit + an f16 magnitude; needs a
      shared-exponent layout; est. −0.4 ms / −16 B/px per signal). (h) `inputs.radiance` stays required with an encoded
      `inputs.sh` (core type unchanged; ignored then). (i) `ShResolver` is diffuse only (specular: fused or
      `SH_RESOLVE_WGSL`'s `shResolveSpecular`).
- [ ] **Plain SVGF loses ~0.1–0.16 dB to f16 truncation** on Metal: `rgba16float` storage writes round toward zero
      (LESSONS), `pack2x16float` to nearest. A half-ulp bias before each store (or packing by hand) is likely a free
      gain for every rgba16float history/ping-pong in the package (SVGF, recurrent, occlusion, shadows); measure per
      filter, it breaks bit-identity. — found by m7-sh, owner svgf / filter owners
- [ ] **SVGF `antiLag` default is now `'auto'` (64a1123, Dennis q02)**: everything that relied on the implicit default runs
      `'auto'` now: registry `svgf`, `svgf-diffuse`, `svgf-specular`, `svgf-plain`, `svgf-plain-smooth` (so `svgf` = `svgf-auto` in
      new runs; pin `antiLag: 'off'` there if the ids should keep their meaning), and `OcclusionDenoiser({ filter: 'svgf' })`
      (its own defaults pass no `antiLag`). `svgf-sh` pins `'off'`. — found by m7-sh, owners registry / occlusion.
      _SPEC: §4.5 / §4.6 / §8.3 / §12 item 2 show the `'auto'` default and the reverted occlusion `'off'` since v0.5 (546c777); the registry part stays open._
      _Occlusion part: settled. `'off'` was tried as the occlusion default and reverted (results/OCCLUSION-ANTILAG.md), so `OcclusionDenoiser` inherits `'auto'` on purpose._
- [x] (reviews/nrd-review-targets-review.md) **Clean review of `sources/nrd-review-targets.md`** (c94934a): all 8
      targets, the evaluation agreement and the no-action list pass; no redactions; the five public references check
      out. Implementers may read it. Non-blocking notes for the evaluator: entry 1 says to test the recurrent option
      first, but the shipped default (SVGF `'auto'`) is the primary baseline; `three-knot-*` captures are documented in
      `examples/three-temporal/CAPTURES.md`; the E-1 link needs E-1's results committed. — found by clean reviewer,
      owner the targets' evaluator
- [x] (t1, 281a138 8ba4a70 0ffe427 67cca63 35839c5 + docs; results/T1-recovery.md) **target1-recovery** (review target 1:
      newly visible regions and camera cuts). Baselines frame by frame (shipped SVGF `'auto'`, shadows v2.2 `'change'`,
      occlusion SVGF; recurrent, FFX, native curves) on `cut` / `pan` / `object` (long `t1-*` windows), the standard set and
      `three-pan` / `-orbit` / `-knot-orbit`, scored per pixel age and per frame after a reset. Shipped defaults reach their
      settled band 0–4 frames after a cut; native NRD recovers 3–5 dB lower. **One visible deficiency: SVGF diffuse is
      blotchy on curved surfaces for ~5 frames after a cut.** Candidates (options, default off, default WGSL and replay
      outputs byte-identical): SVGF `youngNormalPower` (fixes most blotches on frames 0–2; neutral on the 1080p test bed,
      +0.22…+0.39 dB and −15…−22 % young boil on the real scene: **meets rule 9**), recurrent `historyFix: 'spatial'`
      (Dennis's lead; +0.67 / +0.43 dB pooled diffuse / specular over 14 captures, boundary +1.2…+4.6 dB, −1.5 B/px, one
      dispatch fewer; **fails rule 9's boil clause**), SVGF `spatialHistoryWeight` (null), `youngLuminanceWeight` (loss);
      shadows' fresh-pixel knobs already at their best. — t1
- [x] (orchestrator, flipped after native round 3: +0.31 ms at 1080p on the RTX, svgf-auto 1.14× → 1.20× REBLUR steady, i.e. +5 %, within rule 9's +10 %; default 16 for the radiance payload, 0 kept for payload 'sh' and OcclusionDenoiser (unmeasured); registry ids `svgf`, `svgf-diffuse`, `svgf-specular`, `svgf-plain*` pinned to 0, so they keep their old meaning, while `svgf-auto` follows the package default and now means youngNormalPower 16 (use `svgf-auto@youngNormalPower=0` for the old shipped default); SPEC §4.4 / §12 item 15 / table rows and README to fold in: spec author) **Default flip, APPROVED by Dennis q18 (a) 2026-10-26, pending only the Windows locked-clock cost check (≤ +10 %; native round 3 step 2): SVGF `youngNormalPower: 16`** (keep the option and document both values: Dennis "we can add the option to change it still with notes to both paths"). Was: Default flip proposal (look change, needs Dennis): SVGF `youngNormalPower: 16` (results/T1-recovery.md §5.1).
      Rule-9 A/B: 1080p 7 paths diffuse 38.500 → 38.501 dB pooled, disoccluded +0.02, FLIP ±0, flicker ±0; 14 captures
      −0.02…+0.32 dB, FLIP ≤ +0.5 %, boil lower everywhere; specular byte-identical; cost within noise (§5.5). Visible
      effect: young pixels on curved surfaces are smoother on the first frames after a reset or anti-lag event (strip in
      §4). Before flipping: re-measure the cost on a quiet GPU (§5.5 was contended; normalized it is within noise). If
      approved: one line in `resolveOptions` (0 → 16), byte checks of the other defaults, docs. — found by t1,
      owner svgf / Dennis
      **4096-spp check (e1b, results/E1b-high-reference.md §2): still passes rule 9.** `orbit` / `light` / `glossy` pooled
      +0.001 → +0.003 dB, disoccluded +0.03 → +0.06, FLIP ±0, flicker ±0, "true" ±0.00; `cut` / `pan` pooled +0.011 /
      +0.019, `cut` disoccluded +0.12; worst path `light` −0.003 → −0.010; frame after the cut −0.08 → −0.14 (post-cut
      8-frame window −0.02); 540p captures young PSNR +0.05…+0.14, young boil −0…−4 %, settled ±0. Quiet-GPU cost check
      still open.
- [x] (**Dennis q19 (a), 2026-10-26: `historyFix: 'spatial'` is the recurrent default**, with rule 9's boil clause as amended by q20 (a); flipped by the recurrent agent in the commit "denoiser-realtime: historyFix 'spatial' is the recurrent default": new default output = old explicit `'spatial'` byte for byte, `'mips'` kept and documented (README, SPEC §5.8 v0.6, item 16); the cut-frame loss continues as a follow-up in results/T1b-spatial-repair.md) **Question for Dennis (recurrent, opt-in filter): `historyFix: 'spatial'` instead of the mips?** Better on every
      PSNR / FLIP / boundary measure and leaner, but young-pixel boil +4…+70 % (to ≤ SVGF's level, below the reference's
      own boil) and settled boil +6.6 % on the real scene: rule 9's boil clause fails by the letter; also −0.4…−1.4 dB on
      the single frame right after a cut at 1080p (better from the next frame). Proposal: keep `'mips'` unless Dennis
      reads the boil change as acceptable for the recurrent filter (results/T1-recovery.md §5.2). — found by t1, owner
      recurrent / Dennis
      **4096-spp check (e1b, results/E1b-high-reference.md §3): gains double, the boil framing changes.** 4 paths pooled
      diffuse +0.14 → +0.34 dB (disoccluded +0.29 → +0.49), specular +0.07 → +0.12, AO +0.18 → +0.39 (+0.60 → +0.82),
      SO +0.14 → +0.16; cut frame diffuse −1.26 → −1.91, specular −0.67, SO −1.43 (8-frame post-cut window diffuse −0.31,
      AO +0.79). Boil: the 256-spp reference's own young boil (0.0076–0.0111 diffuse) was mostly its noise; the 4096
      reference's is 0.0014–0.0048, and young diffuse boil of every arm is above it on moving-camera windows (A-SVGF
      1.1–3.5×; mips 1.7–3.4×, except `pan` 0.77×; spatial 1.1–3.5×). So the spatial fix's +7 % (`orbit`) / +38 % (`pan`)
      young boil moves the output away from a clean reference (on `pan` from under it to 1.06× of it), while staying ≤
      the shipped A-SVGF default's young boil on every window. Settled: every arm at or under the 4096 reference (spatial
      +1…+3 %). Recommendation unchanged (keep `'mips'` by the letter); the question for Dennis is now "boil that rises to
      about a clean reference's level, but not above the default filter's".
      **T1b (results/T1b-spatial-repair.md): cut-frame loss explained and fixed as an option** — the cause is the sample
      count at a full reset (every tap A = 0), not the footprint or ĥ; `historyFixDense: 4` (+ `historyFixDenseCap:
      'mip'`) beats the mips on the cut frame on all four signals and passes rule 9 against the new default (proposal
      above). Reveal paths (narrow / wide strips, one wide reveal, then a hold) confirm the spatial repair over the
      mips on revealed surfaces (+0.5 … +4.0 dB on the first frame).
- [x] (orchestrator, applied 2026-10-26 under Dennis's standing "go with the recommendation" for config defaults and as the follow-up his q19 (a) asked for; byte check: new default = explicit options on std540-cut, recurrent and occlusion-recurrent, 26/26 files; RTX re-time in native round 4; SPEC §5.8 fold-in: spec author) **Default flip proposal (recurrent, rule 9 passed): `historyFixDense: 4` + `historyFixDenseCap: 'mip'`**
      (results/T1b-spatial-repair.md; options in 474619c / f0a2872, default off). Fixes q19's follow-up: the `'spatial'`
      default lost the frame right after a camera cut because every tap is A = 0 there (17 one-frame values vs the
      mips' hundreds); A = 0 pixels now average every pixel within 4 px from a workgroup-shared tile. Cut frame vs
      `'mips'` (1080p, 4096 spp): diffuse **+0.46 dB**, specular +0.16, AO +2.84, SO +0.08 (the `'spatial'` default:
      −1.91 / −0.67 / −0.20 / −1.43). Rule 9 vs the shipped `'spatial'`
      default, live 1080p, 7 paths (4096 spp on five): diffuse +0.118 pooled / +0.34 disoccluded, AO +0.292 / +0.70, SO
      +0.111, specular +0.005 (worst path −0.003); 26 captures diffuse +0.13 / young +0.40; FLIP and flicker equal or
      lower; boil equal or lower in every region of every capture (young diffuse −0 … −23 %); cost +0.11 … +0.13 ms per
      frame (+5 … +7 % of a single-signal recurrent filter, solo bench), +1.3 ms once per reset frame, no memory.
      Look: cleaner first frames after cuts and wide reveals (fewer blotches). If approved: two defaults in
      `resolveRecurrent` (radiance and occlusion), byte checks, README / SPEC §5.8; re-time on the RTX machine. —
      found by t1b, owner recurrent / Dennis
- [x] (spec-author, 546c777: §4.3 / §4.4 / §4.5 v0.5, §5.8 v0.5 + D7 row, §0.2 / §13 recovery numbers, §12 items 15–16; `youngNormalPower: 16` written as a proposal awaiting Dennis and a quiet-GPU cost check, the default stays 0) SPEC deviations for the spec author (results/T1-recovery.md): §4.3 / §4.4 gain the options `spatialHistoryWeight`
      (null), `youngLuminanceWeight` (loss), `youngNormalPower` (proposal, above); §5.8 (D7) gains `historyFix: 'spatial'`
      + `historyFixRadius` (8 px, halving per frame, no mips / depth atlas); §0.2 / §13 can quote the T1 recovery numbers
      (frames to band after a cut: SVGF diffuse 4, specular 0, shadows 4; recurrent young pixels 1.5–2 dB under SVGF).
      — found by t1, owner spec-author
- [ ] T1 follow-ups: (a) `youngNormalPower` for `OcclusionDenoiser`'s SVGF on ĥ (unmeasured); (b) diffuse-only
      `varianceRampFrames: 8` (t1-cut: band at frame 2 instead of 4, +0.19 dB frames 0–7; specular loses with it, so per
      signal) needs the full A/B; (c) the recurrent spatial fix's cut-frame loss at 1080p; (d) a reveal capture (moving
      panel over a patterned, indirectly lit background, then a still interval) as target 1 suggests; (e)
      `DiffuseSpecularDenoiser` / `OcclusionDenoiser` resource reports still count 7 recurrent passes with
      `historyFix: 'spatial'` (6 dispatch). — found by t1, owners svgf / recurrent / testbed
      **(e) fixed** with the q19 flip (`recurrentPassCount`: 6 with `'spatial'`, 7 with `'mips'`, one fewer for occlusion);
      **(c) and (d) done** (t1b, results/T1b-spatial-repair.md: cause, `historyFixDense` proposal, reveal paths `rv-*`
      and the fixed-set scorer `data/t1b-reveal.mjs`).
- [x] (bistro-sponza; commits ab3f4d7, f96caa0, 1303313 + results) **Bistro and Sponza as scoring scenes** (SPEC §12
      item 7): `realtime-gi.html?scene=sponza|bistro` (models loaded by path from outside git, `$RT_SCENE_ASSETS`, default
      `examples/three-temporal/scene-assets` (Git LFS since 2026-10-26); Sponza = Cryengine Limited License, Bistro = CC BY 4.0), sun + local
      light, 6 scripted paths and captures (`sponza-orbit|pan|move`, `bistro-orbit|pan|move`, 48 f, 960×540, 3.28 GB
      each, validated; `run-realtime.mjs capture --set=<name> --chunk=8`); replayed at ab3f4d7 with the corner and the
      test bed's std540 captures on the same snapshot. Rankings agree on every signal (diffuse `svgf-auto` > `svgf` >
      `recurrent`, specular `svgf-auto` > `svgf` > `recurrent` > FFX, shadows ours > FFX +3.3…4.6 dB, AO SVGF > recurrent,
      −4…5 dB here). results/scenes-bistro-sponza.md, examples/three-temporal/CAPTURES.md "Bistro and Sponza" — orchestrator brief
- [~] (shadows, 1a2861a, results/SHADOWS-LOOK.md §B: the spatial filter, not lag: temporal-only scores 28.35; causes the H18 noise-sized half of the radius at clean steps (+2.0 dB capped), the 1-px `minRadius` (+2.5 more, but −0.16 dB at 1080p on the test bed), the terminator radius on back faces (`backfacePass`); `noiseCap: 2, noiseCapSettled: true` + `backfacePass` → 24.73, above the raw input; frame 0 still loses 23.4 vs 25.0, follow-up below) Shadows under a small moving local light (`bistro-move`: sphere r 0.12 m moving 7 cm/frame, mostly hard shadows):
      raw 1-ray input 24.42 dB pooled / FLIP 0.017 beats `shadows` 22.69 / 0.050 and `ffx-shadows` 19.65 / 0.109; ours
      already loses at frame 0 (spatial blur of near-hard edges) and trails the moving edges (bias +0.058). Penumbra
      and dynamic region are fine (13.7 vs 8.1, 13.3 vs 9.8). Repro: `mode=replay&capture=bistro-move&denoiser=shadows`
      (results/scenes-bistro-sponza.md) — found by bistro-sponza, owner shadows
- [ ] SVGF / A-SVGF temporal noise on heavy-tailed GI: diffuse boil 1.7× (Sponza) / 2.3× (Bistro) the reference's own,
      AO 1.9× / 2.7×, where the corner and the test bed stay below the floor; recurrent is calm but −0.6…1.1 dB diffuse,
      −4…5 dB AO. Candidate for an option (rule 9), scored with `score-captures.mjs` boil on `sponza-*` / `bistro-*`
      (results/scenes-bistro-sponza.md) — found by bistro-sponza, owner svgf
- [ ] (shadows, measured in results/SHADOWS-LOOK.md: v22 +8…23 % over FFX at +3.7…5.2 dB static-penumbra PSNR, v2.1 was +18…32 %; `bfsh2` adds 1–3 %, `noiseCap` 5–18 %; not fixed, `rotationStep: 0` untested on the sun captures) Shadows: static-penumbra boil 8–23 % above FFX's under the wide sun penumbrae of Sponza / Bistro (ours still
      +3…5 dB penumbra PSNR); the corner and test bed show ours level or lower. Look at it with any boil work on
      shadows (results/scenes-bistro-sponza.md) — found by bistro-sponza, owner shadows
- [ ] Native NRD replay of the Bistro / Sponza captures (Windows harness): `sponza-orbit|pan|move`,
      `bistro-orbit|pan|move` (copy from the M5 Pro's `tools/rt-capture/captures/`, 19.7 GB; or regenerate with
      CAPTURES.md "Bistro and Sponza", which needs the two models placed by hand). Notes for the harness: `lights[0]` is
      the shadow light, **`directional`** (direction toward the light, angularRadius 0.02) on all but `bistro-move`,
      where it is a `sphere` that **moves every frame** (use `frames[i].lights`); `sponza-move` has object motion
      (`static: false`); specular is SSR, not demodulated (`demodulation.specular: "none"`); AO reference is the extra
      `ao_ref` (ĥ = h/(h + 1 + 0.05·(−viewz))). Score with `compare.mjs` + `score-captures.mjs` like ours — found by
      bistro-sponza, owner harness builder
- [x] (shadows: correction note under M4 §10 item 1) **Doc/code mismatch, shadows radius formula** (found while writing SPEC v0.5 §7.5): SPEC v0.2 §7.5 and results/M4.md
      §10 write `R = ½·0.75·W·shrink + ½·32 px·E` (noise term unscaled); `shadowSpatialWgsl` blends first,
      `R = lerp(lightSize·g, 32 px·E, noiseBlend)`, then multiplies by `radiusScale` 0.75 × `lerp(1, historyShrink, A/maxHistory)`
      × 0.5 in pass 1. The H18 fallback is likewise 0.75·shrink·32 px·E (SPEC v0.1 / v0.2 said 24 / 32 px·E). The sweeps
      ran on the code, so only the written formula was off; SPEC v0.5 describes the code. M4 §10's formula line could
      get a correction note — found by spec-author, owner results (M4.md) / shadows
- [x] (shadows, 1a2861a: `src/shadow.ts` header 20 B per tile, `stabilize` doc "indirect, over the penumbra tiles"; M4 / M8 docs left as they are, ≈ 0.3 B/px either way) **Doc/code mismatch, shadows comments**: the tile buffers are **20 B per 8×8 tile** (stats `vec2u` 8 + nearest
      occluder 4 + list 4 + active flag 4; +4 for the τ list with `translucency`), but the `src/shadow.ts` header says
      "four tile-sized buffers (16 B per 8x8 tile)", results/M4.md §12.3 "+4 B per tile", results/M8.md §6 "+16 B per
      tile" (≈ 0.3 B/px, so no table moves); and the `stabilize` option's doc in `src/shadow.ts` says "one full-screen pass
      when on", but the pass is indirect over the penumbra tiles since 033a869. SPEC v0.5 §7.8 and the README use 20 B.
      Comment-only fix — found by spec-author, owner shadows (`packages/denoiser-realtime/src/shadow.ts`)
- [x] (shadows, results/SHADOWS-LOOK.md "Rule-9 A/B": shipped 38.38 / penumbra 29.37 / FLIP 0.0132 / flicker 0.0024 / tPSNR 41.09 vs `uniformSnap: true` 38.22 / 29.16 / 0.0131 / 0.0024 / 41.09, 7 paths × 96 f; knot rect boil 0.0014 both; real scenes `true` +0.14 dB, Bistro orbit +0.68) **Shipped shadows defaults never measured together at 1080p**: every v2.2 number (results/M4.md §12, E-1, M8)
      ran `uniformSnap: true`; the default is `'change'` since 255a06a, measured only on v2 (REMEASURE §4: +0.12 dB
      pooled, FLIP +2 %) and inside T1's cut / pan windows. Run `denoiser=shadows,shadows@sh.uniformSnap=true` on the 7
      paths at 1080p and the knot captures (boil), so SPEC §0.2 / §7 can quote the shipped configuration — found by
      spec-author, owner results / shadows
- [x] (shadows, flip commit: approved by Dennis 2026-10-26, q21 (a); new default output byte-identical to the old `backfacePass: true, snapHardPx: 2` on std540-orbit / -light / -object, bistro-move, three-knot-static, sm-hard-camera and `shadows-translucent` m8-glass-moving wide + packed; README, SPEC §7.4 / §7.5 / §12 item 5) **Proposed default flip (Dennis approves, changes the look): shadows `backfacePass: true` + `snapHardPx: 2`.**
      Passes rule 9 (results/SHADOWS-LOOK.md "Rule-9 A/B"): 1080p 7 paths 38.49 vs 38.38 dB pooled, penumbra 29.39 vs
      29.37, FLIP 0.0124 vs 0.0132 (−6 %), flicker / tPSNR equal, no path below −0.02 dB; std540 35.66 vs 35.49, FLIP −9 %,
      boil ±0; 11 real captures 28.86 vs 28.33, FLIP −14 %, boil +1 %; cost equal (`thin` −0.02 ms), memory equal. Look:
      edges stay crisp on a moving camera (the grey veil of `'change'` goes, Bistro edge sharpness 0.595 → 0.679), surfaces
      facing away from the light stay black. Caveats: dynamic-region boil +15 % on the moving-camera real captures (hard-edge
      resampling, as v2.1 / `uniformSnap: true`; +0…4 % where the region is real motion), `bistro-move` static-penumbra
      boil +8 %. Images: `results/img/shadows-look-bistro-orbit-facade.png`, `-knot-edges.png`, `-bistro-move-sign.png`
      — found by shadows, owner Dennis → shadows (flip in `resolveShadowOptions`, README, SPEC §7.4 / §7.5)
- [x] (Dennis 2026-10-26, q22 (b): stays an option; a variant that doesn't add boil stays with shadows, results/SHADOWS-MOTION.md) **Question for Dennis: shadows `noiseCap: 2, noiseCapSettled: true`** (on top of the flip above, = `rec`): sharper
      hard shadows (+1.20 dB on the 11 real captures vs shipped, `bistro-move` +2.0 dB to 24.73, above the raw input;
      1080p +0.22 dB, FLIP −7 %) but rule 9's boil clause fails: std540 boil +6 % (max +12 %), static-penumbra boil
      +3…17 %, real-scene static-penumbra boil +9 %, 1080p tPSNR −0.15. Sharper hard edges vs calmer wide penumbrae
      (results/SHADOWS-LOOK.md "Verdict"; image `results/img/shadows-look-bistro-move-bollard.png`) — found by shadows,
      owner Dennis
- [ ] Shadows under hard local lights, frame 0 / fresh pixels: `bistro-move` frame 0 is 23.4 dB vs the raw 25.0 with every
      kept variant (fresh pixels keep the noise radius; capping them cost the reset windows 1.5–4.8 dB at frame 0, the
      occluder radius there is one sample and the 3×3-tile minimum). `minRadius: 0.5` + `mergeMin: false` win the 960×540
      replays (+2.3 dB `bistro-move`) but lose 0.16 dB at 1080p (`thin` −0.57). Candidate: a hard-edge test from the raw
      5×5 (a step with agreeing sides, not noise) instead of E or the tile minimum — found by shadows, owner shadows
- [ ] compare.mjs: an edge-sharpness column (mean |∇out| / |∇ref| where |∇ref| > 0.1; results/SHADOWS-LOOK.md) —
      boil and PSNR barely see the `'change'` veil, sharpness does (0.680 vs 0.595) — found by shadows, owner results
- [x] (shadows, flip commit) `packages/denoiser-realtime/README.md` shadows options: `snapHardPx`, `backfacePass`, `noiseCap`,
      `noiseCapSettled` (1a2861a; after Dennis's call on the flip) — found by shadows, owner README

- [x] reflection-motion (5053015 test bed, 409be4f + 222bec2 options, docs commit) **Review target 2 / target D (c): isolated reflection-motion tests.**
      Reflect build + 16 `rm-*` paths (plane / convex / concave / rippled mirrors, grazing; camera-, reflected-object- and
      reflector-only motion, stop / hold, cut, roughness sweep), an independent CPU oracle of the markers' mirror images
      and ROI metrics (position error, lag, trail, ghost energy, duplicates, recovery) in the test bed's eval. Inventory,
      reproduction, two options and their rule-9 A/B: results/REFLECTION-MOTION.md. _Shipped A-SVGF: no drag on mirrors
      under camera motion, short trails at zero parallax; plain SVGF drags and duplicates there (28 px); recurrent
      virtual motion shows a leading ghost (below). Options default off, byte-identical default; neither passes rule 9
      (real-scene moving-object boil +16 %, cost)._
- [ ] **Recurrent specular: leading ghost / duplicate images from virtual motion on clean mirrors** (results/REFLECTION-MOTION.md
      §3: far image 5.6 px ahead of the oracle, extra blobs on 36 / 40 frames, reflector region −9 dB vs A-SVGF; with
      `virtualMotion: false` it tracks). Cause: reflected-world disocclusion; low virtual confidence only shortens that
      history to A_fast = 3 and the 3×3 clamp lets a high-contrast image through. Candidate: SVGF's `reflectionHitTest`
      per-tap test (stored 3×3 hit distance vs this frame's, tolerance (0.1 + 0.4 r) + max(spread, ½ stored spread))
      inside `virt{i}`, dropping failed taps. Repro: `signal=specular&mode=eval&path=rm-cam-plane&denoiser=recurrent-specular,recurrent-specular@r.virtualMotion=false`
      — found by reflection-motion, owner recurrent (`src/shaders/recurrent.ts`)
- [ ] `src/capture.ts` `isStatic` looks only at the movable sphere (marker 1 in the reflect build): reflect-build captures
      with a moving mirror (`rm540-refl-turn`) or marker 2 are written `static: true`. No consumer reads the flag
      today; fold `FrameState.reflect` (reflector pose, marker 2) into the test when it matters — found by
      reflection-motion, owner `examples/realtime-denoiser`
- [ ] README (`packages/denoiser-realtime`): document the specular options `reflectionHitTest` and
      `reflectionReprojection` ('virtual' measured as a loss; 'dual' for glossy mirrors under camera motion), their cost
      and the rule-9 result (results/REFLECTION-MOTION.md §6) — found by reflection-motion, owner `packages/denoiser-realtime`

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
- [x] (answered 0242a35, native/results/PHASE4-5.md: **no**; no convention variant closes the gap) **P2: is native specular low because of input conventions?** On `synthetic-static` /
      `synthetic-plane`, native specular scores 24.6–25.3 dB vs ours 28.7–29.4 (results/M1.md §7),
      while diffuse is on par. Sensitivity runs, specular only, REBLUR and RELAX, scored with
      `compare.mjs`: (a) as now; (b) `specular_hitt` scaled ×0.1 and ×10 before packing; (c)
      roughness forced to 0.3 and to 0.7 everywhere (same in our replay of `svgf-specular`, the
      orchestrator will run ours); (d) REBLUR with hit-distance parameters chosen so the
      normalized hit distance of this capture spans roughly 0.2–0.8. Return the PSNR table and
      the range of normalized hit distance the helper produced in (a). Words/metrics only.
      — orchestrator

- [x] (answered 0242a35, PHASE4-5.md: table of native's normalized curve vs viewZ, h, roughness) **P3: native occlusion's hit-distance curve, as data.** Capture: a synthetic plane (`gen-synthetic.mjs`,
      `synthetic-static`-like) with constant `diffuse_hitt` = h per capture, h ∈ {0.1, 0.3, 1, 3, 10, 30, 0 (miss)},
      at two camera distances (viewZ ≈ −2 and −20). Run `REBLUR_DIFFUSE_OCCLUSION` with default hit-distance
      parameters, 32 frames; return the converged output value per (h, viewZ), and the same for
      `REBLUR_SPECULAR_OCCLUSION` at roughness 0.3 and 0.8. Numbers only. With that table the test bed can render
      references on native's curve (scene.ts `occNorm`) and compare `occlusion-*` against native fairly. — occlusion
- [x] (skipped by the harness builder, ROUND2.md: current SIGMA on the knot captures answers the moving-shadow question; old versions add little) **P4: SIGMA across versions on a moving occluder** (change audit rank 1; `sources/nrd-change-magnitude.md`).
      Build NRD v4.9.4, v4.11.0 and v4.18.0 (outside the repo, as for e06852b). Run `SIGMA_SHADOW` on
      `three-knot-static`, `three-knot-orbit` and test-bed `std540-object` / `std540-light`. Score with
      `compare.mjs`, including the dynamic / static region fields and `boil`. Return the per-version
      table and a frame strip of the knot shadow. Also run our `shadows` (v2.2) and `ffx-shadows`
      on the same GPU. — orchestrator
- [x] (skipped, ROUND2.md scope note) **P5: ReBLUR history-fix timing** (change audit rank 2). `REBLUR_DIFFUSE_SPECULAR` v3.3.1 vs v3.4.0
      vs v4.18.0 on `std540-cut` and `std540-pan`, frames 0–12 after each reset/disocclusion, per-frame
      pooled PSNR for diffuse and specular in the disoccluded region. Return the per-frame curves.
      — orchestrator
- **v1 captures have landed (2026-10-25, testbed-v1, c0e3876…208b40a):** P6 and P7 can run. Write them with
  `node examples/realtime-denoiser/run-headless.mjs --serve --set=v1` (`v1-bumpy`, `v1-bounce`, `v1-glass`,
  `v1-glass-moving`, `v1-glass-still`; 960×540, 8.63 GB, ~2 min); format in CAPTURE-FORMAT.md §v1. — orchestrator
- [ ] **P8: native specular on isolated reflection motion** (results/REFLECTION-MOTION.md, CAPTURES.md "Reflection-motion
      captures"; write them with `run-headless.mjs --serve --set=reflect`, 13.1 GB): REBLUR / RELAX specular (with the
      specular hit distance, REBLUR's normalization as in round 3) on `rm540-cam-plane`, `-obj-plane`, `-refl-turn`,
      `-cam-convex`, `-cam-concave`, `-cam-plane-r10`. Compare outputs: the marker images against the path's oracle
      positions (`src/reflect-oracle.ts`; frame index = path frame), trails behind the moving marker and the turning
      mirror's far image, duplicates, lag at r 0.1. Question: does native show A-SVGF's 3–6 px zero-parallax trails, or
      the recurrent filter's leading ghost? — reflection-motion, owner harness builder
- [ ] **P6: native SH variants on directional captures** (SPEC v0.3 §8.5.7, M7-13). Captures: CAPTURE-FORMAT v1 `bumpy`
      and two standard paths with `diffuse_dir` / `normal_geom`. Run `REBLUR_DIFFUSE_SH` and `RELAX_DIFFUSE_SH` (input packed
      by native's front end from `diffuse` + `diffuse_dir`). Return (a) the colour-extraction output scored against
      `diffuse_ref` with `compare.mjs`, (b) native's diffuse resolve with the shading normal (`normal`) scored against
      `diffuse_ref` on `bumpy`, (c) native's reported memory for the SH vs plain denoiser and the timings. Words/metrics
      only. — spec-author
- [ ] **P7: native translucent shadows** (SPEC v0.3 §7.10.4, M8-10). Captures `glass`, `glass-moving`, `glass-still`
      (CAPTURE-FORMAT v1 `transmittance`, `translucent_dist`). Run `SIGMA_SHADOW_TRANSLUCENCY` (penumbra and translucency
      packed by native's front end) and `SIGMA_SHADOW` on `visibility` alone. Score the rgb output against
      `shadow_rgb_ref` (clamp tonemap per channel) and the opaque part against `visibility_ref`, with the dynamic region
      and boil; timings for both. — spec-author
- [ ] **Native round 3 (order set by the orchestrator, 2026-10-26):** (1) REBLUR hit-distance normalization
      sweep on diffuse, standard set + real scene, before trusting REBLUR's real-scene rows (ROUND2 item 1);
      (2) cost re-run at HEAD with clocks locked: `svgf-auto`, `shadows` (v2.2), occlusion, plus SVGF
      `youngNormalPower=16` vs default (T1 candidate awaiting a quiet-GPU cost check); (3) P6 / P7 after
      rewriting `--set=v1`. Jitter units: confirmed (pixel units, PHASE4-5.md). (4) after those: native replay of the six Bistro / Sponza captures
      (models now in git LFS, 1a3dc42; copy the 19.7 GB of captures over the NAS or regenerate them per CAPTURES.md
      "Bistro and Sponza"; `lights[0]` is directional on sun captures and a per-frame moving sphere on `bistro-move`). — orchestrator

- [ ] **Review target D: distance information degrading over long histories** (Dennis, 2026-10-26; lead = a public
      blog's "what", relayed by Dennis, no code or technique: distance feeds both filtering and reflection tracking,
      repeated processing can distort it, and recent work ties better distance handling to less specular pixelation
      and less long-history contact-shadow banding, i.e. images that get worse as frames accumulate). Reproduce first
      (rule 9; long holds overlap review target 7): ≥ 300-frame stationary holds plus slow motion on `three-knot-still`,
      `glossy`, `thin` and a Bistro view; per-frame error curves in the contact, penumbra and specular regions; does
      error rise after it first settles? Our own candidate causes to test, in order: (a) shadows store the penumbra scale
      g (from hit distance) in rgba16float history, and Metal truncates f16 stores toward zero (LESSONS m8; see the
      f16 item above): does g drift down over a long hold and band the contact shadows? (b) recurrent carries hit
      distance through f16 buffers and re-filters it every frame: does the accumulated hit distance drift from the
      per-frame mean and mis-size radii / virtual motion (specular pixelation)? (c) SVGF / A-SVGF specular uses no hit
      distance at all (reflections reproject with surface motion): overlaps review target 2. _(c) answered
      (reflection-motion, results/REFLECTION-MOTION.md): harmless on mirrors under camera motion (the R-8 cap keeps ~1
      frame there; images within 0.2 px of an analytic oracle), 3–6 px trails where parallax is 0 (moving reflected
      object, turning mirror), ~1 px glossy drag at r 0.1–0.2; options `reflectionHitTest` / `reflectionReprojection`
      built, both fail rule 9 on boil and cost, so no flip._ (d) AO / SO filter a
      normalized hit distance: long-hold contact darkening (target 7). Fixes land as options. — orchestrator,
      owner: unassigned (after the shadows-look agent and the 4096-spp runs)

- [x] (upscaler-guides evaluator, results/UPSCALER-GUIDES.md; steps 1 and 3 done, step 2 not built: the mask is not
      better) **Upscaler guides as optional denoiser inputs** (Dennis, 2026-10-26). _Result: scored against exact
      ground truth (test bed re-traced at t−1; Bistro / Sponza captures by BVH ray casts). Our plane test misses 0.12 %
      of wrong-surface disocclusions (SVGF 0.00 %), the upscaler's `disocclusion ≥ 0.5` misses 14 % (1080p) / 21 %
      (960×540), 41 % on `thin`: it is computed from dilated (nearest-of-3×3) depth / motion, which shifts it one pixel
      onto the occluder. Precision 84–92 % vs ours 99+ %, with no `motion_z` (false resets on objects moving in depth:
      124 k on `sponza-move`). Real scenes: ours 69.6 / 88.6 % recall / precision, mask 61.3 / 38.6 %. Cost 0.16 ms at
      1080p as an extra pass; our per-tap tests stay either way (they weight the history fetch). Needs a three.js
      renderer (raw WebGPU only via non-exported internals) and a depth texture. The one gap it could fill, SVGF's
      3×3-fallback misses, is closed better by switching the fallback off (follow-up below). Step (3)
      `shadingChange` not assessed (open below)._ `@pmndrs/upscaler` (../fsr3, MIT; FSR3-class)
      already publishes a guides bundle (TEMPORAL-GUIDES-SPEC.md, GUIDES-HANDOFF.md): a graded 0..1 `disocclusion` mask
      (reconstructed previous depth + confidence vote, grazing-plane fix b16274a), dilated motion / depth, previous depth,
      same-frame after `dispatchGuides({depth, velocity})` (split dispatch, before effects), plus `shadingChange` (late,
      i.e. frame N−1). Our filters each re-derive disocclusion inside their temporal pass (per-tap plane distance /
      normal, binary per tap → history age A), with no shared or graded mask. Steps, reproduce first (rule 9): (1) score
      our implicit detection and the upscaler's mask against the test bed's ground-truth disocclusion (false negatives =
      ghosting, false positives = needless resets), incl. thin objects, grazing planes and object motion; (2) only if the
      mask is better somewhere: optional `guides.disocclusion` that can force a reset / raise the young-history repair
      (default path bit-identical), A/B on T1's disoccluded / boundary metrics; (3) `shadingChange` as an input for
      `antiLag: 'gradient'` (no renderer produced its input so far; review target 3). Also a cost note: one mask
      shared by diffuse, specular, shadows and AO vs four internal tests. PROVENANCE: FSR3 is MIT (allowed, RULES §2).
      — orchestrator, owner: unassigned (queued after target D)
- [ ] **Upscaler `shadingChange` as an input for `antiLag: 'gradient'`** (split from the item above, its step 3). Late
      product (frame N−1), ceil(render/2), r32float. Still no renderer produces `antiLag: 'gradient'`'s input; assess
      only if `'gradient'` gets a consumer. — upscaler-guides evaluator, owner unassigned

- [ ] **Codex audit handoff, reviewed (2026-10-26):** read [sources/audit-public-research-prompt.md](sources/audit-public-research-prompt.md) and [sources/audit-current-state.md](sources/audit-current-state.md) (never the originals) with the staleness notes in [reviews/codex-audit-2026-10-26-review.md](reviews/codex-audit-2026-10-26-review.md). — clean reviewer, owner: orchestrator (fold into the queue)

## Questions for Dennis

_(only genuine blockers or taste calls; continue with a provisional best guess meanwhile)_

**Answered 2026-10-25: Dennis decided every SPEC §12 item as recommended** (decisions page q01–q17;
each decision is recorded at the top of its item in [SPEC.md §12](SPEC.md), short form §0.3; applied in
64a1123, 255a06a, 6be4f23 and the docs). New questions go to SPEC §12 (spec author) or here as a
one-line pointer to the evidence. The list as it stood in SPEC v0.2:

1. default filter per signal (diffuse / specular / occlusion; M2/M3 go/no-go; what
   `filter: 'recurrent'` means on the joint class); 2. SVGF `antiLag` default (`'auto'` v2: +0.25 ms);
3. 4 ms on the M5 Pro vs ≤ 2× native; 4. memory over 100 B/px; 5. shadows uniform snap;
6. AO look / hit-distance curve; 7. tuning scene; 8. API items; 9. listing policy.

The entries that used to be here (joint default for `filter: 'recurrent'` — recurrent-spec; SPEC v0.1
review list — spec-author; SVGF feedback default — svgf / results, now settled; default occlusion
filter and AO look — occlusion) are merged into SPEC §12 items 1, 6 and the "settled" note.

- ~~**Shadows look (2026-10-26, shadows):**~~ (answered 2026-10-26: flip approved, q21 (a), landed; `noiseCap` stays an option, q22 (b)) approve the default flip `backfacePass: true` + `snapHardPx: 2` (passes rule 9,
  changes the look), and decide on `noiseCap` (sharper hard shadows, fails the boil clause). Both items under "Found
  along the way"; evidence results/SHADOWS-LOOK.md.
