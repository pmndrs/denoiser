// Real-time denoiser test bed (denoiser/realtime, T0.3). An analytic WGSL ray
// tracer renders, every frame of a scripted stress path, the CAPTURE-FORMAT guides,
// three 1-spp demodulated signals (diffuse GI, specular, shadows) and converged
// references of the same estimators; registered denoisers run on them and are
// scored on the GPU (PSNR per region, bias, temporal stability) plus CPU LDR-FLIP on
// sampled frames.
//
//   ?signal=diffuse|specular|shadows|ao|so|all  (comma lists ok; default diffuse; all = the three
//                                             rendered signals; ao / so = T5 occlusion: normalized
//                                             hit distance of the diffuse / specular ray, scored with
//                                             a 'contact' region = reference < 0.5)
//   &denoiser=<id>[,<id>...]                 (src/denoisers.ts; default: every
//                                             denoiser registered for the signal)
//   &path=orbit|pan|light|thin|glossy|cut|object   (src/paths.ts; default orbit)
//        v1 paths (other scene builds): bumpy|bounce (normal-mapped surfaces, coloured bounce; M7)
//        and glass|glass-moving|glass-still (translucent panels, coloured shadow; M8)
//   v1 signals (CAPTURE-FORMAT v1, testbed-v1): sh-diffuse, sh-specular, shadow-rgb, or the shorthand v1
//        (signal=all,v1 = all six). A registry entry for them returns resolved demodulated rgb (sh-*,
//        at the shading normal) or the rgb shadow v·T (shadow-rgb); inputs: tools/rt-capture/src/replay.ts
//        ShInputs / TranslucentShadowInputs, guides.geometricNormal = normal_geom (shGuides()). Extra
//        results: sh-* `bump` region, `floorFrac`, `detailBand` {psnrDen, psnrNoisy, energyRatioDen,
//        energyRatioNoisy}; sh-diffuse `vsShRef` (scored against diffuse_sh_ref resolved with SPEC M7-8/9:
//        &refK=1 guard, &refS=0 sharpening, set them to the denoiser's resolve); shadow-rgb `tint` region
//        and `chromaErr`, penumbra = any channel of shadow_rgb_ref in (0.02, 0.98), rgb clamped to [0, 1].
//   &v1=1                     render the v1 buffers on a standard path even without a v1 signal
//   &mode=view|eval|bench|capture|replay     (default view)
//   &preset=fast|full                        fast = 960x540 (default), full = 1920x1080
//   &w=&h=  &frames=N (truncate the path)  &refspp=256  &refs=all (render every reference)
//   &refsalt=S                reference seed salt (default 0 = the standard references; any other
//                             value renders an independent reference set of the same estimator)
//   &ref2spp=N [&ref2salt=S] [&flip2=0]   eval (E-1): also render a SECOND reference set (N spp,
//                             salt S, default 1) and score every pair against it too
//                             (results.<signal>.<id>.vsRef2, same fields; regions keep the first
//                             reference's masks), plus the reference noise floor per signal
//                             (results.refFloor.<signal>: the second reference scored against the
//                             first). No denoiser is required in this mode (floor only).
//   &denoiser=<id>@<key>=<v>[@<key>=<v>]   a variant: the registry entry <id> with these settings
//                             on top of the page's (e.g. shadows@sh.clampGeometry=false next to
//                             shadows in one page, sharing references); results key = the full string
//   &sampling=blue|white      sampler of the 1-spp signals (default blue: spatiotemporal blue
//                             noise, src/bluenoise.ts; white = PCG per pixel/frame); references
//                             are the same either way
//   &start=S                  begin at path frame S (it becomes frame 0, a reset); paths are
//                             pure functions of the frame index, so eval with the same
//                             path/start/frames/size renders exactly the frames of a capture
//
//   capture (T0.6, CAPTURE-FORMAT v0; CAPTURES.md): writes every buffer of the selected
//   signals (default signal=all) + references, right after each render(), to
//   tools/rt-capture/captures/<name>/ ($RT_CAPTURE_DIR/captures/ if set):
//     &name=<capture>  (default testbed-<path>[-s<start>]-<frames>f-<W>x<H>)
//     &refspp=0        no references (timing-only capture)
//     &denoiser=a,b    also evaluate these live in the same run (same results as eval)
//   replay: runs a registry denoiser over a capture (tools/rt-capture/src/run.ts, same as
//   the replay page on :5230) and writes tools/rt-capture/outputs/<capture>/<output>/:
//     ?mode=replay&capture=<name>&denoiser=<id>[&signals=a,b][&frames=N][&output=<folder>][&<setting>=v]
//   (replay uses capture signal names: diffuse, specular, visibility = shadows)
//   &noise=inject [&k=2&ffRate=0.01&ffGain=20]   noise injected around the reference
//                                             (exact ground truth; quick checks)
//   &flip=0|1 &flipEvery=12   CPU LDR-FLIP on every flipEvery-th frame (eval)
//   &ppd=<pixels per degree>  FLIP viewing condition (default W / 46.4, see PPD)
//   &ageK=8                   "disoccluded" region = < ageK frames of valid history
//   &n=100                    bench frames
//   eval: &show=age puts the ground-truth history age in panel 1 (white = >= ageK frames); &show=boundary the
//         boundary-region mask (target 6, metrics.ts BOUNDARY_WGSL)
//         &dump=F&dumpRect=x,y,w,h  read back that crop of frame F's noisy / denoised / reference
//         (channel .r for scalar signals, rgb otherwise) into results.dumps (occlusion-crops.mjs)
//   reflect build (rm-* paths, src/paths-reflect.ts; results/REFLECTION-MOTION.md): eval on signal=specular adds
//         results.reflect (src/reflect-eval.ts: oracle-located marker ROIs, position error, trail, ghosts, recovery,
//         geometry checks); &rmCrops=24,41,44,71 frames kept as 8-bit ROI crops; &rmHalf=<px> ROI half size
//   view only: &show=<texture> [&dscale=] puts a SceneSignals texture in panel 1;
//              &err=<gain> error heat map in panel 2; &stopAt=N freezes at frame N
//
// Results: window.__rt = { ready, error?, frame?, results? } (read by run-headless.mjs).
import type { FrameCamera } from '@pmndrs/denoiser-ffx';
import { mountShell } from '../../_shared/shell';
import type { ReplayDenoiser, ReplayFrame } from '../../../tools/rt-capture/src/replay';
import { replayFromQuery, REPLAY_KEYS } from '../../../tools/rt-capture/src/run';
import { CaptureWriter } from '../../../tools/rt-capture/src/writer';
import { CaptureClient, fromFrameCamera } from '../../../tools/rt-capture/src/format';
import { captureBuffers, captureFrameBytes, frameExtra, isStatic, lightsOf, liveFrame, liveManifest } from './capture';
import { defaultDenoisers, denoiserById, DENOISERS, toCaptureSignal, type DenoiserEntry } from './denoisers';
import { flipMean, prepareFlip, unpackLdr, type FlipPrepared } from './flip';
import { BoundaryMask, DetailBand, HistoryAge, LdrPacker, REGIONS, Scorer, ShResolve, V1_REGIONS, type FrameScore } from './metrics';
import { pathById, PATHS, type PathDef } from './paths';
import type { ReflectPathDef } from './paths-reflect';   // registers the rm-* paths (reflect build) into PATHS
import './paths-reflect';
import { ReflectEval } from './reflect-eval';
import {
  ALL_SIGNALS, DEMODULATION, isOccSignal, isShSignal, isV1Signal, SceneSignals, SIGNALS, V1_SIGNALS, type Sampling, type Signal, type TexName,
} from './signals';
import { PanelView } from './view';

