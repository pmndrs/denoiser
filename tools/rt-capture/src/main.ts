// Replay page: ?capture=<name>&denoiser=<id>[&signals=diffuse,specular][&frames=N][&output=<folder>]
// Any other query parameter is passed to the denoiser as a setting (and lands in run.json).
// (src/run.ts; the test bed's ?mode=replay runs the same code.)
// No capture: lists captures and denoisers. Result in window.__rtc for run-headless.mjs.
// ?mode=rewrite&capture=<name>[&as=<new name>]: uploads the capture to GPU textures and
// writes it back through CaptureWriter (default <name>-rewrite): a writer/readback self-test
// (compare the two folders byte for byte).
import { DENOISERS, registerDenoiser } from './denoisers';
import { registerOidnDenoisers } from './oidn-entries';
import { CaptureTextures, loadManifest } from './replay';
import { replayFromQuery } from './run';
import { CaptureWriter } from './writer';
import { CaptureClient } from './format';

// Offline (async, replay-only) entries: OIDN 2 single-frame baseline (src/oidn-entries.ts).
registerOidnDenoisers(registerDenoiser);

type State = { ready: boolean; error?: string; results?: unknown; frame?: number };
const out: State = { ready: false };
(window as unknown as { __rtc: State }).__rtc = out;
const status = document.querySelector<HTMLPreElement>('#status')!;
const log = (s: string) => { status.textContent += s + '\n'; };

const MANIFEST_KEYS = new Set(['version', 'scene', 'generator', 'width', 'height', 'reversedDepth', 'static', 'demodulation', 'lights', 'buffers', 'referenceSpp', 'frames']);

async function rewrite(device: GPUDevice, capture: string, as: string) {
  const m = await loadManifest(capture);
  const caps = new CaptureTextures(device, m, capture);
  const w = new CaptureWriter(device, as);
  await w.begin({
    scene: m.scene, width: m.width, height: m.height, lights: m.lights, referenceSpp: m.referenceSpp,
    reversedDepth: m.reversedDepth, static: m.static, demodulation: m.demodulation, generator: m.generator,
    extra: Object.fromEntries(Object.entries(m).filter(([k]) => !MANIFEST_KEYS.has(k))),
  });
  for (const f of m.frames) {
    await caps.load(f.index);
    const { index, reset, camera, ...extra } = f;
    await w.writeFrame({ index, reset, camera, extra }, caps.textures);
    out.frame = f.index;
  }
  const r = await w.finish();
  caps.dispose();
  return { rewritten: r.path, frames: r.frames };
}

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
  if (q.get('mode') === 'rewrite') {
    out.results = await rewrite(device, capture, q.get('as') ?? `${capture}-rewrite`);
    log(JSON.stringify(out.results));
    out.ready = true;
    return;
  }
  out.results = await replayFromQuery(device, q, { log, onFrame: (i) => { out.frame = i; } });
  out.ready = true;
}

main().catch((e) => {
  console.error(e);
  out.error = String(e?.stack ?? e);
  log('ERROR: ' + out.error);
});
