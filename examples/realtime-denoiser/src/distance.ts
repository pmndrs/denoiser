// Long-hold distance probe (review target D + review target 7; results/DISTANCE-LONG.md).
//
//   distance.html?capture=<capture>&denoiser=<registry id>&signal=<diffuse|specular|visibility|ao|so>[&<setting>=v ...]
//
// Replays a capture made by tools/rt-capture/loop-capture.mjs (an optional head, e.g. an arc that arrives at the
// hold pose, then a static hold window repeated with period P; hold frames carry the mean reference of the window)
// through one registry denoiser, without writing outputs, and measures on the CPU:
//
//   per frame      per region: mean output / mean reference (val: scalar clamped to [0,1], rgb per-channel Reinhard),
//                  MSE, linear brightness ratio (sum lum(out) / sum lum(ref)), boil (RMS of the output's second
//                  temporal difference / sqrt(6); hold frames only), and the stored distance quantity of the
//                  denoiser's history where it has one (inspect(): shadows' penumbra scale g in history .y,
//                  recurrent's normalized hit distance ĥ in H.a) against the per-pixel mean of the raw samples
//                  over one hold period (same definition as the shader's sample: shadows g = h (directional) or
//                  h / (D - h) (sphere), occluded samples only; recurrent ĥ = h / (h + 1 + 0.05 depth), miss = 1)
//   per period     (windows aligned to the hold period) the window-mean output against the reference: bias, MSE
//                  of the mean (bias + spatial error without temporal noise), temporal variance, edge sharpness
//                  (mean |grad mean output| / mean |grad ref| where |grad ref| > 0.1 scalar / 0.05 rgb, on val),
//                  brightness ratio, and the window-mean stored distance / raw mean (geometric mean ratio)
//
// Regions come from the hold window's reference and raw samples (fixed for the run): visibility all / lit (ref >= 0.98)
// / penumbra / umbra (ref <= 0.02) / contact (ref < 0.98 and mean occluder distance < 0.25 world units); diffuse and ao
// all / contact (mean diffuse ĥ < 0.5) / open (>= 0.9); specular and so all / glossy (r < 0.35) / rough / contact (mean
// specular ĥ < 0.5). Head frames (before the hold) report region 'all' only, against their own reference.
//
// Results: window.__rt = { ready, error?, frame?, results? } (examples/realtime-denoiser/run-headless.mjs with
// BASE=http://<host>/distance.html).
import { DENOISERS } from '../../../tools/rt-capture/src/denoisers';
import { loadManifest, replay } from '../../../tools/rt-capture/src/replay';
import { CaptureClient, frameDir, type CaptureLight, type CaptureManifest, type SignalName } from '../../../tools/rt-capture/src/format';
import { readTextures } from '../../../tools/rt-capture/src/gpu-readback';

type Sig = 'diffuse' | 'specular' | 'visibility' | 'ao' | 'so';
interface State { ready: boolean; error?: string; frame?: number; results?: unknown }
const out: State = { ready: false };
(window as unknown as { __rt: State }).__rt = out;
const status = document.querySelector('#status')!;
const log = (s: string) => { status.textContent += s + '\n'; };

const q = new URLSearchParams(location.search);
const capture = q.get('capture') ?? '';
const id = q.get('denoiser') ?? '';
const signal = (q.get('signal') ?? 'visibility') as Sig;
const RESERVED = new Set(['capture', 'denoiser', 'signal', 'frames', 'contactH', 'edgeThr']);
const settings = Object.fromEntries([...q].filter(([k]) => !RESERVED.has(k)));
const CONTACT_H = Number(q.get('contactH') ?? 0.25);

const SIG: Record<Sig, { ch: number; ref: string; hit: string; scalar: boolean }> = {
  diffuse: { ch: 3, ref: 'diffuse_ref', hit: 'diffuse_hitt', scalar: false },
  specular: { ch: 3, ref: 'specular_ref', hit: 'specular_hitt', scalar: false },
  visibility: { ch: 1, ref: 'visibility_ref', hit: 'occluder_dist', scalar: true },
  ao: { ch: 1, ref: 'ao_ref', hit: 'diffuse_hitt', scalar: true },
  so: { ch: 1, ref: 'so_ref', hit: 'specular_hitt', scalar: true },
};
const EDGE_THR = Number(q.get('edgeThr') ?? (SIG[signal].scalar ? 0.1 : 0.05));

