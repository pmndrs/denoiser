# E-1: high-reference re-score (SPEC §13)

_e1 agent (evaluator, RULES.md rule 8: no NRD code, README or port read), 2026-10-25. Everything
here was measured on our own test bed. It answers SPEC §13's question: how much do the 256-spp
references compress the gaps between our filters?_

> **Follow-up: [E1b-high-reference.md](E1b-high-reference.md)** (2026-10-26) adds the leftovers: diffuse / specular on
> `thin` and `cut` at 4096 spp (so §6 now covers all 7 paths for every signal: diffuse recurrent vs `auto` −2.39 dB,
> specular −1.81), the 4096-spp noise floors on `thin` / `cut` / `pan` (`thin`'s diffuse reference is still noisy at
> 4096: ceiling 44.4 dB), and the 4096-spp A/Bs of SVGF `youngNormalPower: 16` and recurrent `historyFix: 'spatial'`.
> No ranking changes.

## Conclusion first

- **No ranking changes.** On every signal, every path and every pair of arms, the order at
  4096 spp is the order at 256 spp. That includes the close pairs (diffuse `glossy` recurrent vs
  A-SVGF −0.01 → −0.11 dB; AO `orbit` SVGF vs A-SVGF +0.08 → +0.20; SO `light` SVGF vs A-SVGF
  +0.07 → +0.09; shadows `light` v2.1 vs v2.2 +0.19 → +0.19).
- **Gaps widen, a lot, where the reference was noisy.** On `orbit`, `light` and `glossy`
  (1080p, 96 frames), against 4096-spp references:
  - Diffuse: recurrent's deficit to A-SVGF `auto` is **−2.12 dB** (256 spp: −0.75); `orbit` and
    `light` −3.2 / −3.1 (were −1.2 / −1.0). Plain SVGF vs `auto`: **−1.13** (was −0.31).
  - Specular: recurrent −1.23 (was −0.61), plain SVGF −2.99 (was −1.91). Recurrent's `glossy` win
    grows from +0.18 to +0.30. In the roughness ≥ 0.6 bin recurrent's deficit goes from −0.56 to
    −2.11 dB: the 256-spp specular reference was noisiest exactly there.
  - AO: recurrent −2.09 vs `auto` (was −0.87), −1.84 vs plain SVGF (was −0.78). SO: little change
    (−1.79, was −1.57), because SO's reference was already clean.
  - Shadows: almost unchanged (FFX −8.2 vs −7.8 dB; `clampGeometry: false` −0.88 vs −0.79; v2.1 vs
    v2.2 within 0.05 dB pooled). The shadow reference was clean (ceiling 49 dB).
- **Theory holds.** For every arm, path and signal, MSE@256 − MSE@4096 equals σ²_256 − σ²_4096
  (from two independent references at each spp) to within ±5 % (ratio 0.94–1.05; 0.99–1.01 for
  most rows). The reference noise is an additive, denoiser-independent term, as SPEC §13 says.
- **The 256-spp ceilings** (PSNR of σ²_256, mean of the three paths): diffuse **41.7 dB**,
  specular **36.9**, AO 42.2, SO 49.3, shadows 49.1 (penumbra 39.0). Our best diffuse and AO
  filters scored 40.5 dB at 256 spp, about 1 dB under the cap. Specular's cap, 36.9 dB, sits only
  2.3 dB above A-SVGF's score: specular gaps measured at 256 spp are the most compressed in dB
  terms after diffuse. At 4096 spp the ceilings are 56.6 / 46.4 / 53.9 / 63.4 / 64.3 dB, so the
  4096 scores are within ~0.5 dB of the true error (column "true" below).

**What this changes in SPEC §0.2 / §12:** no recommendation flips, but several stated gaps are
too small by 2–3× and should be quoted from here when a decision rests on them:

- §12 item 1 (default filter): the case for SVGF over recurrent gets stronger. Diffuse −0.75 →
  −2.12 dB, AO −0.87 → −2.09, specular −0.61 → −1.23 on these three paths. "About 20 knobs moved its
  gap by ≤ ±0.2 dB" was also measured against 256 spp: on diffuse and AO a knob effect reads about
  2.5–3× larger against a clean reference, so those sweeps may have understated what the knobs do.
  Nothing suggests they could close a 2 dB gap, though.
