// Denoisers of the golden registry (GOLDEN.md "Denoisers"): `denoiser=<id>` picks one of these for the whole run. Ours
// takes the review bench's option registry as overrides (src/review/options.ts, resolved by src/review/config.ts);
// more denoisers (OIDN 3, ...) register with registerGoldenDenoiser().
import type * as THREE from 'three/webgpu';
import { ffxReflections, ffxShadows, realtimeDiffuseSpecular, realtimeOcclusion, realtimeShadows } from 'denoiser/three';
import type { ShadowLight } from 'denoiser/realtime';
import { nodeOptions, type SideConfig } from '../review/config';
import type { N } from './types';
import type { Signal } from './registry';

export interface DenoiserCtx {
  guides: N;
  roughness: N;
  /** Input nodes the denoisers read: the 1-spp (run) or converged (perfect) signals. */
  inputs: { dif: N; difHit: N; ssr: N; sh: N; shDist: N };
  light: () => ShadowLight;
  options: SideConfig;
  want: Set<Signal>;
}

export interface BuiltDenoiser {
  /** Every node of this denoiser (history reset, GPU timings, kept in the graph). */
  nodes: N[];
  /** One name per node: the prefix of its passes in the timings (`<name>.<pass>`). */
  names: string[];
  /** TSL value of each denoised signal for the composite (diffuse / specular rgb, shadow / ao as a vec4 with the value in .r). */
  out: Partial<Record<Signal, N>>;
  /** Output texture of each signal (valid after a render). */
  tex: Partial<Record<Signal, () => THREE.Texture>>;
}

export interface GoldenDenoiser {
  id: string;
  label: string;
  applies: Record<Signal, 'denoised' | 'raw'>;
  build(c: DenoiserCtx): BuiltDenoiser;
}

const REG = new Map<string, GoldenDenoiser>();
export const registerGoldenDenoiser = (d: GoldenDenoiser) => { REG.set(d.id, d); };
export const goldenDenoiser = (id: string) => REG.get(id);
export const listGoldenDenoisers = () => [...REG.values()].map((d) => ({ id: d.id, label: d.label, applies: d.applies }));

registerGoldenDenoiser({
  id: 'raw',
  label: 'No denoiser: the input as is',
  applies: { diffuse: 'raw', specular: 'raw', shadow: 'raw', ao: 'raw' },
  build: () => ({ nodes: [], names: [], out: {}, tex: {} }),
});

registerGoldenDenoiser({
  id: 'ours',
  label: 'denoiser/realtime: realtimeDiffuseSpecular + realtimeShadows + realtimeOcclusion (package defaults; review-bench options as overrides)',
  applies: { diffuse: 'denoised', specular: 'denoised', shadow: 'denoised', ao: 'denoised' },
  build(c) {
    const no = nodeOptions(c.options);
    const nodes: N[] = [];
    const names: string[] = [];
    const out: BuiltDenoiser['out'] = {};
    const tex: BuiltDenoiser['tex'] = {};
    if (c.want.has('diffuse') || c.want.has('specular')) {
      const gi = realtimeDiffuseSpecular(
        { diffuse: { radiance: c.inputs.dif, hitDistance: c.inputs.difHit }, specular: { radiance: c.inputs.ssr } },
        { ...c.guides, roughness: c.roughness, denoiser: no.gi as N },
      ) as N;
      nodes.push(gi); names.push('diffuse+specular');
      out.diffuse = gi.diffuse; out.specular = gi.specular;
      tex.diffuse = () => gi.getOutputTexture(0); tex.specular = () => gi.getOutputTexture(1);
    }
    if (c.want.has('ao')) {
      const ao = realtimeOcclusion(c.inputs.difHit, { ...c.guides, denoiser: no.ao as N }) as N;
      nodes.push(ao); names.push('ao'); out.ao = ao; tex.ao = () => ao.getOutputTexture(0);
    }
    if (c.want.has('shadow')) {
      const sh = realtimeShadows(c.inputs.sh, { ...c.guides, hitDistance: c.inputs.shDist, light: c.light, denoiser: no.shadows as N }) as N;
      nodes.push(sh); names.push('shadow'); out.shadow = sh; tex.shadow = () => sh.getOutputTexture(0);
    }
    return { nodes, names, out, tex };
  },
});

registerGoldenDenoiser({
  id: 'ffx',
  label: 'FidelityFX (denoiser/ffx): ffxReflections for specular, ffxShadows for shadows; diffuse and AO stay raw',
  applies: { diffuse: 'raw', specular: 'denoised', shadow: 'denoised', ao: 'raw' },
  build(c) {
    const nodes: N[] = [];
    const names: string[] = [];
    const out: BuiltDenoiser['out'] = {};
    const tex: BuiltDenoiser['tex'] = {};
    if (c.want.has('specular')) {
      const r = ffxReflections(c.inputs.ssr, { ...c.guides, roughness: c.roughness }) as N;
      nodes.push(r); names.push('specular'); out.specular = r; tex.specular = () => r.getOutputTexture(0);
    }
    if (c.want.has('shadow')) {
      const s = ffxShadows(c.inputs.sh, c.guides) as N;
      nodes.push(s); names.push('shadow'); out.shadow = s; tex.shadow = () => s.getOutputTexture(0);
    }
    return { nodes, names, out, tex };
  },
});
