# T8: camera jitter and sub-pixel motion (review target 8)

_2026-10-26, T8 evaluator (RULES.md rule 8: no NRD code, README, release notes, port or quarantined file read). Brief:
[sources/nrd-review-targets.md](../sources/nrd-review-targets.md) target 8. Measured on our test bed (Apple M5 Pro,
HeadlessChrome 155, Metal). Package at HEAD 4a55458 (unchanged; nothing built in `packages/`). Test bed jitter option:
978939f._

## 0. Conclusion

**No action needed for the denoisers. There is one documentation fix, for an integration error.**

- **With jitter-free motion (the convention), enabling camera jitter introduces no artefact in any shipped default**
  (`svgf-auto` diffuse / specular, `recurrent` diffuse / specular, `shadows`, `occlusion-svgf-auto` AO / SO, on `thin`
  and `glossy`, with still holds and a 0.29 px/frame pan):
  - **Settled brightness unchanged:** jitter on vs off differs by ≤ 0.07 % of mean luminance, every signal, window and
    scene.
  - **No crawling beyond the input's own:** at still edges the outputs fluctuate as much as the jittered reference's
    own per-frame aliasing: the boundary temporal std ratio output / reference is 0.87–1.03 (0.84–1.09 over all
    pixels). The denoisers add no crawl of their own.
  - **No double edges:** boundary bias against the pixel-area reference is ≤ 0.003 (shadows −0.009, the reference's
    own value). Edge sharpness against the per-frame reference is unchanged on thin (±0.02). On glossy, specular and SO
    lose 5–9 % and shadows 2 %.
  - **Boil:** 6 of 105 rows exceed rule 9's boil clause by margins of 0.5–8 %, all on thin (specular, mostly A-SVGF on
    the holds: 0.0015 vs the jittered reference's 0.0014), none on glossy (§3). Not visible, not acted on.
  - **Glossy specular is 5 % softer:** sharpness against the pixel-area reference is 0.583 vs 0.615 (A-SVGF) and 0.575
    vs 0.610 (recurrent). That is the 1-px footprint averaging that history across jitter phases implies, the same as a
    TAA resolve.
  - **Sub-pixel pan coherent:** pan-window scores with jitter on vs off are within ±0.2 dB on thin, except shadows
    −0.47 and SO −0.71 dB. On glossy the pan shows the same offsets as the holds, with no motion-specific excess.
- **What does rise is error against the per-frame reference at boundaries: 0–4 dB, FLIP +0…47 %.** This is phase
  mixing, not an artefact:
  - Under jitter, the per-frame point-sampled reference R1 differs from its own pixel-area average R2 by 16–30 dB at
    boundaries (thin shadows 16.5 dB).
  - Any filter that reuses history lands between R1 and R2. Measured against R2, every output is within −1.1…+0.2 dB of
    the reference's own distance (§4.2).
  - Loosening the history tests (`planeDistance=1`, `normalThreshold=0`) moves the outputs by ≤ 0.3 dB, so it is not
    history rejection at jittered edges (§5).
  - Compensating the jitter instead (resampling history at sub-pixel offsets) was measured as a loss for the FFX
    denoisers on 2026-10-15 (`exp/jitter-study`, −1.4 dB on static shadows): it blurs.
  - Nothing to build.
- **The integration error is real:** motion that includes the jitter delta does damage. This is what three's raw
  `velocity` gives under a jittered projection when it isn't given the unjittered projection.
  - Shadows boil +24…104 %, ending above both the reference's and the correct run's boil (rule 9 boil clause).
  - Glossy specular is 10 % softer against R2 (0.583 → 0.521).
  - AO boundary −2.2 dB on glossy; boil +10…40 % on most signals.
- **Documentation fix:** `docs/site/guides/realtime-denoisers.mdx` now says motion must be jitter-free, i.e.
  `velocity.setProjectionMatrix(unjittered)`, as `@pmndrs/upscaler` and three's TRAA / TAAU nodes already do.
  The renderer contract had only said "three.js' `velocity` node".
- **SPEC deviation filed (TASKS, spec author):** SPEC C-1 / C-6 describe reconstruction at the jittered sample
  position, but the code uses the pixel centre and never reads `FrameCamera.jitter`. The code's behaviour is the one
  measured here.

## 1. Setup

