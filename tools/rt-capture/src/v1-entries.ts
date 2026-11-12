// Registry entries for the CAPTURE-FORMAT v1 signals (testbed-v1; SPEC v0.3 M7-13 / M8-10 baselines).
// Called from denoisers.ts (registerV1Denoisers) with its helpers injected, like occlusion-entries.ts.
//
// Signals (format.ts V1_SIGNALS) and what an entry gets / returns (replay.ts ShInputs,
// TranslucentShadowInputs, shGuides):
//   sh-diffuse   frame.inputs['sh-diffuse'] = { radiance, direction, hitDistance }   (raw-form SH input, M7-4)
//   sh-specular  frame.inputs['sh-specular'] = { radiance, direction, hitDistance }
//                output: demodulated rgb resolved at the shading normal (frame.guides.normal); an SH
//                denoiser filters with shGuides(frame) (normal = normal_geom, detailNormal = normal)
//   shadow-rgb   frame.inputs['shadow-rgb'] = { visibility, hitDistance, translucency, translucencyHitDistance,
//                light via frame.meta.lights | manifest, radiance (= 1-ray v·T), visibilityLumT (= v·lum709 T) }
//                output: rgb v̂·τ̂ (rgba16float with v̂ in alpha is fine: scorers read rgb)
//
//   passthrough, accumulate*   extended to the v1 signals (they read inputs.radiance: the plain sample, or v·T)
//   svgf-plain         M7-13 contender: plain SVGF (DiffuseDenoiser / SpecularDenoiser) on the plain sample,
//                      filter normal = the shading (detail) normal, i.e. today's svgf-diffuse / svgf-specular
//   svgf-plain-smooth  the same with the filter normal = normal_geom (bump shading averaged away)
//                      (both take the svgf URL settings, e.g. antiLag=auto)
//   svgf-plain-default plain SVGF with the package defaults (the shipped A-SVGF: antiLag 'auto', youngNormalPower 16),
//                      filter normal = the shading normal (review target 5, results/T5-normal-detail.md)
//   recurrent-plain    the recurrent filter (package defaults, recurrent URL settings r. / d. / s. / t.) on the plain
//                      sample, filter normal = the shading normal; recurrent-plain-smooth with normal_geom
//   shadows-lumt       M8-10 baseline: ShadowDenoiser (sh.<option> settings) on v·lum709(T) as a scalar,
//                      output (s, s, s): right luminance, no colour
//   ffx-shadows-lumt   FfxShadowDenoiser likewise
import type { TemporalDenoiser } from '../../../packages/denoiser-core/src/temporal';
import { FfxShadowDenoiser } from '../../../packages/denoiser-ffx/src/index';
import { DiffuseDenoiser, ShadowDenoiser, SpecularDenoiser } from '../../../packages/denoiser-realtime/src/index';
import type { RecurrentOptions, ShadowDenoiserOptions, ShadowLight, SpecularSvgfOptions } from '../../../packages/denoiser-realtime/src/index';
import type { CaptureLight, SignalName, V1SignalName } from './format';
import { shGuides, type DenoiserEntry, type ReplayDenoiser, type ReplayFrame } from './replay';

export const V1_SIGNAL_NAMES: V1SignalName[] = ['sh-diffuse', 'sh-specular', 'shadow-rgb'];

interface Helpers {
  register(e: DenoiserEntry): void;
  get(id: string): DenoiserEntry | undefined;
  svgfOptions(st: Record<string, string>, defaults?: SpecularSvgfOptions): SpecularSvgfOptions;
  recurrentOptions(st: Record<string, string>, signal?: 'diffuse' | 'specular'): RecurrentOptions;
  shadowOptions(st: Record<string, string>): ShadowDenoiserOptions;
  shadowLightOf(lights: readonly CaptureLight[] | undefined): ShadowLight | undefined;
  /** denoisers.ts SVGF_PINNED: the plain-SVGF ids' pinned M1 options */
  svgfPinned: SpecularSvgfOptions;
}

