// Reference accumulation: a running per-pixel mean of the noisy signal, our analogue of
// native NRD's REFERENCE denoiser (used for the M0 round-trip sanity check, not a real
// denoiser). Textbook temporal accumulation, our design:
//   - reproject = true: follow `motion` back (bilinear over the 2x2 footprint), drop taps
//     that are off-screen / sky or whose stored world position is off the current
//     surface's plane (|n · (P_tap − P)| > depthTolerance · |viewZ|; the plane-distance
//     test of RTG II ch. 49 §49.6; static geometry). reproject = false: same pixel, no
//     test (static camera only).
//   - jitter-aware: the current sample sits at centre + camera.jitter, the history's samples
//     at centre + the previous frame's jitter (remembered here; CAPTURE-FORMAT convention).
//   - mean += (x - mean) / n, n = min(n + 1, maxFrames); resetHistory() restarts.
// Output: rgba32float, rgb = mean, a = n (history length). Works for any signal
// (radiance rgb, or visibility in r).
import type { FrameCamera, FrameGuides, TemporalConfig, TemporalDenoiser } from '../../../packages/denoiser-core/src/temporal';

export interface AccumulateInputs {
  radiance?: GPUTexture;
  visibility?: GPUTexture;
}

export interface AccumulateOptions {
  /** Reproject history with motion (default true). false = accumulate in place. */
  reproject?: boolean;
  /** Cap on the history length (default 4096). */
  maxFrames?: number;
  /** Plane-distance tolerance for history taps, relative to |viewZ| (default 0.01). */
  depthTolerance?: number;
}

const WGSL = (depthTex: boolean) => /* wgsl */ `
struct U {
  invViewProj: mat4x4f, view: mat4x4f, _m0: mat4x4f, _m1: mat4x4f,
  dims: vec2u, reset: u32, reproject: u32,
  maxFrames: f32, tol: f32, _p0: u32, _p1: u32,
  jitter: vec2f, prevJitter: vec2f,   // pixels, x right / y down (CAPTURE-FORMAT)
};
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var t_sig: texture_2d<f32>;
@group(0) @binding(2) var t_depth: ${depthTex ? 'texture_depth_2d' : 'texture_2d<f32>'};
@group(0) @binding(3) var t_motion: texture_2d<f32>;
@group(0) @binding(4) var t_hist: texture_2d<f32>;
@group(0) @binding(5) var t_histP: texture_2d<f32>;   // world position, w = 1 valid / 0 sky
@group(0) @binding(6) var o_hist: texture_storage_2d<rgba32float, write>;
@group(0) @binding(7) var o_P: texture_storage_2d<rgba32float, write>;
@group(0) @binding(8) var t_normal: texture_2d<f32>;

fn depthAt(p: vec2u) -> f32 { return ${depthTex ? 'textureLoad(t_depth, p, 0)' : 'textureLoad(t_depth, p, 0).r'}; }

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= u.dims)) { return; }
  let p = id.xy;
  let sig = textureLoad(t_sig, p, 0);
  let d = depthAt(p);
  if (d <= 0.0 || d >= 1.0) { // sky: pass through, no history
    textureStore(o_hist, p, vec4f(sig.rgb, 0.0));
    textureStore(o_P, p, vec4f(0.0));
    return;
  }
  let dims = vec2f(u.dims);
  // sample position = pixel centre + jitter
  let uv = (vec2f(p) + 0.5 + u.jitter) / dims;
  let ndc = vec2f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);
  let w4 = u.invViewProj * vec4f(ndc, d, 1.0);
  let P = vec4f(w4.xyz / w4.w, 1.0);
  let z = (u.view * P).z;
  let n = textureLoad(t_normal, p, 0).xyz;
  var acc = vec4f(0.0);
  var wsum = 0.0;
  if (u.reset == 0u) {
    if (u.reproject != 0u) {
      let m = textureLoad(t_motion, p, 0).xy;            // NDC delta, current - previous, +y up
      // previous (unjittered) position -> previous texel space (its samples sat at +0.5 + prevJitter)
      let sp = (uv - vec2f(0.5 * m.x, -0.5 * m.y)) * dims - 0.5 - u.prevJitter;
      let fl = floor(sp);
      let f = sp - fl;
      let base = vec2i(fl);
      for (var k = 0; k < 4; k++) {
        let o = vec2i(k & 1, k >> 1u);
        let q = base + o;
        if (any(q < vec2i(0)) || any(q >= vec2i(u.dims))) { continue; }
        let hp = textureLoad(t_histP, q, 0);
        if (hp.w == 0.0 || abs(dot(n, hp.xyz - P.xyz)) > u.tol * abs(z)) { continue; }
        let wb = select(1.0 - f.x, f.x, o.x == 1) * select(1.0 - f.y, f.y, o.y == 1);
        acc += wb * textureLoad(t_hist, q, 0);
        wsum += wb;
      }
    } else if (textureLoad(t_histP, p, 0).w != 0.0) {
      acc = textureLoad(t_hist, p, 0);
      wsum = 1.0;
    }
  }
  var mean = vec3f(0.0);
  var len = 0.0;
  if (wsum > 1e-4) { let h = acc / wsum; mean = h.rgb; len = h.a; }
  len = min(len + 1.0, u.maxFrames);
  mean += (sig.rgb - mean) / len;
  textureStore(o_hist, p, vec4f(mean, len));
  textureStore(o_P, p, vec4f(P.xyz, 1.0));
}`;

