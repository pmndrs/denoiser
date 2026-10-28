// One bench run: ground truths of every kept frame (cache first), then the timeline from a history reset, scoring each
// kept frame against its ground truth as it is rendered. Writes outputs/<run id>/ through the bench's dev server:
//
//   run.json                  config, variants (+ the options the package resolved), frames, every metric, timings
//   f0300/gt-mask.png ...     per image (gt, noisy, every variant) mask / lit; err for noisy and the variants
//   boil-<id>.png             per-pixel temporal std of the error over every kept frame (metrics.ts ErrStd)
//   flicker-<id>.png          largest frame-to-frame change of the displayed brightness over consecutive kept frames
//   f0300/<id>.f32            raw visibility (config.raw), w x h float32, row 0 = top; gt.f32 has -1 off receivers
//
// Only a sliding window of `burst` frames stays in memory, so long runs fit.
import { type BenchConfig, type Variant, checkpoints, keptFrames, lastFrame } from './config';
import type { Engine, FrameRead } from './engine';
import { BENCH_API } from './engine';
import { REGIONS, type FrameStats, type RegionId, type TemporalStats, ErrStd, blur, clamp01, flickerStats, frameStats, meanOf, regionMasks, temporalStats } from './metrics';
import { errImage, flickerImage, heatImage, litImage, litLuma, maskImage, pngOf } from './images';

export interface RunResult {
  id: string;
  created: string;
  git?: { commit: string | null; dirty: boolean | null };
  page: { three: string; triangles: number; sampler: string; userAgent: string };
  config: BenchConfig;
  variants: (Variant & { resolved?: Record<string, unknown> })[];
  /** Image ids in table order: noisy, the variants; 'gt' rows carry the ground truth's own temporal stats (the floor). */
  images: string[];
  kept: number[];
  checkpoints: number[];
  /** frame -> image -> region -> stats (regions of that frame's ground truth). */
  perFrame: Record<number, Record<string, Partial<Record<RegionId, FrameStats>>>>;
  /** checkpoint -> image (incl. 'gt') -> region (incl. the moving / static split) -> temporal stats. */
  perCheckpoint: Record<number, Record<string, Partial<Record<RegionId, TemporalStats & Partial<FrameStats>>>>>;
  /** image -> region -> means over the checkpoints (frame stats of the checkpoint frames + temporal stats). */
  summary: Record<string, Partial<Record<RegionId, Partial<FrameStats & TemporalStats>>>>;
  /** variant -> median total GPU ms over the kept frames. */
  gpuMs: Record<string, number | null>;
  files: string[];
  gtStats: { computed: number; cached: number; ms: number };
  wallMs: number;
}

export interface RunOptions {
  refreshGt?: boolean;
  /** Write files (needs the bench dev server). Default true when the cache endpoint answers. */
  save?: boolean;
  onProgress?: (msg: string) => void;
}

const pad = (f: number) => `f${String(f).padStart(4, '0')}`;
const median = (v: number[]) => { const s = v.filter(Number.isFinite).sort((a, b) => a - b); return s.length ? s[s.length >> 1] : null; };

