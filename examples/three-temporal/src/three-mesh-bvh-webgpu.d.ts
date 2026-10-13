// three-mesh-bvh 0.9.x ships typings for BVHComputeData only; the WGSL helpers
// this demo uses are untyped JS exports. Declare the ones we import.
import 'three-mesh-bvh/webgpu';

declare module 'three-mesh-bvh/webgpu' {
  /** Tagged-template WGSL function node (interpolations: nodes, structs, other fns). */
  export const wgslTagFn: (tokens: TemplateStringsArray, ...args: unknown[]) => (...params: unknown[]) => unknown;
  /** `struct Ray { origin: vec3f, direction: vec3f, maxDist: f32 }` */
  export const rayStruct: unknown;
  /** Hit record written by `BVHComputeData.fns.raycastFirstHit`. */
  export const rayIntersectionResultStruct: unknown;
}
