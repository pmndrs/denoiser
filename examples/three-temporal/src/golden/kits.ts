// Scene kits of the golden registry: the three.js side of G2-G5 (registry.ts has the data). They reuse the scene code of
// the realtime pages (src/realtime/*: the furnished corner, the Bistro / Sponza loaders, their lights, sky and paths,
// the WGSL ray functions) and add only what the golden contract needs: deterministic poses per path frame, the light
// event of G4, the product scene of G5.
import * as THREE from 'three/webgpu';
import { float, vec2, vec4, uniform, uint, hash } from 'three/tsl';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshBVH, SAH } from 'three-mesh-bvh';
import { BVHComputeData } from 'three-mesh-bvh/webgpu';
import { LIGHT_C, LIGHT_N, LIGHT_U, LIGHT_V, LIGHT_ASPECT, buildScene, equivalentSphereRadius } from '../realtime/scene';
import { scenePose, type PathName } from '../realtime/path';
import { loadAsset } from '../realtime/assets';
import { SCENES, makeSkyEnvironment, pathOf, type SceneConfig } from '../realtime/scenes';
import { cornerRays, assetRays } from '../realtime/rays';
import type { GBuf, Kit, KitSignals, N, RaySetup } from './types';
import type { GoldenEvent } from './registry';

const V3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const clampF = (f: number, n: number) => Math.max(0, Math.min(n - 1, f));

/** stratified shadow-reference rays: mean visibility and the summed distance of the blocked ones, `grid^2` rays */
function stratified(grid: number, seed: N, ray: (xi: N) => N): N {
  let vis: N = float(0), dist: N = float(0);
  for (let j = 0; j < grid; j++) {
    for (let i = 0; i < grid; i++) {
      const k = j * grid + i;
      const r0 = hash(seed.add(uint(2 * k + 1)));
      const r1 = hash(seed.add(uint(2 * k + 2)));
      const s = ray(vec2(r0.add(i).div(grid), r1.add(j).div(grid)));
      vis = vis.add(s.x);
      dist = dist.add(s.y);
    }
  }
  return vec4(vis.div(grid * grid), dist.div(grid * grid), 0, 1);
}

// ---- G2: the corner with the knot ---------------------------------------------------------------------------------

export async function cornerKit(path: PathName, W: number, H: number, frames: number): Promise<Kit> {
  const ENV_I = 0.28;
  const { scene, camera, env, room, knot } = buildScene(W, H);
  scene.environment = null; // indirect light comes from the traced diffuse signal and SSR only
  scene.updateMatrixWorld(true);
  const bvh = new BVHComputeData(room);
  bvh.update();
  let tris = 0;
  room.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) tris += (m.geometry.index?.count ?? m.geometry.attributes.position.count) / 3; });

  const half = 0.3;
  const uLightC = uniform(LIGHT_C.clone());
  const uLightU = uniform(LIGHT_U.clone().multiplyScalar(half * LIGHT_ASPECT));
  const uLightV = uniform(LIGHT_V.clone().multiplyScalar(half));
  const uLightN = uniform(LIGHT_N.clone());
  const uLightPower = uniform(30);

  const kit: Kit = {
    id: 'G2', label: 'knot over a floor', scene, camera, env, envI: ENV_I, ssr: { maxDistance: 4, thickness: 0.05 },
    frames, events: [], moverMaterials: [knot.material as THREE.Material], mover: knot, shadingNormals: false, triangles: tris,
    info: { scene: 'corner', path, lightPanelHalf: half, lightPower: uLightPower.value },
    buildSignals(g: GBuf, r: RaySetup): KitSignals {
      const rays = cornerRays((bvh.fns as N).raycastFirstHit, { aoA: r.aoA, aoB: r.aoB });
      const { s0, eps } = g;
      const pcgSeed = g.pixelSeed().add(r.seed.mul(7919));
      return {
        diffuse1: rays.diffuse1(s0.P, s0.N, s0.sky, eps, vec2(r.xi(2), r.xi(3)), uLightC, uLightN, uLightPower, float(ENV_I)),
        shadow1: vec4(rays.areaShadow1(s0.P, s0.N, s0.sky, uLightC, uLightU, uLightV, uLightN, eps, vec2(r.xi(0), r.xi(1))), 0, 1),
        shadowRef: stratified(r.visGrid, pcgSeed.add(uint(12345)),
          (xi) => rays.areaShadow1(s0.P, s0.N, s0.sky, uLightC, uLightU, uLightV, uLightN, eps, xi)),
        diffuseRef: rays.diffuseRef(s0.P, s0.N, s0.sky, eps, pcgSeed.add(uint(777)), uint(r.difRays), s0.depth, uLightC, uLightN, uLightPower, float(ENV_I)),
        direct: (vis: N) => {
          const L = uLightC.sub(s0.P);
          const d2 = L.dot(L).max(1e-3);
          const l = L.normalize();
          return uLightPower.mul(s0.N.dot(l).max(0)).mul(uLightN.dot(l.negate()).max(0)).div(d2).mul(vis).mul(float(1).sub(s0.sky));
        },
        direction: () => rays.cosineDir(s0.N, vec2(r.xi(2), r.xi(3))),
      };
    },
    setFrame(f) {
      scenePose(path, camera, knot, clampF(f, frames));
      knot.updateMatrixWorld();
      camera.updateMatrixWorld();
      (bvh as N).updateTransforms();
    },
    light: () => ({ type: 'sphere', position: [LIGHT_C.x, LIGHT_C.y, LIGHT_C.z], radius: equivalentSphereRadius(half) }),
    captureLights: () => [{
      id: 'panel', type: 'sphere', position: [LIGHT_C.x, LIGHT_C.y, LIGHT_C.z], radius: equivalentSphereRadius(half),
      intensity: uLightPower.value, shadow: true,
    }],
  };
  kit.setFrame(0);
  return kit;
}

