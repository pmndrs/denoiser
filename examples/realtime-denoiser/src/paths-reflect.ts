// Reflection-motion paths (reflect build, scene.ts; docs/research/rt-denoiser/results/REFLECTION-MOTION.md).
// Each path isolates one kind of motion in front of one reflector, with two emissive markers whose mirror images
// the CPU oracle (src/reflect-oracle.ts) locates exactly: marker 1 near the reflector, marker 2 far (behind the
// camera on most paths, so it is seen only in the mirror). Motion profile: frames 0..STOP move at constant speed,
// then the state holds (stop / hold: recovery after the stop). `rm-cut-*` cuts the camera instead.
// Registered into PATHS on import (main.ts imports this module), so pathById() finds them; paths.ts is untouched.
import type { V3 } from './camera';
import { PATHS, type FrameState, type LightState, type PathDef } from './paths';
import type { Reflector } from './reflect-oracle';

/** reflect-build extras of a frame state (written to the scene uniform by signals.ts) */
export interface ReflectState {
  refl: Reflector;
  /** marker 2 (marker 1 is FrameState.obj) */
  m2: { pos: V3; radius: number };
  markerRadius: number;
  markerGain: number;
  floorDim: number;
}
declare module './paths' {
  interface FrameState { reflect?: ReflectState }
}

export const RM_FRAMES = 72;
/** last moving frame: frames 0..RM_STOP move, RM_STOP + 1.. hold the RM_STOP state */
export const RM_STOP = 40;
const s = (f: number) => Math.min(f, RM_STOP) / RM_STOP;
const lerp3 = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

const LIGHT: LightState = { pos: [3, 6, 5], radius: 0.9, radiance: [18 * (1.2 / 0.9) ** 2, 16.5 * (1.2 / 0.9) ** 2, 14 * (1.2 / 0.9) ** 2] };
const M1R = 0.08, M2R = 0.1, GAIN = 8;

const PLANE = (rough = 0.02, bump = 0, pos: V3 = [0, 1, 0], angle = 0): Reflector => ({ kind: 0, pos, angle, radius: 0, half: [1.2, 0.8], rough, bump });
const BALL = (rough = 0.02, pos: V3 = [0, 1, 0]): Reflector => ({ kind: 1, pos, angle: 0, radius: 0.6, half: [0, 0], rough, bump: 0 });
const CAP = (rough = 0.02): Reflector => ({ kind: 2, pos: [0, 1, 0], angle: 0, radius: 3, half: [1, 1], rough, bump: 0 });

const st = (eye: V3, target: V3, refl: Reflector, m1: V3, m2: V3): FrameState => ({
  eye, target, light: LIGHT, obj: m1,
  reflect: { refl, m2: { pos: m2, radius: M2R }, markerRadius: M1R, markerGain: GAIN, floorDim: 1 },
});

export interface ReflectPathDef extends PathDef {
  /** what moves: camera | object | reflector | none (cut) */
  moves: 'camera' | 'object' | 'reflector' | 'cut';
  /** first held frame (recovery is measured from here; on a cut path the cut frame, after which the camera holds) */
  holdFrom: number;
  /** ROI half size in px at 960 wide (reflect-eval.ts; default 40; the mirror ball's images are small and close) */
  roiHalf?: number;
}

const mk = (id: string, label: string, about: string, moves: ReflectPathDef['moves'], at: (f: number) => FrameState, resets: number[] = []): ReflectPathDef =>
  ({ id, label, about: `${about}; reflect build`, scene: 'reflect', frames: RM_FRAMES, resets, at, moves, holdFrom: moves === 'cut' ? resets[0] : RM_STOP + 1,
    ...(id.includes('convex') || id.includes('ball') ? { roiHalf: 16 } : {}) });

// near marker 1 and far marker 2 per reflector (placed with the oracle so both images stay on the mirror)
const P_M1: V3 = [-0.35, 0.6, 0.6], P_M2: V3 = [0.5, 1.75, 5.2];
const B_M1: V3 = [-0.55, 0.75, 1.1], B_M2: V3 = [0.7, 2.1, 4.4];
const C_M1: V3 = [-0.3, 0.95, 0.9], C_M2: V3 = [0.15, 1.1, 4.6];
const camStrafe = (f: number, z: number, x0 = -1.5, x1 = 1.5, y = 1.3): V3 => [x0 + (x1 - x0) * s(f), y, z];

const roughPlane = (r: number) => mk(`rm-cam-plane-r${Math.round(r * 100)}`, `plane mirror r ${r}, camera`, `camera strafe in front of a plane mirror (roughness ${r}), static markers near (0.6 m) and far (5.2 m, behind the camera); stop at frame ${RM_STOP}`, 'camera',
  (f) => st(camStrafe(f, 4), [0, 1, 0], PLANE(r), P_M1, P_M2));

