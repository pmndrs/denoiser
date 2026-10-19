// Box-projected reflection probes for three r186 (WebGPU), a stand-in for three.js PR #35046.
//
// Same API and method as Ben Houston's ReflectionProbes (examples/jsm/lighting/ReflectionProbes.js
// in that PR): `ReflectionProbe` volumes (influence box, optional projection box, blend distance)
// inside a `ReflectionProbes` group, baked into ONE texture (one cube per probe, smallest volume
// first, then `scene.environment`), sampled by `reflectionProbes( probes )` installed as
// `scene.environmentNode`, so every physical material picks the probes up with its own roughness,
// normal and clearcoat.
//
// What r186 forces to differ (see ReflectionProbesNode.ts for the lookup side):
//   - r186 can't bind `texture_cube_array` (three #35045 / #35053 came after it), so the cubes live
//     in a 2D array texture, layer = probe * 6 + face, mip = roughness level. Same layers and mips
//     as #35046's CubeArrayTexture (with 'warp', texel centres differ); the node picks face and uv
//     itself instead of the sampler.
//   - r186's PMREMGenerator writes the old CubeUV atlas, not r187's cube mips, so the prefilter is
//     our own compute pass with r187's algorithm (prefilter.ts).
//   - `seamFix` (new): a manual face lookup has no seamless cube filtering. 'none' clamps at face
//     edges: measured against the hardware cube sampler on the same bake, the probe radiance is off
//     by up to 5-14 % (p99 4-6 %) in half-texel bands along the edges at roughness >= 0.5 (faces
//     of 8-16 px), which shows as a faint crease after tone mapping (1-3 / 255). 'warp' (default)
//     bakes and samples with edge-centred texels, so neighbouring faces agree at their edges: the
//     bands go away; cost ~0.06 ms per 1080p frame for 3 probes (two bilinear samples instead of
//     one trilinear), nothing in the bake.
//
//   - `originOffset` (new, per probe): captures from a point other than the volumes' centre.
//   - `bake( ..., { environment: false } )` (new): skip the environment slot.
//
// Swapping to #35046 once it lands: import ReflectionProbe / ReflectionProbes / reflectionProbes
// from three/addons instead, drop `seamFix` / `bakedSeamFix`, and move any probe with an
// `originOffset` to its box centre (or keep that one extension); `texture` becomes a CubeArrayTexture
// (nothing outside the node should sample it directly). Everything else (constructor, influenceSize,
// projectionSize, blendDistance, boxProjection, bake( renderer, scene, { resolution, near, far } ),
// texture, bakedProbes, capturing, dispose) has the same name and meaning.

import * as THREE from 'three/webgpu';
import { ProbePrefilter, maxLodFor } from './prefilter';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Renderer = THREE.WebGPURenderer & { backend: any };

const _position = new THREE.Vector3();
const _size = new THREE.Vector3();
const _clear = new THREE.Color();

/**
 * A local reflection volume. Add it to a {@link ReflectionProbes} container. The volumes are
 * axis-aligned boxes centred on the probe; they follow its world position and scale, rotation is
 * ignored.
 */
export class ReflectionProbe extends THREE.Object3D {
  readonly isReflectionProbe = true;
  /** Size of the influence volume. Surfaces inside it use this probe. */
  readonly influenceSize: THREE.Vector3;
  /** Size of the box reflections are projected onto, usually the room's walls. `null` uses `influenceSize`. */
  projectionSize: THREE.Vector3 | null = null;
  /** Distance over which the influence fades in from the volume's faces. */
  blendDistance = 0.5;
  /**
   * Where the probe captures from, relative to the centre of its volumes (not in #35046; Godot's
   * `origin_offset`). Default zero: capture from the centre. Box projection still uses the volumes
   * as placed, so a room's box can stay on its walls while the capture point moves to where it
   * sees the most of the room. Scaled with the probe like the volume sizes; rotation is ignored.
   */
  readonly originOffset = new THREE.Vector3();

  constructor(width = 1, height = 1, depth = 1) {
    super();
    (this as { type: string }).type = 'ReflectionProbe';
    this.influenceSize = new THREE.Vector3(width, height, depth);
  }