- §12 item 2 (`antiLag: 'auto'`): its diffuse gain is +1.13 dB here, not +0.24 (+0.31 on the same
  three paths at 256 spp), and specular +2.99 (was +1.91). The cost (+0.25 ms) buys more than SPEC
  says.
- §12 item 1, occlusion default: A-SVGF `auto` leads plain SVGF on AO by 0.26 dB (was 0.09) and on
  SO by 0.39 (was 0.35), with SVGF ahead on AO `orbit` (+0.20). Still small; unchanged decision.
- §0.2 "quality within ~0.5 dB of native": judge it against a high-spp reference. 0.5 dB at 256 spp
  is about 1.5 dB on diffuse.
- Shadows (§0.2, items 5 and the v2.x numbers): unaffected. 256-spp numbers are fine for shadows
  and SO.

Over more paths (§6: occlusion and shadows on all 7, diffuse / specular on 5) the picture holds:
recurrent vs A-SVGF `auto` diffuse −0.95 → **−2.51 dB**, specular −0.96 → −1.91, AO −1.01 → −2.33;
SVGF vs `auto` diffuse −0.27 → −0.93; shadows v2.2 38.76 vs v2.1 38.65 vs FFX 31.30.

## 1. Setup

| | |
|---|---|
| GPU / browser | Apple M5 Pro (`metal-3`), HeadlessChrome 155, `--use-angle=metal` |
| Test bed | `examples/realtime-denoiser`, 1920×1080, 96 frames per path, blue-noise 1-spp signals, FLIP every 12th frame at 41.4 ppd. Paths `orbit`, `light`, `glossy` (§2–5); `pan`, `thin`, `cut`, `object` added in §6 |
| References | **high**: 4096 spp (stratified 64×64, salt 0), every frame, chunked 32 spp per submit. **standard**: 256 spp (16×16, salt 0), bit-identical to the references of every earlier result (checked: every 256-spp score reproduces M4 v2.1 / REMEASURE, e.g. `shadows` `orbit` 37.6553, `ffx-shadows` 30.4881, `svgf` `pan` diffuse 39.4496). Both sets are rendered in the **same page** and every arm is scored against both (`&refspp=4096&ref2spp=256&ref2salt=0`), so the denoised frames are identical. Region masks (penumbra = 0.02 < ref < 0.98, contact = ref ĥ < 0.5) come from the 4096-spp reference for both scores |
| Noise floors | `&refspp=N&ref2spp=N&ref2salt=1&denoiser=` (no denoiser): two **independent** sets of the same estimator. 256 spp: all 96 frames; 4096 spp: first 32 frames (per-frame floors vary < 0.2 dB along a path) |
| Test-bed change | d256615 (additive): `&refsalt`, `&ref2spp` / `&ref2salt` (second reference set, per-pair `vsRef2` scores, `refFloor`), and `id@key=v` variants in one page. With none of them the page is bit-identical to before. `e1-table.mjs` builds the tables |
| Denoiser code | Pinned snapshots via `git archive`, served by scratch Vite configs (`server.hmr: false`): **7a8b980** for every arm except the v2.2 one (packages = ff04c8a's code: shadows **v2.1**, SVGF anti-lag v2), and **033a869** (shadows **v2.2**, identical to HEAD 5ab37fc's package code) for `shadows v2.2`, run in its own page on the same references. The registry (`tools/rt-capture/src`) came from the same snapshot. The test bed ran from the worktree at d256615 / d02613d (additive metrics) for §2–5, and from a d02613d snapshot for §6 after other agents' v1 test-bed changes landed (they import registry exports the pinned snapshot lacks) |
| Arms | diffuse / specular: `svgf` (`antiLag: 'off'`), `svgf-auto` (v2), `recurrent`, `accumulate-32`; shadows: `shadows` (v2.1 default), `shadows@sh.clampGeometry=false`, `ffx-shadows`, `accumulate-32`, `shadows v2.2`; occlusion: `occlusion-svgf`, `occlusion-svgf-auto`, `occlusion-recurrent` (`accumulate-32` does not take `ao` / `so`); noisy input as the anchor everywhere |
| Metrics | pooled PSNR (tonemapped x/(1+x) per channel; visibility clamped), mean over paths of per-path pooled dB; regions pooled; FLIP and fixed-pixel flicker are path means. "true" = PSNR of (MSE@4096 − σ²_4096) |
| Cost | 4096-spp refs: ~5.5 s per frame for all five signals alone; a 1080p page took 5–25 min with three pages in parallel |

