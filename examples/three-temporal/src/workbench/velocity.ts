// A velocity node per pane. three's `velocity` is one node for the whole app: it keeps each object's previous
// world matrix in a module-level map and replaces it after every draw, so when several panes draw the same scene in
// one frame, every pane after the first sees "previous = current" for moving objects (no object motion). It also
// has one projection override for everyone, while each pane's upscaler pins its own unjittered projection.
// PaneVelocityNode is the same computation with its own previous matrices and its own projection override.

import * as THREE from 'three/webgpu';
import { nodeObject } from 'three/tsl';

/* eslint-disable @typescript-eslint/no-explicit-any */
export class PaneVelocityNode extends (THREE as any).VelocityNode {
  private readonly previous = new WeakMap<THREE.Object3D, THREE.Matrix4>();
  private readonly cameras = new WeakMap<THREE.Camera, any>();

  private prevOf(object: THREE.Object3D) {
    let m = this.previous.get(object);
    if (!m) this.previous.set(object, (m = object.matrixWorld.clone()));
    return m;
  }

  update({ frameId, camera, object }: any) {
    (this as any).previousModelWorldMatrix.value.copy(this.prevOf(object));
    let data = this.cameras.get(camera);
    if (!data) this.cameras.set(camera, (data = {}));
    if (data.frameId !== frameId) {
      data.frameId = frameId;
      const projection = (this as any).projectionMatrix || camera.projectionMatrix;
      if (!data.previousProjectionMatrix) {
        data.previousProjectionMatrix = new THREE.Matrix4().copy(projection);
        data.previousCameraViewMatrix = new THREE.Matrix4().copy(camera.matrixWorldInverse);
        data.currentProjectionMatrix = new THREE.Matrix4();
        data.currentCameraViewMatrix = new THREE.Matrix4();
      } else {
        data.previousProjectionMatrix.copy(data.currentProjectionMatrix);
        data.previousCameraViewMatrix.copy(data.currentCameraViewMatrix);
      }
      data.currentProjectionMatrix.copy(projection);
      data.currentCameraViewMatrix.copy(camera.matrixWorldInverse);
      (this as any).previousProjectionMatrix.value.copy(data.previousProjectionMatrix);
      (this as any).previousCameraViewMatrix.value.copy(data.previousCameraViewMatrix);
    }
  }

  updateAfter({ object }: any) {
    this.prevOf(object).copy(object.matrixWorld);
  }
}

export const paneVelocity = () => nodeObject(new PaneVelocityNode() as any) as any;
