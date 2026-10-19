// GGX prefilter for reflection probes, in raw WebGPU compute (three r186 has no compute path for it).
//
// Turns one captured cube (three's CubeCamera target, mip 0 only) into the roughness mip chain of
// three r187's cube PMREM and writes it into six layers of a 2D array texture: mip `lod` holds
// roughness `1 - sqrt(1 - lod / maxLod)`, lods 0 ... log2(size) - 3 (faces down to 8 px). Same
// per-level plan as r187's PMREMGenerator: lod 0 is a copy, the sharp levels use 256 GGX samples
// (filtered importance sampling from a box-filtered source mip chain), the last three levels weight
// every texel of the 16 px source mip.
//
// The WGSL kernels are vendored from @pmndrs/sky 0.6.0 (src/sky/pmrem/kernels.ts, MIT, (c) Dennis
// Smolek), whose 'cube' plan is three r187's algorithm. Changes: no x mirror (source and output
// share three's cube convention, see `faceDirUV`), and an optional edge warp (`WARP`, below).
//
// Edge warp: a 2D array has no seamless cube filtering, so a manual lookup clamps at face edges
// (the last half texel of every face repeats the edge texel, and the neighbour face's edge texel
// is never blended in). With `WARP`, each face's edge texels are centred ON the edge (texel x at
// u = x / (size - 1)), so the two faces sharing an edge store the same direction there and the
// lookup (which scales uv by (size - 1) / size, see ReflectionProbesNode) is continuous across
// edges and corners. Cost: none in the prefilter; at 8 px a face holds 7 texel spans instead of 8.

const COMMON = /* wgsl */ `
override WARP: bool = false;
// Direction through (u, v) in [-1, 1] on a face of a WebGPU cube (D3D / GL face rules).
fn faceDirUV(face: u32, u: f32, v: f32) -> vec3<f32> {
  switch face {
    case 0u: { return vec3( 1.0, -v, -u); }
    case 1u: { return vec3(-1.0, -v,  u); }
    case 2u: { return vec3( u,  1.0,  v); }
    case 3u: { return vec3( u, -1.0, -v); }
    case 4u: { return vec3( u, -v,  1.0); }
    default: { return vec3(-u, -v, -1.0); }
  }
}
// Direction an output texel is filtered for: its centre, or with WARP edge texels on the edges.
fn faceDir(face: u32, px: vec2<f32>, size: f32) -> vec3<f32> {
  var uv = (px + 0.5) / size * 2.0 - 1.0;
  if (WARP) { uv = px / max(size - 1.0, 1.0) * 2.0 - 1.0; }
  return normalize(faceDirUV(face, uv.x, uv.y));
}
fn hammersley(i: u32, n: u32) -> vec2<f32> {
  return vec2(f32(i) / f32(n), f32(reverseBits(i)) * 2.3283064365386963e-10);
}
// GGX D for V = N, up to a constant: NdotH^2 = (1 + NdotL) / 2.
fn ggxWeight(NdotL: f32, a2: f32) -> f32 {
  let dd = (1.0 + NdotL) * 0.5 * (a2 - 1.0) + 1.0;
  return NdotL / (dd * dd);
}`;

// Filtered importance sampling (GGX VNDF with V = N), one thread per output texel.
const FIS_WGSL = /* wgsl */ `${COMMON}
struct L { outSize: u32, samples: u32, roughness: f32, lodBias: f32 }
@group(0) @binding(0) var src: texture_cube<f32>;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var dst: texture_storage_2d_array<rgba16float, write>;
@group(0) @binding(3) var<uniform> P: L;
@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= P.outSize || id.y >= P.outSize) { return; }
  let N = faceDir(id.z, vec2<f32>(id.xy), f32(P.outSize));
  if (P.roughness <= 0.0) { textureStore(dst, id.xy, id.z, textureSampleLevel(src, samp, N, 0.0)); return; }
  let alpha = P.roughness * P.roughness; let a2 = alpha * alpha;
  let up = select(vec3(1.0, 0.0, 0.0), vec3(0.0, 0.0, 1.0), abs(N.z) < 0.999);
  let T = normalize(cross(up, N)); let B = cross(N, T);
  var col = vec3(0.0); var w = 0.0;
  for (var i = 0u; i < P.samples; i++) {
    let xi = hammersley(i, P.samples);
    let invQ = 1.0 / ((1.0 - xi.x) + a2 * xi.x);
    let NdotL = ((1.0 - xi.x) - a2 * xi.x) * invQ;
    if (NdotL > 0.0) {
      let phi = xi.y * 6.283185307;
      let sinT = alpha * 2.0 * sqrt(xi.x * (1.0 - xi.x)) * invQ;
      let Ld = N * NdotL + (T * cos(phi) + B * sin(phi)) * sinT;
      let lod = max(log2(a2 * invQ) + P.lodBias, 0.0);
      col += textureSampleLevel(src, samp, Ld, lod).rgb * NdotL; w += NdotL;
    }
  }
  textureStore(dst, id.xy, id.z, vec4(col / w, 1.0));
}`;

