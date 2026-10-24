// Shared pieces of the denoiser/realtime pages (realtime-shadows, realtime-gi): the
// furnished corner of shadows.ts (same scene, same area light, same three-mesh-bvh
// WebGPU traversal, copied so those pages stay untouched), plus 1-ray signals with
// hit distances, spatiotemporal blue noise, a reference accumulator and GPU readback
// helpers for the headless metrics.
import * as THREE from 'three/webgpu';
import { float, mix, uint, uniform, texture, uv, ivec2, screenCoordinate } from 'three/tsl';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { TeapotGeometry } from 'three/addons/geometries/TeapotGeometry.js';
import { getGPUTexture } from 'denoiser/three';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type N = any; // TSL's node typings are too strict for hand-written shader maths

// ---- scene (from shadows.ts) ----------------------------------------------------------

// Area light: a big rectangular softbox high on the right, facing into the corner.
export const LIGHT_C = new THREE.Vector3(2.7, 2.5, -0.35);
export const LIGHT_AIM = new THREE.Vector3(-0.8, 0.0, -0.6);
export const LIGHT_N = LIGHT_AIM.clone().sub(LIGHT_C).normalize();          // emits along +N
export const LIGHT_U = new THREE.Vector3().crossVectors(LIGHT_N, new THREE.Vector3(0, 1, 0)).normalize();
export const LIGHT_V = new THREE.Vector3().crossVectors(LIGHT_U, LIGHT_N).normalize();
export const LIGHT_ASPECT = 1.35; // panel is wider (U) than tall (V)

/** Interior-ish environment: ceiling (warm white) -> walls (beige) -> floor, plus a window patch toward the light. */
export function envRadiance(x: number, y: number, z: number): [number, number, number] {
  const win = LIGHT_C.clone().sub(LIGHT_AIM).normalize();
  let r: number, g: number, b: number;
  if (y > 0) { const k = Math.min(1, y * 1.6); r = 0.46 + 0.22 * k; g = 0.44 + 0.21 * k; b = 0.41 + 0.19 * k; }
  else { const k = Math.min(1, -y * 2.5); r = 0.46 - 0.30 * k; g = 0.44 - 0.29 * k; b = 0.41 - 0.28 * k; }
  const d = x * win.x + y * win.y + z * win.z;
  const s = Math.max(0, (d - 0.93) / 0.07) ** 2 * 6;
  return [r + s, g + s * 0.97, b + s * 0.92];
}

/** The same environment as WGSL (for diffuse rays that escape the room). */
export function envRadianceWgsl(): string {
  const w = LIGHT_C.clone().sub(LIGHT_AIM).normalize();
  const f = (v: number) => v.toFixed(7);
  return /* wgsl */ `
    fn envRadiance( d: vec3f ) -> vec3f {
      var c: vec3f;
      if ( d.y > 0.0 ) { let k = min( 1.0, d.y * 1.6 ); c = vec3f( 0.46, 0.44, 0.41 ) + vec3f( 0.22, 0.21, 0.19 ) * k; }
      else { let k = min( 1.0, - d.y * 2.5 ); c = vec3f( 0.46, 0.44, 0.41 ) - vec3f( 0.30, 0.29, 0.28 ) * k; }
      let t = max( 0.0, ( dot( d, vec3f( ${f(w.x)}, ${f(w.y)}, ${f(w.z)} ) ) - 0.93 ) / 0.07 );
      return c + vec3f( 1.0, 0.97, 0.92 ) * ( t * t * 6.0 );
    }`;
}

