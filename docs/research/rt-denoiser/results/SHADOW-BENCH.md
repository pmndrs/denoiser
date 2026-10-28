# Shadow bench: the knot's shadow, paused and ground-truthed (2026-10-27)

_Tooling (RULES.md rule 8: no NRD code opened; the bench runs our own denoiser and FidelityFX's MIT port only). Built for
Dennis (2026-10-27): the rotating torus knot's shadow on the back wall of `realtime-shadows.html` "isn't solid", it
boils, where FFX's looks right. The automated numbers called the knot shadow even (results/M4.md §12: knot-shadow boil
0.0013, FFX 0.0011), so the question was whether the tests miss it and what to tune. This bench is a still-able version
of that scene with a ground truth for every frame, for people to look at and for agents to run in loops._

## Open it

```sh
yarn workspace three-temporal shadow-bench
# then http://127.0.0.1:5266/shadow-bench.html        saved runs: ?report   one run: ?report=<run id>
```

`vite.bench.config.ts` = the review bench's config (packages served from **source**, so an edit in
`packages/denoiser-realtime/src` reloads the bench, no `yarn build:lib`) plus file endpoints for the ground-truth cache
and the runs (`/__shadow-bench/*`, rtCapture's plugin under another prefix). Files land in
`examples/three-temporal/out/shadow-bench/` (gitignored; `SHADOW_BENCH_DIR` moves it): `captures/gt/<key>.f32` (ground
truths) and `outputs/<run id>/` (runs). Port 5266 (TASKS rule 6). Under the examples hub or `yarn dev` the page still
works, but its ground truths stay in memory.

## What is on the page

- **Live.** The knot turns (realtime-shadows' rate, 0.35/60 rad per frame) and every variant denoises the same 1-ray
  signal: `ffx` (`ffxShadows()`), `ours` (`realtimeShadows()`, package defaults) and, when on, `b` (ours with the panel's
  options). The live view shows one of them (lit or visibility); all of them dispatch every frame, so switching the view
  never touches a history.
- **Pause (space).** The current frame is read back, its ground truth is loaded from the cache or computed (you see it
  converge in the canvas), and a still view replaces the canvas: **1…n** = ground truth / raw / each variant, **l / m / e**
  = lit / visibility / signed error (red = darker than the truth, blue = brighter, ×4), click to zoom 4× (move the
  pointer to pan). A table gives that frame's umbra / penumbra / all / knot RMSE, umbra bias and the fraction of umbra
  pixels off by more than 0.05.
- **Step.** **→** +1 frame, **←** −1 (replays from frame 0), **r** restart, buttons for +10.
- **Scene.** Camera (`wall`: close on the knot's wall shadow, the default; `knot`: realtime/path.ts KNOT_VIEW, the
  `three-knot-static` captures' view; `wide`), knot speed (0–6×), knot start angle, light size. A change replays the
  timeline from frame 0 to the current frame.
- **Variant B.** Every shadow option of the review bench's registry (`src/review/options.ts`) as a select, the numeric
  knobs worth sweeping (`config.ts` TUNABLES: history caps, clamp, kernel radii, stabilization, …) as number fields
  (blank = the package default, shown as the placeholder), and a JSON box for anything else. **Apply** rebuilds B and
  replays from frame 0 to the paused frame, so the still view shows exactly what B would have produced there. The
  options also go in the URL (`?b={...}`), and "copy JSON" gives the `--variant` argument for the headless runner.
- **Bench run.** Warmup, step, checkpoints, burst, ground-truth rays, which images to write, a label. **Run bench**
  scores a sequence (below) and shows its report under the page; **measure here** is a one-checkpoint run at the current
  frame (boil needs a burst, a still frame can't show it).

## Headless (agents)

```sh
node examples/three-temporal/shadow-bench.mjs [run] [config flags] [--variant=id:{json}]... [--only=ffx,ours] [--label=x]
node examples/three-temporal/shadow-bench.mjs gt [config flags]          # fill the ground-truth cache only
node examples/three-temporal/shadow-bench.mjs list [--last=20]
node examples/three-temporal/shadow-bench.mjs compare <run A> <run B>     # B minus A, per variant
```

It starts the bench's dev server unless one answers on 5266 (`--keep-server` leaves it up for the next call), prints
the summary table, writes `report.md` next to `run.json`, and exits 1 on a page or WebGPU error. Config flags: any
`BenchConfig` key (`--warmup=300 --step=1 --count=5 --burst=3 --camera=wall --knotRate=0.0233 --lightHalf=0.1
--gtGrid=64 --images=none --raw=true`), or `--cfg='{...}'`; `--w / --h / --sampler` reload the page at that size or
noise. Example sweep:

```sh
node examples/three-temporal/shadow-bench.mjs --knotRate=0.0233 --images=none --keep-server \
  --variant='clamp08:{"clampSigma":0.8}' --variant='stab05:{"stabilize":0.5}'
```

`run.json` holds the config, the variants with the options the package resolved, every metric per frame / checkpoint /
region, the summary and the GPU ms; `--raw=true` adds `f<frame>/<image>.f32` (w × h float32, row 0 = top; `gt.f32` has −1
off the receivers) for metrics of your own. Heavy runs hold the GPU lock (TASKS rule 11) like any other batch.

## How a run works

1. **Timeline.** Frame 0 = every history reset. Checkpoints at `warmup + k·step` (k < count), each with a **burst** of
   `burst` consecutive frames ending at it. Default: warmup 300 (5 s at 60 fps, history full, the knot well into its
   turn), 5 checkpoints 1 frame apart, burst 3. The knot's pose, the camera and the blue-noise index are pure functions of
   the timeline frame, so frame f of any run is the same image: **verified byte-identical** (`ffx`, `ours`, the raw
   signal and the ground truth of frame 120 hashed equal between a run whose ground truth came from the cache and one
   that recomputed it).
2. **Ground truths first.** For every kept frame: from the cache, or computed at that frame's pose before the timeline
   starts. Computing renders only the ground-truth pipeline, so no denoiser sees those frames: the "parallel frame"
   Dennis asked about. Frames are ticked by hand (`nodeFrame.update()` + `pipeline.render()`), not by the animation
   loop, so the bench decides per tick what renders and runs as fast as the GPU allows (300 frames ≈ 1 s).
3. **The timeline** runs from a reset (one scene-only tick at frame 0's pose first, so frame 0's velocity is 0) and
   reads back every kept frame: raw signal, each variant's output, the composite inputs, the moving-object mask.

**Ground truth.** `gtGrid × gtGrid` stratified rays per pixel to the panel (default 64² = 4096), traced from the same
receiver points as the 1-ray signal (same raster depth / normal, same offset, same BVH), so it is exactly what the signal
converges to. A pass traces one grid row per pixel (64 rays): 256 rays / pixel per pass at 960×540 lost the device. The
jitter hashes (pixel, stratum), never the frame: every frame uses the same light samples (common random numbers), so on a
static pixel the ground truth is bit-for-bit constant, and its frame-to-frame change elsewhere is the true motion only.
~3 s per frame at 4096 rays on this Mac; cached under a key of everything it depends on (resolution, light size, knot
tilt and yaw at that frame, camera, ray count, `GT_VERSION`). Two configs that reach the same pose share it. **Bump
`GT_VERSION` in `config.ts` when the scene, the shadow ray or the sampling changes**; nothing else invalidates the cache.

**The lit images** are computed on the CPU from two readbacks (env-lit scene colour, albedo × E(panel)) with three's ACES
filmic, so each variant's lit image costs no extra GPU pass.

## Metrics (`src/shadow-bench/metrics.ts`)

Regions come from the frame's ground truth g, over the **static receivers**. The moving knot's own pixels (non-zero
velocity in any burst frame; the camera holds still) are scored apart as `object`, because there the truth changes with
the motion itself. Before that mask the "ground truth's own boil" read as high as the denoisers'.

| region | definition |
|---|---|
| umbra | g ≤ 0.02: "is the shadow solid?" The region compare.mjs' boil never scores: it takes the static penumbra and the dynamic pixels |
| penumbra | 0.02 < g < 0.98 |
| lit | g ≥ 0.98 |
| all | every static receiver |
| object | the knot's own surface |
| *.moving / *.static | umbra / penumbra split by whether g changes faster than `movingRate` (0.0005) per frame over the burst. The knot's wall shadow changes ~0.0005/frame at 1×, so a fixed 0.01-per-burst threshold put almost all of it in "static" |

Per frame: **RMSE**, **bias** (mean signed error; > 0 in the umbra = greyer than the truth), **off** (fraction off by
more than 0.05). Per checkpoint, over its burst:

- **boil**: RMS of x_t − 2x_t−1 + x_t−2, / √6. compare.mjs' definition on a still camera; a linear change adds 0.
- **blotch** (`boilLow`): the same after a masked Gaussian blur (σ = `blurSigma`, 3 px). The low-frequency part, which
  the eye reads as boiling; per-pixel boil is dominated by fine grain.
- **tErr**: RMS of (x_t − x_t−1) − (g_t − g_t−1), the change the true motion doesn't explain (boil + lag).
- The ground truth's own boil / blotch is reported as the floor.

The summary is the mean over the checkpoints. The **boil map** (`boil-<id>.png`, the report's "boil map" mode) is the
per-pixel temporal standard deviation of x − g over every kept frame, ×10: where the output wobbles around the truth.

## First numbers (960×540, 4096-ray ground truth, warmup 300, 5 checkpoints, burst 3, package defaults at 575a827)

Means over the checkpoints; static receivers. Runs `20261027-204207-default-b`, `-204242-knot-1x`, `-204312-wall-4x`,
`-204339-wall-light01`, `-204411-wide-1x`, `-204558-wall-4x-probe`.

| view | | umbra RMSE | umbra bias | pen. RMSE | boil pen. | blotch pen. | tErr |
|---|---|---:|---:|---:|---:|---:|---:|
| wall, 1× | ffx | 0.0128 | +0.0015 | 0.0640 | 0.0016 | 0.0008 | 0.0018 |
| | ours | 0.0033 | −0.0002 | 0.0225 | 0.0019 | 0.0005 | 0.0017 |
| knot camera, 1× | ffx | 0.0591 | +0.0135 | 0.0748 | 0.0030 | 0.0007 | 0.0020 |
| | ours | 0.0156 | +0.0012 | 0.0289 | 0.0041 | 0.0007 | 0.0028 |
| wall, 4× knot | ffx | 0.0145 | +0.0013 | 0.0662 | 0.0017 | 0.0009 | 0.0034 |
| | ours | 0.0048 | −0.0003 | 0.0341 | 0.0030 | 0.0009 | 0.0032 |
| wall, light half 0.1 | ffx | 0.0138 | +0.0021 | 0.1036 | 0.0026 | 0.0016 | 0.0021 |
| | ours | 0.0034 | −0.0001 | 0.0444 | 0.0040 | 0.0017 | 0.0025 |
| wide, 1× | ffx | 0.0823 | +0.0233 | 0.0796 | 0.0077 | 0.0008 | 0.0047 |
| | ours | 0.0192 | +0.0010 | 0.0279 | 0.0084 | 0.0014 | 0.0049 |

Ground-truth floor: penumbra boil 0.0002–0.0007, blotch ≤ 0.0002, tErr 0.

1. **Ours is closer to the truth everywhere**: umbra RMSE 3–4× lower, penumbra 2–3× lower. Its umbra *is* solid by
   the numbers (bias ≈ 0); FFX's umbra is the greyer one (+0.013 on the knot view, +0.023 wide).
2. **Ours has more frame-to-frame grain in the penumbra in every view**: per-pixel penumbra boil +19 % (wall), +37 %
   (knot), +76 % (4× knot), +54 % (small light), +9 % (wide) over FFX. The blotchy part is level or lower except wide
   (+75 %). This matches "the shape is good but it isn't solid": ours tracks the true shadow better on average but
   flickers around it more; FFX is calmer and wrong by more (blurrier, greyer umbra).
3. At 1× on the wall camera both boil below one 8-bit level after tone mapping. The gap grows with motion and with
   harder shadows, so judge by eye at 4× or with a smaller light.
4. **Lead (one config, not an A/B):** on wall-4×, `clampSigma: 0.8` (default 0.4) takes penumbra boil 0.0030 → 0.0018
   (FFX 0.0017), blotch 0.0009 → 0.0005 (FFX 0.0009) and tErr to the lowest of all, for penumbra RMSE 0.0341 → 0.0397
   (FFX 0.0662) and umbra RMSE 0.0048 → 0.0072. `stabilize: 0.5` made boil slightly worse (0.0034); `maxHistory: 31`
   and `historyScale: 0` changed nothing. So the 25-sample clamp window, not the history length, looks like what keeps
   re-injecting noise here. Before any default change it needs rule 9's A/B (test bed 7 paths + real captures) and a
   review-bench toggle (rule 12: `shadows.clampSigma` isn't in the registry yet).
5. The pedestal's grazing top edge (a thin lit sliver) is where ours' boil map is brightest: speckle on the sliver
   where FFX blurs it away. It's a few hundred pixels, not the wall shadow.

GPU ms in the tables are indicative (uncontended runs, but no warm-up protocol): ours 0.47–1.0 ms, FFX 0.30–0.67 ms.

## Limits and next

- **Still camera only.** realtime-shadows' default view *orbits*. If the boil Dennis sees is there, it's camera-motion
  boil (reprojection, clamp), which this bench doesn't score yet: scoring it needs motion-compensated temporal metrics
  (compare.mjs' reprojected history) and a camera path in the timeline.
- One scene (the corner), the corner's rectangular panel as a sphere of equal area for ours (as the page does), 960×540.
- `ours` gets the occluder distance and the light; FFX gets the visibility only, as on the page.

## 2026-10-28: the visible flicker, found (realtime-shadows' paused wide shot)

Dennis: the demo boils "just as apparent" with the camera fixed. The bench's close views hadn't shown it. In
realtime-shadows the only fixed-camera control is "paused", which also freezes the knot and leaves the wide shot.
Measured on the page itself (its `__t.capture()` hook, 8 consecutive frames, served from source) and on the bench's
new `demo` camera (that shot, `knotRate 0`), share of pixels whose displayed brightness changes between frames:

| | ≥ 2 levels | ≥ 4 levels | per-pixel penumbra boil |
|---|---:|---:|---:|
| demo page: ours / FFX | 0.25 % / 0.07 % | 0.09 % / 0.01 % | |
| bench `demo`: ours / FFX | 0.22 % / 0.06 % | 0.091 % / 0.016 % | 0.0073 / 0.0103 |
| ground truth | 0 % | 0 % | 0 |

**Why the metrics missed it.** The flicker is sparse and strong: clustered speckle in the knot's wall shadow behind
the pedestal and along hard contact edges (chair / table legs, skirting, pouf). An RMS over every penumbra pixel dilutes
it, and there ours even scores *better* than FFX (0.0073 vs 0.0103). The bench now reports **flicker ≥2 / ≥4** (share of
static receivers whose displayed brightness, lit composite after ACES and sRGB, changes by that many 8-bit levels
between consecutive frames; ground truth as floor) and writes a **flicker map** per image (`flicker-<id>.png`, report key
**f**). It is a distance effect too: the same wall shadow is calm in the close-up views.

**FFX looks "solid" partly because it's wrong.** Over the knot's soft shadow, FFX is 0.05–0.07 darker than the
ground truth across most of the penumbra (true visibility 0.2–0.98; run `20261028-004937-knot-slow`, `--raw`), and it
holds that error still from frame to frame. Ours is within ~0.02. Matching FFX's darkness would move away from the
path-traced result; the flicker is what to fix.

**What causes it (option sweeps on `demo`, runs `20261028-*-demo-*`).** Flicker ≥4 with the knot still (ours 0.091 %,
FFX 0.016 %): `antiLagGain 0` 0.053 %, `clampSigma 0.8` 0.057 %, `historyScale 0` 0.067 %; no effect from `snapHardPx`,
`uniformSnap`; worse with the old rotating kernel (0.114 %), one spatial pass (0.143 %), no stabilization (0.201 %). The
history-restart / clamp machinery keeps re-injecting noise into a still scene, and `historyScale` shortens the history
of narrow penumbrae, which get narrower in pixels with distance.

| `demo` camera | knot | fl ≥2 | fl ≥4 | umbra RMSE | pen. RMSE | knot RMSE | tErr |
|---|---|---:|---:|---:|---:|---:|---:|
| FFX | still / 1× / 4× | 0.06 / 0.04 / 0.05 % | 0.016 / 0.006 / 0.012 % | 0.073 / 0.073 / 0.075 | 0.079 / 0.080 / 0.080 | – / 0.039 / 0.045 | 0.0054 / 0.0052 / 0.0053 |
| ours (defaults) | | 0.22 / 0.23 / 0.31 % | 0.091 / 0.099 / 0.120 % | 0.018 / 0.018 / 0.019 | 0.027 / 0.027 / 0.031 | – / 0.014 / 0.018 | 0.0047 / 0.0046 / 0.0048 |
| A: `historyScale 0, clampSigma 0.8, antiLagGain 0, maxHistory 31` | | 0.03 / 0.04 / 0.04 % | 0.010 / 0.017 / 0.014 % | 0.014 / 0.015 / 0.021 | 0.025 / 0.029 / 0.037 | – / 0.020 / 0.031 | – / 0.0016 / 0.0019 |
| B: `historyScale 0, clampSigma 1.2` | | 0.11 / 0.12 / 0.15 % | 0.031 / 0.040 / 0.043 % | 0.014 / 0.015 / 0.019 | 0.022 / 0.023 / 0.031 | – / 0.015 / 0.026 | – / 0.0027 / 0.0029 |

A reaches FFX's flicker and stays 2–5× more accurate in the shadow, but lags on the moving knot's own surface (knot RMSE
+50…70 %, still under FFX). B halves the flicker without an accuracy loss in the shadow, but also lags on the knot's surface (+12 % at 1×, +43 % at 4×). Neither is A/B'd under rule 9
yet (test bed 7 paths + real captures, moving cameras: anti-lag 0 and a longer history are exactly what trails under
camera motion), and neither is on the review bench (rule 12). The bench still scores a still camera only.

