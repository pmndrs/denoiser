// Harness-builder copy of track D's bench wrapper (results/data/d/tools/wrap.ts on track/d-diffuse), for the Windows RTX
// bench. Scratch worktree only, never committed. Registers, on top of the registry:
//   c-v0     joint DiffuseSpecularDenoiser from this worktree's package (track/d-diffuse 02154b7, package defaults),
//            reporting the dispatchBoth() call time as pass 'cpu'; timestamps=0 turns per-pass timestamps off
//   c-empty  an empty command-buffer submit; c-tiny one 1-workgroup dispatch (submit-to-callback floor)
//   x-auto   the same package with track D's experiment options (stabilize, ...)
// Not reproducible here: c-bg / c-one / c-bgone (frozen package copies with local patches that were never committed).
export * from './denoisers';
import { registerDenoiser, svgfOptions } from './denoisers';
import * as V0 from '../../../packages/denoiser-realtime/src/index';

const tsOpt = (st: Record<string, string>, o: Record<string, unknown>) => {
  if (st.timestamps !== undefined) o.timestamps = !['0', 'false', 'off'].includes(st.timestamps);
  return o;
};

registerDenoiser({
  id: 'c-v0', description: 'bench: joint A-SVGF (package defaults), cpu = dispatchBoth() call', signals: ['diffuse'] as never,
  create: (device, ctx) => {
    const o = tsOpt(ctx.settings, svgfOptions(ctx.settings) as never);
    const den = new V0.DiffuseSpecularDenoiser(device, o as never);
    den.configure({ width: ctx.width, height: ctx.height });
    let cpu = 0;
    return {
      signals: ['diffuse'] as never,
      dispatch(frame) {
        const { diffuse, specular } = frame.inputs as never as { diffuse: never; specular: never };
        const t = performance.now();
        const out = den.dispatchBoth({ diffuse, specular }, frame.guides, frame.camera);
        cpu = performance.now() - t;
        return { diffuse: out.diffuse } as never;
      },
      resetHistory() { den.resetHistory(); },
      gpuTimings() { const m = new Map(den.gpuTimings ?? []); m.set('cpu', cpu); return m; },
      dispose() { den.dispose(); },
    };
  },
});

const TRIVIAL = '@group(0) @binding(0) var<storage, read_write> b: array<u32>; @compute @workgroup_size(1) fn main() { b[0] = b[0] + 1u; }';
for (const id of ['c-empty', 'c-tiny']) registerDenoiser({
  id, description: 'bench: submit latency floor', signals: ['diffuse'] as never,
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

const XN = ['stabilizeAlpha', 'stabilizeClip', 'stabilizeMaxHistory'];
const xopts = (st: Record<string, string>) => {
  const o = tsOpt(st, svgfOptions(st) as never);
  for (const k of XN) if (st[k] !== undefined) o[k] = Number(st[k]);
  if (st.stabilize !== undefined) o.stabilize = !['0', 'false', 'off'].includes(st.stabilize);
  return o;
};
registerDenoiser({
  id: 'x-auto', description: 'bench: joint A-SVGF + track-D experiment options', signals: ['diffuse', 'specular'],
  create: (device, ctx) => {
    const pre = (p: string) => Object.fromEntries(Object.entries(ctx.settings).filter(([k]) => k.startsWith(p)).map(([k, v]) => [k.slice(p.length), v]));
    const o = xopts(ctx.settings);
    const dSt = pre('d.'), sSt = pre('s.');
    if (Object.keys(dSt).length) o.diffuse = xopts(dSt);
    if (Object.keys(sSt).length) o.specular = xopts(sSt);
    const den = new V0.DiffuseSpecularDenoiser(device, o as never);
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
