// Winograd F(2x2, 3x3) fused conv on 8x8 subgroup matrices.
//
//   Y(2x2) = A^T [ (G g G^T) ⊙ (B^T d B) ] A      d = 4x4 input patch (pad 1)
//
// 16 multiplies per output tile per (ic, oc) instead of 36: in the transformed
// domain the conv is 16 independent GEMMs  M_ξ[tile, oc] = Σ_ic V_ξ[tile, ic] U_ξ[ic, oc],
// one 8x8x8 subgroup MMA per (ξ, 8 tiles, 8 ic, 8 oc). Weights are transformed on
// the CPU (f64 -> f32). Per 8-channel input block the workgroup stages the raw
// patch, transforms it into V (workgroup memory), then runs the 16 MMAs per oc
// block; accumulation stays f32 across all input blocks. The epilogue stores the
// 16 M_ξ, applies A^T M A, bias, relu6, and the 2x2 max pool when the conv feeds
// one — a pool window IS a Winograd tile.
import type { ConvOp } from './graph';

export interface WinoTiling {
  /** 8-tile segments (rows of 8 tiles = 16 px wide x 2 px tall) per workgroup. */
  nseg: number;
  /** 8-oc blocks per workgroup. */
  ob: number;
}

export interface WinoShaderInfo {
  code: string;
  ob: number;
  cout8: number;
  tileW: number;
  tileH: number;
}

const ceil8 = (c: number) => Math.ceil(c / 8);
const ceil4 = (c: number) => Math.ceil(c / 4);

