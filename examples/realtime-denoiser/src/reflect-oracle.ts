// Independent CPU oracle for the reflect build (reflection-motion tests,
// docs/research/rt-denoiser/results/REFLECTION-MOTION.md). Plain float64 JS, written from textbook geometry and
// sharing no code with the WGSL tracer (scene.ts) or with any denoiser: its own pinhole camera (eye, target,
// vertical FOV, no matrices), its own ray / primitive intersections, and the analytic mirror point of a marker:
//
//   plane    mirror the marker across the plane (M' = M - 2 ((M - P).n) n); the mirror point is where E -> M'
//            crosses the plane, if it lies inside the quad
//   sphere   (convex outside / concave inside) the mirror point lies in the plane through the centre C, the eye E
//            and the marker M (the normal at X passes through C, and the law of reflection keeps E, M and the
//            normal coplanar). Parametrize X(phi) = C + R (cos phi u1 + sin phi u2) and find every root of
//            g(phi) = (a + b) . t(phi), a = unit(E - X), b = unit(M - X), t the in-plane tangent (the half vector
//            is along the normal), with E and M both on the reflecting side (Alhazen's problem; up to four roots
//            on a circle, so the concave cap can show more than one image)
//
// It also evaluates, at the oracle's own mirror point, the two correspondence estimates a temporal filter can
// use: surface reprojection (the reflector point's own previous position) and the curvature-corrected virtual
// image of SPEC R-9 (X + v h / (1 + 2 kappa h) F_dom, static reflected world). Those are what is being
// tested; neither is used as ground truth.
import type { V3 } from './camera';

export interface Cam { eye: V3; target: V3; fovy: number; width: number; height: number }
export interface Reflector {
  /** 0 plane, 1 convex sphere, 2 concave cap */
  kind: 0 | 1 | 2;
  pos: V3;
  /** rotation about +y (radians) */
  angle: number;
  radius: number;
  half: [number, number];
  rough: number;
  /** ripple tilt in degrees (plane only; geometry stays flat) */
  bump: number;
}
export interface Sphere { c: V3; r: number }

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: V3): V3 => mul(a, 1 / len(a));
/** rotate about +y by angle a (same handedness as the WGSL rotY: x' = c x + s z, z' = -s x + c z) */
export const rotY = (v: V3, a: number): V3 => {
  const c = Math.cos(a), s = Math.sin(a);
  return [c * v[0] + s * v[2], v[1], -s * v[0] + c * v[2]];
};
export { sub, add, mul, dot, cross, len, unit };

// ---- pinhole camera (no projection matrices)
function basis(cam: Cam) {
  const f = unit(sub(cam.target, cam.eye));
  const r = unit(cross(f, [0, 1, 0]));
  const u = cross(r, f);
  return { f, r, u, t: Math.tan(cam.fovy / 2), aspect: cam.width / cam.height };
}

/** continuous pixel coordinates (x right, y down; pixel i covers [i, i + 1)) and the depth along the view axis */
export function projectPx(cam: Cam, P: V3): { x: number; y: number; z: number } | null {
  const b = basis(cam);
  const d = sub(P, cam.eye);
  const z = dot(d, b.f);
  if (z <= 1e-6) return null;
  const nx = dot(d, b.r) / z / (b.t * b.aspect), ny = dot(d, b.u) / z / b.t;
  return { x: (nx * 0.5 + 0.5) * cam.width, y: (0.5 - ny * 0.5) * cam.height, z };
}

/** unit ray direction through continuous pixel coordinates (x, y) */
export function rayThrough(cam: Cam, x: number, y: number): V3 {
  const b = basis(cam);
  const nx = (x / cam.width) * 2 - 1, ny = 1 - (y / cam.height) * 2;
  return unit(add(b.f, add(mul(b.r, nx * b.t * b.aspect), mul(b.u, ny * b.t))));
}

// ---- intersections
export function sphereT(o: V3, d: V3, s: Sphere): number {
  const oc = sub(o, s.c), b = dot(oc, d), c = dot(oc, oc) - s.r * s.r, h = b * b - c;
  if (h < 0) return -1;
  const q = Math.sqrt(h);
  let t = -b - q;
  if (t < 1e-6) t = -b + q;
  return t >= 1e-6 ? t : -1;
}

