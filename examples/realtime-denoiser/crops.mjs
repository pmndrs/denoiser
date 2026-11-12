#!/usr/bin/env node
// Small PNG crops and noise spectra from test-bed captures + replay outputs (results docs).
//
//   node crops.mjs crop <capture> --signal diffuse --frame 12 --rect x,y,w,h \
//        --cols noisy,svgf,ffx-reflections,ref [--scale 2] [--err 4] [--exposure 1] --out img/x.png
//     one row of tiles, left to right; `noisy` / `ref` are the capture's buffers, anything
//     else is outputs/<capture>/<name>/. --err G adds a second row: |tile - ref| * G
//     (tonemapped, grey). Tonemap: Reinhard x/(1+x) per channel (the metrics') + gamma 2.2;
//     visibility is clamped. 2 px white gaps between tiles.
//   node crops.mjs spectrum <capture> [--signal diffuse] [--frame 0] [--rect x,y,w,h]
//     radially averaged power spectrum of the noisy input's error (noisy - ref, tonemapped
//     luminance-ish channel mean) over a power-of-two crop, normalised so white noise = 1
//     in every band. Blue noise: low bands << 1, high bands > 1.
//   node crops.mjs spectrum-png <capture> ... --out x.png   error crop as a grey PNG (gain --err)
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { OUTPUTS_DIR, frameDir, readBuffer, readF32, readManifest, resolveCapture } from '../../tools/rt-capture/lib/capture.mjs';

const args = process.argv.slice(2);
const cmd = args[0];
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i < 0 ? d : args[i + 1]; };
const capDir = resolveCapture(args[1]);
const capName = path.basename(capDir);
const m = readManifest(capDir);
const W = m.width, H = m.height;
const signal = opt('signal', 'diffuse');
const sig = signal === 'shadows' ? 'visibility' : signal;
const frame = Number(opt('frame', 0));
const ch = sig === 'visibility' ? 1 : 3;
const [rx, ry, rw, rh] = (opt('rect', `0,0,${W},${H}`)).split(',').map(Number);
const tm = (v) => (ch === 1 ? Math.min(Math.max(v, 0), 1) : Math.max(v, 0) / (1 + Math.max(v, 0)));

function load(name) {
  if (name === 'noisy') return readBuffer(capDir, frame, sig);
  if (name === 'ref') return readBuffer(capDir, frame, `${sig}_ref`);
  const f = path.join(OUTPUTS_DIR, capName, name, frameDir(frame), `${sig}.f32`);
  if (!existsSync(f)) throw new Error(`no output ${f}`);
  return readF32(f);
}
/** tonemapped value of pixel (x, y), channel c (output files are rgba or r; captures per manifest) */
function tmAt(data, x, y, c) {
  const stride = data.length / (W * H);
  return tm(data[(y * W + x) * stride + Math.min(c, stride - 1)]);
}

const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function png(rgb, w, h) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w * 3; x++) raw[y * (w * 3 + 1) + 1 + x] = Math.max(0, Math.min(255, Math.round(rgb[y * w * 3 + x] * 255)));
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
const gamma = (v) => Math.pow(Math.min(Math.max(v, 0), 1), 1 / 2.2);
const save = (file, rgb, w, h) => {
  mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const b = png(rgb, w, h);
  writeFileSync(file, b);
  console.log(`wrote ${file} (${w}x${h}, ${(b.length / 1024).toFixed(0)} KB)`);
};

