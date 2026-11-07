// Review bench: blind A/B metric calibration (T0-scorecard, TRACKS.md "T1 calibration").
//
// Dennis judges pre-rendered pairs (crops of replayed denoiser outputs on the kept captures) side by side, labels
// hidden and left / right order randomised per pair, to say which is calmer / keeps more detail / settles faster. The
// answers live in localStorage and can be copied as JSON with one button; `node tools/scorecard/calibration/analyze.mjs
// results.json` then computes, per metric, how often the scorecard's metric preferred the same side.
//
// Pairs come from `calibration/pairs.json` + `calibration/sheets/*.png` (written by
// `node tools/scorecard/calibration/make-pairs.mjs`). The manifest carries NO labels or metric values: those stay in
// tools/scorecard/calibration/key.json, so nothing on this page can hint at which option is which.
// It is not URL driven: a button in the bench header opens the panel.
import manifest from './calibration/pairs.json';

type MetricId = 'calm' | 'detail' | 'lag';
interface Pair { id: string; metric: MetricId; sheet: string; frames: number; size: number; rows: number; fps: number; still?: boolean }
interface Manifest { version: number; generated: string; metrics: Record<MetricId, { title: string; question: string; hint: string }>; pairs: Pair[] }
interface Answer { pair: string; metric: MetricId; leftIs: 'a' | 'b'; pick: 'left' | 'right' | 'tie'; ms: number; at: string }
interface State { session: string; order: Record<string, string[]>; leftIs: Record<string, 'a' | 'b'>; answers: Record<string, Answer> }

const M = manifest as unknown as Manifest;
const sheets = import.meta.glob('./calibration/sheets/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const sheetUrl = (name: string) => sheets[`./calibration/sheets/${name}`];
const KEY = 'rv-calibration-v1';
const METRICS: MetricId[] = ['calm', 'detail', 'lag'];

function load(): State {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null') as State | null;
    if (s && s.order && s.answers) return s;
  } catch { /* private window or cleared site data */ }
  return fresh();
}
function fresh(): State {
  const rnd = () => Math.random() - 0.5;
  const order: Record<string, string[]> = {};
  for (const m of METRICS) order[m] = M.pairs.filter((p) => p.metric === m).map((p) => p.id).sort(rnd);
  const leftIs: Record<string, 'a' | 'b'> = {};
  for (const p of M.pairs) leftIs[p.id] = Math.random() < 0.5 ? 'a' : 'b';
  return { session: new Date().toISOString(), order, leftIs, answers: {} };
}
let state = load();
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* storage unavailable: the copy button still works */ } };

const STYLE = `
.cal-open { margin-left: .8rem; }
#rv-calibration { max-width: 960px; margin: .8rem 0 1rem; display: none; }
#rv-calibration.open { display: block; }
#rv-calibration .cal-tabs { display: flex; gap: .4rem; flex-wrap: wrap; margin-bottom: .6rem; }
#rv-calibration .cal-q { font-size: 1.05rem; margin: .2rem 0; }
#rv-calibration .cal-hint { color: var(--dn-muted); font-size: .85rem; margin: 0 0 .6rem; }
#rv-calibration .cal-pair { display: flex; gap: .8rem; flex-wrap: wrap; align-items: flex-start; }
#rv-calibration .cal-side { display: flex; flex-direction: column; gap: .35rem; align-items: stretch; }
#rv-calibration canvas.cal-cv { width: auto; max-width: 100%; aspect-ratio: auto; image-rendering: pixelated; cursor: default; border-radius: 6px; border: 1px solid var(--dn-border); background: #000; display: block; }
#rv-calibration .cal-pick { min-height: 2.6rem; font-size: 1rem; }
#rv-calibration .cal-pick.on { outline: 2px solid var(--dn-accent); }
#rv-calibration .cal-row { display: flex; gap: .5rem; flex-wrap: wrap; align-items: center; margin-top: .6rem; }
#rv-calibration .cal-prog { color: var(--dn-muted); font-size: .85rem; }
#rv-calibration textarea { width: 100%; min-height: 6rem; font: .75rem var(--dn-mono); background: var(--dn-inset); color: var(--dn-text); border: 1px solid var(--dn-border); border-radius: 6px; }
#rv-calibration .cal-ref { color: var(--dn-muted); font-size: .8rem; }
`;

