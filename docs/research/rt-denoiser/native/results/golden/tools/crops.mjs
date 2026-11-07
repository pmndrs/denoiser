#!/usr/bin/env node
// 128-px crop strips (harness builder's tool): noisy | <denoisers...> | reference, one capture frame and signal,
// 2 px dark separators. Radiance: exposure k (default: 0.18 / mean reference luma of the crop), Reinhard, sRGB.
//   node crops.mjs <captureDir> <outputsDir> --frame 40 --signal diffuse --den a,b,c --x 400 --y 200 [--size 128] --out file.png
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i < 0 ? d : args[i + 1]; };
const [capDir, outDir] = args;
const m = JSON.parse(fs.readFileSync(path.join(capDir, 'capture.json'), 'utf8'));
const W = m.width, H = m.height;
const f = Number(opt('frame', 0)), sig = opt('signal', 'diffuse'), S = Number(opt('size', 128));
const dens = opt('den', '').split(',').filter(Boolean);
const ch = { diffuse: 3, specular: 3, visibility: 1, ao: 1 }[sig];
const refName = { diffuse: 'diffuse_ref', specular: 'specular_ref', visibility: 'visibility_ref', ao: 'ao_ref' }[sig];
const fr = `frame_${String(f).padStart(4, '0')}`;
const load = (p) => { const b = fs.readFileSync(p); return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4); };
// --x auto: the S-px tile (S/2 grid) with the most detail in the reference (sum of |gradient| of Reinhard luma)
let x0 = Number(opt('x', (W - S) >> 1)), y0 = Number(opt('y', (H - S) >> 1));
if (opt('x') === 'auto') {
  const r = load(path.join(capDir, fr, `${refName}.f32`));
  const L = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) { const v = ch === 1 ? r[i] : 0.2126 * r[i * 3] + 0.7152 * r[i * 3 + 1] + 0.0722 * r[i * 3 + 2]; L[i] = v / (1 + v); }
  let best = -1;
  for (let ty = 0; ty + S <= H; ty += S >> 1) for (let tx = 0; tx + S <= W; tx += S >> 1) {
    let e = 0;
    for (let y = ty; y < ty + S - 1; y++) for (let x = tx; x < tx + S - 1; x++) { const i = y * W + x; e += Math.abs(L[i + 1] - L[i]) + Math.abs(L[i + W] - L[i]); }
    if (e > best) { best = e; x0 = tx; y0 = ty; }
  }
}
const tiles = [];
if (fs.existsSync(path.join(capDir, fr, `${sig}.f32`))) tiles.push(load(path.join(capDir, fr, `${sig}.f32`)));
for (const d of dens) tiles.push(load(path.join(outDir, d, fr, `${sig}.f32`)));
const ref = load(path.join(capDir, fr, `${refName}.f32`));
tiles.push(ref);
const lum = (a, i) => (ch === 1 ? a[i] : 0.2126 * a[i * 3] + 0.7152 * a[i * 3 + 1] + 0.0722 * a[i * 3 + 2]);
let sum = 0; for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) sum += lum(ref, (y0 + y) * W + x0 + x);
const radiance = ch === 3;
const k = radiance ? Number(opt('k', 0.18 / Math.max(1e-6, sum / (S * S)))) : 1;
const enc = (v) => { v = Math.max(0, v * k); if (radiance) v = v / (1 + v); v = Math.min(1, v); return Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055)); };
const OW = tiles.length * S + (tiles.length - 1) * 2;
const raw = Buffer.alloc((OW * 3 + 1) * S, 24);
for (let y = 0; y < S; y++) {
  raw[y * (OW * 3 + 1)] = 0;
  tiles.forEach((t, ti) => {
    for (let x = 0; x < S; x++) {
      const i = (y0 + y) * W + x0 + x, o = y * (OW * 3 + 1) + 1 + (ti * (S + 2) + x) * 3;
      for (let c = 0; c < 3; c++) raw[o + c] = enc(t[i * ch + (ch === 1 ? 0 : c)]);
    }
  });
}
const crcT = Array.from({ length: 256 }, (_, n) => { let r = n; for (let q = 0; q < 8; q++) r = r & 1 ? 0xedb88320 ^ (r >>> 1) : r >>> 1; return r >>> 0; });
const crc = (b) => { let r = 0xffffffff; for (const x of b) r = crcT[(r ^ x) & 255] ^ (r >>> 8); return (r ^ 0xffffffff) >>> 0; };
const chunk = (t, b) => { const l = Buffer.alloc(4); l.writeUInt32BE(b.length); const tb = Buffer.concat([Buffer.from(t), b]); const cc = Buffer.alloc(4); cc.writeUInt32BE(crc(tb)); return Buffer.concat([l, tb, cc]); };
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(OW, 0); ihdr.writeUInt32BE(S, 4); ihdr[8] = 8; ihdr[9] = 2;
fs.writeFileSync(opt('out', 'crop.png'), Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
console.log(`wrote ${opt('out', 'crop.png')}: ${['noisy', ...dens, 'reference'].join(' | ')} at (${x0}, ${y0}) frame ${f}, exposure ${k.toFixed(3)}`);
