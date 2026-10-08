// OIDN on @huggingface/kernels vs onnxruntime-web, same weights, same input.
//
// URL params (the kernels runtime is created once per page, so these reload):
//   ?precision=fp32|fp16   ?model=rt_ldr_small|rt_ldr   ?shared=1 (device workaround)
import * as ort from 'onnxruntime-web/webgpu';
import noisyUrl from '../../gallery/public/scenes/spheres/spp4.png?url';
import referenceUrl from '../../gallery/public/scenes/spheres/reference.png?url';
import { parseTZA, halfToFloat } from 'denoiser';
import { KernelsUNet, shareDeviceWithKernels, type KernelsPrecision as Precision } from 'denoiser/kernels';

const tzaUrls = import.meta.glob('../../../packages/denoiser/tzas/rt_ldr*.tza',
  { query: '?url', import: 'default', eager: true }) as Record<string, string>;
const onnxUrls = import.meta.glob('../../../packages/denoiser/models/rt_ldr*.onnx',
  { query: '?url', import: 'default', eager: true }) as Record<string, string>;
const byName = (urls: Record<string, string>, file: string) => {
  const hit = Object.entries(urls).find(([path]) => path.endsWith(`/${file}`));
  if (!hit) throw new Error(`${file} not found`);
  return hit[1];
};

const params = new URLSearchParams(location.search);
const precision = (params.get('precision') === 'fp16' ? 'fp16' : 'fp32') as Precision;
const model = params.get('model') === 'rt_ldr' ? 'rt_ldr' : 'rt_ldr_small';
const shared = params.get('shared') === '1';

const status = document.querySelector<HTMLPreElement>('#status')!;
const benchBtn = document.querySelector<HTMLButtonElement>('#bench')!;
const F16 = (globalThis as unknown as { Float16Array?: Float32ArrayConstructor }).Float16Array;

function log(msg: string) {
  status.textContent += msg + '\n';
  console.log(msg);
}

/** Machine-readable results for automated runs (read via window.__kernelsSmoke). */
const results: Record<string, unknown> = { precision, model, shared };
(window as unknown as { __kernelsSmoke: typeof results }).__kernelsSmoke = results;

// ---- setup controls --------------------------------------------------------

for (const sel of document.querySelectorAll<HTMLSelectElement>('select[data-param]')) {
  sel.value = params.get(sel.dataset.param!) ?? sel.options[0].value;
  sel.onchange = () => {
    params.set(sel.dataset.param!, sel.value);
    location.search = params.toString();
  };
}

// ---- image helpers ---------------------------------------------------------

async function loadImage(url: string): Promise<ImageData> {
  const img = new Image();
  img.src = url;
  await img.decode();
  const c = new OffscreenCanvas(img.width, img.height);
  const ctx = c.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  return ctx.getImageData(0, 0, img.width, img.height);
}

/** RGBA8 -> NCHW [1,3,H,W] in [0,1]. LDR models take display-encoded values as-is
 *  (same as the library's denoise() with srgb:true). */
function toNCHW(img: ImageData): Float32Array {
  const { width: w, height: h, data } = img;
  const px = w * h;
  const out = new Float32Array(3 * px);
  for (let i = 0; i < px; i++) {
    out[i] = data[i * 4] / 255;
    out[px + i] = data[i * 4 + 1] / 255;
    out[2 * px + i] = data[i * 4 + 2] / 255;
  }
  return out;
}

function toImage(nchw: Float32Array, w: number, h: number): ImageData {
  const px = w * h;
  const out = new ImageData(w, h);
  for (let i = 0; i < px; i++) {
    for (let c = 0; c < 3; c++) out.data[i * 4 + c] = Math.round(Math.min(1, Math.max(0, nchw[c * px + i])) * 255);
    out.data[i * 4 + 3] = 255;
  }
  return out;
}

function draw(id: string, img: ImageData) {
  const c = document.querySelector<HTMLCanvasElement>(`#${id}`)!;
  c.width = img.width;
  c.height = img.height;
  c.getContext('2d')!.putImageData(img, 0, 0);
}