// ---- G3 / G4 / G5: asset scenes (sun + one local light + sky) --------------------------------------------------------

export interface AssetKitSpec {
  id: string;
  label: string;
  cfg: SceneConfig;
  /** Loads geometry; returns the raster scene content, the BVH meshes and the mover. */
  load(W: number, H: number): Promise<{
    add: THREE.Object3D[];
    bvhMeshes: THREE.Mesh[];
    triangles: number;
    mover?: THREE.Object3D;
    moverMaterials?: THREE.Material[];
    setMover?(f: number): void;
    shadingNormals?: boolean;
    info?: Record<string, unknown>;
  }>;
  frames: number;
  events: GoldenEvent[];
  pose(f: number): { position: THREE.Vector3; target: THREE.Vector3 };
  /** Local light position and on-factor (0 = off) at path frame f. */
  local(f: number): { position: THREE.Vector3; on: number; tint?: 'warm' | 'cool' };
  /** Local light power override (colour * power); default cfg.local */
  localPower?: number;
  shadow: 'sun' | 'local';
}

/** Same luminance, another hue (a colour step a luminance-only anti-lag cannot see). */
function coolOf(c: THREE.Vector3): THREE.Vector3 {
  const lum = (v: THREE.Vector3) => 0.2126 * v.x + 0.7152 * v.y + 0.0722 * v.z;
  const t = new THREE.Vector3(c.z * 0.5 + 0.02, c.y * 0.9, c.x * 1.6 + 0.05);
  return t.multiplyScalar(lum(c) / Math.max(lum(t), 1e-6));
}

