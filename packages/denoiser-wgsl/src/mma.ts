// Fused conv op on subgroup matrices (WGSL `chromium_experimental_subgroup_matrix`:
// Metal simdgroup_matrix on Apple, VK_KHR_cooperative_matrix on Vulkan): the conv
// as an implicit GEMM out[px, oc] = sum_{tap, ic} in[px + tap, ic] * W[tap, ic, oc]
// on M x N x K subgroup matrices (left = M pixels x K input channels, right =
// K input channels x N output channels, result = M pixels x N output channels).
//
// Per workgroup: a TH x TW output tile x (OB * NSO * N) output channels, NS * NSO
// subgroups of 32. Subgroup s = (sp, so): sp = s % NS takes every NS-th share of
// the tile's M-pixel row segments, so = s / NS takes OB of the workgroup's
// N-channel output blocks. All subgroups share one staged input patch, so more
// subgroups per workgroup means fewer staging loads per MMA. Subgroup offsets come
// from `@builtin(subgroup_id)`, which the matrix uniformity rule accepts on
// Chrome 157 (Metal); `local_invocation_index / 32` is rejected.
//
// Per K-channel input block the workgroup stages the (TH+2) x (TW+2) x K input
// patch in workgroup memory as [row][col][K] (operand type), so every
// (segment, tap) left operand is one contiguous M x K load (stride K). Right
// operands (K ic x N oc weights per tap) load straight from storage. Epilogue:
// results go through workgroup memory ([row][col][oc], result type) so the usual
// bias + relu6 (+ 2x2 max pool) + NC4HW4 / planar-NCHW store can be done per item.
//
// `emulate` swaps the matrix built-ins for plain-WGSL stand-ins (32 lanes share
// each result tile, f32 sums): any M/N/K/type runs on any WebGPU device, so the
// tiling of configs this GPU doesn't have (NVIDIA's 16x16x16 f16 -> f32) is
// checked against the portable kernel here. Correctness only, slow.
import type { ConvOp } from './graph';

export type SgmScalar = 'f32' | 'f16';

/** One subgroup-matrix configuration (an entry of `GPUAdapterInfo.subgroupMatrixConfigs`). */
export interface SgmConfig {
  M: number;
  N: number;
  K: number;
  /** Operand (left/right) component type. */
  T: SgmScalar;
  /** Result (accumulator) component type. */
  TR: SgmScalar;
}

export const SGM_F32_8: SgmConfig = { M: 8, N: 8, K: 8, T: 'f32', TR: 'f32' };

export interface MmaTiling {
  tw: number; // tile width (multiple of M)
  th: number; // tile height
  ns: number; // subgroups (of 32) along the tile's pixel segments
  ob: number; // max N-wide output blocks per subgroup
  nso?: number; // subgroups along output channels (default 1)
}

export interface MmaOptions {
  config?: SgmConfig;
  emulate?: boolean;
  /** Emit `diagnostic(off, chromium.subgroup_matrix_uniformity)` (probe / fallback only). */
  uniformityOff?: boolean;
}

export interface MmaShaderInfo {
  code: string;
  tiling: Required<MmaTiling>;
  ob: number;
  /** N-wide output blocks of the layer. */
  coutN: number;
  /** Workgroups along z per batch item. */
  ocg: number;
  k1: number; // K-channel input blocks from src1
  nkb: number; // total input blocks
  /** Workgroup memory, bytes. */
  smem: number;
}

const ceilTo = (c: number, n: number) => Math.ceil(c / n);
const ceil4 = (c: number) => Math.ceil(c / 4);
const bytes = (t: SgmScalar) => (t === 'f16' ? 2 : 4);

