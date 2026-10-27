// The 1-ray signal generators of the realtime pages as WGSL functions (three-mesh-bvh's wgslTagFn), shared by
// realtime-gi.ts (the corner), realtime-scenes.ts (Bistro / Sponza) and the review bench (src/review/). Moved here
// unchanged from those pages, so the generated WGSL (and every capture written with it) is the same as before.
// wgslTagFn defines ONE function per tag; helpers are interpolated by reference (LESSONS: "wgslTagFn").
import { wgslTagFn, rayStruct, rayIntersectionResultStruct } from 'three-mesh-bvh/webgpu';
import { type N, envRadianceWgsl } from './scene';
import { type SceneConfig, skyRadianceWgsl } from './scenes';

const cosineDirOf = () => wgslTagFn`
    fn cosineDir( Nw: vec3f, xi: vec2f ) -> vec3f {
      let up = select( vec3f( 1.0, 0.0, 0.0 ), vec3f( 0.0, 1.0, 0.0 ), abs( Nw.y ) < 0.999 );
      let T = normalize( cross( up, Nw ) );
      let B = cross( Nw, T );
      let r = sqrt( xi.x );
      let ph = 6.28318530718 * xi.y;
      return normalize( T * ( r * cos( ph ) ) + B * ( r * sin( ph ) ) + Nw * sqrt( max( 0.0, 1.0 - xi.x ) ) );
    }
  ` as N;

const pcgfOf = () => wgslTagFn`
    fn pcgf( s: ptr<function, u32> ) -> f32 {
      *s = *s * 747796405u + 2891336453u;
      let w = ( ( *s >> ( ( *s >> 28u ) + 4u ) ) ^ *s ) * 277803737u;
      return f32( ( w >> 22u ) ^ w ) / 4294967296.0;
    }
  ` as N;

/**
 * The corner scene (realtime-gi.html, realtime-shadows' scene): a rectangular area light (centre C, half-axes U / V,
 * normal nL), the environment for diffuse misses. `raycast` = `bvh.fns.raycastFirstHit`; AO curve h / (h + aoA + aoB depth).
 */
