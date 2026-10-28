// Interior lab, one pane: Ben Houston's webgpu_interior example (./interior.js) with one denoiser setup.
//
// The lab page (shell.ts) runs up to three panes, each a full copy of the example in its own iframe (its own renderer,
// GPU device, histories, TRAA / FSR3 and SSR lighting feedback), and reveals them side by side with CSS. The shell
// drives every pane's frame from one loop and copies the leading pane's camera to the others, so all panes render the
// same pose on the same frame.
//
// A pane replaces the example's SSR / SSGI providers with the denoiser its config names, and its final output with the
// resolver it names (TRAA as in Ben's example, FSR3 from @pmndrs/upscaler as in the upscaler's 09-kitchen-sink, or
// none). Ours (FFX, SVGF, recurrent) run through denoiser/three's TemporalDenoiseNode; Ben's CoverageDenoiseNode, the
// r186 chain and three's DenoiseNode are three nodes from his branch, used through their public API only.
//
// Opened on its own (interior-pane.html, no shell), a pane runs Ben's preset with its own animation loop.
import { FfxReflectionDenoiser } from '@pmndrs/denoiser-ffx';
import { DiffuseDenoiser, SpecularDenoiser } from '@pmndrs/denoiser-realtime';
import { DebugView, upscale } from '@pmndrs/upscaler';
import { temporalDenoise, worldNormalTexture } from 'denoiser/three';
import {
  cameraWorldMatrix, convertToTexture, float, mix, sample, screenUV, select, uniform, unpackRGBToNormal, uv, vec3, vec4,
  velocity,
} from 'three/tsl';
import { coverageDenoise } from 'three/addons/tsl/display/CoverageDenoiseNode.js';
import { denoise } from 'three/addons/tsl/display/DenoiseNode.js';
import { OURS, PRESETS, type Contract, type DiffKind, type PaneName, type Resolve, type SpecKind, type View } from './catalog';

/* eslint-disable @typescript-eslint/no-explicit-any */
type N = any;

export interface PaneConfig {
  spec: SpecKind;
  contract: Contract;
  diff: DiffKind;
  resolve: Resolve;
  ffx: { temporalStabilityFactor: number; currentFrameStatistics: boolean };
  svgf: { atrousIterations: number; temporalAlpha: number; antiLag: 'auto' | 'off'; feedback: boolean };
  recurrent: { virtualMotion: boolean; maxAccumulatedFrames: number; fastFrames: number; blurRadius: number };
  coverage: { radius: number; maxFrames: number; depthThreshold: number; gatherConfidence: boolean };
  spatial: { radius: number; lumaPhi: number; depthPhi: number; normalPhi: number };
  fsr: { rcasDenoise: boolean; debugView: number };
}

// The knobs start at the packages' defaults (Ben's node: his example's values; DenoiseNode and FSR3: theirs). Only
// values that differ from these are passed to our denoisers, so an untouched knob means "the package default"
// (blurRadius 0 = auto).
export const KNOB_DEFAULTS = {
  ffx: { temporalStabilityFactor: 0.7, currentFrameStatistics: true },
  svgf: { atrousIterations: 5, temporalAlpha: 0.1, antiLag: 'auto' as 'auto' | 'off', feedback: false },
  recurrent: { virtualMotion: true, maxAccumulatedFrames: 31, fastFrames: 3, blurRadius: 0 },
  coverage: { radius: 1.5, maxFrames: 16, depthThreshold: 0.01, gatherConfidence: true },
  spatial: { radius: 5, lumaPhi: 5, depthPhi: 5, normalPhi: 5 },
  fsr: { rcasDenoise: true, debugView: DebugView.None as number },
};
export const paneConfig = (setup: Partial<Pick<PaneConfig, 'spec' | 'contract' | 'diff' | 'resolve'>> = {}): PaneConfig => ({
  ...PRESETS.ben.setup, ...structuredClone(KNOB_DEFAULTS), ...setup,
});

/** The keys of `values` that differ from the defaults (blurRadius 0 is left to the package). */
function overrides<T extends Record<string, unknown>>(values: T, base: T): Partial<T> {
  const out: Partial<T> = {};
  for (const k of Object.keys(values) as (keyof T)[]) {
    if (values[k] !== base[k] && !(k === 'blurRadius' && values[k] === 0)) out[k] = values[k];
  }
  return out;
}

