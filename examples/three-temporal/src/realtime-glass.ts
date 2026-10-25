// three-temporal/realtime-glass: coloured shadows through a stained-glass panel (M8, SPEC v0.3 §7.10)
// on the furnished corner of realtime-shadows.ts. The shadow ray is traced at 1 ray per pixel against
// the real meshes (three-mesh-bvh, WebGPU: opaque visibility + occluder distance) and against an
// analytic glass panel (its transmittance T and distance; the panel's frame is opaque and in the BVH),
// so the renderer contract of SPEC M8-1 costs one ray-quad test per pixel.
//
//   scene pass (MRT: env-lit color, albedo+metalness, packed view normal, velocity)
//     |- 1 ray/pixel to a random point on the area light -> (visibility, occluder distance), (T rgb, h_tau)
//     |- realtimeShadows(v x lum(T), { hitDistance, light })                     grey: what a caller without M8 gets
//     |- realtimeShadows(v, { hitDistance, light, translucency: T, translucencyHitDistance })   ours: coloured
//     |- reference: 16 stratified rays/pixel/frame of v x T, accumulated while nothing moves
//     '- lit = env-lit color + albedo * E(light) * S -> ACES -> sRGB, the panel drawn analytically on top
//
// View: split (grey left, ours right), either alone, the raw 1-ray v x T, or the reference.
// ?moving=1: the panel slides (no motion vector follows its shadow over the static receiver).
// Test hooks: window.__t (metrics: static-camera RGB PSNR vs the reference; costs).
import * as THREE from 'three/webgpu';
import {
  float, vec2, vec3, vec4, uniform, uint, screenCoordinate, pass, mrt, output, diffuseColor, normalView,
  materialMetalness, materialRoughness, packNormalToRGB, unpackRGBToNormal, velocity, getViewPosition,
  convertToTexture, renderOutput, uv, select,
} from 'three/tsl';
import { BVHComputeData, wgslTagFn, rayStruct, rayIntersectionResultStruct } from 'three-mesh-bvh/webgpu';
import { realtimeShadows } from 'denoiser/three';
import type { TemporalDenoiseNode } from 'denoiser/three';
import { mountShell } from '../../_shared/shell';
import {
  type N, LIGHT_C, LIGHT_N, LIGHT_U, LIGHT_V, LIGHT_ASPECT, buildScene, equivalentSphereRadius, blueNoise,
  AccumulateNode, readTexture, nonFiniteCount,
} from './realtime/scene';

mountShell({ id: 'three-temporal-realtime-glass' });

const q = new URLSearchParams(location.search);
const W = Number(q.get('w') ?? 960), H = Number(q.get('h') ?? 540);
const manual = q.has('manual');
const shOptions: Record<string, unknown> = {};
for (const [k, v] of q) if (k.startsWith('sh.')) shOptions[k.slice(3)] = v === 'true' ? true : v === 'false' ? false : Number.isNaN(Number(v)) ? v : Number(v);

type View = 'split' | 'grey' | 'ours' | 'noisy' | 'ref';
type Show = 'lit' | 'mask';
const VIEW_LABEL: Record<View, string> = {
  split: 'left: realtimeShadows(v x lum(T)) | right: realtimeShadows(v, { translucency: T })',
  grey: '1 ray/pixel, v x lum(T) as plain visibility: right brightness, no colour',
  ours: '1 ray/pixel + realtimeShadows({ translucency }) (experimental)',
  noisy: '1 ray/pixel, raw v x T',
  ref: 'reference (16 rays/pixel/frame, accumulated)',
};
const statusEl = document.querySelector<HTMLPreElement>('#status')!;
const log = (s: string) => { statusEl.textContent = s; };

