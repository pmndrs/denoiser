// The examples landing page, rendered from examples/_shared/examples.json (the one
// example list the example shell's top bar also uses) into examples/site/index.html,
// which is a template with a `<!-- @examples -->` slot.
//
// Used by tools/examples.mjs (the `yarn examples` dev hub, `dev: true`: tools &
// tests link to their local pages) and tools/build-site.mjs (the deployed site:
// only `deployed` entries get a page; tools & tests link to their source).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
export const siteDir = path.join(root, 'examples', 'site');
const listFile = path.join(root, 'examples', '_shared', 'examples.json');
const REPO_URL = 'https://github.com/pmndrs/denoiser';

/** The parsed examples.json ({ tags, sections, examples }). */
export function exampleList() {
  return JSON.parse(readFileSync(listFile, 'utf8'));
}

/** Example directories that deploy (unique, in list order). */
export function deployedDirs() {
  return [...new Set(exampleList().examples.filter((e) => e.deployed).map((e) => e.href.split('/')[0]))];
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
/** Plain text with `code` spans. */
const rich = (s) => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>');

function card(e, tagInfo) {
  const shot = e.shot
    ? `<img class="shot" src="./shots/${esc(e.shot)}" alt="" loading="lazy">`
    : `<div class="shot shot--empty" aria-hidden="true">${esc(e.title)}</div>`;
  const tags = e.tags.map((t) => `<li title="${esc(tagInfo[t] ?? '')}">${esc(t)}</li>`).join('');
  return `
        <a class="card" href="./${esc(e.href)}" data-tags="${esc(e.tags.join('|'))}">
          ${shot}
          <div class="card-body">
            <h3 class="card-title">${esc(e.title)} <span class="arrow" aria-hidden="true">&rarr;</span></h3>
            <p class="card-desc">${rich(e.description)}</p>
            <ul class="tags">${tags}</ul>
          </div>
        </a>`;
}

function toolRow(e, dev) {
  const dir = e.href.split('/')[0];
  const href = dev ? `./${e.href}` : `${REPO_URL}/tree/main/examples/${dir}`;
  const where = dev ? '' : ' <span class="ext">source &#8599;</span>';
  return `
          <li data-tags="${esc(e.tags.join('|'))}"><a href="${esc(href)}"${dev ? '' : ' target="_blank" rel="noopener"'}><code>${esc(dir)}</code> ${esc(e.title)}${where}</a>
            <span>${rich(e.description)}</span></li>`;
}

/**
 * The landing page HTML.
 * @param {{ dev?: boolean }} o dev: link tools & tests to their local pages (hub)
 */
export function renderLanding({ dev = false } = {}) {
  const { tags, sections, examples } = exampleList();
  const html = readFileSync(path.join(siteDir, 'index.html'), 'utf8');
  const usedTags = Object.keys(tags).filter((t) => examples.some((e) => !isInternal(e) && e.tags.includes(t)));
  function isInternal(e) { return sections.find((s) => s.id === e.section)?.internal; }

  const filter = `
      <div class="filters" role="toolbar" aria-label="filter by tag" hidden>
        <button type="button" data-tag="" aria-pressed="true">All</button>${usedTags
    .map((t) => `<button type="button" data-tag="${esc(t)}" aria-pressed="false" title="${esc(tags[t])}">${esc(t)}</button>`).join('')}
      </div>`;

  const body = sections.map((s) => {
    const items = examples.filter((e) => e.section === s.id && (dev || e.deployed || s.internal));
    if (!items.length) return '';
    const head = `
      <div class="section-head">
        <h2>${esc(s.title)}</h2>
        <p>${rich(s.blurb)}</p>
      </div>`;
    if (s.internal) {
      return `
      <section class="group tools" id="${esc(s.id)}">${head}
        <ul class="toollist">${items.map((e) => toolRow(e, dev)).join('')}
        </ul>
      </section>`;
    }
    return `
      <section class="group" id="${esc(s.id)}">${head}
        <div class="grid">${items.map((e) => card(e, tags)).join('')}
        </div>
      </section>`;
  }).join('');

  return html.replace('<!-- @examples -->', filter + body);
}