export function winoShader(op: ConvOp, f16: boolean, tiling: WinoTiling): WinoShaderInfo {
  const { nseg } = tiling;
  const final = op.dst < 0;
  const cout8 = ceil8(op.cout);
  let ob = Math.min(tiling.ob, cout8);
  while (cout8 % ob) ob--;
  const ocb = ob * 8;
  const k1 = ceil8(op.c1);
  const k2 = ceil8(op.c2);
  const nkb = k1 + k2;
  const T = f16 ? 'f16' : 'f32';
  const tw = 16; // px: 8 tiles across
  const th = 2 * nseg; // px
  const ntiles = 8 * nseg;
  const ttw = tw + 2;
  const tth = th + 2;
  const rawN = tth * ttw * 8; // raw patch [row][col][8]
  const vN = 16 * ntiles * 8; // V[ξ][tile][8 ic]
  const mN = 16 * ntiles * ocb; // M[ξ][tile][oc] (epilogue, aliases raw + V)
  const smN = Math.max(rawN + vN, mN);
  const vOff = rawN;
  const threads = 32;

  const planar1 = op.src1.kind === 'input';
  const planar2 = op.src2?.kind === 'input';
  const up1 = op.src1.kind === 'tensor' && op.src1.up;
  const c1_4 = ceil4(op.c1);
  const c2_4 = ceil4(op.c2);
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

  // accumulators c{seg}_{ξ}_{o}
  const accs: string[] = [];
  for (let s = 0; s < nseg; s++) for (let x = 0; x < 16; x++) for (let o = 0; o < ob; o++) {
    accs.push(`var c${s}_${x}_${o} = subgroup_matrix_result<f32, 8, 8>();`);
  }
  const mm: string[] = [];
  for (let x = 0; x < 16; x++) {
    mm.push('{');
    for (let o = 0; o < ob; o++) {
      mm.push(`  let r${o} = subgroupMatrixLoad<subgroup_matrix_right<f32, 8, 8>>(&w, wb + ${(o * nkb * 16 + x) * 64}u, false, 8u);`);
    }
    for (let s = 0; s < nseg; s++) {
      mm.push(`  { let l = subgroupMatrixLoad<subgroup_matrix_left<f32, 8, 8>>(&sm, ${vOff + (x * ntiles + s * 8) * 8}u, false, 8u);`);
      for (let o = 0; o < ob; o++) mm.push(`    c${s}_${x}_${o} = subgroupMatrixMultiplyAccumulate(l, r${o}, c${s}_${x}_${o});`);
      mm.push('  }');
    }
    mm.push('}');
  }
  const stores: string[] = [];
  for (let s = 0; s < nseg; s++) for (let x = 0; x < 16; x++) for (let o = 0; o < ob; o++) {
    stores.push(`subgroupMatrixStore(&sm, ${(x * ntiles + s * 8) * ocb + o * 8}u, c${s}_${x}_${o}, false, ${ocb}u);`);
  }

  // input transform for one (tile, ic): d[r][c] from the raw patch -> V[ξ]
  const dIdx = (r: number, c: number) => `sm[((ty * 2u + ${r}u) * ${ttw}u + tx * 2u + ${c}u) * 8u + ic]`;
  const inT: string[] = [];
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) inT.push(`let d${r}${c} = ${dIdx(r, c)};`);
  // B^T d: rows
  const btRow = [
    (c: number) => `d0${c} - d2${c}`,
    (c: number) => `d1${c} + d2${c}`,
    (c: number) => `d2${c} - d1${c}`,
    (c: number) => `d1${c} - d3${c}`,
  ];
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) inT.push(`let e${r}${c} = ${btRow[r](c)};`);
  // (B^T d) B: columns
  const bCol = [
    (r: number) => `e${r}0 - e${r}2`,
    (r: number) => `e${r}1 + e${r}2`,
    (r: number) => `e${r}2 - e${r}1`,
    (r: number) => `e${r}1 - e${r}3`,
  ];
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
    inT.push(`sm[${vOff}u + (${r * 4 + c}u * ${ntiles}u + tile) * 8u + ic] = ${bCol[c](r)};`);
  }

  // output transform for (tile, oc): m[r][c] -> y[i][j]
  const outT: string[] = [];
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
    outT.push(`let m${r}${c} = sm[(${r * 4 + c}u * ${ntiles}u + tile) * ${ocb}u + oc];`);
  }
  for (let c = 0; c < 4; c++) {
    outT.push(`let t0${c} = m0${c} + m1${c} + m2${c};`, `let t1${c} = m1${c} - m2${c} - m3${c};`);
  }
  outT.push('let bv = bias[ocg / 4u][ocg % 4u];');
  for (let i = 0; i < 2; i++) {
    outT.push(`let y${i}0 = t${i}0 + t${i}1 + t${i}2 + bv;`, `let y${i}1 = t${i}1 - t${i}2 - t${i}3 + bv;`);
  }
  const act = (e: string) => (op.relu ? `clamp(${e}, 0.0, 6.0)` : e);

  let epi: string;
  if (final) {
    epi = `
  for (var i = li; i < ${ntiles * ocb}u; i += ${threads}u) {
    let oc = i / ${ntiles}u; let tile = i % ${ntiles}u;
    let ocg = og * ${ocb}u + oc;
    if (ocg < ${op.cout}u) {
      let ty = tile / 8u; let tx = tile % 8u;
      ${outT.join('\n      ')}
      let y0 = oy0 + ty * 2u; let x0 = ox0 + tx * 2u;
      let base = (b * ${op.cout}u + ocg) * H;
      if (y0 < H && x0 < W) {
        dst[(base + y0) * W + x0] = ${T}(y00); dst[(base + y0) * W + x0 + 1u] = ${T}(y01);
        dst[(base + y0 + 1u) * W + x0] = ${T}(y10); dst[(base + y0 + 1u) * W + x0 + 1u] = ${T}(y11);
      }
    }
  }`;
  } else {
    // one thread per (tile, oc4): 4 channels -> one vec4 store per pixel
    const body4: string[] = [];
    for (let c = 0; c < 4; c++) {
      body4.push(`{ let oc = o4 * 4u + ${c}u; let ocg = og * ${ocb}u + oc;`);
      body4.push(...outT.map((l) => `  ${l}`));
      if (op.pool) body4.push(`  r[${c}] = ${act('max(max(y00, y01), max(y10, y11))')};`);
      else body4.push(`  q00[${c}] = ${act('y00')}; q01[${c}] = ${act('y01')}; q10[${c}] = ${act('y10')}; q11[${c}] = ${act('y11')};`);
      body4.push('}');
    }
    const C4 = cout8 * 2;
    const store = op.pool
      ? `let py = (oy0 / 2u) + ty; let px = (ox0 / 2u) + tx;
      if (py < H / 2u && px < W / 2u) { dst[((b * ${C4}u + oc4) * (H / 2u) + py) * (W / 2u) + px] = vec4<${T}>(r); }`
      : `let y0 = oy0 + ty * 2u; let x0 = ox0 + tx * 2u;
      if (y0 < H && x0 < W) {
        let base = (b * ${C4}u + oc4) * H;
        dst[(base + y0) * W + x0] = vec4<${T}>(q00); dst[(base + y0) * W + x0 + 1u] = vec4<${T}>(q01);
        dst[(base + y0 + 1u) * W + x0] = vec4<${T}>(q10); dst[(base + y0 + 1u) * W + x0 + 1u] = vec4<${T}>(q11);
      }`;
    epi = `
  for (var i = li; i < ${ntiles * (ocb / 4)}u; i += ${threads}u) {
    let o4 = i / ${ntiles}u; let tile = i % ${ntiles}u;
    let ty = tile / 8u; let tx = tile % 8u;
    let oc4 = og * ${ob * 2}u + o4;
    ${op.pool ? 'var r = vec4f(0.0);' : 'var q00 = vec4f(0.0); var q01 = vec4f(0.0); var q10 = vec4f(0.0); var q11 = vec4f(0.0);'}
    ${body4.join('\n    ')}
    ${store}
  }`;
  }

  const srcDecl = (n: number, planar: boolean) =>
    `@group(0) @binding(${n}) var<storage, read> s${n - 2}: array<${planar ? T : `vec4<${T}>`}>;`;

  const code = /* wgsl */ `enable chromium_experimental_subgroup_matrix;
${f16 ? 'enable f16;' : ''}
// ${op.name} (winograd F(2x2,3x3), subgroup matrix): ${op.c1}${op.c2 ? `+${op.c2}` : ''} -> ${op.cout}${op.pool ? ' +maxpool' : ''}${up1 ? ' (src1 upsampled)' : ''}
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
    for (var i = li; i < ${ntiles * 8}u; i += ${threads}u) {
      let tile = i / 8u; let ic = i % 8u;
      let ty = tile / 8u; let tx = tile % 8u;
      ${inT.join('\n      ')}
    }
    workgroupBarrier();
    let wb = (og * ${ob}u * ${nkb}u + kb) * ${16 * 64}u;
    ${mm.join('\n    ')}
    workgroupBarrier();
  }
  ${stores.join('\n  ')}
  workgroupBarrier();
  ${epi}
}
`;
  return { code, ob, cout8, tileW: tw, tileH: th };
}