Commands (from `examples/realtime-denoiser`, `$S` = scratch folder with the snapshots):

```sh
git archive 7a8b980 packages/denoiser-realtime/src packages/denoiser-core/src packages/denoiser-ffx/src tools/rt-capture/src | tar -x -C $S/snap
node ../../node_modules/vite/bin/vite.js --config $S/vite.config.mjs --port 5350 --strictPort --host 127.0.0.1   # alias tools/rt-capture/src -> $S/snap
export BASE=http://127.0.0.1:5350/ C="mode=eval&preset=full&refspp=4096&ref2spp=256&ref2salt=0"
node run-headless.mjs --json=joint-orbit.json "signal=diffuse,specular&denoiser=svgf,svgf-auto,recurrent,accumulate-32&path=orbit&$C"
node run-headless.mjs --json=occ-orbit.json "signal=ao,so&denoiser=occlusion-svgf,occlusion-svgf-auto,occlusion-recurrent&path=orbit&$C"
node run-headless.mjs --json=sh-orbit.json "signal=shadows&denoiser=shadows,shadows@sh.clampGeometry=false,ffx-shadows,accumulate-32&path=orbit&$C"
node run-headless.mjs --json=floor256-orbit.json "signal=diffuse,specular,shadows,ao,so&denoiser=&mode=eval&preset=full&path=orbit&refspp=256&ref2spp=256&ref2salt=1"
node run-headless.mjs --json=floor4096-orbit.json "signal=diffuse,specular,shadows,ao,so&denoiser=&frames=32&mode=eval&preset=full&path=orbit&refspp=4096&ref2spp=4096&ref2salt=1"
node e1-table.mjs --tag="shv22-: v2.2" --floor-lo=floor256-*.json --floor-hi=floor4096-*.json joint-*.json occ-*.json sh-*.json shv22-*.json
```

Raw data: [data/e1-highref-1080p.json](data/e1-highref-1080p.json) (every page; main fields =
vs 4096 spp, `vsRef2` = vs 256 spp, `refFloor`, per-frame dB for both).

## 2. Reference noise floor

Two independent references of the same frames, pooled PSNR of one against the other (dB).
σ²_ref = ½·MSE; the **ceiling** (the best score any filter can get against that reference) is
PSNR(σ²_ref) = floor + 3.01 dB.

**256 spp** (96 frames):

| signal | orbit | light | glossy | mean | ceiling | region floor (ceiling) | FLIP |
|---|---|---|---|---|---|---|---|
| diffuse | 39.31 | 39.06 | 37.58 | 38.65 | **41.66** | disoccluded 37.16 (40.17) | 0.0278 |
| specular | 34.06 | 33.57 | 34.00 | 33.88 | **36.89** | disoccluded 36.12 (39.13) | 0.0323 |
| shadows | 45.84 | 46.27 | 46.25 | 46.12 | **49.13** | penumbra 35.95 (38.96) | 0.0032 |
| AO | 38.37 | 38.19 | 40.91 | 39.15 | **42.16** | contact 36.60 (39.61) | 0.0140 |
| SO | 47.07 | 47.30 | 44.37 | 46.25 | **49.26** | contact 42.75 (45.76) | 0.0083 |

**4096 spp** (first 32 frames):

