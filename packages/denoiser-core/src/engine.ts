// TiledEngine: the runtime-agnostic denoise pipeline. Pre/post and tiling run in
// WGSL (GpuImageOps) on the session's device; the network itself runs on a
// NetworkRuntime (ORT today — see ./runtime.ts for the contract). Everything
// stays on the GPU except the final pixel readback.
//
// Per image it picks a plan:
//   - WHOLE-FRAME (preferred): pad W/H up to /16, batch=1, overlap=0 — one
//     network run for the entire image, no overlap redundancy, no seams.
//   - TILED fallback (huge images / tight device limits): square tiles with
//     32px overlap, several tiles batched per run.
import { GpuImageOps } from './gpu/imageOps';
import { DenoiserInputError } from './types';
import type {
  NetworkBinding, NetworkGeometry, NetworkModel, NetworkRuntime, NetworkSession, Precision,
} from './runtime';

export interface TiledEngineOptions {
  tile?: number; // base square tile for the tiled fallback (default 256)
  overlap?: number; // tile overlap in tiled mode (default 32)
  batch?: number; // max tiles per network run in tiled mode (default 8)
  /**
   * Per-run pixel budget (tileW*tileH*batch). Images whose padded area fits run
   * whole-frame in one go; bigger images fall back to tiles. Default 2 359 296
   * (2048×1152 ≈ just over 1080p). Raise it on beefy GPUs for whole-frame 1440p+.
   */
  maxRunPixels?: number;
}

export interface DenoiseOptions {
  albedo?: Uint8ClampedArray; // required when channels >= 6
  normal?: Uint8ClampedArray; // required when channels >= 9
  srgb?: boolean; // input is sRGB -> convert to linear before the model, back after
  hdr?: boolean; // linear-HDR input: OIDN PU transfer + autoexposure applied around the model
  /** Manual HDR input scale (overrides autoexposure; OIDN semantics). */
  inputScale?: number;
  flipY?: boolean; // flip the output vertically (in the resolve kernel, free)
  /** ACES tonemap + sRGB-encode the output (for HDR results going straight to a canvas). */
  tonemap?: boolean;
  onProgress?: (p: number) => void;
}

/** Zero-copy input: float textures living on the shared device (e.g. render targets). */
export interface TextureInputs {
  color: GPUTexture;
  albedo?: GPUTexture; // [0,1] floats
  normal?: GPUTexture; // [-1,1] floats (G-buffer convention); encoded to [0,1] for the network
}

export interface TextureDenoiseOptions extends DenoiseOptions {
  /** Source textures are bottom-up (WebGPU render targets) — flip reads. */
  inputFlipY?: boolean;
  /** Aux textures' vertical convention when it differs from color (e.g. raster
   *  G-buffer vs compute-written tracer output). Defaults to inputFlipY. */
  auxInputFlipY?: boolean;
  /** Resolve into an engine-owned rgba8unorm GPUTexture and return it (no CPU readback). */
  toTexture?: boolean;
  /**
   * Resolve into a CALLER-owned texture instead (e.g. a three.js StorageTexture's
   * GPUTexture) — the integration path: pathtracer -> denoiser -> render target.
   * Must match the image size, have STORAGE_BINDING usage, and be rgba8unorm
   * (clamped/display-ready) or rgba16float (unclamped, keeps HDR range so the
   * renderer's own tonemapping stays in charge). Implies toTexture.
   */
  outputTexture?: GPUTexture;
}

/** Wall-clock stage timings for the last denoise() call (all in ms). */
export interface DenoiseStats {
  width: number;
  height: number;
  tiles: number;
  batches: number;
  tileW: number;
  tileH: number;
  batchSize: number;
  uploadMs: number; // input writeBuffer + accum/weight clear
  encodeMs: number; // WGSL extract/accumulate encode+submit (CPU side)
  runMs: number; // sum of awaited network runs (NetworkBinding.run)
  resolveMs: number; // resolve pass + readback map
  totalMs: number;
}

interface TileSpec {
  startX: number; startY: number; curW: number; curH: number; tx: number; ty: number;
}

interface Plan extends NetworkGeometry { overlap: number; }

