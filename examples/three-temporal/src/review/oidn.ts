// OIDN 2 on the review bench (E-2b, docs/research/rt-denoiser/results/E2b-oidn-vs-svgf.md): a side whose `oidn.engine`
// option is an OIDN quality shows OIDN's single-frame output instead of the real-time filters.
//
// What runs: the `denoiser` package's single-image Denoiser on the WGSL runtime, through denoiser/three's denoise() node
// (one node and one Denoiser per signal, on the renderer's GPUDevice: no copies). Inputs as in the replay harness
// (tools/rt-capture/src/oidn-entries.ts): the same 1-ray signals both sides get, as HDR colour; the scalars (AO ĥ, shadow
// visibility) as grey colour through the HDR weights; aux = constant albedo 1 + the view-space normal (clean-aux
// `*_calb_cnrm` weights; OIDN takes normals in any consistent space). Quality fast / balanced / high = the small / base /
// large weights, fp32. Scalar outputs are the mean of OIDN's three channels.
//
// How it runs: OIDN is async and takes tens to hundreds of ms per signal, so the bench runs in LOCKSTEP while any side
// shows OIDN (src/review/main.ts): the frame is rendered offscreen (inputs + both sides' real-time filters advance one
// frame), then this side's driver pass runs (OIDN is requested on that frame's inputs; the side's unseen real-time nodes
// keep their history going), the loop waits for OIDN, then the same frame is presented (every per-frame node keeps its
// result: the node frame id is held). Motion therefore runs at OIDN's speed, and both sides always show the same frame.
// Only the signals on screen are denoised (lit = diffuse + specular + shadow + AO).
// The driver pass is separate from the output pass because the output pass would exceed 16 samplers per stage: the
// composite reads each OIDN result as one plain texture (`parts`, re-pointed after every run by `sync()`).
//
// The renderer's device has no subgroup-matrix feature, so OIDN runs its portable kernel here: the ms shown is not the
// cost number (the results doc has 1080p cost from the replay harness).
import * as THREE from 'three/webgpu';
import { float, vec3, vec4, unpackRGBToNormal, convertToTexture, select, uv, texture } from 'three/tsl';
import { denoise, type DenoiseNode } from 'denoiser/three';
import { WgslRuntime } from '../../../../packages/denoiser-wgsl/src/index';
import type { N } from '../realtime/scene';
import type { Kit, Parts } from './scenes';
import type { Signal } from './options';

export type OidnQuality = 'fast' | 'balanced' | 'high';
export type OidnSignal = 'dif' | 'spec' | 'ao' | 'vis';
const TZA_URL = '/tzas'; // served by vite.config.ts (packages/denoiser/tzas)

/** The aux inputs every OIDN node of the page shares (rendered every frame while a side shows OIDN). */
export interface OidnAux { albedo: N; normal: N; keep: N }

export function oidnAux(kit: Kit): OidnAux {
  const g = kit.guides;
  const sky = (g.depth as N).sample(uv()).r.greaterThanEqual(0.99999);
  const n = unpackRGBToNormal((g.normal as N).sample(uv()).rgb);
  const normal = convertToTexture(vec4(select(sky, vec3(0), n), 1)) as N;
  const albedo = convertToTexture(vec4(1, 1, 1, 1)) as N;
  return { albedo, normal, keep: normal.r.add(albedo.r).mul(0) };
}

export interface OidnSet {
  quality: OidnQuality;
  nodes: Record<OidnSignal, DenoiseNode & N>;
  /** What the composite reads: one plain texture per signal (black until the first result). */
  parts: Parts;
  /** Requests the signals shown for `sig` (they run on the next driver render); returns the nodes requested. */
  request(sig: Signal): (DenoiseNode & N)[];
  /** Points `parts` at the nodes' latest outputs (call after the runs settled). */
  sync(): void;
  /** (Re)builds the driver pass: the OIDN nodes + `extra` (the side's unseen real-time nodes, the aux inputs). */
  setDriver(extra: N): void;
  /** Renders the driver pass (into a 1x1 target): starts the requested runs, advances `extra`. */
  drive(renderer: THREE.WebGPURenderer): void;
  /** "OIDN high: diffuse 52 + ... ms" (wall ms of the last runs, awaited, portable kernel). */
  ms(): string;
  dispose(): void;
}

