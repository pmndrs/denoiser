// Interior lab page: two or three panes side by side, each a full copy of Ben Houston's interior example with its own
// denoisers and resolver (./pane.ts, in an iframe). The panes are stacked and revealed with CSS clip-paths, so nothing
// one pane renders (its SSR lighting feedback, its TRAA / FSR3 history) reaches another.
//
// One loop drives them all: the leading pane (the one last touched) runs its OrbitControls and renders, the others take
// its camera and render the same frame. The controls live here (lil-gui); a pane's own Inspector (Ben's settings, the
// render graph's textures, timings) shows when the pane is inspected.
import { DebugView } from '@pmndrs/upscaler';
import GUI from 'three/addons/libs/lil-gui.module.min.js';
import {
  CONTRACT_CARDS, CONTRACT_LABELS, DEFAULT_PANES, DIFF_CARDS, DIFF_LABELS, LESSONS, OURS, PRESETS, RESOLVE_CARDS,
  RESOLVE_LABELS, SPEC_CARDS, SPEC_LABELS, VIEW_LABELS, type Card, type Lesson, type PaneName, type View,
} from './catalog';
import { paneConfig, type PaneApi, type PaneConfig, type Pose } from './pane';

/* eslint-disable @typescript-eslint/no-explicit-any */
const NAMES: PaneName[] = ['A', 'B', 'C'];

const cfg: Record<PaneName, PaneConfig> = {
  A: paneConfig(PRESETS[DEFAULT_PANES.A].setup),
  B: paneConfig(PRESETS[DEFAULT_PANES.B].setup),
  C: paneConfig(PRESETS[DEFAULT_PANES.C].setup),
};
const ui = {
  count: 3 as 2 | 3,
  show: 'split' as 'split' | PaneName,
  inspect: 'none' as 'none' | PaneName,
  view: 'beauty' as View,
  model: 'Space Ship Hallway',
  orbit: false,
  orbitSpeed: 1.5,
  link: true,
  cards: true,
};
/** Divider positions (fractions of the width) for two and for three panes. */
const dividers: Record<2 | 3, number[]> = { 2: [0.5], 3: [1 / 3, 2 / 3] };

const panes: Partial<Record<PaneName, PaneApi>> = {};
let leader: PaneName = 'A';
const visible = () => NAMES.slice(0, ui.count);

// ---- the host the panes talk to (window.__labHost, read by pane.ts) ------------------------------------------------
(window as any).__labHost = {
  register(api: PaneApi) {
    const first = !Object.keys(panes).length;
    panes[api.name] = api;
    api.apply(cfg[api.name]);
    api.setView(ui.view);
    const lead = panes[leader];
    if (lead && !first && lead !== api) api.setPose(lead.getPose());
    if (first) { leader = api.name; buildModelControl(api.models()); }
    if (api.model() !== ui.model) api.loadModel(ui.model);
    api.setOrbit(api.name === leader && ui.orbit, ui.orbitSpeed);
    api.inspect(ui.inspect === api.name);
    layout();
    loadNext();
  },
  leads: (name: PaneName) => name === leader,
  lead(name: PaneName) {
    if (name === leader) return;
    panes[leader]?.setOrbit(false, ui.orbitSpeed);
    leader = name;
    panes[leader]?.setOrbit(ui.orbit, ui.orbitSpeed);
  },
  key: (e: KeyboardEvent) => onKey(e.key),
  param(from: PaneName, path: string, value: unknown) {
    if (!ui.link) return;
    for (const n of NAMES) if (n !== from) panes[n]?.applyParam(path, value);
    if (path.endsWith('/model')) { ui.model = value as string; gui.controllersRecursive().forEach((c: any) => c.updateDisplay()); }
  },
};

// ---- panes: iframes, created one after the other (each loads and bakes the scene) -------------------------------------
const stage = document.getElementById('stage')!;
const frames: Partial<Record<PaneName, HTMLIFrameElement>> = {};
function loadNext() {
  const next = visible().find((n) => !frames[n]);
  if (!next) return;
  const f = document.createElement('iframe');
  f.name = next; // the pane reads its name from window.name
  f.className = 'pane';
  f.src = './interior-pane.html';
  stage.appendChild(f);
  frames[next] = f;
  layout();
}

