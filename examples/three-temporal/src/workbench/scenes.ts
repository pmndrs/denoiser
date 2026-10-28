// The workbench's scenes: the two rooms of reflections-rooms.ts (ours, procedural), Ben's SSR example scene
// (PR #35228's webgpu_postprocessing_ssr.html: mirror steampunk camera on a mirror disc, RoomEnvironment only) and
// glTF models from the three.js examples (Space Ship Hallway is upstream at r186; others are listed when a local
// three.js checkout has them).
//
// Every scene comes with its reflection probes (./probes, our r186 stand-in for three.js #35046): one per room for
// the rooms; for a model, a row of probes along its longest horizontal axis, each box covering its slice.
// The materials take their diffuse ambient from the probes (scene.environmentNode); their own environment specular
// is switched off globally (main.ts), the pane composite supplies every specular term itself.

import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { color, screenUV } from 'three/tsl';
import { ReflectionProbe, ReflectionProbes } from '../probes/ReflectionProbes';

export interface WorkbenchScene {
  scene: THREE.Scene;
  probes: ReflectionProbes;
  /** Objects kept out of probe captures (they move). */
  dynamic: THREE.Object3D[];
  lights: (THREE.Light & { shadow?: THREE.LightShadow })[];
  /** Start pose: camera position and orbit target. */
  view: { position: THREE.Vector3; target: THREE.Vector3 };
  /** Scale of the scene (metres per unit-ish): sizes SSR distance / thickness and SSGI radius. */
  size: number;
  /** Per-frame animation (t in seconds); returns true when something the probes see changed. */
  animate(t: number): boolean;
  floor?: THREE.MeshStandardMaterial;
  /** Probe bake settings. */
  bake: { near: number; far: number };
  /** SSR ray length and thickness (default: size and size / 100). */
  ssr?: { maxDistance: number; thickness: number };
  /** Start field of view (default 55). */
  fov?: number;
  /** Workbench settings the scene starts with. */
  defaults?: { ssgi?: boolean; roughCut?: number };
  /** Roughness sliders the GUI shows for this scene, by name. */
  roughness?: Record<string, THREE.MeshStandardMaterial[]>;
}

// three.js examples assets: the local checkout through the dev server (/__three-examples/, threeExamples() in
// vite.config.ts), else the r186 tag on GitHub (upstream files only)
const LOCAL = '/__three-examples/';
const REMOTE = 'https://raw.githubusercontent.com/mrdoob/three.js/r186/examples/';
async function assetUrl(file: string): Promise<string> {
  try {
    const r = await fetch(LOCAL + file, { method: 'HEAD' });
    if (r.ok) return LOCAL + file;
  } catch { /* fall through */ }
  return REMOTE + file;
}

export const MODELS: Record<string, { file: string; upstream: boolean }> = {
  'Space Ship Hallway': { file: 'models/gltf/space_ship_hallway.glb', upstream: true },
  'Dual Rooms (Ben\'s branch)': { file: 'models/gltf/dual-rooms.glb', upstream: false },
  'Cornell Box (Ben\'s branch)': { file: 'models/gltf/cornell-box.glb', upstream: false },
  'Cornell Box, metallic sphere (Ben\'s branch)': { file: 'models/gltf/cornell-box-metallic-sphere.glb', upstream: false },
  'Primitives Floor, metallic mirror (Ben\'s branch)': { file: 'models/gltf/primitives-floor-metallic-mirror.glb', upstream: false },
  'Primitives Floor, color rough (Ben\'s branch)': { file: 'models/gltf/primitives-floor-color-rough.glb', upstream: false },
};
export const TWO_ROOMS = 'Two rooms (ours)';
export const BEN_SSR = 'Ben\'s SSR example (steampunk camera)';

/** The scenes this machine can load: the rooms, the upstream models, and the local-only ones that are there. */
export async function availableScenes(): Promise<string[]> {
  const local = await Promise.all(Object.entries(MODELS).map(async ([name, m]) => {
    if (m.upstream) return name;
    try { return (await fetch(LOCAL + m.file, { method: 'HEAD' })).ok ? name : null; } catch { return null; }
  }));
  return [TWO_ROOMS, BEN_SSR, ...local.filter((n): n is string => !!n)];
}

export function loadScene(name: string, renderer: THREE.WebGPURenderer): Promise<WorkbenchScene> {
  if (name === TWO_ROOMS) return Promise.resolve(twoRooms());
  if (name === BEN_SSR) return benSSRExample(renderer);
  return model(name);
}

const std = (color: number, roughness = 1, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });

