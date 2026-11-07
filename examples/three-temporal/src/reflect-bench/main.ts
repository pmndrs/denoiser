// three-temporal/reflect-bench: reflections only, on the model of Ben's SSR example, with the pipeline of
// reflections-hybrid.ts. A focused bench for "why does everything built on that scene boil?".
//
// The scene: three.js' steampunk camera on a metal disc (PR #35228's webgpu_postprocessing_ssr.html), plain three
// materials lit by an environment only: no lights, no GI, no AO. The environment is analytic (a studio gradient and
// four soft boxes): the raster pass gets it as an equirect DataTexture, the traced rays evaluate the same function in
// WGSL, so a traced reflection and a raster lookup agree.
//
// Reflections, as reflections-hybrid.ts builds them (one GGX sample per pixel per frame, three's sampler, so every
// source carries the same energy):
//   probe   the prefiltered environment for the whole lobe, no rays (split-sum)
//   ssr     three's stochastic SSR; the environment in the sampled direction where it misses
//   hybrid  above the roughness cutoff the prefiltered environment; below it SSR, a ray traced against the scene BVH
//           where SSR misses, the environment where that ray leaves the scene
//   rt      a traced ray for every pixel
//   ref     the rt estimator, 4 rays per pixel per frame, accumulated while nothing moves
// The noisy signal (radiance, hit distance) is ONE texture; the left and right of the divider run it through a
// denoiser each (none, FFX reflections, our realtime SVGF or recurrent filter), so the split compares denoisers on
// the same input. The composite (raster colour + specular) then goes through the upscaler (FSR3 temporal, at native
// 1x it is the TAA) or nothing, and ACES + sRGB.
//
// The materials' own environment specular is switched off (a uniform on PhysicalLightingModel.indirectSpecular, as
// reflections-hybrid.ts): the reflection term above replaces it. SSR traces the raster colour plus the prefiltered
// environment's specular, so a metal seen in the disc is not black. Traced hits are shaded cheaply, as hybrid
// renderers do: per-vertex albedo and metalness (sampled from the model's textures at each vertex, packed into the
// BVH with the vertex normals, both interpolated at the hit), diffuse from the environment's irradiance, metals mirroring the environment (no second bounce).

import * as THREE from 'three/webgpu';
import {
  float, vec3, vec4, uniform, uint, mix, pass, mrt, output, diffuseColor, normalView, materialMetalness, materialRoughness,
  packNormalToRGB, unpackRGBToNormal, velocity, sample, getViewPosition, convertToTexture, renderOutput, uv, Fn, If, EnvironmentBRDF,
} from 'three/tsl';
import { ssr } from 'three/addons/tsl/display/SSRNode.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import GUI from 'three/addons/libs/lil-gui.module.min.js';
import { BVHComputeData, wgslTagFn, rayStruct, rayIntersectionResultStruct } from 'three-mesh-bvh/webgpu';
import { upscale } from '@pmndrs/upscaler';
import { ffxReflections, realtimeSpecular } from 'denoiser/three';
import { ReflectionProbes } from '../probes/ReflectionProbes';
import { sampleReflectionProbes } from '../probes/ReflectionProbesNode';
import { AccumulateNode, clampSample, ggxLobeSample, pixelSeed } from '../reflections/common';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any; // TSL's node typings are too strict for hand-written shader maths

type ReflMode = 'probe' | 'ssr' | 'hybrid' | 'rt' | 'ref';
type Denoiser = 'none' | 'ffx' | 'recurrent' | 'svgf';
type Resolve = 'off' | '1' | '1.5' | '2';
type View = 'image' | 'specular' | 'source';
const REFL_LABEL: Record<ReflMode, string> = {
  probe: 'environment only (prefiltered)', ssr: 'SSR, environment on miss', hybrid: 'hybrid: SSR, ray traced on miss',
  rt: 'ray traced, every pixel', ref: 'reference (traced, accumulated)',
};
const DEN_LABEL: Record<Denoiser, string> = { none: 'raw', ffx: 'FFX reflections', recurrent: 'ours: recurrent', svgf: 'ours: SVGF' };
const isStochastic = (m: ReflMode) => m === 'ssr' || m === 'hybrid' || m === 'rt';