function layout() {
  const v = visible();
  const d = dividers[ui.count];
  const solo = ui.inspect !== 'none' ? ui.inspect : ui.show !== 'split' ? ui.show : null;
  for (const n of NAMES) {
    const f = frames[n];
    if (!f) continue;
    const i = v.indexOf(n);
    const on = solo ? n === solo : i >= 0;
    f.style.visibility = on ? '' : 'hidden';
    f.style.zIndex = solo === n ? '2' : '1';
    const left = solo ? 0 : d[i - 1] ?? 0;
    const right = solo ? 1 : d[i] ?? 1;
    f.style.clipPath = `inset(0 ${(1 - right) * 100}% 0 ${left * 100}%)`;
    panes[n]?.inspect(ui.inspect === n);
  }
  // the inspected pane's Inspector takes the right edge: the lab panel moves left
  gui.domElement.classList.toggle('left', ui.inspect !== 'none');
  gripEls.forEach((g, i) => {
    g.style.display = !solo && i < d.length ? '' : 'none';
    if (i < d.length) g.style.left = `${d[i] * 100}%`;
  });
  renderCards();
}

// ---- one loop for every pane -----------------------------------------------------------------------------------------
let frame = 0;
function tick() {
  requestAnimationFrame(tick);
  const active = visible().filter((n) => panes[n]);
  if (!active.length) return;
  if (!active.includes(leader)) (window as any).__labHost.lead(active[0]);
  const lead = panes[leader]!;
  lead.step();
  const pose: Pose = lead.getPose();
  for (const n of active) {
    if (n === leader) continue;
    panes[n]!.setPose(pose);
    panes[n]!.step();
  }
  if (++frame % 30 === 0) renderTimings();
}
requestAnimationFrame(tick);

// ---- dividers ----------------------------------------------------------------------------------------------------------
const gripEls = [0, 1].map((i) => {
  const el = document.createElement('div');
  el.className = 'divider';
  el.innerHTML = `<div class="grip">${i === 0 ? 'A|B' : 'B|C'}</div>`;
  document.body.appendChild(el);
  const grip = el.querySelector('.grip') as HTMLElement;
  grip.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    grip.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const d = dividers[ui.count];
      const lo = (d[i - 1] ?? 0) + 0.02, hi = (d[i + 1] ?? 1) - 0.02;
      d[i] = Math.min(hi, Math.max(lo, ev.clientX / window.innerWidth));
      layout();
    };
    const up = () => { grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up); };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
  });
  return el;
});

// ---- keys (also forwarded from the panes) ------------------------------------------------------------------------------
function onKey(key: string) {
  const k = key.toLowerCase();
  const v = visible();
  if (k === 's') { ui.show = 'split'; ui.inspect = 'none'; }
  else if (k === 'f') ui.show = v[(v.indexOf(ui.show as PaneName) + 1) % v.length];
  else if (['1', '2', '3'].includes(k) && +k <= v.length) ui.show = v[+k - 1];
  else if (k === 'i') ui.inspect = ui.inspect !== 'none' ? 'none' : ui.show !== 'split' ? ui.show : leader;
  else if (k === 'o') { ui.orbit = !ui.orbit; panes[leader]?.setOrbit(ui.orbit, ui.orbitSpeed); }
  else if (k === '0') { resetAll(); return; }
  else return;
  refreshGUI();
  layout();
}
window.addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement)?.closest?.('input, select, textarea')) return;
  onKey(e.key);
});

const resetAll = () => { for (const n of NAMES) panes[n]?.reset(); };

