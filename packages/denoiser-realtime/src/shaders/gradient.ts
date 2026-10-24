// A-SVGF temporal gradients (anti-lag) for one or two signals per dispatch:
// per-stratum gradient samples, then an edge-aware a-trous reconstruction at
// stratum resolution; the temporal pass turns the result into a per-pixel
// alpha boost (svgf.ts `antilagLambda`).
//
// Sources (public; see docs/research/rt-denoiser/PROVENANCE.md):
// - Schied, Peters, Dachsbacher 2018, "Gradient Estimation for Real-Time
//   Adaptive Temporal Filtering" (A-SVGF), PACMCGIT 1(2) art. 24: sec. 3.1-3.3
//   gradient samples on 3x3 strata, delta = f_i(fwd) - f_{i-1}(old), luminance
//   only; sec. 3.4 reconstruction with a 5-level joint-bilateral a-trous at
//   stratum resolution (3x3 box), normalizer Delta = max(f_i, f_{i-1}) filtered
//   like delta; sec. 3.5 lambda = min(1, |delta| / Delta).
// - A-SVGF reference code (a_svgf.zip, BSD-3, Copyright (c) 2018 Christoph
//   Schied; see NOTICE): CreateGradientSamples.frag (per-stratum luminance
//   moments, (Delta, delta) layout), AtrousGradient.frag (weights: Gaussian
//   luminance term with sigma = 3 sqrt(g3x3(var)), depth term with the stored
//   depth derivative x offset; no normal term).
//
// Two sources for the gradient sample (option `antiLag`):
// - 'gradient': the renderer supplies forward-projected, re-shaded samples
//   (A-SVGF proper, needs RNG-seed reuse; see README for the texture layout).
// - 'auto' (our design, since most renderers can't re-shade old samples): the
//   stratum's mean noisy luminance this frame vs the mean of the reprojected
//   *temporally accumulated* luminance (pre-spatial-filter history). The noise
//   of the current mean is carried as var(delta) through the reconstruction and
//   subtracted (k sigma) before the ratio, so static noise doesn't read as change.
import { Bindings, type PassDef } from './bindings';
import { FRAME_WGSL, REPROJECT_WGSL } from './common';
import { PARAMS_STRUCT } from './svgf';

/** Stratum size (A-SVGF: 3x3 strata, <= 11 % of samples recycled). */
export const GRADIENT_DOWNSAMPLE = 3;

