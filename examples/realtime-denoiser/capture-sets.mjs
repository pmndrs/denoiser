// Named capture sets for run-headless.mjs --set=<name> (CAPTURES.md explains the choice).
// Each entry is one test-bed capture: path window, size, signals; written to
// <RT_CAPTURE_DIR or tools/rt-capture>/captures/<name>/.
//
// Size per frame (f32, every buffer of all three signals + references = 32 floats/pixel):
//   960x540 -> 66.4 MB, 1920x1080 -> 265.4 MB. v1 (960x540): sh-diffuse + sh-specular 50 floats = 103.7 MB,
//   sh-diffuse 34 = 70.5 MB, shadow-rgb 28 = 58.1 MB.

const std540 = (path, start, frames) => ({ name: `std540-${path}`, path, start, frames, w: 960, h: 540 });

export const CAPTURE_SETS = {
  // M1-M4 comparisons (ours vs native NRD, same frames): 128 frames at 960x540 + 8 at 1080p
  // = 10.6 GB (9.9 GiB). Windows put the path's event a few frames in, after some history.
  standard: [
    std540('orbit', 0, 16),   // easy case, steady reprojection
    std540('pan', 0, 16),     // disocclusion every frame
    std540('light', 40, 24),  // light flips side at path frame 48 = local 8 (anti-lag)
    std540('thin', 0, 16),    // fence slats, thin shadows
    std540('glossy', 0, 16),  // low over the glossy floor (specular)
    std540('cut', 40, 24),    // camera cut at path frame 48 = local 8 (reset)
    std540('object', 0, 16),  // moving sphere: object motion, motion_z, moving shadow
    { name: 'std1080-orbit', path: 'orbit', start: 0, frames: 8, w: 1920, h: 1080 }, // full-res quality + timings
  ],
  // CAPTURE-FORMAT v1 (testbed-v1, SPEC v0.3 M7-13 / M8-10; CAPTURES.md "v1 captures"): only the buffers of the
  // v1 signals each one needs, 960x540, 256-spp references (8.6 GB). Version 1 manifests.
  v1: [
    { name: 'v1-bumpy', path: 'bumpy', start: 0, frames: 32, w: 960, h: 540, signals: 'sh-diffuse,sh-specular' },   // M7: bump detail, glossy bumpy floor
    { name: 'v1-bounce', path: 'bounce', start: 0, frames: 16, w: 960, h: 540, signals: 'sh-diffuse' },              // M7: coloured bounce (YCoCg vs RGB)
    { name: 'v1-glass', path: 'glass', start: 0, frames: 16, w: 960, h: 540, signals: 'shadow-rgb' },                // M8: static coloured shadow, orbit
    { name: 'v1-glass-moving', path: 'glass-moving', start: 0, frames: 40, w: 960, h: 540, signals: 'shadow-rgb' },  // M8: moving panel, static camera
    { name: 'v1-glass-still', path: 'glass-still', start: 0, frames: 16, w: 960, h: 540, signals: 'shadow-rgb' },    // M8: frozen control (boil)
  ],
  // Shadow motion separation (results/SHADOWS-MOTION.md): camera / light / occluder motion and a frozen control
  // under a hard local light and a wide sun, each with move / hold / reverse / hold (paths sm-*, 80 frames),
  // shadows only (visibility + occluder distance + guides), 960x540.
  'shadow-motion': ['hard', 'sun'].flatMap((l) => ['camera', 'light', 'object', 'frozen'].map((mo) => (
    { name: `sm-${l}-${mo}`, path: `sm-${l}-${mo}`, start: 0, frames: 80, w: 960, h: 540, signals: 'shadows' }))),
  // Reflection motion (results/REFLECTION-MOTION.md, CAPTURES.md "Reflection-motion captures"): reflect build, specular only
  // (guides + specular + hit distance + reference: 22 floats = 45.6 MB / frame), frames 0-47 = 40 moving + 7 held, 13.1 GB.
  // The marker images' oracle positions come from the path (src/reflect-oracle.ts), not from the capture.
  reflect: ['rm-cam-plane', 'rm-obj-plane', 'rm-refl-turn', 'rm-cam-convex', 'rm-cam-concave', 'rm-cam-plane-r10'].map((p) => (
    { name: p.replace('rm-', 'rm540-'), path: p, start: 0, frames: 48, w: 960, h: 540, signals: 'specular', refspp: p.endsWith('r10') ? 1024 : 256 })),
  // Light changes (review target 3, results/T3-light-changes.md; paths src/paths-light.ts): fixed camera and geometry,
  // onset at frame 24, return at 56, 96 frames, 960x540. lc-step / lc-hue / lc-fade / lc-jump: all three signals, 256-spp
  // references (6.4 GB each); lc-emitter (reflect build): diffuse + specular, 4096-spp references (the emitter is small).
  'light-change': [
    ...['lc-step', 'lc-hue', 'lc-fade', 'lc-jump'].map((p) => ({ name: p.replace('lc-', 'lc540-'), path: p, start: 0, frames: 96, w: 960, h: 540 })),
    { name: 'lc540-emitter', path: 'lc-emitter', start: 0, frames: 96, w: 960, h: 540, signals: 'diffuse,specular', refspp: 4096 },
  ],
  // Normal detail (review target 5, results/T5-normal-detail.md; paths src/paths-detail.ts, detail build): sh-diffuse +
  // sh-specular with 4096-spp references, 960x540. Orbit: bumpy's slow orbit with the M7 detail normals, a smooth control
  // and two held-out patterns, plus `bounce`; light: a broad emitter sweeping over the same surfaces (frames 16..47), then
  // a hold. 103.7 MB / frame, 64 / 80 frames: 58 GB.
  t5: [
    ...['dt-bumpy', 'dt-smooth', 'dt-grooves', 'dt-fine', 'bounce'].map((p) => (
      { name: `t5-${p.replace('dt-', '')}`, path: p, start: 0, frames: 64, w: 960, h: 540, signals: 'sh-diffuse,sh-specular', refspp: 4096 })),
    ...['dt-light', 'dt-light-smooth', 'dt-light-grooves'].map((p) => (
      { name: `t5-${p.replace('dt-', '')}`, path: p, start: 0, frames: 80, w: 960, h: 540, signals: 'sh-diffuse,sh-specular', refspp: 4096 })),
  ],
  // T0.7 round trip (small): orbit + cut across its reset
  roundtrip: [
    { name: 'rt-orbit', path: 'orbit', start: 0, frames: 24, w: 960, h: 540 },
    { name: 'rt-cut', path: 'cut', start: 36, frames: 24, w: 960, h: 540 },
  ],
};

/** Query string of one capture entry (signals default to all, references 256 spp). */
export const captureQuery = (c) =>
  `mode=capture&name=${c.name}&path=${c.path}&start=${c.start}&frames=${c.frames}&w=${c.w}&h=${c.h}` +
  `&signal=${c.signals ?? 'all'}&refspp=${c.refspp ?? 256}${c.extra ? `&${c.extra}` : ''}`;

/** The live eval that renders exactly the frames of capture entry `c` (for round-trip checks). */
export const evalQuery = (c, denoisers) =>
  `mode=eval&path=${c.path}&start=${c.start}&frames=${c.frames}&w=${c.w}&h=${c.h}` +
  `&signal=${c.signals ?? 'all'}&refspp=${c.refspp ?? 256}&flip=0&denoiser=${denoisers}`;
