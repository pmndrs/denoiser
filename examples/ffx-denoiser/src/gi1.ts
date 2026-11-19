// GI-1.0 image-space denoiser (Gi1Denoiser) checks on an analytic scene: a floor, a back
// wall and a box that can move, ray cast per pixel in WGSL. Each frame the scene pass writes
// the guides (depth, world normal, NDC motion), a noisy irradiance signal and its noise-free
// value; the denoiser runs on them and the page reads the output back.
//
//   ?checks=all (default) | a,b,c,...   which checks to run (see CHECKS below)
//   &w=640&h=360
//   &clamp=neighbourhood|none&clip=1&clipRadius=1   Gi1Denoiser historyClamp / historyClip / historyClipRadius
//                          (clamp=none: Capsaicin's unclipped history)
//   &regions=0             changeReset off (the moving box's old and new bounds are ignored)
//
// Checks (results in window.__ffx.results, one entry per check, `pass` where there is a gate):
//   still-constant   a noise-free constant field, still camera: unchanged (every pixel within 0.1%)
//   moving-constant  the same while the camera pans and the box moves: unchanged, also at the
//                    disocclusions the blur mask marks (no darkening at their edges)
//   still-noisy      uniform noise (+-50 %) on a constant field: converges to its mean
//   blur-mask        a converged view, then the box jumps: the uncovered pixels get the blur
//                    mask and are blurred, converged pixels far from the box don't
//   reprojection     a world-space pattern, converged; then the camera moves and the frame's
//                    input is withheld (hint 0): the output is the reprojected history, compared
//                    with the pattern at the new pixels (and, as a control, with zero motion)
//   ghosting         a box with a contact shadow on the floor moves and stops: how many frames
//                    until the floor matches the new input again (no trail); passes when, 64
//                    frames after the stop, no more pixels are over 5% off than before the move
import { Gi1Denoiser } from '@pmndrs/denoiser-ffx';
import type { FrameCamera } from '@pmndrs/denoiser-ffx';
import { FAR, invert, lookAt, mul, NEAR, perspective, type V3 } from './camera';

const q = new URLSearchParams(location.search);
const W = Number(q.get('w') ?? 640);
const H = Number(q.get('h') ?? 360);
const CHECKS = ['still-constant', 'moving-constant', 'still-noisy', 'blur-mask', 'reprojection', 'ghosting'] as const;
type CheckName = (typeof CHECKS)[number];
const selected = (q.get('checks') ?? 'all') === 'all' ? [...CHECKS] : (q.get('checks')!.split(',') as CheckName[]);
const FOVY = (50 * Math.PI) / 180;
const E0 = 0.7;
const CLIP = {
  historyClamp: (q.get('clamp') ?? 'neighbourhood') as 'neighbourhood' | 'none',
  historyClip: Number(q.get('clip') ?? 1),
  historyClipRadius: Number(q.get('clipRadius') ?? 1),
  changeReset: q.get('regions') !== '0',
};
const PASS_REGIONS = true; // passed always; CLIP.changeReset decides whether they are used

const status = document.querySelector<HTMLPreElement>('#status')!;
const log = (s: string) => { status.textContent += s + '\n'; };
type State = { ready: boolean; error?: string; results?: unknown };
const out: State = { ready: false };
(window as unknown as { __ffx: State }).__ffx = out;

// ---- the analytic scene -----------------------------------------------------------------

const MODE = { constant: 0, pattern: 1, shadow: 2 } as const;
const FLAG_ZERO_MOTION = 1;
const FLAG_ZERO_SIGNAL = 2;