const toLocal = (R: Reflector, p: V3) => rotY(sub(p, R.pos), -R.angle);
const toWorldDir = (R: Reflector, v: V3) => rotY(v, R.angle);
/** concave cap: local centre and the cap's depth limit */
const capOf = (R: Reflector) => {
  const s = R.half[0] / R.radius;
  return { c: [0, 0, R.radius] as V3, zMax: R.radius * (1 - Math.sqrt(Math.max(1 - s * s, 0))) };
};

/** first hit of the reflector's reflecting side (front face) along o + t d, or null (back faces count as blockers: front = false) */
export function intersectReflector(R: Reflector, o: V3, d: V3): { t: number; X: V3; n: V3; front: boolean } | null {
  const lo = toLocal(R, o), ld = rotY(d, -R.angle);
  if (R.kind === 0) {
    if (Math.abs(ld[2]) < 1e-12) return null;
    const t = -lo[2] / ld[2];
    const q = add(lo, mul(ld, t));
    if (!(t > 1e-6) || Math.abs(q[0]) > R.half[0] || Math.abs(q[1]) > R.half[1]) return null;
    const front = ld[2] < 0;
    return { t, X: add(o, mul(d, t)), n: toWorldDir(R, [0, 0, front ? 1 : -1]), front };
  }
  const c: V3 = R.kind === 2 ? capOf(R).c : [0, 0, 0];
  const oc = sub(lo, c), b = dot(oc, ld), disc = b * b - (dot(oc, oc) - R.radius * R.radius);
  if (disc < 0) return null;
  const q = Math.sqrt(disc);
  for (const t of [-b - q, -b + q]) {
    if (!(t > 1e-6)) continue;
    const L = add(lo, mul(ld, t));
    if (R.kind === 1) return { t, X: add(o, mul(d, t)), n: toWorldDir(R, unit(sub(L, c))), front: true };
    if (L[2] > capOf(R).zMax) continue;
    const nIn = unit(sub(c, L));
    const front = dot(ld, nIn) < 0;
    return { t, X: add(o, mul(d, t)), n: toWorldDir(R, front ? nIn : mul(nIn, -1)), front };
  }
  return null;
}

/** geometric (flat / smooth) normal and the curvature 1/R (convex > 0, concave < 0, plane 0) */
export const reflCurvature = (R: Reflector) => (R.kind === 0 ? 0 : R.kind === 1 ? 1 / R.radius : -1 / R.radius);

// ---- the mirror point of a marker
export interface MirrorPoint { X: V3; n: V3 }

