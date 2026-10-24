// ShadowDenoiser: penumbra-aware denoiser for 1-ray (or few-ray) shadow visibility
// (SPEC v0 §7, M4; provisional until the SPEC is reviewed). Sources and pass list in
// shaders/shadow.ts; provenance in docs/research/rt-denoiser/PROVENANCE.md.
//
//   temporal   raw visibility -> history (rgba16float: v, penumbra scale g, A, n_g), packed
//              geometry (rg32uint ping-pong), tile stats; unfiltered copies into T and out
//   tiles      3x3 tile neighbourhood: nearest-occluder scale + indirect list of penumbra tiles
//   spatial 0  history.v -> T     (penumbra tiles only)
//   spatial 1  T -> out           (penumbra tiles only)
//
// Memory at W x H: history 2 x 8 B + geometry 2 x 8 B + T 4 B + out 4 B = 40 B/px, plus
// three tile-sized buffers (12 B per 8x8 tile).
import type {
  FrameCamera, FrameGuides, ShadowInputs, ShadowLight, TemporalConfig, TemporalDenoiser,
} from '@pmndrs/denoiser-core';
import { invert, isDepthFormat, mat4, PassTimer, type M4 } from './common';
import { storageTex } from './gpu';
import { writeFrameUniform } from './guides';
import { FRAME_SIZE } from './shaders/common';
import {
  SF_ANISO, SF_CATMULL, SF_SNAP, SF_HAS_HIT, SF_MERGE_MIN, SF_NOISE, SF_NO_SKIP, SF_SPHERE, SHADOW_TILES_WGSL, SP_SIZE,
  shadowSpatialWgsl, shadowTemporalWgsl,
} from './shaders/shadow';

export interface ShadowDenoiserOptions {
  /** History cap A_cap (frames - 1) of the accumulated visibility. Default 15 (SPEC SH-4). */
  maxHistory?: number;
  /**
   * History cap from the penumbra width in pixels: A_cap(px) = clamp(historyScale x W_px^2,
   * minHistory, maxHistory); 0 = always maxHistory. Default 1.
   */
  historyScale?: number;
  /** Lower bound of that cap. Default 1. */
  minHistory?: number;
  /**
   * Neighbourhood clamp: history kept within the 5x5 raw mean +- clampSigma * sigma + clampFloor.
   * Default 0.4 (about 2 standard errors of the 25-sample mean: with blue-noise samples the
   * 5x5 mean is accurate, and a window of 1 sigma lets moving penumbrae lag).
   */
  clampSigma?: number;
  /** Constant added to the clamp window (keeps penumbra history when all 25 samples agree by chance). Default 0.05. */
  clampFloor?: number;
  /**
   * Anti-lag: history length drops toward 1 frame as the clamp moves the history by 1/antiLag
   * (0 = off). Default 64 (any noticeable clamp restarts the history at 1 frame).
   */
  antiLag?: number;
  /** Radius factor 1 + freshBoost / (1 + A) for young histories (disocclusions, anti-lag). Default 0. */
  freshBoost?: number;
  /** History length (A) a full anti-lag drops to (0 = this frame only). Default 0. */
  antiLagHistory?: number;
  /** Temporal disocclusion: plane distance relative to view distance. Default 0.01. */
  planeDistance?: number;
  /** Kernel radius = radiusScale x penumbra width W (first pass; the second uses half). Default 0.75. */
  radiusScale?: number;
  /** Radius factor at full history (lerp(1, historyShrink, A / maxHistory)). Default 0.5. */
  historyShrink?: number;
  /** Smallest kernel radius in pixels (M12's pixel floor). Default 1. */
  minRadius?: number;
  /** Largest kernel axis in pixels at 1080p (scaled with height). Default 48. */
  maxRadius?: number;
  /** History cap of the penumbra-scale estimate (occluded samples). Default 7. */
  maxScaleHistory?: number;
  /** Spatial weights: plane-distance tolerance (relative to view distance) and normal angle (degrees). */
  geometryTolerance?: number;
  normalAngle?: number;
  /** Stretch the kernel along the projected light direction by 1/(n.l), capped (M12 Eq. 12). Default false. */
  anisotropy?: boolean;
  /** Cap of the anisotropic stretch. Default 4. */
  anisotropyMax?: number;
  /** Where all 25 raw samples of the 5x5 window agree, the history takes their value exactly (no residual lag in lit / umbra areas). Default true. */
  uniformSnap?: boolean;
  /** Catmull-Rom history fetch for visibility where the 2x2 footprint is valid (clamped to it). Default true. */
  catmullRom?: boolean;
  /** Spatial passes: 0, 1 or 2. Default 2. */
  spatialPasses?: number;
  /** Skip tiles without penumbra (TR19 slide 72). Default true. */
  tileSkip?: boolean;
  /** Pixels with their own occluder estimate still take the 3x3-tile minimum ("nearest occluder wins", SPEC SH-3). Default true. */
  mergeMin?: boolean;
  /** Kernel radius in px (at 1080p) on self-shadowing terminators (light partly below the horizon, no occluder distance). Default 16. */
  terminatorRadius?: number;
  /** Noise-driven radius (H18) when there is no hitDistance or light: radius in px = noiseRadius x E. Default 24. */
  noiseRadius?: number;
  /** Light used when the inputs carry none. */
  light?: ShadowLight;
  /** Per-pass GPU timestamps into `gpuTimings`. Default true. */
  timestamps?: boolean;
}

