// Static half of the split shadow: the area light's visibility on everything that never
// moves, baked once into a lightmap and denoised with OIDN.
//
//   unwrapUVs (three.js PR #34944)  ->  uv1 atlas for the static meshes
//   bake: draw the static meshes in uv1 space, trace grid x grid rays per texel against
//         the static-only BVH, add `passes` of those into a half-float target
//   resolve: sum / count, then dilate into the chart gutters (so bilinear lookups at
//         chart edges don't pull in empty texels)
//   OIDN: denoise the atlas (Denoiser.denoiseTextures, on three's GPUDevice)
//
// Lookups: `lightmapUV(uv(1))` gives the texture coordinate of a uv1 point.
import * as THREE from 'three/webgpu';
import { float, vec2, vec4, uint, uniform, uv, positionWorld, normalWorld, screenCoordinate, texture } from 'three/tsl';
import { Denoiser } from 'denoiser';
import { getGPUTexture } from 'denoiser/three';
import type { BVHComputeData } from 'three-mesh-bvh/webgpu';
import { unwrapUVs } from '../vendor/unwrapUVs.js';
import { areaVisibilityFn } from './area';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;

/** The light, as the uniforms the main graph already has. */
export interface AreaLightUniforms { C: N; U: N; V: N; nL: N }

export interface BakeStats { rays: number; bakeMs: number; denoiseMs: number }

/** Texture coordinate of a uv1 point: the bake writes v up, render-target rows go down. */
export const lightmapUV = (uv1: N): N => vec2(uv1.x, float(1).sub(uv1.y));

/**
 * Gives the static meshes a lightmap atlas in `uv1` (replacing their geometries).
 * Call before building any BVH over them. Returns the atlas density.
 */
export function unwrapStatic(meshesRoots: THREE.Object3D[], resolution: number) {
  // unwrapUVs walks one root; the static meshes share a parent with the dynamic one
  const root = {
    updateWorldMatrix: () => { for (const o of meshesRoots) o.updateWorldMatrix(true, true); },
    traverse: (cb: (o: THREE.Object3D) => void) => { for (const o of meshesRoots) o.traverse(cb); },
  } as unknown as THREE.Object3D;
  const t0 = performance.now();
  const atlas = unwrapUVs(root, { resolution, padding: 4, mode: 'lightmap' });
  if (!atlas) throw new Error('unwrapUVs: the static charts do not fit the atlas');
  return { texelsPerUnit: atlas.texelsPerUnit, charts: atlas.charts.length, ms: performance.now() - t0 };
}

/** A `uv1` of (-1, -1) everywhere: marks a mesh as dynamic (no lightmap). */
export function markDynamic(mesh: THREE.Mesh) {
  const n = mesh.geometry.attributes.position.count;
  mesh.geometry.setAttribute('uv1', new THREE.Float32BufferAttribute(new Float32Array(n * 2).fill(-1), 2));
}

export class Lightmap {
  /** Noisy bake (sum / count, dilated). */
  readonly raw: THREE.RenderTarget;
  /** The same, denoised by OIDN. */
  readonly denoised: THREE.StorageTexture;
  private readonly acc: THREE.RenderTarget;
  private readonly ping: THREE.RenderTarget[];
  private readonly bakeScene = new THREE.Scene();
  private readonly bakeCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly uPass = uniform(0, 'uint');
  private readonly resolveQuad: THREE.QuadMesh;
  private readonly dilateQuad: THREE.QuadMesh;
  private readonly copyQuad: THREE.QuadMesh;
  private readonly dilateSrc = texture(new THREE.Texture());
  private readonly copySrc = texture(new THREE.Texture());
  private denoiser: Denoiser | null = null;

