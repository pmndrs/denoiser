// Real-time denoiser test bed (denoiser/realtime, T0.3). An analytic WGSL ray
// tracer renders, every frame of a scripted stress path, the CAPTURE-FORMAT guides,
// three 1-spp demodulated signals (diffuse GI, specular, shadows) and converged
// references of the same estimators; registered denoisers run on them and are
// scored on the GPU (PSNR per region, bias, temporal stability) plus CPU LDR-FLIP on
// sampled frames.
//
//   ?signal=diffuse|specular|shadows|all     (comma lists ok; default diffuse)
//   &denoiser=<id>[,<id>...]                 (src/denoisers.ts; default: every
//                                             denoiser registered for the signal)
//   &path=orbit|pan|light|thin|glossy|cut|object   (src/paths.ts; default orbit)
//   &mode=view|eval|bench                    (default view)
//   &preset=fast|full                        fast = 960x540 (default), full = 1920x1080
//   &w=&h=  &frames=N (truncate the path)  &refspp=256  &refs=all (render every reference)
//   &noise=inject [&k=2&ffRate=0.01&ffGain=20]   noise injected around the reference
//                                             (exact ground truth; quick checks)
//   &flip=0|1 &flipEvery=12   CPU LDR-FLIP on every flipEvery-th frame (eval)
//   &ppd=<pixels per degree>  FLIP viewing condition (default W / 46.4, see PPD)
//   &ageK=8                   "disoccluded" region = < ageK frames of valid history
//   &n=100                    bench frames
//   view only: &show=<texture> [&dscale=] puts a SceneSignals texture in panel 1;
//              &err=<gain> error heat map in panel 2; &stopAt=N freezes at frame N
//
// Results: window.__rt = { ready, error?, frame?, results? } (read by run-headless.mjs).
import type { FrameCamera, TemporalDenoiser } from '@pmndrs/denoiser-ffx';
import { mountShell } from '../../_shared/shell';
import { defaultDenoisers, denoiserById, DENOISERS, type DenoiserEntry } from './denoisers';
import { flipMean, prepareFlip, unpackLdr, type FlipPrepared } from './flip';
import { HistoryAge, LdrPacker, REGIONS, Scorer, type FrameScore } from './metrics';
import { isReset, pathById, PATHS, type PathDef } from './paths';
import { DEMODULATION, SceneSignals, SIGNALS, type Signal, type TexName } from './signals';
import { PanelView } from './view';
import type { TestbedGuides } from './accumulate';

mountShell({ id: 'realtime-denoiser', title: 'Real-time denoiser test bed' });

const q = new URLSearchParams(location.search);
const mode = q.get('mode') ?? 'view';
const preset = q.get('preset') ?? 'fast';
const W = Number(q.get('w') ?? (preset === 'full' ? 1920 : 960));
const H = Number(q.get('h') ?? (preset === 'full' ? 1080 : 540));
const sigParam = q.get('signal') ?? 'diffuse';
const signals: Signal[] = sigParam === 'all' ? [...SIGNALS] : (sigParam.split(',') as Signal[]).filter((s) => SIGNALS.includes(s));
const path: PathDef = pathById(q.get('path') ?? 'orbit') ?? PATHS[0];
const FRAMES = Math.min(Number(q.get('frames') ?? path.frames), path.frames);
const REFSPP = Number(q.get('refspp') ?? (mode === 'view' ? 64 : 256));
const INJECT = q.get('noise') === 'inject'
  ? { k: Number(q.get('k') ?? 2), fireflyRate: Number(q.get('ffRate') ?? 0.01), fireflyGain: Number(q.get('ffGain') ?? 20) }
  : undefined;
