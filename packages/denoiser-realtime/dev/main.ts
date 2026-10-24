// Dev page for @pmndrs/denoiser-realtime: synthetic analytic scene, exact ground
// truth with injected noise, PSNR / flicker / bias / NaN per frame, GPU ms per
// pass. Results land in window.__rt (polled by run-headless.mjs).
//
// Query: mode=eval|bench  signal=diffuse|specular|both  w,h (1920x1080)
//   frames (120)  path=orbit|static|pan  cut=N (camera cut + resetHistory)
//   switch=N (a light turns on at frame N)  noise=1  ff=0.001 (firefly rate)
//   noHistory=1 (reset every frame: spatial only)  antiLag=off|auto|gradient
//   kernel=5x5|3x3  iters=5  feedback=0|1  history=catmull-rom|bilinear
//   alpha=  motionZ=0|1  viewZ=0|1  view=out|noisy|ref|err  gain=  stopAt=N
//   filter=svgf|recurrent  r.<option>=number|bool (recurrent options, e.g. r.blurRadius=20)
//   t.<tune>=number (recurrent weight tolerances)  skeleton=1 (recurrent: trivial kernels)
//   hit=0 (no hit distance inputs)  still=1 (lights don't move)
//   specularFilter=svgf|recurrent (signal=both with filter=recurrent: specular's filter;
//   default recurrent diffuse + SVGF antiLag 'auto' specular)
import {
  DiffuseDenoiser, DiffuseSpecularDenoiser, SpecularDenoiser,
  type FrameCamera, type FrameGuides, type RecurrentOptions, type SpecularSvgfOptions, type SvgfOptions,
} from '@pmndrs/denoiser-realtime';
import { BLIT_WGSL, METRICS_WGSL } from './metrics';
import { SCENE_OUTPUTS, SCENE_PARAMS_SIZE, sceneWgsl } from './scene';

type Sig = 'diffuse' | 'specular';
interface SigStats { psnr: number[]; psnrNoisy: number[]; flicker: number[]; bias: number[]; nan: number }

const q = new URLSearchParams(location.search);
const num = (k: string, d: number) => (q.has(k) ? Number(q.get(k)) : d);
const statusEl = document.querySelector('#status') as HTMLPreElement;
const log = (s: string) => { statusEl.textContent += s + '\n'; };
const w = window as unknown as { __rt: Record<string, unknown> };
w.__rt = { ready: false };

// ---- camera ---------------------------------------------------------------------
type V3 = [number, number, number];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => { const l = Math.hypot(...a); return [a[0] / l, a[1] / l, a[2] / l]; };
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

