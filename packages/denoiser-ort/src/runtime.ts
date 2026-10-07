// ONNX Runtime Web (WebGPU EP) network runtime. ORT creates the GPUDevice the
// engine shares (expose `device` to three.js — see onnxruntime #26107).
//
// The ONNX models export with named free dims [batch, C, height, width]; each
// geometry gets its own InferenceSession pinned via freeDimensionOverrides.
// ORT requests a minimal device, so the FIRST session creation runs under a
// scoped requestAdapter patch that asks for the adapter's max limits/features
// (whole-frame U-Net intermediates need them; restored immediately after).
import * as ort from 'onnxruntime-web/webgpu';
import { Models } from './weights';
import { DenoiserUnsupportedError } from '@pmndrs/denoiser-core';
import { EncConv0 } from './splitAux';
import type {
  NetworkBinding, NetworkGeometry, NetworkModel, NetworkRuntime, NetworkSession, Precision,
} from '@pmndrs/denoiser-core';

export interface OrtRuntimeOptions {
  /** Where the .onnx models are served (default: jsDelivr CDN). */
  weightsUrl?: string;
  /** Where ORT loads its wasm assets (default: jsDelivr CDN). */
  wasmPaths?: string;
  /**
   * Opt-in WebGPU graph capture. Measured ~0 gain here (the workload is
   * GPU-bound, not dispatch-bound) and onnxruntime-web 1.27.0 captured
   * sessions crash after ~150-250 CUMULATIVE replays (createBindGroup:
   * "Required member is undefined" in ORT's capture buffer manager; GPU
   * syncs don't prevent it — standalone repro in the
   * ort-webgpu-graphcapture-repro repo). Off by default until upstream fixes.
   */
  graphCapture?: boolean;
  /**
   * Aux split-graph workaround for the onnxruntime-web WebGPU Conv bug that
   * speckles the 9-channel cleanAux models. **Default on** — falls back to the
   * plain (speckled) model with a warning if the artifacts aren't hosted next to
   * the weights. See DenoiserCreateOptions.splitAux.
   */
  splitAux?: boolean;
}

/**
 * Aux split-graph workaround (the first conv reducing the raw >3ch input
 * miscomputes on ORT-WebGPU — see tools/ort-webgpu-aux-repro). The model bytes
 * are then a re-exported TAIL model that starts at `enc_conv1` and takes TWO
 * inputs: the enc_conv0 feature map AND the raw `input` (the dec_conv1a skip
 * still needs it). enc_conv0 (Conv 3x3 pad1 CIN->encOutChannels + relu6) runs
 * in WGSL. Verified to restore native quality (1.2e-6 vs reference).
 */
export interface SplitOptions {
  encWeights: Float32Array; // OIHW [encOutChannels, channels, 3, 3]
  encBias: Float32Array; // [encOutChannels]
  encOutChannels: number; // enc_conv0 output channels (32 for the OIDN aux nets)
  featInputName?: string; // tail input for the feature map (default 'enc_conv0_relu6_2')
  rawInputName?: string; // tail input for the raw image (default 'input')
}

export interface OrtSessionOptions {
  channels: number;
  precision?: Precision;
  wasmPaths?: string;
  graphCapture?: boolean;
  split?: SplitOptions;
}

/** Fetches .onnx models (+ split-aux artifacts) and opens ORT sessions on them. */
export class OrtRuntime implements NetworkRuntime {
  readonly name = 'ort-webgpu';
  private models = Models.getInstance();
  private splitWarned = false;

  constructor(private opts: OrtRuntimeOptions = {}) {
    if (opts.weightsUrl) this.models.url = opts.weightsUrl;
  }

  async load(model: NetworkModel, hints?: { geometry?: NetworkGeometry }): Promise<OrtSession> {
    this.models.precision = model.precision;
    // For 9ch cleanAux models the split tail REPLACES the model bytes.
    const split = await this.loadSplitArtifacts(model.name, model.channels);
    const bytes = split ? split.tailBytes : await this.models.get(model.name);
    return OrtSession.create(bytes, {
      channels: model.channels,
      precision: model.precision,
      wasmPaths: this.opts.wasmPaths,
      graphCapture: this.opts.graphCapture,
      split: split?.split,
    }, hints?.geometry);
  }

