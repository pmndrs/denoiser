// Headless driver for the T6 detection harness (results/T6-boundaries.md); ../t6-boundaries/run.mjs with short file names.
//   node docs/research/rt-denoiser/results/data/t6-boundaries/run.mjs --port=5490 --out=<dir> "path=pan" "path=thin&w=1920&h=1080" ...
// Each query runs in a fresh page; results go to <out>/<slug>.json (PNG dumps as <slug>-f<i>.png).
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { openPage, waitForState } from '../../../../../../tools/rt-capture/lib/headless.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => (args.find((a) => a.startsWith(`--${k}=`)) ?? `--${k}=${d}`).split('=').slice(1).join('=');
const port = opt('port', '5490');
const out = opt('out', 'ug-out');
mkdirSync(out, { recursive: true });
for (const qs of args.filter((a) => !a.startsWith('--'))) {
  const slug = qs.replace(/&?det=[^&]*/, '').replace(/[^a-z0-9=,._-]+/gi, '_');
  const url = `http://127.0.0.1:${port}/index.html?${qs}`;
  const t0 = Date.now();
  const { cdp, close } = await openPage(url);
  try {
    const r = await waitForState(cdp, '__ug', { timeoutMs: 60 * 60_000, intervalMs: 1000 });
    if (r.error) { console.error(qs, 'ERROR', r.error, (r.log ?? []).slice(-5)); continue; }
    const pngs = r.results.pngs ?? {};
    for (const [k, v] of Object.entries(pngs)) writeFileSync(path.join(out, `${slug}-${k}.png`), Buffer.from(v.split(',')[1], 'base64'));
    delete r.results.pngs;
    writeFileSync(path.join(out, `${slug}.json`), JSON.stringify({ query: qs, ...r.results, gtStats: r.gtStats }, null, 1));
    console.log(qs, `${((Date.now() - t0) / 1000).toFixed(1)} s`);
  } finally { await close(); }
}
