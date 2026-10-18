// Shared "demo chrome" for the denoiser examples — dependency-free.
//
// Imported via a RELATIVE path (e.g. `import { ensureWebGPU } from '../../_shared/chrome'`),
// NOT as a workspace package. Plain DOM, no deps; the look comes from shell.css (the
// same stylesheet as the example shell's top bar and controls panel, see shell.ts).
//
// Public API:
//   ensureWebGPU(el?)  -> Promise<boolean>   feature-detect + friendly banner on failure
//   statsOverlay()     -> { frame(ms) }      fixed-corner ms/FPS readout
//   demoFooter(name)   -> void               small footer (name, source link, back to the list)
//   pathtracerNote()   -> void               dismissible note re: the early-stage WebGPU path tracer
//   runtimePicker(o)   -> { setReadout(t) }  segmented ?runtime= switcher (reloads) + readout

import './shell.css';

const REPO_URL = 'https://github.com/pmndrs/denoiser';
const SUPPORTED_BROWSERS = 'Chrome 113+, Edge 113+, or Safari 26+ (Technology Preview)';
const PATHTRACER_URL = 'https://github.com/gkjohnson/three-gpu-pathtracer';

/**
 * Feature-detect WebGPU (navigator.gpu + a real adapter). On failure, injects a
 * friendly full-page banner explaining what's needed and returns `false`; on
 * success returns `true` and injects nothing.
 *
 * @param el Optional container for the banner (defaults to <body>).
 */
export async function ensureWebGPU(el?: HTMLElement): Promise<boolean> {
  const gpu = (navigator as Navigator & { gpu?: GPU }).gpu;
  let ok = false;
  let detail = '';
  if (!gpu) {
    detail = 'navigator.gpu is undefined — this browser has no WebGPU.';
  } else {
    try {
      const adapter = await gpu.requestAdapter();
      if (adapter) ok = true;
      else detail = 'navigator.gpu is present but no GPU adapter is available (try enabling hardware acceleration).';
    } catch (err) {
      detail = `requestAdapter() failed: ${(err as Error).message}`;
    }
  }
  if (ok) return true;
  injectUnsupportedBanner(el ?? document.body, detail);
  return false;
}

function injectUnsupportedBanner(host: HTMLElement, detail: string): void {
  const banner = document.createElement('div');
  banner.setAttribute('data-denoiser-chrome', 'unsupported');
  // Below the shell's top bar (--dn-bar-h), so "back to the examples" stays reachable.
  banner.className = 'dn-unsupported';
  banner.innerHTML = `
    <div style="max-width:34rem;text-align:center">
      <div style="font-size:2.5rem;margin-bottom:0.5rem">⚡</div>
      <h1 style="margin:0 0 0.5rem;font-size:1.4rem">This demo needs WebGPU</h1>
      <p style="margin:0 0 1rem;color:#a0aec0">
        The denoiser runs entirely on the GPU via WebGPU, which isn't available here.
        Try a supported browser: ${SUPPORTED_BROWSERS}.
      </p>
      <p style="margin:0 0 1.5rem;color:#718096;font-size:0.85rem">${escapeHtml(detail)}</p>
      <a href="../">&larr; all examples</a> &nbsp;·&nbsp; <a href="${REPO_URL}">denoiser on GitHub &rarr;</a>
    </div>`;
  host.appendChild(banner);
}

/**
 * Tiny fixed-corner ms/FPS readout. Call `frame(ms)` once per rendered frame
 * (or per denoise) with the elapsed milliseconds; the overlay shows a smoothed
 * ms + FPS. No deps, no rAF of its own.
 */
export function statsOverlay(): { frame(ms: number): void } {
  const el = document.createElement('div');
  el.setAttribute('data-denoiser-chrome', 'stats');
  el.className = 'dn-stats';
  el.textContent = '-- ms';
  document.body.appendChild(el);

  let smoothed = 0;
  return {
    frame(ms: number) {
      // Exponential moving average so the readout doesn't jitter.
      smoothed = smoothed === 0 ? ms : smoothed * 0.9 + ms * 0.1;
      const fps = smoothed > 0 ? 1000 / smoothed : 0;
      el.textContent = `${smoothed.toFixed(1)} ms\n${fps.toFixed(0)} fps`;
    },
  };
}

/**
 * Injects a small footer: the demo name, a link to this demo's source on GitHub,
 * and a link back to the examples list (`../`). Appended to the page's `.dn-page`
 * column when there is one, else to <body>. Safe to call once per page.
 */
