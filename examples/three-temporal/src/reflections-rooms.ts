// three-temporal/reflections-rooms: reflection probes for every room, SSR and rays for what they miss.
//
// The two rooms of Ben Houston's reflection probes example (three.js PR #35046, in the version that
// animates the rooms), with a polished floor and the mirror object low enough that its reflection
// lands near it. One probe per room plus a doorway probe give every surface the right room's
// reflection for almost nothing per frame. What the probes can't have: the mirror ball (moving
// objects are kept out of captures, as engines do), contact (box projection puts everything on the
// walls), and anything the probe never saw from its one point. SSR and one traced ray per pixel,
// denoised by ffxReflections(), add those back:
//
//   probe   the probes alone, prefiltered per roughness (split-sum). No rays, no noise.
//   ssr     probes + SSR: below the roughness cutoff, one GGX sample per pixel, answered by SSR;
//           where SSR misses, the probe in that direction --> ffxReflections()
//   hybrid  probes + SSR + rays: the same, but where SSR misses a ray is traced against the scene
//           BVH (three-mesh-bvh) and shaded at the hit, with the probes as the hit's ambient
//           --> ffxReflections()
//   ref     4 traced rays per pixel per frame for every pixel, accumulated while nothing moves
//
// The rooms animate as in the PR's example (its updateRoom: the two ceiling lights drift through
// the hues half a cycle apart, the knot turns), with its two toggles: "Animate room", and "Live
// capture", which re-bakes the probes every frame the room changed (a bake of all three is about
// 2 ms here), so the reflections follow; off, they keep showing the room as it was captured. The
// knot is part of the room and in the captures; only the mirror ball is kept out. Light colour is
// a uniform, so animating it re-keys nothing. The probe code is ./probes (our r186 stand-in for #35046), sampled at arbitrary points with
// sampleReflectionProbes(). The pipeline (G-buffer, SSR, 1-sample estimators, the denoiser, the split
// view, the GPU timing) follows reflections-hybrid.ts, the one-room explainer; the pieces both use are
// in ./reflections/common.ts, the rest is adapted here (see the comments pointing at the source).

import * as THREE from 'three/webgpu';
import {
  float, vec3, vec4, uniform, mix, pass, mrt, output, diffuseColor, normalView, materialMetalness,
  materialRoughness, packNormalToRGB, unpackRGBToNormal, velocity, sample, getViewPosition, convertToTexture,
  renderOutput, uv, Fn, If, EnvironmentBRDF,
} from 'three/tsl';
import { ssr } from 'three/addons/tsl/display/SSRNode.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { BVHComputeData, wgslTagFn, rayStruct, rayIntersectionResultStruct } from 'three-mesh-bvh/webgpu';
import { ffxReflections } from 'denoiser/three';
import { mountShell } from '../../_shared/shell';
import { ReflectionProbe, ReflectionProbes } from './probes/ReflectionProbes';
import { reflectionProbes, sampleReflectionProbes } from './probes/ReflectionProbesNode';
import { ReflectionProbesHelper } from './probes/ReflectionProbesHelper';
import { AccumulateNode, clampSample, ggxLobeSample, pixelSeed } from './reflections/common';

mountShell({ id: 'three-temporal-reflections-rooms' });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any; // TSL's node typings are too strict for hand-written shader maths
const W = 960, H = 540;
const q = new URLSearchParams(location.search);
const manual = q.has('manual'); // headless: the page is stepped by window.__t.step()
const PROBE_RES = Number(q.get('res') ?? 128);
const SHADOWS_ONCE = !q.has('shadowsperface'); // ?shadowsperface: three's default, shadow maps re-rendered per captured face

type ReflMode = 'probe' | 'ssr' | 'hybrid' | 'ref';
const LABEL: Record<ReflMode, string> = {
  probe: 'probes only (box-projected, prefiltered), no rays',
  ssr: 'probes + SSR (probe where SSR misses)',
  hybrid: 'probes + SSR + rays (ray where SSR misses)',
  ref: 'reference (4 traced rays/pixel/frame, accumulated)',
};
const SHORT: Record<ReflMode, string> = { probe: 'probes only', ssr: 'probes + SSR', hybrid: 'probes + SSR + rays', ref: 'reference' };

