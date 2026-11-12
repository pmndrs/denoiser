// Disocclusion detectors vs exact ground truth (results/UPSCALER-GUIDES.md).
//
// Per frame: the test bed renders guides + 1-spp signals (examples/realtime-denoiser SceneSignals), or a capture
// frame is uploaded (tools/rt-capture CaptureTextures). Then:
//   GT   live: the analytic scene re-traced at t-1 (camera AND the moving sphere at their t-1 poses): the pixel's
//        surface point P, moved to its t-1 position, must be on the t-1 screen, in front of the far plane, and the
//        first hit of the ray from the t-1 eye toward it (relative tolerance 2e-4). Capture mode: a
//        mask from BVH ray casts (gt-bvh.ts, three-mesh-bvh), computed in the page.
//   ours the denoisers' own history length after the frame: SVGF accum.a == 1 (n), recurrent A == 0 (packed data),
//        shadows A == 0 (history .z mod youngBase). These are exactly "history age reset".
//   fsr3 @pmndrs/upscaler's guides stage, run as the Upscaler runs it (its RECONSTRUCT_SHADER, ConstantsBuffer,
//        ComputePass): graded `disocclusion` in masks.r, thresholded at several levels.
// Scoring (GPU atomics): per detector TP / FP / FN / TN over receivers (depth < 1), reset frames excluded; and the
// same over "interior" pixels (all 3x3 neighbours receivers with the same GT), which drops the 1-px silhouette band
// where point visibility and a pixel's footprint disagree. Live mode also counts the wrong-surface class: GT-disoccluded
// pixels with no same-object texel in the 3x3 around the true reprojection (any history kept there is another surface),
// and how many of them each detector missed (`hard`, `FNhard`).
//
// window.__ug = { ready, results } for run.mjs. Query: mode=live|capture|bench, path, w, h, frames, start,
// capture, dump=<frame list> (PNG strips: GT | shadows | SVGF | fsr3 >= 0.5), n (bench dispatches).
import { SceneSignals } from '../../../../../../examples/realtime-denoiser/src/signals';
import { pathById, isReset, type FrameState } from '../../../../../../examples/realtime-denoiser/src/paths';
import { sceneWgsl } from '../../../../../../examples/realtime-denoiser/src/scene';
import { NEAR, FAR } from '../../../../../../examples/realtime-denoiser/src/camera';
import { DiffuseDenoiser, ShadowDenoiser } from '../../../../../../packages/denoiser-realtime/src/index';
import type { FrameCamera, FrameGuides, ShadowLight } from '../../../../../../packages/denoiser-realtime/src/index';
import { CaptureTextures, loadManifest } from '../../../../../../tools/rt-capture/src/replay';
import { CaptureClient, frameDir, toFrameCamera } from '../../../../../../tools/rt-capture/src/format';
import { shadowLightOf } from '../../../../../../tools/rt-capture/src/denoisers';
import { RECONSTRUCT_SHADER } from '@fsr3/shaders/reconstruct';
import { ConstantsBuffer } from '@fsr3/internal/ConstantsBuffer';
import { ComputePass } from '@fsr3/internal/ComputePass';
import { BvhGroundTruth } from './gt-bvh';

const q = new URLSearchParams(location.search);
const state: Record<string, unknown> = { ready: false };
(window as unknown as { __ug: unknown }).__ug = state;
const log = (...a: unknown[]) => { console.log(...a); (state.log as string[] | undefined)?.push(a.join(' ')); };
state.log = [];

// fsr3 constants flags (src/shaders/common.ts)
const FLAG_PERSPECTIVE = 4;