/** r32float scalar -> rgba16float (x, x, x, 1), for scalar baselines scored as rgb. */
class ScalarToRgb {
  private pipe: GPUComputePipeline;
  private out?: GPUTexture;
  constructor(private device: GPUDevice) {
    const code = /* wgsl */ `
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var dst: texture_storage_2d<rgba16float, write>;
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= textureDimensions(dst))) { return; }
  let x = textureLoad(src, id.xy, 0).r;
  textureStore(dst, id.xy, vec4f(x, x, x, 1.0));
}`;
    this.pipe = device.createComputePipeline({ label: 'scalar->rgb', layout: 'auto', compute: { module: device.createShaderModule({ code }), entryPoint: 'main' } });
  }
  run(src: GPUTexture): GPUTexture {
    if (!this.out || this.out.width !== src.width || this.out.height !== src.height) {
      this.out?.destroy();
      this.out = this.device.createTexture({ label: 'scalar->rgb', size: [src.width, src.height], format: 'rgba16float', usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC });
    }
    const enc = this.device.createCommandEncoder({ label: 'scalar->rgb' });
    const pass = enc.beginComputePass();
    pass.setPipeline(this.pipe);
    pass.setBindGroup(0, this.device.createBindGroup({ layout: this.pipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: src.createView() }, { binding: 1, resource: this.out.createView() }] }));
    pass.dispatchWorkgroups(Math.ceil(src.width / 8), Math.ceil(src.height / 8));
    pass.end();
    this.device.queue.submit([enc.finish()]);
    return this.out;
  }
  dispose() { this.out?.destroy(); }
}

/** Plain-sample filter of one sh-* signal (SVGF with the pinned M7 options by default). */
type MakePlain = (device: GPUDevice, s: string, settings: Record<string, string>) => TemporalDenoiser<object>;
const svgfPinned = (h: Helpers): MakePlain => (device, s, settings) => {
  const opts = h.svgfOptions(settings, h.svgfPinned); // pinned (denoisers.ts SVGF_PINNED): package defaults are 'auto', youngNormalPower 16, normalTest 'soft', f16Rounding 'nearest'
  return s === 'sh-diffuse' ? new DiffuseDenoiser(device, opts) : new SpecularDenoiser(device, opts);
};

/** One TemporalDenoiser per sh-* signal, fed the plain sample; `smooth` swaps the filter normal to normal_geom. */
function plainSh(h: Helpers, smooth: boolean, make: MakePlain = svgfPinned(h)): DenoiserEntry['create'] {
  return (device, { width, height, signals, settings }) => {
    const dens = new Map(signals.map((s) => {
      const d = make(device, s, settings);
      d.configure({ width, height });
      return [s, d] as const;
    }));
    return {
      signals,
      dispatch(frame: ReplayFrame) {
        const out: Partial<Record<SignalName, GPUTexture>> = {};
        const guides = smooth ? { ...frame.guides, normal: shGuides(frame).normal } : frame.guides;
        for (const [s, d] of dens) {
          const inp = frame.inputs[s as 'sh-diffuse' | 'sh-specular'];
          if (!inp) throw new Error(`no ${s} input (capture / scene without v1 buffers?)`);
          out[s] = d.dispatch({ radiance: inp.radiance, ...(inp.hitDistance ? { hitDistance: inp.hitDistance } : {}) }, guides, frame.camera);
        }
        return out;
      },
      resetHistory() { for (const d of dens.values()) d.resetHistory(); },
      gpuTimings() {
        const m = new Map<string, number>();
        for (const [s, d] of dens) for (const [k, v] of d.gpuTimings ?? []) m.set(dens.size > 1 ? `${s}/${k}` : k, v);
        return m;
      },
      dispose() { for (const d of dens.values()) d.dispose(); },
    };
  };
}

