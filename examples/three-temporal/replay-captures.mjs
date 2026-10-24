#!/usr/bin/env node
// Replays the three-temporal moving-camera captures (CAPTURES.md here) through registry denoisers
// (tools/rt-capture/src/denoisers.ts) on the test bed's replay page, then scores them with
// score-captures.mjs (pooled PSNR, penumbra, FLIP, flicker; AO against ao_ref).
//
//   node examples/three-temporal/replay-captures.mjs [--captures three-orbit,three-pan]
//        [--denoisers <id[:signals]>,...] [--json out.json] [--no-score]
//
// Needs the test bed's dev server (examples/realtime-denoiser) at $BASE (default http://127.0.0.1:5220/);
// pin denoiser/realtime with RT_REALTIME_SRC when another agent edits the package (LESSONS). The
// default list is the moving-camera comparison of results/M6-real-scene.md.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const a = args.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };

export const DEFAULT_DENOISERS = [
  'shadows', 'ffx-shadows', 'accumulate-32',
  'svgf', 'svgf-auto', 'recurrent', 'ffx-reflections',
  'occlusion-svgf:ao', 'occlusion-svgf-auto:ao', 'occlusion-recurrent:ao',
];
const captures = opt('captures', 'three-orbit,three-pan').split(',');
const dens = opt('denoisers', DEFAULT_DENOISERS.join(',')).split(',');
const queries = captures.flatMap((c) => dens.map((d) => {
  const [id, signals] = d.split(':');
  return `mode=replay&capture=${c}&denoiser=${id}${signals ? `&signals=${signals}` : ''}`;
}));
console.log(`${queries.length} replays on ${process.env.BASE ?? 'http://127.0.0.1:5220/'}`);
const r = spawnSync(process.execPath, [path.join(REPO, 'examples', 'realtime-denoiser', 'run-headless.mjs'), ...queries], { stdio: 'inherit', env: process.env });
if (r.status !== 0) { console.error(`run-headless exited ${r.status}`); process.exit(r.status ?? 1); }
if (!args.includes('--no-score')) {
  const s = spawnSync(process.execPath, [path.join(HERE, 'score-captures.mjs'), ...captures, ...(opt('json') ? ['--json', opt('json')] : [])], { stdio: 'inherit', env: process.env });
  process.exit(s.status ?? 0);
}