export function cornerRays(raycast: N, o: { aoA: number; aoB: number }) {
  const { aoA: AO_A, aoB: AO_B } = o;
  const envFn = wgslTagFn`${envRadianceWgsl()}` as N;
  // panel irradiance, same convention as the direct term of the pages
  const panelIrr = wgslTagFn`
    fn panelIrradiance( P: vec3f, Nw: vec3f, C: vec3f, nL: vec3f, power: f32 ) -> f32 {
      let L = C - P;
      let d2 = max( dot( L, L ), 1e-3 );
      let l = L * inverseSqrt( d2 );
      return power * max( dot( Nw, l ), 0.0 ) * max( dot( nL, - l ), 0.0 ) / d2;
    }
  ` as N;
  const cosineDir = cosineDirOf();
  // One diffuse ray: (radiance rgb, hit distance; 0 = miss). A miss sees the environment; a hit
  // returns the panel bounced off a grey (0.5) surface (no shadow ray at the secondary hit).
  const diffuseRay = wgslTagFn`
    fn diffuseRay( P: vec3f, Nw: vec3f, eps: f32, xi: vec2f, C: vec3f, nL: vec3f, power: f32, envI: f32 ) -> vec4f {
      let o = P + Nw * eps;
      let dir = ${cosineDir}( Nw, xi );
      let ray = ${rayStruct}( o, dir, 1e4 );
      var hit: ${rayIntersectionResultStruct};
      if ( ! ${raycast}( ray, &hit ) ) { return vec4f( ${envFn}( dir ) * envI, 0.0 ); }
      let hp = o + dir * hit.dist;
      var hn = normalize( hit.normal );
      if ( dot( hn, dir ) > 0.0 ) { hn = - hn; }
      return vec4f( vec3f( 0.5 * ${panelIrr}( hp + hn * 1e-3, hn, C, nL, power ) ), hit.dist );
    }
  ` as N;
  const pcgf = pcgfOf();
  const diffuse1 = wgslTagFn`
    fn diffuse1( P: vec3f, Nw: vec3f, sky: f32, eps: f32, xi: vec2f, C: vec3f, nL: vec3f, power: f32, envI: f32 ) -> vec4f {
      if ( sky > 0.5 ) { return vec4f( 0.0 ); }
      return ${diffuseRay}( P, Nw, eps, xi, C, nL, power, envI );
    }
  ` as N;
  // Reference: n white-noise cosine rays per frame -> (mean radiance rgb, mean per-sample normalized AO)
  const diffuseRef = wgslTagFn`
    fn diffuseRef( P: vec3f, Nw: vec3f, sky: f32, eps: f32, seed: u32, n: u32, depth: f32, C: vec3f, nL: vec3f, power: f32, envI: f32 ) -> vec4f {
      if ( sky > 0.5 ) { return vec4f( 0.0, 0.0, 0.0, 1.0 ); }
      var s = seed;
      var acc = vec4f( 0.0 );
      for ( var i = 0u; i < n; i++ ) {
        let a = ${pcgf}( &s );
        let b = ${pcgf}( &s );
        let r = ${diffuseRay}( P, Nw, eps, vec2f( a, b ), C, nL, power, envI );
        let ao = select( r.w / ( r.w + ${AO_A.toFixed(3)} + ${AO_B.toFixed(3)} * depth ), 1.0, r.w <= 0.0 );
        acc += vec4f( r.rgb, ao );
      }
      return acc / f32( n );
    }
  ` as N;
  const areaShadow1 = wgslTagFn`
    fn areaShadow1( P: vec3f, Nw: vec3f, sky: f32, C: vec3f, U: vec3f, V: vec3f, nL: vec3f, eps: f32, xi: vec2f ) -> vec2f {
      if ( sky > 0.5 ) { return vec2f( 1.0, 0.0 ); }
      let o = P + Nw * eps;
      let toL = C + U * ( xi.x * 2.0 - 1.0 ) + V * ( xi.y * 2.0 - 1.0 ) - o;
      let dist = length( toL );
      let dir = toL / dist;
      if ( dot( Nw, dir ) <= 0.0 || dot( nL, dir ) >= 0.0 ) { return vec2f( 0.0, 0.0 ); }
      let ray = ${rayStruct}( o, dir, dist );
      var hit: ${rayIntersectionResultStruct};
      if ( ${raycast}( ray, &hit ) && hit.dist < dist ) { return vec2f( 0.0, hit.dist ); }
      return vec2f( 1.0, 0.0 );
    }
  ` as N;
  // grid x grid stratified white-noise shadow rays (the visibility reference, as in realtime-shadows)
  const areaVisibility = wgslTagFn`
    fn areaVisibility( P: vec3f, Nw: vec3f, sky: f32, C: vec3f, U: vec3f, V: vec3f, nL: vec3f, eps: f32, seed: u32, grid: u32 ) -> f32 {
      if ( sky > 0.5 ) { return 1.0; }
      let o = P + Nw * eps;
      var lit = 0.0;
      var s = seed;
      for ( var j = 0u; j < grid; j++ ) {
        for ( var i = 0u; i < grid; i++ ) {
          let r0 = ${pcgf}( &s );
          let r1 = ${pcgf}( &s );
          let toL = C + U * ( ( f32( i ) + r0 ) / f32( grid ) * 2.0 - 1.0 ) + V * ( ( f32( j ) + r1 ) / f32( grid ) * 2.0 - 1.0 ) - o;
          let dist = length( toL );
          let dir = toL / dist;
          if ( dot( Nw, dir ) <= 0.0 || dot( nL, dir ) >= 0.0 ) { continue; }
          let ray = ${rayStruct}( o, dir, dist );
          var hit: ${rayIntersectionResultStruct};
          if ( ! ${raycast}( ray, &hit ) || hit.dist >= dist ) { lit += 1.0; }
        }
      }
      return lit / f32( grid * grid );
    }
  ` as N;
  return { cosineDir, diffuse1, diffuseRef, areaShadow1, areaVisibility };
}

/**
 * Bistro / Sponza (realtime-scenes.ts): a sun disk and a local sphere light, the scene's sky for diffuse misses.
 * `bounceLocalShadow`: a shadow ray to the local light at the diffuse hit point too (&bounceLocalShadow=1).
 */
