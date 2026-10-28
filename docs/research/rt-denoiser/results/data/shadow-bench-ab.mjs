#!/usr/bin/env node
// Rule-9 A/B tables for results/SHADOW-BENCH.md (the flicker candidates): capture replays scored by score-captures.mjs
// (pooled, FLIP, boil; one JSON per capture), tools/rt-capture/compare.mjs (dynamic / static-penumbra boil, edge
// sharpness, flicker share; <cmp>/<capture>/compare.json) and tools/rt-capture/shadow-regions.mjs (per-region PSNR /
// boil, trailing; <regions>/<capture>.json).
//
//   node shadow-bench-ab.mjs --score <dir> --cmp <dir> --regions <dir> --base sb-ship --variants sb-A,sb-B,sb-ffx
//        [--json out.json] [--per-capture]
//
// Boil clause (rule 9, q20 (a)): a boil increase counts only where the variant ends above both the reference's own boil
// and the baseline's in that region. Flicker share (compare.mjs flickShare*: output change beyond the reference's,
// > 0.02) is compared with the baseline directly: the references' own share is 0 by construction.
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i < 0 ? d : args[i + 1]; };
const BASE = opt('base', 'sb-ship');
const VARS = opt('variants').split(',');
const perCapture = args.includes('--per-capture');
const scoreRows = readdirSync(opt('score')).filter((f) => f.endsWith('.json'))
  .flatMap((f) => JSON.parse(readFileSync(path.join(opt('score'), f), 'utf8')).flatMap((c) => c.rows ?? [c]));
const SETS = {
  std540: ['std540-orbit', 'std540-pan', 'std540-light', 'std540-thin', 'std540-glossy', 'std540-cut', 'std540-object'],
  real: ['three-knot-static', 'three-knot-still', 'three-knot-orbit', 'three-orbit', 'three-pan', 'sponza-orbit', 'sponza-pan', 'sponza-move', 'bistro-orbit', 'bistro-pan', 'bistro-move'],
  motion: ['sm-hard-camera', 'sm-hard-light', 'sm-hard-object', 'sm-hard-frozen', 'sm-sun-camera', 'sm-sun-light', 'sm-sun-object', 'sm-sun-frozen'],
};
const REGS = ['edge', 'soft', 'contact', 'changing', 'static'];
const f2 = (x, k = 2) => (Number.isFinite(x) ? x.toFixed(k) : '–');
const sg = (x, k = 2) => (Number.isFinite(x) ? `${x >= 0 ? '+' : ''}${x.toFixed(k)}` : '–');
const pct = (x) => (Number.isFinite(x) ? `${x >= 0 ? '+' : ''}${(100 * x).toFixed(0)} %` : '–');
const pc3 = (x) => (Number.isFinite(x) ? `${(100 * x).toFixed(3)} %` : '–');
const mean = (xs) => { const v = xs.filter(Number.isFinite); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN; };
const worst = (per, f) => per.reduce((a, p) => (f(p) > a.v ? { v: f(p), cap: p.cap } : a), { v: -Infinity, cap: '' });

const sc = (cap, d) => scoreRows.find((r) => r.capture === cap && r.denoiser === d && r.signal === 'visibility');
const cmpCache = {}, regCache = {};
const cmpOf = (cap) => (cmpCache[cap] ??= JSON.parse(readFileSync(path.join(opt('cmp'), cap, 'compare.json'), 'utf8')));
const cmp = (cap, d) => cmpOf(cap).results.find((r) => r.denoiser === d && r.signal === 'visibility');
const reg = (cap) => (regCache[cap] ??= JSON.parse(readFileSync(path.join(opt('regions'), `${cap}.json`), 'utf8')).results);

function capRow(c, v) {
  const s = sc(c, v), b = sc(c, BASE), m = cmp(c, v), mb = cmp(c, BASE), rb0 = cmpOf(c).baselines?.visibility ?? {};
  const R = reg(c), rv = R[v], rbv = R[BASE], rr = R.reference;
  // boil clause per region: counts = how far above max(baseline, reference) the variant ends (0 if not above both)
  const clause = (x, y, rf) => (x > Math.max(y, rf ?? 0) ? x / Math.max(y, rf ?? 0) - 1 : 0);
  const regBoil = Object.fromEntries(REGS.map((k) => [k, clause(rv?.regions[k]?.boil, rbv?.regions[k]?.boil, rr?.regions[k]?.boil)]));
  return {
    cap: c, pooled: s?.psnrPooled, dPooled: s?.psnrPooled - b?.psnrPooled, flip: s?.flip, flipR: s?.flip / b?.flip - 1,
    boilR: s?.boil / b?.boil - 1, boilC: clause(s?.boil, b?.boil, b?.refBoil ?? sc(c, 'noisy')?.refBoil),
    dynBoilC: clause(m?.boilDynamic, mb?.boilDynamic, rb0.refBoilDynamic), spBoilC: clause(m?.boilStaticPenumbra, mb?.boilStaticPenumbra, rb0.refBoilStaticPenumbra),
    dynBoilR: m?.boilDynamic / mb?.boilDynamic - 1, spBoilR: m?.boilStaticPenumbra / mb?.boilStaticPenumbra - 1,
    fsS: m?.flickShareStatic, fs4S: m?.flickShare4Static, fsD: m?.flickShareDynamic,
    fsSR: m?.flickShareStatic / mb?.flickShareStatic - 1, fsDR: m?.flickShareDynamic / mb?.flickShareDynamic - 1,
    sharp: m?.edgeSharpness, gpu: m?.medianGpuMs, gpuR: m?.medianGpuMs / mb?.medianGpuMs - 1,
    edge: rv?.regions.edge?.psnr, soft: rv?.regions.soft?.psnr, contact: rv?.regions.contact?.psnr, changing: rv?.regions.changing?.psnr,
    trail: rv?.trailing?.trail, lag: rv?.trailing?.lag, regBoil,
  };
}

