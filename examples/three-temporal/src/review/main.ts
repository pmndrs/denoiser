// three-temporal/review: the review bench for the real-time denoisers (TASKS rule 12; results/REVIEW-BENCH.md).
//
// Two sides, A and B, each with its own denoiser configuration (realtimeDiffuseSpecular + realtimeOcclusion +
// realtimeShadows), on the same 1-ray inputs of one scene (src/review/scenes.ts). The controls, badges, presets and
// jumps all come from the option registry (src/review/options.ts). A side's configuration is its overrides only
// ({} = the shipped package defaults); changing one rebuilds only the nodes of that side whose options changed
// (options are structural), so the other side keeps its history.
//
// View modes switch by uniform (split / A / B / |A - B|: instant, so F blinks without a rebuild); the reference and
// raw views rebuild the output graph. The URL mirrors the state for sharing, but the page never needs it.
import * as THREE from 'three/webgpu';
import { float, vec3, vec4, uniform, screenCoordinate, renderOutput, select, acesFilmicToneMapping } from 'three/tsl';
import { realtimeDiffuse, realtimeDiffuseSpecular, realtimeOcclusion, realtimeShadows, realtimeSpecular } from 'denoiser/three';
import { mountShell } from '../../../_shared/shell';
import { type N, readTexture, nonFiniteCount } from '../realtime/scene';
import { buildKit, type Kit, type Parts } from './scenes';
import { DECISIONS, OPTIONS, SCENE_PATHS, type Decision, type Filter, type ReviewOption, type SceneId, type Signal, type Value, type View, type Where } from './options';
import * as C from './config';

mountShell({ id: 'three-temporal-review' });

type SideId = 'A' | 'B';
type NodeName = 'gi' | 'ao' | 'shadows';
interface GiSet { diffuse: N; specular: N; nodes: N[]; outTex(): THREE.Texture; resolved(): { diffuse?: N; specular?: N; filter?: string } }
interface Side { cfg: C.SideConfig; keys: Record<NodeName, string>; gi: GiSet; ao: N; shadows: N }

const q = new URLSearchParams(location.search);
const W = Number(q.get('w') ?? 960), H = Number(q.get('h') ?? 540);
const manual = q.has('manual');
const SCENES: SceneId[] = ['corner', 'knot', 'sponza', 'bistro'];
const SIGNALS: Signal[] = ['lit', 'diffuse', 'specular', 'ao', 'shadow'];
const VIEWS: View[] = ['split', 'A', 'B', 'diff', 'ref', 'noisy'];
const CMP_VIEWS: View[] = ['split', 'A', 'B', 'diff'];
const GROUPS: { filter: Filter; title: string }[] = [
  { filter: 'shadows', title: 'Shadows (ShadowDenoiser, signal "shadow" / "lit")' },
  { filter: 'svgf', title: 'SVGF / A-SVGF (the default filter: diffuse, specular, AO)' },
  { filter: 'occlusion', title: 'Occlusion (OcclusionDenoiser, signal "AO")' },
  { filter: 'recurrent', title: "Recurrent filter (opt-in: set the diffuse + specular filter to 'recurrent')" },
  { filter: 'sh', title: "SH payload (opt-in: set the diffuse payload to 'sh')" },
];

const statusEl = document.querySelector<HTMLPreElement>('#status')!;
const log = (m: string) => { statusEl.textContent = m; console.log('[review]', m); };
const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector<T>(s)!;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const pick = <T extends string>(v: string | null, list: readonly T[], d: T): T => (list.includes(v as T) ? v as T : d);