export async function assetKit(spec: AssetKitSpec, W: number, H: number): Promise<Kit> {
  const { cfg } = spec;
  const ENV_I = cfg.sky.intensity;
  const content = await spec.load(W, H);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x101216);
  for (const o of content.add) { o.updateMatrixWorld(true); scene.add(o); }
  const camera = new THREE.PerspectiveCamera(cfg.fov, W / H, cfg.near, cfg.far);
  const env = makeSkyEnvironment(cfg);
  const bvh = new BVHComputeData(content.bvhMeshes);
  bvh.update();
  const rays = assetRays((bvh.fns as N).raycastFirstHit, cfg, { aoA: 1, aoB: 0.05, bounceLocalShadow: false });

  const sunDir = cfg.sun.toLight.clone().normalize();
  const sunE = new THREE.Vector3(...cfg.sun.color).multiplyScalar(cfg.sun.irradiance);
  const lPow0 = new THREE.Vector3(...cfg.local.color).multiplyScalar(spec.localPower ?? cfg.local.power);
  const uSunDir = uniform(sunDir.clone());
  const uSunE = uniform(sunE.clone());
  const uTanR = uniform(Math.tan(cfg.sun.angularRadius));
  const uLPos = uniform(cfg.local.position.clone());
  const uLPow = uniform(lPow0.clone());
  const uLR = uniform(cfg.local.radius);
  const sunShadows = spec.shadow === 'sun';
  const kindShadow = uint(sunShadows ? 0 : 1);
  const kindOther = uint(sunShadows ? 1 : 0);
  let localOn = 1;

  const kit: Kit = {
    id: spec.id, label: spec.label, scene, camera, env, envI: ENV_I, ssr: cfg.ssr,
    frames: spec.frames, events: spec.events, moverMaterials: content.moverMaterials ?? [], mover: content.mover ?? null,
    shadingNormals: !!content.shadingNormals, triangles: content.triangles, info: { scene: cfg.id, attribution: cfg.attribution, ...content.info },
    buildSignals(g: GBuf, r: RaySetup): KitSignals {
      const { s0, eps } = g;
      const pcgSeed = g.pixelSeed().add(r.seed.mul(7919));
      const otherVis = rays.hardVis(s0.P, s0.N, s0.sky, eps, kindOther, uSunDir, uLPos);
      // the other light's hard visibility is noise-free; kept as a node (evaluated per use, cheap)
      const sunDirect = (vis: N) => uSunE.mul(s0.N.dot(uSunDir).max(0)).mul(vis);
      const localDirect = (vis: N) => { const L = uLPos.sub(s0.P); const d2 = L.dot(L).max(0.01); return uLPow.mul(s0.N.dot(L.normalize()).max(0)).div(d2).mul(vis); };
      return {
        diffuse1: rays.diffuse1(s0.P, s0.N, s0.sky, eps, vec2(r.xi(2), r.xi(3)), uSunDir, uSunE, uLPos, uLPow, float(ENV_I)),
        shadow1: vec4(rays.shadow1(s0.P, s0.N, s0.sky, eps, vec2(r.xi(0), r.xi(1)), kindShadow, uSunDir, uTanR, uLPos, uLR), 0, 1),
        shadowRef: stratified(r.visGrid, pcgSeed.add(uint(12345)),
          (xi) => rays.shadow1(s0.P, s0.N, s0.sky, eps, xi, kindShadow, uSunDir, uTanR, uLPos, uLR)),
        diffuseRef: rays.diffuseRef(s0.P, s0.N, s0.sky, eps, pcgSeed.add(uint(777)), uint(r.difRays), s0.depth, uSunDir, uSunE, uLPos, uLPow, float(ENV_I)),
        direct: (vis: N) => (sunShadows ? sunDirect(vis).add(localDirect(otherVis)) : localDirect(vis).add(sunDirect(otherVis))).mul(float(1).sub(s0.sky)),
        direction: () => rays.cosineDir(s0.N, vec2(r.xi(2), r.xi(3))),
      };
    },
    setFrame(f) {
      const fc = clampF(f, spec.frames);
      const p = spec.pose(fc);
      camera.position.copy(p.position);
      camera.lookAt(p.target);
      const l = spec.local(fc);
      localOn = l.on;
      uLPos.value.copy(l.position);
      uLPow.value.copy(l.tint === 'cool' ? coolOf(lPow0) : lPow0).multiplyScalar(l.on);
      content.setMover?.(fc);
      camera.updateMatrixWorld();
      content.mover?.updateMatrixWorld(true);
      (bvh as N).updateTransforms();
    },
    light: () => (sunShadows
      ? { type: 'directional', direction: [sunDir.x, sunDir.y, sunDir.z], angularRadius: cfg.sun.angularRadius }
      : { type: 'sphere', position: [uLPos.value.x, uLPos.value.y, uLPos.value.z], radius: cfg.local.radius }),
    captureLights: () => {
      const sun = { id: 'sun', type: 'directional', direction: [sunDir.x, sunDir.y, sunDir.z], angularRadius: cfg.sun.angularRadius, color: cfg.sun.color, intensity: cfg.sun.irradiance, shadow: sunShadows };
      const local = { id: 'local', type: 'sphere', position: uLPos.value.toArray(), radius: cfg.local.radius, color: cfg.local.color, intensity: (spec.localPower ?? cfg.local.power) * localOn, shadow: !sunShadows };
      return sunShadows ? [sun, local] : [local, sun];
    },
  };
  kit.setFrame(0);
  return kit;
}

