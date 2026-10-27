// The review bench's option registry (TASKS rule 12; how-to: docs/research/rt-denoiser/results/REVIEW-BENCH.md).
//
// One entry per reviewable denoiser option. The bench (review.html) builds every control, badge, preset and "show me"
// jump from this file, so a new option or proposal is ONE entry in OPTIONS (plus a DECISIONS entry if it has a
// decision id that isn't listed yet). Nothing else in src/review/ needs to change.
//
// `default` is the package default this registry expects. The bench also reads the defaults the package actually
// resolved (each denoiser's `options`) and flags a mismatch on the control, so a default flipped in
// packages/denoiser-realtime without updating this file shows up instead of silently lying.
//
// Pure data: no three.js imports (run-realtime.mjs and docs can read it too).

export type Filter = 'svgf' | 'recurrent' | 'shadows' | 'occlusion' | 'sh';
/** Which node an option goes to: the joint diffuse + specular node (shared, or one signal), AO, shadows. */
export type Target = 'gi' | 'gi.diffuse' | 'gi.specular' | 'ao' | 'shadows';
export type Value = boolean | number | string;
/** default: shipped as the default · opt-in: an option that stays off by default · open: proposed, waiting for Dennis. */
export type Status = 'default' | 'opt-in' | 'open';
export type SceneId = 'corner' | 'knot' | 'sponza' | 'bistro';
export type Signal = 'lit' | 'diffuse' | 'specular' | 'ao' | 'shadow';
export type View = 'split' | 'A' | 'B' | 'diff' | 'ref' | 'noisy';
/** Scene event the jump points at: a camera cut, a light colour change at constant luminance, a brightness step. */
export type SceneEvent = 'cut' | 'colour' | 'brightness';

/** Where an option shows best. `path` is a path id of that scene (see SCENE_PATHS); omitted = the free-running view. */
export interface Where {
  scene: SceneId;
  path?: string;
  signal: Signal;
  view?: View;
  event?: SceneEvent;
  /** One short line shown with the jump (what to do there). */
  note?: string;
}

export interface ReviewOption {
  /** Unique id, `<filter>.<key>` by convention (switches: `gi.filter`, `ao.filter`, `gi.payload`). */
  id: string;
  filter: Filter;
  /** Option key in the denoiser options. */
  key: string;
  /** Nodes it is passed to (the same key / value to each). */
  targets: Target[];
  /** Allowed values (the control is a checkbox for [false, true], a select otherwise). */
  values: readonly Value[];
  valueLabels?: Readonly<Record<string, string>>;
  /** The package default this registry expects (checked against the live package on the page). */
  default: Value;
  /** The value the proposal / decision turns on. Default: the value that isn't `default`, else the last change's. */
  candidate?: Value;
  /** Default changes, oldest first: on date `on` the default changed from `from` (decision `by`). */
  changes?: { on: string; from: Value; by: string }[];
  /** Decision id: a decisions-page q-number, or a review target (T1b, T5, T6) for config-level flips. */
  decision?: string;
  /** Other decisions that concern this option (badges only). */
  related?: string[];
  status: Status;
  /** One plain sentence: what to look for when flipping it. */
  look: string;
  where: Where;
  /** A filter / payload switch (always applicable; gates the options of that filter). */
  switch?: true;
  /** Valid for both SVGF and the recurrent filter (otherwise `filter` decides: 'recurrent' needs filter recurrent). */
  anyFilter?: true;
  /** Other options this one needs, e.g. `{ 'svgf.antiLag': ['auto'] }` (the control is disabled otherwise). */
  requires?: Record<string, readonly Value[]>;
  /**
   * SVGF option the SH payload can't take (the package throws): with `gi.payload: 'sh'` it goes to the specular node only
   * (and to AO), not to the SH diffuse node.
   */
  radianceOnly?: true;
  /** Tuning knob of a decision: shown with it, but not part of its preset. */
  tuning?: true;
  /** Not wired on the bench scenes (shown disabled, with this reason). */
  unwired?: string;
  /** Limits of the bench scenes for this option (shown under the control). */
  benchNote?: string;
}

