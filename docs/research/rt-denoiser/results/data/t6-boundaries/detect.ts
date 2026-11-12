// Disocclusion detection of our filters vs exact ground truth, with option variants (results/T6-boundaries.md,
// review target 6). Derived from ../upscaler-guides/main.ts (same GT: the analytic test bed re-traced at t-1 with the
// moving sphere at its t-1 pose; BVH ray casts on the three-temporal captures), without the upscaler mask, and with any
// number of detector configurations:
//
//   det=<entry>,<entry>,...   entry = kind[@key=value]... ; kind: svgf (DiffuseDenoiser, antiLag 'off': the pure
//                             geometry test), svgf-auto, recurrent (DiffuseDenoiser filter 'recurrent'), shadows
//                             (ShadowDenoiser); values: numbers, true / false, strings
//   e.g. det=svgf,svgf@normalThreshold=0.8,svgf@historyFallback=off,recurrent,recurrent@normalThreshold=0.5,shadows
//
// "Detected" = the filter's own history age after the frame is 0 (SVGF accum.a == 1, recurrent A == 0, shadows A == 0).
// Counts per detector: TP / FP / FN / TN over receivers (reset frames excluded), the same over interior pixels (3x3 GT
// uniform), and (live) the wrong-surface class: GT-disoccluded with no same-object texel in the 3x3 around the true
// reprojection ("hard"; any history kept there belongs to another surface) and how many of those were missed.
// window.__ug = { ready, results } (driver: ../upscaler-guides/run.mjs --port=<p>).
import { SceneSignals } from '../../../../../../examples/realtime-denoiser/src/signals';
import { pathById, isReset, type FrameState } from '../../../../../../examples/realtime-denoiser/src/paths';
import { sceneWgsl } from '../../../../../../examples/realtime-denoiser/src/scene';
import { NEAR, FAR } from '../../../../../../examples/realtime-denoiser/src/camera';
import { DiffuseDenoiser, ShadowDenoiser } from '../../../../../../packages/denoiser-realtime/src/index';
import type { FrameCamera, FrameGuides, ShadowLight } from '../../../../../../packages/denoiser-realtime/src/index';
import { CaptureTextures, loadManifest } from '../../../../../../tools/rt-capture/src/replay';
import { CaptureClient, frameDir, toFrameCamera } from '../../../../../../tools/rt-capture/src/format';
import { shadowLightOf } from '../../../../../../tools/rt-capture/src/denoisers';
import { BvhGroundTruth } from '../upscaler-guides/gt-bvh';

const q = new URLSearchParams(location.search);
const state: Record<string, unknown> = { ready: false };
(window as unknown as { __ug: unknown }).__ug = state;
const log = (...a: unknown[]) => { console.log(...a); (state.log as string[] | undefined)?.push(a.join(' ')); };
state.log = [];

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


// ---- detectors ------------------------------------------------------------------------------------------------------
type Kind = 'svgf' | 'svgf-auto' | 'recurrent' | 'shadows';
interface Det { name: string; kind: Kind; opts: Record<string, unknown> }
function parseDets(s: string): Det[] {
  return s.split(',').filter(Boolean).map((e) => {
    const [kind, ...kv] = e.split('@');
    const opts: Record<string, unknown> = {};
    for (const p of kv) {
      const [k, v] = p.split('=');
      opts[k] = v === 'true' ? true : v === 'false' ? false : Number.isNaN(Number(v)) ? v : Number(v);
    }
    if (!['svgf', 'svgf-auto', 'recurrent', 'shadows'].includes(kind)) throw new Error(`unknown detector kind ${kind}`);
    return { name: e, kind: kind as Kind, opts };
  });
}

const markWgsl = (mode: 0 | 1 | 2) => /* wgsl */ `
struct U { dims: vec2u, bit: u32, _p: u32, youngBase: f32, _a: f32, _b: f32, _c: f32 };
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var t: texture_2d<${mode === 1 ? 'u32' : 'f32'}>;
@group(0) @binding(2) var<storage, read_write> bits: array<u32>;
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= u.dims)) { return; }
  let p = vec2i(id.xy);
  ${mode === 0 ? 'let det = textureLoad(t, p, 0).a < 1.5;'
    : mode === 1 ? 'let det = (textureLoad(t, p, 0).r & 1023u) == 0u;'
    : 'let z = textureLoad(t, p, 0).z;\n  let det = (z - u.youngBase * floor(z / u.youngBase)) < 0.5;'}
  let i = id.y * u.dims.x + id.x;
  if (u.bit == 0u) { bits[i] = 0u; }
  if (det) { bits[i] = bits[i] | (1u << u.bit); }
}
`;

