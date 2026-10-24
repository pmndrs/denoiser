// GPU metrics for the dev page: per-frame tonemapped MSE vs the exact ground
// truth, flicker (mean |e_t - e_{t-1}|, e = tm(out) - tm(ref), same pixel),
// signed bias, NaN count, and the noisy input's MSE. One partial sum per 8x8
// workgroup, summed on the CPU in double precision.

export const METRICS_WGSL = /* wgsl */ `
@group(0) @binding(0) var outTex: texture_2d<f32>;
@group(0) @binding(1) var refTex: texture_2d<f32>;
@group(0) @binding(2) var noisyTex: texture_2d<f32>;
@group(0) @binding(3) var errPrev: texture_2d<f32>;
@group(0) @binding(4) var errOut: texture_storage_2d<rgba32float, write>;
@group(0) @binding(5) var<storage, read_write> partials: array<vec4f>;
@group(0) @binding(6) var<uniform> hasPrev: vec4u;

var<workgroup> sA: array<vec4f, 64>;
var<workgroup> sB: array<vec4f, 64>;

fn tm(c: vec3f) -> vec3f { let m = max(c, vec3f(0.0)); return m / (1.0 + m); }
fn bad(c: vec3f) -> bool {
  let b = bitcast<vec3u>(c) & vec3u(0x7f800000u);
  return any(b == vec3u(0x7f800000u));
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u, @builtin(local_invocation_index) li: u32,
        @builtin(workgroup_id) wid: vec3u, @builtin(num_workgroups) nwg: vec3u) {
  let dims = vec2u(textureDimensions(refTex));
  var a = vec4f(0.0);   // sumSq, sumFlicker, sumSigned, count
  var b = vec4f(0.0);   // nan, sumSqNoisy, flickerCount, 0
  if (all(gid.xy < dims)) {
    let p = vec2i(gid.xy);
    let r = textureLoad(refTex, p, 0);
    if (r.a > 0.5) {
      let o = textureLoad(outTex, p, 0).rgb;
      let n = textureLoad(noisyTex, p, 0).rgb;
      var e = vec3f(1.0);
      if (bad(o)) { b.x = 1.0; } else { e = tm(o) - tm(r.rgb); }
      let en = tm(n) - tm(r.rgb);
      a.x = dot(e, e) / 3.0;
      a.z = (e.x + e.y + e.z) / 3.0;
      a.w = 1.0;
      b.y = dot(en, en) / 3.0;
      let ep = textureLoad(errPrev, p, 0);
      if (hasPrev.x != 0u && ep.a > 0.5) {
        let d = abs(e - ep.rgb);
        a.y = (d.x + d.y + d.z) / 3.0;
        b.z = 1.0;
      }
      textureStore(errOut, p, vec4f(e, 1.0));
    } else {
      textureStore(errOut, p, vec4f(0.0));
    }
  }
  sA[li] = a;
  sB[li] = b;
  workgroupBarrier();
  for (var s = 32u; s > 0u; s = s >> 1u) {
    if (li < s) { sA[li] += sA[li + s]; sB[li] += sB[li + s]; }
    workgroupBarrier();
  }
  if (li == 0u) {
    let i = wid.y * nwg.x + wid.x;
    partials[2u * i] = sA[0];
    partials[2u * i + 1u] = sB[0];
  }
}
`;

export const BLIT_WGSL = /* wgsl */ `
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var<uniform> mode: vec4f;   // x: 0 color, 1 |error| heat; y: gain
struct VO { @builtin(position) pos: vec4f }
@vertex fn vs(@builtin(vertex_index) i: u32) -> VO {
  var o: VO;
  let xy = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  o.pos = vec4f(xy * 2.0 - 1.0, 0.0, 1.0);
  return o;
}
@fragment fn fs(v: VO) -> @location(0) vec4f {
  let dims = vec2f(textureDimensions(src));
  let p = vec2i(v.pos.xy / vec2f(textureDimensions(src).xy) * dims);
  let c = textureLoad(src, vec2i(v.pos.xy), 0).rgb;
  if (mode.x > 0.5) {
    let e = clamp(abs(c.r + c.g + c.b) / 3.0 * mode.y, 0.0, 1.0);
    return vec4f(e, e * e, 0.2 * (1.0 - e), 1.0);
  }
  let m = max(c * mode.y, vec3f(0.0));
  let t = m / (1.0 + m);
  return vec4f(pow(t, vec3f(1.0 / 2.2)), 1.0);
}
`;
