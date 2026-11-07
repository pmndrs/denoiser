// Gate evaluation and the three outputs: latest.json, latest.md, index.html (self-contained).
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const get = (obj, p) => p.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
const fin = (x) => typeof x === 'number' && Number.isFinite(x);

/** cost entry for a scorecard row on a signal (ours / ffx / baseline from this Mac; native from the RTX) */
export function costFor(row, signal, results) {
  const c = results.cost?.rows, cfgc = results.config?.cost ?? [];
  if (row.rowKey === 'raw') return { gpuMs: 0, wallMs: 0, note: 'no denoiser' };
  if (row.rowKey === 'native') {
    const g = signal === 'visibility' ? 'ours:visibility' : 'ours:gi';
    const n = results.nativeCost?.[g];
    return n && fin(n.gpuMs) && ((signal === 'visibility') === (n.id === 'nrd-sigma')) ? { gpuMs: n.gpuMs, wallMs: n.wallMs, note: `${n.gpu}, ${n.id}, not this GPU`, foreign: true } : null;
  }
  if (!c) return null;
  const find = (id) => c[id] && !c[id].skipped ? c[id] : null;
  const id = row.rowKey === 'accumulate' ? 'accumulate-32'
    : row.rowKey === 'ours' ? (signal === 'visibility' ? 'ours-shadows' : signal === 'ao' ? 'ours-ao' : 'ours-diffuse-specular')
      : row.rowKey === 'ffx' ? (signal === 'visibility' ? 'ffx-shadows' : 'ffx-reflections') : null;
  const e = id && find(id);
  return e ? { gpuMs: e.gpuMs, wallMs: e.wallMs, note: id + (id === 'ours-diffuse-specular' ? ' (both signals together)' : ''), passes: e.passes } : null;
}

export function evaluateGates(gates, scene, results) {
  return gates.map((g) => {
    const sig = scene.signals[g.signal];
    const base = { name: g.name, signal: g.signal, metric: g.metric, op: g.op };
    if (!sig) return { ...base, pass: null, note: 'signal not scored' };
    const value = (row) => {
      if (!row) return undefined;
      if (g.metric.startsWith('cost.')) return costFor(row, g.signal, results)?.[g.metric.slice(5)];
      return get(row, g.metric);
    };
    const ours = sig.rows.find((r) => r.rowKey === 'ours');
    const a = value(ours);
    let b, label;
    if (typeof g.vs === 'number') { b = g.vs; label = String(g.vs); }
    else if (g.vs === 'ffx') { b = value(sig.rows.find((r) => r.rowKey === 'ffx')); label = 'FFX'; }
    else if (g.vs === 'native') {
      const vals = sig.rows.filter((r) => r.rowKey === 'native').map(value).filter(fin);
      b = vals.length ? Math.min(...vals) : undefined; label = 'best native';
    }
    if (!fin(a) || !fin(b)) return { ...base, pass: null, ours: a ?? null, vs: b ?? null, vsLabel: label, note: !fin(a) ? 'no value for ours' : `no ${label} value on this capture` };
    const pass = g.op === '<=' ? a <= b : g.op === '<' ? a < b : g.op === '>=' ? a >= b : a > b;
    return { ...base, pass, ours: a, vs: b, vsLabel: label };
  });
}

// ---- formatting
const f = (x, k = 3) => (fin(x) ? x.toFixed(k) : '–');
const boilCell = (r) => (r && fin(r.boil) ? r.boil.toFixed(4) : '–');
const tailOne = (r) => (r && fin(r.p99) ? `${r.p99.toFixed(3)}/${(100 * r.popFrac).toFixed(1)}%` : '–');
const tailCell = (c) => ['static', 'dense', 'moving'].map((k) => tailOne(c?.[k])).join(' · ');
const lagCell = (lags) => (lags?.length ? lags.map((l) => `${l.kind} ${l.lag === null || l.lag === undefined ? '–' : l.lag}`).join(', ') : '–');
const sigmaCell = (c) => (c?.calm?.sigma ? c.calm.sigma.sigma.toFixed(4) : '–');

export const COLUMNS = [
  ['row', 'row'],
  ['boil static', (r) => boilCell(r.calm?.static)],
  ['boil dense', (r) => boilCell(r.calm?.dense)],
  ['boil moving', (r) => boilCell(r.calm?.moving)],
  ['boil disoccluded', (r) => boilCell(r.calm?.disocc)],
  ['still σ', (r) => sigmaCell(r)],
  ['FLIP', (r) => f(r.detail?.flip, 4)],
  ['PSNR dB', (r) => f(r.detail?.psnrPooled, 2)],
  ['lag (frames)', (r) => lagCell(r.lag)],
  ['bias (levels)', (r) => (fin(r.bias?.levels) ? (r.bias.levels >= 0 ? '+' : '') + r.bias.levels.toFixed(2) : '–')],
  ['GPU ms', null], ['wall ms', null],
];

