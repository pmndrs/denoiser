#!/usr/bin/env node
// Markdown tables from reflect-build eval JSON (run-headless --json, one file per rm-* path; results/REFLECTION-MOTION.md).
//
//   node rm-table.mjs <dir with rm-*.json> [--den a,b,c] [--section oracle|marker|frame|all] [--paths p1,p2]
//
// oracle: per path and marker, the true image motion and the noise-free correspondence error of surface
//         reprojection and of the SPEC R-9 virtual image (true curvature and hit distance), plus the renderer's
//         geometry checks against the CPU oracle
// marker: per path, marker and denoiser, the ROI metrics while moving and after the stop (src/reflect-eval.ts)
// frame:  full-frame specular: pooled PSNR, the reflector's roughness bin, dynamic region, FLIP, motion-compensated flicker
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i < 0 ? d : args[i + 1]; };
const dir = args[0];
const section = opt('section', 'all');
const only = opt('paths')?.split(',');
const runs = readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => {
  const j = JSON.parse(readFileSync(path.join(dir, f), 'utf8'));
  return Array.isArray(j) ? j[0] : j;
}).filter((r) => r?.results?.reflect && (!only || only.includes(r.results.path)));
const order = ['rm-cam-plane', 'rm-cam-plane-r10', 'rm-cam-plane-r20', 'rm-cam-plane-r35', 'rm-cam-plane-r50', 'rm-bump-plane', 'rm-graze-plane',
  'rm-obj-plane', 'rm-obj-exit', 'rm-refl-slide', 'rm-refl-turn', 'rm-cam-convex', 'rm-obj-convex', 'rm-refl-ball', 'rm-cam-concave', 'rm-cut-plane'];
runs.sort((a, b) => order.indexOf(a.results.path) - order.indexOf(b.results.path));
const f = (x, d = 2) => (x === null || x === undefined || Number.isNaN(Number(x)) ? '–' : Number(x).toFixed(d));
const dens = (r) => opt('den')?.split(',') ?? ['noisy', ...Object.keys(r.results.results.specular)];
const short = (k) => k.replace('reflectionReprojection=', 'rr=').replace('recurrent-specular', 'recurrent').replace('@r.virtualMotion=false', ' (no virtual)');

if (section === 'oracle' || section === 'all') {
  console.log('| path | marker | image motion px/f | surface reproj. err px | virtual (R-9) err px | ref vs oracle px | multi-image frames |');
  console.log('|---|---|---|---|---|---|---|');
  for (const r of runs) for (const m of r.results.reflect.markers) {
    if (!m) continue;
    console.log(`| ${r.results.path} | ${m.marker} | ${f(m.imageMotionPx)} | ${f(m.oracleSurfaceErrPx)} | ${f(m.oracleVirtualErrPx)} | ${f(m.refPosErrPx)} | ${m.multiImageFrames} |`);
  }
  console.log('\n| path | checked px | non-reflector | view z abs (max) | normal deg (max) | motion px (max) | mirror hit dist rel (max) |');
  console.log('|---|---|---|---|---|---|---|');
  for (const r of runs) {
    const g = r.results.reflect.geometry;
    console.log(`| ${r.results.path} | ${g.checkedPixels} | ${g.nonReflectorHits} | ${f(g.viewzAbs.max, 4)} | ${f(g.normalDeg.max, 3)} | ${f(g.motionPx.max, 3)} | ${f(g.hitDistRel.max, 4)} |`);
  }
  console.log();
}
if (section === 'marker' || section === 'all') {
  console.log('| path | m | denoiser | ROI dB moving | ROI dB hold | settled | pos err px | lag px | trail px | ghost | dup frames | ghost @stop+1 | recovery f | ghost gone f |');
  console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of runs) for (const m of r.results.reflect.markers) {
    if (!m) continue;
    for (const k of dens(r)) {
      const v = m.results[k];
      if (!v) continue;
      console.log(`| ${r.results.path} | ${m.marker} | ${short(k)} | ${f(v.roiPsnrMoving)} | ${f(v.roiPsnrHold)} | ${f(v.roiPsnrSettled)} | ${f(v.posErrMoving)} | ${f(v.lagMoving)} | ${f(v.trailMoving, 1)} | ${f(v.ghostMoving, 3)} | ${v.dupFramesMoving}/${m.movingFrames} | ${f(v.ghostHold1, 3)} | ${v.recovery ?? '–'} | ${v.absentFrames ? v.ghostGone ?? '–' : '–'} |`);
    }
  }
  console.log();
}
if (section === 'frame' || section === 'all') {
  console.log('| path | denoiser | pooled dB | reflector bin dB | dynamic dB | FLIP | flicker (mc) |');
  console.log('|---|---|---|---|---|---|---|');
  for (const r of runs) {
    const R = r.results;
    const rough = R.path.match(/-r(\d+)$/) ? Number(R.path.match(/-r(\d+)$/)[1]) / 100 : 0.02;
    const bin = rough < 0.15 ? 'rough<0.15' : rough < 0.35 ? 'rough<0.35' : rough < 0.6 ? 'rough<0.6' : 'rough>=0.6';
    const any = Object.values(R.results.specular)[0];
    console.log(`| ${R.path} | noisy | ${f(any.psnrNoisyPooled)} | ${f(any.regions[bin].psnrNoisy)} | ${f(any.regions.dynamic?.psnrNoisy)} | ${f(any.flipNoisy, 4)} | ${f(any.flickerMcNoisy, 4)} |`);
    for (const [k, v] of Object.entries(R.results.specular)) {
      if (opt('den') && !opt('den').split(',').includes(k)) continue;
      console.log(`| ${R.path} | ${short(k)} | ${f(v.psnrDenPooled)} | ${f(v.regions[bin].psnrDen)} | ${f(v.regions.dynamic?.psnrDen)} | ${f(v.flipDen, 4)} | ${f(v.flickerMcDen, 4)} |`);
    }
  }
}