  constructor(
    private readonly renderer: THREE.WebGPURenderer,
    staticMeshes: THREE.Mesh[],
    staticBvh: BVHComputeData,
    light: AreaLightUniforms,
    readonly size: number,
    /** rays per texel per pass = grid^2 */
    private readonly grid = 4,
  ) {
    const rt = (filter: THREE.MagnificationTextureFilter) => new THREE.RenderTarget(size, size, {
      type: THREE.HalfFloatType, depthBuffer: false, minFilter: filter, magFilter: filter, generateMipmaps: false,
    });
    this.acc = rt(THREE.NearestFilter);
    this.ping = [rt(THREE.NearestFilter), rt(THREE.NearestFilter)];
    this.raw = rt(THREE.LinearFilter);
    this.denoised = new THREE.StorageTexture(size, size);
    this.denoised.type = THREE.HalfFloatType;
    this.denoised.colorSpace = THREE.LinearSRGBColorSpace;
    this.denoised.generateMipmaps = false;
    this.denoised.minFilter = this.denoised.magFilter = THREE.LinearFilter;

    // bake material: each static mesh drawn flat into its uv1 chart, one texel = one
    // surface point; the fragment traces the light from the texel's world position
    const areaVisibility = areaVisibilityFn(staticBvh);
    const mat = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide, transparent: true, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false });
    mat.vertexNode = vec4(uv(1).mul(2).sub(1), 0, 1);
    const px = screenCoordinate.xy.floor();
    const seed = uint(px.x).add(uint(px.y).mul(8191)).mul(uint(1973)).add(this.uPass.mul(26699));
    const vis = areaVisibility(positionWorld, normalWorld.normalize(), float(0), light.C, light.U, light.V, light.nL,
      float(0.003), seed, uint(grid));
    mat.colorNode = vec4(vis, vis, vis, 1); // alpha counts passes (additive)
    for (const m of staticMeshes) {
      const b = new THREE.Mesh(m.geometry, mat);
      b.matrixAutoUpdate = false;
      b.matrix.copy(m.matrixWorld);
      b.frustumCulled = false;
      this.bakeScene.add(b);
    }

    const accTex = texture(this.acc.texture);
    const resolve = new THREE.NodeMaterial();
    const a = accTex.sample(uv());
    resolve.fragmentNode = a.a.greaterThan(0).select(vec4(a.rgb.div(a.a), 1), vec4(0, 0, 0, 0)) as N;
    this.resolveQuad = new THREE.QuadMesh(resolve);

    // dilate: an empty texel takes the mean of its filled 3x3 neighbours
    const dil = new THREE.NodeMaterial();
    const texel = float(1 / size);
    let sum: N = vec4(0);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const s = this.dilateSrc.sample(uv().add(vec2(dx, dy).mul(texel)));
      sum = sum.add(vec4(s.rgb.mul(s.a), s.a));
    }
    const c = this.dilateSrc.sample(uv());
    dil.fragmentNode = c.a.greaterThan(0).select(c, sum.a.greaterThan(0).select(vec4(sum.rgb.div(sum.a), 1), vec4(0))) as N;
    this.dilateQuad = new THREE.QuadMesh(dil);

    const copy = new THREE.NodeMaterial();
    copy.fragmentNode = this.copySrc.sample(uv()) as N;
    this.copyQuad = new THREE.QuadMesh(copy);
  }

  /** Bakes `passes` x grid^2 rays per texel, then denoises. Re-run when the light changes. */
  async bake(passes = 1, denoise = true): Promise<BakeStats> {
    const r = this.renderer;
    const state = THREE.RendererUtils.resetRendererState(r, undefined as N);
    const t0 = performance.now();
    r.setRenderTarget(this.acc);
    r.setClearColor(0x000000, 0);
    r.clear();
    r.autoClear = false;
    for (let p = 0; p < passes; p++) {
      this.uPass.value = p;
      r.render(this.bakeScene, this.bakeCam);
    }
    r.setRenderTarget(this.ping[0]);
    this.resolveQuad.render(r);
    let read = 0;
    for (let i = 0; i < 6; i++) { // padding is 4 texels; 6 rounds also closes sub-texel slivers
      this.dilateSrc.value = this.ping[read].texture;
      r.setRenderTarget(this.ping[1 - read]);
      this.dilateQuad.render(r);
      read = 1 - read;
    }
    this.copySrc.value = this.ping[read].texture;
    r.setRenderTarget(this.raw);
    this.copyQuad.render(r);
    THREE.RendererUtils.restoreRendererState(r, state);
    const device = (r.backend as unknown as { device: GPUDevice }).device;
    await device.queue.onSubmittedWorkDone();
    const t1 = performance.now();

    if (denoise) {
      this.denoiser ??= await Denoiser.create({ device, precision: 'fp16' });
      r.initTexture(this.denoised);
      await this.denoiser.denoiseTextures({
        color: getGPUTexture(r, this.raw.texture),
        output: getGPUTexture(r, this.denoised),
        transfer: 'linear',
      });
      await device.queue.onSubmittedWorkDone();
    }
    const t2 = performance.now();
    return { rays: passes * this.grid * this.grid, bakeMs: t1 - t0, denoiseMs: t2 - t1 };
  }
}
