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

## The moving-occluder set (torus knot rotating)

Shadows on static receivers that no motion vector follows: the torus knot rotates at the free-running
pages' rate (0.35/60 rad per frame about its tilted axis, `KNOT_RATE` in `src/realtime/path.ts`) and its
wide, soft shadow sweeps the back wall and the floor. Written for results/M4.md §12 ("Moving shadows").

```sh
node node_modules/vite/bin/vite.js examples/three-temporal --port 5370 --strictPort --host 127.0.0.1
cd examples/three-temporal
node run-realtime.mjs capture --port=5370 --set=knot-static --refShadow=2048 --refDiffuse=2048 --refSpec=256 --stepTimeout=3600000
node run-realtime.mjs capture --port=5370 --set=knot-orbit  --refShadow=2048 --refDiffuse=2048 --refSpec=256 --stepTimeout=3600000
node run-realtime.mjs capture --port=5370 --set=knot-still  --refShadow=2048 --refDiffuse=64 --refSpec=8      # control
```

| capture | path (`?path=`) | frames | why |
|---|---|---|---|
| `three-knot-static` | `knot-static` 0–47 | 48 | static close-up camera (`KNOT_VIEW`) on the knot, its pedestal and its shadow on the wall / floor |
| `three-knot-orbit` | `knot-orbit` 0–39 | 40 | the orbit's camera (slow orbit, ~5–7 px/frame) with the knot rotating; the shadow drifts to the right edge |
| `three-knot-still` | `knot-still` 0–31 | 32 | **control**: knot-static's camera with the knot frozen (static wide penumbrae only). Its diffuse / specular references are low-sample (64 rays / 8 SSR frames): use it for visibility only |

