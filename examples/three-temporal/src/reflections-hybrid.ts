// three-temporal/reflections-hybrid: probes, SSR and ray-traced reflections, the way engines mix them.
//
// The furnished room from shadows.html (same G-buffer, same ray-traced + ffxShadows area-light
// shadows), with the reflections built five ways. Every stochastic mode takes ONE GGX sample per
// pixel per frame, drawn with the same sampler three's SSR uses (ggxReflectionSample), so they all
// carry the same energy and differ only in where the reflected radiance comes from:
//
//   probe   a reflection probe: the room captured once into a cubemap (CubeCamera), prefiltered
//           with PMREM, looked up box-projected at the pixel's roughness (split-sum). No rays, no
//           noise, no denoiser - the raster default in engines (cf. three.js PR #35046).
//   ssr     three's stochastic SSR; where the screen-space ray misses, the probe in the sampled
//           direction --> ffxReflections()
//   hybrid  roughness above a cutoff: the prefiltered probe (no rays). Below it: SSR first, then
//           a ray traced against the scene BVH where SSR misses, then the probe where that ray
//           leaves the room --> ffxReflections(). AMD's "hybrid reflections" recipe.
//   rt      a traced ray for every pixel, probe on misses --> ffxReflections()
//   ref     the rt estimator, 4 rays/pixel/frame accumulated while the camera is still
//
// Ray-traced hits are shaded cheaply, as hybrid renderers do: the hit's albedo and metalness (a
// per-vertex attribute packed into the BVH), direct light from the area light with one shadow
// ray, and ambient from the same environment the raster pass uses. Rays that hit the light
// panel see its emitted radiance.

import * as THREE from 'three/webgpu';
import {
  float, vec3, vec4, uniform, uint, mix, screenCoordinate, pass, mrt, output, shadow, texture,
  diffuseColor, normalView, materialMetalness, materialRoughness, packNormalToRGB, unpackRGBToNormal,
  velocity, sample, getViewPosition, convertToTexture, renderOutput, uv,
  Fn, If, hash, pmremTexture, EnvironmentBRDF, cameraPosition,
} from 'three/tsl';
// three's SSR sampler (ggxReflectionSample isn't in @types/three yet)
import * as SpecularHelpers from 'three/addons/tsl/utils/SpecularHelpers.js';
import { ssr } from 'three/addons/tsl/display/SSRNode.js';
import { upscale } from '@pmndrs/upscaler';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { TeapotGeometry } from 'three/addons/geometries/TeapotGeometry.js';
import { BVHComputeData, wgslTagFn, rayStruct, rayIntersectionResultStruct } from 'three-mesh-bvh/webgpu';
import { ffxReflections, ffxShadows, getGPUTexture } from 'denoiser/three';
import type { TemporalDenoiseNode } from 'denoiser/three';
import { mountShell } from '../../_shared/shell';

mountShell({ id: 'three-temporal-reflections' });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any; // TSL's node typings are too strict for hand-written shader maths
const W = 960, H = 540;
const RATIO = 2; // FSR3 upscale ratio when enabled
const q = new URLSearchParams(location.search);
const manual = q.has('manual'); // headless: the page is stepped by window.__t.step()

type ShadowMode = 'map' | 'noisy' | 'ffx' | 'ref' | 'clean' | 'off'; // clean / off: diagnostics only
type ReflMode = 'probe' | 'ssr' | 'hybrid' | 'rt' | 'ref' | 'off';
const SHADOW_LABEL: Record<ShadowMode, string> = {
  map: 'three.js shadow map (VSM, blur follows light size)',
  noisy: 'ray traced, 1 ray/pixel, raw',
  ffx: 'ray traced, 1 ray/pixel + ffxShadows()',
  ref: 'reference (16 rays/pixel/frame, accumulated)',
  clean: 'diagnostic: 64 fixed rays/pixel every frame',
  off: 'diagnostic: no shadow',
};
const REFL_LABEL: Record<ReflMode, string> = {
  probe: 'reflection probe (box-projected, prefiltered), no rays',
  ssr: 'SSR, probe where it misses',
  hybrid: 'probe above the roughness cutoff; below it SSR, ray traced where SSR misses',
  rt: 'ray traced, every pixel',
  ref: 'reference (ray traced, 4 rays/pixel/frame, accumulated)',
  off: 'diagnostic: no specular',
};


const statusEl = document.querySelector<HTMLPreElement>('#status')!;
const log = (m: string) => { statusEl.textContent = m; console.log('[ffx-usecase]', m); };

// ---- the material env-specular switch ------------------------------------------
// In the SSR modes the SSR pass provides ALL specular reflection (scene hits, env
// for misses), so the materials' own env-map specular is switched off - the same
// trick three's webgpu_postprocessing_ssr example uses, but on a uniform so the
// "env map only" mode can turn it back on without recompiling.
const uEnvSpecular = uniform(1);
const _indirectSpecular = THREE.PhysicalLightingModel.prototype.indirectSpecular;
THREE.PhysicalLightingModel.prototype.indirectSpecular = function (this: N, builder: N) {
  builder.context.radiance = builder.context.radiance.mul(uEnvSpecular);
  _indirectSpecular.call(this, builder);
};

// ---- scene ------------------------------------------------------------------------

// Area light: a big rectangular softbox high on the right, facing into the corner,
// so shadows fall sideways across the floor where the camera can see them.
const LIGHT_C = new THREE.Vector3(2.7, 2.5, -0.35);
const LIGHT_AIM = new THREE.Vector3(-0.8, 0.0, -0.6);
const LIGHT_N = LIGHT_AIM.clone().sub(LIGHT_C).normalize();          // emits along +N
const LIGHT_U = new THREE.Vector3().crossVectors(LIGHT_N, new THREE.Vector3(0, 1, 0)).normalize();
const LIGHT_V = new THREE.Vector3().crossVectors(LIGHT_U, LIGHT_N).normalize();
const LIGHT_ASPECT = 1.35; // panel is wider (U) than tall (V)

