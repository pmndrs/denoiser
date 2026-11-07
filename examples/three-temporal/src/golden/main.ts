// Page glue of golden.html: URL parameters -> kit + engine -> window.__golden (the headless contract of GOLDEN.md).
import * as THREE from 'three/webgpu';
import { createEngine, type Buf, type Engine } from './engine';
import { listGoldenDenoisers } from './denoisers';
import { bistroLightKit, cornerKit, productKit, sponzaKit } from './kits';
import { KINDS, MODES, SCENE_REGISTRY, SIGNALS, SIGNAL_CHANNELS, sceneById, pathOfScene, type Kind, type Mode, type Signal } from './registry';
import type { Kit } from './types';

const q = new URLSearchParams(location.search);
const statusEl = document.querySelector<HTMLPreElement>('#status')!;
const log = (m: string) => { statusEl.textContent = m; console.log('[golden]', m); };
const win = window as unknown as { __golden?: unknown; __error?: string };

const list = () => ({
  scenes: SCENE_REGISTRY, modes: MODES, kinds: KINDS,
  denoisers: listGoldenDenoisers(),
  signals: Object.entries(SIGNAL_CHANNELS).map(([name, channels]) => ({ name, channels })),
});

const toB64 = (a: Float32Array | Uint8Array) => {
  const u8 = a instanceof Uint8Array ? a : new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
};
const sha256 = async (a: Float32Array) => {
  const d = await crypto.subtle.digest('SHA-256', new Uint8Array(a.buffer.slice(a.byteOffset, a.byteOffset + a.byteLength) as ArrayBuffer));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
};
const median = (v: number[]) => { const s = [...v].sort((a, b) => a - b); return s[s.length >> 1]; };

