// f16 store rounding (option `f16Rounding`, our design; results/DISTANCE-LONG.md).
//
// WebGPU leaves the rounding of a float written to an f16 storage texture (rgba16float, rg16float,
// r16float) to the implementation. Chrome on Metal (M5 Pro) truncates toward zero (LESSONS: a 64-texel
// probe stored 1 + 0.9 ulp as 1.0), while `pack2x16float` rounds to nearest. A history that is re-stored
// every frame then loses about half an f16 ulp per store, and an exponential history of weight alpha
// carries roughly that loss / alpha as a steady bias (darker radiance, shorter hit distances).
//
// `f16Rounding: 'nearest'` rewrites a pass's WGSL so that every textureStore into an f16 storage texture
// stores unpack2x16float(pack2x16float(v)): the value is rounded to nearest-even first, and the store
// of an exactly representable f16 value can't round again, whatever the platform does. The default
// ('store') leaves the code untouched, so default pipelines are byte-identical.

const F16_FORMATS = ['rgba16float', 'rg16float', 'r16float'];

/** WGSL helper appended to rewritten passes (values clamped to the finite f16 range first). */
export const RN16_WGSL = /* wgsl */ `
fn rn16_4(v: vec4f) -> vec4f {
  let c = clamp(v, vec4f(-65504.0), vec4f(65504.0));
  return vec4f(unpack2x16float(pack2x16float(c.xy)), unpack2x16float(pack2x16float(c.zw)));
}
`;

/** Index of the parenthesis closing the one opened just before `from` (skips nested () / []). */
function closeParen(code: string, from: number): number {
  let depth = 1;
  for (let i = from; i < code.length; i++) {
    const c = code[i];
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

/** Top-level comma positions inside code[a, b). */
function topCommas(code: string, a: number, b: number): number[] {
  const out: number[] = [];
  let depth = 0;
  for (let i = a; i < b; i++) {
    const c = code[i];
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (c === ',' && depth === 0) out.push(i);
  }
  return out;
}

/** Names of the f16 storage textures a WGSL module declares. */
export function f16StorageNames(code: string): string[] {
  const re = new RegExp(`var\\s+(\\w+)\\s*:\\s*texture_storage_2d<\\s*(${F16_FORMATS.join('|')})\\s*,`, 'g');
  return [...code.matchAll(re)].map((m) => m[1]);
}

/**
 * Rewrites every `textureStore(t, coord, value)` with t an f16 storage texture into
 * `textureStore(t, coord, rn16_4(value))` and appends the helper. Code without f16 storage
 * textures comes back unchanged.
 */
export function roundF16Stores(code: string): string {
  const names = new Set(f16StorageNames(code));
  if (!names.size) return code;
  const re = /textureStore\s*\(\s*(\w+)\s*,/g;
  let out = '';
  let last = 0;
  let n = 0;
  for (let m = re.exec(code); m; m = re.exec(code)) {
    if (!names.has(m[1])) continue;
    const open = code.indexOf('(', m.index);
    const close = closeParen(code, open + 1);
    if (close < 0) throw new Error(`roundF16Stores: unbalanced textureStore(${m[1]}, ...)`);
    const commas = topCommas(code, open + 1, close);
    if (commas.length !== 2) throw new Error(`roundF16Stores: textureStore(${m[1]}, ...) with ${commas.length + 1} arguments`);
    const value = code.slice(commas[1] + 1, close);
    out += code.slice(last, commas[1] + 1) + ` rn16_4(${value.trim()})`;
    last = close;
    re.lastIndex = close;
    n++;
  }
  if (!n) return code;
  return out + code.slice(last) + RN16_WGSL;
}

export type F16Rounding = 'store' | 'nearest';

/** The pass code for a rounding mode ('store' = unchanged). */
export const withF16Rounding = (code: string, mode: F16Rounding | undefined) => (mode === 'nearest' ? roundF16Stores(code) : code);
