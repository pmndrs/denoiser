// three-temporal: denoiser/three's temporal TSL nodes in a moving-camera scene.
//
//   scene pass (MRT: color, albedo+metalness, packed view normal+roughness, velocity)
//     |- stochastic area-light shadow: ONE random point on a square light per pixel
//     |    per frame, ONE analytic ray against 5 sphere occluders -> binary
//     |    visibility (honest 1 spp)                     --> ffxShadows(...)
//     |- stochastic glossy SSR (three's ssr(), stochastic GGX, 1 ray/pixel)
//     |                                                  --> ffxReflections(...)
//     '- composite = ambient/IBL + albedo*E*visibility + reflections
//          [-> optional: render at 1/2 res, FSR3 upscale (@pmndrs/upscaler)]
//
// Everything runs on the renderer's own GPUDevice: the FFX denoisers read the
// scene pass's GPU textures directly and their output is copied GPU->GPU.
import * as THREE from 'three/webgpu';
import {
  float, vec2, vec3, vec4, uniform, select, mix, hash, screenCoordinate, pass, mrt, output,
  diffuseColor, normalView, materialMetalness, materialRoughness, packNormalToRGB, unpackRGBToNormal,
  velocity, sample, getViewPosition, convertToTexture, renderOutput, uv,
} from 'three/tsl';
import { ssr } from 'three/addons/tsl/display/SSRNode.js';
import { upscale } from '@pmndrs/upscaler';
import { ffxReflections, ffxShadows, getGPUTexture } from 'denoiser/three';
import type { TemporalDenoiseNode } from 'denoiser/three';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any; // TSL's node typings are too strict for hand-written shader maths
const W = 960, H = 540;
const RATIO = 2; // FSR3 upscale ratio when enabled
const q = new URLSearchParams(location.search);
const manual = q.has('manual'); // headless: the page is stepped by window.__t.step()

const statusEl = document.querySelector<HTMLPreElement>('#status')!;
const log = (m: string) => { statusEl.textContent = m; console.log('[three-temporal]', m); };

// ---- scene ------------------------------------------------------------------

function makeEnvironment(): THREE.DataTexture {
  const w = 256, h = 128;
  const data = new Float32Array(w * h * 4);
  const sun = new THREE.Vector3(0.4, 0.5, -0.2).normalize();
  const dir = new THREE.Vector3();
  for (let y = 0; y < h; y++) {
    const phi = (y / (h - 1)) * Math.PI;
    for (let x = 0; x < w; x++) {
      const theta = (x / (w - 1)) * Math.PI * 2;
      dir.set(Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta));
      const t = Math.max(0, dir.y);
      let r = 0.10 + 0.30 * t, g = 0.15 + 0.38 * t, b = 0.28 + 0.5 * t;
      if (dir.y < 0) { const k = Math.min(1, -dir.y * 2); r = r * (1 - k) + 0.05 * k; g = g * (1 - k) + 0.045 * k; b = b * (1 - k) + 0.045 * k; }
      const d = dir.dot(sun);
      const s = Math.pow(Math.max(0, d), 600) * 30 + Math.pow(Math.max(0, d), 8) * 1.0;
      const i = (y * w + x) * 4;
      data[i] = r + s; data[i + 1] = g + s * 0.85; data[i + 2] = b + s * 0.6; data[i + 3] = 1;
    }
  }
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.FloatType);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.LinearSRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

// Sphere occluders: the meshes AND the analytic shadow rays use these.
interface Ball { base: THREE.Vector3; r: number; color: number; rough: number; metal: number; move?: (t: number, p: THREE.Vector3) => void }
const BALLS: Ball[] = [
  { base: new THREE.Vector3(-1.7, 0.7, 0.2), r: 0.7, color: 0xe5484d, rough: 0.35, metal: 0.9 },
  { base: new THREE.Vector3(0.1, 0.9, -0.6), r: 0.9, color: 0x4493f8, rough: 0.2, metal: 0.9 },
  { base: new THREE.Vector3(1.9, 0.55, 0.5), r: 0.55, color: 0xf5a524, rough: 0.45, metal: 0.8 },
  { base: new THREE.Vector3(-0.2, 0.4, 1.7), r: 0.4, color: 0x30a46c, rough: 0.3, metal: 0.2,
    move: (t, p) => { p.x = -0.2 + 1.3 * Math.sin(t * 0.7); p.z = 1.7 + 0.4 * Math.cos(t * 0.7); } },
  { base: new THREE.Vector3(0.4, 1.9, 0.6), r: 0.3, color: 0xd0d4dc, rough: 0.5, metal: 0.1,
    move: (t, p) => { p.y = 1.9 + 0.25 * Math.sin(t * 1.3); } },
];

