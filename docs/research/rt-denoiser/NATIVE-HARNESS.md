# Brief: native NRD harness on Windows (black-box comparison)

For the agent (or person) on the Windows machine with the RTX GPU. You are the
**harness builder** in [RULES.md](RULES.md) rule 4. Read RULES.md first.

## Your role, and what you may and may not do

- You **may** read NRD's public headers (`Include/`), its integration layer
  (`Integration/`), `Shaders/NRD.hlsli` (the pack/unpack helpers), its README, its build
  files and NRI's docs. That's what wiring up the harness needs.
- You **must not** write, review or suggest code for our WGSL denoiser passes in this
  repo, and must not describe NRD internals to anyone who does. Your reports contain
  images, metrics, timings, build facts and API usage only.
- **Nothing from NRD goes into this repo:** no source, headers, binaries, shader blobs,
  harness code that includes NRD helpers, or GPU captures of NRD. The harness lives in its
  own folder outside this repo.

## Setup

Interface facts and the harness steps are in
[sources/nrd-provenance.md](sources/nrd-provenance.md) §3–§5. Pinned snapshot: NRD
`e06852bd545973cb224eb28820b891205cfc1624` (v4.18.0).

```
C:\dev\nrd-reference\            (outside any checkout of this repo)
  NRD\          git clone https://github.com/NVIDIA-RTX/NRD, checkout e06852b
  NRD-Sample\   optional, clone --recursive, only to sanity-check the build
  harness\      our black-box driver (C++), its own git repo, links _NRD_SDK + _NRI_SDK
  captures\     inputs in CAPTURE-FORMAT.md
  outputs\      results in CAPTURE-FORMAT.md "Outputs from a replay"
```

## Phases

1. **Build NRD** with its Windows scripts, D3D12, `-DNRD_NRI=ON`. Pick
   `NRD_NORMAL_ENCODING` / `NRD_ROUGHNESS_ENCODING` that our float captures convert to
   exactly. Optionally build and run NRD-Sample once to confirm the toolchain and GPU.
   Report: versions (CMake, VS, DXC, driver), GPU, anything that failed.
2. **Headless harness** (provenance report §4.3): D3D12 device without a swapchain, NRI
   integration, load a capture in [CAPTURE-FORMAT.md](CAPTURE-FORMAT.md), convert our
   conventions to NRD's (motion sign and units, viewZ, normal/roughness packing, hit
   distance normalization), run per frame with `CLEAR_AND_RESTART` on `reset` frames, unpack,
   and write outputs plus `timings.csv` (GPU timestamps around `Denoise`). Denoisers:
   `REBLUR_DIFFUSE_SPECULAR`, `RELAX_DIFFUSE_SPECULAR`, `SIGMA_SHADOW`, `REFERENCE`, all with
   default settings.
3. **Smoke test before our captures exist:** use this repo's generator (Node 22, no
   dependencies), so both sides read the same bytes:
   `node tools/rt-capture/gen-synthetic.mjs --static-camera --name synthetic-static --out C:\dev\nrd-reference\captures`
   (then the same without `--static-camera`, `--name synthetic-plane`), and check each
   with `node tools/rt-capture/validate.mjs C:\dev\nrd-reference\captures\synthetic-static`.
   It writes a 256×256, 8-frame textured plane with analytic guides (incl. `motion_z`) and
   exact references; `--frames`, `--size`, `--cut N`, `--jitter` vary it. Replay it through
   `REFERENCE` (and the other denoisers), write outputs in CAPTURE-FORMAT's layout, and
   score them with `node tools/rt-capture/compare.mjs <capture dir> --outputs C:\dev\nrd-reference\outputs`.
   Expected for `REFERENCE` on `synthetic-static` (a plain running mean; our
   `accumulate` gives this): last-frame PSNR ≈ 26.5 dB diffuse, 21.5 specular,
   23.6 visibility (noisy input: 16.6 / 12.9 / 14.4). A large miss means a convention
   slipped (motion sign or units, viewZ sign, normal/roughness packing).
