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
//   Dynamic / static split (moving shadows; results/M4.md "Moving shadows"): inside Scorer, a pixel
//               is *dynamic* in frame t when its reference value changed by more than DYN_DELTA (0.05)
//               within the last DYN_K (4) frames: the range of its reference over frames t-4..t,
//               the older values carried along the history (reprojected through the footprint tap
//               whose previous reference is closest, valid history only; static camera: the same
//               pixel). Same definition as tools/rt-capture/compare.mjs. Regions 'dynamic', 'static' and 'static-penumbra' are plain regions
//               (pooled PSNR, bias). 'dynamic-temporal' / 'static-temporal' reuse the region record for
//               the motion-compensated temporal sums of that region: there psnrNoisy / psnrDen are the
//               TEMPORAL PSNR (-10 log10 mean (e_t - e_t-1)^2) and biasDen is the motion-compensated
//               flicker (mean |e_t - e_t-1|) of the denoised output.
//
// val(): shadows score visibility clamped to [0,1]; diffuse / specular score each
// channel after a Reinhard x/(1+x) tonemap (as examples/ffx-denoiser), so a few hot
// pixels don't dominate; shadow-rgb (v1) scores each rgb channel clamped to [0, 1] (mode 2: it is a
// transmittance, SPEC M8-10). Only receivers (depth < 1) are scored.
//
// CAPTURE-FORMAT v1 additions (testbed-v1; same definitions as tools/rt-capture/compare.mjs):
//   penumbra   hasPen 3 (shadow-rgb): any channel of the rgb reference in (0.02, 0.98)
//   'tint'     (shadow-rgb) reference chroma max_c - min_c > 0.02; plus the chroma error there,
//              mean over pixels of mean_c |S_c / sum S - R_c / sum R| (sums floored at 1e-4)
//   'bump'     (sh-*) the bump mask: angle(normal, normal_geom) > 5 deg
//   floorFrac  (sh-*) fraction of scored pixels whose output rgb is exactly 0 (M7-13 ringing: the
//              resolve's max(0, .) floor)
//   DetailBand (sh-*) in the bump mask: band = x - G(x), G = Gaussian sigma 2 px (radius 6) over scored
//              pixels only (masked, normalized), on the Reinhard values of output, noisy and reference;
//              pooled PSNR of band(out) vs band(ref) and the energy ratio sum band(out)^2 / sum band(ref)^2
//              (1 = detail kept, < 1 smoothed away, > 1 noise)
//   ShResolve  (sh-diffuse) diffuse_sh_ref resolved as SPEC M7-8 / M7-9 at the detail normal (guard k,
//              sharpening s): the reference "(1)" of M7-13, so vsShRef = the denoising error alone
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

export const SLOTS = 19;
export const REGIONS = ['all', 'penumbra', 'disoccluded', 'rough<0.15', 'rough<0.35', 'rough<0.6', 'rough>=0.6',
  'dynamic', 'static', 'static-penumbra', 'dynamic-temporal', 'static-temporal', 'tint', 'bump'] as const;
/** Regions reported only for some signals (v1): 'tint' for shadow-rgb, 'bump' for sh-diffuse / sh-specular. */
export const V1_REGIONS = new Set(['tint', 'bump']);
/** Partial-sum slot of each region in REGIONS (slots 7..10 are temporal / lum / non-finite / fixed flicker, 18 v1 misc). */
const REGION_SLOTS = [0, 1, 2, 3, 4, 5, 6, 11, 12, 13, 14, 15, 16, 17];
/** Dynamic region: reference change threshold and window in frames (see the header). */
export const DYN_DELTA = 0.05;
export const DYN_K = 4;

