// GPU-side scoring. Three pieces:
//
//   HistoryAge  per-pixel "frames of valid history" from the GROUND-TRUTH geometry:
//               reproject with motion, keep the history if a previous-frame texel in
//               the 2x2 footprint has viewZ within tol of the expected previous viewZ
//               (viewZ + motion_z), tol = 1 % |viewZ| + 2 x the local viewZ slope per
//               pixel (robust one-sided differences, so grazing surfaces aren't
//               flagged and depth edges still are). 0 on resets, off-screen reveals
//               and disocclusions. Region "disoccluded" = age < k (default 8).
//   Scorer      one per (signal, denoiser): per-frame partial sums for PSNR per region
//               (all receivers, penumbra, disoccluded, 4 roughness bins), mean signed
//               error (bias), linear-luminance energy ratio, and temporal stability:
//               the frame-to-frame change of the error e = val(out) - val(ref),
//               motion-compensated (previous error fetched at the reprojected pixel,
//               only where the history is valid). flickerMc = mean |e_t - e_{t-1}|,
//               temporal PSNR = -10 log10(mean (e_t - e_{t-1})^2). Also the
//               fixed-pixel flicker of examples/ffx-denoiser / rt-capture compare.mjs
//               (same pixel, channel-mean signed error), for comparable numbers. Since
//               e_t - e_{t-1} = (out_t - out_{t-1}) - (ref_t - ref_{t-1}), this is the
//               usual "temporal difference vs the reference's temporal difference".
//   packLdr     tonemapped LDR copy of a texture for the CPU-side FLIP (flip.ts).
//
// val(): shadows score visibility clamped to [0,1]; diffuse / specular score each
// channel after a Reinhard x/(1+x) tonemap (as examples/ffx-denoiser), so a few hot
// pixels don't dominate. Only receivers (depth < 1) are scored.
import { DEPTH_TOL_WGSL } from '../../../tools/rt-capture/src/accumulate-ema';

/** Depth tolerance for history tests: 1 % of |z| + 2 x the robust local slope of z per
 * pixel (per axis the smaller one-sided difference, so a depth edge on one side does
 * not inflate it). One definition, shared with the `accumulate-32` baseline
 * (tools/rt-capture/src/accumulate-ema.ts), so both reject history with the same test. */
export const SLOPE_WGSL = DEPTH_TOL_WGSL;

export const AGE_WGSL = /* wgsl */ `
struct A { dims: vec2u, reset: u32, _p: u32 };
@group(0) @binding(0) var<uniform> a: A;
@group(0) @binding(1) var t_motion: texture_2d<f32>;
@group(0) @binding(2) var t_viewz: texture_2d<f32>;
@group(0) @binding(3) var t_motionz: texture_2d<f32>;
@group(0) @binding(4) var t_prevViewz: texture_2d<f32>;
@group(0) @binding(5) var t_prevAge: texture_2d<f32>;
@group(0) @binding(6) var o_age: texture_storage_2d<r32float, write>;

${SLOPE_WGSL}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= a.dims)) { return; }
  let pix = vec2i(id.xy);
  var age = 0.0;
  if (a.reset == 0u) {
    let m = textureLoad(t_motion, pix, 0).xy;
    let expected = textureLoad(t_viewz, pix, 0).r + textureLoad(t_motionz, pix, 0).r;
    let prevPos = vec2f(id.xy) + 0.5 - vec2f(m.x, -m.y) * 0.5 * vec2f(a.dims) - 0.5;
    let base = vec2i(floor(prevPos));
    let fr = prevPos - vec2f(base);
    var bestW = -1.0;
    for (var k = 0; k < 4; k++) {
      let o = vec2i(k & 1, k >> 1);
      let q = base + o;
      if (any(q < vec2i(0)) || any(q >= vec2i(a.dims))) { continue; }
      let w = select(1.0 - fr.x, fr.x, o.x == 1) * select(1.0 - fr.y, fr.y, o.y == 1);
      let pz = textureLoad(t_prevViewz, q, 0).r;
      if (abs(pz - expected) <= depthTol(t_viewz, pix, a.dims) && w > bestW) {
        bestW = w;
        age = min(textureLoad(t_prevAge, q, 0).r + 1.0, 65535.0);
      }
    }
  }
  textureStore(o_age, pix, vec4f(age));
}
`;

