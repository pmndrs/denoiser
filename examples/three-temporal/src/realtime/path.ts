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
import * as THREE from 'three/webgpu';
import { SHOTS } from './scene';

export const PATH_FRAMES = 64;
export const PAN_START = 40;
export const PATH_NAMES = ['orbit'] as const;
export type PathName = (typeof PATH_NAMES)[number];

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

export const PATH_DESCRIPTION = 'orbit: frames 0-39 slow orbit around the wide shot (0.46 deg/frame, dolly in), 40-63 fast pan (6 cm/frame slide + 1.6 deg/frame yaw left); torus knot frozen';
