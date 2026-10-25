// SVGF passes with a directional payload (`payload: 'sh'`, SPEC v0.3 §8.5, M7-5..M7-9):
// the plain passes of shaders/svgf.ts with six channels (L1 luma + L0 chroma, one
// rgba32uint per buffer) filtered with the plain weights. Every scalar the filter uses
// (moments, variance, luminance edge-stop, anti-lag) is the Rec. 709 luminance of the
// payload evaluated at the filter's normal (M7-5), so the tuned SVGF constants carry
// over; all six channels share one weight per tap (M7-6). In the a-trous luminance weight every
// tap's payload is evaluated at the CENTRE's direction (normal / dominant direction), not its own:
// like is compared with like, no per-tap dominant-direction ALU, and it measured equal or slightly
// better than per-tap directions (dev page: +0.01..+0.02 dB). The plain passes are kept
// separate and untouched, so `payload: 'radiance'` stays bit-identical.
//
// Sources: as shaders/svgf.ts (Schied et al. 2017 / 2018 and the A-SVGF BSD-3 code),
// plus shaders/sh.ts for the payload. Per-pass changes: SPEC M7-7 (our design).
import { Bindings, type PassDef } from './bindings';
import { FRAME_WGSL, REPROJECT_WGSL } from './common';
import { SH_CORE_WGSL, SH_RESOLVE_CORE_WGSL, shEncodeWgsl, type ShEncoding } from './sh';
import {
  antilagWgsl, B3, baseBindings, capWgsl, f32s, header, PARAMS_STRUCT, weightsWgsl, type AtrousVariant, type SignalKind,
} from './svgf';

/** How a signal's sample arrives: 'raw' = radiance + direction (encoded on load), 'enc' = an encoded payload texture. */
export type ShInputForm = 'raw' | 'enc';
/** What the last a-trous iteration writes per signal: the resolve-ready payload, or the resolved rgb. */
export type ShResolve = 'none' | 'fused';

/**
 * SH-mode fields of the 256-byte Params buffer, after the plain struct's fields (the
 * plain passes never read past `varRadius`; the three pads become SH fields here).
 */
export const PARAMS_STRUCT_SH = PARAMS_STRUCT.replace(
  'varRadius: i32, pad0: i32, pad1: i32, pad2: i32,',
  'varRadius: i32, shGuard: f32, shSharpen: f32, shFlags: u32,\n  shLightSharp: f32, shRhoMax: f32, shFadeR: f32, shPad: f32,',
);
/** Float index of `shGuard` in the Params buffer (then shSharpen, shFlags, shLightSharp, shRhoMax, shFadeR). */
export const P_SH_OFFSET = 21;

const headerSh = (b: Bindings) => header(b).replace(PARAMS_STRUCT, PARAMS_STRUCT_SH) + SH_CORE_WGSL;

/**
 * Per-signal evaluation direction `shDir{i}(n, v, rough)`: diffuse evaluates the payload at the
 * normal; specular at the lobe's dominant direction (SPEC M7-10: the payload is encoded around
 * the sampling lobe's dominant direction and its plain value is read at the guide normal's).
 */
export function shDirWgsl(kind: SignalKind, i: number): string {
  return kind === 'diffuse'
    ? `fn shDir${i}(n: vec3f, v: vec3f, rough: f32) -> vec3f { return n; }`
    : /* wgsl */ `fn shDir${i}(n: vec3f, v: vec3f, rough: f32) -> vec3f {
  let a = rough * rough;
  return normalize(mix(n, reflect(-v, n), (1.0 - a) * (sqrt(1.0 - a) + a)));
}`;
}
/** Unit vector from the surface at pixel p (linear depth z) toward the camera. */
export const VIEW_DIR_WGSL = /* wgsl */ `
fn viewDirAt(p: vec2i, z: f32) -> vec3f {
  let vp = unprojectZ(F.projInv, ndcOf(uvOf(p)), -z);
  return normalize(F.camPos - (F.viewInv * vec4f(vp, 1.0)).xyz);
}`;
const hasSpec = (kinds: SignalKind[]) => kinds.includes('specular');