  copy(source: this, recursive?: boolean) {
    super.copy(source, recursive);
    this.influenceSize.copy(source.influenceSize);
    this.projectionSize = source.projectionSize === null ? null : source.projectionSize.clone();
    this.blendDistance = source.blendDistance;
    this.originOffset.copy(source.originOffset);
    return this;
  }
}

export interface BakeOptions {
  /** Cube face size, a power of two from 64. Default 128. */
  resolution?: number;
  /** Near plane of the capture camera. Default 0.1. */
  near?: number;
  /** Far plane of the capture camera. Default 100. */
  far?: number;
  /**
   * Whether to capture `scene.environment` into the fallback slot. Default true. Pass false when the
   * probes' influence covers every surface that samples them: the slot then stays black and the
   * bake skips its six faces and prefilter. (Not in #35046.)
   */
  environment?: boolean;
}

export type SeamFix = 'warp' | 'none';

/**
 * A set of {@link ReflectionProbe} children baked into one texture. Assign
 * `reflectionProbes( probes )` to `scene.environmentNode`. Smaller volumes take priority over
 * larger ones; uncovered surfaces fall back to `scene.environment`. WebGPU backend only.
 */
export class ReflectionProbes extends THREE.Object3D {
  readonly isReflectionProbes = true;
  /** Whether the probes use box projection. */
  boxProjection = true;
  /** Face-edge handling of the manual cube lookup (not in #35046, see the file header). Re-bake after changing it. */
  seamFix: SeamFix = 'warp';
  /** The baked 2D array texture: 6 layers per probe, then 6 for the environment; mips = roughness. */
  texture: THREE.Texture | null = null;
  /** The probes in baked order, smallest volume first. */
  bakedProbes: ReflectionProbe[] = [];
  /** The seam fix the current `texture` was baked with (the node samples to match). */
  bakedSeamFix: SeamFix = 'warp';
  /** Whether a bake is in progress. Probes then contribute only the environment. */
  capturing = false;

  private renderTarget: THREE.RenderTarget | null = null;
  private cubeTarget: THREE.CubeRenderTarget | null = null;
  private cubeCamera: THREE.CubeCamera | null = null;
  private prefilter: ProbePrefilter | null = null;
  private readonly environment = new THREE.Scene();
  private environmentBaked = false;

  constructor() {
    super();
    (this as { type: string }).type = 'ReflectionProbes';
  }

