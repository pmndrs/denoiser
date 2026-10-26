// Normal-detail paths (detail build = the bumpy build + scene.ts `heldOutNormal` and a moving emitter;
// docs/research/rt-denoiser/results/T5-normal-detail.md, review target 5). Same geometry and materials as `bumpy`
// (normal-mapped floor and rippled wall, glossy floor bands, cyan area light); per path:
//   bump      0 = the M7 domes / ripples (what M7 tuned the SH resolve on), 1 = no detail normals (smooth control:
//             normal = normal_geom), 2 = held-out grooves, 3 = held-out fine cells (never used for tuning)
//   emitter   an emissive sphere (radius DT_EMIT_R) seen only by the diffuse / specular rays: invisible to the camera,
//             casts no shadow-signal shadow, needs no motion vectors; it moves only on the dt-light* paths
// Orbit paths: `bumpy`'s slow orbit (2 cm / frame). Light paths: `bumpy`'s frame-48 view held still, the emitter holds
// over the left of the floor (frames 0..DT_ONSET-1), sweeps 4.8 m to the right (DT_ONSET..DT_STOP-1, 15 cm / frame),
// then holds (DT_STOP..): the bump shading turns with it while the geometry and the camera stay fixed.
// Registered into PATHS on import (main.ts imports this module), like paths-light.ts; paths.ts is untouched.
import type { V3 } from './camera';
import { PATHS, pathById, type FrameState, type PathDef } from './paths';

/** detail-build extras of a frame state (written to the scene uniform by signals.ts) */
export interface DetailState { emitPos: V3; emitRadius: number; emitRadiance: V3; bump: number }
declare module './paths' {
  interface FrameState { detail?: DetailState }
}

export const DT_ONSET = 16;
export const DT_STOP = 48;
export const DT_EMIT_R = 0.6;
const EMIT_L: V3 = [6.0, 5.5, 4.8];
const EMIT_A: V3 = [-2.4, 1.4, 1.0], EMIT_B: V3 = [2.4, 1.4, 1.0];
const NONE: Omit<DetailState, 'bump'> = { emitPos: [0, -100, 0], emitRadius: 0, emitRadiance: [0, 0, 0] };
const bumpy = pathById('bumpy')!;

const lerp3 = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
/** emitter position: hold A, sweep to B, hold B */
export const dtEmitPos = (f: number): V3 => lerp3(EMIT_A, EMIT_B, Math.min(Math.max((f - DT_ONSET + 1) / (DT_STOP - DT_ONSET), 0), 1));

const BUMP_NAMES = ['M7 domes / ripples', 'smooth control (no detail normals)', 'held-out grooves', 'held-out fine cells'];
const orbit = (id: string, bump: number): PathDef => ({
  id, label: `detail orbit (${BUMP_NAMES[bump]})`, frames: bumpy.frames, resets: [], scene: 'detail',
  about: `T5: bumpy's slow orbit over the normal-mapped floor and rippled wall, detail normals = ${BUMP_NAMES[bump]}; no emitter`,
  at: (f): FrameState => ({ ...bumpy.at(f), detail: { ...NONE, bump } }),
});
const still = bumpy.at(48);
const light = (id: string, bump: number): PathDef => ({
  id, label: `moving broad light (${BUMP_NAMES[bump]})`, frames: 80, resets: [], scene: 'detail',
  about: `T5: fixed camera (bumpy's frame 48) and geometry; a broad emitter (r ${DT_EMIT_R} m, out of view) holds, sweeps across the floor at frames ${DT_ONSET}..${DT_STOP - 1}, then holds; detail normals = ${BUMP_NAMES[bump]}`,
  at: (f): FrameState => ({ ...still, detail: { emitPos: dtEmitPos(f), emitRadius: DT_EMIT_R, emitRadiance: EMIT_L, bump } }),
});

export const DETAIL_PATHS: PathDef[] = [
  orbit('dt-bumpy', 0), orbit('dt-smooth', 1), orbit('dt-grooves', 2), orbit('dt-fine', 3),
  light('dt-light', 0), light('dt-light-smooth', 1), light('dt-light-grooves', 2),
];
for (const p of DETAIL_PATHS) if (!PATHS.some((q) => q.id === p.id)) PATHS.push(p);
