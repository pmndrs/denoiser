// A port of three.js's official example webgpu_postprocessing_ssr_denoise.html
// (r186) with the FidelityFX reflection denoiser swapped in, side by side:
//
//   left  (A)  three's own   ssr -> temporalReproject -> recurrentDenoise   (unchanged from the example)
//   right (B)  denoiser/three  ssr -> ffxReflections(radiance = ssr.rgb, hitDistance = ssr.a)
//
// Same scene, model, HDR, camera, SSR parameters. Each side has its OWN ssr node
// (so each can feed its own denoised result back as SSR history, as the original
// does). Differences from the original, all deliberate:
//   - no TRAA / sharpen at the end (they'd hide the denoisers' own difference);
//   - no Inspector GUI (a handful of HTML controls instead);
//   - fixed 960x540 canvas;
//   - assets are loaded from raw.githubusercontent.com at the r186 tag (the GLB
//     is >20MB-class for jsDelivr's CDN limits and 403s there).
import * as THREE from 'three/webgpu';
import {
  pass, mrt, output, normalView, materialMetalness, materialRoughness, screenUV, sample,
  packNormalToRGB, unpackRGBToNormal, vec2, velocity, diffuseColor, vec3, vec4, uniform, mix,
  step, abs, float, renderOutput, saturation,
} from 'three/tsl';
import { ssr } from 'three/addons/tsl/display/SSRNode.js';
import { temporalReproject } from 'three/addons/tsl/display/TemporalReprojectNode.js';
import { recurrentDenoise } from 'three/addons/tsl/display/RecurrentDenoiseNode.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ffxReflections, getGPUTexture } from 'denoiser/three';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any; // TSL's node typings are too strict for this much shader plumbing

const ASSETS = 'https://raw.githubusercontent.com/mrdoob/three.js/r186/examples/';
const W = 960, H = 540;
const q = new URLSearchParams(location.search);
const manual = q.has('manual');
const statusEl = document.querySelector<HTMLPreElement>('#status')!;
const log = (m: string) => { statusEl.textContent = m; console.log('[ssr]', m); };

// Disable env-map specular for every PBR material: SSR provides the specular
// reflections (verbatim from the original example).
const _indirectSpecular = THREE.PhysicalLightingModel.prototype.indirectSpecular;
THREE.PhysicalLightingModel.prototype.indirectSpecular = function (this: N, builder: N) {
  builder.context.radiance = vec3(0);
  if (this.clearcoatRadiance) this.clearcoatRadiance.assign(vec3(0));
  _indirectSpecular.call(this, builder);
};

const params = {
  roughness: 0.3,
  ssr: {
    resolutionScale: 1, quality: 0.25, mirrorBias: 0.5, maxDistance: 0.4, intensity: 1, thickness: 0.1,
    maxLuminance: 35, binaryRefine: false, stepExponent: 3, envImportanceSampling: false,
    screenEdgeFade: 0.2, screenEdgeFadeBlack: false, environmentIntensity: 3.14,
  },
  temporalReproject: { maxFrames: 16, clampIntensity: 0.25, flickerSuppression: 1, hitPointReprojection: true },
  denoise: {
    lumaPhi: 0.75, depthPhi: 20, normalPhi: 0.3, roughnessPhi: 100, radius: 1.5, alphaPhi: 5,
    strength: 0.725, adapt: 0.5, smoothDisocclusions: true, flickerSuppression: 1, adaptiveTrust: 1,
  },
  grading: { exposure: 1.57, gamma: 0.89, contrast: 1.31, saturation: 1 },
};

