// The lab's benchmark: one fixed shot through the whole pipeline, timed per stage and scored
// against a high-sample reference render.
//
//   1. path trace   reset (stable noise: the same image every run), accumulate to N samples;
//                   3 runs, the best of the last two
//   2. denoise      first run of this model in the page (load + compile) + warm runs, median
//   3. upscale      warm runs, median ("off" scores the tracer's bilinear stretch, 0 ms)
//   4. quality      PSNR (8-bit, after ACES + sRGB) against references traced at the render
//                   and output sizes: noisy and denoised at the render size, final at the output size
//
// Times are wall clock from submit to GPU-done, so they include queue overhead. References are
// cached per scene / size / bounces / sample count for the page's lifetime.
import * as THREE from 'three/webgpu';
import { acesFilmicToneMapping, float, ivec2, screenUV, sRGBTransferOETF, textureLoad, vec2, vec4 } from 'three/tsl';
import { accumulateTo } from '../../_shared/pathtracer';
import type { DenoiserPass, UpscalerPass, UpscalePath } from './passes';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;

export interface BenchConfig {
  scene: string;
  output: [number, number];
  renderScale: number;
  spp: number;
  bounces: number;
  denoise: boolean;
  aux: boolean;
  model: string;
  upscale: UpscalePath | 'off';
  sharpness: number;
  refSpp: number;
  warmRuns: number;
}

export interface BenchResult {
  when: string;
  runtime: string;
  config: BenchConfig;
  render: [number, number];
  traceMs: number;
  samplesPerSec: number;
  denoiseColdMs: number | null;
  denoiseWarmMs: number | null;
  upscaleMs: number;
  totalMs: number;
  psnrNoisy: number;
  psnrDenoised: number | null;
  psnrFinal: number;
  env: { gpu: string; browser: string };
}

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

function psnr(a: Uint8Array, b: Uint8Array) {
  let se = 0, n = 0;
  for (let i = 0; i < a.length; i += 4) for (let c = 0; c < 3; c++) { const d = a[i + c] - b[i + c]; se += d * d; n++; }
  return se === 0 ? 99 : 10 * Math.log10((255 * 255) / (se / n));
}

/**
 * Reads a linear-HDR texture back as 8-bit display pixels (ACES + sRGB, as the canvas shows
 * it). One reader per texture type: the bind layout follows the type of the first texture.
 */
function displayReader(renderer: THREE.WebGPURenderer, type: THREE.TextureDataType) {
  const placeholder = new THREE.StorageTexture(1, 1);
  placeholder.type = type;
  renderer.initTexture(placeholder);
  const node = textureLoad(placeholder, ivec2(0, 0)) as N;
  node.uvNode = ivec2(screenUV.mul(vec2(node.size(0))).floor());
  const mat = new THREE.MeshBasicNodeMaterial();
  mat.toneMapped = false;
  mat.colorNode = vec4((sRGBTransferOETF as N)((acesFilmicToneMapping as N)(node.rgb, float(1))), 1);
  const quad = new THREE.QuadMesh(mat);
  const rt = new THREE.RenderTarget(1, 1, { depthBuffer: false });
  rt.texture.colorSpace = THREE.NoColorSpace;
  return async (tex: THREE.Texture) => {
    const { width, height } = tex as unknown as { width: number; height: number };
    node.value = tex;
    rt.setSize(width, height);
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(rt);
    quad.render(renderer);
    renderer.setRenderTarget(prev);
    return new Uint8Array((await renderer.readRenderTargetPixelsAsync(rt, 0, 0, width, height)).buffer);
  };
}

export interface BenchDeps {
  renderer: THREE.WebGPURenderer;
  device: GPUDevice;
  pathTracer: N;
  camera: () => THREE.Camera;
  denoisePass: DenoiserPass;
  upscalePass: UpscalerPass;
  runtime: () => string;
  log: (m: string) => void;
}

const references = new Map<string, Uint8Array>();

