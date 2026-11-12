# SVGF cost: bringing the A-SVGF joint default back under the 4 ms guide (2026-10-27)

_Implementer / evaluator (performance), RULES.md rule 8: no NRD code, README, NRD-Sample, RTG II listing or quarantine folder
opened. Answers the brief "bring the shipped A-SVGF joint default back comfortably under 4.4 ms (ideally ≤ 4.2 so q26 would
fit) without losing quality", the TASKS items "SVGF cost levers from public sources" and "SVGF output aliasing" (SPEC §12
item 4 (c)). Everything adopted is **byte-identical** in output (§4), so no rule-9 quality A/B was needed._

**Conclusion first:**

- **The shipped A-SVGF joint default (diffuse + specular, `antiLag: 'auto'`, `youngNormalPower: 16`) now costs 3.81 ms
  at 1080p on the M5 Pro, down from 4.31 ms in the same session (−0.50 ms, −11.7 %).** The 2026-10-26 re-measure read
  4.40 for the same code; this session's baseline sits 0.09 ms lower (bench-day state, see §1), so compare within the
  session. That is 4.8 % under the 4 ms guide, where it was at its 4.4 ms edge.
- **q26 (`antiLagChroma: true`) on top: 3.97 ms** (was 4.49 in this session, 4.55 on 10-26), so it now fits under 4 ms.
  `youngNormalPower: 16` costs **+0.06 ms** now (3.81 vs 3.74 with 0), down from +0.28 (10-26) / +0.28 (this session's
  baseline: 4.31 vs 4.04).
- Also faster, same code paths: **SVGF `'off'` 3.80 → 3.37 ms** (−0.43), **occlusion A-SVGF (AO + SO) 2.84 → 2.67 ms**
  (−0.18). Recurrent, shadows and the SH payload are untouched.
- Where it came from (all in the five à-trous passes and the variance pass; nothing else moved, table in §2):
  1. **Young-pixel variant only where it can act** (−0.18 ms): `youngNormalPower` compiled its variant into the specular
     signal too, whose lobe-cutoff normal weight never reads the exponent, plus a per-tap `× 1.0` luminance factor.
  2. **Workgroup-shared tiles for the à-trous taps at strides 1, 2 and 4** (−0.23 ms): each 8×8 workgroup loads and decodes
     its (8 + 2·stride)² tap texels once (colours as packed f16, exact), instead of 9 loads + 9 normal decodes per pixel.
  3. **Shared depth weight** for the two signals (−0.03), **a tiled young-history variance loop** (−0.035), **per-tile young
     flags** so settled tiles skip the history-length load (−0.03).
- **Output aliasing (SPEC §12 item 4 (c)) is built as `outputAliasing` (default false):** byte-identical output, cost
  ±0 (3.81 vs 3.81), **−8 B/px per signal: the joint A-SVGF default 140 → 124 B/px**. Dennis decided (c) "if it measures
  clean"; it does. It changes which texture object is returned (a ping-pong texture, valid until the next dispatch as the
  API already documents), so the default flip goes to the orchestrator as a config proposal (TASKS), not flipped here.
- **Not adopted:** interleaved (strided) tile mapping (1.8–3× slower at stride ≥ 4: cache lines), tiles at stride 8,
  decoded-f32 tile storage, fewer à-trous iterations on settled pixels (changes output; iterations 4 already measured a
  loss in M1 §4, so not pursued). Details §3.

## 1. Protocol

