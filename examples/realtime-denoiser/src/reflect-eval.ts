// Reflection-motion metrics for the reflect build (eval mode on a `rm-*` path; results/REFLECTION-MOTION.md).
// Every frame, for each marker, the CPU oracle (reflect-oracle.ts) gives the exact screen position of the marker's
// mirror image; a window (ROI) around it is read back for the reference, the noisy input and every specular
// denoiser, and scored in JS:
//
//   roiPsnr     PSNR in the ROI (per-channel Reinhard x / (1 + x), like the Scorer), pooled over frames
//   posErr      |centroid - oracle| (px): centroid of the luminance excess over the ROI background
//               (median of the reference ROI), pixels above 10 % of the reference's peak excess
//   lag         signed centroid offset along the image's motion direction (px; negative = dragging behind)
//   trail       how far (px) the output's blob reaches behind the image (opposite its motion, 10 % of the
//               reference peak) beyond the reference's own blob
//   ghostFrac   output excess outside the reference blob (10 % mask, dilated 2 px; above 5 % of the peak) over the
//               reference's total excess: trails, duplicates and smears in one number (reference = 0)
//   dup         frames where the output has more blobs (8-connected, > 25 % of the peak, >= 3 px) than the reference
//   recovery    after the stop: frames until the ROI error stays within 1 dB of its settled value (last 8 frames)
//   ghostGone   after a marker's image disappears (rm-obj-exit): frames until the output's excess at its last
//               position falls under 5 % of the image's excess when present
//
// Geometry checks (the renderer against the oracle, not the denoisers): the reference's centroid vs the oracle,
// and at the oracle pixel the GPU guides vs a CPU ray through the same pixel centre (view z, geometric normal,
// motion vector incl. reflector motion, and the mirror ray's hit distance on mirrors without ripples).
// The oracle also scores the two correspondence estimates (surface reprojection, SPEC R-9 virtual image with the
// true curvature and hit distance) against the true previous image position: noise-free correspondence error.
import type { V3 } from './camera';
import { FOVY } from './camera';
import type { FrameState } from './paths';
import type { ReflectPathDef } from './paths-reflect';
import {
  type Cam, correspondenceEstimates, dot, markerImages, projectPx, rayThrough, reflCurvature, sub, traceScene, unit, add, mul,
} from './reflect-oracle';

const READ_WGSL = /* wgsl */ `
struct R { x: u32, y: u32, w: u32, h: u32, off: u32, p0: u32, p1: u32, p2: u32 }
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var<storage, read_write> o: array<f32>;
@group(0) @binding(2) var<uniform> r: R;
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= r.w || id.y >= r.h) { return; }
  let c = textureLoad(src, vec2u(r.x, r.y) + id.xy, 0);
  let i = r.off + (id.y * r.w + id.x) * 4u;
  o[i] = c.r; o[i + 1u] = c.g; o[i + 2u] = c.b; o[i + 3u] = c.a;
}`;