// ---- the two rooms (reflections-rooms.ts' buildScene, without the ray-tracing attributes) ---------------------------
function twoRooms(): WorkbenchScene {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x111111);
  const add = (mesh: THREE.Mesh, cast = true, receive = true) => { mesh.castShadow = cast; mesh.receiveShadow = receive; scene.add(mesh); return mesh; };

  // room shell: x = -8 to 8, z = -4 to 4, y = 0 to 5; the front wall is open for the camera
  add(new THREE.Mesh(new THREE.BoxGeometry(16, 5, 8), new THREE.MeshStandardMaterial({ color: 0xcccccc, side: THREE.BackSide })), false).position.set(0, 2.5, 0);
  const floor = std(0x5c5650, 0.12);
  const floorMesh = add(new THREE.Mesh(new THREE.PlaneGeometry(16, 8), floor), false);
  floorMesh.rotation.x = -Math.PI / 2; floorMesh.position.y = 0.002;
  const red = add(new THREE.Mesh(new THREE.PlaneGeometry(8, 5), std(0xdd2200)), false, false);
  red.rotation.y = Math.PI / 2; red.position.set(-7.99, 2.5, 0);
  const blue = add(new THREE.Mesh(new THREE.PlaneGeometry(8, 5), std(0x0044ff)), false, false);
  blue.rotation.y = -Math.PI / 2; blue.position.set(7.99, 2.5, 0);

  const grey = std(0xcccccc);
  const gap = 1.25;
  add(new THREE.Mesh(new THREE.BoxGeometry(0.3, 5, 4 - gap), grey)).position.set(0, 2.5, -(gap + (4 - gap) / 2));
  add(new THREE.Mesh(new THREE.BoxGeometry(0.3, 5, 4 - gap), grey)).position.set(0, 2.5, gap + (4 - gap) / 2);
  add(new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.2, gap * 2), grey)).position.set(0, 4.4, 0);

  const white = std(0xeeeeee);
  const column = new THREE.CylinderGeometry(0.3, 0.3, 4, 16);
  for (const x of [-6, -2, 2, 6]) for (const z of [-2.5, 2.5]) add(new THREE.Mesh(column, white)).position.set(x, 2, z);
  const wood = std(0x886644);
  add(new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.12, 1.4), wood)).position.set(-4, 1.0, 0);
  const leg = new THREE.BoxGeometry(0.1, 1, 0.1);
  for (const x of [-5.05, -2.95]) for (const z of [-0.55, 0.55]) add(new THREE.Mesh(leg, wood), true, false).position.set(x, 0.5, z);
  add(new THREE.Mesh(new THREE.SphereGeometry(0.35, 32, 32), std(0xffd700, 0.4, 0.3))).position.set(-4, 1.41, 0);
  add(new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.5, 1), white)).position.set(-7, 0.25, 0);
  add(new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.0, 1), white)).position.set(-7, 0.5, 0);
  add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.5, 1), white)).position.set(-7, 0.75, 0);
  add(new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.2, 0.8), white)).position.set(4, 0.6, 0);
  const knot = add(new THREE.Mesh(new THREE.TorusKnotGeometry(0.3, 0.1, 64, 16), std(0xff44aa, 0.5, 0.2)));
  knot.position.set(4, 1.65, 0);
  add(new THREE.Mesh(new THREE.ConeGeometry(0.4, 2.5, 5), white)).position.set(6.5, 1.25, -1.5);

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
  const ball = add(new THREE.Mesh(new THREE.SphereGeometry(0.54, 48, 32), std(0xffffff, 0, 1)));

  const probes = new ReflectionProbes();
  for (const s of [
    { p: [-4, 2.5, 0], influence: [8.4, 5.4, 8.4], projection: [8, 5, 8] },
    { p: [4, 2.5, 0], influence: [8.4, 5.4, 8.4], projection: [8, 5, 8] },
    { p: [0, 1.9, 0], influence: [2.4, 3.8, 2.5], projection: [16, 3.8, 8] },
  ]) {
    const probe = new ReflectionProbe(...(s.influence as [number, number, number]));
    probe.position.set(...(s.p as [number, number, number]));
    probe.projectionSize = new THREE.Vector3(...s.projection);
    probes.add(probe);
  }
  scene.add(probes);

  let lastHue = NaN;
  return {
    scene, probes, dynamic: [ball], lights, floor, size: 8,
    view: { position: new THREE.Vector3(-3.0, 1.6, 3.85), target: new THREE.Vector3(-4.6, 0.3, 0.8) },
    bake: { near: 0.05, far: 30 },
    animate(t) {
      // reflections-rooms' updateRoom (lights drift through the hues, the knot turns) and the ball's figure eight
      const hue = Math.round(t * 0.02 * 200) / 200; // the probes re-bake when the hue moved a visible step
      lights[0].color.setHSL((0.08 + hue) % 1, 1, 0.63);
      lights[1].color.setHSL((0.6 + hue) % 1, 1, 0.77);
      knot.rotation.y = t * 0.5;
      const phase = t * 0.35;
      ball.position.set(5.6 * Math.sin(phase), 1.2, 1.4 * Math.sin(2 * phase));
      const changed = hue !== lastHue;
      lastHue = hue;
      return changed;
    },
  };
}

