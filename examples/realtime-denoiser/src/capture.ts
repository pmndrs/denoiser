// Test bed <-> CAPTURE-FORMAT v0 / v1 (task T0.6; v1 buffers: testbed-v1): which SceneSignals texture is which capture
// buffer, the capture manifest's metadata, and the live ReplayFrame that denoisers get
// every frame (the same structure tools/rt-capture/src/replay.ts builds from a capture,
// so a denoiser sees identical inputs live and in replay).
//
// Writing a capture: main.ts `mode=capture` calls CaptureWriter.writeFrame(...) right
// after scene.render(), with captureBuffers() and frameExtra(). Files land in
// tools/rt-capture/captures/<name>/ (or $RT_CAPTURE_DIR/captures/) through the
// rtCapture() Vite plugin in vite.config.ts. Formats: the rgba16float textures (normal,
// albedo, f0, diffuse, specular) are written as the exact f32 value of each half, so a
// replay sees bit-identical values (uploaded as rgba32float). A capture of the v1 signals
// (sh-diffuse, sh-specular, shadow-rgb) adds their CAPTURE-FORMAT v1 buffers and is written as
// version 1; a capture of only the v0 signals is the same v0 capture as before.
import type { FrameCamera } from '@pmndrs/denoiser-ffx';
import type { CaptureFrame, CaptureLight, CaptureManifest, SignalName } from '../../../tools/rt-capture/src/format';
import { BUFFER_CHANNELS, V1_BUFFERS } from '../../../tools/rt-capture/src/format';
import type { CaptureBufferSource } from '../../../tools/rt-capture/src/writer';
import type { ReplayFrame, ReplayGuides } from '../../../tools/rt-capture/src/replay';
import { OBJ_RADIUS, type LightState, type PathDef } from './paths';
import { isV1Signal, type FrameMeta, type SceneSignals, type Signal, type TexName } from './signals';

/** SceneSignals texture -> CAPTURE-FORMAT buffer name. */
export const CAPTURE_NAME: Record<TexName, string> = {
  depth: 'depth', viewz: 'viewz', normal: 'normal', roughness: 'roughness', motion: 'motion', motionZ: 'motion_z',
  albedo: 'albedo', f0: 'f0',
  diffuse: 'diffuse', diffuseHitT: 'diffuse_hitt', diffuseRef: 'diffuse_ref',
  specular: 'specular', specularHitT: 'specular_hitt', specularRef: 'specular_ref',
  visibility: 'visibility', occluderDist: 'occluder_dist', visibilityRef: 'visibility_ref',
  // T5 derived signals: live only, never written to a capture (no CAPTURE-FORMAT buffer)
  ao: 'ao', so: 'so', aoRef: 'ao_ref', soRef: 'so_ref',
  // v1 (the two halves of a 6-channel *_sh_ref are one capture buffer; see captureBuffers)
  diffuseDir: 'diffuse_dir', specularDir: 'specular_dir', normalGeom: 'normal_geom',
  transmittance: 'transmittance', translucentDist: 'translucent_dist',
  shadowRgb: 'shadow_rgb', visLumT: 'visibility_lumt',   // derived, live only (the replay derives them on load)
  diffuseShRefA: 'diffuse_sh_ref', diffuseShRefB: 'diffuse_sh_ref#4', specularShRefA: 'specular_sh_ref', specularShRefB: 'specular_sh_ref#4',
  shadowRgbRef: 'shadow_rgb_ref',
};