// ---- the tour ------------------------------------------------------------------------------
type Verdict = 'good' | 'bad' | 'part';
interface Scenario {
  id: string; short: string; title: string;
  pos: [number, number, number]; target: [number, number, number];
  left: ReflMode; right: ReflMode | 'none'; split?: number; probes?: 'live' | 'frozen'; ball?: boolean;
  /** ball phase to start at (its figure eight), so the ball is where the text says */
  ballT?: number; lightJump?: number;
  look: string; verdicts: [ReflMode, Verdict, string][]; why?: string;
}
const SCENARIOS: Scenario[] = [
  {
    id: 'rooms', short: 'One probe per room', title: 'One probe per room',
    pos: [0, 2.3, 8.5], target: [0, 2.05, 0], left: 'probe', right: 'none', ballT: 2.2,
    look: 'Both rooms, seen through their missing front wall. Each room has its own light, and their colours drift through the hues. "Live capture" re-bakes the probes every frame, so the reflections follow. Each room has its own probe, and a smaller one sits in the doorway. Look at the floor: each half reflects its own room.',
    verdicts: [
      ['probe', 'good', 'Right room, right colours, walls in the right place, at the cost of one texture lookup per pixel. The doorway probe blends the two where they meet.'],
    ],
    why: 'One cubemap for a whole level would show the warm room in the cool one. Engines place a probe per room (and per corridor, doorway, ...) and blend them where their boxes overlap. three.js gets this with PR #35046; this page runs our port of it on three r186.',
  },
  {
    id: 'ball', short: 'Something moves', title: 'The mirror ball',
    pos: [-3.0, 1.6, 3.85], target: [-4.6, 0.3, 0.8], left: 'probe', right: 'hybrid', split: 0.42, ballT: 4.1, ball: false,
    look: 'The mirror ball is held still here, with the divider through it. Press "moving" under "Mirror ball" to send it along its figure eight through both rooms. Look at the floor: under the ball, and at the stairs and the table legs.',
    verdicts: [
      ['probe', 'bad', 'No ball in the floor. Moving things are kept out of the probes: a probe sees them from one point at one moment, and a mirror ball would bake its own reflection, frozen, into every probe. The stairs and the legs are a soft blur, in the wrong place.'],
      ['hybrid', 'good', 'The ball is in the floor, and so are the stairs and the legs, each standing on its reflection. SSR finds what is on screen, a traced ray the rest. The ball itself reflects the room as it is.'],
      ['ssr', 'part', 'Right for what is on screen. Where the reflection would come from off screen, the probe fills in, without the ball.'],
    ],
    why: 'This is the job probes can\'t do and screen-space and traced rays can: anything that moves, every frame, with no re-bake.',
  },
  {
    id: 'table', short: 'What the probe never saw', title: 'Under the table: what the probe never saw',
    pos: [-1.3, 0.55, 2.3], target: [-4.2, 0.45, -0.2], left: 'probe', right: 'hybrid', split: 0.52, ballT: 1.0,
    look: 'A low view at the table in the warm room. The polished floor should mirror the legs and the underside of the table top. The left room\'s probe sits above the table, in the middle of the room.',
    verdicts: [
      ['probe', 'bad', 'The probe photographed the table from above, so the floor shows the top of the table, painted onto the far wall by box projection. The legs don\'t meet their reflections.'],
      ['hybrid', 'good', 'The legs stand on their reflections and the underside is there: SSR finds what is on screen, rays find the rest.'],
      ['ssr', 'good', 'Here nearly everything the floor reflects is on screen, so SSR alone gets it.'],
    ],
    why: 'Box projection is exact only for the walls of the box. Everything inside the room is drawn as if it were painted on the walls, so probe reflections of furniture float and miss their contact points.',
  },
  {
    id: 'stale', short: 'Stale probes', title: 'The lights changed, the probes didn\'t',
    pos: [-2.9, 2.2, 3.7], target: [-4.8, 0.4, -1.5], left: 'probe', right: 'hybrid', split: 0.5, probes: 'frozen', lightJump: 0.45, ballT: 2.2,
    look: 'The left room, with "Live capture" off: the probes keep the room as it was captured. The light just jumped to a new colour, and keeps drifting; the walls show it. Compare the floor on the two sides of the divider.',
    verdicts: [
      ['probe', 'bad', 'The floor still reflects the old colours: the probes show the rooms as they were at the last bake.'],
      ['hybrid', 'part', 'SSR and rays reflect the room as it is now. Rough surfaces above the cutoff still use the stale probes, and so does the soft fill light in the shadows on both sides: the materials take their ambient light from the probes.'],
    ],
    why: 'Turn "Live capture" back on and they catch up: it re-bakes all three probes every frame the room changes, about 2 ms here (see the table). Engines re-bake on demand, or a face or a probe per frame, and rely on SSR or rays for what changes faster than that.',
  },
  {
    id: 'doorway', short: 'The doorway', title: 'Across the doorway',
    pos: [6.6, 1.5, 1.9], target: [-4.0, 0.9, -0.4], left: 'probe', right: 'hybrid', split: 0.5, ballT: 0.25,
    look: 'From the back of the cool room, through the doorway into the warm one. The doorway probe takes over between the two room probes. Watch the floor around the doorway as the ball rolls through.',
    verdicts: [
      ['probe', 'part', 'No seam where one room\'s probe hands over to the other: the doorway probe blends them. But no ball, and the knot\'s pedestal floats over a blur.'],
      ['hybrid', 'good', 'The same blend for what SSR and rays don\'t cover, and the ball and the pedestal where they really are.'],
      ['ssr', 'part', 'The ball and the doorway frame while they are on screen; the probes elsewhere.'],
    ],
  },
  {
    id: 'explore', short: 'Explore', title: 'Explore',
    pos: [-6.2, 2.1, 3.1], target: [1.0, 1.0, -0.8], left: 'hybrid', right: 'none', ballT: 0,
    look: 'Drag to look around, scroll to move. Pick any two modes with "Left side" and "Right side" below, freeze the probes, stop the lights.',
    verdicts: [],
  },
];

const statusEl = document.querySelector<HTMLPreElement>('#status')!;
const log = (m: string) => { statusEl.textContent = m; console.log('[rooms]', m); };

// ---- the material env-specular switch (as in reflections-hybrid.ts) ------------------------
// The materials get the probes through scene.environmentNode (for their diffuse ambient). Their own
// env specular is switched off: the composite supplies every mode's specular itself.
const uEnvSpecular = uniform(0);
const _indirectSpecular = THREE.PhysicalLightingModel.prototype.indirectSpecular;
THREE.PhysicalLightingModel.prototype.indirectSpecular = function (this: N, builder: N) {
  builder.context.radiance = builder.context.radiance.mul(uEnvSpecular);
  _indirectSpecular.call(this, builder);
};

