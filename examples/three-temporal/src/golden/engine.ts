// The golden engine: one TSL graph for every scene kit (kits.ts), stepped frame by frame, deterministic, with the four
// modes of GOLDEN.md (run / perfect / reference / capture). Reuses the signals of the realtime pages (1-ray diffuse and
// shadow rays through three-mesh-bvh, three's stochastic SSR, the AccumulateNode reference accumulators, the blue-noise
// sequence) and the capture writer of tools/rt-capture.
//
// Three render pipelines share the nodes:
//   refPipe   diffuse + visibility reference accumulation (sub-frames at a held pose; no denoiser in the graph)
//   specPipe  SSR reference accumulation
//   runPipe   the frame itself: 1-spp signals, SSR, the denoisers (exactly once per path frame), composites, guides
// so a denoiser's history never sees the accumulation sub-frames.
import * as THREE from 'three/webgpu';
import {
  float, vec2, vec3, vec4, uniform, uint, screenCoordinate, pass, mrt, diffuseColor, normalView, normalViewGeometry, materialMetalness,
  materialRoughness, packNormalToRGB, unpackRGBToNormal, getViewPosition, convertToTexture, renderOutput, uv, select,
  sample, texture, output, mix,
} from 'three/tsl';
import { ssr } from 'three/addons/tsl/display/SSRNode.js';
import { AccumulateNode, blueNoise, readTexture } from '../realtime/scene';
import { CaptureWriter } from '../../../../tools/rt-capture/src/writer';
import { goldenDenoiser, type BuiltDenoiser } from './denoisers';
import { SIGNAL_CHANNELS, type Kind, type Mode, type Signal } from './registry';
import type { Kit, KitSignals, N } from './types';
import type { SideConfig } from '../review/config';

export interface EngineOptions {
  kit: Kit;
  mode: Mode;
  denoiser: string;
  options: SideConfig;
  width: number;
  height: number;
  seed: number;
  referenceSpp: number;
  perfectSpp: number;
  /** Cap on SSR reference frames (the SSR reference is 1 sample per rendered frame). */
  referenceSppSpec: number;
  withReference: boolean;
  signals: Signal[];
  /** Skip the lit composites and capture guides (timing runs). */
  lean: boolean;
  difRays: number;
  visGrid: number;
  log: (m: string) => void;
}

export interface StepResult {
  frame: number;
  resetFrame: boolean;
  wallMs: number;
  gpuMs: Record<string, number>;
  referenceFrames?: { diffuse: number; visibility: number; specular: number };
  referenceMs?: number;
}
export interface Buf { width: number; height: number; channels: number; data: Float32Array }

const AO_A = 1, AO_B = 0.05;
const f32Placeholder = () => {
  const t = new THREE.DataTexture(new Float32Array(4), 1, 1, THREE.RGBAFormat, THREE.FloatType);
  t.needsUpdate = true;
  return t;
};
const F32 = { type: THREE.FloatType };

/** Keeps nodes in a pipeline's graph (their passes run) without sampling them: one sampler per sampled texture would pass
 *  Metal's 16 per stage. Same trick as AccumulateNode's `deps`. */
class KeepNode extends THREE.TempNode {
  constructor(private readonly deps: N[]) { super('vec4'); }
  setup(builder: N) {
    const props = builder.getNodeProperties(this);
    this.deps.forEach((d, i) => { props[`dep${i}`] = d; });
    return vec4(0, 0, 0, 0);
  }
}