/** @pmndrs/upscaler's guides stage on raw textures: exactly Upscaler._encodeGuides (one reconstruct pass). */
class UpscalerGuides {
  readonly constants: ConstantsBuffer;
  readonly pass: ComputePass;
  readonly depth: GPUTexture;
  readonly dd: GPUTexture[];
  readonly motion: GPUTexture;
  readonly mask: GPUTexture;
  private idx = 0;
  private depthPipe: GPURenderPipeline;
  private depthBg?: GPUBindGroup;
  private depthSrc?: GPUTexture;
  constructor(private device: GPUDevice, readonly W: number, readonly H: number) {
    this.constants = new ConstantsBuffer(device);
    this.pass = new ComputePass(device, 'reconstruct', RECONSTRUCT_SHADER);
    const st = GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC;
    // the Upscaler's formats: dilated depth r32float ping-pong, dilated motion rgba16float, masks rgba8unorm
    this.dd = [0, 1].map((i) => device.createTexture({ label: `fsr3 dilated depth ${i}`, size: [W, H], format: 'r32float', usage: st }));
    this.motion = device.createTexture({ label: 'fsr3 dilated motion', size: [W, H], format: 'rgba16float', usage: st });
    this.mask = device.createTexture({ label: 'fsr3 masks', size: [W, H], format: 'rgba8unorm', usage: st });
    // a renderer's hardware depth: the guide's device depth written to depth32float
    this.depth = device.createTexture({ label: 'hw depth', size: [W, H], format: 'depth32float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
    const code = /* wgsl */ `
@group(0) @binding(0) var src: texture_2d<f32>;
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4f(p * 2.0 - 1.0, 0.0, 1.0);
}
@fragment fn fs(@builtin(position) pos: vec4f) -> @builtin(frag_depth) f32 {
  return clamp(textureLoad(src, vec2i(pos.xy), 0).r, 0.0, 1.0);
}`;
    const m = device.createShaderModule({ code });
    this.depthPipe = device.createRenderPipeline({
      layout: 'auto', vertex: { module: m, entryPoint: 'vs' }, fragment: { module: m, entryPoint: 'fs', targets: [] },
      depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'always' },
    });
  }

  /** depth: r32float device depth; velocity: NDC delta current - previous (three's velocity). */
  encode(enc: GPUCommandEncoder, depthR32: GPUTexture, velocity: GPUTexture, near: number, far: number, ts?: GPUComputePassTimestampWrites) {
    if (this.depthSrc !== depthR32) {
      this.depthSrc = depthR32;
      this.depthBg = this.device.createBindGroup({ layout: this.depthPipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: depthR32.createView() }] });
    }
    const rp = enc.beginRenderPass({ colorAttachments: [], depthStencilAttachment: { view: this.depth.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' } });
    rp.setPipeline(this.depthPipe); rp.setBindGroup(0, this.depthBg!); rp.draw(3); rp.end();
    this.encodeReconstruct(enc, velocity, near, far, ts);
  }

  /** The guides stage alone (Upscaler._writeConstants + _encodeGuides for path 'guides', no jitter). */
  encodeReconstruct(enc: GPUCommandEncoder, velocity: GPUTexture, near: number, far: number, ts?: GPUComputePassTimestampWrites) {
    const c = this.constants;
    c.setRenderSize(this.W, this.H); c.setDisplaySize(this.W, this.H); c.setJitter(0, 0, 0, 0);
    c.setMotionScale(0.5, -0.5); c.setDepthNearFar(near, far); c.setMaxAccumulation(24); c.setExposure(1); c.setDeltaTime(1 / 60);
    c.setFlags(FLAG_PERSPECTIVE);
    c.upload();
    const bg = this.pass.createBindGroup([
      { buffer: c.buffer }, this.depth.createView(), velocity.createView(), this.dd[1 - this.idx].createView(),
      this.dd[this.idx].createView(), this.motion.createView(), this.mask.createView(),
    ]);
    const p = enc.beginComputePass({ label: 'upscale-reconstruct', ...(ts ? { timestampWrites: ts } : {}) });
    this.pass.dispatch(p, bg, this.W, this.H);
    p.end();
    this.idx = 1 - this.idx;
  }
}

/** Ground truth for the analytic test bed (standard build): scene.ts's own tracer, patched to put the moving sphere at its t-1 pose on demand. */
function gtWgsl(): string {
  const src = sceneWgsl('standard');
  const needle = 'let s = vec4f(u.objPos, u.objRadius);';
  if (!src.includes(needle)) throw new Error('scene.ts changed: moving-sphere line not found');
  return src.replace(needle, 'let s = vec4f(select(u.objPos, u.objPrevPos, g_prev), u.objRadius);') + /* wgsl */ `
var<private> g_prev: bool = false;
@group(0) @binding(40) var o_gt: texture_storage_2d<r32float, write>;
@group(0) @binding(41) var o_id: texture_storage_2d<r32float, write>;
@compute @workgroup_size(8, 8)
fn gt_main(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= u.dims)) { return; }
  let pr = primary(id.xy);
  if (!pr.hit || pr.depth >= 1.0) { textureStore(o_gt, id.xy, vec4f(-1.0)); textureStore(o_id, id.xy, vec4f(-1.0)); return; }
  let h = trace(u.camPos, pr.rd, 1e4);
  textureStore(o_id, id.xy, vec4f(f32(h.id)));
  var pPrev = pr.p;
  if (h.id == MOVING_ID) { pPrev = pr.p - (u.objPos - u.objPrevPos); }
  let c = ndcOf(u.prevViewProj, pPrev);
  var dis = 1.0;
  if (all(abs(c.xy) < vec2f(1.0)) && c.z > 0.0 && c.z < 1.0) {
    let pv = u.prevView;
    let R = mat3x3f(pv[0].xyz, pv[1].xyz, pv[2].xyz);
    let eyePrev = -(transpose(R) * pv[3].xyz);
    let d = pPrev - eyePrev;
    let dist = length(d);
    g_prev = true;
    let h2 = trace(eyePrev, d / dist, 1e4);
    g_prev = false;
    if (h2.t < 0.0 || h2.t >= dist * (1.0 - 2e-4) - 1e-4) { dis = 0.0; }
  }
  textureStore(o_gt, id.xy, vec4f(dis));
}
`;
}

// detector channels
const THR = [1 / 255, 0.25, 0.5, 0.75, 0.99];
const CHANNELS = ['svgf-off', 'svgf-auto', 'recurrent', 'shadows', 'svgf-off-nomz',
  ...THR.map((t) => `fsr3>=${t < 0.01 ? 'any' : t}`), 'svgf-off|fsr3>=0.5', 'shadows|fsr3>=0.5', 'recurrent|fsr3>=0.5', 'svgf-off|fsr3>=0.99'];
const NC = CHANNELS.length;

const SCORE_WGSL = /* wgsl */ `
struct S { dims: vec2u, youngBase: f32, scoreFrame: u32, hasId: u32, _a: u32, _b: u32, _c: u32 };
@group(0) @binding(0) var<uniform> s: S;
@group(0) @binding(1) var t_gt: texture_2d<f32>;
@group(0) @binding(2) var t_svgfOff: texture_2d<f32>;
@group(0) @binding(3) var t_svgfAuto: texture_2d<f32>;
@group(0) @binding(4) var t_rec: texture_2d<u32>;
@group(0) @binding(5) var t_sh: texture_2d<f32>;
@group(0) @binding(6) var t_svgfNoMz: texture_2d<f32>;
@group(0) @binding(7) var t_mask: texture_2d<f32>;
@group(0) @binding(8) var<storage, read_write> counts: array<atomic<u32>>;
@group(0) @binding(9) var o_viz: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(10) var t_idCur: texture_2d<f32>;
@group(0) @binding(11) var t_idPrev: texture_2d<f32>;
@group(0) @binding(12) var t_motion: texture_2d<f32>;
const THR = array<f32, 5>(${THR.map((t) => `${t}`).join(', ')});
const NC: u32 = ${NC}u;

fn gtAt(p: vec2i) -> f32 { return textureLoad(t_gt, clamp(p, vec2i(0), vec2i(s.dims) - 1), 0).r; }

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= s.dims)) { return; }
  let p = vec2i(id.xy);
  let g = gtAt(p);
  var det: array<bool, ${NC}>;
  det[0] = textureLoad(t_svgfOff, p, 0).a < 1.5;
  det[1] = textureLoad(t_svgfAuto, p, 0).a < 1.5;
  det[2] = (textureLoad(t_rec, p, 0).r & 1023u) == 0u;
  let z = textureLoad(t_sh, p, 0).z;
  det[3] = (z - s.youngBase * floor(z / s.youngBase)) < 0.5;
  det[4] = textureLoad(t_svgfNoMz, p, 0).a < 1.5;
  let m = textureLoad(t_mask, p, 0).r;
  for (var k = 0u; k < 5u; k++) { det[5u + k] = m >= THR[k] - 1e-4; }
  det[10] = det[0] || det[7];
  det[11] = det[3] || det[7];
  det[12] = det[2] || det[7];
  det[13] = det[0] || det[9];
  let pos = g > 0.5;
  var hard = false;
  if (pos && s.hasId != 0u) {
    let idc = textureLoad(t_idCur, p, 0).r;
    let mv = textureLoad(t_motion, p, 0).xy;
    let pp = vec2f(p) + 0.5 - vec2f(mv.x, -mv.y) * 0.5 * vec2f(s.dims) - 0.5;
    let b = vec2i(floor(pp + 0.5));   // 3x3 around the reprojected texel: covers the 2x2 footprint and SVGF's 3x3 fallback
    hard = true;
    for (var k = 0; k < 9; k++) {
      let qq = b + vec2i(k % 3 - 1, k / 3 - 1);
      if (all(qq >= vec2i(0)) && all(qq < vec2i(s.dims)) && textureLoad(t_idPrev, qq, 0).r == idc) { hard = false; }
    }
  }
  // visualisation: r = 0 no surface, 0.33 GT visible, 0.67 GT disoccluded, 1 GT disoccluded with no same-object texel
  // nearby; g = shadows (our strict plane test) detected, b = SVGF detected, a = fsr3 mask >= 0.5
  textureStore(o_viz, p, vec4f(select(select(0.333, select(0.667, 1.0, hard), pos), 0.0, g < 0.0), select(0.0, 1.0, det[3]), select(0.0, 1.0, det[0]), select(0.0, 1.0, det[7])));
  if (g < 0.0 || s.scoreFrame == 0u) { return; }
  var interior = true;
  for (var dy = -1; dy <= 1; dy++) { for (var dx = -1; dx <= 1; dx++) { if (gtAt(p + vec2i(dx, dy)) != g) { interior = false; } } }
  for (var c = 0u; c < NC; c++) {
    // 0 TP, 1 FP, 2 FN, 3 TN; +4 interior
    let k = select(select(3u, 1u, det[c]), select(2u, 0u, det[c]), pos);
    atomicAdd(&counts[c * 10u + k], 1u);
    if (interior) { atomicAdd(&counts[c * 10u + 4u + k], 1u); }
    // 8: GT-disoccluded pixels with no same-object texel in the 3x3 texels around the true-motion reprojection ("hard": any kept history is another surface); 9: of those, missed
    if (hard) { atomicAdd(&counts[c * 10u + 8u], 1u); if (!det[c]) { atomicAdd(&counts[c * 10u + 9u], 1u); } }
  }
}
`;

interface Source {
  W: number; H: number; frames: number; near: number; far: number;
  /** renders / uploads frame i; returns guides etc. */
  frame(i: number): Promise<{ reset: boolean; guides: FrameGuides & { viewZ?: GPUTexture; motionZ?: GPUTexture }; camera: FrameCamera;
    diffuse: { radiance: GPUTexture; hitDistance?: GPUTexture }; visibility: { visibility: GPUTexture; hitDistance?: GPUTexture }; light?: ShadowLight }>;
  /** writes GT for the frame just produced into gtTex (r32float: -1 sky, 0 visible, 1 disoccluded) */
  gt(enc: GPUCommandEncoder, gtTex: GPUTexture, i: number): Promise<void>;
  /** live only: object id of this frame / the previous frame (r32float, -1 sky), valid after gt() */
  ids?(): { cur: GPUTexture; prev: GPUTexture };
}

async function liveSource(device: GPUDevice, pathId: string, W: number, H: number, frames: number, start: number): Promise<Source> {
  const path = pathById(pathId);
  if (!path) throw new Error(`unknown path ${pathId}`);
  if (path.scene && path.scene !== 'standard') throw new Error('GT supports the standard build only');
  const scene = new SceneSignals(device, W, H, 'blue');
  await scene.init();
  const mod = device.createShaderModule({ label: 'gt', code: gtWgsl() });
  const info = await mod.getCompilationInfo();
  for (const m of info.messages) if (m.type === 'error') throw new Error(`gt WGSL: ${m.message} @${m.lineNum}:${m.linePos}`);
  const pipe = device.createComputePipeline({ label: 'gt', layout: 'auto', compute: { module: mod, entryPoint: 'gt_main' } });
  const u = (scene as unknown as { u: GPUBuffer }).u;
  const idTex = [0, 1].map(() => device.createTexture({ size: [W, H], format: 'r32float', usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING }));
  let idCur = 0;
  let cur: FrameState | undefined;
  const t = scene.textures;
  return {
    W, H, frames: Math.min(frames, path.frames - start), near: NEAR, far: FAR,
    async frame(i) {
      const f = start + i;
      cur = path.at(f);
      const prev = path.at(Math.max(0, f - 1));
      const reset = i === 0 || isReset(path, f);
      const camera = scene.render(f, cur, reset ? cur : prev, { reset });
      return {
        reset, camera,
        guides: { depth: t.depth, normal: t.normal, motion: t.motion, roughness: t.roughness, albedo: t.albedo, viewZ: t.viewz, motionZ: t.motionZ },
        diffuse: { radiance: t.diffuse, hitDistance: t.diffuseHitT },
        visibility: { visibility: t.visibility, hitDistance: t.occluderDist },
        light: { type: 'sphere', position: cur.light.pos, radius: cur.light.radius },
      };
    },
    async gt(enc, gtTex) {
      idCur ^= 1;
      const bg = device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: u } }, { binding: 40, resource: gtTex.createView() }, { binding: 41, resource: idTex[idCur].createView() }] });
      const p = enc.beginComputePass({ label: 'gt' });
      p.setPipeline(pipe); p.setBindGroup(0, bg); p.dispatchWorkgroups(Math.ceil(W / 8), Math.ceil(H / 8)); p.end();
    },
    ids: () => ({ cur: idTex[idCur], prev: idTex[idCur ^ 1] }),
  };
}