export const SLOTS = 11;
export const REGIONS = ['all', 'penumbra', 'disoccluded', 'rough<0.15', 'rough<0.35', 'rough<0.6', 'rough>=0.6'] as const;

export const SCORE_WGSL = /* wgsl */ `
struct M { dims: vec2u, mode: u32, validPrev: u32, ageK: f32, hasPen: u32, _p: vec2u };
@group(0) @binding(0) var<uniform> m: M;
@group(0) @binding(1) var t_noisy: texture_2d<f32>;
@group(0) @binding(2) var t_den: texture_2d<f32>;
@group(0) @binding(3) var t_ref: texture_2d<f32>;
@group(0) @binding(4) var t_depth: texture_2d<f32>;
@group(0) @binding(5) var t_rough: texture_2d<f32>;
@group(0) @binding(6) var t_age: texture_2d<f32>;
@group(0) @binding(7) var t_motion: texture_2d<f32>;
@group(0) @binding(8) var t_pen: texture_2d<f32>;
@group(0) @binding(9) var t_prevEN: texture_2d<f32>;
@group(0) @binding(10) var t_prevED: texture_2d<f32>;
@group(0) @binding(11) var o_EN: texture_storage_2d<rgba32float, write>;
@group(0) @binding(12) var o_ED: texture_storage_2d<rgba32float, write>;
@group(0) @binding(13) var<storage, read_write> partials: array<vec4f>;

const NS: u32 = ${SLOTS}u;
var<workgroup> sh: array<vec4f, 256>;

fn bad(c: vec4f) -> f32 {
  let u = bitcast<vec4u>(c) & vec4u(0x7f800000u);
  return select(0.0, 1.0, any(u == vec4u(0x7f800000u)));
}
fn val(c: vec4f) -> vec3f {
  if (m.mode == 0u) { return vec3f(clamp(c.r, 0.0, 1.0)); }
  let x = max(c.rgb, vec3f(0.0));
  return x / (1.0 + x);
}
fn lum(c: vec4f) -> f32 {
  if (m.mode == 0u) { return clamp(c.r, 0.0, 1.0); }
  return dot(max(c.rgb, vec3f(0.0)), vec3f(0.2126, 0.7152, 0.0722));
}

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) id: vec3u, @builtin(local_invocation_index) li: u32,
        @builtin(workgroup_id) wg: vec3u, @builtin(num_workgroups) nwg: vec3u) {
  var s: array<vec4f, ${SLOTS}>;
  for (var i = 0u; i < NS; i++) { s[i] = vec4f(0.0); }
  if (all(id.xy < m.dims)) {
    let pix = vec2i(id.xy);
    let cn = textureLoad(t_noisy, pix, 0);
    let cd = textureLoad(t_den, pix, 0);
    let cr = textureLoad(t_ref, pix, 0);
    s[9].x = bad(cn) + 2.0 * bad(cr);
    s[9].y = bad(cd);
    let d = textureLoad(t_depth, pix, 0).r;
    var en = vec3f(0.0);
    var ed = vec3f(0.0);
    if (d > 0.0 && d < 1.0) {
      let r = val(cr);
      en = val(cn) - r;
      ed = val(cd) - r;
      let reg = vec4f(dot(en, en) / 3.0, dot(ed, ed) / 3.0, 1.0, (ed.x + ed.y + ed.z) / 3.0);
      s[0] = reg;
      s[9].z = (en.x + en.y + en.z) / 3.0;
      if (m.hasPen != 0u) {
        // hasPen 1: penumbra (shadows, 0.02 < ref visibility < 0.98); 2: contact region of the
        // occlusion signals (T5: reference ao / so < 0.5), reported as 'contact'
        let pv = textureLoad(t_pen, pix, 0).r;
        if (select(pv > 0.02 && pv < 0.98, pv < 0.5, m.hasPen == 2u)) { s[1] = reg; }
      }
      let age = textureLoad(t_age, pix, 0).r;
      if (age < m.ageK) { s[2] = reg; }
      let rough = textureLoad(t_rough, pix, 0).r;
      let bin = select(select(select(6u, 5u, rough < 0.6), 4u, rough < 0.35), 3u, rough < 0.15);
      s[bin] = reg;
      s[8] = vec4f(lum(cd), lum(cr), lum(cn), 0.0);
      if (m.validPrev != 0u && age >= 1.0) {
        let mo = textureLoad(t_motion, pix, 0).xy;
        let prevPos = vec2f(id.xy) + 0.5 - vec2f(mo.x, -mo.y) * 0.5 * vec2f(m.dims);
        let q = clamp(vec2i(floor(prevPos)), vec2i(0), vec2i(m.dims) - 1);
        let dd = ed - textureLoad(t_prevED, q, 0).rgb;
        let dn = en - textureLoad(t_prevEN, q, 0).rgb;
        s[7] = vec4f((abs(dd.x) + abs(dd.y) + abs(dd.z)) / 3.0, dot(dd, dd) / 3.0, (abs(dn.x) + abs(dn.y) + abs(dn.z)) / 3.0, 1.0);
        s[8].w = dot(dn, dn) / 3.0;
      }
      if (m.validPrev != 0u) {
        // fixed-pixel flicker (examples/ffx-denoiser and tools/rt-capture/compare.mjs definition):
        // |s_t - s_{t-1}| with s = mean over channels of e, same pixel, no motion compensation
        let pd = textureLoad(t_prevED, pix, 0).rgb;
        let pn = textureLoad(t_prevEN, pix, 0).rgb;
        s[10] = vec4f(abs((ed.x + ed.y + ed.z) - (pd.x + pd.y + pd.z)) / 3.0, abs((en.x + en.y + en.z) - (pn.x + pn.y + pn.z)) / 3.0, 1.0, 0.0);
      }
    }
    textureStore(o_EN, pix, vec4f(en, 0.0));
    textureStore(o_ED, pix, vec4f(ed, 0.0));
  }
  let w = wg.y * nwg.x + wg.x;
  for (var i = 0u; i < NS; i++) {
    sh[li] = s[i];
    workgroupBarrier();
    for (var k = 128u; k > 0u; k >>= 1u) {
      if (li < k) { sh[li] += sh[li + k]; }
      workgroupBarrier();
    }
    if (li == 0u) { partials[NS * w + i] = sh[0]; }
    workgroupBarrier();
  }
}
`;

