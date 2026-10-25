// Occlusion entries of the denoiser registry (T5 / M5), registered from denoisers.ts via
// registerOcclusionDenoisers() (a function, so this file never imports the registry and no
// import cycle forms). Signals `ao` / `so` are derived (format.ts DERIVED_SIGNALS): inputs are
// the raw hit distance of the diffuse / specular ray; outputs carry ĥ = h / (h + a + b·depth)
// (SPEC F-3, a = 1, b = 0.05 unless set) in `.r`.
//
//   occlusion-recurrent        OcclusionDenoiser, recurrent occlusion-only mode (ao + so in shared
//                              dispatches when both are requested)
//   occlusion-svgf             OcclusionDenoiser, SVGF on ĥ, antiLag 'off' (pinned: SVGF's default is 'auto' since
//                              2026-10-25);  occlusion-svgf-auto  the same, antiLag 'auto' (= OcclusionDenoiser's default,
//                              byte-checked; an 'off' default was tried and reverted, results/OCCLUSION-ANTILAG.md)
//   occlusion-radiance-alpha   AO / SO "for free": the recurrent RADIANCE denoiser (DiffuseDenoiser /
//                              SpecularDenoiser on radiance + hit distance) and its output alpha (ĥ)
//   occlusion-accumulate-32    normalized ĥ through the accumulate-32 baseline (needs viewz + motion_z)
//   occlusion-noisy            the normalized 1-spp ĥ itself
//
// Settings: `o.<option>=v` (OcclusionDenoiser options: hitDistanceScale, hitDistanceViewScale and
// every recurrent option; numbers / true / false / strings), `t.<tune>=v` (RecurrentTune), plain
// SVGF keys as for `svgf` (svgfOptions), and for occlusion-radiance-alpha the `r.` / `d.` / `s.`
// keys of the recurrent entries.
import type { TemporalDenoiser } from '../../../packages/denoiser-core/src/temporal';
import {
  DiffuseDenoiser, HitDistanceNormalizer, OcclusionDenoiser, SpecularDenoiser,
} from '../../../packages/denoiser-realtime/src/index';
import type { OcclusionDenoiserOptions, RecurrentOptions, SpecularSvgfOptions } from '../../../packages/denoiser-realtime/src/index';
import { EmaAccumulateDenoiser } from './accumulate-ema';
import type { DenoiserEntry, ReplayDenoiser, ReplayFrame } from './replay';
import type { SignalName } from './format';

type OccSignal = 'ao' | 'so';
const OCC: SignalName[] = ['ao', 'so'];

export interface OcclusionRegistryHelpers {
  register(entry: DenoiserEntry): void;
  perSignal(make: (device: GPUDevice, signal: SignalName, settings: Record<string, string>) => TemporalDenoiser<object>): DenoiserEntry['create'];
  recurrentOptions(st: Record<string, string>, signal?: 'diffuse' | 'specular'): RecurrentOptions;
  svgfOptions(st: Record<string, string>, defaults?: SpecularSvgfOptions): SpecularSvgfOptions;
}

const val = (v: string) => (v === 'true' ? true : v === 'false' ? false : Number.isNaN(Number(v)) ? v : Number(v));

/** OcclusionDenoiser options from settings (`o.<key>`, `t.<tune>`, plain SVGF keys for filter 'svgf'). */
export function occlusionOptions(st: Record<string, string>, base: Partial<OcclusionDenoiserOptions>,
  svgfOptions: OcclusionRegistryHelpers['svgfOptions']): OcclusionDenoiserOptions {
  const o: Record<string, unknown> = { ...(base.filter === 'svgf' ? svgfOptions(st, base as SpecularSvgfOptions) : {}), ...base };
  const tune: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(st)) {
    if (k.startsWith('o.')) o[k.slice(2)] = val(v);
    else if (k.startsWith('t.') && base.filter !== 'svgf') tune[k.slice(2)] = val(v);
  }
  if (Object.keys(tune).length) o.tune = tune;
  return o as OcclusionDenoiserOptions;
}

const signalOf = (s: SignalName) => (s === 'so' ? 'specular' : 'diffuse');
const hitOf = (frame: ReplayFrame, s: OccSignal) => {
  const h = frame.inputs[s]?.hitDistance;
  if (!h) throw new Error(`capture has no ${s === 'ao' ? 'diffuse' : 'specular'}_hitt`);
  return h;
};

