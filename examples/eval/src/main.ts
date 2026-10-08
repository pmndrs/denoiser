// Runs every (scene, model) case from tools/eval/out/plan.json on ONE runtime +
// precision (one page load per runtime, so devices never interfere):
//   - quality: denoiseTextures on the 512² inputs -> compared in-page against
//     native OIDN CPU (ground truth) and Metal outputs, and the converged
//     reference where the scene has one
//   - speed: cold (first call at a size, includes compile) + warm median/min of
//     denoiseTextures -> engine texture at 512² and 1920×1080
// Results land on window.__eval for run.mjs.
//
// TiledEngine is used directly (not the Denoiser facade) so every model is
// reachable — the facade only picks color / +albedo / clean-aux variants.
import { TiledEngine, OrtRuntime, type NetworkRuntime, type Precision } from 'denoiser';
import { KernelsRuntime } from 'denoiser/kernels';
import { WgslRuntime } from 'denoiser/wgsl';
import { WebnnRuntime } from 'denoiser/webnn';
import { AutoRuntime } from 'denoiser/auto';

interface PlanItem {
  scene: string; model: string; channels: number; hdr: boolean;
  inputs: Record<'512' | '1080', Record<string, string>>;
  native: { cpu: string; metal: string };
}
interface Img { w: number; h: number; rgb: Float32Array }

const params = new URLSearchParams(location.search);
const runtimeName = params.get('runtime') ?? 'ort';
const precision = (params.get('precision') === 'fp16' ? 'fp16' : 'fp32') as Precision;
const only = params.get('only') ? new RegExp(params.get('only')!) : undefined;
const WARM = Number(params.get('warm') ?? 10);
const F16 = (globalThis as unknown as { Float16Array: Float32ArrayConstructor }).Float16Array;

const statusEl = document.querySelector<HTMLPreElement>('#status')!;
const log = (m: string) => { statusEl.textContent += m + '\n'; console.log(m); };
const state: { done: boolean; error?: string; runtime: string; precision: string; results: unknown[] } =
  { done: false, runtime: runtimeName, precision, results: [] };
(window as unknown as { __eval: typeof state }).__eval = state;

function makeRuntime(): NetworkRuntime {
  switch (runtimeName) {
    case 'ort': return new OrtRuntime({ weightsUrl: '/models' });
    case 'kernels': return new KernelsRuntime({ tzaUrl: '/tzas' });
    case 'wgsl': return new WgslRuntime({ tzaUrl: '/tzas' });
    // the kernel everyone gets today (no experimental subgroup-matrix feature)
    case 'wgsl-portable': return new WgslRuntime({ tzaUrl: '/tzas', subgroupMatrix: false });
    // WebNN (Chrome: CoreML on macOS); webnn-npu = Neural Engine when Chrome runs
    // with WebNNCoreMLExplicitGPUOrNPU (run.mjs enables it), else same as gpu
    case 'webnn': return new WebnnRuntime({ tzaUrl: '/tzas', deviceType: 'gpu' });
    case 'webnn-npu': return new WebnnRuntime({ tzaUrl: '/tzas', deviceType: 'npu' });
    case 'auto': return new AutoRuntime({ tzaUrl: '/tzas' });
    default: throw new Error(`unknown runtime ${runtimeName}`);
  }
}

// ---- data -------------------------------------------------------------------

const pfmCache = new Map<string, Promise<Img>>();
function loadPfm(path: string): Promise<Img> {
  let p = pfmCache.get(path);
  if (!p) {
    p = (async () => {
      const buf = await (await fetch(`/eval/${path}`)).arrayBuffer();
      const bytes = new Uint8Array(buf);
      let off = 0;
      const line = () => {
        const s = off;
        while (bytes[off] !== 0x0a) off++;
        return new TextDecoder().decode(bytes.subarray(s, off++)).trim();
      };
      if (line() !== 'PF') throw new Error(`${path}: not an RGB PFM`);
      const [w, h] = line().split(/\s+/).map(Number);
      if (Number(line()) >= 0) throw new Error(`${path}: big-endian PFM unsupported`);
      const raw = new Float32Array(buf.slice(off, off + w * h * 12));
      const rgb = new Float32Array(w * h * 3);
      for (let y = 0; y < h; y++) rgb.set(raw.subarray((h - 1 - y) * w * 3, (h - y) * w * 3), y * w * 3); // bottom-up
      return { w, h, rgb };
    })();
    pfmCache.set(path, p);
  }
  return p;
}

