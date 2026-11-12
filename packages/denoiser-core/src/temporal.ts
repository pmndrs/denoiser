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
  /**
   * Optional linear view-space z of the primary hit (r32float / r16float), in
   * three.js view space: in front of the camera is NEGATIVE; sky = -far (or 0).
   * When given, filters use it instead of linearizing `depth` (exact, and the
   * only option for depth buffers that aren't the projection's own).
   */
  viewZ?: GPUTexture;
  /**
   * Optional 2.5D motion: viewZprev - viewZ per pixel in `.r` (r32float /
   * r16float), so moving objects reproject correctly in depth too. Without it,
   * the previous depth is derived from the camera transform (exact for static
   * geometry).
   */
  motionZ?: GPUTexture;
  /**
   * Optional detail (normal-mapped shading) normal, world space, same encoding as
   * `normal`. For directional payloads (`payload: 'sh'`): pass the smooth normal as
   * `normal` (the filter's weights) and the normal the rays were sampled around here;
   * the payload is resolved at it.
   */
  detailNormal?: GPUTexture;
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

/**
 * The shadow-casting light, same fields as a capture's `lights` entry
 * (CAPTURE-FORMAT v0). Lets a denoiser size penumbrae from occluder distance.
 */
export type ShadowLight =
  | {
    type: 'sphere';
    /** World-space centre. */
    position: readonly [number, number, number];
    /** World-space radius (0 = point light: hard shadows). */
    radius: number;
  }
  | {
    type: 'directional';
    /** Unit vector from the surface TOWARD the light. */
    direction: readonly [number, number, number];
    /** Angular radius in radians (the sun is about 0.0047). */
    angularRadius: number;
  };

/** Shadows: 1-sample stochastic visibility toward the light. */
export interface ShadowInputs {
  /** Visibility per pixel in [0, 1] (1 = lit), r8unorm / r16float — one ray or shadow-map sample. */
  visibility: GPUTexture;
  /**
   * Distance to the occluder (r16float / r32float), for penumbra-aware filter sizes. World
   * units; 0 = unoccluded (or self-shadowed, when visibility is 0).
   */
  hitDistance?: GPUTexture;
  /**
   * The light this visibility was traced toward (optional; may change every frame).
   * Filters that size penumbrae from `hitDistance` need it; others ignore it.
   */
  light?: ShadowLight;
  /**
   * Optional RGB transmittance of the translucent layers the shadow ray crossed (rgba16float /
   * rgba8unorm, rgb in [0, 1]; product of the layers' transmittances, 1 where it crossed none),
   * for coloured shadows. Ignored where visibility is 0. Only denoisers that support it read it
   * (e.g. denoiser/realtime's ShadowDenoiser with `translucency: true`).
   */
  translucency?: GPUTexture;
  /**
   * Optional distance to the nearest translucent layer that attenuated the ray (r16float / r32float,
   * world units; 0 = none): sizes coloured penumbrae like `hitDistance` sizes opaque ones.
   */
  translucencyHitDistance?: GPUTexture;
}

/** Reflections / specular indirect: 1 sample per pixel. */
export interface SpecularInputs {
  /** Noisy reflected radiance (linear HDR, rgba16float). */
  radiance: GPUTexture;
  /** Ray hit distance (r16float, 0 = miss). Drives reprojection of reflections. */
  hitDistance: GPUTexture;
  /** Directional payloads: world-space direction of each sample's ray (rgb), used with `radiance`. */
  direction?: GPUTexture;
  /** Directional payloads: an already encoded payload instead of `radiance` + `direction` (filter-specific format). */
  sh?: GPUTexture;
}

/** Diffuse indirect (GI) / ambient occlusion: 1 sample per pixel. */
export interface DiffuseInputs {
  /** Noisy irradiance (linear HDR, rgba16float) or AO in r. */
  radiance: GPUTexture;
  hitDistance?: GPUTexture;
  /** Directional payloads: world-space direction of each sample's ray (rgb), used with `radiance`. */
  direction?: GPUTexture;
  /** Directional payloads: an already encoded payload instead of `radiance` + `direction` (filter-specific format). */
  sh?: GPUTexture;
}

/**
 * Diffuse + specular denoised together (shared guides and prepass), e.g.
 * `denoiser/realtime`'s `DiffuseSpecularDenoiser`.
 */
export interface DiffuseSpecularInputs {
  diffuse: DiffuseInputs;
  specular: SpecularInputs;
}

/** Full beauty frame for neural temporal denoisers (OIDN 3 class). */
export interface BeautyInputs {
  color: GPUTexture;
  albedo?: GPUTexture;
  normal?: GPUTexture;
  /** Color is linear HDR (default true). */
  hdr?: boolean;
}
