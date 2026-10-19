// Environment radiance from a baked ReflectionProbes set: per-pixel volume weights, box projection,
// and the cube lookup done by hand on a 2D array (three r186 can't bind cube arrays).
//
// Port of ReflectionProbesNode.js from three.js PR #35046 (Ben Houston). Same weights, priority,
// projection, roughness-to-mip mapping (maxLod * r * (2 - r)) and capture behaviour. The one
// difference is `sampleProbe`: #35046 does `cubeArray.sample( dir ).depth( i ).level( lod )` and
// the sampler picks the face and filters across face edges; here the node picks the face, samples
// layer `6 i + face` of the array, and handles edges per `probes.bakedSeamFix`:
//   'none'  one trilinear sample; the sampler's clamp-to-edge repeats each face's edge texel over
//           the last half texel (no blend with the neighbour face).
//   'warp'  the bake centred each face's edge texels on the edge, so neighbouring faces agree
//           there; uv is scaled by (size - 1) / size per mip, which needs the two mips sampled
//           separately (2 bilinear samples instead of 1 trilinear).

import * as THREE from 'three/webgpu';
import { float, Fn, If, int, materialEnvRotation, min, mix, nodeObject, normalize, positionWorld, reflectVector, step, uniform, vec2, vec3, texture } from 'three/tsl';
import type { ReflectionProbes } from './ReflectionProbes';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any; // TSL's node typings are too strict for hand-written shader maths

const _scale = new THREE.Vector3();

interface Slot { position: N; extent: N; fade: N; projectionSize: N; project: N }

/**
 * Box-projected direction (Lagarde's BPCEM, the guarded form from #35046): where the reflection ray
 * from the shaded point leaves the projection box, as a direction from the probe.
 */
export const parallaxCorrect = /* @__PURE__ */ Fn(([dir, boxSize, boxPos]: N[]) => {
  const d = normalize(dir).toVar();
  // +1 / -1 per axis. (r186 TSL turns a bvec3 select into `if ( all( c ) )`, so no vector select here.)
  const side = step(0, d).mul(2).sub(1).toVar();
  // keep axis-aligned directions away from zero so the distances stay finite
  const safe = side.mul(d.abs().max(1e-6));
  const dist = side.mul(boxSize.mul(0.5)).add(boxPos).sub(positionWorld).div(safe).toVar();
  return positionWorld.add(d.mul(min(dist.x, dist.y, dist.z))).sub(boxPos);
}) as N;

/**
 * Cube face and face uv of a direction, by WebGPU's cube face rules, in three's cube convention
 * (x mirrored, as CubeTextureNode samples). Returns vec3( u, v, face ).
 */
export const cubeFaceUV = /* @__PURE__ */ Fn(([dir]: N[]) => {
  const h = vec3(dir.x.negate(), dir.y, dir.z).toVar();
  const a = h.abs().toVar();
  const xMajor = a.x.greaterThanEqual(a.y).and(a.x.greaterThanEqual(a.z));
  const yMajor = xMajor.not().and(a.y.greaterThanEqual(a.z));
  const ma = xMajor.select(a.x, yMajor.select(a.y, a.z));
  const face = xMajor.select(h.x.lessThan(0).select(1, 0), yMajor.select(h.y.lessThan(0).select(3, 2), h.z.lessThan(0).select(5, 4)));
  const sc = xMajor.select(h.x.lessThan(0).select(h.z, h.z.negate()), yMajor.select(h.x, h.z.lessThan(0).select(h.x.negate(), h.x)));
  const tc = xMajor.select(h.y.negate(), yMajor.select(h.y.lessThan(0).select(h.z.negate(), h.z), h.y.negate()));
  const uv = vec2(sc, tc).div(ma).mul(0.5).add(0.5);
  return vec3(uv, float(face));
}) as N;

/**
 * Environment radiance from a baked {@link ReflectionProbes} set. Assign it to
 * `scene.environmentNode`. Bake the probes before creating the node.
 */
export class ReflectionProbesNode extends THREE.Node {
  static get type() { return 'ReflectionProbesNode'; }
  readonly probes: ReflectionProbes;
  protected readonly array: N;
  protected readonly maxLod = uniform(0);
  protected readonly size = uniform(128);
  private readonly local = uniform(1);
  private slots: Slot[] = [];
  private seamFix = 'warp';

  constructor(probes: ReflectionProbes) {
    super('vec3');
    if (!probes.texture) throw new Error('ReflectionProbesNode: bake the probes first.');
    this.probes = probes;
    this.updateBeforeType = THREE.NodeUpdateType.RENDER;
    this.array = texture(probes.texture);
    this.array.mergeable = false;
  }