960×540, 2048-ray visibility references (4×4 stratified per frame, per pose), 68.4 MB per frame
(3.3 / 2.7 / 2.2 GB). Frame 0 is a reset. `static: false` on the two rotating captures: the knot's pixels
carry object motion in `motion` / `motion_z` (from its previous pose; the knot material sets a flag in
the scene pass's velocity MRT, `mrtNode`), everything else follows from depth and the camera. `validate.mjs`
passes (history consistency 99.9 % with motion_z; its matrices-only motion check reports the knot's
pixels, as expected for object motion). Reference noise floor of visibility: the reference's own
"boil" (compare.mjs) is 0.005 per frame in static penumbrae; in the knot's wall shadow 0.004.

`?path=knot-static` (or `knot-orbit`, `knot-still`) on `realtime-shadows.html` / `realtime-gi.html`
plays the same paths live.

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

## Bistro and Sponza (third-party scenes, `?scene=sponza|bistro`)

Two real asset scenes on the same realtime pages, so defaults are judged on more than the corner and the test bed
(SPEC §12 item 7). Results: [results/scenes-bistro-sponza.md](../../docs/research/rt-denoiser/results/scenes-bistro-sponza.md).

**The models are not in this repository and must never be committed.** The dev server serves them from a folder
outside git (`scene-assets-plugin.ts`, endpoint `/__scene-assets/*`): `$RT_SCENE_ASSETS`, else
`../vsm/bench/public/assets` next to the repo (Dennis's VSM checkout, where `npm run assets` fetches Sponza and Bistro
is placed by hand). Layout: `sponza/Sponza.gltf` + `sponza/Sponza.bin`, `bistro/bistro-uncompressed.glb`.

| model | source | licence | used as |
|---|---|---|---|
| Sponza | Khronos glTF-Sample-Assets `Models/Sponza` (Crytek Sponza; Frank Meinl after Marko Dabrovic, corrected by Morgan McGuire) | **Cryengine Limited License Agreement** (model files; README / metadata CC-BY-4.0), © 2016 Crytek | geometry only: 262,267 triangles, 25 materials, flat colours by material index, the floor material glossy (roughness 0.18) |
| Bistro (exterior) | Amazon Lumberyard Bistro, NVIDIA ORCA; glTF conversion by Cody Bennett (Blender glTF export) | **CC BY 4.0**, © 2017 Amazon Lumberyard: "Amazon Lumberyard Bistro, Open Research Content Archive (ORCA), Amazon Lumberyard, 2017, http://developer.nvidia.com/orca/amazon-lumberyard-bistro" | modified: geometry only (textures, UVs, tangents dropped), flat colours and roughness from material-name keywords (wet pavement 0.12, glass 0.08), the one BLEND material (a decal) removed, MASK foliage solid: 2,827,910 triangles, 1,532 primitives |

(VSM's NOTICE has the full attributions. The brief's guesses "Crytek Sponza CC BY 3.0" don't apply to this copy: the
Khronos Sponza is under the Cryengine agreement, which is one more reason never to redistribute it.)

Loading (`src/realtime/assets.ts`, a minimal glTF reader: node transforms baked to world space, one merged mesh per
material for raster, one merged geometry of everything static for the BVH) takes ~0.3 s for Bistro's 201 MB GLB on the
M5 Pro; the SAH BVH (`three-mesh-bvh` `MeshBVH`, 4-triangle leaves, prebuilt and handed to `BVHComputeData`) takes ~1.5 s
for Sponza and ~8 s for Bistro. Bistro fits the headless tab without culling (`&cull=x0,y0,z0,x1,y1,z1` keeps a box if
it ever has to: culling to the north street and junction kept 74 % of the triangles and did not speed the rays up).

```sh
# 1. three-temporal dev server (any free port; it serves the capture endpoints and /__scene-assets/)
RT_SCENE_ASSETS=/path/to/assets node node_modules/vite/bin/vite.js examples/three-temporal --port 5410 --strictPort --host 127.0.0.1
#    live: http://127.0.0.1:5410/realtime-gi.html?scene=sponza  (or bistro; &path=<name> plays a scripted path;
#    realtime-shadows.html?scene=... forwards to realtime-gi.html with the shadow view)
# 2. write + validate (48 frames each, 8-frame chunks, one page load per chunk, resumable)
cd examples/three-temporal
node run-realtime.mjs capture --port=5410 --set=sponza-orbit --refShadow=1024 --refDiffuse=2048 --refSpec=256 --chunk=8 --stepTimeout=3600000 --timeout=20000000
node run-realtime.mjs capture --port=5410 --set=sponza-pan   --refShadow=1024 --refDiffuse=2048 --refSpec=256 --chunk=8 --stepTimeout=3600000 --timeout=20000000
node run-realtime.mjs capture --port=5410 --set=sponza-move  --refShadow=1024 --refDiffuse=2048 --refSpec=256 --chunk=8 --stepTimeout=3600000 --timeout=20000000
node run-realtime.mjs capture --port=5410 --set=bistro-orbit --refShadow=1024 --refDiffuse=1024 --refSpec=256 --chunk=8 --stepTimeout=3600000 --timeout=20000000
node run-realtime.mjs capture --port=5410 --set=bistro-pan   --refShadow=1024 --refDiffuse=1024 --refSpec=256 --chunk=8 --stepTimeout=3600000 --timeout=20000000
node run-realtime.mjs capture --port=5410 --set=bistro-move  --refShadow=1024 --refDiffuse=1024 --refSpec=256 --chunk=8 --stepTimeout=3600000 --timeout=20000000
# 3. replay every scene denoiser on the pinned test bed and score (see "Replaying and scoring")
BASE=http://127.0.0.1:5411/ node examples/three-temporal/replay-captures.mjs --preset=scenes --no-score
node examples/three-temporal/score-captures.mjs sponza-orbit sponza-pan sponza-move bistro-orbit bistro-pan bistro-move --json scenes.json
for c in sponza-orbit sponza-pan sponza-move bistro-orbit bistro-pan bistro-move; do node tools/rt-capture/compare.mjs $c --quiet; done
```

| capture | path (`src/realtime/scenes.ts`) | frames | shadow light | why |
|---|---|---|---|---|
| `sponza-orbit` | `sponza-orbit` 0–47 | 48 | sun | interior arc in the nave around its centre, dollying in (~4–7 px/frame): sun strip on the floor, columns, arches, curtains |
| `sponza-pan` | `sponza-pan` 0–47 | 48 | sun | 8 frames of drift down the nave, then 6 cm/frame slide + 2°/frame yaw toward the south arcade: disocclusion behind the columns every frame |
| `sponza-move` | `sponza-move` 0–47 | 48 | sun | **moving occluder**: static camera on the sunlit nave floor; a torus knot (R 0.45 m) swings 1.6 m along X and spins in the sun shaft; its pixels carry object motion (`static: false`), its shadow sweeps static receivers |
| `bistro-orbit` | `bistro-orbit` 0–47 | 48 | sun | street orbit: walking 5 cm/frame down the north street keeping one point in view; façade shadow edges on the street and walls, bollards, signs |
| `bistro-pan` | `bistro-pan` 0–47 | 48 | sun | 8 frames of drift at the junction, then 4–6 cm/frame slide + 2.2°/frame yaw across the café terrace (chairs, tables: thin geometry) |
| `bistro-move` | `bistro-move` 0–47 | 48 | local | **moving light**: static camera in the north street; the shadow light is a lantern (sphere, r 0.12 m) moving 7 cm/frame along the street (per-frame `lights`), so every shadow it casts moves over static receivers; the sun stays in the bounce |

960×540, 33 floats per pixel as the corner captures (68.4 MB per frame, **3.28 GB per capture, 19.7 GB for the six**).
Wall time on the M5 Pro with other agents' GPU jobs running: Sponza ~26 min, Bistro ~36–40 min per capture (wrap the
batch in `caffeinate -s -i -w <pid>`: an idle Mac sleeps between dark wakes and the batch crawls, LESSONS).
All six pass `validate.mjs` (motion reprojection ≤ 0.003 px on the five static-scene captures, the knot's pixels carry
object motion on `sponza-move`; history consistency 95.5–100 %).
Frame 0 of each is a reset; chunks join without resets (each chunk's first frame takes its motion from the previous
path frame, and its reference seeds start at path frame × 4000).

