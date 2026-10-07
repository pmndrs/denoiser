// Fused conv op on chromium-experimental-subgroup-matrix (Metal simdgroup_matrix):
// the conv as an implicit GEMM out[px, oc] = sum_{tap, ic} in[px + tap, ic] * W[tap, ic, oc]
// on 8x8x8 f32 subgroup matrices (f32 accumulation for fp16 models too —
// activations are converted when staged).
//
// Per workgroup: a TH x TW output tile x OB*8 output channels; NS subgroups of 32
// split the tile's 8-pixel row segments. Per 8-channel input block the workgroup
// stages the (TH+2) x (TW+2) x 8 input patch in workgroup memory as [row][col][8]
// so every (segment, tap) left operand is one contiguous 8x8 load (stride 8).
// Right operands (8 ic x 8 oc weights per tap) load straight from storage.
// Epilogue: results go through workgroup memory ([row][col][oc]) so the usual
// bias + relu6 (+ 2x2 max pool) + NC4HW4 / planar-NCHW store can be done per item.
import type { ConvOp } from './graph';

export interface MmaTiling {
  tw: number; // tile width (multiple of 8)
  th: number; // tile height
  ns: number; // subgroups (of 32) per workgroup
  ob: number; // max 8-oc blocks per workgroup
}

export interface MmaShaderInfo {
  code: string;
  tiling: MmaTiling;
  ob: number;
  cout8: number;
  k1: number; // 8-channel input blocks from src1
  nkb: number; // total input blocks
}

const ceil8 = (c: number) => Math.ceil(c / 8);
const ceil4 = (c: number) => Math.ceil(c / 4);

