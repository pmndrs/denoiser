// EXPERIMENTAL NetworkRuntime on WebNN (navigator.ml): the OIDN U-Net built
// with MLGraphBuilder from the .tza weights (./graph.ts), one MLGraph per
// geometry, executed by the browser's ML backend (Chrome on macOS: CoreML).
//
//   const denoiser = await Denoiser.create({ runtime: new WebnnRuntime(), precision: 'fp16' });
//
// Needs Chrome with `--enable-features=WebMachineLearningNeuralNetwork` (as of
// Chrome 154/157). On macOS 'npu' only reaches the Neural Engine with the extra
// `WebNNCoreMLExplicitGPUOrNPU` feature; without it 'npu' runs like 'gpu'.
//
// IO with the engine's WebGPU buffers (binding.input / binding.output live on
// `session.device`, the engine's device):
// - interop (fp16): the network IO are exportable MLTensors. run() exports the
//   input tensor to WebGPU (a fresh GPUBuffer per export), copies binding.input
//   into it, hands it back (destroy), dispatches, exports the output and copies
//   it into binding.output. GPU copies only, no host round trip.
// - readback (fp32 — Chrome only exports float16 tensors — or `interop: false`):
//   binding.input is read back to the host, written with writeTensor, and the
//   readTensor result is uploaded into binding.output.
import type {
  NetworkBinding, NetworkGeometry, NetworkModel, NetworkRuntime, NetworkSession, TensorMap,
} from '@pmndrs/denoiser-core';
import { DEFAULT_TZA_URL, parseTZA } from '@pmndrs/denoiser-core';
import { buildOidnGraph, type OidnGraph } from './graph';
import { getML, type MLContext, type MLDeviceType, type MLTensor } from './webnn';

export interface WebnnRuntimeOptions {
  /** Base URL the OIDN `.tza` weight files are served from (default: jsDelivr CDN, models-v3). */
  tzaUrl?: string;
  /** WebNN device type (default 'gpu'). */
  deviceType?: MLDeviceType;
  /** Run the engine on this GPUDevice (default: one with the adapter's max limits + features). */
  device?: GPUDevice;
  /**
   * Zero-host-copy IO via WebNN <-> WebGPU tensor export. 'auto' (default): when
   * the context supports it and the model is fp16 (Chrome only exports float16).
   */
  interop?: boolean | 'auto';
  /** Internal graph layout (default 'nchw', the CoreML backend's preferred one). */
  layout?: 'nchw' | 'nhwc';
}

export class WebnnRuntime implements NetworkRuntime {
  readonly name: string;
  private device?: Promise<GPUDevice>;
  private context?: Promise<MLContext>;
  /** Graph build (construct + compile) ms of the most recent bind(). */
  lastBuildMs?: number;

  constructor(private opts: WebnnRuntimeOptions = {}) {
    this.name = `webnn-${opts.deviceType ?? 'gpu'}`;
  }

  static isAvailable(): boolean {
    return !!getML() && typeof (globalThis as { MLGraphBuilder?: unknown }).MLGraphBuilder === 'function';
  }

  async load(model: NetworkModel, hints?: { geometry?: NetworkGeometry }): Promise<NetworkSession> {
    const ml = getML();
    if (!ml) throw new Error('WebnnRuntime: WebNN unavailable (navigator.ml); Chrome needs --enable-features=WebMachineLearningNeuralNetwork');
    this.device ??= this.opts.device ? Promise.resolve(this.opts.device) : requestMaxDevice();
    this.context ??= ml.createContext({ deviceType: this.opts.deviceType ?? 'gpu' });
    const [device, ctx] = await Promise.all([this.device, this.context]);
    const res = await fetch(`${this.opts.tzaUrl ?? DEFAULT_TZA_URL}/${model.name}.tza`);
    if (!res.ok) throw new Error(`WebnnRuntime: failed to load ${model.name}.tza (${res.status})`);
    const weights = parseTZA(await res.arrayBuffer());
    const first = weights.get('enc_conv0.weight') ?? weights.get('enc_conv1a.weight');
    if (!first) throw new Error('WebnnRuntime: unrecognized OIDN weights');
    if (first.shape[1] !== model.channels) {
      throw new Error(`WebnnRuntime: ${model.name} takes ${first.shape[1]} channels, engine expects ${model.channels}`);
    }
    const f16 = model.precision === 'fp16';
    const want = this.opts.interop ?? 'auto';
    const canExport = typeof ctx.createExportableTensor === 'function' && typeof ctx.exportToGPU === 'function';
    if (want === true && (!canExport || !f16)) {
      throw new Error('WebnnRuntime: interop needs createExportableTensor/exportToGPU and an fp16 model');
    }
    const interop = want !== false && canExport && f16;
    const session = new WebnnSession(device, ctx, weights, model, interop, this.opts.layout ?? 'nchw', (ms) => { this.lastBuildMs = ms; });
    // the engine binds this geometry right away — start compiling it now
    if (hints?.geometry) session.prepare(hints.geometry);
    return session;
  }

