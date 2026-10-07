// EXPERIMENTAL NetworkRuntime in hand-written WGSL: the OIDN U-Net as ~16 fused
// conv dispatches (see ./graph.ts, ./conv.ts), encoded into ONE command encoder
// per run, all intermediates in persistent per-geometry buffers.
//
//   const denoiser = await Denoiser.create({ runtime: new WgslRuntime({ tzaUrl }) });
//
// run() only encodes + submits: the engine's next GPU work (accumulate/resolve)
// is queued behind it on the same device, so no host sync is needed in between.
import type {
  NetworkBinding, NetworkGeometry, NetworkModel, NetworkRuntime, NetworkSession,
} from '@pmndrs/denoiser-core';
import { parseTZA } from './tza';
import { assignSlots, buildGraph, type ConvOp, type Graph } from './graph';
import { ceil4, convShader, packBias, packWeights, type ConvShaderInfo, type ConvTiling } from './conv';

export interface WgslRuntimeOptions {
  /** Base URL the OIDN `.tza` weight files are served from. */
  tzaUrl: string;
  /** Run on this device (default: one with the adapter's max limits + features). */
  device?: GPUDevice;
  /**
   * Per-layer GPU timings via timestamp queries (needs the `timestamp-query`
   * feature). Each conv gets its own pass and run() waits for the result —
   * diagnostics only. Results land in `WgslRuntime.lastProfile`.
   */
  profile?: boolean;
  /** Override the conv tiling (all layers, or per layer name) — for tuning experiments. */
  tiling?: TilingOverride;
}

export interface LayerTiming { name: string; ms: number }
export type TilingOverride = Partial<ConvTiling> & { layers?: Record<string, Partial<ConvTiling>> };

const F16 = (globalThis as unknown as { Float16Array?: Float32ArrayConstructor }).Float16Array;

export class WgslRuntime implements NetworkRuntime {
  readonly name = 'wgsl';
  private device?: Promise<GPUDevice>;
  /** Per-layer GPU ms of the most recent profiled run (profile: true). */
  lastProfile?: LayerTiming[];

  constructor(private opts: WgslRuntimeOptions) {}

  async load(model: NetworkModel): Promise<NetworkSession> {
    this.device ??= this.opts.device ? Promise.resolve(this.opts.device) : requestMaxDevice();
    const device = await this.device;
    const f16 = model.precision === 'fp16';
    if (f16 && !device.features.has('shader-f16')) {
      throw new Error('WgslRuntime: fp16 needs the shader-f16 feature');
    }
    const res = await fetch(`${this.opts.tzaUrl}/${model.name}.tza`);
    if (!res.ok) throw new Error(`WgslRuntime: failed to load ${model.name}.tza (${res.status})`);
    const weights = parseTZA(await res.arrayBuffer());
    const graph = buildGraph(weights);
    if (graph.inChannels !== model.channels) {
      throw new Error(`WgslRuntime: ${model.name} takes ${graph.inChannels} channels, engine expects ${model.channels}`);
    }
    const profile = !!this.opts.profile && device.features.has('timestamp-query');
    const session = new WgslSession(device, graph, f16, profile, (p) => { this.lastProfile = p; });
    await session.init(weights, this.opts.tiling);
    return session;
  }

  /** The device is runtime-owned (it outlives model switches). Call on teardown. */
  async destroy() {
    if (this.device && !this.opts.device) (await this.device).destroy();
    this.device = undefined;
  }
}

interface Layer {
  op: ConvOp;
  info: ConvShaderInfo;
  pipeline: GPUComputePipeline;
  weights: GPUBuffer;
  bias: GPUBuffer;
}

/** Default tiling, by layer shape. */
function tilingFor(op: ConvOp, override?: TilingOverride): ConvTiling {
  const base: ConvTiling = { pw: 2, ph: 2, oc4: 2, wgx: 8, wgy: 8 };
  if (op.dst < 0) base.oc4 = 1;
  const { layers, ...all } = override ?? {};
  return { ...base, ...all, ...layers?.[op.name] };
}

class WgslSession implements NetworkSession {
  private layers: Layer[] = [];
  private live = new Set<NetworkBinding>();

  constructor(
    readonly device: GPUDevice,
    private graph: Graph,
    private f16: boolean,
    private profile: boolean,
    private onProfile: (p: LayerTiming[]) => void,
  ) {}

  async init(weights: Map<string, { data: Float32Array; shape: number[] }>, tiling?: TilingOverride) {
    const d = this.device;
    this.layers = await Promise.all(this.graph.ops.map(async (op) => {
      const info = convShader(op, this.f16, tilingFor(op, tiling));
      const module = d.createShaderModule({ code: info.code, label: op.name });
      const pipeline = await d.createComputePipelineAsync({
        layout: 'auto', compute: { module, entryPoint: 'main' }, label: op.name,
      });
      const w = weights.get(`${op.name}.weight`)!;
      const b = weights.get(`${op.name}.bias`)!;
      const packed = packWeights(w.data, op.cout, op.c1, op.c2);
      const wData = this.f16 ? new F16!(packed) : packed;
      const wBuf = d.createBuffer({
        size: Math.max(16, wData.byteLength), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST, label: `${op.name}.w`,
      });
      d.queue.writeBuffer(wBuf, 0, wData as unknown as BufferSource);
      const bData = packBias(b.data, op.cout);
      const bBuf = d.createBuffer({ size: bData.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST, label: `${op.name}.b` });
      d.queue.writeBuffer(bBuf, 0, bData as unknown as BufferSource);
      return { op, info, pipeline, weights: wBuf, bias: bBuf };
    }));
  }