// ---- the glass panel: amber / blue stripes (alpha 0.85) in an opaque frame, facing the light -------
const PANEL_C0 = new THREE.Vector3(1.15, 1.0, 0.15);
const PANEL_HALF = [0.42, 0.3] as const;
const ALPHA = 0.85;
const KAPPA = [new THREE.Vector3(0.95, 0.55, 0.12), new THREE.Vector3(0.2, 0.5, 0.95)];

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
  device.addEventListener('uncapturederror', (e) => { const m = (e as GPUUncapturedErrorEvent).error.message; gpuErrors.push(m); console.error('[webgpu]', m); });

  const { scene, camera, room } = buildScene(W, H);
  // panel frame: opaque, in the BVH (its shadow is a dark outline around the coloured one)
  const pn = LIGHT_C.clone().sub(PANEL_C0).normalize();
  const pu = new THREE.Vector3().crossVectors(pn, new THREE.Vector3(0, 1, 0)).normalize();
  const pv = new THREE.Vector3().crossVectors(pu, pn).normalize();
  const frame = new THREE.Group();
  frame.matrixAutoUpdate = false;
  const barMat = new THREE.MeshStandardMaterial({ color: 0x2a2724, roughness: 0.5, metalness: 0.3 });
  const bar = 0.03;
  for (const [sx, sy, x, y] of [[2 * PANEL_HALF[0] + 2 * bar, bar, 0, PANEL_HALF[1] + bar / 2], [2 * PANEL_HALF[0] + 2 * bar, bar, 0, -PANEL_HALF[1] - bar / 2],
    [bar, 2 * PANEL_HALF[1], PANEL_HALF[0] + bar / 2, 0], [bar, 2 * PANEL_HALF[1], -PANEL_HALF[0] - bar / 2, 0]]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, 0.02), barMat);
    m.position.set(x, y, 0);
    frame.add(m);
  }
  room.add(frame);
  const panelC = PANEL_C0.clone();
  const placeFrame = () => {
    frame.matrix.makeBasis(pu, pv, pn).setPosition(panelC);
    frame.matrixWorldNeedsUpdate = true;
    frame.updateMatrixWorld(true);
  };
  placeFrame();
  scene.updateMatrixWorld(true);
  const bvh = new BVHComputeData(room);
  bvh.update();

  const uPC = uniform(panelC.clone());
  const uPU = uniform(pu.clone().multiplyScalar(1 / PANEL_HALF[0]));   // u = dot(X - C, uPU) in [-1, 1]
  const uPV = uniform(pv.clone().multiplyScalar(1 / PANEL_HALF[1]));
  const uPN = uniform(pn.clone());
  const k = (v: THREE.Vector3) => `vec3f(${v.x.toFixed(5)}, ${v.y.toFixed(5)}, ${v.z.toFixed(5)})`;
  // the panel's transmittance along a ray segment (o, dir, dist): (T rgb, distance; 0 = not crossed). Thin
  // film (RTG1-25 §25.2.1): t = (1 - alpha) + alpha kappa, kappa per stripe (6 stripes across u)
  const glassT = wgslTagFn`
    fn glassT( o: vec3f, dir: vec3f, dist: f32, C: vec3f, PU: vec3f, PV: vec3f, PN: vec3f ) -> vec4f {
      let dn = dot( dir, PN );
      if ( abs( dn ) < 1e-6 ) { return vec4f( 1.0, 1.0, 1.0, 0.0 ); }
      let t = dot( C - o, PN ) / dn;
      if ( t <= 0.0 || t >= dist ) { return vec4f( 1.0, 1.0, 1.0, 0.0 ); }
      let X = o + dir * t - C;
      let u = dot( X, PU );
      let v = dot( X, PV );
      if ( abs( u ) > 1.0 || abs( v ) > 1.0 ) { return vec4f( 1.0, 1.0, 1.0, 0.0 ); }
      let stripe = u32( floor( ( u + 1.0 ) * 3.0 ) ) % 2u;
      let kappa = select( ${k(KAPPA[0])}, ${k(KAPPA[1])}, stripe == 1u );
      return vec4f( vec3f( ${(1 - ALPHA).toFixed(4)} ) + ${ALPHA.toFixed(4)} * kappa, t );
    }
  ` as N;
  const lightPoint = wgslTagFn`
    fn lightPoint( C: vec3f, U: vec3f, V: vec3f, xi: vec2f ) -> vec3f { return C + U * ( xi.x * 2.0 - 1.0 ) + V * ( xi.y * 2.0 - 1.0 ); }
  ` as N;
  // 1 ray: (v, occluder distance) against the BVH, as realtime-shadows' areaShadow1
  const glassShadow1 = wgslTagFn`
    fn glassShadow1( P: vec3f, Nw: vec3f, sky: f32, C: vec3f, U: vec3f, V: vec3f, nL: vec3f, eps: f32, xi: vec2f ) -> vec2f {
      if ( sky > 0.5 ) { return vec2f( 1.0, 0.0 ); }
      let o = P + Nw * eps;
      let toL = ${lightPoint}( C, U, V, xi ) - o;
      let dist = length( toL );
      let dir = toL / dist;
      if ( dot( Nw, dir ) <= 0.0 || dot( nL, dir ) >= 0.0 ) { return vec2f( 0.0, 0.0 ); }
      let ray = ${rayStruct}( o, dir, dist );
      var hit: ${rayIntersectionResultStruct};
      if ( ${(bvh.fns as N).raycastFirstHit}( ray, &hit ) && hit.dist < dist ) { return vec2f( 0.0, hit.dist ); }
      return vec2f( 1.0, 0.0 );
    }
  ` as N;
  // the same ray's transmittance through the panel (T rgb, h_tau): the analytic part only (T is ignored where v = 0)
  const glassTrans1 = wgslTagFn`
    fn glassTrans1( P: vec3f, Nw: vec3f, sky: f32, C: vec3f, U: vec3f, V: vec3f, eps: f32, xi: vec2f, GC: vec3f, PU: vec3f, PV: vec3f, PN: vec3f ) -> vec4f {
      if ( sky > 0.5 ) { return vec4f( 1.0, 1.0, 1.0, 0.0 ); }
      let o = P + Nw * eps;
      let toL = ${lightPoint}( C, U, V, xi ) - o;
      let dist = length( toL );
      return ${glassT}( o, toL / dist, dist, GC, PU, PV, PN );
    }
  ` as N;
  // reference: grid x grid stratified rays, mean of v x T
  const glassRef = wgslTagFn`
    fn glassRef( P: vec3f, Nw: vec3f, sky: f32, C: vec3f, U: vec3f, V: vec3f, nL: vec3f, eps: f32, seed: u32, grid: u32, GC: vec3f, PU: vec3f, PV: vec3f, PN: vec3f ) -> vec3f {
      if ( sky > 0.5 ) { return vec3f( 1.0 ); }
      let o = P + Nw * eps;
      var acc = vec3f( 0.0 );
      var s = seed;
      for ( var j = 0u; j < grid; j++ ) {
        for ( var i = 0u; i < grid; i++ ) {
          s = s * 747796405u + 2891336453u;
          var w = ( ( s >> ( ( s >> 28u ) + 4u ) ) ^ s ) * 277803737u;
          let r0 = f32( ( w >> 22u ) ^ w ) / 4294967296.0;
          s = s * 747796405u + 2891336453u;
          w = ( ( s >> ( ( s >> 28u ) + 4u ) ) ^ s ) * 277803737u;
          let r1 = f32( ( w >> 22u ) ^ w ) / 4294967296.0;
          let toL = ${lightPoint}( C, U, V, vec2f( ( f32( i ) + r0 ) / f32( grid ), ( f32( j ) + r1 ) / f32( grid ) ) ) - o;
          let dist = length( toL );
          let dir = toL / dist;
          if ( dot( Nw, dir ) <= 0.0 || dot( nL, dir ) >= 0.0 ) { continue; }
          let ray = ${rayStruct}( o, dir, dist );
          var hit: ${rayIntersectionResultStruct};
          if ( ${(bvh.fns as N).raycastFirstHit}( ray, &hit ) && hit.dist < dist ) { continue; }
          acc += ${glassT}( o, dir, dist, GC, PU, PV, PN ).xyz;
        }
      }
      return acc / f32( grid * grid );
    }
  ` as N;

  const uLightC = uniform(LIGHT_C.clone());
  const uLightU = uniform(new THREE.Vector3());
  const uLightV = uniform(new THREE.Vector3());
  const uLightN = uniform(LIGHT_N.clone());
  const uLightPower = uniform(30);
  const uFrame = uniform(0, 'uint');
  const uSplit = uniform(0.5);
  const uCamPos = uniform(new THREE.Vector3());
  let lightHalf = Number(q.get('light') ?? 0.12);
  const setLightSize = (half: number) => {
    lightHalf = half;
    uLightU.value.copy(LIGHT_U).multiplyScalar(half * LIGHT_ASPECT);
    uLightV.value.copy(LIGHT_V).multiplyScalar(half);
  };
  setLightSize(lightHalf);
  const xiBlue = await blueNoise(uFrame);

  const camWorld = uniform(new THREE.Matrix4());
  camWorld.onFrameUpdate(() => { camera.updateMatrixWorld(); camWorld.value.copy(camera.matrixWorld); uCamPos.value.setFromMatrixPosition(camera.matrixWorld); });
  const projInv = uniform(camera.projectionMatrixInverse);
  const irradiance = (P: N, N_: N) => {
    const L = uLightC.sub(P);
    const d2 = L.dot(L).max(1e-3);
    const l = L.normalize();
    return uLightPower.mul(N_.dot(l).max(0)).mul(uLightN.dot(l.negate()).max(0)).div(d2);
  };

  // ---- graph ------------------------------------------------------------------------
  const scenePass = pass(scene, camera);
  scenePass.setMRT(mrt({
    output,
    diffuseColor: vec4(diffuseColor.rgb, materialMetalness),
    normal: vec4(packNormalToRGB(normalView), materialRoughness),
    velocity: vec4(velocity as N, 0, 1),
  }));
  const sceneColor = scenePass.getTextureNode('output');
  const dTex = scenePass.getTextureNode('diffuseColor');
  const nTex = scenePass.getTextureNode('normal');
  const depthTex = scenePass.getTextureNode('depth');
  const velTex = scenePass.getTextureNode('velocity');
  const surface = (uvN: N) => {
    const d = depthTex.sample(uvN).r;
    const Pv = getViewPosition(uvN, d, projInv);
    const P = camWorld.mul(vec4(Pv, 1)).xyz;
    const Nw = camWorld.mul(vec4(unpackRGBToNormal(nTex.sample(uvN).rgb), 0)).xyz.normalize();
    return { P, N: Nw, sky: d.greaterThanEqual(0.99999).select(float(1), float(0)), viewDist: Pv.length() };
  };
  const pixelSeed = () => {
    const px = screenCoordinate.xy.floor();
    return uint(px.x).add(uint(px.y).mul(4099)).mul(uint(1973));
  };
  const s0 = surface(uv());
  const eps = s0.viewDist.mul(0.002).add(0.004);
  const xi = vec2(xiBlue(0), xiBlue(1));
  const sigRTT = convertToTexture(vec4(glassShadow1(s0.P, s0.N, s0.sky, uLightC, uLightU, uLightV, uLightN, eps, xi), 0, 1));
  const distRTT = convertToTexture(vec4(sigRTT.sample(uv()).g, 0, 0, 1));
  const trRTT = convertToTexture(glassTrans1(s0.P, s0.N, s0.sky, uLightC, uLightU, uLightV, eps, xi, uPC, uPU, uPV, uPN));
  const trDistRTT = convertToTexture(vec4(trRTT.sample(uv()).a, 0, 0, 1));
  // the 1-ray coloured sample and its luminance (the grey baseline's input)
  const noisyRGB = convertToTexture(vec4(trRTT.sample(uv()).rgb.mul(sigRTT.sample(uv()).r), 1));
  const lumRTT = convertToTexture(vec4(noisyRGB.sample(uv()).rgb.dot(vec3(0.2126, 0.7152, 0.0722)), 0, 0, 1));
  const refAccum = new AccumulateNode(vec4(
    glassRef(s0.P, s0.N, s0.sky, uLightC, uLightU, uLightV, uLightN, eps, pixelSeed().add(uFrame.mul(7919)).add(uint(12345)), uint(4), uPC, uPU, uPV, uPN),
    float(1).sub(s0.sky)));
  refAccum.max = Number(q.get('refFrames') ?? 256);

  const guides = { camera, depth: depthTex, velocity: velTex, normal: nTex, normalSpace: 'view' as const, normalEncoding: 'packed' as const };
  const light = () => ({ type: 'sphere' as const, position: [LIGHT_C.x, LIGHT_C.y, LIGHT_C.z] as const, radius: equivalentSphereRadius(lightHalf) });
  const grey = realtimeShadows(lumRTT, { ...guides, hitDistance: distRTT, light, denoiser: shOptions });
  const ours = realtimeShadows(sigRTT, { ...guides, hitDistance: distRTT, light, translucency: trRTT, translucencyHitDistance: trDistRTT, denoiser: shOptions });

  const shadowOf = (v: Exclude<View, 'split'>): N => {
    switch (v) {
      case 'grey': return vec3(grey.r);
      case 'ours': return ours.rgb;
      case 'noisy': return noisyRGB.sample(uv()).rgb;
      case 'ref': return (refAccum as N).rgb;
    }
  };
  // the panel itself, drawn analytically over the image (it is not a mesh: the BVH and the G-buffer don't see it)
  const overlay = (col: N): N => {
    const s = surface(uv());
    const toP = s.P.sub(uCamPos);
    const dist = select(s.sky.greaterThan(0.5), float(100), toP.length());
    const g = glassT(uCamPos, toP.normalize(), dist, uPC, uPU, uPV, uPN);
    return select(g.w.greaterThan(0), col.mul(g.xyz).add(g.xyz.mul(0.04)), col);
  };
  const colorOf = (S: N, show: Show): N => {
    if (show === 'mask') return S;
    const s = surface(uv());
    const albedo = dTex.sample(uv());
    const diffuse = albedo.rgb.mul(float(1).sub(albedo.a));
    const direct = diffuse.mul(irradiance(s.P, s.N)).mul(S).mul(float(1).sub(s.sky));
    return overlay(sceneColor.sample(uv()).rgb.add(direct));
  };

  const pipeline = new THREE.RenderPipeline(renderer);
  pipeline.outputColorTransform = false;
  const modes = { view: (q.get('view') ?? 'split') as View, show: (q.get('show') ?? 'lit') as Show };
  const buildOutput = () => {
    let col: N;
    if (modes.view === 'split') {
      const left = screenCoordinate.x.lessThan(uSplit.mul(W));
      const edge = screenCoordinate.x.sub(uSplit.mul(W)).abs().lessThan(1);
      col = select(edge, vec3(1, 1, 1), select(left, colorOf(shadowOf('grey'), modes.show), colorOf(shadowOf('ours'), modes.show)));
    } else col = colorOf(shadowOf(modes.view), modes.show);
    // every denoiser stays in the graph (metrics read them in any view)
    col = col.add(grey.r.mul(0)).add(ours.r.mul(0));
    pipeline.outputNode = (modes.show === 'mask'
      ? renderOutput(vec4(col, 1), THREE.NoToneMapping, THREE.SRGBColorSpace)
      : renderOutput(vec4(col, 1), THREE.ACESFilmicToneMapping, THREE.SRGBColorSpace)) as N;
    pipeline.needsUpdate = true;
  };

  // ---- animation: fixed camera on the coloured shadow, the panel optionally sliding ---------------
  camera.position.set(-0.9, 1.9, 2.6);
  camera.lookAt(0.4, 0.35, 0.1);
  camera.updateMatrixWorld();
  let t = 0, frameNo = 0, moving = q.get('moving') === '1';
  let prevPanel = new THREE.Vector3(Infinity, 0, 0), prevLight = -1;
  const animate = () => {
    if (moving && modes.view !== 'ref') t += 1 / 60;
    panelC.copy(PANEL_C0).addScaledVector(pu, 0.3 * Math.sin(t * 0.6));
    placeFrame();
    (bvh as N).updateTransforms();
    uPC.value.copy(panelC);
    if (!prevPanel.equals(panelC) || prevLight !== lightHalf) refAccum.count.value = 0;
    prevPanel = panelC.clone(); prevLight = lightHalf;
    uFrame.value = frameNo;
  };
  let job: { left: number; done: () => void } | null = null;
  const frames = (n: number) => new Promise<void>((res) => { job = { left: n, done: res }; });
  renderer.setAnimationLoop(() => {
    if (manual && !job) return;
    animate();
    pipeline.render();
    frameNo++;
    if (job && --job.left === 0) { const d = job.done; job = null; d(); }
  });
  const idle = () => device.queue.onSubmittedWorkDone();

  // ---- UI -------------------------------------------------------------------------------
  const cap = document.querySelector<HTMLSpanElement>('#cap-view')!;
  const costEl = document.querySelector<HTMLSpanElement>('#cap-cost')!;
  const press = (id: string, v: string) => document.querySelectorAll<HTMLButtonElement>(`${id} button`).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === v)));
  const setView = (v: View) => { modes.view = v; if (v === 'ref') refAccum.count.value = 0; press('#seg-view', v); buildOutput(); };
  const setShow = (s: Show) => { modes.show = s; press('#seg-show', s); buildOutput(); };
  const setMoving = (on: boolean) => { moving = on; press('#seg-motion', on ? 'on' : 'off'); };
  document.querySelectorAll<HTMLButtonElement>('#seg-view button').forEach((b) => b.addEventListener('click', () => setView(b.dataset.v as View)));
  document.querySelectorAll<HTMLButtonElement>('#seg-show button').forEach((b) => b.addEventListener('click', () => setShow(b.dataset.v as Show)));
  document.querySelectorAll<HTMLButtonElement>('#seg-motion button').forEach((b) => b.addEventListener('click', () => setMoving(b.dataset.v === 'on')));
  document.querySelector('#cut')!.addEventListener('click', () => { grey.resetHistory(); ours.resetHistory(); });
  const lightIn = document.querySelector<HTMLInputElement>('#light-size')!;
  const lightOut = document.querySelector<HTMLOutputElement>('#light-size-v')!;
  const onLight = () => { const h = parseFloat(lightIn.value); setLightSize(h); lightOut.textContent = `${(h * 2 * LIGHT_ASPECT).toFixed(2)} x ${(h * 2).toFixed(2)} m`; };
  lightIn.value = String(lightHalf);
  lightIn.addEventListener('input', onLight); onLight();
  const splitIn = document.querySelector<HTMLInputElement>('#split')!;
  splitIn.addEventListener('input', () => { uSplit.value = parseFloat(splitIn.value); });
  canvas.addEventListener('pointermove', (e) => {
    if (!(e.buttons & 1) || modes.view !== 'split') return;
    const r = canvas.getBoundingClientRect();
    uSplit.value = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    splitIn.value = String(uSplit.value);
  });
  press('#seg-view', modes.view); press('#seg-show', modes.show); setMoving(moving);
  const msOf = (node: N) => node.denoiser?.gpuTimings?.get('total') as number | undefined;
  setInterval(() => {
    cap.textContent = VIEW_LABEL[modes.view] + (modes.view === 'ref' ? ` - ${Math.min(refAccum.count.value, refAccum.max) * 16} rays/pixel so far` : '');
    const g = msOf(grey), o = msOf(ours);
    costEl.textContent = [g !== undefined ? `grey ${g.toFixed(2)} ms` : '', o !== undefined ? `coloured ${o.toFixed(2)} ms` : ''].filter(Boolean).join(', ');
  }, 400);
  buildOutput();

  // ---- test hooks -------------------------------------------------------------------------
  const copyCanvas = document.createElement('canvas');
  copyCanvas.width = W; copyCanvas.height = H;
  const cctx = copyCanvas.getContext('2d')!;
  const outTex = (node: N): THREE.Texture => (node as TemporalDenoiseNode).outputTexture;
  const api = {
    ready: true,
    gpuErrors,
    info: { three: THREE.REVISION, w: W, h: H },
    get frame() { return frameNo; },
    async step(n: number) { await frames(n); await idle(); },
    setModes(m: { view?: View; show?: Show; moving?: boolean; t?: number; lightSize?: number; split?: number }) {
      if (m.view) setView(m.view);
      if (m.show) setShow(m.show);
      if (m.moving !== undefined) setMoving(m.moving);
      if (m.t !== undefined) t = m.t;
      if (m.lightSize !== undefined) { lightIn.value = String(m.lightSize); onLight(); }
      if (m.split !== undefined) { uSplit.value = m.split; splitIn.value = String(m.split); }
    },
    reset() { grey.resetHistory(); ours.resetHistory(); },
    async capture(): Promise<string> { await frames(1); cctx.drawImage(canvas, 0, 0); await idle(); return copyCanvas.toDataURL('image/png'); },
    async finiteCheck() {
      const r: Record<string, number> = {};
      for (const [kk, tex] of [['grey', outTex(grey)], ['ours', outTex(ours)]] as const) r[kk] = nonFiniteCount((await readTexture(renderer, tex)).data);
      return r;
    },
    /** Mean / min per-pass GPU ms of both denoisers over n frames. */
    async costs(n = 60) {
      await frames(20); await idle();
      const acc: Record<string, Record<string, number[]>> = { grey: {}, ours: {} };
      for (let i = 0; i < n; i++) {
        await frames(1);
        for (const [kk, node] of [['grey', grey], ['ours', ours]] as const) {
          const tm = (node as N).denoiser?.gpuTimings as Map<string, number> | undefined;
          if (tm) for (const [p, v] of tm) (acc[kk][p] ??= []).push(v);
        }
      }
      await idle();
      const stat = (v: number[]) => { const s = [...v].sort((a, b) => a - b); return { min: s[0], median: s[s.length >> 1] }; };
      return Object.fromEntries(Object.entries(acc).map(([kk, m]) => [kk, Object.fromEntries(Object.entries(m).map(([p, v]) => [p, stat(v)]))]));
    },
    /**
     * Static-scene RGB quality: accumulate `refFrames` x 16 rays of v x T, reset both denoisers, run
     * `frames` frames; pooled PSNR (rgb clamped to [0, 1]) over receivers, the penumbra (any channel in
     * (0.02, 0.98)) and the tint region (reference max - min > 0.02), and the chroma error there.
     */
    async metrics(o: { frames?: number; checkpoints?: number[] } = {}) {
      const nFrames = o.frames ?? 32;
      const checkpoints = new Set(o.checkpoints ?? [1, 2, 4, 8, 16, nFrames]);
      setMoving(false);
      const view0 = modes.view;
      setView('ref');
      refAccum.count.value = 0;
      await frames(refAccum.max + 2); await idle();
      const N_ = W * H;
      const ref = (await readTexture(renderer, refAccum.result)).data;
      const mask = new Uint8Array(N_), pen = new Uint8Array(N_), tint = new Uint8Array(N_);
      for (let i = 0; i < N_; i++) {
        mask[i] = ref[i * 4 + 3] > 0.5 ? 1 : 0;
        const r = ref[i * 4], g = ref[i * 4 + 1], b = ref[i * 4 + 2];
        pen[i] = mask[i] && [r, g, b].some((x) => x > 0.02 && x < 0.98) ? 1 : 0;
        tint[i] = mask[i] && Math.max(r, g, b) - Math.min(r, g, b) > 0.02 ? 1 : 0;
      }
      const cl = (x: number) => Math.min(1, Math.max(0, x));
      const psnr3 = (d: Float32Array, m: Uint8Array, grey1: boolean) => {
        let se = 0, n = 0;
        for (let i = 0; i < N_; i++) if (m[i]) for (let c = 0; c < 3; c++) { const e = cl(d[i * 4 + (grey1 ? 0 : c)]) - ref[i * 4 + c]; se += e * e; n++; }
        return +(10 * Math.log10(1 / Math.max(se / Math.max(n, 1), 1e-12))).toFixed(2);
      };
      const chroma = (d: Float32Array, grey1: boolean) => {
        let s = 0, n = 0;
        for (let i = 0; i < N_; i++) if (tint[i]) {
          const x = [0, 1, 2].map((c) => cl(d[i * 4 + (grey1 ? 0 : c)])), r = [0, 1, 2].map((c) => ref[i * 4 + c]);
          const sx = x[0] + x[1] + x[2], sr = r[0] + r[1] + r[2];
          if (sx <= 0 || sr <= 0) continue;
          for (let c = 0; c < 3; c++) { s += Math.abs(x[c] / sx - r[c] / sr); n++; }
        }
        return +(s / Math.max(n, 1)).toFixed(4);
      };
      setView('split');
      grey.resetHistory(); ours.resetHistory();
      const rows: Record<string, unknown>[] = [];
      for (let f = 1; f <= nFrames; f++) {
        await frames(1);
        if (!checkpoints.has(f)) continue;
        await idle();
        const imgs: [string, Float32Array, boolean][] = [
          ['noisy', (await readTexture(renderer, noisyRGB.renderTarget!.texture)).data, false],
          ['grey', (await readTexture(renderer, outTex(grey))).data, true],
          ['ours', (await readTexture(renderer, outTex(ours))).data, false],
        ];
        const row: Record<string, unknown> = { frame: f };
        for (const [kk, d, g1] of imgs) row[kk] = { psnr: psnr3(d, mask, g1), penumbra: psnr3(d, pen, g1), tint: psnr3(d, tint, g1), chroma: chroma(d, g1), bad: nonFiniteCount(d) };
        rows.push(row);
      }
      let pp = 0, tp = 0; for (let i = 0; i < N_; i++) { pp += pen[i]; tp += tint[i]; }
      setView(view0);
      return { w: W, h: H, refRays: refAccum.max * 16, penumbraPx: pp, tintPx: tp, rows };
    },
  };
  (window as unknown as { __t: typeof api }).__t = api;
  log(`ready - three r${THREE.REVISION}, ${W}x${H}; glass panel: analytic ray-quad test per shadow ray, frame in the BVH`);
}

main().catch((e) => { log(`ERROR: ${(e as Error).stack ?? e}`); console.error(e); (window as unknown as { __error?: string }).__error = String(e); });
