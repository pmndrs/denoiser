// GPU-side scoring (per-frame PSNR + flicker partial sums) and the 3-panel view.

// mode 0: scalar signal in .r ([0,1] shadow visibility)
// mode 1: HDR rgb, scored after a Reinhard x/(1+x) tonemap (keeps PSNR from
//         being dominated by a few very bright highlight pixels)
export const METRICS_WGSL = /* wgsl */ `
struct M { dims: vec2u, mode: u32, validPrev: u32 };
@group(0) @binding(0) var<uniform> m: M;
@group(0) @binding(1) var t_noisy: texture_2d<f32>;
@group(0) @binding(2) var t_den: texture_2d<f32>;
@group(0) @binding(3) var t_ref: texture_2d<f32>;
@group(0) @binding(4) var t_depth: texture_2d<f32>;
@group(0) @binding(5) var e_noisy: texture_storage_2d<r32float, read_write>;
@group(0) @binding(6) var e_den: texture_storage_2d<r32float, read_write>;
@group(0) @binding(7) var<storage, read_write> partials: array<vec4f>;

var<workgroup> r0: array<vec4f, 256>;
var<workgroup> r1: array<vec4f, 256>;
var<workgroup> r2: array<vec4f, 256>;

fn bad(c: vec4f) -> f32 {
  let u = bitcast<vec4u>(c) & vec4u(0x7f800000u);
  return select(0.0, 1.0, any(u == vec4u(0x7f800000u)));
}

fn val(c: vec4f) -> vec3f {
  if (m.mode == 0u) { return vec3f(clamp(c.r, 0.0, 1.0)); }
  let x = max(c.rgb, vec3f(0.0));
  return x / (1.0 + x);
}

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) id: vec3u, @builtin(local_invocation_index) li: u32,
        @builtin(workgroup_id) wg: vec3u, @builtin(num_workgroups) nwg: vec3u) {
  var a = vec4f(0.0);
  var b = vec4f(0.0);
  var c = vec4f(0.0);
  if (all(id.xy < m.dims)) {
    let d = textureLoad(t_depth, id.xy, 0).r;
    // non-finite inputs / outputs (NaN / Inf) — counted, never silently scored
    b.z = bad(textureLoad(t_noisy, id.xy, 0)) + 2.0 * bad(textureLoad(t_ref, id.xy, 0));
    b.w = bad(textureLoad(t_den, id.xy, 0));
    let recv = d > 0.0 && d < 1.0;
    var en = 0.0;
    var ed = 0.0;
    if (recv) {
      let r = val(textureLoad(t_ref, id.xy, 0));
      let n = val(textureLoad(t_noisy, id.xy, 0)) - r;
      let dd = val(textureLoad(t_den, id.xy, 0)) - r;
      en = (n.x + n.y + n.z) / 3.0;
      ed = (dd.x + dd.y + dd.z) / 3.0;
      a.x = dot(n, n) / 3.0;
      a.y = dot(dd, dd) / 3.0;
      b.x = 1.0;
      // "penumbra" / non-trivial pixels: reference strictly between 0 and 1
      // (shadows) or any receiver (reflections — every pixel carries signal)
      let rr = textureLoad(t_ref, id.xy, 0).r;
      if (m.mode != 0u || (rr > 0.02 && rr < 0.98)) {
        c = vec4f(a.x, a.y, 1.0, ed); // .w: signed error (bias)
      }
      if (m.validPrev != 0u) {
        a.z = abs(en - textureLoad(e_noisy, id.xy).r);
        a.w = abs(ed - textureLoad(e_den, id.xy).r);
        b.y = 1.0;
      }
    }
    textureStore(e_noisy, id.xy, vec4f(en));
    textureStore(e_den, id.xy, vec4f(ed));
  }
  r0[li] = a;
  r1[li] = b;
  r2[li] = c;
  workgroupBarrier();
  for (var s = 128u; s > 0u; s >>= 1u) {
    if (li < s) { r0[li] += r0[li + s]; r1[li] += r1[li + s]; r2[li] += r2[li + s]; }
    workgroupBarrier();
  }
  if (li == 0u) {
    let w = wg.y * nwg.x + wg.x;
    partials[3u * w] = r0[0];
    partials[3u * w + 1u] = r1[0];
    partials[3u * w + 2u] = r2[0];
  }
}
`;

export const VIEW_WGSL = /* wgsl */ `
struct V { canvas: vec2f, tex: vec2f, mode: u32, exposure: f32, _p: vec2f };
@group(0) @binding(0) var<uniform> v: V;
@group(0) @binding(1) var t0: texture_2d<f32>;
@group(0) @binding(2) var t1: texture_2d<f32>;
@group(0) @binding(3) var t2: texture_2d<f32>;

@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4f(p * 2.0 - 1.0, 0.0, 1.0);
}

fn show(c: vec4f) -> vec3f {
  if (v.mode == 0u) { return vec3f(pow(clamp(c.r, 0.0, 1.0), 1.0 / 2.2)); }
  let x = max(c.rgb * v.exposure, vec3f(0.0));
  return pow(x / (1.0 + x), vec3f(1.0 / 2.2));
}

@fragment fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  // one canvas per panel (HTML labels sit below each); v._p.y = panel index 0..2
  let panel = min(u32(v._p.y), 2u);
  let lx = fc.x / v.canvas.x;
  let ly = fc.y / v.canvas.y;
  let p = vec2u(vec2f(lx, ly) * v.tex);
  var c: vec4f;
  if (v._p.x > 0.0 && panel == 1u) {
    // error heat map: |tonemap(denoised) - tonemap(reference)| * gain
    let e = abs(show(textureLoad(t1, p, 0)) - show(textureLoad(t2, p, 0)));
    return vec4f(e * v._p.x, 1.0);
  }
  if (panel == 0u) { c = textureLoad(t0, p, 0); }
  else if (panel == 1u) { c = textureLoad(t1, p, 0); }
  else { c = textureLoad(t2, p, 0); }
  return vec4f(show(c), 1.0);
}
`;
