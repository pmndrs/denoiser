#!/usr/bin/env node
// Markdown tables for results/E2b-oidn-vs-svgf.md from the JSON written by oidn-vs-svgf.mjs (and oidn-cost.mjs).
//   node tools/scorecard/oidn-vs-svgf-report.mjs [--in <e2b json>] [--cost <cost json>] > tables.md
// Group means are plain means over the group's captures of each capture's number (pooled dB per capture, as E-2's
// "mean"); a capture without that region / signal is left out of the mean (n shown where it varies).
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from '../rt-capture/lib/headless.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i < 0 ? d : args[i + 1]; };
const DATA = path.join(REPO_ROOT, 'docs/research/rt-denoiser/results/data');
const R = JSON.parse(readFileSync(opt('in', path.join(DATA, 'e2b-oidn-vs-svgf.json')), 'utf8'));
const costFile = opt('cost', path.join(DATA, 'e2b-cost.json'));
const COST = existsSync(costFile) ? JSON.parse(readFileSync(costFile, 'utf8')) : null;

const GROUPS = [
  { id: 'testbed', title: 'Analytic test bed (7 paths, 960×540, 256-spp references)', caps: ['std540-orbit', 'std540-pan', 'std540-light', 'std540-thin', 'std540-glossy', 'std540-cut', 'std540-object'], k: 1 },
  { id: 'corner', title: 'Real three.js corner scene (three-orbit, three-pan; SSR specular)', caps: ['three-orbit', 'three-pan'], k: 8 },
  { id: 'moving', title: 'Moving occluders (three-knot-static, three-knot-orbit, sponza-move, bistro-move)', caps: ['three-knot-static', 'three-knot-orbit', 'sponza-move', 'bistro-move'], k: 8 },
  { id: 'golden', title: 'Golden scenes (golden-G3-orbit Sponza orbit, golden-G4-pan-light-on Bistro pan + light on; 4096-spp references)', caps: ['golden-G3-orbit', 'golden-G4-pan-light-on'], k: 8 },
];
const SIGNALS = [['diffuse', 'diffuse'], ['specular', 'specular'], ['visibility', 'shadows'], ['ao', 'AO']];
const ORDER = ['raw', 'svgf', 'svgf-auto', 'shadows', 'occlusion-svgf', 'occlusion-svgf-auto', 'oidn-fast', 'oidn-balanced', 'oidn-high'];
const LABEL = { raw: 'raw 1-ray input', svgf: 'SVGF (paper, pinned)', 'svgf-auto': '**A-SVGF (shipped)**', shadows: '**shadows (shipped)**', 'occlusion-svgf': 'AO SVGF (pinned)', 'occlusion-svgf-auto': '**AO A-SVGF (shipped)**', 'oidn-fast': 'OIDN fast', 'oidn-balanced': 'OIDN balanced', 'oidn-high': 'OIDN high' };
const f = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '–');
const mean = (v) => { const w = v.filter(Number.isFinite); return w.length ? w.reduce((a, b) => a + b, 0) / w.length : NaN; };
const rowsOf = (cap, sig) => R.captures[cap]?.signals?.[sig]?.rows ?? null;
const arms = (g, sig) => ORDER.filter((a) => g.caps.some((c) => rowsOf(c, sig)?.[a]));
const gm = (g, sig, arm, pick) => mean(g.caps.map((c) => { const r = rowsOf(c, sig)?.[arm]; return r ? pick(r, R.captures[c].signals[sig]) : NaN; }));
const bestOf = (vals, hi) => { const v = vals.filter(Number.isFinite); return v.length ? (hi ? Math.max(...v) : Math.min(...v)) : NaN; };

