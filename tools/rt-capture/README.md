# rt-capture

Capture I/O for the real-time denoiser work: write, check, replay and score captures in
[CAPTURE-FORMAT v0](../../docs/research/rt-denoiser/CAPTURE-FORMAT.md). Captures and
outputs live in `captures/` and `outputs/` here (gitignored; `RT_CAPTURE_DIR` moves both).
Never commit raw captures.

```sh
# from the repo root
node tools/rt-capture/gen-synthetic.mjs                    # captures/synthetic-plane (256², 8 frames)
node tools/rt-capture/validate.mjs synthetic-plane         # files, ranges, reprojection consistency
node tools/rt-capture/run-headless.mjs --serve "capture=synthetic-plane&denoiser=accumulate"   # --serve starts/stops Vite on :5230
node tools/rt-capture/compare.mjs synthetic-plane          # table -> outputs/synthetic-plane/compare.md
node tools/rt-capture/preview.mjs synthetic-plane --strip specular --frame 7   # PNG strip in previews/
```

Real captures come from the test bed: `node examples/realtime-denoiser/run-headless.mjs --serve --set=standard`
([examples/realtime-denoiser/CAPTURES.md](../../examples/realtime-denoiser/CAPTURES.md)).
The runners work on macOS, Windows and Linux (`lib/headless.mjs`; `CHROME=` overrides the
Chrome path, `CHROME_FLAGS=` adds flags).

| file | what |
|---|---|
| `gen-synthetic.mjs` | analytic textured plane under a moving camera; exact guides and references. `--frames`, `--size`/`--w --h`, `--cut N`, `--jitter`, `--static-camera`, `--break <mistake>` |
| `validate.mjs` | manifest vs files, finiteness, ranges, viewz sign, unit normals, depth↔viewz, motion and motion_z vs reprojection, camera continuity, history consistency. Exit 1 on errors |
| `compare.mjs` | scores `outputs/<capture>/<denoiser>/` (ours or native, `--outputs <root>`) with the CAPTURE-FORMAT metrics |
| `preview.mjs` | PNG (and `--pfm`) of any buffer, or a noisy \| outputs \| reference strip |
| `run-headless.mjs` | the replay page in headless Chrome, one run per query string (`--serve`, `--json=`) |
| `lib/headless.mjs` | cross-platform headless Chrome over CDP + optional Vite start (shared with the test bed's runner) |
| `index.html`, `src/main.ts` | replay page: `?capture=<name>&denoiser=<id>[&signals=a,b][&frames=N][&output=<folder>][&warm=<ms>][&<setting>=v]` |
| `src/run.ts` | `replayFromQuery()`: the page's URL handling, shared with the test bed's `?mode=replay` |
| `src/vite-plugin.ts` | `rtCapture()`: dev-server endpoints that write/serve `captures/` and `outputs/` |
| `src/writer.ts` | `CaptureWriter`: GPU textures → f32 → dev server (for the test bed's exporter) |
| `src/replay.ts` | `replay()`, `CaptureTextures`, `loadManifest()`: run any denoiser over a capture; 50 ms GPU warm-up before each timed dispatch (`warmMs`, `&warm=`; without it an idle GPU clocks down and timestamps read 4-9x high) |
| `src/denoisers.ts` | **the project's one denoiser registry** (the test bed runs it too): `passthrough`, `accumulate`, `accumulate-static`, `accumulate-32`, `accumulate-8`, `ffx-shadows`, `ffx-reflections`, `svgf`, `svgf-auto`, `svgf-diffuse`, `svgf-specular`; `registerDenoiser()`, `perSignal()`, `svgfOptions()` |
| `src/oidn-entries.ts` | **offline** entries `oidn` (quality `high`) and `oidn-default` (the Denoiser's default `fast`): OIDN 2 single-frame baseline (SPEC §13, E-2) on diffuse / specular / visibility / ao. Async, so they implement `ReplayDenoiser.dispatchAsync` and are registered by the replay page only (`src/main.ts`), not the test bed. Settings `oidn.quality`, `oidn.precision`, `oidn.aux=one\|albedo\|none`, `oidn.scalar=hdr\|ldr`, `oidn.ae=0`; the model each signal ran lands in run.json `denoiserInfo` |
| `src/accumulate.ts` | reference accumulation (our analogue of native `REFERENCE`) |
| `src/accumulate-ema.ts` | capped accumulation with the 2.5D depth test (the test bed's baseline, `accumulate-32` / `-8`) |
| `src/gpu-readback.ts` | `readTextures()`: any float/depth texture → packed f32 |
| `lib/capture.mjs` | Node helpers: manifest/f32 I/O, mat4, pixel↔NDC, metrics |

Using it from another app (as `examples/realtime-denoiser` does): add
`rtCapture()` from `../../tools/rt-capture/src/vite-plugin` to its Vite plugins (with
`server.fs.allow: ['../..']`), then import `CaptureWriter` / `replay` / `DENOISERS` from
`../../tools/rt-capture/src/*`. Files still land in `tools/rt-capture/captures|outputs`
(or `$RT_CAPTURE_DIR`).

`CaptureWriter.writeFrame({ ..., extra })` adds per-frame manifest keys (the test bed writes
`pathFrame`, per-frame `lights` and the moving `object`); v0 readers ignore them, and
`ReplayFrame.meta` hands the frame entry (with extras) to denoisers.

**Offline (async) denoisers.** A `ReplayDenoiser` may implement `dispatchAsync(frame): Promise<outputs>`;
`replay()` then awaits it instead of calling `dispatch()` before the readback (entries with it set
`offline: true`, which also defaults the GPU warm-up to 0, and make `dispatch()` throw, since the
test bed's live loop is synchronous). Synchronous entries are untouched (byte-identical outputs).
An optional `info()` adds `denoiserInfo` to run.json.

**Dev-server environment** (`vite.config.ts`): `RT_REALTIME_SRC=<dir>` pins denoiser/realtime to a frozen
`src/` copy (as the test bed's config), `RT_NO_HMR=1` turns HMR off for long headless batches, and
`/tzas/*` serves the OIDN weights from `packages/denoiser/tzas`.
