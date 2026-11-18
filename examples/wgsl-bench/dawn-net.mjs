#!/usr/bin/env node
// The WGSL runtime's network alone (bind + run + queue drain) in dawn.node (npm
// `webgpu`: Dawn + Tint as a Node addon), outside the browser. This is the only way
// to reach subgroup matrices on Windows / NVIDIA today: Chrome on Windows runs Dawn
// on D3D12, which has none, while Dawn's Vulkan backend exposes the RTX tensor cores
// (16x16x16 f16 -> f32 cooperative matrices). See docs/specs/runtimes.md
// ("Subgroup matrices on Windows").
//
//   yarn workspace @pmndrs/denoiser-wgsl build      # the runner imports dist/
//   node examples/wgsl-bench/dawn-net.mjs [options] [variant ...]
//
// Options (key=value):
//   precision=fp32|fp16 (fp16)   model=rt_ldr_small   ch=3   sizes=1280x720,1920x1088
//   rounds=15 (round-robin, one run of each variant per round)   profile=1 (per-layer timestamps)
//   backend=vulkan|metal|d3d12 (vulkan on Windows/Linux, metal on macOS)
//   toggles=allow_unsafe_apis,vulkan_enable_f16_on_nvidia (Dawn toggles; default by backend)
// Variants (the first is the reference for max |Δ|; default: portable, then 'auto'):
//   wgsl~sm=0                      portable kernel
//   wgsl~sm=1                      subgroup matrices, type 'auto' (fp16: f16->f32 if offered)
//   wgsl~sm=1~smt=f16-f32~mt=32.4.2.2.2~shape=16x16x16
//   wgsl~prec=fp32~sm=0            fp32 oracle for an fp16 run
//   (mt=tw.th.ns.ob[.nso], smt=f32|f16|f16-f32, shape=MxNxK, emu=1)
//
// dawn.node: `npm i webgpu` somewhere, or DAWN_NODE=/path/to/node_modules/webgpu/index.js.
// On Windows copy C:\Windows\System32\vulkan-1.dll next to dist/win32-x64/dawn.node.
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// fp16 weights/inputs need Float16Array (Node 24+, or Node 22 with --js-float16array)
if (!globalThis.Float16Array) {
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync(process.execPath, ['--js-float16array', ...process.argv.slice(1)], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
const args = process.argv.slice(2);
const opt = Object.fromEntries(args.filter((a) => !a.startsWith('wgsl')).map((a) => a.split('=')));
const variants = args.filter((a) => a.startsWith('wgsl'));
if (!variants.length) variants.push('wgsl~sm=0', 'wgsl~sm=1');
const precision = opt.precision ?? 'fp16';
const model = opt.model ?? 'rt_ldr_small';
const ch = Number(opt.ch ?? 3);
const sizes = (opt.sizes ?? '1280x720,1920x1088').split(',').map((s) => s.split('x').map(Number));
const rounds = Number(opt.rounds ?? 15);
const profile = opt.profile === '1';
const backend = opt.backend ?? (os.platform() === 'darwin' ? 'metal' : 'vulkan');
const toggles = opt.toggles ?? (backend === 'vulkan' ? 'allow_unsafe_apis,vulkan_enable_f16_on_nvidia' : 'allow_unsafe_apis');

// dawn.node does not keep the event loop alive while GPU promises are pending
const keepAlive = setInterval(() => {}, 1000);

const webgpu = await import(process.env.DAWN_NODE ? pathToFileURL(process.env.DAWN_NODE).href : 'webgpu');
Object.assign(globalThis, webgpu.globals);
const gpu = webgpu.create([
  `backend=${backend}`,
  `enable-dawn-features=${toggles}`,
  'disable-dawn-features=timestamp_quantization',
]);
Object.defineProperty(globalThis, 'navigator', { value: { gpu }, configurable: true });

// the runtime fetches `${tzaUrl}/<model>.tza`: serve plain paths from disk
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (/^https?:/.test(u)) return realFetch(url, init);
  const buf = await readFile(u);
  return new Response(buf);
};

const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
if (!adapter) throw new Error('no adapter');
const info = adapter.info ?? {};
const want = ['chromium-experimental-subgroup-matrix', 'shader-f16', 'subgroups', 'timestamp-query'];
const requiredLimits = {};
for (const k in adapter.limits) if (typeof adapter.limits[k] === 'number') requiredLimits[k] = adapter.limits[k];
const device = await adapter.requestDevice({
  requiredFeatures: want.filter((f) => adapter.features.has(f)),
  requiredLimits,
});
device.addEventListener?.('uncapturederror', (e) => console.error('uncaptured:', e.error?.message));
const configs = Array.from(info.subgroupMatrixConfigs ?? []).map((c) => `${c.componentType}->${c.resultComponentType} ${c.M}x${c.N}x${c.K}`);
console.log(`dawn.node · ${backend} +${toggles} · ${info.vendor} ${info.architecture} ${info.description ?? ''}`);
console.log(`subgroups ${info.subgroupMinSize}..${info.subgroupMaxSize} · matrix configs: ${configs.join(', ') || 'none'}`);
console.log(`features: ${want.map((f) => `${f} ${device.features.has(f) ? 'yes' : 'no'}`).join(' · ')}`);
// the runtime reads device.adapterInfo; dawn.node 0.6.2's has an empty subgroupMatrixConfigs, the adapter's is complete
if (!device.adapterInfo?.subgroupMatrixConfigs?.length) Object.defineProperty(device, 'adapterInfo', { value: info, configurable: true });

const { WgslRuntime } = await import(pathToFileURL(path.join(repo, 'packages/denoiser-wgsl/dist/index.mjs')).href);
const F16 = globalThis.Float16Array;
const tzaUrl = path.join(repo, 'packages/denoiser/tzas');

function runtimeFor(spec) {
  const o = new Map(spec.split('~').slice(1).map((x) => x.split('=')));
  const sm = o.get('sm');
  const mt = o.get('mt')?.split('.').map(Number);
  return {
    prec: o.get('prec') ?? precision,
    rt: new WgslRuntime({
      tzaUrl, device, profile,
      subgroupMatrix: sm === '0' ? false : sm === '1' ? true : 'auto',
      subgroupMatrixType: o.get('smt'),
      subgroupMatrixShape: o.get('shape')?.split('x').map(Number),
      subgroupMatrixEmulate: o.get('emu') === '1',
      mmaTiling: mt ? { tw: mt[0], th: mt[1], ns: mt[2], ob: mt[3], ...(mt[4] ? { nso: mt[4] } : {}) } : undefined,
    }),
  };
}

function inputFor(w, h) {
  const n = ch * w * h;
  const host = new Float32Array(n);
  let s = 1234567;
  for (let i = 0; i < n; i++) { s = (s * 1103515245 + 12345) >>> 0; host[i] = (s >>> 8) / 16777216; }
  return precision === 'fp16' ? Float32Array.from(new F16(host)) : host;
}

async function readOut(buf, f16) {
  const rb = device.createBuffer({ size: buf.size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const enc = device.createCommandEncoder();
  enc.copyBufferToBuffer(buf, 0, rb, 0, buf.size);
  device.queue.submit([enc.finish()]);
  await rb.mapAsync(GPUMapMode.READ);
  const raw = rb.getMappedRange().slice(0);
  rb.unmap();
  rb.destroy();
  return f16 ? Float32Array.from(new F16(raw)) : new Float32Array(raw);
}

const median = (xs) => [...xs].sort((a, b) => a - b)[xs.length >> 1];
const results = { backend, toggles, adapter: `${info.vendor} ${info.architecture} ${info.description ?? ''}`, configs, precision, model, rows: {} };
const live = [];
for (const spec of variants) {
  const { prec, rt } = runtimeFor(spec);
  const session = await rt.load({ name: model, channels: ch, precision: prec });
  const kinds = new Map();
  for (const [layer, k] of Object.entries(rt.layerKernels ?? {})) kinds.set(k, [...(kinds.get(k) ?? []), layer]);
  console.log(`${spec}: ${[...kinds].map(([k, ls]) => `${k} ×${ls.length}`).join(' · ')}`);
  live.push({ spec, prec, rt, session });
}
for (const [w, h] of sizes) {
  const key = `${w}x${h}`;
  const host = inputFor(w, h);
  const per = [];
  for (const l of live) {
    const f16 = l.prec === 'fp16';
    const b = await l.session.bind({ batch: 1, tileW: w, tileH: h });
    const data = f16 ? new F16(host) : host;
    device.queue.writeBuffer(b.input, 0, new Uint8Array(data.buffer)); // byte view: dawn.node sizes a Float16Array view as 1 B/element
    await b.run();
    await device.queue.onSubmittedWorkDone();
    per.push({ l, b, out: await readOut(b.output, f16), times: [] });
  }
  for (let r = 0; r < rounds + 2; r++) {
    for (const p of per) {
      const t = performance.now();
      await p.b.run();
      await device.queue.onSubmittedWorkDone();
      if (r >= 2) p.times.push(performance.now() - t);
    }
  }
  for (const p of per) {
    let m = 0;
    let sum = 0;
    for (let j = 0; j < p.out.length; j++) { const e = Math.abs(p.out[j] - per[0].out[j]); m = Math.max(m, e); sum += e; }
    const row = { min: Math.min(...p.times), median: median(p.times), maxAbsDiff: m, meanAbsDiff: sum / p.out.length };
    if (profile && p.l.rt.lastProfile) {
      await p.b.run(); // profiled run (waits for its timestamps)
      row.layers = p.l.rt.lastProfile;
    }
    (results.rows[p.l.spec] ??= {})[key] = row;
    console.log(`${key.padEnd(10)} ${p.l.spec.padEnd(48)} min ${row.min.toFixed(2)} · median ${row.median.toFixed(2)} ms · max |Δ| ${m.toExponential(2)} · mean ${row.meanAbsDiff.toExponential(2)}`);
    if (row.layers) console.log(`  layers: ${row.layers.map((x) => `${x.name} ${x.ms.toFixed(2)}`).join(' · ')}`);
    p.b.release();
  }
}
for (const l of live) l.session.release();
console.log(JSON.stringify(results));
clearInterval(keepAlive);
device.destroy();
process.exit(0);