type Resolved = Required<Omit<ShadowDenoiserOptions, 'light'>> & { light?: ShadowLight };

export function resolveShadowOptions(o: ShadowDenoiserOptions = {}): Resolved {
  return {
    maxHistory: o.maxHistory ?? 15,
    historyScale: o.historyScale ?? 1,
    minHistory: o.minHistory ?? 1,
    clampSigma: o.clampSigma ?? 0.4,
    clampFloor: o.clampFloor ?? 0.05,
    antiLag: o.antiLag ?? 64,
    antiLagHistory: o.antiLagHistory ?? 0,
    freshBoost: o.freshBoost ?? 0,
    planeDistance: o.planeDistance ?? 0.01,
    radiusScale: o.radiusScale ?? 0.75,
    historyShrink: o.historyShrink ?? 0.5,
    minRadius: o.minRadius ?? 1,
    maxRadius: o.maxRadius ?? 48,
    maxScaleHistory: o.maxScaleHistory ?? 7,
    geometryTolerance: o.geometryTolerance ?? 0.02,
    normalAngle: o.normalAngle ?? 30,
    anisotropy: o.anisotropy ?? false,
    anisotropyMax: o.anisotropyMax ?? 4,
    catmullRom: o.catmullRom ?? true,
    uniformSnap: o.uniformSnap ?? true,
    spatialPasses: Math.max(0, Math.min(2, Math.round(o.spatialPasses ?? 2))),
    tileSkip: o.tileSkip ?? true,
    mergeMin: o.mergeMin ?? true,
    noiseRadius: o.noiseRadius ?? 24,
    terminatorRadius: o.terminatorRadius ?? 16,
    timestamps: o.timestamps ?? true,
    ...(o.light ? { light: o.light } : {}),
  };
}

/** Layout entry kinds used here (gpu.ts's set plus storage buffers). */
type Kind = 'u' | 'f' | 'F' | 's' | 'i' | 'd' | 'sb' | 'sbr' | GPUTextureFormat;

function layout(device: GPUDevice, label: string, kinds: Kind[]): GPUBindGroupLayout {
  const C = GPUShaderStage.COMPUTE;
  return device.createBindGroupLayout({
    label,
    entries: kinds.map((k, binding): GPUBindGroupLayoutEntry => {
      switch (k) {
        case 'u': return { binding, visibility: C, buffer: { type: 'uniform' } };
        case 'f': return { binding, visibility: C, texture: { sampleType: 'unfilterable-float' } };
        case 'F': return { binding, visibility: C, texture: { sampleType: 'float' } };
        case 's': return { binding, visibility: C, sampler: { type: 'filtering' } };
        case 'i': return { binding, visibility: C, texture: { sampleType: 'uint' } };
        case 'd': return { binding, visibility: C, texture: { sampleType: 'depth' } };
        case 'sb': return { binding, visibility: C, buffer: { type: 'storage' } };
        case 'sbr': return { binding, visibility: C, buffer: { type: 'read-only-storage' } };
        default: return { binding, visibility: C, storageTexture: { access: 'write-only', format: k } };
      }
    }),
  });
}

type Res = GPUBuffer | GPUTexture | GPUTextureView | GPUSampler;
function group(device: GPUDevice, l: GPUBindGroupLayout, res: Res[]): GPUBindGroup {
  return device.createBindGroup({
    layout: l,
    entries: res.map((r, binding): GPUBindGroupEntry => {
      if (r instanceof GPUBuffer) return { binding, resource: { buffer: r } };
      if (r instanceof GPUTexture) return { binding, resource: r.createView() };
      return { binding, resource: r };
    }),
  });
}

