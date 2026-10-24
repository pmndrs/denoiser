// denoiser vs oidn-web: one path-traced frame, two denoisers, a split view and a benchmark.
//
//   three-gpu-pathtracer (N samples, canvas resolution)
//     → frozen into a texture + one rasterized albedo/normal G-buffer
//     → left contender, then right contender (never at the same time), each timed
//     → split view (or |left − right|), ACES + sRGB like the tracer's own present pass
//
// The contenders are in contenders.ts: our `denoiser` (on the ?runtime= the page was created
// with), oidn-web 0.5 (WGSL, whole-image WGSL, WebNN) and oidn-web 0.3.5 (TensorFlow.js), all
// on the same GPUDevice, the same OIDN weights and the same precision (?precision=fp16|fp32).
//
// URL params: ?runtime=, ?precision= (both reload) and every control's id, e.g.
// ?scene=room&size=1280x720&spp=16&left=oidn-tfjs&right=ours.
import * as THREE from 'three/webgpu';
import { Fn, abs, acesFilmicToneMapping, float, ivec2, screenUV, textureLoad, uniform, vec2, vec4 } from 'three/tsl';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { WebGPUPathTracer } from 'three-gpu-pathtracer/webgpu';
import { DEFAULT_TZA_URL } from 'denoiser';
import { createStack, mountRuntimePicker } from '../../_shared/stack';
import { accumulateTo, sampleCounter } from '../../_shared/pathtracer';
import { ensureWebGPU, demoFooter } from '../../_shared/chrome';
import { mountShell } from '../../_shared/shell';
import { SCENES, type LabScene } from '../../pipeline-lab/src/scenes';
import {
  GBuffer, OidnWebContender, OursContender, modelFor, oidnWebVariants,
  type Contender, type Inputs, type Quality, type RunResult,
} from './contenders';
import { renderMeasured } from './measured';
import { createBench, displayReader, psnr, snapshot, toMarkdown, ROW_COLUMNS, type BenchRow } from './bench';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;

mountShell({ id: 'oidn-web-compare', panel: 'aside' });
// before WebGPU starts: the numbers are worth showing even where the demo can't run
renderMeasured(document.getElementById('measured')!, document.getElementById('measuredNote')!);

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const statusEl = $<HTMLPreElement>('status');
const log = (m: string) => { statusEl.textContent = m; console.log(m); };

const params = new URLSearchParams(location.search);
const precision = params.get('precision') === 'fp32' ? 'fp32' : 'fp16';

// ---- controls, seeded from the URL ------------------------------------------------
const ui = {
  scene: $<HTMLSelectElement>('scene'),
  size: $<HTMLSelectElement>('size'),
  spp: $<HTMLInputElement>('spp'),
  bounces: $<HTMLInputElement>('bounces'),
  quality: $<HTMLSelectElement>('quality'),
  aux: $<HTMLInputElement>('aux'),
  left: $<HTMLSelectElement>('left'),
  right: $<HTMLSelectElement>('right'),
  mode: $<HTMLSelectElement>('mode'),
  gain: $<HTMLInputElement>('gain'),
  split: $<HTMLInputElement>('split'),
  refspp: $<HTMLInputElement>('refspp'),
  runs: $<HTMLInputElement>('runs'),
};
const precisionSel = $<HTMLSelectElement>('precision');
precisionSel.value = precision;
precisionSel.addEventListener('change', () => {
  const u = new URL(location.href);
  u.searchParams.set('precision', precisionSel.value);
  location.href = u.toString();
});
for (const o of SCENES) ui.scene.add(new Option(o.label, o.id));

