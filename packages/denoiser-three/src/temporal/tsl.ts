// TSL helpers shared by the temporal node factories: turning arbitrary nodes
// into the textures the GPU denoisers bind, normal-space conversion, and a NaN
// guard for radiance.
import { convertToTexture, float, select, uniform, vec3, vec4 } from 'three/tsl';
import { Matrix4 } from 'three/webgpu';
import type { Camera } from 'three/webgpu';
import type { TextureNodeLike } from './TemporalDenoiseNode';

export type NormalSpace = 'world' | 'view';
export type NormalEncoding = 'signed' | 'packed';

/**
 * A node that is a texture (pass / RTT / texture node) is used as is; anything
 * else is rendered into a half-float texture with `convertToTexture` after
 * `wrap` shapes it into a vec4. `force` renders even texture nodes (to change
 * their channel layout). `resolutionScale` must match the scene pass's.
 */
export function toSignalTexture(
  node: TextureNodeLike,
  resolutionScale: number,
  wrap: (n: TextureNodeLike) => TextureNodeLike,
  opts: { force?: boolean } = {},
): TextureNodeLike {
  if (node?.isTextureNode && !opts.force) return node;
  const rtt = convertToTexture(wrap(node));
  rtt.setResolutionScale?.(resolutionScale);
  return rtt;
}

/** 0 for NaN / negative / overflowing values (FFX needs finite, non-negative inputs). */
export const finite1 = (c: TextureNodeLike): TextureNodeLike =>
  select(c.greaterThanEqual(0).and(c.lessThan(6e4)), c, float(0));
export const finite3 = (v: TextureNodeLike): TextureNodeLike => vec3(finite1(v.x), finite1(v.y), finite1(v.z));

/**
 * A `uniform` mat4 holding `camera.matrixWorld`, refreshed every frame. (The
 * built-in `cameraWorldMatrix` would resolve to the full-screen quad's camera
 * inside RTT passes.)
 */
export function cameraWorldMatrixNode(camera: Camera): TextureNodeLike {
  const m = uniform(new Matrix4());
  m.onFrameUpdate(() => { camera.updateMatrixWorld(); m.value.copy(camera.matrixWorld); });
  return m;
}

/**
 * Normals as a texture of world-space unit vectors in [-1, 1]. A texture node
 * that already is world/signed passes through untouched; otherwise it is decoded
 * and rotated into world space in an RTT pass.
 */
export function worldNormalTexture(
  normal: TextureNodeLike,
  o: { camera: Camera; normalSpace?: NormalSpace; normalEncoding?: NormalEncoding; resolutionScale?: number },
): TextureNodeLike {
  const space = o.normalSpace ?? 'world';
  const enc = o.normalEncoding ?? 'signed';
  if (normal?.isTextureNode && space === 'world' && enc === 'signed') return normal;
  let n = normal.xyz;
  if (enc === 'packed') n = n.mul(2).sub(1);
  if (space === 'view') n = cameraWorldMatrixNode(o.camera).mul(vec4(n, 0)).xyz;
  const rtt = convertToTexture(vec4(n.normalize(), 1));
  rtt.setResolutionScale?.(o.resolutionScale ?? 1);
  return rtt;
}
