#!/usr/bin/env node
// Track D: per-pixel boil on still-camera captures (bistro-hold, *-move) and where it sits (tracks/d.md).
//   boil_i   RMS over frames >= --from (8) of the second temporal difference of the value (channel mean of Reinhard, or
//            clamp for ao) / sqrt(6); the camera does not move, so no reprojection is needed. On *-move captures the
//            moving knot and its shadow are excluded: pixels whose reference changes by > 0.05 between any two frames.
//   bins     by local geometric detail: the largest normal angle to a 4-neighbour on the same surface (|dz| < 2 % z),
//            and depth-edge pixels (4-neighbour |dz| > 5 % z) separately; per bin the RMS boil of each column
//   image    --png out.png: one tile per column (log scale, black = 1e-4, white = 3e-2), --rect x,y,w,h crop
//   node boilmap.mjs <capture> --cols a,b,ref [--signal diffuse|ao] [--png out.png] [--rect x,y,w,h] [--scale 2]
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { deflateSync } from 'node:zlib';

const REPO = new URL('../../../../../../', import.meta.url).pathname.replace(/\/$/, '');
const cap = await import(`${REPO}/tools/rt-capture/lib/capture.mjs`);
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i < 0 ? d : args[i + 1]; };
const capDir = cap.resolveCapture(args[0]);
const capName = path.basename(capDir);
const m = cap.readManifest(capDir);
const W = m.width, H = m.height, N = W * H, F = m.frames.length;
const sig = opt('signal', 'diffuse');
const cols = opt('cols', 'ref').split(',');
const FROM = Number(opt('from', 8));
const outRoot = path.join(cap.OUTPUTS_DIR, capName);
const tm = (x, ch) => (ch === 1 ? Math.min(Math.max(x, 0), 1) : x > 0 ? x / (1 + x) : 0);
const read = (c, f) => (c === 'ref' ? cap.readBuffer(capDir, f, `${sig}_ref`) : c === 'noisy' ? cap.readBuffer(capDir, f, sig) : cap.readF32(path.join(outRoot, c, cap.frameDir(f), `${sig}.f32`)));
const rch = m.buffers.find((b) => b.name === `${sig}_ref`).channels;
const val = (a, i) => { const ch = a.length / N; let v = 0; for (let c = 0; c < rch; c++) v += tm(a[i * ch + Math.min(c, ch - 1)], rch); return v / rch; };

const depth = cap.readBuffer(capDir, FROM, 'depth'), vz = cap.readBuffer(capDir, FROM, 'viewz'), nrm = cap.readBuffer(capDir, FROM, 'normal');
const scored = new Uint8Array(N);
for (let i = 0; i < N; i++) scored[i] = depth[i] > 0 && depth[i] < 1 ? 1 : 0;
// geometry bins
const detail = new Float32Array(N), edge = new Uint8Array(N);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const i = y * W + x;
  if (!scored[i]) continue;
  let mx = 0;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const qx = x + dx, qy = y + dy;
    if (qx < 0 || qy < 0 || qx >= W || qy >= H) continue;
    const q = qy * W + qx;
    if (!scored[q]) { edge[i] = 1; continue; }
    if (Math.abs(vz[q] - vz[i]) > 0.05 * Math.abs(vz[i])) { edge[i] = 1; continue; }
    if (Math.abs(vz[q] - vz[i]) > 0.02 * Math.abs(vz[i])) continue;
    const c = nrm[3 * i] * nrm[3 * q] + nrm[3 * i + 1] * nrm[3 * q + 1] + nrm[3 * i + 2] * nrm[3 * q + 2];
    mx = Math.max(mx, Math.acos(Math.min(1, Math.max(-1, c))) * 180 / Math.PI);
  }
  detail[i] = mx;
}
// moving content mask (reference range)
const lo = new Float32Array(N).fill(1e9), hi = new Float32Array(N).fill(-1e9);
for (let f = FROM; f < F; f++) { const r = read('ref', f); for (let i = 0; i < N; i++) { const v = val(r, i); if (v < lo[i]) lo[i] = v; if (v > hi[i]) hi[i] = v; } }
const moving = new Uint8Array(N);
let nMoving = 0;
for (let i = 0; i < N; i++) if (scored[i] && hi[i] - lo[i] > 0.05) { moving[i] = 1; nMoving++; }

