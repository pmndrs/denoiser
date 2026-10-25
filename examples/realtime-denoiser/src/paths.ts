// Scripted, deterministic stress paths. Each path is a pure function of the frame
// index (no wall clock), so every run of a path sees exactly the same frames.
// A frame state = camera (eye, target), the sphere light, and the movable sphere.
// `resets` are camera cuts: history must be dropped there (CAPTURE-FORMAT `reset`).
// The v1 paths (testbed-v1, SPEC v0.3 M7-13 / M8-10) use other scene builds (scene.ts sceneWgsl):
// bumpy / bounce ('bumpy': normal-mapped floor and wall, red / green corridor) and glass /
// glass-moving / glass-still ('glass': translucent panels casting a coloured shadow).
import type { V3 } from './camera';
import type { SceneKind } from './scene';

export interface LightState { pos: V3; radius: number; radiance: V3 }
/** glass build: panel 1's pose (centre, rotation about +y in radians) */
export interface GlassState { pos: V3; angle: number }
export interface FrameState { eye: V3; target: V3; light: LightState; obj: V3; glass?: GlassState }
export interface PathDef {
  id: string;
  label: string;
  /** what the path stresses */
  about: string;
  /** scene build (default 'standard') */
  scene?: SceneKind;
  frames: number;
  /** frames where history must be reset (frame 0 always resets) */
  resets: number[];
  at(f: number): FrameState;
}

export const PATH_FRAMES = 96;
const HALF = PATH_FRAMES / 2;

// Default sphere light. Power is kept when the radius changes (radiance ~ 1/r^2),
// normalized to examples/ffx-denoiser's light (radius 1.2, radiance (18, 16.5, 14)).
const LIGHT_RADIUS = 0.9;
const light = (pos: V3, radius = LIGHT_RADIUS): LightState => {
  const k = (1.2 / radius) ** 2;
  return { pos, radius, radiance: [18 * k, 16.5 * k, 14 * k] };
};
const DEFAULT_LIGHT = light([4, 7, 3]);
// the movable sphere's parking spot (static in every path but `object`)
const PARKED: V3 = [1.7, 0.45, 1.1];
export const OBJ_RADIUS = 0.45;

const state = (eye: V3, target: V3, l = DEFAULT_LIGHT, obj = PARKED): FrameState => ({ eye, target, light: l, obj });

// glass paths: a smaller light (sharper coloured penumbrae), panel 1 near (-0.8, 1.2, 5.6) over open floor
const GLASS_LIGHT = light([4, 7, 3], 0.35);
const GLASS_BASE: V3 = [-0.8, 1.2, 5.6];
/** glass-moving's panel pose: slides (x, z) and turns about y, one period over the path */
const glassPose = (f: number): GlassState => {
  const w = (2 * Math.PI * f) / PATH_FRAMES;
  return { pos: [GLASS_BASE[0] + 0.6 * Math.sin(w), GLASS_BASE[1], GLASS_BASE[2] + 0.35 * Math.sin(2 * w)], angle: 0.5 * Math.sin(w) };
};
const GLASS_EYE: V3 = [-1.4, 3.0, 9.2];
const GLASS_TARGET: V3 = [-1.75, 0.0, 6.2];
const glassState = (eye: V3, target: V3, glass: GlassState): FrameState => ({ eye, target, light: GLASS_LIGHT, obj: PARKED, glass });

