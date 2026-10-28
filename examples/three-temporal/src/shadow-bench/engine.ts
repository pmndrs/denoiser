// The shadow bench's GPU side: realtime-shadows' corner scene, its 1-ray area-light shadow signal (the same WGSL,
// src/realtime/rays.ts), any number of denoiser variants on that one signal, and a ground-truth accumulator.
//
// Frames are ticked by hand (`tick`), not by renderer.setAnimationLoop: three advances its per-frame node updates
// (TemporalDenoiseNode dispatch, AccumulateNode) only when the node frame advances, which the animation loop does
// once per display refresh. Ticking by hand lets the bench run a timeline as fast as the GPU allows and decide per
// tick what renders: a denoise frame (pipeline `denoise`: every variant dispatches) or a ground-truth pass (pipeline
// `gt`: no denoiser in the graph, so no history moves). Everything is a pure function of the timeline frame f (knot
// pose, blue-noise index), so a replay from frame 0 reproduces any frame exactly.
//
// Ground truth: gtGrid x gtGrid stratified rays per pixel, gtRows grid rows per pass, accumulated in float32. The
// per-stratum jitter hashes (pixel, stratum) only, never the frame: every frame uses the same light samples per pixel
// (common random numbers), so the ground truth's own frame-to-frame noise is ~0 and temporal metrics see the denoiser,
// not the reference's noise. It traces the same receiver points (the raster pass's depth / normal, the same offset) as
// the 1-ray signal, so it is exactly what the signal converges to.
import * as THREE from 'three/webgpu';
import {
  float, vec2, vec3, vec4, uniform, uint, screenCoordinate, pass, mrt, output, diffuseColor, normalView,
  materialMetalness, materialRoughness, packNormalToRGB, unpackRGBToNormal, velocity, getViewPosition,
  convertToTexture, renderOutput, uv,
} from 'three/tsl';
import { BVHComputeData, wgslTagFn, rayStruct, rayIntersectionResultStruct } from 'three-mesh-bvh/webgpu';
import { ffxShadows, realtimeShadows } from 'denoiser/three';
import type { TemporalDenoiseNode } from 'denoiser/three';
import { type N, LIGHT_C, LIGHT_N, LIGHT_U, LIGHT_V, LIGHT_ASPECT, buildScene, equivalentSphereRadius, blueNoise, AccumulateNode, readTexture } from '../realtime/scene';
import { cornerRays } from '../realtime/rays';
import { type BenchConfig, type Variant, cameraOf, gtKey, knotAngle } from './config';

/** Display of the live canvas: a variant's output, the raw 1-ray signal, or the ground truth while it accumulates. */
export type LiveView = string; // variant id | 'noisy' | 'gt'
export type Show = 'lit' | 'mask';

export interface GroundTruth { key: string; gt: Float32Array; recv: Uint8Array; cached: boolean }
/** `object`: 1 where the pixel has non-zero velocity (static camera: the moving knot). */
export interface FrameRead { frame: number; noisy: Float32Array; outputs: Record<string, Float32Array>; base: Float32Array; direct: Float32Array; object: Uint8Array }

/** Dev-server cache endpoint (shadow-bench-plugin via rtCapture: captures/ = ground truths, outputs/ = runs). */
export const BENCH_API = '/__shadow-bench';

const r1 = (d: Float32Array, n: number) => { const o = new Float32Array(n); for (let i = 0; i < n; i++) o[i] = d[i * 4]; return o; };

