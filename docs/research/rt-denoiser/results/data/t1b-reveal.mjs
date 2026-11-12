#!/usr/bin/env node
// T1b reveal scorer (results/T1b-spatial-repair.md): scores replay outputs of a STATIC-CAMERA reveal capture (test-bed
// paths rv-narrow / rv-medium / rv-wide, or any capture whose camera does not move) on fixed pixel sets, so the same
// newly revealed surfaces are followed over time (audit priority 4), not unrelated pixels grouped by age. Our tool.
//
//   reveal   a pixel is revealed at frame f when its |viewz| grows by > 5 % from frame f-1 (a nearer occluder left it)
//            and covered when it shrinks by > 5 % (an occluder arrived; the pixel then leaves every set until it is
//            revealed again). Frame 0 counts as "revealed at 0" for every pixel (the reset).
//   sets     j-curve: every pixel revealed at frame r >= 1 and not covered since, scored at time since reveal j = f - r
//            (0..47); event set E: pixels revealed at frames [--from, --to] and still uncovered at the last frame,
//            scored per frame (one curve over the whole capture: the same surfaces before nothing / after the reveal);
//            static control: pixels never revealed or covered after frame 0
//   per set  PSNR (Reinhard per channel, as compare.mjs / t1-score.mjs), signed bias (mean of out - ref, same values),
//            boundary = set pixels within 2 px of a depth edge (4-neighbour |dz| > 5 % |z|; where foreground colour would
//            leak into the revealed surface), mid band = 9x9 minus 33x33 box mean of the signed error (blotch-sized
//            structure without smooth bias; t1-score's definition), FLIP (test-bed ppd) every --flip-every frames,
//            boil = RMS second temporal difference of the output at the pixel / sqrt(6) (static camera: this is the
//            motion-compensated boil; needs j >= 2), with the reference's own boil in the same pixels
//
//   node t1b-reveal.mjs <capture> --den a,b,c [--signals diffuse,specular] [--from 16] [--to 47] [--outputs <root>]
//        [--flip-every 4] [--json out.json]
import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const REPO = new URL('../../../../../', import.meta.url).pathname.replace(/\/$/, '');
const cap = await import(`${REPO}/tools/rt-capture/lib/capture.mjs`);
const flip = await import(`${REPO}/examples/realtime-denoiser/src/flip.ts`);

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i < 0 ? d : args[i + 1]; };
const capName = args[0];
const capDir = cap.resolveCapture(capName);
const outRoot = path.join(path.resolve(opt('outputs', cap.OUTPUTS_DIR)), path.basename(capDir));
const dens = opt('den', '').split(',').filter(Boolean);
const m = cap.readManifest(capDir);
const W = m.width, H = m.height, N = W * H, F = m.frames.length;
const chOf = Object.fromEntries(m.buffers.map((b) => [b.name, b.channels]));
const signals = opt('signals', 'diffuse,specular').split(',').filter((s) => chOf[s] && chOf[`${s}_ref`]);
const FROM = Number(opt('from', 1)), TO = Number(opt('to', F - 1));
const FLIP_EVERY = Number(opt('flip-every', 4));
const PPD = W / 46.4;
const NJ = 48;

const tm = (x, ch) => (ch === 1 ? Math.min(Math.max(x, 0), 1) : x > 0 ? x / (1 + x) : 0);
const finite = (x) => (Number.isFinite(x) ? x : 0);