// Conservative upper bound on the widest full-resolution tensor in any of the
// U-Net variants (decoder concat levels), in channels. Used to test a candidate
// geometry against the device's buffer limits before binding it.
const WORST_FULLRES_CHANNELS = 96;

const pad16 = (x: number) => Math.ceil(x / 16) * 16;

export class TiledEngine {
  device!: GPUDevice;
  readonly channels: number;
  readonly tile: number;
  readonly overlap: number;
  /** Max tiles per network run in tiled mode. */
  batch: number;
  readonly precision: Precision;
  maxRunPixels: number;
  /** Stage timings from the most recent denoise() call. */
  lastStats?: DenoiseStats;

  protected session!: NetworkSession;
  private ops!: GpuImageOps;
  private bindings = new Map<string, NetworkBinding>();

  // per-image buffers
  private imgW = 0;
  private imgH = 0;
  private color?: GPUBuffer;
  private albedo?: GPUBuffer;
  private normal?: GPUBuffer;
  private accum?: GPUBuffer;
  private weight?: GPUBuffer;
  private outPixels?: GPUBuffer;
  private readback?: GPUBuffer;
  private outTexture?: GPUTexture;

  protected constructor(channels: number, precision: Precision, opts: TiledEngineOptions) {
    this.channels = channels;
    this.precision = precision;
    this.tile = opts.tile ?? 256;
    this.overlap = opts.overlap ?? 32;
    this.batch = Math.max(1, opts.batch ?? 8);
    this.maxRunPixels = opts.maxRunPixels ?? 2048 * 1152;
  }

  /** Load `model` on `runtime` and set up the GPU pipeline on its device. */
  static async load(runtime: NetworkRuntime, model: NetworkModel, opts: TiledEngineOptions = {}): Promise<TiledEngine> {
    const e = new TiledEngine(model.channels, model.precision, opts);
    await e.attach((g) => runtime.load(model, { geometry: g }));
    return e;
  }

  /** The first geometry bound is the tiled fallback — load it eagerly. */
  protected async attach(load: (first: NetworkGeometry) => Promise<NetworkSession>) {
    const first = { batch: this.batch, tileW: this.tile, tileH: this.tile };
    this.session = await load(first);
    this.device = this.session.device;
    const fixed = this.session.fixedGeometry;
    if (fixed) this.batch = fixed.batch;
    await this.ensureBinding(fixed ? { ...fixed, overlap: this.overlap } : { ...first, overlap: this.overlap });
    this.ops = new GpuImageOps(this.device, this.batch, this.precision === 'fp16');
  }

  /** Get (or bind) the network IO for a geometry. Tiny LRU: bindings can hold a
   *  GPU copy of the weights (ORT: one session per geometry); keep a few. */
  private async ensureBinding(plan: Plan): Promise<NetworkBinding> {
    const key = `${plan.batch}|${plan.tileW}x${plan.tileH}`;
    const hit = this.bindings.get(key);
    if (hit) return hit;
    const binding = await this.session.bind({ batch: plan.batch, tileW: plan.tileW, tileH: plan.tileH });
    if (this.bindings.size >= 4) {
      const oldest = this.bindings.keys().next().value as string;
      this.bindings.get(oldest)!.release();
      this.bindings.delete(oldest);
    }
    this.bindings.set(key, binding);
    return binding;
  }

  /** Choose the run geometry for an image size (whole-frame when it fits). */
  planFor(w: number, h: number): Plan {
    const fixed = this.session?.fixedGeometry;
    if (fixed) return { ...fixed, overlap: this.overlap };
    const limits = this.device?.limits;
    const bufferCap = limits
      ? Math.min(limits.maxBufferSize, limits.maxStorageBufferBindingSize)
      : 128 * 1024 * 1024;
    const bpe = this.precision === 'fp16' ? 2 : 4;
    const worstBytes = (px: number) => px * WORST_FULLRES_CHANNELS * bpe;

    const pw = pad16(w);
    const ph = pad16(h);
    if (pw * ph <= this.maxRunPixels && worstBytes(pw * ph) <= bufferCap) {
      return { tileW: pw, tileH: ph, batch: 1, overlap: 0 };
    }
    for (const t of [1024, 512, this.tile]) {
      if (t > Math.max(pw, ph)) continue; // pointless: bigger than the image
      const perTile = t * t;
      const batch = Math.min(
        this.batch,
        Math.max(1, Math.floor(this.maxRunPixels / perTile)),
        Math.max(1, Math.floor(bufferCap / worstBytes(perTile))),
      );
      if (worstBytes(perTile * batch) <= bufferCap || batch === 1) {
        if (worstBytes(perTile) <= bufferCap) return { tileW: t, tileH: t, batch, overlap: this.overlap };
      }
    }
    return { tileW: this.tile, tileH: this.tile, batch: 1, overlap: this.overlap };
  }