const reinhard = (x: number) => (x > 0 ? x / (1 + x) : 0);
/** normalized hit distance of the recurrent filter / OcclusionDenoiser default curve (a = 1, b = 0.05) */
const hNorm = (h: number, d: number) => (h > 0 && h < 1e30 ? h / (h + 1 + 0.05 * d) : 1);

function val(src: Float32Array, ch: number, scalar: boolean, dst: Float32Array, lin?: Float32Array) {
  const n = dst.length;
  if (scalar) {
    for (let i = 0; i < n; i++) { const v = Math.min(Math.max(src[i * ch], 0), 1); dst[i] = v; if (lin) lin[i] = v; }
    return;
  }
  for (let i = 0; i < n; i++) {
    const r = src[i * ch], g = src[i * ch + 1], b = src[i * ch + 2];
    dst[i] = (reinhard(r) + reinhard(g) + reinhard(b)) / 3;
    if (lin) lin[i] = 0.2126 * Math.max(r, 0) + 0.7152 * Math.max(g, 0) + 0.0722 * Math.max(b, 0);
  }
}

function lightOf(m: CaptureManifest, frame: { lights?: CaptureLight[] } | undefined): CaptureLight | undefined {
  const ls = frame?.lights ?? m.lights;
  return ls?.find((l) => l.shadow) ?? ls?.[0];
}