const statusEl = document.querySelector<HTMLDivElement>('#status')!;
const log = (m: string) => { statusEl.textContent = m; };

// ---- the material env-specular switch (reflections-hybrid.ts) -------------------------------------------------------
const uEnvSpecular = uniform(0);
const _indirectSpecular = THREE.PhysicalLightingModel.prototype.indirectSpecular;
THREE.PhysicalLightingModel.prototype.indirectSpecular = function (this: N, builder: N) {
  builder.context.radiance = builder.context.radiance.mul(uEnvSpecular);
  _indirectSpecular.call(this, builder);
};

// ---- the analytic studio environment --------------------------------------------------------------------------------
// One definition, evaluated on the CPU into the raster's equirect texture and generated as WGSL for the traced rays.
const SKY = { top: [0.36, 0.37, 0.4], horizon: [0.25, 0.25, 0.26], ground: [0.06, 0.055, 0.05] };
const BOXES = [ // direction (normalised below), cosine of the edge's inner / outer angle, radiance
  { d: [0.55, 0.75, 0.9], inner: 0.985, outer: 0.97, k: 9 },   // key: front right, high
  { d: [-1.0, 0.35, 0.45], inner: 0.97, outer: 0.945, k: 2.5 }, // fill: left
  { d: [-0.25, 0.55, -1.0], inner: 0.99, outer: 0.978, k: 6 },  // rim: behind
  { d: [0, 1, 0], inner: 0.95, outer: 0.9, k: 1.6 },            // overhead
].map((b) => { const l = Math.hypot(...b.d); return { ...b, d: b.d.map((v) => v / l) }; });
const f = (v: number) => v.toFixed(6);
const v3 = (a: number[]) => `vec3f(${a.map(f).join(', ')})`;

function envRadianceCPU(x: number, y: number, z: number, out: number[]) {
  const lerp = (a: number[], b: number[], t: number) => a.map((v, i) => v + (b[i] - v) * t);
  const base = y > 0 ? lerp(SKY.horizon, SKY.top, Math.min(1, y * 1.6)) : lerp(SKY.horizon, SKY.ground, Math.min(1, -y * 2.5));
  let s = 0;
  for (const b of BOXES) {
    const t = Math.min(1, Math.max(0, (x * b.d[0] + y * b.d[1] + z * b.d[2] - b.outer) / (b.inner - b.outer)));
    s += t * t * (3 - 2 * t) * b.k;
  }
  out[0] = base[0] + s; out[1] = base[1] + s * 0.98; out[2] = base[2] + s * 0.94;
}
// (three-mesh-bvh's wgslTagFn: one function per node; an interpolated node becomes its function's name)
const boxSum = (term: (b: typeof BOXES[number]) => string) => BOXES.map((b) => `s += ${term(b)};`).join('\n    ');
const envGradient = wgslTagFn([`
  fn envGradient( d: vec3f ) -> vec3f {
    if ( d.y > 0.0 ) { return mix( ${v3(SKY.horizon)}, ${v3(SKY.top)}, min( 1.0, d.y * 1.6 ) ); }
    return mix( ${v3(SKY.horizon)}, ${v3(SKY.ground)}, min( 1.0, - d.y * 2.5 ) );
  }
`] as N) as N;
const envRadiance = wgslTagFn([`
  fn envRadiance( d: vec3f ) -> vec3f {
    var s = 0.0;
    ${boxSum((b) => `smoothstep( ${f(b.outer)}, ${f(b.inner)}, dot( d, ${v3(b.d)} ) ) * ${f(b.k)}`)}
    return `, `( d ) + s * vec3f( 1.0, 0.98, 0.94 );
  }
`] as N, envGradient) as N;
// irradiance / pi: the gradient as a near-constant ambient plus each box as a small disc light
const envIrradiance = wgslTagFn([`
  fn envIrradiance( n: vec3f ) -> vec3f {
    var s = 0.0;
    ${boxSum((b) => `max( dot( n, ${v3(b.d)} ), 0.0 ) * ${f(b.k * 2 * (1 - (b.inner + b.outer) / 2))}`)}
    return `, `( n ) * 0.8 + `, `( vec3f( 0.0, 1.0, 0.0 ) ) * 0.2 + s * vec3f( 1.0, 0.98, 0.94 );
  }
`] as N, envGradient, envGradient) as N;

