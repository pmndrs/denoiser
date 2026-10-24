// Replay page: ?capture=<name>&denoiser=<id>[&signals=diffuse,specular][&frames=N][&output=<folder>]
// Any other query parameter is passed to the denoiser as a setting (and lands in run.json).
// No capture: lists captures and denoisers. Result in window.__rtc for run-headless.mjs.
import { DENOISERS } from './denoisers';
import { replay } from './replay';
import { CaptureClient, type SignalName } from './format';

type State = { ready: boolean; error?: string; results?: unknown; frame?: number };
const out: State = { ready: false };
(window as unknown as { __rtc: State }).__rtc = out;
const status = document.querySelector<HTMLPreElement>('#status')!;
const log = (s: string) => { status.textContent += s + '\n'; };

const RESERVED = new Set(['capture', 'denoiser', 'signals', 'frames', 'output']);

async function main() {
  const q = new URLSearchParams(location.search);
  const client = new CaptureClient();
  const capture = q.get('capture');
  if (!capture) {
    const caps = (await client.list('captures')).filter((e) => e.dir).map((e) => e.name);
    log(`captures: ${caps.join(', ') || '(none: node tools/rt-capture/gen-synthetic.mjs)'}`);
    log(`denoisers: ${[...DENOISERS.keys()].join(', ')}`);
    log('usage: ?capture=<name>&denoiser=<id>[&signals=a,b][&frames=N][&output=<folder>][&<setting>=<value>]');
    out.results = { captures: caps, denoisers: [...DENOISERS.keys()] };
    out.ready = true;
    return;
  }
  const id = q.get('denoiser') ?? 'accumulate';
  const entry = DENOISERS.get(id);
  if (!entry) throw new Error(`unknown denoiser "${id}" (have: ${[...DENOISERS.keys()].join(', ')})`);
  const settings = Object.fromEntries([...q].filter(([k]) => !RESERVED.has(k)));

  const adapter = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('WebGPU unavailable');
  const features: GPUFeatureName[] = adapter.features.has('timestamp-query') ? ['timestamp-query'] : [];
  const device = await adapter.requestDevice({
    requiredFeatures: features,
    requiredLimits: { maxStorageTexturesPerShaderStage: Math.min(8, adapter.limits.maxStorageTexturesPerShaderStage) },
  });
  device.addEventListener('uncapturederror', (e) => {
    const msg = (e as GPUUncapturedErrorEvent).error.message;
    console.error(msg);
    out.error ??= msg;
    log('GPU error: ' + msg);
  });
  log(`replay ${capture} through ${id} ${JSON.stringify(settings)} features=[${[...device.features].join(',')}]`);
  const t0 = performance.now();
  const r = await replay(device, {
    capture,
    denoiser: entry,
    settings,
    ...(q.get('signals') ? { signals: q.get('signals')!.split(',') as SignalName[] } : {}),
    ...(q.get('frames') ? { maxFrames: Number(q.get('frames')) } : {}),
    ...(q.get('output') ? { outputName: q.get('output')! } : {}),
    onFrame: (i) => { out.frame = i; if (i % 10 === 0) log(`frame ${i}`); },
  });
  const wall = r.timings.filter((t) => t.pass === 'wall').map((t) => t.ms).sort((a, b) => a - b);
  // GPU total per frame = sum of the per-signal 'total' passes
  const perFrame = new Map<number, number>();
  for (const t of r.timings) if (t.pass === 'total' || t.pass.endsWith('/total')) perFrame.set(t.frame, (perFrame.get(t.frame) ?? 0) + t.ms);
  const total = [...perFrame.values()].sort((a, b) => a - b);
  const summary = {
    capture, denoiser: id, outputDir: r.outputDir, signals: r.signals, frames: r.frames,
    medianWallMs: wall[Math.floor(wall.length / 2)] ?? null,
    medianGpuTotalMs: total[Math.floor(total.length / 2)] ?? null,
    elapsedS: +((performance.now() - t0) / 1000).toFixed(2),
  };
  log(JSON.stringify(summary, null, 1));
  out.results = summary;
  out.ready = true;
}

main().catch((e) => {
  console.error(e);
  out.error = String(e?.stack ?? e);
  log('ERROR: ' + out.error);
});
