// three-temporal/reflection-probes: Ben Houston's reflection probes (three.js PR #35046) on three r186.
//
// A port of three's webgpu_reflection_probes.html from that PR (same two rooms, lights, probes,
// test grid and camera), running our r186 stand-in from ./probes instead of the PR's
// CubeArrayTexture build. Two rooms joined by a doorway; one probe per room plus a smaller doorway
// probe that takes priority where they overlap. Box projection onto each room's walls.
//
// Extra over the original: the seam handling of the manual cube lookup ('warp' / 'none'), and a
// diagnostic 'hw' mode that copies every probe into its own cube texture and samples those with
// the hardware (seamless) cube sampler, i.e. what #35046's cube array gives, from the same bake.
// `window.__p` drives the page headlessly (poses, roughness, bake and frame timing, screenshots).

import * as THREE from 'three/webgpu';
import { cubeTexture } from 'three/tsl';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ReflectionProbe, ReflectionProbes, type SeamFix } from './probes/ReflectionProbes';
import { ReflectionProbesNode, reflectionProbes } from './probes/ReflectionProbesNode';
import { ReflectionProbesHelper } from './probes/ReflectionProbesHelper';
import { mountShell } from '../../_shared/shell';

mountShell({ id: 'three-temporal-reflection-probes', title: 'Reflection probes (#35046 on r186)' });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any; // TSL's node typings are too strict for hand-written shader maths
const q = new URLSearchParams(location.search);
const W = Number(q.get('w') ?? 960), H = Number(q.get('h') ?? 540);

type Lookup = SeamFix | 'hw';
const params = {
  lookup: (q.get('lookup') ?? 'warp') as Lookup, resolution: Number(q.get('res') ?? 128),
  showProbes: false, showGrid: q.has('grid'), gridResolution: 6, gridSize: 0.12,
  boxProjection: true, dynamicObject: (q.get('obj') ?? 'Sphere') as 'None' | 'Sphere', pause: q.has('pause'), liveCapture: false,
};

/**
 * Diagnostic: the same probes sampled through the hardware cube sampler. Each baked slot is copied
 * into its own cube texture (all mips), so face edges are filtered seamlessly, as #35046's cube
 * array does. Needs a 'none' bake (the warp moves texel centres, which a plain cube can't undo).
 */
class HardwareCubeNode extends ReflectionProbesNode {
  private readonly cubes: N[];
  constructor(probes: ReflectionProbes, cubes: THREE.CubeTexture[]) {
    super(probes);
    this.cubes = cubes.map((c) => cubeTexture(c));
  }
  protected sampleProbe(slot: number, dir: N, lod: N): N {
    return this.cubes[slot].sample(dir).level(lod).rgb;
  }
}

