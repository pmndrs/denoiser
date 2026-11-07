// Native NRD rows imported from the black-box result files (images / metrics only):
// docs/research/rt-denoiser/native/results/<capture>/score-captures.json (FLIP, PSNR, per-frame PSNR) and the 1080p
// timings (RTX 3060 Laptop, not this GPU). Region boil, sigma and bias in display levels need the native *outputs*
// (f32 on the Windows machine): set $RT_NATIVE_OUTPUTS (a root laid out as outputs/<capture>/<row>/...) and the rows
// are scored like ours instead (run.mjs does that automatically when the folder exists).
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export const NATIVE_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', '..', 'docs', 'research', 'rt-denoiser', 'native', 'results');
const TOL = 0.10;

const median = (xs) => { const v = xs.filter(Number.isFinite).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : NaN; };

/** lag from per-frame PSNR (RMSE = 10^(-psnr/20)), same rule as metrics.mjs lagOf */
function lagFromPsnr(series, events, nFrames, tol = TOL) {
  const rmse = series.map((p) => (p === null ? NaN : Math.pow(10, -p / 20)));
  return events.map((ev, k) => {
    const end = k + 1 < events.length ? events[k + 1].frame : nFrames;
    const win = rmse.slice(ev.frame, end);
    if (win.length < 12 || win.some((x) => !Number.isFinite(x))) return { ...ev, lag: null, note: 'window too short' };
    const q = Math.max(3, Math.floor(win.length / 4));
    const settled = win.slice(-q).reduce((a, b) => a + b, 0) / q;
    let t = win.length;
    while (t > 0 && win[t - 1] <= settled * (1 + tol)) t--;
    return { ...ev, lag: t >= win.length ? null : t, settled, note: t >= win.length ? 'never within tolerance' : undefined };
  });
}

export function loadNative(nativeCapture, signal, events, nFrames) {
  const f = path.join(NATIVE_DIR, nativeCapture, 'score-captures.json');
  if (!existsSync(f)) return [];
  const j = JSON.parse(readFileSync(f, 'utf8'))[0];
  return j.rows.filter((r) => r.signal === signal && r.denoiser.startsWith('nrd-')).map((r) => ({
    id: r.denoiser, kind: 'native', imported: path.relative(path.join(NATIVE_DIR, '..', '..', '..', '..'), f),
    detail: { flip: r.flip, flipFrames: r.flipFrames, psnrPooled: r.psnrPooled, psnrSettledPooled: r.psnrSettledPooled },
    calm: { legacyBoil: Number.isFinite(r.boil) ? r.boil : null, flickerLegacy: r.flicker },
    lag: lagFromPsnr(r.perFramePsnr, events, nFrames),
    bias: { rawTonemapped: r.bias },
    frames: r.frames,
  }));
}

/** native 1080p cost from timings-loops.csv of the synthetic-plane-1080p run (RTX 3060 Laptop) */
export function loadNativeCost(rowId) {
  const f = path.join(NATIVE_DIR, 'synthetic-plane-1080p', rowId, 'timings-loops.csv');
  if (!existsSync(f)) return null;
  const rows = readFileSync(f, 'utf8').trim().split('\n').slice(1).map((l) => l.split(','));
  const sums = (pred) => { const m = new Map(); for (const [lp, fr, pass, ms] of rows) if (pred(pass)) m.set(`${lp}:${fr}`, (m.get(`${lp}:${fr}`) ?? 0) + Number(ms)); return median([...m.values()]); };
  return { gpuMs: sums((p) => p === 'total' || p.endsWith('/total')), wallMs: sums((p) => p === 'wall' || p.endsWith('/wall')), gpu: 'RTX 3060 Laptop (Windows harness)' };
}
