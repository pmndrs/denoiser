#!/usr/bin/env node
// Tables for results/SHADOWS-MOTION.md from tools/rt-capture/shadow-regions.mjs JSON (one file per capture) and the
// replay outputs (hold-phase "same view, different history" check against the frozen control).
//
//   node docs/research/rt-denoiser/results/data/shadows-motion-table.mjs <dir with <capture>.json> [--variants a,b]
//        [--outputs <root>] [--holdcheck] [--json out.json]
//
// Hold check (--holdcheck): from frame 65 on, every sm-<light>-<motion> capture shows its frozen control's pose with
// the same 1-ray samples (same pose, same frame index), so the outputs differ only through the history: RMS of
// (output - frozen output) over frames 65..79, and each one's pooled PSNR there.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { OUTPUTS_DIR, frameDir, isScored, readBuffer, readF32, resolveCapture } from '../../../../../tools/rt-capture/lib/capture.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i < 0 ? d : args[i + 1]; };
const dir = args[0];
const outRoot = path.resolve(opt('outputs', OUTPUTS_DIR));
const LIGHTS = ['hard', 'sun'], MOTIONS = ['camera', 'light', 'object', 'frozen'];
const caps = LIGHTS.flatMap((l) => MOTIONS.map((mo) => `sm-${l}-${mo}`)).filter((c) => existsSync(path.join(dir, `${c}.json`)));
const J = Object.fromEntries(caps.map((c) => [c, JSON.parse(readFileSync(path.join(dir, `${c}.json`), 'utf8'))]));
const variants = opt('variants') ? opt('variants').split(',') : Object.keys(J[caps[0]].results).filter((v) => v !== 'reference');
const f2 = (x, k = 2) => (Number.isFinite(x) ? x.toFixed(k) : '–');
const out = { tables: {} };

const row = (r) => {
  const R = r.regions, P = r.phases;
  return {
    all: R.all.psnr, edge: R.edge.psnr, soft: R.soft.psnr, contact: R.contact.psnr, changing: R.changing.psnr, static: R.static.psnr,
    umbraBias: R.umbra.bias, litBias: R.lit.bias, edgeBias: R.edge.bias,
    boilEdge: R.edge.boil, boilSoft: R.soft.boil, boilStatic: R.static.boil, boilChanging: R.changing.boil,
    sharpStatic: r.sharpness.static, sharpChanging: r.sharpness.changing, sharpAll: r.sharpness.all,
    lag: r.trailing.lagFrames, trail: r.trailing.trail, arrive: r.trailing.arrive, leave: r.trailing.leave,
    frame0: r.perFrame[0], frame0Edge: r.perFrameEdge[0],
    moveChg: P.move?.changing.psnr, holdChg: P.hold?.changing.psnr, revChg: P.reverse?.changing.psnr,
    moveAll: P.move?.all.psnr, holdAll: P.hold?.all.psnr, hold2All: P.hold2?.all.psnr,
    holdBoilSoft: P.hold?.soft.boil, hold2BoilSoft: P.hold2?.soft.boil, moveBoilSoft: P.move?.soft.boil,
    // the first 4 frames after the stop (25..28) vs the last 4 of the hold (37..40), changing pixels' frame PSNR
    postStop: r.perFrameChanging.slice(25, 29), holdEnd: r.perFrame.slice(37, 41),
  };
};

for (const c of caps) {
  const res = J[c].results;
  const rows = {};
  for (const v of ['noisy', ...variants.filter((v) => v !== 'noisy')]) if (res[v]) rows[v] = row(res[v]);
  rows.reference = { boilEdge: res.reference.regions.edge.boil, boilSoft: res.reference.regions.soft.boil, boilStatic: res.reference.regions.static.boil };
  out.tables[c] = { edgeSpeed: J[c].edgeSpeedPxPerFrame, pixels: Object.fromEntries(Object.entries(res.noisy.regions).map(([k, v]) => [k, v.pixelsPerFrame])), rows };
}

if (args.includes('--holdcheck')) {
  out.hold = {};
  for (const l of LIGHTS) {
    const fz = `sm-${l}-frozen`;
    if (!existsSync(path.join(outRoot, fz))) continue;
    const fzDir = resolveCapture(fz);
    for (const mo of MOTIONS.slice(0, 3)) {
      const c = `sm-${l}-${mo}`;
      if (!existsSync(path.join(outRoot, c))) continue;
      for (const v of variants) {
        if (v === 'noisy' || !existsSync(path.join(outRoot, c, v, frameDir(65), 'visibility.f32')) || !existsSync(path.join(outRoot, fz, v, frameDir(65), 'visibility.f32'))) continue;
        let dd = 0, n = 0, ea = 0, eb = 0;
        const cl = (x) => Math.min(Math.max(x, 0), 1);
        for (let f = 65; f < 80; f++) {
          const a = readF32(path.join(outRoot, c, v, frameDir(f), 'visibility.f32')), b = readF32(path.join(outRoot, fz, v, frameDir(f), 'visibility.f32'));
          const ref = readBuffer(fzDir, f, 'visibility_ref'), depth = readBuffer(fzDir, f, 'depth');
          for (let i = 0; i < a.length; i++) {
            if (!isScored(depth[i])) continue;
            const x = cl(a[i]), y = cl(b[i]);
            dd += (x - y) ** 2; ea += (x - ref[i]) ** 2; eb += (y - ref[i]) ** 2; n++;
          }
        }
        const db = (e) => 10 * Math.log10(1 / Math.max(e / n, 1e-12));
        (out.hold[c] ??= {})[v] = { rmsVsFrozen: Math.sqrt(dd / n), psnr: db(ea), psnrFrozen: db(eb) };
      }
    }
  }
}
if (opt('json')) writeFileSync(opt('json'), JSON.stringify(out, null, 1));

// print
for (const c of caps) {
  const t = out.tables[c];
  console.log(`\n### ${c} (edge speed ${f2(t.edgeSpeed)} px/frame; px/frame ${Object.entries(t.pixels).map(([k, v]) => `${k} ${v}`).join(', ')})\n`);
  console.log('| variant | all | edge | soft | contact | changing | umbra bias | lit bias | boil edge | boil soft | sharp static | sharp chg | lag f | trail | frame 0 | f0 edge | hold chg |');
  console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const [v, r] of Object.entries(t.rows)) {
    if (v === 'reference') { console.log(`| reference (own boil) | | | | | | | | ${f2(r.boilEdge, 4)} | ${f2(r.boilSoft, 4)} | | | | | | | |`); continue; }
    console.log(`| ${v} | ${f2(r.all)} | ${f2(r.edge)} | ${f2(r.soft)} | ${f2(r.contact)} | ${f2(r.changing)} | ${f2(r.umbraBias, 4)} | ${f2(r.litBias, 4)} | ${f2(r.boilEdge, 4)} | ${f2(r.boilSoft, 4)} | ${f2(r.sharpStatic, 3)} | ${f2(r.sharpChanging, 3)} | ${f2(r.lag)} | ${f2(r.trail, 4)} | ${f2(r.frame0)} | ${f2(r.frame0Edge)} | ${f2(r.holdChg)} |`);
  }
}
if (out.hold) {
  console.log('\n### hold check (frames 65-79: RMS vs the frozen control\'s output; PSNR motion / frozen)\n');
  for (const [c, vs] of Object.entries(out.hold)) console.log(`${c}: ${Object.entries(vs).map(([v, r]) => `${v} ${f2(r.rmsVsFrozen, 4)} (${f2(r.psnr)} / ${f2(r.psnrFrozen)})`).join(' · ')}`);
}
