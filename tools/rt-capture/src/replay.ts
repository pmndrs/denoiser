// Replay a capture (CAPTURE-FORMAT v0) through any TemporalDenoiser, exactly like the
// native harness does on Windows: per frame, upload the buffers, build the FrameCamera
// from the manifest, resetHistory() on `reset` frames, dispatch, read back, and write
// outputs/<capture>/<denoiser>/frame_NNNN/<signal>.f32 + run.json + timings.csv.
//
//   import { replay } from '../../tools/rt-capture/src/replay';
//   import { DENOISERS } from '../../tools/rt-capture/src/denoisers';
//   const result = await replay(device, { capture: 'synthetic-plane', denoiser: DENOISERS.get('accumulate')! });
//
// Upload formats: depth r32float, viewz/roughness/hitt/visibility/occluder_dist/motion_z
// r32float, motion rg32float, 3-channel buffers rgba32float (a = 1). All are
// TEXTURE_BINDING | COPY_DST | COPY_SRC, read via textureLoad (unfilterable-float).
import type {
  DiffuseInputs, FrameCamera, FrameGuides, ShadowInputs, SpecularInputs,
} from '../../../packages/denoiser-core/src/temporal';
import { readTextures } from './gpu-readback';
import {
  CaptureClient, SIGNALS, frameDir, toFrameCamera,
  type CaptureFrame, type CaptureManifest, type SignalName,
} from './format';

/** Guides as the replay fills them: FrameGuides plus the optional 2.5D extras. */
export type ReplayGuides = FrameGuides & { viewZ?: GPUTexture; motionZ?: GPUTexture };

/** What a replay denoiser sees each frame. */
export interface ReplayFrame {
  index: number;
  reset: boolean;
  manifest: CaptureManifest;
  guides: ReplayGuides;
  camera: FrameCamera;
  /** Per-signal inputs in the TemporalDenoiser API shapes (present signals only). */
  inputs: { diffuse?: DiffuseInputs; specular?: SpecularInputs; visibility?: ShadowInputs };
  /** Every uploaded buffer by capture name (e.g. `diffuse_ref`, `albedo`, `f0`). */
  textures: Record<string, GPUTexture>;
  /** The manifest's frame entry, incl. extra keys (e.g. the test bed's per-frame `lights`). */
  meta?: CaptureFrame;
}

/** A configured denoiser instance for one replay (may wrap several TemporalDenoisers). */
export interface ReplayDenoiser {
  /** Signals this instance writes. */
  readonly signals: readonly SignalName[];
  /** Dispatch one frame; returns one output texture per signal (rgb or .r). */
  dispatch(frame: ReplayFrame): Partial<Record<SignalName, GPUTexture>>;
  resetHistory(): void;
  /** Per-pass GPU ms of the last measured frame, keyed `<signal>/<pass>` or `<pass>`. */
  gpuTimings?(): Map<string, number>;
  dispose(): void;
}

export interface DenoiserEntry {
  /** Output folder name, e.g. `accumulate`, `ffx-shadows`. */
  id: string;
  description: string;
  /** Signals it can denoise (the replay intersects this with what the capture has). */
  signals: readonly SignalName[];
  version?: string;
  create(device: GPUDevice, ctx: { width: number; height: number; signals: SignalName[]; settings: Record<string, string> }): ReplayDenoiser;
}

export interface ReplayOptions {
  /** Capture name under captures/. */
  capture: string;
  denoiser: DenoiserEntry;
  /** Restrict to these signals (default: all the denoiser supports that the capture has). */
  signals?: SignalName[];
  /** Free-form settings passed to the denoiser and recorded in run.json. */
  settings?: Record<string, string>;
  /** Output folder name (default denoiser.id). */
  outputName?: string;
  /** Write outputs to the server (default true). */
  write?: boolean;
  /** Replay only the first N frames. */
  maxFrames?: number;
  /** Plugin endpoint (default '/__rt-capture'). */
  endpoint?: string;
  /** Progress callback. */
  onFrame?(index: number, outputs: Partial<Record<SignalName, GPUTexture>>, frame: ReplayFrame): void | Promise<void>;
}

