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
//   ao, so          r32float      (none: derived)  T5 occlusion: normalized hit distance of the
//                                 diffuse / specular ray (scene.ts OCC_WGSL), every frame
//   aoRef, soRef    r32float      (none)   mean of per-sample normalized hit distances, when requested
//   ---- CAPTURE-FORMAT v1 (testbed-v1; allocated full size only with { v1: true }, else 1x1)
//   diffuseDir      rgba16float   diffuse_dir    (.xyz) world unit direction of the 1-spp diffuse ray
//   specularDir     rgba16float   specular_dir   (.xyz)
//   normalGeom      rgba16float   normal_geom    (.xyz) smooth geometric normal (= normal off the bumpy build)
//   transmittance   rgba16float   transmittance  (.rgb) T of the 1-ray shadow sample (1 where v = 0)
//   translucentDist r32float      translucent_dist
//   shadowRgb       rgba16float   (none: derived)  noisy v*T, the shadow-rgb signal's 1-ray estimate
//   visLumT         r32float      (none: derived)  v*lum709(T), for scalar baselines
//   diffuseShRefA/B rgba32float   diffuse_sh_ref   (A = a, b.xyz; B = Co, Cg) when requested
//   specularShRefA/B rgba32float  specular_sh_ref  "
//   shadowRgbRef    rgba32float   shadow_rgb_ref (.rgb) when requested
//
// In noise-injection mode the noisy diffuse/specular/visibility textures are
// overwritten with noise around the reference (exact ground truth).
import type { FrameCamera } from '@pmndrs/denoiser-ffx';
import { FAR, FOVY, invert, lookAt, mul, NEAR, perspective } from './camera';
import type { FrameState } from './paths';
import { OBJ_RADIUS } from './paths';
import { loadBlueNoise } from './bluenoise';
import { INJECT_WGSL, OCC_WGSL, sceneWgsl, type SceneKind } from './scene';
import type {} from './paths-reflect';   // FrameState.reflect (module augmentation)

export type Signal = 'diffuse' | 'specular' | 'shadows' | 'ao' | 'so' | 'sh-diffuse' | 'sh-specular' | 'shadow-rgb';
/** The three rendered signals (`signal=all`, captures, `refs=all`). */
export const SIGNALS: Signal[] = ['diffuse', 'specular', 'shadows'];
/** Derived occlusion signals (T5): AO / SO = normalized hit distance of the diffuse / specular ray. */
export const OCC_SIGNALS: Signal[] = ['ao', 'so'];
/**
 * CAPTURE-FORMAT v1 signals (SPEC v0.3 M7 / M8): sh-diffuse / sh-specular = the plain diffuse / specular
 * sample plus its ray direction (raw-form SH input), scored as resolved rgb against diffuse_ref /
 * specular_ref (and sh-diffuse also against the resolved diffuse_sh_ref); shadow-rgb = opaque visibility
 * plus rgb transmittance, scored as rgb (clamp tonemap) against shadow_rgb_ref.
 */
export const V1_SIGNALS: Signal[] = ['sh-diffuse', 'sh-specular', 'shadow-rgb'];
export const ALL_SIGNALS: Signal[] = [...SIGNALS, ...OCC_SIGNALS, ...V1_SIGNALS];
export const isOccSignal = (s: Signal) => s === 'ao' || s === 'so';
export const isV1Signal = (s: Signal) => V1_SIGNALS.includes(s);
export const isShSignal = (s: Signal) => s === 'sh-diffuse' || s === 'sh-specular';
/** The reference passes a signal needs (v1 signals also need the plain reference). */
export const refKindsOf = (s: Signal): Signal[] =>
  s === 'sh-diffuse' ? ['diffuse', 'sh-diffuse'] : s === 'sh-specular' ? ['specular', 'sh-specular'] : s === 'shadow-rgb' ? ['shadows', 'shadow-rgb'] : [s];
const REF_ENTRY: Record<Signal, string> = {
  diffuse: 'ref_diffuse', specular: 'ref_specular', shadows: 'ref_shadows', ao: 'ref_ao', so: 'ref_so',
  'sh-diffuse': 'ref_sh_diffuse', 'sh-specular': 'ref_sh_specular', 'shadow-rgb': 'ref_shadow_rgb',
};