// ---- cards, tags, lesson banner ----------------------------------------------------------------------------------------
const cards: Record<PaneName, HTMLElement> = {} as any;
const tags: Record<PaneName, HTMLElement> = {} as any;
const collapsed: Record<PaneName, boolean> = { A: false, B: false, C: false };
for (const n of NAMES) {
  cards[n] = Object.assign(document.createElement('div'), { className: 'card' });
  tags[n] = Object.assign(document.createElement('div'), { className: 'tag' });
  document.body.append(cards[n], tags[n]);
}
const esc = (s: string) => s.replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[ch]!);
const list = (items: string[], cls = '') => `<ul class="${cls}">${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`;
const cardHTML = (c: Card) => `
  <div class="origin">${esc(c.origin)}</div>
  <h4>Per frame</h4><ol>${c.passes.map((p) => `<li>${esc(p)}</li>`).join('')}</ol>
  <h4>Contract</h4><div>${esc(c.contract)}</div>
  <h4>Strengths</h4>${list(c.pros, 'pro')}
  <h4>Weaknesses</h4>${list(c.cons, 'con')}
  ${c.knobs ? `<h4>Knobs</h4><div>${esc(c.knobs)}</div>` : ''}`;

function renderCards() {
  const v = visible();
  const d = dividers[ui.count];
  const solo = ui.inspect !== 'none' ? ui.inspect : ui.show !== 'split' ? ui.show : null;
  const showDiff = ['ssgi', 'input-ssgi'].includes(ui.view);
  for (const n of NAMES) {
    const i = v.indexOf(n);
    const on = solo ? n === solo : i >= 0;
    const left = solo ? 0 : d[i - 1] ?? 0;
    const right = solo ? 1 : d[i] ?? 1;
    const c = cfg[n];
    const tag = tags[n];
    tag.style.display = on ? '' : 'none';
    tag.style.left = `${((left + right) / 2) * 100}%`;
    tag.textContent = `${n} · ${showDiff ? DIFF_LABELS[c.diff] : SPEC_LABELS[c.spec]} → ${RESOLVE_LABELS[c.resolve]}`;
    const el = cards[n];
    // inspecting: the pane's Inspector takes the bottom of the screen
    el.style.display = on && ui.cards && ui.inspect === 'none' ? '' : 'none';
    el.style.left = `calc(${left * 100}% + 8px)`;
    el.style.width = `min(340px, calc(${(right - left) * 100}% - 16px))`;
    el.classList.toggle('collapsed', collapsed[n]);
    const main = showDiff ? DIFF_CARDS[c.diff] : SPEC_CARDS[c.spec];
    const contract = !showDiff && OURS.includes(c.spec) ? CONTRACT_CARDS[c.contract] : null;
    const resolve = RESOLVE_CARDS[c.resolve];
    el.innerHTML = `
      <button data-act="hide">${collapsed[n] ? 'show' : 'hide'}</button>
      <h3>${n}: ${esc(showDiff ? `SSGI · ${main.label}` : main.label)}</h3><span class="ms" data-ms></span>
      <div class="body">
        ${cardHTML(main)}
        ${contract ? `<h4>Input contract: ${esc(contract.label)}</h4><div>${esc(contract.text)}</div>${list(contract.pros, 'pro')}${list(contract.cons, 'con')}` : ''}
        <h4>Resolver: ${esc(resolve.label)}</h4><div class="origin">${esc(resolve.origin)}</div>
        <ol>${resolve.passes.map((p) => `<li>${esc(p)}</li>`).join('')}</ol>${list(resolve.pros, 'pro')}${list(resolve.cons, 'con')}
        <h4>${showDiff ? 'SSR' : 'SSGI'} in this pane</h4><div>${esc(showDiff ? SPEC_LABELS[c.spec] : DIFF_LABELS[c.diff])}</div>
      </div>`;
    el.querySelector('[data-act=hide]')!.addEventListener('click', () => { collapsed[n] = !collapsed[n]; renderCards(); });
  }
  renderTimings();
}

function renderTimings() {
  for (const n of NAMES) {
    const el = cards[n].querySelector('[data-ms]');
    if (!el) continue;
    const ms = panes[n]?.oursMs();
    el.textContent = panes[n] ? (ms == null ? 'our passes: none' : `our passes: ${ms.toFixed(2)} ms GPU`) + ' · the rest: Inspect ▸ Performance' : 'loading…';
  }
}

const lessonEl = document.getElementById('lesson')!;
function showLesson(l: Lesson) {
  lessonEl.innerHTML = `<button title="close">×</button><h3>${esc(l.title)}</h3><ol>${l.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>`;
  lessonEl.style.display = '';
  lessonEl.querySelector('button')!.addEventListener('click', () => { lessonEl.style.display = 'none'; });
}

