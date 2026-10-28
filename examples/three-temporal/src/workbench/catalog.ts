// What the workbench names and explains: the denoisers and resolvers a pane can run, the views, the presets.
// Pure data (main.ts renders it). The "watch for" lines are things to look at on the bench, not measured results.

export type SpecKind = 'raw' | 'spatial' | 'ffx' | 'svgf' | 'recurrent' | 'combined-svgf' | 'combined-recurrent' | 'coverage';
export type DiffKind = 'raw' | 'spatial' | 'svgf' | 'recurrent' | 'coverage';
export type AoKind = 'raw' | 'spatial' | 'svgf' | 'coverage';
export type Resolve = 'fsr' | 'traa' | 'none';
export type Tracer = 'three' | 'ben';
export type View = 'beauty' | 'specular' | 'specular-input' | 'gi' | 'gi-input' | 'ao';

export interface Blurb { label: string; text: string; watch?: string }

export const SPEC: Record<SpecKind, Blurb> = {
  raw: { label: 'Raw (no denoiser)', text: 'One GGX sample per pixel: SSR where it hits, the probe in that direction where it misses. What every denoiser here starts from.' },
  spatial: {
    label: 'three DenoiseNode (spatial)',
    text: 'three.js\'s Poisson-disc bilateral filter, no history: the upscaler examples 09 / 10 recipe, where FSR3 does all the accumulating.',
    watch: 'Nothing to ghost or fight the jitter, but the per-frame noise is left to the resolver.',
  },
  ffx: {
    label: 'FidelityFX reflections (ours, port)',
    text: 'Our WGSL port of AMD\'s reflection denoiser 1.1.4: reproject at the reflected hit, spatial prefilter, temporal resolve clipped to the neighbourhood.',
    watch: 'Virtual-hit reprojection keeps mirror images attached under camera motion; the clip box trades stability for ghosting.',
  },
  svgf: {
    label: 'Realtime SVGF (ours)',
    text: 'denoiser/realtime\'s SVGF for specular: temporal accumulation with moments, variance-guided à-trous, anti-lag.',
    watch: 'Wide footprint holds up on rough lobes; reprojection along the surface.',
  },
  recurrent: {
    label: 'Realtime recurrent (ours)',
    text: 'denoiser/realtime\'s recurrent filter: pre-blur, surface + virtual-motion history with a fast history for anti-lag, history fix, blur, post-blur, stabilize.',
    watch: 'Our reflection denoiser: virtual motion like FFX, wider spatial support than FFX.',
  },
  'combined-svgf': {
    label: 'Realtime diffuse + specular, SVGF (ours)',
    text: 'DiffuseSpecularDenoiser: SSR and SSGI denoised together, one prepass, shared dispatches. The SSGI denoiser setting is ignored.',
  },
  'combined-recurrent': {
    label: 'Realtime diffuse + specular, recurrent (ours)',
    text: 'DiffuseSpecularDenoiser with the recurrent filter on both signals. The SSGI denoiser setting is ignored.',
  },
  coverage: {
    label: 'Ben: CoverageDenoiseNode (PR #35228)',
    text: 'One edge-aware 3×3 pass (tap spacing grows with √roughness), then a 16-frame history held inside a ~6-frame fast history\'s range, reset when they diverge. Surface + virtual-hit reprojection. Filters radiance and coverage; the probe fills 1 − coverage afterwards.',
    watch: 'With Ben\'s tracer it gets his coverage signal; with three\'s it gets our probe-filled signal at coverage 1.',
  },
};

export const DIFF: Record<DiffKind, Blurb> = {
  raw: { label: 'Raw (no denoiser)', text: 'three\'s SSGI as it comes: a few slices of horizon-based sampling per pixel.' },
  spatial: { label: 'three DenoiseNode (spatial)', text: 'The upscaler 10 "built-in" path: spatial only, FSR3 accumulates.' },
  svgf: { label: 'Realtime SVGF (ours)', text: 'DiffuseDenoiser, SVGF: temporal + variance-guided à-trous.' },
  recurrent: { label: 'Realtime recurrent (ours)', text: 'DiffuseDenoiser, recurrent filter.' },
  coverage: { label: 'Ben: CoverageDenoiseNode (PR #35228)', text: 'As in his interior example: the SSGI at coverage 1, normal guide with roughness 1, no hit distance (surface reprojection only).' },
};

