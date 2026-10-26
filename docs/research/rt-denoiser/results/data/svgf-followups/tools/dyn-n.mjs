const REPO = '/Users/dex/Developer/Denoiser-nrd-cleanroom';
const cap = await import(`${REPO}/tools/rt-capture/lib/capture.mjs`);
import path from 'node:path';
const [c, out, sig] = process.argv.slice(2);
const capDir = cap.resolveCapture(c); const m = cap.readManifest(capDir); const N = m.width * m.height;
const tm = (x) => (x > 0 ? x / (1 + x) : 0);
const r0 = cap.readBuffer(capDir, 0, `${sig}_ref`); const r40 = cap.readBuffer(capDir, 40, `${sig}_ref`); const d0 = cap.readBuffer(capDir, 0, 'depth');
const dyn = new Uint8Array(N); let nd = 0;
for (let i = 0; i < N; i++) { if (!(d0[i] > 0 && d0[i] < 1)) continue; let mx = 0; for (let k = 0; k < 3; k++) mx = Math.max(mx, Math.abs(tm(r40[3*i+k]) - tm(r0[3*i+k]))); if (mx > 0.02) { dyn[i] = 1; nd++; } }
console.log('dynamic px', nd);
for (let f = 20; f < 40; f++) {
  const o = cap.readF32(path.join(cap.OUTPUTS_DIR, path.basename(capDir), out, cap.frameDir(f), `${sig}.f32`));
  let sn = 0, sl = 0, n4 = 0; const hist = [0,0,0,0,0];
  for (let i = 0; i < N; i++) if (dyn[i]) { sn += o[3*i]; sl += o[3*i+1]; if (o[3*i] < 4) n4++; }
  console.log(f, 'n', (sn/nd).toFixed(1), 'λ', (sl/nd).toFixed(3), 'n<4', (100*n4/nd).toFixed(0)+'%');
}