// Exhaustive GGX integration over every texel of a small source mip, one 64-thread workgroup per
// output texel (for outputs under 32 px, where a thread per texel leaves the GPU idle).
const INTEG_WGSL = /* wgsl */ `${COMMON}
struct I { outSize: u32, srcSize: u32, roughness: f32, pad: f32 }
@group(0) @binding(0) var src: texture_2d_array<f32>;
@group(0) @binding(1) var dst: texture_storage_2d_array<rgba16float, write>;
@group(0) @binding(2) var<uniform> P: I;
var<workgroup> sCol: array<vec4<f32>, 64>;
@compute @workgroup_size(64, 1, 1)
fn main(@builtin(workgroup_id) wg: vec3<u32>, @builtin(local_invocation_index) li: u32) {
  let ox = wg.x % P.outSize; let oy = wg.x / P.outSize;
  let N = faceDir(wg.y, vec2(f32(ox), f32(oy)), f32(P.outSize));
  let alpha = P.roughness * P.roughness; let a2 = alpha * alpha;
  let n = P.srcSize; let per = n * n; let total = 6u * per;
  let inv = 2.0 / f32(n);
  var acc = vec4(0.0);
  for (var k = li; k < total; k += 64u) {
    let f = k / per; let r = k - f * per;
    let x = r % n; let y = r / n;
    let u = (f32(x) + 0.5) * inv - 1.0; let v = (f32(y) + 0.5) * inv - 1.0;
    let rl = inverseSqrt(1.0 + u * u + v * v);
    let Ld = faceDirUV(f, u, v) * rl;
    let NdotL = dot(N, Ld);
    if (NdotL > 0.0) {
      let wt = ggxWeight(NdotL, a2) * rl * rl * rl; // texel solid angle ~ (1 + u^2 + v^2)^-3/2
      acc += vec4(textureLoad(src, vec2<i32>(i32(x), i32(y)), i32(f), 0).rgb * wt, wt);
    }
  }
  sCol[li] = acc;
  workgroupBarrier();
  for (var s = 32u; s > 0u; s >>= 1u) {
    if (li < s) { sCol[li] += sCol[li + s]; }
    workgroupBarrier();
  }
  if (li == 0u) {
    let t = sCol[0];
    textureStore(dst, vec2(ox, oy), wg.y, vec4(t.rgb / t.w, 1.0));
  }
}`;

// The same integration, one thread per output texel, source texels staged through shared memory.
const INTEG_TILED_WGSL = /* wgsl */ `${COMMON}
struct I { outSize: u32, srcSize: u32, roughness: f32, pad: f32 }
@group(0) @binding(0) var src: texture_2d_array<f32>;
@group(0) @binding(1) var dst: texture_storage_2d_array<rgba16float, write>;
@group(0) @binding(2) var<uniform> P: I;
var<workgroup> tDir: array<vec4<f32>, 64>;
var<workgroup> tCol: array<vec4<f32>, 64>;
@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) id: vec3<u32>, @builtin(local_invocation_index) li: u32) {
  let inside = id.x < P.outSize && id.y < P.outSize;
  let N = faceDir(id.z, vec2<f32>(id.xy), f32(P.outSize));
  let alpha = P.roughness * P.roughness; let a2 = alpha * alpha;
  let n = P.srcSize; let per = n * n; let total = 6u * per;
  let inv = 2.0 / f32(n);
  var acc = vec4(0.0);
  for (var base = 0u; base < total; base += 64u) {
    let k = base + li;
    if (k < total) {
      let f = k / per; let r = k - f * per;
      let x = r % n; let y = r / n;
      let u = (f32(x) + 0.5) * inv - 1.0; let v = (f32(y) + 0.5) * inv - 1.0;
      let rl = inverseSqrt(1.0 + u * u + v * v);
      tDir[li] = vec4(faceDirUV(f, u, v) * rl, rl * rl * rl);
      tCol[li] = textureLoad(src, vec2<i32>(i32(x), i32(y)), i32(f), 0);
    } else {
      tDir[li] = vec4(0.0); tCol[li] = vec4(0.0);
    }
    workgroupBarrier();
    for (var j = 0u; j < 64u; j++) {
      let d = tDir[j];
      let NdotL = dot(N, d.xyz);
      if (NdotL > 0.0) {
        let wt = ggxWeight(NdotL, a2) * d.w;
        acc += vec4(tCol[j].rgb * wt, wt);
      }
    }
    workgroupBarrier();
  }
  if (inside) { textureStore(dst, id.xy, id.z, vec4(acc.rgb / acc.w, 1.0)); }
}`;