// dynamic flag: range of the reference over frames t-DYN_K..t > delta. Lags (ref at t, t-1, t-2, t-3;
// -1 = none) are carried through the reprojection for the next frame.
export const DYN_WGSL = /* wgsl */ `
struct D { dims: vec2u, mode: u32, validPrev: u32, delta: f32, p0: f32, p1: f32, p2: f32 };
@group(0) @binding(0) var<uniform> d: D;
@group(0) @binding(1) var t_ref: texture_2d<f32>;
@group(0) @binding(2) var t_prevLag: texture_2d<f32>;
@group(0) @binding(3) var t_motion: texture_2d<f32>;
@group(0) @binding(4) var t_age: texture_2d<f32>;
@group(0) @binding(5) var o_dyn: texture_storage_2d<r32float, write>;
@group(0) @binding(6) var o_lag: texture_storage_2d<rgba32float, write>;
fn sval(c: vec4f) -> f32 {
  if (d.mode == 0u) { return clamp(c.r, 0.0, 1.0); }
  if (d.mode == 2u) { let k = clamp(c.rgb, vec3f(0.0), vec3f(1.0)); return (k.x + k.y + k.z) / 3.0; }
  let x = max(c.rgb, vec3f(0.0));
  let t = x / (1.0 + x);
  return (t.x + t.y + t.z) / 3.0;
}
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= d.dims)) { return; }
  let pix = vec2i(id.xy);
  let r = sval(textureLoad(t_ref, pix, 0));
  var lag = vec4f(r, -1.0, -1.0, -1.0);
  var dyn = 0.0;
  if (d.validPrev != 0u && textureLoad(t_age, pix, 0).r >= 1.0) {
    let mo = textureLoad(t_motion, pix, 0).xy;
    let pp = vec2f(id.xy) + 0.5 - vec2f(mo.x, -mo.y) * 0.5 * vec2f(d.dims) - 0.5;
    let base = vec2i(floor(pp));
    let fr = pp - vec2f(base);
    var dmin = 1e9;
    var near = vec2i(-1);
    for (var k = 0; k < 4; k++) {
      let o = vec2i(k & 1, k >> 1);
      let q = base + o;
      let w = select(1.0 - fr.x, fr.x, o.x == 1) * select(1.0 - fr.y, fr.y, o.y == 1);
      if (w <= 1e-3 || any(q < vec2i(0)) || any(q >= vec2i(d.dims))) { continue; }
      let dq = abs(r - textureLoad(t_prevLag, q, 0).x);
      if (dq < dmin) { dmin = dq; near = q; }
    }
    if (near.x >= 0) {
      let pl = textureLoad(t_prevLag, near, 0);
      lag = vec4f(r, pl.xyz);
      var lo = r;
      var hi = r;
      for (var k = 0; k < 4; k++) { if (pl[k] >= 0.0) { lo = min(lo, pl[k]); hi = max(hi, pl[k]); } }
      dyn = select(0.0, 1.0, hi - lo > d.delta);
    }
  }
  textureStore(o_dyn, pix, vec4f(dyn));
  textureStore(o_lag, pix, lag);
}
`;

