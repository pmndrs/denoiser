// static pixels within 0-2 px of non-static ones, split by whether their own stratum's lambda was > 0 in the 'in' window
const REPO = '/Users/dex/Developer/Denoiser-nrd-cleanroom';
const cap = await import(`${REPO}/tools/rt-capture/lib/capture.mjs`);
import path from 'node:path';
const [c, out, dbg, sig, w0s, w1s] = process.argv.slice(2);
const W0 = Number(w0s ?? 24), W1 = Number(w1s ?? 32);
const capDir = cap.resolveCapture(c); const m = cap.readManifest(capDir); const W = m.width, H = m.height, N = W * H, F = m.frames.length;
const d0 = cap.readBuffer(capDir, 0, 'depth'); const r0 = cap.readBuffer(capDir, 0, `${sig}_ref`);
const isStat = new Uint8Array(N), recv = new Uint8Array(N);
for (let i = 0; i < N; i++) { recv[i] = d0[i] > 0 && d0[i] < 1 ? 1 : 0; isStat[i] = recv[i]; }
for (let f = 1; f < F; f++) { const r = cap.readBuffer(capDir, f, `${sig}_ref`); for (let i = 0; i < N; i++) if (isStat[i] && (r[3*i] !== r0[3*i] || r[3*i+1] !== r0[3*i+1] || r[3*i+2] !== r0[3*i+2])) isStat[i] = 0; }
const near = new Uint8Array(N);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y*W+x; if (!isStat[i]) continue; let n = 0;
  for (let dy = -2; dy <= 2 && !n; dy++) for (let dx = -2; dx <= 2; dx++) { const qx = x+dx, qy = y+dy; if (qx<0||qy<0||qx>=W||qy>=H) continue; const q = qy*W+qx; if (recv[q] && !isStat[q]) { n = 1; break; } } near[i] = n; }
const lamIn = new Float32Array(N);
for (let f = W0; f < W1; f++) { const o = cap.readF32(path.join(cap.OUTPUTS_DIR, c, dbg, cap.frameDir(f), `${sig}.f32`)); for (let i = 0; i < N; i++) lamIn[i] = Math.max(lamIn[i], o[3*i+1]); }
const tm = (x) => (x > 0 ? x / (1 + x) : 0);
const groups = { 'λ=0': (i) => near[i] && lamIn[i] === 0, 'λ>0': (i) => near[i] && lamIn[i] > 0 };
const res = {};
for (const [g, sel] of Object.entries(groups)) res[g] = { pre: [0, 0], in: [0, 0], n: 0 };
let p1 = null, p2 = null;
for (let f = 6; f < W1; f++) {
  const o = cap.readF32(path.join(cap.OUTPUTS_DIR, c, out, cap.frameDir(f), `${sig}.f32`));
  const t = new Float32Array(3 * N); for (let j = 0; j < 3 * N; j++) t[j] = tm(o[j]);
  const win = f >= 10 && f < 24 ? 'pre' : f >= W0 + 2 && f < W1 ? 'in' : null;
  if (win && p2) for (const [g, sel] of Object.entries(groups)) for (let i = 0; i < N; i++) if (sel(i)) for (let k = 0; k < 3; k++) { const d = t[3*i+k] - 2*p1[3*i+k] + p2[3*i+k]; res[g][win][0] += d*d; res[g][win][1]++; }
  p2 = p1; p1 = t;
}
for (const [g, sel] of Object.entries(groups)) { let n = 0; for (let i = 0; i < N; i++) if (sel(i)) n++;
  const b = (a) => Math.sqrt(a[0] / a[1] / 6) * 1e4;
  console.log(`${c} ${sig} ${out} static 0-2 px, ${g}: ${n} px, boil×1e4 pre ${b(res[g].pre).toFixed(1)} in ${b(res[g].in).toFixed(1)} (${(100*(b(res[g].in)/b(res[g].pre)-1)).toFixed(0)} %)`); }
// split the lambda > 0 group by whether the pixel's own 3x3 stratum is all-static
{
  const pure = (i) => { const x = i % W, y = (i / W) | 0, sx = Math.floor(x / 3) * 3, sy = Math.floor(y / 3) * 3;
    for (let yy = sy; yy < Math.min(sy + 3, H); yy++) for (let xx = sx; xx < Math.min(sx + 3, W); xx++) { const q = yy * W + xx; if (recv[q] && !isStat[q]) return false; } return true; };
  const g2 = { 'λ>0, pure-static stratum': (i) => near[i] && lamIn[i] > 0 && pure(i), 'λ>0, mixed stratum': (i) => near[i] && lamIn[i] > 0 && !pure(i) };
  const r2 = {}; for (const g of Object.keys(g2)) r2[g] = { pre: [0, 0], in: [0, 0] };
  let q1 = null, q2 = null;
  const pm = new Uint8Array(N); for (let i = 0; i < N; i++) pm[i] = g2['λ>0, pure-static stratum'](i) ? 1 : g2['λ>0, mixed stratum'](i) ? 2 : 0;
  for (let f = 6; f < W1; f++) {
    const o = cap.readF32(path.join(cap.OUTPUTS_DIR, c, out, cap.frameDir(f), `${sig}.f32`));
    const t = new Float32Array(3 * N); for (let j = 0; j < 3 * N; j++) t[j] = tm(o[j]);
    const win = f >= 10 && f < 24 ? 'pre' : f >= W0 + 2 && f < W1 ? 'in' : null;
    if (win && q2) for (let i = 0; i < N; i++) if (pm[i]) { const a = r2[pm[i] === 1 ? 'λ>0, pure-static stratum' : 'λ>0, mixed stratum'][win]; for (let k = 0; k < 3; k++) { const d = t[3*i+k] - 2*q1[3*i+k] + q2[3*i+k]; a[0] += d*d; a[1]++; } }
    q2 = q1; q1 = t;
  }
  for (const g of Object.keys(g2)) { let n = 0; for (let i = 0; i < N; i++) if (pm[i] === (g.includes('pure') ? 1 : 2)) n++; const b = (a) => Math.sqrt(a[0] / a[1] / 6) * 1e4;
    console.log(`  ${g}: ${n} px, boil×1e4 pre ${b(r2[g].pre).toFixed(1)} in ${b(r2[g].in).toFixed(1)} (${(100*(b(r2[g].in)/b(r2[g].pre)-1)).toFixed(0)} %)`); }
}