const out = [];
const P = (s = '') => out.push(s);
for (const g of GROUPS) {
  if (!g.caps.some((c) => R.captures[c])) continue;
  P(`### ${g.title}`); P();
  for (const [sig, sname] of SIGNALS) {
    const as = arms(g, sig);
    if (!as.length) continue;
    const k = g.k;
    const cols = [
      ['frame 0 dB', (r) => r.detail.psnrFrame0, true, 2],
      ['settled dB', (r) => r.detail.psnrSettledPooled, true, 2],
      ['all frames dB', (r) => r.detail.psnrPooled, true, 2],
      ['FLIP', (r) => r.detail.flip, false, 4],
      ['flicker', (r) => r.detail.flickerSettled, false, 4],
      [k === 1 ? 'boil all' : 'boil k=8 all', (r) => (k === 1 ? r.calm.all.boil : r.calm.strided?.[8]?.all?.boil), false, 4],
      [k === 1 ? 'boil moving' : 'boil k=8 moving', (r) => (k === 1 ? r.calm.moving.boil : r.calm.strided?.[8]?.moving?.boil), false, 4],
    ];
    const vals = as.map((a) => cols.map(([, pick]) => gm(g, sig, a, pick)));
    const best = cols.map(([, , hi], j) => bestOf(as.map((a, i) => (a === 'raw' ? NaN : vals[i][j])), hi));
    P(`**${sname}**`); P();
    P(`| filter | ${cols.map((c) => c[0]).join(' | ')} |`);
    P(`|---|${cols.map(() => '---').join('|')}|`);
    as.forEach((a, i) => P(`| ${LABEL[a]} | ${vals[i].map((v, j) => (a !== 'raw' && v === best[j] ? `**${f(v, cols[j][3])}**` : f(v, cols[j][3]))).join(' | ')} |`));
    // reference boil (the clean reference's own boil in the same pixels)
    const refB = mean(g.caps.map((c) => { const s = R.captures[c]?.signals?.[sig]; if (!s) return NaN; return k === 1 ? Object.values(s.rows)[0]?.calm.all.refBoil : s.reference?.strided?.[8]?.static; }));
    P(); P(`<sub>Reference boil (same pixels, ${k === 1 ? 'k = 1, all regions' : 'k = 8, static region'}): ${f(refB, 4)}.</sub>`); P();
    // per region (settled frames)
    const regs = sig === 'visibility' ? ['static', 'moving', 'disocc', 'dense', 'penumbra', 'penumbra0'] : ['static', 'moving', 'disocc', 'dense'];
    const rn = { static: 'static', moving: 'moving', disocc: 'disoccluded', dense: 'dense geometry', penumbra: 'penumbra', penumbra0: 'penumbra, frame 0' };
    const rv = as.map((a) => regs.map((r) => gm(g, sig, a, (row) => row.detail.regionPsnr?.[r])));
    const rb = regs.map((_, j) => bestOf(as.map((a, i) => (a === 'raw' ? NaN : rv[i][j])), true));
    P(`| ${sname}: settled PSNR dB per region | ${regs.map((r) => rn[r]).join(' | ')} |`);
    P(`|---|${regs.map(() => '---').join('|')}|`);
    as.forEach((a, i) => P(`| ${LABEL[a]} | ${rv[i].map((v, j) => (a !== 'raw' && v === rb[j] ? `**${f(v)}**` : f(v))).join(' | ')} |`));
    P();
    // boil per region
    const bk = (row, r) => (k === 1 ? row.calm[r]?.boil : row.calm.strided?.[8]?.[r]?.boil);
    const bregs = ['static', 'moving', 'disocc', 'dense'];
    const bv = as.map((a) => bregs.map((r) => gm(g, sig, a, (row) => bk(row, r))));
    const refR = bregs.map((r) => mean(g.caps.map((c) => { const s = R.captures[c]?.signals?.[sig]; if (!s) return NaN; return k === 1 ? Object.values(s.rows)[0]?.calm[r]?.refBoil : s.reference?.strided?.[8]?.[r]; })));
    P(`| ${sname}: boil ${k === 1 ? '(k = 1)' : '(k = 8)'} per region | ${bregs.map((r) => rn[r]).join(' | ')} |`);
    P(`|---|${bregs.map(() => '---').join('|')}|`);
    P(`| reference | ${refR.map((v) => f(v, 4)).join(' | ')} |`);
    as.forEach((a, i) => P(`| ${LABEL[a]} | ${bv[i].map((v) => f(v, 4)).join(' | ')} |`));
    P();
  }
}
// per capture appendix: pooled PSNR (all frames) / frame 0
P('### Per capture: pooled PSNR dB, all frames (frame 0 in brackets)'); P();
for (const [sig, sname] of SIGNALS) {
  const caps = Object.keys(R.captures).filter((c) => rowsOf(c, sig));
  if (!caps.length) continue;
  const as = ORDER.filter((a) => caps.some((c) => rowsOf(c, sig)?.[a]));
  P(`**${sname}**`); P();
  P(`| capture | ${as.map((a) => LABEL[a]).join(' | ')} |`);
  P(`|---|${as.map(() => '---').join('|')}|`);
  for (const c of caps) P(`| ${c} | ${as.map((a) => { const r = rowsOf(c, sig)[a]; return r ? `${f(r.detail.psnrPooled)} (${f(r.detail.psnrFrame0)})` : '–'; }).join(' | ')} |`);
  P();
}
// models
const models = new Set();
for (const c of Object.values(R.captures)) for (const [a, v] of Object.entries(c.replay ?? {})) if (v?.denoiserInfo?.signals) for (const [s, m] of Object.entries(v.denoiserInfo.signals)) models.add(`${a} ${s}: ${m.model} (${m.quality}, aux ${m.aux}, subgroupMatrix ${v.denoiserInfo.subgroupMatrix})`);
P('### OIDN models used'); P(); for (const m of [...models].sort()) P(`- ${m}`); P();
if (COST) {
  P(`### Cost (${COST.capture}, 1920×1080)`); P();
  P('| configuration | fastest frame ms | best round median ms | wall fastest / best median |'); P('|---|---|---|---|');
  for (const [, s] of Object.entries(COST.summary)) P(`| ${s.label} | ${f(s.fastest)} | ${f(s.bestMedian)} | ${f(s.wallFastest)} / ${f(s.wallBestMedian)} |`);
  P(); P('Rounds (load average 1 / 5 / 15 min, other headless Chromes before the round):'); P();
  COST.rounds.forEach((r, i) => P(`- round ${i + 1} at ${r.at}: load ${r.load.map((x) => x.toFixed(1)).join(' / ')}, other headless Chromes ${r.otherHeadless}`));
  P();
}
console.log(out.join('\n'));
