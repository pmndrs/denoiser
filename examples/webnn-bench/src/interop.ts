// WebNN <-> WebGPU interop probe: createExportableTensor + exportToGPU on a
// context made from our GPUDevice and on a deviceType context. Tiny graph
// (y = clamp(x, 0, 6)), checks what the exported GPUBuffer is and whether
// WebGPU writes / WebNN dispatches see each other, and how ownership moves.
import { ml, MLGraphBuilderCtor, type MLContext, type MLTensor } from './webnn-types';

const status = document.querySelector<HTMLPreElement>('#status')!;
const log = (m: string) => { status.textContent += m + '\n'; console.log(m); };
const out: Record<string, unknown> = {};
const params = new URLSearchParams(location.search);
const F16 = (globalThis as unknown as { Float16Array: Float32ArrayConstructor }).Float16Array;

async function readGpu(device: GPUDevice, src: GPUBuffer, n: number): Promise<Float32Array> {
  const buf = device.createBuffer({ size: n * 2, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const enc = device.createCommandEncoder();
  enc.copyBufferToBuffer(src, 0, buf, 0, n * 2);
  device.queue.submit([enc.finish()]);
  await buf.mapAsync(GPUMapMode.READ);
  const r = Float32Array.from(new F16(buf.getMappedRange().slice(0)));
  buf.unmap(); buf.destroy();
  return r;
}

async function step<T>(name: string, fn: () => Promise<T>): Promise<T | undefined> {
  try { const r = await fn(); log(`ok   ${name}${r !== undefined ? `: ${typeof r === 'object' ? JSON.stringify(r) : r}` : ''}`); return r; }
  catch (e) { log(`FAIL ${name}: ${e}`); out[`fail:${name}`] = String(e); return undefined; }
}

async function probe(label: string, ctx: MLContext, device: GPUDevice) {
  log(`\n== ${label}`);
  const n = 8;
  const shape = [1, 2, 2, 2];
  const b = new MLGraphBuilderCtor!(ctx);
  const x = b.input('x', { dataType: 'float16', shape });
  const graph = await b.build({ y: b.clamp(x, { minValue: 0, maxValue: 6 }) });
  const tx = await step('createExportableTensor(x)', () => ctx.createExportableTensor!({ dataType: 'float16', shape }, device)) as MLTensor | undefined;
  const ty = await step('createExportableTensor(y)', () => ctx.createExportableTensor!({ dataType: 'float16', shape }, device)) as MLTensor | undefined;
  if (!tx || !ty) return;
  log(`  tensor x: readable=${(tx as unknown as { readable: boolean }).readable} writable=${(tx as unknown as { writable: boolean }).writable}`);
  // 1) export x, write it from WebGPU, give it back (destroy), dispatch, export y, read from WebGPU
  const bx = await step('exportToGPU(x)', () => ctx.exportToGPU!(tx)) as GPUBuffer | undefined;
  if (!bx) return;
  log(`  exported buffer: size=${bx.size} usage=0x${bx.usage.toString(16)} mapState=${bx.mapState}`);
  const src = new Float32Array([-1, 0.5, 2, 7, 3, -4, 6.5, 1]);
  device.queue.writeBuffer(bx, 0, new F16(src));
  await device.queue.onSubmittedWorkDone();
  await step('dispatch while x exported (no destroy)', async () => { ctx.dispatch(graph, { x: tx }, { y: ty }); });
  const by1 = await step('exportToGPU(y) after that', () => ctx.exportToGPU!(ty)) as GPUBuffer | undefined;
  if (by1) {
    const r = await readGpu(device, by1, n);
    log(`  y (no destroy of x): ${[...r].join(',')}`);
    out.yNoDestroy = [...r];
    by1.destroy();
  }
  bx.destroy();
  await step('dispatch after x.destroy()', async () => { ctx.dispatch(graph, { x: tx }, { y: ty }); });
  const by = await step('exportToGPU(y)', () => ctx.exportToGPU!(ty)) as GPUBuffer | undefined;
  if (by) {
    const r = await readGpu(device, by, n);
    log(`  y: ${[...r].join(',')} (want -> 0,0.5,2,6,3,0,6,1)`);
    out[`${label}.y`] = [...r];
    // re-export x: same GPUBuffer object or a new one? Does the data survive?
    by.destroy();
  }
  const bx2 = await step('re-exportToGPU(x)', () => ctx.exportToGPU!(tx)) as GPUBuffer | undefined;
  if (bx2) {
    log(`  same buffer object as first export: ${bx2 === bx}`);
    const r = await readGpu(device, bx2, n);
    log(`  x content after re-export: ${[...r].join(',')}`);
    bx2.destroy();
  }
  // 2) timing: per-run export/destroy round trip cost
  const N = 50;
  let t = performance.now();
  for (let i = 0; i < N; i++) { const g = await ctx.exportToGPU!(tx); g.destroy(); }
  log(`  exportToGPU+destroy: ${((performance.now() - t) / N).toFixed(3)} ms each`);
  out[`${label}.exportMs`] = (performance.now() - t) / N;
  t = performance.now();
  for (let i = 0; i < N; i++) {
    const g = await ctx.exportToGPU!(tx); device.queue.writeBuffer(g, 0, new F16(src)); g.destroy();
    ctx.dispatch(graph, { x: tx }, { y: ty });
    const h = await ctx.exportToGPU!(ty); const r = await readGpu(device, h, n); h.destroy();
    if (r[3] !== 6) throw new Error('bad result in loop');
  }
  log(`  full export-in / dispatch / export-out / map loop (tiny graph): ${((performance.now() - t) / N).toFixed(3)} ms each`);
  out[`${label}.loopMs`] = (performance.now() - t) / N;
}

async function main() {
  if (!ml) throw new Error('no navigator.ml');
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  const device = await adapter!.requestDevice({ requiredFeatures: ['shader-f16'] });
  const kinds = (params.get('ctx') ?? 'webgpu,gpu,npu').split(',');
  for (const k of kinds) {
    const ctx = await (k === 'webgpu' ? ml.createContext(device) : ml.createContext({ deviceType: k as 'gpu' }));
    await probe(k, ctx, device).catch((e) => log(`probe ${k} threw: ${e}`));
    ctx.destroy();
  }
  (window as unknown as { __result: unknown }).__result = { ready: true, ...out };
}
main().catch((e) => { log(`ERROR ${e?.stack ?? e}`); (window as unknown as { __result: unknown }).__result = { error: String(e), ...out }; });