  async bind(geometry: NetworkGeometry): Promise<NetworkBinding> {
    const { batch: B, tileW: W, tileH: H } = geometry;
    if (W % 16 || H % 16) throw new Error(`WgslRuntime: tile ${W}x${H} must be a multiple of 16`);
    const d = this.device;
    const bpe = this.f16 ? 2 : 4;
    const usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST;
    const input = d.createBuffer({ size: B * this.graph.inChannels * H * W * bpe, usage, label: 'wgsl.input' });
    const output = d.createBuffer({ size: B * 3 * H * W * bpe, usage, label: 'wgsl.output' });

    // intermediates: liveness-shared slots, each sized for its largest tensor
    const { slotOf, slots } = assignSlots(this.graph);
    const slotBytes = new Array<number>(slots).fill(16);
    for (const t of this.graph.tensors) {
      const bytes = B * ceil4(t.channels) * (H >> t.level) * (W >> t.level) * 4 * bpe;
      slotBytes[slotOf[t.id]] = Math.max(slotBytes[slotOf[t.id]], bytes);
    }
    const slotBufs = slotBytes.map((size, i) => d.createBuffer({ size, usage: GPUBufferUsage.STORAGE, label: `wgsl.slot${i}` }));
    const tensorBuf = (id: number) => slotBufs[slotOf[id]];
    const srcBuf = (s: ConvOp['src1']) => (s.kind === 'input' ? input : tensorBuf(s.id));

    const owned: GPUBuffer[] = [input, output, ...slotBufs];
    const steps = this.layers.map(({ op, info, pipeline, weights, bias }) => {
      const h = H >> op.level;
      const w = W >> op.level;
      const ocg = info.cout4 / info.tiling.oc4;
      const params = new Uint32Array([h, w, h >> 1, w >> 1, ocg, 0, 0, 0]);
      const ub = d.createBuffer({ size: params.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      d.queue.writeBuffer(ub, 0, params);
      owned.push(ub);
      const entries: GPUBindGroupEntry[] = [
        { binding: 0, resource: { buffer: ub } },
        { binding: 1, resource: { buffer: weights } },
        { binding: 2, resource: { buffer: bias } },
        { binding: 3, resource: { buffer: srcBuf(op.src1) } },
        { binding: 5, resource: { buffer: op.dst < 0 ? output : tensorBuf(op.dst) } },
      ];
      if (op.src2) entries.push({ binding: 4, resource: { buffer: srcBuf(op.src2) } });
      const bindGroup = d.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries, label: op.name });
      const groups: [number, number, number] = [Math.ceil(w / info.tileW), Math.ceil(h / info.tileH), B * ocg];
      return { name: op.name, pipeline, bindGroup, groups };
    });

    let query: { set: GPUQuerySet; resolve: GPUBuffer; read: GPUBuffer } | undefined;
    if (this.profile) {
      const n = steps.length * 2;
      query = {
        set: d.createQuerySet({ type: 'timestamp', count: n }),
        resolve: d.createBuffer({ size: n * 8, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC }),
        read: d.createBuffer({ size: n * 8, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ }),
      };
    }

    const run = async () => {
      const enc = d.createCommandEncoder({ label: 'wgsl.unet' });
      if (query) {
        steps.forEach((s, i) => {
          const pass = enc.beginComputePass({
            timestampWrites: { querySet: query!.set, beginningOfPassWriteIndex: 2 * i, endOfPassWriteIndex: 2 * i + 1 },
          });
          pass.setPipeline(s.pipeline);
          pass.setBindGroup(0, s.bindGroup);
          pass.dispatchWorkgroups(...s.groups);
          pass.end();
        });
        enc.resolveQuerySet(query.set, 0, steps.length * 2, query.resolve, 0);
        enc.copyBufferToBuffer(query.resolve, 0, query.read, 0, steps.length * 16);
      } else {
        const pass = enc.beginComputePass();
        for (const s of steps) {
          pass.setPipeline(s.pipeline);
          pass.setBindGroup(0, s.bindGroup);
          pass.dispatchWorkgroups(...s.groups);
        }
        pass.end();
      }
      d.queue.submit([enc.finish()]);
      if (query) {
        await query.read.mapAsync(GPUMapMode.READ);
        const t = new BigUint64Array(query.read.getMappedRange().slice(0));
        query.read.unmap();
        this.onProfile(steps.map((s, i) => ({ name: s.name, ms: Number(t[2 * i + 1] - t[2 * i]) / 1e6 })));
      }
    };

    const binding: NetworkBinding = {
      geometry, input, output, run,
      release: () => {
        if (!this.live.delete(binding)) return;
        for (const b of owned) b.destroy();
        if (query) { query.set.destroy(); query.resolve.destroy(); query.read.destroy(); }
      },
    };
    this.live.add(binding);
    return binding;
  }

  release() {
    for (const b of [...this.live]) b.release();
    for (const l of this.layers) { l.weights.destroy(); l.bias.destroy(); }
    this.layers = [];
  }
}

async function requestMaxDevice(): Promise<GPUDevice> {
  const adapter = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('WgslRuntime: WebGPU adapter unavailable');
  const requiredLimits: Record<string, number> = {};
  const proto = Object.getPrototypeOf(adapter.limits);
  for (const name of Object.getOwnPropertyNames(proto)) {
    const v = (adapter.limits as unknown as Record<string, unknown>)[name];
    if (typeof v === 'number') requiredLimits[name] = v;
  }
  return adapter.requestDevice({
    requiredFeatures: [...adapter.features] as GPUFeatureName[],
    requiredLimits,
    label: 'denoiser-wgsl',
  });
}
