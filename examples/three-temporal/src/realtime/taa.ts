// A model of a downstream TAA / temporal upscaler pass, for judging how much of a denoiser's frame-to-frame flicker
// survives the temporal filter most apps run after it (results/SHADOW-BENCH.md, "Acceptance after TAA").
//
// The textbook resolve, no jitter: history reprojected with the scene velocity (three's TRAANode convention: uv offset =
// velocity.xy x (0.5, -0.5)), clipped to the 3x3 neighbourhood's mean +- gamma sigma of this frame (variance clipping,
// Salvi 2016), blended with this frame at weight `alpha` (TRAANode's minimum 0.05, typical TAA 0.1); history off screen
// -> this frame. It works on whatever it is given; pass it the displayed (tone-mapped) colour, as a TAA sees it.
//
// What it leaves out, so the numbers are a floor for a real TAA's help: sub-pixel jitter (which moves the denoiser's
// own input every frame), FSR's reactive / lock masks and luminance-weighted flicker reduction, disocclusion tests.
import * as THREE from 'three/webgpu';
import { float, vec2, vec3, vec4, uniform, texture, uv, mix, max } from 'three/tsl';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;

export class TaaNode extends THREE.TempNode {
  /** Weight of this frame (1 = no TAA). */
  readonly alpha = uniform(0.1);
  /** Variance clipping width (sigmas). */
  readonly gamma = uniform(1);
  private readonly targets = [0, 1].map(() => new THREE.RenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false }));
  private readonly prev = texture(this.targets[0].texture);
  private readonly out = texture(this.targets[1].texture);
  private readonly quad: THREE.QuadMesh;
  private readonly texel = uniform(new THREE.Vector2(1, 1));
  private readonly fresh = uniform(1);
  private read = 0;
  private state: N;

  /**
   * @param colorNode - this frame's colour as a texture node (e.g. convertToTexture(displayed colour))
   * @param velocityNode - the scene velocity texture (three's `velocity`, NDC delta)
   * @param deps - nodes whose passes must run first (registered as graph dependencies)
   */
  constructor(private readonly colorNode: N, velocityNode: N, private readonly deps: N[] = []) {
    super('vec4');
    this.updateBeforeType = THREE.NodeUpdateType.FRAME;
    const p = uv();
    const cur = colorNode.sample(p).rgb;
    let m1: N = vec3(0), m2: N = vec3(0);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const c = colorNode.sample(p.add(vec2(dx, dy).mul(this.texel))).rgb;
      m1 = m1.add(c); m2 = m2.add(c.mul(c));
    }
    const mu = m1.div(9), sigma = max(m2.div(9).sub(mu.mul(mu)), vec3(0)).sqrt();
    const hp = p.sub(velocityNode.sample(p).xy.mul(vec2(0.5, -0.5)));
    const onScreen = hp.x.greaterThanEqual(0).and(hp.x.lessThanEqual(1)).and(hp.y.greaterThanEqual(0)).and(hp.y.lessThanEqual(1));
    const hist = this.prev.sample(hp).rgb.clamp(mu.sub(sigma.mul(this.gamma)), mu.add(sigma.mul(this.gamma)));
    const a = onScreen.and(this.fresh.equal(0)).select(this.alpha, float(1));
    const mat = new THREE.NodeMaterial();
    mat.fragmentNode = vec4(mix(hist, cur, a), 1) as N;
    this.quad = new THREE.QuadMesh(mat);
  }

  /** The resolved image (valid after a frame has rendered). */
  get result(): THREE.Texture { return this.out.value as THREE.Texture; }

  /** Drops the history (the next frame passes through). */
  reset() { this.fresh.value = 1; }

  updateBefore(frame: N): undefined {
    const renderer = frame.renderer as THREE.WebGPURenderer;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    for (const t of this.targets) if (t.width !== size.x || t.height !== size.y) { t.setSize(size.x, size.y); this.fresh.value = 1; }
    this.texel.value.set(1 / size.x, 1 / size.y);
    const write = 1 - this.read;
    this.prev.value = this.targets[this.read].texture;
    this.state = THREE.RendererUtils.resetRendererState(renderer, this.state);
    renderer.setRenderTarget(this.targets[write]);
    this.quad.render(renderer);
    THREE.RendererUtils.restoreRendererState(renderer, this.state);
    this.out.value = this.targets[write].texture;
    this.read = write;
    this.fresh.value = 0;
  }

  setup(builder: N) {
    const props = builder.getNodeProperties(this);
    props.color = this.colorNode;
    this.deps.forEach((d, i) => { props[`dep${i}`] = d; });
    return this.out;
  }

  dispose() { for (const t of this.targets) t.dispose(); (this.quad.material as THREE.Material).dispose(); super.dispose(); }
}
