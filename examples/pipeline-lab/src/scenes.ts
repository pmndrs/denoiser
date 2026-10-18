// Scenes for the lab. Each one is a fixed camera + content, so a benchmark run is the same
// image on every machine (the tracer's `stableNoise` restarts its random sequence on reset).
import * as THREE from 'three/webgpu';
import { GradientEquirectTexture } from 'three-gpu-pathtracer/src/textures/GradientEquirectTexture.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { LDrawLoader } from 'three/addons/loaders/LDrawLoader.js';
import { LDrawConditionalLineMaterial } from 'three/addons/materials/LDrawConditionalLineNodeMaterial.js';
import { LDrawUtils } from 'three/addons/utils/LDrawUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { TeapotGeometry } from 'three/addons/geometries/TeapotGeometry.js';

export interface LabScene {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** Orbit target. */
  target: THREE.Vector3;
}

export interface SceneEntry {
  id: string;
  label: string;
  build(): Promise<LabScene> | LabScene;
}

function gradientEnv(top: number, bottom: number) {
  // GradientEquirectTexture is set up for compute sampling; a raw DataTexture trips three's
  // compute sampler codegen.
  const env = new GradientEquirectTexture();
  env.topColor.set(top);
  env.bottomColor.set(bottom);
  env.update();
  return env;
}

/** Three spheres (diffuse, glossy, metal) on a plane, lit by a gradient sky only. */
function spheres(): LabScene {
  const scene = new THREE.Scene();
  const env = gradientEnv(0xbfd4ff, 0x666666);
  scene.environment = env;
  scene.background = env;
  const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 100);
  camera.position.set(0, 1.4, 4.6);
  const target = new THREE.Vector3(0, 0.5, 0);
  camera.lookAt(target);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(20, 20),
    new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.8 }),
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);
  [0xe53e3e, 0x38a169, 0x3182ce].forEach((c, i) => {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(0.6, 48, 32),
      new THREE.MeshStandardMaterial({ color: c, roughness: 0.2 + i * 0.3, metalness: i === 2 ? 1 : 0 }),
    );
    m.position.set((i - 1) * 1.6, 0.6, 0);
    scene.add(m);
  });
  return { scene, camera, target };
}

/**
 * The furnished room from three-temporal/shadows.html, lit by one emissive softbox instead
 * of a ray-traced area light: glossy floor, contact shadows, small bright reflections. The
 * hard case for a denoiser (indirect light, a small light source).
 */