async function main() {
  // ---- state (URL mirror read once; defaults otherwise) ----------------------------------------------------------
  const sceneId = pick(q.get('scene'), SCENES, 'corner');
  const state = {
    signal: pick(q.get('signal'), SIGNALS, sceneId === 'knot' ? 'shadow' : 'lit'),
    view: pick(q.get('view'), VIEWS, 'split'),
    moving: q.get('moving') !== '0',
    split: Number(q.get('split') ?? 0.5),
    gainExp: Number(q.get('gain') ?? 4),
    show: 'all',
    note: q.get('note') ?? '',
  };
  const initial = { A: C.decodeSide(q.get('A')), B: C.decodeSide(q.get('B')) };

  const canvas = $<HTMLCanvasElement>('#view');
  canvas.width = W; canvas.height = H;
  if (!navigator.gpu) { log('WebGPU is not available in this browser.'); return; }
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: false } as N);
  await renderer.init();
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  const device = (renderer.backend as unknown as { device: GPUDevice }).device;
  const gpuErrors: string[] = [];
  device.addEventListener('uncapturederror', (e) => {
    const msg = (e as GPUUncapturedErrorEvent).error.message;
    gpuErrors.push(msg);
    console.error('[webgpu uncapturederror]', msg);
  });
  device.lost.then((i) => log(`DEVICE LOST: ${i.reason} ${i.message}`));

  const uFrame = uniform(0, 'uint');
  const kit: Kit = await buildKit(sceneId, W, H, uFrame, q.get('path') ?? (sceneId === 'knot' ? 'knot-static' : ''), log);
  const uSplit = uniform(state.split);
  const uView = uniform(0); // 0 split, 1 A, 2 B, 3 diff
  const uGain = uniform(2 ** state.gainExp);

  // ---- sides ---------------------------------------------------------------------------------------------------
  const buildGi = (cfg: C.SideConfig): GiSet => {
    const no = C.nodeOptions(cfg).gi;
    const { diffuse: dOpts, specular: sOpts, ...shared } = no;
    if (dOpts.payload === 'sh') {
      const d = realtimeDiffuse(kit.inputs.dif, { ...kit.guides, hitDistance: kit.inputs.difHit, direction: kit.direction(), detailNormal: kit.guides.normal, denoiser: { ...shared, ...dOpts } as N }) as N;
      const s = realtimeSpecular(kit.inputs.ssr, { ...kit.guides, roughness: kit.roughness, denoiser: { ...shared, ...sOpts } as N }) as N;
      return {
        diffuse: d, specular: s, nodes: [d, s], outTex: () => d.getOutputTexture(0),
        resolved: () => ({ diffuse: d.denoiser?.options, specular: s.denoiser?.options, filter: 'svgf' }),
      };
    }
    const n = realtimeDiffuseSpecular(
      { diffuse: { radiance: kit.inputs.dif, hitDistance: kit.inputs.difHit }, specular: { radiance: kit.inputs.ssr } },
      { ...kit.guides, roughness: kit.roughness, denoiser: no as N },
    ) as N;
    return {
      diffuse: n.diffuse, specular: n.specular, nodes: [n], outTex: () => n.getOutputTexture(0),
      resolved: () => ({ diffuse: n.denoiser?.options?.diffuse, specular: n.denoiser?.options?.specular, filter: n.denoiser?.filters?.diffuse }),
    };
  };
  const buildAo = (cfg: C.SideConfig) => realtimeOcclusion(kit.inputs.difHit, { ...kit.guides, denoiser: C.nodeOptions(cfg).ao as N }) as N;
  const buildShadows = (cfg: C.SideConfig) => realtimeShadows(kit.inputs.sh, { ...kit.guides, hitDistance: kit.inputs.shDist, light: kit.light, denoiser: C.nodeOptions(cfg).shadows as N }) as N;
  const makeSide = (cfg: C.SideConfig): Side => ({ cfg, keys: C.nodeKeys(cfg), gi: buildGi(cfg), ao: buildAo(cfg), shadows: buildShadows(cfg) });
  const sides: Record<SideId, Side> = { A: makeSide(initial.A), B: makeSide(initial.B) };
  const nodesOf = (s: Side): N[] => [...s.gi.nodes, s.ao, s.shadows];
  // old nodes are disposed a few frames after the graph stops using them
  const graveyard: { nodes: N[]; at: number }[] = [];
  let frame = 0;
  const feedSsr = () => { kit.ssrFeed.diffuse.value = sides.A.gi.outTex(); kit.ssrFeed.vis.value = sides.A.shadows.getOutputTexture(0); };
  feedSsr();

  /** Applies a new configuration to one side: rebuilds only the nodes whose options changed. */
  const setSide = (id: SideId, cfg: C.SideConfig) => {
    const s = sides[id];
    const keys = C.nodeKeys(cfg);
    const dead: N[] = [];
    if (keys.gi !== s.keys.gi) { dead.push(...s.gi.nodes); s.gi = buildGi(cfg); }
    if (keys.ao !== s.keys.ao) { dead.push(s.ao); s.ao = buildAo(cfg); }
    if (keys.shadows !== s.keys.shadows) { dead.push(s.shadows); s.shadows = buildShadows(cfg); }
    s.cfg = cfg; s.keys = keys;
    if (dead.length) { graveyard.push({ nodes: dead, at: frame + 4 }); buildOutput(); if (id === 'A') feedSsr(); }
    renderPanels(); mirror();
  };
  const setBoth = (p: C.Pair) => { setSide('A', p.A); setSide('B', p.B); };
  const swap = () => { const a = sides.A; sides.A = sides.B; sides.B = a; feedSsr(); buildOutput(); renderPanels(); mirror(); };
  const resetAll = () => { for (const s of [sides.A, sides.B]) for (const n of nodesOf(s)) n.resetHistory(); };

  // ---- output graph --------------------------------------------------------------------------------------------
  const pipeline = new THREE.RenderPipeline(renderer);
  pipeline.outputColorTransform = false;
  const partsOf = (s: Side): Parts => ({ dif: s.gi.diffuse.rgb, spec: s.gi.specular.rgb, ao: s.ao.r, vis: s.shadows.r });
  const tm = (sig: Signal, c: N): N => (sig === 'ao' || sig === 'shadow' ? c : acesFilmicToneMapping(c, float(1)));
  let graphKind: 'cmp' | 'ref' | 'noisy' = 'cmp';
  const buildOutput = () => {
    const sig = state.signal;
    graphKind = CMP_VIEWS.includes(state.view) ? 'cmp' : state.view === 'ref' ? 'ref' : 'noisy';
    // every denoiser of both sides stays in the graph (nodes outside it don't run): histories keep going in any view
    const keep = [sides.A, sides.B].flatMap((s) => [s.gi.diffuse.r, s.gi.specular.r, s.ao.r, s.shadows.r]).reduce((a: N, n: N) => a.add(n), float(0) as N).mul(0);
    let col: N;
    if (graphKind === 'cmp') {
      // .toVar(): evaluated once up front; used inside several selects, a tone-mapping Fn call was otherwise only
      // computed in the branch of its first use (black split view)
      const a = tm(sig, kit.color(sig, partsOf(sides.A), false)).toVar(), b = tm(sig, kit.color(sig, partsOf(sides.B), false)).toVar();
      const x = screenCoordinate.x, cut = uSplit.mul(W);
      const split = select(x.sub(cut).abs().lessThan(1), vec3(1, 1, 1), select(x.lessThan(cut), a, b));
      const diff = a.sub(b).abs().mul(uGain);
      col = select(uView.equal(1), a, select(uView.equal(2), b, select(uView.equal(3), diff, split)));
    } else if (graphKind === 'ref') col = tm(sig, kit.color(sig, kit.ref, true));
    else col = tm(sig, kit.color(sig, kit.noisy, false));
    pipeline.outputNode = renderOutput(vec4(col.add(vec3(keep)), 1), THREE.NoToneMapping, THREE.SRGBColorSpace) as N;
    pipeline.needsUpdate = true;
  };

  // ---- loop ----------------------------------------------------------------------------------------------------
  let job: { left: number; done: () => void } | null = null;
  const frames = (n: number) => new Promise<void>((res) => { job = { left: n, done: res }; });
  renderer.setAnimationLoop(() => {
    if (manual && !job) return;
    if (kit.advance(state.moving, state.view === 'ref')) resetAll();
    uFrame.value = frame;
    try { pipeline.render(); } catch (e) {
      // a denoiser that rejects an option combination throws while its node is set up: say so instead of dying
      const msg = `ERROR: ${(e as Error).message ?? e} (A: ${C.describe(sides.A.cfg)}; B: ${C.describe(sides.B.cfg)}). Reset or change the last option.`;
      if (statusEl.textContent !== msg) { log(msg); gpuErrors.push(msg); }
    }
    frame++;
    while (graveyard.length && graveyard[0].at <= frame) for (const n of graveyard.shift()!.nodes) n.dispose();
    if (job && --job.left === 0) { const d = job.done; job = null; d(); }
  });
  const idle = () => device.queue.onSubmittedWorkDone();

  // ---- view controls -------------------------------------------------------------------------------------------
  const press = (sel: string, v: string) => document.querySelectorAll<HTMLButtonElement>(`${sel} button`).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === v)));
  const tagA = $('#tag-a'), tagB = $('#tag-b');
  const paintTags = () => {
    const v = state.view;
    tagA.hidden = tagB.hidden = false;
    tagA.className = 'rv-tag a'; tagB.className = 'rv-tag b';
    if (v === 'split') { tagA.textContent = 'A'; tagB.textContent = 'B'; return; }
    tagB.hidden = true;
    tagA.className = 'rv-tag a big';
    tagA.textContent = v === 'A' ? 'A' : v === 'B' ? 'B' : v === 'diff' ? `|A − B| × ${2 ** state.gainExp}` : v === 'ref' ? 'reference' : 'raw';
    if (v === 'diff' || v === 'ref' || v === 'noisy') tagA.className = 'rv-tag a';
  };
  const setSignal = (s: Signal) => { state.signal = s; press('#seg-signal', s); buildOutput(); mirror(); };
  const setView = (v: View) => {
    const wasCmp = graphKind === 'cmp';
    state.view = v;
    if (v === 'ref') kit.resetRefs();
    uView.value = v === 'A' ? 1 : v === 'B' ? 2 : v === 'diff' ? 3 : 0;
    if (!(wasCmp && CMP_VIEWS.includes(v))) buildOutput();
    press('#seg-view', v); paintTags(); mirror();
  };
  const flip = () => setView(state.view === 'A' ? 'B' : 'A');
  const setMoving = (on: boolean) => { state.moving = on; press('#seg-motion', on ? 'on' : 'off'); mirror(); };
  const setSplit = (v: number) => { state.split = uSplit.value = Math.min(1, Math.max(0, v)); $<HTMLInputElement>('#split').value = String(state.split); };
  const setGain = (e: number) => { state.gainExp = e; uGain.value = 2 ** e; $<HTMLInputElement>('#gain').value = String(e); $('#gain-v').textContent = `× ${2 ** e}`; paintTags(); };
  const setPath = (p: string) => { kit.setPath(p); resetAll(); $<HTMLSelectElement>('#sel-path').value = p; mirror(); };
  let blinkTimer = 0;
  const setBlink = (on: boolean) => {
    clearInterval(blinkTimer);
    $<HTMLInputElement>('#chk-blink').checked = on;
    if (on) { if (state.view !== 'A' && state.view !== 'B') setView('A'); blinkTimer = window.setInterval(flip, 700); }
  };

  /** Goes to where an option / decision shows best (reloads only when the scene changes). */
  const jump = (w: Where | undefined) => {
    if (!w) return;
    state.note = w.note ?? (w.event === 'cut' ? 'press "camera cut" (K)' : w.event === 'colour' ? 'press "light colour" (C)' : w.event === 'brightness' ? 'press "light step" (L)' : '');
    if (w.scene !== kit.id) { reloadWith({ scene: w.scene, path: w.path ?? '', signal: w.signal, view: w.view ?? 'split', note: state.note }); return; }
    if ((w.path ?? '') !== kit.path) setPath(w.path ?? '');
    setSignal(w.signal);
    setView(w.view ?? (state.view === 'ref' || state.view === 'noisy' ? 'split' : state.view));
    paintCaption();
  };

  document.querySelectorAll<HTMLButtonElement>('#seg-scene button').forEach((b) => b.addEventListener('click', () => { if (b.dataset.v !== kit.id) reloadWith({ scene: b.dataset.v!, path: '', note: '' }); }));
  const pathSel = $<HTMLSelectElement>('#sel-path');
  pathSel.innerHTML = SCENE_PATHS[kit.id].map((p) => `<option value="${p.id}">${esc(p.label)}${p.id ? ` (${p.id})` : ''}</option>`).join('');
  pathSel.value = kit.path;
  pathSel.addEventListener('change', () => setPath(pathSel.value));
  document.querySelectorAll<HTMLButtonElement>('#seg-signal button').forEach((b) => b.addEventListener('click', () => setSignal(b.dataset.v as Signal)));
  document.querySelectorAll<HTMLButtonElement>('#seg-view button').forEach((b) => b.addEventListener('click', () => { setBlink(false); setView(b.dataset.v as View); }));
  document.querySelectorAll<HTMLButtonElement>('#seg-motion button').forEach((b) => b.addEventListener('click', () => setMoving(b.dataset.v === 'on')));
  $('#split').addEventListener('input', (e) => setSplit(parseFloat((e.target as HTMLInputElement).value)));
  $('#gain').addEventListener('input', (e) => setGain(parseInt((e.target as HTMLInputElement).value, 10)));
  $('#btn-cut').addEventListener('click', () => { kit.cut(); resetAll(); });
  const colourBtn = $<HTMLButtonElement>('#btn-colour');
  colourBtn.disabled = !kit.events.colour;
  colourBtn.title = kit.events.colour ? 'C: the lights change hue at the same luminance (toggle)' : 'Sponza / Bistro only (the corner panel is white)';
  colourBtn.addEventListener('click', () => kit.events.colour?.());
  $('#btn-bright').addEventListener('click', () => kit.events.brightness());
  $('#btn-reset').addEventListener('click', resetAll);
  $('#chk-blink').addEventListener('change', (e) => setBlink((e.target as HTMLInputElement).checked));
  if (kit.controls) { const host = $('#rv-scene-controls'); host.innerHTML = kit.controls.html; kit.controls.wire(host); }
  const dragTo = (e: PointerEvent) => { const r = canvas.getBoundingClientRect(); setSplit((e.clientX - r.left) / r.width); };
  canvas.addEventListener('pointerdown', (e) => { if (state.view !== 'split') return; canvas.setPointerCapture(e.pointerId); dragTo(e); });
  canvas.addEventListener('pointermove', (e) => { if (state.view === 'split' && (e.buttons & 1)) dragTo(e); });
  addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement;
    if (t instanceof HTMLInputElement || t instanceof HTMLSelectElement || t instanceof HTMLTextAreaElement || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    const act: Record<string, () => void> = {
      f: () => { setBlink(false); flip(); }, x: swap, s: () => { setBlink(false); setView('split'); }, d: () => { setBlink(false); setView('diff'); },
      r: () => { setBlink(false); setView('ref'); }, n: () => { setBlink(false); setView('noisy'); }, ' ': () => setMoving(!state.moving),
      k: () => { kit.cut(); resetAll(); }, c: () => kit.events.colour?.(), l: () => kit.events.brightness(), '0': resetAll,
      arrowleft: () => setSplit(state.split - 0.05), arrowright: () => setSplit(state.split + 0.05), b: () => setBlink(!$<HTMLInputElement>('#chk-blink').checked),
    };
    if (act[k]) { act[k](); e.preventDefault(); }
  });

  // ---- live package defaults -------------------------------------------------------------------------------------
  /** The value the package resolved for option `o` on side `s` (undefined until its denoiser exists). */
  const liveValue = (s: Side, o: ReviewOption): Value | undefined => {
    const t = o.targets[0];
    if (t === 'shadows') return s.shadows.denoiser?.options?.[o.key];
    if (t === 'ao') {
      const r = s.ao.denoiser?.options;
      if (!r) return undefined;
      return o.key === 'filter' ? r.filter : r.o?.[o.key];
    }
    const r = s.gi.resolved();
    if (o.key === 'filter') return r.filter;
    const sig = t === 'gi.specular' ? r.specular : r.diffuse;
    if (!sig) return undefined;
    if (o.key === 'payload' && sig.payload === undefined) return 'radiance'; // recurrent: no payload key
    return sig[o.key];
  };
  const same = (a: Value | undefined, b: Value | undefined) => a === b || (typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) < 1e-6);
  /** The package default as resolved on a side that doesn't override it (and where it applies). */
  const liveDefault = (o: ReviewOption): Value | undefined => {
    for (const s of [sides.A, sides.B]) {
      if (o.id in s.cfg || C.inapplicable(o, s.cfg)) continue;
      const v = liveValue(s, o);
      if (v !== undefined) return v;
    }
    return undefined;
  };

  // ---- panels ----------------------------------------------------------------------------------------------------
  const dates = C.changeDates();
  const sidePresetOptions = () => [
    '<option value="">preset...</option>',
    '<option value="shipped">shipped defaults (no overrides)</option>',
    ...dates.map((d) => `<option value="before:${d.on}">defaults before ${d.on} (${d.by.join(', ')})</option>`),
    '<option value="copy">copy the other side</option>',
  ].join('');
  const sideMs = (s: Side) => {
    const ms = (n: N) => n?.denoiser?.gpuTimings?.get('total') as number | undefined;
    const parts: [string, number | undefined][] = [['gi', s.gi.nodes.reduce((a: number | undefined, n: N) => (ms(n) === undefined ? a : (a ?? 0) + ms(n)!), undefined)], ['ao', ms(s.ao)], ['shadows', ms(s.shadows)]];
    const known = parts.filter(([, v]) => v !== undefined) as [string, number][];
    if (!known.length) return 'GPU ms: n/a (no timestamp queries yet)';
    return `${known.map(([k, v]) => `${k} ${v.toFixed(2)}`).join(' + ')} = ${known.reduce((a, [, v]) => a + v, 0).toFixed(2)} ms`;
  };
  const renderSideHeads = () => {
    for (const id of ['A', 'B'] as SideId[]) {
      const el = $(`#side-${id}`);
      el.innerHTML = `<div class="row"><b>Side ${id}</b> <span class="hint">${id === 'A' ? 'left of the divider' : 'right of the divider'}</span></div>
        <div class="row"><select data-preset="${id}">${sidePresetOptions()}</select><button class="dn-btn small" data-reset="${id}">reset to defaults</button></div>
        <div class="sum" data-sum="${id}">${esc(C.describe(sides[id].cfg))}</div>
        <div class="row">GPU: <b class="ms" data-ms="${id}">...</b></div>`;
    }
  };
  const optionRow = (o: ReviewOption) => {
    const live = liveDefault(o);
    const mismatch = live !== undefined && !same(live, o.default);
    const cell = (id: SideId) => {
      const s = sides[id];
      const why = C.inapplicable(o, s.cfg);
      const over = o.id in s.cfg;
      const lv = over ? undefined : liveValue(s, o);
      const val = over ? s.cfg[o.id] : lv !== undefined && o.values.some((v) => same(v, lv)) ? o.values.find((v) => same(v, lv))! : o.default;
      const dis = why ? ' disabled' : '';
      const isBool = o.values.length === 2 && o.values.includes(false) && o.values.includes(true);
      const ctl = isBool
        ? `<label><input type="checkbox" data-side="${id}" data-opt="${o.id}"${val === true ? ' checked' : ''}${dis} /> ${val ? 'true' : 'false'}</label>`
        : `<select data-side="${id}" data-opt="${o.id}"${dis}>${o.values.map((v, i) => `<option value="${i}"${same(v, val) ? ' selected' : ''}>${esc(C.valueLabel(o, v))}${same(v, o.default) ? ' (default)' : ''}</option>`).join('')}</select>`;
      const clear = over ? ` <button class="jump" title="back to the package default" data-clear="${id}" data-opt="${o.id}">↺</button>` : '';
      return `<td class="ab${over ? ' override' : ''}">${ctl}${clear}${why ? `<span class="na">${esc(why)}</span>` : ''}</td>`;
    };
    const differ = !same(C.valueOf(sides.A.cfg, o.id), C.valueOf(sides.B.cfg, o.id));
    const badges = [
      o.decision ? `<span class="badge q" data-decision="${o.decision}" title="decision ${o.decision}: load its flip test">${o.decision}</span>` : '',
      ...(o.related ?? []).map((r) => `<span class="badge q" data-decision="${r}" title="related decision ${r}">${r}</span>`),
      `<span class="badge ${o.status}">${o.status}</span>`,
      o.tuning ? '<span class="badge">tuning</span>' : '',
    ].join('');
    const targets = o.targets.map((t) => ({ gi: 'diffuse+specular', 'gi.diffuse': 'diffuse', 'gi.specular': 'specular', ao: 'AO', shadows: 'shadows' }[t])).join(', ');
    const w = o.where;
    const whereTxt = `${w.scene}${w.path ? ` / ${w.path}` : ''} / ${w.signal}${w.view ? ` / ${w.view}` : ''}`;
    return `<tr class="${differ ? 'differ' : ''}"><td class="key"><code>${esc(o.key)}</code>${badges}<span class="na">${esc(targets)}</span></td>${cell('A')}${cell('B')}
      <td>${esc(C.valueLabel(o, o.default))}${mismatch ? `<span class="warn" title="the registry expects ${esc(C.valueLabel(o, o.default))}; the package resolved ${esc(C.valueLabel(o, live!))}">package: ${esc(C.valueLabel(o, live!))}</span>` : ''}</td>
      <td class="look">${esc(o.look)} <button class="jump" data-where="${o.id}" title="${esc(whereTxt)}">show me</button>${o.benchNote ? `<span class="note">${esc(o.benchNote)}</span>` : ''}</td></tr>`;
  };
  const visible = (o: ReviewOption) => {
    if (state.show === 'differ') return !same(C.valueOf(sides.A.cfg, o.id), C.valueOf(sides.B.cfg, o.id));
    if (state.show === 'decided') return !!o.decision;
    if (state.show === 'live') return !C.inapplicable(o, sides.A.cfg) || !C.inapplicable(o, sides.B.cfg);
    return true;
  };
  const renderTable = () => {
    const rows = GROUPS.map((g) => {
      const os = OPTIONS.filter((o) => o.filter === g.filter && visible(o));
      return os.length ? `<tr class="group"><td colspan="5">${esc(g.title)}</td></tr>${os.map(optionRow).join('')}` : '';
    }).join('');
    $('#rv-table').innerHTML = `<colgroup><col class="c-opt"><col class="c-ab"><col class="c-ab"><col class="c-def"><col class="c-look"></colgroup><thead><tr><th>option</th><th>A</th><th>B</th><th>registry default</th><th class="look">what to look for</th></tr></thead><tbody>${rows || '<tr><td colspan="5" class="hint">nothing to show</td></tr>'}</tbody>`;
  };
  const decisionBadgeWhere = (d: Decision) => { const w = C.decisionWhere(d); return w ? `${w.scene}${w.path ? ` / ${w.path}` : ''} / ${w.signal}` : ''; };
  const renderCards = () => {
    $('#rv-cards').innerHTML = DECISIONS.filter((d) => d.highlight).map((d) => {
      const opts = C.decisionOptions(d);
      const toggles = opts.length > 1 || d.base ? `<div class="rv-opts"><span class="hint">B:</span>${opts.map(({ o, on, off }) => {
        const cur = C.valueOf(sides.B.cfg, o.id);
        return `<label><input type="checkbox" data-card-opt="${o.id}" data-on='${JSON.stringify(on)}' data-off='${JSON.stringify(off)}'${same(cur, on) ? ' checked' : ''} /> ${esc(o.key)} ${esc(C.valueLabel(o, on))}</label>`;
      }).join('')}</div>` : '';
      return `<div class="rv-card"><h3>${d.id}: ${esc(d.title)}</h3><p class="answer">Dennis: ${esc(d.answer)}</p>
        <p>${esc(d.look ?? opts.map(({ o }) => o.look).join(' '))}</p>
        <div class="rv-btns"><button class="dn-btn" data-load="${d.id}">Load the flip test (A = without, B = with)</button>
        ${[C.decisionWhere(d), ...(d.alsoAt ?? [])].filter(Boolean).map((w, i) => `<button class="dn-btn small" data-card-where="${d.id}:${i}" title="${esc(w!.note ?? '')}">${i ? 'also: ' : 'at: '}${esc(`${w!.scene}${w!.path ? ' / ' + w!.path : ''} / ${w!.signal}`)}</button>`).join('')}</div>
        ${toggles}</div>`;
    }).join('');
  };
  const renderDecisions = () => {
    $<HTMLSelectElement>('#sel-decision').innerHTML = '<option value="">choose...</option>' + C.PRESET_DECISIONS.map((d) => `<option value="${d.id}">${d.id}: ${esc(d.title)}</option>`).join('');
    $('#rv-decisions').innerHTML = `<thead><tr><th>id</th><th>decision</th><th>Dennis's answer</th><th>options</th><th></th></tr></thead><tbody>${DECISIONS.map((d) => {
      const opts = C.decisionOptions(d);
      return `<tr><td><b>${d.id}</b>${d.highlight ? ' <span class="badge open">flip test</span>' : ''}</td><td>${esc(d.title)}</td><td class="hint">${esc(d.answer)}</td>
        <td>${opts.map(({ o, off, on }) => `<code>${esc(o.key)}</code> ${esc(C.valueLabel(o, off))} → ${esc(C.valueLabel(o, on))}`).join('<br>')}</td>
        <td>${opts.length ? `<button class="dn-btn small" data-load="${d.id}" title="${esc(decisionBadgeWhere(d))}">load A / B</button>` : ''}</td></tr>`;
    }).join('')}</tbody>`;
  };
  const renderPanels = () => {
    renderTable(); renderCards();
    for (const id of ['A', 'B'] as SideId[]) { const el = document.querySelector(`[data-sum="${id}"]`); if (el) el.textContent = C.describe(sides[id].cfg); }
    paintCaption();
  };
  const loadDecision = (id: string, whereIdx = 0) => {
    const d = C.decisionById.get(id);
    if (!d) return;
    const p = C.decisionPreset(d);
    const w = [C.decisionWhere(d), ...(d.alsoAt ?? [])][whereIdx];
    if (w && w.scene !== kit.id) { reloadWith({ scene: w.scene, path: w.path ?? '', signal: w.signal, view: w.view ?? 'split', A: C.encodeSide(p.A), B: C.encodeSide(p.B), note: w.note ?? '' }); return; }
    setBoth(p);
    jump(w);
  };

  // delegated events on the panels
  document.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.dataset.opt && t.dataset.side) {
      const o = C.optionById.get(t.dataset.opt)!;
      const v: Value = t.type === 'checkbox' ? t.checked : o.values[Number(t.value)];
      const id = t.dataset.side as SideId;
      setSide(id, { ...sides[id].cfg, [o.id]: v });
    } else if (t.dataset.preset) {
      const id = t.dataset.preset as SideId, v = t.value;
      t.value = '';
      if (v === 'shipped') setSide(id, {});
      else if (v === 'copy') setSide(id, { ...sides[id === 'A' ? 'B' : 'A'].cfg });
      else if (v.startsWith('before:')) setSide(id, C.defaultsBefore(v.slice(7)));
    } else if (t.dataset.cardOpt) {
      const o = C.optionById.get(t.dataset.cardOpt)!;
      setSide('B', { ...sides.B.cfg, [o.id]: JSON.parse(t.checked ? t.dataset.on! : t.dataset.off!) });
    } else if (t.id === 'sel-show') { state.show = t.value; renderTable(); }
    else if (t.id === 'sel-decision' && t.value) { const v = t.value; t.value = ''; loadDecision(v); }
  });
  document.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-reset],[data-clear],[data-where],[data-decision],[data-load],[data-card-where]');
    if (!t) return;
    if (t.dataset.reset) setSide(t.dataset.reset as SideId, {});
    else if (t.dataset.clear) { const id = t.dataset.clear as SideId; const c = { ...sides[id].cfg }; delete c[t.dataset.opt!]; setSide(id, c); }
    else if (t.dataset.where) jump(C.optionById.get(t.dataset.where)?.where);
    else if (t.dataset.decision || t.dataset.load) loadDecision((t.dataset.decision ?? t.dataset.load)!);
    else if (t.dataset.cardWhere) { const [id, i] = t.dataset.cardWhere.split(':'); loadDecision(id, Number(i)); }
  });

  // ---- caption, URL mirror -------------------------------------------------------------------------------------
  const cap = $('#cap-view'), costEl = $('#cap-cost');
  const paintCaption = () => {
    const v = state.view;
    const a = `A: ${C.describe(sides.A.cfg)}`, b = `B: ${C.describe(sides.B.cfg)}`;
    const what = v === 'split' ? `${a} | ${b}` : v === 'A' ? a : v === 'B' ? b : v === 'diff' ? `|A − B| × ${2 ** state.gainExp} (${a}; ${b})`
      : v === 'ref' ? `reference: ${kit.refFrames()} frames accumulated (camera held still)` : 'raw 1-ray signals';
    cap.textContent = `${kit.label} · ${kit.path || 'free'} · ${state.signal} · ${what}${state.note ? ` · ${state.note}` : ''}`;
  };
  const stateParams = (o: Record<string, string> = {}) => {
    const p = new URLSearchParams();
    for (const k of ['w', 'h', 'manual']) if (q.has(k)) p.set(k, q.get(k)!);
    const base: Record<string, string> = {
      scene: kit.id, path: kit.path, signal: state.signal, view: state.view, moving: state.moving ? '1' : '0',
      split: String(+state.split.toFixed(3)), gain: String(state.gainExp), A: C.encodeSide(sides.A.cfg), B: C.encodeSide(sides.B.cfg),
    };
    for (const [k, v] of Object.entries({ ...base, ...o })) if (v !== '') p.set(k, v);
    return p;
  };
  const mirror = () => { try { history.replaceState(null, '', `${location.pathname}?${stateParams()}`); } catch { /* sandboxed */ } };
  const reloadWith = (o: Record<string, string>) => { location.href = `${location.pathname}?${stateParams(o)}`; };

  renderSideHeads();
  renderDecisions();
  renderPanels();
  press('#seg-scene', kit.id); press('#seg-signal', state.signal); press('#seg-motion', state.moving ? 'on' : 'off');
  setSplit(state.split); setGain(state.gainExp);
  setView(state.view);
  buildOutput();
  mirror();
  let lastLive = '';
  setInterval(() => {
    for (const id of ['A', 'B'] as SideId[]) { const el = document.querySelector(`[data-ms="${id}"]`); if (el) el.textContent = sideMs(sides[id]); }
    costEl.textContent = `A ${sideMs(sides.A).replace(/^.*= /, '')} · B ${sideMs(sides.B).replace(/^.*= /, '')} at ${W}x${H}`;
    paintCaption();
    // the live defaults appear once the denoisers exist: re-render when they change (mismatch badges, control values)
    const live = OPTIONS.map((o) => `${liveDefault(o)}|${liveValue(sides.A, o)}|${liveValue(sides.B, o)}`).join(',');
    if (live !== lastLive) { lastLive = live; renderTable(); }
  }, 500);

  // ---- test hooks (run-realtime.mjs review) ----------------------------------------------------------------------
  const copyCanvas = document.createElement('canvas');
  copyCanvas.width = W; copyCanvas.height = H;
  const cctx = copyCanvas.getContext('2d')!;
  const api = {
    ready: true,
    gpuErrors,
    info: { three: THREE.REVISION, w: W, h: H, ...kit.info, path: kit.path, options: OPTIONS.length, decisions: DECISIONS.length },
    get frame() { return frame; },
    async step(n: number) { await frames(n); await idle(); },
    setModes(m: { signal?: Signal; view?: View; moving?: boolean; split?: number; path?: string; gain?: number }) {
      if (m.path !== undefined) setPath(m.path);
      if (m.signal) setSignal(m.signal);
      if (m.view) setView(m.view);
      if (m.moving !== undefined) setMoving(m.moving);
      if (m.split !== undefined) setSplit(m.split);
      if (m.gain !== undefined) setGain(m.gain);
    },
    /** Sets one option on one side (undefined clears it), like the table's controls. */
    setOption(side: SideId, id: string, value: Value | undefined) {
      if (!C.optionById.has(id)) throw new Error(`unknown option ${id}`);
      const c = { ...sides[side].cfg };
      if (value === undefined) delete c[id]; else c[id] = value;
      setSide(side, c);
    },
    /** Loads a decision's flip test; `stay` keeps the scene / path / signal (no jump, no reload). */
    loadDecision(id: string, stay = false) {
      const d = C.decisionById.get(id);
      if (!d) throw new Error(`unknown decision ${id}`);
      if (stay) setBoth(C.decisionPreset(d)); else loadDecision(id);
    },
    swap,
    flip,
    reset: resetAll,
    state: () => ({ scene: kit.id, path: kit.path, ...state, A: sides.A.cfg, B: sides.B.cfg, keys: { A: sides.A.keys, B: sides.B.keys } }),
    /** Registry defaults vs what the package resolved (only options that apply and are not overridden on some side). */
    liveDefaults() {
      return OPTIONS.map((o) => ({ id: o.id, registry: o.default, live: liveDefault(o) ?? null })).filter((r) => r.live !== null && !same(r.live, r.registry));
    },
    async capture(): Promise<string> {
      await frames(1);
      cctx.drawImage(canvas, 0, 0);
      await idle();
      return copyCanvas.toDataURL('image/png');
    },
    /** Non-finite values in every output of both sides. */
    async finiteCheck() {
      const r: Record<string, { w: number; h: number; bad: number }> = {};
      for (const id of ['A', 'B'] as SideId[]) {
        const s = sides[id];
        const outs: [string, THREE.Texture][] = [
          ['diffuse', s.gi.outTex()], ['specular', s.gi.nodes.length > 1 ? s.gi.nodes[1].getOutputTexture(0) : s.gi.nodes[0].getOutputTexture(1)],
          ['ao', s.ao.getOutputTexture(0)], ['shadows', s.shadows.getOutputTexture(0)],
        ];
        for (const [k, tx] of outs) { const { w, h, data } = await readTexture(renderer, tx); r[`${id}.${k}`] = { w, h, bad: nonFiniteCount(data) }; }
      }
      return r;
    },
    /** Mean |A - B| of the displayed images' channels over the frame (readback of the canvas in the A and B views). */
    async abDifference() {
      // drawn in the frame callback that rendered it (after an await the canvas may already be presented and cleared)
      const grab = async (v: View) => { setView(v); await frames(2); await frames(1); cctx.drawImage(canvas, 0, 0); const d = cctx.getImageData(0, 0, W, H).data; await idle(); return d; };
      const v0 = state.view;
      const a = await grab('A'), b = await grab('B');
      setView(v0);
      let s = 0;
      for (let i = 0; i < a.length; i += 4) s += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
      return s / (W * H * 3);
    },
  };
  (window as unknown as { __t: typeof api }).__t = api;
  log(`ready - three r${THREE.REVISION}, ${W}x${H}${manual ? ' (manual stepping)' : ''}; ${kit.label}; ${OPTIONS.length} options, ${DECISIONS.length} decisions in the registry`);
}

main().catch((e) => { log(`ERROR: ${(e as Error).stack ?? e}`); console.error(e); (window as unknown as { __error?: string }).__error = String(e); });