export function demoFooter(name: string): void {
  const footer = document.createElement('footer');
  footer.setAttribute('data-denoiser-chrome', 'footer');
  footer.className = 'dn-footer';
  const sourceUrl = `${REPO_URL}/tree/main/examples/${name}`;
  footer.innerHTML = `
    <span>denoiser · <strong>${escapeHtml(name)}</strong></span>
    <a href="${sourceUrl}">source ↗</a>
    <a href="../">← all examples</a>`;
  (document.querySelector('.dn-page') ?? document.body).appendChild(footer);
}

/**
 * Small dismissible note (call near `demoFooter`, e.g. right after it): the
 * WebGPU path tracer these demos drive is three-gpu-pathtracer's early-stage
 * `WebGPUPathTracer`, SHA-pinned to an upstream main commit in package.json —
 * links to the repo for context.
 * Dismissal is remembered in localStorage so it doesn't nag on every visit.
 */
export function pathtracerNote(): void {
  const KEY = 'denoiser-chrome:pathtracer-note-dismissed';
  try {
    if (localStorage.getItem(KEY) === '1') return;
  } catch {
    /* localStorage unavailable (private mode etc.) — just show the note every time */
  }
  const note = document.createElement('div');
  note.setAttribute('data-denoiser-chrome', 'pathtracer-note');
  note.className = 'dn-pt-note';
  note.innerHTML = `
    <span>Path tracing here runs on the early-stage <code>WebGPUPathTracer</code> from gkjohnson's
      <a href="${PATHTRACER_URL}" target="_blank" rel="noopener">three-gpu-pathtracer</a>,
      pinned to a fixed commit — expect rough edges.</span>
    <button type="button" aria-label="dismiss">&times;</button>`;
  note.querySelector('button')!.addEventListener('click', () => {
    try { localStorage.setItem(KEY, '1'); } catch { /* ignore */ }
    note.remove();
  });
  (document.querySelector('.dn-page') ?? document.body).appendChild(note);
}

export interface RuntimeOption {
  id: string;
  label: string;
  /** Tooltip. */
  hint?: string;
  /** When set, the button is disabled and this explains why (tooltip). */
  unavailable?: string;
}

/**
 * Segmented "denoiser runtime" picker, like the gallery's. Picking a runtime
 * reloads the page with `?runtime=<id>` (other query params kept; the default
 * id removes the param) — the GPUDevice setup differs per runtime, so a fresh
 * page is the robust way to switch. Returns a readout setter for the active
 * runtime / last denoise time.
 *
 * @param o.mount   container (defaults to a new <div> appended to <body>)
 * @param o.options the runtimes, in display order
 * @param o.active  the id the page is running with
 * @param o.defaultId the id used when `?runtime=` is absent (removed from the URL)
 */
export function runtimePicker(o: {
  mount?: HTMLElement;
  options: RuntimeOption[];
  active: string;
  defaultId?: string;
}): { setReadout(text: string): void } {
  const host = o.mount ?? document.body.appendChild(document.createElement('div'));
  host.setAttribute('data-denoiser-chrome', 'runtime-picker');
  // A shell.css control group: label, segmented buttons + readout on one row.
  host.classList.add('dn-group', 'dn-runtime');
  const label = document.createElement('span');
  label.className = 'dn-label';
  label.textContent = 'Denoiser runtime';
  const row = document.createElement('div');
  row.className = 'dn-row';
  const seg = document.createElement('div');
  seg.className = 'dn-seg';
  seg.setAttribute('role', 'group');
  seg.setAttribute('aria-label', 'denoiser runtime');
  o.options.forEach((r) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = r.label;
    btn.dataset.runtime = r.id;
    const pressed = r.id === o.active;
    btn.setAttribute('aria-pressed', String(pressed));
    btn.title = r.unavailable ?? r.hint ?? '';
    btn.disabled = !pressed && !!r.unavailable;
    btn.addEventListener('click', () => {
      if (pressed || btn.disabled) return;
      const url = new URL(location.href);
      if (r.id === o.defaultId) url.searchParams.delete('runtime');
      else url.searchParams.set('runtime', r.id);
      location.href = url.toString();
    });
    seg.appendChild(btn);
  });
  const readout = document.createElement('span');
  readout.setAttribute('data-denoiser-chrome', 'runtime-readout');
  readout.className = 'dn-readout';
  row.append(seg, readout);
  host.append(label, row);
  return { setReadout(text: string) { readout.textContent = text; } };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