/** Decisions with a card. Options are attached by their `decision` field; `set` overrides the derived preset. */
export interface Decision {
  id: string;
  title: string;
  /** Dennis's answer, as recorded (decisions page / SPEC §12). */
  answer: string;
  /** Overrides on both sides (e.g. q28 needs the recurrent filter, q29 sits on top of q23). */
  base?: Record<string, Value>;
  /** Explicit [A, B] values, instead of every option with this decision id at [off, candidate]. */
  set?: Record<string, readonly [Value, Value]>;
  where?: Where;
  /** More places worth a look (secondary jump buttons on the card). */
  alsoAt?: Where[];
  /** A prominent flip-test card at the top of the page (Dennis asked for these). */
  highlight?: true;
  /** What the flip test shows, for the card (defaults to the options' `look` lines). */
  look?: string;
}

/** Paths per scene (ids as in src/realtime/path.ts and src/realtime/scenes.ts); '' = the free-running view. */
export const SCENE_PATHS: Record<SceneId, { id: string; label: string }[]> = {
  corner: [
    { id: '', label: 'free: slow orbit, knot rotating' }, { id: 'orbit', label: 'orbit + fast pan (64 frames)' },
    { id: 'knot-orbit', label: 'orbit, knot rotating' },
  ],
  knot: [
    { id: 'knot-static', label: 'still camera, knot rotating' }, { id: 'knot-still', label: 'still camera, knot frozen' },
    { id: 'knot-orbit', label: 'orbit, knot rotating' },
  ],
  sponza: [
    { id: '', label: 'free: slow orbit' }, { id: 'sponza-orbit', label: 'orbit' }, { id: 'sponza-pan', label: 'fast pan' },
    { id: 'sponza-move', label: 'moving object' },
  ],
  bistro: [
    { id: '', label: 'free: slow orbit' }, { id: 'bistro-orbit', label: 'orbit' }, { id: 'bistro-pan', label: 'fast pan' },
    { id: 'bistro-move', label: 'moving object + moving lantern (local light shadows)' }, { id: 'bistro-hold', label: 'orbit, then held still' },
  ],
};

const GOLDEN = 0.6180339887;