const out = { base: BASE, sets: {} };
const lines = [];
for (const [name, caps] of Object.entries(SETS)) {
  const have = caps.filter((c) => existsSync(path.join(opt('cmp'), c, 'compare.json')) && sc(c, BASE));
  if (!have.length) continue;
  const rows = {};
  for (const v of [BASE, ...VARS]) {
    const per = have.map((c) => capRow(c, v));
    const dmin = per.reduce((a, p) => (p.dPooled < a.d ? { d: p.dPooled, c: p.cap } : a), { d: Infinity, c: '' });
    const regWorst = Object.fromEntries(REGS.map((k) => [k, worst(per, (p) => p.regBoil[k])]));
    rows[v] = {
      pooled: mean(per.map((p) => p.pooled)), dPooled: mean(per.map((p) => p.dPooled)), dPooledMin: dmin.d, dPooledMinCap: dmin.c,
      flip: mean(per.map((p) => p.flip)), flipR: mean(per.map((p) => p.flipR)),
      boilR: mean(per.map((p) => p.boilR)), boilCmax: worst(per, (p) => p.boilC),
      dynBoilR: mean(per.map((p) => p.dynBoilR)), dynBoilCmax: worst(per, (p) => p.dynBoilC),
      spBoilR: mean(per.map((p) => p.spBoilR)), spBoilCmax: worst(per, (p) => p.spBoilC), regWorst,
      fsS: mean(per.map((p) => p.fsS)), fs4S: mean(per.map((p) => p.fs4S)), fsD: mean(per.map((p) => p.fsD)),
      fsSR: mean(per.map((p) => p.fsSR)), fsSRmax: worst(per, (p) => p.fsSR), fsDR: mean(per.map((p) => p.fsDR)), fsDRmax: worst(per, (p) => p.fsDR),
      sharp: mean(per.map((p) => p.sharp)), gpuR: mean(per.map((p) => p.gpuR)),
      edge: mean(per.map((p) => p.edge)), soft: mean(per.map((p) => p.soft)), contact: mean(per.map((p) => p.contact)), changing: mean(per.map((p) => p.changing)),
      trail: mean(per.map((p) => p.trail)), lag: mean(per.map((p) => p.lag)), per,
    };
  }
  out.sets[name] = { captures: have, rows };
  lines.push(`### ${name} (${have.length} captures, vs ${BASE})`, '',
    '| variant | pooled dB | Δ mean | Δ worst (capture) | FLIP Δ | boil Δ | boil clause worst | dyn boil clause worst | static-pen boil clause worst | region boil clause worst | flicker share static | > 0.04 | Δ static (worst) | dynamic | Δ dyn | edge / soft / contact / changing dB | trail | lag | sharpness | GPU Δ |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const [v, r] of Object.entries(rows)) {
    const rw = Object.entries(r.regWorst).reduce((a, [k, x]) => (x.v > a.v ? { ...x, k } : a), { v: -Infinity });
    const w = (x) => (x.v > 0 ? `${pct(x.v)} (${x.cap})` : '0');
    lines.push(`| ${v} | ${f2(r.pooled)} | ${sg(r.dPooled, 3)} | ${sg(r.dPooledMin, 3)} (${r.dPooledMinCap}) | ${pct(r.flipR)} | ${pct(r.boilR)} | ${w(r.boilCmax)} | ${w(r.dynBoilCmax)} | ${w(r.spBoilCmax)} | ${rw.v > 0 ? `${pct(rw.v)} (${rw.k}, ${rw.cap})` : '0'} | ` +
      `${pc3(r.fsS)} | ${pc3(r.fs4S)} | ${pct(r.fsSR)} (${pct(r.fsSRmax.v)} ${r.fsSRmax.cap}) | ${pc3(r.fsD)} | ${pct(r.fsDR)} | ${f2(r.edge)} / ${f2(r.soft)} / ${f2(r.contact)} / ${f2(r.changing)} | ${f2(r.trail, 3)} | ${f2(r.lag)} | ${f2(r.sharp, 3)} | ${pct(r.gpuR)} |`);
  }
  lines.push('');
  if (perCapture) {
    lines.push(`#### ${name} per capture: pooled dB / flicker share static / dynamic / static-penumbra boil`, '', `| capture | ${[BASE, ...VARS].join(' | ')} |`, `|---|${[BASE, ...VARS].map(() => '---').join('|')}|`);
    for (const c of have) {
      lines.push(`| ${c} | ${[BASE, ...VARS].map((v) => { const p = rows[v].per.find((q) => q.cap === c); const m = cmp(c, v); return `${f2(p.pooled)} / ${pc3(p.fsS)} / ${pc3(p.fsD)} / ${f2(m?.boilStaticPenumbra, 4)}`; }).join(' | ')} |`);
    }
    lines.push('');
  }
}
for (const s of Object.values(out.sets)) for (const r of Object.values(s.rows)) delete r.per;
console.log(lines.join('\n'));
if (opt('json')) writeFileSync(opt('json'), JSON.stringify(out, null, 1));
