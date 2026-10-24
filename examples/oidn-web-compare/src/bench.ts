// The benchmark: for each output size, one fixed shot of the scene, traced once at N samples,
// handed to every contender in turn.
//
//   1. reference   traced at many samples (cached per scene / size / bounces / samples)
//   2. noisy       traced at N samples, frozen into a texture; one G-buffer for everyone
//   3. each contender, one at a time (nothing else on the GPU):
//        first     the first run of this model + size in the page: weights download, parse,
//                  shader compile, then the denoise. Whoever got there first in the live view
//                  already paid it, so it's reported from the page-wide log.
//        warm      N more runs: median, min, max
//        quality   PSNR against the reference, 8-bit after ACES + sRGB (as the canvas shows it),
//                  and against our output (how closely the two implementations agree)
//
// Times are wall clock from the call until the output texture is written and the GPU queue has
// drained, so they include CPU overhead and the library's own tile scheduling.
import * as THREE from 'three/webgpu';
import { acesFilmicToneMapping, float, ivec2, screenUV, sRGBTransferOETF, textureLoad, vec2, vec4 } from 'three/tsl';
import { accumulateTo } from '../../_shared/pathtracer';
import type { Contender, GBuffer, Inputs, Quality } from './contenders';
import { modelFor } from './contenders';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;

export interface BenchConfig {
  scene: string;
  sizes: [number, number][];
  spp: number;
  bounces: number;
  quality: Quality;
  aux: boolean;
  refSpp: number;
  warmRuns: number;
  contenders: string[];
}

export interface BenchRow {
  when: string;
  scene: string;
  size: [number, number];
  spp: number;
  model: string;
  contender: string;
  label: string;
  detail: string;
  firstMs: number | null;
  warmMedianMs: number;
  warmMinMs: number;
  warmMaxMs: number;
  runs: number;
  psnrNoisy: number;
  psnr: number;
  psnrVsOurs: number | null;
  env: { gpu: string; browser: string; runtime: string; precision: string };
}

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

export function psnr(a: Uint8Array, b: Uint8Array) {
  let se = 0, n = 0;
  for (let i = 0; i < a.length; i += 4) for (let c = 0; c < 3; c++) { const d = a[i + c] - b[i + c]; se += d * d; n++; }
  return se === 0 ? 99 : 10 * Math.log10((255 * 255) / (se / n));
}

/**
 * Reads a linear-HDR texture back as 8-bit display pixels (ACES + sRGB, as the canvas shows
 * it). One reader per texture type: the bind layout follows the type of the first texture.
 */
export function displayReader(renderer: THREE.WebGPURenderer, type: THREE.TextureDataType) {
  const placeholder = new THREE.StorageTexture(1, 1);
  placeholder.type = type;
  renderer.initTexture(placeholder);
  const node = textureLoad(placeholder, ivec2(0, 0)) as N;
  node.uvNode = ivec2(screenUV.mul(vec2(node.size(0))).floor());
  const mat = new THREE.MeshBasicNodeMaterial();
  mat.colorNode = vec4((sRGBTransferOETF as N)((acesFilmicToneMapping as N)(node.rgb, float(1))), 1);
  const quad = new THREE.QuadMesh(mat);
  const rt = new THREE.RenderTarget(1, 1, { depthBuffer: false });
  rt.texture.colorSpace = THREE.NoColorSpace;
  return async (tex: THREE.Texture) => {
    const { width, height } = tex.image as { width: number; height: number };
    node.value = tex;
    rt.setSize(width, height);
    const prev = renderer.getRenderTarget();
    const prevTone = renderer.toneMapping;
    renderer.toneMapping = THREE.NoToneMapping; // applied above; the renderer would add it again
    renderer.setRenderTarget(rt);
    quad.render(renderer);
    renderer.setRenderTarget(prev);
    renderer.toneMapping = prevTone;
    return new Uint8Array((await renderer.readRenderTargetPixelsAsync(rt, 0, 0, width, height)).buffer);
  };
}

/** Copies the tracer's accumulation (rgba32float) into `dst`, (re)allocating it to match. */
export function snapshot(renderer: THREE.WebGPURenderer, src: THREE.Texture, dst: THREE.StorageTexture | null) {
  const { width, height } = src.image as { width: number; height: number };
  if (!dst || dst.width !== width || dst.height !== height) {
    dst?.dispose();
    dst = new THREE.StorageTexture(width, height);
    dst.type = THREE.FloatType;
    dst.generateMipmaps = false;
    dst.colorSpace = THREE.LinearSRGBColorSpace;
    renderer.initTexture(dst);
  }
  renderer.copyTextureToTexture(src, dst);
  return dst;
}

export interface BenchDeps {
  renderer: THREE.WebGPURenderer;
  device: GPUDevice;
  pathTracer: N;
  gbuffer: GBuffer;
  contenders: Contender[];
  /** Resizes the canvas + camera; resolves once the tracer has picked the new size up. */
  setSize(w: number, h: number): void;
  sceneCamera(): { scene: THREE.Scene; camera: THREE.Camera };
  /** Page-wide first-run log: `${contender}|${model}|${w}x${h}` → ms. */
  firstRuns: Map<string, number>;
  runtime: () => string;
  precision: string;
  log: (m: string) => void;
}

const references = new Map<string, THREE.StorageTexture>();

