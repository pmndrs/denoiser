// One workbench pane: a full frame graph for one denoiser setup, drawn into its own canvas by the shared renderer
// (three's CanvasTarget: one device, one scene, one set of probes and shadow maps for every pane).
//
//   scene pass (MRT: lit colour, albedo + metalness, packed view normal + roughness, velocity), at 1 / ratio
//     |- probe specular (split-sum, box-projected): the reflection wherever no ray is traced
//     |- SSR of lit + probe specular, one of two tracers:
//     |    three r186 (stochastic, one GGX sample per pixel): misses take the probe in the sampled direction
//     |      (reflections-rooms' "probes + SSR")
//     |    Ben's PR #35228 SSRNode: incoming radiance + coverage + hit distance; the probe fills 1 - coverage
//     |                                                                           -> the SSR denoiser
//     |- SSGI (three): indirect diffuse + AO                                  -> the SSGI denoiser
//     '- lit · AO + albedo · GI + specular  -> FSR3 (@pmndrs/upscaler, upscale()), Ben's TRAA, or nothing -> ACES -> sRGB
//
// The SSR / SSGI denoisers are ours (FFX reflections, realtime SVGF / recurrent, the joint diffuse + specular one),
// three's DenoiseNode (spatial only, the upscaler's examples 09 / 10), or Ben's CoverageDenoiseNode (./ben, PR
// #35228). The resolver is FSR3, the convergence stage of the upscaler's kitchen sink, Ben's TRAA, or none.

import * as THREE from 'three/webgpu';
import {
  EnvironmentBRDF, Fn, If, context, diffuseColor, float, getViewPosition, materialMetalness, materialRoughness, mix, mrt,
  normalView, output, packNormalToRGB, pass, renderOutput, rtt, sample, uniform, unpackRGBToNormal, uv, vec3, vec4,
} from 'three/tsl';
import { ssr } from 'three/addons/tsl/display/SSRNode.js';
import { ssgi } from 'three/addons/tsl/display/SSGINode.js';
import { denoise } from 'three/addons/tsl/display/DenoiseNode.js';
import { DebugView, upscale } from 'upscaler-src';
import { ffxReflections, realtimeDiffuse, realtimeDiffuseSpecular, realtimeSpecular } from 'denoiser/three';
import { sampleReflectionProbes } from '../probes/ReflectionProbesNode';
import { clampSample, ggxLobeSample, pixelSeed } from '../reflections/common';
import type { WorkbenchScene } from './scenes';
import { paneVelocity } from './velocity';
import { ENV_RAY_LENGTH, benSSR, benTRAA, coverageDenoise, fastNoise, hiZ, resolveSSRHitDistance } from './ben/index.js';
import type { AoKind, DiffKind, Resolve, SpecKind, Tracer, View } from './catalog';

/* eslint-disable @typescript-eslint/no-explicit-any */
type N = any;

export interface PaneConfig {
  /** The SSR tracer: three r186's SSRNode, or Ben's (PR #35228). */
  tracer: Tracer;
  spec: SpecKind;
  diff: DiffKind;
  resolve: Resolve;
  /** FSR3 render ratio: display size / render size (1 = native resolution, anti-aliasing only). */
  ratio: number;
  /** FSR3's sub-pixel camera jitter. */
  jitter: boolean;
  /** Our denoisers reproject with the jitter removed (TemporalDenoiseNode ignoreViewOffset, its default). */
  jitterAware: boolean;
  /** SSGI's AO: raw, three's DenoiseNode, our SVGF (DiffuseDenoiser on the AO as a grey signal), or Ben's. */
  aoDenoise: AoKind;
  /** SSGI's rotating sample pattern (three's useTemporalFiltering), meant for a temporal stage to integrate. */
  ssgiRotate: boolean;
  rcasDenoise: boolean;
  fsrDebug: number;
  /** Our recurrent specular filter's dropoutGuard option (hit / far-fill flicker on low-roughness surfaces). */
  dropoutGuard: boolean;
  /** Extra options for our specular denoiser (scripts and ablations only; not in the GUI). */
  specExtra?: Record<string, unknown>;
  /** Ben's tracer: his Hi-Z traversal ('adaptive', his examples' default), 'conservative', or linear marching. */
  benTraversal: 'adaptive' | 'conservative' | 'linear';
  /** Ben's CoverageDenoiseNode: spatial radius in texels (his SSR examples 3, SSGI 1.5) and history length. */
  covRadius: number;
  covGiRadius: number;
  covMaxFrames: number;
}