mountShell({ id: 'realtime-denoiser', title: 'Real-time denoiser test bed' });

const q = new URLSearchParams(location.search);
const mode = q.get('mode') ?? 'view';
const preset = q.get('preset') ?? 'fast';
const W = Number(q.get('w') ?? (preset === 'full' ? 1920 : 960));
const H = Number(q.get('h') ?? (preset === 'full' ? 1080 : 540));
const sigParam = q.get('signal') ?? q.get('signals') ?? (mode === 'capture' ? 'all' : 'diffuse');
// 'all' = the three rendered v0 signals, 'v1' = sh-diffuse, sh-specular, shadow-rgb
const signals: Signal[] = sigParam === 'all' ? [...SIGNALS]
  : [...new Set(sigParam.split(',').flatMap((x) => (x === 'all' ? SIGNALS : x === 'v1' ? V1_SIGNALS : [x as Signal])))].filter((s) => ALL_SIGNALS.includes(s));
const path: PathDef = pathById(q.get('path') ?? 'orbit') ?? PATHS[0];
const START = Math.max(0, Math.min(Number(q.get('start') ?? 0), path.frames - 1));
const FRAMES = Math.min(Number(q.get('frames') ?? path.frames), path.frames - START);
/** camera cuts inside the window, in local frame indices (frame 0 always resets) */
const RESETS = path.resets.filter((r) => r > START && r < START + FRAMES).map((r) => r - START);
const isResetAt = (f: number) => f === 0 || RESETS.includes(f);
const REFSPP = Number(q.get('refspp') ?? (mode === 'view' ? 64 : 256));
const REFSALT = Number(q.get('refsalt') ?? 0);
// E-1: second reference set (eval only): every pair is also scored against it, plus the noise floor
const REF2SPP = mode === 'eval' ? Number(q.get('ref2spp') ?? 0) : 0;
const REF2SALT = Number(q.get('ref2salt') ?? 1);
const CAPTURE = mode === 'capture'
  ? q.get('name') ?? `testbed-${path.id}${START ? `-s${START}` : ''}-${FRAMES}f-${W}x${H}`
  : null;
// URL keys the test bed reads itself; every other key is a denoiser setting (registry `settings`)
const TESTBED_KEYS = new Set(['signal', 'signals', 'denoiser', 'path', 'mode', 'preset', 'w', 'h', 'frames', 'start', 'refspp', 'refs',
  'noise', 'k', 'ffRate', 'ffGain', 'flip', 'flipEvery', 'ppd', 'ageK', 'n', 'show', 'dscale', 'err', 'stopAt', 'name', 'sampling', 'dump', 'dumpRect',
  'refsalt', 'ref2spp', 'ref2salt', 'flip2', 'refK', 'refS', 'v1', 'rmCrops', 'rmHalf']);
// v1: guard k and sharpening s of the SPEC M7-8 / M7-9 resolve applied to diffuse_sh_ref (vsShRef)
const REF_K = Number(q.get('refK') ?? 1);
const REF_S = Number(q.get('refS') ?? 0);
const INJECT = q.get('noise') === 'inject'
  ? { k: Number(q.get('k') ?? 2), fireflyRate: Number(q.get('ffRate') ?? 0.01), fireflyGain: Number(q.get('ffGain') ?? 20) }
  : undefined;
