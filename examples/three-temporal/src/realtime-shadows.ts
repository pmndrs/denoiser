// three-temporal/realtime-shadows: our ShadowDenoiser (denoiser/realtime, experimental)
// next to FidelityFX's on the scene of shadows.ts: a furnished corner lit by one big
// soft area light, its shadow ray traced at 1 ray per pixel against the real scene
// meshes (three-mesh-bvh, WebGPU) and denoised every frame.
//
//   scene pass (MRT: env-lit color, albedo+metalness, packed view normal, velocity)
//     |- 1 ray/pixel to a random point on the panel -> (visibility, occluder distance)
//     |     blue-noise light samples by default (&sampler=white: the PCG white noise of shadows.ts)
//     |- ffxShadows(visibility)                        FidelityFX (denoiser/three)
//     |- realtimeShadows(visibility, { hitDistance, light })  ours (denoiser/three)
//     |- reference: 16 stratified rays/pixel/frame, accumulated while the camera holds still
//     '- lit = env-lit color + albedo * E(panel) * visibility -> ACES -> sRGB
//
// View: split (FFX left, ours right), either alone, the raw 1-ray signal, or the reference.
// Only the nodes a view shows are in the graph, so the per-denoiser GPU timings are real.
// ?path=orbit: the camera follows the scripted path of src/realtime/path.ts (the moving-camera
// captures with per-pose references are written by realtime-gi.html?path=orbit&ref=1, CAPTURES.md).
// ?path=knot-static / knot-orbit: the same with the torus knot rotating (moving-occluder captures).
import * as THREE from 'three/webgpu';
import {
  float, vec2, vec3, vec4, uniform, uint, screenCoordinate, pass, mrt, output, diffuseColor, normalView,
  materialMetalness, materialRoughness, packNormalToRGB, unpackRGBToNormal, velocity, getViewPosition,
  convertToTexture, renderOutput, uv, select,
} from 'three/tsl';
import { BVHComputeData, wgslTagFn, rayStruct, rayIntersectionResultStruct } from 'three-mesh-bvh/webgpu';
import { ffxShadows, realtimeShadows } from 'denoiser/three';
import type { TemporalDenoiseNode } from 'denoiser/three';
import { mountShell } from '../../_shared/shell';
import { prepareFlip, flipMean } from '../../realtime-denoiser/src/flip';
import {
  type N, LIGHT_C, LIGHT_N, LIGHT_U, LIGHT_V, LIGHT_ASPECT, buildScene, pose, equivalentSphereRadius, blueNoise,
  AccumulateNode, readTexture, nonFiniteCount,
} from './realtime/scene';
import { PATH_FRAMES, pathName, scenePose } from './realtime/path';

// ?scene=sponza|bistro: the third-party scenes live on realtime-gi.html (src/realtime-scenes.ts), shadow view
if (new URLSearchParams(location.search).get('scene')?.match(/^(sponza|bistro)$/)) location.replace(`realtime-gi.html${location.search}&signal=shadow`);
mountShell({ id: 'three-temporal-realtime-shadows' });

const q = new URLSearchParams(location.search);
const W = Number(q.get('w') ?? 960), H = Number(q.get('h') ?? 540);
const manual = q.has('manual');
const sampler = q.get('sampler') === 'white' ? 'white' : 'blue';
// scripted path (src/realtime/path.ts): orbit (knot frozen), knot-static / knot-orbit (knot rotating)
const pathMode = pathName(q.get('path'));
// &sh.<option>=<value>: ShadowDenoiser options (numbers / true / false / strings), for experiments
const shOptions: Record<string, unknown> = {};
for (const [k, v] of q) if (k.startsWith('sh.')) shOptions[k.slice(3)] = v === 'true' ? true : v === 'false' ? false : Number.isNaN(Number(v)) ? v : Number(v);