| signal | orbit | light | glossy | mean | ceiling | region floor (ceiling) | FLIP |
|---|---|---|---|---|---|---|---|
| diffuse | 53.21 | 53.48 | 53.99 | 53.56 | **56.57** | disoccluded 52.87 (55.88) | 0.0086 |
| specular | 42.88 | 42.46 | 44.96 | 43.43 | **46.44** | disoccluded 48.84 (51.85) | 0.0147 |
| shadows | 61.26 | 60.34 | 62.17 | 61.26 | **64.27** | penumbra 50.56 (53.57) | 0.0009 |
| AO | 49.14 | 49.60 | 53.89 | 50.88 | **53.89** | contact 48.50 (51.51) | 0.0050 |
| SO | 61.06 | 61.48 | 58.59 | 60.38 | **63.39** | contact 56.09 (59.10) | 0.0027 |

The reference variance does not fall as 1/N between 256 and 4096 spp (×16 expected): diffuse
×31 and shadows ×33 (the stratified primary sample helps smooth integrands), AO and SO ×14,
specular only **×9**. Specular's per-sample distribution is heavy-tailed (rare bright GGX
samples), so 256 samples under-represent the tail and 4096 still carry visible noise. The
"ceiling ≈ 40 dB" in SPEC §13 is right for diffuse and AO, too high for specular (37) and too low
for shadows and SO (49).

A 256-spp (salt 0) and a 4096-spp (salt 0) reference are **not** independent: they share the
per-pixel Cranley-Patterson rotation and the secondary random stream of their first chunks. Their
mutual PSNR (diffuse 41.37, specular 36.04, shadows 48.84, AO 41.59, SO 48.93) overstates the
floor; use the salt-1 pairs above.

## 3. Re-score, 256 vs 4096 spp

Pooled PSNR (dB) per path, 256 → 4096, the mean over the three paths, Δ = 4096 − 256, and the
"true" mean (4096 minus σ²_4096 in MSE).

### Diffuse

| denoiser | orbit | light | glossy | mean 256 | mean 4096 | Δ | true | disocc. 256 → 4096 | FLIP 256 → 4096 | flicker 256 → 4096 |
|---|---|---|---|---|---|---|---|---|---|---|
| noisy input | 16.49 → 16.50 | 16.34 → 16.35 | 16.64 → 16.65 | 16.49 | 16.50 | +0.01 | | 15.96 → 15.97 | 0.289 → 0.291 | 0.1105 → 0.1103 |
| `svgf` | 40.65 → 45.23 | 40.57 → 45.43 | 39.48 → 45.42 | 40.23 | 45.36 | +5.13 | 45.71 | 37.22 → 40.15 | 0.0327 → 0.0268 | 0.0023 → 0.0017 |
| `svgf-auto` | 40.97 → 46.28 | 40.93 → 46.72 | 39.71 → 46.47 | **40.54** | **46.49** | +5.95 | **46.94** | 37.25 → 40.21 | 0.0301 → 0.0224 | 0.0019 → 0.0013 |
| `recurrent` | 39.79 → 43.12 | 39.90 → 43.63 | 39.70 → 46.37 | 39.80 | 44.37 | +4.58 | 44.65 | 36.30 → 38.47 | 0.0376 → 0.0330 | 0.0023 → 0.0017 |
| `accumulate-32` | 27.35 → 27.48 | 27.02 → 27.16 | 29.68 → 30.03 | 28.02 | 28.22 | +0.20 | | 20.18 → 20.22 | 0.0647 → 0.0638 | 0.0187 → 0.0186 |

(Disoccluded: `orbit` and `glossy` only; `light` has a static camera.)

### Specular

| denoiser | orbit | light | glossy | mean 256 | mean 4096 | Δ | true | disocc. 256 → 4096 | FLIP 256 → 4096 | flicker 256 → 4096 |
|---|---|---|---|---|---|---|---|---|---|---|
| noisy input | 13.90 → 13.90 | 13.78 → 13.79 | 16.79 → 16.81 | 14.82 | 14.83 | +0.01 | | 14.14 → 14.14 | 0.223 → 0.225 | 0.1365 → 0.1365 |
| `svgf` | 32.29 → 33.80 | 35.02 → 38.99 | 30.65 → 31.65 | 32.65 | 34.81 | +2.16 | 35.31 | 32.45 → 33.65 | 0.0541 → 0.0474 | 0.0029 → 0.0025 |
| `svgf-auto` | 33.93 → 36.31 | 35.27 → 39.66 | 34.48 → 37.44 | **34.56** | **37.80** | +3.24 | **38.54** | 33.28 → 34.72 | 0.0485 → 0.0415 | 0.0027 → 0.0023 |
| `recurrent` | 32.83 → 34.52 | 34.35 → 37.44 | 34.65 → 37.74 | 33.94 | 36.57 | +2.62 | 37.07 | 32.29 → 33.34 | 0.0521 → 0.0470 | 0.0035 → 0.0032 |
| `accumulate-32` | 20.55 → 20.64 | 26.77 → 27.15 | 22.09 → 22.21 | 23.13 | 23.33 | +0.20 | | 20.44 → 20.48 | 0.117 → 0.116 | 0.0145 → 0.0144 |

