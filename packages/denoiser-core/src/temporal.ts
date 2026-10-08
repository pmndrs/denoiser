// Temporal (real-time) denoising API — the per-frame counterpart of the
// single-image Denoiser. One interface for every source: signal-specific
// filters (shadows, reflections, GI, AO — e.g. the FidelityFX denoisers),
// neural temporal models (OIDN 3), and whatever comes next.
//
// Conventions follow @pmndrs/upscaler (FSR3) so denoise -> upscale composes:
// configure() / per-frame dispatch() / resetHistory() / dispose(), motion
// vectors as NDC deltas (current - previous, three's `velocity` node), optional
// sub-pixel jitter. Unlike the upscaler this layer is engine-agnostic (raw
// WebGPU); three.js nodes live on top.
//
// Frame contract: call dispatch() AFTER the frame's inputs are submitted. It
// records and submits its own GPU work on `device.queue` synchronously (no
// awaits, no readback), so anything the caller submits afterwards sees the
// result. The returned texture is owned by the denoiser and valid until the
// next dispatch / configure / dispose.
// See docs/specs/temporal.md.

/** Column-major 4x4 matrices, as three.js `Matrix4.elements` / gl-matrix. */
export type Mat4 = Float32Array | ArrayLike<number>;

/** Camera state for the current and previous frame (for reprojection). */
export interface FrameCamera {
  view: Mat4;
  /** Projection WITHOUT jitter (the upscaler's `unjitteredProjectionMatrix`). */
  projection: Mat4;
  prevView: Mat4;
  prevProjection: Mat4;
  /** Sub-pixel jitter applied to this frame's render, in pixels (default [0, 0]). */
  jitter?: readonly [number, number];
  near: number;
  far: number;
  /** World-space camera position (needed by some filters, e.g. reflections). */
  position?: readonly [number, number, number];
  /** Depth buffer uses reversed-Z (1 = near). Default false. */
  reversedDepth?: boolean;
}

/** G-buffer guides shared by every temporal denoiser. Same size as the signal. */
export interface FrameGuides {
  /** Hardware depth (depth32float / depth24plus) or r32float device depth. */
  depth: GPUTexture;
  /** World-space unit normals in [-1, 1] (rgba16float or rgba8snorm). */
  normal: GPUTexture;
  /** Screen-space motion, NDC delta current - previous (rg16float). */
  motion: GPUTexture;
  /** Perceptual roughness [0, 1] (r8unorm / r16float) — specular signals. */
  roughness?: GPUTexture;
  /** Surface albedo [0, 1] — lets filters demodulate texture detail. */
  albedo?: GPUTexture;
}

export interface TemporalConfig {
  width: number;
  height: number;
}

/**
 * A real-time denoiser for one signal. `Inputs` is the signal-specific part,
 * e.g. `{ visibility }` for shadows or `{ radiance, hitDistance }` for
 * reflections; the guides and camera are common.
 */
export interface TemporalDenoiser<Inputs extends object = object> {
  /** Short id for logs, e.g. `ffx-shadows`. */
  readonly name: string;
  readonly device: GPUDevice;
  /** (Re)allocate for a size. Drops history. Call before the first dispatch. */
  configure(config: TemporalConfig): void;
  /** Denoise one frame (see the frame contract above). Returns the output texture. */
  dispatch(inputs: Inputs, guides: FrameGuides, camera: FrameCamera): GPUTexture;
  /** Drop all history on the next dispatch (camera cut, teleport, scene switch). */
  resetHistory(): void;
  /** Per-pass GPU times (ms) when timestamp queries are available. */
  readonly gpuTimings?: ReadonlyMap<string, number>;
  /** Release GPU resources. Never destroys the device. */
  dispose(): void;
}

// ---- signal inputs ------------------------------------------------------------

/** Shadows: 1-sample stochastic visibility toward the light. */
export interface ShadowInputs {
  /** Visibility per pixel in [0, 1] (1 = lit), r8unorm / r16float — one ray or shadow-map sample. */
  visibility: GPUTexture;
  /** Distance to the occluder (r16float), for penumbra-aware filter sizes. */
  hitDistance?: GPUTexture;
}

/** Reflections / specular indirect: 1 sample per pixel. */
export interface SpecularInputs {
  /** Noisy reflected radiance (linear HDR, rgba16float). */
  radiance: GPUTexture;
  /** Ray hit distance (r16float, 0 = miss). Drives reprojection of reflections. */
  hitDistance: GPUTexture;
}

/** Diffuse indirect (GI) / ambient occlusion: 1 sample per pixel. */
export interface DiffuseInputs {
  /** Noisy irradiance (linear HDR, rgba16float) or AO in r. */
  radiance: GPUTexture;
  hitDistance?: GPUTexture;
}

/** Full beauty frame for neural temporal denoisers (OIDN 3 class). */
export interface BeautyInputs {
  color: GPUTexture;
  albedo?: GPUTexture;
  normal?: GPUTexture;
  /** Color is linear HDR (default true). */
  hdr?: boolean;
}
