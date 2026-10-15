// Kernels for the shadow-denoiser -> upscaler chain study. Extends the ffx-denoiser test bed's analytic scene
// (SCENE_WGSL) with: the jittered/unjittered 1-spp shadow signal + G-buffer, the lighting split (lit / ambient,
// so the shadow term can be swapped without touching colour), an oracle visibility, a compose pass and a
// supersampled NATIVE-resolution reference render.
import { SCENE_WGSL } from '../../ffx-denoiser/src/scene';

export const CHAIN_SCENE_WGSL = /* wgsl */ `
${SCENE_WGSL}
@group(0) @binding(1) var o_depth: texture_storage_2d<r32float, write>;
@group(0) @binding(2) var o_normal: texture_storage_2d<rgba16float, write>;
@group(0) @binding(3) var o_motion: texture_storage_2d<rgba16float, write>;
@group(0) @binding(4) var o_rough: texture_storage_2d<r32float, write>;
@group(0) @binding(5) var o_vis: texture_storage_2d<r32float, write>;
@group(0) @binding(6) var o_hitdist: texture_storage_2d<r32float, write>;
@group(0) @binding(7) var o_ref: texture_storage_2d<r32float, write>;
@group(0) @binding(8) var o_lit: texture_storage_2d<rgba16float, write>;
@group(0) @binding(9) var o_amb: texture_storage_2d<rgba16float, write>;
@group(0) @binding(10) var o_nat: texture_storage_2d<rgba16float, write>;
@group(0) @binding(11) var o_natDepth: texture_storage_2d<r32float, write>;
@group(0) @binding(13) var o_rad: texture_storage_2d<rgba16float, write>;    // 1-spp glossy reflection radiance (mode 1)
@group(0) @binding(14) var o_refRad: texture_storage_2d<rgba16float, write>; // converged reflection at the jittered sample (oracle)
@group(0) @binding(12) var o_natPen: texture_storage_2d<r32float, write>; // = depth where the native pixel is a shadow penumbra, else 1 (masked out)

@compute @workgroup_size(8, 8)
fn noisy(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= u.dims)) { return; }
  let pr = primary(id.xy);
  textureStore(o_depth, id.xy, vec4f(pr.depth));
  textureStore(o_normal, id.xy, vec4f(pr.n, 0.0));
  textureStore(o_motion, id.xy, vec4f(pr.motion, 0.0, 0.0));
  textureStore(o_rough, id.xy, vec4f(pr.rough));
  var vis = vec2f(1.0, 0.0);
  var rad = vec4f(0.0);
  if (pr.hit) {
    var seed = pcg(id.x + pcg(id.y + pcg(u.frame * 9781u + u.seedOffset)));
    if (u.mode == 1u) {
      let xi = rand2(&seed);
      let xi2 = rand2(&seed);
      rad = reflectionSample(pr.p, pr.n, -pr.rd, pr.rough, xi, xi2);
      vis = vec2f(1.0, rad.w);
    } else {
      vis = shadowSample(pr.p, pr.n, rand2(&seed));
    }
  }
  textureStore(o_vis, id.xy, vec4f(vis.x));
  textureStore(o_hitdist, id.xy, vec4f(vis.y));
  textureStore(o_rad, id.xy, vec4f(rad.rgb, 1.0));
}

// converged visibility at the (jittered) sample position: the oracle a perfect denoiser would return
@compute @workgroup_size(8, 8)
fn reference(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= u.dims)) { return; }
  let pr = primary(id.xy);
  var acc = 1.0;
  if (pr.hit) {
    let g = u32(round(sqrt(f32(u.spp))));
    var seed = pcg(id.x * 7919u + pcg(id.y + 0x9e3779b9u));
    let rot = rand2(&seed);
    acc = 0.0;
    for (var j = 0u; j < g; j++) { for (var i = 0u; i < g; i++) {
      acc += shadowSample(pr.p, pr.n, fract((vec2f(f32(i), f32(j)) + 0.5) / f32(g) + rot)).x;
    } }
    acc /= f32(g * g);
  }
  textureStore(o_ref, id.xy, vec4f(acc));
  var refl = vec3f(0.0);
  if (u.mode == 1u && pr.hit) {
    let g = u32(round(sqrt(f32(u.spp))));
    var seed = pcg(id.x * 7919u + pcg(id.y + 0x7f4a7c15u));
    let rot = rand2(&seed);
    let rot2 = rand2(&seed);
    for (var j = 0u; j < g; j++) { for (var i = 0u; i < g; i++) {
      let xi = fract((vec2f(f32(i), f32(j)) + 0.5) / f32(g) + rot);
      let xi2 = fract(rand2(&seed) + rot2);
      refl += reflectionSample(pr.p, pr.n, -pr.rd, pr.rough, xi, xi2).rgb;
    } }
    refl /= f32(g * g);
  }
  textureStore(o_refRad, id.xy, vec4f(refl, 1.0));
}

const REFL_K: f32 = 0.35; // demodulated specular -> added radiance

fn lighting(pr: Primary) -> array<vec3f, 2> {
  if (!pr.hit) { return array<vec3f, 2>(vec3f(0.0), sky(pr.rd)); }
  let toL = LIGHT_POS - pr.p;
  let d2 = dot(toL, toL);
  let ndl = max(dot(pr.n, normalize(toL)), 0.0);
  let solid = PI * LIGHT_RADIUS * LIGHT_RADIUS / d2;
  return array<vec3f, 2>(pr.albedo * LIGHT_RADIANCE * ndl * solid / PI, pr.albedo * sky(pr.n) * 0.25);
}

// final colour = amb + lit * visibility (same factorisation as shadeHit)
@compute @workgroup_size(8, 8)
fn shade(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= u.dims)) { return; }
  let l = lighting(primary(id.xy));
  textureStore(o_lit, id.xy, vec4f(l[0], 1.0));
  textureStore(o_amb, id.xy, vec4f(l[1], 1.0));
}

// supersampled native render at u.dims (display res): NxN sub-pixel primaries x 4 stratified shadow rays
const NAT_N: u32 = 4u;
@compute @workgroup_size(8, 8)
fn nativeRef(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= u.dims)) { return; }
  var acc = vec3f(0.0);
  var visSum = 0.0;
  var hits = 0.0;
  var reflSum = vec3f(0.0);
  var seed = pcg(id.x * 7919u + pcg(id.y + 0x9e3779b9u));
  let rot = rand2(&seed);
  for (var sj = 0u; sj < NAT_N; sj++) { for (var si = 0u; si < NAT_N; si++) {
    let pr = primaryF(vec2f(id.xy) + (vec2f(f32(si), f32(sj)) + 0.5) / f32(NAT_N));
    let l = lighting(pr);
    var vis = 1.0;
    if (pr.hit) {
      vis = 0.0;
      for (var k = 0u; k < 4u; k++) {
        let xi = fract(vec2f((f32(k & 1u) + 0.5) * 0.5, (f32(k >> 1u) + 0.5) * 0.5) + rot + vec2f(f32(si), f32(sj)) * 0.37);
        vis += shadowSample(pr.p, pr.n, xi).x;
      }
      vis *= 0.25;
      visSum += vis;
      hits += 1.0;
    }
    var refl = vec3f(0.0);
    if (u.mode == 1u && pr.hit) {
      for (var k = 0u; k < 4u; k++) {
        let xi = fract(vec2f((f32(k & 1u) + 0.5) * 0.5, (f32(k >> 1u) + 0.5) * 0.5) + rot + vec2f(f32(sj), f32(si)) * 0.29);
        let xi2 = fract(rand2(&seed) + rot);
        refl += reflectionSample(pr.p, pr.n, -pr.rd, pr.rough, xi, xi2).rgb;
      }
      refl *= 0.25;
      reflSum += refl;
    }
    acc += l[1] + l[0] * vis + REFL_K * refl;
  } }
  textureStore(o_nat, id.xy, vec4f(acc / f32(NAT_N * NAT_N), 1.0));
  let cd = primaryF(vec2f(id.xy) + 0.5).depth;
  textureStore(o_natDepth, id.xy, vec4f(cd));
  let vm = visSum / max(hits, 1.0);
  // mask: shadow penumbra (mode 0) or pixels with a significant reflection (mode 1)
  let rl = dot(reflSum / f32(NAT_N * NAT_N), vec3f(0.299, 0.587, 0.114));
  let penumbra = (hits > 0.0) && (vm > 0.02) && (vm < 0.98);
  let inMask = select(penumbra, (rl > 0.1), (u.mode == 1u));
  textureStore(o_natPen, id.xy, vec4f(select(1.0, cd, inMask)));
}
`;