export function mmaShader(op: ConvOp, f16: boolean, tiling: MmaTiling, opts: MmaOptions = {}): MmaShaderInfo {
  const cfg = opts.config ?? SGM_F32_8;
  const { M, N, K, T, TR } = cfg;
  const emu = !!opts.emulate;
  const { tw, th } = tiling;
  const ns = tiling.ns;
  if (K % 4) throw new Error('mma: K must be a multiple of 4');
  if (tw % M) throw new Error(`mma tile width must be a multiple of ${M}`);
  if (op.pool && th % 2) throw new Error('mma pool needs an even tile height');
  const final = op.dst < 0;
  const coutN = ceilTo(op.cout, N);
  let ob = Math.min(tiling.ob, coutN);
  while (coutN % ob) ob--;
  let nso = Math.min(tiling.nso ?? 1, coutN / ob);
  while ((coutN / ob) % nso) nso--;
  const ocW = ob * nso * N; // output channels per workgroup
  const ocg = coutN / (ob * nso);
  const k1 = ceilTo(op.c1, K);
  const k2 = ceilTo(op.c2, K);
  const nkb = k1 + k2;
  const KN = K * N;
  const S = f16 ? 'f16' : 'f32'; // storage type of activations
  const segRow = tw / M;
  const segs = segRow * th;
  if (segs % ns) throw new Error(`mma: ${segs} segments don't split over ${ns} subgroups`);
  const sps = segs / ns; // segments per subgroup
  const nsg = ns * nso;
  const ttw = tw + 2;
  const tth = th + 2;
  const nq = K / 4; // vec4 quads per staged pixel
  const xtN = tth * ttw * K;
  const otN = th * tw * ocW;
  const shared = T === TR;
  const smem = shared ? Math.max(xtN, otN) * bytes(T) : xtN * bytes(T) + otN * bytes(TR);
  const threads = nsg * 32;
  const X = shared ? 'sm' : 'xs'; // staged input
  const O = shared ? 'sm' : 'os'; // results

  const planar1 = op.src1.kind === 'input';
  const planar2 = op.src2?.kind === 'input';
  const up1 = op.src1.kind === 'tensor' && op.src1.up;
  const c1_4 = ceil4(op.c1);
  const c2_4 = ceil4(op.c2);
  const dstQ = ceil4(op.cout); // packed quads per pixel of dst

  // load 4 channels (chunk q of a source) at (gy, gx) as vec4<T>
  const planarLoad = (s: string, c: number, q: string) => {
    const parts: string[] = [];
    for (let j = 0; j < 4; j++) {
      parts.push(`select(0.0, f32(${s}[((b * ${c}u + min(${q} * 4u + ${j}u, ${c - 1}u)) * H + u32(gy)) * W + u32(gx)]), ${q} * 4u + ${j}u < ${c}u)`);
    }
    return `vec4<${T}>(vec4f(${parts.join(', ')}))`;
  };
  const load1 = planar1
    ? planarLoad('s1', op.c1, 'q')
    : up1
      ? `vec4<${T}>(s1[((b * ${c1_4}u + q) * p.sH + u32(gy) / 2u) * p.sW + u32(gx) / 2u])`
      : `vec4<${T}>(s1[((b * ${c1_4}u + q) * H + u32(gy)) * W + u32(gx)])`;
  const valid1 = planar1 ? 'true' : `q < ${c1_4}u`;
  let loadBody = `if (kb < ${k1}u) { let q = kb * ${nq}u + hf; if (${valid1}) { v = ${load1}; } }`;
  if (k2) {
    const load2 = planar2
      ? planarLoad('s2', op.c2, 'q')
      : `vec4<${T}>(s2[((b * ${c2_4}u + q) * H + u32(gy)) * W + u32(gx)])`;
    const valid2 = planar2 ? 'true' : `q < ${c2_4}u`;
    loadBody += ` else { let q = (kb - ${k1}u) * ${nq}u + hf; if (${valid2}) { v = ${load2}; } }`;
  }

  // matrix ops: native built-ins or emulated stand-ins
  const LT = emu ? 'vec2u' : `subgroup_matrix_left<${T}, ${K}, ${M}>`;
  const RT = emu ? 'vec2u' : `subgroup_matrix_right<${T}, ${N}, ${K}>`;
  const ZT = emu ? 'EmuResult' : `subgroup_matrix_result<${TR}, ${N}, ${M}>`;
  const loadL = (off: string) => (emu ? `vec2u(${off}, ${K}u)` : `subgroupMatrixLoad<${LT}>(&${X}, ${off}, false, ${K}u)`);
  const loadR = (off: string) => (emu ? `vec2u(${off}, ${N}u)` : `subgroupMatrixLoad<${RT}>(&w, ${off}, false, ${N}u)`);
  const mmaOp = (l: string, r: string, c: string) => (emu ? `emuMma(${l}, ${r}, ${c})` : `subgroupMatrixMultiplyAccumulate(${l}, ${r}, ${c})`);
  const storeOp = (off: string, v: string, stride: number) =>
    (emu ? `emuStore(${off}, ${v}, ${stride}u)` : `subgroupMatrixStore(&${O}, ${off}, ${v}, false, ${stride}u)`);
  const E = Math.ceil((M * N) / 32);
  const emuGuard = (M * N) % 32 ? `if (e >= ${M * N}u) { continue; }\n    ` : '';
  const emuPrelude = emu ? `
// Emulated subgroup matrices (correctness only). Left/right are lazy (offset, stride)
// views read at multiply time: the staged patch and the weights don't change between
// load and multiply. The 32 lanes of a subgroup share the M x N result tile: lane j
// owns elements j, j + 32, ... (${E} each, f32${TR === 'f16' ? ', rounded to f16 after each multiply' : ''}).
alias EmuResult = array<f32, ${E}>;
var<private> emuLane: u32;
fn emuMma(l: vec2u, r: vec2u, acc: EmuResult) -> EmuResult {
  var o = acc;
  for (var j = 0u; j < ${E}u; j++) {
    let e = emuLane + j * 32u;
    ${emuGuard}let i = e / ${N}u;
    let n = e % ${N}u;
    var s = o[j];
    for (var k = 0u; k < ${K}u; k++) { s += f32(${X}[l.x + i * l.y + k]) * f32(w[r.x + k * r.y + n]); }
    o[j] = ${TR === 'f16' ? 'f32(f16(s))' : 's'};
  }
  return o;
}
fn emuStore(off: u32, v: EmuResult, stride: u32) {
  for (var j = 0u; j < ${E}u; j++) {
    let e = emuLane + j * 32u;
    ${emuGuard}${O}[off + (e / ${N}u) * stride + e % ${N}u] = ${TR}(v[j]);
  }
}
` : '';

  const accs: string[] = [];
  for (let j = 0; j < sps; j++) for (let o = 0; o < ob; o++) accs.push(`var c${j}_${o} = ${ZT}();`);

  const mm: string[] = [];
  for (let o = 0; o < ob; o++) mm.push(`let r${o} = ${loadR(`wb + ${o * nkb * 9 * KN}u`)};`);
  for (let j = 0; j < sps; j++) {
    mm.push(`{ let l = ${loadL(`lb${j} + toff`)};`);
    for (let o = 0; o < ob; o++) mm.push(`  c${j}_${o} = ${mmaOp('l', `r${o}`, `c${j}_${o}`)};`);
    mm.push('}');
  }

  const stores: string[] = [];
  for (let j = 0; j < sps; j++) {
    for (let o = 0; o < ob; o++) stores.push(`${storeOp(`ob${j} + ${o * N}u`, `c${j}_${o}`, ocW)};`);
  }

  const act = (e: string) => (op.relu ? `clamp(${e}, vec4f(0.0), vec4f(6.0))` : e);
  const rd = (pix: string) => `(vec4f(f32(${O}[(${pix}) * ${ocW}u + o4 * 4u]), f32(${O}[(${pix}) * ${ocW}u + o4 * 4u + 1u]), f32(${O}[(${pix}) * ${ocW}u + o4 * 4u + 2u]), f32(${O}[(${pix}) * ${ocW}u + o4 * 4u + 3u])))`;
  const ocPad = ocg * ocW > dstQ * 4; // padded output channels past the tensor's quads
  const guardOc = ocPad ? ` && oc4 < ${dstQ}u` : '';
  let epi: string;
  if (final) {
    // planar NCHW, op.cout channels
    epi = `
  for (var i = li; i < ${th * tw}u; i += ${threads}u) {
    let ry = i / ${tw}u; let rx = i % ${tw}u;
    let y = oy0 + ry; let x = ox0 + rx;
    if (y < H && x < W) {
      ${Array.from({ length: op.cout }, (_, c) => `dst[((b * ${op.cout}u + ${c}u) * H + y) * W + x] = ${S}(f32(${O}[i * ${ocW}u + ${c}u]) + bias[${c >> 2}u][${c & 3}u]);`).join('\n      ')}
    }
  }`;
  } else if (op.pool) {
    const ph = th / 2;
    const pw = tw / 2;
    epi = `
  for (var i = li; i < ${ph * pw * (ocW / 4)}u; i += ${threads}u) {
    let o4 = i / ${ph * pw}u; let pix = i % ${ph * pw}u;
    let ry = (pix / ${pw}u) * 2u; let rx = (pix % ${pw}u) * 2u;
    let y = (oy0 + ry) / 2u; let x = (ox0 + rx) / 2u;
    let oc4 = og * ${ocW / 4}u + o4;
    if (y < H / 2u && x < W / 2u${guardOc}) {
      let p0 = ry * ${tw}u + rx;
      let m = max(max(${rd('p0')}, ${rd('p0 + 1u')}), max(${rd(`p0 + ${tw}u`)}, ${rd(`p0 + ${tw + 1}u`)}));
      dst[((b * ${dstQ}u + oc4) * (H / 2u) + y) * (W / 2u) + x] = vec4<${S}>(${act('m + bias[oc4]')});
    }
  }`;
  } else {
    epi = `
  for (var i = li; i < ${th * tw * (ocW / 4)}u; i += ${threads}u) {
    let o4 = i / ${th * tw}u; let pix = i % ${th * tw}u;
    let y = oy0 + pix / ${tw}u; let x = ox0 + pix % ${tw}u;
    let oc4 = og * ${ocW / 4}u + o4;
    if (y < H && x < W${guardOc}) {
      dst[((b * ${dstQ}u + oc4) * H + y) * W + x] = vec4<${S}>(${act(`${rd('pix')} + bias[oc4]`)});
    }
  }`;
  }

  const srcDecl = (n: number, planar: boolean) =>
    `@group(0) @binding(${n}) var<storage, read> s${n - 2}: array<${planar ? S : `vec4<${S}>`}>;`;

  // subgroup index: one subgroup = constant; native = subgroup_id (uniform for the
  // matrix rule); emulated = local index / 32 (no uniformity rule applies)
  const sgExpr = nsg === 1 ? '0u' : emu ? 'li / 32u' : 'sgid';
  const enables = [
    emu ? '' : 'enable chromium_experimental_subgroup_matrix;',
    f16 || T === 'f16' || TR === 'f16' ? 'enable f16;' : '',
    !emu && nsg > 1 ? 'enable subgroups;' : '',
    !emu && opts.uniformityOff ? 'diagnostic(off, chromium.subgroup_matrix_uniformity);' : '',
  ].filter(Boolean).join('\n');
  const wgVars = shared
    ? `var<workgroup> sm: array<${T}, ${Math.max(xtN, otN)}>;`
    : `var<workgroup> xs: array<${T}, ${xtN}>;\nvar<workgroup> os: array<${TR}, ${otN}>;`;

  const code = /* wgsl */ `${enables}
// ${op.name} (subgroup matrix ${M}x${N}x${K} ${T} -> ${TR}${emu ? ', EMULATED' : ''}): ${op.c1}${op.c2 ? `+${op.c2}` : ''} -> ${op.cout}${op.pool ? ' +maxpool' : ''}${up1 ? ' (src1 upsampled)' : ''}; tile ${tw}x${th}, ${ns}x${nso} subgroups, ${ob} blocks each
struct P { H: u32, W: u32, sH: u32, sW: u32, ocg: u32, _a: u32, _b: u32, _c: u32 }
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> w: array<${T}>;
@group(0) @binding(2) var<storage, read> bias: array<vec4f>;
${srcDecl(3, planar1)}
${k2 ? srcDecl(4, planar2) : ''}
@group(0) @binding(5) var<storage, read_write> dst: array<${final ? S : `vec4<${S}>`}>;

${wgVars}
${emuPrelude}
@compute @workgroup_size(${threads}, 1, 1)
fn main(@builtin(workgroup_id) wg: vec3u, @builtin(local_invocation_index) li: u32${!emu && nsg > 1 ? ', @builtin(subgroup_id) sgid: u32' : ''}) {
  ${emu ? 'emuLane = li % 32u;' : ''}
  let H = p.H;
  let W = p.W;
  let og = wg.z % p.ocg;
  let b = wg.z / p.ocg;
  let oy0 = wg.y * ${th}u;
  let ox0 = wg.x * ${tw}u;
  let ty0 = i32(oy0) - 1;
  let tx0 = i32(ox0) - 1;
  let sg = ${sgExpr};
  let sp = ${ns === 1 ? '0u' : nso === 1 ? 'sg' : `sg % ${ns}u`};
  let so = ${nso === 1 ? '0u' : ns === 1 ? 'sg' : `sg / ${ns}u`};
  ${Array.from({ length: sps }, (_, j) => `let seg${j} = sp * ${sps}u + ${j}u; let lb${j} = ((seg${j} / ${segRow}u) * ${ttw}u + (seg${j} % ${segRow}u) * ${M}u) * ${K}u; let ob${j} = ((seg${j} / ${segRow}u) * ${tw}u + (seg${j} % ${segRow}u) * ${M}u) * ${ocW}u + so * ${ob * N}u;`).join('\n  ')}
  ${accs.join('\n  ')}
  for (var kb = 0u; kb < ${nkb}u; kb++) {
    for (var i = li; i < ${tth * ttw * nq}u; i += ${threads}u) {
      let pix = i / ${nq}u;
      let hf = i % ${nq}u;
      let gy = ty0 + i32(pix / ${ttw}u);
      let gx = tx0 + i32(pix % ${ttw}u);
      var v = vec4<${T}>(0.0);
      if (gy >= 0 && gy < i32(H) && gx >= 0 && gx < i32(W)) {
        ${loadBody}
      }
      let o = pix * ${K}u + hf * 4u;
      ${X}[o] = v.x; ${X}[o + 1u] = v.y; ${X}[o + 2u] = v.z; ${X}[o + 3u] = v.w;
    }
    workgroupBarrier();
    for (var t = 0u; t < 9u; t++) {
      let toff = ((t / 3u) * ${ttw}u + t % 3u) * ${K}u;
      let wb = (((og * ${nso}u + so) * ${ob * nkb}u + kb) * 9u + t) * ${KN}u;
      ${mm.join('\n      ')}
    }
    workgroupBarrier();
  }
  ${stores.join('\n  ')}
  workgroupBarrier();
  ${epi}
}
`;
  return { code, tiling: { tw, th, ns, ob, nso }, ob, coutN, ocg, k1, nkb, smem };
}

