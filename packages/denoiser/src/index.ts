// `denoiser` — the batteries-included preset: @pmndrs/denoiser-core with the
// onnxruntime-web runtime (@pmndrs/denoiser-ort) as the default. Same 2.x API.
// The published package bundles both (see rollup.config.mjs); onnxruntime-web
// stays a regular dependency.
import {
  Denoiser as CoreDenoiser,
  type DenoiserCreateOptions as CoreDenoiserCreateOptions,
  type NetworkRuntime,
} from '@pmndrs/denoiser-core';
import { OrtRuntime } from '@pmndrs/denoiser-ort';

export * from '@pmndrs/denoiser-core';
export * from '@pmndrs/denoiser-ort';

export interface DenoiserCreateOptions extends CoreDenoiserCreateOptions {
  /** Where the .onnx models are served (default: jsDelivr CDN). Ignored when `runtime` is passed. */
  weightsUrl?: string;
  /** Where ORT loads its wasm assets (default: jsDelivr CDN). Ignored when `runtime` is passed. */
  wasmPaths?: string;
  /** Opt-in ORT WebGPU graph capture (unstable in onnxruntime-web 1.27 past ~150 replays). */
  graphCapture?: boolean;
  /**
   * Aux split-graph workaround for the onnxruntime-web WebGPU Conv bug that
   * speckles the 9-channel cleanAux models (the first conv reducing the raw >3ch
   * input miscomputes — see tools/ort-webgpu-aux-repro). When on, cleanAux models
   * fetch a re-exported tail (`<name>.tail.onnx`) + enc_conv0 weights
   * (`<name>.enc0.bin`) alongside the model and run enc_conv0 in WGSL. Verified
   * to restore native quality. No effect on 3/6-channel models. **Default on** —
   * falls back to the plain (speckled) model with a warning if the artifacts
   * aren't hosted next to the weights. Set false to force the plain model.
   */
  splitAux?: boolean;
}

/**
 * Browser OIDN denoiser running fully on WebGPU. Defaults to onnxruntime-web;
 * pass `runtime` to run the network on something else.
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
    return new OrtRuntime({
      weightsUrl: opts.weightsUrl,
      wasmPaths: opts.wasmPaths,
      graphCapture: opts.graphCapture,
      // default ON so 9ch cleanAux "just works"; falls back if artifacts aren't hosted
      splitAux: opts.splitAux ?? true,
    });
  }
}
