// Cost (TRACKS.md number 5): per-pass GPU ms and wall ms per frame at 1080p on this Mac, TASKS rule 11 timing
// protocol: GPU lock held, no other headless Chrome running, 50 ms warm-up before each timed dispatch
// (replay.ts `warmMs`), first frame (pipeline compile) dropped, median over frames, median of ROUNDS rounds.
// Content-independent filters are timed on one synthetic 1080p capture (gen-synthetic.mjs --w 1920 --h 1080).
// "GPU ms" = sum of the per-signal `total` timestamp-query rows; "wall ms" = dispatch -> queue idle (replay.ts).
import { existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { readManifest } from '../../rt-capture/lib/capture.mjs';
import { replayQueries } from './replay.mjs';

const median = (xs) => { const v = xs.filter(Number.isFinite).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : NaN; };

function readTimings(file) {
  const rows = readFileSync(file, 'utf8').trim().split('\n').slice(1).map((l) => l.split(','));
  const frames = [...new Set(rows.map((r) => r[0]))].sort((a, b) => a - b).slice(1); // drop the compile frame
  const byFrame = new Map(frames.map((f) => [f, new Map()]));
  for (const [f, pass, ms] of rows) byFrame.get(f)?.set(pass, (byFrame.get(f).get(pass) ?? 0) + Number(ms));
  const passes = new Set(rows.map((r) => r[1]));
  const gpu = [];
  for (const m of byFrame.values()) gpu.push([...m].filter(([p]) => p === 'total' || p.endsWith('/total')).reduce((a, [, v]) => a + v, 0));
  const per = {};
  for (const p of passes) per[p] = median([...byFrame.values()].map((m) => m.get(p)));
  return { gpu: median(gpu), wall: median([...byFrame.values()].map((m) => m.get('wall'))), per };
}

/**
 * costRows: [{ id, denoiser, signals, label }]; capture: the 1080p capture name; returns { [id]: {...} }.
 * The caller holds the GPU lock and has waited for a quiet GPU.
 */
export function measureCost({ costRows, capture, base, captureDir, rounds = 3, log = console.log }) {
  const man = readManifest(path.join(captureDir, 'captures', capture));
  const have = new Set(man.buffers.map((b) => b.name));
  const out = {};
  for (const row of costRows) {
    if (row.signals.some((s) => !have.has(s === 'ao' ? 'diffuse_hitt' : s))) { out[row.id] = { skipped: `capture lacks ${row.signals.join(',')}` }; continue; }
    const runs = [];
    for (let k = 0; k < rounds; k++) {
      const name = `cost-${row.id}-r${k}`;
      const q = `mode=replay&capture=${capture}&denoiser=${row.denoiser}&signals=${row.signals.join(',')}&output=${name}`;
      const [res] = replayQueries([q], { base, captureDir, log });
      const dir = path.join(captureDir, 'outputs', capture, name);
      if (res && existsSync(path.join(dir, 'timings.csv'))) runs.push(readTimings(path.join(dir, 'timings.csv')));
      rmSync(dir, { recursive: true, force: true });
    }
    if (!runs.length) { out[row.id] = { skipped: 'replay failed' }; continue; }
    // wall time with timestamp queries off (they add writes per frame): honoured only where the registry entry passes `timestamps=0` on
    // (D's finding: Mac wall - GPU ~ 0.6 ms); a run that still reports GPU passes means the setting was ignored
    const nts = [];
    for (let k = 0; k < rounds; k++) {
      const name = `cost-${row.id}-nts${k}`;
      const [res] = replayQueries([`mode=replay&capture=${capture}&denoiser=${row.denoiser}&signals=${row.signals.join(',')}&output=${name}&timestamps=0`], { base, captureDir, log });
      const dir = path.join(captureDir, 'outputs', capture, name);
      if (res && existsSync(path.join(dir, 'timings.csv'))) { const t = readTimings(path.join(dir, 'timings.csv')); if (Object.keys(t.per).every((p) => p === 'wall')) nts.push(t.wall); }
      rmSync(dir, { recursive: true, force: true });
    }
    const passes = {};
    for (const p of Object.keys(runs[0].per)) if (p !== 'wall' && p !== 'total' && !p.endsWith('/total')) passes[p] = median(runs.map((r) => r.per[p]));
    out[row.id] = {
      label: row.label, denoiser: row.denoiser, signals: row.signals,
      gpuMs: median(runs.map((r) => r.gpu)), wallMs: median(runs.map((r) => r.wall)), wallNoTimestampsMs: nts.length ? median(nts) : null,
      gpuRounds: runs.map((r) => +r.gpu.toFixed(4)), passes,
      width: man.width, height: man.height, rounds: runs.length,
    };
    log(`  cost ${row.id}: GPU ${out[row.id].gpuMs.toFixed(3)} ms, wall ${out[row.id].wallMs.toFixed(2)} ms (rounds ${out[row.id].gpuRounds.join(' / ')})`);
  }
  return out;
}
