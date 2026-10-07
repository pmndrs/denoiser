// WGSL generator for the fused conv op (see ./graph.ts).
//
// Direct 3x3 conv, register-blocked: each thread owns a PH x PW block of output
// pixels x OC4 groups of 4 output channels (vec4 accumulators, f32). Per group of
// 4 input channels ("chunk") the workgroup stages its (TH+2) x (TW+2) input tile
// in workgroup memory (zero padding, nearest upsample and the two-source concat
// all resolved in the loader), then every thread does mat4x4 * vec4 per tap
// (a runtime loop over ky keeps the compiler from hoisting all 9 taps' weights).
// fp16 models: f16 weights/tile, each chunk's products summed in f16.
// Weights: mat4x4 per (oc4, chunk, tap), column j = input channel j of the chunk.
import type { ConvOp } from './graph';

export interface ConvTiling {
  /** Output pixels per thread (PW must be even when pooling, PH too). */
  pw: number;
  ph: number;
  /** vec4 output-channel groups per thread. */
  oc4: number;
  /** Workgroup size in threads. */
  wgx: number;
  wgy: number;
  /**
   * Experiment switches (tuning only; all measured slower or equal, see
   * docs/specs/runtimes.md): 'adjacent' (thread-adjacent output columns), 'wShared'
   * (weights via workgroup memory), 'tapLoop' / 'unroll' (tap loop shape), 'h16'
   * (fp16: f16 product per tap), 'f32math' (fp16: no f16 sums).
   */
  exp?: string[];
}

export interface ConvShaderInfo {
  code: string;
  tiling: ConvTiling;
  nch: number; // input chunks (vec4 groups)
  c1_4: number;
  cout4: number;
  /** Threads tile this many output pixels per workgroup. */
  tileW: number;
  tileH: number;
}

export const ceil4 = (c: number) => Math.ceil(c / 4);