export const OPTIONS: ReviewOption[] = [
  // ---- SVGF / A-SVGF (the default filter of diffuse, specular and AO) -----------------------------------------
  {
    id: 'svgf.normalTest', filter: 'svgf', key: 'normalTest', targets: ['gi', 'ao'],
    radianceOnly: true,
    values: ['center', 'relative', 'soft'], default: 'soft', candidate: 'soft',
    changes: [{ on: '2026-10-27', from: 'center', by: 'q31' }], decision: 'q31', status: 'default',
    look: "On dense geometry in motion, 'center' restarts pixels as 1-ray noise every few frames (AO and diffuse flicker on Bistro's facades and Sponza's columns); 'soft' keeps a short history there with the same detail.",
    where: { scene: 'bistro', path: 'bistro-orbit', signal: 'ao', note: 'watch the facades and the awning while the camera moves' },
  },
  {
    id: 'svgf.normalSoftThreshold', filter: 'svgf', key: 'normalSoftThreshold', targets: ['gi', 'ao'],
    radianceOnly: true,
    values: [0.3, 0.5, 0.7], default: 0.5, decision: 'q31', tuning: true, status: 'opt-in',
    look: "normalTest 'soft' only: the looser normal cosine of the retry; lower keeps history across sharper creases (risk of smearing across edges).",
    where: { scene: 'bistro', path: 'bistro-orbit', signal: 'ao' },
  },
  {
    id: 'svgf.normalSoftHistory', filter: 'svgf', key: 'normalSoftHistory', targets: ['gi', 'ao'],
    radianceOnly: true,
    values: [-1, 1, 2, 3, 5], valueLabels: { '-1': 'per kind (3 diffuse / AO, 1 specular)' }, default: -1, decision: 'q31', tuning: true, status: 'opt-in',
    look: "normalTest 'soft' only: frames of history kept where the full normal test fails; 1 = today's reset, more = calmer but slower to clear a wrong history.",
    where: { scene: 'bistro', path: 'bistro-orbit', signal: 'ao' },
  },
  {
    id: 'svgf.antiLagChroma', filter: 'svgf', key: 'antiLagChroma', targets: ['gi'],
    radianceOnly: true, requires: { 'svgf.antiLag': ['auto'] },
    values: [false, true], default: true, changes: [{ on: '2026-10-27', from: false, by: 'q26' }], decision: 'q26', status: 'default',
    look: 'After the light changes colour at the same brightness, the old tint lingers ~20 frames with false; with true the new colour shows in 4-8 frames.',
    where: { scene: 'bistro', path: 'bistro-hold', signal: 'diffuse', event: 'colour', note: 'press "light colour" (key C) and watch the bounce light' },
  },
  {
    id: 'svgf.f16Rounding', filter: 'svgf', key: 'f16Rounding', targets: ['gi', 'ao'], anyFilter: true,
    values: ['store', 'nearest'], default: 'nearest', changes: [{ on: '2026-10-27', from: 'store', by: 'q25' }], decision: 'q25', status: 'default',
    look: "Apple GPUs truncate 16-bit history stores: 'store' sits 0.2-0.5 % darker everywhere than 'nearest' (only the difference view at high gain shows it; a no-op on GPUs that round).",
    where: { scene: 'bistro', path: 'bistro-hold', signal: 'diffuse', view: 'diff', note: 'difference view, gain 64 or more, after the camera holds still' },
  },
  {
    id: 'svgf.youngNormalPower', filter: 'svgf', key: 'youngNormalPower', targets: ['gi'],
    values: [0, 8, 16], default: 16, changes: [{ on: '2026-10-26', from: 0, by: 'q18' }], decision: 'q18', status: 'default',
    look: 'For ~5 frames after a camera cut or reveal, curved surfaces in diffuse look blotchy with 0; 16 removes the blotches (settled pixels are unchanged).',
    where: { scene: 'corner', signal: 'diffuse', event: 'cut', note: 'press "camera cut" (key K) and watch the first frames on the knot and the chair' },
  },
  {
    id: 'svgf.antiLag', filter: 'svgf', key: 'antiLag', targets: ['gi', 'ao'],
    values: ['off', 'auto'], default: 'auto', changes: [{ on: '2026-10-25', from: 'off', by: 'q02' }], decision: 'q02', status: 'default',
    look: "'off' keeps long histories everywhere: reflections smear under camera motion and light changes lag; 'auto' shortens history where the lighting changes.",
    where: { scene: 'sponza', path: 'sponza-pan', signal: 'specular' },
  },
  {
    id: 'svgf.outputAliasing', filter: 'svgf', key: 'outputAliasing', targets: ['gi'],
    radianceOnly: true,
    values: [false, true], default: true, changes: [{ on: '2026-10-27', from: false, by: 'q04' }], decision: 'q04', status: 'default',
    look: 'Byte-identical by design (saves 16 B/px per signal): the difference view must stay black at any gain; anything else is a bug.',
    where: { scene: 'corner', path: 'orbit', signal: 'diffuse', view: 'diff' },
  },
  {
    id: 'svgf.antiLagHistoryScale', filter: 'svgf', key: 'antiLagHistoryScale', targets: ['gi'],
    radianceOnly: true,
    values: [false, true], default: false, status: 'opt-in',
    look: 'Anti-lag shortens the history in proportion instead of restarting it: less flashing next to a light change, but a slower reaction (results/SVGF-FOLLOWUPS.md §2.3).',
    where: { scene: 'bistro', path: 'bistro-hold', signal: 'diffuse', event: 'brightness', note: 'press "light step" (key B)' },
  },
  {
    id: 'svgf.antiLagGain', filter: 'svgf', key: 'antiLagGain', targets: ['gi'],
    radianceOnly: true, requires: { 'svgf.antiLag': ['auto'] },
    values: [1, 2, 4], default: 1, status: 'opt-in',
    look: 'Higher gain drops history faster on smaller changes: specular follows camera motion sooner, but still views boil more (failed rule 9 on boil, T3).',
    where: { scene: 'sponza', path: 'sponza-orbit', signal: 'specular' },
  },
  {
    id: 'svgf.historyFallback', filter: 'svgf', key: 'historyFallback', targets: ['gi'],
    radianceOnly: true,
    values: ['3x3', 'off', 'strict'], default: '3x3', status: 'opt-in',
    look: "Thin geometry and silhouettes: 'off' / 'strict' restart pixels whose footprint fails instead of borrowing 3x3 history: no wrong-surface history, more noise on thin objects (fails on the real scenes, T6).",
    where: { scene: 'bistro', path: 'bistro-pan', signal: 'diffuse' },
  },
  {
    id: 'svgf.historyNormal', filter: 'svgf', key: 'historyNormal', targets: ['gi'],
    radianceOnly: true,
    values: ['normal', 'geometric'], default: 'normal', status: 'opt-in',
    look: "'geometric' runs the history test on the vertex normal, so normal-map detail doesn't fail its own resampling (fails on the normal-mapped test-bed build).",
    where: { scene: 'bistro', path: 'bistro-orbit', signal: 'diffuse' },
    unwired: 'needs guides.geometricNormal, which denoiser/three does not pass yet (test bed only)',
  },
  {
    id: 'svgf.reflectionReprojection', filter: 'svgf', key: 'reflectionReprojection', targets: ['gi.specular'],
    values: ['surface', 'virtual', 'dual'], default: 'surface', status: 'opt-in',
    look: "Glossy floor under camera motion: 'virtual' / 'dual' fetch the history where the reflected image was instead of where the surface was (less smear on mirrors, risk of duplicates; fails rule 9, RM).",
    where: { scene: 'corner', path: 'orbit', signal: 'specular' },
  },
  {
    id: 'svgf.reflectionHitTest', filter: 'svgf', key: 'reflectionHitTest', targets: ['gi.specular'],
    values: [false, true], default: false, status: 'opt-in',
    look: 'Reflections of moving objects: drops specular history whose reflected depth changed (shorter trails behind reflected objects, more noise at reflection edges; fails rule 9).',
    where: { scene: 'corner', path: 'knot-orbit', signal: 'specular' },
  },

  // ---- recurrent filter (opt-in; `gi.filter: 'recurrent'` turns it on for diffuse + specular) --------------------
  {
    id: 'gi.filter', filter: 'recurrent', key: 'filter', targets: ['gi'], switch: true,
    values: ['svgf', 'recurrent'], default: 'svgf', candidate: 'recurrent', decision: 'q01', status: 'default',
    look: "Diffuse + specular filter: SVGF / A-SVGF (default) vs the memory-lean recurrent filter (opt-in), which is softer on young pixels and 0.6-1 dB behind.",
    where: { scene: 'sponza', path: 'sponza-orbit', signal: 'diffuse' },
  },
  {
    id: 'recurrent.historyFix', filter: 'recurrent', key: 'historyFix', targets: ['gi'],
    values: ['mips', 'spatial'], default: 'spatial', changes: [{ on: '2026-10-26', from: 'mips', by: 'q19' }], decision: 'q19', status: 'default',
    look: "Newly revealed areas: 'spatial' rebuilds young pixels from full-resolution neighbours (sharper reveals, a little more shimmer); 'mips' is smoother but blurrier.",
    where: { scene: 'sponza', path: 'sponza-pan', signal: 'diffuse' },
  },
  {
    id: 'recurrent.historyFixDense', filter: 'recurrent', key: 'historyFixDense', targets: ['gi'],
    values: [0, 4], default: 4, changes: [{ on: '2026-10-26', from: 0, by: 'T1b' }], decision: 'T1b', status: 'default',
    look: 'The frame right after a camera cut: 0 leaves blotchy 1-ray noise there; 4 averages a dense tile around each fresh pixel.',
    where: { scene: 'corner', signal: 'diffuse', event: 'cut' },
  },
  {
    id: 'recurrent.normalThreshold', filter: 'recurrent', key: 'normalThreshold', targets: ['gi'],
    values: [0, 0.8, 0.95], default: 0.95, changes: [{ on: '2026-10-26', from: 0, by: 'T6' }], decision: 'T6', related: ['q28'], status: 'default',
    look: "A moving object's contact: with 0 the floor next to the knot keeps the knot's history (a ghost at the contact); 0.95 drops it.",
    where: { scene: 'corner', path: 'knot-orbit', signal: 'diffuse' },
  },
  {
    id: 'recurrent.normalTest', filter: 'recurrent', key: 'normalTest', targets: ['gi'],
    values: ['center', 'relative'], default: 'relative', changes: [{ on: '2026-10-26', from: 'center', by: 'T6' }], decision: 'T6', related: ['q28'], status: 'default',
    look: "'center' (the plain test, q28) is sharper on Bistro (+0.3-0.4 dB) but restarts more pixels, which boil on moving views; 'relative' relaxes the test on detailed geometry.",
    where: { scene: 'bistro', path: 'bistro-pan', signal: 'diffuse' },
  },
  {
    id: 'recurrent.virtualHitTest', filter: 'recurrent', key: 'virtualHitTest', targets: ['gi'],
    values: [false, true], default: true, changes: [{ on: '2026-10-26', from: false, by: 'T6' }], decision: 'T6', status: 'default',
    look: 'Clean mirrors: false keeps duplicates of reflected objects after they move; true drops that reflected-world history.',
    where: { scene: 'corner', path: 'knot-orbit', signal: 'specular' },
  },

  // ---- SH payload (directional diffuse, opt-in) --------------------------------------------------------------
  {
    id: 'gi.payload', filter: 'sh', key: 'payload', targets: ['gi.diffuse'], switch: true,
    values: ['radiance', 'sh'], default: 'radiance', candidate: 'sh', decision: 'q12', status: 'opt-in',
    look: 'Directional (SH) diffuse keeps normal-map detail through the filter; without normal maps (these scenes) it is calm but a little flatter than radiance.',
    where: { scene: 'sponza', path: 'sponza-orbit', signal: 'diffuse' },
    benchNote: 'the bench runs SH diffuse as its own node (realtimeDiffuse) next to realtimeSpecular',
  },
  {
    id: 'sh.shDetailNormalPower', filter: 'sh', key: 'shDetailNormalPower', targets: ['gi.diffuse'],
    values: [0, 8, 16], default: 0, candidate: 16, decision: 'q27', status: 'opt-in',
    look: 'Crisper bumps from normal maps in motion, with some shimmer on still views.',
    where: { scene: 'sponza', path: 'sponza-orbit', signal: 'diffuse' },
    benchNote: 'no normal maps on these scenes (detail normal = smooth normal): expect no change here; see the test bed dt-* paths',
  },
  {
    id: 'sh.shSharpen', filter: 'sh', key: 'shSharpen', targets: ['gi.diffuse'],
    values: [0.75, 1], default: 1, changes: [{ on: '2026-10-26', from: 0.75, by: 'T5' }], decision: 'T5', status: 'default',
    look: 'Sharpening of the SH resolve: 1 gives a little more bump contrast than 0.75.',
    where: { scene: 'sponza', path: 'sponza-orbit', signal: 'diffuse' },
  },

  // ---- shadows (ShadowDenoiser) ------------------------------------------------------------------------------------
  {
    id: 'shadows.stepTest', filter: 'shadows', key: 'stepTest', targets: ['shadows'],
    values: [false, true], default: true, changes: [{ on: '2026-10-27', from: false, by: 'q23' }], decision: 'q23', status: 'default',
    look: 'Clean hard edges no longer get a noise-sized kernel: crisper hard shadow edges and contacts (wide penumbrae unchanged).',
    where: { scene: 'bistro', path: 'bistro-move', signal: 'shadow' },
  },
  {
    id: 'shadows.edgeBox', filter: 'shadows', key: 'edgeBox', targets: ['shadows'],
    values: [false, true], default: true, changes: [{ on: '2026-10-27', from: false, by: 'q23' }], decision: 'q23', status: 'default',
    look: 'Behind a moving hard occluder: removes the last 1-2 px echo ring that trails a moving hard shadow edge.',
    where: { scene: 'bistro', path: 'bistro-move', signal: 'shadow' },
  },
  {
    id: 'shadows.rotationStep', filter: 'shadows', key: 'rotationStep', targets: ['shadows'],
    values: [0, GOLDEN], valueLabels: { '0': '0 (fixed per pixel)', [String(GOLDEN)]: '0.618 (rotates every frame)' },
    default: 0, changes: [{ on: '2026-10-27', from: GOLDEN, by: 'q23' }], decision: 'q23', status: 'default',
    look: 'With 0.618 the kernel pattern turns every frame, which reads as boil in penumbrae even when nothing moves; 0 freezes it per pixel.',
    where: { scene: 'knot', path: 'knot-still', signal: 'shadow', note: 'still camera: any shimmer you see is the filter, not the scene' },
  },
  {
    id: 'shadows.terminatorAnalytic', filter: 'shadows', key: 'terminatorAnalytic', targets: ['shadows'],
    values: [false, true], default: true, changes: [{ on: '2026-10-27', from: false, by: 'q24' }], decision: 'q24', status: 'default',
    look: 'Where a surface turns away from the light: the exact horizon-clipped value instead of a 16 px blur (darker, cleaner terminators on curved surfaces; assumes the exact light).',
    where: { scene: 'knot', path: 'knot-static', signal: 'shadow', note: 'the knot and the pedestal edges facing away from the panel' },
  },
  {
    id: 'shadows.horizonSnap', filter: 'shadows', key: 'horizonSnap', targets: ['shadows'],
    values: [false, true], default: true, changes: [{ on: '2026-10-27', from: false, by: 'q24' }], decision: 'q24', status: 'default',
    look: 'Surfaces turning away from a moving light go dark at once instead of keeping stale lit history for a few frames.',
    where: { scene: 'bistro', path: 'bistro-move', signal: 'shadow', note: 'surfaces near the moving lantern' },
  },
  {
    id: 'shadows.floorE', filter: 'shadows', key: 'floorE', targets: ['shadows'],
    values: [0, 0.05], default: 0.05, changes: [{ on: '2026-10-27', from: 0, by: 'q29' }], decision: 'q29', status: 'default',
    look: 'Hard contacts (feet of objects, the pedestal): 0 blurs across the binary contact, softer than the raw input; 0.05 keeps them crisp. Watch moving regions for extra shimmer.',
    where: { scene: 'bistro', path: 'bistro-move', signal: 'shadow', note: 'contacts under the moving object and the lantern' },
  },
  {
    id: 'shadows.lightMotion', filter: 'shadows', key: 'lightMotion', targets: ['shadows'],
    values: [0, 1], default: 0, candidate: 1, decision: 'q30', status: 'opt-in',
    look: "A fast-moving light: 1 keeps shadow edges with the light instead of dragging them along, but shimmers more while the light moves.",
    where: { scene: 'bistro', path: 'bistro-move', signal: 'shadow', note: "the lantern's shadows while it moves" },
  },
  {
    id: 'shadows.snapHardPx', filter: 'shadows', key: 'snapHardPx', targets: ['shadows'],
    values: [0, 2], default: 2, changes: [{ on: '2026-10-26', from: 0, by: 'q21' }], decision: 'q21', status: 'default',
    look: 'Moving camera: with 0 a grey veil softens fine hard shadow detail (Bistro facades); 2 snaps it back to crisp.',
    where: { scene: 'bistro', path: 'bistro-orbit', signal: 'shadow' },
  },
  {
    id: 'shadows.backfacePass', filter: 'shadows', key: 'backfacePass', targets: ['shadows'],
    values: [false, true], default: true, changes: [{ on: '2026-10-26', from: false, by: 'q21' }], decision: 'q21', status: 'default',
    look: "Surfaces facing away from the light: false blurs the lit side's terminator onto them (the bleed on Bistro's hanging sign); true keeps them dark.",
    where: { scene: 'bistro', path: 'bistro-move', signal: 'shadow' },
  },
  {
    id: 'shadows.noiseCap', filter: 'shadows', key: 'noiseCap', targets: ['shadows'],
    values: [0, 2], default: 0, candidate: 2, decision: 'q22', status: 'opt-in',
    look: 'Sharper near-hard shadows (a small light), but wide soft sun penumbrae boil more.',
    where: { scene: 'bistro', path: 'bistro-move', signal: 'shadow' },
  },
  {
    id: 'shadows.noiseCapSettled', filter: 'shadows', key: 'noiseCapSettled', targets: ['shadows'],
    values: [false, true], default: false, candidate: true, decision: 'q22', status: 'opt-in',
    look: 'With noiseCap: the cap only on settled pixels (fresh pixels keep the noise-sized radius).',
    where: { scene: 'bistro', path: 'bistro-move', signal: 'shadow' },
  },
  {
    id: 'shadows.uniformSnap', filter: 'shadows', key: 'uniformSnap', targets: ['shadows'],
    values: [true, 'change', false], default: 'change', changes: [{ on: '2026-10-25', from: true, by: 'q06' }], decision: 'q06', status: 'default',
    look: "Fully lit / fully shadowed areas: true snaps to the agreeing samples every frame (cleanest flats), false keeps a little lag; 'change' snaps only after a change.",
    where: { scene: 'sponza', path: 'sponza-orbit', signal: 'shadow' },
  },
  {
    id: 'shadows.stabilize', filter: 'shadows', key: 'stabilize', targets: ['shadows'],
    values: [0, 0.25], default: 0.25, decision: 'q05', status: 'default',
    look: "Wide soft penumbrae: 0 removes the output stabilization and shows the spatial passes' frame-to-frame boil (the knot's wall shadow).",
    where: { scene: 'knot', path: 'knot-static', signal: 'shadow' },
  },
  {
    id: 'shadows.clampGeometry', filter: 'shadows', key: 'clampGeometry', targets: ['shadows'],
    values: [false, true], default: true, decision: 'q05', status: 'default',
    look: 'Thin occluders and creases: false clamps history toward the surface next to them (about -1 dB, a dip on the second frame after a cut).',
    where: { scene: 'knot', path: 'knot-orbit', signal: 'shadow' },
  },
  {
    id: 'shadows.normalThreshold', filter: 'shadows', key: 'normalThreshold', targets: ['shadows'],
    values: [0, 0.8, 0.95], default: 0, status: 'opt-in',
    look: "Floor revealed next to a moving object's contact: with a threshold it drops the object's history (passes rule 9 but too small to propose, T6).",
    where: { scene: 'corner', path: 'knot-orbit', signal: 'shadow' },
  },
  {
    id: 'shadows.normalTest', filter: 'shadows', key: 'normalTest', targets: ['shadows'],
    values: ['center', 'relative'], default: 'center', status: 'opt-in',
    look: "With normalThreshold: 'relative' relaxes the test on detailed geometry (T6).",
    where: { scene: 'corner', path: 'knot-orbit', signal: 'shadow' },
  },
  {
    id: 'shadows.f16Rounding', filter: 'shadows', key: 'f16Rounding', targets: ['shadows'],
    values: ['store', 'nearest'], default: 'store', related: ['q25'], status: 'opt-in',
    look: "Shadows keep 'store' (q25): 'nearest' loses on all 7 test paths (penumbrae already lean slightly bright).",
    where: { scene: 'knot', path: 'knot-still', signal: 'shadow', view: 'diff' },
  },

  // ---- occlusion (OcclusionDenoiser, AO) ---------------------------------------------------------------------------
  {
    id: 'ao.filter', filter: 'occlusion', key: 'filter', targets: ['ao'], switch: true,
    values: ['svgf', 'recurrent'], default: 'svgf', changes: [{ on: '2026-10-25', from: 'recurrent', by: 'q01' }], decision: 'q01', status: 'default',
    look: 'AO filter: SVGF (default since q01) is sharper in contacts; recurrent (the earlier default) is softer and blurrier.',
    where: { scene: 'sponza', path: 'sponza-orbit', signal: 'ao' },
  },
  {
    id: 'ao.youngNormalPower', filter: 'occlusion', key: 'youngNormalPower', targets: ['ao'],
    values: [0, 16], default: 0, status: 'opt-in',
    look: "AO after a cut: 16 is the diffuse fix (q18) applied to AO, unmeasured there (OcclusionDenoiser keeps 0).",
    where: { scene: 'corner', signal: 'ao', event: 'cut' },
  },
];

