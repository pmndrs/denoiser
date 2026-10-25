#!/usr/bin/env node
// Eyeball captures and replay outputs: writes PNGs (or PFM) to tools/rt-capture/previews/.
//
//   node tools/rt-capture/preview.mjs <capture> [--frame 7] [--buffers diffuse,specular_ref,motion]
//   node tools/rt-capture/preview.mjs <capture> --strip specular --frame 7 [--denoisers accumulate,ffx-reflections]
//        -> one PNG: noisy | <denoiser outputs...> | reference, side by side
//   --pfm   also write .pfm (linear float, for tev / other HDR viewers)
//   --all-frames   every frame instead of one
//
// Mappings: rgb signals Reinhard + gamma 2.2 (the metrics' tonemap); visibility clamp;
// normal n·0.5+0.5; motion in pixels (±max → 0..1, x→R, y→G); viewz/depth/hitt/motion_z
// normalized over non-sky pixels. v1: normal_geom and *_dir like normal; transmittance and
// shadow_rgb_ref clamped rgb + gamma; *_sh_ref = the payload evaluated at `normal` (YCoCg -> rgb,
// Reinhard). --strip works for the v1 signals too: sh-diffuse / sh-specular (noisy = diffuse /
// specular, reference = *_ref), shadow-rgb (noisy = visibility x transmittance, reference = shadow_rgb_ref).
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { OUTPUTS_DIR, TOOL_DIR, V1_SIGNALS, frameDir, readBuffer, readF32, readManifest, resolveCapture } from './lib/capture.mjs';

const args = process.argv.slice(2);
const VALUE_OPTS = new Set(['frame', 'buffers', 'strip', 'denoisers', 'outputs']);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i < 0 ? d : args[i + 1]; };
const pos = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && VALUE_OPTS.has(args[i - 1].slice(2))));
const capDir = resolveCapture(pos[0]);
const capName = path.basename(capDir);
const m = readManifest(capDir);
const W = m.width, H = m.height, N = W * H;
const chOf = Object.fromEntries(m.buffers.map((b) => [b.name, b.channels]));
const frames = args.includes('--all-frames') ? m.frames.map((f) => f.index) : [Number(opt('frame', m.frames.length - 1))];
const outDir = path.join(TOOL_DIR, 'previews', capName);
const outRoot = path.join(path.resolve(opt('outputs', OUTPUTS_DIR)), capName);
mkdirSync(outDir, { recursive: true });

// ---- encoders ---------------------------------------------------------------------------
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
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
function pfm(data, ch, w, h) {
  // PFM rows go bottom-to-top; negative scale = little-endian
  const c = ch === 1 ? 1 : 3;
  const body = Buffer.alloc(w * h * c * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let k = 0; k < c; k++) {
    body.writeFloatLE(data[((h - 1 - y) * w + x) * ch + Math.min(k, ch - 1)], ((y * w + x) * c + k) * 4);
  }
  return Buffer.concat([Buffer.from(`${c === 1 ? 'Pf' : 'PF'}\n${w} ${h}\n-1.0\n`), body]);
}

// ---- mappings ---------------------------------------------------------------------------
const g = (x) => Math.pow(Math.max(0, Math.min(1, x)), 1 / 2.2);
function toRgb(name, data, ch, depth) {
  const out = new Float32Array(N * 3);
  const sky = (i) => depth && !(depth[i] > 0 && depth[i] < 1);
  const base = name.replace(/_ref$/, '');
  if (name === 'diffuse_sh_ref' || name === 'specular_sh_ref') {
    // the payload at `normal` (the sampling normal of diffuse; an approximation for specular's D_s)
    const n = readBuffer(capDir, curFrame, 'normal');
    for (let i = 0; i < N; i++) {
      const y = data[6 * i] + data[6 * i + 1] * n[3 * i] + data[6 * i + 2] * n[3 * i + 1] + data[6 * i + 3] * n[3 * i + 2];
      const co = data[6 * i + 4], cg = data[6 * i + 5];
      const rgb = [y + co - cg, y + cg, y - co - cg];
      for (let c = 0; c < 3; c++) out[3 * i + c] = g(rgb[c] > 0 ? rgb[c] / (1 + rgb[c]) : 0);
    }
  } else if (['transmittance', 'shadow_rgb_ref', 'shadow-rgb'].includes(name)) {
    for (let i = 0; i < N * 3; i++) out[i] = g(data[i]);
  } else if (name === 'normal_geom' || name.endsWith('_dir')) {
    for (let i = 0; i < N * 3; i++) out[i] = data[i] * 0.5 + 0.5;
  } else if (['diffuse', 'specular', 'albedo', 'f0', 'sh-diffuse', 'sh-specular'].includes(base) && ch === 3) {
    const tm = base === 'albedo' || base === 'f0' ? (x) => x : (x) => (x > 0 ? x / (1 + x) : 0);
    for (let i = 0; i < N * 3; i++) out[i] = g(tm(data[i]));
  } else if (base === 'visibility' || name === 'roughness') {
    for (let i = 0; i < N; i++) out[3 * i] = out[3 * i + 1] = out[3 * i + 2] = g(data[i]);
  } else if (name === 'normal') {
    for (let i = 0; i < N * 3; i++) out[i] = data[i] * 0.5 + 0.5;
  } else if (name === 'motion') {
    let mx = 1e-9;
    for (let i = 0; i < N; i++) if (!sky(i)) mx = Math.max(mx, Math.abs(data[2 * i] * W / 2), Math.abs(data[2 * i + 1] * H / 2));
    for (let i = 0; i < N; i++) { out[3 * i] = 0.5 + data[2 * i] * W / 2 / (2 * mx); out[3 * i + 1] = 0.5 - data[2 * i + 1] * H / 2 / (2 * mx); out[3 * i + 2] = 0.5; }
  } else { // scalar: normalize over non-sky
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < N; i++) if (!sky(i)) { lo = Math.min(lo, data[i * ch]); hi = Math.max(hi, data[i * ch]); }
    const s = hi > lo ? 1 / (hi - lo) : 1;
    for (let i = 0; i < N; i++) { const v = sky(i) ? 0 : (data[i * ch] - lo) * s; out[3 * i] = out[3 * i + 1] = out[3 * i + 2] = v; }
  }
  return out;
}