/** every mirror point X on the reflector where the eye E sees the point M by one specular bounce (geometric normal) */
export function mirrorPoints(R: Reflector, E: V3, M: V3): MirrorPoint[] {
  if (R.kind === 0) {
    const n = toWorldDir(R, [0, 0, 1]);
    const de = dot(sub(E, R.pos), n), dm = dot(sub(M, R.pos), n);
    if (de <= 0 || dm <= 0) return [];
    const Mp = sub(M, mul(n, 2 * dm));
    const t = de / (de + dm);
    const X = add(E, mul(sub(Mp, E), t));
    const L = toLocal(R, X);
    if (Math.abs(L[0]) > R.half[0] || Math.abs(L[1]) > R.half[1]) return [];
    return [{ X, n }];
  }
  const C = R.kind === 1 ? R.pos : add(R.pos, toWorldDir(R, [0, 0, R.radius]));
  const e = sub(E, C), m = sub(M, C);
  const u1 = unit(e);
  let w = sub(m, mul(u1, dot(m, u1)));
  if (len(w) < 1e-9) w = cross(u1, Math.abs(u1[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]);
  const u2 = unit(w);
  const sgn = R.kind === 1 ? 1 : -1;
  const at = (phi: number) => {
    const rad = add(mul(u1, Math.cos(phi)), mul(u2, Math.sin(phi)));
    const X = add(C, mul(rad, R.radius));
    const n = mul(rad, sgn);
    const a = unit(sub(E, X)), b = unit(sub(M, X));
    const t: V3 = add(mul(u1, -Math.sin(phi)), mul(u2, Math.cos(phi)));
    const ok = dot(a, n) > 0 && dot(b, n) > 0 && (R.kind === 1 || toLocal(R, X)[2] <= capOf(R).zMax);
    return { X, n, g: dot(add(a, b), t), ok };
  };
  const out: MirrorPoint[] = [];
  const N = 4096;
  let prev = at(-Math.PI);
  for (let i = 1; i <= N; i++) {
    const phi = -Math.PI + (2 * Math.PI * i) / N;
    const cur = at(phi);
    if (prev.ok && cur.ok && Math.sign(prev.g) !== Math.sign(cur.g)) {
      let lo = phi - (2 * Math.PI) / N, hi = phi, glo = prev.g;
      for (let k = 0; k < 60; k++) {
        const mid = 0.5 * (lo + hi), gm = at(mid).g;
        if (Math.sign(gm) === Math.sign(glo)) { lo = mid; glo = gm; } else hi = mid;
      }
      const r = at(0.5 * (lo + hi));
      if (r.ok) out.push({ X: r.X, n: r.n });
    }
    prev = cur;
  }
  return out;
}

export interface MarkerImage {
  /** continuous pixel position of the mirror point */
  px: number; py: number;
  X: V3; n: V3;
  /** distance from X to the marker's surface along X -> M (the specular hit distance of the mirror ray) */
  h: number;
}

/**
 * Screen images of marker M (radius rM) in the reflector: mirror points that the eye sees directly (the reflector
 * is the first hit along E -> X, no marker blocks the view ray or the reflected ray) and that land on screen.
 */
export function markerImages(cam: Cam, R: Reflector, M: V3, rM: number, blockers: Sphere[]): MarkerImage[] {
  const out: MarkerImage[] = [];
  for (const mp of mirrorPoints(R, cam.eye, M)) {
    const p = projectPx(cam, mp.X);
    if (!p || p.x < 0 || p.y < 0 || p.x >= cam.width || p.y >= cam.height) continue;
    const dv = unit(sub(mp.X, cam.eye));
    const hit = intersectReflector(R, cam.eye, dv);
    const dist = len(sub(mp.X, cam.eye));
    if (!hit || !hit.front || Math.abs(hit.t - dist) > 1e-4 * dist) continue;
    if (blockers.some((s) => { const t = sphereT(cam.eye, dv, s); return t > 0 && t < dist; })) continue;
    const dr = unit(sub(M, mp.X));
    const toM = len(sub(M, mp.X));
    if (blockers.some((s) => (s.c[0] !== M[0] || s.c[1] !== M[1] || s.c[2] !== M[2]) && (() => { const t = sphereT(mp.X, dr, s); return t > 0 && t < toM; })())) continue;
    out.push({ px: p.x, py: p.y, X: mp.X, n: mp.n, h: Math.max(toM - rM, 0) });
  }
  return out;
}

/** F_dom (SPEC R-2, Lagarde & de Rousiers 2014 fit with GGX alpha = r^2) */
export const domFactor = (rough: number) => { const a = rough * rough; return (1 - a) * (Math.sqrt(1 - a) + a); };

/**
 * The two correspondence estimates at mirror point X (current pose R, camera cam; previous pose Rp, camera camPrev),
 * as continuous previous-frame pixel positions: `surface` = X's own previous position (reflector rigid motion);
 * `virtual` = SPEC R-9's image point X + v h / (1 + 2 kappa h) F_dom, kappa = the reflector's true curvature,
 * h = the true hit distance, projected with the previous camera (static reflected world).
 */
export function correspondenceEstimates(cam: Cam, camPrev: Cam, R: Reflector, Rp: Reflector, X: V3, h: number, kappa = reflCurvature(R)) {
  const L = toLocal(R, X);
  const Xp = add(Rp.pos, rotY(L, Rp.angle));
  const surface = projectPx(camPrev, Xp);
  const v = unit(sub(X, cam.eye));
  const dv = h / Math.max(1 + 2 * kappa * h, 0.05);
  const virt = projectPx(camPrev, add(X, mul(v, dv * domFactor(R.rough))));
  return { surface, virtual: virt };
}

/** Nearest scene hit along o + t d for the guide checks: floor (y = 0), markers, reflector (front or back). */
export function traceScene(R: Reflector, markers: Sphere[], o: V3, d: V3): { t: number; n: V3; id: 'floor' | 'marker' | 'reflector' | 'back' } | null {
  let best: { t: number; n: V3; id: 'floor' | 'marker' | 'reflector' | 'back' } | null = null;
  if (d[1] < 0) { const t = -o[1] / d[1]; if (t > 1e-6) best = { t, n: [0, 1, 0], id: 'floor' }; }
  for (const s of markers) {
    const t = sphereT(o, d, s);
    if (t > 0 && (!best || t < best.t)) best = { t, n: unit(sub(add(o, mul(d, t)), s.c)), id: 'marker' };
  }
  const r = intersectReflector(R, o, d);
  if (r && (!best || r.t < best.t)) best = { t: r.t, n: r.n, id: r.front ? 'reflector' : 'back' };
  return best;
}
