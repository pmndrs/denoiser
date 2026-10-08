// FidelityFX denoiser test bed: an analytic WGSL-ray-traced scene produces the
// G-buffer, a 1-spp noisy signal and a converged reference every frame along a
// scripted camera path (with a camera cut -> resetHistory()).
//
//   ?signal=shadows|reflections
//   &mode=view    (default) animated noisy | denoised | reference panels
//   &mode=eval    120-frame path at WxH: per-frame PSNR (noisy / denoised vs
//                 reference) + flicker, results in window.__ffx
//   &mode=bench   denoiser GPU time per frame (timestamps) + wall time w/ queue sync
//   &w=1920&h=1080&frames=120&refspp=256&stopAt=N (view: freeze at frame N)
import * as FFX from '@pmndrs/denoiser-ffx';
import type { FrameCamera, TemporalDenoiser } from '@pmndrs/denoiser-ffx';
import { camState, CUT, FAR, NEAR, mul, invert } from './camera';
import { METRICS_WGSL, VIEW_WGSL } from './eval';
import { REFLECTION_SCENE_WGSL, SHADOW_SCENE_WGSL } from './scene';

const q = new URLSearchParams(location.search);
const signal = (q.get('signal') ?? 'shadows') as 'shadows' | 'reflections';
const mode = q.get('mode') ?? 'view';
const W = Number(q.get('w') ?? 1920);
const H = Number(q.get('h') ?? 1080);
const FRAMES = Number(q.get('frames') ?? 120);
const REFSPP = Number(q.get('refspp') ?? (mode === 'view' ? 64 : 256));
// baseline: reset history every frame (spatial-only) to see what the temporal part buys
const NO_HISTORY = q.get('noHistory') === '1';
// static camera (debug: isolates temporal accumulation from reprojection)
const STATIC = q.get('static') === '1';
const STOP_AT = q.has('stopAt') ? Number(q.get('stopAt')) : -1;
const status = document.querySelector<HTMLPreElement>('#status')!;
const log = (s: string) => { status.textContent += s + '\n'; };

type State = { ready: boolean; error?: string; results?: unknown; frame?: number };
const out: State = { ready: false };
(window as unknown as { __ffx: State }).__ffx = out;

