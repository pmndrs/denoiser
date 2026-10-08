// `denoiser` — the batteries-included entry: @pmndrs/denoiser-core with
// AutoRuntime as the default network runtime (WebNN fp16 for base/large models
// when available, hand-written WGSL otherwise — see ./auto.ts). The ORT runtime
// lives in `denoiser/ort` (pass `runtime: new OrtRuntime(...)`), so this entry
// never loads onnxruntime-web.
import {
  Denoiser as CoreDenoiser,
  type DenoiserCreateOptions as CoreDenoiserCreateOptions,
  type NetworkRuntime,
} from '@pmndrs/denoiser-core';
import { AutoRuntime } from './auto';

export * from '@pmndrs/denoiser-core';
export { AutoRuntime } from './auto';
export type { AutoRuntimeOptions } from './auto';

export interface DenoiserCreateOptions extends CoreDenoiserCreateOptions {
  /** Base URL of the OIDN `.tza` weights for the default runtime (default: jsDelivr CDN). Ignored when `runtime` is passed. */
  tzaUrl?: string;
  /**
   * Run the default runtime on this GPUDevice — e.g. a three.js renderer's
   * (`renderer.backend.device`), so both share one device. Ignored when `runtime` is passed.
   */
  device?: GPUDevice;
}

/**
 * Browser OIDN denoiser running fully on WebGPU. Defaults to `AutoRuntime`;
 * pass `runtime` to choose (`denoiser/ort`, `/wgsl`, `/webnn`, `/kernels`).
 *
 * ```ts
 * const denoiser = await Denoiser.create({ precision: 'fp16' });
 * const img = await denoiser.denoise(noisyImage);                    // ImageData
 * const tex = await denoiser.denoiseTextures({ color, hdr: true });  // GPUTexture
 * ```
 */
export class Denoiser extends CoreDenoiser {
  static create(opts: DenoiserCreateOptions = {}): Promise<Denoiser> {
    return super.create(opts) as Promise<Denoiser>;
  }

  protected static defaultRuntime(opts: DenoiserCreateOptions): NetworkRuntime {
    return new AutoRuntime({ tzaUrl: opts.tzaUrl, device: opts.device });
  }
}