async function captureSource(device: GPUDevice, name: string, frames: number, start: number): Promise<Source> {
  const client = new CaptureClient();
  const manifest = await loadManifest(name, client);
  const tex = new CaptureTextures(device, manifest, name, client);
  const W = manifest.width, H = manifest.height;
  const n = Math.min(frames, manifest.frames.length - start);
  const bvhGt = await BvhGroundTruth.create(manifest);
  let gtMs = 0;
  return {
    W, H, frames: n, near: manifest.frames[0].camera.near ?? 0.05, far: manifest.frames[0].camera.far ?? 30,
    async frame(i) {
      const fi = start + i;
      await tex.load(fi);
      const fr = tex.frame(manifest.frames[fi]);
      const reset = i === 0 || manifest.frames[fi].reset;
      const vis = fr.inputs.visibility ?? { visibility: fr.textures.depth };
      return {
        reset, camera: toFrameCamera(manifest, manifest.frames[fi]), guides: fr.guides,
        diffuse: fr.inputs.diffuse ?? { radiance: fr.textures.normal }, visibility: vis,
        light: shadowLightOf((manifest.frames[fi] as { lights?: [] }).lights) ?? shadowLightOf(manifest.lights),
      };
    },
    async gt(_enc, gtTex, i) {
      // u8 per pixel: 0 visible, 1 disoccluded, 255 no surface (gt-bvh.ts)
      const fi = start + i;
      const vz = await client.getF32(`captures/${name}/${frameDir(fi)}/viewz.f32`, W * H);
      const t0 = performance.now();
      const b = manifest.frames[fi].reset || i === 0 ? new Uint8Array(W * H) : bvhGt.frame(manifest, fi, vz);
      gtMs += performance.now() - t0;
      const f = new Float32Array(W * H);
      for (let k = 0; k < W * H; k++) f[k] = b[k] === 255 ? -1 : b[k];
      device.queue.writeTexture({ texture: gtTex }, f, { bytesPerRow: W * 4 }, [W, H]);
      state.gtStats = { ...bvhGt.stats, triangles: bvhGt.triangles, gtMs: Math.round(gtMs) };
    },
  };
}

