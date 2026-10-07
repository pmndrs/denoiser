// Aux split-graph workaround for the onnxruntime-web WebGPU Conv bug — ORT-only.
// EncConv0 runs the network's first conv in WGSL; the ORT session then runs a
// re-exported "tail" model on that feature map (see ./runtime.ts).

// enc_conv0 workaround kernel. onnxruntime-web's WebGPU EP miscomputes the
// FIRST Conv that reduces the raw >3-channel graph input (see
// tools/ort-webgpu-aux-repro + ort-webgpu-aux-split: 9ch aux output ~1e-1 off,
// while the same net's later convs — even the 105ch dec_conv1a fed the raw input
// — are correct). We compute just that one conv here (Conv 3x3, pad 1, stride 1,
// CIN->COUT, + relu6) and run a re-exported "tail" model that starts at
// enc_conv1 on ORT-WebGPU. Verified to restore native quality (1.2e-6).
//
// Naive one-thread-per-(x,y,co) form (mirrors the kernel-spike correctness
// anchor). enc_conv0 is a single full-res layer (CIN=9, COUT=32) — trivially
// cheap — so speed doesn't matter; correctness does. Weights/bias are f32 for
// accuracy even when the model IO is f16; accumulation is f32.
const ENC_CONV0 = (io: string) => /* wgsl */ `
${io === 'f16' ? 'enable f16;' : ''}
alias IOType = ${io};
struct P { w:u32, h:u32, cin:u32, cout:u32, batch:u32, _p0:u32, _p1:u32, _p2:u32 };
@group(0) @binding(0) var<storage, read> src: array<IOType>;   // NCHW [B,CIN,H,W]
@group(0) @binding(1) var<storage, read> weights: array<f32>;  // OIHW [COUT,CIN,3,3]
@group(0) @binding(2) var<storage, read> bias: array<f32>;     // [COUT]
@group(0) @binding(3) var<storage, read_write> dst: array<IOType>; // NCHW [B,COUT,H,W]
@group(0) @binding(4) var<uniform> p: P;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  if (g.x >= p.w || g.y >= p.h || g.z >= p.batch * p.cout) { return; }
  let b = g.z / p.cout;
  let co = g.z % p.cout;
  let plane = p.w * p.h;
  let inBase = b * p.cin * plane;
  var acc = bias[co];
  for (var ci = 0u; ci < p.cin; ci++) {
    let wbase = (co * p.cin + ci) * 9u;
    let cbase = inBase + ci * plane;
    for (var ky = 0u; ky < 3u; ky++) {
      let sy = i32(g.y) + i32(ky) - 1;
      if (sy < 0 || sy >= i32(p.h)) { continue; }
      for (var kx = 0u; kx < 3u; kx++) {
        let sx = i32(g.x) + i32(kx) - 1;
        if (sx < 0 || sx >= i32(p.w)) { continue; }
        acc += f32(src[cbase + u32(sy) * p.w + u32(sx)]) * weights[wbase + ky * 3u + kx];
      }
    }
  }
  // relu6 (Clip 0..6) folded into the epilogue
  dst[b * p.cout * plane + co * plane + g.y * p.w + g.x] = IOType(clamp(acc, 0.0, 6.0));
}
`;

/**
 * Compute enc_conv0 (Conv 3x3 pad1 stride1 CIN->COUT + relu6) from an NCHW
 * `src` [B,CIN,H,W] into `dst` [B,COUT,H,W]. `weights` is OIHW [COUT,CIN,3,3]
 * f32, `bias` is [COUT] f32 (both uploaded once, device-lifetime).
 */
export class EncConv0 {
  private pipe: GPUComputePipeline;
  private params: GPUBuffer; // 32B uniform

  constructor(private device: GPUDevice, ioF16: boolean) {
    this.pipe = device.createComputePipeline({
      layout: 'auto',
      compute: { module: device.createShaderModule({ code: ENC_CONV0(ioF16 ? 'f16' : 'f32') }), entryPoint: 'main' },
    });
    this.params = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  }

  encode(
    enc: GPUCommandEncoder, src: GPUBuffer, weights: GPUBuffer, bias: GPUBuffer, dst: GPUBuffer,
    w: number, h: number, cin: number, cout: number, batch: number,
  ) {
    this.device.queue.writeBuffer(this.params, 0, new Uint32Array([w, h, cin, cout, batch, 0, 0, 0]));
    const bind = this.device.createBindGroup({
      layout: this.pipe.getBindGroupLayout(0),
      entries: [src, weights, bias, dst, this.params].map((buffer, i) => ({ binding: i, resource: { buffer } })),
    });
    const pass = enc.beginComputePass();
    pass.setPipeline(this.pipe);
    pass.setBindGroup(0, bind);
    pass.dispatchWorkgroups(Math.ceil(w / 8), Math.ceil(h / 8), batch * cout);
    pass.end();
  }

  destroy() {
    this.params.destroy();
  }
}