// ---- G3: Sponza ---------------------------------------------------------------------------------------------------------

async function loadAssetGeometry(id: 'sponza' | 'bistro') {
  const asset = await loadAsset(id, {});
  const bvhMesh = new THREE.Mesh(asset.bvhGeometry);
  bvhMesh.updateMatrixWorld(true);
  (asset.bvhGeometry as N).boundsTree = new MeshBVH(asset.bvhGeometry, { strategy: SAH, targetLeafSize: 4 } as N);
  return { add: asset.meshes as THREE.Object3D[], bvhMeshes: [bvhMesh], triangles: asset.triangles, info: { triangles: asset.triangles } };
}

export function sponzaKit(path: 'orbit' | 'pan' | 'hold', W: number, H: number, frames: number) {
  const cfg = SCENES.sponza;
  const def = pathOf(cfg, path === 'pan' ? 'sponza-pan' : 'sponza-orbit')!;
  const at = (f: number) => def.pose(path === 'hold' ? 20 : f);
  return assetKit({
    id: 'G3', label: 'Sponza orbit', cfg, frames, events: [], shadow: 'sun',
    load: () => loadAssetGeometry('sponza'),
    pose: at,
    local: () => ({ position: cfg.local.position, on: 1 }),
  }, W, H);
}

// ---- G4: Bistro pan with the lantern switching on ---------------------------------------------------------------------

/** The G4 lantern: not the scene's default one (which is behind the pan's start): a street lamp in view of the pan. */
export const G4_LANTERN = { position: V3(-2.5, 2.4, -9.5), power: 60, onFrame: 32 };

export type G4Path = 'pan-light-on' | 'pan-light-colour' | 'pan-light-fade' | 'pan-lamp-switch' | 'hold-light-on';
const G4_LAMP_B = V3(4.0, 2.4, -16.0);
export function bistroLightKit(path: G4Path, W: number, H: number, frames: number) {
  const base = SCENES.bistro;
  const cfg: SceneConfig = { ...base, local: { ...base.local, position: G4_LANTERN.position.clone(), power: G4_LANTERN.power } };
  const def = pathOf(base, 'bistro-pan')!;
  const T = path === 'hold-light-on' ? 16 : G4_LANTERN.onFrame;
  const notes: Record<G4Path, string> = {
    'pan-light-on': `lantern off -> on (step) at frame ${T}`,
    'pan-light-colour': `lantern on throughout; at frame ${T} its colour steps warm -> cool at constant luminance`,
    'pan-light-fade': `lantern fades 0 -> 1 linearly over frames ${T - 8}-${T + 8}`,
    'pan-lamp-switch': `lantern A (${G4_LANTERN.position.toArray()}) on until frame ${T - 1}; lamp B (${G4_LAMP_B.toArray()}) on from ${T}`,
    'hold-light-on': `still camera (pan frame 20), lantern off -> on (step) at frame ${T}`,
  };
  return assetKit({
    id: 'G4', label: 'Bistro pan, light change', cfg, frames, shadow: 'sun',
    events: [{ frame: path === 'pan-light-fade' ? T - 8 : T, type: path.replace(/^(pan|hold)-/, ''), note: notes[path] }],
    load: () => loadAssetGeometry('bistro'),
    pose: (f) => def.pose(path === 'hold-light-on' ? 20 : f),
    local: (f) => {
      switch (path) {
        case 'pan-light-colour': return { position: G4_LANTERN.position, on: 1, tint: f >= T ? 'cool' : 'warm' };
        case 'pan-light-fade': return { position: G4_LANTERN.position, on: Math.max(0, Math.min(1, (f - (T - 8)) / 16)) };
        case 'pan-lamp-switch': return { position: f >= T ? G4_LAMP_B : G4_LANTERN.position, on: 1 };
        default: return { position: G4_LANTERN.position, on: f >= T ? 1 : 0 };
      }
    },
  }, W, H);
}

