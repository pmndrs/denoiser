#!/usr/bin/env node
// Review target D / target 7 long holds (docs/research/rt-denoiser/results/DISTANCE-LONG.md): build the looped
// captures, run the distance probe (distance.html, src/distance.ts) over the matrix, and summarize.
//
//   node examples/realtime-denoiser/distance-long.mjs loops                       # build dl-* loop captures
//   BASE=http://127.0.0.1:5480/distance.html node examples/realtime-denoiser/distance-long.mjs run --out=<dir> [--only=<regex>] [--force]
//   node examples/realtime-denoiser/distance-long.mjs table --out=<dir> [--md=<file>]
//
// Source captures (CAPTURES.md here and examples/three-temporal/CAPTURES.md):
//   dl-glossy, dl-thin   test bed `glossy-arrive` / `thin-arrive` (124 frames: 60-frame arc, then the hold pose),
//                        signal=diffuse,specular,shadows,ao,so, 256 spp references (ao_ref / so_ref extra buffers):
//                        node examples/realtime-denoiser/run-headless.mjs "mode=capture&name=dl-glossy&path=glossy-arrive&signal=diffuse,specular,shadows,ao,so&refspp=256"
//   three-knot-still     existing (32 frames, static)
//   bistro-orbit         existing (48 frames); bistro-hold (32 frames at bistro-orbit's last pose, path frames 48-79):
//                        node examples/three-temporal/run-realtime.mjs capture --port=<p> --set=bistro-hold --refShadow=128 --refDiffuse=128 --refSpec=32 --chunk=8
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const args = process.argv.slice(2);
const cmd = args[0];
const opt = (k, d) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;

// ---- loop captures: name, head, hold, total
const LOOPS = [
  { name: 'dl-glossy-hold', hold: 'dl-glossy:61:124', total: 378 },
  { name: 'dl-glossy-arrive', head: 'dl-glossy:0:61', hold: 'dl-glossy:61:124', total: 61 + 378 },
  { name: 'dl-thin-hold', hold: 'dl-thin:61:124', total: 378 },
  { name: 'dl-thin-arrive', head: 'dl-thin:0:61', hold: 'dl-thin:61:124', total: 61 + 378 },
  { name: 'dl-knot-hold', hold: 'three-knot-still:0:32', total: 384 },
  // 63 periods: where the shadow history's g ends up in rarely occluded pixels (it kept falling over 384 frames)
  { name: 'dl-knot-long', hold: 'three-knot-still:0:32', total: 2016 },
  { name: 'dl-bistro-hold', hold: 'bistro-hold:0:32', total: 384 },
  { name: 'dl-bistro-arrive', head: 'bistro-orbit:0:48', hold: 'bistro-hold:0:32', total: 48 + 384 },
];

// ---- probe matrix: (signal, variant) -> denoiser id + settings
const VARIANTS = {
  visibility: [
    ['default', 'shadows', {}],
    ['f16rn', 'shadows', { 'sh.f16Rounding': 'nearest' }],
  ],
  diffuse: [
    ['default', 'svgf-auto', {}],
    ['f16rn', 'svgf-auto', { f16Rounding: 'nearest' }],
    ['recurrent', 'recurrent-diffuse', {}],
    ['recurrent-f16rn', 'recurrent-diffuse', { 'r.f16Rounding': 'nearest' }],
  ],
  specular: [
    ['default', 'svgf-auto', {}],
    ['f16rn', 'svgf-auto', { f16Rounding: 'nearest' }],
    ['recurrent', 'recurrent-specular', {}],
    ['recurrent-f16rn', 'recurrent-specular', { 'r.f16Rounding': 'nearest' }],
  ],
  ao: [
    ['default', 'occlusion-svgf-auto', {}],
    ['f16rn', 'occlusion-svgf-auto', { f16Rounding: 'nearest' }],
    ['recurrent', 'occlusion-recurrent', {}],
    ['recurrent-f16rn', 'occlusion-recurrent', { 'r.f16Rounding': 'nearest' }],
  ],
};
VARIANTS.so = VARIANTS.ao;
const CAPTURE_SIGNALS = {
  'dl-glossy-hold': ['visibility', 'diffuse', 'specular', 'ao', 'so'],
  'dl-glossy-arrive': ['visibility', 'diffuse', 'specular', 'ao', 'so'],
  'dl-thin-hold': ['visibility', 'diffuse', 'specular', 'ao', 'so'],
  'dl-thin-arrive': ['visibility', 'diffuse', 'specular', 'ao', 'so'],
  'dl-knot-hold': ['visibility', 'diffuse', 'ao'],
  'dl-knot-long': ['visibility'],
  'dl-bistro-hold': ['visibility', 'diffuse', 'specular', 'ao'],
  'dl-bistro-arrive': ['visibility', 'diffuse', 'specular', 'ao'],
};
const runs = () => Object.entries(CAPTURE_SIGNALS).flatMap(([cap, sigs]) => sigs.flatMap((s) => VARIANTS[s].map(([v, id, st]) => ({
  key: `${cap}__${s}__${v}`, cap, signal: s, variant: v, query: `capture=${cap}&denoiser=${id}&signal=${s}${Object.entries(st).map(([k, x]) => `&${k}=${x}`).join('')}`,
}))));

