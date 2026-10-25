// three-temporal realtime pages on third-party scenes: realtime-gi.html?scene=sponza | bistro (and
// realtime-shadows.html?scene=..., which forwards here with &signal=shadow). The corner pages stay untouched:
// realtime-gi.ts only hands over to this module when ?scene= names an asset scene.
//
// Same signals and graph as realtime-gi.ts, adapted to a sun + a local light (src/realtime/scenes.ts):
//   scene pass (MRT: albedo+metalness, packed view normal + roughness, velocity), no env lighting
//     |- shadow: 1 ray/pixel to a blue-noise point on the path's shadow light (sun disk, or the local sphere)
//     |- diffuse: 1 cosine ray/pixel against the scene BVH (three-mesh-bvh): a miss sees the sky; a hit returns
//     |     sun + local light bounced off a grey 0.5 surface (a hard sun shadow ray at the hit point; the local
//     |     light unshadowed there, &bounceLocalShadow=1 adds its ray)
//     |- specular: three's stochastic SSR of the lit image (radiance, ray length in .a)
//     |- realtimeDiffuseSpecular / realtimeOcclusion / realtimeShadows (ours), ffxReflections / ffxShadows (FFX)
//     '- lit = albedo * (diffuse + E_shadow * visibility + E_other * hard visibility) + specular -> ACES -> sRGB
//   The other (non-shadow) light's direct term uses one hard ray to its centre (noise-free, not denoised).
//
//   ?scene=sponza|bistro            free-running slow orbit
//   ?scene=..&path=<sponza-orbit|sponza-pan|sponza-move|bistro-orbit|bistro-pan|bistro-move>
//                                   the scripted 64-frame paths of src/realtime/scenes.ts (loop, reset at the wrap)
//   ?scene=..&path=..&ref=1         capture mode: __t.capturePath({ name, start, frames, refShadow, refDiffuse, refSpec })
//                                   writes CAPTURE-FORMAT v0 captures with per-pose converged references
//                                   (`node run-realtime.mjs capture --set=sponza-orbit`, CAPTURES.md "Bistro and Sponza")
//   &cull=x0,y0,z0,x1,y1,z1          keep only triangles whose centroid is in that box (a documented subset)
import * as THREE from 'three/webgpu';
import {
  float, vec2, vec3, vec4, uniform, uint, screenCoordinate, pass, mrt, diffuseColor, normalView,
  materialMetalness, materialRoughness, packNormalToRGB, unpackRGBToNormal, velocity, getViewPosition,
  convertToTexture, renderOutput, uv, select, sample, texture, output, mix,
} from 'three/tsl';
import { ssr } from 'three/addons/tsl/display/SSRNode.js';
import { MeshBVH, SAH } from 'three-mesh-bvh';
import { BVHComputeData, wgslTagFn, rayStruct, rayIntersectionResultStruct } from 'three-mesh-bvh/webgpu';
import { ffxReflections, ffxShadows, realtimeDiffuseSpecular, realtimeOcclusion, realtimeShadows } from 'denoiser/three';
import type { TemporalDenoiseNode } from 'denoiser/three';
import { type N, blueNoise, AccumulateNode, readTexture, nonFiniteCount } from './realtime/scene';
import { loadAsset } from './realtime/assets';
import { SCENES, assetScene, pathOf, skyRadianceWgsl, makeSkyEnvironment } from './realtime/scenes';
import { CaptureWriter } from '../../../tools/rt-capture/src/writer';

const AO_A = 1, AO_B = 0.05; // OcclusionDenoiser's default hit-distance curve: h / (h + a + b * depth)

type Signal = 'lit' | 'diffuse' | 'specular' | 'ao' | 'shadow';
type View = 'split' | 'ours' | 'other' | 'noisy' | 'ref';
const OTHER: Record<Signal, string> = { lit: 'raw diffuse + FFX reflections + ffxShadows()', diffuse: 'raw 1 ray/pixel', specular: 'ffxReflections()', ao: 'raw 1 ray/pixel', shadow: 'ffxShadows()' };
const OURS: Record<Signal, string> = {
  lit: 'realtimeDiffuseSpecular() + realtimeShadows()', diffuse: 'realtimeDiffuseSpecular().diffuse',
  specular: 'realtimeDiffuseSpecular().specular', ao: 'realtimeOcclusion()', shadow: 'realtimeShadows()',
};