function room(): LabScene {
  const scene = new THREE.Scene();
  scene.environment = scene.background = gradientEnv(0x766f66, 0x2a2622);
  scene.environmentIntensity = 0.35;
  const camera = new THREE.PerspectiveCamera(42, 16 / 9, 0.05, 30);
  const target = new THREE.Vector3(-0.35, 0.5, -0.8);
  camera.position.set(target.x + 4.1 * Math.sin(0.2), 1.65, target.z + 4.1 * Math.cos(0.2));
  camera.lookAt(target);

  const std = (color: number, roughness: number, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, ry = 0, parent: THREE.Object3D = scene) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.y = ry;
    parent.add(m);
    return m;
  };

  // softbox high on the right, facing into the corner
  const lightC = new THREE.Vector3(2.7, 2.5, -0.35);
  const panel = new THREE.Mesh(
    new THREE.PlaneGeometry(0.95, 0.7),
    new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xfff1de, emissiveIntensity: 30, side: THREE.DoubleSide }),
  );
  panel.position.copy(lightC);
  panel.lookAt(-0.8, 0, -0.6);
  scene.add(panel);

  const floor = add(new THREE.PlaneGeometry(16, 16), std(0x6e5643, 0.12), 0, 0, 0);
  floor.rotation.x = -Math.PI / 2;
  const wallMat = std(0xd9d4cc, 0.85);
  add(new THREE.PlaneGeometry(16, 4), wallMat, 0, 2, -2.1);
  add(new THREE.PlaneGeometry(16, 4), wallMat, -3.0, 2, 0, Math.PI / 2);
  const skirt = std(0xece8e2, 0.6);
  add(new THREE.BoxGeometry(12, 0.09, 0.02), skirt, 0, 0.045, -2.09);
  add(new THREE.BoxGeometry(0.02, 0.09, 12), skirt, -2.99, 0.045, 0);
  add(new RoundedBoxGeometry(2.5, 0.012, 1.7, 2, 0.005), std(0x56677a, 1.0), -0.15, 0.006, -0.55);

  const legMat = std(0x1d1d1f, 0.35, 0.85);
  const table = new THREE.Group();
  table.position.set(0.05, 0, -0.65);
  scene.add(table);
  add(new RoundedBoxGeometry(1.5, 0.045, 0.8, 3, 0.012), std(0x2b1d15, 0.12), 0, 0.74, 0, 0, table);
  const legGeo = new THREE.CylinderGeometry(0.018, 0.014, 0.72, 16);
  for (const [lx, lz] of [[-0.66, -0.32], [0.66, -0.32], [-0.66, 0.32], [0.66, 0.32]]) add(legGeo, legMat, lx, 0.36, lz, 0, table);

  const chair = new THREE.Group();
  chair.position.set(-1.05, 0, -0.5);
  chair.rotation.y = Math.PI / 2 + 0.25;
  scene.add(chair);
  const oak = std(0xb88a5a, 0.55);
  add(new RoundedBoxGeometry(0.44, 0.035, 0.42, 3, 0.012), oak, 0, 0.45, 0, 0, chair);
  add(new RoundedBoxGeometry(0.42, 0.24, 0.025, 3, 0.01), oak, 0, 0.74, -0.2, 0, chair).rotation.x = -0.12;
  const cLeg = new THREE.CylinderGeometry(0.014, 0.012, 0.45, 12);
  for (const [lx, lz] of [[-0.19, -0.18], [0.19, -0.18], [-0.19, 0.18], [0.19, 0.18]]) add(cLeg, legMat, lx, 0.225, lz, 0, chair);
  for (const lx of [-0.19, 0.19]) add(new THREE.CylinderGeometry(0.012, 0.012, 0.3, 10), legMat, lx, 0.6, -0.195, 0, chair);

  const lamp = new THREE.Group();
  lamp.position.set(-2.35, 0, -1.25);
  scene.add(lamp);
  add(new THREE.CylinderGeometry(0.17, 0.18, 0.025, 32), legMat, 0, 0.0125, 0, 0, lamp);
  add(new THREE.CylinderGeometry(0.011, 0.011, 1.5, 12), std(0xb08d57, 0.3, 1.0), 0, 0.76, 0, 0, lamp);
  add(new THREE.CylinderGeometry(0.13, 0.23, 0.28, 40, 1, true),
    new THREE.MeshStandardMaterial({ color: 0xf1ebe0, roughness: 0.9, side: THREE.DoubleSide }), 0, 1.58, 0, 0, lamp);

  const lathe = (pts: number[][], segs: number) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), segs);
  add(lathe([[0, 0], [0.12, 0], [0.15, 0.08], [0.17, 0.3], [0.12, 0.62], [0.07, 0.76], [0.08, 0.84], [0.075, 0.85]], 48), std(0x3f6a64, 0.35), -1.6, 0, -1.6);
  add(lathe([[0, 0], [0.24, 0], [0.28, 0.03], [0.3, 0.2], [0.28, 0.37], [0.24, 0.4], [0, 0.4]], 48), std(0xc56b4a, 0.8), 1.15, 0, 0.55);

  const tt = 0.7625; // table top surface
  add(new TeapotGeometry(0.085, 10), std(0xe9e4dc, 0.25), -0.3, tt + 0.065, -0.6);
  add(new THREE.SphereGeometry(0.075, 48, 24), std(0xdddddd, 0.06, 1.0), 0.28, tt + 0.075, -0.48);
  add(lathe([[0, 0], [0.05, 0], [0.065, 0.06], [0.04, 0.2], [0.03, 0.26], [0.035, 0.28]], 32), std(0x9b4f3a, 0.4), 0.42, tt, -0.82);
  [0x2f4858, 0x8c6d46, 0xa9443a].forEach((c, i) =>
    add(new RoundedBoxGeometry(0.26, 0.035, 0.19, 2, 0.004), std(c, 0.7), 0.55, tt + 0.0175 + i * 0.036, -0.05, 0.15 * i - 0.1, table));

  add(new RoundedBoxGeometry(0.32, 0.9, 0.32, 3, 0.01), std(0xeeeae4, 0.7), 1.95, 0.45, -1.45);
  add(new THREE.TorusKnotGeometry(0.13, 0.04, 160, 20), std(0xc9a46a, 0.25, 1.0), 1.95, 1.12, -1.45);
  return { scene, camera, target };
}

