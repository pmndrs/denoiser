// Test-bed baselines (not part of any package):
//
//   PassthroughDenoiser   returns the noisy input unchanged (the "no denoiser" row)
//   AccumulateDenoiser    plain temporal accumulation with reprojection, no spatial
//                         filter, no clamping: per-pixel history length n (capped at
//                         maxFrames), weight 1/n -> a linear (cumulative) average for
//                         the first maxFrames frames, then an exponential moving
//                         average with alpha = 1/maxFrames. History is fetched
//                         bilinearly at the motion-reprojected position; each of the
//                         4 taps is kept only if its stored linear depth matches the
//                         expected previous depth (-(viewZ + motionZ), 2.5D motion)
//                         within 1 % + 2x the local depth slope (metrics.ts depthTol,
//                         the same test as the ground-truth history age). This is the textbook baseline every temporal
//                         denoiser must beat; it shows ghosting/lag (no anti-lag) and
//                         fresh noise in disocclusions (no spatial fallback).
import type { FrameCamera, FrameGuides, TemporalConfig, TemporalDenoiser } from '@pmndrs/denoiser-ffx';
import { SLOPE_WGSL } from './metrics';

export interface SignalInputs {
  /** noisy signal: rgb radiance, or a scalar in .r (visibility) */
  signal: GPUTexture;
}

/** Guides as the test bed hands them (viewZ / motionZ are the optional 2.5D fields). */
export type TestbedGuides = FrameGuides & { viewZ: GPUTexture; motionZ: GPUTexture };

export class PassthroughDenoiser implements TemporalDenoiser<SignalInputs> {
  readonly name = 'passthrough';
  constructor(readonly device: GPUDevice) {}
  configure(_c: TemporalConfig): void { /* stateless */ }
  dispatch(inputs: SignalInputs): GPUTexture { return inputs.signal; }
  resetHistory(): void { /* stateless */ }
  dispose(): void { /* nothing owned */ }
}

const ACC_WGSL = /* wgsl */ `
struct P { dims: vec2u, reset: u32, _p: u32, maxFrames: f32, _r: f32, _q: vec2f };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var t_cur: texture_2d<f32>;
@group(0) @binding(2) var t_viewz: texture_2d<f32>;
@group(0) @binding(3) var t_motion: texture_2d<f32>;
@group(0) @binding(4) var t_motionz: texture_2d<f32>;
@group(0) @binding(5) var t_hist: texture_2d<f32>;
@group(0) @binding(6) var t_prevLin: texture_2d<f32>;
@group(0) @binding(7) var o_color: texture_storage_2d<rgba16float, write>;
@group(0) @binding(8) var o_lin: texture_storage_2d<r32float, write>;
${SLOPE_WGSL}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= p.dims)) { return; }
  let pix = vec2i(id.xy);
  let cur = textureLoad(t_cur, pix, 0);
  let vz = textureLoad(t_viewz, pix, 0).r;
  let lin = -vz;
  textureStore(o_lin, pix, vec4f(lin));
  var hist = vec3f(0.0);
  var n = 0.0;
  if (p.reset == 0u) {
    let m = textureLoad(t_motion, pix, 0).xy;
    let expected = -(vz + textureLoad(t_motionz, pix, 0).r);
    // NDC delta -> pixel delta (NDC +y is up, texel rows go down)
    let prevPos = vec2f(id.xy) + 0.5 - vec2f(m.x, -m.y) * 0.5 * vec2f(p.dims) - 0.5;
    let base = vec2i(floor(prevPos));
    let tol = depthTol(t_viewz, pix, p.dims);
    let fr = prevPos - vec2f(base);
    var wsum = 0.0;
    for (var k = 0; k < 4; k++) {
      let o = vec2i(k & 1, k >> 1);
      let q = base + o;
      if (any(q < vec2i(0)) || any(q >= vec2i(p.dims))) { continue; }
      let w = select(1.0 - fr.x, fr.x, o.x == 1) * select(1.0 - fr.y, fr.y, o.y == 1);
      let pl = textureLoad(t_prevLin, q, 0).r;
      if (abs(pl - expected) > tol) { continue; }
      let h = textureLoad(t_hist, q, 0);
      hist += h.rgb * w;
      n += h.a * w;
      wsum += w;
    }
    if (wsum > 1e-3) { hist /= wsum; n /= wsum; } else { n = 0.0; }
  }
  let n1 = min(n + 1.0, p.maxFrames);
  let c = mix(hist, cur.rgb, 1.0 / n1);
  textureStore(o_color, pix, vec4f(c, n1));
}
`;

export interface AccumulateOptions { maxFrames?: number }

export class AccumulateDenoiser implements TemporalDenoiser<SignalInputs> {
  readonly name: string;
  private pipe: GPUComputePipeline;
  private params: GPUBuffer;
  private color: GPUTexture[] = [];
  private lin: GPUTexture[] = [];
  private frame = 0;
  private needsReset = true;
  private W = 0;
  private H = 0;
  private maxFrames: number;

  constructor(readonly device: GPUDevice, opts: AccumulateOptions = {}) {
    this.maxFrames = opts.maxFrames ?? 32;
    this.name = `accumulate-${this.maxFrames}`;
    this.pipe = device.createComputePipeline({
      label: 'accumulate', layout: 'auto',
      compute: { module: device.createShaderModule({ label: 'accumulate', code: ACC_WGSL }), entryPoint: 'main' },
    });
    this.params = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  }

  configure({ width, height }: TemporalConfig): void {
    this.destroyTargets();
    this.W = width; this.H = height;
    const usage = GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC;
    const t = (format: GPUTextureFormat, label: string) => this.device.createTexture({ label, size: [width, height], format, usage });
    this.color = [t('rgba16float', 'acc color 0'), t('rgba16float', 'acc color 1')];
    this.lin = [t('r32float', 'acc lin 0'), t('r32float', 'acc lin 1')];
    this.needsReset = true;
    this.frame = 0;
  }

  resetHistory(): void { this.needsReset = true; }

  dispatch(inputs: SignalInputs, guides: FrameGuides, _camera: FrameCamera): GPUTexture {
    const g = guides as TestbedGuides;
    if (!g.viewZ || !g.motionZ) throw new Error('AccumulateDenoiser needs guides.viewZ and guides.motionZ');
    const cur = this.frame & 1, prev = cur ^ 1;
    const b = new ArrayBuffer(32);
    const u = new Uint32Array(b), f = new Float32Array(b);
    u[0] = this.W; u[1] = this.H; u[2] = this.needsReset ? 1 : 0;
    f[4] = this.maxFrames;
    this.device.queue.writeBuffer(this.params, 0, b);
    const bg = this.device.createBindGroup({
      layout: this.pipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.params } },
        ...[inputs.signal, g.viewZ, guides.motion, g.motionZ, this.color[prev], this.lin[prev], this.color[cur], this.lin[cur]]
          .map((t, i) => ({ binding: i + 1, resource: t.createView() })),
      ],
    });
    const enc = this.device.createCommandEncoder({ label: 'accumulate' });
    const pass = enc.beginComputePass();
    pass.setPipeline(this.pipe); pass.setBindGroup(0, bg);
    pass.dispatchWorkgroups(Math.ceil(this.W / 8), Math.ceil(this.H / 8));
    pass.end();
    this.device.queue.submit([enc.finish()]);
    this.needsReset = false;
    this.frame++;
    return this.color[cur];
  }

  private destroyTargets() {
    for (const t of [...this.color, ...this.lin]) t.destroy();
    this.color = []; this.lin = [];
  }

  dispose(): void { this.destroyTargets(); this.params.destroy(); }
}
