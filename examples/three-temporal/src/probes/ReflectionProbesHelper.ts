// Visualizes a ReflectionProbes set: a mirror sphere at each capture position and the outline of
// each influence volume.
// (The sphere sits at the capture point, which differs from the box centre with `originOffset`.) Port of ReflectionProbesHelper.js from three.js PR #35046 (Ben Houston).

import * as THREE from 'three/webgpu';
import { probeOrigin, type ReflectionProbe, type ReflectionProbes } from './ReflectionProbes';

const _position = new THREE.Vector3();
const _size = new THREE.Vector3();

export class ReflectionProbesHelper extends THREE.Object3D {
  readonly probes: ReflectionProbes;
  /** The mirror material of the probe spheres. */
  readonly material = new THREE.MeshStandardMaterial({ metalness: 1, roughness: 0 });
  color: THREE.ColorRepresentation;
  private readonly geometry: THREE.SphereGeometry;

  constructor(probes: ReflectionProbes, sphereSize = 0.25, color: THREE.ColorRepresentation = 0xffff00) {
    super();
    (this as { type: string }).type = 'ReflectionProbesHelper';
    this.probes = probes;
    this.color = color;
    this.geometry = new THREE.SphereGeometry(sphereSize, 32, 16);
    this.update();
  }

  /** Rebuilds the spheres and volumes. Call after adding, removing or moving probes. */
  update() {
    this.clear();
    this.probes.updateWorldMatrix(true, true);
    for (const child of this.probes.children) {
      const probe = child as ReflectionProbe;
      if (probe.isReflectionProbe !== true) continue;
      probe.getWorldPosition(_position);
      probe.getWorldScale(_size).multiply(probe.influenceSize);
      const sphere = new THREE.Mesh(this.geometry, this.material);
      probeOrigin(probe, sphere.position); // the capture point (the box centre unless originOffset is set)
      this.add(sphere, new THREE.Box3Helper(new THREE.Box3().setFromCenterAndSize(_position, _size), this.color));
    }
  }

  clear() {
    for (const child of [...this.children]) {
      if ((child as THREE.Box3Helper).isLineSegments) (child as THREE.Box3Helper).dispose();
      this.remove(child);
    }
    return this;
  }

  dispose() {
    this.clear();
    this.geometry.dispose();
    this.material.dispose();
  }
}