// 2x2 box downsample of the source cube's mip chain (what three's mipmap generation does).
const DOWNSAMPLE_WGSL = /* wgsl */ `
@group(0) @binding(0) var src: texture_2d_array<f32>;
@group(0) @binding(1) var dst: texture_storage_2d_array<rgba16float, write>;
@group(0) @binding(2) var<uniform> size: vec4<u32>; // x = dst size
@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= size.x || id.y >= size.x) { return; }
  let p = vec2<i32>(id.xy) * 2; let f = i32(id.z);
  let c = textureLoad(src, p, f, 0) + textureLoad(src, p + vec2(1, 0), f, 0)
        + textureLoad(src, p + vec2(0, 1), f, 0) + textureLoad(src, p + vec2(1, 1), f, 0);
  textureStore(dst, id.xy, id.z, c * 0.25);
}`;

/** Cube PMREM faces stop at 8 px, as in three r187 (`LOD_MIN`). */
export const LOD_MIN = 3;
const INTEGRATION_SIZE = 16;
const INTEGRATION_LEVELS = 3;
const GGX_SAMPLES = 256;

/** Last roughness mip of a probe of `size` px faces. */
export const maxLodFor = (size: number) => Math.log2(size) - LOD_MIN;
/** The roughness a mip was prefiltered for (inverse of the node's `maxLod * r * (2 - r)`). */
export const lodToRoughness = (lod: number, maxLod: number) => (maxLod > 0 ? 1 - Math.sqrt(1 - lod / maxLod) : 0);

interface Pass { pipe: GPUComputePipeline; group: GPUBindGroup; wg: [number, number, number] }
interface Pipes { down: GPUComputePipeline; fis: GPUComputePipeline; integ: GPUComputePipeline; tiled: GPUComputePipeline }

const _pipes = new WeakMap<GPUDevice, Map<string, Pipes>>();

/** Compute pipelines per device and warp flag, created on first use (and kept). */
function pipesFor(device: GPUDevice, warp: boolean): Pipes {
  let byDevice = _pipes.get(device);
  if (!byDevice) _pipes.set(device, (byDevice = new Map()));
  const key = warp ? 'warp' : 'plain';
  let p = byDevice.get(key);
  if (!p) {
    const make = (code: string, label: string) => device.createComputePipeline({
      label: `ProbePrefilter.${label}`,
      layout: 'auto',
      compute: { module: device.createShaderModule({ code, label }), entryPoint: 'main', constants: code.includes('override WARP') ? { WARP: warp ? 1 : 0 } : {} },
    });
    p = { down: make(DOWNSAMPLE_WGSL, 'down'), fis: make(FIS_WGSL, 'fis'), integ: make(INTEG_WGSL, 'integ'), tiled: make(INTEG_TILED_WGSL, 'tiled') };
    byDevice.set(key, p);
  }
  return p;
}

/**
 * Prefilters captured cubes of one face size into probe slots of a 2D array texture
 * (slot `i` = layers `6 i ... 6 i + 5`, mips 0 ... maxLod). Owns a scratch source cube with a full
 * mip chain and a scratch output; both are reused for every probe and every bake.
 */
export class ProbePrefilter {
  readonly size: number;
  readonly maxLod: number;
  readonly warp: boolean;
  private readonly device: GPUDevice;
  private readonly src: GPUTexture;
  private readonly out: GPUTexture;
  private readonly passes: Pass[] = [];
  private readonly owned: (GPUTexture | GPUBuffer)[] = [];

