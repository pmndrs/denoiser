// Shared "run a replay from URL parameters" entry, used by the replay page (src/main.ts)
// and by the test bed's `mode=replay` (examples/realtime-denoiser), so both behave the
// same and write the same outputs/<capture>/<output>/ folders.
//
//   capture=<name>&denoiser=<id>[&signals=diffuse,specular][&frames=N][&output=<folder>]
//   [&<setting>=<value> ...]   every other key not in `reserved` is a denoiser setting
//                              (recorded in run.json)
import { DENOISERS } from './denoisers';
import { replay } from './replay';
import type { SignalName } from './format';

/** Keys the replay itself reads (never passed to the denoiser as settings). */
export const REPLAY_KEYS = ['capture', 'denoiser', 'signals', 'frames', 'output', 'mode', 'as'];

export interface ReplaySummary {
  capture: string; denoiser: string; outputDir: string; signals: SignalName[]; frames: number;
  medianWallMs: number | null; medianGpuTotalMs: number | null; elapsedS: number;
}

export async function replayFromQuery(
  device: GPUDevice, q: URLSearchParams,
  opts: { reserved?: Iterable<string>; log?: (s: string) => void; onFrame?: (i: number) => void } = {},
): Promise<ReplaySummary> {
  const log = opts.log ?? (() => {});
  const capture = q.get('capture');
  if (!capture) throw new Error('replay: missing ?capture=<name>');
  const id = q.get('denoiser') ?? 'accumulate';
  if (id.includes(',')) throw new Error('replay: one denoiser per run (?denoiser=<id>)');
  const entry = DENOISERS.get(id);
  if (!entry) throw new Error(`unknown denoiser "${id}" (have: ${[...DENOISERS.keys()].join(', ')})`);
  const reserved = new Set([...REPLAY_KEYS, ...(opts.reserved ?? [])]);
  const settings = Object.fromEntries([...q].filter(([k]) => !reserved.has(k)));
  log(`replay ${capture} through ${id} ${JSON.stringify(settings)} features=[${[...device.features].join(',')}]`);
  const t0 = performance.now();
  const r = await replay(device, {
    capture,
    denoiser: entry,
    settings,
    ...(q.get('signals') ? { signals: q.get('signals')!.split(',') as SignalName[] } : {}),
    ...(q.get('frames') ? { maxFrames: Number(q.get('frames')) } : {}),
    ...(q.get('output') ? { outputName: q.get('output')! } : {}),
    onFrame: (i) => { opts.onFrame?.(i); if (i % 10 === 0) log(`frame ${i}`); },
  });
  const wall = r.timings.filter((t) => t.pass === 'wall').map((t) => t.ms).sort((a, b) => a - b);
  // GPU total per frame = sum of the per-signal 'total' passes
  const perFrame = new Map<number, number>();
  for (const t of r.timings) if (t.pass === 'total' || t.pass.endsWith('/total')) perFrame.set(t.frame, (perFrame.get(t.frame) ?? 0) + t.ms);
  const total = [...perFrame.values()].sort((a, b) => a - b);
  const summary: ReplaySummary = {
    capture, denoiser: id, outputDir: r.outputDir, signals: r.signals, frames: r.frames,
    medianWallMs: wall[Math.floor(wall.length / 2)] ?? null,
    medianGpuTotalMs: total[Math.floor(total.length / 2)] ?? null,
    elapsedS: +((performance.now() - t0) / 1000).toFixed(2),
  };
  log(JSON.stringify(summary, null, 1));
  return summary;
}
