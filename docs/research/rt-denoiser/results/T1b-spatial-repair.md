# T1b: the spatial history repair on cuts and reveals

_2026-10-26, recurrent implementer / evaluator (RULES.md rule 8: no NRD code, README, release notes, port, quarantine
folder or original audit file read; the brief, `sources/audit-public-research-prompt.md` (priority 4) with its
review, T1-recovery.md §5.2, E1b-high-reference.md §3 and SPEC §5.8 read). Brief: audit priority 4 / review
target 1 follow-up, decision q19. Everything was measured on our own test bed and captures. **Baseline: the shipped
recurrent default since 5ad7831, `historyFix: 'spatial'`** (Dennis q19 (a), flipped by this agent at the start of
this work; new default output = old explicit `'spatial'` byte for byte). `'mips'` (the default until then) is the
second reference arm. New behaviour is behind options whose defaults keep the output byte for byte (TASKS rule 9)._

## Conclusion first

- **Cause of the cut-frame loss (reproduced: 1080p, 4096 spp, diffuse −2.02 dB, specular −0.68, SO −1.43 vs the
  mips): too few samples, not footprint and not hit distance.** On a full reset every tap of the 16-tap disk is also
  A = 0, so the repair averages 17 values of one frame, where the level-3 mips average hundreds (RTG II §49.5.4: mips
  "emulate a high rpp input"). The view after the `cut` path's cut is mostly flat floor and box faces, where a very wide
  average costs no bias; on the detailed orbit side the mips lose the reset frame instead (−1.1 … −1.4 dB, two resets). At 960×540 the
  loss nearly vanishes (−0.13 dB) because the pixel radius covers 4× the scene. ĥ from the mips, a wider ring, an
  ĥ-only ring and age weights do not fix it; more estimates close to the pixel do (§1, §3).
- **Reveals (new static-camera paths, fixed revealed pixel sets followed over time, audit priority 4):** the spatial
  repair already beats the mips on narrow strips, wide strips and one wide reveal (first frame +0.5 / +3.0 / +4.0 dB,
  boundary +0.3 … +4.9, equal or fewer blotches, equal or lower boil); a mip fallback inside the spatial fix loses −3.9 dB on
  the wide reveal and damages the frames after any reset (§2, §3).
- **Best variant: `historyFixDense: 4` with `historyFixDenseCap: 'mip'`** (our design: A = 0 pixels average every pixel
  within 4 px from a workgroup-shared tile, loaded only by workgroups holding an A = 0 pixel). Against the shipped
  `'spatial'` default, live 1080p, 7 paths (4096 spp on five): diffuse **+0.118 dB pooled, +0.34 disoccluded**, AO
  **+0.292 / +0.70**, SO +0.111, specular +0.005 (worst path −0.003); no pooled number on any path or capture below −0.02 dB (worst young-region
  value −0.05, specular `t1b4k-orbit`, from the `'mip'` cap);
  26 captures diffuse +0.13 all / **+0.40 young**; FLIP equal or lower; flicker −0 … −6 %; **boil equal or lower in
  every region of every capture** (young diffuse −0 … −23 %, the wide reveal −16 %), so q20 (a)'s clause is not even
  reached. **The cut frame now beats the mips on every signal** (1080p, 4096 spp): diffuse **+0.46 dB** (40.43 vs
  39.97; vs the default +2.37), specular +0.16, AO +2.84, SO +0.08; the 8-frame post-cut window +0.72 diffuse, +0.98
  AO over the default. Cost: +0.11 … +0.13 ms per frame (+5.0 … +7.0 % of a single-signal recurrent filter, solo bench
  1080p), +1.3 ms once on a reset frame; no memory.
- **Rule 9 (as amended by q20 (a)): passes** on every clause (§4.3). **Proposal (TASKS): flip `historyFixDense: 4` +
  `historyFixDenseCap: 'mip'` as the recurrent default** (radiance and occlusion), keeping both options and
  `historyFix: 'mips'` documented. That answers q19's open follow-up: the spatial default no longer loses the cut
  frame.
- Rejected after measurement (written down, not looped): mip fallbacks on young neighbourhoods / reset frames (fix the
  frame, damage the next ones and the reveals), mip values clamped to the taps' noise (twice, two widths), ĥ-only
  repair, wider rings, `youngBlurTaps`; 64 / 128 scattered taps reach the same quality as dense 4 / mips but cost 5–12
  ms on a reset frame.

## 1. Why the spatial repair lost the cut frame

**Reproduced.** 1080p capture `t1b-cut1080` (cut path frames 40–63, 4096-spp references; the camera cut is local
frame 8 = path frame 48), replayed and scored per frame (all receivers, Reinhard values as compare.mjs):