/** OcclusionDenoiser entry: one joint instance for ao + so, or one per requested signal. */
function occlusionEntry(base: Partial<OcclusionDenoiserOptions>, h: OcclusionRegistryHelpers): DenoiserEntry['create'] {
  return (device, ctx) => {
    const both = ctx.signals.includes('ao') && ctx.signals.includes('so');
    const opts = (signal: 'diffuse' | 'specular' | 'both') => ({ ...occlusionOptions(ctx.settings, base, h.svgfOptions), signal }) as OcclusionDenoiserOptions;
    if (!both) {
      const s = ctx.signals.find((x) => x === 'ao' || x === 'so') as OccSignal;
      const den = new OcclusionDenoiser(device, opts(signalOf(s)));
      den.configure({ width: ctx.width, height: ctx.height });
      return {
        signals: [s],
        dispatch: (frame) => ({ [s]: den.dispatch({ hitDistance: hitOf(frame, s) }, frame.guides, frame.camera) }),
        resetHistory: () => den.resetHistory(),
        gpuTimings: () => new Map(den.gpuTimings ?? []),
        dispose: () => den.dispose(),
      };
    }
    const den = new OcclusionDenoiser(device, opts('both'));
    den.configure({ width: ctx.width, height: ctx.height });
    return {
      signals: ['ao', 'so'],
      dispatch(frame) {
        const o = den.dispatchBoth({ diffuse: { hitDistance: hitOf(frame, 'ao') }, specular: { hitDistance: hitOf(frame, 'so') } }, frame.guides, frame.camera);
        return { ao: o.diffuse, so: o.specular };
      },
      resetHistory: () => den.resetHistory(),
      gpuTimings: () => new Map(den.gpuTimings ?? []),
      dispose: () => den.dispose(),
    };
  };
}

/** Copies one channel of a texture into an r32float (the radiance output's alpha = ĥ). */
class ChannelToR {
  private pipe: GPUComputePipeline;
  private out?: GPUTexture;
  constructor(private device: GPUDevice, channel: 'a' | 'r' = 'a') {
    const code = /* wgsl */ `
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var dst: texture_storage_2d<r32float, write>;
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= textureDimensions(dst))) { return; }
  textureStore(dst, id.xy, vec4f(textureLoad(src, id.xy, 0).${channel}));
}`;
    this.pipe = device.createComputePipeline({ label: 'channel to r', layout: 'auto', compute: { module: device.createShaderModule({ code }), entryPoint: 'main' } });
  }
  run(src: GPUTexture): GPUTexture {
    if (!this.out || this.out.width !== src.width || this.out.height !== src.height) {
      this.out?.destroy();
      this.out = this.device.createTexture({ label: 'channel to r', size: [src.width, src.height], format: 'r32float', usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC });
    }
    const enc = this.device.createCommandEncoder({ label: 'channel to r' });
    const pass = enc.beginComputePass();
    pass.setPipeline(this.pipe);
    pass.setBindGroup(0, this.device.createBindGroup({ layout: this.pipe.getBindGroupLayout(0), entries: [
      { binding: 0, resource: src.createView() }, { binding: 1, resource: this.out.createView() }] }));
    pass.dispatchWorkgroups(Math.ceil(src.width / 8), Math.ceil(src.height / 8));
    pass.end();
    this.device.queue.submit([enc.finish()]);
    return this.out;
  }
  dispose() { this.out?.destroy(); }
}

const curveOf = (st: Record<string, string>) => [Number(st['o.hitDistanceScale'] ?? 1), Number(st['o.hitDistanceViewScale'] ?? 0.05)] as const;