/** What the shell sees of a pane. */
export interface PaneApi {
  name: PaneName;
  /** One frame of the example (its own animate()). */
  step(): void;
  getPose(): Pose;
  setPose(pose: Pose): void;
  apply(cfg: PaneConfig): void;
  setView(view: View): void;
  setOrbit(on: boolean, speed: number): void;
  loadModel(name: string): void;
  model(): string;
  models(): string[];
  reset(): void;
  inspect(on: boolean): void;
  /** Ben's settings, linked between panes: apply a change another pane's Inspector made. */
  applyParam(path: string, value: unknown): void;
  /** GPU ms of our passes (timestamp queries), null when this pane runs none of ours. */
  oursMs(): number | null;
}
export interface Pose { p: number[]; q: number[]; t: number[] }

/** What a pane sees of the shell (window.parent.__labHost). */
interface Host {
  register(api: PaneApi): void;
  leads(name: PaneName): boolean;
  lead(name: PaneName): void;
  key(e: KeyboardEvent): void;
  param(from: PaneName, path: string, value: unknown): void;
}
const host: Host | null = (() => {
  try { return window.parent !== window ? (window.parent as any).__labHost ?? null : null; } catch { return null; }
})();
const paneName = (['A', 'B', 'C'].includes(window.name) ? window.name : 'A') as PaneName;

// ---- Ben's Inspector settings, linked between panes -----------------------------------------------------------------
// Every editor the example adds is recorded under its folder path and property. A change the user makes in one pane's
// Inspector is sent to the shell, which applies it to the same editor in the other panes (setValue dispatches the
// editor's change event, which sets the property and runs the example's onChange, as a user edit would).
const editors = new Map<string, any>();
let userEditor: any = null;

/** Wrap the Inspector before the example builds its settings (interior.js calls this as it creates it). */
export function linkInspector<T>(inspector: T): T {
  const ins = inspector as any;
  const createParameters = ins.createParameters.bind(ins);
  ins.createParameters = (name: string) => wrapGroup(createParameters(name), name);
  return inspector;
}

function wrapGroup(group: any, path: string): any {
  const add = group.add.bind(group);
  const addFolder = group.addFolder.bind(group);
  group.add = (object: any, property: string, ...rest: any[]) => {
    const editor = add(object, property, ...rest);
    if (!editor || typeof object[property] === 'function') return editor;
    let key = `${path}/${property}`;
    while (editors.has(key)) key += "'";
    editors.set(key, editor);
    // only edits made by hand are sent: listen() and remote applies also dispatch change events
    const mark = () => { userEditor = editor; queueMicrotask(() => { if (userEditor === editor) userEditor = null; }); };
    for (const type of ['input', 'change', 'click']) editor.domElement?.addEventListener(type, mark, true);
    editor.addEventListener('change', (e: any) => { if (userEditor === editor) host?.param(paneName, key, e.value); });
    return editor;
  };
  group.addFolder = (name: string) => wrapGroup(addFolder(name), `${path}/${name}`);
  return group;
}

