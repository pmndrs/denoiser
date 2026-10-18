// Shared example shell: the top bar every example gets (back to the examples list,
// the example's title, prev / next and a jump menu) and a consistent controls panel.
//
// Imported via a RELATIVE path, like ../../_shared/chrome. The example list comes
// from ./examples.json (the same file the landing page and tools/build-site.mjs
// read), so adding an example there puts it in the landing page AND in every
// example's prev/next/jump menu.
//
// Usage (first thing in the example's entry module):
//
//   import { mountShell, ui } from '../../_shared/shell';
//   const { panel } = mountShell({ id: 'pipeline-lab' });   // id = examples.json entry id
//   panel.append(
//     ui.group('Upscale', ui.segmented({ options: [{ value: 'fsr3', label: 'FSR3' }, { value: 'off', label: 'off' }],
//       value: 'fsr3', onChange: (v) => setUpscale(v) }).el),
//     ui.group('Noise', ui.slider({ min: 1, max: 64, value: 6, onInput: (v) => setSpp(v) }).el, 'samples / pixel'),
//   );
//
// API:
//   mountShell({ id, title?, theme?, panel? }) -> { bar, panel, entry }
//     id     examples.json entry id (unknown ids still get a bar, titled `title ?? id`)
//     title  bar title override (default: the entry's title)
//     theme  false = only add the bar, leave the page's own body styles alone
//            (internal tools); default true = shared dark theme (html.dn-themed)
//     panel  the controls panel to return: an element or selector; default the
//            page's first `.dn-panel`, else a new one inserted after `.dn-head`
//            (or at the top of `.dn-page`, or right after the bar)
//   ui.*   small DOM builders for panel controls, all styled by shell.css:
//            group(label, children, hint?)   segmented({options, value, onChange})
//            toggle(label, checked, onChange)   slider({min, max, step?, value, format?, onInput})
//            select({options, value, onChange})   button(label, onClick, {primary?})
//            readout(text?)
//   examples()  the parsed examples.json (sections, entries, tags)
//
// Static HTML can use the same classes directly: see the class list in shell.css.
// `?shell=0` hides the bar (clean screenshots).
import './shell.css';
import data from './examples.json';

export interface ExampleEntry {
  id: string;
  section: string;
  /** Relative to the site root: `<dir>/` or `<dir>/<page>.html`. */
  href: string;
  title: string;
  description: string;
  tags: string[];
  shot?: string;
  deployed: boolean;
}
export interface ExampleSection { id: string; title: string; blurb: string; internal?: boolean }
export interface ExampleList { tags: Record<string, string>; sections: ExampleSection[]; examples: ExampleEntry[] }

const LIST = data as unknown as ExampleList;
const REPO_URL = 'https://github.com/pmndrs/denoiser';
const SITE_URL = 'https://pmndrs.github.io/denoiser/';

export function examples(): ExampleList { return LIST; }

export interface ShellOptions {
  id: string;
  title?: string;
  theme?: boolean;
  panel?: HTMLElement | string;
}
export interface Shell {
  bar: HTMLElement;
  panel: HTMLElement;
  entry?: ExampleEntry;
}

export function mountShell(o: ShellOptions): Shell {
  const root = document.documentElement;
  if (o.theme !== false) root.classList.add('dn-themed');
  const entry = LIST.examples.find((e) => e.id === o.id);
  const hidden = new URLSearchParams(location.search).get('shell') === '0';

  const bar = document.createElement('header');
  bar.className = 'dn-bar';
  bar.setAttribute('data-denoiser-chrome', 'shell');
  if (!hidden) {
    root.classList.add('dn-has-bar');
    buildBar(bar, o, entry);
    document.body.prepend(bar);
    if (o.theme === false) {
      // Unthemed pages keep their own body margin: pull the bar out to the viewport edges.
      const cs = getComputedStyle(document.body);
      bar.style.margin = `-${cs.marginTop} -${cs.marginRight} ${cs.marginTop} -${cs.marginLeft}`;
    }
  }
  return { bar, panel: resolvePanel(o.panel, bar), entry };
}

function buildBar(bar: HTMLElement, o: ShellOptions, entry?: ExampleEntry) {
  const dir = (entry?.href ?? `${o.id}/`).split('/')[0];
  // Hub (`yarn examples`) and the deployed site serve every example at /<dir>/, so
  // the list is `../`. A standalone `yarn workspace <x> dev` serves the example at
  // `/`: other examples aren't there, so point at the deployed site instead.
  const onHub = location.pathname.includes(`/${dir}/`);
  // Every example page sits one directory deep, so `../` is the site root.
  const rootHref = onHub ? '../' : SITE_URL;
  const listed = LIST.examples.filter((e) => (import.meta.env.DEV && onHub) || e.deployed);
  const internal = new Set(LIST.sections.filter((s) => s.internal).map((s) => s.id));
  const sameKind = entry ? listed.filter((e) => internal.has(e.section) === internal.has(entry.section)) : [];
  const i = entry ? sameKind.findIndex((e) => e.id === entry.id) : -1;
  const href = (e: ExampleEntry) => rootHref + e.href;

  const home = el('a', 'dn-home');
  home.href = rootHref;
  home.title = 'All examples';
  home.innerHTML = '<span aria-hidden="true">&larr;</span><span class="dn-home-label"><b>denoiser</b> examples</span>';

  const title = el('span', 'dn-title');
  title.textContent = o.title ?? entry?.title ?? o.id;
  title.title = entry?.description ?? '';

  const nav = el('nav', 'dn-nav');
  nav.setAttribute('aria-label', 'examples');
  const step = (target: ExampleEntry | undefined, label: string, glyph: string) => {
    const a = el('a', 'dn-iconbtn');
    a.innerHTML = glyph;
    if (target) { a.href = href(target); a.title = `${label}: ${target.title}`; } else { a.setAttribute('aria-disabled', 'true'); a.title = label; }
    a.setAttribute('aria-label', label);
    return a;
  };

  const jump = el('label', 'dn-jump');
  jump.title = 'Jump to another example';
  jump.innerHTML = '<span aria-hidden="true">&#9776;</span><span class="dn-jump-label">Examples</span><span class="dn-caret" aria-hidden="true">&#9662;</span>';
  const sel = document.createElement('select');
  sel.setAttribute('aria-label', 'Jump to example');
  if (!entry) sel.append(new Option(o.title ?? o.id, '', true, true));
  for (const s of LIST.sections) {
    const items = listed.filter((e) => e.section === s.id);
    if (!items.length) continue;
    const g = document.createElement('optgroup');
    g.label = s.title;
    for (const e of items) g.append(new Option(e.title, href(e), false, e.id === entry?.id));
    sel.append(g);
  }
  sel.addEventListener('change', () => { if (sel.value) location.href = sel.value; });
  jump.append(sel);

  nav.append(step(sameKind[i - 1], 'Previous example', '&lsaquo;'), jump, step(i >= 0 ? sameKind[i + 1] : undefined, 'Next example', '&rsaquo;'));

  const src = el('a', 'dn-src');
  src.href = `${REPO_URL}/tree/main/examples/${dir}`;
  src.target = '_blank';
  src.rel = 'noopener';
  src.textContent = 'source ↗';

  bar.append(home, el('span', 'dn-sep', '/'), title, nav, src);
}

