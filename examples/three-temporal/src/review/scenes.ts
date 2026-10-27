// Scenes of the review bench: the noisy 1-ray inputs, guides, references and the lit composite, built the same way
// as realtime-gi.ts (the corner; "knot" is the corner with the torus-knot paths of realtime-shadows) and
// realtime-scenes.ts (Bistro / Sponza), with the shared WGSL of src/realtime/rays.ts. The denoisers themselves are
// the bench's (src/review/main.ts): a kit only provides what both sides read.
import * as THREE from 'three/webgpu';
import {
  float, vec2, vec3, vec4, uniform, uint, screenCoordinate, pass, mrt, diffuseColor, normalView, materialMetalness,
  materialRoughness, packNormalToRGB, unpackRGBToNormal, velocity, getViewPosition, convertToTexture, uv, select, sample,
  texture, output,
} from 'three/tsl';
import { ssr } from 'three/addons/tsl/display/SSRNode.js';
import { MeshBVH, SAH } from 'three-mesh-bvh';
import { BVHComputeData } from 'three-mesh-bvh/webgpu';
import type { ShadowLight } from 'denoiser/realtime';
import {
  type N, LIGHT_C, LIGHT_N, LIGHT_U, LIGHT_V, LIGHT_ASPECT, buildScene, pose, equivalentSphereRadius, blueNoise, AccumulateNode,
} from '../realtime/scene';
import { scenePose, PATH_FRAMES, type PathName } from '../realtime/path';
import { loadAsset } from '../realtime/assets';
import { SCENES, pathOf, makeSkyEnvironment } from '../realtime/scenes';
import { cornerRays, assetRays } from '../realtime/rays';
import { SCENE_PATHS, type SceneId, type Signal } from './options';

const AO_A = 1, AO_B = 0.05; // OcclusionDenoiser's default hit-distance curve: h / (h + a + b * depth)

/** The parts the lit composite is made of, for one side (or the raw signals / the references). */
export interface Parts { dif: N; spec: N; ao: N; vis: N }

export interface Kit {
  id: SceneId;
  label: string;
  camera: THREE.PerspectiveCamera;
  /** Guides for every realtime node (camera, depth, velocity, packed view normal). */
  guides: { camera: THREE.PerspectiveCamera; depth: N; velocity: N; normal: N; normalSpace: 'view'; normalEncoding: 'packed' };
  roughness: N;
  /** Noisy inputs: diffuse radiance (rgb), its hit distance, visibility (.r) + occluder distance, SSR (ray length in .a). */
  inputs: { dif: N; difHit: N; sh: N; shDist: N; ssr: N };
  /** World-space direction of the diffuse ray (for the SH payload), built on first use. */
  direction(): N;
  /** The shadow light handed to realtimeShadows each frame. */
  light: () => ShadowLight;
  /** SSR's lit input reads last frame's diffuse and visibility of side A from these (plain textures; set `.value`). */
  ssrFeed: { diffuse: N; vis: N };
  noisy: Parts;
  ref: Parts;
  /** Linear colour of a signal from its parts (lit: the composite; `isRef`: the references, specular unmasked). */
  color(sig: Signal, p: Parts, isRef: boolean): N;
  /** The reference accumulators (only in the graph in the reference view). */
  refNodes: AccumulateNode[];
  resetRefs(): void;
  refFrames(): number;
  path: string;
  /** Switches the camera path; the caller resets the denoisers. */
  setPath(id: string): void;
  /** Advances the animation one frame (moving) or holds it; returns true when a scripted path wrapped (a cut). */
  advance(moving: boolean, frozen: boolean): boolean;
  /** A camera cut: the other shot (free view) or half a path ahead. */
  cut(): void;
  /** Light colour change at constant luminance (asset scenes) and a brightness step; toggles. */
  events: { colour?: () => void; brightness: () => void };
  /** Extra scene controls (HTML) and their wiring. */
  controls?: { html: string; wire(root: HTMLElement): void };
  info: Record<string, unknown>;
}

