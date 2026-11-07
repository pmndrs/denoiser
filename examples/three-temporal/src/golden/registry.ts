// The golden-scene registry (pure data, no three.js: the Node driver and docs read it too). Contract: ../../GOLDEN.md.
// Kits (kits.ts) build the three.js side of each entry; paths are pure functions of the path frame.

export type GoldenId = 'G1' | 'G2' | 'G3' | 'G4' | 'G5';
export type Mode = 'run' | 'perfect' | 'reference' | 'capture';
export const MODES: Mode[] = ['run', 'perfect', 'reference', 'capture'];
/** Denoised signals a scene has. `lit` / `display` are composites, guides are listed in GUIDES. */
export type Signal = 'diffuse' | 'specular' | 'shadow' | 'ao';
export const SIGNALS: Signal[] = ['diffuse', 'specular', 'shadow', 'ao'];
export const SIGNAL_CHANNELS: Record<string, number> = {
  diffuse: 3, specular: 3, shadow: 1, ao: 1, lit: 3, display: 3,
  depth: 1, viewz: 1, normal: 3, normal_geom: 3, roughness: 1, motion: 2, motion_z: 1, albedo: 3, f0: 3, mask_mover: 1,
};
export const GUIDES = ['depth', 'viewz', 'normal', 'normal_geom', 'roughness', 'motion', 'motion_z', 'albedo', 'f0', 'mask_mover'] as const;
export const KINDS = ['input', 'noisy', 'output', 'reference'] as const;
export type Kind = (typeof KINDS)[number];

export interface GoldenEvent { frame: number; type: string; note: string }
export interface PathInfo {
  name: string;
  frames: number;
  description: string;
  events: GoldenEvent[];
  /** Engine-level path id inside the existing scene code (src/realtime/path.ts, scenes.ts). */
  source: string;
  /** What the moving parts of this path are. */
  motion: string;
}
export interface SceneInfo {
  id: GoldenId;
  name: string;
  label: string;
  judges: string;
  /** 'engine': the golden engine renders it; 'external': a separate page owned by another track. */
  kind: 'engine' | 'external';
  signals: Signal[];
  paths: PathInfo[];
  /** Models and licences used. */
  assets: { name: string; licence: string; note: string }[];
  /** Limits of the perfect / reference / capture modes on this scene. */
  limits: string[];
  externalPage?: string;
}