// ---- pass 1: reveal frames per pixel (needs the whole sequence for the event set)
const rev = new Int32Array(N);   // last reveal frame, -1 while covered
const vzs = [];
let prev = null;
const revAt = [];                // per frame: copy of rev after that frame
const scoredAt = [];
const edgeAt = [];
for (let f = 0; f < F; f++) {
  const depth = cap.readBuffer(capDir, f, 'depth');
  const vz = cap.readBuffer(capDir, f, 'viewz');
  const scored = new Uint8Array(N);
  for (let i = 0; i < N; i++) scored[i] = depth[i] > 0 && depth[i] < 1 ? 1 : 0;
  if (f === 0 || m.frames[f].reset) rev.fill(f);
  else {
    for (let i = 0; i < N; i++) {
      const a = Math.abs(prev[i]), b = Math.abs(vz[i]);
      if (b > a * 1.05) rev[i] = f;
      else if (b < a * 0.95) rev[i] = -1;
    }
  }
  // depth edges, dilated by 2 px
  const edge = new Uint8Array(N), band = new Uint8Array(N);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, z = vz[i];
    const zl = vz[y * W + Math.max(x - 1, 0)], zr = vz[y * W + Math.min(x + 1, W - 1)];
    const zu = vz[Math.max(y - 1, 0) * W + x], zd = vz[Math.min(y + 1, H - 1) * W + x];
    const jump = Math.max(Math.abs(zr - z), Math.abs(z - zl), Math.abs(zd - z), Math.abs(z - zu));
    if (jump > 0.05 * Math.abs(z)) edge[i] = 1;
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!edge[y * W + x]) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const qx = x + dx, qy = y + dy;
      if (qx >= 0 && qy >= 0 && qx < W && qy < H) band[qy * W + qx] = 1;
    }
  }
  revAt.push(Int32Array.from(rev));
  scoredAt.push(scored);
  edgeAt.push(band);
  prev = vz;
}
const last = revAt[F - 1];
const inE = new Uint8Array(N);
let nE = 0;
for (let i = 0; i < N; i++) if (scoredAt[F - 1][i] && last[i] >= FROM && last[i] <= TO && last[i] > 0) { inE[i] = 1; nE++; }
const inStatic = new Uint8Array(N);
for (let i = 0; i < N; i++) {
  let ok = scoredAt[F - 1][i] === 1;
  for (let f = 1; f < F && ok; f++) if (revAt[f][i] !== 0) ok = false;
  inStatic[i] = ok ? 1 : 0;
}
process.stderr.write(`${capName}: event set ${nE} px (revealed in [${FROM}, ${TO}]), static ${inStatic.reduce((a, b) => a + b, 0)} px\n`);

