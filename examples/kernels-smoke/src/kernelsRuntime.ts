// EXPERIMENTAL NetworkRuntime on @huggingface/kernels — the OIDN U-Net run op by
// op (see ./unet.ts) behind the same seam as the ORT runtime, so the regular
// Denoiser facade (tiling, HDR transfer, texture IO) drives it unchanged.
//
//   const denoiser = await Denoiser.create({ runtime: new KernelsRuntime({ tzaUrl }) });
//
// Today's limits of kernels 0.0.1-preview.3 (docs/specs/runtimes.md):
// - It creates its own GPUDevice. We hand it ours through deviceShim (demo-only
//   workaround) so its tensors live where the engine's WGSL can reach them.
// - It only accepts GPU tensors it produced (an `instanceof` check). So the
//   binding asks kernels for its IO tensors once and hands their buffers to the
//   engine: the engine's WGSL writes the input tensor's buffer, the last conv
//   writes into the output tensor (`outputs: { y }`) — zero-copy, no host sync.
//   `zeroCopy: false` keeps the old path (input read back to the host per run)
//   for comparison.
import type {
  NetworkBinding, NetworkGeometry, NetworkModel, NetworkRuntime, NetworkSession,
} from 'denoiser';
import { KernelsUNet } from './unet';
import { parseTZA } from './tza';
import { shareDeviceWithKernels } from './deviceShim';

export interface KernelsRuntimeOptions {
  /** Base URL the OIDN `.tza` weight files are served from. */
  tzaUrl: string;
  /** Run on this device (default: one with the adapter's max limits + features). */
  device?: GPUDevice;
  /** Bind the engine straight to kernels-owned IO tensors (default true). */
  zeroCopy?: boolean;
}

export class KernelsRuntime implements NetworkRuntime {
  readonly name = 'hf-kernels';
  private device?: Promise<GPUDevice>;

  constructor(private opts: KernelsRuntimeOptions) {}

  async load(model: NetworkModel): Promise<NetworkSession> {
    this.device ??= this.opts.device ? Promise.resolve(this.opts.device) : requestMaxDevice();
    const device = await this.device;
    const res = await fetch(`${this.opts.tzaUrl}/${model.name}.tza`);
    if (!res.ok) throw new Error(`KernelsRuntime: failed to load ${model.name}.tza (${res.status})`);
    const weights = parseTZA(await res.arrayBuffer());
    // kernels creates its runtime on its first call — make that call land on our
    // device. Later loads reuse that runtime, so the shim is only live briefly.
    const restore = shareDeviceWithKernels(device);
    let net: KernelsUNet;
    try {
      net = await KernelsUNet.create(weights, model.precision);
    } finally {
      restore();
    }
    if (net.inChannels !== model.channels) {
      net.destroy();
      throw new Error(`KernelsRuntime: ${model.name} takes ${net.inChannels} channels, engine expects ${model.channels}`);
    }
    return new KernelsSession(device, net, this.opts.zeroCopy ?? true);
  }

  /** The device is runtime-owned (it outlives model switches). Call on teardown. */
  async destroy() {
    if (this.device && !this.opts.device) (await this.device).destroy();
    this.device = undefined;
  }
}

class KernelsSession implements NetworkSession {
  private live = new Set<NetworkBinding>();

  constructor(readonly device: GPUDevice, private net: KernelsUNet, private zeroCopy: boolean) {}

  async bind(geometry: NetworkGeometry): Promise<NetworkBinding> {
    const { batch, tileW, tileH } = geometry;
    const d = this.device;
    const f16 = this.net.precision === 'fp16';
    const bpe = f16 ? 2 : 4;
    const inBytes = batch * this.net.inChannels * tileH * tileW * bpe;
    const outBytes = batch * 3 * tileH * tileW * bpe;

    if (this.zeroCopy) {
      const inT = await this.net.allocate([batch, this.net.inChannels, tileH, tileW]);
      const outT = await this.net.allocate([batch, 3, tileH, tileW]);
      // The engine binds whole buffers at offset 0 — fine for kernels' dedicated
      // per-tensor buffers, which is what this preview allocates.
      if (inT.byteOffset !== 0 || outT.byteOffset !== 0 || inT.buffer.size < inBytes || outT.buffer.size < outBytes) {
        throw new Error('KernelsRuntime: kernels tensors are sub-allocated; use zeroCopy: false');
      }
      const binding: NetworkBinding = {
        geometry, input: inT.buffer, output: outT.buffer,
        run: () => this.net.runInto(inT, outT),
        release: () => {
          if (!this.live.delete(binding)) return;
          inT.destroy();
          outT.destroy();
        },
      };
      this.live.add(binding);
      return binding;
    }

    const usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST;
    const input = d.createBuffer({ size: inBytes, usage });
    const output = d.createBuffer({ size: outBytes, usage });
    const staging = d.createBuffer({ size: inBytes, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });

    const binding: NetworkBinding = {
      geometry, input, output,
      run: async () => {
        // Input: engine-written NCHW -> host (kernels can't wrap our buffer).
        const e1 = d.createCommandEncoder();
        e1.copyBufferToBuffer(input, 0, staging, 0, inBytes);
        d.queue.submit([e1.finish()]);
        await staging.mapAsync(GPUMapMode.READ);
        const range = staging.getMappedRange().slice(0);
        staging.unmap();
        const host = f16 ? new Uint16Array(range) : new Float32Array(range);

        // Network on the GPU; result stays resident on the shared device.
        const y = await this.net.runGpu(host, batch, tileH, tileW);
        if (y.byteLength < outBytes) throw new Error(`KernelsRuntime: output is ${y.byteLength} bytes, expected ${outBytes}`);
        const e2 = d.createCommandEncoder();
        e2.copyBufferToBuffer(y.buffer, y.byteOffset, output, 0, outBytes);
        d.queue.submit([e2.finish()]);
        await d.queue.onSubmittedWorkDone(); // y must outlive the copy
        y.destroy();
      },
      release: () => {
        if (!this.live.delete(binding)) return;
        input.destroy();
        output.destroy();
        staging.destroy();
      },
    };
    this.live.add(binding);
    return binding;
  }

  release() {
    for (const b of [...this.live]) b.release();
    this.net.destroy();
  }
}

async function requestMaxDevice(): Promise<GPUDevice> {
  const adapter = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('KernelsRuntime: WebGPU adapter unavailable');
  const requiredLimits: Record<string, number> = {};
  const proto = Object.getPrototypeOf(adapter.limits);
  for (const name of Object.getOwnPropertyNames(proto)) {
    const v = (adapter.limits as unknown as Record<string, unknown>)[name];
    if (typeof v === 'number') requiredLimits[name] = v;
  }
  return adapter.requestDevice({
    requiredFeatures: [...adapter.features] as GPUFeatureName[],
    requiredLimits,
    label: 'denoiser-kernels',
  });
}
