// The numbers we measured, shown on the page so a visitor sees them without running anything.
// Two benchmark runs (the page's own "Run benchmark", exported as JSON): one with our runtime on
// Auto, one with it forced to WGSL. The oidn-web contenders ran in both, so their cells show the
// range of the two medians.
import type { BenchRow } from './bench';
import autoRows from './measured/auto.json';
import wgslRows from './measured/wgsl.json';

const at = (rows: BenchRow[], id: string, size: string) =>
  rows.filter((r) => r.contender === id && `${r.size[0]}×${r.size[1]}` === size).map((r) => r.warmMedianMs);
const both = (id: string) => (size: string) => [...at(autoRows as BenchRow[], id, size), ...at(wgslRows as BenchRow[], id, size)];

const COLUMNS: { title: string; note?: string; pick: (size: string) => number[] }[] = [
  { title: 'denoiser · WGSL', pick: (s) => at(wgslRows as BenchRow[], 'ours', s) },
  { title: 'denoiser · Auto', note: 'picked WebNN', pick: (s) => at(autoRows as BenchRow[], 'ours', s) },
  { title: 'oidn-web 0.5 · WGSL', note: 'default tiles', pick: both('oidn-wgsl') },
  { title: 'oidn-web 0.5 · WGSL', note: 'whole image', pick: both('oidn-wgsl-whole') },
  { title: 'oidn-web 0.5 · WebNN', pick: both('oidn-webnn') },
  { title: 'oidn-web 0.3.5 · TF.js', note: 'default tiles', pick: both('oidn-tfjs') },
  { title: 'oidn-web 0.3.5 · TF.js', note: 'one tile', pick: both('oidn-tfjs-whole') },
];

const fmt = (xs: number[]) => {
  if (!xs.length) return '<span class="fail">fails</span>';
  const lo = Math.min(...xs), hi = Math.max(...xs);
  const d = (v: number) => (v < 100 ? v.toFixed(1) : v.toFixed(0));
  return Math.abs(hi - lo) < 0.05 * lo ? d(lo) : `${d(lo)}–${d(hi)}`;
};

/** Renders the measured table into `el` and its caption into `note`. */
export function renderMeasured(el: HTMLElement, note: HTMLElement) {
  const sizes = [...new Set((wgslRows as BenchRow[]).map((r) => `${r.size[0]}×${r.size[1]}`))];
  // fastest cell per size, highlighted
  const best = new Map(sizes.map((s) => [s, Math.min(...COLUMNS.flatMap((c) => c.pick(s)))]));
  const env = (wgslRows as BenchRow[])[0].env;
  const psnrs = [...(autoRows as BenchRow[]), ...(wgslRows as BenchRow[])];
  const psnrLo = Math.min(...psnrs.map((r) => r.psnr)), psnrHi = Math.max(...psnrs.map((r) => r.psnr));
  const agree = psnrs.map((r) => r.psnrVsOurs).filter((v): v is number => v !== null);
  el.innerHTML = `
    <table>
      <thead><tr><th>size</th>${COLUMNS.map((c) => `<th>${c.title}${c.note ? `<br><small>${c.note}</small>` : ''}</th>`).join('')}</tr></thead>
      <tbody>${sizes.map((s) => `<tr><td>${s}</td>${COLUMNS.map((c) => {
        const xs = c.pick(s);
        return `<td${xs.length && Math.min(...xs) === best.get(s) ? ' class="best"' : ''}>${fmt(xs)}</td>`;
      }).join('')}</tr>`).join('')}</tbody>
    </table>`;
  note.innerHTML = `Warm median, ms, ${(wgslRows as BenchRow[])[0].runs} runs; wall clock from the call until the output
      texture is written and the GPU is idle. ${env.gpu}, Chrome ${/Chrome\/(\d+)/.exec(env.browser)?.[1] ?? ''},
      fp16, ${(wgslRows as BenchRow[])[0].scene} scene at ${(wgslRows as BenchRow[])[0].spp} spp, model
      <code>${(wgslRows as BenchRow[])[0].model}</code>, measured ${(wgslRows as BenchRow[])[0].when.slice(0, 10)}.
      Ranges are two separate runs. Quality is a wash: every denoiser scores ${psnrLo.toFixed(1)}–${psnrHi.toFixed(1)} dB
      against a 2048-sample reference, and oidn-web's output matches ours to ${Math.min(...agree).toFixed(0)}–${Math.max(...agree).toFixed(0)} dB.
      The 0.3.5 one-tile run fails at 1080p (a WebGPU dispatch-size limit inside TensorFlow.js).`;
}
