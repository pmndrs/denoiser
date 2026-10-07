// OIDN U-Net executed op-by-op on @huggingface/kernels — 1:1 with the graph
// tools/onnx-convert/convert.py builds (standard + UNetLarge topologies):
//   Conv 3x3 pad1 + bias + relu6 -> com.microsoft.FusedConv (activation Clip[0,6])
//   MaxPool 2x2/2                -> ai.onnx.MaxPool
//   nearest 2x (asymmetric/floor)-> ai.onnx.Resize
//   channel concat               -> ai.onnx.Concat
// Everything stays GPU-resident (`output: 'gpu'`) except the final conv, which
// reads back. The final conv has no activation (matches upstream OIDN / the
// default --final-activation none ONNX models).
import { getKernel, type Kernel, type KernelGpuTensor } from '@huggingface/kernels';
import type { TensorMap } from './tza';

export type Precision = 'fp32' | 'fp16';

const KERNEL_VERSION = { version: 1 } as const;
const F16 = (globalThis as unknown as { Float16Array?: Float32ArrayConstructor }).Float16Array;

type Gpu = KernelGpuTensor;
interface ConvWeights { w: Gpu; b: Gpu; cout: number }

export interface RunTimings { totalMs: number; ops: number }

export class KernelsUNet {
  private convs = new Map<string, ConvWeights>();
  private live: Gpu[] = []; // per-run intermediates, destroyed after each run
  lastTimings?: RunTimings;

  private constructor(
    private k: { conv: Kernel; pool: Kernel; resize: Kernel; concat: Kernel; identity: Kernel },
    readonly precision: Precision,
    readonly large: boolean,
    readonly inChannels: number,
  ) {}

  static async create(weights: TensorMap, precision: Precision = 'fp32'): Promise<KernelsUNet> {
    if (precision === 'fp16' && !F16) throw new Error('fp16 needs Float16Array (Chrome 135+)');
    const [conv, pool, resize, concat, identity] = await Promise.all([
      getKernel('webgpu-kernels/com.microsoft.FusedConv', KERNEL_VERSION),
      getKernel('webgpu-kernels/ai.onnx.MaxPool', KERNEL_VERSION),
      getKernel('webgpu-kernels/ai.onnx.Resize', KERNEL_VERSION),
      getKernel('webgpu-kernels/ai.onnx.Concat', KERNEL_VERSION),
      getKernel('webgpu-kernels/ai.onnx.Identity', KERNEL_VERSION),
    ]);
    const large = weights.has('enc_conv1a.weight');
    const first = weights.get(large ? 'enc_conv1a.weight' : 'enc_conv0.weight')!;
    const net = new KernelsUNet({ conv, pool, resize, concat, identity }, precision, large, first.shape[1]);
    await net.uploadWeights(weights);
    return net;
  }

  /** Weights live on the GPU for the net's lifetime. The kernels API only accepts
   *  GPU tensors that a kernel produced, so each one is uploaded via Identity. */
  private async uploadWeights(weights: TensorMap) {
    for (const [key, t] of weights) {
      if (!key.endsWith('.weight')) continue;
      const name = key.slice(0, -'.weight'.length);
      const bias = weights.get(`${name}.bias`)!;
      this.convs.set(name, {
        w: await this.toGpu(t.data, t.shape),
        b: await this.toGpu(bias.data, bias.shape),
        cout: t.shape[0],
      });
    }
  }

  /** Upload host data. A Uint16Array is raw binary16 (the kernels convention for float16). */
  private async toGpu(data: Float32Array | Uint16Array, shape: number[]): Promise<Gpu> {
    const { y } = await this.k.identity({ x: { data: this.cast(data), shape } }, { output: 'gpu' });
    return y;
  }

  private cast(data: Float32Array | Uint16Array): Float32Array | Uint16Array {
    if (data instanceof Uint16Array) return data;
    return this.precision === 'fp16' ? new F16!(data) : data;
  }

  /**
   * Run the network on NCHW [n, C, h, w] input. H and W must be multiples of 16.
   * Returns NCHW float32 [n, 3, h, w] on the host.
   */
  async run(input: Float32Array | Uint16Array, n: number, h: number, w: number): Promise<Float32Array> {
    const out = await this.forward(input, n, h, w, 'cpu') as ArrayLike<number>;
    return out instanceof Float32Array ? out : Float32Array.from(out);
  }

  /** Same, but the result stays GPU-resident (model precision). Caller destroys it. */
  async runGpu(input: Float32Array | Uint16Array, n: number, h: number, w: number): Promise<Gpu> {
    return this.forward(input, n, h, w, 'gpu') as Promise<Gpu>;
  }

  /**
   * Zero-copy: read `input` [n, C, h, w] and write the result into `output`
   * [n, 3, h, w] — both resident tensors the caller allocated once (see
   * allocate()) and keeps. Nothing touches the host.
   */
  async runInto(input: Gpu, output: Gpu): Promise<void> {
    const [n, , h, w] = input.shape;
    await this.forward(input, n, h, w, output);
  }

  /** A resident tensor the caller owns — its buffer can be written by other
   *  WGSL on the same device, then passed back in. */
  async allocate(shape: number[]): Promise<Gpu> {
    const count = shape.reduce((a, b) => a * b, 1);
    return this.toGpu(new Float32Array(count), shape);
  }