/** The environment as three's equirect convention reads it (equirectUV / equirectDirection). */
function makeEnvironment(): THREE.DataTexture {
  const w = 1024, h = 512;
  const data = new Float32Array(w * h * 4);
  const c = [0, 0, 0];
  for (let y = 0; y < h; y++) {
    const phi = ((y + 0.5) / h - 0.5) * Math.PI;
    for (let x = 0; x < w; x++) {
      const theta = ((x + 0.5) / w - 0.5) * Math.PI * 2;
      envRadianceCPU(Math.cos(phi) * Math.cos(theta), Math.sin(phi), Math.cos(phi) * Math.sin(theta), c);
      data.set([c[0], c[1], c[2], 1], (y * w + x) * 4);
    }
  }
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.FloatType);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.LinearSRGBColorSpace;
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

// three.js example assets: the local checkout through the dev server, else r186 on GitHub (as ../workbench/scenes.ts)
async function assetUrl(file: string): Promise<string> {
  try { if ((await fetch('/__three-examples/' + file, { method: 'HEAD' })).ok) return '/__three-examples/' + file; } catch { /* fall through */ }
  return 'https://raw.githubusercontent.com/mrdoob/three.js/r186/examples/' + file;
}

/** A texture's pixels on the CPU (at most 512 square), for per-vertex lookups. */
function pixels(tex: THREE.Texture | null): ((u: number, v: number) => [number, number, number]) | null {
  const img = tex?.image as CanvasImageSource & { width: number; height: number } | undefined;
  if (!img?.width) return null;
  const w = Math.min(512, img.width), h = Math.min(512, img.height);
  const c = new OffscreenCanvas(w, h).getContext('2d')!;
  c.drawImage(img, 0, 0, w, h);
  const d = c.getImageData(0, 0, w, h).data;
  // glTF: uv (0, 0) is the image's first row (the loader sets flipY = false); wrap repeats
  return (u, v) => {
    const x = ((Math.floor((u - Math.floor(u)) * w) % w) + w) % w, y = ((Math.floor((v - Math.floor(v)) * h) % h) + h) % h;
    const i = (y * w + x) * 4;
    return [d[i] / 255, d[i + 1] / 255, d[i + 2] / 255];
  };
}
const srgbToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

async function buildScene() {
  const gltf = await new GLTFLoader().loadAsync(await assetUrl('models/gltf/steampunk_camera.glb'));
  const scene = new THREE.Scene();
  const env = makeEnvironment();
  scene.environment = env;
  scene.background = env;
  const root = new THREE.Group(); // everything the rays see
  scene.add(root);
  const model = gltf.scene;
  model.position.y = 0.1;
  root.add(model);
  const materials: THREE.MeshStandardMaterial[] = [];
  const normalMaps = new Map<THREE.MeshStandardMaterial, THREE.Texture | null>();
  model.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
    if (m && !materials.includes(m)) { m.side = THREE.FrontSide; m.roughness = 0; materials.push(m); normalMaps.set(m, m.normalMap); } // as Ben's
  });
  const tableMat = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 0 });
  const table = new THREE.Mesh(new THREE.CircleGeometry(2, 64), tableMat);
  table.rotation.x = -Math.PI / 2;
  table.position.y = -0.8;
  root.add(table);

  // per-vertex material for traced hits: linear albedo (colour x base colour map) + metalness (x the map's blue)
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.geometry = m.geometry.clone();
    const mat = m.material as THREE.MeshStandardMaterial;
    const n = m.geometry.attributes.position.count;
    const uvA = m.geometry.attributes.uv;
    const base = uvA ? pixels(mat.map) : null, mr = uvA ? pixels(mat.metalnessMap) : null;
    const a = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      const u = uvA ? uvA.getX(i) : 0, v = uvA ? uvA.getY(i) : 0;
      const b = base ? base(u, v).map(srgbToLinear) : [1, 1, 1];
      const metal = mat.metalness * (mr ? mr(u, v)[2] : 1);
      a.set([mat.color.r * b[0], mat.color.g * b[1], mat.color.b * b[2], metal], i * 4);
    }
    m.geometry.setAttribute('mat', new THREE.BufferAttribute(a, 4));
  });
  return { scene, env, root, model, materials, normalMaps, table, tableMat };
}