const GUIDES: TexName[] = ['depth', 'viewz', 'normal', 'roughness', 'motion', 'motionZ', 'albedo', 'f0'];
// ao / so are derived from the hit distances at replay time (tools/rt-capture format.ts DERIVED_SIGNALS)
const SIGNAL_TEX: Record<Signal, TexName[]> = {
  diffuse: ['diffuse', 'diffuseHitT'], specular: ['specular', 'specularHitT'], shadows: ['visibility', 'occluderDist'],
  ao: ['diffuseHitT'], so: ['specularHitT'],
  'sh-diffuse': ['diffuse', 'diffuseHitT', 'diffuseDir'], 'sh-specular': ['specular', 'specularHitT', 'specularDir'],
  'shadow-rgb': ['visibility', 'occluderDist', 'transmittance', 'translucentDist'],
};
const REF_TEX: Partial<Record<Signal, TexName[]>> = {
  diffuse: ['diffuseRef'], specular: ['specularRef'], shadows: ['visibilityRef'],
  // occlusion references as extra 1-channel buffers (`ao_ref` / `so_ref`, as the three-temporal captures' ao_ref;
  // ignored by v0 readers), written only when ao / so are among the captured signals
  ao: ['aoRef'], so: ['soRef'],
  'sh-diffuse': ['diffuseRef', 'diffuseShRefA'], 'sh-specular': ['specularRef', 'specularShRefA'], 'shadow-rgb': ['visibilityRef', 'shadowRgbRef'],
};
/** the second half (channels 4..5) of a 6-channel SH reference */
const SH_HI: Partial<Record<TexName, TexName>> = { diffuseShRefA: 'diffuseShRefB', specularShRefA: 'specularShRefB' };

/** extra 1-channel buffers outside CAPTURE-FORMAT v0's table */
const EXTRA_1CH = new Set(['ao_ref', 'so_ref']);
const channels = (name: string) => (BUFFER_CHANNELS as Record<string, number>)[name] ?? (EXTRA_1CH.has(name) ? 1 : NaN);

/** Textures of a capture of `signals`: guides (+ normal_geom with any v1 signal) + noisy + hit distance [+ reference]. */
const bufferTex = (signals: Signal[], refs: boolean): TexName[] =>
  [...new Set([...GUIDES, ...(signals.some(isV1Signal) ? ['normalGeom' as TexName] : []),
    ...signals.flatMap((s) => SIGNAL_TEX[s]), ...(refs ? signals.flatMap((s) => REF_TEX[s] ?? []) : [])])];

/** Every buffer of a capture of `signals`, by capture name (6-channel SH references as two parts). */
export function captureBuffers(scene: SceneSignals, signals: Signal[], refs: boolean): Record<string, CaptureBufferSource> {
  const t = scene.textures;
  return Object.fromEntries(bufferTex(signals, refs).map((n) => {
    const hi = SH_HI[n];
    if (EXTRA_1CH.has(CAPTURE_NAME[n])) return [CAPTURE_NAME[n], { texture: t[n], channels: 1 }];
    return [CAPTURE_NAME[n], hi ? { parts: [{ texture: t[n], channels: 4 }, { texture: t[hi], channels: 2 }] } : t[n]];
  }));
}

/** Bytes per frame of a capture (f32, every buffer of captureBuffers()). */
export function captureFrameBytes(width: number, height: number, signals: Signal[], refs: boolean): number {
  return width * height * 4 * bufferTex(signals, refs).reduce((a, n) => a + channels(CAPTURE_NAME[n]), 0);
}

/** The capture's CAPTURE-FORMAT version: 1 if it has any v1 buffer. */
export const captureVersion = (signals: Signal[], refs: boolean): 0 | 1 =>
  bufferTex(signals, refs).some((n) => (V1_BUFFERS as readonly string[]).includes(CAPTURE_NAME[n])) ? 1 : 0;

/** The test bed's sphere light as the CAPTURE-FORMAT `lights` array (the shadow light). */
export const lightsOf = (light: LightState): CaptureLight[] => [{
  id: 'key', type: 'sphere', position: [...light.pos], radius: light.radius,
  color: [...light.radiance], shadow: true,
}];

/**
 * Per-frame manifest extras (ignored by v0 readers): the sphere light can move or change
 * size per frame (path `light`), and the movable sphere moves in path `object`; v0's
 * capture-level `lights` holds frame 0's light.
 */
