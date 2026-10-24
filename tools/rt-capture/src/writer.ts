// Browser-side capture writer (CAPTURE-FORMAT v0): reads GPU textures back to f32 and
// POSTs them to the rt-capture Vite plugin, which writes captures/<name>/.
//
//   const w = new CaptureWriter(device, 'room-pan');
//   await w.begin({ scene: 'analytic-room', width, height, lights, referenceSpp: 256, static: false });
//   for each frame:
//     await w.writeFrame({ reset, camera }, { depth, viewz, normal, roughness, motion, motion_z,
//                                             albedo, f0, diffuse, diffuse_ref, ... });   // GPUTexture | Float32Array
//   await w.finish();   // writes capture.json
//
// Textures need TEXTURE_BINDING; any float color format or depth format works (see
// gpu-readback.ts). Channel counts come from the v0 table; unknown names pass
// { texture | data, channels }.
import type { FrameCamera } from '../../../packages/denoiser-core/src/temporal';
import { readTextures } from './gpu-readback';
import {
  BUFFER_CHANNELS, CaptureClient, fromFrameCamera, frameDir, stringifyManifest,
  type CaptureCamera, type CaptureFrame, type CaptureLight, type CaptureManifest,
} from './format';

export type CaptureBufferSource = GPUTexture | Float32Array | { texture: GPUTexture; channels: number } | { data: Float32Array; channels: number };

export interface CaptureMeta {
  scene: string;
  width: number;
  height: number;
  lights?: CaptureLight[];
  referenceSpp?: number;
  reversedDepth?: boolean;
  /** No object motion (lets the validator check motion strictly). Default false. */
  static?: boolean;
  generator?: string;
  demodulation?: CaptureManifest['demodulation'];
  /** Extra manifest keys (ignored by v0 readers). */
  extra?: Record<string, unknown>;
}

export interface CaptureWriterOptions {
  /** Plugin endpoint (default '/__rt-capture'). */
  endpoint?: string;
}

export class CaptureWriter {
  readonly client: CaptureClient;
  private meta?: CaptureMeta;
  private frames: CaptureFrame[] = [];
  private buffers?: Map<string, number>;
  private pending: Promise<unknown>[] = [];

  constructor(readonly device: GPUDevice, readonly name: string, options: CaptureWriterOptions = {}) {
    if (!/^[\w.-]+$/.test(name)) throw new Error(`CaptureWriter: bad capture name "${name}"`);
    this.client = new CaptureClient(options.endpoint);
  }

  get path() { return `captures/${this.name}`; }
  get frameCount() { return this.frames.length; }

  /** Start a capture: deletes any existing captures/<name>/. */
  async begin(meta: CaptureMeta): Promise<void> {
    this.meta = meta;
    this.frames = [];
    this.buffers = undefined;
    await this.client.rm(this.path);
  }

  /**
   * Read back and upload one frame. `frame.index` defaults to the next index; frame 0 is
   * always written with reset: true. Uploads overlap with the next frame's rendering;
   * the readback itself is awaited (so the caller may overwrite the textures afterwards).
   */
  async writeFrame(
    frame: { index?: number; reset?: boolean; camera: CaptureCamera | FrameCamera },
    buffers: Record<string, CaptureBufferSource>,
  ): Promise<void> {
    const meta = this.meta;
    if (!meta) throw new Error('CaptureWriter: call begin() first');
    const index = frame.index ?? this.frames.length;
    if (index !== this.frames.length) throw new Error(`CaptureWriter: frames must be consecutive (expected ${this.frames.length}, got ${index})`);
    const N = meta.width * meta.height;
    const names = Object.keys(buffers);
    const entries = names.map((name) => {
      const src = buffers[name];
      const known = (BUFFER_CHANNELS as Record<string, number>)[name];
      const channels = 'channels' in src && typeof src.channels === 'number' ? src.channels : known;
      if (!channels) throw new Error(`CaptureWriter: unknown buffer "${name}" needs { texture | data, channels }`);
      if (known && channels !== known) throw new Error(`CaptureWriter: ${name} has ${known} channels in v0 (got ${channels})`);
      return { name, channels, src };
    });
    // the buffer set is fixed by frame 0
    if (!this.buffers) this.buffers = new Map(entries.map((e) => [e.name, e.channels]));
    else {
      const want = [...this.buffers.keys()].sort().join(',');
      const got = names.slice().sort().join(',');
      if (want !== got) throw new Error(`CaptureWriter: frame ${index} buffers [${got}] differ from frame 0 [${want}]`);
    }
    const gpu = entries.filter((e) => e.src instanceof GPUTexture || 'texture' in e.src);
    const texOf = (s: CaptureBufferSource) => (s instanceof GPUTexture ? s : (s as { texture: GPUTexture }).texture);
    for (const e of gpu) {
      const t = texOf(e.src);
      if (t.width !== meta.width || t.height !== meta.height) throw new Error(`CaptureWriter: ${e.name} is ${t.width}x${t.height}, capture is ${meta.width}x${meta.height}`);
    }
    const read = await readTextures(this.device, gpu.map((e) => ({ texture: texOf(e.src), channels: e.channels })));
    const data = new Map<string, Float32Array>(gpu.map((e, i) => [e.name, read[i]]));
    for (const e of entries) {
      if (data.has(e.name)) continue;
      const d = e.src instanceof Float32Array ? e.src : (e.src as { data: Float32Array }).data;
      data.set(e.name, d);
    }
    for (const [name, d] of data) {
      if (d.length !== N * this.buffers.get(name)!) throw new Error(`CaptureWriter: ${name} has ${d.length} floats, expected ${N * this.buffers.get(name)!}`);
    }
    const camera = fromFrameCamera(frame.camera as FrameCamera); // also normalizes a CaptureCamera
    this.frames.push({ index, reset: index === 0 || !!frame.reset, camera });
    const dir = `${this.path}/${frameDir(index)}`;
    // keep at most a few frames of uploads in flight
    this.pending.push(...[...data].map(([name, d]) => this.client.put(`${dir}/${name}.f32`, d.slice().buffer as ArrayBuffer)));
    if (this.pending.length > 64) { await Promise.all(this.pending); this.pending = []; }
  }

  /** Wait for uploads and write capture.json. */
  async finish(): Promise<{ path: string; frames: number; manifest: CaptureManifest }> {
    const meta = this.meta;
    if (!meta || !this.buffers) throw new Error('CaptureWriter: nothing written');
    await Promise.all(this.pending);
    this.pending = [];
    const manifest: CaptureManifest = {
      version: 0,
      scene: meta.scene,
      ...(meta.generator ? { generator: meta.generator } : {}),
      width: meta.width, height: meta.height,
      reversedDepth: !!meta.reversedDepth,
      static: !!meta.static,
      demodulation: meta.demodulation ?? { diffuse: 'albedo', specular: 'karis2014-envbrdf-approx' },
      lights: meta.lights ?? [],
      buffers: [...this.buffers].map(([name, channels]) => ({ name, channels })),
      referenceSpp: meta.referenceSpp ?? 0,
      frames: this.frames,
      ...(meta.extra ?? {}),
    };
    await this.client.put(`${this.path}/capture.json`, stringifyManifest(manifest));
    return { path: this.path, frames: this.frames.length, manifest };
  }
}