// colour = amb + lit * vis
export const COMPOSE_WGSL = /* wgsl */ `
@group(0) @binding(0) var t_lit: texture_2d<f32>;
@group(0) @binding(1) var t_amb: texture_2d<f32>;
@group(0) @binding(2) var t_vis: texture_2d<f32>;
@group(0) @binding(3) var o_color: texture_storage_2d<rgba16float, write>;
@group(0) @binding(4) var t_refl: texture_2d<f32>;
const REFL_K: f32 = 0.35;
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let d = textureDimensions(o_color);
  if (any(id.xy >= d)) { return; }
  let v = clamp(textureLoad(t_vis, id.xy, 0).r, 0.0, 1.0);
  textureStore(o_color, id.xy, vec4f(textureLoad(t_amb, id.xy, 0).rgb + textureLoad(t_lit, id.xy, 0).rgb * v + REFL_K * max(textureLoad(t_refl, id.xy, 0).rgb, vec3f(0.0)), 1.0));
}
`;

// r32float depth -> depth32float attachment (compute can't write depth formats)
export const DEPTH_COPY_WGSL = /* wgsl */ `
@group(0) @binding(0) var t_depth: texture_2d<f32>;
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4f(p * 2.0 - 1.0, 0.0, 1.0);
}
@fragment fn fs(@builtin(position) fc: vec4f) -> @builtin(frag_depth) f32 {
  return textureLoad(t_depth, vec2u(fc.xy), 0).r;
}
`;