export function convShader(op: ConvOp, f16: boolean, tiling: ConvTiling): ConvShaderInfo {
  const { pw, ph, wgx, wgy } = tiling;
  const exp = new Set(tiling.exp ?? []);
  // Pixel columns per thread: pooled convs keep 2 adjacent columns per thread (the
  // 2x2 max is in-register); others interleave threads (column = l.x + px * wgx)
  // so each store instruction writes contiguous vec4s across the SIMD group.
  const strided = !op.pool && !exp.has('adjacent');
  const colOf = (px: number) => (strided ? px * wgx : px);
  // Weights for the chunk staged in workgroup memory (one cooperative load per
  // chunk, broadcast reads) instead of per-thread global loads.
  const wShared = exp.has('wShared');
  // f16 math (fp16 models only): tile + weights stay f16, each tap's 4-term
  // mat4x4 * vec4 product is f16, accumulation stays f32.
  // fp16 models: f16 products summed in f16 over one 4-channel input chunk (9 taps
  // x 4 channels = 36 terms), added to the f32 accumulator once per chunk. Apple
  // GPUs run f16 FMA at 2x the f32 rate (mma.html); measured 1080p 44 -> 37 ms,
  // output still within 1 LSB of fp32 (ORT fp16: 2-3). 'f32math' turns it off.
  const h16c = f16 && !exp.has('f32math');
  const h16 = f16 && (exp.has('h16') || h16c);
  const MT = h16 ? 'mat4x4<f16>' : 'mat4x4f';
  const VT = h16 ? 'vec4<f16>' : 'vec4f';
  const final = op.dst < 0;
  const cout4 = ceil4(op.cout);
  const oc4 = Math.min(tiling.oc4, cout4);
  if (cout4 % oc4) throw new Error(`oc4 ${oc4} must divide cout4 ${cout4}`);
  if (op.pool && (pw % 2 || ph % 2)) throw new Error('pooling needs even pixel blocks');
  const c1_4 = ceil4(op.c1);
  const c2_4 = ceil4(op.c2);
  const nch = c1_4 + c2_4;
  const T = f16 ? 'f16' : 'f32';
  const tileW = wgx * pw;
  const tileH = wgy * ph;
  const ttw = tileW + 2;
  const tth = tileH + 2;
  const tn = ttw * tth;

  const planar1 = op.src1.kind === 'input';
  const planar2 = op.src2?.kind === 'input';
  const up1 = op.src1.kind === 'tensor' && op.src1.up;
  const srcDecl = (n: number, planar: boolean) =>
    `@group(0) @binding(${n}) var<storage, read> s${n - 2}: array<${planar ? T : `vec4<${T}>`}>;`;

  // load one chunk (vec4 of channels) for pixel (gy, gx) of batch b
  const planarLoad = (s: string, c: number, chunk: string) => {
    const parts: string[] = [];
    for (let j = 0; j < 4; j++) {
      parts.push(`select(0.0, f32(${s}[((b * ${c}u + min(${chunk} * 4u + ${j}u, ${c - 1}u)) * H + u32(gy)) * W + u32(gx)]), ${chunk} * 4u + ${j}u < ${c}u)`);
    }
    return `vec4f(${parts.join(',\n        ')})`;
  };
  const load1 = planar1
    ? planarLoad('s1', op.c1, 'k')
    : up1
      ? `vec4f(s1[((b * ${c1_4}u + k) * p.sH + u32(gy) / 2u) * p.sW + u32(gx) / 2u])`
      : `vec4f(s1[((b * ${c1_4}u + k) * H + u32(gy)) * W + u32(gx)])`;
  let load: string;
  if (c2_4) {
    const load2 = planar2
      ? planarLoad('s2', op.c2, 'k2')
      : `vec4f(s2[((b * ${c2_4}u + k2) * H + u32(gy)) * W + u32(gx)])`;
    load = `if (k < ${c1_4}u) { v = ${load1}; } else { let k2 = k - ${c1_4}u; v = ${load2}; }`;
  } else {
    load = `v = ${load1};`;
  }

  const acc = (py: number, px: number, o: number) => `a${py}_${px}_${o}`;
  const lines: string[] = [];
  for (let o = 0; o < oc4; o++) {
    for (let py = 0; py < ph; py++) for (let px = 0; px < pw; px++) {
      lines.push(`var ${acc(py, px, o)} = bv${o};`);
    }
  }
  const accDecl = lines.join('\n  ');

  // Taps: either fully unrolled, or a runtime loop over ky (default; 'unroll' to disable) so the
  // compiler can't hoist all 9 taps' weight loads at once (register pressure). Measured: enc_conv0 12.9 -> 3.2 ms at 1080p.
  const tapLoop = exp.has('tapLoop'); // runtime loop over all 9 taps
  const kyLoop = !tapLoop && !exp.has('unroll');
  const body: string[] = [];
  const part = (py: number, px: number, o: number) => `h${py}_${px}_${o}`;
  if (h16c) {
    for (let o = 0; o < oc4; o++) for (let py = 0; py < ph; py++) for (let px = 0; px < pw; px++) {
      body.push(`var ${part(py, px, o)} = vec4<f16>(0.0);`);
    }
  }
  if (kyLoop) body.push('for (var ky = 0u; ky < 3u; ky++) {');
  if (tapLoop) body.push('for (var t = 0u; t < 9u; t++) {', `let toff = (t / 3u) * ${ttw}u + t % 3u;`);
  for (let ky = 0; ky < (kyLoop || tapLoop ? 1 : 3); ky++) {
    for (let kx = 0; kx < (tapLoop ? 1 : 3); kx++) {
      const t = ky * 3 + kx;
      const tap = tapLoop ? 't' : kyLoop ? `ky * 3u + ${kx}u` : `${t}u`;
      for (let o = 0; o < oc4; o++) {
        body.push(wShared ? `let m${o}_${t} = wsh[${o * 9}u + ${tap}];` : `let m${o}_${t} = ${MT}(w[wb${o} + ${tap}]);`);
      }
      for (let py = 0; py < ph; py++) for (let px = 0; px < pw; px++) {
        const off = (py + ky) * ttw + colOf(px) + kx;
        const dyn = tapLoop ? 'toff + ' : kyLoop ? `ky * ${ttw}u + ` : '';
        body.push(`{ let x = tile[base + ${dyn}${off}u];`);
        for (let o = 0; o < oc4; o++) {
          body.push(h16c ? `  ${part(py, px, o)} += m${o}_${t} * x;`
            : h16 ? `  ${acc(py, px, o)} += vec4f(m${o}_${t} * x);` : `  ${acc(py, px, o)} += m${o}_${t} * x;`);
        }
        body.push('}');
      }
    }
  }
  if (kyLoop || tapLoop) body.push('}');
  if (h16c) {
    for (let o = 0; o < oc4; o++) for (let py = 0; py < ph; py++) for (let px = 0; px < pw; px++) {
      body.push(`${acc(py, px, o)} += vec4f(${part(py, px, o)});`);
    }
  }

  const epi: string[] = [];
  const act = (e: string) => (op.relu ? `clamp(${e}, vec4f(0.0), vec4f(6.0))` : e);
  for (let o = 0; o < oc4; o++) {
    epi.push(`{ let oc = og * ${oc4}u + ${o}u;`);
    if (final) {
      for (let py = 0; py < ph; py++) for (let px = 0; px < pw; px++) {
        epi.push(`  { let y = oy + ${py}u; let x = ox + ${colOf(px)}u; if (y < H && x < W) { let r = ${act(acc(py, px, o))};`);
        for (let c = 0; c < Math.min(4, op.cout - o * 4); c++) {
          epi.push(`    dst[((b * ${op.cout}u + oc * 4u + ${c}u) * H + y) * W + x] = ${T}(r[${c}]);`);
        }
        epi.push('  } }');
      }
    } else if (op.pool) {
      for (let py = 0; py < ph; py += 2) for (let px = 0; px < pw; px += 2) {
        const m = `max(max(${acc(py, px, o)}, ${acc(py, px + 1, o)}), max(${acc(py + 1, px, o)}, ${acc(py + 1, px + 1, o)}))`;
        epi.push(`  { let y = (oy + ${py}u) / 2u; let x = (ox + ${px}u) / 2u; if (y < H / 2u && x < W / 2u) {`);
        epi.push(`    dst[((b * ${cout4}u + oc) * (H / 2u) + y) * (W / 2u) + x] = vec4<${T}>(${act(m)}); } }`);
      }
    } else {
      for (let py = 0; py < ph; py++) for (let px = 0; px < pw; px++) {
        epi.push(`  { let y = oy + ${py}u; let x = ox + ${colOf(px)}u; if (y < H && x < W) {`);
        epi.push(`    dst[((b * ${cout4}u + oc) * H + y) * W + x] = vec4<${T}>(${act(acc(py, px, o))}); } }`);
      }
    }
    epi.push('}');
  }

  const code = /* wgsl */ `${f16 ? 'enable f16;\n' : ''}
// ${op.name}: ${op.c1}${op.c2 ? `+${op.c2}` : ''} -> ${op.cout}${op.pool ? ' +maxpool' : ''}${up1 ? ' (src1 upsampled)' : ''}
struct P { H: u32, W: u32, sH: u32, sW: u32, ocg: u32, _a: u32, _b: u32, _c: u32 }
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> w: array<mat4x4<${T}>>;
@group(0) @binding(2) var<storage, read> bias: array<vec4f>;
${srcDecl(3, planar1)}
${c2_4 ? srcDecl(4, planar2) : ''}
@group(0) @binding(5) var<storage, read_write> dst: array<${final ? T : `vec4<${T}>`}>;

var<workgroup> tile: array<${VT}, ${tn}>;
${wShared ? `var<workgroup> wsh: array<${MT}, ${9 * oc4}>;` : ''}

@compute @workgroup_size(${wgx}, ${wgy}, 1)
fn main(@builtin(workgroup_id) wg: vec3u, @builtin(local_invocation_id) l: vec3u, @builtin(local_invocation_index) li: u32) {
  let H = p.H;
  let W = p.W;
  let og = wg.z % p.ocg;
  let b = wg.z / p.ocg;
  let ty0 = i32(wg.y * ${tileH}u) - 1;
  let tx0 = i32(wg.x * ${tileW}u) - 1;
  let oy = wg.y * ${tileH}u + l.y * ${ph}u;
  let ox = wg.x * ${tileW}u + l.x * ${strided ? 1 : pw}u;
  let base = l.y * ${ph * ttw}u + l.x * ${strided ? 1 : pw}u;
  ${Array.from({ length: oc4 }, (_, o) => `let bv${o} = bias[og * ${oc4}u + ${o}u];`).join('\n  ')}
  ${accDecl}
  for (var k = 0u; k < ${nch}u; k++) {
    for (var i = li; i < ${tn}u; i += ${wgx * wgy}u) {
      let gy = ty0 + i32(i / ${ttw}u);
      let gx = tx0 + i32(i % ${ttw}u);
      var v = vec4f(0.0);
      if (gy >= 0 && gy < i32(H) && gx >= 0 && gx < i32(W)) {
        ${load}
      }
      tile[i] = ${VT}(v);
    }${wShared ? `
    for (var i = li; i < ${36 * oc4}u; i += ${wgx * wgy}u) {
      let m = i / 4u;
      let o = m / 9u;
      wsh[m][i % 4u] = ${VT}(w[((og * ${oc4}u + o) * ${nch}u + k) * 9u + m % 9u][i % 4u]);
    }` : ''}
    workgroupBarrier();
    ${wShared ? '' : Array.from({ length: oc4 }, (_, o) => `let wb${o} = ((og * ${oc4}u + ${o}u) * ${nch}u + k) * 9u;`).join('\n    ')}
    ${body.join('\n    ')}
    workgroupBarrier();
  }
  {
  ${epi.join('\n  ')}
  }
}
`;
  return { code, tiling: { ...tiling, oc4 }, nch, c1_4, cout4, tileW, tileH };
}

