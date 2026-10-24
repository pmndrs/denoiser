// Capture format v0 types and the dev-server client (see vite-plugin.ts).
// Spec: docs/research/rt-denoiser/CAPTURE-FORMAT.md
import type { FrameCamera } from '../../../packages/denoiser-core/src/temporal';

/** Known v0 buffers and their channel counts. */
export const BUFFER_CHANNELS = {
  depth: 1, viewz: 1, normal: 3, roughness: 1, motion: 2, motion_z: 1,
  albedo: 3, f0: 3,
  diffuse: 3, diffuse_hitt: 1, diffuse_ref: 3,
  specular: 3, specular_hitt: 1, specular_ref: 3,
  visibility: 1, occluder_dist: 1, visibility_ref: 1,
} as const;
export type BufferName = keyof typeof BUFFER_CHANNELS;

/** Noisy signals a denoiser replaces (output name = input name). */
export const SIGNALS = ['diffuse', 'specular', 'visibility'] as const;
/**
 * Derived signals (T5, occlusion): no buffer of their own, computed from `diffuse_hitt` /
 * `specular_hitt` at replay time (AO / SO = normalized hit distance, SPEC F-3). A capture
 * "has" one when it has that hit-distance buffer; there is no reference buffer for them.
 */
export const DERIVED_SIGNALS = { ao: 'diffuse_hitt', so: 'specular_hitt' } as const;
export type SignalName = (typeof SIGNALS)[number] | keyof typeof DERIVED_SIGNALS;

export interface CaptureCamera {
  view: number[]; projection: number[]; prevView: number[]; prevProjection: number[];
  jitter: [number, number]; near: number; far: number; position?: [number, number, number];
}
export interface CaptureFrame { index: number; reset: boolean; camera: CaptureCamera; [extra: string]: unknown }
export interface CaptureLight {
  id: string; type: 'sphere' | 'directional' | string; shadow?: boolean;
  position?: [number, number, number]; radius?: number;
  direction?: [number, number, number]; angularRadius?: number;
  color?: [number, number, number]; intensity?: number;
}
export interface CaptureManifest {
  version: 0;
  scene: string;
  generator?: string;
  width: number; height: number;
  reversedDepth: boolean;
  static?: boolean;
  demodulation?: { diffuse?: string; specular?: string };
  lights: CaptureLight[];
  buffers: { name: string; channels: number }[];
  referenceSpp: number;
  frames: CaptureFrame[];
  [extra: string]: unknown;
}

export const frameDir = (i: number) => `frame_${String(i).padStart(4, '0')}`;

/** Manifest camera -> the TemporalDenoiser API's FrameCamera. */
export function toFrameCamera(m: CaptureManifest, f: CaptureFrame): FrameCamera {
  const c = f.camera;
  return {
    view: new Float32Array(c.view), projection: new Float32Array(c.projection),
    prevView: new Float32Array(c.prevView), prevProjection: new Float32Array(c.prevProjection),
    jitter: c.jitter ?? [0, 0], near: c.near, far: c.far, position: c.position,
    reversedDepth: !!m.reversedDepth,
  };
}

/** FrameCamera -> manifest camera (plain arrays). */
export function fromFrameCamera(c: FrameCamera): CaptureCamera {
  return {
    view: Array.from(c.view), projection: Array.from(c.projection),
    prevView: Array.from(c.prevView), prevProjection: Array.from(c.prevProjection),
    jitter: [c.jitter?.[0] ?? 0, c.jitter?.[1] ?? 0], near: c.near, far: c.far,
    ...(c.position ? { position: [c.position[0], c.position[1], c.position[2]] as [number, number, number] } : {}),
  };
}

/** JSON with numeric arrays on one line (matrices stay readable). */
export function stringifyManifest(m: unknown): string {
  return JSON.stringify(m, (_k, v) => (Array.isArray(v) && v.every((x) => typeof x === 'number') ? `@@${JSON.stringify(v)}@@` : v), 1)
    .replace(/"@@(\[[^"]*\])@@"/g, '$1');
}

// ---- dev-server client ------------------------------------------------------------

export class CaptureClient {
  constructor(readonly endpoint = '/__rt-capture') {}

  private async ok(r: Response, what: string) {
    if (!r.ok) throw new Error(`${what}: HTTP ${r.status} ${await r.text().catch(() => '')}`);
    return r;
  }
  async put(rel: string, body: BodyInit): Promise<void> {
    await this.ok(await fetch(`${this.endpoint}/put?path=${encodeURIComponent(rel)}`, { method: 'POST', body }), `put ${rel}`);
  }
  async rm(rel: string): Promise<void> {
    await this.ok(await fetch(`${this.endpoint}/rm?path=${encodeURIComponent(rel)}`, { method: 'POST' }), `rm ${rel}`);
  }
  url(rel: string) { return `${this.endpoint}/files/${rel.split('/').map(encodeURIComponent).join('/')}`; }
  async getBytes(rel: string): Promise<ArrayBuffer> {
    return (await this.ok(await fetch(this.url(rel)), `get ${rel}`)).arrayBuffer();
  }
  async getF32(rel: string, expectedFloats?: number): Promise<Float32Array> {
    const b = await this.getBytes(rel);
    if (expectedFloats !== undefined && b.byteLength !== expectedFloats * 4) {
      throw new Error(`${rel}: ${b.byteLength} bytes, expected ${expectedFloats * 4}`);
    }
    return new Float32Array(b);
  }
  async getJson<T = unknown>(rel: string): Promise<T> {
    return (await this.ok(await fetch(this.url(rel)), `get ${rel}`)).json();
  }
  async list(rel = 'captures'): Promise<{ name: string; dir: boolean }[]> {
    return (await this.ok(await fetch(`${this.endpoint}/list?path=${encodeURIComponent(rel)}`), `list ${rel}`)).json();
  }
  async info(): Promise<{ root: string; commit: string | null; dirty: boolean | null }> {
    return (await this.ok(await fetch(`${this.endpoint}/info`), 'info')).json();
  }
}