  /** Release the WebNN context and (if runtime-owned) the device. Call on teardown. */
  async destroy() {
    if (this.context) (await this.context).destroy();
    if (this.device && !this.opts.device) (await this.device).destroy();
    this.context = undefined;
    this.device = undefined;
  }
}

class WebnnSession implements NetworkSession {
  private graphs = new Map<string, Promise<OidnGraph>>();
  private live = new Set<NetworkBinding>();

  constructor(
    readonly device: GPUDevice,
    private ctx: MLContext,
    private weights: TensorMap,
    private model: NetworkModel,
    private interop: boolean,
    private layout: 'nchw' | 'nhwc',
    private onBuild: (ms: number) => void,
  ) {}

  /** Start building the graph for a geometry (cached). */
  prepare(g: NetworkGeometry): Promise<OidnGraph> {
    const key = `${g.batch}|${g.tileW}x${g.tileH}`;
    let p = this.graphs.get(key);
    if (!p) {
      p = buildOidnGraph(this.ctx, this.weights, {
        precision: this.model.precision, batch: g.batch, width: g.tileW, height: g.tileH, layout: this.layout,
      });
      p.then((b) => this.onBuild(b.buildMs), () => this.graphs.delete(key));
      this.graphs.set(key, p);
    }
    return p;
  }

  async bind(geometry: NetworkGeometry): Promise<NetworkBinding> {
    const built = await this.prepare(geometry);
    let binding: InteropBinding | ReadbackBinding | undefined;
    if (this.interop) {
      // Chrome/CoreML refuses exportable tensors past some size ("Tensor size is
      // too large" for e.g. [8, 9, 256, 256] fp16 while [1, 3, 1088, 1920] works):
      // those geometries take the host path.
      binding = await InteropBinding.create(this.device, this.ctx, built, geometry).catch(() => undefined);
    }
    binding ??= await ReadbackBinding.create(this.device, this.ctx, built, geometry);
    this.live.add(binding);
    const release = binding.release.bind(binding);
    binding.release = () => { this.live.delete(binding); release(); };
    return binding;
  }

  release() {
    for (const b of [...this.live]) b.release();
    for (const p of this.graphs.values()) p.then((b) => b.graph.destroy(), () => {});
    this.graphs.clear();
  }
}

// a function so importing this module doesn't touch WebGPU globals
const IO_USAGE = () => GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST;

function ioBuffers(device: GPUDevice, built: OidnGraph) {
  const bpe = built.dataType === 'float16' ? 2 : 4;
  const bytes = (s: number[]) => Math.ceil((s.reduce((a, b) => a * b, 1) * bpe) / 4) * 4;
  return {
    input: device.createBuffer({ size: bytes(built.inShape), usage: IO_USAGE(), label: 'webnn-input' }),
    output: device.createBuffer({ size: bytes(built.outShape), usage: IO_USAGE(), label: 'webnn-output' }),
  };
}

/** fp16: exportable MLTensors, GPU-side copies to/from the engine's buffers. */
class InteropBinding implements NetworkBinding {
  /** GPU-side IO (tensor export) — false on the host-copy path. */
  readonly interop = true;
  private constructor(
    readonly geometry: NetworkGeometry,
    readonly input: GPUBuffer,
    readonly output: GPUBuffer,
    private device: GPUDevice,
    private ctx: MLContext,
    private built: OidnGraph,
    private inT: MLTensor,
    private outT: MLTensor,
  ) {}

