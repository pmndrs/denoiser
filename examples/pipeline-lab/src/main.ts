// Pipeline Lab: the full offline-quality pipeline on one GPUDevice, every stage tweakable.
//
//   three-gpu-pathtracer (render scale x canvas, N samples)
//     → denoiser (any runtime, aux on/off, model size)       pathTracer.setDenoiser(DenoiserPass)
//     → @pmndrs/upscaler (FSR1 spatial / bilinear / off)     pathTracer.setUpscaler(UpscalerPass)
//     → canvas (the tracer's own present pass tone maps)
//
// The tracer drives both post passes itself: it denoises once every pixel reaches
// maxSamples, and upscales every frame before presenting. The compare view draws one
// earlier stage over the left part of the canvas.
//
// URL params: ?runtime= (reloads; see _shared/stack.ts) and every control's id, e.g.
// ?scene=spheres&size=1280x720&scale=0.5&spp=16&upscale=spatial.
import * as THREE from 'three/webgpu';
import { Fn, If, Discard, float, ivec2, screenUV, textureLoad, uniform, vec2, vec4 } from 'three/tsl';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { WebGPUPathTracer } from 'three-gpu-pathtracer/webgpu';
import { createStack, mountRuntimePicker } from '../../_shared/stack';
import { sampleCounter } from '../../_shared/pathtracer';
import { ensureWebGPU, demoFooter } from '../../_shared/chrome';
import { DenoiserPass, UpscalerPass, type UpscalePath } from './passes';
import { SCENES, type LabScene } from './scenes';

/** vite.config.ts `define`: packages/denoiser/models exists locally (dev only). */
declare const __LOCAL_ONNX_MODELS__: boolean;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const statusEl = $<HTMLPreElement>('status');
const log = (m: string) => { statusEl.textContent = m; console.log(m); };

// ---- controls, seeded from the URL ------------------------------------------------
const params = new URLSearchParams(location.search);
const ui = {
  scene: $<HTMLSelectElement>('scene'),
  size: $<HTMLSelectElement>('size'),
  scale: $<HTMLSelectElement>('scale'),
  spp: $<HTMLInputElement>('spp'),
  bounces: $<HTMLInputElement>('bounces'),
  denoise: $<HTMLInputElement>('denoise'),
  aux: $<HTMLInputElement>('aux'),
  quality: $<HTMLSelectElement>('quality'),
  upscale: $<HTMLSelectElement>('upscale'),
  sharpness: $<HTMLInputElement>('sharpness'),
  compare: $<HTMLSelectElement>('compare'),
  split: $<HTMLInputElement>('split'),
};
for (const o of SCENES) ui.scene.add(new Option(o.label, o.id));
for (const [k, el] of Object.entries(ui)) {
  const v = params.get(k);
  if (v === null) continue;
  if (el instanceof HTMLInputElement && el.type === 'checkbox') el.checked = v !== '0';
  else el.value = v;
}
/** Mirrors the controls into the URL (without reloading), so a setup can be shared as a link. */
function syncUrl() {
  const u = new URL(location.href);
  for (const [k, el] of Object.entries(ui)) {
    u.searchParams.set(k, el instanceof HTMLInputElement && el.type === 'checkbox' ? (el.checked ? '1' : '0') : el.value);
  }
  history.replaceState(null, '', u);
}