function toTexture(device: GPUDevice, img: Img): GPUTexture {
  const half = new F16(img.w * img.h * 4);
  for (let i = 0; i < img.w * img.h; i++) {
    half[i * 4] = img.rgb[i * 3];
    half[i * 4 + 1] = img.rgb[i * 3 + 1];
    half[i * 4 + 2] = img.rgb[i * 3 + 2];
    half[i * 4 + 3] = 1;
  }
  const tex = device.createTexture({
    size: { width: img.w, height: img.h }, format: 'rgba16float',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  device.queue.writeTexture({ texture: tex }, half as unknown as BufferSource, { bytesPerRow: img.w * 8 }, { width: img.w, height: img.h });
  return tex;
}

async function readTexture(device: GPUDevice, tex: GPUTexture): Promise<Img> {
  const { width: w, height: h } = tex;
  const bpr = Math.ceil((w * 8) / 256) * 256;
  const buf = device.createBuffer({ size: bpr * h, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const enc = device.createCommandEncoder();
  enc.copyTextureToBuffer({ texture: tex }, { buffer: buf, bytesPerRow: bpr }, { width: w, height: h });
  device.queue.submit([enc.finish()]);
  await buf.mapAsync(GPUMapMode.READ);
  const mapped = buf.getMappedRange();
  const rgb = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    const row = new F16(mapped, y * bpr, w * 4);
    for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) rgb[(y * w + x) * 3 + c] = row[x * 4 + c];
  }
  buf.unmap();
  buf.destroy();
  return { w, h, rgb };
}

// ---- metrics ------------------------------------------------------------------

/** Display mapping for comparisons: LDR clamps to [0,1]; HDR tonemaps x/(1+x), gamma 2.2. */
const display = (v: number, hdr: boolean) => {
  const x = Math.max(0, v);
  return hdr ? Math.pow(x / (1 + x), 1 / 2.2) : Math.min(1, x);
};

function compare(a: Img, b: Img, hdr: boolean) {
  let se = 0;
  let maxByte = 0;
  let maxAbs = 0;
  for (let i = 0; i < a.rgb.length; i++) {
    const da = display(a.rgb[i], hdr);
    const db = display(b.rgb[i], hdr);
    se += (da - db) ** 2;
    maxByte = Math.max(maxByte, Math.abs(Math.round(da * 255) - Math.round(db * 255)));
    maxAbs = Math.max(maxAbs, Math.abs(a.rgb[i] - b.rgb[i]));
  }
  const mse = se / a.rgb.length;
  return { psnr: mse === 0 ? Infinity : 10 * Math.log10(1 / mse), maxByte, maxAbs };
}

const stats = (xs: number[]) => {
  const s = [...xs].sort((p, q) => p - q);
  return { median: s[Math.floor(s.length / 2)], min: s[0] };
};

// ---- run ----------------------------------------------------------------------

async function main() {
  const plan = (await (await fetch('/eval/plan.json')).json() as PlanItem[])
    .filter((p) => !only || only.test(`${p.scene}/${p.model}`));
  log(`${runtimeName} · ${precision} · ${plan.length} cases · warm = median of ${WARM}`);
  const runtime = makeRuntime();
  let firstDevice: GPUDevice | undefined;
  let prev: TiledEngine | undefined;

  for (const item of plan) {
    const key = `${item.scene}/${item.model}`;
    const r: Record<string, unknown> = { scene: item.scene, model: item.model, channels: item.channels, hdr: item.hdr };
    try {
      const t0 = performance.now();
      const engine = await TiledEngine.load(runtime, { name: item.model, channels: item.channels, precision });
      r.loadMs = performance.now() - t0;
      // Create the next engine before releasing the previous one: with ORT, releasing
      // the last session destroys the shared GPUDevice.
      prev?.destroy();
      prev = engine;
      const dev = engine.device;
      // AutoRuntime: which runtime served this model, and is the device stable across switches
      if (runtime instanceof AutoRuntime) r.choice = runtime.lastChoice;
      firstDevice ??= dev;
      r.sameDevice = dev === firstDevice;

      const inputs = async (size: '512' | '1080') => {
        const files = item.inputs[size];
        const color = toTexture(dev, await loadPfm(files.color));
        const albedo = item.channels >= 6 ? toTexture(dev, await loadPfm(files.albedo)) : undefined;
        const normal = item.channels >= 9 ? toTexture(dev, await loadPfm(files.normal)) : undefined;
        return { color, albedo, normal, destroy: () => [color, albedo, normal].forEach((t) => t?.destroy()) };
      };
      // LDR inputs are display-encoded (native --srgb): the engine's srgb flag means
      // "linear input, apply the transfer", so it stays off — same as Denoiser.denoise().
      const opts = { hdr: item.hdr, srgb: false };

      // quality @ 512
      const q = await inputs('512');
      const outTex = dev.createTexture({
        size: { width: q.color.width, height: q.color.height }, format: 'rgba16float',
        usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC,
      });
      await engine.denoiseTextures(q, { ...opts, outputTexture: outTex });
      const out = await readTexture(dev, outTex);
      outTex.destroy();
      const [cpu, metal] = await Promise.all([loadPfm(item.native.cpu), loadPfm(item.native.metal)]);
      r.vsNativeCpu = compare(out, cpu, item.hdr);
      r.vsNativeMetal = compare(out, metal, item.hdr);
      if (item.inputs['512'].reference) {
        const ref = await loadPfm(item.inputs['512'].reference);
        r.vsReference = compare(out, ref, item.hdr).psnr;
        r.nativeVsReference = compare(cpu, ref, item.hdr).psnr;
      }
      q.destroy();

      // speed @ 512 and 1080p: denoiseTextures -> engine-owned texture (awaits the queue)
      const time: Record<string, unknown> = {};
      for (const size of ['512', '1080'] as const) {
        const t = size === '512' ? await inputs('512') : await inputs('1080');
        let s = performance.now();
        await engine.denoiseTextures(t, { ...opts, toTexture: true });
        const cold = performance.now() - s;
        await engine.denoiseTextures(t, { ...opts, toTexture: true });
        const xs: number[] = [];
        for (let i = 0; i < WARM; i++) {
          s = performance.now();
          await engine.denoiseTextures(t, { ...opts, toTexture: true });
          xs.push(performance.now() - s);
        }
        time[size] = { cold, ...stats(xs) };
        t.destroy();
      }
      r.time = time;
      const v = r.vsNativeCpu as { psnr: number; maxByte: number };
      const tm = time as Record<string, { median: number }>;
      log(`${key.padEnd(34)} vs native ${v.psnr === Infinity ? 'inf' : v.psnr.toFixed(1)} dB (Δ${v.maxByte}) · `
        + `512 ${tm['512'].median.toFixed(1)} ms · 1080 ${tm['1080'].median.toFixed(1)} ms`);
    } catch (err) {
      r.error = String(err);
      log(`${key.padEnd(34)} ERROR ${err}`);
    }
    state.results.push(r);
  }
  prev?.destroy();
  state.done = true;
  log('DONE');
}

main().catch((err) => {
  state.error = String(err);
  state.done = true;
  log(`ERROR: ${err?.stack ?? err}`);
});