/** Batched rectangle readback of several textures in one map. */
class RectReader {
  private pipe: GPUComputePipeline;
  private uniforms: GPUBuffer[] = [];
  private out?: GPUBuffer;
  private rb?: GPUBuffer;
  private cap = 0;
  constructor(private device: GPUDevice) {
    this.pipe = device.createComputePipeline({ layout: 'auto', compute: { module: device.createShaderModule({ code: READ_WGSL }), entryPoint: 'main' } });
  }
  async read(reqs: { tex: GPUTexture; x: number; y: number; w: number; h: number }[]): Promise<Float32Array[]> {
    const d = this.device;
    const sizes = reqs.map((q) => q.w * q.h * 4);
    const total = sizes.reduce((a, b) => a + b, 0);
    if (total > this.cap) {
      this.out?.destroy(); this.rb?.destroy();
      this.cap = total;
      this.out = d.createBuffer({ size: total * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
      this.rb = d.createBuffer({ size: total * 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    }
    const enc = d.createCommandEncoder({ label: 'reflect roi' });
    let off = 0;
    reqs.forEach((q, i) => {
      this.uniforms[i] ??= d.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      d.queue.writeBuffer(this.uniforms[i], 0, new Uint32Array([q.x, q.y, q.w, q.h, off, 0, 0, 0]));
      const pass = enc.beginComputePass();
      pass.setPipeline(this.pipe);
      pass.setBindGroup(0, d.createBindGroup({ layout: this.pipe.getBindGroupLayout(0), entries: [
        { binding: 0, resource: q.tex.createView() }, { binding: 1, resource: { buffer: this.out! } }, { binding: 2, resource: { buffer: this.uniforms[i] } }] }));
      pass.dispatchWorkgroups(Math.ceil(q.w / 8), Math.ceil(q.h / 8));
      pass.end();
      off += sizes[i];
    });
    enc.copyBufferToBuffer(this.out!, 0, this.rb!, 0, total * 4);
    d.queue.submit([enc.finish()]);
    await this.rb!.mapAsync(GPUMapMode.READ, 0, total * 4);
    const all = new Float32Array(this.rb!.getMappedRange(0, total * 4).slice(0));
    this.rb!.unmap();
    const res: Float32Array[] = [];
    off = 0;
    for (const s of sizes) { res.push(all.subarray(off, off + s)); off += s; }
    return res;
  }
}

const lum = (a: Float32Array, i: number) => 0.2126 * a[4 * i] + 0.7152 * a[4 * i + 1] + 0.0722 * a[4 * i + 2];
const tm = (x: number) => { const v = Math.max(x, 0); return v / (1 + v); };

interface Blob { cx: number; cy: number; mass: number; back: number; comps: number }
/** centroid, mass, reach behind (along -dir) and component count of the excess above thr */
function blob(e: Float32Array, w: number, h: number, ox: number, oy: number, c: [number, number], dir: [number, number], thr: number, compThr: number): Blob {
  let sx = 0, sy = 0, m = 0, back = -Infinity;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = e[y * w + x];
    if (v <= thr) continue;
    const px = ox + x + 0.5, py = oy + y + 0.5;
    sx += v * px; sy += v * py; m += v;
    back = Math.max(back, -((px - c[0]) * dir[0] + (py - c[1]) * dir[1]));
  }
  // 8-connected components above compThr with >= 3 px
  const lab = new Int32Array(w * h);
  let comps = 0;
  const stack: number[] = [];
  for (let i = 0; i < w * h; i++) {
    if (lab[i] || e[i] <= compThr) continue;
    let n = 0;
    lab[i] = -1; stack.push(i);
    while (stack.length) {
      const j = stack.pop()!;
      n++;
      const jx = j % w, jy = (j / w) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const x = jx + dx, y = jy + dy;
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const k = y * w + x;
        if (!lab[k] && e[k] > compThr) { lab[k] = -1; stack.push(k); }
      }
    }
    if (n >= 3) comps++;
  }
  return { cx: m > 0 ? sx / m : NaN, cy: m > 0 ? sy / m : NaN, mass: m, back: Number.isFinite(back) ? back : NaN, comps };
}

interface FrameRec {
  f: number; present: boolean; moving: boolean; hold: boolean; multi: number;
  ox: number; oy: number; mot: number; surfErr: number; virtErr: number;
  refPosErr: number; refMass: number;
  den: Record<string, { mse: number; n: number; posErr: number; lag: number; trail: number; ghost: number; comps: number; refComps: number; mass: number }>;
}

export interface ReflectEvalOptions {
  device: GPUDevice; width: number; height: number; path: ReflectPathDef; start: number;
  /** ROI half size in px at this resolution (default 40 * width / 960) */
  half?: number;
  /** frames whose ROIs are kept as 8-bit crops (results.reflect.crops) */
  cropFrames?: number[];
}

export class ReflectEval {
  private reader: RectReader;
  private half: number;
  private recs: FrameRec[][] = [[], []];
  private lastPos: ([number, number] | null)[] = [null, null];
  private lastDir: [number, number][] = [[1, 0], [1, 0]];
  private peak: number[] = [0, 0];
  private crops: Record<string, unknown>[] = [];
  private geo = { n: 0, viewz: [] as number[], normalDeg: [] as number[], motionPx: [] as number[], hitRel: [] as number[], idMismatch: 0 };
  constructor(private o: ReflectEvalOptions) {
    this.reader = new RectReader(o.device);
    this.half = o.half ?? Math.round(((o.path.roiHalf ?? 40) * o.width) / 960);
  }

  private cam(s: FrameState): Cam { return { eye: s.eye, target: s.target, fovy: FOVY, width: this.o.width, height: this.o.height }; }

  async frame(f: number, reset: boolean, t: { ref: GPUTexture; noisy: GPUTexture; viewz: GPUTexture; normalGeom: GPUTexture; motion: GPUTexture; hit: GPUTexture; rough: GPUTexture },
    dens: Map<string, GPUTexture>) {
    const P = this.o.path, pf = this.o.start + f;
    const cur = P.at(pf), prev = reset ? cur : P.at(pf - 1);
    const R = cur.reflect!.refl, Rp = prev.reflect!.refl;
    const cam = this.cam(cur), camP = this.cam(prev);
    const mk = [{ c: cur.obj, r: cur.reflect!.markerRadius }, { c: cur.reflect!.m2.pos, r: cur.reflect!.m2.radius }];
    const mkp = [{ c: prev.obj, r: prev.reflect!.markerRadius }, { c: prev.reflect!.m2.pos, r: prev.reflect!.m2.radius }];
    const W = this.o.width, H = this.o.height, hf = this.half, S = 2 * hf;
    const moving = !reset && pf >= 1 && pf <= P.holdFrom - 1;
    const hold = P.holdFrom >= 0 && pf >= P.holdFrom;
    const keys = [...dens.keys()];
    const allIms = mk.map((m) => markerImages(cam, R, m.c, m.r, mk));
    for (let k = 0; k < 2; k++) {
      const ims = allIms[k];
      let im = ims[0];
      if (ims.length > 1 && this.lastPos[k]) {
        const lp = this.lastPos[k]!;
        im = ims.reduce((a, b) => (Math.hypot(a.px - lp[0], a.py - lp[1]) <= Math.hypot(b.px - lp[0], b.py - lp[1]) ? a : b));
      }
      const present = !!im;
      if (!present && !this.lastPos[k]) continue;   // never seen yet: nothing to score
      const c: [number, number] = present ? [im.px, im.py] : this.lastPos[k]!;
      // true image motion and the correspondence estimates (oracle only)
      let mot = NaN, surfErr = NaN, virtErr = NaN;
      if (present && !reset) {
        const imp = markerImages(camP, Rp, mkp[k].c, mkp[k].r, mkp);
        const pi = imp.length ? imp.reduce((a, b) => (Math.hypot(a.px - c[0], a.py - c[1]) <= Math.hypot(b.px - c[0], b.py - c[1]) ? a : b)) : null;
        if (pi) {
          mot = Math.hypot(c[0] - pi.px, c[1] - pi.py);
          if (mot > 0.05) this.lastDir[k] = [(c[0] - pi.px) / mot, (c[1] - pi.py) / mot];
          const e = correspondenceEstimates(cam, camP, R, Rp, im.X, im.h, reflCurvature(R));
          if (e.surface) surfErr = Math.hypot(e.surface.x - pi.px, e.surface.y - pi.py);
          if (e.virtual) virtErr = Math.hypot(e.virtual.x - pi.px, e.virtual.y - pi.py);
        }
      }
      if (present) this.lastPos[k] = c;
      const ox = Math.min(Math.max(Math.round(c[0]) - hf, 0), W - S), oy = Math.min(Math.max(Math.round(c[1]) - hf, 0), H - S);
      const cpx = Math.min(Math.max(Math.floor(c[0]), 0), W - 1), cpy = Math.min(Math.max(Math.floor(c[1]), 0), H - 1);
      const reqs = [
        { tex: t.ref, x: ox, y: oy, w: S, h: S }, { tex: t.noisy, x: ox, y: oy, w: S, h: S }, { tex: t.rough, x: ox, y: oy, w: S, h: S },
        ...keys.map((key) => ({ tex: dens.get(key)!, x: ox, y: oy, w: S, h: S })),
        ...(present ? [t.viewz, t.normalGeom, t.motion, t.hit].map((tex) => ({ tex, x: cpx, y: cpy, w: 1, h: 1 })) : []),
      ];
      const data = await this.reader.read(reqs);
      const ref = data[0], noisy = data[1], rough = data[2];
      const N = S * S;
      // only reflector pixels count (its roughness; the floor is 0.9, markers and back faces 1.0)
      const on = new Uint8Array(N);
      // ... and not the other marker's image (a disk of half / 2 around its oracle position)
      const other = allIms[1 - k], rx = 0.5 * hf;
      for (let i = 0; i < N; i++) {
        const px = ox + (i % S) + 0.5, py = oy + ((i / S) | 0) + 0.5;
        on[i] = Math.abs(rough[4 * i] - R.rough) < 0.01 && !other.some((q) => Math.hypot(q.px - px, q.py - py) < rx) ? 1 : 0;
      }
      const nOn = on.reduce((a, b) => a + b, 0);
      const yr = new Float32Array(N);
      for (let i = 0; i < N; i++) yr[i] = on[i] ? lum(ref, i) : 0;
      const bg = nOn ? [...yr].filter((_, i) => on[i]).sort((a, b) => a - b)[nOn >> 1] : 0;
      const er = yr.map((v, i) => (on[i] ? Math.max(v - bg, 0) : 0));
      const pkNow = er.reduce((a, b) => Math.max(a, b), 0);
      if (present) this.peak[k] = Math.max(this.peak[k] * 0.5, pkNow);   // tracks the present image's peak
      const pk = present ? pkNow : this.peak[k];
      const dir = this.lastDir[k];
      const bRef = blob(er, S, S, ox, oy, c, dir, 0.1 * pk, 0.25 * pk);
      // reference blob mask (10 %), dilated 2 px
      const mask = new Uint8Array(N);
      if (present) for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        if (er[y * S + x] <= 0.1 * pk) continue;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < S && yy < S) mask[yy * S + xx] = 1;
        }
      }
      const refMass = present ? bRef.mass : 0;
      const rec: FrameRec = {
        f: pf, present, moving, hold, multi: ims.length, ox, oy, mot, surfErr, virtErr,
        refPosErr: present ? Math.hypot(bRef.cx - c[0], bRef.cy - c[1]) : NaN, refMass, den: {},
      };
      const score = (a: Float32Array, key: string) => {
        let sse = 0;
        const e = new Float32Array(N);
        let ghost = 0;
        for (let i = 0; i < N; i++) {
          if (!on[i]) continue;
          for (let ch = 0; ch < 3; ch++) { const dd = tm(a[4 * i + ch]) - tm(ref[4 * i + ch]); sse += dd * dd; }
          e[i] = Math.max(lum(a, i) - bg, 0);
          if (!mask[i]) ghost += Math.max(e[i] - 0.05 * pk, 0);
        }
        const b = blob(e, S, S, ox, oy, c, dir, 0.1 * pk, 0.25 * pk);
        const rc = present ? bRef : { comps: 0, back: NaN } as Blob;
        rec.den[key] = {
          mse: sse / Math.max(3 * nOn, 1), n: 3 * nOn,
          posErr: present ? Math.hypot(b.cx - c[0], b.cy - c[1]) : NaN,
          lag: present ? (b.cx - c[0]) * dir[0] + (b.cy - c[1]) * dir[1] : NaN,
          trail: present && Number.isFinite(b.back) ? Math.max(0, b.back - (Number.isFinite(rc.back) ? rc.back : 0)) : NaN,
          ghost, comps: b.comps, refComps: rc.comps, mass: b.mass,
        };
      };
      score(noisy, 'noisy');
      keys.forEach((key, i) => score(data[3 + i], key));
      this.recs[k].push(rec);
      // guide checks at the oracle pixel (CPU ray through the pixel centre)
      if (present) {
        const g = data.slice(3 + keys.length);
        const d = rayThrough(cam, cpx + 0.5, cpy + 0.5);
        const hit = traceScene(R, mk, cam.eye, d);
        if (hit && hit.id === 'reflector') {
          const X = add(cam.eye, mul(d, hit.t));
          const f3 = unit(sub(cam.target, cam.eye));
          this.geo.n++;
          this.geo.viewz.push(Math.abs(-g[0][0] - dot(sub(X, cam.eye), f3)));
          const ng: V3 = [g[1][0], g[1][1], g[1][2]];
          this.geo.normalDeg.push((Math.acos(Math.min(1, Math.max(-1, dot(unit(ng), hit.n)))) * 180) / Math.PI);
          if (!reset) {
            const L = sub(X, R.pos);
            const cl = Math.cos(-R.angle), sl = Math.sin(-R.angle);
            const loc: V3 = [cl * L[0] + sl * L[2], L[1], -sl * L[0] + cl * L[2]];
            const cp = Math.cos(Rp.angle), sp = Math.sin(Rp.angle);
            const Xp: V3 = add(Rp.pos, [cp * loc[0] + sp * loc[2], loc[1], -sp * loc[0] + cp * loc[2]]);
            const a = projectPx(cam, X), b = projectPx(camP, Xp);
            if (a && b) {
              // GPU motion is an NDC delta (current - previous, +y up): back to pixels
              const gm: [number, number] = [g[2][0] * W * 0.5, -g[2][1] * H * 0.5];
              this.geo.motionPx.push(Math.hypot(gm[0] - (a.x - b.x), gm[1] - (a.y - b.y)));
            }
          }
          if (R.rough <= 0.05 && R.bump === 0) {
            const rd = sub(d, mul(hit.n, 2 * dot(d, hit.n)));
            const h2 = traceScene(R, mk, add(X, mul(hit.n, 1e-3)), unit(rd));
            const gh = g[3][0];
            if (h2 && gh > 0) this.geo.hitRel.push(Math.abs(gh - h2.t) / h2.t);
          }
        } else this.geo.idMismatch++;
      }
      // crops
      if (this.o.cropFrames?.includes(pf)) {
        const enc = (a: Float32Array) => {
          const b = new Uint8Array(N * 3);
          for (let i = 0; i < N; i++) for (let ch = 0; ch < 3; ch++) b[i * 3 + ch] = Math.round(255 * Math.pow(tm(a[4 * i + ch]), 1 / 2.2));
          let s = '';
          for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
          return btoa(s);
        };
        this.crops.push({ frame: pf, marker: k + 1, ox, oy, size: S, oracle: c, present, images: { ref: enc(ref), noisy: enc(noisy), ...Object.fromEntries(keys.map((key, i) => [key, enc(data[3 + i])])) } });
      }
    }
  }

  summary() {
    const P = this.o.path;
    const psnr = (sse: number, n: number) => (n > 0 ? 10 * Math.log10(1 / Math.max(sse / n, 1e-12)) : NaN);
    const mean = (xs: number[]) => { const v = xs.filter(Number.isFinite); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN; };
    const r3 = (x: number) => (Number.isFinite(x) ? +x.toFixed(3) : null);
    const markers = this.recs.map((recs, k) => {
      if (!recs.length) return null;
      const keys = Object.keys(recs[0].den);
      const mov = recs.filter((r) => r.moving && r.present);
      const hold = recs.filter((r) => r.hold && r.present);
      const absentAfter = recs.filter((r) => !r.present);
      const presentMass = mean(recs.filter((r) => r.present).map((r) => r.refMass));
      const per = Object.fromEntries(keys.map((key) => {
        const pool = (rs: FrameRec[]) => psnr(rs.reduce((a, r) => a + r.den[key].mse * r.den[key].n, 0), rs.reduce((a, r) => a + r.den[key].n, 0));
        const settled = hold.slice(-8);
        const settledDb = pool(settled);
        // recovery: frames from the first held frame until the per-frame ROI PSNR stays within 1 dB of settled
        let recovery: number | null = null;
        if (hold.length >= 10) {
          let last = -1;
          hold.forEach((r, i) => { if (psnr(r.den[key].mse, 1) < settledDb - 1) last = i; });
          recovery = last + 1;
        }
        let ghostGone: number | null = null;
        if (absentAfter.length && Number.isFinite(presentMass) && presentMass > 0) {
          let last = -1;
          absentAfter.forEach((r, i) => { if (r.den[key].mass > 0.05 * presentMass) last = i; });
          ghostGone = last + 1;
        }
        const g = (rs: FrameRec[], f: (r: FrameRec) => number) => r3(mean(rs.map(f)));
        return [key, {
          roiPsnrMoving: r3(pool(mov)), roiPsnrHold: r3(pool(hold)), roiPsnrSettled: r3(settledDb), roiPsnrAll: r3(pool(recs.filter((r) => r.present))),
          posErrMoving: g(mov, (r) => r.den[key].posErr), lagMoving: g(mov, (r) => r.den[key].lag),
          trailMoving: g(mov, (r) => r.den[key].trail), ghostMoving: g(mov, (r) => r.den[key].ghost / Math.max(r.refMass, 1e-9)),
          dupFramesMoving: mov.filter((r) => r.den[key].comps > r.den[key].refComps).length,
          ghostHold1: hold.length ? r3(hold[0].den[key].ghost / Math.max(hold[0].refMass, 1e-9)) : null,
          ghostHold4: hold.length > 3 ? r3(hold[3].den[key].ghost / Math.max(hold[3].refMass, 1e-9)) : null,
          posErrHold1: hold.length ? r3(hold[0].den[key].posErr) : null,
          recovery, ghostGone, absentFrames: absentAfter.length,
        }];
      }));
      return {
        marker: k + 1, frames: recs.length, presentFrames: recs.filter((r) => r.present).length, movingFrames: mov.length, holdFrames: hold.length,
        multiImageFrames: recs.filter((r) => r.multi > 1).length,
        imageMotionPx: r3(mean(mov.map((r) => r.mot))),
        oracleSurfaceErrPx: r3(mean(mov.map((r) => r.surfErr))), oracleVirtualErrPx: r3(mean(mov.map((r) => r.virtErr))),
        refPosErrPx: r3(mean(recs.filter((r) => r.present).map((r) => r.refPosErr))),
        results: per,
        perFrame: recs.map((r) => ({ f: r.f, present: r.present, mot: r3(r.mot), refPosErr: r3(r.refPosErr),
          den: Object.fromEntries(keys.map((key) => [key, [r3(psnr(r.den[key].mse, 1)), r3(r.den[key].posErr), r3(r.den[key].lag), r3(r.den[key].trail), r3(r.den[key].ghost / Math.max(r.refMass || this.peak[k], 1e-9)), r.den[key].comps, r.den[key].refComps]])) })),
      };
    });
    const st = (xs: number[]) => ({ n: xs.length, mean: r3(mean(xs)), max: r3(xs.length ? Math.max(...xs) : NaN) });
    return {
      path: P.id, moves: P.moves, holdFrom: P.holdFrom, roiHalf: this.half,
      geometry: { checkedPixels: this.geo.n, nonReflectorHits: this.geo.idMismatch, viewzAbs: st(this.geo.viewz), normalDeg: st(this.geo.normalDeg), motionPx: st(this.geo.motionPx), hitDistRel: st(this.geo.hitRel) },
      markers, crops: this.crops,
    };
  }
}