| frame after the cut | 0 | 1 | 2 | 3 | 4 | 5 | 8 | 9-frame window |
|---|---|---|---|---|---|---|---|---|
| diffuse `'mips'` | 39.95 | 40.96 | 41.66 | 41.85 | 43.01 | 43.52 | 43.69 | 42.24 |
| diffuse `'spatial'` (default) | **37.93** | 41.09 | 42.03 | 42.13 | 43.10 | 43.57 | 43.68 | 41.88 |
| specular `'mips'` | 38.89 | 40.49 | 40.50 | 40.27 | 40.25 | 40.15 | 39.73 | 40.00 |
| specular `'spatial'` | **38.22** | 40.58 | 40.64 | 40.38 | 40.30 | 40.18 | 39.75 | 39.94 |
| diffuse A-SVGF `auto` (yn 0) | 40.81 | 42.32 | 42.02 | 41.36 | 43.44 | 44.71 | 45.58 | 43.08 |

The cut frame loses −2.02 dB diffuse / −0.68 dB specular (E1b's live 1080p page: −1.91 / −0.67), every later
frame wins. At 960×540 (`e1b4k-cut`) the same cut costs only −0.13 dB: the disk radius is in pixels, so at half
resolution its 16 taps sample a 4× larger part of the scene.

**Not the cause.** (a) The hit distance: rebuilding ĥ from the mips and rgb from the taps (`historyFixMips: 'hit'`)
changes nothing (−2.04 dB); nor does a wide ĥ-only ring (`historyFixWideUse: 'hit'`, −2.13). The blur's hit-distance
radius clamp is not what loses. (b) The footprint: a 2× or 3× wider second ring helps only partly (−1.44, −1.66) and
16-tap rings at 3× and beyond are worse than at 1.5×. (c) Content alone: at the capture's first reset (path frame
40, orbit side, fence and spheres) and at `std1080-orbit`'s reset the spatial repair **wins** frame 0 by +1.43 /
+1.12 dB over the mips.

**The cause is the sample count on flat, smooth content.** On the cut frame every pixel has A = 0, so every one of
the 16 taps is also A = 0: the repair averages 17 values of this frame's pre-blurred signal (≈ 9 raw rays each).
The level-3 mip with its 3×3 tent averages a ±12 px footprint (64 pre-blurred values per texel, ~4 texels of
weight), i.e. 10–20× the samples. RTG II §49.5.4 says exactly this: "Mip levels can be used to emulate a high rpp
input" (8×8 → 64 rpp). In a reveal strip or after an ordinary disocclusion the disk lands partly on old pixels (each
an average of up to 32 frames), which is why the spatial repair wins there; at a full reset it has nothing but the
current frame. The error map of the cut frame (spatial minus mips, 8 px boxes) shows a fine red speckle over the
whole floor and the flat box faces (variance) and green only at the contacts under the spheres (the mips' blotchy
bias); the view after the cut is mostly flat floor and box faces, where a very wide average is nearly free of bias.
The orbit side (fence slats, thin geometry, many contacts) is the opposite case, so the mips win one reset and lose
the other.

**Density, not radius.** With the same 8 px radius, 3 / 7 extra 16-tap rings (64 / 128 taps) bring the cut frame to
−0.45 / −0.04 dB and add +0.4 dB to frames 1–3; rings at 1.25×, 1.5×, 2×, 3× the radius do less per tap. Every
estimate within ~8 px helps; reaching farther does not. The mip fallback that fixes the frame itself (§3) damages
the following frames (the history is built from the blocky mip fill: orbit reset frames 1–3 +0.95…+1.15 instead of
+1.5…+1.9 over the mips) and loses −4 dB on a wide reveal.

## 2. Reveals: the same surfaces followed over time

New test-bed paths (audit priority 4), static camera on the fence side: fence slats and rails, their indirect-light
stripes on the floor, a box and spheres behind; the movable sphere 2 m in front of the camera is the occluder.
`rv-narrow`: it slides right ~4 px / frame at 1080p (frames 16–47: narrow strips), then holds; `rv-medium`: ~23 px /
frame (16–31: wide strips), then holds; `rv-wide`: it vanishes at frame 32 (one reveal of ~45 % of the image height,
48 505 px at 960×540), then holds. Nothing else moves, so a revealed pixel shows the same surface to the end:
[data/t1b-reveal.mjs](data/t1b-reveal.mjs) follows fixed pixel sets — the **event set** E (revealed in the motion
window, never covered again) per frame, and every revealed pixel by **time since its reveal** j — with PSNR, boundary
PSNR (2 px from a depth edge: foreground leaking into the revealed surface), mid-band error (9×9 minus 33×33 box of
the signed error: blotch-sized structure), signed bias, FLIP and boil (second temporal difference at the pixel; with
a static camera this is the motion-compensated boil). Captures at 960×540 with 4096-spp references.

