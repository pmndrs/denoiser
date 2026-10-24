# rt-capture

Capture I/O for the real-time denoiser work: write, check, replay and score captures in
[CAPTURE-FORMAT v0](../../docs/research/rt-denoiser/CAPTURE-FORMAT.md). Captures and
outputs live in `captures/` and `outputs/` here (gitignored; `RT_CAPTURE_DIR` moves both).
Never commit raw captures.

```sh
# from the repo root
node tools/rt-capture/gen-synthetic.mjs                    # captures/synthetic-plane (256², 8 frames)
node tools/rt-capture/validate.mjs synthetic-plane         # files, ranges, reprojection consistency
node node_modules/vite/bin/vite.js tools/rt-capture --port 5230 --strictPort --host 127.0.0.1 &
node tools/rt-capture/run-headless.mjs "capture=synthetic-plane&denoiser=accumulate"
node tools/rt-capture/compare.mjs synthetic-plane          # table -> outputs/synthetic-plane/compare.md
node tools/rt-capture/preview.mjs synthetic-plane --strip specular --frame 7   # PNG strip in previews/
pkill -f "port 5230"
```

| file | what |
|---|---|
| `gen-synthetic.mjs` | analytic textured plane under a moving camera; exact guides and references. `--frames`, `--size`/`--w --h`, `--cut N`, `--jitter`, `--static-camera`, `--break <mistake>` |
| `validate.mjs` | manifest vs files, finiteness, ranges, viewz sign, unit normals, depth↔viewz, motion and motion_z vs reprojection, camera continuity, history consistency. Exit 1 on errors |
| `compare.mjs` | scores `outputs/<capture>/<denoiser>/` (ours or native, `--outputs <root>`) with the CAPTURE-FORMAT metrics |
| `preview.mjs` | PNG (and `--pfm`) of any buffer, or a noisy \| outputs \| reference strip |
| `run-headless.mjs` | the replay page in headless Chrome, one run per query string |
| `index.html`, `src/main.ts` | replay page: `?capture=<name>&denoiser=<id>[&signals=a,b][&frames=N][&output=<folder>][&<setting>=v]` |
| `src/vite-plugin.ts` | `rtCapture()`: dev-server endpoints that write/serve `captures/` and `outputs/` |
| `src/writer.ts` | `CaptureWriter`: GPU textures → f32 → dev server (for the test bed's exporter) |
| `src/replay.ts` | `replay()`, `CaptureTextures`, `loadManifest()`: run any denoiser over a capture |
| `src/denoisers.ts` | registry: `passthrough`, `accumulate`, `accumulate-static`, `ffx-shadows`, `ffx-reflections`; `registerDenoiser()`, `perSignal()` |
| `src/accumulate.ts` | reference accumulation (our analogue of native `REFERENCE`) |
| `src/gpu-readback.ts` | `readTextures()`: any float/depth texture → packed f32 |
| `lib/capture.mjs` | Node helpers: manifest/f32 I/O, mat4, pixel↔NDC, metrics |

Using it from another app (e.g. `examples/realtime-denoiser`): add
`rtCapture()` from `../../tools/rt-capture/src/vite-plugin` to its Vite plugins (with
`server.fs.allow: ['../..']`), then import `CaptureWriter` / `replay` / `DENOISERS` from
`../../tools/rt-capture/src/*`. Files still land in `tools/rt-capture/captures|outputs`.