  customCacheKey() {
    // the probe count and the seam handling are compiled into the shader
    return this.probes.bakedProbes.length * 2 + (this.probes.bakedSeamFix === 'warp' ? 1 : 0);
  }

  updateBefore(): undefined {
    const probes = this.probes;
    if (probes.bakedProbes.length !== this.slots.length || probes.bakedSeamFix !== this.seamFix) {
      this.needsUpdate = true;
      return;
    }
    const tex = probes.texture!;
    this.array.value = tex;
    this.maxLod.value = tex.mipmaps.length - 1;
    this.size.value = (tex.image as { width: number }).width;
    // captures see only the environment, so baking doesn't feed back into itself
    this.local.value = probes.capturing ? 0 : 1;
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i];
      const probe = probes.bakedProbes[i];
      probe.getWorldPosition(slot.position.value);
      probe.getWorldScale(_scale);
      slot.extent.value.copy(probe.influenceSize).multiply(_scale).multiplyScalar(0.5);
      slot.fade.value = probe.blendDistance;
      slot.project.value = probes.boxProjection ? 1 : 0;
      slot.projectionSize.value.copy(probe.projectionSize ?? probe.influenceSize).multiply(_scale);
    }
  }

  /** Radiance of probe slot `slot` (the environment is the last one) along `dir` at mip `lod`. */
  protected sampleProbe(slot: number, dir: N, lod: N): N {
    const f = cubeFaceUV(dir).toVar();
    const layer = int(f.z).add(slot * 6);
    if (this.seamFix !== 'warp') return this.array.sample(f.xy).depth(layer).level(lod).rgb;
    // edge-centred texels: uv' = uv * (s - 1) / s + 0.5 / s at face size s of each mip
    const lod0 = lod.floor().toVar();
    const lod1 = lod0.add(1).min(this.maxLod);
    const at = (l: N) => {
      const s = this.size.mul(l.negate().exp2());
      return this.array.sample(f.xy.mul(s.sub(1).div(s)).add(float(0.5).div(s))).depth(layer).level(l).rgb;
    };
    return mix(at(lod0), at(lod1), lod.sub(lod0));
  }

  setup(builder: N) {
    const probes = this.probes;
    this.seamFix = probes.bakedSeamFix;
    if (this.slots.length !== probes.bakedProbes.length) {
      this.slots = probes.bakedProbes.map(() => ({
        position: uniform(new THREE.Vector3()), extent: uniform(new THREE.Vector3()), fade: uniform(0.5),
        projectionSize: uniform(new THREE.Vector3()), project: uniform(0),
      }));
    }
    this.updateBefore();

    const { context } = builder;
    const direction: N = context.getUV ? context.getUV(this, builder) : reflectVector;
    const roughness: N = float(context.getTextureLevel ? context.getTextureLevel(this) : 0).clamp();

    return Fn(() => {
      // Build the direction before any branch: r186 emits a node's dependencies (normalView, ...)
      // where it is first built, so building it inside one If leaves it unassigned in the others.
      const dir = direction.toVar();
      // same roughness to mip mapping as three r187's PMREMNode
      const lod = this.maxLod.mul(roughness).mul(float(2).sub(roughness)).toVar();
      const radiance = vec3(0).toVar();
      const remaining = float(this.local).toVar();
      for (let i = 0; i < this.slots.length; i++) {
        const slot = this.slots[i];
        const local = positionWorld.sub(slot.position);
        const d = slot.extent.sub(local.abs());
        // negative outside the box, so the clamped fade is zero there
        const distance = d.x.min(d.y).min(d.z);
        const weight = distance.div(slot.fade.max(1e-6)).clamp().mul(remaining).toVar();
        If(weight.greaterThan(0), () => {
          const insideProjection = local.abs().lessThanEqual(slot.projectionSize.mul(0.5)).all();
          const projected = parallaxCorrect(dir, slot.projectionSize, slot.position);
          const corrected = slot.project.greaterThan(0).and(insideProjection).select(projected, dir);
          radiance.addAssign(this.sampleProbe(i, corrected, lod).mul(weight));
        });
        remaining.subAssign(weight);
      }
      const environmentWeight = remaining.add(this.local.oneMinus());
      radiance.addAssign(this.sampleProbe(this.slots.length, materialEnvRotation.mul(dir), lod).mul(environmentWeight));
      return radiance;
    })();
  }
}

/** TSL function: environment radiance from a baked probe set, for `scene.environmentNode`. */
export const reflectionProbes = (probes: ReflectionProbes) => nodeObject(new ReflectionProbesNode(probes));