const FLIP = mode === 'capture' ? q.get('flip') === '1' : q.get('flip') !== '0';
const FLIP_EVERY = Number(q.get('flipEvery') ?? 12);
const AGE_K = Number(q.get('ageK') ?? 8);
// FLIP viewing condition: by default the image spans a fixed 46.4 deg (a 0.6 m wide display
// at 0.7 m), so the metric means the same at every resolution (1080p -> ~41 ppd).
// &ppd=67 gives FLIP's standard condition (0.7 m from a 0.7 m wide 4K monitor).
const PPD = Number(q.get('ppd') ?? W / 46.4);
const SETTLE = 8; // frames after a reset excluded from the "settled" means
const SAMPLING: Sampling = q.get('sampling') === 'white' ? 'white' : 'blue';

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
  group('Signal', ALL_SIGNALS.map((s) => link({ signal: s }, s, signals[0] === s)));
  const curDen = (q.get('denoiser') ?? defaultDenoisers(signals[0])[0]).split(',')[0];
  group('Denoiser', DENOISERS.filter((d) => d.signals.includes(signals[0])).map((d) => link({ denoiser: d.id }, d.id, d.id === curDen)));
  group('Path', PATHS.map((p) => link({ path: p.id }, p.label, p.id === path.id)));
  group('Mode', ['view', 'eval', 'bench'].map((m) => link({ mode: m }, m, m === mode)));
  // capture / replay are headless tools (CAPTURES.md); the replay page lists captures
  const rp = document.createElement('a');
  rp.href = 'http://127.0.0.1:5230/'; rp.textContent = 'replay page (:5230)';
  group('Captures', [rp]);
  const info = document.querySelector('#pathinfo');
  if (info) info.textContent = path.about;
}

interface Pair {
  signal: Signal;
  entry: DenoiserEntry;
  den: ReplayDenoiser;
  scorer?: Scorer;
  frames: FrameScore[];
  flip: { frame: number; noisy: number; den: number }[];
  timings: Map<string, number[]>;
  lastOut?: GPUTexture;
  /** results key: the denoiser id, or the full variant string (id@key=v) */
  key: string;
  /** E-1: scores against the second reference set (&ref2spp) */
  scorer2?: Scorer;
  frames2: FrameScore[];
  flip2: { frame: number; noisy: number; den: number }[];
  /** v1 sh-diffuse: scores against the resolved diffuse_sh_ref */
  scorerSh?: Scorer;
  framesSh: FrameScore[];
  /** v1 sh-*: detail-band sums per frame (DetailBand.score) */
  band?: DetailBand;
  bandSums: number[][];
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
  if (mode === 'replay') {
    log(`replay ${q.get('capture')} through ${q.get('denoiser')} features=[${[...device.features].join(',')}]`);
    out.results = await replayFromQuery(device, q, { log, onFrame: (i) => { out.frame = i; } });
    out.ready = true;
    return;
  }
  log(`${mode} ${signals.join(',')} path=${path.id}${START ? ` start=${START}` : ''} ${W}x${H} frames=${FRAMES} refspp=${REFSPP} sampling=${SAMPLING}${INJECT ? ' noise=inject' : ''} features=[${[...device.features].join(',')}]`);

  const V1 = signals.some(isV1Signal) || (path.scene ?? 'standard') !== 'standard' || q.get('v1') === '1';
  const scene = new SceneSignals(device, W, H, SAMPLING, { scene: path.scene ?? 'standard', v1: V1 });
  if (V1) log(`v1: scene build ${scene.scene}, v1 buffers rendered`);
  await scene.init();
  const refsNeeded: Signal[] = REFSPP <= 0 ? [] : q.get('refs') === 'all' ? [...new Set([...SIGNALS, ...signals])] : signals;
  // what denoisers see as frame.manifest (a capture's manifest has the same fields)
  const static0 = isStatic(path, START, FRAMES);
  const manifest = liveManifest(W, H, signals, refsNeeded.length > 0, lightsOf(path.at(START).light), static0, REFSPP);

  // ---- denoisers: one registry instance per (signal, denoiser); none by default in capture mode
  const pairs: Pair[] = [];
  const settings = Object.fromEntries([...q].filter(([k]) => !TESTBED_KEYS.has(k) && !REPLAY_KEYS.includes(k)));
  const denParam = q.get('denoiser') ?? (mode === 'capture' ? '' : null);
  for (const s of signals) {
    const ids = (denParam ?? defaultDenoisers(s).join(',')).split(',').filter(Boolean);
    for (const key of ids) {
      // variant syntax id@key=v@key2=v2: extra settings for this pair only
      const [id, ...over] = key.split('@');
      const entry = denoiserById(id);
      if (!entry) throw new Error(`unknown denoiser "${id}" (have: ${DENOISERS.map((d) => d.id).join(', ')})`);
      if (!entry.signals.includes(s)) { log(`skip ${id}: does not consume ${s}`); continue; }
      const own = { ...settings, ...Object.fromEntries(over.map((kv) => { const i = kv.indexOf('='); return [kv.slice(0, i), kv.slice(i + 1)]; })) };
      const den = entry.entry.create(device, { width: W, height: H, signals: [toCaptureSignal(s)], settings: own });
      pairs.push({ signal: s, entry, den, frames: [], flip: [], timings: new Map(), key, frames2: [], flip2: [], framesSh: [], bandSums: [] });
    }
  }
  if (!pairs.length && mode !== 'capture' && !REF2SPP) throw new Error('no (signal, denoiser) pair to run');
  if (pairs.length && !refsNeeded.length && mode !== 'bench') throw new Error('refspp=0 renders no references: nothing to score against');

