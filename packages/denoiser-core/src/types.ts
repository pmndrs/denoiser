import type { NetworkRuntime } from './runtime';

export type Quality = 'fast' | 'balanced' | 'high';

export type ImgInput =
  | ImageData
  | HTMLImageElement
  | HTMLCanvasElement
  | HTMLVideoElement
  | ImageBitmap
  | OffscreenCanvas
  | { data: Uint8ClampedArray; width: number; height: number };

/** Output encoding for texture results. 'linear' = raw model output (HDR-safe),
 *  'srgb' = sRGB-encode, 'aces-srgb' = ACES tonemap + sRGB (display-ready). */
export type OutputTransfer = 'linear' | 'srgb' | 'aces-srgb';

export interface DenoiserCreateOptions {
  /**
   * What executes the network. Required here; the `denoiser` package defaults it
   * to onnxruntime-web (OrtRuntime) and adds its options (weightsUrl, splitAux...).
   */
  runtime?: NetworkRuntime;
  /** fp16 models + tensors when the device supports shader-f16 (auto-falls back). */
  precision?: 'fp32' | 'fp16';
  /** Model family size: fast = *_small, balanced = base, high = *_large where available. */
  quality?: Quality;
  /** Per-run pixel budget: images above it tile instead of whole-frame. Default 2048*1152. */
  maxRunPixels?: number;
  /** Max tiles per model run in tiled mode (default 8). */
  batch?: number;
}

export interface DenoiseImageOptions {
  albedo?: ImgInput; // [0,1], LINEAR bytes — never sRGB-decoded (only `color` honors `srgb`)
  normal?: ImgInput; // RGBA8 bytes encoding [-1,1] as [0,1] (n*0.5+0.5); env/miss pixels = 0
  /** Input pixels are sRGB-encoded photographs/screens (decode in, re-encode out). Default true. */
  srgb?: boolean;
  /** Flip the result vertically. */
  flipY?: boolean;
  onProgress?: (p: number) => void;
}

export interface DenoiseTexturesOptions {
  color: GPUTexture; // float, linear (HDR or LDR)
  albedo?: GPUTexture; // [0,1] floats
  normal?: GPUTexture; // [-1,1] floats (encoded for the network internally)
  /** Linear-HDR input: applies OIDN's PU transfer + autoexposure around the model. */
  hdr?: boolean;
  /** Manual HDR input scale (overrides autoexposure). */
  inputScale?: number;
  /** Color texture rows are bottom-up (e.g. older three-gpu-pathtracer output) — flip reads. Default false. */
  inputFlipY?: boolean;
  /** Aux flip when their vertical convention differs from color. Default: inputFlipY. */
  auxInputFlipY?: boolean;
  /** Caller-owned output texture (rgba8unorm or rgba16float, STORAGE_BINDING). */
  output?: GPUTexture;
  /** Output encoding (default 'linear'; rgba8unorm outputs clamp regardless). */
  transfer?: OutputTransfer;
  /** Flip the result vertically. */
  outputFlipY?: boolean;
  onProgress?: (p: number) => void;
}

export type DenoiserEvent = 'progress' | 'executed';

/** WebGPU / shader-f16 / device capability problems. */
export class DenoiserUnsupportedError extends Error {
  constructor(message: string) { super(message); this.name = 'DenoiserUnsupportedError'; }
}
/** Bad or inconsistent inputs (sizes, formats, missing aux). */
export class DenoiserInputError extends Error {
  constructor(message: string) { super(message); this.name = 'DenoiserInputError'; }
}
