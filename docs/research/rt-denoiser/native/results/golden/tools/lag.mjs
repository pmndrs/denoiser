#!/usr/bin/env node
// Light-change lag (harness builder's tool, outside the repo), with track D's definition (calm-table.mjs lagOf):
//   per-frame error  calm.mjs perFrameMse (Reinhard-mapped, all scored pixels)
//   settled          mean MSE of the last --settle frames (16)
//   t                first frame from which every later frame is <= 1.1 x settled
//   lag              t - event (0 if the error never leaves the band after the event)
// Also: peak MSE after the event / settled, pre-event MSE (8 frames before) / settled.
//   node lag.mjs <calm.json> --event 32 [--signals diffuse,specular] [--settle 16] [--json out.json]
import { readFileSync, writeFileSync } from 'node:fs';
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i < 0 ? d : args[i + 1]; };
const j = JSON.parse(readFileSync(args[0], 'utf8'));
const ev = Number(opt('event', 32)), SETTLE = Number(opt('settle', 16));
const sigs = opt('signals', 'diffuse,specular').split(',');
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const out = [];
for (const [key, v] of Object.entries(j.rows)) {
  const [s, d] = key.split('|');
  if (!sigs.includes(s) || !v.perFrameMse) continue;
  const mse = v.perFrameMse, n = mse.length;
  const settled = mean(mse.slice(n - SETTLE));
  let t = n;
  for (let k = n - 1; k >= 0; k--) { if (mse[k] <= 1.1 * settled) t = k; else break; }
  const lag = Math.max(0, t - ev);
  const peak = Math.max(...mse.slice(ev, n - SETTLE));
  const pre = mean(mse.slice(Math.max(1, ev - 8), ev));
  // lagPre: frames after the event until MSE is <= 1.1 x the pre-event level for 3 consecutive frames (robust to the
  // camera's own drift of the error late in the path, which can make the settled-band lag read 'never')
  let lagPre = null;
  for (let k = 0; ev + k + 2 < n; k++) if ([0, 1, 2].every((q) => mse[ev + k + q] <= 1.1 * pre)) { lagPre = k; break; }
  out.push({ signal: s, denoiser: d, lag, lagPre, t, peakOverPre: peak / pre, peakOverSettled: peak / settled, preOverSettled: pre / settled, settledMse: settled });
}
console.log(`event at frame ${ev}. lag (track D's definition): frames after the event until MSE stays <= 1.1 x settled (mean of the last ${SETTLE} frames) to the end; ` +
  `a value of ${j.frames - ev} means "never" (often the camera's own late drift, see lag-to-pre). lag-to-pre: frames until MSE <= 1.1 x the pre-event level (mean of the 8 frames before) for 3 frames in a row\n`);
console.log('| signal | denoiser | lag (settled band) | lag-to-pre | peak / pre-event | peak / settled | pre-event / settled | settled PSNR dB |');
console.log('|---|---|---|---|---|---|---|---|');
for (const r of out) if (r.denoiser !== 'ref') console.log(`| ${r.signal} | ${r.denoiser} | ${r.lag} | ${r.lagPre ?? 'never'} | ${r.peakOverPre.toFixed(2)} | ${r.peakOverSettled.toFixed(2)} | ${r.preOverSettled.toFixed(2)} | ${(-10 * Math.log10(r.settledMse)).toFixed(2)} |`);
if (opt('json')) writeFileSync(opt('json'), JSON.stringify({ capture: j.capture, event: ev, settle: SETTLE, rows: out }, null, 1));