export function createBench(d: BenchDeps) {
  const readFloat = displayReader(d.renderer, THREE.FloatType);
  const readHalf = displayReader(d.renderer, THREE.HalfFloatType);
  const pt = d.pathTracer;
  let color: THREE.StorageTexture | null = null;

  async function reference(c: BenchConfig, w: number, h: number) {
    const key = `${c.scene}|${w}x${h}|${c.bounces}|${c.refSpp}`;
    let ref = references.get(key);
    if (ref) return ref;
    d.log(`${w}×${h}: tracing the reference (${c.refSpp} spp)…`);
    pt.reset();
    await accumulateTo(pt, d.device, c.refSpp, 600_000);
    ref = snapshot(d.renderer, pt.target, null);
    references.set(key, ref);
    return ref;
  }

  return async function run(c: BenchConfig, onRow: (r: BenchRow) => void): Promise<BenchRow[]> {
    const rows: BenchRow[] = [];
    const info = (d.device as N).adapterInfo ?? {};
    const env = {
      gpu: [info.vendor, info.architecture, info.description].filter(Boolean).join(' ') || 'unknown',
      browser: navigator.userAgent,
      runtime: d.runtime(),
      precision: d.precision,
    };
    const model = modelFor(c.quality, c.aux);
    pt.maxBounces = c.bounces;
    // ours first: everyone else is also scored against its output
    const order = [...d.contenders].sort((a, b) => Number(b.id === 'ours') - Number(a.id === 'ours'))
      .filter((x) => c.contenders.includes(x.id) && !x.unavailable);

    for (const [w, h] of c.sizes) {
      d.setSize(w, h);
      const refTex = await reference(c, w, h);
      const refImg = await readFloat(refTex);

      d.log(`${w}×${h}: tracing ${c.spp} spp…`);
      pt.reset();
      await accumulateTo(pt, d.device, c.spp);
      color = snapshot(d.renderer, pt.target, color);
      const { scene, camera } = d.sceneCamera();
      const g = d.gbuffer.render(d.renderer, scene, camera, w, h);
      const inputs: Inputs = { color, ...g, width: w, height: h, epoch: -1 };
      const psnrNoisy = psnr(await readFloat(color), refImg);

      let oursImg: Uint8Array | null = null;
      for (const ct of order) {
        const key = `${ct.id}|${model}|${w}x${h}`;
        try {
          if (!d.firstRuns.has(key)) {
            d.log(`${w}×${h}: ${ct.label} — first run (weights + compile)…`);
            const r = await ct.run(inputs, { quality: c.quality, aux: c.aux });
            d.firstRuns.set(key, r.ms);
          }
          const times: number[] = [];
          let last = null as Awaited<ReturnType<Contender['run']>> | null;
          for (let i = 0; i < c.warmRuns; i++) {
            d.log(`${w}×${h}: ${ct.label} — warm ${i + 1}/${c.warmRuns}…`);
            last = await ct.run(inputs, { quality: c.quality, aux: c.aux });
            times.push(last.ms);
          }
          const img = await readHalf(last!.output);
          if (ct.id === 'ours') oursImg = img;
          const row: BenchRow = {
            when: new Date().toISOString(), scene: c.scene, size: [w, h], spp: c.spp, model,
            contender: ct.id, label: ct.label, detail: last!.detail,
            firstMs: d.firstRuns.get(key) ?? null,
            warmMedianMs: median(times), warmMinMs: Math.min(...times), warmMaxMs: Math.max(...times), runs: times.length,
            psnrNoisy, psnr: psnr(img, refImg),
            psnrVsOurs: oursImg && ct.id !== 'ours' ? psnr(img, oursImg) : null,
            env,
          };
          rows.push(row);
          onRow(row);
        } catch (e) {
          d.log(`${ct.label} failed at ${w}×${h}: ${(e as Error).message}`);
          console.error(e);
        }
      }
    }
    return rows;
  };
}

const f = (v: number | null, digits = 1) => (v === null ? '—' : v.toFixed(digits));

export const ROW_COLUMNS: [string, (r: BenchRow) => string][] = [
  ['denoiser', (r) => r.label],
  ['size', (r) => `${r.size[0]}×${r.size[1]}`],
  ['model', (r) => r.model],
  ['first ms', (r) => f(r.firstMs)],
  ['warm median', (r) => f(r.warmMedianMs)],
  ['min', (r) => f(r.warmMinMs)],
  ['max', (r) => f(r.warmMaxMs)],
  ['PSNR noisy', (r) => f(r.psnrNoisy, 2)],
  ['PSNR', (r) => f(r.psnr, 2)],
  ['vs ours', (r) => f(r.psnrVsOurs, 2)],
  ['detail', (r) => r.detail],
];

export function toMarkdown(rows: BenchRow[]) {
  const head = ROW_COLUMNS.map(([k]) => k);
  const env = rows[0]?.env;
  return [
    env ? `GPU: ${env.gpu}  \nBrowser: ${env.browser}  \nour runtime: ${env.runtime}, precision ${env.precision}\n` : '',
    `| ${head.join(' | ')} |`,
    `| ${head.map(() => '---').join(' | ')} |`,
    ...rows.map((r) => `| ${ROW_COLUMNS.map(([, g]) => g(r)).join(' | ')} |`),
    '',
    `Scene ${rows[0]?.scene ?? '?'}, ${rows[0]?.spp ?? '?'} spp. PSNR is 8-bit after ACES + sRGB against a high-spp reference; "vs ours" is PSNR against our output. ` +
    'Times: wall clock from the call until the output texture is written and the GPU queue is idle.',
  ].join('\n');
}
