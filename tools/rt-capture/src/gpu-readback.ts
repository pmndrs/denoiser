// Read GPU textures back to tightly packed float32 (`width × height × channels`, row 0 =
// top), the capture format's layout. Works for any float-sampleable color format
// (r32float, rgba16float, rgba8unorm, ...) and depth formats, via a tiny compute copy:
// no bytesPerRow alignment, no per-format decoding. Textures need TEXTURE_BINDING.

const COPY_WGSL = (depth: boolean) => /* wgsl */ `
struct U { w: u32, h: u32, ch: u32, _p: u32 };
@group(0) @binding(0) var src: ${depth ? 'texture_depth_2d' : 'texture_2d<f32>'};
@group(0) @binding(1) var<storage, read_write> dst: array<f32>;
@group(0) @binding(2) var<uniform> u: U;
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= u.w || id.y >= u.h) { return; }
  let v = ${depth ? 'vec4f(textureLoad(src, id.xy, 0), 0.0, 0.0, 0.0)' : 'textureLoad(src, id.xy, 0)'};
  let base = (id.y * u.w + id.x) * u.ch;
  for (var c = 0u; c < u.ch; c++) { dst[base + c] = v[c]; }
}`;

interface Pipes { color: GPUComputePipeline; depth: GPUComputePipeline }
const cache = new WeakMap<GPUDevice, Pipes>();

function pipes(device: GPUDevice): Pipes {
  let p = cache.get(device);
  if (p) return p;
  const make = (depth: boolean) => {
    const layout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: depth ? 'depth' : 'unfilterable-float' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      ],
    });
    return device.createComputePipeline({
      label: `rt-capture readback (${depth ? 'depth' : 'color'})`,
      layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      compute: { module: device.createShaderModule({ code: COPY_WGSL(depth) }), entryPoint: 'main' },
    });
  };
  p = { color: make(false), depth: make(true) };
  cache.set(device, p);
  return p;
}

const isDepth = (f: GPUTextureFormat) => f.startsWith('depth');

export interface ReadbackItem {
  texture: GPUTexture;
  /** Channels to keep, from .r up (1–4). */
  channels: number;
}

/** Read several textures in one submit. Resolves to one Float32Array per item. */
export async function readTextures(device: GPUDevice, items: readonly ReadbackItem[]): Promise<Float32Array[]> {
  const enc = device.createCommandEncoder({ label: 'rt-capture readback' });
  const staged: { read: GPUBuffer; tmp: GPUBuffer[] }[] = [];
  for (const { texture, channels } of items) {
    if (!(channels >= 1 && channels <= 4)) throw new Error(`readTextures: channels must be 1..4 (got ${channels})`);
    if (!(texture.usage & GPUTextureUsage.TEXTURE_BINDING)) throw new Error(`readTextures: ${texture.label || 'texture'} lacks TEXTURE_BINDING usage`);
    const { width: w, height: h } = texture;
    const size = w * h * channels * 4;
    const out = device.createBuffer({ size, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    const read = device.createBuffer({ size, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const uni = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(uni, 0, new Uint32Array([w, h, channels, 0]));
    const depth = isDepth(texture.format);
    const pipe = depth ? pipes(device).depth : pipes(device).color;
    const view = depth ? texture.createView({ aspect: 'depth-only', dimension: '2d', baseMipLevel: 0, mipLevelCount: 1 })
      : texture.createView({ dimension: '2d', baseMipLevel: 0, mipLevelCount: 1, baseArrayLayer: 0, arrayLayerCount: 1 });
    const bg = device.createBindGroup({
      layout: pipe.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: view }, { binding: 1, resource: { buffer: out } }, { binding: 2, resource: { buffer: uni } }],
    });
    const pass = enc.beginComputePass();
    pass.setPipeline(pipe);
    pass.setBindGroup(0, bg);
    pass.dispatchWorkgroups(Math.ceil(w / 8), Math.ceil(h / 8));
    pass.end();
    enc.copyBufferToBuffer(out, 0, read, 0, size);
    staged.push({ read, tmp: [out, uni] });
  }
  device.queue.submit([enc.finish()]);
  return Promise.all(staged.map(async ({ read, tmp }) => {
    await read.mapAsync(GPUMapMode.READ);
    const data = new Float32Array(read.getMappedRange().slice(0));
    read.unmap();
    read.destroy();
    for (const b of tmp) b.destroy();
    return data;
  }));
}

export async function readTexture(device: GPUDevice, texture: GPUTexture, channels: number): Promise<Float32Array> {
  return (await readTextures(device, [{ texture, channels }]))[0];
}