  private ensureImageBuffers(w: number, h: number, cpuInput: boolean) {
    const haveInputs = !cpuInput || !!this.color;
    if (this.imgW === w && this.imgH === h && this.accum && haveInputs) return;
    [this.color, this.albedo, this.normal, this.accum, this.weight, this.outPixels, this.readback]
      .forEach((b) => b?.destroy());
    this.outTexture?.destroy();
    this.outTexture = undefined;
    const d = this.device;
    const px = w * h;
    const stor = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST;
    if (cpuInput) {
      this.color = d.createBuffer({ size: px * 4, usage: stor });
      this.albedo = this.channels >= 6 ? d.createBuffer({ size: px * 4, usage: stor }) : undefined;
      this.normal = this.channels >= 9 ? d.createBuffer({ size: px * 4, usage: stor }) : undefined;
    } else {
      this.color = this.albedo = this.normal = undefined;
    }
    this.accum = d.createBuffer({ size: 3 * px * 4, usage: stor });
    this.weight = d.createBuffer({ size: px * 4, usage: stor });
    this.outPixels = d.createBuffer({ size: px * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    this.readback = d.createBuffer({ size: px * 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    this.imgW = w;
    this.imgH = h;
  }

  private ensureOutTexture(w: number, h: number): GPUTexture {
    if (!this.outTexture || this.outTexture.width !== w || this.outTexture.height !== h) {
      this.outTexture?.destroy();
      this.outTexture = this.device.createTexture({
        size: { width: w, height: h },
        format: 'rgba8unorm',
        usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC | GPUTextureUsage.TEXTURE_BINDING,
      });
    }
    return this.outTexture;
  }

  /** Denoise a full-resolution image (whole-frame or tiled+blended). Returns RGBA8 pixels (alpha = 255). */
  async denoise(color: Uint8ClampedArray, w: number, h: number, opts: DenoiseOptions = {}): Promise<Uint8ClampedArray> {
    if (color.length !== w * h * 4) throw new Error(`Denoiser: expected ${w * h * 4} color bytes, got ${color.length}`);
    if (this.channels >= 6 && !opts.albedo) throw new DenoiserInputError('Denoiser: model requires an albedo input');
    if (this.channels >= 9 && !opts.normal) throw new DenoiserInputError('Denoiser: model requires a normal input');
    return this.process({ cpu: { color, albedo: opts.albedo, normal: opts.normal } }, w, h, opts) as Promise<Uint8ClampedArray>;
  }

  /**
   * Zero-copy denoise: read float input textures on the shared device directly
   * (no CPU round-trip, no 8-bit quantization — feed HDR models real HDR).
   * With toTexture, also skips the readback and returns an rgba8unorm texture
   * (owned by the engine, valid until the next call / size change / dispose).
   */
  async denoiseTextures(inputs: TextureInputs, opts: TextureDenoiseOptions = {}): Promise<Uint8ClampedArray | GPUTexture> {
    if (this.channels >= 6 && !inputs.albedo) throw new DenoiserInputError('Denoiser: model requires an albedo input');
    if (this.channels >= 9 && !inputs.normal) throw new DenoiserInputError('Denoiser: model requires a normal input');
    return this.process({ tex: inputs }, inputs.color.width, inputs.color.height, opts);
  }

  private async process(
    src: { cpu?: { color: Uint8ClampedArray; albedo?: Uint8ClampedArray; normal?: Uint8ClampedArray }; tex?: TextureInputs },
    w: number, h: number, opts: TextureDenoiseOptions,
  ): Promise<Uint8ClampedArray | GPUTexture> {
    const plan = this.planFor(w, h);
    const net = await this.ensureBinding(plan);
    const { tileW, tileH, batch: B, overlap } = plan;

    this.ensureImageBuffers(w, h, !!src.cpu);
    const d = this.device;
    const strideX = tileW - overlap;
    const strideY = tileH - overlap;
    const tilesX = Math.max(1, Math.ceil((w - overlap) / strideX));
    const tilesY = Math.max(1, Math.ceil((h - overlap) / strideY));

    const tiles: TileSpec[] = [];
    for (let ty = 0; ty < tilesY; ty++) {
      for (let tx = 0; tx < tilesX; tx++) {
        const startX = tx * strideX;
        const startY = ty * strideY;
        tiles.push({
          startX, startY, tx, ty,
          curW: Math.min(tileW, w - startX),
          curH: Math.min(tileH, h - startY),
        });
      }
    }
    const total = tiles.length;
    const batches = Math.ceil(total / B);

    const tStart = performance.now();
    if (src.cpu) {
      // TS 5.7+ lib.dom typings narrowed GPUAllowSharedBufferSource views to
      // ArrayBuffer-backed; this engine never uses SharedArrayBuffer, so these casts are safe.
      d.queue.writeBuffer(this.color!, 0, src.cpu.color as BufferSource);
      if (src.cpu.albedo) d.queue.writeBuffer(this.albedo!, 0, src.cpu.albedo as BufferSource);
      if (src.cpu.normal) d.queue.writeBuffer(this.normal!, 0, src.cpu.normal as BufferSource);
    }

    const clr = d.createCommandEncoder();
    clr.clearBuffer(this.accum!);
    clr.clearBuffer(this.weight!);
    // HDR input scale (OIDN semantics): manual value, or autoexposure computed
    // on the GPU from the color texture. 8-bit inputs default to scale 1.
    if (opts.hdr && opts.inputScale === undefined && src.tex) {
      this.ops.encodeAutoexposure(clr, src.tex.color.createView(), w, h);
    } else {
      this.ops.setExposure(opts.inputScale ?? 1);
    }
    d.queue.submit([clr.finish()]);
    const tUpload = performance.now();

    const albedoBuf = this.albedo ?? this.color;
    const normalBuf = this.normal ?? this.color;
    const colorView = src.tex?.color.createView();
    const albedoView = src.tex ? (src.tex.albedo ?? src.tex.color).createView() : undefined;
    const normalView = src.tex ? (src.tex.normal ?? src.tex.color).createView() : undefined;
    const offsets = new Uint32Array(Math.max(this.ops.maxBatch, B) * 2);
    let encodeMs = 0;
    let runMs = 0;
    let done = 0;
    for (let b0 = 0; b0 < total; b0 += B) {
      const chunk = tiles.slice(b0, b0 + B);

      let t0 = performance.now();
      for (let i = 0; i < chunk.length; i++) {
        offsets[i * 2] = chunk[i].startX;
        offsets[i * 2 + 1] = chunk[i].startY;
      }
      const e1 = d.createCommandEncoder();
      if (src.tex) {
        this.ops.encodeExtractTilesTex(
          e1, colorView!, albedoView!, normalView!, net.input,
          w, h, tileW, tileH, this.channels, !!opts.srgb, !!opts.inputFlipY, !!opts.hdr,
          !!(opts.auxInputFlipY ?? opts.inputFlipY), offsets, chunk.length);
      } else {
        this.ops.encodeExtractTiles(
          e1, this.color!, albedoBuf!, normalBuf!, net.input,
          w, h, tileW, tileH, this.channels, !!opts.srgb, !!opts.hdr, offsets, chunk.length);
      }
      d.queue.submit([e1.finish()]);
      const t1 = performance.now();
      encodeMs += t1 - t0;

      // Unused slots of a short final batch still run through the model with
      // stale (valid float) contents; their outputs are simply never blended.
      await net.run();
      t0 = performance.now();
      runMs += t0 - t1;

      const e2 = d.createCommandEncoder();
      chunk.forEach((tl, i) => {
        this.ops.encodeAccumulateTile(e2, i, net.output, this.accum!, this.weight!, {
          imgW: w, imgH: h, startX: tl.startX, startY: tl.startY, curW: tl.curW, curH: tl.curH,
          tileX: tl.tx, tileY: tl.ty, tilesX, tilesY, tileW, tileH, overlap,
          batchIdx: i,
        });
      });
      d.queue.submit([e2.finish()]);
      encodeMs += performance.now() - t0;
      done += chunk.length;
      opts.onProgress?.(done / total);
    }

    const tTiles = performance.now();
    let out: Uint8ClampedArray | GPUTexture;
    if (opts.outputTexture || opts.toTexture) {
      let tex = opts.outputTexture;
      if (tex) {
        if (tex.width !== w || tex.height !== h) {
          throw new DenoiserInputError(`Denoiser: outputTexture is ${tex.width}x${tex.height}, image is ${w}x${h}`);
        }
        if (!(tex.usage & GPUTextureUsage.STORAGE_BINDING)) {
          throw new DenoiserInputError('Denoiser: outputTexture needs STORAGE_BINDING usage');
        }
        if (tex.format !== 'rgba8unorm' && tex.format !== 'rgba16float') {
          throw new DenoiserInputError(`Denoiser: outputTexture must be rgba8unorm or rgba16float (got ${tex.format})`);
        }
      } else {
        tex = this.ensureOutTexture(w, h);
      }
      const e3 = d.createCommandEncoder();
      this.ops.encodeResolveToTexture(
        e3, this.accum!, this.weight!, tex.createView(), tex.format,
        w, h, !!opts.srgb, !!opts.hdr, !!opts.flipY, !!opts.tonemap);
      d.queue.submit([e3.finish()]);
      await d.queue.onSubmittedWorkDone();
      out = tex;
    } else {
      const e3 = d.createCommandEncoder();
      this.ops.encodeResolve(
        e3, this.accum!, this.weight!, this.outPixels!,
        w, h, !!opts.srgb, !!opts.hdr, !!opts.flipY, !!opts.tonemap);
      e3.copyBufferToBuffer(this.outPixels!, 0, this.readback!, 0, w * h * 4);
      d.queue.submit([e3.finish()]);

      await this.readback!.mapAsync(GPUMapMode.READ);
      out = new Uint8ClampedArray(this.readback!.getMappedRange().slice(0));
      this.readback!.unmap();
    }
    const tEnd = performance.now();
    this.lastStats = {
      width: w, height: h, tiles: total, batches,
      tileW, tileH, batchSize: B,
      uploadMs: tUpload - tStart,
      encodeMs, runMs,
      resolveMs: tEnd - tTiles,
      totalMs: tEnd - tStart,
    };
    return out;
  }

  tileGrid(w: number, h: number) {
    const plan = this.planFor(w, h);
    const strideX = plan.tileW - plan.overlap;
    const strideY = plan.tileH - plan.overlap;
    return {
      tilesX: Math.max(1, Math.ceil((w - plan.overlap) / strideX)),
      tilesY: Math.max(1, Math.ceil((h - plan.overlap) / strideY)),
    };
  }

  /** Free per-image buffers and all bindings but the first (default) one. The
   *  network (and with ORT, the shared GPUDevice) stays alive. */
  trim() {
    [this.color, this.albedo, this.normal, this.accum, this.weight, this.outPixels, this.readback]
      .forEach((b) => b?.destroy());
    this.color = this.albedo = this.normal = this.accum = this.weight =
      this.outPixels = this.readback = undefined;
    this.outTexture?.destroy();
    this.outTexture = undefined;
    this.imgW = this.imgH = 0;
    let first = true;
    for (const [key, b] of this.bindings) {
      if (first) { first = false; continue; }
      b.release();
      this.bindings.delete(key);
    }
  }

  /** Full teardown. With ORT, releasing the last session DESTROYS the shared
   *  GPUDevice — anything else using it (three.js, canvases) dies with it. */
  destroy() {
    this.trim();
    this.bindings.forEach((b) => b.release());
    this.bindings.clear();
    this.session?.release();
  }
}
