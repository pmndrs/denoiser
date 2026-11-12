#!/usr/bin/env node
// Track D: screen-space flicker (compare.mjs / CAPTURE-FORMAT: mean |e_t - e_{t-1}| per pixel, not reprojected) and pooled
// PSNR of replay outputs, the only temporal number native NRD has on our captures (native/results/*/compare.json).
//   node flicker.mjs <capture> --den a,b [--signal diffuse]
import path from 'node:path';
const REPO = new URL('../../../../../../', import.meta.url).pathname.replace(/\/$/, '');
const cap = await import(`${REPO}/tools/rt-capture/lib/capture.mjs`);
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i < 0 ? d : args[i + 1]; };
const capDir = cap.resolveCapture(args[0]);
const m = cap.readManifest(capDir);
const sig = opt('signal', 'diffuse');
for (const d of opt('den', '').split(',')) {
  let prev = null, fl = 0, fn = 0, sse = 0, cnt = 0;
  for (let f = 0; f < m.frames.length; f++) {
    const out = cap.readF32(path.join(cap.OUTPUTS_DIR, path.basename(capDir), d, cap.frameDir(f), `${sig}.f32`));
    const r = cap.scoreFrame(out, cap.readBuffer(capDir, f, `${sig}_ref`), cap.readBuffer(capDir, f, 'depth'), 3, f === 0 || m.frames[f].reset ? null : prev);
    if (Number.isFinite(r.flicker)) { fl += r.flicker; fn++; }
    sse += r.sse; cnt += r.sseCount; prev = r.s;
  }
  console.log(`${path.basename(capDir)} ${d}: pooled ${(10 * Math.log10(cnt / sse)).toFixed(2)} dB, flicker ${(fl / fn).toFixed(4)}`);
}