export function mountCalibration(): void {
  const page = document.querySelector('.dn-page');
  const head = document.querySelector('.dn-head');
  if (!page || !head) return;
  const style = document.createElement('style'); style.textContent = STYLE; document.head.appendChild(style);
  const panel = document.createElement('section');
  panel.id = 'rv-calibration'; panel.className = 'dn-panel';
  head.insertAdjacentElement('afterend', panel);
  const btn = document.createElement('button');
  btn.className = 'dn-btn cal-open'; btn.textContent = `Blind A/B calibration (${M.pairs.length} pairs)`;
  btn.title = 'Judge pre-rendered pairs with the labels hidden; the answers calibrate the scorecard metrics';
  head.querySelector('h1')?.appendChild(btn);

  let metric: MetricId = 'calm';
  let index = 0;
  let playing = true;
  let fps = 0;
  let raf = 0;
  let shownAt = performance.now();
  let teardown: (() => void) | null = null;

  const pairsOf = (m: MetricId) => state.order[m].map((id) => M.pairs.find((p) => p.id === id)!).filter(Boolean);
  const answered = (m: MetricId) => pairsOf(m).filter((p) => state.answers[p.id]).length;
  const firstOpen = (m: MetricId) => Math.max(0, pairsOf(m).findIndex((p) => !state.answers[p.id]));

  function render() {
    teardown?.(); teardown = null;
    panel.innerHTML = '';
    const tabs = document.createElement('div'); tabs.className = 'cal-tabs';
    for (const m of METRICS) {
      const b = document.createElement('button'); b.className = 'dn-btn'; b.setAttribute('aria-pressed', String(m === metric));
      b.textContent = `${M.metrics[m].title} (${answered(m)}/${pairsOf(m).length})`;
      b.onclick = () => { metric = m; index = firstOpen(m); render(); };
      tabs.appendChild(b);
    }
    const copy = document.createElement('button'); copy.className = 'dn-btn dn-btn--primary'; copy.textContent = 'Copy results';
    copy.onclick = () => copyResults(copy);
    const reset = document.createElement('button'); reset.className = 'dn-btn'; reset.textContent = 'Start over';
    reset.onclick = () => { if (confirm('Delete all answers and reshuffle the pairs?')) { state = fresh(); save(); index = 0; render(); } };
    const close = document.createElement('button'); close.className = 'dn-btn'; close.textContent = 'Close';
    close.onclick = () => { panel.classList.remove('open'); teardown?.(); teardown = null; };
    tabs.append(copy, reset, close);
    panel.appendChild(tabs);

    const list = pairsOf(metric);
    if (!list.length) { panel.append('No pairs for this metric.'); return; }
    index = Math.min(Math.max(index, 0), list.length - 1);
    const p = list[index];
    const info = M.metrics[metric];
    const q = document.createElement('p'); q.className = 'cal-q'; q.innerHTML = `<b>${info.question}</b>`;
    const hint = document.createElement('p'); hint.className = 'cal-hint'; hint.textContent = info.hint;
    panel.append(q, hint);

    const img = new Image();
    const holder = document.createElement('div'); holder.className = 'cal-pair';
    const mkSide = (label: string) => {
      const side = document.createElement('div'); side.className = 'cal-side';
      const cv = document.createElement('canvas'); cv.className = 'cal-cv';
      const pick = document.createElement('button'); pick.className = 'dn-btn cal-pick'; pick.textContent = label;
      side.append(cv, pick);
      return { side, cv, pick };
    };
    const L = mkSide('This one  (←)'), R = mkSide('This one  (→)');
    holder.append(L.side, R.side);
    let refCv: HTMLCanvasElement | null = null;
    if (p.rows === 3) {
      const side = document.createElement('div'); side.className = 'cal-side';
      refCv = document.createElement('canvas'); refCv.className = 'cal-cv';
      const cap = document.createElement('div'); cap.className = 'cal-ref'; cap.textContent = 'reference (converged)';
      side.append(refCv, cap); holder.appendChild(side);
    }
    panel.appendChild(holder);

    const mark = () => {
      const a = state.answers[p.id];
      L.pick.classList.toggle('on', a?.pick === 'left'); R.pick.classList.toggle('on', a?.pick === 'right'); tie.classList.toggle('on', a?.pick === 'tie');
    };
    const answer = (pick: Answer['pick']) => {
      state.answers[p.id] = { pair: p.id, metric, leftIs: state.leftIs[p.id], pick, ms: Math.round(performance.now() - shownAt), at: new Date().toISOString() };
      save(); mark();
      const next = list.findIndex((x, i) => i > index && !state.answers[x.id]);
      if (next >= 0) { index = next; } else if (index < list.length - 1) index++;
      render();
    };
    L.pick.onclick = () => answer('left'); R.pick.onclick = () => answer('right');

    const row = document.createElement('div'); row.className = 'cal-row';
    const tie = document.createElement('button'); tie.className = 'dn-btn'; tie.textContent = "Can't tell  (↓)";
    tie.onclick = () => answer('tie');
    const prev = document.createElement('button'); prev.className = 'dn-btn small'; prev.textContent = '‹ previous';
    prev.onclick = () => { index = Math.max(0, index - 1); render(); };
    const next = document.createElement('button'); next.className = 'dn-btn small'; next.textContent = 'next ›';
    next.onclick = () => { index = Math.min(list.length - 1, index + 1); render(); };
    const play = document.createElement('button'); play.className = 'dn-btn small'; play.textContent = playing ? 'pause (Space)' : 'play (Space)';
    play.style.display = p.still ? 'none' : '';
    play.onclick = () => { playing = !playing; play.textContent = playing ? 'pause (Space)' : 'play (Space)'; };
    const speed = document.createElement('select'); speed.title = 'playback speed';
    speed.style.display = p.still ? 'none' : '';
    for (const f of [p.fps, Math.round(p.fps / 3), Math.max(2, Math.round(p.fps / 6))]) speed.add(new Option(`${f} fps`, String(f)));
    speed.value = String(fps || p.fps); speed.onchange = () => { fps = Number(speed.value); };
    if (!fps) fps = p.fps;
    const prog = document.createElement('span'); prog.className = 'cal-prog'; prog.textContent = `pair ${index + 1} of ${list.length} · ${answered(metric)} answered`;
    row.append(tie, prev, next, play, speed, prog);
    panel.appendChild(row);

    // ---- sheet playback: row 0 = option a, row 1 = option b, (row 2 = reference); left / right by the stored coin flip
    const size = p.size;
    for (const cv of [L.cv, R.cv, ...(refCv ? [refCv] : [])]) { cv.width = size; cv.height = size; cv.style.width = `${Math.min(size * 4, 400)}px`; }
    const leftRow = state.leftIs[p.id] === 'a' ? 0 : 1;
    const draw = (k: number) => {
      const lc = L.cv.getContext('2d')!, rc = R.cv.getContext('2d')!;
      lc.imageSmoothingEnabled = false; rc.imageSmoothingEnabled = false;
      lc.drawImage(img, k * size, leftRow * size, size, size, 0, 0, size, size);
      rc.drawImage(img, k * size, (1 - leftRow) * size, size, size, 0, 0, size, size);
      if (refCv) refCv.getContext('2d')!.drawImage(img, k * size, 2 * size, size, size, 0, 0, size, size);
    };
    let frame = 0, last = performance.now();
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (!img.complete || !img.naturalWidth) return;
      if (playing && !p.still && now - last >= 1000 / fps) { frame = (frame + 1) % p.frames; last = now; }
      draw(p.still ? 0 : frame);
    };
    img.onload = () => { shownAt = performance.now(); cancelAnimationFrame(raf); raf = requestAnimationFrame(tick); };
    img.src = sheetUrl(p.sheet);
    mark();

    const onKey = (e: KeyboardEvent) => {
      if (!panel.classList.contains('open') || (e.target as HTMLElement)?.matches?.('textarea, input, select')) return;
      if (e.key === 'ArrowLeft') { answer('left'); e.preventDefault(); e.stopImmediatePropagation(); }
      else if (e.key === 'ArrowRight') { answer('right'); e.preventDefault(); e.stopImmediatePropagation(); }
      else if (e.key === 'ArrowDown') { answer('tie'); e.preventDefault(); e.stopImmediatePropagation(); }
      else if (e.key === ' ') { play.click(); e.preventDefault(); e.stopImmediatePropagation(); }
    };
    window.addEventListener('keydown', onKey, true);
    teardown = () => { cancelAnimationFrame(raf); window.removeEventListener('keydown', onKey, true); };

    // ---- results box
    const done = METRICS.reduce((a, m) => a + answered(m), 0);
    const total = M.pairs.length;
    const foot = document.createElement('p'); foot.className = 'cal-hint';
    foot.textContent = `${done} of ${total} answered. Answers are kept in this browser (localStorage). "Copy results" puts the JSON on the clipboard (or in the box below if the browser refuses); paste it into a file and run node tools/scorecard/calibration/analyze.mjs on it.`;
    panel.appendChild(foot);
  }

  function resultsJson(): string {
    const answers = Object.values(state.answers).sort((a, b) => a.pair.localeCompare(b.pair));
    return JSON.stringify({ version: 1, kind: 'rt-scorecard-calibration', session: state.session, manifest: M.generated, exported: new Date().toISOString(), answers }, null, 1);
  }
  async function copyResults(button: HTMLButtonElement) {
    const text = resultsJson();
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; } catch { /* fall through to the text box */ }
    button.textContent = ok ? 'Copied' : 'Copy failed: use the box';
    setTimeout(() => { button.textContent = 'Copy results'; }, 1800);
    let box = panel.querySelector<HTMLTextAreaElement>('textarea');
    if (!ok) {
      if (!box) { box = document.createElement('textarea'); panel.appendChild(box); }
      box.value = text; box.focus(); box.select();
    }
  }

  btn.onclick = () => {
    const open = !panel.classList.contains('open');
    panel.classList.toggle('open', open);
    if (open) { index = firstOpen(metric); render(); } else { teardown?.(); teardown = null; }
  };
  // exposed for the smoke test (scripts), not needed by the UI
  (window as unknown as { __cal?: unknown }).__cal = { results: resultsJson, state: () => state, open: () => btn.click() };
}

mountCalibration();
