// Shared three.js + denoiser bootstrap for the three-based examples: one
// GPUDevice for both, with a `?runtime=ort|wgsl|webnn|kernels` selector.
//
// Which side creates the device depends on the runtime:
//   ort                  denoiser FIRST (ORT always creates its own device), then
//                        new WebGPURenderer({ device: denoiser.device })
//   wgsl | webnn | kernels   renderer FIRST, then the runtime is handed
//                        getDevice(renderer) via createDenoiserForRenderer()
import * as THREE from 'three/webgpu';
import { Denoiser } from 'denoiser';
import { createDenoiserForRenderer, getGPUTexture, getDevice } from 'denoiser/three';

export type RuntimeName = 'ort' | 'wgsl' | 'webnn' | 'kernels';
const RUNTIMES: RuntimeName[] = ['ort', 'wgsl', 'webnn', 'kernels'];

/** `?runtime=` from the page URL (default 'ort'). */
export function runtimeFromUrl(): RuntimeName {
  const r = new URLSearchParams(location.search).get('runtime') as RuntimeName | null;
  return r && RUNTIMES.includes(r) ? r : 'ort';
}

/**
 * Request the adapter's MAX limits + all features on every requestDevice(), BEFORE
 * any device is created. ORT (or three) would otherwise ask for a minimal device and
 * heavier pipelines (the path tracer's compute, SSR) fail validation on it.
 * (onnxruntime issue #26107 workaround — make the one shared device capable enough.)
 */
export function patchWebGPUForMaxLimits() {
  const gpu = navigator.gpu as GPU;
  const origRequestAdapter = gpu.requestAdapter.bind(gpu);
  gpu.requestAdapter = async (opts?: GPURequestAdapterOptions) => {
    const adapter = await origRequestAdapter(opts);
    if (!adapter) return adapter;
    const origRequestDevice = adapter.requestDevice.bind(adapter);
    adapter.requestDevice = (desc: GPUDeviceDescriptor = {}) => {
      const requiredLimits: Record<string, number> = {};
      const proto = Object.getPrototypeOf(adapter.limits);
      for (const name of Object.getOwnPropertyNames(proto)) {
        const v = (adapter.limits as unknown as Record<string, unknown>)[name];
        if (typeof v === 'number') requiredLimits[name] = v;
      }
      return origRequestDevice({
        ...desc,
        requiredFeatures: [...adapter.features] as GPUFeatureName[],
        requiredLimits: { ...requiredLimits, ...(desc.requiredLimits ?? {}) },
      });
    };
    return adapter;
  };
}

export interface StackOptions {
  /** Defaults to `runtimeFromUrl()`. */
  runtime?: RuntimeName;
  precision?: 'fp32' | 'fp16';
  quality?: 'fast' | 'balanced' | 'high';
  /** WebGPURenderer params (a `device` is filled in for you). */
  renderer?: Omit<THREE.WebGPURendererParameters, 'device'>;
  /** ORT only: where the .onnx models are served (undefined = the default CDN). */
  weightsUrl?: string;
  /** ORT only: the aux split-graph workaround (default on). */
  splitAux?: boolean;
  /** tza/WGSL-family runtimes: where the .tza weights are served (undefined = the default CDN). */
  tzaUrl?: string;
}

export interface Stack {
  runtimeName: RuntimeName;
  renderer: THREE.WebGPURenderer;
  denoiser: Denoiser;
  device: GPUDevice;
}

async function makeRuntime(name: Exclude<RuntimeName, 'ort'>, device: GPUDevice, tzaUrl?: string) {
  // Lazy: only the selected runtime's code (and @huggingface/kernels) gets loaded.
  switch (name) {
    case 'wgsl': { const { WgslRuntime } = await import('denoiser/wgsl'); return new WgslRuntime({ device, tzaUrl }); }
    case 'webnn': { const { WebnnRuntime } = await import('denoiser/webnn'); return new WebnnRuntime({ device, tzaUrl }); }
    case 'kernels': { const { KernelsRuntime } = await import('denoiser/kernels'); return new KernelsRuntime({ device, tzaUrl }); }
  }
}

/** Create the shared renderer + denoiser for the selected runtime (see the file header). */
export async function createStack(opts: StackOptions = {}): Promise<Stack> {
  patchWebGPUForMaxLimits();
  const runtimeName = opts.runtime ?? runtimeFromUrl();
  const { precision, quality } = opts;
  let renderer: THREE.WebGPURenderer;
  let denoiser: Denoiser;
  if (runtimeName === 'ort') {
    denoiser = await Denoiser.create({ precision, quality, weightsUrl: opts.weightsUrl, splitAux: opts.splitAux });
    renderer = new THREE.WebGPURenderer({ ...opts.renderer, device: denoiser.device });
    await renderer.init();
  } else {
    renderer = new THREE.WebGPURenderer(opts.renderer);
    await renderer.init();
    // dev: the repo's own .tza files (vite-tzas plugin); prod: the runtimes' CDN default
    const tzaUrl = opts.tzaUrl ?? (import.meta.env.DEV ? '/tzas' : undefined);
    const runtime = await makeRuntime(runtimeName, getDevice(renderer), tzaUrl);
    denoiser = await createDenoiserForRenderer(renderer, { runtime, precision, quality });
  }
  return { runtimeName, renderer, denoiser, device: getDevice(renderer) };
}

/** The raw GPUTexture behind a three texture, or undefined if it has no GPU allocation yet. */
export function gpuTex(renderer: THREE.WebGPURenderer, tex: THREE.Texture): GPUTexture | undefined {
  try { return getGPUTexture(renderer, tex); } catch { return undefined; }
}
