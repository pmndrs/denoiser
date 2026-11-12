// Offline per-frame baseline: OIDN 2 (the `denoiser` package's single-image Denoiser on its
// hand-written WGSL runtime), run once per frame with no history (SPEC §13, TASKS E-2). It is a
// *baseline* scored against the same references as everything else, never a reference.
//
// Registered by the replay page only (src/main.ts), not by denoisers.ts: OIDN is async (one
// image per awaited call), so these entries implement ReplayDenoiser.dispatchAsync and are
// replay-only (`offline: true`); the test bed's live loop doesn't load them.
//
//   oidn          quality 'high' (largest weights available for the inputs), fp32
//   oidn-default  the Denoiser's default quality ('fast' = *_small weights), fp32
//
// Signals and inputs (replay names):
//   diffuse, specular  demodulated HDR radiance as HDR color (OIDN's PU transfer + autoexposure)
//   visibility         1-spp visibility in [0, 1] as grey color
//   ao                 ĥ = h / (h + 1 + 0.05·|viewZ|), miss = 1 (HitDistanceNormalizer, the input of
//                      the occlusion-* filters) as grey color
// Scalars go through the HDR weights by default (`oidn.scalar=ldr`: the LDR weights). On
// std540-orbit the LDR route lost dark shadow regions (results/E2-oidn-baseline.md: a 0.11 umbra
// came out 0.77; 19.3 vs 30.3 dB). Scalar outputs are the mean of OIDN's three output channels.
//
// Settings: `oidn.quality=high|balanced|fast`, `oidn.precision=fp32|fp16`, `oidn.aux=one|albedo|none`
// (per signal `oidn.aux.<signal>=...`): `one` = constant albedo 1 + the capture's world normal
// (clean-aux `*_calb_cnrm` weights; OIDN takes a normal only together with an albedo), `albedo` =
// the capture's albedo + normal, `none` = color only (default `one`: best on all three signals).
// `oidn.ae=0` turns autoexposure off for HDR (input scale 1). When 'high' asks for weights that aren't shipped (`*_large` exists only for
// some variants), it falls back to 'balanced'; run.json `denoiserInfo` records each signal's model.
//
// The network runs on its own max-limits GPUDevice (the replay device is created with minimal
// features): per frame the inputs are read back from the replay device, uploaded, denoised, and
// the result is written back to a replay-device texture. Timings (`<signal>/total`)
// are wall-clock ms of denoiseTextures() on the OIDN device (extract + network + resolve, awaited),
// excluding the cross-device copies; the first frame includes pipeline creation.
import { Denoiser, determineModel } from '../../../packages/denoiser-core/src/index';
import type { Quality } from '../../../packages/denoiser-core/src/types';
import { WgslRuntime } from '../../../packages/denoiser-wgsl/src/index';
import { HitDistanceNormalizer } from '../../../packages/denoiser-realtime/src/index';
import { readTextures } from './gpu-readback';
import type { DenoiserEntry, ReplayDenoiser, ReplayFrame } from './replay';
import type { SignalName } from './format';

const TZA_URL = '/tzas';
const OIDN_SIGNALS: SignalName[] = ['diffuse', 'specular', 'visibility', 'ao'];
type Aux = 'one' | 'albedo' | 'none';

async function requestMaxDevice(): Promise<GPUDevice> {
  const adapter = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('oidn: WebGPU adapter unavailable');
  const requiredLimits: Record<string, number> = {};
  const proto = Object.getPrototypeOf(adapter.limits);
  for (const name of Object.getOwnPropertyNames(proto)) {
    const v = (adapter.limits as unknown as Record<string, unknown>)[name];
    if (typeof v === 'number') requiredLimits[name] = v;
  }
  return adapter.requestDevice({ requiredFeatures: [...adapter.features] as GPUFeatureName[], requiredLimits, label: 'rt-capture oidn' });
}

const tzaExists = async (name: string) => (await fetch(`${TZA_URL}/${name}.tza`, { method: 'HEAD' }).catch(() => null))?.ok ?? false;

interface SignalState {
  signal: SignalName;
  hdr: boolean;
  aux: Aux;
  quality: Quality;
  den?: Denoiser;
  color?: GPUTexture; albedo?: GPUTexture; out?: GPUTexture;
  /** replay-device output */
  result?: GPUTexture;
  ms: number;
}