function rowCells(row, signal, results) {
  const c = costFor(row, signal, results);
  return [
    row.label + (row.missing ? ' (no outputs)' : ''),
    boilCell(row.calm?.static), boilCell(row.calm?.dense), boilCell(row.calm?.moving), boilCell(row.calm?.disocc), tailCell(row.calm), sigmaCell(row),
    f(row.detail?.flip, 4), f(row.detail?.psnrPooled, 2), lagCell(row.lag),
    fin(row.bias?.levels) ? (row.bias.levels >= 0 ? '+' : '') + row.bias.levels.toFixed(2) : '–',
    c ? (f(c.gpuMs, 3) + (c.foreign ? ' †' : '')) : '–', c ? (f(c.wallMs, 2) + (c.foreign ? ' †' : '')) : '–',
  ];
}
function refCells(ref) {
  const b = (r) => (fin(ref.regions?.[r]?.boil) ? ref.regions[r].boil.toFixed(4) : '–');
  return ['reference floor (its own noise)', b('static'), b('dense'), b('moving'), b('disocc'), '', fin(ref.sigma) ? ref.sigma.toFixed(4) : '–', '0', '∞', '–', '0', '–', '–'];
}
const HEAD = ['row', 'boil static (smooth)', 'boil dense geometry', 'boil moving', 'boil disoccluded', 'tail p99 / pop % (smooth · dense · moving)', 'still σ', 'FLIP ↓', 'PSNR dB ↑', 'lag (frames) ↓', 'bias (8-bit levels)', 'GPU ms 1080p', 'wall ms 1080p'];