  /**
   * Fetch the split-graph artifacts (tail model + first-conv weights) for a
   * cleanAux model when splitAux is on. Returns undefined otherwise (incl. when
   * artifacts aren't hosted — falls back to the plain model with a warning, so
   * default-on splitAux never hard-fails). Artifacts live next to the model,
   * with the same precision suffix: `<name>[.fp16].tail.onnx` and
   * `<name>[.fp16].enc0.bin` (f32 OIHW weights [COUT,channels,3,3] then bias).
   */
  private async loadSplitArtifacts(name: string, channels: number): Promise<
    { tailBytes: Uint8Array; split: SplitOptions } | undefined
  > {
    if (!(this.opts.splitAux ?? true) || channels < 9) return undefined;
    const m = this.models;
    const suffix = m.precision === 'fp16' ? '.fp16' : ''; // mirror Models.fileFor
    const stem = m.url ? `${m.url}/${name}${suffix}` : `/${m.path ?? 'models'}/${name}${suffix}`;
    const fetchBytes = async (url: string) => {
      const r = await fetch(url);
      // A dev server's SPA fallback (e.g. Vite's default appType) can answer a
      // missing artifact with a 200 + index.html rather than a 404 — treat any
      // HTML response as "not found" too, or the bogus bytes below throw a
      // confusing low-level error instead of the intended graceful fallback.
      const contentType = r.headers.get('content-type') ?? '';
      if (!r.ok || contentType.includes('text/html')) {
        throw new Error(`${url} (${r.status}${contentType ? `, ${contentType}` : ''})`);
      }
      return r.arrayBuffer();
    };
    let tail: ArrayBuffer, encBuf: ArrayBuffer;
    try {
      [tail, encBuf] = await Promise.all([
        fetchBytes(`${stem}.tail.onnx`),
        fetchBytes(`${stem}.enc0.bin`),
      ]);
    } catch (err) {
      // Artifacts missing/unreachable — run the plain (speckled) model instead of
      // failing. Aux on WebGPU has a known ORT bug; this is the fallback path.
      if (!this.splitWarned) {
        this.splitWarned = true;
        console.warn(`Denoiser: splitAux artifacts unavailable for ${name}${suffix}, aux will speckle (ORT-web WebGPU Conv bug). Host <name>.tail.onnx + <name>.enc0.bin next to the model, or set splitAux:false to silence.`, err);
      }
      return undefined;
    }
    const f = new Float32Array(encBuf);
    // f = [COUT*channels*9 weights][COUT bias]  ->  len = COUT*(channels*9 + 1)
    const cout = Math.round(f.length / (channels * 9 + 1));
    return {
      tailBytes: new Uint8Array(tail),
      split: {
        encWeights: f.slice(0, cout * channels * 9),
        encBias: f.slice(cout * channels * 9, cout * channels * 9 + cout),
        encOutChannels: cout,
      },
    };
  }
}

interface SplitState {
  encOutChannels: number;
  featInputName: string;
  rawInputName: string;
  weightBuf: GPUBuffer; // uploaded once (device-lifetime)
  biasBuf: GPUBuffer;
  kernel: EncConv0;
}

/** One ORT model. Each geometry is its own InferenceSession (pinned free dims). */
export class OrtSession implements NetworkSession {
  inputName!: string;
  outputName!: string;
  fixedGeometry?: NetworkGeometry;
  /** True when sessions run with WebGPU graph capture enabled. */
  readonly graphCaptured: boolean;

  private baseSessionOpts: ort.InferenceSession.SessionOptions;
  private dynamicDims = true; // false for legacy static-dim models
  private live = new Set<NetworkBinding>();
  private pending?: NetworkBinding; // eagerly-created first binding, handed out by bind()
  private splitOpts?: SplitOptions;
  private split?: SplitState;

  private constructor(private modelBytes: Uint8Array, private opts: OrtSessionOptions) {
    this.baseSessionOpts = {
      executionProviders: ['webgpu'],
      preferredOutputLocation: 'gpu-buffer',
      graphOptimizationLevel: 'all',
    };
    if (opts.graphCapture) this.baseSessionOpts.enableGraphCapture = true;
    this.graphCaptured = !!opts.graphCapture;
    if (opts.split) {
      const s = opts.split;
      const expectW = s.encOutChannels * opts.channels * 9;
      if (s.encWeights.length !== expectW) {
        throw new Error(`Denoiser: split encWeights must be ${expectW} floats ([${s.encOutChannels},${opts.channels},3,3]), got ${s.encWeights.length}`);
      }
      if (s.encBias.length !== s.encOutChannels) {
        throw new Error(`Denoiser: split encBias must be ${s.encOutChannels} floats, got ${s.encBias.length}`);
      }
      this.splitOpts = s;
    }
  }

  get device(): GPUDevice {
    return (ort.env.webgpu as unknown as { device: GPUDevice }).device;
  }

