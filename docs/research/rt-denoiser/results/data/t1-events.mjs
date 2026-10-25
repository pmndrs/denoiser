// Per-frame recovery after each reset (all receivers), from t1-score JSON.
// settled = mean PSNR of the event's last 8 frames for the baseline; conv = first frame from which every later
// frame of the event stays >= settled - 0.5 dB.
import { readFileSync } from 'node:fs';
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i < 0 ? d : args[i + 1]; };
const base = Object.fromEntries(opt('base', 'diffuse=svgf-auto,specular=svgf-auto,visibility=shadows').split(',').map((x) => x.split('=')));
const maxShow = Number(opt('show', 17));
const evIdx = opt('event', null);
const psnr = (s, n) => 10 * Math.log10(1 / Math.max(s / n, 1e-12));
const f2 = (x, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : '–');
for (const file of args.filter((a) => a.endsWith('.json'))) {
  const r = JSON.parse(readFileSync(file, 'utf8'));
  const events = r.resets.map((s, k) => [s, k + 1 < r.resets.length ? r.resets[k + 1] : r.frames]);
  const use = evIdx === null ? events : [events[Number(evIdx)]];
  for (const [s0, s1] of use) {
    for (const sig of r.signals) {
      const curve = (den) => r.acc[`${sig}|${den}`].frames.filter((x) => x.f >= s0 && x.f < s1).map((x) => psnr(x.allSse, x.allCnt));
      const flips = (den) => r.acc[`${sig}|${den}`].frames.filter((x) => x.f >= s0 && x.f < s1 && x.flipAll != null);
      if (!r.acc[`${sig}|${base[sig]}`]) continue;
      const b = curve(base[sig]);
      const settled = b.slice(-8).reduce((x, y) => x + y, 0) / Math.min(8, b.length);
      const band = settled - 0.5;
      console.log(`\n#### ${r.capture} ${sig}, reset at frame ${s0} (${s1 - s0} frames); band ${f2(band, 2)} dB (${base[sig]} last-8 mean − 0.5)`);
      console.log(`| denoiser | ${Array.from({ length: Math.min(maxShow, s1 - s0) }, (_, i) => i).join(' | ')} | pooled 0–7 | low-pass 0–7 | mid-band 0–7 | FLIP 0–7 | conv |`);
      console.log(`|---|${'---|'.repeat(Math.min(maxShow, s1 - s0) + 5)}`);
      for (const den of Object.keys(r.acc).filter((k) => k.startsWith(sig + '|')).map((k) => k.split('|')[1])) {
        const c = curve(den);
        const fr = r.acc[`${sig}|${den}`].frames.filter((x) => x.f >= s0 && x.f < Math.min(s0 + 8, s1));
        const pooled = psnr(fr.reduce((x, y) => x + y.allSse, 0), fr.reduce((x, y) => x + y.allCnt, 0));
        const mid = fr[0].midSse !== undefined ? psnr(fr.reduce((x, y) => x + y.midSse, 0), fr.reduce((x, y) => x + y.lpCnt, 0)) : NaN;
        const lp = fr[0].lpCnt ? psnr(fr.reduce((x, y) => x + y.lpSse, 0), fr.reduce((x, y) => x + y.lpCnt, 0)) : NaN;
        const fl = flips(den).filter((x) => x.f < s0 + 8);
        const flip = fl.length ? fl.reduce((x, y) => x + y.flipAll, 0) / fl.length : NaN;
        let conv = '>';
        for (let i = 0; i < c.length; i++) if (c.slice(i).every((v) => v >= band)) { conv = i; break; }
        console.log(`| ${den} | ${c.slice(0, maxShow).map((v) => f2(v)).join(' | ')} | ${f2(pooled, 2)} | ${f2(lp, 2)} | ${f2(mid, 2)} | ${f2(flip, 4)} | ${conv} |`);
      }
    }
  }
}