// tonemapped LDR copy for FLIP: 3 x 10 bits of sqrt(val) + bit 30 = receiver.
// Non-receivers take the reference's value (zero error there).
export const PACK_WGSL = /* wgsl */ `
struct K { dims: vec2u, mode: u32, _p: u32 };
@group(0) @binding(0) var<uniform> k: K;
@group(0) @binding(1) var t_in: texture_2d<f32>;
@group(0) @binding(2) var t_ref: texture_2d<f32>;
@group(0) @binding(3) var t_depth: texture_2d<f32>;
@group(0) @binding(4) var<storage, read_write> o: array<u32>;
fn val(c: vec4f) -> vec3f {
  if (k.mode == 0u) { return vec3f(clamp(c.r, 0.0, 1.0)); }
  let x = max(c.rgb, vec3f(0.0));
  return x / (1.0 + x);
}
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= k.dims)) { return; }
  let pix = vec2i(id.xy);
  let d = textureLoad(t_depth, pix, 0).r;
  let recv = d > 0.0 && d < 1.0;
  var v = val(textureLoad(t_ref, pix, 0));
  if (recv) { v = val(textureLoad(t_in, pix, 0)); }
  // NaN-safe: NaN fails the comparisons inside clamp on some backends; force to 1
  let ok = v == v;
  v = select(vec3f(1.0), v, ok);
  let q = vec3u(round(sqrt(clamp(v, vec3f(0.0), vec3f(1.0))) * 1023.0));
  o[id.y * k.dims.x + id.x] = q.x | (q.y << 10u) | (q.z << 20u) | select(0u, 1u << 30u, recv);
}
`;

const U = GPUBufferUsage;
const bindAll = (device: GPUDevice, pipe: GPUComputePipeline, res: (GPUTexture | GPUBuffer)[]) => device.createBindGroup({
  layout: pipe.getBindGroupLayout(0),
  entries: res.map((r, i) => ({ binding: i, resource: r instanceof GPUBuffer ? { buffer: r } : r.createView() })),
});