/**
 * Sample loader for signal i: `loadCur{i}(p, ng) -> SH`. 'raw' encodes the plain sample
 * with the ray direction around the detail normal (`detailN`, or the caller's normal
 * when there is none; SPEC M7-4); 'enc' reads an encoded rgba32uint payload. Both
 * sanitize (finite, f16 range).
 */
export function shLoaderBindings(b: Bindings, form: ShInputForm, i: number, needDetail: boolean) {
  if (form === 'raw') {
    b.add(`input${i}`, 'texture_2d<f32>', 'f');
    b.add(`dir${i}`, 'texture_2d<f32>', 'f');
    if (needDetail) b.add('detailN', 'texture_2d<f32>', 'f');
  } else {
    b.add(`shIn${i}`, 'texture_2d<u32>', 'i');
  }
}
export function shLoaderWgsl(form: ShInputForm, i: number): string {
  if (form === 'raw') {
    return /* wgsl */ `
fn loadCur${i}(p: vec2i, v: vec3f, rough: f32) -> SH {
  let rgb = max(shFinite4(vec4f(textureLoad(input${i}, p, 0).rgb, 0.0)).rgb, vec3f(0.0));
  let dir = shFinite4(vec4f(textureLoad(dir${i}, p, 0).xyz, 0.0)).xyz;
  let nd = textureLoad(detailN, p, 0).xyz;
  let ns = shDir${i}(nd / max(length(nd), 1e-6), v, rough);
  var s = shEncode(rgb, dir, ns);
  s.y = shClampH(s.y); s.c = shClampH(s.c);
  return s;
}`;
  }
  return /* wgsl */ `
fn loadCur${i}(p: vec2i, v: vec3f, rough: f32) -> SH {
  var s = shUnpack(textureLoad(shIn${i}, p, 0));
  s.y = shFinite4(s.y); s.c = vec4f(shFinite4(s.c).xy, 0.0, 0.0);
  return s;
}`;
}

// ---- temporal accumulation ------------------------------------------------------