export const PATHS: PathDef[] = [
  {
    id: 'orbit', label: 'slow orbit', frames: PATH_FRAMES, resets: [],
    about: 'slow orbit + dolly around the scene: the easy case, steady reprojection',
    at: (f) => {
      const a = 0.35 + f * 0.006, r = 9.0 - f * 0.015;
      return state([Math.sin(a) * r, 3.2 + 0.3 * Math.sin(f * 0.05), Math.cos(a) * r], [0, 0.8, 0]);
    },
  },
  {
    id: 'pan', label: 'fast pan', frames: PATH_FRAMES, resets: [],
    about: 'fast low truck + yaw past the pillar and spheres: large disocclusions every frame, off-screen reveals',
    at: (f) => state([-6.0 + f * 0.13, 1.4, 5.2], [-3.0 + f * 0.16, 0.7, 0.0]),
  },
  {
    id: 'light', label: 'lighting change', frames: PATH_FRAMES, resets: [],
    about: `static camera; the light orbits slowly, flips to the other side at frame ${HALF} and shrinks (sharper shadows) at frame ${HALF + HALF / 2}: anti-lag`,
    at: (f) => {
      let l: LightState;
      if (f < HALF) {
        const a = 0.93 + f * 0.012; // starts at the default light (atan2(4, 3))
        l = light([5 * Math.sin(a), 7, 5 * Math.cos(a)]);
      } else {
        l = light([-4.5, 6, -3.5], f < HALF + HALF / 2 ? LIGHT_RADIUS : 0.25);
      }
      return state([5.5, 3.5, 6.5], [0, 0.6, 0], l);
    },
  },
  {
    id: 'thin', label: 'thin geometry', frames: PATH_FRAMES, resets: [],
    about: 'close to the fence (4 cm slats, rails) and its thin shadows, slow lateral drift',
    at: (f) => state([2.0 + f * 0.012, 1.0, 6.4], [3.0 + f * 0.012, 0.45, 3.6]),
  },
  {
    id: 'glossy', label: 'glossy floor close-up', frames: PATH_FRAMES, resets: [],
    about: 'camera low over the glossy floor (r 0.05..0.45 bands) looking at reflections of the spheres and the sky band',
    at: (f) => state([-1.5 + f * 0.012, 0.45, 4.8 - f * 0.01], [0.2, 0.3, 0]),
  },
  {
    id: 'cut', label: 'camera cut', frames: PATH_FRAMES, resets: [HALF],
    about: `orbit, hard cut at frame ${HALF} (reset flag) to the other side of the scene, then a lateral truck`,
    at: (f) => {
      if (f < HALF) {
        const a = 0.35 + f * 0.009, r = 9.0 - f * 0.02;
        return state([Math.sin(a) * r, 3.2 + 0.4 * Math.sin(f * 0.05), Math.cos(a) * r], [0, 0.8, 0]);
      }
      const t = f - HALF;
      return state([-6.8 + t * 0.045, 2.1, -5.2 + t * 0.03], [0.4 + t * 0.02, 0.6, 0.6]);
    },
  },
  {
    id: 'object', label: 'moving object', frames: PATH_FRAMES, resets: [],
    about: 'static camera, a bouncing sphere moving across and toward the camera: object motion, 2.5D motion (motion_z), moving shadow',
    at: (f) => {
      const w = (2 * Math.PI * f) / PATH_FRAMES;
      const obj: V3 = [-1.0 + 2.6 * (0.5 - 0.5 * Math.cos(w)), OBJ_RADIUS + 0.9 * Math.abs(Math.sin(f * 0.13)), 1.9 + 1.2 * Math.sin(w)];
      return state([0.6, 2.4, 7.8], [0.3, 0.6, 0.5], DEFAULT_LIGHT, obj);
    },
  },
  // ---- v1 paths (testbed-v1)
  {
    id: 'bumpy', label: 'bumpy surfaces', frames: PATH_FRAMES, resets: [], scene: 'bumpy',
    about: 'M7: slow orbit over a normal-mapped floor (domes, 10..40 deg) toward a rippled wall with a cyan area light: directional detail (sh-diffuse, sh-specular)',
    at: (f) => {
      const a = -0.3 + f * 0.004;
      return state([Math.sin(a) * 5.0, 2.3 + 0.15 * Math.sin(f * 0.05), -0.2 + Math.cos(a) * 5.0], [0, 0.4, -0.2]);
    },
  },
  {
    id: 'bounce', label: 'coloured bounce', frames: PATH_FRAMES, resets: [], scene: 'bumpy',
    about: 'M7: slow dolly down a corridor of bumpy floor between a red and a green wall: coloured directionality (YCoCg L0 chroma vs RGB)',
    at: (f) => state([-0.5 + 0.004 * f, 1.5, 12.5 - f * 0.02], [-0.5, 0.15, 7.2]),
  },
  {
    id: 'glass', label: 'glass (orbit)', frames: PATH_FRAMES, resets: [], scene: 'glass',
    about: 'M8: static framed amber glass panel (striped alpha) and a blue-green panel under it cast a coloured shadow with nested penumbrae; camera orbit',
    at: (f) => {
      const a = -0.35 + f * 0.007, r = 3.6;
      return glassState([GLASS_TARGET[0] + Math.sin(a) * r, 2.8, GLASS_TARGET[2] + Math.cos(a) * r], GLASS_TARGET, glassPose(0));
    },
  },
  {
    id: 'glass-moving', label: 'moving glass', frames: PATH_FRAMES, resets: [], scene: 'glass',
    about: 'M8: static camera; the framed glass panel slides and turns over a static receiver (no motion vector follows its coloured shadow)',
    at: (f) => glassState(GLASS_EYE, GLASS_TARGET, glassPose(f)),
  },
  {
    id: 'glass-still', label: 'glass (frozen control)', frames: PATH_FRAMES, resets: [], scene: 'glass',
    about: 'M8: glass-moving frozen at its frame 24 pose (static camera, nothing moves): the boil control',
    at: () => glassState(GLASS_EYE, GLASS_TARGET, glassPose(24)),
  },
];

