// What the interior lab shows next to each pane: one card per denoiser path, per input contract and per resolver,
// the pane presets and the guided experiments. Pure data (shell.ts renders it, pane.ts builds what it names).
//
// The "expect" lines are things to check on the bench, not measured results: the bench is for looking, the
// test bed (docs/research/rt-denoiser) is for numbers. Descriptions of Ben Houston's nodes come from his PR
// description and review comments (mrdoob/three.js#35228) and from how his example wires them; the copy in his
// webgpu_preview_interior branch differs slightly from the PR.

export type SpecKind = 'off' | 'raw' | 'spatial' | 'coverage' | 'r186' | 'ffx' | 'svgf' | 'recurrent';
export type DiffKind = 'off' | 'raw' | 'spatial' | 'coverage' | 'svgf' | 'recurrent';
/** How SSR reaches one of our denoisers (Ben's nodes have a fixed contract). */
export type Contract = 'before' | 'twin';
/** What turns the denoised frame into the displayed one: the temporal anti-aliasing / convergence stage. */
export type Resolve = 'traa' | 'fsr' | 'none';
export type View = 'beauty' | 'specular' | 'ssr-coverage' | 'ssgi' | 'input' | 'input-ssgi' | 'hit';
export type PaneName = 'A' | 'B' | 'C';

/** Our denoisers, the ones the lab drives through denoiser/three. */
export const OURS: readonly SpecKind[] = ['ffx', 'svgf', 'recurrent'];

export interface Card {
  label: string;
  /** Who wrote it / where it lives. */
  origin: string;
  /** Pass order, one frame. */
  passes: string[];
  /** What it expects as input and what it hands back. */
  contract: string;
  pros: string[];
  cons: string[];
  /** Knobs worth turning on the bench (names as in the GUI). */
  knobs?: string;
}

export const SPEC_LABELS: Record<SpecKind, string> = {
  off: 'Off (fallback only)',
  raw: 'Raw (no denoiser)',
  spatial: 'three DenoiseNode (spatial only)',
  coverage: 'Ben: CoverageDenoiseNode',
  r186: 'three r186: TemporalReproject + Recurrent',
  ffx: 'Ours: FidelityFX Reflections',
  svgf: 'Ours: realtime SVGF',
  recurrent: 'Ours: realtime recurrent',
};

export const DIFF_LABELS: Record<DiffKind, string> = {
  off: 'Off (fallback only)',
  raw: 'Raw (no denoiser)',
  spatial: 'three DenoiseNode (spatial only)',
  coverage: 'Ben: CoverageDenoiseNode',
  svgf: 'Ours: realtime SVGF (coverage twin)',
  recurrent: 'Ours: realtime recurrent (coverage twin)',
};

export const CONTRACT_LABELS: Record<Contract, string> = {
  before: 'Resolve before (SSR + fallback, one radiance)',
  twin: 'Resolve after (premultiplied SSR + coverage twin)',
};