export async function createEngine(canvas: HTMLCanvasElement, o: EngineOptions) {
  const { kit, log } = o;
  const W = o.width, H = o.height;
  if (!navigator.gpu) throw new Error('WebGPU is not available in this browser.');
  const wantRefs = o.mode !== 'run' || o.withReference;
  const perfect = o.mode === 'perfect';
  const denoiserId = o.mode === 'reference' ? 'raw' : o.denoiser;
  const dn = goldenDenoiser(denoiserId);
  if (!dn) throw new Error(`unknown denoiser "${denoiserId}"`);

  const renderer = new THREE.WebGPURenderer({ canvas, antialias: false } as N);
  await renderer.init();
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.setAnimationLoop(null);
  const device = (renderer.backend as unknown as { device: GPUDevice }).device;
  const gpuErrors: string[] = [];
  device.addEventListener('uncapturederror', (e) => {
    const msg = (e as GPUUncapturedErrorEvent).error.message;
    gpuErrors.push(msg);
    console.error('[webgpu uncapturederror]', msg);
  });
  let lost = '';
  device.lost.then((i) => { lost = `DEVICE LOST: ${i.reason} ${i.message}`; log(lost); });
  const idle = () => device.queue.onSubmittedWorkDone();
  const { camera } = kit;
  camera.coordinateSystem = renderer.coordinateSystem;
  camera.updateProjectionMatrix();

  // ---- G-buffer --------------------------------------------------------------------------------------------------
  // `aux`: x = mover flag (the moving object's materials override it), yzw = packed vertex (geometric) normal
  for (const m of kit.moverMaterials) (m as N).mrtNode = mrt({ aux: vec4(1, packNormalToRGB(normalViewGeometry as N)) });
  const scenePass = pass(kit.scene, camera);
  scenePass.setMRT(mrt({
    output,
    diffuseColor: vec4(diffuseColor.rgb, materialMetalness),
    normal: vec4(packNormalToRGB(normalView), materialRoughness),
    aux: vec4(0, packNormalToRGB(normalViewGeometry as N)),
  }));
  const dTex = scenePass.getTextureNode('diffuseColor');
  const nTex = scenePass.getTextureNode('normal');
  const auxTex = scenePass.getTextureNode('aux');
  const depthTex = scenePass.getTextureNode('depth');
  const camWorld = uniform(new THREE.Matrix4());
  camWorld.onFrameUpdate(() => { camera.updateMatrixWorld(); camWorld.value.copy(camera.matrixWorld); });
  const projInv = uniform(camera.projectionMatrixInverse);
  const surface = (uvN: N) => {
    const d = depthTex.sample(uvN).r;
    const Pv = getViewPosition(uvN, d, projInv);
    const P = camWorld.mul(vec4(Pv, 1)).xyz;
    const Nw = camWorld.mul(vec4(unpackRGBToNormal(nTex.sample(uvN).rgb), 0)).xyz.normalize();
    return { P, N: Nw, sky: d.greaterThanEqual(0.99999).select(float(1), float(0)), viewDist: Pv.length(), depth: Pv.z.negate(), Pv, d };
  };
  const s0 = surface(uv());
  const eps = s0.viewDist.mul(0.002).add(0.004);
  const g = {
    s0, eps,
    pixelSeed: () => { const px = screenCoordinate.xy.floor(); return uint(px.x).add(uint(px.y).mul(4099)).mul(uint(1973)); },
  };

  // ---- signals ---------------------------------------------------------------------------------------------------
  const uFrame = uniform(0, 'uint'); // blue-noise frame index = seed offset + path frame
  const uSeed = uniform(0, 'uint');  // white-noise seed of the reference sub-frames
  const xi = await blueNoise(uFrame);
  const sig: KitSignals = kit.buildSignals(g as N, { xi, seed: uSeed, hold: float(0), difRays: o.difRays, visGrid: o.visGrid, aoA: AO_A, aoB: AO_B });
  const difRTT = convertToTexture(sig.diffuse1);
  const shRTT = convertToTexture(sig.shadow1);

  const feedDif = texture(f32Placeholder());
  const feedVis = texture(f32Placeholder());
  const albedoD = () => { const a = dTex.sample(uv()); return a.rgb.mul(float(1).sub(a.a)); };
  const ssrLit = convertToTexture(vec4(albedoD().mul(feedDif.sample(uv()).rgb.add(sig.direct(feedVis.sample(uv()).r))), 1));
  const ssrNode = ssr(ssrLit, depthTex, sample((uvN: N) => unpackRGBToNormal(nTex.sample(uvN).rgb)), {
    stochastic: true, camera, diffuseNode: dTex, metalnessNode: dTex.a, roughnessNode: nTex.a, envImportanceSampling: true,
  } as N) as N;
  ssrNode.setEnvMap(kit.env);
  ssrNode.maxDistance.value = kit.ssr.maxDistance;
  ssrNode.thickness.value = kit.ssr.thickness;
  ssrNode.environmentIntensity.value = kit.envI;
  const ssrNoise = (ssrNode as N)._noiseIndex as { value: number };
  if (!ssrNoise) throw new Error('SSRNode._noiseIndex not found (three version changed?)');
  const ssrHit = ssrNode.a.greaterThan(0).and(ssrNode.a.lessThan(1e3));

  // ---- references --------------------------------------------------------------------------------------------------
  const difRef: N = new AccumulateNode(sig.diffuseRef);
  const visRef: N = new AccumulateNode(sig.shadowRef);
  const specRef: N = new AccumulateNode(vec4(ssrNode.rgb, 1), 1, [ssrNode]);
  const specLen: N = new AccumulateNode(vec4(select(ssrHit, ssrNode.a, float(0)), select(ssrHit, float(1), float(0)), 0, 1), 1, [ssrNode]);
  const difFrames = Math.max(1, Math.ceil((perfect ? o.perfectSpp : o.referenceSpp) / o.difRays));
  const visFrames = Math.max(1, Math.ceil((perfect ? o.perfectSpp : o.referenceSpp) / (o.visGrid * o.visGrid)));
  const specFrames = Math.max(1, Math.min(perfect ? o.perfectSpp : o.referenceSpp, o.referenceSppSpec));
  difRef.max = difFrames; visRef.max = visFrames; specRef.max = specLen.max = specFrames;
  const pDif = texture(f32Placeholder()), pVis = texture(f32Placeholder()), pSpec = texture(f32Placeholder()), pLen = texture(f32Placeholder());

  // ---- inputs of the denoisers: the 1-spp signals, or the converged ones in perfect mode ---------------------------------
  const uPerfect = uniform(perfect ? 1 : 0);
  const isP = uPerfect.greaterThan(0.5);
  let difIn: N = difRTT, difHitIn: N, ssrIn: N = ssrNode, shIn: N = shRTT, shDistIn: N;
  if (perfect) {
    const ao = pDif.sample(uv()).a;
    const hitP = select(ao.greaterThanEqual(0.999), float(0), ao.mul(float(AO_A).add(s0.depth.mul(AO_B))).div(float(1).sub(ao).max(1e-3)));
    difIn = convertToTexture(vec4(select(isP, pDif.sample(uv()).rgb, difRTT.sample(uv()).rgb), select(isP, hitP, difRTT.sample(uv()).a)));
    const v = pVis.sample(uv());
    const blocked = float(1).sub(v.r);
    shIn = convertToTexture(vec4(select(isP, v.r, shRTT.sample(uv()).r), select(isP, select(blocked.lessThan(0.02), float(0), v.g.div(blocked)), shRTT.sample(uv()).g), 0, 1));
    const len = pLen.sample(uv());
    ssrIn = convertToTexture(vec4(select(isP, pSpec.sample(uv()).rgb, ssrNode.rgb), select(isP, select(len.g.lessThan(0.02), float(0), len.r.div(len.g)), ssrNode.a)));
  }
  difHitIn = convertToTexture(vec4(difIn.sample(uv()).a, 0, 0, 1));
  shDistIn = convertToTexture(vec4(shIn.sample(uv()).g, 0, 0, 1));
  const aoIn = convertToTexture(vec4(select(difHitIn.sample(uv()).r.lessThanEqual(0), float(1), difHitIn.sample(uv()).r.div(difHitIn.sample(uv()).r.add(AO_A).add(s0.depth.mul(AO_B)))), 0, 0, 1));
  const aoNoisy = convertToTexture(vec4(select(difRTT.sample(uv()).a.lessThanEqual(0), float(1), difRTT.sample(uv()).a.div(difRTT.sample(uv()).a.add(AO_A).add(s0.depth.mul(AO_B)))), 0, 0, 1));

  // ---- analytic motion (current - previous, NDC) and the guides in CAPTURE-FORMAT conventions ---------------------------
  const uPrevView = uniform(new THREE.Matrix4());
  const uPrevViewProj = uniform(new THREE.Matrix4());
  const uMoverPrev = uniform(new THREE.Matrix4()); // current world -> previous world, for the mover's pixels
  const sky = s0.sky.greaterThan(0.5);
  const onMover = auxTex.sample(uv()).x.greaterThan(0.5);
  const ndc = vec2(uv().x.mul(2).sub(1), float(1).sub(uv().y.mul(2)));
  const Pprev = select(onMover, uMoverPrev.mul(vec4(s0.P, 1)).xyz, s0.P);
  const prevClip = uPrevViewProj.mul(vec4(Pprev, 1));
  const motionN = ndc.sub(prevClip.xy.div(prevClip.w));
  const motionZN = select(sky, float(0), uPrevView.mul(vec4(Pprev, 1)).z.sub(s0.Pv.z));
  const motionH = convertToTexture(vec4(motionN, 0, 1));
  const guides = { camera, depth: depthTex, velocity: motionH, normal: nTex, normalSpace: 'view' as const, normalEncoding: 'packed' as const };

  // ---- denoisers ---------------------------------------------------------------------------------------------------------
  const want = new Set<Signal>(o.signals);
  const built: BuiltDenoiser = dn.build({
    guides, roughness: nTex.a, inputs: { dif: difIn, difHit: difHitIn, ssr: ssrIn, sh: shIn, shDist: shDistIn },
    light: kit.light, options: o.options, want,
  });
  // SSR is lit by the converged references when there are any (the capture convention: noisy sample and reference share one
  // input), else by last frame's denoised diffuse and shadow (what the product does)
  const outTexOf = (s: Signal): (() => THREE.Texture) | undefined => built.tex[s];
  if (wantRefs) { /* feeds are set per frame from the reference accumulators */ } else {
    feedDif.value = (outTexOf('diffuse') ?? (() => (difRTT.renderTarget!.texture)))();
    feedVis.value = (outTexOf('shadow') ?? (() => (shRTT.renderTarget!.texture)))();
  }

  // ---- composites -----------------------------------------------------------------------------------------------------------
  const litOf = (dif: N, spec: N, vis: N) => albedoD().mul(dif.add(sig.direct(vis))).add(spec);
  const display = (lit: N) => renderOutput(vec4(lit, 1), THREE.ACESFilmicToneMapping, THREE.SRGBColorSpace);
  const inDif = difIn.sample(uv()).rgb, inVis = shIn.sample(uv()).r;
  const inSpec = perfect ? ssrIn.sample(uv()).rgb : ssrNode.rgb;
  const outDif = built.out.diffuse ? built.out.diffuse.rgb : inDif;
  const outSpec = built.out.specular ? built.out.specular.rgb : inSpec;
  const outVis = built.out.shadow ? built.out.shadow.r : inVis;
  const lits: Record<string, N> = {};
  const disp: Record<string, N> = {};
  if (!o.lean) {
    lits.input = convertToTexture(vec4(litOf(inDif, inSpec, inVis), 1), null, null, F32);
    lits.noisy = perfect ? convertToTexture(vec4(litOf(difRTT.sample(uv()).rgb, ssrNode.rgb, shRTT.sample(uv()).r), 1), null, null, F32) : lits.input;
    lits.output = convertToTexture(vec4(litOf(outDif, outSpec, outVis), 1), null, null, F32);
    disp.input = convertToTexture(display(lits.input.sample(uv()).rgb), null, null, F32);
    disp.noisy = perfect ? convertToTexture(display(lits.noisy.sample(uv()).rgb), null, null, F32) : disp.input;
    disp.output = convertToTexture(display(lits.output.sample(uv()).rgb), null, null, F32);
  }
  // references composite (evaluated in its own tiny pipeline once the references are in)
  const refLit = o.lean ? null : convertToTexture(vec4(litOf(difRef.rgb, specRef.rgb, visRef.r), 1), null, null, F32);
  const refDisp = refLit ? convertToTexture(display(refLit.sample(uv()).rgb), null, null, F32) : null;

  // guides as float32 targets
  const geomN = camWorld.mul(vec4(unpackRGBToNormal(auxTex.sample(uv()).gba), 0)).xyz.normalize();
  const aA = dTex.sample(uv());
  const gd = o.lean ? null : {
    g1: convertToTexture(vec4(select(sky, float(1), s0.d), select(sky, float(-camera.far), s0.Pv.z), nTex.sample(uv()).a, motionZN), null, null, F32),
    normal: convertToTexture(vec4(select(sky, vec3(0), s0.N), 0), null, null, F32),
    normalGeom: convertToTexture(vec4(select(sky, vec3(0), geomN), 0), null, null, F32),
    motion: convertToTexture(vec4(motionN, select(onMover, float(1), float(0)), 0), null, null, F32),
    albedo: convertToTexture(vec4(aA.rgb.mul(float(1).sub(aA.a)), 0), null, null, F32),
    f0: convertToTexture(vec4(mix(vec3(0.04), aA.rgb, aA.a), 0), null, null, F32),
  };

  // ---- pipelines -------------------------------------------------------------------------------------------------------------
  const mkPipe = (outNode: N) => { const p = new THREE.RenderPipeline(renderer); p.outputColorTransform = false; p.outputNode = outNode; return p; };
  const refPipe = mkPipe(vec4(difRef.rgb.add(visRef.rgb), 1));
  const specPipe = mkPipe(vec4(specRef.rgb.add(specLen.rgb), 1));
  const refLitPipe = refLit ? mkPipe(vec4(refDisp!.sample(uv()).rgb, 1).add(new KeepNode([refLit]) as N)) : null;
  const keepDeps = [difRTT, shRTT, aoNoisy, aoIn, motionH, ssrNode, ...Object.values(lits), ...Object.values(disp), ...(gd ? Object.values(gd) : []), ...built.nodes];
  const runPipe = mkPipe(vec4((disp.output ? disp.output.sample(uv()).rgb : vec3(0)), 1).add(new KeepNode([...new Set(keepDeps)]) as N));

  // ---- state -----------------------------------------------------------------------------------------------------------------
  const seedBase = (o.seed >>> 0) * 100003;
  let lastFrame: number | null = null;
  let needCut = true;
  let framesRendered = 0;
  let lastStep: StepResult | null = null;
  let haveRefs = false;

  const resetHistory = () => { for (const n of built.nodes) n.resetHistory(); };
  const poseMatrices = (f: number, cut: boolean) => {
    const pf = cut ? f : Math.max(0, f - 1);
    kit.setFrame(pf);
    const prevView = camera.matrixWorldInverse.clone();
    const prevProj = camera.projectionMatrix.clone();
    const moverPrev = kit.mover ? kit.mover.matrixWorld.clone() : new THREE.Matrix4();
    kit.setFrame(f);
    uPrevView.value.copy(prevView);
    uPrevViewProj.value.multiplyMatrices(prevProj, prevView);
    uMoverPrev.value.copy(moverPrev).multiply((kit.mover ? kit.mover.matrixWorld : new THREE.Matrix4()).clone().invert());
    return { prevView, prevProj };
  };

  /** Accumulates the references of the current pose. */
  const accumulateRefs = async () => {
    const t0 = performance.now();
    difRef.count.value = 0; visRef.count.value = 0;
    const n = Math.max(difFrames, visFrames);
    const base = seedBase + (lastFrame ?? 0) * 8191;
    for (let k = 0; k < n; k++) {
      uSeed.value = (base + k) >>> 0;
      refPipe.render();
      if ((k & 15) === 15) await idle();
    }
    await idle();
    pDif.value = difRef.result; pVis.value = visRef.result;
    feedDif.value = difRef.result; feedVis.value = visRef.result;
    specRef.count.value = 0; specLen.count.value = 0;
    for (let k = 0; k < specFrames; k++) {
      ssrNoise.value = (base + 977 + k) % 0x7fffffff;
      specPipe.render();
      if ((k & 31) === 31) await idle();
    }
    await idle();
    pSpec.value = specRef.result; pLen.value = specLen.result;
    haveRefs = true;
    return performance.now() - t0;
  };

  const gpuTimings = (): Record<string, number> => {
    const r: Record<string, number> = {};
    built.nodes.forEach((n: N, i: number) => {
      const t = n.denoiser?.gpuTimings as ReadonlyMap<string, number> | undefined;
      if (!t) return;
      for (const [k, v] of t) r[`${built.names[i] ?? i}.${k}`] = v;
    });
    const tot = built.nodes.reduce((a: number, n: N) => a + ((n.denoiser?.gpuTimings as ReadonlyMap<string, number> | undefined)?.get('total') ?? 0), 0);
    if (built.nodes.length) r.total = tot;
    return r;
  };

  /** Renders path frame f. `cut`: history dropped, no previous pose. */
  const renderFrame = async (f: number, cut: boolean): Promise<StepResult> => {
    if (lost) throw new Error(lost);
    lastFrame = f;
    poseMatrices(f, cut);
    uFrame.value = (seedBase + f) >>> 0;
    let referenceMs: number | undefined;
    if (cut) resetHistory();
    // the renderer sets the WebGPU projection at its first render: refresh the matrices that depend on it
    if (wantRefs) referenceMs = await accumulateRefs();
    ssrNoise.value = ((seedBase + 31 * f + 5) % 0x7fffffff + 0x7fffffff - 1) % 0x7fffffff;
    await idle();
    const t0 = performance.now();
    runPipe.render();
    await idle();
    const wallMs = performance.now() - t0;
    if (refLitPipe) refLitPipe.render();
    await idle();
    framesRendered++;
    // timestamp queries resolve asynchronously: give them a tick
    await new Promise((r) => setTimeout(r, 0));
    lastStep = {
      frame: f, resetFrame: cut, wallMs, gpuMs: gpuTimings(),
      ...(wantRefs ? { referenceFrames: { diffuse: difFrames, visibility: visFrames, specular: specFrames }, referenceMs } : {}),
    };
    needCut = false;
    return lastStep;
  };

  // ---- reads -----------------------------------------------------------------------------------------------------------------
  const rt = (n: N): THREE.Texture => (n.renderTarget ? n.renderTarget.texture : n.value) as THREE.Texture;
  const need = (c: boolean, msg: string) => { if (!c) throw new Error(msg); };
  const pick = (d: Float32Array, cs: number[]) => {
    const n = W * H;
    const out = new Float32Array(n * cs.length);
    for (let i = 0; i < n; i++) for (let k = 0; k < cs.length; k++) out[i * cs.length + k] = d[i * 4 + cs[k]];
    return out;
  };
  const ssrInTex = (): THREE.Texture => (perfect ? rt(ssrIn) : ssrNode.getTextureNode().value);
  const textureOf = (signal: string, kind: Kind): { tex: THREE.Texture; cs: number[] } => {
    need(lastFrame !== null, 'read before the first step()');
    const rgb = [0, 1, 2];
    const wantKind = (kind === 'input' && !perfect ? 'noisy' : kind);
    if (kind === 'reference') need(haveRefs, `no reference in mode ${o.mode} (use mode=reference|perfect|capture or withReference=1)`);
    switch (signal) {
      case 'diffuse':
        return wantKind === 'noisy' ? { tex: rt(difRTT), cs: rgb } : wantKind === 'input' ? { tex: rt(difIn), cs: rgb }
          : wantKind === 'reference' ? { tex: difRef.result, cs: rgb } : { tex: (outTexOf('diffuse') ?? (() => rt(difIn)))(), cs: rgb };
      case 'specular':
        return wantKind === 'noisy' ? { tex: ssrNode.getTextureNode().value, cs: rgb } : wantKind === 'input' ? { tex: ssrInTex(), cs: rgb }
          : wantKind === 'reference' ? { tex: specRef.result, cs: rgb } : { tex: (outTexOf('specular') ?? ssrInTex)(), cs: rgb };
      case 'shadow':
        return wantKind === 'noisy' ? { tex: rt(shRTT), cs: [0] } : wantKind === 'input' ? { tex: rt(shIn), cs: [0] }
          : wantKind === 'reference' ? { tex: visRef.result, cs: [0] } : { tex: (outTexOf('shadow') ?? (() => rt(shIn)))(), cs: [0] };
      case 'ao':
        return wantKind === 'noisy' ? { tex: rt(aoNoisy), cs: [0] } : wantKind === 'input' ? { tex: rt(aoIn), cs: [0] }
          : wantKind === 'reference' ? { tex: difRef.result, cs: [3] } : { tex: (outTexOf('ao') ?? (() => rt(aoIn)))(), cs: [0] };
      case 'lit': case 'display': {
        need(!o.lean, 'lean mode has no composites');
        const set = signal === 'lit' ? lits : disp;
        if (wantKind === 'reference') return { tex: (signal === 'lit' ? refLit : refDisp)!.renderTarget!.texture, cs: rgb };
        return { tex: rt(set[wantKind]), cs: rgb };
      }
      default: break;
    }
    need(!!gd, 'lean mode has no guides');
    const G = gd!;
    switch (signal) {
      case 'depth': return { tex: rt(G.g1), cs: [0] };
      case 'viewz': return { tex: rt(G.g1), cs: [1] };
      case 'roughness': return { tex: rt(G.g1), cs: [2] };
      case 'motion_z': return { tex: rt(G.g1), cs: [3] };
      case 'normal': return { tex: rt(G.normal), cs: rgb };
      case 'normal_geom': return { tex: rt(G.normalGeom), cs: rgb };
      case 'motion': return { tex: rt(G.motion), cs: [0, 1] };
      case 'mask_mover': return { tex: rt(G.motion), cs: [2] };
      case 'albedo': return { tex: rt(G.albedo), cs: rgb };
      case 'f0': return { tex: rt(G.f0), cs: rgb };
      default: throw new Error(`unknown signal "${signal}"`);
    }
  };
  const read = async (spec: { signal: string; kind?: Kind }): Promise<Buf> => {
    const kind = spec.kind ?? 'output';
    const { tex, cs } = textureOf(spec.signal, kind);
    const r = await readTexture(renderer, tex);
    if (r.w !== W || r.h !== H) throw new Error(`${spec.signal}.${kind} is ${r.w}x${r.h}, expected ${W}x${H}`);
    return { width: W, height: H, channels: cs.length, data: pick(r.data, cs) };
  };

  // ---- capture ------------------------------------------------------------------------------------------------------------------
  const capture = async (c: { name: string; start?: number; frames?: number }) => {
    const start = c.start ?? 0;
    const n = Math.min(c.frames ?? kit.frames - start, kit.frames - start);
    const writer = new CaptureWriter(device, c.name);
    const v1 = kit.shadingNormals;
    await writer.begin({
      scene: `golden-${kit.id}`,
      generator: 'examples/three-temporal golden.html (capture mode, __golden.capture)',
      width: W, height: H, lights: kit.captureLights() as never, static: !kit.mover, reversedDepth: false,
      referenceSpp: Math.min(difFrames * o.difRays, visFrames * o.visGrid * o.visGrid),
      demodulation: { diffuse: 'albedo', specular: 'none' },
      extra: {
        golden: {
          scene: kit.id, label: kit.label, seed: o.seed, start, frames: n, events: kit.events, info: kit.info,
          references: {
            diffuse: `${difFrames * o.difRays} white-noise cosine rays/pixel`, visibility: `${visFrames * o.visGrid * o.visGrid} stratified rays/pixel`,
            specular: `${specFrames} stochastic SSR frames (SSR's own expectation, env reflections included; not masked)`,
            ao: 'ao_ref: mean per-sample normalized hit distance h/(h + 1 + 0.05 * depth) of the diffuse reference rays, miss = 1',
          },
          signals: 'diffuse: 1 cosine ray (blue noise, index = seed offset + path frame); shadow: 1 ray to the shadow light; specular: three SSR (stochastic, env importance sampling), NOT demodulated and NOT masked to screen-space hits',
        },
      },
    });
    const t0 = performance.now();
    const perFrameS: number[] = [];
    const wasLean = o.lean;
    need(!wasLean, 'capture needs the guides (lean=0)');
    for (let k = 0; k < n; k++) {
      const tf = performance.now();
      const f = start + k;
      await renderFrame(f, k === 0);
      const { prevView, prevProj } = poseMatrices(f, k === 0); // matrices only (no render)
      const cam = {
        view: camera.matrixWorldInverse.elements.slice(), projection: camera.projectionMatrix.elements.slice(),
        prevView: prevView.elements.slice(), prevProjection: prevProj.elements.slice(),
        jitter: [0, 0] as [number, number], near: camera.near, far: camera.far, position: camera.position.toArray() as [number, number, number],
      };
      const R = async (signal: string, kind: Kind) => (await read({ signal, kind })).data;
      const dif = await readTexture(renderer, rt(difRTT));
      const sh = await readTexture(renderer, rt(shRTT));
      const ssrT = await readTexture(renderer, ssrNode.getTextureNode().value);
      const g1 = await readTexture(renderer, rt(gd!.g1));
      const bufs: Record<string, Float32Array | { data: Float32Array; channels: number }> = {
        depth: pick(g1.data, [0]), viewz: pick(g1.data, [1]), roughness: pick(g1.data, [2]), motion_z: pick(g1.data, [3]),
        normal: await R('normal', 'output'), motion: await R('motion', 'output'), albedo: await R('albedo', 'output'), f0: await R('f0', 'output'),
        diffuse: pick(dif.data, [0, 1, 2]), diffuse_hitt: pick(dif.data, [3]),
        specular: pick(ssrT.data, [0, 1, 2]), specular_hitt: pick(ssrT.data, [3]).map((a) => (a > 1e3 ? 0 : a)),
        visibility: pick(sh.data, [0]), occluder_dist: pick(sh.data, [1]),
        diffuse_ref: await R('diffuse', 'reference'), visibility_ref: await R('shadow', 'reference'), specular_ref: await R('specular', 'reference'),
      };
      bufs.ao_ref = { data: await R('ao', 'reference'), channels: 1 };
      if (v1) bufs.normal_geom = await R('normal_geom', 'output');
      await writer.writeFrame({ reset: k === 0, camera: cam, extra: { pathFrame: f, lights: kit.captureLights() } }, bufs);
      perFrameS.push((performance.now() - tf) / 1000);
      log(`capture ${c.name}: frame ${k + 1}/${n} (path frame ${f}) ${perFrameS.at(-1)!.toFixed(2)} s`);
    }
    const res = await writer.finish();
    return { name: c.name, path: res?.path ?? null, frames: n, start, seconds: +((performance.now() - t0) / 1000).toFixed(1), perFrameS: perFrameS.map((s) => +s.toFixed(2)), gpuErrors: gpuErrors.length };
  };

  // warm-up: compile every pipeline once (frame 0 pose), then drop the history
  kit.setFrame(0);
  poseMatrices(0, true);
  runPipe.render(); await idle();
  refPipe.render(); specPipe.render(); refLitPipe?.render(); await idle();
  resetHistory();

  const adapterInfo = await (async () => {
    try { const a = await navigator.gpu.requestAdapter(); const i = (a as N)?.info; return i ? { vendor: i.vendor, architecture: i.architecture, description: i.description } : {}; } catch { return {}; }
  })();

  return {
    renderer, device, gpuErrors, kit, adapterInfo,
    applies: Object.fromEntries((['diffuse', 'specular', 'shadow', 'ao'] as Signal[]).map((s) => [s, want.has(s) ? dn.applies[s] : 'raw'])) as Record<Signal, string>,
    denoiserId,
    refFrames: { diffuse: difFrames, visibility: visFrames, specular: specFrames },
    get lastFrame() { return lastFrame; },
    get framesRendered() { return framesRendered; },
    get lastStep() { return lastStep; },
    get needCut() { return needCut; },
    cut() { needCut = true; },
    renderFrame, read, capture, timings: gpuTimings, resetHistory, idle,
    channels: SIGNAL_CHANNELS,
  };
}
export type Engine = Awaited<ReturnType<typeof createEngine>>;