export function toMarkdown(R) {
  const L = [];
  L.push('# Scorecard (latest)', '', `_Generated ${R.generated} by \`node tools/scorecard/run.mjs\` (repo ${R.repoCommit}, packages ${R.packageCommit}). GPU: ${R.gpu ?? 'n/a'}. Details: [tools/scorecard/README.md](../../../../tools/scorecard/README.md)._`, '');
  L.push('Five numbers per scene and signal (TRACKS.md): **calm** = motion-compensated boil per region (value, and ×the clean reference\'s own boil in the same pixels) plus still-camera σ of luma where the camera is static; **detail** = FLIP vs the capture\'s reference (PSNR secondary); **lag** = frames until the error is within 10 % of its settled level after the event; **bias** = mean display luma minus the reference, 8-bit levels; **cost** = GPU ms and wall ms at 1080p on this Mac.', '');
  if (R.cost) {
    L.push(`## Cost at 1080p (${R.cost.measuredAt})`, '', `${R.cost.protocol}. Capture \`${R.cost.capture}\`.`, '', '| row | GPU ms | wall ms | wall ms, timestamps off | rounds (GPU ms) | passes (ms) |', '|---|---|---|---|---|---|');
    for (const [id, c] of Object.entries(R.cost.rows)) L.push(c.skipped ? `| ${id} | – | – | skipped: ${c.skipped} | |` : `| ${c.label} | ${c.gpuMs.toFixed(3)} | ${c.wallMs.toFixed(2)} | ${c.wallNoTimestampsMs == null ? 'n/a (registry ignores timestamps=0)' : c.wallNoTimestampsMs.toFixed(2)} | ${c.gpuRounds.join(' / ')} | ${Object.entries(c.passes).map(([p, v]) => `${p} ${v.toFixed(3)}`).join(', ')} |`);
    L.push('');
  }
  for (const s of R.scenes) {
    L.push(`## ${s.id}${s.golden ? ` (${s.golden})` : ''}: ${s.title}`, '', `${s.width}x${s.height}, ${s.frames} frames, reference ${s.referenceSpp} spp, ${s.staticCamera ? 'static camera' : 'moving camera'}, events: ${s.events.map((e) => `${e.kind}@${e.frame}`).join(', ')}. _${s.status}_`, '');
    if (s.gates.length) {
      L.push('| gate | ours | bar | result |', '|---|---|---|---|');
      for (const g of s.gates) L.push(`| ${g.name} | ${g.ours == null ? '–' : f(g.ours, 4)} | ${g.vs == null ? '–' : `${g.op} ${f(g.vs, 4)} (${g.vsLabel})`} | ${g.pass === null ? `n/a (${g.note})` : g.pass ? 'PASS' : 'FAIL'} |`);
      L.push('');
    }
    for (const [signal, d] of Object.entries(s.signals)) {
      L.push(`### ${s.id} / ${signal}`, '', `| ${HEAD.join(' | ')} |`, `|${HEAD.map(() => '---').join('|')}|`, `| ${refCells(d.reference).join(' | ')} |`);
      for (const row of d.rows) L.push(`| ${rowCells(row, signal, R).join(' | ')} |`);
      const crop = s.crops.find((c) => c.signal === signal);
      L.push('', crop ? `![${s.id} ${signal}: ${crop.labels.join(' | ')}](${crop.file})` : '', crop ? `_crop strip, frame ${crop.frame}: ${crop.labels.join(' | ')}_` : '', '');
    }
  }
  L.push('## Notes', '',
    '- Boil: RMS of the second temporal difference x_t − 2x_(t−1) + x_(t−2) along the reprojected history, / √6, on tonemapped values (Reinhard per channel for rgb, clamp for visibility / AO). Regions (per pixel and frame, ≥ 8 frames after a reset): **moving** = the reference changed by > 0.05 along its history within 4 frames; **disoccluded** = history age 2..6 frames; **dense geometry** = static pixels within 1 px of a crease (normal > 10° off a neighbour within 2 px) or silhouette (view-z jump > 2 %); **static (smooth)** = the rest. Boil is shown absolute; the reference row is its own boil in the same pixels, context only (the 1024–2048-spp references boil more than most denoisers, so a ratio to it means nothing). Read calm together with FLIP: a filter can buy calm by smearing detail.',
    '- Tail numbers (next to the mean boil): p99 of the per-pixel boil and the pop fraction (pixels whose boil exceeds the reference\'s own at that pixel by 0.03), per region; the means can be level while the tail differs. Motion compensation samples the reprojected history bilinearly (two hops, valid taps only), not the nearest tap.',
    '- Native rows are **imported** from `docs/research/rt-denoiser/native/results/*/score-captures.json` (default settings, RTX 3060 Laptop): FLIP, PSNR and lag (from per-frame PSNR) are comparable; boil regions, σ and bias need the native outputs (set `RT_NATIVE_OUTPUTS`). † = timed on the Windows RTX, not this GPU.',
    '- Cost "GPU ms" for `ours diffuse+specular` is the joint dispatch; the same figure is shown on both signals.', '');
  return L.join('\n');
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function toHtml(R, outDir) {
  const cell = (v) => `<td>${esc(v)}</td>`;
  const sceneHtml = R.scenes.map((s) => {
    const gates = s.gates.length ? `<table class="gates"><tr><th>gate</th><th>ours</th><th>bar</th><th>result</th></tr>${s.gates.map((g) =>
      `<tr><td>${esc(g.name)}</td><td>${g.ours == null ? '–' : f(g.ours, 4)}</td><td>${g.vs == null ? '–' : `${esc(g.op)} ${f(g.vs, 4)} <span class="muted">${esc(g.vsLabel)}</span>`}</td><td class="${g.pass === null ? 'na' : g.pass ? 'pass' : 'fail'}">${g.pass === null ? 'n/a <span class="muted">' + esc(g.note) + '</span>' : g.pass ? 'PASS' : 'FAIL'}</td></tr>`).join('')}</table>` : '';
    const sigs = Object.entries(s.signals).map(([signal, d]) => {
      const crop = s.crops.find((c) => c.signal === signal);
      let img = '';
      if (crop) { try { img = `<figure><img alt="${esc(s.id)} ${esc(signal)} crops" src="data:image/png;base64,${readFileSync(path.join(outDir, crop.file)).toString('base64')}"><figcaption>frame ${crop.frame}: ${esc(crop.labels.join(' | '))}</figcaption></figure>`; } catch { img = ''; } }
      const rows = d.rows.map((r) => {
        const c = rowCells(r, signal, R);
        return `<tr class="k-${r.kind}">${c.map((v, i) => (i === 0 ? `<th scope="row">${esc(v)}</th>` : cell(v))).join('')}</tr>`;
      }).join('');
      return `<h3>${esc(signal)}</h3><div class="scroll"><table><thead><tr>${HEAD.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody><tr class="k-ref">${refCells(d.reference).map((v, i) => (i === 0 ? `<th scope="row">${esc(v)}</th>` : cell(v))).join('')}</tr>${rows}</tbody></table></div>${img}`;
    }).join('');
    return `<section id="${esc(s.id)}"><h2>${esc(s.id)}${s.golden ? ` <span class="tag">${esc(s.golden)}</span>` : ''} <small>${esc(s.title)}</small></h2><p class="muted">${s.width}x${s.height}, ${s.frames} frames, reference ${s.referenceSpp} spp, ${s.staticCamera ? 'static' : 'moving'} camera, events: ${esc(s.events.map((e) => `${e.kind}@${e.frame}`).join(', '))}. ${esc(s.status)}</p>${gates}${sigs}</section>`;
  }).join('');
  const costHtml = R.cost ? `<section><h2>Cost at 1080p <small>${esc(R.cost.measuredAt)}</small></h2><p class="muted">${esc(R.cost.protocol)}. Capture <code>${esc(R.cost.capture)}</code>.</p><div class="scroll"><table><thead><tr><th>row</th><th>GPU ms</th><th>wall ms</th><th>wall ms, timestamps off</th><th>rounds</th><th>passes (ms)</th></tr></thead><tbody>${Object.entries(R.cost.rows).map(([id, c]) => c.skipped ? `<tr><th scope="row">${esc(id)}</th><td colspan="5">skipped: ${esc(c.skipped)}</td></tr>` : `<tr><th scope="row">${esc(c.label)}</th><td>${c.gpuMs.toFixed(3)}</td><td>${c.wallMs.toFixed(2)}</td><td>${c.wallNoTimestampsMs == null ? 'n/a' : c.wallNoTimestampsMs.toFixed(2)}</td><td>${c.gpuRounds.join(' / ')}</td><td class="muted">${Object.entries(c.passes).map(([p, v]) => `${esc(p)} ${v.toFixed(3)}`).join(', ')}</td></tr>`).join('')}</tbody></table></div></section>` : '<section><h2>Cost</h2><p class="muted">not measured in this run (use <code>--cost</code>).</p></section>';
  const nav = R.scenes.map((s) => `<a href="#${esc(s.id)}">${esc(s.id)}</a>`).join(' ');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>RT denoiser scorecard</title><style>
:root{--bg:#fff;--fg:#1b1f24;--muted:#6a737d;--line:#d8dee4;--head:#f3f5f7;--pass:#1a7f37;--fail:#cf222e;--na:#8c959f;--accent:#0969da}
@media (prefers-color-scheme:dark){:root{--bg:#0f1317;--fg:#e6e9ec;--muted:#8b949e;--line:#2b333b;--head:#171c22;--pass:#3fb950;--fail:#f85149;--na:#8b949e;--accent:#58a6ff}}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.45 system-ui,sans-serif}main{max-width:1200px;margin:0 auto;padding:16px}
h1{font-size:1.5rem}h2{font-size:1.2rem;margin-top:2rem;border-top:1px solid var(--line);padding-top:1rem}h2 small{font-weight:400;color:var(--muted);font-size:.85rem}h3{margin:1rem 0 .3rem;font-size:1rem}
.muted{color:var(--muted)}.tag{font-size:.75rem;border:1px solid var(--accent);color:var(--accent);border-radius:99px;padding:0 .5rem}
.scroll{overflow-x:auto}table{border-collapse:collapse;font-size:13px;width:100%}th,td{border-bottom:1px solid var(--line);padding:.25rem .5rem;text-align:right;white-space:nowrap}th:first-child,td:first-child{text-align:left}thead th{background:var(--head);position:sticky;top:0}
tr.k-ref td,tr.k-ref th{color:var(--muted);font-style:italic}tr.k-ours th{color:var(--accent)}tr.k-native td,tr.k-native th{opacity:.85}
table.gates{width:auto;margin:.4rem 0}table.gates td,table.gates th{text-align:left}td.pass{color:var(--pass);font-weight:600}td.fail{color:var(--fail);font-weight:600}td.na{color:var(--na)}
figure{margin:.5rem 0}img{image-rendering:pixelated;max-width:100%;border:1px solid var(--line)}figcaption{color:var(--muted);font-size:12px}nav a{margin-right:.7rem}code{background:var(--head);padding:0 .25rem;border-radius:4px}
</style></head><body><main><h1>Real-time denoiser scorecard</h1>
<p class="muted">Generated ${esc(R.generated)} · repo ${esc(R.repoCommit)} · packages ${esc(R.packageCommit)} · GPU ${esc(R.gpu ?? 'n/a')} · <code>node tools/scorecard/run.mjs</code></p>
<p>Calm = motion-compensated boil per region (value, and × the clean reference's own boil) and still-camera σ; detail = FLIP (↓) and PSNR; lag = frames to settle within 10 % after the event; bias = display-level difference to the reference; cost at 1080p on this Mac. Native rows are imported from the Windows harness (FLIP, PSNR, lag comparable; † = RTX 3060 Laptop timing). Definitions and caveats: <code>tools/scorecard/README.md</code>.</p>
<nav>${nav}</nav>${costHtml}${sceneHtml}</main></body></html>`;
}

export function writeReports(outDir, R) {
  writeFileSync(path.join(outDir, 'latest.json'), JSON.stringify(R, (k, v) => (typeof v === 'number' && !Number.isFinite(v) ? null : v), 1));
  writeFileSync(path.join(outDir, 'latest.md'), toMarkdown(R));
  writeFileSync(path.join(outDir, 'index.html'), toHtml(R, outDir));
}
