# Test-bed captures

The test bed writes [CAPTURE-FORMAT v0](../../docs/research/rt-denoiser/CAPTURE-FORMAT.md)
captures of its own frames, so the same inputs can be replayed through our WGSL
denoisers (`replay()`, `tools/rt-capture`) and through native NRD on the Windows machine
([NATIVE-HARNESS.md](../../docs/research/rt-denoiser/NATIVE-HARNESS.md) phases 4–5), and
both scored with one scorer (`tools/rt-capture/compare.mjs`). Captures are raw f32 and
big; they live in `tools/rt-capture/captures/` (or `$RT_CAPTURE_DIR/captures/`), which is
gitignored. Never commit them.

## The standard capture set

One command writes and validates it (from the repo root; macOS, Windows, Linux):

```sh
node examples/realtime-denoiser/run-headless.mjs --serve --set=standard
```

(Windows PowerShell: `$env:RT_CAPTURE_DIR = "C:\dev\nrd-reference"` first, so the files
land where the native harness reads them.) It takes about 45 s on an M5 Pro, writing
**10.62 GB (9.89 GiB)**:

| capture | path frames | size | frames | why |
|---|---|---|---|---|
| `std540-orbit` | orbit 0–15 | 960×540 | 16 | easy case, steady reprojection |
| `std540-pan` | pan 0–15 | 960×540 | 16 | disocclusion every frame, off-screen reveals |
| `std540-light` | light 40–63 | 960×540 | 24 | light flips side at local frame 8: anti-lag |
| `std540-thin` | thin 0–15 | 960×540 | 16 | 4 cm fence slats and their thin shadows |
| `std540-glossy` | glossy 0–15 | 960×540 | 16 | low over the glossy floor: specular, roughness bands |
| `std540-cut` | cut 40–63 | 960×540 | 24 | camera cut (reset) at local frame 8, then 16 frames |
| `std540-object` | object 0–15 | 960×540 | 16 | moving sphere: object motion, `motion_z`, moving shadow |
| `std1080-orbit` | orbit 0–7 | 1920×1080 | 8 | full-resolution quality and per-pass timings |

Every capture has all three signals (diffuse, specular, visibility), their hit
distances, every guide (depth, viewz, normal, roughness, motion, motion_z, albedo, f0) and
256-spp references: 32 floats per pixel, **66.4 MB per frame at 960×540** and **265.4 MB
at 1080p**. Frame 0 of each capture is a reset (history dropped), wherever it starts on
the path. The set is defined in [`capture-sets.mjs`](capture-sets.mjs).

### Why this set

- **Budget.** At 66 MB a frame, 10 GB holds ~150 frames at 960×540, so full 96-frame
  paths (45 GB) are out. 16 frames per path give 8 "settled" frames (CAPTURE-FORMAT skips
  8 after each reset), enough to compare steady quality between denoisers on identical
  frames; temporal filters are not fully converged at 16 frames, and the comparison is
  relative (ours vs native on the same frames), so that is acceptable.
- **Events, not starts.** `light` and `cut` start at path frame 40, so their event
  (light flip, camera cut at 48) comes 8 frames in, after some history has built up, and
  16 frames follow it: what M2's anti-lag and every denoiser's reset handling need.
- **Coverage per milestone.** M1 (SVGF vs RELAX-class) and M2 (recurrent diffuse vs
  REBLUR-class): orbit, pan, light, cut, object. M3 (specular): glossy, orbit, pan.
  M4 (shadows vs SIGMA-class): thin, light, object, orbit. `std1080-orbit` is for the
  1080p per-pass ms target (SPEC §10) and a full-resolution quality check.
- **Longer sequences** when a question needs them: the same command per capture, e.g.
  `"mode=capture&name=orbit-96&path=orbit&frames=96"` (6.4 GB), and delete it afterwards.

### Replaying and scoring the set

```sh
node examples/realtime-denoiser/run-headless.mjs --serve --set=standard --replay=passthrough,accumulate-32,svgf,ffx-shadows
node tools/rt-capture/compare.mjs std540-glossy          # every denoiser folder of one capture (incl. native ones)
```

`--replay` runs every capture of the set through every listed registry denoiser
(outputs in `outputs/<capture>/<id>/`) and then `compare.mjs` per capture.

## v1 captures (M7 SH / M8 translucent shadows)

