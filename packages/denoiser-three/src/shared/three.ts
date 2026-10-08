// Shared three.js (WebGPURenderer) plumbing for the denoiser nodes: raw GPU
// handles behind three objects, and per-frame camera history for the temporal
// denoisers. Mirrors @pmndrs/upscaler's helpers so both libraries share one
// GPUDevice and the same conventions.
import type { Camera, Matrix4, Texture, WebGPURenderer } from 'three/webgpu';
import type { FrameCamera } from '@pmndrs/denoiser-core';

interface WebGPUBackendLike {
  device?: GPUDevice;
  get(object: object): { texture?: GPUTexture } | undefined;
}

const backendOf = (renderer: WebGPURenderer) =>
  (renderer as unknown as { backend: WebGPUBackendLike }).backend;

/** The GPUDevice owned by an initialized WebGPURenderer (`await renderer.init()` first). */
export function getDevice(renderer: WebGPURenderer): GPUDevice {
  const device = backendOf(renderer)?.device;
  if (!device) throw new Error('denoiser/three: renderer is not initialized or not backed by WebGPU');
  return device;
}

/**
 * The raw GPUTexture behind a three texture. It must exist on the GPU already
 * (rendered to, or passed through `renderer.initTexture()`).
 */
export function getGPUTexture(renderer: WebGPURenderer, texture: Texture): GPUTexture {
  const gpu = backendOf(renderer).get(texture)?.texture;
  if (!gpu) throw new Error(`denoiser/three: texture "${texture.name || texture.uuid}" has no GPU allocation yet — render to it or call renderer.initTexture() first`);
  return gpu;
}

/**
 * Builds the `FrameCamera` a TemporalDenoiser needs from a three camera, keeping
 * the previous frame's matrices. Call `update()` once per frame, after the
 * camera has moved and before dispatch. `reset()` on camera cuts (the denoiser's
 * `resetHistory()` handles history; this just stops reprojecting from the old pose).
 */
export class CameraHistory {
  private prevView = new Float32Array(16);
  private prevProjection = new Float32Array(16);
  private hasPrev = false;

  update(
    camera: Camera,
    opts: { unjitteredProjection?: Matrix4; jitter?: readonly [number, number] } = {},
  ): FrameCamera {
    camera.updateMatrixWorld();
    const view = Float32Array.from(camera.matrixWorldInverse.elements);
    const projection = Float32Array.from((opts.unjitteredProjection ?? camera.projectionMatrix).elements);
    const near = (camera as Camera & { near?: number }).near ?? 0.1;
    const far = (camera as Camera & { far?: number }).far ?? 1000;
    const p = camera.matrixWorld.elements;
    const frame: FrameCamera = {
      view, projection,
      prevView: this.hasPrev ? this.prevView.slice() : view,
      prevProjection: this.hasPrev ? this.prevProjection.slice() : projection,
      jitter: opts.jitter ?? [0, 0],
      near, far,
      position: [p[12], p[13], p[14]],
      reversedDepth: (camera as Camera & { reversedDepth?: boolean }).reversedDepth ?? false,
    };
    this.prevView.set(view);
    this.prevProjection.set(projection);
    this.hasPrev = true;
    return frame;
  }

  reset() {
    this.hasPrev = false;
  }
}