export const AO: Record<AoKind, string> = {
  raw: 'Raw', spatial: 'three DenoiseNode (spatial)', svgf: 'Realtime SVGF (ours)', coverage: 'Ben: CoverageDenoiseNode',
};

export const TRACER: Record<Tracer, Blurb> = {
  three: { label: 'three r186 SSRNode', text: 'Stochastic SSR, one GGX ray; misses take the probe in the sampled direction before denoising.' },
  ben: {
    label: 'Ben: SSRNode (PR #35228)',
    text: 'His reworked tracer: FAST blue noise, adaptive Hi-Z, viewport clipping, binary refine. Outputs incoming radiance + coverage + hit distance; the probe fills 1 − coverage.',
    watch: 'Traces this frame\'s lit colour (his "Current frame" source), not his default previous-frame feedback.',
  },
};

export const RESOLVE: Record<Resolve, Blurb> = {
  fsr: {
    label: 'FSR3 (@pmndrs/upscaler)',
    text: 'upscale(): renders at 1 / ratio with its own sub-pixel jitter and accumulates the composited frame (locks, disocclusion, shading change), RCAS sharpen. The upscaler kitchen sink\'s convergence stage.',
    watch: 'Upscaler #10: a temporal denoiser in front of a jittered resolver loses history to the jitter, unless it reprojects with the jitter removed ("denoisers see the jitter").',
  },
  traa: {
    label: 'Ben: TRAANode (PR #35228)',
    text: 'three\'s temporal AA with his projection / jitter fixes, native resolution, subpixel correction off (as his example). History clipped to the current 3×3 neighbourhood.',
    watch: 'His demos\' last stage. No upscaling, no locks: compare against FSR3 on the same denoisers.',
  },
  none: { label: 'None (native, no jitter)', text: 'The composite as it is: shows how stable the denoisers are on their own.' },
};

export const VIEWS: Record<View, string> = {
  beauty: 'Beauty (resolved)',
  specular: 'Specular, denoised (before the resolver)',
  'specular-input': 'Specular, noisy input',
  gi: 'SSGI × albedo, denoised (before the resolver)',
  'gi-input': 'SSGI × albedo, noisy input',
  ao: 'SSGI AO',
};

export const PRESETS: Record<string, { spec: SpecKind; diff: DiffKind; resolve: Resolve; aoDenoise?: AoKind; ratio?: number; tracer?: Tracer }> = {
  'Upscaler 10: spatial + FSR3': { spec: 'spatial', diff: 'spatial', aoDenoise: 'raw', resolve: 'fsr' },
  'Ours: recurrent / SVGF + FSR3': { spec: 'recurrent', diff: 'svgf', resolve: 'fsr' },
  'FFX reflections + FSR3': { spec: 'ffx', diff: 'svgf', resolve: 'fsr' },
  'Ours, joint diffuse + specular + FSR3': { spec: 'combined-recurrent', diff: 'svgf', resolve: 'fsr' },
  'Ours: recurrent / SVGF, no resolver': { spec: 'recurrent', diff: 'svgf', resolve: 'none' },
  'Raw + FSR3': { spec: 'raw', diff: 'raw', aoDenoise: 'raw', resolve: 'fsr' },
  'Ben PR #35228: his SSR + coverage denoise + TRAA': { tracer: 'ben', spec: 'coverage', diff: 'coverage', aoDenoise: 'coverage', resolve: 'traa' },
  'Ben PR #35228 + FSR3': { tracer: 'ben', spec: 'coverage', diff: 'coverage', aoDenoise: 'coverage', resolve: 'fsr' },
  'Ours + FSR3, Ben\'s tracer': { tracer: 'ben', spec: 'recurrent', diff: 'svgf', aoDenoise: 'svgf', resolve: 'fsr' },
};
export const DEFAULT_PRESETS = ['Upscaler 10: spatial + FSR3', 'Ours: recurrent / SVGF + FSR3', 'Ben PR #35228: his SSR + coverage denoise + TRAA'];
