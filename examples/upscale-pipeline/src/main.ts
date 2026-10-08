// Phase B2 demo #8 — the "three packages, one GPUDevice" pipeline.
//
//   three.js (render @ low res) → denoiser (clean) → @pmndrs/upscaler (FSR3 / FSR1) → canvas
//
// All three libraries share ONE GPUDevice (createStack(): ORT creates it and three borrows it;
// wgsl/webnn/kernels adopt the renderer's — pick with ?runtime=auto|ort|wgsl|webnn|kernels (default auto)).
// Every stage hands a GPUTexture straight to the next — no CPU readback in the
// chain. The denoiser writes its result into a three StorageTexture; the upscaler
// consumes that three texture directly (it resolves the backing GPUTexture via the
// same handle `getGPUTexture()` from denoiser/three returns), and its
// output is another three texture we present with a fullscreen quad.
//
// Two upscaling paths, switchable live (on-page toggle, or ?upscale=temporal|spatial|off):
//
// * Temporal (FSR2/3-style, the default). Accumulates a jittered history at display
//   resolution, reprojected with depth + motion vectors, then RCAS-sharpens it.
// * Spatial (FSR1: EASU + RCAS). Stateless, one frame in → one frame out.
//
// Why temporal works here, and why JITTER IS ON
// ---------------------------------------------
// Temporal upscaling only *reconstructs* detail beyond render resolution if every
// frame's input is rendered under that frame's sub-pixel-jittered projection: the
// upscaler scatters each input texel into history at `texel + jitter`. If the input
// were rendered once and reused (a path tracer progressively accumulating samples
// across frames, or a denoise that only runs every N frames), the image would NOT
// carry the jitter the upscaler applies, history would land on the wrong texels and
// smear — that case wants `configure({ jitter: false })` (still a temporal reproject
// + accumulate + upscale, just no sub-pixel reconstruction), or the spatial path.
//
// This demo is the other case: a raster scene re-rendered EVERY frame, with fresh
// synthetic Monte-Carlo-style noise every frame, denoised EVERY frame. So we bracket
// the scene render with `upscaler.beginFrame(camera)` / `endFrame(camera)` (jittered
// projection on, then restored), and everything downstream (noise, denoise) is a
// per-pixel/spatial pass that keeps the jittered sample positions where they are.
// Motion vectors come from three's `velocity` node rendered as a second MRT output,
// fed the upscaler's *unjittered* projection so they stay jitter-free; depth is the
// scene render's depth texture. → jitter ON (the library default).
//
// Colour domain per path (each in the domain its FidelityFX design expects):
// * temporal: linear HDR in (denoiser transfer 'linear'), linear HDR out — FSR2/3 sit
//   before tonemapping; the upscaler conditions its accumulation with an invertible
//   tonemap + auto-exposure. We apply ACES + sRGB when presenting.
// * spatial: display-encoded in (denoiser transfer 'aces-srgb'), as FSR1's EASU wants
//   perceptual-space input; presented as-is.
// Both use the same ACES (Narkowicz) + sRGB curve, so the two paths match in colour.
import * as THREE from 'three/webgpu';
import {
  Fn, texture, uv, vec3, vec4, float, uniform, hash, mix, step, screenCoordinate, mrt, output, velocity,
} from 'three/tsl';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Upscaler } from '@pmndrs/upscaler';
import { ensureWebGPU, demoFooter } from '../../_shared/chrome';
import { createStack, gpuTex } from '../../_shared/stack';

// ---- resolution --------------------------------------------------------------
const RW = 640, RH = 360;   // render (denoise) resolution
const DW = 1280, DH = 720;  // display (canvas) resolution — 2.0× upscale

type UpscaleMode = 'temporal' | 'spatial' | 'off';
const MODES: UpscaleMode[] = ['temporal', 'spatial', 'off'];
const MODE_LABEL: Record<UpscaleMode, string> = {
  temporal: 'FSR3 temporal', spatial: 'FSR1 spatial', off: 'no upscale (nearest)',
};
const urlMode = new URLSearchParams(location.search).get('upscale') as UpscaleMode | null;
const INITIAL_MODE: UpscaleMode = urlMode && MODES.includes(urlMode) ? urlMode : 'temporal';

const statusEl = document.querySelector<HTMLParagraphElement>('#status')!;
const log = (m: string, err = false) => {
  statusEl.textContent = m; statusEl.classList.toggle('err', err); console.log(m);
};

