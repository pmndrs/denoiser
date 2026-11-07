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
| **G3** | Sponza orbit | diffuse GI + AO | `orbit`, `pan` | 64 | - |
| **G4** | Bistro pan with a **light switching on** | diffuse, light-change lag | `pan-light-on` | 64 | `light-on` at frame 32 (a street lantern, step change) |
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
`src/review/config.ts nodeOptions()`; `preset` names a decision preset. More denoisers register with
`registerGoldenDenoiser({ id, build })` in `src/golden/denoisers.ts` (OIDN 3 adapts there).
`info().applies` says which signals a denoiser really processes.

## The headless contract

### Page and parameters

`golden.html?scene=G3&path=orbit&mode=run&denoiser=ours&res=half&seed=1` (dev server; port 5301 for this track).
One scene/path/mode/denoiser per page load (the graph is built for it). Parameters: `scene`, `path`, `mode`
(`run|perfect|reference|capture`), `denoiser`, `options` (JSON), `preset`, `res` (`1080p` = 1920x1080, `half` = 960x540,
default `half`) or `w`+`h`, `seed` (default 1), `referenceSpp` (4096), `perfectSpp` (256), `withReference` (0|1),
`signals` (comma list; default all of the scene). `golden.html?list=1` builds nothing and only answers `list()`.
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
Reading all signals of one frame costs ~10 ms at half resolution.

**Frame stepping.** `step()` advances one path frame; at 1080p `run` costs about the real-time cost of the scene
(milliseconds); `perfect` and `reference` hold the pose and accumulate (`perfectSpp` / `referenceSpp` samples over
several rendered sub-frames: rays per sub-frame are fixed per signal, see "Cost"), so they are seconds to minutes per
frame. The denoiser runs exactly once per path frame in every mode (the accumulation sub-frames never touch its history).

**Timings.** `gpuMs` are WebGPU timestamp-query durations per pass of the denoiser nodes (the package's own
`gpuTimings`, per-pass names, `total`), refreshed by each `step()` (the previous dispatch's values, as everywhere in this
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
(`specular_ref`), visibility and AO (`ao_ref`), frame 0 a reset, per-frame `lights` (G4's lantern, G2's moving
nothing). Validate with `node tools/rt-capture/validate.mjs <name>`. Default capture size is `half` (68 MB/frame at
960x540, 275 MB/frame at 1080p).

## Scenes

(Filled in with the implementation: paths, lights, assets and licences, limits per mode.)

## Status

(Maintained at the end of the track: what runs, what is partial, measured costs.)