function pipeline(device: GPUDevice, label: string, code: string, l: GPUBindGroupLayout): GPUComputePipeline {
  return device.createComputePipeline({
    label,
    layout: device.createPipelineLayout({ label, bindGroupLayouts: [l] }),
    compute: { module: device.createShaderModule({ label, code }), entryPoint: 'main' },
  });
}

/** Mirror of WGSL unprojectZ (shaders/common.ts). */
function unprojectZ(projInv: M4, ndc: [number, number], vz: number): [number, number, number] {
  const tr = (z: number) => {
    const x = projInv[0] * ndc[0] + projInv[4] * ndc[1] + projInv[8] * z + projInv[12];
    const y = projInv[1] * ndc[0] + projInv[5] * ndc[1] + projInv[9] * z + projInv[13];
    const zz = projInv[2] * ndc[0] + projInv[6] * ndc[1] + projInv[10] * z + projInv[14];
    const w = projInv[3] * ndc[0] + projInv[7] * ndc[1] + projInv[11] * z + projInv[15];
    return [x / w, y / w, zz / w];
  };
  const a = tr(0.3), b = tr(0.6);
  const t = (vz - a[2]) / (b[2] - a[2]);
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

const PASSES = ['temporal', 'tiles', 'spatial0', 'spatial1'] as const;

export class ShadowDenoiser implements TemporalDenoiser<ShadowInputs> {
  readonly name = 'shadows';
  readonly device: GPUDevice;
  readonly options: Readonly<Resolved>;
  private timer?: PassTimer;
  private width = 0;
  private height = 0;
  private tilesX = 0;
  private tilesY = 0;
  private frameIndex = 0;
  private needsReset = true;
  private cur = 0;

  private frame: GPUBuffer;
  private params: GPUBuffer;
  private dummy: GPUTexture;
  private sampler: GPUSampler;
  private layouts: Record<'temporalDepth' | 'temporalFloat' | 'tiles' | 'spatial', GPUBindGroupLayout>;
  private pipes: Partial<Record<'temporalDepth' | 'temporalFloat', GPUComputePipeline>> = {};
  private tilesPipe: GPUComputePipeline;
  private spatialPipes: GPUComputePipeline[];

  private geo: GPUTexture[] = [];
  private hist: GPUTexture[] = [];
  private tTex?: GPUTexture;
  private out?: GPUTexture;
  private tileStats?: GPUBuffer;
  private tileMinG?: GPUBuffer;
  private args?: GPUBuffer;
  private list?: GPUBuffer;

  constructor(device: GPUDevice, options: ShadowDenoiserOptions = {}) {
    this.device = device;
    this.options = resolveShadowOptions(options);
    if (this.options.timestamps && PassTimer.supported(device)) this.timer = new PassTimer(device, PASSES.length);
    this.frame = device.createBuffer({ label: 'shadows frame', size: FRAME_SIZE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.params = device.createBuffer({ label: 'shadows params', size: SP_SIZE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.dummy = device.createTexture({ label: 'shadows dummy', size: [1, 1], format: 'r32float', usage: GPUTextureUsage.TEXTURE_BINDING });
    this.sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
    const temporalKinds = (depth: Kind): Kind[] => ['u', 'u', depth, 'f', 'f', 'f', 'f', 'f', 'f', 'i', 'F',
      'rg32uint', 'rgba16float', 'r32float', 'r32float', 'sb', 's'];
    this.layouts = {
      temporalDepth: layout(device, 'shadows temporal (depth)', temporalKinds('d')),
      temporalFloat: layout(device, 'shadows temporal (float)', temporalKinds('f')),
      tiles: layout(device, 'shadows tiles', ['u', 'sbr', 'sb', 'sb', 'sb']),
      spatial: layout(device, 'shadows spatial', ['u', 'u', 'i', 'f', 'f', 'sbr', 'sbr', 'r32float']),
    };
    this.tilesPipe = pipeline(device, 'shadows tiles', SHADOW_TILES_WGSL, this.layouts.tiles);
    this.spatialPipes = [0, 1].map((i) => pipeline(device, `shadows spatial${i}`, shadowSpatialWgsl(i as 0 | 1), this.layouts.spatial));
  }

  get gpuTimings(): ReadonlyMap<string, number> | undefined { return this.timer?.timings; }

  configure({ width, height }: TemporalConfig): void {
    this.destroyTargets();
    const d = this.device;
    this.width = width;
    this.height = height;
    this.tilesX = Math.ceil(width / 8);
    this.tilesY = Math.ceil(height / 8);
    const tex = (label: string, format: GPUTextureFormat) =>
      d.createTexture({ label: `shadows ${label}`, size: [width, height], format, usage: storageTex() });
    this.geo = [0, 1].map((i) => tex(`geometry ${i}`, 'rg32uint'));
    this.hist = [0, 1].map((i) => tex(`history ${i}`, 'rgba16float'));
    this.tTex = tex('T', 'r32float');
    this.out = tex('output', 'r32float');
    const tiles = this.tilesX * this.tilesY;
    this.tileStats = d.createBuffer({ label: 'shadows tile stats', size: tiles * 8, usage: GPUBufferUsage.STORAGE });
    this.tileMinG = d.createBuffer({ label: 'shadows tile scale', size: tiles * 4, usage: GPUBufferUsage.STORAGE });
    this.list = d.createBuffer({ label: 'shadows tile list', size: tiles * 4, usage: GPUBufferUsage.STORAGE });
    this.args = d.createBuffer({
      label: 'shadows indirect args', size: 16,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST,
    });
    d.queue.writeBuffer(this.args, 0, new Uint32Array([0, 1, 1, 0]));
    this.cur = 0;
    this.needsReset = true;
  }

  resetHistory(): void { this.needsReset = true; }

  /** Internal textures for debugging (history: v, g, A, n_g). */
  debugTexture(name: 'history' | 'geometry' | 'T'): GPUTexture | undefined {
    if (name === 'history') return this.hist[this.cur ^ 1];
    if (name === 'geometry') return this.geo[this.cur ^ 1];
    return this.tTex;
  }

  dispatch(inputs: ShadowInputs, guides: FrameGuides, camera: FrameCamera): GPUTexture {
    if (!this.out) throw new Error('ShadowDenoiser: call configure() first');
    const W = this.width, H = this.height;
    for (const [k, t] of [['visibility', inputs.visibility], ['hitDistance', inputs.hitDistance], ['depth', guides.depth],
      ['normal', guides.normal], ['motion', guides.motion]] as const) {
      if (t && (t.width !== W || t.height !== H)) throw new Error(`ShadowDenoiser: ${k} is ${t.width}x${t.height}, configured ${W}x${H}`);
    }
    const d = this.device;
    const o = this.options;
    const reset = this.needsReset;
    this.needsReset = false;
    writeFrameUniform(d, this.frame, W, H, this.frameIndex++, guides, camera, reset);
    this.writeParams(inputs, camera);

    const enc = d.createCommandEncoder({ label: 'shadows' });
    this.timer?.begin();
    const cur = this.cur, prev = cur ^ 1;
    const kind = isDepthFormat(guides.depth.format) ? 'temporalDepth' : 'temporalFloat';
    const tp = this.pipes[kind] ??= pipeline(d, `shadows ${kind}`, shadowTemporalWgsl(kind === 'temporalDepth'), this.layouts[kind]);
    const depthView = kind === 'temporalDepth' ? guides.depth.createView({ aspect: 'depth-only' }) : guides.depth.createView();
    const pass = (name: string, p: GPUComputePipeline, g: GPUBindGroup, x: number, y = 1, indirect = false) => {
      const cp = enc.beginComputePass({ label: `shadows ${name}`, timestampWrites: this.timer?.pass(name) });
      cp.setPipeline(p);
      cp.setBindGroup(0, g);
      if (indirect) cp.dispatchWorkgroupsIndirect(this.args!, 0);
      else cp.dispatchWorkgroups(x, y);
      cp.end();
    };
    pass('temporal', tp, group(d, this.layouts[kind], [
      this.frame, this.params, depthView, guides.viewZ ?? this.dummy, guides.normal, guides.motion,
      guides.motionZ ?? this.dummy, inputs.visibility, inputs.hitDistance ?? this.dummy,
      this.geo[prev], this.hist[prev], this.geo[cur], this.hist[cur], this.tTex!, this.out, this.tileStats!, this.sampler,
    ]), this.tilesX, this.tilesY);
    if (o.spatialPasses > 0) {
      enc.clearBuffer(this.args!, 0, 4);
      pass('tiles', this.tilesPipe, group(d, this.layouts.tiles, [this.params, this.tileStats!, this.tileMinG!, this.args!, this.list!]),
        Math.ceil(this.tilesX / 8), Math.ceil(this.tilesY / 8));
      const src = [this.hist[cur], this.tTex!];
      const dst = o.spatialPasses === 1 ? [this.out] : [this.tTex!, this.out];
      for (let i = 0; i < o.spatialPasses; i++) {
        pass(`spatial${i}`, this.spatialPipes[i], group(d, this.layouts.spatial, [
          this.frame, this.params, this.geo[cur], this.hist[cur], src[i], this.tileMinG!, this.list!, dst[i],
        ]), 0, 1, true);
      }
    }
    const after = this.timer?.end(enc);
    d.queue.submit([enc.finish()]);
    after?.();
    this.cur ^= 1;
    return this.out;
  }

  private writeParams(inputs: ShadowInputs, camera: FrameCamera) {
    const o = this.options;
    const W = this.width, H = this.height;
    const P = mat4(camera.projection);
    const Pinv = invert(P);
    const f = new Float32Array(SP_SIZE / 4);
    const u = new Uint32Array(f.buffer);
    f.set(P, 0);
    // X(q, z) = A(q) + z B(q), A and B affine in the pixel position q (current and previous projection)
    const sub = (a: number[], b: number[]) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const affine = (inv: M4) => {
      const X = (qx: number, qy: number, z: number) => unprojectZ(inv, [2 * qx / W - 1, 1 - 2 * qy / H], -z);
      const B0 = sub(X(0, 0, 2), X(0, 0, 1)), A0 = sub(X(0, 0, 1), B0);
      const B1x = sub(X(1, 0, 2), X(1, 0, 1)), A1x = sub(X(1, 0, 1), B1x);
      const B1y = sub(X(0, 1, 2), X(0, 1, 1)), A1y = sub(X(0, 1, 1), B1y);
      return [A0, sub(A1x, A0), sub(A1y, A0), B0, sub(B1x, B0), sub(B1y, B0)];
    };
    const [A0, Ax, Ay, B0, Bx, By] = affine(Pinv);
    const prevCo = affine(invert(mat4(camera.prevProjection)));
    prevCo.forEach((v, i) => f.set(v, 64 + 4 * i));
    const light = inputs.light ?? o.light;
    const noise = !inputs.hitDistance || !light;
    let lightSize = 0, lightVec: readonly number[] = [0, 0, 0];
    if (light?.type === 'sphere') { lightSize = light.radius; lightVec = light.position; }
    else if (light?.type === 'directional') { lightSize = Math.tan(light.angularRadius); lightVec = light.direction; }
    f.set(A0, 16); f[19] = lightSize;
    f.set(Ax, 20); f[23] = o.maxHistory;
    f.set(Ay, 24); f[27] = o.clampSigma;
    f.set(B0, 28); f[31] = o.clampFloor;
    f.set(Bx, 32); f[35] = o.planeDistance;
    f.set(By, 36); f[39] = o.radiusScale;
    f.set(lightVec, 40); f[43] = o.antiLag;
    const ortho = P[15] === 1;
    f[44] = ortho ? 0 : 2 / (P[5] * H);
    f[45] = ortho ? 2 / (P[5] * H) : 0;
    f[46] = o.minRadius;
    f[47] = o.maxRadius * H / 1080;
    u[48] = (light?.type === 'sphere' ? SF_SPHERE : 0) | (noise ? SF_NOISE : 0) | (o.anisotropy ? SF_ANISO : 0)
      | (o.tileSkip ? 0 : SF_NO_SKIP) | (o.mergeMin ? SF_MERGE_MIN : 0) | (inputs.hitDistance ? SF_HAS_HIT : 0) | (o.catmullRom ? SF_CATMULL : 0) | (o.uniformSnap ? SF_SNAP : 0);
    f[49] = o.maxScaleHistory;
    f[50] = o.geometryTolerance;
    f[51] = Math.cos(o.normalAngle * Math.PI / 180);
    f[52] = o.noiseRadius * H / 1080;
    f[53] = o.anisotropyMax;
    u[54] = this.tilesX;
    u[55] = this.tilesY;
    f[56] = o.antiLagHistory;
    f[57] = o.freshBoost;
    f[60] = o.terminatorRadius * H / 1080;
    f[61] = o.historyScale;
    f[62] = o.minHistory;
    f[63] = o.historyShrink;
    this.device.queue.writeBuffer(this.params, 0, f);
  }

  private destroyTargets() {
    for (const t of [...this.geo, ...this.hist, this.tTex, this.out]) t?.destroy();
    for (const b of [this.tileStats, this.tileMinG, this.args, this.list]) b?.destroy();
    this.geo = [];
    this.hist = [];
    this.tTex = this.out = undefined;
    this.tileStats = this.tileMinG = this.args = this.list = undefined;
  }

  dispose(): void {
    this.destroyTargets();
    this.frame.destroy();
    this.params.destroy();
    this.dummy.destroy();
    this.timer?.destroy();
  }
}