  constructor(device: GPUDevice, size: number, warp = false) {
    if (!Number.isInteger(Math.log2(size)) || size < 2 * INTEGRATION_SIZE) throw new Error(`ProbePrefilter: size must be a power of two >= ${2 * INTEGRATION_SIZE}, got ${size}.`);
    this.device = device;
    this.size = size;
    this.warp = warp;
    this.maxLod = maxLodFor(size);
    const pipes = pipesFor(device, warp);
    const U = GPUTextureUsage;
    const srcMips = Math.log2(size) + 1;
    this.src = device.createTexture({ label: 'ProbePrefilter.source', size: [size, size, 6], format: 'rgba16float', mipLevelCount: srcMips, usage: U.STORAGE_BINDING | U.TEXTURE_BINDING | U.COPY_DST });
    this.out = device.createTexture({ label: 'ProbePrefilter.out', size: [size, size, 6], format: 'rgba16float', mipLevelCount: this.maxLod + 1, usage: U.STORAGE_BINDING | U.COPY_SRC });
    this.owned.push(this.src, this.out);
    const level = (t: GPUTexture, mip: number) => t.createView({ dimension: '2d-array', baseMipLevel: mip, mipLevelCount: 1 });
    const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear' });
    const srcCube = this.src.createView({ dimension: 'cube' });
    const srcInteg = level(this.src, Math.log2(size / INTEGRATION_SIZE));

    // source mip chain
    for (let m = 1; m < srcMips; m++) {
      const s = size >> m;
      this.add(pipes.down, [Math.ceil(s / 8), Math.ceil(s / 8), 6], [level(this.src, m - 1), level(this.src, m), { buffer: this.uniform(new Uint32Array([s, 0, 0, 0]).buffer) }]);
    }
    // one pass per roughness level
    for (let lod = 0; lod <= this.maxLod; lod++) {
      const s = size >> lod;
      const r = lodToRoughness(lod, this.maxLod);
      const u = new ArrayBuffer(16);
      if (lod > this.maxLod - INTEGRATION_LEVELS && lod > 0) {
        new Uint32Array(u, 0, 2).set([s, INTEGRATION_SIZE]);
        new Float32Array(u, 8, 1).set([r]);
        const tiled = s >= 32;
        this.add(tiled ? pipes.tiled : pipes.integ, tiled ? [Math.ceil(s / 8), Math.ceil(s / 8), 6] : [s * s, 6, 1], [srcInteg, level(this.out, lod), { buffer: this.uniform(u) }]);
      } else {
        // 1 / (samples * pdf) in source texels, with a half-mip bias against sampling noise (three r187)
        const lodBias = r > 0 ? Math.log2(size) + 0.5 * Math.log2(6 / (GGX_SAMPLES * Math.pow(r, 4))) + 0.5 : 0;
        new Uint32Array(u, 0, 2).set([s, lod === 0 ? 1 : GGX_SAMPLES]);
        new Float32Array(u, 8, 2).set([r, lodBias]);
        this.add(pipes.fis, [Math.ceil(s / 8), Math.ceil(s / 8), 6], [srcCube, sampler, level(this.out, lod), { buffer: this.uniform(u) }]);
      }
    }
  }

  /**
   * Records the prefilter of `source` (a cube of `size` px faces, mip 0 read) into probe slot
   * `slot` of `target` (a 2D array of `size` px layers with at least `maxLod + 1` mips).
   */
  encode(encoder: GPUCommandEncoder, source: GPUTexture, target: GPUTexture, slot: number) {
    const n = this.size;
    encoder.copyTextureToTexture({ texture: source, mipLevel: 0 }, { texture: this.src, mipLevel: 0 }, [n, n, 6]);
    const pass = encoder.beginComputePass({ label: 'ProbePrefilter' });
    for (const p of this.passes) {
      pass.setPipeline(p.pipe);
      pass.setBindGroup(0, p.group);
      pass.dispatchWorkgroups(...p.wg);
    }
    pass.end();
    for (let lod = 0; lod <= this.maxLod; lod++) {
      const s = n >> lod;
      encoder.copyTextureToTexture({ texture: this.out, mipLevel: lod }, { texture: target, mipLevel: lod, origin: [0, 0, slot * 6] }, [s, s, 6]);
    }
  }

  dispose() {
    for (const r of this.owned) r.destroy();
    this.owned.length = 0;
  }

  private uniform(data: ArrayBuffer) {
    const buf = this.device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.device.queue.writeBuffer(buf, 0, data);
    this.owned.push(buf);
    return buf;
  }

  private add(pipe: GPUComputePipeline, wg: [number, number, number], resources: GPUBindingResource[]) {
    const group = this.device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: resources.map((resource, binding) => ({ binding, resource })) });
    this.passes.push({ pipe, group, wg });
  }
}
