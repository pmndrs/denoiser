// Exact disocclusion ground truth for the three-temporal Bistro / Sponza captures (CPU ray casts, three-mesh-bvh).
// The scene is rebuilt with the realtime pages' own loader (examples/three-temporal src/realtime/assets.ts, the
// capture's cull box) and, for paths with a mover, the mover geometry at its path-frame matrices. Per pixel of frame
// t: P = the capture's viewz unprojected through the frame camera (no jitter in these captures); a mover pixel is
// moved by M(t-1) M(t)^-1; P(t-1) must be inside the previous frustum (|ndc| < 1, 0 < z < 1) and the first hit of
// the ray from the previous eye toward it (hits closer than dist (1 - 2e-3) - 2 mm count as occluders).
// A self-check casts every 7th pixel from the CURRENT eye: the share of those that hit something in front of
// their own P (beyond the same tolerance) is the GT's own error estimate (`selfOccluded`).
import * as THREE from 'three/webgpu';
import { MeshBVH } from 'three-mesh-bvh';
import { loadAsset, type AssetScene } from '../../../../../../examples/three-temporal/src/realtime/assets';
import { SCENES, pathOf } from '../../../../../../examples/three-temporal/src/realtime/scenes';
import type { CaptureManifest } from '../../../../../../tools/rt-capture/src/format';

const REL = 2e-3, ABS = 2e-3;