export function registerOcclusionDenoisers(h: OcclusionRegistryHelpers): void {
  h.register({
    id: 'occlusion-recurrent', description: 'denoiser/realtime OcclusionDenoiser, recurrent occlusion-only mode (AO / SO, provisional)', signals: OCC,
    create: occlusionEntry({ filter: 'recurrent' }, h),
  });
  h.register({
    id: 'occlusion-svgf', description: "denoiser/realtime OcclusionDenoiser, SVGF (antiLag 'off') on the normalized hit distance", signals: OCC,
    create: occlusionEntry({ filter: 'svgf', antiLag: 'off' }, h),
  });
  h.register({
    id: 'occlusion-svgf-auto', description: "denoiser/realtime OcclusionDenoiser, A-SVGF (antiLag 'auto') on the normalized hit distance", signals: OCC,
    create: occlusionEntry({ filter: 'svgf', antiLag: 'auto' }, h),
  });
  h.register({
    id: 'occlusion-radiance-alpha', description: 'AO / SO from the recurrent radiance denoiser\'s output alpha (diffuse / specular radiance + hit distance)', signals: OCC,
    create: (device, ctx) => {
      const st = ctx.settings;
      const dens = ctx.signals.filter((s): s is OccSignal => s === 'ao' || s === 'so').map((s) => {
        const rad = s === 'so'
          ? new SpecularDenoiser(device, h.recurrentOptions(st, 'specular'))
          : new DiffuseDenoiser(device, h.recurrentOptions(st, 'diffuse'));
        rad.configure({ width: ctx.width, height: ctx.height });
        return { s, rad, copy: new ChannelToR(device, 'a') };
      });
      const den: ReplayDenoiser = {
        signals: dens.map((d) => d.s),
        dispatch(frame) {
          const out: Partial<Record<SignalName, GPUTexture>> = {};
          for (const { s, rad, copy } of dens) {
            const inp = s === 'so' ? frame.inputs.specular : frame.inputs.diffuse;
            if (!inp) throw new Error(`occlusion-radiance-alpha: capture has no ${signalOf(s)} input`);
            out[s] = copy.run(rad.dispatch(inp as never, frame.guides, frame.camera));
          }
          return out;
        },
        resetHistory() { for (const d of dens) d.rad.resetHistory(); },
        gpuTimings() {
          const m = new Map<string, number>();
          for (const d of dens) for (const [k, v] of d.rad.gpuTimings ?? []) m.set(dens.length > 1 ? `${d.s}/${k}` : k, v);
          return m;
        },
        dispose() { for (const d of dens) { d.rad.dispose(); d.copy.dispose(); } },
      };
      return den;
    },
  });
  h.register({
    id: 'occlusion-accumulate-32', description: 'normalized hit distance through accumulate-32 (capped accumulation, no spatial filter)', signals: OCC,
    create: h.perSignal((device, _s, st) => {
      const norm = new HitDistanceNormalizer(device, 'viewz');
      const acc = new EmaAccumulateDenoiser(device, { maxFrames: st.maxFrames ? Number(st.maxFrames) : 32 });
      const [a, b] = curveOf(st);
      return {
        name: 'occlusion-accumulate-32', device,
        configure: (c) => { norm.configure(c.width, c.height, 2); acc.configure(c); },
        dispatch(inputs: { hitDistance: GPUTexture }, guides, camera) {
          const g = guides as typeof guides & { viewZ?: GPUTexture };
          if (!g.viewZ) throw new Error('occlusion-accumulate-32: needs guides.viewZ');
          norm.setCurve(a, b, camera.far);
          return acc.dispatch({ radiance: norm.run(inputs.hitDistance, g.viewZ) }, guides, camera);
        },
        resetHistory: () => acc.resetHistory(),
        dispose: () => { norm.dispose(); acc.dispose(); },
      } as TemporalDenoiser<{ hitDistance: GPUTexture }> as TemporalDenoiser<object>;
    }),
  });
  h.register({
    id: 'occlusion-noisy', description: 'the normalized 1-spp hit distance (noisy AO / SO)', signals: OCC,
    create: h.perSignal((device, _s, st) => {
      const norm = new HitDistanceNormalizer(device, 'viewz');
      const [a, b] = curveOf(st);
      return {
        name: 'occlusion-noisy', device,
        configure: (c) => norm.configure(c.width, c.height, 2),
        dispatch(inputs: { hitDistance: GPUTexture }, guides, camera) {
          const g = guides as typeof guides & { viewZ?: GPUTexture };
          if (!g.viewZ) throw new Error('occlusion-noisy: needs guides.viewZ');
          norm.setCurve(a, b, camera.far);
          return norm.run(inputs.hitDistance, g.viewZ);
        },
        resetHistory() {},
        dispose: () => norm.dispose(),
      } as TemporalDenoiser<{ hitDistance: GPUTexture }> as TemporalDenoiser<object>;
    }),
  });
}

