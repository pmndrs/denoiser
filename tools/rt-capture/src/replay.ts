// Replay a capture (CAPTURE-FORMAT v0 / v1) through any TemporalDenoiser, exactly like the
// native harness does on Windows: per frame, upload the buffers, build the FrameCamera
// from the manifest, resetHistory() on `reset` frames, dispatch, read back, and write
// outputs/<capture>/<denoiser>/frame_NNNN/<signal>.f32 + run.json + timings.csv.
//
//   import { replay } from '../../tools/rt-capture/src/replay';
//   import { DENOISERS } from '../../tools/rt-capture/src/denoisers';
//   const result = await replay(device, { capture: 'synthetic-plane', denoiser: DENOISERS.get('accumulate')! });
//
// Upload formats: depth r32float, viewz/roughness/hitt/visibility/occluder_dist/motion_z
// r32float, motion rg32float, 3-channel buffers rgba32float (a = 1); a buffer with more than 4
// channels (v1 `*_sh_ref`, 6) is split: `textures[name]` holds channels 0-3, `textures[name + '#4']`
// channels 4.. (rgba32float, missing channels 0, a = 1). All are TEXTURE_BINDING | COPY_DST | COPY_SRC,
// read via textureLoad (unfilterable-float).
//
// v1 signals (CAPTURE-FORMAT v1): `sh-diffuse` / `sh-specular` get the raw-form SH input (radiance +
// the sampled ray's direction, SPEC M7-4) and `shadow-rgb` the translucent-shadow inputs (SPEC M8-8);
// `guides.geometricNormal` is `normal_geom` (`shGuides()` swaps it in as the filter normal).
import type {
  DiffuseInputs, FrameCamera, FrameGuides, ShadowInputs, SpecularInputs,
} from '../../../packages/denoiser-core/src/temporal';
import { readTextures } from './gpu-readback';
import {
  CaptureClient, DERIVED_SIGNALS, SIGNALS, V1_SIGNALS, frameDir, toFrameCamera,
  type CaptureFrame, type CaptureManifest, type SignalName,
} from './format';

/**
 * Guides as the replay fills them: FrameGuides plus the optional 2.5D extras, and (v1) the smooth
 * geometric normal. `normal` is always the capture's `normal`: the shading (detail) normal the rays were
 * sampled around; `geometricNormal` = `normal_geom` (equal to `normal` where there is no normal map).
 */
export type ReplayGuides = FrameGuides & { viewZ?: GPUTexture; motionZ?: GPUTexture; geometricNormal?: GPUTexture };

/** v1 raw-form SH input (SPEC M7-4): the plain demodulated radiance + the world-space unit direction of its ray. */
export interface ShInputs { radiance: GPUTexture; direction: GPUTexture; hitDistance?: GPUTexture }
/**
 * v1 translucent-shadow input (SPEC M8-1 / M8-8 names): opaque `visibility` + `hitDistance` as before, rgb
 * `translucency` T (ignored where v = 0) and the nearest translucent layer's distance. Two derived
 * conveniences for baselines: `radiance` = the 1-ray v·T (rgb) and `visibilityLumT` = v·lum709(T) (.r).
 */
export interface TranslucentShadowInputs extends ShadowInputs {
  translucency: GPUTexture;
  translucencyHitDistance?: GPUTexture;
  radiance: GPUTexture;
  visibilityLumT: GPUTexture;
}

/**
 * Guides for a directional (SH) denoiser: the filter normal becomes the smooth `geometricNormal` and the
 * shading normal moves to `detailNormal` (SPEC M7-4). Without `geometricNormal` both are `normal`.
 */
export function shGuides(frame: ReplayFrame): ReplayGuides & { detailNormal: GPUTexture } {
  const g = frame.guides;
  return { ...g, normal: g.geometricNormal ?? g.normal, detailNormal: g.normal };
}