function buildScene(renderer: THREE.WebGPURenderer) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0e14);

  // Image-based lighting so metals actually reflect something (RoomEnvironment
  // ships with three — no extra dependency). Falls back to lights only if PMREM
  // fails in a stripped headless GPU.
  try {
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  } catch (e) {
    log(`environment fallback (${(e as Error).message})`);
  }
  scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x20303a, 0.6));
  const key = new THREE.DirectionalLight(0xfff2e0, 3.0);
  key.position.set(4, 6, 3);
  scene.add(key);
  const warm = new THREE.PointLight(0xffaa55, 40, 30);
  warm.position.set(-3, 2, 2);
  scene.add(warm);
  const cool = new THREE.PointLight(0x55aaff, 30, 30);
  cool.position.set(3, 1.5, -2);
  scene.add(cool);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 40),
    new THREE.MeshStandardNodeMaterial({ color: 0x2a2f3a, roughness: 0.55, metalness: 0.1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.9;
  scene.add(ground);

  // A thin-featured torus knot is aliasing-hostile — good for showing FSR edge
  // quality — plus a few varied-material spheres for specular highlights (HDR
  // values >1 that the denoiser's hdr model + ACES tonemap actually exercise).
  const knot = new THREE.Mesh(
    new THREE.TorusKnotGeometry(0.75, 0.24, 220, 32),
    new THREE.MeshStandardNodeMaterial({ color: 0xe0554f, roughness: 0.15, metalness: 0.9 }),
  );
  knot.position.y = 0.35;
  scene.add(knot);

  const specs = [
    { c: 0x38a169, r: 0.15, m: 0.0, x: -1.9, s: 0.6 },
    { c: 0xd6b24a, r: 0.1, m: 1.0, x: 1.9, s: 0.7 },
    { c: 0x8a6cff, r: 0.4, m: 0.2, x: 0.1, s: 0.45, z: 1.7 },
  ];
  for (const sp of specs) {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(sp.s, 48, 48),
      new THREE.MeshStandardNodeMaterial({ color: sp.c, roughness: sp.r, metalness: sp.m }),
    );
    m.position.set(sp.x, sp.s - 0.9, sp.z ?? 0);
    scene.add(m);
  }

  const camera = new THREE.PerspectiveCamera(50, DW / DH, 0.1, 100);
  camera.position.set(0, 1.2, 4.2);
  camera.lookAt(0, 0.2, 0);
  return { scene, camera, knot };
}

