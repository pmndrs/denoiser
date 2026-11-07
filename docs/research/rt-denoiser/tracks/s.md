# Track S (shadows), phase 1: diagnosis

_Agent S, 2026-11-07, implementer role (RULES.md rule 8). No NRD / NRD-Sample code, README, fork or port was opened; the
FFX port in `packages/denoiser-ffx` (MIT) was read for comparison. Branch `track/s-shadows`, worktree
`../Denoiser-track-s`. No default changed in `packages/denoiser-realtime`: the three new options (one diagnostic, two experiments)
are off by default and leave the default WGSL text unchanged (byte check in §8)._

## 0. In one paragraph

The knot's wall shadow that boiled on 10-25 is at FFX's level today (static close-up: boil 0.0010 vs 0.0011), and where
shadows really move ours is as calm as FFX while tracking them (FFX lags 1.4 frames on a moving light, ours 0). What is
left is a **tail** problem in static penumbrae: isolated pops, 1.4–2.9× FFX's 99th percentile on every capture, 1.5–2× its
pop count, on the knot scene with the live page's own camera drift (re-captured here: the kept captures never had it) and
worst on `sponza-move` (sun, moving occluder: RMS boil 2× FFX). The ranked cause is the temporal **anti-lag restarting
histories on statistical false alarms** of a clamp that compares two noisy estimates (5–9 % of penumbra pixels at any
frame); then the **stabilizer's box gate** switching it off where the boil is (10–22 % of penumbra pixels); then the
**geometry-tested clamp window** under camera motion; then contacts (q23 / q29); and on fast cameras the input's
blue-noise stratification breaks (variance ×2.3), which a raw-sample history pays and FFX's filtered history doesn't.
Neither the knot's motion nor the camera drift itself is the cause. The best measured combinations (history-aware clamp window or
significance-gated restart, + 2× stabilizer box) put boil and p99 at or below FFX on the knot captures, but cost 1.6–2.2 dB
of tracking on moving shadows (still better than FFX's), so phase 2's first fix is a significance-gated restart (measured as `antiLagNoise`: −10 … −27 % boil at 40 % of that
tracking cost; with the 2× box, at or below FFX's boil and p99 on all three knot captures, still tracking better than FFX). Detail is not at risk
(FLIP 0.016–0.019 vs FFX 0.047–0.055). Cost: 0.62 / 0.72 ms (`orbit` / `thin`); 69 % is the temporal pass doing full
work in tiles with nothing to do, and a uniform-tile fast path (probe ceiling −0.19 ms) is the way to ≤ 0.6. Metrics:
nearest-tap motion compensation and RMS-only boil mis-rank us on moving cameras; T0 needs bilinear compensation and a
tail number.

## 1. What was measured, and how

**Captures** (960×540, 2048-ray per-pose visibility references, blue-noise 1-ray input; read only from the kept set by
symlink, outputs in this worktree):

| capture | camera | knot | frames | why |
|---|---|---|---|---|
| `three-knot-still` | static close-up | frozen | 32 | control (kept) |
| `three-knot-static` | static close-up | rotating | 48 | moving occluder, static camera (kept) |
| `three-knot-orbit` | orbit, ~1.9 px/frame | rotating | 40 | moving occluder + real camera motion (kept) |
| **`three-knot-drift`** (new) | **the live page's own drift**, `pose(camera, 0, f / 60)`, ~0.25 px/frame | rotating | 48 | **what Dennis looked at**: `realtime-shadows.html` with no `?path` |
| **`three-knot-drift-frozen`** (new) | the same drift | frozen | 48 | control: is it the knot or the camera? |
| **`three-knot-wide`** (new) | drift's frame-0 pose, held | rotating | 48 | control: the same view without camera motion |
| `sponza-move`, `bistro-move` | static | moving occluder in the sun / moving lantern | 48 | lag side of every anti-lag change (kept) |

The new captures come from a **local patch to `examples/three-temporal/src/realtime/path.ts`** (three extra path names that
replay the free-running page's camera; reverted, kept as `results/data/s/path-drift.patch`: the file belongs to no track,
and T0-scenes owns G2's paths). The captures (3 × 3.1 GB) stay in this worktree's `tools/rt-capture/captures/` until
the phase ends. The live page's default view moves the camera — `pose(camera, shot, t)` drifts with `t` — so none of the kept
captures showed Dennis's regime: knot-static holds the camera still, knot-orbit moves it 8× faster.

**Scorer** `results/data/s/knot-boil.mjs` (new; `strip.mjs` and `popmap.mjs` for images): per region, the clean reference's
own value next to ours and FFX's:

- regions: **moving** (static receivers whose smoothed reference changes > 0.06 over the last 8 frames along the history:
  the moving shadow, plus resampled hard edges once the camera moves), **penumbra** (static penumbra, 0.02 < ref < 0.98,
  history ≥ 8 frames), **disocc** (history < 8 frames), **object** (the knot itself), **rect** (M4 §12.1's wall-shadow rect);
- **boilG**: RMS second temporal difference along the history / √6, counted where the reference's own is < 0.02 (rule 9's
  motion-compensated boil). **History = bilinear resample over the valid taps**, not the max-weight tap that compare.mjs /
  score-captures / shadow-regions use (§3 item 3 for why);
- **blob5**: the same on the output box-filtered 5×5 first (low-frequency undulation, what reads as "shapes moving");
- **p99 / p999**: tail percentiles of |second difference| / √6 (pops: isolated jumps that RMS averages away);
- PSNR and bias per region; FLIP / edge sharpness from score-captures.mjs / compare.mjs.

Commands are in §9.

## 2. Measurements: ours vs FFX vs the reference

Shipped defaults (q21 + q23 + q24 + q29) vs FFX shadows vs the 2048-ray reference's own noise; frames ≥ 8, 960×540,
bilinear motion-compensated. **Bold** = the calmer of ours / FFX. Raw JSON: `results/data/s/kb-*.json`.

| capture (static-penumbra px/frame) | boilG ref / ours / FFX | blob5 ref / ours / FFX | p99 ref / ours / FFX | p999 ref / ours / FFX | PSNR ours / FFX | moving-region boilG ref / ours / FFX (px/frame) |
|---|---|---|---|---|---|---|
| three-knot-static (69 k) | 0.0035 / 0.0055 / **0.0048** | 0.0010 / 0.0019 / **0.0018** | 0.0130 / 0.0181 / **0.0101** | 0.0173 / 0.0727 / **0.0457** | 29.40 / 20.70 | 0.0018 / **0.0094** / 0.0098 (902) |
| three-knot-wide (77 k) | 0.0034 / **0.0079** / 0.0105 | 0.0010 / **0.0028** / 0.0028 | 0.0130 / 0.0300 / **0.0170** | 0.0179 / **0.1015** / 0.1180 | 29.58 / 21.03 | 0.0026 / **0.0142** / 0.0219 (676) |
| three-knot-drift (57 k) | 0.0033 / 0.0060 / **0.0047** | 0.0024 / 0.0030 / **0.0023** | 0.0116 / 0.0197 / **0.0115** | 0.0244 / 0.0864 / **0.0485** | 31.35 / 22.62 | 0.0028 / **0.0129** / 0.0139 (24149) |
| three-knot-drift-frozen (57 k) | 0.0033 / 0.0060 / **0.0047** | 0.0024 / 0.0030 / **0.0023** | 0.0115 / 0.0199 / **0.0115** | 0.0243 / 0.0878 / **0.0487** | 31.39 / 22.52 | 0.0028 / **0.0128** / 0.0140 (24524) |
| three-knot-orbit (48 k) | 0.0031 / 0.0044 / **0.0034** | 0.0038 / 0.0041 / **0.0030** | 0.0118 / 0.0183 / **0.0133** | 0.0340 / 0.0779 / **0.0547** | 33.17 / 24.66 | 0.0028 / 0.0102 / **0.0101** (46703) |
| sponza-move (67 k) | 0.0037 / 0.0137 / **0.0066** | 0.0023 / 0.0052 / **0.0032** | 0.0307 / 0.0635 / **0.0221** | 0.0423 / 0.1484 / **0.0815** | 22.16 / 16.76 | 0.0017 / 0.0194 / **0.0192** (4260) |
| bistro-move (45 k) | 0.0008 / 0.0142 / **0.0131** | 0.0020 / 0.0052 / **0.0049** | 0.0151 / 0.0776 / **0.0415** | 0.0423 / **0.1947** / 0.2308 | 15.54 / 12.84 | 0.0017 / 0.0263 / **0.0158** (32132) |

- **The knot's wall shadow (what Dennis flagged on 10-25) is at FFX's level** on the static close-up: rect boilG 0.0010 vs
  0.0011, blob5 0.0005 vs 0.0009, p99 0.0037 vs 0.0037 (reference 0.0031 / 0.0008 / 0.013): M4 §12's fix holds.
- **Where the shadow really moves** (moving region, gated), ours is level with FFX on the knot captures and calmer on the
  held wide shot; on `bistro-move` (a lantern moving every frame) ours changes 66 % more per frame, but it tracks: FFX
  lags 1.4 frames there, ours 0, and our changing-region PSNR is 15.3 vs 9.6 dB (§4.1).
- **The gap is the static penumbra's tail.** Our p99 there is 1.4–2.9× FFX's on every capture (1.8× on the static
  close-up, 1.7× under the live drift, 2.9× on `sponza-move`), our pop counts are 1.5–2× FFX's, and our RMS boilG is above
  FFX's on 6 of 7 captures (+12 … +29 % on the knot views, **+108 % on `sponza-move`**, the sun-lit real scene with a moving
  occluder: the biggest gap measured). Ours and FFX are both above the reference's own noise everywhere.
- Accuracy is the other way round: static-penumbra PSNR +5.4 … +9.0 dB over FFX.

## 3. Where the numbers disagree with the split view

1. **The kept captures never showed Dennis's regime.** `realtime-shadows.html` without `?path` drifts the camera
   (`pose(camera, shot, t)`, ~0.25 px/frame median, 0.4 p90 at 540p) while the knot turns. M4 §12 fixed the knot's wall
   shadow on a *static* camera (rect boil 0.0010 ours vs 0.0011 FFX, reproduced today) and that fix holds under the drift
   too (strips below). What is left is the tail of item 4, with or without camera motion.
2. **Neither the knot's motion nor the camera's drift is the cause; both only change *where* it shows.**
   `three-knot-drift` and `three-knot-drift-frozen` (same drift, knot frozen) score the same to the third digit in every
   region (static penumbra boilG 0.0060 / 0.0060, p999 0.086 / 0.088). Holding the drift's camera still
   (`three-knot-wide`) changes the RMS ranking (ours 25 % *below* FFX there, 28 % above under the drift) but not the
   tail: ours / FFX static-penumbra p99 = 1.76 held, 1.71 drifting; pops (> 0.06) 1.93× held, 2.05× drifting. Under the
   drift 21 k edge-adjacent penumbra pixels/frame move from the "static penumbra" region into "moving" (78 k → 57 k), so
   cross-motion RMS comparisons are region-composition effects. Same lesson as M4's frozen control, one level up: run a
   frozen control *and* a held camera.
3. **Nearest-tap motion compensation reads penumbra gradients as boil on a moving camera.** compare.mjs, score-captures.mjs
   and shadow-regions.mjs take the max-weight history tap; on a smooth penumbra the second difference then picks up
   gradient × (tap switch), straight diagonal seams in the frame-difference strips ([img/orbit-wall.jpg](../results/data/s/img/orbit-wall.jpg),
   in every row, the reference's too). With the bilinear history of knot-boil.mjs the reference's own whole-frame boil on
   `three-knot-orbit` drops 0.0169 → 0.0131 and the ranking flips by region: compare.mjs says our static-penumbra boil
   is *below* FFX's on orbit (0.0110 vs 0.0123), the bilinear measure says 29 % *above* (0.0044 vs 0.0034); score-captures
   says ours is calmer than FFX on drift (0.0042 vs 0.0051), the bilinear static penumbra says 28 % noisier. **T0's calm
   number needs the bilinear history** (or it will rank sharp outputs on moving cameras wrongly).
4. **RMS boil hides pops.** On the static close-up our RMS boil is level with or below FFX everywhere (shadow-regions: edge
   0.0114 vs 0.0153, soft 0.0049 vs 0.0065), but the pop count (|second difference| > 0.1) is 1.45× FFX's (350 vs 242 per
   frame, reference 109), and the static-penumbra p99 / p999 are +80 % / +60 %. The pops sit at contacts and hard edges
   (objects on the table, the pedestal's foot), not in the wide wall shadow ([img/static-pops.png](../results/data/s/img/static-pops.png)).
   Under the drift they double (pops > 0.06: ours 75,991 vs FFX 37,025, reference 36,395;
   [img/drift-pops.png](../results/data/s/img/drift-pops.png)). A single isolated jump in a calm area is what the eye
   catches; the calm metric should carry a tail percentile next to the RMS.
5. **Images** (`results/data/s/img/`): `*-wall.jpg` are crops of the knot's wall shadow, rows ours / FFX / reference,
   four consecutive frames; top block the values, bottom block |x_t − x_t−1| × 25 along the history (dark = change).
   `*-pops.png` are per-pixel pop counts over the sequence (white none, black ≥ 6), panels reference / ours / FFX
   (`wide-pops.png`: + ours with `clampHistoryNoise: 1` + `stabilizeBox: 0.1`, where the table / chair pops thin out).
6. **In the wide knot penumbra itself, ours now looks at least as calm as FFX** in the strips (static and drift: FFX's frame
   difference has a cellular texture everywhere, ours is quieter with a few isolated dots;
   [img/static-wall.jpg](../results/data/s/img/static-wall.jpg), [img/drift-wall.jpg](../results/data/s/img/drift-wall.jpg)).
   The excess is in other static penumbrae of the frame (table and chair shadows on the floor, the stool's arc) and at
   contacts. If Dennis still sees the knot's shadow boil on today's build, it is the dots (isolated restarts, §4.1), not
   the 10-25 undulation.

## 4. Ranked causes

Measured one change at a time on the shipped defaults (replays, `ablate.sh` / `round23.sh` / `round4.sh`, tables
`kb-*-ablate.json`, `kb-*-r23.json`, `kb-*-r4.json`). Static-penumbra numbers, change vs shipped; lag side from
shadow-regions.mjs on `sponza-move` (sun, swinging knot) and `bistro-move` (moving lantern): changing-region PSNR, lag in
frames, trail. Ranked by how much of the gap to FFX each explains.

### 4.1 Anti-lag restarts on statistical false alarms (temporal pass) — the main cause

The clamp compares the reprojected raw history (an (A + 1)-sample mean of 1-ray samples, A ≤ 15) against the 5×5 raw
mean ± (0.4 σ √(25/n) + 0.05). Both are noisy, so in a static penumbra the history falls outside the window by chance
every few frames, and the anti-lag (gain 64, restart to A = 0) turns any clamp move ≥ 1/64 into a full restart: that pixel
jumps to a 1–2-sample mean for a frame, and the spatial passes and the stabilizer only partly hide it. At any frame
**4.6–8.9 % of static-penumbra pixels have A < 4** (debug `age`: static 8.9 %, wide 8.3 %, drift 4.6 %, orbit 3.1 %).
These are the isolated pops of the strips and pop maps. Evidence (static-penumbra boilG / p99, change vs shipped):

| variant | static close-up | wide (held) | drift | orbit | sponza-move | lag side: sponza / bistro changing PSNR Δ, bistro lag |
|---|---|---|---|---|---|---|
| no anti-lag (`antiLagGain: 0`) | −32 % / −34 % | −33 % / −45 % | −22 % / −25 % | −9 % / −10 % | −25 % / – | −2.3 / −1.6 dB, 0.7 f |
| restart to A = 3 (`antiLagHistory: 3`) | −27 / −28 | −27 / −36 | −18 / −19 | −9 / −10 | −20 / – | −1.6 / −1.1 dB, 0.65 f |
| gentler gain (`antiLagGain: 8`) | −23 / −29 | – | −12 / −20 | −8 / −9 | −15 / – | −0.4 / −0.4 dB, 0.5 f |
| window counts the history's standard error (`clampHistoryNoise: 1`, new) | −26 / −32 | −25 / −39 | −16 / −23 | −8 / −10 | −17 / – | −2.0 / −1.4 dB, 0.7 f |
| restart only beyond the window + k standard errors (`antiLagNoise`, new) | −27 / −31 (k = 1) | – | −15 / −21 | −10 / −11 | −20 / −25 | −0.9 / −1.0 dB, 0.6 f |

`antiLagNoise` k = 2 / 3 add little over k = 1 (static −30 %, drift −16 %) and cost more tracking (sponza −1.5 / −1.8 dB).
It gets half of the no-anti-lag gain at 40 % of its tracking cost, but it costs −0.9 dB static-penumbra accuracy on the
close-up (the clamp still moves the history, now without the restart, so a clamped, biased history lives on), while
`clampHistoryNoise: 1` *gains* +0.7 … +1.0 dB static-penumbra PSNR (static 29.40 → 30.42, drift 31.35 → 32.08, orbit
33.17 → 34.04): the restarts cost accuracy too. Every variant that removes restarts costs tracking where the shadow really
moves (FFX's own numbers there: sponza 14.11 vs ours 17.62 dB, bistro 9.61 vs 15.32, lag 1.39 frames), so the fix has to
tell a false alarm from a change (§7, item 1). Public precedent for not restarting to zero: LESSONS (public research
2022–2026): shipped anti-lags shorten the history in proportion and never to 0.

### 4.2 The stabilizer is gated off where the boil is (stabilize pass)

The stabilize pass blends 25 % of this frame into a reprojected output history, but only where the 3×3 output range is
below `stabilizeBox` (0.05 at 1080p = 0.1 at 540p), fading out to none at twice that. Debug `weight`: 10–22 % of
static-penumbra pixels are not stabilized at all (drift 10 %, static 20 %, wide 22 %, orbit 5 %), mean weight of the current
frame 0.31–0.47 instead of 0.25. Turning the pass off makes it +23 … +67 % worse, so it carries much of today's calm.
`stabilizeBox: 0.1` (twice the box): drift −14 % boilG / −27 % p99, orbit −22 % / −32 %, wide −13 % / −22 %, static −6 % /
−21 %, sponza −7 %; **lag cost small**: sponza changing −0.18 dB, bistro −0.25 dB, bistro lag 0 → 0.5 frames, trail
0.093 → 0.099; static-penumbra PSNR unchanged. The cheapest calm we found.

### 4.3 The geometry-tested clamp window under camera motion (temporal pass)

`clampGeometry: false` (the plain 5×5 window): drift −15 % boilG / −19 % p999, orbit −19 % / −33 % p999, **but** static
close-up +5 % and its moving shadow +32 %, wide −2 % / moving +20 %; no lag cost (sponza 0 dB, bistro +0.16 dB); and it is
the most expensive option in the pass (0.07 ms). So the tested window helps a held camera and hurts a moving one. Mechanism
not isolated; candidates for phase 2: the per-tile switch between the plain and the tested window (`mixedTile`: only tiles
whose raw samples disagree load the normal tile) flips as content moves across tile borders, and the √(25/n) widening at
creases. Instrument which branch each pixel took before changing it.

### 4.4 Contacts and hard edges on a held camera (q23 / q29 options)

On the static close-up the pops sit at contacts (objects on the table, the pedestal's foot) and hard edges
([img/static-pops.png](../results/data/s/img/static-pops.png)). `stepTest` + `edgeBox` + `floorE` off: static penumbra
boilG −16 %, p999 −17 %, but −3.1 dB static-penumbra PSNR (29.40 → 26.34) and −2.8 dB overall; drift / orbit ±3 %. These
options keep contacts sharp (contacts above the raw input, SHADOWS-FOLLOWUPS) and q29 already failed rule 9's boil clause
narrowly for this reason. A per-frame noise estimate flipping between "clean step" and "noisy" at a contact is the likely
mechanism (the `hardFloor` lesson). Smaller share of the gap; trade detail for pops only with Dennis's eye.

### 4.5 Input stratification is lost under real camera motion (renderer contract, not the filter)

The 1-ray blue-noise samples are temporally stratified per screen pixel. Measured as the variance of a 16-frame mean of
raw samples along the history against the white-noise expectation (`strat.mjs`): **0.42 held (knot-still), 0.40 under the
0.25 px/frame drift, 0.96 on the orbit (1.9 px/frame)**. Once the camera moves more than about half a pixel per frame the
history accumulates effectively white samples, 2.3× the variance at the same A. Our history is raw samples, so it pays
this; FFX's history is its filtered output, so it barely does. This is why the orbit gap shrinks least under any option
(−9 % for the anti-lag family) and closes only with the stabilizer (§4.2). Not a filter bug; it bounds what the raw
history can do on fast cameras (§7 item 4).

### 4.6 Measured, not causes

- the knot's rotation (drift = drift-frozen to the third digit);
- the penumbra-size estimate from occluder distance (`maxScaleHistory: 31` ±1 %; the kernel's size is not what boils);
- history length / resampling: `maxHistory: 31` −2 %, `catmullRom: false` −3 %, `historyShrink: 1` −3 %, `youngMean: 0` ±0,
  `uniformSnap` true / false ±3 %;
- kernel rotation: fixed per pixel (shipped, q23) is right; the old per-frame rotation is +16 % boilG / +31 % p99 held,
  +11 % / +24 % under the drift, +1 % on the orbit (where the screen-anchored pattern slides under the content anyway);
- the H18 noise radius helps calm under camera motion: `noiseBlend: 0` is +10 % (drift) / +22 % (orbit) worse, −3 % held;
- the stabilizer's own anti-lag (`stabilizeAntiLag` 0 / 16: −1 … −6 %) and a stronger blend (`stabilize: 0.15` / 0.1: ±3 %).

## 5. Detail and contacts

Ours keeps far more detail than FFX on every knot capture; the detail gate ("FLIP better than FFX") is met by a wide margin
already, so phase 2 must not trade it away for calm.

| capture | FLIP ours / FFX / raw | pooled PSNR ours / FFX | edge sharpness ours / FFX (1 = reference) | contact PSNR ours / FFX |
|---|---|---|---|---|
| three-knot-static | 0.0174 / 0.0470 / 0.0907 | 37.13 / 28.68 | 0.950 / 0.677 | 23.90 / 15.21 |
| three-knot-orbit | 0.0193 / 0.0545 / 0.1062 | 33.62 / 26.34 | 0.889 / 0.570 | 16.81 / 11.01 |
| three-knot-drift | 0.0164 / 0.0481 / 0.0935 | 35.64 / 27.14 | – | – |

(FLIP from score-captures.mjs every 4th frame; sharpness
from compare.mjs, contact PSNR from shadow-regions.mjs.)

Where detail is still lost against the reference (shadow-regions, knot-static): contacts 23.9 dB and hard edges 25.4 dB vs
37.1 overall; edge sharpness 0.95 static and **0.89 under camera motion (0.87 in the changing region)**: history resampling
softens moving edges (the SHADOWS-MOTION finding). FFX is 0.68 / 0.57. Contact pixels are also where our pops are (§4.4),
so the q23 / q29 contact options trade detail against pops there.

## 6. Cost

1080p test bed `mode=bench&preset=full`, 200 frames after 20 warm-up, one configuration per page, 3 alternating rounds after a
throwaway page, GPU lock held, no other headless Chrome busy (`tiles` read 0.005 ms on every page: fast clock state). Median
of the three page medians (min of all frames in brackets). Raw: `results/data/s/bench-1080p*.jsonl`, script `bench.mjs`.

| configuration (`orbit` unless said) | total | temporal | spatial 0 + 1 | stabilize | Δ total |
|---|---|---|---|---|---|
| **shipped, `orbit`** | **0.624** (0.571) | 0.428 | 0.074 + 0.072 | 0.038 | |
| **shipped, `thin`** | **0.721** (0.677) | 0.448 | 0.110 + 0.097 | 0.058 | |
| `clampGeometry: false` | 0.566 | 0.358 | 0.078 + 0.076 | 0.040 | −0.058 |
| `noiseBlend: 0` (no H18 E: no noise estimate, no step test) | 0.579 | 0.385 | 0.072 + 0.071 | 0.038 | −0.045 |
| `stabilize: 0` | 0.583 | 0.428 | 0.074 + 0.071 | – | −0.041 |
| `spatialPasses: 1` | 0.547 | 0.427 | 0.074 | 0.038 | −0.077 |
| `youngMean: 0` | 0.594 | 0.401 | 0.073 + 0.071 | 0.037 | −0.030 |
| `stepTest` + `edgeBox` off | 0.605 | 0.410 | 0.074 + 0.072 | 0.037 | −0.019 |
| `catmullRom: false` | 0.618 | 0.404 | 0.082 + 0.081 | 0.041 | −0.006 (temporal −0.024, spatial +0.017: blurrier history widens the penumbra tiles) |
| `tileSkip: false` | 1.114 | 0.426 | 0.274 + 0.272 | 0.134 | +0.49 (the tile skip is worth half the budget) |
| probe: temporal pass without its second unfiltered store | 0.625 / `thin` 0.726 | 0.427 | | | **±0**: the duplicate copy is free |
| probe: temporal pass skips reprojection, clamp and E in tiles whose raw 12×12 samples agree (wrong output; upper bound) | **0.419 / `thin` 0.552** | 0.242 / 0.295 | 0.068 + 0.067 | 0.033 | **−0.205 / −0.169** |

Wall time per frame (submit to done, single denoiser): 1.1 ms `orbit`, 1.3 ms `thin`. FFX was not re-benched this session
(M4 §12.6 / REMEASURE: 0.48–0.61).

**Where the time goes.** The temporal pass is 69 % of `orbit` and 62 % of `thin`, and most of it is per-pixel work in tiles
where nothing is happening: on these views 58–68 % of the 8×8 tiles have no penumbra in their 3×3 neighbourhood (knot
captures, from the outputs), yet every pixel there reprojects 4 geometry + 4 history taps, runs the 5-tap Catmull-Rom,
the clamp, the H18 noise estimate and the step test. The upper-bound probe removes that work and saves 0.19 ms of the
temporal pass on `orbit`. The two r32float copies are not the cost (removing one saved nothing), and the spatial passes are
already restricted to penumbra tiles.

**Ways to ≤ 0.6 ms without losing calm or detail** (all phase 2, each an option first, byte-identical default until
flipped):

1. **Uniform-tile fast path in the temporal pass** (our design): in a workgroup whose shared 12×12 raw tile is uniform and
   whose 4 reprojected history taps are exact 0 / 1 with no young frames (one extra branch on data already loaded), write
   the history as raw value with A + 1, carry g / n_g / E from the nearest tap, skip Catmull-Rom, clamp, E and step test.
   Same output wherever the snap already makes the history exact (uniform windows with `uniformSnap` / `snapHardPx`), so
   it can be checked byte-for-byte on most pixels. Estimate −0.08 … −0.15 ms (the probe's −0.19 is the ceiling; the fast
   path still loads the taps).
2. **E and the step test only where the raw window is mixed** (E is 0 by definition in a uniform 5×5 window, and
   `stepE` already skips there; the `noiseE` loop does not): part of item 1 when it lands, −0.02 … −0.04 alone.
3. **Cheaper geometry-tested clamp window**: `clampGeometry` costs 0.07 ms; its normal tile could be built from the
   geometry texture the pass already writes (packed normal, no second normal fetch) or tested on the 3×3 core only.
   It also matters for calm (§4.3), so its cost and its window shape get decided together. −0.02 … −0.04.
4. Merge the stabilize pass into spatial pass 1 (recompute a 1-px halo of pass 1 in workgroup memory): saves one
   indirect dispatch and the out-texture round trip, −0.01 … −0.02. Lower priority.

Items 1 + 2 bring `orbit` to ~0.47–0.55 and `thin` to ~0.57–0.65; with 3, `thin` ~0.54–0.62. The stabilizer-box and
anti-lag changes of §7 cost nothing (constants / one expression). **Thin stays the risky path**: its screen is mostly
penumbra, so the fast path helps it least.

## 7. Fix plan (phase 2), each with the gate measure it moves

Gate measures (TRACKS "S exit"): **calm ≤ FFX on G2 with the moving occluder** (here: static-penumbra boilG *and* p99 ≤
FFX, moving region ≤ FFX, every knot capture incl. the live drift), **FLIP better than FFX** (today 0.016–0.019 vs
0.047–0.055: keep it), **≤ 0.6 ms at 1080p** (today 0.62 `orbit` / 0.72 `thin`), Dennis's eye. Every fix lands as an option,
default output byte-identical, and is A/B'd on the review bench (TASKS rule 12) before any flip. The estimates below come
from the one-at-a-time measurements in §4; combinations measured where noted.

| # | fix (phase 2) | moves | estimate (static-penumbra boilG / p99 vs shipped; ratio to FFX after) | risk / what it costs |
|---|---|---|---|---|
| 1 | **Significance-gated anti-lag**: restart only when the history is outside the window by more than its own standard error (`antiLagNoise`, built as an experiment) or proportionally (`antiLagGain` ~8); keep the clamp itself | calm (main) | `antiLagNoise: 1`: −10 … −27 % boilG, −11 … −31 % p99 at −0.9 / −1.0 dB tracking (sponza / bistro); **with fix 2** (`antiLagNoise: 2` + `stabilizeBox: 0.1`, measured): drift / orbit / static −29 / −30 / −34 % boilG, −41 / −38 / −45 % p99 = **at or below FFX's boilG and p99 on all three knot captures**; `sponza-move` −27 % (still 1.5× FFX). Phase 2 should combine the history-SE window (`clampHistoryNoise`: +1 dB accuracy) with the significance-gated restart (tracking) and search between them | tracking on truly moving shadows: the measured combinations lose 1.6 … 2.2 dB in the changing region and lag 0.7 frames (shipped 0), still ahead of FFX (sponza 16.0 vs 14.1 dB, bistro 13.7 vs 9.6, FFX lag 1.4 frames); rule 9 will flag it against shipped, so it is Dennis's call |
| 2 | **Wider stabilizer box** (`stabilizeBox` 0.05 → 0.1 at 1080p; better: a box scaled by the local σ instead of a constant) | calm, esp. under camera motion | −6 … −22 % boilG, −21 … −32 % p99; with #1 / `clampHistoryNoise`: drift / orbit / static −29 / −29 / −30 % = **at or below FFX's boilG on all three and at FFX's p99** (p999 still +3 … +28 % above FFX) | lag −0.2 dB at most; a constant box blurs fast hard edges if pushed further (M4 §12.3) |
| 3 | **Uniform-tile fast path** in the temporal pass (+ E only in mixed windows) | cost | −0.08 … −0.15 ms (`orbit` → ~0.50, `thin` → ~0.60) | correctness of carried g / E / young counter; byte check on non-uniform tiles |
| 4 | **clampGeometry decided with cost**: find why the tested window hurts moving cameras (§4.3), keep it only where it helps (held camera, creases), cheaper normal source | calm under motion, cost | −15 … −19 % boilG under motion, −0.02 … −0.07 ms | +32 % on a held camera's moving shadow if simply turned off |
| 5 | Contacts: a slower-moving step / floor decision (E from the accumulated, not the per-frame window; or hysteresis) so contacts stay sharp without flipping | calm at contacts, detail | −10 … −16 % held-camera static boil, p999 −17 % (ceiling: q23 off), keep the +3 dB | detail is the point of q23 / q29: only with Dennis's eye |
| 6 | Fast cameras (orbit-class motion): accept the raw-history variance or add a small filtered-history term for pixels whose input stratification broke (history age vs motion) | calm on G2 orbit | orbit gap closes only via #2 today; this is the remainder | a recurrent term brings back blur drift; research item, after 1–3 |

**Expected outcome of 1 + 2 + 3:** calm at FFX's level in boilG and p99 on the knot captures (live drift included),
FLIP unchanged (static-penumbra PSNR goes *up* by 0.7–1 dB with the clamp change), ≤ 0.6 ms on `orbit` and borderline on
`thin`. Remaining risks: the p999 tail (+3 … +28 % over FFX after the best combination) and `sponza-move`, where ours is
2× FFX today and the best combination reaches −27 %, i.e. still ~1.5× FFX: **G2's exit can be met on the knot
scene before `sponza-move`-like sun penumbrae are**; a second look there (the sun's narrow penumbrae and the q23 / q29
contacts) is the likely second phase-2 attempt.

**Phase 2 estimate:** fixes 1–2 behind options with their rule-9 A/B and bench toggles: 1–2 days; fix 3 (fast path, byte
checks, bench): 1–2 days; 4–5 investigation: 1 day each. About a week of agent time with the GPU queue as it is today,
plus Dennis's review rounds; stop and reassess after two failed attempts per the TRACKS rule.

## 8. Commits, options, byte identity

On `track/s-shadows` (cut from `1c24a8d`):

- `12db104` options `debugStabilize` ('weight' / 'age': the stabilizer's blend weight or the temporal history length,
  written to a separate debug texture, histories untouched) and `clampHistoryNoise` (experiment); scorers and scripts in
  `results/data/s/`.
- `ee515da` option `antiLagNoise` (experiment); round scripts and region scores.
- {LAST-COMMIT} this report, round-4 scores, bench data, images.

**Default byte identity:** every new branch is behind a pipeline variant that leaves the default WGSL text unchanged
(`TemporalVariant.historyNoise` / `antiLagNoise` undefined; `SHADOW_STABILIZE_WGSL` untouched, the debug variant is a
separate string; no layout change unless `debugStabilize` is set). Replay check: `three-knot-static` with the default options
before the edits (`s-def`), after `12db104` (`s-def2`) and after `ee515da` (`s-def3`): 48 of 48 frames byte-identical
each (`cmp`). `tsc --noEmit` clean.
Options added: 3 (one diagnostic, two experiments), none proposed as defaults yet.

## 9. Reproduce

```sh
# worktree setup: captures by symlink (read only), outputs local
cd tools/rt-capture && mkdir -p captures && for c in three-knot-static three-knot-orbit three-knot-still sponza-move bistro-move; do
  ln -sfn /Users/dex/Developer/Denoiser-nrd-cleanroom/tools/rt-capture/captures/$c captures/$c; done
RT_NO_HMR=1 node node_modules/vite/bin/vite.js tools/rt-capture --port 5304 --strictPort --host 127.0.0.1   # replay server
D=docs/research/rt-denoiser/results/data/s
# new captures: git apply $D/path-drift.patch (path names knot-drift / knot-drift-frozen / knot-wide), three-temporal server on 5304
$D/capture-drift.sh        # three-knot-drift, three-knot-drift-frozen (session2.sh step 1: three-knot-wide)
# replays (each holds the GPU lock)
$D/replay.sh three-knot-drift s-def:denoiser=shadows s-ffx:denoiser=ffx-shadows s-raw:denoiser=passthrough
$D/ablate.sh three-knot-drift; $D/round23.sh; $D/round4.sh
# scores
node $D/knot-boil.mjs three-knot-drift s-def,s-ffx,a-al0 --json out.json --popmap pops.png --popThr 0.06
node $D/knot-boil.mjs three-knot-drift x --debug dbg-w,dbg-a        # stabilizer weight / history age per region
node $D/ablate-table.mjs out.json
node $D/strip.mjs three-knot-drift s-def,s-ffx --rect 660,130,240,220 --frames 28,29,30,31 --scale 1 --lo 0.1 --hi 1 --gain 25 --out strip.png
node $D/strat.mjs three-knot-orbit 16
node tools/rt-capture/shadow-regions.mjs sponza-move --denoisers s-def,s-ffx,a-al0 --json sr.json
# cost (test bed server on 5304), timing probes are wrong-output patches reverted by git checkout
OUT=$D/bench-1080p.jsonl node $D/bench.mjs 3 200
python3 $D/cost-hacks.py uniform && PAGES_FILTER='^default$' node $D/bench.mjs 3 200; git checkout -- packages/denoiser-realtime/src/shaders/shadow.ts
```

## 10. Needs from T0 / other tracks

- **T0-scorecard:** (1) the calm number's motion compensation must use a **bilinear** history (or another interpolating
  reprojection), not the max-weight tap: on a moving camera the tap switch reads a penumbra's gradient as boil and flips
  rankings (§3 item 3; `knot-boil.mjs` `histOp` is a reference implementation, 20 lines). (2) Report a **tail percentile
  (p99) or a pop count next to the RMS**: our gap to FFX is in the tail (1.4–2.9× p99) while the RMS is within ±30 % and
  sometimes favours us. (3) Regions: under camera motion "static penumbra" loses its edge-adjacent pixels to the
  changing region, so report region pixel counts with each number. These three are the calibration questions for T1.
- **T0-scenes:** G2 needs (a) the free-running page's own camera drift (0.25 px/frame) with the knot turning — that is what
  Dennis watched; my local `knot-drift` path replays it (`pose(camera, 0, f / 60)`), (b) a held-camera twin and a
  frozen-knot twin as controls, (c) a sun-lit moving-occluder view (`sponza-move` is where the gap is largest), (d) one
  fast-camera segment (orbit-class) for the stratification limit. 2048-ray per-pose references were enough (reference
  boil 0.003 in penumbrae).
- **T1 (Dennis):** blind pairs worth asking: shipped vs FFX on the drift (does the tail difference show?), shipped vs
  `antiLagNoise` + `stabilizeBox: 0.1` (calm vs tracking on `sponza-move`), and whether contact pops (q23 / q29) bother him
  more than the softer contacts without them.
- **T0-native:** SIGMA's output on the same drift capture would tell whether a production shadow denoiser keeps p99 near
  the reference's on 1-ray input (black-box only).
- **GPU queue:** short replay batches lost the lock to back-to-back batches for ~40 min twice; a FIFO ticket (e.g. a
  queue file) instead of `mkdir` polling would make the lock fair.