/** A scalar shadow denoiser run on v·lum(T), expanded to rgb. */
function lumT(h: Helpers, make: (device: GPUDevice, st: Record<string, string>) => TemporalDenoiser<object>, withLight: boolean): DenoiserEntry['create'] {
  return (device, ctx) => {
    const den = make(device, ctx.settings);
    den.configure({ width: ctx.width, height: ctx.height });
    const expand = new ScalarToRgb(device);
    const r: ReplayDenoiser = {
      signals: ['shadow-rgb'],
      dispatch(frame: ReplayFrame) {
        const inp = frame.inputs['shadow-rgb'];
        if (!inp) throw new Error('no shadow-rgb input (capture / scene without v1 buffers?)');
        const light = withLight ? h.shadowLightOf(frame.meta?.lights as CaptureLight[] | undefined) ?? h.shadowLightOf(frame.manifest.lights) : undefined;
        const v = den.dispatch({ visibility: inp.visibilityLumT, ...(inp.hitDistance ? { hitDistance: inp.hitDistance } : {}), ...(light ? { light } : {}) }, frame.guides, frame.camera);
        return { 'shadow-rgb': expand.run(v) };
      },
      resetHistory() { den.resetHistory(); },
      gpuTimings() { return new Map(den.gpuTimings ?? []); },
      dispose() { den.dispose(); expand.dispose(); },
    };
    return r;
  };
}

export function registerV1Denoisers(h: Helpers): void {
  // the generic baselines accept the v1 signals too (inputs.radiance = the plain sample, or v·T)
  for (const id of ['passthrough', 'accumulate', 'accumulate-static', 'accumulate-32', 'accumulate-8']) {
    const e = h.get(id);
    if (e) h.register({ ...e, signals: [...new Set([...e.signals, ...V1_SIGNAL_NAMES])] });
  }
  h.register({
    id: 'svgf-plain', description: 'M7 contender: plain SVGF on the plain sample, filter normal = shading (detail) normal', signals: ['sh-diffuse', 'sh-specular'],
    create: plainSh(h, false),
  });
  h.register({
    id: 'svgf-plain-smooth', description: 'M7 contender: plain SVGF on the plain sample, filter normal = normal_geom', signals: ['sh-diffuse', 'sh-specular'],
    create: plainSh(h, true),
  });
  // review target 5 (results/T5-normal-detail.md): the shipped plain default and the recurrent filter on the same samples
  h.register({
    id: 'svgf-plain-default', description: 'T5: plain SVGF with the package defaults (A-SVGF, youngNormalPower 16), filter normal = shading normal', signals: ['sh-diffuse', 'sh-specular'],
    create: plainSh(h, false, (device, s, st) => {
      const opts = h.svgfOptions(st);
      return s === 'sh-diffuse' ? new DiffuseDenoiser(device, opts) : new SpecularDenoiser(device, opts);
    }),
  });
  const rec: MakePlain = (device, s, st) => (s === 'sh-diffuse'
    ? new DiffuseDenoiser(device, h.recurrentOptions(st, 'diffuse')) : new SpecularDenoiser(device, h.recurrentOptions(st, 'specular')));
  h.register({
    id: 'recurrent-plain', description: 'T5: recurrent filter (package defaults) on the plain sample, filter normal = shading normal', signals: ['sh-diffuse', 'sh-specular'],
    create: plainSh(h, false, rec),
  });
  h.register({
    id: 'recurrent-plain-smooth', description: 'T5: recurrent filter on the plain sample, filter normal = normal_geom', signals: ['sh-diffuse', 'sh-specular'],
    create: plainSh(h, true, rec),
  });
  h.register({
    id: 'shadows-lumt', description: 'M8 baseline: ShadowDenoiser on v·lum(T) as a scalar, output grey (s, s, s)', signals: ['shadow-rgb'],
    create: lumT(h, (d, st) => new ShadowDenoiser(d, h.shadowOptions(st)), true),
  });
  h.register({
    id: 'ffx-shadows-lumt', description: 'M8 baseline: FfxShadowDenoiser on v·lum(T), output grey', signals: ['shadow-rgb'],
    create: lumT(h, (d) => new FfxShadowDenoiser(d, {}), false),
  });
}