**Diffuse** (E-set PSNR on the reveal frame + k; edge / mid / bias over the first 8 frames; boil over the hold; young
boil = j 2–7; the 4096-spp reference's own boil is 0.0000 on every set: static camera, fixed per-pixel seeds):

| path | arm | e+0 | e+1 | e+2 | e+4 | e+8 | e+16 | edge8 | mid8 | bias8 ×1e3 | FLIP | boil E | boil young |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `rv-wide` | A-SVGF `auto` (yn 0) | 35.51 | 37.29 | 38.17 | 38.66 | 40.49 | 41.21 | 35.34 | 45.36 | −2.45 | 0.0359 | 0.00151 | 0.00305 |
| | recurrent `'mips'` | 29.25 | 30.17 | 31.26 | 34.52 | 36.82 | 38.78 | 28.86 | 40.13 | −2.27 | 0.0531 | 0.00156 | 0.00328 |
| | `'spatial'` (default) | 33.26 | 36.68 | 37.99 | 38.63 | 38.76 | 39.25 | 33.72 | 44.61 | −2.69 | 0.0454 | 0.00152 | 0.00312 |
| | **`historyFixDense: 4`** | **35.64** | 37.27 | 38.37 | 38.89 | 38.86 | 39.28 | 34.81 | 44.77 | −2.30 | 0.0446 | **0.00139** | **0.00261** |
| `rv-medium` | A-SVGF `auto` | 37.90 | 38.59 | 39.01 | 39.43 | 40.01 | 40.44 | 36.87 | 45.59 | −1.93 | 0.0408 | 0.00137 | 0.00410 |
| | `'mips'` | 33.49 | 34.41 | 35.28 | 36.45 | 37.51 | 38.54 | 31.59 | 45.04 | −3.04 | 0.0513 | 0.00120 | 0.00345 |
| | `'spatial'` | 36.49 | 37.16 | 37.39 | 37.84 | 38.20 | 38.69 | 33.73 | 46.25 | −3.25 | 0.0498 | 0.00118 | 0.00319 |
| | **dense 4** | **37.06** | 37.44 | 37.61 | 37.99 | 38.25 | 38.70 | 34.05 | 46.38 | −3.15 | 0.0497 | 0.00117 | **0.00286** |
| `rv-narrow` | A-SVGF `auto` | 39.32 | 39.53 | 39.64 | 40.19 | 40.21 | 40.68 | 37.46 | 46.29 | −0.66 | 0.0382 | 0.00135 | 0.00365 |
| | `'mips'` | 36.77 | 36.94 | 37.12 | 37.72 | 38.00 | 38.70 | 32.77 | 47.48 | −2.63 | 0.0487 | 0.00111 | 0.00309 |
| | `'spatial'` | 37.22 | 37.35 | 37.43 | 37.94 | 38.10 | 38.73 | 33.10 | 47.48 | −2.73 | 0.0485 | 0.00111 | 0.00267 |
| | **dense 4** | **37.30** | 37.41 | 37.49 | 37.99 | 38.12 | 38.73 | 33.16 | 47.53 | −2.75 | 0.0484 | 0.00110 | **0.00247** |

**Specular**: dense 4 vs `'spatial'` e+0 +0.33 / +0.01 / +0.05 dB (wide / medium / narrow), every other column within
±0.1 dB and boil within ±2 %; `'mips'` is −1.7 / −0.2 / −0.6 dB under `'spatial'` on e+0.

Reading:

- **The mips are worst on every reveal**, most on the wide one (e+0 −4.0 dB under `'spatial'`, edge −4.9 dB,
  blotch band −4.5 dB, and still −0.5 dB 16 frames later). A wide reveal is not a camera cut: its interior surfaces
  (slats, rails, a box edge) are detailed, and the mip average blurs them. The spatial repair was already the better
  history fix here; dense 4 adds +2.4 dB on the wide reveal's first frame (now above A-SVGF's first frame, 35.64 vs
  35.51) and +0.6 / +0.1 dB on wide / narrow strips.
- **Boil drops with dense 4** (wide: E-set −9 %, young −16 %; medium young −10 %; narrow young −7 %), because the A = 0
  value now averages ~50 neighbours instead of 17, so the history it starts is stiller. Every recurrent arm's young
  boil is under A-SVGF's on medium and narrow strips; on the wide reveal dense 4 is the only arm under A-SVGF.