/** |a-b| per pixel, amplified so small differences are visible. */
function diffImage(a: Float32Array, b: Float32Array, w: number, h: number, gain: number): ImageData {
  const px = w * h;
  const out = new ImageData(w, h);
  for (let i = 0; i < px; i++) {
    let m = 0;
    for (let c = 0; c < 3; c++) m = Math.max(m, Math.abs(a[c * px + i] - b[c * px + i]));
    const v = Math.min(255, m * gain * 255);
    out.data.set([v, v * 0.4, 0, 255], i * 4);
  }
  return out;
}

function psnr8(a: ImageData, b: ImageData): number {
  let se = 0;
  let n = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const d = a.data[i + c] - b.data[i + c];
      se += d * d;
      n++;
    }
  }
  const mse = se / n;
  return mse === 0 ? Infinity : 10 * Math.log10((255 * 255) / mse);
}

function floatDiff(a: Float32Array, b: Float32Array) {
  let max = 0;
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs(a[i] - b[i]);
    if (d > max) max = d;
    sum += d;
  }
  return { max, mean: sum / a.length };
}

const stats = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return { median: s[Math.floor(s.length / 2)], p90: s[Math.floor(s.length * 0.9)], min: s[0] };
};
const fmt = (ms: number) => `${ms.toFixed(1)} ms`;

// ---- ORT reference ----------------------------------------------------------

async function createOrt() {
  ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/';
  const file = `${model}${precision === 'fp16' ? '.fp16' : ''}.onnx`;
  const bytes = new Uint8Array(await (await fetch(byName(onnxUrls, file))).arrayBuffer());
  const session = await ort.InferenceSession.create(bytes, {
    executionProviders: ['webgpu'],
    graphOptimizationLevel: 'all',
  });
  const device = (ort.env.webgpu as unknown as { device: GPUDevice }).device;
  return { session, device, file };
}

async function runOrt(session: ort.InferenceSession, input: Float32Array, h: number, w: number) {
  const data = precision === 'fp16' ? new F16!(input) : input;
  const tensor = new ort.Tensor(precision === 'fp16' ? 'float16' : 'float32', data as Float32Array, [1, 3, h, w]);
  const out = await session.run({ [session.inputNames[0]]: tensor });
  const raw = (await out[session.outputNames[0]].getData()) as ArrayLike<number>;
  if (raw instanceof Float32Array) return raw;
  if (raw instanceof Uint16Array) return Float32Array.from(raw, halfToFloat);
  return Float32Array.from(raw);
}

// ---- shared-device proof ---------------------------------------------------

/** Copy a kernels-produced GPU buffer on OUR device. Succeeds only when kernels
 *  runs on that device — the zero-copy precondition. */
async function bufferUsableOn(device: GPUDevice, buffer: GPUBuffer): Promise<string | null> {
  device.pushErrorScope('validation');
  const dst = device.createBuffer({ size: 16, usage: GPUBufferUsage.COPY_DST });
  try {
    const enc = device.createCommandEncoder();
    enc.copyBufferToBuffer(buffer, 0, dst, 0, 16);
    device.queue.submit([enc.finish()]);
  } catch (err) {
    await device.popErrorScope();
    dst.destroy();
    return String(err);
  }
  const err = await device.popErrorScope();
  dst.destroy();
  return err ? err.message : null;
}

// ---- main ------------------------------------------------------------------