  /**
   * Captures every probe and `scene.environment` into the array. Hide helpers and objects that
   * should not appear in reflections first. Reuses the array, the capture cube and the prefilter
   * between bakes of the same layout, so re-baking every frame neither allocates nor changes the
   * texture materials sample.
   */
  bake(renderer: THREE.WebGPURenderer, scene: THREE.Scene, options: BakeOptions = {}) {
    const r = renderer as Renderer;
    if (r.backend.isWebGPUBackend !== true) throw new Error('ReflectionProbes: .bake() requires the WebGPU backend.');
    const { resolution = 128, near = 0.1, far = 100, environment: captureEnvironment = true } = options;
    if (!Number.isInteger(Math.log2(resolution)) || resolution < 64) throw new Error('ReflectionProbes: resolution must be a power of two from 64.');

    this.updateWorldMatrix(true, true);
    const probes = (this.children.filter((c) => (c as ReflectionProbe).isReflectionProbe) as ReflectionProbe[]).sort((a, b) => volume(a) - volume(b));
    const maxLod = maxLodFor(resolution);
    const depth = (probes.length + 1) * 6;
    const warp = this.seamFix === 'warp';

    let renderTarget = this.renderTarget;
    let previous: THREE.RenderTarget | null = null;
    if (renderTarget === null || renderTarget.width !== resolution || renderTarget.depth !== depth) {
      // materials keep sampling the previous array while the probes are captured
      previous = renderTarget;
      renderTarget = new THREE.RenderTarget(resolution, resolution, {
        depth, type: THREE.HalfFloatType, depthBuffer: false, generateMipmaps: false,
        minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
      });
      renderTarget.texture.name = 'ReflectionProbes';
      for (let lod = 0; lod <= maxLod; lod++) renderTarget.texture.mipmaps.push({ width: resolution >> lod, height: resolution >> lod } as never);
      r.initRenderTarget(renderTarget);
    }
    if (this.cubeTarget === null || this.cubeTarget.width !== resolution) {
      this.cubeTarget?.dispose();
      this.cubeTarget = new THREE.CubeRenderTarget(resolution, { type: THREE.HalfFloatType, generateMipmaps: false });
      this.cubeCamera = new THREE.CubeCamera(near, far, this.cubeTarget);
    }
    if (this.prefilter === null || this.prefilter.size !== resolution || this.prefilter.warp !== warp) {
      this.prefilter?.dispose();
      this.prefilter = new ProbePrefilter(r.backend.device, resolution, warp);
    }

    const cubeCamera = this.cubeCamera!;
    for (const cam of cubeCamera.children as THREE.PerspectiveCamera[]) {
      if (cam.near !== near || cam.far !== far) { cam.near = near; cam.far = far; cam.updateProjectionMatrix(); }
    }
    const environment = this.environment;
    environment.background = scene.environment;

    // clear every captured face, whatever the application's clear settings
    const { autoClear, autoClearColor, autoClearDepth, autoClearStencil } = r;
    const background = scene.background;
    r.autoClear = r.autoClearColor = r.autoClearDepth = r.autoClearStencil = true;
    if (background === null) scene.background = r.getClearColor(_clear).clone();

    this.capturing = true;
    try {
      // unfilled slots stay black, so an empty environment needs no capture
      const count = scene.environment !== null && captureEnvironment ? probes.length + 1 : probes.length;
      const device: GPUDevice = r.backend.device;
      // ...but a reused array still holds the last bake's environment: clear that slot
      if (count === probes.length && renderTarget === this.renderTarget && this.environmentBaked) {
        clearSlot(device, r.backend.get(renderTarget.texture).texture, probes.length);
      }
      this.environmentBaked = count > probes.length;
      for (let i = 0; i < count; i++) {
        const probe = probes[i];
        cubeCamera.position.copy(probe !== undefined ? probeOrigin(probe, _position) : _position.set(0, 0, 0));
        cubeCamera.updateMatrixWorld(true);
        cubeCamera.update(r, probe !== undefined ? scene : environment);
        // three submitted the six face renders; the prefilter goes after them on the same queue
        const encoder = device.createCommandEncoder({ label: 'ReflectionProbes.bake' });
        this.prefilter.encode(encoder, r.backend.get(this.cubeTarget.texture).texture, r.backend.get(renderTarget.texture).texture, i);
        device.queue.submit([encoder.finish()]);
      }
    } finally {
      this.capturing = false;
      scene.background = background;
      Object.assign(r, { autoClear, autoClearColor, autoClearDepth, autoClearStencil });
    }

    previous?.dispose();
    this.renderTarget = renderTarget;
    this.texture = renderTarget.texture;
    this.bakedProbes = probes;
    this.bakedSeamFix = this.seamFix;
  }

  /** Frees the GPU resources allocated by this instance. */
  dispose() {
    this.renderTarget?.dispose();
    this.cubeTarget?.dispose();
    this.prefilter?.dispose();
    this.renderTarget = this.cubeTarget = this.cubeCamera = this.prefilter = null;
    this.texture = null;
  }
}

/** Clears the six layers of slot `slot`, every mip, to black. */
function clearSlot(device: GPUDevice, texture: GPUTexture, slot: number) {
  const encoder = device.createCommandEncoder({ label: 'ReflectionProbes.clear' });
  for (let mip = 0; mip < texture.mipLevelCount; mip++) for (let face = 0; face < 6; face++) {
    const view = texture.createView({ dimension: '2d', baseMipLevel: mip, mipLevelCount: 1, baseArrayLayer: slot * 6 + face, arrayLayerCount: 1 });
    encoder.beginRenderPass({ colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] }).end();
  }
  device.queue.submit([encoder.finish()]);
}

/** World-space capture point of a probe: its position plus its scaled `originOffset`. */
export function probeOrigin(probe: ReflectionProbe, target: THREE.Vector3) {
  probe.getWorldScale(_size).multiply(probe.originOffset);
  return probe.getWorldPosition(target).add(_size);
}

function volume(probe: ReflectionProbe) {
  probe.getWorldScale(_size).multiply(probe.influenceSize);
  return _size.x * _size.y * _size.z;
}