/** Equirectangular environment (CPU float data: SSR's env sampler needs it). */
export function makeEnvironment(): THREE.DataTexture {
  const w = 256, h = 128;
  const data = new Float32Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const phi = (y / (h - 1)) * Math.PI;
    for (let x = 0; x < w; x++) {
      const theta = (x / (w - 1)) * Math.PI * 2;
      const c = envRadiance(Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta));
      data.set([c[0], c[1], c[2], 1], (y * w + x) * 4);
    }
  }
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.FloatType);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.LinearSRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export function buildScene(W: number, H: number) {
  const scene = new THREE.Scene();
  const env = makeEnvironment();
  scene.environment = env;
  scene.environmentIntensity = 0.28;
  scene.background = new THREE.Color(0x101216);
  const camera = new THREE.PerspectiveCamera(42, W / H, 0.05, 30);

  const room = new THREE.Group();
  scene.add(room);
  const std = (color: number, roughness: number, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, ry = 0, parent: THREE.Object3D = room) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.y = ry;
    parent.add(m);
    return m;
  };

  const floorMat = std(0x6e5643, 0.12);
  const floor = add(new THREE.PlaneGeometry(16, 16), floorMat, 0, 0, 0);
  floor.rotation.x = -Math.PI / 2;
  const wallMat = std(0xd9d4cc, 0.85);
  add(new THREE.PlaneGeometry(16, 4), wallMat, 0, 2, -2.1);
  const left = add(new THREE.PlaneGeometry(16, 4), wallMat, -3.0, 2, 0);
  left.rotation.y = Math.PI / 2;
  const skirt = std(0xece8e2, 0.6);
  add(new THREE.BoxGeometry(12, 0.09, 0.02), skirt, 0, 0.045, -2.09);
  add(new THREE.BoxGeometry(0.02, 0.09, 12), skirt, -2.99, 0.045, 0);
  add(new RoundedBoxGeometry(2.5, 0.012, 1.7, 2, 0.005), std(0x56677a, 1.0), -0.15, 0.006, -0.55);

  const topMat = std(0x2b1d15, 0.12);
  const legMat = std(0x1d1d1f, 0.35, 0.85);
  const table = new THREE.Group();
  table.position.set(0.05, 0, -0.65);
  room.add(table);
  add(new RoundedBoxGeometry(1.5, 0.045, 0.8, 3, 0.012), topMat, 0, 0.74, 0, 0, table);
  const legGeo = new THREE.CylinderGeometry(0.018, 0.014, 0.72, 16);
  for (const [lx, lz] of [[-0.66, -0.32], [0.66, -0.32], [-0.66, 0.32], [0.66, 0.32]]) add(legGeo, legMat, lx, 0.36, lz, 0, table);

  const chair = new THREE.Group();
  chair.position.set(-1.05, 0, -0.5);
  chair.rotation.y = Math.PI / 2 + 0.25;
  room.add(chair);
  const oak = std(0xb88a5a, 0.55);
  add(new RoundedBoxGeometry(0.44, 0.035, 0.42, 3, 0.012), oak, 0, 0.45, 0, 0, chair);
  const back = add(new RoundedBoxGeometry(0.42, 0.24, 0.025, 3, 0.01), oak, 0, 0.74, -0.2, 0, chair);
  back.rotation.x = -0.12;
  const cLeg = new THREE.CylinderGeometry(0.014, 0.012, 0.45, 12);
  for (const [lx, lz] of [[-0.19, -0.18], [0.19, -0.18], [-0.19, 0.18], [0.19, 0.18]]) add(cLeg, legMat, lx, 0.225, lz, 0, chair);
  for (const lx of [-0.19, 0.19]) add(new THREE.CylinderGeometry(0.012, 0.012, 0.3, 10), legMat, lx, 0.6, -0.195, 0, chair);

  const lamp = new THREE.Group();
  lamp.position.set(-2.35, 0, -1.25);
  room.add(lamp);
  const brass = std(0xb08d57, 0.3, 1.0);
  add(new THREE.CylinderGeometry(0.17, 0.18, 0.025, 32), legMat, 0, 0.0125, 0, 0, lamp);
  add(new THREE.CylinderGeometry(0.011, 0.011, 1.5, 12), brass, 0, 0.76, 0, 0, lamp);
  const shadeMat = new THREE.MeshStandardMaterial({ color: 0xf1ebe0, roughness: 0.9, side: THREE.DoubleSide });
  add(new THREE.CylinderGeometry(0.13, 0.23, 0.28, 40, 1, true), shadeMat, 0, 1.58, 0, 0, lamp);

  const vaseProfile = [[0, 0], [0.12, 0], [0.15, 0.08], [0.17, 0.3], [0.12, 0.62], [0.07, 0.76], [0.08, 0.84], [0.075, 0.85]]
    .map(([r, y]) => new THREE.Vector2(r, y));
  add(new THREE.LatheGeometry(vaseProfile, 48), std(0x3f6a64, 0.35), -1.6, 0, -1.6);
  const poufProfile = [[0, 0], [0.24, 0], [0.28, 0.03], [0.3, 0.2], [0.28, 0.37], [0.24, 0.4], [0, 0.4]].map(([r, y]) => new THREE.Vector2(r, y));
  add(new THREE.LatheGeometry(poufProfile, 48), std(0xc56b4a, 0.8), 1.15, 0, 0.55);

  const tt = 0.7625;
  add(new TeapotGeometry(0.085, 10), std(0xe9e4dc, 0.25), -0.3, tt + 0.065, -0.6);
  add(new THREE.SphereGeometry(0.075, 48, 24), std(0xdddddd, 0.06, 1.0), 0.28, tt + 0.075, -0.48);
  const smallVase = [[0, 0], [0.05, 0], [0.065, 0.06], [0.04, 0.2], [0.03, 0.26], [0.035, 0.28]].map(([r, y]) => new THREE.Vector2(r, y));
  add(new THREE.LatheGeometry(smallVase, 32), std(0x9b4f3a, 0.4), 0.42, tt, -0.82);
  const bookCols = [0x2f4858, 0x8c6d46, 0xa9443a];
  bookCols.forEach((c, i) => add(new RoundedBoxGeometry(0.26, 0.035, 0.19, 2, 0.004), std(c, 0.7), 0.55, tt + 0.0175 + i * 0.036, -0.05, 0.15 * i - 0.1, table));

  add(new RoundedBoxGeometry(0.32, 0.9, 0.32, 3, 0.01), std(0xeeeae4, 0.7), 1.95, 0.45, -1.45);
  const knot = add(new THREE.TorusKnotGeometry(0.13, 0.04, 160, 20), std(0xc9a46a, 0.25, 1.0), 1.95, 1.12, -1.45);

  return { scene, camera, env, room, floorMat, topMat, knot };
}