4. **Real captures:** the test bed writes captures from Chrome on the Windows machine
   (Node ≥ 22, Chrome installed, `yarn install` once at the repo root). In PowerShell,
   from the repo root:
   ```
   $env:RT_CAPTURE_DIR = "C:\dev\nrd-reference"     # captures\ and outputs\ land here
   node examples/realtime-denoiser/run-headless.mjs --serve --set=standard
   ```
   `--serve` starts the test bed's Vite server (port 5220) and stops it afterwards;
   `--set=standard` writes the standard capture set
   ([examples/realtime-denoiser/CAPTURES.md](../../../examples/realtime-denoiser/CAPTURES.md):
   7 paths at 960×540 + `std1080-orbit`, about 10.6 GB) into `C:\dev\nrd-reference\captures\`
   and runs `tools/rt-capture/validate.mjs` on each (all must say VALID). A smaller set for a
   first try: `--set=roundtrip` (`rt-orbit`, `rt-cut`, 3.2 GB). `CHROME=<path to chrome.exe>`
   if Chrome isn't in Program Files or LocalAppData. Then replay them through native NRD into
   `C:\dev\nrd-reference\outputs\<capture>\<DENOISER>\` (CAPTURE-FORMAT "Outputs from a
   replay"; frame metadata extras such as per-frame `lights` are informational).
   Native denoisers to run on every capture: `REBLUR_DIFFUSE_SPECULAR`, `RELAX_DIFFUSE_SPECULAR`,
   `SIGMA_SHADOW`, and `REBLUR_DIFFUSE_SPECULAR_OCCLUSION` (fed the normalized hit distance from
   the `*_hitt` buffers with its own default parameters; see probe P3 in TASKS before comparing
   its AO with ours).
   **Real-scene captures** (the three.js corner scene, moving camera, per-pose references;
   [examples/three-temporal/CAPTURES.md](../../../examples/three-temporal/CAPTURES.md)): start the
   page server, then write `three-orbit` and `three-pan` (≈ 4.9 GB, ≈ 12 min):
   ```
   $env:RT_CAPTURE_DIR = "C:\dev\nrd-reference"
   node node_modules/vite/bin/vite.js examples/three-temporal --port 5370 --strictPort --host 127.0.0.1
   # second shell, from examples/three-temporal:
   node run-realtime.mjs capture --port=5370 --set=moving --refShadow=1024 --refDiffuse=2048 --refSpec=256 --stepTimeout=3600000
   ```
   Their specular is three.js SSR (not demodulated) and the light is a rectangle passed as an
   equal-area sphere; both are stated in the manifests.
5. **Same-GPU comparison:** replay our WGSL denoisers over the same captures in Chrome on
   the same GPU, into the same `outputs\` tree, then score ours and native together:
   ```
   $env:RT_CAPTURE_DIR = "C:\dev\nrd-reference"
   node examples/realtime-denoiser/run-headless.mjs --serve --set=standard --replay=accumulate,svgf,svgf-auto,recurrent,recurrent-svgfspec,shadows,ffx-shadows,ffx-reflections,occlusion-svgf,occlusion-svgf-auto,occlusion-recurrent
   node tools/rt-capture/compare.mjs std540-orbit       # one capture: every denoiser folder under outputs\std540-orbit\
   ```
   The first command replays each capture through each listed denoiser
   (`outputs\<capture>\<id>\`, with `timings.csv` from WebGPU timestamps after a 50 ms GPU
   warm-up per frame) and runs `compare.mjs` per capture for those ids; the second scores
   every folder of one capture, native ones included (`compare.md` / `compare.json` next to
   them). One replay by hand:
   `node examples/realtime-denoiser/run-headless.mjs --serve "mode=replay&capture=std540-orbit&denoiser=svgf"`
   (the same query with `capture=three-orbit` / `three-pan` replays the real-scene captures).
   For cost tables use the denoisers' solo timings on `std1080-orbit` (the 960×540 captures are
   dominated by fixed overhead).
   _Untested on Windows (written and reviewed on macOS): Chrome discovery, headless WebGPU
   on D3D12, and process cleanup. If headless WebGPU fails, try `CHROME_FLAGS=--enable-features=Vulkan`
   or report the page log the runner prints._

## What comes back

On a branch of your own (suggested `feat/rt-denoiser-native-results`, based on
`feat/rt-denoiser-cleanroom`), touching only `docs/research/rt-denoiser/native/`:

- `native/SETUP.md`: build facts, versions, GPU, encodings chosen, conventions mapping
  (described in words, not code), problems hit.
- `native/results/<capture>/`: metrics tables, `run.json`, `timings.csv`, and a few
  small PNG crops. No raw full-sequence outputs in git; keep those in `outputs\`, and
  say where they are.

## Kickoff prompt for the Windows agent

> Pull the `feat/rt-denoiser-cleanroom` branch of pmndrs/denoiser and read
> `docs/research/rt-denoiser/RULES.md`, then `NATIVE-HARNESS.md`. You're the harness
> builder from rule 4. Do phase 1 and phase 3 (build NRD at the pinned commit in
> `C:\dev\nrd-reference\`, then a headless D3D12 harness that replays a synthetic capture
> in `CAPTURE-FORMAT.md`). Never commit anything from NRD to the repo. Report back on
> branch `feat/rt-denoiser-native-results` in `docs/research/rt-denoiser/native/` only.
