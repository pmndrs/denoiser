#!/usr/bin/env node
// Rule-9 A/B tables for results/SHADOWS-MOTION.md: capture replays scored by score-captures.mjs (pooled, FLIP, boil),
// compare.mjs (dynamic / static-penumbra boil, edge sharpness) and tools/rt-capture/shadow-regions.mjs (per-region
// PSNR and boil); and the live 1080p test-bed JSON (run-headless --json, one file per path).
//
//   node shadows-motion-ab.mjs --score <score-captures json> --cmp <dir: <capture>/compare.json>
//        --regions <dir: <capture>.json> [--live <dir: <path>.json>] --base ab-ship --variants a,b,... [--json out.json]
//
// Boil clause (rule 9 as amended by Dennis, q20 (a), 2026-10-26): a boil increase counts only where the variant ends
// above both the reference's own boil and the baseline's in that region. The reference boil here is that of the
// capture's own reference (256 spp test bed, 1024 rays real scenes, 2048 the knot), not a 4096-spp one: on static
// pixels these references are identical frame to frame (boil 0), so the clause reduces to "above the baseline".
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i < 0 ? d : args[i + 1]; };
const BASE = opt('base', 'ab-ship');
const VARS = opt('variants').split(',');
const score = JSON.parse(readFileSync(opt('score'), 'utf8'));
const scoreRows = (Array.isArray(score) ? score : Object.values(score)).flatMap((c) => c.rows ?? []);
const STD = ['std540-orbit', 'std540-pan', 'std540-light', 'std540-thin', 'std540-glossy', 'std540-cut', 'std540-object'];
const REAL = ['three-knot-static', 'three-knot-still', 'three-knot-orbit', 'three-orbit', 'three-pan', 'sponza-orbit', 'sponza-pan', 'sponza-move', 'bistro-orbit', 'bistro-pan', 'bistro-move'];
const f2 = (x, k = 2) => (Number.isFinite(x) ? x.toFixed(k) : '–');
const pct = (x) => (Number.isFinite(x) ? `${x >= 0 ? '+' : ''}${(100 * x).toFixed(0)} %` : '–');
const mean = (xs) => { const v = xs.filter(Number.isFinite); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN; };

const sc = (cap, d) => scoreRows.find((r) => r.capture === cap && r.denoiser === d && r.signal === 'visibility');
const cmp = (cap, d) => {
  const p = path.join(opt('cmp'), cap, 'compare.json');
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')).results.find((r) => r.denoiser === d && r.signal === 'visibility') : undefined;
};
const regCache = {};
const reg = (cap) => (regCache[cap] ??= JSON.parse(readFileSync(path.join(opt('regions'), `${cap}.json`), 'utf8')));
const REGS = ['edge', 'soft', 'contact', 'changing', 'static'];