export const REFLECT_PATHS: ReflectPathDef[] = [
  mk('rm-cam-plane', 'plane mirror, camera', `camera strafe (7.5 cm / frame, turning to keep the mirror centred) in front of a plane mirror, static markers near (0.6 m) and far (5.2 m, behind the camera); stop at frame ${RM_STOP}`, 'camera',
    (f) => st(camStrafe(f, 4), [0, 1, 0], PLANE(), P_M1, P_M2)),
  roughPlane(0.1), roughPlane(0.2), roughPlane(0.35), roughPlane(0.5),
  mk('rm-bump-plane', 'rippled plane mirror, camera', 'as rm-cam-plane, with normal-mapped ripples (8 deg, 25 cm period) on the flat mirror: curvature only in the normals', 'camera',
    (f) => st(camStrafe(f, 4), [0, 1, 0], PLANE(0.02, 8), P_M1, P_M2)),
  mk('rm-graze-plane', 'plane mirror, grazing camera', 'camera strafing nearly parallel to a plane mirror (incidence ~70-78 deg), static markers', 'camera',
    (f) => { const e = lerp3([3.4, 1.25, 0.9], [1.4, 1.25, 1.3], s(f)); return st(e, [e[0] - 3.0, 1.0, 0.0], PLANE(), [-0.7, 0.65, 0.45], [-3.6, 1.7, 2.4]); }),
  mk('rm-obj-plane', 'plane mirror, marker moves', 'static camera and mirror; the near marker slides 2 m across in front of the mirror (5 cm / frame), the far marker stays', 'object',
    (f) => st([0.4, 1.3, 4], [0, 1, 0], PLANE(), lerp3([-1.0, 0.6, 0.6], [1.0, 0.6, 0.6], s(f)), P_M2)),
  mk('rm-obj-exit', 'plane mirror, marker leaves', 'static camera and mirror; the near marker slides out past the mirror edge (its image leaves the mirror at frame 23), then holds: visibility change, ghost persistence', 'object',
    (f) => st([0.4, 1.3, 4], [0, 1, 0], PLANE(), lerp3([0.2, 0.6, 0.6], [2.2, 0.6, 0.6], s(f)), P_M2)),
  mk('rm-refl-slide', 'plane mirror slides in plane', 'static camera and markers; the plane mirror slides along itself (4 cm / frame): surface motion vectors move, the reflection must not', 'reflector',
    (f) => st([0.4, 1.3, 4], [0, 1, 0], PLANE(0.02, 0, [-0.8 + 1.6 * s(f), 1, 0]), P_M1, P_M2)),
  mk('rm-refl-turn', 'plane mirror turns', 'static camera and markers; the plane mirror turns about its vertical axis (0.35 deg / frame): the far image swings at twice the turn', 'reflector',
    (f) => st([0.4, 1.3, 4], [0, 1, 0], PLANE(0.02, 0, [0, 1, 0], ((-7 + 14 * s(f)) * Math.PI) / 180), P_M1, P_M2)),
  mk('rm-cam-convex', 'convex mirror ball, camera', 'camera strafe in front of a mirror ball (R 0.6 m), static markers near and far', 'camera',
    (f) => st(camStrafe(f, 3, -1.2, 1.2), [0, 1, 0], BALL(), B_M1, B_M2)),
  mk('rm-obj-convex', 'convex mirror ball, marker moves', 'static camera and ball; the near marker circles part-way round the ball (0.6 m from its surface)', 'object',
    (f) => { const a = -0.9 + 1.8 * s(f); return st([0.3, 1.3, 3], [0, 1, 0], BALL(), [1.2 * Math.sin(a), 0.75, 1.2 * Math.cos(a)], B_M2); }),
  mk('rm-refl-ball', 'convex mirror ball moves', 'static camera and markers; the mirror ball translates sideways (2 cm / frame): reflections move at their own rate, not the surface rate', 'reflector',
    (f) => st([0.3, 1.3, 3], [0, 1, 0], BALL(0.02, [-0.4 + 0.8 * s(f), 1, 0]), B_M1, B_M2)),
  mk('rm-cam-concave', 'concave mirror, camera', 'camera strafe in front of a concave spherical mirror (R 3 m, f 1.5 m): near marker inside f (upright virtual image), far marker beyond 2f (inverted real image in front of the mirror)', 'camera',
    (f) => st(camStrafe(f, 4, -0.6, 0.2), [0, 1, 0], CAP(), C_M1, C_M2)),
  mk('rm-cut-plane', 'plane mirror, camera cut', `camera strafe in front of the plane mirror, hard cut at frame 36 to another viewpoint, then a hold`, 'cut',
    (f) => (f < 36 ? st(camStrafe(f, 4), [0, 1, 0], PLANE(), P_M1, P_M2) : st([1.3, 1.6, 3.3], [0, 1, 0], PLANE(), P_M1, P_M2)), [36]),
];

for (const p of REFLECT_PATHS) if (!PATHS.some((q) => q.id === p.id)) PATHS.push(p);
export const reflectPathById = (id: string) => REFLECT_PATHS.find((p) => p.id === id);
