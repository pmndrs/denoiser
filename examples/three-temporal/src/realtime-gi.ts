// three-temporal/realtime-gi: denoiser/realtime's DiffuseSpecularDenoiser and
// OcclusionDenoiser (experimental) on the shadows.ts scene, with three's stochastic SSR
// as the specular signal (the same SSR ffxReflections() gets on the other pages).
//
//   scene pass (MRT: albedo+metalness, packed view normal + roughness, velocity), no env lighting
//     |- diffuse: 1 cosine-weighted ray/pixel against the real scene (three-mesh-bvh): a miss
//     |     sees the environment, a hit returns the area light bounced off a grey (0.5) surface;
//     |     hit distance alongside (0 = miss). Demodulated (not multiplied by albedo).
//     |- specular: stochastic SSR of the lit image (radiance, ray length in .a)
//     |- shadows: 1 ray/pixel to the area light -> realtimeShadows() (both sides)
//     |- realtimeDiffuseSpecular({ diffuse, specular })  ours, one dispatch for both
//     |- realtimeOcclusion(diffuse hit distance)          ours, AO
//     |- ffxReflections(ssr)                              FidelityFX, for the specular comparison
//     '- lit = albedo * (diffuse + E(panel) * visibility) + specular -> ACES -> sRGB
//
// Split view: left = what you'd have without denoiser/realtime (raw 1-ray diffuse / AO,
// FFX reflections), right = ours. References accumulate many independent samples while
// the camera holds still.
//
// Moving camera (results/M6-real-scene.md, "moving camera"):
//   ?path=orbit         the camera follows the scripted 64-frame path of src/realtime/path.ts
//                       (slow orbit, then a fast pan; loops, denoisers reset at the wrap)
//   ?path=orbit&ref=1   capture mode: builds the per-pose reference graph (float32 signal targets,
//                       a stratified visibility reference, 16 diffuse rays/frame, SSR lit by the
//                       converged references) and exposes __t.capturePath({ name, start, frames,
//                       refShadow, refDiffuse, refSpec }), which freezes each path pose, renders
//                       its 1-ray signals and guides, accumulates its references, and writes a
//                       CAPTURE-FORMAT v0 capture through tools/rt-capture's writer
//                       (`node run-realtime.mjs capture`, examples/three-temporal/CAPTURES.md).
import * as THREE from 'three/webgpu';
import {
  float, vec2, vec3, vec4, uniform, uint, screenCoordinate, pass, mrt, diffuseColor, normalView,
  materialMetalness, materialRoughness, packNormalToRGB, unpackRGBToNormal, velocity, getViewPosition,
  convertToTexture, renderOutput, uv, select, sample, texture, output, mix,
} from 'three/tsl';
import { ssr } from 'three/addons/tsl/display/SSRNode.js';
import { BVHComputeData, wgslTagFn, rayStruct, rayIntersectionResultStruct } from 'three-mesh-bvh/webgpu';
import { ffxReflections, realtimeDiffuse, realtimeDiffuseSpecular, realtimeOcclusion, realtimeShadows, realtimeSpecular } from 'denoiser/three';
import type { TemporalDenoiseNode } from 'denoiser/three';
import { mountShell } from '../../_shared/shell';
import { prepareFlip, flipMean } from '../../realtime-denoiser/src/flip';
import {
  type N, LIGHT_C, LIGHT_N, LIGHT_U, LIGHT_V, LIGHT_ASPECT, buildScene, pose, equivalentSphereRadius, blueNoise,
  AccumulateNode, readTexture, nonFiniteCount, psnr, envRadianceWgsl,
} from './realtime/scene';
import { PATH_DESCRIPTION, PATH_FRAMES, PAN_START, pathPose } from './realtime/path';
import { CaptureWriter } from '../../../tools/rt-capture/src/writer';

mountShell({ id: 'three-temporal-realtime-gi' });

const q = new URLSearchParams(location.search);
const W = Number(q.get('w') ?? 960), H = Number(q.get('h') ?? 540);
const manual = q.has('manual');
const pathMode = q.get('path') === 'orbit';
const capMode = pathMode && q.get('ref') === '1';
const DIF_RAYS = capMode ? 16 : 4; // diffuse reference rays per pixel per frame
const ENV_I = 0.28; // shadows.ts's scene.environmentIntensity
const AO_A = 1, AO_B = 0.05; // OcclusionDenoiser's default hit-distance curve: h / (h + a + b * depth)

type Signal = 'lit' | 'diffuse' | 'specular' | 'ao';
type View = 'split' | 'ours' | 'other' | 'noisy' | 'ref';
const OTHER: Record<Signal, string> = { lit: 'raw diffuse + FFX reflections', diffuse: 'raw 1 ray/pixel', specular: 'ffxReflections()', ao: 'raw 1 ray/pixel' };
const OURS: Record<Signal, string> = {
  lit: 'realtimeDiffuseSpecular() + realtimeShadows()', diffuse: 'realtimeDiffuseSpecular().diffuse',
  specular: 'realtimeDiffuseSpecular().specular', ao: 'realtimeOcclusion()',
};

