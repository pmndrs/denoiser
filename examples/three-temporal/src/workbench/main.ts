// three-temporal/workbench: SSR + SSGI + reflection probes + FSR3, with every denoiser we have, side by side.
//
// Up to three panes, each a full frame graph (./pane.ts) with its own SSR / SSGI denoisers and resolver, drawn by ONE
// WebGPURenderer into its own canvas (three's CanvasTarget): the device, the scene, the probes and the shadow maps
// are shared, every pane's histories are its own. The canvases are stacked and revealed with CSS clip-paths (drag the
// grips), or shown one at a time (keys 1 / 2 / 3, F to flip) to blink between setups at the same frame.
//
// The scene setup follows our reflection pages (reflections-rooms.ts: probes per room, SSR with the probe where it
// misses, materials lit by the probes), the pipeline the upscaler's examples 09 / 10 (SSGI + SSR composited at the
// render resolution, FSR3 as the only resolver).

import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import GUI from 'three/addons/libs/lil-gui.module.min.js';
import { DebugView } from 'upscaler-src';
import { reflectionProbes } from '../probes/ReflectionProbesNode';
import { AO, DEFAULT_PRESETS, DIFF, PRESETS, RESOLVE, SPEC, TRACER, VIEWS, type View } from './catalog';
import { loadFASTNoise } from './ben/index.js';
import { Pane, defaultPane, type PaneConfig, type Shared } from './pane';
import { availableScenes, loadScene, type WorkbenchScene } from './scenes';

/* eslint-disable @typescript-eslint/no-explicit-any */
type N = any;
const NAMES = ['A', 'B', 'C'] as const;
type Name = (typeof NAMES)[number];

const statusEl = document.getElementById('status')!;
const log = (m: string) => { statusEl.textContent = m; console.log('[workbench]', m); };

// The materials' own environment specular is off: each pane's composite supplies the specular (probes, SSR, the
// denoisers), as on the reflection pages. Their diffuse ambient still comes from the probes.
const _indirectSpecular = THREE.PhysicalLightingModel.prototype.indirectSpecular;
THREE.PhysicalLightingModel.prototype.indirectSpecular = function (this: N, builder: N) {
  builder.context.radiance = builder.context.radiance.mul(0);
  _indirectSpecular.call(this, builder);
};