export interface TimingRow { frame: number; pass: string; ms: number }

export interface ReplayResult {
  capture: string;
  denoiser: string;
  outputDir: string;
  signals: SignalName[];
  frames: number;
  timings: TimingRow[];
  run: Record<string, unknown>;
}

const SIGNAL_CH: Record<SignalName, number> = { diffuse: 3, specular: 3, visibility: 1 };

const formatFor = (ch: number): GPUTextureFormat => (ch === 1 ? 'r32float' : ch === 2 ? 'rg32float' : 'rgba32float');

/** Load a capture's manifest. */
export async function loadManifest(capture: string, client = new CaptureClient()): Promise<CaptureManifest> {
  const m = await client.getJson<CaptureManifest>(`captures/${capture}/capture.json`);
  if (m.version !== 0) throw new Error(`capture ${capture}: version ${m.version}, this replay reads v0`);
  return m;
}

/**
 * Uploads a capture's buffers into textures that persist across frames (as a renderer's
 * G-buffer would). `load(frame)` fetches and uploads one frame.
 */
export class CaptureTextures {
  readonly textures: Record<string, GPUTexture> = {};
  constructor(readonly device: GPUDevice, readonly manifest: CaptureManifest, readonly name: string, readonly client = new CaptureClient()) {
    const { width, height } = manifest;
    for (const { name: b, channels } of manifest.buffers) {
      this.textures[b] = device.createTexture({
        label: `capture ${b}`, size: [width, height], format: formatFor(channels),
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC,
      });
    }
  }

  async load(frame: number): Promise<void> {
    const { width: W, height: H } = this.manifest;
    const N = W * H;
    await Promise.all(this.manifest.buffers.map(async ({ name, channels }) => {
      const data = await this.client.getF32(`captures/${this.name}/${frameDir(frame)}/${name}.f32`, N * channels);
      let up = data;
      if (channels === 3) { // rgb -> rgba (a = 1)
        up = new Float32Array(N * 4);
        for (let i = 0; i < N; i++) { up[4 * i] = data[3 * i]; up[4 * i + 1] = data[3 * i + 1]; up[4 * i + 2] = data[3 * i + 2]; up[4 * i + 3] = 1; }
      }
      const tc = channels === 3 ? 4 : channels;
      this.device.queue.writeTexture({ texture: this.textures[name] }, up as Float32Array<ArrayBuffer>, { bytesPerRow: W * tc * 4, rowsPerImage: H }, [W, H]);
    }));
  }

  /** Build the per-frame denoiser view of the uploaded textures. */
  frame(f: CaptureFrame): ReplayFrame {
    const t = this.textures;
    const m = this.manifest;
    if (!t.depth || !t.normal || !t.motion) throw new Error('capture lacks depth/normal/motion');
    const guides: ReplayGuides = {
      depth: t.depth, normal: t.normal, motion: t.motion,
      ...(t.roughness ? { roughness: t.roughness } : {}),
      ...(t.albedo ? { albedo: t.albedo } : {}),
      ...(t.viewz ? { viewZ: t.viewz } : {}),
      ...(t.motion_z ? { motionZ: t.motion_z } : {}),
    };
    const inputs: ReplayFrame['inputs'] = {};
    if (t.diffuse) inputs.diffuse = { radiance: t.diffuse, ...(t.diffuse_hitt ? { hitDistance: t.diffuse_hitt } : {}) };
    if (t.specular) inputs.specular = { radiance: t.specular, hitDistance: t.specular_hitt ?? zeroTexture(this.device, m.width, m.height) };
    if (t.visibility) inputs.visibility = { visibility: t.visibility, ...(t.occluder_dist ? { hitDistance: t.occluder_dist } : {}) };
    return { index: f.index, reset: f.reset, manifest: m, guides, camera: toFrameCamera(m, f), inputs, textures: t, meta: f };
  }

  dispose() { for (const t of Object.values(this.textures)) t.destroy(); }
}