const SIGNALS_OF: Record<Signal, OidnSignal[]> = { lit: ['dif', 'spec', 'vis', 'ao'], diffuse: ['dif'], specular: ['spec'], ao: ['ao'], shadow: ['vis'] };
const LABEL: Record<OidnSignal, string> = { dif: 'diffuse', spec: 'specular', ao: 'AO', vis: 'shadow' };

export function buildOidn(kit: Kit, aux: OidnAux, quality: OidnQuality, onError: (e: unknown) => void): OidnSet {
  const mk = (color: N) => denoise(color, {
    albedo: aux.albedo, normal: aux.normal, hdr: true, quality, precision: 'fp32',
    runtime: (device: GPUDevice) => new WgslRuntime({ device, tzaUrl: TZA_URL }), onError,
  }) as DenoiseNode & N;
  const nodes: Record<OidnSignal, DenoiseNode & N> = {
    dif: mk(kit.inputs.dif),                    // demodulated diffuse radiance (rgb; .a = hit distance, ignored)
    spec: mk(kit.inputs.ssr),                   // SSR radiance, as both sides get it
    ao: mk(vec4(vec3(kit.noisy.ao), 1)),        // ĥ = h / (h + 1 + 0.05 depth), miss = 1: grey through the HDR weights
    vis: mk(vec4(vec3(kit.noisy.vis), 1)),      // 1-ray visibility, grey
  };
  const black = new THREE.Texture();
  const tex = { dif: texture(black), spec: texture(black), ao: texture(black), vis: texture(black) } as Record<OidnSignal, N>;
  const grey = (n: N) => n.r.add(n.g).add(n.b).div(3);
  const at = (k: OidnSignal) => tex[k].sample(uv());
  const parts: Parts = { dif: at('dif').rgb, spec: at('spec').rgb, ao: grey(at('ao')), vis: grey(at('vis')) };
  const all = Object.values(nodes).reduce((a: N, n: N) => a.add(n.r), float(0) as N).mul(0);
  const target = new THREE.RenderTarget(1, 1, { depthBuffer: false });
  let mat = new THREE.MeshBasicNodeMaterial();
  const quad = new THREE.QuadMesh(mat);
  const setDriver = (extra: N) => {
    const old = mat;
    mat = new THREE.MeshBasicNodeMaterial();
    mat.colorNode = vec4(all.add(extra), 0, 0, 1);
    quad.material = mat;
    old.dispose();
  };
  setDriver(float(0));
  return {
    quality, nodes, parts, setDriver,
    request(sig) { return SIGNALS_OF[sig].map((k) => nodes[k].request()); },
    sync() { for (const k of Object.keys(nodes) as OidnSignal[]) if (nodes[k].denoised && nodes[k].texture) tex[k].value = nodes[k].texture; },
    drive(renderer) {
      const prev = renderer.getRenderTarget();
      renderer.setRenderTarget(target);
      quad.render(renderer);
      renderer.setRenderTarget(prev);
    },
    ms() {
      const ran = (Object.keys(nodes) as OidnSignal[]).filter((k) => nodes[k].lastMs > 0);
      if (!ran.length) return `OIDN ${quality}: loading weights...`;
      return `OIDN ${quality}: ${ran.map((k) => `${LABEL[k]} ${nodes[k].lastMs.toFixed(0)}`).join(' + ')} ms (wall, last run)`;
    },
    dispose() { for (const n of Object.values(nodes)) n.dispose(); mat.dispose(); target.dispose(); },
  };
}
