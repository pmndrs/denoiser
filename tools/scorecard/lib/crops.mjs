// Small crop strips for the dashboard: raw | rows... | reference at one frame, tonemapped (Reinhard + sRGB; visibility /
// AO as display greys), nearest-neighbour 1x, written as 8-bit PNG (zlib only, no dependencies).
import { deflateSync } from 'node:zlib';
import { isScored, readBuffer } from '../../rt-capture/lib/capture.mjs';
import { SIG_CH, REF_BUFFER } from './metrics.mjs';

const crcTable = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0); out.write(type, 4, 'ascii'); data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
export function encodePng(rgb, w, h) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
const oetf = (c) => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

/** Pick the crop window (size px) with the most reference gradient energy among valid pixels (deterministic). */
export function pickWindow(ref, depth, W, H, ch, size) {
  const g = new Float32Array(W * H);
  const lum = (i) => (ch === 3 ? 0.2126 * ref[3 * i] / (1 + ref[3 * i]) + 0.7152 * ref[3 * i + 1] / (1 + ref[3 * i + 1]) + 0.0722 * ref[3 * i + 2] / (1 + ref[3 * i + 2]) : Math.min(Math.max(ref[i], 0), 1));
  for (let y = 0; y < H - 1; y++) for (let x = 0; x < W - 1; x++) {
    const i = y * W + x;
    if (!isScored(depth[i])) continue;
    g[i] = Math.abs(lum(i) - lum(i + 1)) + Math.abs(lum(i) - lum(i + W));
  }
  const step = 16; let best = -1, bx = 0, by = 0;
  const S = new Float64Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) S[(y + 1) * (W + 1) + x + 1] = g[y * W + x] + S[y * (W + 1) + x + 1] + S[(y + 1) * (W + 1) + x] - S[y * (W + 1) + x];
  for (let y = 0; y + size <= H; y += step) for (let x = 0; x + size <= W; x += step) {
    const v = S[(y + size) * (W + 1) + x + size] - S[y * (W + 1) + x + size] - S[(y + size) * (W + 1) + x] + S[y * (W + 1) + x];
    if (v > best) { best = v; bx = x; by = y; }
  }
  return { x: bx, y: by };
}

/** panels: [{ label, data: Float32Array(W*H*ch) }]; returns { png: Buffer, window, w, h } */
export function cropStrip({ capDir, m, frame, signal, panels, size = 112, window = null }) {
  const W = m.width, H = m.height, ch = SIG_CH[signal];
  const depth = readBuffer(capDir, frame, 'depth');
  const ref = readBuffer(capDir, frame, REF_BUFFER[signal]);
  const win = window ?? pickWindow(ref, depth, W, H, ch, size);
  const gap = 2, outW = panels.length * size + (panels.length - 1) * gap;
  const rgb = Buffer.alloc(outW * size * 3, 40);
  panels.forEach((p, k) => {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const i = (win.y + y) * W + win.x + x;
      const o = (y * outW + k * (size + gap) + x) * 3;
      for (let c = 0; c < 3; c++) {
        let v = ch === 3 ? p.data[3 * i + c] : p.data[i];
        v = Number.isFinite(v) ? (ch === 3 ? (v > 0 ? v / (1 + v) : 0) : Math.min(Math.max(v, 0), 1)) : 0;
        rgb[o + c] = Math.max(0, Math.min(255, Math.round(oetf(v))));
      }
    }
  });
  return { png: encodePng(rgb, outW, size), window: win, w: outW, h: size, labels: panels.map((p) => p.label) };
}

/** one display tile (size x size, 3 bytes per pixel) of a window of a signal buffer: Reinhard + sRGB (rgb) or grey (scalar) */
export function renderTile(data, ch, W, win, size) {
  const out = Buffer.alloc(size * size * 3);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (win.y + y) * W + win.x + x, o = (y * size + x) * 3;
    for (let c = 0; c < 3; c++) {
      let v = ch === 3 ? data[3 * i + c] : data[i];
      v = Number.isFinite(v) ? (ch === 3 ? (v > 0 ? v / (1 + v) : 0) : Math.min(Math.max(v, 0), 1)) : 0;
      out[o + c] = Math.max(0, Math.min(255, Math.round(oetf(v))));
    }
  }
  return out;
}