async function main() {
  const status = document.querySelector<HTMLElement>('#status')!;
  const canvas = document.querySelector<HTMLCanvasElement>('#view')!;

  const camera = new THREE.PerspectiveCamera(50, W / H, 0.1, 100);
  camera.position.set(0, 2.5, 16);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x111111);

  // ---- Ben's two rooms, verbatim ----------------------------------------------------------
  const wallMaterial = new THREE.MeshStandardMaterial({ color: 0xcccccc, side: THREE.BackSide });
  const whiteMat = new THREE.MeshStandardMaterial({ color: 0xeeeeee });
  const add = (mesh: THREE.Mesh, cast = true, receive = true) => { mesh.castShadow = cast; mesh.receiveShadow = receive; scene.add(mesh); return mesh; };

  // room shell: x = -8 to 8, z = -4 to 4, y = 0 to 5
  add(new THREE.Mesh(new THREE.BoxGeometry(16, 5, 8), wallMaterial), false).position.set(0, 2.5, 0);
  const redWall = add(new THREE.Mesh(new THREE.PlaneGeometry(8, 5), new THREE.MeshStandardMaterial({ color: 0xdd2200 })), false, false);
  redWall.rotation.y = Math.PI / 2; redWall.position.set(-7.99, 2.5, 0);
  const blueWall = add(new THREE.Mesh(new THREE.PlaneGeometry(8, 5), new THREE.MeshStandardMaterial({ color: 0x0044ff })), false, false);
  blueWall.rotation.y = -Math.PI / 2; blueWall.position.set(7.99, 2.5, 0);

  // dividing wall at x = 0 with a doorway
  const dividerMat = new THREE.MeshStandardMaterial({ color: 0xcccccc });
  const gap = 1.25;
  add(new THREE.Mesh(new THREE.BoxGeometry(0.3, 5, 4 - gap), dividerMat)).position.set(0, 2.5, -(gap + (4 - gap) / 2));
  add(new THREE.Mesh(new THREE.BoxGeometry(0.3, 5, 4 - gap), dividerMat)).position.set(0, 2.5, gap + (4 - gap) / 2);
  add(new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.2, gap * 2), dividerMat)).position.set(0, 4.4, 0);

  // left room: columns, table with a golden sphere, stepped blocks by the red wall
  const columnGeom = new THREE.CylinderGeometry(0.3, 0.3, 4, 16);
  for (const x of [-6, -2, 2, 6]) for (const z of [-2.5, 2.5]) add(new THREE.Mesh(columnGeom, whiteMat)).position.set(x, 2, z);
  const tableTop = add(new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.12, 1.4), new THREE.MeshStandardMaterial({ color: 0x886644 })));
  tableTop.position.set(-4, 1.0, 0);
  const legGeom = new THREE.BoxGeometry(0.1, 1, 0.1);
  for (const x of [-5.05, -2.95]) for (const z of [-0.55, 0.55]) add(new THREE.Mesh(legGeom, tableTop.material), true, false).position.set(x, 0.5, z);
  add(new THREE.Mesh(new THREE.SphereGeometry(0.35, 32, 32), new THREE.MeshStandardMaterial({ color: 0xffd700, metalness: 0.3, roughness: 0.4 }))).position.set(-4, 1.41, 0);
  add(new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.5, 1), whiteMat)).position.set(-7, 0.25, 0);
  add(new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.0, 1), whiteMat)).position.set(-7, 0.5, 0);
  add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.5, 1), whiteMat)).position.set(-7, 0.75, 0);

  // right room: pedestal with a torus knot, tall cone
  add(new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.2, 0.8), whiteMat)).position.set(4, 0.6, 0);
  add(new THREE.Mesh(new THREE.TorusKnotGeometry(0.3, 0.1, 64, 16), new THREE.MeshStandardMaterial({ color: 0xff44aa, metalness: 0.2, roughness: 0.5 }))).position.set(4, 1.65, 0);
  add(new THREE.Mesh(new THREE.ConeGeometry(0.4, 2.5, 5), whiteMat)).position.set(6.5, 1.25, -1.5);

  // warm point light in the left room, cool in the right
  for (const [color, x] of [[0xffaa44, -4], [0x88bbff, 4]]) {
    const light = new THREE.PointLight(color, 30);
    light.position.set(x, 4.5, 0);
    light.castShadow = true;
    light.shadow.mapSize.setScalar(256);
    light.shadow.radius = 12;
    light.shadow.bias = -0.002;
    scene.add(light);
  }

  const renderer = new THREE.WebGPURenderer({ canvas, trackTimestamp: q.has('ts') });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  renderer.shadowMap.enabled = true;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  await renderer.init();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const device: GPUDevice = (renderer.backend as any).device;

  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 2.5, 0);
  controls.update();

  // one probe per room plus a smaller doorway probe, which takes priority where they overlap
  const probes = new ReflectionProbes();
  probes.seamFix = params.lookup === 'warp' ? 'warp' : 'none';
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

  // each test surface evaluates the probe blend at its own world position
  const gridMaterial = new THREE.MeshStandardMaterial({ metalness: 1, roughness: 0.08 });
  const dynamicMaterial = new THREE.MeshStandardMaterial({ metalness: 1, roughness: 0 });
  // (the PR's default test object is the Stanford bunny; the sphere is its other option)
  const dynamicObject = new THREE.Mesh(new THREE.SphereGeometry(4.5 * params.gridSize, 32, 24), dynamicMaterial);
  dynamicObject.castShadow = dynamicObject.receiveShadow = true;
  dynamicObject.visible = params.dynamicObject !== 'None';
  const probesHelper = new ReflectionProbesHelper(probes);
  probesHelper.material.roughness = 0.08;
  probesHelper.visible = params.showProbes;
  const grid = new THREE.Group();
  scene.add(probesHelper, grid, dynamicObject);

  function updateDynamicObject(time: number) {
    // a figure eight around both room centres, crossing x = 0 at the doorway
    const phase = time * 0.35;
    dynamicObject.position.set(5.6 * Math.sin(phase), 2.5, 1.4 * Math.sin(2 * phase));
    dynamicObject.rotation.y = Math.atan2(5.6 * Math.cos(phase), 2.8 * Math.cos(2 * phase));
  }
  updateDynamicObject(0);

  function updateGrid() {
    for (const mesh of [...grid.children] as THREE.InstancedMesh[]) { grid.remove(mesh); mesh.geometry.dispose(); mesh.dispose(); }
    const n = params.gridResolution;
    const m = new THREE.Matrix4();
    for (const cx of [-3.9, 3.9]) {
      const mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(params.gridSize, 16, 12), gridMaterial, n ** 3);
      let i = 0;
      for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        m.makeTranslation(cx - 3.9 + x * 7.8 / (n - 1), 0.1 + y * 4.7 / (n - 1), -3.8 + z * 7.6 / (n - 1));
        mesh.setMatrixAt(i++, m);
      }
      mesh.instanceMatrix.needsUpdate = true;
      grid.add(mesh);
    }
    grid.visible = params.showGrid;
  }
  updateGrid();

  // ---- bake + node -------------------------------------------------------------------------
  let hwCubes: THREE.CubeRenderTarget[] = [];

  /** Copy every baked slot (6 layers, all mips) into its own cube texture, for the 'hw' lookup. */
  function copyToCubes() {
    const tex = probes.texture!;
    const size = (tex.image as { width: number }).width, mips = tex.mipmaps.length, slots = probes.bakedProbes.length + 1;
    if (hwCubes.length !== slots || hwCubes[0].width !== size) {
      for (const c of hwCubes) c.dispose();
      hwCubes = Array.from({ length: slots }, () => {
        const c = new THREE.CubeRenderTarget(size, { type: THREE.HalfFloatType, generateMipmaps: false, depthBuffer: false, minFilter: THREE.LinearMipmapLinearFilter });
        // a cube texture lists its mips past level 0
        for (let lod = 1; lod < mips; lod++) c.texture.mipmaps.push({ width: size >> lod, height: size >> lod } as never);
        renderer.initRenderTarget(c);
        return c;
      });
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const backend = renderer.backend as any;
    const src: GPUTexture = backend.get(tex).texture;
    const encoder = device.createCommandEncoder();
    hwCubes.forEach((c, slot) => {
      const dst: GPUTexture = backend.get(c.texture).texture;
      if (dst.mipLevelCount < mips) throw new Error(`hw cube has ${dst.mipLevelCount} mips, need ${mips}`);
      for (let lod = 0; lod < mips; lod++) {
        const s = size >> lod;
        encoder.copyTextureToTexture({ texture: src, mipLevel: lod, origin: [0, 0, slot * 6] }, { texture: dst, mipLevel: lod }, [s, s, 6]);
      }
    });
    device.queue.submit([encoder.finish()]);
  }

  function capture(live = false) {
    // keep helpers and test objects out of the reflections; a live capture keeps the moving object
    probesHelper.visible = grid.visible = false;
    dynamicObject.visible = live && params.dynamicObject !== 'None';
    probes.bake(renderer, scene, { resolution: params.resolution, near: 0.05, far: 30 });
    probesHelper.visible = params.showProbes;
    grid.visible = params.showGrid;
    dynamicObject.visible = params.dynamicObject !== 'None';
    if (params.lookup === 'hw') copyToCubes();
  }

  let node: N = null;
  function install() {
    probes.seamFix = params.lookup === 'warp' ? 'warp' : 'none';
    capture();
    node = params.lookup === 'hw' ? new HardwareCubeNode(probes, hwCubes.map((c) => c.texture)) : reflectionProbes(probes);
    scene.environmentNode = node;
  }
  install();

  // ---- UI ----------------------------------------------------------------------------------
  const panel = document.querySelector<HTMLElement>('#controls')!;
  const row = (label: string, el: HTMLElement) => { const l = document.createElement('label'); l.textContent = `${label} `; l.append(el); panel.append(l); return el; };
  const select = (label: string, opts: string[], value: string, on: (v: string) => void) => {
    const s = document.createElement('select');
    for (const o of opts) s.append(new Option(o, o, false, o === value));
    s.onchange = () => on(s.value);
    return row(label, s);
  };
  const check = (label: string, value: boolean, on: (v: boolean) => void) => {
    const c = document.createElement('input'); c.type = 'checkbox'; c.checked = value; c.onchange = () => on(c.checked);
    return row(label, c);
  };
  const slider = (label: string, value: number, on: (v: number) => void) => {
    const r = document.createElement('input'); r.type = 'range'; r.min = '0'; r.max = '1'; r.step = '0.01'; r.value = String(value); r.oninput = () => on(Number(r.value));
    return row(label, r);
  };
  select('Lookup', ['warp', 'none', 'hw'], params.lookup, (v) => { params.lookup = v as Lookup; install(); });
  select('Capture resolution', ['64', '128', '256', '512'], String(params.resolution), (v) => { params.resolution = Number(v); install(); });
  check('Live capture', params.liveCapture, (v) => { params.liveCapture = v; });
  check('Box projection', params.boxProjection, (v) => { probes.boxProjection = v; });
  select('Object', ['None', 'Sphere'], params.dynamicObject, (v) => { params.dynamicObject = v as 'None' | 'Sphere'; dynamicObject.visible = v !== 'None'; });
  check('Pause', params.pause, (v) => { params.pause = v; });
  slider('Object roughness', dynamicMaterial.roughness, (v) => { dynamicMaterial.roughness = v; });
  check('Grid', params.showGrid, (v) => { params.showGrid = grid.visible = v; });
  slider('Grid roughness', gridMaterial.roughness, (v) => { gridMaterial.roughness = v; });
  check('Probes', params.showProbes, (v) => { params.showProbes = probesHelper.visible = v; });

  // ---- loop --------------------------------------------------------------------------------
  const timer = new THREE.Timer();
  let animationTime = 0;
  function animate() {
    timer.update();
    if (!params.pause && params.dynamicObject !== 'None') { animationTime += timer.getDelta(); updateDynamicObject(animationTime); }
    if (params.liveCapture) capture(true);
    renderer.render(scene, camera);
  }
  renderer.setAnimationLoop(animate);
  status.textContent = `three r${THREE.REVISION}, ${probes.bakedProbes.length} probes at ${params.resolution} px, lookup: ${params.lookup}`;

  // ---- headless hooks (same shape as the harness for the PR build) --------------------------
  const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
  const idle = () => device.queue.onSubmittedWorkDone();
  Object.assign(window, {
    __p: {
      THREE, scene, camera, renderer, controls, probes, gridMaterial, dynamicMaterial, dynamicObject, grid, params, capture,
      get node() { return node; },
      stop() { renderer.setAnimationLoop(null); },
      start() { renderer.setAnimationLoop(animate); },
      setLookup(v: Lookup) { params.lookup = v; install(); },
      setResolution(v: number) { params.resolution = v; install(); },
      setPose(p: { pos: number[]; target: number[]; fov?: number }) {
        camera.position.fromArray(p.pos); controls.target.fromArray(p.target);
        camera.fov = p.fov ?? 50; camera.updateProjectionMatrix(); controls.update();
      },
      setObject(v: 'None' | 'Sphere', pos?: number[], roughness?: number) {
        params.dynamicObject = v; dynamicObject.visible = v !== 'None'; params.pause = true;
        if (pos) dynamicObject.position.fromArray(pos);
        if (roughness !== undefined) dynamicMaterial.roughness = roughness;
      },
      setGrid(on: boolean, roughness?: number) { params.showGrid = grid.visible = on; if (roughness !== undefined) gridMaterial.roughness = roughness; },
      /** Render once (loop stopped) and return the canvas as a PNG data URL. */
      async shot() { renderer.render(scene, camera); const url = canvas.toDataURL('image/png'); await idle(); return url; },
      /** Bake timing: `burst` bakes per submit-wait, median ms per bake over `reps` bursts. */
      async timeBake(resolution: number, burst = 5, reps = 7) {
        params.resolution = resolution;
        for (let i = 0; i < 3; i++) capture();
        await idle();
        const t: number[] = [];
        for (let r = 0; r < reps; r++) {
          const t0 = performance.now();
          for (let i = 0; i < burst; i++) capture();
          await idle();
          t.push((performance.now() - t0) / burst);
        }
        return { median: median(t), all: t };
      },
      /** Frame timing: wall ms per frame over bursts, plus GPU ms per frame with ?ts. */
      async timeFrames(burst = 30, reps = 7) {
        for (let i = 0; i < 10; i++) renderer.render(scene, camera);
        await idle();
        const wall: number[] = [];
        for (let r = 0; r < reps; r++) {
          const t0 = performance.now();
          for (let i = 0; i < burst; i++) renderer.render(scene, camera);
          await idle();
          wall.push((performance.now() - t0) / burst);
        }
        const gpu: number[] = [];
        if (q.has('ts')) {
          await renderer.resolveTimestampsAsync('render');
          for (let i = 0; i < 40; i++) { renderer.render(scene, camera); gpu.push((await renderer.resolveTimestampsAsync('render')) ?? NaN); }
        }
        return { wall: median(wall), gpu: gpu.length ? median(gpu) : null };
      },
      /** Swap the environment node (null: no IBL at all), for the lookup's marginal cost. */
      setEnvNode(on: boolean) { scene.environmentNode = on ? node : null; },
    },
  });
}

main().catch((e) => {
  console.error(e);
  document.querySelector<HTMLElement>('#status')!.textContent = String(e?.stack ?? e);
});