// ---- changes -------------------------------------------------------------------------------------------------------------
function applyPane(n: PaneName) {
  panes[n]?.apply(cfg[n]);
  renderCards();
}

function setCount(count: 2 | 3) {
  const added = count > ui.count;
  ui.count = count;
  if (ui.show !== 'split' && !visible().includes(ui.show)) ui.show = 'split';
  if (ui.inspect !== 'none' && !visible().includes(ui.inspect)) ui.inspect = 'none';
  // a pane that was hidden did not render: its histories are stale
  if (added) { panes.C?.setPose(panes[leader]!.getPose()); panes.C?.reset(); }
  loadNext();
  layout();
}

function loadLesson(l: Lesson) {
  l.panes.forEach((setup, i) => { cfg[NAMES[i]] = paneConfig(setup); });
  ui.view = l.view;
  ui.show = 'split';
  ui.inspect = 'none';
  ui.orbit = !!l.orbit;
  setCount(l.panes.length as 2 | 3);
  if (l.model) setModel(l.model);
  for (const n of NAMES) {
    panes[n]?.apply(cfg[n]);
    panes[n]?.setView(ui.view);
  }
  panes[leader]?.setOrbit(ui.orbit, ui.orbitSpeed);
  refreshGUI();
  layout();
  showLesson(l);
}

function setModel(name: string) {
  ui.model = name;
  for (const n of NAMES) panes[n]?.loadModel(name);
}

// ---- GUI -----------------------------------------------------------------------------------------------------------------
const gui = new GUI({ title: 'Denoiser Lab' });
const refreshGUI = () => { gui.controllersRecursive().forEach((c: any) => c.updateDisplay()); };
const invert = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [v, k]));

const compare = gui.addFolder('Compare');
compare.add(ui, 'count', { 'Two panes (A | B)': 2, 'Three panes (A | B | C)': 3 }).name('panes').onChange((v: string | number) => setCount(+v as 2 | 3));
compare.add(ui, 'show', { 'Side by side (drag the grips)': 'split', 'A only': 'A', 'B only': 'B', 'C only': 'C' }).name('show').onChange(layout);
compare.add(ui, 'inspect', { None: 'none', A: 'A', B: 'B', C: 'C' }).name('inspect (Inspector)').onChange(layout);
compare.add(ui, 'view', invert(VIEW_LABELS as Record<string, string>)).name('view').onChange((v: View) => {
  for (const n of NAMES) panes[n]?.setView(v);
  renderCards();
});
let modelCtl: any = null;
function buildModelControl(models: string[]) {
  modelCtl ??= compare.add(ui, 'model', models).name('model').onChange(setModel);
}
compare.add(ui, 'orbit').name('auto orbit (O)').onChange((v: boolean) => panes[leader]?.setOrbit(v, ui.orbitSpeed));
compare.add(ui, 'orbitSpeed', 0.2, 6, 0.1).name('orbit speed').onChange(() => panes[leader]?.setOrbit(ui.orbit, ui.orbitSpeed));
compare.add(ui, 'link').name('link Ben\'s settings');
compare.add(ui, 'cards').name('explainer cards').onChange(renderCards);
compare.add({ reset: resetAll }, 'reset').name('reset all histories (0)');
compare.add({
  swap() {
    [cfg.A, cfg.B] = [cfg.B, cfg.A];
    applyPane('A');
    applyPane('B');
    refreshGUI();
  },
}, 'swap').name('swap A ⇄ B setups');

const lessons = gui.addFolder('Experiments').close();
for (const l of LESSONS) lessons.add({ go: () => loadLesson(l) }, 'go').name(l.title);