function resolvePanel(p: ShellOptions['panel'], bar: HTMLElement): HTMLElement {
  const given = typeof p === 'string' ? document.querySelector<HTMLElement>(p) : p;
  if (given) { given.classList.add('dn-panel'); return given; }
  const existing = document.querySelector<HTMLElement>('.dn-panel');
  if (existing) return existing;
  const panel = el('section', 'dn-panel');
  panel.setAttribute('aria-label', 'controls');
  const head = document.querySelector('.dn-head');
  const page = document.querySelector('.dn-page');
  if (head) head.after(panel);
  else if (page) page.prepend(panel);
  else if (bar.isConnected) bar.after(panel);
  else document.body.prepend(panel);
  return panel;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

// ------------------------------------------------------------------ builders

export interface Opt<T extends string> { value: T; label: string; title?: string; disabled?: boolean }

export const ui = {
  /** A labelled control: `.dn-label` above, children, optional `.dn-hint` below. */
  group(label: string, children: Node | Node[], hint?: string): HTMLElement {
    const g = el('div', 'dn-group');
    g.append(el('span', 'dn-label', label), ...(Array.isArray(children) ? children : [children]));
    if (hint) g.append(el('p', 'dn-hint', hint));
    return g;
  },

  /** Segmented buttons (aria-pressed). `set(v)` updates the selection without firing onChange. */
  segmented<T extends string>(o: { options: Opt<T>[]; value: T; onChange?: (v: T) => void }) {
    const seg = el('div', 'dn-seg');
    seg.setAttribute('role', 'group');
    const buttons = o.options.map((opt) => {
      const b = el('button', undefined, opt.label);
      b.type = 'button';
      b.dataset.v = opt.value;
      if (opt.title) b.title = opt.title;
      b.disabled = !!opt.disabled;
      b.addEventListener('click', () => { if (b.getAttribute('aria-pressed') === 'true') return; set(opt.value); o.onChange?.(opt.value); });
      return b;
    });
    const set = (v: T) => buttons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === v)));
    seg.append(...buttons);
    set(o.value);
    return { el: seg, set };
  },

  /** Checkbox toggle with a text label. */
  toggle(label: string, checked: boolean, onChange?: (on: boolean) => void) {
    const l = el('label', 'dn-check');
    const input = el('input');
    input.type = 'checkbox';
    input.checked = checked;
    input.addEventListener('change', () => onChange?.(input.checked));
    l.append(input, el('span', undefined, label));
    return { el: l, input };
  },

  /** Range slider with a live value readout. */
  slider(o: { min: number; max: number; step?: number; value: number; format?: (v: number) => string; onInput?: (v: number) => void }) {
    const row = el('div', 'dn-row');
    const input = el('input');
    input.type = 'range';
    input.min = String(o.min); input.max = String(o.max); input.step = String(o.step ?? 1); input.value = String(o.value);
    const fmt = o.format ?? ((v: number) => String(v));
    const out = el('output', 'dn-value', fmt(o.value));
    input.addEventListener('input', () => { const v = Number(input.value); out.textContent = fmt(v); o.onInput?.(v); });
    row.append(input, out);
    return { el: row, input, output: out };
  },

  select<T extends string>(o: { options: Opt<T>[]; value: T; onChange?: (v: T) => void }) {
    const s = el('select');
    for (const opt of o.options) {
      const op = new Option(opt.label, opt.value, false, opt.value === o.value);
      op.disabled = !!opt.disabled;
      if (opt.title) op.title = opt.title;
      s.append(op);
    }
    s.addEventListener('change', () => o.onChange?.(s.value as T));
    return { el: s };
  },

  button(label: string, onClick?: (ev: MouseEvent) => void, opts: { primary?: boolean } = {}): HTMLButtonElement {
    const b = el('button', opts.primary ? 'dn-btn dn-btn--primary' : 'dn-btn', label);
    b.type = 'button';
    if (onClick) b.addEventListener('click', onClick);
    return b;
  },

  /** Monospace status / timing line. */
  readout(text = '') {
    const r = el('span', 'dn-readout', text);
    return { el: r, set(t: string) { r.textContent = t; } };
  },
};
