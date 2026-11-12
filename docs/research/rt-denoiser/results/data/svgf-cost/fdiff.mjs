// node fdiff.mjs dirA dirB : per file, count of differing floats, max abs diff, max rel diff, and pixel coords of first few
import { readdirSync, readFileSync, statSync } from 'node:fs';
const [A, B] = process.argv.slice(2);
const W = 960;
for (const f of readdirSync(A).sort()) {
  const pa = A + '/' + f; if (!statSync(pa).isDirectory()) continue;
  for (const g of readdirSync(pa)) {
    const a = new Float32Array(readFileSync(pa + '/' + g).buffer.slice(0)), b = new Float32Array(readFileSync(B + '/' + f + '/' + g).buffer.slice(0));
    let n = 0, mx = 0, mr = 0; const px = new Set(); const ex = [];
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i] && !(isNaN(a[i]) && isNaN(b[i]))) { n++; const d = Math.abs(a[i] - b[i]); mx = Math.max(mx, d); mr = Math.max(mr, d / Math.max(1e-6, Math.abs(a[i]))); const p = i >> 2; px.add(p); if (ex.length < 4) ex.push(`(${p % W},${Math.floor(p / W)})`); }
    if (n) console.log(f, g, 'diff', n, 'px', px.size, 'maxAbs', mx.toExponential(2), 'maxRel', mr.toExponential(2), ex.join(' '));
  }
}