// ---- the pane --------------------------------------------------------------------------------------------------------
export function createPane(ctx: any) {
  const { THREE } = ctx;
  let cfg: PaneConfig = paneConfig(PRESETS[paneName === 'A' ? 'ben' : paneName === 'B' ? 'ours' : 'upscaler'].setup);
  let view: View = 'beauty';

  const debugWeight = uniform(1); // keeps the scene pass (and the SSR lighting history) alive under the debug views
  const finite = (v: N) => select(v.greaterThanEqual(0).and(v.lessThan(6e4)), v, float(0));
  const finite3 = (v: N) => vec3(finite(v.x), finite(v.y), finite(v.z));
  const pre = () => ctx.prePass;

  // ---- shared inputs (built once) ------------------------------------------------------------------------------------
  let inputs: Record<string, N> | null = null;
  const shared = () => inputs ??= (() => {
    const nr = pre().getTextureNode();
    const rad = () => ctx.ssrRadiance.sample(uv());
    const cov = () => ctx.ssrCoverage.sample(uv());
    const gi = () => ctx.ssgiPass.getGINode().sample(uv());
    const hit = rad().a;
    return {
      depth: pre().getTextureNode('depth'),
      motion: pre().getTextureNode('velocity'),
      normal: worldNormalTexture(nr, { camera: ctx.camera, normalSpace: 'view', normalEncoding: 'packed' }),
      viewNormal: sample((u: N) => unpackRGBToNormal(pre().getTextureNode().sample(u).rgb)),
      roughness: convertToTexture(vec4(nr.a, 0, 0, 1)),
      // misses carry Ben's 1e4 sentinel; ours take 0 = miss
      hit: convertToTexture(vec4(select(hit.greaterThan(0).and(hit.lessThan(1e3)), hit, float(0)), 0, 0, 1)),
      resolved: convertToTexture(vec4(finite3(ctx.indirectSpecularRaw.sample(uv()).rgb), 1)),
      premul: convertToTexture(vec4(finite3(rad().rgb.mul(cov())), 1)),
      cov: convertToTexture(vec4(vec3(cov().clamp(0, 1)), 1)),
      giPremul: convertToTexture(vec4(finite3(gi().rgb.mul(gi().a)), 1)),
      giCov: convertToTexture(vec4(vec3(gi().a.clamp(0, 1)), 1)),
    };
  })();

  // ---- our denoisers: one stable node per role; options rebuild the denoiser, not the graph -------------------------
  type Role = 'spec-before' | 'spec-main' | 'spec-cov' | 'diff-main' | 'diff-cov';
  const nodes = new Map<Role, N>();
  let device: GPUDevice | null = null;

  function makeDenoiser(d: GPUDevice, role: Role) {
    device = d;
    const timestamps = { timestamps: true };
    const svgf = { filter: 'svgf', ...overrides(cfg.svgf, KNOB_DEFAULTS.svgf), ...timestamps } as any;
    const recurrent = { filter: 'recurrent', ...overrides(cfg.recurrent, KNOB_DEFAULTS.recurrent), ...timestamps } as any;
    if (role.startsWith('diff')) {
      const { virtualMotion: _specularOnly, ...diffuse } = recurrent;
      return new DiffuseDenoiser(d, cfg.diff === 'recurrent' ? diffuse : svgf);
    }
    if (cfg.spec === 'ffx') return new FfxReflectionDenoiser(d, { ...overrides(cfg.ffx, KNOB_DEFAULTS.ffx), ...timestamps });
    return new SpecularDenoiser(d, cfg.spec === 'recurrent' ? recurrent : svgf);
  }

  function ours(role: Role): N {
    let n = nodes.get(role);
    if (n) return n;
    const s = shared();
    const radiance = { 'spec-before': s.resolved, 'spec-main': s.premul, 'spec-cov': s.cov, 'diff-main': s.giPremul, 'diff-cov': s.giCov }[role];
    const spec = role.startsWith('spec');
    n = temporalDenoise(
      (d: GPUDevice) => makeDenoiser(d, role) as any,
      spec ? { radiance, hitDistance: s.hit } : { radiance },
      { depth: s.depth, normal: s.normal, motion: s.motion, ...(spec ? { roughness: s.roughness } : {}) },
      ctx.camera,
    );
    n.getOutputNode(0).toInspector(`Lab: ${role}`);
    nodes.set(role, n);
    return n;
  }

  /**
   * Replace our denoisers (new options or another of our filters) without touching the render graph: the nodes stay,
   * their denoiser is recreated and reconfigured on the next frame (history starts over).
   * TemporalDenoiseNode has no public hook for this; the lab reaches into it.
   */
  function rebuildOurs(which: 'spec' | 'diff' | 'all' = 'all') {
    if (!device) return;
    for (const [role, n] of nodes) {
      if (which !== 'all' && !role.startsWith(which)) continue;
      const node = n as any;
      if (!node._denoiser) continue;
      node._denoiser.dispose();
      node._denoiser = node.create(device);
      node._width = node._height = 0;
    }
  }

  // ---- Ben's coverage node (own instances, so the knobs can differ between panes) --------------------------------------
  const coverageNodes = new Map<'spec' | 'diff', N>();
  function coverage(signal: 'spec' | 'diff'): N {
    let n = coverageNodes.get(signal);
    if (n) return n;
    const ben = signal === 'spec' ? ctx.ssrCoverageDenoise : ctx.ssgiDenoise;
    n = coverageDenoise(ben.inputNode, ctx.camera, {
      depth: ben.depthNode, normal: ben.normalNode, velocity: ben.velocityNode,
      ...(signal === 'spec' ? { hitDistance: ben.hitDistanceNode } : {}),
    });
    coverageNodes.set(signal, n);
    applyLiveKnobs();
    return n;
  }

  // ---- three's DenoiseNode (the upscaler kitchen sink's denoiser): premultiplied signal + coverage in one RGBA ---------
  const spatialNodes = new Map<'spec' | 'diff', { node: N; texture: N }>();
  function spatial(signal: 'spec' | 'diff'): N {
    let entry = spatialNodes.get(signal);
    if (!entry) {
      const s = shared();
      const input = signal === 'spec'
        ? vec4(s.premul.sample(uv()).rgb, s.cov.sample(uv()).r)
        : vec4(s.giPremul.sample(uv()).rgb, s.giCov.sample(uv()).r);
      const node = denoise(input, s.depth, s.viewNormal, ctx.camera);
      // DenoiseNode is evaluated where it is used: render it to a screen texture, the providers sample it at screenUV
      entry = { node, texture: convertToTexture(node) };
      spatialNodes.set(signal, entry);
      applyLiveKnobs();
    }
    return entry.texture;
  }

  function applyLiveKnobs() {
    for (const n of coverageNodes.values()) {
      n.radius.value = cfg.coverage.radius;
      n.maxFrames.value = cfg.coverage.maxFrames;
      n.depthThreshold.value = cfg.coverage.depthThreshold;
      n.useGatherConfidence.value = cfg.coverage.gatherConfidence;
    }
    for (const { node } of spatialNodes.values()) {
      node.radius.value = cfg.spatial.radius;
      node.lumaPhi.value = cfg.spatial.lumaPhi;
      node.depthPhi.value = cfg.spatial.depthPhi;
      node.normalPhi.value = cfg.spatial.normalPhi;
    }
  }

  // ---- this pane's values ------------------------------------------------------------------------------------------
  const at = (n: N) => n.sample(screenUV);
  const isOurs = (k: SpecKind) => OURS.includes(k);
  const unpremul = (f: N) => vec4(f.rgb.div(f.a.max(1e-4)), f.a.clamp(0, 1));

  /** Unweighted radiance in rgb, coverage in a; `combined` when the buffer already holds the fallback (resolved). */
  function specValue(): { value: N; combined: boolean } {
    const covTotal = () => at(ctx.indirectSpecularCoverage);
    const resolved = (rgb: N) => ({ value: vec4(rgb.div(covTotal().max(1e-4)), covTotal()), combined: true });
    switch (cfg.spec) {
      case 'off': return { value: vec4(0), combined: false };
      case 'raw': return resolved(at(ctx.indirectSpecularRaw).rgb);
      case 'r186': return resolved(at(ctx.ssrDenoise.getTextureNode()).rgb);
      case 'spatial': return { value: unpremul(at(spatial('spec'))), combined: false };
      case 'coverage': {
        const f = at(coverage('spec').getTextureNode());
        return { value: vec4(f.rgb, f.a), combined: false };
      }
      default: {
        if (cfg.contract === 'before') return resolved(at(ours('spec-before').getOutputNode(0)).rgb);
        const m = at(ours('spec-main').getOutputNode(0));
        const k = at(ours('spec-cov').getOutputNode(0)).r.clamp(0, 1);
        return { value: vec4(m.rgb.div(k.max(1e-4)), k), combined: false };
      }
    }
  }

  function diffValue(): N {
    switch (cfg.diff) {
      case 'off': return vec4(0);
      case 'raw': return at(ctx.ssgiPass.getGINode());
      case 'spatial': return unpremul(at(spatial('diff')));
      case 'coverage': return at(coverage('diff').getTextureNode());
      default: {
        const m = at(ours('diff-main').getOutputNode(0));
        const k = at(ours('diff-cov').getOutputNode(0)).r.clamp(0, 1);
        return vec4(m.rgb.div(k.max(1e-4)), k);
      }
    }
  }

  // ---- hooks called by interior.js -----------------------------------------------------------------------------------
  function ssrProvider() {
    const v = specValue().value;
    return (query: N) => vec4(v.rgb, v.a.mul(ctx.matchesSSRQuery(query)));
  }

  function filterSpecularFallback(providers: N[]) {
    // where this pane's buffer already contains the fallback for the base lobe, the chain must not add it again
    if (!specValue().combined) return providers;
    return providers.map((provider) => (query: N) => {
      const value = provider(query);
      return vec4(value.rgb, value.a.mul(ctx.matchesSSRQuery(query).not()));
    });
  }

  function ssgiProvider() {
    const v = diffValue();
    return ({ normal }: N) => {
      const baseNormal = unpackRGBToNormal(at(pre().getTextureNode()).rgb).transformDirection(cameraWorldMatrix);
      return vec4(v.rgb, v.a.mul(normal.dot(baseNormal).greaterThan(0.999)));
    };
  }

  /** Resolved incoming specular, as the material sees it for the base lobe. */
  function specResolved(): N {
    const { value, combined } = specValue();
    const lit = value.rgb.mul(value.a);
    return combined ? lit : lit.add(at(pre().getTextureNode('fallback')).rgb.mul(value.a.oneMinus()));
  }

  // ---- resolver: TRAA (the example's), FSR3, or none -------------------------------------------------------------------
  let fsr: N = null;
  function fsrNode(): N {
    // ratio 1: FSR3 only anti-aliases and accumulates, at the example's own render size (like TRAA)
    fsr ??= upscale(ctx.scenePass.getTextureNode('output'), pre().getTextureNode('depth'), pre().getTextureNode('velocity'), ctx.camera, { path: 'temporal', ratio: 1 });
    return fsr;
  }
  function releaseFsr() {
    if (!fsr) return;
    fsr.dispose();
    fsr = null;
    // upscale() pins three's velocity node to its unjittered projection while it owns the jitter; TRAA wants it back
    (velocity as any).setProjectionMatrix(null);
  }

  const keep = (n: N) => mix(ctx.scenePass, n, debugWeight);

  function applyOutput(): boolean {
    if (view === 'beauty') {
      if (ctx.params.output !== 'Beauty' || cfg.resolve === 'traa') { releaseFsr(); return false; }
      if (cfg.resolve === 'none') releaseFsr();
      ctx.renderPipeline.outputNode = cfg.resolve === 'fsr' ? fsrNode() : ctx.scenePass;
      ctx.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      ctx.renderPipeline.needsUpdate = true;
      return true;
    }
    releaseFsr();
    const radianceView = ['specular', 'ssgi', 'input', 'input-ssgi'].includes(view);
    let out: N;
    switch (view) {
      case 'specular': out = specResolved(); break;
      case 'ssr-coverage': out = vec3(specValue().value.a); break;
      case 'ssgi': { const v = diffValue(); out = v.rgb.mul(v.a); break; }
      case 'input': out = at(ctx.indirectSpecularRaw).rgb; break;
      case 'input-ssgi': { const g = at(ctx.ssgiPass.getGINode()); out = g.rgb.mul(g.a); break; }
      case 'hit': { const h = at(ctx.ssrRadiance).a; out = vec3(select(h.lessThan(1e3), h.div(h.add(1)), float(1))); break; }
      default: return false;
    }
    // background pixels have no surface to light (the debug buffers hold whatever the clear left there)
    const surface = at(pre().getTextureNode('depth')).r.lessThan(1);
    ctx.renderPipeline.outputNode = keep(vec4(select(surface, out, vec3(0)), 1));
    ctx.renderer.toneMapping = radianceView ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping;
    ctx.renderPipeline.needsUpdate = true;
    return true;
  }

  function reset() {
    for (const n of nodes.values()) n.resetHistory();
    for (const n of coverageNodes.values()) n.reset();
    fsr?.upscaler?.resetHistory();
  }

  // ---- config changes ------------------------------------------------------------------------------------------------
  function apply(next: PaneConfig) {
    const prev = cfg;
    cfg = structuredClone(next);
    // our filters swap inside the same nodes; anything else changes which nodes are in the graph
    const specSwap = cfg.spec !== prev.spec && isOurs(cfg.spec) && isOurs(prev.spec) && cfg.contract === prev.contract;
    const diffSwap = cfg.diff !== prev.diff && ['svgf', 'recurrent'].includes(cfg.diff) && ['svgf', 'recurrent'].includes(prev.diff);
    const graphChange = (cfg.spec !== prev.spec && !specSwap) || cfg.contract !== prev.contract || (cfg.diff !== prev.diff && !diffSwap);
    const same = (k: keyof PaneConfig) => JSON.stringify(cfg[k]) === JSON.stringify(prev[k]);
    const specKnobs = (cfg.spec === 'ffx' && !same('ffx')) || !same('svgf') || !same('recurrent');
    if (specSwap || (!graphChange && specKnobs)) rebuildOurs('spec');
    if (diffSwap || (!graphChange && (!same('svgf') || !same('recurrent')))) rebuildOurs('diff');
    applyLiveKnobs();
    if (graphChange) ctx.updateIndirectLighting();
    else if (cfg.resolve !== prev.resolve) ctx.updateOutput();
  }

  // ---- per frame -----------------------------------------------------------------------------------------------------
  function frame() {
    const u = fsr?.upscaler;
    if (u) {
      u.settings.rcasDenoise = cfg.fsr.rcasDenoise;
      u.settings.debugView = cfg.fsr.debugView;
    }
  }

  function oursMs(): number | null {
    let total = 0, known = false;
    for (const [role, n] of nodes) {
      if (!isActive(role)) continue;
      const ms = n.denoiser?.gpuTimings?.get('total');
      if (typeof ms === 'number') { total += ms; known = true; }
    }
    return known ? total : null;
  }
  function isActive(role: Role) {
    if (role.startsWith('diff')) return cfg.diff === 'svgf' || cfg.diff === 'recurrent';
    if (!isOurs(cfg.spec)) return false;
    return role === 'spec-before' ? cfg.contract === 'before' : cfg.contract === 'twin';
  }

  // ---- the shell's handle ------------------------------------------------------------------------------------------------
  let animate: () => void = () => {};
  const api: PaneApi = {
    name: paneName,
    step: () => animate(),
    getPose: () => ({ p: ctx.camera.position.toArray(), q: ctx.camera.quaternion.toArray(), t: ctx.controls.target.toArray() }),
    setPose(pose) {
      ctx.camera.position.fromArray(pose.p);
      ctx.camera.quaternion.fromArray(pose.q);
      ctx.controls.target.fromArray(pose.t);
    },
    apply,
    setView(v) { view = v; ctx.updateOutput(); },
    setOrbit(on, speed) { ctx.controls.autoRotate = on; ctx.controls.autoRotateSpeed = speed; },
    loadModel(name) {
      if (ctx.params.model === name) return;
      ctx.params.model = name;
      ctx.loadModel();
    },
    model: () => ctx.params.model,
    models: () => Object.keys(ctx.models),
    reset: () => ctx.resetScreenSpaceLighting(),
    inspect(on) { ctx.renderer.inspector?.setVisible?.(on); },
    applyParam(path, value) {
      const editor = editors.get(path);
      if (editor && editor.getValue() !== value) editor.setValue(value);
    },
    oursMs,
  };

  /** interior.js hands over its frame function: the shell drives it, or (standalone) the renderer's own loop. */
  function hostLoop(fn: () => void) {
    animate = fn;
    if (!host) { ctx.renderer.setAnimationLoop(fn); return; }
    ctx.renderer.setAnimationLoop(null);
    const canvas: HTMLCanvasElement = ctx.renderer.domElement;
    for (const type of ['pointerdown', 'wheel']) canvas.addEventListener(type, () => host.lead(paneName), { capture: true, passive: true });
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.closest?.('input, select, textarea')) return;
      host.key(e);
    });
    api.inspect(false);
    host.register(api);
  }

  /** Followers take the leader's camera; only the leader runs OrbitControls (its damping, its auto-rotate). */
  const leads = () => !host || host.leads(paneName);

  (window as any).__pane = { api, get cfg() { return cfg; }, nodes, coverageNodes, spatialNodes, get fsr() { return fsr; } };

  return { ssrProvider, ssgiProvider, filterSpecularFallback, applyOutput, reset, frame, hostLoop, leads };
}