export const SPEC_CARDS: Record<SpecKind, Card> = {
  off: {
    label: SPEC_LABELS.off,
    origin: 'baseline',
    passes: ['no SSR: reflection probes / PMREM environment only'],
    contract: 'nothing screen-space; the material\'s fallback chain answers every specular query',
    pros: ['noise-free, stable', 'shows what SSR is supposed to add'],
    cons: ['no contact reflections, no moving objects in reflections'],
  },
  raw: {
    label: SPEC_LABELS.raw,
    origin: 'Ben\'s SSR trace, resolved with the fallback, not filtered',
    passes: ['SSR trace (1-2 rays / px, FAST or white noise)', 'resolve: ssr · coverage + fallback · (1 - coverage)'],
    contract: 'the exact signal every "resolve before" denoiser on this page receives',
    pros: ['ground truth for "what did the denoiser remove or invent"'],
    cons: ['noisy everywhere the lobe is wider than a mirror'],
  },
  spatial: {
    label: SPEC_LABELS.spatial,
    origin: 'three.js addon DenoiseNode, as the upscaler\'s 09-kitchen-sink uses it (one per signal, no history)',
    passes: [
      'one Poisson-disc gather (16 taps, rotated per pixel), weighted by depth, normal and luma similarity',
      'no temporal stage of its own: the resolver after it (FSR3 in the kitchen sink) does all the accumulating',
    ],
    contract: 'here: premultiplied SSR + coverage in one RGBA, divided afterwards; the fallback fills (1 - coverage)',
    pros: [
      'no history, so nothing to reproject, lag or ghost, and nothing to fight a jittered resolver (upscaler #10)',
      'cheap, one pass',
    ],
    cons: [
      'the per-frame result still carries noise: convergence is entirely the resolver\'s job',
      'a fixed radius blurs mirror detail and leaves rough lobes grainy',
    ],
    knobs: 'Spatial ▸ radius, lumaPhi, depthPhi, normalPhi (live)',
  },
  coverage: {
    label: SPEC_LABELS.coverage,
    origin: 'Ben Houston, mrdoob/three.js#35228 (TSL, runs in three\'s render graph)',
    passes: [
      'spatial: one 3x3 edge-aware pass (plane distance, normal, roughness, hit distance), stride ∝ √roughness',
      'temporal: long history clamped to a short fast history, anti-lag; surface + virtual-hit reprojection',
      '(the example then upsamples and TRAA resolves the frame)',
    ],
    contract: 'in: SSR radiance (unweighted) + coverage. out: radiance + filtered coverage; the fallback fills (1 - coverage) afterwards',
    pros: [
      'fallback never enters the filter: probe / environment detail stays sharp and has no history to lag',
      'misses can\'t darken hits: coverage is filtered as its own channel',
      'cheap: one tiny spatial pass; works because the FAST noise is optimised for exactly this filter',
    ],
    cons: [
      '3x3 footprint: relies on FAST noise and on near-mirror lobes; rough lobes and white noise stay grainy',
      'tuned as a system (noise + filter + TRAA); swapping any part changes the balance',
    ],
    knobs: 'Coverage ▸ radius, max frames, depth threshold, gather confidence (live)',
  },
  r186: {
    label: SPEC_LABELS.r186,
    origin: 'three.js r186 SSR denoise example (TemporalReprojectNode + RecurrentDenoiseNode), wired as in Ben\'s "Before filtering" mode',
    passes: [
      'temporal reproject (hit-point reprojection) of the resolved signal',
      'recurrent spatial blur; its output is fed back as next frame\'s history',
    ],
    contract: 'in: resolved radiance (SSR + fallback). out: resolved radiance',
    pros: ['what three users have today: the baseline Ben replaced'],
    cons: [
      'spatial output feeds the history (recurrence): blur compounds over frames',
      'the fallback is filtered together with the noise',
    ],
    knobs: 'Ben\'s own: SSR Settings ▸ History Frames / Denoise Radius / Denoise Samples (Inspect the pane)',
  },
  ffx: {
    label: SPEC_LABELS.ffx,
    origin: 'our WGSL port of AMD FidelityFX reflection denoiser 1.1.4 (MIT), denoiser/ffx',
    passes: [
      'reproject: history fetched at the reflected hit (ray length), sample count, 8x8 average radiance',
      'prefilter: spatial, weighted by variance',
      'resolve temporal: clip the history to a box around the neighbourhood (temporalStabilityFactor)',
    ],
    contract: 'in: one radiance per pixel, misses already resolved (FFX SSSR samples the environment inside its trace). out: radiance',
    pros: [
      'virtual-hit reprojection: reflections track their parallax under camera motion',
      'battle-tested design, small and predictable',
    ],
    cons: [
      'one history + clip box: the classic stability vs ghosting trade-off (one knob)',
      'designed for glossy SSR; not a GI denoiser',
    ],
    knobs: 'FFX ▸ temporalStabilityFactor, currentFrameStatistics (rebuilds the denoiser)',
  },
  svgf: {
    label: SPEC_LABELS.svgf,
    origin: 'denoiser/realtime, clean-room from the SVGF / A-SVGF papers (Schied et al. 2017, 2018); the package default',
    passes: [
      'temporal: accumulate along surface motion, luminance moments',
      'variance estimate (spatial while history is young)',
      'à-trous ×N: wide edge-aware wavelet filter (depth, normal, luminance variance)',
      'anti-lag (\'auto\'): temporal gradients shorten the history where the signal changed',
    ],
    contract: 'in: one radiance (demodulated) per pixel. out: radiance. Here: either contract',
    pros: [
      'wide footprint: holds up on rough lobes and white noise',
      'the same filter serves diffuse GI and AO',
      'anti-lag reacts to lighting changes',
    ],
    cons: [
      'reprojects along the surface only: mirror reflections smear under camera motion',
      'temporal before spatial: a 1-frame disocclusion is filtered from a 1-sample history',
      'more passes, more memory than a 3x3 + EMA',
    ],
    knobs: 'SVGF ▸ atrousIterations, temporalAlpha, antiLag, feedback (rebuilds the denoiser)',
  },
  recurrent: {
    label: SPEC_LABELS.recurrent,
    origin: 'denoiser/realtime filter \'recurrent\', our own design from public papers and talks (provisional)',
    passes: [
      'pre-blur', 'temporal: surface + virtual-motion blend, fast history (anti-lag)',
      'history fix (young pixels)', 'blur', 'post-blur (next frame\'s history)', 'stabilize (output)',
    ],
    contract: 'in: radiance + hit distance. out: radiance. Here: either contract',
    pros: [
      'virtual motion for specular, like FFX and Ben\'s node',
      'fast history: anti-lag without a gradient pass',
      'spatial passes on both sides of the temporal one',
    ],
    cons: ['most passes and knobs of the lot', 'provisional: defaults still moving'],
    knobs: 'Recurrent ▸ virtualMotion, maxAccumulatedFrames, fastFrames, blurRadius (rebuilds the denoiser)',
  },
};