let zeroTex: GPUTexture | undefined;
function zeroTexture(device: GPUDevice, w: number, h: number) {
  if (!zeroTex || zeroTex.width !== w || zeroTex.height !== h) {
    zeroTex = device.createTexture({ label: 'zero', size: [w, h], format: 'r32float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  }
  return zeroTex;
}

const nextTask = () => new Promise((r) => setTimeout(r, 0));

/** Replay a capture through a denoiser and (by default) write its outputs. */
export async function replay(device: GPUDevice, opts: ReplayOptions): Promise<ReplayResult> {
  const client = new CaptureClient(opts.endpoint);
  const manifest = await loadManifest(opts.capture, client);
  const { width, height } = manifest;
  const have = SIGNALS.filter((s) => manifest.buffers.some((b) => b.name === s));
  const signals = (opts.signals ?? [...opts.denoiser.signals]).filter((s) => have.includes(s) && opts.denoiser.signals.includes(s));
  if (!signals.length) throw new Error(`denoiser ${opts.denoiser.id} supports [${opts.denoiser.signals}], capture has [${have}]`);
  const settings = opts.settings ?? {};
  const outName = opts.outputName ?? opts.denoiser.id;
  const outDir = `outputs/${opts.capture}/${outName}`;
  const write = opts.write ?? true;
  const frames = manifest.frames.slice(0, opts.maxFrames ?? manifest.frames.length);

  const caps = new CaptureTextures(device, manifest, opts.capture, client);
  const den = opts.denoiser.create(device, { width, height, signals, settings });
  if (write) await client.rm(outDir);
  const timings: TimingRow[] = [];
  const uploads: Promise<void>[] = [];
  try {
    for (const f of frames) {
      await caps.load(f.index);
      const frame = caps.frame(f);
      if (f.reset) den.resetHistory();
      await device.queue.onSubmittedWorkDone();
      const t0 = performance.now();
      const out = den.dispatch(frame);
      await device.queue.onSubmittedWorkDone();
      timings.push({ frame: f.index, pass: 'wall', ms: performance.now() - t0 });
      await nextTask(); // let timestamp-query maps land
      for (const [pass, ms] of den.gpuTimings?.() ?? []) timings.push({ frame: f.index, pass, ms });
      const list = signals.filter((s) => out[s]);
      for (const s of signals) if (!out[s]) throw new Error(`denoiser ${opts.denoiser.id} returned no ${s} output at frame ${f.index}`);
      const data = await readTextures(device, list.map((s) => ({ texture: out[s]!, channels: SIGNAL_CH[s] })));
      if (write) list.forEach((s, i) => uploads.push(client.put(`${outDir}/${frameDir(f.index)}/${s}.f32`, data[i].buffer as ArrayBuffer)));
      if (uploads.length > 48) await Promise.all(uploads.splice(0));
      await opts.onFrame?.(f.index, out, frame);
    }
    await Promise.all(uploads);
  } finally {
    den.dispose();
    caps.dispose();
  }

  const info = await client.info().catch(() => ({ commit: null, dirty: null, root: '' }));
  const adapterInfo = (device as GPUDevice & { adapterInfo?: GPUAdapterInfo }).adapterInfo;
  const run = {
    capture: opts.capture,
    denoiser: opts.denoiser.id,
    output: outName,
    description: opts.denoiser.description,
    version: opts.denoiser.version ?? null,
    commit: info.commit, dirty: info.dirty,
    settings,
    signals,
    frames: frames.length,
    width, height,
    gpu: adapterInfo ? { vendor: adapterInfo.vendor, architecture: adapterInfo.architecture, device: adapterInfo.device, description: adapterInfo.description } : null,
    driver: null,
    os: navigator.userAgent,
    runner: 'tools/rt-capture replay (WebGPU, browser)',
    date: new Date().toISOString(),
  };
  if (write) {
    await client.put(`${outDir}/run.json`, JSON.stringify(run, null, 1));
    await client.put(`${outDir}/timings.csv`, 'frame,pass,ms\n' + timings.map((t) => `${t.frame},${t.pass},${t.ms.toFixed(4)}`).join('\n') + '\n');
  }
  return { capture: opts.capture, denoiser: opts.denoiser.id, outputDir: outDir, signals, frames: frames.length, timings, run };
}