/** Camera shots of shadows.ts: 0 = wide orbit, 1 = close-up on the table and chair legs. */
export const SHOTS = [
  { target: new THREE.Vector3(-0.35, 0.5, -0.8), r: 4.1, h: 1.65, a0: 0.2, amp: 0.3 },
  { target: new THREE.Vector3(-0.55, 0.2, -0.5), r: 2.0, h: 0.75, a0: 0.55, amp: 0.18 },
];
export function pose(camera: THREE.PerspectiveCamera, shot: number, time: number) {
  const s = SHOTS[shot];
  const a = s.a0 + s.amp * Math.sin(time * 0.21);
  const r = s.r + 0.25 * Math.sin(time * 0.13);
  camera.position.set(s.target.x + r * Math.sin(a), s.h + 0.15 * Math.sin(time * 0.17), s.target.z + r * Math.cos(a));
  camera.lookAt(s.target);
  camera.updateMatrixWorld();
}

/** The rectangular panel as the sphere light `ShadowDenoiser` understands: same centre, same area. */
export function equivalentSphereRadius(half: number) {
  return Math.sqrt((2 * half * LIGHT_ASPECT) * (2 * half) / Math.PI);
}

// ---- spatiotemporal blue noise ----------------------------------------------------------
// The renderer contract of the realtime denoisers (README, SPEC SH-7) asks for per-pixel
// blue noise animated per frame. Same scheme as examples/realtime-denoiser/src/bluenoise.ts
// (its 128x128 void-and-cluster mask, per-dimension toroidal shift + Cranley-Patterson
// rotation, R_n additive recurrence per frame), evaluated in TSL here.

const BN = 128;
function phi(n: number) { let x = 2; for (let i = 0; i < 64; i++) x = Math.pow(1 + x, 1 / (n + 1)); return x; }
const fx32 = (f: number) => Math.round((f - Math.floor(f)) * 2 ** 32) >>> 0;

/** Loads the mask; returns `xi(dim)` -> TSL float in [0, 1) for this pixel and `frame`. 2 dims per R2 pair. */
export async function blueNoise(frame: N) {
  const res = await fetch(new URL('../../../realtime-denoiser/src/bluenoise-128.bin', import.meta.url));
  if (!res.ok) throw new Error(`blue-noise mask: HTTP ${res.status}`);
  const ranks = new Uint16Array(await res.arrayBuffer());
  const tex = new THREE.DataTexture(Float32Array.from(ranks), BN, BN, THREE.RedFormat, THREE.FloatType);
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  const r2 = [1, 2].map((i) => 1 / phi(2) ** i);
  // dims come in R2 pairs: (2k, 2k+1) share the plastic-number recurrence
  return (dim: number): N => {
    const shift = [0, 1].map((k) => Math.floor(((0.5 + (dim + 1) * r2[k]) % 1) * BN));
    const rot = fx32(0.5 + (dim + 1) * Math.SQRT2);
    const alpha = fx32(r2[dim % 2]);
    const p = screenCoordinate.xy.floor();
    const q = ivec2(p.x.add(shift[0]).mod(BN) as N, p.y.add(shift[1]).mod(BN) as N);
    const rank = uint(texture(tex).load(q).r);
    const v = rank.shiftLeft(uint(18)).add(uint((1 << 17) + 0)).add(uint(rot)).add(uint(frame).mul(uint(alpha)));
    return float(v.shiftRight(uint(8))).div(16777216);
  };
}

// ---- reference accumulation ---------------------------------------------------------------

/**
 * Running average of a per-pixel node over frames (ping-pong targets, float32 so
 * thousands of frames still average exactly). `count` = frames so far; 0 restarts.
 * Stops rendering once `max` frames are in.
 */