[CAPTURE-FORMAT v1](../../docs/research/rt-denoiser/CAPTURE-FORMAT.md#v1-directional-payloads-and-translucent-shadows)
captures for the directional (SH) and translucent-shadow variants, one command (from the repo root):

```sh
node examples/realtime-denoiser/run-headless.mjs --serve --set=v1      # 5 captures, validated, 8.63 GB (8.03 GiB), ~2 min
```

| capture | path frames | signals | size | why |
|---|---|---|---|---|
| `v1-bumpy` | bumpy 0–31 | sh-diffuse, sh-specular | 32 × 103.7 MB | normal-mapped floor (domes 10–40°) and rippled wall, cyan area light; glossy bumpy floor (M7-13) |
| `v1-bounce` | bounce 0–15 | sh-diffuse | 16 × 70.5 MB | bumpy corridor between a red and a green wall: coloured directionality, YCoCg vs RGB (SPEC item 10) |
| `v1-glass` | glass 0–15 | shadow-rgb | 16 × 58.1 MB | framed amber glass (striped alpha) over a blue-green panel: coloured, nested penumbrae, product colour in the overlap; camera orbit (M8-10) |
| `v1-glass-moving` | glass-moving 0–39 | shadow-rgb | 40 × 58.1 MB | the framed panel slides and turns over a static receiver, static camera (no motion vector follows its shadow) |
| `v1-glass-still` | glass-still 0–15 | shadow-rgb | 16 × 58.1 MB | glass-moving frozen at its frame-24 pose: the boil control (its reference boil is 0) |

All 960×540, 256-spp references, version-1 manifests. Each holds only its signals' buffers: every guide plus
`normal_geom`; sh-* add `diffuse` / `specular`, `*_hitt`, `*_dir`, `*_ref` and `*_sh_ref`; shadow-rgb adds
`visibility`, `occluder_dist`, `transmittance`, `translucent_dist`, `visibility_ref`, `shadow_rgb_ref`. The same
windows render live with `mode=eval&path=<path>&start=0&frames=<n>&signal=<signals>` (capture-sets.mjs `evalQuery`);
live and replay metrics agree to 4 decimals (pooled, bump, band, floor, vs SH ref, tint, chroma; the shadow-rgb
dynamic split within 0.03 dB, `shadows-lumt` within 0.0002 dB because the replay derives v·lum(T) on the CPU).

Baselines on the set (replay + `compare.mjs`, pooled PSNR; band energy 1 = detail kept):

| capture | signal | noisy | accumulate-32 | svgf-plain (detail normal) | svgf-plain-smooth (`normal_geom`) | band energy plain / smooth |
|---|---|---|---|---|---|---|
| v1-bumpy | sh-diffuse | 16.18 | 25.85 | 35.37 | 34.69 | 1.22 / 0.17 |
| v1-bumpy | sh-specular | 17.94 | 25.86 | 30.93 | 28.12 | 0.53 / 0.14 |
| v1-bounce | sh-diffuse | 14.65 | 22.25 | 35.52 | 33.77 | 1.40 / 0.09 |

| capture | shadow-rgb: noisy | accumulate-32 | shadows-lumt (grey) | chroma err noisy / acc-32 / lumt | visibility: shadows (v2.2) |
|---|---|---|---|---|---|
| v1-glass | 21.08 | 28.46 | 27.98 | 0.068 / 0.009 / 0.065 | 35.46 |
| v1-glass-moving | 20.47 | 20.39 | 26.00 | 0.064 / 0.033 / 0.066 | 33.04 |
| v1-glass-still | 20.82 | 29.57 | 26.34 | 0.062 / 0.013 / 0.068 | 37.99 |

```sh
node examples/realtime-denoiser/run-headless.mjs "mode=replay&capture=v1-bumpy&denoiser=svgf-plain"
node tools/rt-capture/compare.mjs v1-bumpy [--sh-k 1 --sh-s 0]      # v1 tables at the end of compare.md
node tools/rt-capture/preview.mjs v1-glass --strip shadow-rgb --frame 15
```

## Reflection-motion captures (review target 2)

The reflect build's isolated reflection tests ([results/REFLECTION-MOTION.md](../../docs/research/rt-denoiser/results/REFLECTION-MOTION.md),
paths `rm-*` in `src/paths-reflect.ts`) as captures, so native NRD (Windows harness, black box) and our replay see the
same frames. Specular only (guides, `specular`, `specular_hitt`, `specular_ref`), 960×540, path frames 0–47 (40 moving,
7 held): **45.6 MB per frame, 13.1 GB for the set**. Not written by default; write them when a native comparison is due:

```sh
node examples/realtime-denoiser/run-headless.mjs --serve --set=reflect
```

| capture | path | what moves | why |
|---|---|---|---|
| `rm540-cam-plane` | `rm-cam-plane` | camera | plane mirror under camera parallax (near and far marker) |
| `rm540-obj-plane` | `rm-obj-plane` | reflected marker | zero-parallax motion: the trail case of A-SVGF |
| `rm540-refl-turn` | `rm-refl-turn` | mirror turns | reflector rotation |
| `rm540-cam-convex` | `rm-cam-convex` | camera | convex curvature |
| `rm540-cam-concave` | `rm-cam-concave` | camera | concave mirror, a real image past the focus |
| `rm540-cam-plane-r10` | `rm-cam-plane-r10` | camera | glossy (r 0.1), 1024-spp reference |

The marker positions, and with them the oracle's image positions, come from the path definition (frame index =
path frame), so a replay output can be scored with `src/reflect-oracle.ts` without the live test bed. Live, the same
metrics are one eval page per path (`signal=specular&mode=eval&path=rm-…`, results under `results.reflect`).
The manifest's `static` flag only looks at marker 1 (`src/capture.ts` `isStatic`): `rm540-refl-turn` says static
although its mirror turns (no consumer reads the flag today).

## Capture and replay, one at a time