// ---- pass 2: scores
const newAcc = () => ({
  j: { sse: new Float64Array(NJ), cnt: new Float64Array(NJ), boil: new Float64Array(NJ), boilN: new Float64Array(NJ), refBoil: new Float64Array(NJ),
    bSse: new Float64Array(NJ), bCnt: new Float64Array(NJ), mid: new Float64Array(NJ), midN: new Float64Array(NJ), bias: new Float64Array(NJ) },
  frames: [],   // per frame: event set { sse, cnt, bSse, bCnt, mid, midN, bias, boil, boilN, refBoil, flip } and static { sse, cnt, boil, boilN }
});
const acc = {};
const hist = {};
for (const s of signals) for (const d of dens) {
  if (!existsSync(path.join(outRoot, d, cap.frameDir(0), `${s}.f32`))) { process.stderr.write(`missing ${s} ${d}\n`); continue; }
  acc[`${s}|${d}`] = newAcc();
}
const refHist = {};
for (let f = 0; f < F; f++) {
  const scored = scoredAt[f], band = edgeAt[f], rv = revAt[f];
  const jOf = (i) => (rv[i] >= 1 ? f - rv[i] : -1);
  const doFlip = f % FLIP_EVERY === 0;
  for (const s of signals) {
    const ch = chOf[s];
    const ref = cap.readBuffer(capDir, f, `${s}_ref`);
    const refS = new Float32Array(N);
    for (let i = 0; i < N; i++) { let v = 0; for (let c = 0; c < ch; c++) v += tm(ref[i * ch + c], ch); refS[i] = v / ch; }
    const rh = refHist[s];
    const toRgb = (a, och) => {
      const o = new Float32Array(N * 3);
      for (let i = 0; i < N; i++) for (let c = 0; c < 3; c++) o[3 * i + c] = scored[i] ? tm(finite(a[i * och + (och === 1 ? 0 : Math.min(c, och - 1))]), ch) : 0;
      return o;
    };
    const refPrep = doFlip && nE ? flip.prepareFlip(toRgb(ref, ch), W, H, PPD) : null;
    for (const d of dens) {
      const key = `${s}|${d}`;
      const a = acc[key];
      if (!a) continue;
      const out = cap.readF32(path.join(outRoot, d, cap.frameDir(f), `${s}.f32`));
      const och = out.length / N;
      const outS = new Float32Array(N), err = new Float32Array(N);
      const fr = { f, E: { sse: 0, cnt: 0, bSse: 0, bCnt: 0, mid: 0, midN: 0, bias: 0, boil: 0, boilN: 0, refBoil: 0, flip: null }, S: { sse: 0, cnt: 0, boil: 0, boilN: 0 } };
      const h = hist[key];
      for (let i = 0; i < N; i++) {
        if (!scored[i]) continue;
        let e2 = 0, es = 0, os = 0;
        for (let c = 0; c < ch; c++) {
          const ov = tm(finite(out[i * och + Math.min(c, och - 1)]), ch), e = ov - tm(ref[i * ch + c], ch);
          e2 += e * e; es += e; os += ov;
        }
        es /= ch; os /= ch; outS[i] = os; err[i] = es;
        const j = jOf(i);
        const live = rv[i] >= 0;
        const bo = h && h[1] ? os - 2 * h[0][i] + h[1][i] : NaN;
        const br = rh && rh[1] ? refS[i] - 2 * rh[0][i] + rh[1][i] : NaN;
        if (j >= 0 && j < NJ) {
          a.j.sse[j] += e2; a.j.cnt[j] += ch; a.j.bias[j] += es;
          if (band[i]) { a.j.bSse[j] += e2; a.j.bCnt[j] += ch; }
          if (j >= 2 && Number.isFinite(bo)) { a.j.boil[j] += bo * bo; a.j.boilN[j]++; if (Number.isFinite(br)) a.j.refBoil[j] += br * br; }
        }
        if (inE[i] && live) {
          fr.E.sse += e2; fr.E.cnt += ch; fr.E.bias += es;
          if (band[i]) { fr.E.bSse += e2; fr.E.bCnt += ch; }
          // boil only once the pixel has shown its final surface for 3 frames
          if (Number.isFinite(bo) && f - rv[i] >= 2) { fr.E.boil += bo * bo; fr.E.boilN++; if (Number.isFinite(br)) fr.E.refBoil += br * br; }
        }
        if (inStatic[i]) {
          fr.S.sse += e2; fr.S.cnt += ch;
          if (Number.isFinite(bo)) { fr.S.boil += bo * bo; fr.S.boilN++; }
        }
      }
      // mid band of the signed error over receivers (t1-score: 9x9 box minus 33x33 box)
      {
        const IW = W + 1;
        const si = new Float64Array(IW * (H + 1)), ci = new Float64Array(IW * (H + 1));
        for (let y = 0; y < H; y++) {
          let rs = 0, rc = 0;
          for (let x = 0; x < W; x++) {
            const i = y * W + x;
            if (scored[i]) { rs += err[i]; rc++; }
            si[(y + 1) * IW + x + 1] = si[y * IW + x + 1] + rs;
            ci[(y + 1) * IW + x + 1] = ci[y * IW + x + 1] + rc;
          }
        }
        const box = (x, y, r) => {
          const x0 = Math.max(x - r, 0), x1 = Math.min(x + r + 1, W), y0 = Math.max(y - r, 0), y1 = Math.min(y + r + 1, H);
          return [si[y1 * IW + x1] - si[y0 * IW + x1] - si[y1 * IW + x0] + si[y0 * IW + x0], ci[y1 * IW + x1] - ci[y0 * IW + x1] - ci[y1 * IW + x0] + ci[y0 * IW + x0]];
        };
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          const i = y * W + x;
          if (!scored[i]) continue;
          const j = jOf(i);
          const inSet = inE[i] && rv[i] >= 0;
          if (!(j >= 0 && j < NJ) && !inSet) continue;
          const [s9, c9] = box(x, y, 4), [s33, c33] = box(x, y, 16);
          const mid = s9 / c9 - s33 / c33;
          if (j >= 0 && j < NJ) { a.j.mid[j] += mid * mid; a.j.midN[j]++; }
          if (inSet) { fr.E.mid += mid * mid; fr.E.midN++; }
        }
      }
      if (refPrep) {
        const tp = flip.prepareFlip(toRgb(out, och), W, H, PPD);
        const mask = new Uint8Array(N);
        for (let i = 0; i < N; i++) mask[i] = inE[i] && rv[i] >= 0 && scored[i] ? 1 : 0;
        fr.E.flip = flip.flipMean(refPrep, tp, mask);
      }
      a.frames.push(fr);
      hist[key] = [outS, h ? h[0] : null];
    }
    refHist[s] = [refS, rh ? rh[0] : null];
  }
  process.stderr.write(`\r${capName} frame ${f + 1}/${F}`);
}
process.stderr.write('\n');
const res = { capture: capName, width: W, height: H, frames: F, from: FROM, to: TO, eventPx: nE, signals, denoisers: dens, flipEvery: FLIP_EVERY, acc: {} };
for (const [k, a] of Object.entries(acc)) {
  res.acc[k] = { j: Object.fromEntries(Object.entries(a.j).map(([kk, v]) => [kk, Array.from(v)])), frames: a.frames };
}
const jout = opt('json', path.join(process.cwd(), `t1b-reveal-${capName}.json`));
writeFileSync(jout, JSON.stringify(res));
console.log(`wrote ${jout}`);