export const DIFF_CARDS: Record<DiffKind, Card> = {
  off: { ...SPEC_CARDS.off, passes: ['no SSGI: light maps / probes / environment only'] },
  raw: { ...SPEC_CARDS.raw, passes: ['SSGI (horizon-based slices), coverage in alpha', 'not filtered'] },
  spatial: { ...SPEC_CARDS.spatial, contract: 'premultiplied irradiance + coverage in one RGBA, divided afterwards' },
  coverage: {
    ...SPEC_CARDS.coverage,
    passes: ['same node as for SSR, without hit distance or roughness guides: surface reprojection only'],
  },
  svgf: { ...SPEC_CARDS.svgf, contract: 'premultiplied irradiance and coverage, each denoised by its own SVGF with the same options, divided afterwards' },
  recurrent: { ...SPEC_CARDS.recurrent, contract: 'premultiplied irradiance and coverage, each denoised by its own recurrent filter, divided afterwards' },
};

export const CONTRACT_CARDS: Record<Contract, { label: string; text: string; pros: string[]; cons: string[] }> = {
  before: {
    label: CONTRACT_LABELS.before,
    text: 'radiance = ssr · coverage + fallback · (1 - coverage), then denoise. What FidelityFX SSSR does.',
    pros: ['any single-signal denoiser works unchanged', 'one history'],
    cons: ['the noise-free fallback goes through the filter: blurred and lagging', 'hit / miss edges are averaged as radiance'],
  },
  twin: {
    label: CONTRACT_LABELS.twin,
    text: 'denoise ssr · coverage and coverage with two instances of the same denoiser, divide, add the fallback after. Our stand-in for Ben\'s contract.',
    pros: ['fallback stays sharp, like Ben\'s node', 'compares filters with the contract held equal'],
    cons: ['two independent histories can disagree (halos at hit / miss edges)', 'twice the cost'],
  },
};

export const RESOLVE_LABELS: Record<Resolve, string> = {
  traa: 'TRAA (Ben\'s example)',
  fsr: 'FSR3 temporal (@pmndrs/upscaler, native AA)',
  none: 'None (no AA, no jitter)',
};

export const RESOLVE_CARDS: Record<Resolve, Card> = {
  traa: {
    label: RESOLVE_LABELS.traa,
    origin: 'three.js TRAANode, as Ben\'s example wires it (useSubpixelCorrection off)',
    passes: [
      'before the frame: Halton sub-pixel jitter on the camera; every pass renders jittered (pre-pass, SSR, SSGI, scene)',
      'after: reproject the history by velocity, clip it to the current 3x3 neighbourhood, blend ≥ 5 % of the new frame',
    ],
    contract: 'in: the lit frame, depth, velocity. out: the displayed frame',
    pros: ['cheap, standard, anti-aliases the whole frame', 'the jitter lets it resolve detail finer than a pixel'],
    cons: [
      'the clip box comes from the current frame: noise the denoiser leaves behind that changes every frame moves the box, and it is let through rather than averaged',
      'its jitter moves every guide the denoisers see by a sub-pixel each frame: they run a second temporal stage that does not know about it (upscaler #10)',
    ],
  },
  fsr: {
    label: RESOLVE_LABELS.fsr,
    origin: '@pmndrs/upscaler upscale() (FSR2/3-style, WGSL), the convergence stage of the upscaler\'s 09-kitchen-sink; ratio 1 here, so it only anti-aliases',
    passes: [
      'before the frame: its own Halton jitter; motion vectors stay jitter-free (it pins the velocity node to the unjittered projection)',
      'reconstruct + accumulate with per-pixel age, locks on thin features, disocclusion and shading-change detection',
      'RCAS sharpen (its denoise variant keeps the sharpen from amplifying grain)',
    ],
    contract: 'in: the lit frame, depth, velocity. out: the displayed frame',
    pros: [
      'longer, per-pixel accumulation: residual noise converges instead of flickering through',
      'meant to be the only temporal stage: pairs with spatial-only denoisers (09)',
      'debug views (accumulation age, disocclusion, locks) show what it trusts',
    ],
    cons: [
      'a temporal denoiser in front of it fights its jitter the same way (upscaler #10)',
      'more passes than TRAA; ghosting on fast motion where the noise widened its clamp',
    ],
    knobs: 'FSR3 ▸ RCAS denoise, debug view',
  },
  none: {
    label: RESOLVE_LABELS.none,
    origin: 'the scene pass as it is',
    passes: ['no jitter, no history: the denoised frame is displayed directly'],
    contract: 'n/a',
    pros: ['shows how stable the denoiser is on its own', 'the guides do not move: no jitter for the denoisers to fight'],
    cons: ['aliased edges', 'whatever the denoiser leaves, you see'],
  },
};

