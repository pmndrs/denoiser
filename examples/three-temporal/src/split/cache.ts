// Static half of the split shadow, version 2: a world-space visibility cache. No UVs, no
// bake step: it fills in from whatever the camera sees.
//
// A hash table of surface cells (keyed by quantized world position, a size level and the
// dominant normal axis). Each pixel finds its cell; while the cell has fewer than
// `target` rays, the pixel traces 1 more ray against the static BVH and adds it in. Once a
// cell is full it costs a lookup and nothing else, until the light changes (clear()).
//
// Cell size follows the pixel footprint (about `cellPixels` pixels wide, in power-of-two
// steps), and the lookup position is jittered inside the tangent plane every frame, so
// the cell grid shows up as noise that the temporal denoiser averages out, not as blocks.
import * as THREE from 'three/webgpu';
import { storage } from 'three/tsl';
import { wgslTagFn } from 'three-mesh-bvh/webgpu';
import type { BVHComputeData } from 'three-mesh-bvh/webgpu';
import { areaVisibilityFn } from './area';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;

export class SurfaceCache {
  private readonly keysAttr: THREE.StorageBufferAttribute;
  private readonly dataAttr: THREE.StorageBufferAttribute;
  /**
   * `cacheVisibility(P, N, skip, viewDist, seed, C, U, V, nL, eps) -> vec2f`: x = the cached
   * visible fraction, y = a 0/1 sample of it (FFX's shadow denoiser takes 1-bit ray
   * results: it packs its input into bitmasks, so fractions would be thresholded).
   */
  readonly fn: N;

  constructor(
    staticBvh: BVHComputeData,
    /** slots in the table (power of two) */
    readonly slots = 1 << 21,
    /** rays per cell before it stops tracing */
    readonly target = 512,
    /** smallest cell edge, metres */
    readonly baseCell = 0.004,
    /** cell edge in pixels (at the pixel footprint) */
    readonly cellPixels = 3,
    /** radians per pixel */
    pixelAngle = 0.0014,
  ) {
    this.keysAttr = new THREE.StorageBufferAttribute(new Uint32Array(slots), 1);
    this.dataAttr = new THREE.StorageBufferAttribute(new Uint32Array(slots * 2), 1);
    const keys = storage(this.keysAttr, 'uint', slots).toAtomic().setName('cache_keys');
    const data = storage(this.dataAttr, 'uint', slots * 2).toAtomic().setName('cache_data');
    const areaVisibility = areaVisibilityFn(staticBvh);
    const mask = slots - 1;
    const f = (x: number) => x.toFixed(6);

    this.fn = wgslTagFn`
      fn cacheVisibility( P: vec3f, Nw: vec3f, skip: f32, viewDist: f32, seed: u32,
                          C: vec3f, U: vec3f, V: vec3f, nL: vec3f, eps: f32 ) -> vec2f {
        if ( skip > 0.5 ) { return vec2f( 1.0 ); }
        var s = seed;
        s = s * 747796405u + 2891336453u;
        let j0 = f32( ( ( ( s >> ( ( s >> 28u ) + 4u ) ) ^ s ) * 277803737u ) >> 8u ) / 16777216.0;
        s = s * 747796405u + 2891336453u;
        let j1 = f32( ( ( ( s >> ( ( s >> 28u ) + 4u ) ) ^ s ) * 277803737u ) >> 8u ) / 16777216.0;
        s = s * 747796405u + 2891336453u;
        let j2 = f32( ( ( ( s >> ( ( s >> 28u ) + 4u ) ) ^ s ) * 277803737u ) >> 8u ) / 16777216.0;

        // cell size: the pixel footprint x cellPixels, rounded up to a power-of-two level
        let want = max( viewDist * ${f(pixelAngle)} * ${f(cellPixels)}, ${f(baseCell)} );
        let level = u32( max( ceil( log2( want / ${f(baseCell)} ) ), 0.0 ) );
        let size = ${f(baseCell)} * f32( 1u << level );

        // jitter inside the tangent plane, then quantize
        let a = abs( Nw );
        var axis = 0u;
        if ( a.y > a.x && a.y >= a.z ) { axis = 1u; } else if ( a.z > a.x && a.z > a.y ) { axis = 2u; }
        let sgn = select( 0u, 1u, Nw[ axis ] < 0.0 );
        let up = select( vec3f( 0.0, 1.0, 0.0 ), vec3f( 1.0, 0.0, 0.0 ), axis == 1u );
        let T = normalize( cross( up, Nw ) );
        let B = cross( Nw, T );
        let Pj = P + ( T * ( j0 - 0.5 ) + B * ( j1 - 0.5 ) ) * size;
        let q = vec3i( floor( Pj / size ) );

        // key: hash of (cell, level, normal bucket); slot: a second hash
        var h = ( u32( q.x ) * 73856093u ) ^ ( u32( q.y ) * 19349663u ) ^ ( u32( q.z ) * 83492791u ) ^ ( level * 2654435761u ) ^ ( ( axis * 2u + sgn ) * 2246822519u );
        h = ( h ^ ( h >> 16u ) ) * 2246822507u;
        h = ( h ^ ( h >> 13u ) ) * 3266489909u;
        h = h ^ ( h >> 16u );
        let key = ( h * 2654435761u ) | 1u; // never 0: 0 marks an empty slot

        var slot = 0xffffffffu;
        for ( var k = 0u; k < 8u; k++ ) {
          let i = ( h + k ) & ${mask}u;
          // a plain load first: most lookups hit an existing cell, and ~10 pixels share
          // each cell, so read-modify-writes on every lookup would contend
          let cur = atomicLoad( &${keys}[ i ] );
          if ( cur == key ) { slot = i; break; }
          if ( cur != 0u ) { continue; }
          let r = atomicCompareExchangeWeak( &${keys}[ i ], 0u, key );
          if ( r.exchanged || r.old_value == key ) { slot = i; break; }
        }
        // table full along this probe: trace without caching
        if ( slot == 0xffffffffu ) { let v = ${areaVisibility}( P, Nw, 0.0, C, U, V, nL, eps, s, 1u ); return vec2f( v, v ); }

        var lit = atomicLoad( &${data}[ slot * 2u ] );
        var count = atomicLoad( &${data}[ slot * 2u + 1u ] );
        if ( count < ${target}u ) {
          let v = ${areaVisibility}( P, Nw, 0.0, C, U, V, nL, eps, s, 1u );
          let hit = u32( v > 0.5 );
          atomicAdd( &${data}[ slot * 2u ], hit );
          atomicAdd( &${data}[ slot * 2u + 1u ], 1u );
          lit += hit;
          count += 1u;
        }
        let frac = f32( lit ) / f32( count );
        return vec2f( frac, select( 0.0, 1.0, j2 < frac ) );
      }
    ` as N;
  }

  /** Empties the table (the light changed). */
  clear() {
    (this.keysAttr.array as Uint32Array).fill(0);
    (this.dataAttr.array as Uint32Array).fill(0);
    this.keysAttr.needsUpdate = true;
    this.dataAttr.needsUpdate = true;
  }
}