By roughness (pooled per bin, mean of the three paths, 256 → 4096):

| bin | `svgf` | `svgf-auto` | `recurrent` | recurrent − auto |
|---|---|---|---|---|
| r < 0.15 | 35.99 → 36.25 | 38.87 → 39.33 | 37.81 → 38.12 | −1.06 → −1.21 |
| 0.15–0.35 | 32.52 → 33.74 | 35.97 → 37.87 | 35.49 → 36.99 | −0.48 → −0.88 |
| 0.35–0.6 | 33.21 → 36.67 | 33.79 → 37.92 | 33.11 → 36.38 | −0.68 → −1.54 |
| ≥ 0.6 | 31.05 → 37.94 | 31.06 → 37.99 | 30.50 → 35.88 | −0.56 → **−2.11** |

### Occlusion

| signal | denoiser | orbit | light | glossy | mean 256 | mean 4096 | Δ | true | contact 256 → 4096 | FLIP 256 → 4096 | flicker 256 → 4096 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| AO | noisy input | 15.38 → 15.39 | 15.62 → 15.63 | 12.80 → 12.81 | 14.60 | 14.61 | +0.01 | | 9.64 → 9.65 | 0.121 → 0.122 | 0.1426 → 0.1424 |
| AO | `occlusion-svgf` | 39.64 → 43.89 | 40.05 → 45.51 | 41.63 → 45.17 | 40.44 | 44.86 | +4.41 | 45.50 | 34.72 → 36.41 | 0.0171 → 0.0145 | 0.0035 → 0.0028 |
| AO | `occlusion-svgf-auto` | 39.57 → 43.69 | 40.18 → 45.97 | 41.85 → 45.68 | **40.53** | **45.12** | +4.58 | **45.81** | 35.09 → 37.09 | 0.0182 → 0.0158 | 0.0027 → 0.0020 |
| AO | `occlusion-recurrent` | 38.59 → 41.51 | 39.53 → 43.92 | 40.89 → 43.64 | 39.67 | 43.02 | +3.35 | 43.43 | 32.69 → 33.81 | 0.0183 → 0.0164 | 0.0030 → 0.0023 |
| SO | noisy input | 18.95 → 18.95 | 19.33 → 19.33 | 15.36 → 15.36 | 17.88 | 17.88 | +0.00 | | 14.77 → 14.78 | 0.079 → 0.079 | 0.0798 → 0.0798 |
| SO | `occlusion-svgf` | 40.42 → 40.90 | 43.92 → 45.01 | 38.29 → 38.84 | 40.88 | 41.58 | +0.70 | 41.61 | 37.73 → 38.51 | 0.0189 → 0.0183 | 0.0031 → 0.0030 |
| SO | `occlusion-svgf-auto` | 40.86 → 41.39 | 43.85 → 44.91 | 38.97 → 39.62 | **41.22** | **41.97** | +0.75 | **42.01** | 37.91 → 38.72 | 0.0186 → 0.0180 | 0.0032 → 0.0030 |
| SO | `occlusion-recurrent` | 38.30 → 38.59 | 42.43 → 43.18 | 38.23 → 38.77 | 39.66 | 40.18 | +0.52 | 40.20 | 35.29 → 35.72 | 0.0207 → 0.0202 | 0.0023 → 0.0021 |

### Shadows

