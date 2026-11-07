// Types shared by the golden engine (engine.ts) and the scene kits (kits.ts). Contract: ../../GOLDEN.md.
import type * as THREE from 'three/webgpu';
import type { ShadowLight } from 'denoiser/realtime';
import type { GoldenEvent } from './registry';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type N = any; // TSL's node typings are too strict for hand-written shader maths

/** The G-buffer pieces the kits need to build their rays (engine.ts builds it from the scene pass). */
export interface GBuf {
  s0: { P: N; N: N; sky: N; viewDist: N; depth: N };
  eps: N;
  pixelSeed(): N;
}

export interface RaySetup {
  /** blue-noise spatiotemporal xi(dim) */
  xi: (dim: number) => N;
  /** uint node: seed of the white-noise references (changes per accumulation sub-frame) */
  seed: N;
  /** uniform 1 while a capture pose is held and the 1-ray signals can be skipped */
  hold: N;
  difRays: number;
  visGrid: number;
  aoA: number;
  aoB: number;
}

/** What a kit builds on top of the G-buffer. */
export interface KitSignals {
  /** one blue-noise diffuse ray: vec4(radiance rgb, hit distance; 0 = miss) */
  diffuse1: N;
  /** one blue-noise shadow ray: vec4(visibility, occluder distance, 0, 1) */
  shadow1: N;
  /** mean of `visGrid^2` stratified white-noise shadow rays: vec4(visibility, sum of blocked distances / grid^2, 0, 1) */
  shadowRef: N;
  /** mean of `difRays` white-noise cosine rays: vec4(radiance rgb, AO) */
  diffuseRef: N;
  /** noise-free direct irradiance of every light given the shadow light's visibility (a float node) */
  direct(vis: N): N;
  /** world-space direction of the diffuse ray (SH payload), built on first use */
  direction(): N;
}

export interface Kit {
  id: string;
  label: string;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  env: THREE.Texture;
  envI: number;
  ssr: { maxDistance: number; thickness: number };
  frames: number;
  events: GoldenEvent[];
  /** Materials of the moving object (their pixels get the mover flag), or [] */
  moverMaterials: THREE.Material[];
  /** The moving object's root (its matrixWorld gives the rigid motion), or null */
  mover: THREE.Object3D | null;
  /** MRT `normal` attachment: the shading (normal-mapped) normal instead of the vertex normal */
  shadingNormals: boolean;
  triangles: number;
  info: Record<string, unknown>;
  buildSignals(g: GBuf, r: RaySetup): KitSignals;
  /** Poses the camera, the mover, the lights for path frame f and updates the BVH transforms. */
  setFrame(f: number): void;
  /** Light handed to the shadow denoiser at the current frame. */
  light(): ShadowLight;
  /** `lights` of a CAPTURE-FORMAT frame at the current frame. */
  captureLights(): Record<string, unknown>[];
  dispose?(): void;
}