export function assetRays(raycast: N, cfg: SceneConfig, o: { aoA: number; aoB: number; bounceLocalShadow: boolean }) {
  const { aoA: AO_A, aoB: AO_B, bounceLocalShadow: BOUNCE_LOCAL_SHADOW } = o;
  const skyFn = wgslTagFn`${skyRadianceWgsl(cfg)}` as N;
  const cosineDir = cosineDirOf();
  // true when nothing blocks o + dir * t for t < maxDist
  const unoccluded = wgslTagFn`
    fn unoccluded( o: vec3f, dir: vec3f, maxDist: f32 ) -> bool {
      let ray = ${rayStruct}( o, dir, maxDist );
      var hit: ${rayIntersectionResultStruct};
      return ! ( ${raycast}( ray, &hit ) && hit.dist < maxDist );
    }
  ` as N;
  // One diffuse ray: (radiance rgb, hit distance; 0 = miss). Miss: sky. Hit: sun + local light bounced off a
  // grey 0.5 surface; the sun with one hard shadow ray at the hit point, the local light unshadowed there unless
  // &bounceLocalShadow=1 (a second shadow ray: ~25 % more reference time; the captures don't use it).
  const diffuseRay = wgslTagFn`
    fn diffuseRay( P: vec3f, Nw: vec3f, eps: f32, xi: vec2f, sunDir: vec3f, sunE: vec3f, lPos: vec3f, lPow: vec3f, envI: f32 ) -> vec4f {
      let o = P + Nw * eps;
      let dir = ${cosineDir}( Nw, xi );
      let ray = ${rayStruct}( o, dir, 1e4 );
      var hit: ${rayIntersectionResultStruct};
      if ( ! ${raycast}( ray, &hit ) ) { return vec4f( ${skyFn}( dir ) * envI, 0.0 ); }
      var hn = normalize( hit.normal );
      if ( dot( hn, dir ) > 0.0 ) { hn = - hn; }
      let q = o + dir * hit.dist + hn * ( 2e-3 + 1e-4 * hit.dist );
      var L = vec3f( 0.0 );
      let cs = dot( hn, sunDir );
      if ( cs > 0.0 && ${unoccluded}( q, sunDir, 1e4 ) ) { L += sunE * cs; }
      let toL = lPos - q;
      let d2 = max( dot( toL, toL ), 1e-4 );
      let dl = sqrt( d2 );
      let cl = dot( hn, toL / dl );
      if ( cl > 0.0${BOUNCE_LOCAL_SHADOW ? ` && ${unoccluded}( q, toL / dl, dl )` : ''} ) { L += lPow * cl / max( d2, 0.01 ); }
      return vec4f( 0.5 * L, hit.dist );
    }
  ` as N;
  const pcgf = pcgfOf();
  const diffuse1 = wgslTagFn`
    fn diffuse1( P: vec3f, Nw: vec3f, sky: f32, eps: f32, xi: vec2f, sunDir: vec3f, sunE: vec3f, lPos: vec3f, lPow: vec3f, envI: f32 ) -> vec4f {
      if ( sky > 0.5 ) { return vec4f( 0.0 ); }
      return ${diffuseRay}( P, Nw, eps, xi, sunDir, sunE, lPos, lPow, envI );
    }
  ` as N;
  const diffuseRef = wgslTagFn`
    fn diffuseRef( P: vec3f, Nw: vec3f, sky: f32, eps: f32, seed: u32, n: u32, depth: f32, sunDir: vec3f, sunE: vec3f, lPos: vec3f, lPow: vec3f, envI: f32 ) -> vec4f {
      if ( sky > 0.5 ) { return vec4f( 0.0, 0.0, 0.0, 1.0 ); }
      var s = seed;
      var acc = vec4f( 0.0 );
      for ( var i = 0u; i < n; i++ ) {
        let a = ${pcgf}( &s );
        let b = ${pcgf}( &s );
        let r = ${diffuseRay}( P, Nw, eps, vec2f( a, b ), sunDir, sunE, lPos, lPow, envI );
        let ao = select( r.w / ( r.w + ${AO_A.toFixed(3)} + ${AO_B.toFixed(3)} * depth ), 1.0, r.w <= 0.0 );
        acc += vec4f( r.rgb, ao );
      }
      return acc / f32( n );
    }
  ` as N;
  // A sample on the shadow light for unit square u: (direction, max distance). kind 0 = sun (uniform over the
  // disk of angular radius atan(tanR) around sunDir), 1 = sphere (uniform over its disk facing the receiver).
  const lightSample = wgslTagFn`
    fn lightSample( o: vec3f, u: vec2f, kind: u32, sunDir: vec3f, tanR: f32, lPos: vec3f, lR: f32 ) -> vec4f {
      let axis = select( normalize( lPos - o ), sunDir, kind == 0u );
      let up = select( vec3f( 1.0, 0.0, 0.0 ), vec3f( 0.0, 1.0, 0.0 ), abs( axis.y ) < 0.999 );
      let T = normalize( cross( up, axis ) );
      let B = cross( axis, T );
      let r = sqrt( u.x );
      let ph = 6.28318530718 * u.y;
      let dk = T * ( r * cos( ph ) ) + B * ( r * sin( ph ) );
      if ( kind == 0u ) { return vec4f( normalize( sunDir + dk * tanR ), 1e4 ); }
      let toL = lPos + dk * lR - o;
      let dist = length( toL );
      return vec4f( toL / dist, dist );
    }
  ` as N;
  const shadow1 = wgslTagFn`
    fn shadow1( P: vec3f, Nw: vec3f, sky: f32, eps: f32, xi: vec2f, kind: u32, sunDir: vec3f, tanR: f32, lPos: vec3f, lR: f32 ) -> vec2f {
      if ( sky > 0.5 ) { return vec2f( 1.0, 0.0 ); }
      let o = P + Nw * eps;
      let s = ${lightSample}( o, xi, kind, sunDir, tanR, lPos, lR );
      if ( dot( Nw, s.xyz ) <= 0.0 ) { return vec2f( 0.0, 0.0 ); }
      let ray = ${rayStruct}( o, s.xyz, s.w );
      var hit: ${rayIntersectionResultStruct};
      if ( ${raycast}( ray, &hit ) && hit.dist < s.w ) { return vec2f( 0.0, hit.dist ); }
      return vec2f( 1.0, 0.0 );
    }
  ` as N;
  // capture mode: grid x grid stratified white-noise rays to the shadow light (the visibility reference)
  const shadowRef = wgslTagFn`
    fn shadowRef( P: vec3f, Nw: vec3f, sky: f32, eps: f32, seed: u32, grid: u32, kind: u32, sunDir: vec3f, tanR: f32, lPos: vec3f, lR: f32 ) -> f32 {
      if ( sky > 0.5 ) { return 1.0; }
      let o = P + Nw * eps;
      var lit = 0.0;
      var s = seed;
      for ( var j = 0u; j < grid; j++ ) {
        for ( var i = 0u; i < grid; i++ ) {
          let r0 = ${pcgf}( &s );
          let r1 = ${pcgf}( &s );
          let ls = ${lightSample}( o, vec2f( ( f32( i ) + r0 ) / f32( grid ), ( f32( j ) + r1 ) / f32( grid ) ), kind, sunDir, tanR, lPos, lR );
          if ( dot( Nw, ls.xyz ) <= 0.0 ) { continue; }
          if ( ${unoccluded}( o, ls.xyz, ls.w ) ) { lit += 1.0; }
        }
      }
      return lit / f32( grid * grid );
    }
  ` as N;
  // the other light's direct visibility: one hard ray to its centre (noise-free)
  const hardVis = wgslTagFn`
    fn hardVis( P: vec3f, Nw: vec3f, sky: f32, eps: f32, kind: u32, sunDir: vec3f, lPos: vec3f ) -> f32 {
      if ( sky > 0.5 ) { return 1.0; }
      let o = P + Nw * eps;
      if ( kind == 0u ) { return select( 0.0, 1.0, dot( Nw, sunDir ) > 0.0 && ${unoccluded}( o, sunDir, 1e4 ) ); }
      let toL = lPos - o;
      let d = length( toL );
      return select( 0.0, 1.0, dot( Nw, toL ) > 0.0 && ${unoccluded}( o, toL / d, d ) );
    }
  ` as N;
  return { cosineDir, diffuse1, diffuseRef, shadow1, shadowRef, hardVis };
}