export function mmaShader(op: ConvOp, f16: boolean, tiling: MmaTiling): MmaShaderInfo {
  const { tw, th, ns } = tiling;
  if (tw % 8) throw new Error('mma tile width must be a multiple of 8');
  if (op.pool && th % 2) throw new Error('mma pool needs an even tile height');
  const final = op.dst < 0;
  const cout8 = ceil8(op.cout);
  let ob = Math.min(tiling.ob, cout8);
  while (cout8 % ob) ob--;
  const ocb = ob * 8;
  const k1 = ceil8(op.c1);
  const k2 = ceil8(op.c2);
  const nkb = k1 + k2;
  const T = f16 ? 'f16' : 'f32';
  const segs = (tw / 8) * th;
  if (segs % ns) throw new Error(`mma: ${segs} segments don't split over ${ns} subgroups`);
  const sps = segs / ns; // segments per subgroup
  const ttw = tw + 2;
  const tth = th + 2;
  const xtN = tth * ttw * 8;
  const otN = th * tw * ocb;
  const smN = Math.max(xtN, otN);
  const threads = ns * 32;

  const planar1 = op.src1.kind === 'input';
  const planar2 = op.src2?.kind === 'input';
  const up1 = op.src1.kind === 'tensor' && op.src1.up;
  const c1_4 = ceil4(op.c1);
  const c2_4 = ceil4(op.c2);

  // load 4 channels (chunk q of a source) at (gy, gx) as vec4f
  const planarLoad = (s: string, c: number, q: string) => {
    const parts: string[] = [];
    for (let j = 0; j < 4; j++) {
      parts.push(`select(0.0, f32(${s}[((b * ${c}u + min(${q} * 4u + ${j}u, ${c - 1}u)) * H + u32(gy)) * W + u32(gx)]), ${q} * 4u + ${j}u < ${c}u)`);
    }
    return `vec4f(${parts.join(', ')})`;
  };
  const load1 = planar1
    ? planarLoad('s1', op.c1, 'q')
    : up1
      ? `vec4f(s1[((b * ${c1_4}u + q) * p.sH + u32(gy) / 2u) * p.sW + u32(gx) / 2u])`
      : `vec4f(s1[((b * ${c1_4}u + q) * H + u32(gy)) * W + u32(gx)])`;
  const valid1 = planar1 ? 'true' : `q < ${c1_4}u`;
  let loadBody = `if (kb < ${k1}u) { let q = kb * 2u + hf; if (${valid1}) { v = ${load1}; } }`;
  if (k2) {
    const load2 = planar2
      ? planarLoad('s2', op.c2, 'q')
      : `vec4f(s2[((b * ${c2_4}u + q) * H + u32(gy)) * W + u32(gx)])`;
    const valid2 = planar2 ? 'true' : `q < ${c2_4}u`;
    loadBody += ` else { let q = (kb - ${k1}u) * 2u + hf; if (${valid2}) { v = ${load2}; } }`;
  }

  const accs: string[] = [];
  for (let j = 0; j < sps; j++) for (let o = 0; o < ob; o++) accs.push(`var c${j}_${o} = subgroup_matrix_result<f32, 8, 8>();`);

  const mm: string[] = [];
  for (let o = 0; o < ob; o++) {
    mm.push(`let r${o} = subgroupMatrixLoad<subgroup_matrix_right<f32, 8, 8>>(&w, wb + (${o}u * ${nkb * 9}u) * 64u, false, 8u);`);
  }
  for (let j = 0; j < sps; j++) {
    mm.push(`{ let l = subgroupMatrixLoad<subgroup_matrix_left<f32, 8, 8>>(&sm, lb${j} + toff, false, 8u);`);
    for (let o = 0; o < ob; o++) mm.push(`  c${j}_${o} = subgroupMatrixMultiplyAccumulate(l, r${o}, c${j}_${o});`);
    mm.push('}');
  }

  const stores: string[] = [];
  for (let j = 0; j < sps; j++) {
    for (let o = 0; o < ob; o++) {
      stores.push(`subgroupMatrixStore(&sm, ob${j} + ${o * 8}u, c${j}_${o}, false, ${ocb}u);`);
    }
  }

  const act = (e: string) => (op.relu ? `clamp(${e}, vec4f(0.0), vec4f(6.0))` : e);
  const rd = (pix: string) => `(vec4f(sm[(${pix}) * ${ocb}u + o4 * 4u], sm[(${pix}) * ${ocb}u + o4 * 4u + 1u], sm[(${pix}) * ${ocb}u + o4 * 4u + 2u], sm[(${pix}) * ${ocb}u + o4 * 4u + 3u]))`;
  let epi: string;
  if (final) {
    // planar NCHW, op.cout channels
    epi = `
  for (var i = li; i < ${th * tw}u; i += ${threads}u) {
    let ry = i / ${tw}u; let rx = i % ${tw}u;
    let y = oy0 + ry; let x = ox0 + rx;
    if (y < H && x < W) {
      ${Array.from({ length: op.cout }, (_, c) => `dst[((b * ${op.cout}u + ${c}u) * H + y) * W + x] = ${T}(sm[i * ${ocb}u + ${c}u] + bias[${c >> 2}u][${c & 3}u]);`).join('\n      ')}
    }
  }`;
  } else if (op.pool) {
    const ph = th / 2;
    const pw = tw / 2;
    epi = `
  for (var i = li; i < ${ph * pw * (ocb / 4)}u; i += ${threads}u) {
    let o4 = i / ${ph * pw}u; let pix = i % ${ph * pw}u;
    let ry = (pix / ${pw}u) * 2u; let rx = (pix % ${pw}u) * 2u;
    let y = (oy0 + ry) / 2u; let x = (ox0 + rx) / 2u;
    if (y < H / 2u && x < W / 2u) {
      let p0 = ry * ${tw}u + rx;
      let m = max(max(${rd('p0')}, ${rd(`p0 + 1u`)}), max(${rd(`p0 + ${tw}u`)}, ${rd(`p0 + ${tw + 1}u`)}));
      let oc4 = og * ${ob * 2}u + o4;
      dst[((b * ${cout8 * 2}u + oc4) * (H / 2u) + y) * (W / 2u) + x] = vec4<${T}>(${act('m + bias[oc4]')});
    }
  }`;
  } else {
    epi = `
  for (var i = li; i < ${th * tw * (ocb / 4)}u; i += ${threads}u) {
    let o4 = i / ${th * tw}u; let pix = i % ${th * tw}u;
    let y = oy0 + pix / ${tw}u; let x = ox0 + pix % ${tw}u;
    if (y < H && x < W) {
      let oc4 = og * ${ob * 2}u + o4;
      dst[((b * ${cout8 * 2}u + oc4) * H + y) * W + x] = vec4<${T}>(${act(`${rd('pix')} + bias[oc4]`)});
    }
  }`;
  }
  // NB: packed intermediates are allocated with ceil4(channels) chunks; for
  // channel counts that are multiples of 8 (all intermediates) that equals cout8*2.

  const srcDecl = (n: number, planar: boolean) =>
    `@group(0) @binding(${n}) var<storage, read> s${n - 2}: array<${planar ? T : `vec4<${T}>`}>;`;

  const code = /* wgsl */ `enable chromium_experimental_subgroup_matrix;
${f16 ? 'enable f16;' : ''}
// ${op.name} (subgroup matrix): ${op.c1}${op.c2 ? `+${op.c2}` : ''} -> ${op.cout}${op.pool ? ' +maxpool' : ''}${up1 ? ' (src1 upsampled)' : ''}
struct P { H: u32, W: u32, sH: u32, sW: u32, ocg: u32, _a: u32, _b: u32, _c: u32 }
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> w: array<f32>;
@group(0) @binding(2) var<storage, read> bias: array<vec4f>;
${srcDecl(3, planar1)}
${k2 ? srcDecl(4, planar2) : ''}
@group(0) @binding(5) var<storage, read_write> dst: array<${final ? T : `vec4<${T}>`}>;

var<workgroup> sm: array<f32, ${smN}>;

@compute @workgroup_size(${threads}, 1, 1)
fn main(@builtin(workgroup_id) wg: vec3u, @builtin(local_invocation_index) li: u32) {
  let H = p.H;
  let W = p.W;
  let og = wg.z % p.ocg;
  let b = wg.z / p.ocg;
  let oy0 = wg.y * ${th}u;
  let ox0 = wg.x * ${tw}u;
  let ty0 = i32(oy0) - 1;
  let tx0 = i32(ox0) - 1;
  let sg = ${ns === 1 ? "0u" : "li / 32u"}; // ns > 1 fails uniformity analysis (offsets must be uniform)
  ${Array.from({ length: sps }, (_, j) => `let seg${j} = sg * ${sps}u + ${j}u; let lb${j} = ((seg${j} / ${tw / 8}u) * ${ttw}u + (seg${j} % ${tw / 8}u) * 8u) * 8u; let ob${j} = ((seg${j} / ${tw / 8}u) * ${tw}u + (seg${j} % ${tw / 8}u) * 8u) * ${ocb}u;`).join('\n  ')}
  ${accs.join('\n  ')}
  for (var kb = 0u; kb < ${nkb}u; kb++) {
    for (var i = li; i < ${tth * ttw * 2}u; i += ${threads}u) {
      let pix = i >> 1u;
      let hf = i & 1u;
      let gy = ty0 + i32(pix / ${ttw}u);
      let gx = tx0 + i32(pix % ${ttw}u);
      var v = vec4f(0.0);
      if (gy >= 0 && gy < i32(H) && gx >= 0 && gx < i32(W)) {
        ${loadBody}
      }
      let o = pix * 8u + hf * 4u;
      sm[o] = v.x; sm[o + 1u] = v.y; sm[o + 2u] = v.z; sm[o + 3u] = v.w;
    }
    workgroupBarrier();
    for (var t = 0u; t < 9u; t++) {
      let toff = ((t / 3u) * ${ttw}u + t % 3u) * 8u;
      let wb = ((og * ${ob}u * ${nkb}u + kb) * 9u + t) * 64u;
      ${mm.join('\n      ')}
    }
    workgroupBarrier();
  }
  ${stores.join('\n  ')}
  workgroupBarrier();
  ${epi}
}
`;
  return { code, tiling: { ...tiling, ob }, ob, cout8, k1, nkb };
}