const FLIP = q.get('flip') !== '0';
const FLIP_EVERY = Number(q.get('flipEvery') ?? 12);
const AGE_K = Number(q.get('ageK') ?? 8);
// FLIP viewing condition: by default the image spans a fixed 46.4 deg (a 0.6 m wide display
// at 0.7 m), so the metric means the same at every resolution (1080p -> ~41 ppd).
// &ppd=67 gives FLIP's standard condition (0.7 m from a 0.7 m wide 4K monitor).
const PPD = Number(q.get('ppd') ?? W / 46.4);
const SETTLE = 8; // frames after a reset excluded from the "settled" means

const status = document.querySelector<HTMLPreElement>('#status')!;
const log = (s: string) => { status.textContent += s + '\n'; };

type State = { ready: boolean; error?: string; results?: unknown; frame?: number };
const out: State = { ready: false };
(window as unknown as { __rt: State }).__rt = out;

buildNav();

function buildNav() {
  const nav = document.querySelector<HTMLElement>('#nav');
  if (!nav) return;
  const link = (patch: Record<string, string>, label: string, on: boolean) => {
    const p = new URLSearchParams(location.search);
    for (const [k, v] of Object.entries(patch)) p.set(k, v);
    if (patch.signal) p.delete('denoiser');
    const a = document.createElement('a');
    a.href = `?${p}`; a.textContent = label;
    if (on) a.setAttribute('aria-current', 'page');
    return a;
  };
  const group = (label: string, links: HTMLAnchorElement[]) => {
    const g = document.createElement('div'); g.className = 'dn-group';
    const l = document.createElement('span'); l.className = 'dn-label'; l.textContent = label;
    const seg = document.createElement('div'); seg.className = 'dn-seg';
    seg.append(...links); g.append(l, seg); nav.append(g);
  };
  group('Signal', SIGNALS.map((s) => link({ signal: s }, s, signals[0] === s)));
  const curDen = (q.get('denoiser') ?? defaultDenoisers(signals[0])[0]).split(',')[0];
  group('Denoiser', DENOISERS.filter((d) => d.signals.includes(signals[0])).map((d) => link({ denoiser: d.id }, d.id, d.id === curDen)));
  group('Path', PATHS.map((p) => link({ path: p.id }, p.label, p.id === path.id)));
  group('Mode', ['view', 'eval', 'bench'].map((m) => link({ mode: m }, m, m === mode)));
  const info = document.querySelector('#pathinfo');
  if (info) info.textContent = path.about;
}

interface Pair {
  signal: Signal;
  entry: DenoiserEntry;
  den: TemporalDenoiser<object>;
  scorer?: Scorer;
  frames: FrameScore[];
  flip: { frame: number; noisy: number; den: number }[];
  timings: Map<string, number[]>;
  lastOut?: GPUTexture;
}