  const stateAt = (f: number) => {
    const reset = isResetAt(f);
    const cur = path.at(START + f);
    const prev = reset ? cur : path.at(START + f - 1);
    return { reset, cur, prev };
  };
  /** the ReplayFrame of the frame just rendered (same structure as a replay's) */
  const frameOf = (f: number, reset: boolean, cam: FrameCamera): ReplayFrame =>
    liveFrame(scene, manifest, f, reset, cam, { index: f, reset, camera: fromFrameCamera(cam), ...frameExtra(scene.frameMeta!, START + f) });
  const dispatch = (p: Pair, frame: ReplayFrame) => {
    if (frame.reset) p.den.resetHistory();
    const o = p.den.dispatch(frame)[toCaptureSignal(p.signal)];
    if (!o) throw new Error(`${p.entry.id} returned no ${p.signal} output`);
    p.lastOut = o;
    return o;
  };
  const snapTimings = (p: Pair) => {
    for (const [k, v] of p.den.gpuTimings?.() ?? []) {
      if (!p.timings.has(k)) p.timings.set(k, []);
      p.timings.get(k)!.push(v);
    }
  };

  const ctx: Ctx = { stateAt, frameOf, dispatch, snapTimings };
  if (mode === 'eval' || mode === 'capture') await runEval(device, scene, pairs, refsNeeded, ctx, static0);
  else if (mode === 'bench') await runBench(device, scene, pairs, ctx);
  else runView(device, scene, pairs[0], refsNeeded, ctx);
}

type StateAt = (f: number) => { reset: boolean; cur: ReturnType<PathDef['at']>; prev: ReturnType<PathDef['at']> };
interface Ctx {
  stateAt: StateAt;
  frameOf: (f: number, reset: boolean, cam: FrameCamera) => ReplayFrame;
  dispatch: (p: Pair, frame: ReplayFrame) => GPUTexture;
  snapTimings: (p: Pair) => void;
}