// ---- summary ------------------------------------------------------------------------------------------
const db = (mse) => (mse > 0 ? 10 * Math.log10(1 / mse) : NaN);
const f = (x, d = 4) => (Number.isFinite(x) ? x.toFixed(d) : '–');
const fs = (x, d = 4) => (Number.isFinite(x) ? (x >= 0 ? '+' : '') + x.toFixed(d) : '–');
const meanOf = (a) => { const v = a.filter(Number.isFinite); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : NaN; };
/** least-squares slope of y over x and the residual std */
function fit(x, y) {
  const n = x.length, mx = meanOf(x), my = meanOf(y);
  let sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; }
  const b = sxx ? sxy / sxx : 0;
  const res = y.map((v, i) => v - (my + b * (x[i] - mx)));
  return { slope: b, resid: Math.sqrt(res.reduce((s, v) => s + v * v, 0) / Math.max(n - 2, 1)) };
}

/** Per-run settled numbers: windows 1.. of the hold (window 0 = settling), and the drift of each over the windows. */
function settled(r, region) {
  const ws = r.windows.slice(1).map((w) => w.regions[region]).filter(Boolean);
  if (!ws.length) return null;
  const x = r.windows.slice(1).map((w) => (w.start + w.end) / 2 - r.holdStart);
  const s = (k) => ws.map((w) => w[k]);
  const pf = r.perFrame.regions[region];
  const boilW = r.windows.slice(1).map((w) => meanOf(pf.boil.slice(w.start, w.end)));
  const fr = (k) => fit(x, s(k));
  return {
    n: ws[0].n, windows: ws.length,
    bias: meanOf(s('bias')), mseDb: db(meanOf(s('mse'))), tvar: meanOf(s('tvar')), edge: meanOf(s('edge')), lin: meanOf(s('lin')),
    dLog: meanOf(s('dLogRatio')), boil: meanOf(boilW),
    // drift over the settled windows: change per 100 frames (identical inputs every window: any change is the filter's state)
    driftBias: fr('bias').slope * 100, driftLin: fr('lin').slope * 100, driftEdge: fr('edge').slope * 100, driftDLog: fr('dLogRatio').slope * 100,
    driftMseDb: fit(x, s('mse').map(db)).slope * 100,
    span: { bias: Math.max(...s('bias')) - Math.min(...s('bias')), mseDb: Math.max(...s('mse').map(db)) - Math.min(...s('mse').map(db)) },
    w0: r.windows[0].regions[region], wLast: r.windows.at(-1).regions[region],
  };
}

