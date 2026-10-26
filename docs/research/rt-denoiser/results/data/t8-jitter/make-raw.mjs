#!/usr/bin/env node
// Review target 8 (results/T8-jitter.md): the "integration error" arm. Builds <src>-raw from a jittered test-bed
// capture <src>: every buffer is a symlink to <src>'s file except motion, which gets the jitter delta added, as three's
// `velocity` node reports it when the camera's projection is jittered and the velocity projection is NOT replaced by the
// unjittered one (velocity.setProjectionMatrix(unjittered), what @pmndrs/upscaler does):
//   velocity = ndc_cur_jittered - ndc_prev_jittered = motion + o_cur - o_prev,  o = (-2 jx / W, +2 jy / H)
// (CAPTURE-FORMAT: the jittered projection adds o to NDC). Frame 0 (reset): o_prev = o_cur (three's first frame).
// The manifest keeps the true jitter, so the capture still describes what was rendered; only motion is wrong.
//
//   node make-raw.mjs <src capture> [<dst name>]      (RT_CAPTURE_DIR as for the other tools)
import { mkdirSync, readdirSync, symlinkSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
const REPO = new URL('../../../../../../', import.meta.url).pathname.replace(/\/$/, '');
const { CAPTURES_DIR, frameDir, readBuffer, readManifest, resolveCapture, writeF32 } = await import(`${REPO}/tools/rt-capture/lib/capture.mjs`);

const src = resolveCapture(process.argv[2]);
const dstName = process.argv[3] ?? `${path.basename(src)}-raw`;
const dst = path.join(CAPTURES_DIR, dstName);
if (existsSync(dst)) throw new Error(`${dst} exists`);
const m = readManifest(src);
const W = m.width, H = m.height;
const o = (j) => [(-2 * j[0]) / W, (2 * j[1]) / H];
for (let f = 0; f < m.frames.length; f++) {
  const fd = frameDir(f);
  mkdirSync(path.join(dst, fd), { recursive: true });
  for (const file of readdirSync(path.join(src, fd))) if (file !== 'motion.f32') symlinkSync(path.join(src, fd, file), path.join(dst, fd, file));
  const mo = readBuffer(src, f, 'motion');
  const jc = m.frames[f].camera.jitter ?? [0, 0];
  const jp = f === 0 || m.frames[f].reset ? jc : (m.frames[f - 1].camera.jitter ?? [0, 0]);
  const [cx, cy] = o(jc), [px, py] = o(jp);
  const dx = cx - px, dy = cy - py;
  for (let i = 0; i < W * H; i++) { mo[2 * i] += dx; mo[2 * i + 1] += dy; }
  writeF32(path.join(dst, fd, 'motion.f32'), mo);
}
m.note = `${m.note ? `${m.note}; ` : ''}T8 integration-error arm of ${path.basename(src)}: motion includes the jitter delta (three's raw velocity under a jittered projection)`;
writeFileSync(path.join(dst, 'capture.json'), JSON.stringify(m, null, 1));
console.log(`${dst}: ${m.frames.length} frames, motion + jitter delta`);