/** Equirectangular interior-ish environment (CPU float data: SSR's env sampler needs it). */
function makeEnvironment(): THREE.DataTexture {
  const w = 256, h = 128;
  const data = new Float32Array(w * h * 4);
  const win = LIGHT_C.clone().sub(LIGHT_AIM).normalize(); // direction toward the light
  const dir = new THREE.Vector3();
  for (let y = 0; y < h; y++) {
    const phi = (y / (h - 1)) * Math.PI;
    for (let x = 0; x < w; x++) {
      const theta = (x / (w - 1)) * Math.PI * 2;
      dir.set(Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta));
      const up = dir.y;
      // ceiling (warm white) -> walls (beige) -> floor (dark warm grey)
      let r: number, g: number, b: number;
      if (up > 0) { const k = Math.min(1, up * 1.6); r = 0.46 + 0.22 * k; g = 0.44 + 0.21 * k; b = 0.41 + 0.19 * k; }
      else { const k = Math.min(1, -up * 2.5); r = 0.46 - 0.30 * k; g = 0.44 - 0.29 * k; b = 0.41 - 0.28 * k; }
      // a soft bright window patch in the light's direction, so env specular agrees with it
      const d = dir.dot(win);
      const s = Math.max(0, (d - 0.93) / 0.07) ** 2 * 6;
      const i = (y * w + x) * 4;
      data[i] = r + s; data[i + 1] = g + s * 0.97; data[i + 2] = b + s * 0.92; data[i + 3] = 1;
    }
  }
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.FloatType);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.LinearSRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function buildScene() {
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
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  };

  // shell: glossy floor, two matte walls, skirting
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
  // rug
  add(new RoundedBoxGeometry(2.5, 0.012, 1.7, 2, 0.005), std(0x56677a, 1.0), -0.15, 0.006, -0.55);

  // table: glossy dark top on four thin metal legs (contact shadows where they meet the rug)
  const topMat = std(0x2b1d15, 0.12);
  const legMat = std(0x1d1d1f, 0.35, 0.85);
  const table = new THREE.Group();
  table.position.set(0.05, 0, -0.65);
  room.add(table);
  add(new RoundedBoxGeometry(1.5, 0.045, 0.8, 3, 0.012), topMat, 0, 0.74, 0, 0, table);
  const legGeo = new THREE.CylinderGeometry(0.018, 0.014, 0.72, 16);
  for (const [lx, lz] of [[-0.66, -0.32], [0.66, -0.32], [-0.66, 0.32], [0.66, 0.32]]) add(legGeo, legMat, lx, 0.36, lz, 0, table);

  // chair at the left end of the table, facing it
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

  // floor lamp in the back-left corner: tall and thin -> a long, widening shadow
  const lamp = new THREE.Group();
  lamp.position.set(-2.35, 0, -1.25);
  room.add(lamp);
  const brass = std(0xb08d57, 0.3, 1.0);
  add(new THREE.CylinderGeometry(0.17, 0.18, 0.025, 32), legMat, 0, 0.0125, 0, 0, lamp);
  add(new THREE.CylinderGeometry(0.011, 0.011, 1.5, 12), brass, 0, 0.76, 0, 0, lamp);
  const shadeMat = new THREE.MeshStandardMaterial({ color: 0xf1ebe0, roughness: 0.9, side: THREE.DoubleSide });
  add(new THREE.CylinderGeometry(0.13, 0.23, 0.28, 40, 1, true), shadeMat, 0, 1.58, 0, 0, lamp);

  // tall ceramic vase on the floor (lathe)
  const vaseProfile = [[0, 0], [0.12, 0], [0.15, 0.08], [0.17, 0.3], [0.12, 0.62], [0.07, 0.76], [0.08, 0.84], [0.075, 0.85]]
    .map(([r, y]) => new THREE.Vector2(r, y));
  add(new THREE.LatheGeometry(vaseProfile, 48), std(0x3f6a64, 0.35), -1.6, 0, -1.6);

  // pouf by the front: a soft cylinder sitting right on the floor
  const poufProfile = [[0, 0], [0.24, 0], [0.28, 0.03], [0.3, 0.2], [0.28, 0.37], [0.24, 0.4], [0, 0.4]].map(([r, y]) => new THREE.Vector2(r, y));
  add(new THREE.LatheGeometry(poufProfile, 48), std(0xc56b4a, 0.8), 1.15, 0, 0.55);

  // on the table: teapot, chrome ball, small vase, books
  const tt = 0.7625; // table top surface
  add(new TeapotGeometry(0.085, 10), std(0xe9e4dc, 0.25), -0.3, tt + 0.065, -0.6);
  add(new THREE.SphereGeometry(0.075, 48, 24), std(0xdddddd, 0.06, 1.0), 0.28, tt + 0.075, -0.48);
  const smallVase = [[0, 0], [0.05, 0], [0.065, 0.06], [0.04, 0.2], [0.03, 0.26], [0.035, 0.28]].map(([r, y]) => new THREE.Vector2(r, y));
  add(new THREE.LatheGeometry(smallVase, 32), std(0x9b4f3a, 0.4), 0.42, tt, -0.82);
  const bookCols = [0x2f4858, 0x8c6d46, 0xa9443a];
  bookCols.forEach((c, i) => add(new RoundedBoxGeometry(0.26, 0.035, 0.19, 2, 0.004), std(c, 0.7), 0.55, tt + 0.0175 + i * 0.036, -0.05, 0.15 * i - 0.1, table));

  // sculpture on a plinth: slowly turns while the camera moves (a dynamic occluder)
  add(new RoundedBoxGeometry(0.32, 0.9, 0.32, 3, 0.01), std(0xeeeae4, 0.7), 1.95, 0.45, -1.45);
  const knot = add(new THREE.TorusKnotGeometry(0.13, 0.04, 160, 20), std(0xc9a46a, 0.25, 1.0), 1.95, 1.12, -1.45);

  // the light panel itself. Raster, SSR and the probe see this mesh; it is not in `room`, so
  // shadow rays (which end on the panel) can't hit it. Traced reflection rays test it analytically.
  const panelMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xfff4e6, side: THREE.DoubleSide });
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), panelMat);
  panel.position.copy(LIGHT_C);
  panel.lookAt(LIGHT_C.clone().add(LIGHT_N));
  scene.add(panel);

  // per-vertex material for traced hits: linear albedo + metalness, packed into the BVH
  room.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.geometry = m.geometry.clone(); // some geometries are shared between meshes
    const mat = m.material as THREE.MeshStandardMaterial;
    const n = m.geometry.attributes.position.count;
    const a = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) a.set([mat.color.r, mat.color.g, mat.color.b, mat.metalness], i * 4);
    m.geometry.setAttribute('mat', new THREE.BufferAttribute(a, 4));
  });

  return { scene, camera, env, room, floorMat, topMat, knot, panel, panelMat };
}

// ---- reference accumulation ---------------------------------------------------------

/**
 * Running average of a per-pixel node over frames (ping-pong half-float targets).
 * `count` = frames accumulated so far; set it to 0 to restart. Stops rendering
 * once `max` frames are in (the result then stays put).
 */
class AccumulateNode extends THREE.TempNode {
  readonly count = uniform(0);
  max = 128;
  private readonly targets = [0, 1].map(() => new THREE.RenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false }));
  private readonly prev = texture(this.targets[0].texture);
  private readonly out = texture(this.targets[1].texture);
  private readonly quad: THREE.QuadMesh;
  private read = 0;
  private state: N;
  constructor(sampleNode: N, private readonly scale = 1) {
    super('vec4');
    this.updateBeforeType = THREE.NodeUpdateType.FRAME;
    const mat = new THREE.NodeMaterial();
    mat.fragmentNode = mix(this.prev.sample(uv()), sampleNode, float(1).div(this.count.add(1))) as N;
    this.quad = new THREE.QuadMesh(mat);
  }
  get renderTargets() { return this.targets; }
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
  setup() { return this.out; }
  dispose() { for (const t of this.targets) t.dispose(); super.dispose(); }
}

// ---- main ---------------------------------------------------------------------------