export function runId(cfg: BenchConfig): string {
  const d = new Date();
  const t = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`;
  const tag = (cfg.label ?? '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  return tag ? `${t}-${tag}` : t;
}

export async function put(path: string, body: BodyInit) {
  const r = await fetch(`${BENCH_API}/put?path=${encodeURIComponent(path)}`, { method: 'POST', body });
  if (!r.ok) throw new Error(`write ${path}: HTTP ${r.status} ${await r.text()}`);
}

export async function runBench(engine: Engine, cfg: BenchConfig, variants: Variant[], o: RunOptions = {}): Promise<RunResult> {
  const t0 = performance.now();
  const say = o.onProgress ?? (() => {});
  const save = (o.save ?? true) && engine.cacheAvailable;
  const { W, H } = engine;
  const N = W * H;
  engine.setScene(cfg);
  engine.setVariants(variants);
  const kept = keptFrames(cfg), cps = checkpoints(cfg), cpSet = new Set(cps);
  const id = runId(cfg);
  const dir = `outputs/${id}`;
  const files: string[] = [];
  const write = async (name: string, body: BodyInit) => { if (!save) return; await put(`${dir}/${name}`, body); files.push(name); };

  // 1. ground truths (all before the timeline: the timeline then never leaves its own pose sequence)
  const gtStats = { computed: 0, cached: 0, ms: 0 };
  const tg = performance.now();
  for (const [i, f] of kept.entries()) {
    const g = await engine.groundTruth(f, { refresh: o.refreshGt, onProgress: (d, n) => say(`ground truth ${i + 1}/${kept.length} (frame ${f}): pass ${d}/${n}`) });
    g.cached ? gtStats.cached++ : gtStats.computed++;
    say(`ground truth ${i + 1}/${kept.length} (frame ${f}) ${g.cached ? 'from cache' : 'computed'}`);
  }
  gtStats.ms = Math.round(performance.now() - tg);

  // 2. timeline
  const images = ['noisy', ...variants.map((v) => v.id)];
  const perFrame: RunResult['perFrame'] = {};
  const perCheckpoint: RunResult['perCheckpoint'] = {};
  type Win = { gt: Float32Array; recv: Uint8Array; object: Uint8Array; x: Record<string, Float32Array>; low: Record<string, Float32Array>; luma: Record<string, Float32Array> };
  const win = new Map<number, Win>();
  const es = Object.fromEntries(images.map((k) => [k, new ErrStd(N)]));
  const gpu: Record<string, number[]> = Object.fromEntries(variants.map((v) => [v.id, []]));
  let recvAll: Uint8Array | null = null;
  const flick = Object.fromEntries([...images, 'gt'].map((k) => [k, new Float32Array(N)])); // max |dL| over consecutive kept frames
  let lastLuma: Record<string, Float32Array> = {};

  engine.reset();
  const last = lastFrame(cfg);
  let fNext = 0;
  for (const f of kept) {
    // run up to f (fast), then read it back
    if (f > fNext) await engine.advanceTo(f - 1, (k) => say(`timeline: frame ${k} / ${last}`));
    engine.step();
    fNext = f + 1;
    const rd: FrameRead = await engine.readFrame();
    const { gt, recv } = await engine.groundTruth(f);
    recvAll ??= recv;
    for (const [k, t] of Object.entries(engine.timings())) if (t !== undefined) gpu[k]?.push(t);
    const x: Record<string, Float32Array> = { noisy: clamp01(rd.noisy), ...Object.fromEntries(Object.entries(rd.outputs).map(([k, v]) => [k, clamp01(v)])) };
    const masks = regionMasks(gt, recv, rd.object);
    perFrame[f] = Object.fromEntries(images.map((k) => [k, Object.fromEntries(REGIONS.map((r) => [r, frameStats(x[k], gt, masks[r])]))]));
    for (const k of images) es[k].add(x[k], gt);
    const low = Object.fromEntries([...images, 'gt'].map((k) => [k, blur(k === 'gt' ? gt : x[k], recv, W, H, cfg.blurSigma)]));
    const aux0 = { base: rd.base, direct: rd.direct };
    const luma = Object.fromEntries([...images, 'gt'].map((k) => [k, litLuma(k === 'gt' ? gt : x[k], aux0, W, H)]));
    const prev = win.get(f - 1);
    if (prev) for (const k of Object.keys(luma)) { const a = luma[k], p = prev.luma[k], m = flick[k]; for (let i = 0; i < N; i++) { const d = Math.abs(a[i] - p[i]); if (d > m[i]) m[i] = d; } }
    lastLuma = luma;
    win.set(f, { gt, recv, object: rd.object, x, low, luma });

    // images
    const wantImages = cfg.images === 'all' || (cfg.images === 'checkpoints' && cpSet.has(f));
    if (wantImages && save) {
      say(`frame ${f}: writing images`);
      const aux = { base: rd.base, direct: rd.direct };
      for (const [k, v] of [['gt', gt], ...images.map((k) => [k, x[k]])] as [string, Float32Array][]) {
        await write(`${pad(f)}/${k}-mask.png`, await pngOf(maskImage(v, W, H)));
        await write(`${pad(f)}/${k}-lit.png`, await pngOf(litImage(v, aux, W, H)));
        if (k !== 'gt') await write(`${pad(f)}/${k}-err.png`, await pngOf(errImage(v, gt, recv, W, H)));
      }
    }
    if (cfg.raw && save) {
      const raw = new Float32Array(N); for (let i = 0; i < N; i++) raw[i] = recv[i] ? gt[i] : -1;
      await write(`${pad(f)}/gt.f32`, raw.buffer as ArrayBuffer);
      for (const k of images) await write(`${pad(f)}/${k}.f32`, (k === 'noisy' ? rd.noisy : rd.outputs[k]).buffer as ArrayBuffer);
    }

    // temporal stats at a checkpoint (its burst is in the window: kept frames are exactly the bursts)
    if (cpSet.has(f)) {
      const burst = Array.from({ length: cfg.burst }, (_, j) => f - cfg.burst + 1 + j).filter((b) => win.has(b));
      const gs = burst.map((b) => win.get(b)!.gt);
      const object = new Uint8Array(N);
      for (const b of burst) { const o = win.get(b)!.object; for (let i = 0; i < N; i++) object[i] |= o[i]; }
      const cm = regionMasks(gt, recv, object, gs, cfg.movingRate);
      perCheckpoint[f] = {};
      for (const k of [...images, 'gt']) {
        const xs = burst.map((b) => (k === 'gt' ? win.get(b)!.gt : win.get(b)!.x[k]));
        const lows = burst.map((b) => win.get(b)!.low[k]);
        const ts = temporalStats(xs, lows, gs, cm);
        const fl = flickerStats(burst.map((b) => win.get(b)!.luma[k]), cm);
        for (const r of Object.keys(ts) as RegionId[]) Object.assign(ts[r], fl[r]);
        const fs = k === 'gt' ? {} : Object.fromEntries(Object.entries(cm).map(([r, m]) => [r, frameStats(x[k], gt, m)]));
        perCheckpoint[f][k] = Object.fromEntries(Object.entries(ts).map(([r, t]) => [r, { ...t, ...(fs as Record<string, FrameStats>)[r] }]));
      }
      say(`checkpoint ${f}: ${variants.map((v) => `${v.id} umbra rmse ${perCheckpoint[f][v.id].umbra?.rmse?.toFixed(4)} boilLow pen ${perCheckpoint[f][v.id].penumbra?.boilLow?.toFixed(4)}`).join(' | ')}`);
    }
    // a later checkpoint c > f needs frames from c - burst + 1 > f - burst + 1 on
    for (const b of [...win.keys()]) if (b <= f - cfg.burst + 1) win.delete(b);
  }

  // 3. summary over the checkpoints
  const summary: RunResult['summary'] = {};
  for (const k of [...images, 'gt']) {
    const regions = Object.keys(perCheckpoint[cps[0]]?.[k] ?? {}) as RegionId[];
    summary[k] = Object.fromEntries(regions.map((r) => [r, meanOf(cps.map((c) => {
      const v = perCheckpoint[c]?.[k]?.[r] ?? {};
      return Object.fromEntries(Object.entries(v).filter(([, x]) => typeof x === 'number')) as Record<string, number>;
    }))]));
  }
  if (save && recvAll) {
    for (const k of images) await write(`boil-${k}.png`, await pngOf(heatImage(es[k].map(recvAll), W, H)));
    if (kept.some((f) => kept.includes(f - 1))) for (const k of [...images, 'gt']) await write(`flicker-${k}.png`, await pngOf(flickerImage(flick[k], lastLuma[k], W, H)));
  }
  let git: RunResult['git'];
  try { git = await (await fetch(`${BENCH_API}/info`)).json(); } catch { /* no server */ }
  const result: RunResult = {
    id, created: new Date().toISOString(), git,
    page: { ...engine.info, userAgent: navigator.userAgent },
    config: cfg,
    variants: engine.variants.map((v) => ({ ...v, resolved: engine.resolved(v.id) })),
    images, kept, checkpoints: cps, perFrame, perCheckpoint, summary,
    gpuMs: Object.fromEntries(Object.entries(gpu).map(([k, v]) => [k, median(v)])),
    files, gtStats, wallMs: Math.round(performance.now() - t0),
  };
  if (save) await put(`${dir}/run.json`, JSON.stringify(result, null, 1));
  say(`run ${id} done in ${(result.wallMs / 1000).toFixed(1)} s${save ? '' : ' (not saved: no bench server)'}`);
  return result;
}
