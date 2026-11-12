// Scratch registry wrapper (svgf-followups, 2026-10-27): re-exports the project registry and adds diagnostic entries.
//   dbg-n: per-signal SVGF (svgfOptions(settings, { antiLag: 'auto' })); each signal's output file holds
//          rgb = (history length n after the temporal pass, lambda at the pixel's stratum, output luminance)
export * from '/Users/dex/Developer/Denoiser-nrd-cleanroom/tools/rt-capture/src/denoisers';
import { registerDenoiser, svgfOptions } from '/Users/dex/Developer/Denoiser-nrd-cleanroom/tools/rt-capture/src/denoisers';
import { DiffuseDenoiser, SpecularDenoiser } from '../../../../packages/denoiser-realtime/src/index';

const WGSL = /* wgsl */ `
@group(0) @binding(0) var accum: texture_2d<f32>;
@group(0) @binding(1) var lam: texture_2d<f32>;
@group(0) @binding(2) var outp: texture_2d<f32>;
@group(0) @binding(3) var dst: texture_storage_2d<rgba16float, write>;
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let p = vec2i(gid.xy);
  let d = vec2i(textureDimensions(accum));
  if (p.x >= d.x || p.y >= d.y) { return; }
  let ld = vec2i(textureDimensions(lam));
  let l = textureLoad(lam, min(p / 3, ld - 1), 0).r;
  let o = textureLoad(outp, p, 0).rgb;
  textureStore(dst, p, vec4f(textureLoad(accum, p, 0).a, l, dot(o, vec3f(0.2126, 0.7152, 0.0722)), 1.0));
}`;
// dbg-a: the temporal accumulation's colour (before the spatial filter)
const WGSL_A = WGSL.replace('vec4f(textureLoad(accum, p, 0).a, l, dot(o, vec3f(0.2126, 0.7152, 0.0722)), 1.0)', 'vec4f(textureLoad(accum, p, 0).rgb + vec3f(0.0 * l + 0.0 * o.r), 1.0)');

for (const [id, code] of [['dbg-n', WGSL], ['dbg-a', WGSL_A]] as const) registerDenoiser({
  id, description: 'scratch: SVGF history length n / lambda / output luminance per signal', signals: ['diffuse', 'specular'],
  create: (device, { width, height, signals, settings }) => {
    const mod = device.createShaderModule({ code });
    const pipe = device.createComputePipeline({ layout: 'auto', compute: { module: mod, entryPoint: 'main' } });
    const dens = new Map(signals.map((s) => {
      const o = svgfOptions(settings, { antiLag: 'auto' });
      const d = s === 'diffuse' ? new DiffuseDenoiser(device, o) : new SpecularDenoiser(device, o);
      d.configure({ width, height });
      const t = device.createTexture({ size: [width, height], format: 'rgba16float', usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC });
      return [s, { d, t }] as const;
    }));
    return {
      signals,
      dispatch(frame) {
        const out: Record<string, GPUTexture> = {};
        for (const [s, { d, t }] of dens) {
          const o = (d as DiffuseDenoiser).dispatch(frame.inputs[s] as never, frame.guides, frame.camera);
          const acc = (d as DiffuseDenoiser).debugTexture('accum')!;
          const lam = (d as DiffuseDenoiser).debugTexture('gradient')!;
          const enc = device.createCommandEncoder();
          const pass = enc.beginComputePass();
          pass.setPipeline(pipe);
          pass.setBindGroup(0, device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: [
            { binding: 0, resource: acc.createView() }, { binding: 1, resource: lam.createView() },
            { binding: 2, resource: o.createView() }, { binding: 3, resource: t.createView() }] }));
          pass.dispatchWorkgroups(Math.ceil(width / 8), Math.ceil(height / 8));
          pass.end();
          device.queue.submit([enc.finish()]);
          out[s] = t;
        }
        return out as never;
      },
      resetHistory() { for (const { d } of dens.values()) d.resetHistory(); },
      dispose() { for (const { d, t } of dens.values()) { d.dispose(); t.destroy(); } },
    };
  },
});