export const DECISIONS: Decision[] = [
  {
    id: 'q23', highlight: true,
    title: 'Shadows: stepTest + edgeBox + rotationStep 0',
    answer: '(a) flip all three (2026-10-27); "flag this in the test bench for me to specifically toggle or mess with as im not clear what the output will be"',
    look: 'A = the shadows before the flip, B = with it. Expect crisper hard edges and contacts (stepTest), no echo ring trailing a moving hard edge (edgeBox), and a still kernel pattern instead of a turning one (rotationStep 0). Toggle each one on B to see which part does what.',
    where: { scene: 'bistro', path: 'bistro-move', signal: 'shadow', note: 'moving object + lantern: hard edges, contacts, trailing' },
    alsoAt: [
      { scene: 'knot', path: 'knot-still', signal: 'shadow', note: 'still camera: rotationStep alone (boil without motion)' },
      { scene: 'sponza', path: 'sponza-orbit', signal: 'shadow', note: 'wide sun penumbrae: should stay as calm' },
    ],
  },
  {
    id: 'q29', highlight: true,
    title: 'Shadows: floorE 0.05 (crisp hard contacts)',
    answer: '(a) default, with q23 (2026-10-27); "This one too might need highlighted in the test bench"',
    base: { 'shadows.stepTest': true, 'shadows.edgeBox': true, 'shadows.rotationStep': 0 },
    look: 'Both sides have q23 on; A = floorE 0 (before), B = floorE 0.05. Expect contacts under hard light to stay as sharp as the raw input instead of blurring; check moving regions for extra shimmer (the measured cost: +5-7 % boil on two captures).',
    where: { scene: 'bistro', path: 'bistro-move', signal: 'shadow', note: 'contacts under the moving object, lantern shadows' },
    alsoAt: [
      { scene: 'knot', path: 'knot-orbit', signal: 'shadow', note: "the pedestal's contact and the knot's shadow" },
      { scene: 'sponza', path: 'sponza-move', signal: 'shadow', note: 'moving object under the sun' },
    ],
  },
  { id: 'q31', title: "SVGF normalTest 'soft' (short history instead of a reset on dense geometry)", answer: "(a) default; keep 'center' as an option and document the trade (2026-10-27)" },
  { id: 'q30', title: 'Shadows lightMotion 1 (follow fast-moving lights)', answer: '(b) documented opt-in; pursue shadow motion vectors (2026-10-27)' },
  { id: 'q24', title: 'Shadows terminatorAnalytic + horizonSnap', answer: '(a) default; document the exact-light requirement (2026-10-27)' },
  { id: 'q26', title: 'SVGF antiLagChroma (anti-lag also reacts to colour changes)', answer: '(a) default (2026-10-27)' },
  { id: 'q25', title: "f16Rounding 'nearest' for SVGF and recurrent (shadows keep 'store')", answer: '(a) default (2026-10-27)' },
  {
    id: 'q28', title: 'Recurrent: the plain normal test (center) instead of relative', answer: "(b) keep 'relative', plain test as an option (2026-10-27)",
    base: { 'gi.filter': 'recurrent' }, set: { 'recurrent.normalTest': ['relative', 'center'] },
    where: { scene: 'bistro', path: 'bistro-pan', signal: 'diffuse' },
  },
  { id: 'q27', title: 'SH: shDetailNormalPower 16', answer: '(b) documented opt-in; find a still-view-calm variant (2026-10-27)', base: { 'gi.payload': 'sh' } },
  { id: 'q22', title: 'Shadows noiseCap (sharper hard shadows, more boil in soft ones)', answer: '(b) stays an option (2026-10-26)' },
  { id: 'q21', title: 'Shadows snapHardPx 2 + backfacePass', answer: '(a) flip both (2026-10-26)' },
  { id: 'q19', title: "Recurrent historyFix 'spatial'", answer: '(a) default, fix the cut frame as a follow-up (2026-10-26)', base: { 'gi.filter': 'recurrent' } },
  { id: 'q18', title: 'SVGF youngNormalPower 16', answer: '(a) default (2026-10-26)' },
  { id: 'T1b', title: 'Recurrent historyFixDense 4 (the cut-frame fix for q19)', answer: 'config default, rule 9 passed (2026-10-26)', base: { 'gi.filter': 'recurrent' } },
  { id: 'T6', title: "Recurrent normal test 0.95 'relative' + virtualHitTest", answer: 'config default, rule 9 passed (2026-10-26)', base: { 'gi.filter': 'recurrent' } },
  { id: 'T5', title: 'SH shSharpen 1', answer: 'config default, rule 9 passed (2026-10-26)', base: { 'gi.payload': 'sh' } },
  { id: 'q12', title: 'SH payload (directional diffuse, M7)', answer: '(a) YCoCg 6 channels; SH stays opt-in (2026-10-25)' },
  { id: 'q06', title: "Shadows uniformSnap 'change'", answer: "(a) 'change' (2026-10-25)" },
  {
    id: 'q05', title: 'Shadows: normal-tested clamp + output stabilization', answer: '(a) keep both (2026-10-25)',
    set: { 'shadows.stabilize': [0, 0.25], 'shadows.clampGeometry': [false, true] },
  },
  { id: 'q04', title: 'Memory: SVGF output aliasing (-16 B/px)', answer: '(a) accept ~140 B/px; output aliasing on since it measured clean (2026-10-27)' },
  { id: 'q02', title: "SVGF anti-lag 'auto' by default", answer: "(a) 'auto' (2026-10-25)" },
  {
    id: 'q01', title: 'Default filter: SVGF / A-SVGF everywhere, recurrent opt-in', answer: '(a) (2026-10-25)',
    set: { 'gi.filter': ['recurrent', 'svgf'], 'ao.filter': ['recurrent', 'svgf'] },
  },
];
