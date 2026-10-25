// ShResolver: resolves the directional payload of `payload: 'sh'` denoisers
// (resolve 'none') to demodulated rgb at a detail normal (SPEC v0.3 M7-9, M7-11).
// One compute pass: payload (rgba32uint) + detail normal [+ guide normal] -> rgba16float.
// Renderers that resolve inside their own shaders use SH_RESOLVE_WGSL instead.
import { makeBindGroup, makeLayout, makePipeline, storageTex } from './gpu';
import { SH_RESOLVE_WGSL } from './shaders/sh';

export interface ShResolverOptions {
  /**
   * Sharpening s in [0, 1] (SPEC M7-9): blends the L1 evaluation toward ambient + one
   * clamped-cosine light extracted from the payload, renormalized to stay exact at the
   * guide normal. Needs `guideNormal` in resolve(). Default 0.
   */
  sharpen?: number;
}

const CODE = /* wgsl */ `
${SH_RESOLVE_WGSL}
struct RP { sharpen: f32, pad0: f32, pad1: f32, pad2: f32 }
@group(0) @binding(0) var<uniform> R: RP;
@group(0) @binding(1) var payload: texture_2d<u32>;
@group(0) @binding(2) var detailN: texture_2d<f32>;
@group(0) @binding(3) var guideN: texture_2d<f32>;
@group(0) @binding(4) var outRgb: texture_storage_2d<rgba16float, write>;
fn unit(v: vec3f) -> vec3f { return v / max(length(v), 1e-6); }
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let dims = textureDimensions(outRgb);
  if (any(gid.xy >= dims)) { return; }
  let p = vec2i(gid.xy);
  let sh = shUnpack(textureLoad(payload, p, 0));
  let nd = unit(textureLoad(detailN, p, 0).xyz);
  let ng = unit(textureLoad(guideN, p, 0).xyz);
  textureStore(outRgb, p, vec4f(shResolveDiffuse(sh, nd, R.sharpen, ng), 1.0));
}
`;

/** Resolves an SH payload texture to rgb at the detail normal (diffuse). */
export class ShResolver {
  readonly device: GPUDevice;
  private layout: GPUBindGroupLayout;
  private pipeline: GPUComputePipeline;
  private params: GPUBuffer;
  private out?: GPUTexture;
  private sharpen: number;

  constructor(device: GPUDevice, options: ShResolverOptions = {}) {
    this.device = device;
    this.sharpen = options.sharpen ?? 0;
    this.layout = makeLayout(device, 'sh resolve', ['u', 'i', 'f', 'f', 'rgba16float']);
    this.pipeline = makePipeline(device, 'sh resolve', CODE, this.layout);
    this.params = device.createBuffer({ label: 'sh resolve params', size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.setSharpen(this.sharpen);
  }

  /** Changes the sharpening (takes effect on the next resolve). */
  setSharpen(s: number) {
    this.sharpen = Math.min(Math.max(s, 0), 1);
    this.device.queue.writeBuffer(this.params, 0, new Float32Array([this.sharpen, 0, 0, 0]));
  }

  /**
   * Records the resolve into `enc`. Returns the rgba16float output (owned by the
   * resolver, valid until the next resolve at another size / dispose). `guideNormal`
   * (the filter's `guides.normal`) is needed only for sharpening.
   */
  encode(enc: GPUCommandEncoder, payload: GPUTexture, detailNormal: GPUTexture, guideNormal?: GPUTexture): GPUTexture {
    if (this.sharpen > 0 && !guideNormal) throw new Error('ShResolver: sharpen > 0 needs guideNormal');
    const { width, height } = payload;
    if (!this.out || this.out.width !== width || this.out.height !== height) {
      this.out?.destroy();
      this.out = this.device.createTexture({
        label: 'sh resolve output', size: [width, height], format: 'rgba16float', usage: storageTex() | GPUTextureUsage.COPY_SRC,
      });
    }
    const pass = enc.beginComputePass({ label: 'sh resolve' });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, makeBindGroup(this.device, this.layout, [this.params, payload, detailNormal, guideNormal ?? detailNormal, this.out]));
    pass.dispatchWorkgroups(Math.ceil(width / 8), Math.ceil(height / 8));
    pass.end();
    return this.out;
  }

  /** Encodes and submits the resolve on `device.queue`. */
  resolve(payload: GPUTexture, detailNormal: GPUTexture, guideNormal?: GPUTexture): GPUTexture {
    const enc = this.device.createCommandEncoder({ label: 'sh resolve' });
    const out = this.encode(enc, payload, detailNormal, guideNormal);
    this.device.queue.submit([enc.finish()]);
    return out;
  }

  dispose() {
    this.out?.destroy();
    this.params.destroy();
  }
}