| | |
|---|---|
| test bed | `&jitter=halton8` (978939f): pixel p's primary ray goes through `p + 0.5 + j`, with j = Halton(2, 3) point `(frame mod 8) + 1` − 0.5 px, FSR's native-resolution phase count. Only the ray generation's inverse view-projection is jittered. Depth, motion (`ndc_sample − ndc_prev`, CAPTURE-FORMAT) and every reference keep the unjittered matrices, and `FrameCamera.jitter` carries j. Default off: no shader change, eval JSON identical to HEAD (thin, 8 frames, 4 denoisers, 5 signals) |
| paths | `thin-jit`, `glossy-jit`: the original path's frame-48 pose held for frames 0–31; a sub-pixel pan for 32–63 (the original motion at 1/8 speed, measured median 0.29 / 0.25 px per frame, p95 0.54 / 0.88); end pose held for 64–95. Windows fixed before scoring: holdA 16–31, pan 40–63, holdB 80–95 (16 / 24 / 16 frames, i.e. 2 / 3 / 2 jitter cycles) |
| captures | 960×540, 96 frames, all three signals plus AO / SO references, **1024-spp references**. `t8-<scene>-off`, `t8-<scene>-h8` (jitter), `t8-<scene>-h8-raw` (same files, motion plus the jitter delta: [make-raw.mjs](data/t8-jitter/make-raw.mjs)). All pass `validate.mjs`: motion reprojection mean 1.2e-5 px; history consistency 0.983 / 0.993 jittered vs 0.995 / 0.999 off |
| denoisers | shipped defaults: `svgf-auto` (diffuse + specular), `recurrent`, `shadows`, `occlusion-svgf-auto` (AO + SO), replayed `warm=0` |
| references | **R1** = the capture's per-frame reference, at the same sample positions as the 1-spp input (jittered when it is). **R2** (holds only) = R1's mean over the window: the pixel-area average the jitter sequence integrates. For jitter off, R2 = R1 bit for bit (fixed-seed references, still pose). Jittered pixels are never scored against unjittered ones |
| scorer | [score.mjs](data/t8-jitter/score.mjs), tables [table.mjs](data/t8-jitter/table.mjs). Scoring values as the test bed (rgb x/(1+x), scalars clamped). Pooled PSNR and boundary PSNR (the T6 region, recomputed per frame from the capture's G-buffer); FLIP every 4th window frame, all pixels and boundary only; motion-compensated boil on reference-smooth pixels with the reference's own boil as floor (q20 (a)); brightness = Σ lum(out) / Σ lum(ref) − 1 on linear values; edge sharpness = Σ\|∇out\| / Σ\|∇ref\| where \|∇ref\| > 0.05 (rgb) / 0.1 (scalar); per-pixel temporal std over a hold, on pixels that are receivers in every frame of it |

Raw JSON: [data/t8-jitter/raw/](data/t8-jitter/raw/). Full tables: [data/t8-jitter/tables.md](data/t8-jitter/tables.md).

## 2. The convention, end to end

| who | what it passes / expects | jitter |
|---|---|---|
| CAPTURE-FORMAT / SPEC C-1 | `motion = ndc_sample − ndc_prev`, both through the **unjittered** projection: no jitter delta. `jitter` in pixels, sample at `p + 0.5 + j` | defined |
| test bed (978939f) | exactly that (validator: 1e-5 px). Before this task it never jittered | `&jitter=halton8` |
| our denoisers (`packages/denoiser-realtime`) | reconstruct and reproject at the **pixel centre**: `common.ts` `reproject` (`uvOf(p)`), `recurrent.ts` ("jitter ignored"), shadows the same. Never read `FrameCamera.jitter` | ignored: history stays at the pixel centre, as in a TAA resolve. SPEC C-1 / C-6 say `uv_s` (sample position): deviation filed |
| `denoiser/three` `TemporalDenoiseNode` | removes `camera.view` offsets (`setViewOffset` jitter) from the projection, passes three's `velocity` as motion, `jitter: [0, 0]` | correct if `velocity` is jitter-free |
| three's `velocity` node | `ndc_cur − ndc_prev` with the camera's projection, i.e. **with** the jitter delta under a jittered projection, unless `velocity.setProjectionMatrix(unjittered)` | @pmndrs/upscaler (UpscalerNode / UpscalePass), three's TRAANode / TAAUNode set it. A hand-rolled `setViewOffset` jitter does not |
| three-temporal pages | realtime pages (`realtime-gi`, `-scenes`, `-shadows`, `-glass`): no jitter ("raster without TAA"). `shadows` / `shadows-split` / `reflections-hybrid` jitter only on their upscaler path (FFX denoisers; the upscaler fixes velocity) | consistent |
| @pmndrs/upscaler (GUIDES-HANDOFF-RESPONSE report 3) | expects `velocityUV − jitterDeltaUV`, i.e. the same jitter-free motion; subtracts the jitter delta inside its own reprojection | consistent |

Native NRD's jitter is passed in pixels (PHASE4-5.md, confirmed); our captures were all unjittered until now.

## 3. Jitter off vs on, each against its own reference (R1)

Δ = on − off. Full per-window tables (holdB, pan for every signal) are in [tables.md](data/t8-jitter/tables.md).

| scene, window | signal | denoiser | PSNR Δ | boundary PSNR Δ | FLIP Δ | boundary FLIP Δ | boil off → on [ref on] | sharpness off / on |
|---|---|---|---|---|---|---|---|---|
| thin, holdA | diffuse | svgf-auto | -0.25 | -1.66 | +1 % | +6 % | 0.0008 → 0.0013 [0.0013] | 0.354 / 0.355 |
| thin, holdA | diffuse | recurrent | +0.00 | +0.02 | -1 % | -4 % | 0.0009 → 0.0011 [0.0013] | 0.299 / 0.316 |
| thin, holdA | specular | svgf-auto | -0.55 | -1.05 | +4 % | +7 % | 0.0011 → 0.0015 [0.0014] | 0.692 / 0.685 |
| thin, holdA | specular | recurrent | -0.29 | -0.39 | +2 % | +1 % | 0.0019 → 0.0020 [0.0014] | 0.611 / 0.634 |
| thin, holdA | visibility | shadows | -1.54 | -2.03 | +9 % | +9 % | 0.0042 → 0.0027 [0.0011] | 0.980 / 0.970 |
| thin, holdA | ao | occlusion-svgf-auto | -0.73 | -2.36 | +2 % | +5 % | 0.0012 → 0.0015 [0.0021] | 0.975 / 0.973 |
| thin, holdA | so | occlusion-svgf-auto | -1.37 | -2.27 | +5 % | +6 % | 0.0051 → 0.0040 [0.0020] | 1.005 / 0.994 |
| thin, pan | diffuse | svgf-auto | +0.02 | +0.15 | +0 % | +2 % | 0.0011 → 0.0015 [0.0015] | 0.347 / 0.346 |
| thin, pan | diffuse | recurrent | -0.02 | -0.04 | -0 % | -2 % | 0.0010 → 0.0011 [0.0015] | 0.305 / 0.310 |
| thin, pan | specular | svgf-auto | -0.10 | -0.09 | +3 % | +2 % | 0.0014 → 0.0016 [0.0016] | 0.676 / 0.672 |
| thin, pan | specular | recurrent | -0.04 | +0.08 | +1 % | -1 % | 0.0021 → 0.0021 [0.0016] | 0.618 / 0.627 |
| thin, pan | visibility | shadows | -0.47 | -0.07 | +4 % | -4 % | 0.0032 → 0.0026 [0.0011] | 0.972 / 0.966 |
| thin, pan | ao | occlusion-svgf-auto | -0.17 | -0.34 | +1 % | +1 % | 0.0013 → 0.0015 [0.0023] | 0.972 / 0.969 |
| thin, pan | so | occlusion-svgf-auto | -0.71 | -0.78 | +4 % | +3 % | 0.0050 → 0.0041 [0.0021] | 0.988 / 0.983 |
| glossy, holdA | diffuse | svgf-auto | -0.15 | -0.37 | +1 % | +2 % | 0.0008 → 0.0009 [0.0012] | 0.902 / 0.900 |
| glossy, holdA | diffuse | recurrent | -0.09 | -0.02 | +1 % | -1 % | 0.0008 → 0.0008 [0.0012] | 0.845 / 0.864 |
| glossy, holdA | specular | svgf-auto | -1.17 | -3.66 | +6 % | +20 % | 0.0012 → 0.0011 [0.0016] | 0.615 / 0.564 |
| glossy, holdA | specular | recurrent | -0.94 | -2.94 | +5 % | +18 % | 0.0032 → 0.0029 [0.0016] | 0.610 / 0.555 |
| glossy, holdA | visibility | shadows | -3.63 | -4.04 | +35 % | +47 % | 0.0025 → 0.0011 [0.0010] | 0.959 / 0.940 |
| glossy, holdA | ao | occlusion-svgf-auto | -0.72 | -1.48 | +2 % | +4 % | 0.0011 → 0.0011 [0.0018] | 0.947 / 0.937 |
| glossy, holdA | so | occlusion-svgf-auto | -1.20 | -2.92 | +4 % | +7 % | 0.0038 → 0.0034 [0.0019] | 0.974 / 0.929 |
| glossy, pan | diffuse | svgf-auto | -0.12 | -0.31 | +1 % | +2 % | 0.0008 → 0.0009 [0.0016] | 0.902 / 0.899 |
| glossy, pan | diffuse | recurrent | -0.10 | -0.01 | +1 % | -1 % | 0.0007 → 0.0007 [0.0016] | 0.871 / 0.878 |
| glossy, pan | specular | svgf-auto | -0.70 | -2.05 | +5 % | +10 % | 0.0013 → 0.0012 [0.0019] | 0.571 / 0.536 |
| glossy, pan | specular | recurrent | -0.56 | -1.03 | +3 % | +5 % | 0.0031 → 0.0029 [0.0019] | 0.563 / 0.531 |
| glossy, pan | visibility | shadows | -3.95 | -3.10 | +36 % | +22 % | 0.0021 → 0.0010 [0.0010] | 0.955 / 0.936 |
| glossy, pan | ao | occlusion-svgf-auto | -0.70 | -1.33 | +2 % | +3 % | 0.0012 → 0.0012 [0.0019] | 0.944 / 0.934 |
| glossy, pan | so | occlusion-svgf-auto | -1.11 | -2.63 | +4 % | +6 % | 0.0039 → 0.0035 [0.0020] | 0.955 / 0.918 |

Settled brightness is identical to ≤ 0.07 % in every row of every window (e.g. thin diffuse A-SVGF −0.70 / −0.69 %,
glossy shadows +0.01 / +0.01 %).

Boil: the jittered reference boils more than the unjittered one (0 → 0.0010–0.0023), because shading gradients move by
a sub-pixel step every frame. Applying rule 9's boil clause (above both the jittered reference's boil and the jitter-off
output's), 6 of 105 rows exceed it, all on `thin`:
- A-SVGF specular on the holds: 0.00154 / 0.00149 against the reference's 0.00142, +5…8 %.
- Recurrent specular: 0.00199–0.00212 against its own jitter-off 0.00191–0.00211, +0.5…6 %.
- A-SVGF diffuse holdA: 0.00131 against 0.00130.

`glossy`, the specular scene, has none. These are 1e-4-level margins on a reference whose own boil comes from the
jitter. No crawling-highlight artefact is visible in them, and nothing to act on.

## 4. Why the boundary error against R1 is not an artefact

### 4.1 The outputs fluctuate exactly as much as the reference

Per-pixel temporal std over the hold, on pixels that stay receivers throughout:

| scene | signal | denoiser | all: output / reference (ratio) | boundary: output / reference (ratio) | jitter off, boundary output |
|---|---|---|---|---|---|
| thin | diffuse | svgf-auto | 0.0083 / 0.0085 (0.98) | 0.0242 / 0.0234 (1.03) | 0.0037 |
| thin | diffuse | recurrent | 0.0076 / 0.0085 (0.89) | 0.0204 / 0.0234 (0.87) | 0.0041 |
| thin | specular | svgf-auto | 0.0119 / 0.0119 (1.01) | 0.0347 / 0.0342 (1.02) | 0.0051 |
| thin | specular | recurrent | 0.0118 / 0.0119 (1.00) | 0.0325 / 0.0342 (0.95) | 0.0076 |
| thin | visibility | shadows | 0.0460 / 0.0466 (0.99) | 0.1346 / 0.1361 (0.99) | 0.0117 |
| thin | ao | occlusion-svgf-auto | 0.0128 / 0.0129 (1.00) | 0.0371 / 0.0363 (1.02) | 0.0043 |
| thin | so | occlusion-svgf-auto | 0.0198 / 0.0187 (1.06) | 0.0544 / 0.0531 (1.03) | 0.0122 |
| glossy | diffuse | svgf-auto | 0.0047 / 0.0047 (1.01) | 0.0254 / 0.0258 (0.99) | 0.0059 |
| glossy | diffuse | recurrent | 0.0051 / 0.0047 (1.09) | 0.0239 / 0.0258 (0.93) | 0.0054 |
| glossy | specular | svgf-auto | 0.0085 / 0.0102 (0.84) | 0.0459 / 0.0506 (0.91) | 0.0042 |
| glossy | specular | recurrent | 0.0103 / 0.0102 (1.01) | 0.0454 / 0.0506 (0.90) | 0.0065 |
| glossy | visibility | shadows | 0.0178 / 0.0197 (0.90) | 0.0976 / 0.0995 (0.98) | 0.0066 |
| glossy | ao | occlusion-svgf-auto | 0.0089 / 0.0093 (0.96) | 0.0486 / 0.0507 (0.96) | 0.0045 |
| glossy | so | occlusion-svgf-auto | 0.0127 / 0.0123 (1.03) | 0.0634 / 0.0653 (0.97) | 0.0103 |

A pixel on a silhouette or a hard shadow edge sees a different surface or visibility from one jitter phase to the next.
The reference shows that flip (its boundary std is 0.02–0.14), and so does every output, at 0.87–1.03× the
reference's level. The denoisers add
no fluctuation of their own, and they don't suppress the flip either: their spatial passes use this frame's guides, and
their clamps track this frame's neighbourhood. The output keeps the frame's sample positions for the TAA or upscaler
downstream.

### 4.2 Against the pixel-area reference the outputs are as close as the reference itself

Boundary PSNR against R2 (holdA): the output vs the jittered reference R1, both measured against R2.

| scene | signal | denoiser | output vs R2 | reference R1 vs R2 | Δ | output vs R1 (jitter on) | jitter off: output vs its reference |
|---|---|---|---|---|---|---|---|
| thin | diffuse | svgf-auto | 29.55 | 30.37 | -0.82 | 35.48 | 37.14 |
| thin | diffuse | recurrent | 30.02 | 30.37 | -0.35 | 34.68 | 34.66 |
| thin | specular | svgf-auto | 26.53 | 27.64 | -1.11 | 31.83 | 32.88 |
| thin | specular | recurrent | 26.89 | 27.64 | -0.76 | 31.47 | 31.86 |
| thin | visibility | shadows | 16.52 | 16.53 | -0.01 | 29.47 | 31.50 |
| thin | ao | occlusion-svgf-auto | 27.29 | 28.01 | -0.72 | 34.20 | 36.56 |
| thin | so | occlusion-svgf-auto | 24.98 | 25.41 | -0.44 | 33.15 | 35.42 |
| glossy | diffuse | svgf-auto | 28.24 | 28.82 | -0.57 | 34.44 | 34.81 |
| glossy | diffuse | recurrent | 29.01 | 28.82 | +0.19 | 37.18 | 37.20 |
| glossy | specular | svgf-auto | 24.34 | 24.16 | +0.18 | 30.44 | 34.10 |
| glossy | specular | recurrent | 24.03 | 24.16 | -0.14 | 29.02 | 31.97 |
| glossy | visibility | shadows | 20.01 | 19.90 | +0.11 | 32.57 | 36.61 |
| glossy | ao | occlusion-svgf-auto | 26.09 | 26.04 | +0.05 | 35.98 | 37.46 |
| glossy | so | occlusion-svgf-auto | 24.04 | 23.96 | +0.08 | 33.26 | 36.18 |

The reference's own distance from R2 at boundaries (16–30 dB) dwarfs the 0–4 dB rise of the outputs' error against R1.
Between the two targets, the outputs sit within −1.1…+0.2 dB of the reference. A filter that reuses any history cannot
match a per-frame target that changes by that much at every phase. A filter that rejected history at every flip would
be noisier.

## 5. Mechanism check: not history rejection

GUIDES-HANDOFF-RESPONSE report 3 (hint 2) found an accumulator that reset history at every jittered depth flip. We
replayed `t8-thin-h8` holdA with the history tests effectively off:

| signal | denoiser | boundary PSNR vs R1, default / tests off | boundary temporal std, default / tests off (reference) |
|---|---|---|---|
| diffuse | `svgf-auto` / `planeDistance=1&normalThreshold=0` | 35.48 / 35.54 | 0.0359 / 0.0350 (0.0321)* |
| specular | same | 31.83 / 31.57 | 0.0459 / 0.0443 (0.0439)* |
| visibility | `shadows` / `planeDistance=1` | 29.47 / 29.47 | 0.1479 / 0.1479 (0.1494)* |

\* first-pass std, which still counted frames where a pixel was sky; same masking for all three columns.

Accepting every tap changes ≤ 0.3 dB: our plane test already accepts the sub-pixel flips. Running anti-lag off
(`svgf`, `occlusion-svgf`) or the recurrent occlusion filter gives the same boundary fluctuation as A-SVGF
(AO 0.0829 / 0.0825 / 0.0818 first-pass), so it isn't anti-lag either.

## 6. Integration error: motion with the jitter delta

`t8-<scene>-h8-raw` is the jittered capture with `motion += o_cur − o_prev` (o = (−2 jx / W, +2 jy / H)): three's
`velocity` under a jittered projection without `setProjectionMatrix(unjittered)`. Same R1 / R2 as `-h8`. Selected
rows; all rows are in tables.md.

| scene, window | signal | denoiser | boundary PSNR ok / raw | boil ok / raw [ref] | sharpness vs R1 ok / raw | sharpness vs R2 ok / raw |
|---|---|---|---|---|---|---|
| thin, holdA | diffuse | svgf-auto | 35.48 / 35.27 | 0.0013 / 0.0015 (+11 %) [0.0013] | 0.355 / 0.349 | 0.335 / 0.329 |
| thin, holdA | diffuse | recurrent | 34.68 / 34.83 | 0.0011 / 0.0012 (+17 %) [0.0013] | 0.316 / 0.306 | 0.300 / 0.288 |
| thin, holdA | specular | svgf-auto | 31.83 / 31.28 | 0.0015 / 0.0017 (+8 %) [0.0014] | 0.685 / 0.671 | 0.653 / 0.636 |
| thin, holdA | specular | recurrent | 31.47 / 31.58 | 0.0020 / 0.0024 (+20 %) [0.0014] | 0.634 / 0.636 | 0.608 / 0.604 |
| thin, holdA | visibility | shadows | 29.47 / 27.13 | 0.0027 / 0.0034 (+24 %) [0.0011] | 0.970 / 0.976 | 0.964 / 0.970 |
| thin, holdA | ao | occlusion-svgf-auto | 34.20 / 33.70 | 0.0015 / 0.0017 (+18 %) [0.0021] | 0.973 / 0.968 | 1.004 / 0.997 |
| thin, holdA | so | occlusion-svgf-auto | 33.15 / 33.28 | 0.0040 / 0.0048 (+19 %) [0.0020] | 0.994 / 0.982 | 1.058 / 1.040 |
| thin, pan | diffuse | svgf-auto | 35.68 / 35.59 | 0.0015 / 0.0014 (-2 %) [0.0015] | 0.346 / 0.346 | – |
| thin, pan | diffuse | recurrent | 34.86 / 34.79 | 0.0011 / 0.0011 (-1 %) [0.0015] | 0.310 / 0.301 | – |
| thin, pan | specular | svgf-auto | 31.68 / 31.45 | 0.0016 / 0.0016 (-2 %) [0.0016] | 0.672 / 0.671 | – |
| thin, pan | specular | recurrent | 31.49 / 31.50 | 0.0021 / 0.0023 (+8 %) [0.0016] | 0.627 / 0.622 | – |
| thin, pan | visibility | shadows | 27.16 / 28.08 | 0.0026 / 0.0035 (+36 %) [0.0011] | 0.966 / 0.977 | – |
| thin, pan | ao | occlusion-svgf-auto | 34.06 / 33.96 | 0.0015 / 0.0016 (+5 %) [0.0023] | 0.969 / 0.968 | – |
| thin, pan | so | occlusion-svgf-auto | 32.90 / 33.48 | 0.0041 / 0.0050 (+22 %) [0.0021] | 0.983 / 0.985 | – |
| glossy, holdA | diffuse | svgf-auto | 34.44 / 33.64 | 0.0009 / 0.0010 (+10 %) [0.0012] | 0.900 / 0.882 | 0.798 / 0.779 |
| glossy, holdA | diffuse | recurrent | 37.18 / 36.75 | 0.0008 / 0.0009 (+24 %) [0.0012] | 0.864 / 0.860 | 0.762 / 0.754 |
| glossy, holdA | specular | svgf-auto | 30.44 / 30.71 | 0.0011 / 0.0015 (+41 %) [0.0016] | 0.564 / 0.514 | 0.583 / 0.521 |
| glossy, holdA | specular | recurrent | 29.02 / 28.35 | 0.0029 / 0.0033 (+14 %) [0.0016] | 0.555 / 0.524 | 0.575 / 0.536 |
| glossy, holdA | visibility | shadows | 32.57 / 31.21 | 0.0011 / 0.0019 (+71 %) [0.0010] | 0.940 / 0.935 | 0.987 / 0.971 |
| glossy, holdA | ao | occlusion-svgf-auto | 35.98 / 33.78 | 0.0011 / 0.0014 (+25 %) [0.0018] | 0.937 / 0.906 | 1.024 / 0.985 |
| glossy, holdA | so | occlusion-svgf-auto | 33.26 / 33.36 | 0.0034 / 0.0040 (+18 %) [0.0019] | 0.929 / 0.887 | 1.044 / 0.984 |
| glossy, pan | diffuse | svgf-auto | 34.41 / 33.64 | 0.0009 / 0.0009 (+6 %) [0.0016] | 0.899 / 0.888 | – |
| glossy, pan | diffuse | recurrent | 37.68 / 37.05 | 0.0007 / 0.0008 (+14 %) [0.0016] | 0.878 / 0.870 | – |
| glossy, pan | specular | svgf-auto | 29.66 / 30.54 | 0.0012 / 0.0016 (+35 %) [0.0019] | 0.536 / 0.510 | – |
| glossy, pan | specular | recurrent | 28.48 / 28.15 | 0.0029 / 0.0033 (+13 %) [0.0019] | 0.531 / 0.511 | – |
| glossy, pan | visibility | shadows | 32.60 / 30.85 | 0.0010 / 0.0020 (+104 %) [0.0010] | 0.936 / 0.931 | – |
| glossy, pan | ao | occlusion-svgf-auto | 35.98 / 33.87 | 0.0012 / 0.0014 (+18 %) [0.0019] | 0.934 / 0.905 | – |
| glossy, pan | so | occlusion-svgf-auto | 33.52 / 33.63 | 0.0035 / 0.0040 (+14 %) [0.0020] | 0.918 / 0.890 | – |

Every pixel "moves" by the jitter step, so history is fetched up to ~0.8 px off and resampled bilinearly each frame:
- Shadows boil +24…104 %, above both the reference's (0.0010–0.0011) and the correct run's boil.
- Glossy specular loses 10 % sharpness against R2.
- Glossy AO loses 2.1–2.4 dB at boundaries.

Some whole-frame PSNRs against R1 rise (shadows on glossy +1.1…+2.0 dB): the blur averages the phase flips, at the
cost of boil and sharpness. **Fix: documentation.** The renderer contract in
`docs/site/guides/realtime-denoisers.mdx` now requires jitter-free motion and names `velocity.setProjectionMatrix(...)`.

## 7. What was not done

- No 1080p or real-scene jitter captures. The three.js realtime pages don't jitter, and the upscaler / TRAA paths
  already produce jitter-free velocity.
- No other jitter sequences or periods (Halton 8 only).
- No jitter-aware history resampling option: the outputs already match the reference's fluctuation, and the earlier
  FFX study measured compensation as a loss.

## Reproduce

```sh
# mirror or worktree test bed on a spare port (RT_CAPTURE_DIR = scratch); per scene and jitter:
node examples/realtime-denoiser/run-headless.mjs "mode=capture&name=t8-thin-h8&path=thin-jit&jitter=halton8&signal=all,ao,so&refspp=1024"
node docs/research/rt-denoiser/results/data/t8-jitter/make-raw.mjs t8-thin-h8          # -> t8-thin-h8-raw
node examples/realtime-denoiser/run-headless.mjs "mode=replay&capture=t8-thin-h8&denoiser=svgf-auto&warm=0"   # + recurrent, shadows, occlusion-svgf-auto
node docs/research/rt-denoiser/results/data/t8-jitter/score.mjs t8-thin-h8 --denoisers svgf-auto,recurrent,shadows,occlusion-svgf-auto --json raw/t8-thin-h8.json
node docs/research/rt-denoiser/results/data/t8-jitter/table.mjs raw/
```