async function main() {
  log(`model ${model} · ${precision} · device ${shared ? 'SHARED with ORT (workaround)' : 'separate (kernels default)'}`);
  if (!navigator.gpu) throw new Error('WebGPU not available');

  const [noisy, reference, tzaBuf] = await Promise.all([
    loadImage(noisyUrl),
    loadImage(referenceUrl),
    fetch(byName(tzaUrls, `${model}.tza`)).then((r) => r.arrayBuffer()),
  ]);
  const { width: w, height: h } = noisy;
  draw('noisy', noisy);
  draw('reference', reference);
  const input = toNCHW(noisy);

  const ortT0 = performance.now();
  const { session, device, file } = await createOrt();
  log(`ORT session (${file}) ready in ${fmt(performance.now() - ortT0)} · adapter ${device.adapterInfo?.vendor ?? '?'} ${device.adapterInfo?.architecture ?? ''}`);
  results.adapter = { vendor: device.adapterInfo?.vendor, architecture: device.adapterInfo?.architecture };

  const restore = shared ? shareDeviceWithKernels(device) : undefined;
  const kT0 = performance.now();
  let net: KernelsUNet;
  try {
    net = await KernelsUNet.create(parseTZA(tzaBuf), precision);
  } finally {
    restore?.();
  }
  log(`kernels net ready (kernel fetch + weight upload) in ${fmt(performance.now() - kT0)} · ${net.large ? 'large' : 'standard'} topology`);

  // Does the kernels output live on ORT's device?
  const probe = await net.probe(input, h, w);
  const usable = await bufferUsableOn(device, probe.buffer);
  probe.destroy();
  results.sharedDeviceUsable = usable === null;
  log(usable === null
    ? 'kernels output buffer IS usable on the ORT device ✓ (zero-copy possible)'
    : `kernels output buffer NOT usable on the ORT device ✗ (${usable.split('\n')[0]})`);

  // Cold runs (include pipeline compile)
  let t = performance.now();
  const ortOut = await runOrt(session, input, h, w);
  const ortCold = performance.now() - t;
  t = performance.now();
  const kOut = await net.run(input, 1, h, w);
  const kCold = performance.now() - t;
  log(`first run: ORT ${fmt(ortCold)} · kernels ${fmt(kCold)} (${net.lastTimings?.ops} kernel calls)`);

  const ortImg = toImage(ortOut, w, h);
  const kImg = toImage(kOut, w, h);
  draw('ort', ortImg);
  draw('kernels', kImg);
  draw('diff', diffImage(kOut, ortOut, w, h, 50));

  const d = floatDiff(kOut, ortOut);
  const parity = psnr8(kImg, ortImg);
  const psnrOrt = psnr8(ortImg, reference);
  const psnrK = psnr8(kImg, reference);
  const psnrNoisy = psnr8(noisy, reference);
  Object.assign(results, {
    maxAbsDiff: d.max, meanAbsDiff: d.mean, parityPsnr: parity,
    psnrVsReference: { noisy: psnrNoisy, ort: psnrOrt, kernels: psnrK },
    coldMs: { ort: ortCold, kernels: kCold },
  });
  log(`parity kernels vs ORT: max |Δ| ${d.max.toExponential(2)} · mean |Δ| ${d.mean.toExponential(2)} · PSNR ${parity.toFixed(1)} dB`);
  log(`PSNR vs reference: noisy ${psnrNoisy.toFixed(2)} · ORT ${psnrOrt.toFixed(2)} · kernels ${psnrK.toFixed(2)} dB`);

  benchBtn.disabled = false;
  benchBtn.onclick = async () => {
    benchBtn.disabled = true;
    const N = 20;
    log(`benchmark ×${N} (warm, ${w}×${h}, host in → host out for both)…`);
    await runOrt(session, input, h, w);
    await net.run(input, 1, h, w);
    const ortTimes: number[] = [];
    const kTimes: number[] = [];
    for (let i = 0; i < N; i++) {
      let s = performance.now();
      await runOrt(session, input, h, w);
      ortTimes.push(performance.now() - s);
      s = performance.now();
      await net.run(input, 1, h, w);
      kTimes.push(performance.now() - s);
    }
    const o = stats(ortTimes);
    const k = stats(kTimes);
    results.bench = { n: N, ort: o, kernels: k };
    log(`ORT     median ${fmt(o.median)} · p90 ${fmt(o.p90)} · min ${fmt(o.min)}`);
    log(`kernels median ${fmt(k.median)} · p90 ${fmt(k.p90)} · min ${fmt(k.min)} → ${(o.median / k.median).toFixed(2)}× ORT`);
    benchBtn.disabled = false;
  };
  results.ready = true;
}

main().catch((err) => {
  results.error = String(err);
  log(`ERROR: ${err?.stack ?? err}`);
});
