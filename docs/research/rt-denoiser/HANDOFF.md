# Handoff: starting M0

_2026-10-24. From the planning session to the implementing agent._

## Where things are

| what | where |
|---|---|
| This work | branch `feat/rt-denoiser-cleanroom`, worktree `/Users/dex/Developer/Denoiser-nrd-cleanroom` |
| Plan (all decisions made) | [PLAN.md](PLAN.md) |
| Rules (binding) | [RULES.md](RULES.md); you are an **implementer** in rule 8 |
| Task board, lessons | [TASKS.md](TASKS.md) (who does what, status), [LESSONS.md](LESSONS.md) (gotchas; read first, append before you finish) |
| Research | [sources/](sources/): `reblur.md`, `svgf-relax.md`, `shadows-specular.md`, `nrd-provenance.md` (§3 = NRD's interface facts), `ssgi-svgf-review.md` |
| Source papers (local, not in git) | `/Users/dex/Developer/rt-denoiser-sources/` (see its README) |
| Capture contract | [CAPTURE-FORMAT.md](CAPTURE-FORMAT.md) v0 (draft; M0 finalizes it) |
| Native NRD comparison | [NATIVE-HARNESS.md](NATIVE-HARNESS.md); runs on Dennis's Windows RTX machine, results on `feat/rt-denoiser-native-results` |
| Prior SVGF (M1 starting point) | `/Users/dex/Developer/ssgiDev/bench/src/demos/14-svgf/` |
| Existing temporal API | `packages/denoiser-core/src/temporal.ts`, spec `docs/specs/temporal.md` |
| Existing test bed to extend | `examples/ffx-denoiser/` (analytic WGSL tracer, references, PSNR/flicker/bias, headless runner) |
| Existing FFX port (style reference) | `packages/denoiser-ffx/` |

## Clean-room reminders

- Never open NRD / NRD-Sample code, forks or ports (incl. `C-none/Web-RTRT`'s RELAX), or
  NRD's README. NRD's interface is in `sources/nrd-provenance.md` §3; that's all you need.
- In the RTG II chapter, read prose and equations, skip the numbered listings.
- Every pass and constant you write gets a row in `PROVENANCE.md` (create it in M0).
- No NVIDIA names in our API (ReBLUR, ReLAX, SIGMA, NRD).

## M0 checklist (PLAN.md §7)

- [ ] `SPEC.md` v0: our pipelines for SVGF (from the papers + `ssgi-svgf-review.md`
      upgrades) and the recurrent filter, with a decision for each open item in
      `reblur.md` §7. Dennis reviews before M2 code.
- [ ] `PROVENANCE.md` skeleton: table of pass → public source → our deviation.
- [ ] Test bed (`examples/ffx-denoiser`, or a sibling `examples/realtime-denoiser`):
      add 1-bounce diffuse GI + hit distance, specular + hit distance over a roughness
      range, shadows + occluder distance + light size, albedo/f0; stress paths (fast pan,
      lighting change, thin geometry, glossy floor, cut); FLIP + temporal PSNR + per-region
      metrics + per-pass GPU ms. Reuse ssgiDev's noise-injection trick for exact ground
      truth.
- [ ] Capture exporter writing CAPTURE-FORMAT v0, and a replay mode that runs any
      `TemporalDenoiser` from a capture.
- [ ] Package skeleton `packages/denoiser-realtime` (private), exposed as
      `denoiser/realtime`, mirroring `packages/denoiser-ffx`.
- [ ] Exit: one capture round-trips. Our replay reads it, and the Windows harness's
      `REFERENCE` run reads it, with matching results.

## Kickoff prompt for the IDE agent

> Work in `/Users/dex/Developer/Denoiser-nrd-cleanroom` on branch
> `feat/rt-denoiser-cleanroom`. Read, in order: `docs/research/rt-denoiser/RULES.md`
> (binding; you're an implementer), `HANDOFF.md`, `PLAN.md`, then the reports in
> `sources/`. Do M0 from the HANDOFF checklist, starting with `SPEC.md` v0 and the test-bed
> signals. Don't open NRD code, NRD's README, or any NRD port. Commit as you go on this
> branch.