export const SCENE_REGISTRY: SceneInfo[] = [
  {
    id: 'G1', name: 'reflection-bench', label: 'Reflection bench (Ben\'s camera model, normal-mapped metal, traced + hybrid)',
    judges: 'specular', kind: 'external', signals: ['specular'], paths: [], assets: [
      { name: 'steampunk camera (three.js examples, bhouston)', licence: 'see examples/three-temporal/src/reflect-bench/README.md', note: 'fetched by three-examples-plugin.ts' },
    ],
    limits: ['owned by track R (`reflect-bench.html`); registered here, rendered by its own page, not by the golden engine'],
    externalPage: 'reflect-bench.html',
  },
  {
    id: 'G2', name: 'knot-floor', label: 'The knot over a floor, area light, moving occluder',
    judges: 'shadows', kind: 'engine', signals: ['shadow', 'diffuse', 'specular', 'ao'],
    paths: [
      {
        name: 'occluder', frames: 64, source: 'knot-static',
        description: 'static close-up camera on the torus knot, its pedestal and its shadow on the back wall and floor; the knot rotates 0.35/60 rad per frame about its tilted axis, so its soft shadow sweeps static receivers',
        events: [], motion: 'torus knot rotates (object motion); receivers of its shadow are static',
      },
      {
        name: 'orbit', frames: 64, source: 'knot-orbit',
        description: 'frames 0-39 slow orbit around the wide shot (0.46 deg/frame, dolly in), 40-63 fast pan (6 cm/frame slide + 1.6 deg/frame yaw); the knot rotates the whole time',
        events: [], motion: 'camera orbit + pan; torus knot rotates',
      },
    ],
    assets: [{ name: 'procedural furnished corner (shadows.ts scene)', licence: 'MIT (this repository)', note: 'no external assets' }],
    limits: [
      'perfect: converged visibility, diffuse, AO and SSR specular (the knot floor is glossy: roughness 0.12)',
      'specular reference is three SSR\'s own expectation (misses and biases included), as in all earlier captures',
    ],
  },
  {
    id: 'G3', name: 'sponza-orbit', label: 'Sponza orbit',
    judges: 'diffuse GI + AO', kind: 'engine', signals: ['diffuse', 'ao', 'shadow', 'specular'],
    paths: [
      { name: 'orbit', frames: 64, source: 'sponza-orbit', description: 'slow arc in the nave around its centre, dollying in (~5-8 px/frame at 960 px); the sun is the shadow light', events: [], motion: 'camera only' },
      { name: 'pan', frames: 64, source: 'sponza-pan', description: '8 frames of drift, then 6 cm/frame slide + 2 deg/frame yaw toward the south arcade (disocclusion behind the columns every frame)', events: [], motion: 'camera only' },
    ],
    assets: [{ name: 'Crytek Sponza (Khronos glTF-Sample-Assets), geometry only', licence: 'Cryengine Limited License Agreement (model files)', note: 'scene-assets/NOTICE.md; Git LFS, not redistributed; $RT_SCENE_ASSETS' }],
    limits: ['geometry only (flat colours per material): no textures, no normal maps', 'diffuse GI is one bounce off a grey 0.5 surface with a sun shadow ray (src/realtime/rays.ts)'],
  },
  {
    id: 'G4', name: 'bistro-pan-light', label: 'Bistro pan with a light switching on',
    judges: 'diffuse, light-change lag', kind: 'engine', signals: ['diffuse', 'ao', 'shadow', 'specular'],
    paths: [
      {
        name: 'pan-light-on', frames: 64, source: 'bistro-pan',
        description: 'bistro-pan (8 frames of drift at the junction, then 4-6 cm/frame slide + 2.2 deg/frame yaw) with a street lantern that is OFF until frame 32 and switches ON as a step change (power 0 -> 60)',
        events: [{ frame: 32, type: 'light-on', note: 'lantern (sphere, r 0.12 m) at (-2.5, 2.4, -9.5) switches on: every lit surface near it changes at once' }],
        motion: 'camera only; the light is static, its switch is the event',
      },
    ],
    assets: [{ name: 'Amazon Lumberyard Bistro exterior (ORCA, glTF by Cody Bennett), geometry only', licence: 'CC BY 4.0', note: 'scene-assets/NOTICE.md; Git LFS; $RT_SCENE_ASSETS' }],
    limits: ['geometry only (flat colours): no textures', 'the light switch is an instant step in the references too (each frame is converged for its own lighting)'],
  },
  {
    id: 'G5', name: 'product-turntable', label: 'Product turntable (Flight Helmet: glossy + rough metal/dielectric, normal maps, environment light)',
    judges: 'specular + diffuse', kind: 'engine', signals: ['specular', 'diffuse', 'shadow', 'ao'],
    paths: [
      { name: 'turntable', frames: 64, source: 'turntable', description: 'static 3/4 camera; the product and its plinth rotate 1.5 deg/frame about the vertical axis (96 deg over the path); studio environment + a soft key', events: [], motion: 'product rotates (object motion); floor, camera and lights static' },
    ],
    assets: [{ name: 'Flight Helmet (Microsoft, via Khronos glTF-Sample-Models)', licence: 'CC0 1.0', note: 'src/golden/assets/g5-flight-helmet/NOTICE.md; textures downscaled to 1024 px JPEG' }],
    limits: [
      'specular is three\'s stochastic SSR with environment importance sampling: reflections of the environment (the dominant term here) are exact in expectation, screen-space hits are SSR\'s',
      'the shading normal (normal-mapped) is the denoiser guide; `normal_geom` (vertex normal) is exported for v1 captures',
      'the lens material is forced opaque',
    ],
  },
];

export const sceneById = (id: string) => SCENE_REGISTRY.find((s) => s.id === id || s.name === id);
export const pathOfScene = (s: SceneInfo, name?: string | null) => (name ? s.paths.find((p) => p.name === name) : s.paths[0]);
