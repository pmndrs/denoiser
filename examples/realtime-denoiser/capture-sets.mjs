// Named capture sets for run-headless.mjs --set=<name> (CAPTURES.md explains the choice).
// Each entry is one test-bed capture: path window, size, signals; written to
// <RT_CAPTURE_DIR or tools/rt-capture>/captures/<name>/.
//
// Size per frame (f32, every buffer of all three signals + references = 32 floats/pixel):
//   960x540 -> 66.4 MB, 1920x1080 -> 265.4 MB.

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