/** Shared graph setup: scene pass MRT, guides, surface reconstruction. */
function gbuffer(scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
  const camWorld = uniform(new THREE.Matrix4());
  camWorld.onFrameUpdate(() => { camera.updateMatrixWorld(); camWorld.value.copy(camera.matrixWorld); });
  const projInv = uniform(camera.projectionMatrixInverse);
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
  const guides = { camera, depth: depthTex, velocity: velTex, normal: nTex, normalSpace: 'view' as const, normalEncoding: 'packed' as const };
  const albedoD = () => { const a = dTex.sample(uv()); return a.rgb.mul(float(1).sub(a.a)); };
  const aoNoisy = (h: N) => select(h.lessThanEqual(0), float(1), h.div(h.add(AO_A).add(s0.depth.mul(AO_B))));
  return { dTex, nTex, depthTex, velTex, surface, s0, eps, pixelSeed, guides, albedoD, aoNoisy };
}

function ssrOf(lit: N, g: ReturnType<typeof gbuffer>, camera: THREE.Camera, env: THREE.Texture, o: { maxDistance: number; thickness: number; envI: number }) {
  const node = ssr(lit, g.depthTex, sample((uvN: N) => unpackRGBToNormal(g.nTex.sample(uvN).rgb)), {
    stochastic: true, camera, diffuseNode: g.dTex, metalnessNode: g.dTex.a, roughnessNode: g.nTex.a, envImportanceSampling: true,
  } as N) as N;
  node.setEnvMap(env);
  node.maxDistance.value = o.maxDistance;
  node.thickness.value = o.thickness;
  node.environmentIntensity.value = o.envI;
  return node;
}

const lum = (c: THREE.Vector3) => 0.2126 * c.x + 0.7152 * c.y + 0.0722 * c.z;
/** Same luminance, another hue (the T3 light-change test: a colour change A-SVGF's luminance-only anti-lag can't see). */
function hueSwap(c: THREE.Vector3): THREE.Vector3 {
  const t = new THREE.Vector3(c.z * 1.6 + 0.05, c.y * 0.9, c.x * 0.5 + 0.02);
  return t.multiplyScalar(lum(c) / Math.max(lum(t), 1e-6));
}

// ---- the corner (realtime-gi.html) and its knot close-ups (realtime-shadows.html) --------------------------------------