// ---- scene: Ben's two rooms (three.js #35046, webgpu_reflection_probes.html) -----------------
function buildScene() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x111111);
  const camera = new THREE.PerspectiveCamera(50, W / H, 0.05, 60);
  const room = new THREE.Group(); // everything rays can hit
  scene.add(room);
  const add = (mesh: THREE.Mesh, cast = true, receive = true) => { mesh.castShadow = cast; mesh.receiveShadow = receive; room.add(mesh); return mesh; };
  const std = (color: number, roughness = 1, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });

  // room shell: x = -8 to 8, z = -4 to 4, y = 0 to 5
  const wallMaterial = new THREE.MeshStandardMaterial({ color: 0xcccccc, side: THREE.BackSide });
  add(new THREE.Mesh(new THREE.BoxGeometry(16, 5, 8), wallMaterial), false).position.set(0, 2.5, 0);
  // new here: a polished stone floor just above the shell's, so reflections read
  const floorMat = std(0x5c5650, 0.12);
  const floor = add(new THREE.Mesh(new THREE.PlaneGeometry(16, 8), floorMat), false);
  floor.rotation.x = -Math.PI / 2; floor.position.y = 0.002;
  const redWall = add(new THREE.Mesh(new THREE.PlaneGeometry(8, 5), std(0xdd2200)), false, false);
  redWall.rotation.y = Math.PI / 2; redWall.position.set(-7.99, 2.5, 0);
  const blueWall = add(new THREE.Mesh(new THREE.PlaneGeometry(8, 5), std(0x0044ff)), false, false);
  blueWall.rotation.y = -Math.PI / 2; blueWall.position.set(7.99, 2.5, 0);

  // dividing wall at x = 0 with a doorway
  const dividerMat = std(0xcccccc);
  const gap = 1.25;
  add(new THREE.Mesh(new THREE.BoxGeometry(0.3, 5, 4 - gap), dividerMat)).position.set(0, 2.5, -(gap + (4 - gap) / 2));
  add(new THREE.Mesh(new THREE.BoxGeometry(0.3, 5, 4 - gap), dividerMat)).position.set(0, 2.5, gap + (4 - gap) / 2);
  add(new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.2, gap * 2), dividerMat)).position.set(0, 4.4, 0);

  // left room: columns, table with a golden sphere, stepped blocks by the red wall
  const whiteMat = std(0xeeeeee);
  const columnGeom = new THREE.CylinderGeometry(0.3, 0.3, 4, 16);
  for (const x of [-6, -2, 2, 6]) for (const z of [-2.5, 2.5]) add(new THREE.Mesh(columnGeom, whiteMat)).position.set(x, 2, z);
  const tableMat = std(0x886644);
  const tableTop = add(new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.12, 1.4), tableMat));
  tableTop.position.set(-4, 1.0, 0);
  const legGeom = new THREE.BoxGeometry(0.1, 1, 0.1);
  for (const x of [-5.05, -2.95]) for (const z of [-0.55, 0.55]) add(new THREE.Mesh(legGeom, tableMat), true, false).position.set(x, 0.5, z);
  add(new THREE.Mesh(new THREE.SphereGeometry(0.35, 32, 32), std(0xffd700, 0.4, 0.3))).position.set(-4, 1.41, 0);
  add(new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.5, 1), whiteMat)).position.set(-7, 0.25, 0);
  add(new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.0, 1), whiteMat)).position.set(-7, 0.5, 0);
  add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.5, 1), whiteMat)).position.set(-7, 0.75, 0);

  // right room: pedestal with a turning torus knot, tall cone
  add(new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.2, 0.8), whiteMat)).position.set(4, 0.6, 0);
  const knot = add(new THREE.Mesh(new THREE.TorusKnotGeometry(0.3, 0.1, 64, 16), std(0xff44aa, 0.5, 0.2)));
  knot.position.set(4, 1.65, 0);
  add(new THREE.Mesh(new THREE.ConeGeometry(0.4, 2.5, 5), whiteMat)).position.set(6.5, 1.25, -1.5);

  // warm point light in the left room, cool in the right; their colours drift (updateRoom)
  const lights = [[0xffaa44, -4], [0x88bbff, 4]].map(([color, x]) => {
    const light = new THREE.PointLight(color, 30);
    light.position.set(x, 4.5, 0);
    light.castShadow = true;
    light.shadow.mapSize.setScalar(256);
    light.shadow.radius = 12;
    light.shadow.bias = -0.002;
    scene.add(light);
    return light;
  });

  // the mirror object: Ben's sphere option (the PR's default is the Stanford bunny), on his figure
  // eight but lower (1.2 m instead of 2.5 m), so its reflection lands next to it on the floor
  const ball = add(new THREE.Mesh(new THREE.SphereGeometry(4.5 * 0.12, 48, 32), std(0xffffff, 0, 1)));

  // per-vertex material for traced hits, packed into the BVH: linear albedo, and
  // w = floor(metalness * 100) + roughness (roughness < 1)
  room.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.geometry = m.geometry.clone(); // some geometries are shared between meshes
    const mat = m.material as THREE.MeshStandardMaterial;
    const n = m.geometry.attributes.position.count;
    const a = new Float32Array(n * 4);
    const v = [mat.color.r, mat.color.g, mat.color.b, Math.floor(mat.metalness * 100) + Math.min(mat.roughness, 0.999)];
    for (let i = 0; i < n; i++) a.set(v, i * 4);
    m.geometry.setAttribute('mat', new THREE.BufferAttribute(a, 4));
  });
  return { scene, camera, room, floorMat, lights, knot, ball };
}

