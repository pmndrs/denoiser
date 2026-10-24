// Occlusion helpers (SPEC §8, M5): the F-3 hit-distance normalization as its own pass,
// for filters that don't normalize internally (SVGF on the scalar, plain accumulation).
// The recurrent occlusion-only mode normalizes inside its temporal pass instead
// (shaders/recurrent.ts, kinds `ao` / `so`).
//
//   ĥ = h / (h + a + b·d),  d = linear view depth,  miss (h = 0 or non-finite) -> 1
//
// Curve: our design (SPEC F-3); "normalized hit distance = AO / SO": Zhdan, GTC 2020
// (s22699) s.9. Output gray rgba16float (ĥ, ĥ, ĥ, 1), so a radiance filter's luminance is
// ĥ itself; sky (no surface) -> 0.
export const OCC_NORM_SIZE = 16;

/**
 * Normalization pass. `depth: 'geo'` reads the packed guide texture of GuidePass (linear
 * depth bits in .x, 0 = sky); `depth: 'viewz'` reads a three.js viewZ
 * texture (negative in front; viewZ <= -far or >= 0 = sky).
 */
export function normalizeHitWgsl(depth: 'geo' | 'viewz'): string {
  return /* wgsl */ `
struct NormParams { a: f32, b: f32, far: f32, pad: f32 }
@group(0) @binding(0) var<uniform> NP: NormParams;
@group(0) @binding(1) var hitTex: texture_2d<f32>;
@group(0) @binding(2) var depthTex: ${depth === 'geo' ? 'texture_2d<u32>' : 'texture_2d<f32>'};
@group(0) @binding(3) var outNorm: texture_storage_2d<rgba16float, write>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let dims = textureDimensions(outNorm);
  if (any(gid.xy >= dims)) { return; }
  let p = vec2i(gid.xy);
  ${depth === 'geo'
    ? 'let d = bitcast<f32>(textureLoad(depthTex, p, 0).x);'
    : 'let vz = textureLoad(depthTex, p, 0).r;\n  let d = select(-vz, 0.0, vz >= 0.0 || vz <= -NP.far);'}
  if (!(d > 0.0)) { textureStore(outNorm, p, vec4f(0.0)); return; }
  let h = textureLoad(hitTex, p, 0).r;
  var x = 1.0;
  if (h > 0.0 && h < 1e30) { x = h / (h + NP.a + NP.b * d); }
  textureStore(outNorm, p, vec4f(x, x, x, 1.0));
}
`;
}