const out = { base: BASE, sets: {} };
for (const [name, caps] of [['std540', STD], ['real', REAL]]) {
  const rows = {};
  for (const v of [BASE, ...VARS]) {
    const per = caps.map((c) => {
      const s = sc(c, v), b = sc(c, BASE), m = cmp(c, v), mb = cmp(c, BASE), R = reg(c).results, rv = R[v], rb = R[BASE], rr = R.reference;
      const boilR = {};
      for (const k of REGS) {
        const x = rv?.regions[k].boil, y = rb?.regions[k].boil, rf = rr?.regions[k].boil;
        boilR[k] = { ratio: x / y - 1, counts: x > Math.max(y, rf ?? 0) ? x / Math.max(y, rf ?? 0) - 1 : 0 };
      }
      return {
        cap: c, pooled: s?.psnrPooled, flip: s?.flip, boil: s?.boil, dPooled: s?.psnrPooled - b?.psnrPooled, flipR: s?.flip / b?.flip - 1, boilR: s?.boil / b?.boil - 1,
        dynBoilR: m?.boilDynamic / mb?.boilDynamic - 1, spBoilR: m?.boilStaticPenumbra / mb?.boilStaticPenumbra - 1, sharp: m?.edgeSharpness,
        edge: rv?.regions.edge.psnr, soft: rv?.regions.soft.psnr, contact: rv?.regions.contact.psnr, changing: rv?.regions.changing.psnr, trail: rv?.trailing.trail, regBoil: boilR,
      };
    });
    const worst = (f) => per.reduce((a, p) => (f(p) > a.v ? { v: f(p), cap: p.cap } : a), { v: -Infinity, cap: '' });
    rows[v] = {
      pooled: mean(per.map((p) => p.pooled)), dPooledMin: Math.min(...per.map((p) => p.dPooled)), dPooledMinCap: per.reduce((a, p) => (p.dPooled < a.d ? { d: p.dPooled, c: p.cap } : a), { d: Infinity, c: '' }).c,
      flip: mean(per.map((p) => p.flip)), flipR: mean(per.map((p) => p.flipR)), boilR: mean(per.map((p) => p.boilR)), boilRmax: worst((p) => p.boilR),
      dynBoilR: mean(per.map((p) => p.dynBoilR)), spBoilR: mean(per.map((p) => p.spBoilR)), spBoilRmax: worst((p) => p.spBoilR),
      sharp: mean(per.map((p) => p.sharp)), edge: mean(per.map((p) => p.edge)), soft: mean(per.map((p) => p.soft)), contact: mean(per.map((p) => p.contact)),
      changing: mean(per.map((p) => p.changing)), trail: mean(per.map((p) => p.trail)),
      regionBoil: Object.fromEntries(REGS.map((k) => [k, { mean: mean(per.map((p) => p.regBoil[k].ratio)), worstCounting: worst((p) => p.regBoil[k].counts) }])),
      per,
    };
  }
  out.sets[name] = rows;
  console.log(`\n### ${name} (${caps.length} captures), vs ${BASE}\n`);
  console.log('| variant | pooled | Δ min (capture) | FLIP | FLIP Δ | boil Δ (worst) | dyn boil Δ | static-pen boil Δ (worst) | sharpness | edge | soft | contact | changing | trail |');
  console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const [v, r] of Object.entries(rows)) {
    console.log(`| ${v} | ${f2(r.pooled)} | ${v === BASE ? '' : `${f2(r.dPooledMin)} (${r.dPooledMinCap})`} | ${f2(r.flip, 4)} | ${v === BASE ? '' : pct(r.flipR)} | ${v === BASE ? '' : `${pct(r.boilR)} (${pct(r.boilRmax.v)} ${r.boilRmax.cap})`} | ${v === BASE ? '' : pct(r.dynBoilR)} | ${v === BASE ? '' : `${pct(r.spBoilR)} (${pct(r.spBoilRmax.v)} ${r.spBoilRmax.cap})`} | ${f2(r.sharp, 3)} | ${f2(r.edge)} | ${f2(r.soft)} | ${f2(r.contact)} | ${f2(r.changing)} | ${f2(r.trail, 4)} |`);
  }
  console.log('\nregion boil vs base (mean Δ; worst increase that counts under the amended clause):\n');
  for (const [v, r] of Object.entries(rows)) if (v !== BASE) console.log(`- ${v}: ${REGS.map((k) => `${k} ${pct(r.regionBoil[k].mean)} (${pct(r.regionBoil[k].worstCounting.v)} ${r.regionBoil[k].worstCounting.cap})`).join(' · ')}`);
}

if (opt('live')) {
  // live test bed (run-headless --json): per path pooled, penumbra, dynamic, static penumbra, FLIP, flicker, tPSNR
  const PATHS = ['orbit', 'pan', 'light', 'thin', 'glossy', 'cut', 'object'];
  const live = {};
  for (const p of PATHS) {
    const f = path.join(opt('live'), `${p}.json`);
    if (!existsSync(f)) continue;
    const R = JSON.parse(readFileSync(f, 'utf8'))[0].results.results.shadows;
    for (const [id, x] of Object.entries(R)) {
      (live[id] ??= {})[p] = {
        pooled: x.psnrDenPooled, penumbra: x.regions.penumbra?.psnrDenPooled, dynamic: x.regions.dynamic?.psnrDenPooled,
        staticPen: x.regions['static-penumbra']?.psnrDenPooled, flip: x.flipDen, flicker: x.flickerDen, tpsnr: x.tpsnrDen, first: x.psnrDenFirstFrame,
      };
    }
  }
  out.live = live;
  const ids = Object.keys(live), base = ids[0];
  console.log(`\n### live test bed, 1080p, ${Object.keys(live[base]).length} paths (means of per-path values; Δ min = worst path vs ${base})\n`);
  console.log('| variant | pooled | Δ min (path) | penumbra | dynamic | static penumbra | FLIP | flicker | tPSNR | frame 0 |');
  console.log('|---|---|---|---|---|---|---|---|---|---|');
  for (const id of ids) {
    const ps = Object.keys(live[id]), m = (k) => mean(ps.map((p) => live[id][p][k]));
    const d = ps.map((p) => [live[id][p].pooled - live[base][p].pooled, p]).sort((a, b) => a[0] - b[0])[0];
    console.log(`| ${id} | ${f2(m('pooled'))} | ${id === base ? '' : `${f2(d[0])} (${d[1]})`} | ${f2(m('penumbra'))} | ${f2(m('dynamic'))} | ${f2(m('staticPen'))} | ${f2(m('flip'), 4)} | ${f2(m('flicker'), 4)} | ${f2(m('tpsnr'))} | ${f2(m('first'))} |`);
  }
  console.log('\nper path pooled:\n');
  for (const id of ids) console.log(`- ${id}: ${Object.entries(live[id]).map(([p, r]) => `${p} ${f2(r.pooled)}`).join(', ')}`);
}
if (opt('json')) writeFileSync(opt('json'), JSON.stringify(out, null, 1));
