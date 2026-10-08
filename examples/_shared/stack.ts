// Shared three.js + denoiser bootstrap for the three-based examples: one
// GPUDevice for both, with a `?runtime=auto|ort|wgsl|webnn|kernels` selector
// (default `auto`, the package default: WebNN fp16 for base/large models when
// available, WGSL otherwise).
//
// Which side creates the device depends on the runtime:
//   ort                  denoiser FIRST (ORT always creates its own device), then
//                        new WebGPURenderer({ device: denoiser.device })
//   auto | wgsl | webnn | kernels   renderer FIRST, then the runtime is handed
//                        getDevice(renderer) via createDenoiserForRenderer()
import * as THREE from 'three/webgpu';
import type { Denoiser } from 'denoiser';
import { OrtRuntime } from 'denoiser/ort';
import { createDenoiserForRenderer, getGPUTexture, getDevice } from 'denoiser/three';
import { runtimePicker, type RuntimeOption } from './chrome';

export type RuntimeName = 'auto' | 'ort' | 'wgsl' | 'webnn' | 'kernels';
const RUNTIMES: RuntimeName[] = ['auto', 'ort', 'wgsl', 'webnn', 'kernels'];

/** `?runtime=` from the page URL (default 'auto'). */
export function runtimeFromUrl(): RuntimeName {
  const r = new URLSearchParams(location.search).get('runtime') as RuntimeName | null;
  return r && RUNTIMES.includes(r) ? r : 'auto';
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
  /** Called with the renderer after construction and before `init()` (e.g. to attach an Inspector). */
  beforeInit?: (renderer: THREE.WebGPURenderer) => void | Promise<void>;
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
    case 'auto': { const { AutoRuntime } = await import('denoiser/auto'); return new AutoRuntime({ device, tzaUrl }); }
    case 'wgsl': { const { WgslRuntime } = await import('denoiser/wgsl'); return new WgslRuntime({ device, tzaUrl }); }
    case 'webnn': { const { WebnnRuntime } = await import('denoiser/webnn'); return new WebnnRuntime({ device, tzaUrl }); }
    case 'kernels': { const { KernelsRuntime } = await import('denoiser/kernels'); return new KernelsRuntime({ device, tzaUrl }); }
  }
}

/** The picker's entries (gallery-style labels), in display order. */
export function runtimeOptions(): (RuntimeOption & { id: RuntimeName })[] {
  const hasWebnn = typeof navigator !== 'undefined' && 'ml' in navigator;
  return [
    { id: 'auto', label: 'Auto', hint: 'package default: WebNN fp16 for base/large models when available, WGSL otherwise' },
    { id: 'wgsl', label: 'WGSL', hint: 'hand-written fused WGSL, one command encoder per run' },
    { id: 'ort', label: 'ONNX Runtime', hint: 'onnxruntime-web, WebGPU EP (creates the GPUDevice; three borrows it)' },
    {
      id: 'webnn', label: 'WebNN', hint: 'WebNN graph (GPU)',
      unavailable: hasWebnn ? undefined
        : 'WebNN is not exposed in this browser (Chrome: enable chrome://flags/#web-machine-learning-neural-network)',
    },
    { id: 'kernels', label: 'HF kernels', hint: 'experimental: @huggingface/kernels, op by op' },
  ];
}

/**
 * Mount the `?runtime=` picker (reloads the page on switch — see chrome.ts
 * runtimePicker). Mount it BEFORE createStack() so a runtime that fails to
 * initialize can still be switched away from; then `attach(denoiser)` and call
 * `denoised(ms)` after each denoise. The readout shows the active runtime
 * (auto shows what it resolved to) and the last denoise time.
 */
export function mountRuntimePicker(mount?: HTMLElement | null, runtimeName: RuntimeName = runtimeFromUrl()) {
  const picker = runtimePicker({
    mount: mount ?? undefined, options: runtimeOptions(), active: runtimeName, defaultId: 'auto',
  });
  let denoiser: Denoiser | undefined;
  let lastMs: number | undefined;
  let failed: string | undefined;
  const label = () => (denoiser ? describeRuntime(denoiser) : runtimeName);
  const render = () => picker.setReadout(failed ? `${runtimeName}: ${failed}`
    : !denoiser ? `${runtimeName}: initializing…`
      : `active: ${label()}` + (lastMs === undefined ? ' · no denoise yet' : ` · last denoise ${lastMs.toFixed(1)} ms`));
  render();
  return {
    /** Human label of the active runtime, e.g. `auto → wgsl`. */
    label,
    attach(d: Denoiser) { denoiser = d; render(); },
    denoised(ms: number) { lastMs = ms; render(); },
    failed(message: string) { failed = message; render(); },
  };
}

/** `ort`, `wgsl`, ... or `auto → <resolved>` once AutoRuntime has loaded a model. */
export function describeRuntime(denoiser: Denoiser): string {
  const rt = denoiser.runtime as { name: string; lastChoice?: string };
  return rt.lastChoice ? `${rt.name} → ${rt.lastChoice}` : rt.name;
}

/** Create the shared renderer + denoiser for the selected runtime (see the file header). */
export async function createStack(opts: StackOptions = {}): Promise<Stack> {
  patchWebGPUForMaxLimits();
  const runtimeName = opts.runtime ?? runtimeFromUrl();
  const { precision, quality } = opts;
  let renderer: THREE.WebGPURenderer;
  let denoiser: Denoiser;
  if (runtimeName === 'ort') {
    const { Denoiser } = await import('denoiser');
    denoiser = await Denoiser.create({
      runtime: new OrtRuntime({ weightsUrl: opts.weightsUrl, splitAux: opts.splitAux ?? true }),
      precision, quality,
    });
    renderer = new THREE.WebGPURenderer({ ...opts.renderer, device: denoiser.device });
    await opts.beforeInit?.(renderer);
    await renderer.init();
  } else {
    renderer = new THREE.WebGPURenderer(opts.renderer);
    await opts.beforeInit?.(renderer);
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