/** One pane's denoisers and resolver (knobs live in pane.ts). */
export interface PaneSetup { spec?: SpecKind; contract?: Contract; diff?: DiffKind; resolve?: Resolve }

export const PRESETS: Record<string, { label: string; setup: Required<PaneSetup> }> = {
  ben: { label: 'Ben\'s PR: coverage nodes + TRAA', setup: { spec: 'coverage', contract: 'twin', diff: 'coverage', resolve: 'traa' } },
  ours: { label: 'Ours: SVGF (coverage twin) + TRAA', setup: { spec: 'svgf', contract: 'twin', diff: 'svgf', resolve: 'traa' } },
  upscaler: { label: 'Upscaler 09: spatial DenoiseNode + FSR3', setup: { spec: 'spatial', contract: 'twin', diff: 'spatial', resolve: 'fsr' } },
};
export const DEFAULT_PANES: Record<PaneName, keyof typeof PRESETS> = { A: 'ben', B: 'ours', C: 'upscaler' };

export interface Lesson {
  id: string;
  title: string;
  model?: string;
  /** Two or three panes; each starts from Ben's preset. */
  panes: PaneSetup[];
  view: View;
  orbit?: boolean;
  /** What to do and what to look for. */
  steps: string[];
}

export const LESSONS: Lesson[] = [
  {
    id: 'converge', title: '1. Who converges: the denoiser or the resolver?', model: 'Space Ship Hallway',
    panes: [{ resolve: 'none' }, { resolve: 'traa' }, { resolve: 'fsr' }], view: 'beauty',
    steps: [
      'All three panes run Ben\'s denoisers. Only the last stage differs: none, TRAA, FSR3.',
      'Hold the camera still. A shows what the denoisers alone leave; B and C show how much of the remaining flicker each resolver removes.',
      'Then orbit (O): the resolvers trade that stability for ghosting.',
    ],
  },
  {
    id: 'recipes', title: '2. Three recipes: Ben, ours, the upscaler', model: 'Space Ship Hallway',
    panes: [PRESETS.ben.setup, PRESETS.ours.setup, PRESETS.upscaler.setup], view: 'beauty', orbit: true,
    steps: [
      'A: Ben\'s PR (temporal coverage denoisers, then TRAA). B: our SVGF in the same place. C: the upscaler\'s 09 recipe: spatial only, FSR3 does all the accumulating.',
      'Compare the boil on rough surfaces and the sharpness of mirror reflections.',
      'Inspect a pane (Inspect) to read its passes\' cost in the Inspector\'s Performance tab.',
    ],
  },
  {
    id: 'jitter', title: '3. Two temporal stages vs one jitter (upscaler #10)', model: 'Space Ship Hallway',
    panes: [{ spec: 'recurrent', diff: 'svgf', resolve: 'none' }, { spec: 'recurrent', diff: 'svgf', resolve: 'traa' }, { spec: 'recurrent', diff: 'svgf', resolve: 'fsr' }],
    view: 'beauty',
    steps: [
      'Our recurrent (SSR) and SVGF (SSGI) in all three panes; camera still.',
      'A has no jitter: whatever boils there is the denoisers. B and C jitter every guide by a sub-pixel each frame.',
      'If B or C boils more than A on the same surface, the denoisers are losing history to the jitter.',
    ],
  },
  {
    id: 'input', title: '4. What the denoisers get', model: 'Primitives Floor (Metallic Mirror)',
    panes: [{ spec: 'raw' }, { spec: 'coverage' }, { spec: 'recurrent' }], view: 'specular',
    steps: [
      'A is the raw 1-2 ray SSR, already resolved with the probes / environment; B is Ben\'s filtered result, C ours.',
      'Noisy input view (Lab view) shows the same signal full screen. Mirror areas are almost clean, rough ones are pure noise.',
      'The debug views show the denoiser output before the resolver.',
    ],
  },
  {
    id: 'contract', title: '5. Same filter, two input contracts', model: 'Primitives Floor (Metallic Mirror)',
    panes: [{ spec: 'svgf', contract: 'before' }, { spec: 'svgf', contract: 'twin' }], view: 'specular', orbit: true,
    steps: [
      'Both panes run our SVGF. A mixes the fallback in first (FFX style), B filters SSR and coverage, then adds the fallback ("coverage based").',
      'Look where SSR misses: screen edges and behind objects. A blurs the probe reflection and drags it along; B keeps it crisp.',
      'Look at hit / miss edges in B: two histories that disagree show as halos. That is why Ben filters coverage inside one node.',
    ],
  },
  {
    id: 'parallax', title: '6. Reflection parallax: surface vs virtual motion', model: 'Primitives Floor (Metallic Mirror)',
    panes: [{ spec: 'svgf' }, { spec: 'recurrent' }, { spec: 'ffx', contract: 'before' }], view: 'specular', orbit: true,
    steps: [
      'The camera orbits. A mirror image moves differently from the floor it is seen in.',
      'SVGF (A) reprojects along the floor: reflected objects trail. Recurrent (B) and FFX (C) also reproject at the virtual hit.',
    ],
  },
  {
    id: 'fast', title: '7. Noise shaped for the filter (FAST)', model: 'Space Ship Hallway',
    panes: [{ spec: 'coverage' }, { spec: 'svgf' }], view: 'specular',
    steps: [
      'Ben\'s ray directions come from FAST blue noise optimised for a σ=1 Gaussian then an EMA at α≈0.1: his filter.',
      'Open SSR Settings ▸ Sampling (Inspect a pane; with Link Ben\'s settings on, all panes follow) and switch FAST Separate → Original (white noise).',
      'Which pane gets worse? A 3x3 pass only works when the noise is already high-frequency; à-trous has a wide footprint.',
    ],
  },
  {
    id: 'rough', title: '8. Rough reflections need a wider footprint', model: 'Primitives Floor (Color Rough)',
    panes: [{ spec: 'coverage' }, { spec: 'recurrent' }], view: 'specular',
    steps: [
      'Raise SSR Settings ▸ Max Roughness to 0.8 if it is lower.',
      'Hold the camera still for a few seconds, then move: compare the grain and how fast each pane recovers.',
    ],
  },
  {
    id: 'ffx', title: '9. Ben\'s node vs FidelityFX', model: 'Space Ship Hallway',
    panes: [{ spec: 'coverage' }, { spec: 'ffx', contract: 'before' }], view: 'beauty', orbit: true,
    steps: [
      'Both reproject at the virtual hit and run spatial before temporal. The difference: contract, footprint, history clamp.',
      'Turn FFX ▸ temporalStabilityFactor up and down on B: more stable, more ghosting.',
      'Use F to blink between the panes at the same spot.',
    ],
  },
  {
    id: 'r186', title: '10. What three ships today (r186)', model: 'Dungeon Warkarma',
    panes: [{ spec: 'r186' }, { spec: 'coverage' }], view: 'beauty', orbit: true,
    steps: ['A: the r186 SSR denoise chain Ben replaced. B: his PR.', 'Look for the dark, frozen noise and smear he describes in the PR.'],
  },
  {
    id: 'gi', title: '11. Diffuse GI: coverage vs SVGF vs spatial + FSR3', model: 'Cornell Box',
    panes: [{ diff: 'coverage' }, { diff: 'svgf' }, { diff: 'spatial', resolve: 'fsr' }], view: 'ssgi',
    steps: [
      'Same SSR everywhere; only the SSGI denoiser differs (and C\'s resolver; the SSGI view shows the denoiser output before it).',
      'GI noise is low frequency and covers the whole hemisphere: watch corners and contact shadows, then switch to Beauty and move the camera.',
    ],
  },
];

export const VIEW_LABELS: Record<View, string> = {
  beauty: 'Beauty (resolved; or the example\'s Output menu)',
  specular: 'Indirect specular (denoised, before the resolver)',
  'ssr-coverage': 'SSR coverage (filtered where the pane filters it)',
  ssgi: 'SSGI (irradiance × coverage, before the resolver)',
  input: 'Noisy input: SSR resolved',
  'input-ssgi': 'Noisy input: SSGI',
  hit: 'SSR hit distance (input)',
};
