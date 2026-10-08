// The seam between the engine (tiling, transfer functions, WGSL pre/post — all
// runtime-agnostic) and whatever executes the network (ORT, HF kernels, WebNN,
// hand-written WGSL...).
//
// Per batch the engine writes `binding.input` (NCHW [B, C, H, W] in the model's
// precision) with its own WGSL, awaits `binding.run()`, then reads
// `binding.output` (NCHW [B, 3, H, W]). Both buffers live on `session.device`,
// which is also the device the engine runs its pre/post on — so a runtime must
// either create that device or run on one it is handed.

export type Precision = 'fp32' | 'fp16';

/** Which network to load. Name resolution (file names, URLs) is the runtime's job. */
export interface NetworkModel {
  /** OIDN model name, e.g. `rt_hdr_calb_cnrm_small`. */
  name: string;
  /** Input channels: 3 (color), 6 (+albedo) or 9 (+albedo +normal). */
  channels: number;
  precision: Precision;
}

/** One run's shape: `batch` tiles of `tileW` x `tileH` (multiples of 16). */
export interface NetworkGeometry {
  batch: number;
  tileW: number;
  tileH: number;
}

export interface NetworkRuntime {
  /** Short id for logs/stats, e.g. `ort-webgpu`. */
  readonly name: string;
  /**
   * Load a network. The first load may create the GPUDevice. `hints.geometry` is
   * the geometry the engine binds first — a runtime may prepare it eagerly.
   */
  load(model: NetworkModel, hints?: { geometry?: NetworkGeometry }): Promise<NetworkSession>;
}

export interface NetworkSession {
  readonly device: GPUDevice;
  /** Set when the network only runs one geometry (legacy static-dim models). */
  readonly fixedGeometry?: NetworkGeometry;
  /** IO buffers + a run function for a geometry. The engine caches bindings. */
  bind(geometry: NetworkGeometry): Promise<NetworkBinding>;
  /** Release the network and all its bindings. */
  release(): void;
}

export interface NetworkBinding {
  readonly geometry: NetworkGeometry;
  /** NCHW [B, channels, H, W], model precision. The engine writes it before run(). */
  readonly input: GPUBuffer;
  /** NCHW [B, 3, H, W], model precision. Valid after run() resolves. */
  readonly output: GPUBuffer;
  run(): Promise<void>;
  release(): void;
}
