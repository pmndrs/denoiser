// Lights, sky and scripted paths of the third-party scenes (?scene=sponza | bistro) on the realtime pages
// (src/realtime-scenes.ts; models loaded by ./assets.ts; captures in CAPTURES.md "Bistro and Sponza").
//
// Each scene has a sun (a directional light with an angular radius, larger than the real sun's 0.0047 rad so the
// penumbrae are a few to tens of pixels wide at these distances) and one local sphere light. A path names which
// of the two is the shadow light (the `visibility` signal and the capture's `lights[0]`); the other one still
// lights the diffuse bounce and the composite. Paths are pure functions of the path frame (like ./path.ts):
//
//   sponza-orbit  slow arc in the nave around its centre, looking at it (~5-8 px/frame)
//   sponza-pan    8 frames of drift, then a fast pan: 6 cm/frame slide + 2 deg/frame yaw toward the south arcade
//                 (disocclusion behind the columns every frame)
//   sponza-move   static camera on the sunlit nave floor; a torus knot swings and spins through the sun shaft
//                 (moving occluder, object motion; its shadow sweeps static receivers)
//   bistro-orbit  street orbit: the camera walks 5 cm/frame down the north street keeping a fixed point in view
//   bistro-pan    8 frames of drift at the junction, then 6 cm/frame slide + 2.2 deg/frame yaw
//   bistro-hold   bistro-orbit's last pose held still (long-hold tests, review target D)
//   bistro-move   static camera in the street at dusk; the shadow light is a lantern that moves 7 cm/frame
//                 along the street (moving light: every shadow it casts moves over static receivers)
import * as THREE from 'three/webgpu';
import type { AssetScene } from './assets';

export interface Sun { toLight: THREE.Vector3; angularRadius: number; irradiance: number; color: [number, number, number] }
export interface LocalLight { position: THREE.Vector3; radius: number; power: number; color: [number, number, number] }
export interface Sky { zenith: [number, number, number]; horizon: [number, number, number]; ground: [number, number, number]; glow: number; intensity: number }
export interface PathPose { position: THREE.Vector3; target: THREE.Vector3 }
export interface ScenePath {
  name: string;
  frames: number;
  /** Which light is the shadow light (visibility signal, capture lights[0]). */
  shadow: 'sun' | 'local';
  description: string;
  pose(f: number): PathPose;
  /** World matrix of the moving object at frame f (scenes with a mover), else undefined (mover hidden). */
  mover?(f: number): THREE.Matrix4;
  /** Local light position at frame f (moving light), else the scene's fixed one. */
  local?(f: number): THREE.Vector3;
}
export interface SceneConfig {
  id: AssetScene;
  label: string;
  fov: number; near: number; far: number;
  sun: Sun;
  local: LocalLight;
  sky: Sky;
  ssr: { maxDistance: number; thickness: number };
  /** Free-running page camera (no ?path): a slow orbit around this. */
  free: PathPose;
  paths: ScenePath[];
  mover?: { geometry: () => THREE.BufferGeometry; color: number; roughness: number; metalness: number };
  attribution: string;
}

const dir = (elevDeg: number, azDeg: number) => {
  const e = THREE.MathUtils.degToRad(elevDeg), a = THREE.MathUtils.degToRad(azDeg);
  return new THREE.Vector3(Math.cos(e) * Math.cos(a), Math.sin(e), Math.cos(e) * Math.sin(a));
};
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const clampF = (f: number, n: number) => Math.max(0, Math.min(n - 1, f));

/** Fast pan helper: drift `pre` frames along `drift`, then slide along `slide` while yawing `yawDeg` per frame. */
function panPath(p0: THREE.Vector3, look0: THREE.Vector3, drift: THREE.Vector3, slide: THREE.Vector3, yawDeg: number, pre: number, n: number) {
  return (f: number): PathPose => {
    const fc = clampF(f, n);
    const d0 = look0.clone().sub(p0).normalize();
    if (fc < pre) { const p = p0.clone().addScaledVector(drift, fc); return { position: p, target: p.clone().add(d0) }; }
    const k = fc - pre;
    const p = p0.clone().addScaledVector(drift, pre).addScaledVector(slide, k);
    const d = d0.clone().applyAxisAngle(V(0, 1, 0), THREE.MathUtils.degToRad(yawDeg) * k);
    return { position: p, target: p.clone().add(d) };
  };
}