async function main() {
  if (!(await ensureWebGPU())) return;
  const canvas = $<HTMLCanvasElement>('view');
  const picker = mountRuntimePicker($('runtimePicker'));
  const { renderer, denoiser, device } = await createStack({
    renderer: { canvas, antialias: false },
    precision,
    quality: 'balanced',
  }).catch((e) => { picker.failed((e as Error).message); throw e; });
  picker.attach(denoiser);
  device.lost.then((i) => log(`DEVICE LOST: ${i.reason} ${i.message}`));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.setPixelRatio(1);
  const hasF16 = device.features.has('shader-f16');

  // ---- contenders ------------------------------------------------------------------
  // dev: the repo's .tza files (vite-tzas); prod: the CDN our runtimes use. Both sides fetch
  // the same file.
  const tzaBase = import.meta.env.DEV ? '/tzas' : DEFAULT_TZA_URL;
  const contenders: Contender[] = [
    new OursContender(renderer, device, denoiser, () => picker.label()),
    ...oidnWebVariants().map((v) => new OidnWebContender(renderer, device, v, tzaBase, precision)),
  ];
  const byId = new Map(contenders.map((c) => [c.id, c]));
  const SOURCES: [string, string][] = [
    ...contenders.map((c) => [c.id, c.unavailable ? `${c.label} (unavailable)` : c.label] as [string, string]),
    ['noisy', 'noisy input'],
    ['reference', 'reference (trace it first)'],
  ];
  for (const sel of [ui.left, ui.right]) {
    for (const [id, label] of SOURCES) {
      const opt = new Option(label, id);
      opt.disabled = !!byId.get(id)?.unavailable;
      sel.add(opt);
    }
  }
  ui.left.value = 'oidn-wgsl';
  ui.right.value = 'ours';
  // benchmark contender checkboxes
  const benchBox = $('benchContenders');
  for (const c of contenders) {
    const l = document.createElement('label');
    l.className = 'check';
    l.innerHTML = `<input type="checkbox" value="${c.id}" ${c.unavailable ? 'disabled' : 'checked'}> ${c.label}`;
    if (c.unavailable) l.title = c.unavailable;
    benchBox.append(l);
  }

  for (const [k, el] of Object.entries(ui)) {
    const v = params.get(k);
    if (v === null) continue;
    if (el instanceof HTMLInputElement && el.type === 'checkbox') el.checked = v !== '0';
    else el.value = v;
  }
  const syncUrl = () => {
    const u = new URL(location.href);
    for (const [k, el] of Object.entries(ui)) {
      u.searchParams.set(k, el instanceof HTMLInputElement && el.type === 'checkbox' ? (el.checked ? '1' : '0') : el.value);
    }
    history.replaceState(null, '', u);
  };

  // ---- path tracer -----------------------------------------------------------------
  const pathTracer = new WebGPUPathTracer(renderer) as N;
  pathTracer.dynamicLowRes = false;
  pathTracer.renderDelay = 0;
  pathTracer.fadeDuration = 0;
  pathTracer.minSamples = 0;
  pathTracer.renderScale = 1; // denoise at output size: this page compares denoisers, not upscalers
  const samples = sampleCounter(pathTracer);
  const gbuffer = new GBuffer();

  let lab: LabScene;
  let controls: OrbitControls | undefined;
  let home: { position: THREE.Vector3; quaternion: THREE.Quaternion };
  async function loadScene(id: string) {
    const entry = SCENES.find((s) => s.id === id) ?? SCENES[0];
    log(`loading ${entry.label}…`);
    lab = await entry.build();
    const [w, h] = sizeOf();
    lab.camera.aspect = w / h;
    lab.camera.updateProjectionMatrix();
    pathTracer.setScene(lab.scene, lab.camera);
    home = { position: lab.camera.position.clone(), quaternion: lab.camera.quaternion.clone() };
    controls?.dispose();
    controls = new OrbitControls(lab.camera, canvas);
    controls.target.copy(lab.target);
    controls.update(); // before the listener: poking the tracer mid-setup wedges it
    controls.addEventListener('change', () => { pathTracer.updateCamera(); restart(true); });
    restart(true);
    log(`${entry.label} loaded`);
  }

  const sizeOf = () => ui.size.value.split('x').map(Number) as [number, number];
  function setSize(w: number, h: number) {
    renderer.setSize(w, h, false);
    canvas.style.aspectRatio = `${w} / ${h}`;
    if (lab) { lab.camera.aspect = w / h; lab.camera.updateProjectionMatrix(); pathTracer.updateCamera(); }
  }
  const quality = () => ui.quality.value as Quality;
  const runOpts = () => ({ quality: quality(), aux: ui.aux.checked });

  // ---- live comparison state -------------------------------------------------------
  // `inputs` is the frozen frame both sides denoise; results are per contender, for that frame.
  let inputs: Inputs | null = null;
  let colorTex: THREE.StorageTexture | null = null;
  let refTex: THREE.StorageTexture | null = null;
  let epoch = 0;
  const results = new Map<string, RunResult & { psnr?: number }>();
  const pending = new Set<string>();
  const failed = new Map<string, string>();
  const firstRuns = new Map<string, number>(); // `${id}|${model}|${w}x${h}` → ms, page-wide
  let queue: Promise<void> = Promise.resolve();
  let benchRunning = false;
  let refImg: Uint8Array | null = null;
  const readHalf = displayReader(renderer, THREE.HalfFloatType);
  const readFloat = displayReader(renderer, THREE.FloatType);

  function restart(viewChanged: boolean) {
    epoch++;
    for (const c of contenders) c.abort();
    inputs = null;
    results.clear();
    failed.clear();
    if (viewChanged) { refTex = null; refImg = null; }
    pathTracer.maxSamples = Math.max(1, parseInt(ui.spp.value, 10) || 1);
    pathTracer.maxBounces = Math.max(1, parseInt(ui.bounces.value, 10) || 1);
    pathTracer.reset();
    samples.reset();
  }

  /** Runs contender `id` on the frozen frame unless it has a result already. Serialized. */
  function ensure(id: string) {
    const ct = byId.get(id);
    if (!ct || ct.unavailable || !inputs || results.has(id) || pending.has(id) || failed.has(id)) return;
    pending.add(id);
    const e = epoch;
    queue = queue.then(async () => {
      if (e !== epoch || !inputs) return;
      log(`${ct.label}: denoising…`);
      const r = await ct.run(inputs, runOpts());
      if (r.cold) firstRuns.set(`${id}|${modelFor(quality(), ui.aux.checked)}|${inputs.width}x${inputs.height}`, r.ms);
      if (e !== epoch) return;
      results.set(id, r);
      if (id === 'ours') picker.denoised(r.ms);
      log(`${ct.label}: ${r.ms.toFixed(1)} ms${r.cold ? ' (first run: weights + compile)' : ''} · ${r.detail}`);
      await score(id);
    }).catch((err) => {
      if (e !== epoch || (err as Error).message === 'aborted') return;
      failed.set(id, (err as Error).message);
      log(`${ct.label} failed: ${(err as Error).message}`);
      console.error(err);
    }).finally(() => pending.delete(id));
  }

  async function score(id: string) {
    const r = results.get(id);
    if (!r || !refImg || r.psnr !== undefined) return;
    r.psnr = psnr(await readHalf(r.output), refImg);
  }
  let noisyPsnr: number | undefined;

  async function traceReference() {
    if (benchRunning || !lab) return;
    benchRunning = true;
    try {
      const n = Math.max(16, parseInt(ui.refspp.value, 10) || 1024);
      log(`tracing the reference (${n} spp)…`);
      pathTracer.reset();
      await accumulateTo(pathTracer, device, n, 600_000);
      refTex = snapshot(renderer, pathTracer.target, refTex);
      refImg = await readFloat(refTex);
      noisyPsnr = colorTex && inputs ? psnr(await readFloat(colorTex), refImg) : undefined;
      for (const r of results.values()) r.psnr = undefined;
      for (const id of results.keys()) await score(id);
      log('reference ready: PSNR shown in the labels');
    } finally {
      // back to the noisy accumulation; the frozen frame (if any) is untouched
      pathTracer.maxSamples = Math.max(1, parseInt(ui.spp.value, 10) || 1);
      pathTracer.reset();
      samples.reset();
      benchRunning = false;
    }
  }
  $('traceRef').addEventListener('click', () => void traceReference());

  // ---- controls --------------------------------------------------------------------
  for (const el of [ui.size, ui.spp, ui.bounces]) {
    el.addEventListener('change', () => { setSize(...sizeOf()); restart(true); syncUrl(); });
  }
  for (const el of [ui.quality, ui.aux]) el.addEventListener('change', () => { restart(false); syncUrl(); });
  ui.scene.addEventListener('change', () => { syncUrl(); void loadScene(ui.scene.value); });
  for (const el of [ui.left, ui.right, ui.mode, ui.gain, ui.split]) el.addEventListener('input', syncUrl);

  // ---- split view ------------------------------------------------------------------
  // textureLoad (no sampler): the rgba32float frames aren't filterable everywhere, and nearest
  // lookups show the pixels as they are.
  const placeholder = (type: THREE.TextureDataType) => {
    const t = new THREE.StorageTexture(1, 1);
    t.type = type; // must match what's bound later
    renderer.initTexture(t);
    return t;
  };
  const loadAtScreen = (tex: THREE.Texture) => {
    const node = textureLoad(tex, ivec2(0, 0)) as N;
    node.uvNode = ivec2(screenUV.mul(vec2(node.size(0))).floor());
    return node;
  };
  const noisyNode = loadAtScreen(placeholder(THREE.FloatType));
  const refNode = loadAtScreen(placeholder(THREE.FloatType));
  const leftNode = loadAtScreen(placeholder(THREE.HalfFloatType));
  const rightNode = loadAtScreen(placeholder(THREE.HalfFloatType));
  const uSplit = uniform(0.5);
  const uLeft = uniform(0); // 0 noisy, 1 reference, 2 denoised
  const uRight = uniform(0);
  const uMode = uniform(0); // 0 split, 1 |left − right| x gain
  const uGain = uniform(8);
  const pick = (kind: N, den: N) => kind.equal(0).select(noisyNode.rgb, kind.equal(1).select(refNode.rgb, den.rgb));
  const compare = new THREE.MeshBasicNodeMaterial();
  compare.colorNode = Fn(() => {
    // tone mapped here (the renderer's is switched off for this draw) so the difference view
    // compares what is on screen
    const l = (acesFilmicToneMapping as N)(pick(uLeft, leftNode), float(1));
    const r = (acesFilmicToneMapping as N)(pick(uRight, rightNode), float(1));
    const split = (screenUV.x.lessThan(uSplit) as N).select(l, r);
    const diff = abs(l.sub(r)).mul(uGain);
    return vec4((uMode.equal(1) as N).select(diff, split), float(1));
  })();
  const compareQuad = new THREE.QuadMesh(compare);

  // draggable divider (a DOM handle over the canvas, so it doesn't fight the orbit controls)
  const divider = $('divider');
  const placeDivider = () => { divider.style.left = `${ui.split.value}%`; };
  divider.addEventListener('pointerdown', (e) => {
    divider.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      ui.split.value = String(Math.round(Math.min(100, Math.max(0, ((ev.clientX - rect.left) / rect.width) * 100)) * 10) / 10);
      placeDivider();
    };
    const up = () => {
      divider.removeEventListener('pointermove', move);
      divider.removeEventListener('pointerup', up);
      syncUrl();
    };
    divider.addEventListener('pointermove', move);
    divider.addEventListener('pointerup', up);
    e.stopPropagation();
  });
  ui.split.addEventListener('input', placeDivider);

  const tagL = $('tagLeft');
  const tagR = $('tagRight');
  function describe(id: string) {
    if (id === 'noisy') return `noisy · ${pathTracer.maxSamples} spp` + (noisyPsnr !== undefined ? ` · ${noisyPsnr.toFixed(2)} dB` : '');
    if (id === 'reference') return refTex ? `reference · ${ui.refspp.value} spp` : 'reference: not traced yet';
    const ct = byId.get(id)!;
    const r = results.get(id);
    if (failed.has(id)) return `${ct.short} · failed: ${failed.get(id)}`;
    if (!r) return `${ct.short} · ${inputs ? 'denoising…' : 'waiting for samples'}`;
    return `${ct.short} · ${r.ms.toFixed(1)} ms${r.cold ? ' (first run)' : ''}` + (r.psnr !== undefined ? ` · ${r.psnr.toFixed(2)} dB` : '');
  }
  /** Points one side's uniforms at its source; returns false while that side has nothing to show. */
  function bindSide(id: string, kind: N, den: N) {
    if (id === 'noisy') { kind.value = 0; return true; }
    if (id === 'reference') { kind.value = refTex ? 1 : 0; return !!refTex; }
    const r = results.get(id);
    if (!r) { kind.value = 0; return false; }
    kind.value = 2;
    den.value = r.output;
    return true;
  }

  // ---- benchmark -------------------------------------------------------------------
  const RESULTS_KEY = 'oidn-web-compare:results';
  const store = {
    get<T>(k: string, d: T): T { try { return JSON.parse(localStorage.getItem(k) ?? '') as T; } catch { return d; } },
    set(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
  };
  let rows: BenchRow[] = store.get(RESULTS_KEY, []);
  const table = $<HTMLTableElement>('results');
  function renderRows() {
    table.innerHTML = `<thead><tr>${ROW_COLUMNS.map(([k]) => `<th>${k}</th>`).join('')}</tr></thead><tbody>` +
      rows.map((r) => `<tr>${ROW_COLUMNS.map(([, g]) => `<td>${g(r)}</td>`).join('')}</tr>`).join('') + '</tbody>';
    $('resultsBox').hidden = rows.length === 0;
  }
  renderRows();
  const bench = createBench({
    renderer, device, pathTracer, gbuffer, contenders, setSize,
    sceneCamera: () => ({ scene: lab.scene, camera: lab.camera }),
    firstRuns, runtime: () => picker.label(), precision: `${precision}${hasF16 ? '' : ' (no shader-f16: fp32)'}`, log,
  });
  const benchBtn = $<HTMLButtonElement>('bench');
  async function runBench() {
    if (benchRunning) return;
    benchRunning = true;
    benchBtn.disabled = true;
    restart(false);
    try {
      // the shot is the scene's own camera, not wherever it was orbited to
      lab.camera.position.copy(home.position);
      lab.camera.quaternion.copy(home.quaternion);
      controls!.target.copy(lab.target);
      controls!.update();
      const sizes = [...document.querySelectorAll<HTMLInputElement>('#benchSizes input:checked')]
        .map((i) => i.value.split('x').map(Number) as [number, number]);
      const picked = [...document.querySelectorAll<HTMLInputElement>('#benchContenders input:checked')].map((i) => i.value);
      const t0 = performance.now();
      await bench({
        scene: ui.scene.value, sizes: sizes.length ? sizes : [sizeOf()],
        spp: Math.max(1, parseInt(ui.spp.value, 10) || 1), bounces: Math.max(1, parseInt(ui.bounces.value, 10) || 1),
        quality: quality(), aux: ui.aux.checked,
        refSpp: Math.max(16, parseInt(ui.refspp.value, 10) || 1024), warmRuns: Math.max(1, parseInt(ui.runs.value, 10) || 5),
        contenders: picked,
      }, (row) => { rows = [...rows, row]; store.set(RESULTS_KEY, rows); renderRows(); });
      log(`benchmark done in ${((performance.now() - t0) / 1000).toFixed(0)} s`);
    } catch (e) {
      log('benchmark ERROR: ' + (e as Error).message);
      console.error(e);
    } finally {
      benchRunning = false;
      benchBtn.disabled = false;
      setSize(...sizeOf());
      restart(true);
    }
  }
  benchBtn.addEventListener('click', () => void runBench());
  $('copyMd').addEventListener('click', () => void navigator.clipboard.writeText(toMarkdown(rows)));
  $('copyJson').addEventListener('click', () => void navigator.clipboard.writeText(JSON.stringify(rows, null, 2)));
  $('clearResults').addEventListener('click', () => { rows = []; store.set(RESULTS_KEY, rows); renderRows(); });

  // ---- loop ------------------------------------------------------------------------
  const stats = $<HTMLDivElement>('stats');
  setSize(...sizeOf());
  placeDivider();
  if (!ui.scene.value) ui.scene.value = SCENES[0].id;
  await loadScene(ui.scene.value);

  (window as N).__cmp = {
    renderer, device, denoiser, pathTracer, contenders, results, firstRuns, runBench, traceReference,
    get inputs() { return inputs; }, get rows() { return rows; }, get busy() { return benchRunning || pending.size > 0; },
  };

  const loop = () => {
    requestAnimationFrame(loop);
    if (benchRunning) return;
    pathTracer.renderSample();
    samples.poll();

    // freeze the frame once every pixel has its samples, then denoise both sides
    if (!inputs && samples.value >= pathTracer.maxSamples && pathTracer.target) {
      const [w, h] = sizeOf();
      colorTex = snapshot(renderer, pathTracer.target, colorTex);
      inputs = { color: colorTex, ...gbuffer.render(renderer, lab.scene, lab.camera, w, h), width: w, height: h, epoch };
      noisyPsnr = undefined;
      if (refImg) void readFloat(colorTex).then((img) => { noisyPsnr = psnr(img, refImg!); });
    }
    if (inputs) { ensure(ui.left.value); ensure(ui.right.value); }

    const diffMode = ui.mode.value === 'diff';
    uMode.value = diffMode ? 1 : 0;
    uGain.value = Number(ui.gain.value);
    uSplit.value = Number(ui.split.value) / 100;
    divider.hidden = diffMode;
    if (inputs) {
      noisyNode.value = colorTex!;
      if (refTex) refNode.value = refTex;
      bindSide(ui.left.value, uLeft, leftNode);
      bindSide(ui.right.value, uRight, rightNode);
      renderer.setRenderTarget(null);
      const tone = renderer.toneMapping;
      renderer.toneMapping = THREE.NoToneMapping;
      compareQuad.render(renderer);
      renderer.toneMapping = tone;
    }
    tagL.textContent = diffMode ? `|${describe(ui.left.value)}` : describe(ui.left.value);
    tagR.textContent = diffMode ? `− ${describe(ui.right.value)}| × ${ui.gain.value}` : describe(ui.right.value);

    const [w, h] = sizeOf();
    stats.innerHTML = [
      ['frame', `${w}×${h}`],
      ['samples', `${samples.value} / ${pathTracer.maxSamples}`],
      ['model', modelFor(quality(), ui.aux.checked)],
      ['precision', `${precision}${hasF16 ? '' : ' (device has no shader-f16)'}`],
      ['our runtime', picker.label()],
    ].map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
  };
  loop();

  if (params.get('autobench') === '1') setTimeout(() => void runBench(), 1500);
}

demoFooter('oidn-web-compare');
main().catch((e) => { log('ERROR: ' + (e as Error).message); console.error(e); });
