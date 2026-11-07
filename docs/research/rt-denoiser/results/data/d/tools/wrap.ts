// Track D scratch wrapper (cost variants + diagnostics) (tracks/d.md; scratch, our tool): re-exports the registry and adds joint A-SVGF entries built
// from several frozen package copies (cost variants), each reporting its CPU encode + submit time as pass 'cpu':
//   c-<v>   DiffuseSpecularDenoiser (package defaults = svgf-auto) from $S/cost/<v>, registered for 'diffuse' only
//           so the test bed's bench times the joint dispatch
//   dbg-n / dbg-a  per-signal A-SVGF (HEAD copy) writing (history length n, lambda, output luma) / the temporal
//           accumulation instead of the output (from results/data/svgf-followups/tools/registry-wrap-dbg.ts)
//   c-empty an empty command buffer submit (completion latency floor); c-tiny one 1-workgroup dispatch
export * from '/Users/dex/Developer/Denoiser-track-d/tools/rt-capture/src/denoisers';
import { registerDenoiser, svgfOptions } from '/Users/dex/Developer/Denoiser-track-d/tools/rt-capture/src/denoisers';
import * as V0 from '/private/tmp/claude-502/-Users-dex-Developer-Denoiser--claude-worktrees-nppd-denoiser-research-5f614d/1eaa7c31-86f1-4b40-9623-983504de8b23/scratchpad/d/cost/v0/packages/denoiser-realtime/src/index.ts';
import * as BG from '/private/tmp/claude-502/-Users-dex-Developer-Denoiser--claude-worktrees-nppd-denoiser-research-5f614d/1eaa7c31-86f1-4b40-9623-983504de8b23/scratchpad/d/cost/bg/packages/denoiser-realtime/src/index.ts';
import * as ONE from '/private/tmp/claude-502/-Users-dex-Developer-Denoiser--claude-worktrees-nppd-denoiser-research-5f614d/1eaa7c31-86f1-4b40-9623-983504de8b23/scratchpad/d/cost/one/packages/denoiser-realtime/src/index.ts';
import * as X from '/private/tmp/claude-502/-Users-dex-Developer-Denoiser--claude-worktrees-nppd-denoiser-research-5f614d/1eaa7c31-86f1-4b40-9623-983504de8b23/scratchpad/d/snap1/packages/denoiser-realtime/src/index.ts';
import * as BGONE from '/private/tmp/claude-502/-Users-dex-Developer-Denoiser--claude-worktrees-nppd-denoiser-research-5f614d/1eaa7c31-86f1-4b40-9623-983504de8b23/scratchpad/d/cost/bgone/packages/denoiser-realtime/src/index.ts';

const VARIANTS: Record<string, typeof V0> = { v0: V0, bg: BG, one: ONE, bgone: BGONE };
for (const [v, mod] of Object.entries(VARIANTS)) registerDenoiser({
  id: 'c-' + v, description: 'scratch: joint A-SVGF from cost variant ' + v, signals: ['diffuse'] as never,
  create: (device, ctx) => {
    const o: Record<string, unknown> = svgfOptions(ctx.settings) as never;
    if (ctx.settings.timestamps !== undefined) o.timestamps = !['0', 'false', 'off'].includes(ctx.settings.timestamps);
    const den = new mod.DiffuseSpecularDenoiser(device, o as never);
    den.configure({ width: ctx.width, height: ctx.height });
    let cpu = 0;
    return {
      signals: ['diffuse'] as never,
      dispatch(frame) {
        const { diffuse, specular } = frame.inputs as never as { diffuse: never; specular: never };
        const t = performance.now();
        const o = den.dispatchBoth({ diffuse, specular }, frame.guides, frame.camera);
        cpu = performance.now() - t;
        return { diffuse: o.diffuse } as never;
      },
      resetHistory() { den.resetHistory(); },
      gpuTimings() { const m = new Map(den.gpuTimings ?? []); m.set('cpu', cpu); return m; },
      dispose() { den.dispose(); },
    };
  },
});
const TRIVIAL = '@group(0) @binding(0) var<storage, read_write> b: array<u32>; @compute @workgroup_size(1) fn main() { b[0] = b[0] + 1u; }';
for (const id of ['c-empty', 'c-tiny']) registerDenoiser({
  id, description: 'scratch: submit latency floor', signals: ['diffuse'] as never,
  create: (device, ctx) => {
    const buf = device.createBuffer({ size: 16, usage: GPUBufferUsage.STORAGE });
    const pipe = device.createComputePipeline({ layout: 'auto', compute: { module: device.createShaderModule({ code: TRIVIAL }), entryPoint: 'main' } });
    const bg = device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: buf } }] });
    const tex = device.createTexture({ size: [ctx.width, ctx.height], format: 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC });
    let cpu = 0;
    return {
      signals: ['diffuse'] as never,
      dispatch() {
        const t = performance.now();
        const enc = device.createCommandEncoder();
        if (id === 'c-tiny') { const p = enc.beginComputePass(); p.setPipeline(pipe); p.setBindGroup(0, bg); p.dispatchWorkgroups(1); p.end(); }
        device.queue.submit([enc.finish()]);
        cpu = performance.now() - t;
        return { diffuse: tex } as never;
      },
      resetHistory() {},
      gpuTimings() { return new Map([['cpu', cpu]]); },
      dispose() { buf.destroy(); tex.destroy(); },
    };
  },
});