export const SCORE_WGSL = /* wgsl */ `
struct M { dims: vec2u, mode: u32, validPrev: u32, ageK: f32, hasPen: u32, flags: u32, _p: u32 };
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
@group(0) @binding(14) var t_dyn: texture_2d<f32>;
@group(0) @binding(15) var t_n: texture_2d<f32>;
@group(0) @binding(16) var t_ng: texture_2d<f32>;

const NS: u32 = ${SLOTS}u;
var<workgroup> sh: array<vec4f, 256>;

fn bad(c: vec4f) -> f32 {
  let u = bitcast<vec4u>(c) & vec4u(0x7f800000u);
  return select(0.0, 1.0, any(u == vec4u(0x7f800000u)));
}
fn val(c: vec4f) -> vec3f {
  if (m.mode == 0u) { return vec3f(clamp(c.r, 0.0, 1.0)); }
  if (m.mode == 2u) { return clamp(c.rgb, vec3f(0.0), vec3f(1.0)); }
  let x = max(c.rgb, vec3f(0.0));
  return x / (1.0 + x);
}
fn lum(c: vec4f) -> f32 {
  if (m.mode == 0u) { return clamp(c.r, 0.0, 1.0); }
  if (m.mode == 2u) { return dot(clamp(c.rgb, vec3f(0.0), vec3f(1.0)), vec3f(0.2126, 0.7152, 0.0722)); }
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
        if (m.hasPen == 3u) {
          // shadow-rgb: any channel of the rgb reference in (0.02, 0.98)
          let pc = textureLoad(t_pen, pix, 0).rgb;
          if (any((pc > vec3f(0.02)) & (pc < vec3f(0.98)))) { s[1] = reg; }
        } else if (select(pv > 0.02 && pv < 0.98, pv < 0.5, m.hasPen == 2u)) { s[1] = reg; }
      }
      if ((m.flags & 2u) != 0u) {
        // shadow-rgb tint region (reference chroma > 0.02) and its chroma error
        let rc = val(cr);
        if (max(max(rc.x, rc.y), rc.z) - min(min(rc.x, rc.y), rc.z) > 0.02) {
          s[16] = reg;
          let dc = val(cd);
          let ce = abs(dc / max(dc.x + dc.y + dc.z, 1e-4) - rc / max(rc.x + rc.y + rc.z, 1e-4));
          s[18].x = (ce.x + ce.y + ce.z) / 3.0;
          s[18].y = 1.0;
        }
      }
      if ((m.flags & 1u) != 0u) {
        // sh-* bump mask: angle(normal, normal_geom) > 5 deg; floor = output exactly 0
        if (dot(textureLoad(t_n, pix, 0).xyz, textureLoad(t_ng, pix, 0).xyz) < 0.9961947) { s[17] = reg; }
        s[18].z = select(0.0, 1.0, all(cd.rgb == vec3f(0.0)));
        s[18].w = 1.0;
      }
      let age = textureLoad(t_age, pix, 0).r;
      if (age < m.ageK) { s[2] = reg; }
      // dynamic / static split (DYN_WGSL flag)
      let isDyn = textureLoad(t_dyn, pix, 0).r > 0.5;
      if (isDyn) { s[11] = reg; } else {
        s[12] = reg;
        if (m.hasPen == 1u) { let pv = textureLoad(t_pen, pix, 0).r; if (pv > 0.02 && pv < 0.98) { s[13] = reg; } }
        if (m.hasPen == 3u) { let pc = textureLoad(t_pen, pix, 0).rgb; if (any((pc > vec3f(0.02)) & (pc < vec3f(0.98)))) { s[13] = reg; } }
      }
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
        // region-shaped temporal sums: [noisy de^2, denoised de^2, count, denoised |de|]
        s[select(15u, 14u, isDyn)] = vec4f(dot(dn, dn) / 3.0, dot(dd, dd) / 3.0, 1.0, (abs(dd.x) + abs(dd.y) + abs(dd.z)) / 3.0);
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
// Non-receivers take the reference's value (zero error there). mode 2 (shadow-rgb): rgb clamped.
export const PACK_WGSL = /* wgsl */ `
struct K { dims: vec2u, mode: u32, _p: u32 };
@group(0) @binding(0) var<uniform> k: K;
@group(0) @binding(1) var t_in: texture_2d<f32>;
@group(0) @binding(2) var t_ref: texture_2d<f32>;
@group(0) @binding(3) var t_depth: texture_2d<f32>;
@group(0) @binding(4) var<storage, read_write> o: array<u32>;
fn val(c: vec4f) -> vec3f {
  if (k.mode == 0u) { return vec3f(clamp(c.r, 0.0, 1.0)); }
  if (k.mode == 2u) { return clamp(c.rgb, vec3f(0.0), vec3f(1.0)); }
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
  /** v1: [sum chroma error (tint), tint pixels, output-zero pixels (floor), scored pixels (sh-*)] */
  v1: number[];
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
  // dynamic region (DYN_WGSL): flag, and the reference lags (ping-pong)
  private dynPipe: GPUComputePipeline;
  private dynU: GPUBuffer;
  private dynFlag: GPUTexture;
  private dynLag: GPUTexture[];
  constructor(private device: GPUDevice, private W: number, private H: number, pipe: GPUComputePipeline) {
    this.pipe = pipe;
    const usage = GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING;
    const t = (l: string) => device.createTexture({ label: l, size: [W, H], format: 'rgba32float', usage });
    this.eN = [t('eN0'), t('eN1')];
    this.eD = [t('eD0'), t('eD1')];
    this.dynFlag = device.createTexture({ label: 'dynFlag', size: [W, H], format: 'r32float', usage });
    this.dynLag = [t('dynLag0'), t('dynLag1')];
    this.dynPipe = Scorer.dynPipelines.get(device) ?? device.createComputePipeline({ label: 'dyn', layout: 'auto', compute: { module: device.createShaderModule({ label: 'dyn', code: DYN_WGSL }), entryPoint: 'main' } });
    Scorer.dynPipelines.set(device, this.dynPipe);
    this.dynU = device.createBuffer({ size: 32, usage: U.UNIFORM | U.COPY_DST });
    this.wg = [Math.ceil(W / 16), Math.ceil(H / 16)];
    const size = this.wg[0] * this.wg[1] * SLOTS * 16;
    this.partials = device.createBuffer({ size, usage: U.STORAGE | U.COPY_SRC });
    this.readback = device.createBuffer({ size, usage: U.MAP_READ | U.COPY_DST });
    this.u = device.createBuffer({ size: 32, usage: U.UNIFORM | U.COPY_DST });
  }
  private static dynPipelines = new WeakMap<GPUDevice, GPUComputePipeline>();
  static pipeline(device: GPUDevice) {
    return device.createComputePipeline({ label: 'score', layout: 'auto', compute: { module: device.createShaderModule({ label: 'score', code: SCORE_WGSL }), entryPoint: 'main' } });
  }
  async score(o: {
    noisy: GPUTexture; den: GPUTexture; ref: GPUTexture; depth: GPUTexture; rough: GPUTexture; age: GPUTexture;
    motion: GPUTexture; pen?: GPUTexture; scalar: boolean; validPrev: boolean; ageK: number;
    /** `pen` is an occlusion reference: region 1 = contact (ref < 0.5) instead of penumbra */
    contact?: boolean;
    /** v1: 'clamp' scores rgb clamped to [0, 1] (shadow-rgb; `pen` = the rgb reference, any-channel penumbra, + tint region) */
    tonemap?: 'scalar' | 'reinhard' | 'clamp';
    /** v1 (sh-*): the shading and geometric normals, for the bump region and the floor fraction */
    normals?: { normal: GPUTexture; geom: GPUTexture };
  }): Promise<FrameScore> {
    const prev = this.cur;
    this.cur ^= 1;
    const b = new ArrayBuffer(32);
    const u = new Uint32Array(b), f = new Float32Array(b);
    const clampRgb = !o.scalar && o.tonemap === 'clamp';
    u[0] = this.W; u[1] = this.H; u[2] = o.scalar ? 0 : clampRgb ? 2 : 1; u[3] = o.validPrev ? 1 : 0; f[4] = o.ageK;
    u[5] = o.pen ? (o.contact ? 2 : clampRgb ? 3 : 1) : 0;
    u[6] = (o.normals ? 1 : 0) | (clampRgb ? 2 : 0);
    this.device.queue.writeBuffer(this.u, 0, b);
    const db = new ArrayBuffer(32);
    const du = new Uint32Array(db), df = new Float32Array(db);
    du[0] = this.W; du[1] = this.H; du[2] = o.scalar ? 0 : clampRgb ? 2 : 1; du[3] = o.validPrev ? 1 : 0; df[4] = DYN_DELTA;
    this.device.queue.writeBuffer(this.dynU, 0, db);
    const enc = this.device.createCommandEncoder({ label: 'score' });
    const dpass = enc.beginComputePass();
    dpass.setPipeline(this.dynPipe);
    dpass.setBindGroup(0, bindAll(this.device, this.dynPipe, [this.dynU, o.ref, this.dynLag[prev], o.motion, o.age, this.dynFlag, this.dynLag[this.cur]]));
    dpass.dispatchWorkgroups(Math.ceil(this.W / 8), Math.ceil(this.H / 8));
    dpass.end();
    const pass = enc.beginComputePass();
    pass.setPipeline(this.pipe);
    pass.setBindGroup(0, bindAll(this.device, this.pipe, [this.u, o.noisy, o.den, o.ref, o.depth, o.rough, o.age, o.motion, o.pen ?? o.ref,
      this.eN[prev], this.eD[prev], this.eN[this.cur], this.eD[this.cur], this.partials, this.dynFlag,
      o.normals?.normal ?? o.depth, o.normals?.geom ?? o.depth]));
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
      regions: REGION_SLOTS.map(slot),
      temporal: slot(7),
      lum: { den: s[32], ref: s[33], noisy: s[34] },
      sumDeNoisy2: s[35],
      sumErrNoisy: s[38],
      nonFiniteInputs: s[36],
      nonFiniteDenoised: s[37],
      fixedFlicker: [s[40], s[41], s[42]],
      v1: slot(18),
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
  async pack(tex: GPUTexture, ref: GPUTexture, depth: GPUTexture, scalar: boolean, clampRgb = false): Promise<Uint32Array> {
    this.device.queue.writeBuffer(this.u, 0, new Uint32Array([this.W, this.H, scalar ? 0 : clampRgb ? 2 : 1, 0]));
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

// ---- v1 (testbed-v1): detail band and SH reference resolve ------------------------------------

/** Gaussian sigma = 2 px, radius 6 (13 taps), the M7-13 detail-band low-pass. */
const BAND_R = 6;
const BAND_W = Array.from({ length: 2 * BAND_R + 1 }, (_, i) => Math.exp(-((i - BAND_R) ** 2) / 8));
const wlist = BAND_W.map((w) => w.toFixed(8)).join(', ');

// pass 1: horizontal masked sums of the Reinhard values of out / noisy / ref: (sum w m x.rgb, sum w m)
export const BAND_H_WGSL = /* wgsl */ `
@group(0) @binding(0) var t_den: texture_2d<f32>;
@group(0) @binding(1) var t_noisy: texture_2d<f32>;
@group(0) @binding(2) var t_ref: texture_2d<f32>;
@group(0) @binding(3) var t_depth: texture_2d<f32>;
@group(0) @binding(4) var o_d: texture_storage_2d<rgba32float, write>;
@group(0) @binding(5) var o_n: texture_storage_2d<rgba32float, write>;
@group(0) @binding(6) var o_r: texture_storage_2d<rgba32float, write>;
const W = array<f32, ${2 * BAND_R + 1}>(${wlist});
fn tm(c: vec4f) -> vec3f { let x = max(c.rgb, vec3f(0.0)); return x / (1.0 + x); }
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let dims = textureDimensions(t_depth);
  if (any(id.xy >= dims)) { return; }
  var sd = vec4f(0.0); var sn = vec4f(0.0); var sr = vec4f(0.0);
  for (var i = -${BAND_R}; i <= ${BAND_R}; i++) {
    let x = i32(id.x) + i;
    if (x < 0 || x >= i32(dims.x)) { continue; }
    let q = vec2i(x, i32(id.y));
    let d = textureLoad(t_depth, q, 0).r;
    if (!(d > 0.0 && d < 1.0)) { continue; }
    let w = W[i + ${BAND_R}];
    sd += vec4f(w * tm(textureLoad(t_den, q, 0)), w);
    sn += vec4f(w * tm(textureLoad(t_noisy, q, 0)), w);
    sr += vec4f(w * tm(textureLoad(t_ref, q, 0)), w);
  }
  textureStore(o_d, id.xy, sd); textureStore(o_n, id.xy, sn); textureStore(o_r, id.xy, sr);
}
`;

// pass 2: vertical sums -> G(x); band = x - G(x) in the bump mask; per workgroup:
// [sum (bd - br)^2 / 3, sum bd^2 / 3, sum br^2 / 3, count], [sum (bn - br)^2 / 3, sum bn^2 / 3, 0, 0]
export const BAND_V_WGSL = /* wgsl */ `
@group(0) @binding(0) var t_hd: texture_2d<f32>;
@group(0) @binding(1) var t_hn: texture_2d<f32>;
@group(0) @binding(2) var t_hr: texture_2d<f32>;
@group(0) @binding(3) var t_den: texture_2d<f32>;
@group(0) @binding(4) var t_noisy: texture_2d<f32>;
@group(0) @binding(5) var t_ref: texture_2d<f32>;
@group(0) @binding(6) var t_depth: texture_2d<f32>;
@group(0) @binding(7) var t_n: texture_2d<f32>;
@group(0) @binding(8) var t_ng: texture_2d<f32>;
@group(0) @binding(9) var<storage, read_write> partials: array<vec4f>;
const W = array<f32, ${2 * BAND_R + 1}>(${wlist});
fn tm(c: vec4f) -> vec3f { let x = max(c.rgb, vec3f(0.0)); return x / (1.0 + x); }
var<workgroup> sh: array<vec4f, 256>;
var<workgroup> sh2: array<vec4f, 256>;
@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) id: vec3u, @builtin(local_invocation_index) li: u32,
        @builtin(workgroup_id) wg: vec3u, @builtin(num_workgroups) nwg: vec3u) {
  let dims = textureDimensions(t_depth);
  var a = vec4f(0.0); var b = vec4f(0.0);
  if (all(id.xy < dims)) {
    let pix = vec2i(id.xy);
    let d0 = textureLoad(t_depth, pix, 0).r;
    let bump = dot(textureLoad(t_n, pix, 0).xyz, textureLoad(t_ng, pix, 0).xyz) < 0.9961947;
    if (d0 > 0.0 && d0 < 1.0 && bump) {
      var sd = vec4f(0.0); var sn = vec4f(0.0); var sr = vec4f(0.0);
      for (var i = -${BAND_R}; i <= ${BAND_R}; i++) {
        let y = i32(id.y) + i;
        if (y < 0 || y >= i32(dims.y)) { continue; }
        let q = vec2i(i32(id.x), y);
        let w = W[i + ${BAND_R}];
        sd += w * textureLoad(t_hd, q, 0); sn += w * textureLoad(t_hn, q, 0); sr += w * textureLoad(t_hr, q, 0);
      }
      let bd = tm(textureLoad(t_den, pix, 0)) - sd.rgb / max(sd.w, 1e-8);
      let bn = tm(textureLoad(t_noisy, pix, 0)) - sn.rgb / max(sn.w, 1e-8);
      let br = tm(textureLoad(t_ref, pix, 0)) - sr.rgb / max(sr.w, 1e-8);
      let ed = bd - br; let en = bn - br;
      a = vec4f(dot(ed, ed) / 3.0, dot(bd, bd) / 3.0, dot(br, br) / 3.0, 1.0);
      b = vec4f(dot(en, en) / 3.0, dot(bn, bn) / 3.0, 0.0, 0.0);
    }
  }
  sh[li] = a; sh2[li] = b;
  workgroupBarrier();
  for (var k = 128u; k > 0u; k >>= 1u) {
    if (li < k) { sh[li] += sh[li + k]; sh2[li] += sh2[li + k]; }
    workgroupBarrier();
  }
  if (li == 0u) { let w = wg.y * nwg.x + wg.x; partials[2u * w] = sh[0]; partials[2u * w + 1u] = sh2[0]; }
}
`;

/** Per-frame detail-band sums of one (output, noisy, reference) triple in the bump mask. */
export class DetailBand {
  private h: GPUComputePipeline;
  private v: GPUComputePipeline;
  private tex: GPUTexture[];
  private partials: GPUBuffer;
  private readback: GPUBuffer;
  private wg: [number, number];
  constructor(private device: GPUDevice, private W: number, private H: number) {
    this.h = device.createComputePipeline({ label: 'band h', layout: 'auto', compute: { module: device.createShaderModule({ label: 'band h', code: BAND_H_WGSL }), entryPoint: 'main' } });
    this.v = device.createComputePipeline({ label: 'band v', layout: 'auto', compute: { module: device.createShaderModule({ label: 'band v', code: BAND_V_WGSL }), entryPoint: 'main' } });
    const usage = GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING;
    this.tex = [0, 1, 2].map((i) => device.createTexture({ label: `band ${i}`, size: [W, H], format: 'rgba32float', usage }));
    this.wg = [Math.ceil(W / 16), Math.ceil(H / 16)];
    const size = this.wg[0] * this.wg[1] * 2 * 16;
    this.partials = device.createBuffer({ size, usage: U.STORAGE | U.COPY_SRC });
    this.readback = device.createBuffer({ size, usage: U.MAP_READ | U.COPY_DST });
  }
  /** [sum (bd - br)^2, sum bd^2, sum br^2, count, sum (bn - br)^2, sum bn^2] (per-channel means summed over pixels) */
  async score(den: GPUTexture, noisy: GPUTexture, ref: GPUTexture, depth: GPUTexture, normal: GPUTexture, geom: GPUTexture): Promise<number[]> {
    const enc = this.device.createCommandEncoder({ label: 'band' });
    const p1 = enc.beginComputePass();
    p1.setPipeline(this.h);
    p1.setBindGroup(0, bindAll(this.device, this.h, [den, noisy, ref, depth, ...this.tex]));
    p1.dispatchWorkgroups(Math.ceil(this.W / 8), Math.ceil(this.H / 8));
    p1.end();
    const p2 = enc.beginComputePass();
    p2.setPipeline(this.v);
    p2.setBindGroup(0, bindAll(this.device, this.v, [...this.tex, den, noisy, ref, depth, normal, geom, this.partials]));
    p2.dispatchWorkgroups(...this.wg);
    p2.end();
    enc.copyBufferToBuffer(this.partials, 0, this.readback, 0, this.partials.size);
    this.device.queue.submit([enc.finish()]);
    await this.readback.mapAsync(GPUMapMode.READ);
    const a = new Float32Array(this.readback.getMappedRange());
    const s = new Float64Array(8);
    for (let i = 0; i < a.length; i += 8) for (let k = 0; k < 8; k++) s[k] += a[i + k];
    this.readback.unmap();
    return [s[0], s[1], s[2], s[3], s[4], s[5]];
  }
}

// SPEC M7-8 guard + M7-9 diffuse resolve of an SH payload at the detail normal (k = guard, s = sharpening)
export const SH_RESOLVE_WGSL = /* wgsl */ `
struct P { k: f32, s: f32, _a: f32, _b: f32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var t_a: texture_2d<f32>;
@group(0) @binding(2) var t_c: texture_2d<f32>;
@group(0) @binding(3) var t_n: texture_2d<f32>;
@group(0) @binding(4) var t_ng: texture_2d<f32>;
@group(0) @binding(5) var t_depth: texture_2d<f32>;
@group(0) @binding(6) var o_rgb: texture_storage_2d<rgba32float, write>;
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let dims = textureDimensions(t_depth);
  if (any(id.xy >= dims)) { return; }
  let pix = vec2i(id.xy);
  let d = textureLoad(t_depth, pix, 0).r;
  if (!(d > 0.0 && d < 1.0)) { textureStore(o_rgb, pix, vec4f(0.0, 0.0, 0.0, 1.0)); return; }
  let A = textureLoad(t_a, pix, 0);
  let C = textureLoad(t_c, pix, 0);
  let nd = textureLoad(t_n, pix, 0).xyz;
  let ng = textureLoad(t_ng, pix, 0).xyz;
  let b = A.yzw;
  let yg = A.x + dot(b, ng);
  let bp = b * min(1.0, p.k * max(yg, 0.0) / max(length(b), 1e-6));
  let ap = yg - dot(bp, ng);
  let rco = clamp(C.x / max(yg, 1e-4), -2.0, 2.0);
  let rcg = clamp(C.y / max(yg, 1e-4), -2.0, 2.0);
  var y = max(0.0, ap + dot(bp, nd));
  let bl = length(bp);
  if (p.s > 0.0 && bl > 1e-8) {
    let I = 2.0 * bl;
    let dd = bp / bl;
    let am = max(ap - 0.5 * bl, 0.0);
    let yd = am + I * max(0.0, dot(nd, dd));
    let yn = am + I * max(0.0, dot(ng, dd));
    y = mix(y, yd * yg / max(yn, 1e-4), p.s);
  }
  let co = y * rco;
  let cg = y * rcg;
  textureStore(o_rgb, pix, vec4f(max(vec3f(y + co - cg, y + cg, y - co - cg), vec3f(0.0)), 1.0));
}
`;

/** Resolves an SH reference (two rgba32float halves) at the detail normal into an rgba32float texture. */
export class ShResolve {
  readonly out: GPUTexture;
  private pipe: GPUComputePipeline;
  private u: GPUBuffer;
  constructor(private device: GPUDevice, private W: number, private H: number, k = 1, s = 0) {
    this.out = device.createTexture({ label: 'sh ref resolved', size: [W, H], format: 'rgba32float', usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC });
    this.pipe = device.createComputePipeline({ label: 'sh resolve', layout: 'auto', compute: { module: device.createShaderModule({ label: 'sh resolve', code: SH_RESOLVE_WGSL }), entryPoint: 'main' } });
    this.u = device.createBuffer({ size: 16, usage: U.UNIFORM | U.COPY_DST });
    device.queue.writeBuffer(this.u, 0, new Float32Array([k, s, 0, 0]));
  }
  run(a: GPUTexture, c: GPUTexture, normal: GPUTexture, geom: GPUTexture, depth: GPUTexture) {
    const enc = this.device.createCommandEncoder({ label: 'sh resolve' });
    const pass = enc.beginComputePass();
    pass.setPipeline(this.pipe);
    pass.setBindGroup(0, bindAll(this.device, this.pipe, [this.u, a, c, normal, geom, depth, this.out]));
    pass.dispatchWorkgroups(Math.ceil(this.W / 8), Math.ceil(this.H / 8));
    pass.end();
    this.device.queue.submit([enc.finish()]);
    return this.out;
  }
}
