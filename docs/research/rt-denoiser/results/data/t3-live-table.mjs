#!/usr/bin/env node
// Live 1080p A/B table (results/T3-light-changes.md): test-bed eval pages (one per path, run-headless --json), every arm
// against the first one. Pooled over paths = 10 log10 of the mean MSE (equal frame and path weights).
//   node t3-live-table.mjs <dir with <path>.json> [--paths orbit,pan,...] [--signals diffuse,specular]
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i < 0 ? d : args[i + 1]; };
const dir = args[0];
const paths = opt('paths', 'orbit,pan,light,thin,glossy,cut,object').split(',');
const sigs = opt('signals', 'diffuse,specular').split(',');
const f = (x, d = 2) => (x === undefined || x === null || !Number.isFinite(Number(x)) ? '–' : Number(x).toFixed(d));
const mse = (db) => 10 ** (-db / 10);
const db = (m) => -10 * Math.log10(m);

for (const s of sigs) {
  const pooled = {};
  const rows = [];
  let arms = null;
  for (const p of paths) {
    const file = path.join(dir, `${p}.json`);
    if (!existsSync(file)) continue;
    const j = JSON.parse(readFileSync(file, 'utf8'));
    const res = (Array.isArray(j) ? j[0] : j).results.results[s];
    if (!res) continue;
    arms ??= Object.keys(res);
    const base = res[arms[0]];
    for (const a of arms) {
      const r = res[a];
      const R = r.regions;
      (pooled[a] ??= { all: [], dis: [], dyn: [], flip: [], flk: [], flkMc: [], stT: [], ms: [] });
      const P = pooled[a];
      P.all.push(mse(r.psnrDenPooled)); P.dis.push(mse(R.disoccluded?.psnrDenPooled ?? NaN)); P.flip.push(r.flipDen); P.flk.push(r.flickerDen); P.flkMc.push(r.flickerMcDen);
      P.ms.push(r.gpuMs?.total);
      rows.push(`| ${p} | ${a} | ${f(r.psnrDenPooled)} (${f(r.psnrDenPooled - base.psnrDenPooled, 3)}) | ${f(R.disoccluded?.psnrDenPooled)} | ${f(R.dynamic?.psnrDenPooled)} | ${f(R.static?.psnrDenPooled)} | ${f(r.flipDen, 4)} (${f(100 * (r.flipDen / base.flipDen - 1), 1)} %) | ${f(r.flickerDen, 4)} | ${f(r.flickerMcDen, 4)} (${f(100 * (r.flickerMcDen / base.flickerMcDen - 1), 1)} %) | ${f(r.gpuMs?.total, 2)} |`);
    }
  }
  console.log(`\n**${s}** (1080p, 96 frames per path; Δ vs ${arms?.[0]})\n`);
  console.log('| path | arm | pooled PSNR (Δ) | disoccluded | dynamic | static | FLIP (Δ) | flicker | flicker mc (Δ) | ms (eval, contended by refs) |');
  console.log('|---|---|---|---|---|---|---|---|---|---|');
  for (const r of rows) console.log(r);
  const mean = (xs) => xs.reduce((u, v) => u + v, 0) / xs.length;
  console.log(`\npooled over ${paths.length} paths:\n`);
  console.log('| arm | pooled PSNR | disoccluded | FLIP (mean) | flicker mc (mean) |');
  console.log('|---|---|---|---|---|');
  for (const [a, P] of Object.entries(pooled)) console.log(`| ${a} | ${f(db(mean(P.all)), 3)} | ${f(db(mean(P.dis)), 3)} | ${f(mean(P.flip), 4)} | ${f(mean(P.flkMc), 5)} |`);
}
