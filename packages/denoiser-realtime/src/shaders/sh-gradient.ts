// A-SVGF 'auto' / 'gradient' gradient samples for `payload: 'sh'` (SPEC M7-7: the
// gradient passes are unchanged, fed the payload's luminance at the filter's normal).
// Same algorithm as gradient.ts `gradientCreatePassV2` (one thread per 3x3 stratum,
// one reprojection at the stratum centre, the stratum's history mean as separable
// weights (1 - f, 1, 1, f) / 3 per axis): the SH history is an unfilterable
// rgba32uint, so the 4 hardware-bilinear taps become 16 loads, each evaluated at the
// stratum centre's normal. Output layout is gradient.ts's packG, so the
// reconstruction and lambda passes run unchanged.
import { Bindings, type PassDef } from './bindings';
import { FRAME_WGSL, REPROJECT_WGSL } from './common';
import { PACK_WGSL } from './gradient';
import { SH_CORE_WGSL, shEncodeWgsl, type ShEncoding } from './sh';
import { shDirWgsl, shLoaderBindings, shLoaderWgsl, VIEW_DIR_WGSL, type ShInputForm } from './svgf-sh';
import { PARAMS_STRUCT, type SignalKind } from './svgf';

export function gradientCreatePassSh(kinds: SignalKind[], fromInput: boolean, forms: ShInputForm[], enc: ShEncoding): PassDef {
  const I = kinds.map((_, i) => i);
  const spec = kinds.includes('specular');
  const b = new Bindings();
  b.uniform('F', 'Frame');
  I.forEach((i) => b.uniform(`P${i}`, 'Params'));
  b.add('geoCur', 'texture_2d<u32>', 'i');
  b.add('geoPrev', 'texture_2d<u32>', 'i');
  b.add('geoGrad', 'texture_2d<u32>', 'i');
  b.add('motionTex', 'texture_2d<f32>', 'f');
  b.add('motionZTex', 'texture_2d<f32>', 'f');
  b.add('smp', 'sampler', 's');
  let detailBound = false;
  I.forEach((i) => {
    shLoaderBindings(b, forms[i], i, forms[i] === 'raw' && !detailBound);
    if (forms[i] === 'raw') detailBound = true;
    if (!fromInput) b.add(`accumPrev${i}`, 'texture_2d<u32>', 'i');
    b.add(`gradInput${i}`, 'texture_2d<f32>', 'f');
    b.add(`outG${i}`, 'texture_storage_2d<rgba32uint, write>', 'rgba32uint');
  });
  const taps = [...Array(9).keys()].map((k) => [k % 3, Math.floor(k / 3)]);
  const hist4 = [0, 1, 2, 3];
  const code = /* wgsl */ `
${FRAME_WGSL}
${PARAMS_STRUCT}
${b.wgsl}
${REPROJECT_WGSL}
${PACK_WGSL}
${SH_CORE_WGSL}
${shEncodeWgsl(enc)}
${VIEW_DIR_WGSL}
${I.map((i) => shDirWgsl(kinds[i], i) + shLoaderWgsl(forms[i], i)).join('\n')}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let s = vec2i(gid.xy);
  if (s.x >= P0.gradDims.x || s.y >= P0.gradDims.y) { return; }
  let p0 = s * 3;
  ${I.map((i) => `var sL${i} = 0.0; var sL2${i} = 0.0;`).join(' ')}
  var cnt = 0.0;
  var zAny = 0.0; var pAny = p0;
  // one view direction per stratum (its centre's pixel ray), for the specular dominant direction
  let vq = ${spec ? 'viewDirAt(clampPix(p0 + vec2i(1, 1)), max(geoTap(geoCur, clampPix(p0 + vec2i(1, 1))).z, 1e-3))' : 'vec3f(0.0, 0.0, 1.0)'};
  ${taps.map(([x, y]) => /* wgsl */ `
  {
    let q = p0 + vec2i(${x}, ${y});
    let qc = clampPix(q);
    let gq = geoTap(geoCur, qc);
    let z = gq.z;
    let ok = inside(q) && z > 0.0;
    let w = select(0.0, 1.0, ok);
    cnt += w;
    if (ok && (zAny == 0.0 || ${x === 1 && y === 1 ? 'true' : 'false'})) { zAny = z; pAny = qc; }
    ${I.map((i) => `{ let l = shLum(loadCur${i}(qc, vq, gq.rough), shDir${i}(gq.n, vq, gq.rough)) * w; sL${i} += l; sL2${i} += l * l; }`).join('\n    ')}
  }`).join('')}
  if (cnt <= 0.0) {
    ${I.map((i) => `textureStore(outG${i}, s, vec4u(0u));`).join('\n    ')}
    return;
  }
  var g = geoTap(geoCur, pAny);
  g.grad = unpack2x16float(textureLoad(geoGrad, pAny, 0).r);
  let dz = max(abs(g.grad.x), abs(g.grad.y));
  ${fromInput ? '' : /* wgsl */ `
  var hasHist = false;
  var hb = vec2i(0);
  var hw = array<vec2f, 4>(vec2f(0.0), vec2f(0.0), vec2f(0.0), vec2f(0.0));   // per-axis weights of texels hb-1 .. hb+2
  if (!hasFlag(FRAME_RESET) && cnt == 9.0 && pAny.x == p0.x + 1 && pAny.y == p0.y + 1) {
    let r = reproject(pAny, g, P0.planeTol, P0.normalTol);
    if (r.allValid) {
      hasHist = true;
      let pp = r.prevUV * F.dims - 0.5;
      let bse = floor(pp);
      let f = pp - bse;
      hb = vec2i(bse);
      hw = array<vec2f, 4>(1.0 - f, vec2f(1.0), vec2f(1.0), f);
    }
  }`}
  ${I.map((i) => /* wgsl */ `
  {
    let m = sL${i} / cnt;
    let v = max(0.0, sL2${i} / cnt - m * m);
    var g0 = vec4f(0.0, 0.0, 0.0, 1.0);
    ${fromInput ? /* wgsl */ `
    let gi = textureLoad(gradInput${i}, s, 0);   // (l_prev, l_curr, valid)
    if (gi.z > 0.0 && !hasFlag(FRAME_RESET)) {
      g0 = vec4f(gi.y - gi.x, max(gi.x, gi.y), 0.0, 1.0);
    }` : /* wgsl */ `
    if (hasHist) {
      let ev = shDir${i}(g.n, vq, g.rough);
      var mh = 0.0;
      ${hist4.map((yy) => hist4.map((xx) => `mh += shLum(shUnpack(textureLoad(accumPrev${i}, clampPix(hb + vec2i(${xx - 1}, ${yy - 1})), 0)), ev) * hw[${xx}].x * hw[${yy}].y;`).join('\n      ')).join('\n      ')}
      mh /= 9.0;
      g0 = vec4f(m - mh, max(m, mh), v / cnt, 1.0);
    }`}
    textureStore(outG${i}, s, packG(g0, vec4f(m, v, zAny, dz)));
  }`).join('')}
}
`;
  return { code, entries: b.entries };
}
