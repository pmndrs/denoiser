// Shared host helpers for the FidelityFX ports: column-major mat4 math (three.js /
// gl-matrix layout, matching WGSL's mat4x4f) and a non-blocking timestamp timer.
import type { Mat4 } from '@pmndrs/denoiser-core';

export type M4 = Float32Array;

export function mat4(m: Mat4): M4 {
  const out = new Float32Array(16);
  for (let i = 0; i < 16; i++) out[i] = m[i];
  return out;
}

/** a * b (column-major). */
export function mul(a: M4, b: M4): M4 {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      o[c * 4 + r] = s;
    }
  }
  return o;
}

/** General 4x4 inverse (double precision accumulation). */
export function invert(m: M4): M4 {
  const a = Array.from(m);
  const [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] = a;
  const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11, b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30, b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
  let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!det) return new Float32Array(16);
  det = 1 / det;
  return new Float32Array([
    (a11 * b11 - a12 * b10 + a13 * b09) * det,
    (a02 * b10 - a01 * b11 - a03 * b09) * det,
    (a31 * b05 - a32 * b04 + a33 * b03) * det,
    (a22 * b04 - a21 * b05 - a23 * b03) * det,
    (a12 * b08 - a10 * b11 - a13 * b07) * det,
    (a00 * b11 - a02 * b08 + a03 * b07) * det,
    (a32 * b02 - a30 * b05 - a33 * b01) * det,
    (a20 * b05 - a22 * b02 + a23 * b01) * det,
    (a10 * b10 - a11 * b08 + a13 * b06) * det,
    (a01 * b08 - a00 * b10 - a03 * b06) * det,
    (a30 * b04 - a31 * b02 + a33 * b00) * det,
    (a21 * b02 - a20 * b04 - a23 * b00) * det,
    (a11 * b07 - a10 * b09 - a12 * b06) * det,
    (a00 * b09 - a01 * b07 + a02 * b06) * det,
    (a31 * b01 - a30 * b03 - a32 * b00) * det,
    (a20 * b03 - a21 * b01 + a22 * b00) * det,
  ]);
}

/** Camera position from a view matrix (translation of its inverse). */
export function eyeFromView(view: M4): [number, number, number] {
  const inv = invert(view);
  return [inv[12], inv[13], inv[14]];
}

export const isDepthFormat = (f: GPUTextureFormat) => f.startsWith('depth');

/**
 * Per-pass GPU timer on timestamp queries. Never blocks: results land in `timings`
 * a few frames late (mapAsync), which is what a real-time loop wants.
 */
export class PassTimer {
  readonly timings = new Map<string, number>();
  private querySet: GPUQuerySet;
  private resolve: GPUBuffer;
  private free: GPUBuffer[] = [];
  private names: string[] = [];
  private capacity: number;

  constructor(private device: GPUDevice, maxPasses = 16) {
    this.capacity = maxPasses * 2;
    this.querySet = device.createQuerySet({ type: 'timestamp', count: this.capacity });
    this.resolve = device.createBuffer({
      size: this.capacity * 8, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
    });
  }

  static supported(device: GPUDevice) {
    return device.features.has('timestamp-query');
  }

  /** Call once per frame before the first pass. */
  begin() { this.names = []; }

  /** timestampWrites for the next compute pass. */
  pass(name: string): GPUComputePassTimestampWrites | undefined {
    const i = this.names.length;
    if (2 * i + 1 >= this.capacity) return undefined;
    this.names.push(name);
    return { querySet: this.querySet, beginningOfPassWriteIndex: 2 * i, endOfPassWriteIndex: 2 * i + 1 };
  }

  /** Record the resolve + readback copy into `encoder` (before finish()). */
  end(encoder: GPUCommandEncoder): (() => void) | undefined {
    const n = this.names.length;
    if (!n) return undefined;
    const names = this.names.slice();
    const read = this.free.pop() ?? this.device.createBuffer({
      size: this.capacity * 8, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });
    encoder.resolveQuerySet(this.querySet, 0, n * 2, this.resolve, 0);
    encoder.copyBufferToBuffer(this.resolve, 0, read, 0, n * 16);
    // after submit: map and publish
    return () => {
      read.mapAsync(GPUMapMode.READ, 0, n * 16).then(() => {
        const t = new BigInt64Array(read.getMappedRange(0, n * 16));
        let total = 0;
        for (let i = 0; i < n; i++) {
          const ms = Number(t[2 * i + 1] - t[2 * i]) / 1e6;
          total += ms;
          this.timings.set(names[i], ms);
        }
        // `total` = sum of passes (excludes idle gaps between passes)
        this.timings.set('total', total);
        read.unmap();
        this.free.push(read);
      }).catch(() => { /* device lost / destroyed */ });
    };
  }

  destroy() {
    this.querySet.destroy();
    this.resolve.destroy();
    for (const b of this.free) b.destroy();
  }
}