const SCORE = /* wgsl */ `
struct S { dims: vec2u, nc: u32, scoreFrame: u32, hasId: u32, _a: u32, _b: u32, _c: u32 };
@group(0) @binding(0) var<uniform> s: S;
@group(0) @binding(1) var t_gt: texture_2d<f32>;
@group(0) @binding(2) var<storage, read> bits: array<u32>;
@group(0) @binding(3) var<storage, read_write> counts: array<atomic<u32>>;
@group(0) @binding(4) var t_idCur: texture_2d<f32>;
@group(0) @binding(5) var t_idPrev: texture_2d<f32>;
@group(0) @binding(6) var t_motion: texture_2d<f32>;
fn gtAt(p: vec2i) -> f32 { return textureLoad(t_gt, clamp(p, vec2i(0), vec2i(s.dims) - 1), 0).r; }
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= s.dims)) { return; }
  let p = vec2i(id.xy);
  let g = gtAt(p);
  if (g < 0.0 || s.scoreFrame == 0u) { return; }
  let b = bits[id.y * s.dims.x + id.x];
  let pos = g > 0.5;
  var hard = false;
  if (pos && s.hasId != 0u) {
    let idc = textureLoad(t_idCur, p, 0).r;
    let mv = textureLoad(t_motion, p, 0).xy;
    let pp = vec2f(p) + 0.5 - vec2f(mv.x, -mv.y) * 0.5 * vec2f(s.dims) - 0.5;
    let c = vec2i(floor(pp + 0.5));
    hard = true;
    for (var k = 0; k < 9; k++) {
      let qq = c + vec2i(k % 3 - 1, k / 3 - 1);
      if (all(qq >= vec2i(0)) && all(qq < vec2i(s.dims)) && textureLoad(t_idPrev, qq, 0).r == idc) { hard = false; }
    }
  }
  var interior = true;
  for (var dy = -1; dy <= 1; dy++) { for (var dx = -1; dx <= 1; dx++) { if (gtAt(p + vec2i(dx, dy)) != g) { interior = false; } } }
  for (var c = 0u; c < s.nc; c++) {
    let det = ((b >> c) & 1u) != 0u;
    let k = select(select(3u, 1u, det), select(2u, 0u, det), pos);
    atomicAdd(&counts[c * 10u + k], 1u);
    if (interior) { atomicAdd(&counts[c * 10u + 4u + k], 1u); }
    if (hard) { atomicAdd(&counts[c * 10u + 8u], 1u); if (!det) { atomicAdd(&counts[c * 10u + 9u], 1u); } }
  }
}
`;

