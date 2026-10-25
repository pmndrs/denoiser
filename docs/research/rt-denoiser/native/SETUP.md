# Native NRD harness: setup (Windows, RTX)

_Harness builder (RULES.md rule 4), 2026-10-25. This file holds build facts, versions, API usage
and conventions only. Nothing from NRD lives in this repo. Results are in [results/](results/README.md)._

## Machine

| | |
|---|---|
| GPU | NVIDIA GeForce RTX 3060 **Laptop** GPU, 6 GB (Ampere) |
| Driver | 592.00 (UMD 32.0.15.9200) |
| OS | Windows 11 Home, 10.0.26200 |
| API | D3D12, headless (no window, no swapchain) |

A laptop part is not the README's RTX 4080. Use these timings to compare against our WGSL on **this
same GPU** (NATIVE-HARNESS phase 5), not against published numbers.

## Where things are (outside this repo)

```
C:\dev\nrd-reference\
  NRD\        NVIDIA-RTX/NRD @ e06852bd545973cb224eb28820b891205cfc1624 (v4.18.0), built here
  harness\    the black-box driver, its own git repo (C++ + two small HLSL passes)
  captures\   synthetic-static, synthetic-plane, synthetic-plane-jitter (256²), synthetic-plane-1080p
  outputs\    full raw outputs: <capture>\nrd-*\frame_NNNN\<signal>.f32, run.json, timings*.csv, compare.md
  toolchain\  portable CMake 3.31.6, DXC 1.8.2505 (tried, unused), build and run logs
```