// ---- G5: product turntable ------------------------------------------------------------------------------------------------

/** Studio: a soft key (a big softbox ~ angular radius 0.07 rad), a bright neutral sky dome as the environment light, a warm fill. */
export const PRODUCT_CFG: SceneConfig = {
  id: 'sponza', // unused (AssetScene id of the shared type)
  label: 'Product turntable (Flight Helmet, CC0)',
  fov: 32, near: 0.05, far: 80,
  sun: { toLight: V3(0.55, 0.62, 0.55).normalize(), angularRadius: 0.07, irradiance: 2.0, color: [1.0, 0.97, 0.92] },
  local: { position: V3(-1.1, 0.7, 0.9), radius: 0.12, power: 1.2, color: [0.75, 0.85, 1.0] },
  sky: { zenith: [0.45, 0.52, 0.68], horizon: [0.8, 0.8, 0.78], ground: [0.28, 0.27, 0.26], glow: 1.2, intensity: 0.9 },
  ssr: { maxDistance: 3, thickness: 0.06 },
  free: { position: V3(0.9, 0.5, 1.4), target: V3(0, 0.3, 0) },
  paths: [],
  attribution: 'Flight Helmet (Microsoft), glTF-Sample-Models, CC0 1.0',
};
const TURNTABLE_DEG_PER_FRAME = 1.5;

export function productKit(W: number, H: number, frames: number) {
  const cfg = PRODUCT_CFG;
  const base = new URL('./assets/g5-flight-helmet/FlightHelmet.gltf', import.meta.url).href;
  return assetKit({
    id: 'G5', label: 'Product turntable', cfg, frames, events: [], shadow: 'sun',
    pose: () => ({ position: V3(0.62, 0.52, 0.92), target: V3(0, 0.27, 0) }),
    local: () => ({ position: cfg.local.position, on: 1 }),
    async load() {
      const gltf = await new GLTFLoader().loadAsync(base);
      const model = gltf.scene;
      // normalise: stand on y = 0, centre x/z, ~0.5 m tall
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const k = 0.5 / size.y;
      model.scale.setScalar(k);
      const box2 = new THREE.Box3().setFromObject(model);
      const c = box2.getCenter(new THREE.Vector3());
      model.position.set(-c.x, 0.03 - box2.min.y, -c.z);
      const root = new THREE.Group(); // the turntable: plinth + product rotate together about the vertical axis
      root.add(model);
      const plinth = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.03, 96), new THREE.MeshStandardMaterial({ color: 0x9d9ca0, roughness: 0.28, metalness: 0 }));
      plinth.position.y = 0.015;
      root.add(plinth);
      // static floor (a wide disc, satin) and a back sweep so the sky/ground split does not dominate the frame
      const floor = new THREE.Mesh(new THREE.CircleGeometry(60, 96), new THREE.MeshStandardMaterial({ color: 0x6f6d6a, roughness: 0.4, metalness: 0 }));
      floor.rotation.x = -Math.PI / 2;
      const meshes: THREE.Mesh[] = [];
      const mats: THREE.Material[] = [];
      let tris = 0;
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        meshes.push(m);
        const mat = m.material as THREE.MeshStandardMaterial;
        if (mat.transparent) { mat.transparent = false; mat.opacity = 1; mat.depthWrite = true; } // lens: opaque
        mats.push(mat);
        tris += (m.geometry.index?.count ?? m.geometry.attributes.position.count) / 3;
      });
      floor.updateMatrixWorld(true);
      return {
        add: [root, floor],
        bvhMeshes: [floor, ...meshes],
        triangles: tris + 190,
        mover: root, moverMaterials: mats,
        setMover: (f: number) => { root.rotation.y = THREE.MathUtils.degToRad(TURNTABLE_DEG_PER_FRAME) * f; root.updateMatrixWorld(true); },
        shadingNormals: true,
        info: { model: 'FlightHelmet', degPerFrame: TURNTABLE_DEG_PER_FRAME, scale: k, triangles: tris },
      };
    },
  }, W, H);
}

