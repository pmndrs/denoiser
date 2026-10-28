// Shadow bench report: one run's tables and an image viewer (flip between ground truth / raw / variants with keys,
// lit / mask / error / boil map, click to zoom, play the kept frames), and the list of saved runs.
// Used live after a run and by shadow-bench.html?report=<id> (no WebGPU needed).
import type { RunResult } from './run';
import { REGIONS, SPLIT_REGIONS, type RegionId } from './metrics';
import { cameraOf } from './config';

const f4 = (v: number | undefined | null, d = 4) => (v === undefined || v === null || !Number.isFinite(v) ? '–' : v.toFixed(d));
const pct = (v: number | undefined) => (v === undefined || !Number.isFinite(v) ? '–' : `${(v * 100).toFixed(1)} %`);
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

type Col = { label: string; title: string; get: (s: RunResult['summary'][string], k: string, run: RunResult) => number | undefined | null; fmt?: (v: number | undefined) => string; abs?: boolean; floor?: boolean };

/** The summary columns: is the shadow solid (umbra), is it right (rmse), is it calm (boil), what does it cost. */
const COLS: Col[] = [
  { label: 'umbra RMSE', title: 'RMS error where the true shadow is dark (g <= 0.02)', get: (s) => s.umbra?.rmse },
  { label: 'umbra bias', title: 'mean signed error in the umbra: > 0 = the shadow is greyer than the truth (not solid)', get: (s) => s.umbra?.bias, abs: true },
  { label: 'umbra off', title: 'fraction of umbra pixels off by more than 0.05', get: (s) => s.umbra?.bad, fmt: pct },
  { label: 'penumbra RMSE', title: '0.02 < g < 0.98', get: (s) => s.penumbra?.rmse },
  { label: 'all RMSE', title: 'every static receiver (the moving knot excluded)', get: (s) => s.all?.rmse },
  { label: 'boil umbra', title: 'per-pixel boil (RMS 2nd temporal difference / sqrt 6) in the umbra', get: (s) => s.umbra?.boil, floor: true },
  { label: 'boil pen.', title: 'per-pixel boil in the penumbra', get: (s) => s.penumbra?.boil, floor: true },
  { label: 'blotch umbra', title: 'low-frequency boil (boil after a Gaussian blur): the blotches the eye reads as boiling, umbra', get: (s) => s.umbra?.boilLow, floor: true },
  { label: 'blotch pen.', title: 'low-frequency boil, penumbra', get: (s) => s.penumbra?.boilLow, floor: true },
  { label: 'blotch moving', title: 'low-frequency boil where the shadow moved within the burst (penumbra.moving)', get: (s) => s['penumbra.moving']?.boilLow, floor: true },
  { label: 'tErr', title: 'RMS of the frame-to-frame change the true motion does not explain (boil + lag), static receivers', get: (s) => s.all?.tErr, floor: true },
  { label: 'flicker ≥2', title: 'share of static receivers whose displayed brightness changes by >= 2 of 255 levels between frames (sparse strong flicker; the RMS columns dilute it)', get: (s) => s.all?.flick2, fmt: (v) => (v === undefined || !Number.isFinite(v) ? '–' : `${(v * 100).toFixed(2)} %`), floor: true },
  { label: 'flicker ≥4', title: 'the same at >= 4 levels', get: (s) => s.all?.flick4, fmt: (v) => (v === undefined || !Number.isFinite(v) ? '–' : `${(v * 100).toFixed(3)} %`), floor: true },
  { label: 'knot RMSE', title: "the moving knot's own surface (scored apart from the static receivers)", get: (s) => s.object?.rmse },
  { label: 'GPU ms', title: 'median total GPU time of the denoiser', get: (_s, k, run) => run.gpuMs[k], fmt: (v) => f4(v, 3) },
];