export function temporalPassSh(kinds: SignalKind[], forms: ShInputForm[], enc: ShEncoding): PassDef {
  const b = new Bindings();
  b.uniform('F', 'Frame');
  kinds.forEach((_, i) => b.uniform(`P${i}`, 'Params'));
  b.add('geoCur', 'texture_2d<u32>', 'i');
  b.add('geoPrev', 'texture_2d<u32>', 'i');
  b.add('motionTex', 'texture_2d<f32>', 'f');
  b.add('motionZTex', 'texture_2d<f32>', 'f');
  b.add('smp', 'sampler', 's');
  let detailBound = false;
  kinds.forEach((_, i) => {
    shLoaderBindings(b, forms[i], i, forms[i] === 'raw' && !detailBound);
    if (forms[i] === 'raw') detailBound = true;
    b.add(`colorHist${i}`, 'texture_2d<u32>', 'i');
    b.add(`momentsPrev${i}`, 'texture_2d<f32>', 'f');
    b.add(`grad${i}`, 'texture_2d<f32>', 'f');
    b.add(`outAccum${i}`, 'texture_storage_2d<rgba32uint, write>', 'rgba32uint');
    b.add(`outMoments${i}`, 'texture_storage_2d<rg32float, write>', 'rg32float');
  });
  const perSignal = (i: number) => {
    const P = `P${i}`;
    return /* wgsl */ `
  {
    let cur = loadCur${i}(p, vC, g.rough);
    let l = shLum(cur, shDir${i}(g.n, vC, g.rough));
    let mCur = vec2f(l, l * l);
    var n = 1.0;
    var y = cur.y;
    var cc = cur.c.xy;
    var mom = mCur;
    if (!reset) {
      var hy = vec4f(0.0);
      var hc = vec2f(0.0);
      var mHist = vec2f(0.0);
      var nPrev = 0.0;
      var sumW = 0.0;
      if (r.sumW > 0.01) {
        for (var k = 0; k < 4; k++) {
          let w = r.w[k];
          if (w <= 0.0) { continue; }
          let q = r.base + TAP_OFFS[k];
          let h = shUnpack(textureLoad(colorHist${i}, q, 0));
          hy += h.y * w;
          hc += h.c.xy * w;
          nPrev += h.c.z * w;
          mHist += textureLoad(momentsPrev${i}, q, 0).rg * w;
        }
        sumW = r.sumW;
      } else if (fbMask != 0u) {
        for (var k = 0u; k < 9u; k++) {
          if ((fbMask & (1u << k)) == 0u) { continue; }
          let q = fb0 + vec2i(i32(k % 3u) - 1, i32(k / 3u) - 1);
          let h = shUnpack(textureLoad(colorHist${i}, q, 0));
          hy += h.y;
          hc += h.c.xy;
          nPrev += h.c.z;
          mHist += textureLoad(momentsPrev${i}, q, 0).rg;
          sumW += 1.0;
        }
      }
      if (sumW > 0.0) {
        hy /= sumW;
        hc /= sumW;
        nPrev /= sumW;
        mHist /= sumW;
        n = min(nPrev + 1.0, historyCap${i}(g, r.world, r.expPrev));
        var a = max(${P}.alpha, 1.0 / n);
        var am = max(${P}.momentsAlpha, 1.0 / n);
        if ((${P}.flags & P_ANTILAG) != 0u) {
          let lam = antilagLambda${i}(p);
          a = mix(a, 1.0, lam);
          am = mix(am, 1.0, lam);
          n = min(n, 1.0 / mix(1.0 / n, 1.0, lam));
        }
        y = mix(hy, cur.y, a);
        cc = mix(hc, cur.c.xy, a);
        mom = mix(mHist, mCur, am);
      }
    }
    textureStore(outAccum${i}, p, shPack(SH(y, vec4f(cc, n, 0.0))));
    textureStore(outMoments${i}, p, vec4f(mom, 0.0, 0.0));
  }`;
  };
  const code = /* wgsl */ `
${FRAME_WGSL}
${PARAMS_STRUCT_SH}
${b.wgsl}
${REPROJECT_WGSL}
${SH_CORE_WGSL}
${shEncodeWgsl(enc)}
${VIEW_DIR_WGSL}
${kinds.map((k, i) => capWgsl(k, i) + antilagWgsl(i) + shDirWgsl(k, i) + shLoaderWgsl(forms[i], i)).join('\n')}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let p = vec2i(gid.xy);
  if (!inside(p)) { return; }
  let g = geoTap(geoCur, p);
  if (g.z <= 0.0) {
    ${kinds.map((_, i) => `textureStore(outAccum${i}, p, shPack(SH(vec4f(0.0), vec4f(0.0, 0.0, 1.0, 0.0))));
    textureStore(outMoments${i}, p, vec4f(0.0));`).join('\n    ')}
    return;
  }
  let vC = ${hasSpec(kinds) ? 'viewDirAt(p, g.z)' : 'vec3f(0.0, 0.0, 1.0)'};
  let reset = hasFlag(FRAME_RESET);
  var r: Reproj;
  var fbMask = 0u;
  var fb0 = vec2i(0);
  if (!reset) {
    r = reproject(p, g, P0.planeTol, P0.normalTol);
    if (r.sumW <= 0.01) {
      fb0 = vec2i(floor(r.prevUV * F.dims));
      for (var k = 0u; k < 9u; k++) {
        if (tapValid(fb0 + vec2i(i32(k % 3u) - 1, i32(k / 3u) - 1), g, r.expPrev, P0.planeTol, P0.normalTol)) {
          fbMask |= 1u << k;
        }
      }
    }
  }
${kinds.map((_, i) => perSignal(i)).join('\n')}
}
`;
  return { code, entries: b.entries };
}