  static async create(device: GPUDevice, ctx: MLContext, built: OidnGraph, geometry: NetworkGeometry) {
    const made = await Promise.allSettled([
      ctx.createExportableTensor!({ dataType: built.dataType, shape: built.inShape }, device),
      ctx.createExportableTensor!({ dataType: built.dataType, shape: built.outShape }, device),
    ]);
    if (made.some((r) => r.status === 'rejected')) {
      for (const r of made) if (r.status === 'fulfilled') r.value.destroy();
      throw (made.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason;
    }
    const [inT, outT] = made.map((r) => (r as PromiseFulfilledResult<MLTensor>).value);
    const { input, output } = ioBuffers(device, built);
    return new InteropBinding(geometry, input, output, device, ctx, built, inT, outT);
  }

  async run() {
    const { device, ctx } = this;
    const inBuf = await ctx.exportToGPU!(this.inT);
    let enc = device.createCommandEncoder();
    enc.copyBufferToBuffer(this.input, 0, inBuf, 0, Math.min(inBuf.size, this.input.size));
    device.queue.submit([enc.finish()]);
    inBuf.destroy(); // back to WebNN (after the queued copy)
    ctx.dispatch(this.built.graph, { input: this.inT }, { output: this.outT });
    const outBuf = await ctx.exportToGPU!(this.outT);
    enc = device.createCommandEncoder();
    enc.copyBufferToBuffer(outBuf, 0, this.output, 0, Math.min(outBuf.size, this.output.size));
    device.queue.submit([enc.finish()]);
    outBuf.destroy();
  }

  release() {
    this.inT.destroy();
    this.outT.destroy();
    this.input.destroy();
    this.output.destroy();
  }
}

/** Host round trip: readback binding.input -> writeTensor; readTensor -> writeBuffer. */
class ReadbackBinding implements NetworkBinding {
  readonly interop = false;
  private constructor(
    readonly geometry: NetworkGeometry,
    readonly input: GPUBuffer,
    readonly output: GPUBuffer,
    private device: GPUDevice,
    private ctx: MLContext,
    private built: OidnGraph,
    private inT: MLTensor,
    private outT: MLTensor,
    private staging: GPUBuffer,
  ) {}

  static async create(device: GPUDevice, ctx: MLContext, built: OidnGraph, geometry: NetworkGeometry) {
    const [inT, outT] = await Promise.all([
      ctx.createTensor({ dataType: built.dataType, shape: built.inShape, writable: true }),
      ctx.createTensor({ dataType: built.dataType, shape: built.outShape, readable: true }),
    ]);
    const { input, output } = ioBuffers(device, built);
    const staging = device.createBuffer({ size: input.size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    return new ReadbackBinding(geometry, input, output, device, ctx, built, inT, outT, staging);
  }

  async run() {
    const { device, ctx } = this;
    const enc = device.createCommandEncoder();
    enc.copyBufferToBuffer(this.input, 0, this.staging, 0, this.input.size);
    device.queue.submit([enc.finish()]);
    await this.staging.mapAsync(GPUMapMode.READ);
    ctx.writeTensor(this.inT, this.staging.getMappedRange());
    this.staging.unmap();
    ctx.dispatch(this.built.graph, { input: this.inT }, { output: this.outT });
    const data = await ctx.readTensor(this.outT);
    device.queue.writeBuffer(this.output, 0, data);
  }

  release() {
    this.inT.destroy();
    this.outT.destroy();
    this.input.destroy();
    this.output.destroy();
    this.staging.destroy();
  }
}

async function requestMaxDevice(): Promise<GPUDevice> {
  const adapter = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('WebnnRuntime: WebGPU adapter unavailable');
  const requiredLimits: Record<string, number> = {};
  const proto = Object.getPrototypeOf(adapter.limits);
  for (const name of Object.getOwnPropertyNames(proto)) {
    const v = (adapter.limits as unknown as Record<string, unknown>)[name];
    if (typeof v === 'number') requiredLimits[name] = v;
  }
  return adapter.requestDevice({
    requiredFeatures: [...adapter.features] as GPUFeatureName[],
    requiredLimits,
    label: 'denoiser-webnn',
  });
}