function summaryTable(run: RunResult): string {
  const rows = [...run.images, 'gt'];
  const variants = run.variants.map((v) => v.id);
  const best = COLS.map((c) => {
    const vals = variants.map((k) => c.get(run.summary[k] ?? {}, k, run)).map((v) => (v === undefined || v === null ? NaN : c.abs ? Math.abs(v) : v));
    const m = Math.min(...vals.filter(Number.isFinite));
    return variants.filter((_, i) => vals[i] === m);
  });
  const label = (k: string) => k === 'gt' ? 'ground truth (floor)' : k === 'noisy' ? '1 ray, raw' : `${esc(k)}${run.variants.find((v) => v.id === k)?.label ? ` <span class="sb-muted">${esc(run.variants.find((v) => v.id === k)!.label!)}</span>` : ''}`;
  return `<table class="sb-table"><thead><tr><th></th>${COLS.map((c) => `<th title="${esc(c.title)}">${c.label}</th>`).join('')}</tr></thead><tbody>${rows.map((k) => `<tr class="${k === 'gt' ? 'sb-floor' : k === 'noisy' ? 'sb-noisy' : ''}"><th>${label(k)}</th>${COLS.map((c, i) => {
    if (k === 'gt' && !c.floor) return '<td></td>';
    const v = c.get(run.summary[k] ?? {}, k, run) ?? undefined;
    return `<td class="${best[i].includes(k) ? 'sb-best' : ''}">${(c.fmt ?? f4)(v)}</td>`;
  }).join('')}</tr>`).join('')}</tbody></table>`;
}

function regionTable(run: RunResult): string {
  const regions: RegionId[] = [...REGIONS, ...SPLIT_REGIONS];
  const keys = [...run.images, 'gt'];
  const n = (r: RegionId) => { const c = run.perCheckpoint[run.checkpoints[0]]; return c?.[run.images[0]]?.[r]?.n ?? 0; };
  return `<table class="sb-table sb-small"><thead><tr><th>region (px at the 1st checkpoint)</th><th>image</th><th>RMSE</th><th>bias</th><th>off &gt; 0.05</th><th>boil</th><th>blotch</th><th>tErr</th></tr></thead><tbody>${regions.map((r) => keys.map((k, i) => {
    const s = run.summary[k]?.[r] ?? {};
    return `<tr${i === 0 ? ' class="sb-sep"' : ''}>${i === 0 ? `<th rowspan="${keys.length}">${r} <span class="sb-muted">${n(r).toLocaleString()}</span></th>` : ''}<td>${esc(k)}</td><td>${f4(s.rmse)}</td><td>${f4(s.bias)}</td><td>${pct(s.bad)}</td><td>${f4(s.boil)}</td><td>${f4(s.boilLow)}</td><td>${f4(s.tErr)}</td></tr>`;
  }).join('')).join('')}</tbody></table>`;
}

function checkpointTable(run: RunResult): string {
  const vs = run.images;
  return `<table class="sb-table sb-small"><thead><tr><th>checkpoint</th>${vs.map((k) => `<th colspan="3">${esc(k)}</th>`).join('')}</tr><tr><th></th>${vs.map(() => '<th>umbra RMSE</th><th>umbra bias</th><th>blotch pen.</th>').join('')}</tr></thead><tbody>${run.checkpoints.map((c) => `<tr><th>${c}</th>${vs.map((k) => {
    const s = run.perCheckpoint[c]?.[k] ?? {};
    return `<td>${f4(s.umbra?.rmse)}</td><td>${f4(s.umbra?.bias)}</td><td>${f4(s.penumbra?.boilLow)}</td>`;
  }).join('')}</tr>`).join('')}</tbody></table>`;
}

export function configLine(run: RunResult): string {
  const c = run.config;
  const cam = cameraOf(c);
  return [
    `${c.w}×${c.h}`, `camera ${c.camera} (${cam.position.join(', ')} → ${cam.target.join(', ')})`,
    `knot ${c.knotStart} + ${c.knotRate.toFixed(5)} rad/frame`, `light half ${c.lightHalf}`, `${c.sampler} noise`,
    `warmup ${c.warmup}, step ${c.step}, ${c.count} checkpoints, burst ${c.burst}`, `ground truth ${c.gtGrid ** 2} rays/px`, `blotch σ ${c.blurSigma} px`,
  ].join(' · ');
}

