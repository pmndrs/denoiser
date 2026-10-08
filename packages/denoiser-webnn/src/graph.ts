// The OIDN U-Net as a WebNN graph. Driven by the WGSL runtime's op list
// (@pmndrs/denoiser-wgsl buildGraph: the same standard + large topologies as
// tools/onnx-convert/convert.py), unfolding each fused op back into
//   [resample2d 2x nearest] [concat skip] conv2d 3x3 pad 1 + bias [clamp 0..6] [maxPool2d 2x2/2]
// Graph IO is NCHW [B, C, H, W] -> [B, 3, H, W] (the NetworkBinding contract).
// Shapes are static: one MLGraph per geometry.
import type { TensorMap } from '@pmndrs/denoiser-core';
import { buildGraph, type ConvOp } from '@pmndrs/denoiser-wgsl';
import { newGraphBuilder, type MLContext, type MLGraph, type MLOperand, type MLOperandDataType } from './webnn';

const F16 = (globalThis as unknown as { Float16Array?: Float32ArrayConstructor }).Float16Array;

export interface OidnGraphOptions {
  precision: 'fp32' | 'fp16';
  batch: number;
  width: number;
  height: number;
  /**
   * Internal layout. 'nchw' (default) is what Chrome's CoreML backend reports
   * as preferred; 'nhwc' adds a transpose at each end (for other backends).
   */
  layout?: 'nchw' | 'nhwc';
}

export interface OidnGraph {
  graph: MLGraph;
  inChannels: number;
  dataType: MLOperandDataType;
  inShape: number[];
  outShape: number[];
  /** Graph construction + MLGraphBuilder.build() (backend compile) time. */
  buildMs: number;
}

/** OIHW -> OHWI */
function toOhwi(src: Float32Array, [o, i, h, w]: number[]): Float32Array {
  const dst = new Float32Array(src.length);
  for (let a = 0; a < o; a++) for (let b = 0; b < i; b++) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    dst[((a * h + y) * w + x) * i + b] = src[((a * i + b) * h + y) * w + x];
  }
  return dst;
}

export async function buildOidnGraph(ctx: MLContext, weights: TensorMap, opts: OidnGraphOptions): Promise<OidnGraph> {
  const t0 = performance.now();
  const g = buildGraph(weights);
  const nhwc = opts.layout === 'nhwc';
  const dataType: MLOperandDataType = opts.precision === 'fp16' ? 'float16' : 'float32';
  if (dataType === 'float16' && !F16) throw new Error('WebnnRuntime: fp16 needs Float16Array');
  const cast = (a: Float32Array): ArrayBufferView => (dataType === 'float16' ? new F16!(a) : a);
  const b = newGraphBuilder(ctx);
  const { batch: B, width: W, height: H } = opts;
  const inShape = [B, g.inChannels, H, W];
  const input = b.input('input', { dataType, shape: inShape });
  const inner = nhwc ? b.transpose(input, { permutation: [0, 2, 3, 1] }) : input;
  const cAxis = nhwc ? 3 : 1;
  const spatial = nhwc ? [1, 2] : [2, 3];
  const tensors: MLOperand[] = [];
  const read = (s: ConvOp['src1']) => {
    if (s.kind === 'input') return inner;
    const t = tensors[s.id];
    return s.up ? b.resample2d(t, { mode: 'nearest-neighbor', scales: [2, 2], axes: spatial }) : t;
  };
  let out: MLOperand | undefined;
  for (const op of g.ops) {
    let x = read(op.src1);
    if (op.src2) x = b.concat([x, read(op.src2)], cAxis);
    const w = weights.get(`${op.name}.weight`)!;
    const bias = weights.get(`${op.name}.bias`)!;
    const filter = b.constant(
      { dataType, shape: nhwc ? [w.shape[0], 3, 3, w.shape[1]] : w.shape },
      cast(nhwc ? toOhwi(w.data, w.shape) : w.data),
    );
    let y = b.conv2d(x, filter, {
      padding: [1, 1, 1, 1],
      bias: b.constant({ dataType, shape: [bias.data.length] }, cast(bias.data)),
      inputLayout: nhwc ? 'nhwc' : 'nchw',
      filterLayout: nhwc ? 'ohwi' : 'oihw',
    });
    if (op.relu) y = b.clamp(y, { minValue: 0, maxValue: 6 });
    if (op.pool) y = b.maxPool2d(y, { windowDimensions: [2, 2], strides: [2, 2], layout: nhwc ? 'nhwc' : 'nchw' });
    if (op.dst >= 0) tensors[op.dst] = y;
    else out = y;
  }
  if (!out) throw new Error('WebnnRuntime: graph has no output');
  if (nhwc) out = b.transpose(out, { permutation: [0, 3, 1, 2] });
  const graph = await b.build({ output: out });
  return { graph, inChannels: g.inChannels, dataType, inShape, outShape: [B, 3, H, W], buildMs: performance.now() - t0 };
}
