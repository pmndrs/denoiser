import { readFileSync } from 'node:fs';
const j = JSON.parse(readFileSync(process.argv[2]));
const sg = (x, d = 2) => `${x >= 0 ? '+' : ''}${x.toFixed(d)}`;
console.log('| capture | svgf-auto pooled / FLIP / boil | hit: Δ pooled, FLIP %, boil % | dual+hit: Δ pooled, FLIP %, boil % |');
console.log('|---|---|---|---|');
let mb = 0, mh = 0, md = 0;
for (const c of j) {
  const r = Object.fromEntries(c.rows.filter((x) => x.signal === 'specular').map((x) => [x.denoiser, x]));
  const b = r['rm-svgf-auto'], h = r['rm-hit'], d = r['rm-dualhit'];
  const cell = (x) => `${sg(x.psnrPooled - b.psnrPooled)}, ${sg(100 * (x.flip / b.flip - 1), 1)}, ${sg(100 * (x.boil / b.boil - 1), 1)}`;
  console.log(`| ${c.capture} | ${b.psnrPooled.toFixed(2)} / ${b.flip.toFixed(4)} / ${b.boil.toFixed(5)} | ${cell(h)} | ${cell(d)} |`);
  mb += 10 ** (-b.psnrPooled / 10); mh += 10 ** (-h.psnrPooled / 10); md += 10 ** (-d.psnrPooled / 10);
}
console.log(`| **8 captures (mean MSE)** | ${(-10 * Math.log10(mb / j.length)).toFixed(2)} | ${sg(-10 * Math.log10(mh / mb))} | ${sg(-10 * Math.log10(md / mb))} |`);