export class HistoryAge {
  readonly age: GPUTexture[];
  private prevViewz: GPUTexture;
  private pipe: GPUComputePipeline;
  private u: GPUBuffer;
  private cur = 0;
  constructor(private device: GPUDevice, private W: number, private H: number) {
    const usage = GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC;
    this.age = [0, 1].map((i) => device.createTexture({ label: `age ${i}`, size: [W, H], format: 'r32float', usage }));
    this.prevViewz = device.createTexture({ label: 'prev viewz', size: [W, H], format: 'r32float', usage });
    this.pipe = device.createComputePipeline({ label: 'age', layout: 'auto', compute: { module: device.createShaderModule({ code: AGE_WGSL }), entryPoint: 'main' } });
    this.u = device.createBuffer({ size: 16, usage: U.UNIFORM | U.COPY_DST });
  }
  /** current age texture (valid after update()) */
  get current() { return this.age[this.cur]; }
  update(t: { motion: GPUTexture; viewz: GPUTexture; motionZ: GPUTexture }, reset: boolean) {
    const prev = this.cur;
    this.cur ^= 1;
    this.device.queue.writeBuffer(this.u, 0, new Uint32Array([this.W, this.H, reset ? 1 : 0, 0]));
    const enc = this.device.createCommandEncoder({ label: 'age' });
    const pass = enc.beginComputePass();
    pass.setPipeline(this.pipe);
    pass.setBindGroup(0, bindAll(this.device, this.pipe, [this.u, t.motion, t.viewz, t.motionZ, this.prevViewz, this.age[prev], this.age[this.cur]]));
    pass.dispatchWorkgroups(Math.ceil(this.W / 8), Math.ceil(this.H / 8));
    pass.end();
    enc.copyTextureToTexture({ texture: t.viewz }, { texture: this.prevViewz }, [this.W, this.H]);
    this.device.queue.submit([enc.finish()]);
  }
}

export interface FrameScore {
  /** per region: [sseNoisy, sseDen, count, signedErrDen] (sums) */
  regions: number[][];
  /** [sum |de_den|, sum de_den^2, sum |de_noisy|, count] */
  temporal: number[];
  lum: { den: number; ref: number; noisy: number };
  sumDeNoisy2: number;
  sumErrNoisy: number;
  nonFiniteInputs: number;
  nonFiniteDenoised: number;
  /** fixed-pixel flicker sums: [sum |ds_den|, sum |ds_noisy|, count] */
  fixedFlicker: number[];
}