```sh
# test bed dev server (or pass --serve to run-headless.mjs)
yarn workspace realtime-denoiser dev                      # http://127.0.0.1:5220/
cd examples/realtime-denoiser
node run-headless.mjs "mode=capture&name=my-orbit&path=orbit&frames=16"            # all signals, 960x540, 256 spp
node run-headless.mjs "mode=capture&path=cut&start=40&frames=24&preset=full&signal=shadows"
node ../../tools/rt-capture/validate.mjs my-orbit
node run-headless.mjs "mode=replay&capture=my-orbit&denoiser=svgf"                 # outputs/my-orbit/svgf/
node ../../tools/rt-capture/compare.mjs my-orbit
```

Capture options (`src/main.ts` header): `name=` (default
`testbed-<path>[-s<start>]-<frames>f-<W>x<H>`), `path=`, `start=` (path frame that
becomes frame 0), `frames=`, `preset=fast|full` or `w=&h=`, `signal=all|diffuse,...`,
`refspp=` (0 = no references: a timing-only capture), `denoiser=a,b` (also evaluate those
live in the same run). The live eval of the same window (`mode=eval&path=…&start=…&frames=…`)
renders exactly the captured frames; `capture-sets.mjs` `evalQuery()` builds it.

Replay: `mode=replay&capture=<name>&denoiser=<id>[&signals=diffuse,specular][&frames=N][&output=<folder>][&warm=<ms>][&<setting>=v]`
on the test bed (port 5220) is the same code as the replay page in `tools/rt-capture`
(port 5230, `tools/rt-capture/src/run.ts`); use whichever server is running. Replay
signal names are the capture's: `visibility` is the test bed's `shadows`.

## What a test-bed capture contains

- Manifest: `scene: "realtime-denoiser-testbed"`, `generator` with the commit,
  `static: false` only for windows where the movable sphere moves (`object`),
  `lights` = the sphere light at frame 0 (`shadow: true`, `color` = its radiance),
  `referenceSpp: 256`, standard `demodulation` names (the tracer's specular term is
  CAPTURE-FORMAT's Karis 2014 env-BRDF), and an extra `testbed` key (path, start,
  frames, signals, query, adapter).
- Per-frame extras (ignored by v0 readers): `pathFrame`, `lights` (the light moves and
  shrinks in path `light`; v0's capture-level `lights` holds only frame 0's), `object`
  (the movable sphere's position and radius).
- Sampling: spatiotemporal **blue noise** (`sampling=blue`, the test bed's default since
  T1.5; `extra.testbed.sampling` in the manifest records it). Captures made before
  2026-10-25 01:00 used white noise; the standard set was regenerated then. Add
  `&sampling=white` to a capture query for the old sampler.
- No jitter (`[0, 0]`), `reversedDepth: false`, near 0.1, far 100. Geometry beyond the
  far plane (the ground at the horizon) is sky in the guides (depth 1, viewz −far,
  normal 0); its signals keep their traced values.
- Bit-exact with the live test bed: the rgba16float textures (normal, albedo, f0,
  diffuse, specular) are written as the exact f32 value of each half. The round trip is
  in [RESULTS.md](RESULTS.md#capture-round-trip-t07-our-side-2026-10-25).

## Windows notes

`run-headless.mjs` (both this one and `tools/rt-capture/run-headless.mjs`) finds Chrome
in Program Files / Program Files (x86) / LocalAppData (`CHROME=` overrides), passes
`--use-angle=metal` only on macOS, keeps its profile under `os.tmpdir()` and starts Vite
with `node` directly (no shell). Untested on Windows so far: see NATIVE-HARNESS phase 5.

## Real-scene captures (three-temporal)

A second capture set comes from the three.js scene of `examples/three-temporal` (moving camera,
per-pose references, 960×540): `three-orbit` (40 frames) and `three-pan` (32 frames), written by
`node examples/three-temporal/run-realtime.mjs capture --set=moving` and replayed / scored with
`examples/three-temporal/replay-captures.mjs`. Recipe, contents and what's missing (specular is SSR,
not demodulated; AO reference in an extra `ao_ref` buffer):
[examples/three-temporal/CAPTURES.md](../three-temporal/CAPTURES.md).

## Shadow motion separation (`--set=shadow-motion`)

8 captures `sm-{hard,sun}-{camera,light,object,frozen}` (paths of the same names, `src/paths.ts`), 80 frames, 960×540,
shadows only (35.6 MiB/frame, ~2.8 GB each): one mover per path (camera orbit, light, a sphere resting on the floor)
or nothing, with move 1–24 / hold 25–40 / reverse 41–64 / hold 65–79; every path equals its frozen control at frame 0
and from frame 64 on. `hard` = sphere light r 4 cm ~1.6–2.6 m above the occluders; `sun` = sphere r 8 at distance 100
(0.08 rad), replayed with `sh.light=directional` or, for exact directions, `sh.light=sphere`. Scored with
`tools/rt-capture/shadow-regions.mjs`; results/SHADOWS-MOTION.md.

```sh
node run-headless.mjs --serve --set=shadow-motion     # ~1 min per capture, validated
```
