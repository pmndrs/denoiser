// The shadow bench's configuration (shadow-bench.html; how-to: docs/research/rt-denoiser/results/SHADOW-BENCH.md).
//
// Pure data, no three.js: the page, the report and the headless runner (shadow-bench.mjs, which passes a JSON config to
// the page) all speak this shape. A run is fully determined by a BenchConfig plus its variants: the knot's pose, the
// camera and the 1-ray input are pure functions of the timeline frame, so frame f of any run, replay or re-run months
// later is the same image, and a ground truth computed once can be cached by what it depends on (gtKey).
//
// Timeline: frame 0 = denoiser histories reset. Checkpoints at warmup + k * step (k = 0 .. count - 1). At each
// checkpoint the bench keeps a burst of `burst` consecutive frames ending at it (c - burst + 1 .. c), because boil is
// temporal: one frozen frame shows it only as blotches, the frame-to-frame change is what you see.

export type CameraId = 'knot' | 'wall' | 'wide' | 'demo' | 'custom';
export type Vec3 = [number, number, number];

export interface BenchConfig {
  w: number;
  h: number;
  /** Knot yaw at frame 0 (rad) and per frame (rad / frame; realtime-shadows' free-running rate is 0.35 / 60). */
  knotStart: number;
  knotRate: number;
  /** Fixed tilt of the knot about x (rad), as the realtime pages. */
  knotTilt: number;
  /** Half height of the area light panel (m; the panel is 1.35x wider). realtime-shadows' default is 0.3. */
  lightHalf: number;
  camera: CameraId;
  /** camera 'custom': position and look-at target (world, m). */
  position?: Vec3;
  target?: Vec3;
  /** 1-ray light samples: spatiotemporal blue noise (the renderer contract) or PCG white noise. */
  sampler: 'blue' | 'white';
  /** Frames before the first checkpoint (300 = 5 s at 60 fps), frames between checkpoints, number of checkpoints. */
  warmup: number;
  step: number;
  count: number;
  /** Consecutive frames kept per checkpoint, ending at it (>= 3 for boil, which needs x_t, x_t-1, x_t-2). */
  burst: number;
  /**
   * Ground truth: gtGrid x gtGrid stratified rays per pixel (64 -> 4096), gtRows grid rows per GPU pass. Keep a pass
   * near 64 rays / pixel (gtGrid x gtRows): 256 rays / pixel per pass at 960x540 lost the device (GPU watchdog).
   */
  gtGrid: number;
  gtRows: number;
  /** Low-frequency boil: Gaussian sigma (px) applied before the temporal second difference. */
  blurSigma: number;
  /** A pixel is in the .moving split when its ground truth changes faster than this per frame over the burst. */
  movingRate: number;
  /** Images written per run: every kept frame, only the checkpoints, or none (metrics only). */
  images: 'all' | 'checkpoints' | 'none';
  /** Also write raw f32 visibility (gt, noisy, every variant) per kept frame, for agents' own metrics. */
  raw: boolean;
  /** Free-form tag added to the run id. */
  label?: string;
}

export interface Variant {
  /** Short id (file names, tables): [a-z0-9-]. */
  id: string;
  kind: 'ffx' | 'ours';
  /** ShadowDenoiser options (kind 'ours'), merged over the package defaults. */
  options?: Record<string, unknown>;
  label?: string;
}

export const DEFAULT_CONFIG: BenchConfig = {
  w: 960, h: 540,
  knotStart: 0, knotRate: 0.35 / 60, knotTilt: 0.4,
  lightHalf: 0.3,
  camera: 'wall',
  sampler: 'blue',
  warmup: 300, step: 1, count: 5, burst: 3,
  gtGrid: 64, gtRows: 1,
  blurSigma: 3,
  movingRate: 0.0005,
  images: 'checkpoints',
  raw: false,
};

export const DEFAULT_VARIANTS: Variant[] = [
  { id: 'ffx', kind: 'ffx', label: 'ffxShadows (FidelityFX)' },
  { id: 'ours', kind: 'ours', options: {}, label: 'realtimeShadows, package defaults' },
];