/** The LEGO Eiffel Tower (21019) on a table, under an overcast HDRI: ~136k triangles. */
async function eiffel(): Promise<LabScene> {
  const base = import.meta.env.BASE_URL;
  const scene = new THREE.Scene();
  const env = await new HDRLoader().loadAsync(`${base}assets/kloppenheim_06_puresky_1k.hdr`);
  env.mapping = THREE.EquirectangularReflectionMapping;
  scene.environment = scene.background = env;
  const table = new THREE.Mesh(new RoundedBoxGeometry(11, 0.5, 11, 3, 0.08), new THREE.MeshStandardMaterial({ color: 0x9a6a39, roughness: 0.7 }));
  table.position.y = -0.25;
  scene.add(table);
  const gel = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.3, 1.3), new THREE.MeshPhysicalMaterial({
    color: 0x3ec46d, roughness: 0.18, transmission: 1, ior: 1.35, thickness: 1.2, transparent: true, opacity: 0.45,
  }));
  gel.position.set(2.4, 0.651, 1.6);
  gel.rotation.y = 0.5;
  scene.add(gel);

  const loader = new LDrawLoader();
  loader.smoothNormals = true;
  loader.setConditionalLineMaterial(LDrawConditionalLineMaterial);
  // packed MPD (tools/pack-ldraw.mjs): every part inlined, no parts-library fetches
  const raw = await loader.loadAsync(`${base}assets/eiffel-tower_Packed.mpd`);
  raw.rotation.x = Math.PI; // LDraw is -Y up
  raw.updateMatrixWorld(true);
  const model = LDrawUtils.mergeObject(raw); // one mesh with groups: one BVH build
  const lines: THREE.Object3D[] = [];
  model.traverse((c) => { if ((c as THREE.Line).isLine) lines.push(c); });
  lines.forEach((l) => l.removeFromParent());
  const box = new THREE.Box3().setFromObject(model);
  model.scale.setScalar(3.6 / box.getSize(new THREE.Vector3()).y);
  model.updateMatrixWorld(true);
  box.setFromObject(model);
  const c = box.getCenter(new THREE.Vector3());
  model.position.set(-c.x, model.position.y - box.min.y, -c.z);
  scene.add(model);

  const camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 200);
  camera.position.set(-1.2, 2.2, 6.2);
  const target = new THREE.Vector3(0.6, 1.4, 0.3);
  camera.lookAt(target);
  return { scene, camera, target };
}

/** A glTF / GLB the viewer drops on the page: framed automatically, lit by a neutral sky. */
export async function fromGltf(file: File): Promise<LabScene> {
  const url = URL.createObjectURL(file);
  try {
    // Draco and meshopt cover most published models; the Draco decoder loads from Google's CDN
    const draco = new DRACOLoader().setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
    const gltf = await new GLTFLoader().setDRACOLoader(draco).setMeshoptDecoder(MeshoptDecoder).loadAsync(url);
    draco.dispose();
    const scene = new THREE.Scene();
    scene.environment = scene.background = gradientEnv(0xdfe8f5, 0x55514c);
    const model = gltf.scene;
    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const radius = size.length() / 2 || 1;
    // a ground plane under it, so there is a contact shadow to look at
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(radius * 20, radius * 20), new THREE.MeshStandardMaterial({ color: 0x8a8a8a, roughness: 0.85 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = box.min.y;
    scene.add(model, ground);
    const camera = gltf.cameras[0] instanceof THREE.PerspectiveCamera ? gltf.cameras[0] : new THREE.PerspectiveCamera(40, 16 / 9, radius / 100, radius * 100);
    if (!(gltf.cameras[0] instanceof THREE.PerspectiveCamera)) {
      camera.position.copy(center).add(new THREE.Vector3(0.9, 0.55, 1.2).normalize().multiplyScalar(radius * 2.6));
      camera.lookAt(center);
    }
    return { scene, camera, target: center };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export const SCENES: SceneEntry[] = [
  { id: 'spheres', label: 'Spheres', build: spheres },
  { id: 'room', label: 'Furnished room', build: room },
  { id: 'eiffel', label: 'LEGO Eiffel Tower', build: eiffel },
];
