# Real-scene captures (three-temporal, moving camera)

The furnished corner of the realtime pages (three r186, 20,862 triangles, one 1.62 × 1.2 m area
light, 1-ray signals traced with three-mesh-bvh) on a scripted camera path, written as
[CAPTURE-FORMAT v0](../../docs/research/rt-denoiser/CAPTURE-FORMAT.md) captures with a converged
reference **per pose**. Every registry denoiser (`tools/rt-capture/src/denoisers.ts`) can replay
them, and the Windows harness can run native NRD on a real scene with them. This is the second
scoring scene of SPEC §12 item 7; the numbers are in
[results/M6-real-scene.md](../../docs/research/rt-denoiser/results/M6-real-scene.md) ("Moving camera").
Captures are raw f32 and big; they live in `tools/rt-capture/captures/` (or
`$RT_CAPTURE_DIR/captures/`), which is gitignored. Never commit them.

## The moving-camera set

```sh
# 1. three-temporal dev server (any free port; it serves the capture endpoints too)
node node_modules/vite/bin/vite.js examples/three-temporal --port 5370 --strictPort --host 127.0.0.1
# 2. write + validate the set (about 12 min on an M5 Pro, 9–10 s per frame)
cd examples/three-temporal
node run-realtime.mjs capture --port=5370 --set=moving --refShadow=1024 --refDiffuse=2048 --refSpec=256 --stepTimeout=3600000
```

| capture | path frames | size | frames | why |
|---|---|---|---|---|
| `three-orbit` | 0–39 | 960×540 | 40 | slow orbit around the wide shot, dollying in (~5–7 px/frame) |
| `three-pan` | 32–63 | 960×540 | 32 | 8 frames of orbit, then the fast pan from local frame 8: 6 cm/frame slide + 1.6°/frame yaw, disocclusion behind the table and chair legs and off-screen reveals every frame |

Frame 0 of each capture is a reset. 33 floats per pixel: **68.4 MB per frame**, 2.74 GB for
`three-orbit`, 2.19 GB for `three-pan` (4.9 GB together).

The path is `src/realtime/path.ts` (a pure function of the path frame); `?path=orbit` on either
realtime page plays it live, `node run-realtime.mjs path --page=realtime-gi` takes screenshots
along it.

### How a frame is made

`realtime-gi.html?path=orbit&ref=1` builds the capture graph; `__t.capturePath()` then, per path frame:

1. puts the camera at the path pose; the previous **path** pose gives `motion` / `motion_z`
   (computed from depth and the two poses, so the reference frames in between don't disturb them);
2. renders the guides and the 1-ray signals with blue-noise index = path frame;
3. holds the pose and accumulates the references: visibility 4×4 stratified white-noise rays per
   frame (1024 rays), diffuse 16 white-noise cosine rays per frame (2048 rays; AO from the same rays);
4. points SSR at the image lit by the converged diffuse + visibility references, renders one frame
   for the noisy SSR sample, then accumulates 256 SSR frames as the specular reference.

### What a capture contains (and what it doesn't)

- Guides: `depth`, `viewz`, `normal` (world), `roughness`, `motion`, `motion_z`, `albedo`, `f0`.
  No jitter, `reversedDepth: false`, near 0.05, far 30, `static: true` (the torus knot is frozen on
  the path).
- `diffuse`, `diffuse_hitt`, `diffuse_ref`: one cosine ray; a miss sees the environment (× 0.28), a
  hit returns the panel's irradiance bounced off a grey 0.5 surface (no secondary shadow ray). The
  signal is never multiplied by albedo (`demodulation.diffuse: "albedo"`).
- `visibility`, `occluder_dist`, `visibility_ref`: one ray to a blue-noise point on the panel.
  `lights[0]` is the **sphere of equal area** at the panel's centre (what `ShadowDenoiser` gets on the
  pages); the rectangle is in the manifest's `threeTemporal.light`.
- `specular`, `specular_hitt`, `specular_ref`: three's stochastic SSR. **Not demodulated** (SSR
  output carries its GGX sample weight; `demodulation.specular: "none"`, so validate.mjs warns). The
  reference is SSR's own expectation (its misses and biases are in the reference too).
  `specular_hitt` is SSR's ray length (× three's specular dominant factor); environment misses → 0.
- `ao_ref` (extra buffer, 1 channel; validate.mjs warns "unknown buffer", v0 readers ignore it): the
  mean per-sample normalized hit distance h / (h + 1 + 0.05·(−viewz)), miss = 1, of the diffuse
  reference rays (`OcclusionDenoiser`'s default curve). compare.mjs doesn't score AO;
  `score-captures.mjs` does.
- Missing: object motion, jitter, an SO reference (SSR misses are environment hits), a true
  (non-SSR) specular reference, a demodulated specular signal.
- Reference noise floor (variance of the reference mean, from the 1-ray noisy PSNR): diffuse ≈
  50 dB, AO ≈ 46 dB, visibility > 46 dB (stratified), specular ≈ 59–60 dB. Every denoiser scored so far is ≥ 4 dB below its floor.

`validate.mjs` passes on both captures (motion reprojection < 0.001 px, history consistency 98.8–99.0 %);
its only warnings are the two above.

## Replaying and scoring

```sh
# test bed dev server, denoiser/realtime pinned to a frozen copy (LESSONS)
git archive HEAD packages/denoiser-realtime/src packages/denoiser-core/src | tar -x -C /tmp/pin
RT_REALTIME_SRC=/tmp/pin/packages/denoiser-realtime/src node node_modules/vite/bin/vite.js examples/realtime-denoiser --port 5371 --strictPort --host 127.0.0.1
# every default denoiser over both captures, then score (pooled PSNR, penumbra, FLIP, flicker, AO)
BASE=http://127.0.0.1:5371/ node examples/three-temporal/replay-captures.mjs --json=moving.json
# one replay / one score by hand
BASE=http://127.0.0.1:5371/ node examples/realtime-denoiser/run-headless.mjs "mode=replay&capture=three-pan&denoiser=shadows"
node examples/three-temporal/score-captures.mjs three-pan
node tools/rt-capture/compare.mjs three-pan        # the standard table (no AO, no FLIP)
```

Occlusion entries replay with `&signals=ao` (`so` has no reference here).
