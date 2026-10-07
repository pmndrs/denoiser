// The real Denoiser facade on two runtimes: default ORT vs the experimental
// KernelsRuntime. Same inputs, same API calls — only `runtime` differs.
//   facade.html?precision=fp32|fp16&zeroCopy=0|1
import { Denoiser } from 'denoiser';
import noisyUrl from '../../gallery/public/scenes/spheres/spp4.png?url';
import referenceUrl from '../../gallery/public/scenes/spheres/reference.png?url';
import albedoUrl from '../../gallery/public/scenes/spheres/albedo.png?url';
import normalUrl from '../../gallery/public/scenes/spheres/normal.png?url';
import { KernelsRuntime } from 'denoiser/kernels';

const params = new URLSearchParams(location.search);
const precision = params.get('precision') === 'fp16' ? 'fp16' : 'fp32';
const zeroCopy = params.get('zeroCopy') !== '0';
const WARM = 10;

const status = document.querySelector<HTMLPreElement>('#status')!;
const log = (m: string) => { status.textContent += m + '\n'; console.log(m); };
const results: Record<string, unknown> = { precision, zeroCopy };
(window as unknown as { __kernelsSmoke: typeof results }).__kernelsSmoke = results;

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

function draw(id: string, img: ImageData) {
  const c = document.querySelector<HTMLCanvasElement>(`#${id}`)!;
  c.width = img.width;
  c.height = img.height;
  c.getContext('2d')!.putImageData(img, 0, 0);
}

/** ImageData -> rgba16float texture of linear-ish floats in [0,1] on `device`. */
function toTexture(device: GPUDevice, img: ImageData): GPUTexture {
  const F16 = (globalThis as unknown as { Float16Array: Float32ArrayConstructor }).Float16Array;
  const half = new F16(img.data.length);
  for (let i = 0; i < img.data.length; i++) half[i] = img.data[i] / 255;
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

interface RunOutputs { color: ImageData; aux: ImageData; tex: Uint8Array; warmMs: number; warmAuxMs: number; warmHdMs: number; createMs: number }

/** The 512² scene stretched to 1920×1080 — for timing only. */
function upscaled(img: ImageData, w: number, h: number): ImageData {
  const src = new OffscreenCanvas(img.width, img.height);
  src.getContext('2d')!.putImageData(img, 0, 0);
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext('2d')!;
  ctx.drawImage(src, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

async function exercise(label: string, dn: Denoiser, createMs: number, noisy: ImageData, albedo: ImageData, normal: ImageData): Promise<RunOutputs> {
  const color = (await dn.denoise(noisy))!;
  const times: number[] = [];
  for (let i = 0; i < WARM; i++) {
    const t = performance.now();
    await dn.denoise(noisy);
    times.push(performance.now() - t);
  }
  const aux = (await dn.denoise(noisy, { albedo, normal }))!;
  const auxModel = dn.modelName;
  const auxTimes: number[] = [];
  for (let i = 0; i < WARM; i++) {
    const t = performance.now();
    await dn.denoise(noisy, { albedo, normal });
    auxTimes.push(performance.now() - t);
  }
  const hd = upscaled(noisy, 1920, 1080);
  await dn.denoise(hd);
  const hdTimes: number[] = [];
  for (let i = 0; i < WARM; i++) {
    const t = performance.now();
    await dn.denoise(hd);
    hdTimes.push(performance.now() - t);
  }
  const ct = toTexture(dn.device, noisy);
  const texOut = (await dn.denoiseTextures({ color: ct }))!;
  const tex = await readTexture(dn.device, texOut);
  ct.destroy();
  log(`${label.padEnd(8)} create ${createMs.toFixed(0)} ms · warm 512² ${median(times).toFixed(1)} ms · aux (${auxModel}) ${median(auxTimes).toFixed(1)} ms · 1920×1080 ${median(hdTimes).toFixed(1)} ms`);
  return { color, aux, tex, warmMs: median(times), warmAuxMs: median(auxTimes), warmHdMs: median(hdTimes), createMs };
}

async function main() {
  const [noisy, reference, albedo, normal] = await Promise.all(
    [noisyUrl, referenceUrl, albedoUrl, normalUrl].map(loadImage));
  draw('noisy', noisy);
  draw('reference', reference);
  log(`Denoiser facade · ${precision} · kernels ${zeroCopy ? 'zero-copy' : 'readback'} IO · spheres 512² · warm = median of ${WARM}`);

  let t = performance.now();
  const ortDn = await Denoiser.create({ precision, weightsUrl: '/models' });
  const ort = await exercise('ORT', ortDn, performance.now() - t, noisy, albedo, normal);
  ortDn.destroyDevice();

  t = performance.now();
  const runtime = new KernelsRuntime({ tzaUrl: '/tzas', zeroCopy });
  const kDn = await Denoiser.create({ precision, runtime });
  const k = await exercise('kernels', kDn, performance.now() - t, noisy, albedo, normal);
  kDn.destroyDevice();

  draw('ort', ort.color);
  draw('kernels', k.color);
  draw('ortAux', ort.aux);
  draw('kernelsAux', k.aux);

  const cmp = (name: string, a: ArrayLike<number>, b: ArrayLike<number>) => {
    const r = { psnr: psnr(a, b), maxByteDiff: maxByteDiff(a, b) };
    log(`${name.padEnd(22)} kernels vs ORT: PSNR ${r.psnr === Infinity ? 'inf' : r.psnr.toFixed(1)} dB · max byte Δ ${r.maxByteDiff}`);
    return r;
  };
  results.parity = {
    color: cmp('denoise()', k.color.data, ort.color.data),
    aux: cmp('denoise() + aux', k.aux.data, ort.aux.data),
    texture: cmp('denoiseTextures()', k.tex, ort.tex),
  };
  const vsRef = {
    ort: psnr(ort.color.data, reference.data), kernels: psnr(k.color.data, reference.data),
    ortAux: psnr(ort.aux.data, reference.data), kernelsAux: psnr(k.aux.data, reference.data),
  };
  results.psnrVsReference = vsRef;
  log(`PSNR vs reference: color ORT ${vsRef.ort.toFixed(2)} / kernels ${vsRef.kernels.toFixed(2)} · aux ORT ${vsRef.ortAux.toFixed(2)} / kernels ${vsRef.kernelsAux.toFixed(2)} dB`);
  results.bench = {
    ort: { createMs: ort.createMs, warmMs: ort.warmMs, warmAuxMs: ort.warmAuxMs, warmHdMs: ort.warmHdMs },
    kernels: { createMs: k.createMs, warmMs: k.warmMs, warmAuxMs: k.warmAuxMs, warmHdMs: k.warmHdMs },
  };
  results.ready = true;
}

main().catch((err) => {
  results.error = String(err);
  log(`ERROR: ${err?.stack ?? err}`);
});