// ---- Ben's SSR example (PR #35228 webgpu_postprocessing_ssr.html) ------------------------------------------------------
// His scene as he sets it up: the steampunk camera with every material forced to roughness 0, on a metal mirror disc
// (roughness 0), lit only by RoomEnvironment, his screen-space grey gradient behind it, SSR distance 5 / thickness
// 0.03, roughness cutoff 0.8, camera 35° at (3, 2, 3). No probes: RoomEnvironment fills the probes' environment slot,
// so the fallback is the infinitely distant environment, as his PMREM fallback. (He sets environmentIntensity 1.25;
// the probes take RoomEnvironment at 1.)
async function benSSRExample(renderer: THREE.WebGPURenderer): Promise<WorkbenchScene> {
  const gltf = await new GLTFLoader().loadAsync(await assetUrl('models/gltf/steampunk_camera.glb'));
  const scene = new THREE.Scene();
  scene.backgroundNode = screenUV.distance(0.5).remap(0, 0.5).mix(color(0x888877), color(0x776666));
  const cube = new THREE.CubeRenderTarget(256, { type: THREE.HalfFloatType });
  new THREE.CubeCamera(0.1, 100, cube).update(renderer as never, new RoomEnvironment());
  scene.environment = cube.texture;

  const materials = new Set<THREE.MeshStandardMaterial>();
  gltf.scene.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
    if (m) { m.side = THREE.FrontSide; m.roughness = 0; materials.add(m); }
  });
  gltf.scene.position.y = 0.1;
  scene.add(gltf.scene);
  const floorMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 0 });
  const floor = new THREE.Mesh(new THREE.CircleGeometry(2, 64), floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.8;
  scene.add(floor);
  const probes = new ReflectionProbes();
  scene.add(probes);
  return {
    scene, probes, dynamic: [], lights: [], size: 4, fov: 35,
    view: { position: new THREE.Vector3(3, 2, 3), target: new THREE.Vector3(0, 0, 0) },
    bake: { near: 0.1, far: 50 },
    ssr: { maxDistance: 5, thickness: 0.03 },
    defaults: { ssgi: false, roughCut: 0.8 },
    roughness: { 'model roughness': [...materials], 'floor roughness': [floorMaterial] },
    animate: () => false,
  };
}

// ---- glTF models ---------------------------------------------------------------------------------------------------
async function model(name: string): Promise<WorkbenchScene> {
  const entry = MODELS[name];
  const [gltf, env] = await Promise.all([
    new GLTFLoader().loadAsync(await assetUrl(entry.file)),
    new HDRLoader().loadAsync(await assetUrl('textures/equirectangular/pedestrian_overpass_1k.hdr')),
  ]);
  env.mapping = THREE.EquirectangularReflectionMapping;
  const scene = new THREE.Scene();
  scene.background = env;
  scene.environment = env; // lights the first probe capture; afterwards the probes light the materials
  const root = gltf.scene;
  scene.add(root);
  const lights: WorkbenchScene['lights'] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) { m.castShadow = m.receiveShadow = true; }
    const l = o as WorkbenchScene['lights'][number];
    if (l.isLight) {
      lights.push(l);
      l.castShadow = !(l as THREE.AmbientLight).isAmbientLight;
      if (l.shadow) { l.shadow.mapSize.setScalar(512); l.shadow.bias = -0.0005; }
    }
  });
  scene.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());

  // a row of probes along the longest horizontal axis, one per roughly cubic slice
  const probes = new ReflectionProbes();
  const axis = size.x >= size.z ? 'x' : 'z';
  const across = axis === 'x' ? size.z : size.x;
  const count = Math.max(1, Math.min(6, Math.round(size[axis] / Math.max(across, size.y))));
  const slice = size[axis] / count;
  for (let i = 0; i < count; i++) {
    const s = size.clone();
    s[axis] = slice;
    const probe = new ReflectionProbe(s.x * 1.05, s.y * 1.05, s.z * 1.05);
    probe.position.copy(center);
    probe.position[axis] = box.min[axis] + slice * (i + 0.5);
    probe.position.y = box.min.y + size.y * 0.45;
    probe.projectionSize = s.clone();
    probes.add(probe);
  }
  scene.add(probes);

  // a camera from the file, else one end of the long axis looking down it
  let view: WorkbenchScene['view'];
  const cam = gltf.cameras[0] as THREE.PerspectiveCamera | undefined;
  if (cam) {
    cam.updateMatrixWorld(true);
    const position = new THREE.Vector3().setFromMatrixPosition(cam.matrixWorld);
    const dir = new THREE.Vector3(0, 0, -1).transformDirection(cam.matrixWorld);
    view = { position, target: position.clone().add(dir.multiplyScalar(size.length() * 0.3)) };
  } else {
    const position = center.clone();
    position[axis] = box.min[axis] + slice * 0.35;
    position.y = box.min.y + size.y * 0.45;
    const target = center.clone();
    target.y = position.y * 0.9;
    view = { position, target };
  }
  const extent = Math.max(size.x, size.y, size.z);
  return {
    scene, probes, dynamic: [], lights, size: Math.max(across, size.y), view,
    bake: { near: extent * 0.003, far: extent * 3 },
    animate: () => false,
  };
}
