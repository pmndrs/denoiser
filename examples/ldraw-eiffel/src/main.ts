// LDraw Eiffel Tower demo: a table, an HDRI, a gelatinous cube, and the LEGO
// Architecture Eiffel Tower (21019) — orbit with camera-controls and you get
// the plain raster render; let the camera rest and the WebGPU path tracer
// accumulates, then the denoiser resolves the noise-free frame on top.
//
// Same shared-GPUDevice setup as examples/three-pathtracer-webgpu (createStack):
// with ORT the denoiser creates the device first and three.js borrows it
// (onnxruntime #26107); the other runtimes adopt the renderer's device.
import * as THREE from 'three/webgpu';
import { mrt, diffuseColor, normalView, texture as textureNode, vec4 } from 'three/tsl';
import CameraControls from 'camera-controls';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { LDrawLoader } from 'three/addons/loaders/LDrawLoader.js';
import { LDrawConditionalLineMaterial } from 'three/addons/materials/LDrawConditionalLineNodeMaterial.js';
import { LDrawUtils } from 'three/addons/utils/LDrawUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { WebGPUPathTracer } from 'three-gpu-pathtracer/webgpu';
import { installGalleryCapture } from '../../_shared/gallery-capture';
import { createStack, gpuTex, mountRuntimePicker } from '../../_shared/stack';
import { sampleCounter } from '../../_shared/pathtracer';
import { ensureWebGPU, demoFooter, pathtracerNote } from '../../_shared/chrome';

/** vite.config.ts `define`: packages/denoiser/models exists locally (dev only). */
declare const __LOCAL_ONNX_MODELS__: boolean;

const status = document.querySelector<HTMLPreElement>('#status')!;
const modeLabel = document.querySelector<HTMLSpanElement>('#mode')!;
// The rAF loop keeps a trailing `samples: …` line (trimmed, no newline) — start each
// log entry on its own line so the loop's rewrite of that line can't swallow it.
const log = (m: string) => {
  const t = status.textContent ?? '';
  status.textContent = t + (t && !t.endsWith('\n') ? '\n' : '') + m + '\n';
  console.log(m);
};

// Everything (canvas, tracer target, G-buffer, overlay) stays at 512 so the
// zero-copy texture paths are size-matched; the tracer follows the canvas size.
const RES = 512;

async function buildScene(): Promise<{ scene: THREE.Scene; camera: THREE.PerspectiveCamera }> {
  const scene = new THREE.Scene();

  // Soft overcast sky: near-uniform luminance. Chosen when the early WebGPU
  // tracer left HDRIs with small intense lights (studio lamps, sun disks)
  // salt-and-pepper noisy even at high sample counts, and that speckle
  // survived the denoiser; kept so the gallery captures stay comparable.
  // BASE_URL keeps assets resolving under the deployed subpath (/denoiser/ldraw-eiffel/); it is "/" in dev.
  const env = await new HDRLoader().loadAsync(`${import.meta.env.BASE_URL}assets/kloppenheim_06_puresky_1k.hdr`);
  env.mapping = THREE.EquirectangularReflectionMapping;
  scene.environment = env;
  scene.background = env;

  // Table surface.
  const table = new THREE.Mesh(
    new RoundedBoxGeometry(11, 0.5, 11, 3, 0.08),
    // Rough enough that the glossy lobe doesn't turn the HDRI's small bright
    // lamps into fireflies (the WebGPU tracer has no glossy filter yet).
    new THREE.MeshStandardMaterial({ color: 0x9a6a39, roughness: 0.7 }),
  );
  table.name = 'table';
  table.position.y = -0.25;
  scene.add(table);

  // Gelatinous cube: `transmission` gives the raster preview real glassiness
  // (and is traced as refraction by three-gpu-pathtracer 0.0.27+);
  // `transparent`+`opacity` additionally drives the tracer's stochastic
  // pass-through, keeping the cube light enough to see the tower behind it.
  const gel = new THREE.Mesh(
    new THREE.BoxGeometry(1.3, 1.3, 1.3),
    new THREE.MeshPhysicalMaterial({
      color: 0x3ec46d,
      roughness: 0.18,
      transmission: 1,
      ior: 1.35,
      thickness: 1.2,
      transparent: true,
      opacity: 0.45,
    }),
  );
  gel.name = 'gel';
  gel.position.set(2.4, 0.651, 1.6);
  gel.rotation.y = 0.5;
  scene.add(gel);

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
  camera.position.set(6.5, 4.5, 8.5);
  return { scene, camera };
}