Raw full-sequence outputs stay in `C:\dev\nrd-reference\outputs\`. This repo only gets metrics,
`run.json`, `timings.csv` and 128-pixel PNG crops.

## Phase 1: NRD build

| | |
|---|---|
| NRD | v4.18.0, `e06852b`, built from source (releases have no binaries) |
| Fetched by NRD's CMake | NRI v190, ShaderMake `3f01623`, MathLib v11, DXC 1.9.2609.5 (ShaderMake download), Agility SDK 1.619.6 (via NRI) |
| CMake | 3.31.6 portable (the machine's 3.24 is below NRD's 3.30 minimum) |
| Compiler | Visual Studio 2022 17.10.3, MSVC 19.40.33811, Windows SDK 10.0.22621 |
| Options | `-DNRD_NRI=ON -DNRD_NORMAL_ENCODING=2 -DNRD_ROUGHNESS_ENCODING=1 -DNRD_EMBEDS_SPIRV_SHADERS=OFF -DNRD_EMBEDS_DXBC_SHADERS=OFF` |
| Config | Release only, then `Scripts\Windows\3-PrepareSDK.bat` (its Debug copies fail harmlessly) |
| NRD-Sample | not built (optional; the harness run proves the toolchain and GPU) |

Only DXIL is embedded. SPIR-V and DXBC were switched off because the harness is D3D12-only.

### Encodings chosen

- **Roughness: `LINEAR` (1).** Our capture's perceptual roughness r (GGX α = r²) is what NRD calls
  linear roughness, so it passes through unchanged.
- **Normals: `R10_G10_B10_A2_UNORM` (2), the default.** This isn't lossless: normals and roughness
  are quantized to about 10 bits on the way in. The exact float option didn't build (next item).

### Problems hit

1. **CMake too old.** The machine has 3.24; NRD needs ≥ 3.30. Fixed with a portable 3.31.6 in
   `toolchain\`.
2. **A global `CMAKE_TOOLCHAIN_FILE`** env var points at a vcpkg that doesn't exist, and configure
   fails. Unset it for the build shell.
3. **`NRD_NORMAL_ENCODING=4` (RGBA16_SNORM, usable with float textures) fails to build at this
   commit.** The RELAX temporal-accumulation shader permutations fail to compile with "too few
   elements in vector initialization", with both DXC 1.9.2609 (ShaderMake's default) and DXC
   1.8.2505. Encoding 2 builds cleanly. Patching NRD's shaders is not allowed under rule 4, so we
   use encoding 2. Not tried: encoding 3. Upstream may have fixed this after `e06852b`.
4. NRI logs a harmless warning at device creation (`CheckFeatureSupport(options22)` fails on this
   driver).

## Phases 2–3: harness

`C:\dev\nrd-reference\harness\` is about 900 lines of C++ plus two HLSL compute passes that call only
`NRD.hlsli` pack/unpack helpers. It works like this:

- **Device.** A native `ID3D12Device` on the high-performance adapter, one direct queue, wrapped with
  `nrd::Integration::RecreateD3D12` (NRI wrapper, `disableD3D12EnhancedBarriers = true`, because the
  harness uses legacy resource states). All harness textures stay in UAV state; the snapshot uses
  `restoreInitialState = true`.
- **Instances.** One `nrd::Integration` per denoiser: `REBLUR_DIFFUSE_SPECULAR`,
  `RELAX_DIFFUSE_SPECULAR`, `SIGMA_SHADOW`, and one `REFERENCE` per signal (diffuse, specular,
  visibility). All use default settings (`{}`). Each instance gets `NewFrame`, `SetCommonSettings`,
  `SetDenoiserSettings` and one `DenoiseD3D12` per frame.
- **Per frame.** Upload the raw `.f32` buffers, run a pack pass, then for each denoiser record
  timestamp → `DenoiseD3D12` → timestamp in its own command list. Submit and wait (that span is
  `wall`), then unpack to f32 and read back.
- **Outputs.** CAPTURE-FORMAT "Outputs from a replay" layout. Folder names: `nrd-reference`,
  `nrd-reblur`, `nrd-relax`, `nrd-sigma`. `timings.csv` rows are `total` (GPU timestamps around
  `DenoiseD3D12`) and `wall`; REFERENCE uses `<signal>/total` and `<signal>/wall`, which
  `compare.mjs` sums. `--loops N` replays the sequence N times and writes `timings-loops.csv`.
- **Checks.** The D3D12 debug layer and NRI validation (`--debug`) report only one benign warning
  (buffer initial state ignored). Two runs give bit-identical outputs. `REFERENCE` on
  `synthetic-static` equals a plain per-pixel running mean of the inputs to ≤ 7e-7 at every frame.

### Conventions mapping (ours → NRD), in words

- **Matrices.** The capture's `view`/`projection` and `prevView`/`prevProjection` (column-major,
  unjittered) go straight in as world-to-view / view-to-clip, current and previous. On reset frames,
  previous = current.
- **viewZ.** Ours is passed unchanged (negative in front); NRD accepts either sign. Sky pixels
  (depth at the far plane) are rewritten to −4·far and `denoisingRange` = 2·far, so sky is outside
  the range and real surfaces are inside.
- **Motion.** 2.5D. IN_MV holds our raw `motion.xy` (NDC, current − previous, +y up) and `motion_z`
  unchanged (our viewZ sign is kept, so CAPTURE-FORMAT's first rule applies). `motionVectorScale` =
  (−0.5, +0.5, 1) turns the NDC delta into NRD's UV delta (previous − current, v down). Bias is 0.
  Our motion is the motion of the sampled point between two unjittered projections, which is what
  NRD asks for.
- **Jitter.** `cameraJitter` / `cameraJitterPrev` = the capture's jitter in **pixels**, x right,
  y down. _Provisional:_ the header's range comment suggests pixel units, and a jittered synthetic
  plane scores the same as the unjittered one (within 0.1 dB), but a textured plane is too smooth
  to prove the units. Re-check on a real capture with edges.
- **Normals / roughness.** World normal and our r, through the `NRD.hlsli` normal/roughness pack
  helper (encoding 2 / LINEAR). Sky normals (0,0,0) are replaced with a dummy unit vector.
- **Radiance.** Our demodulated diffuse/specular, as is. NRD's own material demodulation helper is
  not used, because the capture is already demodulated with our Karis 2014 term. Outputs come back
  in the same demodulated space.
- **Hit distance.** Our `*_hitt` in world units. Our 0 ("miss") becomes 65504 (a miss is infinitely
  far; NRD reserves 0 for "lobe not sampled"). REBLUR gets it normalized by the `NRD.hlsli` helper
  with the default hit-distance parameters (3, 0.1, 20), diffuse at roughness 1, specular at r.
  RELAX gets the raw distance. The synthetic captures have no zero hit distances.
- **Shadows (SIGMA).** Visibility is not an input; distance to occluder is. Ours maps as:
  visibility ≥ 0.5 → miss (65504); visibility 0 with `occluder_dist` > 0 → that distance;
  visibility 0 with `occluder_dist` 0 (self-shadowed) → 0. The penumbra pack helper's local-light
  form gets the distance from the reconstructed surface point to the sphere light's centre, and
  light size = 2·radius. Directional lights would use tan(`angularRadius`) and
  `SigmaSettings.lightDirection` (wired up, not exercised yet). Output = shadow from the
  back-end unpack.
- **REFERENCE.** Each signal goes in and comes out as RGBA32F, unchanged.
- **Other common settings.** `timeDeltaBetweenFrames` = 16.67 ms (fixed, so runs don't depend on
  wall clock); `frameIndex` +1 per frame; `CLEAR_AND_RESTART` on `reset` frames, else `CONTINUE`.

### Integration-layer gotchas (cost me time)

- **Don't call `Denoise` several times per frame on one `nrd::Integration`.** Each instance's
  per-frame descriptor pool is sized for one frame's dispatches. Separate calls per denoiser on a
  `CLEAR_AND_RESTART` frame overran it. That crashed with REFERENCE alone, and with all denoisers it
  silently corrupted ~7 % of REFERENCE pixels, which looked like a weighting bug (last-frame PSNR
  24.9 dB instead of 26.5). Fix: one integration per denoiser, or one `Denoise` call with all
  identifiers.
- **The first-frame format check reads `IN_NORMAL_ROUGHNESS`, even for `REFERENCE`.** Put the
  guide textures in every snapshot, or it dereferences an empty slot.

## Smoke-test commands

```
node tools/rt-capture/gen-synthetic.mjs --static-camera --name synthetic-static --out C:\dev\nrd-reference\captures
node tools/rt-capture/gen-synthetic.mjs --name synthetic-plane --out C:\dev\nrd-reference\captures
node tools/rt-capture/validate.mjs C:\dev\nrd-reference\captures\synthetic-static        # VALID (all four)
C:\dev\nrd-reference\harness\_build\Release\nrd-harness.exe --capture C:\dev\nrd-reference\captures\synthetic-static --out C:\dev\nrd-reference\outputs
node tools/rt-capture/compare.mjs C:\dev\nrd-reference\captures\synthetic-static --outputs C:\dev\nrd-reference\outputs
```

Tools ran on Node 24.13.1 (the brief says Node 22; no problems).

## Phases 4–5 on Windows (2026-10-25, second session)

### Our scripts on Windows

| script | result |
|---|---|
| `examples/realtime-denoiser/run-headless.mjs --serve --set=roundtrip` | worked first time. Chrome 156 found in Program Files; headless WebGPU picked the RTX 3060 (Dawn on D3D12; the page reports `nvidia / ampere`), not an integrated GPU; Vite started and stopped; no Chrome or Vite process, temp profile or port 5220 listener left behind. Both captures VALID, 3.19 GB |
| `--set=standard` | 8/8 captures VALID, 10.62 GB, blue-noise sampling, per-frame `lights` |
| `--set=standard --replay=…` (phase 5) | see results |
| `examples/three-temporal/run-realtime.mjs capture` | **broke**: Chrome path hard-coded to macOS and `--use-angle=metal` always passed (spawn ENOENT). Fixed, see below |
| three-temporal pages (`realtime-gi.html`) | **broke**: `denoiser/three` resolves through `packages/denoiser/dist`, which a fresh checkout doesn't have (HTTP 500 from Vite). Needs a library build, see below |

Changes I made (runner scripts only, no denoiser code):

- `examples/three-temporal/run-realtime.mjs`: `openPage` now takes Chrome's path and flags from
  `tools/rt-capture/lib/headless.mjs` (`chromePath()`, `chromeArgs()`: `$CHROME`, platform default,
  `--use-angle=metal` on macOS only, `$CHROME_FLAGS`). It also reads `DevToolsActivePort` with
  CRLF tolerated, and the delayed profile removal retries and can't throw (on Windows the folder
  can stay locked for a moment after the kill).
- Not changed, not needed here: `examples/three-temporal/run-headless.mjs` has the same macOS-only
  Chrome path.
- The fix is not committed in place (this branch only touches `native/`): it is
  [patches/run-realtime-windows.patch](patches/run-realtime-windows.patch), `git apply` from the repo
  root.
- `run-realtime.mjs capture` has two time limits that the documented command doesn't raise:
  `--timeout` (whole run, default 30 min) and `--stepTimeout` (one capture window). On this laptop
  a frame took 50 s to 3 min depending on thermals (Mac: 9–10 s), so the set needs
  `--stepTimeout=10800000 --timeout=36000000`.
- Thermals: the GPU hit 98–100 °C with hardware thermal slowdown and 210 MHz clocks during long runs
  (fixed by elevating the laptop and adding fans: 88 °C, 900 MHz, slowdown off). Timings taken while
  throttled are discarded; see results/PHASE4-5.md "Cost".

Library build on Windows (`yarn build:lib`) fails in `packages/denoiser-realtime`: its `tsc` step
can't find the WebGPU type names (`GPUDevice`, …; 212 errors). Every other package has a
`src/global.d.ts` that references `@webgpu/types`; `denoiser-realtime` has none. I didn't touch
the package. Workaround used: build `denoiser-wgsl`, then `denoiser-realtime` with rollup alone
(`node ../../node_modules/rollup/dist/bin/rollup --config rollup.config.mjs` in the package; rollup's
TypeScript plugin reports the same errors as warnings and emits), then `denoiser-webnn`,
`denoiser-three`, `denoiser` with `yarn workspace <name> run build`. Suggested fix for the owner: add
the same `global.d.ts` to `packages/denoiser-realtime/src`.

My own slip, for the record: launching from a shell whose working directory was `tools/rt-capture`
fails with MODULE_NOT_FOUND; run the commands from the repo root as written.

### Harness additions (C:\dev\nrd-reference\harness, commit 8e90f1a)

- `REBLUR_DIFFUSE_SPECULAR_OCCLUSION` (`--denoisers reblur-occlusion`, folder `nrd-reblur-occlusion`)
  and the separate `REBLUR_DIFFUSE_OCCLUSION` + `REBLUR_SPECULAR_OCCLUSION`
  (`reblur-occlusion-split`). Input: the `*_hitt` buffers through the `NRD.hlsli` normalization
  helper with default hit-distance parameters (our 0 → miss → 65504 → 1). Outputs are written as
  our derived signals `ao` / `so` (1 channel) but stay on **NRD's normalization**, not ours.
- Shadow light per frame: the frame's `lights` (test-bed extras) when present, else the capture's;
  the `shadow: true` entry, else the first. Same order as our replay.
- GPU warm-up before each timed `Denoise`: the same ALU load as our replay (`GpuWarmer`: 16384 ×
  64 threads, 512 FMAs), submitted until 50 ms have passed (`--warm`, default 50).
- Probe switches: `--spec-hitt-scale`, `--roughness`, `--hit-params A,B,C`, `--dump-normhitt`
  (writes the normalized hit distances given to REBLUR as `nrd-pack/<signal>_normhitt`),
  `--jitter-units px|uv|zero`, `--fake-jitter`, `--frames`.
- `tools/gen-probe.mjs`: the P3 probe captures (static camera facing a wall at exact viewZ,
  constant hit distance; our capture format).
- Regression: outputs on `synthetic-static` are bit-identical to the previous build; D3D12 debug
  layer + NRI validation clean.