function lookAt(eye: V3, target: V3): Float32Array {
  const z = norm(sub(eye, target));
  const x = norm(cross([0, 1, 0], z));
  const y = cross(z, x);
  return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1]);
}
// WebGPU clip z in [0, 1].
function perspective(fovY: number, aspect: number, near: number, far: number): Float32Array {
  const f = 1 / Math.tan(fovY / 2);
  return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, far / (near - far), -1, 0, 0, (near * far) / (near - far), 0]);
}
function mul(a: Float32Array, b: Float32Array): Float32Array {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
    o[c * 4 + r] = s;
  }
  return o;
}
function invert(m: Float32Array): Float32Array {
  const inv = new Float64Array(16);
  const a = Array.from(m);
  inv[0] = a[5] * a[10] * a[15] - a[5] * a[11] * a[14] - a[9] * a[6] * a[15] + a[9] * a[7] * a[14] + a[13] * a[6] * a[11] - a[13] * a[7] * a[10];
  inv[4] = -a[4] * a[10] * a[15] + a[4] * a[11] * a[14] + a[8] * a[6] * a[15] - a[8] * a[7] * a[14] - a[12] * a[6] * a[11] + a[12] * a[7] * a[10];
  inv[8] = a[4] * a[9] * a[15] - a[4] * a[11] * a[13] - a[8] * a[5] * a[15] + a[8] * a[7] * a[13] + a[12] * a[5] * a[11] - a[12] * a[7] * a[9];
  inv[12] = -a[4] * a[9] * a[14] + a[4] * a[10] * a[13] + a[8] * a[5] * a[14] - a[8] * a[6] * a[13] - a[12] * a[5] * a[10] + a[12] * a[6] * a[9];
  inv[1] = -a[1] * a[10] * a[15] + a[1] * a[11] * a[14] + a[9] * a[2] * a[15] - a[9] * a[3] * a[14] - a[13] * a[2] * a[11] + a[13] * a[3] * a[10];
  inv[5] = a[0] * a[10] * a[15] - a[0] * a[11] * a[14] - a[8] * a[2] * a[15] + a[8] * a[3] * a[14] + a[12] * a[2] * a[11] - a[12] * a[3] * a[10];
  inv[9] = -a[0] * a[9] * a[15] + a[0] * a[11] * a[13] + a[8] * a[1] * a[15] - a[8] * a[3] * a[13] - a[12] * a[1] * a[11] + a[12] * a[3] * a[9];
  inv[13] = a[0] * a[9] * a[14] - a[0] * a[10] * a[13] - a[8] * a[1] * a[14] + a[8] * a[2] * a[13] + a[12] * a[1] * a[10] - a[12] * a[2] * a[9];
  inv[2] = a[1] * a[6] * a[15] - a[1] * a[7] * a[14] - a[5] * a[2] * a[15] + a[5] * a[3] * a[14] + a[13] * a[2] * a[7] - a[13] * a[3] * a[6];
  inv[6] = -a[0] * a[6] * a[15] + a[0] * a[7] * a[14] + a[4] * a[2] * a[15] - a[4] * a[3] * a[14] - a[12] * a[2] * a[7] + a[12] * a[3] * a[6];
  inv[10] = a[0] * a[5] * a[15] - a[0] * a[7] * a[13] - a[4] * a[1] * a[15] + a[4] * a[3] * a[13] + a[12] * a[1] * a[7] - a[12] * a[3] * a[5];
  inv[14] = -a[0] * a[5] * a[14] + a[0] * a[6] * a[13] + a[4] * a[1] * a[14] - a[4] * a[2] * a[13] - a[12] * a[1] * a[6] + a[12] * a[2] * a[5];
  inv[3] = -a[1] * a[6] * a[11] + a[1] * a[7] * a[10] + a[5] * a[2] * a[11] - a[5] * a[3] * a[10] - a[9] * a[2] * a[7] + a[9] * a[3] * a[6];
  inv[7] = a[0] * a[6] * a[11] - a[0] * a[7] * a[10] - a[4] * a[2] * a[11] + a[4] * a[3] * a[10] + a[8] * a[2] * a[7] - a[8] * a[3] * a[6];
  inv[11] = -a[0] * a[5] * a[11] + a[0] * a[7] * a[9] + a[4] * a[1] * a[11] - a[4] * a[3] * a[9] - a[8] * a[1] * a[7] + a[8] * a[3] * a[5];
  inv[15] = a[0] * a[5] * a[10] - a[0] * a[6] * a[9] - a[4] * a[1] * a[10] + a[4] * a[2] * a[9] + a[8] * a[1] * a[6] - a[8] * a[2] * a[5];
  const det = a[0] * inv[0] + a[1] * inv[4] + a[2] * inv[8] + a[3] * inv[12];
  return new Float32Array(Array.from(inv, (v) => v / det));
}

const path = q.get('path') ?? 'orbit';
const cutAt = num('cut', -1);
function cameraAt(f: number): { eye: V3; view: Float32Array } {
  let ang = 0.25;
  let radius = 7;
  if (path === 'orbit') { ang += f * 0.004; radius -= f * 0.01; }
  else if (path === 'pan') { ang += f * 0.02; }
  if (cutAt >= 0 && f >= cutAt) ang += 1.2;
  const eye: V3 = [Math.sin(ang) * radius, 2.4, Math.cos(ang) * radius];
  return { eye, view: lookAt(eye, [0, 0.8, 0]) };
}