async function main() {
  const adapter = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('WebGPU unavailable');
  const features: GPUFeatureName[] = [];
  if (adapter.features.has('timestamp-query')) features.push('timestamp-query');
  // the scene's `guides` / `signals` entries write 6 storage textures (the denoisers need <= 4)
  const device = await adapter.requestDevice({
    requiredFeatures: features,
    requiredLimits: { maxStorageTexturesPerShaderStage: Math.min(8, adapter.limits.maxStorageTexturesPerShaderStage) },
  });
  device.addEventListener('uncapturederror', (e) => {
    const msg = (e as GPUUncapturedErrorEvent).error.message;
    console.error(msg);
    out.error ??= msg;
    log('GPU error: ' + msg);
  });
  log(`${mode} ${signals.join(',')} path=${path.id} ${W}x${H} frames=${FRAMES} refspp=${REFSPP}${INJECT ? ' noise=inject' : ''} features=[${[...device.features].join(',')}]`);

  const scene = new SceneSignals(device, W, H);
  await scene.init();
  const T = scene.textures;
  // guides handed to every denoiser (incl. the optional 2.5D fields of FrameGuides)
  const guides: TestbedGuides = {
    depth: T.depth, normal: T.normal, motion: T.motion, roughness: T.roughness, albedo: T.albedo,
    viewZ: T.viewz, motionZ: T.motionZ,
  };

  // ---- denoisers: one instance per (signal, denoiser)
  const pairs: Pair[] = [];
  for (const s of signals) {
    const ids = (q.get('denoiser') ?? defaultDenoisers(s).join(',')).split(',');
    for (const id of ids) {
      const entry = denoiserById(id);
      if (!entry) throw new Error(`unknown denoiser "${id}" (have: ${DENOISERS.map((d) => d.id).join(', ')})`);
      if (!entry.signals.includes(s)) { log(`skip ${id}: does not consume ${s}`); continue; }
      const den = entry.create(device, s, q);
      den.configure({ width: W, height: H });
      pairs.push({ signal: s, entry, den, frames: [], flip: [], timings: new Map() });
    }
  }
  if (!pairs.length) throw new Error('no (signal, denoiser) pair to run');

  const refsNeeded: Signal[] = q.get('refs') === 'all' ? [...SIGNALS] : signals;
  const stateAt = (f: number) => {
    const reset = isReset(path, f);
    const cur = path.at(f);
    const prev = reset ? cur : path.at(f - 1);
    return { reset, cur, prev };
  };
  const dispatch = (p: Pair, cam: FrameCamera, reset: boolean) => {
    if (reset) p.den.resetHistory();
    p.lastOut = p.den.dispatch(p.entry.inputs(scene, p.signal), guides, cam);
    return p.lastOut;
  };
  const snapTimings = (p: Pair) => {
    for (const [k, v] of p.den.gpuTimings ?? []) {
      if (!p.timings.has(k)) p.timings.set(k, []);
      p.timings.get(k)!.push(v);
    }
  };

  if (mode === 'eval') await runEval(device, scene, pairs, refsNeeded, stateAt, dispatch, snapTimings);
  else if (mode === 'bench') await runBench(device, scene, pairs, stateAt, dispatch, snapTimings);
  else runView(device, scene, pairs[0], refsNeeded, stateAt, dispatch);
}

type StateAt = (f: number) => { reset: boolean; cur: ReturnType<PathDef['at']>; prev: ReturnType<PathDef['at']> };
type Dispatch = (p: Pair, cam: FrameCamera, reset: boolean) => GPUTexture;