function summarize(res) {
  const L = [];
  const keys = Object.keys(res).sort();
  const caps = [...new Set(keys.map((k) => k.split('__')[0]))];
  L.push('### Settled hold (windows 1..K-1 of each run; P = hold period)\n');
  L.push('| capture | signal | variant | region | px | bias | PSNR of mean (dB) | temporal var | edge | brightness | boil | stored/raw distance | drift bias /100 f | drift PSNR dB /100 f | drift brightness /100 f | drift distance /100 f |');
  L.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const k of keys) {
    const r = res[k];
    const [cap, sig, v] = k.split('__');
    for (const reg of r.regions) {
      const s = settled(r, reg);
      if (!s) continue;
      L.push(`| ${cap} | ${sig} | ${v} | ${reg} | ${s.n} | ${fs(s.bias)} | ${f(s.mseDb, 2)} | ${s.tvar.toExponential(2)} | ${f(s.edge, 3)} | ${f(s.lin, 4)} | ${f(s.boil, 4)} | ${Number.isFinite(s.dLog) ? f(Math.exp(s.dLog), 4) : '–'} | ${fs(s.driftBias, 5)} | ${fs(s.driftMseDb, 3)} | ${fs(s.driftLin, 5)} | ${fs(s.driftDLog, 5)} |`);
    }
  }
  // f16 rounding: nearest vs native on identical inputs
  L.push('\n### f16 store rounding: \'nearest\' minus native (settled windows, same capture)\n');
  L.push('| capture | signal | filter | region | Δ bias | Δ PSNR (dB) | Δ brightness | Δ edge | stored/raw distance native → nearest |');
  L.push('|---|---|---|---|---|---|---|---|---|');
  for (const k of keys.filter((x) => x.endsWith('f16rn'))) {
    const base = k.replace(/(__|-)f16rn$/, (m) => (m === '__f16rn' ? '__default' : ''));
    if (!res[base]) continue;
    const [cap, sig, v] = k.split('__');
    for (const reg of res[k].regions) {
      const a = settled(res[base], reg), b = settled(res[k], reg);
      if (!a || !b) continue;
      L.push(`| ${cap} | ${sig} | ${v.replace(/-?f16rn/, '') || 'default'} | ${reg} | ${fs(b.bias - a.bias, 5)} | ${fs(b.mseDb - a.mseDb, 3)} | ${fs(b.lin - a.lin, 5)} | ${fs(b.edge - a.edge, 4)} | ${Number.isFinite(a.dLog) ? `${f(Math.exp(a.dLog), 4)} → ${f(Math.exp(b.dLog), 4)}` : '–'} |`);
    }
  }
  // same final view, two histories: arrive minus hold per aligned window
  L.push('\n### Same view, two histories: arrive minus hold, per aligned hold window (identical hold inputs)\n');
  L.push('| scene | signal | variant | region | Δ PSNR of mean (dB) by window 0..K-1 | Δ bias (last window) | Δ edge (last) | Δ brightness (last) |');
  L.push('|---|---|---|---|---|---|---|---|');
  for (const k of keys.filter((x) => x.includes('-arrive__'))) {
    const h = k.replace('-arrive__', '-hold__');
    if (!res[h]) continue;
    const A = res[k], B = res[h];
    const [cap, sig, v] = k.split('__');
    for (const reg of A.regions) {
      const d = A.windows.map((w, i) => (B.windows[i] ? db(w.regions[reg].mse) - db(B.windows[i].regions[reg].mse) : NaN));
      const a = A.windows.at(-1).regions[reg], b = B.windows.at(-1).regions[reg];
      L.push(`| ${cap.replace('-arrive', '')} | ${sig} | ${v} | ${reg} | ${d.map((x) => fs(x, 2)).join(' ')} | ${fs(a.bias - b.bias, 5)} | ${fs(a.edge - b.edge, 4)} | ${fs(a.lin - b.lin, 5)} |`);
    }
  }
  void caps;
  return L.join('\n') + '\n';
}

// ---- commands (after the helpers above are initialized)
if (cmd === 'loops') {
  for (const l of LOOPS) {
    const src = (l.head ? [l.head, l.hold] : [l.hold]).map((s) => s.split(':')[0]);
    if (!src.every((c) => existsSync(path.join(REPO, 'tools', 'rt-capture', 'captures', c, 'capture.json')) || process.env.RT_CAPTURE_DIR)) { console.log(`skip ${l.name}: missing ${src}`); continue; }
    spawnSync(process.execPath, [path.join(REPO, 'tools', 'rt-capture', 'loop-capture.mjs'), l.name, `--hold=${l.hold}`, `--total=${l.total}`,
      ...(l.head ? [`--head=${l.head}`] : []), '--avg-refs'], { stdio: 'inherit' });
  }
} else if (cmd === 'run') {
  const out = path.resolve(opt('out', 'distance-long'));
  mkdirSync(out, { recursive: true });
  const only = opt('only') ? new RegExp(opt('only')) : null;
  for (const r of runs()) {
    if (only && !only.test(r.key)) continue;
    const file = path.join(out, `${r.key}.json`);
    if (existsSync(file) && !args.includes('--force')) continue;
    const t = Date.now();
    const p = spawnSync(process.execPath, [path.join(HERE, 'run-headless.mjs'), `--json=${file}`, r.query], { encoding: 'utf8', env: process.env });
    const ok = existsSync(file) && JSON.parse(readFileSync(file, 'utf8'))[0]?.ready;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${r.key} ${((Date.now() - t) / 1000).toFixed(0)} s${ok ? '' : '\n' + (p.stdout ?? '').slice(-1500)}`);
  }
} else if (cmd === 'table') {
  const out = path.resolve(opt('out', 'distance-long'));
  const res = {};
  for (const f of readdirSync(out).filter((x) => x.endsWith('.json'))) {
    const r = JSON.parse(readFileSync(path.join(out, f), 'utf8'))[0]?.results;
    if (r) res[f.replace(/\.json$/, '')] = r;
  }
  const md = summarize(res);
  if (opt('md')) writeFileSync(opt('md'), md);
  console.log(md);
} else {
  console.log('usage: distance-long.mjs loops | run --out=<dir> [--only=re] [--force] | table --out=<dir> [--md=file]');
  process.exit(2);
}