| | |
|---|---|
| GPU / browser | Apple M5 Pro (`metal-3`), HeadlessChrome, `--use-angle=metal`, WebGPU timestamps, AC power; `caffeinate -s -i` |
| Bench | test bed solo bench `mode=bench&preset=full&path=orbit&n=200` (200 timed frames after 20 warm-up), 1080p, one configuration per page; the REMEASURE-2026-10-26 `bench.mjs` with one Vite server per code variant (each a frozen copy via `RT_REALTIME_SRC`, ports 5351–5371, checked free first), the same scratch registry wrapper (`j-<id>` = joint instance) |
| Rounds | 18 rounds × 15 pages, alternating order, each round led by a throwaway page; quiet check (no other headless Chrome / runner > 3 % CPU, no `Video Wake Lock`, camera idle) before every page; GPU lock held |
| Clean set | **rounds 6–18 = 13 runs per configuration** (2026-10-27 01:11–01:26 JST). Rounds 1–5 started the moment a desktop video call ended and ran in a slow state for ~5 min (every configuration +5 … +40 %, run spread up to 2×, no video assertion or camera any more): excluded, kept in the raw data. Clean runs spread ≤ 1.5 % per configuration apart from single outliers (≤ 1 per configuration, up to +17 %) |
| Statistic | median over runs of each run's median frame; min = fastest single frame; per-pass = median over runs of each run's per-pass median |
| Before the clean window | a Slack call with the camera ran from before 23:40 to ~01:05 JST. Two exploratory sets (3 rounds, 8 / 5 pages) and one 9-round set (22 pages) were run through it with `IGNORE_VIDEO=1` and are tagged `video: true`: medians +10 … +100 %, but per-pass deltas within a round held up and picked the tile form (§3). Only the clean set is quoted as numbers |