const lastReset = (f: number) => Math.max(...[0, ...path.resets].filter((r) => r <= f));
const psnr = (sse: number, n: number) => (n > 0 ? 10 * Math.log10(1 / Math.max(sse / n, 1e-12)) : NaN);
const mean = (xs: number[]) => { const v = xs.filter((x) => Number.isFinite(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN; };
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
const r4 = (x: number) => (Number.isFinite(x) ? +x.toFixed(4) : x === undefined ? null : String(x));

async function runEval(device: GPUDevice, scene: SceneSignals, pairs: Pair[], refs: Signal[], stateAt: StateAt, dispatch: Dispatch, snapTimings: (p: Pair) => void) {
  const T = scene.textures;
  const age = new HistoryAge(device, W, H);
  const scorePipe = Scorer.pipeline(device);
  for (const p of pairs) p.scorer = new Scorer(device, W, H, scorePipe);
  const packer = FLIP ? new LdrPacker(device, W, H) : undefined;
  const view = new PanelView(device, [...document.querySelectorAll<HTMLCanvasElement>('canvas.panel')], W, H);
  const t0 = performance.now();
  let flipMs = 0;

  for (let f = 0; f < FRAMES; f++) {
    const { reset, cur, prev } = stateAt(f);
    const cam = scene.render(f, cur, prev, { reset, refs, refSpp: REFSPP, inject: INJECT });
    age.update(T, reset);
    for (const p of pairs) {
      const den = dispatch(p, cam, reset);
      const sig = scene.signal(p.signal);
      const r = await p.scorer!.score({
        noisy: sig.noisy, den, ref: sig.ref, depth: T.depth, rough: T.roughness, age: age.current, motion: T.motion,
        pen: refs.includes('shadows') ? T.visibilityRef : undefined, scalar: sig.scalar, validPrev: !reset,
        // "disoccluded" excludes the AGE_K frames right after a reset (everything is history-less
        // there; those frames are covered by psnrDenFirstFrame / psnrDenAfterCut)
        ageK: f - lastReset(f) >= AGE_K ? AGE_K : 0,
      });
      p.frames.push(r);
      if (f >= 2) snapTimings(p);
    }
    if (packer && f % FLIP_EVERY === FLIP_EVERY - 1) {
      const tf = performance.now();
      for (const s of new Set(pairs.map((p) => p.signal))) {
        const sig = scene.signal(s);
        const prep = async (tex: GPUTexture) => {
          const u = unpackLdr(await packer.pack(tex, sig.ref, T.depth, sig.scalar), W, H);
          return { prep: prepareFlip(u.rgb, W, H, PPD), mask: u.mask };
        };
        const ref = await prep(sig.ref);
        const noisy = await prep(sig.noisy);
        const flipNoisy = flipMean(ref.prep, noisy.prep, ref.mask);
        for (const p of pairs.filter((pp) => pp.signal === s)) {
          const d: FlipPrepared = p.lastOut === sig.noisy ? noisy.prep : (await prep(p.lastOut!)).prep;
          p.flip.push({ frame: f, noisy: flipNoisy, den: flipMean(ref.prep, d, ref.mask) });
        }
      }
      flipMs += performance.now() - tf;
    }
    if (f % 8 === 0 || f === FRAMES - 1) {
      const p = pairs[0];
      const last = p.frames[p.frames.length - 1];
      const sig = scene.signal(p.signal);
      view.show([{ tex: sig.noisy, mode: sig.scalar ? 0 : 1 }, { tex: p.lastOut!, mode: sig.scalar ? 0 : 1 }, { tex: sig.ref, mode: sig.scalar ? 0 : 1 }], sig.ref);
      log(`frame ${f}: ${pairs.map((pp) => { const l = pp.frames[pp.frames.length - 1]; return `${pp.signal}/${pp.entry.id} ${psnr(l.regions[0][1], l.regions[0][2]).toFixed(2)} dB`; }).join('  ')}  (noisy ${psnr(last.regions[0][0], last.regions[0][2]).toFixed(2)})`);
    }
    out.frame = f;
  }
  await device.queue.onSubmittedWorkDone();
  await new Promise((r) => setTimeout(r, 50));
  for (const p of pairs) snapTimings(p);

  const settledMask = [...Array(FRAMES).keys()].map((f) => {
    const resets = [0, ...path.resets];
    return !resets.some((r) => f >= r && f < r + SETTLE);
  });
  const results: Record<string, Record<string, unknown>> = {};
  for (const p of pairs) {
    const F = p.frames;
    const perFramePsnr = (k: 0 | 1, region = 0) => F.map((r) => psnr(r.regions[region][k], r.regions[region][2]));
    const pooled = (region: number) => {
      const s = [0, 0, 0, 0];
      for (const r of F) for (let i = 0; i < 4; i++) s[i] += r.regions[region][i];
      return { pixelsPerFrame: Math.round(s[2] / F.length), psnrNoisy: r4(psnr(s[0], s[2])), psnrDen: r4(psnr(s[1], s[2])), biasDen: r4(s[2] ? s[3] / s[2] : NaN) };
    };
    const tsum = [0, 0, 0, 0];
    let dn2 = 0, lumD = 0, lumR = 0, lumN = 0, errN = 0, nfIn = 0, nfDen = 0;
    const ff = [0, 0, 0];
    for (const r of F) {
      for (let i = 0; i < 4; i++) tsum[i] += r.temporal[i];
      dn2 += r.sumDeNoisy2; lumD += r.lum.den; lumR += r.lum.ref; lumN += r.lum.noisy; errN += r.sumErrNoisy;
      nfIn += r.nonFiniteInputs; nfDen += r.nonFiniteDenoised;
      for (let i = 0; i < 3; i++) ff[i] += r.fixedFlicker[i];
    }
    const all = pooled(0);
    const allCount = F.reduce((a, r) => a + r.regions[0][2], 0);
    const den = perFramePsnr(1), noisy = perFramePsnr(0);
    const gpuMs = Object.fromEntries([...p.timings].map(([k, v]) => [k, r4(median(v))]));
    const afterReset = path.resets.map((r) => den[r]).filter((x) => x !== undefined);
    results[p.signal] ??= {};
    results[p.signal][p.entry.id] = {
      denoiser: p.den.name,
      psnrNoisy: r4(mean(noisy)),
      psnrDen: r4(mean(den)),
      psnrDenSettled: r4(mean(den.filter((_, f) => settledMask[f]))),
      psnrDenFirstFrame: r4(den[0]),
      psnrDenAfterCut: afterReset.length ? r4(mean(afterReset)) : null,
      regions: Object.fromEntries(REGIONS.map((name, i) => [name, pooled(i)])),
      biasDen: all.biasDen,
      biasNoisy: r4(allCount ? errN / allCount : NaN),
      energyDen: r4(lumR ? lumD / lumR - 1 : NaN),
      energyNoisy: r4(lumR ? lumN / lumR - 1 : NaN),
      // fixed-pixel flicker, comparable with examples/ffx-denoiser and rt-capture compare.mjs
      flickerNoisy: r4(ff[2] ? ff[1] / ff[2] : NaN),
      flickerDen: r4(ff[2] ? ff[0] / ff[2] : NaN),
      // motion-compensated temporal stability (valid-history pixels only)
      flickerMcNoisy: r4(tsum[3] ? tsum[2] / tsum[3] : NaN),
      flickerMcDen: r4(tsum[3] ? tsum[0] / tsum[3] : NaN),
      tpsnrNoisy: r4(psnr(dn2, tsum[3])),
      tpsnrDen: r4(psnr(tsum[1], tsum[3])),
      flipNoisy: r4(mean(p.flip.map((x) => x.noisy))),
      flipDen: r4(mean(p.flip.map((x) => x.den))),
      flipFrames: p.flip.map((x) => x.frame),
      gpuMs,
      nonFiniteInputs: nfIn, nonFiniteDenoised: nfDen,
      // [psnrNoisy, psnrDen, flickerMcDen, psnrDenDisoccluded]
      perFrame: F.map((r, f) => [noisy[f], den[f], r.temporal[3] ? r.temporal[0] / r.temporal[3] : NaN, psnr(r.regions[2][1], r.regions[2][2])].map(r4)),
    };
  }
  const summary = {
    mode: 'eval', path: path.id, width: W, height: H, frames: FRAMES, refSpp: REFSPP, inject: INJECT ?? null,
    resets: [0, ...path.resets], ageK: AGE_K, flipEvery: FLIP ? FLIP_EVERY : 0, flipPpd: +PPD.toFixed(2), query: location.search,
    demodulation: DEMODULATION, seconds: +((performance.now() - t0) / 1000).toFixed(1), flipSeconds: +(flipMs / 1000).toFixed(1),
    results,
  };
  const brief = JSON.parse(JSON.stringify(summary, (k, v) => (k === 'perFrame' ? undefined : v)));
  log(JSON.stringify(brief, null, 1));
  out.results = summary;
  out.ready = true;
}

async function runBench(device: GPUDevice, scene: SceneSignals, pairs: Pair[], stateAt: StateAt, dispatch: Dispatch, snapTimings: (p: Pair) => void) {
  const WARM = 20, N = Number(q.get('n') ?? 100);
  const results: Record<string, Record<string, unknown>> = {};
  for (const p of pairs) {
    const wall: number[] = [];
    p.timings.clear();
    for (let i = 0; i < WARM + N; i++) {
      const f = i % FRAMES;
      const { reset, cur, prev } = stateAt(f);
      const cam = scene.render(f, cur, prev, { reset });
      await device.queue.onSubmittedWorkDone();
      const t0 = performance.now();
      dispatch(p, cam, reset);
      await device.queue.onSubmittedWorkDone();
      const t1 = performance.now();
      await new Promise((r) => setTimeout(r, 0)); // let the timestamp mapAsync land
      if (i >= WARM) { wall.push(t1 - t0); snapTimings(p); }
    }
    const st = (xs: number[]) => {
      const s = [...xs].sort((a, b) => a - b);
      return { median: r4(s[Math.floor(s.length / 2)]), p25: r4(s[Math.floor(s.length * 0.25)]), p90: r4(s[Math.floor(s.length * 0.9)]), min: r4(s[0]), n: s.length };
    };
    results[p.signal] ??= {};
    results[p.signal][p.entry.id] = {
      gpuMs: p.timings.has('total') ? st(p.timings.get('total')!) : null,
      passesMs: Object.fromEntries([...p.timings].filter(([k]) => k !== 'total').map(([k, v]) => [k, st(v).median])),
      wallMs: st(wall),
    };
    log(`${p.signal}/${p.entry.id}: ${JSON.stringify(results[p.signal][p.entry.id])}`);
  }
  out.results = { mode: 'bench', path: path.id, width: W, height: H, frames: N, query: location.search, results };
  out.ready = true;
}

function runView(device: GPUDevice, scene: SceneSignals, pair: Pair, refs: Signal[], stateAt: StateAt, dispatch: Dispatch) {
  const view = new PanelView(device, [...document.querySelectorAll<HTMLCanvasElement>('canvas.panel')], W, H);
  const SHOW = q.get('show') as TexName | null;
  const DSCALE = Number(q.get('dscale') ?? 1);
  const ERR = Number(q.get('err') ?? 0);
  const STOP_AT = q.has('stopAt') ? Number(q.get('stopAt')) : -1;
  const caption = document.querySelectorAll('figcaption')[1];
  if (caption) caption.firstChild!.textContent = `denoised: ${pair.entry.id}`;
  let f = 0;
  let seed = 0;
  let paused = false;
  const pauseBtn = document.querySelector<HTMLButtonElement>('#pause');
  pauseBtn?.addEventListener('click', () => { paused = !paused; pauseBtn.textContent = paused ? 'Resume' : 'Pause'; });
  document.querySelector<HTMLButtonElement>('#restart')?.addEventListener('click', () => { f = 0; });
  addEventListener('keydown', (e) => { if (e.code === 'Space') { e.preventDefault(); pauseBtn?.click(); } });
  const readout = document.querySelector('#frameinfo');
  const tick = () => {
    const { reset, cur, prev } = stateAt(f);
    const held = paused && !reset;
    const cam = scene.render(f, cur, held ? cur : prev, { reset, seed: seed++, refs, refSpp: REFSPP, inject: INJECT });
    const den = dispatch(pair, cam, reset);
    const sig = scene.signal(pair.signal);
    const m = sig.scalar ? 0 : 1;
    view.show([
      SHOW ? { tex: scene.textures[SHOW], mode: 2, exposure: DSCALE } : { tex: sig.noisy, mode: m },
      { tex: den, mode: m, errGain: ERR },
      { tex: sig.ref, mode: m },
    ], sig.ref);
    out.frame = f;
    if (readout) readout.textContent = `frame ${f + 1}/${FRAMES}${reset ? ' (reset)' : ''}${paused ? ' - paused' : ''}`;
    if (f === STOP_AT) { device.queue.onSubmittedWorkDone().then(() => { out.ready = true; }); return; }
    if (!paused) f = (f + 1) % FRAMES;
    requestAnimationFrame(tick);
  };
  out.ready = STOP_AT < 0;
  tick();
}

main().catch((e) => {
  console.error(e);
  out.error = String(e?.stack ?? e);
  log('ERROR: ' + out.error);
});
