// The OIDN U-Net as a list of fused conv ops — 1:1 with the graph
// tools/onnx-convert/convert.py builds (standard + UNetLarge topologies), but
// with the glue ops folded away:
//   conv 3x3 pad1 + bias + relu6       -> one op (epilogue)
//   conv -> maxpool 2x2/2              -> the conv writes the pooled tensor only
//                                         (every pooled conv's full-res output
//                                         feeds nothing but its pool)
//   up(x) nearest/floor ++ skip concat -> the decoder conv reads x at (y>>1, x>>1)
//                                         for the first channels and the skip for
//                                         the rest; nothing is materialized
// The network input/output stay NCHW (the NetworkBinding contract); every
// intermediate is channel-packed NC4HW4 (vec4 of 4 channels per pixel).
import type { TensorMap } from './tza';

/** Where a conv reads its input channels from. */
export type Source =
  | { kind: 'input' } // the binding's NCHW input, read planar
  | { kind: 'tensor'; id: number; up: boolean }; // a packed intermediate, optionally 2x nearest-upsampled

export interface ConvOp {
  name: string;
  /** Resolution level the conv runs at (0 = full, 1 = 1/2 ...). */
  level: number;
  cout: number;
  src1: Source;
  c1: number; // real channels read from src1
  src2?: Source;
  c2: number; // real channels read from src2 (0 if none)
  pool: boolean; // writes the 2x2/2 max-pooled result (level + 1)
  relu: boolean; // relu6 = clamp(0, 6)
  /** Packed tensor id written, or -1 for the binding's NCHW output. */
  dst: number;
}

export interface TensorInfo { id: number; level: number; channels: number }

export interface Graph {
  large: boolean;
  inChannels: number;
  ops: ConvOp[];
  tensors: TensorInfo[];
}

export function buildGraph(weights: TensorMap): Graph {
  const large = weights.has('enc_conv1a.weight');
  const first = weights.get(large ? 'enc_conv1a.weight' : 'enc_conv0.weight');
  if (!first) throw new Error('WgslRuntime: unrecognized OIDN weights (no enc_conv0 / enc_conv1a)');
  const inChannels = first.shape[1];
  const ops: ConvOp[] = [];
  const tensors: TensorInfo[] = [];
  type Val = { src: Source; channels: number; level: number };
  const input: Val = { src: { kind: 'input' }, channels: inChannels, level: 0 };

  const conv = (name: string, x: Val, opts: { pool?: boolean; skip?: Val; up?: boolean; relu?: boolean; final?: boolean } = {}): Val => {
    const w = weights.get(`${name}.weight`);
    if (!w) throw new Error(`WgslRuntime: missing weights for ${name}`);
    const [cout, cin, kh, kw] = w.shape;
    if (kh !== 3 || kw !== 3) throw new Error(`WgslRuntime: ${name} is not 3x3`);
    const up = !!opts.up;
    const level = up ? x.level - 1 : x.level;
    const src1: Source = x.src.kind === 'tensor' ? { ...x.src, up } : x.src;
    if (up && x.src.kind !== 'tensor') throw new Error('upsampled input must be an intermediate');
    const c2 = opts.skip?.channels ?? 0;
    if (cin !== x.channels + c2) throw new Error(`WgslRuntime: ${name} expects ${cin} channels, graph gives ${x.channels + c2}`);
    if (opts.skip && opts.skip.level !== level) throw new Error(`WgslRuntime: ${name} skip level mismatch`);
    const pool = !!opts.pool;
    const outLevel = level + (pool ? 1 : 0);
    let dst = -1;
    if (!opts.final) {
      dst = tensors.length;
      tensors.push({ id: dst, level: outLevel, channels: cout });
    }
    ops.push({
      name, level, cout, src1, c1: x.channels, src2: opts.skip?.src, c2, pool,
      relu: opts.relu ?? !opts.final, dst,
    });
    return { src: { kind: 'tensor', id: dst, up: false }, channels: cout, level: outLevel };
  };

  let x: Val;
  let pool1: Val, pool2: Val, pool3: Val;
  if (large) {
    x = conv('enc_conv1a', input); pool1 = conv('enc_conv1b', x, { pool: true });
    x = conv('enc_conv2a', pool1); pool2 = conv('enc_conv2b', x, { pool: true });
    x = conv('enc_conv3a', pool2); pool3 = conv('enc_conv3b', x, { pool: true });
    x = conv('enc_conv4a', pool3); const pool4 = conv('enc_conv4b', x, { pool: true });
    x = conv('enc_conv5a', pool4); x = conv('enc_conv5b', x);
  } else {
    x = conv('enc_conv0', input);
    pool1 = conv('enc_conv1', x, { pool: true });
    pool2 = conv('enc_conv2', pool1, { pool: true });
    pool3 = conv('enc_conv3', pool2, { pool: true });
    const pool4 = conv('enc_conv4', pool3, { pool: true });
    x = conv('enc_conv5a', pool4);
    x = conv('enc_conv5b', x);
  }
  x = conv('dec_conv4a', x, { up: true, skip: pool3 }); x = conv('dec_conv4b', x);
  x = conv('dec_conv3a', x, { up: true, skip: pool2 }); x = conv('dec_conv3b', x);
  x = conv('dec_conv2a', x, { up: true, skip: pool1 }); x = conv('dec_conv2b', x);
  x = conv('dec_conv1a', x, { up: true, skip: input }); x = conv('dec_conv1b', x);
  conv(large ? 'dec_conv1c' : 'dec_conv0', x, { final: true });
  return { large, inChannels, ops, tensors };
}

/**
 * Assign intermediates to reusable buffer slots by liveness (a tensor's slot is
 * free again after its last reader). Returns slot per tensor id + slot count.
 */
export function assignSlots(g: Graph): { slotOf: number[]; slots: number } {
  const lastUse = new Array<number>(g.tensors.length).fill(-1);
  g.ops.forEach((op, i) => {
    for (const s of [op.src1, op.src2]) if (s?.kind === 'tensor') lastUse[s.id] = i;
  });
  const slotOf = new Array<number>(g.tensors.length).fill(-1);
  const free: number[] = [];
  let slots = 0;
  g.ops.forEach((op, i) => {
    if (op.dst >= 0) slotOf[op.dst] = free.length ? free.shift()! : slots++;
    // release inputs whose last reader is this op (after the output is placed,
    // so an op never writes the buffer it reads)
    for (const s of [op.src1, op.src2]) {
      if (s?.kind === 'tensor' && lastUse[s.id] === i) free.push(slotOf[s.id]);
    }
  });
  return { slotOf, slots };
}