type View = 'split' | 'ffx' | 'ours' | 'noisy' | 'ref';
type Show = 'lit' | 'mask';
/** Shadow option presets for reviewing the open shadow decisions live (Shadow options buttons, keys 1-4; ?shp=<key>). */
const SH_PRESETS = {
  shipped: { label: 'shipped (q21 flip in)', opts: {} },
  q23: { label: 'q23: stepTest + edgeBox + rotationStep 0', opts: { stepTest: true, edgeBox: true, rotationStep: 0 } },
  q24: { label: 'q24: terminatorAnalytic', opts: { terminatorAnalytic: true } },
  both: { label: 'q23 + q24', opts: { stepTest: true, edgeBox: true, rotationStep: 0, terminatorAnalytic: true } },
} as const;
type ShPreset = keyof typeof SH_PRESETS;
const VIEW_LABEL: Record<View, string> = {
  split: 'left: ffxShadows() | right: realtimeShadows()',
  ffx: '1 ray/pixel + ffxShadows() (FidelityFX)',
  ours: '1 ray/pixel + realtimeShadows() (denoiser/realtime, experimental)',
  noisy: '1 ray/pixel, raw',
  ref: 'reference (16 rays/pixel/frame, accumulated)',
};

const statusEl = document.querySelector<HTMLPreElement>('#status')!;
const log = (m: string) => { statusEl.textContent = m; console.log('[realtime-shadows]', m); };

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

  const { scene, camera, room, knot } = buildScene(W, H);
  scene.updateMatrixWorld(true);
  const tBvh = performance.now();
  const bvh = new BVHComputeData(room);
  bvh.update();
  let tris = 0;
  room.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) tris += (m.geometry.index?.count ?? m.geometry.attributes.position.count) / 3; });
  const bvhMs = performance.now() - tBvh;

  // One ray to a light point (lu, lv in [-1, 1]^2 on the panel): (visibility, occluder distance).
  // Occluder distance: world units along the ray, 0 when lit; 0 with visibility 0 = self-shadowed.
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
      if ( ${(bvh.fns as N).raycastFirstHit}( ray, &hit ) && hit.dist < dist ) { return vec2f( 0.0, hit.dist ); }
      return vec2f( 1.0, 0.0 );
    }
  ` as N;
  // grid x grid stratified white-noise rays (the reference), as in shadows.ts
  const areaVisibility = wgslTagFn`
    fn areaVisibility( P: vec3f, Nw: vec3f, sky: f32, C: vec3f, U: vec3f, V: vec3f, nL: vec3f, eps: f32, seed: u32, grid: u32 ) -> f32 {
      if ( sky > 0.5 ) { return 1.0; }
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
          let toL = C + U * ( ( f32( i ) + r0 ) / f32( grid ) * 2.0 - 1.0 ) + V * ( ( f32( j ) + r1 ) / f32( grid ) * 2.0 - 1.0 ) - o;
          let dist = length( toL );
          let dir = toL / dist;
          if ( dot( Nw, dir ) <= 0.0 || dot( nL, dir ) >= 0.0 ) { continue; }
          let ray = ${rayStruct}( o, dir, dist );
          var hit: ${rayIntersectionResultStruct};
          if ( ! ${(bvh.fns as N).raycastFirstHit}( ray, &hit ) || hit.dist >= dist ) { lit += 1.0; }
        }
      }
      return lit / f32( grid * grid );
    }
  ` as N;
  // A pseudo-random white-noise pair for &sampler=white (PCG hash of pixel + frame)
  const pcg2 = wgslTagFn`
    fn pcg2( seed: u32 ) -> vec2f {
      var s = seed * 747796405u + 2891336453u;
      var w = ( ( s >> ( ( s >> 28u ) + 4u ) ) ^ s ) * 277803737u;
      let r0 = f32( ( w >> 22u ) ^ w ) / 4294967296.0;
      s = s * 747796405u + 2891336453u;
      w = ( ( s >> ( ( s >> 28u ) + 4u ) ) ^ s ) * 277803737u;
      return vec2f( r0, f32( ( w >> 22u ) ^ w ) / 4294967296.0 );
    }
  ` as N;

  const uLightC = uniform(LIGHT_C.clone());
  const uLightU = uniform(new THREE.Vector3());
  const uLightV = uniform(new THREE.Vector3());
  const uLightN = uniform(LIGHT_N.clone());
  const uLightPower = uniform(30);
  const uFrame = uniform(0, 'uint');
  const uSplit = uniform(0.5);
  let lightHalf = Number(q.get('light') ?? 0.3);
  const setLightSize = (half: number) => {
    lightHalf = half;
    uLightU.value.copy(LIGHT_U).multiplyScalar(half * LIGHT_ASPECT);
    uLightV.value.copy(LIGHT_V).multiplyScalar(half);
  };
  setLightSize(lightHalf);
  const xiBlue = sampler === 'blue' ? await blueNoise(uFrame) : null;

  const camWorld = uniform(new THREE.Matrix4());
  camWorld.onFrameUpdate(() => { camera.updateMatrixWorld(); camWorld.value.copy(camera.matrixWorld); });
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
    return { P, N: Nw, sky: d.greaterThanEqual(0.99999).select(float(1), float(0)), viewDist: Pv.length(), viewZ: Pv.z };
  };
  const pixelSeed = () => {
    const px = screenCoordinate.xy.floor();
    return uint(px.x).add(uint(px.y).mul(4099)).mul(uint(1973));
  };
  const s0 = surface(uv());
  const eps = s0.viewDist.mul(0.002).add(0.004);
  const xi = xiBlue ? vec2(xiBlue(0), xiBlue(1)) : pcg2(pixelSeed().add(uFrame.mul(9277)));
  // 1 ray/pixel: (visibility, occluder distance); its own texture, plus the distance alone in .r
  const sigRTT = convertToTexture(vec4(areaShadow1(s0.P, s0.N, s0.sky, uLightC, uLightU, uLightV, uLightN, eps, xi), 0, 1));
  const distRTT = convertToTexture(vec4(sigRTT.sample(uv()).g, 0, 0, 1));
  // reference: 16 stratified rays/pixel/frame; alpha = receiver mask (1 = surface, 0 = sky)
  const refAccum = new AccumulateNode(vec4(
    areaVisibility(s0.P, s0.N, s0.sky, uLightC, uLightU, uLightV, uLightN, eps, pixelSeed().add(uFrame.mul(7919)).add(uint(12345)), uint(4)),
    0, 0, float(1).sub(s0.sky)));
  refAccum.max = Number(q.get('refFrames') ?? 256);

  const guides = { camera, depth: depthTex, velocity: velTex, normal: nTex, normalSpace: 'view' as const, normalEncoding: 'packed' as const };
  const ffx = ffxShadows(sigRTT, guides);
  const oursWith = (denoiser: Record<string, unknown>) => realtimeShadows(sigRTT, {
    ...guides,
    hitDistance: distRTT,
    light: () => ({ type: 'sphere', position: [LIGHT_C.x, LIGHT_C.y, LIGHT_C.z], radius: equivalentSphereRadius(lightHalf) }),
    denoiser,
    // &viewz=1: hand the denoiser linear view z (an extra half-float pass) instead of hardware depth
    ...(q.has('viewz') ? { viewZ: convertToTexture(vec4(select(s0.sky.greaterThan(0.5), float(-camera.far), s0.viewZ), 0, 0, 1)) } : {}),
  });
  const ours = oursWith(shOptions);
  // Shadow presets: created on first use (the default page runs only `ours`, so benches are unchanged); once created a
  // preset runs every frame (kept in the output graph at weight 0), so switching is instant and keeps its history.
  const shNodes: Partial<Record<ShPreset, typeof ours>> = { shipped: ours };
  const shNode = (k: ShPreset) => (shNodes[k] ??= oursWith({ ...shOptions, ...SH_PRESETS[k].opts }));
  let shPreset: ShPreset = (q.get('shp') ?? '') in SH_PRESETS ? q.get('shp') as ShPreset : 'shipped';
  /** What the split view's left side shows: FFX, or our shipped preset (A/B a candidate against today's default). */
  let shLeft: 'ffx' | 'shipped' = q.get('shleft') === 'shipped' ? 'shipped' : 'ffx';

  const visOf = (v: Exclude<View, 'split'>): N => {
    switch (v) {
      case 'ffx': return ffx.r;
      case 'ours': return shNode(shPreset).r;
      case 'noisy': return sigRTT.sample(uv()).r;
      case 'ref': return (refAccum as N).r;
    }
  };
  const colorOf = (vis: N, show: Show): N => {
    if (show === 'mask') return vec3(vis);
    const s = surface(uv());
    const albedo = dTex.sample(uv());
    const diffuse = albedo.rgb.mul(float(1).sub(albedo.a));
    const direct = diffuse.mul(irradiance(s.P, s.N)).mul(vis).mul(float(1).sub(s.sky));
    return sceneColor.sample(uv()).rgb.add(direct);
  };

  const pipeline = new THREE.RenderPipeline(renderer);
  pipeline.outputColorTransform = false;
  const modes = { view: (q.get('view') ?? 'split') as View, show: (q.get('show') ?? 'lit') as Show };
  const buildOutput = () => {
    let col: N;
    if (modes.view === 'split') {
      const left = screenCoordinate.x.lessThan(uSplit.mul(W));
      const edge = screenCoordinate.x.sub(uSplit.mul(W)).abs().lessThan(1);
      col = select(edge, vec3(1, 1, 1), select(left, colorOf(shLeft === 'shipped' ? ours.r : ffx.r, modes.show), colorOf(shNode(shPreset).r, modes.show)));
    } else col = colorOf(visOf(modes.view), modes.show);
    if (Object.keys(shNodes).length > 1) col = col.add(vec3((Object.values(shNodes) as N[]).reduce((acc: N, n: N) => acc.add(n.r), float(0) as N).mul(0)));
    pipeline.outputNode = (modes.show === 'mask'
      ? renderOutput(vec4(col, 1), THREE.NoToneMapping, THREE.SRGBColorSpace)
      : renderOutput(vec4(col, 1), THREE.ACESFilmicToneMapping, THREE.SRGBColorSpace)) as N;
    pipeline.needsUpdate = true;
  };

  // ---- animation + stepping -----------------------------------------------------------
  let t = Number(q.get('t') ?? 0), frame = 0, moving = !q.has('paused'), shot = Number(q.get('shot') ?? 0);
  const prevView = new THREE.Matrix4();
  let prevLight = -1, prevT = -1;
  let pathFrame = 0, prevPathFrame = -1;
  const animate = () => {
    if (pathMode) {
      // ?path=...: the scripted path of src/realtime/path.ts (realtime-gi writes captures of it)
      if (moving && modes.view !== 'ref') {
        pathFrame = (pathFrame + 1) % PATH_FRAMES;
        if (pathFrame === 0) { ffx.resetHistory(); ours.resetHistory(); }
      }
      scenePose(pathMode, camera, knot, pathFrame);
    } else {
      if (moving && modes.view !== 'ref') t += 1 / 60;
      pose(camera, shot, t);
      knot.rotation.set(0.4, t * 0.35, 0);
    }
    knot.updateMatrixWorld();
    (bvh as N).updateTransforms();
    if (!prevView.equals(camera.matrixWorld) || prevLight !== lightHalf || prevT !== t || prevPathFrame !== pathFrame) refAccum.count.value = 0;
    prevPathFrame = pathFrame;
    prevView.copy(camera.matrixWorld);
    prevLight = lightHalf; prevT = t;
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
  const setView = (v: View) => {
    modes.view = v;
    if (v === 'ref') refAccum.count.value = 0;
    press('#seg-view', v); buildOutput();
  };
  const setShow = (s: Show) => { modes.show = s; press('#seg-show', s); buildOutput(); };
  const setMoving = (on: boolean) => { moving = on; press('#seg-motion', on ? 'on' : 'off'); };
  const cut = () => { shot = 1 - shot; ffx.resetHistory(); for (const n of Object.values(shNodes)) n.resetHistory(); };
  document.querySelectorAll<HTMLButtonElement>('#seg-view button').forEach((b) => b.addEventListener('click', () => setView(b.dataset.v as View)));
  document.querySelectorAll<HTMLButtonElement>('#seg-show button').forEach((b) => b.addEventListener('click', () => setShow(b.dataset.v as Show)));
  document.querySelectorAll<HTMLButtonElement>('#seg-motion button').forEach((b) => b.addEventListener('click', () => setMoving(b.dataset.v === 'on')));
  document.querySelector('#cut')!.addEventListener('click', cut);
  const lightIn = document.querySelector<HTMLInputElement>('#light-size')!;
  const lightOut = document.querySelector<HTMLOutputElement>('#light-size-v')!;
  const onLight = () => { const h = parseFloat(lightIn.value); setLightSize(h); lightOut.textContent = `${(h * 2 * LIGHT_ASPECT).toFixed(2)} x ${(h * 2).toFixed(2)} m`; };
  lightIn.value = String(lightHalf);
  lightIn.addEventListener('input', onLight); onLight();
  const splitIn = document.querySelector<HTMLInputElement>('#split')!;
  splitIn.addEventListener('input', () => { uSplit.value = parseFloat(splitIn.value); });
  // drag on the canvas moves the divider
  canvas.addEventListener('pointermove', (e) => {
    if (!(e.buttons & 1) || modes.view !== 'split') return;
    const r = canvas.getBoundingClientRect();
    uSplit.value = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    splitIn.value = String(uSplit.value);
  });
  // Shadow options (review of the open shadow decisions): presets for our side, and what the split's left side shows
  document.querySelector('#seg-view')?.closest('.dn-group')?.insertAdjacentHTML('afterend', `
    <div class="dn-group"><span class="dn-label">Shadow options (ours)</span><div class="dn-row">
      <div class="dn-seg" id="seg-shp">${(Object.keys(SH_PRESETS) as ShPreset[]).map((k, i) => `<button data-v="${k}" aria-pressed="false" title="key ${i + 1}">${i + 1} ${SH_PRESETS[k].label}</button>`).join('')}</div>
      <span class="hint">keys 1-4</span></div></div>
    <div class="dn-group"><span class="dn-label">Split left side</span><div class="dn-row">
      <div class="dn-seg" id="seg-shleft"><button data-v="ffx" aria-pressed="false">FFX</button><button data-v="shipped" aria-pressed="false">ours, shipped</button></div>
      <span class="hint">key L; "ours, shipped" A/Bs the selected preset against today's default</span></div></div>`);
  const setShPreset = (k: ShPreset) => { shPreset = k; press('#seg-shp', k); buildOutput(); };
  const setShLeft = (v: 'ffx' | 'shipped') => { shLeft = v; press('#seg-shleft', v); buildOutput(); };
  document.querySelectorAll<HTMLButtonElement>('#seg-shp button').forEach((b) => b.addEventListener('click', () => setShPreset(b.dataset.v as ShPreset)));
  document.querySelectorAll<HTMLButtonElement>('#seg-shleft button').forEach((b) => b.addEventListener('click', () => setShLeft(b.dataset.v as 'ffx' | 'shipped')));
  addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = (Object.keys(SH_PRESETS) as ShPreset[])[Number(e.key) - 1];
    if (k) setShPreset(k);
    else if (e.key === 'l' || e.key === 'L') setShLeft(shLeft === 'ffx' ? 'shipped' : 'ffx');
  });
  press('#seg-shp', shPreset); press('#seg-shleft', shLeft);
  press('#seg-view', modes.view); press('#seg-show', modes.show); setMoving(moving);

  const msOf = (node: N) => node.denoiser?.gpuTimings?.get('total') as number | undefined;
  setInterval(() => {
    const shTag = modes.view === 'split' || modes.view === 'ours' ? ` [ours: ${SH_PRESETS[shPreset].label}${modes.view === 'split' && shLeft === 'shipped' ? '; left: ours, shipped' : ''}]` : '';
    cap.textContent = VIEW_LABEL[modes.view] + shTag + (modes.view === 'ref' ? ` - ${Math.min(refAccum.count.value, refAccum.max) * 16} rays/pixel so far (camera held still)` : '');
    const f = msOf(ffx), o = msOf(ours);
    const parts = [];
    if ((modes.view === 'split' || modes.view === 'ffx') && f !== undefined) parts.push(`FFX ${f.toFixed(2)} ms`);
    if ((modes.view === 'split' || modes.view === 'ours') && o !== undefined) parts.push(`ours ${o.toFixed(2)} ms`);
    costEl.textContent = parts.length ? `denoiser GPU time at ${W}x${H}: ${parts.join(', ')}` : '';
  }, 400);
  buildOutput();

  // ---- test hooks (run-realtime.mjs) --------------------------------------------------------
  const copyCanvas = document.createElement('canvas');
  copyCanvas.width = W; copyCanvas.height = H;
  const cctx = copyCanvas.getContext('2d')!;
  const outTex = (node: N): THREE.Texture => (node as TemporalDenoiseNode).outputTexture;
  const api = {
    ready: true,
    gpuErrors,
    info: { three: THREE.REVISION, triangles: tris, bvhBuildMs: bvhMs, w: W, h: H, sampler },
    get frame() { return frame; },
    async step(n: number) { await frames(n); await idle(); },
    setModes(m: { view?: View; show?: Show; moving?: boolean; shot?: number; t?: number; lightSize?: number; split?: number }) {
      if (m.view) setView(m.view);
      if (m.show) setShow(m.show);
      if (m.moving !== undefined) setMoving(m.moving);
      if (m.shot !== undefined && m.shot !== shot) cut();
      if (m.t !== undefined) t = m.t;
      if (m.lightSize !== undefined) { lightIn.value = String(m.lightSize); onLight(); }
      if (m.split !== undefined) { uSplit.value = m.split; splitIn.value = String(m.split); }
    },
    cut,
    reset() { ffx.resetHistory(); ours.resetHistory(); },
    async capture(): Promise<string> {
      await frames(1);
      cctx.drawImage(canvas, 0, 0);
      await idle();
      return copyCanvas.toDataURL('image/png');
    },
    /** Non-finite values in both denoised outputs (and the raw signal). */
    async finiteCheck() {
      const r: Record<string, { w: number; h: number; bad: number }> = {};
      for (const [k, tex] of [['ffx', outTex(ffx)], ['ours', outTex(ours)], ['signal', sigRTT.renderTarget!.texture]] as const) {
        const { w, h, data } = await readTexture(renderer, tex);
        r[k] = { w, h, bad: nonFiniteCount(data) };
      }
      return r;
    },
    /** Mean per-pass GPU ms of the denoisers in the current view over n frames (timestamps land a few frames late). */
    async costs(n = 60) {
      await frames(20); await idle();
      const acc: Record<string, Record<string, number[]>> = { ffx: {}, ours: {} };
      for (let i = 0; i < n; i++) {
        await frames(1);
        for (const [k, node] of [['ffx', ffx], ['ours', ours]] as const) {
          const tm = (node as N).denoiser?.gpuTimings as Map<string, number> | undefined;
          if (!tm || !(modes.view === 'split' || modes.view === k)) continue;
          for (const [p, v] of tm) (acc[k][p] ??= []).push(v);
        }
      }
      await idle();
      const stat = (v: number[]) => { const s = [...v].sort((a, b) => a - b); return { min: s[0], median: s[s.length >> 1], mean: v.reduce((a, b) => a + b, 0) / v.length }; };
      return Object.fromEntries(Object.entries(acc).map(([k, m]) => [k, Object.fromEntries(Object.entries(m).map(([p, v]) => [p, stat(v)]))]));
    },
    /**
     * Static-camera quality vs the converged reference: accumulate `refFrames` x 16 rays,
     * then reset both denoisers and run `frames` frames; PSNR (pooled over receivers and over
     * the penumbra, 0.02 < ref < 0.98) at each checkpoint, FLIP on visibility at the end.
     */
    async metrics(o: { frames?: number; checkpoints?: number[]; ppd?: number; errImages?: boolean } = {}) {
      const nFrames = o.frames ?? 64;
      const checkpoints = new Set(o.checkpoints ?? [1, 2, 4, 8, 16, 32, nFrames]);
      const ppd = o.ppd ?? W / 46.4;
      setMoving(false);
      const view0 = modes.view;
      setView('ref');
      refAccum.count.value = 0;
      await frames(refAccum.max + 2); await idle();
      // single-channel copies only: at 1080p several RGBA float readbacks + CPU FLIP ran the tab out of memory
      const N_ = W * H;
      const r1 = (d: Float32Array) => { const o = new Float32Array(N_); for (let i = 0; i < N_; i++) o[i] = d[i * 4]; return o; };
      const psnr1 = (a: Float32Array, b: Float32Array, m: Uint8Array) => {
        let se = 0, n = 0;
        for (let i = 0; i < N_; i++) if (m[i]) { const e = a[i] - b[i]; se += e * e; n++; }
        return 10 * Math.log10(1 / Math.max(se / Math.max(n, 1), 1e-12));
      };
      const bad1 = (d: Float32Array) => { let n = 0; for (const v of d) if (!Number.isFinite(v)) n++; return n; };
      const refFull = await readTexture(renderer, refAccum.result);
      const ref = { data: r1(refFull.data) };
      const mask = new Uint8Array(N_), pen = new Uint8Array(N_);
      for (let i = 0; i < N_; i++) {
        mask[i] = refFull.data[i * 4 + 3] > 0.5 ? 1 : 0;
        const v = ref.data[i];
        pen[i] = mask[i] && v > 0.02 && v < 0.98 ? 1 : 0;
      }
      setView('split');
      ffx.resetHistory(); ours.resetHistory();
      const rows: Record<string, unknown>[] = [];
      let last: Record<string, Float32Array> = {};
      for (let f = 1; f <= nFrames; f++) {
        await frames(1);
        if (!checkpoints.has(f)) continue;
        await idle();
        const imgs: Record<string, Float32Array> = {
          noisy: r1((await readTexture(renderer, sigRTT.renderTarget!.texture)).data),
          ffx: r1((await readTexture(renderer, outTex(ffx))).data),
          ours: r1((await readTexture(renderer, outTex(ours))).data),
        };
        const row: Record<string, unknown> = { frame: f };
        for (const [k, d] of Object.entries(imgs)) row[k] = { psnr: +psnr1(ref.data, d, mask).toFixed(2), penumbra: +psnr1(ref.data, d, pen).toFixed(2), bad: bad1(d) };
        rows.push(row);
        last = imgs;
      }
      const gray = (d: Float32Array) => { const g = new Float32Array(N_ * 3); for (let i = 0; i < N_; i++) { const v = Math.min(1, Math.max(0, d[i])); g[3 * i] = g[3 * i + 1] = g[3 * i + 2] = v; } return g; };
      const fr = prepareFlip(gray(ref.data), W, H, ppd);
      const flip = Object.fromEntries(Object.entries(last).map(([k, d]) => [k, +flipMean(fr, prepareFlip(gray(d), W, H, ppd), mask).toFixed(4)]));
      let penPx = 0, recPx = 0; for (let i = 0; i < N_; i++) { penPx += pen[i]; recPx += mask[i]; }
      // signed error images (gain 4): red = darker than the reference, blue = brighter; the reference itself in gray
      const errImages: Record<string, string> = {};
      if (o.errImages) {
        const c = document.createElement('canvas');
        c.width = W; c.height = H;
        const ctx = c.getContext('2d')!;
        for (const [k, d] of [['ref', ref.data], ...Object.entries(last)] as [string, Float32Array][]) {
          const img = ctx.createImageData(W, H);
          for (let i = 0; i < N_; i++) {
            const r = ref.data[i];
            if (k === 'ref') { const g = Math.round(Math.min(1, r) * 255); img.data.set([g, g, g, 255], i * 4); continue; }
            const e = Math.max(-1, Math.min(1, (d[i] - r) * 4));
            const base = 40 + r * 40;
            img.data.set([base + Math.max(0, -e) * 215, base + 0, base + Math.max(0, e) * 215, 255], i * 4);
          }
          ctx.putImageData(img, 0, 0);
          errImages[k] = c.toDataURL('image/png');
        }
      }
      setView(view0);
      return { w: W, h: H, sampler, refRays: refAccum.max * 16, receivers: recPx, penumbraPx: penPx, ppd: +ppd.toFixed(1), rows, flip, errImages };
    },
  };
  (window as unknown as { __t: typeof api }).__t = api;
  log(`ready - three r${THREE.REVISION}, ${W}x${H}, ${sampler}-noise light samples${manual ? ' (manual stepping)' : ''}; BVH: ${tris.toLocaleString()} triangles, built in ${bvhMs.toFixed(0)} ms`);
}

main().catch((e) => { log(`ERROR: ${(e as Error).stack ?? e}`); console.error(e); (window as unknown as { __error?: string }).__error = String(e); });