- **Recurrent's settled level is the limit, not the repair**: 16 frames after the wide reveal every recurrent arm sits
  ~2 dB under A-SVGF (39.3 vs 41.2); on never-revealed static pixels of the same frames the gap is 1.0 dB (39.62
  vs 40.60, identical for every recurrent arm). None of the arms reaches the
  band (A-SVGF's tail − 0.5 dB) within the 48 frames.
- With a static camera the reference's own boil is exactly 0 (fixed per-pixel seeds), so q20 (a)'s "above the
  reference's own boil" is always true here: on these paths the boil clause reduces to "not above the default's".

## 3. Candidates

All candidates are options of the `'spatial'` history fix (default off, §6), measured on the same replays:
`t1b-cut1080` (the cut, and the capture's own first reset on the orbit side), `std1080-orbit` (a path's first reset,
256-spp references) and the three reveal captures. "vs mips" on the cut frame is the q19 target; the other columns
are vs the default `'spatial'`. Cost = the history-fix pass (+ mips) on the cut frame at 1080p, joint diffuse +
specular, warmed replay (§5).

| option (source) | cut frame vs mips, diffuse / specular | first-reset frame 0 vs `'spatial'` (capture / `std1080-orbit`, diffuse) | cut frames 1–3 vs `'spatial'` (diffuse) | `rv-wide` e+0 vs `'spatial'` (diffuse) | cut-frame cost | verdict |
|---|---|---|---|---|---|---|
| `'spatial'` (default) | −2.02 / −0.68 | — | — | — | 1.17 ms | baseline |
| `historyFixMips: 'young'` (RTG II §49.5.4 mips where the first ring's taps are ≥ 90 % A = 0) | −0.01 / −0.32 | −1.43 / −1.12 | 0.00 / −0.10 / −0.03 | −3.85 | + mips pass, +1.5 B/px | rejected: the mip fill damages the next frames' history (orbit reset frames 1–3 −1.0 / −0.6 / −0.5 dB) and the wide reveal |
| `historyFixMips: 'reset'` (mips on frames flagged reset) | +0.02 / +0.02 | −1.43 / −1.12 | 0.00 / −0.10 / −0.02 | ±0 | + mips pass, +1.5 B/px | rejected: loses every reset with detail (two of the three resets measured) |
| `historyFixMips: 'hit'` (ĥ from the mips) | −2.04 / −0.60 | −0.07 / −0.03 | −0.14 / −0.11 / −0.08 | +0.11 | + mips | diagnostic: ĥ is not the cause |
| `historyFixMips: 'clamp'`, k 1 / 2 (mip value clamped to the taps' mean ± k standard errors; variance clipping, SAL16) | −1.18 / −0.33, −0.69 / −0.27 | −0.24 / −0.04, −0.84 / −0.49 | −0.40 / −0.34 / −0.29 (k 1) | −1.51 / −2.69 | + mips | rejected (twice, two widths): half the cut gain, and the clamp lets mip blotches into the history |
| `historyFixWideRing: 2` (one 16-tap ring at 2×; Mara et al. 2017 widen where confidence is low) | −1.44 / −0.45 | +0.30 / +0.20 | −0.15 / −0.12 / −0.07 | +0.52 | not timed | partial |
| `historyFixWideRing: 1.5, Rings: 3` (12 / 16 / 20 px) | −0.94 / −0.28 | +0.54 / +0.41 | −0.18 / −0.16 / −0.09 | +1.17 | 7.9 ms | partial, costly |
| `historyFixWideRing: 1, Rings: 3` (64 taps within 8 px) | −0.45 / −0.47 | +0.85 / +0.67 | +0.23 / +0.09 / +0.10 | — | 5.2 ms | good, costly |
| `historyFixWideRing: 1, Rings: 7` (128 taps within 8 px) | −0.04 / −0.43 | +1.08 / +0.86 | +0.27 / +0.10 / +0.11 | — | 11.9 ms | ties mips, far too costly |
| `historyFixWideUse: 'hit'` (ĥ-only ring at 3×) | −2.13 / −0.63 | −0.13 / −0.09 | −0.17 / −0.11 / −0.08 | +0.04 | — | null |
| `historyFixAgeWeight: 1` (taps × (1 + min(A, 3)); inverse variance) | −2.02 / −0.68 | 0.00 / 0.00 | −0.02 / −0.03 / −0.02 | 0.00 | +1 load per tap | neutral on PSNR; young boil −8 % on narrow strips, ±1 % elsewhere; not pursued |
| `youngBlurTaps: 8` (8 more blur taps on A = 0) | −1.43 / −0.47 | +0.33 / +0.23 | −0.06 / −0.07 / −0.06 | — | — | partial |
| **`historyFixDense: 4`** (every pixel within 4 px from a shared tile; our design) | **+0.44 / −0.34** | **+1.26 / +1.11** | **+0.52 / +0.27 / +0.24** | **+2.38** | 2.43 ms | the candidate (disk cap) |
| **`historyFixDense: 4` + `historyFixDenseCap: 'mip'`** (specular / SO radius capped by D7's tent) | **+0.44 / +0.15** | +1.26 / +1.11 (specular: +0.12 / +0.28 over the disk cap) | as dense 4 | as dense 4 | 2.43 ms | **the proposal** (§4.4) |
| `historyFixDense: 3` / `5` | +0.12 / −0.38, +0.60 / −0.34 | +1.07 / +0.96, +1.37 / +1.19 | ≈ dense 4 | (5: +2.63) | 2.09 / 3.25 ms | 4 is the knee |

`historyFixDense` (§6 has the WGSL facts): where a workgroup holds an A = 0 pixel, it loads a (8 + 2r)² tile of
view depth, normal (pack4x8snorm) and the accumulated signal (pack2x16float) into workgroup memory; each A = 0 pixel
then averages every pixel within r px (r = 4: 48 neighbours plus itself) with the disk's weights (plane distance at
the A = 0 geometry tolerance × normal angle), and its radius is capped by the disk's roughness-scaled radius
r0·2^(3(ρ−1)) so glossy specular keeps its small footprint (without that cap, dense 6 cost specular −1.3 dB on the
cut and −0.2 dB at the orbit reset, both vs the mips). A ≥ 1 pixels keep the 16-tap disk (4 → 2 px). It is the cheapest way found to
give the A = 0 average many samples: shared-memory loads replace scattered texture taps (128 scattered taps cost
11.9 ms on the cut frame, 48 dense ones 2.4 ms). Its specular residual on the cut (−0.34 dB vs the mips, from
−0.68) comes from mid-rough specular pixels whose disk-scaled cap (2–4 px) is below the mips' footprint; dense 5
does not change it, `historyFixDenseCap: 'mip'` does (§4.4).

Not built: "use the pre-blurred signal at A = 0" (the brief's suggestion) — at A = 0 the accumulated value already
is this frame's pre-blurred value (temporal pass: acc = lerp(H, pre, 1/(1 + A)) with A = 0), so the repair already
works on it.

## 4. Rule-9 A/B of `historyFixDense: 4`

Arms: the shipped `'spatial'` default (base), `historyFixDense: 4` (candidate), `'mips'` (the previous default) for
reference; on captures also A-SVGF `auto` with `youngNormalPower` 16 (the shipped default since d168f7e, the boil
yardstick of q20 (a)) and 0.

### 4.1 Live, 1080p, 7 paths × 96 frames (E-1 setup: 4096-spp references on `orbit` / `light` / `glossy` / `cut` / `pan`, 256 on `thin` / `object`)

Δ vs the `'spatial'` default; "cut" = the frame of the camera cut, "win" = PSNR of the mean MSE over it and the next 7
frames. FLIP and flicker in %; the test bed reports 4 decimals, so flicker steps of ~3 % are one unit.

| signal | path | base pooled | dense 4 Δ pooled | Δ disocc. | Δ cut | Δ win | FLIP | flicker | flicker mc | `'mips'` Δ pooled / Δ cut |
|---|---|---|---|---|---|---|---|---|---|---|
| diffuse | `orbit` | 43.602 | **+0.174** | +0.44 | | | ±0 | −3.6 | −6.3 | −0.486 / |
| | `light` | 43.913 | +0.053 | | | | ±0 | ±0 | ±0 | −0.282 / |
| | `glossy` | 46.441 | +0.094 | +0.28 | | | ±0 | ±0 | ±0 | −0.072 / |
| | `cut` | 43.237 | +0.196 | +0.28 | **+2.37** | **+0.72** | ±0 | −3.2 | ±0 | −0.506 / +1.91 |
| | `pan` | 41.494 | **+0.261** | +0.69 | | | −0.6 | −1.9 | −5.0 | −0.393 / |
| | `thin` (256) | 34.223 | +0.014 | +0.14 | | | ±0 | −1.7 | ±0 | −0.059 / |
| | `object` (256) | 37.165 | +0.034 | +0.20 | | | ±0 | ±0 | ±0 | −0.143 / |
| | **mean of 7** | 41.439 | **+0.118** | **+0.34** | | | −0.1 | −1.9 | −0.8 | −0.277 / |
| specular | mean of 7 (every path +0.002 … +0.015) | 35.810 | +0.008 | +0.05 | `cut` +0.35 | +0.07 | ±0 | −0.3 | −1.0 | −0.100 / +0.67 |
| AO | `orbit` / `light` / `glossy` / `cut` / `pan` / `thin` / `object` | 42.030 / 44.302 / 43.712 / 41.956 / 42.027 / 35.230 / 34.697 | +0.518 / +0.184 / +0.194 / +0.492 / +0.549 / +0.072 / +0.039 | +0.70 (mean) | **+3.04** | +0.98 | −0.1 | −2.4 | −0.9 | −0.305 / +0.20 |
| | **mean of 7** | 40.565 | **+0.292** | **+0.70** | | | | | | |
| SO | mean of 7 (every path +0.015 … +0.087) | 37.741 | +0.042 | +0.17 | `cut` +0.11 | +0.04 | −0.1 | −1.1 | ±0 | −0.105 / +1.43 |

Against the 256-spp second reference (the five 4096 pages): diffuse +0.064 pooled, +0.22 disoccluded; specular
+0.005 / +0.04 (the 4096 references show about twice the gain, as in E1b). `'mips'` reproduces E1b's numbers
(`orbit` diffuse 43.116 at 4096 in both runs).

**The cut frame vs `'mips'`** (the q19 target), live 1080p at 4096 spp: diffuse **+0.46 dB** (40.43 vs 39.97),
AO **+2.84**, specular **−0.32** (38.57 vs 38.89), SO **−1.32** (29.52 vs 30.84). On the 540p captures (`t1b4k-cut`,
`std540-cut`): diffuse +1.41 / +1.01, specular +0.23 / +0.17 over the mips. The specular kinds keep a loss at
1080p with the default `'disk'` cap: their dense radius is capped by the roughness-scaled disk radius; §4.4's
`historyFixDenseCap: 'mip'` removes that loss.

### 4.2 Captures (26 windows: 6 new 4096-spp test-bed windows, the std540 set + `std1080-orbit`, 3 reveals, 9 real-scene captures)

Diffuse, Δ dense 4 − `'spatial'`, with the young-pixel (ages 2–7) and settled (≥ 17) boil next to the reference's own
boil and the shipped A-SVGF default's (`youngNormalPower` 16):

| capture | Δ all | Δ young | Δ settled | FLIP young | boil young: base → dense 4 (ref / A-SVGF) | boil settled: base → dense 4 (ref / A-SVGF) |
|---|---|---|---|---|---|---|
| `t1b4k-cut` | +0.19 | +0.42 | +0.01 | −5 % | 0.0097 → 0.0097 (0.0028 / 0.0099) | 0.0021 → 0.0021 (0.0030 / 0.0029) |
| `t1b4k-pan` | +0.38 | +0.73 | +0.01 | −5 % | 0.0051 → 0.0049 (0.0048 / 0.0052) | 0.0025 → 0.0025 (0.0034 / 0.0032) |
| `t1b4k-orbit` | +0.16 | +0.41 | +0.01 | −4 % | 0.0074 → 0.0074 (0.0041 / 0.0080) | 0.0028 → 0.0028 (0.0037 / 0.0038) |
| `t1b4k-light` | +0.11 | +0.48 | ±0 | −6 % | 0.0023 → 0.0021 (0.0000 / 0.0021) | 0.0007 → 0.0007 (0.0012 / 0.0009) |
| `t1b4k-glossy` | +0.15 | +0.52 | ±0 | −6 % | 0.0034 → 0.0033 (0.0014 / 0.0033) | 0.0009 → 0.0009 (0.0015 / 0.0011) |
| `t1b4k-object` | +0.16 | +0.65 | ±0 | −6 % | 0.0027 → 0.0024 (0.0007 / 0.0028) | 0.0010 → 0.0010 (0.0011 / 0.0013) |
| std540 set (7) + `std1080-orbit` | +0.09 … +0.31 | +0.16 … +0.43 | – | −2 … −3 % | equal or lower on all 8 | – |
| `t1b-rv-wide` / `-medium` / `-narrow` | +0.06 / +0.07 / +0.06 | +0.51 / +0.50 / +0.42 | ±0 | −5 … −6 % | −8 … −12 % | ±0 |
| `three-pan` / `-orbit` / `-knot-orbit` | +0.11 / +0.06 / +0.06 | +0.31 / +0.24 / +0.24 | +0.01 | −3 % | 0.0020 → 0.0017, 0.0024 → 0.0021 (×2) (ref 0.0058–0.0066 / A-SVGF 0.0037–0.0041) | −0 … −7 % |
| Bistro `orbit` / `pan` / `move` | +0.10 / +0.17 / +0.09 | +0.43 / +0.46 / +0.48 | +0.03 / +0.05 / −0.00 | −4 … −6 % | −11 … −23 % | −0 … −10 % |
| Sponza `orbit` / `pan` / `move` | +0.09 / +0.11 / +0.07 | +0.42 / +0.41 / +0.28 | ±0 … +0.01 | −4 … −5 % | −10 … −19 % | ±0 … −3 % |

Pooled over the 26 captures (mean MSE): diffuse all 35.55 → **35.68 (+0.13)**, young 35.08 → **35.48 (+0.40)**;
specular all +0.01, young +0.03 (every capture −0.02 … +0.09 young, boil equal or lower everywhere, FLIP young
−0 … −2 %). The real-scene references are not 4096 spp (their own young boil 0.0058–0.0202 is mostly noise; E1b);
the boil reading there rests on "lower than the base" anyway.

### 4.3 Rule 9 (as amended by q20 (a)), dense 4 vs the `'spatial'` default

| clause | result |
|---|---|
| −0.1 dB pooled PSNR | no path or capture below 0.00 dB on any signal (worst: specular Sponza young −0.02); means +0.118 diffuse, +0.008 specular, +0.292 AO, +0.042 SO (7 paths, 4096 spp where available) |
| +5 % FLIP | FLIP equal or lower everywhere (−0.6 … ±0 % live, −0 … −6 % young on captures) |
| +5 % boil / flicker in any region | flicker −0 … −6.3 % live; boil equal or lower in every capture's young and settled region (diffuse young −0 … −23 %); nothing to weigh against the reference's or the default's boil |
| +10 % cost | steady frames: history fix 0.43 → 0.57 ms at 1080p (joint, warmed replay) = about +2 % of the filter; reset frames +1.3 ms (§5) |
| 4096-spp references for diffuse / specular / AO | live `orbit` / `light` / `glossy` / `cut` / `pan` and six 4096-spp capture windows |

### 4.4 `historyFixDenseCap: 'mip'` (specular and SO only)

With the disk cap, rough-ish specular pixels keep a dense radius of 2–4 px while the mips averaged ±6–12 px there,
so specular and SO kept a cut-frame loss. `'mip'` caps the dense radius by D7's level-L tent (1.5·2^L px,
L = floor(3ρ + 0.5), still ≤ 4 px); diffuse and AO (ρ = 1) are unchanged. Live, 7 paths, Δ `'mip'` − `'disk'` (both
dense 4; 4096 spp on `orbit` / `light` / `glossy` / `cut` / `pan`):

| signal | pooled per path (`cut` / `glossy` / `light` / `object` / `orbit` / `pan` / `thin`) | mean pooled | mean disocc. | cut frame | post-cut window | flicker |
|---|---|---|---|---|---|---|
| specular | −0.007 / −0.001 / −0.011 / +0.003 / −0.006 / +0.005 / −0.004 | −0.003 | −0.05 | **+0.48** | +0.07 | ±0 |
| SO | +0.113 / +0.064 / +0.103 / +0.061 / +0.072 / +0.033 / +0.039 | **+0.069** | +0.08 | **+1.40** | +0.67 | −1.1 % |

Captures (specular, 6 windows): all −0.00 … −0.02, young −0.01 … −0.07, boil identical; the 540p cut frame +0.41.
Against the `'spatial'` default, dense 4 + `'mip'` is −0.003 … +0.020 dB specular pooled per path (worst `light`) and
+0.111 SO, and **the 1080p cut frame beats the mips on all four signals**: diffuse +0.46, specular +0.16 (39.05 vs
38.89), AO +2.84, SO +0.08 (30.92 vs 30.84).

**Passes**, and with `historyFixDenseCap: 'mip'` too (§4.4: specular worst path −0.003 dB vs the default, SO +0.111,
FLIP / flicker equal or lower, the same pass cost). It is a look change only in the sense that frames right after resets and wide reveals are cleaner
(fewer mid-scale blotches: mid-band error of the cut frame 47.55 → 48.70 dB, above the mips' 47.98).

## 5. Cost

**Steady frames** (test-bed solo bench, 1080p, one (signal, id) per page, 100 frames after 20 warm-up, three
alternating rounds after a warm-up page, GPU lock held, no other headless Chrome; median of the run medians, ms):

| path / signal | `'spatial'` (default) total / history fix | dense 4 total / history fix | Δ total | `'mips'` total / history fix + mips |
|---|---|---|---|---|
| `orbit` diffuse | 2.039 / 0.323 | 2.171 / 0.457 | +0.13 ms (+6.5 %) | 2.088 / 0.298 + 0.077 |
| `orbit` specular | 2.357 / 0.322 | 2.476 / 0.439 | +0.12 ms (+5.0 %) | 2.416 / 0.301 + 0.077 |
| `pan` diffuse | 1.785 / 0.317 | 1.910 / 0.450 | +0.13 ms (+7.0 %) | 1.809 / 0.269 + 0.075 |
| `pan` specular | 1.997 / 0.295 | 2.109 / 0.397 | +0.11 ms (+5.6 %) | 2.049 / 0.269 + 0.075 |

Under rule 9's +10 % (single-signal pipelines; a joint diffuse + specular dispatch shares the pass, so its relative
cost is about half). The steady overhead is the per-workgroup A = 0 test, its barrier and the larger workgroup
memory (lower occupancy) on every workgroup, not the dense sums, which run only in workgroups with an A = 0 pixel.

**Reset frames** (warmed replay of `t1b-cut1080`, joint diffuse + specular, history fix incl. mips, ms; warm=100):

| | `'mips'` | `'spatial'` | dense 3 / **4** / 5 | 64 / 128 scattered taps (rings) |
|---|---|---|---|---|
| the cut frame | 0.62 | 1.17 | 2.09 / **2.43** / 3.25 | 5.24 / 11.9 |
| the frame after it | 0.61 | 1.03 | 1.23 / 1.26 / 1.34 | 1.51 / 1.66 |
| steady (median of frames 12–23) | 0.50 | 0.41 | 0.50 / 0.57 / 0.66 | 0.41 / 0.49 |

The shipped `'spatial'` default already costs +0.55 ms over the mips on a full reset (16 scattered taps on every
pixel); dense 4 adds +1.3 ms more there, once per cut. Memory: +0 B/px (workgroup memory only).

## 6. Default path and byte identity

- **The q19 flip** (5ad7831): replay outputs of the new default vs the pre-flip package with `historyFix: 'spatial'`
  given explicitly, `cmp` of every `.f32`: `recurrent` on `std540-cut` (24 frames), `std1080-orbit` (8), `three-pan`
  (32), and `occlusion-recurrent` on the same three: byte-identical. `historyFix: 'mips'` after the flip vs the old
  default: byte-identical on the same set. The resource reports now count the dispatches per mode
  (`recurrentPassCount`: 6 with `'spatial'`, 7 with `'mips'`, one fewer for occlusion; TASKS T1 follow-up (e)).
- **The T1b options** (474619c): every pass's generated WGSL for the default configuration (history fix in `'mips'` and
  `'spatial'` mode, mips, temporal, blur and post-blur; 1- and 2-signal radiance pipelines and the occlusion kinds) is
  byte-identical to the code before them (dump + `diff`); the options are compiled in only when set, and no uniform
  changed. In the mirror, the default output after the options = the earlier `'spatial'` output (`t1b-cut1080`, 24
  frames, `cmp`).
- `historyFixDense` uses `workgroupUniformLoad` (the tile is loaded only by workgroups with an A = 0 pixel) and at
  most 14.4 KB of workgroup memory for two signals at r ≤ 7 (the WebGPU default limit is 16 KB; the option is clamped
  to 7). `historyFixMips` other than `'off'` brings back the mips pass and the depth atlas.

## 7. Setup and reproduction

| | |
|---|---|
| GPU / browser | Apple M5 Pro, HeadlessChrome 155 (`--use-angle=metal`), WebGPU timestamps; TASKS rule 11 lock per batch |
| Code | scratch mirror (`git archive edd27db` of the test bed, registry and packages, `server.hmr: false`, own Vite on 127.0.0.1:5491, private `RT_CAPTURE_DIR` with the shared captures symlinked) + this work's package files (= 5ad7831 + 474619c + f0a2872); flip check on two package snapshots (HEAD before / after the flip) served with `RT_REALTIME_SRC` |
| Registry arms | `recurrent` (default `'spatial'`), `recurrent@r.historyFix=mips`, `recurrent@r.<option>=…`; `svgf-auto` with `youngNormalPower=0` (the A-SVGF default until d168f7e) and `=16` (the shipped default since d168f7e) |
| New captures (960×540 unless noted, diffuse + specular, 4096-spp references) | `t1b-cut1080` (cut 40–63, 1920×1080), `t1b-rv-wide` / `-narrow` / `-medium` (0–79), `t1b4k-cut` (16–79 = `t1-cut`), `t1b4k-pan` / `-orbit` / `-glossy` / `-object` (0–47), `t1b4k-light` (24–71) |
| Scoring | [data/t1-score.mjs](data/t1-score.mjs) (age buckets, per-frame, boil with the reference's own) → [data/t1b-curves.mjs](data/t1b-curves.mjs) (frames after a reset), [data/t1b-ab-captures.mjs](data/t1b-ab-captures.mjs) (capture A/B with the q20 (a) boil reading); [data/t1b-reveal.mjs](data/t1b-reveal.mjs) + [data/t1b-reveal-summary.mjs](data/t1b-reveal-summary.mjs) (fixed revealed sets); live pages [data/t1b-live-table.mjs](data/t1b-live-table.mjs) |

```sh
# captures (test bed, mode=capture)
node run-headless.mjs "mode=capture&name=t1b-cut1080&path=cut&start=40&frames=24&w=1920&h=1080&signal=diffuse,specular&refspp=4096"
node run-headless.mjs "mode=capture&name=t1b-rv-wide&path=rv-wide&start=0&frames=80&w=960&h=540&signal=diffuse,specular&refspp=4096"
node run-headless.mjs "mode=capture&name=t1b4k-cut&path=cut&start=16&frames=64&w=960&h=540&signal=diffuse,specular&refspp=4096"
# replays (warm=100 for timings) and scoring
node run-headless.mjs "mode=replay&capture=t1b-cut1080&denoiser=recurrent&output=d4&warm=100&r.historyFixDense=4"
RT_CAPTURE_DIR=… node docs/research/rt-denoiser/results/data/t1-score.mjs t1b-cut1080 --den mips,sp,d4 --signals diffuse,specular --json cut.json
node docs/research/rt-denoiser/results/data/t1b-curves.mjs cut.json --signal diffuse --frames 9 --base mips --reset 8 --mid
RT_CAPTURE_DIR=… node docs/research/rt-denoiser/results/data/t1b-reveal.mjs t1b-rv-wide --den svgf-auto,mips,sp,d4 --from 32 --to 32 --json rv-wide.json
node docs/research/rt-denoiser/results/data/t1b-reveal-summary.mjs rv-wide.json --signal diffuse --ref sp
# live A/B (E-1 setup)
node run-headless.mjs --json=joint-orbit.json "signal=diffuse,specular&denoiser=recurrent@r.historyFix=mips,recurrent,recurrent@r.historyFixDense=4&path=orbit&mode=eval&preset=full&refspp=4096&ref2spp=256&ref2salt=0"
node docs/research/rt-denoiser/results/data/t1b-live-table.mjs --signal diffuse --arms "recurrent,recurrent@r.historyFix=mips,recurrent@r.historyFixDense=4" joint-*.json
```

Raw data: [data/t1b-spatial-repair.json](data/t1b-spatial-repair.json) (per-frame and summary numbers of every replay
scored here, the live pages' main fields, bench medians). The captures (~45 GB) were deleted afterwards; the
queries above regenerate them bit for bit.

## 8. What's left

- **Flip** `historyFixDense: 4` + `historyFixDenseCap: 'mip'` if approved (TASKS): two defaults in `resolveRecurrent`,
  byte check of `historyFix: 'mips'` and of the explicit options, README / SPEC §5.8. Re-check the steady cost on the
  Windows RTX machine (shared-memory occupancy behaves differently there) and in a joint dispatch.
- The dense tile's steady overhead (+0.13 ms) is the gate and the occupancy of every workgroup; a cheaper gate (a
  per-tile young flag written by the temporal pass) could remove most of it on frames without resets.
- Recurrent still trails A-SVGF on revealed surfaces after the first frames (§2: ~2 dB 16 frames after a wide
  reveal, 1 dB on static pixels): that is its settled level, not the repair.
- `historyFixAgeWeight` lowered young boil on narrow strips (−8 %) at no PSNR cost; not combined with dense 4 (dense 4
  already lowers it −7 %).
- Native comparison of the reveal paths needs the Windows harness (captures `t1b-rv-*` regenerate with the queries in
  §7).