/** noisy-signal sampler: blue = spatiotemporal blue noise (default), white = PCG */
export type Sampling = 'blue' | 'white';

export interface InjectOptions { k: number; fireflyRate: number; fireflyGain: number }

export interface FrameMeta {
  index: number;
  reset: boolean;
  camera: FrameCamera;
  light: FrameState['light'];
  obj: FrameState['obj'];
  /** glass build: panel 1's pose */
  glass?: FrameState['glass'];
}

const TEX_FORMATS = {
  depth: 'r32float', viewz: 'r32float', normal: 'rgba16float', roughness: 'r32float',
  motion: 'rg32float', motionZ: 'r32float', albedo: 'rgba16float', f0: 'rgba16float',
  diffuse: 'rgba16float', diffuseHitT: 'r32float', specular: 'rgba16float', specularHitT: 'r32float',
  visibility: 'r32float', occluderDist: 'r32float',
  diffuseRef: 'rgba32float', specularRef: 'rgba32float', visibilityRef: 'r32float',
  ao: 'r32float', so: 'r32float', aoRef: 'r32float', soRef: 'r32float',
  // v1
  diffuseDir: 'rgba16float', specularDir: 'rgba16float', normalGeom: 'rgba16float',
  transmittance: 'rgba16float', translucentDist: 'r32float', shadowRgb: 'rgba16float', visLumT: 'r32float',
  diffuseShRefA: 'rgba32float', diffuseShRefB: 'rgba32float', specularShRefA: 'rgba32float', specularShRefB: 'rgba32float',
  shadowRgbRef: 'rgba32float',
} as const satisfies Record<string, GPUTextureFormat>;
export type TexName = keyof typeof TEX_FORMATS;
const V1_TEX = new Set<TexName>(['diffuseDir', 'specularDir', 'normalGeom', 'transmittance', 'translucentDist', 'shadowRgb', 'visLumT',
  'diffuseShRefA', 'diffuseShRefB', 'specularShRefA', 'specularShRefB', 'shadowRgbRef']);

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
  private acc2?: GPUBuffer;
  /** scene build (scene.ts sceneWgsl) */
  readonly scene: SceneKind;
  /** v1 signals rendered: the dirs / translucency entries run every frame, v1 references can be requested */
  readonly v1: boolean;

  constructor(readonly device: GPUDevice, readonly width: number, readonly height: number, readonly sampling: Sampling = 'blue',
    opts: { scene?: SceneKind; v1?: boolean } = {}) {
    this.scene = opts.scene ?? 'standard';
    this.v1 = opts.v1 ?? this.scene !== 'standard';
    const usage = GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST;
    this.textures = Object.fromEntries(Object.entries(TEX_FORMATS).map(([name, format]) =>
      [name, device.createTexture({ label: `rt ${name}`, size: V1_TEX.has(name as TexName) && !this.v1 ? [1, 1] : [width, height], format, usage })])) as Record<TexName, GPUTexture>;
    this.aspect = width / height;
    this.u = device.createBuffer({ size: 512, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.acc = device.createBuffer({ size: width * height * 16, usage: GPUBufferUsage.STORAGE });
    if (this.v1) this.acc2 = device.createBuffer({ size: width * height * 16, usage: GPUBufferUsage.STORAGE });
    this.injectU = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  }

  async init() {
    const d = this.device;
    const mod = d.createShaderModule({ label: `rt scene (${this.scene})`, code: sceneWgsl(this.scene) });
    this.blueNoise = await loadBlueNoise(d);
    const inj = d.createShaderModule({ label: 'rt inject', code: INJECT_WGSL });
    const occ = d.createShaderModule({ label: 'rt occlusion', code: OCC_WGSL });
    for (const [m, name] of [[mod, 'scene'], [inj, 'inject'], [occ, 'occlusion']] as const) {
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
    for (const s of [...SIGNALS, ...OCC_SIGNALS]) mk(REF_ENTRY[s]);
    if (this.v1) {
      for (const s of V1_SIGNALS) mk(REF_ENTRY[s]);
      this.groups.dirs = entries(mk('dirs'), { 0: this.u, 19: this.blueNoise!, 20: t.diffuseDir, 21: t.specularDir, 22: t.normalGeom });
      this.groups.translucency = entries(mk('translucency'), { 0: this.u, 19: this.blueNoise!, 23: t.transmittance, 24: t.translucentDist, 25: t.shadowRgb, 26: t.visLumT });
    }
    this.groups.occlusion = entries(mk('occlusion', occ), { 0: t.diffuseHitT, 1: t.specularHitT, 2: t.viewz, 3: t.ao, 4: t.so });
    mk('inject_rgb', inj); mk('inject_scalar', inj);
    this.groups.inject_diffuse = entries(this.pipes.inject_rgb, { 0: this.injectU, 1: t.diffuseRef, 2: t.diffuse });
    this.groups.inject_specular = entries(this.pipes.inject_rgb, { 0: this.injectU, 1: t.specularRef, 2: t.specular });
    this.groups.inject_shadows = entries(this.pipes.inject_scalar, { 0: this.injectU, 1: t.visibilityRef, 3: t.visibility });
  }

  private refGroup(s: Signal, chunk: number) {
    const key = `ref_${s}_${chunk}`;
    if (!this.groups[key]) {
      this.refU[chunk] ??= this.device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      const t = this.textures;
      const scalarRef = { shadows: t.visibilityRef, ao: t.aoRef, so: t.soRef } as Partial<Record<Signal, GPUTexture>>;
      const out: Record<number, GPUTexture | GPUBuffer> = scalarRef[s] ? { 16: scalarRef[s] }
        : s === 'sh-diffuse' ? { 15: t.diffuseShRefA, 27: t.diffuseShRefB, 28: this.acc2! }
        : s === 'sh-specular' ? { 15: t.specularShRefA, 27: t.specularShRefB, 28: this.acc2! }
        : s === 'shadow-rgb' ? { 15: t.shadowRgbRef }
        : { 15: s === 'diffuse' ? t.diffuseRef : t.specularRef };
      const pipe = this.pipes[REF_ENTRY[s]];
      if (!pipe) throw new Error(`reference ${s} needs SceneSignals({ v1: true })`);
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
    reset: boolean; seed?: number; refs?: Signal[]; refSpp?: number; refSalt?: number; inject?: InjectOptions;
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
    f.set(prev.obj, 100); u[103] = opts.refSalt ?? 0;
    if (this.scene === 'glass') {
      const g = cur.glass ?? { pos: [0, -100, 0], angle: 0 }, pg = prev.glass ?? g;
      f.set(g.pos, 104); f[107] = g.angle; f.set(pg.pos, 108); f[111] = pg.angle;
    }
    if (this.scene === 'reflect') {
      // reflect build (paths-reflect.ts): reflector pose (+ previous), kind / roughness / size, markers
      const r = cur.reflect, pr = prev.reflect ?? r;
      if (!r || !pr) throw new Error('reflect build needs FrameState.reflect (paths-reflect.ts)');
      f.set(r.refl.pos, 104); f[107] = r.refl.angle; f.set(pr.refl.pos, 108); f[111] = pr.refl.angle;
      u[112] = r.refl.kind; f[113] = r.refl.rough; f[114] = r.refl.radius; f[115] = r.refl.bump;
      f[116] = r.refl.half[0]; f[117] = r.refl.half[1]; f[118] = r.markerRadius; f[119] = r.markerGain;
      f.set(r.m2.pos, 120); f[123] = r.m2.radius; f.set(pr.m2.pos, 124); f[127] = r.floorDim;
    }
    d.queue.writeBuffer(this.u, 0, b);

    const wg: [number, number] = [Math.ceil(this.width / 8), Math.ceil(this.height / 8)];
    const enc = d.createCommandEncoder({ label: 'rt scene' });
    const pass = enc.beginComputePass({ label: 'rt guides+signals' });
    for (const k of ['guides', 'material', 'signals', ...(this.v1 ? ['dirs', 'translucency'] : [])]) {
      pass.setPipeline(this.pipes[k]); pass.setBindGroup(0, this.groups[k]); pass.dispatchWorkgroups(...wg);
    }
    pass.end();
    // T5: noisy ao / so from this frame's hit distances (own pass: reads what `signals` wrote)
    const occPass = enc.beginComputePass({ label: 'rt occlusion' });
    occPass.setPipeline(this.pipes.occlusion); occPass.setBindGroup(0, this.groups.occlusion); occPass.dispatchWorkgroups(...wg);
    occPass.end();
    d.queue.submit([enc.finish()]);

    const refs = opts.refs ?? [];
    this.dispatchRefs(refs, opts.refSpp ?? 256);

    if (opts.inject) {
      for (const s of refs.filter((x) => !isOccSignal(x) && !isV1Signal(x))) {   // ao / so stay the traced hit distances; no injection for v1 signals
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
    this.frameMeta = { index, reset: opts.reset, camera: cam, light: cur.light, obj: cur.obj, ...(cur.glass ? { glass: cur.glass } : {}) };
    return cam;
  }

  /**
   * Re-render the references of `refs` for the frame last passed to render(), with `refSpp`
   * samples and seed salt `refSalt` (0 = the standard references), into the same *Ref
   * textures (E-1: a second, independent or higher-spp reference set; copy the first set
   * away before calling this). Only the salt slot of the scene uniform is rewritten.
   */
  renderRefs(refs: Signal[], refSpp: number, refSalt = 0) {
    this.device.queue.writeBuffer(this.u, 103 * 4, new Uint32Array([refSalt]));
    this.dispatchRefs(refs, refSpp);
  }

  /** chunked reference accumulation (REF_CHUNK samples per submit) */
  private dispatchRefs(refs: Signal[], refSpp: number) {
    const d = this.device;
    const wg: [number, number] = [Math.ceil(this.width / 8), Math.ceil(this.height / 8)];
    const grid = Math.max(1, Math.round(Math.sqrt(refSpp)));
    const total = grid * grid;
    for (const s of [...new Set(refs.flatMap(refKindsOf))]) {
      const chunks = Math.ceil(total / REF_CHUNK);
      for (let c = 0; c < chunks; c++) {
        const start = c * REF_CHUNK;
        const count = Math.min(REF_CHUNK, total - start);
        const g = this.refGroup(s, c);
        d.queue.writeBuffer(this.refU[c], 0, new Uint32Array([start, count, grid, c === chunks - 1 ? 1 : 0]));
        const e = d.createCommandEncoder({ label: `rt ref ${s} ${c}` });
        const p = e.beginComputePass();
        p.setPipeline(this.pipes[REF_ENTRY[s]]); p.setBindGroup(0, g); p.dispatchWorkgroups(...wg); p.end();
        d.queue.submit([e.finish()]);
      }
    }
  }

  /**
   * the noisy input / reference / hit-distance textures of a signal; `tonemap` = how it is scored
   * ('scalar' clamp of .r, 'reinhard' per rgb channel, 'clamp' per rgb channel: shadow-rgb)
   */
  signal(s: Signal): { noisy: GPUTexture; ref: GPUTexture; hitT: GPUTexture; scalar: boolean; tonemap: 'scalar' | 'reinhard' | 'clamp' } {
    const x = this.signalTex(s);
    return { ...x, tonemap: x.scalar ? 'scalar' : s === 'shadow-rgb' ? 'clamp' : 'reinhard' };
  }

  private signalTex(s: Signal) {
    const t = this.textures;
    if (s === 'diffuse' || s === 'sh-diffuse') return { noisy: t.diffuse, ref: t.diffuseRef, hitT: t.diffuseHitT, scalar: false };
    if (s === 'specular' || s === 'sh-specular') return { noisy: t.specular, ref: t.specularRef, hitT: t.specularHitT, scalar: false };
    if (s === 'shadow-rgb') return { noisy: t.shadowRgb, ref: t.shadowRgbRef, hitT: t.occluderDist, scalar: false };
    if (s === 'ao') return { noisy: t.ao, ref: t.aoRef, hitT: t.diffuseHitT, scalar: true };
    if (s === 'so') return { noisy: t.so, ref: t.soRef, hitT: t.specularHitT, scalar: true };
    return { noisy: t.visibility, ref: t.visibilityRef, hitT: t.occluderDist, scalar: true };
  }

  dispose() {
    for (const t of Object.values(this.textures)) t.destroy();
    this.u.destroy(); this.acc.destroy(); this.acc2?.destroy(); this.injectU.destroy(); this.blueNoise?.destroy();
    for (const b of this.refU) b.destroy();
  }
}