export async function createEngine(canvas: HTMLCanvasElement, W: number, H: number, sampler: 'blue' | 'white') {
  canvas.width = W; canvas.height = H;
  if (!navigator.gpu) throw new Error('WebGPU is not available in this browser.');
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: false } as N);
  await renderer.init();
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  const device = (renderer.backend as unknown as { device: GPUDevice }).device;
  let histPipe: GPUComputePipeline | undefined;   // readHistory's texture -> buffer pass
  const gpuErrors: string[] = [];
  device.addEventListener('uncapturederror', (e) => {
    const msg = (e as GPUUncapturedErrorEvent).error.message;
    gpuErrors.push(msg);
    console.error('[webgpu uncapturederror]', msg);
  });
  const nodeFrame = (renderer as N)._nodes.nodeFrame as { update(): void };
  const idle = () => device.queue.onSubmittedWorkDone();

  const { scene, camera, room, knot } = buildScene(W, H);
  scene.updateMatrixWorld(true);
  const bvh = new BVHComputeData(room);
  bvh.update();
  let tris = 0;
  room.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) tris += (m.geometry.index?.count ?? m.geometry.attributes.position.count) / 3; });
  const raycast = (bvh.fns as N).raycastFirstHit;
  const { areaShadow1 } = cornerRays(raycast, { aoA: 0.1, aoB: 0.02 });

  const pcgHash = wgslTagFn`
    fn pcgHash( v: u32 ) -> u32 {
      let s = v * 747796405u + 2891336453u;
      let w = ( ( s >> ( ( s >> 28u ) + 4u ) ) ^ s ) * 277803737u;
      return ( w >> 22u ) ^ w;
    }
  ` as N;
  const pcg2 = wgslTagFn`
    fn pcg2( seed: u32 ) -> vec2f {
      let a = ${pcgHash}( seed );
      return vec2f( f32( a >> 8u ), f32( ${pcgHash}( a ) >> 8u ) ) / 16777216.0;
    }
  ` as N;
  // rows [row0, row0 + rows) of a grid x grid stratification of the panel; jitter = hash(pixel, stratum), no frame
  const gtVisibility = wgslTagFn`
    fn gtVisibility( P: vec3f, Nw: vec3f, sky: f32, C: vec3f, U: vec3f, V: vec3f, nL: vec3f, eps: f32, px: vec2f, grid: u32, row0: u32, rows: u32 ) -> f32 {
      if ( sky > 0.5 ) { return 1.0; }
      let o = P + Nw * eps;
      let pseed = ${pcgHash}( u32( px.x ) + ${pcgHash}( u32( px.y ) + 0x2545F491u ) );
      var lit = 0.0;
      for ( var j = row0; j < row0 + rows; j++ ) {
        for ( var i = 0u; i < grid; i++ ) {
          let h0 = ${pcgHash}( pseed ^ ${pcgHash}( j * grid + i ) );
          let h1 = ${pcgHash}( h0 );
          let su = ( f32( i ) + f32( h0 >> 8u ) / 16777216.0 ) / f32( grid );
          let sv = ( f32( j ) + f32( h1 >> 8u ) / 16777216.0 ) / f32( grid );
          let toL = C + U * ( su * 2.0 - 1.0 ) + V * ( sv * 2.0 - 1.0 ) - o;
          let dist = length( toL );
          let dir = toL / dist;
          if ( dot( Nw, dir ) <= 0.0 || dot( nL, dir ) >= 0.0 ) { continue; }
          let ray = ${rayStruct}( o, dir, dist );
          var hit: ${rayIntersectionResultStruct};
          if ( ! ${raycast}( ray, &hit ) || hit.dist >= dist ) { lit += 1.0; }
        }
      }
      return lit / f32( grid * rows );
    }
  ` as N;

  let cfg: BenchConfig | null = null;
  const uLightC = uniform(LIGHT_C.clone());
  const uLightU = uniform(new THREE.Vector3());
  const uLightV = uniform(new THREE.Vector3());
  const uLightN = uniform(LIGHT_N.clone());
  const uLightPower = uniform(30);
  const uFrame = uniform(0, 'uint');
  const uGtGrid = uniform(64, 'uint');
  const uGtRow0 = uniform(0, 'uint');
  const uGtRows = uniform(4, 'uint');
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

  // ---- graph (as realtime-shadows.ts) --------------------------------------------------------------------------
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
  const d0 = depthTex.sample(uv()).r;
  const Pv = getViewPosition(uv(), d0, projInv);
  const P = camWorld.mul(vec4(Pv, 1)).xyz;
  const Nw = camWorld.mul(vec4(unpackRGBToNormal(nTex.sample(uv()).rgb), 0)).xyz.normalize();
  const sky = d0.greaterThanEqual(0.99999).select(float(1), float(0));
  const eps = Pv.length().mul(0.002).add(0.004);
  const px = screenCoordinate.xy.floor();
  const pixelSeed = uint(px.x).add(uint(px.y).mul(4099)).mul(uint(1973));
  const xi = xiBlue ? vec2(xiBlue(0), xiBlue(1)) : pcg2(pixelSeed.add(uFrame.mul(9277)));
  // 1 ray/pixel: (visibility, occluder distance); the distance alone in .r for the denoiser
  const sigRTT = convertToTexture(vec4(areaShadow1(P, Nw, sky, uLightC, uLightU, uLightV, uLightN, eps, xi), 0, 1));
  const distRTT = convertToTexture(vec4(sigRTT.sample(uv()).g, 0, 0, 1));
  // composite inputs (lit = base + direct x visibility), read back for the CPU-side lit images
  const albedo = dTex.sample(uv());
  const baseRTT = convertToTexture(vec4(sceneColor.sample(uv()).rgb, 1));
  const directRTT = convertToTexture(vec4(albedo.rgb.mul(float(1).sub(albedo.a)).mul(irradiance(P, Nw)).mul(float(1).sub(sky)), 1));
  // moving-object mask: the bench's camera holds still, so only the knot's pixels have velocity
  const objectRTT = convertToTexture(vec4(velTex.sample(uv()).xy.length().greaterThan(0).select(float(1), float(0)), 0, 0, 1));
  // ground truth; alpha = receiver mask
  const gtAcc = new AccumulateNode(vec4(gtVisibility(P, Nw, sky, uLightC, uLightU, uLightV, uLightN, eps, px, uGtGrid, uGtRow0, uGtRows), 0, 0, float(1).sub(sky)));

  const guides = { camera, depth: depthTex, velocity: velTex, normal: nTex, normalSpace: 'view' as const, normalEncoding: 'packed' as const };
  const light = () => ({ type: 'sphere' as const, position: [LIGHT_C.x, LIGHT_C.y, LIGHT_C.z] as [number, number, number], radius: equivalentSphereRadius(cfg?.lightHalf ?? 0.3) });
  const makeNode = (v: Variant): N => v.kind === 'ffx'
    ? ffxShadows(sigRTT, { ...guides, ...(v.options ?? {}) } as N)
    : realtimeShadows(sigRTT, { ...guides, hitDistance: distRTT, light, denoiser: v.options ?? {} } as N);
  let variants: Variant[] = [];
  const nodes = new Map<string, { v: Variant; sig: string; node: N }>();

  // ---- pipelines -------------------------------------------------------------------------------------------------
  const pipe = () => { const p = new THREE.RenderPipeline(renderer); p.outputColorTransform = false; return p; };
  const denoisePipe = pipe(), gtPipe = pipe(), idlePipe = pipe();
  const display = (vis: N, show: Show): N => show === 'mask'
    ? renderOutput(vec4(vec3(vis), 1), THREE.NoToneMapping, THREE.SRGBColorSpace)
    : renderOutput(vec4(baseRTT.sample(uv()).rgb.add(directRTT.sample(uv()).rgb.mul(vis)), 1), THREE.ACESFilmicToneMapping, THREE.SRGBColorSpace);
  gtPipe.outputNode = display((gtAcc as N).r, 'mask') as N;
  idlePipe.outputNode = renderOutput(vec4(sceneColor.sample(uv()).rgb, 1), THREE.ACESFilmicToneMapping, THREE.SRGBColorSpace) as N;
  let live = { view: 'ours' as LiveView, show: 'lit' as Show };
  const visOf = (view: LiveView): N => view === 'noisy' ? sigRTT.sample(uv()).r : view === 'gt' ? (gtAcc as N).r : (nodes.get(view) ?? [...nodes.values()][0])?.node.r ?? float(1);
  const rebuild = () => {
    // every variant (and both composite inputs) stays in the graph at weight 0, so each one dispatches every frame
    // whatever the canvas shows, and switching the view does not touch any history
    const keep = [...[...nodes.values()].map((n) => n.node.r), baseRTT.sample(uv()).r, directRTT.sample(uv()).r, objectRTT.sample(uv()).r].reduce((a: N, b: N) => a.add(b), float(0) as N).mul(0);
    const view = live.view === 'gt' ? 'noisy' : live.view;
    denoisePipe.outputNode = display(visOf(view).add(keep), live.show) as N;
    denoisePipe.needsUpdate = true;
  };

  const tick = (p: THREE.RenderPipeline) => { nodeFrame.update(); renderer.info.reset(); p.render(); };

  // ---- state -------------------------------------------------------------------------------------------------------
  let frame = -1; // timeline frame the denoisers hold (-1: just reset)
  const pose = (f: number) => {
    knot.rotation.set(cfg!.knotTilt, knotAngle(cfg!, f), 0);
    knot.updateMatrixWorld();
    (bvh as N).updateTransforms();
  };

  const gtMem = new Map<string, GroundTruth>(); // small LRU in front of the dev-server cache
  // the cache needs the bench's dev server (vite.bench.config.ts); under plain `yarn dev` ground truths stay in memory
  let cacheOk = false;
  try { const r = await fetch(`${BENCH_API}/info`, { cache: 'no-store' }); cacheOk = r.ok && 'root' in (await r.json()); } catch { /* no bench server */ }
  const remember = (g: GroundTruth) => { gtMem.delete(g.key); gtMem.set(g.key, g); while (gtMem.size > 12) gtMem.delete(gtMem.keys().next().value!); };
  const decode = (key: string, raw: Float32Array): GroundTruth => {
    const gt = new Float32Array(raw.length), recv = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) { const v = raw[i]; recv[i] = v >= 0 ? 1 : 0; gt[i] = v >= 0 ? v : 1; }
    return { key, gt, recv, cached: true };
  };

  const engine = {
    W, H, renderer, device, gpuErrors, info: { three: THREE.REVISION, triangles: tris, sampler },
    get frame() { return frame; },
    get config() { return cfg; },
    get variants() { return variants; },
    get cacheAvailable() { return cacheOk; },
    idle,

    /** Light, camera and knot parameters. Changing what a frame looks like invalidates the histories: call reset(). */
    setScene(c: BenchConfig) {
      if (c.w !== W || c.h !== H) throw new Error(`the page renders ${W}x${H}, the config asks for ${c.w}x${c.h} (load the page with ?w=&h=)`);
      if (c.sampler !== sampler) throw new Error(`the page samples ${sampler} noise, the config asks for ${c.sampler} (load the page with ?sampler=)`);
      cfg = c;
      uLightU.value.copy(LIGHT_U).multiplyScalar(c.lightHalf * LIGHT_ASPECT);
      uLightV.value.copy(LIGHT_V).multiplyScalar(c.lightHalf);
      const cam = cameraOf(c);
      camera.position.set(...cam.position);
      camera.lookAt(new THREE.Vector3(...cam.target));
      camera.updateMatrixWorld();
      uGtGrid.value = c.gtGrid; uGtRows.value = c.gtRows;
      gtAcc.max = c.gtGrid / c.gtRows;
      pose(Math.max(frame, 0));
    },

    /** Denoiser variants (nodes are kept when id and options are unchanged; their history is not reset). */
    setVariants(vs: Variant[]) {
      variants = vs.map((v) => ({ ...v, options: { ...(v.options ?? {}) } }));
      const want = new Map(variants.map((v) => [v.id, v]));
      for (const [id, n] of nodes) {
        const v = want.get(id);
        if (!v || JSON.stringify([v.kind, v.options]) !== n.sig) { n.node.dispose?.(); nodes.delete(id); }
      }
      for (const v of variants) if (!nodes.has(v.id)) nodes.set(v.id, { v, sig: JSON.stringify([v.kind, v.options]), node: makeNode(v) });
      rebuild();
    },

    setLive(view: LiveView, show: Show) {
      live = { view, show };
      if (view === 'gt') return; // the ground truth shows only while it accumulates (gt pipeline)
      rebuild();
    },

    /** Reset every history and stand at "before frame 0" (one scene-only tick at frame 0's pose, so frame 0's velocity is 0). */
    reset() {
      pose(0);
      tick(idlePipe);
      for (const n of nodes.values()) n.node.resetHistory();
      frame = -1;
    },

    /** Render the next timeline frame (every variant dispatches). */
    step() {
      const f = frame + 1;
      pose(f);
      uFrame.value = f;
      tick(denoisePipe);
      frame = f;
    },

    /** Step to `target` as fast as the GPU goes (yielding to the page every few frames). */
    async advanceTo(target: number, onProgress?: (f: number) => void) {
      while (frame < target) {
        engine.step();
        if (frame % 8 === 0) { await idle(); onProgress?.(frame); }
      }
      await idle();
    },

    /** Visibility of the current frame: raw signal, every variant, and the composite inputs. */
    async readFrame(): Promise<FrameRead> {
      await idle();
      const n = W * H;
      const outputs: Record<string, Float32Array> = {};
      for (const [id, nd] of nodes) outputs[id] = r1((await readTexture(renderer, (nd.node as TemporalDenoiseNode).outputTexture)).data, n);
      const noisy = r1((await readTexture(renderer, sigRTT.renderTarget!.texture)).data, n);
      const base = (await readTexture(renderer, baseRTT.renderTarget!.texture)).data;
      const direct = (await readTexture(renderer, directRTT.renderTarget!.texture)).data;
      const ob = (await readTexture(renderer, objectRTT.renderTarget!.texture)).data;
      const object = new Uint8Array(n); for (let i = 0; i < n; i++) object[i] = ob[i * 4] > 0.5 ? 1 : 0;
      return { frame, noisy, outputs, base, direct, object };
    },

    /**
     * Ground truth of timeline frame f: memory, then the dev-server cache, else computed (and cached). Computing it
     * renders the gt pipeline only, at f's pose; the knot goes back to the current frame's pose afterwards.
     */
    async groundTruth(f: number, o: { refresh?: boolean; onProgress?: (done: number, total: number) => void } = {}): Promise<GroundTruth> {
      const key = gtKey(cfg!, f);
      if (!o.refresh) {
        const m = gtMem.get(key);
        if (m) { remember(m); return m; }
        if (cacheOk) {
          const res = await fetch(`${BENCH_API}/files/captures/gt/${key}.f32`, { cache: 'no-store' });
          if (res.ok) { const g = decode(key, new Float32Array(await res.arrayBuffer())); remember(g); return g; }
        }
      }
      pose(f);
      gtAcc.count.value = 0;
      const passes = cfg!.gtGrid / cfg!.gtRows;
      for (let k = 0; k < passes; k++) {
        uGtRow0.value = k * cfg!.gtRows;
        tick(gtPipe);
        await idle(); // one pass in flight at a time (a long queue trips the GPU watchdog)
        if (k % 4 === 3) o.onProgress?.(k + 1, passes);
      }
      await idle();
      const d = (await readTexture(renderer, gtAcc.result)).data;
      const raw = new Float32Array(W * H);
      for (let i = 0; i < W * H; i++) raw[i] = d[i * 4 + 3] > 0.5 ? d[i * 4] : -1;
      pose(Math.max(frame, 0));
      const g = { ...decode(key, raw), cached: false };
      remember(g);
      if (cacheOk) {
        try {
          const put = await fetch(`${BENCH_API}/put?path=captures/gt/${key}.f32`, { method: 'POST', body: raw.buffer });
          cacheOk = put.ok;
          if (put.ok) {
            const cam = cameraOf(cfg!);
            await fetch(`${BENCH_API}/put?path=captures/gt/${key}.json`, { method: 'POST', body: JSON.stringify({ key, w: W, h: H, lightHalf: cfg!.lightHalf, knotTilt: cfg!.knotTilt, knotYaw: knotAngle(cfg!, f), camera: cam, gtGrid: cfg!.gtGrid, rays: cfg!.gtGrid ** 2 }, null, 1) });
          }
        } catch { cacheOk = false; }
      }
      return g;
    },

    /** Latest per-variant total GPU ms (timestamps land a few frames late). */
    /**
     * Diagnostics: one of our variants' internal history (ShadowDenoiser.debugTexture('history'): v, g, A + young
     * counter, n_g; rgba16float) after the last dispatch, decoded to rgba float32, row 0 = top. undefined for FFX.
     */
    async readHistory(id: string): Promise<Float32Array | undefined> {
      await idle();
      const tex = (nodes.get(id)?.node.denoiser as { debugTexture?: (n: string) => GPUTexture | undefined } | undefined)?.debugTexture?.('history');
      if (!tex) return undefined;
      // the package's textures have no COPY_SRC: a compute pass loads the texels into a storage buffer
      histPipe ??= device.createComputePipeline({ layout: 'auto', compute: { entryPoint: 'main', module: device.createShaderModule({ code: /* wgsl */ `
        @group(0) @binding(0) var src: texture_2d<f32>;
        @group(0) @binding(1) var<storage, read_write> dst: array<vec4f>;
        @compute @workgroup_size(8, 8) fn main(@builtin(global_invocation_id) id: vec3u) {
          let s = textureDimensions(src);
          if (id.x < s.x && id.y < s.y) { dst[id.y * s.x + id.x] = textureLoad(src, vec2i(id.xy), 0); }
        }` }) } });
      const size = tex.width * tex.height * 16;
      const buf = device.createBuffer({ size, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
      const rd = device.createBuffer({ size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      const bg = device.createBindGroup({ layout: histPipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: tex.createView() }, { binding: 1, resource: { buffer: buf } }] });
      const enc = device.createCommandEncoder();
      const cp = enc.beginComputePass(); cp.setPipeline(histPipe); cp.setBindGroup(0, bg); cp.dispatchWorkgroups(Math.ceil(tex.width / 8), Math.ceil(tex.height / 8)); cp.end();
      enc.copyBufferToBuffer(buf, 0, rd, 0, size);
      device.queue.submit([enc.finish()]);
      await rd.mapAsync(GPUMapMode.READ);
      const out = new Float32Array(rd.getMappedRange().slice(0));
      rd.unmap(); rd.destroy(); buf.destroy();
      return out;
    },

    timings(): Record<string, number | undefined> {
      return Object.fromEntries([...nodes].map(([id, n]) => [id, n.node.denoiser?.gpuTimings?.get('total') as number | undefined]));
    },

    /** Options the package resolved for a variant (after its first dispatch), else undefined. */
    resolved(id: string): Record<string, unknown> | undefined {
      return nodes.get(id)?.node.denoiser?.options as Record<string, unknown> | undefined;
    },
  };
  return engine;
}

export type Engine = Awaited<ReturnType<typeof createEngine>>;
