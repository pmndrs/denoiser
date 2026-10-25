// Deterministic camera path for the realtime pages (`?path=orbit`): the real three.js scene
// as a second scoring scene with a moving camera (results/M6-real-scene.md, "moving camera").
//
//   frames  0..39  slow orbit around the wide shot's target, dollying in a little
//                  (~0.46 deg of orbit per frame, ~5-7 px of screen motion per frame at 960 px)
//   frames 40..63  fast pan: the camera keeps sliding along the orbit's tangent (6 cm/frame)
//                  while it yaws left by 1.6 deg/frame (~22 px/frame plus parallax: disocclusions
//                  behind the table / chair legs and off-screen reveals every frame)
//
// The pose is a pure function of the path frame, so a capture's frame i, a live run's frame i
// and a re-run months later see the same camera. The scene itself is frozen on the path (the
// torus knot does not rotate), so the motion comes from the camera alone (`static: true`).
//
// Moving-occluder paths (results/M4.md "Moving shadows"): the same, with the torus knot rotating at
// the free-running pages' rate (t * 0.35 rad, t += 1/60 per frame), so its soft shadow sweeps the
// back wall and floor while those receivers stay still (no motion vector follows the shadow):
//   knot-static   static camera on the knot, its pedestal and its shadow (KNOT_VIEW)
//   knot-orbit    the orbit's camera (frames 0..39 slow orbit, then the pan) with the knot rotating
//   knot-still    control: knot-static's camera with the knot frozen (static wide penumbrae only)
import * as THREE from 'three/webgpu';
import { SHOTS } from './scene';

export const PATH_FRAMES = 64;
export const PAN_START = 40;
export const PATH_NAMES = ['orbit', 'knot-static', 'knot-orbit', 'knot-still'] as const;
export type PathName = (typeof PATH_NAMES)[number];
/** `?path=` value -> path name (undefined = free-running page). */
export const pathName = (v: string | null): PathName | undefined => PATH_NAMES.find((n) => n === v);

/** Knot rotation of the moving-occluder paths: rad per path frame (the free-running pages' rate) and fixed tilt. */
export const KNOT_RATE = 0.35 / 60;
export const KNOT_TILT = 0.4;
/** knot-static camera: the knot, its pedestal and its shadow on the back wall / floor, close up. */
export const KNOT_VIEW = { position: new THREE.Vector3(0.55, 1.05, 0.55), target: new THREE.Vector3(1.55, 0.6, -1.95) };

const T = SHOTS[0].target;
const A0 = 0.10, DA = 0.008;          // orbit angle at frame 0 and per frame (rad)
const R0 = 4.0, DR = -0.010;          // orbit radius (m) and per frame
const H0 = 1.6, DH = -0.004;          // camera height (m) and per frame
const PAN_SLIDE = 0.06;               // m per frame along the orbit tangent
const PAN_YAW = (1.6 * Math.PI) / 180; // rad per frame, to the left

function orbitPos(f: number): THREE.Vector3 {
  const a = A0 + DA * f, r = R0 + DR * f;
  return new THREE.Vector3(T.x + r * Math.sin(a), H0 + DH * f, T.z + r * Math.cos(a));
}

/** Camera position and look direction (unit) at path frame `f` (clamped to the path). */
export function pathAt(f: number): { position: THREE.Vector3; direction: THREE.Vector3 } {
  const fc = Math.max(0, Math.min(PATH_FRAMES - 1, f));
  if (fc < PAN_START) {
    const p = orbitPos(fc);
    return { position: p, direction: T.clone().sub(p).normalize() };
  }
  const p0 = orbitPos(PAN_START);
  const d0 = T.clone().sub(p0).normalize();
  const tangent = orbitPos(PAN_START + 0.5).sub(orbitPos(PAN_START - 0.5)).setY(0).normalize();
  const k = fc - PAN_START;
  const position = p0.clone().addScaledVector(tangent, PAN_SLIDE * k);
  const direction = d0.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), PAN_YAW * k);
  return { position, direction };
}

/** Puts `camera` at path frame `f` and updates its matrices. */
export function pathPose(camera: THREE.PerspectiveCamera, f: number) {
  const { position, direction } = pathAt(f);
  camera.position.copy(position);
  camera.lookAt(position.clone().add(direction));
  camera.updateMatrixWorld();
}

/** Knot yaw (rad) at path frame `f` of path `name` (0 = frozen). */
export function knotAngle(name: PathName, f: number): number {
  return name === 'orbit' || name === 'knot-still' ? 0 : KNOT_RATE * Math.max(0, Math.min(PATH_FRAMES - 1, f));
}

/** Puts `camera` and the knot at path frame `f` of path `name` (updates their matrices). */
export function scenePose(name: PathName, camera: THREE.PerspectiveCamera, knot: THREE.Object3D, f: number) {
  if (name === 'knot-static' || name === 'knot-still') {
    camera.position.copy(KNOT_VIEW.position);
    camera.lookAt(KNOT_VIEW.target);
    camera.updateMatrixWorld();
  } else pathPose(camera, f);
  knot.rotation.set(KNOT_TILT, knotAngle(name, f), 0);
  knot.updateMatrixWorld();
}

export const PATH_DESCRIPTION = 'orbit: frames 0-39 slow orbit around the wide shot (0.46 deg/frame, dolly in), 40-63 fast pan (6 cm/frame slide + 1.6 deg/frame yaw left); torus knot frozen';

export const PATH_DESCRIPTIONS: Record<PathName, string> = {
  orbit: PATH_DESCRIPTION,
  'knot-static': 'knot-static: static close-up camera on the torus knot, its pedestal and its shadow on the back wall / floor; the knot rotates 0.35/60 rad per frame about its tilted axis (the free-running pages\' rate)',
  'knot-still': 'knot-still: control for knot-static: the same static camera, torus knot frozen',
  'knot-orbit': 'knot-orbit: the orbit path\'s camera (frames 0-39 slow orbit, 40-63 fast pan) with the torus knot rotating 0.35/60 rad per frame',
};