// ---- main ------------------------------------------------------------------------------------------------------------
async function main() {
  const canvas = document.querySelector<HTMLCanvasElement>('#view')!;
  if (!navigator.gpu) { log('WebGPU is not available in this browser.'); return; }
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: false } as N);
  await renderer.init();
  renderer.setPixelRatio(1);
  renderer.setSize(innerWidth, innerHeight, false);
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  const device = (renderer.backend as unknown as { device: GPUDevice }).device;
  device.addEventListener('uncapturederror', (e) => console.error('[webgpu uncapturederror]', (e as GPUUncapturedErrorEvent).error.message));

  log('loading the steampunk camera...');
  const { scene, root, model, materials, normalMaps, table, tableMat } = await buildScene();
  const camera = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.1, 100);
  camera.position.set(3, 2, 3);
  camera.lookAt(0, 0, 0);
  scene.updateMatrixWorld(true);

  // ---- BVH (three-mesh-bvh, WebGPU) ------------------------------------------------------------------------------
  const bvh = new BVHComputeData(root, { attributes: { position: 'vec4f', normal: 'vec4f', mat: 'vec4f' } });
  bvh.update();

  // One reflection ray from P along D, shaded at the hit; w = -1 when it leaves the scene (the caller fills it).
  const traceReflection = wgslTagFn`
    fn traceReflection( P: vec3f, Nw: vec3f, D: vec3f, eps: f32 ) -> vec4f {
      let ray = ${rayStruct}( P + Nw * eps, D, 0.0 );
      var hit: ${rayIntersectionResultStruct};
      if ( ${(bvh.fns as N).raycastFirstHit}( ray, &hit ) ) {
        // the vertex normals and materials, interpolated; the normal to world space with the object's inverse transpose
        let va = ${(bvh.storage as N).attributes}[ hit.indices.x ];
        let vb = ${(bvh.storage as N).attributes}[ hit.indices.y ];
        let vc = ${(bvh.storage as N).attributes}[ hit.indices.z ];
        let w = hit.barycoord;
        let nObj = va.normal.xyz * w.x + vb.normal.xyz * w.y + vc.normal.xyz * w.z;
        var n = normalize( ( vec4f( nObj, 0.0 ) * ${(bvh.storage as N).transforms}[ hit.objectIndex ].inverseMatrixWorld ).xyz );
        if ( dot( hit.normal, D ) > 0.0 ) { n = -n; }
        let m = va.mat * w.x + vb.mat * w.y + vc.mat * w.z;
        let f0 = mix( vec3f( 0.04 ), m.rgb, m.w );
        let c = m.rgb * ( 1.0 - m.w ) * ${envIrradiance}( n ) + f0 * ${envRadiance}( reflect( D, n ) );
        return vec4f( c, hit.dist );
      }
      return vec4f( 0.0, 0.0, 0.0, -1.0 );
    }
  ` as N;

  // ---- environment lookups: an empty probe set, so every lookup is the prefiltered environment ------------------
  const probes = new ReflectionProbes();
  scene.add(probes);
  uEnvSpecular.value = 1;
  probes.bake(renderer, scene, { resolution: 256, near: 0.1, far: 50 });
  uEnvSpecular.value = 0;
  const envLookup = (P: N, d: N, rough: N) => sampleReflectionProbes(probes, P, d, rough);

  // ---- uniforms + UI state ---------------------------------------------------------------------------------------
  const uFrame = uniform(0, 'uint');
  const uRoughCut = uniform(0.5);
  const uSplit = uniform(0.5);
  const camWorld = uniform(new THREE.Matrix4());
  camWorld.onFrameUpdate(() => { camera.updateMatrixWorld(); camWorld.value.copy(camera.matrixWorld); });
  const projInv = uniform(camera.projectionMatrixInverse);
  const ui = {
    refl: 'hybrid' as ReflMode, left: 'ffx' as Denoiser, right: 'recurrent' as Denoiser, resolve: '1.5' as Resolve, view: 'image' as View,
    roughCut: 0.5, ssrThickness: 0.03, ssrDistance: 5, ssrQuality: 0.5, ssrStepExponent: 2, ssrBinaryRefine: false,
    modelRough: 'Ben: forced 0', normalMaps: true, tableRough: 0, turntable: false, orbit: false,
  };
  const SRC = { ssr: vec3(0.15, 0.8, 0.25), rt: vec3(0.2, 0.5, 1), miss: vec3(1, 0.2, 0.15), probe: vec3(1, 0.6, 0.05) };

  function buildGraph(resolve: Resolve) {
    const ratio = resolve === 'off' ? 1 : Number(resolve);
    const scale = 1 / ratio;
    const scenePass = pass(scene, camera);
    scenePass.setResolutionScale(scale);
    scenePass.setMRT(mrt({
      output,
      diffuseColor: vec4(diffuseColor.rgb, materialMetalness),
      normal: vec4(packNormalToRGB(normalView), materialRoughness),
      velocity,
    }));
    const sceneColor = scenePass.getTextureNode('output');
    const dTex = scenePass.getTextureNode('diffuseColor');
    const nTex = scenePass.getTextureNode('normal');
    const depthTex = scenePass.getTextureNode('depth');
    const velTex = scenePass.getTextureNode('velocity');
    const rtt = (node: N) => { const n = convertToTexture(node); n.setResolutionScale(scale); return n; };

    const surface = () => {
      const d = depthTex.sample(uv()).r;
      const Pv = getViewPosition(uv(), d, projInv);
      const P = camWorld.mul(vec4(Pv, 1)).xyz;
      const Nw = camWorld.mul(vec4(unpackRGBToNormal(nTex.sample(uv()).rgb), 0)).xyz.normalize();
      return { P, N: Nw, sky: d.greaterThanEqual(0.99999).select(float(1), float(0)), viewDist: Pv.length() };
    };
    const camPos = camWorld.mul(vec4(0, 0, 0, 1)).xyz;
    const roughOf = () => nTex.sample(uv()).a;
    // the prefiltered environment for the whole lobe (split-sum)
    const probeSpec = () => {
      const s = surface();
      const alb = dTex.sample(uv());
      const V = camPos.sub(s.P).normalize();
      const spec = (EnvironmentBRDF as N)({ dotNV: s.N.dot(V).max(1e-4), specularColor: mix(vec3(0.04), alb.rgb, alb.a), specularF90: float(1), roughness: roughOf() });
      return envLookup(s.P, V.negate().reflect(s.N), roughOf()).rgb.mul(spec).mul(float(1).sub(s.sky));
    };

    // SSR traces the raster colour plus the environment's specular (so a metal seen in a mirror isn't black)
    const litRTT = rtt(vec4(sceneColor.rgb.add(probeSpec()), 1));
    const ssrNode = ssr(litRTT, depthTex, sample((u: N) => unpackRGBToNormal(nTex.sample(u).rgb)), {
      stochastic: true, camera, diffuseNode: dTex, metalnessNode: dTex.a, roughnessNode: nTex.a,
    } as N) as N;
    ssrNode.setResolutionScale?.(1); // SSR runs at the pass's resolution (its input's size)
    ssrNode.maxDistance.value = ui.ssrDistance;
    ssrNode.thickness.value = ui.ssrThickness;
    ssrNode.quality.value = ui.ssrQuality;
    ssrNode.stepExponent = ui.ssrStepExponent;
    ssrNode.binaryRefine = ui.ssrBinaryRefine;
    const ssrHit = () => ssrNode.a.greaterThan(0).and(ssrNode.a.lessThan(1e3));

    const lobeSample = (k: number) => {
      const s = surface();
      const alb = dTex.sample(uv());
      const rough = roughOf();
      const seed = pixelSeed(uFrame, k);
      const g = ggxLobeSample(s.N, camPos.sub(s.P).normalize(), rough, alb.a, alb.rgb, seed);
      return { s, rough, dir: g.dir, weight: g.weight };
    };
    type Lobe = ReturnType<typeof lobeSample>;
    const traceRaw = (r: Lobe): N => traceReflection(r.s.P, r.s.N, r.dir, r.s.viewDist.mul(0.002).add(0.002));
    const traced = (r: Lobe) => {
      const t = traceRaw(r).toVar();
      const miss = t.w.lessThan(0);
      return clampSample(vec4(miss.select(envLookup(r.s.P, r.dir, float(0)), t.rgb).mul(r.weight), miss.select(float(100), t.w)), r.rough);
    };
    const estimator: Record<'ssr' | 'hybrid' | 'rt', N> = {
      ssr: Fn(() => {
        const r = lobeSample(0);
        const o = vec4(0).toVar();
        If(r.s.sky.lessThan(0.5), () => {
          If(ssrHit(), () => { o.assign(ssrNode); })
            .Else(() => { o.assign(clampSample(vec4(envLookup(r.s.P, r.dir, float(0)).rgb.mul(r.weight), 100), r.rough)); });
        });
        return o;
      })(),
      hybrid: Fn(() => {
        const r = lobeSample(0);
        const o = vec4(0).toVar();
        If(r.s.sky.lessThan(0.5).and(r.rough.lessThanEqual(uRoughCut)), () => {
          If(ssrHit(), () => { o.assign(ssrNode); }).Else(() => { o.assign(traced(r)); });
        });
        return o;
      })(),
      rt: Fn(() => {
        const r = lobeSample(0);
        const o = vec4(0).toVar();
        If(r.s.sky.lessThan(0.5), () => { o.assign(traced(r)); });
        return o;
      })(),
    };
    // the noisy signal: one texture, its node swapped per mode; both sides of the divider denoise it
    const reflIn = rtt(vec4(0));
    const guides = { camera, depth: depthTex, velocity: velTex, normal: nTex, normalSpace: 'view' as const, normalEncoding: 'packed' as const, resolutionScale: scale };
    const denoisers = new Map<Denoiser, N>();
    const denoised = (k: Denoiser): N => {
      if (k === 'none') return reflIn;
      let n = denoisers.get(k);
      if (!n) {
        n = k === 'ffx' ? ffxReflections(reflIn, { ...guides, roughness: nTex.a })
          : realtimeSpecular(reflIn, { ...guides, roughness: nTex.a, denoiser: { filter: k } } as N);
        denoisers.set(k, n);
      }
      return n;
    };
    const reflRef = new AccumulateNode(Fn(() => {
      const o = vec4(0).toVar();
      If(surface().sky.lessThan(0.5), () => { for (let k = 0; k < 4; k++) o.addAssign(traced(lobeSample(k + 1)).mul(0.25)); });
      return o;
    })(), scale);
    const tracedHit = () => traceRaw(lobeSample(0)).w.greaterThanEqual(0);
    const sourceOf = (m: ReflMode): N => {
      switch (m) {
        case 'probe': return SRC.probe;
        case 'ssr': return ssrHit().select(SRC.ssr, SRC.miss);
        case 'rt': case 'ref': return tracedHit().select(SRC.rt, SRC.miss);
        case 'hybrid': return roughOf().greaterThan(uRoughCut).select(SRC.probe, ssrHit().select(SRC.ssr, tracedHit().select(SRC.rt, SRC.miss)));
      }
    };
    const srcAccum = new AccumulateNode(vec4(0), scale, 0.12);
    const colorRTT = rtt(vec4(0, 0, 0, 1));
    const up: N = resolve === 'off' ? null : upscale(colorRTT, depthTex, velTex, camera, { path: 'temporal', ratio, jitter: true } as N);
    const dispose = () => {
      for (const d of denoisers.values()) d.dispose?.();
      for (const n of [scenePass, litRTT, ssrNode, reflIn, reflRef, srcAccum, colorRTT, up]) n?.dispose?.();
    };
    return { resolve, sceneColor, reflIn, estimator, denoised, denoisers, probeSpec, roughOf, surface, reflRef, sourceOf, srcAccum, colorRTT, up, ssrNode, dispose };
  }
  let g = buildGraph(ui.resolve);

  const pipeline = new THREE.RenderPipeline(renderer);
  pipeline.outputColorTransform = false;
  const buildOutput = () => {
    const m = ui.refl;
    if (isStochastic(m)) g.reflIn.node = g.estimator[m as 'ssr' | 'hybrid' | 'rt'];
    const sky = () => g.surface().sky.greaterThan(0.5);
    const specOf = (k: Denoiser): N => {
      if (m === 'probe') return g.probeSpec();
      if (m === 'ref') return (g.reflRef as N).rgb;
      let s: N = g.denoised(k).rgb;
      if (m === 'hybrid') s = s.add(g.roughOf().greaterThan(uRoughCut).select(g.probeSpec(), vec3(0)));
      return sky().select(vec3(0), s);
    };
    const left = uv().x.lessThan(uSplit);
    const split = isStochastic(m);
    const spec: N = split ? left.select(specOf(ui.left), specOf(ui.right)) : specOf('none');
    let out: N = ui.view === 'specular' ? spec : g.sceneColor.rgb.add(spec);
    if (ui.view === 'source') {
      g.srcAccum.sample = vec4(g.sourceOf(m), 1);
      const lum = g.sceneColor.rgb.add(spec).dot(vec3(0.2126, 0.7152, 0.0722));
      const grey = lum.div(lum.add(0.6));
      out = mix(vec3(grey.mul(0.7)), (g.srcAccum as N).rgb.mul(grey.add(0.25)), 0.5);
    }
    g.colorRTT.node = vec4(out, 1);
    pipeline.outputNode = renderOutput(g.up ?? g.colorRTT, THREE.ACESFilmicToneMapping, THREE.SRGBColorSpace) as N;
    pipeline.needsUpdate = true;
    updateOverlay();
  };
  const resetHistories = () => { for (const d of g.denoisers.values()) d.resetHistory?.(); g.reflRef.count.value = 0; };
  const setResolve = () => {
    const old = g;
    g = buildGraph(ui.resolve);
    if (ui.resolve === 'off') velocity.setProjectionMatrix(null); // the upscaler owns it while it jitters
    buildOutput();
    old.dispose();
  };

  // ---- camera, animation ----------------------------------------------------------------------------------------
  const stage = document.querySelector<HTMLDivElement>('#stage')!;
  const controls = new OrbitControls(camera, stage);
  controls.enableDamping = false; // a camera that stops means the histories settle
  controls.target.set(0, 0, 0);
  let tCam = 0, tModel = 0, frame = 0;
  const prevView = new THREE.Matrix4();
  let prevModel = 0;
  const animate = () => {
    if (ui.orbit) {
      tCam += 1 / 60;
      const a = Math.PI / 4 + 0.45 * Math.sin(tCam * 0.25), r = 4.69;
      camera.position.set(r * Math.sin(a), 2 + 0.2 * Math.sin(tCam * 0.17), r * Math.cos(a));
      camera.lookAt(controls.target);
    } else controls.update();
    camera.updateMatrixWorld();
    if (ui.turntable) { tModel += 1 / 60; model.rotation.y = tModel * 0.3; model.updateMatrixWorld(); (bvh as N).updateTransforms(); }
    if (!prevView.equals(camera.matrixWorld) || prevModel !== tModel) g.reflRef.count.value = 0;
    prevView.copy(camera.matrixWorld);
    prevModel = tModel;
    uFrame.value = frame;
  };
  let fps = 0, last = performance.now();
  renderer.setAnimationLoop(() => {
    animate();
    pipeline.render();
    frame++;
    const now = performance.now();
    fps += (1000 / (now - last) - fps) * 0.05;
    last = now;
    if (frame % 20 === 0) {
      const ref = ui.refl === 'ref' ? ` · reference ${Math.min(g.reflRef.count.value, g.reflRef.max) * 4} rays/pixel` : '';
      log(`${fps.toFixed(0)} fps · ${canvas.width}x${canvas.height} · ${ui.resolve === 'off' ? 'no resolver' : `FSR3 ${ui.resolve}x`}${ref}`);
    }
  });
  addEventListener('resize', () => {
    renderer.setSize(innerWidth, innerHeight, false);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
  });

  // ---- overlay: divider + tags ----------------------------------------------------------------------------------
  const divider = document.querySelector<HTMLDivElement>('#divider')!;
  const tagL = document.querySelector<HTMLDivElement>('#tag-l')!;
  const tagR = document.querySelector<HTMLDivElement>('#tag-r')!;
  const legend = document.querySelector<HTMLDivElement>('#legend')!;
  function updateOverlay() {
    const split = isStochastic(ui.refl) && ui.view !== 'source';
    divider.hidden = tagR.hidden = !split;
    divider.style.left = `${uSplit.value * 100}%`;
    tagL.textContent = split ? `${DEN_LABEL[ui.left]}  ·  ${REFL_LABEL[ui.refl]}` : REFL_LABEL[ui.refl];
    tagR.textContent = DEN_LABEL[ui.right];
    legend.hidden = ui.view !== 'source';
  }
  const grip = divider.querySelector<HTMLDivElement>('.grip')!;
  grip.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    grip.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => { uSplit.value = Math.min(1, Math.max(0, ev.clientX / innerWidth)); updateOverlay(); };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', () => grip.removeEventListener('pointermove', move), { once: true });
  });

  // ---- GUI ------------------------------------------------------------------------------------------------------
  const gui: N = new GUI({ title: 'Reflection bench' });
  const rebuild = () => { resetHistories(); buildOutput(); };
  gui.add(ui, 'refl', { 'hybrid: SSR + ray traced': 'hybrid', 'SSR + environment': 'ssr', 'ray traced, every pixel': 'rt', 'environment only (no rays)': 'probe', 'reference (accumulated)': 'ref' })
    .name('reflections').onChange(rebuild);
  gui.add(ui, 'left', { raw: 'none', 'FFX reflections': 'ffx', 'ours: recurrent': 'recurrent', 'ours: SVGF': 'svgf' }).name('left denoiser').onChange(buildOutput);
  gui.add(ui, 'right', { raw: 'none', 'FFX reflections': 'ffx', 'ours: recurrent': 'recurrent', 'ours: SVGF': 'svgf' }).name('right denoiser').onChange(buildOutput);
  gui.add(ui, 'resolve', { 'FSR3 2x (50 %)': '2', 'FSR3 1.5x (67 %)': '1.5', 'FSR3 native (TAA)': '1', 'none': 'off' }).name('resolver').onChange(setResolve);
  gui.add(ui, 'view', { image: 'image', 'specular only': 'specular', 'where reflections come from': 'source' }).name('show').onChange(buildOutput);
  gui.add(ui, 'roughCut', 0, 1, 0.01).name('hybrid roughness cutoff').onChange((v: number) => { uRoughCut.value = v; });
  const fs = gui.addFolder('Scene');
  fs.add(ui, 'modelRough', ['Ben: forced 0', 'from the file']).name('model roughness').onChange((v: string) => {
    for (const m of materials) m.roughness = v === 'from the file' ? 1 : 0; // the file's roughness map multiplies this
    resetHistories();
  });
  fs.add(ui, 'normalMaps').name('model normal maps').onChange((on: boolean) => {
    for (const m of materials) { m.normalMap = on ? normalMaps.get(m) ?? null : null; m.needsUpdate = true; }
    resetHistories();
  });
  fs.add(ui, 'tableRough', 0, 0.5, 0.01).name('table roughness').onChange((v: number) => { tableMat.roughness = v; });
  fs.add(ui, 'turntable').name('turn the model');
  fs.add(ui, 'orbit').name('camera orbit (else drag)');
  const fssr = gui.addFolder('SSR');
  fssr.add(ui, 'ssrThickness', 0.005, 0.3, 0.005).name('thickness (Ben: 0.03)').onChange((v: number) => { g.ssrNode.thickness.value = v; });
  fssr.add(ui, 'ssrDistance', 0.5, 10, 0.1).name('max distance').onChange((v: number) => { g.ssrNode.maxDistance.value = v; });
  // three's stochastic march: a fixed step count (quality x its maximum) spread as (i / steps)^exponent, offset by a
  // new noise value every frame; coarse far steps + a thin thickness = the hit jumps between frames
  fssr.add(ui, 'ssrQuality', 0.1, 1, 0.05).name('quality (step count)').onChange((v: number) => { g.ssrNode.quality.value = v; });
  fssr.add(ui, 'ssrStepExponent', 1, 3, 0.25).name('step exponent').onChange((v: number) => { g.ssrNode.stepExponent = v; });
  fssr.add(ui, 'ssrBinaryRefine').name('binary refine').onChange((v: boolean) => { g.ssrNode.binaryRefine = v; });
  gui.add({ reset: resetHistories }, 'reset').name('reset denoiser histories');

  buildOutput();
  void table;
  (window as N).__rb = { ready: true, ui, apply: () => { setResolve(); }, rebuild, gui };
}

main().catch((e) => { console.error(e); log(String(e?.stack ?? e)); });