Commands, scripts and raw data: [data/svgf-cost/](data/svgf-cost/) (`bench.mjs <pages.json> <rounds> 200`, `sum.mjs`;
`MINROUND=6 node sum.mjs bench-clean-1080p.jsonl` reproduces §2; `bytecheck.sh` and `fdiff.mjs` for §4; `dump.sh` dumps the
default joint passes' WGSL from a src folder).

**Baseline vs REMEASURE-2026-10-26:** the same default reads 4.31 here (runs 4.29–4.35, one 4.65) vs 4.40 (4.35–4.47) on 10-26;
`ynp 0` 4.04 vs 4.12, SVGF `'off'` 3.80 vs 3.86, occlusion A-SVGF 2.84 vs 2.89, q26 4.49 vs 4.55. A uniform −1.5 … −2 %
bench-day shift; every delta below is within this session.

## 2. Per-pass profile, before / after (joint diffuse + specular, A-SVGF default, 1080p `orbit`, clean set)

| pass | before (HEAD ebdfea8) | after | Δ |
|---|---|---|---|
| prepass | 0.149 | 0.150 | — |
| gradient create | 0.279 | 0.279 | — |
| gradient à-trous ×4 | 0.036 + 0.035 + 0.034 + 0.040 | same | — |
| gradient λ | 0.072 | 0.072 | — |
| temporal | 0.597 | 0.598 | — |
| variance | 0.475 | 0.447 | −0.028 |
| à-trous 0 (stride 1) | 0.529 | 0.394 | −0.135 |
| à-trous 1 (stride 2) | 0.522 | 0.396 | −0.126 |
| à-trous 2 (stride 4) | 0.519 | 0.412 | −0.107 |
| à-trous 3 (stride 8, untiled) | 0.519 | 0.465 | −0.054 |
| à-trous 4 (stride 16, untiled) | 0.492 | 0.444 | −0.048 |
| **sum of passes / frame median** | 4.298 / **4.31** | 3.802 / **3.81** | **−0.50** |

Before, the five à-trous passes were 60 % of the frame (2.58 ms) and `youngNormalPower: 16` was +0.27 ms of them (ynp 0:
2.31). After, they are 2.11 ms (55 %); temporal (0.60), variance (0.45) and the anti-lag gradient passes (0.50) are the
rest. The untiled strides 8 / 16 still gained 0.05 each from levers 1, 3 and 5.

### Levers, cumulative (each row adds to the one above; clean set, 13 runs each)

| # | lever | frame median (min) | Δ | passes that moved | output |
|---|---|---|---|---|---|
| A | HEAD (ebdfea8), shipped default | 4.310 (4.163) | | à-trous 0.529 0.522 0.519 0.519 0.492, variance 0.475 | — |
| A′ | HEAD with `youngNormalPower: 0` (reference only) | 4.035 (3.901) | −0.275 | à-trous 0.470 … 0.444 | (the 10-25 look) |
| B | young-pixel variant only where it can act: specular gets it only with `specularNormalWeight: 'power'`, the luminance factor only when `youngLuminanceWeight ≠ 1` | 4.132 (3.991) | **−0.178** | à-trous −0.04 … −0.03 each | byte-identical |
| C | à-trous workgroup tiles at strides 1, 2, 4 (contiguous (8 + 2s)² texels; depth f32, decoded normal, roughness byte, colours 2 × `pack2x16float`) | 3.901 (3.767) | **−0.231** | à-trous 0.405 0.405 0.415 (tiled), 0.481 0.465 | byte-identical |
| D | variance pass: 14×14 tile for the young-history loop, loaded only when the workgroup's largest radius > 0 | 3.865 (3.743) | −0.036 | variance 0.475 → 0.442 | byte-identical |
| E | joint à-trous: one depth weight per tap when both signals share `sigmaDepth` | 3.833 (3.701) | −0.032 | à-trous −0.005 … −0.009 each | byte-identical |
| G | per-8×8-tile young flags written by the variance pass; the young à-trous variant loads the history length only in flagged tiles | **3.805 (3.690)** | −0.028 | à-trous 3/4 −0.01 | byte-identical |
| — | G with `youngNormalPower: 0` | 3.744 (3.626) | (ynp 16 = +0.06) | | |
| — | G + `outputAliasing: true` | 3.809 (3.681) | ±0 | | byte-identical, −16 B/px |
| — | G + q26 `antiLagChroma: true` | 3.971 (3.846) | +0.166 | gradient passes as T3 | (q26's own A/B) |
| — | HEAD + q26 | 4.489 (4.329) | | | |
| — | SVGF `'off'` (registry `svgf`): HEAD → G | 3.801 → **3.368** | −0.433 | variance 0.714 → 0.560, à-trous 2.32 → 2.06 | byte-identical |
| — | occlusion A-SVGF (AO + SO): HEAD → G | 2.840 → **2.665** | −0.175 | à-trous 1.31 → 1.14 (3 iterations) | byte-identical |

## 3. What was tried and not kept

| attempt | measured | why not |
|---|---|---|
| **interleaved tiles**: workgroup = 8×8 pixels `stride` apart, so all 64 pixels' taps are one 10×10 grid at every stride | contended smoke pass, same page: stride 1 0.46 vs 0.55, 2 0.51 vs 0.54, **4: 0.92, 8: 1.52, 16: 1.62 vs 0.53** | every tile texel is a different cache line at large strides; replaced by contiguous tiles (LESSONS) |
| contiguous tile at stride 8 | (8 + 16)² = 576 texels: f32 colours 32 KB (pipeline failed on the 16 KB default limit), packed 20.7 KB (over); `raw` form (normal word decoded per tap, 13.8 KB) **0.57 vs 0.49 untiled** (exploratory) / 0.71 vs 0.57 (during call) | as many texel loads as the taps (9 per pixel); the per-tap decode it then repeats costs more |
| tile storage as f32 colours (`decoded`) | strides 1 / 2: 0.428 / 0.431 vs packed 0.411 / 0.410; stride 4: 0.519 vs packed 0.419 vs untiled 0.490 (exploratory set, same rounds) | 14.3 KB at stride 4 limits occupancy; packed f16 (exact for the rgba16float ping-pong) is half the bytes |
| tile storage `raw` (z + packed normal word, decoded per tap) at strides 1–4 | 0.419 / 0.418 / 0.426 vs packed 0.411 / 0.410 / 0.419 | the per-tap octahedral decode costs more than the bytes it saves |
| roughness stored decoded (f32) in the tile | 30–60 specular values per frame differ by 1 f16 ulp (max 3.9e-3 abs, 1e-3 rel), diffuse identical | inline, fast math folds `a/255 − b/255` in the roughness weight; the tile stores the raw byte and decodes at use (byte-identical) |
| variance-pass tile without the workgroup radius gate | (not built) | settled workgroups would load 196 texels for nothing; the gated form (D) is what was measured |
| variance young loop's own cost | `spatialVarianceRadius=0` (timing only, changes output): variance 0.50 → 0.25 (during call) | the loop is ALU-bound (48 bilateral weights for diffuse at r = 3); tiling cut its loads ~10× for −0.035 ms. Further cuts would change the weights (rule 9) |
| young load removed entirely (timing hack `tY = 1`, wrong output) | during call: à-trous 2.42 vs E 2.50 vs G 2.45 | upper bound for lever G; G gets ~60 % of it byte-identically |
| fewer à-trous iterations on settled pixels | not built | changes output; `atrousIterations: 4` already lost up to 0.26 dB and +15–56 % diffuse flicker (M1 §4), so a full rule-9 A/B for ~0.1 ms was not worth it once the default sat at 3.81 |
| TASKS "SVGF cost levers from public sources": MegaLights-style single rotated sparse pass where relative variance is high; à-trous access reordering (Dolp et al., I3D 2024) | not built | the first changes output and the pipeline (rule-9 work for a new filter shape); the second's full text is still not obtained. The contiguous-tile result above is our own design and is the access-order lever we could measure |

## 4. Byte identity (why no rule-9 A/B)

Every adopted lever changes only how values are fetched and shared, not the arithmetic per pixel. Checked by replaying
captures through a frozen HEAD copy (rt-capture server with `RT_REALTIME_SRC`) and through the final code, and comparing
every output file byte for byte (`diff -rq`; `fdiff.mjs` for the one failing intermediate state above):

| captures | configurations | result |
|---|---|---|
| std540 `cut`, `orbit`, `pan` | `svgf-auto` (default), `svgf` (`'off'`, ynp 0), `svgf-auto` with `feedback=1`, `specularNormalWeight=power`, `youngLuminanceWeight=0.25`, `spatialHistoryWeight=8` (untiled variance fallback), `occlusion-svgf-auto` | **identical** (all frames, both signals) |
| std540 `thin`, `glossy`, `light`, `object`, std1080 `orbit` | `svgf-auto`, `svgf`, `occlusion-svgf-auto`, `svgf-auto` + `outputAliasing=1` | **identical** |
| `bistro-orbit`, `sponza-orbit` (real scenes, 48 frames) | `svgf-auto`, `occlusion-svgf-auto` | **identical** |
| `v1-bumpy` | `svgf-sh-auto` (SH payload: separate passes, checked for the host changes) | **identical** |
| earlier states (std540 `cut` / `orbit`) | also `youngNormalPower=0`, `spatialVarianceRadius=3`, `kernel=5x5` (untiled path) | identical |

`outputAliasing=1` vs the default: identical outputs (the replay reads the returned texture each frame). The default
joint passes' WGSL after the final clean-up equals the timed variant's except one comment (`dump.sh`).

## 5. Memory

| | B/px (1080p joint A-SVGF default) |
|---|---|
| before | 140 |
| after (default) | 140.06 (young flags: one r32uint per 8×8 tile) |
| with `outputAliasing: true` | **124.06** (−8 per signal) |

Workgroup memory: à-trous tile 3.6 / 5.2 / 9.2 KB at strides 1 / 2 / 4 (joint, with roughness), variance tile 10.2 KB:
all under WebGPU's 16 KB default `maxComputeWorkgroupStorageSize`, so no device limit is requested.

## 6. Code

`packages/denoiser-realtime/src/shaders/svgf.ts`: `atrousPass` (`AtrousVariant.youngLum` / `youngNormal` split,
`tile`, `sharedDepth`, `youngTile`), `variancePass` (`VarianceVariant.tile`, `youngFlag`), `weightsWgsl` (`wGeoZ`);
`packages/denoiser-realtime/src/svgf.ts`: `ATROUS_TILE_MAX_STRIDE`, pipeline construction (only the à-trous variants that
run are compiled now), the young-tile texture, `outputAliasing`; `tools/rt-capture/src/denoisers.ts`: `outputAliasing`
setting. The SH payload passes (`svgf-sh.ts`) are unchanged; the same tiles would apply there (TASKS).
