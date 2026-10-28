// three-temporal/shadow-bench: a still-able, ground-truthed bench for the corner's knot shadow (realtime-shadows.html's
// scene), for finding and tuning shadow boil. How-to: docs/research/rt-denoiser/results/SHADOW-BENCH.md.
//
//   live    the knot turns, every variant denoises the same 1-ray signal; pause (space) and the frame is compared
//           with its ground truth (4096 stratified rays/px by default, cached on disk by what it depends on), flip
//           between ground truth / raw / variants with 1..n, l / m / e for lit / mask / error, click to zoom.
//           Variant B takes any ShadowDenoiser options; "apply" replays the timeline from frame 0 with them, so a
//           paused frame shows exactly what B would have produced there.
//   run     warmup, then `count` checkpoints `step` frames apart, each with a burst of consecutive frames: per-region
//           error, umbra solidity, per-pixel and low-frequency boil, temporal error, GPU ms; images + run.json in
//           out/shadow-bench/outputs/<run id>/ (the headless runner: shadow-bench.mjs)
//   report  ?report=<run id> shows a saved run, ?report lists them
import { mountShell, ui } from '../../../_shared/shell';
import { OPTIONS } from '../review/options';
import { type BenchConfig, type CameraId, type Variant, CAMERAS, DEFAULT_CONFIG, DEFAULT_VARIANTS, TUNABLES, gtRowsFor, keptFrames, resolveConfig } from './config';
import { BENCH_API, type Engine, type FrameRead, type GroundTruth, type Show, createEngine } from './engine';
import { REGIONS, frameStats, regionMasks } from './metrics';
import { draw, errImage, litImage, maskImage } from './images';
import { type RunResult, runBench } from './run';
import { renderReport, renderRunList } from './report';

mountShell({ id: 'three-temporal-shadow-bench', title: 'Shadow bench (internal)' });

const q = new URLSearchParams(location.search);
const statusEl = document.querySelector<HTMLPreElement>('#status')!;
const log = (m: string) => { statusEl.textContent = m; console.log('[shadow-bench]', m); };
const fileUrl = (id: string) => (n: string) => `${BENCH_API}/files/outputs/${id}/${n}`;
const reportHref = (id: string) => `?report=${encodeURIComponent(id)}`;

async function reportMode(id: string) {
  document.body.classList.add('sb-report-mode');
  const el = document.querySelector<HTMLElement>('#report')!;
  if (!id) {
    const list = await (await fetch(`${BENCH_API}/list?path=outputs`)).json() as { name: string; dir: boolean }[];
    const runs = (await Promise.all(list.filter((e) => e.dir).map(async (e) => {
      const r = await fetch(fileUrl(e.name)('run.json'));
      return r.ok ? (await r.json() as RunResult) : null;
    }))).filter((r): r is RunResult => !!r).sort((a, b) => b.id.localeCompare(a.id));
    renderRunList(el, runs, reportHref);
    log(`${runs.length} saved runs (out/shadow-bench/outputs/)`);
    return;
  }
  const res = await fetch(fileUrl(id)('run.json'));
  if (!res.ok) { log(`no run ${id} (HTTP ${res.status})`); return; }
  renderReport(el, await res.json(), fileUrl(id));
  log(`run ${id}`);
}

// ---- live page -------------------------------------------------------------------------------------------------------

/** Config from the URL: ?cfg=<json> plus single keys (?camera=knot&knotRate=0.01 ...). */
function urlConfig(): BenchConfig {
  const c: Record<string, unknown> = q.has('cfg') ? JSON.parse(q.get('cfg')!) : {};
  for (const k of Object.keys(DEFAULT_CONFIG)) {
    const v = q.get(k);
    if (v === null) continue;
    const d = (DEFAULT_CONFIG as unknown as Record<string, unknown>)[k];
    c[k] = typeof d === 'number' ? Number(v) : typeof d === 'boolean' ? v === 'true' || v === '1' : v;
  }
  return resolveConfig(c as Partial<BenchConfig>);
}