// ---- variance estimation --------------------------------------------------------

export function variancePassSh(kinds: SignalKind[]): PassDef {
  const b = baseBindings(kinds);
  kinds.forEach((_, i) => {
    b.add(`accumCur${i}`, 'texture_2d<u32>', 'i');
    b.add(`momentsCur${i}`, 'texture_2d<f32>', 'f');
    b.add(`outPing${i}`, 'texture_storage_2d<rgba32uint, write>', 'rgba32uint');
  });
  const I = kinds.map((_, i) => i);
  const code = /* wgsl */ `
${headerSh(b)}
${kinds.map((k, i) => weightsWgsl(k, i)).join('\n')}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let p = vec2i(gid.xy);
  if (!inside(p)) { return; }
  let g = geoCenter(p);
  if (g.z <= 0.0) {
    ${I.map((i) => `textureStore(outPing${i}, p, vec4u(0u));`).join(' ')}
    return;
  }
  ${I.map((i) => /* wgsl */ `
  setCenter${i}(g);
  let a${i} = shUnpack(textureLoad(accumCur${i}, p, 0));
  let n${i} = a${i}.c.z;
  let m${i} = textureLoad(momentsCur${i}, p, 0).rg;
  var varT${i} = max(0.0, m${i}.y - m${i}.x * m${i}.x);
  if ((P${i}.flags & P_VAR_OF_MEAN) != 0u) { varT${i} *= max(P${i}.alpha / (2.0 - P${i}.alpha), 1.0 / max(n${i}, 1.0)); }
  let t${i} = clamp((n${i} - 1.0) / max(P${i}.rampFrames - 1.0, 1e-3), 0.0, 1.0);
  let rad${i} = min(select(select(2, 3, n${i} < 2.0), 0, t${i} >= 1.0), P${i}.varRadius);
  var sy${i} = a${i}.y;
  var sc${i} = a${i}.c.xy;
  var sm${i} = m${i};
  var sw${i} = 1.0;`).join('')}
  let r = max(${I.map((i) => `rad${i}`).join(', ')}${kinds.length === 1 ? ', 0' : ''});
  for (var dy = -r; dy <= r; dy++) {
    for (var dx = -r; dx <= r; dx++) {
      if (dx == 0 && dy == 0) { continue; }
      let q = p + vec2i(dx, dy);
      if (!inside(q)) { continue; }
      let gq = geoTap(geoCur, q);
      if (gq.z <= 0.0) { continue; }
      let off = vec2f(f32(dx), f32(dy));
      let ring = max(abs(dx), abs(dy));
      ${I.map((i) => /* wgsl */ `
      if (ring <= rad${i}) {
        let w = wGeo${i}(g, gq, off);
        let s = shUnpack(textureLoad(accumCur${i}, q, 0));
        sy${i} += s.y * w;
        sc${i} += s.c.xy * w;
        sm${i} += textureLoad(momentsCur${i}, q, 0).rg * w;
        sw${i} += w;
      }`).join('')}
    }
  }
  ${I.map((i) => /* wgsl */ `
  {
    if (t${i} >= 1.0) {
      textureStore(outPing${i}, p, shPack(SH(a${i}.y, vec4f(a${i}.c.xy, sqrt(varT${i}), 0.0))));
    } else {
      let m = sm${i} / sw${i};
      let varS = (1.0 + P${i}.varBoost * max(0.0, 1.0 - n${i} / P${i}.rampFrames)) * max(0.0, m.y - m.x * m.x);
      textureStore(outPing${i}, p, shPack(SH(mix(sy${i} / sw${i}, a${i}.y, t${i}),
        vec4f(mix(sc${i} / sw${i}, a${i}.c.xy, t${i}), sqrt(mix(varS, varT${i}, t${i})), 0.0))));
    }
  }`).join('')}
}
`;
  return { code, entries: b.entries };
}