async function main() {
  const canvas = document.querySelector<HTMLCanvasElement>('#view')!;
  canvas.width = W; canvas.height = H;
  if (!navigator.gpu) { log('WebGPU is not available in this browser.'); return; }

  const renderer = new THREE.WebGPURenderer({ canvas, antialias: false, trackTimestamp: !q.has('notiming') } as N);
  await renderer.init();
  if (!(renderer.backend as N).isWebGPUBackend) { log('This page needs WebGPU (the probes and the ray tracing are WebGPU only).'); return; }
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  renderer.toneMapping = THREE.NoToneMapping; // the graph tone maps itself
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.shadowMap.enabled = true;
  const hasTimestamps = renderer.hasFeature('timestamp-query') && !q.has('notiming');
  const device = (renderer.backend as unknown as { device: GPUDevice }).device;
  const gpuErrors: string[] = [];
  device.addEventListener('uncapturederror', (e) => {
    const msg = (e as GPUUncapturedErrorEvent).error.message;
    gpuErrors.push(msg);
    console.error('[webgpu uncapturederror]', msg);
  });
  device.lost.then((i) => log(`DEVICE LOST: ${i.reason} ${i.message}`));
  // every GPU wait has a timeout, so a stuck device can't hang the page
  const idle = () => Promise.race([device.queue.onSubmittedWorkDone(), new Promise<void>((res) => setTimeout(res, 3000))]);

  const { scene, camera, room, floorMat, lights, knot, ball } = buildScene();
  scene.updateMatrixWorld(true);

  // ---- the probes: one per room plus a doorway probe (Ben's setup) --------------------------
  const probes = new ReflectionProbes();
  for (const s of [
    { position: [-4, 2.5, 0], influenceSize: [8.4, 5.4, 8.4], projectionSize: [8, 5, 8] },
    { position: [4, 2.5, 0], influenceSize: [8.4, 5.4, 8.4], projectionSize: [8, 5, 8] },
    { position: [0, 1.9, 0], influenceSize: [2.4, 3.8, 2.5], projectionSize: [16, 3.8, 8] },
  ]) {
    const probe = new ReflectionProbe(...(s.influenceSize as [number, number, number]));
    probe.position.set(...(s.position as [number, number, number]));
    probe.projectionSize = new THREE.Vector3(...s.projectionSize);
    probes.add(probe);
  }
  scene.add(probes);
  const helper = new ReflectionProbesHelper(probes);
  helper.visible = false;
  scene.add(helper);

  const bakeInfo = { bakes: 0, lastMs: 0, burstMs: 0, frames: [] as number[] };
  // animation state (see animate() below)
  let roomT = 0, ballT = 0, frame = 0, lightJump = 0, bakesThisFrame = 0;
  let bakedRoomT = NaN; // the room state (roomTime() below) the probes were last baked at
  /**
   * Bake all three probes. Keeps the mirror ball and the helper out of the captures (engines leave
   * moving objects out of probes), and renders each light's shadow map once per bake instead of
   * once per captured face: three re-renders an auto-updating shadow map on every render call, and
   * a bake is 18 of them.
   */
  function bake() {
    const ballVisible = ball.visible;
    ball.visible = helper.visible = false;
    if (SHADOWS_ONCE) for (const l of lights) { l.shadow.autoUpdate = false; l.shadow.needsUpdate = true; }
    probes.bake(renderer, scene, { resolution: PROBE_RES, near: 0.05, far: 30 });
    if (SHADOWS_ONCE) for (const l of lights) l.shadow.autoUpdate = true;
    ball.visible = ballVisible;
    helper.visible = showHelper;
    bakedRoomT = roomTime();
    bakeInfo.bakes++;
  }
  let showHelper = false;
  bake();
  scene.environmentNode = reflectionProbes(probes) as N; // the materials' diffuse ambient: each room's own

  // ---- BVH over the real scene meshes (three-mesh-bvh, WebGPU) ------------------------------
  const tBvh = performance.now();
  const bvh = new BVHComputeData(room, { attributes: { position: 'vec4f', mat: 'vec4f' } });
  bvh.update();
  let tris = 0;
  room.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) tris += (m.geometry.index?.count ?? m.geometry.attributes.position.count) / 3; });
  const bvhMs = performance.now() - tBvh;

  // One reflection ray from P along D against the scene BVH. Returns (n * (dist + 1), vertex index)
  // of the first hit, n facing the ray, or w = -1 for a miss. The shading is done in TSL (below),
  // so the hit can look the probes up with sampleReflectionProbes().
  const traceHit = wgslTagFn`
    fn traceHit( P: vec3f, Nw: vec3f, D: vec3f, eps: f32 ) -> vec4f {
      let ray = ${rayStruct}( P + Nw * eps, D, 0.0 );
      var hit: ${rayIntersectionResultStruct};
      if ( ${(bvh.fns as N).raycastFirstHit}( ray, &hit ) ) {
        var n = normalize( hit.normal );
        if ( dot( n, D ) > 0.0 ) { n = -n; }
        return vec4f( n * ( hit.dist + 1.0 ), f32( hit.indices.x ) );
      }
      return vec4f( 0.0, 0.0, 0.0, -1.0 );
    }
  ` as N;
  // the packed material of a hit vertex (see buildScene)
  const hitMaterial = wgslTagFn`
    fn hitMaterial( index: f32 ) -> vec4f { return ${(bvh.storage as N).attributes}[ u32( index ) ].mat; }
  ` as N;
  // 1 if the point light at L is visible from P (one shadow ray), else 0
  const lightVisible = wgslTagFn`
    fn lightVisible( P: vec3f, n: vec3f, L: vec3f, eps: f32 ) -> f32 {
      let o = P + n * eps;
      let toL = L - o;
      let dist = length( toL );
      if ( dot( n, toL ) <= 0.0 ) { return 0.0; }
      let ray = ${rayStruct}( o, toL / dist, dist );
      var hit: ${rayIntersectionResultStruct};
      if ( ${(bvh.fns as N).raycastFirstHit}( ray, &hit ) ) { return 0.0; }
      return 1.0;
    }
  ` as N;

  // ---- uniforms ----------------------------------------------------------------------------
  const uFrame = uniform(0, 'uint');
  const uRoughCut = uniform(0.4); // rougher than this: the prefiltered probe, no SSR, no ray
  const uSplit = uniform(0.5);
  const uLightPos = lights.map((l) => uniform(l.position.clone()));
  const uLightCol = lights.map(() => uniform(new THREE.Color()) as N);
  const camWorld = uniform(new THREE.Matrix4());
  camWorld.onFrameUpdate(() => { camera.updateMatrixWorld(); camWorld.value.copy(camera.matrixWorld); });
  const projInv = uniform(camera.projectionMatrixInverse);

  // ---- the frame graph (after reflections-hybrid.ts' buildGraph, native resolution only) ------
  const scenePass = pass(scene, camera);
  scenePass.setMRT(mrt({
    output,
    diffuseColor: vec4(diffuseColor.rgb, materialMetalness),      // albedo + metalness
    normal: vec4(packNormalToRGB(normalView), materialRoughness), // packed VIEW normal + roughness
    velocity,
  }));
  const sceneColor = scenePass.getTextureNode('output');
  const dTex = scenePass.getTextureNode('diffuseColor');
  const nTex = scenePass.getTextureNode('normal');
  const depthTex = scenePass.getTextureNode('depth');
  const velTex = scenePass.getTextureNode('velocity');
  const rtt = (node: N) => convertToTexture(node);

  const surface = (uvN: N) => {
    const d = depthTex.sample(uvN).r;
    const Pv = getViewPosition(uvN, d, projInv);
    const P = camWorld.mul(vec4(Pv, 1)).xyz;
    const Nw = camWorld.mul(vec4(unpackRGBToNormal(nTex.sample(uvN).rgb), 0)).xyz.normalize();
    return { P, N: Nw, sky: d.greaterThanEqual(0.99999).select(float(1), float(0)), viewDist: Pv.length() };
  };
  const camPos = camWorld.mul(vec4(0, 0, 0, 1)).xyz;
  const roughOf = () => nTex.sample(uv()).a;

  // the probes' specular for the pixel's whole lobe (split-sum): what engines do with no rays
  const probeSpec = () => {
    const s = surface(uv());
    const alb = dTex.sample(uv());
    const rough = roughOf();
    const V = camPos.sub(s.P).normalize();
    const R = V.negate().reflect(s.N);
    const spec = (EnvironmentBRDF as N)({
      dotNV: s.N.dot(V).max(1e-4), specularColor: mix(vec3(0.04), alb.rgb, alb.a), specularF90: float(1), roughness: rough,
    });
    return sampleReflectionProbes(probes, s.P, R, rough).mul(spec).mul(float(1).sub(s.sky));
  };
  // what SSR reflects: the lit frame plus the probes' specular, so a mirror seen in a mirror isn't black
  const litRTT = rtt(vec4(sceneColor.rgb.add(probeSpec()), 1));
  const ssrNode = ssr(litRTT, depthTex, sample((uvN: N) => unpackRGBToNormal(nTex.sample(uvN).rgb)), {
    stochastic: true, camera, diffuseNode: dTex, metalnessNode: dTex.a, roughnessNode: nTex.a,
  } as N) as N;
  ssrNode.maxDistance.value = 8;
  ssrNode.thickness.value = 0.08;
  const ssrHit = () => ssrNode.a.greaterThan(0).and(ssrNode.a.lessThan(1e3));

  const lobeSample = (k: number) => {
    const s = surface(uv());
    const alb = dTex.sample(uv());
    const rough = roughOf();
    const V = camPos.sub(s.P).normalize();
    const g = ggxLobeSample(s.N, V, rough, alb.a, alb.rgb, pixelSeed(uFrame, k));
    return { s, rough, dir: g.dir, weight: g.weight };
  };
  /**
   * One traced reflection ray, shaded at the hit: direct light from both point lights (one shadow
   * ray each, no specular highlight), the probes' diffuse at the hit as ambient (what the raster
   * pass gives the same surface), and for metals the probes in the mirrored direction. Where the
   * ray leaves the scene (it can't here: the rooms are closed), the probes in the sampled direction.
   */
  const traced = (r: ReturnType<typeof lobeSample>) => {
    const eps = r.s.viewDist.mul(0.002).add(0.004);
    const t = traceHit(r.s.P, r.s.N, r.dir, eps).toVar();
    const o = vec4(0).toVar();
    If(t.w.lessThan(0), () => {
      o.assign(vec4(sampleReflectionProbes(probes, r.s.P, r.dir, float(0)).mul(r.weight), 100));
    }).Else(() => {
      const len = t.xyz.length();
      const dist = len.sub(1);
      const n = t.xyz.div(len).toVar();
      const Ph = r.s.P.add(r.s.N.mul(eps)).add(r.dir.mul(dist)).toVar();
      const m = hitMaterial(t.w).toVar();
      const metal = m.w.floor().div(100);
      const rough = m.w.fract();
      const diffuse = m.rgb.mul(metal.oneMinus());
      let direct: N = vec3(0);
      for (let i = 0; i < lights.length; i++) {
        const toL = uLightPos[i].sub(Ph);
        const d2 = toL.dot(toL).max(0.01);
        const cos = n.dot(toL.normalize()).max(0);
        direct = direct.add(vec3(uLightCol[i]).mul(cos.div(d2)).mul(lightVisible(Ph, n, uLightPos[i], dist.mul(0.001).add(0.004))));
      }
      const ambient = sampleReflectionProbes(probes, Ph, n, float(1));
      const mirror = sampleReflectionProbes(probes, Ph, r.dir.reflect(n), rough);
      const c = diffuse.mul(direct.div(Math.PI).add(ambient)).add(m.rgb.mul(metal).mul(mirror));
      o.assign(vec4(c.mul(r.weight), dist));
    });
    return clampSample(o, r.rough);
  };

  // per-mode 1-sample estimators (radiance, hit distance), 0 above the cutoff (the composite adds
  // the prefiltered probes there)
  const estimator = {
    ssr: Fn(() => {
      const r = lobeSample(0);
      const o = vec4(0).toVar();
      If(r.rough.lessThanEqual(uRoughCut), () => {
        If(ssrHit(), () => { o.assign(ssrNode); })
          .Else(() => { o.assign(clampSample(vec4(sampleReflectionProbes(probes, r.s.P, r.dir, float(0)).mul(r.weight), 100), r.rough)); });
      });
      return o;
    })(),
    hybrid: Fn(() => {
      const r = lobeSample(0);
      const o = vec4(0).toVar();
      If(r.rough.lessThanEqual(uRoughCut), () => {
        If(ssrHit(), () => { o.assign(ssrNode); }).Else(() => { o.assign(traced(r)); });
      });
      return o;
    })(),
  };
  // the denoiser's inputs, one per side of the split view (its node is swapped per mode)
  const guides = { camera, depth: depthTex, velocity: velTex, normal: nTex, normalSpace: 'view' as const, normalEncoding: 'packed' as const };
  const reflIn = [rtt(vec4(0)), rtt(vec4(0))];
  const reflFFX = reflIn.map((n) => ffxReflections(n, { ...guides, roughness: nTex.a }));
  // reference: 4 traced rays per pixel per frame, every pixel, accumulated while nothing moves
  const reflRef = new AccumulateNode(Fn(() => {
    const o = vec4(0).toVar();
    If(surface(uv()).sky.lessThan(0.5), () => { for (let k = 0; k < 4; k++) o.addAssign(traced(lobeSample(k + 1)).mul(0.25)); });
    return o;
  })());

  const pipeline = new THREE.RenderPipeline(renderer);
  pipeline.outputColorTransform = false;
  const modes = { refl: 'hybrid' as ReflMode, compare: 'none' as ReflMode | 'none', denoise: true };
  const sides = (): ReflMode[] => (modes.compare === 'none' ? [modes.refl] : [modes.refl, modes.compare]);
  const isStochastic = (m: ReflMode) => m === 'ssr' || m === 'hybrid';
  const buildOutput = () => {
    const lit = sceneColor.rgb;
    const litFor = (rm: ReflMode, side: number): N => {
      if (rm === 'probe') return lit.add(probeSpec());
      if (rm === 'ref') return lit.add((reflRef as N).rgb);
      reflIn[side].node = estimator[rm];
      const spec = modes.denoise ? reflFFX[side].rgb : reflIn[side].rgb;
      return lit.add(spec).add(roughOf().greaterThan(uRoughCut).select(probeSpec(), vec3(0)));
    };
    const [a, b] = sides();
    let out: N = litFor(a, 0);
    if (b) out = uv().x.lessThan(uSplit).select(out, litFor(b, 1));
    pipeline.outputNode = renderOutput(vec4(out, 1), THREE.ACESFilmicToneMapping, THREE.SRGBColorSpace) as N;
    pipeline.needsUpdate = true;
    labelTargets();
  };

  // ---- per-pass GPU timing (a trimmed copy of reflections-hybrid.ts' timing) ------------------
  // An inspector labels every render pass by its target; three's timestamp queries give each
  // pass's begin/end. Passes are charged from the previous pass's end to their own end (tilers
  // start vertex work early). FFX's compute passes are timed by the denoiser (gpuTimings); the
  // probes' prefilter is a compute pass of our own and isn't in here (see the bake row).
  type Cat = 'raster' | 'shadow maps' | 'probe captures' | 'SSR' | 'reflection rays' | 'composite';
  const CATS: Cat[] = ['raster', 'shadow maps', 'probe captures', 'SSR', 'reflection rays', 'composite'];
  const rtCat = new Map<unknown, Cat>();
  const rtsOf = (n: N): unknown[] => (n?.renderTarget ? [n.renderTarget] : []);
  function labelTargets() {
    for (const f of reflFFX) for (const grp of [(f as N).inputNodes, (f as N).guideNodes]) for (const v of Object.values(grp ?? {})) for (const rt of rtsOf(v)) rtCat.set(rt, 'composite');
    rtCat.set(scenePass.renderTarget, 'raster');
    for (const rt of rtsOf(litRTT)) rtCat.set(rt, 'composite');
    const sm = sides();
    reflIn.forEach((n, i) => { for (const rt of rtsOf(n)) rtCat.set(rt, sm[i] === 'hybrid' ? 'reflection rays' : 'composite'); });
    for (const rt of reflRef.renderTargets) rtCat.set(rt, 'reflection rays');
  }
  const uidCat = new Map<string, Cat>();
  class PassLabeler extends THREE.InspectorBase {
    beginRender(uid: string, _sc: N, _cam: N, rt: N) {
      let c: Cat | undefined = rt ? rtCat.get(rt) : 'composite';
      if (!c) {
        if (lights.some((l) => rt === (l.shadow as N).map)) c = 'shadow maps';
        else if (rt?.isCubeRenderTarget) c = 'probe captures';
        else if (rt && Object.values(ssrNode).includes(rt)) c = 'SSR';
        else c = 'composite';
      }
      uidCat.set(uid, c);
    }
  }
  renderer.inspector = new PassLabeler() as N;
  let pool: N = null;
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
  interface FrameCost { span: number; cats: Record<Cat, number>; ffx: number }
  const history: FrameCost[] = [];
  let cpuFrameMs = 0, lastT = performance.now();
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
    const ffx = modes.denoise ? sides().reduce((s, m, i) => s + (isStochastic(m) ? ((reflFFX[i] as N).denoiser?.gpuTimings?.get('total') ?? 0) : 0), 0) : 0;
    for (const passes of frames.values()) {
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
      history.push({ span: prevEnd, cats, ffx });
    }
    while (history.length > 60) history.shift();
  }
  const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0);
  const costs = () => {
    const out: Record<string, number> = {};
    for (const c of CATS) out[c] = mean(history.map((h) => h.cats[c]));
    out.ffx = mean(history.map((h) => h.ffx));
    out.total = mean(history.map((h) => h.span));
    out.frames = history.length;
    return out;
  };
  const resetCosts = () => { history.length = 0; };

  // ---- animation ---------------------------------------------------------------------------
  // Ben's updateRoom: the lights drift through the hues half a cycle apart, the knot turns. The ball
  // runs his figure eight. Everything holds still while the reference is shown, so it converges.
  const anim = { lights: true, ball: true, probes: 'live' as 'live' | 'frozen' };
  const FPS = 60;
  const updateRoom = () => {
    const t = roomTime();
    lights[0].color.setHSL((0.08 + t * 0.02) % 1, 1, 0.63);
    lights[1].color.setHSL((0.6 + t * 0.02) % 1, 1, 0.77);
    knot.rotation.y = roomT * 0.5;
  };
  const updateBall = () => {
    const phase = ballT * 0.35;
    ball.position.set(5.6 * Math.sin(phase), 1.2, 1.4 * Math.sin(2 * phase));
  };
  /** Whether a light's colour has moved on by a visible step since the last bake. */
  /** The time the room is shown at: its clock plus a scenario's jump in light colour. */
  function roomTime() { return roomT + lightJump / 0.02; }
  const stage = document.querySelector<HTMLDivElement>('#stage')!;
  const controls = new OrbitControls(camera, stage);
  controls.enableDamping = false;
  controls.minDistance = 0.3;
  controls.maxDistance = 14;
  const prevView = new THREE.Matrix4();
  function animate() {
    const frozen = sides().includes('ref');
    if (!frozen && anim.lights) roomT += 1 / FPS;
    if (!frozen && anim.ball) ballT += 1 / FPS;
    updateRoom();
    updateBall();
    controls.update();
    camera.position.clamp(new THREE.Vector3(-7.85, 0.1, -3.85), new THREE.Vector3(7.85, 4.85, 13));
    camera.updateMatrixWorld();
    room.updateMatrixWorld();
    bakesThisFrame = 0;
    // live capture: re-bake whenever the room changed since the last bake (every frame while it animates)
    if (anim.probes === 'live' && roomTime() !== bakedRoomT) {
      const t0 = performance.now();
      bake();
      bakeInfo.lastMs = performance.now() - t0; // CPU side of the bake (encoding)
      bakesThisFrame = 1;
    }
    bakeInfo.frames.push(bakesThisFrame);
    if (bakeInfo.frames.length > 120) bakeInfo.frames.shift();
    (bvh as N).updateTransforms(); // refit for the ball and the knot
    lights.forEach((l, i) => uLightCol[i].value.copy(l.color).multiplyScalar(l.intensity));
    if (!prevView.equals(camera.matrixWorld)) reflRef.count.value = 0;
    prevView.copy(camera.matrixWorld);
    uFrame.value = frame;
  }
  function renderOne() {
    animate();
    pipeline.render();
    frame++;
    const now = performance.now();
    cpuFrameMs += (now - lastT - cpuFrameMs) * 0.1;
    lastT = now;
    void sampleCosts();
  }
  let job: { left: number; each?: () => void; done: () => void } | null = null;
  const frames = (n: number, each?: () => void) => new Promise<void>((res) => { job = { left: n, each, done: res }; });
  const loop = () => {
    if (!manual) { renderOne(); return; }
    if (!job) return;
    renderOne();
    job.each?.();
    if (--job.left === 0) { const d = job.done; job = null; d(); }
  };

  // ---- the bake's cost, measured once before the loop starts -------------------------------
  // Bursts of bakes with one wait each, loop stopped (a running loop puts its frames in the wait).
  async function bakeBench(burst = 5, reps = 7) {
    for (let i = 0; i < 3; i++) bake(); // compile the capture pipelines
    await idle();
    const t: number[] = [];
    for (let r = 0; r < reps; r++) {
      const t0 = performance.now();
      for (let i = 0; i < burst; i++) bake();
      await idle();
      t.push((performance.now() - t0) / burst);
    }
    t.sort((x, y) => x - y);
    return t[t.length >> 1];
  }
  updateRoom(); updateBall(); room.updateMatrixWorld();
  bakeInfo.burstMs = await bakeBench();

  // ---- UI ----------------------------------------------------------------------------------
  const capEl = document.querySelector<HTMLSpanElement>('#cap-refl')!;
  const costEl = document.querySelector<HTMLTableSectionElement>('#cost-body')!;
  const costNote = document.querySelector<HTMLElement>('#cost-note')!;
  const labL = document.querySelector<HTMLSpanElement>('#lab-l')!;
  const labR = document.querySelector<HTMLSpanElement>('#lab-r')!;
  const divider = document.querySelector<HTMLDivElement>('#divider')!;
  const press = (id: string, v: string) => document.querySelectorAll<HTMLButtonElement>(`${id} button`).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === v)));
  const shortName = (m: ReflMode) => SHORT[m] + (isStochastic(m) && !modes.denoise ? ', raw' : '');
  const updateCaptions = () => {
    const split = modes.compare !== 'none';
    divider.hidden = !split; labR.hidden = !split;
    divider.style.left = `${uSplit.value * 100}%`;
    labL.textContent = (split ? 'left: ' : '') + shortName(modes.refl);
    if (split) labR.textContent = 'right: ' + shortName(modes.compare as ReflMode);
    const describe = (m: ReflMode) => LABEL[m] + (isStochastic(m) ? (modes.denoise ? ' + ffxReflections()' : ', raw (no denoiser)') : '')
      + (m === 'ref' ? ` - ${Math.min(reflRef.count.value, reflRef.max) * 4} rays/pixel so far` : '');
    capEl.textContent = (split ? `Left: ${describe(modes.refl)}. Right: ${describe(modes.compare as ReflMode)}` : describe(modes.refl))
      + `. Live capture ${anim.probes === 'live' ? 'on: probes re-baked every frame the room changes' : 'off: probes frozen'}.`;
  };
  const resetHistories = () => { for (const f of reflFFX) f.resetHistory(); reflRef.count.value = 0; };
  const setRefl = (m: ReflMode) => { if (m === modes.refl) return; modes.refl = m; reflFFX[0].resetHistory(); reflRef.count.value = 0; press('#seg-refl', m); buildOutput(); resetCosts(); updateCaptions(); };
  const setCompare = (m: ReflMode | 'none') => { if (m === modes.compare) return; modes.compare = m; reflFFX[1].resetHistory(); reflRef.count.value = 0; press('#seg-compare', m); buildOutput(); resetCosts(); updateCaptions(); };
  const setDenoise = (on: boolean) => { if (on === modes.denoise) return; modes.denoise = on; if (on) for (const f of reflFFX) f.resetHistory(); press('#seg-denoise', on ? 'on' : 'off'); buildOutput(); resetCosts(); updateCaptions(); };
  const setProbes = (v: 'live' | 'frozen') => { anim.probes = v; press('#seg-probes', v); updateCaptions(); };
  const setLights = (on: boolean) => { anim.lights = on; press('#seg-lights', on ? 'on' : 'off'); };
  const setBall = (on: boolean) => { anim.ball = on; press('#seg-ball', on ? 'on' : 'off'); };
  const setSplit = (x: number) => { uSplit.value = Math.min(0.98, Math.max(0.02, x)); updateCaptions(); };
  divider.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    divider.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => { const r = stage.getBoundingClientRect(); setSplit((ev.clientX - r.left) / r.width); };
    const up = () => { divider.removeEventListener('pointermove', move); divider.removeEventListener('pointerup', up); };
    divider.addEventListener('pointermove', move);
    divider.addEventListener('pointerup', up);
  });
  const segs: [string, (v: string) => void][] = [
    ['#seg-refl', (v) => setRefl(v as ReflMode)],
    ['#seg-compare', (v) => setCompare(v as ReflMode | 'none')],
    ['#seg-denoise', (v) => setDenoise(v === 'on')],
    ['#seg-probes', (v) => setProbes(v as 'live' | 'frozen')],
    ['#seg-lights', (v) => setLights(v === 'on')],
    ['#seg-ball', (v) => setBall(v === 'on')],
  ];
  for (const [id, fn] of segs) document.querySelectorAll<HTMLButtonElement>(`${id} button`).forEach((b) => b.addEventListener('click', () => fn(b.dataset.v!)));
  document.querySelector('#rebake')!.addEventListener('click', () => bake());
  const helperBtn = document.querySelector<HTMLButtonElement>('#helper')!;
  helperBtn.addEventListener('click', () => { showHelper = !showHelper; helper.visible = showHelper; helperBtn.setAttribute('aria-pressed', String(showHelper)); });
  const cutIn = document.querySelector<HTMLInputElement>('#cutoff')!;
  const cutOut = document.querySelector<HTMLOutputElement>('#cutoff-v')!;
  const onCut = () => { uRoughCut.value = parseFloat(cutIn.value); cutOut.textContent = uRoughCut.value.toFixed(2); };
  cutIn.addEventListener('input', onCut); onCut();
  const roughIn = document.querySelector<HTMLInputElement>('#roughness')!;
  const roughOut = document.querySelector<HTMLOutputElement>('#roughness-v')!;
  const onRough = () => { floorMat.roughness = parseFloat(roughIn.value); roughOut.textContent = floorMat.roughness.toFixed(2); };
  roughIn.addEventListener('input', onRough); onRough();

  // ---- the tour ----------------------------------------------------------------------------
  const scenarioEl = document.querySelector<HTMLDivElement>('#scenario')!;
  const tourEl = document.querySelector<HTMLDivElement>('#tour')!;
  const VERDICT = { good: 'gets it', bad: 'wrong', part: 'partly' } as const;
  const applyScenario = (sc: Scenario) => {
    camera.position.set(...sc.pos);
    controls.target.set(...sc.target);
    camera.lookAt(controls.target);
    controls.update();
    setRefl(sc.left);
    setCompare(sc.right);
    setDenoise(true);
    setSplit(sc.split ?? 0.5);
    setBall(sc.ball ?? true);
    setLights(true);
    if (sc.ballT !== undefined) ballT = sc.ballT / 0.35;
    lightJump = 0;
    if (sc.probes === 'frozen') {
      setProbes('live');
      updateRoom(); bake(); // bake the current colours, then freeze them and move the lights on
      setProbes('frozen');
      lightJump = sc.lightJump ?? 0;
    } else {
      setProbes('live');
    }
    resetHistories();
    tourEl.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === sc.id)));
    scenarioEl.innerHTML = `<h3>${sc.title}</h3><p>${sc.look}</p><ul class="verdicts">${
      sc.verdicts.map(([m, v, txt]) => `<li><span class="v v-${v}">${SHORT[m]}: ${VERDICT[v]}</span> ${txt}</li>`).join('')}</ul>`
      + (sc.why ? `<p class="why">${sc.why}</p>` : '');
  };
  tourEl.innerHTML = SCENARIOS.map((sc, i) => `<button data-v="${sc.id}" aria-pressed="false">${i + 1}. ${sc.short}</button>`).join('');
  tourEl.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.addEventListener('click', () => applyScenario(SCENARIOS.find((sc) => sc.id === b.dataset.v)!)));
  buildOutput();
  applyScenario(SCENARIOS.find((sc) => sc.id === q.get('scenario')) ?? SCENARIOS[0]);

  setInterval(() => {
    updateCaptions();
    const perSec = bakeInfo.frames.reduce((a, b) => a + b, 0) / Math.max(1, bakeInfo.frames.length) * (1000 / Math.max(cpuFrameMs, 1));
    const bakeRow = `<tr><td>probe re-bake (3 probes, ${PROBE_RES} px)</td><td class="num">${bakeInfo.burstMs.toFixed(2)}</td><td class="note">ms per bake (18 faces + prefilter, measured at load); ${anim.probes === 'frozen' ? 'live capture off: none now' : `${perSec.toFixed(0)} bakes per second now`}</td></tr>`;
    if (!hasTimestamps) {
      costEl.innerHTML = bakeRow;
      costNote.textContent = `${q.has('notiming') ? 'GPU timing is off (?notiming)' : 'GPU timestamp queries are not available in this browser'}, so there is no per-pass split. ${(1000 / cpuFrameMs).toFixed(0)} fps.`;
      return;
    }
    const c = costs();
    const sm = sides();
    const rows: [string, number, string][] = [
      ['raster: G-buffer, lights, probe ambient', c.raster, ''],
      ['shadow maps: 2 point lights', c['shadow maps'], 'every frame (the ball moves)'],
      ['probe captures (live capture)', c['probe captures'], anim.probes === 'frozen' ? 'off' : 'the 18 face renders; the prefilter is in "untimed"'],
      ['SSR', c.SSR, sm.some(isStochastic) ? 'below the roughness cutoff' : 'off'],
      ['reflection rays: BVH vs scene triangles', c['reflection rays'], sm.includes('hybrid') ? 'only where SSR missed' : sm.includes('ref') ? (reflRef.count.value >= reflRef.max ? 'reference converged, idle' : 'reference: 4 rays/pixel') : 'off'],
      ['ffxReflections (compute)', c.ffx, sm.some(isStochastic) && modes.denoise ? '' : 'off'],
      ['composite + probe lookups + tone map', c.composite, ''],
      ['untimed: gaps between passes', Math.max(0, c.total - CATS.reduce((a, k) => a + c[k], 0) - c.ffx), 'the probes\' prefilter (compute) when re-baking, and the GPU waiting on the CPU'],
    ];
    costEl.innerHTML = (modes.compare !== 'none' ? '<tr><td colspan="3" class="note">Split view: the passes of BOTH sides run. Set "Right side" to "off" to time one mode.</td></tr>' : '')
      + rows.map(([k, v, note]) => `<tr><td>${k}</td><td class="num">${v.toFixed(2)}</td><td class="note">${note}</td></tr>`).join('')
      + `<tr class="total"><td>GPU frame time</td><td class="num">${c.total.toFixed(2)}</td><td class="note">ms at ${W}x${H}, render passes + FFX (gaps between passes included)</td></tr>`
      + bakeRow
      + `<tr class="total"><td>frame rate</td><td class="num">${(1000 / cpuFrameMs).toFixed(0)}</td><td class="note">fps (capped by the display refresh)</td></tr>`;
  }, 400);
  updateCaptions();
  renderer.setAnimationLoop(loop);

  // ---- test hooks ----------------------------------------------------------------------------
  const copyCanvas = document.createElement('canvas');
  copyCanvas.width = W; copyCanvas.height = H;
  const cctx = copyCanvas.getContext('2d', { willReadFrequently: true })!;
  const api = {
    ready: true,
    gpuErrors,
    info: { three: THREE.REVISION, triangles: tris, bvhBuildMs: bvhMs, timestamps: hasTimestamps, probeRes: PROBE_RES },
    bake: bakeInfo,
    get frame() { return frame; },
    async step(n: number) { await frames(n); await idle(); },
    scenario: (id: string) => applyScenario(SCENARIOS.find((sc) => sc.id === id)!),
    setModes(m: { refl?: ReflMode; compare?: ReflMode | 'none'; denoise?: boolean; split?: number; probes?: 'live' | 'frozen'; lights?: boolean; ball?: boolean; cutoff?: number; roomT?: number; ballT?: number; lightJump?: number; helper?: boolean }) {
      if (m.refl) setRefl(m.refl);
      if (m.compare) setCompare(m.compare);
      if (m.denoise !== undefined) setDenoise(m.denoise);
      if (m.split !== undefined) setSplit(m.split);
      if (m.probes) setProbes(m.probes);
      if (m.lights !== undefined) setLights(m.lights);
      if (m.ball !== undefined) setBall(m.ball);
      if (m.cutoff !== undefined) { cutIn.value = String(m.cutoff); onCut(); }
      if (m.roomT !== undefined) roomT = m.roomT;
      if (m.ballT !== undefined) ballT = m.ballT;
      if (m.lightJump !== undefined) lightJump = m.lightJump;
      if (m.helper !== undefined) { showHelper = m.helper; helper.visible = m.helper; }
    },
    look(pos: [number, number, number], target: [number, number, number]) { camera.position.set(...pos); controls.target.set(...target); controls.update(); resetHistories(); },
    rebake: () => bake(),
    /** Bake cost, ms per bake: bursts of `burst` bakes, one wait each, median of `reps`. Stop the loop (?manual) first. */
    bakeBench,
    /** Render one frame and return the canvas as a PNG data URL. */
    async capture(): Promise<string> {
      await frames(1, () => cctx.drawImage(canvas, 0, 0));
      const url = copyCanvas.toDataURL('image/png');
      await idle();
      return url;
    },
    /** GPU cost per category, averaged over n frames. */
    async costs(n = 40) {
      await frames(10); await idle();
      resetCosts();
      await frames(n); await idle();
      await sampleCosts();
      return { ...costs(), ffxPasses: Object.fromEntries((reflFFX[0] as N).denoiser?.gpuTimings ?? []) };
    },
  };
  (window as unknown as { __t: typeof api }).__t = api;
  log(`ready - three r${THREE.REVISION}, ${W}x${H}${manual ? ' (manual stepping)' : ''}; BVH: ${tris.toLocaleString()} triangles, built in ${bvhMs.toFixed(0)} ms; probe bake ${bakeInfo.burstMs.toFixed(2)} ms`
    + (hasTimestamps ? '' : '\nno timestamp-query: per-pass GPU timings unavailable'));
}

main().catch((e) => { log(`ERROR: ${(e as Error).stack ?? e}`); console.error(e); (window as unknown as { __error?: string }).__error = String(e); });