export const defaultPane = (o: Partial<PaneConfig> = {}): PaneConfig => ({
  tracer: 'three', spec: 'recurrent', diff: 'svgf', aoDenoise: 'svgf', resolve: 'fsr', ratio: 1.5, jitter: true, jitterAware: true,
  ssgiRotate: true, rcasDenoise: true, fsrDebug: DebugView.None, covRadius: 3, covGiRadius: 1.5, covMaxFrames: 16, benTraversal: 'adaptive', dropoutGuard: false, ...o,
});

/** Settings every pane shares (uniforms, so changing them rebuilds nothing). */
export interface Shared {
  frame: N;
  roughCut: N;
  giIntensity: N;
  ssr: boolean;
  ssgi: boolean;
  ao: boolean;
  ssgiQuality: { slices: number; steps: number; radius: number };
  view: View;
  /** FAST blue noise atlas for Ben's tracer (null: his tracer falls back to its analytic noise). */
  fastNoise: THREE.Texture | null;
}

/**
 * Makes a three screen-space effect (SSR, SSGI) run at its scene pass's resolution: r186's effects size their
 * targets from the drawing buffer. (The upscaler examples' shared/matchPassResolution.ts, trimmed.)
 */
function atPassResolution<T>(effect: T, scale: number): T {
  if (scale === 1) return effect;
  const node = effect as N;
  const updateBefore = node.updateBefore;
  node.updateBefore = function (frame: N) {
    const renderer = frame.renderer;
    const real = renderer.getDrawingBufferSize;
    renderer.getDrawingBufferSize = (t: THREE.Vector2) => { real.call(renderer, t); return t.set(Math.floor(t.x * scale), Math.floor(t.y * scale)); };
    try { return updateBefore.call(this, frame); } finally { delete renderer.getDrawingBufferSize; }
  };
  return effect;
}

export class Pane {
  readonly camera = new THREE.PerspectiveCamera();
  readonly target: THREE.CanvasTarget;
  readonly pipeline: THREE.RenderPipeline;
  /** The camera's projection without jitter, refreshed before every render: the pane's velocity uses it. */
  private readonly unjittered = new THREE.Matrix4();
  private disposables: N[] = [];
  private fsr: N = null;
  /** Our denoiser nodes in the current graph (timings, history resets). */
  ours: N[] = [];
  /** The current SSR node (either tracer), for scripts and the console. */
  ssr: N = null;
  /** Ben's nodes in the current graph (history resets, his uniforms). */
  private ben: { spec: N; gi: N; ao: N; traa: N } = { spec: null, gi: null, ao: null, traa: null };

  constructor(readonly name: string, readonly canvas: HTMLCanvasElement, private readonly renderer: THREE.WebGPURenderer, public cfg: PaneConfig) {
    this.target = new THREE.CanvasTarget(canvas);
    this.pipeline = new THREE.RenderPipeline(renderer);
    this.pipeline.outputColorTransform = false;
  }