/**
 * Weights for the MMA kernel: per (N-wide oc block, K-wide input block, tap) one
 * row-major K x N [ic][oc] matrix. Input blocks [0, k1) cover src1's channels,
 * the rest src2's; padding is zero.
 */
export function packWeightsMma(w: Float32Array, cout: number, c1: number, c2: number, K = 8, N = 8): Float32Array {
  const cin = c1 + c2;
  const coutN = ceilTo(cout, N);
  const k1 = ceilTo(c1, K);
  const nkb = k1 + ceilTo(c2, K);
  const KN = K * N;
  const out = new Float32Array(coutN * nkb * 9 * KN);
  for (let oN = 0; oN < coutN; oN++) {
    for (let kb = 0; kb < nkb; kb++) {
      for (let t = 0; t < 9; t++) {
        const m = ((oN * nkb + kb) * 9 + t) * KN;
        for (let i = 0; i < K; i++) {
          let ch: number;
          if (kb < k1) ch = K * kb + i < c1 ? K * kb + i : -1;
          else ch = K * (kb - k1) + i < c2 ? c1 + K * (kb - k1) + i : -1;
          if (ch < 0) continue;
          for (let j = 0; j < N; j++) {
            const oc = N * oN + j;
            if (oc < cout) out[m + i * N + j] = w[(oc * cin + ch) * 9 + t];
          }
        }
      }
    }
  }
  return out;
}
