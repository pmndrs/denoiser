#!/usr/bin/env node
// Run the real-time denoiser test bed in headless Chrome (WebGPU) and print JSON results.
// Works on macOS, Windows and Linux (../../tools/rt-capture/lib/headless.mjs: Chrome path
// per platform, temp profile under os.tmpdir(), no shell). From the repo root or here:
//
//   node run-headless.mjs --serve                          # eval, all signals, orbit path (fast preset)
//   node run-headless.mjs "signal=all&path=pan&mode=eval" "signal=shadows&mode=bench"
//   node run-headless.mjs --json=out/pan.json "signal=all&path=pan&mode=eval&preset=full"
//   node run-headless.mjs --all-paths "signal=all&mode=eval&preset=full"   # one run per path
//   node run-headless.mjs --shot=out/diffuse-40.png "signal=diffuse&path=glossy&stopAt=40"
//
// Captures (CAPTURES.md):
//   node run-headless.mjs --serve --set=standard           # write + validate the standard capture set
//   node run-headless.mjs --serve --set=standard --replay=accumulate,ffx-shadows
//                                                          # replay every capture of the set, then compare.mjs
//   node run-headless.mjs "mode=capture&name=my-orbit&path=orbit&frames=16"
//   node run-headless.mjs "mode=replay&capture=my-orbit&denoiser=accumulate"
//
//   --serve       start the test bed's Vite server if nothing answers at BASE (stopped at the end)
//   --no-validate skip tools/rt-capture/validate.mjs after each --set capture
//   env: BASE (default http://127.0.0.1:5220/), CHROME (Chrome executable), CHROME_FLAGS,
//        WINDOW=420,1800 (window size), RT_CAPTURE_DIR (captures/ + outputs/ root, read by
//        the dev server and by validate/compare)
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureVite, openPage, REPO_ROOT, waitForState } from '../../tools/rt-capture/lib/headless.mjs';
import { CAPTURE_SETS, captureQuery } from './capture-sets.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE ?? 'http://127.0.0.1:5220/';
const args = process.argv.slice(2);
const flag = (k) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const shot = flag('shot');
const jsonOut = flag('json');
const setName = flag('set');
const replayIds = flag('replay')?.split(',').filter(Boolean);
const allPaths = args.includes('--all-paths');
const PATHS = ['orbit', 'pan', 'light', 'thin', 'glossy', 'cut', 'object'];
const queries = args.filter((a) => !a.startsWith('--'));

const set = setName ? CAPTURE_SETS[setName] : null;
if (setName && !set) { console.error(`unknown --set=${setName} (have: ${Object.keys(CAPTURE_SETS).join(', ')})`); process.exit(2); }
let RUNS;
if (set && replayIds) RUNS = set.flatMap((c) => replayIds.map((id) => `mode=replay&capture=${c.name}&denoiser=${id}`));
else if (set) RUNS = set.map(captureQuery);
else RUNS = queries.length ? queries : ['signal=all&mode=eval'];
if (allPaths) RUNS = RUNS.flatMap((qq) => PATHS.map((p) => `${qq}&path=${p}`));

const node = (script, ...a) => spawnSync(process.execPath, [path.join(REPO_ROOT, 'tools', 'rt-capture', script), ...a], { stdio: 'inherit', env: process.env }).status;

async function run(query) {
  const { cdp, close } = await openPage(`${BASE}?${query}`, { windowSize: process.env.WINDOW ?? '1960,1000' });
  try {
    const r = await waitForState(cdp, '__rt', { timeoutMs: 45 * 60_000, intervalMs: 1000 });
    if (shot && r.ready) {
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
      mkdirSync(path.dirname(path.resolve(shot)), { recursive: true });
      writeFileSync(shot, Buffer.from(data, 'base64'));
      r.screenshot = path.resolve(shot);
    }
    r.log = await cdp.evalJs(`document.querySelector('#status').textContent`).catch(() => '');
    return r;
  } finally {
    await close();
  }
}

const server = args.includes('--serve') ? await ensureVite({ root: HERE, base: BASE }) : null;
const all = [];
let failed = 0;
try {
  for (const query of RUNS) {
    console.log(`\n=== ${query}`);
    try {
      const r = await run(query);
      console.log(r.log);
      delete r.log;
      console.log(JSON.stringify(r, (k, v) => (k === 'perFrame' ? undefined : v)));
      if (r.error || !r.ready) failed++;
      all.push({ query, ...r });
      const name = new URLSearchParams(query).get('mode') === 'capture' && r.results?.capture?.name;
      if (name && set && !args.includes('--no-validate')) {
        const st = node('validate.mjs', name, '--quiet');
        console.log(`validate ${name}: ${st === 0 ? 'ok' : 'FAILED'}`);
        if (st !== 0) failed++;
      }
    } catch (err) {
      failed++;
      console.log(`FAILED: ${err.stack ?? err}`);
      all.push({ query, error: String(err) });
    }
  }
} finally {
  await server?.stop();
}
if (set && replayIds) for (const c of set) node('compare.mjs', c.name, ...replayIds);
if (set && !replayIds) {
  const bytes = all.reduce((a, r) => a + (r.results?.capture?.totalBytes ?? 0), 0);
  console.log(`\nset ${setName}: ${all.filter((r) => r.ready).length}/${set.length} captures, ${(bytes / 1e9).toFixed(2)} GB (${(bytes / 2 ** 30).toFixed(2)} GiB)`);
}
if (jsonOut) { mkdirSync(path.dirname(path.resolve(jsonOut)), { recursive: true }); writeFileSync(jsonOut, JSON.stringify(all, null, 1)); }
process.exit(failed ? 1 : 0);