/** What a replay denoiser sees each frame. */
export interface ReplayFrame {
  index: number;
  reset: boolean;
  manifest: CaptureManifest;
  guides: ReplayGuides;
  camera: FrameCamera;
  /** Per-signal inputs in the TemporalDenoiser API shapes (present signals only). */
  inputs: {
    diffuse?: DiffuseInputs; specular?: SpecularInputs; visibility?: ShadowInputs;
    /** Derived occlusion signals (DERIVED_SIGNALS): the raw hit distance of the diffuse / specular ray. */
    ao?: { hitDistance: GPUTexture }; so?: { hitDistance: GPUTexture };
    /** v1 signals (V1_SIGNALS). */
    'sh-diffuse'?: ShInputs; 'sh-specular'?: ShInputs; 'shadow-rgb'?: TranslucentShadowInputs;
  };
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
  /**
   * Offline per-frame denoisers (e.g. OIDN: async, one image per call, no history): when
   * present, replay() awaits this INSTEAD of dispatch() before the readback. Denoisers that
   * have it are replay-only (the test bed's live loop calls dispatch(), which they make throw).
   * Synchronous TemporalDenoisers leave it undefined, so their path is unchanged.
   */
  dispatchAsync?(frame: ReplayFrame): Promise<Partial<Record<SignalName, GPUTexture>>>;
  /** Extra facts for run.json (`denoiserInfo`), read after the last frame (e.g. which model ran). */
  info?(): Record<string, unknown>;
  /**
   * @internal Diagnostics: internal textures of the last dispatch by name (e.g. `visibility/history`: the shadow
   * history v, g, A, n_g; `diffuse/history`: recurrent H with ĥ in .a; `diffuse/accum`: SVGF's history). Read by
   * probes (examples/realtime-denoiser distance probe); valid until the next dispatch.
   */
  inspect?(): Record<string, GPUTexture | undefined>;
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
  /** Replay-only offline denoiser (its ReplayDenoiser implements dispatchAsync); the GPU warm-up defaults to 0. */
  offline?: boolean;
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
  /**
   * Keep the GPU busy for this many ms right before each timed dispatch (default 50; 0 =
   * off). Between replay frames the GPU idles (uploads, readbacks) and clocks down; without
   * this, timestamps on Apple M-series read 4-9x the live test bed's.
   */
  warmMs?: number;
  /** Progress callback. */
  onFrame?(index: number, outputs: Partial<Record<SignalName, GPUTexture>>, frame: ReplayFrame,
    inspect?: Record<string, GPUTexture | undefined>): void | Promise<void>;
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

const SIGNAL_CH: Record<SignalName, number> = { diffuse: 3, specular: 3, visibility: 1, ao: 1, so: 1, 'sh-diffuse': 3, 'sh-specular': 3, 'shadow-rgb': 3 };

const formatFor = (ch: number): GPUTextureFormat => (ch === 1 ? 'r32float' : ch === 2 ? 'rg32float' : 'rgba32float');
const rgba = (data: Float32Array, N: number) => { // rgb -> rgba (a = 1)
  const up = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) { up[4 * i] = data[3 * i]; up[4 * i + 1] = data[3 * i + 1]; up[4 * i + 2] = data[3 * i + 2]; up[4 * i + 3] = 1; }
  return up;
};

