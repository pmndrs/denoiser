// Test bed <-> CAPTURE-FORMAT v0 (task T0.6): which SceneSignals texture is which capture
// buffer, the capture manifest's metadata, and the live ReplayFrame that denoisers get
// every frame (the same structure tools/rt-capture/src/replay.ts builds from a capture,
// so a denoiser sees identical inputs live and in replay).
//
// Writing a capture: main.ts `mode=capture` calls CaptureWriter.writeFrame(...) right
// after scene.render(), with captureBuffers() and frameExtra(). Files land in
// tools/rt-capture/captures/<name>/ (or $RT_CAPTURE_DIR/captures/) through the
// rtCapture() Vite plugin in vite.config.ts. Formats: the rgba16float textures (normal,
// albedo, f0, diffuse, specular) are written as the exact f32 value of each half, so a
// replay sees bit-identical values (uploaded as rgba32float).
import type { FrameCamera } from '@pmndrs/denoiser-ffx';
import type { CaptureFrame, CaptureLight, CaptureManifest, SignalName } from '../../../tools/rt-capture/src/format';
import { BUFFER_CHANNELS } from '../../../tools/rt-capture/src/format';
import type { ReplayFrame, ReplayGuides } from '../../../tools/rt-capture/src/replay';
import { OBJ_RADIUS, type LightState, type PathDef } from './paths';
import type { FrameMeta, SceneSignals, Signal, TexName } from './signals';

/** SceneSignals texture -> CAPTURE-FORMAT buffer name. */
export const CAPTURE_NAME: Record<TexName, string> = {
  depth: 'depth', viewz: 'viewz', normal: 'normal', roughness: 'roughness', motion: 'motion', motionZ: 'motion_z',
  albedo: 'albedo', f0: 'f0',
  diffuse: 'diffuse', diffuseHitT: 'diffuse_hitt', diffuseRef: 'diffuse_ref',
  specular: 'specular', specularHitT: 'specular_hitt', specularRef: 'specular_ref',
  visibility: 'visibility', occluderDist: 'occluder_dist', visibilityRef: 'visibility_ref',
  // T5 derived signals: live only, never written to a capture (no CAPTURE-FORMAT buffer)
  ao: 'ao', so: 'so', aoRef: 'ao_ref', soRef: 'so_ref',
};

const GUIDES: TexName[] = ['depth', 'viewz', 'normal', 'roughness', 'motion', 'motionZ', 'albedo', 'f0'];
// ao / so are derived from the hit distances at replay time (tools/rt-capture format.ts DERIVED_SIGNALS)
const SIGNAL_TEX: Record<Signal, TexName[]> = {
  diffuse: ['diffuse', 'diffuseHitT'], specular: ['specular', 'specularHitT'], shadows: ['visibility', 'occluderDist'],
  ao: ['diffuseHitT'], so: ['specularHitT'],
};
const REF_TEX: Partial<Record<Signal, TexName>> = { diffuse: 'diffuseRef', specular: 'specularRef', shadows: 'visibilityRef' };

const channels = (name: string) => (BUFFER_CHANNELS as Record<string, number>)[name];

/** Textures of a capture of `signals`: guides + noisy + hit distance [+ reference]. */
const bufferTex = (signals: Signal[], refs: boolean): TexName[] =>
  [...new Set([...GUIDES, ...signals.flatMap((s) => SIGNAL_TEX[s]), ...(refs ? signals.flatMap((s) => REF_TEX[s] ?? []) : [])])];

/** Every buffer of a capture of `signals`, by capture name. */
export function captureBuffers(scene: SceneSignals, signals: Signal[], refs: boolean): Record<string, GPUTexture> {
  return Object.fromEntries(bufferTex(signals, refs).map((n) => [CAPTURE_NAME[n], scene.textures[n]]));
}

/** Bytes per frame of a capture (f32, every buffer of captureBuffers()). */
export function captureFrameBytes(width: number, height: number, signals: Signal[], refs: boolean): number {
  return width * height * 4 * bufferTex(signals, refs).reduce((a, n) => a + channels(CAPTURE_NAME[n]), 0);
}

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
});

/** No object motion over frames [start, start + frames) of the path (moving lights are fine). */
export function isStatic(path: PathDef, start: number, frames: number): boolean {
  const o0 = path.at(start).obj;
  for (let f = start + 1; f < start + frames; f++) {
    const o = path.at(f).obj;
    if (o[0] !== o0[0] || o[1] !== o0[1] || o[2] !== o0[2]) return false;
  }
  return true;
}

/** A manifest-shaped description of the live scene (frames: []), for ReplayFrame.manifest. */
export function liveManifest(width: number, height: number, signals: Signal[], refs: boolean, lights: CaptureLight[], isStaticScene: boolean, refSpp: number): CaptureManifest {
  return {
    version: 0, scene: 'realtime-denoiser-testbed', width, height, reversedDepth: false, static: isStaticScene,
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
  };
  const textures = Object.fromEntries((Object.keys(CAPTURE_NAME) as TexName[])
    .filter((n) => !n.endsWith('Ref')).map((n) => [CAPTURE_NAME[n], t[n]]));
  return {
    index, reset, manifest, guides, camera,
    inputs: {
      diffuse: { radiance: t.diffuse, hitDistance: t.diffuseHitT },
      specular: { radiance: t.specular, hitDistance: t.specularHitT },
      visibility: { visibility: t.visibility, hitDistance: t.occluderDist },
      ao: { hitDistance: t.diffuseHitT }, so: { hitDistance: t.specularHitT },
    },
    textures,
    ...(meta ? { meta } : {}),
  };
}

export type { SignalName };