/**
 * Winograd-domain weights U = G g G^T: per (oc8 block, input block, ξ) one
 * row-major 8x8 [ic][oc] f32 matrix. Blocks as packWeightsMma.
 */
export function packWeightsWino(w: Float32Array, cout: number, c1: number, c2: number): Float32Array {
  const cin = c1 + c2;
  const cout8 = ceil8(cout);
  const k1 = ceil8(c1);
  const nkb = k1 + ceil8(c2);
  const out = new Float32Array(cout8 * nkb * 16 * 64);
  const G = [[1, 0, 0], [0.5, 0.5, 0.5], [0.5, -0.5, 0.5], [0, 0, 1]];
  const u = new Float64Array(16);
  for (let oc = 0; oc < cout; oc++) {
    for (let kb = 0; kb < nkb; kb++) {
      for (let i = 0; i < 8; i++) {
        let ch: number;
        if (kb < k1) ch = 8 * kb + i < c1 ? 8 * kb + i : -1;
        else ch = 8 * (kb - k1) + i < c2 ? c1 + 8 * (kb - k1) + i : -1;
        if (ch < 0) continue;
        const g = (r: number, c: number) => w[((oc * cin + ch) * 3 + r) * 3 + c];
        for (let a = 0; a < 4; a++) for (let bb = 0; bb < 4; bb++) {
          let s = 0;
          for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) s += G[a][r] * g(r, c) * G[bb][c];
          u[a * 4 + bb] = s;
        }
        const o8 = oc >> 3;
        for (let x = 0; x < 16; x++) out[((o8 * nkb + kb) * 16 + x) * 64 + i * 8 + (oc & 7)] = u[x];
      }
    }
  }
  return out;
}
