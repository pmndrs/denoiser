# Trying the subgroup-matrix kernel in your browser

The WGSL runtime (`denoiser/wgsl`) has two kernels for the OIDN network's convolutions:

- the **portable kernel**, plain WGSL vec4 math, which every WebGPU browser runs;
- the **matrix kernel**, which runs each conv as small matrix multiplies on Chrome's
  experimental `chromium-experimental-subgroup-matrix` feature (Metal `simdgroup_matrix`
  on Apple GPUs).

## What changes for users

Nothing, unless the browser exposes the feature. It is behind a flag today, so a default
Chrome, Safari or Firefox gets the portable kernel and the same output as before.

When the feature is exposed, the default (`subgroupMatrix: 'auto'`) uses the matrix kernel
for **fp32** models only, on the layers where it is faster. The output matches the portable
kernel to within 1.3e-6 (max |Δ|). fp16 models keep the portable kernel: on Apple it is faster than every
matrix variant, and Apple's f16 matrices sum in f16, which gives about 3x the error.
Everything else is opt-in: `subgroupMatrix: true | false | string[]`,
`subgroupMatrixType`, `subgroupMatrixShape` and `mmaTiling`.

Measured on an M5 Pro (best-effort, under load), fp32, network only:

| | portable | matrix |
|---|---|---|
| 1280x720 | 22.0 ms | 15.9 ms |
| 1920x1088 | 48.4 ms | 36.3 ms |

The full tables and tolerances are in
[docs/specs/runtimes.md](../specs/runtimes.md#subgroup-matrices-v2-2026-11-18-branch-featwgsl-sgm-v2).

## Turning it on (macOS, Chrome)

1. Open `chrome://flags/#enable-unsafe-webgpu`, set **Unsafe WebGPU Support** to
   Enabled, and relaunch. Alternatively, start Chrome from a terminal:

   ```bash
   open -a "Google Chrome" --args --enable-unsafe-webgpu
   ```

   Quit Chrome fully first: `--args` is ignored when Chrome is already running.
   This was checked on Chrome 157. The flag turns on every unsafe WebGPU API, so use a
   separate Chrome profile or Canary for it rather than your everyday browser.
2. Check it in the DevTools console of any https or localhost page:

   ```js
   (await navigator.gpu.requestAdapter()).features.has('chromium-experimental-subgroup-matrix')
   ```

## Trying it in Pipeline Lab

```bash
yarn workspace pipeline-lab dev
```

Then open http://localhost:5230 in the Chrome from step 1.

- Under **2 · Denoiser**, the **precision** (fp32 / fp16) and **matrix kernel**
  (auto / on / off) selects switch kernels. Both reload the page, because they are fixed
  when the denoiser is created.
- The line under them says whether this browser exposes subgroup matrices, and after the
  first denoise, which kernel ran on how many layers, for example
  `matrix 14/16 layers (8x8x8 f32->f32)`.
- **Compare kernels** times WGSL fp32/fp16 × matrix off/on back to back, and labels each
  benchmark row with its precision and kernel.

## Windows

Chrome on Windows runs WebGPU on D3D12, which has no subgroup matrices, with or without
the flag. Windows users get the portable kernel. NVIDIA's tensor cores are reachable only
outside the browser, through dawn.node on Vulkan. The steps for that run on the RTX 3060
are in [docs/specs/runtimes.md](../specs/runtimes.md#subgroup-matrices-on-windows-dawnnode-rtx-3060-a-windows-task).