/**
 * Camera presets. 'knot' = realtime/path.ts KNOT_VIEW (the knot-static captures); 'wall' = closer, on the knot's
 * shadow on the back wall and floor behind the pedestal; 'wide' = the corner from the front (other shadows as control).
 */
export const CAMERAS: Record<Exclude<CameraId, 'custom'>, { position: Vec3; target: Vec3; label: string }> = {
  knot: { position: [0.55, 1.05, 0.55], target: [1.55, 0.6, -1.95], label: 'knot close-up (knot-static captures)' },
  wall: { position: [0.85, 0.95, -0.6], target: [1.35, 0.62, -2.1], label: 'knot shadow on the back wall (close)' },
  wide: { position: [1.2, 1.5, 3.2], target: [-0.35, 0.5, -0.8], label: 'wide: the corner from the front' },
  // realtime-shadows.html's wide shot (realtime/scene.ts SHOTS[0], pose at t = 0): what that page shows when its camera
  // is "paused" from the start (which also freezes the knot: use knotRate 0 to match)
  demo: { position: [-0.35 + 4.1 * Math.sin(0.2), 1.65, -0.8 + 4.1 * Math.cos(0.2)], target: [-0.35, 0.5, -0.8], label: 'realtime-shadows wide shot (its paused view)' },
};

export function cameraOf(c: BenchConfig): { position: Vec3; target: Vec3 } {
  if (c.camera === 'custom') {
    if (!c.position || !c.target) throw new Error("camera 'custom' needs position and target");
    return { position: c.position, target: c.target };
  }
  return CAMERAS[c.camera];
}

/** Knot yaw (rad) at timeline frame f. */
export const knotAngle = (c: BenchConfig, f: number) => c.knotStart + c.knotRate * f;

/** Checkpoint frames. */
export const checkpoints = (c: BenchConfig) => Array.from({ length: c.count }, (_, k) => c.warmup + k * c.step);

/** Every frame the bench keeps (the union of the checkpoints' bursts), ascending. */
export function keptFrames(c: BenchConfig): number[] {
  const s = new Set<number>();
  for (const cp of checkpoints(c)) for (let j = 0; j < c.burst; j++) if (cp - j >= 0) s.add(cp - j);
  return [...s].sort((a, b) => a - b);
}

/** Last timeline frame of a run. */
export const lastFrame = (c: BenchConfig) => c.warmup + (c.count - 1) * c.step;

/**
 * Bump when the scene (realtime/scene.ts buildScene), the shadow ray, the receiver surface reconstruction or the
 * ground-truth sampling changes: cached ground truths keyed with an older version are then not reused.
 */
export const GT_VERSION = 'corner-1';

/**
 * Cache key of the ground truth of frame f: everything the converged visibility depends on (not the denoisers, not the
 * 1-ray sampler, not the timeline: two configs reaching the same knot pose share it).
 */
export function gtKey(c: BenchConfig, f: number): string {
  const cam = cameraOf(c);
  const r = (v: number) => +v.toFixed(7);
  const desc = JSON.stringify({
    v: GT_VERSION, w: c.w, h: c.h, light: r(c.lightHalf), tilt: r(c.knotTilt), yaw: r(knotAngle(c, f)),
    cam: [...cam.position, ...cam.target].map(r), grid: c.gtGrid,
  });
  return `${c.w}x${c.h}-g${c.gtGrid}-${fnv(desc)}`;
}

