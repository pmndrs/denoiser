# Golden scenes (G1-G5): registry, modes and the headless contract

_Owner: agent T0-scenes (`track/t0-scenes`). Consumer: agent T0-scorecard (`track/t0-scorecard`), the Windows
native harness (via captures), and every track (R, S, D). Status of each item is at the end ("Status")._

Every track is judged on these five scenes ([STOCKTAKE §5.1](../../docs/research/rt-denoiser/STOCKTAKE-2026-11-06.md),
[TRACKS.md](../../docs/research/rt-denoiser/TRACKS.md)). They are real three.js scenes with scripted, deterministic
paths. Code: `src/golden/` (one registry, one engine), page `golden.html`, Node driver `src/golden/driver.mjs`.
Existing scene code is reused, not rewritten (`src/realtime/*`: corner, Sponza/Bistro assets, WGSL rays).

## The registry

| id | scene | judges | paths (default first) | frames | events |
|---|---|---|---|---|---|
| **G1** | reflection bench (Ben's camera model, normal-mapped metal, traced + hybrid) | specular | _external page_ (`reflect-bench.html`, owned by R) | - | - |
| **G2** | the knot over a floor, area light, **moving occluder** | shadows | `occluder` (static close-up camera, knot rotates), `orbit` (orbit camera, knot rotates) | 64 | - |
| **G3** | Sponza orbit | diffuse GI + AO | `orbit`, `pan`, `hold` (still camera, 32 frames: boil against a static scene) | 64 / 32 | - |
| **G4** | Bistro pan with a **light change** | diffuse, light-change lag | `pan-light-on` (step), `pan-light-colour` (colour step at constant luminance), `pan-light-fade` (ramp 24-40), `pan-lamp-switch` (lamp A off, lamp B on), `hold-light-on` (still camera, step at 16) | 64 / 32 | at frame 32 (fade: 24, hold: 16); see `events` |
| **G5** | product turntable (glossy + rough, normal maps, environment light) | specular + diffuse | `turntable` | 64 | - |

Scene ids are the registry keys; paths are `G2/occluder` etc. `list()` returns this table as data (below).
Each path is a **pure function of the path frame** (and the seed for the noise only): same scene, path, seed and
resolution give bit-identical input frames.

## Modes

| mode | what the denoiser sees | use |
|---|---|---|
| `run` | the 1-sample-per-pixel noisy signals (blue-noise rays, three's stochastic SSR), denoised by the chosen denoiser | the product |
| `perfect` | the **converged** signals of the same frame (`perfectSpp` samples, default 256) in place of the 1-spp ones; guides unchanged. Input noise is (almost) gone, so what remains is the denoiser's own temporal/filter behaviour (lag, blur, ghosting) | tell input noise from denoiser error |
| `reference` | no denoiser: only the references are produced, per frame, `referenceSpp` samples (default 4096) | ground truth for `output` comparisons |
| `capture` | writes the path as a CAPTURE-FORMAT v0 capture (`docs/research/rt-denoiser/CAPTURE-FORMAT.md`) with per-frame references | native NRD on Windows, `tools/rt-capture` |

In `run` and `perfect`, references can additionally be produced on demand (`reference` reads; see `withReference`),
at the cost of holding each pose for the accumulation. `perfect` is available on every scene (G2 shadows: converged
visibility; G3/G4/G5: converged diffuse, AO and SSR specular); its limits are listed per scene under "Scenes".

## Denoisers (`denoiser` = registry id)

| id | diffuse | specular | shadow | AO |
|---|---|---|---|---|
| `raw` | input | input | input | input |
| `ours` (default) | `realtimeDiffuseSpecular` | `realtimeDiffuseSpecular` | `realtimeShadows` | `realtimeOcclusion` |
| `ffx` | raw | `ffxReflections` | `ffxShadows` | raw |

`ours` takes review-bench option overrides: `options` = a `SideConfig` of option ids from
`src/review/options.ts` (e.g. `{"gi.filter":"recurrent","shadows.lightMotion":1}`), resolved with
`src/review/config.ts nodeOptions()`. More denoisers register with
`registerGoldenDenoiser({ id, build })` in `src/golden/denoisers.ts` (OIDN 3 adapts there).
`info().applies` says which signals a denoiser really processes.

## The headless contract

### Page and parameters

`golden.html?scene=G3&path=orbit&mode=run&denoiser=ours&res=half&seed=1` (dev server; port 5301 for this track).
One scene/path/mode/denoiser per page load (the graph is built for it). Parameters: `scene`, `path`, `mode`
(`run|perfect|reference|capture`), `denoiser`, `options` (JSON), `res` (`1080p` = 1920x1080, `half` = 960x540,
default `half`) or `w`+`h`, `seed` (default 1), `referenceSpp` (4096), `perfectSpp` (256), `referenceSppSpec` (cap on the SSR reference frames, default 4096), `difRays` (diffuse rays per
reference sub-frame, 8), `visGrid` (shadow rays per sub-frame = visGrid^2, 2x2), `withReference` (0|1), `lean` (0|1: no composites and
guides, for timing runs), `signals` (comma list of the denoised signals to build; default all). `golden.html?list=1` builds nothing and only answers `list()`.
The page runs headless without UI beyond a status line; frames are stepped **only** by `step()` (no free-running loop).
Ready: `window.__golden.ready === true`; on failure `window.__error` holds the message.

### API (`window.__golden`)

```ts
list(): { scenes: SceneInfo[]; modes: string[]; denoisers: DenoiserInfo[]; signals: SignalInfo[] }
info(): {                                   // the built configuration
  scene, path, mode, denoiser, width, height, seed, frames, referenceSpp, perfectSpp,
  signals: string[],                        // denoised signals of this scene: diffuse, specular, shadow, ao
  applies: Record<string, 'denoised' | 'raw'>,      // per signal for this denoiser
  events: { frame: number; type: string; note: string }[],
  lights: ..., camera: { near, far, fov }, three: string, gpu: { vendor, architecture, description }
}
state(): { frame: number | null /* last rendered path frame */; framesRendered: number }
reset(): Promise<void>                      // drop history; next step() renders path frame 0 as a camera cut
seek(frame): Promise<void>                  // like reset, then the next step() renders `frame` (a cut)
step(n = 1): Promise<StepResult>            // renders the next n path frames in order (no cut); returns the last
  // StepResult = { frame, resetFrame: boolean, wallMs, gpuMs: Record<pass, ms>, referenceFrames?: number }
read(spec): Promise<Buffer4>                // spec = { signal, kind } -> { width, height, channels, data: Float32Array }
readB64(spec): Promise<{ width, height, channels, b64: string }>   // same bytes, little-endian f32, for CDP transport
hash(spec): Promise<string>                 // SHA-256 hex of the bytes of read(spec); the determinism check
timings(): { frame, wallMs, gpuMs: Record<string, number>, gpuTotalMs, passes: string[] }
capture(o?): Promise<{ name, path, frames, bytes }>   // mode 'capture': whole path -> tools/rt-capture/captures/<name>/
```

**`read` specs.** Row 0 is the top of the image, channels interleaved, `float32`. `Float32Array`s cannot cross CDP:
use `readB64` (or the Node driver).

| `signal` | channels | meaning |
|---|---|---|
| `diffuse` | 3 | demodulated diffuse radiance (never multiplied by albedo) |
| `specular` | 3 | three's stochastic SSR output (carries its GGX sample weight; not demodulated, as in all existing captures) |
| `shadow` | 1 | visibility of the scene's shadow light, [0, 1] |
| `ao` | 1 | ambient-occlusion factor from the diffuse ray hit distances |
| `lit` | 3 | the composite `albedo * (diffuse + direct(shadow)) + specular`, linear HDR |
| `display` | 3 | `lit` after the scene's tone mapping (ACES) and sRGB encode, [0, 1] (the "8-bit display levels" of the bias metric: multiply by 255) |
| guides: `depth`, `viewz`, `normal`, `normal_geom`, `roughness`, `motion`, `motion_z`, `albedo`, `f0` | 1/1/3/3/1/2/1/3/3 | CAPTURE-FORMAT conventions, for the metric masks (static / moving / disoccluded regions) |
| `mask_mover` | 1 | 1 on the pixels of the moving object (knot, product), 0 elsewhere; 0 on scenes without one |

| `kind` | meaning |
|---|---|
| `input` | what the denoiser was fed this frame: the 1-spp signal (`run`) or the converged one (`perfect`) |
| `noisy` | always the 1-spp signal (even in `perfect`) |
| `output` | the denoiser's output for this frame (equals `input` for `raw`) |
| `reference` | the converged signal of this frame (`referenceSpp` samples; needs mode `reference`/`capture` or `withReference=1`) |

Reading is only valid after a `step()` and before the next one. `step()` and every read are serialized by the page.
`read` goes through a chunked transfer (`readStart` + `readChunk`, 1 MB per CDP message: Node's WebSocket stalls on single
messages of several MB); `readB64` is the one-message variant for small buffers.

**Frame stepping.** `step()` advances one path frame; at 1080p `run` costs about the real-time cost of the scene
(milliseconds); `perfect` and `reference` hold the pose and accumulate (`perfectSpp` / `referenceSpp` samples over
several rendered sub-frames: rays per sub-frame are fixed per signal, see "Cost"), so they are seconds to minutes per
frame. The denoiser runs exactly once per path frame in every mode (the accumulation sub-frames never touch its history).

**Timings.** `gpuMs` are WebGPU timestamp-query durations per pass of the denoiser nodes (the package's own
`gpuTimings`), keyed `<node>.<pass>` with node one of `diffuse+specular`, `ao`, `shadow` (ours) or `specular`, `shadow` (ffx), a
`<node>.total` each and an overall `total` (the sum), refreshed by each `step()` (the previous dispatch's values, as everywhere in this
project); `wallMs` is submit-to-done wall time of the denoised frame including the queue sync (`device.queue.onSubmittedWorkDone`),
so it contains overhead the GPU timestamps don't. For protocol-grade timing use `time(n)`, which steps `n` frames of
`run` (no reads, no references) and returns median / min / mean per pass and wall (TASKS rule 11: hold the GPU lock).

### The Node driver (`src/golden/driver.mjs`)

Wraps Chrome over CDP (the same `tools/rt-capture/lib/headless.mjs` launch flags), so the scorecard doesn't re-implement it:

```js
import { openGolden } from './src/golden/driver.mjs';
const g = await openGolden({ port: 5301, scene: 'G3', path: 'orbit', mode: 'run', denoiser: 'ours', res: 'half', seed: 1 });
await g.step(1);
const out = await g.read({ signal: 'diffuse', kind: 'output' });   // { width, height, channels, data: Float32Array }
await g.close();
```

CLI (writes the file layout below): `node src/golden/driver.mjs record --scene=G3 --path=orbit --mode=run --denoiser=ours
--reads=diffuse:output,diffuse:input,diffuse:reference --frames=0-63 --out=<dir>`; `list`; `determinism`; `time`.

```
<out>/<scene>_<path>_<mode>_<denoiser>_<w>x<h>_s<seed>/
  run.json           scene, path, mode, denoiser(+options), seed, size, frames, referenceSpp, gpu, three, commit, date
  timings.csv        frame,pass,ms         (pass = denoiser pass names, 'total', 'wall')
  frame_0000/<signal>.<kind>.f32           e.g. diffuse.output.f32, shadow.reference.f32, display.output.f32
  frame_0000/<guide>.f32                   guides, once per frame
```

### Capture mode

`mode=capture` (or the driver's `capture` command) writes `tools/rt-capture/captures/<name>/` (`$RT_CAPTURE_DIR/captures/`)
in CAPTURE-FORMAT v0 (v1 for G5: `normal_geom`), 33 floats per pixel, `referenceSpp` references for diffuse, specular
(`specular_ref`), visibility and AO (`ao_ref`), frame 0 a reset, per-frame `lights` (G4's lantern power changes at frame 32). Validate with `node tools/rt-capture/validate.mjs <name>`. Default capture size is `half` (68 MB/frame at
960x540, 275 MB/frame at 1080p).

## Recommended scoring flow

References depend only on (scene, path, resolution, seed, `referenceSpp`), never on the denoiser. So: (1) once per scene/path/resolution
run `record --mode=reference --reads=diffuse:reference,specular:reference,shadow:reference,ao:reference,display:reference --guides=1`
and keep the files; (2) per denoiser run `record --mode=run --denoiser=<id> --reads=<signal>:output,...` (and `--mode=perfect` for the
same denoiser with `<signal>:input` as the perfect input); (3) the scorecard compares output files with the cached reference files
frame by frame. In `perfect` mode `reference` reads return the `perfectSpp` converged signal (the same data as `input`), not the
4096-spp one. `run` with `--withReference` produces references in the same pass, at the cost of holding every pose (slow).
The reference of frame f is independent of which frames were rendered before it, so frame ranges can be split across processes.

## Scenes

All scenes: 960x540 (`half`) or 1920x1080, 64 path frames, one blue-noise ray per signal per pixel, three's stochastic SSR for
specular (with environment importance sampling, so the environment's reflection is part of `specular`, not only screen-space
hits), no jitter, `reversedDepth: false`. Guides carry the previous pose exactly: `motion` / `motion_z` come from the
previous path frame's camera and, for moving objects, the object's previous pose (not from three's velocity buffer, which
cannot be right while a pose is held for references).

### G1 reflection bench
Owned by track R. `reflect-bench.html` (moved from `feat/interior-lab` by R's first commit, cherry-picked here as `16720b8`)
has its own scripted API (`configure`, frame-locked `step`, GPU timings, orbit pose hold; `results/data/r/rb-run.mjs` is its
runner). It is **registered** in the table and in `list()` as `kind: 'external'`; the golden engine does not render it, and
`golden.html?scene=G1` says so. R and the scorecard agree between them how G1's numbers enter the dashboard.

### G2 the knot over a floor (`occluder`, `orbit`)
The furnished corner of the realtime pages (20,862 triangles, procedural, glossy floor roughness 0.12) with the 1.62 x 1.2 m area
light (rectangular panel; the shadow denoiser gets the sphere of equal area). Torus knot on a pedestal rotating
0.35/60 rad per frame about its tilted axis: its soft shadow sweeps the back wall and floor. `occluder` is the static close-up
camera (`KNOT_VIEW`), `orbit` the orbit + pan camera of `src/realtime/path.ts`. Shadow light: the panel. Mover = the knot
(`mask_mover`, object motion in `motion`).

### G3 Sponza orbit (`orbit`, `pan`)
Crytek Sponza, geometry only (262,267 triangles, flat colour per material, glossy floor), sun (angular radius 0.02 rad) as the
shadow light, a warm lamp in the south aisle, sky gradient for misses. One-bounce diffuse GI with a sun shadow ray at the bounce
point (`src/realtime/rays.ts`). Camera only. Needs the model (Git LFS; `$RT_SCENE_ASSETS`, CAPTURES.md).

### G4 Bistro pan with a light switching on (`pan-light-on`)
Amazon Lumberyard Bistro exterior, geometry only (2.83 M triangles). `bistro-pan` camera. The sun is the shadow light as in
`bistro-pan`; a street lantern (sphere r 0.12 m at (-2.5, 2.4, -9.5), colour warm, power 60) is **off for frames 0-31 and on
from frame 32**, a step. In the converged diffuse the frame-mean jumps from 0.262 to 0.649 (x2.5) between frames 31 and 32.
`events` lists it (`light-on` at 32). References are converged per frame for that frame's lighting, so the reference steps too.
Lag (the scorecard's number 3) is measured from frame 32 on `diffuse` (and `display`).

### G5 product turntable (`turntable`)
Flight Helmet (Microsoft, via Khronos glTF-Sample-Models; **CC0 1.0**; `src/golden/assets/g5-flight-helmet/NOTICE.md`): six materials
with base-colour, normal and occlusion-roughness-metalness maps (glossy lenses and glass/plastic, rough leather and rubber,
polished and brushed metal), textures downscaled to 1024 px. On a plinth that rotates with it, 1.5 deg/frame about the vertical
axis (96 deg over the path); static 3/4 camera, a satin floor, a soft key (sun, angular radius 0.07 rad), a warm-cool fill sphere and a studio
sky as the environment light. The shading normal (normal-mapped) is the denoiser guide and `normal`; `normal_geom` is the vertex
normal (v1 capture buffer). Mover = plinth + helmet.

## Reference noise and boil (read before scoring calm)

`refSeed=fixed` (default): reference sample seeds (diffuse, shadow, SSR frames) do **not** depend on the path frame, so the
reference's own noise is a static pixel pattern: on a still camera the reference has exactly zero frame-to-frame change (measured:
G3 `hold`, rmse 0), and on moving paths its "boil" comes only from the scene moving under that fixed pattern, not from fresh noise.
`refSeed=frame` gives fresh noise per frame (the old behaviour, which boiled more than any denoiser). Noise floor of one 4096-spp
reference, measured as two seeds / sqrt 2 against the 1-spp noise (G2 and G3, 960x540): diffuse 27 dB, AO 27 dB, shadow 25-27 dB,
specular 13 dB (SSR's own variance) below the 1-spp noise. For calm measurement use the `hold` paths with `referenceSpp=16384`
(4x: 6 dB lower floor), where a denoiser's boil is measured against a static, near-noise-free target.

## Light-change paths (G4)

All five G4 paths run the same camera (`bistro-pan`; `hold-light-on`: pan frame 20, still). The references are converged per frame for that
frame's lighting, so they step, ramp or change colour with the event. Lag = frames after `events[0].frame` until error is back within 10 % of its
settled level. Each path exports as its own CAPTURE-FORMAT capture with per-frame `lights` (power / colour / position of the lantern), so
native NRD replays it unchanged (`golden-G4-<path>`; sizes below).

## Cost of the reference modes

Measured on the M5 Pro at 960x540, `referenceSpp = 4096` (512 diffuse sub-frames of 8 rays, 1024 shadow sub-frames of 2x2, 4096 SSR
frames), one path frame: **G2 1.5 s, G3 7.9 s, G4 21.3 s, G5 1.7 s**; G2 at 1080p 6.2 s. A 64-frame reference/capture is about 1.6 min (G2),
8.5 min (G3), 23 min (G4). 16384 spp is 4x.

## Measured denoiser cost, 1080p, `lean`, M5 Pro (indicative: the GPU was not verified idle)

| scene | ours: diffuse+specular / ao / shadow / total GPU ms | FFX: specular / shadow / total | wall ms (ours / ffx, whole frame incl. rays) |
|---|---|---|---|
| G2 | 6.79 / 3.24 / 1.25 / 11.44 | 2.82 / 0.86 / 3.73 | 28.6 / 18.5 |
| G3 | 8.28 / 4.17 / 1.42 / 14.14 | 3.17 / 1.15 / 4.25 | 100.1 / 82.2 |
| G4 | 7.22 / 4.09 / 1.77 / 13.30 | 2.58 / 1.31 / 3.97 | 235.3 / 187.9 |
| G5 | 5.29 / 2.62 / 0.81 / 8.99 | 2.60 / 0.94 / 3.48 | 27.7 / 21.6 |

These are higher than the 4.4 ms recorded for joint diffuse+specular elsewhere; other agents' jobs ran around my lock hold, so re-measure
with `driver.mjs time` on an idle GPU before using them as the cost number.

## Status

- G2-G5 render headless in `run`, `perfect`, `reference` and `capture` modes (G3 `pan`/`hold`, all five G4 paths added after track D's request);
  `perfect` works on all four (converged diffuse, AO, shadow, SSR specular); G1 is registered as external (R's bench).
- Determinism (`driver.mjs determinism`): two page loads, same seed, 20-42 reads each (1-spp diffuse/shadow/specular/AO, display, depth,
  motion): identical SHA-256 on G2, G3, G4, G5 (and G2 `perfect` converged inputs); a different seed changes every noisy read.
- Captures: an 8-frame capture of each of G2-G5 (256 spp) passed `tools/rt-capture/validate.mjs` (VALID; warnings only for the `ao_ref`
  extra buffer and `specular` demodulation `none`); 65 MB/frame (G5: 71 MB with `normal_geom`).
- Full 64-frame, 4096-spp captures: `src/golden/capture-all.sh` (priority: G3 orbit, the G4 light-change paths, the two holds at
  16384 spp, then G2, G5; 4.2 GB each at half resolution). Started under the GPU lock; progress in the log of whoever launched it
  (here `/tmp/t0s-full.log`), files in `tools/rt-capture/captures/golden-*` of the worktree `Denoiser-track-t0s`.
- Known limits: specular is three's SSR (not demodulated, manifest says `none`); the G5 denoiser guide is the shading normal; timings above are not idle-GPU.