async function main() {
  if (!(await ensureWebGPU())) return;
  const canvas = $<HTMLCanvasElement>('view');
  const picker = mountRuntimePicker($('runtimePicker'));
  const { renderer, denoiser, device } = await createStack({
    renderer: { canvas, antialias: false },
    weightsUrl: import.meta.env.DEV && __LOCAL_ONNX_MODELS__ ? '/models' : undefined,
    quality: ui.quality.value as 'fast' | 'balanced' | 'high',
  }).catch((e) => { picker.failed((e as Error).message); throw e; });
  picker.attach(denoiser);
  device.lost.then((i) => log(`DEVICE LOST: ${i.reason} ${i.message}`));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.setPixelRatio(1);

  // ---- path tracer + the two post passes ------------------------------------------
  const pathTracer = new WebGPUPathTracer(renderer);
  pathTracer.dynamicLowRes = false; // show the real noisy image right away
  pathTracer.renderDelay = 0;
  pathTracer.fadeDuration = 0;
  pathTracer.minSamples = 0;
  const denoisePass = new DenoiserPass(denoiser);
  const upscalePass = new UpscalerPass();
  const pt = pathTracer as N; // the hook types name upstream's OIDNDenoiser / FSRUpscaler
  const samples = sampleCounter(pathTracer);

  let lab: LabScene;
  let controls: OrbitControls | undefined;
  async function loadScene(id: string) {
    const entry = SCENES.find((s) => s.id === id) ?? SCENES[0];
    log(`loading ${entry.label}…`);
    lab = await entry.build();
    const [w, h] = sizeOf();
    lab.camera.aspect = w / h;
    lab.camera.updateProjectionMatrix();
    const t0 = performance.now();
    pathTracer.setScene(lab.scene, lab.camera);
    denoisePass.setScene(lab.scene, lab.camera);
    log(`${entry.label}: BVH built in ${(performance.now() - t0).toFixed(0)} ms`);
    controls?.dispose();
    controls = new OrbitControls(lab.camera, canvas);
    controls.target.copy(lab.target);
    controls.update(); // before the listener: poking the tracer mid-setup wedges it
    controls.addEventListener('change', () => { pathTracer.updateCamera(); restart(); });
    restart();
  }

  const sizeOf = () => ui.size.value.split('x').map(Number) as [number, number];
  function applySize() {
    const [w, h] = sizeOf();
    renderer.setSize(w, h, false);
    canvas.style.aspectRatio = `${w} / ${h}`;
    if (lab) { lab.camera.aspect = w / h; lab.camera.updateProjectionMatrix(); pathTracer.updateCamera(); }
  }
  function applyStages() {
    pathTracer.renderScale = Number(ui.scale.value);
    pathTracer.maxSamples = Math.max(1, parseInt(ui.spp.value, 10) || 1);
    pathTracer.maxBounces = Math.max(1, parseInt(ui.bounces.value, 10) || 1);
    denoisePass.useAux = ui.aux.checked;
    denoiser.quality = ui.quality.value as 'fast' | 'balanced' | 'high';
    pt.setDenoiser(ui.denoise.checked ? denoisePass : null);
    const up = ui.upscale.value as UpscalePath | 'off';
    if (up === 'off') pt.setUpscaler(null);
    else { if (pt._upscaler !== upscalePass) pt.setUpscaler(upscalePass); upscalePass.path = up; }
    upscalePass.sharpness = Number(ui.sharpness.value);
    ui.aux.disabled = ui.quality.disabled = !ui.denoise.checked;
    ui.sharpness.disabled = up !== 'spatial';
  }
  function restart() {
    pathTracer.reset();
    samples.reset();
  }

  // every control restarts the render with the new settings
  for (const el of [ui.size, ui.scale, ui.spp, ui.bounces, ui.denoise, ui.aux, ui.quality, ui.upscale]) {
    el.addEventListener('change', () => { applySize(); applyStages(); restart(); syncUrl(); });
  }
  ui.sharpness.addEventListener('input', () => { applyStages(); syncUrl(); }); // per frame, no restart
  ui.scene.addEventListener('change', () => { syncUrl(); void loadScene(ui.scene.value); });
  for (const el of [ui.compare, ui.split]) el.addEventListener('input', syncUrl);

  // ---- compare overlay: an earlier stage drawn over the left part of the canvas ---------
  // textureLoad (no sampler): the tracer's rgba32float target isn't filterable everywhere.
  // Nearest lookups also show the render-resolution pixels as they really are.
  const placeholder = (type: THREE.TextureDataType) => {
    const t = new THREE.StorageTexture(1, 1);
    t.type = type; // must match what's bound later: rgba32float (tracer) / rgba16float (denoiser)
    renderer.initTexture(t);
    return t;
  };
  const loadAtScreen = (tex: THREE.Texture) => {
    const node = textureLoad(tex, ivec2(0, 0)) as N;
    node.uvNode = ivec2(screenUV.mul(vec2(node.size(0))).floor());
    return node;
  };
  const noisyNode = loadAtScreen(placeholder(THREE.FloatType));
  const denoisedNode = loadAtScreen(placeholder(THREE.HalfFloatType));
  const uSplit = uniform(0.5);
  const uWhich = uniform(0); // 0 noisy, 1 denoised
  const overlay = new THREE.MeshBasicNodeMaterial();
  overlay.colorNode = Fn(() => {
    If(screenUV.x.greaterThan(uSplit), () => { Discard(); });
    return vec4((uWhich.equal(0) as N).select(noisyNode.rgb, denoisedNode.rgb), float(1));
  })();
  const overlayQuad = new THREE.QuadMesh(overlay);

  // ---- loop ------------------------------------------------------------------------
  const stats = $<HTMLDivElement>('stats');
  let frames = 0, fpsT0 = performance.now(), fps = 0;
  denoisePass.onDenoised = (ms) => picker.denoised(ms);

  applySize();
  applyStages();
  await upscalePass.ready.catch(() => undefined);
  await loadScene(ui.scene.value);

  (window as N).__lab = { renderer, denoiser, pathTracer, denoisePass, upscalePass, get lab() { return lab; } };

  const loop = () => {
    pathTracer.renderSample();
    samples.poll();

    const cmp = ui.compare.value;
    const target = pathTracer.target;
    if (cmp !== 'off' && target) {
      uSplit.value = Number(ui.split.value) / 100;
      uWhich.value = cmp === 'noisy' ? 0 : 1;
      noisyNode.value = target;
      if (denoisePass.texture) denoisedNode.value = denoisePass.texture;
      renderer.setRenderTarget(null);
      const ac = renderer.autoClear;
      renderer.autoClear = false;
      overlayQuad.render(renderer);
      renderer.autoClear = ac;
    }

    frames++;
    const now = performance.now();
    if (now - fpsT0 > 500) { fps = frames * 1000 / (now - fpsT0); frames = 0; fpsT0 = now; }
    const [w, h] = sizeOf();
    const rs = Number(ui.scale.value);
    const up = ui.upscale.value;
    stats.innerHTML = [
      ['render', `${Math.floor(w * rs)}×${Math.floor(h * rs)} → ${w}×${h}`],
      ['samples', `${samples.value} / ${pathTracer.maxSamples}`],
      ['denoise', !ui.denoise.checked ? 'off' : denoisePass.running ? 'running…' : denoisePass.complete ? `${denoisePass.lastMs.toFixed(1)} ms` : 'waiting for samples'],
      ['upscale', up === 'off' ? 'off (stretched)' : `${up} · ${upscalePass.gpuMs ? upscalePass.gpuMs.toFixed(2) + ' ms GPU' : '—'}`],
      ['runtime', picker.label()],
      ['frame rate', `${fps.toFixed(0)} fps`],
    ].map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
    requestAnimationFrame(loop);
  };
  loop();
}

demoFooter('pipeline-lab');
main().catch((e) => log('ERROR: ' + (e as Error).message));