export async function main(log: (m: string) => void) {
  const q = new URLSearchParams(location.search);
  const W = Number(q.get('w') ?? 960), H = Number(q.get('h') ?? 540);
  const manual = q.has('manual');
  const sceneId = assetScene(q.get('scene'));
  if (!sceneId) throw new Error(`unknown ?scene=${q.get('scene')} (sponza | bistro)`);
  const cfg = SCENES[sceneId];
  const pathDef = pathOf(cfg, q.get('path'));
  if (q.get('path') && !pathDef) throw new Error(`unknown ?path=${q.get('path')} for ${sceneId} (${cfg.paths.map((p) => p.name).join(', ')})`);
  const capMode = !!pathDef && q.get('ref') === '1';
  const DIF_RAYS = capMode ? 16 : 4;
  const BOUNCE_LOCAL_SHADOW = q.get('bounceLocalShadow') === '1';
  const shadowLight = pathDef?.shadow ?? 'sun';
  const ENV_I = cfg.sky.intensity;

  document.title = `denoiser - realtime GI on ${cfg.label} (experimental)`;
  const h1 = document.querySelector('h1');
  if (h1) h1.firstChild!.textContent = `Realtime GI, reflections, AO and shadows: ${sceneId === 'sponza' ? 'Sponza' : 'Bistro'} `;
  const lede = document.querySelector('.dn-lede');
  if (lede) lede.textContent = `${cfg.label}: one sun-like light and one local light, traced at one ray per pixel with three-mesh-bvh (shadow ray, a diffuse bounce, AO from its hit distance) plus three's stochastic SSR, denoised by denoiser/three. Model: ${cfg.attribution}.`;
  const seg = document.querySelector('#seg-signal');
  if (seg && !seg.querySelector('[data-v="shadow"]')) seg.insertAdjacentHTML('beforeend', '<button data-v="shadow" aria-pressed="false">shadow</button>');

  const canvas = document.querySelector<HTMLCanvasElement>('#view')!;
  canvas.width = W; canvas.height = H;
  if (!navigator.gpu) { log('WebGPU is not available in this browser.'); return; }
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: false } as N);
  await renderer.init();
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  const device = (renderer.backend as unknown as { device: GPUDevice }).device;
  const gpuErrors: string[] = [];
  device.addEventListener('uncapturederror', (e) => {
    const msg = (e as GPUUncapturedErrorEvent).error.message;
    gpuErrors.push(msg);
    console.error('[webgpu uncapturederror]', msg);
  });
  device.lost.then((i) => log(`DEVICE LOST: ${i.reason} ${i.message}`));

  // ---- scene ----------------------------------------------------------------------------------
  log(`loading ${sceneId}...`);
  const cullQ = q.get('cull')?.split(',').map(Number);
  const cull = cullQ?.length === 6 ? new THREE.Box3(new THREE.Vector3(cullQ[0], cullQ[1], cullQ[2]), new THREE.Vector3(cullQ[3], cullQ[4], cullQ[5])) : undefined;
  const asset = await loadAsset(sceneId, { cull });
  log(`${sceneId}: ${asset.triangles.toLocaleString()} triangles (fetch ${asset.loadMs.fetch} ms, parse ${asset.loadMs.parse} ms); building the BVH...`);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x101216);
  for (const m of asset.meshes) { m.updateMatrixWorld(true); scene.add(m); }
  const camera = new THREE.PerspectiveCamera(cfg.fov, W / H, cfg.near, cfg.far);
  const useMover = !!cfg.mover && (!pathDef || !!pathDef.mover);
  const mover = useMover ? new THREE.Mesh(cfg.mover!.geometry(), new THREE.MeshStandardMaterial({ color: cfg.mover!.color, roughness: cfg.mover!.roughness, metalness: cfg.mover!.metalness })) : null;
  if (mover) { mover.matrixAutoUpdate = false; scene.add(mover); }
  // capture mode: the mover's pixels carry velocity.z = 1 (a per-material MRT override) for object motion
  if (capMode && mover) (mover.material as N).mrtNode = mrt({ velocity: vec4(velocity as N, 1, 1) });
  const env = makeSkyEnvironment(cfg);
  const setMover = (f: number) => {
    if (!mover) return;
    const m = (pathDef?.mover ?? cfg.paths.find((x) => x.mover)!.mover!)(f);
    mover.matrix.copy(m); mover.matrixWorld.copy(m);
  };
  setMover(0);
  const bvhMesh = new THREE.Mesh(asset.bvhGeometry);
  bvhMesh.updateMatrixWorld(true);
  const tB = performance.now();
  // SAH, small leaves (the default build is CENTER with 10-triangle leaves: ~2x slower rays on these scenes)
  (asset.bvhGeometry as N).boundsTree = new MeshBVH(asset.bvhGeometry, { strategy: SAH, targetLeafSize: Number(q.get('leaf') ?? 4) } as N);
  const bvh = new BVHComputeData(mover ? [bvhMesh, mover] : [bvhMesh]);
  bvh.update();
  const bvhMs = Math.round(performance.now() - tB);
  const tris = asset.triangles + (mover ? (mover.geometry.index!.count / 3) : 0);

  const raycast = (bvh.fns as N).raycastFirstHit;
  const skyFn = wgslTagFn`${skyRadianceWgsl(cfg)}` as N;
  const cosineDir = wgslTagFn`
    fn cosineDir( Nw: vec3f, xi: vec2f ) -> vec3f {
      let up = select( vec3f( 1.0, 0.0, 0.0 ), vec3f( 0.0, 1.0, 0.0 ), abs( Nw.y ) < 0.999 );
      let T = normalize( cross( up, Nw ) );
      let B = cross( Nw, T );
      let r = sqrt( xi.x );
      let ph = 6.28318530718 * xi.y;
      return normalize( T * ( r * cos( ph ) ) + B * ( r * sin( ph ) ) + Nw * sqrt( max( 0.0, 1.0 - xi.x ) ) );
    }
  ` as N;
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
  const pcgf = wgslTagFn`
    fn pcgf( s: ptr<function, u32> ) -> f32 {
      *s = *s * 747796405u + 2891336453u;
      let w = ( ( *s >> ( ( *s >> 28u ) + 4u ) ) ^ *s ) * 277803737u;
      return f32( ( w >> 22u ) ^ w ) / 4294967296.0;
    }
  ` as N;
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

  const sunDir = cfg.sun.toLight.clone().normalize();
  const sunE = new THREE.Vector3(...cfg.sun.color).multiplyScalar(cfg.sun.irradiance);
  const uSunDir = uniform(sunDir.clone());
  const uSunE = uniform(sunE.clone());
  const uTanR = uniform(Math.tan(cfg.sun.angularRadius));
  const uLPos = uniform(cfg.local.position.clone());
  const uLPow = uniform(new THREE.Vector3(...cfg.local.color).multiplyScalar(cfg.local.power));
  const uLR = uniform(cfg.local.radius);
  const kindShadow = uint(shadowLight === 'sun' ? 0 : 1);
  const kindOther = uint(shadowLight === 'sun' ? 1 : 0);
  const uFrame = uniform(0, 'uint');
  const uSeed = uniform(0, 'uint');
  const uSplit = uniform(0.5);
  const xi = await blueNoise(uFrame);

  const camWorld = uniform(new THREE.Matrix4());
  camWorld.onFrameUpdate(() => { camera.updateMatrixWorld(); camWorld.value.copy(camera.matrixWorld); });
  const projInv = uniform(camera.projectionMatrixInverse);
  const uPrevView = uniform(new THREE.Matrix4());
  const uPrevViewProj = uniform(new THREE.Matrix4());
  const uKnotPrev = uniform(new THREE.Matrix4());
  const sigOpts = capMode ? { type: THREE.FloatType } : {};

  // ---- graph ------------------------------------------------------------------------
  const scenePass = pass(scene, camera);
  scenePass.setMRT(mrt({
    output,
    diffuseColor: vec4(diffuseColor.rgb, materialMetalness),
    normal: vec4(packNormalToRGB(normalView), materialRoughness),
    velocity: vec4(velocity as N, 0, 1),
  }));
  const dTex = scenePass.getTextureNode('diffuseColor');
  const nTex = scenePass.getTextureNode('normal');
  const depthTex = scenePass.getTextureNode('depth');
  const velTex = scenePass.getTextureNode('velocity');
  const surface = (uvN: N) => {
    const d = depthTex.sample(uvN).r;
    const Pv = getViewPosition(uvN, d, projInv);
    const P = camWorld.mul(vec4(Pv, 1)).xyz;
    const Nw = camWorld.mul(vec4(unpackRGBToNormal(nTex.sample(uvN).rgb), 0)).xyz.normalize();
    return { P, N: Nw, sky: d.greaterThanEqual(0.99999).select(float(1), float(0)), viewDist: Pv.length(), depth: Pv.z.negate() };
  };
  const s0 = surface(uv());
  const eps = s0.viewDist.mul(0.002).add(0.004);
  const pixelSeed = () => { const px = screenCoordinate.xy.floor(); return uint(px.x).add(uint(px.y).mul(4099)).mul(uint(1973)); };

  // capture mode: 1 while a pose is held for its references; the 1-ray signals (read back before the hold) then
  // skip their rays (treated as sky), which saves ~20 % of a capture frame
  const uHold = uniform(0);
  const skyOrHold = s0.sky.max(uHold);
  const difRTT = convertToTexture(diffuse1(s0.P, s0.N, skyOrHold, eps, vec2(xi(2), xi(3)), uSunDir, uSunE, uLPos, uLPow, float(ENV_I)), null, null, sigOpts);
  const difHitRTT = convertToTexture(vec4(difRTT.sample(uv()).a, 0, 0, 1));
  const shRTT = convertToTexture(vec4(shadow1(s0.P, s0.N, skyOrHold, eps, vec2(xi(0), xi(1)), kindShadow, uSunDir, uTanR, uLPos, uLR), 0, 1), null, null, sigOpts);
  const shDistRTT = convertToTexture(vec4(shRTT.sample(uv()).g, 0, 0, 1));
  const otherVisRTT = convertToTexture(vec4(hardVis(s0.P, s0.N, s0.sky, eps, kindOther, uSunDir, uLPos), 0, 0, 1));
  const aoNoisy = (h: N) => select(h.lessThanEqual(0), float(1), h.div(h.add(AO_A).add(s0.depth.mul(AO_B))));
  const aoNoisyRTT = convertToTexture(vec4(aoNoisy(difRTT.sample(uv()).a), 0, 0, 1));

  const guides = { camera, depth: depthTex, velocity: velTex, normal: nTex, normalSpace: 'view' as const, normalEncoding: 'packed' as const };
  const lightOpt = () => (shadowLight === 'sun'
    ? { type: 'directional' as const, direction: [sunDir.x, sunDir.y, sunDir.z] as [number, number, number], angularRadius: cfg.sun.angularRadius }
    : { type: 'sphere' as const, position: [uLPos.value.x, uLPos.value.y, uLPos.value.z] as [number, number, number], radius: cfg.local.radius });
  const shadows = realtimeShadows(shRTT, { ...guides, hitDistance: shDistRTT, light: lightOpt });
  const ffxSh = ffxShadows(shRTT, guides);
  const albedoD = () => { const a = dTex.sample(uv()); return a.rgb.mul(float(1).sub(a.a)); };
  /** direct irradiance of one light times its visibility */
  const directOf = (kind: 'sun' | 'local', vis: N) => {
    const s = surface(uv());
    if (kind === 'sun') return uSunE.mul(s.N.dot(uSunDir).max(0)).mul(vis).mul(float(1).sub(s.sky));
    const L = uLPos.sub(s.P);
    const d2 = L.dot(L).max(0.01);
    return uLPow.mul(s.N.dot(L.normalize()).max(0)).div(d2).mul(vis).mul(float(1).sub(s.sky));
  };
  const otherKind = shadowLight === 'sun' ? 'local' : 'sun';
  const directBoth = (vis: N) => directOf(shadowLight, vis).add(directOf(otherKind, otherVisRTT.sample(uv()).r));

  const prevDiffuse = texture(new THREE.Texture());
  const refDifTex = texture(new THREE.Texture());
  const refVisTex = texture(new THREE.Texture());
  const ssrLit = capMode
    ? convertToTexture(vec4(albedoD().mul(refDifTex.sample(uv()).rgb.add(directBoth(refVisTex.sample(uv()).r))), 1))
    : convertToTexture(vec4(albedoD().mul(prevDiffuse.sample(uv()).rgb.add(directBoth(shadows.r))), 1));
  const ssrNode = ssr(ssrLit, depthTex, sample((uvN: N) => unpackRGBToNormal(nTex.sample(uvN).rgb)), {
    stochastic: true, camera, diffuseNode: dTex, metalnessNode: dTex.a, roughnessNode: nTex.a, envImportanceSampling: true,
  } as N) as N;
  ssrNode.setEnvMap(env);
  ssrNode.maxDistance.value = cfg.ssr.maxDistance;
  ssrNode.thickness.value = cfg.ssr.thickness;
  ssrNode.environmentIntensity.value = ENV_I;
  const ssrMask = ssrNode.a.greaterThan(0).select(float(1), float(0));

  const gi: N = realtimeDiffuseSpecular(
    { diffuse: { radiance: difRTT, hitDistance: difHitRTT }, specular: { radiance: ssrNode } },
    { ...guides, roughness: nTex.a },
  );
  const ao: N = realtimeOcclusion(difHitRTT, guides);
  const ffxRefl = ffxReflections(ssrNode, { ...guides, roughness: nTex.a });
  prevDiffuse.value = gi.getOutputTexture(0);

  const difRef = new AccumulateNode(diffuseRef(s0.P, s0.N, s0.sky, eps, pixelSeed().add(uSeed.mul(7919)).add(uint(777)), uint(DIF_RAYS), s0.depth, uSunDir, uSunE, uLPos, uLPow, float(ENV_I)));
  const specRef = new AccumulateNode(vec4(ssrNode.rgb.mul(ssrMask), ssrMask), 1, [ssrNode]);
  difRef.max = specRef.max = Number(q.get('refFrames') ?? 512);
  const visRef = new AccumulateNode(vec4(
    shadowRef(s0.P, s0.N, s0.sky, eps, pixelSeed().add(uSeed.mul(7919)).add(uint(12345)), uint(4), kindShadow, uSunDir, uTanR, uLPos, uLR),
    0, 0, float(1).sub(s0.sky)));
  visRef.max = Number(q.get('refFrames') ?? 512) / 4;

  const capGuides = capMode ? (() => {
    const d = depthTex.sample(uv()).r;
    const sky = s0.sky.greaterThan(0.5);
    const Pv = getViewPosition(uv(), d, projInv);
    const P = camWorld.mul(vec4(Pv, 1)).xyz;
    const ndc = vec2(uv().x.mul(2).sub(1), float(1).sub(uv().y.mul(2)));
    const onMover = velTex.sample(uv()).z.greaterThan(0.5);
    const Pprev = select(onMover, uKnotPrev.mul(vec4(P, 1)).xyz, P);
    const prevClip = uPrevViewProj.mul(vec4(Pprev, 1));
    const motion = ndc.sub(prevClip.xy.div(prevClip.w));
    const motionZ = select(sky, float(0), uPrevView.mul(vec4(Pprev, 1)).z.sub(Pv.z));
    const viewz = select(sky, float(-camera.far), Pv.z);
    const depth = select(sky, float(1), d);
    const a = dTex.sample(uv());
    const f32 = { type: THREE.FloatType };
    return {
      g1: convertToTexture(vec4(depth, viewz, nTex.sample(uv()).a, motionZ), null, null, f32),
      normal: convertToTexture(vec4(select(sky, vec3(0), s0.N), 0), null, null, f32),
      motion: convertToTexture(vec4(motion, 0, 0), null, null, f32),
      albedo: convertToTexture(vec4(a.rgb.mul(float(1).sub(a.a)), 0), null, null, f32),
      f0: convertToTexture(vec4(mix(vec3(0.04), a.rgb, a.a), 0), null, null, f32),
    };
  })() : null;

  const colorOf = (sig: Signal, side: 'ours' | 'other' | 'noisy' | 'ref'): N => {
    const dif = side === 'ours' ? gi.diffuse.rgb : side === 'ref' ? (difRef as N).rgb : difRTT.sample(uv()).rgb;
    const spec = side === 'ours' ? gi.specular.rgb : side === 'other' ? ffxRefl.rgb : side === 'ref' ? (specRef as N).rgb : ssrNode.rgb;
    const vis = side === 'ours' ? shadows.r : side === 'other' ? ffxSh.r : side === 'ref' ? (visRef as N).r : shRTT.sample(uv()).r;
    switch (sig) {
      case 'diffuse': return dif;
      case 'specular': return spec.mul(side === 'ref' ? float(1) : ssrMask);
      case 'ao': return vec3(side === 'ours' ? ao.r : side === 'ref' ? (difRef as N).a : aoNoisyRTT.sample(uv()).r);
      case 'shadow': return vec3(vis);
      case 'lit': return albedoD().mul(dif.add(directBoth(vis))).add(spec.mul(side === 'ref' ? float(1) : ssrMask));
    }
  };

  const pipeline = new THREE.RenderPipeline(renderer);
  pipeline.outputColorTransform = false;
  const modes = { signal: (q.get('signal') ?? 'lit') as Signal, view: (q.get('view') ?? 'split') as View };
  const buildOutput = () => {
    const { signal: sig, view } = modes;
    const otherSide = sig === 'specular' || sig === 'lit' || sig === 'shadow' ? 'other' : 'noisy';
    let col: N;
    if (view === 'split') {
      const left = screenCoordinate.x.lessThan(uSplit.mul(W));
      const edge = screenCoordinate.x.sub(uSplit.mul(W)).abs().lessThan(1);
      col = select(edge, vec3(1, 1, 1), select(left, colorOf(sig, otherSide), colorOf(sig, 'ours')));
    } else col = colorOf(sig, view === 'other' ? otherSide : view);
    if (capGuides) {
      const keep = [capGuides.g1, capGuides.normal, capGuides.motion, capGuides.albedo, capGuides.f0, difRTT, shRTT]
        .reduce((acc: N, t: N) => acc.add(t.sample(uv()).x), float(0) as N)
        .add((visRef as N).r).add((difRef as N).r).add((specRef as N).r).add(ssrNode.a);
      col = (difRef as N).rgb.add(vec3(keep.mul(0)));
    }
    pipeline.outputNode = (sig === 'ao' || sig === 'shadow'
      ? renderOutput(vec4(col, 1), THREE.NoToneMapping, THREE.SRGBColorSpace)
      : renderOutput(vec4(col, 1), THREE.ACESFilmicToneMapping, THREE.SRGBColorSpace)) as N;
    pipeline.needsUpdate = true;
  };

  // ---- animation + stepping -----------------------------------------------------------
  let t = Number(q.get('t') ?? 0), frame = 0, moving = !q.has('paused');
  const prevView = new THREE.Matrix4();
  let pathFrame = 0, capturing = false;
  const freeDir = cfg.free.position.clone().sub(cfg.free.target);
  const setPose = (f: number) => {
    if (pathDef) {
      const p = pathDef.pose(f);
      camera.position.copy(p.position); camera.lookAt(p.target);
      uLPos.value.copy(pathDef.local ? pathDef.local(f) : cfg.local.position);
      setMover(f);
    } else {
      camera.position.copy(cfg.free.target).add(freeDir.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.25 * Math.sin(f * 0.21 / 60)));
      camera.lookAt(cfg.free.target);
      setMover(f % 64);
    }
    camera.updateMatrixWorld();
    (bvh as N).updateTransforms();
  };
  const resetAll = () => { for (const n of [gi, ao, ffxRefl, shadows, ffxSh]) n.resetHistory(); };
  const animate = () => {
    uSeed.value = frame;
    if (capturing) return;
    if (pathDef) {
      if (moving && modes.view !== 'ref') {
        pathFrame = (pathFrame + 1) % pathDef.frames;
        if (pathFrame === 0) resetAll();
      }
      setPose(pathFrame);
    } else {
      if (moving && modes.view !== 'ref') t += 1;
      setPose(t);
    }
    if (!prevView.equals(camera.matrixWorld) || moving) { difRef.count.value = 0; specRef.count.value = 0; visRef.count.value = 0; }
    prevView.copy(camera.matrixWorld);
    uFrame.value = frame;
  };
  let job: { left: number; done: () => void } | null = null;
  const frames = (n: number) => new Promise<void>((res) => { job = { left: n, done: res }; });
  renderer.setAnimationLoop(() => {
    if (manual && !job) return;
    animate();
    pipeline.render();
    frame++;
    if (job && --job.left === 0) { const d = job.done; job = null; d(); }
  });
  const idle = () => device.queue.onSubmittedWorkDone();

  // ---- UI ---------------------------------------------------------------------------------
  const cap = document.querySelector<HTMLSpanElement>('#cap-view');
  const press = (id: string, v: string) => document.querySelectorAll<HTMLButtonElement>(`${id} button`).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === v)));
  const setSignal = (s: Signal) => { modes.signal = s; press('#seg-signal', s); buildOutput(); };
  const setView = (v: View) => {
    modes.view = v;
    if (v === 'ref') { difRef.count.value = 0; specRef.count.value = 0; visRef.count.value = 0; }
    press('#seg-view', v); buildOutput();
  };
  const setMoving = (on: boolean) => { moving = on; press('#seg-motion', on ? 'on' : 'off'); };
  document.querySelectorAll<HTMLButtonElement>('#seg-signal button').forEach((b) => b.addEventListener('click', () => setSignal(b.dataset.v as Signal)));
  document.querySelectorAll<HTMLButtonElement>('#seg-view button').forEach((b) => b.addEventListener('click', () => setView(b.dataset.v as View)));
  document.querySelectorAll<HTMLButtonElement>('#seg-motion button').forEach((b) => b.addEventListener('click', () => setMoving(b.dataset.v === 'on')));
  document.querySelector('#cut')?.addEventListener('click', resetAll);
  document.querySelector('#roughness')?.closest('.dn-group')?.setAttribute('hidden', '');
  const splitIn = document.querySelector<HTMLInputElement>('#split');
  splitIn?.addEventListener('input', () => { uSplit.value = parseFloat(splitIn.value); });
  canvas.addEventListener('pointermove', (e) => {
    if (!(e.buttons & 1) || modes.view !== 'split') return;
    const r = canvas.getBoundingClientRect();
    uSplit.value = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    if (splitIn) splitIn.value = String(uSplit.value);
  });
  press('#seg-signal', modes.signal); press('#seg-view', modes.view); setMoving(moving);
  setInterval(() => {
    if (!cap) return;
    const { signal: sig, view } = modes;
    cap.textContent = view === 'split' ? `left: ${OTHER[sig]} | right: ${OURS[sig]}`
      : view === 'ours' ? OURS[sig] : view === 'other' ? OTHER[sig] : view === 'noisy' ? 'raw 1-ray signals'
        : `reference - ${Math.min(difRef.count.value, difRef.max)} frames accumulated (camera held still)`;
  }, 400);
  buildOutput();

  // ---- test hooks (run-realtime.mjs) -------------------------------------------------------------
  const copyCanvas = document.createElement('canvas');
  copyCanvas.width = W; copyCanvas.height = H;
  const cctx = copyCanvas.getContext('2d')!;
  const tex = (n: N, i = 0): THREE.Texture => (n as TemporalDenoiseNode).getOutputTexture(i);
  const lightsOf = () => {
    const sun = { id: 'sun', type: 'directional', direction: [sunDir.x, sunDir.y, sunDir.z] as [number, number, number], angularRadius: cfg.sun.angularRadius, intensity: cfg.sun.irradiance, color: cfg.sun.color, shadow: shadowLight === 'sun' };
    const loc = { id: 'local', type: 'sphere', position: uLPos.value.toArray() as [number, number, number], radius: cfg.local.radius, intensity: cfg.local.power, color: cfg.local.color, shadow: shadowLight === 'local' };
    return shadowLight === 'sun' ? [sun, loc] : [loc, sun];
  };
  /** Capture mode: writes path frames [start, start + frames) as a CAPTURE-FORMAT v0 capture (see realtime-gi.ts capturePath). */
  const capturePath = async (o: { name: string; start?: number; frames?: number; refShadow?: number; refDiffuse?: number; refSpec?: number; write?: boolean }) => {
    if (!capMode || !capGuides || !pathDef) throw new Error('capturePath needs ?scene=..&path=..&ref=1');
    const start = o.start ?? 0;
    const n = Math.min(o.frames ?? pathDef.frames - start, pathDef.frames - start);
    const visFrames = Math.max(1, Math.round((o.refShadow ?? 1024) / 16));
    const difFrames = Math.max(1, Math.round((o.refDiffuse ?? 1024) / DIF_RAYS));
    const specFrames = Math.max(1, o.refSpec ?? 256);
    const write = o.write ?? true;
    visRef.max = visFrames; difRef.max = difFrames; specRef.max = specFrames;
    capturing = true;
    setMoving(false);
    modes.view = 'split'; buildOutput();
    setPose(start);
    visRef.count.value = visFrames; difRef.count.value = difFrames; specRef.count.value = specFrames;
    await frames(3); await idle();
    const N_ = W * H;
    const chan = (src: Float32Array, cs: number[], fn?: (v: number) => number) => {
      const out = new Float32Array(N_ * cs.length);
      for (let i = 0; i < N_; i++) for (let k = 0; k < cs.length; k++) { const v = src[i * 4 + cs[k]]; out[i * cs.length + k] = fn ? fn(v) : v; }
      return out;
    };
    const rd = async (tx: THREE.Texture) => (await readTexture(renderer, tx)).data;
    // hold the pose for n frames in chunks, waiting for the GPU between chunks (one long burst of queued
    // reference frames lost the device on these scenes)
    const hold = async (n2: number) => { for (let left = n2; left > 0; left -= 4) { await frames(Math.min(4, left)); await idle(); } };
    const rt = (n2: N) => n2.renderTarget!.texture as THREE.Texture;
    const writer = write ? new CaptureWriter(device, o.name) : null;
    await writer?.begin({
      scene: `three-temporal-${sceneId}`,
      generator: `examples/three-temporal realtime-gi.html?scene=${sceneId} (src/realtime-scenes.ts capture mode, __t.capturePath)`,
      width: W, height: H, lights: lightsOf(), static: !mover, reversedDepth: false,
      referenceSpp: Math.min(visFrames * 16, difFrames * DIF_RAYS),
      demodulation: { diffuse: 'albedo', specular: 'none' },
      extra: {
        threeTemporal: {
          scene: sceneId, model: cfg.attribution, triangles: tris, cull: cullQ ?? null,
          path: pathDef.name, pathDescription: pathDef.description, start, frames: n, shadowLight,
          ...(mover ? { moverMotion: 'object motion of the moving torus knot from its previous pose (motion, motion_z); the receivers of its shadow are static' } : {}),
          ...(pathDef.local ? { movingLight: 'the shadow light moves every frame (per-frame lights); receivers are static' } : {}),
          sampling: 'blue (1-ray signals: spatiotemporal blue noise, index = path frame)',
          references: {
            visibility: `${visFrames * 16} rays/pixel (4x4 stratified white noise per frame x ${visFrames} frames) to the ${shadowLight === 'sun' ? 'sun disk' : 'sphere light (disk facing the receiver)'}`,
            diffuse: `${difFrames * DIF_RAYS} white-noise cosine rays/pixel (${DIF_RAYS}/frame x ${difFrames} frames), same estimator as the 1-ray signal (incl. the hit-point shadow rays)`,
            ao: 'ao_ref (extra buffer, 1 ch): mean per-sample normalized hit distance h/(h + 1 + 0.05 * -viewz) of the diffuse reference rays, miss = 1 (OcclusionDenoiser default curve)',
            specular: `three SSR's own expectation: ${specFrames} stochastic SSR frames at the frozen pose, lit by the converged diffuse + visibility references (+ the other light's hard shadow)`,
          },
          signals: {
            diffuse: `1 cosine ray/pixel against the scene BVH: miss = sky x ${ENV_I}, hit = (sun + local light) bounced off a grey 0.5 surface: the sun with one hard shadow ray at the hit point, the local light ${BOUNCE_LOCAL_SHADOW ? 'with one too' : 'unshadowed at the hit point'}`,
            specular: `three SSRNode (stochastic, envImportanceSampling, maxDistance ${cfg.ssr.maxDistance}, thickness ${cfg.ssr.thickness}); specular_hitt = SSR ray length, env misses -> 0`,
            visibility: `1 ray/pixel to a blue-noise point on the ${shadowLight === 'sun' ? 'sun disk (angular radius ' + cfg.sun.angularRadius + ' rad)' : 'local sphere light (radius ' + cfg.local.radius + ' m)'}; occluder_dist = hit distance, 0 when lit`,
          },
          missing: [
            'specular is not demodulated (SSR output): manifest demodulation.specular = "none"',
            mover ? 'the torus knot is the only moving object (its pixels carry object motion)' : 'no object motion',
            'no jitter (raster without TAA)', 'no so_ref', 'textures dropped: flat material colours (albedo guide is flat per material)',
          ],
        },
      },
    });
    const pv = new THREE.Matrix4(), pp = new THREE.Matrix4();
    const t0 = performance.now();
    const perFrameS: number[] = [];
    for (let k = 0; k < n; k++) {
      const tf = performance.now();
      const f = start + k;
      setPose(k === 0 ? f : f - 1);
      pv.copy(camera.matrixWorldInverse); pp.copy(camera.projectionMatrix);
      const moverPrev = mover ? mover.matrixWorld.clone() : new THREE.Matrix4();
      setPose(f);
      uKnotPrev.value.copy(moverPrev).multiply(mover ? mover.matrixWorld.clone().invert() : new THREE.Matrix4());
      uPrevView.value.copy(pv);
      uPrevViewProj.value.multiplyMatrices(pp, pv);
      uFrame.value = f;
      visRef.count.value = 0; difRef.count.value = 0; specRef.count.value = specFrames;
      await frames(1); await idle();
      const g1 = await rd(rt(capGuides.g1));
      const bufs: Record<string, Float32Array | { data: Float32Array; channels: number }> = {
        depth: chan(g1, [0]), viewz: chan(g1, [1]), roughness: chan(g1, [2]), motion_z: chan(g1, [3]),
        normal: chan(await rd(rt(capGuides.normal)), [0, 1, 2]),
        motion: chan(await rd(rt(capGuides.motion)), [0, 1]),
        albedo: chan(await rd(rt(capGuides.albedo)), [0, 1, 2]),
        f0: chan(await rd(rt(capGuides.f0)), [0, 1, 2]),
      };
      const dif = await rd(rt(difRTT));
      bufs.diffuse = chan(dif, [0, 1, 2]); bufs.diffuse_hitt = chan(dif, [3]);
      const sh = await rd(rt(shRTT));
      bufs.visibility = chan(sh, [0]); bufs.occluder_dist = chan(sh, [1]);
      uHold.value = 1;
      const more = Math.max(visFrames, difFrames) - 1;
      await hold(more);
      refDifTex.value = difRef.result; refVisTex.value = visRef.result;
      await frames(1); await idle();
      const ssrT = await rd((ssrNode as N).getTextureNode().value);
      bufs.specular = chan(ssrT, [0, 1, 2]);
      bufs.specular_hitt = chan(ssrT, [3], (a) => (a > 1e3 ? 0 : a));
      specRef.count.value = 0;
      await hold(specFrames);
      const dref = await rd(difRef.result);
      bufs.diffuse_ref = chan(dref, [0, 1, 2]);
      bufs.ao_ref = { data: chan(dref, [3]), channels: 1 };
      bufs.visibility_ref = chan(await rd(visRef.result), [0]);
      bufs.specular_ref = chan(await rd(specRef.result), [0, 1, 2]);
      const fc = {
        view: camera.matrixWorldInverse.elements.slice(), projection: camera.projectionMatrix.elements.slice(),
        prevView: pv.elements.slice(), prevProjection: pp.elements.slice(),
        jitter: [0, 0] as [number, number], near: camera.near, far: camera.far,
        position: camera.position.toArray() as [number, number, number],
      };
      uHold.value = 0;
      await writer?.writeFrame({ reset: k === 0, camera: fc, extra: { pathFrame: f, lights: lightsOf() } }, bufs);
      perFrameS.push((performance.now() - tf) / 1000);
      log(`capture ${o.name}: frame ${k + 1}/${n} (path frame ${f}) ${perFrameS.at(-1)!.toFixed(2)} s`);
    }
    const res = writer ? await writer.finish() : null;
    capturing = false;
    return { name: o.name, path: res?.path ?? null, frames: n, start, refRays: { visibility: visFrames * 16, diffuse: difFrames * DIF_RAYS, specularFrames: specFrames }, seconds: +((performance.now() - t0) / 1000).toFixed(1), perFrameS: perFrameS.map((s) => +s.toFixed(2)), gpuErrors: gpuErrors.length };
  };

  const api = {
    ready: true,
    gpuErrors,
    capturePath,
    info: { three: THREE.REVISION, scene: sceneId, triangles: tris, bvhMs, loadMs: asset.loadMs, w: W, h: H, pathMode: pathDef?.name ?? null, capMode, shadowLight, cull: cullQ ?? null },
    async step(n: number) { await frames(n); await idle(); },
    setModes(m: { signal?: Signal; view?: View; moving?: boolean; split?: number; pathFrame?: number }) {
      if (m.signal) setSignal(m.signal);
      if (m.view) setView(m.view);
      if (m.moving !== undefined) setMoving(m.moving);
      if (m.split !== undefined) { uSplit.value = m.split; if (splitIn) splitIn.value = String(m.split); }
      if (m.pathFrame !== undefined) pathFrame = m.pathFrame;
    },
    cut: resetAll,
    reset: resetAll,
    async capture(): Promise<string> {
      await frames(1);
      cctx.drawImage(canvas, 0, 0);
      await idle();
      return copyCanvas.toDataURL('image/png');
    },
    async finiteCheck() {
      const r: Record<string, { w: number; h: number; bad: number }> = {};
      for (const [k, tx] of [['diffuse', tex(gi, 0)], ['specular', tex(gi, 1)], ['ao', tex(ao)], ['ffxReflections', tex(ffxRefl)], ['shadows', tex(shadows)]] as const) {
        const { w, h, data } = await readTexture(renderer, tx);
        r[k] = { w, h, bad: nonFiniteCount(data) };
      }
      return r;
    },
  };
  (window as unknown as { __t: typeof api }).__t = api;
  log(`ready - three r${THREE.REVISION}, ${W}x${H}${manual ? ' (manual stepping)' : ''}; ${sceneId}: ${tris.toLocaleString()} triangles, BVH ${bvhMs} ms, load ${asset.loadMs.fetch} + ${asset.loadMs.parse} ms${pathDef ? `; path ${pathDef.name} (shadow light: ${shadowLight})` : ''}`);
}
