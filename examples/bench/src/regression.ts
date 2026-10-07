// Output-hash regression suite for automated runs (window.__regression).
// Covers every engine path: whole-frame + tiled image input, CPU aux (9ch split
// path), and the zero-copy texture path (LDR, HDR + autoexposure, aux + tonemap).
// Hashes must match before/after an internal refactor; run it twice on one build
// first to confirm the GPU path is deterministic on the machine.
import { Denoiser, type NetworkRuntime } from 'denoiser';

type Precision = 'fp32' | 'fp16';

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function fnv1a(bytes: Uint8Array | Uint8ClampedArray): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Deterministic scene + noise as RGBA floats in [0,1]; `seed` varies the noise. */
function scene(w: number, h: number, seed: number, kind: 'color' | 'albedo' | 'normal'): Float32Array {
  const rand = mulberry32(seed);
  const out = new Float32Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const inDisk = (x - w * 0.4) ** 2 + (y - h * 0.45) ** 2 < (Math.min(w, h) * 0.25) ** 2;
      if (kind === 'normal') {
        // [-1,1]: disk faces the camera-ish, background tilts with x
        const nx = inDisk ? (x - w * 0.4) / (Math.min(w, h) * 0.25) * 0.7 : 0.3;
        out.set([nx, 0.2, Math.sqrt(Math.max(0, 1 - nx * nx - 0.04)), 1], i);
        continue;
      }
      let r = 0.15 + 0.7 * (x / w);
      let g = 0.25 + 0.6 * (y / h);
      let b = 0.8 - 0.5 * (x / w);
      if (inDisk) { r = 0.9; g = 0.25; b = 0.25; }
      if (kind === 'color') {
        const n = () => (rand() + rand() + rand() - 1.5) * 0.3;
        r = Math.max(0, Math.min(1, r + n()));
        g = Math.max(0, Math.min(1, g + n()));
        b = Math.max(0, Math.min(1, b + n()));
      }
      out.set([r, g, b, 1], i);
    }
  }
  return out;
}

const toBytes = (f: Float32Array) => {
  const out = new Uint8ClampedArray(f.length);
  for (let i = 0; i < f.length; i++) out[i] = Math.round(f[i] * 255);
  return out;
};
/** Normals [-1,1] -> RGBA8 n*0.5+0.5 (the CPU API's encoding). */
const normalBytes = (f: Float32Array) => {
  const out = new Uint8ClampedArray(f.length);
  for (let i = 0; i < f.length; i++) out[i] = (i & 3) === 3 ? 255 : Math.round((f[i] * 0.5 + 0.5) * 255);
  return out;
};

function texture(device: GPUDevice, data: Float32Array, w: number, h: number, scale = 1): GPUTexture {
  const F16 = (globalThis as unknown as { Float16Array: Float32ArrayConstructor }).Float16Array;
  const half = new F16(data.length);
  for (let i = 0; i < data.length; i++) half[i] = (i & 3) === 3 ? data[i] : data[i] * scale;
  const tex = device.createTexture({
    size: { width: w, height: h }, format: 'rgba16float',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  device.queue.writeTexture({ texture: tex }, half as unknown as BufferSource, { bytesPerRow: w * 8 }, { width: w, height: h });
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

export interface RegressionCase { name: string; model?: string; tiles?: number; hash: string }

export async function runRegression(
  weightsUrl: string | undefined, precision: Precision,
  makeRuntime: () => NetworkRuntime | undefined = () => undefined,
): Promise<RegressionCase[]> {
  const out: RegressionCase[] = [];
  const dn = await Denoiser.create({ runtime: makeRuntime(), precision, quality: 'fast', weightsUrl });
  const push = (name: string, bytes: Uint8Array | Uint8ClampedArray) =>
    out.push({ name, model: dn.modelName, tiles: dn.stats?.tiles, hash: fnv1a(bytes) });
  try {
    const W = 512, H = 512;
    const color = scene(W, H, 1, 'color');
    const albedo = scene(W, H, 2, 'albedo');
    const normal = scene(W, H, 3, 'normal');
    const raw = (d: Uint8ClampedArray) => ({ data: d, width: W, height: H });

    push('image', (await dn.denoise(raw(toBytes(color))))!.data);
    push('image-linear-flip', (await dn.denoise(raw(toBytes(color)), { srgb: false, flipY: true }))!.data);
    push('image-aux', (await dn.denoise(raw(toBytes(color)), {
      albedo: raw(toBytes(albedo)), normal: raw(normalBytes(normal)),
    }))!.data);

    const big = scene(1280, 720, 4, 'color');
    push('image-1280x720', (await dn.denoise({ data: toBytes(big), width: 1280, height: 720 }))!.data);

    const dev = dn.device;
    const cTex = texture(dev, color, W, H);
    const hdrTex = texture(dev, color, W, H, 8);
    const aTex = texture(dev, albedo, W, H);
    const nTex = texture(dev, normal, W, H);
    push('tex-ldr', await readTexture(dev, (await dn.denoiseTextures({ color: cTex }))!));
    push('tex-hdr-srgb', await readTexture(dev, (await dn.denoiseTextures({
      color: hdrTex, hdr: true, transfer: 'srgb', inputFlipY: true,
    }))!));
    push('tex-aux-aces', await readTexture(dev, (await dn.denoiseTextures({
      color: hdrTex, albedo: aTex, normal: nTex, hdr: true, transfer: 'aces-srgb',
    }))!));
    for (const t of [cTex, hdrTex, aTex, nTex]) t.destroy();

    // tiled path: force it with a small per-run pixel budget on a fresh instance
    dn.destroyDevice();
    const tiled = await Denoiser.create({ runtime: makeRuntime(), precision, quality: 'fast', weightsUrl, maxRunPixels: 256 * 256 });
    const r = (await tiled.denoise({ data: toBytes(big), width: 1280, height: 720 }))!;
    out.push({ name: 'image-1280x720-tiled', model: tiled.modelName, tiles: tiled.stats?.tiles, hash: fnv1a(r.data) });
    tiled.destroyDevice();
  } catch (err) {
    dn.destroyDevice();
    throw err;
  }
  return out;
}