export class Scorer {
  private pipe: GPUComputePipeline;
  private u: GPUBuffer;
  private eN: GPUTexture[];
  private eD: GPUTexture[];
  private partials: GPUBuffer;
  private readback: GPUBuffer;
  private cur = 0;
  private wg: [number, number];
  constructor(private device: GPUDevice, private W: number, private H: number, pipe: GPUComputePipeline) {
    this.pipe = pipe;
    const usage = GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING;
    const t = (l: string) => device.createTexture({ label: l, size: [W, H], format: 'rgba32float', usage });
    this.eN = [t('eN0'), t('eN1')];
    this.eD = [t('eD0'), t('eD1')];
    this.wg = [Math.ceil(W / 16), Math.ceil(H / 16)];
    const size = this.wg[0] * this.wg[1] * SLOTS * 16;
    this.partials = device.createBuffer({ size, usage: U.STORAGE | U.COPY_SRC });
    this.readback = device.createBuffer({ size, usage: U.MAP_READ | U.COPY_DST });
    this.u = device.createBuffer({ size: 32, usage: U.UNIFORM | U.COPY_DST });
  }
  static pipeline(device: GPUDevice) {
    return device.createComputePipeline({ label: 'score', layout: 'auto', compute: { module: device.createShaderModule({ label: 'score', code: SCORE_WGSL }), entryPoint: 'main' } });
  }
  async score(o: {
    noisy: GPUTexture; den: GPUTexture; ref: GPUTexture; depth: GPUTexture; rough: GPUTexture; age: GPUTexture;
    motion: GPUTexture; pen?: GPUTexture; scalar: boolean; validPrev: boolean; ageK: number;
    /** `pen` is an occlusion reference: region 1 = contact (ref < 0.5) instead of penumbra */
    contact?: boolean;
  }): Promise<FrameScore> {
    const prev = this.cur;
    this.cur ^= 1;
    const b = new ArrayBuffer(32);
    const u = new Uint32Array(b), f = new Float32Array(b);
    u[0] = this.W; u[1] = this.H; u[2] = o.scalar ? 0 : 1; u[3] = o.validPrev ? 1 : 0; f[4] = o.ageK; u[5] = o.pen ? (o.contact ? 2 : 1) : 0;
    this.device.queue.writeBuffer(this.u, 0, b);
    const enc = this.device.createCommandEncoder({ label: 'score' });
    const pass = enc.beginComputePass();
    pass.setPipeline(this.pipe);
    pass.setBindGroup(0, bindAll(this.device, this.pipe, [this.u, o.noisy, o.den, o.ref, o.depth, o.rough, o.age, o.motion, o.pen ?? o.ref,
      this.eN[prev], this.eD[prev], this.eN[this.cur], this.eD[this.cur], this.partials]));
    pass.dispatchWorkgroups(...this.wg);
    pass.end();
    enc.copyBufferToBuffer(this.partials, 0, this.readback, 0, this.partials.size);
    this.device.queue.submit([enc.finish()]);
    await this.readback.mapAsync(GPUMapMode.READ);
    const a = new Float32Array(this.readback.getMappedRange());
    const s = new Float64Array(SLOTS * 4);
    for (let i = 0; i < a.length; i += SLOTS * 4) for (let k = 0; k < SLOTS * 4; k++) s[k] += a[i + k];
    this.readback.unmap();
    const slot = (i: number) => [s[4 * i], s[4 * i + 1], s[4 * i + 2], s[4 * i + 3]];
    return {
      regions: REGIONS.map((_, i) => slot(i)),
      temporal: slot(7),
      lum: { den: s[32], ref: s[33], noisy: s[34] },
      sumDeNoisy2: s[35],
      sumErrNoisy: s[38],
      nonFiniteInputs: s[36],
      nonFiniteDenoised: s[37],
      fixedFlicker: [s[40], s[41], s[42]],
    };
  }
}

/** LDR packer for FLIP: GPU pack + readback into a Uint32Array */
export class LdrPacker {
  private pipe: GPUComputePipeline;
  private u: GPUBuffer;
  private buf: GPUBuffer;
  private rb: GPUBuffer;
  constructor(private device: GPUDevice, private W: number, private H: number) {
    this.pipe = device.createComputePipeline({ label: 'pack', layout: 'auto', compute: { module: device.createShaderModule({ code: PACK_WGSL }), entryPoint: 'main' } });
    this.u = device.createBuffer({ size: 16, usage: U.UNIFORM | U.COPY_DST });
    this.buf = device.createBuffer({ size: W * H * 4, usage: U.STORAGE | U.COPY_SRC });
    this.rb = device.createBuffer({ size: W * H * 4, usage: U.MAP_READ | U.COPY_DST });
  }
  async pack(tex: GPUTexture, ref: GPUTexture, depth: GPUTexture, scalar: boolean): Promise<Uint32Array> {
    this.device.queue.writeBuffer(this.u, 0, new Uint32Array([this.W, this.H, scalar ? 0 : 1, 0]));
    const enc = this.device.createCommandEncoder({ label: 'pack' });
    const pass = enc.beginComputePass();
    pass.setPipeline(this.pipe);
    pass.setBindGroup(0, bindAll(this.device, this.pipe, [this.u, tex, ref, depth, this.buf]));
    pass.dispatchWorkgroups(Math.ceil(this.W / 8), Math.ceil(this.H / 8));
    pass.end();
    enc.copyBufferToBuffer(this.buf, 0, this.rb, 0, this.buf.size);
    this.device.queue.submit([enc.finish()]);
    await this.rb.mapAsync(GPUMapMode.READ);
    const out = new Uint32Array(this.rb.getMappedRange().slice(0));
    this.rb.unmap();
    return out;
  }
}
