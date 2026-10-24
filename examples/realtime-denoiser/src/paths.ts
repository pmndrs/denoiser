// Scripted, deterministic stress paths. Each path is a pure function of the frame
// index (no wall clock), so every run of a path sees exactly the same frames.
// A frame state = camera (eye, target), the sphere light, and the movable sphere.
// `resets` are camera cuts: history must be dropped there (CAPTURE-FORMAT `reset`).
import type { V3 } from './camera';

export interface LightState { pos: V3; radius: number; radiance: V3 }
export interface FrameState { eye: V3; target: V3; light: LightState; obj: V3 }
export interface PathDef {
  id: string;
  label: string;
  /** what the path stresses */
  about: string;
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
];

export const pathById = (id: string) => PATHS.find((p) => p.id === id);

/** frame f of path p is a history reset (first frame or a camera cut) */
export const isReset = (p: PathDef, f: number) => f === 0 || p.resets.includes(f);
