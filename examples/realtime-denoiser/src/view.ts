// Panel display: one canvas per panel (noisy | denoised | reference).
// mode 0: scalar in .r (visibility); 1: HDR rgb, Reinhard + gamma; 2: debug, |rgb| * scale.
export const VIEW_WGSL = /* wgsl */ `
struct V { canvas: vec2f, tex: vec2f, mode: u32, exposure: f32, errGain: f32, _p: f32 };
@group(0) @binding(0) var<uniform> v: V;
@group(0) @binding(1) var t0: texture_2d<f32>;
@group(0) @binding(2) var tref: texture_2d<f32>;

@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4f(p * 2.0 - 1.0, 0.0, 1.0);
}

fn show(c: vec4f) -> vec3f {
  if (v.mode == 0u) { return vec3f(pow(clamp(c.r, 0.0, 1.0), 1.0 / 2.2)); }
  if (v.mode == 2u) { return clamp(abs(c.rgb) * v.exposure, vec3f(0.0), vec3f(1.0)); }
  let x = max(c.rgb * v.exposure, vec3f(0.0));
  return pow(x / (1.0 + x), vec3f(1.0 / 2.2));
}

@fragment fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let p = vec2u(fc.xy / v.canvas * v.tex);
  let c = textureLoad(t0, p, 0);
  if (v.errGain > 0.0) {
    // error heat map: |shown(texture) - shown(reference)| * gain
    return vec4f(abs(show(c) - show(textureLoad(tref, p, 0))) * v.errGain, 1.0);
  }
  return vec4f(show(c), 1.0);
}
`;

export class PanelView {
  private ctxs: GPUCanvasContext[];
  private pipe: GPURenderPipeline;
  private us: GPUBuffer[];
  constructor(private device: GPUDevice, private canvases: HTMLCanvasElement[], private W: number, private H: number) {
    const panelW = Math.max(200, Math.min(640, Math.round(canvases[0]?.clientWidth || 640)));
    const panelH = Math.round(panelW * H / W);
    const fmt = navigator.gpu.getPreferredCanvasFormat();
    this.ctxs = canvases.map((c) => {
      c.width = panelW; c.height = panelH;
      const cx = c.getContext('webgpu')!;
      cx.configure({ device, format: fmt });
      return cx;
    });
    const mod = device.createShaderModule({ code: VIEW_WGSL });
    this.pipe = device.createRenderPipeline({
      layout: 'auto', vertex: { module: mod, entryPoint: 'vs' },
      fragment: { module: mod, entryPoint: 'fs', targets: [{ format: fmt }] },
    });
    this.us = canvases.map(() => device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }));
  }
  show(panels: { tex: GPUTexture; mode: number; exposure?: number; errGain?: number }[], ref: GPUTexture) {
    const enc = this.device.createCommandEncoder();
    panels.forEach((pn, i) => {
      if (!this.ctxs[i]) return;
      const b = new ArrayBuffer(32);
      const f = new Float32Array(b);
      f.set([this.canvases[i].width, this.canvases[i].height, this.W, this.H]);
      new Uint32Array(b)[4] = pn.mode;
      f[5] = pn.exposure ?? 1; f[6] = pn.errGain ?? 0;
      this.device.queue.writeBuffer(this.us[i], 0, b);
      const bg = this.device.createBindGroup({
        layout: this.pipe.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: this.us[i] } }, { binding: 1, resource: pn.tex.createView() }, { binding: 2, resource: ref.createView() }],
      });
      const pass = enc.beginRenderPass({ colorAttachments: [{ view: this.ctxs[i].getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] });
      pass.setPipeline(this.pipe); pass.setBindGroup(0, bg); pass.draw(3); pass.end();
    });
    this.device.queue.submit([enc.finish()]);
  }
}