// ---- main -------------------------------------------------------------------------
async function main() {
  const adapter = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('WebGPU not available');
  const device = await adapter.requestDevice({
    requiredFeatures: adapter.features.has('timestamp-query') ? ['timestamp-query'] : [],
  });
  device.addEventListener('uncapturederror', (e) => {
    const msg = (e as GPUUncapturedErrorEvent).error.message;
    log('GPU error: ' + msg);
    w.__rt.error = msg;
  });

  const W = num('w', 1920), H = num('h', 1080);
  const frames = num('frames', 120);
  const mode = q.get('mode') ?? 'eval';
  const signal = (q.get('signal') ?? 'diffuse') as Sig | 'both';
  const sigs: Sig[] = signal === 'both' ? ['diffuse', 'specular'] : [signal];
  const antiLag = (q.get('antiLag') ?? 'off') as SvgfOptions['antiLag'];
  const opts: SvgfOptions & SpecularSvgfOptions = {
    antiLag,
    kernel: (q.get('kernel') ?? '3x3') as '5x5' | '3x3',
    atrousIterations: num('iters', 5),
    feedback: q.get('feedback') !== '0',
    historyFilter: (q.get('history') ?? 'bilinear') as 'catmull-rom' | 'bilinear',
    ...(q.has('lumVar') ? { luminanceVariance: q.get('lumVar') as 'sample' | 'mean' } : {}),
    ...(q.has('sigmaL') ? { sigmaLuminance: num('sigmaL', 4) } : {}),
    ...(q.get('remod') === '1' ? { remodulate: true } : {}),
    ...(q.has('specNormal') ? { specularNormalWeight: q.get('specNormal') as 'lobe' | 'power' } : {}),
    ...(q.has('radius') ? { radiusScale: num('radius', 1) } : {}),
    ...(q.has('specScale') ? { specularHistoryScale: num('specScale', 1) } : {}),
    ...(q.has('boost') ? { spatialVarianceBoost: num('boost', 3) } : {}),
    ...(q.has('cosN') ? { normalThreshold: num('cosN', 0.95) } : {}),
    ...(q.has('plane') ? { planeDistance: num('plane', 0.01) } : {}),
    ...(q.has('alpha') ? { temporalAlpha: num('alpha', 0.2) } : {}),
    ...(q.has('maxHistory') ? { maxHistory: num('maxHistory', 32) } : {}),
    ...(q.has('noiseFloor') ? { antiLagNoiseFloor: num('noiseFloor', 2) } : {}),
  };
  // recurrent filter: options from r.<name> / t.<tune> query keys
  const filter = q.get('filter') ?? 'svgf';
  const rec: RecurrentOptions & Record<string, unknown> = { filter: 'recurrent', tune: {} };
  for (const [k, v] of q) {
    const val = v === 'true' ? true : v === 'false' ? false : Number(v);
    if (k.startsWith('r.')) rec[k.slice(2)] = val;
    else if (k.startsWith('t.')) (rec.tune as Record<string, unknown>)[k.slice(2)] = val;
  }
  if (q.get('skeleton') === '1') rec.skeleton = true;
  if (q.get('remod') === '1') rec.remodulate = true;
  // specularFilter=svgf: recurrent diffuse + SVGF specular in DiffuseSpecularDenoiser
  const specFilter = q.get('specularFilter');
  const dOpts: RecurrentOptions | (SvgfOptions & SpecularSvgfOptions) = filter === 'recurrent' ? rec : opts;
  const useHit = q.get('hit') !== '0';
  const noHistory = q.get('noHistory') === '1';
  const useMotionZ = q.get('motionZ') !== '0';
  const useViewZ = q.get('viewZ') === '1';
  const stopAt = num('stopAt', frames - 1);
  const switchFrame = num('switch', -1);
  log(`${W}x${H} ${mode} signal=${signal} frames=${frames} path=${path} ${JSON.stringify(dOpts)}${specFilter ? ` specular=${specFilter}` : ''}${noHistory ? ' noHistory' : ''}`);

  const canvas = document.querySelector('canvas')!;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('webgpu')!;
  const fmt = navigator.gpu.getPreferredCanvasFormat();
  ctx.configure({ device, format: fmt });

  // scene resources
  const ST = GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING;
  const tex: Record<string, GPUTexture> = {};
  for (const part of SCENE_OUTPUTS) for (const [n, f] of part) {
    const [tw, th] = n === 'Grad' ? [Math.ceil(W / 3), Math.ceil(H / 3)] : [W, H];
    tex[n] = device.createTexture({ label: n, size: [tw, th], format: f, usage: ST | GPUTextureUsage.RENDER_ATTACHMENT });
  }
  // The denoiser reads motionZ / roughness from `.r`; split them out of the packed scene outputs.
  const motionZ = device.createTexture({ label: 'motionZ', size: [W, H], format: 'r32float', usage: ST });
  const scenePipes = SCENE_OUTPUTS.map((_, i) => device.createComputePipeline({
    label: `scene ${i}`, layout: 'auto', compute: { module: device.createShaderModule({ code: sceneWgsl(i) }), entryPoint: 'main' },
  }));
  const splitPipe = device.createComputePipeline({
    label: 'motionZ split', layout: 'auto', compute: {
      entryPoint: 'main', module: device.createShaderModule({
        code: /* wgsl */ `
@group(0) @binding(0) var m: texture_2d<f32>;
@group(0) @binding(1) var o: texture_storage_2d<r32float, write>;
@compute @workgroup_size(8, 8) fn main(@builtin(global_invocation_id) g: vec3u) {
  if (any(g.xy >= textureDimensions(m))) { return; }
  textureStore(o, vec2i(g.xy), vec4f(textureLoad(m, vec2i(g.xy), 0).z));
}`,
      }),
    },
  });
  const sceneParams = device.createBuffer({ size: SCENE_PARAMS_SIZE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const sceneGroups = SCENE_OUTPUTS.map((part, i) => device.createBindGroup({
    layout: scenePipes[i].getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: sceneParams } }, ...part.map(([n], j) => ({ binding: j + 1, resource: tex[n].createView() }))],
  }));
  const splitGroup = device.createBindGroup({
    layout: splitPipe.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: tex.Motion.createView() }, { binding: 1, resource: motionZ.createView() }],
  });

  // denoiser(s)
  let both: DiffuseSpecularDenoiser | undefined;
  let single: DiffuseDenoiser | SpecularDenoiser | undefined;
  if (signal === 'both') {
    both = new DiffuseSpecularDenoiser(device, specFilter === 'svgf' ? { ...dOpts, specular: { ...opts, filter: 'svgf' } }
      : specFilter === 'recurrent' ? { ...dOpts, specular: { filter: 'recurrent' } } : dOpts);
  } else if (signal === 'diffuse') single = new DiffuseDenoiser(device, dOpts);
  else single = new SpecularDenoiser(device, dOpts);
  (both ?? single)!.configure({ width: W, height: H });
  const guides: FrameGuides = {
    depth: tex.Depth, normal: tex.Normal, motion: tex.Motion,
    ...(q.get('remod') === '1' ? { albedo: tex.Mat } : {}),
    ...(useViewZ ? { viewZ: tex.ViewZ } : {}),
    ...(useMotionZ ? { motionZ } : {}),
  };
  // roughness is read from `.r` by the denoiser; extract it into its own texture
  const rough = device.createTexture({ label: 'roughness', size: [W, H], format: 'r32float', usage: ST });
  guides.roughness = rough;
  const roughPipe = device.createComputePipeline({
    label: 'roughness split', layout: 'auto', compute: {
      entryPoint: 'main', module: device.createShaderModule({
        code: /* wgsl */ `
@group(0) @binding(0) var m: texture_2d<f32>;
@group(0) @binding(1) var o: texture_storage_2d<r32float, write>;
@compute @workgroup_size(8, 8) fn main(@builtin(global_invocation_id) g: vec3u) {
  if (any(g.xy >= textureDimensions(m))) { return; }
  textureStore(o, vec2i(g.xy), vec4f(textureLoad(m, vec2i(g.xy), 0).a));
}`,
      }),
    },
  });
  const roughGroup = device.createBindGroup({
    layout: roughPipe.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: tex.Mat.createView() }, { binding: 1, resource: rough.createView() }],
  });

  // metrics
  const metricsPipe = device.createComputePipeline({
    label: 'metrics', layout: 'auto', compute: { module: device.createShaderModule({ code: METRICS_WGSL }), entryPoint: 'main' },
  });
  const nwg = Math.ceil(W / 8) * Math.ceil(H / 8);
  const partialSize = nwg * 32;
  const met = Object.fromEntries(sigs.map((s) => [s, {
    err: [0, 1].map(() => device.createTexture({ size: [W, H], format: 'rgba32float', usage: ST })),
    partials: device.createBuffer({ size: partialSize, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC }),
    read: device.createBuffer({ size: partialSize, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }),
    stats: { psnr: [], psnrNoisy: [], flicker: [], bias: [], nan: 0 } as SigStats,
  }])) as Record<Sig, { err: GPUTexture[]; partials: GPUBuffer; read: GPUBuffer; stats: SigStats }>;
  const hasPrevBuf = [0, 1].map((v) => {
    const b = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(b, 0, new Uint32Array([v, 0, 0, 0]));
    return b;
  });

  const proj = perspective((50 * Math.PI) / 180, W / H, 0.1, 100);
  const timings: Record<string, number[]> = {};
  let lastOut: Record<Sig, GPUTexture> = {} as Record<Sig, GPUTexture>;

  for (let f = 0; f <= Math.min(stopAt, frames - 1); f++) {
    const cur = cameraAt(f);
    const prev = cameraAt(Math.max(0, f - 1));
    const VP = mul(proj, cur.view);
    const sp = new Float32Array(SCENE_PARAMS_SIZE / 4);
    const su = new Uint32Array(sp.buffer);
    sp.set(invert(VP), 0); sp.set(VP, 16); sp.set(mul(proj, prev.view), 32); sp.set(cur.view, 48);
    sp.set(cur.eye, 64); sp[67] = f;
    sp[68] = W; sp[69] = H; sp[70] = Math.max(0, f - 1); sp[71] = num('noise', 1);
    sp[72] = num('ff', 0.001); sp[73] = switchFrame; su[74] = f + 1; su[75] = (antiLag === 'gradient' ? 1 : 0) | (q.get('still') === '1' ? 2 : 0);
    sp[76] = 0.1; sp[77] = 100;
    device.queue.writeBuffer(sceneParams, 0, sp);
    const enc = device.createCommandEncoder();
    if (antiLag === 'gradient') {   // strata without a gradient sample (sky) read as invalid
      enc.beginRenderPass({ colorAttachments: [{ view: tex.Grad.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }] }).end();
    }
    const pass = enc.beginComputePass();
    for (let i = 0; i < scenePipes.length; i++) {
      pass.setPipeline(scenePipes[i]); pass.setBindGroup(0, sceneGroups[i]);
      pass.dispatchWorkgroups(Math.ceil(W / 8), Math.ceil(H / 8));
    }
    pass.setPipeline(splitPipe); pass.setBindGroup(0, splitGroup); pass.dispatchWorkgroups(Math.ceil(W / 8), Math.ceil(H / 8));
    pass.setPipeline(roughPipe); pass.setBindGroup(0, roughGroup); pass.dispatchWorkgroups(Math.ceil(W / 8), Math.ceil(H / 8));
    pass.end();
    device.queue.submit([enc.finish()]);

    const camera: FrameCamera = {
      view: cur.view, projection: proj, prevView: prev.view, prevProjection: proj, near: 0.1, far: 100, position: cur.eye,
    };
    const den = (both ?? single)!;
    if (noHistory || f === cutAt) den.resetHistory();
    const grad = antiLag === 'gradient' ? tex.Grad : undefined;
    if (both) {
      lastOut = both.dispatchBoth({
        diffuse: { radiance: tex.Diff, gradient: grad, ...(useHit ? { hitDistance: tex.DiffHit } : {}) },
        specular: { radiance: tex.Spec, hitDistance: tex.SpecHit, gradient: grad },
      }, guides, camera);
    } else if (single instanceof DiffuseDenoiser) {
      lastOut = { diffuse: single.dispatch({ radiance: tex.Diff, gradient: grad, ...(useHit ? { hitDistance: tex.DiffHit } : {}) }, guides, camera) } as Record<Sig, GPUTexture>;
    } else {
      lastOut = { specular: single!.dispatch({ radiance: tex.Spec, hitDistance: tex.SpecHit, gradient: grad }, guides, camera) } as Record<Sig, GPUTexture>;
    }

    if (mode === 'eval') {
      const me = device.createCommandEncoder();
      for (const s of sigs) {
        const m = met[s];
        const mp = me.beginComputePass();
        mp.setPipeline(metricsPipe);
        mp.setBindGroup(0, device.createBindGroup({
          layout: metricsPipe.getBindGroupLayout(0), entries: [
            { binding: 0, resource: lastOut[s].createView() },
            { binding: 1, resource: tex[s === 'diffuse' ? 'DiffRef' : 'SpecRef'].createView() },
            { binding: 2, resource: tex[s === 'diffuse' ? 'Diff' : 'Spec'].createView() },
            { binding: 3, resource: m.err[(f + 1) & 1].createView() },
            { binding: 4, resource: m.err[f & 1].createView() },
            { binding: 5, resource: { buffer: m.partials } },
            { binding: 6, resource: { buffer: hasPrevBuf[f > 0 && f !== cutAt ? 1 : 0] } },
          ],
        }));
        mp.dispatchWorkgroups(Math.ceil(W / 8), Math.ceil(H / 8));
        mp.end();
        me.copyBufferToBuffer(m.partials, 0, m.read, 0, partialSize);
      }
      device.queue.submit([me.finish()]);
      for (const s of sigs) {
        const m = met[s];
        await m.read.mapAsync(GPUMapMode.READ);
        const a = new Float32Array(m.read.getMappedRange());
        let sq = 0, fl = 0, sg = 0, cnt = 0, nan = 0, sqn = 0, flc = 0;
        for (let i = 0; i < nwg; i++) {
          sq += a[8 * i]; fl += a[8 * i + 1]; sg += a[8 * i + 2]; cnt += a[8 * i + 3];
          nan += a[8 * i + 4]; sqn += a[8 * i + 5]; flc += a[8 * i + 6];
        }
        m.read.unmap();
        m.stats.psnr.push(10 * Math.log10(1 / Math.max(sq / cnt, 1e-12)));
        m.stats.psnrNoisy.push(10 * Math.log10(1 / Math.max(sqn / cnt, 1e-12)));
        m.stats.bias.push(sg / cnt);
        if (flc > 0) m.stats.flicker.push(fl / flc);
        m.stats.nan += nan;
      }
    } else {
      await device.queue.onSubmittedWorkDone();
      if (f >= 10) for (const [k, v] of den.gpuTimings ?? []) (timings[k] ??= []).push(v);
    }
    if (f % 20 === 0) statusEl.textContent = statusEl.textContent!.split('\n').slice(0, 1).join('\n') + `\nframe ${f}\n`;
  }

  // display
  const view = q.get('view') ?? 'out';
  const showSig: Sig = sigs[sigs.length - 1];
  const srcTex = view === 'noisy' ? tex[showSig === 'diffuse' ? 'Diff' : 'Spec']
    : view === 'ref' ? tex[showSig === 'diffuse' ? 'DiffRef' : 'SpecRef']
      : view === 'err' ? met[showSig]?.err[Math.min(stopAt, frames - 1) & 1]
        : view === 'histlen' ? (filter === 'recurrent' ? lastOut[showSig] : (single as DiffuseDenoiser | undefined)?.debugTexture('accum')) : lastOut[showSig];
  const blit = device.createRenderPipeline({
    layout: 'auto', vertex: { module: device.createShaderModule({ code: BLIT_WGSL }), entryPoint: 'vs' },
    fragment: { module: device.createShaderModule({ code: BLIT_WGSL }), entryPoint: 'fs', targets: [{ format: fmt }] },
  });
  const modeBuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(modeBuf, 0, new Float32Array([view === 'err' ? 1 : view === 'histlen' ? 2 : 0, num('gain', view === 'err' ? 8 : view === 'histlen' ? (filter === 'recurrent' ? 1 : 64) : 1), 0, 0]));
  if (srcTex) {
    const be = device.createCommandEncoder();
    const rp = be.beginRenderPass({ colorAttachments: [{ view: ctx.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] });
    rp.setPipeline(blit);
    rp.setBindGroup(0, device.createBindGroup({ layout: blit.getBindGroupLayout(0), entries: [
      { binding: 0, resource: srcTex.createView() }, { binding: 1, resource: { buffer: modeBuf } }] }));
    rp.draw(3);
    rp.end();
    device.queue.submit([be.finish()]);
  }
  await device.queue.onSubmittedWorkDone();

  // results
  const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
  const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
  const r3 = (x: number) => Math.round(x * 1000) / 1000;
  const results: Record<string, unknown> = { W, H, frames, signal, path, filter, opts: dOpts, specFilter, noHistory, adapter: adapter.info?.description ?? adapter.info?.vendor };
  if (mode === 'eval') {
    for (const s of sigs) {
      const st = met[s].stats;
      results[s] = {
        psnr: r3(mean(st.psnr)), psnrNoisy: r3(mean(st.psnrNoisy)), flicker: Number(mean(st.flicker).toPrecision(4)),
        bias: Number(mean(st.bias).toPrecision(3)), nan: st.nan,
        psnrFirst: r3(st.psnr[0]), psnrLast: r3(st.psnr[st.psnr.length - 1]),
        ...(cutAt >= 0 ? { psnrCut: r3(st.psnr[cutAt]) } : {}),
        ...(switchFrame >= 0 ? { psnrSwitch: r3(st.psnr[switchFrame]), psnrSwitch5: r3(st.psnr[switchFrame + 5]) } : {}),
        perFrame: st.psnr.map(r3),
      };
      log(`${s}: PSNR ${r3(mean(st.psnr))} dB (noisy ${r3(mean(st.psnrNoisy))}), flicker ${mean(st.flicker).toPrecision(4)}, bias ${mean(st.bias).toPrecision(3)}, NaN ${st.nan}`);
    }
  } else {
    const t: Record<string, { min: number; median: number }> = {};
    for (const [k, v] of Object.entries(timings)) t[k] = { min: r3(Math.min(...v)), median: r3(median(v)) };
    results.timings = t;
    log(Object.entries(t).map(([k, v]) => `${k}: ${v.min} / ${v.median} ms`).join('\n'));
  }
  w.__rt = { ready: true, results, error: w.__rt.error };
}

main().catch((e) => {
  log('ERROR ' + (e?.stack ?? e));
  w.__rt = { ready: false, error: String(e?.stack ?? e) };
});