/**
 * Pack OIHW conv weights into the shader's layout: mat4x4 per (oc4, chunk, tap),
 * column j = input channel j of the chunk, row i = output channel 4*oc4 + i.
 * Chunks [0, c1_4) cover src1's channels, the rest src2's (concat order); padded
 * channels are zero.
 */
export function packWeights(w: Float32Array, cout: number, c1: number, c2: number): Float32Array {
  const cin = c1 + c2;
  const cout4 = ceil4(cout);
  const c1_4 = ceil4(c1);
  const nch = c1_4 + ceil4(c2);
  const out = new Float32Array(cout4 * nch * 9 * 16);
  for (let o4 = 0; o4 < cout4; o4++) {
    for (let k = 0; k < nch; k++) {
      for (let t = 0; t < 9; t++) {
        const m = ((o4 * nch + k) * 9 + t) * 16;
        for (let j = 0; j < 4; j++) {
          let ch: number;
          if (k < c1_4) ch = 4 * k + j < c1 ? 4 * k + j : -1;
          else ch = 4 * (k - c1_4) + j < c2 ? c1 + 4 * (k - c1_4) + j : -1;
          if (ch < 0) continue;
          for (let i = 0; i < 4; i++) {
            const oc = 4 * o4 + i;
            if (oc >= cout) continue;
            out[m + j * 4 + i] = w[(oc * cin + ch) * 9 + t];
          }
        }
      }
    }
  }
  return out;
}

export function packBias(b: Float32Array, cout: number): Float32Array {
  const out = new Float32Array(ceil4(cout) * 4);
  out.set(b.subarray(0, cout));
  return out;
}
