#!/usr/bin/env node
// Blue-noise dither mask for the test bed's `sampling=blue` (src/bluenoise.ts), generated
// with Ulichney's void-and-cluster method ("The void-and-cluster method for dither array
// generation", Proc. SPIE 1913, 1993): a toroidal Gaussian energy filter (sigma 1.5 px),
// an initial binary pattern relaxed by swapping its tightest cluster into its largest
// void, then ranks assigned by removing clusters (phase 1) and filling voids (phases 2
// and 3; for a linear filter, "tightest cluster of the zeros" in the inverted pattern is
// the zero with the lowest energy, so phase 3 is the same step as phase 2).
//
//   node gen-bluenoise.mjs [--size=128] [--sigma=1.5] [--out=src/bluenoise-128.bin]
//
// Output: size*size little-endian uint16 ranks 0..size*size-1, row-major (row 0 = top).
// Deterministic (fixed PRNG seed). Also prints the radially averaged power spectrum of
// the mask (low frequencies should be near zero: that is what "blue" means).
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const S = Number(arg('size', 128));
const SIGMA = Number(arg('sigma', 1.5));
const OUT = path.resolve(HERE, arg('out', `src/bluenoise-${S}.bin`));
const N = S * S;

// mulberry32: small deterministic PRNG for the initial pattern
let st = 0x5eed1234;
const rnd = () => {
  st = (st + 0x6d2b79f5) | 0;
  let t = Math.imul(st ^ (st >>> 15), 1 | st);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// toroidal Gaussian kernel over the whole torus (offset -> weight)
const K = new Float64Array(N);
for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
  const dx = Math.min(x, S - x), dy = Math.min(y, S - y);
  K[y * S + x] = Math.exp(-(dx * dx + dy * dy) / (2 * SIGMA * SIGMA));
}

const bits = new Uint8Array(N);
const E = new Float64Array(N);
function splat(p, sgn) {
  const px = p % S, py = (p / S) | 0;
  for (let y = 0; y < S; y++) {
    const ky = ((y - py + S) % S) * S, row = y * S;
    for (let x = 0; x < S; x++) E[row + x] += sgn * K[ky + ((x - px + S) % S)];
  }
}
const tightestCluster = () => { let b = -1, v = -Infinity; for (let i = 0; i < N; i++) if (bits[i] && E[i] > v) { v = E[i]; b = i; } return b; };
const largestVoid = () => { let b = -1, v = Infinity; for (let i = 0; i < N; i++) if (!bits[i] && E[i] < v) { v = E[i]; b = i; } return b; };

const t0 = Date.now();
// initial binary pattern: ~10 % minority pixels at random
const ones = Math.round(N * 0.1);
for (let placed = 0; placed < ones;) {
  const p = Math.floor(rnd() * N);
  if (!bits[p]) { bits[p] = 1; splat(p, 1); placed++; }
}
// relax: move the tightest cluster into the largest void until they coincide
for (let it = 0; it < 10 * N; it++) {
  const c = tightestCluster();
  bits[c] = 0; splat(c, -1);
  const v = largestVoid();
  if (v === c) { bits[c] = 1; splat(c, 1); break; }
  bits[v] = 1; splat(v, 1);
}
const proto = bits.slice(), protoE = E.slice();
const rank = new Int32Array(N).fill(-1);
// phase 1: remove tightest clusters, ranks ones-1 .. 0
for (let r = ones - 1; r >= 0; r--) {
  const c = tightestCluster();
  bits[c] = 0; splat(c, -1); rank[c] = r;
}
// phases 2 + 3: from the prototype, fill largest voids, ranks ones .. N-1
bits.set(proto); E.set(protoE);
for (let r = ones; r < N; r++) {
  const v = largestVoid();
  bits[v] = 1; splat(v, 1); rank[v] = r;
}
if (rank.some((r) => r < 0)) throw new Error('unranked pixel');

const out = new Uint16Array(N);
for (let i = 0; i < N; i++) out[i] = rank[i];
writeFileSync(OUT, Buffer.from(out.buffer));
console.log(`wrote ${OUT} (${S}x${S}, sigma ${SIGMA}) in ${((Date.now() - t0) / 1000).toFixed(1)} s`);

// radially averaged power spectrum of the (zero-mean) mask, by direct DFT along rows then
// columns (S = 128 -> fine in plain JS)
const val = new Float64Array(N);
for (let i = 0; i < N; i++) val[i] = (rank[i] + 0.5) / N - 0.5;
const re = new Float64Array(N), im = new Float64Array(N);
const cs = new Float64Array(S), sn = new Float64Array(S);
for (let k = 0; k < S; k++) { cs[k] = Math.cos((2 * Math.PI * k) / S); sn[k] = Math.sin((2 * Math.PI * k) / S); }
const tr = new Float64Array(N), ti = new Float64Array(N);
for (let y = 0; y < S; y++) for (let k = 0; k < S; k++) {
  let a = 0, b = 0;
  for (let x = 0; x < S; x++) { const j = (k * x) % S; a += val[y * S + x] * cs[j]; b -= val[y * S + x] * sn[j]; }
  tr[y * S + k] = a; ti[y * S + k] = b;
}
for (let k = 0; k < S; k++) for (let l = 0; l < S; l++) {
  let a = 0, b = 0;
  for (let y = 0; y < S; y++) {
    const j = (l * y) % S, c = cs[j], s = -sn[j];
    a += tr[y * S + k] * c - ti[y * S + k] * s; b += tr[y * S + k] * s + ti[y * S + k] * c;
  }
  re[l * S + k] = a; im[l * S + k] = b;
}
const bins = 8, acc = new Float64Array(bins), cnt = new Float64Array(bins);
for (let l = 0; l < S; l++) for (let k = 0; k < S; k++) {
  if (!k && !l) continue;
  const fx = Math.min(k, S - k), fy = Math.min(l, S - l);
  const f = Math.hypot(fx, fy) / (S / 2); // 0..~1.41, 1 = Nyquist
  if (f >= 1) continue;
  const b = Math.min(bins - 1, Math.floor(f * bins));
  acc[b] += (re[l * S + k] ** 2 + im[l * S + k] ** 2) / N; cnt[b]++;
}
const white = 1 / 12; // power of uniform white noise per frequency (variance)
console.log('radial power spectrum (1 = white noise), frequency as a fraction of Nyquist:');
for (let b = 0; b < bins; b++) console.log(`  ${(b / bins).toFixed(3)}-${((b + 1) / bins).toFixed(3)}: ${(acc[b] / cnt[b] / white).toFixed(3)}`);
