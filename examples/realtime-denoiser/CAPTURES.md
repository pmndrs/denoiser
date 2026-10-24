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
