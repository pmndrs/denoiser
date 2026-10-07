// OIDN TZA weight blob parser — JS port of tools/onnx-convert/tza.py.
// Conv weights stay OIHW, which is what FusedConv (NCHW) wants.

export interface WeightTensor {
  data: Float32Array;
  shape: number[];
}
export type TensorMap = Map<string, WeightTensor>;

const MAGIC = 0x41d7;
const MAJOR_VERSION = 2;

export function parseTZA(buf: ArrayBuffer): TensorMap {
  const view = new DataView(buf);
  if (view.getUint16(0, true) !== MAGIC) throw new Error('Invalid or corrupted weights blob');
  const major = view.getUint8(2);
  if (major !== MAJOR_VERSION) throw new Error(`Unsupported weights blob version: ${major}`);

  let offset = Number(view.getBigUint64(4, true));
  const numTensors = view.getUint32(offset, true);
  offset += 4;

  const decoder = new TextDecoder();
  const tensors: TensorMap = new Map();
  for (let t = 0; t < numTensors; t++) {
    const nameLen = view.getUint16(offset, true);
    offset += 2;
    const name = decoder.decode(new Uint8Array(buf, offset, nameLen));
    offset += nameLen;

    const ndims = view.getUint8(offset);
    offset += 1;
    const shape: number[] = [];
    for (let d = 0; d < ndims; d++) {
      shape.push(view.getUint32(offset, true));
      offset += 4;
    }
    offset += ndims; // layout string, one char per dim — not needed

    const dataType = String.fromCharCode(view.getUint8(offset));
    offset += 1;
    const tensorOffset = Number(view.getBigUint64(offset, true));
    offset += 8;

    const count = shape.reduce((a, b) => a * b, 1);
    let data: Float32Array;
    if (dataType === 'f') {
      data = new Float32Array(buf.slice(tensorOffset, tensorOffset + count * 4));
    } else if (dataType === 'h') {
      const half = new Uint16Array(buf.slice(tensorOffset, tensorOffset + count * 2));
      data = new Float32Array(count);
      for (let i = 0; i < count; i++) data[i] = halfToFloat(half[i]);
    } else {
      throw new Error(`Invalid tensor data type: ${dataType}`);
    }
    tensors.set(name, { data, shape });
  }
  return tensors;
}

export function halfToFloat(h: number): number {
  const s = h & 0x8000 ? -1 : 1;
  const e = (h >> 10) & 0x1f;
  const f = h & 0x3ff;
  if (e === 0) return s * 2 ** -14 * (f / 1024);
  if (e === 31) return f ? NaN : s * Infinity;
  return s * 2 ** (e - 15) * (1 + f / 1024);
}