async function liveMode() {
  let cfg = urlConfig();
  const canvas = document.querySelector<HTMLCanvasElement>('#view')!;
  const frozenCanvas = document.querySelector<HTMLCanvasElement>('#frozen')!;
  const stage = document.querySelector<HTMLDivElement>('.sb-stage')!;
  const tagEl = document.querySelector<HTMLSpanElement>('#stage-tag')!;
  const capFrame = document.querySelector<HTMLSpanElement>('#cap-frame')!;
  const capCost = document.querySelector<HTMLSpanElement>('#cap-cost')!;
  const statsEl = document.querySelector<HTMLDivElement>('#frozen-stats')!;
  const reportEl = document.querySelector<HTMLElement>('#report')!;
  const engine: Engine = await createEngine(canvas, cfg.w, cfg.h, cfg.sampler);
  const { W, H } = engine;

  // variants: FFX, ours (package defaults), and B (ours with the tuning panel's options) when enabled
  let bOptions: Record<string, unknown> = q.has('b') ? JSON.parse(q.get('b')!) : {};
  let bOn = q.has('b');
  const variantList = (): Variant[] => [...DEFAULT_VARIANTS, ...(bOn ? [{ id: 'b', kind: 'ours' as const, options: bOptions, label: 'realtimeShadows + tuning panel options' }] : [])];
  engine.setScene(cfg);
  engine.setVariants(variantList());
  engine.reset();

  let playing = !q.has('manual') && q.get('play') !== '0';
  let busy = false;
  let liveView = q.get('view') ?? 'ours', liveShow: Show = q.get('show') === 'mask' ? 'mask' : 'lit';
  engine.setLive(liveView, liveShow);
  const syncUrl = () => {
    const u = new URLSearchParams();
    const diff = Object.fromEntries(Object.entries(cfg).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify((DEFAULT_CONFIG as unknown as Record<string, unknown>)[k])));
    if (Object.keys(diff).length) u.set('cfg', JSON.stringify(diff));
    if (bOn) u.set('b', JSON.stringify(bOptions));
    if (q.has('manual')) u.set('manual', '');
    history.replaceState(null, '', `${location.pathname}${u.size ? `?${u}` : ''}`);
  };

  // ---- frozen comparison --------------------------------------------------------------------------------------------
  let frozen: { f: number; rd: FrameRead; g: GroundTruth } | null = null;
  const fz = { k: 'gt', mode: 'lit' as 'lit' | 'mask' | 'err', zoom: false };
  const imageIds = () => ['gt', 'noisy', ...engine.variants.map((v) => v.id)];
  const imageOf = (k: string): Float32Array => !frozen ? new Float32Array(0) : k === 'gt' ? frozen.g.gt : k === 'noisy' ? frozen.rd.noisy : frozen.rd.outputs[k];
  const drawFrozen = () => {
    if (!frozen) return;
    const v = imageOf(fz.k);
    const aux = { base: frozen.rd.base, direct: frozen.rd.direct };
    draw(frozenCanvas, fz.mode === 'lit' ? litImage(v, aux, W, H) : fz.mode === 'mask' || fz.k === 'gt' ? maskImage(v, W, H) : errImage(v, frozen.g.gt, frozen.g.recv, W, H));
    tagEl.textContent = `${fz.k} · ${fz.mode} · frame ${frozen.f}`;
    document.querySelectorAll<HTMLButtonElement>('#fz-img button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === fz.k)));
    document.querySelectorAll<HTMLButtonElement>('#fz-mode button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === fz.mode)));
  };
  const statsTable = () => {
    if (!frozen) { statsEl.innerHTML = ''; return; }
    const masks = regionMasks(frozen.g.gt, frozen.g.recv, frozen.rd.object);
    const n = (r: (typeof REGIONS)[number]) => masks[r].reduce((a, b) => a + b, 0);
    const rows = imageIds().filter((k) => k !== 'gt').map((k) => {
      const s = Object.fromEntries(REGIONS.map((r) => [r, frameStats(imageOf(k), frozen!.g.gt, masks[r])]));
      return `<tr><th>${k}</th><td>${s.umbra.rmse.toFixed(4)}</td><td>${s.umbra.bias.toFixed(4)}</td><td>${(s.umbra.bad * 100).toFixed(1)} %</td><td>${s.penumbra.rmse.toFixed(4)}</td><td>${s.all.rmse.toFixed(4)}</td><td>${s.object.rmse.toFixed(4)}</td></tr>`;
    }).join('');
    statsEl.innerHTML = `<table class="sb-table sb-small"><thead><tr><th>frame ${frozen.f}</th><th>umbra RMSE</th><th>umbra bias</th><th>umbra off</th><th>penumbra RMSE</th><th>all RMSE</th><th>knot RMSE</th></tr></thead><tbody>${rows}</tbody></table>
      <p class="sb-muted">vs ${cfg.gtGrid ** 2}-ray ground truth (${frozen.g.cached ? 'cached' : 'computed'}); umbra ${n('umbra').toLocaleString()} px, penumbra ${n('penumbra').toLocaleString()} px. Single frame: boil is temporal, "Measure here" scores a burst.</p>`;
  };
  const freeze = async () => {
    if (engine.frame < 0) engine.step();
    busy = true;
    try {
      const rd = await engine.readFrame();
      const g = await engine.groundTruth(engine.frame, { onProgress: (d, n) => log(`ground truth of frame ${engine.frame}: pass ${d}/${n}`) });
      frozen = { f: rd.frame, rd, g };
      stage.classList.add('frozen');
      buildFrozenBar(); drawFrozen(); statsTable();
      log(`paused at frame ${frozen.f}: ground truth ${g.cached ? 'from cache' : 'computed'}${engine.cacheAvailable ? '' : ' (no disk cache: serve with `yarn workspace three-temporal shadow-bench`)'}`);
    } finally { busy = false; }
  };
  const unfreeze = () => { frozen = null; stage.classList.remove('frozen'); statsTable(); };
  const setPlaying = (on: boolean) => {
    if (busy) return;
    playing = on;
    playBtn.textContent = on ? 'pause' : 'play';
    if (on) unfreeze(); else void freeze();
  };
  /** Replay the timeline from frame 0 to `f` (new options, new scene, or a step back). */
  const goto = async (f: number) => {
    busy = true;
    try {
      unfreeze();
      engine.reset();
      await engine.advanceTo(Math.max(0, f), (k) => log(`replaying: frame ${k} / ${f}`));
    } finally { busy = false; }
    if (!playing) await freeze();
  };

  // ---- panel ----------------------------------------------------------------------------------------------------------
  const panel = document.querySelector<HTMLElement>('#panel')!;
  const playBtn = ui.button(playing ? 'pause' : 'play', () => setPlaying(!playing), { primary: true });
  const frameOut = ui.readout();
  panel.append(ui.group('Playback', [row(playBtn,
    ui.button('+1', () => { if (!busy) { unfreeze(); engine.step(); if (!playing) void freeze(); } }),
    ui.button('+10', async () => { if (!busy) await goto(engine.frame + 10); }),
    ui.button('−1', async () => { if (!busy) await goto(engine.frame - 1); }),
    ui.button('restart', async () => { if (!busy) { await goto(0); } })),
    frameOut.el], 'space play / pause · → +1 · ← −1 (replays from frame 0) · r restart. Pausing compares the frame with its ground truth.'));

  const viewSeg = () => ui.segmented({ options: [...engine.variants.map((v) => ({ value: v.id, label: v.id })), { value: 'noisy', label: '1 ray, raw' }], value: liveView, onChange: (v) => { liveView = v; engine.setLive(liveView, liveShow); } });
  const viewGroup = ui.group('Live view (while playing)', [viewSeg().el, ui.segmented({ options: [{ value: 'lit', label: 'lit' }, { value: 'mask', label: 'visibility' }], value: liveShow, onChange: (v) => { liveShow = v as Show; engine.setLive(liveView, liveShow); } }).el]);
  panel.append(viewGroup);

  const applyScene = async (patch: Partial<BenchConfig>) => {
    cfg = resolveConfig({ ...cfg, ...patch });
    engine.setScene(cfg);
    syncUrl();
    await goto(playing ? 0 : engine.frame);
  };
  const rate0 = DEFAULT_CONFIG.knotRate;
  panel.append(ui.group('Scene (changes replay the timeline)', [
    ui.select({ options: [...(Object.keys(CAMERAS) as Exclude<CameraId, 'custom'>[]).map((k) => ({ value: k, label: CAMERAS[k].label })), ...(cfg.camera === 'custom' ? [{ value: 'custom', label: 'custom (URL)' }] : [])], value: cfg.camera, onChange: (v) => void applyScene({ camera: v as CameraId }) }).el,
    span('knot speed'), ui.slider({ min: 0, max: 6, step: 0.25, value: cfg.knotRate / rate0, format: (v) => `${v}× (${(v * rate0 * 60).toFixed(2)} rad/s)`, onInput: debounce((v: number) => void applyScene({ knotRate: v * rate0 })) }).el,
    span('knot start'), ui.slider({ min: 0, max: 6.28, step: 0.02, value: cfg.knotStart, format: (v) => `${v.toFixed(2)} rad`, onInput: debounce((v: number) => void applyScene({ knotStart: v })) }).el,
    span('light half size'), ui.slider({ min: 0.03, max: 1, step: 0.01, value: cfg.lightHalf, format: (v) => `${v.toFixed(2)} m`, onInput: debounce((v: number) => void applyScene({ lightHalf: v })) }).el,
  ]));

  // variant B: registry options (bool / enum) + numeric knobs + free JSON
  const bBox = document.createElement('div');
  bBox.className = 'sb-tune';
  const shadowOpts = OPTIONS.filter((o) => o.filter === 'shadows');
  const renderTune = () => {
    const res = engine.resolved('ours') ?? {};
    const val = (k: string) => (k in bOptions ? bOptions[k] : undefined);
    bBox.innerHTML = `
      <div class="sb-tune-grid">${shadowOpts.map((o) => {
        const cur = val(o.key);
        const def = res[o.key] ?? o.default;
        if (o.values.length === 2 && typeof o.values[0] === 'boolean') {
          return `<label title="${o.look.replace(/"/g, '&quot;')}"><span>${o.key}</span><select data-k="${o.key}" data-t="bool"><option value="">default (${def})</option><option value="true"${cur === true ? ' selected' : ''}>true</option><option value="false"${cur === false ? ' selected' : ''}>false</option></select></label>`;
        }
        // the registry's values, plus the current one when it is not among them (a URL or JSON value must survive "apply")
        const vals = cur === undefined || o.values.some((v) => JSON.stringify(v) === JSON.stringify(cur)) ? o.values : [...o.values, cur as typeof o.values[number]];
        return `<label title="${o.look.replace(/"/g, '&quot;')}"><span>${o.key}</span><select data-k="${o.key}" data-t="enum"><option value="">default (${def})</option>${vals.map((v) => `<option value="${JSON.stringify(v).replace(/"/g, '&quot;')}"${JSON.stringify(cur) === JSON.stringify(v) ? ' selected' : ''}>${v}</option>`).join('')}</select></label>`;
      }).join('')}${TUNABLES.filter((t) => !shadowOpts.some((o) => o.key === t.key)).map((t) => `<label title="${t.note}"><span>${t.key}</span><input type="number" data-k="${t.key}" data-t="num" min="${t.min}" max="${t.max}" step="${t.step}" placeholder="${res[t.key] ?? ''}" value="${val(t.key) ?? ''}"></label>`).join('')}</div>
      <label class="sb-json"><span>more options (JSON, merged last)</span><textarea rows="2" spellcheck="false" data-t="json">${JSON.stringify(Object.fromEntries(Object.entries(bOptions).filter(([k]) => !shadowOpts.some((o) => o.key === k) && !TUNABLES.some((t) => t.key === k))))}</textarea></label>`;
  };
  const readTune = (): Record<string, unknown> => {
    const o: Record<string, unknown> = {};
    bBox.querySelectorAll<HTMLSelectElement | HTMLInputElement>('[data-k]').forEach((e) => {
      if (e.value === '') return;
      o[e.dataset.k!] = e.dataset.t === 'num' ? Number(e.value) : e.dataset.t === 'bool' ? e.value === 'true' : JSON.parse(e.value);
    });
    const j = bBox.querySelector<HTMLTextAreaElement>('textarea')!.value.trim();
    if (j) Object.assign(o, JSON.parse(j));
    return o;
  };
  const bToggle = ui.toggle('variant B on', bOn, (on) => { bOn = on; void applyVariants(); });
  const applyVariants = async () => {
    try { bOptions = readTune(); } catch (e) { log(`variant B options: ${(e as Error).message}`); return; }
    engine.setVariants(variantList());
    syncUrl();
    viewGroup.replaceChild(viewSeg().el, viewGroup.children[1]);
    await goto(engine.frame);
  };
  panel.append(ui.group('Variant B: ours with these options', [row(bToggle.el,
    ui.button('apply (replays to here)', () => { if (!busy) { bOn = true; bToggle.input.checked = true; void applyVariants(); } }, { primary: true }),
    ui.button('copy JSON', () => { void navigator.clipboard?.writeText(JSON.stringify(readTune())); log(`B options: ${JSON.stringify(readTune())}`); })),
    bBox], 'Blank = the package default (shown). Hover a name for what it does. The shadow decisions\' notes are in src/review/options.ts.'));
  renderTune();

  // bench run
  const num = (k: keyof BenchConfig, label: string, min: number, max: number) => {
    const i = document.createElement('input');
    i.type = 'number'; i.min = String(min); i.max = String(max); i.value = String(cfg[k]);
    i.addEventListener('change', () => { cfg = resolveConfig({ ...cfg, [k]: Number(i.value) }); syncUrl(); });
    const l = document.createElement('label'); l.className = 'sb-num'; l.append(span(label), i);
    return l;
  };
  const gtSel = ui.select({ options: [16, 32, 64, 128].map((g) => ({ value: String(g), label: `${g * g} rays/px` })), value: String(cfg.gtGrid), onChange: (v) => { cfg = resolveConfig({ ...cfg, gtGrid: Number(v), gtRows: gtRowsFor(Number(v)) }); engine.setScene(cfg); syncUrl(); } });
  const imgSel = ui.select({ options: [{ value: 'checkpoints', label: 'images at checkpoints' }, { value: 'all', label: 'images of every kept frame' }, { value: 'none', label: 'no images' }], value: cfg.images, onChange: (v) => { cfg = resolveConfig({ ...cfg, images: v as BenchConfig['images'] }); syncUrl(); } });
  const labelIn = document.createElement('input'); labelIn.placeholder = 'label'; labelIn.className = 'sb-label-in';
  const runOut = ui.readout();
  const doRun = async (c: BenchConfig) => {
    if (busy) return;
    playing = false; playBtn.textContent = 'play';
    busy = true; unfreeze();
    try {
      const run = await runBench(engine, { ...c, label: labelIn.value || c.label }, variantList(), { onProgress: (m) => { runOut.set(m); log(m); } });
      lastRun = run;
      disposeReport();
      disposeReport = renderReport(reportEl, run, fileUrl(run.id), { keyActive: () => reportEl.matches(':hover') });
      runOut.set(`run ${run.id}: ${(run.wallMs / 1000).toFixed(1)} s`);
    } catch (e) { log(`run failed: ${(e as Error).stack ?? e}`); } finally { busy = false; }
    await freeze();
  };
  let lastRun: RunResult | null = null;
  let disposeReport = () => {};
  panel.append(ui.group('Bench run', [
    row(num('warmup', 'warmup frames', 0, 100000), num('step', 'step', 1, 1000), num('count', 'checkpoints', 1, 1000), num('burst', 'burst', 1, 16)),
    row(gtSel.el, imgSel.el, labelIn),
    row(ui.button('run bench', () => void doRun(cfg), { primary: true }),
      ui.button('measure here', () => void doRun(resolveConfig({ ...cfg, warmup: Math.max(engine.frame, cfg.burst - 1), count: 1 }))),
      Object.assign(document.createElement('a'), { href: '?report', textContent: 'saved runs', target: '_blank', className: 'dn-btn' })),
    runOut.el,
  ], 'Run: reset, warmup, then a checkpoint every `step` frames, each with `burst` consecutive frames (boil needs 3). "Measure here" = one checkpoint at the current frame. Ground truths are cached in out/shadow-bench/captures/gt.'));

  // frozen bar
  const fzBar = document.querySelector<HTMLDivElement>('#frozen-bar')!;
  function buildFrozenBar() {
    const ids = imageIds();
    fzBar.innerHTML = `<div class="dn-seg" id="fz-img">${ids.map((k, i) => `<button data-v="${k}" title="key ${i + 1}">${i + 1} ${k}</button>`).join('')}</div>
      <div class="dn-seg" id="fz-mode"><button data-v="lit" title="key l">lit</button><button data-v="mask" title="key m">mask</button><button data-v="err" title="key e">error</button></div>
      <span class="sb-muted">click the image to zoom</span>`;
    fzBar.querySelectorAll<HTMLButtonElement>('#fz-img button').forEach((b) => b.addEventListener('click', () => { fz.k = b.dataset.v!; drawFrozen(); }));
    fzBar.querySelectorAll<HTMLButtonElement>('#fz-mode button').forEach((b) => b.addEventListener('click', () => { fz.mode = b.dataset.v as typeof fz.mode; drawFrozen(); }));
  }
  const zoomAt = (e: MouseEvent) => { const r = stage.getBoundingClientRect(); frozenCanvas.style.transformOrigin = `${((e.clientX - r.left) / r.width) * 100}% ${((e.clientY - r.top) / r.height) * 100}%`; };
  frozenCanvas.addEventListener('click', (e) => { fz.zoom = !fz.zoom; stage.classList.toggle('zoom', fz.zoom); zoomAt(e); });
  frozenCanvas.addEventListener('mousemove', (e) => { if (fz.zoom) zoomAt(e); });

  addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement || e.metaKey || e.ctrlKey || e.altKey) return;
    if (lastRun && reportEl.matches(':hover')) return; // the report's viewer has the keys while the pointer is on it
    const n = Number(e.key);
    if (e.key === ' ') { e.preventDefault(); setPlaying(!playing); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); if (!busy) { unfreeze(); engine.step(); if (!playing) void freeze(); } }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); if (!busy) void goto(engine.frame - 1); }
    else if (e.key === 'r') { if (!busy) void goto(0); }
    else if (frozen && n >= 1 && n <= imageIds().length) { fz.k = imageIds()[n - 1]; drawFrozen(); }
    else if (frozen && (e.key === 'l' || e.key === 'm' || e.key === 'e')) { fz.mode = ({ l: 'lit', m: 'mask', e: 'err' } as const)[e.key]; drawFrozen(); }
  });

  // ---- loop -----------------------------------------------------------------------------------------------------------
  const tickLoop = () => {
    requestAnimationFrame(tickLoop);
    if (playing && !busy) engine.step();
  };
  if (!q.has('manual')) requestAnimationFrame(tickLoop);
  setInterval(() => {
    const f = Math.max(engine.frame, 0);
    frameOut.set(`frame ${f} · ${(f / 60).toFixed(2)} s @60 · knot ${(cfg.knotStart + cfg.knotRate * f).toFixed(3)} rad`);
    capFrame.textContent = frozen ? `paused at frame ${frozen.f}: ${fz.k}` : `${playing ? 'playing' : 'paused'} · live view: ${liveView}`;
    const t = engine.timings();
    capCost.textContent = `GPU ms at ${W}×${H}: ${Object.entries(t).map(([k, v]) => `${k} ${v === undefined ? '–' : v.toFixed(2)}`).join(', ')}`;
  }, 300);

  // ---- headless API (shadow-bench.mjs) -----------------------------------------------------------------------------------
  type State = { ready: boolean; progress?: string; id?: string; error?: string };
  const w = window as unknown as { __bench: unknown; __benchState: State | null };
  w.__benchState = null;
  w.__bench = {
    ready: true,
    info: { ...engine.info, w: W, h: H, cache: engine.cacheAvailable },
    gpuErrors: engine.gpuErrors,
    get frame() { return engine.frame; },
    defaultVariants: DEFAULT_VARIANTS,
    keptFrames: (c: Partial<BenchConfig>) => keptFrames(resolveConfig({ ...cfg, ...c })),
    /** Start a run (returns at once); poll window.__benchState for { progress } then { ready, id } or { error }. */
    start(c: Partial<BenchConfig>, variants?: Variant[], o: { refreshGt?: boolean } = {}) {
      playing = false;
      w.__benchState = { ready: false, progress: 'starting' };
      const full = resolveConfig({ ...cfg, ...c });
      busy = true;
      runBench(engine, full, variants ?? variantList(), { refreshGt: o.refreshGt, onProgress: (m) => { w.__benchState = { ready: false, progress: m }; log(m); } })
        .then((run) => { lastRun = run; w.__benchState = { ready: true, id: run.id }; })
        .catch((e) => { w.__benchState = { ready: false, error: String((e as Error).stack ?? e) }; })
        .finally(() => { busy = false; });
      return true;
    },
    /** Ground truths only (fills the cache for these frames). */
    async groundTruths(c: Partial<BenchConfig>, frames: number[], o: { refresh?: boolean } = {}) {
      const full = resolveConfig({ ...cfg, ...c });
      engine.setScene(full);
      const out = [];
      for (const f of frames) { const g = await engine.groundTruth(f, { refresh: o.refresh }); out.push({ f, key: g.key, cached: g.cached }); }
      return out;
    },
  };
  log(`ready: three r${engine.info.three}, ${W}×${H}, ${engine.info.triangles.toLocaleString()} triangles, ${cfg.sampler}-noise light samples; ground-truth cache ${engine.cacheAvailable ? 'on' : 'off (not the bench server)'}${q.has('manual') ? '; manual (headless)' : ''}`);
  if (!playing && !q.has('manual')) await freeze();
}

function row(...els: Node[]) { const r = document.createElement('div'); r.className = 'dn-row'; r.append(...els); return r; }
function span(t: string) { const s = document.createElement('span'); s.className = 'sb-muted'; s.textContent = t; return s; }
function debounce<A extends unknown[]>(fn: (...a: A) => void, ms = 250) { let t: ReturnType<typeof setTimeout> | undefined; return (...a: A) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

(q.has('report') ? reportMode(q.get('report') ?? '') : liveMode())
  .catch((e) => { log(`ERROR: ${(e as Error).stack ?? e}`); console.error(e); (window as unknown as { __error?: string }).__error = String(e); });