/** Renders `run` into `el`. `url(name)` = URL of a run file; `keyActive` gates the viewer's keys (default: always). */
export function renderReport(el: HTMLElement, run: RunResult, url: (name: string) => string, o: { keyActive?: () => boolean } = {}) {
  const ids = ['gt', ...run.images];
  const has = (f: number, k: string, m: string) => run.files.includes(`f${String(f).padStart(4, '0')}/${k}-${m}.png`);
  const imgFrames = run.kept.filter((f) => has(f, 'gt', 'mask'));
  const opts = run.variants.map((v) => `<li><b>${esc(v.id)}</b> (${v.kind}) ${esc(JSON.stringify(v.options ?? {}))}</li>`).join('');
  el.innerHTML = `
    <div class="sb-report">
      <h2>Run <code>${esc(run.id)}</code></h2>
      <p class="sb-muted">${esc(configLine(run))}<br>${run.git ? `commit ${run.git.commit}${run.git.dirty ? ' (dirty)' : ''} · ` : ''}ground truths: ${run.gtStats.computed} computed, ${run.gtStats.cached} cached (${(run.gtStats.ms / 1000).toFixed(1)} s) · run ${(run.wallMs / 1000).toFixed(1)} s · ${esc(run.created)}</p>
      <ul class="sb-variants">${opts}</ul>
      <h3>Summary <span class="sb-muted">(means over the checkpoints; best denoiser per column in green; hover a header for its definition)</span></h3>
      ${summaryTable(run)}
      <details><summary>Every region</summary>${regionTable(run)}</details>
      <details><summary>Per checkpoint</summary>${checkpointTable(run)}</details>
      ${imgFrames.length ? `
      <h3>Images</h3>
      <div class="sb-viewer-bar">
        <div class="dn-seg sb-img">${ids.map((k, i) => `<button data-v="${esc(k)}" title="key ${i + 1}">${i + 1} ${esc(k)}</button>`).join('')}</div>
        <div class="dn-seg sb-mode"><button data-v="lit" title="key l">lit</button><button data-v="mask" title="key m">mask</button><button data-v="err" title="key e">error</button><button data-v="boil" title="key b">boil map</button><button data-v="flicker" title="key f">flicker map</button></div>
        <select class="sb-frame">${imgFrames.map((f) => `<option value="${f}">frame ${f}</option>`).join('')}</select>
        <button class="dn-btn sb-play" title="key space">play</button>
        <span class="sb-muted">keys: 1-${ids.length} image · l m e b f mode · ← → frame · click to zoom</span>
      </div>
      <div class="sb-viewer"><img alt="" /><span class="sb-tag"></span></div>` : '<p class="sb-muted">No images in this run (config.images).</p>'}
    </div>`;
  if (!imgFrames.length) return () => {};
  const img = el.querySelector<HTMLImageElement>('.sb-viewer img')!;
  const tag = el.querySelector<HTMLSpanElement>('.sb-tag')!;
  const viewer = el.querySelector<HTMLDivElement>('.sb-viewer')!;
  const frameSel = el.querySelector<HTMLSelectElement>('.sb-frame')!;
  const state = { k: run.variants.find((v) => v.kind === 'ours')?.id ?? ids[0], mode: 'lit', fi: imgFrames.length - 1, zoom: false };
  const fileOf = () => {
    if (state.mode === 'boil') return state.k === 'gt' ? null : `boil-${state.k}.png`;
    if (state.mode === 'flicker') return run.files.includes(`flicker-${state.k}.png`) ? `flicker-${state.k}.png` : null;
    const m = state.mode === 'err' && state.k === 'gt' ? 'mask' : state.mode;
    return `f${String(imgFrames[state.fi]).padStart(4, '0')}/${state.k}-${m}.png`;
  };
  const preload = () => { for (const k of ids) for (const m of ['lit', 'mask', 'err']) if (has(imgFrames[state.fi], k, m)) new Image().src = url(`f${String(imgFrames[state.fi]).padStart(4, '0')}/${k}-${m}.png`); };
  const show = () => {
    const f = fileOf();
    if (f) img.src = url(f);
    tag.textContent = `${state.k} · ${state.mode}${state.mode === 'boil' ? ' (std of error over the kept frames, ×10)' : state.mode === 'flicker' ? ' (largest frame-to-frame change of the displayed image, ×40)' : ` · frame ${imgFrames[state.fi]}`}`;
    el.querySelectorAll<HTMLButtonElement>('.sb-img button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === state.k)));
    el.querySelectorAll<HTMLButtonElement>('.sb-mode button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === state.mode)));
    frameSel.value = String(imgFrames[state.fi]);
  };
  el.querySelectorAll<HTMLButtonElement>('.sb-img button').forEach((b) => b.addEventListener('click', () => { state.k = b.dataset.v!; show(); }));
  el.querySelectorAll<HTMLButtonElement>('.sb-mode button').forEach((b) => b.addEventListener('click', () => { state.mode = b.dataset.v!; show(); }));
  frameSel.addEventListener('change', () => { state.fi = imgFrames.indexOf(Number(frameSel.value)); preload(); show(); });
  let timer: ReturnType<typeof setInterval> | null = null;
  const play = el.querySelector<HTMLButtonElement>('.sb-play')!;
  const toggle = () => {
    if (timer) { clearInterval(timer); timer = null; play.textContent = 'play'; return; }
    for (const f of imgFrames) new Image().src = url(`f${String(f).padStart(4, '0')}/${state.k}-${state.mode === 'boil' || state.mode === 'flicker' ? 'lit' : state.mode}.png`);
    timer = setInterval(() => { state.fi = (state.fi + 1) % imgFrames.length; show(); }, 1000 / 15);
    play.textContent = 'stop';
  };
  play.addEventListener('click', toggle);
  viewer.addEventListener('click', (e) => {
    state.zoom = !state.zoom;
    viewer.classList.toggle('zoom', state.zoom);
    if (state.zoom) { const r = viewer.getBoundingClientRect(); img.style.transformOrigin = `${((e.clientX - r.left) / r.width) * 100}% ${((e.clientY - r.top) / r.height) * 100}%`; }
  });
  viewer.addEventListener('mousemove', (e) => {
    if (!state.zoom) return;
    const r = viewer.getBoundingClientRect();
    img.style.transformOrigin = `${((e.clientX - r.left) / r.width) * 100}% ${((e.clientY - r.top) / r.height) * 100}%`;
  });
  const onKey = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.metaKey || e.ctrlKey || e.altKey) return;
    if (o.keyActive && !o.keyActive()) return;
    const n = Number(e.key);
    if (n >= 1 && n <= ids.length) { state.k = ids[n - 1]; show(); }
    else if (e.key === 'l' || e.key === 'm' || e.key === 'e' || e.key === 'b' || e.key === 'f') { state.mode = { l: 'lit', m: 'mask', e: 'err', b: 'boil', f: 'flicker' }[e.key]; show(); }
    else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { state.fi = (state.fi + (e.key === 'ArrowRight' ? 1 : imgFrames.length - 1)) % imgFrames.length; preload(); show(); }
    else if (e.key === ' ') { e.preventDefault(); toggle(); }
    else return;
  };
  addEventListener('keydown', onKey);
  preload(); show();
  return () => { removeEventListener('keydown', onKey); if (timer) clearInterval(timer); };
}

