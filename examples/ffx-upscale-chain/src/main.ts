// Denoiser -> upscaler chain (one GPUDevice shared by three.js, the FFX denoisers and @pmndrs/upscaler).
//
// A jittered low-res render (analytic ray-traced scene, 1-spp soft shadows or glossy reflections) goes through
// an FFX denoiser, is composed with the colour (colour = ambient + lit * shadow + K * reflection) and upscaled
// by @pmndrs/upscaler. In `mode=eval` the output is scored against a supersampled NATIVE-resolution render of
// the same frame; in `mode=view` (default) you see output | error | native live.
//
//   ?sig=shadows|reflections          which stochastic signal the denoiser handles
//   &cond=oracle      converged signal at the jittered sample position (upper bound for any denoiser)
//         noisy       raw 1-spp signal straight into the upscaler (no denoiser)
//         ignore      FFX denoiser, jitter not told (default; the recommended chain)
//         compensate  FFX denoiser reprojects with jitter - prevJitter
//         centroid    FFX denoiser reprojects with jitter (history centred at 0)
//         decoupled   FFX denoiser runs entirely on an UNJITTERED lattice; colour/depth/velocity stay jittered
//   &static=1 static camera   &speed=3 camera speed multiplier   &movers=1 spheres 0/2/3 orbit (value = speed)
//   &ujitter=0 upscaler jitter off   &rw=640&rh=360&ratio=2   &mode=eval&frames=120&refspp=64   &err=6 (view gain)
import * as THREE from 'three/webgpu';
import { Upscaler } from '@pmndrs/upscaler';
import * as FFX from '@pmndrs/denoiser-ffx';
import type { FrameCamera } from '@pmndrs/denoiser-ffx';
import { camState, cameraAt, CUT, FAR, NEAR, FOVY, mul, invert } from '../../ffx-denoiser/src/camera';
import { METRICS_WGSL, VIEW_WGSL } from '../../ffx-denoiser/src/eval';
import { CHAIN_SCENE_WGSL, COMPOSE_WGSL, DEPTH_COPY_WGSL } from './chain';

const q = new URLSearchParams(location.search);
const SIG = (q.get('sig') ?? 'shadows') as 'shadows' | 'reflections';
const COND = (q.get('cond') ?? 'ignore') as 'oracle' | 'noisy' | 'ignore' | 'compensate' | 'centroid' | 'decoupled';
const MODE = q.get('mode') ?? 'view';
const STATIC = q.get('static') === '1';
const SPEED = Number(q.get('speed') ?? 1);
const MOVERS = Number(q.get('movers') ?? 0);
const UJITTER = q.get('ujitter') !== '0';
const RW = Number(q.get('rw') ?? 640), RH = Number(q.get('rh') ?? 360);
const RATIO = Number(q.get('ratio') ?? 2);
const DW = Math.round(RW * RATIO), DH = Math.round(RH * RATIO);
const FRAMES = Number(q.get('frames') ?? 120);
const REFSPP = Number(q.get('refspp') ?? (MODE === 'view' ? 16 : 64));
const ERR_GAIN = Number(q.get('err') ?? 6);
const SETTLE = 32; // frames after a history reset before a frame counts as settled

const status = document.querySelector<HTMLPreElement>('#status')!;
const log = (s: string) => { status.textContent += s + '\n'; };
type State = { ready: boolean; error?: string; results?: unknown; frame?: number };
const out: State = { ready: false };
(window as unknown as { __ffx: State }).__ffx = out;