export class AccumulateDenoiser implements TemporalDenoiser<AccumulateInputs> {
  readonly name: string;
  readonly gpuTimings = new Map<string, number>();
  private readonly opts: Required<AccumulateOptions>;
  private pipes = new Map<boolean, GPUComputePipeline>();
  private hist: GPUTexture[] = [];
  private histP: GPUTexture[] = [];
  private cur = 0;
  private needReset = true;
  private prevJitter: [number, number] = [0, 0];
  private uniform: GPUBuffer;
  private query?: { set: GPUQuerySet; resolve: GPUBuffer; read: GPUBuffer; busy: boolean };

  constructor(readonly device: GPUDevice, options: AccumulateOptions = {}) {
    this.opts = { reproject: options.reproject ?? true, maxFrames: options.maxFrames ?? 4096, depthTolerance: options.depthTolerance ?? 0.01 };
    this.name = this.opts.reproject ? 'accumulate' : 'accumulate-static';
    this.uniform = device.createBuffer({ label: 'accumulate uniforms', size: 304, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    if (device.features.has('timestamp-query')) {
      this.query = {
        set: device.createQuerySet({ type: 'timestamp', count: 2 }),
        resolve: device.createBuffer({ size: 16, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC }),
        read: device.createBuffer({ size: 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }),
        busy: false,
      };
    }
  }

  private pipe(depthTex: boolean) {
    let p = this.pipes.get(depthTex);
    if (!p) {
      const C = GPUShaderStage.COMPUTE;
      const layout = this.device.createBindGroupLayout({
        entries: [
          { binding: 0, visibility: C, buffer: { type: 'uniform' } },
          { binding: 1, visibility: C, texture: { sampleType: 'unfilterable-float' } },
          { binding: 2, visibility: C, texture: { sampleType: depthTex ? 'depth' : 'unfilterable-float' } },
          { binding: 3, visibility: C, texture: { sampleType: 'unfilterable-float' } },
          { binding: 4, visibility: C, texture: { sampleType: 'unfilterable-float' } },
          { binding: 5, visibility: C, texture: { sampleType: 'unfilterable-float' } },
          { binding: 6, visibility: C, storageTexture: { access: 'write-only', format: 'rgba32float' } },
          { binding: 7, visibility: C, storageTexture: { access: 'write-only', format: 'rgba32float' } },
          { binding: 8, visibility: C, texture: { sampleType: 'unfilterable-float' } },
        ],
      });
      p = this.device.createComputePipeline({
        label: `accumulate (${depthTex ? 'depth' : 'float'} depth)`,
        layout: this.device.createPipelineLayout({ bindGroupLayouts: [layout] }),
        compute: { module: this.device.createShaderModule({ code: WGSL(depthTex) }), entryPoint: 'main' },
      });
      this.pipes.set(depthTex, p);
    }
    return p;
  }

  configure({ width, height }: TemporalConfig): void {
    for (const t of [...this.hist, ...this.histP]) t.destroy();
    const usage = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC;
    const tex = (label: string, format: GPUTextureFormat) => this.device.createTexture({ label: `accumulate ${label}`, size: [width, height], format, usage });
    this.hist = [tex('hist0', 'rgba32float'), tex('hist1', 'rgba32float')];
    this.histP = [tex('pos0', 'rgba32float'), tex('pos1', 'rgba32float')];
    this.needReset = true;
  }

  resetHistory(): void { this.needReset = true; }

  dispatch(inputs: AccumulateInputs, guides: FrameGuides, camera: FrameCamera): GPUTexture {
    if (!this.hist.length) throw new Error('AccumulateDenoiser: call configure() first');
    const sig = inputs.radiance ?? inputs.visibility;
    if (!sig) throw new Error('AccumulateDenoiser: needs inputs.radiance or inputs.visibility');
    const { width, height } = this.hist[0];
    const prev = this.cur;
    this.cur ^= 1;
    const b = new ArrayBuffer(304);
    const f = new Float32Array(b), u = new Uint32Array(b);
    f.set(invert(mul(camera.projection, camera.view)), 0);
    f.set(Array.from(camera.view), 16);
    u[64] = width; u[65] = height; u[66] = this.needReset ? 1 : 0; u[67] = this.opts.reproject ? 1 : 0;
    f[68] = this.opts.maxFrames; f[69] = this.opts.depthTolerance;
    const jit = camera.jitter ?? [0, 0];
    f[72] = jit[0]; f[73] = jit[1];
    f[74] = this.prevJitter[0]; f[75] = this.prevJitter[1];
    this.prevJitter = [jit[0], jit[1]];
    this.device.queue.writeBuffer(this.uniform, 0, b);
    this.needReset = false;

    const depthTex = guides.depth.format.startsWith('depth');
    const pipe = this.pipe(depthTex);
    const v = (t: GPUTexture) => t.createView();
    const bg = this.device.createBindGroup({
      layout: pipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniform } },
        { binding: 1, resource: v(sig) },
        { binding: 2, resource: depthTex ? guides.depth.createView({ aspect: 'depth-only' }) : v(guides.depth) },
        { binding: 3, resource: v(guides.motion) },
        { binding: 4, resource: v(this.hist[prev]) },
        { binding: 5, resource: v(this.histP[prev]) },
        { binding: 6, resource: v(this.hist[this.cur]) },
        { binding: 7, resource: v(this.histP[this.cur]) },
        { binding: 8, resource: v(guides.normal) },
      ],
    });
    const q = this.query && !this.query.busy ? this.query : undefined;
    const enc = this.device.createCommandEncoder({ label: this.name });
    const pass = enc.beginComputePass(q ? { timestampWrites: { querySet: q.set, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 } } : {});
    pass.setPipeline(pipe);
    pass.setBindGroup(0, bg);
    pass.dispatchWorkgroups(Math.ceil(width / 8), Math.ceil(height / 8));
    pass.end();
    if (q) {
      enc.resolveQuerySet(q.set, 0, 2, q.resolve, 0);
      enc.copyBufferToBuffer(q.resolve, 0, q.read, 0, 16);
    }
    this.device.queue.submit([enc.finish()]);
    if (q) {
      q.busy = true;
      q.read.mapAsync(GPUMapMode.READ).then(() => {
        const t = new BigUint64Array(q.read.getMappedRange());
        const ms = Number(t[1] - t[0]) / 1e6;
        q.read.unmap();
        q.busy = false;
        this.gpuTimings.set('accumulate', ms);
        this.gpuTimings.set('total', ms);
      }).catch(() => { q.busy = false; });
    }
    return this.hist[this.cur];
  }

  dispose(): void {
    for (const t of [...this.hist, ...this.histP]) t.destroy();
    this.hist = []; this.histP = [];
    this.uniform.destroy();
    this.query?.set.destroy(); this.query?.resolve.destroy(); this.query?.read.destroy();
  }
}

// column-major mat4 helpers (float64 math, float32 result)
function mul(a: ArrayLike<number>, b: ArrayLike<number>): Float64Array {
  const o = new Float64Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
    o[c * 4 + r] = s;
  }
  return o;
}

function invert(m: ArrayLike<number>): Float32Array {
  const a = Array.from({ length: 4 }, (_, r) => Array.from({ length: 8 }, (_, c) => (c < 4 ? m[c * 4 + r] : c - 4 === r ? 1 : 0)));
  for (let c = 0; c < 4; c++) {
    let p = c;
    for (let r = c + 1; r < 4; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
    [a[c], a[p]] = [a[p], a[c]];
    const d = a[c][c];
    for (let k = 0; k < 8; k++) a[c][k] /= d;
    for (let r = 0; r < 4; r++) if (r !== c) {
      const fac = a[r][c];
      for (let k = 0; k < 8; k++) a[r][k] -= fac * a[c][k];
    }
  }
  const o = new Float32Array(16);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) o[c * 4 + r] = a[r][c + 4];
  return o;
}