export async function cornerKit(id: 'corner' | 'knot', W: number, H: number, uFrame: N, path: string): Promise<Kit> {
  const ENV_I = 0.28;
  const { scene, camera, env, room, knot } = buildScene(W, H);
  scene.environment = null; // indirect light comes from the traced diffuse signal and SSR only
  scene.updateMatrixWorld(true);
  const bvh = new BVHComputeData(room);
  bvh.update();
  let tris = 0;
  room.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) tris += (m.geometry.index?.count ?? m.geometry.attributes.position.count) / 3; });
  const rays = cornerRays((bvh.fns as N).raycastFirstHit, { aoA: AO_A, aoB: AO_B });

  let lightHalf = 0.3;
  const uLightC = uniform(LIGHT_C.clone());
  const uLightU = uniform(new THREE.Vector3());
  const uLightV = uniform(new THREE.Vector3());
  const uLightN = uniform(LIGHT_N.clone());
  const uLightPower = uniform(30);
  const uSeed = uniform(0, 'uint');
  const setLightSize = (half: number) => { lightHalf = half; uLightU.value.copy(LIGHT_U).multiplyScalar(half * LIGHT_ASPECT); uLightV.value.copy(LIGHT_V).multiplyScalar(half); };
  setLightSize(lightHalf);
  const xi = await blueNoise(uFrame);

  const g = gbuffer(scene, camera);
  const { s0, eps } = g;
  const difRTT = convertToTexture(rays.diffuse1(s0.P, s0.N, s0.sky, eps, vec2(xi(2), xi(3)), uLightC, uLightN, uLightPower, float(ENV_I)));
  const difHitRTT = convertToTexture(vec4(difRTT.sample(uv()).a, 0, 0, 1));
  const shRTT = convertToTexture(vec4(rays.areaShadow1(s0.P, s0.N, s0.sky, uLightC, uLightU, uLightV, uLightN, eps, vec2(xi(0), xi(1))), 0, 1));
  const shDistRTT = convertToTexture(vec4(shRTT.sample(uv()).g, 0, 0, 1));
  const aoNoisyRTT = convertToTexture(vec4(g.aoNoisy(difRTT.sample(uv()).a), 0, 0, 1));
  let dirRTT: N = null;
  const direction = () => (dirRTT ??= convertToTexture(vec4(rays.cosineDir(s0.N, vec2(xi(2), xi(3))), 0)));

  const directOf = (vis: N) => {
    const s = g.surface(uv());
    const L = uLightC.sub(s.P);
    const d2 = L.dot(L).max(1e-3);
    const l = L.normalize();
    return uLightPower.mul(s.N.dot(l).max(0)).mul(uLightN.dot(l.negate()).max(0)).div(d2).mul(vis).mul(float(1).sub(s.sky));
  };
  const feedDif = texture(new THREE.Texture());
  const feedVis = texture(new THREE.Texture());
  const ssrLit = convertToTexture(vec4(g.albedoD().mul(feedDif.sample(uv()).rgb.add(directOf(feedVis.sample(uv()).r))), 1));
  const ssrNode = ssrOf(ssrLit, g, camera, env, { maxDistance: 4, thickness: 0.05, envI: ENV_I });
  const ssrMask = ssrNode.a.greaterThan(0).select(float(1), float(0));

  const difRef = new AccumulateNode(rays.diffuseRef(s0.P, s0.N, s0.sky, eps, g.pixelSeed().add(uSeed.mul(7919)).add(uint(777)), uint(4), s0.depth, uLightC, uLightN, uLightPower, float(ENV_I)));
  const specRef = new AccumulateNode(vec4(ssrNode.rgb.mul(ssrMask), ssrMask), 1, [ssrNode]);
  const visRef = new AccumulateNode(vec4(rays.areaVisibility(s0.P, s0.N, s0.sky, uLightC, uLightU, uLightV, uLightN, eps, g.pixelSeed().add(uSeed.mul(7919)).add(uint(12345)), uint(4)), 0, 0, float(1).sub(s0.sky)));
  difRef.max = specRef.max = 512;
  visRef.max = 256;
  const refNodes = [difRef, specRef, visRef];

  // animation
  let t = 0, shot = 0, pathFrame = 0, frame = 0;
  const prevView = new THREE.Matrix4();
  let prevKey = '';
  const scripted = () => (path ? path as PathName : null);
  const place = () => {
    const p = scripted();
    if (p) scenePose(p, camera, knot, pathFrame);
    else { pose(camera, shot, t); knot.rotation.set(0.4, t * 0.35, 0); }
    knot.updateMatrixWorld();
    (bvh as N).updateTransforms();
  };
  place();

  const kit: Kit = {
    id, label: id === 'corner' ? 'Corner (realtime-gi)' : 'Knot close-ups (realtime-shadows scene)',
    camera, guides: g.guides, roughness: g.nTex.a,
    inputs: { dif: difRTT, difHit: difHitRTT, sh: shRTT, shDist: shDistRTT, ssr: ssrNode },
    direction,
    light: () => ({ type: 'sphere', position: [LIGHT_C.x, LIGHT_C.y, LIGHT_C.z], radius: equivalentSphereRadius(lightHalf) }),
    ssrFeed: { diffuse: feedDif, vis: feedVis },
    noisy: { dif: difRTT.sample(uv()).rgb, spec: ssrNode.rgb, ao: aoNoisyRTT.sample(uv()).r, vis: shRTT.sample(uv()).r },
    ref: { dif: (difRef as N).rgb, spec: (specRef as N).rgb, ao: (difRef as N).a, vis: (visRef as N).r },
    color(sig, p, isRef) {
      const spec = isRef ? p.spec : p.spec.mul(ssrMask);
      switch (sig) {
        case 'diffuse': return p.dif;
        case 'specular': return spec;
        case 'ao': return vec3(p.ao);
        case 'shadow': return vec3(p.vis);
        case 'lit': return g.albedoD().mul(p.dif.add(directOf(p.vis))).add(spec);
      }
    },
    refNodes,
    resetRefs() { for (const r of refNodes) r.count.value = 0; },
    refFrames: () => Math.min(difRef.count.value, difRef.max),
    path,
    setPath(p: string) { path = kit.path = p; pathFrame = 0; place(); },
    advance(moving, frozen) {
      let wrapped = false;
      uSeed.value = frame++;
      if (moving && !frozen) {
        if (scripted()) { pathFrame = (pathFrame + 1) % PATH_FRAMES; wrapped = pathFrame === 0; } else t += 1 / 60;
      }
      place();
      const key = `${t}|${pathFrame}|${lightHalf}|${uLightPower.value}`;
      if (!prevView.equals(camera.matrixWorld) || key !== prevKey) kit.resetRefs();
      prevView.copy(camera.matrixWorld); prevKey = key;
      return wrapped;
    },
    cut() { if (scripted()) pathFrame = (pathFrame + PATH_FRAMES / 2) % PATH_FRAMES; else shot = 1 - shot; place(); },
    events: { brightness: () => { uLightPower.value = uLightPower.value === 30 ? 12 : 30; } },
    controls: {
      html: `<div class="dn-group"><label class="dn-label" for="rv-light">Panel size</label><div class="dn-row"><input id="rv-light" type="range" min="0.05" max="0.6" step="0.01" value="${lightHalf}" /><output class="dn-value" id="rv-light-v"></output><span class="hint">half-height of the area light (soft vs hard shadows)</span></div></div>`,
      wire(root) {
        const i = root.querySelector<HTMLInputElement>('#rv-light')!, o = root.querySelector<HTMLOutputElement>('#rv-light-v')!;
        const on = () => { setLightSize(parseFloat(i.value)); o.textContent = `${(lightHalf * 2 * LIGHT_ASPECT).toFixed(2)} x ${(lightHalf * 2).toFixed(2)} m`; };
        i.addEventListener('input', on); on();
      },
    },
    info: { scene: id, triangles: tris },
  };
  return kit;
}