export function createBench(d: BenchDeps) {
  const readFloat = displayReader(d.renderer, THREE.FloatType);
  const readHalf = displayReader(d.renderer, THREE.HalfFloatType);
  const { pathTracer: pt } = d;

  /** Traces `spp` samples at `scale` x the canvas and returns the 8-bit image (cached). */
  async function reference(c: BenchConfig, scale: number) {
    const key = `${c.scene}|${c.output}|${scale}|${c.bounces}|${c.refSpp}`;
    const hit = references.get(key);
    if (hit) return hit;
    d.log(`tracing the ${scale === 1 ? 'output' : 'render'}-size reference (${c.refSpp} spp)…`);
    pt.renderScale = scale;
    pt.reset();
    await accumulateTo(pt, d.device, c.refSpp, 600_000);
    const img = await readFloat(pt.target);
    references.set(key, img);
    return img;
  }

  return async function run(c: BenchConfig): Promise<BenchResult> {
    const { denoisePass, upscalePass } = d;
    pt.setDenoiser(null); // the benchmark drives both passes itself
    pt.setUpscaler(null);
    pt.maxBounces = c.bounces;
    const scale = c.renderScale;

    const refOut = await reference(c, 1);
    const refRender = scale === 1 ? refOut : await reference(c, scale);

    // 1. path trace
    d.log(`path tracing ${c.spp} spp…`);
    pt.renderScale = scale;
    const traceRuns: number[] = [];
    for (let i = 0; i < 3; i++) { // the first run also pays for size changes and pipeline warm-up
      pt.reset();
      await d.device.queue.onSubmittedWorkDone();
      const t0 = performance.now();
      await accumulateTo(pt, d.device, c.spp);
      traceRuns.push(performance.now() - t0);
    }
    const traceMs = Math.min(...traceRuns.slice(1));
    const noisy: THREE.Texture = pt.target;
    const { width: rw, height: rh } = noisy as unknown as { width: number; height: number };
    const psnrNoisy = psnr(await readFloat(noisy), refRender);

    // 2. denoise
    let denoised: THREE.Texture | null = null;
    let denoiseColdMs: number | null = null;
    let denoiseWarmMs: number | null = null;
    let psnrDenoised: number | null = null;
    if (c.denoise) {
      denoisePass.useAux = c.aux;
      // cold = the first denoise with this model and size in this page, whoever ran it
      // (the live view usually has by the time the benchmark starts)
      if (!denoisePass.coldMs.has(denoisePass.modelKey(rw, rh))) {
        d.log('denoise (cold: model load + first run)…');
        await denoisePass.run(noisy);
      }
      denoiseColdMs = denoisePass.coldMs.get(denoisePass.modelKey(rw, rh)) ?? null;
      const warm: number[] = [];
      for (let i = 0; i < c.warmRuns; i++) {
        d.log(`denoise (warm ${i + 1}/${c.warmRuns})…`);
        const tw = performance.now();
        denoised = await denoisePass.run(noisy);
        warm.push(performance.now() - tw);
      }
      denoiseWarmMs = median(warm);
      if (!denoised) throw new Error('denoise returned nothing');
      psnrDenoised = psnr(await readHalf(denoised), refRender);
    }
    const source = denoised ?? noisy;

    // 3. upscale ("off" = the tracer's bilinear stretch: scored as the bilinear path, 0 ms)
    upscalePass.path = c.upscale === 'off' ? 'bilinear' : c.upscale;
    upscalePass.sharpness = c.sharpness;
    await upscalePass.warm(source, d.camera());
    const times: number[] = [];
    for (let i = 0; i < Math.max(3, c.warmRuns); i++) {
      const tu = performance.now();
      upscalePass.upscale(source, d.camera());
      await d.device.queue.onSubmittedWorkDone();
      times.push(performance.now() - tu);
    }
    const upscaleMs = c.upscale === 'off' ? 0 : median(times);
    const finalImg = await readHalf(upscalePass.output);
    const psnrFinal = psnr(finalImg, refOut);

    const info = (d.device as N).adapterInfo ?? {};
    return {
      when: new Date().toISOString(),
      runtime: d.runtime(),
      config: c,
      render: [rw, rh],
      traceMs,
      samplesPerSec: (c.spp * 1000) / traceMs,
      denoiseColdMs,
      denoiseWarmMs,
      upscaleMs,
      totalMs: traceMs + (denoiseWarmMs ?? 0) + upscaleMs,
      psnrNoisy, psnrDenoised, psnrFinal,
      env: {
        gpu: [info.vendor, info.architecture, info.description].filter(Boolean).join(' ') || 'unknown',
        browser: navigator.userAgent,
      },
    };
  };
}

const f = (v: number | null, digits = 1) => (v === null ? '—' : v.toFixed(digits));

export const RESULT_COLUMNS: [string, (r: BenchResult) => string][] = [
  ['runtime', (r) => r.runtime],
  ['scene', (r) => r.config.scene],
  ['render → output', (r) => `${r.render[0]}×${r.render[1]} → ${r.config.output[0]}×${r.config.output[1]}`],
  ['spp', (r) => String(r.config.spp)],
  ['model', (r) => (r.config.denoise ? `${r.config.model}${r.config.aux ? ' +aux' : ''}` : 'off')],
  ['upscale', (r) => r.config.upscale],
  ['trace ms', (r) => f(r.traceMs)],
  ['denoise first', (r) => f(r.denoiseColdMs)],
  ['denoise warm', (r) => f(r.denoiseWarmMs)],
  ['upscale ms', (r) => f(r.upscaleMs, 2)],
  ['total ms', (r) => f(r.totalMs)],
  ['PSNR noisy', (r) => f(r.psnrNoisy, 2)],
  ['PSNR denoised', (r) => f(r.psnrDenoised, 2)],
  ['PSNR final', (r) => f(r.psnrFinal, 2)],
];

export function toMarkdown(results: BenchResult[]) {
  const head = RESULT_COLUMNS.map(([k]) => k);
  const rows = results.map((r) => RESULT_COLUMNS.map(([, g]) => g(r)));
  const env = results[0]?.env;
  return [
    env ? `GPU: ${env.gpu}  \nBrowser: ${env.browser}\n` : '',
    `| ${head.join(' | ')} |`,
    `| ${head.map(() => '---').join(' | ')} |`,
    ...rows.map((r) => `| ${r.join(' | ')} |`),
    '',
    `PSNR against a ${results[0]?.config.refSpp ?? '?'} spp reference, 8-bit after ACES + sRGB. Times: wall clock, submit to GPU done.`,
  ].join('\n');
}
