// Network-only spike: the OIDN U-Net built with MLGraphBuilder from the .tza
// weights, on WebNN contexts (deviceType gpu / npu / cpu, and a context created
// from our GPUDevice), vs the hand-written WGSL runtime on the same input.
//
// Params: model=rt_hdr_small · precision=fp32|fp16 · sizes=512x512,1920x1088 ·
// devs=gpu,npu,webgpu,wgsl (also cpu) · warm=N · layout=nchw|nhwc · k=8 (dispatches
// per pipelined sample).
//
// Per runner and size, all runners interleaved one call per round:
//   io    = write input + dispatch + read output (host in -> host out)
//   run   = dispatch + read output        (WGSL: run() + queue drain, no readback)
//   read  = read output alone             (WGSL: copy + map of the output)
//   pipe  = (k dispatches + one read - read) / k: the dispatch-only estimate
// Correctness: max |Δ| vs WGSL fp32 on the same input (WGSL fp32 is within ~2e-6
// of ORT-wasm CPU on these models, see docs/specs/runtimes.md).
import { parseTZA, type TensorMap } from '@pmndrs/denoiser-core';
import { WgslRuntime } from '@pmndrs/denoiser-wgsl';
import { buildOidnGraph } from './build';
import { ml, type MLContext, type MLTensor } from './webnn-types';

const params = new URLSearchParams(location.search);
const model = params.get('model') ?? 'rt_hdr_small';
const precision = params.get('precision') === 'fp16' ? 'fp16' : 'fp32';
const sizes = (params.get('sizes') ?? '512x512,1920x1088').split(',').map((s) => s.split('x').map(Number) as [number, number]);
const devs = (params.get('devs') ?? 'gpu,npu,webgpu,wgsl').split(',');
const WARM = Number(params.get('warm') ?? 15);
const K = Number(params.get('k') ?? 8);
const layout = params.get('layout') === 'nhwc' ? 'nhwc' : 'nchw';
const F16 = (globalThis as unknown as { Float16Array: Float32ArrayConstructor }).Float16Array;
const f16 = precision === 'fp16';

const status = document.querySelector<HTMLPreElement>('#status')!;
const log = (m: string) => { status.textContent += m + '\n'; console.log(m); };
const results: Record<string, unknown> = { model, precision, sizes, devs, warm: WARM, k: K, layout, ua: navigator.userAgent };
const done = (extra: Record<string, unknown>) => { (window as unknown as { __result: unknown }).__result = { ...results, ...extra }; };

function timeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`${what}: timed out after ${ms} ms`)), ms))]);
}
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[s.length >> 1]; };
const min = (xs: number[]) => Math.min(...xs);

async function requestMaxDevice(): Promise<GPUDevice> {
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('no WebGPU adapter');
  const requiredLimits: Record<string, number> = {};
  for (const name of Object.getOwnPropertyNames(Object.getPrototypeOf(adapter.limits))) {
    const v = (adapter.limits as unknown as Record<string, unknown>)[name];
    if (typeof v === 'number') requiredLimits[name] = v;
  }
  return adapter.requestDevice({ requiredFeatures: [...adapter.features] as GPUFeatureName[], requiredLimits });
}

function inputFor(n: number): Float32Array {
  const host = new Float32Array(n);
  let s = 1234567;
  for (let i = 0; i < n; i++) { s = (s * 1103515245 + 12345) >>> 0; host[i] = (s >>> 8) / 16777216; }
  return host;
}

function maxAbs(a: Float32Array, b: Float32Array) {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
}