async function loadEiffel(scene: THREE.Scene) {
  const t0 = performance.now();
  const loader = new LDrawLoader();
  loader.smoothNormals = true;
  // three r185+ requires the renderer-appropriate conditional-line material to be
  // injected (node material for WebGPU). The lines get stripped below anyway.
  loader.setConditionalLineMaterial(LDrawConditionalLineMaterial);
  // Packed MPD (tools/pack-ldraw.mjs): every part + LDConfig colors inlined,
  // so no runtime trips to a parts-library CDN.
  const raw = await loader.loadAsync(`${import.meta.env.BASE_URL}assets/eiffel-tower_Packed.mpd`);
  raw.rotation.x = Math.PI; // LDraw is -Y up
  raw.updateMatrixWorld(true);

  // One mesh with material groups instead of ~1000 part meshes — one BLAS
  // build instead of hundreds (the WebGPU tracer supports geometry groups).
  const model = LDrawUtils.mergeObject(raw);

  // Drop the LDraw construction/edge lines: the tracer only sees meshes, and
  // the raster preview should match what gets traced.
  const lines: THREE.Object3D[] = [];
  model.traverse((c: THREE.Object3D) => {
    if ((c as THREE.LineSegments).isLineSegments || (c as THREE.Line).isLine) lines.push(c);
  });
  lines.forEach((l) => l.removeFromParent());

  // Scale to ~3.6 units tall, centered, base resting on the table (y=0).
  let tris = 0;
  let meshCount = 0;
  model.traverse((o: THREE.Object3D) => {
    const c = o as THREE.Mesh;
    if (c.isMesh) { meshCount++; tris += (c.geometry.index?.count ?? c.geometry.attributes.position.count) / 3; }
  });
  log(`merged model: ${meshCount} mesh(es), ${tris.toFixed(0)} tris`);
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  log(`model size: ${size.x.toFixed(1)} × ${size.y.toFixed(1)} × ${size.z.toFixed(1)}`);
  model.scale.setScalar(3.6 / size.y);
  model.updateMatrixWorld(true);
  box.setFromObject(model);
  const center = box.getCenter(new THREE.Vector3());
  model.position.set(-center.x, model.position.y - box.min.y, -center.z);
  model.name = 'eiffel';
  scene.add(model);
  log(`Eiffel Tower loaded + merged in ${(performance.now() - t0).toFixed(0)} ms`);
}