function hstack(images) {
  const gap = 4, w = images.length * W + (images.length - 1) * gap;
  const out = new Float32Array(w * H * 3).fill(0.1);
  images.forEach((img, k) => {
    for (let y = 0; y < H; y++) out.set(img.subarray(y * W * 3, (y + 1) * W * 3), (y * w + k * (W + gap)) * 3);
  });
  return { rgb: out, w };
}

const written = [];
const PFM = args.includes('--pfm');
let curFrame = 0;
for (const f of frames) {
  curFrame = f;
  const depth = readBuffer(capDir, f, 'depth');
  const strip = opt('strip');
  if (strip && V1_SIGNALS[strip]) {
    // v1 signal: noisy from its input buffers, outputs <strip>.f32 (3 ch), reference V1_SIGNALS[strip].reference
    const refName = V1_SIGNALS[strip].reference;
    let noisy;
    if (strip === 'shadow-rgb') {
      const v = readBuffer(capDir, f, 'visibility'), t = readBuffer(capDir, f, 'transmittance');
      noisy = new Float32Array(N * 3);
      for (let i = 0; i < N * 3; i++) noisy[i] = v[Math.floor(i / 3)] * t[i];
    } else noisy = readBuffer(capDir, f, V1_SIGNALS[strip].needs[0]);
    const panels = [toRgb(strip, noisy, 3, depth)];
    const names = ['noisy'];
    const dens = (opt('denoisers') ?? '').split(',').filter(Boolean);
    const list = dens.length ? dens : (existsSync(outRoot) ? (await import('./lib/capture.mjs')).listDirs(outRoot) : []);
    for (const d of list) {
      const p = path.join(outRoot, d, frameDir(f), `${strip}.f32`);
      if (!existsSync(p)) continue;
      panels.push(toRgb(strip, readF32(p), 3, depth)); names.push(d);
    }
    if (chOf[refName]) { panels.push(toRgb(strip, readBuffer(capDir, f, refName), 3, depth)); names.push('reference'); }
    const { rgb, w } = hstack(panels);
    const file = path.join(outDir, `${frameDir(f)}_${strip}_strip.png`);
    writeFileSync(file, png(rgb, w, H));
    written.push(`${file}  [${names.join(' | ')}]`);
    continue;
  }
  if (strip) {
    const ch = chOf[strip];
    const dens = (opt('denoisers') ?? '').split(',').filter(Boolean);
    const list = dens.length ? dens : (existsSync(outRoot) ? (await import('./lib/capture.mjs')).listDirs(outRoot) : []);
    const panels = [toRgb(strip, readBuffer(capDir, f, strip), ch, depth)];
    const names = ['noisy'];
    for (const d of list) {
      const p = path.join(outRoot, d, frameDir(f), `${strip}.f32`);
      if (!existsSync(p)) continue;
      panels.push(toRgb(strip, readF32(p), ch, depth)); names.push(d);
    }
    if (chOf[`${strip}_ref`]) { panels.push(toRgb(strip, readBuffer(capDir, f, `${strip}_ref`), ch, depth)); names.push('reference'); }
    const { rgb, w } = hstack(panels);
    const file = path.join(outDir, `${frameDir(f)}_${strip}_strip.png`);
    writeFileSync(file, png(rgb, w, H));
    written.push(`${file}  [${names.join(' | ')}]`);
    continue;
  }
  const names = (opt('buffers') ?? m.buffers.map((b) => b.name).join(',')).split(',');
  for (const name of names) {
    if (!chOf[name]) { console.error(`no buffer ${name}`); continue; }
    const data = readBuffer(capDir, f, name);
    const file = path.join(outDir, `${frameDir(f)}_${name}.png`);
    writeFileSync(file, png(toRgb(name, data, chOf[name], depth), W, H));
    written.push(file);
    if (PFM) { const pf = file.replace(/\.png$/, '.pfm'); writeFileSync(pf, pfm(data, chOf[name], W, H)); written.push(pf); }
  }
}
console.log(written.join('\n'));