function buildScene() {
  const scene = new THREE.Scene();
  const env = makeEnvironment();
  scene.environment = env;
  scene.background = env;
  scene.environmentIntensity = 0.6;
  const camera = new THREE.PerspectiveCamera(45, W / H, 0.1, 60);

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40),
    new THREE.MeshStandardMaterial({ color: 0xb8bcc4, roughness: 0.32, metalness: 0.35 }));
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(40, 12),
    new THREE.MeshStandardMaterial({ color: 0x2a3340, roughness: 0.4, metalness: 0.6 }));
  wall.position.set(0, 6, -5);
  scene.add(wall);

  const meshes = BALLS.map((b) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(b.r, 48, 32),
      new THREE.MeshStandardMaterial({ color: b.color, roughness: b.rough, metalness: b.metal }));
    m.position.copy(b.base);
    scene.add(m);
    return m;
  });
  return { scene, camera, env, meshes };
}

// ---- main ---------------------------------------------------------------------

async function main() {
  const canvas = document.querySelector<HTMLCanvasElement>('#view')!;
  canvas.width = W; canvas.height = H;
  if (!navigator.gpu) { log('WebGPU is not available in this browser.'); return; }

  const renderer = new THREE.WebGPURenderer({ canvas, antialias: false });
  await renderer.init();
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  // All tone mapping / encoding happens in the graph; keep the output transform identity.
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

  const { scene, camera, env, meshes } = buildScene();

  // light: horizontal square emitter above/right of the scene
  const LIGHT_C = new THREE.Vector3(3.2, 5.4, 2.4);
  const uLightC = uniform(LIGHT_C.clone());
  const uLightHalf = uniform(0.9);
  const uLightPower = uniform(70);
  const uFrame = uniform(0);
  const uBalls = BALLS.map((b) => uniform(new THREE.Vector4(b.base.x, b.base.y, b.base.z, b.r)));

  // ---- graph ------------------------------------------------------------------
  const uShadowMix = uniform(1); // 0 = raw 1-spp visibility, 1 = denoised
  const uReflMix = uniform(1);

  interface Graph {
    pipeline: THREE.RenderPipeline;
    shadow: TemporalDenoiseNode<never>;
    refl: TemporalDenoiseNode<never>;
    upscaled: boolean;
  }

  function buildGraph(upscaled: boolean): Graph {
    const scale = upscaled ? 1 / RATIO : 1;
    const scenePass = pass(scene, camera);
    scenePass.setResolutionScale(scale);
    scenePass.setMRT(mrt({
      output,
      diffuseColor: vec4(diffuseColor.rgb, materialMetalness),               // albedo + metalness
      normal: vec4(packNormalToRGB(normalView), materialRoughness),          // packed VIEW normal + roughness
      velocity,
    }));
    const sceneColor = scenePass.getTextureNode('output');
    const dTex = scenePass.getTextureNode('diffuseColor');
    const nTex = scenePass.getTextureNode('normal');
    const depthTex = scenePass.getTextureNode('depth');
    const velTex = scenePass.getTextureNode('velocity');

    const camWorld = uniform(new THREE.Matrix4());
    camWorld.onFrameUpdate(() => { camera.updateMatrixWorld(); camWorld.value.copy(camera.matrixWorld); });
    const projInv = uniform(camera.projectionMatrixInverse);

    // world position + world normal of the surface at a screen uv
    const surface = (uvN: N) => {
      const d = depthTex.sample(uvN).r;
      const P = camWorld.mul(vec4(getViewPosition(uvN, d, projInv), 1)).xyz;
      const N = camWorld.mul(vec4(unpackRGBToNormal(nTex.sample(uvN).rgb), 0)).xyz.normalize();
      return { d, P, N };
    };
    // incident light from the square light's CENTRE (used for shading; the
    // visibility ray samples the whole area)
    const irradiance = (P: N, N_: N) => {
      const L = uLightC.sub(P);
      const d2 = L.dot(L).max(1e-3);
      return uLightPower.mul(N_.dot(L.normalize()).max(0)).div(d2);
    };

    // ---- stochastic visibility: 1 light sample + 1 ray per pixel per frame
    const visibility = (() => {
      const uvN = uv();
      const s = surface(uvN);
      const px = screenCoordinate.xy.floor();
      const seed = px.x.add(px.y.mul(1973)).add(uFrame.mul(9277));
      const r1 = hash(seed), r2 = hash(seed.add(7919));
      const lp = uLightC.add(vec3(r1.mul(2).sub(1), 0, r2.mul(2).sub(1)).mul(uLightHalf));
      const o = s.P.add(s.N.mul(0.02));
      const toL = lp.sub(o);
      const dist = toL.length();
      const dir = toL.div(dist);
      let lit: N = float(1);
      for (const b of uBalls) {
        const oc = o.sub(b.xyz);
        const bb = oc.dot(dir);
        const disc = bb.mul(bb).sub(oc.dot(oc)).add(b.w.mul(b.w));
        const t0 = bb.negate().sub(disc.max(0).sqrt());
        const hit = disc.greaterThan(0).and(t0.greaterThan(0.001)).and(t0.lessThan(dist));
        lit = lit.mul(select(hit, float(0), float(1)));
      }
      const sky = s.d.greaterThanEqual(0.99999);
      return select(sky, float(1), lit);
    })();
    const visRTT = convertToTexture(vec4(visibility, 0, 0, 1));
    visRTT.setResolutionScale(scale);

    // ---- denoise nodes
    const shadowNode = ffxShadows(visRTT, {
      camera, depth: depthTex, velocity: velTex,
      normal: nTex, normalSpace: 'view', normalEncoding: 'packed', resolutionScale: scale,
    });

    const ssrNode = ssr(sceneColor, depthTex, sample((uvN) => unpackRGBToNormal(nTex.sample(uvN).rgb)), {
      stochastic: true,
      diffuseNode: dTex,
      metalnessNode: dTex.a,
      roughnessNode: nTex.a,
      envImportanceSampling: true,
    });
    ssrNode.setEnvMap(env);
    const reflNode = ffxReflections(ssrNode, {
      camera, depth: depthTex, velocity: velTex, roughness: nTex.a,
      normal: nTex, normalSpace: 'view', normalEncoding: 'packed', resolutionScale: scale,
    });

    // ---- composite (linear HDR) -> tone map + sRGB (display-referred)
    const composite = (() => {
      const uvN = uv();
      const s = surface(uvN);
      const albedo = dTex.sample(uvN);
      const diffuse = albedo.rgb.mul(float(1).sub(albedo.a));
      const sky = s.d.greaterThanEqual(0.99999);
      const visSel = mix(visRTT.sample(uvN).r, shadowNode.r, uShadowMix);
      const direct = diffuse.mul(irradiance(s.P, s.N)).mul(select(sky, float(0), visSel));
      const noisyRefl = ssrNode.rgb;
      const reflSel = mix(noisyRefl, reflNode.rgb, uReflMix).mul(select(ssrNode.a.greaterThan(0), float(1), float(0)));
      return vec4(sceneColor.sample(uvN).rgb.add(direct).add(reflSel), 1);
    })();
    const display = renderOutput(composite, THREE.ACESFilmicToneMapping, THREE.SRGBColorSpace);

    const pipeline = new THREE.RenderPipeline(renderer);
    pipeline.outputColorTransform = false; // the graph already tone maps + sRGB-encodes (and FSR outputs display-referred)
    if (upscaled) {
      const colorRTT = convertToTexture(composite); // FSR3 takes linear HDR and outputs display-referred sRGB
      colorRTT.setResolutionScale(scale);
      pipeline.outputNode = upscale(colorRTT, depthTex, velTex, camera, { ratio: RATIO, jitter: !q.has('nojitter') }) as THREE.Node;
    } else {
      pipeline.outputNode = display;
    }
    return { pipeline, shadow: shadowNode as never, refl: reflNode as never, upscaled };
  }

  let graph = buildGraph(q.has('upscale'));

  // ---- animation + stepping -------------------------------------------------------
  let t = 0;           // animation time (s)
  let frame = 0;
  let moving = true;
  let camOffset = 0;   // radians added to the orbit angle by "camera cut"
  const FPS = 60;
  const target = new THREE.Vector3(0, 0.7, 0);

  function pose(time: number) {
    const a = 0.55 + camOffset + 0.45 * Math.sin(time * 0.45);
    const r = 7.2 + 0.8 * Math.sin(time * 0.3);
    camera.position.set(r * Math.sin(a), 2.6 + 0.5 * Math.sin(time * 0.35), r * Math.cos(a));
    camera.lookAt(target);
    camera.updateMatrixWorld();
  }
  function animate() {
    if (moving) t += 1 / FPS;
    pose(t);
    BALLS.forEach((b, i) => {
      const p = meshes[i].position.copy(b.base);
      b.move?.(t, p); // follow animation time (frozen while paused)
      uBalls[i].value.set(p.x, p.y, p.z, b.r);
    });
    uFrame.value = frame % 256;
  }

  function renderOne() {
    animate();
    graph.pipeline.render();
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
  const setShadow = (v: string) => { uShadowMix.value = v === 'denoised' ? 1 : 0; };
  const setRefl = (v: string) => { uReflMix.value = v === 'denoised' ? 1 : 0; };
  const setUpscale = (on: boolean) => {
    if (graph.upscaled === on) return;
    const old = graph;
    graph = buildGraph(on);
    // the upscaler owns the global velocity projection while it jitters
    if (!on) velocity.setProjectionMatrix(null);
    old.pipeline.dispose();
    old.shadow.dispose();
    old.refl.dispose();
  };
  const cut = () => {
    camOffset += 2.1; // teleport the camera
    graph.shadow.resetHistory();
    graph.refl.resetHistory();
  };
  wire('#seg-shadow', setShadow);
  wire('#seg-refl', setRefl);
  wire('#seg-motion', (v) => { moving = v === 'on'; });
  wire('#seg-up', (v) => setUpscale(v === 'on'));
  document.querySelector('#cut')!.addEventListener('click', cut);

  // ---- test hooks (used by run-headless.mjs) ------------------------------------
  const copyCanvas = document.createElement('canvas');
  copyCanvas.width = W; copyCanvas.height = H;
  const cctx = copyCanvas.getContext('2d', { willReadFrequently: true })!;
  const readFrame = (): ImageData => { cctx.drawImage(canvas, 0, 0); return cctx.getImageData(0, 0, W, H); };
  const luma = (d: ImageData) => {
    const out = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) out[i] = (0.2126 * d.data[i * 4] + 0.7152 * d.data[i * 4 + 1] + 0.0722 * d.data[i * 4 + 2]) / 255;
    return out;
  };
  const idle = () => device.queue.onSubmittedWorkDone();

  /** Per-pixel temporal std of luma over K static frames. */
  async function temporalStd(K: number) {
    const sum = new Float64Array(W * H), sum2 = new Float64Array(W * H);
    await frames(K, () => {
      const l = luma(readFrame());
      for (let i = 0; i < l.length; i++) { sum[i] += l[i]; sum2[i] += l[i] * l[i]; }
    });
    const std = new Float32Array(W * H);
    for (let i = 0; i < std.length; i++) { const m = sum[i] / K; std[i] = Math.sqrt(Math.max(0, sum2[i] / K - m * m)); }
    return std;
  }

  /** Copy a node's rgba16float output back and count NaN/Inf (half exponent 31). */
  async function nonFinite(node: TemporalDenoiseNode<never>): Promise<{ w: number; h: number; bad: number; max: number }> {
    const tex = (node as unknown as { _output: THREE.Texture })._output;
    const gpu = getGPUTexture(renderer, tex);
    const bpr = Math.ceil(gpu.width * 8 / 256) * 256;
    const buf = device.createBuffer({ size: bpr * gpu.height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const enc = device.createCommandEncoder();
    enc.copyTextureToBuffer({ texture: gpu }, { buffer: buf, bytesPerRow: bpr }, { width: gpu.width, height: gpu.height });
    device.queue.submit([enc.finish()]);
    await buf.mapAsync(GPUMapMode.READ);
    const u16 = new Uint16Array(buf.getMappedRange());
    let bad = 0, max = 0;
    const half = (h: number) => { const e = (h >> 10) & 31, m = h & 1023, s = h & 0x8000 ? -1 : 1; return e === 0 ? s * m * 2 ** -24 : s * (1 + m / 1024) * 2 ** (e - 15); };
    for (let y = 0; y < gpu.height; y++) {
      for (let x = 0; x < gpu.width * 4; x++) {
        const h = u16[(y * bpr) / 2 + x];
        if (((h >> 10) & 31) === 31) bad++; else max = Math.max(max, Math.abs(half(h)));
      }
    }
    buf.unmap(); buf.destroy();
    return { w: gpu.width, h: gpu.height, bad, max };
  }

  const api = {
    ready: true,
    gpuErrors,
    get frame() { return frame; },
    async step(n: number) { await frames(n); await idle(); },
    setModes(m: { shadow?: string; refl?: string; moving?: boolean; upscale?: boolean }) {
      if (m.shadow) setShadow(m.shadow);
      if (m.refl) setRefl(m.refl);
      if (m.moving !== undefined) moving = m.moving;
      if (m.upscale !== undefined) setUpscale(m.upscale);
    },
    cut,
    /** Render one frame and return the canvas as a PNG data URL. */
    async capture(): Promise<string> {
      await frames(1, readFrame);
      const url = copyCanvas.toDataURL('image/png');
      await idle();
      return url;
    },
    /**
     * Static-camera noise measurement. For each config, the per-pixel temporal std
     * of luma over K frames, averaged over the pixels that flicker in the NOISY
     * config of that effect (its penumbra / glossy region).
     */
    async measure(K = 24, warmup = 24, thr = 0.02) {
      moving = false;
      const run = async (shadow: string, refl: string) => {
        setShadow(shadow); setRefl(refl);
        await frames(warmup);
        return temporalStd(K);
      };
      const mean = (s: Float32Array, mask: Uint8Array) => { let a = 0, n = 0; for (let i = 0; i < s.length; i++) if (mask[i]) { a += s[i]; n++; } return n ? a / n : 0; };
      const maskOf = (s: Float32Array) => { const m = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) m[i] = s[i] > thr ? 1 : 0; return m; };
      const count = (m: Uint8Array) => m.reduce((a, b) => a + b, 0);
      const sNoisy = await run('noisy', 'denoised');   // only shadows noisy
      const rNoisy = await run('denoised', 'noisy');   // only reflections noisy
      const allDen = await run('denoised', 'denoised');
      const allNoisy = await run('noisy', 'noisy');
      const ms = maskOf(sNoisy), mr = new Uint8Array(rNoisy.length).map((_, i) => (rNoisy[i] > thr / 5 ? 1 : 0)); // reflections are dimmer: lower bar
      const out = {
        shadows: { pixels: count(ms), noisyStd: mean(sNoisy, ms), denoisedStd: mean(allDen, ms) },
        reflections: { pixels: count(mr), noisyStd: mean(rNoisy, mr), denoisedStd: mean(allDen, mr) },
        allNoisyMeanStd: mean(allNoisy, new Uint8Array(W * H).fill(1)),
        allDenoisedMeanStd: mean(allDen, new Uint8Array(W * H).fill(1)),
      };
      setShadow('denoised'); setRefl('denoised');
      await idle();
      return out;
    },
    async finiteCheck() {
      return { shadows: await nonFinite(graph.shadow), reflections: await nonFinite(graph.refl) };
    },
    timings() {
      const t = (n: TemporalDenoiseNode<never>) => Object.fromEntries(n.denoiser?.gpuTimings ?? []);
      return { shadows: t(graph.shadow), reflections: t(graph.refl) };
    },
  };
  (window as unknown as { __t: typeof api }).__t = api;

  log(`ready - ${W}x${H}${manual ? ' (manual stepping)' : ''}\nFFX shadows + reflections via denoiser/three, device shared with three r${THREE.REVISION}`);

}

main().catch((e) => { log(`ERROR: ${(e as Error).stack ?? e}`); console.error(e); (window as unknown as { __error?: string }).__error = String(e); });