| denoiser | snapshot | orbit | light | glossy | mean 256 | mean 4096 | Δ | true | penumbra 256 → 4096 | FLIP 256 → 4096 | flicker 256 → 4096 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| noisy input | | 17.91 → 17.91 | 18.84 → 18.84 | 17.93 → 17.93 | 18.22 | 18.23 | +0.00 | | 8.05 → 8.05 | 0.0341 → 0.0341 | 0.0441 → 0.0441 |
| `shadows` v2.2 | 033a869 | 37.73 → 38.06 | 34.35 → 34.49 | 42.44 → 43.41 | **38.17** | **38.65** | +0.48 | **38.66** | 28.52 → 29.05 | 0.0120 → 0.0117 | 0.0019 → 0.0016 |
| `shadows` v2.1 | 7a8b980 | 37.66 → 37.99 | 34.54 → 34.68 | 42.23 → 43.14 | 38.14 | 38.60 | +0.46 | 38.62 | 28.48 → 28.99 | 0.0118 → 0.0116 | 0.0021 → 0.0019 |
| `shadows@sh.clampGeometry=false` (v2.1) | 7a8b980 | 36.41 → 36.66 | 34.12 → 34.25 | 41.61 → 42.39 | 37.38 | 37.77 | +0.39 | 37.78 | 28.21 → 28.70 | 0.0158 → 0.0156 | 0.0025 → 0.0023 |
| `ffx-shadows` | 7a8b980 | 30.49 → 30.55 | 27.88 → 27.91 | 32.72 → 32.82 | 30.36 | 30.43 | +0.06 | 30.43 | 22.13 → 22.22 | 0.0367 → 0.0366 | 0.0039 → 0.0037 |
| `accumulate-32` | 7a8b980 | 27.78 → 27.81 | 14.80 → 14.80 | 34.31 → 34.45 | 25.63 | 25.69 | +0.06 | | 18.51 → 18.58 | 0.0632 → 0.0632 | 0.0075 → 0.0074 |

