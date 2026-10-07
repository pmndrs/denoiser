// The Denoiser facade on three network runtimes — default onnxruntime-web, the
// experimental @huggingface/kernels runtime and the hand-written WGSL runtime —
// with the same inputs. Reports parity vs ORT and warm medians.
//
//   ?mode=facade (default)  denoise / denoise+aux / denoiseTextures / large model /
//                           tiled path, parity vs ORT + warm medians (512², 512²+aux, 1080p)
//   ?mode=net               the network alone: bind + run() + queue drain, max |Δ| vs
//                           the first runtime; &profile=1 adds per-layer GPU timings
//
// Common params: precision=fp32|fp16, warm=N, runtimes=ort,kernels,wgsl,
// tiling=pw,ph,oc4,wgx,wgy (WGSL conv tiling override). Net mode: model=rt_ldr_small,
// ch=3, sizes=512x512,1920x1088, batch=1.
import { Denoiser, OrtRuntime, type NetworkRuntime, type NetworkSession } from 'denoiser';
import * as ort from 'onnxruntime-web/webgpu';
import { KernelsRuntime } from '@pmndrs/denoiser-kernels';
import { WgslRuntime, type ConvTiling } from '@pmndrs/denoiser-wgsl';
import noisyUrl from '../../gallery/public/scenes/spheres/spp4.png?url';
import referenceUrl from '../../gallery/public/scenes/spheres/reference.png?url';
import albedoUrl from '../../gallery/public/scenes/spheres/albedo.png?url';
import normalUrl from '../../gallery/public/scenes/spheres/normal.png?url';

const params = new URLSearchParams(location.search);
const precision = params.get('precision') === 'fp16' ? 'fp16' : 'fp32';
const mode = params.get('mode') ?? 'facade';
const WARM = Number(params.get('warm') ?? (mode === 'net' ? 20 : 10));
const runtimes = (params.get('runtimes') ?? (mode === 'net' ? 'ort,wgsl' : 'ort,kernels,wgsl')).split(',');
const tiling = parseTiling(params.get('tiling'));
const F16 = (globalThis as unknown as { Float16Array: Float32ArrayConstructor }).Float16Array;

const status = document.querySelector<HTMLPreElement>('#status')!;
const log = (m: string) => { status.textContent += m + '\n'; console.log(m); };
const results: Record<string, unknown> = { mode, precision, warm: WARM, runtimes, tiling };
(window as unknown as { __wgslBench: typeof results }).__wgslBench = results;

function parseTiling(s: string | null): Partial<ConvTiling> | undefined {
  if (!s) return undefined;
  const [pw, ph, oc4, wgx, wgy] = s.split(',').map(Number);
  return { pw, ph, oc4, wgx, wgy };
}

function makeRuntime(name: string, profile = false): NetworkRuntime {
  if (name === 'ort') return new OrtRuntime({ weightsUrl: '/models' });
  if (name === 'kernels') return new KernelsRuntime({ tzaUrl: '/tzas' });
  if (name === 'wgsl') return new WgslRuntime({ tzaUrl: '/tzas', tiling, profile });
  throw new Error(`unknown runtime ${name}`);
}

// ---- helpers ----------------------------------------------------------------

async function loadImage(url: string): Promise<ImageData> {
  const img = new Image();
  img.src = url;
  await img.decode();
  const c = new OffscreenCanvas(img.width, img.height);
  const ctx = c.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  return ctx.getImageData(0, 0, img.width, img.height);
}

function psnr(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let se = 0;
  let n = 0;
  for (let i = 0; i < a.length; i += 4) {
    for (let c = 0; c < 3; c++) { const d = a[i + c] - b[i + c]; se += d * d; n++; }
  }
  return se === 0 ? Infinity : 10 * Math.log10((255 * 255) / (se / n));
}

function maxByteDiff(a: ArrayLike<number>, b: ArrayLike<number>) {
  let m = 0;
  for (let i = 0; i < a.length; i++) if ((i & 3) !== 3) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
}

function draw(caption: string, img: { data: ArrayLike<number>; width: number; height: number }) {
  const fig = document.createElement('figure');
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
  const cap = document.createElement('figcaption');
  cap.textContent = caption;
  fig.append(c, cap);
  document.querySelector('#images')!.append(fig);
}