async function main() {
  const canvas = document.querySelector<HTMLCanvasElement>('#view')!;
  canvas.width = W; canvas.height = H;
  if (!navigator.gpu) { log('WebGPU is not available in this browser.'); return; }

  const renderer = new THREE.WebGPURenderer({ canvas, antialias: false, trackTimestamp: !q.has('notiming') } as N);
  await renderer.init();
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  // All tone mapping / encoding happens in the graph; keep the output transform identity.
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.VSMShadowMap;
  // ?notiming: no GPU timestamp queries, to see what measuring costs
  const hasTimestamps = renderer.hasFeature('timestamp-query') && !q.has('notiming');
  const device = (renderer.backend as unknown as { device: GPUDevice }).device;
  const gpuErrors: string[] = [];
  device.addEventListener('uncapturederror', (e) => {
    const msg = (e as GPUUncapturedErrorEvent).error.message;
    gpuErrors.push(msg);
    console.error('[webgpu uncapturederror]', msg);
  });
  device.lost.then((i) => log(`DEVICE LOST: ${i.reason} ${i.message}`));

  const { scene, camera, env, room, floorMat, topMat, knot, panel, panelMat } = buildScene();
  scene.updateMatrixWorld(true);

  // ---- BVH over the real scene meshes (three-mesh-bvh, WebGPU) ----------------------
  const tBvh = performance.now();
  const bvh = new BVHComputeData(room, { attributes: { position: 'vec4f', mat: 'vec4f' } });
  bvh.update();
  let tris = 0;
  room.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) tris += (m.geometry.index?.count ?? m.geometry.attributes.position.count) / 3; });
  const bvhMs = performance.now() - tBvh;

  // One WGSL function: visibility of a rectangular light from a surface point,
  // `grid x grid` stratified rays (grid = 1 -> one random point = the 1-spp signal).
  // Every ray is a real BVH traversal of the scene triangles.
  const areaVisibility = wgslTagFn`
    fn areaVisibility( P: vec3f, Nw: vec3f, sky: f32, C: vec3f, U: vec3f, V: vec3f, nL: vec3f,
                       eps: f32, seed: u32, grid: u32 ) -> f32 {
      if ( sky > 0.5 ) { return 1.0; }
      let o = P + Nw * eps;
      var lit = 0.0;
      var s = seed;
      for ( var j = 0u; j < grid; j++ ) {
        for ( var i = 0u; i < grid; i++ ) {
          s = s * 747796405u + 2891336453u;
          var w = ( ( s >> ( ( s >> 28u ) + 4u ) ) ^ s ) * 277803737u;
          let r0 = f32( ( w >> 22u ) ^ w ) / 4294967296.0;
          s = s * 747796405u + 2891336453u;
          w = ( ( s >> ( ( s >> 28u ) + 4u ) ) ^ s ) * 277803737u;
          let r1 = f32( ( w >> 22u ) ^ w ) / 4294967296.0;
          let lu = ( f32( i ) + r0 ) / f32( grid ) * 2.0 - 1.0;
          let lv = ( f32( j ) + r1 ) / f32( grid ) * 2.0 - 1.0;
          let toL = C + U * lu + V * lv - o;
          let dist = length( toL );
          let dir = toL / dist;
          if ( dot( Nw, dir ) <= 0.0 || dot( nL, dir ) >= 0.0 ) { continue; }
          let ray = ${rayStruct}( o, dir, dist );
          var hit: ${rayIntersectionResultStruct};
          if ( ! ${(bvh.fns as N).raycastFirstHit}( ray, &hit ) ) { lit += 1.0; }
        }
      }
      return lit / f32( grid * grid );
    }
  ` as N;

  // The ambient term of traced hits: the gradient of the room's environment (makeEnvironment
  // without the window patch), so hits are lit like the raster pass lights the same surfaces.
  const envRadiance = wgslTagFn`
    fn envRadiance( d: vec3f ) -> vec3f {
      if ( d.y > 0.0 ) { let k = min( 1.0, d.y * 1.6 ); return vec3f( 0.46 + 0.22 * k, 0.44 + 0.21 * k, 0.41 + 0.19 * k ); }
      let k = min( 1.0, - d.y * 2.5 );
      return vec3f( 0.46 - 0.30 * k, 0.44 - 0.29 * k, 0.41 - 0.28 * k );
    }
  ` as N;

  // One reflection ray from P along D against the scene BVH, shaded at the hit.
  // Returns (radiance, hit distance), or w = -1 when the ray leaves the scene (the caller
  // falls back to the probe). Hits on the light panel return its emitted radiance.
  const traceReflection = wgslTagFn`
    fn traceReflection( P: vec3f, Nw: vec3f, D: vec3f, eps: f32, seed: u32,
                        C: vec3f, U: vec3f, V: vec3f, nL: vec3f, power: f32, radiance: f32, envIntensity: f32 ) -> vec4f {
      let o = P + Nw * eps;
      // the light panel (emits along +nL), intersected analytically
      var tLight = 1e30;
      let denom = dot( D, nL );
      if ( denom < -1e-4 ) {
        let t = dot( C - o, nL ) / denom;
        let q = o + D * t - C;
        if ( t > 0.0 && abs( dot( q, U ) / dot( U, U ) ) <= 1.0 && abs( dot( q, V ) / dot( V, V ) ) <= 1.0 ) { tLight = t; }
      }
      let ray = ${rayStruct}( o, D, 0.0 );
      var hit: ${rayIntersectionResultStruct};
      if ( ${(bvh.fns as N).raycastFirstHit}( ray, &hit ) && hit.dist < tLight ) {
        let Ph = o + D * hit.dist;
        var n = hit.normal;
        if ( dot( n, D ) > 0.0 ) { n = -n; }
        let m = ${(bvh.storage as N).attributes}[ hit.indices.x ].mat;
        let diffuse = m.rgb * ( 1.0 - m.w );
        // direct light from the panel, one shadow ray (the same estimator as the shadow pass)
        let toL = C - Ph;
        let d2 = max( dot( toL, toL ), 1e-3 );
        let l = toL * inverseSqrt( d2 );
        let E = power * max( dot( n, l ), 0.0 ) * max( dot( nL, -l ), 0.0 ) / d2;
        let vis = ${areaVisibility}( Ph, n, 0.0, C, U, V, nL, 0.004 + hit.dist * 0.001, seed ^ 0x9e3779b9u, 1u );
        var c = diffuse * ( E * vis + ${envRadiance}( n ) * envIntensity );
        // metals mirror the environment (no second bounce into the scene)
        c += m.rgb * m.w * ${envRadiance}( reflect( D, n ) ) * envIntensity;
        return vec4f( c, hit.dist );
      }
      if ( tLight < 1e29 ) { return vec4f( radiance * vec3f( 1.0, 0.905, 0.791 ), tLight ); }
      return vec4f( 0.0, 0.0, 0.0, -1.0 );
    }
  ` as N;

  // ---- uniforms ------------------------------------------------------------------
  const uLightC = uniform(LIGHT_C.clone());
  const uLightU = uniform(new THREE.Vector3());
  const uLightV = uniform(new THREE.Vector3());
  const uLightN = uniform(LIGHT_N.clone());
  const uLightPower = uniform(30);
  const uFrame = uniform(0, 'uint');
  const uLightRadiance = uniform(1);
  const uRoughCut = uniform(0.35); // hybrid: rougher than this takes the prefiltered probe
  let lightHalf = 0.3;

  // three's shadow map for the same light: a SpotLight at the panel's centre, VSM
  // filtered; its blur radius follows the light-size slider (that is what you'd do
  // to fake a bigger light) - but it blurs the same amount everywhere.
  const spot = new THREE.SpotLight(0xffffff, 1, 0, 0.9, 0);
  spot.position.copy(LIGHT_C);
  spot.target.position.copy(LIGHT_AIM);
  spot.castShadow = true;
  spot.shadow.mapSize.set(2048, 2048);
  spot.shadow.camera.near = 1;
  spot.shadow.camera.far = 8;
  spot.shadow.bias = -0.0005;
  spot.shadow.normalBias = 0.03;
  spot.shadow.blurSamples = 8; // three's default
  spot.updateMatrixWorld(); spot.target.updateMatrixWorld();

  const setLightSize = (half: number) => {
    lightHalf = half;
    uLightU.value.copy(LIGHT_U).multiplyScalar(half * LIGHT_ASPECT);
    uLightV.value.copy(LIGHT_V).multiplyScalar(half);
    spot.shadow.radius = 1 + half * 26;
    spot.shadow.needsUpdate = true;
    // the panel's radiance, consistent with how the composite lights surfaces (albedo * E, with
    // E = power * cos * cos / d^2): a Lambert surface under radiance L over area A gets
    // albedo / pi * L * A * cos * cos / d^2, so L = pi * power / A
    panel.scale.set(half * LIGHT_ASPECT, half, 1);
    panelMat.emissiveIntensity = Math.PI * uLightPower.value / (4 * half * half * LIGHT_ASPECT);
    uLightRadiance.value = panelMat.emissiveIntensity;
  };
  setLightSize(lightHalf);

  // ---- the reflection probe ---------------------------------------------------------
  // One probe for the room: a cube capture at PROBE_POS, prefiltered with PMREM, looked up
  // box-projected onto PROBE_BOX (the floor, the two walls, and where the open sides would be).
  // A snapshot: the turning sculpture is frozen at the pose it had when the probe was baked.
  const PROBE_POS = new THREE.Vector3(-0.3, 1.1, -0.5);
  const PROBE_MIN = new THREE.Vector3(-3.0, -0.01, -2.1);
  const PROBE_MAX = new THREE.Vector3(3.3, 3.6, 2.6);
  const PROBE_SIZE = Number(q.get('probesize') ?? 256);
  const cubeRT = new THREE.CubeRenderTarget(PROBE_SIZE, { type: THREE.HalfFloatType });
  const cubeCam = new THREE.CubeCamera(0.05, 30, cubeRT);
  cubeCam.position.copy(PROBE_POS);
  const pmremGen = new THREE.PMREMGenerator(renderer);
  let pmremRT: THREE.RenderTarget | null = null;
  const probeInfo = { captureMs: 0, pmremMs: 0, bakes: 0 };
  async function bakeProbe() {
    const idleGPU = () => device.queue.onSubmittedWorkDone();
    // The panel's direct light is added in screen space by the composite, which a cube capture
    // doesn't run, so the capture gets a stand-in: a spot light at the panel with a cosine-ish
    // falloff and a shadow map. Three's Lambert divides by pi, hence the pi.
    const fill = new THREE.SpotLight(0xffffff, uLightPower.value * Math.PI, 0, Math.PI / 2 * 0.98, 1, 2);
    fill.position.copy(LIGHT_C);
    fill.target.position.copy(LIGHT_C.clone().add(LIGHT_N));
    fill.castShadow = true;
    fill.shadow.mapSize.set(1024, 1024);
    fill.shadow.bias = -0.0005;
    scene.add(fill, fill.target);
    const bg = scene.background;
    scene.background = env; // open sides see the environment, as traced rays do
    scene.backgroundIntensity = scene.environmentIntensity;
    const envSpec = uEnvSpecular.value;
    uEnvSpecular.value = 1; // materials' own env specular, so glossy things in the probe shine
    await idleGPU();
    const t0 = performance.now();
    cubeCam.update(renderer, scene);
    await idleGPU();
    const t1 = performance.now();
    pmremRT = pmremGen.fromCubemap(cubeRT.texture, pmremRT);
    await idleGPU();
    const t2 = performance.now();
    scene.remove(fill, fill.target);
    fill.dispose();
    scene.background = bg;
    uEnvSpecular.value = envSpec;
    probeInfo.captureMs = t1 - t0;
    probeInfo.pmremMs = t2 - t1;
    probeInfo.bakes++;
  }
  // the first bakes compile pipelines (the stand-in light changes every material's shader), so
  // bake three times and report the last, warm one
  for (let i = 0; i < 3; i++) await bakeProbe();
  const probeTex = pmremRT!.texture;
  /** Box projection: where the ray from P along d leaves the probe box, seen from the probe. */
  const boxProject = (P: N, d: N) => {
    const dn = d.normalize();
    const tf = vec3(PROBE_MAX).sub(P).div(dn).max(vec3(PROBE_MIN).sub(P).div(dn));
    return P.add(dn.mul(tf.x.min(tf.y).min(tf.z))).sub(vec3(PROBE_POS));
  };
  const probeLookup = (P: N, d: N, rough: N) => pmremTexture(probeTex, boxProject(P, d), rough);

  // three's shadow-map visibility for the spot, evaluated per fragment in the scene pass
  const smNode = shadow(spot, spot.shadow) as N;
  const smapVis = vec3(smNode).x;
  const camWorld = uniform(new THREE.Matrix4());
  camWorld.onFrameUpdate(() => { camera.updateMatrixWorld(); camWorld.value.copy(camera.matrixWorld); });
  const projInv = uniform(camera.projectionMatrixInverse);
  // irradiance from the panel (centre approximation; visibility handles the area)
  const irradiance = (P: N, N_: N) => {
    const L = uLightC.sub(P);
    const d2 = L.dot(L).max(1e-3);
    const l = L.normalize();
    return uLightPower.mul(N_.dot(l).max(0)).mul(uLightN.dot(l.negate()).max(0)).div(d2);
  };

  // Everything below is built per output resolution: native, or half resolution
  // upscaled 2x by FSR3 (@pmndrs/upscaler), as a shipping app would.
  function buildGraph(upscaled: boolean) {
    const scale = upscaled ? 1 / RATIO : 1;
    // ---- scene pass + G-buffer -----------------------------------------------------
    const scenePass = pass(scene, camera);
    scenePass.setResolutionScale(scale);
    scenePass.setMRT(mrt({
      output,
      diffuseColor: vec4(diffuseColor.rgb, materialMetalness),      // albedo + metalness
      normal: vec4(packNormalToRGB(normalView), materialRoughness), // packed VIEW normal + roughness
      // motion vectors in .xy; three's shadow-map visibility rides along in .z (WebGPU's
      // default limit is 32 bytes/sample across color attachments = 4 targets here)
      velocity: vec4(velocity as N, smapVis, 1),
    }));
    const sceneColor = scenePass.getTextureNode('output');
    const dTex = scenePass.getTextureNode('diffuseColor');
    const nTex = scenePass.getTextureNode('normal');
    const depthTex = scenePass.getTextureNode('depth');
    const velTex = scenePass.getTextureNode('velocity');
    const rtt = (node: N) => { const n = convertToTexture(node); n.setResolutionScale(scale); return n; };

    // world position + normal of the visible surface at a screen uv
    const surface = (uvN: N) => {
      const d = depthTex.sample(uvN).r;
      const Pv = getViewPosition(uvN, d, projInv);
      const P = camWorld.mul(vec4(Pv, 1)).xyz;
      const Nw = camWorld.mul(vec4(unpackRGBToNormal(nTex.sample(uvN).rgb), 0)).xyz.normalize();
      return { d, P, N: Nw, sky: d.greaterThanEqual(0.99999).select(float(1), float(0)), viewDist: Pv.length() };
    };
    // `temporal`: a new random light point every frame (what a denoiser wants) or the
    // same stratified points every frame (a static, noise-free estimate)
    const traceVisibility = (grid: number, temporal = true) => {
      const s = surface(uv());
      const px = screenCoordinate.xy.floor();
      let seed: N = uint(px.x).add(uint(px.y).mul(4099)).mul(uint(1973));
      if (temporal) seed = seed.add(uFrame.mul(9277));
      const eps = s.viewDist.mul(0.002).add(0.004);
      return areaVisibility(s.P, s.N, s.sky, uLightC, uLightU, uLightV, uLightN, eps, seed, uint(grid));
    };

    // 1 ray/pixel, new random light point every frame: the signal FFX denoises
    const visRTT = rtt(vec4(traceVisibility(1), 0, 0, 1));
    // reference: 16 stratified rays/pixel/frame, accumulated over up to 128 frames
    const refAccum = new AccumulateNode(vec4(traceVisibility(4), 0, 0, 1), scale);
    // diagnostics only: 64 fixed rays/pixel every frame (a perfect, noise-free shadow)
    const cleanRTT = rtt(vec4(traceVisibility(8, false), 0, 0, 1));

    const guides = { camera, depth: depthTex, velocity: velTex, normal: nTex, normalSpace: 'view' as const, normalEncoding: 'packed' as const, resolutionScale: scale };
    const shadowFFX = ffxShadows(visRTT, guides);

    const visibilityOf = (m: ShadowMode): N => {
      switch (m) {
        case 'map': return velTex.sample(uv()).z;
        case 'noisy': return visRTT.sample(uv()).r;
        case 'ffx': return shadowFFX.r;
        case 'ref': return (refAccum as N).r;
        case 'clean': return cleanRTT.sample(uv()).r;
        case 'off': return float(1);
      }
    };
    // lit (linear HDR) = env-lit raster colour + direct light from the panel * visibility
    const litOf = (m: ShadowMode): N => {
      const s = surface(uv());
      const albedo = dTex.sample(uv());
      const diffuse = albedo.rgb.mul(float(1).sub(albedo.a));
      const direct = diffuse.mul(irradiance(s.P, s.N)).mul(visibilityOf(m)).mul(float(1).sub(s.sky));
      return sceneColor.sample(uv()).rgb.add(direct);
    };
    const litRTTs = new Map<ShadowMode, N>();
    const litRTT = (m: ShadowMode) => {
      let n = litRTTs.get(m);
      if (!n) { n = rtt(vec4(litOf(m), 1)); litRTTs.set(m, n); }
      return n;
    };

    // ---- reflections ------------------------------------------------------------------
    // three's stochastic SSR of the LIT image (so shadows show up in reflections). No env map:
    // a miss returns alpha 0, and each mode decides what fills it.
    const ssrNode = ssr(litRTT('ffx'), depthTex, sample((uvN: N) => unpackRGBToNormal(nTex.sample(uvN).rgb)), {
      stochastic: true, camera,
      diffuseNode: dTex, metalnessNode: dTex.a, roughnessNode: nTex.a,
    } as N) as N;
    ssrNode.maxDistance.value = 4;
    ssrNode.thickness.value = 0.05;

    // SSR marks a miss with alpha = ENV_RAY_LENGTH (1e4), even without an env map
    const ssrHit = () => ssrNode.a.greaterThan(0).and(ssrNode.a.lessThan(1e3));
    // Firefly clamp on a sample's luminance, as SSR does (its maxLuminance, 10), tightened on rough
    // surfaces: a fully rough rug that once in a while samples the bright panel otherwise leaves
    // speckles a 1-sample-per-pixel denoiser can't average away. Biased, like every engine's clamp.
    const clampSample = (v: N, rough: N) => {
      const maxLum = mix(float(10), float(1), rough.smoothstep(0.3, 1));
      const lum = v.rgb.dot(vec3(0.2126, 0.7152, 0.0722)).max(1e-4);
      return vec4(v.rgb.mul(maxLum.div(lum).min(1)), v.a);
    };

    // one GGX sample of the pixel's specular lobe, in world space, with the sampler and
    // weights three's SSR uses: SSR hits, traced hits and probe lookups all carry the same energy
    const camPos = camWorld.mul(vec4(0, 0, 0, 1)).xyz;
    const lobeSample = (k: number) => {
      const s = surface(uv());
      const alb = dTex.sample(uv());
      const rough = nTex.sample(uv()).a;
      const V = camPos.sub(s.P).normalize();
      const px = screenCoordinate.xy.floor();
      const seed: N = uint(px.x).add(uint(px.y).mul(4099)).mul(uint(1973)).add(uFrame.mul(9277)).add(uint(k * 104729));
      const Xi = vec4(hash(seed), hash(seed.add(1)), hash(seed.add(2)), hash(seed.add(3)));
      const g = (SpecularHelpers as N).ggxReflectionSample(s.N, V, rough, alb.a, alb.rgb, Xi).toVar();
      return { s, rough, dir: g.get('reflectDir'), weight: g.get('sampleWeight'), seed };
    };
    // a traced reflection ray; the probe (in the sampled direction) where it leaves the scene
    const traced = (r: ReturnType<typeof lobeSample>) => {
      const eps = r.s.viewDist.mul(0.002).add(0.004);
      const t = traceReflection(r.s.P, r.s.N, r.dir, eps, r.seed, uLightC, uLightU, uLightV, uLightN,
        uLightPower, uLightRadiance, float(scene.environmentIntensity)).toVar();
      const miss = t.w.lessThan(0);
      return clampSample(vec4(miss.select(probeLookup(r.s.P, r.dir, float(0)), t.rgb).mul(r.weight), miss.select(float(100), t.w)), r.rough);
    };
    // the prefiltered probe for the whole lobe (split-sum): what engines do with no rays at all
    const probeSpec = () => {
      const s = surface(uv());
      const alb = dTex.sample(uv());
      const rough = nTex.sample(uv()).a;
      const V = camPos.sub(s.P).normalize();
      const R = V.negate().reflect(s.N);
      const spec = (EnvironmentBRDF as N)({
        dotNV: s.N.dot(V).max(1e-4), specularColor: mix(vec3(0.04), alb.rgb, alb.a), specularF90: float(1), roughness: rough,
      });
      return probeLookup(s.P, R, rough).rgb.mul(spec).mul(float(1).sub(s.sky));
    };
    const roughOf = () => nTex.sample(uv()).a;

    // per-mode 1-sample estimators (vec4: radiance, hit distance), 0 where there is no reflection
    const estimator = {
      ssr: Fn(() => {
        const r = lobeSample(0);
        const o = vec4(0).toVar();
        If(r.s.sky.lessThan(0.5), () => {
          If(ssrHit(), () => { o.assign(ssrNode); })
            .Else(() => { o.assign(clampSample(vec4(probeLookup(r.s.P, r.dir, float(0)).rgb.mul(r.weight), 100), r.rough)); });
        });
        return o;
      })(),
      hybrid: Fn(() => {
        const r = lobeSample(0);
        const o = vec4(0).toVar();
        // rough pixels take the prefiltered probe in the composite, so neither SSR nor a ray runs for them
        If(r.s.sky.lessThan(0.5).and(r.rough.lessThanEqual(uRoughCut)), () => {
          If(ssrHit(), () => { o.assign(ssrNode); })
            .Else(() => { o.assign(traced(r)); });
        });
        return o;
      })(),
      rt: Fn(() => {
        const r = lobeSample(0);
        const o = vec4(0).toVar();
        If(r.s.sky.lessThan(0.5), () => { o.assign(traced(r)); });
        return o;
      })(),
    };
    // the denoiser's input: one texture whose node is swapped per mode (FFX keeps one history)
    const reflIn = rtt(vec4(0));
    const reflFFX = ffxReflections(reflIn, { ...guides, roughness: nTex.a });
    // reference: the rt estimator, 4 rays/pixel/frame, accumulated over up to 128 frames
    const reflRef = new AccumulateNode(Fn(() => {
      const o = vec4(0).toVar();
      If(surface(uv()).sky.lessThan(0.5), () => {
        for (let k = 0; k < 4; k++) o.addAssign(traced(lobeSample(k + 1)).mul(0.25));
      });
      return o;
    })(), scale);

    // FSR3 input: the frame at render resolution (linear). Its RTT's `.node` is swapped
    // per mode, so the upscaler keeps its history across mode changes.
    let colorRTT: N = null, up: N = null;
    if (upscaled) {
      colorRTT = rtt(vec4(0, 0, 0, 1));
      up = upscale(colorRTT, depthTex, velTex, camera, { ratio: RATIO, jitter: !q.has('nojitter') });
    }
    const dispose = () => {
      shadowFFX.dispose(); reflFFX.dispose(); refAccum.dispose(); reflRef.dispose(); up?.dispose?.();
    };
    return { upscaled, scale, scenePass, depthTex, velTex, visRTT, refAccum, cleanRTT, shadowFFX, litOf, litRTT, litRTTs, ssrNode, reflFFX, reflIn, reflRef, estimator, probeSpec, uRoughCut, roughOf, colorRTT, up, dispose };
  }
  let g = buildGraph(q.has('upscale'));

  // ---- graph per mode ----------------------------------------------------------------
  const pipeline = new THREE.RenderPipeline(renderer);
  pipeline.outputColorTransform = false; // the graph tone maps + sRGB-encodes itself
  const modes = { shadow: 'ffx' as ShadowMode, refl: 'hybrid' as ReflMode, denoise: true };
  const buildOutput = () => {
    const { shadow: sm, refl: rm } = modes;
    uEnvSpecular.value = 0; // every mode below supplies the specular itself
    let lit: N;
    if (rm === 'off') lit = g.litOf(sm);
    else if (rm === 'probe') lit = g.litOf(sm).add(g.probeSpec());
    else if (rm === 'ref') lit = g.litOf(sm).add((g.reflRef as N).rgb);
    else {
      const l = g.litRTT(sm);
      g.ssrNode.colorNode = l;
      g.reflIn.node = g.estimator[rm];
      lit = l.rgb.add(modes.denoise ? g.reflFFX.rgb : g.reflIn.rgb);
      if (rm === 'hybrid') lit = lit.add(g.roughOf().greaterThan(g.uRoughCut).select(g.probeSpec(), vec3(0)));
    }
    if (g.upscaled) {
      // FSR3 stays linear HDR in and out; tone mapping + sRGB happen after it
      g.colorRTT.node = vec4(lit, 1);
      pipeline.outputNode = renderOutput(g.up, THREE.ACESFilmicToneMapping, THREE.SRGBColorSpace) as N;
    } else {
      pipeline.outputNode = renderOutput(vec4(lit, 1), THREE.ACESFilmicToneMapping, THREE.SRGBColorSpace) as N;
    }
    pipeline.needsUpdate = true;
    labelTargets();
  };
  const setUpscale = (on: boolean) => {
    if (g.upscaled === on) return;
    const old = g;
    g = buildGraph(on);
    // the upscaler owns the global velocity projection while it jitters
    if (!on) velocity.setProjectionMatrix(null);
    buildOutput();
    old.dispose();
    resetCosts();
  };

  // ---- per-pass GPU timing ----------------------------------------------------------
  // A tiny inspector labels every render pass three runs (by render target), and
  // three's timestamp queries give each pass's start/end on the GPU. The total is
  // the frame's GPU span (first pass start to last pass end), which includes FFX's
  // compute passes; those are timed by the denoiser itself (gpuTimings).
  type Cat = 'raster' | 'shadow map' | 'ray trace' | 'reflection rays' | 'denoise' | 'SSR' | 'composite';
  const CATS: Cat[] = ['raster', 'shadow map', 'ray trace', 'reflection rays', 'denoise', 'SSR', 'composite'];
  const rtCat = new Map<unknown, Cat>();
  const rtsOf = (n: N): unknown[] => (n?.renderTarget ? [n.renderTarget] : []);
  function labelTargets() {
    // FFX input prep (normal conversion etc.) first: the shadow node's input IS visRTT,
    // which counts as ray tracing. The reflection denoiser's prep passes run
    // concurrently with SSR on the GPU, so they are counted with SSR.
    const prep = (node: N, c: Cat) => { for (const grp of [node.inputNodes, node.guideNodes]) for (const v of Object.values(grp ?? {})) for (const rt of rtsOf(v)) rtCat.set(rt, c); };
    prep(g.shadowFFX, 'denoise');
    prep(g.reflFFX, 'denoise'); // here the reflection input isn't always SSR, so its prep is denoiser cost
    rtCat.set(g.scenePass.renderTarget, 'raster');
    for (const rt of [...rtsOf(g.visRTT), ...rtsOf(g.cleanRTT), ...g.refAccum.renderTargets]) rtCat.set(rt, 'ray trace');
    for (const n of [...g.litRTTs.values(), g.colorRTT]) for (const rt of rtsOf(n)) rtCat.set(rt, 'composite');
    // the reflection estimator pass traces rays in the rt / hybrid modes; in ssr mode it only
    // merges SSR with probe lookups
    for (const rt of rtsOf(g.reflIn)) rtCat.set(rt, modes.refl === 'rt' || modes.refl === 'hybrid' ? 'reflection rays' : 'composite');
    for (const rt of g.reflRef.renderTargets) rtCat.set(rt, 'reflection rays');
  }
  const uidCat = new Map<string, Cat>();
  class PassLabeler extends THREE.InspectorBase {
    beginRender(uid: string, sc: N, _cam: N, rt: N) {
      let c: Cat | undefined = rt ? rtCat.get(rt) : 'composite';
      if (!c) {
        if (typeof sc?.name === 'string' && sc.name.startsWith('Shadow Map')) c = 'shadow map';
        else if (rt && (rt === smNode.vsmShadowMapVertical || rt === smNode.vsmShadowMapHorizontal || rt === smNode.shadowMap)) c = 'shadow map';
        else if (rt && Object.values(g.ssrNode).includes(rt)) c = 'SSR';
        else c = 'composite';
      }
      uidCat.set(uid, c);
    }
  }
  renderer.inspector = new PassLabeler() as N;
  // three keeps only each pass's duration; copy the raw begin/end ticks as it reads them
  let pool: N = null; // created by three on the first timed render pass
  let rawTicks: BigUint64Array | null = null;
  const hookPool = () => {
    if (pool) return true;
    pool = (renderer.backend as N).timestampQueryPool?.render;
    if (!pool?.resultBuffer) { pool = null; return false; }
    const rb = pool.resultBuffer as GPUBuffer;
    const get = rb.getMappedRange.bind(rb);
    rb.getMappedRange = ((...a: Parameters<GPUBuffer['getMappedRange']>) => { const r = get(...a); rawTicks = new BigUint64Array(r.slice(0)); return r; }) as GPUBuffer['getMappedRange'];
    return true;
  };
  interface FrameCost { span: number; cats: Record<Cat, number>; ffxShadows: number; ffxRefl: number; idle: number }
  const history: FrameCost[] = [];
  let lastPasses: unknown[] = [];
  let cpuFrameMs = 0, cpuWorkMs = 0, lastT = performance.now();
  async function sampleCosts() {
    if (!hasTimestamps || !hookPool() || pool.pendingResolve || pool.currentQueryIndex === 0) return;
    const offsets = new Map<string, number>(pool.queryOffsets);
    rawTicks = null;
    await renderer.resolveTimestampsAsync(THREE.TimestampQuery.RENDER);
    const ticks = rawTicks as BigUint64Array | null;
    if (!ticks) return;
    const frames = new Map<string, { uid: string; a: bigint; b: bigint }[]>();
    for (const [uid, off] of offsets) {
      if (off + 1 >= ticks.length) continue;
      const f = uid.slice(uid.lastIndexOf(':f') + 2);
      if (!frames.has(f)) frames.set(f, []);
      frames.get(f)!.push({ uid, a: ticks[off], b: ticks[off + 1] });
    }
    const ffxMs = (node: N) => node.denoiser?.gpuTimings?.get('total') ?? 0;
    const ffxS = modes.shadow === 'ffx' ? ffxMs(g.shadowFFX) : 0, ffxR = reflDenoised() ? ffxMs(g.reflFFX) : 0;
    for (const passes of frames.values()) {
      // Apple GPUs (and other tilers) start a pass's vertex work early, so begin
      // timestamps overlap the previous pass. End timestamps are in order: charge
      // each pass the time from the previous pass's end to its own end.
      const t0 = passes.reduce((m, p) => (p.a < m ? p.a : m), passes[0].a);
      const ms = (v: bigint) => Number(v - t0) / 1e6;
      passes.sort((x, y) => (x.b < y.b ? -1 : x.b > y.b ? 1 : 0));
      const cats = Object.fromEntries(CATS.map((c) => [c, 0])) as Record<Cat, number>;
      let prevEnd = 0;
      for (const p of passes) {
        const a = ms(p.a), b = ms(p.b);
        cats[uidCat.get(p.uid) ?? 'composite'] += Math.max(0, b - Math.max(prevEnd, a));
        prevEnd = Math.max(prevEnd, b);
      }
      // FFX's compute passes aren't render passes: they run in the gaps between three's
      // passes. Whatever of the gaps FFX doesn't fill, the GPU sat idle (mostly waiting
      // for the CPU to encode and submit the next pass).
      const charged = CATS.reduce((s, c) => s + cats[c], 0);
      const idle = Math.max(0, prevEnd - charged - ffxS - ffxR);
      history.push({ span: prevEnd, cats, ffxShadows: ffxS, ffxRefl: ffxR, idle });
      lastPasses = passes.map((p) => [p.uid, uidCat.get(p.uid) ?? '?', +ms(p.a).toFixed(3), +ms(p.b).toFixed(3)]);
    }
    while (history.length > 60) history.shift();
  }
  // means, not medians: means add up, so the rows sum to the frame time
  const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0);
  const costs = () => {
    const out: Record<string, number> = {};
    for (const c of CATS) out[c] = mean(history.map((h) => h.cats[c]));
    out['ffx shadows (compute)'] = mean(history.map((h) => h.ffxShadows));
    out['ffx reflections (compute)'] = mean(history.map((h) => h.ffxRefl));
    out.denoise += out['ffx shadows (compute)'] + out['ffx reflections (compute)'];
    out.idle = mean(history.map((h) => h.idle));
    out.total = mean(history.map((h) => h.span));
    out.frames = history.length;
    return out;
  };
  const resetCosts = () => { history.length = 0; };
  /** The modes that take one stochastic sample per pixel (the rest have no noise to denoise). */
  const stochastic = () => modes.refl === 'ssr' || modes.refl === 'hybrid' || modes.refl === 'rt';
  const reflDenoised = () => stochastic() && modes.denoise;

  // ---- animation + stepping -------------------------------------------------------
  let t = 0, frame = 0, moving = !q.has('paused');
  let shot = 0; // 0 = wide orbit, 1 = close-up on the table/chair legs (camera cut)
  const FPS = 60;
  const SHOTS = [
    { target: new THREE.Vector3(-0.35, 0.5, -0.8), r: 4.1, h: 1.65, a0: 0.2, amp: 0.3 },
    { target: new THREE.Vector3(-0.55, 0.2, -0.5), r: 2.0, h: 0.75, a0: 0.55, amp: 0.18 },
  ];
  function pose(time: number) {
    const s = SHOTS[shot];
    const a = s.a0 + s.amp * Math.sin(time * 0.21);      // ~0.06 rad/s at most: slow
    const r = s.r + 0.25 * Math.sin(time * 0.13);
    camera.position.set(s.target.x + r * Math.sin(a), s.h + 0.15 * Math.sin(time * 0.17), s.target.z + r * Math.cos(a));
    camera.lookAt(s.target);
    camera.updateMatrixWorld();
  }
  const prevView = new THREE.Matrix4();
  let prevLight = -1;
  function animate() {
    if (moving && modes.shadow !== 'ref' && modes.refl !== 'ref') t += 1 / FPS;
    pose(t);
    knot.rotation.set(0.4, t * 0.35, 0);
    knot.updateMatrixWorld();
    (bvh as N).updateTransforms(); // refit the TLAS for the turning sculpture (cheap: few objects)
    // the reference restarts whenever anything it depends on changes
    if (!prevView.equals(camera.matrixWorld) || prevLight !== lightHalf) { g.refAccum.count.value = 0; g.reflRef.count.value = 0; }
    prevView.copy(camera.matrixWorld);
    prevLight = lightHalf;
    uFrame.value = frame;
  }
  function renderOne() {
    const t0 = performance.now();
    animate();
    pipeline.render();
    frame++;
    const now = performance.now();
    cpuWorkMs += (now - t0 - cpuWorkMs) * 0.1; // JS + command encoding, not GPU
    cpuFrameMs += (now - lastT - cpuFrameMs) * 0.1;
    lastT = now;
    void sampleCosts();
  }

  // three advances `FRAME`-type node updates (SSR noise, the denoiser nodes) only in
  // its animation loop, so even the headless stepping goes through setAnimationLoop.
  let job: { left: number; each?: () => void; done: () => void } | null = null;
  const frames = (n: number, each?: () => void) => new Promise<void>((res) => { job = { left: n, each, done: res }; });
  renderer.setAnimationLoop(() => {
    if (!manual) { renderOne(); return; }
    if (!job) return;
    renderOne();
    job.each?.();
    if (--job.left === 0) { const d = job.done; job = null; d(); }
  });

  // ---- UI -------------------------------------------------------------------------
  const capShadow = document.querySelector<HTMLSpanElement>('#cap-shadow')!;
  const capRefl = document.querySelector<HTMLSpanElement>('#cap-refl')!;
  const costEl = document.querySelector<HTMLTableSectionElement>('#cost-body')!;
  const costNote = document.querySelector<HTMLElement>('#cost-note')!;
  const press = (id: string, v: string) => document.querySelectorAll<HTMLButtonElement>(`${id} button`).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === v)));
  const updateCaptions = () => {
    capShadow.textContent = 'Shadows: ' + SHADOW_LABEL[modes.shadow] + (modes.shadow === 'ref' ? ` - ${Math.min(g.refAccum.count.value, g.refAccum.max) * 16} rays/pixel so far (camera held still)` : '');
    capRefl.textContent = 'Reflections: ' + REFL_LABEL[modes.refl]
      + (modes.refl === 'hybrid' ? ` (cutoff ${g.uRoughCut.value.toFixed(2)})` : '')
      + (stochastic() ? (modes.denoise ? ' + ffxReflections()' : ', raw (no denoiser)') : '')
      + (modes.refl === 'ref' ? ` - ${Math.min(g.reflRef.count.value, g.reflRef.max) * 4} rays/pixel so far (camera held still)` : '');
  };
  const setShadow = (m: ShadowMode) => {
    if (m === modes.shadow) return;
    modes.shadow = m;
    if (m === 'ffx') g.shadowFFX.resetHistory();
    if (m === 'ref') g.refAccum.count.value = 0;
    spot.shadow.autoUpdate = m === 'map'; // only re-render the shadow map when it is shown
    spot.shadow.needsUpdate = true;
    press('#seg-shadow', m);
    buildOutput(); resetCosts(); updateCaptions();
  };
  const setRefl = (m: ReflMode) => {
    if (m === modes.refl) return;
    modes.refl = m;
    g.reflFFX.resetHistory(); // the input changes meaning between modes
    if (m === 'ref') g.reflRef.count.value = 0;
    press('#seg-refl', m);
    buildOutput(); resetCosts(); updateCaptions();
  };
  const setDenoise = (on: boolean) => {
    modes.denoise = on;
    if (on) g.reflFFX.resetHistory();
    press('#seg-denoise', on ? 'on' : 'off');
    buildOutput(); resetCosts(); updateCaptions();
  };
  document.querySelectorAll<HTMLButtonElement>('#seg-denoise button').forEach((b) => b.addEventListener('click', () => setDenoise(b.dataset.v === 'on')));
  const cutIn = document.querySelector<HTMLInputElement>('#cutoff')!;
  const cutOut = document.querySelector<HTMLOutputElement>('#cutoff-v')!;
  const onCut = () => { g.uRoughCut.value = parseFloat(cutIn.value); cutOut.textContent = g.uRoughCut.value.toFixed(2); };
  cutIn.addEventListener('input', onCut);
  const rebakeBtn = document.querySelector<HTMLButtonElement>('#rebake')!;
  rebakeBtn.addEventListener('click', async () => { rebakeBtn.disabled = true; await bakeProbe(); rebakeBtn.disabled = false; });
  const setMoving = (on: boolean) => { moving = on; press('#seg-motion', on ? 'on' : 'off'); };
  const setRoughness = (r: number) => { floorMat.roughness = r; topMat.roughness = r; };
  const cut = () => {
    shot = 1 - shot;
    g.shadowFFX.resetHistory();
    g.reflFFX.resetHistory();
  };
  document.querySelectorAll<HTMLButtonElement>('#seg-shadow button').forEach((b) => b.addEventListener('click', () => setShadow(b.dataset.v as ShadowMode)));
  document.querySelectorAll<HTMLButtonElement>('#seg-refl button').forEach((b) => b.addEventListener('click', () => setRefl(b.dataset.v as ReflMode)));
  document.querySelectorAll<HTMLButtonElement>('#seg-motion button').forEach((b) => b.addEventListener('click', () => setMoving(b.dataset.v === 'on')));
  document.querySelector('#cut')!.addEventListener('click', cut);
  document.querySelectorAll<HTMLButtonElement>('#seg-up button').forEach((b) => b.addEventListener('click', () => { setUpscale(b.dataset.v === 'on'); press('#seg-up', b.dataset.v!); }));
  press('#seg-up', g.upscaled ? 'on' : 'off');
  const lightIn = document.querySelector<HTMLInputElement>('#light-size')!;
  const lightOut = document.querySelector<HTMLOutputElement>('#light-size-v')!;
  const roughIn = document.querySelector<HTMLInputElement>('#roughness')!;
  const roughOut = document.querySelector<HTMLOutputElement>('#roughness-v')!;
  let rebakeTimer = 0;
  const onLight = () => {
    const h = parseFloat(lightIn.value);
    setLightSize(h);
    lightOut.textContent = `${(h * 2 * LIGHT_ASPECT).toFixed(2)} x ${(h * 2).toFixed(2)} m`;
    // the probe saw the old panel: re-bake once the slider settles
    clearTimeout(rebakeTimer);
    rebakeTimer = window.setTimeout(() => { if (probeInfo.bakes) void bakeProbe(); }, 300);
  };
  const onRough = () => { const r = parseFloat(roughIn.value); setRoughness(r); roughOut.textContent = r.toFixed(2); };
  lightIn.addEventListener('input', onLight); onLight();
  roughIn.addEventListener('input', onRough); onRough();
  onCut();
  setMoving(moving);
  spot.shadow.autoUpdate = modes.shadow === 'map'; // the starting mode never goes through setShadow

  setInterval(() => {
    updateCaptions();
    if (!hasTimestamps) {
      costNote.textContent = `${q.has('notiming') ? 'GPU timing is off (?notiming)' : 'GPU timestamp queries are not available in this browser'}, so there is no per-pass split. Frame rate: ${(1000 / cpuFrameMs).toFixed(0)} fps (${cpuFrameMs.toFixed(1)} ms between frames), CPU ${cpuWorkMs.toFixed(2)} ms per frame.`;
      return;
    }
    const c = costs();
    const rays = modes.shadow === 'noisy' || modes.shadow === 'ffx';
    const rows: [string, number, string][] = [
      ['raster: G-buffer + env lighting', c.raster, ''],
      ['shadow map: render + VSM blur', c['shadow map'], modes.shadow === 'map' ? '' : 'off'],
      ['shadow rays: BVH vs scene triangles', c['ray trace'], rays ? '1 ray/pixel' : modes.shadow === 'ref' ? (g.refAccum.count.value >= g.refAccum.max ? 'converged, idle' : '16 rays/pixel') : 'off'],
      ['reflection rays: BVH vs scene triangles', c['reflection rays'], modes.refl === 'rt' ? '1 ray/pixel, + 1 shadow ray per hit' : modes.refl === 'hybrid' ? 'only where SSR missed, below the roughness cutoff' : modes.refl === 'ref' ? (g.reflRef.count.value >= g.reflRef.max ? 'converged, idle' : '4 rays/pixel') : 'off'],
      ['reflection rays: SSR (screen space)', c.SSR, modes.refl === 'ssr' ? '1 ray/pixel, incl. denoiser input prep' : modes.refl === 'hybrid' ? 'below the roughness cutoff' : 'off'],
      ['FFX denoisers (compute)', c.denoise, [modes.shadow === 'ffx' ? `shadows ${c['ffx shadows (compute)'].toFixed(2)}` : '', reflDenoised() ? `reflections ${c['ffx reflections (compute)'].toFixed(2)}` : ''].filter(Boolean).join(', ') || 'off'],
      ['composite + tone map', c.composite, g.upscaled ? 'FSR3 runs in compute: counted in idle' : ''],
      ['GPU idle between passes', c.idle, 'waiting on the CPU to submit the next pass'],
    ];
    costEl.innerHTML = rows.map(([k, v, note]) => `<tr><td>${k}</td><td class="num">${v.toFixed(2)}</td><td class="note">${note}</td></tr>`).join('')
      + `<tr class="total"><td>GPU frame time</td><td class="num">${c.total.toFixed(2)}</td><td class="note">ms, ${g.upscaled ? `rendered at ${W / RATIO}x${H / RATIO}, FSR3 to ${W}x${H}` : `at ${W}x${H}`}</td></tr>`
      + `<tr class="total"><td>CPU time per frame</td><td class="num">${cpuWorkMs.toFixed(2)}</td><td class="note">ms of JS + command encoding (three's node updates, ${lastPasses.length} render passes)</td></tr>`
      + `<tr><td>probe bake (once, not per frame)</td><td class="num">${(probeInfo.captureMs + probeInfo.pmremMs).toFixed(2)}</td><td class="note">capture (6 faces, ${PROBE_SIZE}px) ${probeInfo.captureMs.toFixed(2)} + PMREM ${probeInfo.pmremMs.toFixed(2)} ms, wall clock</td></tr>`
      + `<tr class="total"><td>frame rate</td><td class="num">${(1000 / cpuFrameMs).toFixed(0)}</td><td class="note">fps (${cpuFrameMs.toFixed(1)} ms between frames, capped by the display refresh)</td></tr>`;
  }, 400);

  buildOutput();
  updateCaptions();

  // ---- test hooks (used by run-headless.mjs) ------------------------------------
  const copyCanvas = document.createElement('canvas');
  copyCanvas.width = W; copyCanvas.height = H;
  const cctx = copyCanvas.getContext('2d', { willReadFrequently: true })!;
  const readFrame = (): ImageData => { cctx.drawImage(canvas, 0, 0); return cctx.getImageData(0, 0, W, H); };
  const luma = (d: ImageData) => {
    const out = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) out[i] = (0.2126 * d.data[i * 4] + 0.7152 * d.data[i * 4 + 1] + 0.0722 * d.data[i * 4 + 2]) / 255;
    return out;
  };
  const idle = () => device.queue.onSubmittedWorkDone();
  async function nonFinite(node: TemporalDenoiseNode<never>) {
    const tex = (node as unknown as { _output: THREE.Texture })._output;
    const gpu = getGPUTexture(renderer, tex);
    const bpr = Math.ceil(gpu.width * 8 / 256) * 256;
    const buf = device.createBuffer({ size: bpr * gpu.height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const enc = device.createCommandEncoder();
    enc.copyTextureToBuffer({ texture: gpu }, { buffer: buf, bytesPerRow: bpr }, { width: gpu.width, height: gpu.height });
    device.queue.submit([enc.finish()]);
    await buf.mapAsync(GPUMapMode.READ);
    const u16 = new Uint16Array(buf.getMappedRange());
    let bad = 0;
    for (let y = 0; y < gpu.height; y++) for (let x = 0; x < gpu.width * 4; x++) if (((u16[(y * bpr) / 2 + x] >> 10) & 31) === 31) bad++;
    buf.unmap(); buf.destroy();
    return { w: gpu.width, h: gpu.height, bad };
  }
  const loadImg = (src: string) => new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });

  const api = {
    ready: true,
    gpuErrors,
    info: { three: THREE.REVISION, triangles: tris, bvhBuildMs: bvhMs, timestamps: hasTimestamps },
    get frame() { return frame; },
    async step(n: number) { await frames(n); await idle(); },
    setModes(m: { shadow?: ShadowMode; refl?: ReflMode; denoise?: boolean; cutoff?: number; moving?: boolean; lightSize?: number; roughness?: number; shot?: number; t?: number; upscale?: boolean }) {
      if (m.upscale !== undefined) { setUpscale(m.upscale); press('#seg-up', m.upscale ? 'on' : 'off'); }
      if (m.shadow) setShadow(m.shadow);
      if (m.refl) setRefl(m.refl);
      if (m.denoise !== undefined) setDenoise(m.denoise);
      if (m.cutoff !== undefined) { cutIn.value = String(m.cutoff); onCut(); }
      if (m.moving !== undefined) setMoving(m.moving);
      if (m.lightSize !== undefined) { lightIn.value = String(m.lightSize); onLight(); }
      if (m.roughness !== undefined) { roughIn.value = String(m.roughness); onRough(); }
      if (m.shot !== undefined && m.shot !== shot) cut();
      if (m.t !== undefined) t = m.t;
    },
    cut,
    get refCount() { return g.refAccum.count.value; },
    get reflRefCount() { return g.reflRef.count.value; },
    probe: probeInfo,
    rebake: async () => { await bakeProbe(); },
    /** Debug: [uid, category, start ms, end ms] of the render passes of the last timed frame. */
    passes() { return lastPasses; },
    /** Render one frame and return the canvas as a PNG data URL. */
    async capture(): Promise<string> {
      await frames(1, readFrame);
      const url = copyCanvas.toDataURL('image/png');
      await idle();
      return url;
    },
    /** Labelled side-by-side montage of the same crop (x, y, w, h) of several captures, scaled up. */
    async montage(items: { url: string; label: string }[], crop: [number, number, number, number], scale = 2) {
      const [x, y, w, h] = crop;
      const pad = 26;
      const c = document.createElement('canvas');
      c.width = items.length * w * scale + (items.length - 1) * 6; c.height = h * scale + pad;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#0b0e14'; ctx.fillRect(0, 0, c.width, c.height);
      ctx.imageSmoothingEnabled = scale < 1; // nearest when zooming in, so noise stays visible
      for (let i = 0; i < items.length; i++) {
        const img = await loadImg(items[i].url);
        const ox = i * (w * scale + 6);
        ctx.drawImage(img, x, y, w, h, ox, 0, w * scale, h * scale);
        ctx.fillStyle = '#e6edf3'; ctx.font = '15px system-ui, sans-serif';
        ctx.fillText(items[i].label, ox + 6, h * scale + 18);
      }
      return c.toDataURL('image/png');
    },
    /** Landing-page thumbnail: a region of capture A (left half) next to the same region of B (right half). */
    async thumb(a: string, b: string, labels: [string, string], crop: [number, number, number, number], w = 640, h = 400) {
      const [ia, ib] = await Promise.all([loadImg(a), loadImg(b)]);
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d')!;
      ctx.imageSmoothingQuality = 'high';
      const [x, y, cw, ch] = crop;
      ctx.drawImage(ia, x, y, cw / 2, ch, 0, 0, w / 2, h);
      ctx.drawImage(ib, x + cw / 2, y, cw / 2, ch, w / 2, 0, w / 2, h);
      ctx.fillStyle = '#ffffffcc'; ctx.fillRect(w / 2 - 1, 0, 2, h);
      ctx.font = '600 15px system-ui, sans-serif';
      labels.forEach((l, i) => {
        const tx = i ? w / 2 + 10 : 10, tw = ctx.measureText(l).width;
        ctx.fillStyle = '#0b0e14b0'; ctx.fillRect(tx - 6, h - 32, tw + 12, 24);
        ctx.fillStyle = '#e6edf3'; ctx.fillText(l, tx, h - 15);
      });
      return c.toDataURL('image/png');
    },
    /** GPU cost per category, averaged over n frames (fresh average). */
    async costs(n = 40) {
      await frames(10); // let pipelines compile / histories settle
      await idle();
      resetCosts();
      await frames(n);
      await idle();
      await sampleCosts();
      return {
        ...costs(),
        ffxShadowPasses: Object.fromEntries(g.shadowFFX.denoiser?.gpuTimings ?? []),
        ffxReflPasses: Object.fromEntries(g.reflFFX.denoiser?.gpuTimings ?? []),
      };
    },
    async finiteCheck() {
      return { shadows: await nonFinite(g.shadowFFX as never), reflections: await nonFinite(g.reflFFX as never) };
    },
  };
  (window as unknown as { __t: typeof api }).__t = api;

  log(`ready - three r${THREE.REVISION}, ${W}x${H}${manual ? ' (manual stepping)' : ''}; BVH: ${tris.toLocaleString()} triangles, built in ${bvhMs.toFixed(0)} ms` +
    (hasTimestamps ? '' : '\nno timestamp-query: per-pass GPU timings unavailable'));
}

main().catch((e) => { log(`ERROR: ${(e as Error).stack ?? e}`); console.error(e); (window as unknown as { __error?: string }).__error = String(e); });
