// Scenes for the lab. Each one is a fixed camera + content, so a benchmark run is the same
// image on every machine (the tracer's `stableNoise` restarts its random sequence on reset).
import * as THREE from 'three/webgpu';
import { GradientEquirectTexture } from 'three-gpu-pathtracer/src/textures/GradientEquirectTexture.js';

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

export const SCENES: SceneEntry[] = [
  { id: 'spheres', label: 'Spheres', build: spheres },
];