### How these frames differ from the corner's

- Lights (`src/realtime/scenes.ts`): a **sun** (directional, angular radius 0.02 rad, 4.3× the real sun so penumbrae
  are a few to tens of pixels wide) and one **local sphere light** (Sponza: a warm lamp in the south aisle, r 0.15 m;
  Bistro: a street lantern, r 0.12 m). Sponza's sun is high over the nave (62°, the sky reaches the floor only through
  the roof opening); Bistro's comes down the north street at 45° (late afternoon, warm). `lights[0]` is the path's
  shadow light (`directional` with `direction` toward the light and `angularRadius`, or `sphere`); the other light is
  `lights[1]` (informational). Every frame carries its `lights` (they move on `bistro-move`).
- `visibility`: 1 ray to a blue-noise point on the shadow light (sun: uniform over its disk of directions; sphere:
  uniform over its disk facing the receiver). Reference: 2×2 stratified white-noise rays per frame × 256 frames (1024).
- `diffuse`: 1 cosine ray; a miss sees the sky (a gradient with a sun glow, × 0.6 Sponza / 0.5 Bistro); a hit returns
  sun + local light bounced off a grey 0.5 surface, the **sun with one hard shadow ray at the hit point**, the local
  light unshadowed there (`&bounceLocalShadow=1` adds its ray; ~25 % more reference time, not used). One bounce, no
  sky light at the hit. This GI is "what was feasible": the sun shadow ray keeps the bounce from leaking sunlight
  through Sponza's roof and Bistro's façades, which is what makes these signals heavy-tailed (Sponza's noisy diffuse
  peaks at ~5 against a mean of 0.21). Reference: **2048 rays on Sponza, 1024 on Bistro** (4 per frame; Bistro's rays
  cost ~2.4× Sponza's: 2048 would have been ~80 s per frame, over 3 h for the three captures), AO (`ao_ref`) from the
  same rays.
- Reference rays per rendered frame are kept small (4 diffuse, 2×2 visibility; the corner uses 16 and 4×4): with 16 +
  16 per frame one frame was ~0.5 s of GPU work here, and under other agents' GPU load the capture page lost its device
  or was reloaded every few poses. Chunks of 8 frames per page load (`--chunk=8`, retried by a watchdog) are the second
  guard.
- `specular`: three's stochastic SSR (maxDistance 12 / 20 m, thickness 0.15 / 0.25), reference = 256 SSR frames lit by
  the converged references, exactly as on the corner (same caveat: SSR's own expectation, not demodulated).
- While a pose is held for its references the 1-ray signals (already read back) skip their rays, ~20 % of a frame.
- Missing as on the corner: jitter, `so_ref`, a demodulated / traced specular. New: textures are dropped, so the
  `albedo` guide is flat per material.