// ---- Sponza (Crytek, Khronos glTF-Sample-Assets): nave along X (x -15.4..14.4, z -9.5..8.8, y to 11.4),
//      sky only through the roof opening over the nave; floor at y = 0.
const SPONZA_T = V(0, 2.2, -0.25);
const SPONZA: SceneConfig = {
  id: 'sponza',
  label: 'Sponza (Crytek, geometry only)',
  fov: 55, near: 0.1, far: 60,
  // sun high over the nave (light from +X, a little +Z): a lit strip on the nave floor and the north arcade, the
  // rest of the atrium lit by the bounce. Angular radius 0.02 rad (4.3x the sun).
  sun: { toLight: dir(62, 12), angularRadius: 0.02, irradiance: 6, color: [1.0, 0.95, 0.86] },
  // a warm lamp in the south aisle (static)
  local: { position: V(-7.0, 2.3, 3.6), radius: 0.15, power: 5, color: [1.0, 0.72, 0.45] },
  sky: { zenith: [0.32, 0.47, 0.78], horizon: [0.72, 0.76, 0.82], ground: [0.22, 0.2, 0.17], glow: 1.5, intensity: 0.6 },
  ssr: { maxDistance: 12, thickness: 0.15 },
  free: { position: V(8, 1.7, -0.25), target: V(0, 2.5, -0.25) },
  paths: [
    {
      name: 'sponza-orbit', frames: 64, shadow: 'sun',
      description: 'sponza-orbit: arc around the nave centre (0, 2.2, -0.25): angle -0.35 + 0.012 rad/frame on an ellipse 7.0 m (x) by 1.8 m (z) at 1.7 m, dollying in 2 cm/frame; sun is the shadow light',
      pose: (f) => { const fc = clampF(f, 64); const a = -0.35 + 0.012 * fc; const r = 7.0 - 0.02 * fc; return { position: V(SPONZA_T.x + r * Math.cos(a), 1.7, SPONZA_T.z + 1.8 * Math.sin(a)), target: SPONZA_T.clone() }; },
    },
    {
      name: 'sponza-pan', frames: 64, shadow: 'sun',
      description: 'sponza-pan: from (7, 1.7, -0.6) looking down the nave, 8 frames of 3 cm/frame drift, then 6 cm/frame slide along -X and 2 deg/frame yaw toward the south arcade; sun is the shadow light',
      pose: panPath(V(7, 1.7, -0.6), V(-5, 2.0, -0.4), V(-0.03, 0, 0), V(-0.06, 0, 0), -2.0, 8, 64),
    },
    {
      name: 'sponza-move', frames: 64, shadow: 'sun',
      description: 'sponza-move: static camera on the sunlit nave floor; a torus knot (R 0.45 m) swings 1.6 m along X (period 64 frames) at 2.4 m and spins 0.05 rad/frame in the sun shaft (object motion); sun is the shadow light',
      pose: () => ({ position: V(3.5, 2.6, -0.4), target: V(-4.5, 0.4, -0.2) }),
      mover: (f) => {
        const fc = clampF(f, 64);
        const m = new THREE.Matrix4().compose(V(-3.4 + 1.6 * Math.sin((2 * Math.PI * fc) / 64), 2.4, -0.25),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0.4, 0.05 * fc, 0.2)), V(1, 1, 1));
        return m;
      },
    },
  ],
  mover: { geometry: () => new THREE.TorusKnotGeometry(0.45, 0.13, 160, 20), color: 0xc9a46a, roughness: 0.3, metalness: 0 },
  attribution: 'Sponza (c) 2016 Crytek, improved model by Frank Meinl after Marko Dabrovic\'s original, glTF by Khronos (glTF-Sample-Assets); Cryengine Limited License Agreement; geometry only, not redistributed',
};