// ---- a-trous ----------------------------------------------------------------------

/**
 * SH a-trous. Non-last iterations write (payload, sigma). The last writes per signal
 * either the resolve-ready output payload (M7-8, rgba32uint) or, with resolve 'fused',
 * the rgb resolved at the detail normal (M7-9, rgba16float; remodulated if asked).
 */
export function atrousPassSh(kinds: SignalKind[], v: AtrousVariant, resolve: ShResolve[]): PassDef {
  const b = baseBindings(kinds);
  b.uniform('I', 'Iter');
  const fused = v.last && resolve.some((r) => r === 'fused');
  if (fused) b.add('detailN', 'texture_2d<f32>', 'f');
  kinds.forEach((_, i) => {
    b.add(`src${i}`, 'texture_2d<u32>', 'i');
    if (v.writeHist) b.add(`accumCur${i}`, 'texture_2d<u32>', 'i');
    const outRgb = v.last && resolve[i] === 'fused';
    if (outRgb) b.add(`demod${i}`, 'texture_2d<f32>', 'f');
    b.add(`dst${i}`, outRgb ? 'texture_storage_2d<rgba16float, write>' : 'texture_storage_2d<rgba32uint, write>', outRgb ? 'rgba16float' : 'rgba32uint');
    if (v.writeHist) b.add(`hist${i}`, 'texture_storage_2d<rgba32uint, write>', 'rgba32uint');
  });
  const I = kinds.map((_, i) => i);
  const inner: [number, number][] = [];
  for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) inner.push([x, y]);
  const outer: [number, number][] = [];
  if (!v.box) for (let y = -2; y <= 2; y++) for (let x = -2; x <= 2; x++) if (Math.abs(x) > 1 || Math.abs(y) > 1) outer.push([x, y]);
  const h = (x: number, y: number) => (v.box ? 1 : B3[x + 2] * B3[y + 2]);
  // y, c: payload (vec4f, vec2f); sd: standard deviation
  const store = (i: number, y: string, c: string, sd: string) => {
    if (!v.last) return `textureStore(dst${i}, p, shPack(SH(${y}, vec4f(${c}, ${sd}, 0.0))));`;
    if (resolve[i] === 'fused') {
      const resolveCall = kinds[i] === 'diffuse'
        ? `shResolveDiffuse(op, nDet, P${i}.shSharpen, g.n)`
        : `shResolveSpecular(op, nDet, g.n, vC, g.rough, P${i}.shLightSharp, P${i}.shRhoMax, P${i}.shFadeR)`;
      return /* wgsl */ `{
      let op = shOutputPayload(SH(${y}, vec4f(${c}, 0.0, 0.0)), ev${i}, P${i}.shGuard);
      let ndr = textureLoad(detailN, p, 0).xyz;
      let nDet = ndr / max(length(ndr), 1e-6);
      let rgb = ${resolveCall};
      textureStore(dst${i}, p, vec4f(rgb * select(vec3f(1.0), textureLoad(demod${i}, p, 0).rgb, (P${i}.flags & P_REMODULATE) != 0u), 1.0));
    }`;
    }
    return `textureStore(dst${i}, p, shPack(shOutputPayload(SH(${y}, vec4f(${c}, 0.0, 0.0)), ev${i}, P${i}.shGuard)));`;
  };
  const hist = (i: number, y: string, c: string) => v.writeHist
    ? `textureStore(hist${i}, p, shPack(SH(${y}, vec4f(${c}, shUnpack(textureLoad(accumCur${i}, p, 0)).c.z, 0.0))));` : '';
  const tap = (x: number, y: number, sample: (i: number) => string) => /* wgsl */ `
  {
    let off = vec2i(${x}, ${y}) * I.stride;
    let q = p + off;
    if (inside(q)) {
      let gq = geoTap(geoCur, q);
      if (gq.z > 0.0) {
        ${I.map((i) => /* wgsl */ `{
          let s = ${sample(i)};
          let w = ${f32s(h(x, y))} * wGeo${i}(g, gq, vec2f(off)) * exp(-abs(shLum(s, ev${i}) - lc${i}) / lumDenom${i});
          sumY${i} += s.y * w;
          sumC${i} += s.c.xy * w;
          sumV${i} += s.c.z * s.c.z * w * w;
          sumW${i} += w;
        }`).join('\n        ')}
      }
    }
  }`;
  const code = /* wgsl */ `
${headerSh(b)}
${v.last ? SH_RESOLVE_CORE_WGSL : ''}
struct Iter { stride: i32, iteration: i32, pad0: i32, pad1: i32 }
${kinds.map((k, i) => weightsWgsl(k, i) + shDirWgsl(k, i)).join('\n')}
${hasSpec(kinds) ? VIEW_DIR_WGSL : ''}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let p = vec2i(gid.xy);
  if (!inside(p)) { return; }
  let g = geoCenter(p);
  ${I.map((i) => `let c${i} = shUnpack(textureLoad(src${i}, p, 0));`).join('\n  ')}
  if (g.z <= 0.0) {
    ${I.map((i) => (v.last
      ? (resolve[i] === 'fused' ? `textureStore(dst${i}, p, vec4f(0.0, 0.0, 0.0, 1.0));` : `textureStore(dst${i}, p, vec4u(0u));`)
      : `textureStore(dst${i}, p, shPack(c${i}));`) + ' ' + hist(i, `c${i}.y`, `c${i}.c.xy`)).join('\n    ')}
    return;
  }
  let vC = ${hasSpec(kinds) ? 'viewDirAt(p, g.z)' : 'vec3f(0.0, 0.0, 1.0)'};
  ${I.map((i) => /* wgsl */ `
  setCenter${i}(g);
  ${inner.map(([x, y], k) => `let s${i}_${k} = ${x === 0 && y === 0 ? `c${i}` : `shUnpack(textureLoad(src${i}, clampPix(p + vec2i(${x}, ${y}) * I.stride), 0))`};`).join('\n  ')}
  let gVar${i} = (${inner.map(([x, y], k) => `${(2 - Math.abs(x)) * (2 - Math.abs(y))}.0 * s${i}_${k}.c.z * s${i}_${k}.c.z`).join(' + ')}) / 16.0;
  let ev${i} = shDir${i}(g.n, vC, g.rough);
  let lc${i} = shLum(c${i}, ev${i});
  let lumDenom${i} = P${i}.sigmaL * sqrt(max(gVar${i}, 0.0)) + 1e-10;
  let hc${i} = ${f32s(h(0, 0))};
  var sumY${i} = c${i}.y * hc${i};
  var sumC${i} = c${i}.c.xy * hc${i};
  var sumV${i} = c${i}.c.z * c${i}.c.z * hc${i} * hc${i};
  var sumW${i} = hc${i};`).join('')}
  ${inner.map(([x, y], k) => (x === 0 && y === 0 ? '' : tap(x, y, (i) => `s${i}_${k}`))).join('')}
  ${outer.map(([x, y]) => tap(x, y, (i) => `shUnpack(textureLoad(src${i}, q, 0))`)).join('')}
  ${I.map((i) => /* wgsl */ `
  {
    let outY = sumY${i} / sumW${i};
    let outC = sumC${i} / sumW${i};
    let outS = sqrt(sumV${i}) / sumW${i};
    ${store(i, 'outY', 'outC', 'outS')}
    ${hist(i, 'outY', 'outC')}
  }`).join('')}
}
`;
  return { code, entries: b.entries };
}