/** 64-bit FNV-1a as 16 hex digits (two 32-bit lanes; collisions don't matter at this scale). */
function fnv(s: string): string {
  let a = 0x811c9dc5, b = 0x050c5d1f;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    a = Math.imul(a ^ ch, 0x01000193) >>> 0;
    b = Math.imul(b ^ ch ^ (a >>> 7), 0x01000193) >>> 0;
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

/** Config with defaults filled in, sanity-checked. */
/** Grid rows per ground-truth pass for a grid: about 64 rays / pixel per pass. */
export const gtRowsFor = (grid: number) => Math.max(1, Math.floor(64 / grid));

export function resolveConfig(c: Partial<BenchConfig> = {}): BenchConfig {
  const r = { ...DEFAULT_CONFIG, ...c };
  if (c.gtGrid !== undefined && c.gtRows === undefined) r.gtRows = gtRowsFor(r.gtGrid);
  for (const [k, d] of Object.entries(DEFAULT_CONFIG)) {
    const v = (r as unknown as Record<string, unknown>)[k];
    if (typeof d === 'number' && !(typeof v === 'number' && Number.isFinite(v))) throw new Error(`shadow bench: ${k} must be a finite number (got ${JSON.stringify(v)})`);
  }
  if (!(r.camera === 'custom' || r.camera in CAMERAS)) throw new Error(`shadow bench: unknown camera "${r.camera}" (${[...Object.keys(CAMERAS), 'custom'].join(', ')})`);
  if (!['all', 'checkpoints', 'none'].includes(r.images)) throw new Error(`shadow bench: images must be all, checkpoints or none (got "${r.images}")`);
  if (r.sampler !== 'blue' && r.sampler !== 'white') throw new Error(`shadow bench: sampler must be blue or white (got "${r.sampler}")`);
  if (r.burst < 1 || r.count < 1 || r.step < 1 || r.warmup < 0) throw new Error('shadow bench: burst, count, step >= 1, warmup >= 0');
  if (r.gtGrid % r.gtRows) throw new Error('shadow bench: gtRows must divide gtGrid');
  return r;
}

/**
 * Numeric ShadowDenoiser options worth sweeping, with the range the tuning panel offers. Defaults are read from the
 * live package (the panel shows what the denoiser resolved), not repeated here.
 */
export const TUNABLES: { key: string; min: number; max: number; step: number; note: string }[] = [
  { key: 'maxHistory', min: 1, max: 63, step: 1, note: 'history cap (frames - 1)' },
  { key: 'historyScale', min: 0, max: 4, step: 0.05, note: 'cap from penumbra width: clamp(scale x W_px^2, min, max); 0 = always max' },
  { key: 'minHistory', min: 0, max: 31, step: 1, note: 'lower bound of that cap' },
  { key: 'clampSigma', min: 0, max: 4, step: 0.05, note: 'neighbourhood clamp window, in standard deviations' },
  { key: 'clampFloor', min: 0, max: 0.5, step: 0.005, note: 'constant added to the clamp window' },
  { key: 'antiLagGain', min: 0, max: 256, step: 1, note: 'clamp distance -> history restart (0 = off)' },
  { key: 'radiusScale', min: 0, max: 3, step: 0.05, note: 'spatial kernel radius / penumbra width' },
  { key: 'historyShrink', min: 0, max: 1, step: 0.05, note: 'kernel radius factor at full history' },
  { key: 'minRadius', min: 0, max: 8, step: 0.25, note: 'smallest kernel radius (px)' },
  { key: 'maxRadius', min: 4, max: 128, step: 1, note: 'largest kernel axis (px at 1080p)' },
  { key: 'spatialPasses', min: 0, max: 2, step: 1, note: 'spatial passes' },
  { key: 'rotationStep', min: 0, max: 1, step: 0.001, note: 'per-frame kernel rotation (turns; 0 = still pattern)' },
  { key: 'stabilize', min: 0, max: 1, step: 0.01, note: 'output stabilization blend (0 = off)' },
  { key: 'stabilizeBox', min: 0, max: 0.5, step: 0.005, note: 'stabilization clamp box (at 1080p)' },
  { key: 'stabilizeAntiLag', min: 0, max: 256, step: 1, note: 'stabilization anti-lag gain' },
  { key: 'youngFrames', min: 0, max: 32, step: 1, note: 'young-history spatial mean frames' },
  { key: 'youngMean', min: 0, max: 1, step: 0.05, note: 'young-history mean weight' },
  { key: 'noiseRadius', min: 0, max: 64, step: 1, note: 'noise-driven kernel radius (px at 1080p)' },
  { key: 'noiseBlend', min: 0, max: 1, step: 0.05, note: 'blend of the noise radius into the penumbra radius' },
  { key: 'maxScaleHistory', min: 0, max: 31, step: 1, note: 'history cap of the penumbra-scale estimate' },
  { key: 'snapHardPx', min: 0, max: 8, step: 0.5, note: 'snap to agreeing samples below this penumbra width (px)' },
];