/** RGBA8 -> rgba16float texture (value = byte / 255 * scale + offset). */
function toTexture(device: GPUDevice, img: ImageData, scale = 1, offset = 0): GPUTexture {
  const half = new F16(img.data.length);
  for (let i = 0; i < img.data.length; i++) half[i] = (i & 3) === 3 ? 1 : (img.data[i] / 255) * scale + offset;
  const tex = device.createTexture({
    size: { width: img.width, height: img.height }, format: 'rgba16float',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  device.queue.writeTexture({ texture: tex }, half as unknown as BufferSource,
    { bytesPerRow: img.width * 8 }, { width: img.width, height: img.height });
  return tex;
}

async function readTexture(device: GPUDevice, tex: GPUTexture): Promise<Uint8Array> {
  const { width: w, height: h } = tex;
  const bpr = Math.ceil((w * 4) / 256) * 256;
  const buf = device.createBuffer({ size: bpr * h, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const enc = device.createCommandEncoder();
  enc.copyTextureToBuffer({ texture: tex }, { buffer: buf, bytesPerRow: bpr }, { width: w, height: h });
  device.queue.submit([enc.finish()]);
  await buf.mapAsync(GPUMapMode.READ);
  const src = new Uint8Array(buf.getMappedRange());
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) out.set(src.subarray(y * bpr, y * bpr + w * 4), y * w * 4);
  buf.unmap();
  buf.destroy();
  return out;
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

function resized(img: ImageData, w: number, h: number): ImageData {
  const src = new OffscreenCanvas(img.width, img.height);
  src.getContext('2d')!.putImageData(img, 0, 0);
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext('2d')!;
  ctx.drawImage(src, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

async function timed(n: number, fn: () => Promise<unknown>): Promise<number> {
  const xs: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = performance.now();
    await fn();
    xs.push(performance.now() - t);
  }
  return median(xs);
}

// ---- facade mode ------------------------------------------------------------

interface Images { noisy: ImageData; albedo: ImageData; normal: ImageData; hd: ImageData; wide: ImageData; small: ImageData }

interface FacadeOut {
  precision: string;
  color: Uint8ClampedArray; aux: Uint8ClampedArray; tex: Uint8Array; large: Uint8Array; tiled?: Uint8ClampedArray; tiledBatch?: Uint8ClampedArray;
  auxModel?: string; largeModel?: string;
  createMs: number; warmMs: number; warmAuxMs: number; warmHdMs: number; warmLargeMs: number; warmTiledMs?: number;
}

async function facadeRun(name: string, img: Images): Promise<FacadeOut> {
  const rt = makeRuntime(name);
  let t = performance.now();
  const dn = await Denoiser.create({ precision, runtime: rt });
  const createMs = performance.now() - t;
  const actual = (dn as unknown as { precision: string }).precision;

  const color = (await dn.denoise(img.noisy))!.data;
  const warmMs = await timed(WARM, () => dn.denoise(img.noisy));
  const aux = (await dn.denoise(img.noisy, { albedo: img.albedo, normal: img.normal }))!.data;
  const auxModel = dn.modelName;
  const warmAuxMs = await timed(WARM, () => dn.denoise(img.noisy, { albedo: img.albedo, normal: img.normal }));
  await dn.denoise(img.hd);
  const warmHdMs = await timed(WARM, () => dn.denoise(img.hd));

  const ct = toTexture(dn.device, img.noisy);
  const tex = await readTexture(dn.device, (await dn.denoiseTextures({ color: ct }))!);
  ct.destroy();

  // large topology: the only *_large model the facade selects is rt_hdr_calb_cnrm_large
  dn.quality = 'high';
  const hc = toTexture(dn.device, img.noisy, 4);
  const at = toTexture(dn.device, img.albedo);
  const nt = toTexture(dn.device, img.normal, 2, -1);
  const largeCall = () => dn.denoiseTextures({ color: hc, albedo: at, normal: nt, hdr: true, transfer: 'aces-srgb' });
  const large = await readTexture(dn.device, (await largeCall())!);
  const largeModel = dn.modelName;
  const warmLargeMs = await timed(Math.max(3, WARM >> 1), largeCall);
  hc.destroy(); at.destroy(); nt.destroy();
  dn.quality = 'fast';

  // tiled path. 1280x720 with a 256² run budget: the engine plans 1024² tiles, batch 1.
  // 496² with a 2x256² budget: 256² tiles, batch 2 (9 tiles -> 5 runs, the last partial).
  let tiled: Uint8ClampedArray | undefined;
  let tiledBatch: Uint8ClampedArray | undefined;
  let warmTiledMs: number | undefined;
  if (name !== 'kernels') { // kernels binds to one device per page
    const tiledRun = async (input: ImageData, maxRunPixels: number, timeIt: boolean) => {
      const tdn = await Denoiser.create({ precision, runtime: name === 'wgsl' ? rt : makeRuntime(name), maxRunPixels });
      const out = (await tdn.denoise(input))!.data;
      const st = tdn.stats;
      log(`  ${name} tiled ${input.width}x${input.height}: ${st?.tiles} tiles in ${st?.batches} runs of ${st?.batchSize}x${st?.tileW}x${st?.tileH}`);
      if (timeIt) warmTiledMs = await timed(Math.max(3, WARM >> 1), () => tdn.denoise(input));
      if (name !== 'wgsl') tdn.destroyDevice(); else tdn.dispose();
      return out;
    };
    tiled = await tiledRun(img.wide, 256 * 256, true);
    tiledBatch = await tiledRun(img.small, 2 * 256 * 256, false);
  }

  log(`${name.padEnd(8)} [${actual}] create ${createMs.toFixed(0)} ms · warm 512² ${warmMs.toFixed(1)} · aux (${auxModel}) ${warmAuxMs.toFixed(1)} · 1920×1080 ${warmHdMs.toFixed(1)} · large (${largeModel}) ${warmLargeMs.toFixed(1)}${warmTiledMs ? ` · tiled 720p ${warmTiledMs.toFixed(1)}` : ''} ms`);
  dn.destroyDevice();
  if (rt instanceof WgslRuntime) await rt.destroy();
  return { precision: actual, color, aux, tex, large, tiled, tiledBatch, auxModel, largeModel, createMs, warmMs, warmAuxMs, warmHdMs, warmLargeMs, warmTiledMs };
}

async function facadeMode() {
  const [noisy, reference, albedo, normal] = await Promise.all([noisyUrl, referenceUrl, albedoUrl, normalUrl].map(loadImage));
  const img: Images = { noisy, albedo, normal, hd: resized(noisy, 1920, 1080), wide: resized(noisy, 1280, 720), small: resized(noisy, 496, 496) };
  log(`facade · ${precision} · spheres 512² · warm = median of ${WARM}`);
  const outs: Record<string, FacadeOut> = {};
  for (const name of runtimes) outs[name] = await facadeRun(name, img);
  draw('noisy', noisy);
  for (const [name, o] of Object.entries(outs)) draw(name, { data: o.color, width: 512, height: 512 });
  draw('reference', reference);

  const base = outs.ort ? 'ort' : runtimes[0];
  const parity: Record<string, Record<string, { psnr: number; maxByteDiff: number }>> = {};
  const cmp = (a: ArrayLike<number> | undefined, b: ArrayLike<number> | undefined) =>
    a && b ? { psnr: psnr(a, b), maxByteDiff: maxByteDiff(a, b) } : undefined;
  const fmt = (r?: { psnr: number; maxByteDiff: number }) =>
    (r ? `max Δ ${r.maxByteDiff} (${r.psnr === Infinity ? 'inf' : r.psnr.toFixed(1)} dB)` : 'n/a');
  for (const name of runtimes) {
    if (name === base) continue;
    const a = outs[name];
    const b = outs[base];
    const r = {
      color: cmp(a.color, b.color), aux: cmp(a.aux, b.aux), texture: cmp(a.tex, b.tex),
      large: cmp(a.large, b.large), tiled: cmp(a.tiled, b.tiled), tiledBatch: cmp(a.tiledBatch, b.tiledBatch),
    };
    parity[name] = r as Record<string, { psnr: number; maxByteDiff: number }>;
    log(`${name} vs ${base}: denoise ${fmt(r.color)} · aux ${fmt(r.aux)} · textures ${fmt(r.texture)} · large ${fmt(r.large)} · tiled ${fmt(r.tiled)} · tiled batch ${fmt(r.tiledBatch)}`);
  }
  if (outs.kernels && outs.wgsl) {
    const r = cmp(outs.wgsl.large, outs.kernels.large);
    parity['wgsl-vs-kernels-large'] = { large: r! };
    log(`wgsl vs kernels large: ${fmt(r)}`);
  }
  results.parity = parity;
  const vsRef: Record<string, number> = {};
  for (const [name, o] of Object.entries(outs)) {
    vsRef[name] = psnr(o.color, reference.data);
    vsRef[`${name}Aux`] = psnr(o.aux, reference.data);
  }
  results.psnrVsReference = vsRef;
  log(`PSNR vs reference: ${Object.entries(vsRef).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(' · ')}`);
  results.bench = Object.fromEntries(Object.entries(outs).map(([k, o]) => [k, {
    precision: o.precision, createMs: o.createMs, warmMs: o.warmMs, warmAuxMs: o.warmAuxMs, warmHdMs: o.warmHdMs,
    warmLargeMs: o.warmLargeMs, warmTiledMs: o.warmTiledMs, auxModel: o.auxModel, largeModel: o.largeModel,
  }]));
}

// ---- net mode -----------------------------------------------------------------

async function readBuffer(device: GPUDevice, src: GPUBuffer, f16: boolean): Promise<Float32Array> {
  const buf = device.createBuffer({ size: src.size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const enc = device.createCommandEncoder();
  enc.copyBufferToBuffer(src, 0, buf, 0, src.size);
  device.queue.submit([enc.finish()]);
  await buf.mapAsync(GPUMapMode.READ);
  const raw = buf.getMappedRange().slice(0);
  buf.unmap();
  buf.destroy();
  return f16 ? Float32Array.from(new F16(raw)) : new Float32Array(raw);
}

async function netMode() {
  const model = params.get('model') ?? 'rt_ldr_small';
  const ch = Number(params.get('ch') ?? 3);
  const batch = Number(params.get('batch') ?? 1);
  const sizes = (params.get('sizes') ?? '512x512,1920x1088').split(',').map((s) => s.split('x').map(Number));
  const profile = params.get('profile') === '1';
  const f16 = precision === 'fp16';
  log(`net · ${model} (${ch}ch) · ${precision} · batch ${batch} · warm = median of ${WARM}`);
  const outputs: Record<string, Float32Array[]> = {};
  const net: Record<string, unknown> = {};
  const inputFor = (w: number, h: number) => {
    // deterministic pseudo-random input in [0, 1)
    const n = batch * ch * w * h;
    const host = new Float32Array(n);
    let s = 1234567;
    for (let i = 0; i < n; i++) { s = (s * 1103515245 + 12345) >>> 0; host[i] = (s >>> 8) / 16777216; }
    return host;
  };
  for (const name of runtimes) {
    if (name === 'cpu') {
      // reference: the same .onnx on onnxruntime-web's wasm (CPU) backend, fp32
      ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/';
      const sess = await ort.InferenceSession.create(`/models/${model}.onnx`, { executionProviders: ['wasm'] });
      outputs[name] = [];
      for (const [w, h] of sizes) {
        const r = await sess.run({ [sess.inputNames[0]]: new ort.Tensor('float32', inputFor(w, h), [batch, ch, h, w]) });
        outputs[name].push(r[sess.outputNames[0]].data as Float32Array);
        log(`cpu      ${w}x${h} done`);
      }
      continue;
    }
    const rt = makeRuntime(name, profile);
    let session: NetworkSession;
    const t0 = performance.now();
    session = await rt.load({ name: model, channels: ch, precision });
    const loadMs = performance.now() - t0;
    const d = session.device;
    outputs[name] = [];
    const row: Record<string, unknown> = { loadMs };
    for (const [w, h] of sizes) {
      const t1 = performance.now();
      const b = await session.bind({ batch, tileW: w, tileH: h });
      const host = inputFor(w, h);
      d.queue.writeBuffer(b.input, 0, (f16 ? new F16(host) : host) as unknown as BufferSource);
      await b.run();
      await d.queue.onSubmittedWorkDone();
      const firstMs = performance.now() - t1;
      outputs[name].push(await readBuffer(d, b.output, f16));
      const ms = await timed(WARM, async () => { await b.run(); await d.queue.onSubmittedWorkDone(); });
      const key = `${w}x${h}`;
      row[key] = ms;
      log(`${name.padEnd(8)} ${key.padEnd(10)} warm ${ms.toFixed(2)} ms (first bind+run ${firstMs.toFixed(0)} ms)`);
      if (profile && rt instanceof WgslRuntime && rt.lastProfile) {
        const total = rt.lastProfile.reduce((a, l) => a + l.ms, 0);
        log(`  per-layer GPU (sum ${total.toFixed(2)} ms): ${rt.lastProfile.map((l) => `${l.name} ${l.ms.toFixed(2)}`).join(' · ')}`);
        row[`${key}.profile`] = rt.lastProfile;
      }
      b.release();
    }
    net[name] = row;
    session.release();
    if (name === 'wgsl') await (rt as WgslRuntime).destroy();
  }
  const base = runtimes[0];
  const diffs: Record<string, number[]> = {};
  for (const name of runtimes.slice(1)) {
    diffs[name] = outputs[name].map((o, i) => {
      const r = outputs[base][i];
      let m = 0;
      for (let j = 0; j < o.length; j++) m = Math.max(m, Math.abs(o[j] - r[j]));
      return m;
    });
    log(`${name} vs ${base}: max |Δ| ${diffs[name].map((x) => x.toExponential(2)).join(' / ')}`);
  }
  results.net = net;
  results.maxAbsDiff = diffs;
}

(mode === 'net' ? netMode() : facadeMode())
  .then(() => { results.ready = true; })
  .catch((err) => {
    results.error = String(err?.stack ?? err);
    log(`ERROR: ${err?.stack ?? err}`);
  });