function createOidn(defaults: { quality: Quality }): DenoiserEntry['create'] {
  return (device, ctx) => {
    const st = ctx.settings;
    const quality = (st['oidn.quality'] ?? defaults.quality) as Quality;
    const precision = (st['oidn.precision'] ?? 'fp32') as 'fp32' | 'fp16';
    const autoexposure = st['oidn.ae'] !== '0';
    const { width: W, height: H } = ctx;
    const N = W * H;
    const states: SignalState[] = ctx.signals.filter((s) => OIDN_SIGNALS.includes(s)).map((s) => ({
      signal: s, hdr: s === 'diffuse' || s === 'specular' || st['oidn.scalar'] !== 'ldr',
      aux: (st[`oidn.aux.${s}`] ?? st['oidn.aux'] ?? 'one') as Aux, quality, ms: NaN,
    }));
    const normalizer = states.some((s) => s.signal === 'ao') ? new HitDistanceNormalizer(device, 'viewz') : undefined;
    normalizer?.configure(W, H, 1);
    let oidnDevice: GPUDevice | undefined;
    let runtime: WgslRuntime | undefined;
    let normalTex: GPUTexture | undefined;
    let ready: Promise<void> | undefined;
    const fallbacks: string[] = [];

    const texOn = (d: GPUDevice, label: string, format: GPUTextureFormat, usage: number) =>
      d.createTexture({ label, size: [W, H], format, usage });

    async function init() {
      oidnDevice = await requestMaxDevice();
      runtime = new WgslRuntime({ tzaUrl: TZA_URL, device: oidnDevice });
      const up = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST;
      normalTex = texOn(oidnDevice, 'oidn normal', 'rgba32float', up);
      for (const s of states) {
        const useAux = s.aux !== 'none';
        const pick = (q: Quality) => determineModel({
          filterType: 'rt', quality: q, hdr: s.hdr, useColor: true, useAlbedo: useAux, useNormal: useAux, cleanAux: useAux, dirtyAux: false,
        }).name;
        if (s.quality === 'high' && !(await tzaExists(pick('high')))) {
          fallbacks.push(`${s.signal}: ${pick('high')} not shipped, using ${pick('balanced')}`);
          s.quality = 'balanced';
        }
        s.den = await Denoiser.create({ runtime, quality: s.quality, precision });
        s.color = texOn(oidnDevice, `oidn ${s.signal} color`, 'rgba32float', up);
        if (s.aux !== 'none') s.albedo = texOn(oidnDevice, `oidn ${s.signal} albedo`, 'rgba32float', up);
        s.out = texOn(oidnDevice, `oidn ${s.signal} out`, 'rgba16float', GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC);
        s.result = texOn(device, `oidn ${s.signal} result`, s.hdr ? 'rgba32float' : 'r32float',
          GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC);
      }
    }

    const toRgba = (src: Float32Array, ch: number, fill?: number) => {
      const o = new Float32Array(N * 4);
      for (let i = 0; i < N; i++) {
        if (fill !== undefined) { o[4 * i] = o[4 * i + 1] = o[4 * i + 2] = fill; }
        else if (ch === 1) { const v = src[i]; o[4 * i] = o[4 * i + 1] = o[4 * i + 2] = v; }
        else { o[4 * i] = src[ch * i]; o[4 * i + 1] = src[ch * i + 1]; o[4 * i + 2] = src[ch * i + 2]; }
        o[4 * i + 3] = 1;
      }
      return o;
    };
    const upload = (d: GPUDevice, t: GPUTexture, data: Float32Array, ch: number) =>
      d.queue.writeTexture({ texture: t }, data as Float32Array<ArrayBuffer>, { bytesPerRow: W * ch * 4, rowsPerImage: H }, [W, H]);

    async function run(frame: ReplayFrame) {
      await (ready ??= init());
      const d = oidnDevice!;
      // signal sources on the replay device
      const srcOf = (s: SignalName): { texture: GPUTexture; channels: number } => {
        const inp = frame.inputs;
        if (s === 'diffuse' && inp.diffuse) return { texture: inp.diffuse.radiance, channels: 3 };
        if (s === 'specular' && inp.specular) return { texture: inp.specular.radiance, channels: 3 };
        if (s === 'visibility' && inp.visibility) return { texture: inp.visibility.visibility, channels: 1 };
        if (s === 'ao' && inp.ao && frame.guides.viewZ) {
          normalizer!.setCurve(1, 0.05, frame.camera.far);
          return { texture: normalizer!.run(inp.ao.hitDistance, frame.guides.viewZ), channels: 1 };
        }
        throw new Error(`oidn: capture has no ${s} input${s === 'ao' ? ' (needs diffuse_hitt + viewz)' : ''}`);
      };
      const needNormal = states.some((s) => s.aux !== 'none');
      const needAlbedo = states.some((s) => s.aux === 'albedo');
      if (needAlbedo && !frame.guides.albedo) throw new Error('oidn: oidn.aux=albedo needs an albedo buffer');
      const reads = [
        ...states.map((s) => srcOf(s.signal)),
        ...(needNormal ? [{ texture: frame.guides.normal, channels: 3 }] : []),
        ...(needAlbedo ? [{ texture: frame.guides.albedo!, channels: 3 }] : []),
      ];
      const data = await readTextures(device, reads);
      const k = states.length;
      if (needNormal) upload(d, normalTex!, toRgba(data[k], 3), 4);
      const albedoData = needAlbedo ? toRgba(data[k + (needNormal ? 1 : 0)], 3) : undefined;
      const ones = states.some((s) => s.aux === 'one') ? toRgba(new Float32Array(0), 0, 1) : undefined;
      const out: Partial<Record<SignalName, GPUTexture>> = {};
      for (let j = 0; j < k; j++) {
        const s = states[j];
        upload(d, s.color!, toRgba(data[j], reads[j].channels), 4);
        if (s.aux === 'one') upload(d, s.albedo!, ones!, 4);
        else if (s.aux === 'albedo') upload(d, s.albedo!, albedoData!, 4);
        await d.queue.onSubmittedWorkDone();
        const t0 = performance.now();
        const res = await s.den!.denoiseTextures({
          color: s.color!, hdr: s.hdr, output: s.out!,
          ...(s.aux !== 'none' ? { albedo: s.albedo!, normal: normalTex! } : {}),
          ...(s.hdr && !autoexposure ? { inputScale: 1 } : {}),
        });
        s.ms = performance.now() - t0;
        if (!res) throw new Error(`oidn: ${s.signal} denoise aborted`);
        const [o] = await readTextures(d, [{ texture: s.out!, channels: 3 }]);
        if (s.hdr) upload(device, s.result!, toRgba(o, 3), 4);
        else {
          const g = new Float32Array(N);
          for (let i = 0; i < N; i++) g[i] = (o[3 * i] + o[3 * i + 1] + o[3 * i + 2]) / 3;
          upload(device, s.result!, g, 1);
        }
        out[s.signal] = s.result!;
      }
      return out;
    }

    const den: ReplayDenoiser = {
      signals: states.map((s) => s.signal),
      dispatch() { throw new Error('oidn: offline denoiser (async, one image per call); replay-only via tools/rt-capture replay()'); },
      dispatchAsync: run,
      resetHistory() {}, // no history
      gpuTimings() {
        const m = new Map<string, number>();
        for (const s of states) m.set(`${s.signal}/total`, s.ms);
        return m;
      },
      info() {
        return {
          runtime: 'wgsl (denoiser-wgsl WgslRuntime; what AutoRuntime picks without WebNN)', precision, autoexposure,
          subgroupMatrix: oidnDevice?.features.has('chromium-experimental-subgroup-matrix' as GPUFeatureName) ?? null,
          signals: Object.fromEntries(states.map((s) => [s.signal, { model: s.den?.modelName ?? null, quality: s.quality, aux: s.aux, hdr: s.hdr }])),
          ...(fallbacks.length ? { fallbacks } : {}),
        };
      },
      dispose() {
        normalizer?.dispose();
        for (const s of states) { s.den?.destroyDevice(); s.color?.destroy(); s.albedo?.destroy(); s.out?.destroy(); s.result?.destroy(); }
        normalTex?.destroy();
        void runtime?.destroy();
        oidnDevice?.destroy();
      },
    };
    return den;
  };
}

export function registerOidnDenoisers(register: (e: DenoiserEntry) => void): void {
  register({
    id: 'oidn', offline: true, signals: OIDN_SIGNALS,
    description: "OIDN 2 single-frame baseline (denoiser Denoiser, WGSL runtime, quality 'high', fp32; no history)",
    create: createOidn({ quality: 'high' }),
  });
  register({
    id: 'oidn-default', offline: true, signals: OIDN_SIGNALS,
    description: "OIDN 2 single-frame baseline at the Denoiser's default quality ('fast', *_small weights), fp32",
    create: createOidn({ quality: 'fast' }),
  });
}