const statusEl = document.querySelector<HTMLPreElement>('#status')!;
const log = (m: string) => { statusEl.textContent = m; console.log('[realtime-gi]', m); };

async function main() {
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

  const { scene, camera, env, room, knot, floorMat, topMat } = buildScene(W, H);
  scene.environment = null; // indirect light comes from the traced diffuse signal and SSR only
  scene.updateMatrixWorld(true);
  const bvh = new BVHComputeData(room);
  bvh.update();
  let tris = 0;
  room.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) tris += (m.geometry.index?.count ?? m.geometry.attributes.position.count) / 3; });

  const raycast = (bvh.fns as N).raycastFirstHit;
  // WGSL helpers (one function per wgslTagFn; interpolating one into another includes it)
  const envFn = wgslTagFn`${envRadianceWgsl()}` as N;
  // panel irradiance, same convention as the direct term below
  const panelIrr = wgslTagFn`
    fn panelIrradiance( P: vec3f, Nw: vec3f, C: vec3f, nL: vec3f, power: f32 ) -> f32 {
      let L = C - P;
      let d2 = max( dot( L, L ), 1e-3 );
      let l = L * inverseSqrt( d2 );
      return power * max( dot( Nw, l ), 0.0 ) * max( dot( nL, - l ), 0.0 ) / d2;
    }
  ` as N;
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
  const pcgf = wgslTagFn`
    fn pcgf( s: ptr<function, u32> ) -> f32 {
      *s = *s * 747796405u + 2891336453u;
      let w = ( ( *s >> ( ( *s >> 28u ) + 4u ) ) ^ *s ) * 277803737u;
      return f32( ( w >> 22u ) ^ w ) / 4294967296.0;
    }
  ` as N;
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
  // capture mode: grid x grid stratified white-noise shadow rays (the visibility reference, as in realtime-shadows)
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

  const uLightC = uniform(LIGHT_C.clone());
  const uLightU = uniform(LIGHT_U.clone().multiplyScalar(0.3 * LIGHT_ASPECT));
  const uLightV = uniform(LIGHT_V.clone().multiplyScalar(0.3));
  const uLightN = uniform(LIGHT_N.clone());
  const uLightPower = uniform(30);
  const uFrame = uniform(0, 'uint'); // blue-noise frame index of the 1-ray signals (= path frame in capture mode)
  const uSeed = uniform(0, 'uint');  // white-noise seed of the references: every rendered frame
  const uSplit = uniform(0.5);
  const uRough = uniform(Number(q.get('roughness') ?? 0.12));
  const xi = await blueNoise(uFrame);

  const camWorld = uniform(new THREE.Matrix4());
  camWorld.onFrameUpdate(() => { camera.updateMatrixWorld(); camWorld.value.copy(camera.matrixWorld); });
  const projInv = uniform(camera.projectionMatrixInverse);
  // capture mode: the previous PATH pose (not the previous rendered frame) for motion / motion_z
  const uPrevView = uniform(new THREE.Matrix4());
  const uPrevViewProj = uniform(new THREE.Matrix4());
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

  // 1-ray signals: diffuse (rgb, hit distance) and shadow (visibility, occluder distance)
  const difRTT = convertToTexture(diffuse1(s0.P, s0.N, s0.sky, eps, vec2(xi(2), xi(3)), uLightC, uLightN, uLightPower, float(ENV_I)), null, null, sigOpts);
  const difHitRTT = convertToTexture(vec4(difRTT.sample(uv()).a, 0, 0, 1));
  const shRTT = convertToTexture(vec4(areaShadow1(s0.P, s0.N, s0.sky, uLightC, uLightU, uLightV, uLightN, eps, vec2(xi(0), xi(1))), 0, 1), null, null, sigOpts);
  const shDistRTT = convertToTexture(vec4(shRTT.sample(uv()).g, 0, 0, 1));
  // noisy AO, normalized per sample like the reference
  const aoNoisy = (h: N) => select(h.lessThanEqual(0), float(1), h.div(h.add(AO_A).add(s0.depth.mul(AO_B))));
  const aoNoisyRTT = convertToTexture(vec4(aoNoisy(difRTT.sample(uv()).a), 0, 0, 1));

  const guides = { camera, depth: depthTex, velocity: velTex, normal: nTex, normalSpace: 'view' as const, normalEncoding: 'packed' as const };
  const shadows = realtimeShadows(shRTT, {
    ...guides, hitDistance: shDistRTT,
    light: () => ({ type: 'sphere', position: [LIGHT_C.x, LIGHT_C.y, LIGHT_C.z], radius: equivalentSphereRadius(0.3) }),
  });
  const albedoD = () => { const a = dTex.sample(uv()); return a.rgb.mul(float(1).sub(a.a)); };
  const directOf = (vis: N) => {
    const s = surface(uv());
    const L = uLightC.sub(s.P);
    const d2 = L.dot(L).max(1e-3);
    const l = L.normalize();
    return uLightPower.mul(s.N.dot(l).max(0)).mul(uLightN.dot(l.negate()).max(0)).div(d2).mul(vis).mul(float(1).sub(s.sky));
  };

  // SSR of the lit image. Its diffuse is LAST frame's denoised diffuse (a plain texture of the
  // node's output, not a graph dependency: the specular denoiser runs in the same dispatch).
  const prevDiffuse = texture(new THREE.Texture());
  // capture mode: SSR reflects the image lit by this pose's converged references (diffuse + visibility),
  // so the noisy SSR sample and the SSR reference share one input and no denoiser output enters a capture
  const refDifTex = texture(new THREE.Texture());
  const refVisTex = texture(new THREE.Texture());
  const ssrLit = capMode
    ? convertToTexture(vec4(albedoD().mul(refDifTex.sample(uv()).rgb.add(directOf(refVisTex.sample(uv()).r))), 1))
    : convertToTexture(vec4(albedoD().mul(prevDiffuse.sample(uv()).rgb.add(directOf(shadows.r))), 1));
  const ssrNode = ssr(ssrLit, depthTex, sample((uvN: N) => unpackRGBToNormal(nTex.sample(uvN).rgb)), {
    stochastic: true, camera, diffuseNode: dTex, metalnessNode: dTex.a, roughnessNode: nTex.a, envImportanceSampling: true,
  } as N) as N;
  ssrNode.setEnvMap(env);
  ssrNode.maxDistance.value = 4;
  ssrNode.thickness.value = 0.05;
  ssrNode.environmentIntensity.value = ENV_I;
  const ssrMask = ssrNode.a.greaterThan(0).select(float(1), float(0));

  // ?single=1: two independent nodes (realtimeDiffuse + realtimeSpecular) instead of the joint one;
  // ?ao=both: realtimeOcclusion with AO + SO (SO from the SSR ray length), the AO view shows .diffuse
  let gi: N;
  if (q.has('single')) {
    const d = realtimeDiffuse(difRTT, { ...guides, hitDistance: difHitRTT });
    const sp = realtimeSpecular(ssrNode, { ...guides, roughness: nTex.a });
    const pair = [d, sp] as N[];
    gi = {
      diffuse: d, specular: sp, pair,
      resetHistory: () => pair.forEach((n) => n.resetHistory()),
      getOutputTexture: (i: number) => pair[i].outputTexture,
      get denoiser() { return { gpuTimings: new Map([['total', pair.reduce((a, n) => a + (n.denoiser?.gpuTimings?.get('total') ?? 0), 0)]]) }; },
    };
  } else {
    gi = realtimeDiffuseSpecular(
      { diffuse: { radiance: difRTT, hitDistance: difHitRTT }, specular: { radiance: ssrNode } },
      { ...guides, roughness: nTex.a },
    );
  }
  const aoBoth = q.get('ao') === 'both';
  const aoNode = aoBoth
    ? realtimeOcclusion({ diffuse: difHitRTT, specular: ssrNode.a }, { ...guides, roughness: nTex.a, denoiser: { signal: 'both' } })
    : realtimeOcclusion(difHitRTT, guides);
  const ao: N = aoBoth ? Object.defineProperties(aoNode.diffuse, {
    resetHistory: { value: () => aoNode.resetHistory() },
    denoiser: { get: () => aoNode.denoiser },
  }) : aoNode;
  const ffxRefl = ffxReflections(ssrNode, { ...guides, roughness: nTex.a });
  prevDiffuse.value = gi.getOutputTexture(0);

  // references (static camera): 4 white-noise diffuse rays/frame (+ AO), SSR, shadow visibility via ours
  const difRef = new AccumulateNode(diffuseRef(s0.P, s0.N, s0.sky, eps, pixelSeed().add(uSeed.mul(7919)).add(uint(777)), uint(DIF_RAYS), s0.depth, uLightC, uLightN, uLightPower, float(ENV_I)));
  const specRef = new AccumulateNode(vec4(ssrNode.rgb.mul(ssrMask), ssrMask), 1, [ssrNode]);
  difRef.max = specRef.max = Number(q.get('refFrames') ?? 512);
  // capture mode only: visibility reference (4 x 4 stratified rays per frame; alpha = receiver mask)
  const visRef = new AccumulateNode(vec4(
    areaVisibility(s0.P, s0.N, s0.sky, uLightC, uLightU, uLightV, uLightN, eps, pixelSeed().add(uSeed.mul(7919)).add(uint(12345)), uint(4)),
    0, 0, float(1).sub(s0.sky)));

  // capture mode: the guides in CAPTURE-FORMAT v0 conventions (float32 targets)
  const capGuides = capMode ? (() => {
    const d = depthTex.sample(uv()).r;
    const sky = s0.sky.greaterThan(0.5);
    const Pv = getViewPosition(uv(), d, projInv);
    const P = camWorld.mul(vec4(Pv, 1)).xyz;
    const ndc = vec2(uv().x.mul(2).sub(1), float(1).sub(uv().y.mul(2)));
    const prevClip = uPrevViewProj.mul(vec4(P, 1));
    const motion = ndc.sub(prevClip.xy.div(prevClip.w));
    const motionZ = select(sky, float(0), uPrevView.mul(vec4(P, 1)).z.sub(Pv.z));
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

  const tm = (c: N) => c; // signals are shown through ACES like the lit image
  const colorOf = (sig: Signal, side: 'ours' | 'other' | 'noisy' | 'ref'): N => {
    const dif = side === 'ours' ? gi.diffuse.rgb : side === 'ref' ? (difRef as N).rgb : difRTT.sample(uv()).rgb;
    const spec = side === 'ours' ? gi.specular.rgb : side === 'other' ? ffxRefl.rgb : side === 'ref' ? (specRef as N).rgb : ssrNode.rgb;
    switch (sig) {
      case 'diffuse': return tm(dif);
      case 'specular': return tm(spec.mul(side === 'ref' ? float(1) : ssrMask));
      case 'ao': return vec3(side === 'ours' ? ao.r : side === 'ref' ? (difRef as N).a : aoNoisyRTT.sample(uv()).r);
      case 'lit': return albedoD().mul(dif.add(directOf(shadows.r))).add(spec.mul(side === 'ref' ? float(1) : ssrMask));
    }
  };

  const pipeline = new THREE.RenderPipeline(renderer);
  pipeline.outputColorTransform = false;
  const modes = { signal: (q.get('signal') ?? 'lit') as Signal, view: (q.get('view') ?? 'split') as View, all: false };
  const buildOutput = () => {
    const { signal: sig, view } = modes;
    let col: N;
    if (view === 'split') {
      const left = screenCoordinate.x.lessThan(uSplit.mul(W));
      const edge = screenCoordinate.x.sub(uSplit.mul(W)).abs().lessThan(1);
      col = select(edge, vec3(1, 1, 1), select(left, colorOf(sig, sig === 'specular' || sig === 'lit' ? 'other' : 'noisy'), colorOf(sig, 'ours')));
    } else col = colorOf(sig, view === 'other' ? (sig === 'specular' || sig === 'lit' ? 'other' : 'noisy') : view);
    // metrics: keep every denoiser and signal in the graph (nodes outside it don't run)
    if (modes.all && view !== 'ref') col = col.add(vec3(ao.r.add(aoNoisyRTT.sample(uv()).r).add(gi.specular.r).add(ffxRefl.r).mul(0)));
    // capture mode: the image shows the diffuse reference; every capture input stays in the graph
    if (capGuides) {
      const keep = [capGuides.g1, capGuides.normal, capGuides.motion, capGuides.albedo, capGuides.f0, difRTT, shRTT]
        .reduce((acc: N, t: N) => acc.add(t.sample(uv()).x), float(0) as N)
        .add((visRef as N).r).add((difRef as N).r).add((specRef as N).r).add(ssrNode.a);
      col = (difRef as N).rgb.add(vec3(keep.mul(0)));
    }
    pipeline.outputNode = (sig === 'ao'
      ? renderOutput(vec4(col, 1), THREE.NoToneMapping, THREE.SRGBColorSpace)
      : renderOutput(vec4(col, 1), THREE.ACESFilmicToneMapping, THREE.SRGBColorSpace)) as N;
    pipeline.needsUpdate = true;
  };

  // ---- animation + stepping -----------------------------------------------------------
  let t = Number(q.get('t') ?? 0), frame = 0, moving = !q.has('paused'), shot = Number(q.get('shot') ?? 0);
  const prevView = new THREE.Matrix4();
  let prevT = -1, prevRough = -1;
  const setRoughness = (r: number) => { uRough.value = r; floorMat.roughness = r; topMat.roughness = r; };
  setRoughness(uRough.value);
  let pathFrame = 0, capturing = false;
  const animate = () => {
    uSeed.value = frame;
    if (capturing) return; // capturePath() sets the pose, uFrame and the reference counters itself
    if (pathMode) {
      // scripted path: one path frame per rendered frame; the scene is frozen (knot at t = 0)
      if (moving && modes.view !== 'ref') {
        pathFrame = (pathFrame + 1) % PATH_FRAMES;
        if (pathFrame === 0) resetAll(); // the loop wraps: a camera cut
      }
      pathPose(camera, pathFrame);
      knot.rotation.set(0.4, 0, 0);
    } else {
      if (moving && modes.view !== 'ref') t += 1 / 60;
      pose(camera, shot, t);
      knot.rotation.set(0.4, t * 0.35, 0);
    }
    knot.updateMatrixWorld();
    (bvh as N).updateTransforms();
    if (!prevView.equals(camera.matrixWorld) || prevT !== t || prevRough !== uRough.value) { difRef.count.value = 0; specRef.count.value = 0; }
    prevView.copy(camera.matrixWorld);
    prevT = t; prevRough = uRough.value;
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
  const cap = document.querySelector<HTMLSpanElement>('#cap-view')!;
  const costEl = document.querySelector<HTMLSpanElement>('#cap-cost')!;
  const press = (id: string, v: string) => document.querySelectorAll<HTMLButtonElement>(`${id} button`).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === v)));
  const setSignal = (s: Signal) => { modes.signal = s; press('#seg-signal', s); buildOutput(); };
  const setView = (v: View) => {
    modes.view = v;
    if (v === 'ref') { difRef.count.value = 0; specRef.count.value = 0; }
    press('#seg-view', v); buildOutput();
  };
  const setMoving = (on: boolean) => { moving = on; press('#seg-motion', on ? 'on' : 'off'); };
  const resetAll = () => { for (const n of [gi, ao, ffxRefl, shadows]) n.resetHistory(); };
  const cut = () => { shot = 1 - shot; resetAll(); };
  document.querySelectorAll<HTMLButtonElement>('#seg-signal button').forEach((b) => b.addEventListener('click', () => setSignal(b.dataset.v as Signal)));
  document.querySelectorAll<HTMLButtonElement>('#seg-view button').forEach((b) => b.addEventListener('click', () => setView(b.dataset.v as View)));
  document.querySelectorAll<HTMLButtonElement>('#seg-motion button').forEach((b) => b.addEventListener('click', () => setMoving(b.dataset.v === 'on')));
  document.querySelector('#cut')!.addEventListener('click', cut);
  const roughIn = document.querySelector<HTMLInputElement>('#roughness')!;
  const roughOut = document.querySelector<HTMLOutputElement>('#roughness-v')!;
  const onRough = () => { const r = parseFloat(roughIn.value); setRoughness(r); roughOut.textContent = r.toFixed(2); };
  roughIn.value = String(uRough.value);
  roughIn.addEventListener('input', onRough); onRough();
  const splitIn = document.querySelector<HTMLInputElement>('#split')!;
  splitIn.addEventListener('input', () => { uSplit.value = parseFloat(splitIn.value); });
  canvas.addEventListener('pointermove', (e) => {
    if (!(e.buttons & 1) || modes.view !== 'split') return;
    const r = canvas.getBoundingClientRect();
    uSplit.value = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    splitIn.value = String(uSplit.value);
  });
  press('#seg-signal', modes.signal); press('#seg-view', modes.view); setMoving(moving);

  const nodes = { joint: gi, occlusion: ao, ffxReflections: ffxRefl, shadows } as Record<string, N>;
  const msOf = (node: N) => node.denoiser?.gpuTimings?.get('total') as number | undefined;
  setInterval(() => {
    const { signal: sig, view } = modes;
    cap.textContent = view === 'split' ? `left: ${OTHER[sig]} | right: ${OURS[sig]}`
      : view === 'ours' ? OURS[sig] : view === 'other' ? OTHER[sig] : view === 'noisy' ? 'raw 1-ray signals'
        : `reference - ${Math.min(difRef.count.value, difRef.max)} frames accumulated (camera held still)`;
    costEl.textContent = Object.entries(nodes).map(([k, n]) => [k, msOf(n)] as const).filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${k} ${v!.toFixed(2)}`).join(', ') + ` ms at ${W}x${H}`;
  }, 400);
  buildOutput();

  // ---- test hooks (run-realtime.mjs gi) -------------------------------------------------------
  const copyCanvas = document.createElement('canvas');
  copyCanvas.width = W; copyCanvas.height = H;
  const cctx = copyCanvas.getContext('2d')!;
  const tex = (n: N, i = 0): THREE.Texture => (n === ao && aoBoth ? (aoNode as unknown as TemporalDenoiseNode).getOutputTexture(0) : (n as TemporalDenoiseNode).getOutputTexture(i));
  /**
   * Capture mode (?path=orbit&ref=1): writes path frames [start, start + frames) as a CAPTURE-FORMAT v0
   * capture. Per frame: put the camera at the path pose (the previous path pose gives motion /
   * motion_z), render the 1-ray signals with blue-noise index = path frame, then hold the pose and
   * accumulate the references (visibility: 4 x 4 stratified white-noise rays per frame; diffuse + AO:
   * 16 white-noise cosine rays per frame; specular: SSR's own expectation over `refSpec` frames, lit
   * by the converged diffuse + visibility references, after one frame for the noisy SSR sample).
   */
  const capturePath = async (o: { name: string; start?: number; frames?: number; refShadow?: number; refDiffuse?: number; refSpec?: number; write?: boolean }) => {
    if (!capMode || !capGuides) throw new Error('capturePath needs ?path=orbit&ref=1');
    const start = o.start ?? 0;
    const n = Math.min(o.frames ?? PATH_FRAMES - start, PATH_FRAMES - start);
    const visFrames = Math.max(1, Math.round((o.refShadow ?? 1024) / 16));
    const difFrames = Math.max(1, Math.round((o.refDiffuse ?? 1024) / DIF_RAYS));
    const specFrames = Math.max(1, o.refSpec ?? 256);
    const write = o.write ?? true;
    visRef.max = visFrames; difRef.max = difFrames; specRef.max = specFrames;
    capturing = true;
    setMoving(false);
    modes.view = 'split'; buildOutput();
    knot.rotation.set(0.4, 0, 0); knot.updateMatrixWorld(); (bvh as N).updateTransforms();
    pathPose(camera, start);
    visRef.count.value = visFrames; difRef.count.value = difFrames; specRef.count.value = specFrames;
    await frames(3); await idle(); // compile; the renderer sets the camera's WebGPU projection here
    const N_ = W * H;
    const chan = (src: Float32Array, cs: number[], fn?: (v: number) => number) => {
      const out = new Float32Array(N_ * cs.length);
      for (let i = 0; i < N_; i++) for (let k = 0; k < cs.length; k++) { const v = src[i * 4 + cs[k]]; out[i * cs.length + k] = fn ? fn(v) : v; }
      return out;
    };
    const rd = async (tex: THREE.Texture) => (await readTexture(renderer, tex)).data;
    const rt = (n2: N) => n2.renderTarget!.texture as THREE.Texture;
    const lights = [{
      id: 'panel', type: 'sphere', position: [LIGHT_C.x, LIGHT_C.y, LIGHT_C.z] as [number, number, number],
      radius: equivalentSphereRadius(0.3), intensity: uLightPower.value, shadow: true,
    }];
    const writer = write ? new CaptureWriter(device, o.name) : null;
    await writer?.begin({
      scene: 'three-temporal-corner',
      generator: 'examples/three-temporal realtime-gi.html (capture mode, __t.capturePath)',
      width: W, height: H, lights, static: true, reversedDepth: false,
      referenceSpp: Math.min(visFrames * 16, difFrames * DIF_RAYS),
      // the diffuse signal is the bounce radiance arriving at the surface (never multiplied by albedo);
      // specular is three's stochastic SSR output, which carries its own GGX sample weight (not demodulated)
      demodulation: { diffuse: 'albedo', specular: 'none' },
      extra: {
        threeTemporal: {
          path: 'orbit', pathDescription: PATH_DESCRIPTION, start, frames: n, panStart: PAN_START,
          sampling: 'blue (1-ray signals: spatiotemporal blue noise, index = path frame)',
          references: {
            visibility: `${visFrames * 16} rays/pixel (4x4 stratified white noise per frame x ${visFrames} frames) to the rectangular panel`,
            diffuse: `${difFrames * DIF_RAYS} white-noise cosine rays/pixel (${DIF_RAYS}/frame x ${difFrames} frames), same estimator as the 1-ray signal`,
            ao: 'ao_ref (extra buffer, 1 ch): mean per-sample normalized hit distance h/(h + 1 + 0.05 * -viewz) of the diffuse reference rays, miss = 1 (OcclusionDenoiser default curve)',
            specular: `three SSR's own expectation: ${specFrames} stochastic SSR frames at the frozen pose, lit by the converged diffuse + visibility references (the noisy sample sees the same input)`,
          },
          light: {
            note: 'the real light is a rectangular panel; lights[0] is the sphere of equal area at its centre that ShadowDenoiser gets on the page',
            center: LIGHT_C.toArray(), halfU: uLightU.value.toArray(), halfV: uLightV.value.toArray(), normal: LIGHT_N.toArray(), power: uLightPower.value,
          },
          signals: {
            diffuse: '1 cosine ray/pixel against the scene BVH: miss = environment x 0.28, hit = panel irradiance bounced off a grey 0.5 surface (no secondary shadow ray)',
            specular: 'three SSRNode (stochastic, envImportanceSampling, maxDistance 4, thickness 0.05): incoming radiance x its GGX sample weight, firefly-clamped by SSR maxLuminance; specular_hitt = SSR ray length (x three\'s specular dominant factor), env misses -> 0',
            visibility: '1 ray/pixel to a blue-noise point on the panel; occluder_dist = hit distance along it, 0 when lit; 0 with visibility 0 = light below the horizon',
          },
          missing: [
            'specular is not demodulated (no exact E): manifest demodulation.specular = "none"',
            'no motion of objects: the torus knot is frozen on the path',
            'no jitter (raster without TAA)',
            'no so_ref (SSR misses are environment hits, not unoccluded rays)',
          ],
          roughness: uRough.value,
        },
      },
    });
    const prevView = new THREE.Matrix4(), prevProj = new THREE.Matrix4();
    const t0 = performance.now();
    const perFrameS: number[] = [];
    for (let k = 0; k < n; k++) {
      const tf = performance.now();
      const f = start + k;
      pathPose(camera, k === 0 ? f : f - 1);
      prevView.copy(camera.matrixWorldInverse); prevProj.copy(camera.projectionMatrix);
      pathPose(camera, f);
      uPrevView.value.copy(prevView);
      uPrevViewProj.value.multiplyMatrices(prevProj, prevView);
      uFrame.value = f;
      // A: guides + 1-ray signals (the references take their first sample in the same frame)
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
      // B: hold the pose until the visibility and diffuse references are in
      const more = Math.max(visFrames, difFrames) - 1;
      if (more > 0) { await frames(more); await idle(); }
      refDifTex.value = difRef.result; refVisTex.value = visRef.result;
      // C: one frame for the noisy SSR sample (SSR now reflects the reference-lit image), then its reference
      await frames(1); await idle();
      const ssr = await rd((ssrNode as N).getTextureNode().value);
      bufs.specular = chan(ssr, [0, 1, 2]);
      bufs.specular_hitt = chan(ssr, [3], (a) => (a > 1e3 ? 0 : a));
      specRef.count.value = 0;
      await frames(specFrames); await idle();
      const dref = await rd(difRef.result);
      bufs.diffuse_ref = chan(dref, [0, 1, 2]);
      bufs.ao_ref = { data: chan(dref, [3]), channels: 1 };
      bufs.visibility_ref = chan(await rd(visRef.result), [0]);
      bufs.specular_ref = chan(await rd(specRef.result), [0, 1, 2]);
      const fc = {
        view: camera.matrixWorldInverse.elements.slice(), projection: camera.projectionMatrix.elements.slice(),
        prevView: prevView.elements.slice(), prevProjection: prevProj.elements.slice(),
        jitter: [0, 0] as [number, number], near: camera.near, far: camera.far,
        position: camera.position.toArray() as [number, number, number],
      };
      await writer?.writeFrame({ reset: k === 0, camera: fc, extra: { pathFrame: f } }, bufs);
      perFrameS.push((performance.now() - tf) / 1000);
      log(`capture ${o.name}: frame ${k + 1}/${n} (path frame ${f}) ${perFrameS.at(-1)!.toFixed(2)} s`);
    }
    const res = writer ? await writer.finish() : null;
    capturing = false;
    const bad = gpuErrors.length;
    return { name: o.name, path: res?.path ?? null, frames: n, start, refRays: { visibility: visFrames * 16, diffuse: difFrames * DIF_RAYS, specularFrames: specFrames }, seconds: +((performance.now() - t0) / 1000).toFixed(1), perFrameS: perFrameS.map((s) => +s.toFixed(2)), gpuErrors: bad };
  };

  const api = {
    ready: true,
    gpuErrors,
    capturePath,
    info: { three: THREE.REVISION, triangles: tris, w: W, h: H, pathMode, capMode },
    async step(n: number) { await frames(n); await idle(); },
    setModes(m: { signal?: Signal; view?: View; moving?: boolean; shot?: number; t?: number; roughness?: number; split?: number }) {
      if (m.signal) setSignal(m.signal);
      if (m.view) setView(m.view);
      if (m.moving !== undefined) setMoving(m.moving);
      if (m.shot !== undefined && m.shot !== shot) cut();
      if (m.t !== undefined) t = m.t;
      if (m.roughness !== undefined) { roughIn.value = String(m.roughness); onRough(); }
      if (m.split !== undefined) { uSplit.value = m.split; splitIn.value = String(m.split); }
    },
    cut,
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
    async costs(n = 60) {
      await frames(20); await idle();
      const acc: Record<string, Record<string, number[]>> = {};
      for (let i = 0; i < n; i++) {
        await frames(1);
        for (const [k, node] of Object.entries(nodes)) {
          const t2 = node.denoiser?.gpuTimings as Map<string, number> | undefined;
          if (!t2) continue;
          for (const [p, v] of t2) ((acc[k] ??= {})[p] ??= []).push(v);
        }
      }
      await idle();
      const stat = (v: number[]) => { const s = [...v].sort((a, b) => a - b); return { min: s[0], median: s[s.length >> 1], mean: v.reduce((a, b) => a + b, 0) / v.length }; };
      return Object.fromEntries(Object.entries(acc).map(([k, m]) => [k, Object.fromEntries(Object.entries(m).map(([p, v]) => [p, stat(v)]))]));
    },
    /**
     * Static camera vs the references: warm up, accumulate the references, reset the denoisers,
     * then PSNR at checkpoints (diffuse / specular on tonemapped x/(1+x) rgb, AO on ĥ) and FLIP at the end.
     */
    async metrics(o: { frames?: number; checkpoints?: number[]; ppd?: number } = {}) {
      const nFrames = o.frames ?? 64;
      const checkpoints = new Set(o.checkpoints ?? [1, 2, 4, 8, 16, 32, nFrames]);
      const ppd = o.ppd ?? W / 46.4;
      setMoving(false);
      const view0 = modes.view;
      modes.all = true;
      setView('split');
      await frames(64); // converge ours so the SSR input (last frame's denoised diffuse) is settled
      setView('ref');
      await frames(difRef.max + 2); await idle();
      const dref = (await readTexture(renderer, difRef.result)).data;
      const sref = (await readTexture(renderer, specRef.result)).data;
      const N_ = W * H;
      const recv = new Uint8Array(N_), smask = new Uint8Array(N_);
      for (let i = 0; i < N_; i++) { recv[i] = 1; smask[i] = sref[i * 4 + 3] > 0.5 ? 1 : 0; }
      setView('split');
      resetAll();
      const tmap = (v: number) => { const x = Math.max(0, v); return x / (1 + x); };
      const rows: Record<string, unknown>[] = [];
      let last: Record<string, Float32Array> = {};
      const aoRef = new Float32Array(N_ * 4); for (let i = 0; i < N_; i++) aoRef[i * 4] = dref[i * 4 + 3];
      for (let f = 1; f <= nFrames; f++) {
        await frames(1);
        if (!checkpoints.has(f)) continue;
        await idle();
        const difN = (await readTexture(renderer, difRTT.renderTarget!.texture)).data;
        const aoN = (await readTexture(renderer, aoNoisyRTT.renderTarget!.texture)).data;
        const ssrN = (await readTexture(renderer, (ssrNode as N).getTextureNode().value)).data;
        const imgs = {
          difOurs: (await readTexture(renderer, tex(gi, 0))).data,
          specOurs: (await readTexture(renderer, tex(gi, 1))).data,
          specFfx: (await readTexture(renderer, tex(ffxRefl))).data,
          aoOurs: (await readTexture(renderer, tex(ao))).data,
        };
        const row: Record<string, unknown> = {
          frame: f,
          diffuse: { noisy: +psnr(dref, difN, recv, tmap, [0, 1, 2]).toFixed(2), ours: +psnr(dref, imgs.difOurs, recv, tmap, [0, 1, 2]).toFixed(2) },
          specular: {
            noisy: +psnr(sref, ssrN, smask, tmap, [0, 1, 2]).toFixed(2),
            ffx: +psnr(sref, imgs.specFfx, smask, tmap, [0, 1, 2]).toFixed(2),
            ours: +psnr(sref, imgs.specOurs, smask, tmap, [0, 1, 2]).toFixed(2),
          },
          ao: { noisy: +psnr(aoRef, aoN, recv).toFixed(2), ours: +psnr(aoRef, imgs.aoOurs, recv).toFixed(2) },
          bad: Object.fromEntries(Object.entries(imgs).map(([k, d]) => [k, nonFiniteCount(d)])),
        };
        rows.push(row);
        last = { ...imgs, difN, ssrN, aoN };
      }
      const rgbOf = (d: Float32Array, map: (v: number) => number, mask?: Uint8Array) => {
        const g = new Float32Array(N_ * 3);
        for (let i = 0; i < N_; i++) for (let c = 0; c < 3; c++) g[3 * i + c] = mask && !mask[i] ? 0 : map(d[i * 4 + c]);
        return g;
      };
      const grayOf = (d: Float32Array) => { const g = new Float32Array(N_ * 3); for (let i = 0; i < N_; i++) g[3 * i] = g[3 * i + 1] = g[3 * i + 2] = Math.min(1, Math.max(0, d[i * 4])); return g; };
      const fD = prepareFlip(rgbOf(dref, tmap), W, H, ppd);
      const fS = prepareFlip(rgbOf(sref, tmap, smask), W, H, ppd);
      const fA = prepareFlip(grayOf(aoRef), W, H, ppd);
      const flip = {
        diffuse: { noisy: +flipMean(fD, prepareFlip(rgbOf(last.difN, tmap), W, H, ppd), recv).toFixed(4), ours: +flipMean(fD, prepareFlip(rgbOf(last.difOurs, tmap), W, H, ppd), recv).toFixed(4) },
        specular: {
          noisy: +flipMean(fS, prepareFlip(rgbOf(last.ssrN, tmap, smask), W, H, ppd), smask).toFixed(4),
          ffx: +flipMean(fS, prepareFlip(rgbOf(last.specFfx, tmap, smask), W, H, ppd), smask).toFixed(4),
          ours: +flipMean(fS, prepareFlip(rgbOf(last.specOurs, tmap, smask), W, H, ppd), smask).toFixed(4),
        },
        ao: { noisy: +flipMean(fA, prepareFlip(grayOf(last.aoN), W, H, ppd), recv).toFixed(4), ours: +flipMean(fA, prepareFlip(grayOf(last.aoOurs), W, H, ppd), recv).toFixed(4) },
      };
      let sPx = 0; for (let i = 0; i < N_; i++) sPx += smask[i];
      modes.all = false;
      setView(view0);
      return { w: W, h: H, refFrames: difRef.max, diffuseRefRays: difRef.max * 4, specularPx: sPx, ppd: +ppd.toFixed(1), rows, flip };
    },
  };
  (window as unknown as { __t: typeof api }).__t = api;
  log(`ready - three r${THREE.REVISION}, ${W}x${H}${manual ? ' (manual stepping)' : ''}; BVH: ${tris.toLocaleString()} triangles`);
}

main().catch((e) => { log(`ERROR: ${(e as Error).stack ?? e}`); console.error(e); (window as unknown as { __error?: string }).__error = String(e); });