const SCENE_WGSL = /* wgsl */ `
struct Scene {
  invViewProj: mat4x4f,
  viewProj: mat4x4f,
  prevViewProj: mat4x4f,
  eye: vec3f, frame: u32,
  box: vec3f, mode: u32,
  prevBox: vec3f, noise: f32,
  size: vec2u, hint: f32, flags: u32,
  e0: f32, _p0: f32, _p1: f32, _p2: f32,
};
@group(0) @binding(0) var<uniform> S: Scene;
@group(0) @binding(1) var depthOut: texture_storage_2d<r32float, write>;
@group(0) @binding(2) var normalOut: texture_storage_2d<rgba16float, write>;   // w: 0 sky, 1 static, 2 box
@group(0) @binding(3) var motionOut: texture_storage_2d<rgba16float, write>;
@group(0) @binding(4) var signalOut: texture_storage_2d<rgba16float, write>;
@group(0) @binding(5) var referenceOut: texture_storage_2d<r32float, write>;   // noise-free E, -1 sky

const PI = 3.14159265;

fn pcg(v: u32) -> u32 {
  let state = v * 747796405u + 2891336453u;
  let word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return (word >> 22u) ^ word;
}

fn unproject(ndc: vec3f) -> vec3f {
  let h = S.invViewProj * vec4f(ndc, 1.0);
  return h.xyz / h.w;
}

// Slab test; returns (t, normal) or t < 0.
fn hitBox(o: vec3f, d: vec3f, c: vec3f) -> vec4f {
  let lo = (c - vec3f(0.5) - o) / d;
  let hi = (c + vec3f(0.5) - o) / d;
  let t0 = min(lo, hi);
  let t1 = max(lo, hi);
  let tn = max(max(t0.x, t0.y), t0.z);
  let tf = min(min(t1.x, t1.y), t1.z);
  if (tn > tf || tf < 0.0) { return vec4f(-1.0); }
  var n = vec3f(0.0);
  if (tn == t0.x) { n = vec3f(-sign(d.x), 0.0, 0.0); }
  else if (tn == t0.y) { n = vec3f(0.0, -sign(d.y), 0.0); }
  else { n = vec3f(0.0, 0.0, -sign(d.z)); }
  return vec4f(tn, n);
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= S.size)) { return; }
  let uv = (vec2f(id.xy) + 0.5) / vec2f(S.size);
  let ndc = vec2f(2.0 * uv.x - 1.0, 1.0 - 2.0 * uv.y);
  let o = S.eye;
  let d = normalize(unproject(vec3f(ndc, 1.0)) - unproject(vec3f(ndc, 0.0)));

  var t = 1e9;
  var n = vec3f(0.0);
  var kind = 0u;
  if (d.y < 0.0) {
    let tf = -o.y / d.y;
    let p = o + tf * d;
    if (abs(p.x) <= 8.0 && p.z >= -6.0 && p.z <= 8.0 && tf < t) { t = tf; n = vec3f(0.0, 1.0, 0.0); kind = 1u; }
  }
  if (d.z < 0.0) {
    let tw = (-6.0 - o.z) / d.z;
    let p = o + tw * d;
    if (abs(p.x) <= 8.0 && p.y >= 0.0 && p.y <= 5.0 && tw < t) { t = tw; n = vec3f(0.0, 0.0, 1.0); kind = 1u; }
  }
  let b = hitBox(o, d, S.box);
  if (b.x > 0.0 && b.x < t) { t = b.x; n = b.yzw; kind = 2u; }

  if (kind == 0u) {
    textureStore(depthOut, id.xy, vec4f(1.0));
    textureStore(normalOut, id.xy, vec4f(0.0));
    textureStore(motionOut, id.xy, vec4f(0.0));
    textureStore(signalOut, id.xy, vec4f(0.0, 0.0, 0.0, 1.0)); // Capsaicin's sky value
    textureStore(referenceOut, id.xy, vec4f(-1.0));
    return;
  }

  let p = o + t * d;
  let clip = S.viewProj * vec4f(p, 1.0);
  var previous = p;
  if (kind == 2u) { previous = p - (S.box - S.prevBox); }
  let prevClip = S.prevViewProj * vec4f(previous, 1.0);
  var motion = clip.xy / clip.w - prevClip.xy / prevClip.w;
  if ((S.flags & ${FLAG_ZERO_MOTION}u) != 0u) { motion = vec2f(0.0); }

  var e = S.e0;
  if (S.mode == ${MODE.pattern}u) {
    if (kind == 2u) { e = 2.0 * S.e0; }
    else { e = S.e0 * (1.0 + 0.4 * sin(2.0 * PI * p.x / 3.0) * cos(2.0 * PI * (p.z + p.y) / 3.5)); }
  } else if (S.mode == ${MODE.shadow}u) {
    if (kind == 2u) { e = 3.0 * S.e0; }
    else if (n.y > 0.5) {
      let r = length(p.xz - S.box.xz);
      e = S.e0 * (1.0 - 0.8 * exp(-r * r / 0.6));
    }
  }
  let pixel = id.x + id.y * S.size.x;
  let u = f32(pcg(pixel ^ pcg(S.frame * 1664525u + 1013904223u))) / 4294967296.0;
  var signal = e * (1.0 + S.noise * (2.0 * u - 1.0));
  if ((S.flags & ${FLAG_ZERO_SIGNAL}u) != 0u) { signal = 0.0; }

  textureStore(depthOut, id.xy, vec4f(clip.z / clip.w));
  textureStore(normalOut, id.xy, vec4f(n, f32(kind)));
  textureStore(motionOut, id.xy, vec4f(motion, 0.0, 0.0));
  textureStore(signalOut, id.xy, vec4f(vec3f(signal), S.hint));
  textureStore(referenceOut, id.xy, vec4f(e));
}
`;