  private get precision(): Precision { return this.opts.precision ?? 'fp32'; }
  private get bpe() { return this.precision === 'fp16' ? 2 : 4; }

  /**
   * Open the model. `firstGeometry` is created right away — that is also what
   * makes ORT create the GPUDevice, under the scoped max-limits patch.
   */
  static async create(modelBytes: Uint8Array, opts: OrtSessionOptions, firstGeometry?: NetworkGeometry): Promise<OrtSession> {
    const s = new OrtSession(modelBytes, opts);
    ort.env.wasm.numThreads = 1; // avoids needing cross-origin isolation
    ort.env.wasm.wasmPaths =
      opts.wasmPaths ?? 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/';

    const deviceMissing = !(ort.env.webgpu as unknown as { device?: GPUDevice }).device;
    // WebGPU is required (no WebGL fallback in v2) — probe before ORT so a missing
    // adapter fails loudly here instead of as a cryptic WASM/session error deeper in.
    if (deviceMissing && (typeof navigator === 'undefined' || !('gpu' in navigator) || !(await navigator.gpu.requestAdapter()))) {
      throw new DenoiserUnsupportedError('denoiser 2.x requires WebGPU (no adapter available). See browser support: Chrome/Edge stable, Safari 26+. For WebGL environments use denoiser 0.x (v1).');
    }
    const unpatch = deviceMissing ? patchForMaxLimits() : undefined;
    try {
      s.pending = await s.createBinding(firstGeometry ?? { batch: 1, tileW: 256, tileH: 256 });
    } finally {
      unpatch?.();
    }

    const device = s.device;
    if (!device) throw new DenoiserUnsupportedError('Denoiser: ORT did not expose a WebGPU device');
    if (s.precision === 'fp16' && !device.features.has('shader-f16')) {
      // ORT requests shader-f16 on its device when the adapter has it; without
      // it our WGSL can't read/write the fp16 model IO buffers.
      s.release();
      throw new DenoiserUnsupportedError('Denoiser: fp16 needs the shader-f16 WebGPU feature (unavailable on this device)');
    }

    // Split mode: upload enc_conv0 weights/bias once (device-lifetime). f32 for
    // accuracy even when the model IO is fp16 (accumulation is f32 in the kernel).
    if (s.splitOpts) {
      const o = s.splitOpts;
      const weightBuf = device.createBuffer({
        size: o.encWeights.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      const biasBuf = device.createBuffer({
        size: o.encBias.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      // TS 5.7+ lib.dom typings narrowed GPUAllowSharedBufferSource views to ArrayBuffer-backed;
      // this engine never uses SharedArrayBuffer, so these casts are safe.
      device.queue.writeBuffer(weightBuf, 0, o.encWeights as BufferSource);
      device.queue.writeBuffer(biasBuf, 0, o.encBias as BufferSource);
      s.split = {
        encOutChannels: o.encOutChannels,
        featInputName: o.featInputName ?? 'enc_conv0_relu6_2',
        rawInputName: o.rawInputName ?? 'input',
        weightBuf, biasBuf,
        kernel: new EncConv0(device, s.precision === 'fp16'),
      };
    }
    return s;
  }

  async bind(geometry: NetworkGeometry): Promise<NetworkBinding> {
    const p = this.pending;
    if (p && sameGeometry(p.geometry, geometry)) {
      this.pending = undefined;
      return p;
    }
    return this.createBinding(geometry);
  }

  private async createBinding(geometry: NetworkGeometry): Promise<NetworkBinding> {
    let session: ort.InferenceSession;
    if (this.dynamicDims) {
      try {
        session = await ort.InferenceSession.create(this.modelBytes, {
          ...this.baseSessionOpts,
          freeDimensionOverrides: { batch: geometry.batch, height: geometry.tileH, width: geometry.tileW },
        });
      } catch (err) {
        if (this.live.size > 0) throw err; // dynamic already proven -> real failure
        // Legacy static-dim model ([1, C, 256, 256]): no free dims to pin.
        console.warn('Denoiser: model has static dims, geometry planning disabled', err);
        this.dynamicDims = false;
        geometry = this.fixedGeometry = { batch: 1, tileW: 256, tileH: 256 };
        session = await ort.InferenceSession.create(this.modelBytes, this.baseSessionOpts);
      }
    } else {
      session = await ort.InferenceSession.create(this.modelBytes, this.baseSessionOpts);
    }

    this.outputName = session.outputNames[0];
    const splitNames = this.splitOpts
      ? [this.splitOpts.featInputName ?? 'enc_conv0_relu6_2', this.splitOpts.rawInputName ?? 'input']
      : undefined;
    if (splitNames) {
      // Tail model has two inputs: the enc_conv0 feature map and the raw image.
      for (const n of splitNames) {
        if (!session.inputNames.includes(n)) {
          throw new Error(`Denoiser: split tail model missing input '${n}' (has: ${session.inputNames.join(', ')})`);
        }
      }
      this.inputName = splitNames[1]; // the raw image feed
    } else {
      this.inputName = session.inputNames[0];
    }

    const device = this.device;
    const { batch, tileW, tileH } = geometry;
    const els = batch * tileW * tileH;
    const dtype = this.precision === 'fp16' ? 'float16' : 'float32';
    const usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST;
    const input = device.createBuffer({ size: els * this.opts.channels * this.bpe, usage });
    const output = device.createBuffer({ size: els * 3 * this.bpe, usage });
    const inputTensor = ort.Tensor.fromGpuBuffer(input, {
      dataType: dtype, dims: [batch, this.opts.channels, tileH, tileW],
    });
    const outputTensor = ort.Tensor.fromGpuBuffer(output, {
      dataType: dtype, dims: [batch, 3, tileH, tileW],
    });
    let encFeat: GPUBuffer | undefined;
    let feeds: Record<string, ort.Tensor> = { [this.inputName]: inputTensor };
    if (this.splitOpts) {
      const cout = this.splitOpts.encOutChannels;
      encFeat = device.createBuffer({ size: els * cout * this.bpe, usage });
      feeds = {
        [splitNames![0]]: ort.Tensor.fromGpuBuffer(encFeat, { dataType: dtype, dims: [batch, cout, tileH, tileW] }),
        [splitNames![1]]: inputTensor,
      };
    }
    const fetches = { [this.outputName]: outputTensor };

    const binding: NetworkBinding = {
      geometry, input, output,
      run: async () => {
        // Split mode: compute enc_conv0 (input -> encFeat) ourselves, then run
        // the tail with BOTH the feature map and the raw input (dec_conv1a skip).
        const sp = this.split;
        if (sp) {
          const enc = device.createCommandEncoder();
          sp.kernel.encode(enc, input, sp.weightBuf, sp.biasBuf, encFeat!,
            tileW, tileH, this.opts.channels, sp.encOutChannels, batch);
          device.queue.submit([enc.finish()]);
        }
        await session.run(feeds, fetches);
      },
      release: () => {
        if (!this.live.delete(binding)) return;
        input.destroy();
        output.destroy();
        encFeat?.destroy();
        session.release?.();
      },
    };
    this.live.add(binding);
    return binding;
  }

  /** Releasing the last ORT session DESTROYS the shared GPUDevice. */
  release() {
    this.pending = undefined;
    for (const b of [...this.live]) b.release();
    if (this.split) {
      this.split.weightBuf.destroy();
      this.split.biasBuf.destroy();
      this.split.kernel.destroy();
      this.split = undefined;
    }
  }
}

const sameGeometry = (a: NetworkGeometry, b: NetworkGeometry) =>
  a.batch === b.batch && a.tileW === b.tileW && a.tileH === b.tileH;

/**
 * Temporarily patch requestAdapter so the device ORT is about to create gets
 * the adapter's FULL limits + features (ORT requests a minimal device, which
 * caps storage buffers at ~128-256MB — far too small for whole-frame U-Net
 * intermediates, and too small for three.js path tracers sharing the device).
 * Returns a restore function.
 */
function patchForMaxLimits(): () => void {
  if (!('gpu' in navigator)) return () => undefined;
  const gpu = navigator.gpu as GPU;
  const origRequestAdapter = gpu.requestAdapter.bind(gpu);
  gpu.requestAdapter = async (adapterOpts?: GPURequestAdapterOptions) => {
    const adapter = await origRequestAdapter(adapterOpts);
    if (!adapter) return adapter;
    const origRequestDevice = adapter.requestDevice.bind(adapter);
    adapter.requestDevice = (desc: GPUDeviceDescriptor = {}) => {
      const requiredLimits: Record<string, number> = {};
      const proto = Object.getPrototypeOf(adapter.limits);
      for (const name of Object.getOwnPropertyNames(proto)) {
        const v = (adapter.limits as unknown as Record<string, unknown>)[name];
        if (typeof v === 'number') requiredLimits[name] = v;
      }
      return origRequestDevice({
        ...desc,
        requiredFeatures: [...adapter.features] as GPUFeatureName[],
        requiredLimits: { ...requiredLimits, ...(desc.requiredLimits ?? {}) },
      });
    };
    return adapter;
  };
  return () => { gpu.requestAdapter = origRequestAdapter; };
}