/** Merge world-space meshes (position + index) into one geometry. */
function merge(meshes: THREE.Mesh[]): THREE.BufferGeometry | undefined {
  if (!meshes.length) return undefined;
  let nv = 0, ni = 0;
  for (const m of meshes) { nv += m.geometry.attributes.position.count; ni += m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count; }
  const pos = new Float32Array(nv * 3), idx = new Uint32Array(ni);
  let ov = 0, oi = 0;
  for (const m of meshes) {
    const g = m.geometry, pa = g.attributes.position;
    for (let k = 0; k < pa.count; k++) { pos[3 * (ov + k)] = pa.getX(k); pos[3 * (ov + k) + 1] = pa.getY(k); pos[3 * (ov + k) + 2] = pa.getZ(k); }
    const n = g.index ? g.index.count : pa.count;
    for (let k = 0; k < n; k++) idx[oi + k] = ov + (g.index ? g.index.getX(k) : k);
    ov += pa.count; oi += n;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

export class BvhGroundTruth {
  private constructor(private bvh: MeshBVH | undefined, private bvhFront: MeshBVH | undefined, private mover: MeshBVH | undefined, private moverAt: ((f: number) => THREE.Matrix4) | undefined,
    readonly triangles: number) {}
  stats = { selfChecked: 0, selfOccluded: 0 };

  static async create(m: CaptureManifest): Promise<BvhGroundTruth> {
    const tt = (m as unknown as { threeTemporal: { scene: AssetScene; path: string; cull: number[] | null } }).threeTemporal;
    const cull = tt.cull ? new THREE.Box3(new THREE.Vector3(tt.cull[0], tt.cull[1], tt.cull[2]), new THREE.Vector3(tt.cull[3], tt.cull[4], tt.cull[5])) : undefined;
    const asset = await loadAsset(tt.scene, { cull });
    // the raster draws single-sided materials FrontSide (assets.ts): a back face is not an occluder there
    const ds = (m: THREE.Mesh) => (m.material as THREE.Material).side === THREE.DoubleSide;
    const g2 = merge(asset.meshes.filter(ds)), g1 = merge(asset.meshes.filter((m) => !ds(m)));
    const bvh = g2 ? new MeshBVH(g2) : undefined, bvhFront = g1 ? new MeshBVH(g1) : undefined;
    const cfg = SCENES[tt.scene];
    const path = pathOf(cfg, tt.path);
    let mover: MeshBVH | undefined;
    if (path?.mover && cfg.mover) mover = new MeshBVH(cfg.mover.geometry());
    return new BvhGroundTruth(bvh, bvhFront, mover, path?.mover?.bind(path), asset.triangles);
  }

  private firstHit(o: THREE.Vector3, d: THREE.Vector3, far: number, moverM?: THREE.Matrix4, moverInv?: THREE.Matrix4): number {
    const ray = new THREE.Ray(o, d);
    let best = Infinity;
    const h = this.bvh?.raycastFirst(ray, THREE.DoubleSide, 0, far);
    if (h) best = h.distance;
    const hf = this.bvhFront?.raycastFirst(ray, THREE.FrontSide, 0, far);
    if (hf) best = Math.min(best, hf.distance);
    if (this.mover && moverM && moverInv) {
      const lo = o.clone().applyMatrix4(moverInv);
      const ld = d.clone().transformDirection(moverInv);
      const scale = o.clone().add(d).applyMatrix4(moverInv).sub(lo).length();   // local units per world unit
      const hm = this.mover.raycastFirst(new THREE.Ray(lo, ld), THREE.DoubleSide, 0, far * scale);
      if (hm) best = Math.min(best, hm.distance / scale);
    }
    return best;
  }

  /** u8 per pixel: 0 visible at t-1, 1 disoccluded, 255 no surface. viewz: the capture's viewz (negative in front). */
  frame(m: CaptureManifest, fi: number, viewz: Float32Array): Uint8Array {
    const W = m.width, H = m.height;
    const fr = m.frames[fi];
    const cam = fr.camera as unknown as { view: number[]; projection: number[]; prevView: number[]; prevProjection: number[]; far: number };
    const P = cam.projection;
    const viewInv = new THREE.Matrix4().fromArray(cam.view).invert();
    const prevVP = new THREE.Matrix4().fromArray(cam.prevProjection).multiply(new THREE.Matrix4().fromArray(cam.prevView));
    const eye = new THREE.Vector3().setFromMatrixPosition(viewInv);
    const prevEye = new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().fromArray(cam.prevView).invert());
    const pf = (fr as unknown as { pathFrame: number }).pathFrame;
    let Mt: THREE.Matrix4 | undefined, MtInv: THREE.Matrix4 | undefined, Mp: THREE.Matrix4 | undefined, MpInv: THREE.Matrix4 | undefined, toPrev: THREE.Matrix4 | undefined;
    if (this.moverAt) {
      Mt = this.moverAt(pf); MtInv = Mt.clone().invert();
      Mp = this.moverAt(pf - 1); MpInv = Mp.clone().invert();
      toPrev = Mp.clone().multiply(MtInv);
    }
    const out = new Uint8Array(W * H);
    const p = new THREE.Vector3(), pp = new THREE.Vector3(), d = new THREE.Vector3(), c = new THREE.Vector4();
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const z = viewz[i];
      if (!(z < 0) || -z >= cam.far * 0.999) { out[i] = 255; continue; }
      const nx = ((x + 0.5) / W) * 2 - 1, ny = 1 - ((y + 0.5) / H) * 2;
      // three projection: ndc.x = (P0 x + P8 z) / -z
      p.set((nx * -z - P[8] * z) / P[0], (ny * -z - P[9] * z) / P[5], z).applyMatrix4(viewInv);
      const dist0 = p.distanceTo(eye);
      let onMover = false;
      if (Mt && MtInv) {
        d.copy(p).sub(eye).normalize();
        const lo = eye.clone().applyMatrix4(MtInv);
        const ld = d.clone().transformDirection(MtInv);
        const scale = eye.clone().add(d).applyMatrix4(MtInv).sub(lo).length();
        const hm = this.mover!.raycastFirst(new THREE.Ray(lo, ld), THREE.DoubleSide, 0, dist0 * (1 + REL) * scale + ABS);
        onMover = !!hm && Math.abs(hm.distance / scale - dist0) <= dist0 * REL + ABS;
      }
      if (i % 7 === 0) {
        d.copy(p).sub(eye).normalize();
        const t = this.firstHit(eye, d, dist0 * (1 - REL) - ABS, Mt, MtInv);
        this.stats.selfChecked++;
        if (t < dist0 * (1 - REL) - ABS) this.stats.selfOccluded++;
      }
      pp.copy(p);
      if (onMover && toPrev) pp.applyMatrix4(toPrev);
      c.set(pp.x, pp.y, pp.z, 1).applyMatrix4(prevVP);
      const ndx = c.x / c.w, ndy = c.y / c.w, ndz = c.z / c.w;
      if (!(c.w > 0 && Math.abs(ndx) < 1 && Math.abs(ndy) < 1 && ndz > 0 && ndz < 1)) { out[i] = 1; continue; }
      const dist = pp.distanceTo(prevEye);
      d.copy(pp).sub(prevEye).divideScalar(dist);
      const far = dist * (1 - REL) - ABS;
      out[i] = this.firstHit(prevEye, d, far, Mp, MpInv) < far ? 1 : 0;
    }
    return out;
  }
}