  private async forward(
    input: Float32Array | Uint16Array | Gpu, n: number, h: number, w: number, final: 'cpu' | 'gpu' | Gpu,
  ): Promise<Gpu | ArrayLike<number>> {
    if (h % 16 || w % 16) throw new Error(`tile ${w}x${h} must be a multiple of 16`);
    const t0 = performance.now();
    let ops = 0;
    const conv = async (name: string, x: Gpu, activation = true) => {
      ops++;
      return this.track(await this.convOp(name, x, activation, 'gpu'));
    };
    const pool = async (x: Gpu) => {
      ops++;
      const { y } = await this.k.pool({ x }, {
        attrs: { kernel_shape: [2, 2], strides: [2, 2] }, output: 'gpu',
      });
      return this.track(y);
    };
    const up = async (x: Gpu) => {
      ops++;
      const [b, c, hh, ww] = x.shape;
      const { y } = await this.k.resize({ x }, {
        attrs: {
          mode: 'nearest', nearest_mode: 'floor',
          coordinate_transformation_mode: 'asymmetric', scales: [1, 1, 2, 2],
        },
        outputs: { y: { shape: [b, c, hh * 2, ww * 2], dtype: this.dtype } },
        output: 'gpu',
      });
      return this.track(y);
    };
    const cat = async (a: Gpu, b: Gpu) => {
      ops++;
      const { c } = await this.k.concat({ a, b }, { attrs: { axis: 1 }, output: 'gpu' });
      return this.track(c);
    };

    try {
      const x0 = input instanceof Float32Array || input instanceof Uint16Array
        ? this.track(await this.toGpu(input, [n, this.inChannels, h, w]))
        : input;
      let x: Gpu;
      let pool1: Gpu, pool2: Gpu, pool3: Gpu;
      if (this.large) {
        x = await conv('enc_conv1a', x0); x = await conv('enc_conv1b', x); pool1 = await pool(x);
        x = await conv('enc_conv2a', pool1); x = await conv('enc_conv2b', x); pool2 = await pool(x);
        x = await conv('enc_conv3a', pool2); x = await conv('enc_conv3b', x); pool3 = await pool(x);
        x = await conv('enc_conv4a', pool3); x = await conv('enc_conv4b', x); const pool4 = await pool(x);
        x = await conv('enc_conv5a', pool4); x = await conv('enc_conv5b', x);
      } else {
        x = await conv('enc_conv0', x0);
        x = await conv('enc_conv1', x); pool1 = await pool(x);
        x = await conv('enc_conv2', pool1); pool2 = await pool(x);
        x = await conv('enc_conv3', pool2); pool3 = await pool(x);
        x = await conv('enc_conv4', pool3); const pool4 = await pool(x);
        x = await conv('enc_conv5a', pool4);
        x = await conv('enc_conv5b', x);
      }
      x = await conv('dec_conv4a', await cat(await up(x), pool3)); x = await conv('dec_conv4b', x);
      x = await conv('dec_conv3a', await cat(await up(x), pool2)); x = await conv('dec_conv3b', x);
      x = await conv('dec_conv2a', await cat(await up(x), pool1)); x = await conv('dec_conv2b', x);
      x = await conv('dec_conv1a', await cat(await up(x), x0)); x = await conv('dec_conv1b', x);
      // final conv: no activation; not tracked — the caller owns the result
      ops++;
      const last = this.large ? 'dec_conv1c' : 'dec_conv0';
      const out = final === 'cpu'
        ? await this.convOp(last, x, false, 'cpu')
        : await this.convOp(last, x, false, 'gpu', final === 'gpu' ? undefined : final);
      this.lastTimings = { totalMs: performance.now() - t0, ops };
      return out;
    } finally {
      for (const t of this.live) t.destroy();
      this.live = [];
    }
  }

  private async convOp(name: string, x: Gpu, activation: boolean, output: 'gpu', into?: Gpu): Promise<Gpu>;
  private async convOp(name: string, x: Gpu, activation: boolean, output: 'cpu'): Promise<ArrayLike<number>>;
  private async convOp(name: string, x: Gpu, activation: boolean, output: 'gpu' | 'cpu', into?: Gpu): Promise<Gpu | ArrayLike<number>> {
    const c = this.convs.get(name);
    if (!c) throw new Error(`missing weights for ${name}`);
    const attrs = {
      kernel_shape: [3, 3], pads: [1, 1, 1, 1], strides: [1, 1],
      ...(activation ? { activation: 'Clip', activation_params: [0, 6] } : {}),
    };
    const inputs = { x, w: c.w, bias: c.b };
    if (output === 'gpu') {
      return (await this.k.conv(inputs, { attrs, output: 'gpu', ...(into ? { outputs: { y: into } } : {}) })).y;
    }
    return (await this.k.conv(inputs, { attrs, output: 'cpu' })).y.data as unknown as ArrayLike<number>;
  }

  /** Run one conv and keep its GPU output (caller destroys) — used to prove the
   *  result buffer lives on a device we can use with our own WGSL. */
  async probe(input: Float32Array, h: number, w: number): Promise<Gpu> {
    const x0 = await this.toGpu(input, [1, this.inChannels, h, w]);
    try {
      return await this.convOp(this.large ? 'enc_conv1a' : 'enc_conv0', x0, true, 'gpu');
    } finally {
      x0.destroy();
    }
  }

  private get dtype() { return this.precision === 'fp16' ? 'float16' as const : 'float32' as const; }

  private track(t: Gpu): Gpu {
    this.live.push(t);
    return t;
  }

  destroy() {
    for (const c of this.convs.values()) { c.w.destroy(); c.b.destroy(); }
    this.convs.clear();
  }
}
