// `denoiser/auto` — picks the fastest correct runtime per model, from the
// quiet-GPU eval (docs/status/eval-2026-10-08-quiet.md, Apple M5 Pro):
//   - WebNN (CoreML) fp16 for base / large models when WebNN is available —
//     1.6x / 1.2x native Metal at 1080p; needs Chrome's WebNN feature flag.
//   - hand-written WGSL everywhere else — fastest for small models and at 512²,
//     no flags, ~20–90 ms model load, correct on every model.
// ORT is never auto-picked: it miscomputes the *_alb / *_alb_nrm / *_large models.
//
// Every runtime it delegates to shares ONE GPUDevice, so `denoiser.device` stays
// stable across model switches (three.js renderers can keep using it).
//
//   const denoiser = await Denoiser.create({ runtime: new AutoRuntime(), precision: 'fp16' });
import type {
  NetworkGeometry, NetworkModel, NetworkRuntime, NetworkSession,
} from '@pmndrs/denoiser-core';
import { WgslRuntime } from '@pmndrs/denoiser-wgsl';
import { WebnnRuntime } from '@pmndrs/denoiser-webnn';

export interface AutoRuntimeOptions {
  /** Base URL of the OIDN `.tza` weights (default: jsDelivr CDN, models-v3). */
  tzaUrl?: string;
  /** Run on this GPUDevice, e.g. a three.js renderer's (default: a max-limits device). */
  device?: GPUDevice;
  /**
   * Use WebNN when available: 'gpu' (default), 'npu' (Apple Neural Engine —
   * frees the GPU; Chrome also needs WebNNCoreMLExplicitGPUOrNPU), or false.
   * WebNN compiles per run geometry (0.4–2.7 s each on a cold CoreML cache), so
   * turn it off when first-call latency matters more than steady-state speed.
   */
  webnn?: 'gpu' | 'npu' | false;
}

export class AutoRuntime implements NetworkRuntime {
  readonly name = 'auto';
  /** The runtime that served the most recent load(), e.g. `webnn-gpu` or `wgsl`. */
  lastChoice?: string;

  private device?: Promise<GPUDevice>;
  private wgsl?: WgslRuntime;
  private webnn?: WebnnRuntime;
  private webnnUsable?: Promise<boolean>;

  constructor(private opts: AutoRuntimeOptions = {}) {}

  /** Which runtime `model` would run on (without loading it). */
  async choose(model: Pick<NetworkModel, 'name' | 'precision'>): Promise<'webnn' | 'wgsl'> {
    const wantsWebnn = this.opts.webnn !== false
      && model.precision === 'fp16' // WebNN fp32 is no faster than WGSL fp32
      && !model.name.endsWith('_small'); // WGSL is as fast or faster on small models
    return wantsWebnn && (await this.webnnAvailable()) ? 'webnn' : 'wgsl';
  }

  async load(model: NetworkModel, hints?: { geometry?: NetworkGeometry }): Promise<NetworkSession> {
    const device = await (this.device ??= this.opts.device ? Promise.resolve(this.opts.device) : requestMaxDevice());
    const tzaUrl = this.opts.tzaUrl;
    let runtime: NetworkRuntime;
    if ((await this.choose(model)) === 'webnn') {
      runtime = this.webnn ??= new WebnnRuntime({ tzaUrl, device, deviceType: this.opts.webnn || 'gpu' });
    } else {
      runtime = this.wgsl ??= new WgslRuntime({ tzaUrl, device });
    }
    this.lastChoice = runtime.name;
    return runtime.load(model, hints);
  }

  /** WebNN is exposed AND can create a context of the wanted type (flags can expose it half-way). */
  private webnnAvailable(): Promise<boolean> {
    this.webnnUsable ??= (async () => {
      if (!WebnnRuntime.isAvailable()) return false;
      try {
        const ml = (navigator as unknown as { ml: { createContext(o: object): Promise<{ destroy(): void }> } }).ml;
        const ctx = await ml.createContext({ deviceType: this.opts.webnn || 'gpu' });
        ctx.destroy();
        return true;
      } catch {
        return false;
      }
    })();
    return this.webnnUsable;
  }
}

async function requestMaxDevice(): Promise<GPUDevice> {
  const adapter = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('AutoRuntime: WebGPU adapter unavailable');
  const requiredLimits: Record<string, number> = {};
  const proto = Object.getPrototypeOf(adapter.limits);
  for (const name of Object.getOwnPropertyNames(proto)) {
    const v = (adapter.limits as unknown as Record<string, unknown>)[name];
    if (typeof v === 'number') requiredLimits[name] = v;
  }
  return adapter.requestDevice({
    requiredFeatures: [...adapter.features] as GPUFeatureName[],
    requiredLimits,
    label: 'denoiser-auto',
  });
}