async function main() {
  if (!navigator.gpu) { log('WebGPU is not available in this browser.'); return; }
  const renderer = new THREE.WebGPURenderer({ antialias: false, trackTimestamp: true } as N);
  await renderer.init();
  renderer.setPixelRatio(1);
  renderer.toneMapping = THREE.NoToneMapping; // each pane's graph tone maps itself
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.shadowMap.enabled = true;
  const device = (renderer.backend as unknown as { device: GPUDevice }).device;
  const gpuErrors: string[] = [];
  device.addEventListener('uncapturederror', (e) => { const m = (e as GPUUncapturedErrorEvent).error.message; gpuErrors.push(m); console.error('[webgpu]', m); });

  // ---- state -----------------------------------------------------------------------------------------------------------
  const ui = {
    scene: 'Space Ship Hallway', count: 3 as 2 | 3, show: 'split' as 'split' | Name, animate: true, liveProbes: true,
    orbit: false, orbitSpeed: 1, cards: true, pixelRatio: 1,
  };
  const shared: Shared = {
    frame: uniform(0, 'uint'), roughCut: uniform(0.5), giIntensity: uniform(1),
    ssr: true, ssgi: true, ao: true, ssgiQuality: { slices: 2, steps: 8, radius: 2 }, view: 'beauty', fastNoise: null,
  };
  // Ben's tracer samples FAST blue noise (his default, 'FAST Separate'); without it, it uses its analytic noise
  shared.fastNoise = await loadFASTNoise('./ben-fast/gauss1-ema01-separate05.png').catch((e: unknown) => { console.warn('[workbench] FAST noise', e); return null; });
  const dividers: Record<2 | 3, number[]> = { 2: [0.5], 3: [1 / 3, 2 / 3] };
  const visible = () => NAMES.slice(0, ui.count);

  // ---- canvases, panes, camera ------------------------------------------------------------------------------------------
  const stage = document.getElementById('stage')!;
  const overlay = document.getElementById('overlay')!;
  const panes = {} as Record<Name, Pane>;
  NAMES.forEach((name, i) => {
    const canvas = document.createElement('canvas');
    canvas.className = 'pane';
    stage.insertBefore(canvas, overlay);
    const p = PRESETS[DEFAULT_PRESETS[i]];
    panes[name] = new Pane(name, canvas, renderer, defaultPane(p));
  });
  const camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.05, 200);
  const controls = new OrbitControls(camera, overlay);
  controls.enableDamping = true;

  function resize() {
    const w = Math.max(1, Math.round(stage.clientWidth * ui.pixelRatio));
    const h = Math.max(1, Math.round(stage.clientHeight * ui.pixelRatio));
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    for (const n of NAMES) panes[n].setSize(w, h);
    layout();
  }
  window.addEventListener('resize', resize);

  // ---- scene --------------------------------------------------------------------------------------------------------------
  let ws: WorkbenchScene | null = null;
  let t = 0;
  function bake() {
    if (!ws) return;
    const hidden = ws.dynamic.filter((o) => o.visible);
    for (const o of hidden) o.visible = false; // moving things stay out of the captures
    ws.probes.bake(renderer, ws.scene, { resolution: 128, ...ws.bake });
    for (const o of hidden) o.visible = true;
  }
  async function setScene(name: string) {
    log(`loading ${name} ...`);
    ui.scene = name;
    // no frames while the next scene loads: the panes' graphs are disposed below, and rendering a disposed graph
    // throws inside pipeline.render(), which leaves the renderer unable to present afterwards
    ws = null;
    for (const n of NAMES) panes[n].dispose();
    const next = await loadScene(name, renderer);
    next.scene.updateMatrixWorld(true);
    ws = next;
    bake();
    ws.scene.environmentNode = reflectionProbes(ws.probes) as N; // the materials' diffuse ambient
    // shadow maps: rendered once per frame for all panes (below), not once per pane
    for (const l of ws.lights) if (l.shadow) l.shadow.autoUpdate = false;
    camera.near = ws.size * 0.005;
    camera.far = ws.size * 40;
    camera.fov = ws.fov ?? 55;
    camera.updateProjectionMatrix();
    shared.ssgi = ws.defaults?.ssgi ?? true;
    shared.roughCut.value = ws.defaults?.roughCut ?? 0.5;
    sceneMaterials(ws);
    camera.position.copy(ws.view.position);
    controls.target.copy(ws.view.target);
    controls.update();
    shared.ssgiQuality.radius = +(ws.size * 0.25).toFixed(2);
    rebuildAll();
    refreshGUI();
    log(`${name}: ${ws.probes.children.length} probes`);
  }
  function rebuildAll() { for (const n of NAMES) rebuild(n); }
  function rebuild(n: Name) { if (ws) panes[n].build(ws, shared); renderCards(); }

  // ---- loop ------------------------------------------------------------------------------------------------------------------
  let last = performance.now();
  let frames = 0;
  function frame() {
    requestAnimationFrame(frame);
    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!ws) return;
    if (ui.animate) t += dt;
    const changed = ws.animate(t);
    ws.scene.updateMatrixWorld();
    if (changed && ui.liveProbes) bake();
    for (const l of ws.lights) if (l.shadow) l.shadow.needsUpdate = true;
    controls.autoRotate = ui.orbit;
    controls.autoRotateSpeed = ui.orbitSpeed;
    controls.update(dt);
    camera.updateMatrixWorld();
    shared.frame.value++;
    for (const n of active()) panes[n].render(camera);
    if (++frames % 30 === 0) renderTimings();
  }
  const active = (): Name[] => (ui.show === 'split' ? visible() : [ui.show]);

  // ---- layout: clip-path reveal, grips, tags, cards --------------------------------------------------------------------------
  const grips = [0, 1].map((i) => {
    const el = document.createElement('div');
    el.className = 'divider';
    el.innerHTML = `<div class="grip">${i ? 'B|C' : 'A|B'}</div>`;
    stage.appendChild(el);
    const grip = el.querySelector('.grip') as HTMLElement;
    grip.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      grip.setPointerCapture(e.pointerId);
      const move = (ev: PointerEvent) => {
        const d = dividers[ui.count];
        const r = stage.getBoundingClientRect();
        d[i] = Math.min((d[i + 1] ?? 1) - 0.02, Math.max((d[i - 1] ?? 0) + 0.02, (ev.clientX - r.left) / r.width));
        layout();
      };
      const up = () => { grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up); };
      grip.addEventListener('pointermove', move);
      grip.addEventListener('pointerup', up);
    });
    return el;
  });
  const tags = {} as Record<Name, HTMLElement>;
  const cards = {} as Record<Name, HTMLElement>;
  const collapsed: Record<Name, boolean> = { A: false, B: false, C: false };
  for (const n of NAMES) {
    tags[n] = Object.assign(document.createElement('div'), { className: 'tag' });
    cards[n] = Object.assign(document.createElement('div'), { className: 'card' });
    stage.append(tags[n], cards[n]);
  }
  const region = (n: Name) => {
    if (ui.show !== 'split') return ui.show === n ? [0, 1] : null;
    const i = visible().indexOf(n);
    if (i < 0) return null;
    const d = dividers[ui.count];
    return [d[i - 1] ?? 0, d[i] ?? 1];
  };
  function layout() {
    for (const n of NAMES) {
      const r = region(n);
      const c = panes[n].canvas;
      c.style.visibility = r ? '' : 'hidden';
      if (r) c.style.clipPath = `inset(0 ${(1 - r[1]) * 100}% 0 ${r[0] * 100}%)`;
      tags[n].style.display = r ? '' : 'none';
      cards[n].style.display = r && ui.cards ? '' : 'none';
      if (r) {
        tags[n].style.left = `${((r[0] + r[1]) / 2) * 100}%`;
        cards[n].style.left = `calc(${r[0] * 100}% + 8px)`;
        cards[n].style.width = `min(330px, calc(${(r[1] - r[0]) * 100}% - 16px))`;
      }
    }
    const d = dividers[ui.count];
    grips.forEach((g, i) => {
      g.style.display = ui.show === 'split' && i < d.length ? '' : 'none';
      if (i < d.length) g.style.left = `${d[i] * 100}%`;
    });
  }
  const esc = (s: string) => s.replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[ch]!);
  function renderCards() {
    for (const n of NAMES) {
      const c = panes[n].cfg;
      const combined = c.spec.startsWith('combined');
      const res = c.resolve === 'fsr' ? `FSR3 ${c.ratio === 1 ? 'native' : `${c.ratio}×`}${c.jitter ? '' : ', no jitter'}` : c.resolve === 'traa' ? 'Ben TRAA' : 'no resolver';
      tags[n].textContent = `${n} · ${c.tracer === 'ben' ? 'Ben SSR → ' : ''}${SPEC[c.spec].label}${combined ? '' : ` · GI: ${shared.ssgi ? DIFF[c.diff].label : 'off'}`} · AO: ${c.aoDenoise} · ${res}`;
      const block = (title: string, b: { label: string; text: string; watch?: string }) =>
        `<h4>${esc(title)}: ${esc(b.label)}</h4><div>${esc(b.text)}</div>${b.watch ? `<div class="watch">${esc(b.watch)}</div>` : ''}`;
      cards[n].classList.toggle('collapsed', collapsed[n]);
      cards[n].innerHTML = `<button data-act="hide">${collapsed[n] ? 'show' : 'hide'}</button><span class="ms" data-ms></span><div class="body">${block('Tracer', TRACER[c.tracer])}${block('SSR', SPEC[c.spec])}${combined ? '' : shared.ssgi ? block('SSGI', DIFF[c.diff]) : block('SSGI', { label: 'off', text: 'SSGI (and its AO) is off in this scene; turn it on under Scene.' })}${block('Resolver', RESOLVE[c.resolve])}`
        + (c.resolve === 'fsr' ? `<div class="watch">render ${Math.round(100 / c.ratio)} % · denoisers ${c.jitterAware ? 'see' : 'do not see'} the jitter · SSGI pattern ${c.ssgiRotate ? 'rotating' : 'static'}</div>` : '') + '</div>';
      cards[n].querySelector('[data-act=hide]')!.addEventListener('click', () => { collapsed[n] = !collapsed[n]; renderCards(); });
    }
    renderTimings();
    layout();
  }
  function renderTimings() {
    for (const n of NAMES) {
      const el = cards[n].querySelector('[data-ms]');
      const ms = panes[n].oursMs();
      if (el) el.textContent = ms == null ? 'our denoisers: none' : `our denoisers: ${ms.toFixed(2)} ms GPU`;
    }
  }

  // ---- keys ------------------------------------------------------------------------------------------------------------------
  window.addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement)?.closest?.('input, select, textarea')) return;
    const k = e.key.toLowerCase();
    const v = visible();
    if (k === 's') ui.show = 'split';
    else if (k === 'f') ui.show = v[(v.indexOf(ui.show as Name) + 1) % v.length];
    else if (['1', '2', '3'].includes(k) && +k <= v.length) ui.show = v[+k - 1];
    else if (k === 'o') ui.orbit = !ui.orbit;
    else if (k === 'i') ui.cards = !ui.cards;
    else if (k === '0') resetAll();
    else return;
    refreshGUI();
    layout();
  });
  const resetAll = () => { for (const n of NAMES) panes[n].resetHistory(); };

  // ---- GUI ---------------------------------------------------------------------------------------------------------------------
  const gui: N = new GUI({ title: 'Denoiser workbench' });
  const refreshGUI = () => gui.controllersRecursive().forEach((c: N) => c.updateDisplay());
  const inv = (o: Record<string, { label: string } | string>) =>
    Object.fromEntries(Object.entries(o).map(([k, v]) => [typeof v === 'string' ? v : v.label, k]));

  const scenes = await availableScenes();
  const g = gui.addFolder('Scene');
  g.add(ui, 'scene', scenes).name('scene').onChange((v: string) => void setScene(v));
  g.add(ui, 'animate').name('animate (lights, ball)');
  g.add(ui, 'liveProbes').name('re-bake probes when lit changes');
  g.add({ bake }, 'bake').name('re-bake probes now');
  g.add(shared.roughCut, 'value', 0, 1, 0.01).name('SSR roughness cutoff');
  g.add(shared, 'ssr').name('SSR').onChange(rebuildAll);
  g.add(shared, 'ssgi').name('SSGI').onChange(rebuildAll);
  g.add(shared, 'ao').name('SSGI AO').onChange(rebuildAll);
  g.add(shared.giIntensity, 'value', 0, 4, 0.05).name('GI intensity');
  g.add(shared.ssgiQuality, 'slices', 1, 4, 1).name('SSGI slices').onFinishChange(rebuildAll);
  g.add(shared.ssgiQuality, 'steps', 4, 16, 1).name('SSGI steps').onFinishChange(rebuildAll);
  g.add(shared.ssgiQuality, 'radius', 0.1, 20, 0.05).name('SSGI radius').onFinishChange(rebuildAll);

  // the scene's own roughness sliders (Ben's example: model and floor, both 0 in his demo)
  let matFolder: N = null;
  function sceneMaterials(s: WorkbenchScene) {
    matFolder?.destroy();
    matFolder = null;
    if (!s.roughness) return;
    matFolder = g.addFolder('Scene materials');
    for (const [label, mats] of Object.entries(s.roughness)) {
      const o = { v: mats[0]?.roughness ?? 0 };
      matFolder.add(o, 'v', 0, 1, 0.01).name(label).onChange((v: number) => { for (const m of mats) m.roughness = v; });
    }
  }

  const cmp = gui.addFolder('Compare');
  cmp.add(ui, 'count', { 'Two panes': 2, 'Three panes': 3 }).name('panes').onChange((v: string | number) => {
    ui.count = +v as 2 | 3;
    if (ui.show !== 'split' && !visible().includes(ui.show)) ui.show = 'split';
    panes.C.resetHistory(); // it did not render while hidden
    layout();
  });
  cmp.add(ui, 'show', { 'Side by side (drag the grips)': 'split', 'A only (1)': 'A', 'B only (2)': 'B', 'C only (3)': 'C' }).name('show').onChange(layout);
  cmp.add(shared, 'view', inv(VIEWS)).name('view').onChange(rebuildAll);
  cmp.add(ui, 'orbit').name('auto orbit (O)');
  cmp.add(ui, 'orbitSpeed', 0.1, 6, 0.1).name('orbit speed');
  cmp.add(ui, 'cards').name('explainer cards (I)').onChange(layout);
  cmp.add(ui, 'pixelRatio', { '1 (CSS pixels)': 1, 'device': window.devicePixelRatio }).name('canvas resolution').onChange((v: string | number) => { ui.pixelRatio = +v; resize(); });
  cmp.add({ resetAll }, 'resetAll').name('reset all histories (0)');

  for (const n of NAMES) {
    const f = gui.addFolder(`Pane ${n}`).close();
    const c = () => panes[n].cfg;
    const live = new Proxy({}, { get: (_t, k) => (c() as N)[k], set: (_t, k, v) => { (c() as N)[k] = v; return true; } }) as PaneConfig;
    const changed = () => rebuild(n);
    const preset = { preset: DEFAULT_PRESETS[NAMES.indexOf(n)] };
    f.add(preset, 'preset', Object.keys(PRESETS)).name('preset').onChange((k: string) => {
      Object.assign(panes[n].cfg, { tracer: 'three', aoDenoise: 'svgf' }, PRESETS[k]);
      refreshGUI();
      changed();
    });
    f.add(live, 'tracer', inv(TRACER)).name('SSR tracer').onChange(changed);
    f.add(live, 'spec', inv(SPEC)).name('SSR denoiser').onChange(changed);
    f.add(live, 'diff', inv(DIFF)).name('SSGI denoiser').onChange(changed);
    f.add(live, 'aoDenoise', inv(AO)).name('SSGI AO denoiser').onChange(changed);
    f.add(live, 'resolve', inv(RESOLVE)).name('resolver').onChange(changed);
    f.add(live, 'ratio', { 'native (1×)': 1, '1.5× (67 %)': 1.5, '2× (50 %)': 2 }).name('FSR3 render ratio').onChange((v: string | number) => { panes[n].cfg.ratio = +v; changed(); });
    f.add(live, 'jitter').name('FSR3 jitter').onChange(changed);
    f.add(live, 'jitterAware').name('denoisers see the jitter').onChange(changed);
    f.add(live, 'ssgiRotate').name('SSGI rotating pattern').onChange(changed);
    f.add(live, 'rcasDenoise').name('RCAS denoise');
    f.add(live, 'fsrDebug', {
      Off: DebugView.None, 'Motion vectors': DebugView.MotionVectors, Disocclusion: DebugView.Disocclusion,
      'Accumulation age': DebugView.AccumulationAge, Locks: DebugView.Locks, 'Shading change': DebugView.ShadingChange,
    }).name('FSR3 debug view');
    const missCtl = f.add(live, 'missZero').name('SSR misses pass hit distance 0').onChange(changed);
    // the guard tells a miss from a hit by hit distance 0, so ticking it ticks that too
    f.add(live, 'dropoutGuard').name('recurrent: SSR dropout guard').onChange((v: boolean) => { if (v && !live.missZero) { live.missZero = true; missCtl.updateDisplay(); } changed(); });
    f.add(live, 'benTraversal', { 'Hi-Z adaptive (his default)': 'adaptive', 'Hi-Z conservative': 'conservative', 'linear march': 'linear' }).name('Ben tracer traversal');
    const cov = f.addFolder('Ben CoverageDenoiseNode').close();
    cov.add(live, 'covRadius', 0, 3, 0.05).name('SSR radius (texels)');
    cov.add(live, 'covGiRadius', 0, 3, 0.05).name('SSGI / AO radius');
    cov.add(live, 'covMaxFrames', 1, 128, 1).name('max frames');
    f.add({ reset: () => panes[n].resetHistory() }, 'reset').name('reset histories');
  }

  // for scripts and the console (smoke tests); the UI is the way to use the bench
  (window as N).__wb = {
    ui, shared, panes, dividers, gpuErrors, layout, rebuild, rebuildAll, setScene, resetAll,
    set(n: Name, o: Partial<PaneConfig>) { Object.assign(panes[n].cfg, o); refreshGUI(); rebuild(n); },
    get ready() { return !!ws; },
    get ws() { return ws; },
  };

  resize();
  await setScene(ui.scene);
  requestAnimationFrame(frame);
}

main().catch((e) => { log(`ERROR: ${(e as Error).stack ?? e}`); console.error(e); });
