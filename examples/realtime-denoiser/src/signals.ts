// SceneSignals: owns every per-frame GPU texture of the test bed, in ONE place,
// named after the CAPTURE-FORMAT buffers. A capture exporter (tools/rt-capture,
// task T0.6) only needs `signals.textures` (+ `signals.frameMeta` for the
// manifest's per-frame camera/light/reset data) after `render()` has submitted.
//
//   name            format        CAPTURE-FORMAT buffer
//   depth           r32float      depth          (device depth [0,1], not reversed)
//   viewz           r32float      viewz
//   normal          rgba16float   normal         (.xyz)
//   roughness       r32float      roughness
//   motion          rg32float     motion
//   motionZ         r32float      motion_z       (viewZprev - viewZ)
//   albedo          rgba16float   albedo         (.rgb)
//   f0              rgba16float   f0             (.rgb)
//   diffuse         rgba16float   diffuse        (.rgb)
//   diffuseHitT     r32float      diffuse_hitt
//   specular        rgba16float   specular       (.rgb)
//   specularHitT    r32float      specular_hitt
//   visibility      r32float      visibility
//   occluderDist    r32float      occluder_dist
//   diffuseRef      rgba32float   diffuse_ref    (.rgb)  only when requested in render()
//   specularRef     rgba32float   specular_ref   (.rgb)  "
//   visibilityRef   r32float      visibility_ref         "
//
// In noise-injection mode the noisy diffuse/specular/visibility textures are
// overwritten with noise around the reference (exact ground truth).
import type { FrameCamera } from '@pmndrs/denoiser-ffx';
import { FAR, FOVY, invert, lookAt, mul, NEAR, perspective } from './camera';
import type { FrameState } from './paths';
import { OBJ_RADIUS } from './paths';
import { loadBlueNoise } from './bluenoise';
import { INJECT_WGSL, SCENE_WGSL } from './scene';

export type Signal = 'diffuse' | 'specular' | 'shadows';
export const SIGNALS: Signal[] = ['diffuse', 'specular', 'shadows'];

/** noisy-signal sampler: blue = spatiotemporal blue noise (default), white = PCG */
export type Sampling = 'blue' | 'white';

export interface InjectOptions { k: number; fireflyRate: number; fireflyGain: number }

export interface FrameMeta {
  index: number;
  reset: boolean;
  camera: FrameCamera;
  light: FrameState['light'];
  obj: FrameState['obj'];
}

const TEX_FORMATS = {
  depth: 'r32float', viewz: 'r32float', normal: 'rgba16float', roughness: 'r32float',
  motion: 'rg32float', motionZ: 'r32float', albedo: 'rgba16float', f0: 'rgba16float',
  diffuse: 'rgba16float', diffuseHitT: 'r32float', specular: 'rgba16float', specularHitT: 'r32float',
  visibility: 'r32float', occluderDist: 'r32float',
  diffuseRef: 'rgba32float', specularRef: 'rgba32float', visibilityRef: 'r32float',
} as const satisfies Record<string, GPUTextureFormat>;
export type TexName = keyof typeof TEX_FORMATS;

/** Documented in scene.ts; the capture manifest's `demodulation` entry. */
export const DEMODULATION = {
  diffuse: 'albedo',
  specular: 'f0 * A + B, (A, B) = Karis 2014 EnvBRDFApprox(perceptual roughness, max(NdotV, 1e-4)); denominator clamped >= 1e-3',
};

/** samples per reference dispatch (keeps each command buffer short) */
const REF_CHUNK = 32;

export class SceneSignals {
  readonly textures: Record<TexName, GPUTexture>;
  frameMeta?: FrameMeta;
  private u: GPUBuffer;
  private refU: GPUBuffer[] = [];
  private acc: GPUBuffer;
  private pipes: Record<string, GPUComputePipeline> = {};
  private groups: Record<string, GPUBindGroup> = {};
  private injectU: GPUBuffer;
  private aspect: number;
  private blueNoise?: GPUBuffer;

