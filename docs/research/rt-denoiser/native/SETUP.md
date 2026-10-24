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

## Not done yet

- Phase 4 (real captures from the test bed) waits for T0.6. Phase 5 (our WGSL in Chrome on this
  GPU) waits for our denoisers.
- `SIGMA` with a directional light, and `REBLUR`/`RELAX` with probabilistic lobe selection (hit
  distance 0 = not sampled), are untested: the synthetic captures don't contain them.