export const frameExtra = (meta: FrameMeta, pathFrame: number) => ({
  pathFrame,
  lights: lightsOf(meta.light),
  object: { type: 'sphere', position: [...meta.obj], radius: OBJ_RADIUS },
  // glass build: the moving translucent panel's pose (informational; scene.ts documents the panels)
  ...(meta.glass ? { translucent: { type: 'panel', position: [...meta.glass.pos], angleY: meta.glass.angle } } : {}),
});

/** No object motion over frames [start, start + frames) of the path (moving lights are fine). */
export function isStatic(path: PathDef, start: number, frames: number): boolean {
  const s0 = path.at(start);
  const o0 = s0.obj, g0 = s0.glass;
  for (let f = start + 1; f < start + frames; f++) {
    const s = path.at(f);
    const o = s.obj;
    if (o[0] !== o0[0] || o[1] !== o0[1] || o[2] !== o0[2]) return false;
    // the glass panel's frame is visible geometry: moving it is object motion
    if (g0 && s.glass && (s.glass.angle !== g0.angle || s.glass.pos.some((x, i) => x !== g0.pos[i]))) return false;
  }
  return true;
}

/** A manifest-shaped description of the live scene (frames: []), for ReplayFrame.manifest. */
export function liveManifest(width: number, height: number, signals: Signal[], refs: boolean, lights: CaptureLight[], isStaticScene: boolean, refSpp: number): CaptureManifest {
  return {
    version: captureVersion(signals, refs), scene: 'realtime-denoiser-testbed', width, height, reversedDepth: false, static: isStaticScene,
    demodulation: { diffuse: 'albedo', specular: 'karis2014-envbrdf-approx' }, lights,
    buffers: bufferTex(signals, refs).map((n) => ({ name: CAPTURE_NAME[n], channels: channels(CAPTURE_NAME[n]) })),
    referenceSpp: refSpp, frames: [],
  };
}

/**
 * The frame a denoiser sees, built from the live textures exactly like CaptureTextures.frame()
 * builds it from a capture: guides (incl. viewZ / motionZ), per-signal inputs in the
 * TemporalDenoiser API shapes, and the buffers by capture name (references left out live).
 */
export function liveFrame(scene: SceneSignals, manifest: CaptureManifest, index: number, reset: boolean, camera: FrameCamera, meta?: CaptureFrame): ReplayFrame {
  const t = scene.textures;
  const guides: ReplayGuides = {
    depth: t.depth, normal: t.normal, motion: t.motion, roughness: t.roughness, albedo: t.albedo,
    viewZ: t.viewz, motionZ: t.motionZ,
    // v1: the smooth normal (equal to `normal` outside the bumpy build, so the plain normal serves there)
    geometricNormal: scene.v1 ? t.normalGeom : t.normal,
  };
  const textures = Object.fromEntries((Object.keys(CAPTURE_NAME) as TexName[])
    .filter((n) => !/Ref[AB]?$/.test(n)).map((n) => [CAPTURE_NAME[n], t[n]]));
  return {
    index, reset, manifest, guides, camera,
    inputs: {
      diffuse: { radiance: t.diffuse, hitDistance: t.diffuseHitT },
      specular: { radiance: t.specular, hitDistance: t.specularHitT },
      visibility: { visibility: t.visibility, hitDistance: t.occluderDist },
      ao: { hitDistance: t.diffuseHitT }, so: { hitDistance: t.specularHitT },
      // v1 (only meaningful when the scene renders them: SceneSignals.v1)
      ...(scene.v1 ? {
        'sh-diffuse': { radiance: t.diffuse, direction: t.diffuseDir, hitDistance: t.diffuseHitT },
        'sh-specular': { radiance: t.specular, direction: t.specularDir, hitDistance: t.specularHitT },
        'shadow-rgb': {
          visibility: t.visibility, hitDistance: t.occluderDist, translucency: t.transmittance, translucencyHitDistance: t.translucentDist,
          radiance: t.shadowRgb, visibilityLumT: t.visLumT,
        },
      } : {}),
    },
    textures,
    ...(meta ? { meta } : {}),
  };
}

export type { SignalName };