async function readTexRgba8(device: GPUDevice, tex: GPUTexture): Promise<Uint8ClampedArray> {
  const W = tex.width, H = tex.height, bpr = Math.ceil(W * 4 / 256) * 256;
  const buf = device.createBuffer({ size: bpr * H, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const enc = device.createCommandEncoder();
  enc.copyTextureToBuffer({ texture: tex }, { buffer: buf, bytesPerRow: bpr }, [W, H]);
  device.queue.submit([enc.finish()]);
  await buf.mapAsync(GPUMapMode.READ);
  const src = new Uint8Array(buf.getMappedRange());
  const out = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) out.set(src.subarray(y * bpr, y * bpr + W * 4), y * W * 4);
  buf.unmap(); buf.destroy();
  return out;
}

/** PNG of one frame: [GT | ours, shadows | ours, SVGF | fsr3 >= 0.5]. GT panel: grey = disoccluded, yellow = disoccluded with
 * no same-object texel nearby (wrong-surface risk). Detector panels: white = hit, red = missed, magenta = missed wrong-surface,
 * cyan = false alarm. */
function vizPng(rgba: Uint8ClampedArray, W: number, H: number): string {
  const cv = document.createElement('canvas');
  cv.width = W * 4 + 6; cv.height = H;
  const ctx = cv.getContext('2d')!;
  ctx.fillStyle = '#888'; ctx.fillRect(0, 0, cv.width, H);
  const img = ctx.getImageData(0, 0, cv.width, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    const r = rgba[i] / 255, surf = r > 0.1, pos = r > 0.5, hard = r > 0.9;
    const put = (panel: number, c: [number, number, number]) => { const o = (y * cv.width + panel * (W + 2) + x) * 4; img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255; };
    const bg: [number, number, number] = surf ? [24, 24, 24] : [0, 0, 0];
    put(0, pos ? (hard ? [255, 220, 0] : [200, 200, 200]) : bg);
    [rgba[i + 1], rgba[i + 2], rgba[i + 3]].forEach((d, k) => {
      const det = d > 127;
      put(k + 1, pos ? (det ? [255, 255, 255] : hard ? [255, 0, 255] : [255, 40, 40]) : det && surf ? [0, 200, 255] : bg);
    });
  }
  ctx.putImageData(img, 0, 0);
  return cv.toDataURL('image/png');
}

async function runScore(device: GPUDevice, src: Source, dumps: Set<number>) {
  const { W, H } = src;
  const mk = (o: ConstructorParameters<typeof DiffuseDenoiser>[1]) => { const d = new DiffuseDenoiser(device, { ...o, timestamps: false }); d.configure({ width: W, height: H }); return d; };
  const svgfOff = mk({ antiLag: 'off' });
  const svgfAuto = mk({ antiLag: 'auto' });
  const rec = mk({ filter: 'recurrent' });
  const svgfNoMz = mk({ antiLag: 'off' });
  const sh = new ShadowDenoiser(device, { timestamps: false } as never);
  sh.configure({ width: W, height: H });
  const youngBase = Math.max(32, 2 ** Math.ceil(Math.log2((sh.options as { maxHistory: number }).maxHistory + 2)));
  const ug = new UpscalerGuides(device, W, H);
  const gtTex = device.createTexture({ size: [W, H], format: 'r32float', usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  const viz = device.createTexture({ size: [W, H], format: 'rgba8unorm', usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC });
  const counts = device.createBuffer({ size: NC * 10 * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });
  const rb = device.createBuffer({ size: NC * 10 * 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const su = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const sp = device.createComputePipeline({ label: 'score', layout: 'auto', compute: { module: device.createShaderModule({ code: SCORE_WGSL }), entryPoint: 'main' } });
  const pngs: Record<string, string> = {};
  const perFrame: number[][] = [];
  for (let i = 0; i < src.frames; i++) {
    const fr = await src.frame(i);
    const noMz = { ...fr.guides }; delete noMz.motionZ;
    for (const d of [svgfOff, svgfAuto, rec]) d.dispatch(fr.diffuse, fr.guides, fr.camera);
    svgfNoMz.dispatch(fr.diffuse, noMz, fr.camera);
    sh.dispatch({ ...fr.visibility, ...(fr.light ? { light: fr.light } : {}) }, fr.guides, fr.camera);
    const enc = device.createCommandEncoder();
    ug.encode(enc, fr.guides.depth, fr.guides.motion, src.near, src.far);
    await src.gt(enc, gtTex, i);
    device.queue.writeBuffer(su, 0, new Uint32Array([W, H, 0, fr.reset ? 0 : 1, src.ids ? 1 : 0, 0, 0, 0]));
    device.queue.writeBuffer(su, 8, new Float32Array([youngBase]));
    if (dumps.size) enc.clearBuffer(counts);
    const bg = device.createBindGroup({ layout: sp.getBindGroupLayout(0), entries: [
      { binding: 0, resource: { buffer: su } }, { binding: 1, resource: gtTex.createView() },
      { binding: 2, resource: svgfOff.debugTexture('accum')!.createView() }, { binding: 3, resource: svgfAuto.debugTexture('accum')!.createView() },
      { binding: 4, resource: rec.debugTexture('data')!.createView() }, { binding: 5, resource: sh.debugTexture('history')!.createView() },
      { binding: 6, resource: svgfNoMz.debugTexture('accum')!.createView() }, { binding: 7, resource: ug.mask.createView() },
      { binding: 8, resource: { buffer: counts } }, { binding: 9, resource: viz.createView() },
      { binding: 10, resource: (src.ids?.().cur ?? gtTex).createView() }, { binding: 11, resource: (src.ids?.().prev ?? gtTex).createView() },
      { binding: 12, resource: fr.guides.motion.createView() },
    ] });
    const p = enc.beginComputePass({ label: 'score' });
    p.setPipeline(sp); p.setBindGroup(0, bg); p.dispatchWorkgroups(Math.ceil(W / 8), Math.ceil(H / 8)); p.end();
    device.queue.submit([enc.finish()]);
    if (dumps.has(i)) pngs[`f${i}`] = vizPng(await readTexRgba8(device, viz), W, H);
    if (dumps.size || i === src.frames - 1 || q.get('perframe')) {
      const e2 = device.createCommandEncoder(); e2.copyBufferToBuffer(counts, 0, rb, 0, NC * 40); device.queue.submit([e2.finish()]);
      await rb.mapAsync(GPUMapMode.READ);
      perFrame.push([i, ...new Uint32Array(rb.getMappedRange().slice(0))]);
      rb.unmap();
    }
    if (i % 16 === 0) log(`frame ${i}/${src.frames}`);
  }
  // totals: with dumps the buffer was cleared per frame -> sum the per-frame rows
  const total = new Array(NC * 10).fill(0);
  if (dumps.size) for (const r of perFrame) for (let k = 0; k < NC * 10; k++) total[k] += r[k + 1];
  else perFrame[perFrame.length - 1].slice(1).forEach((v, k) => { total[k] = v; });
  const res: Record<string, Record<string, number>> = {};
  CHANNELS.forEach((c, ci) => {
    const v = total.slice(ci * 10, ci * 10 + 10);
    res[c] = { TP: v[0], FP: v[1], FN: v[2], TN: v[3], TPi: v[4], FPi: v[5], FNi: v[6], TNi: v[7], hard: v[8], FNhard: v[9] };
  });
  return { W, H, frames: src.frames, channels: res, pngs };
}

/** Cost of the guides stage alone at W x H (warm GPU, median of N timestamped dispatches). */
async function runBench(device: GPUDevice, W: number, H: number, n: number) {
  const scene = new SceneSignals(device, W, H, 'blue');
  await scene.init();
  const path = pathById('pan')!;
  scene.render(10, path.at(10), path.at(9), { reset: false });
  const ug = new UpscalerGuides(device, W, H);
  const qs = device.createQuerySet({ type: 'timestamp', count: 2 });
  const res = device.createBuffer({ size: 16, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC });
  const rb = device.createBuffer({ size: 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const warm = device.createComputePipeline({ layout: 'auto', compute: { module: device.createShaderModule({ code: `@group(0) @binding(0) var<storage, read_write> b: array<f32>;
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id: vec3u) { var x = f32(id.x) * 1e-6; for (var i = 0u; i < 512u; i++) { x = fma(x, 0.999, 1e-4); } b[id.x & 65535u] = x; }` }), entryPoint: 'main' } });
  const wb = device.createBuffer({ size: 65536 * 4, usage: GPUBufferUsage.STORAGE });
  const wbg = device.createBindGroup({ layout: warm.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: wb } }] });
  // depth conversion once (a renderer already has hardware depth)
  { const e = device.createCommandEncoder(); ug.encode(e, scene.textures.depth, scene.textures.motion, NEAR, FAR); device.queue.submit([e.finish()]); }
  const ms: number[] = [];
  for (let i = 0; i < n; i++) {
    // warm-up in its own submit (as the replay's GpuWarmer): a timestamped pass right behind heavy passes in the
    // same command buffer reads their tail on Apple GPUs
    const ew = device.createCommandEncoder();
    for (let k = 0; k < 8; k++) { const wp = ew.beginComputePass(); wp.setPipeline(warm); wp.setBindGroup(0, wbg); wp.dispatchWorkgroups(16384); wp.end(); }
    device.queue.submit([ew.finish()]);
    await device.queue.onSubmittedWorkDone();
    const e = device.createCommandEncoder();
    ug.encodeReconstruct(e, scene.textures.motion, NEAR, FAR, { querySet: qs, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 });
    e.resolveQuerySet(qs, 0, 2, res, 0);
    e.copyBufferToBuffer(res, 0, rb, 0, 16);
    device.queue.submit([e.finish()]);
    await rb.mapAsync(GPUMapMode.READ);
    const t = new BigUint64Array(rb.getMappedRange().slice(0));
    rb.unmap();
    ms.push(Number(t[1] - t[0]) / 1e6);
  }
  ms.sort((a, b) => a - b);
  // our filters' whole temporal passes (detection + history fetch + blend), same frame, for scale
  const t = scene.textures;
  const guides = { depth: t.depth, normal: t.normal, motion: t.motion, roughness: t.roughness, albedo: t.albedo, viewZ: t.viewz, motionZ: t.motionZ };
  const cam = scene.camera(path.at(10), path.at(9));
  const dens: [string, { dispatch: () => void; gpuTimings?: ReadonlyMap<string, number> }][] = [];
  for (const [name, o] of [['svgf', {}], ['recurrent', { filter: 'recurrent' }]] as const) {
    const d = new DiffuseDenoiser(device, o as never); d.configure({ width: W, height: H });
    dens.push([name, { dispatch: () => d.dispatch({ radiance: t.diffuse, hitDistance: t.diffuseHitT }, guides, cam), get gpuTimings() { return d.gpuTimings as ReadonlyMap<string, number>; } }]);
  }
  { const d = new ShadowDenoiser(device); d.configure({ width: W, height: H });
    const light: ShadowLight = { type: 'sphere', position: path.at(10).light.pos, radius: path.at(10).light.radius };
    dens.push(['shadows', { dispatch: () => d.dispatch({ visibility: t.visibility, hitDistance: t.occluderDist, light }, guides, cam), get gpuTimings() { return d.gpuTimings as ReadonlyMap<string, number>; } }]); }
  const ours: Record<string, Record<string, number>> = {};
  for (const [name, d] of dens) {
    const acc: Record<string, number[]> = {};
    for (let i = 0; i < 60; i++) {
      const e = device.createCommandEncoder();
      for (let k = 0; k < 8; k++) { const wp = e.beginComputePass(); wp.setPipeline(warm); wp.setBindGroup(0, wbg); wp.dispatchWorkgroups(16384); wp.end(); }
      device.queue.submit([e.finish()]);
      d.dispatch();
      await device.queue.onSubmittedWorkDone();
      await new Promise((r) => setTimeout(r, 0));
      if (i >= 10) for (const [k, v] of d.gpuTimings ?? []) (acc[k] ??= []).push(v);
    }
    ours[name] = Object.fromEntries(Object.entries(acc).map(([k, v]) => [k, v.sort((a, b) => a - b)[Math.floor(v.length / 2)]]));
  }
  return { W, H, n, median: ms[Math.floor(n / 2)], min: ms[0], p90: ms[Math.floor(n * 0.9)], ours };
}

async function main() {
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('no adapter');
  const device = await adapter.requestDevice({
    requiredFeatures: adapter.features.has('timestamp-query') ? ['timestamp-query'] : [],
    requiredLimits: { maxStorageTexturesPerShaderStage: Math.min(8, adapter.limits.maxStorageTexturesPerShaderStage) },
  });
  device.addEventListener('uncapturederror', (e) => { const m = (e as GPUUncapturedErrorEvent).error.message; log('GPU error', m); state.error = m; });
  const mode = q.get('mode') ?? 'live';
  const W = Number(q.get('w') ?? 960), H = Number(q.get('h') ?? 540);
  const frames = Number(q.get('frames') ?? 96), start = Number(q.get('start') ?? 0);
  const dumps = new Set((q.get('dump') ?? '').split(',').filter(Boolean).map(Number));
  if (mode === 'bench') {
    state.results = await runBench(device, W, H, Number(q.get('n') ?? 200));
  } else {
    const src = mode === 'capture'
      ? await captureSource(device, q.get('capture')!, frames, start)
      : await liveSource(device, q.get('path') ?? 'pan', W, H, frames, start);
    state.results = await runScore(device, src, dumps);
  }
  state.ready = true;
}

main().catch((e) => { console.error(e); state.error = String(e?.stack ?? e); });