export function gradientCreatePass(count: number, fromInput: boolean): PassDef {
  const I = [...Array(count).keys()];
  const b = new Bindings();
  b.uniform('F', 'Frame');
  I.forEach((i) => b.uniform(`P${i}`, 'Params'));
  b.add('geoCur', 'texture_2d<u32>', 'i');
  b.add('geoPrev', 'texture_2d<u32>', 'i');
  b.add('geoGrad', 'texture_2d<u32>', 'i');
  b.add('motionTex', 'texture_2d<f32>', 'f');
  b.add('motionZTex', 'texture_2d<f32>', 'f');
  I.forEach((i) => {
    b.add(`input${i}`, 'texture_2d<f32>', 'f');
    b.add(`accumPrev${i}`, 'texture_2d<f32>', 'f');
    b.add(`gradInput${i}`, 'texture_2d<f32>', 'f');
    b.add(`outG0${i}`, 'texture_storage_2d<rgba32float, write>', 'rgba32float');   // delta, Delta, var(delta), valid
    b.add(`outG1${i}`, 'texture_storage_2d<rgba32float, write>', 'rgba32float');   // mean l, var l, z, |dz|
  });
  const code = /* wgsl */ `
${FRAME_WGSL}
${PARAMS_STRUCT}
${b.wgsl}
${REPROJECT_WGSL}

// One thread per pixel in 9x9 workgroups (3x3 strata each); every pixel does
// its own reprojection, then one thread per stratum reduces its 9 pixels from
// workgroup memory (9x more parallel than a thread per stratum).
${I.map((i) => `var<workgroup> wL${i}: array<vec4f, 81>;   // l, l^2, valid, l_hist`).join('\n')}
var<workgroup> wH: array<vec4f, 81>;   // history valid, z, |dz|, 0

@compute @workgroup_size(9, 9)
fn main(@builtin(global_invocation_id) gid: vec3u, @builtin(local_invocation_id) lid: vec3u) {
  let p = vec2i(gid.xy);
  let li = lid.y * 9u + lid.x;
  ${I.map((i) => `var a${i} = vec4f(0.0);`).join(' ')}
  var hb = vec4f(0.0);
  if (inside(p)) {
    let g0 = geoTap(geoCur, p);
    if (g0.z > 0.0) {
      var g = g0;
      g.grad = unpack2x16float(textureLoad(geoGrad, p, 0).r);
      hb = vec4f(0.0, g.z, max(abs(g.grad.x), abs(g.grad.y)), 0.0);
      ${I.map((i) => `{ let l = luma(max(textureLoad(input${i}, p, 0).rgb, vec3f(0.0))); a${i} = vec4f(l, l * l, 1.0, 0.0); }`).join('\n      ')}
      ${fromInput ? '' : /* wgsl */ `
      if (!hasFlag(FRAME_RESET)) {
        let r = reproject(p, g, P0.planeTol, P0.normalTol);
        if (r.sumW > 0.01) {
          hb.x = 1.0;
          for (var k = 0; k < 4; k++) {
            if (r.w[k] <= 0.0) { continue; }
            let q = r.base + TAP_OFFS[k];
            ${I.map((i) => `a${i}.w += luma(textureLoad(accumPrev${i}, q, 0).rgb) * r.w[k];`).join('\n            ')}
          }
          ${I.map((i) => `a${i}.w /= r.sumW;`).join(' ')}
        }
      }`}
    }
  }
  ${I.map((i) => `wL${i}[li] = a${i};`).join(' ')}
  wH[li] = hb;
  workgroupBarrier();
  if (lid.x % 3u != 0u || lid.y % 3u != 0u) { return; }
  let s = p / 3;
  if (s.x >= P0.gradDims.x || s.y >= P0.gradDims.y) { return; }
  ${I.map((i) => /* wgsl */ `
  {
    var sumL = 0.0; var sumL2 = 0.0; var cnt = 0.0;
    var sumC = 0.0; var sumH = 0.0; var cntH = 0.0;
    var zc = 0.0; var dzc = 0.0;
    for (var yy = 0u; yy < 3u; yy++) {
      for (var xx = 0u; xx < 3u; xx++) {
        let j = (lid.y + yy) * 9u + lid.x + xx;
        let va = wL${i}[j];
        let vb = wH[j];
        if (va.z <= 0.0) { continue; }
        sumL += va.x; sumL2 += va.y; cnt += 1.0;
        if (zc == 0.0 || (xx == 1u && yy == 1u)) { zc = vb.y; dzc = vb.z; }
        if (vb.x > 0.0) { sumH += va.w; sumC += va.x; cntH += 1.0; }
      }
    }
    var g1 = vec4f(0.0);
    var g0 = vec4f(0.0);
    if (cnt > 0.0) {
      let m = sumL / cnt;
      let v = max(0.0, sumL2 / cnt - m * m);
      g1 = vec4f(m, v, zc, dzc);
      ${fromInput ? /* wgsl */ `
      let gi = textureLoad(gradInput${i}, s, 0);   // (l_prev, l_curr, valid)
      if (gi.z > 0.0 && !hasFlag(FRAME_RESET)) {
        g0 = vec4f(gi.y - gi.x, max(gi.x, gi.y), 0.0, 1.0);
      }` : /* wgsl */ `
      if (cntH > 0.0) {
        let mc = sumC / cntH;
        let mh = sumH / cntH;
        g0 = vec4f(mc - mh, max(mc, mh), v / cntH, 1.0);
      }`}
    }
    textureStore(outG0${i}, s, g0);
    textureStore(outG1${i}, s, g1);
  }`).join('')}
}
`;
  return { code, entries: b.entries };
}

export function gradientAtrousPass(count: number): PassDef {
  const I = [...Array(count).keys()];
  const b = new Bindings();
  I.forEach((i) => b.uniform(`P${i}`, 'Params'));
  b.uniform('It', 'Iter');
  I.forEach((i) => {
    b.add(`inG0${i}`, 'texture_2d<f32>', 'f');
    b.add(`inG1${i}`, 'texture_2d<f32>', 'f');
    b.add(`outG0${i}`, 'texture_storage_2d<rgba32float, write>', 'rgba32float');
    b.add(`outG1${i}`, 'texture_storage_2d<rgba32float, write>', 'rgba32float');
  });
  const code = /* wgsl */ `
${PARAMS_STRUCT}
struct Iter { stride: i32, iteration: i32, pad0: i32, pad1: i32 }
${b.wgsl}

fn inStrata(q: vec2i) -> bool { return q.x >= 0 && q.y >= 0 && q.x < P0.gradDims.x && q.y < P0.gradDims.y; }

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let s = vec2i(gid.xy);
  if (!inStrata(s)) { return; }
  ${I.map((i) => /* wgsl */ `
  {
    let c0 = textureLoad(inG0${i}, s, 0);
    let c1 = textureLoad(inG1${i}, s, 0);
    if (c1.z <= 0.0) {
      textureStore(outG0${i}, s, c0);
      textureStore(outG1${i}, s, c1);
    } else {
      var gv = 0.0;
      for (var dy = -1; dy <= 1; dy++) {
        for (var dx = -1; dx <= 1; dx++) {
          let k = (2.0 - f32(abs(dx))) * (2.0 - f32(abs(dy))) / 16.0;
          gv += textureLoad(inG1${i}, clamp(s + vec2i(dx, dy), vec2i(0), P0.gradDims - 1), 0).g * k;
        }
      }
      let sl = 3.0 * sqrt(max(gv, 0.0)) + 1e-10;
      var s0 = c0; var sL = c1.x; var sV = c1.y; var sw = 1.0; var sVarD = c0.z;
      for (var dy = -1; dy <= 1; dy++) {
        for (var dx = -1; dx <= 1; dx++) {
          if (dx == 0 && dy == 0) { continue; }
          let off = vec2i(dx, dy) * It.stride;
          let q = s + off;
          if (!inStrata(q)) { continue; }
          let q1 = textureLoad(inG1${i}, q, 0);
          if (q1.z <= 0.0) { continue; }
          let q0 = textureLoad(inG0${i}, q, 0);
          let wl = abs(q1.x - c1.x) / sl;
          let wz = abs(q1.z - c1.z) / (c1.w * length(vec2f(off)) * f32(P0.gradDown) + 1e-2 * c1.z);
          let w = exp(-wl * wl - wz);
          s0 += q0 * w; sVarD += q0.z * w * w;
          sL += q1.x * w; sV += q1.y * w * w; sw += w;
        }
      }
      var o0 = s0 / sw;
      o0.z = sVarD / (sw * sw);
      textureStore(outG0${i}, s, o0);
      textureStore(outG1${i}, s, vec4f(sL / sw, sV / (sw * sw), c1.z, c1.w));
    }
  }`).join('')}
}
`;
  return { code, entries: b.entries };
}

/**
 * lambda = min(1, |delta| / Delta) per stratum, max over a (2r+1)^2
 * neighbourhood of strata (A-SVGF sec. 3.5, p.9 safety margin), written once
 * at stratum resolution so the temporal pass reads one texel. 'auto' subtracts
 * a noise floor k sigma_delta first (our design).
 */
export function gradientLambdaPass(count: number): PassDef {
  const I = [...Array(count).keys()];
  const b = new Bindings();
  I.forEach((i) => b.uniform(`P${i}`, 'Params'));
  I.forEach((i) => {
    b.add(`inG0${i}`, 'texture_2d<f32>', 'f');
    b.add(`outL${i}`, 'texture_storage_2d<r32float, write>', 'r32float');
  });
  const code = /* wgsl */ `
${PARAMS_STRUCT}
${b.wgsl}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let s = vec2i(gid.xy);
  if (s.x >= P0.gradDims.x || s.y >= P0.gradDims.y) { return; }
  ${I.map((i) => /* wgsl */ `
  {
    var lam = 0.0;
    for (var dy = -P${i}.gradRadius; dy <= P${i}.gradRadius; dy++) {
      for (var dx = -P${i}.gradRadius; dx <= P${i}.gradRadius; dx++) {
        let q = clamp(s + vec2i(dx, dy), vec2i(0), P${i}.gradDims - 1);
        let v = textureLoad(inG0${i}, q, 0);   // (delta, Delta, var(delta), valid)
        if (v.w <= 0.0 || v.y <= 1e-6) { continue; }
        var d = abs(v.x);
        if ((P${i}.flags & P_GRADIENT_INPUT) == 0u) { d = max(0.0, d - P${i}.gradNoiseK * sqrt(max(v.z, 0.0))); }
        lam = max(lam, d / v.y);
      }
    }
    textureStore(outL${i}, s, vec4f(clamp(lam, 0.0, 1.0)));
  }`).join('')}
}
`;
  return { code, entries: b.entries };
}