/** Table of saved runs (newest first) with the headline numbers of each variant. */
export function renderRunList(el: HTMLElement, runs: RunResult[], href: (id: string) => string) {
  el.innerHTML = `<table class="sb-table sb-small"><thead><tr><th>run</th><th>config</th><th>variant</th><th>umbra RMSE</th><th>umbra bias</th><th>pen. RMSE</th><th>blotch umbra</th><th>blotch pen.</th><th>tErr</th><th>GPU ms</th></tr></thead><tbody>${runs.map((r) => r.variants.map((v, i) => {
    const s = r.summary[v.id] ?? {};
    return `<tr${i === 0 ? ' class="sb-sep"' : ''}>${i === 0 ? `<th rowspan="${r.variants.length}"><a href="${href(r.id)}">${esc(r.id)}</a></th><td rowspan="${r.variants.length}" class="sb-muted">${esc(configLine(r))}</td>` : ''}<td title="${esc(JSON.stringify(v.options ?? {}))}">${esc(v.id)}</td><td>${f4(s.umbra?.rmse)}</td><td>${f4(s.umbra?.bias)}</td><td>${f4(s.penumbra?.rmse)}</td><td>${f4(s.umbra?.boilLow)}</td><td>${f4(s.penumbra?.boilLow)}</td><td>${f4(s.all?.tErr)}</td><td>${f4(r.gpuMs[v.id], 3)}</td></tr>`;
  }).join('')).join('')}</tbody></table>`;
}
