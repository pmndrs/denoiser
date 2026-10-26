// Light-change paths (review target 3, docs/research/rt-denoiser/results/T3-light-changes.md): fixed camera, fixed
// geometry, only the illumination changes, with identical event times on every path so onset, held illumination and
// return can be scored separately:
//   frames 0..23   base state (history settles)
//   onset          at LC_ONSET (24): the change starts; step paths switch at once, ramp paths take LC_RAMP frames
//   held           the changed state, until LC_RETURN (56)
//   return         at LC_RETURN: back to the base state (at once, or over LC_RAMP frames), then held to the end (95)
// Paths (standard build unless noted; camera = `light`'s view):
//   lc-step     the sphere light switches brightness and colour (x2.3 luminance, white -> blue), then switches back
//   lc-hue      colour only at constant luminance (white -> blue-cyan, Rec. 709 luminance kept): the luminance-only
//               anti-lag detectors' blind spot
//   lc-fade     lc-step's change as a linear ramp over 16 frames each way
//   lc-jump     light switching: the light at another position (lamp A off, lamp B on), then back
//   lc-emitter  reflect build: an emissive sphere moves past the camera just outside the view (below the bottom edge),
//               lighting the floor only through the diffuse / specular rays (no shadow signal, no motion vectors)
// Registered into PATHS on import (main.ts imports this module), like paths-reflect.ts; paths.ts is untouched.
import type { V3 } from './camera';
import { PATHS, type FrameState, type LightState, type PathDef } from './paths';
import './paths-reflect';   // FrameState.reflect (the emitter path uses the reflect build)

export const LC_FRAMES = 96;
export const LC_ONSET = 24;
export const LC_RETURN = 56;
export const LC_RAMP = 16;

/** event frames of a light-change path (scoring windows: results/data/t3-score.mjs) */
export interface LightChangePathDef extends PathDef {
  events: { onset: number; onsetEnd: number; ret: number; retEnd: number };
}

// the test bed's default light (paths.ts DEFAULT_LIGHT: radius 0.9, power of examples/ffx-denoiser's light)
const R = 0.9, K = (1.2 / R) ** 2;
const BASE: V3 = [18 * K, 16.5 * K, 14 * K];
const lum = (c: V3) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const mul = (a: V3, b: V3): V3 => [a[0] * b[0], a[1] * b[1], a[2] * b[2]];
const lerp = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
/** lc-step: brighter and bluer (x2.3 luminance) */
const STEP: V3 = mul(BASE, [1.4, 2.4, 4.6]);
/** lc-hue: blue-cyan at the base light's luminance */
const HUE: V3 = (() => { const c = mul(BASE, [0.45, 1.05, 2.6]); const k = lum(BASE) / lum(c); return [c[0] * k, c[1] * k, c[2] * k]; })();
const POS_A: V3 = [4, 7, 3];        // = paths.ts DEFAULT_LIGHT
const POS_B: V3 = [-4.5, 6, -3.5];  // = the `light` path's flipped light
const EYE: V3 = [5.5, 3.5, 6.5], TARGET: V3 = [0, 0.6, 0];
const PARKED: V3 = [1.7, 0.45, 1.1];

/** 0 before the onset, 1 while held, back to 0 after the return; linear over `ramp` frames (0 = a step) */
export const lcLevel = (f: number, ramp: number) => {
  const up = ramp ? Math.min(Math.max((f - LC_ONSET + 1) / ramp, 0), 1) : f >= LC_ONSET ? 1 : 0;
  const down = ramp ? Math.min(Math.max((f - LC_RETURN + 1) / ramp, 0), 1) : f >= LC_RETURN ? 1 : 0;
  return up * (1 - down);
};

const light = (pos: V3, radiance: V3): LightState => ({ pos, radius: R, radiance });
const st = (l: LightState): FrameState => ({ eye: EYE, target: TARGET, light: l, obj: PARKED });
const mk = (id: string, label: string, about: string, ramp: number, at: (f: number) => FrameState, scene?: PathDef['scene']): LightChangePathDef => ({
  id, label, about: `${about}; fixed camera and geometry, onset ${LC_ONSET}, return ${LC_RETURN}${ramp ? ` (ramps of ${ramp} frames)` : ''}`,
  frames: LC_FRAMES, resets: [], at, ...(scene ? { scene } : {}),
  events: { onset: LC_ONSET, onsetEnd: LC_ONSET + Math.max(ramp - 1, 0), ret: LC_RETURN, retEnd: LC_RETURN + Math.max(ramp - 1, 0) },
});

// lc-emitter (reflect build): camera looks down at the dark checker floor; the emitter (marker 1, r 0.3 m, radiance
// MARKER1_RADIANCE x 8) sits 0.3 m above the floor below the bottom edge of the view (6 deg out of frame for any x)
// and slides 2.4 m sideways; marker 2 and the reflector are parked under the floor (no ray reaches them).
const EM_EYE: V3 = [0, 2.0, 3.0], EM_TARGET: V3 = [0, 0, -0.5];
const EM_LIGHT: LightState = { pos: [3, 6, 5], radius: 0.9, radiance: BASE };
const HIDDEN: V3 = [0, -10, 0];
const emitter = (t: number): FrameState => ({
  eye: EM_EYE, target: EM_TARGET, light: EM_LIGHT, obj: [-1.2 + 2.4 * t, 0.3, 2.4],
  reflect: {
    refl: { kind: 0, pos: HIDDEN, angle: 0, radius: 0, half: [0.1, 0.1], rough: 0.5, bump: 0 },
    m2: { pos: HIDDEN, radius: 0.01 }, markerRadius: 0.3, markerGain: 8, floorDim: 1,
  },
});

export const LIGHT_CHANGE_PATHS: LightChangePathDef[] = [
  mk('lc-step', 'light: brightness + colour step', 'the sphere light switches to x2.3 luminance and a blue tint, holds, switches back', 0,
    (f) => st(light(POS_A, lerp(BASE, STEP, lcLevel(f, 0))))),
  mk('lc-hue', 'light: colour step, same luminance', 'the sphere light turns blue-cyan at the same Rec. 709 luminance, holds, turns back', 0,
    (f) => st(light(POS_A, lerp(BASE, HUE, lcLevel(f, 0))))),
  mk('lc-fade', 'light: brightness + colour fade', `lc-step's change as a linear ramp over ${LC_RAMP} frames each way`, LC_RAMP,
    (f) => st(light(POS_A, lerp(BASE, STEP, lcLevel(f, LC_RAMP))))),
  mk('lc-jump', 'light: switch to another lamp', 'lamp A off / lamp B on (the light jumps to the other side), holds, back to lamp A', 0,
    (f) => st(light(lcLevel(f, 0) ? POS_B : POS_A, BASE))),
  mk('lc-emitter', 'emitter moving out of view', `an emissive sphere slides 2.4 m past the camera just below the view (${LC_RAMP} frames each way), seen only through its light on the floor (reflect build)`, LC_RAMP,
    (f) => emitter(lcLevel(f, LC_RAMP)), 'reflect'),
];

for (const p of LIGHT_CHANGE_PATHS) if (!PATHS.some((q) => q.id === p.id)) PATHS.push(p);
export const lightChangePathById = (id: string) => LIGHT_CHANGE_PATHS.find((p) => p.id === id);
