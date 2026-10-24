#!/usr/bin/env node
// Run the replay page in headless Chrome (WebGPU) and print each run's summary.
// Works on macOS, Windows and Linux (lib/headless.mjs: Chrome path per platform, temp
// profile under os.tmpdir(), no shell). From the repo root:
//
//   node tools/rt-capture/run-headless.mjs --serve "capture=synthetic-plane&denoiser=accumulate" \
//        "capture=synthetic-plane&denoiser=passthrough" [--json=out.json]
//
//   --serve     start the Vite dev server for tools/rt-capture if nothing answers at BASE
//               (and stop it afterwards); without it, start it yourself:
//               node node_modules/vite/bin/vite.js tools/rt-capture --port 5230 --strictPort --host 127.0.0.1
//   env: BASE (default http://127.0.0.1:5230/), CHROME (Chrome executable), CHROME_FLAGS,
//        RT_CAPTURE_DIR (where captures/ and outputs/ live; read by the dev server)
//
// Then score: node tools/rt-capture/compare.mjs synthetic-plane
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { ensureVite, openPage, REPO_ROOT, waitForState } from './lib/headless.mjs';

const BASE = process.env.BASE ?? 'http://127.0.0.1:5230/';
const args = process.argv.slice(2);
const jsonOut = args.find((a) => a.startsWith('--json='))?.slice(7);
const RUNS = args.filter((a) => !a.startsWith('--'));
if (!RUNS.length) RUNS.push('capture=synthetic-plane&denoiser=passthrough', 'capture=synthetic-plane&denoiser=accumulate');

async function run(query) {
  const { cdp, close } = await openPage(`${BASE}?${query}`);
  try {
    const r = await waitForState(cdp, '__rtc', { timeoutMs: 30 * 60_000 });
    r.log = await cdp.evalJs(`document.querySelector('#status').textContent`).catch(() => '');
    return r;
  } finally {
    await close();
  }
}

const server = args.includes('--serve') ? await ensureVite({ root: path.join(REPO_ROOT, 'tools', 'rt-capture'), base: BASE }) : null;
const all = [];
let failed = 0;
try {
  for (const query of RUNS) {
    console.log(`\n=== ${query}`);
    try {
      const r = await run(query);
      if (r.error) { failed++; console.log(r.log); console.log(`ERROR: ${r.error}`); } else console.log(JSON.stringify(r.results));
      all.push({ query, ...r });
    } catch (err) {
      failed++;
      console.log(`FAILED: ${err.stack ?? err}`);
      all.push({ query, error: String(err) });
    }
  }
} finally {
  await server?.stop();
}
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(all, null, 1));
process.exit(failed ? 1 : 0);