async function main() {
  const adapter = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('WebGPU unavailable');
  const features: GPUFeatureName[] = [];
  if (adapter.features.has('timestamp-query')) features.push('timestamp-query');
  // the test-bed scene shader writes 6 storage textures (the denoisers need <= 4)
  const device = await adapter.requestDevice({
    requiredFeatures: features,
    requiredLimits: { maxStorageTexturesPerShaderStage: Math.min(8, adapter.limits.maxStorageTexturesPerShaderStage) },
  });
  device.addEventListener('uncapturederror', (e) => {
    const msg = (e as GPUUncapturedErrorEvent).error.message;
    console.error(msg);
    out.error ??= msg;
    log('GPU error: ' + msg);
  });
  log(`${signal} ${mode} ${W}x${H} features=[${[...device.features].join(',')}]`);

  // ---- scene textures
  const S = GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC;
  const tex = (format: GPUTextureFormat, label: string) => device.createTexture({ label, size: [W, H], format, usage: S });
  const depth = tex('r32float', 'depth');
  const normal = tex('rgba16float', 'normal');
  const motion = tex('rg32float', 'motion');
  const rough = tex('r32float', 'roughness');
  const sigFormat: GPUTextureFormat = signal === 'shadows' ? 'r32float' : 'rgba16float';
  const noisy = tex(sigFormat, 'noisy');
  const hitDist = tex('r32float', 'hitDistance');
  const reference = tex(sigFormat, 'reference');

  const sceneModule = device.createShaderModule({ code: signal === 'shadows' ? SHADOW_SCENE_WGSL : REFLECTION_SCENE_WGSL });
  const info = await sceneModule.getCompilationInfo();
  for (const m of info.messages) if (m.type === 'error') throw new Error(`scene WGSL: ${m.message} @${m.lineNum}`);
  const noisyPipe = device.createComputePipeline({ layout: 'auto', compute: { module: sceneModule, entryPoint: 'noisy' } });
  const refPipe = device.createComputePipeline({ layout: 'auto', compute: { module: sceneModule, entryPoint: 'reference' } });
  const sceneU = device.createBuffer({ size: 256, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const noisyBG = device.createBindGroup({
    layout: noisyPipe.getBindGroupLayout(0),
    entries: [sceneU, depth, normal, motion, rough, noisy, hitDist].map((r, i) => ({
      binding: i, resource: r instanceof GPUBuffer ? { buffer: r } : r.createView(),
    })),
  });
  const refBG = device.createBindGroup({
    layout: refPipe.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: sceneU } }, { binding: 7, resource: reference.createView() }],
  });

  // ---- denoiser
  let denoiser: TemporalDenoiser<object>;
  if (signal === 'shadows') {
    denoiser = new FFX.FfxShadowDenoiser(device);
  } else {
    // &stats=current|ffx (see FfxReflectionDenoiserOptions.currentFrameStatistics), &tsf=0.7
    const stats = q.get('stats');
    denoiser = new FFX.FfxReflectionDenoiser(device, {
      ...(stats ? { currentFrameStatistics: stats === 'current' } : {}),
      ...(q.has('tsf') ? { temporalStabilityFactor: Number(q.get('tsf')) } : {}),
    });
  }
  denoiser.configure({ width: W, height: H });
  const inputs = signal === 'shadows' ? { visibility: noisy, hitDistance: hitDist } : { radiance: noisy, hitDistance: hitDist };
  const guides = { depth, normal, motion, roughness: rough };

  const aspect = W / H;
  const writeScene = (frame: number, spp: number) => {
    const c = camState(STATIC ? 0 : frame, aspect);
    const p = camState(STATIC ? 0 : Math.max(frame - 1, 0), aspect);
    const vp = mul(c.proj, c.view);
    const pvp = mul(p.proj, p.view);
    const b = new ArrayBuffer(256);
    const f = new Float32Array(b), u = new Uint32Array(b);
    f.set(invert(vp), 0); f.set(vp, 16); f.set(pvp, 32);
    f.set(c.eye, 48); u[51] = frame;
    u[52] = W; u[53] = H; u[54] = spp; u[55] = 0;
    device.queue.writeBuffer(sceneU, 0, b);
    const cam: FrameCamera = {
      view: c.view, projection: c.proj, prevView: p.view, prevProjection: p.proj,
      near: NEAR, far: FAR, position: c.eye,
    };
    return cam;
  };
  const renderScene = (frame: number, withRef: boolean) => {
    const cam = writeScene(frame, REFSPP);
    const enc = device.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(noisyPipe); pass.setBindGroup(0, noisyBG);
    pass.dispatchWorkgroups(Math.ceil(W / 8), Math.ceil(H / 8));
    if (withRef) { pass.setPipeline(refPipe); pass.setBindGroup(0, refBG); pass.dispatchWorkgroups(Math.ceil(W / 8), Math.ceil(H / 8)); }
    pass.end();
    device.queue.submit([enc.finish()]);
    return cam;
  };
  const step = (frame: number, withRef: boolean) => {
    const cam = renderScene(frame, withRef);
    if (frame === 0 || frame === CUT || NO_HISTORY) denoiser.resetHistory();
    return denoiser.dispatch(inputs as never, guides, cam);
  };

  // ---- metrics
  const metricsPipe = device.createComputePipeline({ layout: 'auto', compute: { module: device.createShaderModule({ code: METRICS_WGSL }), entryPoint: 'main' } });
  const eN = tex('r32float', 'errNoisy'), eD = tex('r32float', 'errDen');
  const wgX = Math.ceil(W / 16), wgY = Math.ceil(H / 16);
  const partials = device.createBuffer({ size: wgX * wgY * 48, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  const readback = device.createBuffer({ size: wgX * wgY * 48, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  const metricsU = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const score = async (den: GPUTexture, validPrev: boolean) => {
    device.queue.writeBuffer(metricsU, 0, new Uint32Array([W, H, signal === 'shadows' ? 0 : 1, validPrev ? 1 : 0]));
    const bg = device.createBindGroup({
      layout: metricsPipe.getBindGroupLayout(0),
      entries: [metricsU, noisy, den, reference, depth, eN, eD, partials].map((r, i) => ({
        binding: i, resource: r instanceof GPUBuffer ? { buffer: r } : r.createView(),
      })),
    });
    const enc = device.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(metricsPipe); pass.setBindGroup(0, bg); pass.dispatchWorkgroups(wgX, wgY); pass.end();
    enc.copyBufferToBuffer(partials, 0, readback, 0, partials.size);
    device.queue.submit([enc.finish()]);
    await readback.mapAsync(GPUMapMode.READ);
    const a = new Float32Array(readback.getMappedRange());
    const s = new Float64Array(12);
    for (let i = 0; i < a.length; i += 12) for (let k = 0; k < 12; k++) s[k] += a[i + k];
    readback.unmap();
    const n = s[4], nf = s[5];
    const psnr = (sse: number, cnt = n) => 10 * Math.log10(1 / Math.max(sse / cnt, 1e-12));
    return {
      psnrNoisy: psnr(s[0]), psnrDen: psnr(s[1]),
      psnrNoisyPen: psnr(s[8], s[10]), psnrDenPen: psnr(s[9], s[10]), penumbraPixels: s[10],
      biasDen: s[10] ? s[11] / s[10] : 0, // mean signed (denoised - reference) on the scored pixels
      flickerNoisy: nf ? s[2] / nf : NaN, flickerDen: nf ? s[3] / nf : NaN, pixels: n,
      nonFiniteInputs: s[6], nonFiniteDenoised: s[7],
    };
  };

  // ---- view
  const canvas = document.querySelector<HTMLCanvasElement>('#view')!;
  const panelW = Math.min(640, Math.floor((window.innerWidth - 32) / 3));
  canvas.width = panelW * 3; canvas.height = Math.round(panelW * H / W);
  const ctx = canvas.getContext('webgpu')!;
  const fmt = navigator.gpu.getPreferredCanvasFormat();
  ctx.configure({ device, format: fmt });
  const viewModule = device.createShaderModule({ code: VIEW_WGSL });
  const viewPipe = device.createRenderPipeline({
    layout: 'auto', vertex: { module: viewModule, entryPoint: 'vs' },
    fragment: { module: viewModule, entryPoint: 'fs', targets: [{ format: fmt }] },
  });
  const viewU = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  // debug: replace the middle panel with a denoiser internal (e.g. debug=sampleCount.0&dscale=0.1)
  const DEBUG = q.get('debug');
  const DSCALE = Number(q.get('dscale') ?? 1);
  const internal = (): GPUTexture | undefined => {
    if (!DEBUG) return undefined;
    const [field, idx] = DEBUG.split('.');
    const v = (denoiser as unknown as Record<string, GPUTexture | GPUTexture[]>)[field];
    return Array.isArray(v) ? v[Number(idx ?? 0)] : v;
  };
  const show = (den: GPUTexture) => {
    den = internal() ?? den;
    const b = new ArrayBuffer(32);
    new Float32Array(b).set([canvas.width, canvas.height, W, H]);
    new Uint32Array(b)[4] = signal === 'shadows' ? 0 : 1;
    new Float32Array(b)[5] = DEBUG ? DSCALE : 1;
    new Float32Array(b)[6] = Number(q.get('err') ?? 0); // error heat-map gain for the middle panel
    device.queue.writeBuffer(viewU, 0, b);
    const bg = device.createBindGroup({
      layout: viewPipe.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: viewU } }, ...[noisy, den, reference].map((t, i) => ({ binding: i + 1, resource: t.createView() }))],
    });
    const enc = device.createCommandEncoder();
    const pass = enc.beginRenderPass({ colorAttachments: [{ view: ctx.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] });
    pass.setPipeline(viewPipe); pass.setBindGroup(0, bg); pass.draw(3); pass.end();
    device.queue.submit([enc.finish()]);
  };

  if (mode === 'eval') {
    const perFrame: ReturnType<typeof score> extends Promise<infer R> ? R[] : never = [];
    for (let f = 0; f < FRAMES; f++) {
      const den = step(f, true);
      const r = await score(den, f !== 0 && f !== CUT);
      perFrame.push(r);
      if (f % 10 === 0 || f === FRAMES - 1) { show(den); log(`frame ${f}: noisy ${r.psnrNoisy.toFixed(2)} dB  denoised ${r.psnrDen.toFixed(2)} dB  (penumbra ${r.psnrNoisyPen.toFixed(2)} -> ${r.psnrDenPen.toFixed(2)})  flicker ${r.flickerDen.toFixed(4)}`); }
      out.frame = f;
    }
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    // "settled" frames: skip the first 8 frames after each history reset
    const settled = perFrame.filter((_, f) => !(f < 8 || (f >= CUT && f < CUT + 8)));
    const flick = perFrame.filter((r) => !Number.isNaN(r.flickerDen));
    const summary = {
      signal, width: W, height: H, frames: FRAMES, refSpp: REFSPP, cut: CUT, noHistory: NO_HISTORY, query: location.search,
      psnrNoisy: mean(perFrame.map((r) => r.psnrNoisy)),
      psnrDenoised: mean(perFrame.map((r) => r.psnrDen)),
      psnrDenoisedSettled: mean(settled.map((r) => r.psnrDen)),
      psnrDenoisedFirstFrame: perFrame[0].psnrDen,
      // shadows: only pixels whose reference is in (0.02, 0.98) — the penumbrae
      psnrNoisyPenumbra: mean(perFrame.map((r) => r.psnrNoisyPen)),
      psnrDenoisedPenumbra: mean(perFrame.map((r) => r.psnrDenPen)),
      psnrDenoisedPenumbraSettled: mean(settled.map((r) => r.psnrDenPen)),
      meanBiasDenoised: mean(perFrame.map((r) => r.biasDen)),
      psnrDenoisedAfterCut: perFrame[CUT]?.psnrDen,
      nonFiniteInputsTotal: perFrame.reduce((a, r) => a + r.nonFiniteInputs, 0),
      nonFiniteDenoisedTotal: perFrame.reduce((a, r) => a + r.nonFiniteDenoised, 0),
      flickerNoisy: mean(flick.map((r) => r.flickerNoisy)),
      flickerDenoised: mean(flick.map((r) => r.flickerDen)),
      // [psnrNoisy, psnrDen, psnrNoisyPen, psnrDenPen, flickerNoisy, flickerDen]
      perFrame: perFrame.map((r) => [r.psnrNoisy, r.psnrDen, r.psnrNoisyPen, r.psnrDenPen, r.flickerNoisy, r.flickerDen].map((x) => +x.toFixed(4))),
    };
    log(JSON.stringify({ ...summary, perFrame: undefined }, null, 1));
    out.results = summary;
    out.ready = true;
  } else if (mode === 'bench') {
    const WARM = 20, N = Number(q.get('n') ?? 100);
    const gpu: number[] = [];
    const wall: number[] = [];
    const perPass = new Map<string, number[]>();
    for (let i = 0; i < WARM + N; i++) {
      const f = i % FRAMES;
      renderScene(f, false);
      if (f === 0 || f === CUT) denoiser.resetHistory();
      await device.queue.onSubmittedWorkDone();
      const t0 = performance.now();
      denoiser.dispatch(inputs as never, guides, writeScene(f, REFSPP));
      await device.queue.onSubmittedWorkDone();
      const t1 = performance.now();
      await new Promise((r) => setTimeout(r, 0)); // let the timestamp mapAsync land
      if (i >= WARM) {
        wall.push(t1 - t0);
        const t = denoiser.gpuTimings?.get('total');
        if (t !== undefined) gpu.push(t);
        for (const [k, v] of denoiser.gpuTimings ?? []) { if (!perPass.has(k)) perPass.set(k, []); perPass.get(k)!.push(v); }
      }
    }
    const stats = (xs: number[]) => {
      const s = [...xs].sort((a, b) => a - b);
      return { median: s[Math.floor(s.length / 2)], min: s[0], p90: s[Math.floor(s.length * 0.9)], n: s.length };
    };
    const passes = Object.fromEntries([...perPass].map(([k, v]) => { const st = stats(v); return [k, { median: +st.median.toFixed(4), min: +st.min.toFixed(4) }]; }));
    const results = { signal, width: W, height: H, gpuMs: gpu.length ? stats(gpu) : null, wallMs: stats(wall), passesMs: passes };
    log(JSON.stringify(results, null, 1));
    out.results = results;
    out.ready = true;
  } else {
    let f = 0;
    const tick = () => {
      const den = step(f, true);
      show(den);
      out.frame = f;
      if (f === STOP_AT) {
        device.queue.onSubmittedWorkDone().then(() => { out.ready = true; });
        return;
      }
      f = (f + 1) % FRAMES;
      requestAnimationFrame(tick);
    };
    out.ready = STOP_AT < 0;
    tick();
  }
}

main().catch((e) => {
  console.error(e);
  out.error = String(e?.stack ?? e);
  log('ERROR: ' + out.error);
});