interface Cam { eye: V3; target: V3 }
interface FrameSpec {
  cam: Cam; prevCam: Cam;
  box: V3; prevBox: V3;
  mode: number; noise: number; hint: number; flags: number;
}

const HALF = (() => {
  const t = new Float32Array(65536);
  for (let h = 0; h < 65536; h++) {
    const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 31, m = h & 1023;
    t[h] = e === 0 ? s * m * 2 ** -24 : e === 31 ? (m ? NaN : s * Infinity) : s * (1 + m / 1024) * 2 ** (e - 15);
  }
  return t;
})();

class Bed {
  readonly projection = perspective(FOVY, W / H, NEAR, FAR);
  private sceneBuf: GPUBuffer;
  private pipe: GPUComputePipeline;
  private layout: GPUBindGroupLayout;
  readonly depth: GPUTexture; readonly normal: GPUTexture; readonly motion: GPUTexture;
  readonly signal: GPUTexture; readonly reference: GPUTexture;
  private frame = 0;

  constructor(private device: GPUDevice) {
    const usage = GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC;
    const tex = (label: string, format: GPUTextureFormat) => device.createTexture({ label, size: [W, H], format, usage });
    this.depth = tex('depth', 'r32float');
    this.normal = tex('normal', 'rgba16float');
    this.motion = tex('motion', 'rgba16float');
    this.signal = tex('signal', 'rgba16float');
    this.reference = tex('reference', 'r32float');
    this.sceneBuf = device.createBuffer({ size: 272, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const C = GPUShaderStage.COMPUTE;
    const sto = (binding: number, format: GPUTextureFormat): GPUBindGroupLayoutEntry => ({ binding, visibility: C, storageTexture: { access: 'write-only', format } });
    this.layout = device.createBindGroupLayout({
      entries: [{ binding: 0, visibility: C, buffer: { type: 'uniform' } },
        sto(1, 'r32float'), sto(2, 'rgba16float'), sto(3, 'rgba16float'), sto(4, 'rgba16float'), sto(5, 'r32float')],
    });
    this.pipe = device.createComputePipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [this.layout] }),
      compute: { module: device.createShaderModule({ code: SCENE_WGSL }), entryPoint: 'main' },
    });
  }

  view(c: Cam) { return lookAt(c.eye, c.target); }

  /** Renders the scene's frame and returns the camera the denoiser gets. */
  render(spec: FrameSpec): FrameCamera {
    const V = this.view(spec.cam), Vp = this.view(spec.prevCam);
    const VP = mul(this.projection, V), VPp = mul(this.projection, Vp);
    const buf = new ArrayBuffer(272);
    const f = new Float32Array(buf), u = new Uint32Array(buf);
    f.set(invert(VP), 0); f.set(VP, 16); f.set(VPp, 32);
    f.set(spec.cam.eye, 48); u[51] = this.frame++;
    f.set(spec.box, 52); u[55] = spec.mode;
    f.set(spec.prevBox, 56); f[59] = spec.noise;
    u[60] = W; u[61] = H; f[62] = spec.hint; u[63] = spec.flags;
    f[64] = E0;
    this.device.queue.writeBuffer(this.sceneBuf, 0, buf);
    const enc = this.device.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(this.pipe);
    pass.setBindGroup(0, this.device.createBindGroup({
      layout: this.layout,
      entries: [{ binding: 0, resource: { buffer: this.sceneBuf } },
        ...[this.depth, this.normal, this.motion, this.signal, this.reference].map((t, i) => ({ binding: i + 1, resource: t.createView() }))],
    }));
    pass.dispatchWorkgroups(Math.ceil(W / 8), Math.ceil(H / 8));
    pass.end();
    this.device.queue.submit([enc.finish()]);
    return { view: V, projection: this.projection, prevView: Vp, prevProjection: this.projection, near: NEAR, far: FAR, position: spec.cam.eye };
  }

  async read(texture: GPUTexture, bytesPerPixel: number): Promise<ArrayBuffer> {
    const bytesPerRow = Math.ceil((W * bytesPerPixel) / 256) * 256;
    const buffer = this.device.createBuffer({ size: bytesPerRow * H, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const enc = this.device.createCommandEncoder();
    enc.copyTextureToBuffer({ texture }, { buffer, bytesPerRow }, [W, H]);
    this.device.queue.submit([enc.finish()]);
    await buffer.mapAsync(GPUMapMode.READ);
    const src = new Uint8Array(buffer.getMappedRange());
    const dst = new Uint8Array(W * H * bytesPerPixel);
    for (let y = 0; y < H; y++) dst.set(src.subarray(y * bytesPerRow, y * bytesPerRow + W * bytesPerPixel), y * W * bytesPerPixel);
    buffer.unmap();
    buffer.destroy();
    return dst.buffer;
  }

  /** Channel 0 of an rgba16float texture, and its alpha. */
  async readHalf4(texture: GPUTexture, channel = 0): Promise<Float32Array> {
    const h = new Uint16Array(await this.read(texture, 8));
    const o = new Float32Array(W * H);
    for (let i = 0; i < o.length; i++) o[i] = HALF[h[i * 4 + channel]];
    return o;
  }

  async readFloat(texture: GPUTexture): Promise<Float32Array> {
    return new Float32Array(await this.read(texture, 4));
  }
}

// ---- statistics ---------------------------------------------------------------------------

const round = (x: number, d = 5) => Number(x.toPrecision(d));
function ratioStats(outv: Float32Array, ref: Float32Array, select?: (i: number) => boolean) {
  let sum = 0, refSum = 0, n = 0, min = Infinity, max = -Infinity;
  for (let i = 0; i < ref.length; i++) {
    if (ref[i] <= 0 || (select && !select(i))) continue;
    const r = outv[i] / ref[i];
    sum += outv[i]; refSum += ref[i]; n++;
    if (r < min) min = r;
    if (r > max) max = r;
  }
  return { meanRatio: n ? sum / refSum : NaN, min, max, n };
}

// ---- checks -----------------------------------------------------------------------------

const BASE: Cam = { eye: [0, 2, 5], target: [0, 0.5, -1] };
const still = (cam: Cam = BASE) => ({ cam, prevCam: cam });

async function runCheck(device: GPUDevice, name: CheckName): Promise<Record<string, unknown>> {
  const bed = new Bed(device);
  const hintInAlpha = name === 'reprojection';
  const dn = new Gi1Denoiser(device, { hintInAlpha, timestamps: false, ...CLIP });
  dn.configure({ width: W, height: H });
  const guides = { depth: bed.depth, normal: bed.normal, motion: bed.motion };
  // The box's old and new bounds when it moves, as a renderer's change feed reports them.
  const boxBounds = (c: V3) => ({ min: [c[0] - 0.5, c[1] - 0.5, c[2] - 0.5] as const, max: [c[0] + 0.5, c[1] + 0.5, c[2] + 0.5] as const });
  const step = (spec: FrameSpec) => {
    const camera = bed.render(spec);
    const moved = spec.box.some((v, i) => v !== spec.prevBox[i]);
    const changedRegions = PASS_REGIONS && moved ? [boxBounds(spec.prevBox), boxBounds(spec.box)] : undefined;
    return dn.dispatch({ radiance: bed.signal, changedRegions }, guides, camera);
  };
  const base: Omit<FrameSpec, 'cam' | 'prevCam'> = { box: [0, 0.5, 0], prevBox: [0, 0.5, 0], mode: MODE.constant, noise: 0, hint: 1, flags: 0 };

  try {
    if (name === 'still-constant') {
      let worst = { min: Infinity, max: -Infinity };
      const means: number[] = [];
      for (let i = 0; i < 40; i++) {
        const o = step({ ...base, ...still() });
        // Against the input as the denoiser received it (rgba16float), not the f32 reference.
        const s = ratioStats(await bed.readHalf4(o), await bed.readHalf4(bed.signal));
        means.push(s.meanRatio);
        worst = { min: Math.min(worst.min, s.min), max: Math.max(worst.max, s.max) };
      }
      const meanErr = Math.max(...means.map((m) => Math.abs(m - 1)));
      return { pass: meanErr < 1e-3 && worst.min >= 0.999 && worst.max <= 1.001, worstMeanError: round(meanErr), minRatio: round(worst.min, 6), maxRatio: round(worst.max, 6), frames: 40 };
    }

    if (name === 'moving-constant') {
      let worst = { min: Infinity, max: -Infinity }, worstMasked = { min: Infinity, max: -Infinity };
      let maskedPixels = 0, meanErr = 0;
      let prev: Cam = BASE, prevBox: V3 = [-1.5, 0.5, 0];
      for (let i = 0; i < 70; i++) {
        const t = Math.max(0, i - 10);
        const cam: Cam = { eye: [0.03 * t, 2 - 0.005 * t, 5 - 0.02 * t], target: [0.015 * t, 0.5, -1] };
        const box: V3 = [-1.5 + 0.05 * t, 0.5, 0];
        const o = step({ ...base, cam, prevCam: prev, box, prevBox });
        prev = cam; prevBox = box;
        if (i < 10) continue;
        const outv = await bed.readHalf4(o), ref = await bed.readHalf4(bed.signal), mask = await bed.readFloat(dn.debugBlurMask!);
        const s = ratioStats(outv, ref);
        const m = ratioStats(outv, ref, (j) => mask[j] > 0);
        maskedPixels += m.n;
        meanErr = Math.max(meanErr, Math.abs(s.meanRatio - 1));
        worst = { min: Math.min(worst.min, s.min), max: Math.max(worst.max, s.max) };
        if (m.n) worstMasked = { min: Math.min(worstMasked.min, m.min), max: Math.max(worstMasked.max, m.max) };
      }
      return {
        pass: meanErr < 1e-3 && worst.min >= 0.999 && worst.max <= 1.001 && maskedPixels > 0,
        worstMeanError: round(meanErr), minRatio: round(worst.min, 6), maxRatio: round(worst.max, 6),
        blurMaskedPixelFrames: maskedPixels, minRatioInBlurMask: round(worstMasked.min, 6), maxRatioInBlurMask: round(worstMasked.max, 6), frames: 60,
      };
    }

    if (name === 'still-noisy') {
      const frames = 160, tail = 40;
      const sum = new Float64Array(W * H), sum2 = new Float64Array(W * H);
      let ref: Float32Array | null = null;
      const meanAt: Record<number, number> = {};
      for (let i = 0; i < frames; i++) {
        const o = step({ ...base, ...still(), noise: 0.5 });
        if (![0, 7, 31, 63, 127].includes(i) && i < frames - tail) continue;
        const outv = await bed.readHalf4(o);
        ref ??= await bed.readFloat(bed.reference);
        if ([0, 7, 31, 63, 127].includes(i)) meanAt[i + 1] = round(ratioStats(outv, ref).meanRatio);
        if (i >= frames - tail) for (let j = 0; j < outv.length; j++) { sum[j] += outv[j]; sum2[j] += outv[j] * outv[j]; }
      }
      let mean = 0, refMean = 0, relStd = 0, n = 0;
      for (let j = 0; j < sum.length; j++) {
        if (ref![j] <= 0) continue;
        const m = sum[j] / tail;
        mean += m; refMean += ref![j]; n++;
        relStd += Math.sqrt(Math.max(sum2[j] / tail - m * m, 0)) / ref![j];
      }
      const meanRatio = mean / refMean;
      const inputRelStd = 0.5 / Math.sqrt(3);
      return {
        pass: Math.abs(meanRatio - 1) < 0.01,
        meanRatioLastFrames: round(meanRatio), meanRatioAtFrame: meanAt,
        temporalRelStd: round(relStd / n, 4), inputRelStd: round(inputRelStd, 4), noiseReduction: round(inputRelStd / (relStd / n), 3), frames,
      };
    }

    if (name === 'blur-mask') {
      for (let i = 0; i < 40; i++) step({ ...base, ...still(), noise: 0.5 });
      const idBefore = await bed.readHalf4(bed.normal, 3);
      const o = step({ ...base, ...still(), noise: 0.5, box: [0.7, 0.5, 0], prevBox: [0, 0.5, 0] });
      const idNow = await bed.readHalf4(bed.normal, 3);
      const mask = await bed.readFloat(dn.debugBlurMask!), outv = await bed.readHalf4(o), input = await bed.readHalf4(bed.signal);
      // Pixels the box covered last frame and doesn't now; converged = static both frames, 16 px clear of the box's screen bounds.
      let x0 = W, x1 = 0, y0 = H, y1 = 0;
      for (let j = 0; j < W * H; j++) if (idBefore[j] === 2 || idNow[j] === 2) {
        const x = j % W, y = (j / W) | 0;
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      }
      let disoccluded = 0, disoccludedMasked = 0, converged = 0, convergedUnmasked = 0;
      const dOut: number[] = [], dIn: number[] = [];
      for (let j = 0; j < W * H; j++) {
        const x = j % W, y = (j / W) | 0;
        // Uncovered, and the whole 3x3 neighbourhood ReprojectGI reads was the box: no history
        // to find (at the silhouette's edge a neighbour that was floor gives history, as in Capsaicin).
        let interior = x > 0 && y > 0 && x < W - 1 && y < H - 1;
        for (let dy = -1; dy <= 1 && interior; dy++) for (let dx = -1; dx <= 1; dx++) if (idBefore[j + dy * W + dx] !== 2) interior = false;
        if (idNow[j] === 1 && idBefore[j] === 2 && interior) {
          disoccluded++;
          if (mask[j] > 0) disoccludedMasked++;
          dOut.push(outv[j]); dIn.push(input[j]);
        } else if (idNow[j] === 1 && idBefore[j] === 1 && (x < x0 - 16 || x > x1 + 16 || y < y0 - 16 || y > y1 + 16)) {
          converged++;
          if (mask[j] <= 0) convergedUnmasked++;
        }
      }
      const std = (a: number[]) => { const m = a.reduce((s, v) => s + v, 0) / a.length; return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length); };
      const blurRatio = std(dOut) / std(dIn);
      return {
        pass: disoccluded > 0 && disoccludedMasked === disoccluded && convergedUnmasked / converged > 0.999 && blurRatio < 0.5,
        disoccludedPixels: disoccluded, disoccludedWithMask: disoccludedMasked,
        convergedPixels: converged, convergedWithoutMask: convergedUnmasked,
        disoccludedSpatialStdOutOverIn: round(blurRatio, 3),
      };
    }

    if (name === 'reprojection') {
      const measure = async (zeroMotion: boolean) => {
        const d2 = new Gi1Denoiser(device, { hintInAlpha: true, timestamps: false, ...CLIP });
        d2.configure({ width: W, height: H });
        for (let i = 0; i < 70; i++) {
          const camera = bed.render({ ...base, ...still(), mode: MODE.pattern });
          d2.dispatch({ radiance: bed.signal }, guides, camera);
        }
        const moved: Cam = { eye: [0.25, 2.1, 4.8], target: [0.1, 0.5, -1] };
        // This frame's input withheld: hint 0 and no signal, so the output is the history alone.
        const camera = bed.render({ ...base, cam: moved, prevCam: BASE, mode: MODE.pattern, hint: 0, flags: FLAG_ZERO_SIGNAL | (zeroMotion ? FLAG_ZERO_MOTION : 0) });
        const o = d2.dispatch({ radiance: bed.signal }, guides, camera);
        const outv = await bed.readHalf4(o), ref = await bed.readFloat(bed.reference);
        d2.dispose();
        const errs: number[] = [];
        let found = 0, surface = 0;
        for (let j = 0; j < ref.length; j++) {
          if (ref[j] <= 0) continue;
          surface++;
          if (outv[j] <= 0) continue; // no history found there (disocclusion or rejected)
          found++;
          errs.push(Math.abs(outv[j] - ref[j]) / ref[j]);
        }
        errs.sort((a, b) => a - b);
        return {
          meanRelError: round(errs.reduce((s, v) => s + v, 0) / Math.max(errs.length, 1), 4),
          p95RelError: round(errs[Math.floor(0.95 * errs.length)] ?? NaN, 4),
          historyFoundShare: round(found / surface, 4),
        };
      };
      const correct = await measure(false);
      const zero = await measure(true);
      return { pass: correct.meanRelError < 0.01 && correct.historyFoundShare > 0.9 && (zero.meanRelError > 5 * correct.meanRelError || zero.historyFoundShare < 0.5), withMotion: correct, zeroMotionControl: zero };
    }

    if (name === 'ghosting') {
      const start = -1.2, end = 0.6, moveFrames = 30;
      let box: V3 = [start, 0.5, 0];
      for (let i = 0; i < 70; i++) step({ ...base, ...still(), mode: MODE.shadow, box, prevBox: box });
      const errorCounts = async (o: GPUTexture) => {
        const outv = await bed.readHalf4(o), ref = await bed.readFloat(bed.reference), id = await bed.readHalf4(bed.normal, 3);
        let over2 = 0, over5 = 0, err = 0, n = 0;
        for (let j = 0; j < ref.length; j++) {
          if (ref[j] <= 0 || id[j] !== 1) continue;
          const e = Math.abs(outv[j] - ref[j]) / ref[j];
          err += e; n++;
          if (e > 0.02) over2++;
          if (e > 0.05) over5++;
        }
        return { over2, over5, meanRelError: err / n };
      };
      // The converged view before the move: what the trail is measured against (the screen
      // edges' vignette keeps a short, blurred history there, so they never match exactly).
      const baseline = await errorCounts(step({ ...base, ...still(), mode: MODE.shadow, box, prevBox: box }));
      const perFrame: { frame: number; over2pct: number; over5pct: number; meanRelError: number }[] = [];
      let maxTrailMoving = 0;
      for (let i = 0; i < moveFrames + 150; i++) {
        const prevBox = box;
        if (i < moveFrames) box = [start + ((end - start) * (i + 1)) / moveFrames, 0.5, 0];
        const o = step({ ...base, ...still(), mode: MODE.shadow, box, prevBox });
        const { over2, over5, meanRelError } = await errorCounts(o);
        if (i < moveFrames) maxTrailMoving = Math.max(maxTrailMoving, over5);
        else perFrame.push({ frame: i - moveFrames + 1, over2pct: over2, over5pct: over5, meanRelError: round(meanRelError, 4) });
      }
      // Cleared: no more pixels over the threshold than the converged view had before the move.
      const clearedAt = (key: 'over2pct' | 'over5pct', limit: number) => perFrame.find((p) => p[key] <= limit)?.frame ?? null;
      return {
        baselineBeforeMove: { over2pct: baseline.over2, over5pct: baseline.over5, meanRelError: round(baseline.meanRelError, 4) },
        maxPixelsOver5pctWhileMoving: maxTrailMoving,
        pass: (perFrame.find((p) => p.frame === 64)?.over5pct ?? Infinity) <= baseline.over5,
        framesAfterStopUntilBaselineOver5pct: clearedAt('over5pct', baseline.over5),
        framesAfterStopUntilBaselineOver2pct: clearedAt('over2pct', baseline.over2),
        afterStop: perFrame.filter((p) => [1, 2, 4, 8, 16, 32, 64, 100, 150].includes(p.frame)),
      };
    }
    throw new Error(`unknown check ${name}`);
  } finally {
    dn.dispose();
  }
}

async function main() {
  const adapter = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('WebGPU unavailable');
  const device = await adapter.requestDevice({
    requiredLimits: { maxStorageTexturesPerShaderStage: Math.min(8, adapter.limits.maxStorageTexturesPerShaderStage) },
  });
  const errors: string[] = [];
  device.addEventListener('uncapturederror', (e) => errors.push((e as GPUUncapturedErrorEvent).error.message));
  const info = adapter.info;
  log(`adapter: ${info.vendor} ${info.architecture} ${info.description}`);
  const results: Record<string, unknown> = {};
  for (const name of selected) {
    const r = await runCheck(device, name);
    results[name] = r;
    log(`${name}: ${JSON.stringify(r)}`);
  }
  await device.queue.onSubmittedWorkDone();
  const failed = Object.entries(results).filter(([, r]) => (r as { pass?: boolean }).pass === false).map(([k]) => k);
  if (errors.length) failed.push('device errors');
  out.results = { options: CLIP, adapter: `${info.vendor} ${info.architecture} ${info.description}`, size: [W, H], failed, deviceErrors: errors, checks: results };
  out.ready = true;
}

main().catch((e) => { out.error = String(e?.stack ?? e); log(out.error); });