async function main() {
  if (!(await ensureWebGPU())) return;
  // 1+2) One GPUDevice for the denoiser, three.js and the upscaler. Color-only HDR path
  //    (no aux) keeps the demo dependency-light and robust; the pipeline story is the
  //    three-package chain + per-stage cost, not aux.
  const canvas = document.querySelector<HTMLCanvasElement>('#view')!;
  const { renderer, denoiser, device } = await createStack({
    quality: 'balanced',
    renderer: { canvas, antialias: false },
  });
  log(`denoiser ready (${denoiser.runtime.name}) — GPUDevice shared; three.js + upscaler use it too`);
  device.lost.then((info) => log(`DEVICE LOST: ${info.reason} — ${info.message}`, true));
  renderer.setSize(DW, DH, false);
  // The denoiser / our present quad own all colour management (ACES tonemap + sRGB);
  // every quad we draw uses `fragmentNode` (a raw write, no material transforms), so
  // keep the renderer's own output transform identity.
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  const backendGet = (t: THREE.Texture): GPUTexture | undefined => gpuTex(renderer, t);

  const { scene, camera, knot } = buildScene(renderer);
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 0.2, 0);
  controls.update();

  // 3) @pmndrs/upscaler on the SAME device (it grabs renderer.backend.device).
  const upscaler = new Upscaler({ renderer });
  // Explicit render size: our input is produced by an external pass (denoiser)
  // whose resolution we control, so pin render + display exactly. Jitter stays at
  // its default (on) — see the header comment for why that is correct here.
  const configureUpscaler = (path: 'temporal' | 'spatial') =>
    upscaler.configure({ displayWidth: DW, displayHeight: DH, renderWidth: RW, renderHeight: RH, path });
  configureUpscaler(INITIAL_MODE === 'spatial' ? 'spatial' : 'temporal');
  await upscaler.init();
  // The input is denoised but can carry faint residual grain; RCAS's denoise
  // variant stops the sharpener amplifying lone luma outliers (its docs call out
  // exactly this "pairs with a spatial denoiser upstream" case). Applies to both paths.
  upscaler.settings.rcasDenoise = true;
  // Motion vectors must be jitter-free: the velocity node projects with the
  // upscaler's unjittered projection (a stable Matrix4, refreshed in beginFrame).
  velocity.setProjectionMatrix(upscaler.unjitteredProjectionMatrix);

  // ---- render targets --------------------------------------------------------
  // Spatial / off: colour-only scene render.
  const cleanRT = new THREE.RenderTarget(RW, RH, { type: THREE.HalfFloatType });
  // Temporal: colour + velocity MRT with a sampleable depth texture. The attachment
  // count must match the MRT output count (a 2-attachment target drawn without the
  // velocity output renders black), so it is a separate target from cleanRT.
  const depthTex = new THREE.DepthTexture(RW, RH);
  depthTex.type = THREE.FloatType;
  const mrtRT = new THREE.RenderTarget(RW, RH, { type: THREE.HalfFloatType, count: 2, depthTexture: depthTex });
  mrtRT.textures[0].name = 'output';   // MRT routes outputs to attachments by name
  mrtRT.textures[1].name = 'velocity';
  const sceneMRT = mrt({ output, velocity });
  // linear HDR noisy → (denoise) result, or (denoise off) display-encoded noisy.
  const noisyRT = new THREE.RenderTarget(RW, RH, { type: THREE.HalfFloatType, depthBuffer: false });
  const displayRT = new THREE.RenderTarget(RW, RH, { type: THREE.HalfFloatType, depthBuffer: false });
  // Denoiser output target (caller-owned, STORAGE_BINDING, rgba16float). Holds the
  // linear HDR result on the temporal path, the ACES+sRGB display-encoded one otherwise.
  const denoisedTex = new THREE.StorageTexture(RW, RH);
  denoisedTex.type = THREE.HalfFloatType;
  denoisedTex.colorSpace = THREE.NoColorSpace;
  denoisedTex.generateMipmaps = false;
  // Present render-res sources with nearest filtering so "upscale off" is an honest
  // blocky nearest-neighbour comparison against FSR (the upscaler uses its own
  // internal sampler, so this never affects the FSR paths).
  for (const t of [denoisedTex, displayRT.texture, noisyRT.texture]) {
    t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter;
  }
  renderer.initTexture(denoisedTex);
  const denoisedGpuTex = backendGet(denoisedTex)!;

  // ---- TSL passes ------------------------------------------------------------
  const uSpp = uniform(6);
  const uFrame = uniform(0);
  const cleanTexNode = texture(cleanRT.texture); // re-pointed at mrtRT's colour on the temporal path
  // Synthetic path-tracer-style noise: relative (luminance-scaled) grain whose
  // amplitude falls as 1/√spp — the same "more samples → less noise" curve real
  // Monte-Carlo rendering follows, giving the denoiser genuine work. A fresh seed
  // each frame, like a real 1-frame-of-samples render.
  const noiseFrag = Fn(() => {
    const base = cleanTexNode.sample(uv());
    const px = screenCoordinate;
    const cell = px.x.floor().add(px.y.floor().mul(RW)).add(uFrame.mul(RW * RH + 1));
    const sigma = float(0.55).div(uSpp.max(1).sqrt());
    const n = vec3(hash(cell.add(0.5)), hash(cell.add(1.5)), hash(cell.add(2.5))).mul(2).sub(1);
    return vec4(base.rgb.mul(sigma.mul(n).add(1)).max(0), 1);
  });
  // ACES (Narkowicz) tonemap + sRGB encode — matches the denoiser's 'aces-srgb'
  // transfer, so every path/toggle combination is colour-consistent.
  // (A plain inlining helper rather than a TSL Fn, so it accepts any vec3 node.)
  const acesSrgb = (lin: THREE.Node<'vec3'>) => {
    const v = lin.max(0);
    const tm = v.mul(v.mul(2.51).add(0.03)).div(v.mul(v.mul(2.43).add(0.59)).add(0.14)).clamp(0, 1);
    const lo = tm.mul(12.92);
    const hi = tm.pow(1 / 2.4).mul(1.055).sub(0.055);
    return lo.add(hi.sub(lo).mul(step(0.0031308, tm))); // per-channel mix(lo, hi, step)
  };
  const displayFrag = Fn(() => vec4(acesSrgb(texture(noisyRT.texture, uv()).rgb), 1));

  const noiseQuad = new THREE.QuadMesh(Object.assign(new THREE.NodeMaterial(), { fragmentNode: noiseFrag() }));
  const displayQuad = new THREE.QuadMesh(Object.assign(new THREE.NodeMaterial(), { fragmentNode: displayFrag() }));
  // Present quad: source texture swapped per frame; `tonemap` = 1 applies ACES+sRGB
  // (linear temporal chain), 0 writes the already display-encoded texels raw.
  const makePresent = () => {
    const tex = texture(denoisedTex);
    const tonemap = uniform(0);
    const frag = Fn(() => {
      const c = tex.sample(uv());
      return vec4(mix(c.rgb, acesSrgb(c.rgb), tonemap), 1);
    });
    const quad = new THREE.QuadMesh(Object.assign(new THREE.NodeMaterial(), { fragmentNode: frag() }));
    return { tex, tonemap, quad };
  };
  const present = makePresent();

  // ---- controls --------------------------------------------------------------
  let denoiseOn = true;
  let mode: UpscaleMode = INITIAL_MODE;
  let pendingMode: UpscaleMode | null = null; // applied at the top of the next frame
  const wireSeg = (id: string, onPick: (v: string) => void) => {
    const seg = document.querySelector<HTMLDivElement>(id)!;
    const buttons = seg.querySelectorAll<HTMLButtonElement>('button');
    const mark = (v: string) => buttons.forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.v === v)));
    buttons.forEach((b) => b.addEventListener('click', () => { mark(b.dataset.v!); onPick(b.dataset.v!); }));
    return mark;
  };
  wireSeg('#denoise-seg', (v) => (denoiseOn = v === 'on'));
  const markUpscale = wireSeg('#upscale-seg', (v) => { pendingMode = v as UpscaleMode; });
  markUpscale(mode);
  const sppEl = document.querySelector<HTMLInputElement>('#spp')!;
  sppEl.addEventListener('input', () => {
    uSpp.value = parseInt(sppEl.value, 10);
    document.querySelector('#spp-val')!.textContent = sppEl.value;
  });
  const sharpEl = document.querySelector<HTMLInputElement>('#sharp')!;
  sharpEl.addEventListener('input', () => {
    upscaler.settings.sharpness = parseFloat(sharpEl.value);
    document.querySelector('#sharp-val')!.textContent = parseFloat(sharpEl.value).toFixed(2);
  });
  upscaler.settings.sharpness = parseFloat(sharpEl.value);

  const reslineEl = document.querySelector('#resline')!;
  const paintResline = () => {
    reslineEl.innerHTML = mode === 'off'
      ? `render <b>${RW}×${RH}</b> → display <b>${DW}×${DH}</b> · no upscaler (nearest-neighbour blocks)`
      : `render <b>${RW}×${RH}</b> → display <b>${DW}×${DH}</b> · ${MODE_LABEL[mode]}` +
        (mode === 'temporal' ? ` (jittered, ${upscaler.jitterPhaseCount}-phase sequence)` : '') +
        ` · <b>${(DW / RW).toFixed(1)}×</b> upscale`;
  };

  // ---- per-stage cost UI -----------------------------------------------------
  const bars = {
    render: document.querySelector<HTMLElement>('#bar-render')!,
    denoise: document.querySelector<HTMLElement>('#bar-denoise')!,
    upscale: document.querySelector<HTMLElement>('#bar-upscale')!,
  };
  const msEls = {
    render: document.querySelector<HTMLElement>('#ms-render')!,
    denoise: document.querySelector<HTMLElement>('#ms-denoise')!,
    upscale: document.querySelector<HTMLElement>('#ms-upscale')!,
  };
  const upscaleTagEl = document.querySelector<HTMLElement>('#tag-upscale')!;
  const totalEl = document.querySelector<HTMLElement>('#ms-total')!;
  const fpsEl = document.querySelector<HTMLElement>('#fps')!;
  const sm = { render: 0, denoise: 0, upscale: 0 };
  function paint(r: number, d: number, u: number) {
    sm.render = sm.render ? sm.render * 0.85 + r * 0.15 : r;
    sm.denoise = sm.denoise ? sm.denoise * 0.85 + d * 0.15 : d;
    sm.upscale = sm.upscale ? sm.upscale * 0.85 + u * 0.15 : u;
    const total = sm.render + sm.denoise + sm.upscale;
    const scale = Math.max(total, 1);
    bars.render.style.width = `${(sm.render / scale) * 100}%`;
    bars.denoise.style.width = `${(sm.denoise / scale) * 100}%`;
    bars.upscale.style.width = `${(sm.upscale / scale) * 100}%`;
    msEls.render.textContent = `${sm.render.toFixed(1)} ms`;
    msEls.denoise.textContent = denoiseOn ? `${sm.denoise.toFixed(1)} ms` : 'off';
    msEls.upscale.textContent = mode !== 'off' ? `${sm.upscale.toFixed(1)} ms` : 'off';
    upscaleTagEl.textContent = mode === 'temporal' ? 'FSR3' : mode === 'spatial' ? 'FSR1' : 'upscale';
    totalEl.textContent = `${total.toFixed(1)} ms`;
    fpsEl.textContent = `${(1000 / Math.max(total, 0.001)).toFixed(0)} fps`;
  }
  paintResline();

  // Path switch, applied between frames (never mid-frame: beginFrame has jittered the
  // camera and the dispatch hasn't run yet). configure() reallocates the working set
  // and drops history; prepare() compiles the new path's pipelines (cached after the
  // first switch). Going to "off" leaves the upscaler idle; coming back reconfigures,
  // so temporal never resumes from a stale history. The render stage differs per
  // path too (temporal adds the velocity MRT target), so all smoothed costs restart.
  async function applyMode(next: UpscaleMode) {
    if (next !== 'off') {
      configureUpscaler(next);
      await upscaler.prepare();
    }
    mode = next;
    sm.render = sm.denoise = sm.upscale = 0;
    paintResline();
  }

  // ---- the pipeline ----------------------------------------------------------
  // Each stage submits its GPU work then awaits completion, so the reported ms are
  // real per-stage GPU times, not just CPU encode time — the cost breakdown IS the
  // story here.
  let frame = 0;
  let inFlight = false;
  let lastT = performance.now();
  let lastPresent: { tex: THREE.Texture; linear: boolean } | null = null;
  async function step_() {
    if (inFlight) return;
    inFlight = true;
    try {
      if (pendingMode) { const m = pendingMode; pendingMode = null; await applyMode(m); }
      uFrame.value = frame++ % 64;
      const now = performance.now();
      const deltaTime = Math.min((now - lastT) / 1000, 0.1);
      lastT = now;
      const temporal = mode === 'temporal';

      // Stage 1 — render clean scene, then add noise (both linear HDR). On the temporal
      // path the scene render runs under this frame's jittered projection and also
      // writes jitter-free velocity + depth for reprojection.
      const t0 = performance.now();
      if (temporal) {
        upscaler.beginFrame(camera);
        renderer.setMRT(sceneMRT);
        renderer.setRenderTarget(mrtRT);
        renderer.render(scene, camera);
        renderer.setMRT(null);
        upscaler.endFrame(camera);
        cleanTexNode.value = mrtRT.textures[0];
      } else {
        renderer.setRenderTarget(cleanRT);
        renderer.render(scene, camera);
        cleanTexNode.value = cleanRT.texture;
      }
      renderer.setRenderTarget(noisyRT);
      noiseQuad.render(renderer);
      renderer.setRenderTarget(null);
      await device.queue.onSubmittedWorkDone();
      const renderMs = performance.now() - t0;

      // Stage 2 — denoise, or pass the noisy frame through. Temporal consumes linear
      // HDR; spatial / off consume the display-encoded image.
      let src: THREE.Texture;
      let srcLinear: boolean;
      let denoiseMs = 0;
      if (denoiseOn) {
        const t1 = performance.now();
        await denoiser.denoiseTextures({
          color: backendGet(noisyRT.texture)!,
          output: denoisedGpuTex,
          hdr: true,
          inputFlipY: FLIP_INPUT,
          transfer: temporal ? 'linear' : 'aces-srgb',
        });
        denoiseMs = performance.now() - t1;
        src = denoisedTex;
        srcLinear = temporal;
      } else if (temporal) {
        src = noisyRT.texture;
        srcLinear = true;
      } else {
        renderer.setRenderTarget(displayRT);
        displayQuad.render(renderer);
        renderer.setRenderTarget(null);
        await device.queue.onSubmittedWorkDone();
        src = displayRT.texture;
        srcLinear = false;
      }

      // Stage 3 — upscale to display res (or present render-res nearest).
      let upscaleMs = 0;
      let presentTex: THREE.Texture;
      if (mode !== 'off') {
        const t2 = performance.now();
        upscaler.dispatch(
          temporal
            ? { color: src, depth: mrtRT.depthTexture!, velocity: mrtRT.textures[1], deltaTime }
            : { color: src },
          camera,
        );
        await device.queue.onSubmittedWorkDone();
        upscaleMs = performance.now() - t2;
        presentTex = upscaler.outputTexture; // same colour domain as its input
      } else {
        presentTex = src;
      }

      // Present.
      present.tex.value = presentTex;
      present.tonemap.value = srcLinear ? 1 : 0;
      present.quad.render(renderer);
      lastPresent = { tex: presentTex, linear: srcLinear };

      paint(renderMs, denoiseMs, upscaleMs);
    } catch (e) {
      log('pipeline ERROR: ' + (e as Error).message, true);
      throw e;
    } finally {
      inFlight = false;
    }
  }

  // gentle idle spin so reflections/thin features move (shows FSR under motion)
  let spinning = true;
  let paused = false; // the verification hooks pause the rAF loop to drive frames themselves
  controls.addEventListener('start', () => (spinning = false));
  function loop() {
    if (paused) { requestAnimationFrame(loop); return; }
    if (spinning) knot.rotation.y += 0.004;
    controls.update();
    step_().then(() => requestAnimationFrame(loop)).catch(() => {});
  }
  // Prime the backend textures once (so backend.get resolves) then start.
  renderer.setRenderTarget(cleanRT); renderer.render(scene, camera); renderer.setRenderTarget(null);
  log('pipeline ready — three.js → denoiser → @pmndrs/upscaler, one shared GPUDevice');
  loop();

  // ---- headless verification hooks ------------------------------------------
  const probe = makePresent();
  const probeRTs = new Map<string, THREE.RenderTarget>(); // rgba8, sized per readback
  async function readRGBA8(tex: THREE.Texture, w: number, h: number, linear = false): Promise<Uint8ClampedArray> {
    const key = `${w}x${h}`;
    let rt = probeRTs.get(key);
    if (!rt) { rt = new THREE.RenderTarget(w, h); probeRTs.set(key, rt); }
    probe.tex.value = tex;
    probe.tonemap.value = linear ? 1 : 0;
    renderer.setRenderTarget(rt);
    probe.quad.render(renderer);
    renderer.setRenderTarget(null);
    const px = (await renderer.readRenderTargetPixelsAsync(rt, 0, 0, w, h)) as Uint8Array;
    return new Uint8ClampedArray(px.buffer, px.byteOffset, w * h * 4);
  }
  const luma = (a: ArrayLike<number>, i: number) => 0.299 * a[i] + 0.587 * a[i + 1] + 0.114 * a[i + 2];
  // Mean 3×3 local luma variance over rows [y0,y1). Whole-frame = mixes real detail
  // with noise; a flat background strip isolates pure-noise cleaning.
  function localVar(px: ArrayLike<number>, w: number, y0: number, y1: number): number {
    let acc = 0, n = 0;
    for (let y = Math.max(1, y0); y < y1 - 1; y++)
      for (let x = 1; x < w - 1; x++) {
        let s = 0, s2 = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const l = luma(px, ((y + dy) * w + (x + dx)) * 4); s += l; s2 += l * l;
        }
        const m = s / 9; acc += s2 / 9 - m * m; n++;
      }
    return acc / n;
  }
  // Mean |Δluma| across even 2×2-block column pairs (2i, 2i+1). A nearest 2× upscale
  // duplicates columns exactly, so within-block pairs are identical → ≈0. FSR
  // reconstructs distinct sub-pixel values → >0.
  function withinBlockDiff(px: ArrayLike<number>, w: number, h: number): number {
    let acc = 0, n = 0;
    for (let y = 0; y < h; y++)
      for (let x = 0; x + 1 < w; x += 2) {
        const i = (y * w + x) * 4;
        acc += Math.abs(luma(px, i) - luma(px, i + 4)); n++;
      }
    return acc / n;
  }
  function nonBlack(px: ArrayLike<number>, w: number, h: number): number {
    let nb = 0; const n = w * h;
    for (let i = 0; i < n; i++) if (luma(px, i * 4) > 6) nb++;
    return nb / n;
  }
  // Mean |Δluma| (0–255) between two frames, plus the share of pixels that moved >4.
  function frameDiff(a: ArrayLike<number>, b: ArrayLike<number>, w: number, h: number) {
    let acc = 0, big = 0; const n = w * h;
    for (let i = 0; i < n; i++) {
      const d = Math.abs(luma(a, i * 4) - luma(b, i * 4)); acc += d; if (d > 4) big++;
    }
    return { mean: acc / n, over4: big / n };
  }
  const readOutput = () => readRGBA8(lastPresent!.tex, DW, DH, lastPresent!.linear);
  const drain = async () => {
    paused = true;
    for (let k = 0; k < 200 && inFlight; k++) await new Promise((r) => setTimeout(r, 25));
  };
  const setModeNow = async (m: UpscaleMode) => { markUpscale(m); pendingMode = m; await step_(); };
  const avg = (xs: number[]) => +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(4);
  // Encode an RGBA8 readback as a PNG data URL (optionally a nearest-zoomed crop).
  function toPng(px: Uint8ClampedArray, w: number, h: number, crop?: { x: number; y: number; w: number; h: number; zoom: number }) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(px), w, h), 0, 0);
    if (!crop) return c.toDataURL('image/png');
    const z = document.createElement('canvas'); z.width = crop.w * crop.zoom; z.height = crop.h * crop.zoom;
    const g = z.getContext('2d')!; g.imageSmoothingEnabled = false;
    g.drawImage(c, crop.x, crop.y, crop.w, crop.h, 0, 0, z.width, z.height);
    return z.toDataURL('image/png');
  }

  (window as unknown as Record<string, unknown>).__pipeline = {
    async measure() {
      // Pause the rAF loop and wait for any in-flight frame to drain, so our own
      // step_() calls actually execute (the inFlight guard would skip them otherwise).
      await drain();
      const prevMode = mode;
      // settle a few frames per config (first denoise also compiles the ORT graph)
      const settle = async (n = 4) => { for (let k = 0; k < n; k++) { await step_(); } };
      const BG = Math.floor(RH * 0.16); // top strip = flat background (no scene detail)

      // denoise ON, spatial. Read the SAME denoised source three ways so every
      // comparison is like-for-like (no confounding of denoise with upscale).
      denoiseOn = true; await setModeNow('spatial'); await settle();
      const fsr = await readRGBA8(upscaler.outputTexture, DW, DH);   // FSR1 of denoised
      const nearestDenoised = await readRGBA8(denoisedTex, DW, DH);  // nearest 2× of the SAME denoised source
      const denoisedRR = await readRGBA8(denoisedTex, RW, RH);       // denoised render-res

      // denoise OFF at the same spp → the noisy render-res frame, for the noise delta.
      denoiseOn = false; await setModeNow('off'); await settle();
      const noisyRR = await readRGBA8(displayRT.texture, RW, RH);

      // temporal, denoise on: output sanity + the same detail metric.
      denoiseOn = true; await setModeNow('temporal'); await settle(32);
      const fsr3 = await readOutput();

      // restore
      denoiseOn = true; await setModeNow(prevMode); paused = false;
      const out = {
        render: { w: RW, h: RH, nonBlack: +nonBlack(denoisedRR, RW, RH).toFixed(3) },
        denoise: {
          noisyVarWhole: +localVar(noisyRR, RW, 0, RH).toFixed(1),
          denoisedVarWhole: +localVar(denoisedRR, RW, 0, RH).toFixed(1),
          noisyVarBg: +localVar(noisyRR, RW, 0, BG).toFixed(1),
          denoisedVarBg: +localVar(denoisedRR, RW, 0, BG).toFixed(1),
        },
        upscale: {
          outW: DW, outH: DH,
          fsrNonBlack: +nonBlack(fsr, DW, DH).toFixed(3),
          fsr3NonBlack: +nonBlack(fsr3, DW, DH).toFixed(3),
          // same denoised source: nearest replicates 2×2 blocks (≈0), FSR resolves detail (>0)
          fsrWithinBlockDiff: +withinBlockDiff(fsr, DW, DH).toFixed(3),
          fsr3WithinBlockDiff: +withinBlockDiff(fsr3, DW, DH).toFixed(3),
          nearestWithinBlockDiff: +withinBlockDiff(nearestDenoised, DW, DH).toFixed(3),
        },
        timings: { render: +sm.render.toFixed(1), denoise: +sm.denoise.toFixed(1), upscale: +sm.upscale.toFixed(1) },
      };
      (window as unknown as Record<string, unknown>).__measurement = out;
      log(`measured: bg noise var ${out.denoise.noisyVarBg}→${out.denoise.denoisedVarBg}, ` +
        `detail FSR1 ${out.upscale.fsrWithinBlockDiff} / FSR3 ${out.upscale.fsr3WithinBlockDiff} vs nearest ${out.upscale.nearestWithinBlockDiff}`);
      return out;
    },

    // Still-camera stability: frame-to-frame output change right after a path switch
    // (history reset) and after `settleFrames`, per path. Spin is frozen; noise is
    // re-seeded every frame as in normal operation, so the residual is what a viewer
    // sees as shimmer/boil on a static shot.
    async stability(opts: { modes?: UpscaleMode[]; settleFrames?: number; sampleFrames?: number; denoise?: boolean } = {}) {
      const { modes = ['spatial', 'temporal'], settleFrames = 90, sampleFrames = 8, denoise = true } = opts;
      await drain();
      const prevMode = mode, prevSpin = spinning, prevDenoise = denoiseOn;
      spinning = false; denoiseOn = denoise;
      const res: Record<string, unknown> = {};
      for (const m of modes) {
        await setModeNow(m); // frame 1 after the reset
        const early: number[] = [];
        let prev = await readOutput();
        for (let k = 0; k < 4; k++) { await step_(); const cur = await readOutput(); early.push(frameDiff(prev, cur, DW, DH).mean); prev = cur; }
        for (let k = 0; k < settleFrames; k++) await step_();
        prev = await readOutput();
        const late: { mean: number; over4: number }[] = [];
        for (let k = 0; k < sampleFrames; k++) { await step_(); const cur = await readOutput(); late.push(frameDiff(prev, cur, DW, DH)); prev = cur; }
        res[m] = {
          earlyMeanAbsDiff: avg(early),
          settledMeanAbsDiff: avg(late.map((d) => d.mean)),
          settledFracOver4: avg(late.map((d) => d.over4)),
          nonBlack: +nonBlack(prev, DW, DH).toFixed(3),
          ms: { render: +sm.render.toFixed(2), denoise: +sm.denoise.toFixed(2), upscale: +sm.upscale.toFixed(2) },
        };
      }
      spinning = prevSpin; denoiseOn = prevDenoise; await setModeNow(prevMode); paused = false;
      return res;
    },

    // Comparison capture: render `settleFrames` in each mode, return PNGs of the
    // presented output (full frame + a 3× nearest zoom on the knot). Still by default
    // (same scene state for every mode); `motion: true` instead spins the knot and
    // orbits the camera every frame — identical motion per mode — to expose ghosting.
    async capture(opts: { modes?: UpscaleMode[]; settleFrames?: number; denoise?: boolean; motion?: boolean } = {}) {
      const { modes = ['spatial', 'temporal'], settleFrames = 90, denoise = true, motion = false } = opts;
      await drain();
      const prevMode = mode, prevSpin = spinning, prevDenoise = denoiseOn;
      spinning = false; denoiseOn = denoise;
      const knotRot = knot.rotation.y, camPos = camera.position.clone();
      const out: Record<string, { full: string; zoom: string }> = {};
      for (const m of modes) {
        knot.rotation.y = knotRot; camera.position.copy(camPos); controls.update();
        await setModeNow(m);
        for (let k = 0; k < settleFrames; k++) {
          if (motion) {
            knot.rotation.y += 0.02;
            camera.position.sub(controls.target).applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.006).add(controls.target);
            controls.update();
          }
          await step_();
        }
        const px = await readOutput();
        out[m] = { full: toPng(px, DW, DH), zoom: toPng(px, DW, DH, { x: 480, y: 170, w: 320, h: 200, zoom: 3 }) };
      }
      knot.rotation.y = knotRot; camera.position.copy(camPos); controls.update();
      spinning = prevSpin; denoiseOn = prevDenoise; await setModeNow(prevMode); paused = false;
      return out;
    },
  };
  (window as unknown as Record<string, unknown>).__ready = true;
}

// three's raster render targets read top-down for the denoiser (no vertical flip),
// same convention the pathtracer example's rasterized G-buffer uses.
const FLIP_INPUT = false;

demoFooter('upscale-pipeline');
main().catch((e) => log('ERROR: ' + (e as Error).message, true));