  setSize(width: number, height: number) {
    this.target.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  /** Builds (or rebuilds) the whole graph for the current config. */
  build(ws: WorkbenchScene, sh: Shared) {
    this.dispose();
    const cfg = this.cfg;
    const cam = this.camera;
    const fsrOn = cfg.resolve === 'fsr';
    const ben = this.ben;
    ben.spec = ben.gi = ben.ao = ben.traa = null;
    const scale = fsrOn ? 1 / cfg.ratio : 1;
    const R = (n: N) => rtt(n, null, null, { resolutionScale: scale });

    // ---- G-buffer ---------------------------------------------------------------------------------------------------
    const vel = paneVelocity();
    vel.setProjectionMatrix(this.unjittered);
    const scenePass = pass(ws.scene, cam);
    scenePass.setMRT(mrt({
      output,
      diffuseColor: vec4(diffuseColor.rgb, materialMetalness),      // albedo + metalness
      normal: vec4(packNormalToRGB(normalView), materialRoughness), // packed VIEW normal + roughness
      velocity: vel,
    }));
    scenePass.setResolutionScale(scale);
    const color = scenePass.getTextureNode('output');
    const dTex = scenePass.getTextureNode('diffuseColor');
    const nTex = scenePass.getTextureNode('normal');
    const depth = scenePass.getTextureNode('depth');
    const velTex = scenePass.getTextureNode('velocity');
    const viewNormal = sample((u: N) => unpackRGBToNormal(nTex.sample(u).rgb));

    const camWorld = uniform(new THREE.Matrix4());
    camWorld.onFrameUpdate(() => { camWorld.value.copy(cam.matrixWorld); });
    const projInv = uniform(cam.projectionMatrixInverse);
    const camPos = camWorld.mul(vec4(0, 0, 0, 1)).xyz;
    const surface = () => {
      const d = depth.sample(uv()).r;
      const Pv = getViewPosition(uv(), d, projInv);
      return {
        P: camWorld.mul(vec4(Pv, 1)).xyz,
        N: camWorld.mul(vec4(unpackRGBToNormal(nTex.sample(uv()).rgb), 0)).xyz.normalize(),
        sky: d.greaterThanEqual(0.99999).select(float(1), float(0)),
      };
    };
    const rough = () => nTex.sample(uv()).a;

    // ---- reflections ------------------------------------------------------------------------------------------------
    // the material's split-sum specular response, and the probes' specular for the whole lobe, as reflections-rooms.ts
    const specBRDF = () => {
      const s = surface();
      const alb = dTex.sample(uv());
      const V = camPos.sub(s.P).normalize();
      return (EnvironmentBRDF as N)({
        dotNV: s.N.dot(V).max(1e-4), specularColor: mix(vec3(0.04), alb.rgb, alb.a), specularF90: float(1), roughness: rough(),
      });
    };
    const probeSpec = () => {
      const s = surface();
      const V = camPos.sub(s.P).normalize();
      return sampleReflectionProbes(ws.probes, s.P, V.negate().reflect(s.N), rough()).mul(specBRDF()).mul(s.sky.oneMinus());
    };
    const traced = () => rough().lessThanEqual(sh.roughCut).and(surface().sky.lessThan(0.5));
    // SSR reflects the lit frame plus the probes' specular, so a mirror seen in a mirror isn't black
    const litRTT = R(vec4(color.rgb.add(probeSpec()), 1));
    const ssrSize = { maxDistance: ws.ssr?.maxDistance ?? ws.size, thickness: ws.ssr?.thickness ?? ws.size * 0.01 };

    // specIn: the SSR signal with misses filled by the probe, BRDF-weighted (our denoisers, three's, raw);
    //   alpha is the ray length (100 for a probe sample)
    // covIn / covHit: the same reflection in Ben's form for his CoverageDenoiseNode: radiance in rgb, coverage in a,
    //   hit distance (ENV_RAY_LENGTH for a miss) separately. `covWeighted`: rgb already carries the BRDF (three's
    //   tracer, coverage 1 where traced) or not (Ben's tracer: incoming radiance, the BRDF is applied after denoising)
    let ssrNode: N, specIn: N, covIn: N, covHit: N, covWeighted: boolean;
    let hiZNode: N = null;
    const sky = () => surface().sky.greaterThan(0.5);
    if (cfg.tracer === 'three') {
      ssrNode = atPassResolution(ssr(litRTT, depth, viewNormal, {
        stochastic: true, camera: cam, diffuseNode: dTex, metalnessNode: dTex.a, roughnessNode: nTex.a,
      } as N) as N, scale);
      ssrNode.maxDistance.value = ssrSize.maxDistance;
      ssrNode.thickness.value = ssrSize.thickness;
      // one GGX sample per pixel: SSR where it hits, the probe in the sampled direction where it misses
      // (reflections-rooms' "probes + SSR" estimator); 0 above the roughness cutoff, where the composite uses probeSpec
      specIn = R(Fn(() => {
        const o = vec4(0).toVar();
        if (!sh.ssr) return o;
        const s = surface();
        const alb = dTex.sample(uv());
        const V = camPos.sub(s.P).normalize();
        const g = ggxLobeSample(s.N, V, rough(), alb.a, alb.rgb, pixelSeed(sh.frame, 0));
        If(traced(), () => {
          If(ssrNode.a.greaterThan(0).and(ssrNode.a.lessThan(1e3)), () => { o.assign(ssrNode); })
            .Else(() => { o.assign(clampSample(vec4(sampleReflectionProbes(ws.probes, s.P, g.dir, float(0)).mul(g.weight), 100), rough())); });
        });
        return o;
      })());
      covWeighted = true;
      covIn = R(vec4(specIn.rgb, traced().select(float(1), float(0))));
      const ssrTex = ssrNode.getTextureNode();
      covHit = sample((u: N) => {
        const a = ssrTex.sample(u).a;
        return a.greaterThan(0).and(a.lessThan(1e3)).select(a, float(ENV_RAY_LENGTH));
      });
    } else {
      // Ben's tracer with his SSR example's settings (FAST Separate noise, adaptive Hi-Z, binary refine, 16 steps,
      // trace mask = the roughness cutoff). It traces this frame's lit colour: his default traces the previous frame
      // (ReprojectedRadianceNode, not vendored)
      hiZNode = hiZ(depth);
      ssrNode = atPassResolution(benSSR(litRTT, depth, viewNormal, {
        camera: cam, stochastic: true, outputCoverage: true, roughnessNode: nTex.a,
        traceMaskNode: nTex.a.lessThanEqual(sh.roughCut),
        noiseNode: sh.fastNoise ? fastNoise(sh.fastNoise, new THREE.Vector2(), sh.frame) : null,
        hiZ: hiZNode, hiZTraversal: 'adaptive',
      }), scale);
      ssrNode.maxDistance.value = ssrSize.maxDistance;
      ssrNode.thickness.value = ssrSize.thickness;
      ssrNode.maxSteps.value = 16;
      ssrNode.hiZMaxSteps.value = 64;
      ssrNode.maxLuminance.value = 35;
      ssrNode.screenEdgeFade.value = 0.1;
      ssrNode.binaryRefine = true;
      const ssrTex = ssrNode.getTextureNode();
      const hitTex = ssrNode.getHitNode();
      // his coverage: the tracer's, faded out over the last 0.1 of roughness below the cutoff
      const coverageAt = (u: N) => ssrTex.sample(u).a.mul(nTex.sample(u).a.smoothstep(sh.roughCut.sub(0.1), sh.roughCut).oneMinus());
      covWeighted = false;
      covIn = R(sh.ssr ? vec4(ssrTex.sample(uv()).rgb, coverageAt(uv())) : vec4(0));
      covHit = sample((u: N) => resolveSSRHitDistance(hitTex.sample(u).r, coverageAt(u)));
      // our denoisers get it filled: incoming · BRDF over the coverage, the probe's split-sum over the rest
      specIn = R(Fn(() => {
        const o = vec4(0).toVar();
        if (!sh.ssr) return o;
        If(traced(), () => {
          const c = covIn.sample(uv());
          const d = covHit.sample(uv());
          o.assign(vec4(c.rgb.mul(specBRDF()).mul(c.a).add(probeSpec().mul(c.a.oneMinus())), d.lessThan(1e3).select(d, float(100))));
        });
        return o;
      })());
    }

    // ---- indirect diffuse ---------------------------------------------------------------------------------------------
    const giPass = atPassResolution(ssgi(color, depth, viewNormal, cam) as N, scale);
    giPass.useTemporalFiltering = cfg.ssgiRotate;
    giPass.sliceCount.value = sh.ssgiQuality.slices;
    giPass.stepCount.value = sh.ssgiQuality.steps;
    giPass.radius.value = sh.ssgiQuality.radius;
    const giRaw = giPass.getGINode();
    const aoRaw = giPass.getAONode();
    const giIn = R(vec4(giRaw.rgb, 1));
    const aoIn = R(vec4(vec3(aoRaw.r), 1));

    // ---- denoisers ----------------------------------------------------------------------------------------------------
    const guides = {
      camera: cam, depth, velocity: velTex, normal: nTex, normalSpace: 'view' as const, normalEncoding: 'packed' as const,
      resolutionScale: scale, node: { ignoreViewOffset: cfg.jitterAware },
    };
    const timestamps = { timestamps: true };
    let specOut: N = specIn;
    let giOut: N = giIn;
    let covOut: N = null; // Ben's denoised reflection (radiance, coverage)
    // as his interior example: the normal guide with roughness 1 for diffuse signals
    const diffuseGuide = sample((u: N) => vec4(nTex.sample(u).rgb, 1));
    const coverage = (input: N, hitDistance: N, normal: N) => coverageDenoise(input, cam, { depth, normal, velocity: velTex, hitDistance });
    const combined = cfg.spec === 'combined-svgf' || cfg.spec === 'combined-recurrent';
    if (combined) {
      const n = realtimeDiffuseSpecular({ diffuse: { radiance: giIn }, specular: { radiance: specIn } },
        { ...guides, roughness: nTex.a, denoiser: { filter: cfg.spec === 'combined-svgf' ? 'svgf' : 'recurrent', ...timestamps } as N });
      this.ours.push(n);
      specOut = (n as N).specular;
      giOut = (n as N).diffuse;
    } else {
      const mine = (n: N) => { this.ours.push(n); return n; };
      switch (cfg.spec) {
        case 'spatial': specOut = denoise(specIn, depth, viewNormal, cam); break;
        case 'ffx': specOut = mine(ffxReflections(specIn, { ...guides, roughness: nTex.a, denoiser: timestamps as N })); break;
        case 'svgf': case 'recurrent':
          specOut = mine(realtimeSpecular(specIn, { ...guides, roughness: nTex.a, denoiser: {
            filter: cfg.spec, ...timestamps, ...(cfg.spec === 'recurrent' && cfg.dropoutGuard ? { dropoutGuard: true } : {}), ...cfg.specExtra,
          } as N })); break;
        case 'coverage': ben.spec = coverage(covIn, covHit, nTex); covOut = ben.spec.getTextureNode(); break;
      }
      switch (cfg.diff) {
        case 'spatial': giOut = denoise(giIn, depth, viewNormal, cam); break;
        case 'svgf': case 'recurrent':
          giOut = mine(realtimeDiffuse(giIn, { ...guides, denoiser: { filter: cfg.diff, ...timestamps } as N })); break;
        case 'coverage': ben.gi = coverage(giIn, null, diffuseGuide); giOut = ben.gi.getTextureNode(); break;
      }
    }

    let aoOut: N = aoIn;
    if (cfg.aoDenoise === 'spatial') aoOut = denoise(aoIn, depth, viewNormal, cam);
    else if (cfg.aoDenoise === 'svgf') {
      aoOut = realtimeDiffuse(aoIn, { ...guides, denoiser: { filter: 'svgf', ...timestamps } as N });
      this.ours.push(aoOut);
    } else if (cfg.aoDenoise === 'coverage') {
      ben.ao = coverage(aoIn, null, diffuseGuide);
      aoOut = ben.ao.getTextureNode();
    }

    // ---- composite -------------------------------------------------------------------------------------------------------
    const alb = () => dTex.sample(uv());
    const diffuseAlbedo = () => alb().rgb.mul(alb().a.oneMinus());
    // background pixels have no AO (the denoisers write 0 there)
    const ao = sh.ssgi && sh.ao ? surface().sky.greaterThan(0.5).select(float(1), aoOut.r.clamp(0, 1)) : float(1);
    const gi = sh.ssgi ? diffuseAlbedo().mul(giOut.rgb).mul(sh.giIntensity) : vec3(0);
    // Ben's: the denoised radiance (times the BRDF, for his tracer) over its coverage, the probe over the rest
    const traceSpec = covOut === null ? specOut.rgb
      : (covWeighted ? covOut.rgb : covOut.rgb.mul(specBRDF())).mul(covOut.a).add(probeSpec().mul(covOut.a.oneMinus()));
    // (sky: none; Ben's denoiser leaves background texels undefined)
    const spec: N = sky().select(vec3(0), rough().greaterThan(sh.roughCut).or(!sh.ssr).select(probeSpec(), traceSpec));
    let out: N;
    let resolved = true; // the beauty goes through the resolver; the debug views show the render-resolution signal
    switch (sh.view) {
      case 'specular': out = spec; resolved = false; break;
      case 'specular-input': out = specIn.rgb; resolved = false; break;
      case 'gi': out = gi; resolved = false; break;
      case 'gi-input': out = diffuseAlbedo().mul(giRaw.rgb).mul(sh.giIntensity); resolved = false; break;
      case 'ao': out = vec3(ao); resolved = false; break;
      default: out = color.rgb.mul(ao).add(gi).add(spec);
    }
    const colorTex = R(vec4(out, 1));
    let result: N = colorTex;
    if (fsrOn && resolved) {
      this.fsr = upscale(colorTex, depth, velTex, cam, { path: 'temporal', ratio: cfg.ratio, jitter: cfg.jitter });
      result = this.fsr;
    } else if (cfg.resolve === 'traa' && resolved) {
      ben.traa = benTRAA(colorTex, depth, velTex, cam);
      ben.traa.useSubpixelCorrection = false; // as his SSR examples
      result = ben.traa;
    }
    // Ben's TRAA and CoverageDenoiseNode take the velocity node from the build context (for its unjittered
    // projection; TRAA also pins its own on it): this pane's, not three's global one
    result = context(result, { velocity: vel });
    this.pipeline.outputNode = renderOutput(result, sh.view === 'ao' ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping, THREE.SRGBColorSpace) as N;
    this.pipeline.needsUpdate = true;
    this.ssr = ssrNode;
    this.disposables = [scenePass, ssrNode, hiZNode, giPass, litRTT, specIn, covIn, giIn, aoIn, colorTex, ...this.ours,
      ben.spec, ben.gi, ben.ao, ben.traa];
  }

  /** Renders one frame with `pose` (the shared camera's). */
  render(pose: THREE.PerspectiveCamera) {
    const cam = this.camera;
    cam.position.copy(pose.position);
    cam.quaternion.copy(pose.quaternion);
    cam.fov = pose.fov; cam.near = pose.near; cam.far = pose.far;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    this.unjittered.copy(cam.projectionMatrix);
    const ben = this.ben;
    if (this.cfg.tracer === 'ben' && this.ssr) {
      // build-time switches in his node: the setters recompile only on a change
      this.ssr.hiZEnabled = this.cfg.benTraversal !== 'linear';
      if (this.cfg.benTraversal !== 'linear') this.ssr.hiZTraversal = this.cfg.benTraversal;
    }
    if (ben.spec) { ben.spec.radius.value = this.cfg.covRadius; ben.spec.maxFrames.value = this.cfg.covMaxFrames; }
    for (const n of [ben.gi, ben.ao]) if (n) { n.radius.value = this.cfg.covGiRadius; n.maxFrames.value = this.cfg.covMaxFrames; }
    const u = this.fsr?.upscaler;
    if (u) {
      u.settings.rcasDenoise = this.cfg.rcasDenoise;
      u.settings.debugView = this.cfg.fsrDebug;
    }
    this.renderer.setCanvasTarget(this.target);
    this.pipeline.render();
  }

  resetHistory() {
    for (const n of this.ours) n.resetHistory?.();
    this.fsr?.upscaler?.resetHistory();
    for (const n of [this.ben.spec, this.ben.gi, this.ben.ao]) n?.reset();
    this.ben.traa?.setSize(1, 1); // as his examples' resetHistory: the next frame reallocates and restarts the history
  }

  /** GPU ms of our denoisers (timestamp queries), null when the pane runs none. */
  oursMs(): number | null {
    let total = 0, known = false;
    for (const n of this.ours) {
      const ms = n.denoiser?.gpuTimings?.get('total');
      if (typeof ms === 'number') { total += ms; known = true; }
    }
    return known ? total : null;
  }

  dispose() {
    this.fsr?.dispose();
    this.fsr = null;
    for (const d of this.disposables) d?.dispose?.();
    this.disposables = [];
    this.ours = [];
    this.ben = { spec: null, gi: null, ao: null, traa: null };
  }
}