// ---- Bistro / Sponza (realtime-gi.html?scene=...) ---------------------------------------------------------------------

export async function assetKit(id: 'sponza' | 'bistro', W: number, H: number, uFrame: N, path: string, log: (m: string) => void): Promise<Kit> {
  const cfg = SCENES[id];
  const ENV_I = cfg.sky.intensity;
  log(`loading ${id}...`);
  const asset = await loadAsset(id, {});
  log(`${id}: ${asset.triangles.toLocaleString()} triangles; building the BVH...`);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x101216);
  for (const m of asset.meshes) { m.updateMatrixWorld(true); scene.add(m); }
  const camera = new THREE.PerspectiveCamera(cfg.fov, W / H, cfg.near, cfg.far);
  const mover = cfg.mover ? new THREE.Mesh(cfg.mover.geometry(), new THREE.MeshStandardMaterial({ color: cfg.mover.color, roughness: cfg.mover.roughness, metalness: cfg.mover.metalness })) : null;
  if (mover) { mover.matrixAutoUpdate = false; scene.add(mover); }
  const env = makeSkyEnvironment(cfg);
  const bvhMesh = new THREE.Mesh(asset.bvhGeometry);
  bvhMesh.updateMatrixWorld(true);
  (asset.bvhGeometry as N).boundsTree = new MeshBVH(asset.bvhGeometry, { strategy: SAH, targetLeafSize: 4 } as N);
  const bvh = new BVHComputeData(mover ? [bvhMesh, mover] : [bvhMesh]);
  bvh.update();
  const rays = assetRays((bvh.fns as N).raycastFirstHit, cfg, { aoA: AO_A, aoB: AO_B, bounceLocalShadow: false });

  const sunDir = cfg.sun.toLight.clone().normalize();
  const sunE0 = new THREE.Vector3(...cfg.sun.color).multiplyScalar(cfg.sun.irradiance);
  const lPow0 = new THREE.Vector3(...cfg.local.color).multiplyScalar(cfg.local.power);
  const uSunDir = uniform(sunDir.clone());
  const uSunE = uniform(sunE0.clone());
  const uTanR = uniform(Math.tan(cfg.sun.angularRadius));
  const uLPos = uniform(cfg.local.position.clone());
  const uLPow = uniform(lPow0.clone());
  const uLR = uniform(cfg.local.radius);
  const uKindShadow = uniform(0, 'uint'); // 0 = the sun casts the denoised shadow, 1 = the local light (bistro-move)
  const uKindOther = uniform(1, 'uint');
  const uSeed = uniform(0, 'uint');
  const xi = await blueNoise(uFrame);

  const g = gbuffer(scene, camera);
  const { s0, eps } = g;
  const difRTT = convertToTexture(rays.diffuse1(s0.P, s0.N, s0.sky, eps, vec2(xi(2), xi(3)), uSunDir, uSunE, uLPos, uLPow, float(ENV_I)));
  const difHitRTT = convertToTexture(vec4(difRTT.sample(uv()).a, 0, 0, 1));
  const shRTT = convertToTexture(vec4(rays.shadow1(s0.P, s0.N, s0.sky, eps, vec2(xi(0), xi(1)), uKindShadow, uSunDir, uTanR, uLPos, uLR), 0, 1));
  const shDistRTT = convertToTexture(vec4(shRTT.sample(uv()).g, 0, 0, 1));
  const otherVisRTT = convertToTexture(vec4(rays.hardVis(s0.P, s0.N, s0.sky, eps, uKindOther, uSunDir, uLPos), 0, 0, 1));
  const aoNoisyRTT = convertToTexture(vec4(g.aoNoisy(difRTT.sample(uv()).a), 0, 0, 1));
  let dirRTT: N = null;
  const direction = () => (dirRTT ??= convertToTexture(vec4(rays.cosineDir(s0.N, vec2(xi(2), xi(3))), 0)));

  /** direct irradiance of the sun / the local light times a visibility */
  const sunDirect = (s: N, vis: N) => uSunE.mul(s.N.dot(uSunDir).max(0)).mul(vis);
  const localDirect = (s: N, vis: N) => { const L = uLPos.sub(s.P); const d2 = L.dot(L).max(0.01); return uLPow.mul(s.N.dot(L.normalize()).max(0)).div(d2).mul(vis); };
  const directBoth = (vis: N) => {
    const s = g.surface(uv());
    const other = otherVisRTT.sample(uv()).r;
    const sunIsShadow = uKindShadow.equal(uint(0));
    const sum = select(sunIsShadow, sunDirect(s, vis).add(localDirect(s, other)), localDirect(s, vis).add(sunDirect(s, other)));
    return sum.mul(float(1).sub(s.sky));
  };
  const feedDif = texture(new THREE.Texture());
  const feedVis = texture(new THREE.Texture());
  const ssrLit = convertToTexture(vec4(g.albedoD().mul(feedDif.sample(uv()).rgb.add(directBoth(feedVis.sample(uv()).r))), 1));
  const ssrNode = ssrOf(ssrLit, g, camera, env, { maxDistance: cfg.ssr.maxDistance, thickness: cfg.ssr.thickness, envI: ENV_I });
  const ssrMask = ssrNode.a.greaterThan(0).select(float(1), float(0));

  const difRef = new AccumulateNode(rays.diffuseRef(s0.P, s0.N, s0.sky, eps, g.pixelSeed().add(uSeed.mul(7919)).add(uint(777)), uint(4), s0.depth, uSunDir, uSunE, uLPos, uLPow, float(ENV_I)));
  const specRef = new AccumulateNode(vec4(ssrNode.rgb.mul(ssrMask), ssrMask), 1, [ssrNode]);
  const visRef = new AccumulateNode(vec4(rays.shadowRef(s0.P, s0.N, s0.sky, eps, g.pixelSeed().add(uSeed.mul(7919)).add(uint(12345)), uint(2), uKindShadow, uSunDir, uTanR, uLPos, uLR), 0, 0, float(1).sub(s0.sky)));
  difRef.max = specRef.max = 512;
  visRef.max = 128;
  const refNodes = [difRef, specRef, visRef];

  // animation
  let t = 0, pathFrame = 0, frame = 0;
  let pathDef = pathOf(cfg, path || null);
  const parked = new THREE.Matrix4().makeTranslation(0, -1e4, 0);
  const freeDir = cfg.free.position.clone().sub(cfg.free.target);
  const prevView = new THREE.Matrix4();
  let prevKey = '';
  let colourSwapped = false, dimmed = false;
  const applyLights = () => {
    const k = dimmed ? 0.35 : 1;
    uSunE.value.copy(colourSwapped ? hueSwap(sunE0) : sunE0).multiplyScalar(k);
    uLPow.value.copy(colourSwapped ? hueSwap(lPow0) : lPow0).multiplyScalar(k);
  };
  const setMover = (m: THREE.Matrix4 | null) => { if (!mover) return; const x = m ?? parked; mover.matrix.copy(x); mover.matrixWorld.copy(x); };
  const place = () => {
    if (pathDef) {
      const p = pathDef.pose(pathFrame);
      camera.position.copy(p.position); camera.lookAt(p.target);
      uLPos.value.copy(pathDef.local ? pathDef.local(pathFrame) : cfg.local.position);
      setMover(pathDef.mover ? pathDef.mover(pathFrame) : null);
    } else {
      camera.position.copy(cfg.free.target).add(freeDir.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.25 * Math.sin(t * 0.21 / 60)));
      camera.lookAt(cfg.free.target);
      const mv = cfg.paths.find((x) => x.mover)?.mover;
      setMover(mv ? mv(t % 64) : null);
      uLPos.value.copy(cfg.local.position);
    }
    camera.updateMatrixWorld();
    (bvh as N).updateTransforms();
  };
  const setShadowLight = () => { const local = pathDef?.shadow === 'local'; uKindShadow.value = local ? 1 : 0; uKindOther.value = local ? 0 : 1; };
  setShadowLight();
  place();

  const kit: Kit = {
    id, label: cfg.label, camera, guides: g.guides, roughness: g.nTex.a,
    inputs: { dif: difRTT, difHit: difHitRTT, sh: shRTT, shDist: shDistRTT, ssr: ssrNode },
    direction,
    light: () => (uKindShadow.value === 0
      ? { type: 'directional', direction: [sunDir.x, sunDir.y, sunDir.z], angularRadius: cfg.sun.angularRadius }
      : { type: 'sphere', position: [uLPos.value.x, uLPos.value.y, uLPos.value.z], radius: cfg.local.radius }),
    ssrFeed: { diffuse: feedDif, vis: feedVis },
    noisy: { dif: difRTT.sample(uv()).rgb, spec: ssrNode.rgb, ao: aoNoisyRTT.sample(uv()).r, vis: shRTT.sample(uv()).r },
    ref: { dif: (difRef as N).rgb, spec: (specRef as N).rgb, ao: (difRef as N).a, vis: (visRef as N).r },
    color(sig, p, isRef) {
      const spec = isRef ? p.spec : p.spec.mul(ssrMask);
      switch (sig) {
        case 'diffuse': return p.dif;
        case 'specular': return spec;
        case 'ao': return vec3(p.ao);
        case 'shadow': return vec3(p.vis);
        case 'lit': return g.albedoD().mul(p.dif.add(directBoth(p.vis))).add(spec);
      }
    },
    refNodes,
    resetRefs() { for (const r of refNodes) r.count.value = 0; },
    refFrames: () => Math.min(difRef.count.value, difRef.max),
    path,
    setPath(p: string) { path = kit.path = p; pathDef = pathOf(cfg, p || null); pathFrame = 0; setShadowLight(); place(); },
    advance(moving, frozen) {
      let wrapped = false;
      uSeed.value = frame++;
      if (moving && !frozen) {
        if (pathDef) { pathFrame = (pathFrame + 1) % pathDef.frames; wrapped = pathFrame === 0; } else t += 1;
      }
      place();
      const key = `${t}|${pathFrame}|${colourSwapped}|${dimmed}`;
      if (!prevView.equals(camera.matrixWorld) || key !== prevKey) kit.resetRefs();
      prevView.copy(camera.matrixWorld); prevKey = key;
      return wrapped;
    },
    cut() { if (pathDef) pathFrame = (pathFrame + (pathDef.frames >> 1)) % pathDef.frames; else t += 900; place(); },
    events: {
      colour: () => { colourSwapped = !colourSwapped; applyLights(); },
      brightness: () => { dimmed = !dimmed; applyLights(); },
    },
    info: { scene: id, triangles: asset.triangles + (mover ? mover.geometry.index!.count / 3 : 0), model: cfg.attribution },
  };
  return kit;
}

export async function buildKit(id: SceneId, W: number, H: number, uFrame: N, path: string, log: (m: string) => void): Promise<Kit> {
  const valid = SCENE_PATHS[id].some((p) => p.id === path) ? path : SCENE_PATHS[id][0].id;
  return id === 'corner' || id === 'knot' ? cornerKit(id, W, H, uFrame, valid) : assetKit(id, W, H, uFrame, valid, log);
}
