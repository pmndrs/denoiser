// Visibility of a rectangular area light, ray traced against one three-mesh-bvh BVH.
//
// Every BVH generates the same WGSL function name (bvh_RaycastFirstHit), so one shader
// can only use one BVH: the split demo traces static, dynamic and full-scene rays in
// separate passes, each with its own copy of this function.
import { wgslTagFn, rayStruct, rayIntersectionResultStruct } from 'three-mesh-bvh/webgpu';
import type { BVHComputeData } from 'three-mesh-bvh/webgpu';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;

/**
 * `areaVisibility(P, N, skip, C, U, V, nL, eps, seed, grid)`: fraction of the light
 * (centre C, half-axes U and V, normal nL) visible from P, from `grid x grid` stratified
 * rays (grid = 1: one random point, the 1-spp signal). `skip > 0.5` returns 1 without
 * tracing (sky, or pixels another pass handles).
 */
export function areaVisibilityFn(bvh: BVHComputeData): N {
  return wgslTagFn`
    fn areaVisibility( P: vec3f, Nw: vec3f, skip: f32, C: vec3f, U: vec3f, V: vec3f, nL: vec3f,
                       eps: f32, seed: u32, grid: u32 ) -> f32 {
      if ( skip > 0.5 ) { return 1.0; }
      let o = P + Nw * eps;
      var lit = 0.0;
      var s = seed;
      for ( var j = 0u; j < grid; j++ ) {
        for ( var i = 0u; i < grid; i++ ) {
          s = s * 747796405u + 2891336453u;
          var w = ( ( s >> ( ( s >> 28u ) + 4u ) ) ^ s ) * 277803737u;
          let r0 = f32( ( w >> 22u ) ^ w ) / 4294967296.0;
          s = s * 747796405u + 2891336453u;
          w = ( ( s >> ( ( s >> 28u ) + 4u ) ) ^ s ) * 277803737u;
          let r1 = f32( ( w >> 22u ) ^ w ) / 4294967296.0;
          let lu = ( f32( i ) + r0 ) / f32( grid ) * 2.0 - 1.0;
          let lv = ( f32( j ) + r1 ) / f32( grid ) * 2.0 - 1.0;
          let toL = C + U * lu + V * lv - o;
          let dist = length( toL );
          let dir = toL / dist;
          if ( dot( Nw, dir ) <= 0.0 || dot( nL, dir ) >= 0.0 ) { continue; }
          let ray = ${rayStruct}( o, dir, dist );
          var hit: ${rayIntersectionResultStruct};
          if ( ! ${(bvh.fns as N).raycastFirstHit}( ray, &hit ) ) { lit += 1.0; }
        }
      }
      return lit / f32( grid * grid );
    }
  ` as N;
}