async function main() {
  if (q.get('list') === '1') { win.__golden = { ready: true, list }; log('list only'); return; }
  const sceneInfo = sceneById(q.get('scene') ?? 'G2');
  if (!sceneInfo) throw new Error(`unknown scene "${q.get('scene')}" (G1-G5)`);
  if (sceneInfo.kind === 'external') throw new Error(`${sceneInfo.id} is rendered by ${sceneInfo.externalPage} (owned by another track); see GOLDEN.md`);
  const pathInfo = pathOfScene(sceneInfo, q.get('path'));
  if (!pathInfo) throw new Error(`unknown path "${q.get('path')}" for ${sceneInfo.id} (${sceneInfo.paths.map((p) => p.name).join(', ')})`);
  const mode = (q.get('mode') ?? 'run') as Mode;
  if (!MODES.includes(mode)) throw new Error(`unknown mode "${mode}"`);
  const res = q.get('res') ?? 'half';
  const W = Number(q.get('w') ?? (res === '1080p' ? 1920 : 960)), H = Number(q.get('h') ?? (res === '1080p' ? 1080 : 540));
  const seed = Number(q.get('seed') ?? 1);
  const signals = (q.get('signals') ? q.get('signals')!.split(',') : SIGNALS) as Signal[];
  const frames = pathInfo.frames;

  const canvas = document.querySelector<HTMLCanvasElement>('#view')!;
  canvas.width = W; canvas.height = H;
  log(`building ${sceneInfo.id}/${pathInfo.name} ${W}x${H} mode ${mode}...`);
  let kit: Kit;
  switch (sceneInfo.id) {
    case 'G2': kit = await cornerKit(pathInfo.source as 'knot-static' | 'knot-orbit', W, H, frames); break;
    case 'G3': kit = await sponzaKit(pathInfo.name as 'orbit' | 'pan' | 'hold', W, H, frames); break;
    case 'G4': kit = await bistroLightKit(pathInfo.name as never, W, H, frames); break;
    case 'G5': kit = await productKit(W, H, frames); break;
    default: throw new Error(`no kit for ${sceneInfo.id}`);
  }
  const options = q.get('options') ? JSON.parse(q.get('options')!) : {};
  const eng: Engine = await createEngine(canvas, {
    kit, mode, denoiser: q.get('denoiser') ?? 'ours', options, width: W, height: H, seed,
    referenceSpp: Number(q.get('referenceSpp') ?? 4096), perfectSpp: Number(q.get('perfectSpp') ?? 256),
    referenceSppSpec: Number(q.get('referenceSppSpec') ?? 4096),
    withReference: q.get('withReference') === '1', refSeed: q.get('refSeed') === 'frame' ? 'frame' : 'fixed', signals, lean: q.get('lean') === '1',
    difRays: Number(q.get('difRays') ?? 8), visGrid: Number(q.get('visGrid') ?? 2), log,
  });

  let next = 0;
  let cut = true;
  let stash: Uint8Array | null = null;
  const step = async (n = 1) => {
    let r;
    for (let i = 0; i < n; i++) {
      if (next >= frames) throw new Error(`end of path (${frames} frames); reset() or seek()`);
      r = await eng.renderFrame(next, cut);
      cut = false; next++;
    }
    return r!;
  };
  const checkSpec = (spec: { signal: string; kind?: string }) => {
    if (!(spec.signal in SIGNAL_CHANNELS)) throw new Error(`unknown signal "${spec.signal}"`);
    if (spec.kind && !(KINDS as readonly string[]).includes(spec.kind)) throw new Error(`unknown kind "${spec.kind}"`);
  };
  const api = {
    ready: true,
    gpuErrors: eng.gpuErrors,
    list,
    info: () => ({
      scene: sceneInfo.id, path: pathInfo.name, mode, denoiser: eng.denoiserId, options, width: W, height: H, seed, frames,
      referenceSpp: Number(q.get('referenceSpp') ?? 4096), perfectSpp: Number(q.get('perfectSpp') ?? 256), referenceFrames: eng.refFrames, refSeed: q.get('refSeed') === 'frame' ? 'frame' : 'fixed',
      signals, applies: eng.applies, events: pathInfo.events, lights: kit.captureLights(),
      camera: { near: kit.camera.near, far: kit.camera.far, fov: kit.camera.fov }, three: THREE.REVISION, gpu: eng.adapterInfo,
      kit: kit.info, triangles: kit.triangles, lean: q.get('lean') === '1', withReference: q.get('withReference') === '1',
    }),
    state: () => ({ frame: eng.lastFrame, nextFrame: next, framesRendered: eng.framesRendered }),
    async reset() { next = 0; cut = true; },
    async seek(f: number) { next = Math.max(0, Math.min(frames - 1, Math.round(f))); cut = true; },
    step,
    async read(spec: { signal: string; kind?: Kind }): Promise<Buf> { checkSpec(spec); return eng.read(spec); },
    async readB64(spec: { signal: string; kind?: Kind }) { checkSpec(spec); const b = await eng.read(spec); return { width: b.width, height: b.height, channels: b.channels, b64: toB64(b.data) }; },
    /** Chunked transfer for big buffers (Node's WebSocket stalls on single CDP messages above a few MB): readStart stashes the bytes. */
    async readStart(spec: { signal: string; kind?: Kind }) {
      checkSpec(spec);
      const b = await eng.read(spec);
      stash = new Uint8Array(b.data.buffer, b.data.byteOffset, b.data.byteLength);
      return { width: b.width, height: b.height, channels: b.channels, bytes: stash.byteLength };
    },
    readChunk(offset: number, n: number) { return toB64(stash!.subarray(offset, offset + n)); },
    async hash(spec: { signal: string; kind?: Kind }) { checkSpec(spec); return sha256((await eng.read(spec)).data); },
    timings: () => {
      const s = eng.lastStep;
      const gpuMs = s?.gpuMs ?? {};
      return { frame: s?.frame ?? null, wallMs: s?.wallMs ?? null, gpuMs, gpuTotalMs: gpuMs.total ?? 0, passes: Object.keys(gpuMs) };
    },
    /** Median / min / mean per pass over `n` stepped frames (run mode; reads nothing). */
    async time(n = 60, warm = 10) {
      next = 0; cut = true;
      const wall: number[] = [];
      const passes: Record<string, number[]> = {};
      for (let i = 0; i < warm + n; i++) {
        if (next >= frames) { next = 0; cut = true; }
        const r = await step(1);
        if (i < warm) continue;
        wall.push(r.wallMs);
        for (const [k, v] of Object.entries(r.gpuMs)) (passes[k] ??= []).push(v);
      }
      const stat = (v: number[]) => ({ median: median(v), min: Math.min(...v), mean: v.reduce((a, b) => a + b, 0) / v.length });
      return { frames: n, wall: stat(wall), gpu: Object.fromEntries(Object.entries(passes).map(([k, v]) => [k, stat(v)])) };
    },
    capture: (c?: { name?: string; start?: number; frames?: number }) => eng.capture({ name: c?.name ?? `golden-${sceneInfo.id}-${pathInfo.name}`, start: c?.start, frames: c?.frames }),
  };
  win.__golden = api;
  log(`ready - ${sceneInfo.id}/${pathInfo.name} ${W}x${H} mode ${mode} denoiser ${eng.denoiserId}; ${kit.triangles.toLocaleString()} triangles; three r${THREE.REVISION}`);
}

main().catch((e) => { log(`ERROR: ${(e as Error).stack ?? e}`); console.error(e); win.__error = String(e); });
