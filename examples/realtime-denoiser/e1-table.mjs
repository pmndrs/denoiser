#!/usr/bin/env node
// E-1 tables (docs/research/rt-denoiser/results/E1-high-reference.md) from run-headless.mjs
// --json output of second-reference evals (&refspp=<high>&ref2spp=256&ref2salt=0): every pair
// is scored against the high-spp reference (main fields) and the standard 256-spp reference
// (`vsRef2`), and `refFloor` holds the 256-spp set scored against the high-spp set.
//   node e1-table.mjs --floor-lo=floor256-*.json --floor-hi=floor4096-*.json main-*.json > tables.md
// --floor-lo / --floor-hi: pages with refspp=ref2spp=<spp>, ref2salt=1: two INDEPENDENT reference
// sets, so their refFloor MSE = 2 sigma2_ref. (The main pages' refFloor, 256 salt 0 vs high salt 0,
// is not independent: both sets share the per-pixel rotation and the secondary random stream of
// their first chunks, so it underestimates sigma2_256 + sigma2_high.) Used for the theory check
// (MSE@256 - MSE@high = sigma2_256 - sigma2_high) and the "true" column (MSE@high - sigma2_high).
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const listArg = (k) => args.filter((a) => a.startsWith(`--${k}=`)).flatMap((a) => a.slice(k.length + 3).split(','));
const files = args.filter((a) => !a.startsWith('--'));
const load = (f) => JSON.parse(readFileSync(f, 'utf8')).filter((r) => r.results?.results || r.results?.refFloor).map((r) => r.results);
// --tag=<file prefix>:<suffix>: keys of pages from files whose name starts with the prefix get the
// suffix (e.g. --tag=shv22-:' v2.2' for a second server pinned at another package commit)
const tags = listArg('tag').map((t) => t.split(':'));
const runs = files.flatMap((f) => {
  const tag = tags.find(([pre]) => f.split('/').pop().startsWith(pre));
  return load(f).map((R) => (tag ? { ...R, results: Object.fromEntries(Object.entries(R.results).map(([s, d]) => [s, Object.fromEntries(Object.entries(d).map(([k, x]) => [k + tag[1], x]))])) } : R));
});
const floorsLo = listArg('floor-lo').flatMap(load);
const floorsHi = listArg('floor-hi').flatMap(load);

const f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : '–');
const f3 = (x) => (Number.isFinite(x) ? x.toFixed(3) : '–');
const f4 = (x) => (Number.isFinite(x) ? x.toFixed(4) : '–');
const sg = (x) => (Number.isFinite(x) ? (x >= 0 ? '+' : '') + x.toFixed(2) : '–');
const mse = (db) => 10 ** (-db / 10);
const db = (m) => -10 * Math.log10(m);
const mean = (xs) => { const v = xs.filter(Number.isFinite); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN; };

const paths = [...new Set(runs.map((r) => r.path))];
const hi = runs[0]?.refSpp, lo = runs[0]?.ref2Spp;
// rows[signal][key][path] = { hi: record, lo: record }
const rows = {};
const floor = {}; // floor[signal][path] = refFloor record (lo vs hi)
for (const R of runs) {
  for (const [s, dens] of Object.entries(R.results)) for (const [k, x] of Object.entries(dens)) {
    ((rows[s] ??= {})[k] ??= {})[R.path] = { hi: x, lo: x.vsRef2 };
  }
  for (const [s, x] of Object.entries(R.refFloor ?? {})) (floor[s] ??= {})[R.path] = x;
}
// indep[lo|hi][signal][path] = refFloor record of two independent sets (+ frames, spp)
const indep = { lo: {}, hi: {} };
for (const [w, list] of [['lo', floorsLo], ['hi', floorsHi]]) for (const R of list) for (const [s, x] of Object.entries(R.refFloor ?? {})) ((indep[w][s] ??= {})[R.path] = { ...x, frames: R.frames, spp: R.refSpp });