// ---- diagnostics (svgf-followups' dbg-n / dbg-a, on the HEAD copy)
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
      const d = s === 'diffuse' ? new V0.DiffuseDenoiser(device, o) : new V0.SpecularDenoiser(device, o);
      d.configure({ width, height });
      const t = device.createTexture({ size: [width, height], format: 'rgba16float', usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC });
      return [s, { d, t }] as const;
    }));
    return {
      signals,
      dispatch(frame) {
        const out: Record<string, GPUTexture> = {};
        for (const [s, { d, t }] of dens) {
          const o = (d as InstanceType<typeof V0.DiffuseDenoiser>).dispatch(frame.inputs[s] as never, frame.guides, frame.camera);
          const acc = (d as InstanceType<typeof V0.DiffuseDenoiser>).debugTexture('accum')!;
          const lam = (d as InstanceType<typeof V0.DiffuseDenoiser>).debugTexture('gradient')!;
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

// ---- x-auto: the joint A-SVGF default from the worktree copy (snap1) with the track-D experiment options
// (stabilize, stabilizeAlpha, stabilizeClip, stabilizeMaxHistory; d. / s. prefixes per signal as the registry's svgf entries)
const XN = ['stabilizeAlpha', 'stabilizeClip', 'stabilizeMaxHistory'];
const xopts = (st: Record<string, string>) => {
  const o: Record<string, unknown> = svgfOptions(st) as never;
  if (st.timestamps !== undefined) o.timestamps = !['0', 'false', 'off'].includes(st.timestamps);
  for (const k of XN) if (st[k] !== undefined) o[k] = Number(st[k]);
  if (st.stabilize !== undefined) o.stabilize = !['0', 'false', 'off'].includes(st.stabilize);
  return o;
};
registerDenoiser({
  id: 'x-auto', description: 'scratch: joint A-SVGF (worktree copy) + track-D experiment options', signals: ['diffuse', 'specular'],
  create: (device, ctx) => {
    const pre = (p: string) => Object.fromEntries(Object.entries(ctx.settings).filter(([k]) => k.startsWith(p)).map(([k, v]) => [k.slice(p.length), v]));
    const o = xopts(ctx.settings);
    const dSt = pre('d.'), sSt = pre('s.');
    if (Object.keys(dSt).length) o.diffuse = xopts(dSt);
    if (Object.keys(sSt).length) o.specular = xopts(sSt);
    const den = new X.DiffuseSpecularDenoiser(device, o as never);
    den.configure({ width: ctx.width, height: ctx.height });
    return {
      signals: ['diffuse', 'specular'],
      dispatch(frame) {
        const { diffuse, specular } = frame.inputs as never as { diffuse: never; specular: never };
        return den.dispatchBoth({ diffuse, specular }, frame.guides, frame.camera) as never;
      },
      resetHistory() { den.resetHistory(); },
      gpuTimings() { return new Map(den.gpuTimings ?? []); },
      dispose() { den.dispose(); },
    };
  },
});