async function main() {
  const adapter = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('WebGPU unavailable');
  const device = await adapter.requestDevice({
    requiredFeatures: [...adapter.features] as GPUFeatureName[],
    requiredLimits: { maxStorageTexturesPerShaderStage: Math.min(8, adapter.limits.maxStorageTexturesPerShaderStage) },
  });
  device.addEventListener('uncapturederror', (e) => {
    const msg = (e as GPUUncapturedErrorEvent).error.message;
    console.error(msg); out.error ??= msg; log('GPU error: ' + msg);
  });
  const renderer = new THREE.WebGPURenderer({ device, antialias: false });
  await renderer.init();
  type Backend = { get(t: THREE.Texture): { texture: GPUTexture } };
  const backend = (renderer as unknown as { backend: Backend }).backend;
  const backendGet = (t: THREE.Texture) => backend.get(t)?.texture;
  log(`sig=${SIG} cond=${COND} static=${STATIC} speed=${SPEED} movers=${MOVERS} ujitter=${UJITTER} render ${RW}x${RH} -> display ${DW}x${DH}`);

  //* Textures ===============================================================
  const USAGE = GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST;
  const tex = (format: GPUTextureFormat, label: string, w = RW, h = RH) => device.createTexture({ label, size: [w, h], format, usage: USAGE });
  const threeStorage = (w: number, h: number) => {
    const t = new THREE.StorageTexture(w, h);
    t.type = THREE.HalfFloatType; t.colorSpace = THREE.NoColorSpace; t.generateMipmaps = false;
    t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter;
    renderer.initTexture(t);
    return t;
  };
  const colorTex = threeStorage(RW, RH), velocityTex = threeStorage(RW, RH);
  const colorGpu = backendGet(colorTex), velocityGpu = backendGet(velocityTex);
  const gset = (motion?: GPUTexture) => ({
    depth: tex('r32float', 'depth'), normal: tex('rgba16float', 'normal'), motion: motion ?? tex('rgba16float', 'motion'),
    rough: tex('r32float', 'rough'), vis: tex('r32float', 'vis'), hit: tex('r32float', 'hit'), rad: tex('rgba16float', 'rad'),
  });
  const J = gset(velocityGpu); // jittered render's G-buffer + signal (the motion texture IS the upscaler's velocity input)
  const U = gset(); // unjittered lattice (decoupled mode)
  const lit = tex('rgba16float', 'lit'), amb = tex('rgba16float', 'amb'), refVis = tex('r32float', 'refVis');
  const refRad = tex('rgba16float', 'refRad'), zero = tex('rgba16float', 'zero');
  const nat = tex('rgba16float', 'native', DW, DH), natDepth = tex('r32float', 'nativeDepth', DW, DH), natPen = tex('r32float', 'nativeMask', DW, DH);

  // depth32float attachment the upscaler samples as texture_depth_2d
  const depthTex = new THREE.DepthTexture(RW, RH);
  depthTex.type = THREE.FloatType;
  renderer.initTexture(depthTex);
  let depthGpu = backendGet(depthTex);
  if (!(depthGpu.usage & GPUTextureUsage.RENDER_ATTACHMENT)) {
    depthGpu = device.createTexture({ label: 'depth', size: [RW, RH], format: 'depth32float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC });
    backend.get(depthTex).texture = depthGpu;
  }

  //* Pipelines ==============================================================
  const mkModule = async (code: string, label: string) => {
    const m = device.createShaderModule({ label, code });
    for (const x of (await m.getCompilationInfo()).messages) if (x.type === 'error') throw new Error(`${label} WGSL: ${x.message} @${x.lineNum}`);
    return m;
  };
  const sceneModule = await mkModule(CHAIN_SCENE_WGSL, 'chain scene');
  const pipe = (entryPoint: string) => device.createComputePipeline({ layout: 'auto', compute: { module: sceneModule, entryPoint } });
  const pNoisy = pipe('noisy'), pRef = pipe('reference'), pShade = pipe('shade'), pNat = pipe('nativeRef');
  const pCompose = device.createComputePipeline({ layout: 'auto', compute: { module: await mkModule(COMPOSE_WGSL, 'compose'), entryPoint: 'main' } });
  const depthModule = await mkModule(DEPTH_COPY_WGSL, 'depth copy');
  const pDepth = device.createRenderPipeline({
    layout: 'auto',
    vertex: { module: depthModule, entryPoint: 'vs' },
    fragment: { module: depthModule, entryPoint: 'fs', targets: [] },
    depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'always' },
  });

  const ubuf = () => device.createBuffer({ size: 256, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const uJ = ubuf(), uU = ubuf(), uN = ubuf();
  const bg = (p: GPUComputePipeline, res: Record<number, GPUBuffer | GPUTexture>) => device.createBindGroup({
    layout: p.getBindGroupLayout(0),
    entries: Object.entries(res).map(([b, r]) => ({ binding: Number(b), resource: r instanceof GPUBuffer ? { buffer: r } : r.createView() })),
  });
  const gbg = (u: GPUBuffer, s: typeof J) => bg(pNoisy, { 0: u, 1: s.depth, 2: s.normal, 3: s.motion, 4: s.rough, 5: s.vis, 6: s.hit, 13: s.rad });
  const bgNoisyJ = gbg(uJ, J), bgNoisyU = gbg(uU, U);
  const bgRef = bg(pRef, { 0: uJ, 7: refVis, 14: refRad });
  const bgShade = bg(pShade, { 0: uJ, 8: lit, 9: amb });
  const bgNat = bg(pNat, { 0: uN, 10: nat, 11: natDepth, 12: natPen });
  const bgDepth = device.createBindGroup({ layout: pDepth.getBindGroupLayout(0), entries: [{ binding: 0, resource: J.depth.createView() }] });

  //* Denoiser + upscaler ====================================================
  const compensate = COND === 'compensate' || COND === 'centroid';
  const useDenoiser = COND === 'ignore' || COND === 'compensate' || COND === 'centroid' || COND === 'decoupled';
  const denoiser = !useDenoiser ? undefined
    : SIG === 'shadows' ? new FFX.FfxShadowDenoiser(device, { timestamps: false, compensateJitter: compensate })
      : new FFX.FfxReflectionDenoiser(device, {
        timestamps: false,
        compensateJitter: compensate,
        ...(q.has('stats') ? { currentFrameStatistics: q.get('stats') === 'current' } : {}),
        ...(q.has('tsf') ? { temporalStabilityFactor: Number(q.get('tsf')) } : {}),
        ...(q.has('rthresh') ? { roughnessThreshold: Number(q.get('rthresh')) } : {}),
      });
  denoiser?.configure({ width: RW, height: RH });
  const upscaler = new Upscaler({ renderer });
  upscaler.configure({ displayWidth: DW, displayHeight: DH, renderWidth: RW, renderHeight: RH, path: 'temporal', jitter: UJITTER });
  await upscaler.init();
  const upscaledGpu = () => backendGet(upscaler.outputTexture);
  const cam3 = new THREE.PerspectiveCamera((FOVY * 180) / Math.PI, RW / RH, NEAR, FAR);
  log(`upscaler jitter phases: ${upscaler.jitterPhaseCount}`);

  //* Frame ==================================================================
  const aspect = RW / RH;
  const pathFrame = (f: number) => (STATIC ? 0 : f < CUT ? f * SPEED : CUT * SPEED + (f - CUT) * SPEED);
  const writeScene = (buf: GPUBuffer, f: number, c: ReturnType<typeof camState>, p: ReturnType<typeof camState>, dims: [number, number], spp: number, jit: readonly [number, number]) => {
    const b = new ArrayBuffer(256);
    const fl = new Float32Array(b), u = new Uint32Array(b);
    fl.set(invert(mul(c.proj, c.view)), 0); fl.set(mul(c.proj, c.view), 16); fl.set(mul(p.proj, p.view), 32);
    fl.set(c.eye, 48); u[51] = f; u[52] = dims[0]; u[53] = dims[1]; u[54] = spp; u[55] = 0;
    fl[56] = jit[0]; fl[57] = jit[1];
    fl[58] = f * MOVERS; fl[59] = Math.max(f - 1, 0) * MOVERS;
    u[60] = SIG === 'reflections' ? 1 : 0; u[61] = MOVERS > 0 ? 1 : 0;
    device.queue.writeBuffer(buf, 0, b);
  };
  const groups = (w: number, h: number): [number, number] => [Math.ceil(w / 8), Math.ceil(h / 8)];

  /** Renders + denoises + composes + upscales frame `f` (and the native reference); results sit in textures. */
  const runFrame = (f: number) => {
    const reset = f === 0 || f === CUT;
    const c = camState(pathFrame(f), aspect), p = camState(pathFrame(Math.max(f - 1, 0)), aspect);
    const ce = cameraAt(pathFrame(f));
    cam3.position.set(...ce.eye); cam3.lookAt(...ce.target); cam3.updateMatrixWorld(true);

    if (reset) { upscaler.resetHistory(); denoiser?.resetHistory(); }
    upscaler.beginFrame(cam3);
    const jc: [number, number] = [upscaler.jitter.x, upscaler.jitter.y];
    const jp: [number, number] = reset ? jc : [upscaler.jitterPrevious.x, upscaler.jitterPrevious.y];
    upscaler.endFrame(cam3);

    writeScene(uJ, f, c, p, [RW, RH], REFSPP, jc);
    writeScene(uU, f, c, p, [RW, RH], REFSPP, [0, 0]);
    writeScene(uN, f, c, p, [DW, DH], REFSPP, [0, 0]);

    const enc = device.createCommandEncoder();
    const pass = enc.beginComputePass();
    const [gx, gy] = groups(RW, RH);
    pass.setPipeline(pNoisy); pass.setBindGroup(0, bgNoisyJ); pass.dispatchWorkgroups(gx, gy);
    if (COND === 'decoupled') { pass.setBindGroup(0, bgNoisyU); pass.dispatchWorkgroups(gx, gy); }
    // shadows: oracle visibility is the cond; reflections: shadows are always the oracle, the reflection is the cond
    if (COND === 'oracle' || SIG === 'reflections') { pass.setPipeline(pRef); pass.setBindGroup(0, bgRef); pass.dispatchWorkgroups(gx, gy); }
    pass.setPipeline(pShade); pass.setBindGroup(0, bgShade); pass.dispatchWorkgroups(gx, gy);
    const [nx, ny] = groups(DW, DH);
    pass.setPipeline(pNat); pass.setBindGroup(0, bgNat); pass.dispatchWorkgroups(nx, ny);
    pass.end();
    const dp = enc.beginRenderPass({
      colorAttachments: [],
      depthStencilAttachment: { view: depthGpu.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' },
    });
    dp.setPipeline(pDepth); dp.setBindGroup(0, bgDepth); dp.draw(3); dp.end();
    device.queue.submit([enc.finish()]);

    // the stochastic term for this frame
    let signal: GPUTexture;
    if (COND === 'oracle') signal = SIG === 'shadows' ? refVis : refRad;
    else if (COND === 'noisy') signal = SIG === 'shadows' ? J.vis : J.rad;
    else {
      const s = COND === 'decoupled' ? U : J;
      const cam: FrameCamera = { view: c.view, projection: c.proj, prevView: p.view, prevProjection: p.proj, near: NEAR, far: FAR, position: c.eye };
      if (COND === 'compensate') { cam.jitter = jc; cam.prevJitter = jp; }
      else if (COND === 'centroid') { cam.jitter = jc; cam.prevJitter = [0, 0]; }
      const inputs = SIG === 'shadows' ? { visibility: s.vis, hitDistance: s.hit } : { radiance: s.rad, hitDistance: s.hit };
      signal = denoiser!.dispatch(inputs as never, { depth: s.depth, normal: s.normal, motion: s.motion, roughness: s.rough }, cam);
    }
    const visTex = SIG === 'shadows' ? signal : refVis;
    const reflTex = SIG === 'shadows' ? zero : signal;

    const enc2 = device.createCommandEncoder();
    const cp = enc2.beginComputePass();
    cp.setPipeline(pCompose);
    cp.setBindGroup(0, bg(pCompose, { 0: lit, 1: amb, 2: visTex, 3: colorGpu, 4: reflTex }));
    cp.dispatchWorkgroups(gx, gy);
    cp.end();
    device.queue.submit([enc2.finish()]);

    upscaler.dispatch({ color: colorTex, depth: depthTex, velocity: velocityTex, deltaTime: 1 / 60 }, cam3);
    out.frame = f;
  };

  if (MODE === 'eval') {
    //* Metrics (display res, HDR tonemapped, receivers only) ================
    const metricsPipe = device.createComputePipeline({ layout: 'auto', compute: { module: await mkModule(METRICS_WGSL, 'metrics'), entryPoint: 'main' } });
    const eN = tex('r32float', 'eN', DW, DH), eD = tex('r32float', 'eD', DW, DH);
    const eN2 = tex('r32float', 'eN2', DW, DH), eD2 = tex('r32float', 'eD2', DW, DH);
    const wgX = Math.ceil(DW / 16), wgY = Math.ceil(DH / 16);
    const partials = device.createBuffer({ size: wgX * wgY * 48, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    const readback = device.createBuffer({ size: wgX * wgY * 48, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const metricsU = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const score = async (img: GPUTexture, validPrev: boolean, depthMask: GPUTexture = natDepth, en = eN, ed = eD) => {
      device.queue.writeBuffer(metricsU, 0, new Uint32Array([DW, DH, 1, validPrev ? 1 : 0]));
      const g = device.createBindGroup({
        layout: metricsPipe.getBindGroupLayout(0),
        entries: [metricsU, img, img, nat, depthMask, en, ed, partials].map((r, i) => ({ binding: i, resource: r instanceof GPUBuffer ? { buffer: r } : r.createView() })),
      });
      const enc = device.createCommandEncoder();
      const pass = enc.beginComputePass();
      pass.setPipeline(metricsPipe); pass.setBindGroup(0, g); pass.dispatchWorkgroups(wgX, wgY); pass.end();
      enc.copyBufferToBuffer(partials, 0, readback, 0, partials.size);
      device.queue.submit([enc.finish()]);
      await readback.mapAsync(GPUMapMode.READ);
      const a = new Float32Array(readback.getMappedRange());
      const s = new Float64Array(12);
      for (let i = 0; i < a.length; i += 12) for (let k = 0; k < 12; k++) s[k] += a[i + k];
      readback.unmap();
      const n = s[4], nf = s[5];
      return { psnr: n ? 10 * Math.log10(1 / Math.max(s[1] / n, 1e-12)) : NaN, flicker: nf ? s[3] / nf : NaN, nonFinite: s[7], pixels: n, bias: s[10] ? s[11] / s[10] : NaN };
    };

    const perFrame: { psnr: number; flicker: number; pen: number; penFlicker: number; penPixels: number; penBias: number }[] = [];
    let nonFinite = 0;
    for (let f = 0; f < FRAMES; f++) {
      runFrame(f);
      const base = await score(upscaledGpu(), f !== 0 && f !== CUT);
      const pen = await score(upscaledGpu(), f !== 0 && f !== CUT, natPen, eN2, eD2);
      const r = { ...base, pen: pen.psnr, penFlicker: pen.flicker, penPixels: pen.pixels, penBias: pen.bias };
      perFrame.push(r);
      nonFinite += r.nonFinite;
      if (f % 20 === 0 || f === FRAMES - 1) log(`frame ${f}: ${r.psnr.toFixed(2)} dB (mask ${r.pen.toFixed(2)} dB) flicker ${r.flicker.toFixed(4)}`);
    }
    const mean = (xs: number[]) => { const v = xs.filter(Number.isFinite); return v.reduce((a, b) => a + b, 0) / v.length; }; // frames with an empty mask are skipped
    const settled = perFrame.filter((_, f) => !(f < SETTLE || (f >= CUT && f < CUT + SETTLE)));
    const flick = settled.filter((r) => !Number.isNaN(r.flicker));
    out.results = {
      sig: SIG, cond: COND, static: STATIC, speed: SPEED, movers: MOVERS, ujitter: UJITTER, render: [RW, RH], display: [DW, DH], phases: upscaler.jitterPhaseCount,
      psnrSettled: mean(settled.map((r) => r.psnr)),
      psnrAll: mean(perFrame.map((r) => r.psnr)),
      flickerSettled: mean(flick.map((r) => r.flicker)),
      // masked: shadows = native penumbra pixels; reflections = pixels whose native reflection luma > 0.1
      psnrMaskSettled: mean(settled.map((r) => r.pen)),
      flickerMaskSettled: mean(flick.map((r) => r.penFlicker)),
      // mean signed (output - native) error in the mask, tonemapped: negative = too dark
      biasMaskSettled: mean(settled.map((r) => r.penBias)),
      maskFraction: mean(settled.map((r) => r.penPixels)) / (DW * DH),
      psnrMaskAfterCut: perFrame[CUT]?.pen, psnrMaskFirst: perFrame[0].pen,
      psnrAfterCut: perFrame[CUT]?.psnr, nonFinite,
      perFrame: perFrame.map((r) => [+r.psnr.toFixed(3), +r.flicker.toFixed(5), +r.pen.toFixed(3), +r.penFlicker.toFixed(5)]),
    };
    log(JSON.stringify({ ...(out.results as object), perFrame: undefined }, null, 1));
    out.ready = true;
    return;
  }

  //* View: upscaled output | error vs native | native =========================
  const canvases = [...document.querySelectorAll<HTMLCanvasElement>('canvas.panel')];
  const panelW = Math.max(200, Math.min(640, Math.round(canvases[0].clientWidth || 640)));
  const panelH = Math.round(panelW * DH / DW);
  const fmt = navigator.gpu.getPreferredCanvasFormat();
  const ctxs = canvases.map((c) => {
    c.width = panelW; c.height = panelH;
    const cx = c.getContext('webgpu')!;
    cx.configure({ device, format: fmt });
    return cx;
  });
  const viewModule = await mkModule(VIEW_WGSL, 'view');
  const viewPipe = device.createRenderPipeline({
    layout: 'auto', vertex: { module: viewModule, entryPoint: 'vs' },
    fragment: { module: viewModule, entryPoint: 'fs', targets: [{ format: fmt }] },
  });
  const viewUs = canvases.map(() => device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }));
  const show = () => {
    const img = upscaledGpu();
    const enc = device.createCommandEncoder();
    canvases.forEach((canvas, panel) => {
      const b = new ArrayBuffer(32);
      new Float32Array(b).set([canvas.width, canvas.height, DW, DH]);
      new Uint32Array(b)[4] = 1; // HDR rgb, tonemapped
      new Float32Array(b)[5] = 1;
      new Float32Array(b)[6] = ERR_GAIN; // error heat-map gain for the middle panel
      new Float32Array(b)[7] = panel;
      device.queue.writeBuffer(viewUs[panel], 0, b);
      const g = device.createBindGroup({
        layout: viewPipe.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: viewUs[panel] } }, ...[img, img, nat].map((t, i) => ({ binding: i + 1, resource: t.createView() }))],
      });
      const rp = enc.beginRenderPass({ colorAttachments: [{ view: ctxs[panel].getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] });
      rp.setPipeline(viewPipe); rp.setBindGroup(0, g); rp.draw(3); rp.end();
    });
    device.queue.submit([enc.finish()]);
  };
  const STOP_AT = q.has('stopAt') ? Number(q.get('stopAt')) : -1;
  const info = document.querySelector<HTMLElement>('#pathinfo');
  let f = 0;
  const tick = () => {
    runFrame(f);
    show();
    if (info) info.textContent = `frame ${f + 1}/${FRAMES}`;
    if (f === STOP_AT) { device.queue.onSubmittedWorkDone().then(() => { out.ready = true; }); return; }
    f = (f + 1) % FRAMES;
    requestAnimationFrame(tick);
  };
  out.ready = STOP_AT < 0;
  tick();
}

main().catch((e) => {
  console.error(e);
  out.error = String(e?.stack ?? e);
  log('ERROR: ' + out.error);
});