/**
 * Weights for the MMA kernel: per (oc8 block, input block, tap) one row-major
 * 8x8 [ic][oc] f32 matrix. Input blocks [0, k1) cover src1's channels, the rest
 * src2's; padding is zero.
 */
export function packWeightsMma(w: Float32Array, cout: number, c1: number, c2: number): Float32Array {
  const cin = c1 + c2;
  const cout8 = ceil8(cout);
  const k1 = ceil8(c1);
  const nkb = k1 + ceil8(c2);
  const out = new Float32Array(cout8 * nkb * 9 * 64);
  for (let o8 = 0; o8 < cout8; o8++) {
    for (let kb = 0; kb < nkb; kb++) {
      for (let t = 0; t < 9; t++) {
        const m = ((o8 * nkb + kb) * 9 + t) * 64;
        for (let i = 0; i < 8; i++) {
          let ch: number;
          if (kb < k1) ch = 8 * kb + i < c1 ? 8 * kb + i : -1;
          else ch = 8 * (kb - k1) + i < c2 ? c1 + 8 * (kb - k1) + i : -1;
          if (ch < 0) continue;
          for (let j = 0; j < 8; j++) {
            const oc = 8 * o8 + j;
            if (oc < cout) out[m + i * 8 + j] = w[(oc * cin + ch) * 9 + t];
          }
        }
      }
    }
  }
  return out;
}