async function runScore(device: GPUDevice, src: Source, dets: Det[]) {
  const { W, H } = src;
  if (dets.length > 32) throw new Error('max 32 detectors');
  type Inst = { det: Det; dispatch: (fr: Awaited<ReturnType<Source['frame']>>) => void; tex: () => GPUTexture; mode: 0 | 1 | 2; youngBase: number };
  const inst: Inst[] = dets.map((det) => {
    if (det.kind === 'shadows') {
      const sh = new ShadowDenoiser(device, { timestamps: false, ...det.opts } as never);
      sh.configure({ width: W, height: H });
      const youngBase = Math.max(32, 2 ** Math.ceil(Math.log2((sh.options as { maxHistory: number }).maxHistory + 2)));
      return { det, mode: 2, youngBase, tex: () => sh.debugTexture('history')!, dispatch: (fr) => sh.dispatch({ ...fr.visibility, ...(fr.light ? { light: fr.light } : {}) }, fr.guides, fr.camera) };
    }
    const o = det.kind === 'recurrent' ? { filter: 'recurrent', ...det.opts } : { antiLag: det.kind === 'svgf' ? 'off' : 'auto', ...det.opts };
    const d = new DiffuseDenoiser(device, { ...o, timestamps: false } as never);
    d.configure({ width: W, height: H });
    return det.kind === 'recurrent'
      ? { det, mode: 1, youngBase: 0, tex: () => d.debugTexture('data')!, dispatch: (fr) => d.dispatch(fr.diffuse, fr.guides, fr.camera) }
      : { det, mode: 0, youngBase: 0, tex: () => d.debugTexture('accum')!, dispatch: (fr) => d.dispatch(fr.diffuse, fr.guides, fr.camera) };
  });
  const markPipes = ([0, 1, 2] as const).map((m) => device.createComputePipeline({ label: `mark${m}`, layout: 'auto', compute: { module: device.createShaderModule({ code: markWgsl(m) }), entryPoint: 'main' } }));
  const mu = inst.map(() => device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }));
  const bits = device.createBuffer({ size: W * H * 4, usage: GPUBufferUsage.STORAGE });
  const gtTex = device.createTexture({ size: [W, H], format: 'r32float', usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  const NC = inst.length;
  const counts = device.createBuffer({ size: NC * 10 * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });
  const rb = device.createBuffer({ size: NC * 10 * 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const su = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const sp = device.createComputePipeline({ label: 'score', layout: 'auto', compute: { module: device.createShaderModule({ code: SCORE }), entryPoint: 'main' } });
  const perFrame: number[][] = [];
  for (let i = 0; i < src.frames; i++) {
    const fr = await src.frame(i);
    for (const x of inst) x.dispatch(fr);
    const enc = device.createCommandEncoder();
    await src.gt(enc, gtTex, i);
    inst.forEach((x, c) => {
      const b = new ArrayBuffer(32); new Uint32Array(b).set([W, H, c, 0]); new Float32Array(b)[4] = x.youngBase;
      device.queue.writeBuffer(mu[c], 0, b);
      const pipe = markPipes[x.mode];
      const bg = device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: mu[c] } }, { binding: 1, resource: x.tex().createView() }, { binding: 2, resource: { buffer: bits } }] });
      const p = enc.beginComputePass(); p.setPipeline(pipe); p.setBindGroup(0, bg); p.dispatchWorkgroups(Math.ceil(W / 8), Math.ceil(H / 8)); p.end();
    });
    device.queue.writeBuffer(su, 0, new Uint32Array([W, H, NC, fr.reset ? 0 : 1, src.ids ? 1 : 0, 0, 0, 0]));
    const bg = device.createBindGroup({ layout: sp.getBindGroupLayout(0), entries: [
      { binding: 0, resource: { buffer: su } }, { binding: 1, resource: gtTex.createView() }, { binding: 2, resource: { buffer: bits } },
      { binding: 3, resource: { buffer: counts } },
      { binding: 4, resource: (src.ids?.().cur ?? gtTex).createView() }, { binding: 5, resource: (src.ids?.().prev ?? gtTex).createView() },
      { binding: 6, resource: fr.guides.motion.createView() },
    ] });
    const p = enc.beginComputePass({ label: 'score' });
    p.setPipeline(sp); p.setBindGroup(0, bg); p.dispatchWorkgroups(Math.ceil(W / 8), Math.ceil(H / 8)); p.end();
    device.queue.submit([enc.finish()]);
    if (i === src.frames - 1) {
      const e2 = device.createCommandEncoder(); e2.copyBufferToBuffer(counts, 0, rb, 0, NC * 40); device.queue.submit([e2.finish()]);
      await rb.mapAsync(GPUMapMode.READ);
      perFrame.push([i, ...new Uint32Array(rb.getMappedRange().slice(0))]);
      rb.unmap();
    }
    if (i % 16 === 0) log(`frame ${i}/${src.frames}`);
  }
  const total = perFrame[perFrame.length - 1].slice(1);
  const res: Record<string, Record<string, number>> = {};
  inst.forEach((x, ci) => {
    const v = total.slice(ci * 10, ci * 10 + 10);
    res[x.det.name] = { TP: v[0], FP: v[1], FN: v[2], TN: v[3], TPi: v[4], FPi: v[5], FNi: v[6], TNi: v[7], hard: v[8], FNhard: v[9] };
  });
  return { W, H, frames: src.frames, channels: res };
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
  const dets = parseDets(q.get('det') ?? 'svgf,recurrent,shadows');
  const src = mode === 'capture'
    ? await captureSource(device, q.get('capture')!, frames, start)
    : await liveSource(device, q.get('path') ?? 'pan', W, H, frames, start);
  state.results = await runScore(device, src, dets);
  state.ready = true;
}

main().catch((e) => { console.error(e); state.error = String(e?.stack ?? e); });