export class AccumulateNode extends THREE.TempNode {
  readonly count = uniform(0);
  max = 128;
  private readonly targets = [0, 1].map(() => new THREE.RenderTarget(1, 1, { type: THREE.FloatType, depthBuffer: false }));
  private readonly prev = texture(this.targets[0].texture);
  private readonly out = texture(this.targets[1].texture);
  private readonly quad: THREE.QuadMesh;
  private read = 0;
  private state: N;
  /**
   * @param deps - nodes whose own passes must run before this one each frame (e.g. an SSR node the
   *   sample reads): registered as graph dependencies, the way TemporalDenoiseNode registers its inputs.
   */
  constructor(sampleNode: N, private readonly scale = 1, private readonly deps: N[] = []) {
    super('vec4');
    this.updateBeforeType = THREE.NodeUpdateType.FRAME;
    const mat = new THREE.NodeMaterial();
    mat.fragmentNode = mix(this.prev.sample(uv()), sampleNode, float(1).div(this.count.add(1))) as N;
    this.quad = new THREE.QuadMesh(mat);
  }
  get renderTargets() { return this.targets; }
  /** The accumulated result (valid after a frame has rendered). */
  get result(): THREE.Texture { return this.out.value as THREE.Texture; }
  updateBefore(frame: N): undefined {
    if (this.count.value >= this.max) return;
    const renderer = frame.renderer as THREE.WebGPURenderer;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    for (const t of this.targets) t.setSize(Math.round(size.x * this.scale), Math.round(size.y * this.scale));
    const write = 1 - this.read;
    this.prev.value = this.targets[this.read].texture;
    this.state = THREE.RendererUtils.resetRendererState(renderer, this.state);
    renderer.setRenderTarget(this.targets[write]);
    this.quad.render(renderer);
    THREE.RendererUtils.restoreRendererState(renderer, this.state);
    this.out.value = this.targets[write].texture;
    this.read = write;
    this.count.value++;
  }
  setup(builder: N) {
    const props = builder.getNodeProperties(this);
    this.deps.forEach((d, i) => { props[`dep${i}`] = d; });
    return this.out;
  }
  dispose() { for (const t of this.targets) t.dispose(); super.dispose(); }
}

// ---- GPU readback ------------------------------------------------------------------------

const halfToFloat = (h: number) => {
  const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 31, m = h & 1023;
  if (e === 0) return s * m * 2 ** -24;
  if (e === 31) return m ? NaN : s * Infinity;
  return s * (1 + m / 1024) * 2 ** (e - 15);
};

/** Reads a three texture back as RGBA float32 (rgba16float / rgba32float / r32float), row 0 = top. */
export async function readTexture(renderer: THREE.WebGPURenderer, tex: THREE.Texture): Promise<{ w: number; h: number; data: Float32Array }> {
  const device = (renderer.backend as unknown as { device: GPUDevice }).device;
  const gpu = getGPUTexture(renderer, tex);
  const fmt = gpu.format;
  const bpp = fmt === 'rgba16float' ? 8 : fmt === 'rgba32float' ? 16 : fmt === 'r32float' ? 4 : 0;
  if (!bpp) throw new Error(`readTexture: unsupported format ${fmt}`);
  const { width: w, height: h } = gpu;
  const bpr = Math.ceil((w * bpp) / 256) * 256;
  const buf = device.createBuffer({ size: bpr * h, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const enc = device.createCommandEncoder();
  enc.copyTextureToBuffer({ texture: gpu }, { buffer: buf, bytesPerRow: bpr }, { width: w, height: h });
  device.queue.submit([enc.finish()]);
  await buf.mapAsync(GPUMapMode.READ);
  const raw = buf.getMappedRange();
  const out = new Float32Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    if (fmt === 'rgba16float') {
      const row = new Uint16Array(raw, y * bpr, w * 4);
      for (let i = 0; i < w * 4; i++) out[(y * w) * 4 + i] = halfToFloat(row[i]);
    } else if (fmt === 'rgba32float') {
      out.set(new Float32Array(raw, y * bpr, w * 4), y * w * 4);
    } else {
      const row = new Float32Array(raw, y * bpr, w);
      for (let x = 0; x < w; x++) { out[(y * w + x) * 4] = row[x]; out[(y * w + x) * 4 + 3] = 1; }
    }
  }
  buf.unmap(); buf.destroy();
  return { w, h, data: out };
}

/** Count of non-finite values in an RGBA float readback. */
export const nonFiniteCount = (d: Float32Array) => { let n = 0; for (const v of d) if (!Number.isFinite(v)) n++; return n; };

/** PSNR (dB, peak 1) of channel-mapped values over masked pixels: pooled MSE. */
export function psnr(ref: Float32Array, test: Float32Array, mask: Uint8Array, map: (v: number) => number = (v) => v, channels = [0]): number {
  let se = 0, n = 0;
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    for (const c of channels) { const e = map(ref[i * 4 + c]) - map(test[i * 4 + c]); se += e * e; n++; }
  }
  return 10 * Math.log10(1 / Math.max(se / Math.max(n, 1), 1e-12));
}