async function main() {
  const adapter = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('WebGPU unavailable');
  const device = await adapter.requestDevice({
    requiredFeatures: adapter.features.has('timestamp-query') ? ['timestamp-query'] : [],
    requiredLimits: { maxStorageTexturesPerShaderStage: Math.min(8, adapter.limits.maxStorageTexturesPerShaderStage) },
  });
  device.addEventListener('uncapturederror', (e) => { const m = (e as GPUUncapturedErrorEvent).error.message; out.error ??= m; log('GPU error: ' + m); });
  const entry = DENOISERS.get(id);
  if (!entry) throw new Error(`unknown denoiser ${id}`);
  const client = new CaptureClient();
  const man = await loadManifest(capture, client) as CaptureManifest & { loop?: { holdStart: number; hold: { period: number } } };
  if (!man.loop) throw new Error(`${capture}: not a loop capture (tools/rt-capture/loop-capture.mjs)`);
  const W = man.width, H = man.height, N = W * H;
  const holdStart = man.loop.holdStart, P = man.loop.hold.period;
  const total = Math.min(Number(q.get('frames') ?? man.frames.length), man.frames.length);
  const S = SIG[signal];
  const get = (f: number, b: string, ch = 1) => client.getF32(`captures/${capture}/${frameDir(f)}/${b}.f32`, N * ch);
  log(`${capture}: ${total} frames, hold from ${holdStart}, period ${P}; ${id} on ${signal} ${JSON.stringify(settings)}`);

  // ---- pre-pass over one hold period: masks, the reference, raw distance means
  const depth = await get(holdStart, 'depth');
  const viewz = await get(holdStart, 'viewz');
  const rough = man.buffers.some((b) => b.name === 'roughness') ? await get(holdStart, 'roughness') : new Float32Array(N);
  const refRaw = await get(holdStart, S.ref, S.ch);
  const refV = new Float32Array(N), refL = new Float32Array(N);
  val(refRaw, S.ch, S.scalar, refV, refL);
  const recv = new Uint8Array(N);
  for (let i = 0; i < N; i++) recv[i] = depth[i] > 0 && depth[i] < 1 ? 1 : 0;
  // raw means over the period: own hit distance as ĥ (recurrent's sample), the diffuse / specular ĥ for contact
  // masks, shadows' occluder distance h and penumbra scale g over occluded samples
  const hitMeanN = new Float64Array(N);   // mean ĥ of S.hit (all samples)
  const contactHit = signal === 'visibility' ? 'occluder_dist' : signal === 'diffuse' || signal === 'ao' ? 'diffuse_hitt' : 'specular_hitt';
  const hSum = new Float64Array(N), gSum = new Float64Array(N), gCnt = new Float64Array(N);
  const cam = man.frames[holdStart].camera;
  const light = lightOf(man, man.frames[holdStart] as { lights?: CaptureLight[] });
  const Pm = cam.projection, Vm = cam.view, jit = cam.jitter ?? [0, 0];
  const worldAt = (i: number): [number, number, number] => {
    const px = i % W, py = (i / W) | 0;
    const nx = ((px + 0.5 + jit[0]) / W) * 2 - 1, ny = 1 - ((py + 0.5 + jit[1]) / H) * 2;
    const d = -viewz[i];
    const v = [d * (nx + Pm[8]) / Pm[0], d * (ny + Pm[9]) / Pm[5], viewz[i]];
    const t = [Vm[12], Vm[13], Vm[14]];
    const w: [number, number, number] = [0, 0, 0];
    for (let a = 0; a < 3; a++) w[a] = Vm[a * 4] * (v[0] - t[0]) + Vm[a * 4 + 1] * (v[1] - t[1]) + Vm[a * 4 + 2] * (v[2] - t[2]);
    return w;
  };
  const Dl = new Float32Array(N);
  if (signal === 'visibility' && light?.type === 'sphere' && light.position) {
    for (let i = 0; i < N; i++) if (recv[i]) { const w = worldAt(i); Dl[i] = Math.hypot(light.position[0] - w[0], light.position[1] - w[1], light.position[2] - w[2]); }
  }
  for (let f = holdStart; f < holdStart + P; f++) {
    const hit = await get(f, contactHit);
    if (signal === 'visibility') {
      const vis = await get(f, 'visibility');
      for (let i = 0; i < N; i++) {
        const h = hit[i];
        if (!recv[i] || !(vis[i] < 0.999) || !(h > 0)) continue;
        hSum[i] += h;
        gSum[i] += light?.type === 'sphere' ? h / Math.max(Dl[i] - h, 1e-3 * Dl[i]) : h;
        gCnt[i]++;
      }
    } else {
      for (let i = 0; i < N; i++) if (recv[i]) hitMeanN[i] += hNorm(hit[i], -viewz[i]) / P;
    }
  }
  const gRaw = new Float32Array(N);
  for (let i = 0; i < N; i++) gRaw[i] = gCnt[i] > 0 ? gSum[i] / gCnt[i] : 0;

  // ---- regions (bit masks)
  const names: string[] = ['all'];
  const pred: ((i: number) => boolean)[] = [() => true];
  const add = (n: string, p: (i: number) => boolean) => { names.push(n); pred.push(p); };
  if (signal === 'visibility') {
    add('lit', (i) => refV[i] >= 0.98);
    add('penumbra', (i) => refV[i] > 0.02 && refV[i] < 0.98);
    add('umbra', (i) => refV[i] <= 0.02);
    add('contact', (i) => refV[i] < 0.98 && gCnt[i] >= 2 && hSum[i] / gCnt[i] < CONTACT_H);
  } else if (signal === 'diffuse' || signal === 'ao') {
    add('contact', (i) => hitMeanN[i] < 0.5);
    add('open', (i) => hitMeanN[i] >= 0.9);
  } else {
    add('glossy', (i) => rough[i] < 0.35);
    add('rough', (i) => rough[i] >= 0.35);
    add('contact', (i) => hitMeanN[i] < 0.5);
  }
  const R = names.length;
  const mask = new Uint16Array(N);
  const counts = new Array(R).fill(0);
  for (let i = 0; i < N; i++) {
    if (!recv[i]) continue;
    for (let r = 0; r < R; r++) if (pred[r](i)) { mask[i] |= 1 << r; counts[r]++; }
  }
  log(`regions ${names.map((n, r) => `${n} ${counts[r]}`).join(', ')}`);

  // ---- accumulators
  const cur = new Float32Array(N), curL = new Float32Array(N), p1 = new Float32Array(N), p2 = new Float32Array(N);
  const wS = new Float64Array(N), wS2 = new Float64Array(N), wD = new Float64Array(N), wDn = new Float32Array(N);
  type Series = Record<string, number[]>;
  const perFrame: { frame: number[]; regions: Record<string, Series> } = { frame: [], regions: Object.fromEntries(names.map((n) => [n, {}])) };
  const push = (r: string, k: string, v: number) => { (perFrame.regions[r][k] ??= []).push(Number.isFinite(v) ? +v.toPrecision(6) : NaN); };
  const windows: Record<string, unknown>[] = [];
  let distKind: 'g' | 'hn' | null = null;
  let headRefRaw: Float32Array | null = null;
  const t0 = performance.now();

  const onFrame = async (fi: number, outs: Partial<Record<SignalName, GPUTexture>>, frame: { textures: Record<string, GPUTexture> }, inspect?: Record<string, GPUTexture | undefined>) => {
    out.frame = fi;
    const tex = outs[signal as SignalName];
    if (!tex) throw new Error(`no ${signal} output`);
    const histKey = Object.keys(inspect ?? {}).find((k) => k.endsWith('/history') && inspect![k]);
    const hist = histKey ? inspect![histKey] : undefined;
    const items = [{ texture: tex, channels: S.ch }, ...(hist ? [{ texture: hist, channels: 4 }] : [])];
    const inHold = fi >= holdStart;
    if (!inHold) items.push({ texture: frame.textures[S.ref], channels: S.ch }, { texture: frame.textures.depth, channels: 1 });
    const data = await readTextures(device, items);
    val(data[0], S.ch, S.scalar, cur, curL);
    perFrame.frame.push(fi);
    if (!inHold) {
      // head: region 'all' against this frame's own reference and receivers
      headRefRaw = data[data.length - 2];
      const d = data[data.length - 1];
      const rv = new Float32Array(N), rl = new Float32Array(N);
      val(headRefRaw, S.ch, S.scalar, rv, rl);
      let n = 0, so = 0, sr = 0, se = 0, lo = 0, lr = 0;
      for (let i = 0; i < N; i++) {
        if (!(d[i] > 0 && d[i] < 1)) continue;
        n++; so += cur[i]; sr += rv[i]; se += (cur[i] - rv[i]) ** 2; lo += curL[i]; lr += rl[i];
      }
      for (let r = 0; r < R; r++) {
        const own = r === 0;
        push(names[r], 'out', own ? so / n : NaN); push(names[r], 'ref', own ? sr / n : NaN);
        push(names[r], 'mse', own ? se / n : NaN); push(names[r], 'lin', own ? lo / lr : NaN); push(names[r], 'boil', NaN);
        push(names[r], 'dHist', NaN); push(names[r], 'dRaw', NaN); push(names[r], 'dLogRatio', NaN); push(names[r], 'histBias', NaN);
      }
      return;
    }
    const k = fi - holdStart;
    const hd = hist ? data[1] : undefined;
    if (hd && !distKind) distKind = signal === 'visibility' ? 'g' : 'hn';
    const acc = names.map(() => ({ n: 0, so: 0, sr: 0, se: 0, lo: 0, lr: 0, b2: 0, nb: 0, dh: 0, dr: 0, dl: 0, dn: 0, hb: 0 }));
    for (let i = 0; i < N; i++) {
      const m = mask[i];
      if (!m) continue;
      const o = cur[i], rv = refV[i];
      const e2 = (o - rv) ** 2;
      const boil = k >= 2 ? (o - 2 * p1[i] + p2[i]) ** 2 / 6 : NaN;
      // stored distance vs raw mean
      let dh = NaN, dr = NaN;
      if (hd) {
        if (distKind === 'g') { if (hd[i * 4 + 3] > 0 && gCnt[i] >= 2) { dh = hd[i * 4 + 1]; dr = gRaw[i]; } }
        else { dh = hd[i * 4 + 3]; dr = hitMeanN[i]; }
      }
      const hb = hd ? (S.scalar ? Math.min(Math.max(hd[i * 4], 0), 1) : NaN) - rv : NaN;
      for (let r = 0; r < R; r++) {
        if (!(m & (1 << r))) continue;
        const a = acc[r];
        a.n++; a.so += o; a.sr += rv; a.se += e2; a.lo += curL[i]; a.lr += refL[i];
        if (k >= 2) { a.b2 += boil; a.nb++; }
        if (dr > 0 && dh > 0) { a.dh += dh; a.dr += dr; a.dl += Math.log(dh / dr); a.dn++; }
        if (Number.isFinite(hb)) a.hb += hb;
      }
      // window sums
      wS[i] += o; wS2[i] += o * o;
      if (dr > 0 && dh > 0) { wD[i] += dh; wDn[i]++; }
    }
    acc.forEach((a, r) => {
      const n = names[r];
      push(n, 'out', a.so / a.n); push(n, 'ref', a.sr / a.n); push(n, 'mse', a.se / a.n); push(n, 'lin', a.lo / a.lr);
      push(n, 'boil', a.nb ? Math.sqrt(a.b2 / a.nb) : NaN);
      push(n, 'dHist', a.dn ? a.dh / a.dn : NaN); push(n, 'dRaw', a.dn ? a.dr / a.dn : NaN); push(n, 'dLogRatio', a.dn ? a.dl / a.dn : NaN);
      push(n, 'histBias', hd && S.scalar ? a.hb / a.n : NaN);
    });
    p2.set(p1); p1.set(cur);
    if ((k + 1) % P === 0) {
      // ---- window end: the window-mean output against the reference
      const mean = new Float32Array(N);
      for (let i = 0; i < N; i++) mean[i] = wS[i] / P;
      const wr: Record<string, Record<string, number>> = {};
      for (let r = 0; r < R; r++) {
        const bit = 1 << r;
        let n = 0, b = 0, e = 0, tv = 0, lo = 0, lr = 0, go = 0, gr = 0, ne = 0, dl = 0, dn = 0, dh = 0, dr = 0;
        for (let i = 0; i < N; i++) {
          if (!(mask[i] & bit)) continue;
          const mo = mean[i], rv = refV[i];
          n++; b += mo - rv; e += (mo - rv) ** 2; tv += Math.max(wS2[i] / P - mo * mo, 0);
          lo += mo; lr += rv;
          // edge sharpness (central differences inside receivers)
          const x = i % W, y = (i / W) | 0;
          if (x > 0 && x < W - 1 && y > 0 && y < H - 1 && recv[i - 1] && recv[i + 1] && recv[i - W] && recv[i + W]) {
            const gxr = (refV[i + 1] - refV[i - 1]) / 2, gyr = (refV[i + W] - refV[i - W]) / 2;
            const gref = Math.hypot(gxr, gyr);
            if (gref > EDGE_THR) {
              const gxo = (mean[i + 1] - mean[i - 1]) / 2, gyo = (mean[i + W] - mean[i - W]) / 2;
              go += Math.hypot(gxo, gyo); gr += gref; ne++;
            }
          }
          if (wDn[i] > 0) {
            const d = wD[i] / wDn[i], raw = distKind === 'g' ? gRaw[i] : hitMeanN[i];
            if (raw > 0 && d > 0) { dl += Math.log(d / raw); dn++; dh += d; dr += raw; }
          }
        }
        wr[names[r]] = {
          n, bias: b / n, mse: e / n, tvar: tv / n, meanOut: lo / n, meanRef: lr / n,
          edge: ne ? go / gr : NaN, edgePx: ne,
          dLogRatio: dn ? dl / dn : NaN, dHist: dn ? dh / dn : NaN, dRaw: dn ? dr / dn : NaN,
        };
        for (const kk of Object.keys(wr[names[r]])) { const v = wr[names[r]][kk]; wr[names[r]][kk] = Number.isFinite(v) ? +v.toPrecision(6) : v; }
      }
      // linear brightness ratio of the window from the per-frame series
      for (const n of names) {
        const s = perFrame.regions[n].lin.slice(-P);
        wr[n].lin = +(s.reduce((a, x) => a + x, 0) / s.length).toPrecision(6);
      }
      windows.push({ w: windows.length, start: fi - P + 1, end: fi + 1, regions: wr });
      wS.fill(0); wS2.fill(0); wD.fill(0); wDn.fill(0);
      log(`window ${windows.length - 1} (frames ${fi - P + 1}..${fi}): ${names.map((n) => `${n} bias ${wr[n].bias} mse ${(wr[n].mse as number).toExponential(3)}`).join(' | ')}${distKind ? ` | dist logratio ${wr.all.dLogRatio}` : ''}  ${((performance.now() - t0) / 1000).toFixed(0)} s`);
    }
  };

  await replay(device, {
    capture, denoiser: entry, settings, signals: [signal as SignalName], write: false, maxFrames: total, warmMs: 0,
    onFrame: (i, o, f, ins) => onFrame(i, o, f, ins),
  });
  out.results = {
    capture, denoiser: id, signal, settings, width: W, height: H, frames: total, holdStart, period: P, contactH: CONTACT_H, edgeThr: EDGE_THR,
    regions: names, regionPixels: counts, distance: distKind, light: light ?? null,
    perFrame, windows, seconds: +((performance.now() - t0) / 1000).toFixed(1),
  };
  out.ready = true;
  log('done');
}

main().catch((e) => { out.error = String(e?.stack ?? e); log(out.error); });