const regionOf = (s) => (s === 'shadows' ? 'penumbra' : s === 'ao' || s === 'so' ? 'contact' : 'disoccluded');
console.log(`_E-1: ${runs[0]?.width}x${runs[0]?.height}, paths ${paths.join(', ')}, ${runs[0]?.frames} frames, high reference ${hi} spp, standard ${lo} spp (salt 0 = the references of every earlier result), pooled PSNR; "mean" = mean over paths of per-path pooled dB._\n`);

for (const w of ['lo', 'hi']) {
  const sigs = Object.keys(indep[w]);
  if (!sigs.length) continue;
  const any = Object.values(indep[w][sigs[0]])[0];
  console.log(`### Noise floor: two independent ${any.spp}-spp references (salt 0 vs 1), pooled PSNR (dB); σ²_ref = ½·MSE, ceiling = PSNR of σ²_ref = floor + 3.01 dB\n`);
  console.log(`| signal | ${paths.map((p) => `${p} (${indep[w][sigs[0]][p]?.frames ?? '–'} f)`).join(' | ')} | mean | ceiling (mean) | region | region ceiling | FLIP |`);
  console.log(`|---|${paths.map(() => '---|').join('')}---|---|---|---|---|`);
  for (const s of sigs) {
    const by = indep[w][s], reg = regionOf(s);
    const m = mean(paths.map((p) => by[p]?.psnrDenPooled)), mr = mean(paths.map((p) => by[p]?.regions?.[reg]?.psnrDen));
    console.log(`| ${s} | ${paths.map((p) => f2(by[p]?.psnrDenPooled)).join(' | ')} | ${f2(m)} | ${f2(m + 3.01)} | ${reg} ${f2(mr)} | ${f2(mr + 3.01)} | ${f4(mean(paths.map((p) => by[p]?.flipDen)))} |`);
  }
  console.log('');
}
console.log(`### ${lo}-spp (salt 0) vs ${hi}-spp (salt 0) reference, pooled PSNR (dB); not independent (shared per-pixel rotation), shown for completeness\n`);
console.log(`| signal | ${paths.join(' | ')} | mean | region |`);
console.log(`|---|${paths.map(() => '---|').join('')}---|---|`);
for (const [s, byPath] of Object.entries(floor)) {
  const reg = regionOf(s);
  console.log(`| ${s} | ${paths.map((p) => f2(byPath[p]?.psnrDenPooled)).join(' | ')} | ${f2(mean(paths.map((p) => byPath[p]?.psnrDenPooled)))} | ${reg} ${f2(mean(paths.map((p) => byPath[p]?.regions?.[reg]?.psnrDen)))} |`);
}
console.log('');

