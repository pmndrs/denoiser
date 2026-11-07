// Drive the test bed's replay page (examples/realtime-denoiser, mode=replay) in headless Chrome:
// one run per query, outputs under $RT_CAPTURE_DIR/outputs/<capture>/<output|denoiser>/.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureVite, REPO_ROOT } from '../../rt-capture/lib/headless.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const TESTBED = path.join(REPO_ROOT, 'examples', 'realtime-denoiser');

export async function startServer(base, log) {
  return ensureVite({ root: TESTBED, base, log });
}

/** queries: query-string list; returns the parsed summary of each (null on failure). */
export function replayQueries(queries, opts) {
  const results = replayOnce(queries, opts);
  // a replay can lose the GPU device when other jobs run alongside (LESSONS): retry the failed ones once
  const failed = queries.filter((_, i) => !results[i]);
  if (failed.length && failed.length < queries.length + 1) {
    (opts.log ?? console.log)(`retrying ${failed.length} failed replay(s)`);
    const again = replayOnce(failed, opts);
    let k = 0;
    queries.forEach((_, i) => { if (!results[i]) results[i] = again[k++] ?? null; });
  }
  return results;
}

function replayOnce(queries, { base, captureDir, log = console.log }) {
  const r = spawnSync(process.execPath, [path.join(TESTBED, 'run-headless.mjs'), ...queries], {
    encoding: 'utf8', maxBuffer: 1 << 28,
    env: { ...process.env, BASE: base, RT_CAPTURE_DIR: captureDir },
  });
  const results = [];
  for (const line of (r.stdout ?? '').split('\n')) {
    if (!line.startsWith('{"ready"')) continue;
    try { const j = JSON.parse(line); results.push(j.ready ? j.results : null); } catch { results.push(null); }
  }
  if (r.status !== 0 || results.length !== queries.length || results.some((x) => !x)) {
    log(`replay problems (exit ${r.status}): ${results.filter(Boolean).length}/${queries.length} runs ok`);
    log((r.stdout ?? '').split('\n').filter((l) => /error|ready":false|unknown denoiser/i.test(l)).slice(0, 6).join('\n'));
  }
  return results;
}
void HERE;