// ---- Bistro exterior (Amazon Lumberyard, ORCA, CC BY 4.0): metres, Y up, street floor at y = 0. North street from
//      (13.5, -36.5) south-south-west to a Y junction near (-8, -5) (layout notes: vsm docs/specs/scenes.md S5).
/** bistro-orbit's camera: walks 5 cm/frame from (12.8, 1.8, -34.5) toward (5.4, 1.8, -21.2) looking at (4.0, 2.0, -14.0). */
function bistroOrbitPose(f: number): PathPose {
  const fc = clampF(f, 64);
  const a = V(12.8, 1.8, -34.5), b = V(5.4, 1.8, -21.2);
  return { position: a.clone().lerp(b, (0.05 * fc) / a.distanceTo(b)), target: V(4.0, 2.0, -14.0) };
}
const BISTRO: SceneConfig = {
  id: 'bistro',
  label: 'Bistro exterior (Amazon Lumberyard, geometry only)',
  fov: 55, near: 0.1, far: 200,
  // late afternoon: low warm sun from behind the north street's start, shining down the street: façade shadow edges on
  // both sides of the street floor and long bollard shadows. Angular radius 0.02 rad.
  sun: { toLight: dir(45, 285), angularRadius: 0.02, irradiance: 4.5, color: [1.0, 0.82, 0.62] },
  // a street lantern (static on orbit / pan; it moves on bistro-move)
  local: { position: V(6.2, 2.6, -24.0), radius: 0.12, power: 6, color: [1.0, 0.8, 0.55] },
  sky: { zenith: [0.22, 0.32, 0.58], horizon: [0.85, 0.62, 0.45], ground: [0.16, 0.14, 0.12], glow: 2.5, intensity: 0.5 },
  ssr: { maxDistance: 20, thickness: 0.25 },
  free: { position: V(12.5, 1.7, -33.0), target: V(4.5, 1.5, -19.5) },
  paths: [
    {
      name: 'bistro-orbit', frames: 64, shadow: 'sun',
      description: 'bistro-orbit: street orbit: the camera walks 5 cm/frame from (12.8, 1.8, -34.5) down the north street toward (5.4, 1.8, -21.2) keeping (4.0, 2.0, -14.0) in view; sun is the shadow light',
      pose: (f) => bistroOrbitPose(f),
    },
    {
      // review target D (results/DISTANCE-LONG.md): a still view for long holds, looped by tools/rt-capture/loop-capture.mjs;
      // captured from path frame 48 on, so it continues bistro-orbit's blue-noise index and can follow its 48 frames
      name: 'bistro-hold', frames: 96, shadow: 'sun',
      description: 'bistro-hold: bistro-orbit\'s frame-47 pose held still (camera, sun and lantern static); frames 48+ continue bistro-orbit (same final view after the walk)',
      pose: () => bistroOrbitPose(47),
    },
    {
      name: 'bistro-pan', frames: 64, shadow: 'sun',
      description: 'bistro-pan: at the junction, from (1.0, 1.7, -13.0) looking south-west, 8 frames of 3 cm/frame drift, then 6 cm/frame slide and 2.2 deg/frame yaw to the left; sun is the shadow light',
      pose: panPath(V(1.0, 1.7, -13.0), V(-10, 1.5, -2.0), V(-0.02, 0, 0.02), V(-0.04, 0, 0.045), 2.2, 8, 64),
    },
    {
      name: 'bistro-move', frames: 64, shadow: 'local',
      description: 'bistro-move: static camera in the north street at dusk; the shadow light is a lantern (sphere, r 0.12 m) at 2.4 m that moves 7 cm/frame along the street from (11.5, 2.4, -31.0) toward (5.0, 2.4, -20.0) (moving light; static receivers)',
      pose: () => ({ position: V(13.2, 2.0, -35.5), target: V(6.0, 1.0, -22.0) }),
      local: (f) => { const fc = clampF(f, 64); const a = V(11.5, 2.4, -31.0), b = V(5.0, 2.4, -20.0); return a.clone().lerp(b, (0.07 * fc) / a.distanceTo(b)); },
    },
  ],
  attribution: 'Amazon Lumberyard Bistro, Open Research Content Archive (ORCA), Amazon Lumberyard, 2017, http://developer.nvidia.com/orca/amazon-lumberyard-bistro, CC BY 4.0; glTF conversion by Cody Bennett; modified: geometry only (no textures), flat colours, BLEND decal removed',
};

export const SCENES: Record<AssetScene, SceneConfig> = { sponza: SPONZA, bistro: BISTRO };
export const assetScene = (v: string | null): AssetScene | undefined => (v === 'sponza' || v === 'bistro' ? v : undefined);

/** Sky radiance (before `sky.intensity`), JS (SSR's equirect environment). */
export function skyRadiance(c: SceneConfig, d: THREE.Vector3): [number, number, number] {
  const { zenith: z, horizon: h, ground: g, glow } = c.sky;
  if (d.y < 0) { const k = 1 - 0.5 * Math.min(1, -d.y * 3); return [g[0] * k, g[1] * k, g[2] * k]; }
  const t = Math.sqrt(d.y);
  const s = Math.max(0, d.dot(c.sun.toLight)) ** 8 * glow;
  return [0, 1, 2].map((i) => h[i] + (z[i] - h[i]) * t + s * c.sun.color[i]) as [number, number, number];
}

/** The same sky as WGSL (`fn skyRadiance(d: vec3f) -> vec3f`). */
export function skyRadianceWgsl(c: SceneConfig): string {
  const f = (v: number) => v.toFixed(6);
  const v3 = (a: readonly number[]) => `vec3f( ${a.map(f).join(', ')} )`;
  const L = c.sun.toLight;
  return /* wgsl */ `
    fn skyRadiance( d: vec3f ) -> vec3f {
      if ( d.y < 0.0 ) { return ${v3(c.sky.ground)} * ( 1.0 - 0.5 * min( 1.0, - d.y * 3.0 ) ); }
      let s = pow( max( 0.0, dot( d, vec3f( ${f(L.x)}, ${f(L.y)}, ${f(L.z)} ) ) ), 8.0 ) * ${f(c.sky.glow)};
      return mix( ${v3(c.sky.horizon)}, ${v3(c.sky.zenith)}, sqrt( d.y ) ) + ${v3(c.sun.color)} * s;
    }`;
}

/** Equirectangular sky (CPU float data: SSR's env sampler needs it), like ./scene.ts makeEnvironment. */
export function makeSkyEnvironment(c: SceneConfig): THREE.DataTexture {
  const w = 256, h = 128;
  const data = new Float32Array(w * h * 4);
  const d = new THREE.Vector3();
  for (let y = 0; y < h; y++) {
    const phi = (y / (h - 1)) * Math.PI;
    for (let x = 0; x < w; x++) {
      const theta = (x / (w - 1)) * Math.PI * 2;
      const s = skyRadiance(c, d.set(Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta)));
      data.set([s[0], s[1], s[2], 1], (y * w + x) * 4);
    }
  }
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.FloatType);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.LinearSRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export const pathOf = (c: SceneConfig, name: string | null) => c.paths.find((p) => p.name === name);