// ---- shadow motion separation (shadows-motion, results/SHADOWS-MOTION.md): one thing moves per path
// (camera / light / occluder) or nothing (frozen control), under a hard local light (sphere r 4 cm, ~1.6-2.6 m
// above the occluders: near-hard edges, contact shadows) or a wide "sun" (sphere r 8 at distance 100, angular
// radius 0.08 rad: wide penumbrae; replay it with `sh.light=directional` for the directional code path).
// Motion profile s(f), 80 frames: 0..24 forward (0 -> 1), 25..40 hold, 41..64 reverse (1 -> 0), 65..79 hold.
// Every path is at s = 0 on frame 0 and from frame 64 on, where it equals its frozen control frame for frame.
export const SM_FRAMES = 80;
/** motion phase of frame f: 0 = reset frame, 1 move, 2 hold, 3 reverse, 4 hold (results/SHADOWS-MOTION.md) */
export const smPhase = (f: number) => (f === 0 ? 0 : f <= 24 ? 1 : f <= 40 ? 2 : f <= 64 ? 3 : 4);
const smS = (f: number) => (f <= 24 ? f / 24 : f <= 40 ? 1 : f <= 64 ? 1 - (f - 40) / 24 : 0);
const SM_EYE: V3 = [0.6, 2.4, 7.8];
const SM_TARGET: V3 = [0.6, 0.5, 1.6];
const smHard = (s: number) => light([1.4 + 1.44 * s, 3.0, 1.9], 0.04);   // 6 cm per frame while moving
const SM_SUN_EL = (50 * Math.PI) / 180, SM_SUN_AZ = Math.atan2(4, 3);
const smSun = (s: number): LightState => {
  const az = SM_SUN_AZ + 0.25 * s;   // 0.6 deg per frame while moving
  return light([100 * Math.cos(SM_SUN_EL) * Math.sin(az), 100 * Math.sin(SM_SUN_EL), 100 * Math.cos(SM_SUN_EL) * Math.cos(az)], 8);
};
/** camera orbit about SM_TARGET by 0.25 s rad (~7 cm per frame while moving) */
const smEye = (s: number): V3 => {
  const a = 0.25 * s, dx = SM_EYE[0] - SM_TARGET[0], dz = SM_EYE[2] - SM_TARGET[2];
  return [SM_TARGET[0] + dx * Math.cos(a) + dz * Math.sin(a), SM_EYE[1], SM_TARGET[2] - dx * Math.sin(a) + dz * Math.cos(a)];
};
const smObj = (s: number): V3 => [1.2 + 1.4 * s, OBJ_RADIUS, 1.1];   // rests on the floor, ~6 cm per frame
for (const [lk, lf, about] of [['hard', smHard, 'hard local light (r 4 cm)'], ['sun', smSun, 'wide sun (0.08 rad)']] as const) {
  const mk = (motion: string, what: string, at: (s: number) => FrameState): PathDef => ({
    id: `sm-${lk}-${motion}`, label: `${lk}: ${motion}`, frames: SM_FRAMES, resets: [],
    about: `shadow motion separation, ${about}: ${what}; move 1-24, hold 25-40, reverse 41-64, hold 65-79`,
    at: (f) => at(smS(f)),
  });
  PATHS.push(
    mk('camera', 'camera orbit only', (s) => state(smEye(s), SM_TARGET, lf(0), smObj(0))),
    mk('light', 'light motion only', (s) => state(SM_EYE, SM_TARGET, lf(s), smObj(0))),
    mk('object', 'occluder (sphere on the floor) motion only', (s) => state(SM_EYE, SM_TARGET, lf(0), smObj(s))),
    mk('frozen', 'nothing moves (control; = every sm path at s = 0)', () => state(SM_EYE, SM_TARGET, lf(0), smObj(0))),
  );
}

export const pathById = (id: string) => PATHS.find((p) => p.id === id);

/** frame f of path p is a history reset (first frame or a camera cut) */
export const isReset = (p: PathDef, f: number) => f === 0 || p.resets.includes(f);
