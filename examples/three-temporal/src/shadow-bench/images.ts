// Shadow bench images: single-channel visibility (and the lit composite) -> 8-bit RGBA for canvases and PNG files.
//
//   mask   visibility, sRGB-encoded grey (realtime-shadows' "visibility only" view)
//   lit    env-lit scene colour + albedo x E(panel) x visibility -> ACES filmic -> sRGB, the page's composite computed
//          on the CPU from two readbacks (base, direct) so every variant's lit image costs no extra GPU pass
//   err    signed error x 4 over a dim copy of the ground truth: red = darker than the truth, blue = brighter
//   boil   per-pixel temporal std of the error (metrics.ts errStdMap), x 10, black -> red -> yellow -> white

const srgb = (v: number) => {
  const c = v <= 0 ? 0 : v >= 1 ? 1 : v;
  return Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055));
};

// ACES filmic as three's acesFilmicToneMapping (Stephen Hill's fit; exposure 1)
function aces(r: number, g: number, b: number): [number, number, number] {
  r /= 0.6; g /= 0.6; b /= 0.6;
  const ir = 0.59719 * r + 0.35458 * g + 0.04823 * b;
  const ig = 0.076 * r + 0.90834 * g + 0.01566 * b;
  const ib = 0.0284 * r + 0.13383 * g + 0.83777 * b;
  const fit = (v: number) => (v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.432951) + 0.238081);
  const fr = fit(ir), fg = fit(ig), fb = fit(ib);
  return [1.60475 * fr - 0.53108 * fg - 0.07367 * fb, -0.10208 * fr + 1.10813 * fg - 0.00605 * fb, -0.00327 * fr - 0.07276 * fg + 1.07602 * fb];
}

export interface Aux { base: Float32Array; direct: Float32Array } // rgba float, w x h

export function maskImage(v: Float32Array, w: number, h: number): ImageData {
  const img = new ImageData(w, h);
  for (let i = 0; i < w * h; i++) { const g = srgb(v[i]); img.data[i * 4] = g; img.data[i * 4 + 1] = g; img.data[i * 4 + 2] = g; img.data[i * 4 + 3] = 255; }
  return img;
}

export function litImage(v: Float32Array, aux: Aux, w: number, h: number): ImageData {
  const img = new ImageData(w, h);
  const { base, direct } = aux;
  for (let i = 0; i < w * h; i++) {
    const vis = v[i] < 0 ? 0 : v[i] > 1 ? 1 : v[i];
    const c = aces(base[i * 4] + direct[i * 4] * vis, base[i * 4 + 1] + direct[i * 4 + 1] * vis, base[i * 4 + 2] + direct[i * 4 + 2] * vis);
    img.data[i * 4] = srgb(c[0]); img.data[i * 4 + 1] = srgb(c[1]); img.data[i * 4 + 2] = srgb(c[2]); img.data[i * 4 + 3] = 255;
  }
  return img;
}

/** Displayed brightness of the lit composite: mean of the sRGB channels, 0..255, unrounded (the flicker metric's input). */
export function litLuma(v: Float32Array, aux: Aux, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h);
  const { base, direct } = aux;
  const s = (x: number) => { const c = x <= 0 ? 0 : x >= 1 ? 1 : x; return 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055); };
  for (let i = 0; i < w * h; i++) {
    const vis = v[i] < 0 ? 0 : v[i] > 1 ? 1 : v[i];
    const c = aces(base[i * 4] + direct[i * 4] * vis, base[i * 4 + 1] + direct[i * 4 + 1] * vis, base[i * 4 + 2] + direct[i * 4 + 2] * vis);
    out[i] = (s(c[0]) + s(c[1]) + s(c[2])) / 3;
  }
  return out;
}

/** Flicker map: the largest frame-to-frame change of the displayed brightness (8-bit levels) x 40 in red over a dim copy of the frame. */
export function flickerImage(maxDiff: Float32Array, luma: Float32Array, w: number, h: number): ImageData {
  const img = new ImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const b = luma[i] * 0.35;
    img.data[i * 4] = Math.min(255, b + maxDiff[i] * 40); img.data[i * 4 + 1] = b; img.data[i * 4 + 2] = b; img.data[i * 4 + 3] = 255;
  }
  return img;
}

export function errImage(v: Float32Array, gt: Float32Array, recv: Uint8Array, w: number, h: number, gain = 4): ImageData {
  const img = new ImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const r = recv[i] ? gt[i] : 0;
    const e = recv[i] ? Math.max(-1, Math.min(1, ((v[i] < 0 ? 0 : v[i] > 1 ? 1 : v[i]) - r) * gain)) : 0;
    const base = 40 + r * 40;
    img.data[i * 4] = base + Math.max(0, -e) * 215; img.data[i * 4 + 1] = base; img.data[i * 4 + 2] = base + Math.max(0, e) * 215; img.data[i * 4 + 3] = 255;
  }
  return img;
}

export function heatImage(s: Float32Array, w: number, h: number, gain = 10): ImageData {
  const img = new ImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const t = Math.min(1, s[i] * gain) * 3;
    img.data[i * 4] = Math.round(255 * Math.min(1, t));
    img.data[i * 4 + 1] = Math.round(255 * Math.min(1, Math.max(0, t - 1)));
    img.data[i * 4 + 2] = Math.round(255 * Math.min(1, Math.max(0, t - 2)));
    img.data[i * 4 + 3] = 255;
  }
  return img;
}

const scratch = document.createElement('canvas');
export async function pngOf(img: ImageData): Promise<Blob> {
  scratch.width = img.width; scratch.height = img.height;
  scratch.getContext('2d')!.putImageData(img, 0, 0);
  return new Promise((res, rej) => scratch.toBlob((b) => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/png'));
}

export function draw(canvas: HTMLCanvasElement, img: ImageData) {
  canvas.width = img.width; canvas.height = img.height;
  canvas.getContext('2d')!.putImageData(img, 0, 0);
}