  constructor(readonly device: GPUDevice, readonly width: number, readonly height: number, readonly sampling: Sampling = 'blue') {
    const usage = GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST;
    this.textures = Object.fromEntries(Object.entries(TEX_FORMATS).map(([name, format]) =>
      [name, device.createTexture({ label: `rt ${name}`, size: [width, height], format, usage })])) as Record<TexName, GPUTexture>;
    this.aspect = width / height;
    this.u = device.createBuffer({ size: 512, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.acc = device.createBuffer({ size: width * height * 16, usage: GPUBufferUsage.STORAGE });
    this.injectU = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  }

  async init() {
    const d = this.device;
    const mod = d.createShaderModule({ label: 'rt scene', code: SCENE_WGSL });
    this.blueNoise = await loadBlueNoise(d);
    const inj = d.createShaderModule({ label: 'rt inject', code: INJECT_WGSL });
    for (const [m, name] of [[mod, 'scene'], [inj, 'inject']] as const) {
      const info = await m.getCompilationInfo();
      for (const msg of info.messages) if (msg.type === 'error') throw new Error(`${name} WGSL: ${msg.message} @${msg.lineNum}:${msg.linePos}`);
    }
    const t = this.textures;
    const entries = (pipe: GPUComputePipeline, map: Record<number, GPUTexture | GPUBuffer>) => d.createBindGroup({
      layout: pipe.getBindGroupLayout(0),
      entries: Object.entries(map).map(([b, r]) => ({ binding: Number(b), resource: r instanceof GPUBuffer ? { buffer: r } : r.createView() })),
    });
    const mk = (entry: string, module = mod) => (this.pipes[entry] = d.createComputePipeline({ label: `rt ${entry}`, layout: 'auto', compute: { module, entryPoint: entry } }));
    this.groups.guides = entries(mk('guides'), { 0: this.u, 1: t.depth, 2: t.viewz, 3: t.normal, 4: t.roughness, 5: t.motion, 6: t.motionZ });
    this.groups.material = entries(mk('material'), { 0: this.u, 7: t.albedo, 8: t.f0 });
    this.groups.signals = entries(mk('signals'), { 0: this.u, 9: t.diffuse, 10: t.diffuseHitT, 11: t.specular, 12: t.specularHitT, 13: t.visibility, 14: t.occluderDist, 19: this.blueNoise! });
    for (const s of ['diffuse', 'specular', 'shadows'] as Signal[]) mk(`ref_${s}`);
    mk('inject_rgb', inj); mk('inject_scalar', inj);
    this.groups.inject_diffuse = entries(this.pipes.inject_rgb, { 0: this.injectU, 1: t.diffuseRef, 2: t.diffuse });
    this.groups.inject_specular = entries(this.pipes.inject_rgb, { 0: this.injectU, 1: t.specularRef, 2: t.specular });
    this.groups.inject_shadows = entries(this.pipes.inject_scalar, { 0: this.injectU, 1: t.visibilityRef, 3: t.visibility });
  }

  private refGroup(s: Signal, chunk: number) {
    const key = `ref_${s}_${chunk}`;
    if (!this.groups[key]) {
      this.refU[chunk] ??= this.device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      const out = s === 'shadows' ? { 16: this.textures.visibilityRef } : { 15: s === 'diffuse' ? this.textures.diffuseRef : this.textures.specularRef };
      const pipe = this.pipes[`ref_${s}`];
      this.groups[key] = this.device.createBindGroup({
        layout: pipe.getBindGroupLayout(0),
        entries: Object.entries({ 0: this.u, 17: this.refU[chunk], 18: this.acc, ...out }).map(([b, r]) =>
          ({ binding: Number(b), resource: r instanceof GPUBuffer ? { buffer: r } : (r as GPUTexture).createView() })),
      });
    }
    return this.groups[key];
  }

  /** camera for a frame state (+ the previous state for reprojection) */
  camera(cur: FrameState, prev: FrameState): FrameCamera {
    const proj = perspective(FOVY, this.aspect, NEAR, FAR);
    return {
      view: lookAt(cur.eye, cur.target), projection: proj,
      prevView: lookAt(prev.eye, prev.target), prevProjection: proj,
      jitter: [0, 0], near: NEAR, far: FAR, position: cur.eye, reversedDepth: false,
    };
  }

  /**
   * Render one frame: guides, material, the three 1-spp signals, and the references
   * of `refs` (refSpp samples, rounded to a square grid). Submits its own work.
   */
  render(index: number, cur: FrameState, prev: FrameState, opts: {
    reset: boolean; seed?: number; refs?: Signal[]; refSpp?: number; inject?: InjectOptions;
  }): FrameCamera {
    const d = this.device;
    const cam = this.camera(cur, prev);
    const vp = mul(cam.projection as Float32Array, cam.view as Float32Array);
    const pvp = mul(cam.prevProjection as Float32Array, cam.prevView as Float32Array);
    const b = new ArrayBuffer(512);
    const f = new Float32Array(b), u = new Uint32Array(b);
    f.set(invert(vp), 0); f.set(vp, 16); f.set(pvp, 32); f.set(cam.view as Float32Array, 48); f.set(cam.prevView as Float32Array, 64);
    f.set(cur.eye, 80); u[83] = opts.seed ?? index;
    u[84] = this.width; u[85] = this.height; u[86] = 0; u[87] = this.sampling === 'white' ? 0 : 1;
    f.set(cur.light.pos, 88); f[91] = cur.light.radius;
    f.set(cur.light.radiance, 92); f[95] = FAR;
    f.set(cur.obj, 96); f[99] = OBJ_RADIUS;
    f.set(prev.obj, 100);
    d.queue.writeBuffer(this.u, 0, b);

    const wg: [number, number] = [Math.ceil(this.width / 8), Math.ceil(this.height / 8)];
    const enc = d.createCommandEncoder({ label: 'rt scene' });
    const pass = enc.beginComputePass({ label: 'rt guides+signals' });
    for (const k of ['guides', 'material', 'signals']) {
      pass.setPipeline(this.pipes[k]); pass.setBindGroup(0, this.groups[k]); pass.dispatchWorkgroups(...wg);
    }
    pass.end();
    d.queue.submit([enc.finish()]);

    const refs = opts.refs ?? [];
    const grid = Math.max(1, Math.round(Math.sqrt(opts.refSpp ?? 256)));
    const total = grid * grid;
    for (const s of refs) {
      const chunks = Math.ceil(total / REF_CHUNK);
      for (let c = 0; c < chunks; c++) {
        const start = c * REF_CHUNK;
        const count = Math.min(REF_CHUNK, total - start);
        const g = this.refGroup(s, c);
        d.queue.writeBuffer(this.refU[c], 0, new Uint32Array([start, count, grid, c === chunks - 1 ? 1 : 0]));
        const e = d.createCommandEncoder({ label: `rt ref ${s} ${c}` });
        const p = e.beginComputePass();
        p.setPipeline(this.pipes[`ref_${s}`]); p.setBindGroup(0, g); p.dispatchWorkgroups(...wg); p.end();
        d.queue.submit([e.finish()]);
      }
    }

    if (opts.inject) {
      for (const s of refs) {
        const ib = new ArrayBuffer(32);
        const iu = new Uint32Array(ib), iff = new Float32Array(ib);
        iu[0] = this.width; iu[1] = this.height; iu[2] = opts.seed ?? index; iu[3] = SIGNALS.indexOf(s) + 1;
        iff[4] = opts.inject.k; iff[5] = opts.inject.fireflyRate; iff[6] = opts.inject.fireflyGain;
        // one submit per signal: the uniform is rewritten in between (queue order keeps them apart)
        d.queue.writeBuffer(this.injectU, 0, ib);
        const e = d.createCommandEncoder({ label: `rt inject ${s}` });
        const p = e.beginComputePass();
        p.setPipeline(this.pipes[s === 'shadows' ? 'inject_scalar' : 'inject_rgb']);
        p.setBindGroup(0, this.groups[`inject_${s}`]);
        p.dispatchWorkgroups(...wg); p.end();
        d.queue.submit([e.finish()]);
      }
    }
    this.frameMeta = { index, reset: opts.reset, camera: cam, light: cur.light, obj: cur.obj };
    return cam;
  }

  /** the noisy input / reference / hit-distance textures of a signal */
  signal(s: Signal) {
    const t = this.textures;
    if (s === 'diffuse') return { noisy: t.diffuse, ref: t.diffuseRef, hitT: t.diffuseHitT, scalar: false };
    if (s === 'specular') return { noisy: t.specular, ref: t.specularRef, hitT: t.specularHitT, scalar: false };
    return { noisy: t.visibility, ref: t.visibilityRef, hitT: t.occluderDist, scalar: true };
  }

  dispose() {
    for (const t of Object.values(this.textures)) t.destroy();
    this.u.destroy(); this.acc.destroy(); this.injectU.destroy(); this.blueNoise?.destroy();
    for (const b of this.refU) b.destroy();
  }
}
