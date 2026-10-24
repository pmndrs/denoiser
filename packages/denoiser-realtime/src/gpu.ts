// Small WebGPU helpers shared by the passes: compact bind-group layouts,
// pipelines, bind groups and timed compute passes.
import type { PassTimer } from './common';

/**
 * Layout entry kinds: 'u' uniform buffer, 'f' unfilterable float texture, 'F'
 * filterable float texture, 'i' uint texture, 'd' depth texture, 's' filtering
 * sampler, or a write-only storage texture format (e.g. 'rgba16float').
 */
export type EntryKind = 'u' | 'f' | 'F' | 'i' | 'd' | 's' | GPUTextureFormat;

export function makeLayout(device: GPUDevice, label: string, kinds: EntryKind[]): GPUBindGroupLayout {
  const C = GPUShaderStage.COMPUTE;
  return device.createBindGroupLayout({
    label,
    entries: kinds.map((k, binding): GPUBindGroupLayoutEntry => {
      switch (k) {
        case 'u': return { binding, visibility: C, buffer: { type: 'uniform' } };
        case 'f': return { binding, visibility: C, texture: { sampleType: 'unfilterable-float' } };
        case 'F': return { binding, visibility: C, texture: { sampleType: 'float' } };
        case 'i': return { binding, visibility: C, texture: { sampleType: 'uint' } };
        case 'd': return { binding, visibility: C, texture: { sampleType: 'depth' } };
        case 's': return { binding, visibility: C, sampler: { type: 'filtering' } };
        default: return { binding, visibility: C, storageTexture: { access: 'write-only', format: k } };
      }
    }),
  });
}

export function makePipeline(device: GPUDevice, label: string, code: string, layout: GPUBindGroupLayout): GPUComputePipeline {
  return device.createComputePipeline({
    label,
    layout: device.createPipelineLayout({ label, bindGroupLayouts: [layout] }),
    compute: { module: device.createShaderModule({ label, code }), entryPoint: 'main' },
  });
}

export type Res = GPUBuffer | GPUTexture | GPUTextureView | GPUSampler;

export function makeBindGroup(device: GPUDevice, layout: GPUBindGroupLayout, resources: Res[]): GPUBindGroup {
  return device.createBindGroup({
    layout,
    entries: resources.map((r, binding): GPUBindGroupEntry => {
      if (r instanceof GPUBuffer) return { binding, resource: { buffer: r } };
      if (r instanceof GPUTexture) return { binding, resource: r.createView() };
      return { binding, resource: r };
    }),
  });
}

/** Records one timed compute pass. */
export function runPass(
  enc: GPUCommandEncoder, timer: PassTimer | undefined, name: string,
  pipeline: GPUComputePipeline, group: GPUBindGroup, x: number, y: number,
) {
  const pass = enc.beginComputePass({ label: name, timestampWrites: timer?.pass(name) });
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, group);
  pass.dispatchWorkgroups(x, y);
  pass.end();
}

export const STORAGE_TEX = GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING;