async function main() {
  if (!navigator.gpu) { log('WebGPU is not available in this browser.'); return; }
  const canvas = document.querySelector<HTMLCanvasElement>('#view')!;
  canvas.width = W; canvas.height = H;

  const camera = new THREE.PerspectiveCamera(35, W / H, 0.1, 8);
  const scene = new THREE.Scene();

  const renderer = new THREE.WebGPURenderer({ canvas, antialias: false, trackTimestamp: q.has('timing') } as N);
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = params.grading.exposure;
  renderer.shadowMap.enabled = true;
  await renderer.init();
  const device = (renderer.backend as unknown as { device: GPUDevice }).device;
  const gpuErrors: string[] = [];
  device.addEventListener('uncapturederror', (e) => {
    gpuErrors.push((e as GPUUncapturedErrorEvent).error.message);
    console.error('[webgpu uncapturederror]', (e as GPUUncapturedErrorEvent).error.message);
  });
  device.lost.then((i) => log(`DEVICE LOST: ${i.reason} ${i.message}`));

  log('loading dungeon_warkarma.glb + quarry_01_1k.hdr from raw.githubusercontent.com (r186) ...');
  const [gltf, hdrTexture] = await Promise.all([
    new GLTFLoader().loadAsync(ASSETS + 'models/gltf/dungeon_warkarma.glb'),
    new HDRLoader().loadAsync(ASSETS + 'textures/equirectangular/quarry_01_1k.hdr'),
  ]);
  gltf.scene.scale.multiplyScalar(0.1);
  gltf.scene.traverse((object: N) => {
    if (!object.material) return;
    object.castShadow = true;
    object.receiveShadow = true;
    object.material.roughness = 0.3;
    object.material.normalMap = null;
  });
  scene.add(gltf.scene);

  hdrTexture.mapping = THREE.EquirectangularReflectionMapping;
  scene.background = hdrTexture;
  scene.environment = hdrTexture;
  hdrTexture.generateMipmaps = true;
  hdrTexture.needsUpdate = true;
  scene.environmentIntensity = 1;

  const directionalLight = new THREE.DirectionalLight('#ffffff', 20);
  directionalLight.position.set(-10.9, 2.2, 10.75);
  directionalLight.castShadow = true;
  directionalLight.shadow.autoUpdate = false;
  directionalLight.shadow.needsUpdate = true;
  directionalLight.shadow.mapSize.set(4096, 4096);
  Object.assign(directionalLight.shadow.camera, { left: -1.75, right: 1.75, top: 1.75, bottom: -1.75, near: 0.1, far: 50 });
  directionalLight.shadow.bias = -0.0005;
  scene.add(directionalLight);

  // ---- graph (the original's, twice) ----------------------------------------------
  const scenePass = pass(scene, camera);
  scenePass.setMRT(mrt({
    output,
    diffuseColor: vec4(diffuseColor.rgb, materialMetalness),               // albedo + metalness
    normal: vec4(packNormalToRGB(normalView).rgb, materialRoughness),      // packed VIEW normal + roughness
    velocity,
  }));
  const scenePassColor = scenePass.getTextureNode('output');
  const scenePassNormal = scenePass.getTextureNode('normal');
  const scenePassDepth = scenePass.getTextureNode('depth');
  const scenePassVelocity = scenePass.getTextureNode('velocity');
  const scenePassDiffuseColor = scenePass.getTextureNode('diffuseColor');
  scenePass.getTexture('normal').type = THREE.UnsignedByteType;
  scenePass.getTexture('diffuseColor').type = THREE.UnsignedByteType;

  const sceneNormal = sample((uv: N) => unpackRGBToNormal(scenePassNormal.sample(uv).rgb));
  const scenePassMetalRough = sample((uv: N) => vec2(scenePassDiffuseColor.sample(uv).a, scenePassNormal.sample(uv).a));

  const makeSsr = () => ssr(scenePassColor, scenePassDepth, sceneNormal, {
    stochastic: true,
    diffuseNode: scenePassDiffuseColor,
    metalnessNode: scenePassDiffuseColor.a,
    roughnessNode: scenePassNormal.a,
    environmentNode: hdrTexture,
    envImportanceSampling: params.ssr.envImportanceSampling,
    binaryRefine: params.ssr.binaryRefine,
  } as N) as N;

  // A: three's pipeline, as in the example
  const ssrA = makeSsr();
  const reprojA = temporalReproject(ssrA, scenePassDepth, scenePassNormal, scenePassVelocity, camera, {
    mode: 'specular', accumulate: false,
  }) as N;
  const denoiseA = recurrentDenoise(reprojA, camera, {
    depth: scenePassDepth, normal: scenePassNormal, raw: ssrA, metalRoughness: scenePassMetalRough,
    mode: 'specular', accumulate: true,
  } as N) as N;
  denoiseA.alphaSource = 'raylength';
  ssrA.setHistory(denoiseA, scenePassVelocity);
  reprojA.setHistoryTexture(denoiseA);

  // B: FFX. radiance = ssr.rgb, hitDistance = ssr.a (ray length; env-fallback rays
  // report 1e4, no hit/masked pixels 0), roughness = normal.a, normal = unpacked
  // VIEW normal (converted to world space inside the node's helper).
  const ssrB = makeSsr();
  const ffxB = ffxReflections(ssrB, {
    camera, depth: scenePassDepth, velocity: scenePassVelocity,
    roughness: scenePassNormal.a,
    normal: scenePassNormal, normalSpace: 'view', normalEncoding: 'packed',
  });
  const ffxHistory = q.get('ffxHistory') !== '0';
  if (ffxHistory) ssrB.setHistory(ffxB.outputTexture, scenePassVelocity);

  // ---- output --------------------------------------------------------------------
  const gamma = uniform(params.grading.gamma), contrast = uniform(params.grading.contrast), sat = uniform(params.grading.saturation);
  const split = uniform(0.5);   // left of this = three (A), right = FFX (B); 1 = all A, 0 = all B
  const line = uniform(1);
  const noisyMix = uniform(0);  // 1 = raw noisy SSR instead of either denoiser
  const grade = (rgb: N) => {
    let c = renderOutput(vec4(rgb, 1), THREE.AgXToneMapping, THREE.SRGBColorSpace).rgb;
    c = c.sub(0.5).mul(contrast).add(0.5);
    c = saturation(c, sat);
    c = c.max(0).pow(float(1).div(gamma));
    return vec4(c, 1);
  };
  type Variant = 'both' | 'A' | 'B' | 'noisy';
  const buildOutput = (v: Variant) => {
    // as in the original: reference ssr.a so the SSR nodes are built / rendered
    const blendA = vec4(denoiseA.rgb, ssrA.a.greaterThan(0).toVar());
    const blendB = vec4(ffxB.rgb, ssrB.a.greaterThan(0).toVar());
    const litA = scenePassColor.rgb.add(blendA.rgb);
    const litB = scenePassColor.rgb.add(blendB.rgb);
    const litNoisy = scenePassColor.rgb.add(vec4(ssrA.rgb, ssrA.a.greaterThan(0).toVar()).rgb);
    let lit: N;
    if (v === 'noisy') lit = litNoisy;
    else if (v === 'A') lit = litA;
    else if (v === 'B') lit = litB;
    else lit = mix(litA, litB, step(split, screenUV.x));
    if (v === 'both') lit = mix(lit, litNoisy, noisyMix);
    const graded = grade(lit);
    if (v !== 'both') return graded;
    const lineW = float(1).div(W);
    const onLine = float(1).sub(step(lineW, abs(screenUV.x.sub(split)))).mul(line);
    return mix(graded, vec4(1), onLine);
  };

  const pipeline = new THREE.RenderPipeline(renderer);
  pipeline.outputColorTransform = false;
  let variant: Variant = 'both';
  const setVariant = (v: Variant) => { variant = v; pipeline.outputNode = buildOutput(v); pipeline.needsUpdate = true; };
  setVariant('both');

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  camera.position.set(1.259878548682251, 0.5391287340899181, -0.27217301481427114);
  camera.rotation.set(-0.3158233106804791, 0.26820684188431526, 0.08637696823742165);
  controls.target.set(1.0258536154689288, 0.2746440590977971, -1.0815876858987743);
  controls.update();
  const basePos = camera.position.clone();
  const baseTarget = controls.target.clone();

  function applyParams() {
    const s = ssrA, p = params.ssr;
    for (const n of [ssrA, ssrB]) {
      n.resolutionScale = p.resolutionScale;
      n.quality.value = p.quality; n.mirrorBias.value = p.mirrorBias;
      n.stepExponent = p.stepExponent; n.binaryRefine = p.binaryRefine;
      n.maxDistance.value = p.maxDistance; n.intensity.value = p.intensity; n.thickness.value = p.thickness;
      n.maxLuminance.value = p.maxLuminance; n.screenEdgeFade.value = p.screenEdgeFade;
      n.screenEdgeFadeBlack = p.screenEdgeFadeBlack; n.environmentIntensity.value = p.environmentIntensity;
    }
    void s;
    const t = params.temporalReproject;
    reprojA.maxFrames.value = t.maxFrames; reprojA.clampIntensity.value = t.clampIntensity;
    reprojA.flickerSuppression.value = t.flickerSuppression; reprojA.hitPointReprojection.value = t.hitPointReprojection;
    const d = params.denoise;
    for (const k of ['lumaPhi', 'depthPhi', 'normalPhi', 'roughnessPhi', 'radius', 'alphaPhi', 'strength', 'adapt', 'smoothDisocclusions', 'flickerSuppression', 'adaptiveTrust'] as const) {
      denoiseA[k].value = d[k];
    }
  }
  applyParams();

  // ---- animation / stepping -----------------------------------------------------
  let moving = true, t = 0, frame = 0;
  function pose() {
    if (moving) {
      // gentle orbit around the example's start pose (deterministic in t)
      const a = 0.35 * Math.sin(t * 0.5);
      const off = basePos.clone().sub(baseTarget).applyAxisAngle(new THREE.Vector3(0, 1, 0), a);
      off.y += 0.06 * Math.sin(t * 0.8);
      camera.position.copy(baseTarget).add(off);
      camera.lookAt(baseTarget);
      controls.enabled = false;
    } else controls.enabled = true;
  }
  function renderOne() {
    if (moving) t += 1 / 60;
    pose();
    if (!moving) controls.update();
    pipeline.render();
    frame++;
  }


  // three advances `FRAME`-type node updates (SSR noise, the denoiser nodes) only in
  // its animation loop, so even the headless stepping goes through setAnimationLoop.
  let job: { left: number; each?: () => void; done: () => void } | null = null;
  const frames = (n: number, each?: () => void) => new Promise<void>((res) => { job = { left: n, each, done: res }; });
  renderer.setAnimationLoop(() => {
    if (!manual) { renderOne(); return; }
    if (!job) return;
    renderOne();
    job.each?.();
    if (--job.left === 0) { const d = job.done; job = null; d(); }
  });

  // ---- UI -------------------------------------------------------------------------
  const wire = (id: string, fn: (v: string) => void) => {
    const seg = document.querySelector<HTMLDivElement>(id)!;
    seg.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.addEventListener('click', () => {
      seg.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', 'false'));
      b.setAttribute('aria-pressed', 'true');
      fn(b.dataset.v!);
    }));
  };
  const setView = (v: string) => {
    if (variant !== 'both') setVariant('both');
    noisyMix.value = v === 'noisy' ? 1 : 0;
    line.value = v === 'split' ? 1 : 0;
    split.value = v === 'split' ? 0.5 : v === 'three' ? 1 : v === 'ffx' ? 0 : 0.5;
  };
  const cut = () => { ffxB.resetHistory(); basePos.applyAxisAngle(new THREE.Vector3(0, 1, 0), 1.2); t += 3.1; };
  wire('#seg-view', setView);
  wire('#seg-motion', (v) => { moving = v === 'on'; });
  document.querySelector('#cut')!.addEventListener('click', cut);
  const sp = document.querySelector<HTMLInputElement>('#split');
  sp?.addEventListener('input', () => { split.value = parseFloat(sp.value); });

  // ---- test hooks ---------------------------------------------------------------
  const copyCanvas = document.createElement('canvas');
  copyCanvas.width = W; copyCanvas.height = H;
  const cctx = copyCanvas.getContext('2d', { willReadFrequently: true })!;
  const readFrame = () => { cctx.drawImage(canvas, 0, 0); return cctx.getImageData(0, 0, W, H); };
  const lumaOf = (d: ImageData) => {
    const o = new Float32Array(W * H);
    for (let i = 0; i < o.length; i++) o[i] = (0.2126 * d.data[i * 4] + 0.7152 * d.data[i * 4 + 1] + 0.0722 * d.data[i * 4 + 2]) / 255;
    return o;
  };
  const idle = () => device.queue.onSubmittedWorkDone();

  async function nonFinite(tex: THREE.Texture) {
    const gpu = getGPUTexture(renderer, tex);
    const bpr = Math.ceil(gpu.width * 8 / 256) * 256;
    const buf = device.createBuffer({ size: bpr * gpu.height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const enc = device.createCommandEncoder();
    enc.copyTextureToBuffer({ texture: gpu }, { buffer: buf, bytesPerRow: bpr }, { width: gpu.width, height: gpu.height });
    device.queue.submit([enc.finish()]);
    await buf.mapAsync(GPUMapMode.READ);
    const u16 = new Uint16Array(buf.getMappedRange());
    let bad = 0, nonzero = 0;
    for (let y = 0; y < gpu.height; y++) {
      for (let x = 0; x < gpu.width; x++) {
        const o = (y * bpr) / 2 + x * 4;
        for (let c = 0; c < 4; c++) if (((u16[o + c] >> 10) & 31) === 31) bad++;
        if ((u16[o] & 0x7fff) !== 0) nonzero++;
      }
    }
    buf.unmap(); buf.destroy();
    return { w: gpu.width, h: gpu.height, bad, nonzeroPixels: nonzero };
  }

  /** Per-pixel temporal std of luma over K static frames, per view. */
  async function stdOf(K: number) {
    const sum = new Float64Array(W * H), sum2 = new Float64Array(W * H);
    await frames(K, () => {
      const l = lumaOf(readFrame());
      for (let i = 0; i < l.length; i++) { sum[i] += l[i]; sum2[i] += l[i] * l[i]; }
    });
    const s = new Float32Array(W * H);
    for (let i = 0; i < s.length; i++) { const m = sum[i] / K; s[i] = Math.sqrt(Math.max(0, sum2[i] / K - m * m)); }
    return s;
  }

  const api = {
    ready: true,
    gpuErrors,
    info: { three: THREE.REVISION, ffxHistory, assets: ASSETS },
    async step(n: number) { await frames(n); await idle(); },
    setView,
    setMoving(m: boolean) { moving = m; },
    cut,
    async capture(): Promise<string> {
      await frames(1, readFrame);
      const url = copyCanvas.toDataURL('image/png');
      await idle();
      return url;
    },
    async finiteCheck() {
      return { ffx: await nonFinite(ffxB.outputTexture) };
    },
    /** Static camera. Mean temporal std of luma over pixels where the noisy view flickers. */
    async measure(K = 16, warmup = 24, thr = 0.02) {
      moving = false;
      const run = async (v: string) => { setView(v); await frames(warmup); return stdOf(K); };
      const noisy = await run('noisy');
      const three = await run('three');
      const ffx = await run('ffx');
      const mask = noisy.map((s) => (s > thr ? 1 : 0));
      const mean = (s: Float32Array) => { let a = 0, n = 0; for (let i = 0; i < s.length; i++) if (mask[i]) { a += s[i]; n++; } return n ? a / n : 0; };
      setView('split');
      return { pixels: mask.reduce((a, b) => a + b, 0), noisy: { std: mean(noisy) }, three: { std: mean(three) }, ffx: { std: mean(ffx) } };
    },
    /**
     * GPU ms per frame of the render-pass work (three's own passes) for each
     * variant, via timestamp queries, plus FFX's compute passes (gpuTimings).
     * Variants: noisy = scene + SSR only; A = + three's denoiser; B = + FFX.
     */
    async timings(count = 20) {
      moving = false;
      const out: Record<string, unknown> = {};
      for (const v of ['noisy', 'A', 'B'] as const) {
        setVariant(v);
        await frames(30);
        await idle();
        let sum = 0, n = 0, ffxSum = 0;
        for (let i = 0; i < count; i++) {
          await frames(1);
          await renderer.resolveTimestampsAsync('render' as N);
          sum += renderer.info.render.timestamp; n++;
          if (v === 'B') ffxSum += ffxB.denoiser?.gpuTimings?.get('total') ?? 0;
        }
        out[v] = { renderPassesMs: sum / n, ...(v === 'B' ? { ffxComputeMs: ffxSum / n } : {}) };
      }
      out.ffxPasses = Object.fromEntries(ffxB.denoiser?.gpuTimings ?? []);
      setVariant('both');
      return out;
    },
  };
  (window as unknown as { __t: typeof api }).__t = api;

  log(`ready - three r${THREE.REVISION}; left = three recurrentDenoise, right = FFX reflections${ffxHistory ? ' (FFX output fed back as SSR history)' : ''}`);
}

main().catch((e) => { log(`ERROR: ${(e as Error).stack ?? e}`); console.error(e); (window as unknown as { __error?: string }).__error = String(e); });