const boil = {};
for (const c of cols) {
  const b = new Float64Array(N);
  let p1 = null, p2 = null, n = 0;
  for (let f = FROM; f < F; f++) {
    const a = read(c, f), v = new Float32Array(N);
    for (let i = 0; i < N; i++) v[i] = scored[i] ? val(a, i) : 0;
    if (p2) { for (let i = 0; i < N; i++) { const d = v[i] - 2 * p1[i] + p2[i]; b[i] += d * d; } n++; }
    p2 = p1; p1 = v;
  }
  for (let i = 0; i < N; i++) b[i] = Math.sqrt(b[i] / n / 6);
  boil[c] = b;
}
const BINS = [['flat (< 2 deg)', (i) => !edge[i] && detail[i] < 2], ['curved 2-10 deg', (i) => !edge[i] && detail[i] >= 2 && detail[i] < 10],
  ['dense 10-30 deg', (i) => !edge[i] && detail[i] >= 10 && detail[i] < 30], ['creases > 30 deg', (i) => !edge[i] && detail[i] >= 30], ['depth edges', (i) => edge[i]]];
console.log(`\n**${capName}, ${sig}**: per-pixel boil x1e3 (RMS over the bin), frames ${FROM}..${F - 1}, still camera; ${nMoving} moving-content px excluded\n`);
console.log(`| bin | px | ${cols.join(' | ')} |`);
console.log(`|---|---|${cols.map(() => '---').join('|')}|`);
for (const [name, fn] of [['all', () => true], ...BINS]) {
  let cnt = 0; const s = Object.fromEntries(cols.map((c) => [c, 0]));
  for (let i = 0; i < N; i++) if (scored[i] && !moving[i] && fn(i)) { cnt++; for (const c of cols) s[c] += boil[c][i] ** 2; }
  console.log(`| ${name} | ${cnt} | ${cols.map((c) => (1e3 * Math.sqrt(s[c] / Math.max(cnt, 1))).toFixed(2)).join(' | ')} |`);
}
const png = opt('png');
if (png) {
  const [rx, ry, rw, rh] = opt('rect', `0,0,${W},${H}`).split(',').map(Number);
  const sc = Number(opt('scale', 1)), gap = 4;
  const TW = rw * sc, TH = rh * sc, IW = cols.length * TW + (cols.length - 1) * gap, IH = TH;
  const img = new Uint8Array(IW * IH * 3).fill(40);
  cols.forEach((c, k) => {
    for (let y = 0; y < TH; y++) for (let x = 0; x < TW; x++) {
      const i = (ry + Math.floor(y / sc)) * W + rx + Math.floor(x / sc);
      const v = scored[i] ? Math.min(1, Math.max(0, (Math.log10(Math.max(boil[c][i], 1e-4)) + 4) / (Math.log10(3e-2) + 4))) : 0;
      const o = (y * IW + k * (TW + gap) + x) * 3;
      img[o] = img[o + 1] = img[o + 2] = Math.round(255 * v);
      if (moving[i]) img[o + 2] = Math.min(255, img[o + 2] + 60);
    }
  });
  writeFileSync(png, encodePng(img, IW, IH));
  console.log(`\nwrote ${png} (${cols.join(' | ')}; log boil 1e-4 black .. 3e-2 white; moving content tinted blue)`);
}
function encodePng(rgb, w, h) {
  const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
  const crc = (b) => { let c = -1; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const chunk = (t, d) => { const b = Buffer.alloc(12 + d.length); b.writeUInt32BE(d.length, 0); b.write(t, 4); Buffer.from(d).copy(b, 8); b.writeUInt32BE(crc(b.subarray(4, 8 + d.length)), 8 + d.length); return b; };
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; Buffer.from(rgb.buffer, y * w * 3, w * 3).copy(raw, y * (w * 3 + 1) + 1); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
