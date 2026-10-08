// Non-node helper: a Denoiser on the renderer's GPUDevice (the three-first flow).
import { Denoiser } from '@pmndrs/denoiser-core';
import type { DenoiserCreateOptions, NetworkRuntime } from '@pmndrs/denoiser-core';
import type { WebGPURenderer } from 'three/webgpu';
import { getDevice } from '../shared/three';

export interface CreateDenoiserForRendererOptions extends Omit<DenoiserCreateOptions, 'runtime'> {
  /**
   * What executes the network, built on the renderer's device. Pass a runtime
   * instance you constructed with `{ device }` or a factory that receives the device:
   *
   * ```ts
   * runtime: (device) => new WgslRuntime({ device })
   * ```
   *
   * Runtimes that can ADOPT an external device: `WgslRuntime`, `WebnnRuntime`,
   * `KernelsRuntime` (via a device shim; the first one on the page wins). ORT
   * cannot: it always creates its own device, so with ORT use the denoiser-first
   * flow instead (`Denoiser.create()` then `new WebGPURenderer({ device: denoiser.device })`).
   */
  runtime: NetworkRuntime | ((device: GPUDevice) => NetworkRuntime);
}

/**
 * Create a `Denoiser` that shares the renderer's GPUDevice (so textures rendered by
 * three can be denoised with no copies). The renderer must be initialized
 * (`await renderer.init()`).
 *
 * Throws if the runtime ended up on a different device (e.g. ORT), because
 * every texture handed to such a denoiser would be rejected by WebGPU later.
 */
export async function createDenoiserForRenderer(
  renderer: WebGPURenderer,
  options: CreateDenoiserForRendererOptions,
): Promise<Denoiser> {
  const device = getDevice(renderer);
  const { runtime, ...rest } = options;
  const denoiser = await Denoiser.create({
    ...rest,
    runtime: typeof runtime === 'function' ? runtime(device) : runtime,
  });
  if (denoiser.device !== device) {
    denoiser.dispose();
    throw new Error(
      `denoiser/three: runtime "${denoiser.runtime.name}" is on its own GPUDevice, not the renderer's. ` +
      'This runtime cannot adopt an external device (ORT can\'t) — create the Denoiser first and pass ' +
      '`denoiser.device` to `new WebGPURenderer({ device })`, or use a runtime that takes a `device` option.',
    );
  }
  return denoiser;
}