/** Load a capture's manifest. */
export async function loadManifest(capture: string, client = new CaptureClient()): Promise<CaptureManifest> {
  const m = await client.getJson<CaptureManifest>(`captures/${capture}/capture.json`);
  if (m.version !== 0 && m.version !== 1) throw new Error(`capture ${capture}: version ${m.version}, this replay reads v0 and v1`);
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
    const make = (b: string, ch: number) => device.createTexture({
      label: `capture ${b}`, size: [width, height], format: formatFor(ch),
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC,
    });
    for (const { name: b, channels } of manifest.buffers) {
      if (channels <= 4) { this.textures[b] = make(b, channels); continue; }
      for (let c0 = 0; c0 < channels; c0 += 4) this.textures[c0 ? `${b}#${c0}` : b] = make(b, 4);
    }
    // v1 shadow-rgb conveniences, derived on load: v·T (rgb) and v·lum709(T) (.r)
    if (this.has('visibility') && this.has('transmittance')) {
      this.textures.shadow_rgb = make('shadow_rgb', 3);
      this.textures.visibility_lumt = make('visibility_lumt', 1);
    }
  }

  private has(name: string) { return this.manifest.buffers.some((b) => b.name === name); }

  async load(frame: number): Promise<void> {
    const { width: W, height: H } = this.manifest;
    const N = W * H;
    const loaded = new Map<string, Float32Array>();
    await Promise.all(this.manifest.buffers.map(async ({ name, channels }) => {
      const data = await this.client.getF32(`captures/${this.name}/${frameDir(frame)}/${name}.f32`, N * channels);
      if (channels > 4) { // split into rgba32float parts of 4 channels (missing channels 0, a = 1)
        for (let c0 = 0; c0 < channels; c0 += 4) {
          const up = new Float32Array(N * 4);
          for (let i = 0; i < N; i++) for (let c = 0; c < 4; c++) up[4 * i + c] = c0 + c < channels ? data[channels * i + c0 + c] : c === 3 ? 1 : 0;
          this.write(c0 ? `${name}#${c0}` : name, up, 4);
        }
        return;
      }
      let up = data;
      if (channels === 3) up = rgba(data, N);
      if (name === 'visibility' || name === 'transmittance') loaded.set(name, data);
      this.write(name, up, channels === 3 ? 4 : channels);
    }));
    const v = loaded.get('visibility'), t = loaded.get('transmittance');
    if (v && t && this.textures.shadow_rgb) {
      // same arithmetic as the test bed's live `translucency` entry: v * T, and v * dot(T, lum709) in f32
      const rgb = new Float32Array(N * 3), lt = new Float32Array(N);
      const f = Math.fround;
      for (let i = 0; i < N; i++) {
        for (let c = 0; c < 3; c++) rgb[3 * i + c] = f(v[i] * t[3 * i + c]);
        lt[i] = f(v[i] * f(f(f(t[3 * i] * f(0.2126)) + f(t[3 * i + 1] * f(0.7152))) + f(t[3 * i + 2] * f(0.0722))));
      }
      this.write('shadow_rgb', rgba(rgb, N), 4);
      this.write('visibility_lumt', lt, 1);
    }
  }

  private write(name: string, data: Float32Array, tc: number) {
    const { width: W, height: H } = this.manifest;
    this.device.queue.writeTexture({ texture: this.textures[name] }, data as Float32Array<ArrayBuffer>, { bytesPerRow: W * tc * 4, rowsPerImage: H }, [W, H]);
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
      ...(t.normal_geom ? { geometricNormal: t.normal_geom } : {}),
    };
    const inputs: ReplayFrame['inputs'] = {};
    if (t.diffuse) inputs.diffuse = { radiance: t.diffuse, ...(t.diffuse_hitt ? { hitDistance: t.diffuse_hitt } : {}) };
    if (t.specular) inputs.specular = { radiance: t.specular, hitDistance: t.specular_hitt ?? zeroTexture(this.device, m.width, m.height) };
    if (t.visibility) inputs.visibility = { visibility: t.visibility, ...(t.occluder_dist ? { hitDistance: t.occluder_dist } : {}) };
    if (t.diffuse_hitt) inputs.ao = { hitDistance: t.diffuse_hitt };
    if (t.specular_hitt) inputs.so = { hitDistance: t.specular_hitt };
    // v1 signals
    if (t.diffuse && t.diffuse_dir) inputs['sh-diffuse'] = { radiance: t.diffuse, direction: t.diffuse_dir, ...(t.diffuse_hitt ? { hitDistance: t.diffuse_hitt } : {}) };
    if (t.specular && t.specular_dir) inputs['sh-specular'] = { radiance: t.specular, direction: t.specular_dir, ...(t.specular_hitt ? { hitDistance: t.specular_hitt } : {}) };
    if (t.visibility && t.transmittance) {
      inputs['shadow-rgb'] = {
        visibility: t.visibility, ...(t.occluder_dist ? { hitDistance: t.occluder_dist } : {}),
        translucency: t.transmittance, ...(t.translucent_dist ? { translucencyHitDistance: t.translucent_dist } : {}),
        radiance: t.shadow_rgb, visibilityLumT: t.visibility_lumt,
      };
    }
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