async function main() {
  if (!(await ensureWebGPU())) return;
  // 1+2) One GPUDevice for the denoiser and three.js. ?runtime=auto|ort|wgsl|webnn|kernels (default auto;
  // the on-page picker reloads with it) picks the network runtime; createStack() orders device creation accordingly
  // (ORT: denoiser first, three borrows it; others: three first, runtime adopts it).
  // Dev serves converted ORT models from /models (vite middleware) when present locally; otherwise (and in prod) the CDN default.
  const canvas = document.querySelector<HTMLCanvasElement>('#view')!;
  // Runtime picker first, so a runtime that fails to initialize can still be switched away from.
  const picker = mountRuntimePicker(document.querySelector<HTMLElement>('#runtimePicker'));
  const { renderer, denoiser, device } = await createStack({
    renderer: { canvas, antialias: true },
    weightsUrl: import.meta.env.DEV && __LOCAL_ONNX_MODELS__ ? '/models' : undefined,
    // three's official Inspector (r180+): render-target viewer, node parameters,
    // profiler. Opt-in via ?inspector — it overlays its own UI.
    beforeInit: async (r) => {
      if (new URLSearchParams(location.search).has('inspector')) {
        const { Inspector } = await import('three/addons/inspector/Inspector.js');
        r.inspector = new Inspector();
        log('three.js Inspector attached');
      }
    },
  }).catch((e) => { picker.failed((e as Error).message); throw e; });
  picker.attach(denoiser);
  log(`denoiser ready (${denoiser.runtime.name}); sharing its GPUDevice with three.js`);
  device.lost.then((info) => log(`DEVICE LOST: ${info.reason} — ${info.message}`));
  device.addEventListener('uncapturederror', (e) =>
    log(`UNCAPTURED GPU ERROR: ${(e as GPUUncapturedErrorEvent).error.message}`));
  renderer.setSize(RES, RES, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;

  // 3) Scene + model.
  const { scene, camera } = await buildScene();
  await loadEiffel(scene);

  // 4) Path tracer (default wavefront backend; full-res noisy frames from sample 1).
  const t0 = performance.now();
  const pathTracer = new WebGPUPathTracer(renderer);
  pathTracer.dynamicLowRes = false;
  pathTracer.renderDelay = 0;
  pathTracer.setScene(scene, camera);
  log(`path tracer BVH built in ${(performance.now() - t0).toFixed(0)} ms`);
  // Per-pixel sample count (async GPU measurement, polled once per frame).
  const samples = sampleCounter(pathTracer);

  // 5) camera-controls: raster preview while the camera moves, trace at rest.
  // camera-controls is fully typed but `three` here isn't (repo status quo) — cast.
  CameraControls.install({ THREE: THREE as unknown as Parameters<typeof CameraControls.install>[0]['THREE'] });
  const controls = new CameraControls(camera, canvas);
  controls.minDistance = 2;
  controls.maxDistance = 50;
  controls.setLookAt(6.5, 4.5, 8.5, 0, 1.6, 0, false);
  let userActive = false;
  controls.addEventListener('controlstart', () => { userActive = true; });
  controls.addEventListener('controlend', () => { userActive = false; });

  // Live GPUTexture of the tracer's accumulation (refetched — it can be
  // replaced on reset) and of three-owned render targets.
  const backendGet = (t: THREE.Texture) => gpuTex(renderer, t);
  // (pathTracer.target: rgba32float StorageTexture, ping-ponged per sample.)
  const getTracerTexture = (): GPUTexture | undefined =>
    pathTracer.target ? backendGet(pathTracer.target) : undefined;

  // Denoised overlay canvas (webgpu context, plain texture copy). ?headless=1
  // skips it — a second getContext('webgpu')+configure stalls headless Chrome
  // (same as three-pathtracer-webgpu). The gallery capture doesn't need it.
  const headless = new URLSearchParams(location.search).has('headless');
  const overlayCanvas = document.querySelector<HTMLCanvasElement>('#denoised')!;
  const overlayCtx = headless ? undefined : overlayCanvas.getContext('webgpu')!;
  overlayCtx?.configure({
    device, format: 'rgba8unorm',
    usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
  });
  const blitToOverlay = (tex: GPUTexture) => {
    if (!overlayCtx) return;
    const enc = device.createCommandEncoder();
    enc.copyTextureToTexture({ texture: tex }, { texture: overlayCtx.getCurrentTexture() },
      { width: Math.min(tex.width, RES), height: Math.min(tex.height, RES) });
    device.queue.submit([enc.finish()]);
  };
  const reveal = document.querySelector<HTMLInputElement>('#reveal')!;
  const revealWrap = document.querySelector<HTMLDivElement>('#revealWrap')!;
  reveal.addEventListener('input', () => { revealWrap.style.width = `${reveal.value}%`; });

  // G-buffer aux: rasterize the same view once into an MRT target — albedo =
  // unlit base color, normal = view-space normal. Noise-free aux → cleanAux models.
  const auxCheckbox = document.querySelector<HTMLInputElement>('#aux')!;
  const auxOpaqueCheckbox = document.querySelector<HTMLInputElement>('#auxOpaque')!;
  // Two separate passes, because the two guides want different scene state
  // (OIDN conventions):
  //  - albedo: background ON — env color IS the correct albedo for env pixels
  //    (clamped engine-side); transparent surfaces through-blend, unless the
  //    "opaque aux" toggle forces first-hit albedo.
  //  - normal: background OFF — the env quad's normalView is a meaningless
  //    gradient, while a cleared target reads as normal=0, exactly OIDN's env
  //    convention. Transparency is ALWAYS off here: alpha-blended normals are
  //    garbage; first-hit normals are the contract.
  const albedoRT = new THREE.RenderTarget(RES, RES, { type: THREE.HalfFloatType });
  const normalRT = new THREE.RenderTarget(RES, RES, { type: THREE.HalfFloatType });
  // MRTNode routes outputs to render-target textures BY NAME — unnamed
  // textures make the index lookup return -1 and the node build crash.
  albedoRT.texture.name = 'albedo';
  normalRT.texture.name = 'normal';
  let gbufferRendered = false;
  function forceOpaque(): Array<() => void> {
    const restore: Array<() => void> = [];
    scene.traverse((o: THREE.Object3D) => {
      const c = o as THREE.Mesh;
      const mats: THREE.Material[] = c.isMesh
        ? (Array.isArray(c.material) ? c.material : [c.material])
        : [];
      for (const m of mats) {
        if (m.transparent) {
          m.transparent = false;
          m.needsUpdate = true;
          restore.push(() => { m.transparent = true; m.needsUpdate = true; });
        }
      }
    });
    return restore;
  }
  function renderGBuffer() {
    // albedo pass
    let restore: Array<() => void> = auxOpaqueCheckbox.checked ? forceOpaque() : [];
    try {
      renderer.setMRT(mrt({ albedo: diffuseColor }));
      renderer.setRenderTarget(albedoRT);
      renderer.render(scene, camera);
    } finally {
      // ALWAYS unwind — leaked MRT state crashes every later render.
      renderer.setRenderTarget(null);
      renderer.setMRT(null);
      restore.forEach((fn) => fn());
    }
    // normal pass
    restore = forceOpaque();
    const bg = scene.background;
    scene.background = null;
    try {
      renderer.setMRT(mrt({ normal: normalView }));
      renderer.setRenderTarget(normalRT);
      renderer.render(scene, camera);
      gbufferRendered = true;
    } finally {
      renderer.setRenderTarget(null);
      renderer.setMRT(null);
      scene.background = bg;
      restore.forEach((fn) => fn());
    }
  }

  // UI knobs.
  const maxSamplesInput = document.querySelector<HTMLInputElement>('#maxSamples')!;
  const maxSamples = () => Math.max(1, parseInt(maxSamplesInput.value, 10) || 32);
  // The tracer caps accumulation itself: every pixel stops at exactly maxSamples.
  pathTracer.maxSamples = maxSamples();
  const progressiveCheckbox = document.querySelector<HTMLInputElement>('#progressive')!;
  const qualitySel = document.querySelector<HTMLSelectElement>('#quality')!;
  denoiser.quality = qualitySel.value as 'fast' | 'balanced'; // honor the HTML default

  let denoiseBusy = false;
  let denoisedAtSample = -1;
  let denoiseMs = 0;

  const invalidateDenoise = () => {
    denoisedAtSample = -1;
    denoiser.abort();
    overlayCanvas.style.opacity = '0';
  };
  qualitySel.addEventListener('change', () => {
    denoiser.quality = qualitySel.value as 'fast' | 'balanced';
    invalidateDenoise();
  });
  auxCheckbox.addEventListener('change', () => { gbufferRendered = false; invalidateDenoise(); });
  auxOpaqueCheckbox.addEventListener('change', () => { gbufferRendered = false; invalidateDenoise(); });
  maxSamplesInput.addEventListener('change', () => {
    pathTracer.maxSamples = maxSamples();
    pathTracer.reset();
    samples.reset();
    invalidateDenoise();
  });

  // --- input debug views: put the network's actual inputs on the overlay ---
  // color and aux are shown as-is (inputFlipY / auxInputFlipY: false — the
  // tracer's compute target and the raster G-buffer are both top-down), i.e.
  // exactly as the network pairs them — a wrong flip flag shows up here as
  // color/aux vertical mismatch.
  const viewSel = document.querySelector<HTMLSelectElement>('#viewMode')!;
  const debugRT = new THREE.RenderTarget(RES, RES); // rgba8unorm
  const debugQuad = new THREE.QuadMesh(new THREE.NodeMaterial());
  const getTracerThreeTexture = () => pathTracer.target;
  let debugKey = '';
  function renderDebugView(view: string) {
    if (view !== 'color' && !gbufferRendered) renderGBuffer();
    const src = view === 'color' ? getTracerThreeTexture()
      : view === 'albedo' ? albedoRT.texture : normalRT.texture;
    if (!src) return;
    const key = `${view}:${src.uuid}`;
    if (key !== debugKey) {
      const t = textureNode(src);
      // Display transforms only: color = linear HDR -> Reinhard + gamma;
      // albedo = linear [0,1] -> gamma; normal = [-1,1] -> [0,1] RAW (no
      // gamma) so wrong ranges read as washed-out gray or hard clipping.
      const rgb = view === 'color' ? t.rgb.div(t.rgb.add(1)).pow(1 / 2.2)
        : view === 'albedo' ? t.rgb.pow(1 / 2.2)
          : t.rgb.mul(0.5).add(0.5);
      (debugQuad.material as THREE.NodeMaterial).fragmentNode = vec4(rgb, 1);
      (debugQuad.material as THREE.NodeMaterial).needsUpdate = true;
      debugKey = key;
    }
    try {
      renderer.setRenderTarget(debugRT);
      debugQuad.render(renderer);
    } finally {
      renderer.setRenderTarget(null);
    }
    const gpu = backendGet(debugRT.texture);
    if (gpu) blitToOverlay(gpu);
  }
  viewSel.addEventListener('change', () => {
    if (viewSel.value === 'result') invalidateDenoise(); // fresh denoise re-blits the overlay
  });

  async function runDenoise(sampleCount: number) {
    const colorTex = getTracerTexture();
    if (!colorTex || colorTex.width !== RES) return; // tracer target not ready
    let albedo: GPUTexture | undefined;
    let normal: GPUTexture | undefined;
    if (auxCheckbox.checked) {
      if (!gbufferRendered) renderGBuffer();
      albedo = backendGet(albedoRT.texture);
      normal = backendGet(normalRT.texture);
      if (!albedo || !normal) throw new Error('aux: G-buffer textures unavailable');
    }
    const t = performance.now();
    // Linear-HDR tracer input and raster aux, both top-down (no flips),
    // display-encoded (ACES+sRGB) output to match the raster preview.
    const out = await denoiser.denoiseTextures({
      color: colorTex,
      albedo, normal,
      hdr: true,
      inputFlipY: false,
      auxInputFlipY: false,
      transfer: 'aces-srgb',
    });
    if (!out) return; // aborted mid-flight — the camera moved again
    if (viewSel.value === 'result') { // an input debug view owns the overlay otherwise
      blitToOverlay(out);
      overlayCanvas.style.opacity = '1';
    }
    denoiseMs = performance.now() - t;
    denoisedAtSample = sampleCount;
    picker.denoised(denoiseMs);
  }

  // 6) The mode loop: camera moving → raster preview; at rest → accumulate
  // samples, then denoise (each sample when "progressive", else once at the end).
  type Mode = 'preview' | 'trace';
  let mode: Mode = 'preview';
  let cameraDirty = false; // only reset the tracer when the camera actually moved
  const timer = new THREE.Timer(); // THREE.Clock is deprecated since r186

  (window as unknown as Record<string, unknown>).__app =
    { pathTracer, renderer, denoiser, scene, camera, controls, albedoRT, normalRT, backendGet, renderGBuffer, samples, picker };

  // Gallery-asset capture (Phase B B1.3): spp ladder + reference + albedo/normal
  // AOVs for the gallery demo (tools/capture-gallery, or ?capture=1 headed button).
  installGalleryCapture({
    THREE, tsl: { mrt, diffuseColor, normalView, texture: textureNode, vec4 },
    renderer, device, pathTracer, scene, camera,
    getTracerTexture, backendGet, res: RES,
    sceneId: 'eiffel', title: 'LDraw Eiffel Tower',
    log,
  });

  let loggedLoopError = false;
  const loop = () => {
    requestAnimationFrame(loop);
    if ((window as unknown as Record<string, unknown>).__capturing) return;
    try {
      loopBody();
    } catch (e) {
      if (!loggedLoopError) { loggedLoopError = true; log('LOOP ERROR: ' + ((e as Error).stack ?? e)); }
    }
  };
  const loopBody = () => {
    timer.update();
    const updated = controls.update(timer.getDelta());
    const moving = updated || userActive;

    if (moving) {
      if (mode !== 'preview') {
        mode = 'preview';
        invalidateDenoise();
      }
      cameraDirty = true;
      gbufferRendered = false;
      renderer.render(scene, camera);
    } else {
      if (mode !== 'trace') {
        mode = 'trace';
        if (cameraDirty) {
          pathTracer.updateCamera(); // resets accumulation for the settled view
          samples.reset();
          cameraDirty = false;
        }
      }
      // accumulates (until pathTracer.maxSamples) and presents the raw image
      pathTracer.renderSample();
      samples.poll();
      const s = samples.value;
      const shouldDenoise = progressiveCheckbox.checked
        ? s > 0 && s !== denoisedAtSample
        : s >= maxSamples() && denoisedAtSample !== s;
      if (shouldDenoise && !denoiseBusy) {
        denoiseBusy = true;
        runDenoise(s)
          .catch((e) => log('denoise ERROR: ' + ((e as Error).stack ?? (e as Error).message)))
          .finally(() => { denoiseBusy = false; });
      }
    }

    // Input debug view: refresh every frame (tracks orbit + new samples).
    if (viewSel.value !== 'result') {
      renderDebugView(viewSel.value);
      overlayCanvas.style.opacity = '1';
    }

    const s = samples.value;
    modeLabel.textContent = viewSel.value !== 'result'
      ? `input: ${viewSel.value}`
      : mode === 'preview'
        ? 'raster preview'
        : s < maxSamples()
          ? `path tracing ${s}/${maxSamples()}`
          : denoisedAtSample >= 0 ? 'denoised' : 'denoising…';
    status.textContent = status.textContent!.replace(/\n?samples:.*$/m, '').trimEnd() +
      `\nsamples: ${s} / ${maxSamples()} | runtime: ${picker.label()}` +
      (denoiseMs ? ` | denoise: ${denoiseMs.toFixed(1)} ms` : '');
  };
  loop();

  // rAF suspends while the page is hidden — say so instead of looking wedged.
  document.addEventListener('visibilitychange', () => {
    log(document.hidden ? 'PAUSED — page hidden (rAF suspended)' : 'resumed');
  });
}

demoFooter('ldraw-eiffel');
pathtracerNote();
main().catch((e) => log('ERROR: ' + (e as Error).message));
