#!/usr/bin/env node
// Rule-9 A/B tables for f16Rounding 'nearest' (results/DISTANCE-LONG.md §6) from run-headless.mjs --json outputs of
// the test bed (live eval pages with variant ids `<id>@<key>=nearest`) and score-captures.mjs --json (real scenes).
//
//   node distance-long-ab.mjs live <live-*.json ...>     # per path and pooled over the paths
//   node distance-long-ab.mjs scenes <scenes.json>       # replay pairs dl-<id> vs dl-<id>-rn
import { readFileSync } from 'node:fs';

const [mode, ...files] = process.argv.slice(2);
const dbOf = (mse) => -10 * Math.log10(mse);
const mseOf = (db) => 10 ** (-db / 10);
const f = (x, d = 3) => (Number.isFinite(x) ? (x >= 0 ? '+' : '') + x.toFixed(d) : '–');
const pc = (a, b) => (Number.isFinite(a) && Number.isFinite(b) && a !== 0 ? f(((b - a) / Math.abs(a)) * 100, 1) + ' %' : '–');
const isVariant = (id) => /@(r\.|sh\.)?f16Rounding=nearest$/.test(id);
const baseOf = (id) => id.replace(/@(r\.|sh\.)?f16Rounding=nearest$/, '');

if (mode === 'live') {
  const rows = [];
  for (const file of files) {
    for (const run of JSON.parse(readFileSync(file, 'utf8'))) {
      const R = run.results;
      if (!R?.results) { console.error(`skip ${file}: ${run.error ?? 'no results'}`); continue; }
      for (const [signal, dens] of Object.entries(R.results)) {
        if (typeof dens !== 'object' || !dens) continue;
        for (const [id, b] of Object.entries(dens)) {
          if (!isVariant(id) && dens[`${id}`] && Object.keys(dens).some((k) => isVariant(k) && baseOf(k) === id)) {
            const vId = Object.keys(dens).find((k) => isVariant(k) && baseOf(k) === id);
            rows.push({ path: R.path, signal, id, a: b, b: dens[vId], spp: R.refSpp });
          }
        }
      }
    }
  }
  const reg = (x, k) => x.regions?.[k]?.psnrDen;
  console.log('| signal | filter | path | Δ PSNR pooled | Δ settled | Δ penumbra / contact | Δ disoccluded | Δ FLIP | Δ flicker | Δ static flicker | Δ dynamic flicker |');
  console.log('|---|---|---|---|---|---|---|---|---|---|---|');
  const groups = new Map();
  for (const r of rows) {
    const { a, b } = r;
    const k = `${r.signal}|${r.id}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
    console.log(`| ${r.signal} | ${r.id} | ${r.path} | ${f(b.psnrDenPooled - a.psnrDenPooled)} | ${f(b.psnrDenSettledPooled - a.psnrDenSettledPooled)} | ${f(reg(b, 'penumbra') - reg(a, 'penumbra'))} | ${f(reg(b, 'disoccluded') - reg(a, 'disoccluded'))} | ${pc(a.flipDen, b.flipDen)} | ${pc(a.flickerDen, b.flickerDen)} | ${pc(a.regions?.['static-temporal']?.biasDen, b.regions?.['static-temporal']?.biasDen)} | ${pc(a.regions?.['dynamic-temporal']?.biasDen, b.regions?.['dynamic-temporal']?.biasDen)} |`);
  }
  console.log('\nPooled over the paths (PSNR of the mean MSE of the per-path pooled values, equal path weights; FLIP / flicker: mean):\n');
  console.log('| signal | filter | paths | PSNR native | PSNR nearest | Δ | worst path Δ | Δ FLIP | Δ flicker | Δ penumbra / contact (pooled) |');
  console.log('|---|---|---|---|---|---|---|---|---|---|');
  for (const [k, rs] of groups) {
    const [signal, id] = k.split('|');
    const pool = (sel) => dbOf(rs.reduce((s, r) => s + mseOf(sel(r)), 0) / rs.length);
    const m = (sel) => rs.reduce((s, r) => s + sel(r), 0) / rs.length;
    const pa = pool((r) => r.a.psnrDenPooled), pb = pool((r) => r.b.psnrDenPooled);
    const worst = Math.min(...rs.map((r) => r.b.psnrDenPooled - r.a.psnrDenPooled));
    const okPen = rs.every((r) => Number.isFinite(reg(r.a, 'penumbra')));
    console.log(`| ${signal} | ${id} | ${rs.length} | ${pa.toFixed(3)} | ${pb.toFixed(3)} | ${f(pb - pa)} | ${f(worst)} | ${pc(m((r) => r.a.flipDen), m((r) => r.b.flipDen))} | ${pc(m((r) => r.a.flickerDen), m((r) => r.b.flickerDen))} | ${okPen ? f(pool((r) => reg(r.b, 'penumbra')) - pool((r) => reg(r.a, 'penumbra'))) : '–'} |`);
  }
} else if (mode === 'scenes') {
  const J = JSON.parse(readFileSync(files[0], 'utf8'));
  const list = (Array.isArray(J) ? J : [J]).flatMap((c) => c.rows ?? [c]);
  const key = (r) => `${r.capture}|${r.signal}|${r.denoiser}`;
  const by = new Map(list.map((r) => [key(r), r]));
  console.log('| capture | signal | filter | PSNR native | Δ PSNR pooled | Δ settled | Δ penumbra | Δ FLIP | Δ flicker | Δ boil |');
  console.log('|---|---|---|---|---|---|---|---|---|---|');
  const acc = new Map();
  for (const r of list) {
    if (!/^dl-/.test(r.denoiser ?? '') || r.denoiser.endsWith('-rn')) continue;
    const v = by.get(`${r.capture}|${r.signal}|${r.denoiser}-rn`);
    if (!v) continue;
    const g = `${r.signal}|${r.denoiser.slice(3)}`;
    if (!acc.has(g)) acc.set(g, []);
    acc.get(g).push([r, v]);
    console.log(`| ${r.capture} | ${r.signal} | ${r.denoiser.slice(3)} | ${r.psnrPooled.toFixed(2)} | ${f(v.psnrPooled - r.psnrPooled)} | ${f(v.psnrSettledPooled - r.psnrSettledPooled)} | ${f(v.psnrPenumbraPooled - r.psnrPenumbraPooled)} | ${pc(r.flip, v.flip)} | ${pc(r.flicker, v.flicker)} | ${pc(r.boil, v.boil)} |`);
  }
  console.log('\nPooled over the captures (equal weights; FLIP / boil: mean):\n');
  console.log('| signal | filter | captures | Δ PSNR pooled | worst Δ | Δ FLIP | Δ boil |');
  console.log('|---|---|---|---|---|---|---|');
  for (const [g, ps] of acc) {
    const pool = (i) => dbOf(ps.reduce((s, p) => s + mseOf(p[i].psnrPooled), 0) / ps.length);
    const m = (i, k) => ps.reduce((s, p) => s + p[i][k], 0) / ps.length;
    const [sig, id] = g.split('|');
    console.log(`| ${sig} | ${id} | ${ps.length} | ${f(pool(1) - pool(0))} | ${f(Math.min(...ps.map((p) => p[1].psnrPooled - p[0].psnrPooled)))} | ${pc(m(0, 'flip'), m(1, 'flip'))} | ${pc(m(0, 'boil'), m(1, 'boil'))} |`);
  }
} else {
  console.log('usage: distance-long-ab.mjs live <files> | scenes <scenes.json>');
}