(v2.2's arm ran in its own page on the same references; its noisy-input and region numbers are
identical to the v2.1 page's.)

## 4. Gaps: 256 vs 4096 spp

Gap to the best arm (pooled dB, mean of `orbit` / `light` / `glossy`; per path in brackets,
256 → 4096). Negative = behind.

| signal | arm vs best | gap @256 | gap @4096 | gap "true" | per path |
|---|---|---|---|---|---|
| diffuse | `svgf` vs `svgf-auto` | −0.31 | **−1.13** | −1.23 | orbit −0.33 → −1.05, light −0.36 → −1.28, glossy −0.23 → −1.05 |
| diffuse | `recurrent` vs `svgf-auto` | −0.75 | **−2.12** | −2.29 | orbit −1.18 → −3.16, light −1.04 → −3.08, glossy −0.01 → −0.11 |
| specular | `svgf` vs `svgf-auto` | −1.91 | **−2.99** | −3.23 | orbit −1.64 → −2.51, light −0.25 → −0.67, glossy −3.83 → −5.79 |
| specular | `recurrent` vs `svgf-auto` | −0.61 | **−1.23** | −1.47 | orbit −1.10 → −1.78, light −0.92 → −2.22, glossy +0.18 → +0.30 |
| AO | `occlusion-svgf` vs `-auto` | −0.09 | −0.26 | −0.31 | orbit +0.08 → +0.20, light −0.13 → −0.46, glossy −0.22 → −0.51 |
| AO | `occlusion-recurrent` vs `-auto` | −0.87 | **−2.09** | −2.38 | orbit −0.98 → −2.19, light −0.65 → −2.06, glossy −0.97 → −2.04 |
| SO | `occlusion-svgf` vs `-auto` | −0.35 | −0.39 | −0.40 | orbit −0.43 → −0.48, light +0.07 → +0.09, glossy −0.68 → −0.78 |
| SO | `occlusion-recurrent` vs `-auto` | −1.57 | −1.79 | −1.81 | orbit −2.55 → −2.79, light −1.42 → −1.74, glossy −0.74 → −0.84 |
| shadows | v2.1 vs v2.2 | −0.03 | −0.05 | −0.04 | orbit −0.07 → −0.08, light +0.19 → +0.19, glossy −0.21 → −0.26 |
| shadows | `clampGeometry: false` vs v2.2 | −0.79 | −0.88 | −0.88 | orbit −1.31 → −1.40, light −0.23 → −0.24, glossy −0.83 → −1.01 |
| shadows | `ffx-shadows` vs v2.2 | −7.81 | **−8.23** | −8.23 | orbit −7.24 → −7.51, light −6.47 → −6.58, glossy −9.71 → −10.59 |

Widening factor (gap @4096 / gap @256): diffuse ×2.8–3.6, AO ×2.4–2.9, specular ×1.6–2.0, SO
×1.1, shadows ×1.05–1.1. FLIP agrees: every FLIP ranking is the same at both references, and the
filters' FLIP drops by 10–25 % against the clean reference (diffuse `svgf-auto` 0.0301 → 0.0224).

## 5. Theory check: measured MSE = true MSE + σ²_ref

If the reference noise is independent of the denoiser output, MSE@256 − MSE@4096 =
σ²_256 − σ²_4096 for every arm, whatever its quality. Predicted from the two floor pairs (§2),
per path, all pixels (MSE ×10⁵, tonemapped units):

| signal | path | predicted σ²_256 − σ²_4096 | measured ΔMSE, range over arms | ratio |
|---|---|---|---|---|
| diffuse | orbit / light / glossy | 5.63 / 5.99 / 8.52 | 5.55–5.63 / 5.86–5.93 / 8.39–8.43 | 0.98–1.00 |
| specular | orbit / light / glossy | 17.06 / 19.15 / 18.29 | 16.82–17.84 / 17.98–18.91 / 17.24–17.73 | 0.94–1.05 |
| AO | orbit / light / glossy | 6.68 / 7.05 / 3.86 | 6.77–6.78 / 7.06–7.09 / 3.82–3.83 | 0.99–1.02 |
| SO | orbit / light / glossy | 0.94 / 0.90 / 1.76 | 0.94–0.94 / 0.90–0.90 / 1.75–1.76 | 1.00–1.01 |
| shadows | orbit / light / glossy | 1.27 / 1.13 / 1.16 | 1.26–1.28 / 1.11–1.14 / 1.14–1.15 | 0.98–1.01 |

The same offset applies to a noisy input at 14 dB and to A-SVGF at 46 dB: the reference noise
is a fixed additive term (specular's ±5 % comes from its heavy-tailed reference and the 32-frame
4096 floor). So rankings are safe at 256 spp, and any gap can be corrected after the fact:
true MSE ≈ MSE@256 − σ²_256, with σ²_256 from §2. The per-arm table is in `e1-table.mjs`'s output.

## 6. Seven paths (occlusion, shadows) and five paths (diffuse, specular)

The same pages on `pan`, `thin`, `cut` and `object`. Occlusion and shadows cover all 7 paths.
Diffuse / specular cover 5 (`orbit`, `pan`, `light`, `glossy`, `object`): both `joint-thin` and
`joint-cut` lost their GPU device mid-run (`mapAsync … valid external Instance reference no
longer exists`) while another agent ran 2048-spp real-scene captures. A solo rerun of `joint-thin`
then managed ~7 min per frame under that load, so I dropped those two. The 256-spp means reproduce
SPEC §0.2 exactly where the path set is the same: occlusion 38.93 / 39.03 / 38.02 (AO) and
38.76 / 39.68 / 37.37 (SO), shadows v2.1 38.12.

Mean of per-path pooled dB, 256 → 4096 spp:

| signal (paths) | denoiser | mean 256 | mean 4096 | Δ | region 256 → 4096 | FLIP 256 → 4096 | gap to best @256 → @4096 |
|---|---|---|---|---|---|---|---|
| diffuse (5) | `svgf-auto` | **39.87** | **45.41** | +5.53 | disocc. 37.39 → 40.42 | 0.0318 → 0.0244 | best |
| diffuse (5) | `svgf` | 39.60 | 44.47 | +4.87 | 37.24 → 40.17 | 0.0342 → 0.0285 | −0.27 → **−0.93** |
| diffuse (5) | `recurrent` | 38.92 | 42.90 | +3.98 | 36.00 → 37.99 | 0.0396 → 0.0350 | −0.95 → **−2.51** |
| diffuse (5) | `accumulate-32` | 26.79 | 26.97 | +0.18 | 19.70 → 19.73 | 0.0754 → 0.0748 | −13.08 → −18.44 |
| specular (5) | `svgf-auto` | **34.91** | **38.27** | +3.36 | disocc. 34.93 → 36.86 | 0.0465 → 0.0400 | best |
| specular (5) | `recurrent` | 33.95 | 36.37 | +2.41 | 33.51 → 34.76 | 0.0522 → 0.0475 | −0.96 → **−1.91** |
| specular (5) | `svgf` | 33.22 | 35.46 | +2.24 | 33.93 → 35.39 | 0.0514 → 0.0453 | −1.69 → **−2.81** |
| specular (5) | `accumulate-32` | 24.03 | 24.25 | +0.22 | 21.82 → 21.88 | 0.1077 → 0.1068 | −10.88 → −14.02 |
| AO (7) | `occlusion-svgf-auto` | **39.03** | **43.66** | +4.63 | contact 34.25 → 35.83 | 0.0205 → 0.0171 | best |
| AO (7) | `occlusion-svgf` | 38.93 | 43.43 | +4.51 | 33.66 → 35.03 | 0.0191 → 0.0156 | −0.10 → −0.23 |
| AO (7) | `occlusion-recurrent` | 38.02 | 41.33 | +3.31 | 31.16 → 31.94 | 0.0205 → 0.0177 | −1.01 → **−2.33** |
| SO (7) | `occlusion-svgf-auto` | **39.68** | **40.26** | +0.58 | contact 36.64 → 37.24 | 0.0196 → 0.0190 | best |
| SO (7) | `occlusion-svgf` | 38.76 | 39.26 | +0.50 | 35.66 → 36.17 | 0.0202 → 0.0197 | −0.92 → −1.00 |
| SO (7) | `occlusion-recurrent` | 37.37 | 37.73 | +0.36 | 33.47 → 33.76 | 0.0225 → 0.0220 | −2.31 → −2.53 |
| shadows (7) | `shadows` v2.2 (033a869) | **38.22** | **38.76** | +0.54 | penumbra 29.17 → 29.76 | 0.0131 → 0.0128 | best |
| shadows (7) | `shadows` v2.1 (7a8b980) | 38.12 | 38.65 | +0.52 | 29.06 → 29.62 | 0.0129 → 0.0127 | −0.09 → −0.11 |
| shadows (7) | `clampGeometry: false` (v2.1) | 37.15 | 37.56 | +0.41 | 28.64 → 29.14 | 0.0182 → 0.0179 | −1.07 → −1.20 |
| shadows (7) | `ffx-shadows` | 31.20 | 31.30 | +0.10 | 23.50 → 23.64 | 0.0379 → 0.0377 | −7.02 → −7.47 |
| shadows (7) | `accumulate-32` | 25.58 | 25.62 | +0.04 | 18.55 → 18.61 | 0.0421 → 0.0419 | −12.64 → −13.14 |

Per path, no ordering flips here either. The closest pairs keep their sign: AO SVGF vs `auto`
on `pan` +0.16 → +0.43, `cut` +0.09 → +0.23, `thin` −0.03 → −0.16; shadows v2.1 vs v2.2 on `object`
−0.03 → −0.04. The extra paths widen the recurrent gaps further: diffuse `pan` −1.45 → −3.51 and
`object` −1.06 → −2.68, specular `object` −1.62 → −3.67, AO `object` −1.89 → −3.44. The 7-path
noise floors were not measured (the theory check in §5 makes them predictable from any two
independent references).

## 7. Notes

- Rendering a 4096-spp reference set costs ~5.5 s per 1080p frame for five signals on the M5 Pro;
  a whole 96-frame path is ~10 min alone. Cheap enough to make high references the default for
  any decision run that compares close filters.
- A floor-only page needs `&denoiser=` (empty). Without it the test bed runs every registered
  denoiser on every signal; at 1080p with five signals that ran the tab out of memory (LESSONS).
