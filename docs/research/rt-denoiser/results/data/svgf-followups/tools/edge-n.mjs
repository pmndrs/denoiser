// n / lambda (dbg-n output) and accum boil (dbg-a output) of NON-static pixels by distance to the static set
const REPO = '/Users/dex/Developer/Denoiser-nrd-cleanroom';
const cap = await import(`${REPO}/tools/rt-capture/lib/capture.mjs`);
import path from 'node:path';
const [c, dbgN, dbgA, sig] = process.argv.slice(2);
const capDir = cap.resolveCapture(c); const m = cap.readManifest(capDir); const W = m.width, H = m.height, N = W * H, F = m.frames.length;
const d0 = cap.readBuffer(capDir, 0, 'depth'); const r0 = cap.readBuffer(capDir, 0, `${sig}_ref`);
const isStat = new Uint8Array(N); const recv = new Uint8Array(N);
for (let i = 0; i < N; i++) { recv[i] = d0[i] > 0 && d0[i] < 1 ? 1 : 0; isStat[i] = recv[i]; }
const maxC = new Float32Array(N);
const tm = (x) => (x > 0 ? x / (1 + x) : 0);
for (let f = 1; f < F; f++) { const r = cap.readBuffer(capDir, f, `${sig}_ref`); for (let i = 0; i < N; i++) { if (!recv[i]) continue; for (let k = 0; k < 3; k++) { if (r[3*i+k] !== r0[3*i+k]) isStat[i] = 0; maxC[i] = Math.max(maxC[i], Math.abs(tm(r[3*i+k]) - tm(r0[3*i+k]))); } } }
// distance of non-static to static
const INF = 1e6, dist = new Float32Array(N);
for (let i = 0; i < N; i++) dist[i] = isStat[i] ? 0 : INF;
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y*W+x; let d = dist[i]; if (x>0) d=Math.min(d,dist[i-1]+1); if (y>0){ d=Math.min(d,dist[i-W]+1); if(x>0)d=Math.min(d,dist[i-W-1]+1); if(x<W-1)d=Math.min(d,dist[i-W+1]+1);} dist[i]=d; }
for (let y = H-1; y >= 0; y--) for (let x = W-1; x >= 0; x--) { const i = y*W+x; let d = dist[i]; if (x<W-1) d=Math.min(d,dist[i+1]+1); if (y<H-1){ d=Math.min(d,dist[i+W]+1); if(x<W-1)d=Math.min(d,dist[i+W+1]+1); if(x>0)d=Math.min(d,dist[i+W-1]+1);} dist[i]=d; }
const B = [[1,2],[3,5],[6,11],[12,1e9]];
const sel = B.map(([a,b]) => { const s = []; for (let i = 0; i < N; i++) if (recv[i] && !isStat[i] && dist[i] >= a && dist[i] <= b) s.push(i); return s; });
console.log('non-static by dist to static:', B.map((b,k)=>`${b[0]}-${b[1]}: ${sel[k].length} (mean change ${(sel[k].reduce((u,i)=>u+maxC[i],0)/sel[k].length).toFixed(4)})`).join(' | '));
for (const f of [22, 24, 25, 26, 28, 30, 34]) {
  const o = cap.readF32(path.join(cap.OUTPUTS_DIR, c, dbgN, cap.frameDir(f), `${sig}.f32`));
  console.log(f, sel.map((s, k) => `n ${(s.reduce((u,i)=>u+o[3*i],0)/s.length).toFixed(1)} λ ${(s.reduce((u,i)=>u+o[3*i+1],0)/s.length).toFixed(3)}`).join(' | '));
}