for (const [s, byKey] of Object.entries(rows)) {
  const reg = regionOf(s);
  console.log(`### ${s}\n`);
  console.log(`Pooled PSNR (dB), ${lo} spp → ${hi} spp reference; Δ = ${hi} − ${lo}:\n`);
  console.log(`| denoiser | ${paths.map((p) => `${p} ${lo} | ${p} ${hi}`).join(' | ')} | mean ${lo} | mean ${hi} | Δ | ${reg} ${lo} | ${reg} ${hi} | FLIP ${lo} | FLIP ${hi} | flicker ${lo} | flicker ${hi} |`);
  console.log(`|---|${paths.map(() => '---|---|').join('')}---|---|---|---|---|---|---|---|---|`);
  const noisy = Object.values(byKey)[0];
  const entries = [['noisy input', (p, w) => noisy[p]?.[w]?.psnrNoisyPooled, (w) => mean(paths.map((p) => noisy[p]?.[w]?.regions?.[reg]?.psnrNoisy)), (w) => mean(paths.map((p) => noisy[p]?.[w]?.flipNoisy)), (w) => mean(paths.map((p) => noisy[p]?.[w]?.flickerNoisy))]];
  for (const [k, by] of Object.entries(byKey)) entries.push([`\`${k}\``, (p, w) => by[p]?.[w]?.psnrDenPooled, (w) => mean(paths.map((p) => by[p]?.[w]?.regions?.[reg]?.psnrDen)), (w) => mean(paths.map((p) => by[p]?.[w]?.flipDen)), (w) => mean(paths.map((p) => by[p]?.[w]?.flickerDen))]);
  for (const [label, ps, rg, fl, fk] of entries) {
    const l = paths.map((p) => ps(p, 'lo')), h = paths.map((p) => ps(p, 'hi'));
    console.log(`| ${label} | ${paths.map((_, i) => `${f2(l[i])} | ${f2(h[i])}`).join(' | ')} | ${f2(mean(l))} | ${f2(mean(h))} | ${sg(mean(h) - mean(l))} | ${f2(rg('lo'))} | ${f2(rg('hi'))} | ${f4(fl('lo'))} | ${f4(fl('hi'))} | ${f4(fk('lo'))} | ${f4(fk('hi'))} |`);
  }
  console.log('');
  // gaps between arms (pairwise vs the best arm at the high reference)
  const keys = Object.keys(byKey);
  const m = (k, w) => mean(paths.map((p) => byKey[k][p]?.[w]?.psnrDenPooled));
  const best = keys.reduce((a, b) => (m(b, 'hi') > m(a, 'hi') ? b : a));
  console.log(`Gap to the best arm at ${hi} spp (\`${best}\`), mean over paths, dB (per path in brackets):\n`);
  console.log(`| denoiser | gap @${lo} | gap @${hi} | widening | per path @${lo} → @${hi} |`);
  console.log('|---|---|---|---|---|');
  for (const k of keys) {
    if (k === best) continue;
    const g = (w) => paths.map((p) => byKey[k][p]?.[w]?.psnrDenPooled - byKey[best][p]?.[w]?.psnrDenPooled);
    const gl = g('lo'), gh = g('hi');
    console.log(`| \`${k}\` | ${sg(mean(gl))} | ${sg(mean(gh))} | ${sg(mean(gh) - mean(gl))} | ${paths.map((p, i) => `${p} ${sg(gl[i])} → ${sg(gh[i])}`).join(', ')} |`);
  }
  console.log('');
  // theory: MSE_lo = MSE_true + s2_lo, MSE_hi = MSE_true + s2_hi  =>  MSE_lo - MSE_hi = s2_lo - s2_hi;
  // floor (lo vs hi) = s2_lo + s2_hi; two independent hi sets = 2 s2_hi
  console.log(`Theory check (all pixels, pooled): measured ΔMSE = MSE@${lo} − MSE@${hi} vs predicted σ²_${lo} − σ²_${hi}, each σ² = ½·MSE of two independent sets of that spp; "true" = PSNR of MSE@${hi} − σ²_${hi}:\n`);
  console.log(`| denoiser | path | MSE@${lo} ×1e5 | MSE@${hi} ×1e5 | ΔMSE ×1e5 | predicted ×1e5 | ratio | PSNR true |`);
  console.log('|---|---|---|---|---|---|---|---|');
  for (const k of keys) for (const p of paths) {
    const r = byKey[k][p]; if (!r) continue;
    const ml = mse(r.lo.psnrDenPooled), mh = mse(r.hi.psnrDenPooled);
    // sigma2 from the independent pairs (all frames of the high pair may be fewer than the main page's)
    const s2l = mse(indep.lo[s]?.[p]?.psnrDenPooled) / 2;
    const s2h = mse(indep.hi[s]?.[p]?.psnrDenPooled) / 2;
    console.log(`| \`${k}\` | ${p} | ${f3(ml * 1e5)} | ${f3(mh * 1e5)} | ${f3((ml - mh) * 1e5)} | ${f3((s2l - s2h) * 1e5)} | ${f2((ml - mh) / (s2l - s2h))} | ${f2(db(mh - s2h))} |`);
  }
  console.log('');
}