const lastReset = (f: number) => Math.max(...[0, ...RESETS].filter((r) => r <= f));
const psnr = (sse: number, n: number) => (n > 0 ? 10 * Math.log10(1 / Math.max(sse / n, 1e-12)) : NaN);
// Ceiling for the *Capped variants: per-frame dB clipped here before averaging, so a frame
// with (almost) no error can't add up to 120 dB to a mean (RESULTS.md "What is measured").
const PSNR_CAP_DB = 60;
const capDb = (x: number) => (Number.isFinite(x) ? Math.min(x, PSNR_CAP_DB) : x);
const mean = (xs: number[]) => { const v = xs.filter((x) => Number.isFinite(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN; };
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
const r4 = (x: number) => (Number.isFinite(x) ? +x.toFixed(4) : x === undefined ? null : String(x));

async function runEval(device: GPUDevice, scene: SceneSignals, pairs: Pair[], refs: Signal[], { stateAt, frameOf, dispatch, snapTimings }: Ctx, isStaticScene: boolean) {
  const T = scene.textures;
  // capture mode: CAPTURE-FORMAT writer (every buffer of the selected signals, after each render)
  let writer: CaptureWriter | undefined;
  let captureInfo: Record<string, unknown> | null = null;
  if (CAPTURE) {
    writer = new CaptureWriter(device, CAPTURE);
    const info = await new CaptureClient().info().catch(() => ({ commit: null, dirty: null, root: '' }));
    const frameBytes = captureFrameBytes(W, H, signals, refs.length > 0);
    await writer.begin({
      scene: 'realtime-denoiser-testbed',
      generator: `examples/realtime-denoiser (analytic WGSL tracer) @ ${info.commit ?? '?'}${info.dirty ? '+dirty' : ''}`,
      width: W, height: H, static: isStaticScene, referenceSpp: refs.length ? Math.round(Math.sqrt(REFSPP)) ** 2 : 0,
      lights: lightsOf(path.at(START).light),
      extra: { testbed: { path: path.id, scene: scene.scene, start: START, frames: FRAMES, signals, sampling: SAMPLING, query: location.search, adapter: adapterDescription(device) } },
    });
    captureInfo = { name: CAPTURE, root: info.root, frameBytes, totalBytes: frameBytes * FRAMES };
    log(`capture ${CAPTURE}: ${FRAMES} frames x ${(frameBytes / 2 ** 20).toFixed(1)} MiB -> ${info.root}/captures/${CAPTURE}`);
  }
  const age = new HistoryAge(device, W, H);
  const bnd = new BoundaryMask(device, W, H);
  const scorePipe = Scorer.pipeline(device);
  for (const p of pairs) p.scorer = new Scorer(device, W, H, scorePipe);
  // v1: detail band (sh-*), resolved SH reference (sh-diffuse)
  const shResolve = refs.includes('sh-diffuse') && pairs.some((p) => p.signal === 'sh-diffuse') ? new ShResolve(device, W, H, REF_K, REF_S) : undefined;
  for (const p of pairs) {
    if (isShSignal(p.signal) && refs.length) p.band = new DetailBand(device, W, H);
    if (p.signal === 'sh-diffuse' && shResolve) p.scorerSh = new Scorer(device, W, H, scorePipe);
  }
  // E-1 second reference set: own textures (copies), a second scorer per pair, a floor scorer per signal
  const ref2 = new Map<Signal, GPUTexture>();
  const floor = new Map<Signal, { scorer: Scorer; frames: FrameScore[]; flip: { frame: number; noisy: number; den: number }[] }>();
  if (REF2SPP > 0) {
    if (INJECT) throw new Error('ref2spp does not combine with noise=inject');
    for (const s of refs) {
      const r = scene.signal(s).ref;
      ref2.set(s, device.createTexture({ label: `ref2 ${s}`, size: [W, H], format: r.format, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST }));
      floor.set(s, { scorer: new Scorer(device, W, H, scorePipe), frames: [], flip: [] });
    }
    for (const p of pairs) p.scorer2 = new Scorer(device, W, H, scorePipe);
  }
  const FLIP2 = REF2SPP > 0 && q.get('flip2') !== '0';
  // reflect build: oracle-located reflection metrics on the specular pairs (src/reflect-eval.ts)
  const reflectEval = path.scene === 'reflect' && refs.includes('specular') && pairs.some((p) => p.signal === 'specular')
    ? new ReflectEval({ device, width: W, height: H, path: path as ReflectPathDef, start: START,
      half: q.has('rmHalf') ? Number(q.get('rmHalf')) : undefined,
      cropFrames: (q.get('rmCrops') ?? '24,41,44,71').split(',').filter(Boolean).map(Number) })
    : undefined;
  const packer = FLIP ? new LdrPacker(device, W, H) : undefined;
  const view = new PanelView(device, [...document.querySelectorAll<HTMLCanvasElement>('canvas.panel')], W, H);
  const t0 = performance.now();
  let flipMs = 0;
  const DUMP = q.has('dump') ? Number(q.get('dump')) : -1;
  const dumpRect = (q.get('dumpRect') ?? `0,0,${Math.min(W, 256)},${Math.min(H, 256)}`).split(',').map(Number) as [number, number, number, number];
  const dumps: Record<string, Record<string, number[]>> = {};
  const dump = async (sig: Signal, name: string, tex: GPUTexture) => {
    (dumps[sig] ??= {})[name] = Array.from(await readRect(device, tex, dumpRect, scene.signal(sig).scalar ? 1 : 3), (x) => +x.toFixed(5));
  };

  for (let f = 0; f < FRAMES; f++) {
    const { reset, cur, prev } = stateAt(f);
    let cam: FrameCamera;
    if (REF2SPP > 0) {
      // second set first (rendered into the *Ref textures, copied away), then the first set in place
      cam = scene.render(START + f, cur, prev, { reset, refs: [] });
      scene.renderRefs(refs, REF2SPP, REF2SALT);
      const enc = device.createCommandEncoder({ label: 'ref2 copy' });
      for (const [s, t] of ref2) enc.copyTextureToTexture({ texture: scene.signal(s).ref }, { texture: t }, [W, H]);
      device.queue.submit([enc.finish()]);
      scene.renderRefs(refs, REFSPP, REFSALT);
    } else cam = scene.render(START + f, cur, prev, { reset, refs, refSpp: REFSPP, refSalt: REFSALT, inject: INJECT });
    const frame = frameOf(f, reset, cam);
    if (writer) await writer.writeFrame({ index: f, reset, camera: cam, extra: frameExtra(scene.frameMeta!, START + f) }, captureBuffers(scene, signals, refs.length > 0));
    age.update(T, reset);
    bnd.update(T);
    const scoreArgs = (sig: ReturnType<SceneSignals['signal']>, s: Signal, reset: boolean) => ({
      depth: T.depth, rough: T.roughness, age: age.current, motion: T.motion,
      pen: isOccSignal(s) || s === 'shadow-rgb' ? sig.ref : refs.includes('shadows') ? T.visibilityRef : undefined, contact: isOccSignal(s),
      scalar: sig.scalar, validPrev: !reset, ageK: f - lastReset(f) >= AGE_K ? AGE_K : 0,
      tonemap: sig.tonemap, ...(isShSignal(s) ? { normals: { normal: T.normal, geom: T.normalGeom } } : {}), boundary: bnd.mask,
    });
    const shRef = shResolve?.run(T.diffuseShRefA, T.diffuseShRefB, T.normal, T.normalGeom, T.depth);
    // reference noise floor: the second set scored against the first (as "denoised" and "noisy")
    for (const [s, fl] of floor) {
      const sig = scene.signal(s);
      fl.frames.push(await fl.scorer.score({ noisy: ref2.get(s)!, den: ref2.get(s)!, ref: sig.ref, ...scoreArgs(sig, s, reset) }));
    }
    for (const p of pairs) {
      const den = dispatch(p, frame);
      const sig = scene.signal(p.signal);
      const v1Args = isV1Signal(p.signal) ? scoreArgs(sig, p.signal, reset) : {};
      const r = await p.scorer!.score({
        noisy: sig.noisy, den, ref: sig.ref, depth: T.depth, rough: T.roughness, age: age.current, motion: T.motion,
        pen: isOccSignal(p.signal) ? sig.ref : refs.includes('shadows') ? T.visibilityRef : undefined, contact: isOccSignal(p.signal),
        scalar: sig.scalar, validPrev: !reset,
        // "disoccluded" excludes the AGE_K frames right after a reset (everything is history-less
        // there; those frames are covered by psnrDenFirstFrame / psnrDenAfterCut)
        ageK: f - lastReset(f) >= AGE_K ? AGE_K : 0,
        boundary: bnd.mask,
        ...v1Args,
      });
      p.frames.push(r);
      // v1: vs the resolved SH reference (same masks), detail band
      if (p.scorerSh && shRef) p.framesSh.push(await p.scorerSh.score({ noisy: sig.noisy, den, ref: shRef, ...scoreArgs(sig, p.signal, reset) }));
      if (p.band) p.bandSums.push(await p.band.score(den, sig.noisy, sig.ref, T.depth, T.normal, T.normalGeom));
      // same masks (pen / contact from the first reference), error against the second set
      if (p.scorer2) p.frames2.push(await p.scorer2.score({ noisy: sig.noisy, den, ref: ref2.get(p.signal)!, ...scoreArgs(sig, p.signal, reset) }));
      if (f >= 2) snapTimings(p);
      if (f === DUMP) {
        if (!dumps[p.signal]) { await dump(p.signal, 'noisy', sig.noisy); await dump(p.signal, 'ref', sig.ref); }
        await dump(p.signal, p.key, den);
      }
    }
    if (reflectEval) {
      const sp = scene.signal('specular');
      await reflectEval.frame(f, reset, { ref: sp.ref, noisy: sp.noisy, viewz: T.viewz, normalGeom: T.normalGeom, motion: T.motion, hit: T.specularHitT, rough: T.roughness },
        new Map(pairs.filter((p) => p.signal === 'specular').map((p) => [p.key, p.lastOut!] as const)));
    }
    if (packer && f % FLIP_EVERY === FLIP_EVERY - 1) {
      const tf = performance.now();
      for (const s of new Set([...pairs.map((p) => p.signal), ...floor.keys()])) {
        const sig = scene.signal(s);
        const prep = async (tex: GPUTexture) => {
          const u = unpackLdr(await packer.pack(tex, sig.ref, T.depth, sig.scalar, sig.tonemap === 'clamp'), W, H);
          return { prep: prepareFlip(u.rgb, W, H, PPD), mask: u.mask };
        };
        const ref = await prep(sig.ref);
        const noisy = await prep(sig.noisy);
        const flipNoisy = flipMean(ref.prep, noisy.prep, ref.mask);
        // E-1: FLIP against the second set too (non-receivers take the first set's value in every
        // packed image; both sets are identical there)
        const r2 = FLIP2 && ref2.has(s) ? await prep(ref2.get(s)!) : undefined;
        const flipNoisy2 = r2 ? flipMean(r2.prep, noisy.prep, ref.mask) : NaN;
        if (r2) { const fl = flipMean(ref.prep, r2.prep, ref.mask); floor.get(s)!.flip.push({ frame: f, noisy: fl, den: fl }); }
        for (const p of pairs.filter((pp) => pp.signal === s)) {
          const d: FlipPrepared = p.lastOut === sig.noisy ? noisy.prep : (await prep(p.lastOut!)).prep;
          p.flip.push({ frame: f, noisy: flipNoisy, den: flipMean(ref.prep, d, ref.mask) });
          if (r2) p.flip2.push({ frame: f, noisy: flipNoisy2, den: flipMean(r2.prep, d, ref.mask) });
        }
      }
      flipMs += performance.now() - tf;
    }
    if (pairs.length && (f % 8 === 0 || f === FRAMES - 1)) {
      const p = pairs[0];
      const last = p.frames[p.frames.length - 1];
      const sig = scene.signal(p.signal);
      // &show=age: panel 1 shows the ground-truth history age (white = >= ageK frames)
      const p0 = q.get('show') === 'age' ? { tex: age.current, mode: 2, exposure: 1 / AGE_K }
        : q.get('show') === 'boundary' ? { tex: bnd.mask, mode: 2, exposure: 1 } : { tex: sig.noisy, mode: sig.scalar ? 0 : 1 };
      view.show([p0, { tex: p.lastOut!, mode: sig.scalar ? 0 : 1 }, { tex: sig.ref, mode: sig.scalar ? 0 : 1 }], sig.ref);
      log(`frame ${f}: ${pairs.map((pp) => { const l = pp.frames[pp.frames.length - 1]; return `${pp.signal}/${pp.key} ${psnr(l.regions[0][1], l.regions[0][2]).toFixed(2)} dB`; }).join('  ')}  (noisy ${psnr(last.regions[0][0], last.regions[0][2]).toFixed(2)})`);
    }
    else if (!pairs.length && f % 8 === 0) log(`frame ${f}${[...floor].map(([s, fl]) => { const l = fl.frames[fl.frames.length - 1]; return `  floor ${s} ${psnr(l.regions[0][1], l.regions[0][2]).toFixed(2)} dB`; }).join('')}`);
    out.frame = f;
  }
  if (writer) {
    const r = await writer.finish();
    log(`wrote ${r.path} (${r.frames} frames)`);
  }
  await device.queue.onSubmittedWorkDone();
  await new Promise((r) => setTimeout(r, 50));
  for (const p of pairs) snapTimings(p);

  const settledMask = [...Array(FRAMES).keys()].map((f) => {
    const resets = [0, ...RESETS];
    return !resets.some((r) => f >= r && f < r + SETTLE);
  });
  // one result record from a pair's per-frame scores (E-1: called again on the second-reference scores)
  const summarize = (sig: Signal, F: FrameScore[], flips: { frame: number; noisy: number; den: number }[], id: string, gpu: Map<string, number[]>) => {
    const perFramePsnr = (k: 0 | 1, region = 0) => F.map((r) => psnr(r.regions[region][k], r.regions[region][2]));
    // PSNR of the mean MSE over frames (mask) and pixels: sum of squared errors / sum of counts
    const pooledPsnr = (k: 0 | 1, region = 0, mask?: boolean[]) => {
      let sse = 0, n = 0;
      F.forEach((r, f) => { if (!mask || mask[f]) { sse += r.regions[region][k]; n += r.regions[region][2]; } });
      return psnr(sse, n);
    };
    const pooled = (region: number) => {
      const s = [0, 0, 0, 0];
      for (const r of F) for (let i = 0; i < 4; i++) s[i] += r.regions[region][i];
      const pf = perFramePsnr(1, region);
      // psnrDen / psnrNoisy here were always pooled; psnrDenPooled repeats psnrDen so the name
      // means the same as at the sequence level, psnrDenMean / psnrDenCapped are the per-frame
      // means (frames where the region is empty are skipped)
      return {
        pixelsPerFrame: Math.round(s[2] / F.length), psnrNoisy: r4(psnr(s[0], s[2])), psnrDen: r4(psnr(s[1], s[2])), biasDen: r4(s[2] ? s[3] / s[2] : NaN),
        psnrDenPooled: r4(psnr(s[1], s[2])), psnrDenMean: r4(mean(pf)), psnrDenCapped: r4(mean(pf.map(capDb))),
      };
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
    const gpuMs = Object.fromEntries([...gpu].map(([k, v]) => [k, r4(median(v))]));
    const afterReset = RESETS.map((r) => den[r]).filter((x) => x !== undefined);
    return {
      denoiser: id,
      psnrNoisy: r4(mean(noisy)),
      psnrDen: r4(mean(den)),
      psnrDenSettled: r4(mean(den.filter((_, f) => settledMask[f]))),
      psnrDenFirstFrame: r4(den[0]),
      psnrDenAfterCut: afterReset.length ? r4(mean(afterReset)) : null,
      // pooled = PSNR of the mean MSE over frames and pixels; capped = mean of per-frame dB
      // clipped at PSNR_CAP_DB (the fields above are the plain mean of per-frame dB)
      psnrNoisyPooled: r4(pooledPsnr(0)),
      psnrDenPooled: r4(pooledPsnr(1)),
      psnrDenSettledPooled: r4(pooledPsnr(1, 0, settledMask)),
      psnrNoisyCapped: r4(mean(noisy.map(capDb))),
      psnrDenCapped: r4(mean(den.map(capDb))),
      psnrDenSettledCapped: r4(mean(den.filter((_, f) => settledMask[f]).map(capDb))),
      psnrCapDb: PSNR_CAP_DB,
      regions: Object.fromEntries(REGIONS.map((name, i) => [isOccSignal(sig) && name === 'penumbra' ? 'contact' : name, i] as const)
        .filter(([name]) => !V1_REGIONS.has(name) || (name === 'tint' ? sig === 'shadow-rgb' : isShSignal(sig)))
        .map(([name, i]) => [name, pooled(i)])),
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
      flipNoisy: r4(mean(flips.map((x) => x.noisy))),
      flipDen: r4(mean(flips.map((x) => x.den))),
      flipFrames: flips.map((x) => x.frame),
      gpuMs,
      nonFiniteInputs: nfIn, nonFiniteDenoised: nfDen,
      ...v1Fields(sig, F),
      // [psnrNoisy, psnrDen, flickerMcDen, psnrDenDisoccluded]
      perFrame: F.map((r, f) => [noisy[f], den[f], r.temporal[3] ? r.temporal[0] / r.temporal[3] : NaN, psnr(r.regions[2][1], r.regions[2][2])].map(r4)),
    };
  };
  // v1 extras: shadow-rgb chroma error in the tint region, sh-* floor fraction (SPEC M7-13 / M8-10)
  function v1Fields(sig: Signal, F: FrameScore[]) {
    if (!isV1Signal(sig)) return {};
    const v = [0, 0, 0, 0];
    for (const r of F) for (let i = 0; i < 4; i++) v[i] += r.v1[i];
    return sig === 'shadow-rgb' ? { chromaErr: r4(v[1] ? v[0] / v[1] : NaN), tintPixelsPerFrame: Math.round(v[1] / F.length) } : { floorFrac: r4(v[3] ? v[2] / v[3] : NaN) };
  }
  const bandSummary = (B: number[][]) => {
    const s = [0, 0, 0, 0, 0, 0];
    for (const b of B) for (let i = 0; i < 6; i++) s[i] += b[i];
    return {
      pixelsPerFrame: Math.round(s[3] / Math.max(B.length, 1)), psnrDen: r4(psnr(s[0], s[3])), psnrNoisy: r4(psnr(s[4], s[3])),
      energyRatioDen: r4(s[2] ? s[1] / s[2] : NaN), energyRatioNoisy: r4(s[2] ? s[5] / s[2] : NaN),
    };
  };
  const results: Record<string, Record<string, unknown>> = {};
  for (const p of pairs) {
    results[p.signal] ??= {};
    const rec: Record<string, unknown> = summarize(p.signal, p.frames, p.flip, p.key, p.timings);
    if (p.scorer2) rec.vsRef2 = summarize(p.signal, p.frames2, p.flip2, p.key, new Map());
    if (p.band) rec.detailBand = bandSummary(p.bandSums);
    if (p.scorerSh) { rec.vsShRef = summarize(p.signal, p.framesSh, [], p.key, new Map()); rec.shRefResolve = { k: REF_K, s: REF_S }; }
    results[p.signal][p.key] = rec;
  }
  // E-1 noise floor: the second reference scored against the first (psnrDen*, regions, flipDen)
  const refFloor = Object.fromEntries([...floor].map(([s, fl]) => [s, summarize(s, fl.frames, fl.flip, 'ref2-vs-ref', new Map())]));
  const summary = {
    mode, path: path.id, scene: scene.scene, start: START, width: W, height: H, frames: FRAMES, refSpp: REFSPP, sampling: SAMPLING, inject: INJECT ?? null,
    capture: captureInfo,
    refSalt: REFSALT, ...(REF2SPP > 0 ? { ref2Spp: REF2SPP, ref2Salt: REF2SALT, refFloor } : {}),
    resets: [0, ...RESETS], ageK: AGE_K, flipEvery: FLIP ? FLIP_EVERY : 0, flipPpd: +PPD.toFixed(2), query: location.search,
    adapter: adapterDescription(device), userAgent: navigator.userAgent,
    demodulation: DEMODULATION, seconds: +((performance.now() - t0) / 1000).toFixed(1), flipSeconds: +(flipMs / 1000).toFixed(1),
    results,
    ...(DUMP >= 0 ? { dumps: { frame: DUMP, rect: dumpRect, data: dumps } } : {}),
    ...(reflectEval ? { reflect: reflectEval.summary() } : {}),
  };
  const brief = JSON.parse(JSON.stringify(summary, (k, v) => (k === 'perFrame' || k === 'dumps' || k === 'crops' ? undefined : v)));
  log(JSON.stringify(brief, null, 1));
  out.results = summary;
  out.ready = true;
}

async function runBench(device: GPUDevice, scene: SceneSignals, pairs: Pair[], { stateAt, frameOf, dispatch, snapTimings }: Ctx) {
  const WARM = 20, N = Number(q.get('n') ?? 100);
  const results: Record<string, Record<string, unknown>> = {};
  for (const p of pairs) {
    const wall: number[] = [];
    p.timings.clear();
    for (let i = 0; i < WARM + N; i++) {
      const f = i % FRAMES;
      const { reset, cur, prev } = stateAt(f);
      const cam = scene.render(START + f, cur, prev, { reset });
      const frame = frameOf(f, reset, cam);
      await device.queue.onSubmittedWorkDone();
      const t0 = performance.now();
      dispatch(p, frame);
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
    results[p.signal][p.key] = {
      gpuMs: p.timings.has('total') ? st(p.timings.get('total')!) : null,
      passesMs: Object.fromEntries([...p.timings].filter(([k]) => k !== 'total').map(([k, v]) => [k, st(v).median])),
      wallMs: st(wall),
    };
    log(`${p.signal}/${p.key}: ${JSON.stringify(results[p.signal][p.key])}`);
  }
  out.results = { mode: 'bench', path: path.id, width: W, height: H, frames: N, sampling: SAMPLING, query: location.search, adapter: adapterDescription(device), userAgent: navigator.userAgent, results };
  out.ready = true;
}

function runView(device: GPUDevice, scene: SceneSignals, pair: Pair, refs: Signal[], { stateAt, frameOf, dispatch }: Ctx) {
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
    const cam = scene.render(START + f, cur, held ? cur : prev, { reset, seed: seed++, refs, refSpp: REFSPP, inject: INJECT });
    const den = dispatch(pair, frameOf(f, reset, cam));
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

/** Crop [x, y, w, h] of a float texture, `ch` channels (r or rgb) per pixel, row-major (eval &dump=). */
async function readRect(device: GPUDevice, tex: GPUTexture, [x, y, w, h]: [number, number, number, number], ch: number): Promise<Float32Array> {
  const code = /* wgsl */ `
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var<storage, read_write> o: array<f32>;
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= ${w}u || id.y >= ${h}u) { return; }
  let c = textureLoad(src, vec2u(${x}u, ${y}u) + id.xy, 0);
  let i = (id.y * ${w}u + id.x) * ${ch}u;
  ${ch === 1 ? 'o[i] = c.r;' : 'o[i] = c.r; o[i + 1u] = c.g; o[i + 2u] = c.b;'}
}`;
  const pipe = device.createComputePipeline({ layout: 'auto', compute: { module: device.createShaderModule({ code }), entryPoint: 'main' } });
  const size = w * h * ch * 4;
  const buf = device.createBuffer({ size, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  const rb = device.createBuffer({ size, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  const enc = device.createCommandEncoder();
  const pass = enc.beginComputePass();
  pass.setPipeline(pipe);
  pass.setBindGroup(0, device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: tex.createView() }, { binding: 1, resource: { buffer: buf } }] }));
  pass.dispatchWorkgroups(Math.ceil(w / 8), Math.ceil(h / 8));
  pass.end();
  enc.copyBufferToBuffer(buf, 0, rb, 0, size);
  device.queue.submit([enc.finish()]);
  await rb.mapAsync(GPUMapMode.READ);
  const out = new Float32Array(rb.getMappedRange().slice(0));
  rb.unmap(); buf.destroy(); rb.destroy();
  return out;
}

function adapterDescription(device: GPUDevice) {
  const a = (device as GPUDevice & { adapterInfo?: GPUAdapterInfo }).adapterInfo;
  return a ? { vendor: a.vendor, architecture: a.architecture, device: a.device, description: a.description } : null;
}

main().catch((e) => {
  console.error(e);
  out.error = String(e?.stack ?? e);
  log('ERROR: ' + out.error);
});
