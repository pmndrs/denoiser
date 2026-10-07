// DenoiseEngine: the 2.x engine API — TiledEngine on an ORT session opened
// from raw model bytes. Kept for compatibility (exported, and used directly by
// examples/aux-split-verify); the Denoiser facade goes through a NetworkRuntime.
import { TiledEngine, type TiledEngineOptions } from '@pmndrs/denoiser-core';
import { OrtSession, type SplitOptions } from './runtime';

export type {
  DenoiseOptions, TextureInputs, TextureDenoiseOptions, DenoiseStats,
} from '@pmndrs/denoiser-core';

export interface EngineOptions extends TiledEngineOptions {
  channels: number; // 3 | 6 | 9 — must match the model
  /** Model IO element type — must match the loaded .onnx (fp16 needs shader-f16). */
  precision?: 'fp32' | 'fp16';
  wasmPaths?: string;
  /** See OrtRuntimeOptions.graphCapture. */
  graphCapture?: boolean;
  /** Aux split-graph workaround; `modelBytes` is then the TAIL model. See SplitOptions. */
  split?: SplitOptions;
}

export class DenoiseEngine extends TiledEngine {
  static async create(modelBytes: Uint8Array, opts: EngineOptions): Promise<DenoiseEngine> {
    const e = new DenoiseEngine(opts.channels, opts.precision ?? 'fp32', opts);
    await e.attach((first) => OrtSession.create(modelBytes, opts, first));
    return e;
  }

  private get ort() { return this.session as OrtSession; }
  get inputName(): string { return this.ort.inputName; }
  get outputName(): string { return this.ort.outputName; }
  /** True when sessions run with WebGPU graph capture enabled. */
  get graphCaptured(): boolean { return this.ort.graphCaptured; }
}