/** A throwaway ALU-heavy compute load that raises GPU clocks before a timed dispatch. */
class GpuWarmer {
  private pipe: GPUComputePipeline;
  private buf: GPUBuffer;
  private bg: GPUBindGroup;
  constructor(private device: GPUDevice) {
    const code = /* wgsl */ `
@group(0) @binding(0) var<storage, read_write> b: array<f32>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3u) {
  var x = f32(id.x) * 1e-6;
  for (var i = 0u; i < 512u; i++) { x = fma(x, 0.999, 1e-4); }
  b[id.x & 65535u] = x;
}`;
    this.pipe = device.createComputePipeline({ label: 'replay warm', layout: 'auto', compute: { module: device.createShaderModule({ code }), entryPoint: 'main' } });
    this.buf = device.createBuffer({ size: 65536 * 4, usage: GPUBufferUsage.STORAGE });
    this.bg = device.createBindGroup({ layout: this.pipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: this.buf } }] });
  }
  async run(ms: number) {
    const t0 = performance.now();
    while (performance.now() - t0 < ms) {
      const enc = this.device.createCommandEncoder({ label: 'replay warm' });
      const pass = enc.beginComputePass();
      pass.setPipeline(this.pipe); pass.setBindGroup(0, this.bg);
      pass.dispatchWorkgroups(16384);
      pass.end();
      this.device.queue.submit([enc.finish()]);
      await this.device.queue.onSubmittedWorkDone();
    }
  }
  dispose() { this.buf.destroy(); }
}

/** Replay a capture through a denoiser and (by default) write its outputs. */
export async function replay(device: GPUDevice, opts: ReplayOptions): Promise<ReplayResult> {
  const client = new CaptureClient(opts.endpoint);
  const manifest = await loadManifest(opts.capture, client);
  const { width, height } = manifest;
  const has = (name: string) => manifest.buffers.some((b) => b.name === name);
  const have: SignalName[] = [...SIGNALS.filter(has), ...(Object.keys(DERIVED_SIGNALS) as (keyof typeof DERIVED_SIGNALS)[]).filter((s) => has(DERIVED_SIGNALS[s])),
    ...(Object.keys(V1_SIGNALS) as (keyof typeof V1_SIGNALS)[]).filter((s) => V1_SIGNALS[s].needs.every(has))];
  const signals = (opts.signals ?? [...opts.denoiser.signals]).filter((s) => have.includes(s) && opts.denoiser.signals.includes(s));
  if (!signals.length) throw new Error(`denoiser ${opts.denoiser.id} supports [${opts.denoiser.signals}], capture has [${have}]`);
  const settings = opts.settings ?? {};
  const outName = opts.outputName ?? opts.denoiser.id;
  const outDir = `outputs/${opts.capture}/${outName}`;
  const write = opts.write ?? true;
  const frames = manifest.frames.slice(0, opts.maxFrames ?? manifest.frames.length);

  const caps = new CaptureTextures(device, manifest, opts.capture, client);
  const warmMs = opts.warmMs ?? (opts.denoiser.offline ? 0 : 50);
  const warmer = warmMs > 0 ? new GpuWarmer(device) : undefined;
  const den = opts.denoiser.create(device, { width, height, signals, settings });
  if (write) await client.rm(outDir);
  const timings: TimingRow[] = [];
  const uploads: Promise<void>[] = [];
  let denoiserInfo: Record<string, unknown> | undefined;
  try {
    for (const f of frames) {
      await caps.load(f.index);
      const frame = caps.frame(f);
      if (f.reset) den.resetHistory();
      await device.queue.onSubmittedWorkDone();
      await warmer?.run(warmMs);
      const t0 = performance.now();
      const out = den.dispatchAsync ? await den.dispatchAsync(frame) : den.dispatch(frame);
      await device.queue.onSubmittedWorkDone();
      timings.push({ frame: f.index, pass: 'wall', ms: performance.now() - t0 });
      await nextTask(); // let timestamp-query maps land
      for (const [pass, ms] of den.gpuTimings?.() ?? []) timings.push({ frame: f.index, pass, ms });
      const list = signals.filter((s) => out[s]);
      for (const s of signals) if (!out[s]) throw new Error(`denoiser ${opts.denoiser.id} returned no ${s} output at frame ${f.index}`);
      const data = await readTextures(device, list.map((s) => ({ texture: out[s]!, channels: SIGNAL_CH[s] })));
      if (write) list.forEach((s, i) => uploads.push(client.put(`${outDir}/${frameDir(f.index)}/${s}.f32`, data[i].buffer as ArrayBuffer)));
      if (uploads.length > 48) await Promise.all(uploads.splice(0));
      await opts.onFrame?.(f.index, out, frame, den.inspect?.());
    }
    await Promise.all(uploads);
    denoiserInfo = den.info?.();
  } finally {
    den.dispose();
    caps.dispose();
    warmer?.dispose();
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
    ...(denoiserInfo ? { denoiserInfo } : {}),
    warmMs,
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
