// Pieces shared by the reflection pages (reflections-hybrid.ts, the one-room explainer, and
// reflections-rooms.ts, the two-room probes page): accumulating a reference over frames, one GGX
// sample of a pixel's specular lobe, and the firefly clamp applied to every 1-sample estimate.

import * as THREE from 'three/webgpu';
import { float, hash, mix, screenCoordinate, texture, uint, uniform, uv, vec3, vec4 } from 'three/tsl';
// three's SSR sampler (ggxReflectionSample isn't in @types/three yet)
import * as SpecularHelpers from 'three/addons/tsl/utils/SpecularHelpers.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any; // TSL's node typings are too strict for hand-written shader maths

/** A per-pixel random seed for frame `frame` (a uint uniform) and stream `k`. */
export const pixelSeed = (frame: N, k: number): N => {
  const px = screenCoordinate.xy.floor();
  return uint(px.x).add(uint(px.y).mul(4099)).mul(uint(1973)).add(frame.mul(9277)).add(uint(k * 104729));
};

/**
 * One GGX sample of a surface's specular lobe (world-space N and V), drawn with the sampler and
 * weights three's SSR uses, so SSR hits, traced hits and probe lookups all carry the same energy.
 * Returns the reflected direction and the sample's weight (Fresnel and the BRDF over the pdf).
 */
export const ggxLobeSample = (N_: N, V: N, roughness: N, metalness: N, albedo: N, seed: N) => {
  const Xi = vec4(hash(seed), hash(seed.add(1)), hash(seed.add(2)), hash(seed.add(3)));
  const g = (SpecularHelpers as N).ggxReflectionSample(N_, V, roughness, metalness, albedo, Xi).toVar();
  return { dir: g.get('reflectDir') as N, weight: g.get('sampleWeight') as N };
};

/**
 * Firefly clamp on a sample's luminance, as SSR does (its maxLuminance, 10), tightened on rough
 * surfaces: a fully rough surface that once in a while samples a bright light otherwise leaves
 * speckles a 1-sample-per-pixel denoiser can't average away. Biased, like every engine's clamp.
 */
export const clampSample = (v: N, rough: N) => {
  const maxLum = mix(float(10), float(1), rough.smoothstep(0.3, 1));
  const lum = v.rgb.dot(vec3(0.2126, 0.7152, 0.0722)).max(1e-4);
  return vec4(v.rgb.mul(maxLum.div(lum).min(1)), v.a);
};

// ---- reference accumulation ---------------------------------------------------------

/**
 * Running average of a per-pixel node over frames (ping-pong half-float targets).
 * `count` = frames accumulated so far; set it to 0 to restart. Stops rendering
 * once `max` frames are in (the result then stays put). With `minWeight` > 0 it
 * becomes an exponential moving average that never stops.
 */
export class AccumulateNode extends THREE.TempNode {
  readonly count = uniform(0);
  max = 128;
  private readonly targets = [0, 1].map(() => new THREE.RenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false }));
  private readonly prev = texture(this.targets[0].texture);
  private readonly out = texture(this.targets[1].texture);
  private readonly mat = new THREE.NodeMaterial();
  private readonly quad: THREE.QuadMesh;
  private read = 0;
  private state: N;
  constructor(sampleNode: N, private readonly scale = 1, private readonly minWeight = 0) {
    super('vec4');
    this.updateBeforeType = THREE.NodeUpdateType.FRAME;
    if (minWeight > 0) this.max = Infinity;
    this.sample = sampleNode;
    this.quad = new THREE.QuadMesh(this.mat);
  }
  /** Swap what is accumulated (and restart). */
  set sample(node: N) {
    this.mat.fragmentNode = mix(this.prev.sample(uv()), node, float(1).div(this.count.add(1)).max(this.minWeight)) as N;
    this.mat.needsUpdate = true;
    this.count.value = 0;
  }
  get renderTargets() { return this.targets; }
  updateBefore(frame: N): undefined {
    if (this.count.value >= this.max) return;
    const renderer = frame.renderer as THREE.WebGPURenderer;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    for (const t of this.targets) t.setSize(Math.round(size.x * this.scale), Math.round(size.y * this.scale));
    const write = 1 - this.read;
    this.prev.value = this.targets[this.read].texture;
    this.state = THREE.RendererUtils.resetRendererState(renderer, this.state);
    renderer.setRenderTarget(this.targets[write]);
    this.quad.render(renderer);
    THREE.RendererUtils.restoreRendererState(renderer, this.state);
    this.out.value = this.targets[write].texture;
    this.read = write;
    this.count.value++;
  }
  setup() { return this.out; }
  dispose() { for (const t of this.targets) t.dispose(); super.dispose(); }
}