async function readGpu(device: GPUDevice, src: GPUBuffer, half: boolean): Promise<Float32Array> {
  const buf = device.createBuffer({ size: src.size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const enc = device.createCommandEncoder();
  enc.copyBufferToBuffer(src, 0, buf, 0, src.size);
  device.queue.submit([enc.finish()]);
  await buf.mapAsync(GPUMapMode.READ);
  const raw = buf.getMappedRange().slice(0);
  buf.unmap();
  buf.destroy();
  return half ? Float32Array.from(new F16(raw)) : new Float32Array(raw);
}

interface Runner {
  name: string;
  io(): Promise<void>;
  run(): Promise<void>;
  read(): Promise<void>;
  pipe(k: number): Promise<void>;
  output(): Promise<Float32Array>;
  release(): void;
  info: Record<string, unknown>;
}

async function wgslRunner(device: GPUDevice, w: number, h: number, prec: 'fp32' | 'fp16', host: Float32Array): Promise<Runner> {
  const rt = new WgslRuntime({ tzaUrl: '/tzas', device });
  const t0 = performance.now();
  const session = await rt.load({ name: model, channels: CH, precision: prec });
  const b = await session.bind({ batch: 1, tileW: w, tileH: h });
  const half = prec === 'fp16';
  const data = (half ? new F16(host) : host) as unknown as BufferSource;
  device.queue.writeBuffer(b.input, 0, data);
  await b.run();
  await device.queue.onSubmittedWorkDone();
  const firstMs = performance.now() - t0;
  const run = async () => { await b.run(); await device.queue.onSubmittedWorkDone(); };
  return {
    name: `wgsl-${prec}`,
    info: { firstMs },
    io: async () => { device.queue.writeBuffer(b.input, 0, data); await b.run(); await readGpu(device, b.output, half); },
    run,
    read: async () => { await readGpu(device, b.output, half); },
    pipe: async (k) => { for (let i = 0; i < k; i++) await b.run(); await device.queue.onSubmittedWorkDone(); },
    output: () => readGpu(device, b.output, half),
    release: () => { b.release(); session.release(); },
  };
}

let CH = 3;

async function webnnRunner(dev: string, ctx: MLContext, weights: TensorMap, w: number, h: number, host: Float32Array): Promise<Runner> {
  const built = await buildOidnGraph(ctx, weights, { precision, batch: 1, width: w, height: h, layout });
  const input = await ctx.createTensor({ dataType: built.dataType, shape: built.inShape, writable: true });
  const output = await ctx.createTensor({ dataType: built.dataType, shape: built.outShape, readable: true });
  const data = f16 ? new F16(host) : host;
  const t1 = performance.now();
  ctx.writeTensor(input, data);
  ctx.dispatch(built.graph, { input }, { output });
  await timeout(ctx.readTensor(output), 300_000, `${dev} first dispatch`);
  const firstMs = performance.now() - t1;
  const toF32 = (raw: ArrayBuffer) => (f16 ? Float32Array.from(new F16(raw)) : new Float32Array(raw));
  return {
    name: `webnn-${dev}`,
    info: { buildMs: built.buildMs, firstDispatchMs: firstMs },
    io: async () => { ctx.writeTensor(input, data); ctx.dispatch(built.graph, { input }, { output }); await ctx.readTensor(output); },
    run: async () => { ctx.dispatch(built.graph, { input }, { output }); await ctx.readTensor(output); },
    read: async () => { await ctx.readTensor(output); },
    pipe: async (k) => { for (let i = 0; i < k; i++) ctx.dispatch(built.graph, { input }, { output }); await ctx.readTensor(output); },
    output: async () => toF32(await ctx.readTensor(output)),
    release: () => { input.destroy(); output.destroy(); built.graph.destroy(); },
  };
}

async function main() {
  if (!ml) throw new Error('navigator.ml unavailable (enable WebMachineLearningNeuralNetwork)');
  const device = await requestMaxDevice();
  device.lost.then((i) => log(`GPUDevice lost: ${i.message}`));
  const res = await fetch(`/tzas/${model}.tza`);
  if (!res.ok) throw new Error(`no ${model}.tza`);
  const weights = parseTZA(await res.arrayBuffer());
  CH = (weights.get('enc_conv0.weight') ?? weights.get('enc_conv1a.weight'))!.shape[1];
  log(`webnn-bench · ${model} (${CH}ch) · ${precision} · layout ${layout} · warm = median (min) of ${WARM}, runners interleaved · k=${K}`);
  log(navigator.userAgent);

  const contexts: Record<string, { ctx: MLContext; ms: number }> = {};
  for (const dev of devs) {
    if (dev === 'wgsl') continue;
    const t0 = performance.now();
    try {
      const ctx = await timeout(
        dev === 'webgpu' ? ml.createContext(device) : ml.createContext({ deviceType: dev as 'gpu' }),
        120_000, `createContext(${dev})`);
      contexts[dev] = { ctx, ms: performance.now() - t0 };
      log(`context ${dev}: ${contexts[dev].ms.toFixed(0)} ms`);
    } catch (e) {
      log(`context ${dev} FAILED: ${e}`);
    }
  }
  results.contextMs = Object.fromEntries(Object.entries(contexts).map(([k, v]) => [k, v.ms]));

  const table: Record<string, unknown> = {};
  for (const [w, h] of sizes) {
    const key = `${w}x${h}`;
    const host = inputFor(CH * w * h);
    log(`\n--- ${key}`);
    // reference: WGSL fp32
    const refRunner = await wgslRunner(device, w, h, 'fp32', host);
    const ref = await refRunner.output();
    const runners: Runner[] = [];
    if (devs.includes('wgsl')) {
      if (precision === 'fp32') runners.push(refRunner);
      else { refRunner.release(); runners.push(await wgslRunner(device, w, h, 'fp16', host)); }
    } else refRunner.release();
    for (const dev of devs) {
      if (dev === 'wgsl' || !contexts[dev]) continue;
      try {
        runners.push(await webnnRunner(dev, contexts[dev].ctx, weights, w, h, host));
      } catch (e) {
        log(`${dev} ${key} FAILED: ${e}`);
        (table[`${key}.${dev}`] = { error: String(e) });
      }
    }
    // correctness
    for (const r of runners) {
      const out = await r.output();
      r.info.maxAbsVsWgslFp32 = maxAbs(out, ref);
      let finite = true;
      for (let i = 0; i < out.length; i++) if (!Number.isFinite(out[i])) { finite = false; break; }
      r.info.finite = finite;
    }
    // warmup
    for (const r of runners) for (let i = 0; i < 3; i++) await r.io();
    const samples: Record<string, Record<string, number[]>> = {};
    for (const r of runners) samples[r.name] = { io: [], run: [], read: [], pipe: [] };
    for (let round = 0; round < WARM; round++) {
      for (const kind of ['io', 'run', 'read'] as const) {
        for (const r of runners) {
          const t = performance.now();
          await r[kind]();
          samples[r.name][kind].push(performance.now() - t);
        }
      }
      for (const r of runners) {
        const t = performance.now();
        await r.pipe(K);
        samples[r.name].pipe.push(performance.now() - t);
      }
    }
    for (const r of runners) {
      const s = samples[r.name];
      const readMed = median(s.read);
      const row: Record<string, number | boolean | undefined> = {
        ...r.info,
        io: median(s.io), ioMin: min(s.io),
        run: median(s.run), runMin: min(s.run),
        read: readMed,
        dispatch: (median(s.pipe) - (r.name.startsWith('wgsl') ? 0 : readMed)) / K,
        dispatchMin: (min(s.pipe) - (r.name.startsWith('wgsl') ? 0 : min(s.read))) / K,
      };
      table[`${key}.${r.name}`] = row;
      const fmt = (x: unknown) => (typeof x === 'number' ? x.toFixed(2) : String(x));
      log(`${r.name.padEnd(13)} io ${fmt(row.io)} (${fmt(row.ioMin)})  run ${fmt(row.run)} (${fmt(row.runMin)})  read ${fmt(row.read)}  dispatch ${fmt(row.dispatch)} (${fmt(row.dispatchMin)})  maxΔ ${(row.maxAbsVsWgslFp32 as number).toExponential(2)}${row.finite ? '' : ' NON-FINITE'}`
        + (row.buildMs !== undefined ? `  build ${fmt(row.buildMs)} first ${fmt(row.firstDispatchMs)}` : `  first ${fmt(row.firstMs)}`));
      r.release();
    }
  }
  for (const { ctx } of Object.values(contexts)) ctx.destroy();
  device.destroy();
  done({ ready: true, table });
}

main().catch((e) => { log(`ERROR ${e?.stack ?? e}`); done({ error: String(e?.stack ?? e) }); });
