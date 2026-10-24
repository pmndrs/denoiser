// Guide prepass: packs this frame's geometry (linear depth, depth slope, world
// normal, roughness) into an rg32uint tap texture that every later pass reads
// (and that becomes next frame's "previous geometry", ping-pong) plus an r32uint
// depth-slope texture read only at the center pixel.
//
// Depth slope: compute shaders have no derivatives, so the slope of linear
// depth per pixel is rebuilt here from the 4 neighbours, taking the smaller
// one-sided difference on each axis so a silhouette doesn't leak into the
// slope (our design; SVGF's gradient-scaled depth weight needs it, Schied et
// al. 2017 eq. 3; A-SVGF's reference code stores the same quantity as a
// G-buffer channel, a_svgf.zip, BSD-3).
import { FRAME_WGSL } from './common';

/**
 * `slope = false` (filters that never read the depth slope, e.g. recurrent): no
 * neighbour depth reads and no slope output (binding 6 absent).
 */
export function prepassWgsl(depthIsDepthFormat: boolean, slope = true): string {
  const depthDecl = depthIsDepthFormat
    ? 'var depthTex: texture_depth_2d;'
    : 'var depthTex: texture_2d<f32>;';
  const depthLoad = depthIsDepthFormat
    ? 'textureLoad(depthTex, p, 0)'
    : 'textureLoad(depthTex, p, 0).r';
  return /* wgsl */ `
${FRAME_WGSL}
@group(0) @binding(0) var<uniform> F: Frame;
@group(0) @binding(1) ${depthDecl}
@group(0) @binding(2) var viewZTex: texture_2d<f32>;
@group(0) @binding(3) var normalTex: texture_2d<f32>;
@group(0) @binding(4) var roughTex: texture_2d<f32>;
@group(0) @binding(5) var outGeo: texture_storage_2d<rg32uint, write>;
${slope ? '@group(0) @binding(6) var outGrad: texture_storage_2d<r32uint, write>;' : ''}

// Linear depth (> 0) at p, 0 for sky / no surface.
fn linZ(p: vec2i) -> f32 {
  var z: f32;
  if (hasFlag(FRAME_HAS_VIEWZ)) {
    z = -textureLoad(viewZTex, p, 0).r;
  } else {
    let d = ${depthLoad};
    let c = F.projInv * vec4f(ndcOf(uvOf(p)), d, 1.0);
    z = -c.z / c.w;
  }
  if (!(z > 0.0) || z >= F.far * 0.9999) { return 0.0; }
  let n = textureLoad(normalTex, p, 0).xyz;
  if (dot(n, n) < 0.01) { return 0.0; }
  return z;
}

fn slope(zc: f32, zm: f32, zp: f32) -> f32 {
  let dm = select(1e30, zc - zm, zm > 0.0);
  let dp = select(1e30, zp - zc, zp > 0.0);
  let s = select(dp, dm, abs(dm) < abs(dp));
  return select(s, 0.0, abs(s) >= 1e29);
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let p = vec2i(gid.xy);
  if (!inside(p)) { return; }
  var g: Geo;
  g.z = linZ(p);
  g.n = vec3f(0.0, 0.0, 1.0);
  g.grad = vec2f(0.0);
  g.rough = 1.0;
  if (g.z > 0.0) {${slope ? `
    let zl = select(0.0, linZ(p - vec2i(1, 0)), p.x > 0);
    let zr = select(0.0, linZ(p + vec2i(1, 0)), f32(p.x + 1) < F.dims.x);
    let zu = select(0.0, linZ(p - vec2i(0, 1)), p.y > 0);
    let zd = select(0.0, linZ(p + vec2i(0, 1)), f32(p.y + 1) < F.dims.y);
    g.grad = vec2f(slope(g.z, zl, zr), slope(g.z, zu, zd));` : ''}
    g.n = normalize(textureLoad(normalTex, p, 0).xyz);
    if (hasFlag(FRAME_HAS_ROUGHNESS)) { g.rough = textureLoad(roughTex, p, 0).r; }
  }
  textureStore(outGeo, p, vec4u(packGeoTap(g), 0u, 0u));
  ${slope ? 'textureStore(outGrad, p, vec4u(packGrad(g), 0u, 0u, 0u));' : ''}
}
`;
}