if (cmd === 'crop') {
  const cols = opt('cols', 'noisy,ref').split(',');
  const S = Number(opt('scale', 1));
  const ERR = Number(opt('err', 0));
  const EXP = Number(opt('exposure', 1));
  const GAP = 2;
  const tw = rw * S, th = rh * S;
  const rows = ERR ? 2 : 1;
  const w = cols.length * tw + (cols.length - 1) * GAP, h = rows * th + (rows - 1) * GAP;
  const rgb = new Float32Array(w * h * 3).fill(1);
  const ref = load('ref');
  cols.forEach((name, i) => {
    const data = name === 'ref' ? ref : load(name);
    for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
      const sx = rx + Math.floor(x / S), sy = ry + Math.floor(y / S);
      for (let c = 0; c < 3; c++) {
        const v = tmAt(data, sx, sy, c);
        const o = (y * w + i * (tw + GAP) + x) * 3 + c;
        rgb[o] = gamma(v * EXP);
        if (ERR) {
          const e = (Math.abs(tmAt(data, sx, sy, 0) - tmAt(ref, sx, sy, 0)) + (ch === 3 ? Math.abs(tmAt(data, sx, sy, 1) - tmAt(ref, sx, sy, 1)) + Math.abs(tmAt(data, sx, sy, 2) - tmAt(ref, sx, sy, 2)) : 0) * 1) / (ch === 3 ? 3 : 1);
          rgb[((y + th + GAP) * w + i * (tw + GAP) + x) * 3 + c] = gamma(e * ERR);
        }
      }
    }
  });
  save(opt('out', 'crop.png'), rgb, w, h);
} else if (cmd === 'spectrum' || cmd === 'spectrum-png') {
  // power-of-two crop inside the rect
  let n = 1; while (n * 2 <= Math.min(rw, rh)) n *= 2;
  const noisy = load('noisy'), ref = load('ref'), depth = readBuffer(capDir, frame, 'depth');
  const e = new Float64Array(n * n);
  let scored = 0, mean = 0;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const sx = rx + x, sy = ry + y;
    const d = depth[sy * W + sx];
    if (!(d > 0 && d < 1)) continue;
    let v = 0;
    for (let c = 0; c < ch; c++) v += tmAt(noisy, sx, sy, c) - tmAt(ref, sx, sy, c);
    e[y * n + x] = v / ch; scored++; mean += v / ch;
  }
  mean /= Math.max(scored, 1);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const d = depth[(ry + y) * W + rx + x];
    if (d > 0 && d < 1) e[y * n + x] -= mean;
  }
  if (cmd === 'spectrum-png') {
    const G = Number(opt('err', 4));
    const rgb = new Float32Array(n * n * 3);
    for (let i = 0; i < n * n; i++) rgb.fill(Math.min(Math.max(0.5 + e[i] * G, 0), 1), i * 3, i * 3 + 3);
    save(opt('out', 'error.png'), rgb, n, n);
    process.exit(0);
  }
  // 2D DFT via row/column DFTs (n <= 512 is fine)
  const cs = new Float64Array(n), sn = new Float64Array(n);
  for (let k = 0; k < n; k++) { cs[k] = Math.cos((2 * Math.PI * k) / n); sn[k] = Math.sin((2 * Math.PI * k) / n); }
  const tr = new Float64Array(n * n), ti = new Float64Array(n * n);
  for (let y = 0; y < n; y++) for (let k = 0; k < n; k++) {
    let a = 0, b = 0;
    for (let x = 0; x < n; x++) { const j = (k * x) % n; a += e[y * n + x] * cs[j]; b -= e[y * n + x] * sn[j]; }
    tr[y * n + k] = a; ti[y * n + k] = b;
  }
  const bins = 8, acc = new Float64Array(bins), cnt = new Float64Array(bins);
  let total = 0;
  for (let k = 0; k < n; k++) for (let l = 0; l < n; l++) {
    let a = 0, b = 0;
    for (let y = 0; y < n; y++) {
      const j = (l * y) % n, c = cs[j], s = -sn[j];
      a += tr[y * n + k] * c - ti[y * n + k] * s; b += tr[y * n + k] * s + ti[y * n + k] * c;
    }
    const p = (a * a + b * b) / (n * n);
    total += p;
    if (!k && !l) continue;
    const f = Math.hypot(Math.min(k, n - k), Math.min(l, n - l)) / (n / 2);
    if (f >= 1) continue;
    const bi = Math.min(bins - 1, Math.floor(f * bins));
    acc[bi] += p; cnt[bi]++;
  }
  const flat = total / (n * n); // mean power per frequency = white level
  const bands = [...acc].map((a, i) => +(a / cnt[i] / flat).toFixed(3));
  console.log(JSON.stringify({ capture: capName, signal, frame, crop: [rx, ry, n, n], scoredFraction: +(scored / (n * n)).toFixed(3), bands }));
} else {
  console.error('usage: crops.mjs crop|spectrum|spectrum-png <capture> ...');
  process.exit(2);
}