for (const n of NAMES) {
  const f = gui.addFolder(`Pane ${n}`).close();
  // the controllers bind to the config object, which lessons and swap replace: bind through a proxy that follows cfg[n]
  const live = (sub?: keyof PaneConfig) => new Proxy({}, {
    get: (_t, k) => (sub ? (cfg[n][sub] as any) : cfg[n])[k],
    set: (_t, k, v) => { (sub ? (cfg[n][sub] as any) : cfg[n])[k] = v; return true; },
  });
  const changed = () => applyPane(n);
  const preset = { preset: '' };
  const presetNames = Object.fromEntries(Object.entries(PRESETS).map(([k, p]) => [p.label, k]));
  f.add(preset, 'preset', presetNames).name('preset').onChange((k: string) => {
    Object.assign(cfg[n], PRESETS[k].setup);
    refreshGUI();
    changed();
  });
  f.add(live(), 'spec', invert(SPEC_LABELS)).name('SSR denoiser').onChange(changed);
  f.add(live(), 'contract', invert(CONTRACT_LABELS)).name('input contract (ours)').onChange(changed);
  f.add(live(), 'diff', invert(DIFF_LABELS)).name('SSGI denoiser').onChange(changed);
  f.add(live(), 'resolve', invert(RESOLVE_LABELS)).name('resolver').onChange(changed);

  const knob = (folder: any, sub: keyof PaneConfig, key: string, ...rest: any[]) =>
    folder.add(live(sub), key, ...rest).onFinishChange(changed);
  const ffx = f.addFolder('FFX Reflections').close();
  knob(ffx, 'ffx', 'temporalStabilityFactor', 0, 1, 0.01);
  knob(ffx, 'ffx', 'currentFrameStatistics');
  const svgf = f.addFolder('SVGF').close();
  knob(svgf, 'svgf', 'atrousIterations', 1, 6, 1);
  knob(svgf, 'svgf', 'temporalAlpha', 0.02, 0.5, 0.01);
  knob(svgf, 'svgf', 'antiLag', ['auto', 'off']);
  knob(svgf, 'svgf', 'feedback');
  const rec = f.addFolder('Recurrent').close();
  knob(rec, 'recurrent', 'virtualMotion');
  knob(rec, 'recurrent', 'maxAccumulatedFrames', 4, 64, 1);
  knob(rec, 'recurrent', 'fastFrames', 1, 16, 1);
  knob(rec, 'recurrent', 'blurRadius', 0, 90, 1).name('blurRadius (0 = auto)');
  const cov = f.addFolder('Coverage (Ben)').close();
  knob(cov, 'coverage', 'radius', 0, 3, 0.05);
  knob(cov, 'coverage', 'maxFrames', 1, 64, 1);
  knob(cov, 'coverage', 'depthThreshold', 0.001, 0.1, 0.001);
  knob(cov, 'coverage', 'gatherConfidence');
  const sp = f.addFolder('Spatial (DenoiseNode)').close();
  knob(sp, 'spatial', 'radius', 1, 20, 0.5);
  knob(sp, 'spatial', 'lumaPhi', 0.1, 20, 0.1);
  knob(sp, 'spatial', 'depthPhi', 0.1, 20, 0.1);
  knob(sp, 'spatial', 'normalPhi', 0.1, 20, 0.1);
  const fsr = f.addFolder('FSR3').close();
  knob(fsr, 'fsr', 'rcasDenoise');
  knob(fsr, 'fsr', 'debugView', {
    Off: DebugView.None, 'Motion vectors': DebugView.MotionVectors, Disocclusion: DebugView.Disocclusion, Depth: DebugView.Depth,
    'Accumulation age': DebugView.AccumulationAge, Locks: DebugView.Locks, Exposure: DebugView.Exposure, 'Shading change': DebugView.ShadingChange,
  });
  f.add({ reset() { cfg[n] = paneConfig({ spec: cfg[n].spec, contract: cfg[n].contract, diff: cfg[n].diff, resolve: cfg[n].resolve }); refreshGUI(); changed(); } }, 'reset').name('knobs back to defaults');
}

// for scripts and the console (smoke tests); the UI is the way to use the bench
(window as any).__lab = {
  cfg, ui, panes, dividers, lessons: LESSONS, loadLesson, setCount, layout, applyPane, setModel,
  get leader() { return leader; },
  set(n: PaneName, setup: Partial<PaneConfig>) { Object.assign(cfg[n], setup); refreshGUI(); applyPane(n); },
  view(v: View) { ui.view = v; for (const n of NAMES) panes[n]?.setView(v); refreshGUI(); renderCards(); },
};

loadNext();
layout();
