#!/usr/bin/env node
// Long sequences from short captures without copying them (review target D, results/DISTANCE-LONG.md):
// a new capture whose frame folders are symlinks into existing captures, an optional head segment
// played once, then a static hold window repeated until --total frames. Frame 0 is the only reset.
//
//   node tools/rt-capture/loop-capture.mjs <name> --hold=<capture>:<start>:<end> --total=384
//        [--head=<capture>:<start>:<end>] [--avg-refs]
//
//   --hold      frames [start, end) of a capture whose camera, lights and objects don't move and whose
//               every frame's previous pose is the hold pose (zero motion), so any hold frame may follow
//               any other (and the head's last frame, when the head ends on the hold pose)
//   --head      frames played once before the hold (e.g. the arc that arrives at the hold pose)
//   --avg-refs  hold frames get the mean of the hold window's per-frame references (*_ref, ao_ref,
//               so_ref; written once under <name>/refavg/): a static view's per-frame references are
//               independent estimates of one image, so the mean has (end - start)x the samples
//
// The hold input then repeats with period (end - start) frames: choose a window longer than every
// history cap under test. The manifest's top-level `loop` records the layout (holdStart, period, sources).
// Delete with `rm -r` of the folder (links only, plus refavg/).
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { CAPTURES_DIR, frameDir, readF32, writeF32 } from './lib/capture.mjs';

const args = process.argv.slice(2);
const opt = (k) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const name = args.find((a) => !a.startsWith('--'));
if (!name || !opt('hold') || !opt('total')) {
  console.error('usage: loop-capture.mjs <name> --hold=<capture>:<start>:<end> --total=N [--head=<capture>:<start>:<end>] [--avg-refs]');
  process.exit(2);
}
const seg = (s) => { const [c, a, b] = s.split(':'); return { capture: c, start: Number(a), end: Number(b) }; };
const hold = seg(opt('hold'));
const head = opt('head') ? seg(opt('head')) : null;
const total = Number(opt('total'));
const avgRefs = args.includes('--avg-refs');

const man = (c) => JSON.parse(readFileSync(path.join(CAPTURES_DIR, c, 'capture.json'), 'utf8'));
const mHold = man(hold.capture);
const mHead = head ? man(head.capture) : null;
const bufKey = (m) => m.buffers.map((b) => `${b.name}:${b.channels}`).sort().join(',');
if (mHead && (bufKey(mHead) !== bufKey(mHold) || mHead.width !== mHold.width || mHead.height !== mHold.height)) {
  throw new Error(`head ${head.capture} and hold ${hold.capture} differ in size or buffers`);
}
const period = hold.end - hold.start;
if (!(period > 0)) throw new Error('empty hold window');

const out = path.join(CAPTURES_DIR, name);
if (existsSync(out)) rmSync(out, { recursive: true });
mkdirSync(out, { recursive: true });

// mean references of the hold window
const isRef = (b) => b.endsWith('_ref');
const refNames = mHold.buffers.map((b) => b.name).filter(isRef);
const N = mHold.width * mHold.height;
if (avgRefs) {
  mkdirSync(path.join(out, 'refavg'), { recursive: true });
  for (const r of refNames) {
    const ch = mHold.buffers.find((b) => b.name === r).channels;
    const acc = new Float64Array(N * ch);
    for (let f = hold.start; f < hold.end; f++) {
      const d = readF32(path.join(CAPTURES_DIR, hold.capture, frameDir(f), `${r}.f32`));
      for (let i = 0; i < acc.length; i++) acc[i] += d[i];
    }
    const mean = new Float32Array(acc.length);
    for (let i = 0; i < acc.length; i++) mean[i] = acc[i] / period;
    writeF32(path.join(out, 'refavg', `${r}.f32`), mean);
  }
}

const frames = [];
const link = (srcCap, srcFrame, k, isHold) => {
  const dst = path.join(out, frameDir(k));
  mkdirSync(dst);
  const src = path.join(CAPTURES_DIR, srcCap, frameDir(srcFrame));
  for (const f of readdirSync(src)) {
    const b = f.replace(/\.f32$/, '');
    const target = avgRefs && isHold && refNames.includes(b) ? path.join(out, 'refavg', f) : path.join(src, f);
    symlinkSync(target, path.join(dst, f));
  }
  const m = srcCap === hold.capture ? mHold : mHead;
  const fr = m.frames.find((x) => x.index === srcFrame);
  frames.push({ ...fr, index: k, reset: k === 0, loopSource: { capture: srcCap, frame: srcFrame } });
};
let k = 0;
if (head) for (let f = head.start; f < head.end && k < total; f++) link(head.capture, f, k++, false);
const holdStart = k;
while (k < total) link(hold.capture, hold.start + ((k - holdStart) % period), k++, true);

const manifest = {
  ...mHold,
  frames,
  // extra manifest keys live at the top level (ignored by v0 readers)
  loop: {
    generator: 'tools/rt-capture/loop-capture.mjs',
    head: head ? { ...head, frames: holdStart } : null,
    hold: { ...hold, period },
    holdStart, total,
    references: avgRefs ? `hold frames: mean of the ${period} per-frame references of the hold window (refavg/)` : 'per-frame (linked)',
  },
};
writeFileSync(path.join(out, 'capture.json'), JSON.stringify(manifest, null, 1));
console.log(`${name}: ${total} frames (${holdStart} head + hold period ${period})${avgRefs ? ', averaged hold references' : ''} -> ${out}`);
