#!/usr/bin/env node
// T1b: per-frame curves after a reset from t1-score.mjs JSON (results/T1b-spatial-repair.md).
//   node t1b-curves.mjs <t1-score json> [--signal diffuse] [--frames 9] [--base rec] [--reset k]
// Prints, per denoiser, PSNR of every scored pixel on frames 0..frames-1 after reset k (default: the last reset
// in the capture), the window's PSNR of the mean MSE, and the delta to --base per frame.
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i < 0 ? d : args[i + 1]; };
const r = JSON.parse(readFileSync(args[0], 'utf8'));
const sig = opt('signal', 'diffuse');
const NF = Number(opt('frames', 9));
const base = opt('base', 'rec');
const reset = Number(opt('reset', r.resets[r.resets.length - 1]));
const db = (sse, n) => 10 * Math.log10(n / Math.max(sse, 1e-30));
const rows = [];
for (const [k, a] of Object.entries(r.acc)) {
  const [s, d] = k.split('|');
  if (s !== sig) continue;
  const fr = a.frames.filter((f) => f.f >= reset && f.f < reset + NF);
  const curve = fr.map((f) => db(f.allSse, f.allCnt));
  const win = db(fr.reduce((x, f) => x + f.allSse / f.allCnt, 0) / fr.length, 1);
  const all = db(a.frames.reduce((x, f) => x + f.allSse, 0), a.frames.reduce((x, f) => x + f.allCnt, 0));
  const mid = fr.map((f) => (f.midSse ? db(f.midSse, f.lpCnt) : NaN));
  rows.push({ d, curve, win, all, mid });
}
const b = rows.find((x) => x.d === base);
console.log(`${r.capture} ${sig}: frames ${reset}..${reset + NF - 1} after the reset (dB, all pixels); win = PSNR of mean MSE; all = whole capture`);
for (const x of rows) {
  const dl = b ? x.curve.map((c, i) => (c - b.curve[i] >= 0 ? '+' : '') + (c - b.curve[i]).toFixed(2)).join(' ') : '';
  console.log(`${x.d.padEnd(14)} ${x.curve.map((c) => c.toFixed(2)).join(' ')} | win ${x.win.toFixed(2)} all ${x.all.toFixed(2)}${b && x !== b ? ` | Δ ${dl} | Δwin ${(x.win - b.win).toFixed(2)} Δall ${(x.all - b.all).toFixed(2)}` : ''}`);
}
if (args.includes('--mid')) for (const x of rows) console.log(`mid ${x.d.padEnd(14)} ${x.mid.map((c) => c.toFixed(2)).join(' ')}`);
